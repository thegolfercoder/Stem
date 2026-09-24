import type { BodyProfile } from "@/types/vehicle";

/**
 * Body style presets for the parametric car.
 *
 * Every car in the viewer is the same generator with different numbers. The
 * dimensions come from the car itself where it has been measured; these
 * presets supply everything a spec sheet does not publish — where the
 * windshield starts, how steep the backlight is, how much the roof tucks in —
 * and they are the reason a hatch does not look like a sedan.
 *
 * Positions are measured along the car. Heights are fractions of the overall
 * height so that a tall car and a low car of the same style keep their
 * character rather than their absolute numbers.
 */
export interface StylePreset {
  /** Share of the total overhang (length − wheelbase) that sits in front of the front axle. */
  readonly frontOverhangShare: number;
  /** Windshield base, measured back from the front axle, as a fraction of wheelbase. */
  readonly cowl: number;
  /** Horizontal run of the windshield, metres. Longer is more raked. */
  readonly windshieldRun: number;
  /** Roof length as a fraction of wheelbase. */
  readonly roof: number;
  /** Horizontal run of the rear window, metres. Near zero is an upright tailgate. */
  readonly backlightRun: number;

  /** Heights as fractions of overall height. */
  readonly belt: number;
  readonly nose: number;
  readonly deck: number;
  readonly tail: number;

  /** Ground clearance, metres. */
  readonly clearance: number;
  /** How far the underside lifts toward each end (approach and departure), metres. */
  readonly liftFront: number;
  readonly liftRear: number;

  /** Superellipse exponents: higher is boxier. */
  readonly roundTop: number;
  readonly roundBottom: number;
  readonly cabinRound: number;
  /** How far the top of the body rolls inward, as a fraction of half-width. */
  readonly shoulderRoll: number;

  /** Greenhouse: base inset from the body side (m) and roof taper (fraction). */
  readonly shoulder: number;
  readonly tumblehome: number;

  /** Extra half-width over the rear wheels, metres — the haunches. */
  readonly hips: number;
  /**
   * Extra half-width over the front wheels, metres. Defaults to most of the
   * hips, so every body swells over its wheels and pinches in at the doors.
   */
  readonly flareFront?: number;

  /** Plan-view rounding at each end: half-width ratio at the cap, and taper length (m). */
  readonly noseRatio: number;
  readonly tailRatio: number;
  readonly taperFront: number;
  readonly taperRear: number;
  /** Depth of the domed nose and tail caps, metres. */
  readonly capFront: number;
  readonly capRear: number;
  /**
   * How far the top of each end face sits back from its bottom, metres. Real
   * fascias lean back at the top and tuck forward at the chin; a vertical
   * face is what makes a generated car look like a brick.
   */
  readonly leanFront: number;
  readonly leanRear: number;

  /**
   * How far the middle of the bonnet (front) and engine lid or boot (rear)
   * sits below the tops of the wings, metres. Zero is a flat-topped body; a
   * 911 has its lamps on raised wings with the bonnet low between them.
   */
  readonly fenderPeakFront?: number;
  readonly fenderPeakRear?: number;

  readonly roofMaterial: "paint" | "fabric";
  /** Doors per side, for where the shut lines go. */
  readonly doors: 1 | 2;
  /** Pickup bed behind the cab. */
  readonly bed: boolean;
}

