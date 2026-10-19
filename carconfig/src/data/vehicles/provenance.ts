import type { Provenance } from "@/types/provenance";

/**
 * Shared provenance stamps for the seeded vehicle data.
 *
 * Read these before trusting anything in this directory. None of it is
 * verified. It is good enough to build and test a configurator against and it
 * is not good enough to buy wheels on.
 */

/**
 * Headline figures — power, torque, weight, stock wheel and tire sizes.
 *
 * These come from manufacturer press specifications as generally published.
 * They have not been re-checked against a primary source document, they vary
 * by market and model year more than most people expect, and kerb weight in
 * particular is quoted on at least three different standards depending on who
 * is publishing it. Hence "unverified" rather than "verified": the figures are
 * the right order of magnitude and are the right shape for the data model, but
 * a real product has to confirm each one before showing it as fact.
 */
export const OEM_PUBLISHED: Provenance = {
  source: "Manufacturer published specifications",
  verification: "unverified",
  note:
    "Transcribed from generally published manufacturer figures. Not confirmed " +
    "against a primary source document, and subject to market and model-year " +
    "variation. Verify before relying on it.",
};

/**
 * The min/max offset, width and diameter envelope a wheel has to fit inside.
 *
 * These are not manufacturer figures — no manufacturer publishes them. They
 * are engineering estimates derived from the stock fitment, and they exist so
 * that the compatibility engine has something to reason about. They are
 * labelled "estimated" everywhere they surface, and where no sensible estimate
 * could be made the fields are left undefined so that the engine returns
 * "unknown" instead of inventing a verdict.
 */
export const FITMENT_ENVELOPE_ESTIMATE: Provenance = {
  source: "Derived from stock fitment",
  verification: "estimated",
  note:
    "Clearance envelope estimated from the stock wheel and tire size, not a " +
    "manufacturer or fitment-guide figure. Indicative only — check a real " +
    "fitment guide or measure the car before ordering wheels.",
};

/** Brake specifications, same standing as the headline figures. */
export const OEM_BRAKES: Provenance = {
  source: "Manufacturer published specifications",
  verification: "unverified",
  note:
    "Rotor sizes as generally published. Varies with optional brake packages " +
    "on most of these cars.",
};
