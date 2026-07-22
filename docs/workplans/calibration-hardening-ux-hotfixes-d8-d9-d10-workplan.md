# Workplan: Calibration Hardening + UX Hotfixes (D8 / D9 / D10)

**Developer:** Dev
**Requirement:** [V6_AI_DECLARED_TRANSFORM_SCHEMA_RECONCILIATION_REQUIREMENT.md](/docs/requirements/V6_AI_DECLARED_TRANSFORM_SCHEMA_RECONCILIATION_REQUIREMENT.md) — Consolidated Backlog items **D8, D9, D10**
**RCA source:** [AGENT_RCA_CONCLUSION_gmail-expense-attachment-flatten.md](/docs/investigations/AGENT_RCA_CONCLUSION_gmail-expense-attachment-flatten.md) → "Addendum — 2026-07-13"
**Branch:** `agent-failure-troubleshooting` (existing; RM-created — not `main`)
**Date:** 2026-07-19
**Status:** Code Complete (pending SA review)

## Analysis Summary

Three low-risk, calibration-owned backlog items delivered as one cohesive hardening pass. **None touch the V6 generation pipeline** (`lib/agentkit/v6/**`, intent prompt, `CapabilityBinderV2`, `IntentToIRConverter`, `ExecutionGraphCompiler`) — a concurrent team owns those.

- **D8** — Security sweep: owner-scope every `agents` write under `app/api/v2/calibrate/**` (`.eq('user_id', …)` or `AgentRepository`).
- **D9** — Calibration emails: send `multipart/alternative` (HTML + auto-generated plaintext) — fixed in ONE place, the transport.
- **D10** — Parameterize success (UI only): clear the resolved hardcode suggestion + reset detection state + show a success affordance.

## Implementation Approach

**D8.** The batch route loads the agent by id and validates ownership (`agent.user_id`), then may run under a **service-role** client for admin-initiated runs (RLS bypass). That is exactly where an unscoped `.eq('id', agentId)`-only write is dangerous. Fix: introduce one `ownerId = agent.user_id` reference right after the ownership check, add `.eq('user_id', ownerId)` to every raw `.from('agents').update(...)` in the batch route, and add `.eq('user_id', agent.user_id)` to the rollback route write. The already-fixed writes (Item 7 corrector via `AgentRepository.updatePilotSteps`; apply-fixes L1321) are left untouched. A checklist comment near `ownerId` prevents regressions.

**D9.** Fix strictly in the transport (`emailTransport.ts`): add an optional `text` to `SendEmailParams`; in `sendEmail`, compute the plaintext part once (caller-supplied `text` or an auto-generated `htmlToText(html)`), and send `{ html, text }` on both the Resend and nodemailer paths. Callers (the two senders + `NotificationService`) need no change — the transport degrades gracefully.

**D10.** UI only, in `page.tsx`. On a successful `repair-hardcode`: clear `passSuggestions` (the resolved cosmetic suggestion), reset `detectionResult`/`hasHardcodedValues`, set a `parameterizationSucceeded` flag for a success affordance, then `loadAgent()` reconciles. Fix `loadAgent`'s detection to clear-on-empty by routing through a new pure helper `deriveHardcodeState` (adds the missing else-branch). Add a non-blocking confirmation banner to `CalibrationSuccess`.

## Files to Create / Modify
| File | Action | Reason |
|------|--------|--------|
| `app/api/v2/calibrate/batch/route.ts` | modify | D8: owner-scope 8 raw `agents` writes + `ownerId` guard comment |
| `app/api/v2/calibrate/rollback/route.ts` | modify | D8: owner-scope the restore-backup `agents` write |
| `lib/notifications/emailTransport.ts` | modify | D9: thread `text`, auto-generate plaintext, send multipart on Resend + nodemailer |
| `lib/notifications/__tests__/emailTransport.test.ts` | create | D9: assert `{html, text}` on both providers |
| `lib/calibration/hardcodeState.ts` | create | D10: pure `deriveHardcodeState` (clear-on-empty) |
| `lib/calibration/__tests__/hardcodeState.test.ts` | create | D10: unit test the clear-on-empty logic |
| `app/v2/sandbox/[agentId]/page.tsx` | modify | D10: clear suggestion + reset detection + success flag; use helper in `loadAgent` |
| `components/v2/calibration/CalibrationSuccess.tsx` | modify | D10: success affordance banner |

