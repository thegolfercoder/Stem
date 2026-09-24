import * as THREE from "three";
import type { ViewerConfig } from "@/lib/build/viewer-config";

/**
 * Materials for the car.
 *
 * Car paint is the material everything else is judged against. It is a base
 * coat under a clear coat, and it is the clear coat that carries the
 * reflections of the studio's light strips — the thing that makes a render
 * read as a car rather than a toy. Each finish is a different balance of the
 * two.
 */
export function paintMaterial(
  hex: string,
  finish: ViewerConfig["paintFinish"],
): THREE.MeshPhysicalMaterial {
  const base = { color: new THREE.Color(hex), envMapIntensity: 1.25 };
  switch (finish) {
    case "matte":
      return new THREE.MeshPhysicalMaterial({
        ...base, metalness: 0.08, roughness: 0.72, clearcoat: 0, envMapIntensity: 0.7,
      });
    case "satin":
      return new THREE.MeshPhysicalMaterial({
        ...base, metalness: 0.28, roughness: 0.46, clearcoat: 0.4, clearcoatRoughness: 0.32,
      });
    case "metallic":
      return new THREE.MeshPhysicalMaterial({
        ...base, metalness: 0.78, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.04,
      });
    case "pearl":
      // A colour shift across the panel as it turns away from the light.
      return new THREE.MeshPhysicalMaterial({
        ...base, metalness: 0.45, roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.03,
        iridescence: 0.55, iridescenceIOR: 1.6, iridescenceThicknessRange: [180, 520],
      });
    case "chrome":
      // A wrap, not a paint: a near-perfect mirror tinted by the colour.
      return new THREE.MeshPhysicalMaterial({
        ...base, metalness: 1, roughness: 0.06, clearcoat: 0.6, clearcoatRoughness: 0.02,
        envMapIntensity: 1.6,
      });
    case "gloss":
    default:
      return new THREE.MeshPhysicalMaterial({
        ...base, metalness: 0.32, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03,
      });
  }
}

export const underbodyMaterial = () =>
  new THREE.MeshStandardMaterial({ color: "#07080a", roughness: 0.85, metalness: 0.1 });

/**
 * Tinted glass. See-through enough to make out the seats, dark enough that
 * the cabin's simplicity does not show.
 */
export const glassMaterial = () =>
  new THREE.MeshPhysicalMaterial({
    color: "#0a0f14",
    metalness: 0.1,
    roughness: 0.06,
    envMapIntensity: 0.85,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
  });

export const fabricRoofMaterial = () =>
  new THREE.MeshStandardMaterial({ color: "#121315", roughness: 0.95, metalness: 0 });

export const trimMaterial = () =>
  new THREE.MeshPhysicalMaterial({
    color: "#0b0c0e", roughness: 0.42, metalness: 0.2, clearcoat: 0.5, clearcoatRoughness: 0.2,
  });

export const carbonMaterial = () =>
  new THREE.MeshPhysicalMaterial({
    color: "#111316", roughness: 0.3, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08,
    envMapIntensity: 1.2,
  });
