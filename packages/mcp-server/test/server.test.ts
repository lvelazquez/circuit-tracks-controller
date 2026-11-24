import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { preview } from "../src/preview.ts";
import { Store } from "../src/store.ts";

const root = join(import.meta.dirname, "../../..");
const store = new Store(root);
const client = new Client({ name: "test", version: "0" });

const call = async (name: string, args: Record<string, unknown> = {}): Promise<{ isError: boolean; text: string }> => {
  const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: Array<{ type: string; text?: string }> };
  return { isError: r.isError === true, text: r.content[0]?.text ?? "" };
};

before(async () => {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(import.meta.dirname, "../src/server.ts")], env: { ...process.env, CTL_WORKSPACE: root, CTL_MIDI_BACKEND: "none" } as Record<string, string> }));
});
after(async () => {
  await client.close();
});

test("the store reads the catalog and the default profile; every capability starts unverified", () => {
  assert.deepEqual(store.deviceIds(), ["bitbox-micro", "hermod-plus"]);
  assert.deepEqual(Object.keys(store.device("hermod-plus").capabilities), ["note_in", "cc_to_cv", "mute", "pattern_select", "transport"]);
  assert.ok(Object.values(store.capabilityIndex()).every((d) => Object.values(d).every((s) => s === "unverified")));
  assert.deepEqual(store.validate(store.profileRaw("default")), { ok: true, schemaErrors: [], findings: [], slotBytes: 1024 });
});

test("ids cannot leave the workspace folders", () => {
  for (const bad of ["../package", "a/b", "", "Default", "x.json"]) assert.throws(() => store.profileRaw(bad), /not a valid id/);
  assert.throws(() => store.profileRaw("missing"), /does not exist/);
});

test("the preview is a 4 x 8 grid per page and says everything in text", () => {
  const p = store.profile("default");
  p.pages[1]?.pads.push({ pad: 9, type: "cc_toggle", channel: 9, cc: 20, on: 127, off: 0, ports: ["din"], colour: "teal", label: "Mute 1", target: { device: "hermod-plus", capability: "mute" } });
  const out = preview(p, store.capabilityIndex());
  assert.match(out, /Page 1: Notes \(selects bank 1\)\n {2}N 36c 5 {3}N 37c 5/);
  assert.match(out, /\n {2}· {8} · {8}/);
  assert.match(out, /T 20c 9\?/);
  assert.match(out, /pad {2}9 {2}Mute 1 +CC 20: 127 \/ 0 in turn, ch 9 → din, teal \[hermod-plus\.mute: unverified\]/);
  assert.equal(out.split("\n").filter((l) => /^ {2}[NFMTP·]/.test(l)).length, 12);
});

test("the server lists its tools; the ones that write or send say so", async () => {
  const { tools } = await client.listTools();
  const names = ["catalog_get", "catalog_list", "device_info", "firmware_build", "firmware_inspect", "list_ports", "midi_monitor", "probe_send", "profile_create", "profile_get", "profile_list", "profile_preview", "profile_update", "profile_validate", "record_observation"];
  assert.deepEqual(tools.map((t) => t.name).sort(), names);
  assert.deepEqual(tools.filter((t) => t.annotations?.readOnlyHint !== true).map((t) => t.name).sort(), ["firmware_build", "probe_send", "profile_create", "profile_update", "record_observation"]);
});

test("without a MIDI backend only the MIDI tools fail", async () => {
  const r = await call("list_ports");
  assert.equal(r.isError, true);
  assert.match(r.text, /No MIDI backend/);
  assert.equal((await call("probe_send", { port: "Fake Synth", messages: [{ type: "stop" }], confirm: true })).isError, true);
  assert.equal((await call("catalog_list")).isError, false);
});

test("the tools answer over stdio", async () => {
  assert.deepEqual(JSON.parse((await call("profile_list")).text), [{ id: "default", ok: true, errors: 0, warnings: 0 }]);
  assert.equal(JSON.parse((await call("catalog_get", { device: "bitbox-micro" })).text).name, "1010music Bitbox Micro");
  assert.equal(JSON.parse((await call("catalog_list")).text).length, 2);
  assert.match((await call("profile_preview", { profile: "default" })).text, /^Default\n/);
  assert.equal(JSON.parse((await call("profile_get", { profile: "default" })).text).pages.length, 3);
  const draft = JSON.parse((await call("profile_get", { profile: "default" })).text);
  draft.pages[0].pads[0].ports = [];
  draft.pages[0].pads[1].channel = 99;
  const bad = JSON.parse((await call("profile_validate", { draft })).text);
  assert.equal(bad.ok, false);
  assert.match(bad.schemaErrors[0], /pages\.0\.pads\.1\.channel/);
  draft.pages[0].pads[1].channel = 1;
  const linted = JSON.parse((await call("profile_validate", { draft })).text);
  assert.deepEqual(linted.findings.map((f: { code: string }) => f.code), ["empty-ports", "channel-collision"]);
  assert.equal(linted.ok, false);
});

test("a bad request is an error result, not a crash", async () => {
  assert.equal((await call("profile_get", { profile: "../package" })).isError, true);
  assert.equal((await call("profile_validate", {})).isError, true);
  assert.equal((await call("profile_list")).isError, false);
});

test("firmware_build bakes the default profile and firmware_inspect reads it back", { skip: !existsSync(join(root, "local.config.json")), timeout: 120_000 }, async () => {
  const built = await call("firmware_build", { profile: "default" });
  assert.equal(built.isError, false, built.text);
  const b = JSON.parse(built.text) as { mark: string; files: string[]; directory: string; syxSha256: string };
  assert.match(b.mark, /^C1[0-9A-Z]{4}$/);
  assert.deepEqual(b.files.filter((f) => !f.startsWith("circuittracks")), ["ct_uploader.html", "manifest.json", "profile.json"]);
  assert.ok(readFileSync(join(b.directory, "ct_uploader.html"), "utf8").includes(b.syxSha256));
  assert.equal((JSON.parse(readFileSync(join(root, "profiles/marks.json"), "utf8")) as Record<string, string>)[b.mark]?.length, 64);
  const again = JSON.parse((await call("firmware_build", { profile: "default" })).text) as { mark: string; syxSha256: string };
  assert.deepEqual([again.mark, again.syxSha256], [b.mark, b.syxSha256]);
  const seen = JSON.parse((await call("firmware_inspect", { mark: b.mark })).text) as { profile: { pages: Array<{ pads: unknown[] }> }; preview: string };
  assert.equal(seen.profile.pages[0]?.pads.length, 32);
  assert.match(seen.preview, /N 36c 5/);
  assert.equal((await call("firmware_inspect", { mark: "../x" })).isError, true);
});
