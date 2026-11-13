# Freedom-to-operate and licensing: questions for counsel

Not legal advice and not conclusions. These are the questions a qualified lawyer
should answer before any commercial release, with the facts from the repository
that bear on each.

## 1. Training data licence (highest priority)

**Facts.** The shipped event model is fine-tuned on 281 GolfDB clips. GolfDB's
annotations are published under CC BY-NC 4.0; the videos are third-party YouTube
content. The model file contains learned weights, not clips or labels. The base
model was pre-trained on synthetic data generated here.

**Questions.**
1. Is a model trained on CC BY-NC-licensed annotations a derivative that inherits the
   non-commercial term? Does distributing its weights in a paid product breach it?
2. Does downloading YouTube videos to extract pose landmarks for training breach
   YouTube's terms of service or the uploaders' copyright, independent of GolfDB's licence?
3. If the answer to either is "yes" or "unclear": is retraining without GolfDB (on
   consented phone footage only) sufficient, and must models already distributed be withdrawn?
4. Would a licence from the GolfDB authors cover the annotations but not the videos?

## 2. Third-party components

**Facts.** MediaPipe (Apache 2.0) and its pose landmarker model (Google, model card
terms); mp4box.js (BSD-3-Clause, notice kept in `swingml/webapp/vendor/`); PyTorch
(BSD); OpenCV (Apache 2.0); Flask, pywebview (BSD); Ollama and the open-weight models a
user chooses to run locally (various, including Gemma terms); the browser coach calls
Claude through the host's artifact capability.

**Questions.**
5. Do the pose landmarker's model terms permit bundling it in a paid desktop app?
6. Are attribution and notice obligations met by the files as shipped (PyInstaller
   bundles, the browser page, the iPhone app)?
7. The desktop app suggests pulling `gemma3:4b` through Ollama; does suggesting a
   specific model create any obligation under that model's terms?

## 3. Patents

**Facts.** The repository's own README warns of patent risk. The product: markerless
pose estimation from a phone; temporal event detection of golf swing phases; tempo
from event timing; body-motion metrics normalised to body length; foreshortening to
estimate rotation; comparison of a golfer's swings before and after practice. The
radar research (`launchmon-py`) is a 24 GHz Doppler launch-monitor prototype.

**Questions.**
8. Is a freedom-to-operate search needed for: (a) automatic detection of golf swing
   phases from video; (b) tempo ratio measurement from video; (c) practice-and-retest
   comparison of swing metrics; (d) radar launch monitors (a crowded field)?
9. Which jurisdictions matter first (where the product is sold versus where it is
   developed)?
10. Is the GolfDB paper, or other prior art, relevant to invalidity or to the product's
    own patentability?

## 4. Trademarks and naming

11. Is "Swing Studio" clear to use in the intended markets and app stores?
12. The README has used "Launch Monitor ML"; any conflict with existing marks?

## 5. Product claims

13. Which accuracy statements may be made in marketing, given they are measured on
    broadcast footage rather than the footage users will film? (The product states the
    figure and the footage in the same sentence.)
14. The app gives practice drills and states it gives no medical advice. Is the
    disclaimer sufficient where a user reports pain in feedback?
