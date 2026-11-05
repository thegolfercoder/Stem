// Stem results screen: Web Bluetooth link to the ground unit, rendering, session.
// Packet parsing lives in protocol.js; this file only moves bytes and draws.

import * as P from './protocol.js';
import { DemoFeed } from './demo.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode: no persistence */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

const UNIT_KEY = 'stem.results.unit';
const SESSION_KEY = 'stem.results.session.v1';
const HISTORY_SHOWN = 20;
const CONNECT_TIMEOUT_MS = 15000;
const DASH = '–';
// The unit notifies its status at least every 30 s (and holds it back only
// during a capture or a pod swing). Two missed, and then some: call it stale.
const STATUS_STALE_MS = 75000;

const state = {
  unit: P.SPEED_UNITS[store.get(UNIT_KEY)] ? store.get(UNIT_KEY) : 'mph',
  support: detectSupport(),
  link: 'idle',            // idle | requesting | connecting | connected | reconnecting
  device: null,
  chr: null,
  statusChr: null,         // the live status characteristic; null on firmware 0.2 and older
  statusSupport: 'unknown', // unknown | yes | no (this unit has no live status)
  status: null,            // { status, receivedAt (ms), via, demo }: the latest parsed UnitStatus
  statusRejected: 0,
  lastStatusError: null,
  missedReadFor: null,     // shot_seq a status said exists and we have read for
  want: false,             // the user wants to stay connected
  attempt: 0,
  retryTimer: null,
  real: [],                // { index, receivedAt, via, demo:false, packet }
  demo: [],                // the same, demo only; never exported, never stored
  demoFeed: null,
  rejected: 0,
  wake: null,
  noticeOpen: false,
  messageTimer: null,
};

function detectSupport() {
  const ua = navigator.userAgent || '';
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!window.isSecureContext) return { ok: false, why: 'insecure', ios };
  if (!navigator.bluetooth) return { ok: false, why: 'nobt', ios };
  return { ok: true, ios };
}

const shots = () => (state.demoFeed ? state.demo : state.real);
const latest = () => shots()[shots().length - 1] || null;

// ---- Messages -----------------------------------------------------------------
function say(text, bad = false, ms = 9000) {
  const el = $('message');
  el.textContent = text;
  el.classList.toggle('bad', bad);
  clearTimeout(state.messageTimer);
  if (ms) state.messageTimer = setTimeout(() => { el.textContent = ''; }, ms);
}

// ---- Bluetooth ----------------------------------------------------------------
function withTimeout(promise, ms, what) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, reject) => { t = setTimeout(() => reject(new Error(`${what} timed out`)), ms); }),
  ]).finally(() => clearTimeout(t));
}

async function connect() {
  if (!state.support.ok) { openNotice(); return; }
  if (state.demoFeed) stopDemo();
  setLink('requesting');
  let device;
  try {
    device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [P.SERVICE_UUID] }, { name: P.DEVICE_NAME }],
      optionalServices: [P.SERVICE_UUID],
    });
  } catch (e) {
    setLink('idle');
    if (e && e.name === 'NotFoundError') say('No unit chosen. Switch the unit on, then tap Connect and pick STEM-RADAR.');
    else say(`Could not open the Bluetooth chooser: ${errText(e)}`, true);
    return;
  }
  if (state.device && state.device !== device) state.device.removeEventListener('gattserverdisconnected', onDisconnected);
  state.device = device;
  device.addEventListener('gattserverdisconnected', onDisconnected);
  state.want = true;
  state.attempt = 0;
  try {
    await openGatt();
  } catch (e) {
    say(`Could not connect: ${errText(e)}. Retrying.`, true);
    scheduleReconnect();
  }
}

