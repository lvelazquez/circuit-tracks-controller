# 08 — Open questions and experiments

## Firmware unknowns

| # | Question | Why it matters | Experiment (non-destructive) |
|---|---|---|---|
| Q1 | Exact contract of `0x0803BEDA(mask, msg)`: is the pointer to raw bytes, or to a struct with a length? How are 2-byte messages (PC) handled? | CTL's only output path | Read the SC06 patch-flip code (it sends `[0xC0\|ch, note]`) and the 17 stock call sites in `re/app.asm`. Probe in emulation with a capture hook at router `0x08020C42` |
| Q2 | Is the send/router path safe when the UI task and the sequencer/MIDI-in threads call it concurrently? NOTAS:3559 says "not verified" | R6: corrupted or duplicated bytes | Static: does the router disable IRQs or use a lock? Hardware: T-HW-6 with heavy CTL traffic during dense sequencing, checking the byte stream for corruption |
| Q3 | What does the gate `0x080223FA` test? (USB connected? output enabled?) | It may silently drop CTL messages | Static read, then emulation with the gate's inputs varied |
| Q4 | Note-off form: `8n` or `9n vel 0`? What does the stock transmitter emit? | Some targets treat them differently | Read the transmitter vtable `0x08059FC8`; copy whatever stock does |
| Q5 | Does `Shift + Mixer` reach the `0x08033320` entry with Shift readable, on stock, under every view (Setup, Scales, Projects)? | Mode entry | Emulation over all view ids + T-FUZ |
| Q6 | Can CTL drive the Mixer button LED (the mode indicator)? Which frame index, and which object owns it? | Visible active indicator (house rule) | Map the 69-LED table at `0x08059438` in emulation (the upstream PATCHD method) |
| Q7 | Where do ~200 B of CTL RAM go on the stock base? Is the above-heap region truly unused in stock? Is the backup SRAM at 0x40024000 untouched? | R11 | Diagnostic build with canaries (upstream `tools/memmap.py` workflow). **Needs a hardware install; ask first** |
| Q8 | Actual LED frame rate and LED-task period on hardware | Blink design, CPU cost | Diagnostic counter at the LED head over SysEx (rdiag precedent) |
| Q9 | Pad velocity range and curve from the hardware (is 1..127 really used?) | Velocity-sensitive pads | Emulation can't answer. Log on hardware with MIDI-track pads in stock |
| Q10 | Behaviour while Clear/Duplicate/Shift is held, and during the save lock | Undefined pad semantics | Static plus emulation |

### Answered during P2 (2026-11-19, fork branch `ctl/main`, stock 4486)

| # | Answer | Evidence |
|---|---|---|
| Q1 | `msg` is a pointer to 3 raw bytes. The router calls each port of the mask; the port wraps the pointer as `{len = 3, ptr}` and queues it before returning, so the bytes may live on the caller's stack. Two-byte messages (PC) are not exercised yet (M2) | `re/app.asm` 0x0803BEDA, 0x08020C42, 0x0803599A; stock callers build the bytes on the stack (0x08029F24, 0x0804A36A); `emu_ctl.py` "through the gate and the router" |
| Q1 (two-byte messages) | A Program Change goes through the same call as three bytes, `Cn pp 00`, exactly as stock sends its own. The port always queues three bytes; on dequeue it prefixes a USB-MIDI header whose code is the status nibble, so the receiver takes two bytes for `Cn` | `re/app.asm` 0x0802A018 (stock PC sender: literal 0 at 0x0802A1F0 supplies the third byte), 0x08035B88 (`lsrs r0, r0, #4` builds the header); `emu_ctl.py` "the program change reaches the two ports of its mask" |
| Q3 | The gate returns "open" when bit 2 of `[0x20000A6C]` is clear. It is 0 in the RAM dump. Stock sets and clears it around storage operations (callers of 0x08022408). CTL inherits it, exactly like stock sends | `re/app.asm` 0x080223FA, 0x08022408; `emu_ctl.py` "the output gate closed" |
| Q4 | Stock sends note-off as `8n kk 00` | `re/app.asm` 0x08029F50 (`orr r1, r1, #0x80`) |
| Q5 | Shift + Mixer reaches the entry with Shift readable. **Stock does not ignore it completely:** the dropped press still commits a store (0x200442F8) and writes 0x200442F0. So the CTL head toggles and then lets the stock body run, instead of swallowing the press. Only the default view of the dump is covered so far, not every view id | `emu_ctl.py` T-ENT-1, T-FUZ-1 (12 × 80 events, RAM identical to stock) |
| Q7 (partly) | The above-heap RAM is **not zeroed at boot** (about 100 % non-zero in all three dumps), so "on" is a 32-bit magic word and anything else means off. Consequence: a warm reset with CTL on would keep it on; needs a boot-time clear or a zeroed home. The address 0x2004E000 is still a hypothesis until the hardware canary | `ctre/Firmware-Analysis/*.bin`; `tools/ctl.py` RAM |

