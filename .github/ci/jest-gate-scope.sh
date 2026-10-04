#!/usr/bin/env bash
#
# jest-gate-scope.sh: can this change affect the Jest gate?
#
# The shared rule (non-deploying-change.sh) treats scripts/** as skippable,
# because nothing `next build` compiles imports it. That is not true for Jest:
# gate suites test sources under scripts/ (scripts/bos-llm-settings.ts, the DSL
# simulator's variable-store and stub-data-generator, and more to come). So the
# gate adds one condition on top of the shared rule: any changed scripts/ file
# other than markdown runs the gate. The shared script is deliberately left
# alone, so Vercel and the other workflows keep their behaviour (SA ruling
# SA-Q1 / SC-5 in docs/workplans/TEST_STRATEGY_AND_CI_TIERING_WORKPLAN.md).
#
# Every job of tests.yml calls this from the same checkout with the same BASE,
# so the shards and the verdict job reach the same answer. If they ever did not,
# the verdict job fails closed: it then finds no result files.
#
# FAIL-OPEN like the shared rule: anything unexpected means RUN.
#
# Usage: bash .github/ci/jest-gate-scope.sh [BASE]     # default HEAD^
# Prints skip=true|false, and appends it to $GITHUB_OUTPUT when that is set.

set -uo pipefail

BASE="${1:-}"
[ -n "$BASE" ] || BASE="HEAD^"

emit() {
  echo "skip=$1"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "skip=$1" >> "$GITHUB_OUTPUT"
  fi
  exit 0
}

if ! bash .github/ci/non-deploying-change.sh "$BASE"; then
  emit false
fi

# The shared rule says skip. Re-list the same range and look for scripts/ sources.
CHANGED="$(git diff --no-renames --name-only "$BASE" HEAD -- 2>/dev/null)" || {
  echo "RUN: git diff failed for $BASE..HEAD"
  emit false
}

while IFS= read -r file; do
  case "$file" in
    scripts/*.md) ;;
    scripts/*)
      echo "RUN: $file is under scripts/, which gate suites import"
      emit false ;;
  esac
done <<< "$CHANGED"

emit true
