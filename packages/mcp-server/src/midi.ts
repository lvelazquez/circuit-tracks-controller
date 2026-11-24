/**
 * The one door to MIDI ports. The tools only see this interface, so they can be tested with the fake backend.
 * The real backend is `midi-native.ts` (CoreMIDI through the native module @julusian/midi). Without that module every
 * MIDI tool fails with a clear message and the rest of the server keeps working.
 */
export interface MidiBackend {
  readonly kind: "fake" | "native";
  inputs(): string[];
  outputs(): string[];
  send(port: string, bytes: readonly number[]): void;
  /** Starts listening on an input port; the returned function stops and closes it. */
  listen(port: string, onMessage: (bytes: number[]) => void): () => void;
}

export class MidiUnavailable extends Error {}

/** Chosen by CTL_MIDI_BACKEND: "fake" = the scripted backend of `midi-fake.ts`; "none" = no MIDI at all; anything else = the native one, if its module is installed. */
export async function loadBackend(): Promise<MidiBackend> {
  const choice = process.env["CTL_MIDI_BACKEND"];
  if (choice === "fake") return (await import("./midi-fake.ts")).createFakeBackend();
  if (choice === "none") throw new MidiUnavailable("No MIDI backend: CTL_MIDI_BACKEND=none, so this tool cannot open a port. The catalog, profile and firmware tools do not need one.");
  try {
    return await (await import("./midi-native.ts")).createNativeBackend();
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND")
      throw new MidiUnavailable("No MIDI backend is installed in this workspace (npm install @julusian/midi -w packages/mcp-server), so this tool cannot open a port. The catalog, profile and firmware tools do not need one.");
    throw error;
  }
}

export const toHex = (bytes: readonly number[]): string => bytes.map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(" ");

const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const noteName = (n: number): string => `${NOTES[n % 12] ?? "?"}${Math.floor(n / 12) - 2}`;

/** A message in words, so a log can be read without a MIDI table. */
export function describe(bytes: readonly number[]): string {
  const [status = 0, d1 = 0, d2 = 0] = bytes;
  if (status === 0xf0) return `SysEx, ${bytes.length} bytes`;
  if (status >= 0xf8) return ({ 0xf8: "clock", 0xfa: "start", 0xfb: "continue", 0xfc: "stop", 0xfe: "active sensing", 0xff: "reset" } as Record<number, string>)[status] ?? "real-time";
  const ch = `ch ${(status & 0x0f) + 1}`;
  switch (status & 0xf0) {
    case 0x80:
      return `note off ${d1} (${noteName(d1)}), ${ch}`;
    case 0x90:
      return d2 === 0 ? `note off ${d1} (${noteName(d1)}), ${ch}` : `note on ${d1} (${noteName(d1)}) velocity ${d2}, ${ch}`;
    case 0xa0:
      return `poly pressure ${d1} = ${d2}, ${ch}`;
    case 0xb0:
      return `CC ${d1} = ${d2}, ${ch}`;
    case 0xc0:
      return `program ${d1}, ${ch}`;
    case 0xd0:
      return `channel pressure ${d1}, ${ch}`;
    case 0xe0:
      return `pitch bend ${((d2 << 7) | d1) - 8192}, ${ch}`;
    default:
      return "system message";
  }
}
