#!/usr/bin/env bash
# Fails on a breaking change (removed or renamed route, field or parameter,
# narrowed type) between the base branch's openapi.json and this one. The API
# has no version prefix, so changes are additive only. Needs oasdiff on PATH.
# Deliberate removals go in .github/oasdiff/allowed-breaking-changes.txt
# (see AGENTS.md).
#
# Usage: scripts/check-api-breaking.sh [base-ref]  (default: origin/main)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

base=$(git merge-base "${1:-origin/main}" HEAD)

if ! git cat-file -e "$base:openapi.json" 2>/dev/null; then
  echo "the base branch has no openapi.json yet: nothing to compare"
  exit 0
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git show "$base:openapi.json" >"$tmp/base.json"

# Warnings fail too: they include a removed parameter. Adding a muscle group
# adds a response enum value, which is additive (clients must tolerate unknown
# muscle groups), so severity-levels.txt makes it info. The override file
# allows deliberate removals at either level.
oasdiff breaking "$tmp/base.json" openapi.json \
  --fail-on WARN \
  --severity-levels .github/oasdiff/severity-levels.txt \
  --err-ignore .github/oasdiff/allowed-breaking-changes.txt \
  --warn-ignore .github/oasdiff/allowed-breaking-changes.txt
