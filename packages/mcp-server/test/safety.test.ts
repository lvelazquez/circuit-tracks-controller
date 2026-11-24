import assert from "node:assert/strict";
import { test } from "node:test";
import { planProbe } from "../src/midi-tools.ts";
import { IDENTITY_REQUEST, SafetyError, checkIdentityMessage, checkProbe, checkProbeMessage, fwidRequest } from "../src/safety.ts";

test("device_info may send its two messages and nothing else", () => {
  checkIdentityMessage(IDENTITY_REQUEST);
  for (const seq of [0, 1, 0x7f]) checkIdentityMessage(fwidRequest(seq));
  assert.equal(fwidRequest(5).length, 14);
  const bad: number[][] = [
    [0xf0, 0x7d, 0x43, 0x54, 0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0xf7], // another command of the same family
    [0xf0, 0x7d, 0x43, 0x54, 0x00, 0, 0, 0, 0, 0, 0, 0, 1, 0xf7], // a non-zero argument
    [0xf0, 0x7d, 0x43, 0x54, 0x00, 0, 0xf7], // short
    [0xf0, 0x7e, 0x7f, 0x06, 0x02, 0xf7],
    [0xf0, 0x00, 0x20, 0x29, 0x00, 0x71, 0xf7], // a firmware update header
    [0x90, 60, 100],
    [],
  ];
  for (const b of bad) assert.throws(() => checkIdentityMessage(b), SafetyError);
});

test("a probe message is a note, a control change or start / stop / continue", () => {
  for (const ok of [[0x90, 60, 100], [0x8f, 0, 0], [0xb4, 20, 127], [0xb0, 123, 0], [0xfa], [0xfb], [0xfc]]) checkProbeMessage(ok);
  assert.throws(() => checkProbeMessage([0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7]), /SysEx/);
  assert.throws(() => checkProbeMessage([0xc0, 5]), /program change/);
  const bad: number[][] = [[0xe0, 0, 64], [0xa0, 60, 1], [0xd0, 9], [0xf8], [0xff], [0xf2, 0, 0], [0x90, 60], [0x90, 200, 1], [0x90, 60, 100, 0], [0xb0, 122, 0], [0xb0, 124, 0], [0xb0, 127, 0], [60, 1, 2], [], [0x90, 1.5, 3]];
  for (const b of bad) assert.throws(() => checkProbeMessage(b), SafetyError, JSON.stringify(b));
});

test("a probe never goes to the Circuit and never leaves a note or the transport on", () => {
  const note = [[0x90, 60, 100], [0x80, 60, 0]];
  checkProbe("Fake Synth", note);
  for (const port of ["Circuit Tracks MIDI", "circuit tracks", "USB CIRCUIT 2"]) assert.throws(() => checkProbe(port, note), /is the Circuit/);
  assert.throws(() => checkProbe("Fake Synth", [[0x90, 60, 100]]), /left sounding/);
  assert.throws(() => checkProbe("Fake Synth", [[0x90, 60, 100], [0x81, 60, 0]]), /left sounding/);
  checkProbe("Fake Synth", [[0x90, 60, 100], [0x90, 60, 0]]);
  assert.throws(() => checkProbe("Fake Synth", [[0xfa]]), /left running/);
  assert.throws(() => checkProbe("Fake Synth", [[0xfc], [0xfb]]), /left running/);
  checkProbe("Fake Synth", [[0xfa], [0xfc]]);
  assert.throws(() => checkProbe("Fake Synth", [...note, [0xc0, 1]]), /program change/);
});

test("planProbe gives every note its note-off", () => {
  const steps = planProbe([{ type: "note", channel: 5, note: 36, velocity: 90 }, { type: "cc", channel: 16, cc: 7, value: 1 }, { type: "start" }, { type: "stop" }], 50, 10);
  assert.deepEqual(steps, [
    { bytes: [0x94, 36, 90], waitAfterMs: 50 },
    { bytes: [0x84, 36, 0], waitAfterMs: 10 },
    { bytes: [0xbf, 7, 1], waitAfterMs: 10 },
    { bytes: [0xfa], waitAfterMs: 10 },
    { bytes: [0xfc], waitAfterMs: 10 },
  ]);
  checkProbe("Fake Synth", steps.map((s) => s.bytes));
});
