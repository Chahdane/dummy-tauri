# Updater demo: 1.1.0 → 1.2.0

DummyTauri is a small todo app. Version 1.1.0 has a plain light design; 1.2.0
is a dark "aurora" redesign with a progress ring, filters and inline editing, so
the update is obvious at a glance. Tasks are stored in the app data directory
and survive the update.

1. Open the [`app-v1.1.0` release](https://github.com/Chahdane/dummy-tauri/releases/tag/app-v1.1.0)
   and download its installer: `DummyTauri_1.1.0_x64-setup.exe` on Windows, or
   `DummyTauri.app.tar.gz` on Apple Silicon macOS (extract it and move
   `DummyTauri.app` to Applications).
2. Install and launch it. Gatekeeper or SmartScreen will warn because the app is
   not platform code-signed. The window opens centered.
3. Tick off or add a few tasks.
4. About a second after launch the app checks for updates by itself and shows a
   **Version 1.2.0 is available** banner with the download size. **Check for
   updates** at the bottom does the same check.
5. Open the banner. The sheet compares this update's download with the full
   installer, read from the release manifest's delta section, e.g. a few hundred
   KB against about 16 MB.
6. Click **Update now**. The sheet steps through download, rebuild, signature
   verification and install, then restarts the app.
7. Version 1.2.0 opens with a welcome screen. It shows the bytes that were
   actually downloaded against the full installer size, and your tasks are
   still there.

## Why the first update can already be a delta

- **Windows:** the 1.1.0 installer runs `src-tauri/windows/delta-seed.nsh`, which
  keeps a copy of itself at `<install dir>\delta-seed\installer.exe`. The plugin
  uses that copy as the DirectDelta base when its size and BLAKE3 match the base
  the 1.2.0 patch declares. This only works for an installation made from the
  exact 1.1.0 release asset.
- **macOS:** the plugin rebuilds the TarDelta base from the installed
  `DummyTauri.app` when its digest matches.

If neither base is available the update falls back to a full download. That is a
supported outcome, not a failure. The welcome screen then reports the full
download size.
