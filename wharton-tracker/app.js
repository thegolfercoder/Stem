/* WGHSIC trade tracker: state, rendering and events. Calculations live in calc.js. */
(function () {
  "use strict";
  const C = window.Calc;
  const STORAGE_KEY = "wghsic-tracker-v1";

  /* ---------- seed ---------- */

  const PLAN_DATE = "2026-10-06";
  const SEED_TICKERS = {
    IEF: { bucket: "safe", kind: "etf", target: 35, name: "iShares 7-10 Year Treasury" },
    IEI: { bucket: "safe", kind: "etf", target: 33, name: "iShares 3-7 Year Treasury" },
    SGOV: { bucket: "safe", kind: "etf", target: null, name: "iShares 0-3 Month Treasury" },
    TIP: { bucket: "tips", kind: "etf", target: 5, name: "iShares TIPS Bond" },
    VTI: { bucket: "stocks", kind: "etf", target: 17, name: "Vanguard Total Stock Market" },
    VXUS: { bucket: "stocks", kind: "etf", target: 10, name: "Vanguard Total International Stock" },
    NVDA: { bucket: "stocks", kind: "stock", target: null, name: "NVIDIA" },
    AAPL: { bucket: "stocks", kind: "stock", target: null, name: "Apple" },
    MSFT: { bucket: "stocks", kind: "stock", target: null, name: "Microsoft" },
    AMZN: { bucket: "stocks", kind: "stock", target: null, name: "Amazon" },
    TSM: { bucket: "stocks", kind: "stock", target: null, name: "Taiwan Semiconductor (ADR)" },
    "BRK.B": { bucket: "stocks", kind: "stock", target: null, name: "Berkshire Hathaway B" },
    JNJ: { bucket: "stocks", kind: "stock", target: null, name: "Johnson & Johnson" },
    JPM: { bucket: "stocks", kind: "stock", target: null, name: "JPMorgan Chase" },
  };
  const SEED_PLAN = [
    ["IEF", 20000], ["IEI", 20000], ["TIP", 5000], ["SGOV", 5000],
    ["NVDA", 5000], ["AAPL", 5000], ["MSFT", 5000], ["AMZN", 5000],
    ["TSM", 5000], ["BRK.B", 5000], ["JNJ", 5000], ["JPM", 5000],
  ];

  function seedState() {
    const tickers = {};
    for (const [k, v] of Object.entries(SEED_TICKERS)) tickers[k] = Object.assign({ mark: null, markDate: "" }, v);
    return {
      version: 1,
      settings: {
        startingCash: 100000,
        startingCashVerified: false,
        tradeLimit: 200,
        tradeLimitVerified: false,
        intraday: "unknown",
        treasuryYield: 3.5,
        stockReturn: 7,
        stockVol: 16,
        safeVol: 0,
        tipsReturn: 3.5,
        tipsVol: 0,
        maxSingleStockPct: 3,
        driftBandPts: 2,
        bucketTargets: { safe: 68, stocks: 27, tips: 5 },
        includePlanned: false,
        countTipsInReserve: true,
        reserveShare2: 100,
        client: { contrib1: 300000, year1: 2027, contrib2: 150000, year2: 2028, payment: 50000, payments: 10, reserveYear: 2033 },
        mc: { runs: 5000, seed: 2027, policy: "glide", confidence: 80, allocation: "targets", roundStep: 5000 },
      },
      tickers,
      trades: SEED_PLAN.map(([t, d], i) => ({
        id: `seed-${i + 1}`,
        date: PLAN_DATE,
        ticker: t,
        side: "buy",
        dollars: d,
        shares: null,
        price: null,
        bucket: SEED_TICKERS[t].bucket,
        note: "",
        confirmed: false,
        screenshot: false,
      })),
      notes: { picks: ["", "", ""], reflections: {} },
      ips: { team: "", title: "Investment Policy Statement: Laura Gao", pitch: "", body: "" },
      deadlines: [
        { id: "trading-begins", label: "Trading began", date: "2026-09-28" },
        { id: "roster", label: "Team roster due", date: "2026-10-09" },
        { id: "tna", label: "Trading Notes Analysis due", date: "2026-10-23" },
        { id: "ips", label: "IPS due; trading ends, portfolio frozen, strategy cannot change", date: "2026-11-06" },
        { id: "final", label: "Final Report due (details released Week 7)", date: "2026-12-04" },
      ],
      tasks: [
        ["Confirm WInS starting cash, trade limit and intraday rules; update Settings", "roster"],
        ["Submit team roster", "roster"],
        ["Resolve the plan's conflicts with our own rules (see Dashboard with planned trades included)", "roster"],
        ["Place the planned trades; paste each Trading Note into the log exactly as entered in WInS", "tna"],
        ["Screenshot every confirmed trade", "tna"],
        ["Pick 3 trades, copy their notes exactly, write reflections (100 words or fewer each)", "tna"],
        ["Submit Trading Notes Analysis", "tna"],
        ["Draft 50-word elevator pitch", "ips"],
        ["Draft 500-word IPS and save PDF (Times New Roman 12pt, double spaced)", "ips"],
        ["Final rebalance check before the portfolio freezes", "ips"],
        ["Read Final Report details when released (Week 7)", "final"],
        ["Final Report: operating reserve, facility contribution, 2031 co-sponsor range with confidence", "final"],
      ].map(([text, due], i) => ({ id: `task-${i + 1}`, text, due, done: false })),
    };
  }

  /* ---------- state & storage ---------- */

  function mergeDefaults(target, defaults) {
    for (const [k, v] of Object.entries(defaults)) {
      if (!(k in target)) target[k] = v;
      else if (v && typeof v === "object" && !Array.isArray(v) && target[k] && typeof target[k] === "object" && !Array.isArray(target[k]) && k !== "tickers" && k !== "reflections")
        mergeDefaults(target[k], v);
    }
    return target;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return mergeDefaults(JSON.parse(raw), seedState());
    } catch (e) {
      console.warn("Could not read saved data; starting from the seed.", e);
    }
    return seedState();
  }

  let state = loadState();
  let saveTimer = null;
  function writeNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    const el = document.getElementById("save-status");
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      el.textContent = "Saved " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch (e) {
      el.textContent = "Not saved: browser storage unavailable. Export a backup.";
    }
  }
  // Debounced so typing does not serialise on every key; flushed on page hide
  // so closing or reloading straight after an edit does not lose it.
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(writeNow, 250);
  }
  window.addEventListener("pagehide", () => saveTimer && writeNow());
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && saveTimer && writeNow());

  /* ---------- helpers ---------- */

  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (s) => String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const money = (x, cents) =>
    x === null || x === undefined || !Number.isFinite(x)
      ? "–"
      : (x < 0 ? "-$" : "$") + Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  const pct = (x, d) => (Number.isFinite(x) ? x.toFixed(d === undefined ? 1 : d) + "%" : "–");
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function daysUntil(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    const t = new Date();
    return Math.round((new Date(y, m - 1, d) - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / 86400000);
  }
  function dueText(n) {
    if (n === 0) return "today";
    if (n === 1) return "tomorrow";
    if (n > 0) return `in ${n} days`;
    return `${-n} day${n === -1 ? "" : "s"} ago`;
  }
  function getPath(obj, path) {
    return path.split(".").reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), obj);
  }
  function setPath(obj, path, value) {
    const ks = path.split(".");
    const last = ks.pop();
    const o = ks.reduce((a, k) => (a[k] = a[k] || {}), obj);
    o[last] = value;
  }
  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 0);
  }
  function pickFile(accept) {
    return new Promise((resolve) => {
      const i = document.createElement("input");
      i.type = "file";
      i.accept = accept;
      i.onchange = () => {
        const f = i.files[0];
        if (!f) return resolve(null);
        f.text().then(resolve);
      };
      i.click();
    });
  }
  async function copyText(text, btn) {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        ok = document.execCommand("copy");
      } catch (e2) {
        ok = false;
      }
      ta.remove();
    }
    if (btn) {
      const old = btn.textContent;
      btn.textContent = ok ? "Copied" : "Copy failed: select the text manually";
      setTimeout(() => (btn.textContent = old), 1800);
    }
  }

  // Inputs bound to a state path. `data-bind` = path, `data-type` = number|bool|text.
  function field(path, label, opts) {
    opts = opts || {};
    const v = getPath(state, path);
    const type = opts.type || "number";
    const cls = opts.wide ? ' class="wide"' : "";
    const hint = opts.hint ? `<div class="muted small">${opts.hint}</div>` : "";
    const id = "f-" + path.replace(/\./g, "-");
    if (type === "bool")
      return `<div${cls}><label class="check"><input type="checkbox" id="${id}" data-bind="${path}" data-type="bool" ${v ? "checked" : ""}> ${label}</label>${hint}</div>`;
    if (type === "select")
      return `<div${cls}><label for="${id}">${label}</label><select id="${id}" data-bind="${path}" data-type="text">${opts.options
        .map(([val, txt]) => `<option value="${esc(val)}" ${String(v) === String(val) ? "selected" : ""}>${esc(txt)}</option>`)
        .join("")}</select>${hint}</div>`;
    const inputType = type === "number" ? 'type="number" step="any" inputmode="decimal"' : type === "date" ? 'type="date"' : 'type="text"';
    return `<div${cls}><label for="${id}">${label}</label><input ${inputType} id="${id}" data-bind="${path}" data-type="${type === "date" ? "text" : type}" value="${esc(v === null || v === undefined ? "" : v)}" ${opts.placeholder ? `placeholder="${esc(opts.placeholder)}"` : ""}>${hint}</div>`;
  }

  function alertsHTML(list, okText) {
    if (!list.length) return okText ? `<ul class="alerts"><li class="alert ok"><span class="icon">✓</span><span>${okText}</span></li></ul>` : "";
    const icon = { critical: "!", warning: "▲", info: "i", ok: "✓" };
    return `<ul class="alerts">${list.map((a) => `<li class="alert ${a.level}"><span class="icon" aria-label="${a.level}">${icon[a.level]}</span><span>${esc(a.text)}</span></li>`).join("")}</ul>`;
  }

  function bar(name, actual, target, figs, over, title) {
    const scale = 100;
    const w = Math.max(0, Math.min(100, (actual / scale) * 100));
    const t = target === null || target === undefined ? "" : `<div class="bar-target" style="left:calc(${Math.min(100, target)}% - 1px)" title="Target ${target}%"></div>`;
    return `<div class="bar-row" title="${esc(title || "")}"><div class="name">${esc(name)}</div><div class="bar-track"><div class="bar-fill${over ? " over" : ""}" style="width:${w}%"></div>${t}</div><div class="figs">${figs}</div></div>`;
  }

  /* ---------- derived ---------- */

  function settingsForChecks() {
    const s = state.settings;
    const d = Object.fromEntries(state.deadlines.map((x) => [x.id, x.date]));
    return Object.assign({}, s, { tradingBegins: d["trading-begins"], tradingEnds: d.ips });
  }
  function holdings(includePlanned) {
    return C.computeHoldings(state.trades, state.tickers, state.settings.startingCash, includePlanned);
  }
  function tradeLabel(t) {
    return `${t.date} ${t.side.toUpperCase()} ${t.ticker} ${money(C.num(t.dollars))}${t.confirmed ? "" : " (planned)"}`;
  }
  function nextDeadline() {
    return state.deadlines
      .filter((d) => d.date && daysUntil(d.date) >= 0)
      .sort((a, b) => a.date.localeCompare(b.date))[0];
  }

  /* ---------- views ---------- */

  const views = {};

  views.dashboard = function () {
    const s = state.settings;
    const h = holdings(s.includePlanned);
    const warn = C.allocationWarnings(h, s).concat(C.tradeWarnings(state.trades, settingsForChecks()));
    const confirmed = state.trades.filter((t) => t.confirmed).length;
    const planned = state.trades.length - confirmed;
    const limit = C.num(s.tradeLimit);
    const nd = nextDeadline();
    const tg = s.bucketTargets;
    const bucketBars = C.BUCKETS.map((b) => {
      const bk = h.buckets[b];
      const target = C.num(tg[b]);
      const over = b === "stocks" && target !== null && bk.weight > target + C.num(s.driftBandPts);
      return bar(C.BUCKET_LABELS[b], bk.weight, target, `${pct(bk.weight)} / ${target === null ? "–" : target + "%"}`, over, money(bk.value));
    }).join("") + bar("Cash", h.cashWeight, null, `${pct(h.cashWeight)}`, false, money(h.cash));
    const cap = C.num(s.maxSingleStockPct);
    const tickerBars = h.rows
      .map((r) => {
        const over = r.kind === "stock" && cap !== null && r.weight > cap;
        return bar(r.ticker, r.weight, r.target, `${pct(r.weight)} / ${r.target === null ? (r.kind === "stock" ? "cap " + cap + "%" : "–") : r.target + "%"}`, over, money(r.value));
      })
      .join("");
    const rowsHTML = h.rows
      .map((r) => {
        const info = state.tickers[r.ticker] || {};
        return `<tr>
          <td><strong>${esc(r.ticker)}</strong><div class="muted small">${esc(info.name || "")}</div></td>
          <td>${esc(C.BUCKET_LABELS[r.bucket] || r.bucket)}${r.kind === "stock" ? ' <span class="badge">stock</span>' : ""}</td>
          <td class="num">${r.shares ? r.shares : "–"}</td>
          <td class="num" style="min-width:7.5rem"><input type="number" step="any" inputmode="decimal" aria-label="Price for ${esc(r.ticker)}" data-mark="${esc(r.ticker)}" value="${esc(info.mark === null || info.mark === undefined ? "" : info.mark)}" placeholder="enter price"><div class="muted small">${esc(info.markDate || "")}</div></td>
          <td class="num">${money(r.value, true)}${r.atCost ? ' <span class="badge warn" title="Valued at cost: no manual price, or a trade without shares">at cost</span>' : ""}</td>
          <td class="num">${pct(r.weight, 2)}</td>
          <td class="num">${r.target === null ? "–" : r.target + "%"}</td>
        </tr>`;
      })
      .join("");
    return `
      <div class="row" style="margin-bottom:1rem">
        <h2 style="margin:0">Holdings &amp; allocation</h2><span class="spacer"></span>
        <label class="check"><input type="checkbox" data-bind="settings.includePlanned" data-type="bool" ${s.includePlanned ? "checked" : ""}> Include planned trades (preview)</label>
      </div>
      ${s.includePlanned ? `<ul class="alerts"><li class="alert info"><span class="icon">i</span><span>Preview: ${planned} planned trade(s) are counted as if executed, at their dollar amounts.</span></li></ul>` : ""}
      <div class="tiles">
        <div class="tile"><div class="label">Portfolio value</div><div class="value">${money(h.total)}</div><div class="hint">Starting cash ${money(C.num(s.startingCash))}${s.startingCashVerified ? "" : " · unverified"}</div></div>
        <div class="tile"><div class="label">Cash remaining</div><div class="value">${money(h.cash)}</div><div class="hint">${pct(h.cashWeight)} of portfolio</div></div>
        <div class="tile"><div class="label">Trades used</div><div class="value">${confirmed}${limit ? ` / ${limit}` : ""}</div><div class="hint">${planned} planned${limit ? (s.tradeLimitVerified ? "" : " · limit unverified") : " · no limit set"}</div></div>
        <div class="tile"><div class="label">Next deadline</div><div class="value">${nd ? dueText(daysUntil(nd.date)) : "none"}</div><div class="hint">${nd ? esc(nd.label) : ""}</div></div>
      </div>
      <div class="card"><h3>Checks</h3>${alertsHTML(warn, "No rule breaches on current holdings.")}</div>
      <div class="grid">
        <div class="card"><h3>By bucket: actual vs target</h3><div class="bars">${bucketBars}</div>
          <div class="legend"><span><span class="sw"></span>actual % of portfolio</span><span><span class="tk"></span>target</span><span>hatched = over a rule</span></div></div>
        <div class="card"><h3>By ticker</h3>${tickerBars ? `<div class="bars">${tickerBars}</div>` : '<p class="muted">No confirmed holdings yet. Tick "confirmed in WInS" on the Trades tab, or include planned trades above.</p>'}</div>
      </div>
      <div class="card" style="margin-top:1rem">
        <div class="row"><h3 style="margin:0">Positions</h3><span class="spacer"></span><button class="small" data-action="export-holdings">Export holdings CSV</button></div>
        <p class="muted small">Type the latest price from WInS into a price box; values update when you leave the box. Without a price a position is carried at cost.</p>
        <div class="table-wrap"><table><thead><tr><th>Ticker</th><th>Bucket</th><th class="num">Shares</th><th class="num">Price</th><th class="num">Value</th><th class="num">% port.</th><th class="num">Target</th></tr></thead>
        <tbody>${rowsHTML || '<tr><td colspan="7" class="muted">Nothing held.</td></tr>'}
        <tr><td><strong>Cash</strong></td><td></td><td></td><td></td><td class="num">${money(h.cash, true)}</td><td class="num">${pct(h.cashWeight, 2)}</td><td></td></tr></tbody></table></div>
      </div>`;
  };

  let editingTradeId = null;
  views.trades = function () {
    const s = state.settings;
    const t = editingTradeId ? state.trades.find((x) => x.id === editingTradeId) : null;
    const f = t || { date: todayISO(), ticker: "", side: "buy", dollars: "", shares: "", price: "", bucket: "", note: "", confirmed: false, screenshot: false };
    const confirmed = state.trades.filter((x) => x.confirmed).length;
    const limit = C.num(s.tradeLimit);
    const tw = C.tradeWarnings(state.trades, settingsForChecks());
    const list = state.trades
      .slice()
      .sort((a, b) => (a.confirmed === b.confirmed ? String(b.date).localeCompare(String(a.date)) : a.confirmed ? 1 : -1))
      .map((x) => {
        const needsFill = x.confirmed && (C.num(x.price) === null || C.num(x.shares) === null);
        return `<tr class="${x.confirmed ? "done" : "planned"}">
          <td data-label="Status">${x.confirmed ? '<span class="badge good">done</span>' : '<span class="badge">planned</span>'}</td>
          <td data-label="Date" class="num">${esc(x.date)}</td>
          <td data-label="Ticker"><strong>${esc(x.ticker)}</strong></td>
          <td data-label="Side">${esc(x.side)}</td>
          <td data-label="Dollars" class="num">${money(C.num(x.dollars), true)}</td>
          <td data-label="Shares" class="num">${C.num(x.shares) === null ? "–" : x.shares}</td>
          <td data-label="Price" class="num">${C.num(x.price) === null ? "–" : money(C.num(x.price), true)}${needsFill ? ' <span class="badge warn">add fill</span>' : ""}</td>
          <td data-label="Bucket">${esc(x.bucket || "")}</td>
          <td data-label="Note" class="note-cell">${x.note ? `<span title="${esc(x.note)}">${esc(x.note.length > 70 ? x.note.slice(0, 70) + "…" : x.note)}</span>` : '<span class="muted small">no note yet</span>'}</td>
          <td data-label="WInS"><label class="check"><input type="checkbox" data-toggle="confirmed" data-id="${esc(x.id)}" ${x.confirmed ? "checked" : ""}><span class="hide-sm">confirmed</span></label></td>
          <td data-label="Screenshot"><label class="check"><input type="checkbox" data-toggle="screenshot" data-id="${esc(x.id)}" ${x.screenshot ? "checked" : ""}><span class="hide-sm">screenshot</span></label></td>
          <td class="actions"><div class="row" style="flex-wrap:nowrap"><button class="small" data-action="edit-trade" data-id="${esc(x.id)}">Edit</button><button class="small danger" data-action="delete-trade" data-id="${esc(x.id)}">Delete</button></div></td>
        </tr>`;
      })
      .join("");
    const opts = Object.keys(state.tickers).map((k) => `<option value="${esc(k)}">`).join("");
    return `
      <div class="row" style="margin-bottom:1rem"><h2 style="margin:0">Trade log</h2><span class="spacer"></span>
        <span class="badge ${limit && confirmed > limit ? "crit" : ""}">${confirmed}${limit ? ` / ${limit}` : ""} trades used${limit && !s.tradeLimitVerified ? " (limit unverified)" : ""}</span></div>
      <form class="card" id="trade-form" autocomplete="off">
        <h3>${t ? "Edit trade" : "Add a trade"}</h3>
        <div class="form-grid">
          <div><label for="t-date">Date</label><input type="date" id="t-date" name="date" value="${esc(f.date)}" required></div>
          <div><label for="t-ticker">Ticker</label><input id="t-ticker" name="ticker" list="ticker-list" value="${esc(f.ticker)}" required style="text-transform:uppercase"><datalist id="ticker-list">${opts}</datalist></div>
          <div><label for="t-side">Buy / sell</label><select id="t-side" name="side"><option value="buy" ${f.side === "buy" ? "selected" : ""}>Buy</option><option value="sell" ${f.side === "sell" ? "selected" : ""}>Sell</option></select></div>
          <div><label for="t-bucket">Bucket</label><select id="t-bucket" name="bucket"><option value="">from ticker</option>${C.BUCKETS.map((b) => `<option value="${b}" ${f.bucket === b ? "selected" : ""}>${C.BUCKET_LABELS[b]}</option>`).join("")}</select></div>
          <div><label for="t-dollars">Dollars</label><input type="number" step="any" inputmode="decimal" id="t-dollars" name="dollars" value="${esc(f.dollars === null ? "" : f.dollars)}"></div>
          <div><label for="t-shares">Shares</label><input type="number" step="any" inputmode="decimal" id="t-shares" name="shares" value="${esc(f.shares === null ? "" : f.shares)}"></div>
          <div><label for="t-price">Price</label><input type="number" step="any" inputmode="decimal" id="t-price" name="price" value="${esc(f.price === null ? "" : f.price)}"></div>
          <div class="wide"><label for="t-note">Trading Note, exactly as pasted into WInS</label><textarea id="t-note" name="note" placeholder="Paste the note you submitted in WInS, unchanged.">${esc(f.note)}</textarea>
            <div class="counter" data-count-for="t-note"></div></div>
          <div class="wide row">
            <label class="check"><input type="checkbox" name="confirmed" ${f.confirmed ? "checked" : ""}> Confirmed in WInS</label>
            <label class="check"><input type="checkbox" name="screenshot" ${f.screenshot ? "checked" : ""}> Screenshot taken</label>
          </div>
        </div>
        <p class="muted small">Enter any two of dollars, shares and price; the third is filled in. A new ticker is added to Settings with the bucket chosen here.</p>
        <div class="row end">${t ? '<button type="button" data-action="cancel-edit">Cancel</button>' : ""}<button type="submit" class="primary">${t ? "Save changes" : "Add trade"}</button></div>
      </form>
      ${tw.length ? `<div class="card">${alertsHTML(tw)}</div>` : ""}
      <div class="card">
        <div class="row"><h3 style="margin:0">All trades</h3><span class="spacer"></span>
          <button class="small" data-action="export-trades">Export CSV</button><button class="small" data-action="import-trades">Import CSV</button></div>
        <div class="table-wrap" style="margin-top:.5rem"><table class="stack-sm"><thead><tr><th>Status</th><th class="num">Date</th><th>Ticker</th><th>Side</th><th class="num">Dollars</th><th class="num">Shares</th><th class="num">Price</th><th>Bucket</th><th>Note</th><th>WInS</th><th>Screenshot</th><th></th></tr></thead>
        <tbody>${list || '<tr><td colspan="12" class="muted">No trades.</td></tr>'}</tbody></table></div>
      </div>`;
  };

  function notesOutput() {
    const parts = [];
    state.notes.picks.forEach((id, i) => {
      const t = state.trades.find((x) => x.id === id);
      if (!t) return;
      const refl = state.notes.reflections[id] || "";
      parts.push(
        `Trade ${i + 1}: ${t.date}, ${t.side.toUpperCase()} ${t.ticker}, ${money(C.num(t.dollars), true)}` +
          `${C.num(t.shares) !== null ? `, ${t.shares} shares` : ""}${C.num(t.price) !== null ? ` at ${money(C.num(t.price), true)}` : ""}\n\n` +
          `Trading Note (copied exactly from WInS):\n${t.note || "[note missing]"}\n\n` +
          `Reflection (${C.wordCount(refl)} words):\n${refl}`,
      );
    });
    return parts.join("\n\n----------------------------------------\n\n");
  }

  views.notes = function () {
    const options = (sel) =>
      `<option value="">Choose a trade…</option>` +
      state.trades
        .slice()
        .sort((a, b) => String(a.date).localeCompare(String(b.date)))
        .map((t) => `<option value="${esc(t.id)}" ${t.id === sel ? "selected" : ""}>${esc(tradeLabel(t))}</option>`)
        .join("");
    const blocks = state.notes.picks
      .map((id, i) => {
        const t = state.trades.find((x) => x.id === id);
        const refl = (t && state.notes.reflections[id]) || "";
        const issues = [];
        if (t && !t.confirmed) issues.push({ level: "warning", text: "This trade is not confirmed in WInS yet." });
        if (t && !t.note) issues.push({ level: "warning", text: "No Trading Note recorded for this trade. Paste it on the Trades tab exactly as entered in WInS." });
        if (t && state.notes.picks.filter((p) => p === id).length > 1) issues.push({ level: "warning", text: "This trade is picked more than once." });
        return `<div class="card">
          <h3>Trade ${i + 1}</h3>
          <label for="pick-${i}">Trade</label><select id="pick-${i}" data-pick="${i}">${options(id)}</select>
          ${
            t
              ? `${alertsHTML(issues)}
            <p class="muted small" style="margin-top:.75rem">Trading Note (as recorded; ${C.wordCount(t.note)} words)</p>
            <div class="note-text">${esc(t.note || "—")}</div>
            <label for="refl-${i}" style="margin-top:.75rem">Reflection (100 words or fewer)</label>
            <textarea id="refl-${i}" data-reflection="${esc(id)}" placeholder="What did we expect, what happened, what would we change?">${esc(refl)}</textarea>
            <div class="counter" data-count-for="refl-${i}" data-limit="100"></div>`
              : ""
          }
        </div>`;
      })
      .join("");
    return `
      <h2>Trading Notes Analysis</h2>
      <p class="muted">Due ${esc((state.deadlines.find((d) => d.id === "tna") || {}).date || "")}. Pick three trades. Each note must be copied exactly from WInS; each reflection is 100 words or fewer.</p>
      ${blocks}
      <div class="card"><div class="row"><h3 style="margin:0">Output</h3><span class="spacer"></span><button class="primary small" data-action="copy-notes">Copy</button></div>
      <pre class="output" id="notes-output">${esc(notesOutput())}</pre></div>`;
  };

  views.ips = function () {
    const ips = state.ips;
    return `
      <h2>Investment Policy Statement</h2>
      <p class="muted">Due ${esc((state.deadlines.find((d) => d.id === "ips") || {}).date || "")}. 50-word elevator pitch plus a 500-word IPS, as a PDF in Times New Roman 12pt, double spaced. Use Print, then "Save as PDF".</p>
      <div class="card form-grid">
        ${field("ips.team", "Team name", { type: "text" })}
        ${field("ips.title", "Title", { type: "text" })}
      </div>
      <div class="card">
        <label for="ips-pitch">Elevator pitch (50 words)</label>
        <textarea id="ips-pitch" data-bind="ips.pitch" data-type="text" data-live style="min-height:5rem">${esc(ips.pitch)}</textarea>
        <div class="counter" data-count-for="ips-pitch" data-limit="50"></div>
      </div>
      <div class="card">
        <label for="ips-body">Investment Policy Statement (500 words). Leave a blank line between paragraphs; a line starting with "## " becomes a heading.</label>
        <textarea id="ips-body" data-bind="ips.body" data-type="text" data-live style="min-height:22rem">${esc(ips.body)}</textarea>
        <div class="counter" data-count-for="ips-body" data-limit="500"></div>
      </div>
      <div class="row end"><button class="primary" data-action="print-ips">Print / save as PDF</button></div>`;
  };

  function reserveInputs() {
    const s = state.settings;
    const c = s.client;
    return {
      rate: (C.num(s.treasuryYield) || 0) / 100,
      payment: C.num(c.payment) || 0,
      payments: C.num(c.payments) || 0,
      reserveYear: C.num(c.reserveYear),
      year1: C.num(c.year1),
      year2: C.num(c.year2),
      contrib1: C.num(c.contrib1) || 0,
      contrib2: C.num(c.contrib2) || 0,
    };
  }

  views.reserve = function () {
    const s = state.settings;
    const ri = reserveInputs();
    const share2 = C.num(s.reserveShare2);
    const rp = C.reservePlan(Object.assign({}, ri, { share2: share2 === null ? null : share2 / 100 }));
    const safeWeight = (h) => {
      const tot = h.total;
      if (!(tot > 0)) return null;
      return (h.buckets.safe.value + (s.countTipsInReserve ? h.buckets.tips.value : 0)) / tot;
    };
    const hNow = holdings(false);
    const hPlan = holdings(true);
    const tgt = ((C.num(s.bucketTargets.safe) || 0) + (s.countTipsInReserve ? C.num(s.bucketTargets.tips) || 0 : 0)) / 100;
    const statusRow = (label, w, note) => {
      if (w === null) return `<tr><td>${label}</td><td class="num">–</td><td class="num">–</td><td>–</td></tr>`;
      const proj = rp.projectSafe(w, w);
      const gap = proj - rp.reserve;
      return `<tr><td>${label}${note ? `<div class="muted small">${note}</div>` : ""}</td><td class="num">${pct(w * 100)}</td><td class="num">${money(proj)}</td>
        <td>${gap >= 0 ? `<span class="badge good">✓ on track</span> <span class="small">+${money(gap)}</span>` : `<span class="badge crit">! short</span> <span class="small">${money(gap)}</span>`}</td></tr>`;
    };
    // Year-by-year draw-down at the assumed yield: confirms the reserve is exactly used up.
    let bal = rp.reserve;
    const sched = [];
    for (let k = 0; k < ri.payments; k++) {
      const start = bal;
      bal = (bal - ri.payment) * (1 + ri.rate);
      sched.push(`<tr><td class="num">${ri.reserveYear + k}</td><td class="num">${money(start)}</td><td class="num">${money(ri.payment)}</td><td class="num">${money(Math.abs(bal) < 0.5 ? 0 : bal)}</td></tr>`);
    }
    const w2 = share2 === null ? null : share2;
    return `
      <h2>Operating reserve</h2>
      <p class="muted">Ten payments of ${money(ri.payment)} at the start of each year ${ri.reserveYear}–${ri.reserveYear + ri.payments - 1}, no inflation adjustment. The reserve is what must be set aside at the start of ${ri.reserveYear} so that, earning the assumed Treasury yield, it covers every payment.</p>
      <div class="card form-grid">
        ${field("settings.treasuryYield", "Assumed Treasury yield (%)", { hint: "Editable default 3.5%. Check the current yield." })}
        ${field("settings.reserveShare2", `Share of the ${ri.year2} contribution put in safe assets (%)`)}
        ${field("settings.countTipsInReserve", "Count TIPS toward the reserve", { type: "bool" })}
      </div>
      <div class="tiles">
        <div class="tile"><div class="label">Reserve needed, start of ${ri.reserveYear}</div><div class="value">${money(rp.reserve)}</div><div class="hint">PV of an annuity due at ${pct(ri.rate * 100, 2)}</div></div>
        <div class="tile"><div class="label">Cost if all bought at start of ${ri.year1}</div><div class="value">${money(rp.pvAtYear1)}</div><div class="hint">vs ${money(ri.contrib1)} contributed then</div></div>
        <div class="tile"><div class="label">Safe share needed of both contributions</div><div class="value">${pct(rp.uniformShare * 100)}</div><div class="hint">same % of ${money(ri.contrib1)} and ${money(ri.contrib2)}</div></div>
        <div class="tile"><div class="label">${ri.year1} safe share if ${w2 === null ? "?" : w2 + "%"} of ${ri.year2} is safe</div><div class="value">${rp.share1Given2 === null ? "–" : pct(Math.max(0, rp.share1Given2) * 100)}</div><div class="hint">of the ${money(ri.contrib1)}</div></div>
      </div>
      <div class="card">
        <h3>Are our safe holdings on track?</h3>
        <p class="muted small">Applies a safe weight to both real contributions (${money(ri.contrib1)} in ${ri.year1}, ${money(ri.contrib2)} in ${ri.year2}), compounds it at the yield to ${ri.reserveYear}, and compares with the reserve. WInS gains and losses are not carried into this projection; only the weights are.</p>
        <div class="table-wrap"><table><thead><tr><th>Allocation</th><th class="num">Safe weight</th><th class="num">Safe value in ${ri.reserveYear}</th><th>vs reserve</th></tr></thead><tbody>
          ${statusRow("Current WInS holdings (confirmed)", safeWeight(hNow), hNow.cash > 0 ? "Cash counts as not safe." : "")}
          ${statusRow("WInS holdings incl. planned trades", safeWeight(hPlan), "")}
          ${statusRow("Target allocation (Settings)", tgt, "")}
        </tbody></table></div>
      </div>
      <div class="card"><details><summary>Draw-down schedule at ${pct(ri.rate * 100, 2)}</summary>
        <div class="table-wrap"><table><thead><tr><th class="num">Year</th><th class="num">Balance before payment</th><th class="num">Payment</th><th class="num">Balance after a year's interest</th></tr></thead><tbody>${sched.join("")}</tbody></table></div></details></div>
      <div class="card"><h3>Assumptions</h3><ul class="small">
        <li>Safe assets earn exactly the assumed yield every year, ${ri.year1}–${ri.reserveYear + ri.payments - 1}. Treasury funds such as IEF and IEI change price when rates move, so this is only "locked" if the holdings are matched to the payment dates (for example a Treasury ladder) or held to maturity.</li>
        <li>Contributions arrive at the start of ${ri.year1} and ${ri.year2}; nothing else goes in or out before ${ri.reserveYear}.</li>
        <li>No taxes, fees or inflation adjustment, as the case states.</li>
      </ul></div>`;
  };

  function mcInputs() {
    const s = state.settings;
    const ri = reserveInputs();
    const reserve = C.pvAnnuityDue(ri.payment, ri.rate, ri.payments);
    let weights = { safe: C.num(s.bucketTargets.safe) || 0, stocks: C.num(s.bucketTargets.stocks) || 0, tips: C.num(s.bucketTargets.tips) || 0 };
    let source = "target allocation";
    if (s.mc.allocation !== "targets") {
      const h = holdings(s.mc.allocation === "planned");
      const v = { safe: h.buckets.safe.value, stocks: h.buckets.stocks.value, tips: h.buckets.tips.value };
      if (v.safe + v.stocks + v.tips > 0) {
        weights = v;
        source = s.mc.allocation === "planned" ? "WInS holdings incl. planned trades (cash excluded)" : "confirmed WInS holdings (cash excluded)";
      } else source = "target allocation (no holdings to use yet)";
    }
    const runs = Math.max(1000, Math.min(100000, Math.round(C.num(s.mc.runs) || 1000)));
    return {
      source,
      o: {
        runs,
        seed: Math.round(C.num(s.mc.seed) || 1),
        contrib1: ri.contrib1,
        year1: ri.year1,
        contrib2: ri.contrib2,
        year2: ri.year2,
        reserveYear: ri.reserveYear,
        weights: { safe: weights.safe / 100, stocks: weights.stocks / 100, tips: weights.tips / 100 },
        ret: { safe: ri.rate, stocks: (C.num(s.stockReturn) || 0) / 100, tips: (C.num(s.tipsReturn) || 0) / 100 },
        vol: { safe: (C.num(s.safeVol) || 0) / 100, stocks: (C.num(s.stockVol) || 0) / 100, tips: (C.num(s.tipsVol) || 0) / 100 },
        policy: s.mc.policy,
        reserve,
        confidence: Math.min(0.99, Math.max(0.5, (C.num(s.mc.confidence) || 80) / 100)),
      },
    };
  }

  views.facility = function () {
    const s = state.settings;
    const { o, source } = mcInputs();
    const wsum = o.weights.safe + o.weights.stocks + o.weights.tips;
    if (!(wsum > 0)) return `<h2>Facility range estimator</h2><div class="card">${alertsHTML([{ level: "critical", text: "Allocation weights sum to zero. Set bucket targets in Settings." }])}</div>`;
    const r = C.monteCarlo(o);
    const step = C.num(s.mc.roundStep) || 1000;
    const lo = C.roundTo(r.rangeLow, step, "down");
    const hi = C.roundTo(r.rangeHigh, step, "down");
    const floor = C.roundTo(r.floorAtConfidence, step, "down");
    const conf = Math.round(o.confidence * 100);
    const maxCount = Math.max(...r.histogram.map((b) => b.count), 1);
    const hist = r.histogram.map((b) => `<div class="${b.to <= o.reserve ? "below" : ""}" style="height:${(b.count / maxCount) * 100}%" title="${money(b.from)}–${money(b.to)}: ${b.count} runs"></div>`).join("");
    const w = (x) => pct((x / wsum) * 100, 0);
    return `
      <h2>Facility range estimator</h2>
      <ul class="alerts"><li class="alert info"><span class="icon">i</span><span><strong>Estimate, not a forecast.</strong> A Monte Carlo of the ${o.year1}/${o.year2} contributions to the start of ${o.reserveYear} under the assumptions below. WInS gains and losses are not included.</span></li></ul>
      <div class="card form-grid">
        ${field("settings.mc.allocation", "Allocation", { type: "select", options: [["targets", "Target allocation"], ["confirmed", "Confirmed WInS holdings"], ["planned", "Holdings incl. planned"]] })}
        ${field("settings.mc.policy", "Policy", { type: "select", options: [["glide", "Glide path: sweep stock gains to safe yearly"], ["rebalance", "Rebalance to weights yearly"]] })}
        ${field("settings.mc.confidence", "Confidence for range (%)")}
        ${field("settings.mc.runs", "Runs (min 1,000)")}
        ${field("settings.mc.seed", "Random seed")}
        ${field("settings.mc.roundStep", "Round range to ($)")}
        ${field("settings.stockReturn", "Stock return (%/yr)")}
        ${field("settings.stockVol", "Stock volatility (%/yr)")}
        ${field("settings.treasuryYield", "Treasury yield (%/yr)")}
        ${field("settings.safeVol", "Safe volatility (%/yr)")}
        ${field("settings.tipsReturn", "TIPS return (%/yr)")}
        ${field("settings.tipsVol", "TIPS volatility (%/yr)")}
      </div>
      <div class="card">
        <h3>Suggested co-sponsor range (for ${o.reserveYear - 2})</h3>
        <p style="font-size:1.25rem;margin:.2rem 0"><strong>${money(lo)} – ${money(hi)}</strong> <span class="badge">${conf}% confidence</span></p>
        <p class="small">In ${conf}% of simulated outcomes the facility contribution (value above the operating reserve) fell between these figures, rounded down to ${money(step)}. One-sided floor: in ${conf}% of outcomes it was <strong>at least ${money(floor)}</strong> (higher than the range's low end, which leaves ${Math.round((100 - conf) / 2)}% below it).</p>
        ${r.probFunded < 0.95 ? alertsHTML([{ level: "critical", text: `The whole portfolio covers the reserve in only ${pct(r.probFunded * 100)} of runs.` }]) : ""}
      </div>
      <div class="tiles">
        <div class="tile"><div class="label">Portfolio at start of ${o.reserveYear}: P10</div><div class="value">${money(r.p10)}</div></div>
        <div class="tile"><div class="label">P50 (median)</div><div class="value">${money(r.p50)}</div></div>
        <div class="tile"><div class="label">P90</div><div class="value">${money(r.p90)}</div></div>
        <div class="tile"><div class="label">Operating reserve</div><div class="value">${money(o.reserve)}</div><div class="hint">at ${pct(o.ret.safe * 100, 2)}</div></div>
        <div class="tile"><div class="label">Left after reserve: P10 / P50 / P90</div><div class="value" style="font-size:1rem">${money(r.left10)} / ${money(r.left50)} / ${money(r.left90)}</div></div>
        <div class="tile"><div class="label">Safe + TIPS sleeve covers reserve</div><div class="value">${pct(r.probSafeFunded * 100)}</div><div class="hint">of runs · P10 ${money(r.safeP10)}</div></div>
      </div>
      <div class="card"><h3>Distribution of portfolio value, start of ${o.reserveYear}</h3>
        <div class="hist" role="img" aria-label="Histogram of simulated portfolio values; red bars fall below the reserve">${hist}</div>
        <div class="hist-axis"><span>${money(r.histogram[0] ? r.histogram[0].from : 0)}</span><span>${money(r.histogram.length ? r.histogram[r.histogram.length - 1].to : 0)}</span></div>
        <div class="legend"><span><span class="sw"></span>runs (1st–99th percentile shown)</span><span><span class="sw" style="background:var(--crit)"></span>below the reserve</span></div>
      </div>
      <div class="card"><h3>Assumptions used</h3><ul class="small">
        <li>${money(o.contrib1)} invested at the start of ${o.year1}, ${money(o.contrib2)} at the start of ${o.year2}; nothing else in or out. ${o.reserveYear - o.year1} years of growth.</li>
        <li>Allocation from ${esc(source)}: safe ${w(o.weights.safe)}, stocks ${w(o.weights.stocks)}, TIPS ${w(o.weights.tips)}. New money is split at these weights.</li>
        <li>Annual returns are independent and lognormal. Stocks: mean ${pct(o.ret.stocks * 100)}, volatility ${pct(o.vol.stocks * 100)}. Safe: ${pct(o.ret.safe * 100, 2)}, volatility ${pct(o.vol.safe * 100)}. TIPS: ${pct(o.ret.tips * 100)}, volatility ${pct(o.vol.tips * 100)}. A volatility of 0 treats that sleeve as locked at its rate.</li>
        <li>${o.policy === "glide" ? "Glide path: each year end, stock value above the dollars put into stocks moves to the safe sleeve; losses are not topped up." : "Rebalanced to the weights at the start of each year after the first."}</li>
        <li>Reserve = present value at the start of ${o.reserveYear} of the ten payments at the Treasury yield. Facility contribution = portfolio minus reserve, floored at zero.</li>
        <li>${o.runs.toLocaleString()} runs, seed ${o.seed}: the same inputs always give the same answer. No taxes, fees or inflation.</li>
      </ul></div>`;
  };

  views.deadlines = function () {
    const ds = state.deadlines.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const dl = ds
      .map((d) => {
        const n = d.date ? daysUntil(d.date) : null;
        const cls = n !== null && n < 0 ? "past" : "";
        const badge = n === null ? "" : n < 0 ? '<span class="badge">past</span>' : n <= 3 ? `<span class="badge crit">${dueText(n)}</span>` : n <= 10 ? `<span class="badge warn">${dueText(n)}</span>` : `<span class="badge">${dueText(n)}</span>`;
        return `<div class="deadline ${cls}"><div><strong>${esc(d.label)}</strong></div><div class="when">${esc(d.date)} ${badge}</div></div>`;
      })
      .join("");
    const label = (id) => (state.deadlines.find((d) => d.id === id) || {}).label || "";
    const dateOf = (id) => (state.deadlines.find((d) => d.id === id) || {}).date || "";
    const tasks = state.tasks
      .slice()
      .sort((a, b) => (a.done === b.done ? String(dateOf(a.due)).localeCompare(String(dateOf(b.due))) : a.done ? 1 : -1))
      .map(
        (t) => `<div class="task ${t.done ? "done" : ""}"><input type="checkbox" aria-label="Done" data-task="${esc(t.id)}" ${t.done ? "checked" : ""}>
          <span class="text">${esc(t.text)}${t.due ? `<div class="muted small">by ${esc(dateOf(t.due))} · ${esc(label(t.due).split(";")[0])}</div>` : ""}</span>
          <button class="small link danger" data-action="delete-task" data-id="${esc(t.id)}" aria-label="Delete task">✕</button></div>`,
      )
      .join("");
    const done = state.tasks.filter((t) => t.done).length;
    return `
      <h2>Deadlines</h2>
      <div class="grid">
        <div class="card"><h3>Key dates</h3>${dl}
          <details style="margin-top:.75rem"><summary class="small">Edit dates</summary><div class="form-grid" style="margin-top:.5rem">
            ${state.deadlines.map((d, i) => field(`deadlines.${i}.date`, d.label, { type: "date" })).join("")}
          </div></details></div>
        <div class="card"><div class="row"><h3 style="margin:0">Checklist</h3><span class="spacer"></span><span class="badge">${done} / ${state.tasks.length}</span></div>
          ${tasks}
          <form class="row" id="task-form" style="margin-top:.75rem">
            <input name="text" placeholder="New task" aria-label="New task" style="flex:1 1 12rem">
            <select name="due" aria-label="Due" style="flex:0 1 11rem"><option value="">No deadline</option>${ds.map((d) => `<option value="${esc(d.id)}">${esc(d.date)} ${esc(d.label.split(";")[0])}</option>`).join("")}</select>
            <button class="small primary" type="submit">Add</button>
          </form></div>
      </div>`;
  };

  views.settings = function () {
    const s = state.settings;
    const tg = s.bucketTargets;
    const bsum = (C.num(tg.safe) || 0) + (C.num(tg.stocks) || 0) + (C.num(tg.tips) || 0);
    const tsum = Object.values(state.tickers).reduce((a, t) => a + (C.num(t.target) || 0), 0);
    const trows = Object.entries(state.tickers)
      .map(
        ([k, t]) => `<tr>
        <td><strong>${esc(k)}</strong></td>
        <td><input type="text" data-tk="${esc(k)}" data-tkf="name" value="${esc(t.name || "")}" aria-label="${esc(k)} name"></td>
        <td><select data-tk="${esc(k)}" data-tkf="bucket" aria-label="${esc(k)} bucket">${C.BUCKETS.map((b) => `<option value="${b}" ${t.bucket === b ? "selected" : ""}>${b}</option>`).join("")}</select></td>
        <td><select data-tk="${esc(k)}" data-tkf="kind" aria-label="${esc(k)} type"><option value="etf" ${t.kind === "etf" ? "selected" : ""}>fund</option><option value="stock" ${t.kind === "stock" ? "selected" : ""}>single stock</option></select></td>
        <td style="min-width:5.5rem"><input type="number" step="any" data-tk="${esc(k)}" data-tkf="target" value="${esc(t.target === null || t.target === undefined ? "" : t.target)}" aria-label="${esc(k)} target %"></td>
        <td style="min-width:6.5rem"><input type="number" step="any" data-tk="${esc(k)}" data-tkf="mark" value="${esc(t.mark === null || t.mark === undefined ? "" : t.mark)}" aria-label="${esc(k)} price"></td>
        <td><button class="small link danger" data-action="delete-ticker" data-id="${esc(k)}" aria-label="Remove ${esc(k)}">✕</button></td></tr>`,
      )
      .join("");
    return `
      <h2>Settings &amp; data</h2>
      <div class="card"><h3>Competition unknowns</h3><p class="muted small">Not confirmed yet. Update these once WInS or the organisers confirm them.</p>
        <div class="form-grid">
          ${field("settings.startingCash", "WInS starting cash ($)")}
          ${field("settings.startingCashVerified", "Starting cash verified", { type: "bool" })}
          ${field("settings.tradeLimit", "Total trade limit (blank = none)", { hint: "200 was mentioned; unverified." })}
          ${field("settings.tradeLimitVerified", "Trade limit verified", { type: "bool" })}
          ${field("settings.intraday", "Intraday trading allowed in WInS?", { type: "select", options: [["unknown", "Unknown"], ["yes", "Yes"], ["no", "No"]], hint: "Our own rule is no day trading either way." })}
          ${field("settings.treasuryYield", "Assumed Treasury yield (%)")}
        </div></div>
      <div class="card"><h3>Rules &amp; bucket targets</h3>
        <div class="form-grid">
          ${field("settings.maxSingleStockPct", "Max single stock (% of portfolio)")}
          ${field("settings.driftBandPts", "Rebalance if stocks exceed target by (points)")}
          ${field("settings.bucketTargets.safe", "Safe target (%)")}
          ${field("settings.bucketTargets.stocks", "Stocks target (%)")}
          ${field("settings.bucketTargets.tips", "TIPS target (%)")}
        </div>
        ${Math.abs(bsum - 100) > 0.01 ? alertsHTML([{ level: "warning", text: `Bucket targets sum to ${bsum}%, not 100%.` }]) : ""}
      </div>
      <div class="card"><h3>Return assumptions</h3>
        <div class="form-grid">
          ${field("settings.stockReturn", "Stock return (%/yr)")}
          ${field("settings.stockVol", "Stock volatility (%/yr)")}
          ${field("settings.safeVol", "Safe volatility (%/yr)", { hint: "0 = locked at the yield" })}
          ${field("settings.tipsReturn", "TIPS return (%/yr)")}
          ${field("settings.tipsVol", "TIPS volatility (%/yr)")}
        </div></div>
      <div class="card"><h3>Client cash flows</h3><p class="muted small">From the case. Change only if the case changes.</p>
        <div class="form-grid">
          ${field("settings.client.contrib1", "Year 1 contribution ($)")}
          ${field("settings.client.year1", "Year 1")}
          ${field("settings.client.contrib2", "Year 2 contribution ($)")}
          ${field("settings.client.year2", "Year 2")}
          ${field("settings.client.payment", "Residency payment ($)")}
          ${field("settings.client.payments", "Number of payments")}
          ${field("settings.client.reserveYear", "First payment year")}
        </div></div>
      <div class="card"><h3>Tickers &amp; per-ticker targets</h3>
        <p class="muted small">Per-ticker targets sum to ${tsum}%. "Single stock" names are held to the ${esc(s.maxSingleStockPct)}% cap. Price is the latest price you typed in from WInS.</p>
        <div class="table-wrap"><table><thead><tr><th>Ticker</th><th>Name</th><th>Bucket</th><th>Type</th><th>Target %</th><th>Price</th><th></th></tr></thead><tbody>${trows}</tbody></table></div>
        <form class="row" id="ticker-form" style="margin-top:.75rem">
          <input name="ticker" placeholder="Ticker" aria-label="New ticker" style="flex:0 1 8rem;text-transform:uppercase" required>
          <select name="bucket" aria-label="Bucket" style="flex:0 1 8rem">${C.BUCKETS.map((b) => `<option value="${b}">${b}</option>`).join("")}</select>
          <select name="kind" aria-label="Type" style="flex:0 1 9rem"><option value="stock">single stock</option><option value="etf">fund</option></select>
          <button class="small primary" type="submit">Add ticker</button>
        </form></div>
      <div class="card"><h3>Data</h3><p class="muted small">Everything is stored in this browser only. Export a JSON backup regularly and share it with teammates; importing replaces what is here.</p>
        <div class="row">
          <button data-action="export-json">Export JSON backup</button>
          <button data-action="import-json">Import JSON backup</button>
          <button data-action="export-trades">Export trades CSV</button>
          <button data-action="import-trades">Import trades CSV</button>
          <span class="spacer"></span>
          <button class="danger" data-action="reset">Reset to seed data</button>
        </div></div>`;
  };

  /* ---------- rendering ---------- */

  function currentTab() {
    const t = location.hash.replace("#", "");
    return views[t] ? t : "dashboard";
  }

  function updateCounters(root) {
    (root || document).querySelectorAll("[data-count-for]").forEach((el) => {
      const src = document.getElementById(el.dataset.countFor);
      if (!src) return;
      const n = C.wordCount(src.value);
      const limit = el.dataset.limit ? Number(el.dataset.limit) : null;
      el.textContent = limit ? `${n} / ${limit} words${n > limit ? ` (${n - limit} over)` : ""}` : `${n} words`;
      el.classList.toggle("over", limit !== null && n > limit);
    });
  }

  function render() {
    const tab = currentTab();
    document.querySelectorAll(".tabs a").forEach((a) => a.setAttribute("aria-selected", String(a.dataset.tab === tab)));
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + tab));
    const el = document.getElementById("view-" + tab);
    // Keep focus on the same control across a re-render.
    const active = document.activeElement;
    const key = active && active.id ? "#" + CSS.escape(active.id) : null;
    el.innerHTML = views[tab]();
    updateCounters(el);
    if (key) {
      const again = $(key);
      if (again && again !== active) again.focus();
    }
  }

  /* ---------- events ---------- */

  function readBound(el) {
    const type = el.dataset.type;
    if (type === "bool") return el.checked;
    if (type === "number") return C.num(el.value);
    return el.value;
  }

  document.addEventListener("input", (e) => {
    const el = e.target;
    if (el.matches("[data-bind][data-live]")) {
      setPath(state, el.dataset.bind, readBound(el));
      save();
      updateCounters();
      return;
    }
    if (el.matches("[data-reflection]")) {
      state.notes.reflections[el.dataset.reflection] = el.value;
      save();
      updateCounters();
      const out = $("#notes-output");
      if (out) out.textContent = notesOutput();
      return;
    }
    if (el.id === "t-note") updateCounters();
  });

  document.addEventListener("change", (e) => {
    const el = e.target;
    if (el.matches("[data-bind]") && !el.matches("[data-live]")) {
      setPath(state, el.dataset.bind, readBound(el));
      save();
      render();
    } else if (el.matches("[data-mark]")) {
      const t = state.tickers[el.dataset.mark] || (state.tickers[el.dataset.mark] = { bucket: "stocks", kind: "stock", target: null });
      t.mark = C.num(el.value);
      t.markDate = t.mark === null ? "" : todayISO();
      save();
      render();
    } else if (el.matches("[data-tk]")) {
      const t = state.tickers[el.dataset.tk];
      const f = el.dataset.tkf;
      t[f] = f === "target" || f === "mark" ? C.num(el.value) : el.value;
      if (f === "mark") t.markDate = t.mark === null ? "" : todayISO();
      // Keep each trade's bucket in step with its ticker.
      if (f === "bucket") state.trades.forEach((x) => x.ticker === el.dataset.tk && (x.bucket = el.value));
      save();
      render();
    } else if (el.matches("[data-toggle]")) {
      const t = state.trades.find((x) => x.id === el.dataset.id);
      t[el.dataset.toggle] = el.checked;
      save();
      render();
    } else if (el.matches("[data-pick]")) {
      state.notes.picks[Number(el.dataset.pick)] = el.value;
      save();
      render();
    } else if (el.matches("[data-task]")) {
      const t = state.tasks.find((x) => x.id === el.dataset.task);
      t.done = el.checked;
      save();
      render();
    }
  });

  document.addEventListener("submit", (e) => {
    const form = e.target;
    e.preventDefault();
    const fd = new FormData(form);
    if (form.id === "trade-form") {
      const ticker = String(fd.get("ticker") || "").trim().toUpperCase();
      if (!ticker) return;
      const bucketChoice = String(fd.get("bucket") || "");
      if (!state.tickers[ticker]) state.tickers[ticker] = { bucket: bucketChoice || "stocks", kind: "stock", target: null, mark: null, markDate: "", name: "" };
      const t = C.completeTrade({
        id: editingTradeId || uid(),
        date: String(fd.get("date") || todayISO()),
        ticker,
        side: fd.get("side") === "sell" ? "sell" : "buy",
        dollars: C.num(fd.get("dollars")),
        shares: C.num(fd.get("shares")),
        price: C.num(fd.get("price")),
        bucket: bucketChoice || state.tickers[ticker].bucket,
        note: String(fd.get("note") || ""),
        confirmed: fd.get("confirmed") === "on",
        screenshot: fd.get("screenshot") === "on",
      });
      if (C.num(t.dollars) === null) {
        alert("Enter dollars, or shares and price.");
        return;
      }
      const i = state.trades.findIndex((x) => x.id === t.id);
      if (i >= 0) state.trades[i] = t;
      else state.trades.push(t);
      editingTradeId = null;
      save();
      render();
    } else if (form.id === "task-form") {
      const text = String(fd.get("text") || "").trim();
      if (!text) return;
      state.tasks.push({ id: uid(), text, due: String(fd.get("due") || ""), done: false });
      save();
      render();
    } else if (form.id === "ticker-form") {
      const k = String(fd.get("ticker") || "").trim().toUpperCase();
      if (!k) return;
      if (state.tickers[k]) {
        alert(`${k} is already listed.`);
        return;
      }
      state.tickers[k] = { bucket: String(fd.get("bucket")), kind: String(fd.get("kind")), target: null, mark: null, markDate: "", name: "" };
      save();
      render();
    }
  });

  const actions = {
    "edit-trade": (id) => {
      editingTradeId = id;
      render();
      $("#trade-form").scrollIntoView({ behavior: "smooth", block: "start" });
    },
    "cancel-edit": () => {
      editingTradeId = null;
      render();
    },
    "delete-trade": (id) => {
      const t = state.trades.find((x) => x.id === id);
      if (!t || !confirm(`Delete ${tradeLabel(t)}?`)) return;
      state.trades = state.trades.filter((x) => x.id !== id);
      if (editingTradeId === id) editingTradeId = null;
      save();
      render();
    },
    "delete-task": (id) => {
      state.tasks = state.tasks.filter((x) => x.id !== id);
      save();
      render();
    },
    "delete-ticker": (k) => {
      const used = state.trades.some((t) => t.ticker === k);
      if (used) {
        alert(`${k} has trades in the log. Delete those first.`);
        return;
      }
      if (!confirm(`Remove ${k}?`)) return;
      delete state.tickers[k];
      save();
      render();
    },
    "copy-notes": (_, btn) => copyText(notesOutput(), btn),
    "print-ips": () => printIPS(),
    "export-trades": () => download(`wghsic-trades-${todayISO()}.csv`, C.toCSV(state.trades, C.TRADE_COLUMNS), "text/csv"),
    "export-holdings": () => {
      const h = holdings(state.settings.includePlanned);
      const rows = h.rows.map((r) => ({ ticker: r.ticker, bucket: r.bucket, kind: r.kind, shares: r.shares, value: r.value.toFixed(2), weight_pct: r.weight.toFixed(2), target_pct: r.target === null ? "" : r.target, valued_at_cost: r.atCost }));
      rows.push({ ticker: "CASH", bucket: "", kind: "", shares: "", value: h.cash.toFixed(2), weight_pct: h.cashWeight.toFixed(2), target_pct: "", valued_at_cost: "" });
      download(`wghsic-holdings-${todayISO()}.csv`, C.toCSV(rows, ["ticker", "bucket", "kind", "shares", "value", "weight_pct", "target_pct", "valued_at_cost"]), "text/csv");
    },
    "import-trades": async () => {
      const text = await pickFile(".csv,text/csv");
      if (text === null) return;
      let trades;
      try {
        trades = C.tradesFromCSV(text);
      } catch (e) {
        alert("Could not import: " + e.message);
        return;
      }
      const replace = confirm(`${trades.length} trade(s) read.\n\nOK = replace all current trades\nCancel = add them to the current log`);
      for (const t of trades) {
        t.id = t.id && (replace || !state.trades.some((x) => x.id === t.id)) ? t.id : uid();
        if (!state.tickers[t.ticker]) state.tickers[t.ticker] = { bucket: t.bucket || "stocks", kind: "stock", target: null, mark: null, markDate: "", name: "" };
        if (!t.bucket) t.bucket = state.tickers[t.ticker].bucket;
      }
      state.trades = replace ? trades : state.trades.concat(trades);
      save();
      render();
    },
    "export-json": () => download(`wghsic-backup-${todayISO()}.json`, JSON.stringify(state, null, 2), "application/json"),
    "import-json": async () => {
      const text = await pickFile(".json,application/json");
      if (text === null) return;
      try {
        const data = JSON.parse(text);
        if (!data || typeof data !== "object" || !Array.isArray(data.trades) || !data.settings) throw new Error("not a tracker backup");
        if (!confirm("Replace everything here with this backup?")) return;
        state = mergeDefaults(data, seedState());
        editingTradeId = null;
        save();
        render();
      } catch (e) {
        alert("Could not import: " + e.message);
      }
    },
    reset: () => {
      if (!confirm("Reset to the seed data? This deletes every trade, note and setting here. Export a backup first if you need one.")) return;
      state = seedState();
      editingTradeId = null;
      save();
      render();
    },
  };

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const fn = actions[btn.dataset.action];
    if (fn) {
      e.preventDefault();
      fn(btn.dataset.id, btn);
    }
  });

  /* ---------- IPS print ---------- */

  function printIPS() {
    const ips = state.ips;
    const paras = (text) =>
      String(text || "")
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => (p.startsWith("## ") ? `<h2>${esc(p.slice(3))}</h2>` : `<p>${esc(p).replace(/\n/g, " ")}</p>`))
        .join("");
    $("#ips-print").innerHTML = `
      <h1>${esc(ips.title || "Investment Policy Statement")}</h1>
      ${ips.team ? `<p class="meta">${esc(ips.team)}</p>` : ""}
      <h2>Elevator Pitch</h2>${paras(ips.pitch)}
      <h2>Investment Policy Statement</h2>${paras(ips.body)}`;
    document.body.classList.add("print-ips");
    const done = () => {
      document.body.classList.remove("print-ips");
      window.removeEventListener("afterprint", done);
    };
    window.addEventListener("afterprint", done);
    window.print();
  }

  window.addEventListener("hashchange", () => {
    render();
    window.scrollTo(0, 0);
  });
  render();
  // Refresh countdowns if the page stays open past midnight.
  setInterval(() => {
    if (currentTab() === "dashboard" || currentTab() === "deadlines") {
      if (!document.activeElement || document.activeElement === document.body) render();
    }
  }, 60 * 60 * 1000);
})();
