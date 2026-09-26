// The camera: views fitted to the car's bounding box so the car is never
// clipped or tiny at any window shape, smooth moves between them, orbit, zoom
// and pan within limits that keep the camera outside the car and above the
// floor, and an optional turntable.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const deg = THREE.MathUtils.degToRad;
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const MIN_CAMERA_HEIGHT = 0.12;

export class CameraRig {
  constructor(camera, dom) {
    this.camera = camera;
    this.controls = new OrbitControls(camera, dom);
    Object.assign(this.controls, {
      enableDamping: true,
      dampingFactor: 0.085,
      rotateSpeed: 0.55,
      zoomSpeed: 0.7,
      panSpeed: 0.6,
      screenSpacePanning: true,
      autoRotateSpeed: 1.2,
      zoomToCursor: false,
    });
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.box = new THREE.Box3(new THREE.Vector3(-1, 0, -2.3), new THREE.Vector3(1, 1.3, 2.3));
    this.flight = null;
    this.view = null; // the preset the camera is at, until the visitor moves it
    this.controls.addEventListener("start", () => {
      this.flight = null;
      this.view = null;
    });
    this.controls.addEventListener("change", () => this.clamp());
  }

  get turntable() {
    return this.controls.autoRotate;
  }
  set turntable(on) {
    this.controls.autoRotate = on;
  }

  /** Where the camera looks: the middle of the car, a little low so the car sits above the view buttons. */
  targetFor(box) {
    const c = box.getCenter(new THREE.Vector3());
    const h = box.max.y - box.min.y;
    return c.setY(box.min.y + h * 0.42);
  }

  /**
   * Distance at which every corner of the box fits the frame with a margin,
   * looking from `dir` (unit vector from target to camera). Solved exactly
   * per corner, so it holds for any aspect ratio and any view.
   */
  fitDistance(box, target, dir, margin = 0.8) {
    const cam = this.camera;
    const tanV = Math.tan(deg(cam.fov) / 2) * margin;
    const tanH = tanV * cam.aspect;
    // The same screen axes the camera will have when it looks from there.
    const basis = new THREE.Matrix4().lookAt(dir, new THREE.Vector3(), cam.up);
    const right = new THREE.Vector3().setFromMatrixColumn(basis, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(basis, 1);
    let dist = 0;
    const q = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      q.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(target);
      const along = q.dot(dir);
      dist = Math.max(dist, along + Math.abs(q.dot(right)) / tanH, along + Math.abs(q.dot(up)) / tanV);
    }
    return dist;
  }

  /** Framing and limits for a newly loaded car. */
  frame(box) {
    this.box = box.clone();
    const size = box.getSize(new THREE.Vector3());
    const radius = size.length() / 2;
    this.radius = radius;
    this.camera.near = Math.max(0.02, radius * 0.01);
    this.camera.far = radius * 60;
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = Math.max(size.x, size.z) * 0.55;
    this.controls.maxDistance = radius * 6;
    this.controls.minPolarAngle = deg(2);
  }

  poseFor(view) {
    const target = this.targetFor(this.box);
    let azimuth = view.azimuth;
    // A top view of a car is best along the screen's longer side.
    if (view.id === "top" && this.camera.aspect < 1) azimuth = 0;
    const dir = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - deg(view.elevation), deg(azimuth));
    const distance = this.fitDistance(this.box, target, dir);
    return { target, position: target.clone().addScaledVector(dir, distance) };
  }

  /** Moves to a preset view, smoothly unless `instant`. */
  goTo(view, { instant = false, duration = 1.1, from = null } = {}) {
    const pose = this.poseFor(view);
    this.view = view.id;
    if (instant) {
      this.flight = null;
      this.camera.position.copy(pose.position);
      this.controls.target.copy(pose.target);
      this.controls.update();
      return;
    }
    const start = from ?? { position: this.camera.position.clone(), target: this.controls.target.clone() };
    const s0 = new THREE.Spherical().setFromVector3(start.position.clone().sub(start.target));
    const s1 = new THREE.Spherical().setFromVector3(pose.position.clone().sub(pose.target));
    // Take the short way round.
    let dTheta = s1.theta - s0.theta;
    dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta));
    this.flight = { t: 0, duration, s0, dTheta, s1, t0: start.target, t1: pose.target };
  }

  /** Re-frames the current preset after the view changes shape, mid-move or not. */
  refit(view) {
    if (!this.view || !view) return;
    if (!this.flight) return this.goTo(view, { instant: true });
    const pose = this.poseFor(view);
    const f = this.flight;
    f.s1 = new THREE.Spherical().setFromVector3(pose.position.clone().sub(pose.target));
    f.t1 = pose.target;
    const d = f.s1.theta - f.s0.theta;
    f.dTheta = Math.atan2(Math.sin(d), Math.cos(d));
  }

  /** An entrance for a newly loaded car: a slow push in from further round. */
  intro(view) {
    const pose = this.poseFor(view);
    const s = new THREE.Spherical().setFromVector3(pose.position.clone().sub(pose.target));
    s.radius *= 1.35;
    s.theta += deg(-28);
    s.phi = Math.max(deg(55), s.phi - deg(6));
    const position = new THREE.Vector3().setFromSpherical(s).add(pose.target);
    this.goTo(view, { from: { position, target: pose.target }, duration: 1.6 });
  }

  /** Keeps the target inside the car and the camera above the floor. */
  clamp() {
    const b = this.box;
    const size = b.getSize(new THREE.Vector3());
    const c = b.getCenter(new THREE.Vector3());
    const t = this.controls.target;
    t.x = THREE.MathUtils.clamp(t.x, c.x - size.x * 0.4, c.x + size.x * 0.4);
    t.y = THREE.MathUtils.clamp(t.y, b.min.y + size.y * 0.15, b.min.y + size.y * 0.9);
    t.z = THREE.MathUtils.clamp(t.z, c.z - size.z * 0.4, c.z + size.z * 0.4);
    const r = this.camera.position.distanceTo(t) || 1;
    const cos = THREE.MathUtils.clamp((MIN_CAMERA_HEIGHT - t.y) / r, -1, 1);
    this.controls.maxPolarAngle = Math.acos(cos);
  }

  /** Advances moves; returns true while the camera is changing. */
  update(dt) {
    if (this.flight) {
      const f = this.flight;
      f.t = Math.min(1, f.t + dt / f.duration);
      const k = easeInOutCubic(f.t);
      const s = new THREE.Spherical(
        Math.exp(THREE.MathUtils.lerp(Math.log(f.s0.radius), Math.log(f.s1.radius), k)),
        THREE.MathUtils.lerp(f.s0.phi, f.s1.phi, k),
        f.s0.theta + f.dTheta * k,
      );
      const target = f.t0.clone().lerp(f.t1, k);
      this.controls.target.copy(target);
      this.camera.position.setFromSpherical(s).add(target);
      this.camera.lookAt(target);
      if (f.t >= 1) this.flight = null;
      this.controls.update();
      return true;
    }
    return this.controls.update(dt);
  }

  dispose() {
    this.controls.dispose();
  }
}
