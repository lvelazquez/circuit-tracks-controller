import { crc32 } from "./crc32.ts";
import { BODY_LENGTH, COLOURS, KNOBS_OFFSET, LAYOUT, META_OFFSET, PADS_OFFSET, PAD_TYPE, PORTS } from "./layout.ts";
import type { Colour, Port } from "./layout.ts";
import { parseProfile } from "./schema.ts";
import type { Bank, Knob, Pad, Page, Profile } from "./schema.ts";

export class TemplateError extends Error {}

const at = (b: Uint8Array, i: number): number => b[i] ?? 0;
const portsOf = (mask: number): Port[] => PORTS.filter((_, i) => mask & (1 << i));
const colourOf = (i: number): Colour => COLOURS[i & 7] ?? "magenta";

/** Checks the header and the CRC the way the firmware does and returns the body. */
export function checkSlot(slot: Uint8Array): Uint8Array {
  if (slot.length !== LAYOUT.slotLength) throw new TemplateError(`slot is ${slot.length} bytes, expected ${LAYOUT.slotLength}`);
  const view = new DataView(slot.buffer, slot.byteOffset, slot.byteLength);
  if (new TextDecoder().decode(slot.subarray(0, 4)) !== LAYOUT.magic) throw new TemplateError("wrong magic");
  if (at(slot, 4) !== LAYOUT.version || at(slot, 5) !== LAYOUT.pages || at(slot, 6) !== LAYOUT.banks) {
    throw new TemplateError("wrong version, page count or bank count");
  }
  if (view.getUint32(8, true) !== BODY_LENGTH) throw new TemplateError("wrong body length");
  const body = slot.subarray(LAYOUT.headerLength, LAYOUT.headerLength + BODY_LENGTH);
  if (view.getUint32(12, true) !== crc32(body)) throw new TemplateError("CRC mismatch");
  return body;
}

function padOf(r: Uint8Array, pad: number): Pad | null {
  const base = { pad, channel: (at(r, 1) & 15) + 1, ports: portsOf(at(r, 5)), colour: colourOf(at(r, 6)) };
  switch (at(r, 0)) {
    case PAD_TYPE.note_gate:
      return { ...base, type: "note_gate", note: at(r, 2) };
    case PAD_TYPE.note_fixed:
      return { ...base, type: "note_fixed", note: at(r, 2), velocity: at(r, 3) };
    case PAD_TYPE.cc_momentary:
      return { ...base, type: "cc_momentary", cc: at(r, 2), on: at(r, 3), off: at(r, 4) };
    case PAD_TYPE.cc_toggle:
      return { ...base, type: "cc_toggle", cc: at(r, 2), on: at(r, 3), off: at(r, 4) };
    case PAD_TYPE.program:
      return { ...base, type: "program", program: at(r, 2) };
    default:
      return null;
  }
}

/** A slot back to a profile. Names, labels and targets are not in the slot; the result is validated like any profile. */
export function decode(slot: Uint8Array, name = "decoded"): Profile {
  const body = checkSlot(slot);
  const pages: Page[] = [];
  for (let g = 0; g < LAYOUT.pages; g++) {
    const pads: Pad[] = [];
    for (let p = 0; p < LAYOUT.padsPerPage; p++) {
      const o = PADS_OFFSET + (g * LAYOUT.padsPerPage + p) * LAYOUT.padRecord;
      const pad = padOf(body.subarray(o, o + LAYOUT.padRecord), p + 1);
      if (pad) pads.push(pad);
    }
    const bank = at(body, META_OFFSET + g);
    pages.push({ name: `Page ${g + 1}`, bankOnEnter: bank < LAYOUT.banks ? bank + 1 : null, pads });
  }
  const banks: Bank[] = [];
  for (let b = 0; b < LAYOUT.banks; b++) {
    const knobs: Knob[] = [];
    for (let k = 0; k < LAYOUT.knobsPerBank; k++) {
      const o = KNOBS_OFFSET + (b * LAYOUT.knobsPerBank + k) * LAYOUT.knobRecord;
      const r = body.subarray(o, o + LAYOUT.knobRecord);
      if (at(r, 4) === 0) continue;
      knobs.push({ knob: k + 1, channel: (at(r, 0) & 15) + 1, cc: at(r, 1), min: at(r, 2), max: at(r, 3), ports: portsOf(at(r, 4)), colour: colourOf(at(r, 5)) });
    }
    banks.push({ name: `Bank ${b + 1}`, knobs });
  }
  return parseProfile({ schema: 1, name, pages, banks });
}
