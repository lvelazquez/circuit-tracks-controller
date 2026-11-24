import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createFakeBackend } from "../src/midi-fake.ts";
import { probeSend } from "../src/midi-tools.ts";
import type { MidiBackend } from "../src/midi.ts";

/** A copy of the workspace's profiles and catalog, so the tools that write never touch the real files. */
const real = join(import.meta.dirname, "../../..");
const root = mkdtempSync(join(tmpdir(), "ctl-ws-"));
const log = join(root, "sent.log");
cpSync(join(real, "profiles"), join(root, "profiles"), { recursive: true });
cpSync(join(real, "catalog"), join(root, "catalog"), { recursive: true });
const client = new Client({ name: "test", version: "0" });
const SYNTH = "Fake Synth";
const CIRCUIT = "Circuit Tracks MIDI";

const call = async (name: string, args: Record<string, unknown> = {}): Promise<{ isError: boolean; text: string }> => {
  const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: Array<{ type: string; text?: string }> };
  return { isError: r.isError === true, text: r.content[0]?.text ?? "" };
};
const sentLog = (): Array<{ port: string; bytes: number[] }> => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { port: string; bytes: number[] }) : []);
const read = (file: string): string => readFileSync(join(root, file), "utf8");

before(async () => {
  const env = { ...process.env, CTL_WORKSPACE: root, CTL_MIDI_BACKEND: "fake", CTL_FAKE_LOG: log } as Record<string, string>;
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(import.meta.dirname, "../src/server.ts")], env }));
});
after(async () => {
  await client.close();
  rmSync(root, { recursive: true, force: true });
});

test("profile_create and profile_update write one file and refuse what they should", async () => {
  const draft = JSON.parse((await call("profile_get", { profile: "default" })).text) as { name: string; pages: Array<{ pads: Array<Record<string, unknown>> }> };
  draft.name = "Rig";
  const made = JSON.parse((await call("profile_create", { id: "rig", profile: draft })).text) as { saved: boolean; ok: boolean; file: string };
  assert.deepEqual([made.saved, made.ok, made.file], [true, true, "profiles/rig.json"]);
  assert.equal((JSON.parse(read("profiles/rig.json")) as { name: string }).name, "Rig");
  assert.match((await call("profile_create", { id: "rig", profile: draft })).text, /already exists/);
  assert.match((await call("profile_update", { id: "nope", profile: draft })).text, /does not exist/);
  for (const reserved of ["default", "marks"]) assert.match((await call("profile_update", { id: reserved, profile: draft })).text, /reserved/);
  assert.equal((await call("profile_create", { id: "../x", profile: draft })).isError, true);

  // A profile that fails the schema is reported and the file stays as it was.
  const before = read("profiles/rig.json");
  const first = draft.pages[0]?.pads[0];
  assert.ok(first);
  first["channel"] = 99;
  const refused = JSON.parse((await call("profile_update", { id: "rig", profile: draft })).text) as { saved: boolean; schemaErrors: string[] };
  assert.equal(refused.saved, false);
  assert.match(refused.schemaErrors[0] ?? "", /pages\.0\.pads\.0\.channel/);
  assert.equal(read("profiles/rig.json"), before);

  // Lint findings come back with the result and do not block saving.
  first["channel"] = 1;
  first["target"] = { device: "bitbox-micro", capability: "pad_trigger" };
  const linted = JSON.parse((await call("profile_update", { id: "rig", profile: draft })).text) as { saved: boolean; findings: Array<{ code: string }> };
  assert.equal(linted.saved, true);
  assert.deepEqual(linted.findings.map((f) => f.code), ["channel-collision", "unverified-capability"]);
  assert.deepEqual((JSON.parse((await call("profile_list")).text) as Array<{ id: string }>).map((p) => p.id), ["default", "rig"]);
  assert.equal(existsSync(join(root, "profiles/rig.json.tmp")), false);
  assert.deepEqual(sentLog(), []);
});

test("list_ports and device_info: two fixed messages, and the build mark when the unit answers", async () => {
  assert.deepEqual(JSON.parse((await call("list_ports")).text), { backend: "fake", inputs: [CIRCUIT, SYNTH], outputs: [CIRCUIT, SYNTH] });
  const info = JSON.parse((await call("device_info", { port: CIRCUIT })).text) as { identity: { novation: boolean; manufacturer: string }; buildMark: string | null; note: string };
  assert.deepEqual([info.identity.novation, info.identity.manufacturer, info.buildMark], [true, "00 20 29", null]);
  assert.match(info.note, /stock firmware/);
  const sent = sentLog();
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0], { port: CIRCUIT, bytes: [0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7] });
  assert.equal(sent[1]?.bytes.length, 14);
  assert.deepEqual(sent[1]?.bytes.filter((_, i) => i !== 5), [0xf0, 0x7d, 0x43, 0x54, 0x00, 0, 0, 0, 0, 0, 0, 0, 0xf7]);
  assert.equal((await call("device_info", { port: "Nothing" })).isError, true);
});

