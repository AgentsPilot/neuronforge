# next/font Build Flake — Workplan

> **Last Updated**: 2026-09-22

## Overview

The `Build (next build)` required status check fails at random on commits that are
otherwise green, because `next/font/google` downloads three typefaces from Google
during the build and Google intermittently returns a font URL that next/font 14.2
cannot parse. This workplan removes that dependency. Step 1 (shipped here) stops
the bleeding in CI; Step 2 removes the network call entirely, which is also the
only step that protects **Vercel production deploys**.

## Table of Contents

- [Root Cause](#root-cause)
- [Evidence](#evidence)
- [Options Considered](#options-considered)
- [Tasks](#tasks)
- [Interim Runbook](#interim-runbook-until-step-2-lands)
- [SA Review Notes](#sa-review-notes)
- [QA Report](#qa-report)
- [Change History](#change-history)

---

## Root Cause

`next/font/google` resolves faces at **build time**, over the network:

1. `fetch-css-from-google-fonts.js` requests the CSS with a pinned Chrome UA. It
   already retries, and a non-200 raises an explicit "Failed to fetch font" error
   — **not** the error we see. So Google answered **200 with valid CSS**.
2. `find-font-files-in-css.js` extracts each font URL with `/src: url\((.+?)\)/`.
3. `loader.js:112` then indexes the extension match with **no null guard**:

   ```js
   const ext = /\.(woff|woff2|eot|ttf|otf)$/.exec(googleFontFileUrl)[1];
   ```

When the URL does not *end* in a font extension, `.exec` returns `null` and the
build dies with `TypeError: Cannot read properties of null (reading '1')`.

Google serves font files under two URL shapes: the usual
`fonts.gstatic.com/s/heebo/v26/<hash>.woff2`, and a `fonts.gstatic.com/l/font?kit=…`
form that carries **no file extension**. Which one you get varies by edge and
rollout — which is exactly why the **same commit** builds green on one run and red
on the next.

Two consequences:

| Consequence | Detail |
|---|---|
| next/font's own retries cannot help | There are two — `fetch-css-from-google-fonts.js` and `fetch-font-file.js` — and the crash is downstream of **both**. |
| There is no version to upgrade into | `14.2.35` is installed and is the last 14.2.x **as of 2026-09-22**. **Next 15 does not fix it either** — QA checked `next@15.5.26`, and `loader.js:122` carries the *identical* unguarded line. An upgrade is therefore foreclosed as a fix, which strengthens the case for Step 2. |

**Affected call sites** (build-time only):

| File | Faces |
|---|---|
| `app/layout.tsx:4` | `Heebo` (`latin`, `hebrew`) → `heebo.className` on `<body>` |
| `app/business-os/layout.tsx:12` | `Space_Grotesk` (500/600/700) → `--font-display`; `Inter` (400/500/600/700) → `--font-body` |

**Out of scope:** `components/public/PublicFontLinks.tsx` also uses Google Fonts,
but at **runtime** via `<link>`, for typefaces a business picks and which therefore
cannot be known at build time. It is unaffected by this failure and unchanged here.

---

## Evidence

| Date | Run | Branch | Note |
|------|-----|--------|------|
| 2026-09-21 18:36 | [35639481653](https://github.com/AgentsPilot/neuronforge/actions/runs/35639481653) | `main` | The #87 merge commit. Reddened **main**. |
| 2026-09-22 06:21 | [35694483326](https://github.com/AgentsPilot/neuronforge/actions/runs/35694483326) | `test/ci-guard-proof` | PR #90. Identical stack trace, unrelated to that PR's one-file change. |

`Build (next build)` is a **required status check** on `main` (alongside
`Admin authz surface guard`, `Type check (Business OS LLM attribution)` and
`React hooks rules guard`), so this flake can block **any** merge at random.

---

## Options Considered

| Option | Fixes CI | Fixes Vercel | Verdict |
|---|:---:|:---:|---|
| **A. Self-host via `next/font/local`** | ✅ | ✅ | **Chosen** — removes the network call structurally. |
| **B. Retry the build step on this signature** | 🟡 partial | ❌ | **Chosen as insurance** — cheap, also covers other transient flakes. |
| **C. `NEXT_FONT_GOOGLE_MOCKED_RESPONSES`** | ✅ | ❌ | **Rejected** — diverges the gate from production; brittle. |
| **D. `patch-package` the null guard into next** | ✅ | ✅ | **Rejected** — genuinely competitive; rejected on cost, not merit. |

**Why B is only partial:** the bad URL form is served per-edge, so a fresh attempt
usually lands on a good edge. Usually, not always.

**Why C is rejected:** it is supported in 14.2.35, but the mock keys on the exact
request URL, so any change to a weight, subset or family breaks CI with
`Missing mocked response for URL: …`. Worse, CI would stop exercising the real font
path — diverging the gate from what Vercel builds, which is precisely the property
this workflow's header comment exists to protect. It buys A's CI determinism with
none of A's production benefit, plus a new footgun.

**Why D is rejected:** patching the two-line null guard into
`node_modules/.../google/loader.js` via `patch-package` + `postinstall` would
protect **both** CI and Vercel today, without downloading fonts, deciding
subsetting, or regressing CLS — so on the axis this workplan says matters most, it
beats B. It is rejected because `patch-package` is not currently a dependency and
there is no `postinstall` hook, so it introduces a **new repo-wide pattern** (which
per CLAUDE.md rule 7 needs SA review in its own right) to work around a bug we can
delete outright with A. It is also fragile: the patch silently stops applying on a
Next upgrade. Recorded here so a future reader knows it was weighed, not missed.

---

## Tasks

### Step 1 — Retry the build step on this signature only ✅

- [x] Wrap `npm run build` in `.github/workflows/build.yml` in a 3-attempt loop.
- [x] Retry **only** when **all three** of these appear in the log: the
      "An error occurred in next/font" catch-all, the
      `@next/font/dist/google/loader.js` stack frame, and
      `Cannot read properties of null`. The first two alone are **not** enough —
      QA demonstrated that an `ENOSPC` thrown at `loader.js:200` matches both and
      would be retried three times and then reported as the Google URL flake
      (Bug 2). The null-dereference text is what actually identifies this bug.
- [x] Confirm the discriminator sits on the right side of next/font's own fork:
      every **misconfiguration** (`Unknown font`, `Unknown weight`, `Unknown
      subset`, `Invalid display value`, …) is raised via `nextFontError()`, which
      sets `err.name = 'NextFontError'` and renders as "next/font error:" — a
      different string that deliberately does **not** match. "Failed to fetch font"
      is likewise a `NextFontError` and is deliberately not retried: that one is
      the honest signal that the network is down.
- [x] `timeout -k 30 480` per attempt, so a *hung* build (stalled socket rather
      than a crash) fails fast and correctly labelled instead of eating the job's
      30-min budget. A timeout is **not** retried. **480, not 900**: three
      900s attempts plus the sleeps is 45m20s against a 30-minute *job* budget, so
      GitHub would cancel before the step could print any of its own annotations —
      losing precisely the diagnostics the timeout exists to preserve (Bug 1).
      3 × 480 + 20s = 24m20s fits, and is still ~2.5× the slowest of the 30 most
      recent Build runs. `-k 30` because plain `timeout` signals only `npm`, and
      a surviving `next build` holds the pipe open so `tee` can block past it.
- [x] `tee`, not `tee -a`, so each attempt is judged on its own log. Commented,
      because it looks like an oversight and is load-bearing.
- [x] Echo each retry to `$GITHUB_STEP_SUMMARY` as well as `::warning::`, so the
      flake rate is visible across runs rather than buried in step logs. Guarded
      by `[ "$attempt" -lt 3 ]` so the count reflects *real* retries — attempt 3
      does not retry, and announcing one there inflated the measured rate by 50%
      (Bug 4). Appended with `|| true` so an unset `GITHUB_STEP_SUMMARY` cannot
      abort the step under `set -e` and swallow every annotation (Bug 6).

- [x] Pin `.github/workflows/*.yml` to LF in `.gitattributes`. The step is now an
      embedded bash script, but the existing `*.sh text eol=lf` rule — whose own
      comment warns that CRLF makes bash fail with `: command not found` — does
      not reach a `.yml` file (Bug 7).

**Verification method** (re-runnable): extract the step's `run:` block from the
workflow YAML, put a shim `npm` on `PATH` that emits a chosen build log and exit
code, and run the block under `bash --noprofile --norc -e -o pipefail` with
`GITHUB_STEP_SUMMARY` pointed at a temp file.

Dev ran seven cases (below). **QA then ran 20, including 11 adversarial, and found
two Medium bugs Dev's harness had missed** — see the QA Report. All QA findings
were fixed and the harness re-run against the adversarial cases that exposed them:
`ENOSPC` at `loader.js:200` and a stale `npm warn` carrying both original strings
now both fail fast in one attempt; a persistent flake now writes two summary lines
for three attempts rather than three; and an unset `GITHUB_STEP_SUMMARY` no longer
aborts the step. Dev's original seven:

| # | Simulated `npm run build` | Expected | Result |
|---|---|---|---|
| 1 | Success | exit 0, 1 attempt | ✅ |
| 2 | Genuine compile error | exit 1, 1 attempt, no retry | ✅ |
| 3 | next/font **misconfig** ("next/font error:") | exit 1, 1 attempt, no retry | ✅ |
| 4 | Catch-all message **without** the loader frame | exit 1, 1 attempt, no retry | ✅ |
| 5 | The real flake, persistent | exit 1, 3 attempts | ✅ |
| 6 | Flake once, then green | exit 0, 2 attempts | ✅ |
| 7 | Hang (`timeout` → 124) | exit 1, no retry | ✅ |

### Step 2 — Self-host the three faces ⬜

**⏸ Direction not yet confirmed.** Offir was emailed on 2026-09-22
("Should we stop downloading fonts from Google at build time?") asking whether
self-hosting is the direction he wants, and explicitly inviting him to argue for
Option D (`patch-package`) instead, since that one protects Vercel today without
touching fonts. **Do not start the font downloads until he replies** — the choice
between A and D changes every task below. Step 1 shipped without waiting, because
it is independent of which way this goes.

**Expiry:** Step 1 is a stop-gap and Vercel stays unmitigated until this lands.
Step 2 ships **before the next release**, or the retry is revisited and this
workplan reopened. Do not let this settle into the "mitigated, not fixed" shape.

- [ ] Download the `woff2` files for Heebo (latin + hebrew), Space Grotesk and
      Inter; commit them plus the SIL OFL 1.1 licence text (all three are OFL, so
      redistribution is permitted **provided the licence ships with them**).
- [ ] Swap `next/font/google` → `next/font/local` in both layouts, preserving
      `heebo.className` and the `--font-display` / `--font-body` variable names so
      no consumer changes.
- [ ] **All three are variable fonts** — `next/font/local` needs an explicit range
      (`weight: '100 900'` for Heebo). Omit it and you silently ship a single
      static weight. This is the most likely way Step 2 regresses visually.
- [ ] Decide subsetting: one variable file per family is simplest but makes the
      browser fetch the whole file; per-subset files with hand-declared
      `unicode-range` preserve today's behaviour at the cost of more files. Heebo
      (latin + hebrew) is the one where this actually matters.
- [ ] Supply fallback metrics manually where worthwhile — `next/font/local` only
      offers the `Arial` / `Times New Roman` presets, so the Google loader's
      computed per-font metrics are lost and CLS may regress slightly.
- [ ] Add a **CI guard** against re-introducing `next/font/google`, in the same
      grep-based style as `admin-authz-guard`, `react-hooks-guard` and
      `check:bos-llm-literals`. Without one, the next new layout re-adds the import
      and the flake returns with this workplan closed. The guard must **allow**
      `components/public/PublicFontLinks.tsx`, which is correctly out of scope.
- [ ] Verify with a local `next build` **offline** (no network) — the real proof.
- [ ] Once merged and a few deploys have passed, decide whether Step 1's retry
      still earns its place. It is cheap insurance against other transient
      failures, so the default is to keep it — but the decision should be made,
      not defaulted into.

---

## Interim Runbook (until Step 2 lands)

**A Vercel production deploy fails with "An error occurred in next/font" and
`TypeError: Cannot read properties of null (reading '1')`.**

Redeploy the same commit. Do not debug it, do not revert, do not touch the fonts —
it is this flake, the commit is fine, and a redeploy usually lands on a different
Google edge. If three redeploys fail, escalate: Google may have flipped the URL
form globally, which makes Step 2 urgent rather than scheduled.

---

## SA Review Notes

Reviewed 2026-09-22. **Approved with comments**; no rejections. SA independently
verified the diagnosis against the installed `next@14.2.35` rather than accepting
it — `loader.js:112`, the unguarded `.exec(...)[1]`, the version, and the retries
being upstream all confirmed.

Bash correctness: clean, no defects. Confirmed that GitHub's `-e` does not kill the
loop (both failing commands are `if` conditions, which are exempt from errexit),
that `pipefail` is active twice over so `tee` cannot mask npm's exit code, and that
the loop **cannot** turn a red build green — a genuine error on a retried attempt
has no font signature and exits 1.

Adopted from the review: pair the catch-all string with the loader stack frame;
`timeout` per attempt; comment the `tee`-not-`tee -a` subtlety; name the
CI-vs-Vercel divergence explicitly in the workflow comment rather than implying it;
correct "next/font's own retry" to the two retries that actually exist; echo to
`$GITHUB_STEP_SUMMARY`; soften the final failure message. Doc-side: added Option D,
marked the Next 15 claim unverified, dated the 14.2.35 claim, recorded the
verification method as a re-runnable table, added the Step 1 expiry, the interim
runbook, the anti-regression CI guard task and the variable-weight task.

**Noted, not a code defect:** Step 1 weakens the gate↔deploy correspondence this
workflow's header comment was written to defend — a smaller version of the very
divergence used to reject Option C. Accepted as a documented stop-gap; recorded in
the workflow comment and bounded by the Step 2 expiry above.

**Process:** SA flagged that Step 1's tasks were ticked before architectural review,
inverting Dev → SA → user → QA → RM. Nothing was committed before review, and the
review's findings were folded in above before the change went to the user.

---

## QA Report

**QA — 2026-09-22**
**Test mode:** full (adversarial)
**Strategy used:** C (test script) + A (source-level verification) — the change is a bash
block inside a workflow, so it was extracted from the YAML and executed under GitHub's
actual shell against a shim `npm`; the discrimination claims were checked against the
installed `next@14.2.35` source and against the archived logs of the two cited runs.
**Focus:** ci / correctness / performance
**Skipped:** No real `next build` was run (no network-isolated Linux runner available
here). Every build outcome was simulated; the flake fixture is the **verbatim archived
log** of run 35694483326.
**Input source:** prompt keywords

### Method

`.github/workflows/build.yml` was parsed with PyYAML and the `Build` step's `run:` block
written to a file, then executed as GitHub executes it:
`bash --noprofile --norc -e -o pipefail <block>`, with a shim `npm` earlier on `PATH`
driven by a per-attempt script of `exitcode:logfile` pairs, `GITHUB_STEP_SUMMARY` pointed
at a temp file, and the attempt count recorded out-of-band. 20 cases were run. The
workflow was **not** modified, committed or pushed.

### Test Coverage

| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| The loop can never turn a genuinely broken build green | ✅ | **Pass** | 20 cases incl. 11 adversarial. `exit 0` is reachable from exactly one place, guarded by `[ "$status" -eq 0 ]`. No log content can produce a false green. |
| Retries only on the flake signature | ✅ | Pass | Both `grep -qF` strings required; either alone fails fast. |
| next/font **misconfigurations** fail fast | ✅ | Pass | Verified from source, not from the workplan — see below. |
| The retried signature appears in the **real** crash | ✅ | Pass | Both strings present in the archived logs of both cited runs. |
| `timeout` / exit 124 not retried | ✅ | Pass | 1 attempt, labelled `::error::`, exit 1. |
| Bash correct under `bash -eo pipefail` | ✅ | Pass | `-e` does not abort the loop; pipefail propagates through `tee`. |
| Worst-case wall clock fits `timeout-minutes: 30` | ❌ | **Fail** | 45m20s worst case vs a 30-minute job budget — Bug 1. |
| YAML valid, job name unchanged | ✅ | Pass | Job name `Build (next build)` untouched; branch protection still matches. |
| Workplan factual claims | ⚠️ | Partial | All checkable claims correct; one claim marked "unverified" is now verified and inverts — Doc 1. |

#### Case matrix (20 cases)

| # | Simulated `npm run build` | Expected | Actual | |
|---|---|---|---|---|
| 1 | Success | exit 0, 1 attempt | exit 0, 1 | ✅ |
| 2 | Genuine compile error | exit 1, 1, no retry | exit 1, 1 | ✅ |
| 3 | Misconfig — `Unknown font` | exit 1, 1, no retry | exit 1, 1 | ✅ |
| 3b | Misconfig — `Unknown weight` | exit 1, 1, no retry | exit 1, 1 | ✅ |
| 3c | `Failed to fetch font` | exit 1, 1, no retry | exit 1, 1 | ✅ |
| 4 | Catch-all **without** loader frame | exit 1, 1, no retry | exit 1, 1 | ✅ |
| 5 | Flake, persistent | exit 1, 3 attempts | exit 1, 3 | ✅ |
| 6 | Flake once, then green | exit 0, 2 attempts | exit 0, 2 | ✅ |
| 7 | Hang → 124 | exit 1, no retry | exit 1, 1 | ✅ |
| R1 | **Real archived log**, then green | exit 0, 2 attempts | exit 0, 2 | ✅ |
| A1 | Compile error in a file whose **code frame prints both literals** | exit 1 | exit 1, **3 attempts, mislabelled** | ⚠️ Bug 3 |
| A2 | Flake, then a real compile error | exit 1, 2 attempts | exit 1, 2 | ✅ |
| A2b | Flake, flake, then a real compile error | exit 1, 3 attempts | exit 1, 3 | ✅ |
| A3 | Failure with **empty** output | exit 1, no retry | exit 1, 1 | ✅ |
| A4 | `npm` missing (127) | exit 1, no retry | exit 1, 1 | ✅ |
| A5 | OOM kill (137) | exit 1, no retry | exit 1, 1 | ✅ |
| A6 | Unrelated throw **inside** the google loader (`ENOSPC` at `loader.js:200`) | exit 1 | exit 1, **3 attempts, mislabelled** | ⚠️ Bug 2 |
| A7 | Stale `npm warn` carrying both strings + a real `SyntaxError` | exit 1 | exit 1, **3 attempts, mislabelled** | ⚠️ Bug 2 |
| A8 | `npm` itself exits 124 while the log holds the flake | — | exit 1, reported as a hang | benign |
| A9 | exit 0 but the log holds the flake | exit 0 | exit 0 | ✅ |
| A10 | Real error, then flake, then green | exit 1 on attempt 1 | exit 1, 1 | ✅ |

**The critical property holds.** Under every adversarial log constructed, the step exits 0
**only** when `npm run build` itself exited 0. The three ⚠️ rows are wasted attempts and a
wrong diagnosis, not a false green.

#### Independently confirmed from the installed `next@14.2.35`

Read from `node_modules`, not from the workplan:

| Claim | Verified |
|---|---|
| `compiled/@next/font/dist/google/loader.js:112` is the unguarded `const ext = ….exec(googleFontFileUrl)[1];` | ✅ exact line |
| Installed version is `14.2.35`, and it is the last of 112 published `14.2.x` | ✅ |
| Misconfigurations route to a different string | ✅ `build/webpack/plugins/wellknown-errors-plugin/parseNextFontError.js:22-26` forks on `err.name === "NextFontError"` → ``​`next/font` error:`` else → ``An error occurred in `next/font`.`` + `err.stack`. All 17 `nextFontError()` call sites (`Unknown font`, `Unknown subset`, `Unknown weight`, `Unknown style`, `Invalid display value`, `Invalid axes`, `Failed to fetch font`, …) set `err.name = 'NextFontError'` (`next-font-error.js:7-10`), so **none** can produce the retried string. The `TypeError` at line 112 is a plain `TypeError` and takes the else branch. |
| Two internal retries, both **upstream** of the crash | ✅ `fetch-css-from-google-fonts.js:38` and `fetch-font-file.js:24`; the crash is at `loader.js:112`, after the `fetchFontFile` await at 104-110 |
| The retried signature appears in the real crash | ✅ Archived log of run 35694483326 contains ``An error occurred in `next/font`.`` ×1 and `@next/font/dist/google/loader.js` ×2 (`…/loader.js:112:78` and `…/loader.js:94:33`). Run 35639481653's trace is byte-identical. Both fed through the loop end-to-end (case R1). |

#### Bash correctness under `bash --noprofile --norc -e -o pipefail`

| Property | Result |
|---|---|
| `-e` does not abort the loop | ✅ Both failing commands sit in `if` conditions, which errexit exempts. Case 5 completed 3 attempts. |
| Exit code survives the `tee` pipeline | ✅ 1, 124, 127 and 137 all arrived intact in `$status`. |
| `\|\| status=$?` capture | ✅ `\|\|` also suppresses errexit on the left-hand pipeline. |
| pipefail is **load-bearing** | ✅ and proven: with `set -o pipefail` stripped **and** run without `shell: bash`, a genuine compile error exits **0** — a silent always-green gate. Two independent protections are present (the step's `shell: bash` and the script's own `set -o pipefail`), so this is a fragility note, not a defect. |
| `tee`, not `tee -a` | ✅ Cases A2/A2b: attempt 2 is judged on its own log and is not rescued by attempt 1's signature. |
| Line endings | ✅ Working copy and `HEAD` blob both have 0 CR; `core.autocrlf=true` commits LF. See Bug 7. |

#### YAML / branch protection

- `.github/workflows/build.yml` parses cleanly. Workflow name `Build`; single job id `build`,
  **name `Build (next build)`, `timeout-minutes: 30`, `runs-on: ubuntu-latest`** — the diff
  touches only the `Build` **step**'s `run:` (and adds `shell: bash`), so the job name is
  byte-identical.
- Live branch protection on `main` requires exactly:
  `Admin authz surface guard`, `Type check (Business OS LLM attribution)`,
  **`Build (next build)`**, `React hooks rules guard` (`strict: false`) — matching the
  Evidence section above exactly, and still matching after this change.
- `.github/ci/non-deploying-change.sh` routes `.github/workflows/build.yml` to **BUILD**
  (catch-all), so the change is self-exercising on its own PR.

#### Workplan factual claims

| Claim | Verified |
|---|---|
| `app/layout.tsx:4` — `Heebo` | ✅ exact line |
| `app/business-os/layout.tsx:12` — `Space_Grotesk, Inter` | ✅ exact line |
| These are the only build-time `next/font/google` call sites | ✅ repo-wide grep: 2 imports; 5 further hits are comments |
| `components/public/PublicFontLinks.tsx` is runtime-only and out of scope | ✅ no `next/font` import; emits `<link>`/`preconnect` for families chosen at runtime, and explicitly excludes Heebo as already loaded by the root layout |
| Run **35639481653**, 2026-09-21 18:36, `main`, the #87 merge, failed | ✅ all five fields |
| Run **35694483326**, 2026-09-22 06:21, `test/ci-guard-proof`, PR #90, failed, identical stack | ✅ all six; PR #90 head ref is `test/ci-guard-proof` |
| The four required status checks | ✅ exact match |

---

### Issues Found

#### Bugs

**1. Worst-case wall clock (45m20s) exceeds the job's 30-minute budget — Medium — File: `.github/workflows/build.yml`**

- Three attempts at `timeout 900` plus two `sleep 10` = **2720 s = 45m20s** for the Build
  step alone. `timeout-minutes: 30` bounds the **whole job**, and the prelude
  (set-up + checkout + scope + setup-node + `npm ci`) measured **35 s** (run 35694483326)
  and **105 s** (run 35639481653).
- Expected: the step always reaches one of its own labelled exits.
- Actual: if attempts run long, GitHub cancels the job at 30 minutes, so **none** of the
  `::error::` annotations fire and the check reports a bare
  "exceeded the maximum execution time" — precisely the diagnostic-loss outcome
  `timeout 900` was introduced to prevent. It still fails **closed** (a cancelled required
  check blocks the merge), so this is a diagnosis and cost bug, not a safety bug.
- The in-file comment applies this reasoning only to the 124 branch
  ("three of them would blow the job's 30-minute budget") while the retry branch carries
  the same exposure with no bound.
- **Measured probability is low:** the 30 most recent `Build` runs completed in
  **1m27s–3m31s** end-to-end, and the flake itself fails in **47 s / 55 s**. A realistic
  triple-flake costs ~3 minutes.
- Fix (pick one): `timeout 480` (3 × 480 + 20 s = 24m20s, still ~2.5× the slowest observed
  CI build); or carry a shared deadline and shrink the per-attempt timeout; or raise
  `timeout-minutes` to 50.

**2. The discriminator matches "any unknown throw inside the Google font loader", but the error message asserts the specific flake — Medium — File: `.github/workflows/build.yml`**

- The comment claims pairing the catch-all with the loader frame "keeps us from confidently
  mislabelling some future unrelated crash as this one." It does not: it narrows the set to
  *non-`NextFontError` throws whose stack passes through `google/loader.js` at any line*.
- Steps to reproduce (case A6): a build failing with
  ``An error occurred in `next/font`.`` + `Error: ENOSPC: no space left on device` at
  `…/@next/font/dist/google/loader.js:200`.
- Expected: fail fast, correctly labelled.
- Actual: 3 retries, then
  `::error::next build hit the next/font Google URL crash on all 3 attempts. Google is
  serving the extension-less URL form from every edge this runner reached.`
  The Interim Runbook in this document then instructs the reader to redeploy and
  "Do not debug it, do not revert" — so the misdiagnosis is **actionably wrong**.
- Case A7 reproduces the same outcome from a stale `npm warn` line carrying both strings
  above an unrelated `SyntaxError`.
- Fix (one line, zero cost): the genuinely discriminating strings are present in the real
  log and unused. Add a third required match —
  `grep -qF 'Cannot read properties of null' "$log"` (and/or `loader.js:112`) — and reword
  the final `::error::` to state that all three attempts hit *the same signature*, without
  asserting what Google did.

**3. A compile error in a source file whose code frame prints both literals is retried and mislabelled — Low — File: `.github/workflows/build.yml`**

- `next build` prints the failing file's source code frame, so a compiled file containing
  both literals can inject the signature into a genuinely broken build's log (case A1:
  3 attempts, flake annotation, exit 1).
- **Latent today** — a repo-wide scan of `app/ lib/ components/ hooks/ types/ scripts/`
  found **no** file containing both strings. But Step 2's planned anti-regression CI guard
  is by construction a file that greps for `next/font/google`, and this workplan already
  contains both strings; a future guard or fixture placed under a compiled path would
  trigger it. The Bug 2 fix also narrows this.

**4. "Retrying." is printed on attempt 3, which does not retry — Low**

- Verified in cases 5 and A1/A6/A7: the loop emits
  `::warning::… (attempt 3/3). Retrying.` plus a `$GITHUB_STEP_SUMMARY` line, then sleeps
  10 s pointlessly, then falls out of the loop and prints the real error. The summary
  therefore records 3 "retries" for 2 actual retries — which matters because the stated
  purpose of that summary line is to make the flake rate visible across runs.
- Fix: guard the warning/sleep with `[ "$attempt" -lt 3 ]`.

**5. `timeout` has no `-k` and signals only the direct child — Low**

- `timeout 900 npm run build` sends SIGTERM to `npm` only. `next build` runs as a child and
  inherits the pipe's write end; if it outlives SIGTERM, `tee` can block past the timeout
  and the 124 branch never runs, leaving the job to hit the 30-minute cap.
- **Could not confirm on the target platform.** Both orphan reproductions returned at the
  timeout with status 124 under this machine's msys bash, which does not model Linux
  process-group/pipe semantics. Reported as a residual risk, not a demonstrated defect.
- `timeout -k 30 900` closes it at no cost.

**6. The `$GITHUB_STEP_SUMMARY` append is an unguarded command under `set -e` — Low (edge case)**

- Verified: with `GITHUB_STEP_SUMMARY` unset, the step aborts at attempt 1 with exit 1 and
  **no** `::error::` annotation at all — a retryable flake becomes a hard, unlabelled
  failure. GitHub always sets the variable, so this is latent only.
- Fix: append with `|| true`.

**7. `.gitattributes` does not pin `*.yml` to LF — Low (repo hygiene, pre-existing)**

- `.gitattributes` pins `*.sh text eol=lf` with the comment "Shell scripts run on Linux CI…
  CRLF would make bash fail with ': command not found'". The Build step is now an embedded
  bash script living in a **`.yml`** file, which that rule does not cover.
- Safe today (`core.autocrlf=true`; working copy and `HEAD` blob both 0 CR), but the
  protection the comment describes no longer covers the file that needs it.
- Fix: add `.github/workflows/*.yml text eol=lf`.

#### Performance Issues

None beyond Bug 1. A triple-flake costs ~3 min of runner time (measured), and the non-flake
path is unchanged at one attempt.

#### Documentation

**Doc 1. The "unverified" Next 15 claim is now verified, and it inverts the conclusion.**
This workplan says "Whether Next 15 added the null guard is **unverified** — check before
treating an upgrade as a fix or as foreclosed." Checked: `next@15.5.26`,
`dist/compiled/@next/font/dist/google/loader.js:122` is the **identical** unguarded
`const ext = /\.(woff|woff2|eot|ttf|otf)$/.exec(googleFontFileUrl)[1];`. **Next 15 does not
fix this**, so an upgrade is foreclosed as a fix — which strengthens the case for Step 2 and
should replace the "unverified" note.

**Doc 2. "15 min is ~2x the slowest cold build of 295 pages" is not supported by CI data.**
The 30 most recent `Build` runs are 1m27s–3m31s end-to-end; 900 s is ~4–7× the slowest
observed CI build. (The header's "3-7 min" is a local measurement.) Worth correcting because
it is the number that drives Bug 1.

### Could NOT be verified

- **Whether the retry actually works in the wild.** Whether a fresh attempt lands on a
  Google edge serving the parseable URL form is Google-side and unobservable from here.
  Option B's entire value rests on it; this workplan is honest that it is "usually, not
  always." Only production run data will settle it — the `$GITHUB_STEP_SUMMARY` lines are
  the right instrument, once Bug 4 stops inflating the count.
- **A real `next build`.** No network-isolated Linux runner was available; all build
  outcomes were simulated with a shim `npm`, using the verbatim archived crash log.
- **Linux `timeout` / orphan / pipe semantics** (Bug 5) — the test platform is msys bash.
- **Vercel behaviour.** Out of scope by design and correctly documented as unmitigated.

### Final Status

- [ ] All acceptance criteria pass — ready for commit
- [x] **Issues found — Dev should address before commit.**

No High-severity bug. The safety-critical property — *the loop cannot turn a genuinely
broken build green* — **holds under every adversarial case constructed**, including a
genuine error on a retried attempt, empty output, a missing `npm`, an OOM kill, and a log
carrying the signature above an unrelated failure.

Recommended before commit: **Bug 2** (one extra `grep`; the shipped error message currently
misdiagnoses unrelated crashes in a way the runbook turns into wrong action) and **Bug 1**
(one number; the step can currently be cancelled before it can report anything). Both are a
few characters. Bugs 3-7 and the two doc corrections are optional.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-22 | Workplan created; Step 1 implemented and SA-reviewed | Root cause traced to `loader.js:112` indexing a null regex match on Google's extension-less `/l/font?kit=` URL form. Step 1 (scoped CI retry) hardened per SA review and verified against 7 simulated build outcomes; Step 2 (self-hosting) pending with an expiry. |
| 2026-09-22 | QA report added | Independent validation of Step 1: 20 cases (11 adversarial) run against the step's extracted `run:` block under GitHub's shell with a shim `npm`; discrimination re-derived from the installed `next@14.2.35`; run IDs, required checks and file/line claims re-checked against GitHub and the repo. Critical property holds (no false green). 2 Medium + 5 Low findings and 2 doc corrections raised. |
| 2026-09-22 | All QA findings fixed before commit | Bug 2: third required match `Cannot read properties of null`, so an unrelated throw inside the loader is no longer retried and misdiagnosed. Bug 1: `timeout 900` → `480`, so three attempts fit the 30-minute job budget instead of being cancelled before they can report. Bug 4: retry notice guarded by `[ "$attempt" -lt 3 ]`. Bug 5: `-k 30`. Bug 6: `\|\| true` on the summary append. Bug 7: `.github/workflows/*.yml text eol=lf`. Bug 3 closed by the Bug 2 fix. Doc 1 and Doc 2 corrected. Harness re-run against QA's adversarial cases — all pass. |
| 2026-09-22 | Step 2 direction put to Offir | Emailed asking whether to self-host (Option A) or patch next (Option D). Step 2 is on hold pending his reply; Step 1 shipped regardless, being independent of the answer. |
