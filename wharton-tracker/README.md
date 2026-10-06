# WGHSIC Trade Tracker

A trade tracker for our team in the Wharton Global High School Investment
Competition 2026-27. The client is Laura Gao. It is a static page with no
backend and no build step. It does not fetch prices or call any API. Every
price is typed in by hand from WInS.

## Running it

Open `index.html` in a browser. Double-clicking the file works. If your
browser blocks local files, serve the folder instead:

```bash
cd wharton-tracker
python3 -m http.server 8000      # then open http://localhost:8000
```

To share it with the team, put this folder on any static host (GitHub Pages,
Netlify drop). Each person's data still lives in their own browser.

## Where the data lives

Everything is saved in the browser's `localStorage` under the key
`wghsic-tracker-v1`. That data stays on one browser on one device:

- **Settings & data → Export JSON backup** saves the whole state. Do this
  regularly, and before you clear your browser or switch devices.
- **Import JSON backup** replaces everything with a backup. This is how
  teammates share one log.
- **Export / Import trades CSV** moves the trade log to and from a
  spreadsheet. The columns are `id, date, ticker, side, dollars, shares, price,
  bucket, note, confirmed, screenshot`. On import you choose to replace the
  log or add to it.
- **Export holdings CSV** (on the Dashboard) saves the current positions and
  weights.

## What's in it

| Tab | What it does |
|---|---|
| Dashboard | Holdings, cash, and value per ticker and bucket against targets, with bar charts. Warns when a single stock is over the 3% cap, stocks are more than 2 points over target, or safe assets are under target. Also flags overselling, negative cash, day trading, trades outside the trading window, and the trade limit. A toggle previews the planned trades as if they had been executed. |
| Trades | The trade log: date, ticker, buy/sell, dollars, shares, price, bucket, the Trading Note exactly as pasted into WInS, a "confirmed in WInS" checkbox and a screenshot checkbox. Enter any two of dollars, shares and price and it fills in the third. Shows trades used against the limit. |
| Trading Notes | Pick 3 trades. It shows each note, gives you a reflection box with a live word counter (red above 100 words), and builds a copyable output. |
| IPS | Editors for the 50-word pitch and the 500-word IPS, each with a live word counter. **Print / save as PDF** prints only the IPS in Times New Roman 12pt, double spaced, with 1-inch margins. |
| Reserve | The present value at the start of 2033 of ten $50,000 payments made at the start of each year, at the assumed yield. Shows the safe share of the 2027/2028 contributions needed to fund it, and checks whether current holdings, holdings with planned trades, and the targets are on track. |
| Facility range | A seeded Monte Carlo (1,000+ runs) of the portfolio at the start of 2033. Gives P10/P50/P90, what is left after the reserve, and a suggested co-sponsor range at a confidence level you choose. Every assumption is listed on the page. |
| Deadlines | Countdowns to each key date and an editable checklist. |
| Settings & data | The unknowns (starting cash, trade limit, intraday rules, Treasury yield), rule thresholds, bucket and per-ticker targets, return assumptions, client cash flows, the ticker list, and import/export. |

## Seed data

On first open the app loads the October 6 plan as **planned** trades. These
are not executed yet. Tick "confirmed in WInS" as each one fills, and add the
fill price or share count so positions are valued correctly. The plan:

- Safe: IEF $20k, IEI $20k, SGOV $5k; TIPS: TIP $5k
- Stocks, $5k each: NVDA, AAPL, MSFT, AMZN, TSM, BRK.B, JNJ, JPM

Bucket targets come from the original strategy: safe 68%, stocks 27%, TIPS 5%.
The per-ticker targets are IEF 35, IEI 33, VTI 17, VXUS 10 and TIP 5.

**The seeded settings are guesses until confirmed.** Starting cash is $100,000
and the trade limit is 200. Both are marked unverified, and so is intraday
trading. Change them in Settings once WInS confirms them.

## How the numbers are worked out

- **Reserve.** `50,000 × Σ 1/(1+r)^k` for k = 0…9. This is an annuity due
  valued at the first payment. At 3.5% it comes to $430,384.
- **Facility estimate.** Annual returns are independent and lognormal, with
  the mean and volatility set in Settings. New money is split by bucket
  weights. The default policy is a glide path: at each year end, any stock
  value above the dollars put into stocks moves to the safe sleeve. You can
  switch to annual rebalancing instead. The facility contribution is the
  portfolio value minus the reserve, floored at zero. The co-sponsor range is
  the central interval at the chosen confidence, rounded down. A fixed seed
  means the same inputs always give the same answer.
- WInS gains and losses never feed the projections. Only the allocation
  weights carry over, as the case requires.

These are estimates under stated assumptions, not forecasts.

## Tests

The calculations live in `calc.js` with no DOM access, and Node's built-in
runner tests them. Nothing to install:

```bash
cd wharton-tracker
node --test
```
