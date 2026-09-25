use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater_delta::{DeltaUpdaterExt, Outcome, ProgressEvent};

const BUILD_LABEL: &str = "Third release build · green";
const RESULT_FILE: &str = "last-update-result.txt";
const PROGRESS_EVENT: &str = "update-progress";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    version: String,
    build_label: &'static str,
    last_result: String,
}

fn result_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("could not find app data directory: {error}"))?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("could not create app data directory: {error}"))?;
    Ok(directory.join(RESULT_FILE))
}

fn persist_result(app: &AppHandle, result: &str) -> Result<(), String> {
    fs::write(result_path(app)?, result)
        .map_err(|error| format!("could not save update result: {error}"))
}

fn read_last_result(app: &AppHandle) -> String {
    result_path(app)
        .and_then(|path| {
            fs::read_to_string(path)
                .map_err(|error| format!("could not read last update result: {error}"))
        })
        .unwrap_or_else(|_| "No update checked yet".to_owned())
}

#[derive(Clone, Serialize)]
#[serde(tag = "phase", rename_all = "camelCase")]
enum ProgressPayload {
    Checking,
    Found {
        version: String,
    },
    #[serde(rename_all = "camelCase")]
    Downloading {
        downloaded: u64,
        total: Option<u64>,
    },
    Reconstructing,
    Verifying,
    Installing,
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

fn format_bytes(bytes: u64) -> String {
    const UNITS: [&str; 4] = ["B", "KB", "MB", "GB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1000.0 && unit < UNITS.len() - 1 {
        value /= 1000.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{bytes} B")
    } else {
        format!("{value:.1} {}", UNITS[unit])
    }
}

fn describe_outcome(outcome: &Outcome) -> String {
    let source = match outcome {
        Outcome::InstalledFromFullDownload { .. } => "Full",
        Outcome::InstalledFromCompressedFullDownload { .. } => "CompressedFull",
        Outcome::InstalledFromDirectDelta { .. } => "DirectDelta",
        Outcome::InstalledFromTarDelta { .. } => "TarDelta",
        Outcome::UpToDate { .. } => return "Up to date".to_owned(),
        _ => "Update completed",
    };
    match (outcome.downloaded_bytes(), outcome.full_artifact_size()) {
        (Some(downloaded), Some(full)) if downloaded < full => format!(
            "{source} · downloaded {} instead of {}",
            format_bytes(downloaded),
            format_bytes(full)
        ),
        (Some(downloaded), _) => format!("{source} · downloaded {}", format_bytes(downloaded)),
        _ => source.to_owned(),
    }
}

#[tauri::command]
fn app_info(app: AppHandle) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        build_label: BUILD_LABEL,
        last_result: read_last_result(&app),
    }
}

#[tauri::command]
async fn check_for_updates(app: AppHandle) -> Result<String, String> {
    let tally = Arc::new(Mutex::new(DownloadTally::default()));
    let target_version = Arc::new(Mutex::new(String::new()));
    let progress = {
        let app = app.clone();
        let tally = Arc::clone(&tally);
        let target_version = Arc::clone(&target_version);
        move |event: ProgressEvent| {
            let payload = match event {
                ProgressEvent::Checking => ProgressPayload::Checking,
                ProgressEvent::Downloading => ProgressPayload::Downloading {
                    downloaded: 0,
                    total: None,
                },
                ProgressEvent::DownloadProgress { downloaded, total } => {
                    tally.lock().unwrap().record(downloaded);
                    ProgressPayload::Downloading { downloaded, total }
                }
                ProgressEvent::Reconstructing => ProgressPayload::Reconstructing,
                ProgressEvent::Verifying => ProgressPayload::Verifying,
                ProgressEvent::Installing => {
                    // On Windows the installer takes over and this process
                    // exits, so the result is saved before the handoff.
                    let version = target_version.lock().unwrap().clone();
                    let downloaded = tally.lock().unwrap().total();
                    let _ = persist_result(
                        &app,
                        &format!(
                            "Updated to {version} · downloaded {}",
                            format_bytes(downloaded)
                        ),
                    );
                    ProgressPayload::Installing
                }
                _ => return,
            };
            let _ = app.emit(PROGRESS_EVENT, payload);
        }
    };

    let update = match app.delta_updater().check_with(progress).await {
        Ok(update) => update,
        Err(error) => {
            let result = format!("error: update check failed: {error}");
            let _ = persist_result(&app, &result);
            return Err(result);
        }
    };

    let Some(update) = update else {
        let result = "Up to date".to_owned();
        persist_result(&app, &result)?;
        return Ok(result);
    };

    *target_version.lock().unwrap() = update.version().to_owned();
    let _ = app.emit(
        PROGRESS_EVENT,
        ProgressPayload::Found {
            version: update.version().to_owned(),
        },
    );

    let outcome = match update.install().await {
        Ok(outcome) => outcome,
        Err(error) => {
            let result = format!("error: update failed: {error}");
            let _ = persist_result(&app, &result);
            return Err(result);
        }
    };

    for diagnostic in outcome.diagnostics() {
        log::warn!("{diagnostic}");
    }

    let installed = outcome.source().is_some();
    let result = describe_outcome(&outcome);
    persist_result(&app, &result)?;
    if installed {
        app.restart();
    }

    Ok(result)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![app_info, check_for_updates])
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_updater_delta::Builder::new().build())
        .run(tauri::generate_context!())
        .expect("error while running DummyTauri");
}
