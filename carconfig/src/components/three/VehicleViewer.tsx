"use client";

import { PerformanceMonitor } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import {
  Bloom,
  EffectComposer,
  N8AO,
  SMAA,
  ToneMapping,
  Vignette,
} from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { Suspense, useMemo, useState } from "react";
import * as THREE from "three";
import type { ViewerConfig } from "@/lib/build/viewer-config";
import { BODY_STYLES } from "@/lib/three/body-styles";
import { CameraRig, type ViewName } from "./CameraRig";
import { Car } from "./car/Car";
import { ModelBoundary, RealCar } from "./car/RealCar";
import type { SceneName } from "./scenes";
import { Studio } from "./Studio";

/**
 * The canvas: studio, car, camera, and a light post-processing pass.
 *
 * Quality steps down on its own when the frame rate does. The reflective
 * floor and ambient occlusion are the expensive parts, and a laptop that
 * cannot hold a frame rate with them gets a matte floor instead of a stutter.
 * Everything that makes the car legible — the paint, the reflections, the
 * wheels — survives the downgrade.
 */
export default function VehicleViewer({
  config,
  view,
  viewNonce,
  scene,
}: {
  config: ViewerConfig;
  view: ViewName;
  viewNonce: number;
  scene: SceneName;
}) {
  const [quality, setQuality] = useState<"high" | "low">("high");

  const size = useMemo(() => {
    const S = BODY_STYLES[config.style];
    const overhang = config.length - config.wheelbase;
    return {
      length: config.length,
      width: config.width,
      height: config.height,
      frontAxleZ: config.length / 2 - overhang * S.frontOverhangShare,
      trackHalf: config.width / 2 - 0.12,
    };
  }, [config.style, config.length, config.width, config.height, config.wheelbase]);

  return (
    <Canvas
      shadows
      dpr={quality === "high" ? [1, 1.75] : [1, 1.25]}
      camera={{ position: [6, 1.6, 7], fov: 30, near: 0.05, far: 80 }}
      gl={{
        antialias: false,
        powerPreference: "high-performance",
        toneMapping: THREE.NoToneMapping,
      }}
    >
      <PerformanceMonitor onDecline={() => setQuality("low")} flipflops={2} />

      <Suspense fallback={null}>
        <Studio quality={quality} scene={scene} />
        {config.asset ? (
          // The generated car stands in while the model downloads, and for
          // good if it fails to load.
          <ModelBoundary fallback={<Car config={config} />}>
            <Suspense fallback={<Car config={config} />}>
              <RealCar config={config} asset={config.asset} />
            </Suspense>
          </ModelBoundary>
        ) : (
          <Car config={config} />
        )}
      </Suspense>

      <CameraRig view={view} nonce={viewNonce} size={size} />

      <EffectComposer multisampling={quality === "high" ? 4 : 0} enableNormalPass={false}>
        {quality === "high" ? (
          <N8AO aoRadius={0.5} intensity={1.6} distanceFalloff={0.6} halfRes />
        ) : (
          <></>
        )}
        <Bloom mipmapBlur luminanceThreshold={1} luminanceSmoothing={0.2} intensity={0.55} />
        <ToneMapping mode={ToneMappingMode.AGX} />
        <Vignette offset={0.28} darkness={0.55} />
        {quality === "low" ? <SMAA /> : <></>}
      </EffectComposer>
    </Canvas>
  );
}
