// Every other surface on a model, tidied so it reads correctly in a studio:
// textures filtered well, missing values fixed, chrome made mirror-like and
// rubber and plastic kept rough. Colours and textures are never replaced.
import * as THREE from "three";
import { kindOf, nameWords } from "../cars/names.js";
import { toPhysical } from "./paint.js";
import { factoryGlass, lensMaterial } from "./glass.js";
import { factoryTyre } from "./wheels.js";

const TEXTURE_SLOTS = ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap", "alphaMap", "clearcoatNormalMap"];
const METAL_WORDS = /\b(metal\w*|steel|alu\w*|iron|silver|brushed|titan\w*|nickel|gold|bronze|copper)\b/;

export function texturesOf(material) {
  return TEXTURE_SLOTS.map((k) => material[k]).filter(Boolean);
}

export function sharpenTextures(material, anisotropy) {
  for (const t of texturesOf(material)) if (t.anisotropy < anisotropy) (t.anisotropy = anisotropy), (t.needsUpdate = true);
}

/**
 * glTF's default is metalness 1, roughness 1: a dull dark metal. Exporters
 * that forget to write the values produce exactly that, so a material with
 * those values and no texture to justify them is treated as unset.
 */
export const isUnsetPbr = (m) =>
  m.isMeshStandardMaterial && m.metalness === 1 && m.roughness === 1 && !m.metalnessMap && !m.roughnessMap;

/** A copy of a model's material, corrected for its kind. Paint is handled separately. */
export function upgradeSurface(source) {
  if (!source?.isMeshStandardMaterial) return source;
  const kind = kindOf(source.name);
  if (kind === "glass") return factoryGlass(source);
  if (kind === "lens") return lensMaterial(source);
  if (kind === "tyre") return factoryTyre(source);

  let m = source;
  const words = nameWords(source.name);
  const fix = (next) => {
    if (m === source) m = source.clone();
    next(m);
  };
  if (isUnsetPbr(source)) fix((c) => ((c.metalness = METAL_WORDS.test(words) ? 1 : 0), (c.roughness = METAL_WORDS.test(words) ? 0.3 : 0.5)));
  if (kind === "chrome") fix((c) => ((c.metalness = 1), (c.roughness = Math.min(c.roughness, 0.06)), c.color.lerp(new THREE.Color("#f1f3f5"), 0.6)));
  if (kind === "plastic") fix((c) => ((c.metalness = Math.min(c.metalness, 0.1)), (c.roughness = Math.max(c.roughness, 0.55))));
  if (kind === "carbon") {
    const p = toPhysical(source);
    p.metalness = Math.min(p.metalness, 0.2);
    p.roughness = THREE.MathUtils.clamp(p.roughness, 0.3, 0.45);
    p.clearcoat = 0.6;
    p.clearcoatRoughness = 0.08;
    m = p;
  }
  // Semi-transparent opaque parts (a common export slip) sort badly; only real see-through kinds stay transparent.
  if (source.transparent && source.opacity > 0.97 && !source.alphaMap && !source.map) fix((c) => ((c.transparent = false), (c.opacity = 1)));
  if (m !== source) m.userData.generated = true;
  return m;
}
