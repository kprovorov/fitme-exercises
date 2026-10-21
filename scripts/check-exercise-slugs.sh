#!/usr/bin/env bash
# Fails when an Exercise folder on the base branch is gone from HEAD (deleted
# or renamed), naming its Exercise slug. Exercise slugs are permanent: Plans
# and Workout Sessions refer to them, so an Exercise is never removed.
# The three retired seed examples are the only exception.
#
# Usage: scripts/check-exercise-slugs.sh [base-ref]  (default: origin/main)
set -euo pipefail

base=$(git merge-base "${1:-origin/main}" HEAD)

# The Exercise folders in a commit's exercises/ (dot folders aren't Exercises).
exercise_slugs() {
  { git ls-tree -d --name-only "$1:exercises" 2>/dev/null || true; } |
    { grep -v '^\.' || true; } | sort
}

missing=$(comm -23 <(exercise_slugs "$base") <(exercise_slugs HEAD) |
  { grep -Ev '^(example-press|example-row|example-squat)$' || true; })

if [[ -n $missing ]]; then
  echo "Exercise slugs are permanent, but these Exercise folders on the base branch are missing (deleted or renamed):"
  while IFS= read -r slug; do echo "  $slug"; done <<<"$missing"
  echo "Restore them. To change an Exercise's name, edit its en/metadata.json instead."
  exit 1
fi
echo "every Exercise slug on the base branch is still here"
