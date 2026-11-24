import { LAYOUT } from "@ctl/profile";
import type { CapabilityIndex, Knob, Pad, Profile } from "@ctl/profile";

const TYPE_MARK: Record<Pad["type"], string> = { note_gate: "N", note_fixed: "F", cc_momentary: "M", cc_toggle: "T", program: "P" };
const STATUS_MARK = { verified: "+", unverified: "?", refuted: "x" } as const;

function mark(target: Pad["target"], catalog: CapabilityIndex): string {
  if (!target) return " ";
  const status = catalog[target.device]?.[target.capability];
  return status ? STATUS_MARK[status] : "!";
}

function padCell(p: Pad | undefined, catalog: CapabilityIndex): string {
  if (!p) return "·".padEnd(9);
  const number = p.type === "program" ? p.program : p.type === "note_gate" || p.type === "note_fixed" ? p.note : p.cc;
  return `${TYPE_MARK[p.type]}${String(number).padStart(3)}c${String(p.channel).padStart(2)}${mark(p.target, catalog)}`.padEnd(9);
}

function describePad(p: Pad): string {
  const to = `ch ${p.channel} → ${p.ports.join("+") || "no port"}`;
  switch (p.type) {
    case "note_gate":
      return `note ${p.note}, pad velocity, ${to}`;
    case "note_fixed":
      return `note ${p.note}, velocity ${p.velocity}, ${to}`;
    case "cc_momentary":
      return `CC ${p.cc}: ${p.on} while held, ${p.off} on release, ${to}`;
    case "cc_toggle":
      return `CC ${p.cc}: ${p.on} / ${p.off} in turn, ${to}`;
    case "program":
      return `program ${p.program}, ${to}`;
  }
}

const describeKnob = (k: Knob): string => `CC ${k.cc}, ${k.min}–${k.max}, ch ${k.channel} → ${k.ports.join("+") || "no port"}`;
const targetText = (t: Pad["target"], catalog: CapabilityIndex): string =>
  t ? ` [${t.device}.${t.capability}: ${catalog[t.device]?.[t.capability] ?? "not in the catalog"}]` : "";

/**
 * A plain-text picture of a profile, laid out like the panel: four rows of eight pads per page, pad 1 top left.
 * Every state is spelled with letters and marks, so nothing depends on colour.
 */
export function preview(profile: Profile, catalog: CapabilityIndex = {}): string {
  const lines: string[] = [`${profile.name}`, ""];
  lines.push("Cell: type, number, channel, capability mark.");
  lines.push("Types: N note (pad velocity)  F note (fixed velocity)  M CC momentary  T CC toggle  P program  · unassigned");
  lines.push("Marks: + verified  ? unverified  x refuted  ! not in the catalog  (none: no target named)");
  profile.pages.forEach((page, g) => {
    const bank = page.bankOnEnter === null ? "keeps the current bank" : `selects bank ${page.bankOnEnter}`;
    lines.push("", `Page ${g + 1}: ${page.name} (${bank})`);
    const byPad = new Map(page.pads.map((p) => [p.pad, p]));
    for (let row = 0; row < LAYOUT.padsPerPage / 8; row++) {
      lines.push(`  ${Array.from({ length: 8 }, (_, c) => padCell(byPad.get(row * 8 + c + 1), catalog)).join(" ")}`);
    }
    for (const p of [...page.pads].sort((a, b) => a.pad - b.pad)) {
      lines.push(`  pad ${String(p.pad).padStart(2)}  ${(p.label ?? "").padEnd(16)} ${describePad(p)}, ${p.colour}${targetText(p.target, catalog)}`);
    }
  });
  profile.banks.forEach((bank, b) => {
    lines.push("", `Bank ${b + 1}: ${bank.name}${bank.knobs.length ? "" : " (no knobs assigned)"}`);
    for (const k of [...bank.knobs].sort((a, b2) => a.knob - b2.knob)) {
      lines.push(`  knob ${k.knob}  ${(k.label ?? "").padEnd(16)} ${describeKnob(k)}, ${k.colour}${targetText(k.target, catalog)}`);
    }
  });
  return `${lines.join("\n")}\n`;
}
