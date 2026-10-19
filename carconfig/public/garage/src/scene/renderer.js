// The renderer and its image pipeline, sized to the device.
//
//   high    2x pixels, 4x MSAA, ambient occlusion when the camera rests, bloom
//   medium  1.5x pixels, 4x MSAA, lighter floor reflection, bloom
//   low     1x pixels, no post-processing, no floor reflection
//
// Frames are drawn only when something changes. While the camera moves the
// cheaper image is drawn; a moment after it stops, one refined frame adds
// ambient occlusion.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

export const TIERS = {
  high: { pixelRatio: 2, msaa: 4, ao: true, bloom: true, reflection: 0.5, composer: true },
  medium: { pixelRatio: 1.5, msaa: 4, ao: false, bloom: true, reflection: 0.33, composer: true },
  low: { pixelRatio: 1, msaa: 0, ao: false, bloom: false, reflection: 0, composer: false },
};

export function detectTier(renderer) {
  const forced = new URLSearchParams(location.search).get("quality");
  if (forced && TIERS[forced]) return forced;
  const gl = renderer.getContext();
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const gpu = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
  if (/swiftshader|llvmpipe|software|basic render/i.test(gpu)) return "low";
  const coarse = matchMedia("(pointer: coarse)").matches;
  const small = Math.min(screen.width, screen.height) < 820;
  if (coarse && small) return "medium";
  if (navigator.deviceMemory && navigator.deviceMemory <= 4) return "medium";
  return "high";
}

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: false });
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = false;
  return renderer;
}

export class Pipeline {
  constructor(renderer, scene, camera, tierName) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.width = 1;
    this.height = 1;
    this.bloomWanted = false;
    this.setTier(tierName);
  }

  setTier(name) {
    this.tierName = name;
    this.tier = TIERS[name];
    this.composer?.dispose?.();
    this.composer = null;
    if (!this.tier.composer) return this.resize(this.width, this.height);

    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: this.tier.msaa });
    const composer = new EffectComposer(this.renderer, target);
    composer.addPass(new RenderPass(this.scene, this.camera));
    if (this.tier.ao) {
      this.ao = new GTAOPass(this.scene, this.camera, 1, 1);
      this.ao.output = GTAOPass.OUTPUT.Default;
      this.ao.blendIntensity = 0.85;
      this.ao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.4, thickness: 1.2, scale: 1, samples: 16 });
      this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
      this.ao.enabled = false;
      composer.addPass(this.ao);
    } else this.ao = null;
    if (this.tier.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.45, 1.6);
      this.bloom.enabled = this.bloomWanted;
      composer.addPass(this.bloom);
    } else this.bloom = null;
    composer.addPass(new OutputPass());
    this.composer = composer;
    this.resize(this.width, this.height);
  }

  get pixelRatio() {
    return Math.min(window.devicePixelRatio || 1, this.tier.pixelRatio);
  }

  resize(width, height) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(this.width, this.height, false);
    if (this.composer) {
      this.composer.setPixelRatio(this.pixelRatio);
      this.composer.setSize(this.width, this.height);
    }
  }

  /** Bloom is for lit lamps; with the lights off it only costs time. */
  setBloom(on) {
    this.bloomWanted = on;
    if (this.bloom) this.bloom.enabled = on;
  }

  /** Draws a frame. `refined` adds the expensive passes kept for a still camera. */
  render(refined) {
    if (!this.composer) {
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.scene, this.camera);
      return;
    }
    if (this.ao) this.ao.enabled = refined;
    this.composer.render();
  }

  /** The drawing size in device pixels, for render targets that follow it. */
  get drawingSize() {
    return { width: this.width * this.pixelRatio, height: this.height * this.pixelRatio };
  }
}
