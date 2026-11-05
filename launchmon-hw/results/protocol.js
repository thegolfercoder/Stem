// Stem ground unit BLE protocol: the ShotSummary notification, parsed.
//
// Source of truth: launchmon-hw/firmware/ground_unit/ground_unit.ino, fw 0.2
//   struct WireReading { float value; uint8_t prov; uint8_t refusal; }   (packed)
//   struct ShotSummary {
//     uint8_t magic = 0x5A, version = 1; uint16_t shot_seq; uint32_t impact_ms;
//     WireReading ball_speed_radial, club_speed_radial, smash, peak_shaft_rate, tempo_ratio;
//     uint16_t battery_mv_ground, battery_mv_pod;
//   }                                                                     (packed, little-endian)
// 8 + 5 * 6 + 4 = 42 bytes.
//
// Pure functions only: no DOM, no Bluetooth, no clock. Everything here is
// exercised by test/protocol.test.mjs under node.

export const SERVICE_UUID = '7d2a0101-5b1c-4f6e-9c1e-3a6f1f0c2b10';
export const SHOT_CHAR_UUID = '7d2a0102-5b1c-4f6e-9c1e-3a6f1f0c2b10';
export const DEVICE_NAME = 'STEM-RADAR';

export const MAGIC = 0x5a;
export const VERSION = 1;
export const PACKET_BYTES = 42;
const READING_BYTES = 6;

// enum class Prov (ground_unit.ino), same words as launchmon.quantity.Provenance.
export const PROVENANCE = Object.freeze({
  0: 'none',
  1: 'measured',
  2: 'derived',
  3: 'low_confidence',
  4: 'modelled',
});

// enum class Refusal and refusalText() (ground_unit.ino), verbatim.
export const REFUSAL = Object.freeze({
  0: '',
  1: 'capture held no usable shot',
  2: 'club band not resolved before impact',
  3: 'no tone appeared above the club band',
  4: 'ball tracked in too few frames',
  5: 'ball track rose after launch',
  6: 'tone outside the front-end passband',
  7: 'implied smash factor outside plausible bounds',
  8: 'pod not connected',
  9: 'no pod samples cover the impact',
  10: 'gyro at full scale (2000 dps) during the downswing',
  11: 'takeaway or top of swing not found',
  12: 'depends on a refused reading',
});

// The five readings in wire order, with the unit the firmware states and the
// source tag its USB JSON gives them.
export const FIELDS = Object.freeze([
  { key: 'ball_speed_radial', label: 'Ball speed', unit: 'm/s', kind: 'speed', source: 'radar-fw-preview' },
  { key: 'club_speed_radial', label: 'Club speed', unit: 'm/s', kind: 'speed', source: 'radar-fw-preview' },
  { key: 'smash', label: 'Smash factor', unit: 'ratio', kind: 'ratio', source: 'radar-fw-preview' },
  { key: 'peak_shaft_rate', label: 'Peak shaft rate', unit: 'deg/s', kind: 'rate', source: 'imu' },
  { key: 'tempo_ratio', label: 'Tempo', unit: 'ratio', kind: 'ratio', source: 'imu+radar' },
]);

// The ground unit treats a battery reading at or below 1000 mV as "not read"
// (batt_known = g_batt_mv > 1000) and below 3500 mV as low (cfg::BATT_LOW_MV).
export const GROUND_BATT_KNOWN_ABOVE_MV = 1000;
export const GROUND_BATT_LOW_MV = 3500;

function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (Array.isArray(input)) return Uint8Array.from(input);
  return null;
}

export function toHex(input) {
  const b = toBytes(input);
  if (!b) return '';
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}

