#!/usr/bin/env bash
# Fails on a breaking change (removed or renamed route, field or parameter,
# narrowed type) between the base branch's openapi.json and this one. The API
# has no version prefix, so changes are additive only. Needs oasdiff and jq on
# PATH. Deliberate removals go in .github/oasdiff/allowed-breaking-changes.txt
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

# severity-levels.txt raises every removal oasdiff calls info (an optional
# response field, anything deprecated first) to a warning, so all removals
# need the override.
oasdiff breaking "$tmp/base.json" openapi.json \
  --format json \
  --severity-levels .github/oasdiff/severity-levels.txt \
  --err-ignore .github/oasdiff/allowed-breaking-changes.txt \
  --warn-ignore .github/oasdiff/allowed-breaking-changes.txt \
  >"$tmp/changes.json"

# Errors and warnings (level 3 and 2) both fail. The one exception: a new
# muscle group, a new enum value of the muscle_groups response property.
# Clients must tolerate muscle groups they don't know; any other response
# enum stays closed.
jq -r '
  .[]
  | select(.level >= 2)
  | select(.id == "response-property-enum-value-added"
      and (.text | contains("`muscle_groups/items/`")) | not)
  | "\(.operation) \(.path) \(.text)  [\(.id)]"
' "$tmp/changes.json" >"$tmp/breaking.txt"

if [[ -s $tmp/breaking.txt ]]; then
  echo "breaking API changes against the base branch (the API is additive only):"
  sed 's/^/  /' "$tmp/breaking.txt"
  echo "A deliberate removal needs its line (without the [check id]) in .github/oasdiff/allowed-breaking-changes.txt: see AGENTS.md."
  exit 1
fi
echo "no breaking API changes against the base branch"
