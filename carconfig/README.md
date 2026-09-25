# Carbon — vehicle build configurator

A structured vehicle and aftermarket-parts compatibility database, with a
configurator on top of it.

The product is not the 3D viewer. The product is the answer to "will this
actually fit my car, and how do you know" — the database and the rules engine
that reasons over it. The viewer exists to make an answer visible.

```bash
npm install
npm run dev          # http://localhost:3000
npm test             # the compatibility engine and the costing
npm run lint && npm run typecheck
```

## The loop this proves

Pick a car → pick a part → see the fitment checked, with reasons → see the car
change → see the cost → save or share it. Everything else is deferred until
that loop is good.

## What is here

| Path | What it is |
|---|---|
| `db/schema.sql` | The normalized Postgres schema. The long-term source of truth for the data model. |
| `src/types/` | The domain model. No React, no I/O, no dependencies. |
| `src/data/` | Seed vehicles and parts, each carrying its own provenance. |
| `src/lib/compatibility/` | The rules engine. Pure functions, one file per family of rules. |
| `src/lib/catalog/` | The repository interface and its seed-backed implementation. |
| `src/lib/pricing/`, `src/lib/performance/` | Costing and the performance estimator. |
| `src/lib/build/` | Build state, share-link encoding, browser persistence. |
| `src/components/` | UI, grouped by the thing it shows. |
| `tests/` | The engine's tests. |

## How the compatibility engine works

A rule is a pure function from `(vehicle, part, rest-of-build)` to a list of
findings. Each finding carries a status, a sentence saying why in terms of the
two things compared, the numbers it compared, and how trustworthy the data
behind it was. A part's verdict is the worst status any rule returned.

```ts
evaluateCompatibility({ vehicle, part, selected, fitment }) // → CompatibilityResult
```

Four statuses, and the ordering between them matters:

| Status | Meaning |
|---|---|
| `compatible` | Every check passed. |
| `requires_modification` | It will work, with named extra work — spacers, cancellers, a supporting part. |
| `unknown` | Nobody has established whether this fits. |
| `incompatible` | A check failed, with a reason. |

`unknown` outranks `requires_modification` when combining, so a headline verdict
never sounds more certain than the data behind it. Missing data produces
`unknown` and never `compatible` — that rule is the reason the project exists,
and `tests/compatibility.test.ts` asserts it directly.

Rules that reason from arithmetic (bolt pattern, centre bore, rim diameter) can
overrule a positive fitment record, because a catalogue being wrong does not
make 5x120 into 5x112. Rules about legality — a catless downpipe, a track tire
compound — are marked `advisory` and are deliberately excluded from the verdict:
whether a part fits and whether you may drive it are different questions, and
merging them would get both wrong.

Adding a rule means adding one file under `src/lib/compatibility/rules/`, listing
it in `DEFAULT_RULES`, and writing its tests. No UI changes.

## Data quality

**Nothing in this repository has been verified against a primary source, and
nothing in it claims to be.** Every record carries a `Provenance` — source, URL,
verification level, date — and the UI renders that level next to the figure.

| Level | In this build |
|---|---|
| `verified` | Nothing. The engine supports it; no seed data claims it. |
| `unverified` | Vehicle specs, part specs, the few fitment records. |
| `estimated` | Wheel clearance envelopes, brake clearance heuristics, all performance estimates. |
| `demo` | Every price. Invented for development. |

Some vehicles deliberately carry no clearance envelope, so the engine answers
`unknown` for them rather than guessing. Removing those gaps would make the demo
tidier and the engine less honest. `/data` says all of this in the app itself.

The performance estimator adds up manufacturers' claims, discounting any claim
whose stated prerequisites are missing from the build. It does not model
diminishing returns, so a stacked build's real figure is normally lower than
what it shows. It says so, next to the number.

## Database

`db/schema.sql` is the normalized design: manufacturers → models → generations →
trims, engines joined to trims through `vehicles`, parts with a JSONB spec
validated per category in the application layer, `vehicle_parts` for explicit
fitment claims, and `builds` / `build_parts` / `users` for saved builds.

The app does not connect to it yet. The catalogue is served from
`src/data/` through `CatalogRepository`, so moving to Postgres means writing one
more implementation of that interface and changing one line in
`src/lib/catalog/index.ts`. The schema is applied and checked in CI so the two
cannot drift apart unnoticed.

Prices are integer cents everywhere. Part cost and installation cost are kept
separate all the way to the total, because installation is the number people
forget and on a brake kit it is a fifth of the price.

## Saving and sharing

Builds save to `localStorage` — no account, nothing uploaded, and consequently
per-device and lost if browser data is cleared. Share links carry the whole build
encoded in the URL, so a link works immediately with no database and no build is
enumerable. Everything decoded from a link is schema-validated and then looked up
in the catalogue; an unrecognised slug is dropped rather than rendered. A saved
build snapshots its prices, so reopening it later shows what it cost when it was
saved.

## The 3D viewer

Every car is generated, not downloaded: there are no model files, nothing to
licence, and it renders with no network. That is what lets it cover every car
in the catalogue rather than the handful someone modelled by hand.

