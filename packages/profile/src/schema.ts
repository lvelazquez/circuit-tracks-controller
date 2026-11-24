import { z } from "zod";
import { COLOURS, LAYOUT, PORTS } from "./layout.ts";

const channel = z.number().int().min(1).max(16);
const data7 = z.number().int().min(0).max(127);
const colour = z.enum(COLOURS);
const ports = z.array(z.enum(PORTS)).max(PORTS.length).refine((p) => new Set(p).size === p.length, "a port is listed twice");

/** What a pad or knob is meant to drive: a device of the catalog and one of its capabilities. Used by the lint only. */
const target = z.object({ device: z.string().min(1), capability: z.string().min(1) }).strict();

const common = {
  pad: z.number().int().min(1).max(LAYOUT.padsPerPage),
  label: z.string().max(24).optional(),
  channel,
  ports,
  colour,
  target: target.optional(),
};

export const padSchema = z.discriminatedUnion("type", [
  z.object({ ...common, type: z.literal("note_gate"), note: data7 }).strict(),
  z.object({ ...common, type: z.literal("note_fixed"), note: data7, velocity: z.number().int().min(1).max(127) }).strict(),
  z.object({ ...common, type: z.literal("cc_momentary"), cc: data7, on: data7, off: data7 }).strict(),
  z.object({ ...common, type: z.literal("cc_toggle"), cc: data7, on: data7, off: data7 }).strict(),
  z.object({ ...common, type: z.literal("program"), program: data7 }).strict(),
]);
export type Pad = z.infer<typeof padSchema>;

export const knobSchema = z
  .object({
    knob: z.number().int().min(1).max(LAYOUT.knobsPerBank),
    label: z.string().max(24).optional(),
    channel,
    cc: data7,
    min: data7.default(0),
    max: data7.default(127),
    ports,
    colour,
    target: target.optional(),
  })
  .strict()
  .refine((k) => k.min <= k.max, "min is above max");
export type Knob = z.infer<typeof knobSchema>;

const unique = <T>(key: (x: T) => number, what: string) => (xs: T[]) => new Set(xs.map(key)).size === xs.length || `${what} appears twice`;

export const pageSchema = z
  .object({
    name: z.string().min(1).max(32),
    /** The bank this page selects when it is entered; null keeps the current one. */
    bankOnEnter: z.number().int().min(1).max(LAYOUT.banks).nullable(),
    pads: z.array(padSchema).max(LAYOUT.padsPerPage),
  })
  .strict()
  .refine((p) => unique<Pad>((x) => x.pad, "a pad")(p.pads) === true, "a pad appears twice");
export type Page = z.infer<typeof pageSchema>;

export const bankSchema = z
  .object({ name: z.string().min(1).max(32), knobs: z.array(knobSchema).max(LAYOUT.knobsPerBank) })
  .strict()
  .refine((b) => unique<Knob>((x) => x.knob, "a knob")(b.knobs) === true, "a knob appears twice");
export type Bank = z.infer<typeof bankSchema>;

export const profileSchema = z
  .object({
    schema: z.literal(1),
    name: z.string().min(1).max(48),
    description: z.string().max(400).optional(),
    pages: z.array(pageSchema).length(LAYOUT.pages),
    banks: z.array(bankSchema).length(LAYOUT.banks),
  })
  .strict();
export type Profile = z.infer<typeof profileSchema>;

export function parseProfile(input: unknown): Profile {
  return profileSchema.parse(input);
}
