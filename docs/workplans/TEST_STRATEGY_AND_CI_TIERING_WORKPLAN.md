# Workplan: Test Strategy & CI Tiering

> **Last Updated**: 2026-10-02
> **Status**: 🟡 **Slice 1 code complete, uncommitted** on `chore/ci-jest-gate` (see §0 and the implementation record in §10). SA approved the §0 refresh with conditions SC-1..SC-10 on 2026-10-02, and all ten are applied. Awaiting SA code review. The original plan (§1–§11, against `d00006ac`) was SA-reviewed on 2026-09-21; its figures are superseded by §0.
> **Branch**: Slice 1 is on `chore/ci-jest-gate`, cut from `origin/main` @ `894150f5`. The original branch `chore/test-tiering` (cut from `d00006ac`, workplan commit `be145ceb`, never pushed) is superseded.
> **Related**: [CI_BUILD_GATE_WORKPLAN.md](/docs/workplans/CI_BUILD_GATE_WORKPLAN.md) · [ENVIRONMENTS_AND_DEPLOYMENT_STRATEGY.md](/docs/ENVIRONMENTS_AND_DEPLOYMENT_STRATEGY.md) §11 (dev-cycle definition, backlogged)

## Overview

The working assumption behind this workplan was that tests are slow and are making CI and the QA agent expensive. **Measurement did not support it.** The full Jest suite — 396 suites, 6,092 tests — runs in **107 seconds**. No CI workflow runs the full suite at all.

What is actually true: CI wall-clock is dominated by an 8.3-minute `next build`, **21 suites / 129 tests fail on `main` right now**, and 8 of those suites have been importing deleted modules for up to seven months. The QA agent is slow because it has no test commands in its definition, defaults to `full` scope, and then has to triage 129 failures that have nothing to do with the change under review.

**The organising principle:** the cheapest, highest-value change available is not making tests faster — it is *running them at all*, and making the set that runs trustworthy. Everything here serves that.

> **Read §0 first.** §0 is the slice being built now, re-measured on `origin/main` @ `894150f5`. §1–§11 are the original plan, written against `d00006ac`, and are kept as the record. Where §0 gives different figures or a different mechanism, **§0 supersedes them.**

---

## 0. Slice 1 — Jest gate on every PR (refreshed 2026-10-02 against `894150f5`)

