/* JARVIS - the browser half.
 *
 * No framework and no build step: this is a single-user application talking to
 * a server on loopback, and a toolchain would be more moving parts than the
 * thing it builds. If a later phase needs components, it can add them then.
 */

"use strict";

const state = {
  user: null,
  view: "dashboard",
  conversations: [],
  activeConversation: null,
  settings: null,
  streaming: false,
  voice: null,
  listening: false,
  activeVersion: null,
};

/* Every way in. Commands open drawers over the thread; the thread itself is the
 * page. Keeping the roadmap in one object means the palette and the drawers can
 * never disagree about what is built - and what is not says so rather than
 * pretending. */
const COMMANDS = [
  { id: "today",     cmd: "/today",     label: "Today",         desc: "What is due, what is late, the state of things" },
  { id: "tasks",     cmd: "/tasks",     label: "Tasks",         desc: "Deadlines, grouped the way you read a day" },
  { id: "memory",    cmd: "/memory",    label: "Memory",        desc: "What JARVIS knows about you" },
  { id: "files",     cmd: "/files",     label: "Files",         desc: "Documents it can search" },
  { id: "notes",     cmd: "/notes",     label: "Notes",         desc: "Written here, indexed like documents" },
  { id: "knowledge", cmd: "/find",      label: "Find",          desc: "One search across memory, files and past threads" },
  { id: "threads",   cmd: "/threads",   label: "Conversations", desc: "Past threads" },
  { id: "improve",   cmd: "/improve",   label: "Improvement",   desc: "How it is doing, and what to change" },
  { id: "settings",  cmd: "/settings",  label: "Settings",      desc: "Model, voice, key, delete everything" },
  { id: "new",       cmd: "/new",       label: "New conversation", desc: "Start a fresh thread", run: () => newConversation() },
  { id: "rail",      cmd: "/rail",      label: "Toggle instruments", desc: "Show or hide the readings", run: () => toggleRail() },
  { id: "lock",      cmd: "/lock",      label: "Lock",          desc: "End this session", run: () => $("#lock-button").click() },
  { id: "calendar",  cmd: "/calendar",  label: "Calendar",      desc: "Not built yet - phase 5", soon: true },
  { id: "school",    cmd: "/school",    label: "School",        desc: "Not built yet - phase 5", soon: true },
  { id: "projects",  cmd: "/projects",  label: "Projects",      desc: "Not built yet - phase 5", soon: true },
];
const DRAWER_LOADERS = {
  today: () => loadDashboard(),
  settings: () => loadSettings(),
  tasks: () => loadTasks(),
  memory: () => loadMemories(),
  files: () => loadDocuments(),
  notes: () => loadNotes(),
  knowledge: () => $("#knowledge-search").focus(),
  improve: () => loadImprovement(),
  threads: () => loadConversations(),
};

/* --- server ------------------------------------------------------------- */

/* Every state-changing request carries this header. A browser will not attach a
 * custom header cross-origin without a preflight the server never answers, so
 * this is what stops another page acting as you. */
const CLIENT_HEADER = { "X-Jarvis-Client": "web" };

async function api(method, path, body) {
  const options = { method, headers: { ...CLIENT_HEADER } };
  if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const response = await fetch(path, options);
  /* A 401 from anywhere else means the session went; a 401 from the login call
   * means the password was wrong. Treating them the same put "Locked." on the
   * lock screen in place of the reason, which is the one moment the reason
   * matters. */
  if (response.status === 401 && !path.startsWith("/api/auth/login")) {
    showLock();
    throw new Error("Locked.");
  }
  if (!response.ok) {
    let detail = `${response.status}`;
    try {
      const payload = await response.json();
      if (payload && payload.detail) detail = payload.detail;
    } catch (_) { /* a non-JSON error body is still an error */ }
    throw new Error(detail);
  }
  if (response.status === 204) return null;
  return response.json();
}

const get = (path) => api("GET", path);

async function postForm(path, formData) {
  const response = await fetch(path, { method: "POST", headers: { ...CLIENT_HEADER }, body: formData });
  if (response.status === 401) { showLock(); throw new Error("Locked."); }
  if (!response.ok) {
    let detail = `${response.status}`;
    try { const payload = await response.json(); if (payload && payload.detail) detail = payload.detail; } catch (_) { /* not JSON */ }
    throw new Error(detail);
  }
  return response.json();
}

/* --- helpers ------------------------------------------------------------ */

/* Assistant status. Every state here corresponds to something the system is
 * actually doing; nothing sets it decoratively. */
function setStatus(state, label) {
  const node = $("#status");
  if (!node) return;
  node.dataset.state = state;
  $("#status-label").textContent = label || state;
}

const $ = (selector) => document.querySelector(selector);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* A deliberately small Markdown subset: fenced code, inline code, bold, italic,
 * headings, lists, paragraphs. Escaping happens first and nothing after it ever
 * inserts untrusted text, so there is no path from a model response to script
 * execution. */