async function openGatt() {
  const device = state.device;
  setLink(state.attempt ? 'reconnecting' : 'connecting');
  const server = await withTimeout(device.gatt.connect(), CONNECT_TIMEOUT_MS, 'Connecting');
  const svc = await server.getPrimaryService(P.SERVICE_UUID);
  const chr = await svc.getCharacteristic(P.SHOT_CHAR_UUID);
  if (state.chr) state.chr.removeEventListener('characteristicvaluechanged', onNotify);
  chr.addEventListener('characteristicvaluechanged', onNotify);
  await chr.startNotifications();
  // Live status, ground firmware 0.3 and later. An older unit has no such
  // characteristic: the shots work the same, and the status row falls back to
  // what each shot carries.
  let statusChr = null;
  try { statusChr = await svc.getCharacteristic(P.STATUS_CHAR_UUID); } catch { statusChr = null; }
  if (state.statusChr) state.statusChr.removeEventListener('characteristicvaluechanged', onStatusNotify);
  if (statusChr) {
    statusChr.addEventListener('characteristicvaluechanged', onStatusNotify);
    try { await statusChr.startNotifications(); } catch { /* still readable; the row goes stale without updates */ }
  }
  if (!state.want) { device.gatt.disconnect(); return; }
  state.chr = chr;
  state.statusChr = statusChr;
  state.statusSupport = statusChr ? 'yes' : 'no';
  state.attempt = 0;
  setLink('connected');
  wakeOn();
  renderDevice();
  // The characteristic is readable too: it holds the last shot the unit
  // analysed, which may be from before this connection (or one missed while
  // disconnected). Empty until the unit's first shot since boot.
  try {
    const v = await chr.readValue();
    if (v.byteLength > 0) handleValue(v, 'read on connect');
  } catch { /* nothing to read yet */ }
  // Then the status, which is always there. After the shot, so a status that
  // names that shot finds it already held.
  if (statusChr) {
    try { handleStatus(await statusChr.readValue(), 'read on connect'); } catch { /* the next notification brings it */ }
  }
}

function onNotify(ev) { handleValue(ev.target.value, 'notify'); }
function onStatusNotify(ev) { handleStatus(ev.target.value, 'notify'); }

// What the unit said live is not known once the link is gone.
function dropStatus() {
  if (state.statusChr) state.statusChr.removeEventListener('characteristicvaluechanged', onStatusNotify);
  state.statusChr = null;
  state.status = null;
  state.missedReadFor = null;
}

function onDisconnected() {
  if (state.chr) state.chr.removeEventListener('characteristicvaluechanged', onNotify);
  state.chr = null;
  dropStatus();
  renderDevice();
  if (state.want) {
    say('Lost the unit. Reconnecting.', true);
    scheduleReconnect();
  } else {
    setLink('idle');
    wakeOff();
  }
}

function scheduleReconnect() {
  clearTimeout(state.retryTimer);
  if (!state.want || !state.device) { setLink('idle'); return; }
  state.attempt += 1;
  setLink('reconnecting');
  const delay = Math.min(30000, 1000 * 2 ** Math.min(state.attempt - 1, 5));
  state.retryTimer = setTimeout(async () => {
    if (!state.want) return;
    try { await openGatt(); } catch { scheduleReconnect(); }
  }, delay);
}

function disconnect() {
  state.want = false;
  clearTimeout(state.retryTimer);
  if (state.device && state.device.gatt.connected) state.device.gatt.disconnect();
  state.chr = null;
  dropStatus();
  state.statusSupport = 'unknown';
  setLink('idle');
  renderDevice();
  wakeOff();
}

function errText(e) { return (e && (e.message || e.name)) || String(e); }

// ---- Packets ------------------------------------------------------------------
async function handleValue(dataView, via) {
  const res = P.parseShotSummary(dataView);
  if (!res.ok) {
    // A notification is cut to the link's MTU minus 3 bytes. If the phone did
    // not negotiate a larger MTU, 42 bytes arrive as 20; a read is not cut
    // (long reads), so fetch the whole value instead of guessing the rest.
    if (res.code === 'short' && via === 'notify' && state.chr) {
      try {
        const v = await state.chr.readValue();
        say(`A notification arrived cut to ${res.length} of ${P.PACKET_BYTES} bytes; read the full shot instead.`);
        return handleValue(v, 'read (notification cut short)');
      } catch (e) {
        say(`Notification cut to ${res.length} bytes and the read failed (${errText(e)}). Shot not shown.`, true);
      }
    } else {
      say(`Packet rejected, not shown: ${res.error}.`, true);
    }
    state.rejected += 1;
    renderSession();
    return;
  }
  addShot(res.packet, via, false);
}

