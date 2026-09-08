## Hello

I build software that measures things carefully and says so when it cannot.

Most of what I write sits somewhere between quantitative research and
engineering: a model or a method that has to be *right*, wrapped in enough
tooling that someone else can check whether it is. The habit that runs through
all of it is separating what has been measured from what has been assumed, and
making the difference visible in the code rather than in a footnote.

Python and TypeScript, mostly. Currently a student.

---

### What I'm working on

**[trading-algorithm](https://github.com/thegolfercoder/trading-algorithm)** — an
event-driven backtesting framework for systematic trading research. Strategy
engine, transaction costs, slippage, position and risk management, performance
analytics. Look-ahead bias is structurally impossible rather than merely
discouraged, and two independent detectors verify it — one of them tested
against a strategy that genuinely cheats.

The results are the honest part: on the included data, equal-weight
buy-and-hold beat every strategy in the repository out of sample, and the best
Sharpe ratio it found is not distinguishable from luck once it is deflated for
having been picked as the best of six. That is in the README rather than buried.

**[ai-model-database](https://github.com/thegolfercoder/ai-model-database)** — a
source-verified catalogue of AI models and tools organised by what they are
*for*, with a command-line recommendation layer. Every entry cites the
provider's own documentation, records the date a person last checked it, and
lists what the thing is bad at. Nothing claims to be the best at anything — the
validator rejects the claim unless it is cited.

**[rubiks-cube-trainer](https://github.com/thegolfercoder/rubiks-cube-trainer)** —
an interactive 3D cube that solves itself two ways and teaches you to do it.
Kociemba's two-phase algorithm finds about 21 moves and explains nothing; the
layer-by-layer method finds about 150 and every one belongs to a step you could
follow with a cube in your hands. Both ship, because they are answers to
different questions.

**[Stem](https://github.com/thegolfercoder/Stem)** — measuring a golf swing
without a launch monitor's price tag. Pose estimation and a temporal model over
the eight swing events, plus radar DSP for a 24 GHz Doppler front end. It
reports a measured error band beside every number and refuses to report the
things one uncalibrated camera cannot measure.

---

### How I work

- **A refusal is a result.** When a pipeline cannot measure something it says so
  and why, rather than substituting a guess. The proportion of inputs that
  produce no reading is a number worth reporting.
- **No invented figures.** No accuracy claim, tolerance or benchmark appears in
  a README unless it came from data that is in the repository or from a source
  that is cited.
- **Tests that could fail.** A leak detector that has never caught anything is
  not known to work, so the suites here include deliberately broken inputs and
  assert that the checks catch them.
- **The interesting parts are the failures.** Every one of these repositories
  documents bugs its own tests found, because those are the parts that say
  something about how the code was built.

Reachable at shalinione@gmail.com.
