import { appendFileSync } from "node:fs";
import type { MidiBackend } from "./midi.ts";

/**
 * A scripted stand-in for real ports, used by the tests (CTL_MIDI_BACKEND=fake). No hardware is involved.
 *  - "Fake Synth" echoes everything it is sent back on its input.
 *  - "Circuit Tracks MIDI" answers the identity request and, if CTL_FAKE_MARK is set, the fwid request.
 * Every sent message is appended to the file named by CTL_FAKE_LOG, so a test can see exactly what went out.
 */
const PORTS = ["Circuit Tracks MIDI", "Fake Synth"];
const IDENTITY_REPLY = [0xf0, 0x7e, 0x00, 0x06, 0x02, 0x00, 0x20, 0x29, 0x64, 0x00, 0x00, 0x00, 0x01, 0x02, 0x01, 0x00, 0xf7];

export function createFakeBackend(): MidiBackend {
  const listeners = new Map<string, Set<(bytes: number[]) => void>>();
  const emit = (port: string, bytes: number[]): void => {
    queueMicrotask(() => listeners.get(port)?.forEach((fn) => fn(bytes)));
  };
  const known = (port: string): void => {
    if (!PORTS.includes(port)) throw new Error(`there is no port named "${port}"`);
  };
  return {
    kind: "fake",
    inputs: () => [...PORTS],
    outputs: () => [...PORTS],
    send(port, bytes) {
      known(port);
      const log = process.env["CTL_FAKE_LOG"];
      if (log) appendFileSync(log, `${JSON.stringify({ port, bytes })}\n`);
      if (port === "Fake Synth") return emit(port, [...bytes]);
      if (bytes[1] === 0x7e) return emit(port, IDENTITY_REPLY);
      const mark = process.env["CTL_FAKE_MARK"];
      if (bytes[1] === 0x7d && mark) emit(port, [0xf0, 0x7d, 0x43, 0x54, 0x40, bytes[5] ?? 0, 0x01, ...new TextEncoder().encode(mark.padEnd(6).slice(0, 6)), 0xf7]);
    },
    listen(port, onMessage) {
      known(port);
      const set = listeners.get(port) ?? new Set();
      listeners.set(port, set);
      set.add(onMessage);
      return () => void set.delete(onMessage);
    },
  };
}
