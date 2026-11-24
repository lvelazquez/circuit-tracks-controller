import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { compile, lint, profileSchema } from "@ctl/profile";
import type { CapabilityIndex, Finding, Profile } from "@ctl/profile";

const idPattern = /^[a-z0-9][a-z0-9-]{0,47}$/;

const capabilitySchema = z
  .object({
    status: z.enum(["verified", "unverified", "refuted"]),
    /** What was observed on the real device, newest last. Only `record_observation` adds to it. */
    evidence: z.array(z.object({ date: z.string(), note: z.string(), session: z.string().optional() }).strict()),
  })
  .strict();

export const deviceSchema = z
  .object({ id: z.string().regex(idPattern), name: z.string().min(1), notes: z.string().optional(), capabilities: z.record(z.string(), capabilitySchema) })
  .strict();
export type Device = z.infer<typeof deviceSchema>;

export type Validation = { ok: boolean; schemaErrors: string[]; findings: Finding[]; slotBytes: number | null };

/** Ids the profile tools may not write: the mark ledger, and the mirror of the firmware's built-in template. */
const RESERVED_PROFILES: readonly string[] = ["marks", "default"];

export type Observation = { device: string; capability: string; status: "verified" | "unverified" | "refuted"; note: string; session?: string | undefined };

/**
 * Reads the workspace's catalog and profiles. It writes in two places only: a profile file (`saveProfile`)
 * and a capability's status and evidence (`recordObservation`).
 */
export class Store {
  readonly root: string;
  constructor(root: string) {
    this.root = root;
  }

  private ids(dir: string): string[] {
    const full = join(this.root, dir);
    if (!existsSync(full)) return [];
    return readdirSync(full)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -5))
      .filter((id) => idPattern.test(id))
      .sort();
  }

  private readJson(dir: string, id: string): unknown {
    if (!idPattern.test(id)) throw new Error(`"${id}" is not a valid id (lower-case letters, digits and hyphens)`);
    const file = join(this.root, dir, `${id}.json`);
    if (!existsSync(file)) throw new Error(`${dir}/${id}.json does not exist`);
    return JSON.parse(readFileSync(file, "utf8"));
  }

  deviceIds(): string[] {
    return this.ids("catalog/devices");
  }

  device(id: string): Device {
    const device = deviceSchema.parse(this.readJson("catalog/devices", id));
    if (device.id !== id) throw new Error(`catalog/devices/${id}.json has id "${device.id}"`);
    return device;
  }

  capabilityIndex(): CapabilityIndex {
    const index: Record<string, Record<string, "verified" | "unverified" | "refuted">> = {};
    for (const id of this.deviceIds()) {
      index[id] = Object.fromEntries(Object.entries(this.device(id).capabilities).map(([k, v]) => [k, v.status]));
    }
    return index;
  }

  profileIds(): string[] {
    return this.ids("profiles").filter((id) => id !== "marks");
  }

  profileRaw(id: string): unknown {
    return this.readJson("profiles", id);
  }

  profile(id: string): Profile {
    return profileSchema.parse(this.profileRaw(id));
  }

  /** Schema, then lint against the catalog. `ok` means a firmware build would not be blocked by an error. */
  validate(input: unknown): Validation {
    const parsed = profileSchema.safeParse(input);
    if (!parsed.success) {
      const schemaErrors = parsed.error.issues.map((i) => `${i.path.join(".") || "(profile)"}: ${i.message}`);
      return { ok: false, schemaErrors, findings: [], slotBytes: null };
    }
    const findings = lint(parsed.data, this.capabilityIndex());
    return { ok: !findings.some((f) => f.level === "error"), schemaErrors: [], findings, slotBytes: compile(parsed.data).length };
  }

  private writeJson(dir: string, id: string, value: unknown): void {
    const file = join(this.root, dir, `${id}.json`);
    const temp = `${file}.tmp`;
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
    renameSync(temp, file);
  }

  /**
   * Stores a profile. `create` refuses an id that exists, `update` one that does not. A profile that fails the schema
   * is never written; lint findings are returned and do not block saving (they block `firmware_build`).
   */
  saveProfile(id: string, input: unknown, mode: "create" | "update"): Validation & { saved: boolean; file: string } {
    if (!idPattern.test(id)) throw new Error(`"${id}" is not a valid id (lower-case letters, digits and hyphens)`);
    if (RESERVED_PROFILES.includes(id)) throw new Error(`"${id}" is reserved and cannot be written by this tool`);
    const file = `profiles/${id}.json`;
    const exists = existsSync(join(this.root, file));
    if (mode === "create" && exists) throw new Error(`${file} already exists: use profile_update to replace it`);
    if (mode === "update" && !exists) throw new Error(`${file} does not exist: use profile_create`);
    const validation = this.validate(input);
    if (validation.schemaErrors.length) return { ...validation, saved: false, file };
    this.writeJson("profiles", id, profileSchema.parse(input));
    return { ...validation, saved: true, file };
  }

  /** Sets a capability's status and appends what was seen to its evidence log. The only way a status changes. */
  recordObservation(o: Observation, date: string): Device {
    const device = this.device(o.device);
    const capability = device.capabilities[o.capability];
    if (!capability) throw new Error(`${o.device} has no capability "${o.capability}" (it has: ${Object.keys(device.capabilities).join(", ")})`);
    if (o.note.trim().length < 10) throw new Error("the note must say what was observed on the real device");
    capability.status = o.status;
    capability.evidence.push({ date, note: `[${o.status}] ${o.note.trim()}`, ...(o.session === undefined ? {} : { session: o.session }) });
    this.writeJson("catalog/devices", o.device, device);
    return device;
  }
}
