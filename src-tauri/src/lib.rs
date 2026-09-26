use std::{fs, path::PathBuf, sync::Mutex, time::Duration};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::UpdaterExt;
use tauri_plugin_updater_delta::{DeltaUpdaterExt, Outcome, ProgressEvent, Update};

const TODOS_FILE: &str = "todos.json";
const UPDATE_RECORD_FILE: &str = "last-update.json";
const PROGRESS_EVENT: &str = "update-progress";
const INSTALL_HANDOFF_PAUSE: Duration = Duration::from_millis(2200);

fn data_path(app: &AppHandle, file: &str) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("could not find app data directory: {error}"))?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("could not create app data directory: {error}"))?;
    Ok(directory.join(file))
}

/// What the manifest says this update will cost, before anything downloads.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateInfo {
    version: String,
    current_version: String,
    notes: Option<String>,
    /// Bytes the expected source downloads: a patch when the manifest has one
    /// from the running version, otherwise the (compressed) full installer.
    download_size: Option<u64>,
    full_size: Option<u64>,
    kind: &'static str,
}

/// Saved before the installer takes over, so the next launch can say what
/// happened. On Windows the handoff exits this process.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateRecord {
    from: String,
    to: String,
    downloaded: u64,
    full_size: Option<u64>,
    source: Option<String>,
    #[serde(default)]
    seen: bool,
}

fn write_record(app: &AppHandle, record: &UpdateRecord) {
    if let Ok(path) = data_path(app, UPDATE_RECORD_FILE) {
        if let Ok(json) = serde_json::to_string(record) {
            let _ = fs::write(path, json);
        }
    }
}

fn read_record(app: &AppHandle) -> Option<UpdateRecord> {
    let text = fs::read_to_string(data_path(app, UPDATE_RECORD_FILE).ok()?).ok()?;
    serde_json::from_str(&text).ok()
}

/// Bytes downloaded across every download of one install, since a failed
/// delta attempt falls back to another download that restarts at zero.
#[derive(Default)]
struct DownloadTally {
    finished: u64,
    current: u64,
}

impl DownloadTally {
    fn record(&mut self, downloaded: u64) {
        if downloaded < self.current {
            self.finished += self.current;
        }
        self.current = downloaded;
    }

    fn total(&self) -> u64 {
        self.finished + self.current
    }
}

#[derive(Default)]
struct Pending {
    update: Mutex<Option<Update>>,
    info: Mutex<Option<UpdateInfo>>,
    tally: Mutex<DownloadTally>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "phase", rename_all = "camelCase")]
enum ProgressPayload {
    Downloading { downloaded: u64, total: Option<u64> },
    Reconstructing,
    Verifying,
    Installing,
}

fn estimate(raw: &Value, target: &str, current: &str) -> (Option<u64>, Option<u64>, &'static str) {
    let Some(platform) = raw.pointer(&format!("/delta/platforms/{target}")) else {
        return (None, None, "full");
    };
    let size = |value: Option<&Value>| value.and_then(Value::as_u64);
    let full = size(platform.get("target_installer_size"));
    let tar_patch = platform
        .pointer("/tar_layer/patches")
        .and_then(|patches| patches.get(current));
    let direct_patch = platform
        .get("patches")
        .and_then(|patches| patches.get(current));
    if let Some(patch) = tar_patch.or(direct_patch) {
        return (size(patch.get("patch_size")), full, "patch");
    }
    if let Some(compressed) = size(platform.pointer("/compressed_full/size")) {
        return (Some(compressed), full, "compressed");
    }
    (full, full, "full")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    version: String,
    last_update: Option<UpdateRecord>,
}

#[tauri::command]
fn app_info(app: AppHandle) -> AppInfo {
    let version = app.package_info().version.to_string();
    let last_update = read_record(&app).filter(|record| record.to == version);
    AppInfo {
        version,
        last_update,
    }
}

#[tauri::command]
fn acknowledge_update(app: AppHandle) {
    if let Some(mut record) = read_record(&app) {
        record.seen = true;
        write_record(&app, &record);
    }
}

#[tauri::command]
fn load_todos(app: AppHandle) -> Option<String> {
    fs::read_to_string(data_path(&app, TODOS_FILE).ok()?).ok()
}

#[tauri::command]
fn save_todos(app: AppHandle, json: String) -> Result<(), String> {
    fs::write(data_path(&app, TODOS_FILE)?, json)
        .map_err(|error| format!("could not save tasks: {error}"))
}

