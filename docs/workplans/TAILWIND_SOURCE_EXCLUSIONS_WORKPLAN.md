# Tailwind Source Exclusions — Workplan

> **Last Updated**: 2026-10-03

## Overview

On 2026-10-02 `next build` failed on PR #173 with `tailwindcss: app/globals.css Invalid code point 10378938`. The cause was a workplan doc: Tailwind 4 scans every non-gitignored repo file for class candidates and decodes CSS escapes in them. A Windows path in the doc had a folder whose name began `9e5eba32-`, so the backslash before it read as the escape for code point 0x9E5EBA (past U+10FFFF) and `String.fromCodePoint` threw. The doc was fixed in ef17ee8c; this workplan makes the class of failure unable to recur. It is a new pattern (CLAUDE.md rule 7), so it needs SA review.

---

## Why it slipped through

`.github/ci/non-deploying-change.sh` makes the Build check **skip** a PR whose changes are confined to `docs/`, root `*.md`, `scripts/` or `.claude/`. Tailwind scanned exactly those paths. So a docs-only PR with a bad escape merges green, and the **next** code PR's build goes red with an error naming `app/globals.css`. Nothing points at the doc.

---

## Changes

| # | File | Change | Status |
|---|---|---|---|
| 1 | `app/globals.css` | `@source not` for `../docs`, `../scripts`, `../.claude`, `../*.md` (the Build-skip set, verbatim) plus `../archive`, `../supabase` (large trees with no rendered code). Paths are relative to the stylesheet. | ✅ |
| 2 | `app/__tests__/tailwind-css-escape.guard.test.ts` | (a) scans all tracked text files for a backslash-hex escape above U+10FFFF or in the surrogate range, using Tailwind's own decoder shape (an escaped backslash is consumed as a pair), and reports file:line; (b) parses the skip arm of `non-deploying-change.sh` and asserts `globals.css` excludes each path, so the two lists cannot drift. | ✅ |
| — | `app/v2/globals-v2.css` | **No change.** It imports `tailwindcss/theme` only; its `@import url('../globals.css')` is left to Next's CSS loader, so it never scans sources (compiled output: 44 selectors, byte-identical before and after). | ✅ |

**Not chosen:** `@import "tailwindcss" source(none)` plus an allowlist of `@source` dirs. Stronger against unknown new folders, but a new top-level source folder would then lose its classes silently — a worse failure than a loud build error. The guard covers the remaining scanned files instead.

**CI time:** zero added. The guard is a Jest test collected by the root project (`npm test`); it is deliberately not wired into a workflow (user rule: no added CI time). The build-time protection comes from change 1, which needs no job at all. The test takes ~1.4 s (5,275 files).

---

## Verification (Dev)

Tailwind 4.1.14 (installed). Compiled `app/globals.css` with `@tailwindcss/postcss` — the plugin `next build` runs — before and after.

| Check | Result |
|---|---|
| Files scanned under docs / scripts / .claude / archive / supabase / root md | 694 / 460 / 25 / 407 / 300 / 6 → all 0 |
| Files scanned under app / lib / components | 3,037 → 3,037 |
| Classes generated | 3,959 → 3,902: **0 added, 57 removed** |
| Removed classes found in still-scanned files | 9 substring matches, all false: live code uses longer classes (`dark:bg-blue-950/30`, `min-w-[110px]`, `lg:w-[260px]`, `dark:text-teal-300`…), each confirmed still generated |
| Original bad path planted in `docs/`, no fix | `Invalid code point 10378938` — CI error reproduced |
| Same, with fix | compiles |
| Planted in a root `.md`, with fix | compiles |
| Planted in `lib/`, with fix (control) | still fails — expected, `lib/` is scanned; the guard names the file |
| Guard: clean tree | 6/6 pass |
| Guard: bad path in a tracked doc | fails, names `docs/zz-plant.md:3` |
| Guard: one `@source not` line removed | fails, names the missing line |
| Full `next build` with CI placeholder env (Next 14.2.35, local, 2026-10-03) | ✅ exit 0, "Compiled successfully", 307/307 static pages. Only log noise is the usual `DYNAMIC_SERVER_USAGE` lines from cookie-reading routes |
| Sync test reads every skip arm (SA finding 7) | ✅ changed to collect every empty-body `dir/*` arm, not the first |

---

## SA Review

**Code Review by SA — 2026-10-03**
**Status:** ✅ APPROVED WITH CONDITIONS (new pattern accepted under CLAUDE.md rule 7)

### Findings

