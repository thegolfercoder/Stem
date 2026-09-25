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
import { Suspense, useMemo, useState, useSyncExternalStore } from "react";
import * as THREE from "three";
import type { ViewerConfig } from "@/lib/build/viewer-config";
import { BODY_STYLES } from "@/lib/three/body-styles";
import { CameraRig, type ViewName } from "./CameraRig";
import { Car } from "./car/Car";
import { ModelBoundary, RealCar, type ModelInfo } from "./car/RealCar";
import { modelProgress } from "./car/model-progress";
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
  onModelInfo,
}: {
  config: ViewerConfig;
  view: ViewName;
  viewNonce: number;
  scene: SceneName;
  onModelInfo?: (info: ModelInfo) => void;
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
      wheelbase: config.wheelbase,
    };
  }, [config.style, config.length, config.width, config.height, config.wheelbase]);

  return (
    <div className="relative h-full w-full">
    <Canvas
      shadows
      dpr={quality === "high" ? [1, 1.75] : [1, 1.25]}
      // About a 55mm lens on full frame: the focal length car photographers
      // use for three-quarter shots, long enough not to stretch the nose.
      camera={{ position: [6, 1.2, 7], fov: 25, near: 0.05, far: 80 }}
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
              <RealCar config={config} asset={config.asset} onModelInfo={onModelInfo} />
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
        {/* Only the lamps glow, and not much: exaggerated bloom is the first
            thing that makes a render look like a render. */}
        <Bloom mipmapBlur luminanceThreshold={1.4} luminanceSmoothing={0.1} intensity={0.22} />
        <ToneMapping mode={ToneMappingMode.AGX} />
        <Vignette offset={0.35} darkness={0.25} />
        {quality === "low" ? <SMAA /> : <></>}
      </EffectComposer>
    </Canvas>
    {config.asset ? <LoadingBadge url={config.asset.file} /> : null}
    </div>
  );
}

/** How far a big model's download has got, over the stand-in car. */
function LoadingBadge({ url }: { url: string }) {
  const p = useSyncExternalStore(modelProgress.subscribe, modelProgress.get, modelProgress.get);
  if (p.url !== url) return null;
  if (p.failed) {
    return (
      <div className="pointer-events-none absolute inset-x-0 top-14 flex justify-center">
        <span className="rounded bg-black/55 px-3 py-1.5 text-[11px] text-[var(--color-ink-dim)] backdrop-blur">
          The 3D model could not be loaded; showing a stand-in.
        </span>
      </div>
    );
  }
  if (p.done) return null;
  const share = p.total > 0 ? Math.min(1, p.loaded / p.total) : 0;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-14 flex justify-center">
      <div className="w-64 rounded bg-black/55 px-3 py-2 text-[11px] text-[var(--color-ink-dim)] backdrop-blur">
        <div className="flex justify-between">
          <span>Loading 3D model…</span>
          <span className="tabular-nums">
            {Math.round(share * 100)}%{p.total > 0 ? ` of ${(p.total / 1e6).toFixed(0)} MB` : ""}
          </span>
        </div>
        <div className="mt-1.5 h-1 overflow-hidden rounded bg-white/10">
          <div className="h-full bg-[var(--color-accent)] transition-[width]" style={{ width: `${share * 100}%` }} />
        </div>
      </div>
    </div>
  );
}
