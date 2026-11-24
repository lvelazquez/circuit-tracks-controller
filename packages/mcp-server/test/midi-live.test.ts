import assert from "node:assert/strict";
import { test } from "node:test";
import { loadBackend } from "../src/midi.ts";

/** Real hardware: runs only with CTL_MIDI_LIVE=1, the native module installed and a Circuit Tracks on USB. Lists ports, sends nothing. */
const live = process.env["CTL_MIDI_LIVE"] === "1";

test("the native backend lists the Circuit Tracks ports", { skip: !live && "set CTL_MIDI_LIVE=1 with the unit plugged in" }, async () => {
  const saved = process.env["CTL_MIDI_BACKEND"];
  delete process.env["CTL_MIDI_BACKEND"];
  try {
    const midi = await loadBackend();
    assert.equal(midi.kind, "native");
    assert.ok(midi.inputs().some((p) => p.includes("Circuit Tracks")), `inputs: ${midi.inputs().join(", ")}`);
    assert.ok(midi.outputs().some((p) => p.includes("Circuit Tracks")), `outputs: ${midi.outputs().join(", ")}`);
  } finally {
    if (saved !== undefined) process.env["CTL_MIDI_BACKEND"] = saved;
  }
});
