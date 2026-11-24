# CTL controller firmware + device presets (Bitbox Micro, Hermod+) + MCP configurator + upstream improvements

> **Active since 2026-11-19: P2 is done in emulation.** Start at "Status and handoff" just below. The owner intends to continue the build with Claude Sonnet 5.5.
>
> **Revised 2026-11-19** after checking every reference against source (upstream still at `0160e38`; all file:line references below resolve).
> - **Supersedes:** the default template in `09` §3 (its pages 2 and 3 and its four bank assignments) and the Web MIDI page of `07` M0.5. Details under "What this plan replaces".
> - **Added:** one conflict with the `09` spec that needs your decision (D8), the list of decisions still open, the size check for the template slot, and a realistic CI scope.
> - **Corrected:** the `run_tests.sh` path. In `07`, "Q8–Q11" now reads "Q11–Q16".
> - **Removed:** "the quick ARM tests" as a CI step (they take about an hour).
>
> **Second pass, same day:**
> - **Corrected (would have caused a silent failed install):** the install mark came from the template hash alone. It now comes from the whole image. See Track 3, fork helpers.
> - **Added:** a committed ledger of marks; the Bitbox channel-1 omni check in the monitor session; "stop the MCP server before an install".
> - **Removed:** "refuses a mark already installed" as an unconditional rule (it depends on D8). In `05`, R19's "Q8–Q10" now reads "Q11–Q16".

## Status and handoff (2026-11-19)

Read this section, then `09` (the spec), `06` (the tests) and the "Answered during P2" part of `08`. Nothing else is needed to continue.

### Done
- **P2 (roadmap M1), emulation only.** Fork branch `ctl/main`, commit `2675442`, local only.
  - `tools/ctl.py`: the overlay. 444 B of code at 0x0805D400, template slot at 0x0805D000, state in RAM behind a magic word.
  - `tools/build_ctl.py`: builds from the stock image and refuses on any mismatch.
  - `tools/emu_ctl.py`: 31 checks, T-FUZ-1 (12 × 80 events, identical to stock with the mode off) and a first T-FUZ-2. All pass.
- **P3a (remaining pad types), emulation only.** Second commit on `ctl/main`, local only ("Add fixed-note, CC and program-change pad types").
  - `NOTE_FIXED`, `CC_MOMENTARY`, `CC_TOGGLE` and `PROGRAM` in `c_press`; code is now 536 B; RAM block is 148 B (toggle state per page at +8, release records moved to +20).
  - `emu_ctl.py`: T-PAD-2/3/4/5 and T-CH-1 added, plus a second T-FUZ-2 run on a template with every type. Full run passes, T-FUZ-1 included.
  - Toggle state is cleared on entering the mode and nothing is sent for a toggle on leaving.
- **P3b (pages), emulation only.** Third commit on `ctl/main`, local only ("Add three pad pages on Octave down/up").
  - With the mode on, Octave ▼/▲ moves one page and stops at 1 and 3. The press does not reach the stock, so its octave stays. The button's release still reaches the stock; in emulation the stock RAM after seven such presses equals the RAM with none.
  - Code is 620 B; the RAM block is 152 B (page at +8, toggles at +12, release records at +24). Entering the mode always starts on page 1.
  - `emu_ctl.py`: T-PG-1 plus per-page records, per-page toggle state and a held pad from each of two pages on exit. The second T-FUZ-2 run now uses a three-page template. Full run passes, T-FUZ-1 included.
- **P3c (knobs), emulation only.** Fourth commit on `ctl/main`, local only ("Add four knob banks with per-page bank selection").
  - Third head: controller vtable slot 4 (0x0805A110, stock 0x08033848) → `c_knob`. `build_ctl.py` allows that word in the diff.
  - Knob record as in `09` §2. Port mask 0 means unassigned: nothing is sent and the turn doesn't reach the stock view. A knob starts from its min. The delta is read as a signed byte.
  - 1-16/17-32 (id 21) steps the bank 1→4→1 and, like Octave, doesn't reach the stock while the mode is on. `bank_on_enter` sits at body + 960 + page; a value of 4 or more keeps the current bank. Entering the mode applies page 1's bank.
  - Code is 880 B; the RAM block is 188 B (bank at +12, toggles at +16, release records at +28, knob values at +156).
  - `emu_ctl.py`: T-KNB-1/2/3 and T-SAT-1 plus min/max, bank_on_enter, the save lock and the CC at the ports. Full run passes, T-FUZ-1 included.