**Branch:** `chore/ci-jest-gate`, cut from `origin/main` @ `894150f5`. **Status:** 🟡 code complete and uncommitted (2026-10-02). SA approved with conditions SC-1..SC-10, all applied. Implementation record: [§10](#10-task-list).

### 0.1 Scope — exactly this, nothing more

One new workflow runs the full Jest suite, minus a committed quarantine baseline, on every PR. It fails on any **new** failure and prints counts. Every suite that is red today is either fixed or quarantined, with a one-line reason each. Making the check *required* is a manual GitHub step the user does after merge.

| # | In scope | Replaces |
|---|---|---|
| S1-1 | Delete the 8 dead suites, and the root `__tests__/` directory they leave empty | A1, test files only |
| S1-2 | Fix the 9 stale or flaky tests in the [disposition table](#04-disposition-of-every-red-suite) | A2, A3 + 7 new ones |
| S1-3 | `.github/ci/jest-quarantine.json`: 11 entries, one reason each, removals only (SC-7: `selectTemplate` is deleted, not quarantined) | A0's baseline file |
| S1-4 | `jest.gate.config.js`, the gate scope ([§0.5](#05-mechanism--how-the-baseline-is-excluded)) | A0's `projects` split |
| S1-5 | `.github/ci/jest-gate-check.mjs`, the count guard ([§0.6](#06-count-guard)) | A4's `*.guard.test.ts` |
| S1-6 | `.github/workflows/tests.yml` ([§0.7](#07-workflow-spec)) | B1 |
| S1-7 | One npm script, `test:gate`, the same command the workflow runs | B2, that script only |
| S1-8 | A note to the user on which check to require, and the throwaway-PR proof | B3 |

### 0.2 Deferred — not in this slice

| Deferred | Why it can wait |
|---|---|
| Deleting the 6 rotted `scripts/*.ts` (SA L-3) | No gate collects them. They harm nothing that this slice touches. |
| The `aa2df32b` rescue pointer in `V6_OPEN_ITEMS.md` | V6 is not being worked on. It goes with C1, which is the job that makes the quarantine visible. |
| C1, the nightly full-suite job with a delta report | The gate alone stops new rot. The nightly matters only once someone is shrinking the quarantine. |
| C2, the QA agent contract (commands, `smoke` default, Playwright removal) | Separate agent-definition change. It needs only `test:gate`, which this slice adds. |
| B2's other scripts: `test:changed`, `test:qa`, `test:agents` | The workflow needs none of them. `test:agents` no longer has a meaning, because there is no `agents` project ([§0.5](#05-mechanism--how-the-baseline-is-excluded)). |
| L-6 (`testMatch` comment) | Comment-only. |

### 0.3 Guardrails

1. **No product-code changes**, except to fix a test that is provably stale. "Provably" means the commit that made it stale is named in the workplan, and the source side is shown to be the intended behaviour.
2. **If a failure exposes a live product bug, quarantine the suite** with a reason and flag it to TL. Do not fix product code in this slice.
3. **Never relax an assertion to go green** without writing down which side is correct and why. A raised *timeout* is not a relaxed assertion, but it still needs its reason in a comment.
4. **Quarantine entries can only be removed.** Adding one needs SA review. The check script enforces this mechanically ([§0.6](#06-count-guard)).
5. **Nothing that cuts coverage**: no `--onlyChanged`, no directory exclusion, no shard matrix without an aggregator (SA H-2, M-4).
6. **Truncation hazard:** before reading any diff, run `git diff --stat`. A deletion with no matching insertion is a stop.

### 0.4 Disposition of every red suite

TL's measurement on `894150f5` (Windows dev box, 8 cores, cold): **752 suites (744 run, 8 skipped) / 13,547 tests (13,331 pass, 151 fail, 65 skip), 374s.** That is 28 suites that fail every time plus 1 flaky one, 29 in all. TL counted 752 test files with `git ls-files`, so the jump from 396 is real growth, not leakage from worktrees. Dev re-checked: `--listTests` = 752, of which 0 are under `.claude/`.

Each of the 7 new suites and the 2 already known was run on its own here, and its test and source were read.

**Totals: delete 8 · fix-test 9 · quarantine 12.**

| # | Suite | Fails | Decision | One-line reason | Conf. |
|---|---|---|---|---|---|
| 1 | `__tests__/DeclarativeCompiler-comprehensive.test.ts` | suite | **delete** | Imports `DeclarativeCompiler`, which was deleted in `aa2df32b` (2026-02-19) | High |
| 2 | `__tests__/DeclarativeCompiler-dataflow.test.ts` | suite | **delete** | same | High |
| 3 | `__tests__/DeclarativeCompiler-dataflow-contract.test.ts` | suite | **delete** | same | High |
| 4 | `__tests__/DeclarativeCompiler-regression.test.ts` | suite | **delete** | same | High |
| 5 | `__tests__/DeclarativeCompiler-stress.test.ts` | suite | **delete** | same | High |
| 6 | `__tests__/v6-integration.test.ts` | suite | **delete** | Imports `IRToDSLCompiler`, deleted in `aa2df32b` | High |
| 7 | `lib/agentkit/v6/generation/__tests__/EnhancedPromptToIRGenerator.test.ts` | suite | **delete** | Imports `EnhancedPromptToIRGenerator_DEPRECATED`, deleted in `aa2df32b` | High |
| 8 | `lib/agentkit/v6/__tests__/integration/v6-end-to-end.test.ts` | suite | **delete** | same | High |
| 9 | `lib/agentkit/v6/logical-ir/schemas/__tests__/validation.test.ts` | 12/51 | **quarantine** | V6 IR schema drift. V6 is parked, and the owner is whoever resumes it. | High |
| 10 | `lib/agentkit/v6/translation/__tests__/IRToNaturalLanguageTranslator.test.ts` | 11/25 | **quarantine** | V6 translator output drift. V6 is parked. | High |
| 11 | `lib/agentkit/v6/compiler/__tests__/LogicalIRCompiler.test.ts` | 20/22 | **quarantine** | V6 compiler drift. V6 is parked. | High |
| 12 | `lib/agentkit/v4/__tests__/v4-generator.test.ts` | 22/23 | **quarantine** | V4 generator drift. The agent platform is parked. | High |
| 13 | `lib/pilot/__tests__/StructuredTransforms.test.ts` | 4/66 | **quarantine** | Pilot transform drift. The agent platform is parked. | High |
| 14 | `lib/pilot/__tests__/StructuredTransforms.wp33.test.ts` | 3/18 | **quarantine** | same | High |
| 15 | `lib/pilot/__tests__/StructuredTransforms.wp37.test.ts` | 2/8 | **quarantine** | same | High |
| 16 | `lib/pilot/__tests__/ConditionalEvaluator.test.ts` | 5/18 | **quarantine** | Pilot condition-evaluator drift. Parked. | High |
| 17 | `lib/pilot/__tests__/ConditionalEvaluator.contains_any.test.ts` | 25/25 | **quarantine** | `contains_any` operator is entirely red. Parked. | High |
| 18 | `lib/orchestration/__tests__/TokenBudgetManager.test.ts` | 17/21 | **quarantine** | Orchestration budget drift. Parked. | High |
| 19 | `lib/orchestration/__tests__/IntentClassifier.test.ts` | 1/23 | **quarantine** | Orchestration classifier drift. Parked. | High |
| 20 | `lib/utils/__tests__/featureFlags.test.ts` | 6 | **fix-test** | PR #78 renamed the flag. The test still sets `USE_THREAD_BASED_AGENT_CREATION`, but `featureFlags.ts` reads `NEXT_PUBLIC_…`. **Source is correct.** Update the env names in the test. | High |
| 21 | `lib/website-builder/__tests__/archetypes.test.ts` | 1 | **fix-test** | `recipes.ts` lines 71–83 record that `pricing` was **deliberately** taken out of `offer_led`, because the services block already prints each price. It is kept in `landing`. **Source is correct.** Rewrite the "trainer gets a price list" assertion to say that: trainer has `services` and no duplicate `pricing`, and `landing` keeps `pricing`. | High |
| 22 | `lib/business-os/usage/__tests__/tokenUsageRepository.contract.test.ts` | 1 | **fix-test** | `bde9ead8` (2026-09-22) added `summariseFeatureAllAccountsInWindow(window, feature)`. It is a deliberate admin-only cross-tenant read (S1-T14, FR-18/AC-25) that returns a row count and the newest row's timestamp, with no tenant data. Pin it at arity 2, and add a `@ts-expect-error` line like the existing all-accounts method has. ⚠️ This pin is a security tripwire. Adding the entry is exactly the review it exists to force, so **SA must acknowledge the entry**. | High |
| 23 | `lib/business-os/catalog/__tests__/proposals-capability.test.ts` | 1 | **fix-test** | Migration `20260928b_proposal_stopped_state.sql` added `stopped` to `proposals_status_check`, and #151 added it to the catalog. Catalog and database agree; the list in the test is stale. Add `'stopped'`. | High |
| 24 | `lib/business-os/credits/__tests__/creditPeriod.test.ts` | 2 | **fix-test** | **Fails only on Windows. It is a line-ending bug in the test, not a product bug.** `withoutDisplayMaths` strips functions with `/…\n}\n/`. With `core.autocrlf=true` the checkout is CRLF, so the regex never matches. Replayed against the LF blobs from git, both checks pass, so on the Linux runner it would be green. Normalise `\r\n` to `\n` in `codeOf`. | High |
| 25 | `lib/business-os/llm/__tests__/callParams.boundary.step3.test.ts` | 1 | **fix-test** (re-record 1 snapshot) | The hash of the chat/planner system prompt changed (length 31,356 → 31,366) after the snapshot was last recorded at `a5764a26` (2026-09-27). The chat planner has no file reads, so line endings are not the cause. **Condition:** before re-recording, bisect `a5764a26..894150f5` on this suite alone, name the commit, and confirm it is an intentional prompt change (the likely one is #151's catalog edit). Re-record only that snapshot. If the change was not intentional, quarantine the suite and flag it. | Medium |
| 26 | `lib/website-builder/__tests__/selectTemplate.test.ts` | 13/13 | **quarantine** + flag TL | **Not a stale mock.** `selectTemplate.ts` imports `WEBSITE_TEMPLATES` and `getTemplatesByVertical`, which `templates.ts` stopped exporting in `8c53562a` (2026-09-14). Nothing in `app/`, `lib/`, `components/`, `hooks/` or `scripts/` imports `selectTemplate.ts`, so the module itself is dead. Deleting it is a product-code change, so this slice quarantines it. See [SA-Q2](#09-open-questions-for-sa). | High (diagnosis) |
| 27 | `app/api/cron/__tests__/runRecord.adoption.test.ts` | 1/39 | **fix-test** | `8dfbd138` (2026-09-27) made the payment-reminders route call `paymentReminderService.billDueDatedStages()` first. The test's mock lacks that method, so the route throws a `TypeError` and returns 500. Add `billDueDatedStages: async () => ({ billed: 0, skipped: 0, failed: 0 })` to the mock. **Source is correct** (the method exists at `PaymentReminderService.ts:1576`). | High |
| 28 | `app/api/business-os/chat-v4/__tests__/route.audit.test.ts` | worker crash | **fix-test** | `c1a427e6` (2026-09-22) added `supabaseServer.from('user_preferences')` inside a `Promise.all`, but the test mocks `supabaseServer` as `{}`. Building the array therefore throws synchronously *after* `findByUserId(...)` has already started. That orphaned promise later rejects with no handler, and Node 22 kills the Jest worker. With a real client this cannot happen, so **it is not a production bug.** Give the mock a `from → select → eq → maybeSingle` chain that returns `{ data: null }`. Every case except the 401 one has probably been broken since `c1a427e6`, not just the one that crashes. | Medium-high |
| 29 | `app/admin/business-os-invites/__tests__/page.render.test.tsx` (flaky) | 3 time out under load | **fix-test** (timeout only) | It is a 776-line jsdom suite that types character by character with `userEvent.type`, and it takes 28.6s on its own. Under full parallel load, 3 tests go over Jest's 5,000ms default. Set a file-level `jest.setTimeout(30_000)` with a comment; no assertion changes. Not quarantined, because quarantining a flake hides the only test of a live admin screen. Re-check under the gate's worker count. | Medium |

Two of these need TL's attention but **not in this slice**:
- `chat-v4/route.ts` reads `supabaseServer` directly from the route. That breaks CLAUDE.md rule 1 (repository pattern). It predates this slice.
- `selectTemplate.ts` is dead source code (row 26).

**One correction to the briefing:** `tests/plugins/integration-tests/` now holds **11** suites, not 9. Measured: 8 skip without credentials (31 tests pending). The other 3 run credential-free and pass, with 16 tests: `drive-download-to-extractor`, `document-extractor-different-fields`, `document-extractor-all-invoices`. M-8 excludes the whole directory, and this plan keeps that. See [SA-Q3](#09-open-questions-for-sa).

### 0.5 Mechanism — how the baseline is excluded

**Recommendation: a separate gate config, `jest.gate.config.js`, that loads the quarantine JSON into `testPathIgnorePatterns`.** It replaces A0's `projects` split. SA rules.

```js
// jest.gate.config.js: the PR gate. Everything jest.config.js collects, minus
// the committed quarantine and the credential-gated plugin integration tests.
const base = require('./jest.config.js');
const { suites } = require('./.github/ci/jest-quarantine.json');
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = {
  ...base,                       // shared testMatch, transform, moduleNameMapper, setupFiles
  rootDir: __dirname,            // explicit, per SA Q-5(1)
  testPathIgnorePatterns: [
    ...base.testPathIgnorePatterns,          // keeps '<rootDir>/.claude/', whose comment stays in jest.config.js
    '<rootDir>/tests/plugins/integration-tests/', // SA M-8
    ...suites.map((s) => `<rootDir>/${escapeRegex(s.path)}$`),
  ],
};
```

| | `projects` split (old A0) | **Gate config (recommended)** | Env switch inside `jest.config.js` |
|---|---|---|---|
| `jest.config.js` edited? | Rewritten into two projects | **Untouched**, so the `.claude/` comments survive by construction | Edited |
| `npm test` still means "everything" | Yes, but the output gains project prefixes | **Yes, byte-identical** | Only while the env var is unset |
| `rootDir` trap (Q-5(1)) | Must be set on both projects | Set once; it is the same directory anyway | n/a |
| `testMatch` drift (Q-5(2), the 7 lost suites) | Risk, if `agents` gets its own globs | **None.** It is spread from the base config. | None |
| Selecting the quarantined suites | Needs an `agents` project built from a list, which is awkward | Not needed. The nightly (C1) runs plain `jest`. | n/a |
| What a reviewer has to read | 2 projects × 6 keys | **10 lines + 1 JSON** | A conditional inside the main config |

All four of SA's A0 conditions still hold:
- `rootDir` is explicit.
- The anchored `<rootDir>/.claude/` patterns, comments included, are inherited from an untouched file. `modulePathIgnorePatterns` comes through the spread.
- `testMatch` is shared.
- The list is removals-only, enforced by [§0.6](#06-count-guard).

The env-switch option is rejected because it makes the meaning of `npm test` depend on the environment.

**The quarantine file lives under `.github/ci/`, not `scripts/`.** `non-deploying-change.sh` treats `scripts/**` as skippable. A PR that only added a quarantine entry under `scripts/` would therefore skip the very gate that is supposed to refuse it. `.github/` is never skippable, which is the same reason the skip script itself lives there.

Entry shape:

```json
{ "path": "lib/pilot/__tests__/ConditionalEvaluator.test.ts", "reason": "…", "since": "894150f5" }
```

Two things Dev must verify, both caught by the partition check:
- Paths are escaped, because Next.js route folders such as `[token]` are regex syntax.
- On Windows, Jest's `replacePathSepForRegex` has to keep the escapes intact.

### 0.6 Count guard

A Node script with no dependencies, `.github/ci/jest-gate-check.mjs`. It lives in `.github/` so it is never skippable, and runs locally with the same arguments. It replaces A4's `*.guard.test.ts`, because a Jest test cannot see run totals, and it certainly cannot see them across shards ([§0.7](#07-workflow-spec)). It still satisfies H-4's real demand, which is that the check is committed and runs every time rather than being counted once by hand.

| # | Assertion | Kind | Expected after this slice |
|---|---|---|---|
| G1 | **Partition.** The full `--listTests` equals the gate's `--listTests` + the quarantine + `tests/plugins/integration-tests/`, with no overlaps. | **Exact, computed** | 743 = **721** + 11 + 11 |
| G2 | Every quarantine entry exists on disk and has a non-empty `reason` | Exact | 12 |
| G3 | **Ratchet.** The quarantine paths are a subset of the base branch's (`git show HEAD^1:.github/ci/jest-quarantine.json`). Fail closed if the base cannot be read. | Exact | ⊆ base |
| G4 | No listed path contains `/.claude/` | Exact | 0 |
| G5 | **Executed equals listed.** The sum of `numTotalTestSuites` over all result files equals G1's gate count, and `numRuntimeErrorTestSuites` is 0. This catches a suite that crashes or silently drops out, as row 28's did. | Exact, computed | 721 |
| G6 | No suite in the gate is wholly skipped (`numPendingTestSuites`) | Exact | 0. All 8 of today's skipped suites are integration suites, and the gate excludes them. |
| G7 | **Floors.** Gate suites ≥ `minSuites` and gate tests ≥ `minTests`, read from the same JSON. Raise them by hand. Lowering one is a visible diff that needs SA. | Ratchet | Pinned from the **first Linux run**. Planning figures below. |

**Planning figures**, derived from the measurement plus per-suite counts taken here:

| | Suites | Tests |
|---|---|---|
| Full suite today | 752 | 13,547 |
| − 8 dead suites (fail to compile, so 0 tests counted) | 744 | 13,547 |
| − 12 quarantined (11 agent-side = 300 tests, `selectTemplate` = 13) | 732 | 13,234 |
| − 11 integration suites (47 tests, 31 of them pending) | **721** | **13,187** |
| + `chat-v4/route.audit` cases, if the crash kept them out of the 13,547 | 721 | ≈ 13,187–13,192 |

That leaves about 34 skipped tests in the gate (65 − 31), from `it.skip`/`todo` elsewhere. Expect a ±2 drift from the rows 21/22 rewrites. Dev records the real numbers.

**Floor, not exact equality — this is a deviation from A4, for SA to rule on.** A4 pinned exact counts (377 / 5,792). At 752 suites with several PRs a day, an exact test count means every PR that adds a test edits the same line. That puts every pair of concurrent PRs in conflict, and a guard that conflicts constantly gets bypassed. H-4's actual failure mode is a typo'd ignore pattern or a narrowed `testMatch`, and the **exact, computed** G1 and G5 catch it without any pinned number. The floor only adds a backstop against bulk deletion. What the floor does *not* catch is someone deleting single `it` blocks inside a suite. That deletion is visible in review, and stays a known residual.

**Line endings:** Windows and Linux can disagree about which tests fail (row 24 is the proof). The failing set and the floors are therefore **taken from the first Linux run**, not from the dev box.

### 0.7 Workflow spec

File `.github/workflows/tests.yml`. The house conventions come from `bos-entitlements.yml`, with that file's `NODE_VERSION: '18'` drift deliberately **not** copied.

| Property | Value |
|---|---|
| Triggers | `pull_request: [main]`, `push: [main]`, `workflow_dispatch` |
| `paths:` filter | **None** |
| Permissions | `contents: read` |
| Concurrency | `group: tests-${{ github.ref }}`, `cancel-in-progress: true` |
| Node | `actions/setup-node@v4`, `node-version-file: '.nvmrc'` (22), `cache: 'npm'` |
| Env / secrets | **None.** `tests/plugins/jest-setup.ts` stubs the five module-load variables. `grep -n 'secrets\.' tests.yml` must return nothing. |
| Command | `npx jest --config jest.gate.config.js --ci --maxWorkers=4 --json --outputFile=gate-results-<n>.json` (+ `--shard=<n>/<N>` if sharded) |
| Exit semantics | The Jest step runs bare, with no `\|\|`, no `set +e` and no `continue-on-error`. The summary/check step is `if: always()`, so counts are printed even when the job is red. |
| Step summary | Suites and tests as passed / failed / skipped, the quarantine size, the floor and the margin over it, and the names of failing suites |
| `timeout-minutes` | 20 per shard, 5 for the aggregator (single-job variant: 30) |
| **Required-check name** | **`Gate tests (jest)`**, and only on the job that reports the final verdict |

**Job layout (recommended, sharded with an aggregator, as SA H-2's escape hatch allows):**

1. **`scope`**. Checkout with `fetch-depth: 2`, then run `non-deploying-change.sh` exactly as `bos-entitlements.yml` does (`BASE` = `github.event.before` on push). Output: `skip`.
2. **`shard`** (matrix `n = 1..N`), named `Gate tests shard ${{ matrix.n }}`, with `needs: scope` and `if: skip != 'true'`. Steps: checkout, setup-node, `npm ci`, the Jest command with `--shard`. Shard 1 also writes the full and gate `--listTests` files. Each shard uploads its JSON as an artifact.
3. **`gate`**, named **`Gate tests (jest)`**, with `needs: [scope, shard]` and `if: always()`. If `scope` failed, it fails. If `skip == 'true'`, it passes and writes "Skipped: non-deploying change" to the summary. Otherwise it requires `needs.shard.result == 'success'`, downloads the artifacts, and runs `jest-gate-check.mjs` (G1–G7) with plain `node`. **No `npm ci` here, so it costs seconds.**

The shard jobs must never be required, and their name must not contain `Gate tests (jest)`. The future nightly (C1) must not reuse that string either (SA §9 gap 5).

#### 0.7.1 Runtime budget — the gate must not lengthen CI

**Constraint (user, 2026-10-02):** the gate runs in parallel with `Build (next build)`, so it must not add time. **Target (SC-1, replacing the earlier ≤ 420s): on the PR's first run and on a re-run, `Gate tests (jest)` completes before `Build (next build)` of the same run, and the Tests workflow's wall-clock is ≤ 85% of the Build workflow's. Hard ceiling: 150s.** (The ~497s build was a dev-box figure; on GitHub, Build takes ~165s. See SA's review in §11.) It is measured on a **cold** run. Cold runs keep coming back: whenever the lockfile changes, and whenever GitHub evicts a cache (7 days unused, 10 GB LRU). Those are exactly the dependency-bump PRs where a slow gate hurts most.

**(a) Cold estimate for a 4-core GitHub runner at 752 suites**

| Input | Value |
|---|---|
| Dev box, cold | 374s wall, 8 cores, so Jest's default is 7 workers |
| Implied CPU | ≈ 2,200–2,600 worker-seconds. The gate is ~96% of the suites, so **~2,100–2,500s**. |
| Runner per-core speed vs dev box | **1.0–1.5×** slower. Slower cores, partly offset because Linux is faster than Windows at file I/O and process spawning. |
| Setup per job | checkout + setup-node with npm cache + `npm ci` ≈ **100–120s** (Dev measures this) |

| Shape | Execution | + setup | **Verdict at** | Fits the old 420s? (superseded by SC-1) |
|---|---|---|---|---|
| 1 job, default 3 workers | 700–1,250s | +110s | **~13–23 min** | ❌ far over |
| 1 job, `--maxWorkers=4` | 525–940s | +110s | **~10–18 min** | ❌ |
| 1 job, 4 workers, warm ts-jest cache (−30–50%, unmeasured) | 260–660s | +110s | ~6–13 min | ❌, borderline at best |
| 3 shards × 4 workers + aggregator | 175–310s | +110s, +25s aggregator | **~310–445s** | ⚠️ fits at the optimistic end only |
| **4 shards × 4 workers + aggregator** | 130–235s | +110s, +25s | **~265–370s** | ✅ with 12–37% margin |

**This changes an earlier conclusion.** §4's "the gate finishes inside the build window" was true at 396 suites. At 752 suites **a single job does not fit**, cold or, very likely, warm. The suite roughly doubled in eleven days. A single job would make the Jest gate the critical path of every PR, by an estimated 5–15 minutes.

**(b) Levers that keep it under the build without dropping coverage**

| Lever | Effect | Coverage cost | Recommendation |
|---|---|---|---|
| **Shard matrix + one aggregator job** (`needs`, `if: always()`, the only job named `Gate tests (jest)`) | Splits execution N ways. Each shard pays its own setup. | **None.** `--shard` is a deterministic, total partition (verified earlier at 190 + 190 = 380), and G5 proves the shards add up to the whole. | **Adopt, N = 4.** The shard count is one constant. |
| Explicit `--maxWorkers=4` | Uses all 4 vCPUs; the default leaves one idle. ~25% faster. | None | **Adopt.** Watch memory on the jsdom suites (16 GB runner). `--workerIdleMemoryLimit` is a fallback if workers bloat. |
| npm cache via `setup-node` `cache: 'npm'` | Shortens `npm ci` | None | **Adopt**, as `build.yml` does |
| ts-jest/Jest cache (`--cacheDirectory`), key `jest-<os>-<hash(package-lock.json)>-<run_id>` with restore-keys on the lockfile prefix, **saved only from `main`** | 30–50% less execution on a warm hit (unmeasured) | None, **provided the cache is correct** | **Hold as fallback 2.** ⚠️ If ts-jest's cache key does not include changes to *imported* files' types, a warm cache could show a type-diagnostic failure as green. That is unacceptable for a required check. Adopt only after Dev proves it: change an exported type in a module, and confirm the dependent test re-type-checks on a warm cache. It also competes for the 10 GB cache with the npm caches that `build.yml`'s comment protects. |
| Larger runner (8-core) | ~2× | None | Not free, even on a public repo. Out of scope unless the user chooses to pay. |

Still rejected, per earlier SA rulings: `--onlyChanged` / `--changedSince` as the gate (H-3), directory exclusion (M-4), and a shard matrix *without* an aggregator (H-2). Transpile-only / `@swc/jest` / `diagnostics: false` stays in the §8 backlog. It would change *what* the gate checks (type diagnostics inside tests), so it needs its own measured slice.

**Cost note.** On today's public repo, Actions minutes are free. Once the repo goes private (environments workplan A3), 4 shards bill about 4 × setup + execution, roughly 2–2.5× the minutes of a single job, to save the wall-clock. Revisit N when that happens.

**(c) Fallback if the measured run still exceeds the build**

The budget is judged on the PR's **own first two runs**: one cold, then one re-run.

1. **Raise N from 3 to 4** (SC-1).
2. ~~Add the lockfile-keyed cache~~. **Removed by SC-4**: Jest here is transpile-only, so the cache saves ~1%.
3. **If it is still over:** stop and go back to SA and the user. Two options remain, and neither is Dev's call. Either accept a gate that finishes after the build (this breaches the user's constraint, so it needs the user's explicit consent), or run a transpile-only spike as its own slice. Never fall back to a coverage-cutting lever.

#### 0.7.2 Known gap in the skip rule — SA to rule

`non-deploying-change.sh` treats every `scripts/**` file except test files as skippable. But **3 gate suites test source files under `scripts/`**:
- `scripts/__tests__/bos-llm-settings.test.ts` → `scripts/bos-llm-settings.ts`
- `scripts/test-dsl-execution-simulator/__tests__/variable-store.wp35.test.ts` → `../variable-store.ts`
- `scripts/test-dsl-execution-simulator/__tests__/stub-data-generator.wp36.test.ts` → `../stub-data-generator.ts`

A PR that changes only one of those sources would skip the gate and merge with a broken test. The script's own header predicted this ("the day one does, it does not inherit a blind spot") and carved out test files, but not their sources. See [SA-Q1](#09-open-questions-for-sa).

### 0.8 Test plan — proving green **and** complete before handover

Local runs are on the Windows dev box. Linux is proven on the PR itself.

| # | Check | Method | Pass |
|---|---|---|---|
| T1 | Partition | `node .github/ci/jest-gate-check.mjs --list-only` (G1–G4) | 743 = 721 + 11 + 11; 0 `.claude` |
| T2 | Gate green | `npm run test:gate -- --json --outputFile=…`, then the check script | exit 0; G5 721 executed; G6 0 |
| T3 | Each fix is a test-only fix | `git diff --stat` and `git diff --name-only` | Changes appear only under `__tests__/`/`*.test.*`, plus the 2 configs, `.github/ci/*`, `tests.yml`, `package.json` and the deletions. `featureFlags.ts`, `recipes.ts`, `TokenUsageRepository.ts`, `catalog.ts`, `creditPeriod.ts`, the payment-reminders route and the chat-v4 route are **unchanged**. |
| T4 | Snapshot provenance (row 25) | bisect log in the workplan | commit named and shown to be intentional |
| T5 | Ratchet bites | Add a bogus quarantine entry; remove a genuinely failing one | G3 fails; the gate goes red |
| T6 | A failure fails the job | Break one gate assertion on a scratch commit | Jest step exits 1; the verdict job is red |
| T7 | Flake fixed | Run the gate 3× at `--maxWorkers=4` | `page.render.test.tsx` green each time |
| T8 | `npm test` unchanged | `npx jest --listTests \| wc -l` | 743 (752 − 8 dead − `selectTemplate`) |
| T9 | Linux parity | First PR run of `tests.yml` | Same failing set (none); real counts copied into G7's floors in one follow-up commit **before merge** |
| T10 | Budget | Duration of the PR's verdict job vs `Build (next build)`, cold and on a re-run | SC-1: on both runs the verdict job completes before Build, the Tests workflow's wall-clock is ≤ 85% of Build's, and it stays under the 150s ceiling |
| T11 | No secrets, no snapshot writes (SC-10) | `grep -nE 'secrets\.\|updateSnapshot\|(^\|[[:space:]])-u([[:space:]]\|$)' .github/workflows/tests.yml` and the `test:gate` script | no match |
| T12 | Skip path reports | A docs-only commit on the PR | the verdict job **passes** and its summary says "Skipped" |
| T12b | `scripts/` runs the gate (SC-5) | A `scripts/`-only commit on the PR | the shards run Jest; nothing is skipped |
| T13 | Verdict fails closed (SC-3) | Scratch commit A: one shard exits 1 before Jest. Scratch commit B: one shard's upload step removed | the verdict job is red on both |

**After merge (user):** in Settings → Branches → `main` → Require status checks, add exactly **`Gate tests (jest)`**. It is the aggregator's name; never require a `Gate tests shard N`. Then prove it with a throwaway PR that the merge is **blocked**, not merely red (still outstanding for `Admin authz surface guard` too).

### 0.9 Open questions for SA

| # | Question | Dev's recommendation |
|---|---|---|
| **SA-Q1** | Skip-rule gap (§0.7.2): how does `tests.yml` avoid skipping a change to a `scripts/` file that a gate suite imports? | `tests.yml` adds a second condition: run whenever any `scripts/**` file changed. Leave the shared `non-deploying-change.sh` alone, so Vercel's build skipping is unaffected. |
| **SA-Q2** | `selectTemplate.ts` is dead (row 26). Quarantine it, or delete source and test in this slice? | Quarantine here (guardrail 1), and delete it in a follow-up. If SA rules that dead-source deletion counts as test hygiene, delete both now; the quarantine then holds 11. |
| **SA-Q3** | 3 integration suites (16 tests) run and pass with no credentials. Keep excluding the whole directory (M-8)? | Yes, keep it as ruled. The nightly will run them. Whether those 3 make network calls has not been checked. |
| **SA-Q4** | Floor (G7) instead of A4's exact counts? | Floor, plus the exact, computed G1/G5 (see the reasoning in §0.6). |
| **SA-Q5** | Sharded aggregator as the **primary** layout, N = 4? | Yes. The single-job estimate is over budget by minutes, not seconds. |
| **SA-Q6** | Row 22 adds an entry to the cross-tenant contract pin | Approve. The method's tests already prove it returns only a row count and a timestamp. |

---

## Table of Contents

0. [Slice 1 — Jest gate on every PR](#0-slice-1--jest-gate-on-every-pr-refreshed-2026-10-02-against-894150f5)
1. [Measured baseline](#1-measured-baseline)
2. [Diagnosis](#2-diagnosis)
3. [Scope and non-goals](#3-scope-and-non-goals)
4. [The tiering model](#4-the-tiering-model)
5. [Wave A — Split, then make the gate green](#5-wave-a--split-then-make-the-gate-green)
6. [Wave B — Put tests in CI](#6-wave-b--put-tests-in-ci)
7. [Wave C — Nightly quarantine and the QA agent](#7-wave-c--nightly-quarantine-and-the-qa-agent)
8. [Options measured and rejected](#8-options-measured-and-rejected)
9. [Test plan](#9-test-plan)
10. [Task list](#10-task-list)
11. [SA review](#11-sa-review)
12. [Change History](#change-history)

---

## 1. Measured baseline

> **Superseded 2026-10-02 by [§0.4](#04-disposition-of-every-red-suite).** At `894150f5` the suite has 752 suites and 13,547 tests, and 29 suites are red (28 every time, 1 flaky). The figures below are the `d00006ac` record and are kept as history. Do not use them as targets.

All figures re-measured 2026-09-21 on **`origin/main` @ `d00006ac`** (the tip after PRs #79–#84), Windows 11, Node v22.19.0.

> **Re-baselined before commit.** The first pass was measured on a local `main` @ `9aeeb50e` that was **20 commits stale**. Those commits (admin-authz closure, identity hardening, BOS-LLM Layer 2 Step 1, payment lockdown) added **16 suites and 378 tests** and changed `package.json` — so every count below moved. The numbers were re-taken on the current tip because §5 A4 turns them into a **committed guard assertion**; a stale count there would fail CI on arrival.
>
> **The failing set did not move at all.** 21 suites / 129 tests fail at both revisions, and a set comparison shows **zero new, zero gone** — the same 21 files. So the quarantine list, the 8 dead suites and the A2/A3 fixes are unchanged; only the totals shifted. No dependency or lockfile change, so `node_modules` is unaffected.

| Measurement | Result |
|---|---|
| Full Jest suite | **107.4s** — 396 suites (388 ran, 8 skipped), 6,092 tests, **21 failing suites / 129 failing tests** |
| `next build` | **497s (8.3 min)**, 295 pages |
| `tsc --noEmit` | 637s @ 8 GB heap; **OOMs at the 4 GB default**; **2,035 errors** |
| Workflows running the **full** Jest suite | **zero** — see the correction below |
| Trivial 11-test suite, cold | 5.5s (ts-jest per-file type-check dominates) |

Measured at the earlier `9aeeb50e` and still indicative, not re-taken: Business-OS-scoped run **41s** (142 suites, 2,263 tests); full-suite CPU **719s** across workers.

> **Correction (SA L-1).** An earlier draft of this document claimed *"zero Jest invocations in `.github/workflows/`"*. **That was false.** `admin-authz-guard.yml` runs `npm run test:authz-guard` — a Jest invocation — on **every PR**, and `plugin-tests.yml` runs four more (`test:plugins:unit`, `:smoke`, `:integration`, `:all`). The accurate claim is narrower and is the one used throughout: **no workflow runs the full suite; only `tests/plugins/` and one guard suite ever execute in CI, and the plugin workflow is path-filtered so a typical Business OS PR runs exactly one suite.**
>
> Correcting this **strengthens** [D-1](#d-1--tests-never-run-in-ci-so-they-rot) rather than weakening it — see the natural experiment recorded there.

### Scope comparison — the gate design decision

Measured **back-to-back at `d00006ac`** so the three are comparable.

| Scope | Suites | Tests | Time | Failing suites |
|---|---|---|---|---|
| Full suite | 396 (388 ran, 8 skipped) | 6,092 | 107.4s | 21 |
| Directory-based gate (original proposal) | 303 (295 ran) | 4,939 | 86.2s | 2 |
| **Health-based gate (adopted — SA M-4)** | **377** (369 ran) | **5,792** | **88.5s** | **2** |

**The health-based gate costs +2.3s and buys +853 tests / +74 suites.** In both designs the only two failures are `featureFlags.test.ts` and `archetypes.test.ts`, which Wave A fixes.

SA estimated the directory split would save ~30s; on the stale tree it measured ~22s, and on the current tip it is **~2s — inside run-to-run noise**. The saving the directory split was supposed to buy has effectively vanished while its three structural traps remain. That settles the design choice decisively — see [§4](#4-the-tiering-model).

The 8 suites skipped in every row are `describeIfCredentials` plugin-integration skips, not the 8 dead files (those are excluded by path and never counted).

### Cost and failure split

| Bucket | CPU | % of CPU | suites | tests | **failing suites** |
|---|---|---|---|---|---|
| **Agents** (`agentkit`, `pilot`, `orchestration`, `calibration`, …) | 254s | 35% | 91 | 1,120 | **19** |
| **Business OS** | 202s | 28% | 145 | 2,323 | 1 |
| Shared / other | 145s | 20% | 88 | 1,300 | 1 |
| Plugins | 117s | 16% | 56 | 971 | 0 |
| **Total** | **719s** | | **380** | **5,714** | **21** |

The area the team is **not** developing carries 35% of the runtime, 20% of the tests, and 90% of the failures.

### Current CI surface

| Workflow | Runs | Gating? |
|---|---|---|
| `build.yml` — `next build` | every PR + push to `main`, minus the `non-deploying-change.sh` skip | **No** |
| `admin-authz-guard.yml` | every PR + push | **Yes — the only required check** |
| `react-hooks-guard.yml` | every PR + push | No |
| `bos-llm-typecheck.yml` | every PR + push | No |
| `plugin-tests.yml` | path-filtered to `lib/server/**`, `lib/plugins/**`, `tests/plugins/**`; integration + full suite nightly only | No |

Branch protection on `main`, read live via `gh api`:

```
enforce_admins: true
required_status_checks: [ "Admin authz surface guard" ], strict: false
required_pull_request_reviews: null
```

**A pull request is not required to merge to `main`.** A direct push bypasses every workflow trigger except `push: [main]`, which reports only after the code has landed.

---

## 2. Diagnosis

### D-1 — Tests never run in CI, so they rot

No workflow runs the full suite. Of **396 suites**, exactly **one** (`admin-authz-surface.guard.test.ts`) runs unconditionally on every PR; the 56 `tests/plugins/` suites run only when a PR touches `lib/server/**`, `lib/plugins/**` or `tests/plugins/**`. So **86% of the suite has no CI coverage even in the best case** — and on a typical Business OS PR, which touches none of those paths, **395 of 396 suites never run**. The consequence is observable, not theoretical:

| Evidence | Detail |
|---|---|
| 8 suites import deleted modules | `DeclarativeCompiler` was deleted **2026-02-19** (`aa2df32b`). Its 5 root `__tests__/` suites have failed for seven months. `lib/agentkit/v6/generation/` now contains only `__tests__/` and `prompts/` — the generator source is gone, and 2 suites still import `EnhancedPromptToIRGenerator_DEPRECATED`. `__tests__/v6-integration.test.ts` imports `IRToDSLCompiler`, also gone. SA confirmed all three were deleted in that one commit and that **nothing live imports them**. |
| A red test merged **yesterday** | PR #78 (`6444f0d8`, feature-flag rename) left [`featureFlags.test.ts`](lib/utils/__tests__/featureFlags.test.ts) setting `USE_THREAD_BASED_AGENT_CREATION` while [`featureFlags.ts:19`](lib/utils/featureFlags.ts:19) reads `NEXT_PUBLIC_USE_THREAD_BASED_AGENT_CREATION`. 6 tests fail. Nothing caught it. |

### The natural experiment

The correction in §1 turns this diagnosis from an assertion into a controlled comparison. Four buckets, one of which has CI coverage:

| Bucket | Runs in CI? | Failing suites |
|---|---|---|
| **Plugins** | **Yes** — `plugin-tests.yml`, on every PR touching its paths, plus nightly | **0** |
| Agents | No | 19 |
| Business OS | No | 1 |
| Shared / other | No | 1 |

**The only bucket that runs in CI is the only bucket with zero failures.** It is also not the newest or best-staffed code — `tests/plugins/` is 56 suites of executor tests against 11 plugins, an area nobody has actively developed for months. The variable that predicts health here is CI coverage, not attention. That is the whole argument for Wave B in one table.

### D-2 — The expensive gate validates the least

`next.config.js` sets `typescript.ignoreBuildErrors: true` and `eslint.ignoreDuringBuilds: true`. `next build` therefore proves that the bundler completes and module-scope code does not crash during page-data collection — a real and valuable class, and exactly why [CI_BUILD_GATE_WORKPLAN.md](/docs/workplans/CI_BUILD_GATE_WORKPLAN.md) exists — but it proves nothing about types, lint, or behaviour. It is 8.3 minutes of the roughly 9-minute CI picture.

### D-3 — QA is slow from ambiguity and noise, not runtime

| Cause | Evidence |
|---|---|
| No commands to run | [`quality-assurance.md`](.claude/agents/quality-assurance.md) contains **zero** concrete `jest` / `npm test` invocations. The agent re-derives a plan every cycle. |
| Default scope is `full` | Line 61: *"All acceptance criteria + edge cases + error paths (default if no scope given)"*. |
| 129 irrelevant failures to triage | Any full run surfaces them; none relate to the change under review. This is the token burn. |
| Playwright is referenced but not installed | 5 agent definitions (`business-analyst`, `developer`, `quality-assurance`, `system-architect`, `troubleshooter`) name Playwright. CLAUDE.md § Testing already records that it was never installed. QA spends turns on a path that cannot exist. |

### D-4 — Token spend is concentrated in one place

The only genuinely token-expensive test asset is [`tests/business-os-chat/run-eval.ts`](tests/business-os-chat/run-eval.ts) — **74 scenarios** of live LLM planning, with a `--runs=N` multiplier. It is run manually and is in no workflow. It is correctly placed; it must simply never enter the inner loop or the PR gate. Everything else in the suite is deterministic and mock-backed.

> **Correction (SA L-2).** An earlier draft claimed "13 `*.guard.test.ts` static scans … cover the security class". The real count is **4**: `admin-authz-surface`, `no-deletion-paths`, `dead-plugin-routes-removed`, `system-initializer-removed` (6 if the differently-named `semanticGate.coverageGuard` and `param-constraint-guard` are counted). The 13 came from a `find` that did not prune `.claude/worktrees/`, where **1,297 test files** from other branches live — the exact hazard the ignore-rule comments in [`jest.config.js`](jest.config.js) document. **The guard surface is thinner than assumed, and "the security class is covered" is not a claim this document can make.** Expanding it is worthwhile but is not in this workplan's scope.

---

## 3. Scope and non-goals

### In scope

| | |
|---|---|
| Split Jest into named projects + a shrinking quarantine baseline, so failing agent-side suites are preserved but non-blocking | Wave A (A0) |
| Make the gate scope green **and prove it is complete** | Wave A (A1–A4) |
| Run that scope in CI on every PR | Wave B |
| Run the full suite nightly, reporting only the delta against the baseline | Wave C |
| Give the QA agent explicit commands and a cheaper, non-vacuous default | Wave C |

### Non-goals (explicitly deferred)

| Deferred | Why / where |
|---|---|
| **Moving `next build` off the PR path** | [CI_BUILD_GATE_WORKPLAN.md](/docs/workplans/CI_BUILD_GATE_WORKPLAN.md) deliberately chose no `paths:` filter and no `.next/cache` (D-2 there), reasoning that workflows run **in parallel** and Actions minutes are free on a public repo. That reasoning holds and this workplan does not reopen it. See [§4](#4-the-tiering-model) for what it means for us. |
| Fixing the 13 live-failing agent-side suites | Quarantined, not repaired. Belongs to whoever resumes V6 work. |
| Removing `ignoreBuildErrors` / `ignoreDuringBuilds` | Blocked on the 2,035-error backlog. Parent: environments workplan backlog. |
| A repo-wide `tsc` or `eslint` gate | Rejected on evidence — see [§8](#8-options-measured-and-rejected). |
| Adding Playwright / E2E | New tooling pattern; needs SA review per CLAUDE.md § Testing. This workplan only removes the *stale references*. |
| Making any check *required* on `main` | GitHub admin action, user-owned. Tracked alongside OI-3. |

### Branch

`chore/test-tiering`, cut from `main`. Matches the `chore/ci-run-next-build` precedent for CI-infrastructure work.

---

## 4. The tiering model

The market-standard shape (Google's small/medium/large test sizes; DORA's fast-feedback finding; the classic test pyramid) is: **deterministic and fast gates the PR; slow, networked, or non-deterministic work runs on a schedule.**

| Tier | What runs | Target | Where |
|---|---|---|---|
| **0 — inner loop** | `jest --onlyChanged` / `--findRelatedTests <files>` | <15s | Dev + human, **local only** |
| **1 — PR gate** | `gate` project — everything except the quarantine baseline — plus the existing static guards | **4–6 min on a CI runner** | New `tests.yml` |
| **2 — PR, parallel** | `next build` | 8.3 min | `build.yml`, unchanged |
| **3 — nightly / on-demand** | Full suite **including** the quarantine, plugin integration tests (real tokens), `eval:chat` (74 LLM scenarios) | unbounded | `plugin-tests.yml` schedule + new nightly job |

> **No longer true for a single job (2026-10-02).** At 752 suites, a single gate job is estimated at ~10–23 min cold on a 4-core runner. That is well past the 497s build. §0.7.1 restores the "inside the build window" property with a 4-shard matrix and one aggregator job.

**Why this costs no extra PR wall-clock.** GitHub Actions runs workflows in parallel. `build.yml` already sets the PR's critical path at 8.3 minutes. The gate job finishes inside that window, so Tier 1 is effectively free in elapsed time — it adds a gate, not a delay. Same argument CI_BUILD_GATE_WORKPLAN.md used to justify a separate workflow, applied one step further.

> **The Tier-1 target is 4–6 min, not 2 (SA M-5).** The 129s figure is a warm-cache, 8-core dev box. Gate CPU is ~600s; a GitHub 4-core runner gives Jest `maxWorkers = 3` → ~200s of execution, **plus** `npm ci`, **plus** a cold ts-jest cache (§1's "trivial 11-test suite, cold = 5.5s" is the tell). The conclusion survives — it still fits inside the 497s build — but the honest number is 4–6 minutes. Consider caching the ts-jest cache directory keyed on `package-lock.json` **only**; never key a cache on source (the D-2 lesson from CI_BUILD_GATE_WORKPLAN.md).

> ⚠️ **Revisit if the repo goes private.** The "Actions minutes are free" premise depends on public visibility (confirmed `PUBLIC` on 2026-09-21). Wave A3 of the environments workplan makes the repo **private**, at which point every parallel job bills. Tier 1 is still the cheapest job in CI and stays; the build is the one to reconsider.

### Gate scope definition — quarantine by health, not by directory

**Adopted per SA M-4, replacing the original directory-based split.**

The gate is **everything**, minus a committed baseline list of individually-named known-failing suites. The list only ever shrinks. This reuses the house pattern already proven by [`scripts/typecheck-bos-llm.baseline.json`](scripts/typecheck-bos-llm.baseline.json): gate the whole surface, carry a shrinking list of known-bad items, and never let the *scope* absorb a *health* problem.

**Measured back-to-back at `d00006ac`** (see §1): **377 suites, 5,792 tests, 88.5s, 2 failing** — the two Wave A fixes. Against the directory-based alternative it costs **+2.3s** and gates **+853 more tests**.

#### Why directory-based was rejected

The original proposal excluded `lib/agentkit/`, `lib/pilot/`, `lib/orchestration/`, `lib/calibration/`, `lib/agent-creation/`, `lib/effort-estimator/`, `lib/schema-reconciliation/`, `app/v2/agents/`, `scripts/` and root `__tests__/`. It fails in **both** directions, which is the signal that directory is a proxy for the real variable:

| Direction | Example |
|---|---|
| **Under-excludes** | `tests/v6-regression/scenarios/gmail-scatter-attachment-extract/coverage-routing.test.ts` imports `CapabilityBinderV2` and `IntentToIRConverter` — agent-side by content, but not under an excluded directory, so it lands in the gate. V6 work could then redden a *required* check, or the test gets deleted to go green. |
| **Over-excludes** | `scripts/__preview__/render.test.ts` is a **Business OS** website-preview generator (`components/public/compositions`, `lib/website-builder/archetypes`). The blanket `scripts/` exclusion quarantines it to a nightly job where it writes to a hardcoded `/tmp/apc-preview` on the runner for no reason. |

Beyond correctness, the directory split **reintroduces the exact rot this workplan exists to end**: a shared-code change (a repository refactor, a provider-factory change) that breaks agent-side would get no PR signal, and would be discovered months later by whoever resumes V6. It also silently weakens the CLAUDE.md V6 Work Protocol, which assumes regressions are caught by the suites under `lib/agentkit/`, `lib/pilot/` and `scripts/test-dsl-execution-simulator/`.

#### The quarantine baseline

> **Superseded 2026-10-02:** Slice 1 quarantines **12** suites: these 11, plus `lib/website-builder/__tests__/selectTemplate.test.ts` (dead source code; see §0.4 row 26). The file moves to `.github/ci/jest-quarantine.json` (§0.5).

**11 suites**, all agent-side, all failing today. (SA's review says "~19" — that was the agent-side failing count *before* Wave A. A1 deletes 8 of them as dead, and A2/A3 fix the two non-agent failures, leaving 11.)

| Suite | Failing tests |
|---|---|
| `lib/agentkit/v6/logical-ir/schemas/__tests__/validation.test.ts` | 12 |
| `lib/agentkit/v6/translation/__tests__/IRToNaturalLanguageTranslator.test.ts` | 11 |
| `lib/agentkit/v6/compiler/__tests__/LogicalIRCompiler.test.ts` | 20 |
| `lib/agentkit/v4/__tests__/v4-generator.test.ts` | 22 |
| `lib/pilot/__tests__/StructuredTransforms.test.ts` | 4 |
| `lib/pilot/__tests__/StructuredTransforms.wp33.test.ts` | 3 |
| `lib/pilot/__tests__/StructuredTransforms.wp37.test.ts` | 2 |
| `lib/pilot/__tests__/ConditionalEvaluator.test.ts` | 5 |
| `lib/pilot/__tests__/ConditionalEvaluator.contains_any.test.ts` | 25 |
| `lib/orchestration/__tests__/TokenBudgetManager.test.ts` | 17 |
| `lib/orchestration/__tests__/IntentClassifier.test.ts` | 1 |

Rules, which are what make this a ratchet rather than a dumping ground:

1. The list lives in one committed file with a one-line reason per entry. **Entries may only be removed.** Adding one requires the same SA review as any other gate exemption — the equality-asserted-cap discipline `admin-authz-guard.yml` already uses.
2. Every quarantined suite is **still executed nightly**, unignored, so a fix is noticed.
3. `tests/plugins/integration-tests/**` (9 suites) is excluded from the gate too, for a different reason (SA M-8): they are inert today only because `describeIfCredentials` skips without `*_TEST_TOKEN`. The moment anyone adds those secrets to this job, every PR would hit live Google/Slack/Notion APIs. §4's own Tier 3 already places them nightly, where `plugin-tests.yml` runs them.

---

## 5. Wave A — Split, then make the gate green

A gate that is red on arrival gets disabled within a week — the failure mode `react-hooks-guard.yml` documents in its own header. Wave A exists so Wave B lands green.

> **Wave order corrected (SA H-1).** The original draft put the Jest `projects` split in Wave C, while A4, B1 and B2 all invoked `--selectProjects gate` — a scope that would not exist for two more waves. The split is now **A0**, the first task in the plan. The corrected order is **A0 → A1–A4 → B → C**, and each wave lands independently: A alone makes the suite honest, B alone adds the check, C alone fixes the QA agent.

### A0 — Jest `projects` split and the quarantine baseline

> **Superseded 2026-10-02 (pending SA ruling):** §0.5 recommends a separate `jest.gate.config.js` in place of the `projects` split. All four conditions below still apply to it.

Convert [`jest.config.js`](jest.config.js) to two projects, `gate` and `agents`, sharing the existing `moduleNameMapper`, `transform` and `setupFiles`. `npm test` with no selector must still run everything, so no existing invocation changes meaning.

Four conditions, three of them proven the hard way by SA's probe implementation:

| # | Condition | Why |
|---|---|---|
| 1 | Set `rootDir` **explicitly on both projects** | Inline project configs do **not** inherit the parent's `rootDir`; a project's `rootDir` resolves from its own config location. SA's probe failed with *"Preset ts-jest not found relative to rootDir \<scratchpad\>"*. |
| 2 | Keep `<rootDir>/.claude/` in **both** `testPathIgnorePatterns` and `modulePathIgnorePatterns`, **comments intact** | There are **1,297** test files under `.claude/worktrees/` today. A mis-anchored rule inflates the gate from 377 suites to thousands and runs other branches' code. The existing comments document the anchoring bug — do not drop them. |
| 3 | Define `agents` with `roots:` **plus the shared, unmodified `testMatch`** — never per-project `testMatch` globs | The per-project-glob approach is exactly what silently dropped 7 suites in SA's probe. |
| 4 | The quarantine list is a committed file with one reason per entry | See [§4](#4-the-tiering-model). Removals only. |

**Q-5 answered — this is not a "new pattern" under CLAUDE.md Mandatory Rule 7.** Rule 7 targets architectural patterns (a new data-access path, a new provider, a new tooling class). Jest `projects` is a configuration shape inside a tool already in the stack; the closest precedent is `plugin-tests.yml` already running Jest with a narrowed scope via CLI. Rule 7 is satisfied by the SA review in §11, which is the review it asks for.

### A1 — Delete provably-dead suites (8 files)

Each imports a module that no longer exists in the tree. These are not quarantine candidates; there is nothing left to test.

| File | Missing import | Deleted |
|---|---|---|
| `__tests__/DeclarativeCompiler-comprehensive.test.ts` | `lib/agentkit/v6/compiler/DeclarativeCompiler` | `aa2df32b`, 2026-02-19 |
| `__tests__/DeclarativeCompiler-dataflow-contract.test.ts` | same | same |
| `__tests__/DeclarativeCompiler-dataflow.test.ts` | same | same |
| `__tests__/DeclarativeCompiler-regression.test.ts` | same | same |
| `__tests__/DeclarativeCompiler-stress.test.ts` | same | same |
| `__tests__/v6-integration.test.ts` | `@/lib/agentkit/v6/compiler/IRToDSLCompiler` | — |
| `lib/agentkit/v6/generation/__tests__/EnhancedPromptToIRGenerator.test.ts` | `../EnhancedPromptToIRGenerator_DEPRECATED` | — |
| `lib/agentkit/v6/__tests__/integration/v6-end-to-end.test.ts` | `../../generation/EnhancedPromptToIRGenerator_DEPRECATED` | — |

This empties the root `__tests__/` directory; remove it.

**Q-1 answered — delete, do not archive.** `docs/archive/` is for documents per CLAUDE.md § Documentation Standards, and the move does not even achieve the goal: `testMatch` is repo-wide, so `docs/archive/dead-tests/*.test.ts` would still be collected and still fail, requiring a *permanent extra ignore rule* for strictly less value. Git is the archive — the intent is recoverable at `git show aa2df32b^:__tests__/DeclarativeCompiler-comprehensive.test.ts`.

Two conditions:
- Record the rescue pointer (`aa2df32b`, 2026-02-19) as a one-line entry in [V6_OPEN_ITEMS.md](/docs/v6/V6_OPEN_ITEMS.md), per the CLAUDE.md V6 Work Protocol, so a future V6 dev can find the intent.
- **Also delete the six rotted scripts (SA L-3)**, which import the same deleted modules and are invisible to any gate: `scripts/qa-v6-execution-layer.ts`, `scripts/test-phase4-compilation.ts`, `scripts/test-v6-gmail-complaints.ts`, `scripts/test-v6-gmail-expense-full.ts`, `scripts/test-wave8-full-pipeline.ts`, `scripts/test-wave9-dedup-pattern.ts`.

### A2 — Fix `featureFlags.test.ts` (6 failures)

A stale **test**, not a source bug. The test sets the pre-rename env names; `parseBooleanFlag` reads the `NEXT_PUBLIC_`-prefixed ones. Update the env var names the test sets to match [`featureFlags.ts`](lib/utils/featureFlags.ts). Fallout from PR #78; fits the React-hooks memory entry's open items.

### A3 — Fix or pin `archetypes.test.ts` (1 failure)

`the recipes › gives a trainer a price list` expects a `pricing` section; the recipe now returns `["header","hero","stats","services","testimonials","process","faq","booking_widget","contact_form","cta", …]`. Determine which side is correct — if the recipe intentionally dropped `pricing`, update the assertion; if not, this is a live Business OS bug and the test is doing its job. **Do not silently relax the assertion.**

### A4 — Prove the scope is green **and complete**

`npx jest --selectProjects gate --ci` must exit 0 before Wave B is committed.

Exit code alone is **not sufficient** (SA H-4). A typo'd ignore pattern, a narrowed `testMatch`, or an accidentally `describe.skip`ped suite leaves the job **green with fewer tests** — the characteristic failure of this exact change class, and not hypothetical: SA's probe of A0 silently dropped 7 suites, including `scripts/__preview__/render.test.ts`, which is not dead.

So A4 also ships a **committed count guard**, not a one-time manual count.

> **Superseded 2026-10-02:** the figures in the table below are from `d00006ac`. Slice 1's guard is `.github/ci/jest-gate-check.mjs` (§0.6). Its partition check is exact and its count is a floor. The planning figures are **721 suites / ≈13,190 tests**, with the final values pinned from the first Linux run.

| Assertion | Value |
|---|---|
| `gate` executes | **377 suites / 5,792 tests** (369 run + 8 `describeIfCredentials` skips). A1 does not change this — the 8 dead files are already excluded by path. |
| `gate` + `agents` | **377 + 11 = 388**, the single-config total post-A1 (396 − 8 deleted) |
| Quarantine baseline size | **11**, and the guard fails if it grows |

Making it a `*.guard.test.ts` is what keeps it holding. Note the standing hazard it defends against: **once the gate is required, deleting a test becomes the cheapest way to go green, and nothing else in CI notices a shrinking suite.**

---

## 6. Wave B — Put tests in CI

### B1 — `.github/workflows/tests.yml`

A separate workflow, for the reasons CI_BUILD_GATE_WORKPLAN.md sets out: independent required-check name, independent concurrency group, independent cancel/rerun.

| Property | Value | Rationale |
|---|---|---|
| Job name | `Gate tests (jest)` | This is the string a branch-protection rule matches. Renaming it silently un-gates the repo. |
| Triggers | `pull_request: [main]`, `push: [main]`, `workflow_dispatch` | Same as the other guards. |
| `paths:` filter | **None** | Same argument as `admin-authz-guard.yml`: a test-affecting change can appear anywhere, so a filtered workflow is defeated by the change it guards. Keep the job reporting on every PR so it stays requireable. |
| Scope-skip step | `.github/ci/non-deploying-change.sh` | **SA M-7.** Both existing guards run on every PR *and* skip the expensive step when every changed file is docs/scripts/`.claude`, while still reporting a conclusion. This is the house convention, it keeps the check requireable, and it is the only cost lever that still works once the repo goes private. |
| Node | `node-version-file: '.nvmrc'` (= 22) | D-1 of the build workplan. **Do not** copy the `NODE_VERSION: '18'` still in `plugin-tests.yml` — that is known drift. |
| Command | `npx jest --selectProjects gate --ci` | **No `--shard` matrix (SA H-2).** A matrix job reports as `Gate tests (jest) (1)` / `(2)`; the un-suffixed name never appears, so the check **cannot be made required** — which would defeat the entire point of Wave B. Sharding also buys nothing here: two shard jobs each pay a full `npm ci`, and the run already fits inside the 497s build. If sharding is ever needed, add an aggregator job (`needs: [shards]`, `if: always()`) and require *that* name. |
| Env | **None** | [`tests/plugins/jest-setup.ts`](tests/plugins/jest-setup.ts) is already wired as `setupFiles` and self-stubs all five module-load-critical vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) behind `\|\|` fallbacks. Unlike `build.yml`, this job needs **no `env:` block at all**. It must reference `secrets.` zero times. |

### B2 — `npm run test:changed`

Add to `package.json`:

```json
"test:changed": "jest --onlyChanged",
"test:qa": "jest --changedSince=origin/main --ci",
"test:gate": "jest --selectProjects gate --ci",
"test:agents": "jest --selectProjects agents --ci"
```

**Two commands, not one — and this distinction is load-bearing (SA H-3).**

`jest --onlyChanged` compares against the **last commit**. Measured on a clean tree it prints *"No tests found related to files changed since last commit"* and **exits 0**. The Developer agent commits before handing off, so a QA scope wired to `--onlyChanged` would routinely pass **having executed nothing** — strictly worse than today's noisy `full`, because it looks green.

- `test:changed` (`--onlyChanged`) — **local Tier-0 loop only**, for the Dev with a dirty tree. Never a QA or CI scope.
- `test:qa` (`--changedSince=origin/main`) — the QA-facing command. Compares against the merge base, so it still finds work after a commit.

### B3 — Report required-check status to the user

The workflow gates nothing until `Gate tests (jest)` is a **required status check** on `main`. That is a GitHub admin action. Per the `admin-authz-guard.yml` header and the outstanding memory item: a red check is not a block — **prove it** with a throwaway PR that a merge is *blocked*, not merely red.

Note also that `required_pull_request_reviews` is `null` and `strict` is `false`, so today a direct push to `main` skips all of this. Requiring a PR is the same admin's action and belongs in the same sitting.

---

## 7. Wave C — Nightly quarantine and the QA agent

> The Jest `projects` split moved to **A0** (SA H-1). Wave C is now the nightly job and the QA agent contract.

### C1 — Nightly full-suite job (quarantine included)

Extend `plugin-tests.yml`'s existing `schedule: '0 3 * * *'`, or add a job to `tests.yml` under the same cron, running the **whole** suite with the quarantine list **not** applied. Non-blocking by construction: schedule and `workflow_dispatch` only, never `pull_request`.

**A red-on-arrival nightly is the failure mode `react-hooks-guard.yml` warns about, moved to a schedule (SA M-6).** It starts with 11 failing suites and no owner, so it is unreadable from day one and will be ignored within a week. *"Preserved"* and *"ignored"* must not be the same state. Two requirements:

1. The job's summary reports **only the delta against the quarantine baseline** — new failures, and baseline entries that now pass. A steady-state run is green with "11 known, 0 new".
2. Record the quarantine in [V6_OPEN_ITEMS.md](/docs/v6/V6_OPEN_ITEMS.md) with a named owner and a review date, so resuming V6 starts with "un-quarantine" as a known task rather than a discovery.

### C2 — Rewrite the QA agent's execution contract

In [`quality-assurance.md`](.claude/agents/quality-assurance.md):

| Change | Detail |
|---|---|
| Add a **Commands** table | Map each scope keyword to a literal command: `smoke` → `npm run test:qa` **+** `npm run test:gate`; `regression` → `npm run test:gate`; `full` → `npm run test:gate` + the 4 guard suites + the scoped typechecks. No more re-derivation. |
| Change the default scope | `full` → **`smoke`** for routine Business OS work, subject to the carve-out below. |
| Add a known-failures note | State that the quarantined suites are **not** this cycle's defects, and name the baseline file — the single largest source of wasted QA turns. |
| Remove Playwright | Strike the `e2e` / Playwright rows here and in the other 4 agent definitions. Replace with a pointer to CLAUDE.md § Testing (manual QA of critical paths; source-level Jest guards where they fit). |

**Q-2 answered — confirmed, extended, and constrained.** The carve-out that keeps `full` is: **(1)** security / authz, **(2)** payments, **(3)** migrations, **(4)** anything under `lib/repositories/` or any new `supabaseServer` path (the `tenant-isolation-guard` class — `user_id` scoping), **(5)** plugin executors and internal plugin ops (cross-tenant writes), **(6)** `lib/business-os/llm/**` (attribution and cost correctness).

Two conditions matter more than the list itself:

- **Scope changes test _depth_, not test _existence_.** `npm run test:gate` and the guard suites run in **every** scope, including `smoke`. What `smoke` drops is exploratory and edge-case work, never the gate.
- **`smoke` must never be `--onlyChanged`** (H-3), or the carve-out list becomes the only thing actually being tested.

---

## 8. Options measured and rejected

Recorded so they are not re-proposed.

| Option | Verdict | Evidence |
|---|---|---|
| `ts-jest` `isolatedModules: true` | **Do not adopt — but see the caveat** | BOS scope, both caches warm: **58.7s with** vs **27.6s without**. Single suite: 9.0s vs 5.6s. ⚠️ **The result is real; the original explanation was wrong (SA Q-4/L-4).** In `ts-jest@29.4.5` the *option* is deprecated and redirects to the **tsconfig** flag, where it is a TypeScript *constraint check that adds work* — not a switch that skips type-checking. So this measured a deprecation path, **not transpile-only**, and it must never be cited as evidence against transpile-only transforms in general. |
| Repo-wide `tsc --noEmit` gate | **Rejected** | **2,035 errors**, 637s, OOMs at the 4 GB default heap. Red on arrival → disabled within a week. Same trap `react-hooks-guard.yml` documents for blanket `npm run lint` (163 errors, ~8.9k warnings). |
| Repo-wide `eslint` gate | **Rejected** | Same reason; already reasoned through in `react-hooks-guard.yml`. The rule-scoped guard is the right pattern. |
| Moving `next build` off the PR path | **Not pursued** | Contradicts a deliberate, QA-passed decision. Workflows run in parallel, so it is not on the critical path *for us*. Revisit only if the repo goes private. |
| Deleting the agent-side suites | **Rejected** | 1,120 tests encode V6 behaviour learned from 38 documented weak points. |
| Directory-based quarantine | **Rejected in favour of health-based** | Fails in both directions (`tests/v6-regression/` leaks in, `scripts/__preview__/render.test.ts` leaks out), and would re-create the rot this workplan exists to end. Measured cost of the better option: **+2.3s for +853 tests** — inside run-to-run noise. See [§4](#4-the-tiering-model). |
| `@swc/jest` | **Dropped from this workplan → backlog** | The gate is ~2 min; **runtime is not the problem this workplan solves**, so a transform swap is scope creep. It will be forced on its own schedule anyway: ts-jest removes the `isolatedModules` option in v30, and Jest 30 is already the installed major. If it is ever spiked, the acceptance bar is `--listTests` count **and** executed-test count identical before/after (H-4 again), with `jsx: react-jsx`, the `moduleNameMapper` stubs, and `const enum`/decorator handling explicitly checked. |

---

## 9. Test plan

> **Superseded for Slice 1 by [§0.8](#08-test-plan--proving-green-and-complete-before-handover).** The counts below (377 / 5,792 / 388) are from `d00006ac`.

Per CLAUDE.md, a workplan's own changes need a QA report. This workplan is mostly CI and config, so the proof is execution, not assertions.

Per CLAUDE.md, a workplan's own changes need a QA report. The proof for a CI/config change is execution, not assertions — **and, per SA H-4, counts rather than exit codes.** Checks 1 and 6 are the ones that matter most; everything else can pass while the gate quietly tests nothing.

| # | Check | Method | Pass criterion |
|---|---|---|---|
| 1 | **Gate executes the expected volume** | `npm run test:gate` | **377 suites / 5,792 tests**, exit 0, 0 failing suites. Counts asserted, not eyeballed. |
| 2 | **No suite falls out of both projects** | `gate` count + `agents` count | **377 + 11 = 388**, the single-config total post-A1 |
| 3 | Deleting A1's files removes no live coverage | `grep` each deleted suite's imports against the tree | every import resolves to a non-existent path |
| 4 | A2 fixes the test, not the flag semantics | `featureFlags.ts` unchanged in the diff | source file untouched |
| 5 | A failing test actually fails the job | Deliberate-break test — break one gate assertion, push | job exits 1; no `continue-on-error`, no `\|\|`, no `set +e` |
| 6 | **The reported check name is exactly what B3 asks to require** | After the first run, read the check name GitHub offers in branch protection | character-identical to `Gate tests (jest)`. This is precisely the H-2 failure mode. |
| 7 | The job holds no secrets | `grep -n "secrets\." .github/workflows/tests.yml` | no match; `permissions: contents: read` |
| 8 | `npm test` still means "everything" | `npx jest --listTests \| wc -l` before/after A0 | 396 − 8 deleted = **388** |
| 9 | Quarantine cannot gate a PR | Inspect the nightly job's triggers | `schedule` / `workflow_dispatch` only; no `pull_request` |
| 10 | The quarantine list is a ratchet | Add a bogus entry | count guard fails |
| 11 | `.claude/worktrees/` stays excluded in both projects | `--listTests \| grep -c '\.claude'` | **0** (1,297 files live there) |
| 12 | Wall-clock claim holds | Compare `tests.yml` and `build.yml` durations on the same PR | tests job finishes before the build job |

**Not covered:** E2E (not set up). No GitHub Actions run can exist until the workflow is committed, so all pre-merge evidence is local — the same constraint CI_BUILD_GATE_WORKPLAN.md recorded. Checks 6 and 12 are therefore **post-merge** verifications.

---

## 10. Task list

Order corrected per H-1: **A0 → A1–A4 → B → C.**

### Slice 1 (2026-10-02, `chore/ci-jest-gate` @ `894150f5`) — the active task list

| ID | Task | Owner | Status |
|----|------|-------|--------|
| — | Refresh the workplan against `894150f5`: per-suite dispositions, mechanism, guard, workflow, runtime budget (§0) | Dev | ✅ |
| — | SA review of §0, ruling on SA-Q1..Q6 | SA | ✅ Approved with conditions SC-1..SC-10 |
| S1-1 | Delete the 8 dead suites + root `__tests__/`, and (SC-7) `lib/website-builder/selectTemplate.ts` + its test | Dev | ✅ |
| S1-2 | Fix the 9 tests in §0.4 (rows 20–25, 27–29). Bisect row 25 first. | Dev | ✅ Bisect: `b6efd992` (#151). See the record below. |
| S1-3 | `.github/ci/jest-quarantine.json`: 11 entries with reasons | Dev | ✅ |
| S1-4 | `jest.gate.config.js` | Dev | ✅ |
| S1-5 | `.github/ci/jest-gate-check.mjs`: G1–G7 + step summary, G3 bootstrap (SC-6) | Dev | ✅ |
| S1-6 | `.github/workflows/tests.yml`: 3 shards → `Gate tests (jest)` verdict job, scope step in every job (SC-2, SC-3, SC-5) | Dev | ✅ |
| S1-7 | `test:gate` npm script (used by the workflow; no `-u`, SC-10) | Dev | ✅ |
| S1-8 | Local proof T1–T8 + the guard's red paths ✅. PR proof T9–T13 and SC-1's budget ⬜ (only possible on the PR). Pin the G7 floors from the first Linux run ⬜. | Dev | 🟡 |
| — | SA code review → QA → user sees the diff → RM | SA / QA / User / RM | 🟡 SA: Fix Required → CR-1 ✅ (file-level timeout on `InviteFriendsSection.render`), CR-2 ✅ (`overwrite: true` on the upload step). QA / user / RM ⬜ |
| — | User: require `Gate tests (jest)`; prove it blocks with a throwaway PR | User | ⬜ |

#### Slice 1 implementation record (Dev, 2026-10-02)

Everything is uncommitted on `chore/ci-jest-gate` @ `894150f5`. The only product-code change is SA's one named exception, the `selectTemplate.ts` deletion (SC-7).

**Files**

| File | Change |
|---|---|
| 8 dead suites (§0.4 rows 1–8), root `__tests__/` | deleted |
| `lib/website-builder/selectTemplate.ts` + `__tests__/selectTemplate.test.ts` | deleted (SC-7). 0 importers re-checked with `git grep`. |
| `lib/utils/__tests__/featureFlags.test.ts` | env name → `NEXT_PUBLIC_USE_THREAD_BASED_AGENT_CREATION` (row 20) |
| `lib/website-builder/__tests__/archetypes.test.ts` | trainer has `services` and no `pricing`; `landing` keeps `pricing` (row 21) |
| `lib/business-os/usage/__tests__/tokenUsageRepository.contract.test.ts` | arity pin `summariseFeatureAllAccountsInWindow: 2` + one `@ts-expect-error` line (row 22) |
| `lib/business-os/catalog/__tests__/proposals-capability.test.ts` | `'stopped'` added (row 23) |
| `lib/business-os/credits/__tests__/creditPeriod.test.ts` | `codeOf` normalises CRLF to LF (row 24). A no-op on Linux, but needed for the Windows proof. |
| `lib/business-os/llm/__tests__/__snapshots__/callParams.boundary.step3.test.ts.snap` | one entry re-recorded (row 25), 1 line changed |
| `app/api/cron/__tests__/runRecord.adoption.test.ts` | mock gains `billDueDatedStages` (row 27) |
| `app/api/business-os/chat-v4/__tests__/route.audit.test.ts` | `supabaseServer` mock gains `from → select → eq → maybeSingle` (row 28) |
| `app/admin/business-os-invites/__tests__/page.render.test.tsx` | file-level `jest.setTimeout(30_000)` with a comment (row 29) |
| `.github/ci/jest-quarantine.json` | new: 11 entries (rows 9–19), floors `minSuites` 721 / `minTests` 13,187 |
| `jest.gate.config.js` | new: spreads `jest.config.js` (untouched) |
| `.github/ci/jest-gate-check.mjs` | new: G1–G7, step summary |
| `.github/ci/jest-gate-scope.sh` | new: the shared rule + SC-5's `scripts/` condition, called by every job |
| `.github/workflows/tests.yml` | new |
| `package.json` | `test:gate` = `jest --config jest.gate.config.js --ci` |

**Row 25 bisect (T4).** `git bisect run` on `-t "chat/planner"` over `a5764a26..894150f5` (284 commits, 8 steps). **First bad commit: `b6efd992`, #151** ("cancellation reasons, delivery facts, and a batch of correctness fixes"). The cause is #151's edit to `lib/business-os/catalog/catalog.ts`: `proposals.status` gained `stopped` and its label, and `email_sends` swapped the structurally-null `opened_at` / `open_count` / `click_count` for `delivered_at`, with a comment explaining why. Both are deliberate and documented in the code. Confirmed directly: `catalog.ts` has not changed since #151, and swapping in only its pre-#151 version on `894150f5` restores the recorded hash. Only the planner entry was re-recorded (`len 31356` → `31366`); the step-3 file's other 2 snapshots were unchanged.

**SC-8.** `npm run typecheck:bos-llm`: 362 files, 28 errors, **0 new**, passed (543s). The new `@ts-expect-error` therefore fires; an unused one would surface as a new TS2578. Also reported: one baseline entry is now fixed (`app/api/onboarding/build/route.ts` TS18047). That predates this slice, and the baseline was not touched.

**Local proof** (Windows, 8 cores; the box was shared with other sessions, and CPU sat at 100% for the first run):

| # | Result |
|---|---|
| T1 | `--list-only`: **743 = 721 gate + 11 quarantined + 11 integration**, G2–G4 pass, G3 = bootstrap |
| T2 | `npx jest -c jest.gate.config.js --ci --maxWorkers=4`: **exit 0, 721/721 suites, 13,192 tests (13,158 pass, 34 skipped), 0 runtime errors**, 313s. The guard over it is green. |
| T2 (first attempt) | Under the 100% CPU contention (1,623s, about 5× SA's run), 3 jsdom render suites that are **not** in §0.4 hit Jest's 5s default: `InviteFriendsSection.render`, `audit-trail/searchTotals.render`, `analytics/linkedWindow.render`. All three pass alone and in every later run. Not changed (outside the approved dispositions); flagged to TL. |
| 3 shards | `npm run test:gate -- --maxWorkers=4 --shard=n/3`: **241 + 240 + 240 = 721, all exit 0** (131s / 266s / 160s). The guard over the 3 merged result files is **green** (G1–G7). |
| T3 | `git diff --name-only`: only test files, the snapshot, `package.json` and the deletions. `featureFlags.ts`, `recipes.ts`, `TokenUsageRepository.ts`, `catalog.ts`, `creditPeriod.ts`, the payment-reminders route and the chat-v4 route are unchanged. |
| T5 + red paths | Scratch copies only. The guard exits 1 on each of: a missing shard file (G5 + G7); no result files; a **quarantine addition** against a base that has the file (G3); a suite dropped from the gate list and results (G1); a listed suite never executed (G5); a runtime-error suite (G5); shards disagreeing on N (G5); an unresolvable base (G3, fail closed); a breached test floor (G7). Both green controls (bootstrap, and a ratchet against a real base) exit 0. |
| T7 | `page.render` (row 29) passed in all 3 gate runs: the contended run, the shards, and run 2 (34.9s). |
| T8 | `npx jest --listTests`: **743** (752 − 8 − `selectTemplate`) |
| Full suite | `npx jest --ci`: 743 suites. **The 11 failures are exactly the 11 quarantined suites**, with 122 failed tests (= the sum in their reasons). 8 skipped suites are the credential-gated integration ones; 0 runtime errors. |
| T11 / SC-10 | `grep -nE 'secrets\.\|updateSnapshot\|(^\|[[:space:]])-u([[:space:]]\|$)'` over `tests.yml`: no match. `test:gate` has no `-u`. |
| Scope rule | In a scratch repo: `docs/`, root `README.md`, `scripts/*.md` and `.claude/` → skip. `scripts/bos-llm-settings.ts`, `scripts/test-dsl-execution-simulator/variable-store.ts`, `lib/` and a nested `lib/**/prompts/*.md` → run. An unresolvable base → run. |
| ESLint | New files clean. `featureFlags.test.ts` carries 45 pre-existing `no-require-imports` findings (its `require('../featureFlags')` after `jest.resetModules()`); the count is identical before and after this change. |

**Still pending, and only possible on the PR:** T9 (Linux parity, then pin G7's floors from the first Linux run), T10 / SC-1 (the verdict job completes before Build, ≤ 85% of Build's wall-clock, under 150s), T12, T12b, T13.

**Deviations from §0, for SA's code review**

1. **The scope rule is a script, `.github/ci/jest-gate-scope.sh`, not inline YAML.** The shards and the verdict job must reach the same answer (SC-3). One script called from both makes that true by construction, where two inline copies could drift. It wraps `non-deploying-change.sh` (untouched) and adds SC-5's condition. It lives in `.github/`, so it is never skippable.
2. **N is carried in the result file names** (`gate-results-<n>-of-<N>.json`, where `<N>` = `strategy.job-total`). The matrix `[1, 2, 3]` is the only place N is written; the guard reads N from the names and requires every index 1..N. A separate config job would have added the serial hop SA removed.
3. **The guard also requires 0 failed suites and 0 failed tests in G5**, as well as `success` on the shards. This is belt and braces if a shard's exit code is ever lost.
4. **`--quarantine <file>` option on the guard,** used only to prove the red paths against scratch copies. CI never passes it.
5. **G6 reads `numPendingTestSuites`, as SA measured it (0).** Note: the 34 skipped tests come from 2 **mixed** files, not whole-file skips: `catalog/enum-drift.test.ts` and `consent/marketingGate.test.ts` each have a passing `describe` plus an env-gated `describe.skip` (live database / `MARKETING_SENDING_ENABLED`). Jest reports such a file as `focused`. A genuinely whole-file skip increments `numPendingTestSuites`, so G6 still catches it. Accepted with no code change (SA ruling 4b).
6. **Row 20 provenance:** the test has used the unprefixed name since it was created in `89722cdd`, while `featureFlags.ts` has always read `NEXT_PUBLIC_…`. So it was never green, rather than broken by PR #78. The source side is still the correct one.

### Original task list (2026-09-21) — status as of the Slice 1 refresh

| ID | Task | Owner | Status |
|----|------|-------|--------|
| — | Measure the baseline | Dev | ✅ |
| — | Reconcile with the prior build-gate decision | Dev | ✅ |
| — | SA review of this workplan | SA | ✅ Revision Required → folded in |
| — | Fold in SA findings H-1..H-4, M-1..M-8, L-1..L-6 | Dev | ✅ |
| **A0** | **Jest `projects` split + quarantine baseline file** (4 conditions in §5) | Dev | ↪ superseded by S1-3/S1-4 (gate config, pending SA) |
| A1 | Delete 8 dead suites + root `__tests__/` + 6 rotted `scripts/*.ts`; add the `aa2df32b` pointer to `V6_OPEN_ITEMS.md` | Dev | ↪ suites → S1-1; scripts + pointer **deferred** (§0.2) |
| A2 | Fix `featureFlags.test.ts` env names | Dev | ↪ S1-2 (row 20) |
| A3 | Resolve `archetypes.test.ts` — recipe or assertion | Dev | ↪ S1-2 (row 21; resolved: the assertion is stale) |
| A4 | Count guard (`*.guard.test.ts`) + prove gate green **and complete** | Dev | ↪ S1-5 (CI script, floor + exact partition, pending SA-Q4) |
| B1 | Add `.github/workflows/tests.yml` — no shard matrix, with the `non-deploying-change.sh` skip step | Dev | ↪ S1-6 (**now sharded with an aggregator**, §0.7.1) |
| B2 | Add `test:changed` / `test:qa` / `test:gate` / `test:agents` scripts | Dev | ↪ `test:gate` only (S1-7); the rest **deferred** |
| B3 | Report required-check + require-PR actions to the user | Dev | ↪ §0.8 "After merge" |
| C1 | Nightly full-suite job reporting **delta vs baseline**; owner + review date in `V6_OPEN_ITEMS.md` | Dev | ⬜ deferred |
| C2 | QA agent commands, `smoke` default + 6-item carve-out, Playwright removal (5 files) | Dev | ⬜ deferred |
| L-6 | Comment in `jest.config.js` that `testMatch` treats every `.ts` under `__tests__/` as a suite (latent: 0 today) | Dev | ⬜ deferred |
| — | QA per §9 | QA | ⬜ |
| — | User approval → RM commit | User / RM | ⬜ |

**User-owned (cannot be done in a PR):**

1. Make `Gate tests (jest)` a required status check on `main`.
2. Enable *Require a pull request before merging* — today a direct push bypasses every gate.
3. Prove #1 with a throwaway PR that is **blocked**, not merely red. (Still outstanding for `Admin authz surface guard` too.)

---

## 11. SA review

**Reviewed by SA — 2026-09-21**
**Status:** 🔄 **Revision Required** — the reframing and the three-wave direction are approved; findings H-1..H-4 are defects *in the plan* and must be folded in before any code is written. No re-review needed once they are: this is an approve-with-conditions.

**The reframing is sound and independently verified.** The premise "tests are slow" does not survive measurement, and the workplan is right that the cheap, high-value change is running tests at all. The gate/quarantine *direction* is correct. What needs work is the mechanics: as written, Wave B cannot run, the job cannot be made a required check, the new QA default passes without executing anything, and §9 cannot detect the one failure mode this class of change actually produces.

### Verification performed

Re-measured on `main` @ `9aeeb50e` (same machine, 8 cores, Node v22.19.0), not taken on faith:

| Claim | Result |
|---|---|
| Full suite 380 suites / 5,714 tests / 21 failing suites / 129 failing tests | ✅ **exact** — re-run gave 380 / 5,714 / 21 / 129, 128s WALL, 702s CPU (719s in §1 is run variance) |
| Failure split 19 agents / 1 BOS / 1 shared | ✅ **exact** — the 2 non-agent failures are `archetypes.test.ts` and `featureFlags.test.ts` |
| Gate scope = 4,593 tests, 2 failing suites / 7 tests | ✅ **exact** — but the **suite count is 288, not 280** (see M-1) |
| 8 suites import modules deleted at `aa2df32b`, 2026-02-19 | ✅ — `DeclarativeCompiler.ts`, `IRToDSLCompiler.ts` and `EnhancedPromptToIRGenerator_DEPRECATED.ts` all deleted in that one commit on that date; **nothing live imports them** (the two `lib/` hits are comments) |
| `jest-setup.ts` self-stubs all five vars behind `\|\|`; no `env:` block needed | ✅ — read and confirmed. Also confirmed empirically: no gate-scope suite makes a live call, or it would fail against the stub keys |
| Branch protection: only `Admin authz surface guard`, `strict: false`, `reviews: null`; repo `PUBLIC` | ✅ — re-read live via `gh api` |
| A2/A3 diagnoses | ✅ — test sets `USE_THREAD_BASED_AGENT_CREATION`, source reads `NEXT_PUBLIC_USE_THREAD_BASED_AGENT_CREATION`; `archetypes` expects `pricing`, recipe returns a list without it |
| `next build` 497s · `tsc` 2,035 errors / 637s / OOM at 4 GB | **Not re-run** (too expensive). Plausible: `scripts/typecheck-bos-llm.ts`'s header independently cites ~2,000 pre-existing errors |
| `isolatedModules` 58.7s vs 27.6s | **Not re-run.** Conclusion stands, reasoning does not — see Q-4 |

### Findings

| # | Sev | Where | Finding |
|---|---|---|---|
| **H-1** | **High** | §5 A4, §6 B1/B2, §10 | **Wave B cannot run: it depends on Wave C.** A4 requires `npx jest --selectProjects gate`, B1's command is `--selectProjects gate`, B2's scripts are `--selectProjects gate`/`agents` — but the `projects` split is **C1**, two waves later. The dependency order is inverted. **Fix: promote C1 to Wave A as A0.** Then A→B→C is genuinely sequential and each wave lands independently. |
| **H-2** | **High** | §6 B1 | **The shard matrix destroys the required-check name.** B1 correctly says `Gate tests (jest)` "is the string a branch-protection rule matches", then specifies `--shard=${{matrix.shard}}/2`. A matrix job reports as `Gate tests (jest) (1)` / `(2)` — the un-suffixed name never appears, so the check cannot be required, defeating the entire point of Wave B. **Drop the matrix.** Sharding buys nothing here: two shard jobs each pay a full `npm ci`, and the 97s run already fits inside the 497s build. If sharding is ever needed, add an aggregator job (`needs: [shards]`, `if: always()`) and require *that* name. |
| **H-3** | **High** | §6 B2, §7 C3 | **`smoke` → `test:changed` is a vacuous green.** Measured: on a clean tree, `npx jest --onlyChanged --ci` prints *"No tests found related to files changed since last commit"* and **exits 0**. QA runs *after* Dev has committed, so the new default QA scope will routinely pass without executing a single test — strictly worse than today's noisy `full`. **Fix: `--changedSince=origin/main --ci`** for the QA-facing script (keep `--onlyChanged` only as the Dev's local Tier-0 loop), and run the guard suites unconditionally in every scope (see Q-2). |
| **H-4** | **High** | §9 | **The test plan cannot detect partial scope collapse.** Every check is exit-code based. A typo'd ignore pattern, a narrowed `testMatch`, or an accidentally `describe.skip`ped suite leaves the job **green with fewer tests** — the characteristic failure of this exact change class. This is not hypothetical: an SA probe implementation of C1 (inline `projects`, shared config, per-project `testMatch`) **silently dropped 7 suites** — the 6 dead root suites plus `scripts/__preview__/render.test.ts`, which is *not* dead. **Fix: assert executed counts, not exit codes** — gate must report **288 suites / 4,593 tests**, and `gate + agents` must equal the single-config total. Make it a `*.guard.test.ts` so it keeps holding, not a one-time manual count. |
| **M-1** | Medium | §1, §4, §9 #6 | **Gate scope is 288 suites, not 280.** Re-derived from the §4 exclusion list and confirmed against a live `projects` probe. The *test* count (4,593), the failure count (2 suites / 7 tests) and the CPU share all reconcile exactly with the 288-suite set — so the **scope definition is right and only the suite figure is wrong**. Correct §1, §4 and §9 check 6. (Deleting A1's 8 suites does not change it: all 8 are agent-side. 380→372 total, 92→84 agents, gate stays 288.) |
| **M-2** | Medium | §4 | **`tests/v6-regression/` leaks into the gate.** `tests/v6-regression/scenarios/gmail-scatter-attachment-extract/coverage-routing.test.ts` imports `@/lib/agentkit/v6/capability-binding/CapabilityBinderV2` and `IntentToIRConverter` directly. It is agent-side V6 by content, but the exclusion list is by directory and misses it — so V6 work will be able to redden a *required* gate, or (worse) the test gets deleted to go green. |
| **M-3** | Medium | §4 | **`scripts/__preview__/render.test.ts` is misclassified the other way.** It is a Business-OS website-preview HTML generator (`components/public/compositions`, `lib/website-builder/archetypes`), explicitly "not a test of behaviour", and it writes to a hardcoded `/tmp/apc-preview`. The blanket `scripts/` exclusion quarantines it to a nightly job where it will write files on the runner for no reason. Directory is the wrong classifier for this file; exclude it from both projects or move it out of `testMatch`. |
| **M-4** | Medium | §4, §7 | **Prefer quarantine by *health*, not by directory.** The split excludes 35% of CPU and 1,120 tests to avoid **19 red suites**, and the measured saving is **31 seconds** (128s full vs 97s gate, same run conditions). That is a health problem wearing a scope problem's clothes. The house pattern for exactly this already exists — `scripts/typecheck-bos-llm.baseline.json`: a committed list of known-bad items, gate everything else, and the list only ever shrinks. Applying it here (ignore the ~19 named failing suites, gate the rest) removes M-2, M-3 and the V6 trap in one move, costs ~30s, and keeps 1,120 agent tests as a real gate. **Recommended shape.** The directory split is an acceptable fallback *only* with a named owner and a review date (see M-6). |
| **M-5** | Medium | §4, §6 | **Tier-1's "≤2 min" and "2 shards ≈ 50s each" are dev-box, warm-cache numbers.** Gate CPU is **478s**. A GitHub 4-core runner gives Jest `maxWorkers = 3` → ~160s of execution, plus `npm ci`, plus a **cold ts-jest cache** (§1's own "trivial 11-test suite, cold = 5.5s" is the tell). Realistic CI cost is 4–6 min, not 2. The *conclusion* survives — it still finishes inside the 497s build, so Tier 1 remains free in wall-clock — but restate the target, and consider caching the ts-jest cache dir keyed on `package-lock.json` **only** (the D-2 lesson from CI_BUILD_GATE_WORKPLAN.md: never key a cache on source). |
| **M-6** | Medium | §7 C2 | **A red-on-arrival nightly is the failure mode `react-hooks-guard.yml` warns about, moved to a schedule.** The `agents` job starts with 13 failing suites and no owner, so it is unreadable from day one and will be ignored within a week — the same dynamic as a blanket lint gate, minus even the social pressure of a red PR. Quarantine needs either a green-on-arrival baseline (M-4) or an explicit owner + expiry date recorded in `V6_OPEN_ITEMS.md`. "Preserved" and "ignored" must not be the same state. |
| **M-7** | Medium | §6 B1 | **No `non-deploying-change.sh` scope step.** Both existing guards run on every PR (no `paths:` filter — correctly copied here) *and* skip the expensive step when every changed file is docs/scripts/`.claude`, while still reporting a conclusion. `tests.yml` should do the same: it is the house convention, it keeps the check requireable, and it is the only cost lever that still works once the repo goes private. |
| **M-8** | Medium | §4 | **`tests/plugins/integration-tests/**` (9 suites) is inside `gate`, contradicting §4's own Tier 3** ("plugin integration tests (real tokens)" → nightly). Today they are inert (`describeIfCredentials` skips without `*_TEST_TOKEN`), so the gate is green — but the moment anyone adds those secrets to this job, every PR hits live Google/Slack/Notion APIs. Exclude them explicitly from `gate`; `plugin-tests.yml` already runs them nightly. |
| **L-1** | Low | §1 | **"Jest invocations in `.github/workflows/`: zero" is wrong.** `admin-authz-guard.yml` runs `npm run test:authz-guard` (a Jest invocation) on **every PR**, and `plugin-tests.yml` runs four Jest scripts. The accurate claim is *"no workflow runs the full suite; only `tests/plugins/` and one guard suite ever execute in CI."* Correcting this **strengthens** D-1: the Plugins bucket is the only bucket that runs in CI, and it is the only bucket with **zero** failing suites. That correlation is the best single piece of evidence in the document — use it. |
| **L-2** | Low | §2 D-4 | **"The 13 `*.guard.test.ts` static scans" — measured 4**: `admin-authz-surface`, `no-deletion-paths`, `dead-plugin-routes-removed`, `system-initializer-removed` (6 if the differently-named `semanticGate.coverageGuard` and `param-constraint-guard` count). The guard surface is thinner than the document assumes; the "security class is covered" claim should be softened accordingly. |
| **L-3** | Low | §5 A1 | **Six `scripts/*.ts` import the same deleted modules** and are not mentioned: `qa-v6-execution-layer.ts`, `test-phase4-compilation.ts`, `test-v6-gmail-complaints.ts`, `test-v6-gmail-expense-full.ts`, `test-wave8-full-pipeline.ts`, `test-wave9-dedup-pattern.ts`. Same rot, same commit, and `scripts/` is excluded from the gate so nothing will ever catch them. Delete in the same change or record them. |
| **L-4** | Low | §8 | The `isolatedModules` row's verdict is safe but its stated reason is not (see Q-4). Relabel so it is not cited later as evidence against transpile-only in general. |
| **L-5** | Low | — | `scripts/typecheck-bos-llm.ts`'s header asserts *"Jest runs transpile-only (`isolatedModules`)"* — **not true** of the current `jest.config.js` (full per-file type-check, which is exactly why a trivial suite costs 5.5s cold). That false belief is probably why §8's result reads as counterintuitive. Correct the header while in the area. |
| **L-6** | Low | §7 C1 | `testMatch`'s `**/__tests__/**/*.ts?(x)` treats **every** `.ts` file inside a `__tests__` directory as a suite. Verified **zero** such non-test files today, so this is latent — but once the gate is required, adding a fixture or helper under `__tests__/` turns it red with *"must contain at least one test"*. Worth a comment in `jest.config.js`; narrowing the pattern is a separate, measured change (it can silently drop suites — see H-4). |

### Answers to the open questions

**Q-1 — Delete, do not archive.** Two reasons. (a) `docs/archive/` is for *documents*; CLAUDE.md § Documentation Standards defines it that way, and 8 `.ts` files do not belong there. (b) More concretely, the move **does not achieve the stated goal**: `testMatch` is repo-wide, so `docs/archive/dead-tests/*.test.ts` is still collected and still fails — archiving therefore requires a permanent new ignore rule as well, i.e. strictly more machinery for strictly less. Git already is the archive: the intent is recoverable at `git show aa2df32b^:__tests__/DeclarativeCompiler-comprehensive.test.ts`. Conditions: record the rescue pointer (`aa2df32b`, 2026-02-19) as a one-liner in `V6_OPEN_ITEMS.md` per the V6 Work Protocol, so a future V6 dev can find the intent, and fold L-3's six scripts into the same change.

**Q-2 — Confirmed, but extend it, and make it about depth only.** Security / payments / migrations is the right core; add **(4)** anything under `lib/repositories/` or any new `supabaseServer` path (user_id scoping — the `tenant-isolation-guard` class), **(5)** plugin executors and internal plugin ops (cross-tenant writes), **(6)** `lib/business-os/llm/**` (attribution and cost correctness). Two conditions that matter more than the list: (a) the scope keyword must change **test depth, not test existence** — `npm run test:gate` and the 4 guard suites run in *every* scope including `smoke`; only exploratory/edge-case work is what `smoke` drops; (b) `smoke` must not be `--onlyChanged` (H-3), or the carve-out list is the only thing being tested at all.

**Q-3 — Exclusion is the right principle, the current list is wrong in both directions.** Exclusion correctly inherits the `admin-authz-guard.yml` reasoning: an include list is defeated by the change it guards, and a new `lib/business-os/` test must not be able to escape by not being on a list. Keep that. But the list as written *under-excludes* (M-2: `tests/v6-regression/` is agent-side and lands in the gate) and *over-excludes* (M-3: a BOS preview generator is quarantined because it lives under `scripts/`) — which is the signal that **directory is a proxy for the real variable, which is health** (M-4). Preferred: gate everything, exclude a committed list of ~19 known-failing suites. If the directory split is kept, fix both directions and add the H-4 count guard, because an exclusion list is only safe when something proves nothing fell out of both sides.

**Q-4 — Keep the spike, but defer it, and relabel the `isolatedModules` rejection.** The rejection is *safe* (do not adopt it) but the stated reason does not support the inference drawn from it. Verified in `node_modules/ts-jest@29.4.5`: the `isolatedModules` **ts-jest option is deprecated** and warns *"Please use `isolatedModules: true` in your tsconfig"* — where it is a TypeScript **constraint check that adds work**, not a switch that removes type-checking. So "transpile-only measured slower" is almost certainly measuring a deprecation path, not transpile-only; the result must not be cited as evidence against `@swc/jest`. That said: the gate is 97s, runtime is not the problem this workplan is solving, and ts-jest removes the option entirely in v30 (already the installed Jest major), so the transform question will be forced on its own schedule. **Verdict: drop it from this workplan; open it as a separate backlog item.** If it is ever spiked, the acceptance bar is `--listTests` count *and* executed-test count identical before/after (H-4 again), with `jsx: react-jsx`, the `moduleNameMapper` stubs, and `const enum`/decorator handling explicitly checked.

**Q-5 — Not a new pattern under Mandatory Rule 7; in bounds.** Rule 7 targets *architectural* patterns (a new data-access path, a new provider, a new tooling class). Jest `projects` is a configuration shape inside a tool already in the stack — the closest precedent is `plugin-tests.yml` already running Jest with a narrowed scope via CLI. Rule 7 is satisfied by this review, which is the review it asks for. Two conditions, both because I broke it in a probe rather than because it is exotic: **(1)** inline project configs do **not** inherit the parent's explicit `rootDir` — a project's `rootDir` resolves from the config file's own location (proved: a parent `rootDir` pointing at the repo, with projects that omit it, failed with *"Preset ts-jest not found relative to rootDir <scratchpad>"*). Set `rootDir` explicitly on **both** projects and keep `<rootDir>/.claude/` in **both** `testPathIgnorePatterns` and `modulePathIgnorePatterns`, with the existing comments intact — there are **1,297** test files under `.claude/worktrees/` today, so a mis-anchored rule inflates the gate from 288 suites to thousands and runs other branches' code. **(2)** Define the `agents` project with `roots:` + the *shared, unmodified* `testMatch`, not with per-project `testMatch` globs — the per-project-glob approach is what silently lost 7 suites in the probe.

### Sequencing and independence

- **Wave order is wrong as written** (H-1). Correct order: **A0 = C1** (projects split) → A1–A4 (green the scope) → B (CI) → C2/C3 (nightly + QA agent).
- After that reorder, each wave lands independently and usefully: A alone deletes dead code and makes the suite honest; B alone adds the check; C3 alone fixes the QA agent (it needs only B2's scripts).
- **B3 is user-owned and off the critical path** — correct, and correctly repeats the `admin-authz-guard.yml` demand to *prove a merge is blocked, not merely red*. That proof is still outstanding for the existing required check; do not let this workplan add a second unproven gate.
- Non-goal deference to `CI_BUILD_GATE_WORKPLAN.md` is **correct**: that decision was QA-passed, its "parallel workflows, free minutes" reasoning is intact, and this plan neither reopens nor contradicts it. The new job reuses its lessons (own workflow, own concurrency group, `.nvmrc` not `NODE_VERSION: '18'`, no `secrets.`, no source-keyed cache) rather than re-deriving them. Adopt M-7 to complete the pattern match.

### Quarantine, and the trap when V6 resumes

Quarantining is the right *instinct* — 1,120 tests encoding 38 documented weak points must not be deleted, and they must not veto Business OS work. But the chosen mechanism creates three traps that M-4 removes at a cost of ~30 seconds: (1) the 19 failures become permanent and invisible, so the nightly is unreadable from day one (M-6); (2) a shared-code change (a repository refactor, a provider-factory change) that breaks agent-side gets no PR signal at all, and the breakage is discovered months later by whoever resumes V6 — the same seven-month rot this workplan exists to end, reintroduced by design; (3) the CLAUDE.md V6 Work Protocol assumes V6 regressions are caught by the suites under `lib/agentkit/`, `lib/pilot/` and `scripts/test-dsl-execution-simulator/` — quarantining all three silently weakens a documented process. If the directory split is kept anyway, record it in `V6_OPEN_ITEMS.md` with an owner, so resuming V6 starts with "un-quarantine" as a known task rather than a discovery.

### §9 test plan

Right instinct — execution, not assertions — and checks 2, 4, 5 and 8 are exactly the right adversarial questions (check 4 in particular mirrors the build gate's deliberate-break test, which is the standard this repo should keep). Gaps:

1. **H-4: no count assertions.** Add gate = 288 suites / 4,593 tests, and `gate + agents == ` the single-config total. Check 7 is the seed of this and is the most valuable check in the table — promote it from a one-time `wc -l` into a committed guard test.
2. **No check on the reported check *name*.** After the first run, confirm the string GitHub offers in branch protection is character-identical to what B3 asks the user to require (H-2 is precisely this failure).
3. **No hermeticity check.** "Exit 0" does not distinguish *ran and passed* from *skipped*. The gate contains 9 `describeIfCredentials` integration suites (M-8); assert skipped-test counts too, and assert the workflow defines no `*_TEST_TOKEN`.
4. **Check 9 measures the wrong thing.** "Tests job finishes before the build job" is trivially true today and stays true after a 3× regression. Assert an absolute budget instead — and set it from a cold 4-core runner, not the dev box (M-5).
5. **No collision check for the nightly job name** (C2 must not reuse `Gate tests (jest)`, or a scheduled non-blocking run will satisfy/contest a required check name).

### Risks the workplan does not name

| Risk | Detail |
|---|---|
| **`.claude/` anchoring under `projects`** | 1,297 test files live in `.claude/worktrees/` today. The comments say the rule is anchored *because* an unanchored `/.claude/` matches every path when Jest runs from inside a worktree. A projects split must repeat the anchored rule in both projects **and** set `rootDir` explicitly — see Q-5(1) for the proof that project `rootDir` does not inherit. |
| **Sharding correctness** | Shard file assignment is a hash of the path, so it is deterministic and total (verified: 190 + 190 = 380), but it is **not duration-balanced**, and an empty shard fails a `--ci` run with no tests found. Moot if H-2 is fixed by dropping the matrix. |
| **Repo going private** | §4's note is correct but incomplete. Once billed: the shard matrix **doubles** the bill for zero wall-clock gain (H-2), the missing `non-deploying-change.sh` skip (M-7) becomes a real cost, and a 128s full-suite gate vs a 97s partial gate is a ~30s difference that is not worth the quarantine's blast radius (M-4). All three arguments point the same way, which is a good sign. |
| **Vacuous-green class generally** | H-3 and gap 3 above are the same bug twice: a command that reports success without doing work. Any command this workplan hands to an agent should be checked against "what does it print when it does nothing?" |
| **The gate makes deleting tests the cheapest way to go green** | Once `Gate tests (jest)` is required, the fastest fix for an inconvenient failure is deletion, and nothing in the plan notices a shrinking suite. The H-4 count guard is the only thing standing between this plan and that outcome — which is why it is High, not Medium. |

### Approval

- [x] Direction and diagnosis approved — the reframing is correct and holds up under re-measurement
- [x] **Workplan approved to implement** — conditions below were folded in on 2026-09-21; no SA re-review required.

### Dev response — how each finding was folded in (2026-09-21)

Every finding was accepted. Nothing was waived.

| Finding | Resolution |
|---|---|
| **H-1** wave order | Projects split promoted from C1 to **A0**; order is now A0 → A1–A4 → B → C. §7 retitled. |
| **H-2** shard matrix | **Dropped.** B1's command is plain `--selectProjects gate --ci`, with the un-requireable-name reasoning and the aggregator-job escape hatch recorded. |
| **H-3** vacuous green | Split into **two** scripts: `test:changed` (`--onlyChanged`, local Tier-0 only) and `test:qa` (`--changedSince=origin/main`, the QA-facing one). §7 C2 additionally requires `test:gate` in *every* scope including `smoke`. |
| **H-4** count assertions | A4 now ships a committed `*.guard.test.ts` asserting 377 suites / 5,792 tests and `gate + agents == 388`. §9 rebuilt around counts; checks 1, 2, 10 and 11 are new. |
| **M-1** 288 ≠ 280 | Moot — the directory split was replaced. The 280/288 discrepancy was 8 skipped suites being read as absent. |
| **M-2/M-3** leaks both ways | Removed by M-4: health-based quarantine has no directory boundary to leak across. |
| **M-4** quarantine by health | **Adopted.** Re-measured back-to-back at `d00006ac`: health gate **377 suites / 5,792 tests / 88.5s** vs directory gate 303 / 4,939 / 86.2s — **+2.3s for +853 tests**. SA estimated the split would save ~30s; at the current tip it saves ~2s, i.e. nothing. |
| **M-5** ≤2 min unrealistic | Tier-1 target restated as **4–6 min on a CI runner**, with the `maxWorkers`/cold-cache reasoning and a lockfile-keyed cache note. |
| **M-6** red-on-arrival nightly | C1 now reports **delta vs baseline** (steady state: "11 known, 0 new") and requires an owner + review date in `V6_OPEN_ITEMS.md`. |
| **M-7** missing skip step | `non-deploying-change.sh` scope step added to B1. |
| **M-8** integration tests in gate | Excluded from the gate explicitly, with the "inert only until someone adds the secrets" reasoning. |
| **L-1** "zero Jest in CI" | Corrected in §1 **and turned into the natural-experiment table in D-1** — the only bucket that runs in CI is the only one with zero failures. |
| **L-2** 13 → 4 guards | Corrected in D-4; the "security class is covered" claim withdrawn. |
| **L-3** 6 rotted scripts | Added to A1. |
| **L-4** relabel rejection | §8 row rewritten: result stands, explanation corrected, explicitly barred from being cited against transpile-only. |
| **L-5 / L-6** | Added as tasks in §10. |
| **Q-1..Q-5** | Answered inline where each is actionable: Q-1 in §5 A1, Q-2 in §7 C2, Q-3/Q-4 in §8, Q-5 in §5 A0. |

**One correction to SA's own figure:** the review says "~19 named failing suites" for the quarantine. That is the agent-side failing count *before* Wave A. A1 deletes 8 as dead and A2/A3 fix the two non-agent failures, so the committed baseline is **11**. The 11 are enumerated in §4.

### SA review of the Slice 1 refresh (§0) — 2026-10-02

**Reviewed by SA — 2026-10-02**, against `chore/ci-jest-gate` @ `894150f5`.
**Status:** ✅ **APPROVED WITH CONDITIONS** (SC-1..SC-10 below). No re-review needed if they are met; SC-1's budget is checked on the PR itself (T10).

#### What was measured, not taken on faith

| Claim | Result |
|---|---|
| Gate scope = **721 suites / 13,187 tests** | ✅ **exact.** Built the §0.5 config in a scratch file (20 ignore entries + the integration dir) and ran it: 721 / 13,187, 34 skipped tests, 0 pending suites. The escaped patterns behaved on Windows (752 − 20 − 11 = 721 listed). |
| 8 suites red in the gate before the fixes | ✅ The 8 failures are exactly rows 20–25, 27, 28. Row 28 shows as 1 runtime-error suite. Row 29 (`page.render`) passed in both full runs at 3 workers (19.3s). |
| ts-jest type-checks, so a warm cache could hide a type error | ❌ **Moot. Jest here is transpile-only.** `tsconfig.json` has `isolatedModules: true`, and ts-jest 29.4.5 reads it and switches to `transpileModule`. Proved by a scratch test containing a TS2322 and an import of a non-existent export: it **passes**. |
| The 497s build is the critical path | ❌ **Stale.** That was a dev-box figure. The last 30 `Build` runs on GitHub: PR runs **100–213s, typically ~165s**; the `next build` step itself is ~126s, and `npm ci` (with the npm cache) is **15–27s**, not 60–90s. Job prelude (set up + checkout + setup-node) is ~12s. |

**Local runs** (Windows, 8 cores, 77% busy with other agents before the runs started, so treat them as pessimistic):

| Run | Result |
|---|---|
| Gate, cold (fresh `--cacheDirectory`), `--maxWorkers=3` | **308s** Jest time, 315s wall |
| Gate, warm (same cache dir), `--maxWorkers=3` | **304s**. The transform cache saves ~1%, because there is no type-check to save. |
| `--shard=1/4`, cold, `--maxWorkers=3` (two runs) | 162s and 146s for 181 suites. Under this much contention the dev box does not divide cleanly by shard. |
| Slowest suite | `scripts/__tests__/check-bos-llm-literals.test.ts` at **155–169s**: a filesystem walk that Windows punishes. Next are `evaluateHealth` (30–50s) and `admin-authz-surface.guard` (22–38s). |

**Calibrating the runner against the dev box** (same work on both sides, from recent CI runs):

| Same work | GitHub runner | This dev box | Runner is |
|---|---|---|---|
| `test:bos-entitlements` (102 suites) | 18s step | 107s Jest / 136s wall | ~6× faster |
| `admin-authz-surface.guard` (1 suite) | 8s step | 22–38s | ~3–4× faster |
| `tests/plugins/` (38 suites) | 12–15s step | 30s cold | ~2–2.5× faster |
| `check:bos-llm-literals` script | 4s | 26s | ~6.5× faster |

**The ~2–3× slower-per-core rule of thumb does not hold here: on this repo's workload the runner is 2–6× faster.** The dev box runs Windows with Defender, its file I/O is slow, and it is shared with other agents. Dev's 1.0–1.5× slower assumption is the source of the 10–23 minute figure.

**Projection for the GitHub runner** (4 vCPU). It replays the cold run's per-suite times, scaled 2–2.5× for CPU-bound suites and 3–6.5× for the literal walk, and packs each shard's suites onto its workers longest-first, using Jest's actual hash split:

| Shape | Jest execution | + prelude, `npm ci`, upload (~45s) | + aggregator (~15–20s, serial) | **Verdict at** | vs Build ~165s |
|---|---|---|---|---|---|
| 1 job, `--maxWorkers=4` | 75–150s | 120–195s | n/a | **120–195s** | ❌ coin-flip at the pessimistic end |
| **3 shards, `--maxWorkers=4`** | 30–60s | 75–105s | +20s | **~95–125s** | ✅ 25–40% margin |
| 4 shards, `--maxWorkers=4` | 26–56s | 70–100s | +20s | ~90–120s | ✅, but 4 is barely better than 3 |

The 3-shard and 4-shard figures barely differ because the setup floor (~45s) and the aggregator hop dominate once execution drops under a minute. Each extra shard costs another `npm ci` and another concurrent job.

#### Runtime ruling (question 1)

1. **Sharded layout with an aggregator: approved. N = 3, `--maxWorkers=4`, `strategy.fail-fast: false`.** The aggregator design makes N a free constant: changing N never changes the required check name, so no fallback is needed for that.
2. **The budget is wrong and is replaced (SC-1).** A ≤420s target would let the gate finish ~4 minutes after a ~165s Build. That breaches the user's constraint, which is "don't add time", not "stay under 497s".
3. **Does the gate add zero time to CI?** On a PR that touches code: **projected yes, with ~40–70s of margin.** The `npm ci` cold miss hits Build and the gate alike when the lockfile changes, so it does not flip the order. Residual risks:
   - The projection is unverified until the PR's own runs (SC-1 makes that the acceptance test).
   - On a **`scripts/`-only PR**, Build skips in ~11s but the gate runs (SC-5). For that rare class, the gate *is* the critical path, at ~2 minutes. That is the price of not merging an untested change to a tested source.
   - The free plan runs at most 20 jobs at once. Each PR run grows from 8 jobs to 12, so two PRs pushed in the same minute can queue briefly.
4. **Jest/ts-jest cache: rejected, for a different reason than Dev gave.** It is *safe*: transpile-only, and Jest's transform key hashes file content plus config. But it is *useless*: 308s cold vs 304s warm. Remove it from the fallback ladder. It would only compete with the npm caches for the 10 GB budget.
5. **Actions minutes:** free while the repo is public. Once it goes private, 3 shards + aggregator bill roughly 7 rounded minutes per run against ~3 for one job. Revisit N then. That is not a decision for today.

#### Aggregator correctness (question 1, H-2)

The §0.7 design yields one requireable name **only if all of the following hold**. They are folded into SC-3.
- **`if: always()` is mandatory, never `!cancelled()` or the default.** GitHub counts a *skipped* required check as passing. An aggregator that can be skipped is therefore a green gate.
- **Pass only on `needs.shard.result == 'success'`**, an exact string, never `!= 'failure'`. A matrix result is `success` only if every leg succeeded, so a cancelled, skipped or failed leg turns the verdict red.
- **Fail closed on missing evidence.** In non-skip mode the aggregator requires exactly N result files. G5 then proves that they sum to G1's gate count.
- **Drop the separate `scope` job.** It adds a serial hop (~10–15s of runner pickup and checkout) in front of every shard. Each shard runs the scope step itself, as `build.yml` does. On "skip", a shard exits green without `npm ci`. The aggregator recomputes the same deterministic rule from the same checkout. If the two ever disagreed, the "no result files" rule fails closed.

#### Mechanism, guard, dispositions (questions 2–4)

- **Q2 `jest.gate.config.js` + `.github/ci/jest-quarantine.json`: approved.** It is simpler than the `projects` split and leaves `npm test` byte-identical. Every Q-5 condition is met by construction. Putting the quarantine file under `.github/` is a correct catch.
- **Q3 guard: approved.** G1 and G5 (exact, computed) plus G7 (floor) is the right reading of H-4. Exact pinned test counts would make every PR conflict on one line. The guard works across shards because the aggregator merges the shards' `--json` outputs (G5 sums `numTotalTestSuites` and `numRuntimeErrorTestSuites`), and shard 1 supplies both `--listTests` files for G1. **G3 needs a bootstrap rule (SC-6).** As written, "fail closed if the base cannot be read" fails this very PR, because the file does not exist on `main` yet.
- **Disposition table: approved, with these rulings.**
  - **Row 22, the tokenUsage contract pin: approved (SA acknowledges the entry).** Read the method: its only caller is `app/api/admin/business-os/llm-settings/ledger/route.ts`, which is `requireAdmin`-gated, and it returns a count and a timestamp, with no tenant data. (It is not "two integers", so correct the wording.) Because Jest is transpile-only, the new `@ts-expect-error` is enforced by `npm run typecheck:bos-llm`, **not** by Jest. Dev runs it (SC-8).
  - **Row 25, the step-3 snapshot: approved with Dev's bisect condition as written.** Re-record that one file only, and make the diff show exactly one snapshot entry changed. The workflow never passes `-u`; `--ci` already refuses to write snapshots.
  - **Row 28, chat-v4 `route.audit`: approved** (fix the mock). After the fix, G5's `numRuntimeErrorTestSuites == 0` is the proof. The route's direct `supabaseServer` use (rule 1) stays a TL item outside this slice.
  - **Row 29, invites `page.render`: approved** (file-level 30s timeout with a comment). It passed in both of SA's full runs. T7 stays.
  - **Rows 20, 21, 23, 24, 27: approved as diagnosed.**

#### Answers to §0.9

| Q | Ruling |
|---|---|
| **SA-Q1** skip gap | **Dev's recommendation, approved.** `tests.yml` runs whenever any `scripts/**` file other than `*.md` changed. `non-deploying-change.sh` is left untouched, so Vercel and the other gates are unaffected. Hand-listing the 3 sources would be an include list, and include lists rot. |
| **SA-Q2** `selectTemplate` | **Delete the dead module and its test in this slice.** SA re-checked: there are 0 importers. The only other `selectTemplate` in the repo is an unrelated private method in `WebsiteAutoBuildService.ts`. Deleting a module nothing imports cannot change behaviour, and the Build check proves it on the PR. A quarantine entry for dead code would never be shrunk. Record it as the one named exception to guardrail 1. The quarantine becomes **11**, so the partition is **743 = 721 + 11 + 11**. |
| **SA-Q3** integration dir | **Keep excluding the whole directory** (M-8). The 3 credential-free suites belong to the nightly. |
| **SA-Q4** floor vs exact | **Floor, plus exact computed G1/G5**, as reasoned in §0.6. |
| **SA-Q5** layout | **Sharded + aggregator, N = 3**, not 4 (above). |
| **SA-Q6** contract pin | **Approved** (row 22 above). |

#### Corrections to SA's own 2026-09-21 review

- **L-5 is withdrawn, and Q-4's "full per-file type-check" premise was wrong.** Jest is transpile-only here, as shown above. The headers in `scripts/typecheck-bos-llm.ts` and `tokenUsageRepository.contract.test.ts` are **correct**. Delete §0.2's "carries the same false claim" line and the L-5 task.
- **M-5's "4–6 min on a CI runner" was also too pessimistic.** It assumed a slower runner. Same correction as above.

#### Conditions

| # | Condition |
|---|---|
| **SC-1** | **Budget.** Replace "≤ 420s" everywhere in §0.7.1 and T10. The rule: on the PR's first run and on a re-run, the `Gate tests (jest)` job completes **before** the `Build (next build)` job of the same run, **and** the Tests workflow's wall-clock is ≤ 85% of the Build workflow's. Hard ceiling: 150s. If it misses, raise N to 4. If it still misses, stop and return to SA (§0.7.1(c)3 stands). |
| **SC-2** | N = 3 matrix, `--maxWorkers=4`, `fail-fast: false`. N is defined once and read by the aggregator to check it has N result files. |
| **SC-3** | Aggregator exactly as in "Aggregator correctness": `if: always()`, `needs: [shard]`, an exact `== 'success'` check, fail-closed on missing artifacts, no separate `scope` job. Add **T13**: a scratch commit where one shard exits 1 before running Jest makes the verdict red, and another where a shard's artifact upload is removed makes the verdict red. |
| **SC-4** | No Jest/ts-jest cache step. Remove fallback 2 from §0.7.1(c). |
| **SC-5** | SA-Q1 as ruled: run on any non-`.md` `scripts/**` change. Add a T12b: a `scripts/`-only commit runs the gate rather than skipping it. |
| **SC-6** | G3 bootstrap. First check that the base commit resolves (`git cat-file -e HEAD^1`); if it does not, fail closed. Then, *file absent at base* means bootstrap: pass and say so in the summary. *File present* means the subset check. |
| **SC-7** | Delete `lib/website-builder/selectTemplate.ts` and its test. Update the totals: quarantine 11, partition 743 = 721 + 11 + 11. |
| **SC-8** | Row 22: run `npm run typecheck:bos-llm` locally after adding the `@ts-expect-error`, and record the result. Correct the "two integers" wording. |
| **SC-9** | Fix the L-5 references as above (§0.2 and the task list). |
| **SC-10** | No `-u` or `--updateSnapshot` anywhere in `tests.yml` or `test:gate`. Add it to T11's grep. |

#### Business trade-off for the user

None that needs a decision now. Two facts are worth stating plainly:
- A PR that changes only `scripts/` will wait ~2 minutes for tests, where today it finishes in seconds. That is rare, and it is the cost of not merging untested changes.
- When the repo goes private, the gate costs roughly 7 billed Actions minutes per PR run.

#### Approval

- [x] **Workplan approved — proceed to implementation** under SC-1..SC-10. Code review follows as normal.

### SA code review of Slice 1 — 2026-10-02

**Code Review by SA — 2026-10-02**, uncommitted diff on `chore/ci-jest-gate` @ `894150f5` (20 tracked files, +65 / −5,502, 10 intentional deletions; 5 new files).
**Status:** 🔄 **Fix Required: two one-line fixes (CR-1, CR-2).** Neither needs another SA pass. TL checks both in the diff, then the cycle goes to QA and the user diff.

#### What was checked

| Area | Result |
|---|---|
| `tests.yml` wiring | ✅ The verdict job `Gate tests (jest)` is `needs: [shard]` + job-level `if: always()`, so it can never be skipped. It passes only on the exact string `needs.shard.result == 'success'` (an env var in a bare `[ != ]` test). The check step is `always()` and fails closed when there are no artifacts: the list files are missing, so `readFileSync` throws and the catch sets exit 1. Shard names (`Gate tests shard N`) do not contain the verdict name. `strategy.job-total` is a valid context in a step's `name:` and `run:`. `fetch-depth: 2` in both jobs. On a PR, `HEAD^1` of the merge ref is the base tip; on a push, `BASE` is `github.event.before`, which fails open to RUN when unresolvable. `permissions: contents: read` is enough, because artifact v4 uses the runtime token. Concurrency matches `build.yml`. `.nvmrc` = 22. Zero `secrets.` and no `-u`. The Jest step runs bare. |
| Skip path (T12) | ✅ On a docs-only PR every shard runs only the scope step and succeeds, so `needs.shard.result` is `success`. The verdict skips download/check and passes the exact-`success` step. If shards and verdict ever disagreed in the direction "shards skip, verdict runs", the check fails closed. The reverse direction still requires the shards' bare Jest exit codes to be 0. |
| `jest-gate-scope.sh` | ✅ Wraps the untouched shared rule. Bash `case` `*` matches `/`, so `scripts/**/*.md` skips and every other `scripts/` file runs (SC-5). It fails open on a `git diff` error. |
| `jest.gate.config.js` | ✅ Spreads the base config (`testPathIgnorePatterns` exists there, including `/node_modules/`). The escape covers the full regex metacharacter set. Patterns are `<rootDir>/…$`. `<rootDir>` is substituted unescaped, which is safe on the runner (`/home/runner/work/…` has no metacharacters), and G1 would catch it otherwise. |
| `jest-gate-check.mjs` | ✅ No vacuous pass found. Empty lists throw. G5 requires every index 1..N, a single agreed N, executed = listed in both directions, no duplicate across shards, the summed `numTotalTestSuites` = gate size, 0 runtime errors, and 0 failures. Even a wrong N cannot pass, because executed must still equal listed. G3 matches SC-6: the base commit must resolve (fail closed), *file absent at base* → bootstrap pass with a stated reason, and *file present* → subset check. |
| Test edits vs the approved dispositions | ✅ Every edit matches its row. No assertion is weakened. Row 21 *replaces* one assertion with three stronger ones, its reason is stated, and it is checked against the `recipes.ts` comment. Row 28's mock chain matches the route's `from('user_preferences').select().eq().maybeSingle()`. The snapshot diff is **exactly one line in one entry** (`len 31356 → 31366`), and `b6efd992` (#151) is the last commit to touch `catalog.ts`. Row 22: the signature is `(window, feature)`, so arity 2 is correct. Its only caller is the `requireAdmin` ledger route, and the comment says "a row count and the newest row's timestamp", so the SC-8 wording is right. |
| Deviation 6 (row 20 history) | ✅ Verified: at `89722cdd`, `featureFlags.ts` already read `NEXT_PUBLIC_…` while the new test set the unprefixed name 19 times. It was never green. The source side is correct. |
| Obsolete-snapshot exit risk | ✅ None. No `.snap` sits beside a quarantined or deleted suite, and under `--ci` an obsolete snapshot *file* would otherwise fail the run. |

#### Deviations 1–5: rulings

1. **Scope rule as a shared script: approved.** The shards and the verdict job now agree by construction, which is better than SC-3's two inline copies.
2. **N carried in the result filenames: approved.** The matrix is the only place N is written, and G5 stays exact without a config job.
3. **Stricter G5 (0 failed suites and 0 failed tests): approved.**
4. **`--quarantine` flag: approved.** It cannot be used to dodge G3 in CI: `jest.gate.config.js` always reads the committed file, so a substituted file fails G1. Any edit to `tests.yml` is reviewable.
5. **G6 and the two "focused" suites: accepted as-is (ruling 4b below).**

#### Code Review Comments (MUST-FIX)

1. **CR-1** `components/business-os/settings/__tests__/InviteFriendsSection.render.test.tsx`, after the imports: add a file-level `jest.setTimeout(30_000)` with a one-line reason, in the same form as row 29. It types character by character (4 `userEvent.type` calls) and takes 3.9s on its own, which is 78% of the 5s default. That is the same mechanism as row 29. The change is a timeout only (guardrail 3). — Priority: Medium
2. **CR-2** `.github/workflows/tests.yml:132`, in the `Upload results` step, add `overwrite: true` under `if-no-files-found: error`. The upload is `always()`, so a shard that went red on a flake has **already** uploaded `gate-results-<n>`. "Re-run failed jobs" then re-uploads under the same name. artifact v4 refuses a duplicate name unless `overwrite` is set, so the re-run would stay red. SC-1/T10 requires a re-run on this very PR, and a re-run is the normal recovery from a flake on a required check. The line is harmless if GitHub would have allowed the upload anyway. — Priority: Medium

#### Rulings on the items left for SA

- **4a. The three jsdom timeouts under contention:** **apply the timeout to `InviteFriendsSection.render` only** (CR-1). **Leave `audit-trail/searchTotals.render` and `analytics/linkedWindow.render` alone.** They do no per-character typing, they failed only at ~5× contention, and the runner measured 2–6× faster than the dev box. Standing pre-approval, so this does not loop back to SA: if either one times out in any of this PR's runs, give it the same file-level timeout with a comment.
- **4b. `enum-drift` and `marketingGate`: accept, with no code change.** Correct the record: they are **not** whole-file skips. Each has a `describe` that runs and passes, plus a `describe.skip` gated on the environment. Jest's `formatTestResult` reports that combination as `focused` ("all passed, not all executed"). A truly whole-file-skipped suite sets `testResult.skipped` and increments `numPendingTestSuites`, so G6 is correct as written and still bites.
- **4c. `console.*` in `.github/ci/jest-gate-check.mjs`: the rule does not apply.** CLAUDE.md's logging rule covers server/app code in `lib/`, `app/` and `components/`. This is a dependency-free CI script that runs before (and without) `npm ci`, so it cannot load Pino. stdout/stderr is its interface.

#### Optimisation Suggestions (optional)

- G3 treats *any* `git show base:file` failure as bootstrap. That is safe today, because the base commit is proven to resolve and depth 2 fetches its tree. If it is ever touched, make "absent" explicit: an empty `git ls-tree <base> -- <file>` means absent, and any other error fails closed.
- Fix §10 deviation 5's wording, per 4b.

#### PR-only checks (remaining; Dev/QA on the PR, after the user has seen the diff)

1. **T9, Linux parity.** The suite has never run on Linux, so case-sensitive imports and path assumptions surface here first. ⚠️ G3 is in bootstrap on this PR only, so it will **not** refuse a quarantine addition here. Any Linux-only failure is either a test fix with a named cause, or a quarantine addition that SA acknowledges by name. Never a silent addition. Then pin `minSuites` / `minTests` from the Linux run.
2. **T10 / SC-1**, cold and on a re-run. The verdict completes before `Build (next build)`, the Tests wall-clock is ≤ 85% of Build's, and the ceiling is 150s. The re-run also exercises CR-2.
3. **T12, T12b, T13.** Scratch commits are dropped before merge. Confirm the verdict summary shows "Skipped" (T12) and that G3 reports "bootstrap" on this PR.
4. Confirm the checks list shows exactly `Gate tests (jest)` plus `Gate tests shard 1..3`.
5. **After merge (user):** require `Gate tests (jest)` only, and prove with a throwaway PR that the merge is **blocked**. The first PR after merge is also the first real G3 ratchet: its summary must say "a subset of the base's 11".

### Code Approved for QA: **Yes, once CR-1 and CR-2 are in** (TL verifies them in the diff; no SA re-review).

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-04 | Realigned onto `origin/main` @ `7eac5b98` (139 commits) | TL. Main had already fixed three of Slice 1's rows independently: `creditPeriod` (via the credit-deduction slices), `runRecord.adoption` (`f1919a48`), the step-3 snapshot (`ede40761`, the same #151 cause the bisect found), so main's versions were kept and Slice 1's edits to those files dropped. `featureFlags` was touched on main (`c8639a2e`) but was still red, so Slice 1's fix was re-applied. `package.json` was re-edited to add `test:gate` beside main's new `test:bos-llm`. No lockfile change. Re-measured: full suite **835 suites / 16,160 tests**, failing = exactly the 11 quarantined suites. Gate: 3 local shards exit 0 (122s / 315s / 113s on the shared dev box), guard **G1 835 = 813 + 11 + 11**, G2–G7 PASS, G7 floors 721 / 13,187 still below the real 813 / 15,813 (pin from the first Linux run, as before). Since 894150f5, #199 and BD-26 added targeted Jest subsets to `bos-llm-typecheck.yml` and `bos-entitlements.yml`; no full-suite gate exists, so no overlap with `tests.yml`. |
| 2026-10-02 | SA code review of Slice 1 | 🔄 Fix Required, two one-liners, no SA re-review: CR-1 (file-level timeout on `InviteFriendsSection.render`) and CR-2 (`overwrite: true` on the shard upload, so "re-run failed jobs" works). Workflow wiring, fail-closed paths, the scope script, the gate config, guard G1–G7, all 9 test edits and the one-entry snapshot verified. Deviations 1–6 approved. Rulings: 4a, only `InviteFriendsSection` gets the timeout now, and the other two are pre-approved if they time out on the PR; 4b, `enum-drift`/`marketingGate` are partial skips (`focused`), G6 correct; 4c, the logging rule does not cover the dependency-free CI script. |
| 2026-10-02 | Slice 1 implemented (uncommitted) | All of SC-1..SC-10 applied. 8 dead suites + `selectTemplate.ts` and its test deleted; 9 fix-test dispositions applied; 11-entry quarantine; `jest.gate.config.js`, `jest-gate-check.mjs`, `jest-gate-scope.sh`, `tests.yml` (3 shards + `Gate tests (jest)`), `test:gate`. Row 25 bisected to `b6efd992` (#151, a deliberate catalog edit) and one snapshot re-recorded. Local: partition **743 = 721 + 11 + 11**; gate **721 suites / 13,192 tests, exit 0**; 3 shards green, and the guard is green over their merged output; the guard fails on all 9 red-path cases; the full suite fails exactly the 11 quarantined suites. `typecheck:bos-llm` 0 new. Load-only timeouts found in 3 jsdom suites outside §0.4, flagged to TL. The §0.2 L-5 row and the L-5 task removed (SC-9). PR-only checks (T9–T13, SC-1 budget, Linux floors) pending. Implementation record in §10. |
| 2026-10-02 | SA review of the Slice 1 refresh | ✅ Approved with conditions SC-1..SC-10 (§11). Gate measured at exactly 721 suites / 13,187 tests. Jest is transpile-only (verified), so the cache-hides-a-type-error concern is moot, and the cache saves ~1% (308s cold vs 304s warm locally), so it is dropped. The critical path is Build at ~165s on GitHub, not 497s. The GitHub runner measured 2–6× faster than the dev box on this repo's suites. Projection: 3 shards × 4 workers + aggregator gives a verdict at ~95–125s. Budget is now "finish before Build, ≤ 85% of its wall-clock, ceiling 150s". The separate scope job is dropped; the aggregator is `if: always()` with an exact `success` check and fails closed on missing results. G3 gets a bootstrap rule. `selectTemplate.ts` is deleted rather than quarantined. Contract-pin entry acknowledged. SA's own L-5 is withdrawn. |
| 2026-10-02 | Slice 1 refresh against `894150f5` (§0) | New §0 for Slice 1 ("Jest gate on every PR") on `chore/ci-jest-gate`. TL's measurement: **752 suites / 13,547 tests / 374s cold, 29 red suites** (8 dead, 11 agent-side, 2 known, 7 new, 1 flaky). Dispositions: **delete 8 · fix-test 9 · quarantine 12**. Findings from the 7 new suites: `creditPeriod` fails only on Windows (a CRLF regex in the test); `selectTemplate.ts` is dead source (exports removed in `8c53562a`, 0 importers), so it is quarantined and flagged; `chat-v4/route.audit` crashes the worker through an unhandled rejection caused by a stale `supabaseServer` mock (`c1a427e6`); `runRecord.adoption`'s mock lacks `billDueDatedStages` (`8dfbd138`); `proposals` gained `stopped` (#151); the token-usage pin is missing a deliberate admin aggregate (`bde9ead8`); the step-3 snapshot must be bisected before it is re-recorded. Integration suites are now 11, not 9 (3 run without credentials). Mechanism: a `jest.gate.config.js` + `.github/ci/jest-quarantine.json` recommended over the `projects` split. Guard: CI script, exact computed partition + a floor (instead of A4's exact counts). **Runtime: a single job at 752 suites is estimated at 10–23 min cold, well past the 497s build**, so the workflow becomes 4 shards plus a `Gate tests (jest)` aggregator, judged against a ≤420s cold budget, with a fallback ladder. Found a skip-rule gap: 3 gate suites test `scripts/` sources. The old figures in §1, §4, §5 A4 and §9 are marked superseded, not deleted. SA-Q1..Q6 open. |
| 2026-09-21 | Created | Baseline measured on `main` @ `9aeeb50e`: full suite 125s, BOS 41s, gate scope 97s, `next build` 497s, `tsc` 2,035 errors / 637s / OOM at 4 GB, zero Jest in CI, 21 failing suites (8 importing deleted modules, up to 7 months). Three-wave plan: green the gate, run it in CI, quarantine agent-side and re-contract the QA agent. `isolatedModules` and repo-wide `tsc`/`eslint` gates measured and rejected; the build-on-PR decision left intact per CI_BUILD_GATE_WORKPLAN.md. |
| 2026-09-21 | Re-baselined before commit | The original figures were measured on a local `main` @ `9aeeb50e` that was **20 commits stale**. Re-measured on `origin/main` @ `d00006ac`: full suite **396 suites / 6,092 tests / 107.4s** (was 380 / 5,714), health gate **377 / 5,792 / 88.5s** (was 361 / 5,414), directory gate **303 / 4,939 / 86.2s**. **The failing set is byte-identical at both revisions** — 21 suites / 129 tests, zero new, zero gone — so the 11-suite quarantine, the 8 dead files and the A2/A3 fixes are unchanged. No dependency or lockfile change. The health-vs-directory delta collapsed from +21.7s to **+2.3s**, which strengthens the M-4 decision: the directory split's only benefit is now inside measurement noise while its three structural traps remain. Re-taking these mattered because §5 A4 turns them into a committed guard assertion. |
| 2026-09-21 | SA findings folded in | All 18 findings accepted, none waived. **Design change: quarantine by health, not directory** — gate is now everything minus an 11-suite committed baseline; re-measured back-to-back at **377 suites / 5,792 tests / 88.5s** vs the directory split's 303 / 4,939 / 86.2s, i.e. **+2.3s for +853 tests**. Projects split promoted to **A0** (H-1); shard matrix dropped (H-2); `test:qa` added using `--changedSince=origin/main` after `--onlyChanged` was measured to exit **0** on a clean tree (H-3); count guard added and §9 rebuilt around volume rather than exit codes (H-4). Corrected: "zero Jest in CI" was false — `admin-authz-guard.yml` runs a Jest guard on every PR and `plugin-tests.yml` runs four; reframed as the D-1 natural experiment (Plugins is the only bucket running in CI and the only one with zero failures). Guard-test count corrected 13 → **4** (the original `find` did not prune `.claude/worktrees/`, which holds 1,297 test files). `isolatedModules` result kept but its explanation corrected — the ts-jest option is deprecated and redirects to a tsconfig constraint check, so it is not evidence about transpile-only; `@swc/jest` moved to backlog. Tier-1 target restated 2 min → **4–6 min** on a CI runner. |
| 2026-09-21 | SA review | 🔄 Revision Required (approve-with-conditions). Direction approved; baseline independently re-measured and confirmed exact (380/5,714/21/129, failure split, 4,593 gate tests, the `aa2df32b` deletions, the `jest-setup` stubs, live branch protection). 4 High findings: Wave B depends on Wave C (`--selectProjects gate` does not exist until C1); the shard matrix makes the job un-requireable by name; `smoke` → `jest --onlyChanged` exits **0** with zero tests on a clean tree; §9 cannot detect partial scope collapse (an SA probe of C1 silently dropped 7 suites). 8 Medium (gate is **288** suites not 280; `tests/v6-regression/` leaks into the gate; `scripts/__preview__/render.test.ts` wrongly quarantined; health-based quarantine preferred over directory-based; the ≤2 min target is a warm 8-core figure; red-on-arrival nightly; missing `non-deploying-change.sh` skip; plugin integration tests inside the gate) + 6 Low. Q-1 delete (not archive); Q-2 confirmed + extended to repositories/executors/BOS-LLM, depth-only; Q-3 exclusion right, list wrong both ways; Q-4 relabel the `isolatedModules` rejection, defer the spike; Q-5 in bounds, with `rootDir`/`roots` conditions. |
