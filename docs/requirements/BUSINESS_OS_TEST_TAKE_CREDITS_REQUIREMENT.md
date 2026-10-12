# Requirement: Take credits from an account (test harness only)

> **Last Updated**: 2026-10-11

**Created by:** BA
**Date:** 2026-10-11
**Status:** TC-1 committed (`4bf75291`, merge of main `1d1f2051`) on `feature/test-harness-take-credits`, PR [#302](https://github.com/AgentsPilot/neuronforge/pull/302) open, awaiting the manual browser checks and the user's merge. SA code review APPROVED WITH FIXES (SF-1 fixed), QA PASS WITH NOTES. SA approved the requirement with conditions (C-1 to C-6) and Q-1 decided by the user, 2026-10-11. Workplan: [BUSINESS_OS_TEST_TAKE_CREDITS_WORKPLAN.md](/docs/workplans/BUSINESS_OS_TEST_TAKE_CREDITS_WORKPLAN.md)
**Worktree / branch:** `neuronforge-take-credits` / `feature/test-harness-take-credits`

## Overview

A platform admin can **take credits** from any Business OS account on the internal harness `/test-business-os`, so a tester can put an account into low, zero or over-plan credits and see how the product behaves. It is a **testing tool, not a product feature**. It is off by default, admin-only, audited, and built so that it can be deleted in one go. It reuses the existing credit ledger. It needs **no migration and no new table**.

---

## 1. What "take credits" means (the balance model, as built)

An account has two separate credit figures. They are never added together (S11-CR-3, boost R-5 (c)).

| Figure | Where it comes from | Existing admin tool |
|---|---|---|
| **Plan credits left** = plan allowance − credits used this period | `used` is the period total in `business_os_credit_totals`, written only through `business_os_record_credit_charge` | **None.** An admin cannot lower it today |
| **Extra credits** = what is left of the unexpired credit lots | `business_os_credit_lots` minus `business_os_credit_lot_draws` | "Give credits" and "Take back" on one lot, on `/admin/users` (slice 11b) |

Extra credits can already be taken back from `/admin/users`. The gap is the **plan** figure, which is the one the owner's card, its colour band and the low line read. So:

**Decision TC-1. "Take N credits" records one test charge of N credits on the credit ledger, through the existing `business_os_record_credit_charge` RPC.** The account's `used` goes up by N and its plan credits left go down by N, exactly as N credits of real use would. Extra credits are not touched. To lower those, use the existing Take back on `/admin/users`.

| Charge field | Value | Why |
|---|---|---|
| `service` | `test_harness` | Passes the format CHECK, which is not a closed list. Tells it apart from `ai` in every report |
| `action_type` | `test_take_credits` | Readable in the owner's credit history and in admin views |
| `triggered_by` | `external` | Counts as "automatic", so it never reads as the owner's own use |
| `outcome`, `cost_usd`, `is_fallback_priced` | `succeeded`, `0`, `false` | No money is involved, so finance totals in USD do not move |
| `action_id` = `group_id` | The request id the form mints once per opening | The RPC is idempotent on `action_id`: a double click records once |
| `credits` | A whole number from 1 to 100,000 | Reuses `ADMIN_CREDIT_GRANT_CEILING` |
| `credit_value_version` | `currentCreditValue().version` | As every charge does |

- **It can go below zero.** No check against what is left. The account shows as over plan, which is a real state that testers need. An account with no allowance (no plan row) is still accepted: the RPC uses the calendar month and the card shows usage only.
- **There is no undo.** The ledger is append-only and has no writer for adjustment rows. The way back is the next period reset, Give credits (extra credits only), or removing the test account (Danger Zone). The panel says this before the button.
- **Not fired:** the low-line event (`BOS_CREDIT_LOW_LINE_CROSSED`). It is emitted only by the AI charge recorder. Out of scope, see §6.

**Rejected alternatives.** (a) Lowering the allowance with an entitlement override already exists, but it changes the plan, not the balance, so it is not "taking credits". (b) A new test-adjustment table would need a migration, and every reader would have to learn it. (c) Drawing from lots only already exists and misses the plan figure.

---

## 2. Where it lives and who can use it

- **Decision TC-2. A new admin-only tab, "Test credits", on `/test-business-os`.** That page is the "business-os page … in the testing scope" the request refers to. The tab reuses the **LLM Usage `BusinessPicker`**: search by company name, or paste an account id.
- The panel has an amount field, a reason (3–500 characters, the same bounds as the lot reason) and a **Take credits** button with a confirm step ("This cannot be undone").
- Before and after the write, the panel shows the account's position through the **existing read-only** `GET /api/admin/business-os/credits/accounts/[accountId]`: allowance, used, plan left, over plan and extra credits. Nothing new is needed to read.
- **Admins only, enforced on the server** by `requireAdmin` (`admin_users`), never `profiles.role`. A non-admin sees "Admins only". Being an internal page is not the protection.
- **Refused targets** use the same codes as the slice 11 ops:
  - the platform account: 409 `platform_account`;
  - the admin's own account: 403 `own_account` (S11-BQ-1, see Q-2);
  - an account that is not a Business OS tenant: 404.

---

## 3. Endpoint decision

A browser page cannot write to the ledger without a server path. A "no endpoint" option does not exist. The real options:

| Option | For | Against |
|---|---|---|
| A. Add a `test_take_credits` op to the entitlements admin route | Reuses the gate, the own/platform/tenant checks and the audit plumbing | Puts a test-only op inside the production op union and its route, and is hard to remove cleanly later. It also breaks slice 11's rule G11b-2 ("no charge ledger write") inside the production path |
| B. A server action on the harness page | No `route.ts` | It is still an HTTP endpoint, only hidden. It is outside the required `requireAdmin` CI guard, which reads `route.ts` handlers, and it would be a new pattern in this repo (rule 7) |
| **C. A new small route, `POST /api/admin/business-os/test/take-credits`** | `requireAdmin` first, covered by the CI guard, follows the `new-api-route` skill, and deletes as one folder | One more route |

**Decision TC-3: option C.** It is behind a server switch, **`BUSINESS_OS_TEST_CREDIT_TOOLS_ENABLED`**. That is the Billing tab's precedent: set only in a developer's `.env.local`, never on Vercel. With the switch off, the route answers 404 and the tab shows "Not enabled on this deployment". A non-production check is **not** used: the developer environment points at the one live database, so such a check would block the tool everywhere testers need it.

**Future use: none foreseen.** Taking back credits an admin gave is already covered (lot Take back). Charging an account by hand has no business case, so the route stays test-only and is marked "TEST ONLY — remove with the harness tab" in its header.

Order inside the route: `requireAdmin` → switch (404) → Zod `.strict()` body `{ accountId, amount, reason, requestId }` → lower-case the id and resolve it through the account seam → platform 409 → own account 403 → tenant 404 → write → audit (flushed) → 200 `{ credits, periodStart, recorded }`. The account comes from the validated body and is checked as above (tenant-isolation-guard). The write goes through `BusinessOsCreditChargeRepository.recordCharge`, so no direct Supabase call is made.

---

## 4. Audit

| | |
|---|---|
| Event | **`BOS_TEST_CREDITS_TAKEN`** (new, registered in `lib/audit/events.ts`) |
| Severity / flags | `warning`, `SOC2`. The same as `BOS_CREDIT_LOT_REDUCED`: an admin changed what an account can spend |
| Entity | `business_os_credit_period`, id = the account. This is an **existing operator-only type** (BD-26), so the owner never reads it and **no owner-policy migration is needed** |
| User / actor | user = the target account; actor = the admin |
| Details | `credits`, `reason`, `actionId`, `periodStart`, `anchorSource`, `service: 'test_harness'`, `testOnly: true`, `correlationId` |
| When | Only after the RPC answers `recorded: true`, then flushed before the response (WC-7). A replay (`recorded: false`) and a refusal write no entry. They are logged only, matching the precedents in slice 11b and P-3a |

The charge row is itself the permanent record: append-only, with its id and time. The audit entry adds who did it and why.

---

## 5. Acceptance criteria

- [ ] AC-1: An admin takes 50 credits from a test account. Its plan credits left on the owner's card fall by exactly 50, its extra credits do not change, and the owner's credit history shows one "Other activity" line (automatic). The `test_take_credits` action type is visible in admin views only (SA C-6).
- [ ] AC-2: Taking more than is left succeeds, and the account shows as over plan.
- [ ] AC-3: The same request id sent twice records one charge and one audit entry.
- [ ] AC-4: Exactly one `BOS_TEST_CREDITS_TAKEN` entry, with severity warning, on entity `business_os_credit_period`. It is visible in the admin audit trail and **not** in the owner's own audit view.
- [ ] AC-5: Refusals. Signed out: 401. Non-admin: 403 (the tab shows "Admins only"). Switch off: 404. Platform account: 409. Own account: 403. Not a tenant: 404. Amount 0, a fraction or over 100,000, a short reason, or an extra key: 400. None of these writes a charge or an audit entry.
- [ ] AC-6: Route integration test covering the happy path, the auth failure and invalid input (CLAUDE.md testing rule). QA records a manual run of AC-1 to AC-4.
- [ ] AC-7: Docs updated: a "Test credits" section in `BUSINESS_OS_TEST_PAGE_SCOPE.md`, and the switch in `feature_flags.md`.

---

## 6. Out of scope

- Any production (non-test) way to lower plan credits, and any owner-facing change.
- An undo, or any writer for `adjustment` rows.
- Taking extra credits (lot Take back already exists on `/admin/users`), and choosing which bucket is spent first. That is enforcement, slice 9.
- Firing the low-line event, and blocking usage at zero (slice 9, not built).
- Bulk or multi-account takes; a migration, a new table or a new entity type.

---

## 7. Slicing

**One slice, TC-1: "Test harness: take credits".** It covers the route, the switch, the audit registration, the tab with the picker reused, the tests and the docs. No migration. It is expected to take a couple of days.

**SA must rule on these points before the workplan:**
1. Widening the charge repository's sole-caller source guard, which today allows only `aiChargeRecorder`, to this one route.
2. Registering the route as an importer of `currentCreditValue` (entitlements-registration skill).
3. Dev lists every reader of `business_os_credit_charges` and states how a `test_harness` row appears in each. The likely readers are the admin AI activity view, the credit report, the leak check and the finance health page. Any reader that **errors** on it blocks the slice; one that just shows it is acceptable.

---

## Open Questions

- [x] **Q-1 (business, raised by BA, status: DECIDED 2026-10-11 by the user — allow any account, no test-tag refusal).** Should the tool refuse any account that is not a test account (email contains the test tag, the Danger Zone rule)? Testing runs against the live database, so a mistyped pick could charge a real customer, with no undo. **BA suggestion: no.** It stays admin-only, switched off on Vercel, with a confirm step. Say "yes" if real customers are at risk.
- [ ] **Q-2 (raised by BA, status: decided, the user may flip it).** The admin's own account is refused, the same as Give credits and Take back (S11-BQ-1). Test from a separate test account.

## Notes on Integration Points

- Writes: `business_os_credit_charges` and `business_os_credit_totals`, through the RPC only (via `BusinessOsCreditChargeRepository`).
- Reads reused: `GET /api/admin/business-os/credits/accounts/[accountId]`, the LLM Usage `BusinessPicker`, and `isBusinessOsTenant`.
- Audit: `lib/audit/events.ts`, plus whatever registries the audit tests force (`eventAudience`, `filterOptions`, `ownerEventPresentation`). `ownerVisibility.ts` is unchanged, apart from its comment.
- Related: [credit deduction requirement](/docs/requirements/BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md) slice 11, [slice 11 workplan](/docs/workplans/BUSINESS_OS_CREDIT_DEDUCTION_SLICE_11_WORKPLAN.md), [test page scope](/docs/BUSINESS_OS_TEST_PAGE_SCOPE.md).

---

## SA Review Notes

**Reviewed by SA — 2026-10-11**
**Status:** APPROVED WITH CONDITIONS (C-1 to C-6). One slice, as scoped. No migration.

### Rulings on the three BA points

1. **Charge-repository sole-caller guard: widen it.** The guard (`lib/repositories/__tests__/BusinessOsCreditChargeRepository.test.ts`, `ALLOWED`) was designed for this: "adding a file here is where someone states, in a reviewable diff, what else starts writing the ledger." Add exactly the route file and its test, under a comment "TEST ONLY: remove with the harness tab". The repository header ("the only caller") must be updated in the same diff. No other new writer.
2. **Entitlements registration: yes, as a non-gate.** The route imports `currentCreditValue`, `isBusinessOsTenant` and `resolveAccountId` from the module. It refuses by tenancy and identity, never by plan, so it goes in `KNOWN_NON_GATE_IMPORTERS` with `symbols` matching the imports exactly and a `why` naming this slice (precedent: the 11c credit view entry). Same for any helper file the Dev adds that imports the module.
3. **Ledger readers, verified in code.** None errors. One gives a false alarm (C-1):

| Reader | How a `test_harness` / `test_take_credits` / $0 row shows | Verdict |
|---|---|---|
| Leak check (`creditLeakCheck.ts`, nightly + admin) | Charge side skips any effective service other than `ai`. The tool writes no `token_usage` row, so no group, no ungrouped call. An account with no plan is only counted in `listing.chargedWithoutPlan` (informational) | OK, no alert |
| Admin AI Activity list + drill-down (`aiActivity.ts`, `aiActivityDrillDown.ts`) | Listed as an "AI action": area null, $0, N credits, trigger external. **`joinAuditEntries` finds no AI audit entry and, after 15 min, classifies it `lost`**, counted in `noEntry.lost`. The file's own NON-AI TRIPWIRE (SA-R5) says an effective-service rule is needed before any non-AI service writes charges | **C-1** |
| Credit report (`creditReport.ts`) | Own `byService` line `test_harness`, area null. Stored-vs-rebuilt check still matches: the RPC writes both rows atomically | OK, correctly attributed |
| Finance health §3 (`finance/aiCost.ts`) | USD unchanged. Credits, `chargedActions` and the external bucket rise by N | Accepted (C-5 documents it) |
| Owner card (`ownerCreditUsage.ts`, totals) | Used +N, automatic +N | Intended (TC-1) |
| Owner history (`ownerCreditHistory.ts`) | `diaryLabelFor` returns null for a non-AI service, so the line reads **"Other activity"**, who = automatic. It does not read `test_take_credits` | OK. AC-1 wording fixed by C-6 |
| Low line (`creditLowLine.ts`) | Not called. The next real AI charge starts from below the line, so no event fires for that period | Accepted (§6) |
| Admin credit position / percent | Reads totals: plan left falls by N | Intended |
| Purge / deletion / test-account cleanup | Table already handled (`never` purged; cleanup SQL covers it) | OK |

### Other checks

- **Schema (migration `20261015`, no later migration alters the table or the RPC).** `service` and `action_type` are format CHECKs, not closed lists: `test_harness` and `test_take_credits` pass. `triggered_by IN ('owner','scheduled','external')`: `external` passes. `charge_shape` needs non-null action/group id, service, action type, trigger, outcome and `credits >= 0`, `cost_usd >= 0`: all satisfied. `action_id` and `group_id` are `uuid`, so `requestId` must be a Zod `.uuid()`. No live check needed.
- **Idempotency.** `action_id` is unique across all accounts. A reused request id against another account returns `recorded: false` and writes nothing. That is safe. The response must say "already recorded", never "taken".
- **requireAdmin guard.** A new `app/api/admin/**/route.ts` with `requireAdmin` as the first statement passes `admin-authz-surface.guard` as it is. No allow-list edit.
- **Switch.** Follow the `planCheckoutFlag.ts` precedent: its own server-only flag file, `parseBooleanFlag(..., false)`, reader named `isTestCreditToolsEnabled()` (never `use…`).
- **Audit.** Register `BOS_TEST_CREDITS_TAKEN` in `events.ts` (constant + metadata) and `eventAudience.ts` (`'bos'`), and wherever the audit tests require. The entity type is already `operator` in `ownerVisibility.ts`, so it stays hidden from the owner.
- **CLAUDE.md rules 1–6.** Rule 1: the write goes through the repository. The read is the existing GET route. Rule 2: Zod `.strict()`. Rule 3: Pino + `correlationId`. Rule 4: the RPC scopes the write by `p_user_id`, and service role is already documented in the repository. Rule 5: no LLM. Rule 6: no `any`. All met by the design.

### Conditions

- **C-1 (required): AI Activity tripwire.** In `joinAuditEntries` (shared by the list and the drill-down), a row whose effective service (via `resolveEffectiveFields`) is not `AI_CHARGE_SERVICE` gets a distinct state, for example `{ state: 'not_applicable' }`, with a short UI label ("Not an AI action"). It is never counted in `noEntry.lost`. Update the NON-AI TRIPWIRE comment and add one unit test. Do not filter on the raw `service` column (`serviceColumn.guard`), and do not hardcode `test_take_credits`. The rule is generic.
- **C-2: reuse, do not re-implement.** Use `refuseCreditOpForPlatformAccount`, `ADMIN_CREDIT_GRANT_CEILING`, `CREDIT_REASON_MIN`/`MAX` (`creditAdminOps.ts`), the existing own-account check pattern and `isBusinessOsTenant`. No new repository and no new read route.
- **C-3: 404 codes the panel can tell apart.** Switch off → `{ error: 'not_enabled' }`; not a tenant → `{ error: 'not_a_tenant' }`. Only `not_enabled` shows "Not enabled on this deployment".
- **C-4: the guards in the same diff.** The charge-repository `ALLOWED` list (route + route test) and the `KNOWN_NON_GATE_IMPORTERS` entry. Run `npm test -- lib/repositories lib/business-os/entitlements lib/business-os/credits lib/audit lib/admin` before review.
- **C-5: docs (extends AC-7).** The test-page scope doc states that test charges land in the live ledger and show in the credit report (`test_harness`), in Finance health credits (not USD) and as "Other activity" in the owner's history.
- **C-6: AC-1 wording.** The owner's history shows the line as "Other activity" (automatic), not `test_take_credits`. The `test_take_credits` action type is visible in admin views only.

**Q-1 (SA view, still the user's call):** no TS test-account predicate exists to reuse (the Danger Zone rule is SQL-side), so a hard refusal would be new code. The BA default (no hard guard) is acceptable for an admin-only tool that is off on Vercel, provided the confirm step shows the target's company name and account id.

### Approval
[x] Requirement approved with C-1 to C-6. Dev may write the workplan. SA re-checks C-1 at code review.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-12 | Live test + follow-ups | Live take verified in DB on Peak Form Fitness (20,000 credits, one charge row, one BOS_TEST_CREDITS_TAKEN audit row, totals moved by exactly 20,000). Harness buttons restyled (shared `harnessButton`, SA APPROVED, PR #311). **Deferred (user decision):** show account email in the business picker. It needs a service_role-only lookup function (migration applied by hand), so it ships as its own small slice later; per-row auth lookups (N+1) were rejected |
| 2026-10-11 | TC-1 committed + PR (RM) | Commit `4bf75291` (feature + docs), merge of latest main `1d1f2051` (trivial Change History conflict in `BUSINESS_OS_TEST_PAGE_SCOPE.md`, both rows kept). PR [#302](https://github.com/AgentsPilot/neuronforge/pull/302) to main. SA APPROVED WITH FIXES (SF-1 fixed), QA PASS WITH NOTES; manual browser checks owed (checklist in the PR). No migration |
| 2026-10-11 | TC-1 implemented (Dev) | Route, switch, audit event, harness tab, C-1 tripwire (`not_applicable` entry state), guards (charge-repo `ALLOWED`, `KNOWN_NON_GATE_IMPORTERS`) and docs. Uncommitted, awaiting SA code review. Confirm step shows the company name and the account id (Q-1) |
| 2026-10-11 | Q-1 decided (user) | Allow any account; no test-tag refusal. Confirm step shows company name + account id (SA) |
| 2026-10-11 | SA review | APPROVED WITH CONDITIONS C-1 to C-6. Ruled on the 3 BA points: widen the charge-repo guard to the route; register it as a non-gate entitlements importer; ledger readers verified in code. None errors. AI Activity would show the test row's audit as "lost" (C-1). Schema CHECKs accept the values |
| 2026-10-11 | Initial draft (BA) | Scoped the test-only "take credits" tool. It is a test charge on the existing ledger (plan credits), through a new switched-off admin route and a harness tab. A new audit event on an existing operator-only entity. No migration. One slice. Q-1 is open for the user |
