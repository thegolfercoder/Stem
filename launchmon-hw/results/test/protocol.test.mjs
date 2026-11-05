// Tests for results/protocol.js. Node built-ins only:
//   cd launchmon-hw/results && node --test     (or npm test; no dependencies)
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
import { readFileSync } from 'node:fs';
import {
  parseShotSummary, encodeShotSummary, convertSpeed, formatReading, sessionStats, toCsv, CSV_COLUMNS,
  float32Text, isSameShot, podAtShot, PACKET_BYTES, SERVICE_UUID, SHOT_CHAR_UUID, DEVICE_NAME, REFUSAL,
  parseUnitStatus, encodeUnitStatus, describePod, describeDock, STATUS_CHAR_UUID, STATUS_BYTES,
  DOCK_REASON, DOCK_STATE,
} from '../protocol.js';
import { DemoFeed, demoWorld } from '../demo.js';

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

// ---- UnitStatus (ground firmware 0.3) -------------------------------------------
//   ground_unit.ino  struct __attribute__((packed)) UnitStatus {
//     uint8_t magic = 0x5B, version = 1; uint8_t fw_major, fw_minor; uint32_t uptime_ms;
//     uint16_t battery_mv_ground, battery_mv_pod;
//     uint8_t pod_flags, unit_flags, dock_state, dock_reason;
//     uint16_t dock_retry_s, shot_seq; };                       static_assert(sizeof(UnitStatus) == 20)
// Built here byte by byte, not with encodeUnitStatus.

const FW = readFileSync(new URL('../../firmware/ground_unit/ground_unit.ino', import.meta.url), 'utf8');

// pod_flags bits (namespace podflag) and unit_flags bits (namespace unitflag), spelled out.
const PF = { CONNECTED: 0x01, POWER_KNOWN: 0x02, DOCK_POWER: 0x04, USB_HOST: 0x08, CHARGING: 0x10, CHARGED: 0x20, PARKED: 0x40, CHARGED_ASLEEP: 0x80 };
const UF = { DOCK_FITTED: 0x01, BUZZER_FITTED: 0x02, BUZZER_ON: 0x04, USER_ARMED: 0x08, RAW_STREAMING: 0x10, BATT_LOW: 0x20, ADC_FAULT: 0x40 };

function statusBytes({
  magic = 0x5b, version = 1, fwMajor = 0, fwMinor = 3, uptime = 0x01020304, ground = 3991, pod = 3954,
  podFlags = PF.CONNECTED | PF.POWER_KNOWN, unitFlags = UF.DOCK_FITTED | UF.BUZZER_FITTED | UF.BUZZER_ON | UF.USER_ARMED,
  dockState = 0, dockReason = 0, retry = 0, shotSeq = 0x0203,
} = {}) {
  return Uint8Array.from([
    ...u8(magic), ...u8(version), ...u8(fwMajor), ...u8(fwMinor),   // 0..3
    ...u32le(uptime),                                                // 4
    ...u16le(ground), ...u16le(pod),                                 // 8, 10
    ...u8(podFlags), ...u8(unitFlags), ...u8(dockState), ...u8(dockReason),   // 12..15
    ...u16le(retry), ...u16le(shotSeq),                              // 16, 18
  ]);
}
const parsed = (o) => {
  const r = parseUnitStatus(statusBytes(o));
  assert.equal(r.ok, true, r.error);
  return r.status;
};