## Task List
- [x] Confirm branch (not `main`), read requirement + RCA addendum + all target files
- [x] Write this workplan
- [x] D8: audit every `agents` write under `app/api/v2/calibrate/**`; owner-scope each unscoped one (8 batch + 1 rollback; `ownerId` guard comment)
- [x] D9: transport multipart/alternative + auto plaintext; transport test
- [x] D10: pure helper + `loadAgent` clear-on-empty; clear suggestion + success affordance; helper test
- [x] Run the three new test suites (9 pass) + typecheck touched files (only pre-existing agent-null errors remain, outside my edits)
- [ ] Report to SA → USER → QA

## D8 — Full `agents`-write audit (`app/api/v2/calibrate/**`)
| File:line | Write | Before | Action |
|---|---|---|---|
| batch L648 | pre-flight fixes persist | `.eq('id', agentId)` | + `.eq('user_id', ownerId)` |
| batch L1049 | Layer-2 fixes persist | `.eq('id', agentId)` | + `.eq('user_id', ownerId)` |
| batch L1122 | scatter field-ref fixes | `.eq('id', agentId)` | + `.eq('user_id', ownerId)` |
| batch L1827 | loop-round fixes | `.eq('id', agentId)` | + `.eq('user_id', ownerId)` |
| batch L3279 | final-validation fixes | `.eq('id', agentId)` | + `.eq('user_id', ownerId)` |
| batch L4127 | auto-fix round | `.eq('id', agentId)` | + `.eq('user_id', ownerId)` |
| batch L4658 | **clean-pass `production_ready`** (known open) | `.eq('id', agentId)` | + `.eq('user_id', ownerId)` |
| batch L4908 | failed-path `workflow_hash` | `.eq('id', agentId)` | + `.eq('user_id', ownerId)` |
| rollback L91 | restore backup pilot_steps | `.eq('id', session.agent_id)` | + `.eq('user_id', agent.user_id)` |
| batch L1152 (Item 7 corrector) | via `AgentRepository.updatePilotSteps(agentId, user.id, …)` | already owner-scoped | leave |
| apply-fixes L1313 | `.eq('user_id', user.id)` (L1321) | already owner-scoped | leave |
| save-configuration L54 / load-configuration L47 / rollback L76 / batch L127 & reload selects | reads | n/a | not writes |

## SA Review Notes

## SA Code Review

**Code Review by SA — 2026-07-13**
**Status:** ✅ Approve-with-minor-fix — the D8/D9/D10 code is correct and the D8 security sweep is complete; **one code MUST-FIX** (a redundant `console.warn`) plus a **critical commit-hygiene directive** (exclude the stray concurrent-team files from the commit).

### Finding 1 — CLEAN DIFF / no stray changes: CONFIRMED (our source files are clean; contamination is confined to separate files)
I inspected every working-tree entry and the diffs of all D8/D9/D10 source files.

**Our batch — verified to contain ONLY intended changes:**
- `app/api/v2/calibrate/batch/route.ts` — 8 additive `.eq('user_id', ownerId)` filters + the `const ownerId = agent.user_id` declaration + its guidance comment. Nothing else.
- `app/api/v2/calibrate/rollback/route.ts` — 1 additive `.eq('user_id', agent.user_id)` on the restore-backup write.
- `lib/notifications/emailTransport.ts` — only the D9 `text?` field + `htmlToText`/`resolveText` + the two `text: resolveText(p)` send lines.
- `app/v2/sandbox/[agentId]/page.tsx`, `components/v2/calibration/CalibrationSuccess.tsx` — D10 (clear-on-empty via `deriveHardcodeState`, `handleWizardComplete` clears, `parameterizationSucceeded` banner) on top of the still-uncommitted Group A changes; no stray edits.
- New: `lib/calibration/hardcodeState.ts`, `lib/calibration/__tests__/hardcodeState.test.ts`, `lib/notifications/__tests__/emailTransport.test.ts`, this workplan.

**NOT ours — concurrent-team / stash-pop contamination that MUST be excluded from the commit:**
- `package.json` + `package-lock.json` — removes `@playwright/test` (unrelated to D9; D9 is dependency-free — `emailTransport` imports only pre-existing `nodemailer`).
- `tests/admin-users.spec.ts` — **deleted** (a Playwright e2e test; pairs with the Playwright removal above).
- `docs/v6/V6_OPEN_ITEMS.md`, `docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md`, `docs/workplans/WP63_FLATTEN_FIELD_SHAPE_FIDELITY_WORKPLAN.md` — the concurrent WP63 flatten work.
- `.claude/settings.json` / `settings.local.json`, `docs/architecture/`, `docs/requirements/ADMIN_AGENT_HEALTH_DASHBOARD_REQUIREMENT.md` — pre-existing / unrelated.