function renderMarkdown(source) {
  const blocks = [];
  let text = escapeHtml(source);

  text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    blocks.push(`<pre><code>${code.replace(/\n$/, "")}</code></pre>`);
    return `  ${blocks.length - 1}  `;
  });

  const lines = text.split("\n");
  const out = [];
  let list = null;

  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const placeholder = line.match(/^  (\d+)  $/);
    if (placeholder) { closeList(); out.push(blocks[Number(placeholder[1])]); continue; }
    if (!line.trim()) { closeList(); continue; }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) { closeList(); out.push(`<h3>${inline(heading[2])}</h3>`); continue; }

    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      if (list !== "ul") { closeList(); out.push("<ul>"); list = "ul"; }
      out.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (numbered) {
      if (list !== "ol") { closeList(); out.push("<ol>"); list = "ol"; }
      out.push(`<li>${inline(numbered[1])}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join("");
}

function inline(text) {
  return text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>");
}

function when(iso) {
  if (!iso) return "";
  const date = new Date(iso.endsWith("Z") ? iso : iso + "Z");
  const minutes = (Date.now() - date.getTime()) / 60000;
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${Math.floor(minutes)}m ago`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h ago`;
  if (minutes < 60 * 24 * 7) return `${Math.floor(minutes / (60 * 24))}d ago`;
  return date.toLocaleDateString();
}

/* --- lock screen -------------------------------------------------------- */

function showLock() {
  state.user = null;
  $("#shell").hidden = true;
  $("#lock").hidden = false;
}

async function refreshAuth() {
  const status = await get("/api/auth/status");
  if (status.authenticated) {
    state.user = status.user;
    $("#lock").hidden = true;
    $("#shell").hidden = false;
    await bootApp();
    return;
  }
  showLock();
  $("#login-form").hidden = status.needs_setup;
  $("#setup-form").hidden = !status.needs_setup;
  $("#lock-sub").textContent = status.needs_setup
    ? "First run - create the account for this machine"
    : "Local assistant - this machine only";
  (status.needs_setup ? $("#setup-username") : $("#login-username")).focus();
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#login-error").textContent = "";
  try {
    await api("POST", "/api/auth/login", {
      username: $("#login-username").value,
      password: $("#login-password").value,
    });
    $("#login-password").value = "";
    await refreshAuth();
  } catch (error) {
    $("#login-error").textContent = error.message;
  }
});

$("#setup-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#setup-error").textContent = "";
  try {
    await api("POST", "/api/auth/setup", {
      username: $("#setup-username").value,
      display_name: $("#setup-display").value,
      password: $("#setup-password").value,
    });
    $("#setup-password").value = "";
    await refreshAuth();
  } catch (error) {
    $("#setup-error").textContent = error.message;
  }
});

$("#lock-button").addEventListener("click", async () => {
  await api("POST", "/api/auth/logout");
  location.reload();
});

/* --- drawers ------------------------------------------------------------ */

function openDrawer(id) {
  const command = COMMANDS.find((c) => c.id === id);
  if (!command || command.soon || command.run) return;
  state.view = id;
  for (const panel of document.querySelectorAll(".panel")) {
    panel.classList.toggle("active", panel.dataset.panel === id);
  }
  $("#drawer-title").textContent = command.label;
  const drawer = $("#drawer");
  drawer.hidden = false;
  drawer.setAttribute("aria-hidden", "false");
  $("#drawer-body").scrollTop = 0;
  const load = DRAWER_LOADERS[id];
  if (load) Promise.resolve(load()).catch((error) => console.warn(error));
  if (location.hash !== `#${id}`) history.replaceState(null, "", `#${id}`);
}

function closeDrawer() {
  const drawer = $("#drawer");
  if (drawer.hidden) return;
  drawer.hidden = true;
  drawer.setAttribute("aria-hidden", "true");
  state.view = null;
  history.replaceState(null, "", location.pathname);
  $("#composer-input").focus();
}

/* `go` is what everything already calls. It keeps working; it just opens a
 * drawer instead of switching a page. */
function go(id) {
  if (id === "chat" || id === "dashboard" && false) { closeDrawer(); return; }
  if (id === "dashboard") id = "today";
  openDrawer(id);
}

$("#drawer-close").addEventListener("click", closeDrawer);
$("#drawer-scrim").addEventListener("click", closeDrawer);
for (const chip of document.querySelectorAll("[data-open]")) {
  chip.addEventListener("click", () => openDrawer(chip.dataset.open));
}

function toggleRail(force) {
  const stage = $("#stage");
  const off = force === undefined ? !stage.classList.contains("no-rail") : !force;
  stage.classList.toggle("no-rail", off);
  $("#chip-rail").setAttribute("aria-pressed", off ? "false" : "true");
  try { localStorage.setItem("jarvis.rail", off ? "off" : "on"); } catch (_) {}
}
$("#chip-rail").addEventListener("click", () => toggleRail());
try { if (localStorage.getItem("jarvis.rail") === "off") toggleRail(false); } catch (_) {}

/* --- the palette -------------------------------------------------------- */

const palette = { open: false, index: 0, rows: [] };

function paletteMatches(text) {
  const needle = text.slice(1).trim().toLowerCase();
  return COMMANDS.filter((c) =>
    !needle || c.cmd.slice(1).startsWith(needle) || c.label.toLowerCase().includes(needle)
  );
}

function renderPalette(text) {
  const box = $("#palette");
  palette.rows = paletteMatches(text);
  palette.index = Math.min(palette.index, Math.max(0, palette.rows.length - 1));
  box.innerHTML = "";
  if (!palette.rows.length) {
    box.append(el("div", "palette-empty", "No command matches. Esc to go back to talking."));
  }
  palette.rows.forEach((c, i) => {
    const row = el("button", "palette-row");
    row.type = "button";
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", i === palette.index ? "true" : "false");
    row.append(el("span", "cmd", c.cmd));
    row.append(el("span", "desc", c.desc));
    if (c.soon) row.append(el("span", "soon", "soon"));
    row.addEventListener("mousedown", (e) => { e.preventDefault(); runCommand(c); });
    box.append(row);
  });
  box.hidden = false;
  palette.open = true;
  $("#preview").hidden = true;
}

function closePalette() {
  $("#palette").hidden = true;
  palette.open = false;
  palette.index = 0;
}

function runCommand(c) {
  const input = $("#composer-input");
  input.value = "";
  input.style.height = "auto";
  closePalette();
  if (c.soon) { $("#composer-hint").textContent = `${c.label} is not built yet.`; return; }
  if (c.run) { c.run(); return; }
  openDrawer(c.id);
}

/* --- the live preview: what would be consulted, before sending ------------ */

let previewSeq = 0;

async function refreshPreview(text) {
  const box = $("#preview");
  const q = text.trim();
  if (!q || q.startsWith("/") || q.length < 3) { box.hidden = true; return; }
  const seq = ++previewSeq;
  let data;
  try {
    data = await get(`/api/context/preview?q=${encodeURIComponent(q)}`);
  } catch (_) {
    return;
  }
  if (seq !== previewSeq || palette.open) return;   // a newer keystroke won

  const rows = $("#preview-rows");
  rows.innerHTML = "";
  box.classList.toggle("none", !data.count);
  if (!data.count) {
    $("#preview-sum").textContent = "nothing personal would be sent";
  } else {
    const parts = Object.entries(data.by_source || {}).map(([k, n]) => `${n} ${k}${n === 1 ? "" : "s"}`);
    $("#preview-sum").textContent = `${parts.join(", ")} · ${data.chars.toLocaleString()} chars would leave`;
    for (const s of data.snippets.slice(0, 8)) {
      const row = el("span", "preview-row");
      row.append(el("span", "src", s.source));
      row.append(document.createTextNode(s.label || s.title));
      row.title = `${s.title} — ${s.chars} chars`;
      rows.append(row);
    }
  }
  box.hidden = false;
}
const previewSoon = debounce(refreshPreview, 220);

/* --- the bar: one input, two modes ------------------------------------------ */

const bar = $("#composer-input");

bar.addEventListener("input", () => {
  bar.style.height = "auto";
  bar.style.height = `${Math.min(bar.scrollHeight, 200)}px`;
  if (bar.value.startsWith("/")) {
    renderPalette(bar.value);
  } else {
    if (palette.open) closePalette();
    previewSoon(bar.value);
  }
});

bar.addEventListener("keydown", (event) => {
  if (palette.open) {
    if (event.key === "ArrowDown") { event.preventDefault(); palette.index = (palette.index + 1) % Math.max(1, palette.rows.length); renderPalette(bar.value); return; }
    if (event.key === "ArrowUp")   { event.preventDefault(); palette.index = (palette.index - 1 + palette.rows.length) % Math.max(1, palette.rows.length); renderPalette(bar.value); return; }
    if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); if (palette.rows[palette.index]) runCommand(palette.rows[palette.index]); return; }
    if (event.key === "Escape") { event.preventDefault(); bar.value = ""; closePalette(); return; }
  }
  if (event.key === "Escape") { $("#preview").hidden = true; return; }
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    $("#preview").hidden = true;
    send();
  }
});

document.addEventListener("keydown", (event) => {
  const meta = event.metaKey || event.ctrlKey;
  if (meta && event.key.toLowerCase() === "k") { event.preventDefault(); closeDrawer(); bar.focus(); bar.select(); return; }
  if (event.key === "Escape") { if (!$("#drawer").hidden) { closeDrawer(); event.preventDefault(); } return; }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
  if (event.key === "/" && !typing && $("#drawer").hidden) { event.preventDefault(); bar.focus(); bar.value = "/"; renderPalette("/"); }
});

/* --- briefing + rail: readings, refreshed when the thing they read changes --- */

function renderBriefing(status) {
  const box = $("#briefing");
  const hour = new Date().getHours();
  const part = hour < 12 ? "Morning" : hour < 18 ? "Afternoon" : "Evening";
  const name = status.user.display_name || status.user.username;
  $("#briefing-date").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  $("#briefing-greeting").textContent = `${part}, ${name}.`;

  const attention = $("#briefing-attention");
  attention.innerHTML = "";
  if (status.attention && status.attention.length) {
    if (status.tasks_overdue) attention.append(el("p", "late-line", `${status.tasks_overdue} overdue`));
    for (const task of status.attention.slice(0, 5)) attention.append(taskRow(task));
  }
  const bits = [];
  if (status.tasks_open) bits.push(`${status.tasks_open} open task${status.tasks_open === 1 ? "" : "s"}`);
  if (status.memories) bits.push(`${status.memories} thing${status.memories === 1 ? "" : "s"} remembered`);
  if (status.documents) bits.push(`${status.documents} document${status.documents === 1 ? "" : "s"} indexed`);
  $("#briefing-note").textContent = bits.length
    ? `${bits.join(", ")}. Nothing leaves this machine unless a question needs it.`
    : "Nothing stored yet. Tell it something worth remembering, or give it a deadline.";

  const starters = $("#briefing-starters");
  starters.innerHTML = "";
  for (const text of ["What should I start with today?", "What's due this week?", "/tasks", "/memory"]) {
    const chip = el("button", "chip", text);
    chip.type = "button";
    chip.addEventListener("click", () => {
      if (text.startsWith("/")) { runCommand(COMMANDS.find((c) => c.cmd === text)); return; }
      bar.value = text; bar.focus(); previewSoon(text);
    });
    starters.append(chip);
  }
  box.hidden = !!state.activeConversation;
}

function renderRail(status) {
  const box = $("#rail-attention");
  box.innerHTML = "";
  if (!status.attention || !status.attention.length) {
    box.append(el("p", "empty", status.tasks_open ? "Nothing due today." : "Nothing outstanding."));
  } else {
    for (const task of status.attention.slice(0, 6)) box.append(taskRow(task));
  }
  $("#rail-model").textContent = status.model;
  const local = status.provider === "ollama";
  $("#rail-where").textContent = local ? "this machine" : "the cloud";
  $("#rail-where").className = local ? "v" : "v offsite";
  $("#chip-model").textContent = status.model;
  $("#chip-model").className = `chip ${local || status.api_key_present ? "on" : "warm"}`;
  $("#chip-model").title = local
    ? "Answers are generated on this machine"
    : "Answers come from the cloud model — open Settings";
}

function renderRailContext(event) {
  const box = $("#rail-context");
  box.innerHTML = "";
  if (!event.snippets || !event.snippets.length) {
    box.append(el("p", "empty", "Nothing personal was sent."));
    return;
  }
  for (const s of event.snippets.slice(0, 8)) {
    const row = el("div", "rail-snip");
    row.append(el("span", "src", s.source));
    row.append(document.createTextNode(s.title));
    box.append(row);
  }
  box.append(el("div", "rail-sum", `${event.snippets.length} record${event.snippets.length === 1 ? "" : "s"} · ${event.chars.toLocaleString()} chars left the machine`));
}

/* --- dashboard ---------------------------------------------------------- */

const QUICK_COMMANDS = [
  "What did we talk about last time?",
  "Summarise this conversation so far.",
  "Help me plan what to work on today.",
  "Explain something I asked about earlier.",
];

