#!/bin/bash
# Build Swing Studio, install it in the iOS Simulator, put the sample swings in the
# Simulator's Photos and launch it. No Apple ID or signing team is needed for the
# Simulator. Needs a Mac with Xcode 15+ (with an iOS 17+ Simulator runtime),
# XcodeGen and CocoaPods:
#   brew install xcodegen cocoapods
#
#   ./run_simulator.sh                     # first available iPhone simulator
#   SIM_DEVICE="iPhone 16 Pro" ./run_simulator.sh
set -euo pipefail
cd "$(dirname "$0")"

for tool in xcodebuild xcrun xcodegen pod; do
  command -v "$tool" >/dev/null || { echo "missing: $tool (see the comment at the top)"; exit 1; }
done

# Pose model, Xcode project, MediaPipe. Skips the download if the model is there.
./setup.sh

# A simulator: the one named in SIM_DEVICE if it exists, otherwise the first iPhone.
available=$(xcrun simctl list devices available)
line=""
if [ -n "${SIM_DEVICE:-}" ]; then
  line=$(echo "$available" | grep -E "^[[:space:]]+${SIM_DEVICE} \(" | head -1 || true)
  [ -n "$line" ] || echo "no simulator called '${SIM_DEVICE}'; using the first iPhone instead"
fi
[ -n "$line" ] || line=$(echo "$available" | grep -E "^[[:space:]]+iPhone" | head -1 || true)
UDID=$(echo "$line" | grep -oE '[0-9A-F]{8}-([0-9A-F]{4}-){3}[0-9A-F]{12}' || true)
if [ -z "$UDID" ]; then
  echo "No iPhone simulator is installed. In Xcode: Settings > Components > add an iOS runtime."
  exit 1
fi
echo "Simulator: $(echo "$line" | sed -E 's/^[[:space:]]+//')"
xcrun simctl boot "$UDID" 2>/dev/null || true   # already booted is fine
open -a Simulator

echo "Building (the first build compiles MediaPipe's pods and takes a few minutes)..."
xcodebuild -workspace SwingStudio.xcworkspace -scheme SwingStudio -configuration Debug \
  -destination "id=$UDID" -derivedDataPath build/simulator build | tail -5
APP=build/simulator/Build/Products/Debug-iphonesimulator/SwingStudio.app
[ -d "$APP" ] || { echo "build produced no app at $APP"; exit 1; }

xcrun simctl install "$UDID" "$APP"
# The Simulator has no camera. The app reads swings from Photos, so the samples go there.
shopt -s nullglob
for clip in samples/*.mov samples/*.mp4 samples/*.MOV samples/*.MP4; do
  xcrun simctl addmedia "$UDID" "$clip" && echo "added to Photos: $clip"
done
xcrun simctl launch "$UDID" com.swingml.studio
echo
echo "Running. In the app: Analyse > choose a video > pick the sample swing."
echo "Coach: Ollama on this Mac is http://localhost:11434 from the Simulator."
