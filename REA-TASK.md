# REA Task

1. Target type: Windows game (.exe) - Fallout: New Vegas (GOG copy)
2. Location: C:\Program Files\GOG Galaxy\Games\Fallout New Vegas\FalloutNV.exe
3. Feature: When I load a cell and then leave it, how does the game store the
   positions of the items in it, and how does it restore them when I return?
   (item physics + cell load/unload; position storage/persistence)
4. Desired result: C - own working version built from SPEC.md in ./my-version

Analysis route (Step 3): native (.exe) - https://rea.tools/guides/native - Ghidra provider

Setup log:
- Step 2 done (2026-10-13): `rea setup --client claude_code --yes` applied;
  doctor shows registration:claude_code ok=True. Restart of Claude Code required.
- Node 24.18.0 OK. JDK 21 found: C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot
- Ghidra 12.1.4 installed (2026-10-13) at C:\Users\Matheus Vitorino\tools\ghidra_12.1.4_PUBLIC
  (SHA-256 verified vs GitHub digest). GHIDRA_INSTALL_DIR set (User scope).
  `rea doctor --provider ghidra` -> configured=True available=True, all checks ok.
  Installer zip kept at C:\Users\Matheus Vitorino\tools\ghidra_12.1.4_PUBLIC_20260921.zip (safe to delete).
- Game folder confirmed: FalloutNV.exe (16,084,808 bytes), also Geck.exe present.


- Step 3 (2026-10-13): open_binary with provider ghidra OK (sha256 89e7020487e80f20ddc92ea641c4433b2c6839a82f45a076e414d167d11dd0fe, PE x86).
  binary_overview and search_strings("TESObjectCELL") both failed: provider_timeout 330000 ms.
  Cause (REA source dist/config/ghidraStartupTimeout.js): default Ghidra import+analysis deadline is 330 s;
  configurable via env REA_GHIDRA_STARTUP_TIMEOUT_MS. FalloutNV.exe (16 MB) needs longer.
  DONE: REA_GHIDRA_STARTUP_TIMEOUT_MS=3600000 set in User env (user approved). Old REA session closed.
  After restart: open_binary (ghidra) -> first call may take up to ~60 min; then search_strings TESObjectCELL.

- Step 3 DONE (2026-10-13 after restart): Ghidra analysis completed. search_strings TESObjectCELL -> ev_49be9000d1ad3cd61fd2432bc26719204b4a090e5898f40e6710670421b6ebc4
  (TESObjectCELL.cpp path 0x102ed68, RTTI .?AVTESObjectCELL@@ 0x1183fbc, "CellRefLockEnter" 0x102eaec).
  TIP: close_binary with snapshot_path saves analysis for reuse.



## Step 4 finding ledger (Ghidra session, sha256 89e70204...)
- Strings ev_f45fda1f (SaveLoad), ev_9bdde55a (CHANGE_REFR_*), ev_f0210b37 (unload/detach).
- FUN_0083fef0 (ev_03e1b3b5): change-flag name table. Ref form types 0x3a-0x40,0x69:
  MOVE=0x2, HAVOK_MOVE=0x4, CELL_CHANGED=0x8, SCALE=0x10, INVENTORY=0x20, OWNERSHIP=0x40,
  ANIMATION=0x10000000, FORM_FLAGS=0x1. Cell(0x39): DETACHTIME=0x40000000.
- FUN_00852e40 (ev_9c61861f): per ref in "references map": type via FUN_0084e730(ref,0x3a,..):
  5=created, 6=moved. Reads "unloaded buffer" from changes map. created -> FUN_0084f8e0 recreate;
  moved -> FUN_0084e6a0 find cell/worldspace; interior FUN_00843750(cell,ref), exterior FUN_008438b0(ws,x,y,ref).
  Caller: 0x852d20.
- FUN_008624e0 (ev_9c61861f): validates loaded position (vtbl+500) & angle (FUN_00430830) via FUN_00862430;
  corrupt location -> reset to editor/start location; corrupt angle -> (0,0,0). Caller: 0x85ac30.
- FUN_00864b00 (ev_9c61861f): applies queued havok data / animation to ref. Callers 0x422a40, 0x865390.
- FUN_0083fef0 types: 0x1183fb4=RTTI TESObjectCELL, 0x1183fd0=TESWorldSpace (ev_45ec3742), 0x11841cc=TESObjectREFR.
- FUN_0085ac30 (ev_34926445) = restore position: if REFR && (flags&6): read 0x1c bytes
  [u32 cell/worldspace id][f32 pos x,y,z][f32 rot x,y,z]; SetPos/SetAngle; validate FUN_008624e0;
  interior -> FUN_00573800(ref,cell,0); worldspace -> cell at (x>>12,y>>12) via FUN_005875a0.
  Caller FUN_00858730 = TESSaveLoadGame::LoadForm (string marker), calls 85ac30 then vtbl+0x60 LoadGame.
