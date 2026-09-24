const { invoke } = window.__TAURI__.core;

const versionElement = document.querySelector("#version");
const buildLabelElement = document.querySelector("#build-label");
const statusElement = document.querySelector("#status");
const checkButton = document.querySelector("#check-updates");

async function loadAppInfo() {
  try {
    const info = await invoke("app_info");
    versionElement.textContent = info.version;
    buildLabelElement.textContent = info.buildLabel;
    statusElement.textContent = info.lastResult;
  } catch (error) {
    statusElement.textContent = `error: ${error}`;
  }
}

checkButton.addEventListener("click", async () => {
  checkButton.disabled = true;
  statusElement.textContent = "Checking for updates…";

  try {
    statusElement.textContent = await invoke("check_for_updates");
  } catch (error) {
    statusElement.textContent = String(error);
  } finally {
    checkButton.disabled = false;
  }
});

loadAppInfo();