test('status: UUID, magic, size and reason texts match the firmware source', () => {
  assert.equal(STATUS_CHAR_UUID, '7d2a0103-5b1c-4f6e-9c1e-3a6f1f0c2b10');
  assert.match(FW, /UUID_GND_STATUS = "7d2a0103-5b1c-4f6e-9c1e-3a6f1f0c2b10"/);
  assert.match(FW, /struct __attribute__\(\(packed\)\) UnitStatus \{\s*uint8_t  magic = 0x5B, version = 1;/);
  assert.match(FW, /static_assert\(sizeof\(UnitStatus\) == 20,/);
  assert.equal(STATUS_BYTES, 20);
  assert.equal(statusBytes().length, 20);
  // dockReasonText(): every case, in enum order, word for word.
  const body = FW.slice(FW.indexOf('static const char* dockReasonText'), FW.indexOf('static void dockReport'));
  const texts = [...body.matchAll(/case DockReason::\w+: return "([^"]*)";/g)].map((m) => m[1]);
  assert.deepEqual(texts, Object.keys(DOCK_REASON).map((k) => DOCK_REASON[k]));
  assert.match(FW, /enum class DockState : uint8_t \{ OFF, CONFIRMING, CHARGING, LOCKOUT, LOW_BATTERY \};/);
  assert.deepEqual(Object.values(DOCK_STATE), ['off', 'confirming', 'charging', 'fault', 'low_battery']);
  // Flag bits as the firmware defines them.
  for (const [name, bit] of Object.entries(PF)) assert.match(FW, new RegExp(`constexpr uint8_t ${name}\\s*= 1 << ${Math.log2(bit)};`), name);
  for (const [name, bit] of Object.entries(UF)) assert.match(FW, new RegExp(`constexpr uint8_t ${name}\\s*= 1 << ${Math.log2(bit)};`), name);
});

test('status: every field at its offset, little-endian', () => {
  const s = parsed({ fwMajor: 1, fwMinor: 7, uptime: 0x0a0b0c0d, ground: 0x0f9e, pod: 0x0e81, shotSeq: 0x1234,
    podFlags: PF.CONNECTED | PF.POWER_KNOWN | PF.DOCK_POWER | PF.CHARGING | PF.PARKED,
    unitFlags: UF.DOCK_FITTED | UF.USER_ARMED | UF.RAW_STREAMING, dockState: 2, dockReason: 1 });
  assert.equal(s.version, 1);
  assert.deepEqual(s.fw, { major: 1, minor: 7, text: '1.7' });
  assert.equal(s.uptimeMs, 0x0a0b0c0d);
  assert.equal(s.unit.batteryMv, 3998);
  assert.equal(s.pod.batteryMv, 3713);
  assert.equal(s.shotSeq, 0x1234);
  assert.deepEqual(s.pod, { connected: true, powerKnown: true, dockPower: true, usbHost: false, charging: true,
    charged: false, parked: true, chargedAsleep: false, batteryMv: 3713, batteryKnown: true });
  assert.equal(s.unit.dockFitted, true);
  assert.equal(s.unit.buzzerFitted, false);
  assert.equal(s.unit.userArmed, true);
  assert.equal(s.unit.rawStreaming, true);
  assert.equal(s.unit.adcFault, false);
  assert.deepEqual(s.dock, { fitted: true, stateCode: 2, state: 'charging', reasonCode: 1, reason: 'pod parked', retryS: 0 });
  assert.deepEqual(s.anomalies, []);
  assert.equal(s.hex, Buffer.from(statusBytes({ fwMajor: 1, fwMinor: 7, uptime: 0x0a0b0c0d, ground: 0x0f9e, pod: 0x0e81, shotSeq: 0x1234,
    podFlags: PF.CONNECTED | PF.POWER_KNOWN | PF.DOCK_POWER | PF.CHARGING | PF.PARKED,
    unitFlags: UF.DOCK_FITTED | UF.USER_ARMED | UF.RAW_STREAMING, dockState: 2, dockReason: 1 })).toString('hex'));
});

test('status: the demo encoder produces the firmware bytes exactly', () => {
  const o = { uptime: 98765, ground: 3870, pod: 4102, podFlags: PF.CONNECTED | PF.POWER_KNOWN | PF.DOCK_POWER | PF.CHARGED | PF.PARKED,
    unitFlags: UF.DOCK_FITTED | UF.BUZZER_FITTED, dockState: 3, dockReason: 3, retry: 27, shotSeq: 41 };
  const out = encodeUnitStatus({ fwMajor: 0, fwMinor: 3, uptimeMs: o.uptime, groundMv: o.ground, podMv: o.pod, podFlags: o.podFlags,
    unitFlags: o.unitFlags, dockState: o.dockState, dockReason: o.dockReason, dockRetryS: o.retry, shotSeq: o.shotSeq });
  assert.deepEqual([...out], [...statusBytes(o)]);
});

test('status: battery thresholds as the unit uses them', () => {
  assert.equal(parsed({ ground: 3499 }).unit.batteryLow, true);
  assert.equal(parsed({ ground: 3500 }).unit.batteryLow, false);
  assert.equal(parsed({ ground: 1000 }).unit.batteryKnown, false, '<= 1000 mV is "not read"');
  assert.equal(parsed({ ground: 1000 }).unit.batteryLow, false);
  const noPod = parsed({ podFlags: 0, pod: 0 });
  assert.equal(noPod.pod.batteryKnown, false);
  assert.equal(noPod.pod.connected, false);
});

test('status: the pod in a word, for every state the firmware can send', () => {
  const linked = PF.CONNECTED | PF.POWER_KNOWN;
  const onDock = linked | PF.DOCK_POWER | PF.PARKED;
  const cases = [
    [{ podFlags: linked }, 'connected'],
    [{ podFlags: PF.CONNECTED }, 'connected'],                          // pod firmware before 0.2: no power fields
    [{ podFlags: onDock | PF.CHARGING }, 'charging'],
    [{ podFlags: onDock | PF.CHARGED }, 'charged'],
    [{ podFlags: onDock }, 'parked'],
    [{ podFlags: PF.CONNECTED | PF.PARKED }, 'parked'],                 // dock charging, old pod
    [{ podFlags: linked | PF.USB_HOST }, 'usb'],
    [{ podFlags: PF.PARKED | PF.CHARGED_ASLEEP, pod: 0 }, 'charged_asleep'],
    [{ podFlags: PF.PARKED, pod: 0 }, 'parked_no_link'],
    [{ podFlags: 0, pod: 0 }, 'not_connected'],
  ];
  for (const [o, key] of cases) assert.equal(describePod(parsed(o)).key, key, JSON.stringify(o));
  assert.equal(describePod(parsed({ podFlags: onDock | PF.CHARGING })).text, 'charging');
  assert.equal(parsed({ podFlags: PF.CONNECTED }).pod.powerKnown, false);
});

test('status: dock states and reasons; the countdown only in a fault', () => {
  assert.equal(describeDock(parsed({ dockState: 0 })), null);
  assert.equal(describeDock(parsed({ dockState: 1 })), null, 'confirming: nothing to say yet');
  assert.equal(describeDock(parsed({ dockState: 2, dockReason: 1 })), null, 'charging: the pod says it');
  const fault = parsed({ dockState: 3, dockReason: 3, retry: 30 });
  assert.equal(fault.dock.state, 'fault');
  assert.equal(fault.dock.retryS, 30);
  assert.deepEqual(describeDock(fault), { key: 'fault', text: 'fault · retry 30 s', detail: 'overload: DOCK+ sagged with the switch on' });
  assert.equal(describeDock(fault, 12).text, 'fault · retry 12 s', 'the page counts down from the value\'s age');
  assert.equal(describeDock(fault, 0).text, 'fault · retrying');
  const low = parsed({ dockState: 4, dockReason: 5 });
  assert.equal(describeDock(low).key, 'low_battery');
  assert.equal(low.dock.reason, 'ground unit battery low');
  assert.equal(parsed({ dockReason: 8 }).dock.reason, 'fault lockout over: looking for a pod again');
  const unknownReason = parsed({ dockReason: 77 });
  assert.match(unknownReason.dock.reason, /code 77/);
  assert.ok(unknownReason.anomalies.length);
  const unknownState = parsed({ dockState: 9 });
  assert.equal(unknownState.dock.state, 'unknown');
  assert.equal(describeDock(unknownState).key, 'unknown');
  const notFitted = parsed({ unitFlags: UF.USER_ARMED });
  assert.equal(notFitted.dock.state, 'not_fitted');
  assert.equal(describeDock(notFitted), null);
  assert.deepEqual(notFitted.anomalies, []);
});

test('status: contradictions the firmware never sends are flagged and read as unknown', () => {
  const check = (o, pattern, fn) => {
    const s = parsed(o);
    assert.ok(s.anomalies.some((a) => pattern.test(a)), `${JSON.stringify(o)} -> ${s.anomalies}`);
    fn(s);
  };
  check({ podFlags: PF.CONNECTED | PF.CHARGING | PF.DOCK_POWER }, /without power_known/, (s) => { assert.equal(s.pod.charging, false); assert.equal(s.pod.dockPower, false); });
  check({ podFlags: PF.POWER_KNOWN | PF.DOCK_POWER, pod: 0 }, /no pod link/, (s) => { assert.equal(s.pod.powerKnown, false); assert.equal(s.pod.dockPower, false); });
  check({ podFlags: PF.CONNECTED | PF.POWER_KNOWN | PF.DOCK_POWER | PF.CHARGING | PF.CHARGED }, /both charging and charged/, (s) => { assert.equal(s.pod.charging, false); assert.equal(s.pod.charged, false); });
  check({ podFlags: PF.CONNECTED | PF.POWER_KNOWN | PF.CHARGING }, /without dock power/, (s) => assert.equal(s.pod.charging, false));
  check({ podFlags: PF.CONNECTED | PF.CHARGED_ASLEEP }, /charged_asleep while linked/, (s) => assert.equal(s.pod.chargedAsleep, false));
  check({ podFlags: 0, pod: 3900 }, /battery with no pod link/, (s) => { assert.equal(s.pod.batteryMv, 0); assert.equal(s.pod.batteryKnown, false); });
  check({ unitFlags: UF.DOCK_FITTED | 0x80 }, /bit 7/, () => {});
  check({ unitFlags: UF.BUZZER_ON }, /buzzer on but not fitted/, (s) => assert.equal(s.unit.buzzerOn, false));
  check({ unitFlags: 0, dockState: 2 }, /built without the dock/, (s) => assert.equal(s.dock.state, 'not_fitted'));
  check({ dockState: 0, retry: 5 }, /countdown outside a fault/, (s) => assert.equal(s.dock.retryS, 0));
});

test('status: short, long and garbled values are rejected whole', () => {
  const full = statusBytes();
  for (const n of [0, 1, 4, 12, 19]) {
    const r = parseUnitStatus(full.slice(0, n));
    assert.equal(r.ok, false, `length ${n}`);
    assert.equal(r.code, 'short');
    assert.equal(r.status, undefined);
  }
  assert.equal(parseUnitStatus(Uint8Array.from([...full, 0])).code, 'length');
  assert.equal(parseUnitStatus(statusBytes({ magic: 0x5a })).code, 'magic', 'a ShotSummary magic');
  assert.equal(parseUnitStatus(statusBytes({ magic: 0xa7 })).code, 'magic', 'a pod packet magic');
  assert.equal(parseUnitStatus(statusBytes({ version: 2 })).code, 'version');
  assert.equal(parseUnitStatus(statusBytes({ version: 0 })).code, 'version');
  const noise = Uint8Array.from({ length: 20 }, (_, i) => (i * 97 + 3) & 0xff);
  assert.equal(parseUnitStatus(noise).ok, false);
  assert.equal(parseUnitStatus(null).ok, false);
  assert.equal(parseUnitStatus('5b01').ok, false);
  // The two characteristics cannot be mistaken for each other.
  assert.equal(parseUnitStatus(examplePacket()).ok, false, 'a shot summary is not a status');
  assert.equal(parseShotSummary(statusBytes()).code, 'short', 'a status is not a shot summary');
});

test('status: accepts a DataView at an offset', () => {
  const backing = new Uint8Array(30);
  backing.set(statusBytes({ shotSeq: 9 }), 7);
  const r = parseUnitStatus(new DataView(backing.buffer, 7, 20));
  assert.equal(r.ok, true);
  assert.equal(r.status.shotSeq, 9);
});

test('demo: two full cycles of statuses and shots parse cleanly and agree', () => {
  const statuses = [], shots = [];
  const feed = new DemoFeed((dv) => shots.push(parseShotSummary(dv)), (dv) => statuses.push(parseUnitStatus(dv)));
  feed.status(true);
  for (let i = 0; i < 180; i++) feed.tick();          // 180 demo seconds, no timers
  assert.ok(statuses.length > 10 && shots.length > 30);
  for (const r of [...statuses, ...shots]) assert.equal(r.ok, true, r.error);
  for (const r of statuses) assert.deepEqual(r.status.anomalies, [], r.status.hex);
  const keys = new Set(statuses.map((r) => describePod(r.status).key));
  for (const k of ['connected', 'charging', 'charged', 'charged_asleep']) assert.ok(keys.has(k), k);
  assert.ok(statuses.some((r) => describeDock(r.status)?.key === 'fault'));
  // A shot while the pod is parked has no pod data at impact, as on the unit.
  const parkedAt = (t) => !demoWorld(t).podOnClub;
  assert.equal(parkedAt(30), true);
  assert.equal(demoWorld(30).phase, 'charging');
  assert.ok(shots.some((r) => r.packet.readings.peak_shaft_rate.refusalCode === 9));
  // The status names the last shot sent.
  assert.equal(statuses[statuses.length - 1].status.shotSeq <= shots[shots.length - 1].packet.shotSeq, true);
});
