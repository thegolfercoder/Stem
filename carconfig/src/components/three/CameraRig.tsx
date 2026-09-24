"use client";

import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

/**
 * Camera: an intro move, named viewpoints, and a slow turntable when idle.
 *
 * Viewpoints are expressed relative to the car's length rather than in fixed
 * metres, so the side view frames a Miata and a pickup equally well.
 *
 * Any drag hands control straight to the user: the rig stops steering the
 * moment someone grabs the car, and only starts turning it again after they
 * have left it alone for a while.
 */

export type ViewName = "hero" | "side" | "rear" | "front" | "top" | "wheel";

export const VIEWS: readonly { name: ViewName; label: string }[] = [
  { name: "hero", label: "¾ front" },
  { name: "side", label: "Side" },
  { name: "rear", label: "¾ rear" },
  { name: "front", label: "Front" },
  { name: "top", label: "Top" },
  { name: "wheel", label: "Wheel" },
];

interface Framing {
  readonly position: THREE.Vector3;
  readonly target: THREE.Vector3;
}

function framing(
  view: ViewName,
  size: { length: number; width: number; height: number; frontAxleZ: number; trackHalf: number },
): Framing {
  const L = Math.max(size.length, 3.6);
  const h = size.height;
  const t = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  switch (view) {
    case "side":
      return { position: t(L * 1.52, h * 0.62, 0), target: t(0, h * 0.42, 0) };
    case "rear":
      return { position: t(-L * 0.92, h * 1.02, -L * 1.08), target: t(0, h * 0.42, -0.1) };
    case "front":
      return { position: t(0, h * 0.72, L * 1.42), target: t(0, h * 0.42, 0) };
    case "top":
      return { position: t(0.01, L * 1.85, 0.01), target: t(0, 0, 0) };
    case "wheel":
      return {
        position: t(size.trackHalf + 1.25, 0.46, size.frontAxleZ + 0.95),
        target: t(size.trackHalf, 0.34, size.frontAxleZ),
      };
    case "hero":
    default:
      return { position: t(L * 0.98, h * 0.92, L * 1.1), target: t(0, h * 0.38, 0.05) };
  }
}

const IDLE_BEFORE_TURNTABLE_MS = 7000;

export function CameraRig({
  view,
  nonce,
  size,
}: {
  view: ViewName;
  /** Bumped when the same view is chosen again, so it re-frames. */
  nonce: number;
  size: { length: number; width: number; height: number; frontAxleZ: number; trackHalf: number };
}) {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera);
  const goal = useRef<Framing | null>(null);
  const lastTouch = useRef(0);
  const reducedMotion = useRef(false);

  useEffect(() => {
    reducedMotion.current =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  // Intro: start wide and low, and ease into the chosen view.
  useEffect(() => {
    const f = framing("hero", size);
    camera.position.copy(f.position).multiplyScalar(1.7).setY(0.35);
    controls.current?.target.copy(f.target);
    lastTouch.current = performance.now();
    // Only on mount; later changes go through the view effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    goal.current = framing(view, size);
    lastTouch.current = performance.now();
    if (reducedMotion.current && goal.current) {
      camera.position.copy(goal.current.position);
      controls.current?.target.copy(goal.current.target);
      goal.current = null;
    }
  }, [view, nonce, size, camera]);

  useFrame((_, dt) => {
    const c = controls.current;
    if (!c) return;

    if (goal.current) {
      // Exponential ease: fast at first, settling gently, frame-rate independent.
      const k = 1 - Math.exp(-dt * 3.2);
      camera.position.lerp(goal.current.position, k);
      c.target.lerp(goal.current.target, k);
      if (
        camera.position.distanceTo(goal.current.position) < 0.01 &&
        c.target.distanceTo(goal.current.target) < 0.01
      ) {
        goal.current = null;
      }
    }

    const idle = performance.now() - lastTouch.current > IDLE_BEFORE_TURNTABLE_MS;
    c.autoRotate = idle && !goal.current && !reducedMotion.current;
    c.update();
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.07}
      autoRotateSpeed={0.55}
      minDistance={1.6}
      maxDistance={14}
      // Never under the floor: it looks broken, and there is nothing there.
      maxPolarAngle={Math.PI / 2 - 0.03}
      onStart={() => {
        goal.current = null;
        lastTouch.current = performance.now();
      }}
      onEnd={() => {
        lastTouch.current = performance.now();
      }}
    />
  );
}
