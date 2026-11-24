/**
 * The byte layout of the CTL template slot. The firmware side of it lives in the fork (`tools/ctl.py`);
 * `emit-layout.ts` writes these values to a JSON file and `tools/ctl_template.py` refuses to work if the two disagree.
 */
export const LAYOUT = {
  magic: "CTLT",
  version: 1,
  slotLength: 1024,
  headerLength: 16,
  pages: 3,
  padsPerPage: 32,
  padRecord: 8,
  banks: 4,
  knobsPerBank: 8,
  knobRecord: 6,
  /** `bank_on_enter` byte for "keep the current bank": any value of `banks` or more. */
  keepBank: 0xff,
} as const;

export const PADS_OFFSET = 0;
export const KNOBS_OFFSET = LAYOUT.pages * LAYOUT.padsPerPage * LAYOUT.padRecord;
export const META_OFFSET = KNOBS_OFFSET + LAYOUT.banks * LAYOUT.knobsPerBank * LAYOUT.knobRecord;
export const BODY_LENGTH = META_OFFSET + LAYOUT.pages;

/** Pad action types, byte 0 of a pad record. */
export const PAD_TYPE = { none: 0, note_gate: 1, note_fixed: 2, cc_momentary: 3, cc_toggle: 4, program: 5 } as const;
export type PadTypeName = keyof typeof PAD_TYPE;

/** Colour tokens: the index is the family the firmware looks up in the stock track palette (steady and dim). */
export const COLOURS = ["magenta", "green", "blue", "pink", "orange", "yellow", "violet", "teal"] as const;
export type Colour = (typeof COLOURS)[number];

/** Port tokens: bit positions of the port mask. */
export const PORTS = ["usb", "din", "out2"] as const;
export type Port = (typeof PORTS)[number];

export function layoutJson(): Record<string, unknown> {
  return {
    ...LAYOUT,
    bodyLength: BODY_LENGTH,
    padsOffset: PADS_OFFSET,
    knobsOffset: KNOBS_OFFSET,
    metaOffset: META_OFFSET,
    padTypes: PAD_TYPE,
    colours: COLOURS,
    ports: PORTS,
  };
}
