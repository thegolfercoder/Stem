// Carbon Garage: wiring the studio, the cars and the panels together.
import { Studio } from "./scene/studio.js";
import { loadCatalog } from "./cars/catalog.js";
import { ModelLoader, VehicleCache, LoadError } from "./cars/loader.js";
import { Vehicle } from "./cars/vehicle.js";
import { createStore } from "./state/store.js";
import { loadSaved, save, cleanBuild } from "./state/persistence.js";
import { mountGarage } from "./ui/garage.js";
import { mountConfigurator } from "./ui/configurator.js";
import { mountSummary } from "./ui/summary.js";
import { mountViewer } from "./ui/viewer.js";
import { FACTORY, VIEWS } from "./config.js";
import { $ } from "./ui/dom.js";

const log = (...args) => console.info("[carbon-garage]", ...args);

function fatal(title, message) {
  const loading = $("loading");
  loading.hidden = false;
  loading.dataset.state = "error";
  $("loading-what").textContent = title;
  $("loading-name").textContent = message;
  $("loading-retry").hidden = false;
  $("loading-retry").onclick = () => location.reload();
}

async function boot() {
  let studio;
  try {
    studio = new Studio($("view"), $("viewer"));
  } catch (err) {
    console.error("[carbon-garage] WebGL could not start", err);
    return fatal("3D unavailable", "This browser could not start WebGL. Try another browser or enable hardware acceleration.");
  }
  studio.setViews(VIEWS);

  let catalog;
  try {
    catalog = await loadCatalog();
  } catch (err) {
    console.error("[carbon-garage] vehicle list failed", err);
    return fatal("Garage unavailable", "The vehicle list could not be loaded.");
  }
  const byId = new Map(catalog.map((v) => [v.id, v]));
  const saved = loadSaved(catalog.map((v) => v.id));
  const fromHash = decodeURIComponent(location.hash.slice(1));
  const first = byId.has(fromHash) ? fromHash : saved?.vehicleId ?? (byId.has("porsche/911-gt3-rs") ? "porsche/911-gt3-rs" : catalog[0].id);

  const store = createStore({
    vehicleId: null,
    builds: saved?.builds ?? {},
    environment: saved?.environment ?? "studio",
    view: saved?.view ?? "hero",
    lastView: saved?.view ?? "hero",
    turntable: false,
    filters: { query: "", make: "", category: "" },
    load: { phase: "idle" },
    entry: null,
    caps: null,
    info: null,
  });

  const loader = new ModelLoader();
  const cache = new VehicleCache(3);
  let current = null;
  let request = null;

  const buildOf = (s, id = s.vehicleId) => s.builds[id] ?? FACTORY;

  async function select(id, { retry = false } = {}) {
    const entry = byId.get(id);
    if (!entry) return;
    if (!retry && store.get().vehicleId === id && store.get().load.phase !== "error") return;
    request?.abort();
    const controller = new AbortController();
    request = controller;
    store.set({ vehicleId: id, load: { phase: "loading", id, progress: 0 } });
    history.replaceState(null, "", `#${id}`);

    let vehicle = cache.get(id);
    try {
      if (!vehicle) {
        const started = performance.now();
        let lastShown = 0;
        const gltf = await loader.load(entry, {
          signal: controller.signal,
          onProgress: (p) => {
            // At most ~20 updates a second; progress bars need no more.
            const now = performance.now();
            if (p !== 1 && now - lastShown < 50) return;
            lastShown = now;
            if (request === controller) store.set({ load: { phase: "loading", id, progress: p } });
          },
        });
        if (request !== controller) return;
        store.set({ load: { phase: "loading", id, progress: 1, stage: "preparing" } });
        await new Promise((r) => requestAnimationFrame(r)); // let the bar paint before the heavy step
        vehicle = new Vehicle(gltf, entry, { anisotropy: studio.anisotropy });
        log(`${id}: ${vehicle.info.triangles.toLocaleString()} triangles, length ${vehicle.info.measured.length.toFixed(2)} m (${vehicle.info.lengthSource}), paint ${vehicle.info.paintHow}, wheels ${vehicle.caps.wheels ? "found" : "not found"}, ${Math.round(performance.now() - started)} ms`, vehicle.caps);
        cache.put(id, vehicle, current?.entry.id);
      }
      if (request !== controller) return;
      const s = store.get();
      vehicle.apply(cleanBuild(buildOf(s, id)));
      current = vehicle;
      studio.showVehicle(vehicle, { view: s.lastView, intro: true });
      const caps = {
        ...vehicle.caps,
        factoryHex: vehicle.parts.paint[0] ? `#${vehicle.factoryOf(vehicle.parts.paint[0]).color.getHexString()}` : null,
        mirrorsArePaint: vehicle.parts.mirrors.every((m) => vehicle.parts.paint.some((p) => p.original === m.original)),
      };
      store.set({ entry, caps, info: vehicle.info, view: s.lastView, load: { phase: "ready", id } });
    } catch (err) {
      if (err?.name === "AbortError" || request !== controller) return;
      console.error(`[carbon-garage] ${id} failed to load`, { url: loader.urlFor(entry), error: err, cause: err?.cause });
      store.set({
        load: {
          phase: "error",
          id,
          retryable: true,
          message: err instanceof LoadError ? err.message : "The model loaded but could not be prepared for the studio.",
        },
      });
    }
  }

  function setBuild(build) {
    const s = store.get();
    if (!s.vehicleId) return;
    const clean = cleanBuild(build);
    const before = buildOf(s);
    store.set({ builds: { ...s.builds, [s.vehicleId]: clean } });
    if (current && current.entry.id === s.vehicleId) {
      current.apply(clean);
      if (before.ride !== clean.ride || before.lights !== clean.lights) studio.refreshShadow();
      studio.invalidate();
    }
  }

  const ui = {
    goTo: (view) => {
      studio.goTo(view);
      store.set({ view, lastView: view });
    },
    resetView: () => {
      studio.resetView();
      store.set({ view: "hero", lastView: "hero" });
    },
    setTurntable: (on) => {
      studio.setTurntable(on);
      store.set({ turntable: on });
    },
    setEnvironment: (id) => {
      studio.setEnvironment(id);
      store.set({ environment: id });
    },
  };

  const viewer = mountViewer(store, { ...ui, retry: () => select(store.get().vehicleId, { retry: true }), entryById: (id) => byId.get(id) });
  const garage = mountGarage(catalog, store, {
    onSelect: (id) => {
      select(id);
      if (matchMedia("(max-width: 1180px)").matches) viewer.setGarage(false);
    },
  });
  mountConfigurator(store, { setBuild, setEnvironment: ui.setEnvironment, setTurntable: ui.setTurntable });
  mountSummary(store, {
    onReset: () => {
      setBuild({ ...FACTORY });
    },
  });

  // Orbiting by hand leaves the preset.
  studio.rig.controls.addEventListener("start", () => store.get().view && store.set({ view: null }));

  store.subscribe((s, prev) => {
    if (s.builds !== prev.builds || s.vehicleId !== prev.vehicleId || s.environment !== prev.environment || s.lastView !== prev.lastView) save(s);
  });

  studio.setEnvironment(store.get().environment);
  window.addEventListener("hashchange", () => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (byId.has(id)) select(id);
  });
  await select(first);
  garage.scrollToCurrent();

  // For automated checks and debugging from the console.
  window.carbonGarage = { store, studio, select, setBuild, current: () => current, catalog };
}

boot().catch((err) => {
  console.error("[carbon-garage] start-up failed", err);
  fatal("Something went wrong", "Carbon Garage could not start. Reload to try again.");
});
