"use client";

import { ContactShadows, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense } from "react";
import type { ViewerConfig } from "@/lib/build/viewer-config";
import { CarModel } from "./CarModel";

/**
 * The viewer shell: canvas, lighting, camera and controls.
 *
 * Deliberately free of any knowledge about cars or parts — it renders whatever
 * ViewerConfig it is handed. Lighting is three fixed lights rather than an
 * environment map, because an environment map means fetching an HDR file from
 * somewhere and this page should render with no network at all.
 */

export default function VehicleViewer({ config }: { config: ViewerConfig }) {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [4.9, 2.5, 5.4], fov: 36 }}
      gl={{ antialias: true }}
      style={{ background: "transparent" }}
    >
      <color attach="background" args={["#0d1013"]} />
      <fog attach="fog" args={["#0d1013", 12, 26]} />

      {/*
        Dark paint on a dark background needs more help than a lit scene does:
        without a strong key and two fills the body reads as a silhouette and
        the panel shapes disappear. These values are tuned against the darkest
        paint in the catalogue rather than the brightest.
      */}
      <ambientLight intensity={0.55} color="#aebdcc" />
      <hemisphereLight intensity={0.9} groundColor="#12161a" color="#d6e2ee" />
      <directionalLight
        position={[5, 7, 4]}
        intensity={3.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-6}
        shadow-camera-right={6}
        shadow-camera-top={6}
        shadow-camera-bottom={-6}
      />
      <directionalLight position={[-6, 4, -4]} intensity={1.5} color="#8fb0d4" />
      <directionalLight position={[0, 2.5, -7]} intensity={1.1} color="#ffffff" />
      {/* A low fill from the front so the nose does not go black. */}
      <directionalLight position={[2, 1, 8]} intensity={0.8} color="#c9d6e2" />

      <Suspense fallback={null}>
        <CarModel config={config} />

        <ContactShadows
          position={[0, 0.001, 0]}
          opacity={0.6}
          scale={14}
          blur={2.4}
          far={4}
          resolution={1024}
          color="#000000"
        />
      </Suspense>

      {/* Ground plane, so the car is standing on something. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <circleGeometry args={[9, 64]} />
        <meshStandardMaterial color="#14181c" roughness={0.95} metalness={0} />
      </mesh>

      <gridHelper args={[18, 36, "#1e242a", "#171c21"]} position={[0, 0.002, 0]} />

      <OrbitControls
        makeDefault
        enablePan
        minDistance={3.2}
        maxDistance={13}
        // Stop the camera going under the floor, which looks broken.
        maxPolarAngle={Math.PI / 2 - 0.04}
        target={[0, 0.6, 0]}
        enableDamping
        dampingFactor={0.08}
      />
    </Canvas>
  );
}
