# What this branch is

Three complete projects, staged here because they belong in three separate
repositories and the session that built them could not create any.

| Directory | Becomes | What it is |
|---|---|---|
| `trading-algorithm/` | `thegolfercoder/trading-algorithm` | Event-driven backtesting framework for systematic trading research |
| `ai-model-database/` | `thegolfercoder/ai-model-database` | Source-verified catalogue of AI models and tools, by use case |
| `rubiks-cube-trainer/` | `thegolfercoder/rubiks-cube-trainer` | Interactive 3D cube: two solvers and a seven-stage course |
| `profile/README.md` | `thegolfercoder/thegolfercoder` | The profile README |

**Do not merge this branch into `Stem`'s main.** `Stem` is the golf-swing and
radar work; these three have nothing to do with it and are only passing through.

Every commit touches exactly one project, so each splits out with its own clean
history and nothing is rewritten or lost.

---

## Splitting them out

**The split is already done.** Each project sits on its own branch of this
repository, produced by `git subtree split` and verified from a clean checkout
at the root — 231, 106 and 136 tests respectively, plus lint, types, build and
the command-line tools, all run with the project as the repository root rather
than as a subdirectory.

| Branch | Commits | Goes to |
|---|---|---|
| `project/trading-algorithm` | 4 | `thegolfercoder/trading-algorithm` |
| `project/ai-model-database` | 3 | `thegolfercoder/ai-model-database` |
| `project/rubiks-cube-trainer` | 3 | `thegolfercoder/rubiks-cube-trainer` |

Create the three repositories on GitHub — **empty**, no README, licence or
`.gitignore`, or the first push is rejected as a non-fast-forward. Then:

```bash
for p in trading-algorithm ai-model-database rubiks-cube-trainer; do
  git clone --branch "project/$p" --single-branch \
    https://github.com/thegolfercoder/Stem.git "$p"
  git -C "$p" push "https://github.com/thegolfercoder/$p.git" "project/$p:main"
done
```

Each clone carries only that project's history — the trading one is 3.4 MB and
four commits, with none of Stem in it.

`scripts/split-repos.sh` regenerates the branches from scratch if you would
rather not trust the ones already pushed. It produces the same three commits.

### The profile README

`thegolfercoder/thegolfercoder` is the repository GitHub reads for the block at
the top of your profile page. The name has to match your username exactly.

```bash
mkdir profile-repo && cd profile-repo
git init -b main
cp ../profile/README.md .
git add README.md
git commit -m "Add a profile README"
git remote add origin https://github.com/thegolfercoder/thegolfercoder.git
git push -u origin main
```

Read it before you push it. It says you are a student and gives your email; both
are easy to change and neither should go up if you would rather they did not.

---

## The things a push cannot do

Descriptions, topics and pins are repository settings, not files, and have to be
set in the web interface.

### Descriptions

Paste these into the **About** box (the gear beside it on each repository page).

**trading-algorithm**
> Event-driven backtesting framework for systematic trading research in Python. Strategy engine, transaction costs, slippage, risk management and performance analytics, with look-ahead bias prevented structurally and verified by two independent detectors.

**ai-model-database**
> A source-verified catalogue of AI models and tools, organised by what they are for. Every entry cites the provider's own documentation, records when it was last checked, and says what the thing is bad at.

**rubiks-cube-trainer**
> An interactive 3D Rubik's cube that solves itself two ways — Kociemba's two-phase algorithm and the layer-by-layer method — and teaches you to do it yourself.

**Stem**
> Measuring a golf swing without a launch monitor's price tag: pose estimation and a temporal event model from a single phone camera, plus radar DSP for a 24 GHz Doppler front end.

### Topics

**trading-algorithm**
`quantitative-finance` `backtesting` `algorithmic-trading` `python` `pandas`
`numpy` `quantitative-research` `financial-analysis`

**ai-model-database**
`ai` `llm` `machine-learning` `dataset` `catalogue` `python` `cli`
`json-schema`

**rubiks-cube-trainer**
`rubiks-cube` `typescript` `threejs` `webgl` `algorithms` `kociemba`
`visualization` `education`

**Stem**
`computer-vision` `pose-estimation` `signal-processing` `dsp` `pytorch`
`mediapipe` `golf` `python`

### Pins

Profile page → **Customize your pins** → choose, in this order:

1. `trading-algorithm`
2. `ai-model-database`
3. `rubiks-cube-trainer`
4. `Stem`

### Bio

The profile bio is a separate field (Settings → Public profile), 160 characters:

> Student. Quantitative research, AI tooling and computer vision — mostly Python and TypeScript. I try to keep measured and assumed clearly apart.

### GitHub Pages

`rubiks-cube-trainer` is a web application and deploys itself. In its settings:
**Pages → Source → GitHub Actions**. The workflow already in the repository
publishes `dist/` on every push to `main`.

---

## Two suggestions I have not acted on

**`Stem` is a vague name.** Nothing on the repository page says what it is
until someone reads the README, and a name is the first thing anyone reads.
`swing-analysis` or `launch-monitor` would say something. Renaming is free —
GitHub redirects the old URL — but it is your project and your call, so it has
not been touched.

**`Stem` holds two unrelated projects.** `swingml/` and `launchmon-py/` share a
set of principles and no code, and the README says so. Splitting them would
give each a name and a description of its own. It would also lose the shared
context that makes the pair make sense, which is a real argument for leaving it
alone.