export const BODY_STYLES: Readonly<Record<BodyProfile, StylePreset>> = {
  coupe: {
    frontOverhangShare: 0.52, cowl: 0.22, windshieldRun: 0.95, roof: 0.3,
    backlightRun: 0.9, belt: 0.64, nose: 0.47, deck: 0.66, tail: 0.64,
    clearance: 0.12, liftFront: 0.07, liftRear: 0.08,
    roundTop: 4.4, roundBottom: 6.0, cabinRound: 4.0, shoulderRoll: 0.08,
    shoulder: 0.085, tumblehome: 0.2, hips: 0.035,
    noseRatio: 0.88, tailRatio: 0.9, taperFront: 0.32, taperRear: 0.26,
    capFront: 0.085, capRear: 0.07, leanFront: 0.09, leanRear: 0.07,
    doors: 1, roofMaterial: "paint", bed: false,
  },
  sedan: {
    frontOverhangShare: 0.48, cowl: 0.2, windshieldRun: 0.85, roof: 0.44,
    backlightRun: 0.6, belt: 0.66, nose: 0.48, deck: 0.69, tail: 0.66,
    clearance: 0.13, liftFront: 0.07, liftRear: 0.07,
    roundTop: 5.0, roundBottom: 6.5, cabinRound: 4.5, shoulderRoll: 0.07,
    shoulder: 0.075, tumblehome: 0.17, hips: 0.02,
    noseRatio: 0.88, tailRatio: 0.9, taperFront: 0.32, taperRear: 0.26,
    capFront: 0.085, capRear: 0.07, leanFront: 0.08, leanRear: 0.06,
    doors: 2, roofMaterial: "paint", bed: false,
  },
  hatch: {
    frontOverhangShare: 0.55, cowl: 0.17, windshieldRun: 0.8, roof: 0.55,
    backlightRun: 0.16, belt: 0.64, nose: 0.5, deck: 0.72, tail: 0.7,
    clearance: 0.13, liftFront: 0.07, liftRear: 0.06,
    roundTop: 5.0, roundBottom: 6.5, cabinRound: 4.6, shoulderRoll: 0.07,
    shoulder: 0.07, tumblehome: 0.16, hips: 0.02,
    noseRatio: 0.88, tailRatio: 0.9, taperFront: 0.32, taperRear: 0.26,
    capFront: 0.085, capRear: 0.07, leanFront: 0.07, leanRear: 0.03,
    doors: 2, roofMaterial: "paint", bed: false,
  },
  wagon: {
    frontOverhangShare: 0.48, cowl: 0.2, windshieldRun: 0.85, roof: 0.66,
    backlightRun: 0.14, belt: 0.64, nose: 0.49, deck: 0.7, tail: 0.68,
    clearance: 0.14, liftFront: 0.07, liftRear: 0.06,
    roundTop: 5.0, roundBottom: 6.5, cabinRound: 4.8, shoulderRoll: 0.06,
    shoulder: 0.07, tumblehome: 0.15, hips: 0.02,
    noseRatio: 0.88, tailRatio: 0.9, taperFront: 0.32, taperRear: 0.26,
    capFront: 0.085, capRear: 0.07, leanFront: 0.07, leanRear: 0.03,
    doors: 2, roofMaterial: "paint", bed: false,
  },
  suv: {
    frontOverhangShare: 0.5, cowl: 0.18, windshieldRun: 0.78, roof: 0.62,
    backlightRun: 0.2, belt: 0.62, nose: 0.53, deck: 0.66, tail: 0.66,
    clearance: 0.2, liftFront: 0.1, liftRear: 0.09,
    roundTop: 5.6, roundBottom: 7.0, cabinRound: 5.2, shoulderRoll: 0.06,
    shoulder: 0.065, tumblehome: 0.12, hips: 0.02,
    noseRatio: 0.88, tailRatio: 0.9, taperFront: 0.32, taperRear: 0.26,
    capFront: 0.085, capRear: 0.07, leanFront: 0.05, leanRear: 0.03,
    doors: 2, roofMaterial: "paint", bed: false,
  },
  roadster: {
    frontOverhangShare: 0.5, cowl: 0.3, windshieldRun: 0.62, roof: 0.18,
    backlightRun: 0.42, belt: 0.66, nose: 0.46, deck: 0.66, tail: 0.64,
    clearance: 0.11, liftFront: 0.07, liftRear: 0.07,
    roundTop: 4.2, roundBottom: 6.0, cabinRound: 3.6, shoulderRoll: 0.08,
    shoulder: 0.11, tumblehome: 0.2, hips: 0.04,
    noseRatio: 0.88, tailRatio: 0.9, taperFront: 0.32, taperRear: 0.26,
    capFront: 0.085, capRear: 0.07, leanFront: 0.09, leanRear: 0.07,
    doors: 1, roofMaterial: "fabric", bed: false,
  },
  truck: {
    frontOverhangShare: 0.46, cowl: 0.2, windshieldRun: 0.7, roof: 0.4,
    backlightRun: 0.06, belt: 0.6, nose: 0.58, deck: 0.58, tail: 0.58,
    clearance: 0.23, liftFront: 0.1, liftRear: 0.06,
    roundTop: 6.5, roundBottom: 7.5, cabinRound: 5.6, shoulderRoll: 0.04,
    shoulder: 0.05, tumblehome: 0.1, hips: 0.02,
    noseRatio: 0.88, tailRatio: 0.96, taperFront: 0.4, taperRear: 0.18,
    capFront: 0.1, capRear: 0.05, leanFront: 0.03, leanRear: 0.01,
    doors: 2, roofMaterial: "paint", bed: true,
  },
};