// One UnitStatus value, from a notification, a read or the demo.
function handleStatus(dataView, via, demo = false) {
  const res = P.parseUnitStatus(dataView);
  if (!res.ok) {
    // Rejected whole. The last good status stays on screen and goes stale.
    state.statusRejected += 1;
    if (res.error !== state.lastStatusError) say(`Unit status rejected, not shown: ${res.error}.`, true);
    state.lastStatusError = res.error;
    renderDevice();
    return;
  }
  state.lastStatusError = null;
  const st = res.status;
  const prev = state.status && state.status.status;
  if (st.anomalies.length && (!prev || prev.hex !== st.hex)) {
    say(`Unit status carried an unexpected combination (${st.anomalies.join('; ')}); that part is shown as unknown.`, true);
  }
  if (prev && !demo && st.uptimeMs < prev.uptimeMs) say('The unit restarted.');
  state.status = { status: st, receivedAt: Date.now(), via, demo };
  renderDevice();
  if (!demo) readMissedShot(st.shotSeq);
}

// The status names the unit's last shot. If this session does not hold it (a
// lost notification, or one cut short whose read failed), read it once.
async function readMissedShot(seq) {
  const last = state.real[state.real.length - 1];
  if (!seq || !state.chr || (last && last.packet.shotSeq === seq) || state.missedReadFor === seq) return;
  state.missedReadFor = seq;
  try {
    const v = await state.chr.readValue();
    if (v.byteLength > 0) handleValue(v, 'read (notification missed)');
  } catch { /* the next shot's notification comes as usual */ }
}

function addShot(packet, via, demo) {
  const list = demo ? state.demo : state.real;
  if (list.some((e) => P.isSameShot(e.packet, packet))) return;   // a read repeating a shot already held
  list.push({ index: list.length + 1, receivedAt: new Date().toISOString(), via, demo, packet });
  if (!demo) persist();
  const odd = Object.values(packet.readings).find((r) => r.anomaly);
  if (odd) say(`Shot ${packet.shotSeq}: ${odd.key} carried an unexpected combination (${odd.anomaly}); shown as no reading.`, true);
  render();
  const shot = $('shot');
  shot.classList.remove('flash');
  void shot.offsetWidth;
  shot.classList.add('flash');
}

function persist() {
  store.set(SESSION_KEY, JSON.stringify(state.real.map((e) => ({ t: e.receivedAt, via: e.via, hex: e.packet.hex }))));
}

function restore() {
  let saved;
  try { saved = JSON.parse(store.get(SESSION_KEY) || '[]'); } catch { saved = []; }
  if (!Array.isArray(saved)) return;
  for (const s of saved) {
    if (!s || typeof s.hex !== 'string' || !/^[0-9a-f]*$/.test(s.hex)) continue;
    const bytes = Uint8Array.from(s.hex.match(/../g) || [], (h) => parseInt(h, 16));
    const res = P.parseShotSummary(bytes);   // stored as raw bytes, re-read by the same parser
    if (res.ok) state.real.push({ index: state.real.length + 1, receivedAt: s.t, via: s.via, demo: false, packet: res.packet });
  }
  if (state.real.length) say(`Restored this browser's session: ${state.real.length} shot${state.real.length === 1 ? '' : 's'}. Tap New to start again.`);
}

// ---- Wake lock ----------------------------------------------------------------
async function wakeOn() {
  if (!('wakeLock' in navigator) || state.wake || document.visibilityState !== 'visible') return;
  try {
    const lock = await navigator.wakeLock.request('screen');
    state.wake = lock;
    lock.addEventListener('release', () => { if (state.wake === lock) state.wake = null; renderAwake(); });
  } catch { state.wake = null; }
  renderAwake();
}
function wakeOff() {
  if (state.wake) { const l = state.wake; state.wake = null; l.release().catch(() => {}); }
  renderAwake();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && (state.link === 'connected' || state.link === 'reconnecting')) wakeOn();
});

// ---- Demo ---------------------------------------------------------------------
function startDemo() {
  if (state.link !== 'idle') { say('Disconnect from the unit before starting the demo.'); return; }
  state.demo = [];
  state.status = null;
  state.noticeOpen = false;
  document.body.classList.add('is-demo');
  state.demoFeed = new DemoFeed((dv) => {
    const res = P.parseShotSummary(dv);        // the real parsers, on synthetic bytes
    if (res.ok) addShot(res.packet, 'demo', true);
    else say(`Demo packet rejected: ${res.error}`, true);
  }, (dv) => handleStatus(dv, 'demo', true));
  render();
  state.demoFeed.start({ prefill: 5 });
}

