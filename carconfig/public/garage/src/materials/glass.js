// Glass that stays reflective however dark or clear it is.
//
// Ordinary transparency fades a surface's reflections along with its colour,
// which is why model glass tends to look either invisible or like tinted
// plastic. Here only the tint is faded: reflections (and a lamp's glow) are
// added at full strength on top, the way a window works.
import * as THREE from "three";
import { toPhysical } from "./paint.js";

export function keepReflections(material) {
  material.transparent = true;
  material.depthWrite = false;
  material.premultipliedAlpha = false;
  material.blending = THREE.CustomBlending;
  material.blendSrc = THREE.OneFactor;
  material.blendDst = THREE.OneMinusSrcAlphaFactor;
  material.blendSrcAlpha = THREE.OneFactor;
  material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      "gl_FragColor = vec4(totalDiffuse * diffuseColor.a + (outgoingLight - totalDiffuse), diffuseColor.a);",
    );
  };
  material.customProgramCacheKey = () => "keep-reflections";
  material.needsUpdate = true;
  return material;
}

const glassCache = new Map();

/** Window glass for one of the tints in config.js. */
export function glassMaterial(tint) {
  let m = glassCache.get(tint.id);
  if (m) return m;
  m = new THREE.MeshPhysicalMaterial({
    name: `glass ${tint.id}`,
    color: new THREE.Color(tint.hex),
    metalness: 0,
    roughness: 0.02,
    ior: 1.52,
    opacity: tint.opacity,
    envMapIntensity: 1.35,
    side: THREE.DoubleSide,
  });
  keepReflections(m);
  m.userData.generated = true;
  m.userData.shared = true;
  glassCache.set(tint.id, m);
  return m;
}

/**
 * The model's own glass, made believable: never fully see-through, never
 * opaque plastic, never strongly coloured. Its darkness is kept, within limits.
 */
export function factoryGlass(source) {
  const m = toPhysical(source);
  const was = source.transparent ? source.opacity : 1;
  m.map = null;
  m.metalness = 0;
  m.roughness = Math.min(m.roughness, 0.04);
  m.ior = 1.52;
  m.envMapIntensity = 1.35;
  const hsl = m.color.getHSL({});
  const darkness = was >= 0.95 ? 0.82 : THREE.MathUtils.clamp(was, 0.28, 0.85);
  m.color.setHSL(hsl.h, Math.min(hsl.s, 0.18), THREE.MathUtils.clamp(hsl.l, 0.04, 0.16));
  m.opacity = darkness;
  m.side = THREE.DoubleSide;
  keepReflections(m);
  m.userData.generated = true;
  return m;
}

/** Headlamp and tail-lamp covers: clear, glossy, and able to glow. */
export function lensMaterial(source) {
  const m = toPhysical(source);
  m.metalness = 0;
  m.roughness = Math.min(m.roughness, 0.05);
  m.ior = 1.5;
  m.opacity = THREE.MathUtils.clamp(source.transparent ? source.opacity : 0.35, 0.12, 0.5);
  keepReflections(m);
  m.userData.generated = true;
  return m;
}
