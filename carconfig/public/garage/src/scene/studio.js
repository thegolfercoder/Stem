// The studio: one scene, one camera, the car on its stage, and a render loop
// that only runs while something is changing.
import * as THREE from "three";
import { createRenderer, detectTier, Pipeline, TIERS } from "./renderer.js";
import { EnvironmentLibrary, STUDIOS } from "./environment.js";
import { StudioLights } from "./lighting.js";
import { Stage } from "./stage.js";
import { CameraRig } from "./camera.js";
import { CAR_LAYER } from "../cars/vehicle.js";

const REFINE_AFTER_MS = 220;

export class Studio {
  constructor(canvas, container) {
    this.canvas = canvas;
    this.container = container;
    this.renderer = createRenderer(canvas);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 200);
    this.camera.position.set(4, 1.6, 6);
    this.camera.layers.enable(CAR_LAYER);

    this.tierName = detectTier(this.renderer);
    this.pipeline = new Pipeline(this.renderer, this.scene, this.camera, this.tierName);
    this.environments = new EnvironmentLibrary(this.renderer);
    this.lights = new StudioLights(this.scene);
    this.lights.group.traverse((o) => o.layers.enable(CAR_LAYER));
    this.stage = new Stage(this.scene, { reflectionScale: TIERS[this.tierName].reflection });
    this.rig = new CameraRig(this.camera, canvas);
    this.rig.controls.addEventListener("change", () => this.invalidate());
    this.vehicle = null;
    this.environmentId = null;

    this.dirty = true;
    this.refined = false;
    this.running = false;
    this.last = performance.now();
    this.slowFrames = 0;
    this.refineTimer = 0;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.onContextLost = (e) => {
      e.preventDefault();
      console.warn("[carbon-garage] WebGL context lost; waiting for it to be restored");
    };
    canvas.addEventListener("webglcontextlost", this.onContextLost);
    canvas.addEventListener("webglcontextrestored", () => {
      this.stage.updateShadow(this.renderer);
      this.invalidate();
    });
    document.addEventListener("visibilitychange", () => !document.hidden && this.invalidate());
  }

  get anisotropy() {
    return Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    const aspectBefore = this.camera.aspect;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.pipeline.resize(w, h);
    // Still at a preset: keep the car framed for the new shape.
    if (this.vehicle && this.rig.view && Math.abs(aspectBefore - this.camera.aspect) > 0.01 && !this.rig.flight) this.rig.goTo(this.viewById(this.rig.view), { instant: true });
    this.invalidate();
  }

  setViews(views) {
    this.views = views;
  }
  viewById(id) {
    return this.views.find((v) => v.id === id) ?? this.views[0];
  }

  setEnvironment(id) {
    const studio = STUDIOS[id] ?? STUDIOS.studio;
    this.environmentId = STUDIOS[id] ? id : "studio";
    this.scene.environment = this.environments.map(this.environmentId);
    this.scene.environmentIntensity = studio.environmentIntensity;
    this.scene.background = this.environments.backdrop(this.environmentId);
    this.renderer.toneMappingExposure = studio.exposure;
    this.lights.apply(studio.lights, this.rig.radius ?? 3);
    this.stage.setLook(studio);
    this.container.dataset.tone = studio.floor.tone;
    this.invalidate();
  }

  /** Puts a car on the stage (or clears it with null) and frames it. */
  showVehicle(vehicle, { view = "hero", intro = true } = {}) {
    if (this.vehicle && this.vehicle !== vehicle) this.vehicle.object.removeFromParent();
    this.vehicle = vehicle;
    if (!vehicle) return this.invalidate();
    this.scene.add(vehicle.object);
    vehicle.object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(vehicle.object);
    this.rig.frame(box);
    this.stage.fit(box.getSize(new THREE.Vector3()));
    this.lights.apply(STUDIOS[this.environmentId ?? "studio"].lights, this.rig.radius);
    this.refreshShadow();
    const v = this.viewById(view);
    if (intro && !matchMedia("(prefers-reduced-motion: reduce)").matches) this.rig.intro(v);
    else this.rig.goTo(v, { instant: true });
    this.invalidate();
  }

  /** Call after anything that moves the car's body (ride height). */
  refreshShadow() {
    if (!this.vehicle) return;
    this.vehicle.object.updateMatrixWorld(true);
    this.stage.updateShadow(this.renderer);
    const beams = this.vehicle.build?.lights === "on" ? this.vehicle.frontLamps.map((p) => p.clone().setY(Math.max(0.35, p.y))) : [];
    this.stage.setBeams(beams, this.environmentId === "dark" || this.environmentId === "sunset" ? 1.4 : 0.6);
    this.pipeline.setBloom(Boolean(this.vehicle.build && this.vehicle.build.lights !== "off"));
    this.invalidate();
  }

  goTo(viewId, options) {
    this.rig.goTo(this.viewById(viewId), options);
    this.invalidate();
  }

  resetView() {
    this.goTo("hero");
  }

  setTurntable(on) {
    this.rig.turntable = on;
    this.invalidate();
  }

  /** Asks for a new frame. Frames are drawn only when asked for. */
  invalidate() {
    this.dirty = true;
    this.refined = false;
    clearTimeout(this.refineTimer);
    if (!this.running) {
      this.running = true;
      this.last = performance.now();
      requestAnimationFrame((t) => this.frame(t));
    }
  }

  frame(now) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const moving = this.rig.update(dt);
    if (moving) this.dirty = true;
    if (this.dirty && !document.hidden) {
      this.draw(false);
      this.dirty = false;
      this.watchSpeed(dt, moving);
    }
    if (moving || this.rig.flight || this.rig.turntable) {
      requestAnimationFrame((t) => this.frame(t));
      return;
    }
    this.running = false;
    // A moment after everything settles, draw one refined frame.
    if (!this.refined && this.pipeline.ao) this.refineTimer = setTimeout(() => this.refine(), REFINE_AFTER_MS);
  }

  draw(refined) {
    const { width, height } = this.pipeline.drawingSize;
    this.camera.updateMatrixWorld();
    this.stage.updateReflection(this.renderer, this.camera, width, height);
    this.pipeline.render(refined);
  }

  refine() {
    if (this.running || this.refined) return;
    this.draw(true);
    this.refined = true;
  }

  /** Drops to a lighter tier if moving the camera is visibly slow. */
  watchSpeed(dt, moving) {
    if (!moving) return;
    this.slowFrames = dt > 0.05 ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 1);
    if (this.slowFrames < 24) return;
    this.slowFrames = 0;
    const next = this.tierName === "high" ? "medium" : this.tierName === "medium" ? "low" : null;
    if (!next || new URLSearchParams(location.search).get("quality")) return;
    console.info(`[carbon-garage] rendering is slow; switching from ${this.tierName} to ${next} quality`);
    this.tierName = next;
    this.pipeline.setTier(next);
    this.stage.setReflectionScale(TIERS[next].reflection);
    this.pipeline.setBloom(Boolean(this.vehicle?.build && this.vehicle.build.lights !== "off"));
  }
}
