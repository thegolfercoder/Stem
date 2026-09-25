import * as THREE from "three";

/**
 * Physically correct materials for downloaded car models.
 *
 * Models arrive authored for whatever renderer their maker used, and often
 * badly for this one: opaque black glass, chrome that is really grey plastic,
 * tyres as shiny as the paint. Each material is identified by its name — the
 * only thing a car model reliably says about its parts — and given the
 * physical properties of what it is, keeping the model's own textures.
 *
 * Only materials whose names say what they are are touched. Anything
 * ambiguous is left as the author made it; guessing wrong about a material is
 * worse than leaving it slightly off.
 */

export type MaterialKind =
  | "glass"
  | "lens"
  | "chrome"
  | "tyre"
  | "carbon"
  | "piano_black"
  | "plastic"
  | "leather"
  | "aluminium";

/** "WheelFrontLRim1" → "wheel front l rim 1", so names can be matched by word. */
export function materialWords(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .replace(/[_.\-:]+/g, " ")
    .toLowerCase();
}

// Ordered: the first match wins, so "headlight glass" is a lens, not glass,
// and "gloss black trim" is piano black, not plastic.
const LAMP_WORDS =
  "head ?lights?|tail ?lights?|lamps?|lights?|indicators?|blinkers?|phares?|feux|faros?|fanali|luce|luz|scheinwerfer|leuchten?";
const RULES: readonly (readonly [MaterialKind, RegExp])[] = [
  ["lens", new RegExp(`\\b(${LAMP_WORDS}) ?(glass|lens|cover|vitre|verre|vetro|vidrio|glas)|\\blens(es)?\\b`)],
  ["glass", /\b(glass|windows?|windscreen|windshield|backlight|vitres?|verre|vetro|vetri\w*|vidrios?|cristal(es)?|glas|scheiben?|ventanas?|finestrini)\b/],
  ["tyre", /\b(tyres?|tires?|rubber|tread|sidewall|pneus?|pneumatici|gomma|gomme|goma|neumaticos?|reifen)\b/],
  ["carbon", /\b(carbon|cfrp|carbon ?fib(re|er)|carbone|carbono)\b/],
  ["piano_black", /\b(piano ?black|gloss ?black|black ?gloss)\b/],
  ["chrome", /\b(chrome|chromed|mirror ?finish|polished|chromo|cromo|cromato|chrom)\b/],
  ["aluminium", /\b(alumin(i)?um|brushed ?metal|alloy|alu)\b/],
  ["leather", /\b(leather|alcantara|suede|upholstery|cuir|pelle|cuero|leder)\b/],
  ["plastic", /\b(plastic|trim ?black|black ?trim|textured|matte ?black|grille|grill|plastique|plastica|plastico|kunststoff)\b/],
];

export function classifyMaterial(name: string): MaterialKind | null {
  const w = materialWords(name);
  for (const [kind, re] of RULES) if (re.test(w)) return kind;
  return null;
}

/** A physical material carrying over everything the model authored that still applies. */
function physicalFrom(m: THREE.Material): THREE.MeshPhysicalMaterial {
  if (m instanceof THREE.MeshPhysicalMaterial) return m;
  const src = m as THREE.MeshStandardMaterial;
  const p = new THREE.MeshPhysicalMaterial({
    name: src.name,
    color: src.color?.clone(),
    map: src.map ?? null,
    normalMap: src.normalMap ?? null,
    roughnessMap: src.roughnessMap ?? null,
    metalnessMap: src.metalnessMap ?? null,
    aoMap: src.aoMap ?? null,
    emissive: src.emissive?.clone(),
    emissiveMap: src.emissiveMap ?? null,
    emissiveIntensity: src.emissiveIntensity ?? 1,
    alphaMap: src.alphaMap ?? null,
    transparent: src.transparent,
    opacity: src.opacity,
    side: src.side,
    roughness: src.roughness ?? 0.5,
    metalness: src.metalness ?? 0,
  });
  if (src.normalScale) p.normalScale.copy(src.normalScale);
  return p;
}

/** The corrected material for one of a model's materials, or the original if it is not recognised. */
export function normaliseMaterial(m: THREE.Material): THREE.Material {
  const kind = classifyMaterial(m.name);
  if (!kind) return m;
  const p = physicalFrom(m);

  switch (kind) {
    case "glass":
      // Automotive glass: faintly green-grey, clear, and reflective at glancing
      // angles. Transparency rather than refraction keeps it cheap enough for
      // a phone, and at a car's glass thickness the difference is invisible.
      p.color.set("#1c2528");
      p.metalness = 0;
      p.roughness = 0.02;
      p.transparent = true;
      p.opacity = 0.38;
      p.depthWrite = false;
      p.ior = 1.52;
      p.envMapIntensity = 1.3;
      p.side = THREE.DoubleSide;
      break;
    case "lens":
      // Clear polycarbonate over the lamp: the reflector and LEDs behind it
      // show through.
      p.color.set("#ffffff");
      p.metalness = 0;
      p.roughness = 0.03;
      p.transparent = true;
      p.opacity = 0.22;
      p.depthWrite = false;
      p.clearcoat = 1;
      p.clearcoatRoughness = 0.02;
      break;
    case "chrome":
      p.color.set("#e4e7ea");
      p.metalness = 1;
      p.roughness = 0.04;
      p.envMapIntensity = 1.4;
      break;
    case "aluminium":
      p.metalness = 1;
      p.roughness = 0.28;
      break;
    case "tyre":
      p.color.lerp(new THREE.Color("#141414"), 0.6);
      p.metalness = 0;
      p.roughness = 0.9;
      p.clearcoat = 0;
      p.envMapIntensity = 0.5;
      break;
    case "carbon":
      p.metalness = 0.1;
      p.roughness = 0.35;
      p.clearcoat = 1;
      p.clearcoatRoughness = 0.04;
      break;
    case "piano_black":
      p.color.set("#060607");
      p.metalness = 0;
      p.roughness = 0.08;
      p.clearcoat = 1;
      p.clearcoatRoughness = 0.02;
      break;
    case "plastic":
      p.metalness = 0;
      p.roughness = Math.max(p.roughness, 0.6);
      p.clearcoat = 0;
      break;
    case "leather":
      p.metalness = 0;
      p.roughness = 0.55;
      p.sheen = 0.3;
      p.sheenRoughness = 0.6;
      break;
  }
  p.needsUpdate = true;
  return p;
}
