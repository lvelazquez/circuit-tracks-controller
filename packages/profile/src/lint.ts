import type { Profile } from "./schema.ts";

export type CapabilityStatus = "verified" | "unverified" | "refuted";
/** The part of the device catalog the lint needs: device id -> capability id -> status. */
export type CapabilityIndex = Readonly<Record<string, Readonly<Record<string, CapabilityStatus>>>>;

export type Finding = {
  level: "error" | "warning";
  code: "empty-ports" | "channel-collision" | "unverified-capability" | "refuted-capability" | "unknown-target" | "shift-yellow";
  where: string;
  message: string;
};

/** The channels the Circuit's own tracks use out of the box: Synth 1, Synth 2, MIDI 1, MIDI 2. */
export const CIRCUIT_DEFAULT_CHANNELS: readonly number[] = [1, 2, 3, 4];

type Item = { where: string; channel: number; ports: readonly string[]; colour: string; target?: { device: string; capability: string } | undefined };

function items(profile: Profile): Item[] {
  const pads = profile.pages.flatMap((page, g) => page.pads.map((p) => ({ ...p, where: `page ${g + 1} pad ${p.pad}` })));
  const knobs = profile.banks.flatMap((bank, b) => bank.knobs.map((k) => ({ ...k, where: `bank ${b + 1} knob ${k.knob}` })));
  return [...pads, ...knobs];
}

/**
 * Checks a valid profile for things the schema cannot know. An error blocks a firmware build;
 * an unverified capability is a warning here and the build tool decides whether to allow it.
 */
export function lint(profile: Profile, catalog: CapabilityIndex = {}): Finding[] {
  const out: Finding[] = [];
  for (const it of items(profile)) {
    if (it.ports.length === 0) {
      out.push({ level: "error", code: "empty-ports", where: it.where, message: "No output port: the firmware treats it as unassigned and sends nothing." });
    }
    if (CIRCUIT_DEFAULT_CHANNELS.includes(it.channel)) {
      out.push({ level: "warning", code: "channel-collision", where: it.where, message: `Channel ${it.channel} is a default channel of the Circuit's own tracks (decision D5).` });
    }
    if (it.colour === "yellow") {
      out.push({ level: "warning", code: "shift-yellow", where: it.where, message: "Yellow is the colour of Shift shortcuts on this firmware family." });
    }
    if (it.target) {
      const status = catalog[it.target.device]?.[it.target.capability];
      const name = `${it.target.device}.${it.target.capability}`;
      if (status === undefined) out.push({ level: "error", code: "unknown-target", where: it.where, message: `${name} is not in the device catalog.` });
      else if (status === "refuted") out.push({ level: "error", code: "refuted-capability", where: it.where, message: `${name} was tested and does not work.` });
      else if (status === "unverified") out.push({ level: "warning", code: "unverified-capability", where: it.where, message: `${name} has not been verified on the real device.` });
    }
  }
  return out;
}
