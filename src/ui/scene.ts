/**
 * The 3D cube.
 *
 * The logical `Cube` is the only source of truth. Every frame of colour on
 * screen is derived from it, and an animated turn is a temporary rotation of a
 * group of meshes that is thrown away the moment the turn lands - at which
 * point the colours are read from the logical state again.
 *
 * Doing it the other way round, letting the meshes carry the state and reading
 * the cube back off their positions, is the obvious shortcut and it drifts:
 * floating-point rotations accumulate, a dropped frame leaves a cubie at 89.7
 * degrees, and by the twentieth turn the render disagrees with the solver about
 * what the cube looks like.
 */

import * as THREE from 'three';

import type { Cube } from '../core/cube.js';
import { toFacelets } from '../core/facelets.js';
import { amountOf, faceOf, type Move } from '../core/moves.js';
import { FACE_NORMALS, cubiePositions, placeSticker, positionKey } from './geometry.js';
import { DEFAULT_PALETTE, type Palette } from './palette.js';

const CUBIE_SIZE = 0.94;
const HIDDEN = '#171719';

/** Three.js orders a box's materials +x, -x, +y, -y, +z, -z. */
const MATERIAL_ORDER: readonly number[] = [1, 4, 0, 3, 2, 5]; // R L U D F B

function letterTexture(colour: string, letter: string): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = colour;
    context.fillRect(0, 0, size, size);
    context.fillStyle = 'rgba(0,0,0,0.55)';
    context.font = `bold ${size * 0.55}px system-ui, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(letter, size / 2, size / 2 + size * 0.03);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class CubeScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;

  private readonly cubies = new Map<string, THREE.Mesh>();
  private readonly pivot = new THREE.Group();
  private readonly root = new THREE.Group();
  private palette: Palette = DEFAULT_PALETTE;
  private textures: THREE.Texture[] = [];
  private animation: {
    remaining: number;
    total: number;
    axis: THREE.Vector3;
    angle: number;
  } | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    this.camera.position.set(5.6, 4.8, 6.6);
    this.camera.lookAt(0, 0, 0);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.72));
    const key = new THREE.DirectionalLight(0xffffff, 0.85);
    key.position.set(5, 8, 6);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.35);
    fill.position.set(-6, -3, -5);
    this.scene.add(fill);

    this.scene.add(this.root);
    this.root.add(this.pivot);

    const geometry = new THREE.BoxGeometry(CUBIE_SIZE, CUBIE_SIZE, CUBIE_SIZE);
    for (const position of cubiePositions()) {
      const materials = Array.from(
        { length: 6 },
        () => new THREE.MeshLambertMaterial({ color: HIDDEN }),
      );
      const mesh = new THREE.Mesh(geometry, materials);
      mesh.position.set(...position);
      mesh.userData['lattice'] = position;
      this.root.add(mesh);
      this.cubies.set(positionKey(position), mesh);
    }

    this.resize();
  }

  setPalette(palette: Palette): void {
    this.palette = palette;
    for (const texture of this.textures) texture.dispose();
    this.textures = [];
  }

  /** Repaint every sticker from the logical state. */
  paint(cube: Cube): void {
    const facelets = toFacelets(cube);

    for (const mesh of this.cubies.values()) {
      const materials = mesh.material as THREE.MeshLambertMaterial[];
      for (const material of materials) {
        material.color.set(HIDDEN);
        material.map = null;
        material.needsUpdate = true;
      }
    }

    for (let index = 0; index < 54; index++) {
      const { position, face } = placeSticker(index);
      const mesh = this.cubies.get(positionKey(position));
      if (!mesh) continue;

      const colourIndex = 'URFDLB'.indexOf(facelets[index] ?? 'U');
      const colour = this.palette.colours[colourIndex] ?? HIDDEN;
      const slot = MATERIAL_ORDER.indexOf(face);
      const material = (mesh.material as THREE.MeshLambertMaterial[])[slot];
      if (!material) continue;

      if (this.palette.showLetters) {
        const texture = letterTexture(colour, 'URFDLB'[colourIndex] ?? '?');
        this.textures.push(texture);
        material.map = texture;
        material.color.set('#ffffff');
      } else {
        material.map = null;
        material.color.set(colour);
      }
      material.needsUpdate = true;
    }
  }

  /**
   * Start turning a face.
   *
   * The nine meshes of the layer move into a pivot group for the duration and
   * come back out when it lands. `settle` is what puts them back and is called
   * by whoever owns the animation loop, so a caller that wants an instant turn
   * can start and settle in the same tick.
   */
  beginTurn(move: Move, durationMs: number): void {
    this.settle();
    const face = faceOf(move);
    const normal = FACE_NORMALS[face];
    if (!normal) return;

    const axis = new THREE.Vector3(...normal);
    for (const mesh of this.cubies.values()) {
      const lattice = mesh.userData['lattice'] as [number, number, number];
      const along = lattice[0] * normal[0] + lattice[1] * normal[1] + lattice[2] * normal[2];
      if (along === 1) this.pivot.attach(mesh);
    }

    // Clockwise seen from outside the face is a negative rotation about its
    // outward normal under the right-hand rule.
    const angle = (-Math.PI / 2) * amountOf(move);
    this.animation = { remaining: durationMs, total: durationMs, axis, angle };
    if (durationMs <= 0) this.pivot.setRotationFromAxisAngle(axis, angle);
  }

  /** Advance an in-flight turn. Returns true when it has finished. */
  advance(deltaMs: number): boolean {
    const animation = this.animation;
    if (!animation) return true;

    animation.remaining = Math.max(0, animation.remaining - deltaMs);
    const done = animation.total === 0 ? 1 : 1 - animation.remaining / animation.total;
    // Ease out: a face turn on a real cube decelerates into its detent.
    const eased = 1 - (1 - done) ** 3;
    this.pivot.setRotationFromAxisAngle(animation.axis, animation.angle * eased);
    return animation.remaining === 0;
  }

  /** Empty the pivot and put every cubie back on the lattice. */
  settle(): void {
    this.animation = null;
    for (const mesh of [...this.pivot.children]) this.root.attach(mesh);
    this.pivot.rotation.set(0, 0, 0);
    for (const [key, mesh] of this.cubies) {
      const lattice = key.split(',').map(Number) as [number, number, number];
      mesh.position.set(...lattice);
      mesh.rotation.set(0, 0, 0);
      mesh.userData['lattice'] = lattice;
    }
  }

  /** Which cubie and face the pointer is over, in cube coordinates. */
  pick(
    clientX: number,
    clientY: number,
  ): { cubie: [number, number, number]; normal: THREE.Vector3 } | null {
    const bounds = this.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((clientX - bounds.left) / bounds.width) * 2 - 1,
      -((clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, this.camera);

    const hits = raycaster.intersectObjects([...this.cubies.values()], false);
    const hit = hits[0];
    if (!hit || !hit.face) return null;

    const normal = hit.face.normal.clone().applyQuaternion(hit.object.quaternion).normalize();
    const lattice = hit.object.userData['lattice'] as [number, number, number];
    return { cubie: lattice, normal };
  }

  /** Spin the whole cube, for the orbit control. */
  orbit(deltaX: number, deltaY: number): void {
    const spherical = new THREE.Spherical().setFromVector3(this.camera.position);
    spherical.theta -= deltaX * 0.008;
    spherical.phi = Math.min(Math.PI - 0.12, Math.max(0.12, spherical.phi - deltaY * 0.008));
    this.camera.position.setFromSpherical(spherical);
    this.camera.lookAt(0, 0, 0);
  }

  zoom(delta: number): void {
    const distance = this.camera.position.length();
    const next = Math.min(18, Math.max(5.0, distance + delta * 0.0045));
    this.camera.position.setLength(next);
  }

  resize(): void {
    const width = this.canvas.clientWidth || 1;
    const height = this.canvas.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
