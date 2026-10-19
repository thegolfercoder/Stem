import type { Part } from "@/types/part";

/**
 * One line of the numbers that matter for each category.
 *
 * A wheel's row should show the fitment, not the marketing copy — this is the
 * line people scan down when comparing, so it carries the dimensions the
 * compatibility rules actually reason about.
 */
export function specSummary(part: Part): string {
  const spec = part.spec;

  switch (spec.kind) {
    case "wheels": {
      const pattern = `${spec.boltCount}x${spec.boltCircleMm}`;
      const front = `${spec.front.diameterIn}x${spec.front.widthIn} ET${spec.front.offsetMm}`;
      const rear = `${spec.rear.diameterIn}x${spec.rear.widthIn} ET${spec.rear.offsetMm}`;
      const sizes = front === rear ? front : `${front} / ${rear}`;
      const weight = spec.weightPerWheelKg ? ` · ${spec.weightPerWheelKg}kg each` : "";
      return `${sizes} · ${pattern} · ${spec.centerBoreMm}mm bore · ${spec.construction.replace("_", " ")}${weight}`;
    }

    case "tires": {
      const front = `${spec.front.widthMm}/${spec.front.aspect}R${spec.front.diameterIn}`;
      const rear = `${spec.rear.widthMm}/${spec.rear.aspect}R${spec.rear.diameterIn}`;
      const sizes = front === rear ? front : `${front} / ${rear}`;
      const tw = spec.treadwear ? ` · ${spec.treadwear} treadwear` : "";
      return `${sizes} · ${spec.compound.replace("_", " ")}${tw}`;
    }

    case "suspension": {
      const drop = (range: readonly [number, number]) =>
        range[0] === range[1] ? `${range[0]}mm` : `${range[0]}–${range[1]}mm`;
      const adj = [
        spec.heightAdjustable ? "height adjustable" : "fixed height",
        spec.damperAdjustable ? "damping adjustable" : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return `${spec.type.replace("_", " ")} · drop ${drop(spec.dropFrontMm)} front / ${drop(spec.dropRearMm)} rear · ${adj}`;
    }

    case "brakes": {
      const parts = [
        spec.type.replace(/_/g, " "),
        spec.rotorDiameterMm ? `${spec.rotorDiameterMm}mm rotors` : null,
        spec.caliperPistons ? `${spec.caliperPistons}-piston` : null,
        spec.minWheelDiameterIn ? `needs ${spec.minWheelDiameterIn}in wheels` : null,
        `${spec.axle} axle`,
      ].filter(Boolean);
      return parts.join(" · ");
    }

    case "exhaust": {
      const parts = [
        spec.type.replace(/_/g, " "),
        spec.material.replace(/_/g, " "),
        spec.pipeDiameterMm ? `${spec.pipeDiameterMm}mm` : null,
        spec.emissionsAffecting ? "affects emissions equipment" : null,
      ].filter(Boolean);
      return parts.join(" · ");
    }

    case "intake":
      return [
        spec.type.replace(/_/g, " "),
        spec.emissionsAffecting ? "affects emissions equipment" : null,
      ]
        .filter(Boolean)
        .join(" · ");

    case "engine": {
      const parts = [
        spec.type.replace(/_/g, " "),
        spec.engineCodes?.length ? `for ${spec.engineCodes.join(", ")}` : null,
        spec.requiresHighOctane ? "high-octane fuel" : null,
      ].filter(Boolean);
      return parts.join(" · ");
    }

    case "aero":
      return `${spec.type.replace(/_/g, " ")} · ${spec.material.replace(/_/g, " ")}`;

    case "paint":
      return `${spec.type.replace(/_/g, " ")} · ${spec.finish} · ${spec.colorHex}`;

    case "interior":
      return spec.type.replace(/_/g, " ");
  }
}

/** "+95 hp · +120 Nm · −4 kg", or empty when the part claims nothing. */
export function claimSummary(part: Part): string {
  const bits: string[] = [];
  if (part.powerDeltaHp) bits.push(`${signed(part.powerDeltaHp)} hp`);
  if (part.torqueDeltaNm) bits.push(`${signed(part.torqueDeltaNm)} Nm`);
  if (part.weightDeltaKg) bits.push(`${signed(part.weightDeltaKg)} kg`);
  return bits.join(" · ");
}

function signed(n: number): string {
  // A real minus sign, so a weight saving does not read as a hyphen.
  return n > 0 ? `+${n}` : `−${Math.abs(n)}`;
}
