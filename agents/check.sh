#!/usr/bin/env bash
# Every check a push must pass, in one command. The Builder runs it before every
# push and QA runs it on every commit range it reviews, so "it passed" means the
# same thing to both. CI runs the same checks (.github/workflows/checks.yml).
#
#   agents/check.sh            everything this machine can run
#   agents/check.sh --quick    lint, types and the loop's own tests only
#
# Swift: the SwingCore tests run when a `swift` is on PATH or STEM_SWIFT points
# at a toolchain's bin directory; otherwise they are reported as not run, never
# as passed. CI runs them on macOS either way.
#
# The page tests (swingml/tests/test_page.py) drive the page in Chromium, built
# by the tests themselves from webapp/ so they never test a stale build. They run
# when `python -m tests.browser` finds Playwright and a Chromium (bootstrap.sh
# installs Playwright), and are then required: one that cannot run fails the
# step instead of skipping.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [ -f .venv/bin/activate ]; then
  # shellcheck disable=SC1091
  source .venv/bin/activate
fi
if [ -n "${STEM_SWIFT:-}" ]; then
  export PATH="$STEM_SWIFT:$PATH"
fi

QUICK=0
[ "${1:-}" = "--quick" ] && QUICK=1

declare -a RESULTS=()
FAILED=0
step() {
  local name="$1"
  shift
  local started=$SECONDS
  local log
  log="$(mktemp)"
  if "$@" >"$log" 2>&1; then
    RESULTS+=("PASS  $name ($((SECONDS - started))s)")
  else
    RESULTS+=("FAIL  $name ($((SECONDS - started))s)")
    FAILED=1
    echo "---- $name failed; last 40 lines ----"
    tail -40 "$log"
  fi
  rm -f "$log"
}

step "agents: loop tests" python -m pytest -q agents/tests
step "agents: config" python agents/loop.py config
step "agents: lint" ruff check --config swingml/pyproject.toml agents
step "swingml: ruff" bash -c "cd swingml && ruff check . && ruff format --check ."
step "swingml: mypy" bash -c "cd swingml && mypy -p swingml -p synth && mypy scripts"
step "webapp: syntax" bash -c "for f in swingml/webapp/*.js swingml/tests/js/*.mjs; do node --check \"\$f\" || exit 1; done"

if [ "$QUICK" = 0 ]; then
  step "swingml: web payload" bash -c "cd swingml && python scripts/export_web_model.py"
  step "swingml: pytest" bash -c "cd swingml && python -m pytest -q -rs --ignore=tests/test_page.py"
  if browser="$(cd swingml && python -m tests.browser 2>&1)"; then
    step "web: page tests" bash -c "cd swingml && STEM_PAGE_TESTS=required python -m pytest -q -rs tests/test_page.py"
  else
    RESULTS+=("SKIP  web: page tests (${browser##*$'\n'})")
  fi
  if [ -d launchmon-py ]; then
    step "launchmon: checks" bash -c "cd launchmon-py && ruff check . && ruff format --check . && mypy -p launchmon && python -m pytest -q"
  fi
  if command -v swift >/dev/null 2>&1; then
    step "ios: swift test" bash -c "cd ios/SwingCore && swift test --scratch-path \"\${TMPDIR:-/tmp}/stem-swift-build\""
  else
    RESULTS+=("SKIP  ios: swift test (no Swift toolchain here; CI runs it on macOS)")
  fi
fi

echo
echo "== agents/check.sh at $(git rev-parse --short HEAD) =="
printf '%s\n' "${RESULTS[@]}"
if [ "$FAILED" = 0 ]; then
  echo "RESULT: PASS"
else
  echo "RESULT: FAIL"
fi
exit "$FAILED"
