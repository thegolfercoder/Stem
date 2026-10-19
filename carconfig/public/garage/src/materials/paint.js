// Car paint: a base coat under a clear coat, with metallic flake for the
// finishes that have it. Flakes live in world space, so they stay put as the
// camera moves and fade out where they would be smaller than a pixel.
import * as THREE from "three";

const cache = new Map();

/** Base-coat and clear-coat values for each finish, close to measured automotive paint. */
const FINISH = {
  solid: { metalness: 0.0, roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.035, flake: 0 },
  metallic: { metalness: 0.62, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.025, flake: 0.28 },
  pearl: { metalness: 0.32, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.025, flake: 0.18, iridescence: 0.4 },
  satin: { metalness: 0.35, roughness: 0.48, clearcoat: 0.35, clearcoatRoughness: 0.42, flake: 0.1 },
  matte: { metalness: 0.08, roughness: 0.72, clearcoat: 0, clearcoatRoughness: 1, flake: 0 },
  chrome: { metalness: 1.0, roughness: 0.055, clearcoat: 0.4, clearcoatRoughness: 0.02, flake: 0 },
};

export const finishOf = (id) => FINISH[id] ?? FINISH.solid;

/**
 * Metallic flake: nudges the base-coat normal by a random amount per ~1.6 mm
 * cell of world space. The clear coat keeps the smooth geometric normal, so
 * reflections stay sharp while the colour sparkles underneath.
 */
export function addFlake(material, strength, cellsPerMetre = 620) {
  material.userData.flake = { strength, cellsPerMetre };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFlakeStrength = { value: strength };
    shader.uniforms.uFlakeDensity = { value: cellsPerMetre };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vFlakePos;")
      .replace("#include <fog_vertex>", "#include <fog_vertex>\nvFlakePos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vFlakePos;\nuniform float uFlakeStrength;\nuniform float uFlakeDensity;")
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        {
          vec3 p = vFlakePos * uFlakeDensity;
          vec3 cell = floor(p);
          vec3 h = fract(sin(vec3(dot(cell, vec3(127.1, 311.7, 74.7)), dot(cell, vec3(269.5, 183.3, 246.1)), dot(cell, vec3(113.5, 271.9, 124.6)))) * 43758.5453) * 2.0 - 1.0;
          float perPixel = length(fwidth(p));
          float keep = 1.0 - smoothstep(0.45, 1.4, perPixel);
          normal = normalize(normal + (viewMatrix * vec4(h, 0.0)).xyz * uFlakeStrength * keep);
        }`,
      );
  };
  material.customProgramCacheKey = () => `flake-${strength}-${cellsPerMetre}`;
  material.needsUpdate = true;
  return material;
}

/** A new paint for a colour and finish. Cached, so switching back and forth costs nothing. */
export function paintMaterial(hex, finishId) {
  const key = `${hex.toLowerCase()}|${finishId}`;
  let m = cache.get(key);
  if (m) return m;
  const f = finishOf(finishId);
  const color = new THREE.Color(hex);
  if (finishId === "chrome") color.lerp(new THREE.Color("#ffffff"), 0.35);
  m = new THREE.MeshPhysicalMaterial({
    name: `paint ${key}`,
    color,
    metalness: f.metalness,
    roughness: f.roughness,
    clearcoat: f.clearcoat,
    clearcoatRoughness: f.clearcoatRoughness,
  });
  if (f.iridescence) {
    m.iridescence = f.iridescence;
    m.iridescenceIOR = 1.45;
    m.iridescenceThicknessRange = [260, 480];
  }
  if (f.flake) addFlake(m, f.flake);
  m.userData.generated = true;
  m.userData.shared = true;
  cache.set(key, m);
  return m;
}

/**
 * Copies a standard material into a physical one, keeping every texture and
 * value, so a model's own paint can take a clear coat.
 */
export function toPhysical(source) {
  if (source.isMeshPhysicalMaterial) return source.clone();
  const m = new THREE.MeshPhysicalMaterial();
  THREE.MeshStandardMaterial.prototype.copy.call(m, source);
  m.defines = { STANDARD: "", PHYSICAL: "" };
  m.name = source.name;
  return m;
}

/**
 * The model's own paint, finished properly: a clear coat over whatever colour
 * and textures it came with. Glossy paint gets a full clear coat; paint the
 * modeller made rough (satin or matte wraps) keeps its look.
 */
export function factoryPaint(source) {
  const m = toPhysical(source);
  const untouched = m.metalness === 1 && m.roughness === 1 && !m.metalnessMap && !m.roughnessMap;
  if (untouched) {
    m.metalness = 0.35;
    m.roughness = 0.38;
  }
  if (m.roughness < 0.6 || m.roughnessMap) {
    m.clearcoat = 1;
    m.clearcoatRoughness = 0.03;
  } else {
    m.clearcoat = 0.15;
    m.clearcoatRoughness = 0.5;
  }
  m.transparent = false;
  m.opacity = 1;
  m.userData.generated = true;
  return m;
}

export function disposePaintCache() {
  for (const m of cache.values()) m.dispose();
  cache.clear();
}
