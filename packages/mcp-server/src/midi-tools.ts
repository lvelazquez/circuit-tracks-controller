import { z } from "zod";
import { describe, toHex } from "./midi.ts";
import type { MidiBackend } from "./midi.ts";
import { IDENTITY_REQUEST, LIMITS, SafetyError, checkIdentityMessage, checkProbe, fwidRequest } from "./safety.ts";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const channel = z.number().int().min(1).max(16);
const data7 = z.number().int().min(0).max(127);

function need(ports: string[], port: string, what: string): void {
  if (!ports.includes(port)) throw new Error(`There is no ${what} port named "${port}". Ports: ${ports.join(", ") || "none"}.`);
}

export function listPorts(midi: MidiBackend): { backend: string; inputs: string[]; outputs: string[] } {
  return { backend: midi.kind, inputs: midi.inputs(), outputs: midi.outputs() };
}

export type DeviceInfo = { port: string; identity: { hex: string; manufacturer: string; novation: boolean } | null; buildMark: string | null; note: string };

/**
 * Asks the unit who it is. Sends two messages and nothing else: the universal identity request and the fwid version question.
 * Both pass `checkIdentityMessage` first. A stock unit answers the first and stays silent on the second.
 */
export async function deviceInfo(midi: MidiBackend, port: string, waitMs = 400): Promise<DeviceInfo> {
  need(midi.outputs(), port, "output");
  need(midi.inputs(), port, "input");
  const heard: number[][] = [];
  const stop = midi.listen(port, (bytes) => heard.push(bytes));
  try {
    const seq = Math.floor(Math.random() * 0x80);
    for (const message of [[...IDENTITY_REQUEST], fwidRequest(seq)]) {
      checkIdentityMessage(message);
      midi.send(port, message);
      await sleep(waitMs);
    }
    const id = heard.find((m) => m[0] === 0xf0 && m[1] === 0x7e && m[3] === 0x06 && m[4] === 0x02);
    const fw = heard.find((m) => m.length === 14 && m[0] === 0xf0 && m[1] === 0x7d && m[2] === 0x43 && m[3] === 0x54 && m[4] === 0x40 && m[5] === seq);
    const manufacturer = id ? toHex(id[5] === 0 ? id.slice(5, 8) : id.slice(5, 6)) : "";
    const buildMark = fw ? new TextDecoder().decode(new Uint8Array(fw.slice(7, 13))).trim() : null;
    return {
      port,
      identity: id ? { hex: toHex(id), manufacturer, novation: manufacturer === "00 20 29" } : null,
      buildMark,
      note: buildMark
        ? "The unit runs a build that answers the version question."
        : "No answer to the version question: stock firmware, or a build without the identity reply (CTL builds have none yet, decision D8).",
    };
  } finally {
    stop();
  }
}

export type Heard = { ms: number; hex: string; text: string };
export type MonitorResult = { port: string; seconds: number; messages: Heard[]; clockTicks: number; activeSensing: number; truncated: boolean };

/** Listens to one input for a fixed time. It sends nothing. Clock and active sensing are counted, not listed. */
export async function midiMonitor(midi: MidiBackend, port: string, seconds: number): Promise<MonitorResult> {
  if (!(seconds > 0 && seconds <= LIMITS.monitorSecondsMax)) throw new Error(`seconds must be above 0 and at most ${LIMITS.monitorSecondsMax}`);
  need(midi.inputs(), port, "input");
  const result: MonitorResult = { port, seconds, messages: [], clockTicks: 0, activeSensing: 0, truncated: false };
  const t0 = performance.now();
  const stop = midi.listen(port, (bytes) => {
    if (bytes[0] === 0xf8) result.clockTicks++;
    else if (bytes[0] === 0xfe) result.activeSensing++;
    else if (result.messages.length >= LIMITS.monitorMessagesMax) result.truncated = true;
    else result.messages.push({ ms: Math.round(performance.now() - t0), hex: toHex(bytes), text: describe(bytes) });
  });
  try {
    await sleep(seconds * 1000);
  } finally {
    stop();
  }
  return result;
}