async function loadDashboard() {
  const status = await get("/api/status");
  state.status = status;
  renderBriefing(status);
  renderRail(status);
  const hour = new Date().getHours();
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  $("#greeting").textContent = `${part}, ${status.user.display_name || status.user.username}`;
  $("#dash-sub").textContent = `JARVIS ${status.version} - ${status.model}`;
  $("#who-name").textContent = status.user.display_name || status.user.username;
  $("#who-model").textContent = status.model;
  $("#stat-memories").textContent = status.memories;
  $("#stat-documents").textContent = status.documents;
  $("#stat-conversations").textContent = status.conversations;
  $("#stat-messages").textContent = status.messages;
  $("#stat-tasks").textContent = status.tasks_open;
  $("#stat-tools").textContent = status.tools.length;
  $("#stat-data-dir").textContent = status.data_dir;

  /* The one thing the front page exists to answer: is anything late, and what
   * is due today. Overdue is counted separately because "three open" and "three
   * overdue" are very different mornings. */
  const attention = $("#dash-tasks");
  attention.innerHTML = "";
  if (!status.attention.length) {
    attention.append(el("p", "empty",
      status.tasks_open ? "Nothing due today." : "Nothing outstanding."));
  } else {
    for (const task of status.attention) attention.append(taskRow(task));
    if (status.tasks_overdue) {
      attention.append(el("p", "note alert-text",
        `${status.tasks_overdue} overdue.`));
    }
  }

  const pill = $("#key-pill");
  pill.textContent = status.api_key_present ? "API key loaded" : "no API key";
  pill.className = `pill ${status.api_key_present ? "on" : "off"}`;

  const quick = $("#quick-commands");
  quick.innerHTML = "";
  for (const command of QUICK_COMMANDS) {
    const chip = el("button", "chip", command);
    chip.addEventListener("click", () => {
      go("chat");
      $("#composer-input").value = command;
      $("#composer-input").focus();
    });
    quick.append(chip);
  }

  /* Recent documents and the memories JARVIS has actually leaned on. Both are
   * real counts from the local database - the dashboard shows nothing it cannot
   * substantiate. */
  const documents = await get("/api/documents?limit=5");
  const recentDocuments = $("#recent-documents");
  recentDocuments.innerHTML = "";
  if (!documents.length) {
    recentDocuments.append(el("p", "empty", "Nothing indexed yet. Add a note or a document."));
  } else {
    for (const doc of documents.slice(0, 5)) {
      const row = el("button", "list-row");
      row.append(el("span", "title", doc.filename.replace(/\.md$/, "")));
      row.append(el("span", "when", doc.subject || `${doc.chunk_count}p`));
      row.addEventListener("click", () => go(doc.category === "note" ? "notes" : "files"));
      recentDocuments.append(row);
    }
  }

  const memories = await get("/api/memory?limit=50");
  const topMemories = $("#top-memories");
  topMemories.innerHTML = "";
  const used = memories.filter((m) => m.use_count > 0)
    .sort((a, b) => b.use_count - a.use_count).slice(0, 5);
  const shown = used.length ? used : memories.slice(0, 5);
  if (!shown.length) {
    topMemories.append(el("p", "empty", "Nothing stored yet. Tell JARVIS to remember something."));
  } else {
    for (const memory of shown) {
      const row = el("button", "list-row");
      row.append(el("span", "title", memory.content));
      row.append(el("span", "when", memory.use_count ? `used ${memory.use_count}x` : memory.category));
      row.addEventListener("click", () => go("memory"));
      topMemories.append(row);
    }
  }

  const recent = $("#recent-conversations");
  recent.innerHTML = "";
  if (!status.recent_conversations.length) {
    recent.append(el("p", "empty", "Nothing yet. Start a conversation."));
  } else {
    for (const conversation of status.recent_conversations) {
      const row = el("button", "list-row");
      row.append(el("span", "title", conversation.title));
      row.append(el("span", "when", when(conversation.updated_at)));
      row.addEventListener("click", async () => { go("chat"); await openConversation(conversation.id); });
      recent.append(row);
    }
  }
}

/* --- chat --------------------------------------------------------------- */

async function loadConversations() {
  state.conversations = await get("/api/conversations");
  const list = $("#thread-list");
  list.innerHTML = "";
  for (const conversation of state.conversations) {
    const row = el("button", "thread");
    if (state.activeConversation === conversation.id) row.classList.add("active");
    row.append(el("span", "title", conversation.title));
    const kill = el("button", "kill", "×");
    kill.title = "Delete this conversation";
    kill.addEventListener("click", async (event) => {
      event.stopPropagation();
      await api("DELETE", `/api/conversations/${conversation.id}`);
      if (state.activeConversation === conversation.id) newConversation();
      await loadConversations();
    });
    row.append(kill);
    row.addEventListener("click", () => openConversation(conversation.id));
    list.append(row);
  }
}

function newConversation() {
  state.activeConversation = null;
  $("#messages").innerHTML = "";
  /* No canned hello. An empty thread shows the briefing - what is due, what is
   * late - which is a better first thing to see than a sentence about itself. */
  $("#briefing").hidden = false;
  for (const item of document.querySelectorAll(".thread")) item.classList.remove("active");
  closeDrawer();
  bar.focus();
}

async function openConversation(id) {
  const conversation = await get(`/api/conversations/${id}`);
  state.activeConversation = id;
  $("#briefing").hidden = true;
  closeDrawer();
  const container = $("#messages");
  container.innerHTML = "";
  for (const message of conversation.messages) appendMessage(message);
  container.scrollTop = container.scrollHeight;
  await loadConversations();
}

function appendMessage(message) {
  const node = el("div", `msg ${message.role}`);
  node.append(el("div", "role", message.role === "user" ? "You" : "JARVIS"));
  const body = el("div", "body");
  body.innerHTML = renderMarkdown(message.content || "");
  node.append(body);
  if (message.error) node.append(el("div", "failed", message.error));
  if (message.output_tokens || message.interaction_id) {
    const meta = el("div", "meta");
    if (message.output_tokens) {
      meta.append(el("span", null, `${message.model || ""} · ${message.input_tokens || 0} in / ${message.output_tokens} out`));
    }
    if (message.interaction_id) meta.append(ratingRow(message.interaction_id, message.rating));
    node.append(meta);
  }
  $("#messages").append(node);
  return node;
}

async function send() {
  if (state.streaming) return;
  const input = $("#composer-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  input.style.height = "auto";
  $("#briefing").hidden = true;
  $("#preview").hidden = true;
  state.streaming = true;
  $("#send-button").disabled = true;
  $("#composer-hint").textContent = "";
  setStatus("thinking", "thinking");

  appendMessage({ role: "user", content: text });
  const container = $("#messages");
  container.scrollTop = container.scrollHeight;

  const node = el("div", "msg assistant");
  node.append(el("div", "role", "JARVIS"));
  const body = el("div", "body");
  node.append(body);
  let thinkingNode = null;
  let toolNode = null;
  let answer = "";
  const cursor = el("span", "cursor");
  body.append(cursor);
  container.append(node);

  const stick = () => {
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 160;
    if (atBottom) container.scrollTop = container.scrollHeight;
  };

  const paint = () => {
    body.innerHTML = renderMarkdown(answer);
    body.append(cursor);
    stick();
  };

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...CLIENT_HEADER },
      body: JSON.stringify({ message: text, conversation_id: state.activeConversation }),
    });
    if (response.status === 401) { showLock(); return; }
    if (!response.ok || !response.body) {
      throw new Error(`The server refused the request (${response.status}).`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    /* Server-sent events: frames are separated by a blank line, and a frame can
     * arrive split across reads, so the tail of the buffer is held back until
     * its separator shows up. */
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() || "";
      for (const frame of frames) {
        const line = frame.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        const event = JSON.parse(line.slice(6));

        if (event.type === "text") {
          answer += event.text;
          paint();
        } else if (event.type === "thinking") {
          if (!thinkingNode) {
            thinkingNode = el("div", "thinking");
            container.insertBefore(thinkingNode, node);
          }
          thinkingNode.textContent += event.text;
          stick();
        } else if (event.type === "tool") {
          if (!toolNode) {
            toolNode = el("div", "tool-trace");
            container.insertBefore(toolNode, node);
          }
          const mark = event.status === "running" ? "..." : event.status;
          const row = el("div", event.status === "error" ? "err" : event.status === "done" ? "done" : "");
          row.textContent = `local tool - ${event.name} ${mark}`;
          toolNode.append(row);
          stick();
        } else if (event.type === "context") {
          setStatus("retrieving", "retrieving");
          /* The memory indicator: which local records were consulted for this
           * answer, and how much went. Shown before the answer so it reads as
           * "here is what I looked at", not as a footnote. */
          const counts = {};
          for (const snippet of event.snippets) {
            counts[snippet.source] = (counts[snippet.source] || 0) + 1;
          }
          const parts = Object.entries(counts).map(
            ([kind, n]) => `${n} ${kind}${n === 1 ? "" : "s"}`
          );
          const trace = el("div", "tool-trace context-trace");
          const line = el("div");
          line.textContent = `local context - ${parts.join(", ")} (${event.chars} chars sent)`;
          trace.append(line);
          for (const snippet of event.snippets) {
            trace.append(el("div", "muted-line", `  ${snippet.source}: ${snippet.title}`));
          }
          container.insertBefore(trace, node);
          renderRailContext(event);
        } else if (event.type === "user_message") {
          state.activeConversation = event.conversation_id;
        } else if (event.type === "error") {
          node.append(el("div", "failed", event.message));
          setStatus("error", "failed");
          stick();
        } else if (event.type === "done") {
          const meta = el("div", "meta");
          if (event.usage && event.usage.output_tokens) {
            meta.append(el("span", null,
              `${event.model || ""} · ${event.usage.input_tokens} in / ${event.usage.output_tokens} out`));
          }
          if (event.latency_ms) meta.append(el("span", null, `${(event.latency_ms / 1000).toFixed(1)}s`));
          if (event.interaction_id) meta.append(ratingRow(event.interaction_id));
          if (meta.childElementCount) node.append(meta);
          if (state.voice && state.voice.enabled && answer.trim()) speak(answer);
        }
      }
    }
  } catch (error) {
    node.append(el("div", "failed", error.message));
  } finally {
    cursor.remove();
    body.innerHTML = renderMarkdown(answer);
    state.streaming = false;
    $("#send-button").disabled = false;
    $("#composer-hint").textContent = "";
    if ($("#status").dataset.state !== "error") setStatus("ready", "ready");
    await loadConversations();
    stick();
  }
}

