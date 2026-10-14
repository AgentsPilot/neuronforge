# Implementation Notes: Plan Payments P-5b.2 "Who sees the payment"

> **Last Updated**: 2026-10-14

## Overview

Dev's implementation notes for **P-5b.2**, the second half of P-5b (T5 to T7 and its shares of T8 to T11), built against the SA-approved [P-5b workplan](https://github.com/AgentsPilot/neuronforge/blob/feature/bos-plan-payments-p5b/docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P5B_WORKPLAN.md) (SA Review Notes C-1 to C-12, Q-1 to Q-12, split). The workplan itself lives on `feature/bos-plan-payments-p5b` (P-5b.1, [PR #359](https://github.com/AgentsPilot/neuronforge/pull/359), not merged); this separate file avoids a conflict with that PR's copy of the workplan. When both PRs have merged, these notes can be folded into the workplan's Implementation Notes.

**Developer:** Dev
**Requirement:** [BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md) §9.1 P-5b row (FR-25, FR-31, AC-F2.2, AC-F2.10, SA-P18, T-9, P5-C9, P5-C10, S5-8)
**Branch:** `feature/bos-plan-payments-p5b2`, worktree `neuronforge-invite-s1`, fresh from `origin/main` `d769b9e3`. Confirmed with `git branch --show-current` on 2026-10-14. It does **not** contain P-5b.1.
**Status:** Code Complete, uncommitted, awaiting SA code review.

## Table of Contents