export const probeMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("note"), channel, note: data7, velocity: z.number().int().min(1).max(127).default(100) }).strict(),
  z.object({ type: z.literal("cc"), channel, cc: data7, value: data7 }).strict(),
  z.object({ type: z.enum(["start", "continue", "stop"]) }).strict(),
]);
export type ProbeMessage = z.infer<typeof probeMessageSchema>;

type Step = { bytes: number[]; waitAfterMs: number };

/** The exact bytes and waits of a probe. A note is always its note-on, the hold, then its note-off. */
export function planProbe(messages: readonly ProbeMessage[], holdMs: number, gapMs: number): Step[] {
  const steps: Step[] = [];
  for (const m of messages) {
    if (m.type === "note") {
      steps.push({ bytes: [0x90 | (m.channel - 1), m.note, m.velocity], waitAfterMs: holdMs });
      steps.push({ bytes: [0x80 | (m.channel - 1), m.note, 0], waitAfterMs: gapMs });
    } else if (m.type === "cc") {
      steps.push({ bytes: [0xb0 | (m.channel - 1), m.cc, m.value], waitAfterMs: gapMs });
    } else {
      steps.push({ bytes: [{ start: 0xfa, continue: 0xfb, stop: 0xfc }[m.type]], waitAfterMs: gapMs });
    }
  }
  return steps;
}

export type ProbeArgs = { port: string; messages: ProbeMessage[]; confirm: boolean; holdMs: number; gapMs: number; listenPort?: string | undefined };
export type ProbeResult = { port: string; sent: Heard[]; heard: Heard[] | null; note: string };

/**
 * Sends a short, fixed list of test messages to an instrument (never to the Circuit) so the owner can watch what it does.
 * The whole list passes `checkProbe` before the first byte goes out. If sending fails half-way, the pending note-offs
 * and a stop are still sent.
 */
export async function probeSend(midi: MidiBackend, args: ProbeArgs): Promise<ProbeResult> {
  if (!args.confirm) throw new SafetyError("probe_send sends MIDI to a real instrument: pass confirm: true once the owner has agreed to this exact list.");
  if (args.messages.length < 1 || args.messages.length > LIMITS.probeMessages) throw new SafetyError(`a probe is 1 to ${LIMITS.probeMessages} messages`);
  if (!(args.holdMs >= 0 && args.holdMs <= LIMITS.holdMsMax && args.gapMs >= 0 && args.gapMs <= LIMITS.gapMsMax)) {
    throw new SafetyError(`holdMs is at most ${LIMITS.holdMsMax} and gapMs at most ${LIMITS.gapMsMax}`);
  }
  const steps = planProbe(args.messages, args.holdMs, args.gapMs);
  checkProbe(args.port, steps.map((s) => s.bytes));
  need(midi.outputs(), args.port, "output");
  if (args.listenPort !== undefined) need(midi.inputs(), args.listenPort, "input");
  const t0 = performance.now();
  const stamp = (bytes: readonly number[]): Heard => ({ ms: Math.round(performance.now() - t0), hex: toHex(bytes), text: describe(bytes) });
  const heard: Heard[] = [];
  const stop = args.listenPort === undefined ? undefined : midi.listen(args.listenPort, (bytes) => bytes[0] !== 0xf8 && bytes[0] !== 0xfe && heard.push(stamp(bytes)));
  const sent: Heard[] = [];
  let done = 0;
  try {
    for (const step of steps) {
      midi.send(args.port, step.bytes);
      sent.push(stamp(step.bytes));
      done++;
      await sleep(step.waitAfterMs);
    }
  } finally {
    // Whatever was not sent and only ends something (a note-off, a stop) still goes out.
    for (const step of steps.slice(done)) {
      const status = step.bytes[0] ?? 0;
      if ((status & 0xf0) !== 0x80 && status !== 0xfc) continue;
      try {
        midi.send(args.port, step.bytes);
        sent.push(stamp(step.bytes));
      } catch {
        // The port is gone; there is nothing more to do.
      }
    }
    stop?.();
  }
  return { port: args.port, sent, heard: stop ? heard : null, note: "Sent. What the instrument did has to be seen or heard by the owner; record it with record_observation." };
}
