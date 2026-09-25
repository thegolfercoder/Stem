/**
 * Matching 3D models to the catalogue's model lines, shared by every model
 * source (Sketchfab search, the Objaverse mirror).
 *
 * A model matches a line when its title names the model; it is ranked by how
 * clearly it names the make and year, how usable its licence is, and whether
 * it is detailed enough to draw without being too heavy for a browser.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REJECTS = join(ROOT, "src", "data", "vehicles", "model-rejects.json");

/**
 * Models looked at and turned down for a car, with why: the wrong car, a
 * scene rather than a car, a wreck. Keyed by model line, then model id.
 */
export function rejects() {
  return JSON.parse(readFileSync(REJECTS, "utf8"));
}
const IDENTITIES = join(ROOT, "src", "data", "vehicles", "generated", "identities.json");
const CURATED = join(ROOT, "src", "data", "vehicles", "curated-lines.ts");

export const USABLE = new Set(["cc0", "by", "by-sa"]);
export const NONCOMMERCIAL = new Set(["by-nc", "by-nc-sa"]);
/** Things that come up for a car's name but are not the car. */
export const NOT_A_CAR =
  /\b(lego|toy|hot ?wheels|rc|diecast|keychain|wheels?|rims?|tires?|tyres?|engine|interior|seat|steering|badge|logo|emblem|headlights?|taillights?|exhaust|brake|caliper|chassis only|wreck(ed)?|destroyed|burnt|crashed|scale model kit|papercraft|low[ -]?poly|toon|cartoon|chibi|voxel|minecraft|roblox|concept|futuristic|cyberpunk|fantasy|styli[sz]ed|fan ?art|kitbash|battery|rusty|abandoned|transparent|x ?ray|cutaway|water ?pump|unfinished|wip|dashboard|dash 3d\w*|diorama|nascar|ride ?on|missing)\b/i;

/**
 * Models ripped from games. Whoever uploads one has no right to license it,
 * whatever licence the upload claims.
 */
export const GAME_RIP =
  /\b(nfs\w*|need for speed|forza|gta|gran turismo|assetto|project cars|the crew|asphalt \d|ripped|rip|dirt rally|wreckfest|beamng)\b/i;

/** What people write instead of the make's name. */
const MAKE_ALIASES = {
  volkswagen: ["vw"],
  chevrolet: ["chevy"],
  "mercedes-benz": ["mercedes", "benz", "amg"],
  "land-rover": ["range rover", "landrover"],
  "alfa-romeo": ["alfa"],
  "rolls-royce": ["rolls"],
};

/** Does the title name the car's make (or a common short form of it)? */
export function namesMake(title, line) {
  const name = norm(title);
  const squashed = name.replace(/ /g, "");
  const forms = [line.make, ...(MAKE_ALIASES[line.makeSlug] ?? [])].map(norm);
  return forms.some((f) => name.includes(f) || squashed.includes(f.replace(/ /g, "")));
}

/** Words in titles that say nothing about which car it is. */
const FILLER = new Set(["free", "download", "model", "3d", "car", "the", "with", "and", "by", "sketchfab", "fbx", "obj", "blend", "gltf", "rigged", "realistic", "hq", "hd", "high", "poly", "game", "ready"]);

