// Saving builds in this browser, and reading them back safely: anything
// stored by an older version, edited by hand or naming a car or option that
// no longer exists is dropped rather than trusted.
import { FACTORY, FINISHES, RIM_FINISHES, CALIPERS, TRIMS, CARBON, ACCENTS, EXHAUSTS, TINTS, LIGHTS, RIDES, ENVIRONMENTS, VIEWS } from "../config.js";

const KEY = "carbon-garage:v2";
const ids = (list) => new Set(list.map((o) => o.id));
const ALLOWED = {
  rims: ids(RIM_FINISHES),
  calipers: ids(CALIPERS),
  trim: ids(TRIMS),
  carbon: ids(CARBON),
  mirrors: ids(ACCENTS),
  spoiler: ids(ACCENTS),
  exhaust: ids(EXHAUSTS),
  lights: ids(LIGHTS),
  ride: ids(RIDES),
};
const FINISH_IDS = ids(FINISHES);
const TINT_IDS = ids(TINTS);

export const HEX = /^#[0-9a-f]{6}$/i;

/** A build with every field present and valid; unknown values fall back to factory. */
export function cleanBuild(raw) {
  const b = { ...FACTORY };
  if (!raw || typeof raw !== "object") return b;
  for (const [field, allowed] of Object.entries(ALLOWED)) if (allowed.has(raw[field])) b[field] = raw[field];
  if (raw.tint === null || TINT_IDS.has(raw.tint)) b.tint = raw.tint ?? null;
  const p = raw.paint;
  if (p && HEX.test(p.hex) && FINISH_IDS.has(p.finish)) b.paint = { hex: p.hex.toLowerCase(), finish: p.finish, name: typeof p.name === "string" ? p.name.slice(0, 40) : "Custom" };
  return b;
}

export function isFactory(build) {
  return Object.keys(FACTORY).every((k) => (k === "paint" ? !build.paint : build[k] === FACTORY[k]));
}

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadSaved(vehicleIds) {
  try {
    const raw = JSON.parse(storage()?.getItem(KEY) ?? "null");
    if (!raw || typeof raw !== "object") return null;
    const known = new Set(vehicleIds);
    const builds = {};
    for (const [id, b] of Object.entries(raw.builds ?? {})) if (known.has(id)) builds[id] = cleanBuild(b);
    return {
      vehicleId: known.has(raw.vehicleId) ? raw.vehicleId : null,
      builds,
      environment: ids(ENVIRONMENTS).has(raw.environment) ? raw.environment : null,
      view: ids(VIEWS).has(raw.view) ? raw.view : null,
    };
  } catch (err) {
    console.warn("[carbon-garage] ignoring an unreadable saved build", err);
    return null;
  }
}

let timer = 0;
/** Saves soon (writes are batched while sliders and pickers are moving). */
export function save(state) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const builds = {};
    for (const [id, b] of Object.entries(state.builds)) if (!isFactory(b)) builds[id] = b;
    try {
      storage()?.setItem(KEY, JSON.stringify({ vehicleId: state.vehicleId, builds, environment: state.environment, view: state.lastView ?? state.view }));
    } catch {
      /* storage full or blocked: builds simply are not remembered */
    }
  }, 250);
}
