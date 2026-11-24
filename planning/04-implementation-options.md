# 04 — Implementation options

## Option A — Stock firmware + external MIDI translator

**What stock already gives** [STATIC/DOC; Novation MIDI-track docs]:
- MIDI 1/2 tracks: pads send scale-mapped notes on the track channel, live and sequenced.
- 8 knobs send template CC/NRPN/RPN with bottom/top range; there are 8 templates, edited in Components.
- Program Change on the project channel, and the Mixer for mutes.

**What a translator adds:** remap notes to arbitrary CC, PC or momentary/toggle actions, plus per-pad channel.

**Limits:**
- Only the 16 note pads of the current MIDI track's Note view are usable, and their mapping depends on scale/octave.
- No toggle LEDs, because the Circuit shows its own Note view.
- Knobs are tied to the selected MIDI track's template.
- It needs a computer or an extra MIDI box, which violates the no-laptop goal.

**Use it for:** a 1–2 evening interaction prototype. A WebMIDI page maps Circuit notes to the target devices, which lets us settle the page layout and the Bitbox/VE-500 message contracts before any firmware exists.

## Option B — Minimal native controller overlay (CTL)

32 pads with configurable Note/CC/PC (gate, momentary, toggle); 3 pages; 4 banks of 8 absolute CCs; palette LEDs; entered with Shift + Mixer. The design is in `03`; the spec is in `09`.

**Base choice is the real decision:**

| Base | Flash free | RAM for ~200 B | CH features kept | Risk | Verdict |
|---|---|---|---|---|---|
| **B-stock**: official 4486 + CTL only | 143 KB | stock above-heap area is unused in stock dumps (to confirm with a canary) | none | lowest: few hooks, all on untouched stock code | **Prototype here (M1–M3)** |
| B-RC: RC4.16 + CTL | 2.2 KB | no documented gap ≥ 200 B; backup SRAM / ITCM candidates | all | medium-high: chain composition with ~10 heads, flash overflow | after upstream space work |
| B-profile: RC with some modules dropped (feature profile) | depends on the profile, e.g. dropping FM-8 frees several KB [HYP] | freed by the dropped modules | most | medium; needs upstream cooperation | **target for M5+** |
| B-old: RC0.x (≈ 40 KB free) | ≈ 40 KB | tight | old set, old bugs | medium | not recommended |

**Effort [HYP]:**
- ≈ 500–800 Thumb instructions, i.e. 1.2–2 KB of code, plus ≈ 1 KB of config tables. Comparable modules: mixsolo3 is 271 instructions, knobhold 368, gmdrum 430 (A7PROT manifest, [RUN]).
- Roughly 2–4 weeks of focused work including emulation tests, then hardware sessions.

## Option C — Enhanced bidirectional controller

B plus:
- incoming feedback: set pad colours and knob values from MIDI;
- external-state confirmation where targets echo;
- relative CC;
- on-device editing;
- persisted templates.

**Feedback protocol comparison:**

| | Custom SysEx `F0 7D 43 54 <cmd> …` | Note/CC on a feedback channel (Launchpad-like: note = pad, velocity = palette code) | Launchpad protocol |
|---|---|---|---|
| Precedent | The mod's SysEx head already parses `F0 7D 43 54` (rdiag/black box) [HW diag] | Needs a hook before the channel dispatch at 0x08051720/0x08051834 (SC25 precedent) | none |
| Bitbox/Hermod can emit it? | No (fixed SysEx) | Possibly, via MIDI out of their sequencers [UNK] | No |
| Parsing cost | small (fixed frames) | tiny | large |
| Collision risk | none: 7D is the non-commercial ID | channel reserved for feedback; must not collide with track channels | — |

**Recommendation:** a small custom SysEx protocol for configuration and LED pushes from an editor, plus an optional "note = pad colour" feedback channel for sequencer-driven light shows. Only after M4.

## Option D — Deep Launchpad / Launch Control emulation

**What it needs:**
- a USB descriptor/name change, because DAW scripts match port names and device-inquiry replies;
- a Novation device-inquiry identity, SysEx mode switching, programmer-mode layouts, and session/note/custom modes;
- an 8×8 grid that we would have to fold into 4×8.

**Value for this rig:** close to zero. There is no DAW in the setup, so Ableton integration is moot, and the Launchpad Pro MK3 protocol is DAW-oriented. Changing the USB identity also risks Components and the upstream uploaders no longer recognising the device: `ct_uploader` identifies the device over SysEx.

**Verdict:** not pursued. Revisit only if a DAW enters the rig.

## Comparison

| | A Translator | **B Minimal (stock base)** | C Bidirectional | D Emulation |
|---|---|---|---|---|
| Usefulness live | low (laptop) | **high** | higher | low for this rig |
| Complexity | very low | medium | medium-high | very high |
| Firmware risk | none | low–medium | medium | high (USB identity) |
| ARM flash | 0 | ≈ 2.5–3.5 KB | ≈ 4–6 KB | ≥ 10 KB [HYP] |
| ARM RAM | 0 | ≈ 150–250 B | ≈ 300–600 B (+ SysEx buffer) | ≥ 1 KB |
| Testability | full on desktop | good: Unicorn harness for pads/knobs/LEDs/MIDI capture; the sequencer-running case only on HW | good + SysEx fuzz | poor without a DAW |
| Keeps CH features | yes | **no on a stock base**, yes later on a profile | same | — |

## Recommendation

1. **A (desktop, days):** lock the page layout and the device message contracts with the real Bitbox, VE-500 and Pro-800.
2. **B on stock 4486 (M1–M3):** prove pads, knobs, LEDs and mode entry in emulation, then on hardware. Accept that the mod's features are absent in this build. Recovery is the same as for any CH build.
3. **Port to CIRCUIT-HACKS** once there is room: propose upstream a feature-profile build or the ITCM cold-code plan. CTL is written as an outermost-head module from day one so that the port is a chain change, not a rewrite.
4. **C** after hardware confidence. **D** never, for this rig.
