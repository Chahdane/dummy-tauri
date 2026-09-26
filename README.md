# DummyTauri

DummyTauri is a small Tauri v2 todo app that demonstrates signed differential updates with [`tauri-plugin-updater-delta`](https://github.com/Chahdane/tauri-updater). Before downloading, the update sheet shows how small the patch is compared with the full installer. The official Tauri updater still checks and installs each release; the delta plugin reconstructs and verifies an exact installer when a usable cached predecessor exists, then falls back to a full download on ordinary delta failures.

## Local development

Requirements:

- Rust 1.88 or newer
- Tauri CLI 2.10.1: `cargo install tauri-cli --version =2.10.1 --locked`
- The normal [Tauri system dependencies](https://v2.tauri.app/start/prerequisites/) for your operating system

Run the app from the repository root:

```sh
cargo tauri dev
```

Validate a release build:

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo tauri build
```

The frontend is plain HTML, CSS, and JavaScript in `src/`. The Tauri crate and configuration live in `src-tauri/`.

## Updates and releases

The app checks the single latest-release endpoint at:

```text
https://github.com/Chahdane/dummy-tauri/releases/latest/download/manifest.json
```

Push a tag named `app-vX.Y.Z` after making the version in `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` match. The release workflow builds an Apple Silicon macOS app and a Windows x86_64 NSIS installer. macOS publishes direct and tar-layer patches when a predecessor is available. Windows publishes a direct patch only when it is smaller than 30% of the full installer.

A new installation has no cached updater artifact, but the first update can still be a delta. On Windows the NSIS hook in `src-tauri/windows/delta-seed.nsh` keeps the installer beside the app as a DirectDelta base. On macOS the plugin rebuilds the TarDelta base from the installed `.app`. When neither base matches, the update falls back to Full. A successful launch promotes the installed artifact to the cache base for later releases.

The workflow requires these repository secrets:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

Only `delta-release` receives these secrets. `cargo tauri build` does not. The private key and password must never be committed, rotated casually, or lost: existing installations cannot trust updates signed with a replacement key.

The release artifacts have a Tauri updater minisign signature, but the app is **not Apple-notarized or Apple code-signed** and the Windows installer is **not Authenticode-signed**. Gatekeeper and SmartScreen will therefore warn during manual installation.

See [TESTING.md](TESTING.md) for the manual updater check.
