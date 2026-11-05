// Tests for results/protocol.js. Node built-ins only:
//   node --test launchmon-hw/results/test/
//
// Packets are built here byte by byte from the firmware's struct, not with the
// module's own encoder, so a layout mistake in protocol.js cannot hide itself:
//   ground_unit.ino:285  struct __attribute__((packed)) WireReading { float value; uint8_t prov; uint8_t refusal; };
//   ground_unit.ino:286  struct __attribute__((packed)) ShotSummary {
//                          uint8_t magic = 0x5A, version = 1; uint16_t shot_seq; uint32_t impact_ms;
//                          WireReading ball_speed_radial, club_speed_radial, smash, peak_shaft_rate, tempo_ratio;
//                          uint16_t battery_mv_ground, battery_mv_pod; };
// ESP32-C3 (RISC-V) is little-endian; IEEE-754 binary32 for float.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseShotSummary, encodeShotSummary, convertSpeed, formatReading, sessionStats, toCsv, CSV_COLUMNS,
  float32Text, isSameShot, podAtShot, PACKET_BYTES, SERVICE_UUID, SHOT_CHAR_UUID, DEVICE_NAME, REFUSAL,
} from '../protocol.js';

const u8 = (v) => [v & 0xff];
const u16le = (v) => [v & 0xff, (v >> 8) & 0xff];
const u32le = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
const f32le = (v) => { const b = Buffer.alloc(4); b.writeFloatLE(v, 0); return [...b]; };
const NAN32 = [0x00, 0x00, 0xc0, 0x7f];   // quiet NaN, as NAN is on the target
const reading = (valueBytes, prov, refusal) => [...valueBytes, ...u8(prov), ...u8(refusal)];

// The example in firmware/README.md's JSON (format only, not a result), as the BLE packet.
function examplePacket() {
  return Uint8Array.from([
    0x5a, 0x01,                                   // magic, version
    ...u16le(3),                                  // shot_seq
    ...u32le(81234),                              // impact_ms
    ...reading([0xcd, 0xcc, 0x74, 0x42], 3, 0),   // ball 61.2 m/s, low_confidence
    ...reading([0x9a, 0x99, 0x2f, 0x42], 3, 0),   // club 43.9 m/s, low_confidence
    ...reading(f32le(1.394), 2, 0),               // smash, derived
    ...reading(NAN32, 0, 10),                     // peak shaft rate refused: GYRO_CLIPPED
    ...reading(f32le(3.02), 2, 0),                // tempo, derived
    ...u16le(3987), ...u16le(4011),               // battery mV
  ]);
}

test('UUIDs and name match the firmware (ground_unit.ino:180-182)', () => {
  assert.equal(DEVICE_NAME, 'STEM-RADAR');
  assert.equal(SERVICE_UUID, '7d2a0101-5b1c-4f6e-9c1e-3a6f1f0c2b10');
  assert.equal(SHOT_CHAR_UUID, '7d2a0102-5b1c-4f6e-9c1e-3a6f1f0c2b10');
});

test('hand-coded float bytes are what a float32 LE writer produces', () => {
  assert.deepEqual(f32le(61.2), [0xcd, 0xcc, 0x74, 0x42]);
  assert.deepEqual(f32le(43.9), [0x9a, 0x99, 0x2f, 0x42]);
});

test('the struct is 42 bytes', () => {
  assert.equal(examplePacket().length, 42);
  assert.equal(PACKET_BYTES, 42);
});

test('parses every field at its offset with its scaling', () => {
  const res = parseShotSummary(examplePacket());
  assert.equal(res.ok, true, res.error);
  const p = res.packet;
  assert.equal(p.version, 1);
  assert.equal(p.shotSeq, 3);
  assert.equal(p.impactMs, 81234);

  const ball = p.readings.ball_speed_radial;
  assert.equal(ball.ok, true);
  assert.equal(ball.value, Math.fround(61.2));
  assert.equal(ball.provenance, 'low_confidence');
  assert.equal(ball.unit, 'm/s');
  assert.equal(ball.source, 'radar-fw-preview');

  const club = p.readings.club_speed_radial;
  assert.equal(club.value, Math.fround(43.9));
  assert.equal(club.provenance, 'low_confidence');

  assert.equal(p.readings.smash.value, Math.fround(1.394));
  assert.equal(p.readings.smash.provenance, 'derived');
  assert.equal(p.readings.tempo_ratio.value, Math.fround(3.02));
  assert.equal(p.readings.tempo_ratio.provenance, 'derived');

  assert.equal(p.battery.groundMv, 3987);
  assert.equal(p.battery.groundKnown, true);
  assert.equal(p.battery.groundLow, false);
  assert.equal(p.battery.podMv, 4011);
  assert.equal(p.battery.podKnown, true);
});