#[tauri::command]
async fn check_for_update(
    app: AppHandle,
    pending: State<'_, Pending>,
) -> Result<Option<UpdateInfo>, String> {
    let progress = {
        let app = app.clone();
        move |event: ProgressEvent| {
            let pending = app.state::<Pending>();
            let payload = match event {
                ProgressEvent::Downloading => ProgressPayload::Downloading {
                    downloaded: 0,
                    total: None,
                },
                ProgressEvent::DownloadProgress { downloaded, total } => {
                    pending.tally.lock().unwrap().record(downloaded);
                    ProgressPayload::Downloading { downloaded, total }
                }
                ProgressEvent::Reconstructing => ProgressPayload::Reconstructing,
                ProgressEvent::Verifying => ProgressPayload::Verifying,
                ProgressEvent::Installing => {
                    let _ = app.emit(PROGRESS_EVENT, ProgressPayload::Installing);
                    // Runs on the install's blocking thread. On Windows the
                    // handoff exits this process, so give the window a moment
                    // to show that the update landed.
                    std::thread::sleep(INSTALL_HANDOFF_PAUSE);
                    if let Some(info) = pending.info.lock().unwrap().as_ref() {
                        write_record(
                            &app,
                            &UpdateRecord {
                                from: info.current_version.clone(),
                                to: info.version.clone(),
                                downloaded: pending.tally.lock().unwrap().total(),
                                full_size: info.full_size,
                                source: None,
                                seen: false,
                            },
                        );
                    }
                    return;
                }
                _ => return,
            };
            let _ = app.emit(PROGRESS_EVENT, payload);
        }
    };

    let update = app
        .delta_updater()
        .check_with(progress)
        .await
        .map_err(|error| format!("Update check failed: {error}"))?;
    let Some(update) = update else {
        *pending.update.lock().unwrap() = None;
        return Ok(None);
    };

    // The delta check keeps Tauri's manifest private; the official updater
    // exposes it, including the delta section with patch and full sizes.
    let sizes = match app.updater() {
        Ok(updater) => match updater.check().await {
            Ok(Some(official)) => estimate(
                &official.raw_json,
                &official.target,
                update.current_version(),
            ),
            _ => (None, None, "full"),
        },
        Err(_) => (None, None, "full"),
    };

    let info = UpdateInfo {
        version: update.version().to_owned(),
        current_version: update.current_version().to_owned(),
        notes: update.notes().map(str::to_owned),
        download_size: sizes.0,
        full_size: sizes.1,
        kind: sizes.2,
    };
    *pending.info.lock().unwrap() = Some(info.clone());
    *pending.update.lock().unwrap() = Some(update);
    Ok(Some(info))
}

#[tauri::command]
async fn install_update(app: AppHandle, pending: State<'_, Pending>) -> Result<(), String> {
    let update = pending
        .update
        .lock()
        .unwrap()
        .take()
        .ok_or("No update is ready to install. Check for updates first.")?;
    *pending.tally.lock().unwrap() = DownloadTally::default();

    let outcome = update
        .install()
        .await
        .map_err(|error| format!("Update failed: {error}"))?;
    for diagnostic in outcome.diagnostics() {
        log::warn!("{diagnostic}");
    }

    let source = match &outcome {
        Outcome::InstalledFromFullDownload { .. } => "Full",
        Outcome::InstalledFromCompressedFullDownload { .. } => "CompressedFull",
        Outcome::InstalledFromDirectDelta { .. } => "DirectDelta",
        Outcome::InstalledFromTarDelta { .. } => "TarDelta",
        _ => return Ok(()),
    };
    if let Some(info) = pending.info.lock().unwrap().as_ref() {
        write_record(
            &app,
            &UpdateRecord {
                from: info.current_version.clone(),
                to: info.version.clone(),
                downloaded: outcome
                    .downloaded_bytes()
                    .unwrap_or_else(|| pending.tally.lock().unwrap().total()),
                full_size: outcome.full_artifact_size().or(info.full_size),
                source: Some(source.to_owned()),
                seen: false,
            },
        );
    }
    app.restart();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Pending::default())
        .invoke_handler(tauri::generate_handler![
            app_info,
            acknowledge_update,
            load_todos,
            save_todos,
            check_for_update,
            install_update
        ])
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_updater_delta::Builder::new().build())
        .run(tauri::generate_context!())
        .expect("error while running DummyTauri");
}
