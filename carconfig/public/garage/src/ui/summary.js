// The build summary: every option this car supports, what it is set to, and
// a way back to factory.
import { h, $ } from "./dom.js";
import { FINISHES, RIM_FINISHES, CALIPERS, TRIMS, CARBON, ACCENTS, EXHAUSTS, TINTS, LIGHTS, RIDES, FACTORY } from "../config.js";
import { isFactory } from "../state/persistence.js";

const labelOf = (list, id) => list.find((o) => o.id === id)?.label ?? "Factory";
export const finishLabel = (id) => labelOf(FINISHES, id);

export function paintText(paint) {
  return paint ? `${paint.name} · ${finishLabel(paint.finish)}` : "Factory";
}

/** Rows for the options a car supports, in panel order. */
export function describe(build, caps) {
  if (!caps) return [];
  const rows = [];
  const row = (key, label, value, changed) => rows.push({ key, label, value, changed });
  if (caps.paint) row("paint", "Paint", paintText(build.paint), Boolean(build.paint));
  if (caps.trim) row("trim", "Trim", labelOf(TRIMS, build.trim), build.trim !== FACTORY.trim);
  if (caps.carbon) row("carbon", "Carbon", labelOf(CARBON, build.carbon), build.carbon !== FACTORY.carbon);
  if (caps.mirrors) row("mirrors", "Mirror caps", labelOf(ACCENTS, build.mirrors), build.mirrors !== FACTORY.mirrors);
  if (caps.spoiler) row("spoiler", "Spoiler", labelOf(ACCENTS, build.spoiler), build.spoiler !== FACTORY.spoiler);
  if (caps.exhaust) row("exhaust", "Exhaust tips", labelOf(EXHAUSTS, build.exhaust), build.exhaust !== FACTORY.exhaust);
  if (caps.rims) row("rims", "Wheel finish", labelOf(RIM_FINISHES, build.rims), build.rims !== FACTORY.rims);
  if (caps.calipers) row("calipers", "Calipers", labelOf(CALIPERS, build.calipers), build.calipers !== FACTORY.calipers);
  if (caps.glass) row("tint", "Glass", build.tint ? labelOf(TINTS, build.tint) : "Factory", build.tint !== FACTORY.tint);
  if (caps.lights) row("lights", "Lighting", labelOf(LIGHTS, build.lights), build.lights !== FACTORY.lights);
  if (caps.ride) row("ride", "Ride height", labelOf(RIDES, build.ride), build.ride !== FACTORY.ride);
  return rows;
}

export function mountSummary(store, { onReset }) {
  const root = $("summary");
  const state = h("span", { class: "summary-state" });
  const list = h("ul", { class: "summary-list" });
  const reset = h("button", { type: "button", class: "btn", onclick: onReset }, "Reset to factory");
  root.replaceChildren(h("div", { class: "summary-head" }, h("span", { class: "summary-title" }, "Build"), state), list, reset);

  const render = (s) => {
    const build = s.builds[s.vehicleId] ?? FACTORY;
    const rows = describe(build, s.caps);
    list.replaceChildren(
      ...rows.map((r) => h("li", { dataset: r.changed ? { changed: "" } : {} }, h("span", {}, r.label), h("span", {}, r.value))),
    );
    const factory = isFactory(build);
    state.textContent = !s.caps ? "" : factory ? "Factory" : "Saved in this browser";
    reset.disabled = factory;
    root.hidden = !s.caps;
  };
  render(store.get());
  store.subscribe(render);
}