$("#send-button").addEventListener("click", () => { $("#preview").hidden = true; send(); });
$("#new-conversation").addEventListener("click", () => { newConversation(); loadConversations(); });
$("#composer-input").addEventListener("input", (event) => {
  const box = event.target;
  box.style.height = "auto";
  box.style.height = `${Math.min(box.scrollHeight, 220)}px`;
});

/* --- settings ----------------------------------------------------------- */

async function loadSettings() {
  const settings = await get("/api/settings");
  state.settings = settings;
  $("#set-model").value = settings.model;
  $("#set-max-tokens").value = settings.max_tokens;
  $("#set-thinking").checked = settings.show_thinking;
  $("#set-tools").checked = settings.enable_tools;
  $("#set-fallback").checked = settings.use_refusal_fallback;
  $("#set-log-context").checked = settings.log_context;
  $("#set-assistant-memories").checked = settings.allow_assistant_memories;
  $("#set-provider").value = settings.provider;
  renderProvider(settings);
  $("#rail-where").textContent = settings.provider === "ollama" ? "this machine" : "the cloud";
  $("#rail-where").className = settings.provider === "ollama" ? "v" : "v offsite";

  $("#set-voice").checked = settings.voice_enabled;

  const voiceNames = $("#set-voice-name");
  if (!voiceNames.options.length) {
    for (const name of settings.voices || []) {
      voiceNames.append(new Option(name, name));
    }
  }
  $("#set-voice-stt").value = settings.voice_stt;
  $("#set-voice-tts").value = settings.voice_tts;
  voiceNames.value = settings.voice_name;

  /* Gemini cannot be chosen without a key, and saying why beats a dropdown that
   * silently does nothing when picked. */
  const keyed = Boolean(settings.gemini_key_present);
  for (const id of ["#set-voice-stt", "#set-voice-tts"]) {
    const option = $(id).querySelector('option[value="gemini"]');
    option.disabled = !keyed;
    option.textContent = option.textContent.replace(/ — no key in \.env$/, "");
    if (!keyed) option.textContent += " — no key in .env";
  }
  voiceNames.disabled = !keyed || settings.voice_tts !== "gemini";

  await loadVoice();
  $("#key-status").textContent = settings.api_key_present ? "loaded" : "not set";
  $("#key-source").textContent = settings.api_key_source || "-";
}

$("#save-settings").addEventListener("click", async () => {
  $("#settings-status").textContent = "";
  try {
    await api("PUT", "/api/settings", {
      provider: $("#set-provider").value,
      model: $("#set-model").value.trim(),
      local_model: $("#set-local-model").value || undefined,
      max_tokens: Number($("#set-max-tokens").value),
      show_thinking: $("#set-thinking").checked,
      enable_tools: $("#set-tools").checked,
      use_refusal_fallback: $("#set-fallback").checked,
      log_context: $("#set-log-context").checked,
      allow_assistant_memories: $("#set-assistant-memories").checked,
      voice_enabled: $("#set-voice").checked,
    });
    $("#settings-status").textContent = "Saved.";
    await loadSettings();
    await loadDashboard();
  } catch (error) {
    $("#settings-status").textContent = error.message;
  }
});

// The voice switch lives in its own card, so it saves itself rather than
// waiting on the Save button belonging to the panel above it. A toggle that
// appears to do nothing until you find a button somewhere else is a toggle
// people conclude is broken.
/* Which model answers, and what that costs you. The note is the whole point of
 * the control: the cloud one is better, the local one is yours - and nobody
 * should have to read the README to find that out. */
function renderProvider(settings) {
  const local = settings.provider === "ollama";
  $("#field-cloud-model").hidden = local;
  $("#field-local-model").hidden = !local;

  const models = $("#set-local-model");
  const wanted = (settings.local_models || []).join("|");
  if (models.dataset.filled !== wanted) {
    models.innerHTML = "";
    for (const name of settings.local_models || []) models.append(new Option(name, name));
    if (!(settings.local_models || []).length && settings.local_model) {
      models.append(new Option(settings.local_model + " (not pulled)", settings.local_model));
    }
    models.dataset.filled = wanted;
  }
  models.value = settings.local_model;

  const option = $("#set-provider").querySelector('option[value="ollama"]');
  option.disabled = !settings.local_available;

  const note = $("#provider-note");
  if (!settings.local_available) {
    note.textContent =
      "Ollama is not running on this machine. Install it from ollama.com, then " +
      "`ollama pull llama3.1:8b` — after that JARVIS works with no API key and " +
      "nothing leaves your computer.";
  } else if (local) {
    note.textContent =
      "Answers are generated on this machine. Nothing leaves it, there is no key " +
      "and no bill — and the model is meaningfully weaker than the cloud one at " +
      "hard reasoning. Switch back any time.";
  } else {
    note.textContent =
      "Answers come from Claude, which needs the API key below. Ollama is " +
      "installed here, so you can switch to it whenever you would rather not " +
      "send anything out.";
  }
}

$("#set-provider").addEventListener("change", async (event) => {
  try {
    await api("PUT", "/api/settings", { provider: event.target.value });
  } catch (error) {
    $("#settings-status").textContent = error.message;
  }
  /* Redraw from what the server stored, so a refused change never leaves the
   * page claiming it took effect. */
  await loadSettings();
  await loadDashboard();
});

$("#set-local-model").addEventListener("change", async (event) => {
  try {
    await api("PUT", "/api/settings", { local_model: event.target.value });
  } catch (error) {
    $("#settings-status").textContent = error.message;
  }
  await loadSettings();
  await loadDashboard();
});

for (const [id, field] of [
  ["#set-voice-stt", "voice_stt"],
  ["#set-voice-tts", "voice_tts"],
  ["#set-voice-name", "voice_name"],
]) {
  $(id).addEventListener("change", async (event) => {
    try {
      await api("PUT", "/api/settings", { [field]: event.target.value });
      silence();
    } catch (error) {
      $("#settings-status").textContent = error.message;
    }
    /* Either way, redraw from what the server actually stored rather than from
     * what was clicked - a rejected change must not leave the page claiming it
     * took effect. */
    await loadSettings();
  });
}

$("#set-voice").addEventListener("change", async (event) => {
  const wanted = event.target.checked;
  try {
    await api("PUT", "/api/settings", { voice_enabled: wanted });
    await loadVoice();
    if (!wanted) silence();
  } catch (error) {
    event.target.checked = !wanted;
    $("#settings-status").textContent = error.message;
  }
});

$("#change-password").addEventListener("click", async () => {
  $("#pw-error").textContent = "";
  try {
    await api("POST", "/api/auth/password", {
      current_password: $("#pw-current").value,
      new_password: $("#pw-new").value,
    });
    location.reload();
  } catch (error) {
    $("#pw-error").textContent = error.message;
  }
});

$("#erase-button").addEventListener("click", async () => {
  $("#erase-error").textContent = "";
  try {
    const result = await api("POST", "/api/memory/erase", {
      confirm: $("#erase-confirm").value,
      scope: $("#erase-scope").value,
    });
    $("#erase-confirm").value = "";
    $("#erase-error").textContent = `Deleted ${result.conversations_deleted} conversation(s).`;
    newConversation();
    await loadConversations();
  } catch (error) {
    $("#erase-error").textContent = error.message;
  }
});

/* --- start -------------------------------------------------------------- */

async function bootApp() {
  newConversation();
  setStatus("ready", "ready");
  await loadDashboard();
  await loadVoice();
  await loadConversations();
  const wanted = location.hash.slice(1);
  if (wanted && wanted !== "chat" && wanted !== "dashboard") openDrawer(wanted);
}

window.addEventListener("hashchange", () => {
  const id = location.hash.slice(1);
  if (id && id !== state.view) go(id);
  if (!id) closeDrawer();
});

refreshAuth().catch((error) => {
  $("#login-error").textContent = error.message;
});

/* --- memory ------------------------------------------------------------- */

const IMPORTANCE_LABEL = { 1: "trivia", 2: "minor", 3: "normal", 4: "important", 5: "critical" };

async function fillCategorySelects() {
  if (state.categories) return state.categories;
  state.categories = await get("/api/memory/categories");
  const add = $("#memory-category");
  const filter = $("#memory-filter");
  add.innerHTML = "";
  filter.innerHTML = '<option value="">All categories</option>';
  for (const category of state.categories) {
    add.append(new Option(category.replace(/_/g, " "), category));
    filter.append(new Option(category.replace(/_/g, " "), category));
  }
  add.value = "important_facts";
  return state.categories;
}

