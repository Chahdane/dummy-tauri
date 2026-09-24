use std::{fs, path::PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_updater_delta::{DeltaUpdaterExt, Outcome};

const BUILD_LABEL: &str = "Second release build";
const RESULT_FILE: &str = "last-update-result.txt";

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
    let update = match app.delta_updater().check().await {
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

    let (result, installed) = match outcome {
        Outcome::InstalledFromFullDownload { .. } => ("Full", true),
        Outcome::InstalledFromDirectDelta { .. } => ("DirectDelta", true),
        Outcome::InstalledFromTarDelta { .. } => ("TarDelta", true),
        Outcome::UpToDate { .. } => ("Up to date", false),
        _ => ("Update completed", true),
    };

    persist_result(&app, result)?;
    if installed {
        app.restart();
    }

    Ok(result.to_owned())
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
