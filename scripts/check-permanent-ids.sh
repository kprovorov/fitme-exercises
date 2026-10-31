#!/usr/bin/env bash
# Fails when an Exercise or Cover folder on the base branch is gone from HEAD
# (deleted or renamed), naming its Exercise slug or Cover id. Both are
# permanent: Plans and Workout Sessions refer to Exercise slugs and Workouts to
# Cover ids, so an Exercise or a Cover is added, never removed.
#
# Usage: scripts/check-permanent-ids.sh [base-ref]  (default: origin/main)
set -euo pipefail

base=$(git merge-base "${1:-origin/main}" HEAD)

# The folders in a commit's <dir>/ (dot folders aren't content).
folders() {
  { git ls-tree -d --name-only "$1:$2" 2>/dev/null || true; } |
    { grep -v '^\.' || true; } | sort
}

failed=0

# Usage: check <dir> <what> <hint>
check() {
  local missing
  missing=$(comm -23 <(folders "$base" "$1") <(folders HEAD "$1"))
  if [[ -n $missing ]]; then
    echo "$2 are permanent, but these $1/ folders on the base branch are missing (deleted or renamed):"
    while IFS= read -r name; do echo "  $name"; done <<<"$missing"
    echo "Restore them. $3"
    failed=1
  fi
}

check exercises "Exercise slugs" "To change an Exercise's name, edit its en/metadata.json instead."
check covers "Cover ids" "A Cover is never removed; to change its muscle groups, edit its metadata.json."

if ((failed)); then
  exit 1
fi
echo "every Exercise slug and Cover id on the base branch is still here"
