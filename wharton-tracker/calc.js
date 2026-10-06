/*
 * Pure calculations for the trade tracker. No DOM, no storage, no network.
 * Loaded by the page as a classic script (so index.html works from file://)
 * and by Node's test runner through module.exports.
 */
(function (root) {
  "use strict";

  const BUCKETS = ["safe", "stocks", "tips"];
  const BUCKET_LABELS = { safe: "Safe (Treasuries)", stocks: "Stocks", tips: "TIPS" };

  function num(x) {
    if (x === null || x === undefined || x === "") return null;
    const n = typeof x === "number" ? x : Number(String(x).replace(/[$,\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  function round2(x) {
    return Math.round(x * 100) / 100;
  }

  function round4(x) {
    return Math.round(x * 10000) / 10000;
  }

  /* ---------- trades ---------- */

  // Any two of dollars / shares / price determine the third.
  function completeTrade(t) {
    const d = num(t.dollars);
    const s = num(t.shares);
    const p = num(t.price);
    const out = Object.assign({}, t);
    if (d !== null && p !== null && p > 0 && s === null) out.shares = round4(d / p);
    else if (s !== null && p !== null && d === null) out.dollars = round2(s * p);
    else if (d !== null && s !== null && s > 0 && p === null) out.price = round2(d / s);
    return out;
  }

  function wordCount(text) {
    const m = String(text || "").trim().match(/\S+/g);
    return m ? m.length : 0;
  }

  /* ---------- holdings ---------- */

  // trades: [{ticker, side:'buy'|'sell', dollars, shares, price, confirmed}]
  // tickers: {SYM: {bucket, kind:'etf'|'stock', target, mark}}
  // Positions are built from confirmed trades only, unless includePlanned.
  // A position is valued at shares x manual mark price where both are known;
  // any part without shares (a planned trade with only a dollar amount), or a
  // ticker with no mark price, is carried at cost and flagged as such.
  function computeHoldings(trades, tickers, startingCash, includePlanned) {
    const pos = {};
    let cash = num(startingCash) || 0;
    const problems = [];
    const used = trades.filter((t) => t.confirmed || includePlanned);
    const sorted = used.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    for (const raw of sorted) {
      const t = completeTrade(raw);
      const sym = String(t.ticker || "").trim().toUpperCase();
      if (!sym) continue;
      const d = num(t.dollars) || 0;
      const s = num(t.shares);
      const sign = t.side === "sell" ? -1 : 1;
      const p = (pos[sym] = pos[sym] || { ticker: sym, shares: 0, costShares: 0, unknownDollars: 0, lastPrice: null });
      if (s !== null) {
        if (sign < 0 && s > p.shares + 1e-9) problems.push(`Sell of ${s} ${sym} on ${t.date || "?"} exceeds shares held (${round2(p.shares)}).`);
        // Average-cost basis for the shares we know about.
        if (sign > 0) p.costShares += d;
        else if (p.shares > 0) p.costShares -= (p.costShares / p.shares) * Math.min(s, p.shares);
        p.shares += sign * s;
      } else {
        p.unknownDollars += sign * d;
      }
      if (num(t.price) !== null) p.lastPrice = num(t.price);
      cash -= sign * d;
    }
    const rows = Object.values(pos)
      .map((p) => {
        const info = tickers[p.ticker] || {};
        const mark = num(info.mark);
        const price = mark !== null ? mark : p.lastPrice;
        const sharesValue = price !== null ? p.shares * price : p.costShares;
        const value = sharesValue + p.unknownDollars;
        const atCost = mark === null || Math.abs(p.unknownDollars) > 0.005;
        return {
          ticker: p.ticker,
          bucket: info.bucket || "stocks",
          kind: info.kind || "stock",
          target: num(info.target),
          shares: round4(p.shares),
          cost: p.costShares + p.unknownDollars,
          value,
          atCost,
        };
      })
      .filter((r) => Math.abs(r.value) > 0.005 || Math.abs(r.shares) > 1e-9);
    const invested = rows.reduce((a, r) => a + r.value, 0);
    const total = invested + cash;
    for (const r of rows) r.weight = total > 0 ? (r.value / total) * 100 : 0;
    const buckets = {};
    for (const b of BUCKETS) buckets[b] = { bucket: b, value: 0, weight: 0 };
    for (const r of rows) {
      const b = (buckets[r.bucket] = buckets[r.bucket] || { bucket: r.bucket, value: 0, weight: 0 });
      b.value += r.value;
    }
    for (const b of Object.values(buckets)) b.weight = total > 0 ? (b.value / total) * 100 : 0;
    rows.sort((a, b) => b.value - a.value);
    if (cash < -0.005) problems.push(`Cash is negative (${cash.toFixed(2)}): buys exceed starting cash.`);
    return { rows, buckets, cash, total, cashWeight: total > 0 ? (cash / total) * 100 : 0, problems };
  }

  // Returns [{level:'critical'|'warning', text}]
  function allocationWarnings(h, settings) {
    const w = [];
    const cap = num(settings.maxSingleStockPct);
    const band = num(settings.driftBandPts);
    const tg = settings.bucketTargets || {};
    if (cap !== null) {
      for (const r of h.rows) {
        if (r.kind === "stock" && r.weight > cap + 1e-9)
          w.push({ level: "critical", text: `${r.ticker} is ${r.weight.toFixed(2)}% of the portfolio, above the ${cap}% single-stock cap.` });
      }
    }
    const st = num(tg.stocks);
    if (st !== null && band !== null && h.buckets.stocks.weight > st + band + 1e-9)
      w.push({
        level: "critical",
        text: `Stocks are ${h.buckets.stocks.weight.toFixed(1)}% vs ${st}% target: more than ${band} points over. Rebalance rule triggered.`,
      });
    const sf = num(tg.safe);
    if (sf !== null && h.buckets.safe.weight < sf - 1e-9)
      w.push({ level: "warning", text: `Safe assets are ${h.buckets.safe.weight.toFixed(1)}% vs ${sf}% target.` });
    for (const p of h.problems) w.push({ level: "critical", text: p });
    return w;
  }

  // Trade-hygiene checks that do not depend on prices.
  function tradeWarnings(trades, settings) {
    const w = [];
    const byDay = {};
    for (const t of trades) {
      if (!t.confirmed) continue;
      const k = `${t.date}|${String(t.ticker).toUpperCase()}`;
      (byDay[k] = byDay[k] || new Set()).add(t.side);
    }
    for (const [k, sides] of Object.entries(byDay)) {
      if (sides.has("buy") && sides.has("sell")) {
        const [d, s] = k.split("|");
        w.push({ level: "critical", text: `${s} was bought and sold on ${d}: our no-day-trading rule.` });
      }
    }
    const end = settings.tradingEnds;
    const start = settings.tradingBegins;
    for (const t of trades) {
      if (end && t.date && t.date > end) w.push({ level: "warning", text: `${t.ticker} ${t.side} dated ${t.date} is after trading ends (${end}).` });
      if (start && t.date && t.date < start) w.push({ level: "warning", text: `${t.ticker} ${t.side} dated ${t.date} is before trading began (${start}).` });
    }
    const limit = num(settings.tradeLimit);
    if (limit !== null && limit > 0) {
      const used = trades.filter((t) => t.confirmed).length;
      const planned = trades.filter((t) => !t.confirmed).length;
      if (used > limit) w.push({ level: "critical", text: `${used} trades confirmed: over the ${limit} trade limit.` });
      else if (used + planned > limit) w.push({ level: "warning", text: `Confirmed plus planned trades (${used + planned}) would exceed the ${limit} limit.` });
      else if (used >= 0.9 * limit) w.push({ level: "warning", text: `${used} of ${limit} trades used.` });
    }
    return w;
  }

  /* ---------- reserve ---------- */

  // Present value at the first payment date of n level payments made at the
  // start of each year (an annuity due).
  function pvAnnuityDue(payment, rate, n) {
    if (Math.abs(rate) < 1e-12) return payment * n;
    return payment * ((1 - Math.pow(1 + rate, -n)) / rate) * (1 + rate);
  }

  // Contributions land at the start of their years; the reserve is needed at
  // the start of reserveYear. Returns the reserve and the safe share that,
  // compounding at the yield, grows exactly to it.
  function reservePlan(o) {
    const r = o.rate;
    const reserve = pvAnnuityDue(o.payment, r, o.payments);
    const g1 = Math.pow(1 + r, o.reserveYear - o.year1);
    const g2 = Math.pow(1 + r, o.reserveYear - o.year2);
    const fv1 = o.contrib1 * g1; // 2027 money, all of it, at the yield
    const fv2 = o.contrib2 * g2;
    // Same safe share of both contributions.
    const uniformShare = reserve / (fv1 + fv2);
    // 2028 money at a chosen safe share; what 2027 share is then needed?
    const s2 = o.share2 === null || o.share2 === undefined ? null : o.share2;
    const share1Given2 = s2 === null ? null : (reserve - s2 * fv2) / fv1;
    const pvAtYear1 = reserve / g1; // what it costs if all of it were bought at the first contribution
    const projectSafe = (share1, share2) => share1 * fv1 + share2 * fv2;
    return { reserve, uniformShare, share1Given2, pvAtYear1, fv1, fv2, projectSafe };
  }

  /* ---------- Monte Carlo ---------- */

  // Small, fast, seedable PRNG so a given set of inputs always gives the same answer.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function normal(rand) {
    let u = 0;
    while (u === 0) u = rand();
    const v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // One-year gross return, lognormal, with arithmetic mean `mean` and
  // standard deviation `vol` (both as decimals).
  function lognormalParams(mean, vol) {
    const s2 = Math.log(1 + (vol * vol) / ((1 + mean) * (1 + mean)));
    return { mu: Math.log(1 + mean) - s2 / 2, sigma: Math.sqrt(s2) };
  }

  function percentile(sorted, p) {
    if (!sorted.length) return NaN;
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }

  // o: { runs, seed, contrib1, year1, contrib2, year2, reserveYear,
  //      weights:{safe,stocks,tips} (fractions), ret:{...}, vol:{...},
  //      policy:'rebalance'|'glide', reserve, confidence }
  function monteCarlo(o) {
    const rand = mulberry32(o.seed);
    const ws = o.weights;
    const wsum = ws.safe + ws.stocks + ws.tips;
    const w = { safe: ws.safe / wsum, stocks: ws.stocks / wsum, tips: ws.tips / wsum };
    const p = {};
    for (const b of BUCKETS) p[b] = lognormalParams(o.ret[b], o.vol[b]);
    const totals = new Float64Array(o.runs);
    const safes = new Float64Array(o.runs);
    let funded = 0;
    let safeFunded = 0;
    for (let i = 0; i < o.runs; i++) {
      const v = { safe: 0, stocks: 0, tips: 0 };
      let stockPrincipal = 0;
      for (let y = o.year1; y < o.reserveYear; y++) {
        let add = 0;
        if (y === o.year1) add += o.contrib1;
        if (y === o.year2) add += o.contrib2;
        if (add) {
          for (const b of BUCKETS) v[b] += add * w[b];
          stockPrincipal += add * w.stocks;
        }
        if (o.policy === "rebalance" && y > o.year1) {
          const tot = v.safe + v.stocks + v.tips;
          for (const b of BUCKETS) v[b] = tot * w[b];
        }
        for (const b of BUCKETS) {
          const z = p[b].sigma > 0 ? normal(rand) : 0;
          v[b] *= Math.exp(p[b].mu + p[b].sigma * z);
        }
        // Glide path: at each year end, sweep stock value above the money put
        // into stocks over to the safe sleeve. Stocks never re-grow past principal.
        if (o.policy === "glide" && v.stocks > stockPrincipal) {
          v.safe += v.stocks - stockPrincipal;
          v.stocks = stockPrincipal;
        }
      }
      const tot = v.safe + v.stocks + v.tips;
      totals[i] = tot;
      safes[i] = v.safe + v.tips;
      if (tot >= o.reserve) funded++;
      if (v.safe + v.tips >= o.reserve) safeFunded++;
    }
    const st = Array.from(totals).sort((a, b) => a - b);
    const ss = Array.from(safes).sort((a, b) => a - b);
    const c = o.confidence;
    const lo = (1 - c) / 2;
    const left = (q) => Math.max(0, percentile(st, q) - o.reserve);
    return {
      runs: o.runs,
      p10: percentile(st, 0.1),
      p50: percentile(st, 0.5),
      p90: percentile(st, 0.9),
      safeP10: percentile(ss, 0.1),
      safeP50: percentile(ss, 0.5),
      left10: left(0.1),
      left50: left(0.5),
      left90: left(0.9),
      rangeLow: left(lo),
      rangeHigh: left(1 - lo),
      floorAtConfidence: left(1 - c),
      probFunded: funded / o.runs,
      probSafeFunded: safeFunded / o.runs,
      histogram: histogram(st, 24),
    };
  }

  function histogram(sorted, bins) {
    if (!sorted.length) return [];
    const lo = percentile(sorted, 0.01);
    const hi = percentile(sorted, 0.99);
    const width = (hi - lo) / bins || 1;
    const out = Array.from({ length: bins }, (_, i) => ({ from: lo + i * width, to: lo + (i + 1) * width, count: 0 }));
    for (const x of sorted) {
      const i = Math.min(bins - 1, Math.max(0, Math.floor((x - lo) / width)));
      out[i].count++;
    }
    return out;
  }

  function roundTo(x, step, mode) {
    const f = mode === "down" ? Math.floor : mode === "up" ? Math.ceil : Math.round;
    return f(x / step) * step;
  }

  /* ---------- CSV ---------- */

  const TRADE_COLUMNS = ["id", "date", "ticker", "side", "dollars", "shares", "price", "bucket", "note", "confirmed", "screenshot"];

  function csvEscape(v) {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function toCSV(rows, columns) {
    const lines = [columns.join(",")];
    for (const r of rows) lines.push(columns.map((c) => csvEscape(r[c])).join(","));
    return lines.join("\r\n") + "\r\n";
  }

  // RFC 4180: quoted fields may contain commas, quotes ("") and newlines.
  function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = "";
    let q = false;
    const s = String(text).replace(/^﻿/, "");
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (q) {
        if (ch === '"') {
          if (s[i + 1] === '"') {
            field += '"';
            i++;
          } else q = false;
        } else field += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && s[i + 1] === "\n") i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else field += ch;
    }
    if (field !== "" || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows.filter((r) => r.some((c) => c.trim() !== ""));
  }

  function tradesFromCSV(text) {
    const rows = parseCSV(text);
    if (!rows.length) return [];
    const head = rows[0].map((h) => h.trim().toLowerCase());
    const missing = ["date", "ticker", "side"].filter((c) => !head.includes(c));
    if (missing.length) throw new Error(`CSV is missing column(s): ${missing.join(", ")}`);
    const truthy = (v) => /^(1|true|yes|y|x)$/i.test(String(v || "").trim());
    return rows.slice(1).map((r, i) => {
      const o = {};
      head.forEach((h, j) => (o[h] = r[j] === undefined ? "" : r[j]));
      const side = String(o.side).trim().toLowerCase();
      if (side !== "buy" && side !== "sell") throw new Error(`Row ${i + 2}: side must be buy or sell, got "${o.side}"`);
      return {
        id: o.id || null,
        date: String(o.date).trim(),
        ticker: String(o.ticker).trim().toUpperCase(),
        side,
        dollars: num(o.dollars),
        shares: num(o.shares),
        price: num(o.price),
        bucket: String(o.bucket || "").trim().toLowerCase() || null,
        note: o.note || "",
        confirmed: truthy(o.confirmed),
        screenshot: truthy(o.screenshot),
      };
    });
  }

  const Calc = {
    BUCKETS,
    BUCKET_LABELS,
    TRADE_COLUMNS,
    num,
    completeTrade,
    wordCount,
    computeHoldings,
    allocationWarnings,
    tradeWarnings,
    pvAnnuityDue,
    reservePlan,
    mulberry32,
    lognormalParams,
    percentile,
    monteCarlo,
    roundTo,
    toCSV,
    parseCSV,
    tradesFromCSV,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = Calc;
  else root.Calc = Calc;
})(typeof self !== "undefined" ? self : this);
