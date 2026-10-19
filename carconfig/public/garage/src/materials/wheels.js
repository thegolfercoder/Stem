// Rim, brake caliper and tyre finishes.
import * as THREE from "three";
import { toPhysical } from "./paint.js";

const cache = new Map();

function keepDetail(m, source) {
  // Flat colour replaces the rim's own colour, but its shape detail stays.
  if (source) {
    m.normalMap = source.normalMap ?? null;
    if (source.normalScale) m.normalScale.copy(source.normalScale);
    m.aoMap = source.aoMap ?? null;
    m.aoMapIntensity = source.aoMapIntensity ?? 1;
  }
  return m;
}

const RIM = {
  silver: { metalness: 1, roughness: 0.26 },
  gunmetal: { metalness: 1, roughness: 0.34 },
  black: { metalness: 0.15, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.04 },
  "satin-black": { metalness: 0.25, roughness: 0.55, clearcoat: 0.2, clearcoatRoughness: 0.5 },
  chrome: { metalness: 1, roughness: 0.035 },
};

export function rimMaterial(option, source) {
  const key = `rim|${option.id}|${source?.uuid ?? ""}`;
  let m = cache.get(key);
  if (m) return m;
  m = keepDetail(new THREE.MeshPhysicalMaterial({ name: `rim ${option.id}`, color: new THREE.Color(option.hex), ...RIM[option.id] }), source);
  m.userData.generated = true;
  cache.set(key, m);
  return m;
}

export function caliperMaterial(option, source) {
  const key = `caliper|${option.id}|${source?.uuid ?? ""}`;
  let m = cache.get(key);
  if (m) return m;
  m = keepDetail(
    new THREE.MeshPhysicalMaterial({
      name: `caliper ${option.id}`,
      color: new THREE.Color(option.hex),
      metalness: 0.05,
      roughness: 0.32,
      clearcoat: 0.8,
      clearcoatRoughness: 0.08,
    }),
    source,
  );
  m.userData.generated = true;
  cache.set(key, m);
  return m;
}

/** Tyres: dark rubber that still shows its shape, never a flat black hole. */
export function factoryTyre(source) {
  const m = source.clone();
  m.metalness = 0;
  m.roughness = Math.max(0.82, m.roughness === 1 ? 0.88 : m.roughness);
  // About #1d1d1e: rubber is dark grey, not black.
  if (m.map) m.color.setScalar(0.82);
  else m.color.setRGB(0.012, 0.012, 0.013);
  m.userData.generated = true;
  return m;
}

/** Plain surfaces in a named finish (trim, mirror caps, spoilers, exhaust tips). */
export function finishMaterial(kind, option, source) {
  const key = `${kind}|${option.id}|${source?.uuid ?? ""}`;
  let m = cache.get(key);
  if (m) return m;
  const presets = {
    "gloss-black": { metalness: 0.1, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.03 },
    "satin-black": { metalness: 0.2, roughness: 0.55 },
    chrome: { metalness: 1, roughness: 0.04 },
    black: { metalness: 0.6, roughness: 0.45 },
    titanium: { metalness: 1, roughness: 0.3, iridescence: 0.55, iridescenceIOR: 1.8, iridescenceThicknessRange: [300, 600] },
    polished: { metalness: 1, roughness: 0.06 },
  };
  m = keepDetail(new THREE.MeshPhysicalMaterial({ name: `${kind} ${option.id}`, color: new THREE.Color(option.hex), ...presets[option.id] }), source);
  m.userData.generated = true;
  cache.set(key, m);
  return m;
}

/** Carbon fibre in a chosen finish, keeping the model's weave texture and UVs. */
export function carbonMaterial(finish, source) {
  const key = `carbon|${finish}|${source.uuid}`;
  let m = cache.get(key);
  if (m) return m;
  m = toPhysical(source);
  m.metalness = Math.min(m.metalness, 0.2);
  if (finish === "matte") {
    m.roughness = 0.55;
    m.clearcoat = 0;
  } else {
    m.roughness = Math.min(Math.max(m.roughness, 0.3), 0.45);
    m.clearcoat = finish === "gloss" ? 1 : 0.6;
    m.clearcoatRoughness = finish === "gloss" ? 0.03 : 0.08;
  }
  if (!m.map) m.color.multiplyScalar(0.6);
  m.userData.generated = true;
  cache.set(key, m);
  return m;
}

/** Forget materials made for a model that has been unloaded. */
export function forgetMaterialsOf(sources) {
  for (const [key, m] of cache) {
    if ([...sources].some((s) => key.endsWith(`|${s.uuid}`))) {
      m.dispose();
      cache.delete(key);
    }
  }
}
