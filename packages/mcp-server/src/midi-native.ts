/**
 * The real MIDI backend: CoreMIDI (and ALSA / WinMM) through the native module @julusian/midi, a maintained fork of node-midi.
 * The module is loaded by name at run time, so this file type-checks and the server starts without it; loadBackend() turns
 * a missing module into MidiUnavailable.
 */
import type { MidiBackend } from "./midi.ts";

/** The part of the module's API this backend uses. */
interface NativePort {
  getPortCount(): number;
  getPortName(index: number): string;
  openPort(index: number): void;
  closePort(): void;
}
interface NativeInput extends NativePort {
  ignoreTypes(sysex: boolean, timing: boolean, activeSensing: boolean): void;
  on(event: "message", listener: (deltaTime: number, message: number[]) => void): void;
  removeAllListeners(event?: string): void;
}
interface NativeOutput extends NativePort {
  sendMessage(message: number[]): void;
}
interface NativeModule {
  Input: new () => NativeInput;
  Output: new () => NativeOutput;
}

const MODULE = "@julusian/midi";

function names(port: NativePort): string[] {
  const out: string[] = [];
  for (let i = 0; i < port.getPortCount(); i++) out.push(port.getPortName(i));
  return out;
}

function indexOf(port: NativePort, name: string, kind: "input" | "output"): number {
  const i = names(port).indexOf(name);
  if (i < 0) throw new Error(`No MIDI ${kind} port named "${name}". Ports: ${names(port).join(", ") || "none"}`);
  return i;
}

export async function createNativeBackend(): Promise<MidiBackend> {
  const loaded = (await import(MODULE)) as NativeModule & { default?: NativeModule };
  const mod = loaded.default ?? loaded;
  // A probe object per listing: the module enumerates ports when it is created.
  const list = <T extends NativePort>(make: () => T): string[] => {
    const p = make();
    try {
      return names(p);
    } finally {
      p.closePort();
    }
  };
  return {
    kind: "native",
    inputs: () => list(() => new mod.Input()),
    outputs: () => list(() => new mod.Output()),
    send(port, bytes) {
      const out = new mod.Output();
      try {
        out.openPort(indexOf(out, port, "output"));
        out.sendMessage([...bytes]);
      } finally {
        out.closePort();
      }
    },
    listen(port, onMessage) {
      const input = new mod.Input();
      // SysEx in (device_info needs the replies); clock and active sensing out, so a monitor log stays readable.
      input.ignoreTypes(false, true, true);
      input.on("message", (_delta, message) => onMessage([...message]));
      input.openPort(indexOf(input, port, "input"));
      return () => {
        input.removeAllListeners("message");
        input.closePort();
      };
    },
  };
}