**⚠️ Commit-scope directive (RM):** commit ONLY the 9 files in the "Our batch" list above. Do **not** `git add -A` / `git commit -am` — that would sweep in the Playwright dependency removal and the `admin-users.spec.ts` deletion (removing test infrastructure), plus the concurrent WP63 docs. Those belong to other work and must stay out of this commit.

### Finding 2 — D8: all 9 writes correctly owner-scoped, none missed: CONFIRMED
- **All 8 batch writes** (now L660, L1062, L1132, L1841, L3294, L4143, L4678, L4926) and the **1 rollback write** (L96-97) received `.eq('user_id', <owner>)`. Each is purely **additive** (`.eq('id', …)` → `.eq('id', …).eq('user_id', …)`).
- **The owner id is provably correct on BOTH paths.** Batch uses `ownerId = agent.user_id` — the loaded row's OWN owner — declared at L200, AFTER the `identity.forbidden → 403` authorization check (L169-173). So the write resolves to `WHERE id=agentId AND user_id=(that row's user_id)`, which targets exactly the loaded+validated row. This is even more robust than `user.id`: it is tautologically the owner regardless of admin/service-role vs non-admin, so it **cannot mis-scope and cannot break a legitimate owner write.** Rollback uses `agent.user_id` (loaded + validated above) — same property.
- **Independent completeness grep** of every `.from('agents')` in `app/api/v2/calibrate/**`: all UPDATE sites are now owner-scoped — 8 (batch) + 1 (rollback) + 1 (apply-fixes L1319-1320, already fixed from the prior calibrate-route MUST-FIX). **No `agents` write remains unscoped.** SELECT/reads were correctly left alone (batch L127/677/1079/1851/4153; rollback L76; load/save-config) — reads run under RLS or carry an explicit ownership check, and the admin initial-load read is an intentional cross-user select.

### Findings 3-6

| # | Finding | Ruling | Reason |
|---|---------|--------|--------|
| 1 | Clean diff / commit scope | **WON'T-FIX (code)** + **commit directive** | Our source files clean; contamination is in separate files — RM must exclude them (see directive). |
| 2 | D8 owner-scoping (9 writes + completeness) | **WON'T-FIX** (correct) | All additive, `agent.user_id` is tautologically the owner on both paths; no write left unscoped; reads correctly untouched. |
| 3 | D9 transport (`html`+`text` on both senders) | **WON'T-FIX** (correct) | Dependency-free `htmlToText` (empty-safe, regex can't throw); `resolveText` honors a caller-supplied `text` (no double-gen); threaded into Resend **and** nodemailer; optional field → zero caller regression. |
| 4 | D10 UI (clear-on-empty, wizard-complete, banner) | **WON'T-FIX** (correct) | `deriveHardcodeState` clears both fields on empty (fixes stale `hasHardcodedValues`); `handleWizardComplete` clears suggestions/detection + sets a non-blocking banner; **verdict/finishGate logic untouched** (grep-confirmed: no `computeVerdict`/`deriveCoverageSignal`/`canFinishCalibration`/`getPassSuggestions` edits) — display/state only, no Group-A regression. |
| 5 | Redundant `console.warn` in a touched server file | **MUST-FIX-NOW** | `emailTransport.ts` L213-216 duplicates the Pino `logger.warn` at L209-212. CLAUDE.md treats a touched server file's `console.*` as a basic standard, and this is a zero-risk pure deletion (the Pino equivalent already exists) — no scale/hot-path reason to defer as the 219/30-call sweeps were. |
| 6 | Tests | **WON'T-FIX** (adequate) | D8 owner-scope assertion; D9 both-parts + caller-text-honored; D10 clear-on-empty; new suites 9/9 green. |

### MUST-FIX list (hand to Dev)
1. **`lib/notifications/emailTransport.ts` L213-216** — delete the redundant `console.warn` block; the Pino `logger.warn` immediately above (L209-212) already logs the same "no transport delivered" event with more context. Exact change:
```ts
  // 4. Nothing configured / all failed → report not sent
  logger.warn(
    { to: p.to, subject: p.subject, errors: errors.length ? errors : undefined },
    'No email transport delivered the message (preview only)'
  );
  return { sent: false, provider: 'none', error: errors.join('; ') || 'no email transport configured' };
```
(i.e. remove the `console.warn('📧 [EmailTransport] Email NOT sent …', { to, subject });` call entirely.)

**Not a Dev code change but blocking for the commit:** the RM commit-scope directive under Finding 1 — restrict the commit to the 9 D8/D9/D10 files; exclude `package.json`/`package-lock.json`, the `tests/admin-users.spec.ts` deletion, and the WP63 / V6_OPEN_ITEMS docs.

### Security / standards
D8 fully satisfies the non-negotiable `.eq('user_id', …)` rule for all calibrate-route `agents` writes (the class elevated to MUST-FIX in prior cycles is now swept). No new patterns; new server code uses Pino (after the one deletion); client components legitimately use console.

### Code Approved for QA: Yes — after the user's review, once the one-line `console.warn` deletion lands and the commit is scoped to the 9 files.

## QA Testing Report

**QA — 2026-07-19**
**Test mode:** full (D8/D9/D10 acceptance criteria + independent D8 completeness grep + regression + commit-hygiene audit)
**Strategy used:** A (Jest unit) for the transport + hardcode-state helper; B/code-trace + independent grep for D8 owner-scoping and D10 page wiring.
**Focus:** security (D8 owner-scoping) / notifications (D9 multipart) / calibration UX (D10) — all calibration-owned, no V6 generation pipeline touched.
**Skipped:** D/E — the user's live 0ee53785 re-test is post-QA.
**Input source:** coordinator prompt + workplan + SA Code Review (approve-with-minor-fix; the one `console.warn` must-fix now applied).

### What I ran
- `npx jest lib/notifications lib/calibration lib/pilot/shadow` → **25 suites / 243 tests, all passing** (incl. the two new suites: `emailTransport.test.ts`, `hardcodeState.test.ts`).
- `npx tsc --noEmit` → the D8/D9/D10 touched files add **zero new errors**: `emailTransport.ts`, `hardcodeState.ts`, `batch/route.ts`, `rollback/route.ts`, `CalibrationSuccess.tsx` are **clean**; the only errors in a touched file are the 2 **pre-existing** `page.tsx` `agent possibly null` TS18047 warnings, line-shifted to 692/786 by D10's added lines. (Repo-wide total is 1670 — LOWER than the prior 1674 because the contamination's deleted `admin-users.spec.ts` + `@playwright/test` removal dropped some errors; nothing D8/D9/D10 added.)

### Acceptance criteria
| Item | AC | Result | Evidence |
|---|---|---|---|
| **D8** | every `agents` **write** under `app/api/v2/calibrate/**` is owner-scoped; NONE remain unscoped | ✅ Pass | Independent grep of all `.from('agents')`: **8 batch UPDATEs** (L657/1059/1133/1839/3292/4141/**4673**/4924) each now `.eq('id', agentId).eq('user_id', ownerId)`; **rollback L91** `.eq('user_id', agent.user_id)`; apply-fixes L1312 already scoped (prior fix). Every other `.from('agents')` (batch 127/677/1079/1851/4153, rollback 76, load-/save-config, apply-fixes 111) is a `.select(` read. **No write left unscoped.** Notably L4673 — the previously-known-open clean-pass `production_ready` write flagged in earlier cycles — is now scoped. |
| **D8** | purely additive; a legitimate owner write still succeeds | ✅ Pass | Each change is `.eq('id',…)` → `.eq('id',…).eq('user_id',…)`. `ownerId = agent.user_id` is the loaded+validated row's OWN owner (declared after the `identity.forbidden → 403` check), so the filter is tautologically the owner on BOTH admin/service-role and non-admin paths — cannot mis-scope, cannot break a legit write. |
| **D9** | `{html}`-only send → BOTH `html` + non-empty `text` on Resend AND nodemailer | ✅ Pass | `emailTransport.test.ts`: Resend path — `body.html===HTML`, `body.text` non-empty, contains 'Calibration passed'; nodemailer path — `sendMail` arg carries both parts. `text: resolveText(p)` threaded into both providers (L115, L159). |
| **D9** | caller-supplied `text` honored; `htmlToText` doesn't throw on empty/odd HTML; zero `console.*` | ✅ Pass | "honors a caller-supplied text verbatim" → `body.text==='CUSTOM PLAINTEXT'`. `htmlToText('')→''` (guard `if(!html)return''`; regex replaces can't throw). Grep: **zero** `console.*` in `emailTransport.ts` — the SA must-fix (redundant `console.warn`) is removed; the Pino `logger.warn` remains. |
| **D10** | after a resolved hardcode, detection state CLEARS (fixed else-branch) | ✅ Pass | `deriveHardcodeState(empty/null) → { hasHardcodedValues:false, detectionResult:null }` (test); `loadAgent` routes detection through it (page L37-39) → clear-on-empty is now the default. |
| **D10** | `handleWizardComplete` clears the suggestion + shows `parameterizationSucceeded` | ✅ Pass | page: `setPassSuggestions([])` + `setDetectionResult(null)` + `setHasHardcodedValues(false)` + `setParameterizationSucceeded(true)`, threaded to `CalibrationSuccess`. |
| **D10** | banner non-blocking; NO regression to Group A A3-UI / finish / verdict | ✅ Pass | `CalibrationSuccess` D10 diff = 27 additive lines (banner only), **zero** `computeVerdict`/`canFinish`/`getPassSuggestions`/`deriveCoverage` references; page changes are state/display only. Verdict + finishGate logic untouched. |

