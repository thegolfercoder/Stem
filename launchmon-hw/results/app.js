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

const state = {
  unit: P.SPEED_UNITS[store.get(UNIT_KEY)] ? store.get(UNIT_KEY) : 'mph',
  support: detectSupport(),
  link: 'idle',            // idle | requesting | connecting | connected | reconnecting
  device: null,
  chr: null,
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
  if (!state.want) { device.gatt.disconnect(); return; }
  state.chr = chr;
  state.attempt = 0;
  setLink('connected');
  wakeOn();
  // The characteristic is readable too: it holds the last shot the unit
  // analysed, which may be from before this connection (or one missed while
  // disconnected). Empty until the unit's first shot since boot.
  try {
    const v = await chr.readValue();
    if (v.byteLength > 0) handleValue(v, 'read on connect');
  } catch { /* nothing to read yet */ }
}

function onNotify(ev) { handleValue(ev.target.value, 'notify'); }

function onDisconnected() {
  if (state.chr) state.chr.removeEventListener('characteristicvaluechanged', onNotify);
  state.chr = null;
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
  setLink('idle');
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
  state.noticeOpen = false;
  document.body.classList.add('is-demo');
  state.demoFeed = new DemoFeed((dv) => {
    const res = P.parseShotSummary(dv);        // the real parser, on synthetic bytes
    if (res.ok) addShot(res.packet, 'demo', true);
    else say(`Demo packet rejected: ${res.error}`, true);
  });
  render();
  state.demoFeed.start({ prefill: 5 });
}

function stopDemo() {
  if (!state.demoFeed) return;
  state.demoFeed.stop();
  state.demoFeed = null;
  state.demo = [];
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

function renderDevice() {
  const e = latest();
  const g = $('batt-ground'), p = $('batt-pod'), s = $('pod-state');
  for (const el of [g, p, s]) { el.className = ''; el.title = ''; }
  if (!e) {
    g.textContent = p.textContent = s.textContent = DASH;
    return;
  }
  const b = e.packet.battery, seq = e.packet.shotSeq;
  if (b.groundKnown) {
    g.textContent = `${volts(b.groundMv)}${b.groundLow ? ' low' : ''}`;
    if (b.groundLow) g.className = 'low';
    g.title = `Ground unit cell, sent with shot ${seq}${b.groundLow ? '; under the unit\u2019s 3.50 V low-battery level' : ''}`;
  } else {
    g.textContent = 'not read'; g.className = 'unknown';
    g.title = `The unit had no battery reading at shot ${seq}`;
  }
  if (b.podKnown) {
    p.textContent = volts(b.podMv);
    p.title = `The last value the pod reported before shot ${seq}. The unit keeps it after the pod disconnects.`;
  } else {
    p.textContent = 'no report'; p.className = 'unknown';
    p.title = 'No pod status received by the unit since it started';
  }
  const pod = P.podAtShot(e.packet);
  s.textContent = { data: 'yes', no_samples: 'none at impact', not_connected: 'not connected' }[pod] || 'unknown';
  if (pod !== 'data') s.className = 'unknown';
  s.title = 'Whether the pod\u2019s samples covered this shot, from its IMU readings. Firmware 0.2 sends no live pod link, dock or charge state to the phone.';
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
