#!/usr/bin/env bash
#
# Split the three projects staged on this branch into their own repositories.
#
# They were built here because the session that wrote them could not create
# repositories, and each one belongs at the top level of its own. Every commit
# touches exactly one project, so `git subtree split` produces a clean history
# for each with no rewriting and nothing lost.
#
# Before running this, create three empty repositories on GitHub - no README,
# no licence, no .gitignore, or the first push will be rejected as a non-fast
# forward:
#
#     trading-algorithm
#     ai-model-database
#     rubiks-cube-trainer
#
# Then:
#
#     bash scripts/split-repos.sh                # make the branches, push nothing
#     bash scripts/split-repos.sh --push USER    # make them and push
#
set -euo pipefail

PROJECTS=(trading-algorithm ai-model-database rubiks-cube-trainer)

PUSH=0
OWNER=""
if [ "${1:-}" = "--push" ]; then
  PUSH=1
  OWNER="${2:?usage: split-repos.sh --push <github-username>}"
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "The working tree has uncommitted changes. Commit or stash them first." >&2
  exit 1
fi

for project in "${PROJECTS[@]}"; do
  if [ ! -d "$project" ]; then
    echo "skipping $project: not on this branch"
    continue
  fi

  branch="split/$project"
  echo
  echo "=== $project ==="
  git branch -D "$branch" 2>/dev/null || true
  git subtree split --prefix="$project" -b "$branch"

  count=$(git rev-list --count "$branch")
  echo "$branch has $count commit(s)"

  if [ "$PUSH" -eq 1 ]; then
    remote="https://github.com/$OWNER/$project.git"
    echo "pushing to $remote"
    git push "$remote" "$branch:main"
  fi
done

echo
if [ "$PUSH" -eq 1 ]; then
  cat <<'DONE'
Pushed. Three things are left, and none of them can be done from a git push:

  1. Set each repository's description and topics (Settings, or the gear beside
     "About" on the repository page). Suggested text is in PORTFOLIO.md.
  2. Pin the three repositories on your profile: profile page, "Customize your
     pins".
  3. For rubiks-cube-trainer, turn on GitHub Pages with the source set to
     "GitHub Actions". The workflow deploys the built site on every push to main.
DONE
else
  echo "Branches created. Re-run with --push <username> to push them,"
  echo "or push each yourself:"
  for project in "${PROJECTS[@]}"; do
    echo "  git push https://github.com/<you>/$project.git split/$project:main"
  done
fi