async function loadMemories() {
  await fillCategorySelects();
  const query = $("#memory-search").value.trim();
  const category = $("#memory-filter").value;

  let memories;
  if (query) {
    const hits = await get(`/api/memory/search?q=${encodeURIComponent(query)}&limit=100`
      + (category ? `&category=${encodeURIComponent(category)}` : ""));
    memories = hits.map((hit) => ({ ...hit.memory, _score: hit.score }));
  } else {
    memories = await get("/api/memory" + (category ? `?category=${encodeURIComponent(category)}` : ""));
  }

  $("#memory-count").textContent = query
    ? `${memories.length} matching`
    : `${memories.length} stored`;

  const list = $("#memory-list");
  list.innerHTML = "";
  if (!memories.length) {
    list.append(el("p", "empty", query
      ? "Nothing matches that."
      : "Nothing stored yet. Tell JARVIS to remember something, or add one here."));
    return;
  }
  for (const memory of memories) list.append(memoryRow(memory));
}

function memoryRow(memory) {
  const row = el("div", "record");

  const head = el("div", "record-head");
  head.append(el("span", "tag", memory.category.replace(/_/g, " ")));
  head.append(el("span", `imp imp-${memory.importance}`, IMPORTANCE_LABEL[memory.importance] || ""));
  if (memory.source !== "manual") head.append(el("span", "muted", `via ${memory.source}`));
  if (memory.use_count) head.append(el("span", "muted", `used ${memory.use_count}x`));
  head.append(el("span", "grow"));
  head.append(el("span", "muted", when(memory.updated_at)));
  row.append(head);

  const body = el("div", "record-body", memory.content);
  body.title = "Click to edit";
  row.append(body);

  if (memory.tags && memory.tags.length) {
    const tags = el("div", "record-tags");
    for (const tag of memory.tags) tags.append(el("span", "chip-static", tag));
    row.append(tags);
  }

  const actions = el("div", "record-actions");
  const edit = el("button", "link-btn", "Edit");
  const remove = el("button", "link-btn danger-text", "Delete");
  actions.append(edit, remove);
  row.append(actions);

  const startEdit = () => {
    if (row.querySelector("textarea")) return;
    const editor = el("textarea");
    editor.value = memory.content;
    editor.rows = 3;
    const importance = el("select");
    for (const level of [1, 2, 3, 4, 5]) {
      importance.append(new Option(`${level} - ${IMPORTANCE_LABEL[level]}`, level));
    }
    importance.value = memory.importance;
    const save = el("button", "btn primary", "Save");
    const cancel = el("button", "btn", "Cancel");
    const editRow = el("div", "edit-row");
    editRow.append(importance, save, cancel);

    body.replaceWith(editor);
    actions.replaceWith(editRow);

    save.addEventListener("click", async () => {
      try {
        await api("PUT", `/api/memory/${memory.id}`, {
          content: editor.value.trim(),
          importance: Number(importance.value),
        });
        await loadMemories();
      } catch (error) {
        alert(error.message);
      }
    });
    cancel.addEventListener("click", () => loadMemories());
  };

  edit.addEventListener("click", startEdit);
  body.addEventListener("click", startEdit);
  remove.addEventListener("click", async () => {
    if (!confirm("Delete this memory? This cannot be undone.")) return;
    await api("DELETE", `/api/memory/${memory.id}`);
    await loadMemories();
  });
  return row;
}

$("#memory-add-toggle").addEventListener("click", async () => {
  await fillCategorySelects();
  const form = $("#memory-form");
  form.hidden = !form.hidden;
  if (!form.hidden) $("#memory-content").focus();
});

$("#memory-save").addEventListener("click", async () => {
  $("#memory-error").textContent = "";
  try {
    await api("POST", "/api/memory", {
      content: $("#memory-content").value.trim(),
      category: $("#memory-category").value,
      importance: Number($("#memory-importance").value),
      tags: $("#memory-tags").value.split(",").map((t) => t.trim()).filter(Boolean),
    });
    $("#memory-content").value = "";
    $("#memory-tags").value = "";
    $("#memory-form").hidden = true;
    await loadMemories();
  } catch (error) {
    $("#memory-error").textContent = error.message;
  }
});

$("#memory-search").addEventListener("input", debounce(loadMemories, 220));
$("#memory-filter").addEventListener("change", loadMemories);

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/* --- documents ---------------------------------------------------------- */

async function loadDocuments() {
  const documents = await get("/api/documents");
  $("#documents-count").textContent = `${documents.length} indexed`;
  const list = $("#document-list");
  list.innerHTML = "";
  if (!documents.length) {
    list.append(el("p", "empty", "No documents yet. Add notes, revision material or a syllabus."));
    return;
  }
  for (const document_ of documents) list.append(documentRow(document_));
}

function documentRow(doc) {
  const row = el("div", "record");
  const head = el("div", "record-head");
  head.append(el("strong", null, doc.filename));
  if (doc.subject) head.append(el("span", "tag", doc.subject));
  if (doc.category) head.append(el("span", "muted", doc.category));
  head.append(el("span", "muted", `${doc.chunk_count} passage${doc.chunk_count === 1 ? "" : "s"}`));
  head.append(el("span", "grow"));
  head.append(el("span", "muted", when(doc.updated_at)));
  row.append(head);
  row.append(el("div", "record-body muted", doc.excerpt || ""));

  const actions = el("div", "record-actions");
  const remove = el("button", "link-btn danger-text", "Delete");
  remove.addEventListener("click", async () => {
    if (!confirm(`Delete ${doc.filename}? JARVIS's copy of the file is deleted too.`)) return;
    await api("DELETE", `/api/documents/${doc.id}`);
    await loadDocuments();
    await loadNotes();
  });
  actions.append(remove);
  row.append(actions);
  return row;
}

$("#document-file").addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;
  $("#document-name").value = file.name;
  $("#document-form").hidden = false;
  $("#document-error").textContent = "";
});

$("#document-upload").addEventListener("click", async () => {
  const file = $("#document-file").files[0];
  if (!file) return;
  $("#document-error").textContent = "Indexing...";
  const form = new FormData();
  form.append("file", file);
  form.append("subject", $("#document-subject").value.trim());
  form.append("tags", $("#document-tags").value.trim());
  form.append("category", "document");
  try {
    await postForm("/api/documents", form);
    $("#document-form").hidden = true;
    $("#document-file").value = "";
    $("#document-subject").value = "";
    $("#document-tags").value = "";
    $("#document-error").textContent = "";
    await loadDocuments();
  } catch (error) {
    $("#document-error").textContent = error.message;
  }
});

$("#document-search").addEventListener("input", debounce(async (event) => {
  const query = event.target.value.trim();
  const results = $("#document-results");
  results.innerHTML = "";
  if (!query) return;
  const hits = await get(`/api/documents/search?q=${encodeURIComponent(query)}`);
  if (!hits.length) {
    results.append(el("p", "empty", "No passage matches that."));
    return;
  }
  for (const hit of hits) {
    const row = el("div", "record hit");
    const head = el("div", "record-head");
    head.append(el("strong", null, hit.filename));
    head.append(el("span", "muted", `part ${hit.part} of ${hit.parts}`));
    row.append(head);
    row.append(el("div", "record-body", hit.text));
    results.append(row);
  }
}, 250));

/* --- notes -------------------------------------------------------------- */