**The body** (`src/lib/three/body-shape.ts`) is pure math with no three.js in
it. It is a loft of superellipse cross-sections whose width, floor and roof
come from monotone (Fritsch–Carlson) curves along the car, so nothing
overshoots into a dent. The floor rides up over each wheel, which cuts the
arches; domed, leaned end caps close the nose and tail on the same surface, so
normals stay smooth end to end. A separate greenhouse sits on top. Seven body
styles (`body-styles.ts`) set the proportions: cowl, windshield rake, roof
length, backlight, tumblehome, door count, and so on.

**Faces say whose car it is.** Each make maps to a face family
(`face-styles.ts`): kidney grilles, a single-frame octagon, seven slots and
round lamps, a grille-less nose for rear-engined and electric cars, and so on.
Each family sets the headlight shape and angle, DRLs, intakes and tail lamps.
They are stylised signatures with no logos, and makes without one get a
modern default.

**Body style comes from the model when vPIC can't tell.** vPIC calls a 911 a
"car" and a Wrangler a "truck", so `model-styles.ts` names the body style for
well-known model lines. A body style is a categorical fact about a model, not a
measurement.

**Sizes come from the car.** Profiled vehicles carry their published length,
width, height and wheelbase, and the body is built to exactly those. The tests
check the surface never exceeds the published width or length and that the
arches clear the stock tires. Cars with no measurements get a typical body for
their type, and the canvas says so.

**The build changes the car:**

- Wheels and tires are drawn from their actual rolling radius, width and offset.
  A low-offset wheel pokes, and a staggered set is staggered.
- Brake kits draw rotors and calipers at their real size and colour.
- Suspension lowers and pitches the body.
- Exhausts add tips in their finish.
- Aero parts add a wing, ducktail, splitter, diffuser or skirts.
- Paint uses a clearcoated physical material.

**The studio** is built from light-formers rendered into the environment map,
not from an HDR file. It has a blurred reflective floor, contact shadows, and a
post-processing pass: ambient occlusion, bloom on the lights, AgX tone mapping
and a vignette. If the frame rate drops, quality steps down on its own.

**Real models, where we have them.** Generated bodies cover every car. Real
3D models make the popular ones look like themselves:

1. `npm run find-models` searches Sketchfab (no account needed) for every
   model line and writes the best free, downloadable matches to
   `src/data/vehicles/model-candidates.json`.
2. `SKETCHFAB_TOKEN=… npm run fetch-all-models` downloads the top candidate
   per car, checking the licence first. CC0, CC BY and CC BY-SA are
   accepted; non-commercial licences need `--allow-noncommercial`; no-derivatives
   and store licences are refused. Each model is optimised to a few MB, and
   its credit is recorded in `model-assets.json`.
3. The viewer loads the model, scales it to the car, repaints it, and swaps
   in the build's wheels when it can find all four. The licence's required
   credit is shown under the viewer.

**Adding a car to configurator quality.** Generated bodies are a fallback.
Configurator-grade models come from CAD data or expert modelling, not code.
Each car goes through the same steps:

1. **Identify the exact car:** generation, facelift, body style and trim
   (e.g. BMW M3 Competition xDrive, G80, pre-facelift, saloon), and record its
   published length, width, height and wheelbase in a measured profile.
2. **Source a model of that version.** Take a free CC0 or CC BY model from
   `model-candidates.json`, or a purchased one whose licence allows web
   display. Refuse other generations and "inspired by" models.
3. **Fetch with `--strict`.** `check-model` compares the model's height,
   width and wheelbase, each as a share of its length, with the published
   figures. A model outside tolerance (wheelbase ±2%, height ±4%) is rejected.
4. **Normalise materials.** Glass, lamp lenses, chrome, tyres, carbon,
   piano black, plastics and leather are recognised by name and given
   physically correct properties. Anything unrecognised keeps its author's
   material.
5. **Check it in the studio** from the ¾ front, side, ¾ rear, front and
   interior views. Paint, wheel swapping and aero placement get per-model
   tuning where the automatic handling guesses wrong.

A CC licence on Sketchfab is the uploader's claim. Some uploads are
extracted from games, and the uploader had no right to license them. Check
a model's page before relying on it for anything public.

`deriveViewerConfig()` turns a vehicle and a set of parts into a
`ViewerConfig`, and the viewer renders only that.

## What is deliberately not here

Accounts, real prices, retailer integrations, a public API, and a verified
fitment database. The `users` table exists and `builds.owner_id` references it,
so authentication is a matter of populating it rather than migrating everything.

## Known limitations

- Fifteen vehicles and about forty parts. Chosen to exercise the engine, not to
  be a reference.
- Clearance envelopes are estimates, and the offset and width rules lean on them
  heavily. They are the least reliable thing in the database.
- The brake-clearance heuristic (rotor diameter + 3.5in, rounded up) is
  calibrated against the kits in the seed catalogue and is not a substitute for
  a manufacturer's clearance template.
- Power estimates add claims together and will over-read on a stacked build.
- Share links grow with the build; a very large build makes a long URL.
