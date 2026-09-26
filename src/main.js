import { formatBytes, initUpdater, savingsPercent } from "./update.js";

const { invoke } = window.__TAURI__.core;

const list = document.querySelector("#task-list");
const composer = document.querySelector("#composer");
const input = document.querySelector("#composer-input");
const remaining = document.querySelector("#remaining");
const empty = document.querySelector("#empty");
const clearDone = document.querySelector("#clear-done");
const toast = document.querySelector("#toast");

const STARTER_TASKS = [
  "Click “Check for updates” below",
  "Watch how small the update is",
  "Add a task of your own",
];

let tasks = [];

function newTask(text, done = false) {
  return { id: crypto.randomUUID(), text, done, createdAt: Date.now() };
}

function save() {
  invoke("save_todos", { json: JSON.stringify(tasks) }).catch((error) =>
    console.error("saving tasks failed", error),
  );
}

function render() {
  list.replaceChildren(...tasks.map(renderTask));
  const left = tasks.filter((task) => !task.done).length;
  remaining.textContent = `${left} ${left === 1 ? "task" : "tasks"} left`;
  empty.hidden = tasks.length > 0;
  clearDone.disabled = !tasks.some((task) => task.done);
}

function renderTask(task) {
  const item = document.createElement("li");
  item.className = "task";
  item.dataset.id = task.id;
  item.classList.toggle("done", task.done);

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "check";
  toggle.dataset.action = "toggle";
  toggle.setAttribute("aria-label", task.done ? "Mark as not done" : "Mark as done");
  toggle.innerHTML = '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>';

  const text = document.createElement("span");
  text.className = "task-text";
  text.textContent = task.text;

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "remove";
  remove.dataset.action = "remove";
  remove.setAttribute("aria-label", "Delete task");
  remove.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>';

  item.append(toggle, text, remove);
  return item;
}

function removeWithAnimation(ids) {
  const items = ids
    .map((id) => list.querySelector(`[data-id="${id}"]`))
    .filter(Boolean);
  for (const item of items) item.classList.add("leaving");
  setTimeout(() => {
    tasks = tasks.filter((task) => !ids.includes(task.id));
    save();
    render();
  }, items.length ? 220 : 0);
}

composer.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  const task = newTask(text);
  tasks.unshift(task);
  input.value = "";
  save();
  render();
  list.querySelector(`[data-id="${task.id}"]`)?.classList.add("entering");
});

list.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  const id = button?.closest(".task")?.dataset.id;
  if (!id) return;
  if (button.dataset.action === "toggle") {
    const task = tasks.find((candidate) => candidate.id === id);
    task.done = !task.done;
    save();
    render();
  } else {
    removeWithAnimation([id]);
  }
});

clearDone.addEventListener("click", () =>
  removeWithAnimation(tasks.filter((task) => task.done).map((task) => task.id)),
);

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add("visible")));
  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => (toast.hidden = true), 400);
  }, 6000);
}

function announceUpdate(record) {
  if (!record || record.seen) return;
  const percent = savingsPercent(record.downloaded, record.fullSize);
  const size =
    percent !== null
      ? `downloaded ${formatBytes(record.downloaded)} instead of ${formatBytes(record.fullSize)}`
      : `downloaded ${formatBytes(record.downloaded)}`;
  showToast(`Updated from ${record.from} to ${record.to} · ${size}`);
  invoke("acknowledge_update");
}

async function start() {
  document.querySelector("#today").textContent = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const [info, saved] = await Promise.all([invoke("app_info"), invoke("load_todos")]);
  document.querySelector("#version").textContent = info.version;

  try {
    tasks = saved ? JSON.parse(saved) : null;
  } catch {
    tasks = null;
  }
  if (!Array.isArray(tasks)) {
    tasks = STARTER_TASKS.map((text) => newTask(text));
    save();
  }
  render();
  announceUpdate(info.lastUpdate);
  initUpdater(info.version);
}

start();
