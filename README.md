# Reverse Desmos

An interactive workspace that reconstructs mathematics from what you give it.
Sketch a curve, drop in a screenshot of a graph, or import a spreadsheet, and it
returns the equation most likely to have produced it — ranked, scored, and
editable.

```
┌────────────────────────────┬─────────────────┐
│                            │  Import         │
│      infinite canvas       ├─────────────────┤
│   pan · zoom · draw        │  Layers         │
│                            ├─────────────────┤
│   ╲                    ╱   │  Equation       │
│     ╲________________╱     │  y = 0.25x² − 2 │
│                            │  R² 1.000000    │
│                            │  6 candidates   │
└────────────────────────────┴─────────────────┘
```

## Standalone single-file version

`standalone/reverse-desmos.html` is the whole application in one file — open it
directly in a browser, no install and no servers. The Python engine is ported to
JavaScript: Householder QR least squares, Levenberg-Marquardt with a numeric
Jacobian, the same AICc ranking with the shared effective-sample-size
correction, the same exact-form recovery, and the OpenCV screenshot pipeline
rewritten against `ImageData`.

It recovers the generating family on 11 of the same 12 synthetic curves as the
Python engine, and runs a solve in ~300 ms rather than ~3 s, because the
optimiser is leaner than SciPy's multi-start. Differences from the full stack:
Excel import needs the bundled SheetJS in the Next.js app so only CSV/TSV/JSON
are accepted, equations render as styled HTML rather than KaTeX, and undo is a
single stack without redo.

Use the full stack when you want the test suite, the typed API, and SymPy's
symbolic guarantees; use the single file when you just want to open it.

## Running it

Two processes. Both must be running.

```bash
# Terminal 1 — fitting engine
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m uvicorn app.main:app --port 8000

# Terminal 2 — workspace
cd frontend
npm install
npm run dev        # http://localhost:3000
```

The frontend reads `NEXT_PUBLIC_API_BASE` (default `http://127.0.0.1:8000`) to
find the backend. The backend reads `ALLOWED_ORIGINS` for CORS.

```bash
cd backend && .venv/bin/python -m pytest    # 44 tests
cd frontend && npm run typecheck && npm run build
```

## What it does

**Draw → equation.** A freehand stroke is smoothed, resampled evenly along its
arc length, and fitted against the whole model library. The result is drawn over
your sketch, and every parameter gets a slider that updates the curve live.

**Screenshot → editable graph.** Upload a plot from Desmos, GeoGebra, a textbook
or a PDF. Axes and grid pitch are measured from the image, the plotted ink is
separated from the chrome, and the traced curve becomes an ordinary layer.

**Data → equation.** CSV, TSV, Excel, JSON, or pairs typed straight in. Reports
R², RMSE, standard errors, and a residual plot.

## How the answer is chosen

Fitting is the easy half; deciding *which* fit to report is the interesting one.
Ranking a quintic above a line because it has lower error would be technically
correct and useless. Three forces are combined:

| Force | Mechanism |
| --- | --- |
| Evidence | Corrected Akaike information criterion (AICc) |
| Readability | A structural cost per family, so `2x + 1` beats an equivalent-fitting mess |
| Smoothness | Explicit penalty when the curve oscillates more than the data does |

Confidence is reported as **Akaike weights** over the returned set — a
normalised measure of relative support, not an invented percentage.

Four details do most of the work:

**Effective sample size.** Information criteria assume independent
observations. A traced screenshot gives ~350 points whose residuals are
dominated by smooth systematic error, not independent noise. Untreated, an R²
difference in the fifth decimal reads as overwhelming evidence and a sinusoid
beats the parabola that actually drew the picture. Residual autocorrelation
deflates the count by the standard `n(1−ρ)/(1+ρ)` factor. It is measured **once**
per dataset, from the most accurate fit available, and applied to every
candidate — AICc values computed at different effective *n* are not comparable,
and letting each model deflate by its own correlation inverts the comparison.

**Exact-form recovery.** A fit returns `1.9999983`; a reader wants `2`. Each
parameter is offered nicer values in order of niceness, and a proposal is
accepted if either the data cannot distinguish it from the fitted value (within
2.5 standard errors) or substituting it barely moves the RSS. Remaining
parameters are re-fitted around each accepted snap. Ordering by niceness is
load-bearing: multiples of π are dense enough that, without it, `3e/4` wins over
`2` simply by landing closer to the noise.

