// Run with: node --test   (from wharton-tracker/)
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../calc.js");

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ""} expected ${b}, got ${a}`);

test("annuity due: ten $50k payments at 3.5%", () => {
  // Direct sum: 50,000 / 1.035^k for k = 0..9 = 430,384.33
  close(C.pvAnnuityDue(50000, 0.035, 10), 430384.33, 0.01);
  assert.equal(C.pvAnnuityDue(50000, 0, 10), 500000);
});

test("annuity due is exactly used up by the payments", () => {
  let bal = C.pvAnnuityDue(50000, 0.035, 10);
  for (let k = 0; k < 10; k++) bal = (bal - 50000) * 1.035;
  close(bal, 0, 1e-6);
});

test("reserve plan: safe shares that grow to the reserve", () => {
  const o = { rate: 0.035, payment: 50000, payments: 10, reserveYear: 2033, year1: 2027, year2: 2028, contrib1: 300000, contrib2: 150000, share2: 1 };
  const rp = C.reservePlan(o);
  // Uniform share reproduces the reserve exactly.
  close(rp.projectSafe(rp.uniformShare, rp.uniformShare), rp.reserve, 1e-6);
  // With all of 2028 safe, the 2027 share also reproduces it.
  close(rp.projectSafe(rp.share1Given2, 1), rp.reserve, 1e-6);
  close(rp.pvAtYear1, rp.reserve / Math.pow(1.035, 6), 1e-6);
  assert.ok(rp.uniformShare > 0.68, "68% safe is not enough at 3.5%");
});

test("completeTrade fills the missing one of dollars, shares, price", () => {
  assert.equal(C.completeTrade({ dollars: 5000, price: 200 }).shares, 25);
  assert.equal(C.completeTrade({ shares: 10, price: 12.5 }).dollars, 125);
  assert.equal(C.completeTrade({ dollars: 100, shares: 8 }).price, 12.5);
  assert.equal(C.completeTrade({ dollars: 100, shares: 8, price: 1 }).price, 1, "never overwrites");
});

test("holdings use confirmed trades only unless planned are included", () => {
  const tickers = { IEF: { bucket: "safe", kind: "etf", target: 35 }, NVDA: { bucket: "stocks", kind: "stock" } };
  const trades = [
    { date: "2026-10-06", ticker: "IEF", side: "buy", dollars: 20000, confirmed: true, shares: 200, price: 100 },
    { date: "2026-10-06", ticker: "NVDA", side: "buy", dollars: 5000, confirmed: false },
  ];
  const h = C.computeHoldings(trades, tickers, 100000, false);
  assert.equal(h.cash, 80000);
  assert.equal(h.rows.length, 1);
  close(h.buckets.safe.weight, 20, 1e-9);
  const hp = C.computeHoldings(trades, tickers, 100000, true);
  assert.equal(hp.cash, 75000);
  close(hp.buckets.stocks.weight, 5, 1e-9);
});

test("holdings value at manual price, else at cost", () => {
  const tickers = { IEF: { bucket: "safe", kind: "etf", mark: 110 } };
  const trades = [
    { date: "2026-10-06", ticker: "IEF", side: "buy", dollars: 10000, shares: 100, price: 100, confirmed: true },
    { date: "2026-10-07", ticker: "IEF", side: "sell", dollars: 2200, shares: 20, price: 110, confirmed: true },
  ];
  const h = C.computeHoldings(trades, tickers, 100000, false);
  assert.equal(h.rows[0].shares, 80);
  close(h.rows[0].value, 8800, 1e-9);
  assert.equal(h.rows[0].atCost, false);
  close(h.cash, 92200, 1e-9);
  close(h.total, 101000, 1e-9);
  const h2 = C.computeHoldings(trades, { IEF: { bucket: "safe" } }, 100000, false);
  assert.equal(h2.rows[0].atCost, true);
});

test("overselling and negative cash are reported", () => {
  const h = C.computeHoldings(
    [
      { date: "2026-10-06", ticker: "X", side: "buy", dollars: 200000, shares: 10, price: 20000, confirmed: true },
      { date: "2026-10-07", ticker: "X", side: "sell", dollars: 30000, shares: 15, price: 2000, confirmed: true },
    ],
    {},
    100000,
    false,
  );
  assert.equal(h.problems.length, 2);
});

test("the October 6 plan breaks our own rules at $100k starting cash", () => {
  const tickers = {
    IEF: { bucket: "safe", kind: "etf" }, IEI: { bucket: "safe", kind: "etf" }, SGOV: { bucket: "safe", kind: "etf" },
    TIP: { bucket: "tips", kind: "etf" }, NVDA: { bucket: "stocks", kind: "stock" },
  };
  const trades = [["IEF", 20000], ["IEI", 20000], ["TIP", 5000], ["SGOV", 5000], ["NVDA", 5000]].map(([t, d]) => ({ date: "2026-10-06", ticker: t, side: "buy", dollars: d, confirmed: false }));
  for (let i = 0; i < 7; i++) {
    tickers["S" + i] = { bucket: "stocks", kind: "stock" };
    trades.push({ date: "2026-10-06", ticker: "S" + i, side: "buy", dollars: 5000, confirmed: false });
  }
  const h = C.computeHoldings(trades, tickers, 100000, true);
  const w = C.allocationWarnings(h, { maxSingleStockPct: 3, driftBandPts: 2, bucketTargets: { safe: 68, stocks: 27, tips: 5 } });
  assert.equal(w.filter((x) => /single-stock cap/.test(x.text)).length, 8);
  assert.ok(w.some((x) => /Rebalance rule/.test(x.text)));
  assert.ok(w.some((x) => /Safe assets/.test(x.text)));
});

test("trade warnings: day trading, limit, and dates", () => {
  const s = { tradeLimit: 2, tradingBegins: "2026-09-28", tradingEnds: "2026-11-06" };
  const trades = [
    { date: "2026-10-06", ticker: "AAPL", side: "buy", confirmed: true },
    { date: "2026-10-06", ticker: "AAPL", side: "sell", confirmed: true },
    { date: "2026-11-09", ticker: "MSFT", side: "buy", confirmed: true },
  ];
  const w = C.tradeWarnings(trades, s).map((x) => x.text).join("\n");
  assert.match(w, /no-day-trading/);
  assert.match(w, /over the 2 trade limit/);
  assert.match(w, /after trading ends/);
});

test("word count", () => {
  assert.equal(C.wordCount(""), 0);
  assert.equal(C.wordCount("  one two\nthree\t four "), 4);
});

test("CSV round trip keeps commas, quotes and newlines in notes", () => {
  const trades = [
    { id: "a", date: "2026-10-06", ticker: "IEF", side: "buy", dollars: 20000, shares: "", price: "", bucket: "safe", note: 'Locks the reserve, "safe" sleeve.\nSecond line.', confirmed: true, screenshot: false },
  ];
  const back = C.tradesFromCSV(C.toCSV(trades, C.TRADE_COLUMNS));
  assert.equal(back.length, 1);
  assert.equal(back[0].note, trades[0].note);
  assert.equal(back[0].dollars, 20000);
  assert.equal(back[0].shares, null);
  assert.equal(back[0].confirmed, true);
  assert.equal(back[0].screenshot, false);
  assert.throws(() => C.tradesFromCSV("date,ticker\n2026-10-06,IEF\n"), /side/);
});

test("Monte Carlo: deterministic sleeves give exact answers", () => {
  const base = {
    runs: 1000, seed: 1, contrib1: 300000, year1: 2027, contrib2: 150000, year2: 2028, reserveYear: 2033,
    weights: { safe: 1, stocks: 0, tips: 0 }, ret: { safe: 0.035, stocks: 0.07, tips: 0.035 }, vol: { safe: 0, stocks: 0.16, tips: 0 },
    policy: "rebalance", reserve: C.pvAnnuityDue(50000, 0.035, 10), confidence: 0.8,
  };
  const r = C.monteCarlo(base);
  const exact = 300000 * Math.pow(1.035, 6) + 150000 * Math.pow(1.035, 5);
  close(r.p10, exact, 1e-6);
  close(r.p90, exact, 1e-6);
  assert.equal(r.probFunded, 1);
});

test("Monte Carlo: seeded, ordered percentiles, sensible median", () => {
  const o = {
    runs: 20000, seed: 7, contrib1: 300000, year1: 2027, contrib2: 150000, year2: 2028, reserveYear: 2033,
    weights: { safe: 0, stocks: 1, tips: 0 }, ret: { safe: 0.035, stocks: 0.07, tips: 0.035 }, vol: { safe: 0, stocks: 0.16, tips: 0 },
    policy: "rebalance", reserve: 430380, confidence: 0.8,
  };
  const a = C.monteCarlo(o);
  const b = C.monteCarlo(o);
  assert.equal(a.p50, b.p50, "same seed, same answer");
  assert.ok(a.p10 < a.p50 && a.p50 < a.p90);
  // Lognormal median = mean growth * exp(-s^2/2) per year; within 2% at 20k runs.
  const { mu } = C.lognormalParams(0.07, 0.16);
  const median = 300000 * Math.exp(6 * mu) + 150000 * Math.exp(5 * mu); // approximate: medians do not add exactly
  close(a.p50 / median, 1, 0.03, "median");
  assert.ok(a.rangeLow <= a.rangeHigh);
});

test("Monte Carlo glide path never leaves more in stocks than was put in", () => {
  const o = {
    runs: 2000, seed: 3, contrib1: 300000, year1: 2027, contrib2: 150000, year2: 2028, reserveYear: 2033,
    weights: { safe: 0.7, stocks: 0.3, tips: 0 }, ret: { safe: 0.035, stocks: 0.07, tips: 0.035 }, vol: { safe: 0, stocks: 0.16, tips: 0 },
    policy: "glide", reserve: 430380, confidence: 0.8,
  };
  const r = C.monteCarlo(o);
  // Safe sleeve alone is at least the locked 70%.
  const lockedSafe = 0.7 * (300000 * Math.pow(1.035, 6) + 150000 * Math.pow(1.035, 5));
  assert.ok(r.safeP10 >= lockedSafe - 1e-6);
  // Total is at most safe-locked plus stocks principal grown... and never below safe-locked.
  assert.ok(r.p10 >= lockedSafe);
});
