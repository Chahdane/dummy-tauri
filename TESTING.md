# Manual updater test

## Full update now

1. Open the [`app-v1.0.0` release](https://github.com/Chahdane/dummy-tauri/releases/tag/app-v1.0.0).
2. Download and install its artifact for your operating system.
3. Launch DummyTauri 1.0.0. Gatekeeper or SmartScreen will warn because the app is not platform code-signed.
4. Click **Check for updates**.
5. Expect the app to update directly to 1.0.2 and restart. The persisted last result should read **Full**. This is expected: the first update always downloads the complete installer because no official updater artifact is cached yet.

## Delta update after 1.0.3 exists

After requesting and publishing release 1.0.3:

1. Launch the already-updated 1.0.2 installation once, if it is not already running. This promotes the cached 1.0.2 installer to the active delta base.
2. Click **Check for updates**.
3. Expect **TarDelta** on macOS or **DirectDelta** on Windows after restart.
4. If the delta cache is missing, corrupt, or unusable, a **Full** result is a safe and supported fallback rather than an update failure.
