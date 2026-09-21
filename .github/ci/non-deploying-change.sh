#!/usr/bin/env bash
#
# non-deploying-change.sh — is this change incapable of reaching an environment?
#
# One rule, shared by Vercel's Ignored Build Step (vercel.json "ignoreCommand")
# and the three unfiltered GitHub workflows, so "docs-only" means exactly the
# same thing to the deploy and to the gates.
#
# EXIT CODES ARE VERCEL'S, NOT INTUITION'S:
#   0 = every changed file is non-deploying  -> SKIP the build/gate
#   1 = at least one file could affect a run -> BUILD / RUN THE GATE
# Vercel documents it this way ("exit 0 to cancel the build"), and the GitHub
# steps read the exit code through an `if`, so the two stay in step.
#
# FAIL-OPEN: anything unexpected (no git range, empty diff, git error) exits 1.
# The expensive outcome is a wasted build; the unacceptable one is a skipped
# gate, so every unknown resolves toward building.
#
# ── WHAT COUNTS AS NON-DEPLOYING ──────────────────────────────────────────
#   docs/**              the documentation tree
#   *.md at repo root    README.md, CLAUDE.md, MIGRATION_GUIDE.md, ...
#   scripts/**           one-off/dev tooling: nothing under app/ or lib/
#                        imports it, so `next build` never sees it, minus the
#                        Jest suites under it (see below)
#   .claude/**           agent, skill and settings files for Claude Code
#
# ── WHAT IS DELIBERATELY *NOT* ON THAT LIST ───────────────────────────────
# `**/*.md` anywhere. Markdown is PRODUCTION CODE in this repo: the V6
# pipeline reads its system prompts off disk at runtime —
# lib/agentkit/v6/semantic-plan/prompts/formalization-system-v4.md,
# semantic-plan-system.md, hard-requirements-extraction-system.md and friends.
# Editing one changes generation behaviour. Only root-level .md and docs/**
# are safe, which is why the root rule below matches names with no slash.
#
# `supabase/SQL Scripts/**` contains the word "scripts" but is a migration
# surface the admin-authz guard scans (rule R5). The scripts/ rule is anchored
# at the repo root, so that directory never matches.
#
# scripts/typecheck-bos-llm.ts and its baseline ARE the Business OS LLM type
# gate. A change to them is a change to CI itself and must be run, so they are
# carved back out below.
#
# Tests living under scripts/ are carved back out too: the root Jest project
# has `roots: ['<rootDir>']`, so `npm test` collects
# scripts/test-dsl-execution-simulator/__tests__/*.test.ts and
# scripts/__preview__/render.test.ts. No workflow runs `npm test` today, so
# nothing is skipped by this today - the carve-out is here so that the day one
# does, it does not inherit a blind spot.
#
# RENAMES: the diff below passes --no-renames on purpose. With rename detection
# on (git's default) `git diff --name-only` prints ONLY the destination path,
# so `git mv lib/foo.ts docs/foo.ts` - which breaks every importer of the old
# path - would be reported as a lone `docs/foo.ts` and classified skippable.
# --no-renames reports both sides, so the deletion is seen and the change
# builds. A rename that stays inside docs/ still skips, as it should.
#
# This file lives in .github/ and not in scripts/ on purpose: a change to the
# skip rule itself must never be skippable by the rule it defines.
#
# ── USAGE ─────────────────────────────────────────────────────────────────
#   bash .github/ci/non-deploying-change.sh [BASE] [HEAD]      # default HEAD^ HEAD
#
# The default HEAD^..HEAD is the right range in the two cases that matter:
#   - a merge commit landing on main: HEAD^ is the previous main tip, so the
#     diff is the whole PR;
#   - a pull_request checkout (refs/pull/N/merge): HEAD^1 is the base tip, so
#     the diff is again the whole PR.
#
# It is NOT right for a push carrying several commits (a rebase-merge, a merge
# queue batch, a direct multi-commit push): HEAD^ is then the second-to-last
# commit, so a docs-only final commit would hide code in the commits before it.
# That is why the GitHub workflows pass `github.event.before` explicitly on
# push events - at fetch-depth 2 it resolves exactly when it equals HEAD^ (the
# single-commit case) and fails to resolve otherwise, which builds. On Vercel
# the same job is done by VERCEL_GIT_PREVIOUS_SHA where Vercel provides it;
# where it does not, a multi-commit preview push can skip a preview whose
# earlier commits held code. The next push rebuilds it, and "Redeploy" in the
# Vercel dashboard always forces a build.

set -uo pipefail

# Callers that know a better base pass one: the workflows pass GitHub's
# `github.event.before` on push events, so a push carrying several commits is
# measured whole. VERCEL_GIT_PREVIOUS_SHA is used when Vercel sets it. Either
# way a base that is not in the clone fails open to BUILD.
BASE="${1:-${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}}"
HEAD_REF="${2:-HEAD}"

decide_build() {
  echo "BUILD: $1"
  exit 1
}

git rev-parse --verify --quiet "${BASE}^{commit}" >/dev/null 2>&1 \
  || decide_build "cannot resolve '$BASE' (shallow clone or root commit)"

CHANGED="$(git diff --no-renames --name-only "$BASE" "$HEAD_REF" -- 2>/dev/null)" \
  || decide_build "git diff failed for $BASE..$HEAD_REF"

[ -n "$CHANGED" ] || decide_build "empty diff for $BASE..$HEAD_REF"

while IFS= read -r file; do
  [ -n "$file" ] || continue
  case "$file" in
    # CI's own gate definition — always run it.
    scripts/typecheck-bos-llm.ts|scripts/typecheck-bos-llm.baseline.json)
      decide_build "$file defines a CI gate" ;;
    # Jest suites that live under scripts/ are tests, not tooling.
    scripts/*.test.ts|scripts/*.test.tsx|scripts/*/__tests__/*)
      decide_build "$file is a test suite" ;;
    docs/*|scripts/*|.claude/*)
      ;;
    *.md)
      # Root-level markdown only: a nested path would contain a slash and fall
      # through to the catch-all below.
      case "$file" in */*) decide_build "$file (nested markdown can be a runtime prompt)" ;; esac
      ;;
    *)
      decide_build "$file" ;;
  esac
done <<< "$CHANGED"

echo "SKIP: every changed file is documentation, scripts or Claude Code config"
printf '%s\n' "$CHANGED" | sed 's/^/  - /'
exit 0
