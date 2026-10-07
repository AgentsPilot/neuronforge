# Workplan: Fix-1, the Connect webhook refuses ids it cannot prove belong to the sending business

> **Last Updated**: 2026-10-07

**Developer:** Dev
**Requirement:** SA ruling "Fix-1" in [BUSINESS_OS_WEBHOOK_CONNECT_REPOSITORIES_WORKPLAN.md](/docs/workplans/BUSINESS_OS_WEBHOOK_CONNECT_REPOSITORIES_WORKPLAN.md) § SA Review Notes (F-1, F-2, F-4; condition C-1). Parent requirement: [BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md) (tenant-isolation ruling).
**Date:** 2026-10-07
**Branch:** `fix/webhook-connect-tenant-ownership` (worktree `neuronforge-webhook-repos`, renamed by RM from `feature/bos-webhook-connect-repos`), off `248de6be`. `origin/main` is 2 docs-only commits ahead; `route.ts` and every file this plan touches are identical on both.
**Status:** Code Complete (uncommitted, per the user's standing rule). SA approved the plan with conditions C-1 to C-5, all applied (§14). Waiting for SA code review and QA. Evidence in §6.6, deviations from the plan in §6.7.

## Overview

Fix-1 is the security PR that the SA ruled must land **before** the webhook repository refactor (PR 0 to PR 5). It changes behaviour on purpose, in four places in `app/api/stripe/webhook/route.ts`, so that the Connect webhook never writes to a row of a business other than the one that owns the sending Stripe account:

| Finding | Handler | Change |
|---|---|---|
| F-1 | `handleConnectInvoicePaid` | Owner check moves **before** the `stripe_invoice_id` write on the metadata-UUID fallback |
| F-1 (defence in depth) | `handleConnectInvoicePaymentFailed`, `…Finalized`, `…Uncollectible` | New owner check after the lookup by Stripe invoice id, before any write |
| F-2 | `handleConnectCheckoutCompleted`, booking branch | Booking update scoped with `.eq('user_id', <account owner>)` |
| F-4 | `handleConnectPaymentIntentSucceeded` | `contact_id`, `booking_id`, `service_id` from metadata are kept only if the owner owns them; a foreign one is dropped to `null` |

No migration. The unscoped `propagate_refund_to_booking` trigger stays as it is (separate migration follow-up, SA ruling). Size: about 1 developer day.

---

## Table of Contents

1. [Scope and non-scope](#1-scope-and-non-scope)
2. [How the owner is resolved](#2-how-the-owner-is-resolved)
3. [Refusal policy (unchanged, reused)](#3-refusal-policy-unchanged-reused)
4. [Changes per handler](#4-changes-per-handler)
5. [Data access: rule 1 and rule 4](#5-data-access-rule-1-and-rule-4)
6. [Tests](#6-tests)
7. [Source guards](#7-source-guards)
8. [CI time](#8-ci-time)
9. [Files to create / modify](#9-files-to-create--modify)
10. [Task list](#10-task-list)
11. [Risks](#11-risks)
12. [New finding (F-5), not in scope](#12-new-finding-f-5-not-in-scope)
13. [Open questions for SA](#13-open-questions-for-sa)
14. [SA Review Notes](#sa-review-notes)
15. [QA Testing Report](#qa-testing-report)
16. [Commit Info](#commit-info)
17. [Change History](#change-history)

---

## 1. Scope and non-scope

**In scope:** the four changes above, a small helper extracted from `accountOwns` (no query change), one lean `findOwnedId` method on each of three repositories (SA C-1), 13 new harness tests and one new fixture, and the intended update of 8 existing snapshot entries (§6.3).

**Out of scope (each tracked elsewhere):**

| Item | Where it goes |
|---|---|
| Harden `propagate_refund_to_booking` (scope the sum and the `UPDATE` to `NEW.user_id`) | Separate migration follow-up (SA ruling) |
| F-3, plan end filters instalments by the Stripe id | Fix-2, after the user's business answer |
| FU-3 (`handleDispute` / `handleChargeRefunded` owner check), FU-4 (H7 / I4 booking update by the owned invoice's `booking_id`, no `user_id`), FU-5 (module-level owner cache) | Follow-ups in the parent workplan §5.3 |
| F-5, plan binding stores an unchecked metadata `booking_id` (§12) | New finding, for SA to place |
| Moving any query to a repository beyond what §5 needs | Refactor PR 0 to PR 5 |
| Any platform (non-Connect) handler | Not touched |

---

## 2. How the owner is resolved

One source of truth for every event: **the account the event came from**. `connectAccountId = event.account` (`route.ts:2286`), which Stripe sets on a Connect event and which the signature covers, so the sender cannot choose it. `resolveAccountOwner` maps it to our business through `stripe_connect_accounts.user_id` (then `plugin_connections`, `lib/payments/stripeAccountContext.ts:435–448`). `accountOwns` (`route.ts:1067–1092`) compares that owner with the row's `user_id`.

New small helper, extracted from `accountOwns` with **no change to its queries or cache**:

```typescript
// route.ts, next to accountOwns
async function accountOwner(connectAccountId: string, log: Logger): Promise<string | null>
// = the body of accountOwns up to `owner` (cache fill via resolveAccountOwner, the
//   'Connect account maps to no known business' warn when null); returns the owner.
// accountOwns becomes: if (!ownerId) return false; return (await accountOwner(...)) === ownerId;
```

`accountOwns(…, undefined)` still returns `false` before touching the cache, so no existing call records a different `resolveAccountOwner` effect. The warn still fires once per call when the account maps to nothing, as today.

| Event / handler | Row it would write | How the write key is chosen | Owner proof before the write |
|---|---|---|---|
| `invoice.paid`, metadata fallback | our `payment_invoices` row | `id` of the row H2 found by the metadata UUID | `accountOwns(connectAccountId, invoiceByMetadata.user_id)` **before** H3 |
| `invoice.payment_failed` / `finalized` / `marked_uncollectible` | our `payment_invoices` row | `id` of the row found by the Stripe invoice id | `accountOwns(connectAccountId, platformInvoice.user_id)` before J2 / K2 / L2 |
| `checkout.session.completed`, booking branch | `scheduling_bookings` | `id` from metadata, **and** `user_id = accountOwner(connectAccountId)` in the filter | The filter itself: a booking of another business matches no row |
| `payment_intent.succeeded` | new `payment_transactions` row | `user_id = ownerId` (already proved, `:647`); `contact_id` / `booking_id` / `service_id` kept only if `findOwnedId(id, ownerId)` returns it | User-scoped `findOwnedId` per id, before the insert |

Ids from the event's metadata are never the proof. Each is either replaced by a row we loaded and then checked against the account's owner, or filtered by that owner.

---

## 3. Refusal policy (unchanged, reused)

Today's stated policy, at `route.ts:1242–1256` ("Refused rather than repaired: there is no benign reading of it") and `:1628–1636`:

| Aspect | Today, and in Fix-1 |
|---|---|
| Log | `log.error({ connectAccountId, <id of the named row> }, '<event> names a <thing> owned by a different business - refusing')`. Static message, ids only (no metadata values, no PII), so `pinoLogging.guard` stays green |
| Control flow | `return` from the handler. No throw |
| HTTP | `200 { received: true }` (snapshot entry 2 shows it) |
| Claim | `completeClaim(event.id)` runs, the event is `completed`. Stripe does **not** retry. Retrying cannot change the answer, and a retry loop is what the 200 avoids |

Fix-1 reuses this exactly:

| Site | Message (new ones copy the existing wording) |
|---|---|
| F-1, metadata fallback | **Reused verbatim:** `'Connect invoice.paid names an invoice owned by a different business - refusing'`, context `{ connectAccountId, invoiceId }` |
| J | `'Connect invoice.payment_failed names an invoice owned by a different business - refusing'`, `{ connectAccountId, invoiceId }` |
| K | `'Connect invoice.finalized names an invoice owned by a different business - refusing'`, same context |
| L | `'Connect invoice.marked_uncollectible names an invoice owned by a different business - refusing'`, same context |
| F-2, account maps to no business | `'Connect checkout names a booking on an account that maps to no business - refusing'`, `{ connectAccountId, bookingId }` |
| F-4 | Not a refusal. The money did arrive in this account (SA ruling), so the row is recorded and only the foreign link is dropped: `log.error({ connectAccountId, paymentIntentId, field, id, reason }, 'payment_intent.succeeded link not proved to belong to the owner - dropping it')`, `reason` `'not_owned'` or `'read_failed'` (C-2), one line per dropped field. 200, claim completed |
| F-2, owner mapped, foreign booking id | The update matches no row; `count === 0` → `log.error({ connectAccountId, bookingId }, 'Connect checkout names a booking owned by a different business - no row updated')` (C-3). 200, claim completed |

---

## 4. Changes per handler

Line numbers are `route.ts` at `248de6be` (blob `0ad6e6a5`).

### 4.1 F-1, `handleConnectInvoicePaid` (`:1094`)

| Lines | Today | Fix-1 |
|---|---|---|
| `:1219–1227` | H2 finds the row by the metadata UUID and sets `platformInvoice` | Unchanged lookup. Then, **inside** `if (invoiceByMetadata && !metadataLookupError)`, first: `if (!(await accountOwns(connectAccountId, invoiceByMetadata.user_id, log))) { log.error({ connectAccountId, invoiceId: invoiceByMetadata.id }, '<reused message>'); return; }` |
| `:1229–1237` | H3 writes `stripe_invoice_id` **before** any owner check | Same H3 query, same chain, now only after the check passed |
| `:1242–1256` | Owner check for whichever lookup found the row | **Kept** as the guard for the H1 (Stripe id) path. On the metadata path it re-runs from the cache, so no second `resolveAccountOwner` call and no second effect |

### 4.2 F-1 defence in depth, `handleConnectInvoicePaymentFailed` (`:1790`)

| Lines | Fix-1 |
|---|---|
| `:1801–1814` (plan branch) | Unchanged (it has its own `accountOwns` at `:1806`) |
| `:1817–1827` (J1) | Unchanged query (already selects `user_id`) |
| new, after `:1827` | `if (!(await accountOwns(connectAccountId, platformInvoice.user_id, log))) { log.error(…J message…); return; }` before J2 (`:1829`). So J2 (overdue), J3 (contact read), J4 (language) and the CRM activity all stay behind it |

### 4.3 F-1 defence in depth, `handleConnectInvoiceFinalized` (`:1897`) and `handleConnectInvoiceUncollectible` (`:1937`)

| Lines | Fix-1 |
|---|---|
| `:1903` (K1), `:1943` (L1) | Column list `'id, invoice_number'` becomes `'id, invoice_number, user_id'`. Same table, filter and terminal. `payment_invoices.user_id` is already selected by J1 (`:1820`) in the same file, so it is a live column (no new column claim) |
| new, after `:1910` / `:1950` | Owner check and the K / L refusal before K2 (`:1912`) / L2 (`:1952`) |

### 4.4 F-2, `handleConnectCheckoutCompleted`, booking branch (`:1761–1781`)

| Lines | Fix-1 |
|---|---|
| after `:1763` | `const owner = await accountOwner(connectAccountId, log); if (!owner) { log.error({ connectAccountId, bookingId }, '<F-2 message>'); return; }` |
| `:1766–1772` (I5) | Same update payload, sent as `.update({...}, { count: 'exact' })` (C-3, never `.select()`); `.eq('id', bookingId)` gains `.eq('user_id', owner)`. Apart from the `count` option the chain matches G5 (`:953`), so PR 4 can map both to one `markPaidForOwner` that takes the option |
| `:1774–1778` | Error and success logging unchanged. New middle branch: `count === 0` (strict; an absent count does not log) → `log.error({ connectAccountId, bookingId }, 'Connect checkout names a booking owned by a different business - no row updated')`, then return as today (200, claim completed) |

The invoice branch's booking update (I4, `:1730`) is FU-4 and is not touched. The plan branch (`:1569–1608`) is F-5 (§12), not touched.

### 4.5 F-4, `handleConnectPaymentIntentSucceeded` (`:610`)

| Lines | Fix-1 |
|---|---|
| `:631–657` | Unchanged (`owner_id` must equal the account owner, else refuse) |
| `:659–669` (F1 dedupe) | Unchanged, still first, so a redelivery costs no extra reads |
| new, after `:669`, before the fee (`:681`) | Vet each link. Only an id that is present is read; nothing is read for an absent one. In insert order: `contactId = await ownedOrNull(intent.metadata?.contact_id, ownerId, 'contact_id', (id, userId) => crmContactRepository.findOwnedId(id, userId), …)`, then `booking_id` with `schedulingBookingRepository.findOwnedId`, then `service_id` with `schedulingServiceRepository.findOwnedId` (C-1). `ownedOrNull` is a top-level helper: absent id → `null`, no read; `!data` → one `log.error` line with `reason: 'not_owned'` (no error) or `'read_failed'` (error set) (C-2), return `null`; otherwise the id. Sequential, not `Promise.all`, so the recorded order is deterministic |
| `:689`, `:702–703`, `:711–712` | The insert uses the vetted `contactId`, `bookingId`, `serviceId` for the columns **and** for the `metadata.booking_id` / `metadata.service_id` copies (older readers fall back to the metadata copy, so leaving it raw would keep the hole open for them) |

Why drop and not refuse: the money is in this account and must be on its books; only the link is untrusted (SA ruling). With `booking_id = null` the insert gives `propagate_refund_to_booking` no `target` (trigger `:56–65`), so it cannot reach another business's booking.

---

## 5. Data access: rule 1 and rule 4

| Access | Decision | Why |
|---|---|---|
| F-4: 3 **new** reads (contact, booking, service) | **One new lean method per existing repository (SA C-1):** `findOwnedId(id, userId)` on `CRMContactRepository`, `SchedulingBookingRepository`, `SchedulingServiceRepository`: `select('id') · eq id · eq user_id · maybeSingle()`. Owned → the id; not found → `{ data: null, error: null }`, **no log**; read error → logged once at `error` as `{ err }`, `{ data: null, error }`. No `deleted_at` / status filter (ownership, not liveness). Unit tests in `lib/repositories/__tests__/findOwnedId.ownership.test.ts` | Rule 1 and rule 4; the Step 2 oracle in its lean form. Not `findById`: the booking one embeds three resources by named FK (an embed failure would strip every link), and all three log at `error` on not-found. Neither repository file imports `lib/business-os/entitlements/`; 0 `console.*` in each (re-checked after the change) |
| K1 / L1: one column added to an existing inline read | Stays inline | Not new access: same query, one more column. PR 2 moves it to `findByStripeInvoiceId(id, LOOKUP)` as already planned (the `LOOKUP` constant then includes `user_id`) |
| I5: one filter added to an existing inline write | Stays inline | Same reason; it **adds** the rule-4 `user_id` filter that was missing. PR 4 moves it |
| H3: moved, not changed | Stays inline | Same query, new position |

`business-os-schema-check`: no new column or table claim. The only columns named are `id` and `user_id` on `crm_contacts`, `scheduling_bookings`, `scheduling_services` (each already filtered by the existing production `findById` on the same table) and `payment_invoices.user_id` (J1, `:1820`). `npm run schema:check` was **not** run: it needs live database keys, and this worktree has none configured (see §6.6).

`business-os-entitlements`: not applicable. Neither `route.ts` nor any newly imported module imports `lib/business-os/entitlements/`.

---

## 6. Tests

### 6.1 The "before", recorded 2026-10-07 on the untouched tree

| Evidence | Value |
|---|---|
| `HEAD` | `248de6be92adc39e346397ec6777de07536b722f` |
| `route.ts` blob | `0ad6e6a5ad9f2f871b19900324cfe70e2a00ca3d` |
| Harness run | `node node_modules/jest/bin/jest.js --ci --runTestsByPath app/api/stripe/webhook/__tests__/connectPath.characterisation.test.ts`: **28 passed, 28 snapshots passed**, Jest time 6.45 s |
| Snapshot blob | **`4f5f223e9884da154b5800a0591929d5ed585c31`** (unchanged by the run); working-tree sha256 `be25c778fcf80ee03bf32cc2e47b6ebc8f999c93b2fac065d2029e15da3f360a` |

Per-entry hashes (sha256 of each `exports[...]` body, LF-normalised, first 12 hex; script `snap-entry-hashes.js` in the session scratchpad, to be committed nowhere and re-run for the "after"):

| Entry | Before | Fix-1 |
|---|---|---|
| 1a | `8022d8bed1ab` | identical |
| **1b** | `c22b719d9854` | **changes** |
| 2 | `22a9b97e5d2c` | identical |
| 3 | `277fcb96150f` | identical |
| 4a | `2a91ff767596` | identical |
| **4b** | `2bc0fdd8d308` | **changes** |
| **5a** | `4c7c04a11d52` | **changes** |
| 5b | `07068b0d08c1` | identical |
| **6a** | `b575ec3cf371` | **changes** |
| **6b** | `da58bf372590` | **changes** |
| **6c** | `db3cec5222a2` | **changes** |
| 7a | `62dd8b061797` | identical |
| 7b | `bbd25008c830` | identical |
| 8 | `b355f36a18d7` | identical |
| 9a | `62b79e0594d7` | identical |
| 9b | `62b79e0594d7` | identical (same body as 9a) |
| **9c** | `09efafec73cf` | **changes** |
| **10** | `db969034191e` | **changes** |
| 11 | `df0234e124a1` | identical |
| P1 to P7 | `13d044eb4647`, `0b13c275dff4`, `1306164051ae`, `1dcd2e039d06`, `89f1db3bc3c1`, `74d4c5a2a95e`, `4a8d036b2e3a` | identical |
| P10-1, P10-2 | `9f31fb9e98f6`, `be522a658937` | identical |

**8 change, 20 stay byte-identical.**

### 6.2 Existing entries that change, and exactly how

Each diff must be **only** what is listed. Anything else in the diff is a stop.

| Entry | Expected diff | Cause | Harness config change |
|---|---|---|---|
| **1b** (metadata fallback, owned) | The `resolveAccountOwner` effect moves from **after** the `payment_invoices` update `{stripe_invoice_id, updated_at}` to **before** it (right after the `select * · eq id pinv-0001` effect). No effect added or removed | F-1: check before H3 | None |
| **4b** (checkout for a booking) | + one `resolveAccountOwner ["<supabase-admin>", "acct_owner_a"]` effect before the booking update; the update call gains its second argument `{ "count": "exact" }` (C-3); the chain gains `["eq", "user_id", "owner-a"]` after `["eq", "id", "bk-0001"]` | F-2 | `db` answers the update with `count: 1` (C-3) |
| **5a** (PI succeeded, owned) | + 3 `select` effects between the `payment_transactions` dedupe select and `resolveProcessorFee`, each `select('id') · eq id · eq user_id owner-a · maybeSingle` (C-1): `crm_contacts` `ct-1`, `scheduling_bookings` `bk-0002`, `scheduling_services` `svc-2`. The insert payload is **unchanged** | F-4 | `db` gains owned answers for `crm_contacts:select`, `scheduling_bookings:select`, `scheduling_services:select` (`OWNED_LINKS`), so the ids are kept |
| **6a** (payment_failed) | + one `resolveAccountOwner` effect after the J1 select | F-1 J | None (answer already has `user_id: 'owner-a'`) |
| **6b** (finalized) | K1 column string `"id, invoice_number"` → `"id, invoice_number, user_id"`; + `resolveAccountOwner` after it | F-1 K | Answer gains `user_id: 'owner-a'` (without it the check would refuse and the scenario would stop being the happy path) |
| **6c** (uncollectible) | Same as 6b on L1 | F-1 L | Same |
| **9c** (failed event reclaimed) | Same as 6b (it replays `invoice-finalized.json`) | F-1 K | Same |
| **10** (PI insert throws, 500) | Same 3 reads as 5a; insert payload unchanged; still 500 and claim `failed` | F-4 | Same answers as 5a |

No existing test **body** (its assertions) changes; only the `db` answers named above.

### 6.3 New attack scenarios (one new `describe`, same suite)

`describe('Stripe webhook, Fix-1: ids the sending business cannot prove it owns')`. Each has explicit assertions **and** a snapshot (assertions say what matters, the snapshot catches anything else). Shared helpers already in the file: `statusOf`, `claimStatus`, `writesTo`; plus `mockLogLines` (the logging side channel, never in a snapshot). One new helper, `insertPayload(result, table)`.

| # | Scenario | Setup | Assertions (besides the snapshot) |
|---|---|---|---|
| F1-1 | `invoice.paid`, H1 misses, metadata UUID names **another business's** invoice | `invoice-paid.json`; `payment_invoices:select` = [PGRST116, invoice `user_id: 'owner-a'`]; `owners: OWNED_BY_OTHER` (account → `owner-b`) | 200; claim `completed`; **no `payment_invoices:update`** (the planted `stripe_invoice_id` is never written); no `payment_transactions` write; no booking write; error log with the reused message |
| F1-2 | Same, the account maps to **no** business | `owners: {}` | As F1-1 |
| F1-3 | `invoice.finalized` for an invoice owned by another business (the planted-id case) | `invoice-finalized.json`; answer `{id, invoice_number, user_id: 'owner-a'}`; `OWNED_BY_OTHER` | 200; claim `completed`; no `payment_invoices:update` (hosted URL / PDF untouched); refusal log |
| F1-4 | `invoice.payment_failed`, same | `invoice-payment-failed.json`; `OWNED_BY_OTHER` | 200; no `overdue` update; no `business_profiles` read; no `crmActivity.create` effect; refusal log |
| F1-5 | `invoice.marked_uncollectible`, same | `invoice-marked-uncollectible.json`; `OWNED_BY_OTHER` | 200; no `cancelled` update; refusal log |
| F2-1 | Checkout `booking_id` from an attacker account (the booking belongs to `owner-a`, the account to `owner-b`) | `checkout-completed-booking.json`; `OWNED_BY_OTHER`; update answers `count: 0` | 200; claim `completed`; the **only** `scheduling_bookings` write carries `["eq","user_id","owner-b"]` and not `owner-a`; the "no row updated" error line is logged (C-3) |
| F2-2 | Checkout `booking_id`, account maps to no business | `owners: {}` | 200; claim `completed`; **no** `scheduling_bookings` write; refusal log |
| F2-3 | Strictness of C-3: an update answer **without** `count` | `OWNER_A`, default answer | No "no row updated" line. Assertions only, no snapshot (4b already pins the chain) |
| F4-1 | PI succeeded, **foreign `booking_id`** | `payment-intent-succeeded.json`; `OWNER_A`; contact and service owned, `scheduling_bookings:select` → `{data:null, error:null}` (the `maybeSingle` miss) | 200; insert has `booking_id: null` **and** `metadata.booking_id: null`; `contact_id: 'ct-1'`, `service_id: 'svc-2'` kept; exactly one F-4 line, `field: 'booking_id'`, `reason: 'not_owned'` |
| F4-2 | PI succeeded, **foreign `contact_id`** | contact answer not found | `contact_id: null`; booking and service kept; `reason: 'not_owned'` |
| F4-3 | PI succeeded, **foreign `service_id`** | service answer not found | `service_id: null` and `metadata.service_id: null`; others kept; `reason: 'not_owned'` |
| F4-4 | PI succeeded, the booking read **errors** (not "not found") | `scheduling_bookings:select` → `{data:null, error:{code:'XX000'}}` | Fail closed (SA Q-F1-1): `booking_id: null`, row still inserted, 200, claim `completed`; `reason: 'read_failed'` (C-2) |
| F4-5 | PI succeeded with **no** link ids in metadata | new fixture `fixtures/connect/payment-intent-succeeded-no-links.json` (copy of `payment-intent-succeeded.json` with `metadata: { owner_id: 'owner-a' }`) | No `crm_contacts` / `scheduling_bookings` / `scheduling_services` read at all; insert has the three ids `null` |

The `tenant-isolation-guard` Step 7 invariant ("a foreign id is rejected **before** the effect runs, and the mutating call is never made") is what F1-1 to F1-5 and F2-2 assert. F2-1 asserts the scope of the only write, because the fake DB cannot evaluate a filter.

`routerEdgeCases.qa.test.ts` needs no change: its only Connect case (`invoice-paid.json`, default "no rows" answers) never reaches a write, before or after.

### 6.4 How the snapshot is updated without hiding anything

1. Implement. Run the harness with `--ci`. **Expected: exactly the 8 entries of §6.2 fail and the 12 new snapshot scenarios fail as "not written".** Save the full diff output to the scratchpad as evidence and check each hunk against §6.2. Any other failing entry, or any hunk not listed, is a stop.
2. Write, with the anchored regex (C-4): `node node_modules/jest/bin/jest.js --ci=false --runTestsByPath <harness> -u -t 'P-0 baseline\) (1b|4b|5a|6a|6b|6c|9c|10)\. |Fix-1:'`. It cannot match `P10-1` / `P10-2` (they are not under "P-0 baseline"). With `-t`, Jest leaves every other entry as it is and removes nothing.
3. Prove: re-run `snap-entry-hashes.js`. **The 20 identical entries keep the exact hashes in §6.1, the 8 changed ones differ, 12 are new, none is missing (40 entries).** Record the new file blob and sha256 here.
4. Final `--ci` run: 41 tests passed, 40 snapshots passed, snapshot blob unchanged by the run.
5. `git diff --numstat`: no file with deletions and no insertions.

### 6.5 Regression set (same as the parent workplan §7.1, unchanged list)

The 6 webhook suites, `noBookingGuess.guard`, `planSurfaces.guard`, `deferredFirstPayment.guard`, `userSubscriptionsWriteLockdown.qa`, `userSubscriptionsWriteLockdownMigration`, `bookingPaymentStatusReaders.guard`, `UserSubscriptionRepository`, `PaymentRepository.getOverdueInvoices`, `BusinessProfileRepository.languageCurrency`, `check-logging-only-diff`. All `--ci --runTestsByPath`. Plus scoped `tsc` on `route.ts` (0 errors in `route.ts`, the 64 pre-existing transitive errors unchanged) and `eslint` on the changed files.

### 6.6 Evidence, recorded 2026-10-07 on the implemented tree (uncommitted, `HEAD` still `248de6be`)

**Snapshot procedure (§6.4), step by step**

| Step | Result |
|---|---|
| 1a. `--ci` after the `route.ts` change and the `db` answer changes, before the new scenarios | **8 failed, 20 passed** (exactly 1b, 4b, 5a, 6a, 6b, 6c, 9c, 10). Diff sizes: 1b −7/+7 (the same 7 lines moved), 4b −0/+15, 5a −0/+66, 6a −0/+7, 6b / 6c / 9c −1/+8 each, 10 −0/+66. Every hunk read and matched to §6.2; 5a and 10 have **no** removed line, so the inserted payment row is byte-identical |
| 1b. `--ci` with the Fix-1 `describe` added | 20 failed, 21 passed: the same 8 with **identical** diffs (compared mechanically) + 12 "New snapshot was not written" |
| 2. Write | `-t 'P-0 baseline\) (1b|4b|5a|6a|6b|6c|9c|10)\. |Fix-1:'` (exact regex used): **20 skipped, 21 passed; 8 updated, 12 written** |
| 3. Per-entry proof | 40 entries. **20 identical** to §6.1 (1a, 2, 3, 4a, 5b, 7a, 7b, 8, 9a, 9b, 11, P1 to P7, P10-1, P10-2), **8 changed**, **12 new**, **0 missing** (table below) |
| 4. Final `--ci` | **41 passed, 40 snapshots passed**, Jest time 2.67 s (before: 6.45 s on a cold transform cache; the suite is not slower in any measurable way) |
| Snapshot file after | git blob **`09a244f2fd16b0b705c0fac00fdecc85a6438fde`**, sha256 `9980b626efe125e5844adba4f2f04310e4236e1dd64ee6c9b0764466d7eaf7c1` (as Jest wrote it, LF), 5,408 lines. Unchanged by every later run |

| Changed entry | Before | After |
|---|---|---|
| 1b | `c22b719d9854` | `891fc73d2c34` |
| 4b | `2bc0fdd8d308` | `022f817dd48f` |
| 5a | `4c7c04a11d52` | `ab52b3e61f5e` |
| 6a | `b575ec3cf371` | `f68b79bedad5` |
| 6b | `da58bf372590` | `126b507e3330` |
| 6c | `db3cec5222a2` | `f749503e9dcf` |
| 9c | `09efafec73cf` | `5d518155de6a` |
| 10 | `db969034191e` | `834f1992f0e8` |

| New entry | Hash |
|---|---|
| F1-1 / F1-2 | `62df7c538cdc` (both; the recorded effects are the same, only the owner lookup's *answer* differs, and answers are not recorded) |
| F1-3 | `fd8282035f5c` |
| F1-4 | `c89704adbcd8` |
| F1-5 | `9047aec38b03` |
| F2-1 | `4f0c1147c8ec` |
| F2-2 | `b448ea609500` |
| F4-1 / F4-4 | `1e7fc1b337cc` (both; not-found and read-error give the same effects, the difference is the `reason` in the log, asserted explicitly) |
| F4-2 | `53783aef611f` |
| F4-3 | `88030947deee` |
| F4-5 | `d9d2555c77d9` |

**Other checks**

| Check | Result |
|---|---|
| Regression set (§6.5, 16 suites) + `findOwnedId.ownership` + the 3 existing `SchedulingRepository.*` suites | **20 suites, 247 tests, 40 snapshots, all passed** (before, the 16: 210 tests; +13 harness tests, +9 `findOwnedId`, +15 existing scheduling-repository tests) |
| All `lib/repositories/__tests__/*.test.ts` (both touched repositories live there) | **64 suites, 1,355 tests, all passed** |
| Guards | `pinoLogging`, `noBookingGuess`, `deferredFirstPayment`, `routerPlacement`, `bookingPaymentStatusReaders`, `receiptOnPaid`, `emptyBody`, `planSurfaces`, `userSubscriptionsWriteLockdown.qa`: all green, none edited |
| `check-logging-only-diff --exact`, 18 functions vs `248de6be` | **7 differ** (`accountOwns`, `handleConnectInvoicePaid`, `handleConnectCheckoutCompleted`, `handleConnectInvoicePaymentFailed`, `handleConnectInvoiceFinalized`, `handleConnectInvoiceUncollectible`, `handleConnectPaymentIntentSucceeded`), **11 identical**, as planned |
| Scoped `tsc` (scratch tsconfig, 8 GB heap) | `files: [route.ts]`: 64 errors, **0** in `route.ts`, the same 64 as recorded before. With the two repository files, the new test and the harness added: the identical error set (diffed), **0** in any changed file |
| `eslint` on the 5 changed `.ts` files | **0 errors**; 15 warnings, all on lines this change did not touch |
| `console.*` in `route.ts`, `CRMContactRepository.ts`, `SchedulingRepository.ts` | 0, 0, 0. No entitlements import in either repository |
| `npm run schema:check` | **Not run.** The worktree has no `.env*` file, so it cannot reach the database. No new column is named (§5) |

### 6.7 Deviations from the plan

| # | Plan said | Done | Why |
|---|---|---|---|
| D-1 | 3 existing `findById` methods for F-4 | 3 new `findOwnedId` methods + unit tests | SA C-1 |
| D-2 | No count on I5 | `{ count: 'exact' }` + strict `count === 0` error line | SA C-3 |
| D-3 | 11 new scenarios | **13** new tests, **12** with snapshots: F2-3 added (assertions only) to pin C-3's "an absent count must not log" | Without it the strictness is untested |
| D-4 | F-4 message `'payment_intent.succeeded names a link owned by a different business - dropping it'` | `'payment_intent.succeeded link not proved to belong to the owner - dropping it'` | With C-2 the same line also carries `reason: 'read_failed'`, which is not "owned by a different business". The context has `reason`, `field`, `id`, `connectAccountId`, `paymentIntentId` |
| D-5 | `ownedOrNull` as a local function | Top-level `async function ownedOrNull(rawId, ownerId, field, findOwnedId, context, log)` next to the handler, taking the repository method as an argument (SA optimisation note) | Readable one-call-per-link sites |
| D-6 | The harness `Answer` type | Gains an optional `count` | To answer the counted update (4b, F2-1). No other scenario sets it |
| D-7 | The snapshot is written by Jest with LF line endings; the "before" checkout had CRLF | Git reports "LF will be replaced by CRLF"; the blob is what matters and is recorded above | Same as every earlier Jest write of this file |

---

## 7. Source guards

None is edited. Each is run, and these are the ones the change could trip:

| Guard | What it pins | Why it stays green |
|---|---|---|
| `pinoLogging.guard` | ≥ 133 log calls; static messages; `{ err }`; no PII names; metadata logged as keys only | New log calls are static strings with id-only contexts (`connectAccountId`, `invoiceId`, `bookingId`, `paymentIntentId`, `field`, `id`, `reason`). The count rises |
| `noBookingGuess.guard` (`:66`) | In `handleConnectInvoicePaid`, no `from('payment_invoices')` followed within 200 characters by `booking_id:` | H3 moves but stays `{ stripe_invoice_id, updated_at }`; nothing after it within 200 characters writes `booking_id:`. Checked by running it |
| `deferredFirstPayment.guard` (`:271`) | `await accountOwns(connectAccountId, planMeta.owner_id` within the first 1,600 characters of `handleConnectInvoicePaid` | Code is added after that point only |
| `routerPlacement.guard` | Claim completion only in `completeClaim`; dispatch shape | Refusals `return`, so `completeClaim` stays the single place |
| `bookingPaymentStatusReaders.guard` | A query that **filters** on `payment_status` must also filter on `status` | I5 sets `payment_status` and filters on `id` and `user_id`, not on `payment_status` |

`check-logging-only-diff --exact` is run on the 18 top-level functions to show which ones changed: exactly `accountOwns` (helper extracted), `handleConnectInvoicePaid`, `handleConnectCheckoutCompleted`, `handleConnectInvoicePaymentFailed`, `handleConnectInvoiceFinalized`, `handleConnectInvoiceUncollectible`, `handleConnectPaymentIntentSucceeded`; the other 11 identical. (The new `accountOwner` and `ownedOrNull` are new declarations, which the tool reports as added.)

---

## 8. CI time

- No new workflow, job, shard or `npm` script. The 13 tests join the existing harness suite; one new small suite (`findOwnedId.ownership`, 9 tests, fake client, no DB or network) joins `lib/repositories/__tests__`, which the Jest gate already runs.
- Measured: the new harness scenarios take 13 to 25 ms each (≈ +0.25 s); the harness suite ran in 2.67 s after, against 6.45 s before (the difference is the transform cache, not the tests). Inside the existing critical path (`next build` is the longest job).

---

## 9. Files to create / modify

| File | Action | Reason |
|---|---|---|
| `app/api/stripe/webhook/route.ts` | modify | §4 (4 handlers + `accountOwner` / `ownedOrNull` helpers + 3 repository imports) |
| `app/api/stripe/webhook/__tests__/connectPath.characterisation.test.ts` | modify | Fix-1 `describe` (13 tests), helpers `insertPayload` / `errorsLogged` / `tablesRead`, `OWNED_LINKS`, optional `count` on `Answer`, `db` answers for 4b, 5a, 6b, 6c, 9c, 10 |
| `app/api/stripe/webhook/__tests__/__snapshots__/connectPath.characterisation.test.ts.snap` | modify | 8 entries change (§6.2), 12 added, 20 byte-identical |
| `app/api/stripe/webhook/__tests__/fixtures/connect/payment-intent-succeeded-no-links.json` | create | F4-5 |
| `lib/repositories/CRMContactRepository.ts` | modify | `findOwnedId` (C-1) |
| `lib/repositories/SchedulingRepository.ts` | modify | `findOwnedId` on `SchedulingServiceRepository` and `SchedulingBookingRepository` (C-1) |
| `lib/repositories/__tests__/findOwnedId.ownership.test.ts` | create | Unit tests for the three methods (owned, not found without a log, error passed through and logged once) |
| `docs/workplans/BUSINESS_OS_WEBHOOK_CONNECT_REPOSITORIES_WORKPLAN.md` | modify | Pointer to this plan; order Fix-1 → Fix-1b → PR 0 (C-5); PR 0's "before" is re-recorded on post-Fix-1b `main` |
| Migrations | **none** | §5 |

---

## 10. Task list

- [x] ✅ Read the parent workplan and the SA ruling, `route.ts`, the harness and snapshot, the refund trigger, `tenant-isolation-guard`, `business-os-schema-check`.
- [x] ✅ Record the "before" (§6.1): harness green, snapshot blob, per-entry hashes.
- [x] ✅ SA review of this plan: approved with C-1 to C-5; Q-F1-1 to Q-F1-5 ruled.
- [x] ✅ Extract `accountOwner` from `accountOwns` (no query change; existing scenarios record the same lookups).
- [x] ✅ F-1: owner check before H3; checks in J, K (+ `user_id` column), L.
- [x] ✅ F-2: owner resolved, refusal when unmapped, `.eq('user_id', owner)` + `{ count: 'exact' }` + strict 0-row log on I5 (C-3).
- [x] ✅ C-1: `findOwnedId` on the three repositories, with unit tests.
- [x] ✅ F-4: `ownedOrNull` with the three `findOwnedId`s, `reason` in the log (C-2); vetted ids in columns and metadata copy.
- [x] ✅ Harness: Fix-1 `describe` (13 tests), new fixture, `db` answers for 6 existing scenarios.
- [x] ✅ Snapshot procedure §6.4 with the anchored regex (C-4); per-entry hash proof in §6.6.
- [x] ✅ Regression set, all repository tests, guards, scoped `tsc`, `eslint`, `check-logging-only-diff --exact` (§6.6). `schema:check` not runnable here (no keys).
- [x] ✅ C-5: §12 corrected to three call sites; Fix-1 → Fix-1b → PR 0 recorded in the parent workplan.
- [ ] SA code review and QA; the user sees the diff before anything is committed (RM commits).

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| A legitimate J / K / L event refused because the account cannot be mapped yet | A row found by `stripe_invoice_id` was sent to Stripe by us on that account, so the account is already mapped. Same policy `invoice.paid` has today |
| F-4 drops a legitimate link on a transient DB error (booking stays unpaid, payment row has no booking) | Logged at `error` with `reason: 'read_failed'`, the field, the id and the payment intent id, so a repair can find and tell it from an attack (SA Q-F1-1, C-2) |
| The intended snapshot update hides an unintended change | §6.4: `--ci` first, every hunk checked against §6.2, `-u` limited by the anchored `-t`, per-entry hash proof for the 20 unchanged (§6.6) |
| A refusal on J / K / L / F-2 caused by a transient owner-lookup error is cached and completed, not retried | Pre-existing behaviour of `accountOwns` (FU-5, raised by SA). Fix-1 does not change cache semantics, on purpose |
| New imports pull side effects into the webhook | `CRMContactRepository` imports the logger and `supabaseServer`; `SchedulingRepository` additionally imports pure constants from `bookingStatus` and a type. The harness run is the test |
| Fix-1 conflicts with the refactor plan | C-1 order: Fix-1 merges first; PR 0 records its "before" on the new `main` |

---

## 12. New finding (F-5), not in scope: Fix-1b

Found while tracing `booking_id` for F-4. **The plan path stores an unchecked metadata `booking_id` and later inserts money against it.** SA confirmed it (High) and placed it in its own PR, **Fix-1b**, right after Fix-1 and before refactor PR 0 (C-5).

- **Three** call sites (corrected by SA; line numbers at `248de6be`) pass `bookingId` (and `serviceId`) from the connected account's metadata into `bindPlanSubscription` after proving only the **owner**, not the booking: `handleConnectPlanSubscriptionCreated` (`:1031`, trialling subscription), `handleConnectInvoicePaid` (`:1142`) and `handleConnectCheckoutCompleted` (`:1581`).
- `bindPlanSubscription` writes it to `payment_plan_installments.booking_id` (`lib/payments/bindPlanSubscription.ts:376`) and the plan row. Its `resolveContactId` is user-scoped (`:425–444`), so the contact comes back null for a foreign booking, but the `booking_id` itself is kept.
- Every later period, `recordPlanPeriodPaid` inserts a `succeeded` `payment_transactions` row with `booking_id: plan.data.booking_id` (`route.ts:832`). That fires `propagate_refund_to_booking`, which updates the booking by id with no `user_id` filter. Same impact as F-4 (another business's booking shows paid), by a slower route. (G5 at `:953` is scoped; the trigger is not.)
- Fix-1b shape (SA C-5): inside `bindPlanSubscription`, so one place covers all three callers and any future one. Keep `bookingId` only if the booking belongs to `ownerId`, folded into the existing `resolveContactId` read (one query); give `serviceId` and `paymentPlanId` the same treatment; **drop, never refuse** (the subscription must still be bounded). Lives in `lib/payments/`, which this harness mocks, so it carries its own tests. The trigger hardening follow-up would also close it.

---

## 13. Open questions for SA

All five were ruled in the SA review below (Q-F1-1 drop with `reason`; Q-F1-2 count; Q-F1-3 lean methods; Q-F1-4 inline; Q-F1-5 Fix-1b). Kept as asked, for the record.

| # | Question | Dev's default |
|---|---|---|
| Q-F1-1 | F-4: when an ownership read **errors** (not "not found"), drop the link and record the payment (fail closed, `tenant-isolation-guard` Step 2), or throw so the claim is released and Stripe retries (self-heals a transient error, but delays the money row)? | Drop (fail closed). F4-4 pins it |
| Q-F1-2 | F-2: with a mapped owner, a foreign booking id is a silent no-op. Add `{ count: 'exact' }` to the update (no `.select()`, so the PostgREST update + `.select` 42703 bug does not apply) and log the refusal when 0 rows matched? It would change the I5 chain recorded in 4b once more | No (SA said no-op). Easy to add if wanted |
| Q-F1-3 | Reuse the three existing `findById(id, userId)` methods (joins on the booking one, `error` log on not-found), or add one lean `select('id')·eq·eq·maybeSingle` method per repository? | Reuse: no new repository surface in a security PR |
| Q-F1-4 | K1 / L1 column change and the I5 filter stay inline in `route.ts` (they modify existing queries, they are not new access; PR 2 / PR 4 move them). Confirm that this meets rule 1 for this PR | Yes, inline |
| Q-F1-5 | F-5 (§12): into Fix-1 (one more file, `lib/payments/bindPlanSubscription.ts`, about 0.25 d more), its own small PR, or covered by the trigger-hardening migration? | Own small PR right after Fix-1; Fix-1 stays as ruled |

---

## SA Review Notes

**Reviewed by SA — 2026-10-07**
**Status:** ✅ Approved with conditions (C-1 to C-5 below; no re-review of the plan needed, they are checked at code review)

### What was verified against the tree (`248de6be`, `route.ts` blob `0ad6e6a5` confirmed)

| Claim | Result |
|---|---|
| `connectAccountId = event.account` (`:2286`), event built by `constructWebhookEvent(body, signature, secret)` (`:2178`) before it is read | ✅ The account id is inside the signed payload; the sender cannot choose it |
| Owner comes from our DB | ✅ `resolveAccountOwner` reads `stripe_connect_accounts.user_id`, then `plugin_connections` (`stripeAccountContext.ts:435–448`). Nothing from metadata |
| `accountOwns` cache semantics (`:1065–1092`) | ✅ As described: early `false` on no owner id before touching the cache; cache filled once per account; warn on null. Note: the Map is **module-level**, not per invocation as its comment says (see Follow-ups, FU-5) |
| H2 → H3 write before the owner check (`:1219–1237`, check at `:1242`) | ✅ Confirmed. F-1 is real: the `stripe_invoice_id` is planted on another business's invoice before the refusal, and later J/K/L events find that row by Stripe id |
| J1 selects `user_id` (`:1820`); K1 / L1 do not (`:1903`, `:1943`); no owner check in J/K/L | ✅ Confirmed |
| I5 (`:1766–1772`) updates `scheduling_bookings` by metadata `id` only | ✅ Confirmed. G5 (`:953`) is the scoped twin |
| F-4 insert (`:689–712`) takes `contact_id` / `booking_id` / `service_id` raw from metadata, columns and metadata copy | ✅ Confirmed. With `booking_id` set, `propagate_refund_to_booking` (`20260903_…sql`) updates the booking by id with no `user_id` |
| The three `findById(id, userId)` filter by `user_id` | ✅ `CRMContactRepository.ts:132`, `SchedulingRepository.ts:499` (service), `:953` (booking): all `.eq('id').eq('user_id').single()`, all `throw` on any error into a catch that logs at **error** and returns `{ data: null, error }`. Not-found (PGRST116) and a real read error look the same to a caller that branches on `!data` |
| Harness can see repository calls | ✅ `supabaseServer` is built with `createClient`, which the harness mocks to the same `mockSupabase`, and `isolateModules` re-imports per scenario, so repository reads land in `effects` and the owner cache is fresh per scenario |
| 28 entries today, blob `4f5f223e` | ✅ 28 `exports[...]`, blob matches |
| 8 change / 20 identical | ✅ Agreed entry by entry. 2 is the H1 path (unchanged); 9a/9b short-circuit before the handler; 7a/7b/8/11/P-* do not reach a changed handler; 9c replays `invoice-finalized.json`; 10 replays `payment-intent-succeeded.json`; 6a's J1 answer already carries `user_id: 'owner-a'` |
| Refusal shape = today's policy (`:1242–1256`) | ✅ `log.error` static message, ids only, `return`, 200, claim completed. The four new refusal messages copy the existing wording |
| Guards (`noBookingGuess`, `deferredFirstPayment`, `routerPlacement`, `bookingPaymentStatusReaders`, `pinoLogging`) | ✅ Reasoning holds for each |
| CI time | ✅ No new job, script or shard; ~+0.5 s inside the existing Jest gate, which finishes under `next build`. The C-1 repository unit tests add a few ms each |

### Rulings on the open questions

**Q-F1-1 — read error on an ownership read: drop the link and record the payment (Dev's default). Approved, with C-2.**
The money is in this account and must be on its books; a throw would hold the payment row hostage to a lookup whose only job is to vet a link, and a persistent error would loop retries on a money path. `tenant-isolation-guard` Step 2 treats an error as not-owned. But a dropped link from a transient error and a dropped link from an attack must be told apart in the log, or the repair queue cannot be worked (C-2).

**Q-F1-2 — Yes: add `{ count: 'exact' }` to I5 and log when it matched nothing (C-3).**
Without it the F-2 attack (mapped attacker account, victim's booking id) leaves no trace at all, and that is the one case with no benign reading except a since-deleted booking. Use `.update({...}, { count: 'exact' })` and read `count` from the response. **Never** chain `.select()` after the update (and there is no `.or()` here); the known PostgREST UPDATE + `.or()` + `.select()` 42703 bug is why the count form is the house pattern. Changing 4b's chain once more in the same PR is fine; it is one entry already in the "changes" list.

**Q-F1-3 — Do not reuse the three `findById` methods; add one lean ownership read per repository (C-1).**
Reasons, in order of weight:
1. The booking `findById` embeds three resources through named foreign keys (`payment_invoices_booking_id_fkey`, `payment_transactions_booking_id_fkey`). If either embed ever fails, F-4 fails closed on **every** payment and silently strips every booking link: a security check that turns a schema change into a money-path data bug. An ownership read must depend on `id` and `user_id` only.
2. Each `findById` logs at `error` on not-found, so every dropped link logs twice, and every payment for a deleted contact/booking/service raises an error-level line that is not an error.
3. A `.maybeSingle()` read separates not-found (`data: null, error: null`) from a read failure (`error` set) without parsing error codes, which is exactly what C-2 needs.
New methods are cheap, live in existing repository files (rule 1), carry the `user_id` filter (rule 4), and are the Step 2 oracle in the form the skill intends (a user-scoped read). That is not a new pattern.

**Q-F1-4 — Confirmed: K1/L1 column addition, the I5 filter (+ count) and the moved H3 stay inline in `route.ts` for this PR.**
Rule 1 is about new data access; these are existing inline queries made safer, and PR 2 / PR 4 move them on the agreed schedule. All **new** reads (F-4) go through repositories (C-1). No other new inline query is allowed in this PR.

**Q-F1-5 — F-5 confirmed. Severity High (same impact class as F-4). Its own small PR ("Fix-1b"), immediately after Fix-1 and before refactor PR 0 (C-5).**
Confirmed on the tree: metadata `booking_id` (and `service_id`) reaches `bindPlanSubscription` after only the owner is proved, is written to `payment_plan_installments.booking_id` (`bindPlanSubscription.ts:376`), and every later period inserts a `succeeded` `payment_transactions` row with `booking_id: plan.data.booking_id` (`route.ts:832`), which fires the unscoped refund trigger on the other business's booking. The booking link update in `bindPlanSubscription` (`:402–407`) and `resolveContactId` are scoped, so the hole is the stored id and the trigger, as the Dev says. Mitigating: the attacker must be a connected business and know the victim booking's UUID; that does not lower it below F-4, which Fix-1 treats as must-fix.
Correction to §12: there are **three** call sites, not two: `:1031` (trialling subscription, `customer.subscription.*`), `:1142` (`invoice.paid`), `:1581` (checkout). This is the strongest argument for fixing it **inside `bindPlanSubscription`** (one place covers all three, and future callers). Kept out of Fix-1 because it is a different module with its own tests, `bindPlanSubscription` is mocked in this harness so Fix-1's snapshot proof does not cover it, and Fix-1's scope is what the user approved.

### Conditions

1. **C-1 (Q-F1-3).** Add one lean method per repository (`CRMContactRepository`, `SchedulingServiceRepository`, `SchedulingBookingRepository`), e.g. `findOwnedId(id, userId): Promise<RepositoryResult<string | null>>` (name is the Dev's choice, same name in all three): `.select('id').eq('id', id).eq('user_id', userId).maybeSingle()`; not-found returns `{ data: null, error: null }` and does **not** log; a read error logs at `error` with `{ err }` and returns `{ data: null, error }`. No `deleted_at` filter (ownership, not liveness, same as `findById`). One unit test per method (owned, not found, error). Update §5, §6.2 (5a and 10: the three select chains become `select('id') · eq id · eq user_id · maybeSingle`) and §9 (three repository files modify, plus their tests). Re-check each touched repository file for `console.*` and entitlements imports at code review.
2. **C-2 (Q-F1-1).** Keep fail-closed, but the F-4 log line carries `reason: 'not_owned' | 'read_failed'` (still static message, ids only). F4-4 asserts `reason: 'read_failed'`; F4-1 to F4-3 assert `'not_owned'`.
3. **C-3 (Q-F1-2).** I5 becomes `.update({...}, { count: 'exact' }).eq('id', bookingId).eq('user_id', owner)`, no `.select()`. When `count === 0` (strict: an absent `count` must not log), `log.error({ connectAccountId, bookingId }, 'Connect checkout names a booking owned by a different business - no row updated')`, then return as today (200, claim completed). The harness answer for 4b must supply `count: 1`; F2-1 answers `count: 0` and asserts the log line. Add the extra update argument to 4b's expected diff in §6.2.
4. **C-4 (§6.4 step 2).** The `-t` regex must be anchored so it cannot match `P10-1` / `P10-2` (an unanchored `10` does). Use the label plus its full stop, e.g. `-t "(P-0 baseline\) (1b|4b|5a|6a|6b|6c|9c|10)\. )|Fix-1:"`, and record the exact regex used in the evidence. Step 3's per-entry hash proof stays mandatory, and step 5's `--numstat` deletion-without-insertion stop stays.
5. **C-5 (Q-F1-5).** Correct §12 to three call sites. Record Fix-1b in the parent workplan's sequence (Fix-1 → Fix-1b → PR 0): in `bindPlanSubscription`, keep `bookingId` only if the booking belongs to `ownerId` (fold into the existing `resolveContactId` read, one query) and give `serviceId` and `paymentPlanId` the same treatment; drop, never refuse (the subscription must still be bounded). Not a blocker for merging Fix-1.

### Follow-ups (not Fix-1 conditions; TL to carry)

- **FU-5 raised in priority.** `accountOwnerCache` is module-level, so it lives across warm invocations, and it caches `null`. `resolveAccountOwner` ignores query errors, so a transient DB error reads as "maps to no business", is cached for the life of the instance, and is now refused with the claim **completed** (no Stripe retry) on more paths: J, K, L and F-2-unmapped join `invoice.paid`. A lost `payment_failed` or `finalized` is recoverable but silent. Fix-1 must not change cache semantics (as planned); FU-5 should stop caching `null`, make the cache per request, and turn a resolver read error into a throw (claim released, Stripe retries).
- Propagate-refund trigger hardening remains the backstop for F-4, F-5 and FU-4 together.

### Optimisation suggestions

- `ownedOrNull` can take the repository method directly, `(id, userId) => Promise<RepositoryResult<string | null>>`, so the call sites read as one line each.

### Approval
[x] Workplan approved with conditions C-1 to C-5 — proceed to implementation

---

**Code Review by SA — 2026-10-07**
**Status:** ✅ Code Approved (no blocking findings)

Reviewed the uncommitted tree in `neuronforge-webhook-repos` against `248de6be` (`git diff 248de6be`). `docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md` is TL's edit and was not reviewed.

#### Conditions

| # | Verdict | Evidence |
|---|---|---|
| C-1 | ✅ Met | `findOwnedId(id, userId)` on `CRMContactRepository`, `SchedulingServiceRepository`, `SchedulingBookingRepository`: `select('id') · eq id · eq user_id · maybeSingle()`, returns `data?.id ?? null`. Not found gives `{ data: null, error: null }` and no log. An error is logged once at `error` as `{ err }` and returned as `{ data: null, error }`. No `deleted_at` filter. `findOwnedId.ownership.test.ts` covers owned, not found and error for each of the three (9 tests) and pins the exact chain |
| C-2 | ✅ Met | `ownedOrNull` logs `reason: error ? 'read_failed' : 'not_owned'`, with a static message and ids only. F4-1 to F4-3 assert `not_owned`; F4-4 asserts `read_failed` |
| C-3 | ✅ Met | I5 is `.update({...}, { count: 'exact' }).eq('id', bookingId).eq('user_id', owner)`. The only `.select` near it is in a comment. The `bookingsUpdated === 0` check is strict. 4b answers `count: 1`. F2-1 answers `count: 0` and asserts the log line. F2-3 shows that a missing count does not log |
| C-4 | ✅ Met | The anchored regex is recorded in §6.6 step 2. My own per-entry re-hash, run independently from Dev's script and with a different body extraction, gives 28 before and 40 after: **all 20 unchanged entries byte-identical** (every one checked, not a sample), exactly 1b/4b/5a/6a/6b/6c/9c/10 changed, 12 new, 0 missing. The pairs F1-1/F1-2 and F4-1/F4-4 hash equal, as §6.6 says. The snapshot diff has only 10 removed lines: the 7 moved `resolveAccountOwner` lines in 1b and the 3 `"id, invoice_number"` column strings in 6b/6c/9c. 5a and 10 remove nothing, so the payment row is unchanged. Blob `09a244f2` stayed the same through my run |
| C-5 | ✅ Met | §12 now lists three call sites, and Fix-1b is recorded as a separate PR. As ruled, it does not block Fix-1 |

#### Bypass analysis

| Path | Result |
|---|---|
| F-1 metadata fallback | The `accountOwns` check runs **before** the H3 `stripe_invoice_id` write, inside the same `if`. If `user_id` is null or the account is unmapped, `accountOwns` returns false and the event is refused. The existing post-lookup check still guards the H1 (Stripe id) path. No write comes before either check |
| J / K / L | `user_id` is selected and `accountOwns` runs right after the lookup, before any update, contact read, language read or CRM activity. Rows planted before Fix-1 are covered too, because the check is on the row and not on how the id got there |
| F-2 | When the account is unmapped, the handler refuses before the update. When it is mapped, the write is scoped to `user_id = owner`, and the owner comes from the signed `event.account` and the DB, never from metadata. The plan branch above it falls through into this same scoped write |
| F-4 | `owner_id` is proved first, the dedupe stays first, and then each link is vetted **before** the insert. An empty string or absent id gives `null` with no read, the same as the old `|| null`. A malformed id causes a read error and is dropped (fail closed). The columns **and** the `metadata.booking_id` / `metadata.service_id` copies both use the vetted values. The refund trigger gets no foreign target |
| Refusal policy | Unchanged: `log.error`, static message, `return`, 200, claim `completed`. F1-1 to F1-5, F2-1, F2-2 and F4-4 assert status 200 and claim `completed` |

#### Standards

- Rule 1: every new read goes through a repository. The K1/L1 column, the I5 filter and count, and the moved H3 stay inline, as ruled in Q-F1-4.
- Rule 3: `console.*` count is 0 in `route.ts` and in both repository files. Logging is Pino with `{ err }`.
- Rule 4: every new query has `user_id`, and the new I5 filter adds a missing one.
- Rule 6: no new `any`. `ownedOrNull` is fully typed, and its `findOwnedId` parameter matches `{CRMContact,Scheduling}RepositoryResult<string>`.
- `new-repository`: the methods sit on existing classes that already have constructor injection and singletons. They never throw to the caller and are unit-tested. The checklist items about `types.ts` and `index.ts` exports do not apply, because there is no new class or type.
- No entitlements import.
- The harness diff removes 6 lines: the `Answer` type, 4b's one-line `run` call and 4 `db` answer lines (6b, 6c, 9c, 10). Each is re-added in an extended form, so the same `toMatchSnapshot()` expectations remain, and no assertion was removed. No guard file is in the diff.

#### Tests run by SA

`node node_modules/jest/bin/jest.js --ci --runTestsByPath` on the harness, `findOwnedId.ownership`, `emptyBody`, `pinoLogging`, `receiptOnPaid`, `routerEdgeCases.qa`, `routerPlacement`, `noBookingGuess`, `planSurfaces`, `deferredFirstPayment`, `bookingPaymentStatusReaders` and `userSubscriptionsWriteLockdown.qa`: **12 suites, 163 tests, 40 snapshots, all passed**. Snapshot blob `09a244f2` was unchanged before and after. I did not re-run `tsc` or `eslint` and am relying on Dev's §6.6 (0 errors in changed files).

### Code Review Comments
1. `route.ts` `ownedOrNull`: the log context carries `id: rawId`, a metadata value that the connected account controls. It can be any string up to Stripe's 500-character limit, not only a UUID. It goes out as a structured JSON field, so there is no log injection, and the file already logs `metadataInvoiceId` the same way. In normal traffic it is an id, so this is not PII. A business could still write free text into it. — Priority: Low (non-blocking; see the first optimisation suggestion)
2. F2-1 can only assert the **scope** of the I5 write, because the fake DB does not evaluate filters. The real guarantee is the PostgREST `user_id` filter. This is acceptable and already stated in §6.3. QA should not read F2-1 as proof that zero rows match on a real DB. — Priority: Low (informational)
3. FU-5 has a wider reach now. J, K, L and F-2-unmapped refuse and complete the claim when the owner lookup returns a cached `null`, including a `null` cached after a transient read error. Fix-1 does not change the cache, as ruled. The follow-up stays with TL. — Priority: Medium (follow-up, not a Fix-1 blocker)

### Optimisation Suggestions
- In `ownedOrNull`, log `id` only when it has a UUID shape. Otherwise log `idLength`. This removes comment 1 completely and costs one regex. Optional; fine as a Fix-1b or PR 0 touch-up.

### Code Approved for QA: Yes

---

## QA Testing Report

**QA — 2026-10-07**
**Test mode:** full
**Strategy used:** A + B (Jest, route-level with the harness's mocking approach: recording PostgREST builder, stubbed `resolveAccountOwner`, no Stripe, no database). No live DB or Stripe exists for this worktree (only prod), so nothing was run against either.
**Focus:** security, api
**Skipped:** `schema:check` and any live-DB check (no `.env`, only prod exists); e2e (no UI)
**Input source:** TL trigger message (prompt keywords)

**Tree under test:** `fix/webhook-connect-tenant-ownership`, base `248de6be`, uncommitted. Characterisation snapshot blob `09a244f2fd16b0b705c0fac00fdecc85a6438fde` before and after **every** QA run (checked 6 times). The harness and its snapshot were not edited; no `-u` was used.

### What QA added

One new file, no snapshots: `app/api/stripe/webhook/__tests__/fix1Ownership.qa.test.ts` (28 tests). It copies the harness's mock setup (it cannot import the harness, which has its own tests) and adds a `loadRoute()` / `post()` split so one warm module instance can take several events (needed for the owner-cache tests).

**Mutation check (do the tests discriminate?).** The same file was run against the pre-fix `route.ts` (`git show 248de6be:…`) in a throwaway directory inside the worktree, deleted afterwards. **15 of 28 fail on the old route** (H-3, H-4, A-1, A-2, A-4, A-5, A-8, A-10, A-11, A-13, E-2, E-3, E-6, C-1, C-2): these are the Fix-1 behaviours. The other 13 pass on both, by design: they pin behaviour Fix-1 must not change (H-1, H-2, A-3, A-6, A-7, A-9, A-12, E-1, E-4, E-5, E-7, D-1, D-2).

### Test Coverage

| Acceptance criterion (TL brief) | Tested? | Result | Evidence |
|---|---|---|---|
| 1. Happy paths: each Connect event type in the harness still records today's result for the rightful owner | ✅ | Pass | Harness 41/41, 40 snapshots, 20 entries byte-identical to before (Dev §6.6, SA re-hash; blob unchanged by QA). QA H-1 (`invoice.paid` metadata fallback: H3 written, payment row under `owner-a`, **one** owner lookup for two `accountOwns` calls), H-2 (J/K/L each write exactly one owned row), H-3 (checkout: `update(…, {count:'exact'})`, `.eq('user_id','owner-a')`, no `.select()`, no error line), H-4 (PI: all three links kept in columns **and** metadata copy; each ownership read is exactly `select('id') · eq id · eq user_id owner-a · maybeSingle`) |
| 2a. Cross-tenant metadata UUID on `invoice.paid` | ✅ | Pass | Harness F1-1/F1-2; QA A-1 (row with `user_id` NULL), A-2 (legacy `invoice_id` key), A-3 (H1 path, unchanged guard). No `payment_invoices` / `payment_transactions` / `scheduling_bookings` write, reused refusal message, 200, claim `completed` |
| 2b. Planted `stripe_invoice_id` on finalized / payment_failed / marked_uncollectible | ✅ | Pass | Harness F1-3..F1-5; QA A-4 (row `user_id` NULL, all three), A-5 (unmapped account, all three: event-specific message with `{connectAccountId, invoiceId}`, plus the existing "maps to no known business" warn). No write, no CRM activity, 200, `completed` |
| 2c. Foreign booking on checkout | ✅ | Pass | Harness F2-1/F2-2/F2-3; QA A-8 (update error → "Failed to update…" line, **not** the 0-rows line, 200), A-9 (foreign `invoice_id` + foreign `booking_id` together: invoice branch refuses, booking never written). See note N-4 on what a fake DB can prove |
| 2d. Foreign contact / booking / service on `payment_intent.succeeded` | ✅ | Pass | Harness F4-1..F4-3; QA A-10: all three foreign → all `null`, metadata copy `{booking_id:null, service_id:null}`, **no foreign id anywhere in the inserted row** (string search), three `not_owned` lines in insert order |
| 2e. Unmapped account | ✅ | Pass | F1-2, F2-2, QA A-5 (J/K/L), A-12 (PI: refused before any link read or insert) |
| 2f. Read error | ✅ | Pass | F4-4; QA A-13 (all three link reads error → all dropped `read_failed`, money still recorded, 200, `completed`), A-6 (J/K/L lookup error → no owner lookup, no write), A-7 (invoice.paid metadata lookup error → no H3) |
| 2g. 500 path (entry 10 shape) | ✅ | Pass | QA A-11: foreign booking + insert failure → **500, claim `failed`**, the attempted row carried `booking_id: null`, no booking write |
| 2h. Empty / absent / malformed ids | ✅ | Pass | F4-5; QA E-1 (empty strings: no read, `null`, no log, same as the old `|| null`), E-2 (whitespace-only, padded and injection-shaped ids: read with the raw value, uuid-cast error → dropped, fail closed), E-5 (empty checkout `booking_id`: no owner lookup, no write), E-6 (padded checkout `booking_id`: write still owner-scoped), E-7 (empty / absent invoice metadata id: no fallback lookup) |
| 3a. Whitespace / different case | ✅ | Pass | E-2 above; E-3: `BK-0002` in metadata → the **repository's** canonical `bk-0002` is stored in column and metadata copy (`ownedOrNull` returns `data`, not `rawId`); E-4: upper-case `owner_id` is refused by the pre-existing strict equality (fail closed, unchanged by Fix-1) |
| 3b. Dedupe still runs before the ownership reads | ✅ | Pass | D-1: a `completed` duplicate event makes exactly one DB call (`processed_webhook_events:select`), no owner lookup, body `{received:true, duplicate:true}`. D-2: an already-recorded payment intent (F1 dedupe) causes no link read and no insert |
| 3c. Owner cache across scenarios | ✅ | Pass (with known FU-5) | C-1: one warm instance, events from `acct_owner_a` then `acct_owner_b` then A again: the cache is keyed per account, B's write is scoped to `owner-b` (never `owner-a`), A is served from cache with `owner-a`. C-2 pins the known FU-5 behaviour (note N-3) |
| 3d. Metadata copy matches the nulled columns | ✅ | Pass | F4-1, F4-3, QA A-10, E-3: `metadata.booking_id` / `metadata.service_id` always equal the vetted column values (contact has no metadata copy) |
| 4. Regression set | ✅ | Pass | See table below |
| Entitlements registration | ✅ | N/A | No changed file imports `lib/business-os/entitlements/`; `test:bos-entitlements` not required |

### Regression runs

All `node node_modules/jest/bin/jest.js --ci --runTestsByPath …`; snapshot blob `09a244f2` before and after each.

| Set | QA result | QA time | Dev's number (§6.6) |
|---|---|---|---|
| §6.6 20-suite set (16 of §6.5 + `findOwnedId.ownership` + 3 `SchedulingRepository.*`) | **20 suites, 247 tests, 40 snapshots, all passed** | Jest 8.38 s | 20 / 247 / 40, all passed (Dev gave no wall time for the set) |
| All `lib/repositories/__tests__/*.test.ts` | **64 suites, 1,355 tests, all passed** | Jest 17.7 s, wall 19.5 s | 64 / 1,355, all passed |
| All 91 `*.guard.test.ts(x)` in the repo (wider than Dev's 9) | 90 passed, **1 failed**: `lib/utils/__tests__/oneAddressPolicy.guard.test.ts` (1 of 1,642 tests) | Jest 32.4 s, wall 34.1 s | Dev's 9 named guards: all green, and green here too |
| Harness + QA file together | 2 suites, 69 tests, 40 snapshots, all passed | Jest 4.0 s | Harness alone 2.67 s |
| QA file alone (cold) | 28 passed | Jest 3.3 s; per test 13–68 ms after the first import | — |

The `oneAddressPolicy` failure is **not Fix-1**: it lists 7 files (`lib/email/platformBranding.ts`, the 3 V1 plugin strategies, `UniversalOAuthHandler.ts`, `lib/utils/origins.ts`, `app/oauth/callback/[plugin]/route.ts`) that this diff does not touch (`git diff 248de6be --stat` on those paths is empty), and the reported paths are Windows absolute paths with backslashes, which the guard's allow-list (forward-slash relative paths) cannot match. A Windows-only path-separator issue in the guard; CI runs on Linux.

**CI time:** negligible. The QA file adds one small suite (≈ 1 s of test time plus one route import) inside the existing Jest gate shards; the harness gains ≈ 0.25 s (Dev). No new job, script or shard. Both finish well inside `next build`.

**Static checks:** `eslint` on the QA file: 0 problems. `console.*` count: 0 in `route.ts`, `CRMContactRepository.ts`, `SchedulingRepository.ts`. QA did not re-run `tsc` (Dev §6.6: 0 errors in changed files).

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None. F-4 adds up to three sequential single-row reads per **non-duplicate** standalone payment, only for ids that are present (E-1, D-2 prove no read otherwise).

#### Edge Cases / Notes (nice to fix, none blocking)
1. **N-1 — A malformed link id is logged as `reason: 'read_failed'`** — File: `app/api/stripe/webhook/route.ts` (`ownedOrNull`) — Severity: Low. A padded, upper-case-invalid or free-text id makes the real `uuid` cast fail (22P02), so it is dropped (correct, fail closed) but labelled with the reason C-2 reserved for a transient read error. A repair queue that retries `read_failed` will chase ids that can never resolve. Possible fix (Fix-1b or PR 0): treat a non-UUID-shaped id as `not_owned` (or a third reason `malformed`) before the read; this also removes SA comment 1 (raw metadata value in the log). Shown by QA E-2.
2. **N-2 — The repository also logs at `error` on a read failure**, so a `read_failed` drop produces two error lines (repository + route). Matches C-1 as ruled; mentioned only so alerting does not double-count.
3. **N-3 — FU-5 is pinned by QA C-2.** On a warm instance, a `null` owner cached from an unmapped (or transiently failing) lookup keeps refusing J/K/L/F-2 events after the account maps, with the claim completed. Known and tracked (SA comment 3); C-2 is labelled so that FU-5 knows to flip it.
4. **N-4 — The fake DB cannot evaluate filters** (SA comment 2). F2-1, H-3, A-8, C-1 prove the I5 write carries `.eq('user_id', <sending account's owner>)` and `{ count: 'exact' }`; that zero rows match on a real DB is PostgREST's guarantee and was not verified live (no non-prod DB).
5. **N-5 — `oneAddressPolicy.guard` fails on Windows** (see above). Unrelated, pre-existing; worth a separate chip to normalise separators in the guard.

### Test Outputs / Logs

```text
fix1Ownership.qa.test.ts (fixed route):   Tests: 28 passed, 28 total            Time: 3.335 s
fix1Ownership.qa.test.ts (248de6be route): Tests: 15 failed, 13 passed, 28 total
20-suite set:   Test Suites: 20 passed, 20 total  Tests: 247 passed  Snapshots: 40 passed  Time: 8.383 s
repositories:   Test Suites: 64 passed, 64 total  Tests: 1355 passed                    Time: 17.687 s (wall 19.5 s)
all guards:     Test Suites: 1 failed, 90 passed, 91 total  Tests: 1 failed, 1641 passed  Time: 32.438 s
                FAIL lib/utils/__tests__/oneAddressPolicy.guard.test.ts (Windows paths, unrelated)
harness + QA:   Tests: 69 passed  Snapshots: 40 passed  Time: 4.015 s
snapshot blob before/after every run: 09a244f2fd16b0b705c0fac00fdecc85a6438fde
```

### Final Status
- [x] All acceptance criteria pass — ready for commit (**PASS WITH NOTES**: 0 bugs; notes N-1 Low, N-2 to N-5 informational / tracked elsewhere). The new QA file `fix1Ownership.qa.test.ts` should be committed with Fix-1.
- [ ] Issues found — Dev must address before commit

---

## Commit Info

*(RM to populate.)*

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-07 | Plan created (Dev) | Fix-1 per the SA ruling in the repositories workplan: F-1 (owner check before H3, plus J/K/L), F-2 (booking update scoped to the account owner), F-4 (foreign links dropped). "Before" recorded (28/28, snapshot blob `4f5f223e`, per-entry hashes). 8 snapshot entries change on purpose, 20 stay identical, 11 new attack scenarios. New finding F-5. Q-F1-1 to Q-F1-5 |
| 2026-10-07 | SA review (SA) | Approved with conditions. Verified on `248de6be`: signed `event.account`, DB-sourced owner, F-1/F-2/F-4 sites, repository filters, harness reach, 8 changed / 20 identical. Rulings: Q-F1-1 drop + `reason` in log; Q-F1-2 `{ count: 'exact' }` + log on 0, no `.select()`; Q-F1-3 lean user-scoped ownership methods instead of `findById`; Q-F1-4 inline confirmed; Q-F1-5 F-5 confirmed High, three call sites, own PR Fix-1b right after Fix-1. C-1 to C-5; FU-5 (module-level null-caching owner cache) raised in priority |
| 2026-10-07 | Implemented (Dev), uncommitted | C-1 to C-5 applied. `route.ts` (F-1, F-1 J/K/L, F-2 with count, F-4 with `reason`), `findOwnedId` on 3 repositories + unit tests, 13 harness tests + 1 fixture. Snapshot: 8 changed exactly as §6.2, 20 byte-identical, 12 new (blob `09a244f2`). 20 suites / 247 tests green; repositories 64 / 1,355 green; scoped `tsc` 0 in changed files; `--exact` 7 differ / 11 identical. Deviations D-1 to D-7 (§6.7) |
| 2026-10-07 | SA code review (SA) | ✅ Code approved for QA. C-1 to C-5 met. No ownership check can be bypassed: F-1's check runs before H3; J/K/L check before any write; F-2 refuses when unmapped and scopes the write by owner, with `{ count: 'exact' }` and no `.select()`; F-4 vets links before the insert, columns and metadata copy. SA's independent re-hash: 20/20 unchanged entries identical, 8 changed, 12 new, 0 missing. 12 suites / 163 tests / 40 snapshots green. Findings: 1 Low (raw metadata id logged), 1 Low informational (F2-1 asserts scope only), 1 Medium follow-up (FU-5 wider reach). None blocking |
| 2026-10-07 | QA (QA) | **PASS WITH NOTES.** New `fix1Ownership.qa.test.ts` (28 tests, no snapshots): happy paths, attacks (cross-tenant UUID, planted Stripe id on J/K/L, foreign checkout booking, foreign PI links, unmapped account, read errors, 500 path), id-shape edges (empty, whitespace, malformed, case), dedupe order, per-account owner cache. 15 of 28 fail against the `248de6be` route (mutation check). Regression: 20 suites / 247 tests / 40 snapshots; repositories 64 / 1,355; 90 of 91 guards (the 1 failure, `oneAddressPolicy`, is a Windows path issue in untouched files). Snapshot blob `09a244f2` unchanged throughout. 0 bugs; N-1 Low (malformed id logged as `read_failed`), N-2 to N-5 informational |