### Regression
- **Group A / finishGate intact:** `computeVerdict` / `deriveCoverageSignal` / `canFinishCalibration` / `getPassSuggestions` untouched (grep-clean in the D8/D9/D10 diffs); the A3-UI suggestion card + finish flow still pass in the 243-green run.
- **Email senders + NotificationService:** the transport change is a backward-compatible optional `text?` field — callers unchanged, `resolveText` degrades gracefully (auto-generates when omitted). Both senders + NotificationService still send.

### Issues Found
#### Bugs
- **None.** No functional defect. The one SA must-fix (redundant `console.warn`) is applied and verified.

#### ⚠️ Commit-hygiene (BLOCKING for the commit, not a code defect)
The working tree carries **stash-pop / concurrent-team contamination that MUST be excluded** from this commit. RM must commit **ONLY these 9 D8/D9/D10 files:**
- `app/api/v2/calibrate/batch/route.ts`, `app/api/v2/calibrate/rollback/route.ts`
- `lib/notifications/emailTransport.ts`, `lib/notifications/__tests__/emailTransport.test.ts`
- `lib/calibration/hardcodeState.ts`, `lib/calibration/__tests__/hardcodeState.test.ts`
- `app/v2/sandbox/[agentId]/page.tsx`, `components/v2/calibration/CalibrationSuccess.tsx` (these two also carry the already-QA-PASSED Group A UI changes stacked underneath — acceptable)
- `docs/workplans/calibration-hardening-ux-hotfixes-d8-d9-d10-workplan.md`