1. **`@source not` syntax and paths — correct.** Tailwind 4.1 supports `@source not "<path|glob>"`, resolved relative to the stylesheet, so `../docs` etc. are the repo-root trees. `../*.md` is a root-only glob, which matches the skip rule's root-only `*.md` arm, and V6 prompt `.md` files under `lib/` are still scanned. Dev's before/after scan counts back this up. No finding.
2. **Denylist rather than `source(none)` plus an allowlist — agreed.** The property that matters is that every path the Build check skips is also excluded from the scan. Any other path that still gets scanned triggers Build when it changes, so a bad escape there fails loudly on its own PR. That is the right failure mode, and an allowlist would swap it for silently missing classes. No finding.
3. **Excluding `archive/` and `supabase/` is safe.** I grepped `app/ lib/ components/ hooks/ types/ contexts/` and found no imports or requires that resolve into `archive/`, `supabase/`, `docs/` or `scripts/`. Dev's 57 removed classes were checked against live code. No finding.
4. **Other CSS entry points.** Only `app/globals.css` and `app/v2/globals-v2.css` mention tailwindcss. The second imports only `tailwindcss/theme`, so it never scans sources. No change needed there. `tailwind.config.js` is dead under v4 because there is no `@config`, and it is out of scope. No finding.
5. **`.claude/worktrees`** is gitignored, so Tailwind already skips it, and `../.claude` covers it anyway. Inside a worktree the relative paths resolve to that worktree's own trees. No finding.
6. **Guard decoder is sound.** It matches Tailwind's `we()` in `dist/lib.js` (`/\\([\dA-Fa-f]{1,6}[\t\n\f\r ]?|[\S\s])/g` → `fromCodePoint`). Leaving out the optional trailing whitespace does not change which code point is decoded. Scanning whole files is a superset of Tailwind's candidate-only decoding: it is stricter, and the clean tree has zero hits. Reporting surrogates is reasonable as a conservative check that Tailwind itself would not throw on. The test fails closed if `git ls-files` breaks, and it is cheap (about 1.4 s, 4.3 s cold here). — Low/none
7. **Sync test is brittle in the right direction.** If the case arm is reshaped, the parse returns null and the test fails loudly. Gap: a skip path added as a separate arm (e.g. `archive/*) ;;` on its own line) would not be picked up, because only the first matching arm is read. Optional improvement: collect every arm whose body is empty. — Low
8. **CI wiring — accepted as unwired.** No workflow runs `npm test`, so the guard is a local and pre-commit aid only. The build-time protection is change 1, which costs no CI time. That fits the no-added-CI-time rule. The guard starts biting automatically once Jest-in-CI lands (a separate effort). Also noted: the guard reads tracked paths only, so a brand-new untracked file is not checked until it is added to git. — Low, informational
9. **Conventions:** the `*.guard.test.ts` naming matches `lib/admin/__tests__/admin-authz-surface.guard.test.ts`. There is no `console.*`, no `any`, and comments explain the why. No finding.

### Conditions (before RM)

- **C1 (Medium):** the Verification row "Full `next build` with CI placeholder env" says "see below", but no result is recorded. Record the pass result before QA sign-off.
- **C2 (High, hygiene):** the worktree currently has **staged** QA plant files, `docs/zz-qa-plant.md` and `lib/zz-qa-plant.ts`. The guard run here correctly failed on `lib/zz-qa-plant.ts:1` (U+D800), which also confirms it works. Both files must be unstaged and deleted before anything is committed.

### Code Approved for QA: Yes (subject to C1, C2)

---

## QA Report

**QA — 2026-10-03**
**Test mode:** full
**Strategy used:** A (Jest: the guard itself, plus planted failure fixtures) and C (standalone script: compile `app/globals.css` with `postcss` + `@tailwindcss/postcss` 4.1.14 from the shared `node_modules`, before = `git show HEAD:app/globals.css`, after = working tree, `base` = worktree, `from` = absolute path of `app/globals.css`)
**Focus:** build safety, class-output regression
**Skipped:** full `next build` (Dev was running one in this worktree; the Tailwind compile in C is the same plugin `next build` runs)
**Input source:** prompt from TL

All planted files were written with Node (no shell heredocs), and removed afterwards. `git status --short` afterwards showed only `M app/globals.css`, `?? app/__tests__/` and `?? docs/workplans/TAILWIND_SOURCE_EXCLUSIONS_WORKPLAN.md`. `app/globals.css` was restored from a copy and still has its 6 `@source not` lines.

### Test Coverage

