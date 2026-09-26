// The five studios. Each is a small scene of light panels in a room (or a sky
// with a sun), rendered once into a prefiltered environment map that gives
// paint, glass and chrome their reflections. Built on first use and kept.
//
// The visible backdrop and floor are separate and simpler (see stage.js), as
// in a real photo studio: what the car reflects is not the grey sweep behind it.
import * as THREE from "three";

const box = new THREE.BoxGeometry(1, 1, 1);
const plane = new THREE.PlaneGeometry(1, 1);

/** A panel that emits light: colour times intensity, unlit, seen from both sides. */
function panel(scene, { at, size, look = [0, 0, 0], intensity, color = "#ffffff", shape = "plane" }) {
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(shape === "box" ? box : plane, m);
  mesh.position.set(...at);
  mesh.scale.set(size[0], size[1], size[2] ?? 1);
  mesh.lookAt(...look);
  scene.add(mesh);
  return mesh;
}

/** A room: walls, ceiling and floor of one brightness, the floor slightly different. */
function room(scene, { walls, floor, width = 24, depth = 24, height = 9 }) {
  const shell = new THREE.Mesh(
    box,
    new THREE.MeshBasicMaterial({ color: new THREE.Color(walls[0]).multiplyScalar(walls[1]), side: THREE.BackSide }),
  );
  shell.scale.set(width, height, depth);
  shell.position.y = height / 2 - 1; // the capture point is 1 m above the floor
  scene.add(shell);
  const f = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ color: new THREE.Color(floor[0]).multiplyScalar(floor[1]) }));
  f.rotation.x = -Math.PI / 2;
  f.position.y = -0.99;
  f.scale.set(width, depth, 1);
  scene.add(f);
}

/** A sky dome shaded from horizon to zenith, with a sun. */
function sky(scene, { zenith, horizon, ground, sun }) {
  const geo = new THREE.SphereGeometry(40, 64, 32);
  const colors = [];
  const top = new THREE.Color(zenith[0]).multiplyScalar(zenith[1]);
  const mid = new THREE.Color(horizon[0]).multiplyScalar(horizon[1]);
  const low = new THREE.Color(ground[0]).multiplyScalar(ground[1]);
  const p = geo.attributes.position;
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / 40;
    if (y >= 0) c.copy(mid).lerp(top, Math.pow(y, 0.55));
    else c.copy(mid).lerp(low, Math.min(1, -y * 6));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const dir = new THREE.Vector3().setFromSphericalCoords(30, Math.PI / 2 - sun.elevation, sun.azimuth);
  const s = new THREE.Mesh(new THREE.SphereGeometry(sun.size, 24, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(sun.color).multiplyScalar(sun.intensity) }));
  s.position.copy(dir);
  scene.add(s);
}

/**
 * Everything that makes a studio: its reflections, the lights that shape
 * the car, the backdrop and floor, and exposure. Light directions are given
 * as [azimuth, elevation] in degrees around the car, nose at azimuth 0.
 */