export function modelLines() {
  const raw = JSON.parse(readFileSync(IDENTITIES, "utf8")).vehicles;
  const lines = raw.map((v) => ({ makeSlug: v.makeSlug, make: v.make, modelSlug: v.modelSlug, model: v.model, years: v.years }));
  // Curated lines (e.g. 911 GT3 RS) live in TypeScript; pull the few fields out.
  const src = readFileSync(CURATED, "utf8");
  for (const m of src.matchAll(/makeSlug: "([^"]+)",\s*make: "([^"]+)",\s*modelSlug: "([^"]+)",\s*model: "([^"]+)",\s*years: \[([^\]]*)\]/g)) {
    lines.push({ makeSlug: m[1], make: m[2], modelSlug: m[3], model: m[4], years: m[5].split(",").map((y) => Number(y.trim())) });
  }
  // Names of the make's other models ("camaro" for the Chevrolet SS): a title
  // naming one of those is that car, not this one.
  const byMake = new Map();
  for (const l of lines) {
    if (!byMake.has(l.makeSlug)) byMake.set(l.makeSlug, []);
    byMake.get(l.makeSlug).push(l);
  }
  return lines.map((l) => {
    const own = new Set(tokens(l.model));
    const siblings = new Set();
    for (const o of byMake.get(l.makeSlug)) {
      if (o === l) continue;
      for (const t of tokens(o.model)) if (t.length >= 4 && !own.has(t) && !/^\d+$/.test(t)) siblings.add(t);
    }
    return { ...l, siblings };
  });
}

export const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const tokens = (s) => norm(s).split(" ").filter(Boolean);

/** How well a result's name matches the car, or null if it is not this car. */
export function score(result, line, lic) {
  const name = norm(result.name);
  if (NOT_A_CAR.test(result.name) || GAME_RIP.test(result.name)) return null;

  // Every token of the model name must appear ("mx 5", "911 gt3 rs"), as a
  // word or, for the whole name, joined up ("mx5" matches "mx 5"). A short
  // token only counts as a word: the "a" of "A-Class" is in every title.
  const squashed = name.replace(/ /g, "");
  const words = name.split(" ");
  const joined = squashed.includes(tokens(line.model).join(""));
  for (const t of tokens(line.model)) {
    if (words.includes(t)) continue;
    if (joined) continue;
    if (t.length >= 3 && squashed.includes(t)) continue;
    return null;
  }
  if (line.siblings && words.some((w) => line.siblings.has(w))) return null;
  // A result naming a longer variant ("911 GT3 RS" when looking for "911")
  // is a different car's measurements but the same shape; allow it, ranked lower.
  let s = 0;
  if (tokens(line.make).every((t) => name.includes(t))) s += 30;
  const extra = tokens(name).filter(
    (t) => !FILLER.has(t) && !tokens(line.make).includes(t) && !tokens(line.model).includes(t) && !/^(19|20)\d\d$/.test(t),
  );
  // A model named by letters alone ("SS") is only this car when the title
  // says nothing else: "Chevelle SS" and "Nova SS" are other cars.
  // Chassis codes (E36, W212, MK4) only say which generation it is.
  const naming = extra.filter((t) => !/^[a-z]{1,2}\d{1,3}$/.test(t));
  const code = tokens(line.model).join("");
  if (code.length <= 2 && /^[a-z]+$/.test(code) && naming.length > 0) return null;
  s -= Math.min(extra.length, 8) * 2;

  // A year past the present is a fan's future car, not this one.
  if (Number(name.match(/\b(20[3-9]\d)\b/)?.[1]) > new Date().getFullYear() + 1) return null;
  const year = name.match(/\b(19[5-9]\d|20[0-4]\d)\b/);
  if (year && line.years.includes(Number(year[1]))) s += 12;
  if (year && !line.years.includes(Number(year[1]))) s -= 6;

  if (USABLE.has(lic)) s += 25;
  else if (NONCOMMERCIAL.has(lic)) s += 5;
  else return null;

  const faces = result.faceCount ?? 0;
  if (faces < 8000) return null; // too crude to be worth drawing
  if (faces > 2_500_000) s -= 25; // too heavy for a browser
  else if (faces > 1_200_000) s -= 10;
  else if (faces >= 60_000) s += 10;

  s += Math.min(Math.log10((result.likeCount ?? 0) + 1) * 6, 18);
  return s;
}


/** A Sketchfab model's id, from any of the forms its page URL comes in. */
export const uidOf = (url) => String(url ?? "").match(/[0-9a-f]{32}/)?.[0] ?? null;
