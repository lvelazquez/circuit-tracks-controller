import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { LAYOUT, compile, decode } from "@ctl/profile";
import type { Finding, Profile } from "@ctl/profile";
import { preview } from "./preview.ts";
import type { Store } from "./store.ts";

const configSchema = z.object({ forkPath: z.string().min(1), python: z.string().min(1), stockBin: z.string().min(1) }).strict();
export type LocalConfig = z.infer<typeof configSchema>;

/** Where the template slot and the build mark sit in an image (file offsets; `tools/ctl.py` SLOT and `build_ctl.py` MARK_OFF). */
const SLOT_OFFSET = 0x0805d000 - 0x08010000;
const MARK_OFFSET = 0x1e8;
const MARK_LENGTH = 6;
const markPattern = /^C1[0-9A-Z]{4}$/;

export class BuildBlocked extends Error {
  readonly findings: Finding[];
  constructor(message: string, findings: Finding[]) {
    super(message);
    this.findings = findings;
  }
}

export function readConfig(root: string): LocalConfig {
  const file = join(root, "local.config.json");
  if (!existsSync(file)) throw new Error("local.config.json is missing: copy local.config.example.json and fill in the three paths.");
  return configSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

const sha256 = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

function run(cfg: LocalConfig, tool: string, args: string[]): string {
  try {
    return execFileSync(cfg.python, [join(cfg.forkPath, "tools", tool), ...args], { cwd: cfg.forkPath, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message: string };
    throw new Error(`${tool} failed: ${(e.stdout ?? "").trim() || (e.stderr ?? "").trim().split("\n").slice(-3).join(" | ") || e.message}`);
  }
}

/** The CTL image without a profile, built once per fork state into out/base. Rebuilt every time: it is cheap and never stale. */
function buildBase(root: string, cfg: LocalConfig): string {
  const dir = join(root, "out", "base");
  mkdirSync(dir, { recursive: true });
  run(cfg, "build_ctl.py", [cfg.stockBin, "-o", dir]);
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as { image: string };
  return join(dir, manifest.image);
}

export type BuildResult = {
  mark: string;
  directory: string;
  files: string[];
  imageSha256: string;
  syxSha256: string;
  warnings: Finding[];
  note: string;
};

/**
 * Compiles a stored profile and bakes it into a CTL image through the fork's own tools. Writes only under out/ and the mark
 * ledger profiles/marks.json. It does not open a MIDI port: installing the .syx is done by hand.
 */
export function firmwareBuild(store: Store, profileId: string, allowUnverified: boolean): BuildResult {
  const validation = store.validate(store.profileRaw(profileId));
  if (validation.schemaErrors.length) throw new BuildBlocked(`The profile is not valid: ${validation.schemaErrors.slice(0, 3).join("; ")}`, []);
  const errors = validation.findings.filter((f) => f.level === "error");
  if (errors.length) throw new BuildBlocked(`${errors.length} lint error(s) block the build.`, errors);
  const unverified = validation.findings.filter((f) => f.code === "unverified-capability");
  if (unverified.length && !allowUnverified) {
    throw new BuildBlocked(`${unverified.length} pad(s) or knob(s) use a capability nobody has verified on the device. Pass allowUnverified to build anyway.`, unverified);
  }
  const cfg = readConfig(store.root);
  const profile = store.profile(profileId);
  const base = buildBase(store.root, cfg);
  const work = join(store.root, "out", "work");
  mkdirSync(work, { recursive: true });
  const template = join(work, `${profileId}.tpl.bin`);
  writeFileSync(template, compile(profile));
  const outDir = join(store.root, "out");
  const args = [base, template, "-o", outDir, "--ledger", join(store.root, "profiles", "marks.json"), "--name", profile.name];
  const uploader = join(cfg.forkPath, "tools", "ct_uploader.html");
  if (existsSync(uploader)) args.push("--uploader", uploader);
  const result = JSON.parse(run(cfg, "ctl_bake.py", args).trim().split("\n").at(-1) ?? "{}") as { marker: string; image_sha256: string; syx_sha256: string };
  if (!markPattern.test(result.marker)) throw new Error("ctl_bake.py did not report a mark");
  const directory = join(outDir, result.marker);
  writeFileSync(join(directory, "profile.json"), `${JSON.stringify(profile, null, 2)}\n`);
  return {
    mark: result.marker,
    directory,
    files: readdirSync(directory).sort(),
    imageSha256: result.image_sha256,
    syxSha256: result.syx_sha256,
    warnings: validation.findings.filter((f) => f.level === "warning"),
    note: "Built, not installed. This firmware has only run in emulation; installing it on the device is a manual step that needs the owner's go-ahead.",
  };
}

export type Inspection = { mark: string; imageSha256: string; imageBytes: number; profile: Profile; preview: string };

/** Reads a build from out/<mark>/ and shows the profile that is actually inside the image. */
export function firmwareInspect(store: Store, mark: string): Inspection {
  if (!markPattern.test(mark)) throw new Error(`"${mark}" is not a build mark (C1 and four characters)`);
  const dir = join(store.root, "out", mark);
  const bin = existsSync(dir) ? readdirSync(dir).find((f) => f.endsWith(".bin")) : undefined;
  if (!bin) throw new Error(`out/${mark}/ has no image`);
  const image = new Uint8Array(readFileSync(join(dir, bin)));
  const inside = new TextDecoder().decode(image.subarray(MARK_OFFSET, MARK_OFFSET + MARK_LENGTH));
  if (inside !== mark) throw new Error(`the image in out/${mark}/ carries the mark ${inside}`);
  const profile = decode(image.subarray(SLOT_OFFSET, SLOT_OFFSET + LAYOUT.slotLength), `build ${mark}`);
  return { mark, imageSha256: sha256(image), imageBytes: image.length, profile, preview: preview(profile, store.capabilityIndex()) };
}
