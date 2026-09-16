"use client";

import { useMemo } from "react";
import * as THREE from "three";
import type { ViewerConfig, ViewerWheel } from "@/lib/build/viewer-config";
import { rollingRadiusM, tireWidthM } from "@/lib/build/viewer-config";
import type { BodyProfile } from "@/types/vehicle";

/**
 * A placeholder car, built out of primitives.
 *
 * This is not trying to look like any particular car and it should not. What
 * it is for is proving the configurator architecture: the body, the wheels and
 * each aero part are independent pieces driven by ViewerConfig, so a wheel
 * change re-draws only the wheels, and replacing any one of these components
 * with a real GLTF asset changes nothing outside this directory.
 *
 * The wheels are the part worth looking at: their size comes from the actual
 * rolling radius of the selected wheel and tire, so a 17 inch wheel is
 * visibly smaller than a 20 and a lowered car visibly sits closer to them.
 * That is the bit users check against reality, so it is the bit that is real.
 */

interface BodyDimensions {
  readonly length: number;
  /** Track width, outer edge of tire to outer edge of tire. */
  readonly width: number;
  readonly bodyHeight: number;
  readonly cabinLength: number;
  readonly cabinHeight: number;
  /** Cabin centre relative to the body centre, in metres. Negative is rearward. */
  readonly cabinZ: number;
  readonly wheelbase: number;
  /**
   * How far the underside sits above the ground before any suspension change.
   * The sill panel is drawn down to this, which is what gives the car a
   * visible ride height rather than a floating body.
   */
  readonly groundClearance: number;
}

/**
 * The body is drawn narrower than the track, which is the thing that makes a
 * box read as a car: the wheels stand proud at the corners instead of being
 * swallowed by the bodywork. Everything else is proportion.
 */
const BODY_WIDTH_RATIO = 0.83;

const BODIES: Record<BodyProfile, BodyDimensions> = {
  coupe: {
    length: 4.55, width: 1.90, bodyHeight: 0.60, cabinLength: 1.80,
    cabinHeight: 0.40, cabinZ: -0.30, wheelbase: 2.72, groundClearance: 0.12,
  },
  sedan: {
    length: 4.75, width: 1.90, bodyHeight: 0.62, cabinLength: 2.20,
    cabinHeight: 0.46, cabinZ: -0.26, wheelbase: 2.86, groundClearance: 0.13,
  },
  hatch: {
    length: 4.35, width: 1.86, bodyHeight: 0.62, cabinLength: 2.20,
    cabinHeight: 0.50, cabinZ: -0.34, wheelbase: 2.74, groundClearance: 0.13,
  },
  wagon: {
    length: 4.75, width: 1.87, bodyHeight: 0.62, cabinLength: 2.55,
    cabinHeight: 0.50, cabinZ: -0.40, wheelbase: 2.86, groundClearance: 0.14,
  },
  suv: {
    length: 4.70, width: 1.97, bodyHeight: 0.74, cabinLength: 2.35,
    cabinHeight: 0.56, cabinZ: -0.28, wheelbase: 2.82, groundClearance: 0.20,
  },
  roadster: {
    length: 3.95, width: 1.76, bodyHeight: 0.54, cabinLength: 1.20,
    cabinHeight: 0.32, cabinZ: -0.48, wheelbase: 2.31, groundClearance: 0.11,
  },
};

/** Paint finish translated into material parameters. */
function paintMaterial(hex: string, finish: ViewerConfig["paintFinish"]) {
  switch (finish) {
    case "matte":
      return { color: hex, roughness: 0.85, metalness: 0.0, clearcoat: 0 };
    case "satin":
      return { color: hex, roughness: 0.5, metalness: 0.15, clearcoat: 0.2 };
    case "metallic":
      return { color: hex, roughness: 0.28, metalness: 0.75, clearcoat: 0.5 };
    case "gloss":
    default:
      return { color: hex, roughness: 0.18, metalness: 0.25, clearcoat: 0.8 };
  }
}

