import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BODY_LENGTH, LAYOUT, TemplateError, checkSlot, compile, crc32, decode, layoutJson, lint, parseProfile } from "../src/index.ts";
import type { Profile } from "../src/index.ts";

const root = join(import.meta.dirname, "../../..");
const read = (p: string): Uint8Array => new Uint8Array(readFileSync(join(root, p)));
const defaultProfile = (): Profile => parseProfile(JSON.parse(readFileSync(join(root, "profiles/default.json"), "utf8")));
const clone = (p: Profile): any => structuredClone(p);

test("crc32 matches zlib", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("the default profile compiles to the firmware's default template, byte for byte", () => {
  assert.deepEqual(compile(defaultProfile()), read("fixtures/templates/default.bin"));
});

test("a template written by the firmware's own tests decodes, and the profile survives a compile and decode", () => {
  const blob = read("fixtures/templates/paged.bin");
  const profile = decode(blob);
  assert.equal(profile.pages[2]?.bankOnEnter, null);
  assert.equal(profile.banks[1]?.knobs.length, 8);
  // That blob sets bytes its pad types do not use (a gate note's v_on); compile writes those as 0, so the bytes differ and the profile does not.
  const again = compile(profile);
  assert.deepEqual(decode(again), profile);
  assert.deepEqual(compile(decode(again)), again);
});

test("same profile in, same bytes out; the slot is 1024 bytes with the body where the layout says", () => {
  const a = compile(defaultProfile());
  assert.deepEqual(a, compile(defaultProfile()));
  assert.equal(a.length, LAYOUT.slotLength);
  assert.equal(checkSlot(a).length, BODY_LENGTH);
  assert.ok(a.subarray(LAYOUT.headerLength + BODY_LENGTH).every((b) => b === 0xff));
});

test("a damaged slot is refused", () => {
  const a = compile(defaultProfile());
  for (const i of [0, 4, 8, 12, 500]) {
    const b = a.slice();
    b[i] = (b[i] ?? 0) ^ 1;
    assert.throws(() => checkSlot(b), TemplateError, `byte ${i}`);
  }
  assert.throws(() => checkSlot(a.subarray(0, 1000)), TemplateError);
});

test("the schema refuses what the firmware cannot hold", () => {
  const bad: Array<(p: any) => void> = [
    (p) => (p.pages[0].pads[0].channel = 17),
    (p) => (p.pages[0].pads[0].note = 128),
    (p) => (p.pages[0].pads[1].pad = 1),
    (p) => (p.pages[0].pads[0].colour = "#ff0000"),
    (p) => (p.pages[0].bankOnEnter = 5),
    (p) => p.pages.pop(),
    (p) => p.banks[0].knobs.push({ knob: 1, channel: 1, cc: 7, min: 90, max: 10, ports: ["usb"], colour: "blue" }),
    (p) => (p.pages[0].pads[0] = { pad: 1, type: "note_fixed", channel: 1, note: 60, velocity: 0, ports: ["usb"], colour: "blue" }),
    (p) => (p.pages[0].pads[0].extra = true),
  ];
  bad.forEach((change, i) => {
    const p = clone(defaultProfile());
    change(p);
    assert.throws(() => parseProfile(p), `case ${i}`);
  });
});

test("lint: empty ports, channel collisions, yellow, and the catalog status of a target", () => {
  const p = clone(defaultProfile());
  assert.deepEqual(lint(defaultProfile()), []);
  p.pages[0].pads[0].ports = [];
  p.pages[0].pads[1].channel = 2;
  p.pages[0].pads[2].colour = "yellow";
  p.pages[0].pads[3].target = { device: "bitbox-micro", capability: "pad_trigger" };
  p.pages[0].pads[4].target = { device: "bitbox-micro", capability: "mod_cc" };
  p.pages[0].pads[5].target = { device: "nope", capability: "x" };
  p.banks[0].knobs.push({ knob: 1, channel: 9, cc: 7, ports: ["din"], colour: "blue", target: { device: "bitbox-micro", capability: "gone" } });
  const found = lint(parseProfile(p), { "bitbox-micro": { pad_trigger: "verified", mod_cc: "unverified", gone: "refuted" } });
  assert.deepEqual(
    found.map((f) => [f.level, f.code, f.where]),
    [
      ["error", "empty-ports", "page 1 pad 1"],
      ["warning", "channel-collision", "page 1 pad 2"],
      ["warning", "shift-yellow", "page 1 pad 3"],
      ["warning", "unverified-capability", "page 1 pad 5"],
      ["error", "unknown-target", "page 1 pad 6"],
      ["error", "refuted-capability", "bank 1 knob 1"],
    ],
  );
});

test("the fork agrees: its layout is this one, and it accepts a compiled blob", { skip: !existsSync(join(root, "local.config.json")) }, () => {
  const cfg = JSON.parse(readFileSync(join(root, "local.config.json"), "utf8")) as { forkPath: string; python: string };
  const dir = mkdtempSync(join(tmpdir(), "ctl-"));
  writeFileSync(join(dir, "layout.json"), JSON.stringify(layoutJson()));
  const p = clone(defaultProfile());
  p.pages[1].pads.push({ pad: 7, type: "cc_toggle", channel: 9, cc: 20, on: 127, off: 0, ports: ["din"], colour: "teal" });
  p.pages[2].bankOnEnter = null;
  p.banks[3].knobs.push({ knob: 8, channel: 16, cc: 74, min: 10, max: 100, ports: ["usb", "out2"], colour: "violet" });
  writeFileSync(join(dir, "tpl.bin"), compile(parseProfile(p)));
  const tool = join(cfg.forkPath, "tools/ctl_template.py");
  for (const args of [["layout", join(dir, "layout.json")], ["validate", join(dir, "tpl.bin")]]) {
    assert.match(execFileSync(cfg.python, [tool, ...args], { encoding: "utf8" }), /: ok\n$/);
  }
});
