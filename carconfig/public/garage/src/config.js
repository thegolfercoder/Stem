// Option lists and the fixed numbers the viewer is built around.

/** Where models live: `<meta name="carbon-models" content="<prefix>|<extension>">`. */
export function modelSource() {
  const meta = document.querySelector('meta[name="carbon-models"]')?.content ?? "../models/|.glb";
  const [prefix, ext] = meta.split("|");
  return { prefix, ext: ext || ".glb" };
}

export const FINISHES = [
  { id: "solid", label: "Solid" },
  { id: "metallic", label: "Metallic" },
  { id: "pearl", label: "Pearl" },
  { id: "satin", label: "Satin" },
  { id: "matte", label: "Matte" },
  { id: "chrome", label: "Chrome" },
];

export const PAINTS = [
  { id: "chalk", name: "Chalk", hex: "#d6d3ca", finish: "solid" },
  { id: "glacier-white", name: "Glacier White", hex: "#eceeee", finish: "solid" },
  { id: "jet-black", name: "Jet Black", hex: "#0c0d0f", finish: "solid" },
  { id: "nardo-grey", name: "Nardo Grey", hex: "#7a7e81", finish: "solid" },
  { id: "guards-red", name: "Guards Red", hex: "#b60f16", finish: "solid" },
  { id: "racing-yellow", name: "Racing Yellow", hex: "#efc01a", finish: "solid" },
  { id: "lava-orange", name: "Lava Orange", hex: "#dc5216", finish: "solid" },
  { id: "miami-blue", name: "Miami Blue", hex: "#1593cc", finish: "solid" },
  { id: "python-green", name: "Python Green", hex: "#5f9f38", finish: "solid" },
  { id: "gt-silver", name: "GT Silver", hex: "#b4b8bc", finish: "metallic" },
  { id: "gunmetal", name: "Gunmetal", hex: "#3a3f45", finish: "metallic" },
  { id: "obsidian", name: "Obsidian Black", hex: "#121418", finish: "metallic" },
  { id: "gentian-blue", name: "Gentian Blue", hex: "#1b3b74", finish: "metallic" },
  { id: "british-racing-green", name: "British Racing Green", hex: "#173424", finish: "metallic" },
  { id: "crimson", name: "Crimson", hex: "#7a0c16", finish: "metallic" },
  { id: "pearl-white", name: "Pearl White", hex: "#eae9e3", finish: "pearl" },
  { id: "ultraviolet", name: "Ultraviolet", hex: "#43297c", finish: "pearl" },
  { id: "satin-graphite", name: "Satin Graphite", hex: "#484b50", finish: "satin" },
  { id: "frozen-black", name: "Frozen Black", hex: "#1a1b1e", finish: "matte" },
  { id: "frozen-blue", name: "Frozen Blue", hex: "#5d7d99", finish: "matte" },
  { id: "liquid-chrome", name: "Liquid Chrome", hex: "#d6dbe0", finish: "chrome" },
];

export const RIM_FINISHES = [
  { id: "factory", label: "Factory" },
  { id: "silver", label: "Silver", hex: "#c4c7ca" },
  { id: "gunmetal", label: "Gunmetal", hex: "#4a4e53" },
  { id: "black", label: "Gloss black", hex: "#0e0f11" },
  { id: "satin-black", label: "Satin black", hex: "#17181a" },
  { id: "chrome", label: "Chrome", hex: "#e6e9ec" },
];

export const CALIPERS = [
  { id: "factory", label: "Factory" },
  { id: "red", label: "Red", hex: "#c3141a" },
  { id: "yellow", label: "Yellow", hex: "#f0bf12" },
  { id: "orange", label: "Orange", hex: "#e2601c" },
  { id: "black", label: "Black", hex: "#121315" },
];

export const TRIMS = [
  { id: "factory", label: "Factory" },
  { id: "gloss-black", label: "Gloss black", hex: "#0d0e10" },
  { id: "satin-black", label: "Satin black", hex: "#17181a" },
  { id: "chrome", label: "Chrome", hex: "#e4e7ea" },
];

export const CARBON = [
  { id: "factory", label: "Factory" },
  { id: "gloss", label: "Gloss" },
  { id: "matte", label: "Matte" },
  { id: "body", label: "Body colour" },
];

export const ACCENTS = [
  { id: "factory", label: "Factory" },
  { id: "body", label: "Body colour" },
  { id: "gloss-black", label: "Gloss black", hex: "#0d0e10" },
];

export const EXHAUSTS = [
  { id: "factory", label: "Factory" },
  { id: "black", label: "Black", hex: "#141517" },
  { id: "titanium", label: "Titanium", hex: "#8f8576" },
  { id: "polished", label: "Polished", hex: "#e2e4e6" },
];

export const TINTS = [
  { id: "clear", label: "Clear", opacity: 0.2, hex: "#27302f" },
  { id: "light", label: "Light", opacity: 0.42, hex: "#1c2426" },
  { id: "dark", label: "Dark", opacity: 0.7, hex: "#0e1215" },
  { id: "limo", label: "Limo", opacity: 0.93, hex: "#050607" },
];

export const LIGHTS = [
  { id: "off", label: "Off" },
  { id: "drl", label: "DRL" },
  { id: "on", label: "Headlights" },
];

/** Body height change in metres; the wheels stay where they are. */
export const RIDES = [
  { id: "raised", label: "Raised", offset: 0.025, note: "+25 mm" },
  { id: "factory", label: "Factory", offset: 0, note: "" },
  { id: "lowered", label: "Lowered", offset: -0.03, note: "−30 mm" },
];

export const ENVIRONMENTS = [
  { id: "studio", label: "Studio" },
  { id: "dark", label: "Dark" },
  { id: "showroom", label: "Showroom" },
  { id: "sunset", label: "Sunset" },
  { id: "softbox", label: "Softbox" },
];

/**
 * Camera presets: azimuth from the car's nose toward its right side, and
 * elevation above the horizon, in degrees. Distance is always fitted.
 */
export const VIEWS = [
  { id: "hero", label: "¾ Front", azimuth: 38, elevation: 11 },
  { id: "side", label: "Side", azimuth: 90, elevation: 3 },
  { id: "rear", label: "¾ Rear", azimuth: 145, elevation: 13 },
  { id: "front", label: "Front", azimuth: 0, elevation: 5 },
  { id: "top", label: "Top", azimuth: 90, elevation: 89 },
];

export const FACTORY = Object.freeze({
  paint: null, // { hex, finish, name } or null for the model's own paint
  rims: "factory",
  calipers: "factory",
  trim: "factory",
  carbon: "factory",
  mirrors: "factory",
  spoiler: "factory",
  exhaust: "factory",
  tint: null, // null keeps the model's own glass
  lights: "off",
  ride: "factory",
});