test('a refused reading has no number, and carries the firmware reason', () => {
  const r = parseShotSummary(examplePacket()).packet.readings.peak_shaft_rate;
  assert.equal(r.ok, false);
  assert.equal(r.value, null);
  assert.equal(r.status, 'refused');
  assert.equal(r.refusalCode, 10);
  assert.equal(r.reason, 'gyro at full scale (2000 dps) during the downswing');
  assert.equal(r.anomaly, null);
  assert.equal(formatReading(r, 'mph'), null);
});

test('smash implausible refuses ball and smash but keeps club (ground_unit.ino:858-860)', () => {
  const pkt = Uint8Array.from([
    0x5a, 0x01, ...u16le(7), ...u32le(100000),
    ...reading(NAN32, 0, 7),
    ...reading(f32le(40.0), 3, 0),
    ...reading(NAN32, 0, 7),
    ...reading(NAN32, 0, 8),
    ...reading(NAN32, 0, 8),
    ...u16le(3400), ...u16le(0),
  ]);
  const p = parseShotSummary(pkt).packet;
  assert.equal(p.readings.ball_speed_radial.ok, false);
  assert.equal(p.readings.ball_speed_radial.reason, 'implied smash factor outside plausible bounds');
  assert.equal(p.readings.smash.ok, false);
  assert.equal(p.readings.club_speed_radial.ok, true);
  assert.equal(p.readings.club_speed_radial.value, 40);
  assert.equal(p.readings.peak_shaft_rate.reason, 'pod not connected');
  assert.equal(p.battery.groundLow, true, '3400 mV is under cfg::BATT_LOW_MV 3500');
  assert.equal(p.battery.podKnown, false, '0 mV means no pod status since boot');
});

test('a refusal that carries a number still yields no number, flagged as an anomaly', () => {
  const pkt = examplePacket();
  pkt[13] = 4;   // ball: refusal BALL_TRACK_SHORT, but the value bytes still say 61.2 and prov 3
  const r = parseShotSummary(pkt).packet.readings.ball_speed_radial;
  assert.equal(r.ok, false);
  assert.equal(r.value, null);
  assert.equal(r.reason, 'ball tracked in too few frames');
  assert.ok(r.anomaly);
});

test('unknown refusal code: refused, said so, not guessed', () => {
  const pkt = examplePacket();
  pkt[13] = 200;
  const r = parseShotSummary(pkt).packet.readings.ball_speed_radial;
  assert.equal(r.ok, false);
  assert.match(r.reason, /code 200/);
});

test('no refusal but NaN, provenance 0 or a negative value: invalid, no number', () => {
  const nan = examplePacket();
  nan.set(NAN32, 8);                                 // ball value NaN, prov 3, refusal 0
  assert.equal(parseShotSummary(nan).packet.readings.ball_speed_radial.status, 'invalid');

  const inf = examplePacket();
  inf.set(f32le(Infinity), 8);
  assert.equal(parseShotSummary(inf).packet.readings.ball_speed_radial.ok, false);

  const prov0 = examplePacket();
  prov0[12] = 0;
  assert.equal(parseShotSummary(prov0).packet.readings.ball_speed_radial.status, 'invalid');

  const provBad = examplePacket();
  provBad[12] = 9;
  assert.equal(parseShotSummary(provBad).packet.readings.ball_speed_radial.ok, false);

  const neg = examplePacket();
  neg.set(f32le(-5), 14);                            // club
  const c = parseShotSummary(neg).packet.readings.club_speed_radial;
  assert.equal(c.ok, false);
  assert.equal(c.value, null);
});

test('short packets are rejected whole, including a 20-byte truncated notification', () => {
  const full = examplePacket();
  for (const n of [0, 1, 8, 20, 41]) {
    const res = parseShotSummary(full.slice(0, n));
    assert.equal(res.ok, false, `length ${n}`);
    assert.equal(res.code, 'short');
    assert.equal(res.packet, undefined);
  }
});

test('garbled packets are rejected, not misparsed', () => {
  const badMagic = examplePacket(); badMagic[0] = 0xa7;   // a pod packet's magic
  assert.equal(parseShotSummary(badMagic).code, 'magic');

  const badVer = examplePacket(); badVer[1] = 2;
  assert.equal(parseShotSummary(badVer).code, 'version');

  const long = Uint8Array.from([...examplePacket(), 0x00]);
  assert.equal(parseShotSummary(long).code, 'length');

  const noise = Uint8Array.from({ length: 42 }, (_, i) => (i * 73 + 11) & 0xff);
  assert.equal(parseShotSummary(noise).ok, false);

  assert.equal(parseShotSummary('5a01').ok, false);
  assert.equal(parseShotSummary(null).ok, false);
});

test('accepts a DataView at an offset (Web Bluetooth gives a DataView)', () => {
  const backing = new Uint8Array(50);
  backing.set(examplePacket(), 5);
  const res = parseShotSummary(new DataView(backing.buffer, 5, 42));
  assert.equal(res.ok, true);
  assert.equal(res.packet.shotSeq, 3);
});

