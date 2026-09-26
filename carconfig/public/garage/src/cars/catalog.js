// The list of cars: loading it, describing a car in one line, and filtering.

export async function loadCatalog(url = new URL("../../data/vehicles.json", import.meta.url)) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The vehicle list answered ${response.status}.`);
  const data = await response.json();
  return data.vehicles.filter((v) => v && v.id && v.modelPath);
}

/** "992 · Coupe · 2023" — only the parts that are known. */
export function metaLine(v) {
  return [v.generation, v.bodyStyle, v.year].filter(Boolean).join(" · ");
}

export function fullName(v) {
  return `${v.manufacturer} ${v.model}`;
}

const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function matches(v, { query = "", make = "", category = "" }) {
  if (make && v.manufacturer !== make) return false;
  if (category && v.category !== category) return false;
  const q = fold(query).trim();
  if (!q) return true;
  const hay = fold(`${v.manufacturer} ${v.model} ${v.generation ?? ""} ${v.year ?? ""} ${v.bodyStyle} ${v.category}`);
  return q.split(/\s+/).every((word) => hay.includes(word));
}

export const CATEGORY_ORDER = ["Supercar", "Sports", "GT", "Muscle", "Race", "Sedan", "Hatchback", "Wagon", "SUV", "Truck", "Classic"];

/** Featured cars first, then by make and model. */
export function sortVehicles(list) {
  return [...list].sort(
    (a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)) || a.manufacturer.localeCompare(b.manufacturer) || a.model.localeCompare(b.model),
  );
}