**Ranking before prettifying.** Snapping always costs a little accuracy, so
re-scoring afterwards would penalise exactly the candidates that earned a
readable form. Ranking uses each family's best achievable fit; prettifying is
applied afterwards, to the models already chosen. Reported metrics are refreshed,
so the quoted R² always describes the curve actually drawn.

**Precision floors.** Below machine precision, RSS differences are rounding
artefacts. Without a floor, `1e-25` versus `1e-24` decides a tie that simplicity
should have decided.

### Model library

Constant · linear · quadratic · cubic · quartic · quintic · exponential ·
logarithmic · power · square root · sinusoidal · damped oscillation · logistic ·
tanh · Gaussian · inverse · rational (Möbius) · absolute value · piecewise linear
(2 and 3 segments).

Each is declared **once**, symbolically, in `backend/app/engine/models.py`.
Numeric evaluation, LaTeX, and the infix template the browser compiles all derive
from that single declaration, so the three representations cannot drift apart.
Adding a model means adding one `ModelSpec`.

## Architecture

```
backend/
  app/engine/
    models.py       Symbolic model library — one declaration per family
    preprocess.py   Clean, sort, deduplicate, decimate
    fitting.py      Three fit strategies, ranking, serialisation
    scoring.py      Metrics, effective sample size, Akaike weights
    prettify.py     Exact-form recovery and rendering
  app/vision/
    extract.py      Axis detection, curve isolation, tracing
  app/main.py       FastAPI; solves run in a threadpool

frontend/src/
  lib/expression.ts  Infix parser/compiler — no eval
  lib/viewport.ts    World <-> screen, adaptive grid
  lib/stroke.ts      Smoothing and arc-length resampling
  lib/data-import.ts CSV/TSV/JSON/XLSX
  state/workspace.ts Layers, undo/redo, fit lifecycle
  components/        Canvas, panels
```

**Why the browser compiles expressions.** The server sends each model as a
template with parameter names intact (`a*exp(b*x) + c`). The client compiles it
once into a closure, so dragging a slider re-evaluates locally at frame rate
instead of round-tripping. `eval` is not used: a hand-written parser is one file
and closes the question permanently.

**Why the canvas bypasses React.** Pan, zoom and slider drags read the store
imperatively and set a dirty flag consumed by a single `requestAnimationFrame`
loop. Dragging costs one canvas repaint, not a reconciliation of the panel tree.
The loop repaints only when marked dirty, so an idle workspace costs nothing.

**Why smoothing precedes resampling.** A moving average over unevenly spaced
points shifts a curve by an amount that depends on local spacing, so thinning
first warps the shape differently along its length. Sketching a parabola that
way produces something a cosine fits better than a quadratic — a bug this
codebase had, and the reason the order is now fixed and commented.

## Known limits

- **No OCR of axis labels.** No text engine is guaranteed present, and guessing
  tick labels wrongly is worse than asking. Axes and grid pitch are measured
  geometrically; you state what one grid square is worth. Installing
  `tesseract-ocr` would let this be inferred instead.
- **Solve time is 0.3–4s**, not instant — roughly twenty families, several with
  multi-start optimisation. Requests run in a threadpool and are cancelled when
  superseded, so the UI stays responsive, but the number is real.
- **`y = f(x)` only.** A drawn circle is detected as not single-valued and
  reported as such rather than mis-fitted. Parametric and polar are not
  implemented.
- **Screenshot extraction surfaces the longest curve** when a plot contains
  several; the others are returned by the API but not yet added as separate
  layers.
- **Charting uses a purpose-built canvas renderer**, not Plotly. The residual
  plot is a scatter, two axes and a zero line; a general charting library would
  have added bulk and a second visual language for no gain.

## Testing

44 backend tests. They assert on behaviour a user would notice — that drawing a
parabola gets you `x² − 3` and not a quintic that fits marginally better —
rather than on internal call sequences. Model recovery is checked across five
noise seeds per family, because selection under noise is probabilistic and a
single lucky seed proves nothing.