| Check | Tested? | Result | Notes |
|---|---|---|---|
| Guard, clean tree (happy path) | ✅ | Pass | 6/6. File scan ~2.0 s; whole Jest run ~4.7 s (7.3 s wall clock including Jest start-up) |
| Guard collected by `npm test` | ✅ | Pass | `jest --listTests` lists it (root `testMatch` covers `**/__tests__/**`) |
| Bad escape (a backslash then `9e5eba32`) in tracked `docs/` file (`git add -N`) | ✅ | Pass (guard fails) | Named `docs/zz-qa-plant.md:3 -> U+9E5EBA` |
| Same in tracked `lib/` file | ✅ | Pass (guard fails) | Named `lib/zz-qa-plant.ts:2 -> U+9E5EBA`; both hits reported in one run |
| Escaped double backslash before `9e5eba32` | ✅ | Pass (guard passes) | No report; Tailwind also compiles that file cleanly when it sits in `lib/` |
| Surrogate (a backslash then `d800`) | ✅ | Pass (guard fails) | Named `lib/zz-qa-plant.ts:1 -> U+D800` |
| One `@source not` line removed (`../scripts`) | ✅ | Pass (sync test fails) | `Expected substring: "@source not \"../scripts\";"`. Note: the file is CRLF, so a plain `\n` search-and-replace silently removes nothing; the first attempt did nothing and the test passed, as it should |
| Original failure reproduced, before-CSS | ✅ | Pass | The exact PR #173 doc text planted in `docs/`, compiled with HEAD's `globals.css`: `RangeError: Invalid code point 10378938`, reported against `app/globals.css:1:1` (in `markUsedVariable`) |
| Same text, after-CSS, in `docs/` | ✅ | Pass | Compiles |
| Same text, after-CSS, in a root `*.md` | ✅ | Pass | Compiles |
| Same text, after-CSS, in `lib/*.md` (control) | ✅ | Pass | Still fails, as expected: `lib/` is still scanned. The guard is what catches this |
| Scanned files per tree, before vs after | ✅ | Pass | docs 694 to 0, scripts 459 to 0, archive 406 to 0, supabase 299 to 0, .claude 24 to 0, root md 6 to 0. app 789, components 569, lib 1677, hooks 13, tests 164, types 5, public 60 all unchanged. Dev's per-tree counts differ by 1 in a few places (Dev's run included Dev's own untracked files); the conclusion is the same |
| Generated classes, before vs after | ✅ | Pass | My selector parse: 4,177 to 4,120, **0 added, 57 removed** (Dev counted 3,959 to 3,902; a different selector-counting method, same delta of 57) |
| Is any removed class used in a still-scanned file? | ✅ | Pass | Exact-token search (bounded by whitespace, quotes, backticks, braces, brackets) for each of the 57 across every file the after-compile scanned: **0 hits**. Removed set includes things like `w-[260px]`, `dark:bg-blue-950`, `text-teal-300`, `[filename:line]`, `[model:unpriced_model]`: all come from excluded docs/scripts only |
| Git unavailable (by code review, not by breaking git) | ✅ | Pass | `execFileSync('git', ...)` has no fallback: missing git (ENOENT), a non-repo checkout, or a non-zero exit throws and fails the test. An empty or truncated list is caught by `expect(files.length).toBeGreaterThan(1000)` |

### Issues Found

#### Bugs (must fix before commit)

None.

#### Performance Issues (should fix)

None. About 2 s for the scan; no CI job added.

#### Edge Cases (nice to fix, none blocking)

1. **The guard is broader than the build, by design** — Low. Tailwind threw only because the original path contained `--` (`c--Users-...`), which it extracts as a CSS-variable candidate and decodes in `markUsedVariable`. A short string such as a backslash then `9e5eba32` inside a TS string in `lib/` compiles fine. The guard flags every such escape, so it can give false alarms. The tree has none today, and the fix it suggests (forward slashes or a doubled backslash) is harmless. Accept as is.
2. **Tracked files only** — Low. Tailwind scans untracked, non-ignored files too, so a local untracked file can still break a local `next build` without the guard noticing. CI checks out only tracked files, so there is no gap in CI.
3. **The sync test checks one direction only** — Low. It asserts that every skip-rule path is excluded, not the reverse. Extra exclusions (`archive`, `supabase`) are intentional. If the `case` arm is rewritten into another shape, `expect(arm).not.toBeNull()` fails loudly rather than passing, which is correct.
4. **Binary heuristic** — Info. Files containing a NUL byte are skipped. A UTF-16 text file would be skipped too. There are none in scope.
5. **Comment nit** — Info. The header quotes Tailwind's decoder with an optional trailing-whitespace group that the guard's regex leaves out. That cannot change which code point gets decoded, so results are the same.

### Final Status

- [x] All acceptance criteria pass — ready for commit (after SA review, which is still pending: this is a new pattern under rule 7)
- [ ] Issues found — Dev must address before commit

**Verdict: PASS**

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-03 | Created | Dev: exclusions, guard, verification |
| 2026-10-03 | SA conditions closed | C1: `next build` pass recorded. C2: QA plant files removed (tree = the 3 intended files). Finding 7: sync test reads every skip arm, proven with a temporary extra arm (`newtree/*`), which failed the test as intended |
| 2026-10-03 | QA PASS | See QA Report. Awaiting user diff review, then RM |
