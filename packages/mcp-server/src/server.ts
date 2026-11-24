#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BuildBlocked, firmwareBuild, firmwareInspect } from "./firmware.ts";
import { loadBackend } from "./midi.ts";
import type { MidiBackend } from "./midi.ts";
import { deviceInfo, listPorts, midiMonitor, probeMessageSchema, probeSend } from "./midi-tools.ts";
import type { ProbeArgs } from "./midi-tools.ts";
import { preview } from "./preview.ts";
import { LIMITS } from "./safety.ts";
import { Store } from "./store.ts";

/**
 * The CTL configurator: catalog and profile tools (plan P1), firmware build tools (P4) and the MIDI tools (P1b).
 * What writes: `profile_create` / `profile_update` (one file under profiles/), `record_observation` (one file under
 * catalog/devices/) and `firmware_build` (out/ and the mark ledger).
 * What sends MIDI: `device_info` (two fixed identity requests) and `probe_send` (never to the Circuit, `safety.ts`).
 * No tool installs firmware or writes to the device. A port is open only while a MIDI tool runs.
 */
const root = process.env["CTL_WORKSPACE"] ?? join(dirname(fileURLToPath(import.meta.url)), "../../..");
const store = new Store(root);
const server = new McpServer({ name: "ctl-configurator", version: "0.1.0" });

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
const failure = (error: unknown) => ({ isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }] });
const guard = <A>(fn: (args: A) => unknown) => async (args: A) => {
  try {
    return text(await fn(args));
  } catch (error) {
    return failure(error);
  }
};
const readOnly = { readOnlyHint: true, openWorldHint: false };
const writesFile = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
let backend: Promise<MidiBackend> | undefined;
const midi = (): Promise<MidiBackend> => (backend ??= loadBackend().catch((error: unknown) => ((backend = undefined), Promise.reject(error))));
const portName = z.string().min(1).describe("The exact port name, as list_ports gives it.");
const id = z.string().describe("File name without .json: lower-case letters, digits and hyphens.");

server.registerTool(
  "catalog_list",
  { description: "List the devices of the catalog with the status of each capability (verified, unverified or refuted).", inputSchema: {}, annotations: readOnly },
  guard(() => store.deviceIds().map((d) => ({ id: d, name: store.device(d).name, capabilities: store.capabilityIndex()[d] }))),
);

server.registerTool(
  "catalog_get",
  { description: "One device of the catalog, with the evidence log of each capability.", inputSchema: { device: id }, annotations: readOnly },
  guard(({ device }: { device: string }) => store.device(device)),
);

server.registerTool(
  "profile_list",
  { description: "List the controller profiles in the workspace and whether each one is valid.", inputSchema: {}, annotations: readOnly },
  guard(() =>
    store.profileIds().map((p) => {
      const v = store.validate(store.profileRaw(p));
      return { id: p, ok: v.ok, errors: v.schemaErrors.length + v.findings.filter((f) => f.level === "error").length, warnings: v.findings.filter((f) => f.level === "warning").length };
    }),
  ),
);

server.registerTool(
  "profile_get",
  { description: "The JSON of one profile, as stored.", inputSchema: { profile: id }, annotations: readOnly },
  guard(({ profile }: { profile: string }) => store.profileRaw(profile)),
);

server.registerTool(
  "profile_validate",
  {
    description:
      "Check a profile against the schema and the lint (empty port masks, channel collisions with the Circuit's own tracks, unverified or refuted capabilities). Pass a stored profile's id, or the profile JSON itself to check a draft. Nothing is saved.",
    inputSchema: { profile: id.optional(), draft: z.unknown().optional().describe("A profile object to check instead of a stored one.") },
    annotations: readOnly,
  },
  guard(({ profile, draft }: { profile?: string | undefined; draft?: unknown }) => {
    if ((profile === undefined) === (draft === undefined)) throw new Error("Give exactly one of `profile` and `draft`.");
    return store.validate(profile === undefined ? draft : store.profileRaw(profile));
  }),
);

const profileBody = z.unknown().describe("The whole profile object (schema 1: name, 3 pages, 4 banks).");

server.registerTool(
  "profile_create",
  {
    description:
      "Store a new profile as profiles/<id>.json. Refuses an id that exists. A profile that fails the schema is not written; lint findings are returned with the result and block only firmware_build.",
    inputSchema: { id, profile: profileBody },
    annotations: writesFile,
  },
  guard(({ id: profileId, profile }: { id: string; profile?: unknown }) => store.saveProfile(profileId, profile, "create")),
);

