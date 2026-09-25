const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const versionElement = document.querySelector("#version");
const buildLabelElement = document.querySelector("#build-label");
const statusElement = document.querySelector("#status");
const updatedBadgeElement = document.querySelector("#updated-badge");
const checkButton = document.querySelector("#check-updates");
const progressElement = document.querySelector("#progress");
const phaseElement = document.querySelector("#progress-phase");
const sizeElement = document.querySelector("#progress-size");
const fillElement = document.querySelector("#progress-fill");
const trackElement = fillElement.parentElement;
const detailElement = document.querySelector("#progress-detail");

let targetVersion = "";

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return unit === 0 ? `${bytes} B` : `${value.toFixed(1)} ${units[unit]}`;
}

function showPhase(label, { percent = null, size = "", detail = "" } = {}) {
  progressElement.hidden = false;
  phaseElement.textContent = label;
  sizeElement.textContent = size;
  detailElement.textContent = detail;
  if (percent === null) {
    fillElement.classList.add("indeterminate");
    fillElement.style.width = "";
    trackElement.removeAttribute("aria-valuenow");
  } else {
    fillElement.classList.remove("indeterminate");
    fillElement.style.width = `${percent}%`;
    trackElement.setAttribute("aria-valuenow", String(Math.round(percent)));
  }
}

function renderProgress(event) {
  switch (event.phase) {
    case "checking":
      showPhase("Checking for updates…");
      break;
    case "found":
      targetVersion = event.version;
      showPhase(`Update ${event.version} found`, { detail: "Preparing download…" });
      break;
    case "downloading": {
      const label = targetVersion ? `Downloading ${targetVersion}` : "Downloading update";
      if (event.total) {
        const percent = Math.min(100, (event.downloaded / event.total) * 100);
        showPhase(label, {
          percent,
          size: `Update size: ${formatBytes(event.total)}`,
          detail: `${formatBytes(event.downloaded)} of ${formatBytes(event.total)} · ${Math.floor(percent)}%`,
        });
      } else {
        showPhase(label, {
          size: event.downloaded ? formatBytes(event.downloaded) : "",
          detail: event.downloaded ? `${formatBytes(event.downloaded)} received` : "Connecting…",
        });
      }
      break;
    }
    case "reconstructing":
      showPhase("Rebuilding installer from patch…", { size: sizeElement.textContent });
      break;
    case "verifying":
      showPhase("Verifying signature…", { size: sizeElement.textContent });
      break;
    case "installing":
      showPhase("Installing — the app will restart", { percent: 100, size: sizeElement.textContent });
      break;
  }
}

async function loadAppInfo() {
  try {
    const info = await invoke("app_info");
    versionElement.textContent = info.version;
    buildLabelElement.textContent = info.buildLabel;
    statusElement.textContent = info.lastResult;
    if (info.lastResult.startsWith(`Updated to ${info.version}`)) {
      updatedBadgeElement.textContent = `✓ Updated to ${info.version}`;
      updatedBadgeElement.hidden = false;
    }
  } catch (error) {
    statusElement.textContent = `error: ${error}`;
  }
}

listen("update-progress", ({ payload }) => renderProgress(payload));

checkButton.addEventListener("click", async () => {
  checkButton.disabled = true;
  targetVersion = "";
  statusElement.textContent = "";
  showPhase("Checking for updates…");

  try {
    statusElement.textContent = await invoke("check_for_updates");
  } catch (error) {
    statusElement.textContent = String(error);
  } finally {
    progressElement.hidden = true;
    checkButton.disabled = false;
  }
});

loadAppInfo();
