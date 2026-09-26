import { formatBytes, initUpdater, savingsPercent } from "./update.js";

const { invoke } = window.__TAURI__.core;

const list = document.querySelector("#task-list");
const composer = document.querySelector("#composer");
const input = document.querySelector("#composer-input");
const remaining = document.querySelector("#remaining");
const empty = document.querySelector("#empty");
const emptyText = document.querySelector("#empty-text");
const clearDone = document.querySelector("#clear-done");
const filters = document.querySelector(".filters");
const ringValue = document.querySelector("#ring-value");
const ringPercent = document.querySelector("#ring-percent");

const STARTER_TASKS = [
  "Click “Check for updates” below",
  "Watch how small the update is",
  "Add a task of your own",
];

const EMPTY_TEXT = {
  all: "All clear. Time for a coffee.",
  active: "Nothing active. You're on top of it.",
  done: "Nothing finished yet. You've got this.",
};

let tasks = [];
let filter = "all";

function newTask(text, done = false) {
  return { id: crypto.randomUUID(), text, done, createdAt: Date.now() };
}

function save() {
  invoke("save_todos", { json: JSON.stringify(tasks) }).catch((error) =>
    console.error("saving tasks failed", error),
  );
}

function visibleTasks() {
  if (filter === "active") return tasks.filter((task) => !task.done);
  if (filter === "done") return tasks.filter((task) => task.done);
  return tasks;
}

function render() {
  list.replaceChildren(...visibleTasks().map(renderTask));
  renderStats();
}

function renderStats() {
  const done = tasks.filter((task) => task.done).length;
  const left = tasks.length - done;
  remaining.textContent = `${left} ${left === 1 ? "task" : "tasks"} left`;
  document.querySelector("#count-all").textContent = tasks.length;
  document.querySelector("#count-active").textContent = left;
  document.querySelector("#count-done").textContent = done;
  empty.hidden = list.children.length > 0;
  emptyText.textContent = EMPTY_TEXT[filter];
  clearDone.disabled = done === 0;

  const percent = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  ringValue.style.setProperty("--value", String(percent));
  ringPercent.textContent = `${percent}%`;
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
  text.title = "Double-click to edit";

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "remove";
  remove.dataset.action = "remove";
  remove.setAttribute("aria-label", "Delete task");
  remove.innerHTML =
    '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 11v6m4-6v6M6 7l1 12h10l1-12M9 7V4h6v3" /></svg>';

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
  }, items.length ? 280 : 0);
}

function startEditing(item) {
  const task = tasks.find((candidate) => candidate.id === item.dataset.id);
  const text = item.querySelector(".task-text");
  const field = document.createElement("input");
  field.className = "task-edit";
  field.value = task.text;
  field.maxLength = 140;
  text.replaceWith(field);
  field.focus();
  field.select();

  let finished = false;
  const finish = (commit) => {
    if (finished) return;
    finished = true;
    const value = field.value.trim();
    if (commit && value) {
      task.text = value;
      save();
    }
    render();
  };
  field.addEventListener("keydown", (event) => {
    if (event.key === "Enter") finish(true);
    if (event.key === "Escape") {
      event.stopPropagation();
      finish(false);
    }
  });
  field.addEventListener("blur", () => finish(true));
}

composer.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  const task = newTask(text);
  tasks.unshift(task);
  input.value = "";
  if (filter === "done") setFilter("all");
  save();
  render();
  list.querySelector(`[data-id="${task.id}"]`)?.classList.add("entering");
});

list.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  const item = button?.closest(".task");
  if (!item) return;
  if (button.dataset.action === "toggle") {
    const task = tasks.find((candidate) => candidate.id === item.dataset.id);
    task.done = !task.done;
    save();
    // Update the row in place so its check and strike-through animate; only
    // re-render when the current filter should now hide it.
    item.classList.toggle("done", task.done);
    item.classList.toggle("just-done", task.done);
    button.setAttribute("aria-label", task.done ? "Mark as not done" : "Mark as done");
    renderStats();
    if (filter !== "all") setTimeout(render, 450);
  } else {
    removeWithAnimation([item.dataset.id]);
  }
});

list.addEventListener("dblclick", (event) => {
  const item = event.target.closest(".task");
  if (item && event.target.closest(".task-text")) startEditing(item);
});

function setFilter(next) {
  filter = next;
  const buttons = [...filters.querySelectorAll("[data-filter]")];
  buttons.forEach((button) => button.classList.toggle("active", button.dataset.filter === next));
  filters.style.setProperty("--index", String(buttons.findIndex((b) => b.dataset.filter === next)));
}

filters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  setFilter(button.dataset.filter);
  render();
  list.classList.remove("refresh");
  requestAnimationFrame(() => list.classList.add("refresh"));
});

clearDone.addEventListener("click", () =>
  removeWithAnimation(tasks.filter((task) => task.done).map((task) => task.id)),
);

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

// The celebration shown on the first launch after an update.

function confetti(canvas) {
  const context = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  canvas.width = innerWidth * ratio;
  canvas.height = innerHeight * ratio;
  context.scale(ratio, ratio);
  const colors = ["#f0abfc", "#818cf8", "#5eead4", "#fde68a", "#f9a8d4"];
  const pieces = Array.from({ length: 140 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 80,
    y: innerHeight * 0.35,
    vx: (Math.random() - 0.5) * 11,
    vy: -Math.random() * 11 - 4,
    size: Math.random() * 6 + 4,
    spin: Math.random() * Math.PI,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));
  const started = performance.now();
  function frame(now) {
    const elapsed = now - started;
    context.clearRect(0, 0, innerWidth, innerHeight);
    for (const piece of pieces) {
      piece.vy += 0.28;
      piece.vx *= 0.99;
      piece.x += piece.vx;
      piece.y += piece.vy;
      piece.spin += 0.15;
      context.save();
      context.globalAlpha = Math.max(0, 1 - elapsed / 3200);
      context.translate(piece.x, piece.y);
      context.rotate(piece.spin);
      context.fillStyle = piece.color;
      context.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2);
      context.restore();
    }
    if (elapsed < 3200) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function welcome(record) {
  if (!record || record.seen) return;
  const overlay = document.querySelector("#welcome");
  document.querySelector("#welcome-version").textContent = `v${record.to}`;
  document.querySelector("#welcome-from").textContent = `v${record.from}`;
  document.querySelector("#welcome-to").textContent = `v${record.to}`;
  const percent = savingsPercent(record.downloaded, record.fullSize);
  document.querySelector("#welcome-downloaded").textContent =
    `${formatBytes(record.downloaded)} downloaded`;
  document.querySelector("#welcome-compare").textContent =
    percent !== null
      ? `instead of ${formatBytes(record.fullSize)} · ${percent}% smaller`
      : "full installer";
  overlay.hidden = false;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      overlay.classList.add("visible");
      confetti(document.querySelector("#confetti"));
    }),
  );
  document.querySelector("#welcome-close").addEventListener("click", () => {
    overlay.classList.remove("visible");
    setTimeout(() => (overlay.hidden = true), 400);
  });
  invoke("acknowledge_update");
}

async function start() {
  document.querySelector("#greeting").textContent = greeting();
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
  setFilter("all");
  render();
  document.body.classList.add("ready");
  welcome(info.lastUpdate);
  initUpdater(info.version);
}

start();