- **P3d (LEDs), emulation only.** Fifth commit on `ctl/main`, local only ("Add pad, knob, page and bank LEDs").
  - Both calls of the stock LED task (0x08033B46, 0x0803415A) go to `c_led`, which runs the task and then writes CTL's LEDs into the frame. 16 B of stack while the task runs and no call after it; Shift is read inline the way 0x0803542C does.
  - Frame indices, from the table at 0x08059438: pads 0–31, Mixer 46, Octave ▼/▲ 51/52, bank 53, knobs 60–67.
  - **The colour byte is now a family index 0–7**, not a palette code: the stock track palette at 0x08056464 gives `[1+f]` steady and `[9+f]` dim. This narrows `09` §2 ("palette family base"); the baker must write the index.
  - Chosen where `09` §5 was open: Octave LEDs are white where a page exists in that direction; LED 53 is the steady colour of family 0–3 for bank 1–4; a knob LED is its record's steady colour, off if unassigned; Mixer is white while the mode is on.
  - Q6 answered: Mixer is frame index 46 and can be overwritten after the task. It turns yellow while Shift is held, **also with the mode off**. That is the one LED that differs from stock with CTL off, so T-LED-3 holds only without Shift.
  - Code is 1188 B; the RAM block is 192 B (last program change per page at +188).
  - `emu_ctl.py`: T-LED-1/2/3 and T-STACK-1 (+16 B against stock in six views). Only the 0x08033B46 call is exercised; 0x0803415A is patched the same way but not run in emulation.
- **P3e (robustness), emulation only.** Sixth commit on `ctl/main`, local only ("Check the template CRC, leave the mode on load and ignore pads under Clear/Duplicate").
  - Entering the mode now needs the magic, version/pages/banks, body length and the CRC-32 of the body (`c_tok`, bitwise, no table).
  - A pad press while Clear or Duplicate is held does nothing and doesn't reach the stock (store `[[ctrl+0x20]+0xC]`, bits 0/1). This settles the Clear/Duplicate part of Q10.
  - New head: the last instruction of the stock "apply session" (0x0802F5B8, `pop.w`) → `c_load`, which only sets a flag. The next LED frame with the mode on sends every release record and leaves the mode. So the flush runs in the task the pads run in, not in the loader's.
  - **Departure from "no calls in the LED head":** that one frame after a load calls `c_exit` (and through it the stock send). Every other frame makes no call.
  - **Boot is covered by the same head, with no separate boot hook:** upstream `persist19.py:17` says the apply-session end also runs at power-up. A warm reset with the mode on therefore ends at the first frame. This rests on that upstream note; emulation starts from a RAM dump and can't show the boot path. Confirm on hardware.
  - Code is 1352 B; the RAM block is 196 B (the flag at +192).
  - `emu_ctl.py`: T-STK-2, five template-corruption cases, Clear/Duplicate, and a simulated warm reset. Full run passes, T-FUZ-1 included.