server.registerTool(
  "profile_update",
  {
    description: "Replace a stored profile with the object given. The whole profile is replaced, so start from profile_get. Same checks as profile_create. The built-in `default` cannot be changed.",
    inputSchema: { id, profile: profileBody },
    annotations: { ...writesFile, destructiveHint: true },
  },
  guard(({ id: profileId, profile }: { id: string; profile?: unknown }) => store.saveProfile(profileId, profile, "update")),
);

server.registerTool(
  "profile_preview",
  {
    description: "A text grid of a stored profile, laid out like the panel (4 rows of 8 pads per page), with every pad and knob spelled out and marked verified or not.",
    inputSchema: { profile: id },
    annotations: readOnly,
  },
  guard(({ profile }: { profile: string }) => preview(store.profile(profile), store.capabilityIndex())),
);

server.registerTool(
  "firmware_build",
  {
    description:
      "Compile a stored profile and bake it into a CTL firmware image. Writes the .bin, the .syx, a manifest and a copy of the uploader page under out/<mark>/. It never sends anything to the device: installing is a manual step. Lint errors block the build; unverified capabilities block it unless allowUnverified is true.",
    inputSchema: { profile: id, allowUnverified: z.boolean().default(false) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ profile, allowUnverified }: { profile: string; allowUnverified: boolean }) => {
    try {
      return text(firmwareBuild(store, profile, allowUnverified));
    } catch (error) {
      if (error instanceof BuildBlocked) return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ blocked: error.message, findings: error.findings }, null, 2) }] };
      return failure(error);
    }
  },
);

server.registerTool(
  "firmware_inspect",
  { description: "Read a build from out/<mark>/ and show the profile that is inside the image, decoded from its bytes.", inputSchema: { mark: z.string().describe("The 6-character build mark, for example C1AB12.") }, annotations: readOnly },
  guard(({ mark }: { mark: string }) => firmwareInspect(store, mark)),
);

server.registerTool(
  "list_ports",
  { description: "List the MIDI input and output ports of this computer. Opens nothing and sends nothing.", inputSchema: {}, annotations: readOnly },
  guard(async () => listPorts(await midi())),
);

server.registerTool(
  "device_info",
  {
    description:
      "Ask the Circuit who it is. Sends exactly two messages to the port: the universal identity request and the 14-byte firmware version question. It changes nothing on the unit. Do not run it while firmware is being installed.",
    inputSchema: { port: portName },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  guard(async ({ port }: { port: string }) => deviceInfo(await midi(), port)),
);

server.registerTool(
  "midi_monitor",
  {
    description: `Listen to one MIDI input for up to ${LIMITS.monitorSecondsMax} seconds and return what arrived, in bytes and in words. Sends nothing. Clock and active sensing are only counted.`,
    inputSchema: { port: portName, seconds: z.number().positive().max(LIMITS.monitorSecondsMax).default(10) },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  guard(async ({ port, seconds }: { port: string; seconds: number }) => midiMonitor(await midi(), port, seconds)),
);

server.registerTool(
  "probe_send",
  {
    description: `Send up to ${LIMITS.probeMessages} test messages to an instrument so the owner can watch what it does: notes (each with its own note-off), control changes, start / stop / continue. Never SysEx or program change, never to a port named "Circuit". Needs confirm: true, which means the owner agreed to this exact list.`,
    inputSchema: {
      port: portName,
      messages: z.array(probeMessageSchema).min(1).max(LIMITS.probeMessages),
      confirm: z.boolean().default(false),
      holdMs: z.number().int().min(0).max(LIMITS.holdMsMax).default(200).describe("How long each note is held."),
      gapMs: z.number().int().min(0).max(LIMITS.gapMsMax).default(100).describe("The pause after each message."),
      listenPort: portName.optional().describe("An input to record while sending, to see what the instrument sends back."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  guard(async (args: ProbeArgs) => probeSend(await midi(), args)),
);

server.registerTool(
  "record_observation",
  {
    description:
      "Write down what the owner saw or heard a real device do, and set the capability's status from it: verified, refuted, or back to unverified. This is the only tool that changes a status. Record only what was actually observed on the hardware, never an expectation or something read in a manual.",
    inputSchema: {
      device: id,
      capability: z.string().min(1),
      status: z.enum(["verified", "unverified", "refuted"]),
      note: z.string().min(10).max(600).describe("What was sent and what the device did."),
      session: z.string().max(80).optional().describe("A name for the test session, to group observations."),
    },
    annotations: writesFile,
  },
  guard((o: { device: string; capability: string; status: "verified" | "unverified" | "refuted"; note: string; session?: string | undefined }) =>
    store.recordObservation(o, new Date().toISOString().slice(0, 10)),
  ),
);

await server.connect(new StdioServerTransport());
