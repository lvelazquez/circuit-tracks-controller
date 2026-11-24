# 05 — Risk register and recovery

Likelihood and impact are rated L, M or H.

## Firmware install and recovery model (as documented upstream, not tested by us)

- **Bootloader** 0x08000000–0x0800FFFF.
  - It erases only sectors 2–5 (0x08010000–0x0807FFFF).
  - It accepts images < 0x70001 B with product ID `01 64` and a matching NOR CRC.
  - It installs only if the 0x26 B version block at image offset 0x1C8 differs from the installed one (`memcmp` at 0x08003BE4). An identical block is silently discarded while still reporting "success" (NOTAS:24-50) **[STATIC/DOC]**.
- **App boot check:** only SP == 0x20050000 is checked. A hanging image still boots into a hang, but the bootloader stays reachable. **Recovery: hold Scales + Preset + Note at power-on, then send the official firmware from Components** **[DOC; Novation documents the same key combo]**.
  - This recovers from **app-image** faults only.
  - It does not protect against code that writes internal flash, option bytes or the NOR staging area. CTL must never do any of these.
- **Transport:** `.syx` built by `ct_fw.py` (CRC-32/MPEG-2; 71 INIT / 7C HEADER / 72 WRITE / 73 FINISH).
  - `ct_uploader.html` sends only SHA-256 values in its `KNOWN` whitelist.
  - `rc_uploader.html` patches the user's stock image in the browser and checks the result's SHA.

## Risk register

| # | Risk | L | I | Mitigation |
|---|---|---|---|---|
| R1 | Install of a hanging image | M | M | Recovery combo. Test the stock-base CTL build in emulation first. First hardware install = a CTL build with the mode **disabled by default**, then enable it. |
| R2 | Bootloader / flash corruption | L | H | CTL contains no flash or option-byte writes (the builder asserts there are no `FLASH_*` register addresses in new code [HYP check to add]). Never modify the bootloader or uploader flow. |
| R3 | Version-block collision: the install is "successful" but nothing changes | M | L | Unique 6-byte marks (`CTL001`, `CTL002`, …), checked by a `verify_builds`-style assertion. |
| R4 | Stuck notes (pad notes, page/exit/project load while held) | M | M | Release records; flush on exit, page change and project load; tests T-STK-*. |
| R5 | Underlying view gets a press without a release | M | M | Forward releases of pads held before entry (stock held bit). Test T-ENT-3. |
| R6 | MIDI send re-entrancy: UI task vs sequencer thread both in the router | M | M | Q2 experiment. If unsafe, queue CTL messages and drain them where stock drains (`0x0802EA4C` precedent). |
| R7 | MIDI feedback loop through the Thru5 / USB merge | M | M | Dedicated CTL channels not used by Circuit tracks. Document the routing. Keep CTL output off ports the user loops back. |
| R8 | Channel collision with the existing rig (user's Bitbox presets: pad *n* listens on channel *n* 1–8, while Circuit defaults use 1, 2, 3, 4, 10, 16) | **H** | M | Audit the channel map before M2 (see `08` Q11). CTL actions name explicit channels. |
| R9 | Sequencer jitter from CTL | L | M | CTL runs only in UI and LED task paths, bounded at 1 message per event, with no loops over steps. HW clock test with an external analyser (T-HW-6). |
| R10 | LED task stack overflow (reset at 1840 B depth, issue #22) | L | H | CTL LED head: no calls, ≤ 16 B stack. Use the upstream `emu_ledstack.py` method. |
| R11 | RAM placement collides with an unknown stock use | M | H | Run the upstream canary method (`tools/memmap.py` on a diagnostic build) before choosing the address. Add a signature word and validate on every access. |
| R12 | Conflicting button combos with stock or mod features | L | M | Fuzz with `emu_sc19_fuzz.py`-style differential runs, mode off vs stock. |
| R13 | On a CH base: chain composition breaks another feature | M | M | Outermost head with pure pass-through when off; differential fuzz versus the same RC without CTL. |
| R14 | Flash exhaustion on a CH base | **H** | M | Stock base first; port only into a profile with measured room. |
| R15 | Project / SD integrity | L | H | CTL v1 writes **nothing**: no settings, project or SD writes. Config is baked into the image. |
| R16 | Licensing / redistribution | M | H | Never commit or publish `.bin` / `.syx`, `re/app.asm`, dumps or SD backups. Publish only builders, tests and manifests, as upstream does. Upstream licence is MIT for its own work and excludes Novation firmware (`LICENSE`). Credit upstream and ask the author before publishing a derivative installer. |
| R17 | Stability of upstream base builds | M | M | The published RC is "pendiente de probar" on hardware; Alpha builds carry a black box for crash records. Do not stack CTL on Alpha. |
| R18 | Live-use surprise: entering CTL steals the knobs from Circuit params | M | L | Clear indicator; one combo to exit; bank 0 can be "pass-through" in v2. |
| R19 | Device behaviour assumptions (Bitbox, Hermod+, VE-500) | H | M | Verify each MIDI implementation with a monitor before the mapping is final (`08` Q11–Q16). |

## Pre-flash checklist (for any future hardware session; requires explicit approval each time)

1. Full SD-card copy, verified.
2. The official 4486 `.syx` at hand, plus a known-good previous build.
3. Build reproduced twice, with the SHA recorded. All CTL emulation tests pass. The 6-byte mark is unique.
4. MIDI routing: the Circuit is alone on USB with the uploader; Thru5 is disconnected during install.
5. After install: power-cycle, confirm the stock workflow (play a project, save nothing), then enter CTL.
6. Rollback drill done once **before** the first CTL install: enter bootloader mode with the key combo and reinstall official firmware.
