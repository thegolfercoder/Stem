# The scripts

Fifteen of them, which is more than the pipeline needs, because several are the
ones that were used to find something out rather than the ones that build what
ships. Kept and labelled rather than deleted: the disproved paths are the reason
the shipped pipeline looks the way it does, and a script that proved something
does not work is cheaper to keep than to re-derive.

## Building what ships

In the order they are run. `swingml/README.md` has the full sequence with the
arguments filled in.

| Script | What it does |
|---|---|
| `make_detected_dataset.py` | Renders swings to video, runs the real pose estimator over them, caches the features with exact labels. The expensive step: seconds per clip. |
| `audit_corpus.py` | Content-hashes every cached clip and fails if one appears twice. Every accuracy figure rests on the held-out set being held out. |
| `experiment.py` | One training run under one configuration, scored through `swingml.model.benchmark`. Every knob is a flag, so the record of what was run is the command line. |
| `compare.py` | Two models on the same clips, with a paired bootstrap over clips. Answers whether a difference is real rather than which number is bigger. |
| `choose_bundled_model.py` | Picks which member ships. The real clip is a gate here, not a tiebreak. |
| `calibrate_events.py` | Measures error bands for exact weights, on clips those weights never trained on, and binds them to a fingerprint of the weights. |
| `export_web_model.py` | Weights and settings as one JSON the browser can carry. |
| `build_web_app.py` | The self-contained page: modules and weights inlined into one file. |

## Looking at one clip or one build

| Script | What it does |
|---|---|
| `analyse.py` | One clip through the pipeline, printed. |
| `demo_end_to_end.py` | Every stage in sequence, to catch an assembly that is wrong while each part passes its own tests. |
| `make_test_clips.py` | Fifteen synthetic clips shaped like real footage, three of which contain no swing and should be refused. |
| `evaluate_clips.py` | Scores a directory of clips, reporting refusals rather than only average error. |

## Superseded, and why they are still here

| Script | Status |
|---|---|
| `train_events.py` | Trains on the generator's own landmarks. Superseded for anything that ships: a model trained on 12,000 clean-landmark clips scores 87.5% within one frame on clean clips and 28% on detected ones. The two are near-disjoint domains, and this script is how that was established. |
| `finetune_on_detected.py` | Fine-tuning a synthetic-pretrained model on detected clips. `experiment.py --init-from` does the same thing and is measured through the benchmark; this predates it. |
| `train_ensemble.py` | Trains five members in one go. Still works, but the shipped ensemble was built from five `experiment.py` runs, because that way each member's configuration and corpus are recorded with it. |

## The rules the results depend on

**The splits come from a named list of archives**, not from a glob over a
directory that grows. Dropping a new file into `out/detected/` used to lengthen
the pool, move the permutation, and shuffle clips between training and test
without failing anything — the numbers just quietly stopped being comparable.
New footage goes into training through `--extra-train`, which never touches
validation or test.

**Validation chooses, test is looked at once.** An idea selected on a set is
fitted to that set, loosely but really, and its score there stops being a
prediction about new footage.

**A held-out split of the same archives is not a fresh holdout.** The clearest
result this project has produced was invisible on the held-out split of the
files the previous model trained on, and reversed on 160 clips generated
afterwards. When the question is whether a change helped, generate new clips.
