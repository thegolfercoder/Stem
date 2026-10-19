import type { FitmentRecord, Part } from "@/types/part";
import { AERO_PARTS, PAINT_PARTS } from "./appearance";
import { BRAKE_PARTS, SUSPENSION_PARTS } from "./chassis";
import { ENGINE_PARTS, EXHAUST_PARTS, INTAKE_PARTS } from "./powertrain";
import { TIRE_PARTS } from "./tires";
import { WHEEL_PARTS } from "./wheels";

export const PARTS: readonly Part[] = [
  ...WHEEL_PARTS,
  ...TIRE_PARTS,
  ...SUSPENSION_PARTS,
  ...BRAKE_PARTS,
  ...EXHAUST_PARTS,
  ...AERO_PARTS,
  ...PAINT_PARTS,
  ...INTAKE_PARTS,
  ...ENGINE_PARTS,
];

export const PARTS_BY_SLUG: ReadonlyMap<string, Part> = new Map(
  PARTS.map((p) => [p.slug, p]),
);

export const PARTS_BY_ID: ReadonlyMap<string, Part> = new Map(
  PARTS.map((p) => [p.id, p]),
);

/**
 * Explicit fitment claims.
 *
 * These are the `vehicle_parts` rows. They exist to demonstrate the path where
 * somebody has actually checked a combination, and they are deliberately few:
 * in a real catalogue this table is the expensive part, built up one confirmed
 * application at a time, and pretending otherwise would be the whole problem
 * this product is supposed to solve.
 *
 * Note that none of them say `verified`. Nothing in this repository has been
 * checked against a manufacturer's application list, so nothing here gets to
 * claim it has been.
 */
export const FITMENT_RECORDS: readonly FitmentRecord[] = [
  {
    vehicleId: "veh_bmw-m3-g80-competition-xdrive-2023",
    partId: "part_titan7-tr10-19x11-et15-5x112",
    status: "requires_modification",
    note:
      "An 11 inch wheel at ET15 sits far outside the arch on a G80. Expect " +
      "fender rolling and pulling at the rear, and adjustable camber arms to " +
      "get the tire back under the car.",
    provenance: {
      source: "Community fitment reports",
      verification: "unverified",
      note: "Reported by owners, not confirmed by the manufacturer.",
    },
  },
  {
    vehicleId: "veh_toyota-gr86-zn8-2023",
    partId: "part_brembo-gt-380-6pot",
    status: "incompatible",
    note:
      "No 380mm front kit is offered for the ZN8, and the hub and upright " +
      "geometry will not take one. This is not a wheel clearance problem, it " +
      "is that the kit does not exist for this car.",
    provenance: {
      source: "Manufacturer application list",
      verification: "unverified",
      note: "Absence from the maker's application list, not a positive test.",
    },
  },
  {
    vehicleId: "veh_honda-civic-type-r-fl5-2023",
    partId: "part_apex-arc8-18x95-et40-5x120",
    status: "compatible",
    note:
      "Widely used track fitment on the FL5 with a 265 section tire. Lower " +
      "offset than stock, so the track is wider at both ends.",
    provenance: {
      source: "Manufacturer application list",
      verification: "unverified",
      note: "Listed by the wheel maker for this chassis. Not independently confirmed.",
    },
  },
  {
    vehicleId: "veh_subaru-wrx-vb-2022",
    partId: "part_cobb-accessport-stage-1",
    status: "compatible",
    note: "Off-the-shelf Stage 1 map is published for the VB FA24F.",
    provenance: {
      source: "Manufacturer application list",
      verification: "unverified",
    },
  },
];

const fitmentKey = (vehicleId: string, partId: string) => `${vehicleId}::${partId}`;

export const FITMENT_BY_KEY: ReadonlyMap<string, FitmentRecord> = new Map(
  FITMENT_RECORDS.map((r) => [fitmentKey(r.vehicleId, r.partId), r]),
);

export function findFitment(
  vehicleId: string,
  partId: string,
): FitmentRecord | undefined {
  return FITMENT_BY_KEY.get(fitmentKey(vehicleId, partId));
}

export {
  AERO_PARTS,
  BRAKE_PARTS,
  ENGINE_PARTS,
  EXHAUST_PARTS,
  INTAKE_PARTS,
  PAINT_PARTS,
  SUSPENSION_PARTS,
  TIRE_PARTS,
  WHEEL_PARTS,
};