test('the demo encoder produces the firmware bytes exactly', () => {
  const parsed = parseShotSummary(examplePacket()).packet;
  const out = encodeShotSummary({
    shotSeq: parsed.shotSeq, impactMs: parsed.impactMs, readings: parsed.readings,
    groundMv: parsed.battery.groundMv, podMv: parsed.battery.podMv,
  });
  assert.deepEqual([...out], [...examplePacket()]);
});

test('unit conversions', () => {
  assert.equal(convertSpeed(0.44704, 'mph'), 1);
  assert.ok(Math.abs(convertSpeed(44.704, 'mph') - 100) < 1e-9);
  assert.equal(convertSpeed(10, 'kmh'), 36);
  assert.equal(convertSpeed(12.5, 'mps'), 12.5);
  assert.equal(convertSpeed(null, 'mph'), null);
  assert.equal(convertSpeed(NaN, 'mph'), null);
  assert.throws(() => convertSpeed(1, 'knots'));

  const p = parseShotSummary(examplePacket()).packet;
  assert.equal(formatReading(p.readings.ball_speed_radial, 'mph'), '137');   // 61.2 m/s = 136.9 mph
  assert.equal(formatReading(p.readings.ball_speed_radial, 'mps'), '61.2');
  assert.equal(formatReading(p.readings.ball_speed_radial, 'kmh'), '220');   // 220.3 km/h
  assert.equal(formatReading(p.readings.club_speed_radial, 'mph'), '98');    // 98.2 mph
  assert.equal(formatReading(p.readings.smash, 'kmh'), '1.39', 'smash is unitless');
  assert.equal(formatReading(p.readings.tempo_ratio, 'mph'), '3.0');
});

test('session stats count refusals and never fill them in', () => {
  const a = parseShotSummary(examplePacket()).packet;
  const bBytes = examplePacket(); bBytes.set(NAN32, 8); bBytes[12] = 0; bBytes[13] = 5;
  const b = parseShotSummary(bBytes).packet;
  const s = sessionStats([a, b], 'ball_speed_radial');
  assert.equal(s.n, 1);
  assert.equal(s.refused, 1);
  assert.equal(s.total, 2);
  assert.equal(s.mean, Math.fround(61.2));
  assert.equal(sessionStats([], 'smash').mean, null);
});

test('duplicate detection is by the whole packet', () => {
  const a = parseShotSummary(examplePacket()).packet;
  const b = parseShotSummary(examplePacket()).packet;
  const c = examplePacket(); c[2] = 4;
  assert.equal(isSameShot(a, b), true);
  assert.equal(isSameShot(a, parseShotSummary(c).packet), false);
});

test('CSV keeps the units sent, the provenance, the refusals and the raw packet', () => {
  const p = parseShotSummary(examplePacket()).packet;
  const csv = toCsv([{ index: 1, receivedAt: '2026-11-05T10:00:00.000Z', via: 'notify', demo: false, packet: p }]);
  const [head, row] = csv.trim().split('\r\n');
  assert.equal(head, CSV_COLUMNS.join(','));
  const cells = row.split(',');
  const col = (name) => cells[CSV_COLUMNS.indexOf(name)];
  assert.equal(col('ball_speed_radial_mps'), '61.2');
  assert.equal(col('ball_speed_radial_provenance'), 'low_confidence');
  assert.equal(col('club_speed_radial_mps'), '43.9');
  assert.equal(col('smash_ratio'), '1.394');
  assert.equal(col('peak_shaft_rate_degps'), '');
  assert.equal(col('peak_shaft_rate_refusal_code'), '10');
  assert.match(row, /gyro at full scale \(2000 dps\) during the downswing/);
  assert.equal(col('packet_hex'), Buffer.from(examplePacket()).toString('hex'));
  assert.equal(col('data'), 'STEM-RADAR on-device preview');

  const demo = toCsv([{ index: 1, receivedAt: 'x', via: 'demo', demo: true, packet: p }]);
  assert.match(demo, /DEMO synthetic, not a measurement/);
});

test('float32Text gives the shortest round-trip text', () => {
  assert.equal(float32Text(Math.fround(61.2)), '61.2');
  assert.equal(float32Text(Math.fround(1.394)), '1.394');
  assert.equal(float32Text(NaN), '');
});

test('every refusal code in enum class Refusal has its text (ground_unit.ino:230-263)', () => {
  assert.equal(Object.keys(REFUSAL).length, 13);
  assert.equal(REFUSAL[12], 'depends on a refused reading');
});

test('podAtShot reads only the IMU refusal codes', () => {
  const base = examplePacket();                       // peak refused 10 (needs pod samples), tempo ok
  assert.equal(podAtShot(parseShotSummary(base).packet), 'data');
  const imu = (code) => {
    const b = examplePacket();
    for (const o of [26, 32]) { b.set(NAN32, o); b[o + 4] = 0; b[o + 5] = code; }
    return parseShotSummary(b).packet;
  };
  assert.equal(podAtShot(imu(8)), 'not_connected');
  assert.equal(podAtShot(imu(9)), 'no_samples');
  assert.equal(podAtShot(imu(3)), null, 'no impact: the IMU analysis never ran');
});
