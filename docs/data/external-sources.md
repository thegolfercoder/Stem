# External data and software: what exists, and what it can be used for

Surveyed 2026-09-29 for "more data from available repos, and publicly available
swing-analysis software". Licences are as stated by each project at that date;
where a project states none, it is treated as all rights reserved. Nothing below
has been added to the repository or to any training run: adopting any of it is a
licensing decision for the owner (see `docs/legal/freedom-to-operate-questions.md`).

## What Stem actually needs

1. **Labelled amateur swings filmed on phones.** Every accuracy figure today is on
   tour players in broadcast footage (GolfDB). The labels needed are the eight
   event frames per swing, on video or on per-frame pose sequences.
2. **Club position through the swing.** Toe-up and mid-follow-through are defined
   by the club and are guessed from the body; the club would also help place the
   top and impact.
3. **Reference ranges for amateurs** at each position, so the practice loop can
   suggest a focus other than tempo.

## Datasets

| Source | What it contains | Licence / access | Usable for |
|---|---|---|---|
| [GolfDB](https://github.com/wmcnally/golfdb) | 1,400 trimmed broadcast/range videos of tour pros, 8 event frames each | CC BY-NC 4.0 (non-commercial) | Already the whole training and test set. Nothing new to take. |
| [CaddieSet](https://github.com/damilab/CaddieSet) (CVPR 2025 workshop) | 1,757 shots from 8 golfers of mixed skill, 924 face-on and 833 down-the-line, with launch-monitor ball data | Repository MIT. The release is **one CSV of per-shot features** (joint-derived measures at the 8 events, plus ball data); no videos, no per-frame poses, no event frame numbers | Cannot train or test event detection. Its per-event joint features could give *amateur* reference ranges (need 3), but they are computed by the authors' own pipeline and definitions, so they are not directly comparable to Stem's measures without re-deriving. Its ball/club columns are outputs Stem must never produce. |
| [GolfSwing / GolfPose](https://github.com/MingHanLee/GolfPose) (ICPR 2024) | Motion-capture ground truth: 17 body + 5 club keypoints, 2D and 3D | **By email request** to the authors (mhlee.cs09@nycu.edu.tw); licence not stated publicly | The only public source of labelled club keypoints (need 2). Requires the owner to request access and agree its terms. Small, and lab-captured rather than phone. |
| [DHU-Golf/detect](https://github.com/DHU-Golf/detect) | Videos, grades, hit-event labels, 2D/3D pose | **No licence stated** | Not usable without the authors' permission. |
| [GolfDB copies on Kaggle](https://www.kaggle.com/datasets/marcmarais/videos-160) | Re-uploads of GolfDB | Same as GolfDB | Nothing new. |

**Conclusion.** No public dataset of labelled amateur phone swings was found. The
gap Stem most needs filled (need 1) can only be filled by collecting its own:
the desktop app's position editor and `scripts/make_labelled_dataset.py` already
turn a golfer's confirmed positions into training labels, with the consent rules
in `docs/ml/annotation-guide.md`.

## Open-source swing-analysis software

| Project | Approach | Licence | Measured accuracy |
|---|---|---|---|
| [GolfDB SwingNet](https://github.com/wmcnally/golfdb) | MobileNetV2 + bidirectional LSTM on 160x160 RGB frames; pretrained weights | CC BY-NC 4.0 | 71.5% PCE on GolfDB split 1 (its own benchmark). Trained on GolfDB splits that overlap Stem's frozen test groups, so it cannot be scored on Stem's holdout without leakage. |
| [WilliamChangg/golf-swing-analyzer](https://github.com/WilliamChangg/golf-swing-analyzer) | MediaPipe pose, classical club detection, rule-based phases | MIT (declared; no LICENSE file) | States itself that it has no labelled evaluation set and no measured accuracy. |
| [GolfPosePro](https://github.com/ryanboscobanze/GolfPosePro), [HeleenaRobert/golf-swing-analysis](https://github.com/HeleenaRobert/golf-swing-analysis), [Doug-Young/GolfSwingAI](https://github.com/Doug-Young/GolfSwingAI), [mamoonik/golf-swing](https://github.com/mamoonik/golf-swing), [RyBeau/COSC428Project](https://github.com/RyBeau/COSC428Project) | MediaPipe or OpenPose landmarks plus wrist-speed or angle rules | Varies; check each before use | None reported against labelled swings. |
| [mwangi-clinton/golfpose](https://github.com/mwangi-clinton/golfpose) | Training pipeline for body + club pose on the GolfSwing data | LICENSE present, type not checked | Reports pose error, not event timing. Needs the GolfSwing data (above). |

**Conclusion.** None of these reports accuracy on held-out labelled swings, and
the rule-based ones are the same family as the simple baselines Stem already
measured and beats (`docs/audit/baselines.json`: kinematic rules 26-33% within one
frame against the network's 48.9%). Nothing here would replace Stem's model. The
one potentially useful component is a club keypoint model, which depends on the
GolfSwing data request.

## Decisions for the owner

1. Request the GolfSwing dataset from its authors, if club tracking is wanted.
2. Whether to use CaddieSet (MIT) to derive amateur reference ranges, knowing the
   measures would first have to be re-defined to match Stem's.
3. Start collecting consented phone swings: the only route to need 1.
