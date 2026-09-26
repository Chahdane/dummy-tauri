const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const sheet = document.querySelector("#update-sheet");
const backdrop = document.querySelector("#sheet-backdrop");
const banner = document.querySelector("#update-banner");
const checkButton = document.querySelector("#check-updates");
const downloadFill = document.querySelector("#dl-fill");
const downloadBytes = document.querySelector("#dl-bytes");
const downloadNote = document.querySelector("#dl-note");
const compareFill = document.querySelector("#cmp-patch");
const errorText = document.querySelector("#error-text");
const STEPS = ["download", "rebuild", "verify", "install"];

let available = null;
let currentVersion = "";

export function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  if (unit === 0) return `${bytes} B`;
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export function savingsPercent(downloaded, full) {
  if (!downloaded || !full || downloaded >= full) return null;
  const percent = (1 - downloaded / full) * 100;
  return percent >= 99 ? Math.floor(percent * 10) / 10 : Math.round(percent);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function bind(name, value) {
  for (const element of document.querySelectorAll(`[data-bind="${name}"]`)) {
    element.textContent = value;
  }
}

function openSheet(view) {
  sheet.dataset.view = view;
  if (sheet.hidden) {
    sheet.hidden = false;
    backdrop.hidden = false;
    // Two frames so the hidden -> visible change is painted before the
    // transition starts.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => document.body.classList.add("sheet-open")),
    );
  }
}

async function closeSheet() {
  if (sheet.dataset.view === "installing" || sheet.dataset.view === "restarting") return;
  document.body.classList.remove("sheet-open");
  await sleep(320);
  sheet.hidden = true;
  backdrop.hidden = true;
}

function describeAvailable(info) {
  bind("version", info.version);
  bind("current", info.currentVersion);
  const hasSizes = info.downloadSize && info.fullSize;
  bind("download", info.downloadSize ? formatBytes(info.downloadSize) : "—");
  bind("full", info.fullSize ? formatBytes(info.fullSize) : "—");
  const percent = hasSizes ? savingsPercent(info.downloadSize, info.fullSize) : null;
  sheet.classList.toggle("is-delta", percent !== null);
  bind("percent", percent !== null ? `${percent}%` : "");
  bind(
    "kind",
    info.kind === "patch"
      ? "Delta patch"
      : info.kind === "compressed"
        ? "Compressed download"
        : "Full download",
  );
  const ratio = hasSizes ? Math.min(1, info.downloadSize / info.fullSize) : 1;
  compareFill.style.setProperty("--ratio", String(Math.max(ratio, 0.012)));
  banner.querySelector("#banner-size").textContent = info.downloadSize
    ? percent !== null
      ? `Only ${formatBytes(info.downloadSize)} · ${percent}% smaller`
      : formatBytes(info.downloadSize)
    : `Version ${info.version}`;
  bind("banner-version", info.version);
}

function showBanner() {
  banner.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => banner.classList.add("visible")));
}

function hideBanner() {
  banner.classList.remove("visible");
  setTimeout(() => (banner.hidden = true), 300);
}

async function check({ quiet }) {
  checkButton.disabled = true;
  checkButton.classList.add("busy");
  if (!quiet) openSheet("checking");
  const started = performance.now();
  try {
    available = await invoke("check_for_update");
    if (!quiet) await sleep(Math.max(0, 900 - (performance.now() - started)));
    if (available) {
      describeAvailable(available);
      showBanner();
      if (!quiet) openSheet("available");
    } else {
      hideBanner();
      if (!quiet) {
        bind("current", currentVersion);
        openSheet("latest");
      }
    }
  } catch (error) {
    if (!quiet) {
      errorText.textContent = String(error);
      openSheet("error");
    }
  } finally {
    checkButton.disabled = false;
    checkButton.classList.remove("busy");
  }
}

// Progress events arrive faster than anyone can read them for a small patch.
// Each phase is held on screen briefly; download ticks are coalesced.
const queue = [];
let pumping = false;

function enqueue(event) {
  const last = queue[queue.length - 1];
  if (last && last.phase === "downloading" && event.phase === "downloading") {
    queue[queue.length - 1] = event;
  } else {
    queue.push(event);
  }
  pump();
}

async function pump() {
  if (pumping) return;
  pumping = true;
  while (queue.length) {
    const event = queue.shift();
    renderPhase(event);
    await sleep(event.phase === "downloading" ? 350 : 800);
  }
  pumping = false;
}

function markStep(active) {
  const index = STEPS.indexOf(active);
  for (const element of sheet.querySelectorAll("[data-step]")) {
    const position = STEPS.indexOf(element.dataset.step);
    element.classList.toggle("done", position < index);
    element.classList.toggle("active", position === index);
  }
}

let downloadTotal = 0;

function renderPhase(event) {
  switch (event.phase) {
    case "downloading": {
      markStep("download");
      if (event.total) downloadTotal = event.total;
      const total = downloadTotal;
      const percent = total ? Math.min(100, (event.downloaded / total) * 100) : 0;
      downloadFill.style.setProperty("--progress", String(percent / 100));
      downloadBytes.textContent = total
        ? `${formatBytes(event.downloaded)} of ${formatBytes(total)}`
        : event.downloaded
          ? `${formatBytes(event.downloaded)} received`
          : "Connecting…";
      if (available?.fullSize && total) {
        const percentSaved = savingsPercent(total, available.fullSize);
        downloadNote.textContent =
          percentSaved !== null
            ? `instead of ${formatBytes(available.fullSize)}`
            : "full installer";
      }
      break;
    }
    case "reconstructing":
      downloadFill.style.setProperty("--progress", "1");
      markStep("rebuild");
      break;
    case "verifying":
      downloadFill.style.setProperty("--progress", "1");
      markStep("verify");
      break;
    case "installing":
      markStep("install");
      setTimeout(() => openSheet("restarting"), 700);
      break;
  }
}

async function install() {
  if (!available) return;
  hideBanner();
  downloadTotal = 0;
  downloadFill.style.setProperty("--progress", "0");
  downloadBytes.textContent = "Connecting…";
  downloadNote.textContent = available.fullSize
    ? `full app is ${formatBytes(available.fullSize)}`
    : "";
  markStep("download");
  openSheet("installing");
  try {
    await invoke("install_update");
  } catch (error) {
    errorText.textContent = String(error);
    openSheet("error");
    available = null;
  }
}

export function initUpdater(version) {
  currentVersion = version;
  listen("update-progress", ({ payload }) => enqueue(payload));
  checkButton.addEventListener("click", () => check({ quiet: false }));
  banner.addEventListener("click", () => available && openSheet("available"));
  backdrop.addEventListener("click", closeSheet);
  sheet.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "close") closeSheet();
    if (action === "install") install();
    if (action === "retry") check({ quiet: false });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !sheet.hidden) closeSheet();
  });
  setTimeout(() => check({ quiet: true }), 1200);
}
