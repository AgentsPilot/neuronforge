# Workplan: Webhook Fix-1b — instalment-plan link ownership (F-5)

> **Last Updated**: 2026-10-07

**Developer:** Dev
**Requirement:** [BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md) (finding F-5); SA ruling in [BUSINESS_OS_WEBHOOK_CONNECT_FIX1_WORKPLAN.md](/docs/workplans/BUSINESS_OS_WEBHOOK_CONNECT_FIX1_WORKPLAN.md) (C-5, Q-F1-5)
**Branch:** `fix/webhook-plan-booking-ownership` (off `origin/main` @ `2a88f0bc`, which includes Fix-1 / PR #242)
**Date:** 2026-10-07
**Status:** Code Complete (SA approved with conditions C-1..C-6; awaiting SA code review and QA)

## Overview

Fix-1 vetted the link ids on `payment_intent.succeeded`. The instalment-plan path still trusts them. Three webhook call sites pass the metadata `booking_id`, `service_id` and `payment_plan_id` into `bindPlanSubscription` unchecked. That function stores them on `payment_plan_subscriptions` and `payment_plan_installments`. `recordPlanPeriodPaid` then copies `booking_id` onto every later period's `payment_transactions` row. From there the unscoped trigger `propagate_refund_to_booking` (`20260903_propagate_refund_to_booking.sql`, `UPDATE scheduling_bookings … WHERE id = target`) writes to that booking, whichever business owns it.

This is a security and tenant-isolation fix only. Business logic does not change: an owned id behaves exactly as before, and a foreign id behaves like an absent one.

---

## Analysis Summary

| Touches | How |
|---|---|
| `lib/payments/bindPlanSubscription.ts` | Vets the three link ids before any use (the main fix) |
| `lib/repositories/PaymentPlanRepository.ts` | New lean `findOwnedId` (C-1 shape) |
| `app/api/stripe/webhook/route.ts` | `ownedOrNull`: `malformed` reason, no raw value logged for a non-UUID id |
| `lib/payments/ownedLinkId.ts` (new, see Q-1) | One shared vetting helper and UUID-shape check for both callers |
| Tests | bind unit tests, one harness fixture, harness and QA expectations |
| DB / migrations | **None.** No trigger change in this fix (see Q-4) |

---

## Where the owner comes from (all 3 call sites)

In `bindPlanSubscription`, `ownerId` is a parameter. At every call site it holds a value that has just been proven equal to the DB owner of the signed `event.account`:

`event.account` (signed payload) → `connectAccountId` (route.ts **L2422**) → `accountOwns(connectAccountId, X)` → `accountOwner()` → `resolveAccountOwner(supabaseAdmin, connectAccountId)` (DB, **L1141–1160**). If the check fails, the call is skipped.

| # | Site | Event dispatch | Ownership gate | `ownerId` passed | Bind call |
|---|---|---|---|---|---|
| 1 | `handleConnectPlanSubscriptionCreated` (trialling) | L2529 | L1079 `accountOwns(connectAccountId, planMeta.owner_id)`, refuses at L1078–1083 | L1096 `planMeta.owner_id` (== proved owner) | L1088–1104 |
| 2 | `handleConnectInvoicePaid` (first period, booking modal) | L2470 | L1206 `accountOwns(connectAccountId, planMeta.owner_id)`, else refuses at L1232–1236 | L1216 `planMeta.owner_id` | L1210–1224 |
| 3 | `handleConnectCheckoutCompleted` (hosted checkout) | L2508 | L1662 `ownerId && accountOwns(connectAccountId, ownerId)`, else refuses at L1678–1681 | L1668 `ownerId` (from L1659) | L1663–1675 |

So the metadata `owner_id` only reaches bind after it has been matched to the DB owner of `event.account`. A forged `owner_id` never gets that far. **No change at the call sites.** The bind JSDoc gains one sentence stating the contract: "`ownerId` must already be proved to own `connectAccountId`; every link id is vetted against it here." The link ids are the only untrusted inputs left, and Fix-1b closes them.

---

## Implementation Approach

### A. `bindPlanSubscription` vets its own links (SA C-5: one change covers all 3 sites)

Placement: **after** the "already bound AND projected" early return (L110–131) and **before** the repair branch (L133–151). A plain redelivery therefore costs no extra reads. Both the repair path and the first-bind path use only vetted ids.

```text
bookingId  = vetted(bookingId,     schedulingBookingRepository.findOwnedId)   // #242
serviceId  = vetted(serviceId,     schedulingServiceRepository.findOwnedId)   // #242
paymentPlanId = vetted(paymentPlanId, paymentPlanRepository.findOwnedId)      // new, C-1
```

Each one returns the repository's id when it is owned. In every other case it returns `null`, logs one `logger.error` line naming `field` and `reason` (`malformed` | `not_owned` | `read_failed`), and continues. **Never throw, never refuse.** The Stripe schedule step (L167–222: `end_behavior: 'cancel'`, `duration: phaseDurationFor(planFrequency, planCount)`) does not depend on any link id, so the cap still holds when every link is dropped.

Downstream uses that now get only vetted values. Nothing else changes:

| Line(s) | Use |
|---|---|
| L138–149 | repair `projectPeriods` (booking_id on installments, contact, plan row) |
| L215–219 | Stripe schedule metadata `booking_id` / `service_id` |
| L249 | `resolveContactId(bookingId, …)` (already owner-scoped; now fed an owned booking) |
| L252 / L454–473 | `resolvePlanRowId`. L459 `if (paymentPlanId) return paymentPlanId` was the trust hole. A dropped id now falls through to the existing owner-scoped "service's oldest active plan" lookup (L462–470), the same as the hosted-checkout path (see Q-3) |
| L254–265 | `planRepo.create` `bookingId` / `serviceId` / `paymentPlanId`. This is the row `recordPlanPeriodPaid` copies onto every period payment (route.ts L887–890) |
| L291–302 / L371–384 | `payment_plan_installments.booking_id` |
| L402–415 | booking plan-link update (already `.eq('user_id')`, unchanged) |

### B. `PaymentPlanRepository.findOwnedId(id, userId)` (new)

Copies `SchedulingRepository.findOwnedId` (L528 / L1067) exactly: `from('payment_plans').select('id').eq('id', id).eq('user_id', userId).maybeSingle()`. It returns `{ data: id | null, error }`, does not log on not-found, and logs `{ err, planId, userId }` on error. There is no `is_active` or `deleted_at` filter, because the question it answers is "whose is it". bind uses the existing `paymentPlanRepository` singleton (L860–861, `supabaseServer`).

### C. `ownedOrNull` in route.ts (L602–630), from Fix-1 SA/QA notes

- A UUID-shape check runs **before** the read. A non-UUID id makes no DB read, returns `null`, and logs `reason: 'malformed'` with `idLength: rawId.length` instead of `id`. (Today it is read, fails 22P02, gets the `read_failed` label, and the raw value is logged twice: by `ownedOrNull` and by the repository's error log. Skipping the read removes both.)
- A UUID-shaped id behaves as today: `not_owned` or `read_failed`, with `id` logged.
- I propose `malformed` over `not_owned`. A non-UUID id cannot name any row, and keeping it distinct from `not_owned` stops it looking like a cross-tenant attempt in the logs.
- The shape check is case-insensitive: `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`. It matches the Postgres `uuid` input format, so uppercase still passes (QA E-3 intent kept). It does **not** trim, so `' <uuid> '` counts as malformed (see Q-2).

### D. Shared helper (Q-1)

New `lib/payments/ownedLinkId.ts` exports `isUuidShaped(s)` and `vetLinkId(rawId, ownerId, findOwnedId) → { id: string | null; reason: null | 'malformed' | 'not_owned' | 'read_failed' }`. It does not log; each caller writes its own log line, so the route's existing message text, and therefore its snapshot, stays the same. Both `ownedOrNull` and bind use it, so the shape rule exists in exactly one place.

---

## Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `lib/payments/bindPlanSubscription.ts` | modify | §A: vet booking/service/plan ids after L131; JSDoc contract on `ownerId` |
| `lib/repositories/PaymentPlanRepository.ts` | modify | §B: add `findOwnedId` |
| `lib/payments/ownedLinkId.ts` | create | §D: shared shape check and vetting (Q-1) |
| `app/api/stripe/webhook/route.ts` | modify | §C: `ownedOrNull` uses `vetLinkId`; `malformed` + `idLength` |
| `lib/payments/__tests__/bindPlanSubscription.test.ts` | modify | Supabase stub answers `scheduling_bookings`/`scheduling_services`/`payment_plans` `select('id')`; INPUT ids become UUIDs; new attack cases |
| `lib/payments/__tests__/ownedLinkId.test.ts` | create | Unit tests for shape and reasons |
| `lib/repositories/__tests__/PaymentPlanRepository.findOwnedId.test.ts` | create | Repo method unit test (owned / foreign / error) |
| `app/api/stripe/webhook/__tests__/fixtures/connect/payment-intent-succeeded.json` | modify | `ct-1` / `bk-0002` / `svc-2` become fixed UUID constants (otherwise §C drops them as malformed) |
| `app/api/stripe/webhook/__tests__/connectPath.characterisation.test.ts` | modify | Same UUID constants in DB answers and expectations; new F5 entries |
| `app/api/stripe/webhook/__tests__/fix1Ownership.qa.test.ts` | modify (QA owns; Dev makes only the mechanical id swap, QA rewrites E-2) | H-4, A-10, A-11, A-13, E-3 ids; E-2 becomes malformed, no read |
| `…/__snapshots__/connectPath.characterisation.test.ts.snap` | regenerate | See snapshot proof |

---

## Task List

- [x] ✅ 1. Record the BEFORE evidence (done, below).
- [x] ✅ 2. `ownedLinkId.ts` + its unit test.
- [x] ✅ 3. `PaymentPlanRepository.findOwnedId` + its unit test.
- [x] ✅ 4. bind: vet after L131, JSDoc. Extend the bind test stub, then add the attack tests.
- [x] ✅ 5. route `ownedOrNull` → `vetLinkId`, malformed/idLength.
- [x] ✅ 6. Fixture and harness ids to UUID constants; run the map-back proof (below).
- [x] ✅ 7. QA test mechanical id swap; flag E-2 to QA.
- [x] ✅ 8. Add harness F5 entries; regenerate the snapshot; compare per-entry hashes against BEFORE.
- [x] ✅ 9. Run all affected suites with `--ci --runTestsByPath`; `git diff --numstat` check; scoped `tsc` on changed files.

---

## Tests

### Unit: `bindPlanSubscription.test.ts` (new cases; the 18 existing cases must stay green after the stub/ID update)

| ID | Case | Asserts |
|---|---|---|
| B-1 | foreign `bookingId` | `planRepo.create` `bookingId: null`; every installment `booking_id: null`; schedule metadata `booking_id: ''`; no `scheduling_bookings` update; one error log `field: booking_id, reason: not_owned` |
| B-2 | foreign `serviceId` | create `serviceId: null`; schedule metadata `service_id: ''`; plan-row fallback not run on a foreign service |
| B-3 | foreign `paymentPlanId` | not stored; falls back to the owned service's active plan, or `null` if none (projection skipped, existing log) |
| B-4 | ownership read error (each of the 3) | link dropped, `reason: read_failed`, function resolves (no throw) |
| B-5 | non-UUID ids | no read; `reason: malformed`, `idLength` logged, raw value absent from every log arg |
| B-6 | own ids (all 3 owned) | stored exactly as today (regression) |
| B-7 | **cap still enforced** when all three are dropped, and again when all three reads error | `subscriptionSchedules.update` called once with `end_behavior: 'cancel'` and `duration` = `phaseDurationFor('monthly', 3)` |
| B-8 | repair branch (recorded, 0 periods) with a foreign `bookingId` | re-projected installments carry `booking_id: null` |
| B-9 | already bound AND projected | no ownership read at all (redelivery cost unchanged) |

### Unit: `ownedLinkId.test.ts`, `PaymentPlanRepository.findOwnedId`

Absent and empty → `{null, null}` with no read; uppercase UUID passes; whitespace-padded fails; owned / not owned / error map to the right reason. The repo test checks the select chain is `id` + `user_id` + `maybeSingle`, with no log on not-found.

### Harness (`connectPath.characterisation`), new additive entries

The harness mocks `bindPlanSubscription`, so these entries pin the **route**:
- **F5-1** `payment_intent.succeeded` with non-UUID link ids: no ownership read, three `malformed` lines with `idLength` and no `id`, money recorded with null links.
- **F5-2/3/4** for each of the 3 plan sites: bind is called with `ownerId` equal to the account's DB owner, and the raw metadata link ids are passed through unchanged (the vetting is bind's job, so this records where the boundary sits).

### QA (QA to add): `planOwnership.qa.test.ts`

The 3 plan events run end to end through the route with the **real** `bindPlanSubscription`. Only Stripe and Supabase are mocked. Expected results:
- a foreign `booking_id` never appears in the `payment_plan_subscriptions` insert, the `payment_plan_installments` insert, or the later `invoice.paid` period `payment_transactions` insert (the trigger's input);
- a foreign `payment_plan_id` never appears either;
- the schedule is still bounded;
- the event completes with 200.

Manual check: none needed beyond this (no UI).

---

## Snapshot proof

### BEFORE (recorded 2026-10-07 on this branch, tree = `2a88f0bc` + TL's requirement doc only)

| Suite | Tests | Snapshots |
|---|---|---|
| `connectPath.characterisation.test.ts` | 41 passed | 40 passed |
| `bindPlanSubscription.test.ts` | 18 passed | — |
| `fix1Ownership.qa.test.ts` | 28 passed | — |
| All 10 webhook/plan suites together (+ routerEdgeCases, planSurfaces, deferredFirstPayment, pinoLogging, routerPlacement, receiptOnPaid, emptyBody guards) | 184 passed | 40 passed |

Snapshot blob (working tree = index = HEAD): `09a244f2fd16b0b705c0fac00fdecc85a6438fde`

Per-entry sha256/12 (LF-normalised, scratchpad `snap-entry-hashes.js`; saved as `fix1b-before-entry-hashes.txt`):

```text
8022d8bed1ab  1a   891fc73d2c34  1b   22a9b97e5d2c  2    277fcb96150f  3
2a91ff767596  4a   022f817dd48f  4b   ab52b3e61f5e  5a   07068b0d08c1  5b
f68b79bedad5  6a   126b507e3330  6b   f749503e9dcf  6c   62dd8b061797  7a
bbd25008c830  7b   b355f36a18d7  8    62b79e0594d7  9a   62b79e0594d7  9b
5d518155de6a  9c   834f1992f0e8  10   df0234e124a1  11
62df7c538cdc  F1-1 62df7c538cdc  F1-2 fd8282035f5c  F1-3 c89704adbcd8  F1-4
9047aec38b03  F1-5 4f0c1147c8ec  F2-1 b448ea609500  F2-2
1e7fc1b337cc  F4-1 53783aef611f  F4-2 88030947deee  F4-3 1e7fc1b337cc  F4-4
d9d2555c77d9  F4-5
9f31fb9e98f6  P10-1 be522a658937 P10-2 13d044eb4647 P1  0b13c275dff4 P2
1306164051ae  P3  1dcd2e039d06  P4  89f1db3bc3c1  P5  74d4c5a2a95e  P6
4a8d036b2e3a  P7
```

### Expected AFTER

| Entries | Expected | How it is proved |
|---|---|---|
| **5a, 10, F4-1, F4-2, F4-3, F4-4** (the 6 entries that use `payment-intent-succeeded.json` with link ids) | Text changes, **only** `ct-1` / `bk-0002` / `svc-2` replaced by their UUID constants | **Map-back proof:** replace the 3 UUID constants with the old literals in the AFTER snapshot, re-hash; each of the 6 must equal its BEFORE hash above |
| **F5-1 … F5-4** | New (additive) | Reviewed by eye; not in BEFORE |
| **All other 34 entries** (incl. **3**, whose bind args are unchanged because bind is mocked) | **Byte-identical** to BEFORE hash | Per-entry hash diff |

Net: 40 → 44 entries (F5-2/3/4 may merge into one entry per site at SA's preference). Any change to an entry outside the 6 + new ones is a stop.

---

## Guard tests affected

| Guard | Effect |
|---|---|
| `pinoLogging.guard` (webhook) | None expected (no `console.*`; new log uses `{ field, reason, idLength }`) |
| `planSurfaces.guard`, `deferredFirstPayment.guard` | Source-level pins on bind and plan surfaces. Re-run; no change expected because the bind signature is unchanged |
| `routerPlacement`, `receiptOnPaid`, `emptyBody`, `routerEdgeCases` | Re-run; no change expected |
| Repository guards in `test:bos-entitlements` (`lib/repositories/__tests__`) | Re-run because a repository gains a method. This change does not touch entitlements |
| `fix1Ownership.qa` E-2 | **Intentional flip**: `read_failed` becomes `malformed`, with no read and no raw value. This was the QA observation that asked for it |

---

## CI-time impact

Pure Jest additions: about 12 unit cases, 1 small repo test file, 1 helper test file and 4 harness entries, all with mocked I/O. Estimated **+1–2 s** of CPU spread across the existing shards. Nothing runs on the critical path and no new job is added (consistent with the no-added-CI-time rule).

---

## Open questions for SA

1. **Q-1 New file.** Is `lib/payments/ownedLinkId.ts` (shared `isUuidShaped` + `vetLinkId`) acceptable, or should each file keep a private copy of the regex? `lib/business-os/llm/callCatalog.ts` already has an `isUuid`, but importing an LLM module into payments would be the wrong dependency direction.
2. **Q-2 Reason label and trimming.** Do you confirm `malformed` (proposed) over `not_owned`, and no trimming (a padded UUID counts as malformed and is dropped, never "repaired")?
3. **Q-3 Plan-row fallback.** When a foreign `payment_plan_id` is dropped, bind falls through to the existing owner-scoped "oldest active plan for the (owned) service" lookup, which is exactly what an absent id does today. Is that within "no business-logic change", or should a dropped plan id leave `planRowId` null (no periods projected, loud log)? I recommend the fallback, because it keeps the period count visible to the owner.
4. **Q-4 Trigger.** `propagate_refund_to_booking` stays unscoped. Fix-1 + Fix-1b remove every webhook path that writes a foreign `booking_id` into `payment_transactions` that I know of. Should scoping the trigger itself (`AND user_id = NEW.user_id`) be tracked as a separate defence-in-depth migration (not in this branch, needs SA + user)?
5. **Q-5 Existing bad rows.** Should a one-off read-only query be written to look for `payment_plan_subscriptions` / `payment_plan_installments` rows whose `booking_id`, `service_id` or `payment_plan_id` belongs to a different `user_id`? It would be reported only, never auto-repaired.
6. **Q-6 Fixture churn.** Changing the shared `payment-intent-succeeded.json` ids to UUIDs touches 6 snapshot entries (proved by map-back) and 5 QA cases. The alternative is a second fixture for UUID-shaped links, which would leave those 6 entries showing "malformed → dropped" behaviour. That alternative is worse, because the existing entries would stop characterising the happy path. Do you agree with the fixture change?

---

## Implementation Notes and Evidence (Dev, 2026-10-07)

Implemented on `fix/webhook-plan-booking-ownership` (base `2a88f0bc`). Nothing is committed (RM's job, after user review).

### What changed

| File | Change |
|---|---|
| `lib/payments/ownedLinkId.ts` (new) | `isUuidShaped` (canonical 8-4-4-4-12 hex, case-insensitive, no trimming) and `vetLinkId(rawId, ownerId, findOwnedId)` → `{ id, reason }`. It does no logging and no I/O of its own (Q-1). |
| `lib/repositories/PaymentPlanRepository.ts` | `findOwnedId(id, userId)`: `select('id')`, `id` + `user_id`, `maybeSingle()`, no log on not-found, `{ err }` on error (C-1 shape, same as #242). |
| `lib/payments/bindPlanSubscription.ts` | The three links are vetted at L159–174, after the "bound AND projected" return (L130–145) and before both the repair branch and the first bind. They are read only through the `findOwnedId` repository singletons (C-5). `vettedOrNull` (L532) writes one `logger.error` per dropped link with the static message `Plan link not proved to belong to the owner - dropping it` and the fields `{ subscriptionId, connectAccountId, ownerId, field, reason }`, plus `id` (not_owned / read_failed) or `idLength` (malformed) (C-1). JSDoc is updated on `ownerId` (the contract), `bookingId`, `serviceId`, `paymentPlanId` and `resolvePlanRowId` (C-6). No `console.*`; no entitlements import. |
| `app/api/stripe/webhook/route.ts` | `ownedOrNull` (L613) delegates to `vetLinkId`. A non-UUID id gets no read, `reason: 'malformed'` and `idLength`, never the value. The message text and the other fields are unchanged. The 3 plan call sites are unchanged. |
| Fixtures | `payment-intent-succeeded.json`: link ids changed to `c7c7c7c7-…c701` / `b7b7b7b7-…b702` / `e7e7e7e7-…e702` (C-2). New: `payment-intent-succeeded-malformed-links.json`, `subscription-created-trialing-plan.json`, `invoice-paid-plan-first-period-foreign-links.json`, `checkout-completed-plan-foreign-links.json`. |
| `connectPath.characterisation.test.ts` | Ids swapped only in `OWNED_LINKS` and the F4 block (`PLATFORM_INVOICE` and every other `ct-1` untouched). New describe `Fix-1b: plan link ids`: F5-1 to F5-4 (snapshots) and F5-5 (no snapshot: a foreign owner never reaches bind at any of the 3 sites). |
| `bindPlanSubscription.test.ts` | The stub answers ownership reads (`select('id')` + `eq('id')`) from `mockState.owned` / `readError` and records every `maybeSingle` chain. INPUT ids are UUIDs. Adds B-1 to B-9 (B-7 runs twice). |
| `ownedLinkId.test.ts` (new) | Shape rule (including the SA optimisation: braces and no-hyphen forms count as malformed) and the four outcomes. |
| `findOwnedId.ownership.test.ts` | `PaymentPlanRepository` added to the existing `describe.each`, instead of a separate test file (deviation D-1). |
| `fix1Ownership.qa.test.ts` | The ids in H-4, A-10, A-11 and E-3 swapped to UUID constants. **E-2 rewritten** for the new behaviour (malformed, no read, `idLength`, no raw value logged): QA please review (D-2). |

### Deviations from the plan

- **D-1:** the repository test was folded into `findOwnedId.ownership.test.ts` (one more `describe.each` row: same three cases, same shape assertions) rather than a new file.
- **D-2:** Dev rewrote QA's E-2 so the suite stays green. Its assertions follow SA Q-2. QA owns the file and may adjust it.
- **D-3:** F5-1 to F5-4 are one snapshot entry per site as SA asked, plus F5-1 for `malformed`. **F5-5** is an extra non-snapshot test: a foreign owner never reaches bind at any of the 3 sites.

### Mutation check

With the HEAD version of `bindPlanSubscription.ts` copied in temporarily (and then restored, `cmp` identical), the new tests give **6 failed / 22 passed**. The failures are B-1, B-2, B-3, B-4, B-5 and B-8. B-6, B-7 and B-9 pass on both versions by design: they pin legitimate behaviour (owned ids, the cap, redelivery cost).

### Test counts (AFTER)

| Suite | BEFORE | AFTER |
|---|---|---|
| `connectPath.characterisation` | 41 tests / 40 snapshots | **46 / 44** |
| `bindPlanSubscription` | 18 | **28** |
| `fix1Ownership.qa` | 28 | 28 |
| `ownedLinkId` (new) | — | 18 |
| `findOwnedId.ownership` | 9 | 12 |
| **Regression and guard set**: 107 suites, every test touching the webhook route, `bindPlanSubscription`, the scheduling or plan repositories, all of `app/api/stripe/webhook/__tests__` and all of `lib/repositories/__tests__` | — | **107 suites, 2080 tests, 63 snapshots, all passed** (67 s) |

Guards included and green: `pinoLogging`, `routerPlacement`, `receiptOnPaid`, `emptyBody`, `routerEdgeCases`, `noBookingGuess`, `planSurfaces`, `deferredFirstPayment`, `servicePlanWiring`, `paymentTablesWriteLockdownMigration`, `userSubscriptionsWriteLockdown`.

### Snapshot proof (C-2)

Snapshot blob: BEFORE `09a244f2fd16b0b705c0fac00fdecc85a6438fde` → AFTER `3f2630f704ca6c81c4fbb312d8ea12f0183f8eff`.

Updated only with anchored filters, in two runs:
1. `-u -t "^Stripe webhook, Fix-1b: plan link ids F5-"` → **4 written**, 41 skipped.
2. `-u -t "^(Stripe webhook, Connect path characterisation \(P-0 baseline\) (5a|10)\. |Stripe webhook, Fix-1: ids the sending business cannot prove it owns F4-[1-4]\. )"` → **6 updated**, 40 skipped.

Before updating, the plain `--ci` run failed exactly those 6 (5a, 10, F4-1..F4-4) and nothing else.

The map-back script (`scratchpad/fix1b-mapback.js`) hashes each entry (sha256/12, LF-normalised) in BEFORE (`git show HEAD:` the .snap) and AFTER. For each changed entry it maps the three constants back to `ct-1` / `bk-0002` / `svc-2` and re-hashes. Its precondition (none of the constants occurs in BEFORE) held.

```text
IDENTICAL  8022d8bed1ab  1a          IDENTICAL  891fc73d2c34  1b
IDENTICAL  22a9b97e5d2c  2           IDENTICAL  277fcb96150f  3
IDENTICAL  2a91ff767596  4a          IDENTICAL  022f817dd48f  4b
MAPBACK    before ab52b3e61f5e  after 47e5165aceee  mapped ab52b3e61f5e  5a
IDENTICAL  07068b0d08c1  5b          IDENTICAL  f68b79bedad5  6a
IDENTICAL  126b507e3330  6b          IDENTICAL  f749503e9dcf  6c
IDENTICAL  62dd8b061797  7a          IDENTICAL  bbd25008c830  7b
IDENTICAL  b355f36a18d7  8           IDENTICAL  62b79e0594d7  9a
IDENTICAL  62b79e0594d7  9b          IDENTICAL  5d518155de6a  9c
MAPBACK    before 834f1992f0e8  after 7ddafd030af4  mapped 834f1992f0e8  10
IDENTICAL  df0234e124a1  11
IDENTICAL  62df7c538cdc  F1-1        IDENTICAL  62df7c538cdc  F1-2
IDENTICAL  fd8282035f5c  F1-3        IDENTICAL  c89704adbcd8  F1-4
IDENTICAL  9047aec38b03  F1-5        IDENTICAL  4f0c1147c8ec  F2-1
IDENTICAL  b448ea609500  F2-2
MAPBACK    before 1e7fc1b337cc  after 662192201bef  mapped 1e7fc1b337cc  F4-1
MAPBACK    before 53783aef611f  after 5cefd75f4a3d  mapped 53783aef611f  F4-2
MAPBACK    before 88030947deee  after 87c2bad23954  mapped 88030947deee  F4-3
MAPBACK    before 1e7fc1b337cc  after 662192201bef  mapped 1e7fc1b337cc  F4-4
IDENTICAL  d9d2555c77d9  F4-5
ADDED      e3915047787b  F5-1        ADDED      6d9a9e33bba1  F5-2
ADDED      f9f16a886d40  F5-3        ADDED      9a688fafea7a  F5-4
IDENTICAL  9f31fb9e98f6  P10-1       IDENTICAL  be522a658937  P10-2
IDENTICAL  13d044eb4647  P1          IDENTICAL  0b13c275dff4  P2
IDENTICAL  1306164051ae  P3          IDENTICAL  1dcd2e039d06  P4
IDENTICAL  89f1db3bc3c1  P5          IDENTICAL  74d4c5a2a95e  P6
IDENTICAL  4a8d036b2e3a  P7
{"before":40,"after":44,"identical":34,"mapback":6,"added":4,"CHANGED":0,"REMOVED":0}
```

### Type-check and lint (scoped)

- **`tsc`**, on the 9 changed TypeScript files (`scratchpad/tsconfig.fix1b.json`): **0 errors in any changed production file.** Three errors appear in the transitive output, all pre-existing and in lines this change did not touch:
  - `fix1Ownership.qa.test.ts:578` (E-7's `for (const metadata of [{…}, {}])`, which is not a `Record<string, string>`; QA's code, untouched, outside every diff hunk);
  - `lib/payments/contactStatement.ts:219`;
  - `lib/payments/invoiceSettlement.ts:349`.
- **`eslint`**, on the 9 changed files: 0 errors and 6 warnings, all in `route.ts`. They are the same 6 as HEAD (checked by linting `git show HEAD:route.ts` over stdin), shifted by 7–8 lines.

### C-3: report-only query for links that already cross businesses

Run it by hand in the Supabase SQL editor. It is **read-only** and returns counts and our own row ids only, no personal data. It deliberately avoids the word that breaks the editor. **No rows returned means clean.** Any row is a stop: escalate to TL and the user. Repair is out of scope, and a hit moves the trigger follow-up (FU-6) to next.

```sql
-- Fix-1b C-3: rows whose link names a row owned by a different business.
-- Read-only. Counts and row ids only. No rows returned = clean.
with cross_links as (
  select 'payment_plan_subscriptions.booking_id' as link, s.id as row_id
  from payment_plan_subscriptions s
  join scheduling_bookings b on b.id = s.booking_id
  where b.user_id is distinct from s.user_id
  union all
  select 'payment_plan_subscriptions.service_id', s.id
  from payment_plan_subscriptions s
  join scheduling_services v on v.id = s.service_id
  where v.user_id is distinct from s.user_id
  union all
  select 'payment_plan_subscriptions.payment_plan_id', s.id
  from payment_plan_subscriptions s
  join payment_plans p on p.id = s.payment_plan_id
  where p.user_id is distinct from s.user_id
  union all
  select 'payment_plan_installments.booking_id', i.id
  from payment_plan_installments i
  join scheduling_bookings b on b.id = i.booking_id
  where b.user_id is distinct from i.user_id
  union all
  select 'payment_plan_installments.payment_plan_id', i.id
  from payment_plan_installments i
  join payment_plans p on p.id = i.payment_plan_id
  where p.user_id is distinct from i.user_id
  union all
  select 'payment_transactions.booking_id', t.id
  from payment_transactions t
  join scheduling_bookings b on b.id = t.booking_id
  where b.user_id is distinct from t.user_id
)
select link, count(*) as rows_found, array_agg(row_id order by row_id) as row_ids
from cross_links
group by link
order by link;
```

The column names come from code that writes them today: `PaymentPlanSubscription` (user_id, booking_id, service_id, payment_plan_id), the installments insert in `projectPeriods` (user_id, payment_plan_id, booking_id) and the period `payment_transactions` insert in `recordPlanPeriodPaid` (user_id, booking_id). `payment_plan_installments.payment_plan_id` is one more than C-3 lists, because L459 fed it too. **Result (run by the user in the Supabase SQL editor, 2026-10-07): "Success. No rows returned" — clean, no existing cross-business links. No repair needed.**

### Follow-ups (C-4)

| # | Follow-up | Where it is carried |
|---|---|---|
| FU-6 | Scope `propagate_refund_to_booking` (`20260903_propagate_refund_to_booking.sql`) by `user_id = NEW.user_id` in **both halves**: the `UPDATE scheduling_bookings … WHERE id = target` (L93–96) and the aggregate (L75), which sums every tenant's transactions naming `target`. This needs its own migration, SA and user sign-off, and a hand-applied prod step. Not in Fix-1b (Q-4). | TL, with FU-5; marked on the requirement's CF-5 row |
| FU-7 | The 5 pre-existing inline `supabaseServer` queries in `bindPlanSubscription.ts` (CLAUDE.md rule 1): L143 installment count, L415 installments insert, L447 booking plan-link update, L475 `resolveContactId`, L508 `resolvePlanRowId` fallback. These were L123, L371, L403, L431 and L462 at `2a88f0bc`. Not changed here. | [Refactor workplan](/docs/workplans/BUSINESS_OS_WEBHOOK_CONNECT_REPOSITORIES_WORKPLAN.md) PR 4 (plans), scope addition |
| — | Rows already written with a cross-business link are not repaired by Fix-1b. `recordPlanPeriodPaid` keeps copying a stored foreign `booking_id` onto every future period. | Depends on the C-3 result |

### CI-time impact (measured)

The new and changed suites are `ownedLinkId` (18 tests), the 10 new bind cases, 3 repository cases and 5 harness tests. All are mocked I/O, under 1 s of added test time, spread over the existing shards. There is no new job.

---

## SA Review Notes

**Reviewed by SA — 2026-10-07**
**Status:** ✅ Approved with conditions (C-1 to C-6 below; checked at code review, no plan re-review needed)

### Verified against the tree (`2a88f0bc`)

| Claim | Result |
|---|---|
| 3 call sites, owner proved before bind | ✅ `route.ts` L1079 → L1088 (trialling), L1206 → L1210 (`invoice.paid`), L1662 → L1663 (checkout). Each one gates on `accountOwns(connectAccountId, X)`, which compares X to `resolveAccountOwner` for the signed `event.account` (L1141–1160), and passes the same X as `ownerId`. These are the only callers of `bindPlanSubscription` in `app/` and `lib/`. |
| Early-return placement | ✅ The "bound AND projected" return is L128–131, and nothing above it uses a link id. Vetting between L131 and L133 covers both the repair branch (L138–149) and the first bind. Redelivery cost does not change (B-9). |
| Every place the raw ids flow | ✅ The table in §A is complete: repair `projectPeriods` (L141, L146, L147, L148), schedule metadata (L216, L218), `resolveContactId` (L249), `resolvePlanRowId` (L252; **L459 is the trust hole**), `planRepo.create` (L257–259), installments (L376), booking link (L402–407, already scoped). The raw values go nowhere else in the route: `planMeta.*` is used only at L1097/1098/1103 and L1217/1218/1223, and `session.metadata.service_id` only at L1671. The checkout `bookingId` (L1637) also reaches L1844–1883, which Fix-1 C-3 already scoped. |
| Cap independent of the ids | ✅ L189–222: `end_behavior: 'cancel'` and `duration: phaseDurationFor(planFrequency, planCount)` use no link id. The ids only feed the schedule's `metadata`. |
| The 6 expected snapshot changes | ✅ Confirmed by scanning the `.snap`. Exactly 6 entries contain all three of `ct-1`, `bk-0002` and `svc-2`: **5a, 10, F4-1, F4-2, F4-3, F4-4**. 5b uses the fixture but is refused before any link appears in its snapshot. F4-5 uses the no-links fixture. **Caution:** 1a, 1b, 4a, 6a and 7b also contain `ct-1` (from `PLATFORM_INVOICE` and other DB answers), so the swap must not touch them (C-2). |
| Legitimate inputs are UUIDs | ✅ `/api/website/payment-intent` validates `booking_id` with `z.string().uuid()` (L40). `service_id` and `payment_plan_id` come from DB rows. So `malformed` cannot fire for a legitimate caller. In the route, a non-UUID id already ended as `null` (22P02 → `read_failed`). The stored outcome is identical; only the log label changes. |

### Rulings on Q-1 to Q-6

- **Q-1 — Approved.** Create `lib/payments/ownedLinkId.ts` with no logging and no I/O of its own, taking the repository method as a parameter. One shape rule in one place is right. Importing `callCatalog.isUuid` would make payments depend on the LLM module, which is the wrong direction. This is not a new pattern: it is the Fix-1 oracle with a pure pre-check.
- **Q-2 — Approved: `malformed`, case-insensitive, no trimming.** A non-UUID cannot name a row, so labelling it `not_owned` would make noise look like a cross-tenant attempt. Trimming would "repair" untrusted input, and no legitimate path produces padding (Zod `uuid()` rejects it). Log `idLength`, never the value.
- **Q-3 — Fallback approved (Dev's recommendation).** For a legitimate same-business caller the plan id is owned, `vetLinkId` returns it, and L459 returns it exactly as today. The fallback never runs, so that caller sees no change. The choice only matters for a foreign or malformed id (no legitimate caller sends one) or a transient read error. "Dropped behaves like absent" is the principle in the Overview, and absent already falls back to the owner-scoped oldest active plan of the (now vetted) service. That is an existing path, the one the hosted checkout uses every day. Leaving `planRowId` null would add a new branch where "present but dropped" differs from "absent". It would also produce a new owner-visible outcome ("0 of N paid", with no periods), which is inventing business behaviour. With a foreign `serviceId` also dropped, the fallback does not run (L460), so a foreign service can never select a plan (B-2).
- **Q-4 — Tracked follow-up, not in Fix-1b.** Fix-1 and Fix-1b close the webhook writers. The trigger is defence in depth and needs its own migration with SA and user sign-off and a hand-applied prod step. Keep this PR migration-free. The follow-up must cover both halves of `20260903_propagate_refund_to_booking.sql`: the `UPDATE … WHERE id = target` (L93–96) and the aggregate at L75, which sums every tenant's transactions that name `target`. Scope both by `user_id = NEW.user_id`. TL carries this with FU-5 (C-4).
- **Q-5 — Yes. It is cheap and report-only (C-3).** It is not part of the PR code. It matters more than usual here: `recordPlanPeriodPaid` copies the **stored** `plan.data.booking_id` onto every future period (route.ts L887–890), so a bad row written before this fix keeps feeding the trigger after it merges. Fix-1b does not repair such rows.
- **Q-6 — Agree with changing the fixture ids.** A second fixture would turn the 6 happy-path entries into "malformed → dropped" characterisations, losing the baseline they exist to pin. The swap is a pure substitution, and the map-back proves that. Keep F5-2/3/4 as **one entry per site** (3 entries, 40 → 44): a failure then names the site.

### Accepted deviation from SA C-5 (Fix-1)

C-5 suggested folding the booking check into the existing `resolveContactId` read. The plan uses a separate `findOwnedId` read instead, and **I accept that.** The booking must be vetted **before** the Stripe schedule metadata (L216), and `resolveContactId` runs after it. Reusing the Fix-1 oracle keeps one ownership shape across the webhook. The cost is one extra read, on first bind only.

### Conditions

1. **C-1 (bind log line).** Write one `logger.error` per dropped link. The message is static. Fields: `{ subscriptionId, connectAccountId, ownerId, field, reason }`, plus `id` for `not_owned` / `read_failed`, or `idLength` for `malformed`. Never the raw malformed value. `subscriptionId` is required because a `read_failed` drop can affect a legitimate caller (accepted, consistent with the Fix-1 Q-F1-1 ruling), and repair needs it to find the plan. `field` takes the values `booking_id | service_id | payment_plan_id`.
2. **C-2 (scoped swap + map-back).** Swap the ids only in `payment-intent-succeeded.json`, `OWNED_LINKS`, and the F4 expectations and answers that refer to that fixture. Do **not** touch `PLATFORM_INVOICE.contact_id` or any other `ct-1` (entries 1a, 1b, 4a, 6a and 7b must stay byte-identical). The three UUID constants must be distinct, and none of them may appear anywhere in the BEFORE snapshot, so that the reverse substitution is unambiguous. Record the map-back script and its output in the evidence. Any of the 34 other hashes moving is a stop.
3. **C-3 (Q-5 report query).** Write one read-only SQL query. Do not include the word "into" anywhere in it: the Supabase SQL editor misparses it. The user runs it by hand. It lists rows where `payment_plan_subscriptions.booking_id` / `service_id` / `payment_plan_id`, `payment_plan_installments.booking_id`, or `payment_transactions.booking_id` names a row whose `user_id` differs from the referencing row's `user_id`. Return counts plus row ids only, no personal data. Record the result in the workplan. A non-empty result is a stop: escalate to TL/user. Repair is out of scope, and a hit raises the Q-4 follow-up to the next item.
4. **C-4 (follow-ups recorded).** Add a "Follow-ups" subsection to this workplan, and mark the F-5 row in the plan-payments requirement, for: the Q-4 trigger scoping (both halves), and the pre-existing inline `supabaseServer` queries in `bindPlanSubscription.ts` (L123, L371, L403, L431, L462; CLAUDE.md rule 1). Those queries are not changed here and are carried by the repository refactor PRs.
5. **C-5 (no new inline queries; tests).** The new reads in bind go only through the `findOwnedId` repository singletons (Q-F1-4 precedent). Extend B-6 to assert that an **owned** `paymentPlanId` is stored even when the service's oldest active plan is a different id: the fallback query must not run. This is the legitimate-behaviour regression for Q-3. B-3 must assert the fallback select chain includes `eq('user_id', ownerId)`.
6. **C-6 (docs in the touched file).** Update the `paymentPlanId` JSDoc (L67–75) and the `resolvePlanRowId` JSDoc ("Preferred from metadata", L449) to say the id arrives already vetted, and that a dropped id takes the absent-id fallback. Add the `ownerId` contract sentence as planned. `bindPlanSubscription.ts` and `PaymentPlanRepository.ts` have no `console.*` and no entitlements import today; re-check at code review.

### Optimisation Suggestions

- In `ownedLinkId.test.ts`, also pin that braces or no-hyphen forms (which Postgres accepts) count as `malformed`. That records that the rule is the canonical form our own code writes, not every format Postgres accepts.

### Approval
[x] Workplan approved with conditions C-1 to C-6 — proceed to implementation

---

**Code Review by SA — 2026-10-07**
**Status:** ✅ Code Approved (the pre-merge items below are owed by the user and QA, not by Dev)

Reviewed: `git diff` against `2a88f0bc` (11 files), plus the untracked `lib/payments/ownedLinkId.ts`, its test, the 4 new fixtures and this workplan.

### Conditions C-1 to C-6

| # | Result |
|---|---|
| C-1 | ✅ `vettedOrNull` (bind) writes one `logger.error` per dropped link with a static message and `{ subscriptionId, connectAccountId, ownerId, field, reason }`, plus `id` (not_owned / read_failed) or `idLength` (malformed). `field` is typed `'booking_id' \| 'service_id' \| 'payment_plan_id'`. B-4 and B-5 pin the exact objects. |
| C-2 | ✅ The swap is limited to the fixture, `OWNED_LINKS` and the F4 block. `PLATFORM_INVOICE` and every other `ct-1` are untouched. The three constants are distinct and absent from the BEFORE snapshot (checked). I re-did the map-back independently (below). |
| C-3 | ✅ As written (see the SQL check below). **Result recorded 2026-10-07: no rows (clean).** |
| C-4 | ✅ FU-6 and FU-7 are recorded here. The CF-5 row in the plan-payments requirement carries both, and the repositories workplan adds bind's 5 inline queries to PR 4. |
| C-5 | ✅ The new reads go only through the `findOwnedId` singletons, which are backed by `supabaseServer`. B-6 sets a different "oldest active plan" and asserts that the owned plan id is kept and that the fallback query never runs. B-3 asserts that the fallback chain contains `eq('user_id', 'user_1')` and `eq('service_id', SERVICE)`. |
| C-6 | ✅ JSDoc is updated on `ownerId` (the contract), `bookingId`, `serviceId`, `paymentPlanId` and `resolvePlanRowId`. No touched production file has `console.*` or an entitlements import (grep). |

### Placement and data flow (`bindPlanSubscription.ts`)

- The "bound AND projected" return (L131–151) is unchanged and runs before any ownership read. The old single `if (existing.data)` block is split in two with no other change, so a redelivery does no extra reads. B-9 asserts zero queries.
- The vetting (L165–174) runs before both the repair branch (L176–195) and the first bind. It reassigns the parameters, so every later use reads the vetted value:
  - the repair `projectPeriods` call and its `resolveContactId` / `resolvePlanRowId`;
  - the schedule `metadata.booking_id` / `service_id` (L259–263);
  - `resolveContactId` (L293) and `resolvePlanRowId` (L296);
  - `planRepo.create` (L298);
  - installments `booking_id` / `payment_plan_id` (L420);
  - the booking plan-link update (L447–452, already `.eq('user_id')`).

  No raw value is used after L174.
- `resolvePlanRowId` (L500–519): the trust hole `if (paymentPlanId) return paymentPlanId` now only ever sees an owned id or null. The fallback filters on `.eq('user_id', ownerId)` and `.eq('service_id', <vetted>)`. A dropped service never reaches it.
- The cap: `end_behavior: 'cancel'` and `duration: phaseDurationFor(planFrequency, planCount)` use no link id. B-7 proves it holds both when every link is foreign and when every read fails.
- The booking and service `findOwnedId` methods have no status or `deleted_at` filter, so a same-business cancelled or soft-deleted row still counts as owned. Same-business behaviour is unchanged.

### Logging of malformed values

`isUuidShaped` rejects a malformed value **before** `findOwnedId` is called, so the repository's own error log (which logs `bookingId` / `serviceId` / `planId`) never sees it. Bind and `ownedOrNull` log only `idLength`. Every other log line in bind takes the vetted value. B-5, F5-1 and E-2 each assert that the raw text is absent from the serialised log calls. The regex has no `m` flag, so `$` does not match before a trailing newline, and a test pins that.

### Map-back proof (re-done by SA, own method)

Method: BEFORE (`git show HEAD:` the .snap) and AFTER were parsed as JS modules in a `vm` sandbox, with line endings normalised to LF. Each entry value was compared by direct string equality. On the changed entries, the three constants were substituted back to the old literals. The fingerprints are md5/10, deliberately different from Dev's sha256/12. Script: `scratchpad/sa-mapback.js`.

```text
MAPBACK 5a, 10, F4-1, F4-2, F4-3, F4-4   (each mapped AFTER === BEFORE, string equality)
ADDED   F5-1, F5-2, F5-3, F5-4
{"before":40,"after":44,"identical":34,"mapback":6,"added":4,"changed":0,"removed":0}
```

The precondition held: none of the three constants, and none of their 8-character prefixes, appears in BEFORE. This confirms Dev's result.

### Dev's edits to QA-owned and existing tests

- **E-2 (rewritten): stronger, not weaker.** Before, it asserted a read with the raw padded value and three `read_failed` labels. Now it asserts:
  - no read on any of the 3 tables;
  - all three links null in the row;
  - `[field, 'malformed', idLength, undefined id]` for each link;
  - no raw text in any log line.

  QA still owns the file and should confirm the rewrite (D-2).
- **H-4, A-11, E-3:** pure constant swaps; every assertion keeps its shape. E-3 still proves that the stored value is the repository's id, not the raw upper-case one.
- **A-10:** `/victim/` became `/deadbeef/` to match the new victim constants. Equivalent.
- **Existing bind cases:** only the ids changed (`'svc_1'` → `SERVICE`, `'plan_from_meta'` → `PLAN_FROM_META`). The stub answers as an ownership read only on `select('id')` plus `eq('id', …)`, so the existing `resolvePlanRowId`, contact and count queries still take their old branches.
- **`findOwnedId.ownership`:** one `describe.each` row added, with the same three assertions as the others. D-1 accepted.

### C-3 SQL check

- **Read-only.** It uses only `with`, `select`, `join`, `union all` and `group by`, with no write keyword.
- **No "into".** A case-insensitive grep finds no occurrence of the word.
- **Columns exist.** Checked against the migrations:
  - `payment_plan_subscriptions.{user_id, booking_id, service_id, payment_plan_id}`: `20260828e`;
  - `payment_plan_installments.{user_id, payment_plan_id, booking_id}` and `payment_plans.user_id`: `20260723_enhance_payments`;
  - `payment_transactions.user_id`: `20260722_create_payment_tables`; `booking_id`: `20260810`;
  - `scheduling_bookings.user_id` and `scheduling_services.user_id`: `20260722_create_scheduling_tables`.
- **Comparison.** `is distinct from` is correct; every `user_id` is NOT NULL anyway.
- **Output.** No personal data.

### Rules

| Rule | Result |
|---|---|
| 1 | No new inline query. The 5 pre-existing ones are FU-7. |
| 3 | Pino only, no `console.*`. |
| 4 | Both new reads and the fallback are scoped by `user_id`. |
| 6 | No `any`. |

I re-ran a scoped `tsc`. The only error in a touched file is the pre-existing one at `fix1Ownership.qa.test.ts:578` (E-7), which is outside every diff hunk.

### Tests run by SA

Command: `--ci --runTestsByPath`.

Suites: characterisation, fix1Ownership.qa, bind, ownedLinkId, findOwnedId.ownership, pinoLogging, routerPlacement, receiptOnPaid, emptyBody, routerEdgeCases, planSurfaces, deferredFirstPayment, servicePlanWiring.

Result: **13/13 suites, 245 tests, 44 snapshots, all passed.**

### Code Review Comments

1. `app/api/stripe/webhook/route.ts:1852`, `:1881` (pre-existing, not in this diff) — the hosted-checkout booking branch still logs the raw `session.metadata.booking_id`. A non-UUID value there would also reach the 22P02 error log. The value has been owner-scoped since Fix-1, and Fix-1b does not touch this code. It is a candidate for the CF-5 PR that moves that query, which can reuse `vetLinkId`. Priority: Low (follow-up, not blocking).
2. `lib/payments/bindPlanSubscription.ts:165–174` — an owned id is now the value the repository returned, not the raw string. For an upper-case input, the Stripe schedule `metadata.booking_id` / `service_id` therefore becomes lower-case. The DB `uuid` value is identical, and no legitimate producer sends upper-case: the ids come from Zod `uuid()` input or from DB rows. I accept this as within "no business-logic change". Priority: Info.
3. A transient ownership-read error drops a legitimate link (`read_failed`), consistent with the Fix-1 Q-F1-1 ruling. `subscriptionId` is logged so the plan can be found and repaired. Priority: Info (accepted risk).
4. `docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md`, CF-5 row — the trailing "**Status:** … Fix-1 in progress" is stale: Fix-1 merged as `2a88f0bc`. TL or RM can refresh it at commit. Priority: Low.
5. `connectPath.characterisation.test.ts` F5-1 — the raw-value check covers the injection text and the padded service, but not the `ct-1` contact value. The exact-object `toEqual` on the log lines already proves that no `id` key is logged, so adding it is optional. Priority: Low.

### Pre-merge (not code)

- **C-3 result:** the user runs the query and records the result here. A non-empty result is a stop.
- **QA:** confirm the E-2 rewrite and add `planOwnership.qa.test.ts` (end to end with the real bind), as planned.

### Optimisation Suggestions

- Nothing blocking. If a third caller of `vetLinkId` ever appears, consider having it also return the log fields, so the `idLength`-or-`id` spread is not duplicated. Today it appears twice, which is fine.

### Code Approved for QA: Yes

## QA Testing Report

**QA — 2026-10-07**
**Test mode:** full
**Strategy used:** A + B (Jest; route-level integration through the **real** `bindPlanSubscription` and real repositories, with only the Supabase client and Stripe faked) + a mutation run against the pre-Fix-1b route and bind.
**Focus:** security (tenant isolation), api, regression
**Skipped:** live DB / Stripe (out of scope by instruction); the C-3 SQL (the user runs it)
**Input source:** prompt (TL) + workplan §Tests "QA (QA to add)"

### What was added

**File:** `app/api/stripe/webhook/__tests__/planOwnership.qa.test.ts` (new, 35 tests, no snapshots)

It drives all 3 plan sites through `POST` of the real route: **T** `customer.subscription.created` (trialling), **I** `invoice.paid` (first period, booking modal), **C** `checkout.session.completed` (hosted checkout). Mocked: `@supabase/supabase-js` (`createClient`), `stripe`, `StripeService.constructWebhookEvent` (signature), and a log recorder in place of `@/lib/logger`. Everything else is real: `bindPlanSubscription`, `vetLinkId`, the three `findOwnedId` repositories, `PaymentPlanSubscriptionRepository`, `resolveAccountOwner`, `recordPlanPeriodPaid`, `resolveInvoicePaymentIntent` and `resolveProcessorFee`.

The fake DB is a small stateful PostgREST. It evaluates `eq`/`order`/`limit`, so ownership is modelled by **data** (a foreign row has `user_id = owner-b`), not by scripted answers. It keeps state, so the plan row bind writes is the row `recordPlanPeriodPaid` reads back (the input to the trigger). Where it matters it behaves like a `uuid` column: matching is case-insensitive, storage is canonical lower-case, and a value Postgres would not parse returns `22P02`. The seed includes a **foreign plan on the owner's own service that is older than every owned plan**, so an unscoped fallback would pick it.

### Test Coverage

| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| Own ids kept everywhere, outcome identical to today (T, I, C) | ✅ | Pass | O-T / O-I / O-C: Stripe schedule `metadata`, `payment_plan_subscriptions`, all 3 periods, booking `payment_plan_id`; on I also the period `payment_transactions` row and booking `payment_status: paid`. The C-5 fallback never runs for an owned plan id. **Write-trace diff old vs new: 0 differences** (see below) |
| Only added cost for own ids = 1 user-scoped `maybeSingle` read per link present | ✅ | Pass | O-R-T/I/C (3 reads on T and I; 2 on C, which carries no plan id) |
| Foreign booking / plan dropped everywhere; dropped plan falls back to the owner's oldest active plan, scoped by `user_id`; cap holds | ✅ | Pass | F-T-1, F-I-1: `booking_id`/`contact_id` null everywhere, plan = `OWN_PLAN_OLDEST` (not the older foreign plan on the same service), fallback chain has `eq user_id owner-a` + `eq service_id`. No foreign id in any DB write or Stripe call; victim booking row byte-identical |
| All links foreign | ✅ | Pass | F-T-2 / F-I-2 / F-C-2: all null, no fallback read (a foreign service never selects a plan), no periods, cap holds |
| Checkout foreign booking | ✅ | Pass | F-C-1: bind drops it; the route's own booking branch (Fix-1) updates with `user_id = owner` and matches no row |
| Trigger input (later period payment) never carries a foreign booking | ✅ | Pass | F-TI: trialling bind with foreign links, then `invoice.paid` on the same subscription → `payment_transactions.booking_id = null`, 1 period paid, victim untouched; the second delivery does no link read |
| Malformed id never reaches any log raw, a read or a write | ✅ | Pass | M-T/I/C with a padded own UUID, an SQL-injection string and `plan-not-a-uuid`: 0 ownership reads; `reason: malformed` + `idLength`, no `id` key; raw text absent from every bind write, every Stripe call and every log line. **Exception (pre-existing, SA comment 1):** on C the route's checkout *booking* branch still logs the raw `booking_id`; the test excludes exactly those 3 message texts and asserts bind's logger is clean at all 3 sites |
| Read error → drop with `read_failed`, `subscriptionId` logged | ✅ | Pass | R-T/I/C (all reads fail) and R-1 (booking read only): exact log objects `{subscriptionId, connectAccountId, ownerId, field, reason: 'read_failed', id}`, no `idLength`; event 200; cap holds |
| Redelivery makes no extra reads | ✅ | Pass | D-T/I/C: second delivery (new event id) of a bound + projected plan → 0 link-table reads, 0 fallback reads, 0 `subscriptions.retrieve` / schedule calls, no new periods |
| Edge: upper-case UUIDs (SA comment 2) | ✅ | Pass | X-1: kept, DB values canonical. The trace diff vs old shows the **only** effective difference is the Stripe schedule `metadata.booking_id/service_id` case (upper → lower). The DB payload text differs in case only, which is the same `uuid` value. Matches SA comment 2 (Info) |
| Edge: padded ids | ✅ | Pass | X-2: a padded **own** booking id is dropped as `malformed`, never trimmed; the plan is still recorded with its service and plan and 3 periods. On the old code the plan-row insert fails `22P02` and the plan is **not recorded at all** (see Edge Cases 1) |
| Edge: empty string | ✅ | Pass | X-4-T/I/C (metadata `''`) and X-5 (bind called directly with `''`, no call-site coercion): no read, no drop log |
| Edge: ids absent entirely | ✅ | Pass | X-3-T/I/C: no link-table read, no drop log, schedule metadata `''`; identical to old (trace diff 0) |
| Edge: repair path (bound, not projected) | ✅ | Pass | X-6-T/I (foreign booking + plan → re-projected periods carry neither, plan falls back, no schedule call, drop logs carry `subscriptionId`); X-6-own (own ids projected exactly as before, trace diff 0) |
| Dev's E-2 rewrite and id swaps not weaker (task 2) | ✅ | Pass | See below |
| Regression, guards, CI time | ✅ | Pass | 119 suites / 2231 tests / 44 snapshots green, 54 s wall |

### Mutation run against the pre-Fix-1b code (task 1)

The route and bind from `git show 2a88f0bc:…` were placed in a temp folder inside the worktree (`app/api/stripe/webhook/__qa_old__/`), with a copy of the test that maps `@/lib/payments/bindPlanSubscription` to the old bind. The folder was **deleted afterwards** and `git status` shows no trace of it.

**Old code: 21 failed / 14 passed of 35.**

| Group | Old | Why |
|---|---|---|
| F-* (6), F-TI, M-* (3), R-* (4), X-2, X-6-T, X-6-I | ❌ 17 | The security properties: foreign ids stored (incl. on the period transaction), raw malformed values read + logged (`22P02`) and the plan not recorded, no `read_failed` handling |
| O-R-T/I/C | ❌ 3 | By design: they pin the new ownership reads |
| X-1 | ❌ 1 | Only the Stripe metadata case (SA comment 2) |
| O-T/I/C, D-T/I/C, X-3 ×3, X-4 ×3, X-5, X-6-own | ✅ 14 | Legitimate-caller behaviour, the same on both |

**"Identical to today" proof.** With `QA_PLAN_TRACE` set, 14 scenarios dump a normalised trace (every DB write with its payload, filters and options; every Stripe call with its args; final rows of the plan, period, transaction and booking tables; timestamps scrubbed). Old vs new:

```text
O-T O-I O-C X-3-T X-3-I X-3-C X-4-T X-4-I X-4-C X-6-own   full diff 0 (writes, Stripe args, final state)
D-T D-I D-C                                               this-delivery writes + Stripe diff 0 (prior state differs by design: first delivery had foreign links)
X-1                                                       13 diffs, all upper→lower case of the same uuid; only Stripe metadata is a real change
```

### Task 2: review of Dev's edits to `fix1Ownership.qa.test.ts`

- **E-2: confirmed, stronger.** Before, it pinned the defect the Fix-1 QA flagged: a read with the raw padded value and 3 `read_failed` labels. Now it pins no read on any of the 3 tables, null links in the row, `[field, 'malformed', idLength, undefined]` per link (the lengths 3 / 38 / 17 are correct for `'   '`, the padded UUID and the injection), and no raw text in any log line. Nothing the old version proved about the stored row was removed. Nit (cosmetic, not a bug): the scenario's `UUID_CAST` db answers are now never consumed.
- **H-4, A-11, E-3:** pure constant swaps; every assertion keeps its shape. E-3 still proves the stored value is the repository's id, not the raw upper-case one.
- **A-10:** `/victim/` → `/deadbeef/` matches the new victim constants (all three start with `deadbeef`); equivalent.
- Removed lines across `connectPath.characterisation`, `bindPlanSubscription.test` and `findOwnedId.ownership`: every `-` line is an id swap or the stub-chain rewrite SA reviewed. No assertion was dropped.

### Issues Found

#### Bugs (must fix before commit)

None.

#### Performance Issues (should fix)

None. The redelivery cost is unchanged (D-*). The first bind adds at most 3 indexed `maybeSingle` reads.

#### Edge Cases (nice to fix / for the record)

1. **Malformed link: the outcome changed, for the better (Info).** On the old code a padded or otherwise non-UUID link made the `payment_plan_subscriptions` insert fail with `22P02`. The plan was bounded in Stripe but **not recorded locally**, so it was invisible to the owner. Now the link is dropped and the plan is recorded. This only affects malformed input, which no legitimate producer sends (SA verified Zod `uuid()` and DB-sourced ids), so it is within the scope rule.
2. **A transient `read_failed` on a legitimate plan has lasting effects (Low; accepted risk, SA comment 3).** If the booking read fails, the plan row keeps `booking_id = null` for good. `recordPlanPeriodPaid` then copies null onto every period payment and skips the booking `payment_status: 'paid'` update (route.ts `if (plan.data.booking_id)`), so a deferred-first-payment booking would read `pending`. If the service read also fails, no plan row id resolves and no periods are projected. The repair branch re-projects the periods on the next delivery, but the plan row's links are not re-vetted. The `subscriptionId` in the log is what makes a manual repair possible. Suggest the CF-5 / FU follow-ups name this repair step in the runbook. Not blocking.
3. **Pre-existing raw log (Low; SA comment 1, confirmed by M-C).** The hosted-checkout booking branch (`route.ts` around L1852 and L1881) logs a raw malformed `session.metadata.booking_id`. Fix-1b does not touch it. M-C excludes exactly those message texts, so the gap is visible in the test.
4. **Fixture duplication (cosmetic).** The 3 new plan fixtures Dev added are used by the harness. The QA file builds its events in code, so the foreign/own/malformed variants are explicit per test.

### Regression (task 4)

Command: `node node_modules/jest/bin/jest.js --ci --runTestsByPath <119 files>`. The files are every test in `app/api/stripe/webhook/__tests__`, `lib/payments/__tests__` and `lib/repositories/__tests__` (tracked + new), plus the 6 tests elsewhere that reference the route, bind or `PaymentPlanRepository`: `noBookingGuess.guard`, `onboarding/build route.audit`, `scheduling/bookings/[id]/meetings route`, `payments-plugin-executor`, `BookingLifecycleService.planInvoice`, `packageAcceptance`.

```text
Test Suites: 119 passed, 119 total
Tests:       2231 passed, 2231 total
Snapshots:   44 passed, 44 total
Time:        51.17 s   (wall 54 s)
```

Guards included and green: `pinoLogging`, `routerPlacement`, `receiptOnPaid`, `emptyBody`, `routerEdgeCases`, `noBookingGuess`, `planSurfaces`, `deferredFirstPayment`, `servicePlanWiring`, `paymentTablesWriteLockdownMigration`, `userSubscriptionsWriteLockdown(.qa/Migration)`. `test:bos-entitlements` was not required: no file in the diff imports from `lib/business-os/entitlements/`, and its repository leg (`lib/repositories/__tests__`) is in the run above.

- **Snapshot blob:** `3f2630f704ca6c81c4fbb312d8ea12f0183f8eff` before and after every QA run. No `-u` was used.
- **Scoped `tsc`** on the new file: 0 errors. **ESLint** on the new file: clean.
- **CI-time impact:** the new file takes about 5 s inside one Jest worker (35 tests, each reloading the route via `isolateModules`, the same pattern as `fix1Ownership.qa`). Spread over the existing 3 shards it adds a few seconds of CPU on one shard. No new job, nothing on the `next build` critical path, so it is negligible.

### Final Status
- [x] All acceptance criteria pass — ready for commit (QA side). Still owed before merge, and not QA's: the **C-3 query result** (the user runs it; a non-empty result is a stop)
- [ ] Issues found — Dev must address before commit

**Verdict: PASS WITH NOTES.** There are no bugs. The notes are Edge Cases 1–4 above (Info/Low) and the outstanding C-3 result.

## Commit Info

_(RM to populate)_

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-07 | Created | Dev plan for Fix-1b (F-5) with BEFORE evidence recorded on `fix/webhook-plan-booking-ownership` @ `2a88f0bc` |
| 2026-10-07 | SA review | Approved with conditions C-1 to C-6. Q-1 new helper ✅; Q-2 `malformed`, no trim ✅; Q-3 fallback ✅; Q-4 trigger = tracked follow-up, no migration; Q-5 report-only query (C-3, stop if non-empty); Q-6 fixture id swap ✅, F5 one entry per site |
| 2026-10-07 | Implemented (Dev) | Code complete, uncommitted. C-1 to C-6 addressed: bind vets its 3 links via `vetLinkId` + `findOwnedId` (new `PaymentPlanRepository.findOwnedId`), and `ownedOrNull` adds `malformed` + `idLength`. Snapshot 40 → 44: 34 identical, 6 equal BEFORE after map-back, 4 added. Bind 18 → 28 tests (6 fail on the old code). Regression and guard set 107 suites / 2080 tests green. C-3 query written (not run). Follow-ups FU-6 (trigger) and FU-7 (bind inline queries → CF-5 PR 4) recorded |
| 2026-10-07 | SA code review | ✅ Code approved for QA. C-1 to C-6 met. SA re-did the map-back independently (md5, vm-parsed): 34 identical, 6 map back, 4 added, 0 changed. 13 suites / 245 tests / 44 snapshots green. The E-2 rewrite is stronger, not weaker. 5 comments, all Low or Info and none blocking. Owed before merge: the C-3 result (user) and QA's review of E-2 plus `planOwnership.qa` |
| 2026-10-07 | QA | **PASS WITH NOTES**, no bugs. New `planOwnership.qa.test.ts` (35 tests) drives the 3 plan sites through the real route and real bind, faking only Supabase (a stateful fake with uuid semantics) and Stripe. On the pre-Fix-1b code, 21 of 35 fail. The legitimate-caller write-trace diff old vs new is 0. E-2 rewrite confirmed stronger; the id swaps are equivalent. Regression: 119 suites / 2231 tests / 44 snapshots green in 54 s; snapshot blob unchanged (`3f2630f7…`). Notes: malformed links now record the plan (before, the insert failed); `read_failed` on a legitimate plan leaves its links null for good (accepted, SA 3); the pre-existing raw log in the checkout booking branch (SA 1). C-3 result still owed by the user |
