"use client";

import {
  ContactShadows,
  Environment,
  Lightformer,
  MeshReflectorMaterial,
} from "@react-three/drei";

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
export function Studio({ quality }: { quality: "high" | "low" }) {
  return (
    <>
      <color attach="background" args={["#0b0e11"]} />
      <fog attach="fog" args={["#0b0e11", 11, 26]} />

      <Environment resolution={quality === "high" ? 512 : 256} frames={1}>
        <color attach="background" args={["#05070a"]} />

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

        {/* A cool strip high on one side for a little colour in the reflections. */}
        <Lightformer
          color="#7fb4ff"
          intensity={3}
          scale={[6, 0.35, 1]}
          position={[8, 5, 8]}
          onUpdate={(self) => self.lookAt(0, 0, 0)}
        />
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
            blur={[400, 120]}
            resolution={1024}
            mixBlur={1}
            mixStrength={18}
            roughness={0.9}
            depthScale={1.1}
            minDepthThreshold={0.35}
            maxDepthThreshold={1.3}
            color="#0d1013"
            metalness={0.55}
            mirror={0.35}
          />
        ) : (
          <meshStandardMaterial color="#0d1013" roughness={0.85} metalness={0.2} />
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