Q6 (answered in P3d): the Mixer button is frame index 46 (table 0x08059438: source 2, element 1). Stock lights it 0x13 in the Mixer view and 0 with Shift held. A head after the LED task 0x08034196 can overwrite it; shown in emulation by `emu_ctl.py` ("Mixer white, yellow while Shift is held").

Other facts found on the way: the save-lock and Shift stores are double-buffered (a write is visible only after the commit `0x080353C0`); pads, buttons and knobs are reached only through the controller vtable (no direct callers of 0x08033282 / 0x080332FE / 0x08033320).

## External device unknowns

Nothing below is assumed. Each needs a monitor session with the real device, run in M0.5.

| # | Device | Question | Experiment |
|---|---|---|---|
| Q11 | Bitbox Micro | 1010music says incoming MIDI can trigger pads and modulate parameters. In the user's presets, pad *n* listens on MIDI channel *n* (see the `bitbox-instruments` README). Questions: which note numbers trigger in clip/launch modes? Is there a gate vs latch per cell? Which parameters accept CC (mod sources)? Are there bank/preset changes via PC? | Send note sweeps and CC sweeps per channel; log what responds |
| Q12 | Bitbox Micro | Effects or loop "stop/start" via MIDI: is it possible, and is it momentary? | Same session |
| Q13 | Boss VE-500 | CC reception depends on its ASSIGN settings (manual). Which ASSIGN targets give hold-to-enable? Is ASSIGN "momentary" or "toggle" set on the VE-500 side? Is PC used for memories? | Configure ASSIGN, send CC 0/127 holds, observe |
| Q14 | Squarp Hermod+ | Does it accept remote MIDI for mute, pattern or transport? **Manual read 2026-11-20** (squarp.net/hermodplus/manual; details in `catalog/devices/hermod-plus.json`): sequence select by Program Change on the `PROG CHANGE SEQ` channel (SE1–SE16, all tracks at once); transport by following an external clock source (start and stop shown, continue not mentioned); CC→CV on a modulation voice via `INPUT MIDI MOD`; **no MIDI control of mutes is documented**. Still open: program number → sequence mapping, start/stop without clock, any undocumented mute control. | Test with a monitor (needs a probe that can send Program Change, see `10`). Ask Squarp support about mutes |
| Q15 | Pro-800 / Model D / Solina | CC maps: which filter/env CCs exist, and NRPN on the Pro-800? | Vendor MIDI charts plus a monitor check |
| Q16 | CME Thru5 / rig | Channel plan across Circuit (defaults 1, 2, 3, 4, 10, 16), Bitbox (1–8 per pad), CTL and Hermod+. Collisions are likely today | Draw the full channel and port map before M2 (decision D5) |

## Decisions for the owner (conflicts with existing behaviour or standards)

| # | Decision | Options | Our recommendation |
|---|---|---|---|
| D1 | Build base for the prototype | stock 4486 + CTL (loses CH features) / wait for CH space | **stock first**, then port |
| D2 | Mode entry combo | Shift + Mixer / Shift + Drum 1–4 / Shift + 1-16/17-32 | **Shift + Mixer** (dropped by stock, unused in CH) |
| D3 | Should CTL obey the Setup Note/CC/PGM Tx filters? | yes (consistency) / no (separate stream with its own enable) | **no**, but document it; the stock filters keep governing the sequencer |
| D4 | Persistence route after baked-in templates | volatile SysEx / backup SRAM / file on volume 0 / SD file | decide after Q7 and after reading the storage API failure modes |
| D5 | Channel plan of the rig | — | owner decides; CTL defaults avoid 1–4, 10, 16 |
| D6 | Publish the derivative? | keep private / upstream PR / own public fork | ask the upstream author first; never publish binaries |
| D7 | Upstream contribution | propose the feature-profile build upstream | worth raising: it relieves their flash crisis too |
| D9 | Launchpad-comparison conflicts C1–C5 (mixed page, synth/vocal pages, scene pads, virtual faders, LED feedback) | adopt them / keep plan `10` | **Decided 2026-11-19: keep plan `10`.** Revisit triggers are in `11` |
| D10 | Which buttons leave CTL? `03` §6 lists ids 0–8, 13, 15, 18, 26; `09` §1 also names Note, Velocity and Gate | the `03` list / the `09` list | **Open.** The M1 build follows `09` (ids 0–13, 15, 18, 26; `ctl.EXIT_MASK`) |
| D8 | May a CTL build answer the identity request (`fwid`)? It hooks the incoming SysEx dispatcher, which `09` §9 excludes from v1 | yes, as the only exception / no, and `device_info` cannot tell CTL from stock | **yes**, added late (plan `10`, P4) and covered by the CTL-off fuzz |
