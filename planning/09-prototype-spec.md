# 09 — Prototype specification: CTL v1 (stock 4486 base)

Status: **proposal for review**. Device message values are provisional until M0.5 confirms them (Q11–Q16).

## 1. Interaction

| Action | Effect |
|---|---|
| **Shift + Mixer** | Toggle CTL on/off. While Shift is held, Mixer lights yellow `0x2D` (house rule), if Q6 allows |
| Mixer alone, track/view buttons (Synth 1/2, MIDI 1/2, Drum 1–4, Preset, Note, Velocity, Gate, FX, Scales, Projects…) | Exit CTL (with flush), then perform the normal action |
| Play, Record, Tempo/Swing | Pass through: the sequencer and transport are untouched |
| Octave ▼ / ▲ | Page 1 / 2 / 3 (clamped). LEDs 51/52 show where you are |
| 1-16/17-32 | Cycle knob bank 1→4. LED 53 = bank colour |
| Clear / Duplicate held | Pads ignored (no CTL meaning in v1) |
| Pads 1–32 | Configured action of the current page |
| Knobs 1–8 | CC of the current bank |
| Project / pack load | CTL exits with flush |
| Power-on | CTL is always off |

## 2. Pad action record (8 B, flash const)

```text
byte 0  type     0 none · 1 NOTE_GATE · 2 NOTE_FIXED · 3 CC_MOMENTARY · 4 CC_TOGGLE · 5 PROGRAM
byte 1  chan     0–15
byte 2  num      note / CC / program
byte 3  v_on     fixed velocity / CC press-or-on value (ignored for NOTE_GATE: uses pad velocity)
byte 4  v_off    CC release-or-off value
byte 5  ports    bit0 USB · bit1 DIN · bit2 Out2
byte 6  colour   palette family base (see §5)
byte 7  reserved 0
```

Knob record (6 B): `chan, cc, min, max, ports, colour`. Four banks × 8.

## 3. Default template (provisional; replace after M0.5)

**Page 1: Samples / stems (Bitbox Micro).** Channels follow the user's existing presets, where Bitbox pad *n* listens on MIDI channel *n*. **This collides with Circuit defaults 1–4 (decision D5).**
- Pads 1–8 (row 1): `NOTE_GATE`, ch = pad *n*, note = per Q11 → trigger or hold stem *n*.
- Pads 9–16: `CC_TOGGLE` on stem *n* for a mod destination confirmed in Q11 (e.g. filter or mute amount), or none if Bitbox has no such target.
- Pads 17–24: `NOTE_FIXED` one-shots (vel 110).
- Pads 25–32: `CC_MOMENTARY` gestures (press 127, release 0) on targets confirmed in Q12/Q13. VE-500 effect holds go here, with its ASSIGN set to momentary.

**Page 2: Synth performance.**
- Pads 1–16: `NOTE_GATE` chords as single notes in v1, toward the Pro-800 / Model D / Solina on their channels.
- Pads 17–24: `PROGRAM` 0–7 for the Pro-800.
- Pads 25–32: `CC_TOGGLE` for synth switches from Q15.

**Page 3: Sequencer and performance.**
- External triggers toward Hermod+ (only if Q14 confirms remote control).
- VE-500 memory PCs.
- Spare momentary gestures.

**Banks.**
- Bank 1: Bitbox mod CCs (Q11).
- Bank 2: VE-500 / effect CCs (Q13).
- Bank 3: synth filter/env (Q15).
- Bank 4: free / Hermod+ (Q14).

## 4. MIDI message contracts

| Type | Press | Release | Notes |
|---|---|---|---|
| NOTE_GATE | `9c nn vel` (pad vel, min 1) | note-off form per Q4 | release record stored at press |
| NOTE_FIXED | `9c nn v_on` | note-off | — |
| CC_MOMENTARY | `Bc cc v_on` | `Bc cc v_off` | — |
| CC_TOGGLE | `Bc cc (state ? v_off : v_on)`, state flips | — | state is **locally commanded**, not confirmed |
| PROGRAM | `Cc pp` | — | — |
| Knob | `Bc cc val` when the clamped value changes | — | val = clamp(val + delta, min, max); initial = min |
| Exit / flush | every stored release record is sent | — | also on page change? **No**: records survive a page change, and each pad's own release sends it |

CTL messages bypass the Setup Tx filters (D3) and are never injected into Circuit's own engines.

## 5. LED states

Palette codes only. Each family's steady / dim / blink / pulse variants must be confirmed in emulation with the real converter (`emu_sc19_6.E196.conv`) before they are final.

| State | Pad LED |
|---|---|
| Unassigned | off (0) |
| Assigned, idle | family **dim** |
| Pressed / held (gate, momentary) | family **steady** |
| Toggle on | family **steady**; off = dim |
| PROGRAM last sent on this page | white `0x01` |
| Mode indicator | Octave ▼/▲ = page (lit/unlit pattern), LED 53 = bank colour, Mixer = yellow while Shift is held (Q6) |
| Knob LEDs | bank colour (static code); value brightness lands in M3 |

Family colours by destination: Bitbox = one family, synths = another, effects = a third. They are chosen from the confirmed track palette (`0x32, 0x20, 0x09, 0x3B, 0x45, 0x2D, 0x49, 0x4D`) so they don't look like Shift yellow `0x2D`. **State is always carried by brightness (dim vs steady) as well as hue**, so the layout works for colour-blind users and in coloured stage light. v1 uses **no blinking**; M4 may add it, but never as the only carrier of meaning.

## 6. Mode-switch behaviour (acceptance)

1. Entering never changes the active view pointer `[ctrl+0x6C]`, and never stops or restarts the transport.
2. Pads held at entry belong to the stock view until released.
3. Exit sends every outstanding release record before control returns to the stock view.
4. After exit, the LED frame is byte-identical to what the base build would draw.
5. With CTL off, behaviour is state-identical to stock (differential fuzz).

## 7. Test fixtures

- `tools/emu_ctl.py` (our fork), built on `emu_sc05.E` / `emu_sc08.E8`.
- Capture hook at `0x0803BEDA`. HAL tick control via the `[0x2000081C]` write (`EL.at(ms)` pattern).
- Frame read via LED TAIL `0x08033B3E`.
- A generated "all types × all channels" template for T-CH-1.
- The tests in `06` marked M1/M2.

## 8. Resource estimate [HYP]

| Item | Flash | RAM |
|---|---|---|
| Hooks + handlers (press, release, knob, buttons, flush) | 1.2–2.0 KB | — |
| LED overwrite head | 0.2–0.3 KB | — |
| Config (3 × 32 × 8 + 4 × 8 × 6) | 0.96 KB | — |
| State (§5 of `03`) | — | ≈ 150–200 B |
| **Total** | **≈ 2.4–3.3 KB** | **≈ 200 B** |

## 9. Explicitly excluded from v1

- Multi-message macros and chords as a single pad.
- Relative CC, acceleration, NRPN.
- Incoming MIDI/SysEx of any kind (no feedback, no editor link).
- Runtime-editable or persisted templates. The config is baked into the image; no settings, project or SD writes.
- Internal Circuit actions from pads (mute, scene, pattern): use the stock Mixer and Scenes views.
- Launchpad/DAW protocol emulation.
- Any DSP change.
- Any CIRCUIT-HACKS feature (stock base).
