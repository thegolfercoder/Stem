// Everything drawn over the 3D view, and the page chrome around it: view
// buttons, loading and error states, fullscreen, the mobile drawer, the
// garage toggle and keyboard shortcuts.
import { h, $, typing } from "./dom.js";
import { VIEWS } from "../config.js";
import { fullName, metaLine } from "../cars/catalog.js";

export function mountViewer(store, { goTo, resetView, setTurntable, retry, entryById }) {
  const app = $("app");
  const loading = $("loading");
  const fill = $("loading-fill");
  const pct = $("loading-pct");
  const what = $("loading-what");
  const nameEl = $("loading-name");
  const retryBtn = $("loading-retry");
  const credit = $("credit");
  const detail = h("div", { class: "loading-detail" });
  nameEl.after(detail);

  // Views
  const viewButtons = VIEWS.map((v) => h("button", { type: "button", onclick: () => goTo(v.id) }, v.label));
  $("views").replaceChildren(...viewButtons);

  // Top bar
  $("reset-view").addEventListener("click", resetView);
  $("turntable").addEventListener("click", () => setTurntable(!store.get().turntable));
  retryBtn.addEventListener("click", retry);

  // Fullscreen: the view alone, with its controls; Escape or the button brings the panels back.
  const fullscreenBtn = $("fullscreen");
  const setImmersive = async (on) => {
    app.classList.toggle("immersive", on);
    fullscreenBtn.setAttribute("aria-pressed", String(on));
    try {
      if (on && !document.fullscreenElement && app.requestFullscreen) await app.requestFullscreen({ navigationUI: "hide" });
      if (!on && document.fullscreenElement) await document.exitFullscreen();
    } catch {
      /* fullscreen refused (iPhone Safari, iframes): the panels are still hidden */
    }
  };
  fullscreenBtn.addEventListener("click", () => setImmersive(!app.classList.contains("immersive")));
  $("immersive-config").addEventListener("click", () => setImmersive(false));
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && app.classList.contains("immersive")) setImmersive(false);
  });

  // Garage drawer on tablets and phones.
  const garageToggle = $("garage-toggle");
  const setGarage = (on) => {
    app.classList.toggle("garage-open", on);
    garageToggle.setAttribute("aria-expanded", String(on));
    if (on) $("garage-search").focus({ preventScroll: true });
  };
  garageToggle.addEventListener("click", () => setGarage(!app.classList.contains("garage-open")));
  $("viewer").addEventListener("pointerdown", () => app.classList.contains("garage-open") && setGarage(false));

  // Configuration drawer on phones: tap or drag the handle.
  const panel = $("panel");
  const handle = $("drawer-handle");
  const setDrawer = (on) => {
    app.classList.toggle("drawer-open", on);
    handle.setAttribute("aria-expanded", String(on));
  };
  let drag = null;
  handle.addEventListener("pointerdown", (e) => {
    drag = { y: e.clientY, start: app.classList.contains("drawer-open"), moved: 0, height: panel.getBoundingClientRect().height };
    handle.setPointerCapture(e.pointerId);
    panel.classList.add("dragging");
  });
  handle.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.y;
    drag.moved = Math.max(drag.moved, Math.abs(dy));
    const closed = drag.height - 56;
    const offset = Math.min(closed, Math.max(0, (drag.start ? 0 : closed) + dy));
    panel.style.transform = `translateY(${offset}px)`;
  });
  const endDrag = (e) => {
    if (!drag) return;
    panel.classList.remove("dragging");
    panel.style.transform = "";
    const dy = e.clientY - drag.y;
    // A tap is handled by the click event (which keyboards also send); a drag decides here.
    if (drag.moved >= 6) {
      setDrawer(dy < -40 ? true : dy > 40 ? false : drag.start);
      suppressClick = true;
    }
    drag = null;
  };
  let suppressClick = false;
  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);
  handle.addEventListener("click", () => {
    if (suppressClick) return void (suppressClick = false);
    setDrawer(!app.classList.contains("drawer-open"));
  });

  // Keyboard
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (app.classList.contains("immersive")) setImmersive(false);
      else if (app.classList.contains("garage-open")) setGarage(false);
      else if (app.classList.contains("drawer-open")) setDrawer(false);
      return;
    }
    if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    const n = Number(e.key);
    if (n >= 1 && n <= VIEWS.length) goTo(VIEWS[n - 1].id);
    else if (e.key === "r" || e.key === "R") resetView();
    else if (e.key === "f" || e.key === "F") setImmersive(!app.classList.contains("immersive"));
    else if (e.key === "t" || e.key === "T") setTurntable(!store.get().turntable);
  });

  let last = {};
  const render = (s) => {
    viewButtons.forEach((b, i) => b.setAttribute("aria-pressed", String(VIEWS[i].id === s.view)));
    $("turntable").setAttribute("aria-pressed", String(s.turntable));

    const entry = s.entry;
    if (entry !== last.entry) {
      $("vh-make").textContent = entry ? `${entry.manufacturer} / ${metaLine(entry)}` : "";
      $("vh-model").textContent = entry ? entry.model : "";
      credit.replaceChildren(...creditLine(entry));
      document.title = entry ? `${fullName(entry)} · Carbon Garage` : "Carbon Garage";
    }

    const load = s.load;
    if (load !== last.load) {
      const pending = entryById(load.id);
      loading.hidden = load.phase === "ready" || load.phase === "idle";
      loading.dataset.state = load.phase;
      nameEl.textContent = pending ? fullName(pending) : "";
      if (load.phase === "loading") {
        what.textContent = "Loading vehicle";
        detail.textContent = "";
        retryBtn.hidden = true;
        if (load.progress === null) loading.dataset.indeterminate = "";
        else delete loading.dataset.indeterminate;
        const p = Math.round((load.progress ?? 0) * 100);
        fill.style.width = `${p}%`;
        pct.textContent = load.progress === null ? "" : load.stage === "preparing" ? "Preparing" : `${p}%`;
      } else if (load.phase === "error") {
        what.textContent = "Model unavailable";
        detail.textContent = load.message ?? "";
        retryBtn.hidden = !load.retryable;
      }
    }
    last = { entry, load };
  };
  render(store.get());
  store.subscribe(render);

  return { setGarage, setDrawer };
}

function creditLine(entry) {
  const c = entry?.credit;
  if (!c) return [];
  if (c.own) return ["Model built for Carbon Garage from published data"];
  const link = (href, text) => (href ? h("a", { href, target: "_blank", rel: "noopener" }, text) : text);
  return [
    "Model ",
    link(c.source, `“${c.title}”`),
    c.author ? [" by ", link(c.authorUrl, c.author)] : null,
    c.license ? [" · ", link(c.licenseUrl, c.license)] : null,
  ].flat().filter(Boolean);
}