async function loadNotes() {
  const notes = await get("/api/notes");
  const list = $("#note-list");
  list.innerHTML = "";
  if (!notes.length) {
    list.append(el("p", "empty", "No notes yet. A note is indexed exactly like an uploaded document."));
    return;
  }
  for (const note of notes) {
    const row = el("div", "record");
    const head = el("div", "record-head");
    head.append(el("strong", null, note.filename.replace(/\.md$/, "")));
    if (note.subject) head.append(el("span", "tag", note.subject));
    head.append(el("span", "grow"));
    head.append(el("span", "muted", when(note.updated_at)));
    row.append(head);
    row.append(el("div", "record-body muted", note.excerpt));

    const actions = el("div", "record-actions");
    const open = el("button", "link-btn", "Open");
    const remove = el("button", "link-btn danger-text", "Delete");
    open.addEventListener("click", async () => {
      const text = await get(`/api/notes/${note.id}/text`);
      $("#note-title").value = note.filename.replace(/\.md$/, "");
      $("#note-subject").value = note.subject;
      $("#note-text").value = text.replace(/^#\s+.*\n\n?/, "");
      $("#note-form").hidden = false;
      $("#note-text").focus();
    });
    remove.addEventListener("click", async () => {
      if (!confirm("Delete this note?")) return;
      await api("DELETE", `/api/documents/${note.id}`);
      await loadNotes();
    });
    actions.append(open, remove);
    row.append(actions);
    list.append(row);
  }
}

$("#note-new").addEventListener("click", () => {
  $("#note-title").value = "";
  $("#note-subject").value = "";
  $("#note-text").value = "";
  $("#note-error").textContent = "";
  $("#note-form").hidden = false;
  $("#note-title").focus();
});

$("#note-save").addEventListener("click", async () => {
  $("#note-error").textContent = "";
  try {
    await api("POST", "/api/notes", {
      title: $("#note-title").value.trim(),
      text: $("#note-text").value,
      subject: $("#note-subject").value.trim(),
      tags: [],
    });
    $("#note-form").hidden = true;
    await loadNotes();
  } catch (error) {
    $("#note-error").textContent = error.message;
  }
});

/* --- knowledge: one search across everything held locally ---------------- */

$("#knowledge-search").addEventListener("input", debounce(async (event) => {
  const query = event.target.value.trim();
  const results = $("#knowledge-results");
  results.innerHTML = "";
  if (!query) {
    results.append(el("p", "empty", "Type to search across memories, documents and past conversations."));
    return;
  }
  const encoded = encodeURIComponent(query);
  const [memories, passages, messages] = await Promise.all([
    get(`/api/memory/search?q=${encoded}&limit=10`),
    get(`/api/documents/search?q=${encoded}&limit=10`),
    get(`/api/conversations/search?q=${encoded}&limit=10`),
  ]);

  const total = memories.length + passages.length + messages.length;
  if (!total) {
    results.append(el("p", "empty", "Nothing on this machine matches that."));
    return;
  }

  if (memories.length) {
    results.append(el("h2", "group-head", `Memories (${memories.length})`));
    for (const hit of memories) {
      const row = el("div", "record");
      const head = el("div", "record-head");
      head.append(el("span", "tag", hit.memory.category.replace(/_/g, " ")));
      head.append(el("span", "grow"));
      head.append(el("span", "muted", `score ${hit.score.toFixed(2)}`));
      row.append(head, el("div", "record-body", hit.memory.content));
      results.append(row);
    }
  }
  if (passages.length) {
    results.append(el("h2", "group-head", `Documents (${passages.length})`));
    for (const hit of passages) {
      const row = el("div", "record");
      const head = el("div", "record-head");
      head.append(el("strong", null, hit.filename));
      head.append(el("span", "muted", `part ${hit.part} of ${hit.parts}`));
      row.append(head, el("div", "record-body", hit.text.slice(0, 400)));
      results.append(row);
    }
  }
  if (messages.length) {
    results.append(el("h2", "group-head", `Conversations (${messages.length})`));
    for (const hit of messages) {
      const row = el("div", "record");
      const head = el("div", "record-head");
      head.append(el("strong", null, hit.title));
      head.append(el("span", "muted", hit.role));
      head.append(el("span", "grow"));
      head.append(el("span", "muted", when(hit.created_at)));
      row.append(head, el("div", "record-body", hit.text));
      const open = el("button", "link-btn", "Open conversation");
      open.addEventListener("click", async () => {
        go("chat");
        await openConversation(hit.conversation_id);
      });
      const actions = el("div", "record-actions");
      actions.append(open);
      row.append(actions);
      results.append(row);
    }
  }
}, 250));

/* --- conversation search in the chat rail -------------------------------- */

$("#thread-search").addEventListener("input", debounce(async (event) => {
  const query = event.target.value.trim();
  if (!query) {
    await loadConversations();
    return;
  }
  const hits = await get(`/api/conversations/search?q=${encodeURIComponent(query)}`);
  const list = $("#thread-list");
  list.innerHTML = "";
  if (!hits.length) {
    list.append(el("p", "empty", "No message matches."));
    return;
  }
  const seen = new Set();
  for (const hit of hits) {
    if (seen.has(hit.conversation_id)) continue;
    seen.add(hit.conversation_id);
    const row = el("button", "thread");
    row.append(el("span", "title", hit.title));
    row.addEventListener("click", () => openConversation(hit.conversation_id));
    list.append(row);
  }
}, 250));

/* --- the context inspector ---------------------------------------------- */

$("#context-refresh").addEventListener("click", async () => {
  const container = $("#context-traces");
  container.innerHTML = "";
  const traces = await get("/api/context/recent?include_system=true");
  if (!traces.length) {
    container.append(el("p", "empty", "Nothing sent yet in this session."));
    return;
  }
  for (const trace of traces) {
    const row = el("details", "trace");
    const summary = el("summary");
    summary.textContent =
      `${trace.query.slice(0, 50) || "(no query)"} - ${trace.total_chars} chars, `
      + `${trace.snippets.length} local record${trace.snippets.length === 1 ? "" : "s"}`;
    row.append(summary);
    const meta = el("div", "trace-meta");
    meta.textContent = `intent ${trace.intent} - model ${trace.model} - `
      + `${trace.history_messages} history messages - tools: ${trace.tools.join(", ") || "none"}`;
    row.append(meta);
    for (const snippet of trace.snippets) {
      row.append(el("div", "trace-snippet", `${snippet.source}: ${snippet.title} (${snippet.chars} chars)`));
    }
    const pre = el("pre", "trace-system");
    pre.textContent = trace.system_text || "";
    row.append(pre);
    container.append(row);
  }
});

/* --- rating: the one quality signal that is not inferred ------------------ */

function ratingRow(interactionId, current) {
  const wrap = el("span", "rate");
  for (const [rating, glyph, title] of [
    ["up", "▲", "This answer was good"],
    ["down", "▼", "This answer was poor"],
  ]) {
    const button = el("button", current === rating ? "on" : "", glyph);
    button.dataset.rating = rating;
    button.title = title;
    button.setAttribute("aria-label", title);
    button.addEventListener("click", async () => {
      try {
        await api("POST", "/api/learning/feedback", { interaction_id: interactionId, rating });
        for (const sibling of wrap.querySelectorAll("button")) sibling.classList.remove("on");
        button.classList.add("on");
      } catch (error) {
        button.title = error.message;
      }
    });
    wrap.append(button);
  }
  return wrap;
}

/* --- tasks ----------------------------------------------------------------
 * The grouping comes from the server, so the dashboard, this page and the
 * assistant's context all describe the same day the same way. The page never
 * works out what "today" is: a tab left open overnight would otherwise go on
 * insisting nothing is overdue.
 */

const TASK_GROUPS = [
  { key: "overdue", label: "Overdue", late: true },
  { key: "due_today", label: "Today" },
  { key: "due_soon", label: "Next seven days" },
  { key: "undated", label: "No deadline" },
];

async function loadTasks() {
  const query = $("#task-search").value.trim();
  const subject = $("#task-filter").value;
  const showDone = $("#task-show-done").checked;

  let agenda;
  try {
    agenda = await get("/api/tasks/agenda?days=7");
  } catch (error) {
    $("#task-groups").innerHTML = "";
    $("#task-groups").append(el("p", "empty", error.message));
    return;
  }
  state.today = agenda.today;

  fillSubjects(agenda.subjects, subject);

  const container = $("#task-groups");
  container.innerHTML = "";

  if (query) {
    const hits = await get(`/api/tasks/search?q=${encodeURIComponent(query)}`);
    container.append(taskGroup({ label: `Matching "${query}"`, tasks: hits }));
  } else {
    let shown = 0;
    for (const group of TASK_GROUPS) {
      let tasks = agenda[group.key] || [];
      if (subject) tasks = tasks.filter((task) => task.subject === subject);
      if (!tasks.length) continue;
      shown += tasks.length;
      container.append(taskGroup({ ...group, tasks }));
    }
    if (!shown) {
      container.append(el("p", "empty", "Nothing outstanding. Add one above, or just tell JARVIS."));
    }
  }

  if (showDone) {
    const done = await get("/api/tasks?status=done");
    if (done.length) container.append(taskGroup({ label: "Finished", tasks: done }));
  }

  const open = TASK_GROUPS.reduce((n, g) => n + (agenda[g.key] || []).length, 0);
  const late = (agenda.overdue || []).length;
  $("#tasks-sub").textContent =
    `${open} open${late ? ` · ${late} overdue` : ""}`;

  const doneCard = $("#task-done-card");
  doneCard.hidden = !showDone;
}

function fillSubjects(subjects, selected) {
  const select = $("#task-filter");
  const wanted = ["", ...subjects].join("|");
  if (select.dataset.filled === wanted) return;
  select.innerHTML = "";
  select.append(new Option("All subjects", ""));
  for (const subject of subjects) select.append(new Option(subject, subject));
  select.value = selected || "";
  select.dataset.filled = wanted;
}

function taskGroup(group) {
  const wrap = el("div", `task-group${group.late ? " late" : ""}`);
  const heading = el("h2");
  heading.append(el("span", null, group.label));
  heading.append(el("span", "count", String(group.tasks.length)));
  wrap.append(heading);
  for (const task of group.tasks) wrap.append(taskRow(task));
  return wrap;
}

function taskRow(task) {
  const row = el("div", `task${task.status === "done" ? " done" : ""}`);
  row.dataset.priority = String(task.priority);

  row.append(el("span", "pri"));

  const tick = el("button", "tick", task.status === "done" ? "✓" : "");
  tick.type = "button";
  tick.title = task.status === "done" ? "Reopen" : "Mark finished";
  tick.setAttribute("aria-label", tick.title);
  tick.addEventListener("click", async () => {
    const action = task.status === "done" ? "reopen" : "complete";
    try {
      await api("POST", `/api/tasks/${task.id}/${action}`);
      await loadTasks();
      await loadDashboard();
    } catch (error) {
      $("#task-error").textContent = error.message;
    }
  });
  row.append(tick);

  const body = el("div", "body");
  body.append(el("div", "title", task.title));

  const sub = el("div", "sub");
  if (task.due_on) {
    const when = task.due_time ? `${task.due_on} ${task.due_time}` : task.due_on;
    sub.append(el("span", task.overdue ? "late" : null, when));
  }
  if (task.priority !== 2) sub.append(el("span", null, task.priority_label));
  if (task.subject) sub.append(el("span", null, task.subject));
  if (task.project) sub.append(el("span", null, `#${task.project}`));
  /* Where a row came from, because a task JARVIS wrote down should be
   * recognisable as one you did not type yourself. */
  if (task.source === "assistant") sub.append(el("span", "from", "added by JARVIS"));
  if (sub.childElementCount) body.append(sub);
  if (task.notes) body.append(el("div", "notes", task.notes));
  row.append(body);

  const drop = el("button", "drop", "×");
  drop.type = "button";
  drop.title = "Delete";
  drop.setAttribute("aria-label", `Delete ${task.title}`);
  drop.addEventListener("click", async () => {
    try {
      await api("DELETE", `/api/tasks/${task.id}`);
      await loadTasks();
      await loadDashboard();
    } catch (error) {
      $("#task-error").textContent = error.message;
    }
  });
  row.append(drop);

  return row;
}

$("#task-add-toggle").addEventListener("click", () => {
  const form = $("#task-form");
  form.hidden = !form.hidden;
  if (!form.hidden) $("#task-title").focus();
});

$("#task-save").addEventListener("click", async () => {
  $("#task-error").textContent = "";
  const title = $("#task-title").value.trim();
  if (!title) {
    $("#task-error").textContent = "A task needs a title.";
    return;
  }
  try {
    await api("POST", "/api/tasks", {
      title,
      due_on: $("#task-due").value || null,
      due_time: $("#task-time").value || null,
      priority: Number($("#task-priority").value),
      subject: $("#task-subject").value.trim(),
      project: $("#task-project").value.trim(),
      notes: $("#task-notes").value.trim(),
    });
  } catch (error) {
    $("#task-error").textContent = error.message;
    return;
  }
  for (const id of ["#task-title", "#task-due", "#task-time", "#task-subject", "#task-project", "#task-notes"]) {
    $(id).value = "";
  }
  $("#task-priority").value = "2";
  $("#task-form").hidden = true;
  await loadTasks();
  await loadDashboard();
});

$("#task-search").addEventListener("input", debounce(loadTasks, 200));
$("#task-filter").addEventListener("change", loadTasks);
$("#task-show-done").addEventListener("change", loadTasks);

$("#task-clear-done").addEventListener("click", async () => {
  try {
    const result = await api("POST", "/api/tasks/clear-completed");
    $("#task-done-count").textContent = `${result.removed} removed.`;
    await loadTasks();
    await loadDashboard();
  } catch (error) {
    $("#task-error").textContent = error.message;
  }
});

/* --- voice ----------------------------------------------------------------
 * Two backends, chosen separately on the settings page, and this file branches
 * on where each one runs rather than on which one it is. "browser" means the
 * page does the work and nothing is uploaded; "cloud" means the audio goes to
 * the server, which holds the key and talks to the provider. The key never
 * reaches this file - that is the whole reason the server is in the middle.
 */

const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;

function sttLocation() {
  return (state.voice && state.voice.speech_to_text && state.voice.speech_to_text.location) || "none";
}

function ttsLocation() {
  return (state.voice && state.voice.text_to_speech && state.voice.text_to_speech.location) || "none";
}

/* Whether a microphone can be offered at all. The browser path needs the Web
 * Speech API; the cloud path needs only a recorder, which is why choosing
 * Gemini is what makes voice work in Firefox. */
function canListen() {
  if (!state.voice || !state.voice.enabled) return false;
  if (sttLocation() === "browser") return Boolean(SpeechRecognitionImpl);
  if (sttLocation() === "cloud") return Boolean(navigator.mediaDevices && window.MediaRecorder);
  return false;
}

async function loadVoice() {
  try {
    state.voice = await get("/api/voice/profile");
  } catch (_) {
    state.voice = null;
    return;
  }
  $("#mic").hidden = !canListen();
  {
    const cloud = sttLocation() === "cloud" || ttsLocation() === "cloud";
    const audio = $("#rail-audio");
    audio.textContent = !state.voice.enabled ? "off" : cloud ? "leaves this machine" : "stays here";
    audio.className = cloud && state.voice.enabled ? "v offsite" : "v";
    const chip = $("#chip-voice");
    chip.hidden = !state.voice.enabled;
    chip.textContent = cloud ? "voice · cloud" : "voice · local";
    chip.className = `chip ${cloud ? "warm" : "on"}`;
  }

  const panel = $("#voice-profile");
  if (!panel) return;
  panel.innerHTML = "";
  for (const [key, label] of [
    ["speech_to_text", "hearing"],
    ["text_to_speech", "speech"],
    ["wake_word", "wake word"],
  ]) {
    const cap = state.voice[key];
    const row = el("div", "kv");
    row.append(el("span", "k", label));
    const value = el("span", "v", `${cap.name} · ${cap.location}${cap.available ? "" : " · unavailable"}`);
    if (cap.location === "cloud") value.classList.add("offsite");
    row.append(value);
    panel.append(row);
  }
  /* The notes come from the server so that "audio leaves this machine" is
   * stated by the same code that decided it does. */
  for (const note of state.voice.notes || []) panel.append(el("p", "note", note));
  if (state.voice.enabled && !canListen() && sttLocation() === "browser") {
    panel.append(el("p", "note", "This browser has no speech recognition, so the microphone stays hidden. Chrome and Edge have it — or switch hearing to Gemini, which works everywhere."));
  }
}

/* The wake phrase is stripped rather than sent: saying "Jarvis, what's due"
 * should ask what is due, not ask about the word Jarvis. */
function stripWake(text) {
  const phrase = (state.voice && state.voice.wake_phrase) || "";
  if (!phrase) return text;
  return text.replace(new RegExp(`^\\s*${phrase}[,\\s]+`, "i"), "");
}

function listeningStopped() {
  state.listening = false;
  $("#mic").classList.remove("listening");
  if ($("#status").dataset.state === "listening") setStatus("ready", "ready");
}

function listen() {
  if (state.listening || !canListen()) return;
  if (sttLocation() === "cloud") return listenViaServer();
  return listenInPage();
}

function listenInPage() {
  const recognition = new SpeechRecognitionImpl();
  recognition.lang = navigator.language || "en-GB";
  recognition.interimResults = true;
  recognition.continuous = false;

  const input = $("#composer-input");
  state.listening = true;
  $("#mic").classList.add("listening");
  setStatus("listening", "listening");

  recognition.addEventListener("result", (event) => {
    let text = "";
    for (const result of event.results) text += result[0].transcript;
    input.value = stripWake(text);
  });
  recognition.addEventListener("end", () => {
    listeningStopped();
    if ($("#composer-input").value.trim()) send();
  });
  recognition.addEventListener("error", (event) => {
    listeningStopped();
    $("#composer-hint").textContent =
      event.error === "not-allowed" ? "microphone blocked by the browser" : `microphone: ${event.error}`;
  });
  recognition.start();
}

/* Record here, transcribe there. Press once to start, again to stop - there is
 * no silence detection, because guessing wrong truncates someone mid-sentence
 * and a second press is unambiguous. */
async function listenViaServer() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (_) {
    $("#composer-hint").textContent = "microphone blocked by the browser";
    return;
  }

  const recorder = new MediaRecorder(stream);
  const chunks = [];
  state.listening = true;
  state.recorder = recorder;
  $("#mic").classList.add("listening");
  setStatus("listening", "listening · press again to stop");

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data && event.data.size) chunks.push(event.data);
  });

  recorder.addEventListener("stop", async () => {
    /* Release the microphone immediately. A tab that keeps the recording
     * indicator lit after you have stopped talking is its own kind of alarming. */
    for (const track of stream.getTracks()) track.stop();
    state.recorder = null;
    listeningStopped();

    const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
    if (!blob.size) return;
    setStatus("retrieving", "transcribing");
    try {
      const form = new FormData();
      form.append("audio", blob, "speech.webm");
      const response = await fetch("/api/voice/transcribe", {
        method: "POST",
        headers: { "X-Jarvis-Client": "jarvis-web" },
        body: form,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || "transcription failed");
      const text = stripWake(payload.text || "").trim();
      setStatus("ready", "ready");
      if (!text) {
        $("#composer-hint").textContent = "nothing was heard";
        return;
      }
      $("#composer-input").value = text;
      send();
    } catch (error) {
      setStatus("ready", "ready");
      $("#composer-hint").textContent = error.message;
    }
  });

  recorder.start();
}