function Wheel({
  wheel,
  position,
  style,
  finishHex,
}: {
  wheel: ViewerWheel;
  position: [number, number, number];
  style: ViewerConfig["wheelStyle"];
  finishHex: string;
}) {
  const radius = rollingRadiusM(wheel);
  const width = tireWidthM(wheel);
  const rimRadius = (wheel.diameterIn * 25.4) / 1000 / 2;

  const spokeCount = useMemo(() => {
    switch (style) {
      case "mesh":
        return 14;
      case "split_spoke":
        return 10;
      case "twin_five_spoke":
        return 10;
      case "five_spoke":
      default:
        return 5;
    }
  }, [style]);

  const spokes = useMemo(
    () =>
      Array.from({ length: spokeCount }, (_, i) => (i / spokeCount) * Math.PI * 2),
    [spokeCount],
  );

  return (
    <group position={position} rotation={[0, 0, Math.PI / 2]}>
      {/* Tire */}
      <mesh castShadow>
        <cylinderGeometry args={[radius, radius, width, 40]} />
        <meshStandardMaterial color="#111315" roughness={0.92} metalness={0.02} />
      </mesh>

      {/* Rim barrel, slightly inset so the tire reads as a separate object */}
      <mesh>
        <cylinderGeometry args={[rimRadius, rimRadius, width * 0.98, 36]} />
        <meshStandardMaterial color={finishHex} roughness={0.35} metalness={0.85} />
      </mesh>

      {/* Face and spokes, drawn on both sides of the wheel */}
      {[1, -1].map((side) => (
        <group key={side} position={[0, (side * width) / 2, 0]}>
          <mesh rotation={[0, 0, 0]}>
            <cylinderGeometry args={[rimRadius * 0.28, rimRadius * 0.28, 0.02, 20]} />
            <meshStandardMaterial
              color={finishHex}
              roughness={0.3}
              metalness={0.9}
            />
          </mesh>

          {spokes.map((angle, i) => (
            <mesh
              key={i}
              position={[
                Math.cos(angle) * rimRadius * 0.55,
                0,
                Math.sin(angle) * rimRadius * 0.55,
              ]}
              rotation={[0, -angle, 0]}
            >
              <boxGeometry
                args={[rimRadius * 1.1, 0.018, style === "mesh" ? 0.022 : 0.045]}
              />
              <meshStandardMaterial
                color={finishHex}
                roughness={0.32}
                metalness={0.88}
              />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

function Attachment({
  kind,
  dims,
  bodyWidth,
  bodyY,
}: {
  kind: ViewerConfig["attachments"][number];
  dims: BodyDimensions;
  bodyWidth: number;
  bodyY: number;
}) {
  const carbon = { color: "#15171a", roughness: 0.35, metalness: 0.4 };
  const rear = -dims.length / 2;
  const front = dims.length / 2;

  switch (kind) {
    case "spoiler":
      return (
        <mesh
          position={[0, bodyY + dims.bodyHeight / 2 + 0.05, rear + 0.28]}
          rotation={[-0.14, 0, 0]}
          castShadow
        >
          <boxGeometry args={[bodyWidth * 0.82, 0.05, 0.3]} />
          <meshStandardMaterial {...carbon} />
        </mesh>
      );

    case "wing":
      return (
        <group position={[0, bodyY + dims.bodyHeight / 2 + 0.3, rear + 0.2]}>
          <mesh rotation={[-0.2, 0, 0]} castShadow>
            <boxGeometry args={[bodyWidth * 0.98, 0.045, 0.34]} />
            <meshStandardMaterial {...carbon} />
          </mesh>
          {[-1, 1].map((side) => (
            <mesh key={side} position={[side * bodyWidth * 0.36, -0.16, 0.02]}>
              <boxGeometry args={[0.03, 0.32, 0.16]} />
              <meshStandardMaterial {...carbon} />
            </mesh>
          ))}
        </group>
      );

    case "splitter":
      return (
        <mesh position={[0, bodyY - dims.bodyHeight / 2 + 0.02, front - 0.06]} castShadow>
          <boxGeometry args={[bodyWidth * 1.0, 0.03, 0.34]} />
          <meshStandardMaterial {...carbon} />
        </mesh>
      );

    case "diffuser":
      return (
        <mesh
          position={[0, bodyY - dims.bodyHeight / 2 + 0.04, rear + 0.16]}
          rotation={[0.25, 0, 0]}
          castShadow
        >
          <boxGeometry args={[bodyWidth * 0.88, 0.04, 0.3]} />
          <meshStandardMaterial {...carbon} />
        </mesh>
      );

    case "side_skirts":
      return (
        <>
          {[-1, 1].map((side) => (
            <mesh
              key={side}
              position={[
                side * (bodyWidth / 2 + 0.015),
                bodyY - dims.bodyHeight / 2 + 0.03,
                0,
              ]}
              castShadow
            >
              <boxGeometry args={[0.05, 0.08, dims.length * 0.52]} />
              <meshStandardMaterial {...carbon} />
            </mesh>
          ))}
        </>
      );

    default:
      return null;
  }
}

export function CarModel({ config }: { config: ViewerConfig }) {
  const dims = BODIES[config.bodyProfile];

  const frontRadius = rollingRadiusM(config.front);
  const rearRadius = rollingRadiusM(config.rear);

  const axleY = Math.max(frontRadius, rearRadius);
  const drop = config.rideHeightDeltaMm / 1000;

  /*
   * The body's underside sits at axle height, so the bottom half of each wheel
   * is always in clear air and the top half tucks into the bodywork the way it
   * tucks into an arch. Lowering the car moves the body down relative to the
   * wheels, which is precisely what a set of coilovers does — and because the
   * wheels are drawn at their true rolling radius, a lowered car on big wheels
   * really does end up with less gap.
   */
  const bodyBottom = axleY + drop;
  const bodyY = bodyBottom + dims.bodyHeight / 2;
  const bodyWidth = dims.width * BODY_WIDTH_RATIO;

  const paint = paintMaterial(config.paintHex, config.paintFinish);

  const halfBase = dims.wheelbase / 2;
  // Wheels sit at the track, so their outer faces define the car's width.
  const frontTrack = dims.width / 2 - tireWidthM(config.front) / 2;
  const rearTrack = dims.width / 2 - tireWidthM(config.rear) / 2;

  // The rocker panel: between the wheels, below the body, and narrower than
  // both. Without it the car appears to float.
  const sillHeight = Math.max(bodyBottom - (dims.groundClearance + drop), 0.02);
  const sillY = bodyBottom - sillHeight / 2;
  const sillLength = Math.max(
    dims.wheelbase - frontRadius - rearRadius - 0.1,
    0.5,
  );

  const cabinY = bodyBottom + dims.bodyHeight + dims.cabinHeight / 2;

  const glass = useMemo(
    () => new THREE.MeshPhysicalMaterial({
      color: "#0b0e11",
      roughness: 0.06,
      metalness: 0.1,
      transmission: 0.45,
      thickness: 0.4,
    }),
    [],
  );

  return (
    <group>
      {/* Main body */}
      <mesh position={[0, bodyY, 0]} castShadow receiveShadow>
        <boxGeometry args={[bodyWidth, dims.bodyHeight, dims.length]} />
        <meshPhysicalMaterial {...paint} />
      </mesh>

      {/* Rocker panel */}
      <mesh position={[0, sillY, 0]} castShadow>
        <boxGeometry args={[bodyWidth * 0.9, sillHeight, sillLength]} />
        <meshStandardMaterial color="#0e1013" roughness={0.8} metalness={0.1} />
      </mesh>

      {/* Cabin */}
      <mesh position={[0, cabinY, dims.cabinZ]} castShadow>
        <boxGeometry args={[bodyWidth * 0.9, dims.cabinHeight, dims.cabinLength]} />
        <meshPhysicalMaterial {...paint} />
      </mesh>

      {/* Glasshouse, proud of the cabin so it reads as windows, not as paint */}
      <mesh
        position={[0, cabinY + dims.cabinHeight * 0.06, dims.cabinZ]}
        material={glass}
      >
        <boxGeometry
          args={[
            bodyWidth * 0.915,
            dims.cabinHeight * 0.6,
            dims.cabinLength * 0.93,
          ]}
        />
      </mesh>

      {/* Lights, so the car has a front and a back */}
      {[-1, 1].map((side) => (
        <mesh
          key={`head${side}`}
          position={[side * bodyWidth * 0.32, bodyY + 0.1, dims.length / 2 + 0.005]}
        >
          <boxGeometry args={[bodyWidth * 0.24, 0.09, 0.02]} />
          <meshStandardMaterial
            color="#dfe7ee"
            emissive="#9fb6cc"
            emissiveIntensity={0.35}
          />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh
          key={`tail${side}`}
          position={[side * bodyWidth * 0.33, bodyY + 0.12, -dims.length / 2 - 0.005]}
        >
          <boxGeometry args={[bodyWidth * 0.22, 0.08, 0.02]} />
          <meshStandardMaterial
            color="#8e2420"
            emissive="#c0302a"
            emissiveIntensity={0.45}
          />
        </mesh>
      ))}

      {/* Exhaust tips */}
      {Array.from({ length: config.exhaustTips }, (_, i) => {
        const spread = config.exhaustTips === 2 ? 0.34 : 0.2;
        const offset =
          (i - (config.exhaustTips - 1) / 2) * spread * (config.exhaustTips > 2 ? 1 : 2);
        return (
          <mesh
            key={i}
            position={[offset, bodyY - dims.bodyHeight / 2 + 0.06, -dims.length / 2 - 0.04]}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <cylinderGeometry args={[0.042, 0.042, 0.1, 16]} />
            <meshStandardMaterial color="#9aa2a9" roughness={0.25} metalness={0.95} />
          </mesh>
        );
      })}

      {/* Wheels */}
      <Wheel
        wheel={config.front}
        position={[frontTrack, frontRadius, halfBase]}
        style={config.wheelStyle}
        finishHex={config.wheelFinishHex}
      />
      <Wheel
        wheel={config.front}
        position={[-frontTrack, frontRadius, halfBase]}
        style={config.wheelStyle}
        finishHex={config.wheelFinishHex}
      />
      <Wheel
        wheel={config.rear}
        position={[rearTrack, rearRadius, -halfBase]}
        style={config.wheelStyle}
        finishHex={config.wheelFinishHex}
      />
      <Wheel
        wheel={config.rear}
        position={[-rearTrack, rearRadius, -halfBase]}
        style={config.wheelStyle}
        finishHex={config.wheelFinishHex}
      />

      {config.attachments.map((kind) => (
        <Attachment key={kind} kind={kind} dims={dims} bodyWidth={bodyWidth} bodyY={bodyY} />
      ))}
    </group>
  );
}
