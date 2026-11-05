// Demo mode: synthetic ShotSummary packets, packed exactly as the firmware
// packs them and fed through the same parser as real notifications. These are
// not measurements, and nothing about them (spread, refusal rate) describes
// the unit. The page labels them DEMO everywhere they appear.

import { encodeShotSummary } from './protocol.js';

// Small seeded generator so a demo run is repeatable.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ok = (value, provenanceCode) => ({ value, provenanceCode, refusalCode: 0 });
const no = (refusalCode) => ({ value: NaN, provenanceCode: 0, refusalCode });

// Refusal codes as in ground_unit.ino's enum class Refusal.
const R = { NO_IMPACT: 3, BALL_TRACK_SHORT: 4, BALL_TRACK_INCONSISTENT: 5, SMASH_IMPLAUSIBLE: 7,
  GYRO_CLIPPED: 10, SWING_EVENTS_NOT_FOUND: 11, DEPENDS_ON_REFUSED: 12 };
const P = { MEASURED: 1, DERIVED: 2, LOW_CONFIDENCE: 3 };

export function makeDemoPacket(i, rand) {
  const club = 34 + rand() * 12;                       // m/s, synthetic
  const smash = 1.3 + rand() * 0.17;
  let readings = {
    ball_speed_radial: ok(club * smash, P.LOW_CONFIDENCE),
    club_speed_radial: ok(club, P.LOW_CONFIDENCE),
    smash: ok(smash, P.DERIVED),
    peak_shaft_rate: ok(1150 + rand() * 650, P.MEASURED),
    tempo_ratio: ok(2.7 + rand() * 0.6, P.DERIVED),
  };
  // A few refusals, of the kinds the firmware produces, so the page shows them.
  if (i % 7 === 4) {
    readings.ball_speed_radial = no(R.SMASH_IMPLAUSIBLE);
    readings.smash = no(R.SMASH_IMPLAUSIBLE);
  } else if (i % 7 === 6) {
    readings.ball_speed_radial = no(R.BALL_TRACK_SHORT);
    readings.smash = no(R.DEPENDS_ON_REFUSED);
  }
  if (i % 5 === 3) readings.peak_shaft_rate = no(R.GYRO_CLIPPED);
  if (i % 9 === 8) readings.tempo_ratio = no(R.SWING_EVENTS_NOT_FOUND);
  if (i % 11 === 10) {
    readings = {
      ball_speed_radial: no(R.NO_IMPACT), club_speed_radial: no(1), smash: no(R.NO_IMPACT),
      peak_shaft_rate: no(R.NO_IMPACT), tempo_ratio: no(R.NO_IMPACT),
    };
  }
  return encodeShotSummary({
    shotSeq: i + 1,
    impactMs: 60000 + i * 41000 + Math.round(rand() * 9000),
    readings,
    groundMv: Math.round(4010 - i * 3 - rand() * 4),
    podMv: Math.round(3960 - i * 2 - rand() * 4),
  });
}

export class DemoFeed {
  constructor(onPacket, { intervalMs = 4500, seed = 20261105 } = {}) {
    this.onPacket = onPacket;
    this.intervalMs = intervalMs;
    this.rand = mulberry32(seed);
    this.i = 0;
    this.timer = null;
  }
  start({ prefill = 0 } = {}) {
    for (let k = 0; k < prefill; k++) this.next();
    this.next();
    this.timer = setInterval(() => this.next(), this.intervalMs);
  }
  next() {
    const bytes = makeDemoPacket(this.i++, this.rand);
    this.onPacket(new DataView(bytes.buffer));
  }
  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }
}
