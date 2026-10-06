#!/bin/bash
# The committed SwingStudio.xcodeproj must list every Swift file in the app, so
# a file added without `xcodegen generate` fails here instead of in Xcode.
set -euo pipefail
cd "$(dirname "$0")"
PBX=SwingStudio.xcodeproj/project.pbxproj
missing=0
while IFS= read -r file; do
  name=$(basename "$file")
  if ! grep -qF "/* $name in Sources */" "$PBX"; then
    echo "not in $PBX: SwingStudio/$file (run xcodegen generate and commit the project)"
    missing=1
  fi
done < <(cd SwingStudio && find . -name '*.swift' | sed 's|^\./||' | sort)
test -f SwingStudio/Info.plist || { echo "SwingStudio/Info.plist is missing"; missing=1; }
grep -qF 'XCLocalSwiftPackageReference "SwingCore"' "$PBX" || { echo "SwingCore package not referenced"; missing=1; }
exit $missing