function decodeReading(dv, offset, field) {
  const value = dv.getFloat32(offset, true);
  const provCode = dv.getUint8(offset + 4);
  const refusalCode = dv.getUint8(offset + 5);
  const base = { key: field.key, unit: field.unit, source: field.source, provenanceCode: provCode, refusalCode };

  if (refusalCode !== 0) {
    const known = Object.prototype.hasOwnProperty.call(REFUSAL, refusalCode);
    // The firmware sends NaN and provenance 0 with every refusal (wire()).
    // Anything else is not what it sends; say so, but the reading is refused either way.
    const consistent = Number.isNaN(value) && provCode === 0;
    return {
      ...base,
      ok: false,
      value: null,
      provenance: 'none',
      status: 'refused',
      reason: known ? REFUSAL[refusalCode] : `refused, code ${refusalCode} (unknown to this page)`,
      anomaly: consistent ? null : 'refusal carried a value or a provenance',
    };
  }

  const provKnown = Object.prototype.hasOwnProperty.call(PROVENANCE, provCode);
  if (!provKnown || provCode === 0) {
    return { ...base, ok: false, value: null, provenance: 'none', status: 'invalid',
      reason: `invalid: provenance code ${provCode} on a reading with no refusal`, anomaly: 'bad provenance' };
  }
  if (!Number.isFinite(value)) {
    return { ...base, ok: false, value: null, provenance: 'none', status: 'invalid',
      reason: 'invalid: no number in a reading with no refusal', anomaly: 'non-finite value' };
  }
  if (value < 0) {
    return { ...base, ok: false, value: null, provenance: 'none', status: 'invalid',
      reason: 'invalid: negative value', anomaly: 'negative value' };
  }
  return { ...base, ok: true, value, provenance: PROVENANCE[provCode], status: 'ok', reason: '', anomaly: null };
}