function stopDemo() {
  if (!state.demoFeed) return;
  state.demoFeed.stop();
  state.demoFeed = null;
  state.demo = [];
  state.status = null;
  document.body.classList.remove('is-demo');
  render();
}

// ---- CSV ------------------------------------------------------------------------
function exportCsv() {
  if (state.demoFeed) { say('Demo data is synthetic and is never exported.'); return; }
  if (!state.real.length) return;
  const csv = P.toCsv(state.real);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const a = document.createElement('a');
  a.href = url;
  a.download = `stem-session-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  say(`Exported ${state.real.length} shot${state.real.length === 1 ? '' : 's'} as CSV.`);
}

function newSession() {
  if (state.demoFeed || !state.real.length) return;
  if (!window.confirm(`Clear this session's ${state.real.length} shots? Export them first if you want to keep them.`)) return;
  state.real = [];
  state.rejected = 0;
  store.del(SESSION_KEY);
  render();
}

// ---- Rendering ------------------------------------------------------------------
function setLink(s) { state.link = s; renderLink(); }

function renderLink() {
  const link = $('link');
  const btn = $('connect');
  let text, dot = state.link;
  switch (state.link) {
    case 'requesting': text = `Choose ${P.DEVICE_NAME}…`; dot = 'connecting'; break;
    case 'connecting': text = 'Connecting…'; break;
    case 'connected': text = `Connected · ${(state.device && state.device.name) || P.DEVICE_NAME}`; break;
    case 'reconnecting': text = `Reconnecting… try ${state.attempt}`; break;
    default:
      if (state.demoFeed) { text = state.support.ok ? 'Demo running' : 'Demo · no Web Bluetooth here'; dot = 'demo'; }
      else if (!state.support.ok) { text = 'No Web Bluetooth'; dot = 'unsupported'; }
      else text = 'Not connected';
  }
  link.dataset.state = dot;
  $('link-text').textContent = text;
  link.classList.toggle('has-info', !state.support.ok);
  link.setAttribute('aria-label', state.support.ok ? text : `${text}. Show why.`);

  btn.disabled = state.link === 'requesting';
  btn.textContent = { connecting: 'Cancel', connected: 'Disconnect', reconnecting: 'Stop', requesting: 'Connect' }[state.link] || 'Connect';
  btn.classList.toggle('primary', state.link === 'idle');
  $('demo').disabled = state.link !== 'idle';
}

function readingText(r) {
  if (!r) return { value: DASH, note: '', none: false };
  const v = P.formatReading(r, state.unit);
  if (v === null) return { value: DASH, note: r.reason, none: true };
  return { value: v, note: P.provenanceLabel(r.provenance), none: false };
}

