# Stripe Connect `charge.refunded` Webhook Records No Refunds — RCA

> **Last Updated**: 2026-10-14

## Overview

The Stripe webhook's Connect refund handler (`handleChargeRefunded`) has never written a refund row. It loops over `charge.refunds.data`, a list that Stripe has not included on the Charge object since API version `2022-11-15`. A webhook payload cannot ask Stripe to include it. The loop therefore runs zero times, and the event is marked `completed` with nothing written. Today only refunds made through the app's own refund route reach the books. Refunds made in the Stripe dashboard, made by Stripe itself, or whose response the app lost are never recorded. This was diagnosed read-only on 2026-10-14 against `main` @ `3b300f58` and the live DB. **No code was changed.**

Origin: suspicion raised in `docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REFUND_TIMING_SCOPING.md` (branch `feature/bos-finance-health-4`).

---

## 1. The defect

**File:** `app/api/stripe/webhook/route.ts` (ref `3b300f58`)

| Line | What |
|---|---|
| 494 | `handleChargeRefunded(charge, connectAccountId, log)` |
| 518 | `for (const stripeRefund of charge.refunds?.data ?? [])` — always empty |
| 536 | `paymentRefundRepository.upsertFromStripe(...)`, upserted on `processor_refund_id`; never reached |
| 2484 | `case 'charge.refunded'` dispatches it (Connect and non-billing platform events) |

**API version**

| Item | Value |
|---|---|
| SDK | `stripe@19.2.1`, defaults to `2025-10-29.clover` |
| `lib/stripe/StripeService.ts` | pins `2025-10-29.clover` |
| SDK type `Charge.refunds` | `ApiList<Refund> \| null` (optional) |
| Webhook endpoint `api_version` | **Not determined.** The `.env.local` `STRIPE_SECRET_KEY` is a test key for an account that is not the Connect platform. It has no webhook endpoints and cannot act on connected accounts. Any version from 2022-11-15 on omits the list. |