export const STUDIOS = {
  studio: {
    build(scene) {
      room(scene, { walls: ["#ffffff", 0.32], floor: ["#ffffff", 0.22] });
      panel(scene, { at: [0, 7.9, 0], size: [9, 4.2], look: [0, 0, 0], intensity: 7 });
      panel(scene, { at: [-8, 3.2, 0], size: [1.6, 5.2], look: [0, 1, 0], intensity: 5.5 });
      panel(scene, { at: [8, 3.2, 0], size: [1.6, 5.2], look: [0, 1, 0], intensity: 5.5 });
      panel(scene, { at: [0, 2.4, 10], size: [8, 1.4], look: [0, 1, 0], intensity: 2.2 });
      panel(scene, { at: [0, 2.4, -10], size: [8, 1.4], look: [0, 1, 0], intensity: 2.2 });
    },
    environmentIntensity: 1,
    exposure: 1.0,
    lights: { key: [[35, 55], 2.2, "#ffffff"], fill: [[-110, 30], 0.6, "#f1f3f6"], rim: [[180, 35], 1.4, "#ffffff"] },
    backdrop: { top: "#a9acb0", horizon: "#d4d5d6" },
    floor: { color: "#c9cacc", horizon: "#d4d5d6", reflect: 0.16, shadow: 0.78, tone: "light" },
  },
  dark: {
    build(scene) {
      room(scene, { walls: ["#ffffff", 0.012], floor: ["#ffffff", 0.02] });
      for (const x of [-2.2, 0, 2.2]) panel(scene, { at: [x, 7.5, 0], size: [0.35, 11], look: [x, 0, 0], intensity: 11 });
      panel(scene, { at: [-7.5, 2.4, 0], size: [0.5, 9], look: [0, 2.4, 0], intensity: 4 });
      panel(scene, { at: [7.5, 2.4, 0], size: [0.5, 9], look: [0, 2.4, 0], intensity: 4 });
      panel(scene, { at: [0, 3, -9], size: [6, 0.6], look: [0, 1, 0], intensity: 5 });
    },
    environmentIntensity: 1.1,
    exposure: 1.05,
    lights: { key: [[30, 60], 1.6, "#ffffff"], fill: [[-120, 20], 0.12, "#dfe6ff"], rim: [[175, 25], 2.2, "#ffffff"] },
    backdrop: { top: "#050506", horizon: "#121315" },
    floor: { color: "#161719", horizon: "#121315", reflect: 0.42, shadow: 0.9, tone: "dark" },
  },
  showroom: {
    build(scene) {
      room(scene, { walls: ["#f3ece2", 0.3], floor: ["#e8e2da", 0.35], width: 30, depth: 30, height: 7 });
      for (const x of [-6, -2, 2, 6]) for (const z of [-6, -2, 2, 6]) panel(scene, { at: [x, 5.9, z], size: [2.6, 2.6], look: [x, 0, z], intensity: 4.5, color: "#fff6ea" });
      panel(scene, { at: [14.9, 2.2, 0], size: [26, 4.2], look: [0, 2.2, 0], intensity: 3.2, color: "#eef4ff" });
    },
    environmentIntensity: 1,
    exposure: 1.0,
    lights: { key: [[45, 70], 1.8, "#fff4e8"], fill: [[-90, 20], 0.5, "#eef3ff"], rim: [[170, 40], 0.9, "#ffffff"] },
    backdrop: { top: "#8f8a83", horizon: "#b8b3ab" },
    floor: { color: "#a6a19a", horizon: "#b8b3ab", reflect: 0.38, shadow: 0.72, tone: "light" },
  },
  sunset: {
    build(scene) {
      sky(scene, {
        zenith: ["#2d4a7a", 0.9],
        horizon: ["#ff9a52", 2.4],
        ground: ["#2a211c", 0.25],
        sun: { azimuth: THREE.MathUtils.degToRad(-60), elevation: THREE.MathUtils.degToRad(5), size: 1.3, color: "#ffb36b", intensity: 120 },
      });
    },
    environmentIntensity: 0.9,
    exposure: 1.02,
    lights: { key: [[-60, 7], 2.6, "#ffb071"], fill: [[120, 45], 0.45, "#8fa8d8"], rim: [[180, 25], 0.5, "#ffd2a8"] },
    backdrop: { top: "#34466b", horizon: "#e0935a" },
    floor: { color: "#3b332d", horizon: "#b97b4f", reflect: 0.22, shadow: 0.82, tone: "dark" },
  },
  softbox: {
    build(scene) {
      room(scene, { walls: ["#ffffff", 0.55], floor: ["#ffffff", 0.45] });
      panel(scene, { at: [0, 7.8, 0], size: [16, 14], look: [0, 0, 0], intensity: 3.4 });
      panel(scene, { at: [-9, 3, 0], size: [8, 5], look: [0, 1.5, 0], intensity: 1.8 });
      panel(scene, { at: [9, 3, 0], size: [8, 5], look: [0, 1.5, 0], intensity: 1.8 });
    },
    environmentIntensity: 1,
    exposure: 0.96,
    lights: { key: [[20, 75], 1.2, "#ffffff"], fill: [[-100, 40], 0.7, "#ffffff"], rim: [[180, 40], 0.6, "#ffffff"] },
    backdrop: { top: "#dcdddd", horizon: "#eeeeed" },
    floor: { color: "#e3e3e2", horizon: "#eeeeed", reflect: 0.08, shadow: 0.85, tone: "light" },
  },
};

/** Builds environment maps on demand and keeps them. */
export class EnvironmentLibrary {
  constructor(renderer) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.maps = new Map();
    this.backdrops = new Map();
  }

  map(id) {
    let t = this.maps.get(id);
    if (t) return t;
    const scene = new THREE.Scene();
    STUDIOS[id].build(scene);
    t = this.pmrem.fromScene(scene, 0.035, 0.1, 100).texture;
    scene.traverse((o) => {
      if (o.isMesh) o.material.dispose();
      if (o.isMesh && o.geometry !== box && o.geometry !== plane) o.geometry.dispose();
    });
    this.maps.set(id, t);
    return t;
  }

  /** A vertical gradient the camera sees behind the car, drawn at infinity. */
  backdrop(id) {
    let t = this.backdrops.get(id);
    if (t) return t;
    const { top, horizon } = STUDIOS[id].backdrop;
    const h = 256;
    const data = new Uint16Array(4 * h);
    const a = new THREE.Color(horizon), b = new THREE.Color(top), c = new THREE.Color();
    for (let y = 0; y < h; y++) {
      // Row 0 is the bottom of the sky (straight down), row h-1 the top.
      const v = y / (h - 1) * 2 - 1;
      c.copy(a).lerp(b, THREE.MathUtils.smoothstep(v, 0, 0.75));
      data.set([c.r, c.g, c.b, 1].map(THREE.DataUtils.toHalfFloat), y * 4);
    }
    t = new THREE.DataTexture(data, 1, h, THREE.RGBAFormat, THREE.HalfFloatType);
    t.mapping = THREE.EquirectangularReflectionMapping;
    t.magFilter = t.minFilter = THREE.LinearFilter;
    t.colorSpace = THREE.LinearSRGBColorSpace;
    t.needsUpdate = true;
    this.backdrops.set(id, t);
    return t;
  }

  dispose() {
    for (const t of this.maps.values()) t.dispose();
    for (const t of this.backdrops.values()) t.dispose();
    this.pmrem.dispose();
  }
}