function renderShot() {
  const e = latest();
  const shot = $('shot');
  shot.classList.toggle('show-notice', state.noticeOpen);
  $('notice').hidden = !state.noticeOpen;
  const unitLabel = P.SPEED_UNITS[state.unit].label;

  for (const el of shot.querySelectorAll('.metric, .extra')) {
    const r = e ? e.packet.readings[el.dataset.key] : null;
    const t = readingText(r);
    let value = t.value;
    if (el.classList.contains('extra') && r && r.ok) value += el.dataset.key === 'tempo_ratio' ? ' : 1' : ' °/s';
    el.querySelector('[data-value]').textContent = value;
    const why = el.querySelector('[data-why]');   // extras: provenance on top, reason beside the dash
    if (why) {
      el.querySelector('[data-note]').textContent = t.none ? '' : t.note;
      why.textContent = t.none ? t.note : '';
    } else {
      el.querySelector('[data-note]').textContent = t.note || ' ';
    }
    el.classList.toggle('is-none', t.none);
    el.classList.toggle('is-empty', !r);
    const u = el.querySelector('[data-unit]');
    if (u) u.textContent = unitLabel;
  }

  const title = $('shot-title');
  if (!e) title.textContent = state.demoFeed ? 'Demo starting' : 'Waiting for a shot';
  else {
    const time = new Date(e.receivedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    title.textContent = `Shot ${e.packet.shotSeq} · ${e.via === 'read on connect' ? 'before connecting' : time}`;
  }
  $('shot-tag').textContent = state.demoFeed
    ? 'DEMO · synthetic, not a measurement'
    : 'Unit’s on-device preview · radial';
}

function volts(mv) { return `${(mv / 1000).toFixed(2)} V`; }

// One status item: text in <b>, and optionally a second word in its own
// colour ("3.95 V · charging").
function setDev(el, text, cls = '', word = null, wordCls = '') {
  el.textContent = text;
  el.className = cls;
  if (word) {
    const w = document.createElement('span');
    w.className = `word ${wordCls}`.trim();
    w.textContent = word;
    if (text) el.append(' \u00b7 ');
    el.append(w);
  }
}

const POD_TITLES = {
  connected: 'Linked to the unit and not on the dock: the unit treats it as on the club and arms on its swings.',
  charging: 'Parked on the unit and charging from its contacts. Charging and charged are the pod\u2019s own estimates from its cell voltage.',
  charged: 'Parked and charged (the pod\u2019s estimate). It goes to sleep on the dock a minute after.',
  charged_asleep: 'The pod reported charged, then went to sleep on the dock. The contacts are still live. Lift it to wake it.',
  parked: 'On the dock, with no charge estimate from the pod.',
  parked_no_link: 'The unit\u2019s contacts are powering a parked pod that has no Bluetooth link: asleep, or its cell too low to run it.',
  usb: 'The pod\u2019s own USB-C is on a computer. The unit keeps its contacts off meanwhile.',
  not_connected: 'No Bluetooth link to a pod.',
};

function renderDevice() {
  const e = latest();
  const live = state.status;
  const g = $('batt-ground'), p = $('batt-pod'), s = $('pod-state'), d = $('dock-state'), src = $('dev-src');
  for (const el of [g, p, s, d]) { el.className = ''; el.title = ''; }
  src.className = 'dev-src';
  src.title = '';

  // Pod data at the shot, from its IMU readings. Shown only without a live
  // status: with one, the live row gives the link and the shot's own IMU
  // reasons are in the panel above.
  $('dev-shotpod').hidden = !!live;
  if (e) {
    const pod = P.podAtShot(e.packet);
    s.textContent = { data: 'yes', no_samples: 'none at impact', not_connected: 'not connected' }[pod] || 'unknown';
    if (pod !== 'data') s.className = 'unknown';
    s.title = `Whether the pod\u2019s samples covered shot ${e.packet.shotSeq}, from its IMU readings.`;
  } else {
    s.textContent = DASH;
  }

  if (live) { renderLiveStatus(live); return; }

  // No live status: a unit on firmware 0.2 or older, not connected, or not yet
  // received. Show what the latest shot carried, and say that is the source.
  $('dev-dock').hidden = true;
  const noLive = state.link === 'connected' && state.statusSupport === 'no';
  const note = noLive ? ' This unit\u2019s firmware (0.2 or older) sends no live status: values arrive only with a shot.' : '';
  if (!e) {
    g.textContent = p.textContent = DASH;
    src.textContent = noLive ? 'no live status' : '';
    src.title = note.trim();
    return;
  }
  const b = e.packet.battery, seq = e.packet.shotSeq;
  src.textContent = e.demo ? '' : `at shot ${seq}`;
  src.title = `Sent by the unit with shot ${seq}.${note}`;
  if (b.groundKnown) {
    g.textContent = `${volts(b.groundMv)}${b.groundLow ? ' low' : ''}`;
    if (b.groundLow) g.className = 'low';
    g.title = `Ground unit cell, sent with shot ${seq}${b.groundLow ? '; under the unit\u2019s 3.50 V low-battery level' : ''}.${note}`;
  } else {
    g.textContent = 'not read'; g.className = 'unknown';
    g.title = `The unit had no battery reading at shot ${seq}.${note}`;
  }
  if (b.podKnown) {
    p.textContent = volts(b.podMv);
    p.title = `The pod\u2019s cell as last reported before shot ${seq}.${note}`;
  } else {
    p.textContent = 'no report'; p.className = 'unknown';
    p.title = `No pod battery reported to the unit at shot ${seq}.${note}`;
  }
}

function renderLiveStatus(live) {
  const st = live.status;
  const g = $('batt-ground'), p = $('batt-pod'), d = $('dock-state'), src = $('dev-src');
  const ageMs = Math.max(0, Date.now() - live.receivedAt);
  const stale = ageMs > STATUS_STALE_MS;
  const ageText = ageMs < 2000 ? 'just now' : `${Math.round(ageMs / 1000)} s ago`;
  const u = st.unit;
  const modes = [
    `firmware ${st.fw.text}`,
    u.userArmed ? 'armed' : 'disarmed (serial a)',
    u.buzzerFitted ? `buzzer ${u.buzzerOn ? 'on' : 'off'}` : 'no buzzer fitted',
    u.dockFitted ? 'pod dock fitted' : 'no pod dock fitted',
    u.rawStreaming ? 'raw USB streaming on' : null,
  ].filter(Boolean).join(', ');

  // Unit
  if (u.adcFault) {
    setDev(g, u.batteryKnown ? volts(u.batteryMv) : '', 'low', 'radar fault');
    g.title = 'The radar\u2019s ADC stream failed to start or restart: the unit captures no shots. Power it off and on.';
  } else if (u.batteryKnown) {
    setDev(g, `${volts(u.batteryMv)}${u.batteryLow ? ' low' : ''}`, u.batteryLow ? 'low' : '');
    g.title = `Ground unit cell, read every 30 s${u.batteryLow ? '; under the unit\u2019s 3.50 V low-battery level' : ''}.`;
  } else {
    setDev(g, 'not read', 'unknown');
    g.title = 'The unit has no usable battery reading.';
  }
  g.title += ` Unit: ${modes}.`;

  // Pod
  const pod = P.describePod(st);
  const quiet = pod.key === 'not_connected' || pod.key === 'parked_no_link';
  const wordCls = { charging: 'charging', charged: 'charged', charged_asleep: 'charged' }[pod.key] || (quiet ? 'unknown' : '');
  setDev(p, st.pod.batteryKnown ? volts(st.pod.batteryMv) : '', '', pod.text, wordCls);
  p.title = POD_TITLES[pod.key] || '';
  if (st.pod.connected && !st.pod.powerKnown) p.title += ' This pod sends no power state (pod firmware before 0.2), so charging is not known.';
  if (st.pod.batteryKnown) p.title += ' Battery: the pod\u2019s cell, reported each second.';

  // Dock: only when there is something to say beyond the pod's own state.
  const retryNow = Math.max(0, st.dock.retryS - Math.floor(ageMs / 1000));
  const dock = P.describeDock(st, retryNow);
  $('dev-dock').hidden = !dock;
  if (dock) {
    setDev(d, dock.text, dock.key === 'unknown' ? 'unknown' : 'low');
    d.title = `Pod charging contacts: ${dock.detail}.`;
  }

  // Source
  if (live.demo) {
    src.textContent = 'DEMO';
    src.className = 'dev-src chip demo';
    src.title = 'Synthetic status, not from a unit';
  } else if (stale) {
    src.textContent = `${Math.round(ageMs / 1000)} s old`;
    src.className = 'dev-src stale';
    src.title = `No status from the unit for ${Math.round(ageMs / 1000)} s; it sends one at least every 30 s outside a capture.`;
    for (const el of [g, p, d]) el.classList.add('unknown');
  } else {
    src.textContent = 'live';
    src.className = 'dev-src live';
    src.title = `Live from the unit, last update ${ageText}.`;
  }
}

function renderSession() {
  const list = shots();
  const n = list.length;
  $('count').textContent = `${n} shot${n === 1 ? '' : 's'}${state.rejected && !state.demoFeed ? ` · ${state.rejected} rejected` : ''}`;

  const packets = list.map((e) => e.packet);
  for (const el of document.querySelectorAll('.mean')) {
    const key = el.dataset.key;
    const st = P.sessionStats(packets, key);
    const v = st.mean === null ? null : P.formatReading({ ok: true, key, value: st.mean }, state.unit);
    el.querySelector('b').textContent = v === null ? DASH : v;
    el.querySelector('small').textContent = n ? `${st.n} of ${st.total}` : '';
    el.title = n ? `Mean of ${st.n} readings; ${st.refused} shot${st.refused === 1 ? '' : 's'} with no reading, left out` : '';
    el.classList.toggle('is-none', v === null);
  }

  const ol = $('history');
  ol.textContent = '';
  const frag = document.createDocumentFragment();
  for (const e of list.slice(-HISTORY_SHOWN).reverse()) {
    const li = document.createElement('li');
    li.className = 'row';
    const seq = document.createElement('span');
    seq.className = 'h-seq';
    seq.textContent = `#${e.packet.shotSeq}`;
    if (e.demo) seq.insertAdjacentHTML('beforeend', '<span class="chip demo">DEMO</span>');
    else if (e.via === 'read on connect') seq.insertAdjacentHTML('beforeend', '<span class="chip read" title="Read from the unit when connecting: may be from before">PRIOR</span>');
    li.appendChild(seq);
    for (const key of ['club_speed_radial', 'ball_speed_radial', 'smash']) {
      const r = e.packet.readings[key];
      const s = document.createElement('span');
      const v = P.formatReading(r, state.unit);
      s.textContent = v === null ? DASH : v;
      if (v === null) { s.className = 'h-none'; s.title = r.reason; }
      li.appendChild(s);
    }
    frag.appendChild(li);
  }
  ol.appendChild(frag);
  $('history-empty').hidden = n > 0;
  ol.hidden = n === 0;
  const cols = document.querySelectorAll('.history-cols span');
  $('means').hidden = n === 0;
  cols[0].textContent = `Shot \u00b7 ${P.SPEED_UNITS[state.unit].label}`;

  const exp = $('export');
  exp.disabled = !!state.demoFeed || state.real.length === 0;
  exp.title = state.demoFeed ? 'Demo data is synthetic and is never exported' : 'Download this session as CSV';
  $('clear').disabled = !!state.demoFeed || state.real.length === 0;
}

function renderUnits() {
  for (const b of document.querySelectorAll('#units button')) b.setAttribute('aria-checked', String(b.dataset.unit === state.unit));
}

function renderAwake() { $('awake').hidden = !state.wake; }

function renderDemo() {
  $('demo-banner').hidden = !state.demoFeed;
  const d = $('demo');
  d.setAttribute('aria-pressed', String(!!state.demoFeed));
  d.textContent = state.demoFeed ? 'Stop demo' : 'Demo';
}

function render() {
  renderDemo();
  renderLink();
  renderShot();
  renderDevice();
  renderSession();
  renderUnits();
  renderAwake();
}

// ---- Unsupported browsers -------------------------------------------------------
function noticeWhy() {
  const s = state.support;
  if (s.why === 'insecure') {
    return `This page was opened at ${location.protocol}//${location.host || '(file)'}, which is not a secure context. Web Bluetooth runs only on https:// pages, or on http://localhost on the same computer.`;
  }
  if (s.ios) return 'Safari on iPhone and iPad does not support Web Bluetooth, so this browser cannot talk to the unit.';
  return 'This browser does not offer Web Bluetooth, so it cannot talk to the unit.';
}
function openNotice() { state.noticeOpen = true; $('notice-why').textContent = noticeWhy(); renderShot(); }
function closeNotice() { state.noticeOpen = false; renderShot(); }

// ---- Wiring -----------------------------------------------------------------------
function init() {
  const boot = document.getElementById('boot');
  if (boot) boot.remove();

  $('connect').addEventListener('click', () => {
    if (state.link === 'connected' || state.link === 'connecting' || state.link === 'reconnecting') disconnect();
    else connect();
  });
  $('link').addEventListener('click', () => { if (!state.support.ok) (state.noticeOpen ? closeNotice() : openNotice()); });
  $('demo').addEventListener('click', () => (state.demoFeed ? stopDemo() : startDemo()));
  $('notice-demo').addEventListener('click', startDemo);
  $('notice-close').addEventListener('click', closeNotice);
  $('export').addEventListener('click', exportCsv);
  $('clear').addEventListener('click', newSession);
  for (const b of document.querySelectorAll('#units button')) {
    b.addEventListener('click', () => {
      state.unit = b.dataset.unit;
      store.set(UNIT_KEY, state.unit);
      render();
    });
  }

  // The status row ages: the dock's retry countdown and "stale" are worked
  // out here from the time the last status arrived.
  setInterval(() => { if (state.status) renderDevice(); }, 1000);

  restore();
  const params = new URLSearchParams(location.search);
  if (!state.support.ok && !params.has('demo')) openNotice();
  render();
  if (params.has('demo')) startDemo();

  if (state.support.ok && navigator.bluetooth.getAvailability) {
    navigator.bluetooth.getAvailability().then((ok) => {
      if (!ok) say('Bluetooth looks switched off or missing on this device. Turn it on, then tap Connect.', true, 0);
    }).catch(() => {});
  }

  if ('serviceWorker' in navigator && window.isSecureContext && !params.has('nosw')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline reload just won't be cached */ });
  }
}

init();
