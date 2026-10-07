# Workplan: FU-5, a webhook owner-lookup failure is retried, not cached and lost

> **Last Updated**: 2026-10-07

**Developer:** Dev
**Requirement:** [BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md) §9.4 CF-5 sequence; origin: [Fix-1 workplan](/docs/workplans/BUSINESS_OS_WEBHOOK_CONNECT_FIX1_WORKPLAN.md) FU-5, SA comment 3, QA note N-3
**Branch:** `fix/webhook-owner-cache-retry` (planned on 7ffe5162; implemented on `main` 0f3dd447, which includes Fix-1 #242 and Fix-1b #246)
**Date:** 2026-10-07
**Status:** Code Complete (uncommitted; SA code review next). Implementation record: §8

## Overview

An infra (reliability) fix with no business-logic change. Today, on a Connect event, a transient database error in the account-owner lookup reads as "this account belongs to no business". That answer is cached for the life of the warm instance. Every ownership check then refuses with 200 and completes the claim, so Stripe never retries and the event is lost without a trace. After this fix, a lookup error throws. The webhook's existing catch releases the claim and returns 500, and Stripe retries. A truly unmapped account still refuses with 200, as today. The cache is cleared at the start of every request and never holds `null` or an error. Under concurrent requests on one instance, a positive owner found by one request may be read by an overlapping one (SA C-2).

---

## 1. Analysis summary

| Item | Where (base 7ffe5162) | Today |
|---|---|---|
| Cache | `app/api/stripe/webhook/route.ts:1116-1122` | `const accountOwnerCache = new Map<string, string \| null>()` at module level. The comment says "Cached per invocation", which is false: it survives warm invocations |
| `accountOwns` | `route.ts:1124-1132` | `false` for a missing owner id (before touching the cache), otherwise `accountOwner(...) === ownerId` |
| `accountOwner` | `route.ts:1134-1160` | Fills the cache with `resolveAccountOwner(...)`, caching `null` too. A warning on null |
| Resolver | `lib/payments/stripeAccountContext.ts:430-457` | Reads `stripe_connect_accounts` (`:434-438`, `.maybeSingle()`), then all stripe `plugin_connections` (`:445-448`). **Both `error`s are ignored**, so an error reads as "no row" and the function returns `null` |
| Claim / 500 path (reused, not changed) | `route.ts:2260` `processedEventId`, `:2607-2647` catch | Any throw from a handler: claim row → `status: 'failed'` + `failure_message`, response 500 → Stripe retries, and the next delivery reclaims the `failed` row (`:2349`). This is harness entry **10** and entry **9c** |

### Every owner-check site: all refuse today on `null`, all throw after the fix

Each site goes through `accountOwns` or `accountOwner`, so one change covers all of them. None sits in a `try` that swallows errors:

| Line | Handler | Event |
|---|---|---|
| `:676` | `handleConnectPaymentIntentSucceeded` | `payment_intent.succeeded` |
| `:802` | `recordPlanPeriodPaid` | `invoice.paid`, plan period |
| `:1077` | `handleConnectPlanSubscriptionCreated` | trialling plan (outside the `:1087` try) |
| `:1206`, `:1303`, `:1324` | `handleConnectInvoicePaid` | `invoice.paid`: plan bind (outside the `:1207` try), metadata path, H1 path |
| `:1662`, `:1710`, `:1850` | `handleConnectCheckoutCompleted` | plan checkout, invoice, booking (the unmapped-account refusal) |
| `:1911`, `:1937` | `handleConnectInvoicePaymentFailed` | `invoice.payment_failed` |
| `:2030` | `handleConnectInvoiceFinalized` | `invoice.finalized` |
| `:2080` | `handleConnectInvoiceUncollectible` | `invoice.marked_uncollectible` |
| `:2144` | `handlePlanSubscriptionEnded` | Connect `customer.subscription.deleted` |

`:1662` is inside the plan-checkout `try` (`:1657`), whose catch logs *"Could not bound a payment plan - subscription may bill indefinitely"* and **rethrows** (`:1683-1690`). A lookup error there still produces 500 and a released claim, but the log line is misleading. See Q-3.

### Who calls `resolveAccountOwner`

Only `route.ts:1145`, found with a repo-wide grep over `app/`, `lib/`, `scripts/` and `tests/`. Test doubles:
- `connectPath.characterisation.test.ts:171` and `fix1Ownership.qa.test.ts:94` stub it.
- `routerEdgeCases.qa.test.ts:96` stubs it as `() => 'owner-a'`.
- `lib/payments/__tests__/stripeAccountContext.test.ts:228-288` tests the real resolver (5 cases).
- After #246, `planOwnership.qa.test.ts` uses the **real** resolver against its mock DB, which never fails a `stripe_connect_accounts` / `plugin_connections` read (`failOwnershipReadOn` only covers `select('id')` on the link tables).

So no other production behaviour changes. The 5 existing resolver tests are unchanged: their fake returns no `error` key.

### CLAUDE.md rule 1

Yes, `resolveAccountOwner` (and `resolveUserConnectAccounts`) query Supabase directly outside `lib/repositories/`. **Not fixed in FU-5.** FU-5 touches only the two `error` checks.

*Corrected per SA C-5.* An earlier version of this paragraph said `StripeConnectRepository` does not exist. That was wrong: it exists at `lib/repositories/PaymentRepository.ts:1498`, with singleton `stripeConnectRepository` at `:1623`. `PluginConnectionRepository` already owns `plugin_connections`.

SA ruled that the move goes into **CF-5 PR 5**, superseding CF-5 Q-2's "tracked follow-up":
- **Methods:** one new method on each existing repository. `StripeConnectRepository.findOwnerIdByStripeAccountId` and a `PluginConnectionRepository` list-by-plugin-key method.
- **No status filter**, and `findActiveByProfileData` is not reused, because it filters `active` and so would change which accounts map to a business.
- **Signature kept:** `resolveAccountOwner(db, stripeAccountId)` stays as it is, and a repository `error` becomes the FU-5 throw.

`resolveUserConnectAccounts` and `resolvePaymentCollectionCapability` stay with the purge workplan's T29 item (3).

---

## 2. Exact changes

### 2.1 `lib/payments/stripeAccountContext.ts` (resolver, `:430-457`)

- After the `stripe_connect_accounts` read (`:434-438`): if `direct.error`, throw `new Error('Account owner lookup failed on stripe_connect_accounts: <code>')`, with `cause: direct.error`. The message carries the PostgREST code only, no row data. It lands in the claim row's `failure_message` and the log.
- After the `plugin_connections` read (`:445-448`): the same check on `viaPlugin.error`.
- The JSDoc gains: "throws on a read error, so a caller can never confuse a failed read with 'no business'; `null` means both reads succeeded and neither named this account."
- Unchanged: lookup order, the short-circuit on an express hit (so a plugin read error after an express hit cannot throw), and matching.

`stripe_account_id` is `UNIQUE` (`supabase/migrations/20260722_create_payment_tables.sql:194`), so `.maybeSingle()` cannot error on a multi-row match. That will be checked against the live schema at implementation (`business-os-schema-check`), because a real duplicate would now be retried rather than refused.

### 2.2 `app/api/stripe/webhook/route.ts`

| Line | Change |
|---|---|
| `:1116-1121` | Comment rewritten. The cache lives for one request: it is cleared at the start of every `POST`, never holds `null`, and never holds an error (a lookup error throws through to `POST`'s catch) |
| `:1122` | `new Map<string, string>()`: the `null` member is removed from the type |
| `:1142-1149` | The cache gets filled only with a non-null owner: `const cached = accountOwnerCache.get(id); const owner = cached ?? await resolveAccountOwner(...); if (owner) accountOwnerCache.set(id, owner);`. The `null` warning (`:1151-1157`) is unchanged |
| `:1136-1139` | JSDoc: "a lookup error throws, see `POST`'s catch" |
| `POST`, after `:2260` | One statement: `accountOwnerCache.clear();` and a comment explaining why. This is a `Map` method, not a `handle*` call, so the pino guard's "passes `log` to every handler" rule does not apply |

No new failure path. The throw reaches the existing catch (`:2607`): the claim goes to `failed`, the response is 500, and Stripe retries.

**On concurrency** (Vercel Fluid can run overlapping requests in one instance): a `clear()` from request R2 only costs request R1 a repeat lookup. A positive entry R1 stored can serve R2, but it is at most one overlapping request old. A `null` is never shared, because it is never stored. This addresses the case FU-5 is about: a newly connected account whose row lands a moment later.

---

## 3. Failure modes

| Owner lookup result | Today (7ffe5162) | After FU-5 |
|---|---|---|
| **DB error** (either table) | Read as `null` → refusal logged → **200, claim `completed`**. The `null` is cached for the instance's life, so later events from that account are refused too, even once the DB recovers. Stripe never retries, so the event is lost | **Throw → 500, claim `failed`** (`failure_message` = table + code). Nothing is cached. Stripe retries, and the next delivery reclaims the `failed` row and does a fresh lookup |
| **Account truly unmapped** (both reads OK, no match) | `null` → warn + refusal → 200, `completed`. Cached for the instance's life | **Unchanged on this request: 200, `completed`, nothing written.** Not cached, so the next event (next request) looks again |
| **Mapped** | Owner → normal handling. Cached for the instance's life | Unchanged result. Cached for this request only, so a second check in the same request is still one lookup |

**Why a truly unmapped account still refuses with 200.** This is the Fix-1 policy (*refusals keep today's policy: log, 200, event completed*, SA-approved), and it is a business decision, which this infra fix does not reopen. A signed event from an account that maps to no business is not something a retry can fix: the same answer would come back for three days of retries. Only a *failed read* is transient, and only that case changes.

---

## 4. Tests

### 4.1 Unit, `lib/payments/__tests__/stripeAccountContext.test.ts` (`describe('resolveAccountOwner')`)

The `ownerDb` fake gains optional `expressError` / `pluginError`. Four new cases:
1. An express read error throws, and the plugin table is never read.
2. Express miss, then a plugin read error, throws.
3. An express hit returns the owner even when the plugin read *would* error (no plugin read).
4. The thrown message carries the code and no account data.

The 5 existing cases stay unchanged.

### 4.2 Characterisation harness, `connectPath.characterisation.test.ts`

The `Scenario` gains `ownerLookupFails?: string[]`, and the stub rejects for those accounts. **One new entry:**
- **FU5-1.** `invoice.finalized`, owner lookup fails → 500, claim `failed`, no `payment_invoices` write.

It is shaped like entry 10. None of the 40 existing scenarios sets the new field.

### 4.3 QA, `fix1Ownership.qa.test.ts`

The stub gains a per-account rejection (`ownerErrors`).

| Id | Scenario | Expect |
|---|---|---|
| FU5-E (`it.each`) | Lookup error on each site: `invoice.paid` (metadata and H1), `payment_failed`, `finalized`, `marked_uncollectible`, checkout booking (unmapped branch), `payment_intent.succeeded`, plan sites T / I / C (fixtures from #246, after the rebase), Connect `subscription.deleted` | 500. The last `processed_webhook_events` update is `status: 'failed'`. No write to victim or plan tables |
| FU5-R | Warm instance (`loadRoute()` once): delivery 1 errors → 500. Delivery 2 has the **same event id**, the claim select returns `failed`, and the lookup now succeeds | 2nd: one fresh `resolveAccountOwner` effect (no poisoning), row written, claim `completed`, 200 |
| FU5-U | A truly unmapped account (`owners: {}`) | 200, `completed`, nothing written, refusal logged. The same as today (A-5 / A-12 stay as they are) |
| FU5-Q | One request that checks the same mapped account twice (`invoice.paid` plan period: `:1206` then `:802`) | Exactly one lookup. The per-request cache still dedupes |
| **C-2 (QA note N-3) flipped** | Today's test pins "the cached null keeps refusing" | It becomes *"FU-5: a null is not cached; once the account maps, the next event is written"*. The second post has `ownerLookups` = `[acct_owner_a]` and the `payment_invoices` update is present, claim `completed` |
| **C-1 third post** | Today it asserts "served from the cache (no lookup)" | It becomes one lookup for `acct_owner_a`, still scoped to `owner-a`. The cache is now per request. This is the only other existing assertion that changes |

### 4.4 Snapshot proof

**Before (recorded 2026-10-07 on 7ffe5162, untouched tree):**

- `connectPath.characterisation.test.ts.snap`:
  - blob `09a244f2fd16b0b705c0fac00fdecc85a6438fde`
  - sha256 `f403f7e0…01165`
  - 5,408 lines, 122,195 bytes
  - 40 `exports[...]` entries
- A run of the 12 affected suites: **12/12 suites, 217/217 tests, 40/40 snapshots, 30.7 s**.
- Blobs:
  - `route.ts` `256e2add`
  - `stripeAccountContext.ts` `aad9fe8b`
  - harness `483b0ed3`
  - `fix1Ownership.qa.test.ts` `8c871c73`
  - `stripeAccountContext.test.ts` `9fed11db`
- Per-entry hashes (`scratchpad/snap-entry-hashes.js`), saved as `scratchpad/fu5-before-entry-hashes.txt`, snapshot copy `scratchpad/fu5-before.snap`:

```text
8022d8bed1ab 1a   891fc73d2c34 1b   22a9b97e5d2c 2    277fcb96150f 3
2a91ff767596 4a   022f817dd48f 4b   ab52b3e61f5e 5a   07068b0d08c1 5b
f68b79bedad5 6a   126b507e3330 6b   f749503e9dcf 6c   62dd8b061797 7a
bbd25008c830 7b   b355f36a18d7 8    62b79e0594d7 9a   62b79e0594d7 9b
5d518155de6a 9c   834f1992f0e8 10   df0234e124a1 11
62df7c538cdc F1-1 62df7c538cdc F1-2 fd8282035f5c F1-3 c89704adbcd8 F1-4
9047aec38b03 F1-5 4f0c1147c8ec F2-1 b448ea609500 F2-2 1e7fc1b337cc F4-1
53783aef611f F4-2 88030947deee F4-3 1e7fc1b337cc F4-4 d9d2555c77d9 F4-5
9f31fb9e98f6 P10-1 be522a658937 P10-2 13d044eb4647 P1 0b13c275dff4 P2
1306164051ae P3   1dcd2e039d06 P4   89f1db3bc3c1 P5   74d4c5a2a95e P6
4a8d036b2e3a P7
```

The script prints F1-3's name truncated, because of the apostrophe. Equal pairs are expected: 9a=9b, F1-1=F1-2, F4-1=F4-4.

**Expected after:** **+1 new entry (FU5-1). 0 changed, 0 removed.** All 40 existing entries must stay byte-identical. Why:
- every scenario re-imports the route (`jest.isolateModules`), so the cache always starts empty;
- no scenario makes the stub fail;
- every entry records at most **one** `resolveAccountOwner` effect today, so a request never asks for the same account twice. Not caching `null` therefore adds no effect.

If any existing hash moves, that is a stop and goes back to SA, not a `-u`. The new entry is written by one run without `--ci`, then re-run with `--ci`, then compared entry by entry.

**After the rebase onto #246:** #246 changes entries 5a / 10 / F4-x and adds 4. The "before" is re-recorded on post-#246 `main` with the same script, and the same rule applies: +1 (FU5-1), everything else identical.

### 4.5 Guard tests affected

| Guard | Effect |
|---|---|
| `pinoLogging.guard.test.ts` | `clear()` is not a `handle*` call. The log-call floor (≥133) is unaffected: no log call is removed |
| `routerPlacement.guard.test.ts`, `emptyBody.guard.test.ts`, `receiptOnPaid.guard.test.ts`, `noBookingGuess.guard.test.ts` | Text they pin is not touched |
| `deferredFirstPayment.guard.test.ts:271` | Pins `await accountOwns(connectAccountId, planMeta.owner_id` in the trial handler. Unchanged |
| `planSurfaces.guard.test.ts`, `userSubscriptionsWriteLockdown.qa.test.ts` | They read `route.ts` for other text. Unchanged (`supabaseAdmin` is still passed to the resolver) |
| `routerEdgeCases.qa.test.ts` | Stub returns `'owner-a'`. Unchanged |

All of these are re-run. No guard is added (see Q-4).

### 4.6 CI time

There is no new job or suite. About 10 new tests go into 3 existing suites. They are mocked and in-memory, a few ms each, well under 1 s in total, inside the existing Jest shards. That stays within the `next build` critical path (`feedback-no-added-ci-time`).

---

## 5. Files to create / modify

| File | Action | Reason |
|---|---|---|
| `lib/payments/stripeAccountContext.ts` | modify | Throw on a read error (`:430-457`) |
| `app/api/stripe/webhook/route.ts` | modify | Per-request cache, no `null`, honest comment (`:1116-1160`, `POST` after `:2260`) |
| `lib/payments/__tests__/stripeAccountContext.test.ts` | modify | 4 resolver cases |
| `app/api/stripe/webhook/__tests__/connectPath.characterisation.test.ts` + `.snap` | modify | `ownerLookupFails`, FU5-1 (+1 entry) |
| `app/api/stripe/webhook/__tests__/fix1Ownership.qa.test.ts` | modify | FU5-E/R/U/Q; C-2 flipped; C-1 third post |
| `docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md` | — | **TL's edit in the working tree; Dev does not touch it** |

## 6. Task list

- [x] ✅ Step 0: #246 merged (0f3dd447); the branch was fast-forwarded by the coordinator. "Before" re-recorded on 0f3dd447 (§8.2)
- [x] ✅ Step 1: Resolver throw + unit tests (5 added: the 4 planned plus "an error with no code still throws")
- [x] ✅ Step 2: Route cache change + `clear()` in `POST`
- [x] ✅ Step 3: Harness `ownerLookupFails` + FU5-1. Entry-by-entry proof: +1, 0 changed (§8.2)
- [x] ✅ Step 4: QA FU5-E (all 14 sites) / R / U / Q; C-2 flipped, C-1 updated
- [x] ✅ Step 5: Regression set (51 suites), scoped `tsc`, `eslint`, `git diff --numstat` (§8.3)
- [x] ✅ Step 6 (SA Q-5, coordinator): CF-5 workplan §11 sequence `→ FU-5`, PR 5 rule-1 scope, PR 1 claim-release note, Change History row

## 7. Open questions for SA

| # | Question | Dev recommendation |
|---|---|---|
| Q-1 | Per-request scope: `accountOwnerCache.clear()` at the top of `POST` (module Map), or a Map created in `POST` and passed down? Passing it down means a signature change on ~10 handlers plus `accountOwns`, and AsyncLocalStorage would be a new pattern | `clear()`. It is one line, and under concurrency it is only stale by one overlapping request, for positive owners only |
| Q-2 | A persistent DB fault now retries for Stripe's ~3 days and then shows as failed in the Stripe dashboard, instead of completing silently. Acceptable, given that recovery after Stripe gives up is a manual replay? | Yes. That is the point of FU-5 |
| Q-3 | `:1662` sits inside the plan-checkout `try`, so a lookup error is logged as *"Could not bound a payment plan…"* before rethrowing. The outcome is correct (500, released claim) but the log line is misleading. Leave it, or hoist the `accountOwns` call above the `try`? | Leave it in FU-5 (no reshaping). Note it for CF-5 PR 4, which moves that handler anyway |
| Q-4 | Add a source guard that `resolveAccountOwner` checks `.error` on both reads? | No. The unit tests pin the behaviour |
| Q-5 | Sequencing: FU-5 lands after #246 and before CF-5 PR 0. PR 0's "before" then has the FU-5 entry. The CF-5 workplan §11 sequence line needs `→ FU-5`. TL edits that doc, or Dev in this PR? | TL, together with the requirement row |

---

## 8. Implementation record (Dev, 2026-10-07, on 0f3dd447)

### 8.1 C-1: owner-check sites re-checked after the rebase

`grep -n "accountOwns(\|accountOwner(" route.ts` on 0f3dd447 finds **14 call sites, the same 14**, each shifted +7 by #246:

`683, 809, 1084, 1213, 1310, 1331, 1669, 1717, 1857, 1918, 1944, 2037, 2087, 2151`

`try` blocks found: `133, 296, 1094, 1214, 1551, 1587, 1664, 2269, 2324, 2624`.

- `:1084` is before the `:1094` try.
- `:1213` is outside the `:1214` try.
- `:1669` is inside the `:1664` try, whose catch (`:1690`) logs and **rethrows**.
- The other 11 sites are in no `try`.

There is no new site and no swallowing `try`. FU5-E covers all 14, including `:1669`, where it asserts 500 and claim `failed`. A separate case pins that the throw passes through that catch and gets its log line, left as is per SA Q-3.

### 8.2 C-4: snapshot proof

**Before**, recorded on 0f3dd447 with the tree untouched, before any edit:
- `connectPath.characterisation.test.ts.snap`:
  - blob `3f2630f704ca6c81c4fbb312d8ea12f0183f8eff`
  - sha256 `6731c979…b547e`
  - 5,913 lines, 135,366 bytes
  - **44 entries**
- Regression set: **51/51 suites, 807/807 tests, 44/44 snapshots**.
- Per-entry hashes saved to `scratchpad/fu5-before-0f3d-entry-hashes.txt`, snapshot copy at `scratchpad/fu5-before-0f3d.snap`.

**After code only** (route + resolver, before any test edit): all **44/44 snapshots passed under `--ci`**, and the blob was still `3f2630f7`. Only the two expected QA assertions failed, C-1 (third post) and C-2.

**After:**
- The FU5-1 entry was written by one run without `--ci`, anchored with `-t '^Stripe webhook, FU-5: owner lookup failure FU5-1\. '`. Every later run used `--ci`.
- New snapshot blob `5cc8789c09b887bef4181acd281e1153ae457861`, sha256 `a3c7da0c…7337`, 45 entries.
- The snapshot diff is **98 inserted lines, 0 deleted**.
- An entry-by-entry `diff` of the before and after hash lists is a single `>` line:

```text
c22c47004565  FU5-1. invoice.finalized whose owner lookup fails: 500, claim released to failed, no invoice write
```

**+1 new, 0 changed, 0 removed.** The 44 existing hashes are identical:

```text
8022d8bed1ab 1a   891fc73d2c34 1b   22a9b97e5d2c 2    277fcb96150f 3
2a91ff767596 4a   022f817dd48f 4b   47e5165aceee 5a   07068b0d08c1 5b
f68b79bedad5 6a   126b507e3330 6b   f749503e9dcf 6c   62dd8b061797 7a
bbd25008c830 7b   b355f36a18d7 8    62b79e0594d7 9a   62b79e0594d7 9b
5d518155de6a 9c   7ddafd030af4 10   df0234e124a1 11
62df7c538cdc F1-1 62df7c538cdc F1-2 fd8282035f5c F1-3 c89704adbcd8 F1-4
9047aec38b03 F1-5 4f0c1147c8ec F2-1 b448ea609500 F2-2 662192201bef F4-1
5cefd75f4a3d F4-2 87c2bad23954 F4-3 662192201bef F4-4 d9d2555c77d9 F4-5
e3915047787b F5-1 6d9a9e33bba1 F5-2 f9f16a886d40 F5-3 9a688fafea7a F5-4
9f31fb9e98f6 P10-1 be522a658937 P10-2 13d044eb4647 P1 0b13c275dff4 P2
1306164051ae P3   1dcd2e039d06 P4   89f1db3bc3c1 P5   74d4c5a2a95e P6
4a8d036b2e3a P7
```

Notes on the lists:
- "F5-x" are Fix-1b's entries; "FU5-1" is this change's.
- The script prints F1-3's name cut short because of the apostrophe.
- Equal pairs are expected: 9a=9b, F1-1=F1-2, F4-1=F4-4.

FU5-1 records:
- the claim select and insert;
- the K1 `payment_invoices` select;
- one `resolveAccountOwner`;
- the claim update `{ status: 'failed', failure_message: 'Account owner lookup failed on stripe_connect_accounts (code XX000)' }`;
- status 500 with body `{ success: false, error: 'Webhook processing failed' }`.

It has no `payment_invoices` write.

### 8.3 Verification

| Check | Result |
|---|---|
| Regression set (`--ci --runTestsByPath`): every test file in `app/api/stripe/webhook/__tests__/` (incl. `planOwnership.qa`, all guards), `lib/payments/__tests__/` (incl. `stripeAccountContext.test.ts`), `app/api/stripe/__tests__/noBookingGuess.guard`, `lib/repositories/__tests__/userSubscriptionsWriteLockdown.qa` | **51/51 suites, 832/832 tests, 45/45 snapshots** (before: 807, 44). +25 = 5 resolver + 1 harness + 19 QA. No test needed `-u`, and none was obsolete |
| Guards (`pinoLogging`, `routerPlacement`, `emptyBody`, `receiptOnPaid`, `noBookingGuess`, `deferredFirstPayment`, `planSurfaces`, `userSubscriptionsWriteLockdown`) | All pass unchanged |
| Scoped `tsc` (the 5 changed `.ts` files) | **0 errors on any changed line.** 3 errors in changed files are on unchanged, pre-existing lines: `fix1Ownership.qa.test.ts:586` (old `:578`, `withMetadata` arg type) and `stripeAccountContext.test.ts:435/445` (`resolveUserConnectAccounts` fakes). The other 64 are in transitive files outside this change. ts-jest does not type-check here |
| `eslint` (5 changed files) | 0 errors. 8 warnings, all on pre-existing lines (unused imports, `any`s, the resolver's existing `AccountLookupDb` disable directive) |
| `console.*` in touched files | 0 |

### 8.4 Deviations from the plan

1. **Unit tests: 5, not 4.** The extra case pins that an error with no `code` still throws (`code unknown`) and never returns `null`.
2. **No `cause` on the thrown error.** SA C-3 allowed one. It is left off so nothing beyond the table and the code can reach a serializer. The `{ err }` log line in `POST`'s catch still carries the message.
3. **QA harness mock gains `planBySubscription`.** It is needed to reach the two plan sites that read through the mocked `findBySubscriptionId` (`:809`, `:1918`). The default is unchanged (`{ data: null, error: null }`), and every existing QA test passes unchanged except C-1 and C-2, as planned.
4. **Each FU5-E case runs a control first:** the same data with a foreign (or absent) owner, which must log that site's own refusal (or, for `:1918`, "Plan marked past_due"). That proves the error case reached the site it names. `:1310` and `:1331` share a refusal message and are told apart by their DB answers (metadata fallback vs. H1 hit).
5. **Layering of the proof.** The route-level tests (harness + QA) stub the resolver to reject. They prove the route turns a rejection into 500 and `failed`, caches no `null`, and looks up again per request. That the real resolver rejects on a read error is proved by the unit tests. The two together are the fix.
6. **Docs.** The CF-5 workplan §11 / PR 5 / PR 1 / Change History edits were made by Dev (coordinator instruction, SA Q-5), not TL. TL's requirement-doc working-tree edit was not touched.

---

## SA Review Notes

**Reviewed by SA — 2026-10-07**
**Status:** ✅ Approved with conditions (C-1 to C-5)

Verified read-only on `7ffe5162` (worktree `neuronforge-webhook-repos`, tree clean apart from this file and TL's requirement edit), and against the PR #246 diff (`gh pr diff 246`).

### Verification against the tree

| Claim | Result |
|---|---|
| Resolver's two reads ignore `error` | ✅ `stripeAccountContext.ts:434-438` (`stripe_connect_accounts`, `.maybeSingle()`) and `:445-448` (`plugin_connections`, `plugin_key = 'stripe'`). Neither destructures nor checks `error`; an error reads as "no row", so the function returns `null`. Throwing on each is the right, minimal fix. The short-circuit on an express hit is kept |
| Module-level cache caches `null` | ✅ `route.ts:1122` `Map<string, string \| null>`; `:1142-1147` stores the resolver's result unconditionally, including `null`. The "per invocation" comment is false |
| 14 owner-check sites | ✅ Exactly 14 call lines: `676, 802, 1077, 1206, 1303, 1324, 1662, 1710, 1850, 1911, 1937, 2030, 2080, 2144`. All go through `accountOwns` → `accountOwner` → `resolveAccountOwner` (`:1145`, the only production caller) |
| No intermediate `try` swallows a throw | ✅ The only `try` blocks in the route are at `132, 295, 1087, 1207, 1544, 1580, 1657, 2262, 2317`. `:1077` sits **before** the `:1087` try; `:1206` sits **outside** the `:1207` try (the try is inside the `if`); `:1662` sits **inside** the `:1657` try, whose catch (`:1683-1690`) logs and **rethrows**. The other 11 sites are in no `try` at all. No `.catch(` wraps a site (the three in the file, `:504`, `:864`, `:2000`, wrap an alert, `resolveInvoicePaymentIntent` and activity logging). `recordPlanPeriodPaid` (`:802`) is called only from `:1240`, outside any try. Every `handleConnect*` / `handlePlanSubscriptionEnded` is called only from `POST`'s switch (`:2470-2590`), and between `:2262` and `:2607` the only nested `try` is the signature loop (`:2317`) |
| Catch path | ✅ `:2607-2647`: logs `{ err }`, sets the claim row to `status: 'failed'` with `failure_message` (500 chars), returns 500 with no internal detail outside development. `processedEventId` is set at `:2380` (reclaim of a `failed` row) or `:2405` (fresh insert) before any handler runs, and the next delivery's `failed` row is reclaimed at `:2373-2381` |
| #246 does not add sites or swallowing tries | ✅ Its `route.ts` hunks only add the `vetLinkId` import and rework `ownedOrNull` (no owner lookup). `bindPlanSubscription` / `vetLinkId` do not call the resolver |
| Snapshot "+1, 0 changed" reasoning | ✅ 40 `exports[...]` entries; an awk count over the `.snap` finds **no** entry with more than one `resolveAccountOwner` effect; the harness re-imports the route per scenario (`jest.isolateModules`, `:304`). Not caching `null` and clearing at request start therefore cannot add an effect to any existing entry |
| `console.*` in touched files | ✅ 0 in `route.ts`, `stripeAccountContext.ts`, `PaymentRepository.ts`, `PluginConnectionRepository.ts`. Nothing to flag under CLAUDE.md § Logging |
| Entitlements import | Not applicable. No touched file imports from `lib/business-os/entitlements/` |

### Concurrency of `clear()` at the top of `POST` (Q-1)

Two in-flight requests on one warm instance interleave at awaits, so a module `Map` cleared per request is **not** strictly request-scoped. Worked through every interleaving:

- R2's `clear()` during R1's work costs R1 one repeat lookup. Harmless (the repeat can itself throw, which is the same outcome as any later DB read failing).
- R1 resolves owner A for account X **after** R2's `clear()` and stores it; R2 can then read A for X. That value is at most R1's lookup latency plus the overlap old, and it is the true account → owner fact, not tenant data. It is cleared by the next request's `clear()`.
- A `null` or an error is **never** shared, because neither is ever stored.

So the two invariants FU-5 exists for (a failed read is never "no business", and a miss is never remembered) hold under **any** interleaving. The residual is a positive owner that may be sub-second stale across overlapping requests, against today's instance-lifetime staleness. A request-scoped `Map` threaded through ~10 handlers would change the `--exact` untouched sets of CF-5 PRs 2 to 4, and AsyncLocalStorage is a new pattern. **Ruling: `clear()` is accepted**, on condition C-2 (the comment and the requirement row say what it actually guarantees, not "one request only").

### Rulings on Dev's questions

| # | Ruling |
|---|---|
| Q-1 | **`clear()` accepted** (see above). Do not key a per-request map off the `log` object or similar identity tricks: handlers derive child loggers, and it couples caching to logging |
| Q-2 | **Accepted as infra behaviour.** A webhook that cannot read the database must not acknowledge an event it did not process; a failed delivery visible in the Stripe dashboard (with the claim row's `failure_message` naming the table and code) is the correct, observable signal, and it replaces silent loss. It is the same contract every other handler throw already has today (harness entries 9c and 10). Recovery after Stripe stops retrying is a manual replay, which is unchanged. Observation, not a condition: if the DB is fully down, the catch's own claim release can fail and leave the row `processing`, and later deliveries then return 200 "duplicate". That is pre-existing for every handler throw, not introduced or widened by FU-5; TL may log it against the claim work in CF-5 PR 1 |
| Q-3 | **Leave it.** The outcome at `:1662` is correct (500, claim released). The misleading error line ("Could not bound a payment plan…") is an over-alarm, not a lost signal. Hoisting is reshaping and belongs with CF-5 PR 4, which moves that handler; TL to add it to PR 4's notes |
| Q-4 | **No guard.** Unit cases 1 and 2 pin the behaviour; a text guard on `.error` would be brittle and vacuous once the reads move behind repositories (ruling below) |
| Q-5 | **Sequence: Fix-1b (#246) → FU-5 → CF-5 PR 0.** TL edits the CF-5 workplan §11 sequence line and the requirement row; Dev does not touch either doc in this PR |

### CLAUDE.md rule 1: `resolveAccountOwner`'s direct reads (ruling for TL to carry into the CF-5 workplan)

**Correction to §1 of this plan:** `StripeConnectRepository` **does exist**: `lib/repositories/PaymentRepository.ts:1498`, constructor-injected client (default `supabaseServer`), singleton `stripeConnectRepository` at `:1623`, Pino, 0 `console.*`. `PluginConnectionRepository` also exists and already owns `plugin_connections`.

The user now wants the webhook's direct DB access fully aligned in this effort, so CF-5 Q-2's "tracked follow-up" is superseded as follows:

1. **Placement: CF-5 PR 5.** PR 5 already owns "helpers to `supabaseServer`" and adds the rule-1 guard; this is a helper change and belongs with it. Not PR 1: PR 1 is the claim table and client alias, and its untouched set is every handler but `POST` / `completeClaim`. Estimate +0.25 d on PR 5.
2. **No new repository.** Both tables already have owning repositories, and the user prefers reusing existing infrastructure. Add one method to each, following `new-repository` conventions (injected client, `RepositoryResult` shape of that file, Pino, error returned not thrown, RLS-bypass comment):
   - `StripeConnectRepository.findOwnerIdByStripeAccountId(stripeAccountId)`: `select('user_id').eq('stripe_account_id', …).maybeSingle()`. The same chain as today.
   - `PluginConnectionRepository.listByPluginKey(pluginKey)` (or a name of that shape): `select('user_id, profile_data, status').eq('plugin_key', …)`. The same chain as today, **with no status filter**.
   - Both are **unscoped by design** (they map an external id to an owner; the owner is the output, never an input). Document that per `tenant-isolation-guard`, and add them to the `REPOSITORY_STRATEGY.md` note that CF-5 C-6 lands in PR 1.
3. **Do not reuse `findActiveByProfileData`.** It filters `status = 'active'` and uses JSONB containment on one key, while the resolver matches `stripe_account_id` **or** `id` with no status filter. Switching would change which accounts map to a business, which is a business-logic change outside the user's scope rule.
4. **Keep the resolver's signature `resolveAccountOwner(db, stripeAccountId)`.** It constructs the two repositories with the injected `db`, and a repository `error` becomes the FU-5 throw (same message: table plus code). Then `route.ts:1145` and every harness entry's recorded `resolveAccountOwner` args (`["<supabase-admin>", "acct_…"]`) stay byte-identical, PR 5's "Connect handlers `--exact` identical" proof holds, and PR 5's guard ("`supabaseServer` only as an argument to the three helpers") needs no change. The 5 + 4 resolver unit tests keep passing on the same fake, because the chains are unchanged. Add unit tests for each new repository method (data, miss, error).
5. **Out of scope for CF-5:** `resolveUserConnectAccounts` (`:83`, used by `booking/finalize`) and `resolvePaymentCollectionCapability` (`:240`, 5 routes) in the same file also read directly. They are not the webhook's access. They stay with the purge workplan's T29 item (3) as a tracked follow-up.

### Conditions

- **C-1 (rebase re-check).** After rebasing onto post-#246 `main`, re-run `grep -n "accountOwns\|accountOwner(" route.ts` and the `try` scan. Record in this workplan that the count is still 14 and that no site moved into a non-rethrowing `try`. Any new site or swallowing `try` is a stop and comes back to SA. The FU5-E `it.each` must cover all 14, including `:1662` (the plan-checkout site): assert 500 and claim `failed` there too.
- **C-2 (honest scope).** The rewritten cache comment (`:1116-1121`) and TL's requirement row must say: "cleared at the start of every request; never holds `null` or an error; under concurrent requests on one instance, a positive owner resolved by one request may be read by an overlapping one". Not "lives for one request only".
- **C-3 (error content).** The thrown `Error` message carries table plus PostgREST `code` only. `cause` may hold the PostgREST error object (it reaches the Pino `err` serializer, not the response; the 500 body carries no detail outside development). No account id or row data in the message, because it is persisted to `failure_message`. Unit case 4 pins this.
- **C-4 (snapshot proof as written).** Re-record "before" on post-#246 `main`. After: +1 entry (FU5-1), 0 changed, 0 removed, entry by entry. Any moved hash is a stop back to SA, never `-u`. Run the 12 suites plus `planOwnership.qa.test.ts`, scoped `tsc`, and `git diff --numstat` (check no deletion-only file).
- **C-5 (§1 correction).** Amend §1 "CLAUDE.md rule 1" to the corrected facts above (`StripeConnectRepository` exists; the move is ruled into CF-5 PR 5). FU-5 itself still touches only the two `error` checks.

### Approval
[x] Workplan approved. Proceed to implementation after #246 merges, under C-1 to C-5.

---

**Code Review by SA — 2026-10-07**
**Status:** ✅ Code Approved (one doc wording fix for TL before commit, comment 1)

Reviewed in worktree `neuronforge-webhook-repos` on `fix/webhook-owner-cache-retry`, base `0f3dd447`, uncommitted. `git diff --numstat`: 8 files, no deletion-only file (snapshot 98/0, harness 29/0, QA 230/9, route 24/11, resolver 20/0, resolver test 58/4, CF-5 workplan 17/4, requirement 4/1).

### Verification

| Check | Result |
|---|---|
| C-1: 14 sites, no swallowing `try` | ✅ Re-grepped the call expressions: `683, 809, 1084, 1222, 1319, 1340, 1678, 1726, 1866, 1927, 1953, 2046, 2096, 2160`. §8.1 lists them by the `if` line, which is one to nine lines earlier; it is the same 14. `try` lines: `133, 296, 1094, 1223, 1560, 1596, 1673, 2282, 2337, 2637`. `:1084` comes before `:1094`. `:1222` is outside the `:1223` try, because that try is inside the `if`. `:1678` is inside the `:1673` try, which rethrows. The rest are in no `try`. SA read `:809`, `:1927` and `:2160` in full: at each site the owner check comes before the site's writes, so a throw ends the handler before anything is written |
| Throw reaches the existing catch | ✅ The `POST` catch (`:2627`) logs `{ err }`, sets the claim to `status: 'failed'` with `failure_message` (500 chars), and returns 500 with no detail outside development. FU5-E proves this at all 14 sites: an `it.each`, a length-14 guard, and a control run per site that hits that site's own refusal line first. The `:1669` pass-through case pins the rethrow. Harness FU5-1 records the same sequence: claim select, claim insert, `payment_invoices` select, one lookup, update `{ status: 'failed', failure_message: 'Account owner lookup failed on stripe_connect_accounts (code XX000)' }`, then 500 |
| Truly unmapped unchanged | ✅ FU5-U sends two events on one warm instance: each gets 200, `completed`, no victim write, the refusal logged, and its own fresh lookup. `accountOwner`'s `null` warning is unchanged |
| No `null` / error cached; `clear()` at top of `POST` | ✅ The map is `Map<string, string>`, and `set` runs only `if (owner)`. A rejection propagates before `set` is reached. `accountOwnerCache.clear()` (`:2280`) comes after the two declarations and before the `try`, so every request starts clean: platform or Connect, valid or not. `Map.clear()` cannot throw. Two tests prove there is no poisoning: FU5-R, where the same event id is redelivered on a warm instance after a failure, and the flipped C-2 |
| Thrown message (C-3) | ✅ The message is `Account owner lookup failed on <table> (code <code>)`, with no account id and no driver text. There is no `cause` (deviation 2), which is stricter than C-3 allowed. A unit case pins this for both tables, using an error whose message carries `acct_secret`, `u_secret` and driver text |
| Comment honesty (C-2) | ✅ The route comment states the three guarantees and the overlap ("requests overlapping on one warm instance may share a positive owner that another of them found moments earlier"). The resolver JSDoc says "`null` means both reads succeeded". Neither claims "one request only". See comment 1 for the requirement row |
| Snapshot (C-4), re-hashed by SA | ✅ SA used an independent script (`scratchpad/sa-hash.js`: entries split on `exports[`, sha256 of each body). The base (`git show HEAD:`, blob `3f2630f7`) has 44 entries; the working copy (blob `5cc8789c`) has 45. **44 same, 0 changed, 0 removed, +1 `FU5-1`.** The line diff removes 0 lines |
| Live schema (plan §2.1, `business-os-schema-check`) | ✅ Dev did not record this check, so SA ran `schema-check --json` on main `89dbc568`, where the two chains are byte-identical. There is no finding for `stripe_connect_accounts (user_id)` or `plugin_connections (user_id, profile_data, status)`. The only `plugin_connections` finding is `metadata`, in `user/data-export`. The check matters here: with FU-5, a phantom column would make every Connect event return 500 instead of refusing silently. The `UNIQUE` on `stripe_account_id` is taken from the migration (`20260722…:194`), because the script does not check constraints |
| Deviations 3 to 5 | ✅ **3:** `planBySubscription` defaults to the old `{ data: null, error: null }`. Every pre-existing QA test passes unchanged except the two planned changes (C-1, C-2). **4:** the control-first runs make FU5-E stronger. The control proves the error run reached the site it names, and `logged(control.msg) == []` proves the error run threw before refusing. **5:** the layering is sound. The route tests stub a rejection, the unit tests prove the real resolver rejects, and the stub uses the real message verbatim |
| CF-5 workplan edits | ✅ They match the rulings: <br>- §11 sequence: `Fix-1 → Fix-1b → FU-5 → PR 0…`. <br>- PR 0 now counts 45 entries. <br>- PR 1 note: the Q-2 observation, marked pre-existing and outside PR 1's byte-identical scope. <br>- PR 4 carries Q-3: hoist the `:1669` check above its `try`. <br>- PR 5 scope addition matches the rule-1 ruling point for point: the existing `StripeConnectRepository` and `PluginConnectionRepository`, the same chains, **no status filter**, `findActiveByProfileData` not reused, unscoped by design per `tenant-isolation-guard`, the signature `resolveAccountOwner(db, stripeAccountId)` unchanged, a repository `error` becoming the FU-5 throw, unit tests per method, +0.25 d, and T29 out of scope. <br>Dev made these edits rather than TL (deviation 6, on coordinator instruction). The content is correct, so they are accepted |
| Rules 1, 3, 4, 6 | ✅ **Rule 1:** no new DB access. The resolver's two direct reads are pre-existing and are ruled into CF-5 PR 5. **Rule 3:** 0 `console.*` calls in `route.ts` and in `stripeAccountContext.ts`. The QA file's `console` spies are pre-existing test silencing. **Rule 4:** the resolver's reads are unscoped by design, because the owner is the output, and this is pre-existing. **Rule 6:** no new `any`. `AccountLookupDb = any` and `catch (error: any)` are pre-existing |
| Entitlements | ✅ No import from `lib/business-os/entitlements/` in any touched file |
| Tests run by SA (`--ci --runTestsByPath`) | ✅ First set: `app/api/stripe/webhook/__tests__/*` (9 suites, including all guards and `planOwnership.qa`), `lib/payments/__tests__/*` (39, including `deferredFirstPayment`, `planSurfaces` and `stripeAccountContext`), `noBookingGuess.guard` and `userSubscriptionsWriteLockdown.qa`. Result: **50/50 suites, 821/821 tests, 45/45 snapshots**. The other 4 `app/api/stripe` suites: 4/4 suites, 27/27 tests |

### Code Review Comments

1. `docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md`, FU-5 Change History row (TL). — Priority: Medium. Doc only; **fix before commit**, no code change.
   - The row says overlapping calls can share a successful lookup "**under a second old**". That overstates the bound.
   - The value can be as old as the overlap between two requests, and a Connect handler makes Stripe and DB calls that can take seconds.
   - SA's own workplan note said "sub-second", which was also too tight.
   - Reword to C-2's text: "a successful lookup by one call may be read by an overlapping call; a failed or empty one never is".
2. `lib/payments/stripeAccountContext.ts`, `ownerLookupError`. — Priority: Low. Optional now, or carry it into CF-5 PR 5, which rewrites this function.
   - `error?.code ?? 'unknown'` keeps an empty string.
   - supabase-js reports a network failure, the most likely transient case, with `code: ''`. The message then ends in `(code )`.
   - `||` would give `(code unknown)`.
   - The table is still named, so retry behaviour is unaffected.
3. `fix1Ownership.qa.test.ts`, FU5-E. — Priority: Low.
   - `writes(r, PLAN_TABLES)` cannot see plan writes made through the mocked `paymentPlanSubscriptionRepository`, because `recordPeriodPaid`, `recordFailure` and `close` record no effect. So at `:809`, `:1927` and `:2160` the "no plan write" half of the assertion is vacuous.
   - This is not a gap in the proof. The code order (check before write), plus `logged(control.msg) == []` with one lookup, shows the handler ended at the check.
   - Recording an effect in those three mocks would make the assertion real.
4. §8.3 counts. — Priority: Low.
   - Dev reports 51 suites and 832 tests. SA reproduces the stated set as 50 suites and 821 tests.
   - The likely cause is one extra suite in Dev's run, for example `app/api/stripe/__tests__/stripeAuditEntries.test.ts`.
   - All pass either way. For the record, list the exact paths.
5. CF-5 workplan §11. — Priority: Low.
   - The Fix-1 and Fix-1b task lines are unticked and still read "Code complete, uncommitted", though both are merged (#242, #246).
   - This is pre-existing staleness, not introduced here. TL may tick them with the FU-5 merge row.

### Optimisation Suggestions

- The QA stub and the harness stub each hard-code the resolver's message. If CF-5 PR 5 changes the wording, both stubs must be updated together. A shared fixture constant would be a new pattern, so it is not worth adding now.

### Code Approved for QA: Yes

Condition: TL corrects the requirement row's wording (comment 1) before RM commits. Comments 2 to 5 are non-blocking.

## QA Testing Report

**QA — 2026-10-07**
**Test mode:** full
**Strategy used:** B (integration through the real route and the **real** `resolveAccountOwner`; only the Supabase client, Stripe, `StripeService` and the logger are faked) plus A (the resolver called directly), plus a before/after run against the pre-FU-5 code. Why: the existing route-level tests stub the resolver, so this is the first layer that proves the real resolver's throw reaches the claim release end to end.
**Focus:** api, webhook claim reliability, security (`failure_message` content)
**Skipped:** e2e (no UI); live DB / Stripe (not allowed)
**Input source:** prompt keywords (TL trigger, items 1–7)

Worktree `neuronforge-webhook-repos`, branch `fix/webhook-owner-cache-retry`, base `0f3dd447`, uncommitted. TL's SA-finding-2 edit (`error?.code || 'unknown'`) is in the tree and covered.

**New file (the only file QA added):** `app/api/stripe/webhook/__tests__/ownerCacheRetry.qa.test.ts`, 23 tests, no snapshots. The harness, its snapshot and every existing test are untouched. Its fake database is adapted from `planOwnership.qa.test.ts`: in-memory, stateful, and it records every operation. It adds two things: (a) a PostgREST-shaped read error on either lookup table, and (b) gates that hold one operation until released, so two requests can be interleaved on one warm module instance.

### Test Coverage

| Acceptance criterion (TL items) | Tested? | Result | Notes |
|---|---|---|---|
| 1. Fresh delivery, DB error on each table → 500, claim `failed`, message = table + code only, nothing written | ✅ | Pass | FD-`stripe_connect_accounts`, FD-`plugin_connections`. The injected error's message and details carry the account id, the owner id and driver text. `failure_message` is exactly `Account owner lookup failed on <table> (code XX000)` and contains none of them. The logged `err` has no `cause`. Body `{ success:false, error:'Webhook processing failed' }`. No write outside `processed_webhook_events`, no Stripe call, and the invoice row deep-equals the seed. Lookup order is kept: the plugin table is read only after an express miss |
| TL's finding-2 edit: `code: ''` → "(code unknown)" | ✅ | Pass | FD-unknown goes through the route (`code: ''`, and no code at all). R-* calls the resolver directly (both tables; a real code `57014` is still shown). Mutation check: with `??` put back, 3 of these tests fail |
| 2. Redelivery after recovery, same warm instance | ✅ | Pass | RD-* (both tables). Same event id. Logs `Retrying previously failed event`. Claim writes are `update processing (failure_message: null)` → `update completed`, on one claim row. A fresh lookup runs, and the invoice URL and PDF are written |
| 3. Truly unmapped account | ✅ | Pass | U-1: 200, `completed`, nothing written, `maps to no known business` and the site refusal both logged, both tables read. **Identical to the old code** (normalised trace diff, below). U-2 (fresh lookup on the next event) and U-3 (the account maps later → the next event is written) are the intended change |
| 4. Mapped account: same outcome, one lookup per request | ✅ | Pass | M-1 (`invoice.finalized`). M-2 (first-period `invoice.paid`): two checks, the bind at `:1222` and `:809`, **one** lookup, plan bound, period recorded. Both are **identical to the old code** by trace. M-3: a second request on the warm instance looks up again (intended change) |
| 5. Interleaving | ✅ | Pass | IL-1: both lookups in flight, A's fails and B's succeeds → A gets 500 / `failed`, B gets 200 / `completed` from its own read. IL-2: B is held before its check while A fails completely → B does its own lookup and is processed (no cached `null` or failure). IL-3 (documented, C-2): B reuses A's positive owner (1 lookup for 2 requests). IL-4: B's `clear()` lands between A's two checks → A is still processed. For another account it costs A one repeat lookup; for the same account, A reads B's positive entry |
| 6. SA finding 3: real "no write" at `:809` / `:1927` / `:2160` | ✅ | Pass | The real `PaymentPlanSubscriptionRepository` runs over the fake DB, so its writes are recorded. Per site: the mapped control **does** write a `payment_plan_*` row and logs the success line. The foreign-owner control reaches the site's check and refuses. The error run gives 500, `failed`, 1 lookup and zero writes, and the plan, installment, transaction and invoice tables deep-equal their state before the run |
| 7. Regression + CI time | ✅ | Pass | 117/117 suites, 2,221/2,221 tests, 45/45 snapshots (below) |
| Snapshot blob unchanged | ✅ | Pass | `5cc8789c09b887bef4181acd281e1153ae457861` before and after every run. Nothing was run with `-u` |

### Old code vs new (item 3)

The QA file was run against `git show 0f3dd447:` copies of `route.ts` and `stripeAccountContext.ts`, in a temporary folder inside the worktree (`app/api/stripe/webhook/__qa_old_fu5__/`, deleted afterwards). Only the two path constants were re-pointed. **Old code: 19 failed, 4 passed.**

| Fails on old code | Why |
|---|---|
| FD-× 4, RD-× 2, IL-1, IL-2, S-× 3 | The old resolver ignores `error`, so the read error reads as "no business". The owner check refuses and the event completes with **200** (`Expected: 500, Received: 200`). This is the event loss FU-5 fixes |
| R-× 3 | The old resolver returns `null` instead of rejecting |
| U-2, U-3 | The old instance-lifetime cache keeps the `null`. There is no second lookup, and the account that mapped later is still refused (the old C-2 / N-3 behaviour) |
| M-3, IL-4 × 2 | The old cache is never cleared, so the second request makes 0 lookups (intended change, C-1 third post) |

**Passes on old code (unchanged behaviour):** U-1, M-1, M-2, IL-3. Both runs wrote a normalised trace (`QA_FU5_TRACE`) of U-1, M-1 and M-2: status, body, every DB op with payload and filters, Stripe calls, warn and error lines, and final table state. The two trace files are **byte-identical** (sha256 `1c207790…0878`).

Two more mutants were run the same way and also deleted. The resolver with `??` gives 3 failures (the finding-2 tests). The route without `accountOwnerCache.clear()` gives 3 failures (M-3, IL-4 × 2).

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None. A mapped account costs one lookup per request (M-2). The only added DB traffic is one lookup per later request on a warm instance, as planned.

#### Edge Cases / Notes (nice to fix, non-blocking)
1. **IL-4 shows that C-2's overlap works in both directions.** B may read A's positive owner, and an in-flight A's second check may also read an owner B found. Both are the true account → owner fact. A failure or a `null` is never shared (IL-1, IL-2). This matches the cache comment. — Low, informational
2. **`fix1Ownership.qa.test.ts` FU5-E still has the vacuous plan-write half at `:809` / `:1927` / `:2160`** (SA finding 3). Not edited, per instruction. The real check is now in `ownerCacheRetry.qa.test.ts` QA 6. — Low
3. **SA Q-2 observation re-confirmed as pre-existing:** if the claim release itself fails (DB fully down), the row stays `processing`. Not exercised here; it is CF-5 PR 1's scope. — Low, tracked
4. **Scope check.** The diff changes only the error checks, what the cache holds and how long, and comments. No business rule changes (refusal policy, ownership, writes), and the identical U-1 / M-1 / M-2 traces confirm it. The infra-only rule is met.

### Test Outputs / Logs

The new file alone (`--ci --runTestsByPath`): `Tests: 23 passed, 23 total`, Jest time 3.9 s. About 2.5 s of that is tests; the rest is the ts-jest transform of `route.ts`. `eslint`: 0 problems. `tsc --noEmit` scoped to the file (repo tsconfig): 0 errors.

Regression set: the exact paths are the four globs below. Command `node node_modules/jest/bin/jest.js --ci --runTestsByPath <117 files>`, exit 0, **wall 45 s** (Jest `Time: 40.7 s`):

| Glob | Suites | Tests |
|---|---|---|
| `app/api/stripe/webhook/__tests__/*.test.ts` | 9 | 196 |
| `lib/payments/__tests__/*.test.ts` | 40 | 633 |
| `lib/repositories/__tests__/*.test.ts` | 66 | 1,376 |
| `app/api/stripe/__tests__/*.test.ts` | 2 | 16 |
| **Total** | **117/117** | **2,221/2,221**, 45/45 snapshots |

Guards inside the set, all green:
- webhook: `pinoLogging` (11), `routerPlacement` (12), `emptyBody` (7), `receiptOnPaid` (5);
- `app/api/stripe/__tests__/noBookingGuess.guard` (5);
- `lib/payments/__tests__/`: `deferredFirstPayment.guard` (42), `planSurfaces.guard` (11), `servicePlanWiring.guard` (16), `dateOnlyIsNotMidnightUTC.guard` (9);
- `lib/repositories/__tests__/`: `adminReadMethods.guard` (46), `mutationOrSelect.guard` (3), `businessOsEntitlements.imports.guard` (24), `authAccountRepository.callers.guard` (8), `bookingPaymentStatusReaders.guard` (1), and `userSubscriptionsWriteLockdown.qa` (10).

On SA finding 4: SA's 50-suite set is the webhook dir (8 suites before QA's file), `lib/payments/__tests__` (40), `noBookingGuess.guard` and `userSubscriptionsWriteLockdown.qa`. Dev's 51 most likely added `app/api/stripe/__tests__/stripeAuditEntries.test.ts` (11 tests), which fits SA's guess (821 + 11 = 832).

**CI time:** no new job, shard or dependency. One new Jest suite takes about 4 s on whichever shard picks it up (2.5 s of it test time). That is less than half of `planOwnership.qa` (8.8 s under the same load). It runs inside the existing Jest gate, which finishes well ahead of `next build`, so the critical path does not move.

### Final Status
- [x] All acceptance criteria pass — ready for commit (subject to SA comment 1, TL's requirement-row wording, which is outside QA's scope)
- [ ] Issues found — Dev must address before commit

**Verdict: PASS WITH NOTES** (0 High, 0 Medium, 0 Low bugs; notes 1–3 are Low and non-blocking).

## Commit Info

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-07 | Workplan created (Dev) | Plan only. "Before" recorded on 7ffe5162: 40 entries, blob `09a244f2`, 217/217 tests |
| 2026-10-07 | SA workplan review (SA) | Approved with conditions C-1 to C-5. Verified on `7ffe5162` and the #246 diff: 14 sites, none in a swallowing `try` (`:1662` rethrows), catch releases the claim and returns 500, no snapshot entry has more than one owner lookup. Q-1 `clear()` accepted (null and errors never shared under any interleaving; comment must state the overlap). Q-2 accepted as infra behaviour. Q-3 leave, to CF-5 PR 4. Q-4 no guard. Q-5 TL edits. Rule 1: `StripeConnectRepository` exists; `resolveAccountOwner`'s reads move in **CF-5 PR 5** via one new method each on `StripeConnectRepository` and `PluginConnectionRepository`, resolver signature unchanged |
| 2026-10-07 | Implementation (Dev) | On 0f3dd447 (post-#246), uncommitted. Resolver throws on either read error (table + code only); cache never holds `null`, cleared at the start of `POST`. C-1: still 14 sites, none in a swallowing `try`. C-4: snapshot +1 (FU5-1), 44 existing entries byte-identical. 51/51 suites, 832/832 tests, 45/45 snapshots. C-5 §1 corrected. CF-5 workplan updated (§11 `→ FU-5`, PR 5 rule-1 scope, PR 1 note). §8 |
| 2026-10-07 | SA code review (SA) | APPROVED; C-1 to C-5 met. SA re-hashed the snapshot: 44 entries identical, +1 FU5-1. SA ran the live schema check: both resolver selects are valid. SA test run: 50/50 suites, 821/821 tests, 45/45 snapshots. One condition: TL rewords "under a second old" in the requirement row before commit (comment 1). Comments 2 to 5 are Low and non-blocking |
| 2026-10-07 | QA (QA) | PASS WITH NOTES, 0 bugs. New `ownerCacheRetry.qa.test.ts` (23 tests, real resolver, stateful fake DB with error injection and await gates): lookup error on either table → 500 / `failed` / table + code only / nothing written; redelivery reclaims and processes; unmapped and mapped outcomes byte-identical to `0f3dd447` by trace; interleavings never share a failure or `null`; finding 2 (`code ''` → "unknown") and finding 3 (real no-write at `:809` / `:1927` / `:2160`) covered. Old code: 19/23 fail, as expected. Regression 117/117 suites, 2,221/2,221 tests, 45/45 snapshots, 45 s; snapshot blob `5cc8789c` unchanged |
