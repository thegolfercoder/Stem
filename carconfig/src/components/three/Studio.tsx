"use client";

import {
  ContactShadows,
  Environment,
  Lightformer,
  MeshReflectorMaterial,
} from "@react-three/drei";
import type { SceneName } from "./scenes";

/**
 * The room the car stands in.
 *
 * Car renders live or die on reflections. Paint with nothing to reflect looks
 * like plastic; paint with long soft light strips sliding across it looks like
 * a car. So the environment here is a studio built from light-formers —
 * rectangles of light overhead and down each side — rendered into the
 * environment map once. It is generated in the scene, so there is no HDR file
 * to download and nothing to licence.
 *
 * The floor is a blurred reflector: a dark, slightly glossy studio floor that
 * gives the car a reflection to stand in, which grounds it far better than a
 * shadow alone.
 */
const HDRI: Record<Exclude<SceneName, "studio" | "dark">, { file: string; ground: boolean; intensity: number }> = {
  photo: { file: "/hdri/studio_small_09.hdr", ground: false, intensity: 1 },
  road: { file: "/hdri/rural_asphalt_road.hdr", ground: true, intensity: 1 },
  sunset: { file: "/hdri/venice_sunset.hdr", ground: true, intensity: 1.1 },
  night: { file: "/hdri/cobblestone_street_night.hdr", ground: true, intensity: 0.9 },
};

/**
 * The generated studio in two tones. "Light" is the neutral grey room of a
 * professional car photography studio, and the default: paint reflects
 * white softboxes against mid-grey walls, which shows every surface without
 * flattering it. "Dark" is the same softboxes in a black room — more
 * dramatic, less honest about shape.
 */
const TONES = {
  // A studio floor is satin, not wet: a soft hint of the car in it, and the
  // contact shadow doing the work of grounding it.
  studio: { bg: "#c9ccd0", room: "#5d6166", floor: "#b9bcc0", mirror: 0.02, mix: 1.1, fog: [14, 34] as const },
  dark: { bg: "#0b0e11", room: "#05070a", floor: "#0d1013", mirror: 0.35, mix: 18, fog: [11, 26] as const },
};

export function Studio({ quality, scene = "studio" }: { quality: "high" | "low"; scene?: SceneName }) {
  if (scene !== "studio" && scene !== "dark") {
    const h = HDRI[scene];
    return (
      <>
        {h.ground ? (
          <Environment
            files={h.file}
            background
            environmentIntensity={h.intensity}
            ground={{ height: 6, radius: 60, scale: 120 }}
          />
        ) : (
          <>
            <color attach="background" args={["#0b0e11"]} />
            <Environment files={h.file} environmentIntensity={h.intensity} />
            <mesh rotation-x={-Math.PI / 2} receiveShadow>
              <circleGeometry args={[22, 96]} />
              <meshStandardMaterial color="#1a1c1f" roughness={0.6} metalness={0.1} />
            </mesh>
          </>
        )}
        <ContactShadows position={[0, 0.004, 0]} opacity={0.9} scale={12} blur={2} far={2.2} resolution={1024} color="#000000" />
      </>
    );
  }

  const tone = TONES[scene];
  return (
    <>
      <color attach="background" args={[tone.bg]} />
      <fog attach="fog" args={[tone.bg, tone.fog[0], tone.fog[1]]} />

      <Environment resolution={quality === "high" ? 512 : 256} frames={1}>
        <color attach="background" args={[tone.room]} />

        {/* The overhead softbox: one broad panel and three strips. */}
        <Lightformer intensity={1.6} rotation-x={Math.PI / 2} position={[0, 6, 0]} scale={[12, 5, 1]} />
        <Lightformer intensity={2.2} rotation-x={Math.PI / 2} position={[0, 5, -4]} scale={[10, 0.8, 1]} />
        <Lightformer intensity={2.2} rotation-x={Math.PI / 2} position={[0, 5, 0]} scale={[10, 0.8, 1]} />
        <Lightformer intensity={2.2} rotation-x={Math.PI / 2} position={[0, 5, 4]} scale={[10, 0.8, 1]} />

        {/* Long side strips: these are the highlight lines along the flanks. */}
        <Lightformer intensity={2.6} rotation-y={Math.PI / 2} position={[-12, 1.6, 0]} scale={[30, 0.9, 1]} />
        <Lightformer intensity={2.6} rotation-y={-Math.PI / 2} position={[12, 1.6, 0]} scale={[30, 0.9, 1]} />

        {/* Front and rear fill, soft and dim. */}
        <Lightformer intensity={0.9} position={[0, 2, 12]} scale={[10, 3, 1]} />
        <Lightformer intensity={0.6} rotation-y={Math.PI} position={[0, 2, -12]} scale={[10, 3, 1]} />

      </Environment>

      {/* One real light for crisp shadows; the environment does the rest. */}
      <directionalLight
        position={[3.5, 8, 4.5]}
        intensity={1.1}
        castShadow
        shadow-mapSize={quality === "high" ? [2048, 2048] : [1024, 1024]}
        shadow-bias={-0.0004}
        shadow-camera-left={-5}
        shadow-camera-right={5}
        shadow-camera-top={5}
        shadow-camera-bottom={-5}
      />
      <ambientLight intensity={0.08} />

      <mesh rotation-x={-Math.PI / 2} position={[0, 0, 0]} receiveShadow>
        <circleGeometry args={[22, 96]} />
        {quality === "high" ? (
          <MeshReflectorMaterial
            blur={[700, 220]}
            resolution={1024}
            mixBlur={1}
            mixStrength={tone.mix}
            roughness={0.9}
            depthScale={1.1}
            minDepthThreshold={0.35}
            maxDepthThreshold={1.3}
            color={tone.floor}
            metalness={0.3}
            mirror={tone.mirror}
          />
        ) : (
          <meshStandardMaterial color={tone.floor} roughness={0.85} metalness={0.1} />
        )}
      </mesh>

      <ContactShadows
        position={[0, 0.004, 0]}
        opacity={0.85}
        scale={12}
        blur={2.2}
        far={2.2}
        resolution={1024}
        color="#000000"
      />
    </>
  );
}
