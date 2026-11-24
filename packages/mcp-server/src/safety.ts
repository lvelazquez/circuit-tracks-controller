/**
 * The allowlist every outgoing MIDI message must pass. Two senders exist and each has its own rule:
 *  - `device_info` may send exactly two messages, byte for byte: the universal identity request and the 14-byte fwid request;
 *  - `probe_send` may send note on / off, control change and start / stop / continue, never to a port named "Circuit".
 * Everything else is refused: SysEx, program change, pitch bend, pressure, clock, the channel-mode controllers.
 * Nothing here opens a port; these are pure checks, so they can be tested without a device.
 */
export class SafetyError extends Error {}

export const LIMITS = { probeMessages: 20, holdMsMax: 2000, gapMsMax: 1000, monitorSecondsMax: 60, monitorMessagesMax: 500 } as const;

const CIRCUIT_PORT = /circuit/i;
/** Local control, omni off / on, mono, poly: they change how the receiver listens, so a probe must not send them. */
const MODE_CONTROLLERS: readonly number[] = [122, 124, 125, 126, 127];

export const IDENTITY_REQUEST: readonly number[] = [0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7];
/** The version question of `tools/fwid.py`: F0 7D 43 54 00 seq, seven zeros, F7. A stock unit does not answer it. */
export const fwidRequest = (seq: number): number[] => [0xf0, 0x7d, 0x43, 0x54, 0x00, seq & 0x7f, 0, 0, 0, 0, 0, 0, 0, 0xf7];

const hex = (bytes: readonly number[]): string => bytes.map((b) => b.toString(16).padStart(2, "0")).join(" ");
const same = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

export function isCircuitPort(port: string): boolean {
  return CIRCUIT_PORT.test(port);
}

/** The only two messages that may go to the Circuit itself. */
export function checkIdentityMessage(bytes: readonly number[]): void {
  if (same(bytes, IDENTITY_REQUEST)) return;
  const seq = bytes[5];
  if (bytes.length === 14 && seq !== undefined && seq < 0x80 && same(bytes, fwidRequest(seq))) return;
  throw new SafetyError(`device_info may only send the identity request and the fwid request, not: ${hex(bytes)}`);
}

export function checkProbeMessage(bytes: readonly number[]): void {
  const status = bytes[0];
  if (status === undefined || !bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 0xff)) throw new SafetyError("an empty or malformed message");
  if (bytes.length === 1 && (status === 0xfa || status === 0xfb || status === 0xfc)) return;
  if (status === 0xf0 || bytes.includes(0xf7)) throw new SafetyError(`a probe never sends SysEx: ${hex(bytes)}`);
  const kind = status & 0xf0;
  if (kind === 0xc0) throw new SafetyError(`a probe never sends a program change: ${hex(bytes)}`);
  if (kind !== 0x80 && kind !== 0x90 && kind !== 0xb0) throw new SafetyError(`a probe only sends notes, control changes and start / stop / continue: ${hex(bytes)}`);
  const [, d1, d2] = bytes;
  if (bytes.length !== 3 || d1 === undefined || d2 === undefined || d1 > 127 || d2 > 127) throw new SafetyError(`a malformed channel message: ${hex(bytes)}`);
  if (kind === 0xb0 && MODE_CONTROLLERS.includes(d1)) throw new SafetyError(`controller ${d1} changes the receiver's mode: ${hex(bytes)}`);
}

/** The whole list a probe is about to send, in order, with the port it goes to. Throws on the first thing that is not allowed. */
export function checkProbe(port: string, messages: readonly (readonly number[])[]): void {
  if (isCircuitPort(port)) throw new SafetyError(`"${port}" is the Circuit: a probe never sends to it.`);
  for (const m of messages) checkProbeMessage(m);
  const held = new Set<number>();
  let running = false;
  for (const m of messages) {
    const [status = 0, d1 = 0, d2 = 0] = m;
    const key = ((status & 0x0f) << 8) | d1;
    if ((status & 0xf0) === 0x90 && d2 > 0) held.add(key);
    else if ((status & 0xf0) === 0x80 || (status & 0xf0) === 0x90) held.delete(key);
    else if (status === 0xfa || status === 0xfb) running = true;
    else if (status === 0xfc) running = false;
  }
  if (held.size) throw new SafetyError("a note would be left sounding: every note-on needs its note-off.");
  if (running) throw new SafetyError("the transport would be left running: a start or continue needs a later stop.");
}
