#!/bin/bash
# One-time setup on a Mac: fetch the pose model, generate the Xcode project and
# install MediaPipe. Needs Xcode 15+, XcodeGen and CocoaPods:
#   brew install xcodegen cocoapods
set -euo pipefail
cd "$(dirname "$0")"
MODEL=SwingStudio/Resources/pose_landmarker_heavy.task
if [ ! -f "$MODEL" ]; then
  echo "Fetching the pose model (about 30 MB)..."
  curl -L --fail -o "$MODEL" \
    https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task
fi
xcodegen generate
pod install
echo
echo "Done. Open SwingStudio.xcworkspace in Xcode, choose your team under"
echo "Signing & Capabilities, plug in your iPhone and press Run."
