"use client";

import { useMemo } from "react";
import { createBodyShape } from "@/lib/three/body-shape";
import type { FactoryFeature } from "@/lib/three/model-shapes";
import { rollingRadiusM, type ViewerConfig } from "@/lib/build/viewer-config";
import { Aero } from "./Aero";
import { Body } from "./Body";
import { Doors, Exhaust, Lights, Mirrors } from "./Details";
import { Stripes } from "./Stripes";
import { Interior } from "./Interior";
import { Trim } from "./Trim";
import { Vents } from "./Vents";
import { Wheel } from "./Wheel";

/**
 * The whole car.
 *
 * The body is built around the car's *stock* wheels — that is what its arches
 * were designed for — and the fitted wheels are then placed by the same
 * arithmetic the compatibility engine uses:
 *
 *   - a bigger rolling radius lifts the car and closes the gap to the arch;
 *   - lowering springs or coilovers drop the body, closing it further;
 *   - a lower offset moves the wheel outward by the difference, and a wider
 *     wheel adds half its extra width to the outside.
 *
 * So a wheel the engine calls "offset outside range" visibly pokes past the
 * wing, and a tire that will rub visibly fills its arch. The picture and the
 * verdict are the same numbers.
 */

/** Stock tires sit this far inside the widest point of the body. */
const TIRE_INSET = 0.018;
const NONE: readonly FactoryFeature[] = [];

/** A little steering lock on the front wheels, which flatters every car. */
const STEER = 0.12;

export function Car({ config }: { config: ViewerConfig }) {
  const stockF = rollingRadiusM(config.front.stock);
  const stockR = rollingRadiusM(config.rear.stock);

  const shape = useMemo(
    () =>
      createBodyShape({
        style: config.style,
        length: config.length,
        width: config.width,
        height: config.height,
        wheelbase: config.wheelbase,
        frontTireRadius: stockF,
        rearTireRadius: stockR,
        overrides: config.model?.overrides,
        traced: config.model?.traced,
      }),
    [config.style, config.length, config.width, config.height, config.wheelbase, stockF, stockR, config.model],
  );

  // Factory splitter and diffuser draw like the aftermarket ones.
  const factory = config.model?.factory ?? NONE;
  const attachments = useMemo(
    () => [
      ...new Set([
        ...config.attachments,
        ...factory.filter((f): f is "splitter" | "diffuser" => f === "splitter" || f === "diffuser"),
      ]),
    ],
    [config.attachments, factory],
  );

  const fittedF = rollingRadiusM(config.front.fitted);
  const fittedR = rollingRadiusM(config.rear.fitted);

  // Body lift and pitch from the tires, then the suspension drop on top.
  const dF = fittedF - stockF;
  const dR = fittedR - stockR;
  const lift = (dF + dR) / 2 + config.rideHeightDeltaMm / 1000;
  const pitch = -Math.atan2(dF - dR, config.wheelbase);

  const corner = (axle: "front" | "rear") => {
    const a = config[axle];
    const z = axle === "front" ? shape.zFrontAxle : shape.zRearAxle;
    // The published track where there is one, kept inside the body's
    // own width; otherwise the tyre is tucked just inside the body.
    const fromBody = shape.tubSection(z).hw - TIRE_INSET - a.stock.tireWidthMm / 2000;
    const track = axle === "front" ? config.trackFront : config.trackRear;
    const stockCentre = track ? Math.min(track / 2, fromBody + TIRE_INSET) : fromBody;
    const offsetShift = (a.stock.offsetMm - a.fitted.offsetMm) / 1000;
    return {
      x: stockCentre + offsetShift,
      y: axle === "front" ? fittedF : fittedR,
      z,
      inner: stockCentre - a.stock.tireWidthMm / 2000 - 0.03,
    };
  };

  const front = corner("front");
  const rear = corner("rear");

  const wheelProps = {
    style: config.wheelStyle,
    finishHex: config.wheelFinishHex,
    boltCount: config.boltCount,
    boltCircleMm: config.boltCircleMm,
    caliperHex: config.caliperHex,
  };

  return (
    <group>
      <group position={[0, lift, 0]} rotation={[pitch, 0, 0]}>
        <Body
          shape={shape}
          paintHex={config.paintHex}
          finish={config.paintFinish}
          archInners={{ front: front.inner, rear: rear.inner }}
        />
        <Lights shape={shape} face={config.face} />
        <Stripes shape={shape} style={config.stripe} hex={config.stripeHex} />
        <Interior shape={shape} />
        <Trim shape={shape} />
        <Doors shape={shape} />
        <Mirrors shape={shape} paintHex={config.paintHex} finish={config.paintFinish} />
        <Exhaust
          shape={shape}
          tips={config.exhaustTips}
          finish={config.tipFinish}
          centre={config.exhaustCentre}
        />
        <Aero shape={shape} attachments={attachments} factoryWing={factory.includes("swan_neck_wing")} />
        {factory.length > 0 ? <Vents shape={shape} features={factory} /> : null}
      </group>

      {([1, -1] as const).map((side) => (
        <group key={`f${side}`} position={[side * front.x, front.y, front.z]} rotation={[0, STEER, 0]}>
          <Wheel
            {...wheelProps}
            side={side}
            fit={config.front.fitted}
            rotorMm={config.front.rotorMm}
            pistons={config.front.caliperPistons}
          />
        </group>
      ))}
      {([1, -1] as const).map((side) => (
        <group key={`r${side}`} position={[side * rear.x, rear.y, rear.z]}>
          <Wheel
            {...wheelProps}
            side={side}
            fit={config.rear.fitted}
            rotorMm={config.rear.rotorMm}
            pistons={config.rear.caliperPistons}
            caliperHex={config.rearCaliperHex}
          />
        </group>
      ))}
    </group>
  );
}

export function carFootprint(config: ViewerConfig) {
  return { length: config.length, width: config.width, height: config.height };
}
