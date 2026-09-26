// The floor the car stands on: a soft contact shadow, a blurred reflection
// on glossy floors, headlamp beams when the lights are on, and a fade into
// the backdrop at the horizon so there is never a visible edge.
//
// The shadow is view-independent, so it is redrawn only when the car or its
// ride height changes. The reflection follows the camera and is redrawn with
// each frame, at reduced resolution.
import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { CAR_LAYER } from "../cars/vehicle.js";

const BLUR = {
  uniforms: { tDiffuse: { value: null }, step: { value: new THREE.Vector2() } },
  vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 step; varying vec2 vUv;
    void main() {
      vec4 s = texture2D(tDiffuse, vUv) * 0.1633;
      s += (texture2D(tDiffuse, vUv - step) + texture2D(tDiffuse, vUv + step)) * 0.1531;
      s += (texture2D(tDiffuse, vUv - 2.0 * step) + texture2D(tDiffuse, vUv + 2.0 * step)) * 0.12245;
      s += (texture2D(tDiffuse, vUv - 3.0 * step) + texture2D(tDiffuse, vUv + 3.0 * step)) * 0.0918;
      s += (texture2D(tDiffuse, vUv - 4.0 * step) + texture2D(tDiffuse, vUv + 4.0 * step)) * 0.051;
      gl_FragColor = s;
    }`,
};

const FLOOR = {
  vertexShader: `
    uniform mat4 uReflectMatrix;
    varying vec3 vWorld;
    varying vec4 vReflect;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      vReflect = uReflectMatrix * w;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: `
    uniform vec3 uColor; uniform vec3 uHorizon;
    uniform float uFadeStart; uniform float uFadeEnd;
    uniform sampler2D tContact; uniform sampler2D tAmbient; uniform vec2 uShadowSize; uniform float uShadow;
    uniform sampler2D tReflect; uniform float uReflect; uniform vec2 uCarHalf;
    uniform vec3 uBeamPos[2]; uniform vec3 uBeamDir; uniform float uBeam;
    varying vec3 vWorld;
    varying vec4 vReflect;

    float shadowAt(sampler2D t, vec2 uv) {
      if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
      return texture2D(t, uv).a;
    }

    void main() {
      float d = length(vWorld.xz);
      vec3 col = uColor * mix(1.06, 0.9, smoothstep(0.0, uFadeStart, d));

      vec2 suv = vWorld.xz / uShadowSize + 0.5;
      float contact = shadowAt(tContact, suv);
      float ambient = shadowAt(tAmbient, suv);
      float shade = 1.0 - (1.0 - contact * 0.9) * (1.0 - ambient);
      col *= 1.0 - clamp(shade, 0.0, 1.0) * uShadow;

      if (uReflect > 0.0) {
        vec3 r = texture2DProj(tReflect, vReflect).rgb;
        float mask = 1.0 - smoothstep(0.75, 1.55, length(vWorld.xz / uCarHalf));
        vec3 v = normalize(cameraPosition - vWorld);
        float fresnel = mix(0.45, 1.0, pow(1.0 - clamp(v.y, 0.0, 1.0), 2.0));
        col += r * uReflect * mask * fresnel;
      }

      if (uBeam > 0.0) {
        for (int i = 0; i < 2; i++) {
          vec3 l = vWorld - uBeamPos[i];
          float dist = length(l);
          float cone = smoothstep(0.82, 0.97, dot(l / dist, uBeamDir));
          col += vec3(1.0, 0.96, 0.9) * cone * uBeam / (1.0 + dist * dist * 0.18);
        }
      }

      col = mix(col, uHorizon, smoothstep(uFadeStart, uFadeEnd, d));
      // A touch of noise keeps the dark gradients from banding.
      col *= 1.0 + (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.02;
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

function shadowDepthMaterial() {
  const m = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );",
      "gl_FragColor = vec4( vec3( 0.0 ), 1.0 - fragCoordZ );",
    );
  };
  return m;
}

export class Stage {
  constructor(scene, { reflectionScale = 0.5 } = {}) {
    this.scene = scene;
    this.reflectionScale = reflectionScale;

    this.contact = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType });
    this.ambient = new THREE.WebGLRenderTarget(256, 256, { type: THREE.HalfFloatType });
    this.scratch = new Map();
    this.shadowCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.shadowCamera.rotation.x = Math.PI / 2; // looking straight up from the floor
    this.shadowCamera.layers.set(CAR_LAYER);
    this.depthMaterial = shadowDepthMaterial();
    this.blur = new FullScreenQuad(new THREE.ShaderMaterial({ ...BLUR, uniforms: THREE.UniformsUtils.clone(BLUR.uniforms), depthTest: false, depthWrite: false }));

    this.reflect = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
    this.reflectBlur = this.reflect.clone();
    this.virtualCamera = new THREE.PerspectiveCamera();
    this.virtualCamera.layers.set(CAR_LAYER);
    this.reflectMatrix = new THREE.Matrix4();

    this.uniforms = {
      uColor: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uFadeStart: { value: 6 },
      uFadeEnd: { value: 30 },
      tContact: { value: this.contact.texture },
      tAmbient: { value: this.ambient.texture },
      uShadowSize: { value: new THREE.Vector2(3, 6) },
      uShadow: { value: 0.8 },
      tReflect: { value: this.reflect.texture },
      uReflectMatrix: { value: this.reflectMatrix },
      uReflect: { value: 0 },
      uCarHalf: { value: new THREE.Vector2(1, 2.3) },
      uBeamPos: { value: [new THREE.Vector3(), new THREE.Vector3()] },
      uBeamDir: { value: new THREE.Vector3(0, -0.12, 1).normalize() },
      uBeam: { value: 0 },
    };
    this.floor = new THREE.Mesh(
      new THREE.CircleGeometry(1, 128),
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: FLOOR.vertexShader, fragmentShader: FLOOR.fragmentShader, depthWrite: true }),
    );
    this.floor.name = "floor";
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.renderOrder = -1;
    scene.add(this.floor);
    this.reflectionStrength = 0;
  }

  /** Floor colour, reflection and shadow strength for a studio. */
  setLook(studio) {
    this.uniforms.uColor.value.set(studio.floor.color);
    this.uniforms.uHorizon.value.set(studio.backdrop.horizon);
    this.uniforms.uShadow.value = studio.floor.shadow;
    this.reflectionStrength = studio.floor.reflect;
    this.uniforms.uReflect.value = this.reflectionScale > 0 ? this.reflectionStrength : 0;
  }

  setReflectionScale(scale) {
    this.reflectionScale = scale;
    this.uniforms.uReflect.value = scale > 0 ? this.reflectionStrength : 0;
  }

  /** Sizes the floor, shadow and reflection mask to a car. */
  fit(size) {
    const length = Math.max(size.z, 1);
    this.uniforms.uFadeStart.value = length * 1.25;
    this.uniforms.uFadeEnd.value = length * 7;
    this.floor.scale.setScalar(length * 7.5);
    this.uniforms.uShadowSize.value.set(size.x + 1.4, size.z + 1.4);
    this.uniforms.uCarHalf.value.set(size.x / 2, size.z / 2);
    this.carHeight = size.y;
  }

  setBeams(positions, strength) {
    this.uniforms.uBeam.value = positions.length ? strength : 0;
    positions.slice(0, 2).forEach((p, i) => this.uniforms.uBeamPos.value[i].copy(p));
    if (positions.length === 1) this.uniforms.uBeamPos.value[1].copy(positions[0]);
  }

  blurInto(renderer, source, target, dx, dy) {
    const m = this.blur.material;
    m.uniforms.tDiffuse.value = source.texture;
    m.uniforms.step.value.set(dx, dy);
    renderer.setRenderTarget(target);
    this.blur.render(renderer);
  }

  scratchFor(target) {
    let s = this.scratch.get(target);
    if (!s || s.width !== target.width) {
      s?.dispose();
      s = target.clone();
      this.scratch.set(target, s);
    }
    return s;
  }

  /** Redraws the contact shadow: a tight dark one at the tyres and a soft wide one under the body. */
  updateShadow(renderer) {
    const [w, d] = this.uniforms.uShadowSize.value.toArray();
    const cam = this.shadowCamera;
    cam.left = -w / 2;
    cam.right = w / 2;
    cam.top = d / 2;
    cam.bottom = -d / 2;
    const state = this.saveState(renderer);
    this.scene.overrideMaterial = this.depthMaterial;
    this.scene.background = null;
    renderer.setClearColor(0x000000, 0);
    for (const [target, far, blur, passes] of [[this.contact, 0.3, 1.4, 1], [this.ambient, (this.carHeight || 1.3) * 0.9, 3.6, 3]]) {
      cam.far = far;
      cam.updateProjectionMatrix();
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(this.scene, cam);
      const tmp = this.scratchFor(target);
      for (let i = 0; i < passes; i++) {
        this.blurInto(renderer, target, tmp, blur / target.width, 0);
        this.blurInto(renderer, tmp, target, 0, blur / target.height);
      }
    }
    this.restoreState(renderer, state);
  }

  /** Redraws the reflection from the camera's mirror image below the floor. */
  updateReflection(renderer, camera, width, height) {
    if (!(this.reflectionScale > 0 && this.reflectionStrength > 0)) return;
    const w = Math.max(2, Math.round(width * this.reflectionScale));
    const h = Math.max(2, Math.round(height * this.reflectionScale));
    if (this.reflect.width !== w || this.reflect.height !== h) {
      this.reflect.setSize(w, h);
      this.reflectBlur.setSize(w, h);
    }
    // The camera's mirror image below the floor (y = 0), as three's Reflector builds it:
    // a proper camera, so faces are not culled inside out, looking at the mirrored target.
    const eye = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    if (eye.y <= 0.001) return;
    const rotation = new THREE.Matrix4().extractRotation(camera.matrixWorld);
    const look = new THREE.Vector3(0, 0, -1).applyMatrix4(rotation).add(eye);
    const v = this.virtualCamera;
    v.position.set(eye.x, -eye.y, eye.z);
    v.up.set(0, 1, 0).applyMatrix4(rotation);
    v.up.y = -v.up.y;
    v.lookAt(look.x, -look.y, look.z);
    v.near = camera.near;
    v.far = camera.far;
    v.updateMatrixWorld();
    v.projectionMatrix.copy(camera.projectionMatrix);
    v.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    this.reflectMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(v.projectionMatrix).multiply(v.matrixWorldInverse);

    const state = this.saveState(renderer);
    this.scene.background = null;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this.reflect);
    renderer.clear();
    renderer.render(this.scene, v);
    const s = 1.6;
    this.blurInto(renderer, this.reflect, this.reflectBlur, s / w, 0);
    this.blurInto(renderer, this.reflectBlur, this.reflect, 0, s / h);
    this.restoreState(renderer, state);
  }

  saveState(renderer) {
    return {
      target: renderer.getRenderTarget(),
      clear: renderer.getClearColor(new THREE.Color()),
      alpha: renderer.getClearAlpha(),
      background: this.scene.background,
      override: this.scene.overrideMaterial,
      floor: this.floor.visible,
    };
  }

  restoreState(renderer, s) {
    this.scene.background = s.background;
    this.scene.overrideMaterial = s.override;
    renderer.setRenderTarget(s.target);
    renderer.setClearColor(s.clear, s.alpha);
  }

  dispose() {
    for (const t of [this.contact, this.ambient, this.reflect, this.reflectBlur, ...this.scratch.values()]) t.dispose();
    this.floor.geometry.dispose();
    this.floor.material.dispose();
    this.depthMaterial.dispose();
    this.blur.dispose();
  }
}
