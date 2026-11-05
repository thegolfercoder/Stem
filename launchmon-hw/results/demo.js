// Demo mode: synthetic ShotSummary and UnitStatus packets, packed exactly as
// the firmware packs them and fed through the same parsers as real values.
// These are not measurements, and nothing about them (spread, refusal rate,
// how long a pod takes to charge) describes the unit. The page labels them
// DEMO everywhere they appear.

import { encodeShotSummary, encodeUnitStatus, POD_FLAG, UNIT_FLAG } from './protocol.js';

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
  POD_NO_DATA: 9, GYRO_CLIPPED: 10, SWING_EVENTS_NOT_FOUND: 11, DEPENDS_ON_REFUSED: 12 };
const P = { MEASURED: 1, DERIVED: 2, LOW_CONFIDENCE: 3 };

// world: { podOnClub, groundMv, podMv }. Without it, a pod on the club.
export function makeDemoPacket(i, rand, world = null) {
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
  // A pod on the dock is not on the club: radar-only shots, as the unit runs them.
  if (world && !world.podOnClub) readings.peak_shaft_rate = readings.tempo_ratio = no(R.POD_NO_DATA);
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
    groundMv: world ? world.groundMv : Math.round(4010 - i * 3 - rand() * 4),
    podMv: world ? world.podMv : Math.round(3960 - i * 2 - rand() * 4),
  });
}

// The pod's story in the demo, in demo seconds, repeating: on the club, parked
// and charging, charged, asleep on the dock once charged, then lifted, and a
// dock fault (as if a club head lay across the contacts) that locks the
// contacts out for 30 s. Each phase says what the unit would send.
const PHASES = [
  { key: 'club', s: 26 },
  { key: 'charging', s: 14 },
  { key: 'charged', s: 9 },
  { key: 'asleep', s: 9 },
  { key: 'fault', s: 30 },
];
const CYCLE_S = PHASES.reduce((a, p) => a + p.s, 0);

// Dock reasons and states as in ground_unit.ino (DockReason, DockState).
const DOCK = { OFF: 0, CHARGING: 2, LOCKOUT: 3 };
const WHY = { POD_PARKED: 1, POD_LIFTED: 2, OVERLOAD: 3, LOCKOUT_OVER: 8 };

export function demoWorld(t) {
  const cycle = Math.floor(t / CYCLE_S);
  let u = t - cycle * CYCLE_S, k = 0;
  while (u >= PHASES[k].s) { u -= PHASES[k].s; k++; }
  const phase = PHASES[k].key;
  const groundMv = Math.round(4040 - t * 0.6);
  const unitFlags = UNIT_FLAG.DOCK_FITTED | UNIT_FLAG.BUZZER_FITTED | UNIT_FLAG.BUZZER_ON | UNIT_FLAG.USER_ARMED;
  const linked = POD_FLAG.CONNECTED | POD_FLAG.POWER_KNOWN;
  const onDock = linked | POD_FLAG.DOCK_POWER | POD_FLAG.PARKED;
  const w = { phase, podOnClub: true, groundMv, podMv: 0, podFlags: 0, unitFlags, dockState: DOCK.OFF, dockReason: 0, dockRetryS: 0 };
  switch (phase) {
    case 'club':
      Object.assign(w, { podMv: Math.round(3940 - u * 2), podFlags: linked, dockReason: cycle ? WHY.LOCKOUT_OVER : 0 });
      break;
    case 'charging':
      Object.assign(w, { podOnClub: false, podMv: Math.round(3990 + u * 9), podFlags: onDock | POD_FLAG.CHARGING, dockState: DOCK.CHARGING, dockReason: WHY.POD_PARKED });
      break;
    case 'charged':
      Object.assign(w, { podOnClub: false, podMv: 4182, podFlags: onDock | POD_FLAG.CHARGED, dockState: DOCK.CHARGING, dockReason: WHY.POD_PARKED });
      break;
    case 'asleep':
      Object.assign(w, { podOnClub: false, podFlags: POD_FLAG.PARKED | POD_FLAG.CHARGED_ASLEEP, dockState: DOCK.CHARGING, dockReason: WHY.POD_PARKED });
      break;
    case 'fault':
      Object.assign(w, { podMv: Math.round(4170 - u * 2), podFlags: linked, dockState: DOCK.LOCKOUT, dockReason: WHY.OVERLOAD, dockRetryS: Math.max(1, Math.ceil(30 - u)) });
      break;
    default:
      break;
  }
  return w;
}

export class DemoFeed {
  // onPacket gets ShotSummary values, onStatus UnitStatus values, both as the
  // DataView Web Bluetooth would give.
  constructor(onPacket, onStatus = null, { intervalMs = 4500, tickMs = 1000, seed = 20261105 } = {}) {
    this.onPacket = onPacket;
    this.onStatus = onStatus;
    this.intervalMs = intervalMs;
    this.tickMs = tickMs;
    this.rand = mulberry32(seed);
    this.i = 0;
    this.t = 0;              // demo seconds
    this.lastShot = 0;
    this.sent = null;
    this.sentAt = -Infinity;
    this.timer = null;
  }
  start({ prefill = 0 } = {}) {
    for (let k = 0; k < prefill; k++) this.next();
    this.next();
    this.status(true);
    this.timer = setInterval(() => this.tick(), this.tickMs);
  }
  tick() {
    this.t += this.tickMs / 1000;
    if ((this.t - this.lastShot) * 1000 >= this.intervalMs) { this.lastShot = this.t; this.next(); }
    this.status(false);
  }
  next() {
    const bytes = makeDemoPacket(this.i++, this.rand, demoWorld(this.t));
    this.onPacket(new DataView(bytes.buffer));
  }
  // As the firmware does: on a change (ignoring the countdown and small
  // voltage drift), and every 30 s.
  status(force) {
    if (!this.onStatus) return;
    const w = demoWorld(this.t);
    const f = {
      fwMajor: 0, fwMinor: 3, uptimeMs: Math.round(95000 + this.t * 1000), groundMv: w.groundMv, podMv: w.podMv,
      podFlags: w.podFlags, unitFlags: w.unitFlags, dockState: w.dockState, dockReason: w.dockReason,
      dockRetryS: w.dockRetryS, shotSeq: this.i,
    };
    const s = this.sent;
    const moved = (a, b) => (a === 0) !== (b === 0) || Math.abs(a - b) >= 25;
    const changed = !s || s.podFlags !== f.podFlags || s.unitFlags !== f.unitFlags || s.dockState !== f.dockState ||
      s.dockReason !== f.dockReason || s.shotSeq !== f.shotSeq || moved(s.groundMv, f.groundMv) || moved(s.podMv, f.podMv);
    if (!force && !changed && this.t - this.sentAt < 30) return;
    this.sent = f;
    this.sentAt = this.t;
    const bytes = encodeUnitStatus(f);
    this.onStatus(new DataView(bytes.buffer));
  }
  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }
}