1. [Day-1 checks](#1-day-1-checks)
2. [What was built](#2-what-was-built)
3. [The shared subscribed lines (SA C-1)](#3-the-shared-subscribed-lines-sa-c-1)
4. [Conditions](#4-conditions)
5. [Guards (T8 share)](#5-guards-t8-share)
6. [Tests](#6-tests)
7. [Checks (T9 share)](#7-checks-t9-share)
8. [Deviations for SA](#8-deviations-for-sa)
9. [Merge notes for RM](#9-merge-notes-for-rm)
10. [Demo (T10 share)](#10-demo-t10-share)
11. [SA Code Review — P-5b.2 (2026-10-14)](#sa-code-review--p-5b2-2026-10-14)
12. [QA Testing Report — P-5b.2 (2026-10-14)](#qa-testing-report--p-5b2-2026-10-14)
13. [Demo run-sheet D1 to D4 (read-only)](#demo-run-sheet-d1-to-d4-read-only)
14. [Change History](#change-history)

---

## 1. Day-1 checks

| Check | Result |
|---|---|
| Branch | `feature/bos-plan-payments-p5b2`, from `origin/main` `d769b9e3` |
| Migrations | None added. Highest on `origin/main`: `20261058` |
| Schema (`business-os-schema-check`) | Verified from migrations: `business_os_account_lineage` `source` (20261014), `parent_account_id` (20261014), `first_paid_at` and `first_payment_ref` (20261024, paired CHECK); `business_os_billing_events` `user_id` (ON DELETE SET NULL), `kind`, `stripe_invoice_id`, `amount_minor`, `amount_tax_minor`, `currency` (CHECK `usd`), `paid_at`, `livemode`, partial UNIQUE `(stripe_invoice_id) WHERE kind = 'invoice_paid'` (20261027); `service_role` SELECT on both; `business_os_invites.grant_kind` (20261012/20261014) |
| `console.*` scan | 0 in every touched source file |

---

## 2. What was built

| Task | Files | Notes |
|---|---|---|
| T5 champion "Subscribed" | `lib/repositories/BusinessOsAccountLineageRepository.ts` (`findSubscribedInviteIdsForIssuer`), `lib/business-os/invites/friendInviteOps.ts`, `friendInviteDeps.ts`, `app/api/business-os/friend-invites/route.ts` | One read per list, only for accepted rows. Scoped twice: `parent_account_id` = the session account, and invite ids from the issuer-scoped list; friend rows (`source = 'account_invite'`) with `first_paid_at` set. Returns invite ids only. `friendInviteStatus(row, now, subscribed)` upgrades only an `accepted` invite. A failed read leaves the rows `joined` and logs `bos_invite_list_subscribed_unread`. View keys unchanged (status only, P5-C9). The port is optional; the route wires it |
| T6 admin paid line | `lib/repositories/BusinessOsBillingEventRepository.ts` (`findPaidInvoicesForAccounts`), lineage `findByInviteIdsForAdmin` widened (+ `source, first_paid_at, first_payment_ref`), `lib/repositories/types.ts`, `lib/business-os/invites/adminInviteOps.ts`, `app/api/admin/business-os/invites/route.ts`, `app/admin/business-os-invites/types.ts`, `components/InviteList.tsx` | `InviteListView.payment: InvitePaymentView \| null` (allow-listed key). Pairs only from lineage rows (`account_id`, `first_payment_ref`), batches of 200. The repository narrows by both id lists and **keeps a row only when its own (account, invoice) equals a requested pair** (C-11). `awaiting_payment` from `isAwaitingPayment(lineage, row.grant_kind)` with no extra read. `paid_recorded` carries date and amount from the money history only (AC-F2.2). `paid_record_missing` (Q-8, warn with ids). `unknown` on a failed read. Screen: StatusChips under the State chip (L-6): "Paid" + `YYYY-MM-DD · $79.00 USD`, "Test payment" (neutral) when `livemode` is false (Q-12), "Signed up, not paid" (warn), "Paid, record not found" (warn), "Payment unknown" (neutral). English (Q-7) |
| T7 reports | `lib/business-os/invites/paymentHoldBatch.ts` (new), lineage `findHoldFactsForAccountsForAdmin`, invite `findGrantKindsByIdsForAdmin`, `lib/business-os/entitlements/report.ts`, `app/api/admin/business-os/entitlements/shadow-report/route.ts`, `.../launch/route.ts` | `readAwaitingPaymentAccounts(ids, readers)`: lineage in batches of 200, grant kinds in batches of 200 and only for unpaid `admin_invite` rows, `isAwaitingPayment` per row; any failed batch or throw is `{ ok: false }`. Report: `static.awaitingPayment { scanFailed, count, accountIds (≤200), truncated }`; held `no_assignment` anomalies move there (Q-9); `byState`, `accountsScanned` untouched (C-9); a failed or unwired read keeps every anomaly and sets `scanFailed: true`, `count: null`. Dry run: per page, held would-be champions are counted in `awaitingPayment` and sampled in `awaitingPaymentSample` (≤20), excluded from `wouldBecomeChampion`; a failed read keeps them counted and sets `holdScanFailed` with an `error` log (Q-10). Audit details gain `awaitingPayment` and `holdScanFailed` (counts only) |

New log events: `bos_invite_list_subscribed_unread` (warn), `bos_invite_admin_payment_unread` (warn), `bos_invite_admin_payment_record_missing` (warn), `bos_entitlements_report_hold_scan_failed` (error), `bos_entitlements_launch_hold_scan_failed` (error). Ids and counts only, never an amount or an address.

---

## 3. The shared subscribed lines (SA C-1)

P-5b.1 (#359) adds the `'subscribed'` status type and its user-approved words. This branch carries **exactly the same hunks**, applied byte-for-byte from `git diff origin/main...origin/feature/bos-plan-payments-p5b` and verified identical (the `+`/`-` lines of both diffs compared with `diff`), so whichever PR merges second sees the same change on both sides:

| File | Shared lines |
|---|---|
| `components/business-os/settings/inviteFriendsCopy.ts` | The 5 comment lines added under the `joined` note (`` `subscribed` (plan payments P-5b, FR-31, SA C-1) = the friend paid their … The list starts showing it with P-5b.2. ``); the type line `export type InviteFriendsStatus = 'pending' \| 'expired' \| 'revoked' \| 'joined' \| 'subscribed';`; the three `status:` lines gaining `subscribed: 'Subscribed'` (en), `subscribed: 'נרשם למנוי'` (he), `subscribed: 'Suscrito'` (es) |
| `lib/business-os/invites/friendInviteOps.ts` | The 4 comment lines added to the `FriendInviteStatus` doc (`` `subscribed` (plan payments P-5b, FR-31, SA C-1): the friend paid. … from an issuer-scoped lineage read. ``) and the type line `export type FriendInviteStatus = 'pending' \| 'expired' \| 'revoked' \| 'joined' \| 'subscribed';` |

P-5b.2's own edits in `friendInviteOps.ts` start at `friendInviteStatus(` (five unchanged lines below the shared hunk), so the two hunks do not touch.

---

## 4. Conditions

| Condition | Where | Pinned by |
|---|---|---|
| P5-C9 (requireAdmin first; service role documented; batched) | All three admin routes keep `requireAdmin` as the first statement; every new method's doc says `INTENTIONAL SERVICE-ROLE` and names its caller; one read per list / per page / per 200 | `BusinessOsPaymentVisibilityReads.test.ts` (C-7 block, requireAdmin-first check), route tests (non-admin reaches no read) |
| P5-C10 (batched, never `readPaymentHold` per account) | `paymentHoldBatch.ts` | `paymentHoldBatch.test.ts` (parity table with `readPaymentHold`, batches 200/200/50, invite read only for unpaid admin rows); caller guard: no `readPaymentHold(` in the helper, the report or the launch route |
| C-7 (caller guard + service-role comment per new method) | Method docs and repository headers | `BusinessOsPaymentVisibilityReads.test.ts`: `findPaidInvoicesForAccounts` called only by `adminInviteOps.ts`, whose list op is reached only from the admin invites route; `findSubscribedInviteIdsForIssuer` only from `friendInviteOps.ts`; the two batched reads only from `paymentHoldBatch.ts`; `readAwaitingPaymentAccounts` only from `report.ts` and the launch route. The money-history repository's own caller list gains the admin route, its test and the new test file |
| C-8 (invite modules import nothing from the entitlements module) | `paymentHoldBatch.ts` imports repository TYPES and `paymentHold.ts` only | `paymentHoldBatch.test.ts` "SA C-8"; `npm run test:bos-entitlements` green; `KNOWN_NON_GATE_IMPORTERS` unchanged (no new importer of the module) |
| C-9 (totals add up; report suites never reach the DB) | `report.ts` has **no default** hold readers; only the shadow-report route passes them | `report.awaitingPayment.test.ts` (totals reconcile; failed and unwired read keep anomalies; the lineage and invite repository modules are mocked to throw if reached). The older suites (`report.test.ts`, `dormantChampions.test.ts`, `planActive.noEffect.test.ts`, `shadow.test.ts`) pass no readers, so they cannot reach a repository: unedited and green |
| C-11 (pair from lineage; shape-checked; both-match filter in the repository) | `findPaidInvoicesForAccounts` | Mutation test: two accounts with swapped refs see neither payment; malformed ids never reach the query; > 200 pairs refused; ops test: pairs come from lineage, never the invite row's account |
| C-12 (`git diff --stat`) | §7 | No file with deletions and no insertions |
| Q-7 / Q-8 / Q-9 / Q-10 / Q-12 | §2 | Render, ops, report and route tests |

---

## 5. Guards (T8 share)

| Guard | Change |
|---|---|
| `lib/business-os/billing/__tests__/firstPaymentStamp.guard.test.ts` | The stamp-column readers list gains `adminInviteOps.ts` and `paymentHoldBatch.ts`; both are added to the "no write call, no RPC" check. (The money-history repository's comment was reworded so it does not name the column.) |
| `lib/repositories/__tests__/BusinessOsBillingEventRepository.test.ts` | Caller list gains `app/api/admin/business-os/invites/route.ts`, its `__tests__/route.test.ts` (mocks the singleton) and `lib/repositories/__tests__/BusinessOsPaymentVisibilityReads.test.ts` |
| `lib/repositories/__tests__/BusinessOsInviteRepository.test.ts` | Method list gains `findGrantKindsByIdsForAdmin` |
| `lib/repositories/__tests__/BusinessOsAccountLineageRepository.test.ts` | The widened select; four reads, still no writer |
| New `lib/repositories/__tests__/BusinessOsPaymentVisibilityReads.test.ts` | C-7 single-caller guards and service-role doc checks for the four new reads |
| Entitlements registration | `npm run test:bos-entitlements` green; no new importer of `lib/business-os/entitlements/` (`report.ts` imports OUT of the module) |

---

## 6. Tests

| Suite | New tests | Pins |
|---|---|---|
| new `lib/repositories/__tests__/BusinessOsPaymentVisibilityReads.test.ts` | 33 | The four reads' exact query chains; S5-8 mutation (swapped refs → neither shown); refusals before any query; unreadable money row is an error; M-1 scrubbing; C-7 callers and docs; requireAdmin first in the three routes |
| new `lib/business-os/invites/__tests__/paymentHoldBatch.test.ts` | 19 | Parity with `readPaymentHold` over nine lineage cases; batches; R-3 short circuit; failures; C-8 |
| new `lib/business-os/entitlements/__tests__/report.awaitingPayment.test.ts` | 9 | The move; C-9 reconciliation; one batched read; no candidate no read; cap and truncated; failed and unwired reads; RC-16 shape |
| new `app/admin/business-os-invites/__tests__/invites.paymentLine.render.test.tsx` | 9 | Every chip, tone and text; "$1,234.56 USD"; older server and non-accepted rows show nothing; the line sits in the State cell |
| `lib/business-os/invites/__tests__/adminInviteOps.test.ts` | +15 | Every payment state; money from history not lineage; pair only from lineage; batches; failed lineage and money reads |
| `lib/business-os/invites/__tests__/friendInviteOps.test.ts` | +9 | `subscribed` only upgrades accepted; view keys unchanged; one scoped read; failed and unwired read keep `joined` |
| `app/api/admin/business-os/entitlements/__tests__/routes.test.ts` | +5 | Dry run: held counted apart, one batched read per page, audit counts only and flushed; failed read keeps the upper bound; report through the route; non-admin reaches no read |
| `app/api/admin/business-os/invites/__tests__/route.test.ts` | +3 | Paid and held rows through the route; non-admin reaches no money read; failed money read → unknown |
| `app/api/business-os/friend-invites/__tests__/route.test.ts` | +2 | Subscribed through the route for the session account only; 401 reads nothing |
| `components/business-os/settings/__tests__/InviteFriendsSection.render.test.tsx` | +3 | "Subscribed" × en/he/es (Hebrew right to left), no Revoke, no amount |

---

## 7. Checks (T9 share)

| Command | Result |
|---|---|
| `npx jest lib/business-os/invites app/api/admin/business-os/invites app/admin/business-os-invites app/api/business-os/friend-invites app/api/admin/business-os/entitlements components/business-os/settings lib/repositories/__tests__ lib/business-os/entitlements lib/business-os/billing lib/business-os/finance app/api/stripe lib/audit --ci` | **242 suites, 9 636 tests, all passed** (107 of them new for P-5b.2) |
| `npm run test:bos-entitlements` (G-4) | **257 suites, 7 449 tests, all passed** |
| `npm run typecheck:bos-llm` | **passed**, 519 files in scope, 0 new errors (it again reports the unrelated `app/api/onboarding/build/route.ts` TS18047 baseline entry as fixed; left alone) |
| `tsc --noEmit -p tsconfig.json` (12 GB heap) | 1 917 errors repo-wide, all pre-existing (the same count P-5b.1 recorded); **0 in any touched or new file** |
| `eslint` on every touched file | 0 errors; 1 warning on a pre-existing line (`lib/repositories/types.ts:436`, `any`) |
| `npm run lint:hooks` | passed |
| `git diff --stat` (C-12) | 26 tracked files, 1 381 insertions, 35 deletions; **no file with deletions and no insertions** (the 35 are replaced lines: the shared `subscribed` lines, the widened lineage select, guard lists, the dry-run loop). 6 new files (1 source `paymentHoldBatch.ts`, this notes file, 4 tests) |

---

## 8. Deviations for SA

| # | Deviation | Why |
|---|---|---|
| DV-1 | The paid state is `'paid_recorded'`, not `'paid'` | The admin page's source guard forbids the literal `'paid'` (it is a plan/invite id there). Renaming the state keeps the guard intact; the screen still reads "Paid" |
| DV-2 | `ShadowReportOptions.holdReaders` has **no default**; the shadow-report route injects the singletons | C-9 made structural: no report suite can reach a repository, without editing them. A caller that forgets the readers gets `scanFailed: true` and its anomalies untouched (the safe side), plus an `error` log with `wired: false` |
| DV-3 | C-8's "imports nothing from the entitlements module" for `paymentHoldBatch.ts` lives in `paymentHoldBatch.test.ts`, not in `paymentHold.test.ts`'s list | #359 restructures that exact `it.each` list; adding to it here would guarantee a merge conflict |
| DV-4 | A stamped accepted account shows "Paid" even when it is not a paid-invite account (for example an L1 champion who later subscribed) | The stamp is a fact and the money row is matched the same way; hiding it would need a rule the workplan does not state. "Absent" stays for an unstamped, unheld account |
| DV-5 | Only `no_assignment` anomalies are classified and moved | That is what a held friend's basis-less plan row reads as; any other anomaly on a held account is a real one and stays listed |
| DV-6 | `findPaidInvoicesForAccounts` drops malformed pairs before the query (counted in a warn) instead of refusing the whole call; more than 200 is still refused | One bad ref would otherwise blank the whole page to "unknown"; a malformed ref cannot match a money row, so its row reads "Paid, record not found", which is true |
| DV-7 | The admin list op takes the money-history read as a structural port (`PaidInvoiceReader`) | So `adminInviteOps.ts` never names the money-history repository, and that repository's caller list gains only the wiring route (C-7) |
| DV-8 | Caller guards (C-7) in a new `BusinessOsPaymentVisibilityReads.test.ts` rather than spread over each repository's test | #359 edits the same repository tests; one new file keeps both PRs mergeable |
| DV-9 | `BusinessOsAccountLineageLevel` gains three **required** fields; three older lineage fakes in `adminInviteOps.test.ts` gained them (typing only, no assertion changed) | The repository always selects them now |
| DV-10 | A failed lineage read makes an accepted row's payment `unknown`; no lineage port at all gives `null` (nothing shown) | "Unknown" when we tried and failed; nothing when the caller did not ask, like an older server |
| DV-11 | Dry run `awaitingPayment` counts only pages that classified; with `holdScanFailed` it is a lower bound while `wouldBecomeChampion` is an upper bound | Q-10 as ruled; documented on the response field |

---

## 9. Merge notes for RM

- **Not stacked** on #359. Whichever merges second: the shared `subscribed` hunks (§3) are identical on both sides.
- **Expected textual conflict:** `docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md` line 349 (the §9.1 P-5b row): both PRs append a status sentence to it. Resolve by keeping both sentences. The Change History rows sit in different places and should merge.
- Other files both PRs touch, in separate regions: `lib/repositories/types.ts`, `lib/repositories/BusinessOsAccountLineageRepository.ts`, `lib/repositories/BusinessOsInviteRepository.ts`, `lib/repositories/__tests__/BusinessOsInviteRepository.test.ts`, `lib/repositories/__tests__/BusinessOsBillingEventRepository.test.ts`, `lib/business-os/billing/__tests__/firstPaymentStamp.guard.test.ts`.
- No migration.

---

## 10. Demo (T10 share)

Owed, needs the user (workplan §8): **D1** champion list reads "Signed up — not subscribed yet" (Hebrew) for a fresh held friend; **D2** `/admin/business-os-invites` shows that row Accepted, L2, "Signed up, not paid"; **D3** `GET …/entitlements/shadow-report` lists the friend's account under `static.awaitingPayment`, not in `anomalies`; **D4** `POST …/entitlements/launch` (`dryRun: true`) counts the friend in `awaitingPayment`, not in `wouldBecomeChampion`. D9 to D11 come with P-5b.1's payment demo. All read-only; no switch flip, no Stripe.

---

## SA Code Review — P-5b.2 (2026-10-14)

**Code Review by SA — 2026-10-14**
**Status:** ✅ APPROVED WITH FIXES (F-1, applied by SA; no re-review needed)

### What SA ran (not taken from §7)

| Check | Result |
|---|---|
| Affected suites: `BusinessOsPaymentVisibilityReads`, `lib/business-os/invites`, `lib/business-os/entitlements`, admin invites route + page, friend-invites route, entitlements routes, `components/business-os/settings`, the lineage / billing-event / invite repository tests, `firstPaymentStamp.guard` | **80 suites, 2 834 tests, all passed** |
| `npm run test:bos-entitlements` | **257 suites, 7 449 tests, all passed**; no new importer of the module |
| After F-1: `BusinessOsPaymentVisibilityReads` + `BusinessOsBillingEventRepository` tests | 101 passed |
| `git diff --stat` (C-12) | No file with deletions and no insertions |
| `console.*` in touched/new source files | 0 |
| `main` drift | `origin/main` moved `d769b9e3` → `59d97d7b`; none of the 26 touched files changed there |
| Production callers | `buildShadowReport`: only the shadow-report route (wires `holdReaders`). `readAwaitingPaymentAccounts`: `report.ts` and the launch route. `listInvitesForAdmin`: only the admin invites route (wires `billingEvents`). `getFriendInviteSummary`: only the friend-invites route (wires `lineage`). No script calls any of them |
| C-1 byte check | `git diff origin/main...origin/feature/bos-plan-payments-p5b` vs this branch's `git diff origin/main`, `+`/`-` lines only: `inviteFriendsCopy.ts` **identical** (13 lines); `friendInviteOps.ts` #359's 6 lines appear identically and in order, everything else on this branch is P-5b.2's own (import, `friendInviteStatus(` onward) |
| Schema (`business-os-schema-check`, from migrations) | `business_os_billing_events.livemode` / `amount_tax_minor` / `paid_at` (20261027); lineage `first_paid_at` + paired CHECK (20261024); `source`, `parent_account_id` (20261014). Confirmed |

### Mutation checks (one at a time; each restored by re-edit, all seven files md5-verified identical to the pre-mutation hashes)

| # | Mutation | Killed by |
|---|---|---|
| M1 | Money read: per-pair `(user_id, stripe_invoice_id)` filter removed (C-11 / S5-8) | 2 tests in `BusinessOsPaymentVisibilityReads` (swapped refs; one crossed pair) |
| M2 | Champion read: `.eq('parent_account_id', issuer)` removed (T5 scope) | 1 test (exact query chain) |
| M3 | Report: failed hold scan drops `no_assignment` anomalies | 4 tests in `report.awaitingPayment` |
| M4 | Batch helper: failed grant-kind batch skipped instead of `{ ok: false }` | 1 test in `paymentHoldBatch` |
| M5 | Launch dry run: failed classification treated as held (understatement) | 1 test in the entitlements routes suite (Q-10) |
| M6 | Admin ops: fall back to an invoice-only match when the pair is missing | 1 test in `adminInviteOps` |
| M7 | Champion status: `subscribed` upgrades a non-accepted invite | 2 tests in `friendInviteOps` |

### Conditions verified in code

| Condition | Verdict |
|---|---|
| **T5 / P5-C9** champion read | ✅ `parent_account_id = issuerAccountId` (from `getUser()` → `resolveAccountId` in the route), `source = 'account_invite'`, `invite_id IN` ids taken only from `listForIssuerAccount(accountId)` rows with `redeemed_at`, `first_paid_at IS NOT NULL`; selects `invite_id` only and maps to strings, so no date, amount or account id can leave it. UUID-checked, refused above 200, never throws. View keys unchanged |
| **T6 / C-11 / S5-8** money read | ✅ Pairs built only from lineage rows (`account_id`, `first_payment_ref`), never the invite row. The both-ids match is in the repository (M1), so no caller can skip it. Batched per 200 (lineage and money), no N+1. `requireAdmin` first in the route; service role documented in the method and at the wiring site. `livemode: false` → "Test payment" (render test). Date and amount from the money row only (AC-F2.2, M6) |
| **T7 / P5-C10 / C-9** | ✅ `paymentHoldBatch.ts` uses `isAwaitingPayment` on batched reads, never `readPaymentHold` (guarded); parity with `readPaymentHold` re-derived by SA against `paymentHold.ts` (no lineage / paid → not held; unpaid friend → held without an invite read; unpaid admin invite → held only on `tier`; an admin invite with no row → not held, same as `readPaymentHold`'s `null` grant kind). Any failed batch → `{ ok: false }` (M4). Report: `byState` / `accountsScanned` untouched, anomalies kept on failure (M3). Dry run: upper bound on failure (M5) |
| **C-7** caller guards | ✅ All four new reads: service-role comment, named caller, single-caller guard in `BusinessOsPaymentVisibilityReads.test.ts`; the money-history repository's own caller list gains the admin route |
| **C-8** no cycle | ✅ `paymentHoldBatch.ts` imports `paymentHold.ts` and repository types only (guarded); `report.ts` imports out of the module; `test:bos-entitlements` green |
| **Tenant isolation** (`tenant-isolation-guard`) | ✅ The only non-admin path (champion) takes its account from the session and is scoped twice; every caller-supplied id is shape-checked before a query; no service-role write added |
| **Admin layout** | ✅ `StatusChip` from `app/admin/components/layout/StatusChip`, L-6 tones, inside the existing State cell; English only (Q-7) |
| Pino / no `console.*` | ✅ Five new events, ids and counts only, never an amount |

### Rulings on DV-1 to DV-11

| # | Ruling |
|---|---|
| DV-1 | **Accepted.** `paid_recorded` keeps the page guard intact; the screen word is unchanged |
| DV-2 | **Accepted.** No production caller is left without readers: the shadow-report route is `buildShadowReport`'s only caller and wires them. Unwired → `scanFailed: true`, anomalies kept, `error` log with `wired: false`: the safe side. This is C-9 made structural, better than the plan's default |
| DV-3 | **Accepted.** Follow-up (non-blocking): once both PRs are on `main`, the `paymentHoldBatch.ts` entry may move into `paymentHold.test.ts`'s list in a later touch; no PR needed for it alone |
| DV-4 | **Accepted.** FR-25 / AM-6 ask the invites list for "paid, date and amount" for the account the invite created; a stamped account did pay, and the money row is matched by the same both-ids rule. Hiding a true payment because the invite was a free one would need a rule no requirement states. P-13's `waived` stays distinct (S5-9) |
| DV-5 | **Accepted.** `no_assignment` is exactly the held basis-less shape; any other anomaly on a held account is real |
| DV-6 | **Accepted.** A malformed ref cannot match a money row, so "Paid, record not found" is true for that row, and the rest of the page still answers; the drop is warn-counted. Note the opposite strictness on the answer side is also right: an answered row that cannot be read fails its batch to "unknown", never a guessed value |
| DV-7 | **Accepted.** The structural port keeps the money-history caller list to the wiring route |
| DV-8 | **Accepted.** One new guard file avoids a conflict with #359 |
| DV-9 | **Accepted.** Typing-only edits to existing fakes; no assertion changed |
| DV-10 | **Accepted.** "Unknown" when a read was attempted and failed; nothing when the caller did not ask (older server shape). Only one production caller, which wires lineage |
| DV-11 | **Accepted.** Upper bound for `wouldBecomeChampion`, lower bound for `awaitingPayment` when `holdScanFailed`, as Q-10 ruled; the response comment says to read `holdScanFailed` first |

### Code Review Comments

1. `lib/repositories/__tests__/BusinessOsPaymentVisibilityReads.test.ts` — **F-1 (applied by SA).** The champion read refuses more than `LINEAGE_LOOKUP_LIMIT` ids and the list passes up to `BUSINESS_OS_FRIEND_INVITE_LIST_LIMIT` accepted ids. Both are 200 today, but nothing pinned that: raising the list cap would silently turn every champion with a long list to "joined" (a warn only). Added one assertion `BUSINESS_OS_FRIEND_INVITE_LIST_LIMIT <= LINEAGE_LOOKUP_LIMIT`. — Priority: Low

### Optimisation Suggestions (non-blocking)

- O-1. When both P-5b PRs are merged, fold these notes into the workplan's Implementation Notes (as the Overview already says).
- O-2. The launch route builds `holdReaders` inline; if Slice 2's real run reuses the classification, extract the wiring then, not now.

### Code Approved for QA: **Yes**

**QA focus:**
1. Admin paid line through the route with a real-shaped lineage + money pair, a swapped pair (neither shows), a stamped row with no money row ("Paid, record not found", warn with ids only) and a failed money read ("Payment unknown").
2. Champion list: "Subscribed" only for an accepted, paid friend of the session account; a paid friend of ANOTHER champion never shows; a failed read leaves "joined"; en/he/es with Hebrew right to left; no Revoke on a subscribed row.
3. Shadow report: a held friend under `static.awaitingPayment`, not in `anomalies`; `byState`/`accountsScanned` unchanged; a failed hold read keeps the anomaly with `scanFailed: true`, `count: null`.
4. Launch dry run: held counted apart and sampled (≤ 20); a failed read keeps them in `wouldBecomeChampion` with `holdScanFailed: true`; audit details carry counts only.
5. Manual (D1 to D4, §10): read-only, needs the user and one held test friend.
6. Merge order: whichever of #359 / this PR merges second, re-check the requirement's P-5b row conflict is resolved by keeping both sentences (§9).

---

## QA Testing Report — P-5b.2 (2026-10-14)

**QA — 2026-10-14**
**Test mode:** full (SA QA focus 1 to 4 by tests and code reading; 5 as a run-sheet for the user; 6 checked by a dry-run merge)
**Strategy used:** A + B (Jest unit and route-level integration with mocked repositories; no real DB, no Stripe, no browser in this session) + code reading against the migrations
**Focus:** api, ui, security, schema
**Skipped:** D (manual browser) — not possible in this session; handed to the user as [D1 to D4](#demo-run-sheet-d1-to-d4-read-only)
**Input source:** prompt from TL (SA QA focus list)

### What QA ran

| Command | Result |
|---|---|
| `npx jest lib/business-os/invites lib/business-os/entitlements lib/business-os/billing app/api/admin/business-os/invites app/admin/business-os-invites app/api/business-os/friend-invites app/api/admin/business-os/entitlements components/business-os/settings lib/repositories/__tests__ app/api/stripe lib/audit --ci` | **231 suites, 8 691 tests, all passed** (Dev's 242 / 9 636 also included `lib/business-os/finance`, not in this set) |
| `npm run test:bos-entitlements` | **257 suites, 7 450 tests, all passed** (Dev's 7 449 + SA's F-1 assertion) |
| `npm run typecheck:bos-llm` | **passed**: 519 files, 28 errors, 0 new (the unrelated `app/api/onboarding/build/route.ts` baseline entry again reported fixed) |
| `npm run lint:hooks` | **passed** (exit 0, `--max-warnings 0`) |
| `git diff --numstat` (C-12) | No file with deletions and no insertions; 26 tracked files, 1 381 / 35 |
| Removed lines in edited test files | Only: three lineage fakes in `adminInviteOps.test.ts` (DV-9, typing), the widened select and method list in `BusinessOsAccountLineageRepository.test.ts`, and the `firstPaymentStamp.guard` file list widened. The four route/render suites gained tests only (0 removed lines). `report.test.ts`, `dormantChampions.test.ts`, `planActive.noEffect.test.ts`, `shadow.test.ts`, `paymentHold.ts`/`paymentHold.test.ts` and the P-5a.2 holding screen are **not touched** |
| C-1 shared lines | **#359 is now merged to `main`** (`799f8018`). `d769b9e3..origin/main` vs this branch, `+`/`-` lines: `inviteFriendsCopy.ts` 13 = 13, **identical**; `friendInviteOps.ts` main's 6 lines all present identically in the branch's 59 |
| Dry-run merge with current `origin/main` (`49b66feb`), via a throwaway index and `git merge-tree` (no ref, worktree or index touched) | **One conflict only**: `docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md` (the expected §9.1 P-5b row, §9). The 8 other shared files auto-merge; the merged guard lists carry both PRs' entries (`findInviterNotificationFactsById` + `findGrantKindsByIdsForAdmin`; billing-event caller list has `planBillingHandler.ts` + the admin invites route + `BusinessOsPaymentVisibilityReads.test.ts`; stamp-guard list has `adminInviteOps.ts` + `paymentHoldBatch.ts`) |
| Schema (from migrations) | `first_payment_ref` is written only by `business_os_apply_plan_payment` (20261028) as `p_stripe_invoice_id`, in the same transaction as the `invoice_paid` money row with `user_id = p_user_id` = the lineage `account_id`, so the (account, invoice) pair always exists for a real stamp; the `in_` shape filter cannot drop a real ref. `amount_minor` is Stripe `amount_paid` (tax included), matching the screen's wording |

### Test Coverage

| Acceptance point (SA QA focus) | Tested? | Result | Evidence |
|---|---|---|---|
| 1a. Paid row through the route: date + amount from the money history | ✅ | Pass | admin invites `route.test.ts` (paid + held rows, one money read for the lineage pair); `adminInviteOps.test.ts` (money from history, never lineage) |
| 1b. `livemode: false` → "Test payment" | ✅ | Pass | `invites.paymentLine.render.test.tsx` ("$1,234.56 USD" + neutral chip) |
| 1c. Swapped refs → neither payment shows | ✅ | Pass | `BusinessOsPaymentVisibilityReads.test.ts` S5-8 (SA M1 killed by it) |
| 1d. "Paid, record not found", warn with ids only | ✅ | Pass | `adminInviteOps.test.ts` (event `bos_invite_admin_payment_record_missing` with `inviteId`, `accountId`; code shows no amount or date in the log) |
| 1e. "Payment unknown" on a failed read | ✅ | Pass | route test (failed money read → unknown on the paid row only); ops tests (failed lineage, unwired reader) |
| 1f. "Signed up, not paid" | ✅ | Pass | route test + render test |
| 1g. `requireAdmin` first; non-admin reaches no money read | ✅ | Pass | route test (403, no read) + `BusinessOsPaymentVisibilityReads.test.ts` requireAdmin-first source check for the three routes |
| 1h. Batched, no N+1 | ✅ | Pass | Code: ≤ 3 lineage reads + ≤ 3 money reads per 500-row page (batches of 200); ops tests pin batching |
| 2a. "Subscribed" only for the session account's own accepted paid friend | ✅ | Pass | friend-invites `route.test.ts` (read for the session account and its own accepted ids); repository query chain pins `.eq('parent_account_id', issuer)` + `source` + `invite_id IN` + `first_paid_at not null` (SA M2) |
| 2b. Another champion's paid friend never shows | ✅ | Pass | Scoped twice (parent = session account; ids from `listForIssuerAccount`); query chain test |
| 2c. Failed read → joined | ✅ | Pass | `friendInviteOps.test.ts` (failed and unwired read keep `joined`, warn logged) |
| 2d. en / he / es, Hebrew right to left | ✅ | Pass | `InviteFriendsSection.render.test.tsx` (+3) |
| 2e. No Revoke on a subscribed row | ✅ | Pass | Render test; code: Revoke renders only for `status === 'pending'` |
| 2f. No dates or amounts reach the champion | ✅ | Pass | View keys unchanged (`FRIEND_INVITE_VIEW_KEYS`), read selects `invite_id` only, render test "no amount" |
| 3a. Held friend under `static.awaitingPayment`, not `anomalies` | ✅ | Pass | entitlements `routes.test.ts` (through the route) + `report.awaitingPayment.test.ts` |
| 3b. Totals unchanged (`byState`, `accountsScanned`) | ✅ | Pass | `report.awaitingPayment.test.ts` C-9 reconciliation |
| 3c. Failed hold read → anomaly stays, `scanFailed: true`, `count: null` | ✅ | Pass | route test + report test (SA M3) |
| 4a. Dry run: held counted apart, sampled | ✅ | Pass | route test (`awaitingPayment: 1`, sample `[HELD]`, one batched read per page) |
| 4b. Sample ≤ 20 | ⚠️ | Pass by reading, **not pinned** | Code caps at 20; mutation M-QA1 survived (Edge Case E-1) |
| 4c. Failed read → upper bound + `holdScanFailed` | ✅ | Pass | route test Q-10 (SA M5) |
| 4d. Audit details counts only | ✅ | Pass | route test (`details` has counts; `JSON.stringify(details)` does not contain the held id; flushed before response) |
| Existing suites unedited where claimed; P-5a.2 / P-5b.1 paths unaffected | ✅ | Pass | See "What QA ran" |

### QA mutation checks (one at a time, restored by re-edit, md5-verified)

| # | Mutation | Result |
|---|---|---|
| M-QA1 | Launch route: held sample cap `< 20` → `< 2000` | **Survived** (entitlements routes + report suites, 114 passed). Restored; `launch/route.ts` md5 `f97b5512…` identical to before. The pre-existing `sample` cap of 20 is not pinned either |
| M-QA2 | Report: move every anomaly of a held account, not only `no_assignment` (DV-5) | Survived, but **equivalent**: one plan row per account yields at most one `lifecycle.anomaly`, so a held candidate can only carry `no_assignment`. Not a gap. Restored; `report.ts` md5 `c4c6b709…` identical |

### Issues Found

#### Bugs (must fix before commit)

None.

#### Performance Issues (should fix)

None. All new reads are batched (200), one classification per 500-row page in the dry run, one champion read per list.

#### Edge Cases (nice to fix)

1. **E-1: the dry run's held sample cap (≤ 20) is not pinned by a test** — File: `app/api/admin/business-os/entitlements/__tests__/routes.test.ts` — Severity: Low
   - Steps: change `awaitingPaymentSample.length < 20` in `launch/route.ts` to any larger number; every suite stays green.
   - Expected: a test with > 20 held accounts asserting `awaitingPaymentSample.length === 20` and `awaitingPayment` = the full count.
   - Actual: only a 1-account case. The response is admin-only and the audit never carries the sample, so the risk is a larger response, not a leak. Same gap for the pre-existing `sample`.

#### Notes for RM (not defects)

- **N-1: #359 has merged to `main`** since this branch was cut. Before the PR: merge `origin/main` in, resolve the requirement's §9.1 P-5b row by keeping both sentences (the only conflict, confirmed by `git merge-tree`), and **re-run the suites above on the merged tree** — `friendInviteOps.ts`, three repositories, `types.ts` and three guard lists auto-merge, and only a test run proves the combination (QA could not run Jest on the merged tree without a second `node_modules` junction, which it avoided).
- **N-2: D4 writes one audit row.** The dry run changes no entitlement data, but it records an admin audit entry (counts only), by design.
- **N-3:** SA's DV-3 follow-up (move the `paymentHoldBatch.ts` C-8 entry into `paymentHold.test.ts`'s list) is now actionable, since #359 is on `main`; still non-blocking.

### Final Status

- [x] All acceptance criteria pass by test (one Low edge case: the sample cap is correct but not pinned) — **PASS WITH NOTES**, ready for the user's diff view and the D1 to D4 demo, then RM (after N-1)
- [ ] Issues found — Dev must address before commit

---

## Demo run-sheet D1 to D4 (read-only)

**Needs:** one champion account with at least one friend who accepted a friend invite and has **not** paid (held on the payment screen), and an admin session. Nothing below changes data, except that D4 records one admin audit entry (N-2). No switch flip, no Stripe.

**Step 0 — find the held friend and their champion (Supabase SQL editor, read-only).** The first query lists held lineage rows that have a parent (friend invites); the second gives the champion's email.

```sql
select i.id as invite_id, i.email as friend_email, i.redeemed_at, i.issuer_kind, l.account_id as friend_account_id, l.parent_account_id as champion_account_id, l.level, l.source, l.first_paid_at
from public.business_os_invites i
join public.business_os_account_lineage l on l.invite_id = i.id
where l.parent_account_id is not null and l.first_paid_at is null and i.redeemed_at is not null
order by i.redeemed_at desc
limit 20;
```

```sql
select u.id as champion_account_id, u.email as champion_email
from auth.users u
where u.id in (
  select l.parent_account_id
  from public.business_os_account_lineage l
  where l.parent_account_id is not null and l.first_paid_at is null
);
```

Optional, the held friend has a basis-less plan row and no money row (expect `tier` and `cohort` empty, and a count of 0):

```sql
select p.user_id, p.tier, p.cohort, p.tier_expires_at,
  (select count(*) from public.business_os_billing_events e where e.user_id = p.user_id) as money_rows
from public.business_os_account_plans p
where p.user_id in (
  select l.account_id
  from public.business_os_account_lineage l
  where l.parent_account_id is not null and l.first_paid_at is null
);
```

| # | Where | Do | Expect |
|---|---|---|---|
| **D1** | Sign in as the **champion**, switch the app language to Hebrew, open `/business-os/settings`; the invite-friends section sits under the Plan section | Find the friend's row in "ההזמנות שלך" | The page reads right to left; the email stays left to right; the friend's status chip reads **"נרשם — עדיין ללא מנוי"** (Signed up, not subscribed yet); **no** "ביטול" (Revoke) on that row; no date of payment or amount anywhere. A paid friend of this champion would read "נרשם למנוי"; a paid friend of another champion never appears |
| **D2** | Sign in as an **admin**, open `/admin/business-os-invites` | Find the friend's invite row (by email) | State chip **Accepted**, level **L2**, and under it the warn chip **"Signed up, not paid"**. (A paid account would show "Paid" with `YYYY-MM-DD · $xx.xx USD`, plus "Test payment" in Stripe test mode) |
| **D3** | Same admin browser tab, open `/api/admin/business-os/entitlements/shadow-report` | Read the JSON | `data.static.awaitingPayment` is `{ scanFailed: false, count: ≥ 1, accountIds: [...], truncated: false }` with the friend's account id inside; that id is **not** in `data.static.anomalies`; `accountsScanned` and `byState` add up as before |
| **D4** | Same admin tab, DevTools console | Run `fetch('/api/admin/business-os/entitlements/launch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'launch_champion_existing', reason: 'planning' }) }).then(r => r.json()).then(console.log)` (no `dryRun` field means a dry run; the real run answers 501) | `data.awaitingPayment` ≥ 1 with the friend's id in `data.awaitingPaymentSample` (at most 20), the friend **not** in `data.sample`, and `data.holdScanFailed: false`. One admin audit entry is recorded with counts only |

If D3 shows `scanFailed: true` or D4 `holdScanFailed: true`, the hold read failed: check the server logs for `bos_entitlements_report_hold_scan_failed` / `bos_entitlements_launch_hold_scan_failed`.

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-14 | P-5b.2 code complete (Dev) | T5 to T7 and the .2 shares of T8 to T11 on `feature/bos-plan-payments-p5b2` (from `origin/main` `d769b9e3`), uncommitted, awaiting SA code review. Shared `subscribed` lines carried byte-for-byte from #359 (C-1). Deviations DV-1 to DV-11 |
| 2026-10-14 | SA code review (SA) | APPROVED WITH FIXES. F-1 applied by SA (one guard test: the champion list cap never exceeds the lineage read cap). DV-1 to DV-11 accepted. Seven mutations, all killed, files md5-verified restored. Code approved for QA |
| 2026-10-14 | QA (QA) | PASS WITH NOTES. 231 suites / 8 691 tests, `test:bos-entitlements` 257 / 7 450, typecheck and lint:hooks green. No bugs; E-1 (held sample cap not pinned, Low). #359 now on `main`: dry-run merge shows only the expected requirement conflict; re-run suites after merging main (N-1). Demo run-sheet D1 to D4 added |
