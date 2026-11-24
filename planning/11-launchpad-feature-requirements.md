# 11 — Launchpad Pro MK3 feature comparison, revised

Revised 2026-11-19 against the fork source and the first CTL build (`ctl/main`, commit 2675442). The original text was an outside estimate written before any code existed. Tags: **[RUN]** measured or run here, **[SRC]** read in the repo, **[UNV]** not checked by us.

## What changed from the original

1. **Its "biggest constraint" no longer applies as written.** The flash shortage is real for CIRCUIT-HACKS builds (RC4.16 about 2.2 KB free). CTL is built on the stock image instead, which has 143 KB free. The M1 build uses 444 B of code plus a 1 KB template and leaves 141,892 B **[RUN]**.
2. **That choice has a cost the original misses.** A stock-based CTL build has **none** of the CIRCUIT-HACKS features. The "already have" table mixes two firmwares that cannot be installed together today.
3. **The controller mode is no longer hypothetical.** Pad to MIDI, mode entry and exit, and note-off flushing pass in emulation **[RUN]**. Everything else in the list is still unbuilt.
4. **Five items in the original conflict with decisions already taken** in `09` and `10`. They are listed under "Conflicts" and need your call.

## Feature groups by firmware

You get one column or the other until CTL is ported into CIRCUIT-HACKS (`07`, M5 "port").

| Launchpad Pro feature | Stock 4486 + CTL | CIRCUIT-HACKS RC (no CTL) |
|---|---|---|
| Four-track MIDI sequencing, 32 steps, probability, microsteps | yes, native **[UNV]** | yes |
| Pattern chaining and scenes | native only | extended (`patchain.py`) **[SRC]** |
| Scale and chromatic keyboards | native only | plus custom scales and Jankó (`cscale.py`, `janko.py`) **[SRC]** |
| Chord mode | no | yes (`chords.py`), not Launchpad's saved chord banks **[SRC]** |
| Arpeggiator | no | yes (`arp.py`) **[SRC]** |
| Mutation | native only **[UNV]** | extended (`mutate39.py`, `patmut.py`) **[SRC]** |
| 32-pad MIDI controller mode | **M1 done in emulation** | no room |

## The eight proposed additions

| # | Addition | Status in our plan | Correction to the original |
|---|---|---|---|
| 01 | 32-pad controller mode | **Built, M1.** Shift + Mixer; the active view is never switched | Effort was rated medium–high; the overlay turned out small. The open risk is hardware, not code size |
| 02 | Momentary and toggle pads | Specified (`09` §2: `CC_MOMENTARY`, `CC_TOGGLE`), P3 | "Release to restore its value" is not possible: CTL cannot know the previous value. Release sends a configured `v_off` |
| 03 | Note / CC / Program Change per pad | Specified, P3. Channel, number, values and ports per pad | Assignments are baked into the image at build time. Changing one means reinstalling (1–2 min) |
| 04 | Multiple pages | Specified, P3: 3 pages on Octave ▼/▲ | "Storing safely" is solved by not storing at runtime. Page list conflicts with `10` (see below) |
| 05 | Eight-knob banks | Specified, P3: 4 banks, absolute CC with min/max | "Reuse the mod's CC editing" does not apply on a stock base. Pickup is not needed: the encoders are endless and CTL keeps its own value. Relative CC is excluded from v1 |
| 06 | Pad colours and state | Specified, P3: painted after the stock LED task, dim vs steady | No blinking in v1. State is carried by brightness as well as hue |
| 07 | Virtual faders | **Not in the plan** | New requirement. Cheapest form: a new pad type that sends one fixed CC value on press, used as a row of 8 levels. Costs pads on a 32-pad page; the knobs do this better |
| 08 | External LED feedback | Excluded from v1 (`09` §9), roadmap M4 | Needs incoming MIDI, which v1 forbids. Related to decision D8 |

## Conflicts with the plan — decided 2026-11-19: keep the plan

The owner decided to keep plan `10` in all five cases. Each row says when to look at it again.

| # | Original says | Decision (plan `10` / spec `09`) | Revisit when |
|---|---|---|---|
| C1 | One mixed page: Bitbox row, mute row, FX row, synth/scene row | One page per device (Bitbox, Hermod+, free), each with its own knob bank | After the first hardware session with both pages. This is a profile choice, so changing it needs no firmware work |
| C2 | Pages for synthesizers and vocal effects | VE-500, Pro-800, Model D and Solina stay out of v1 | Once the Bitbox and Hermod+ pages are verified on the devices. Page 3 is free for them; questions Q13 and Q15 in `08` come back with them |
| C3 | "Scene commands" on pads | Internal Circuit actions from pads stay excluded (`09` §9); use the stock Scenes view | After P3, if leaving the mode to change scene proves too slow live |
| C4 | Virtual faders (07) | Not built | After P3, and only if a real use appears. Cheapest form: a pad type that sends one fixed CC value on press |
| C5 | Bidirectional LED feedback (08) | Excluded from v1; stays in roadmap M4 | Together with decision D8 (incoming SysEx), after P4 |

## What is proven and what is not

| Claim in the original | Evidence today |
|---|---|
| "Enough code space" | **Yes on the stock base [RUN].** No on current RCs |
| "Switch modes without playback interruptions" | **Partly.** Entry does not change the view pointer, and with the mode off 12 × 80 random events leave RAM and MIDI identical to stock **[RUN]**. The sequencer does not run in emulation, so playback under CTL is a hardware test (T-HW-2), not yet approved or run |
| Bitbox triggers, mutes, mod CCs; Hermod+ control | **Unverified.** Every device capability waits for the monitor session (P1b). The knob labels in the original (Filter, Res, Pitch, Start, End…) are examples only |
| Channel plan | **Open (D5).** Bitbox pad *n* = channel *n* collides with Circuit channels 1–4 |
| No polyphonic aftertouch, no 8×8 surface | 32 pads **[SRC]**; aftertouch **[UNV]** |

## Recommendation

The original's "six core capabilities" match P2 + P3 of `10` exactly, so the priority order stands: pad messages (done), then momentary/toggle and Program Change, pages, knob banks, LED states, and exit on project load.

Two points to add to it:
- **The trade is firmware against firmware.** With CTL you lose the mod's arp, chords and custom scales on that install. That, more than flash, is the reason to port CTL into CIRCUIT-HACKS later.
- **Launch Control still earns its place.** In CTL the 8 knobs belong to CTL and Circuit's own macro knobs are unreachable, and the reverse outside it.