function stopListening() {
  if (state.recorder && state.recorder.state === "recording") state.recorder.stop();
}

/* Markdown read aloud is unlistenable; strip it to the words. */
function speakable(text) {
  return text
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/[`*_#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* Stop whatever is talking, whichever backend started it. */
function silence() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (state.player) state.player.pause();
  stopListening();
}

function speak(text) {
  const plain = speakable(text);
  if (!plain) return;
  if (ttsLocation() === "cloud") return speakViaServer(plain);
  if (ttsLocation() === "browser") return speakInPage(plain);
}

function speakInPage(plain) {
  if (!window.speechSynthesis) return;
  const utterance = new SpeechSynthesisUtterance(plain.slice(0, 1200));
  utterance.rate = 1.05;
  utterance.pitch = 0.95;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

async function speakViaServer(plain) {
  /* One player, reused, so a fast second answer replaces the first instead of
   * talking over it. */
  if (!state.player) state.player = new Audio();
  state.player.pause();
  try {
    const response = await fetch("/api/voice/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Jarvis-Client": "jarvis-web" },
      body: JSON.stringify({ text: plain.slice(0, 5000) }),
    });
    if (!response.ok) {
      let detail = "could not speak that";
      try {
        detail = (await response.json()).detail || detail;
      } catch (_) {}
      $("#composer-hint").textContent = detail;
      return;
    }
    const blob = await response.blob();
    if (state.playerUrl) URL.revokeObjectURL(state.playerUrl);
    state.playerUrl = URL.createObjectURL(blob);
    state.player.src = state.playerUrl;
    await state.player.play();
  } catch (error) {
    $("#composer-hint").textContent = error.message;
  }
}

$("#mic").addEventListener("click", () => (state.listening ? stopListening() : listen()));

/* --- improvement: evidence, versions, the suite --------------------------- */

async function loadImprovement() {
  const [metrics, versions, cases, activity, problems] = await Promise.all([
    get("/api/learning/metrics"),
    get("/api/learning/versions"),
    get("/api/learning/cases"),
    get("/api/learning/interactions?limit=25"),
    get("/api/learning/problems"),
  ]);

  const readout = $("#metrics-readout");
  readout.innerHTML = "";
  const figures = [
    [metrics.turns, metrics.turns === 1 ? "turn" : "turns", ""],
    [`${Math.round(metrics.approval_rate * 100)}%`, "approved", metrics.rated ? "" : "muted"],
    [`${Math.round(metrics.error_rate * 100)}%`, "errors", metrics.error_rate > 0.05 ? "alert" : ""],
    [`${(metrics.latency_p50_ms / 1000).toFixed(1)}s`, "median", ""],
    [`${(metrics.latency_p95_ms / 1000).toFixed(1)}s`, "slowest 5%", ""],
  ];
  for (const [value, key, cls] of figures) {
    const cell = el("div");
    cell.append(el("div", `n ${cls}`.trim(), String(value)));
    cell.append(el("div", "k", key));
    readout.append(cell);
  }

  /* A bar that means something: how much of the evidence is actually rated. */
  const bars = $("#metrics-bars");
  bars.innerHTML = "";
  const rated = el("div");
  const noun = metrics.turns === 1 ? "turn" : "turns";
  rated.append(el("div", "muted", `${metrics.rated} of ${metrics.turns} ${noun} rated`));
  const bar = el("div", "bar");
  const fill = el("i", metrics.rated_share > 0.1 ? "good" : "");
  fill.style.width = `${Math.min(100, metrics.rated_share * 100)}%`;
  bar.append(fill);
  rated.append(bar);
  bars.append(rated);

  const focus = $("#focus-notes");
  focus.innerHTML = "";
  for (const note of metrics.focus || []) focus.append(el("p", "record-body muted", note));

  const problemList = $("#problem-turns");
  problemList.innerHTML = "";
  if (!problems.length) {
    problemList.append(el("p", "empty", "Nothing failed or was rated down."));
  }
  for (const row of problems.slice(0, 6)) {
    const item = el("div", "record bad");
    item.append(el("div", "record-head")).append(el("span", "muted", when(row.created_at)));
    item.append(el("div", "record-body", row.query.slice(0, 120)));
    item.append(el("div", "muted", row.error || (row.tool_errors ? `${row.tool_errors} tool error(s)` : "rated down")));
    problemList.append(item);
  }

  const active = versions.find((v) => v.status === "active");
  $("#active-version").textContent = active ? `running v${active.number}` : "no active version";
  $("#active-version").className = "pill on";
  state.activeVersion = active;

  const list = $("#version-list");
  list.innerHTML = "";
  for (const version of versions) list.append(versionRow(version));

  const caseList = $("#case-list");
  caseList.innerHTML = "";
  if (!cases.length) {
    caseList.append(el("p", "empty", "No cases yet. Without them a prompt change cannot be judged."));
  }
  for (const item of cases) {
    const row = el("div", "record");
    const head = el("div", "record-head");
    head.append(el("strong", null, item.name));
    head.append(el("span", "tag", item.source));
    head.append(el("span", "grow"));
    const remove = el("button", "link-btn danger-text", "Delete");
    remove.addEventListener("click", async () => {
      await api("DELETE", `/api/learning/cases/${item.id}`);
      loadImprovement();
    });
    head.append(remove);
    row.append(head);
    row.append(el("div", "record-body muted", item.prompt));
    row.append(el("div", "muted-line", item.checks.map((c) => `${c.kind}${c.value ? ": " + c.value : ""}`).join("  ")));
    caseList.append(row);
  }

  const activityList = $("#activity-list");
  activityList.innerHTML = "";
  if (!activity.length) activityList.append(el("p", "empty", "No turns recorded yet."));
  for (const row of activity) {
    const item = el("div", `record${row.error ? " bad" : ""}`);
    const head = el("div", "record-head");
    head.append(el("span", "tag", row.intent));
    head.append(el("span", "muted", `${row.snippets} local · ${row.context_chars} chars · ${(row.latency_ms / 1000).toFixed(1)}s`));
    head.append(el("span", "grow"));
    if (row.rating) head.append(el("span", "muted", row.rating === "up" ? "approved" : "rejected"));
    head.append(el("span", "muted", when(row.created_at)));
    item.append(head);
    item.append(el("div", "record-body", row.query.slice(0, 200)));
    const actions = el("div", "record-actions");
    const promote = el("button", "link-btn", "Make this a test case");
    promote.addEventListener("click", async () => {
      try {
        await api("POST", "/api/learning/cases/promote", { interaction_id: row.id });
        loadImprovement();
      } catch (error) {
        alert(error.message);
      }
    });
    actions.append(promote);
    item.append(actions);
    activityList.append(item);
  }
}

function versionRow(version) {
  const row = el("div", "record");
  const head = el("div", "record-head version");
  head.append(el("span", "num", `v${version.number}`));
  const title = el("span");
  title.append(el("strong", null, version.name || "untitled"));
  head.append(title);
  head.append(el("span", `status-tag ${version.status}`, version.status));
  row.append(head);
  if (version.notes) row.append(el("div", "record-body muted", version.notes));

  const actions = el("div", "record-actions");
  if (version.status !== "active") {
    const evaluate = el("button", "link-btn", "Run the suite");
    evaluate.addEventListener("click", async () => {
      evaluate.textContent = "running...";
      setStatus("thinking", "evaluating");
      try {
        const result = await api("POST", `/api/learning/versions/${version.id}/evaluate`, {});
        const verdict = el("div", "record-body");
        verdict.textContent =
          `${Math.round(result.pass_rate * 100)}% pass (live: ${Math.round(result.baseline_pass_rate * 100)}%). `
          + (result.safe_to_activate ? "No regressions." : `Breaks: ${result.regressions.join(", ")}`);
        row.append(verdict);
        setStatus("ready", "ready");
        loadImprovement();
      } catch (error) {
        evaluate.textContent = "Run the suite";
        setStatus("error", "failed");
        alert(error.message);
      }
    });
    actions.append(evaluate);

    const activate = el("button", "link-btn", "Activate");
    activate.addEventListener("click", async () => {
      try {
        await api("POST", `/api/learning/versions/${version.id}/activate`, { force: false });
        loadImprovement();
      } catch (error) {
        if (confirm(`${error.message}\n\nActivate anyway?`)) {
          await api("POST", `/api/learning/versions/${version.id}/activate`, { force: true });
          loadImprovement();
        }
      }
    });
    actions.append(activate);
  }
  const show = el("button", "link-btn", "Show prompt");
  show.addEventListener("click", () => {
    if (row.querySelector(".sent")) { row.querySelector(".sent").remove(); return; }
    const pre = el("pre", "sent");
    pre.textContent = version.body;
    row.append(pre);
  });
  actions.append(show);
  row.append(actions);
  return row;
}

$("#propose-toggle").addEventListener("click", () => {
  const form = $("#propose-form");
  form.hidden = !form.hidden;
});
$("#version-load-active").addEventListener("click", () => {
  if (state.activeVersion) $("#version-body").value = state.activeVersion.body;
});
$("#version-save").addEventListener("click", async () => {
  $("#version-error").textContent = "";
  try {
    await api("POST", "/api/learning/versions", {
      body: $("#version-body").value,
      name: $("#version-name").value.trim(),
      notes: $("#version-notes").value.trim(),
    });
    $("#propose-form").hidden = true;
    loadImprovement();
  } catch (error) {
    $("#version-error").textContent = error.message;
  }
});
$("#rollback").addEventListener("click", async () => {
  if (!confirm("Roll back to the previous version?")) return;
  try {
    await api("POST", "/api/learning/versions/rollback", {});
    loadImprovement();
  } catch (error) {
    alert(error.message);
  }
});

$("#case-toggle").addEventListener("click", () => {
  const form = $("#case-form");
  form.hidden = !form.hidden;
});
$("#case-save").addEventListener("click", async () => {
  $("#case-error").textContent = "";
  const checks = $("#case-checks").value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const at = line.indexOf(":");
      return at < 0
        ? { kind: line, value: "" }
        : { kind: line.slice(0, at).trim(), value: line.slice(at + 1).trim() };
    });
  const fixture = $("#case-fixture").value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((content) => ({ category: "important_facts", content }));
  try {
    await api("POST", "/api/learning/cases", {
      name: $("#case-name").value.trim(),
      prompt: $("#case-prompt").value.trim(),
      fixture,
      checks,
    });
    $("#case-form").hidden = true;
    $("#case-name").value = $("#case-prompt").value = $("#case-fixture").value = $("#case-checks").value = "";
    loadImprovement();
  } catch (error) {
    $("#case-error").textContent = error.message;
  }
});