Stripe changelog: [Charges no longer auto-expand refunds (2022-11-15)](https://docs.stripe.com/changelog/2022-11-15/deprecates-charges-auto-expand).

**Why tests pass:** the fixture `app/api/stripe/webhook/__tests__/fixtures/connect/charge-refunded.json` is hand-written. It declares `api_version: 2025-10-29.clover` but includes a `refunds.data` list Stripe never sends at that version. Characterisation test 7a passes against a payload that cannot happen.

---

## 2. Live evidence (read-only, prod DB, 2026-10-14)

| Fact | Value |
|---|---|
| `payment_refunds` rows | 42 — **all `source='app'`, `status='succeeded'`**; none with `metadata.origin='charge.refunded'` |
| Rows written by the webhook (`source='webhook'`) | **0** |
| Stripe refunds made through the app (`re_…`, connected account set) | 31 |
| Manual refunds (no processor id, no connected account) | 11 |
| `charge.refunded` events in `processed_webhook_events` | 36, all `completed`, all `livemode=false` |
| App Stripe refunds paired 1:1 with a `charge.refunded` event 1.4–19 s later | **31 of 31** |
| `charge.refunded` events matching no refund row | **5** — 2026-09-03 05:00, 16:07, 16:51; 2026-09-04 14:53; 2026-09-28 17:27 (UTC) |
| `refund.created` / `refund.updated` / `charge.refund.updated` events received (unhandled) | 30 / 24 / 24 |
| Payments with a refunded amount but no refund row | 0 |

**Why the 31 pairs prove it:**
- Each paired payment has a `stripe_payment_intent_id`, so the handler's lookup would have found it.
- An upsert on `processor_refund_id` would have changed the row's `source` to `webhook` and its `metadata` to `origin: charge.refunded`. None changed.
- The loop was therefore empty on every delivery.

**The 5 unmatched events:**
- They are not boost refunds: `business_os_boost_purchases` and `boost_pack_purchases` show no refund near those dates.
- No payment has `refunded_at` near them except two manual refunds on 2026-09-28.
- They are most likely Stripe-dashboard refunds, or refunds from before the ledger existed, that never reached the books.
- They cannot be tied to payments from the DB: `processed_webhook_events.metadata` stores only `created` and `livemode`, not the payload. The Connect platform's Stripe dashboard (test mode) can resolve them.

**Live mode:** no live-mode refund is affected yet. All events are test mode.

---

## 3. Impact

| Area | Effect |
|---|---|
| Business records | A refund made outside the app is invisible. `payment_transactions.refund_status` / `refunded_amount` (derived by trigger from `payment_refunds`) stay `none` / `0`, and the booking is not updated. |
| Double-refund guard | The app's refund route would allow refunding the "remaining" amount again, because the ledger shows nothing refunded. |
| Admin Finance page, client takings (slice 2a) | `BusinessOsFinanceReadRepository` R-f / R-f′ read `payment_refunds` by `created_at`, so takings net of refunds are **overstated** by every refund the app didn't make. It is silent: the event reads `completed`. |
| Refund state changes | A refund recorded as `pending` is never moved to `succeeded` or `failed`. `charge.refunded` could not do this even with the list present. |

---

## 4. Recommended fix

**Primary: handle `refund.created`, `refund.updated` and `refund.failed`.**
- These events already arrive at the endpoint and are currently dropped.
- The Refund object carries `id`, `amount`, `currency`, `status`, `charge` and `payment_intent`, so there is no extra Stripe call and no per-account credentials.
- It also covers pending → succeeded/failed changes.
- `charge.refunded` becomes a no-op (or a trigger for a re-sync).

**Alternative:** in `handleChargeRefunded`, list the refunds through the API (`refunds.list({ charge })`) on the right account, reusing `resolveRefundAccount` / `stripeRequestOptions`. This adds a network call and credential resolution inside the webhook, so it ranks second.

**Requirements on the fix**

| # | Requirement |
|---|---|
| F1 | **Race with the app's own write.** `RefundService` inserts its row with `processor_refund_id = null` and fills it in only after Stripe replies (observed gap about 1–2 s; events arrived 1.4 s or more after row creation). A `refund.*` event arriving first would insert a duplicate `webhook` row. Send the app's refund row id in the Stripe refund's `metadata` and match on it before upserting on `processor_refund_id`. |
| F2 | Map `failed` and `canceled` to their own statuses. Today anything that isn't `succeeded` becomes `pending`. |
| F3 | Tenant check (`tenant-isolation-guard`): the matched payment's `stripe_connect_account_id` must equal `event.account`. The current handler does not check this (FU-3). |
| F4 | Platform `refund.*` events pass through `dispatchBusinessOsEvent` first; they must be denied or ignored there, not routed to a billing flow. Connect events must still bypass the billing router. |
| F5 | Replace the impossible 7a fixture with a real `2025-10-29.clover` payload (no `refunds`), and add `refund.*` fixtures. |

**Guards touched**

| Guard | Why |
|---|---|
| `app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts` | New `refund.*` cases and how they interact with the billing router's placement |
| `app/api/stripe/webhook/__tests__/connectPath.characterisation.test.ts` + snapshots | Fixture correction, new cases |
| `lib/repositories/__tests__/paymentTablesWriteLockdownMigration.test.ts` | `payment_refunds` stays server-write-only; the webhook writes as the service role via `paymentRefundRepository`, so no migration is expected |
| `lib/repositories/__tests__/PaymentRefundRepository.test.ts` | `origin` type widens beyond `'charge.refunded'` |

**After deploy:** decide whether to reconcile the 5 unmatched test-mode events. Test data only.

---

## 5. Seen in passing (out of scope)

| Item | Where |
|---|---|
| A Stripe refund still `pending` is recorded as `succeeded` | `lib/payments/RefundService.ts` ~1087 |
| Direct `supabaseServer` write inside a service (CLAUDE.md rule 1) | `lib/payments/RefundService.ts` ~1087 |
| The local `STRIPE_SECRET_KEY` is not the Connect platform's key, so diagnostic scripts cannot see connected accounts | `.env.local` (main checkout) |

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-14 | Created | Read-only RCA: webhook path writes zero refunds; 31/31 app refunds paired with ignored events; 5 unmatched test-mode events; fix = `refund.*` events |