test("probe_send: confirm, the allowlist, automatic note-offs, and what came back", async () => {
  writeFileSync(log, "");
  const messages = [{ type: "note", channel: 5, note: 36 }, { type: "cc", channel: 10, cc: 20, value: 64 }];
  assert.match((await call("probe_send", { port: SYNTH, messages })).text, /confirm: true/);
  assert.match((await call("probe_send", { port: CIRCUIT, messages, confirm: true })).text, /is the Circuit/);
  assert.match((await call("probe_send", { port: SYNTH, messages: [{ type: "start" }], confirm: true })).text, /left running/);
  assert.equal((await call("probe_send", { port: SYNTH, messages: [{ type: "program", channel: 1, program: 2 }], confirm: true })).isError, true);
  assert.equal((await call("probe_send", { port: SYNTH, messages: Array.from({ length: 21 }, () => ({ type: "stop" })), confirm: true })).isError, true);
  assert.equal((await call("probe_send", { port: "Nothing", messages, confirm: true })).isError, true);
  assert.deepEqual(sentLog(), []);

  const r = JSON.parse((await call("probe_send", { port: SYNTH, messages, confirm: true, holdMs: 20, gapMs: 5, listenPort: SYNTH })).text) as { sent: Array<{ hex: string; text: string }>; heard: Array<{ hex: string }> };
  assert.deepEqual(r.sent.map((s) => s.hex), ["94 24 64", "84 24 00", "B9 14 40"]);
  assert.equal(r.sent[0]?.text, "note on 36 (C1) velocity 100, ch 5");
  assert.deepEqual(r.heard.map((s) => s.hex), ["94 24 64", "84 24 00", "B9 14 40"]);
  assert.deepEqual(sentLog().map((s) => s.port), [SYNTH, SYNTH, SYNTH]);
});

test("a probe that breaks half-way still sends the note-off and the stop", async () => {
  const inner = createFakeBackend();
  const out: number[][] = [];
  let calls = 0;
  const flaky: MidiBackend = { ...inner, send: (_port, bytes) => (++calls === 3 ? assert.fail("port lost") : void out.push([...bytes])) };
  await assert.rejects(probeSend(flaky, { port: SYNTH, messages: [{ type: "start" }, { type: "note", channel: 1, note: 60, velocity: 100 }, { type: "cc", channel: 1, cc: 1, value: 1 }, { type: "stop" }], confirm: true, holdMs: 1, gapMs: 1 }), /port lost/);
  // The third send (the note-off) fails; the clean-up sends it again and then the stop, and skips the control change.
  assert.deepEqual(out, [[0xfa], [0x90, 60, 100], [0x80, 60, 0], [0xfc]]);
});

test("midi_monitor only listens", async () => {
  writeFileSync(log, "");
  const [m] = await Promise.all([
    call("midi_monitor", { port: SYNTH, seconds: 0.4 }),
    new Promise((r) => setTimeout(r, 100)).then(() => call("probe_send", { port: SYNTH, messages: [{ type: "cc", channel: 2, cc: 7, value: 9 }], confirm: true })),
  ]);
  const seen = JSON.parse(m.text) as { messages: Array<{ text: string }>; truncated: boolean };
  assert.deepEqual(seen.messages.map((x) => x.text), ["CC 7 = 9, ch 2"]);
  assert.equal(sentLog().length, 1);
  assert.equal((await call("midi_monitor", { port: SYNTH, seconds: 61 })).isError, true);
});

test("record_observation is what changes a capability's status", async () => {
  const args = { device: "hermod-plus", capability: "mute", status: "verified", note: "CC 20 = 127 on channel 9 muted track 1; 0 unmuted it.", session: "test" };
  const device = JSON.parse((await call("record_observation", args)).text) as { capabilities: Record<string, { status: string; evidence: Array<{ note: string; date: string; session?: string }> }> };
  assert.equal(device.capabilities["mute"]?.status, "verified");
  assert.match(device.capabilities["mute"]?.evidence.at(-1)?.note ?? "", /^\[verified\] CC 20/);
  assert.match(device.capabilities["mute"]?.evidence.at(-1)?.date ?? "", /^\d{4}-\d\d-\d\d$/);
  assert.equal(device.capabilities["transport"]?.status, "unverified");
  await call("record_observation", { ...args, status: "refuted", note: "On a second try the mute did not follow the CC." });
  const stored = JSON.parse(read("catalog/devices/hermod-plus.json")) as typeof device;
  assert.deepEqual([stored.capabilities["mute"]?.status, stored.capabilities["mute"]?.evidence.length], ["refuted", 3]);
  assert.equal((await call("record_observation", { ...args, capability: "nope" })).isError, true);
  assert.equal((await call("record_observation", { ...args, note: "ok" })).isError, true);
  assert.equal((await call("record_observation", { ...args, device: "../x" })).isError, true);
  // The real workspace was never touched.
  assert.equal(JSON.parse(readFileSync(join(real, "catalog/devices/hermod-plus.json"), "utf8")).capabilities.mute.status, "unverified");
});
