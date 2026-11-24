# 02 — Capability matrix

Legend: **E** = exists · **F** = feasible with evidence (a working precedent or a traced code path) · **P** = plausible but unverified · **U** = unsupported / not realistic · **—** = not applicable.
Evidence tags as in `01-repository-audit.md`. "Minimal" = Option B prototype (`09-prototype-spec.md`); "Advanced" = Option C.

Launchpad Pro MK3 and Launch Control 3 columns are from general vendor knowledge and are **not verified in this session**. Check them against Novation's current spec sheets before any purchase decision; we deliberately leave out numbers we could not confirm.

## Grid / pads

| Capability | Stock CT | CIRCUIT-HACKS-RC | Minimal mode | Advanced mode | LP Pro MK3 | Launch Control 3 |
|---|---|---|---|---|---|---|
| Pads available to performance | 32 (4×8), meaning set by view | 32, more views/overlays | **F**: all 32 owned by the mode (controller slot 0/1 heads, [STATIC]) | F | 64 (8×8) + side buttons | few/none (verify) |
| Velocity from pads | E (r2 of `0x08033282`) [STATIC] | E (`velcurve` reshapes it) | **F** | F | E | — |
| Aftertouch/pressure | **U**: no pressure argument in the pad path [STATIC]. Whether the hardware senses pressure is [UNK] | U | U | U | E (poly AT) | — |
| Pad release event | E (slot 1 → view slot 1) [STATIC] | E | **F** | F | E | — |
| Note while held (gate) | E for MIDI tracks: scale-mapped, on the track channel | E | **F**: any note/channel per pad | F | E | — |
| CC momentary (press/release values) | U | U (there are mod-internal momentary actions, but none send CC) | **F** (`0x0803BEDA` raw send, SC06 precedent [HW]) | F | E (custom modes) | E (verify) |
| CC toggle with local state | U | U | **F** | F | E | E |
| Program Change per pad | Partial: project PC on ch16 | E: MIDI-track "patch flip" turns every note into a PC (SC06 [HW]) | **F** | F | E | E |
| Multi-message macro | U | U | — (excluded from v1) | **P** (64 msgs/press UI-task cap [HW-observed, RECURSOS:230]) | P | — |
| Per-pad channel | U (track channel) | U | **F** | F | E | E |
| Multiple pages | — | — | **F** (Octave ▼/▲ or 1-16/17-32 intercept) | F | E | E |
| Mute/unmute Circuit's own tracks | E (Mixer) | E+ (A7PROT solo group / mute flip, [EMU]) | — (use the Mixer) | P: a pad type "internal mute" via the Mixer API | — | — |
| Mute external parts | U | U | F as CC/note to the target, **only if the target supports it** | F | F | F |
| Scene / pattern switching (Circuit) | E (Scenes view, PC on project ch) | E+ (pattern-group chains) | — (stay in stock views) | P: internal scene trigger pad | — | — |

## Encoders

| Capability | Stock CT | CIRCUIT-HACKS-RC | Minimal | Advanced | LP Pro MK3 | Launch Control 3 |
|---|---|---|---|---|---|---|
| 8 knobs → MIDI CC | E: MIDI-track templates, 8 per template, 8 templates, CC/NRPN/RPN, range bottom/top, **channel per knob** in the record [EMU-decoded, NOTAS:989/3634] | E + on-device CC editing (SC23 CC editor) | **F**: own banks | F | — | E |
| Knob data type | relative signed ±1 events [STATIC] | same; mods divide (`p4dest DIV=4`) | F (accumulate 0..127) | F | — | E (verify) |
| Acceleration | none found [STATIC] | none | P (simple velocity-of-turn scaling via HAL tick) | P | — | E (verify) |
| Multiple banks of 8 | template = bank, but only for the selected MIDI track | E patterns: vcf21 pages, p4dest, splitknob, knobhold | **F** (4 banks in v1) | F | — | E |
| Soft takeover / pickup | not needed: encoders are relative | — | not needed. Values are locally owned (see the "commanded vs confirmed" note) | P: resync from incoming CC | — | E (verify) |
| Relative CC output (2's-complement / offset-64) | U | U | P (trivial arithmetic; excluded from v1) | F | — | E (verify) |
| Knob LED shows value | E (stock dynamic codes) [STATIC] | E (`persist19.c_ledhook` colour+brightness) | **F**: static bank colour in v1; brightness needs the converter hook | F | — | E |
| Encoders available while sequencer plays | E | E | **F**: but they stop editing Circuit params while the mode is on | F | — | E (separate device: both at once) |

## LEDs / feedback

| Capability | Stock CT | CIRCUIT-HACKS-RC | Minimal | Advanced | LP Pro MK3 | Launch Control 3 |
|---|---|---|---|---|---|---|
| Independent colour per pad | E (palette code per pad) | E | **F** | F | E | — |
| Arbitrary RGB | **U as an API**: 256-entry palette; the RAM table at 0x20003804 could be rewritten [STATIC], so this is **P** | P | — | P (risky: animated entries, shared palette) | E (SysEx RGB) | — |
| Steady / dim / blink / pulse | E: palette families (e.g. 0x49–0x4C), 35 animated entries measured [HW, NOTAS:2346] | E + own timers (256 ms, 100 ms) | **F** | F | E | — |
| External LED control over MIDI | U | U (only diag SysEx `F0 7D 43 54`) | — | **P**: SysEx head precedent exists; no LED path yet | E (Launchpad protocol) | E (verify) |
| State confirmed by target device | U | U | U: LEDs show **commanded** state only | P: only where the target echoes CC | P (DAW feedback) | P |

## System

| Capability | Stock CT | CIRCUIT-HACKS-RC | Minimal | Advanced | LP Pro MK3 | Launch Control 3 |
|---|---|---|---|---|---|---|
| Sequencer keeps running in the mode | — | E for overlays (Master FX [HW]) | **F**: the mode overlays the controller and changes no view [STATIC]; needs a [HW] check | F | E (own sequencer) | — |
| DIN + USB output | E | E (+USB merge, Thru-as-Out2) | **F** (port mask per action) | F | E (TRS) | verify |
| Standalone (no computer) | E | E | **F** | F | E | verify DIN |
| Configurable without a computer | — | E for CC editor | U (template baked at build time) | P (on-device editing, later) | P (Components needs a computer) | P |
| Persisted config | E (templates in `_GLOB.cg`) | E (75 B settings tail full) | baked into the image (no runtime persistence) | P: backup SRAM / file / template store | E | E |
| Ableton/DAW control-surface integration | U | U | U | U | E | E |
| Fits in current RC flash | — | 2.2 KB free | **U** on RC4.16 without upstream space work; **F** on a stock-based build | U on RC (needs ~4–6 KB) | — | — |
