import { crc32 } from "./crc32.ts";
import { BODY_LENGTH, COLOURS, KNOBS_OFFSET, LAYOUT, META_OFFSET, PADS_OFFSET, PAD_TYPE, PORTS } from "./layout.ts";
import type { Colour, Port } from "./layout.ts";
import type { Knob, Pad, Profile } from "./schema.ts";

export const portMask = (ports: readonly Port[]): number => ports.reduce((m, p) => m | (1 << PORTS.indexOf(p)), 0);
export const colourIndex = (c: Colour): number => COLOURS.indexOf(c);

function padRecord(p: Pad): number[] {
  const head = [PAD_TYPE[p.type], p.channel - 1];
  const tail = [portMask(p.ports), colourIndex(p.colour), 0];
  switch (p.type) {
    case "note_gate":
      return [...head, p.note, 0, 0, ...tail];
    case "note_fixed":
      return [...head, p.note, p.velocity, 0, ...tail];
    case "cc_momentary":
    case "cc_toggle":
      return [...head, p.cc, p.on, p.off, ...tail];
    case "program":
      return [...head, p.program, 0, 0, ...tail];
  }
}

const knobRecord = (k: Knob): number[] => [k.channel - 1, k.cc, k.min, k.max, portMask(k.ports), colourIndex(k.colour)];

/** The body of the template: pads, knobs, page meta. A pad or knob the profile leaves out is all zeros (type none / port mask 0). */
export function compileBody(profile: Profile): Uint8Array {
  const body = new Uint8Array(BODY_LENGTH);
  profile.pages.forEach((page, g) => {
    for (const pad of page.pads) {
      body.set(padRecord(pad), PADS_OFFSET + (g * LAYOUT.padsPerPage + pad.pad - 1) * LAYOUT.padRecord);
    }
    body[META_OFFSET + g] = page.bankOnEnter === null ? LAYOUT.keepBank : page.bankOnEnter - 1;
  });
  profile.banks.forEach((bank, b) => {
    for (const knob of bank.knobs) {
      body.set(knobRecord(knob), KNOBS_OFFSET + (b * LAYOUT.knobsPerBank + knob.knob - 1) * LAYOUT.knobRecord);
    }
  });
  return body;
}

/** The whole 1024-byte slot: header, body, 0xFF fill. Same profile in, same bytes out. */
export function compile(profile: Profile): Uint8Array {
  const body = compileBody(profile);
  const slot = new Uint8Array(LAYOUT.slotLength).fill(0xff);
  const view = new DataView(slot.buffer);
  slot.set(new TextEncoder().encode(LAYOUT.magic), 0);
  slot.set([LAYOUT.version, LAYOUT.pages, LAYOUT.banks, 0], 4);
  view.setUint16(8, BODY_LENGTH, true);
  view.setUint16(10, 0, true);
  view.setUint32(12, crc32(body), true);
  slot.set(body, LAYOUT.headerLength);
  return slot;
}
