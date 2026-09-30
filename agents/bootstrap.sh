#!/usr/bin/env bash
# Make a fresh container able to run agents/check.sh. Idempotent: a second run
# on a ready machine takes seconds. Used by the QA and Strategist sessions, whose
# containers start with nothing installed; the Builder's machine already has it.
#
# PyTorch comes from its CPU index, pinned to the version in the lockfile: the
# default Linux wheel pulls several gigabytes of CUDA libraries nobody here uses.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
LOCK=swingml/requirements-dev.lock

if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
python -m pip install -q --upgrade pip

TORCH="$(grep -E '^torch==' "$LOCK" | head -1 | cut -d= -f3)"
if ! python -c "import torch" >/dev/null 2>&1; then
  pip install -q "torch==${TORCH}" --index-url https://download.pytorch.org/whl/cpu
fi
if ! python -c "import mediapipe, cv2, scipy, pytest, ruff" >/dev/null 2>&1; then
  grep -vE '^(torch|triton|nvidia-)' "$LOCK" >"${TMPDIR:-/tmp}/stem-lock.txt"
  pip install -q -r "${TMPDIR:-/tmp}/stem-lock.txt"
fi
pip install -q -e swingml --no-deps
if [ -d launchmon-py ] && ! python -c "import launchmon, yaml" >/dev/null 2>&1; then
  pip install -q -e "launchmon-py[dev]"
fi

# MediaPipe's native runtime loads libEGL when a pose landmarker is created.
if ! ldconfig -p 2>/dev/null | grep -q libEGL.so; then
  (apt-get update -q && apt-get install -y -q libegl1 libgles2) >/dev/null 2>&1 ||
    echo "note: libEGL could not be installed; tests that run the pose estimator will skip"
fi
command -v node >/dev/null 2>&1 || echo "note: node is missing; the browser parity tests will skip"

echo "bootstrap: ready ($(python --version), torch $(python -c 'import torch; print(torch.__version__)'))"
