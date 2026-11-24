# 06 — Test plan

## What emulation can and cannot establish

The upstream harness runs the real ARM firmware in Unicorn on top of RAM and flash dumps of a running device (`ctre/`, userx14 dumps @ d6aec9fc). It drives the real controller entry points:
- `0x08033282` pad press, `0x080332FE` pad release;
- `0x08033320` / `0x0803381A` buttons;
- `0x08033848` knobs;
- the LED task through `0x08033B3E`.

We confirmed the harness runs here: `emu_mixsolo3.py` on A7PROT gives ALL PASS **[RUN]**.

| Emulation CAN show | Emulation CANNOT show |
|---|---|
| Exact MIDI bytes per press, release and knob event (capture at `0x0803BEDA` / router `0x08020C42`) | Real MIDI timing, jitter and DIN throughput |
| LED frame halfwords and RGB via the real converter (`emu_sc19_6.E196.conv`) | Perceived colour, brightness and blink rate on the device |
| Mode entry/exit logic, release records, stuck-note flushing | Sequencer running concurrently. **The clock does not advance in emulation** (CLAUDE.md "Pruebas"), so "plays while in CTL" is a hardware test |
| Non-interference with CTL off: state diff vs the base build (fuzz) | Thread interleaving between the UI task and the sequencer/MIDI threads (R6) |
| Stack depth of the LED head (`emu_ledstack.py` method) | Behaviour of Bitbox, VE-500 and Hermod+ |
| Byte-identical reproducible builds (`verify_builds` style) | Install path / bootloader behaviour |

## Automated tests (new `tools/emu_ctl.py` in our fork; reuse `emu_sc05.E`, `emu_sc08.E8`, `emu_lazysave.EL.at(ms)`, `emu_cscale.EC.shift()/frame()`, `emu_sc46_3.E.press/release`)

Fixture: a hook on `0x0803BEDA` that records `(mask, bytes)` and returns. A second variant lets the call through to the router, to catch faults inside it.

| ID | Test | Pass criterion |
|---|---|---|
| T-PAD-1 | Gate note pad press (vel 100) / release | exactly `90+ch nn 64` then `80+ch nn 00`, mask as configured |
| T-PAD-2 | Fixed-velocity pad ignores the input velocity | vel field = configured value for inputs 1, 64, 127 |
| T-PAD-3 | CC momentary | press → `Bn cc von`, release → `Bn cc voff` |
| T-PAD-4 | CC toggle ×3 presses | on, off, on; nothing sent on release; LED follows local state |
| T-PAD-5 | Program change | `Cn pp` on press only |
| T-PAD-6 | 8 simultaneous presses, releases in reverse order | 8 matched pairs, no cross-talk |
| T-PAD-7 | 200 rapid press/release cycles on one pad (HAL tick advanced 5 ms each) | 400 messages, no state drift |
| T-CH-1 | Every pad × channel 1–16 from a generated config | status nibble correct |
| T-KNB-1 | Knob +1 ×130 from 0 | values 1..127 sent once each, clamped, no 128 |
| T-KNB-2 | Knob −1 at 0 | nothing sent |
| T-KNB-3 | Bank switch with held values | each bank keeps its own values; no message on switch |
| T-PG-1 | Page switch while a note pad is held, then release | the release sends the **old** page's note-off |
| T-LED-1 | Frame entries 0–31 for each action type and state | equal to the spec palette codes (`09` §5) |
| T-LED-2 | Octave LEDs and LED 53 show page and bank | spec codes |
| T-LED-3 | CTL off | frame identical to the base build (all 69 halfwords) |
| T-ENT-1 | Shift + Mixer toggles; Mixer alone still opens the Mixer | flag toggles; the stock view switch happens only without Shift |
| T-ENT-2 | Entry does not change `[ctrl+0x6C]` | same view pointer before and after |
| T-ENT-3 | Pad held in the stock view → enter CTL → release | the release reaches the stock view (stock held bit cleared) and CTL sends nothing |
| T-STK-1 | Hold 3 note pads → exit CTL | 3 note-offs sent on exit |
| T-STK-2 | Hold pads → project load path (`LOAD_END` hook precedent) | note-offs flushed, CTL off |
| T-STK-3 | Save lock bit set (`[ctrl+0x7C]` bit 1) | presses dropped and nothing sent, as in stock |
| T-BTN-1 | Play / Record / Tempo pass through in CTL | stock handlers called (call trace) |
| T-FUZ-1 | Differential fuzz, CTL off vs base (`emu_sc19_fuzz.py` style: random buttons, Shift+buttons, pads, knobs; 12 × 80 events) | no faults; state diff only in CTL RAM |
| T-FUZ-2 | Fuzz with CTL on | no faults; `held` always ⊆ pressed set; every note-on paired by the end |
| T-STACK-1 | LED head stack depth | ≤ base + 16 B |
| T-BLD-1 | Reproducible build, unique 6-byte mark, image < 0x70000, no stores to flash-controller registers in new code | assert |
| T-SYX-1 (M4+) | Malformed, oversized (> 0x168 B) and wrong-ID SysEx | ignored, no buffer write past the frame |
| T-SAT-1 | 64 knob events in one UI tick | ≤ 64 sends (UI cap), no hang |

Regression: run the upstream quick suite (`run_tests.sh`) whenever CTL is chained onto a CH base. On a stock base, T-FUZ-1 against stock is the regression gate.

## Hardware test matrix (documented here; nothing is executed without explicit approval)

Equipment: Circuit Tracks, a computer MIDI monitor (USB) and a DIN monitor, a MIDI clock analyser (or DAW-free logging of F8 intervals), the Bitbox Micro, a Pro-800 and the VE-500.

| ID | Scenario | Measure / pass |
|---|---|---|
| T-HW-0 | Rollback drill: bootloader combo → official firmware | device returns to stock |
| T-HW-1 | Install CTL (mode off) → normal use for 10 min | no difference from stock in the workflow |
| T-HW-2 | Enter/exit 50× while a project plays | **no playback interruption, no tempo change** (record audio; inspect) |
| T-HW-3 | All T-PAD contracts on USB and DIN | monitor log matches the emulation captures byte for byte |
| T-HW-4 | Pad-to-MIDI latency (audio click from the pad tap vs a MIDI timestamp) | report the distribution; compare with stock MIDI-track pad latency |
| T-HW-5 | Knob sweep at speed | no gaps over 1 step; message rate |
| T-HW-6 | Clock out jitter with CTL idle vs CTL hammering 8 pads + knobs | F8 interval σ not worse than stock + 0.2 ms [threshold to confirm] |
| T-HW-7 | 30 min session: Bitbox stems via CTL while the sequencer drives the Pro-800 | no stuck notes; Bitbox state matches the LEDs |
| T-HW-8 | Pack/project change with pads held | all notes off; the mode exits cleanly |
| T-HW-9 | Power-cycle in CTL | boots in normal mode |
| T-HW-10 | LED legibility in stage light; colour-blind check (state is distinguishable by brightness, not hue alone) | subjective + checklist |

Conservative order: HW-0 → HW-1 → HW-9 → HW-3 → HW-2 → HW-8 → HW-5/4/6 → HW-7.
