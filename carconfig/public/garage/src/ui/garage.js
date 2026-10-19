// The garage: every car, searchable, with make and category filters.
import { h, $ } from "./dom.js";
import { metaLine, matches, sortVehicles, CATEGORY_ORDER } from "../cars/catalog.js";

export function mountGarage(catalog, store, { onSelect }) {
  const list = $("garage-list");
  const search = $("garage-search");
  const empty = $("garage-empty");
  const filters = $("garage-filters");
  const sorted = sortVehicles(catalog);

  const makes = [...new Set(catalog.map((v) => v.manufacturer))].sort((a, b) => a.localeCompare(b));
  const categories = CATEGORY_ORDER.filter((c) => catalog.some((v) => v.category === c));
  const select = (label, all, values, key) =>
    h(
      "label",
      {},
      h("span", { class: "visually-hidden" }, label),
      h(
        "select",
        { onchange: (e) => store.set((s) => ({ ...s, filters: { ...s.filters, [key]: e.target.value } })) },
        h("option", { value: "" }, all),
        values.map((v) => h("option", { value: v }, v)),
      ),
    );
  filters.replaceChildren(select("Manufacturer", "All makes", makes, "make"), select("Category", "All types", categories, "category"));
  const count = h("div", { class: "garage-count", "aria-live": "polite" });
  filters.after(count);

  search.addEventListener("input", () => store.set((s) => ({ ...s, filters: { ...s.filters, query: search.value } })));

  const items = new Map();
  for (const v of sorted) {
    const button = h(
      "button",
      { type: "button", class: "car-item", onclick: () => onSelect(v.id) },
      h("div", { class: "car-make" }, v.manufacturer),
      h("div", { class: "car-model" }, v.model),
      h("div", { class: "car-meta" }, metaLine(v)),
    );
    const li = h("li", {}, button);
    items.set(v.id, { li, button, v });
    list.append(li);
  }

  let lastFilters = null;
  let lastId = null;
  const render = (s) => {
    if (s.filters !== lastFilters) {
      lastFilters = s.filters;
      let shown = 0;
      for (const { li, v } of items.values()) {
        const ok = matches(v, s.filters);
        li.hidden = !ok;
        shown += ok;
      }
      empty.hidden = shown > 0;
      count.textContent = `${shown} of ${catalog.length} vehicles`;
    }
    if (s.vehicleId !== lastId) {
      items.get(lastId)?.button.removeAttribute("aria-current");
      const cur = items.get(s.vehicleId);
      cur?.button.setAttribute("aria-current", "true");
      lastId = s.vehicleId;
    }
  };
  render(store.get());
  store.subscribe(render);

  return {
    scrollToCurrent() {
      items.get(store.get().vehicleId)?.button.scrollIntoView({ block: "nearest" });
    },
  };
}