- **P1 (workspace, without the MIDI tools) and P4 (baker).** Fork commits `df58051` and `4fe7b74` on `ctl/main`, local only. The workspace is not a git repository yet.
  - Fork: `tools/ctl_template.py` (validates a blob; checks the compiler's layout JSON against `ctl.py`) and `tools/ctl_bake.py` (slot + whole-image mark, masked-SHA check of the base, mark ledger, diff limited to slot and mark, uploader copy). `build_ctl.py` now writes `masked_sha256` to its manifest. A baked image is byte-identical to building with the same template (`emu_ctl.py`).
  - Workspace: npm workspaces, TypeScript strict, run with Node 22 type stripping (no build step). `npm test` (15 tests) and `npm run typecheck`.
  - `packages/profile`: zod schema, `compile`, `decode`, `lint`, `emit-layout`. The default profile compiles to the firmware's default template byte for byte. Colours are the eight family tokens (magenta … teal).
  - `packages/mcp-server` (stdio): `catalog_list/get`, `profile_list/get/validate/preview`, `firmware_build`, `firmware_inspect`. Only `firmware_build` writes, and only `out/` and `profiles/marks.json`.
  - `catalog/devices/`: Bitbox Micro and Hermod+ with every capability unverified. `profiles/default.json`. `local.config.json` (gitignored) holds the fork path, the venv Python and the stock image.
  - **Done after that (2026-11-20), P1b tools, tested with a fake MIDI backend only:** `profile_create/update` (one file under `profiles/`; `default` and `marks` are reserved; a schema failure is not written), `safety.ts` (the allowlist, with unit tests), `list_ports`, `device_info`, `midi_monitor`, `probe_send`, `record_observation`. 26 tests pass; the tests that write run on a temporary copy of the workspace.
  - **Done 2026-11-24: the real MIDI backend.** `@julusian/midi` installed in `packages/mcp-server`; `src/midi-native.ts` (list, send = open/send/close, listen with SysEx in and clock/active sensing out). `CTL_MIDI_BACKEND` = `fake` | `none` | unset (native). `test/midi-live.test.ts` runs with `CTL_MIDI_LIVE=1`: on the owner's Mac the Circuit shows as input and output **"Circuit Tracks MIDI"**. 27 tests pass with the live test, 26 + 1 skipped without; `server.test.ts` now runs its server with `CTL_MIDI_BACKEND=none`.
  - **Not done:** listening to the real unit (`midi_monitor` while the owner presses pads), `device_info` on the real unit (sends two read-only SysEx queries: owner go-ahead), the Bitbox and Hermod+ profiles and the `fwid` identity reply (D8).
  - **Departures from this plan in the P1b tools:** `probe_send` takes structured messages (note, cc, start/continue/stop), not raw bytes, and a note is always sent with its note-off; it also allows start/continue/stop (needed for the Hermod+ `transport` capability) and refuses a list that leaves the transport running; it refuses CC 122 and 124-127 (receiver mode changes). Because it refuses program change, a capability that works by program change cannot be verified with it.
  - **Departure from Track 3:** the layout has two homes (`ctl.py` and `packages/profile/src/layout.ts`); `ctl_template.py layout` fails the workspace tests if they differ. The plan had `ctl_template.py` read the JSON as the only source.
- Q1, Q3, Q4 and Q5 are answered in `08`.
- The Launchpad comparison is revised in `11`; its five conflicts are decided (keep this plan, D9).

### Working rules
- **Never push to `origin`.** It is the upstream author's repository, not a fork of ours. Commit locally on `ctl/main`.
- **No hardware install, flash or device write** without the owner's explicit approval at that moment. Emulation needs no approval.
- Commit messages are one conventional-commit subject line. PR text goes to the owner in chat.
- Claims about firmware behaviour need evidence: an address in `re/app.asm`, a file:line, or an emulation result.
- New Python tools follow the upstream style of `tools/`. New packages in the workspace are TypeScript, strict.

### Set-up
- Python: `~/Personal Repo/circuit-hacks-rc/.venv/bin/python` (3.12, pinned capstone and unicorn).
- `re/`, `ctre` and `stock/*.bin` are gitignored. In a git worktree of the fork, symlink them from the main checkout first.
- Build: `.venv/bin/python tools/build_ctl.py stock/circuittracks-firmware-4486-STOCK.bin -o build/ctl`
- Test (about 3 minutes; `--skip-fuzz` takes about 15 s): `.venv/bin/python tools/emu_ctl.py stock/circuittracks-firmware-4486-STOCK.bin`

### Next steps, in order
Each step ends with the full `emu_ctl.py` run passing, T-FUZ-1 included, and one commit.

1. ~~**P3a — remaining pad types**~~ Done 2026-11-19, see "Done" above.
2. ~~**P3b — pages**~~ Done 2026-11-19, see "Done" above.
3. ~~**P3c — knobs**~~ Done 2026-11-19, see "Done" above.
4. ~~**P3d — LEDs**~~ Done 2026-11-19, see "Done" above.
5. ~~**P3e — robustness**~~ Done 2026-11-19, see "Done" above.
6. ~~**P1 — workspace**~~ Done 2026-11-19 except the items listed under "Done".
7. ~~**P4 — baker**~~ Done 2026-11-19 except the items listed under "Done".

  - **Hermod+ manual read (2026-11-20).** Evidence is in `catalog/devices/hermod-plus.json`; every status stays unverified until the monitor session. `pattern_select` is Program Change on the `PROG CHANGE SEQ` channel and selects a whole sequence, so `probe_send` as specified (refuses program change) cannot verify it: owner decision. `mute` has no documented MIDI control and is likely to be dropped from v1. `transport` needs the Hermod+ clock source set to the port CTL feeds, and probably MIDI clock, which `probe_send` also refuses.
8. ~~The real MIDI backend~~ Done 2026-11-24. **Next:** listen to the Circuit and `device_info` (owner go-ahead); then the P1b monitor session (owner approval and D5 first); the Bitbox and Hermod+ profiles once capabilities are verified; D8; the hardware steps (Q7 canary, rollback drill, first install).

### Stop and ask the owner
- Before P1b, the monitor session: it needs approval and the channel plan (D5).
- Before any hardware install: Q7 (RAM home 0x2004E000 is unconfirmed) and the rollback drill.
- Before the first upstream PR: D6.
- D10 (which buttons leave the mode) and D3 (Tx filters) can wait; the build follows the recommendations in `08`.

## Context
- M0 research (`~/Personal Repo/circuit-tracks-controller/planning/01–09`) found that a native controller mode is feasible.
- Current CIRCUIT-HACKS RCs have only ~2.2 KB of flash left, so CTL is built on the **stock 4486 image** (143 KB free) as an alternative firmware.
- What you asked for:
  1. improve the current CIRCUIT-HACKS firmware/repo;
  2. build the MIDI controller mode in the alternative firmware;
  3. have presets for Bitbox Micro and Hermod+, configured through an **MCP server**.
- Your decisions:
  - **Config is applied at build time.** The MCP bakes the profile into a firmware image, and you install it manually.
  - **One page per device.** Switching page also switches the knob bank: page 1 = Bitbox, page 2 = Hermod+, page 3 = free.
  - **For Hermod+ we want notes, CC→CV, and mute/pattern/transport.** Its remote-MIDI support is unverified, so a monitor session decides what ships.
  - **Client:** Claude Code/Desktop using a stdio MCP on the Mac.
- An MCP cannot run inside the Circuit. It runs on the Mac and talks to the device over USB-MIDI.
- The MCP **never flashes the device or writes its storage**.

## Layout
- **Upstream fork** `~/Personal Repo/circuit-hacks-rc`:
  - one `pr/*` branch per upstream PR;
  - a private `ctl/main` branch for the CTL firmware.
- **Workspace** `~/Personal Repo/circuit-tracks-controller`:
  - npm workspaces, TS strict, `.npmrc` with `registry=https://registry.npmjs.org/` (the global registry is unreachable);
  - `packages/profile`, `packages/mcp-server`;
  - `catalog/devices/{bitbox-micro,hermod-plus}.json`, `catalog/sessions/`, `profiles/`, `fixtures/templates/`;
  - `out/` and `local.config.json` (fork path, venv python, stock .bin), both gitignored.

## Track 1 — Upstream improvements (PRs; every branch keeps `verify_builds` ALL IDENTICAL)
1. `pr/docs-drift`: fix the drift listed in `01` §6.4:
   - the English README release names;
   - the A7PROT base;
   - "no RGB table";
   - the Shift ids;
   - `build_sc17.py:76` MIX_VT;
   - `leds18.py:7-9` LED 48;
   - the `tools/run_tests.sh` header (lines 2–4 still describe the SC20 chain).
2. `pr/smoke-checklist`: per-RC hardware sign-off template in `docs/CHECKLIST.md`, linked from each `PRUEBA.md`.
3. `pr/ramplan`: `tools/ramplan.py` (name, start, len, owner). Add a check in `verify_builds.main()`: no overlaps, and every block inside a measured-free range. This is data only, so no bytes change.
4. `pr/ci`: `.github/workflows/quick.yml` runs `gen_listing` + `verify_builds` + a short named list of ARM tests. Add `.python-version` = 3.12.
   - Not the `run_tests.sh` quick suite: its own header puts it at about 60 minutes (`tools/run_tests.sh:3`).
   - Start the list with tests known to be fast here, such as `emu_mixsolo3.py` (1.5 s on this Mac). Time `verify_builds` before choosing the rest; its full run time is not measured yet.
   - The stock image comes from a secret or a self-hosted runner and is never published. Secrets are not passed to pull requests from forks, so CI can only run on the upstream repo's own branches.
5. `pr/claude-split`: split the 307 KB `CLAUDE.md` into an index plus `docs/arch/*.md`.
6. Feature-profile builder: raise it as an **issue/proposal first**. It is the path for porting CTL into CIRCUIT-HACKS later.
- Commit subjects are one line, conventional style. I'll hand you the PR descriptions in chat. Nothing is pushed or opened without your go-ahead.
- Before the first PR, ask the upstream author whether they want these (decision D6 in `08`).

## Track 2 — CTL firmware (fork branch `ctl/main`)
- **`tools/ctl.py`**: Thumb module written with `tools/thumb.py`. It installs heads on:
  - controller vtable 0x0805A100 slot 0 (pad press 0x08033282, r2 = velocity), slot 1 (release 0x080332FE) and slot 4 (knob 0x08033848);
  - button entry 0x08033320, where Shift+Mixer (id 14) toggles CTL;
  - the LED task call sites 0x08033B46 / 0x0803415A, overwriting frame `[[MGR+0x90]]` after the task. Follow the `leds18.c_ledtask` pattern; no calls and ≤ 16 B stack.
  - MIDI goes out through `0x0803BEDA(portmask, msg)`, following the SC06 precedent. The message format (Q1) and the gate (Q3) are resolved first, by static reading plus an emulation probe.
- **`tools/build_ctl.py`**: modelled on `tools/build_sc03.py`. It reuses the HOOKS disasm checks, the `ct_fw` encode/decode round-trip and the manifest shape. It also calls `fwid.install()`, so `device_info` can read the build mark.
  - **Conflict with the spec (decision D8):** `fwid` works by hooking the incoming SysEx dispatcher at 0x0801EB30 (`tools/fwid.py:9`). `09` §9 excludes incoming SysEx of any kind from v1. See "Decisions still open".
  - The mark `fwid` reports is the same 6 bytes the baker writes (version block, image offset 0x1E8, `tools/fwid.py:23`), so there is one mark, not two.
- **Template slot**:
  - 1024 B at 0x0805D000. Header: `CTLT`, version, pages = 3, banks = 4, length, CRC-32.
  - Body: pads 3×32×8 B, knobs 4×8×6 B, page meta `bank_on_enter`.
  - CTL code goes at 0x0805D400.
  - Size check: the stock image ends at 0x0805CDDC (0x08010000 + 0x4CDDC), so the slot starts 548 B past it. The body is 768 + 192 + 3 = 963 B, which leaves 61 B for the header.
  - A bad magic/CRC means CTL refuses to enter and the device stays stock.
- **Behaviour**: as specified in `09-prototype-spec.md` §1, §2 and §4–§6, plus `bank_on_enter`. The default template in §3 is replaced by the one-page-per-device layout above. Octave ▼/▲ changes page (and bank); 1-16/17-32 cycles through all banks.
- **Tests**: `tools/emu_ctl.py` on `emu_sc05.E` / `emu_sc08.E8`.
  - Reuse: `emu_sc46_3.E.press/release`, `emu_lazysave.EL.at(ms)`, `emu_cscale.EC`, LED TAIL 0x08033B3E, a capture hook at 0x0803BEDA.
  - Add differential fuzz with CTL off vs stock, in the `emu_sc19_fuzz.py` style.

## Track 3 — Presets + MCP
- **`packages/profile`** (zod is the single source of truth):
  - `schema.ts` with Profile, Page, Pad union, Knob and Bank. Colours are **named palette tokens**, not hex.
  - `emit-layout.ts` writes a `layout.json` that `ctl_template.py` reads, so the byte layout is never duplicated.
  - `compile.ts` / `decode.ts` turn a profile into the 1024 B blob and back.
  - `lint.ts` flags:
    - channel collisions (Bitbox pad n = ch n vs Circuit channels 1–4);
    - unverified capabilities;
    - an empty port mask.
- **Device catalog**:
  - Each capability has `status`: verified | unverified | refuted, plus an evidence log.
  - Bitbox: `pad_trigger`, `mod_cc`.
  - Hermod+: `note_in`, `cc_to_cv`, `mute`, `pattern_select`, `transport`.
  - Everything starts unverified.
- **Fork helpers**:
  - `tools/ctl_template.py` validates a blob.
  - `tools/ctl_bake.py base.bin tpl.bin`:
    - checks the base's masked SHA (slot set to 0xFF, mark zeroed) against the manifest;
    - writes the slot and a unique 6-byte mark: `C1` + 4 base36 characters from the hash of the **whole image** (CTL code + template), not the template alone. With a template-only hash, a CTL code fix baked with an unchanged template would keep its mark, and the bootloader would report success while installing nothing;
    - keeps a ledger of marks in `profiles/marks.json`, which is committed (`out/` is gitignored and can be deleted). The same image may be baked again and gets the same mark; a different image that lands on a used mark is refused;
    - can only refuse "already installed" by asking the device, which needs the identity reply (decision D8). Without D8 that check does not exist;
    - asserts the diff stays inside the allowed regions, following the `build_shared_channels.py:200-214` pattern;
    - writes `.syx`, `.bin` and a manifest into `out/<mark>/`.
  - Same profile in, same bytes out.
- **Installing**:
  - Upstream `ct_uploader.html` only sends hashes in its `KNOWN` list (`:72`, `:806`).
  - The baker therefore writes `out/<mark>/ct_uploader.html`, a local copy with that one hash added.
  - Optional later upstream PR: accept a "family" defined by masked hash + slot.
- **`packages/mcp-server`**: `@modelcontextprotocol/sdk`, stdio.
  - MIDI goes through `@julusian/midi` (prebuilt N-API for CoreMIDI), behind a `MidiBackend` interface loaded with dynamic import. If the native module fails, only the MIDI tools fail.
  - `ctremote.py` is Windows-only, so the SysEx helpers are ported from `ctremote.py:43-59` and `hr_app.html:1285-1340`.
  - Tools:
    - `list_ports`;
    - `device_info`: read-only. It sends only a universal inquiry and the 14 B fwid request;
    - `catalog_list/get`;
    - `profile_list/get/create/update/validate`;
    - `profile_preview`: a text grid with labels and verified markers. Meaning never depends on colour alone;
    - `firmware_build`: runs `ctl_bake.py` via the fork venv and writes only `out/`. It is blocked by lint errors, and unverified capabilities need `allowUnverified`;
    - `firmware_inspect`;
    - `midi_monitor` (≤ 60 s);
    - `probe_send`: needs `confirm:true`, max 20 messages, automatic note-offs. It refuses SysEx, program change and any port named "Circuit";
    - `record_observation`: the only tool that changes a capability's status.
  - `safety.ts` holds an allowlist that every outgoing message must pass, with its own unit tests.

## What this plan replaces in `01–09`
- **`09` §3, default template.** Old: page 2 = synth performance (Pro-800, Model D, Solina), page 3 = sequencer and VE-500, banks 1–4 = Bitbox, VE-500, synths, free. New: page 1 = Bitbox, page 2 = Hermod+, page 3 = free, and each page selects its own bank on entry.
- **Devices dropped from v1:** Boss VE-500, Pro-800, Model D and Solina have no catalog entry here. Questions Q13 and Q15 in `08` stay open but block nothing.
- **`07` M0.5, the Web MIDI page.** Replaced by the MCP monitor and probe tools in P1b. The go/no-go rule is unchanged: a capability is verified on the real device or dropped.
- **Phase names.** P2 = `07` M1. P3 = M2 + M3. P4 = M5 step 1. M4 (feedback) and M6 (live hardening) are not in this plan.

## Decisions still open (yours)
| # | Decision | Where it bites | Recommendation |
|---|---|---|---|
| D8 (new) | May a CTL build answer the identity request? It adds one hook on incoming SysEx, which `09` §9 excludes | P2: `build_ctl.py` calls `fwid.install()` | Allow it as the only exception, add it in P4 instead of P2 so the first build has fewer hooks, and add SysEx input to the "CTL off vs stock" fuzz. Without it, `device_info` cannot tell a CTL build from stock |
| D3 | Does CTL obey the Setup Tx filters? | P3 | No, as `08` recommends; document it |
| D5 | Channel plan of the rig. Bitbox pad *n* = channel *n* collides with Circuit channels 1–4 | P1b monitor session, and every Bitbox profile (the lint only flags it) | Decide before the monitor session, or the Bitbox page can't be tested as it will be used |
| D6 | Contact the upstream author before any PR or publication | Track 1, before the first PR | Ask first |
| Q7 | Where the ~200 B of CTL RAM lives on the stock base. Needs a canary build on hardware | Before the first hardware install; P2 and P3 run in emulation without it | Fold the canary into the first approved install |

Already decided: D1 (stock base first), D2 (Shift + Mixer), D4 step 1 (template baked at build time).

## Phases (each gated)
- **P0**: Track 1 PRs, running in parallel with everything else.
- **P1**: scaffold the workspace, `profile`, and the read-only MCP tools.
- **P1b**: monitor, probe and observation tools, then **the Bitbox/Hermod+ monitor session** (needs your approval). Each v1 capability ends verified or is dropped.
  - The session also settles an open Bitbox bench check: whether pad 1 on channel 1 behaves as omni (`bitbox-instruments/README.md:77`). If it does, every CTL message on any channel would trigger pad 1, which changes the channel plan (D5).
- **P2**: `build_ctl.py` + `emu_ctl.py` (M1) in emulation only.
- **P3**: all action types, pages with `bank_on_enter`, banks, LEDs (M2/M3).
- **P4**: `ctl_bake` + `firmware_build`/`inspect` + the uploader copy (M5 step 1).
- **Hardware install of any CTL build**: only with your explicit approval at that time, after the rollback drill (T-HW-0).
  - Stop the MCP server before an install. It shares the Circuit's USB port with the uploader, and a monitor or identity request sent during the transfer could interleave with the firmware SysEx. This is an addition to the pre-flash checklist in `05`.

## Verification
- `tsc --noEmit` is strict-clean. Vitest covers:
  - schema property tests and lints;
  - `safety.ts` rejecting forbidden messages;
  - every tool called over an in-memory MCP transport with a fake MIDI backend;
  - the bake test, run with the real Python and skipped without a stock .bin.
- `decode.ts` writes `fixtures/*.expect.json`. `emu_ctl.py` asserts that the MIDI bytes captured from the real firmware path match it, which keeps the TS and Python sides consistent.
- `emu_ctl.py` must pass:
  - the M1 set: T-PAD-1/6/7, T-ENT-1/2/3, T-STK-1/3, T-FUZ-1, T-BLD-1;
  - `emu_fwid.py` returning the mark;
  - the M2/M3 tests: T-PG-1, T-KNB-*, T-LED-*;
  - a bad-CRC template never entering CTL.
- Two bakes of the same profile are byte-identical. The masked hash is equal across templates, and marks are unique. Two CTL code versions baked with the same template get different marks.
- Upstream PR branches: `python tools/verify_builds.py` → ALL IDENTICAL; `ramplan` reports overlaps or 0.
- Hardware, approval-gated:
  - HW-A: `device_info` on the stock Circuit;
  - HW-B: monitor session;
  - HW-C: install `ctl-base`, then T-HW-0/1/9/3/2/8 from `06-test-plan.md`.