**EXCLUDE (do NOT `git add -A`):** `package.json` + `package-lock.json` (removes `@playwright/test` — unrelated; D9 is dependency-free), the **deleted** `tests/admin-users.spec.ts` (removing test infra), `docs/v6/V6_OPEN_ITEMS.md`, `docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md`, `docs/workplans/WP63_FLATTEN_FIELD_SHAPE_FIDELITY_WORKPLAN.md` (concurrent WP63), `docs/requirements/V6_AI_DECLARED_TRANSFORM_SCHEMA_RECONCILIATION_REQUIREMENT.md`, `.claude/settings*.json`, `docs/architecture/`, `docs/requirements/ADMIN_AGENT_HEALTH_DASHBOARD_REQUIREMENT.md`.

### Test Outputs / Logs
```
lib/notifications + lib/calibration + lib/pilot/shadow → 25 suites / 243 tests passing
tsc: emailTransport.ts / hardcodeState.ts / batch route / rollback route / CalibrationSuccess.tsx — clean;
     only pre-existing page.tsx TS18047 (692/786); 0 new errors from D8/D9/D10.
D8 independent grep: 8 batch + 1 rollback + 1 apply-fixes agents-UPDATEs all owner-scoped; all other agents sites are reads.
emailTransport.ts console.*: 0 (SA must-fix applied).
```

### Final Status
- [x] D8 — all 9 calibrate-route `agents` writes owner-scoped (independently grep-verified none unscoped, incl. the previously-open L4673); additive, owner-tautological.
- [x] D9 — multipart on both Resend + nodemailer; caller-text honored; htmlToText empty-safe; zero console.*.
- [x] D10 — clear-on-empty helper + wizard-complete clears + success banner; no Group A regression.
- [x] Zero new tsc errors; new suites 9/9 (within the 243) green; verdict/finishGate untouched.

**Overall QA verdict: PASS.** D8 closes the calibrate-route `agents`-write owner-scoping class (nothing left unscoped); D9 sends proper multipart/alternative on both providers with the redundant console removed; D10 clears the stale hardcode state and confirms parameterization without touching the verdict/finish logic. No blocking bugs.

**Clean to commit: YES** — for the **9 D8/D9/D10 files ONLY**. Nothing at the code level blocks committing those 9. RM MUST exclude the contamination listed above (package.json/lock, the `admin-users.spec.ts` deletion, WP63 + requirement/OPEN_ITEMS/WEAK_POINTS docs, `.claude/settings`) — a blanket `git add -A` would remove test infrastructure and sweep in concurrent work. Nothing blocks the user's live 0ee53785 re-test.

## Commit Info
_(RM populates)_