- FUN_0085a520 (ev_9ad2b0e3) = save position mirror: id = worldspace (exterior) or cell (interior),
  pos FUN_00436aa0, rot FUN_00430830, writes 0x1c bytes only if (flags&6). Caller FUN_00856ca0.
- FUN_00856ca0 (ev_5c2ec802) = save game writer (TESSaveLoadGame.cpp:0x466, "autosave").
  Per changed form: if loaded -> serialize live (10-byte header, size, 85a520, vtbl+0x58);
  else copies pre-existing stored buffer bytes verbatim.
- FUN_00545cf0 (ev_4290cba0) = cell 3D build (TESObjectCELL.cpp:0xd84) -> FUN_00849b10 -> FUN_00852d20
  -> per ref FUN_00852e40 (re-add moved/created refs to this cell).
- FUN_005702e0 (ev_4290cba0) = ref Set3D/unload: when removing 3D, if HasChangeFlag(0x4 HAVOK_MOVE)
  -> FUN_00865020 snapshot physics -> FUN_00422ac0 SetSavedHavokData (extra type 0x3d);
  if flag 0x10000000 -> save animation (extra via FUN_00422940).
- FUN_00422a40 / FUN_00865390 -> FUN_00864b00 apply queued havok/animation data back to ref.
- FUN_0084a6d0 -> FUN_00845720: look up form in changes map (FUN_009a4250) and read flags (INFERRED HasChangeFlag).

UNKNOWN (open):
 U1 Where CHANGE_REFR_MOVE (0x2)/HAVOK_MOVE (0x4) get SET at runtime (setter not located).
 U2 Whether in-session cell unload serializes moved refs into the changes-map "unloaded buffer"
    (FUN_00726070 is a generic getter - dead end). Next: callers of FUN_00866390 / FUN_00852e40 buffer source.
 U3 Exact layout of havok snapshot (FUN_00865020/FUN_0050f9c0).



## Step 4b (U1/U2 follow-up, 2026-10-13)
- FUN_0084e730 (ev_c3e1fdf2) ref classification: 5=created, 6=flag 0x8 CELL_CHANGED, 4=flags&6 (moved in place).
  => FUN_00852e40 "references map" handles CREATED and CELL-CHANGED refs only (re-parent into new cell).
- Change record (ev_bbc5a28e, ev_04752d89): +0 flags (u32), +4 stored buffer ptr.
  FUN_008456e0 get flags; FUN_00845760 get buffer; FUN_008457b0 flags |= v (find-or-create);
  FUN_008458b0 flags = v; FUN_00845960 flags = v + buffer; FUN_00845a20/845a80 remove record.
  Primitives CONFIRMED: 537e90 (=), 841100 (|=), 4280f0 (&!=0).
- FUN_00847df0 (ev_dfb167dc) = load savegame ("***Loading game"). Only caller of 845960/8458b0.
  For saved records whose form is NOT in memory -> stores raw bytes as buffer (FUN_008662c0 -> 845960);
  else applies immediately (FUN_0084f330 -> LoadForm).
  => "unloaded buffer" originates from savegame load; no other static caller found (bounded negative).
- MarkChanged: FUN_0084a690(form,flags,force) -> if FUN_0084a620 allows -> 8457b0 (|=). Wrappers
  FUN_00484b60 (force=0, referenced from ~140 vtable slots) / FUN_00484b90 (force=1). (ev_64752f62, ev_9bf12836, ev_7372fb53)
- U1 RESOLVED for MOVE: FUN_00575830 SetPos (ev_c108a782): writes ref+0x30/0x34/0x38; if |x|or|y|>4,096,000
  or FLT_MAX -> safe pos (vtbl+0x138) and z+10; then vtbl+0x48(2) = MarkChanged(MOVE).
  FUN_00575700 SetAngle (ev_4c33080f): writes ref+0x24/0x28/0x2c, actors normalize z; vtbl+0x48(2).
  Pattern in 56b020/572e50: value==0 -> vtbl+0x4c(flag) (clear) else 484b90(flag) (set). INFERRED +0x48 set / +0x4c clear.
- Still open: HAVOK_MOVE (0x4) setter not located; in-session cell unload = no buffer serialization found;
  INFERRED refs stay in memory (pos/rot on object) while cell is detached; physics snapshot via extra 0x3d.



## Step 6 DONE (2026-10-13)
- SPEC.md written (rules tagged [OBS]/[INF]/[PROJ] with Evidence IDs).
- ./my-version: clean-room JS (Node 22.19+, no deps). `npm test` -> 31/31 pass. `npm run demo` works.
- Ghidra session closed. Snapshot: analysis/FalloutNV-ghidra.rea-snapshot (524 KB, 60 evidence records).
  Reopen: open_binary path=FalloutNV.exe provider_id=ghidra snapshot_path=<that file>.

Open questions (optional follow-ups): HAVOK_MOVE setter; full cell unload/reset (CHANGE_CELL_DETACHTIME);
havok snapshot layout (FUN_0050f9c0); corruption criterion FUN_00862430.

next step: done (optional: resolve open questions above)
