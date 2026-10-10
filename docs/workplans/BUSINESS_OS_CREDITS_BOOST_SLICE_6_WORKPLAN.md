# Workplan: Business OS Credits Boost — Slice 6 "Admin view and cap override"

> **Last Updated**: 2026-10-09

**Developer:** Dev
**Requirement:** [BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md): FR-22, FR-38, R-12, the §18.10 slice 6 row, and the acceptance criterion on the admin cap override
**Carry-forwards taken in:**
- **2a QA I-2:** an override whose account was deleted keeps `ended_at IS NULL` with `user_id` NULL. It must never show as an active override.
- **2a SA C-5:** the `…ForWebhook` finders stay out of `app/` except the webhook and reconcile cron routes (an existing source guard). This slice reads through the account-scoped methods only.
- **2b SA N-3:** the admin view lists `flagged_mismatch` purchases with their reason code, so an admin can find and refund them.
- **4b.2:** `POST /api/admin/business-os/credits/boost/reconcile` exists (SA Q-6). This slice adds its button.
- **Credit deduction 11b / 11c:** the per-account credit view under `/admin/users` (`CreditsBlock`) and its Take back action, which stays the only way to take credits back (FR-37, T-9).

**Branch:** `feature/bos-credits-boost-slice-6`, cut from `origin/main` `90c33582` (after #278)
**Date:** 2026-10-09
**Status:** **6a approved and committed 2026-10-10, PR open. BQ-1 decided 2026-10-10: $1,500 per 30 days ceiling; 6b next.** **6a review fixes applied 2026-10-10 (SA CR-1, N-1; QA6a-L1, L2); QA re-check PASS 2026-10-10** (§5.1). *(Earlier: **6a implemented 2026-10-09; SA code review: Fix Required (CR-1, a second money formatter using / 100)** (results in §5.1; nothing committed). 6b waits for BQ-1. *(Earlier: **SA approved with conditions 2026-10-09** (C-1 to C-6; split 6a / 6b). BQ-1 (the highest admin limit) is with the user. No code is written.)*)*

## Overview

An admin looking at one business under `/admin/users` today sees its plan, its credits and its gifts (11c). They cannot see whether the business bought credits, whether a payment is stuck, refunded, disputed or flagged, or what its spending limit is. They also cannot change that limit, although the requirement promises it (FR-22).

Slice 6 adds one block, **"Credit top-ups"**, under the existing Credits block of the Businesses panel:
1. The account's purchases in both Stripe modes, with status, amounts, credits, dates and, for a flagged one, the reason in plain words. Stripe references link to the Stripe dashboard in the right mode.
2. The account's spending limit: the default, or the active override with its reason, admin and date, plus the override history.
3. **Set limit** and **Back to default** actions, with a required reason, audited.
4. **Run billing reconcile now** (all accounts), behind a confirm step, showing the counts.

**Proposed split:** **6a** is the read view (about 1 day). **6b** is the limit actions and the reconcile button (about 1–1.25 days).

---

## 1. Analysis Summary

| Area | As built on `90c33582` | Slice 6 |
|---|---|---|
| Admin home (R-12) | `app/admin/users/components/BusinessOsPanel.tsx` renders `CreditsBlock` (11c), which reads `GET /api/admin/business-os/credits/accounts/[accountId]` on its own | A new `BoostBlock` sits after `CreditsBlock`, with its **own** GET, so 11c's route and tests are untouched (the 11c precedent: each block reads on its own and fails on its own) |
| Purchases read | `BusinessOsBoostPurchaseRepository.listForAccount(accountId, { livemode, limit })`, scoped `.eq('user_id')`, newest first, at most 200 | Used as is, one read per mode (at most 50 each). No `…ForWebhook` finder |
| Cap override read | `findActiveCapOverride(accountId)`, scoped `.eq('user_id')` and `ended_at IS NULL` | Used as is. New: `listCapOverrides(accountId, { limit })` for the history (scoped, newest first, at most 20) |
| Cap override write | `setCapOverride` / `endCapOverride` → `business_os_set_boost_cap_override` / `_end_…` (2a, PROD). The functions take the per-account cap lock, require a reason of 3–500 characters, accept USD only, refuse `cap_minor <= 0`, answer `no_plan_row` / `none_active`, and close the active row as `replaced` when a new one is set | Called through a new boost admin op (§3.3). **No SQL change and no migration** |
| Default cap | `BOOST_PURCHASE_CAP_DEFAULT` (`lib/business-os/entitlements/config/boostPackages.ts`): $150 / 30 days | Shown as "default"; imported by the new read route (an entitlements non-gate registration) |
| Admin op path (R-12) | `POST /api/admin/business-os/entitlements/accounts/[accountId]` → `executeAdminOp` (`lib/business-os/entitlements/adminOps.ts`). It runs own-account 403 → platform 409 → tenant 404 → plan row 409, then dispatches. Credit ops (`creditAdminOps.ts`) plug in through `isCreditAdminOp` and an `audit` override. The route audits with `severity: 'warning'` and a flush | **Proposed (Q-1):** two boost ops plug in the same way: `set_boost_cap` and `end_boost_cap` in a new `lib/business-os/boost/boostCapAdminOps.ts`. No new admin write route |
| Reconcile | `POST /api/admin/business-os/credits/boost/reconcile`, body `{}`, answers `{ runId, counts, passesRun, passesFailed, durationMs }` | A button with a confirm step; it shows the counts |
| Take back credits | 11c's `CreditFormDialog` in "Take back" mode on one lot, posting `reduce_credit_lot` | A purchase with a lot offers "Take back credits", which opens the **same** dialog on that purchase's lot. Nothing new on the server |
| Audit events | No cap-override event exists | `BOS_BOOST_CAP_OVERRIDE_SET`, `BOS_BOOST_CAP_OVERRIDE_ENDED` (`warning`, SOC2, audience `bos`), on entity `business_os_account_plan` (operator-only, id = the account), the admin as actor |

---

## 2. Scope and guardrails

**In scope:**
- **6a:** the read route, `listCapOverrides`, the `BoostBlock` read view and its copy, the guards and the register.
- **6b:** the two cap ops and their audit events, the Set limit / Back to default dialogs, the reconcile button, and the Take back link.

**Out of scope (proposed follow-ups):**
- **A global "flagged purchases" list across all accounts.** It is not cheap: a new unscoped read, a new admin page or tab, and its own guard. Proposed as **slice 6c**, or folded into the jobs page next to the reconcile job (Q-5).
- **"Counted toward the limit so far."** The counted amount is decided inside the reservation function. Showing it needs either a read-only function (a migration) or a TypeScript copy of the SQL rule (drift risk) (Q-4).
- Audit history per purchase (for example a `BOS_BOOST_FLAGGED` on a disputed row) (Q-6).
- Any owner-facing change.

**Guardrails (must not):**
- Read or show another account's data. The account comes **only** from the URL path, after `requireAdmin`, Zod, lower-case, the platform account 409 and the tenant check (the 11c order).
- Name a `…ForWebhook` finder or the reconcile list read in `app/`.
- Take credits back by any new path. Take back stays 11b's `reduce_credit_lot`.
- Show an override with `user_id` NULL (2a I-2). The reads are scoped by `user_id`, so it can never match; a test pins it.
- Put a Stripe secret, a client secret or an email in the payload. The purchase columns hold none, and the payload is built field by field from an allow-list.
- Build a Stripe link from anything but a validated id: `pi_…` / `dp_…` / `du_…` / `ch_…` / `py_…` by regex, and the mode from the row's `livemode`.

---

## 3. Implementation Approach

### 3.0 SA conditions applied (2026-10-09)

| # | Slice | Condition | Where |
|---|---|---|---|
| C-1 | 6b | `adminOps.ts` step 1b refuses the platform account (409 `platform_account`) for `set_boost_cap` / `end_boost_cap` too, beside the own-account 403 set. Both are tested | §3.3 |
| C-2 | 6b | `set_boost_cap` reads `findActiveCapOverride` first. The same amount already active → 200 `{ unchanged: true }`, with no write and no audit. A repeated `end_boost_cap` already answers 409 `no_active_cap_override`. The UI one-at-a-time guard stays | §3.3 |
| C-3 | 6b | `amountMinor` is an integer from 100 to `capMaxMinor` and a multiple of 100 (whole dollars). The ceiling is a config constant beside `BOOST_PURCHASE_CAP_DEFAULT` (BQ-1; SA agrees with $1,500), never a literal in the ops file. The confirm restates the old and new limit and the window | §3.3, §3.4 |
| C-4 | **6a** | `stripeDashboardUrl(kind, id, livemode)` takes `livemode` from the **row**, never `serverMode`. Ids are matched by anchored regexes; links carry `rel="noopener noreferrer"`; anything else is plain text. Tests cover a test-mode row on a live key and a malformed id | §3.2 |
| C-5 | 6b | Take back opens 11c's `CreditFormDialog` directly on the purchase's `lotId` (still `reduce_credit_lot` with `confirmPaidCredits`). If that lot is not among `CreditsBlock`'s loaded lots, the row shows "Take back in Credits above" | §3.4 |
| C-6 | 6b | The reconcile button stays on the block, labelled "(all accounts)", and sends an empty body (no account id) | §3.4 |

Rulings: Q-1 (a), Q-2 yes with C-2, Q-3 the dialog with C-5, Q-4 out of v1 (a follow-up uses a read-only SQL function), Q-5 on the block, Q-6 with 6c, Q-7 both modes with a badge per row. **6a has no action:** no limit change, no reconcile button and no Take back; 6b waits for the user's BQ-1 answer.

### 3.1 6a: the read route

`GET /api/admin/business-os/credits/accounts/[accountId]/boost`

- **Order (the 11c route, copied):**
  1. `requireAdmin` is the **first statement**.
  2. Zod uuid on the path, or 400.
  3. Lower-case, then `resolveAccountId`.
  4. Platform account → 409.
  5. `isBusinessOsTenant` → 500 / 404.
  6. The reads.
  - No body is read, and the query string is ignored.
- **Reads, each in its own block that fails on its own** (SA OP-26 precedent):
  - `purchases`: `listForAccount(id, { livemode: false, limit: 50 })` and `{ livemode: true, … }`.
  - `cap`: `findActiveCapOverride(id)` plus `listCapOverrides(id, { limit: 20 })`.
- **Payload** (built field by field; credits and minor units; no email, no secret):
  ```ts
  {
    accountId, isOwnAccount,
    serverMode: 'test' | 'live' | null,          // from currentStripeMode(); null when the key is unreadable
    purchases: { status: 'ok', rows: AdminBoostPurchaseRow[], truncated: { test: boolean, live: boolean } } | { status: 'error' },
    cap: { status: 'ok', default: { amountMinor, currency, windowDays },
           active: { id, amountMinor, currency, reason, actorAdminId, createdAt } | null,
           history: Array<{ id, amountMinor, reason, actorAdminId, createdAt, endedAt, endedByAdminId, endedReason }> }
         | { status: 'error' },
    limits: { reasonMin: 3, reasonMax: 500, capMaxMinor }   // capMaxMinor: see BQ-1
  }
  AdminBoostPurchaseRow = {
    id, livemode, status, packageId, packageVersion, priceMinor, currency, creditsTotal,
    amountTotalMinor, amountTaxMinor, amountRefundedMinor, flagReason, lotId,
    stripe: { paymentIntentId, chargeId, disputeId, checkoutSessionId },   // ids only
    createdAt, paidAt, statusChangedAt, checkoutExpiresAt
  }
  ```
  - Rows from both modes are merged newest first.
  - `truncated` says a mode hit 50 rows.
- **Logging and audit:** one `info` log with ids, statuses and counts. No audit row (a plain read, the 11c precedent).
- **Service role** through the boost repository (its header already documents it); every read is scoped `.eq('user_id', accountId)`.
- **Registers:**
  - row **103** in the admin access register, with the census re-measured;
  - `KNOWN_NON_GATE_IMPORTERS` for the route (`isBusinessOsTenant`, `resolveAccountId`, `BOOST_PURCHASE_CAP_DEFAULT`; a read for display, refusing nothing);
  - `npm run test:bos-entitlements` and `npm run test:authz-guard`.

### 3.2 6a: the block (`app/admin/users/components/BoostBlock.tsx`)

**Header:** "Credit top-ups" with a mode note. Where the server key is test mode, it adds "Test-mode purchases are not real money".

**Purchases table** (newest first; empty state "No top-ups yet"; error state "Top-ups could not be read", never zeros):

| Column | Content |
|---|---|
| Date | `createdAt` (UTC, the 11c `formatUtc`); paid date on hover |
| Package | `packageId` v`packageVersion` |
| Credits | `creditsTotal` (11c `formatCredits`) |
| Paid | `amountTotalMinor` (or `priceMinor` when not yet paid) and its currency; "incl. tax X" when there is tax; "Refunded X" when above zero |
| Status | a chip with the plain words below, the raw status on hover |
| Stripe | the payment link, the dispute link when present, and the mode badge (`Test` / `Live`) |
| Actions | **Take back credits** (6b) when the row has a `lotId` and the account is not the admin's own |

**Status words (admin):**

| Status | Words |
|---|---|
| `pending` | Checkout not finished |
| `awaiting_payment` | Waiting for a delayed payment |
| `paid` | Paid, credits added |
| `partially_refunded` | Partly refunded |
| `refunded` | Refunded |
| `disputed` | Chargeback open |
| `dispute_lost` | Chargeback lost (payment reversed) |
| `failed` | Payment failed |
| `expired` | Checkout expired |
| `abandoned` | Checkout never started |
| `flagged_mismatch` | **Needs review:** followed by the reason in words |

**Flag reasons in words** (pure map in `lib/business-os/boost/boostAdminView.ts`; an unknown code shows the raw code):
- the 2b reasons: no session, session / payment / mode / currency / amount / total mismatch, payment reused, account deleted, lot key conflict;
- the 4a reasons (`session_unreadable`, `metadata_mismatch`, `no_payment_intent`, `no_payment_required`, `session_amounts_missing`, `deterministic_failure`, …);
- the 4b.2 reasons (`reconcile_session_missing`, `reconcile_session_refused`, `reconcile_session_unreadable`, `transition_not_allowed:<target>`, …).

A source test pins that every code the boost code can write has words.

**Stripe links** (pure, `stripeDashboardUrl(kind, id, livemode)`):
- `https://dashboard.stripe.com/test/payments/<pi>` or `https://dashboard.stripe.com/payments/<pi>`; `…/disputes/<dp>`.
- Only for ids matching their regex, otherwise plain text.
- `target="_blank" rel="noopener noreferrer"`.
- No link for the checkout session (Stripe has no stable dashboard page for it); its id is shown in a short form, with the full id on hover.

**Spending limit panel:**
- "Default: $150 per 30 days", or "Set by an admin: $X per 30 days". The reason, the admin (short id, as 11c shows admins) and the date come with the override.
- History: the last 20 changes with set / ended, reason, admin and date. Ended reasons include "replaced".

**Notes:**
- Free text (reasons) renders as text only.
- Dark admin styling follows `CreditsBlock`.

### 3.3 6b: the cap override ops (proposed path: the entitlements admin op route, Q-1)

New `lib/business-os/boost/boostCapAdminOps.ts`. It mirrors `creditAdminOps.ts`: Zod schemas, `isBoostCapAdminOp`, `executeBoostCapAdminOp(op, ctx)`, no logger, and **no import from the entitlements module**.

```ts
set_boost_cap: { op, amountMinor: int 100..capMaxMinor, reason: trim 3..500 }   // .strict(); currency fixed 'USD' server-side
end_boost_cap: { op, reason: trim 3..500 }                                        // .strict()
```

**Changes in `adminOps.ts` (inside the module):**
- add both schemas to the `discriminatedUnion`;
- add both names to `OWN_ACCOUNT_GUARDED_OPS` (403 `own_account`);
- refuse the platform account (409);
- dispatch to `executeBoostCapAdminOp`;
- `AdminOpContext` gains `boostCap: Pick<BusinessOsBoostPurchaseRepository, 'setCapOverride' | 'endCapOverride' | 'findActiveCapOverride'>`.

**The tenant and plan-row checks already run before the dispatch** (404, 409 `plan_row_missing`). The function's own `no_plan_row` still maps to 409.

**Outcomes:**
- `set` → `{ ok: true, action: 'BOS_BOOST_CAP_OVERRIDE_SET', data: { overrideId, previousOverrideId, amountMinor }, invalidatesEntitlements: false, audit }`.
- `end` → `BOS_BOOST_CAP_OVERRIDE_ENDED` with `{ overrideId }`.
- `none_active` → 409 `no_active_cap_override`.
- A repository failure → 500 `cap_override_write_failed` (the route logs it).

**Audit** (through the route's existing writer, with the `audit` override widened from `CreditLotAudit` to a union):
- entity `business_os_account_plan` (operator-only, BD-26), id = the account, the admin as actor;
- `changes`: before → after (amount or "default");
- `details`: reason, previous override id, new override id. No email.

**The route itself does not change** beyond what already flows through `outcome.audit` and `invalidatesEntitlements`.

**Request id:** the SQL has no idempotency key, so a double submit writes twice. The UI allows one POST at a time (11c's CR11c-1 pattern). A replayed Set only replaces the override with the same figure and writes a second audit row, which is harmless and visible (Q-2).

### 3.4 6b: the dialogs and the reconcile button

**`BoostCapDialog`** (copy of `CreditFormDialog`'s pattern: two steps, one POST at a time, cannot close mid-POST, dark styling):
- **Set limit:** an amount in dollars, whole dollars, converted to minor units, bounds from `limits`; a reason; then "Confirm: set <business>'s limit to $X per 30 days (was $Y)".
- **Back to default:** a reason; confirm.
- Errors use `creditErrorSentence`-style codes, including `own_account`, `platform_account` and `no_active_cap_override`.
- On success the block re-reads and shows a status line.
- Buttons are hidden on the admin's own account.

**Reconcile button:**
- The label is "Run billing reconcile now (all accounts)", in the block footer.
- The confirm dialog says it re-checks stuck top-ups for **every** business with Stripe and may credit, expire or fail them.
- It POSTs `{}` and shows the counts in words (examined, credited, expired, failed, needing a person, deferred, stopped at the time limit), then re-reads the block.
- Refusals: a 401/403 hides nothing (the admin gate already passed to see the panel); any error is "The reconcile could not run".

**Take back credits:** opens 11c's `CreditFormDialog` in Take back mode for the purchase's `lotId`. That needs `CreditsBlock`'s lot data, so the block asks the panel to open it (a callback). Alternatively a "Take back in Credits above" link scrolls to that lot (Q-3). No server change.

### 3.5 Files

| File | Slice | Action |
|---|---|---|
| `app/api/admin/business-os/credits/accounts/[accountId]/boost/route.ts` (+ test) | 6a | create |
| `lib/business-os/boost/boostAdminView.ts` (status words, flag reason words, Stripe links, payload builder) (+ test) | 6a | create |
| `lib/business-os/boost/boostAdminViewTypes.ts` | 6a | create |
| `lib/repositories/BusinessOsBoostPurchaseRepository.ts` (+ test): `listCapOverrides` | 6a | modify |
| `app/admin/users/components/BoostBlock.tsx` (+ render test), `BusinessOsPanel.tsx` (mount it), `app/admin/users/types.ts` | 6a | create / modify |
| `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts` (non-gate entry) | 6a | modify |
| `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` (row 103, census) | 6a | modify |
| `lib/business-os/boost/boostCapAdminOps.ts` (+ test) | 6b | create |
| `lib/business-os/entitlements/adminOps.ts` (+ its test), the entitlements route test (two ops, audit entity and severity) | 6b | modify |
| `lib/audit/events.ts`, `eventAudience.ts` (+ pins) | 6b | modify |
| `app/admin/users/components/BoostCapDialog.tsx`, `BoostReconcileButton.tsx` (+ render tests) | 6b | create |
| Requirement, this workplan | both | modify |

---

## 4. Task List

**6a**
- ✅ T6.1 `listCapOverrides` + tests (scoped by `user_id`, newest first, capped; a detached `user_id` NULL row never returned)
- ✅ T6.2 `boostAdminView.ts`: status and reason words, Stripe links, payload builder + tests (every writable flag code has words; links only for valid ids; both modes; no email or secret field)
- ✅ T6.3 The GET route + tests (401/403 first and nothing read; 400; 409 platform; 404 / 500 tenant; one block failing alone; both modes merged; the I-2 row absent; no `…ForWebhook` name)
- ✅ T6.4 `BoostBlock` + render tests (loading, error, empty, statuses incl. flagged reasons, refunded / disputed / reversed, Stripe links per mode, cap default vs override vs history, own account)
- ✅ T6.5 Registers: access doc row 103 + census, entitlements non-gate entry; `test:bos-entitlements`, `test:authz-guard`

**6b**
- [ ] T6.6 `boostCapAdminOps.ts` + the `adminOps.ts` wiring + tests (reason required, bounds, own account 403, platform 409, tenant 404, plan row 409, `none_active` 409, write failure 500, audit entity and changes)
- [ ] T6.7 Audit events + pins
- [ ] T6.8 `BoostCapDialog` + tests (two steps, one POST at a time, reason required, errors in words, re-read after success)
- [ ] T6.9 The reconcile button + tests (confirm, counts in words, error) and the Take back link (Q-3)
- [ ] T6.10 Docs: requirement status, results here

---

## 5. Test Plan

**Routes:**
- the gate first: 401 / 403 / a throwing check → 403 / a throwing auth → 401, nothing read;
- validation (400);
- the platform account (409), not a tenant (404), tenant check failing (500);
- one block failing on its own;
- both modes merged and newest first;
- the I-2 detached override not shown;
- payload keys pinned (no `email`, `secret`, `client_secret`).

**Ops (through `executeAdminOp`):**
- set and end, with the reason required (400), amount bounds (400) and unknown keys (400);
- own account 403, platform 409, tenant 404, `plan_row_missing` 409, `none_active` 409, repository failure 500;
- the audit entity is `business_os_account_plan`, the actor the admin, and `changes` before → after;
- `invalidatesEntitlements` false.

**UI:**
- every state above;
- the flagged reason words;
- the override flow (open → reason required → confirm → re-read → status line);
- the reconcile button (confirm → counts);
- the buttons hidden on the admin's own account.

**Guards:**
- `adminGate.writes` (unchanged: no new write handler with Q-1 option A) and the authz surface guard (the new GET);
- `enforcementPoints`;
- the repository's `…ForWebhook` guard (unchanged);
- the source guard that `boostCapAdminOps.ts` imports nothing from the entitlements module.

**CI:** mocked suites in existing jobs; no added time.

---

### 5.1 Results (Dev, 2026-10-09): 6a

**What was built:**
- **`listCapOverrides(accountId, { limit })`** (repository): the history columns (`ended_at`, `ended_by_admin_id`, `ended_reason` added), scoped `.eq('user_id')`, newest first, at most 20.
- **`lib/business-os/boost/boostAdminView.ts`** (pure; types-only imports, so the client block shares it) and **`boostAdminViewTypes.ts`**:
  - the admin status words (`dispute_lost` → "Chargeback lost (payment reversed)", `flagged_mismatch` → "Needs review") and chip tones;
  - the flag reasons in words (2b N-3);
  - `stripeDashboardUrl(kind, id, livemode)` (C-4: `^pi_[A-Za-z0-9]{1,250}$`, `^(dp|du)_…$`, `/test/` from the row's mode; anything else → null);
  - `formatMinorAmount` (one currency at a time);
  - the field-by-field payload builder and the newest-first merge of both modes.
- **`GET /api/admin/business-os/credits/accounts/[accountId]/boost`**:
  - the 11c order: `requireAdmin` first → Zod uuid 400 → lower-case + `resolveAccountId` → platform 409 → tenant 404 / 500;
  - the account only from the path;
  - two blocks that fail on their own: purchases (both modes, at most 50 each, `truncated` per mode) and cap (the default from `BOOST_PURCHASE_CAP_DEFAULT`, the active override, the last 20 changes);
  - `serverMode` for display only;
  - no write, no audit, one `info` log with ids, statuses and counts.
- **`app/admin/users/components/BoostBlock.tsx`**, mounted right after `CreditsBlock` in `BusinessOsPanel.tsx`: the "Credit top-ups" block described in §3.2. **6a has no action:** no button, form or link that changes anything.
- **Registers:**
  - admin access row **103**, census 100 = 94 + 6 + 0 open, 70 files;
  - entitlements `KNOWN_NON_GATE_IMPORTERS` (the route: `BOOST_PURCHASE_CAP_DEFAULT`, `isBusinessOsTenant`, `resolveAccountId`);
  - the plan-repository referrer guard (RC-15) allows the route and its test, exactly as the 11c route is allowed (it passes the plan repository to the tenant check, read only).

| Run (scratch configs, `--runTestsByPath`, `--ci`) | Result |
|---|---|
| Route test: 17. The gate first, with nothing read on 401 / 403 / a throwing check / a throwing auth; 400; platform 409; tenant 404 / 500; the account only from the path, lower-cased, the query string ignored; both modes merged with each row's mode; the flagged row and reason; truncation; each block failing alone; no override; own account; an unreadable key; pinned payload keys (no email, secret or receipt link); logs without reasons, Stripe ids or email; source guards (no `…ForWebhook` / reconcile read, no body read, no write, only route exports) | ✅ |
| `boostAdminView.test.ts`: 22. Every status has words; tones; **every flag reason the boost code can write on a stuck purchase has words** (a source scan of 4a `flagRow`, 4b.2 `finding` / `raceOrFinding` and 2b's reasons; audit-only codes listed); **C-4**: a test row on a live key → `/test/`, a live row → no `/test/`, and 12 malformed or wrong-kind ids → null; money; the payload has no account or receipt link; the module has no value import | ✅ |
| Repository: 84 (+3: the exact `listCapOverrides` query; **2a I-2**: with a detached `user_id` NULL override in a fake table, neither the history nor `findActiveCapOverride` returns it; refusals and errors) | ✅ |
| `boostBlock.render.test.tsx`: 29. States (loading, error in words, a body of another shape, network); empty; each block failing alone; both modes with a badge per row; the test-key note; seven statuses in words with the raw status on hover; a flagged reason in words (code on hover) and an unknown code raw; paid, tax, refunded and credits; truncation; **C-4 links**: a test row on a live key, a live row, a malformed id as text, `rel="noopener noreferrer"`, the session never linked; the limit (override with admin, date, reason; default); the history (ended with a reason, replaced); a reason with markup rendered as text; **no action in 6a** (no button, no form, no reconcile or take-back words) | ✅ |
| `businessOsPanel.render.test.tsx`: 22 (+1: the block mounts right after Credits and reads its own route) | ✅ |
| `test:bos-entitlements` set (the package.json paths) | ✅ **228 suites, 6,049 tests** |
| `test:authz-guard` equivalent (`admin-authz-surface` + `security-definer-surface`) | ✅ |
| Broad set (`--ci`, 354 files: the 4b.2 set plus `app/admin/users`, the entitlements tests, the new suites) | ✅ **353 suites, 10,055 tests, 110 snapshots**; no snapshot file changed. The one red suite is the environmental `stripePlanPriceScripts` (no `node_modules/tsx` in this worktree) |
| `oneAddressPolicy` on a Linux-path copy (deleted after) | ✅ 4 |
| Types-first tsc (`tsconfig.6a.json`, the bracketed route files listed explicitly) | ✅ **0 errors in 6a files** (3 elsewhere, `lib/geo/countries.ts`, untouched) |

**Deviations:**
1. **No `limits` in the 6a payload.** It arrives with 6b's actions and the BQ-1 ceiling.
2. **Two reads for the limit:** `findActiveCapOverride` (the active one) and `listCapOverrides` (the history), both scoped. The active one is not derived from the history, so a history read cut at 20 can never hide it.
3. **The plan-repository referrer guard (RC-15)** needed the route and its test in `ALLOWED`. This is the same entry the 11c route has, because both pass the plan repository to `isBusinessOsTenant`.
4. **The block checks the body's shape** (`purchases` / `cap` with a status) and treats anything else as an error. It is defensive, and it also keeps the panel test's prefix-matched URL stub from feeding it the Credits body.
5. **Audit-only finding codes are not given words.** Those are the codes 4b.2 writes only to the audit, never to `flag_reason` (on disputed or paid rows, or after a failed SQL call). The test lists them explicitly, so a new flaggable code without words fails.
6. **The checkout session** is shown shortened with the full id on hover, never linked. Stripe has no stable dashboard page for it.

**Review fixes (Dev, 2026-10-10): SA CR-1, SA N-1, QA6a-L1, QA6a-L2.**

| # | Change | Tests |
|---|---|---|
| **SA CR-1** | `boostAdminView.ts` no longer has its own `formatMinorAmount` (it divided by 100). The block calls the shared `formatMinorAmount(minor, currency, 'en')` from `lib/business-os/currency.ts` (the `refundMath` minor-unit rule), through a small `money()` helper that keeps the "unreadable" guard at the call site and never throws. Whole amounts now read "$150", other amounts "$27.50", in the currency's own digits | A source test: the view module has no `/ 100`, no `Intl.NumberFormat` and no formatter, and the block imports the shared one. Render: a USD whole amount "$25" and a JPY amount "¥2,500"; the expected strings updated ($150, $500, $10, $27.50 incl. tax $2.50) |
| **SA N-1** | The new GET answers with `Cache-Control: private, no-store` | Route test asserts the header |
| **QA6a-L1** | `readView` checks the **whole** shape before anything is drawn (`isAdminBoostView`: every purchase row with its `stripe` object, `truncated` with both flags, the cap with `default`, `active` or null, and `history` with every change). Any other 200 body shows "Credit top-ups could not be read" instead of throwing | Five cases (a cap without history, without default, a row without stripe, purchases without truncated, a null row) → the error line, no partial block |
| **QA6a-L2** | The truncation note names the mode: "Showing the latest 50 test top-ups." / "… live top-ups." / "… test and the latest 50 live top-ups." | Three cases plus "no note" |

**Re-run:** the 6a suites 183 green (route 17, view 22, block 38, panel 22, repository 84). Broad set (`--ci`, 354 files): **353 suites, 10,064 tests, 110 snapshots**, no snapshot changed; the one red suite is again the environmental `stripePlanPriceScripts`. Types-first tsc: **0 errors in 6a files** (3 elsewhere, `lib/geo/countries.ts`, untouched). ESLint cannot run in this worktree (no `node_modules`, by rule); CI runs it.

## 6. Estimate and risks

| Item | Value |
|---|---|
| Estimate | **About 2–2.25 days:** 6a about 1 d, 6b about 1–1.25 d |
| Split | **Proposed** 6a / 6b. 6a is useful alone (support can see what happened); 6b adds the writes |
| Migration | None |
| Entitlements | One non-gate import registration (6a); `adminOps.ts` changes inside the module (6b) |

| Risk | Mitigation |
|---|---|
| An admin sees another account | Account only from the path, after the gate and the tenant check; every read scoped by `user_id` |
| A wrong or huge limit | Reason required, two-step confirm restating the old and new figure, an upper bound (BQ-1), audited |
| A detached override shown as active | Scoped reads; a test with a `user_id` NULL row |
| The admin op union grows inside the entitlements module | The boost op module imports nothing from entitlements (one-way dependency, as 11b); `test:bos-entitlements` in the definition of done |
| The reconcile button read as "this account only" | The label and the confirm both say "all accounts" (Q-5 offers the jobs page as its home instead) |

---

## 7. Questions for SA

| # | Question | Dev proposal |
|---|---|---|
| Q-1 | Where do the cap override writes go? **(a)** two ops in the entitlements admin op route, as 11b did for credits (R-12: "the same admin ops path"), or **(b)** a dedicated `POST …/credits/accounts/[accountId]/boost/cap` route with its own ops module | **(a):** own account, platform, tenant and plan-row checks, the audit writer and the flush come for free; no new write handler, so `adminGate.writes` is unchanged. Cost: `adminOps.ts` (inside the module) learns two more ops |
| Q-2 | No idempotency key on the cap functions: is "one POST at a time in the UI, a replay only re-sets the same figure and writes a second audit row" acceptable? | Yes. A request-id column would be a migration for a rare, harmless repeat |
| Q-3 | Take back from a purchase: open 11c's `CreditFormDialog` directly on the purchase's lot (a callback through the panel), or link to the lot in the Credits block above? | Open the dialog directly. It reuses the 11c dialog and the server path unchanged |
| Q-4 | "Counted toward the limit so far": show it (needs a read-only SQL function, i.e. a migration, or a TypeScript copy of the reservation's rule), or leave it out of v1? | Leave it out; propose it as a follow-up with a read-only function |
| Q-5 | The reconcile button's home: the per-account block (as asked) or the jobs page next to `bos-billing-reconcile`? It acts on **all** accounts | On the block, labelled "(all accounts)", as asked; a second copy on the jobs page can follow |
| Q-6 | Should the purchase row also show its audit trail (for example a `BOS_BOOST_FLAGGED` on a disputed row, which does not change the status)? | Not in slice 6 (another audit read with its own guard); propose as a follow-up with the global flagged list (6c) |
| Q-7 | Payload: both Stripe modes in one answer (two reads of at most 50) with a mode badge per row, or only the server key's mode? | Both modes: an admin investigating a test purchase in production needs it, and the badge removes any doubt |

## Business questions

**BQ-1: the highest spending limit an admin may set for one business.**
- The default is $150 per 30 days, and the database requires only "above zero". Without a ceiling, a typo ($15000 instead of $1500) would let one business buy 100 times the normal amount in a month.
- **Proposal:** a ceiling of **$1,500 per 30 days** (10 times the default). It can be raised in configuration later.
- The two-step confirm restates the old and new limit.
- This is the user's call, because it limits how much one customer can pay.
- ✅ **Decided by the user 2026-10-10: $1,500 per 30 days**, configurable (a config constant beside `BOOST_PURCHASE_CAP_DEFAULT`, never a literal). **This binds 6b** (SA C-3: `capMaxMinor` = 150000).

---

## SA Review Notes

### SA Workplan Review

**Reviewed by SA — 2026-10-09, against `90c33582`**
**Status:** ✅ Approved with conditions (C-1 to C-6). The Dev writes them in first, and no second review is needed. BQ-1 stays with the user; my view is below.

The slice reuses the right infrastructure: 11c's per-account view and its route order, the boost repository's scoped reads, 11b's admin-op path and dialog, and the 4b.2 reconcile route. It adds no migration and makes no owner-facing change.

#### The points asked

- **Q-1, the entitlements admin-op route:**
  - **CLAUDE.md admin rules:** the route already gates with `requireAdmin` as its first statement, so adding two ops changes no gate semantics.
  - **Entitlements registration:** `boostCapAdminOps.ts` (outside the module) imports **nothing from** the entitlements module. `adminOps.ts` (inside it) imports **from** the boost file, which is the same one-way direction as 11b's `creditAdminOps.ts`, so no registration is due. The skill covers imports *into* outside files from the module.
  - **`adminGate.writes` stays unchanged** (no new write handler).
  - The ops must be added to the platform-account refusal set (C-1).
- **Tenant isolation of the new GET:** the account comes only from the path, after `requireAdmin` → Zod → lower-case → `resolveAccountId` → platform 409 → tenant 404, the 11c order. Every read is `.eq('user_id')`, and no `…ForWebhook` finder is used. A payload allow-list with pinned keys rounds it out. ✅
- **Cap-change audit:** `business_os_account_plan` is classified **`operator`** in `ownerVisibility.ts`, so the entries are owner-hidden per BD-26. That is the right home: the cap is account-level, and it sits with 11b's account-level admin trail. ✅
- **Stripe links:** built only from regex-checked ids, with the **row's own `livemode`** choosing `/test/` (C-4). ✅
- **Double submit (Q-2):** 11b uses a `requestId` idempotency key because a duplicate grant **adds credits**. A duplicate cap set only repeats the same value, so a SQL idempotency key is not needed. A cheap server-side no-op still closes it fully (C-2).
- **Admin authz guard and census:** the new GET is a gated handler. The required guard passes it with no cap change, and register row 103 plus the census are in scope. ✅
- **No owner-facing change.** ✅

#### Conditions

| # | Severity | Condition |
|---|---|---|
| **C-1** | Low | **Platform-account refusal:** `adminOps.ts` step 1b ("credit ops only") must also cover `set_boost_cap` / `end_boost_cap` (409 `platform_account`), alongside the own-account 403 set. Test both. |
| **C-2** | Low | **The duplicate-submit no-op (Q-2):** before writing, `set_boost_cap` reads `findActiveCapOverride`. If the active override already has the **same amount**, answer 200 with `{ unchanged: true }`, with **no write and no audit**. `end_boost_cap` already answers `none_active` (409) on a repeat. The UI one-at-a-time guard stays as well. |
| **C-3** | Low | **Bounds and units:** `amountMinor` is an integer from 100 to `capMaxMinor` **and a whole-dollar multiple** (`% 100 === 0`), matching the dialog. The ceiling is **a config constant** beside `BOOST_PURCHASE_CAP_DEFAULT`, not a literal in the ops file (see BQ-1). The confirm step restates the old and new limit and the window. |
| **C-4** | Low | **Stripe links:** `stripeDashboardUrl(kind, id, livemode)` takes `livemode` from the **row**, never `serverMode`. Ids are anchored by regex (`^pi_[A-Za-z0-9]+$`, …), links open with `rel="noopener noreferrer"`, and anything else renders as text. Test a test-mode row on a live key, and a malformed id. |
| **C-5** | Low | **Take back (Q-3):** open 11c's `CreditFormDialog` directly on the purchase's `lotId`. The dialog still sends `reduce_credit_lot` with `confirmPaidCredits` (the boost lot is `boost_purchase`), and the 11b server checks are unchanged. If the lot is not in `CreditsBlock`'s loaded set (expired, or not loaded yet), show "Take back in Credits above" instead of guessing. |
| **C-6** | Info | **The reconcile button (Q-5):** keep it on the block with the "(all accounts)" label and the confirm text as planned. It must not pass the account id: the 4b.2 route takes an empty body. |

#### Rulings on Q-1 to Q-7

| Q | Ruling |
|---|---|
| **Q-1** | **(a):** two ops on the entitlements admin-op route, with C-1. |
| **Q-2** | **Yes**, with C-2's server-side no-op. No SQL key. |
| **Q-3** | **Open the dialog directly**, with C-5's fallback. |
| **Q-4** | **Leave it out of v1.** A follow-up uses a read-only SQL function (no TypeScript copy of the rule). |
| **Q-5** | **On the block**, labelled "(all accounts)" (C-6). A jobs-page copy can follow. |
| **Q-6** | **Not in slice 6;** with 6c. |
| **Q-7** | **Both modes**, with a per-row mode badge. |

#### BQ-1 (SA view, for the user)

**I agree with $1,500 per 30 days (10× the default) as the ceiling an admin can set, held in configuration.** It stops a typo or a mistaken extra zero from letting one business spend 100× the normal amount. A genuine need above it is rare enough to be a reviewed config change. The two-step confirm and the audit trail make every change visible.

#### Approval

[x] Workplan approved with conditions C-1 to C-6. Proceed with 6a. 6b's ceiling waits on BQ-1, or uses $1,500 if the user agrees.

### SA Code Review (6a)

**Code Review by SA — 2026-10-09**
**Status:** 🔄 **Fix Required: one small item (CR-1, Low).** Everything else is approved. SA re-checks only that diff, and the code then goes to QA.

#### What I verified myself

| Check | Result |
|---|---|
| 8 suites (`--ci`): the route, `boostAdminView`, `boostBlock`, `businessOsPanel`, the repository, `enforcementPoints`, `businessOsEntitlements.imports.guard`, **`admin-authz-surface.guard`** | ✅ **413 passed** |
| Mutation M1: the Stripe link's test / live path inverted | ✅ Caught (view, 1 red) |
| Mutation M2: `listCapOverrides` without `.eq('user_id')` | ✅ Caught (repository, 2 red) |
| Restoration after each mutation | ✅ SHA-1 checked |
| `console.*` in the new files | ✅ 0 |

#### The points asked

- **Tenant isolation of the GET:** `requireAdmin` is the **first statement**, then Zod uuid → lower-case → `resolveAccountId` → platform 409 → `isBusinessOsTenant` 500 / 404, the 11c order. The account comes **only** from the path. The reads are `listForAccount` (per mode, `.eq('user_id')`), `findActiveCapOverride` (`.eq('user_id')`, `ended_at IS NULL`) and `listCapOverrides` (`.eq('user_id')`, newest first, capped); M2 proves the scope. No `…ForWebhook` finder is used. The payload is built field by field (`toAdminBoostPurchaseRow`): Stripe **ids** only, with **no `receipt_url`, email, client secret or key**, and the keys are pinned by the tests. ✅
- **I-2:** a detached override (`user_id` NULL) can never match `.eq('user_id', accountId)`, so it is never shown as active or in the history; the test pins it. ✅
- **C-4, the Stripe links:** `stripeDashboardUrl(kind, id, row.livemode)` uses the **row's** mode (M1). Ids are anchored by regex (`^pi_…$`, `^(dp|du)_…$`), links open with `rel="noopener noreferrer"` and anything else is text. The checkout session id is shortened and never linked (deviation, accepted). ✅
- **Q-7:** both modes are read and merged newest first, with a per-row `Test` / `Live` badge and `truncated` per mode. ✅
- **Admin authz guard and census:** the new gated GET passes the required guard. Register row 103 is added, and the census is 100 = 94 + 6 + 0 over 70 files. ✅
- **Entitlements:** a `KNOWN_NON_GATE_IMPORTERS` entry for the route, plus the RC-15 allow-list entry in `businessOsEntitlements.imports.guard` (the 11c precedent). ✅
- **No writes and no audit** (a plain read, the 11c precedent). **Owner-facing surfaces unchanged.** RTL does not apply (admin English). ✅

#### §5.1 deviations: all accepted

- No `limits` field in 6a (it arrives with 6b).
- Two scoped reads for the limit.
- The RC-15 allow-list.
- The strict payload shape.
- Audit-only reasons have no words (raw code shown).
- The session id is shortened and never linked.

#### Findings

| # | File | Finding | Priority |
|---|---|---|---|
| **CR-1** | `lib/business-os/boost/boostAdminView.ts` (`formatMinorAmount`) | **A second money formatter using `/ 100`.** It duplicates `lib/business-os/currency.ts`'s `formatMinorAmount` and breaks NFR-9 (minor units through `refundMath`, never a typed `/ 100`; the slice 5a C-1 precedent). USD makes it correct today, but it is the pattern NFR-9 forbids. **Fix:** delete it and call `formatMinorAmount(minor, currency, 'en')` from `currency.ts` (client-safe), keeping the `'unreadable'` guard for a non-finite value at the call site. Update the view test. | **Low (must-fix)** |
| N-1 | the route | Info: like 11c's route it sets no `Cache-Control`. An admin JSON read behind `requireAdmin` is not cached by shared caches here. Add `private, no-store` if 6b touches the route, for consistency with the owner routes. | Info |

#### Code Approved for QA: **No, pending CR-1** (a re-check of that diff only)
**SA re-check of the 6a fixes (2026-10-10, diff only):** ✅ **Code Approved for QA.** CR-1: the local formatter is gone, and `BoostBlock` uses `currency.ts` `formatMinorAmount` through a guarded `money()` (NFR-9). N-1: the GET answers with `Cache-Control: private, no-store`. QA L1: `isAdminBoostView` rejects a malformed payload as "could not be read" instead of throwing. QA L2: the truncation note names the mode. 99 tests in the four 6a suites green.

## QA Testing Report

### QA — 6a (2026-10-09)

**Test mode:** full
**Strategy used:**
- **A + B (Jest, mocks only):** three scratch suites against the uncommitted 6a code, plus the Dev's suites and the guards. No real Supabase or Stripe, and no dev server.
- **D (manual browser) skipped:** the block's critical path is pinned by render tests, and there is no safe non-PROD data to browse.
- **Mutation probes skipped:** SA was reviewing the same tree in parallel. Behaviour is pinned directly instead.
- Every run is SHA-bracketed (13 source files, PRE_OK / POST_OK), and the worktree was unchanged at the end.

**Focus:** api, ui, security
**Skipped:** the manual browser check (as above); mutation probes (SA active)
**Input source:** prompt keywords (coordinator)
**Code under test:** the 6a diff as SA reviewed it, **before SA CR-1** (formatting money through `currency.ts`). The money rows below must be re-run once CR-1 lands.

#### Test Coverage
| Area | Tested? | Result | Notes |
|---|---|---|---|
| Gate first | ✅ | Pass | No user, `getUser` throws → 401. Non-admin, admin check throws → 403. Each also with a malformed id and the platform id: never 400 / 409 first. **No tenant or boost read** on any denial, and no payload in the body |
| Path id | ✅ | Pass | 10 malformed ids → 400 `invalid_account_id`, nothing read: empty, `abc`, leading or trailing space, braces, suffix, `../`, no dashes, SQL-ish, `%00`. An upper-case id is lower-cased for the tenant check and all three reads, and `isOwnAccount` compares case-insensitively. `?accountId=<other>` in the query is ignored (no read names it) |
| Platform / tenant | ✅ | Pass | The all-zero id and `SYSTEM_ADMIN_USER_ID` (either case) → 409 `platform_account`, before the tenant check. Not a tenant → 404 with no boost read. Tenant check null → 500. A thrown check → 500 with no details outside development |
| Payload | ✅ | Pass | **Exact keys** pinned at every level: top, purchases, row, `stripe`, cap, active, default, history. The repo rows carried `email`, `clientSecret`, `stripeSecret` and a receipt URL, and **none passes the allow-list** (no `@`, `secret`, `receipt`, `sk_live` in the body). The session id is in the payload as an id only and is never linked |
| Isolation | ✅ | Pass | A fake table held another account's purchases and active override, a detached override (`user_id` NULL, `ended_at` NULL), and A's own rows. A sees only A's rows for the history, the active override and the purchases in each mode. **The detached override is never active or listed** |
| Both modes / truncation | ✅ | Pass | Interleaved test and live rows come back merged newest first, each with its own `livemode`. 50 rows in one mode → `truncated` for that mode only |
| History max 20; active never hidden | ✅ | Pass | 30 ended overrides plus an active one **older than all of them**: the history returns 20, all A's, newest first, and `findActiveCapOverride` still returns the active one. The limit clamps 100→20, 0→1, −5→1, 2.9→2. The route passes no limit, so the repository default of 20 applies |
| Per-block failure | ✅ | Pass | A failure in the test list, the live list, the active read or the history → only that block is `{status:'error'}`, the other block is intact, and the response is 200 |
| serverMode | ✅ | Pass | `sk_test` → test, `sk_live` → live, missing or garbage key → null |
| Logs | ✅ | Pass | No reason, Stripe id, email, amount or receipt in logs. The route exports `GET`, `runtime` and `dynamic` only |
| Block: status words | ✅ | Pass | All 11 statuses in words, raw on hover, including "Chargeback lost (payment reversed)", "Waiting for a delayed payment" and "Needs review". An unknown status shows raw |
| Block: flag reasons | ✅ | Pass | **All 22 reason codes** render as "Needs review: <words>" with the code on hover. An unknown code shows raw. A null reason gives the chip only. A reason on a non-flagged row is not shown |
| Block: money | ✅ | Pass (pre-CR-1) | "$27.30 (incl. tax $2.30)", "Refunded $10.00" (only when above 0), an unpaid row falls back to the price ($50.00), a lower-case `usd` row formats, credits group ("28,750 credits"). **Re-run after CR-1** |
| Block: Stripe links (C-4) | ✅ | Pass | The **row's** mode decides `/test/` regardless of the server key: a test row on a live key → `/test/`, a live row on a test key → none. Both `dp_` and `du_` disputes link. 15 malformed payment ids → plain text with no anchor: XSS, `javascript:`, `?`, `#`, `/../`, whitespace, a newline, a Cyrillic look-alike, 251 characters, `ch_` / `dp_` in the payment slot, a full URL. 5 malformed dispute ids → text. Every anchor has `target="_blank"` and `rel="noopener noreferrer"`. The session is never linked |
| Block: per-section errors | ✅ | Pass | Purchases error with the cap OK, the cap error with purchases OK, and both errors: each says so in words. **No "$0.00", "0 credits" or default $150 is drawn** for the failed section |
| Block: empty / notes | ✅ | Pass | "No top-ups yet." plus the test-key note. A null server mode → no note. Truncation note shown |
| Block: payload shape | ⚠️ | Partial | No data, `success:false`, missing `purchases`, `rows` missing or not an array, a strange cap status → error in words. **Five other shapes make the block throw on render** (QA6a-L1) |
| Block: HTTP / network | ✅ | Pass | 403 → generic words, 409 `platform_account` → words, 500 / non-JSON / network → generic |
| Block: read-only, text-only | ✅ | Pass | No button, form, input, select, textarea or `role=button`. Markup in a flag reason, an override reason, a history reason or an ended reason renders as text (no `<img>` / `<b>` element). No "take back", "reconcile" or "set limit" words. The account id is URL-encoded, with `cache: 'no-store'` |
| No `console.*` | ✅ | Pass | None in the route, `boostAdminView*.ts` or `BoostBlock.tsx` |
| Regression bar | ✅ | Pass | The `test:bos-entitlements` set plus `test:authz-guard` plus `boostAdminView.test.ts`, listed explicitly (the bracketed route files included): **226 suites, 6,125 tests green**, 0 snapshots changed. 2 unchanged `.ts` suites that import JSX needed the JSX config and pass there (13). Types-first tsc (`tsconfig.6a.json`, bracketed files listed): **0 errors in 6a files** (3 in the untouched `lib/geo/countries.ts`) |

#### Issues Found

##### Bugs (must fix before commit)
None.

##### Edge Cases (nice to fix)
1. **QA6a-L1: some malformed bodies crash the block instead of showing the error.** File: `app/admin/users/components/BoostBlock.tsx` (`readView`). Severity: Low.
   - **Steps to reproduce:** answer the GET with any of these 200 bodies:
     - `cap: {status:'ok'}` without `history`;
     - `cap: {status:'ok'}` without `default`;
     - a row without `stripe`;
     - `purchases: {status:'ok'}` without `truncated`;
     - a `null` row.
   - **Expected:** "Credit top-ups could not be read."
   - **Actual:** a render TypeError. React unmounts the tree, and `app/admin` has no `error.tsx`, so the whole Businesses panel goes, not just the block.
   - **Why Low:** only our own route builds this body, so it needs a deploy skew or a future shape change (6b will extend the payload).
   - **Fix:** check `cap.default` / `history` and `truncated` in `readView`, plus each row's `stripe` object, or wrap the block in a small error boundary.
2. **QA6a-L2 (wording): "Showing the latest 50 in this mode."** sits under one merged list of both modes, so it doesn't say which mode was cut. Severity: Low. Suggested: "Showing the latest 50 test-mode top-ups" / "live-mode", from `truncated.test` / `truncated.live`.

##### Observations (no action needed)
- A repository that **throws**, rather than returning an error, fails the whole response with a 500, not per block. Repositories return errors through `fail()`, so this is theoretical.
- The "Paid" cell shows the package price for unpaid rows (pending, expired, abandoned), as §3.2 specifies. A "price" label on unpaid rows would read more clearly; that is a product choice.
- An upper-case id passed straight to the repository matches nothing. The route lower-cases first, so this is fine; the repository relies on its callers for that.

#### Test Outputs / Logs
```text
QA route + repo (node):  2 suites, 43 tests passed
  platform all-zero / SYSTEM_ADMIN_USER_ID upper path / upper env -> 409, nothing read
  listCapOverrides options from the route: undefined (repo default 20); active (older than 20 ended) still returned
  thrown repo -> 500
QA block (jsdom):        70 tests, 65 passed, 5 failed = QA6a-L1 (malformed shapes)
  paid cells: ["$27.30 (incl. tax $2.30)","$50.00","$1.05 (incl. tax $0.05)"]
  shape cap ok without history|default, row without stripe, no truncated, null row: errorShown=false blockGone=true
Bar (explicit paths, --ci): 219 + 7 suites, 5,891 + 221 tests (+13 re-run under the JSX config), 0 snapshots changed
tsc tsconfig.6a.json: 3 errors, all lib/geo/countries.ts (untouched); 0 in 6a files
SHA bracket: PRE_OK / POST_OK on every run; git status unchanged
```

#### Final Status
- [x] **QA PASS WITH NOTES.** All the focus criteria pass, and no Bug is open.
  - Ready for commit once SA CR-1 lands and QA re-runs the money rows: `boostBlock6a` "money" and `boostAdminView` money.
  - QA6a-L1 and L2 are Low. They are recommended now, because 6b changes the payload; deferring them is acceptable.
- [ ] Issues found that the Dev must address before commit

### QA re-check (6a) — 2026-10-10

**Scope:** the §5.1 "Review fixes" diff only: SA CR-1 (the shared money formatter), SA N-1 (`Cache-Control`), QA6a-L1 (the full shape check) and QA6a-L2 (the truncation note names the mode).
**Strategy:** A (Jest; my scratch suites patched for the fixes, plus a copy of the panel test). Every run is SHA-bracketed (13 source files, PRE_OK / POST_OK), and the worktree was unchanged at the end.

| Check | Result | Evidence |
|---|---|---|
| CR-1: money through `currency.ts` `formatMinorAmount` | ✅ | **USD whole** "$25"; **fraction** "$27.30 (incl. tax $2.30)" and "$27.50 (incl. tax $2.50)"; mixed "$100.50 (incl. tax $10)"; cents only "$0.05"; large "$1,234,567.89"; **JPY** (zero-decimal) "¥2,500 (incl. tax ¥227)" and lower-case `jpy` "¥1,000". **Refunds:** "Refunded $10.50", "Refunded $25", "Refunded ¥500". An unpaid row falls back to the price ("$150"). An unknown currency or NaN → "unreadable", never a throw. **Limit:** "Default: $150 per 30 days", override "$1,234.50 per 30 days", history "set to $300". `boostAdminView.test.ts` (the source test: no `/ 100`, no own formatter) and `currency.formatMinorAmount.test.ts` (9) are green |
| L1: the five malformed 200 bodies | ✅ | Tested on the block and **inside the full Businesses panel**: a cap without `history`, without `default`, a row without `stripe`, purchases without `truncated`, a `null` row. Each shows "Credit top-ups could not be read." and draws no purchase or limit. **No render error, and the Credits block stays up.** The six shapes that already passed still pass |
| L2: the note names the mode | ✅ | test only → "Showing the latest 50 test top-ups."; live only → "… live top-ups."; both → "Showing the latest 50 test and the latest 50 live top-ups."; neither → no note |
| N-1: `Cache-Control: private, no-store` | ✅ | On the 200 |
| Everything else from QA — 6a | ✅ | Re-run unchanged: the gate first with nothing read, the id handling, the platform / tenant order, exact keys, isolation and detached overrides, the history of 20 with the active override kept, both modes, per-block errors, C-4 links, read-only |
| Regression | ✅ | The Dev's 6a suites, the 11c route, `enforcementPoints`, the imports guard, the authz surface guard and the currency test: 10 suites, 466 tests green. Types-first tsc: **0 in 6a files** (3 in the untouched `lib/geo/countries.ts`) |

**Observation (no action needed):** the error answers (400 / 403 / 404 / 409 / 500) carry no `Cache-Control` header. They hold no account data, and Next does not cache a dynamic route's answer, so this is consistency only. N-1 asked for the header on the data answer.

```text
QA block + panel (jsdom): 2 suites, 116 tests passed   QA route + repo (node): 2 suites, 45 tests passed
Dev 6a set + guards: 9 suites, 457 tests   currency.formatMinorAmount: 9 tests   tsc: 0 in 6a files
```

#### Final Status (re-check)
- [x] **QA PASS.** SA CR-1 and N-1 and QA6a-L1 and L2 are confirmed, and nothing regressed. 6a is ready for the user's diff once SA's re-check also approves.
- [ ] Issues found

## Commit Info

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-09 | Workplan drafted | Slice 6 split 6a (read view) / 6b (limit actions, reconcile button, Take back link); Q-1 to Q-7 for SA; BQ-1 (the highest limit) for the user. Branch `feature/bos-credits-boost-slice-6` from `90c33582`. No code |
| 2026-10-09 | SA workplan review: approved with conditions | Q-1 (a): the entitlements admin-op route, which imports nothing forbidden and changes no gate semantics. C-1 platform-account refusal for the boost ops. C-2 server-side no-op on a repeated identical set. C-3 whole-dollar bounds with the ceiling as config. C-4 Stripe links from the row's own mode and anchored ids. C-5 Take back via the 11c dialog with a fallback. C-6 the reconcile button sends no account. Cap audits on the operator-only `business_os_account_plan`. BQ-1: SA agrees with $1,500 |
| 2026-10-09 | 6a implemented, awaiting SA code review | C-1 to C-6 written into §3.0. The read-only "Credit top-ups" block on the Businesses panel, its admin GET (row 103, census 100 = 94 + 6 + 0), `listCapOverrides`, the view helpers (C-4 links, N-3 reason words), registrations. Results and six deviations in §5.1. Nothing committed |
| 2026-10-09 | SA code review (6a): Fix Required | 413 tests green; mutations caught (Stripe test/live path inverted, cap history unscoped). Tenant isolation, I-2, C-4 links, Q-7, authz guard and census, entitlements registration, no writes, owner unchanged: all verified. CR-1 (Low): reuse `currency.ts` `formatMinorAmount` instead of a `/ 100` copy (NFR-9) |
| 2026-10-09 | QA (6a): PASS WITH NOTES | Mocks only, SHA-bracketed. Gate first with nothing read; 400 / 409 / 404 / 500 order; upper-case id lower-cased everywhere; exact payload keys with no email, secret or receipt; other accounts and detached (`user_id` NULL) overrides never active or listed; history 20 with the active override read on its own; both modes with a badge per row; all 11 statuses and 22 flag reasons in words; C-4 links from the row mode (15 malformed ids → text); per-section errors draw no zeros; read-only. Bar 226 suites / 6,125 tests green; tsc 0 in 6a files. QA6a-L1 (Low): 5 malformed bodies crash the block instead of the error line. QA6a-L2 (Low): truncation note does not name the mode. Money rows to re-run after SA CR-1 |
| 2026-10-10 | 6a review fixes applied | SA CR-1: the shared `formatMinorAmount` from `lib/business-os/currency.ts` replaces the view's own `/ 100` formatter. SA N-1: `Cache-Control: private, no-store`. QA6a-L1: the full payload shape is checked before drawing (five malformed 200s tested). QA6a-L2: the truncation note names the mode. Results in §5.1. Nothing committed |
| 2026-10-10 | SA re-check of the 6a fixes: Code Approved for QA | CR-1 shared money formatter, N-1 `no-store`, QA L1 / L2. 99 tests green |
| 2026-10-10 | QA re-check (6a): PASS | The shared formatter is in use: USD whole "$25", fractions "$27.30", JPY "¥2,500", tax and refunds in their own currency, never a throw. The five malformed bodies show "Credit top-ups could not be read", with no render error and the Credits block still up inside the full panel. The truncation note names test / live / both / none. The 200 carries `Cache-Control: private, no-store`. Dev 6a set and guards green; tsc 0 in 6a files |
| 2026-10-10 | 6a approved and committed, PR open; BQ-1 decided | The user saw the diff and approved the commit (2026-10-10). RM committed on `feature/bos-credits-boost-slice-6` and opened a PR to `main`. BQ-1: the user set the admin ceiling at $1,500 per 30 days, configurable; it binds 6b |