// Parses one ShotSummary. Returns { ok: true, packet } or { ok: false, error }.
// A packet that is the wrong length, has the wrong magic or an unknown version
// is rejected whole: nothing in it is read, so nothing is misread.
export function parseShotSummary(input) {
  const bytes = toBytes(input);
  if (!bytes) return { ok: false, error: 'not a byte buffer' };
  if (bytes.length < PACKET_BYTES) {
    return { ok: false, error: `short packet: ${bytes.length} of ${PACKET_BYTES} bytes`, code: 'short', length: bytes.length };
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = dv.getUint8(0);
  if (magic !== MAGIC) {
    return { ok: false, error: `wrong magic byte 0x${magic.toString(16).padStart(2, '0')} (expected 0x5a)`, code: 'magic' };
  }
  const version = dv.getUint8(1);
  if (version !== VERSION) {
    return { ok: false, error: `unknown packet version ${version} (this page reads version ${VERSION})`, code: 'version' };
  }
  if (bytes.length !== PACKET_BYTES) {
    return { ok: false, error: `version 1 packet is ${PACKET_BYTES} bytes, got ${bytes.length}`, code: 'length', length: bytes.length };
  }

  const readings = {};
  FIELDS.forEach((f, i) => {
    readings[f.key] = decodeReading(dv, 8 + i * READING_BYTES, f);
  });
  const groundMv = dv.getUint16(38, true);
  const podMv = dv.getUint16(40, true);

  return {
    ok: true,
    packet: {
      version,
      shotSeq: dv.getUint16(2, true),
      impactMs: dv.getUint32(4, true),
      readings,
      battery: {
        groundMv,
        groundKnown: groundMv > GROUND_BATT_KNOWN_ABOVE_MV,
        groundLow: groundMv > GROUND_BATT_KNOWN_ABOVE_MV && groundMv < GROUND_BATT_LOW_MV,
        podMv,
        // 0 until a pod status has arrived since boot. The firmware keeps the
        // last value after the pod disconnects, so a non-zero value is "last
        // reported", not necessarily current.
        podKnown: podMv > 0,
      },
      hex: toHex(bytes),
    },
  };
}

// The inverse, for demo mode. Takes the same shape the parser returns
// ({ value, provenanceCode, refusalCode } per reading) and packs it exactly as
// the firmware's struct does.
export function encodeShotSummary({ shotSeq, impactMs, readings, groundMv, podMv }) {
  const buf = new ArrayBuffer(PACKET_BYTES);
  const dv = new DataView(buf);
  dv.setUint8(0, MAGIC);
  dv.setUint8(1, VERSION);
  dv.setUint16(2, shotSeq & 0xffff, true);
  dv.setUint32(4, impactMs >>> 0, true);
  FIELDS.forEach((f, i) => {
    const r = readings[f.key] || { refusalCode: 1 };
    const o = 8 + i * READING_BYTES;
    const refused = (r.refusalCode || 0) !== 0;
    dv.setFloat32(o, refused ? NaN : r.value, true);
    dv.setUint8(o + 4, refused ? 0 : r.provenanceCode);
    dv.setUint8(o + 5, r.refusalCode || 0);
  });
  dv.setUint16(38, groundMv & 0xffff, true);
  dv.setUint16(40, podMv & 0xffff, true);
  return new Uint8Array(buf);
}

// ---- Units -----------------------------------------------------------------
// 1 mph = 0.44704 m/s exactly (international mile, 1959); 1 km/h = 1/3.6 m/s.
export const SPEED_UNITS = Object.freeze({
  mph: { label: 'mph', perMps: 1 / 0.44704, decimals: 0 },
  mps: { label: 'm/s', perMps: 1, decimals: 1 },
  kmh: { label: 'km/h', perMps: 3.6, decimals: 0 },
});

export function convertSpeed(mps, unit) {
  const u = SPEED_UNITS[unit];
  if (!u) throw new Error(`unknown speed unit ${unit}`);
  if (mps === null || mps === undefined || !Number.isFinite(mps)) return null;
  return mps * u.perMps;
}

// Display text for a reading's value, or null when there is no number.
// Decimals follow the unit and are a display choice, not a stated accuracy.
export function formatReading(reading, speedUnit = 'mph') {
  if (!reading || !reading.ok) return null;
  const f = FIELDS.find((x) => x.key === reading.key);
  if (!f) return null;
  if (f.kind === 'speed') {
    const v = convertSpeed(reading.value, speedUnit);
    return v === null ? null : v.toFixed(SPEED_UNITS[speedUnit].decimals);
  }
  if (f.key === 'smash') return reading.value.toFixed(2);
  if (f.key === 'tempo_ratio') return reading.value.toFixed(1);
  if (f.kind === 'rate') return Math.round(reading.value).toString();
  return String(reading.value);
}

export function provenanceLabel(p) {
  return { measured: 'measured', derived: 'derived', low_confidence: 'low confidence', modelled: 'modelled', none: 'no reading' }[p] || p;
}

// ---- Session statistics ------------------------------------------------------
// Mean of the readings that carry a number; refused or invalid ones are counted,
// never filled in.
export function sessionStats(packets, key) {
  let n = 0, sum = 0, refused = 0;
  for (const p of packets) {
    const r = p.readings[key];
    if (r && r.ok) { n++; sum += r.value; } else refused++;
  }
  return { n, refused, total: packets.length, mean: n ? sum / n : null };
}

// True when a new packet repeats one already held: the characteristic is also
// readable, and a read after reconnecting returns the last shot again.
export function isSameShot(a, b) {
  return !!a && !!b && a.hex === b.hex;
}

// ---- CSV -------------------------------------------------------------------------
// Shortest decimal that reads back as the same float32: what the firmware sent,
// without the float-to-double noise (61.2, not 61.20000076293945).
export function float32Text(v) {
  if (!Number.isFinite(v)) return '';
  for (let p = 1; p <= 9; p++) {
    const s = v.toPrecision(p);
    if (Math.fround(Number(s)) === Math.fround(v)) return String(Number(s));
  }
  return String(v);
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_COLUMNS = (() => {
  const cols = ['session_shot', 'received_at', 'received_via', 'data', 'shot_seq', 'impact_ms'];
  for (const f of FIELDS) {
    const u = f.unit.replace('/', 'p');
    cols.push(`${f.key}_${u}`, `${f.key}_provenance`, `${f.key}_refusal_code`, `${f.key}_refusal`);
  }
  cols.push('battery_mv_ground', 'battery_mv_pod', 'packet_hex');
  return cols;
})();

// rows: [{ index, receivedAt (ISO string), via, demo, packet }]
// Values stay in the units the firmware sends (m/s, deg/s, ratios), unrounded.
export function toCsv(rows) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const row of rows) {
    const p = row.packet;
    const cells = [row.index, row.receivedAt, row.via, row.demo ? 'DEMO synthetic, not a measurement' : 'STEM-RADAR on-device preview', p.shotSeq, p.impactMs];
    for (const f of FIELDS) {
      const r = p.readings[f.key];
      cells.push(r.ok ? float32Text(r.value) : '', r.ok ? r.provenance : 'none', r.refusalCode, r.ok ? '' : r.reason);
    }
    cells.push(p.battery.groundMv, p.battery.podMv, p.hex);
    lines.push(cells.map(csvCell).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}
