# Swing Studio for iPhone

Film a swing, pick it from Photos, and the iPhone finds the eight positions,
measures tempo and body motion, and keeps every swing so you can see trends.
Everything is analysed on the phone. A coach's read and a chat about your swings
come from Ollama running on your own computer, over your Wi-Fi - nothing goes to
the internet.

## Open it in Xcode straight from the download

**`SwingStudio.xcodeproj` is committed.** Download the repository (Code → Download
ZIP), unzip it, double-click `ios/SwingStudio.xcodeproj`, pick an iPhone simulator
and press **Run**. Nothing to install first; Xcode 15 or later.

That build has no pose tracker. Google ships MediaPipe for iPhone only through
CocoaPods, so it cannot come with the download. The app runs, says so on the
Analyse screen, and refuses to analyse a clip instead of guessing. Everything else
(history, practice, settings, the coach) works.

## Install it with the pose tracker, on your iPhone

You need a Mac with Xcode 15 or later. Once:

```sh
brew install xcodegen cocoapods
cd ios
./setup.sh
open SwingStudio.xcworkspace
```

From then on open **`SwingStudio.xcworkspace`**, not the `.xcodeproj`: the
workspace is what carries MediaPipe. The pose model (about 30 MB) is fetched by
`setup.sh`, or by the first build if it is missing.

In Xcode, select the **SwingStudio** target, open **Signing & Capabilities** and
choose your Apple ID as the team (a free account works; the app then needs
re-installing every 7 days). Plug in your iPhone, pick it as the destination and
press **Run**. The first time, trust the developer on the phone under
*Settings > General > VPN & Device Management*.

## Run it in the iOS Simulator

No iPhone and no Apple ID needed:

```sh
brew install xcodegen cocoapods
cd ios
./run_simulator.sh            # or SIM_DEVICE="iPhone 16 Pro" ./run_simulator.sh
```

It fetches the pose model, generates the project, installs MediaPipe, builds for
the first available iPhone simulator, installs the app, adds every video in
`ios/samples/` to the Simulator's Photos, and launches it. The Simulator has no
camera, so pick a swing from Photos (or drag any video onto the Simulator window
to add it). Pose tracking falls back to the CPU there, so a clip takes longer
than on a phone. For the coach, Ollama running on the same Mac is
`http://localhost:11434`; `OLLAMA_HOST=0.0.0.0` is not needed.

## The coach

1. Install [Ollama](https://ollama.com) on your Mac or PC.
2. `ollama pull gemma3:4b` - a small model that can see pictures (about 3 GB).
   `gemma3:12b` or `qwen2.5vl:7b` coach better if your computer can run them.
3. Let it listen on your Wi-Fi: quit the Ollama app, then run
   `OLLAMA_HOST=0.0.0.0 ollama serve`.
4. In the app, open **Settings**, enter your computer's address (for example
   `http://192.168.1.20:11434`) and tap **Check connection**.

The coach is told what a single camera can and cannot measure, and a guard drops
any sentence about club face, path, plane, spin or distance before you see it.

## Changing the project

`SwingStudio.xcodeproj` is generated from `project.yml` by XcodeGen. After adding
a file or changing `project.yml`, run `xcodegen generate` and commit the project;
`./check_project.sh` (run by CI) fails if an app file is missing from it.

## How it is built

| Part | What it is |
| --- | --- |
| `SwingCore/` | The analysis in plain Swift: features, the swing event network, the ordered decoder, measurements, error bands, handedness detection, the long-clip scan, the slow-motion retry, the practice loop's rules and log (`Practice.swift`), and the coach's prompts and guard. No Apple-only frameworks, so `swift test` runs on Linux too. |
| `SwingCore/Tests` | Holds the Swift code to the browser engine's answers on a real swing (and through them to the Python pipeline): features to 1e-5, network scores, positions, every measurement. `make_golden.py` regenerates the reference after a model change. `PracticeTests` holds the practice rules to answers the Python gave for the same swings; `make_practice_golden.py` regenerates them. |
| `SwingStudio/Pipeline` | AVFoundation reads every frame (H.264, HEVC, HDR, slow motion) the right way up; MediaPipe's pose landmarker tracks the body; the same orientation probe and candidate-stretch search as the web app. |
| `SwingStudio/Views` | Analyse, the swing (tempo, the priority after it, eight positions, measurements, coach), Practice (priority, drill, plan, retest verdict, export and erase), history with a tempo chart, the coach chat, settings. |

The model file (`SwingCore/Sources/SwingCore/Resources/model.json`) is the same
export the browser app carries, with its measured error bands.