/**
 * What to draw for a car with no published dimensions.
 *
 * Typical figures for the style, not any particular car. The viewer says so
 * on the canvas when it is using these.
 */
export interface StyleDefaults {
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly wheelbaseMm: number;
  readonly wheel: {
    readonly diameterIn: number;
    readonly widthIn: number;
    readonly offsetMm: number;
    readonly tireWidthMm: number;
    readonly tireAspect: number;
  };
  readonly rotorMm: number;
  readonly boltCount: number;
  readonly boltCircleMm: number;
}

export const STYLE_DEFAULTS: Readonly<Record<BodyProfile, StyleDefaults>> = {
  coupe: {
    lengthMm: 4550, widthMm: 1850, heightMm: 1360, wheelbaseMm: 2700,
    wheel: { diameterIn: 19, widthIn: 9, offsetMm: 38, tireWidthMm: 255, tireAspect: 35 },
    rotorMm: 350, boltCount: 5, boltCircleMm: 114.3,
  },
  sedan: {
    lengthMm: 4750, widthMm: 1850, heightMm: 1450, wheelbaseMm: 2800,
    wheel: { diameterIn: 18, widthIn: 8, offsetMm: 42, tireWidthMm: 235, tireAspect: 45 },
    rotorMm: 320, boltCount: 5, boltCircleMm: 114.3,
  },
  hatch: {
    lengthMm: 4350, widthMm: 1800, heightMm: 1460, wheelbaseMm: 2650,
    wheel: { diameterIn: 17, widthIn: 7.5, offsetMm: 45, tireWidthMm: 225, tireAspect: 45 },
    rotorMm: 300, boltCount: 5, boltCircleMm: 112,
  },
  wagon: {
    lengthMm: 4800, widthMm: 1850, heightMm: 1500, wheelbaseMm: 2850,
    wheel: { diameterIn: 18, widthIn: 8, offsetMm: 42, tireWidthMm: 235, tireAspect: 45 },
    rotorMm: 320, boltCount: 5, boltCircleMm: 112,
  },
  suv: {
    lengthMm: 4750, widthMm: 1930, heightMm: 1720, wheelbaseMm: 2850,
    wheel: { diameterIn: 19, widthIn: 8.5, offsetMm: 40, tireWidthMm: 255, tireAspect: 55 },
    rotorMm: 350, boltCount: 5, boltCircleMm: 114.3,
  },
  roadster: {
    lengthMm: 4000, widthMm: 1760, heightMm: 1250, wheelbaseMm: 2350,
    wheel: { diameterIn: 17, widthIn: 7.5, offsetMm: 45, tireWidthMm: 215, tireAspect: 45 },
    rotorMm: 290, boltCount: 5, boltCircleMm: 114.3,
  },
  truck: {
    lengthMm: 5800, widthMm: 2030, heightMm: 1950, wheelbaseMm: 3680,
    wheel: { diameterIn: 18, widthIn: 8.5, offsetMm: 44, tireWidthMm: 275, tireAspect: 65 },
    rotorMm: 350, boltCount: 6, boltCircleMm: 135,
  },
};

