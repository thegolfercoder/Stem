#!/bin/bash
# One-time setup on a Mac: fetch the pose model, generate the Xcode project and
# install MediaPipe. Needs Xcode 15+, XcodeGen and CocoaPods:
#   brew install xcodegen cocoapods
set -euo pipefail
cd "$(dirname "$0")"
MODEL=SwingStudio/Resources/pose_landmarker_heavy.task
# The exact pose model the analysis was measured with (#51; swingml/swingml/assets.py).
POSE_MODEL_URL=https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task
POSE_MODEL_SHA256=64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b
if [ ! -f "$MODEL" ]; then
  echo "Fetching the pose model (about 30 MB)..."
  curl -L --fail -o "$MODEL.part" "$POSE_MODEL_URL"
  mv "$MODEL.part" "$MODEL"
fi
if [ "$(shasum -a 256 "$MODEL" | cut -d' ' -f1)" != "$POSE_MODEL_SHA256" ]; then
  echo "$MODEL is not the pose model the analysis was measured with, so it is not used." >&2
  echo "Delete it and run this again to fetch $POSE_MODEL_URL." >&2
  exit 1
fi
xcodegen generate
pod install
echo
echo "Done. Open SwingStudio.xcworkspace in Xcode, choose your team under"
echo "Signing & Capabilities, plug in your iPhone and press Run."
