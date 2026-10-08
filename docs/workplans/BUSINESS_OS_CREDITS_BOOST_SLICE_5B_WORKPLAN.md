# Workplan: Business OS Credits Boost — Slice 5b "Buy works"

> **Last Updated**: 2026-10-08

**Developer:** Dev
**Requirement:** [BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md): FR-6 to FR-12, FR-24 to FR-29, BQ-B1, R-10, R-11
**Carry-forwards taken in:**
- **5a §9:** `purchaseAvailable` comes from the server-side `isBoostCheckoutOpenFor(user.id)`, and the checkout flag stays the authority; delete `PURCHASE_BUILT` and narrow the C-3 guard; revisit the cache (Q-2 → `no-store`); SA N-1 (no `title` on a disabled button) and N-2 (add a `SheetDescription`).
- **Slice 3 §9:** map every checkout refusal code; the return URL is `/business-os?boost=return&session_id={CHECKOUT_SESSION_ID}` (SA residual: confirm it is served).
- **4a:** credits arrive only through the webhook. The owner-visible status "Payment under review" covers flagged rows (C-5).

**Branch:** `feature/bos-credits-boost-slice-5b`, cut from `origin/main` `e2813fca` (after #259)
**Date:** 2026-10-08
**Status:** **5b.1 merged ([PR #264](https://github.com/AgentsPilot/neuronforge/pull/264), 2026-10-08). 5b.2 "Purchases list": approved and committed 2026-10-08, [PR #267](https://github.com/AgentsPilot/neuronforge/pull/267) open.** **QA PASS 2026-10-08** (no defects; see QA — 5b.2). SA code review approved 2026-10-08 (Code Complete 2026-10-08) (results in §6.3). *(Earlier: **5b.1 "Buy and return": approved and committed 2026-10-08, [PR #264](https://github.com/AgentsPilot/neuronforge/pull/264) open; after deploy the user runs the test purchase (§7); 5b.2 next.** **QA PASS 2026-10-08** (one Low UX note, same as SA N-1; see QA Testing Report). SA code review approved 2026-10-08 (Code Complete 2026-10-08). C-1 to C-6 applied (§3.0); results in §6.1. 5b.2 (the Purchases list) not started. *(Earlier: SA approved with conditions 2026-10-08.)*)*

## Overview

5a shows the packages with a disabled "Coming soon" Buy. 4a credits a paid boost from the webhook. 5b connects the two for the accounts the checkout switch allows:
- Buy starts a checkout and mounts Stripe's embedded form inside the Top up panel.
- After paying, the owner lands back on the dashboard with a clear "payment received" message that follows the purchase until it is credited.
- A **Purchases** list shows every boost bought (FR-26).

Nothing here credits anything. Credits still arrive only through the 4a webhook (FR-13).

---

## 1. Analysis Summary

| Area | As built on `e2813fca` | 5b use |
|---|---|---|
| Packages route (5a) | `purchaseAvailable: false` (a literal); `Cache-Control: private, max-age=60` | `purchaseAvailable = isBoostCheckoutOpenFor(user.id)` (flag + allow-list); `private, no-store` (5a SA Q-2) |
| Checkout route (3) | `POST /api/business-os/credits/boost/checkout {packageId}`. Returns 200 `{ clientSecret, purchaseId, expiresAt }`. Refusals: flag off **404**; **401**; invalid **400**; `not_eligible` **403**; `awaiting_payment` **409**; `cap_reached` **409**; `unknown_package` **404**; `catalogue_unavailable` **503**; `checkout_unavailable` **502**; `payments_unavailable` / `payment_hold_check_failed` / `reservation_failed` **500** | Called by the panel only when `purchaseAvailable` is true |
| Embedded checkout in the repo | `@stripe/stripe-js` ^9.12.1 and `@stripe/react-stripe-js` ^6.8.0 are **already dependencies**. `components/test-business-os/PlanCheckoutPanel.tsx` (P-3a harness) mounts `EmbeddedCheckoutProvider` / `EmbeddedCheckout` with a module-level `loadStripe(NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)`. Plan payments P-4 (Settings buy) is not built | Same pattern. **No new dependency** |
| Return URL | `app/business-os/page.tsx` (`'use client'`, 1,536 lines) serves `/business-os` and ignores query parameters, so the return URL **is served** and simply shows the dashboard | A small `BoostReturnNotice` reads the two parameters (§3.3) |
| Purchases table (2a) | Owner RLS `SELECT` policy (`auth.uid() = user_id`). The owner column grant **does not include** `stripe_checkout_session_id`, `flag_reason`, Stripe ids or amounts other than tax / total / refunded. The repository (service role by design) has `listForAccount(accountId, { livemode, limit })`, scoped by `user_id` and mode, newest first | The list reuses `listForAccount`. The return-status read needs the session id, so it is a new **user-scoped** service-role read (§3.4) |
| Credit history panel | A `Sheet` pattern, business-clock dates via `timeZoneOptions`, the link behind a flag that is off | Purchases reuse the date and format rules; placement is in Q-3 |
| Credits card (6a / 11d / 5a) | Re-reads on `onCreditUsageChanged` | The return notice raises the signal when the purchase is credited |

---

## 2. Scope and guardrails

**In scope:**
- the packages route switch;
- the panel's Buy → checkout → embedded form, with every refusal mapped;
- the return notice and its status read;
- the Purchases route and list;
- strings in en/he/es, tests, guards and docs.

**Out of scope:**
- refunds, disputes and reconcile (4b): their statuses are only *displayed* when present;
- the admin view (6);
- Settings → Plan.

**Guardrails (must not):**
- Credit, or trust `session_id` / `purchaseId` client-side. The return page only **reads** our row (FR-11, FR-13).
- Call `/checkout` unless the server said `purchaseAvailable: true`. The server stays the authority (404 while the flag is off).
- Send anything but `{ packageId }` (FR-8).
- Show a combined credit total or a separate "bought" figure on the card (FR-24, BQ-B1).
- Expose a Stripe id, the session id, `flag_reason` or `livemode` in any owner response.
- Set the flag on Preview (4a §7).
- Add a migration or a dependency.

---

## 3. Implementation Approach

### 3.0 SA conditions applied (2026-10-08): 5b.1 "Buy and return" first

| # | Condition | Where |
|---|---|---|
| C-1 | 5b.1 includes the purchases route's **`sessionId` branch**, `BoostPurchaseView` with its status mapping, and their tests (what the notice polls). 5b.2 adds only the list branch, `BoostPurchasesList` and the panel section | §3.4; tasks |
| C-2 | `purchaseAvailable` only when `isBoostCheckoutOpenFor(user.id)` **and** `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is present **and** its `pk_test_` / `pk_live_` prefix matches `currentStripeMode()`; otherwise `false` plus one `error` `bos_boost_publishable_key_mismatch`. The panel keeps its no-key fallback | §3.1 |
| C-3 | `findForAccountBySessionId(accountId, sessionId)`: the account only from `getUser()`; `.eq('user_id').eq('stripe_checkout_session_id')` with an explicit column list; a malformed id is refused before any query; another owner or missing → `null`; the response is the view only. Tests pin the exact key set and the cross-owner `null` | §3.4 |
| C-4 | Single flight: the ref guard is held from the click until the form mounts or the request fails, and re-armed on Back. Test: a double click across two microtasks | §3.2 |
| C-5 | The 409 `cap_reached` answer gains `{ capMinor, windowDays }` only (never `countedMinor`); `capMinor` reflects an override; the panel formats with `formatMinorAmount` | §3.2; slice 3 route and orchestrator |
| C-6 | §7: check the `pk_test_` prefix; both variables Production-only with Preview unticked; the poll stops after about 77 s, and a delayed card (`4000 0000 0000 3220`) still credits (refresh); recovery = 4a §7 step 6, test mode only | §7 |

Rulings Q-1 to Q-8 as proposed (§10): the user-scoped service-role read; the bounded poll; Purchases at the bottom of Top up (5b.2); `listActive()` names; the cap figures; the pending reservation accepted; a local `loadStripe`; the split.

### 3.1 Packages route

- `purchaseAvailable: isBoostCheckoutOpenFor(user.id, requestLogger)`.
- `Cache-Control: private, no-store` on every answer.
- The 5a payload type already allows `boolean`. The tests change from "always false" to:
  - flag off → false;
  - flag on with no list → true;
  - flag on, list set without the account → false;
  - flag on, list with the account → true.

### 3.2 The panel (`BoostPackagesPanel.tsx`)

- **Delete `PURCHASE_BUILT`.** `canBuy = payload.purchaseAvailable === true`.
  - Not available: Buy stays disabled with "Coming soon". The `title` is removed (N-1); the visible label carries it.
  - Available: Buy reads **"Buy"** / "Comprar" / "קנייה".
- **One checkout per click.**
  - The first click sets `starting` (all Buy buttons disabled, a spinner on the chosen one), then calls `POST /api/business-os/credits/boost/checkout { packageId }`.
  - Further clicks are ignored while `starting` or while a form is mounted (a ref, not only state, so a double click within one render cannot send twice).
- **On 200,** the package list is replaced by a "checkout" view inside the same sheet:
  - a "← Back to packages" link, the chosen package's summary line, and `EmbeddedCheckoutProvider` / `EmbeddedCheckout` with the `clientSecret`;
  - `loadStripe(NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)` is held at module level, as in `PlanCheckoutPanel`. With no key, a friendly "Payments are not available right now" error is shown and nothing is mounted;
  - the sheet widens on that view (`sm:max-w-2xl`).
- **Back, or closing the sheet,** unmounts the form. The reservation is left to expire with its Stripe session: 31 minutes, slice 3 C-3, counted against the cap until then. A new Buy creates a new reservation.
- **Errors** (friendly copy; never the raw code):

| Status / code | Owner sees |
|---|---|
| 409 `cap_reached` | "You've reached the top-up limit for now ($150 in 30 days). Contact support if you need more." The figure comes from the server answer if present, otherwise the text has no number (see Q-5) |
| 409 `awaiting_payment` | "Finish setting up your plan payment first." |
| 403 `not_eligible` | "Top-ups aren't available for this account yet." |
| 404 (flag turned off since the panel loaded) / `unknown_package` | "This package isn't available right now. Please reopen Top up." The panel re-reads the packages |
| 503 `catalogue_unavailable`, 502 `checkout_unavailable`, 500 (any), network | "We couldn't start the payment. Please try again in a moment." |
| 401 | "Please sign in again." |

- **Completion.** Stripe's embedded checkout redirects to the return URL on completion (the default `redirect_on_completion: 'always'`; slice 3 sets `return_url`), so `onComplete` is not used and the whole page navigates.
- **`SheetDescription`** (N-2): the intro line becomes the sheet's description, and the `aria-describedby={undefined}` override is removed.

### 3.3 The return notice (`BoostReturnNotice.tsx`, mounted by `UsageCard`)

- On mount it reads `window.location.search`; the 1,536-line page is not edited.
- It acts only when `boost=return` and `session_id` matches `^cs_(test|live)_[A-Za-z0-9]+$`. It then:
  1. Removes both parameters from the address with `history.replaceState`, so a refresh or bookmark does not repeat it.
  2. Shows a banner at the top of the credits card: **"Payment received — your credits will appear shortly."**
  3. Reads `GET /api/business-os/credits/boost/purchases?sessionId=…` (§3.4) at **2, 5, 10, 20 and 40 s**, about 77 s in total, then stops. **Bounded; not a timer that runs forever** (Q-2).
- The banner follows the owner status:

| Owner status | Banner | Then |
|---|---|---|
| `credited` | "Credits added." | Raises `creditUsageSignal`, so the card re-reads and "Extra credits" updates; the banner auto-hides after 8 s; the poll stops |
| `processing` (row `pending`, the webhook has not run yet) | "Payment received — your credits will appear shortly." | Keep polling. After the last read: "Your payment is still being confirmed. Your credits will appear here once it completes." |
| `awaiting_payment` (a delayed method) | "Your payment is processing. Some payment methods take a few days; your credits will be added when it completes." | The poll stops |
| `failed` | "The payment didn't go through. You weren't charged." | — |
| `expired` / `abandoned` | "This checkout expired. You weren't charged." | — |
| `under_review` (flagged, disputed) | "Payment under review. We'll be in touch if we need anything." | — |
| `not_found` (not this owner's session, or bad input) | Nothing (the banner is removed) | — |

- The banner can be dismissed. It never credits, and never shows an amount the server did not return.

### 3.4 Purchases route: `GET /api/business-os/credits/boost/purchases` (new; `new-api-route` skill)

- **Auth:** `getUser` → 401. Strict Zod on the query: optional `sessionId` (`^cs_(test|live)_[A-Za-z0-9]{1,190}$`), optional `limit` 1–50; anything else → 400.
- **Without `sessionId`:**
  - `listForAccount(user.id, { livemode: isLiveMode(currentStripeMode()), limit })`;
  - returns `{ purchases: BoostPurchaseView[] }`, newest first;
  - current mode only (R-10).
- **With `sessionId`:**
  - a new repository method, `findForAccountBySessionId(accountId, sessionId)`. Service role (the repository's documented client), **scoped `.eq('user_id', accountId).eq('stripe_checkout_session_id', sessionId)`**: the owner grant has no session-id column, so the owner RLS client cannot filter on it;
  - returns `{ purchase: BoostPurchaseView | null }`;
  - another account's session → `null`, never a 403 that would confirm it exists (tenant-isolation-guard Step 2: fail closed).
- **`BoostPurchaseView`** (pure mapper, picked by name, SA 5a C-4 style):

  ```ts
  {
    id;
    createdAt;
    paidAt;
    packageId;
    name: BoostLabels | null;
    creditsTotal;
    creditsBonus;
    priceMinor;
    currency;
    taxExclusive: true;
    status: 'processing' | 'awaiting_payment' | 'credited' | 'failed' | 'expired' | 'under_review' | 'refunded' | 'partially_refunded';
    receiptUrl;   // https only, else null
    kind: 'bought'; // BQ-B1
  }
  ```

  Status mapping:
  - `pending` → `processing`;
  - `paid` → `credited`;
  - `abandoned` → `expired`;
  - `flagged_mismatch`, `disputed`, `dispute_lost` → `under_review`;
  - every other status maps to itself.

  Never sent: Stripe ids, the session id, `flag_reason`, `livemode`, the lot id, `retail_version`.
- **Package names:** from `codeBoostPackageSource().listActive()` labels by id. A retired package falls back to `null`, and the UI then shows the id (Q-4). This makes the route an entitlements importer → a `KNOWN_NON_GATE_IMPORTERS` entry.
- **Cache:** `private, no-store`.
- **No audit:** it is a read.

### 3.5 The Purchases list

- A **"Purchases"** section at the bottom of the Top up panel (Q-3). It loads when the panel opens, in parallel with the packages, and is shown only when there is at least one purchase.
- Each row:
  - the date (business clock, `timeZoneOptions`, "8 Oct, 14:05");
  - the package name;
  - "13,750 credits";
  - "$25 excl. tax";
  - a status chip ("Credits added", "Processing", "Payment processing", "Didn't go through", "Expired", "Payment under review", "Refunded", "Partly refunded");
  - "Receipt" (opens in a new tab) when there is a link;
  - a small "Bought" tag (BQ-B1).
- Up to 50 rows; no paging in v1.
- RTL via the sheet's `dir`.
- Errors: "We couldn't load your purchases." with Try again. It never shows an empty list on an error.

### 3.6 Strings, guards and registrations

| Item | Change |
|---|---|
| Strings | New `usage.boost.*` keys in en/he/es: Buy, the error copy, the return banner states, the Purchases labels and statuses. Figures are placeholders, so the figure guard's `usage.` scan covers them. he/es are drafts listed for native review |
| 5a C-3 inert guard | Replaced by: (a) the panel calls `/checkout` from **one** function, and only after a `purchaseAvailable === true` check (source guard plus render test); (b) the view, types and purchases route still never name the flag or `isBoostCheckoutOpenFor`; (c) only the packages route may call `isBoostCheckoutOpenFor` |
| `creditFigures` `SOURCES` | Add the purchases route, the purchase view, `BoostReturnNotice.tsx` |
| Entitlements | The purchases route → `KNOWN_NON_GATE_IMPORTERS` (`codeBoostPackageSource`; a display read, refuses nothing by plan). The packages route entry is unchanged |
| Q-1 guard of 4a | Unchanged. `findForAccountBySessionId` is user-scoped, not a webhook finder |

---

## 4. Files to Create / Modify

| File | Action |
|---|---|
| `app/api/business-os/credits/boost/packages/route.ts` (+ test) | modify |
| `app/api/business-os/credits/boost/purchases/route.ts` (+ `__tests__/route.test.ts`) | create |
| `lib/business-os/boost/boostPurchasesView.ts` (+ test), `boostPurchasesTypes.ts` | create |
| `lib/repositories/BusinessOsBoostPurchaseRepository.ts` (+ test) | modify (`findForAccountBySessionId`) |
| `components/business-os/BoostPackagesPanel.tsx` (+ render tests) | modify |
| `components/business-os/BoostPurchasesList.tsx` (+ render test) | create |
| `components/business-os/BoostReturnNotice.tsx` (+ render test) | create |
| `components/business-os/UsageCard.tsx` | modify (mount the notice; one line plus the import) |
| `lib/business-os/LanguageContext.tsx` | modify (strings) |
| `lib/business-os/boost/__tests__/boostPackagesView.test.ts` | modify (the C-3 guard → §3.6) |
| `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts`, `creditFigures.fromConfig.guard.test.ts` | modify |
| Requirement, 5a / 3 notes | modify (status, Change History) |

---

## 5. Task List

- ✅ T5b.1 Repository `findForAccountBySessionId` + tests (user-scoped; another account → null)
- ✅ T5b.2 Purchase view + types + tests (mapping, nothing internal, BQ-B1) *(5b.1)*
- ✅ T5b.3 Purchases route: the **`sessionId` branch** (5b.1) and the **list branch** (5b.2: current mode only, newest first, default and maximum 50, owner view only, no-store) + tests
- ✅ T5b.4 Packages route: `purchaseAvailable` + `no-store` + tests
- ✅ T5b.5 Panel: Buy, one-checkout guard, embedded form, every error, Back, `SheetDescription` + tests
- ✅ T5b.6 (5b.2) Purchases list + tests (hidden at zero, every status, receipt link safety, business timezone, he / es / RTL, error and Try again, refresh on credit)
- ✅ T5b.7 Return notice + `UsageCard` mount + tests (each status, URL cleaned, bounded poll, signal raised)
- ✅ T5b.8 Strings; guards and registrations *(the 5b.1 strings and guards)*
- ✅ T5b.9 Run the bar, the UsageCard suites unedited, the figure guard, entitlements, `oneAddressPolicy` (Linux-path copy), scoped tsc (types-first); record in §6 *(5b.1)*
- ✅ T5b.10 Docs: requirement status, §7 (C-6) *(5b.2 updates §7 step 7)*

---

## 6. Test Plan

**Repository:** `findForAccountBySessionId` filters by `user_id` **and** session id, with an explicit column list; another account's session → `null`; a non-`cs_` id is refused with no query.

**Purchases route:**
- 401;
- 400 (bad `sessionId`, an unknown query key, `limit` 0 / 51);
- the list is current-mode only, newest first, with the exact key set of a view;
- the `sessionId` read of the owner's own row → the view; another owner's session → `{ purchase: null }`;
- the repository's `{ error }` → 500 with no details in production;
- no Stripe id, session id or flag reason in any answer.

**Packages route:** the four `purchaseAvailable` cases, `no-store`, and the flag read on the server only.

**Panel:**
- not available → disabled "Coming soon", `/checkout` never fetched;
- available → "Buy";
- a click → exactly one POST with `{ packageId }` and nothing else;
- a **double click** → still one POST;
- 200 → the embedded checkout mounted with the `clientSecret` (`@stripe/react-stripe-js` mocked);
- no publishable key → the friendly error, nothing mounted;
- each refusal code → its copy and no form;
- Back → the list again;
- the sheet has a description (N-2);
- RTL.

**Return notice:**
- no parameters → nothing;
- a malformed `session_id` → nothing and no fetch;
- a valid one → the URL is cleaned and the banner shown;
- each status → its copy;
- `credited` → the signal is raised and the poll stops;
- `processing` five times → the "still being confirmed" text and **no sixth read** (fake timers);
- `not_found` → the banner is removed;
- the notice never calls a write.

**Purchases list:** each status chip, the receipt link only when https, "excl. tax", "Bought", the business-clock date, error with Try again, hidden at zero purchases, he/es.

**Guards:** the new C-3 shape, `creditFigures` `SOURCES`, `enforcementPoints`; the four existing UsageCard suites unedited.

**Commands:** the scratch Jest configs with `--runTestsByPath`, and SA's types-first tsconfig for the `.tsx` files.

---

### 6.1 Results (Dev, 2026-10-08): 5b.1

| Run (scratch configs, `--runTestsByPath`) | Result |
|---|---|
| New suites: purchases route (`sessionId`), `boostPurchasesView`, the panel Buy flow (`BoostPackagesPanel.buy.render`), `BoostReturnNotice.render` | ✅ green |
| Changed suites: the packages route (C-2), `boostCheckoutAccess` (C-2), the checkout orchestrator and route (C-5), the repository (`findForAccountBySessionId`), the 5a panel render (two cases updated on purpose), `boostPackagesView` (the replaced C-3 guard), `creditUsageSignal.raiseSites` (the census gains the notice), `enforcementPoints`, `creditFigures` | ✅ green |
| **Broad set** (`--ci`): every boost suite, the boost routes, the webhook and billing suites, **all of `components/business-os/__tests__`** (the five UsageCard suites **unedited**), the `test:bos-entitlements` file set, `lib/audit`, `app/api/audit`, `formatMinorAmount`, `oneAddressPolicy` on a **Linux-path copy** (deleted after) | ✅ **251 suites, 6,628 tests, 100 snapshots** |
| Mutations | ✅ M1 single-flight guard removed → caught; M2 the `purchaseAvailable` check in `startCheckout` removed → caught (the source guard); M3 the poll bound removed → caught. All restored (byte-compared) |
| Scoped tsc, types-first (`tsconfig.5b.json`: every 5b.1 file, the routes, the panel, the notice, `UsageCard`, the guards) | ✅ **0 errors in 5b.1 files.** The 24 reported are the known `crm.task.*` duplicate keys in `LanguageContext.tsx` |

**Deviations from the plan (for SA code review):**
1. **The availability check is one helper,** `isBoostPurchaseAvailableFor(accountId, log)` in `boostCheckoutAccess.ts`, which calls `isBoostCheckoutOpenFor` and then the key-mode check (C-2). The packages route calls only the helper. The replaced guard pins both call sites: only the packages route (and the module itself) calls the helper; only the checkout route (and the module) calls `isBoostCheckoutOpenFor`.
2. **The refusal outcome type gains an optional `cap`,** set only for `cap_reached` (C-5). The route spreads `{ capMinor, windowDays }` into that answer only. `countedMinor` stays in the server log only.
3. **The return notice captures the parameters once per page load** (module state), so a StrictMode double mount does not lose it. It is cleared on any final answer, on Dismiss and when the poll ends.
4. **Poll delays are written in seconds** (`[2, 5, 10, 20, 40]` × 1000). The credit-figure guard scans the notice, and a literal `2000` (the trial allowance) tripped it.
5. **The notice raises `notifyCreditUsageChanged` once, on `credited`.** The signal's census test gains that site (deliberate).
6. **The 5a panel tests:** "every Buy disabled" now asserts no `title` (N-1), and the 5a "purchaseAvailable true still disabled" case became "enabled, reads Buy". The flow itself is in the new `.buy` suite.
7. **The purchases route without `sessionId` answers 400 in 5b.1.** 5b.2 turns that into the list.
8. **The `usage.boost.coming_soon_hint` string is no longer shown** (N-1). The key stays in the dictionary, unused, until a cleanup.

**QA's recommended tests R-1 to R-5 (Dev, 2026-10-08; tests only, no production code changed; the user approved 5b.1):**

| # | Added to | What it pins |
|---|---|---|
| R-1 | `packages/__tests__/route.test.ts` | The full key-mode availability matrix through the route (14 rows): test and live pairs, the switch unset or "false", the allow-list (without / with this account in upper case / malformed), the publishable key missing / empty / a secret key / the wrong mode, the server key missing, and a restricted `rk_test_` key. Each row answers `private, no-store` |
| R-2 | `BoostPackagesPanel.buy.render.test.tsx` | The cap line with an override ($300), odd cents and a short window ($125.50 in 7 days), and the plain line for the counted amount only, string figures or a zero-day window. Every reply also carries `countedMinor`, which never appears |
| R-3 | `BoostReturnNotice.render.test.tsx` | Reads at **2, 7, 17, 37 and 77 s** after landing (one-second steps), the "still confirming" line, no sixth read in the next 10 minutes; under `StrictMode` one poll sequence |
| R-4 | `purchases/__tests__/route.test.ts` | Nine refused queries (empty, empty id, `pi_`, a hyphen, a 191-character tail, an unknown mode prefix, extra `userId`, extra `limit`, an injection) → 400 with **no repository call**; a 190-character tail is the longest accepted |
| R-5 | `BoostPackagesPanel.buy.render.test.tsx` | Back, and closing then reopening the sheet: each unmounts the form, brings the list back, and allows exactly **one** more POST (even with a double click) |

- **QA5b-L1 / SA N-1** (Dismiss during the poll stops the poll and hides the notice; a later answer is not shown): **accepted by the user 2026-10-08**, behaviour kept as is.
- **Re-run:** the 5b.1 suites green. **Broad set** (`--ci`, the same 251 files): **251 suites, 6,661 tests, 100 snapshots**, including `oneAddressPolicy` on a Linux-path copy. **Types-first tsc:** 0 errors in 5b.1 files (the 24 known `LanguageContext` duplicate keys only).

### 6.2 The English strings the owner sees (5b.1)

| Where | Text |
|---|---|
| Buy button (available) | **Buy**; while starting: **Starting…** |
| Buy button (not available) | **Coming soon** |
| Checkout view | **← Back to packages**; summary "**Plus · 13,750 credits · $25 excl. tax**" (figures from the payload) |
| 409 `cap_reached` (with figures) | **You've reached the top-up limit for now ($150 in 30 days). Contact support if you need more.** |
| 409 `cap_reached` (no figures) | **You've reached the top-up limit for now. Contact support if you need more.** |
| 409 `awaiting_payment` | **Finish setting up your plan payment first.** |
| 403 `not_eligible` | **Top-ups aren't available for this account yet.** |
| 404 (switch off / unknown package) | **This package isn't available right now. Please reopen Top up.** |
| 500 / 502 / 503 / network / no client secret | **We couldn't start the payment. Please try again in a moment.** |
| 401 | **Please sign in again.** |
| No publishable key (defence in depth) | **Payments are not available right now.** |
| Return: just back | **Payment received — your credits will appear shortly.** |
| Return: credited | **Credits added.** |
| Return: still processing after about 77 s | **Your payment is still being confirmed. Your credits will appear here once it completes.** |
| Return: delayed method | **Your payment is processing. Some payment methods take a few days; your credits will be added when it completes.** |
| Return: failed | **The payment didn't go through. You weren't charged.** |
| Return: expired | **This checkout expired. You weren't charged.** |
| Return: flagged / disputed | **Payment under review. We'll be in touch if we need anything.** |
| Return: dismiss (screen reader) | **Dismiss** |

he / es drafts are in `LanguageContext.tsx` under `usage.boost.*`, for native review.

### 6.3 Results (Dev, 2026-10-08): 5b.2 "Purchases list"

**What was built:**
- **The purchases route's list branch.** `GET /api/business-os/credits/boost/purchases` without `sessionId` returns the signed-in owner's purchases:
  - the account from `getUser()`;
  - the current Stripe mode only (`isLiveMode(currentStripeMode())`; an unknown mode → 500);
  - newest first, `limit` 1–50 (default 50);
  - the owner view only;
  - `private, no-store`.

  The `sessionId` branch is unchanged. `limit` beside a `sessionId` is refused (400).
- **Reuse:** the repository's existing **`listForAccount`** (explicit columns, `.eq('user_id')`, `.eq('livemode')`, newest first, clamped limit, already unit-tested) is reused. No new repository method.
- **`BoostPurchasesList`** sits at the bottom of the package list in the Top up panel and renders nothing until there is at least one purchase. Each row shows:
  - name and a "Bought" tag, with the status chip on the other side;
  - the date in the business's timezone (`timeZoneOptions`), the credits, the price "excl. tax", and a Receipt link: https only, `target="_blank" rel="noopener noreferrer"`.

  It re-reads when the panel opens, on Try again, and on the credit-usage signal while open (so a purchase credited during a return shows at once).
- **Strings:** 13 new `usage.boost.purchases.*` keys in en/he/es (he/es drafts).
- **Guards:** `BoostPurchasesList.tsx` is added to `creditFigures` `SOURCES` and to the "never names the switch or the checkout" guard. No new entitlements importer: the route's registration is unchanged.
- **5b.1 tests updated on purpose:**
  - "no sessionId → 400" is removed (it is now the list);
  - the R-4 "an extra limit key" case became "a limit beside a sessionId";
  - two 5a panel tests now count the packages reads only, since the list adds its own read.

| Run | Result |
|---|---|
| New: the list branch (7 tests in the route suite), `BoostPurchasesList.render` (26) | ✅ green, three consecutive runs of the list suite |
| **Broad set** (`--ci`; every boost suite and route, the webhook and billing suites, all of `components/business-os/__tests__` with the five UsageCard suites unedited, the `test:bos-entitlements` set, `lib/audit`, `app/api/audit`, `oneAddressPolicy` on a Linux-path copy) | ✅ **252 suites, 6,695 tests, 100 snapshots** |
| Types-first tsc (`tsconfig.5b2.json`: the 5b files plus the list and its test) | ✅ 0 errors in 5b files (the 24 known `LanguageContext` duplicate keys only) |

**Deviations:**
1. `listForAccount` is reused instead of a new repository method; it already does exactly the scoped, ordered and limited read.
2. An unknown server Stripe mode answers 500 rather than an empty list, so a misconfigured environment does not look like "no purchases".
3. The list is rendered only in the package view, not beside the open payment form. Back, or reopening, re-reads it.
4. The chip for `awaiting_payment` reads "Pending" and the one for `processing` reads "Processing", as asked. A delayed payment method therefore shows "Pending" in the list, while the return notice keeps its longer explanation.

**The English strings:**

| Key | Text |
|---|---|
| Title | **Purchases** |
| Price | **{price} excl. tax** (e.g. "$25 excl. tax") |
| Credits | **{credits} credits** (the existing key, e.g. "13,750 credits") |
| Tag | **Bought** |
| Link | **Receipt** |
| Error | **We couldn't load your purchases.** + **Try again** |
| Status chips | credited **Credits added** · processing **Processing** · awaiting_payment **Pending** · failed **Didn't go through** · expired **Expired** · refunded **Refunded** · partially_refunded **Partly refunded** · under_review **Payment under review** |

**What the list looks like** (bottom of Top up, after the footer line; a thin divider, then):

```text
Purchases
Plus  [Bought]                                Credits added
Oct 8, 2026, 10:30 PM   13,750 credits   $25 excl. tax   Receipt
─────────────────────────────────────────────────────────────────
Starter  [Bought]                                 Processing
Oct 8, 2026, 10:05 PM   5,000 credits   $10 excl. tax
```

In Hebrew the sheet is RTL and opens from the left, so the chip sits on the left and the row reads right to left.

### 6.4 5b.2 after review (Dev, 2026-10-08): the user's decisions and QA's R-1 to R-4

The user approved 5b.2 (SA approved, QA PASS) with two decisions:

1. **The row date stays the checkout start (`createdAt`). Decided.**
2. **When the package catalogue fails to load, the Purchases list stays hidden, but the owner is told.** A second line sits under the existing packages error, only in that state:

| Language | Text (`usage.boost.purchases.unavailable`) |
|---|---|
| en | **Your purchases can't be shown right now either. Please check back later.** |
| he (draft) | גם את הרכישות שלך אי אפשר להציג כרגע. כדאי לבדוק שוב מאוחר יותר. |
| es (draft) | Tampoco podemos mostrar tus compras en este momento. Vuelve a consultarlo más tarde. |

There are no digits in any language. When the catalogue loads, the notice is absent, whether or not there are purchases.

**QA's tests, added:**
- **R-1:** a missing, garbage or empty server key → 500 with no read and no details; `sk_test_` / `rk_test_` → test rows, `sk_live_` → live rows (route suite).
- **R-2:** no Receipt link for `data:`, protocol-relative, empty, malformed or `ftp:` links.
- **R-3:** dates across the Asia/Jerusalem daylight-saving change on 25 Oct 2026 (01:30 AM, 02:30 AM) and across the year end (Jan 1, 2027, 12:30 AM).
- **R-4:** one read per open; the credit signal adds exactly one read while open and none after close.
- **The notice:** shown in en/he/es on a catalogue failure, inside the error block, with no purchases read; absent when the catalogue loads.

**A flake fixed (test only, in a 5b.1 test already on main):** QA 5b.1 R-3, "reads at 2, 7, 17, 37 and 77 seconds", steps fake timers 90 times through `act()`. Under the loaded broad run it once exceeded Jest's 5 s default. It now has an explicit 30 s budget; the time on the page is still faked.

**Re-run:**
- the 5b suites green, twice;
- the broad set (`--ci`, 252 files, including `oneAddressPolicy` on a Linux-path copy): **252 suites, 6,712 tests, 100 snapshots**, run twice after the timeout fix;
- types-first tsc (`tsconfig.5b2.json`): 0 errors in 5b files (the 24 known duplicate keys only).

## 7. The user's test purchase (after 5b is deployed)

Production Stripe is in **test mode**, so no real money moves. **Never set the flag on Preview** (the database is shared).

1. **Before:**
   - 4a's Stripe event subscriptions are in place (4a §7 step 2).
   - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is set on Vercel **Production**, and **its value starts with `pk_test_`** (SA C-6 a). Production's `STRIPE_SECRET_KEY` is `sk_test_…`. If the two keys are not in the same mode, the packages answer `purchaseAvailable: false` and Buy shows "Coming soon" (SA C-2), with one `bos_boost_publishable_key_mismatch` error in the logs.
2. **Vercel → Settings → Environment Variables → Production only** (SA C-6 b). For each variable below, **double-check that Preview (and Development) are unticked**; Preview shares the production database:
   - set `BUSINESS_OS_CREDITS_BOOST_TEST_ACCOUNTS` = your account id **first**;
   - then set `BUSINESS_OS_CREDITS_BOOST_ENABLED` = `true`;
   - **redeploy**.
3. **Sign in** as that account and open **Business OS** (the dashboard), then the credits card → **Top up**. Expected: the three packages, each with a **Buy** button (not "Coming soon").
4. **Buy "Plus".** Expected: the Stripe payment form opens inside the panel: $25.00, USD, no tax line added, no promotion-code box.
5. **Pay** with card **4242 4242 4242 4242**, any future expiry (e.g. 12/34), any CVC (123), any postal code.
6. **Back on the dashboard.** Expected:
   - the banner "Payment received — your credits will appear shortly";
   - within seconds, "Credits added.";
   - **Extra credits** on the card shows **13,750** (more if you already had extra credits);
   - the address bar no longer shows `boost=return`.
   - The notice asks about the payment for about **77 seconds** (reads at 2, 5, 10, 20 and 40 s), then says "Your payment is still being confirmed…" and stops asking (SA C-6 c). A slower payment still credits once the webhook arrives; **refresh the page** to see it. To try a delayed card, use **4000 0000 0000 3220** (3-D Secure: approve the test pop-up). It credits after confirmation.
7. **Top up again → Purchases.** Expected: today's date, "Plus", "13,750 credits", "$25 excl. tax", "Credits added", "Bought", and a **Receipt** link that opens Stripe's receipt.
8. **Optional failure check:** Buy → card **4000 0000 0000 0002** (declined). Expected: Stripe shows the decline inside the form; nothing changes on the card; no purchase is credited.
9. **Optional cap check:** buying past $150 in 30 days answers the "top-up limit" message, and no form opens.
10. **To switch boosts off again:** remove `BUSINESS_OS_CREDITS_BOOST_ENABLED` on Production and redeploy. The Buy buttons go back to "Coming soon".

**If credits do not appear after about a minute (and a refresh):** use 4a §7 step 6, the stuck-claim recovery statement. It applies **in test mode only**, to a purchase still `pending` or `awaiting_payment` (SA C-6 d). Real-money go-live still needs 4b (SA's go-live gate in 4a §7).

*(5b.2 merged = step 7 available. Before it, the purchase could only be checked in Supabase: `business_os_boost_purchases`, status `paid`, `receipt_url` filled.)*

---

## 8. Estimate, split and risks

| Item | Value |
|---|---|
| Estimate | **About 2.5 days**: panel and checkout 0.75 d; return notice and status read 0.5 d; purchases route, view and list 0.75 d; tests and docs 0.5 d |
| Split (proposed) | **5b.1 "Buy and return"** (T5b.1, 4, 5, 7 and their tests; about 1.5 d): the purchase works end to end, and the user can run §7 steps 1–6. **5b.2 "Purchases list"** (T5b.2, 3, 6; about 1 d): §7 step 7. 5b.1 is shippable alone. FR-26 is then met on 5b.2 |
| CI | Mocked suites in existing jobs; no new job |
| Entitlements | One new non-gate importer (the purchases route) |

| Risk | Mitigation |
|---|---|
| A double reservation (double click) | A ref-based single-flight guard; a test; the cap still bounds it server-side |
| A closed sheet leaves a pending reservation counted against the cap for 31 minutes | Accepted (slice 3 C-3); stated in Q-6 |
| An owner trusts the return page as proof of payment | The page only reads our row; the copy says "will appear shortly" until it is `credited` |
| A Stripe.js load failure | A friendly error; the server is unaffected |

---

## 9. Notes

| For | Note |
|---|---|
| 4b | The list already displays `refunded` / `partially_refunded` / `under_review` when 4b writes them |
| 6 | The admin view can reuse `BoostPurchaseView` plus its admin-only fields |
| Plan payments P-4 | A shared browser `loadStripe` helper could serve both P-4 and boost (Q-7) |

---

## 10. Questions for SA

| # | Question | Dev proposal |
|---|---|---|
| Q-1 | The return-status read needs the session id, which the owner column grant does not include. Service-role read scoped by `user_id` + session id (proposed), or a migration granting the column to `authenticated`? | The service-role, user-scoped repository method; no migration |
| Q-2 | A bounded poll on return (5 reads over about 77 s) versus a single read plus a manual refresh | The bounded poll; it stops on any final status |
| Q-3 | Where the Purchases list lives: at the bottom of the Top up panel (proposed; visible to every owner, loads with the panel), or beside the credit-history link (that link is behind a flag that is off in production) | The Top up panel |
| Q-4 | Names of retired packages: `listActive()` labels only (null → the id is shown), or add a `listAll()` to the catalogue seam | `listActive()` now (no package is retired in v1); `listAll()` when one is |
| Q-5 | `cap_reached` copy: today the checkout answer carries no figures. Add `{ capMinor, windowDays }` to the 409 answer (a slice 3 route change), or show the text without numbers | Add them to the 409 answer (small, server-sourced); otherwise no numbers |
| Q-6 | Closing the sheet mid-checkout leaves the reservation pending for up to 31 minutes (counted against the cap). Accept, or call `abandon` on Back? | Accept: `abandon` needs the Stripe session expired first (slice 3 C-2), which is more machinery than the case is worth |
| Q-7 | A shared `loadStripe` helper in `lib/client/` (for boost and the future P-4), or a module-level one in the panel like `PlanCheckoutPanel` | Local now; extract when P-4 needs it |
| Q-8 | Split 5b.1 / 5b.2 (§8), or one PR? | Split, so the test purchase can run sooner |

## Business questions

None. The UI placement (the Purchases list inside Top up) and the wording are shown to the user with the diff.

---

## SA Review Notes

### SA Workplan Review

**Reviewed by SA — 2026-10-08, against `e2813fca`**
**Status:** ✅ Approved with conditions (C-1 to C-6). The Dev writes them in first, and no second review is needed. **No user question.**

The design is right. The server stays the authority (`purchaseAvailable` comes from `isBoostCheckoutOpenFor`, and the checkout route still answers 404 when the flag is off). The return page only **reads** our row. There is no new dependency (the `PlanCheckoutPanel` embedded pattern is reused) and no migration. Verified: no Content-Security-Policy blocks `js.stripe.com` frames, `/business-os` is served and ignores query parameters, and the `@stripe/*` packages are present.

#### Conditions

| # | Severity | Condition |
|---|---|---|
| **C-1** | **Medium** | **The 5b.1 split must include the status read.** As listed, 5b.1 (T5b.1, 4, 5, 7) has the return notice but **not the route it polls** (T5b.3) or the view (T5b.2). Move into 5b.1: the purchases route's **`sessionId` branch**, `BoostPurchaseView` with its status mapping, and their tests. 5b.2 then adds only the list branch (no `sessionId`), `BoostPurchasesList` and the Top up panel section. |
| **C-2** | **Medium** | **Publishable-key mode must match the server key.** A missing key, or a `pk_live_` beside an `sk_test_` key (or the reverse), would show Buy and then fail inside Stripe's form. The **packages route** sets `purchaseAvailable` only when `isBoostCheckoutOpenFor(user.id)` **and** `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is present **and** its `pk_test_` / `pk_live_` prefix matches `currentStripeMode()`. Otherwise it answers `false` and logs `error` once, `bos_boost_publishable_key_mismatch`. The panel keeps its no-key fallback as defence in depth. Tests cover missing, mismatched and matching keys. |
| **C-3** | Low | **Q-1 shape (tenant-isolation-guard):** `findForAccountBySessionId(accountId, sessionId)` takes the account **only** from `getUser()` in the route, filters `.eq('user_id', accountId).eq('stripe_checkout_session_id', sessionId)` with an explicit column list, and returns `null` for another owner's session, a missing session or a malformed id (refused before any query). The response is the `BoostPurchaseView` only: no Stripe ids, session id, flag reason, livemode or lot id. A test pins the exact key set and the cross-owner `null`. |
| **C-4** | Low | **Single flight.** The ref guard stays set from the click until either the form mounts or the request fails, and is re-armed on Back. A test covers a double click across two microtasks. Server-side, the cap and the per-request reservation still bound any race. |
| **C-5** | Low | **Q-5 body:** add `{ capMinor, windowDays }` **only** to the 409 `cap_reached` answer, not `countedMinor`. These are server figures (`capMinor` reflects a per-account override). The panel formats the amount with `formatMinorAmount` and the window from the answer. Update the slice 3 route test. |
| **C-6** | Low | **§7 completions.** (a) Step 1 adds "check that the publishable key starts with `pk_test_`" (C-2 makes a mismatch show as Coming soon). (b) Step 2: the env vars are scoped to **Production only**; double-check that Preview is unticked. (c) Step 6 notes that the poll stops after about 77 s, and that a delayed card (e.g. `4000 0000 0000 3220` 3-D Secure) still credits once the webhook arrives. Then refresh. (d) The recovery link stays 4a §7 step 6, test mode only. |

#### Rulings on Q-1 to Q-8

| Q | Ruling |
|---|---|
| **Q-1** | **A user-scoped service-role read, no migration**, with C-3. |
| **Q-2** | **The bounded poll** (2/5/10/20/40 s), stopping on any final status. |
| **Q-3** | **At the bottom of the Top up panel**, visible to every owner, shown only when there is at least one purchase. |
| **Q-4** | **`listActive()` now.** A retired package shows its id. Add `listAll()` when the first package retires. |
| **Q-5** | **Yes**, with C-5. |
| **Q-6** | **Accept** the ≤ 31-minute pending reservation after a closed sheet. The cap stays bounded, and abandon-with-expire is not worth it. |
| **Q-7** | **Local `loadStripe`** in the panel. Extract it with P-4. |
| **Q-8** | **Split**, with C-1's correction. 5b.1 is a safe and complete step for the test purchase. |

#### The points asked

- **Allow-list authority:** only the packages route calls `isBoostCheckoutOpenFor`. The checkout route re-checks the flag and the list itself, so a tampered client still gets 404. **Preview** stays safe as long as the flag is never set there (C-6 b).
- **Double click:** one reservation (C-4).
- **Return route:** `/business-os` is served and ignores query parameters, so the notice is additive.
- **§7:** correct with C-6.
- **Business-clock dates, RTL, en/he/es, no figures typed:** as planned.

#### Approval

[x] Workplan approved with conditions C-1 to C-6. Proceed with 5b.1.

### SA Code Review (5b.1)

**Code Review by SA — 2026-10-08**
**Status:** ✅ **Code Approved for QA.** There are no must-fix items. Two notes follow (N-1, N-2), and neither blocks.

#### What I verified myself

| Check | Result |
|---|---|
| 19 suites: the new purchases route, view, notice and Buy suites; the packages and checkout routes; `boostCheckout` and its access; the repository; the 5a panel and view suites; the 5 existing UsageCard suites; the credit-signal census; `enforcementPoints`; `creditFigures` (JSX scratch config) | ✅ **599 passed** |
| Types-first `tsc` over every touched `.ts` / `.tsx` | ✅ **0 errors in the touched files.** The only errors are the 24 pre-existing duplicate keys in `LanguageContext.tsx`; none is a `usage.boost.*` key |
| Mutation M1: `findForAccountBySessionId` without `.eq('user_id')` | ✅ Caught (repository, 1 red) |
| Mutation M2: the double-click guard removed | ✅ Caught (`.buy` suite, 1 red) |
| Mutation M3: the publishable-key **mode** check reduced to "present" | ✅ Caught (access, 1 red) |
| Restoration after each mutation | ✅ SHA-1 checked |
| `console.*` in new or changed files; `package.json` | ✅ 0; unchanged (no new dependency) |

#### Conditions C-1 to C-6 and the Q rulings

| | Met? |
|---|---|
| C-1 5b.1 includes the status read | ✅ The purchases route (`sessionId` only; 400 without, deviation 7) and `BoostPurchaseView` with the status mapping ship in 5b.1 |
| C-2 key-mode match | ✅ `isBoostPurchaseAvailableFor` requires open-for **and** a `pk_test_` / `pk_live_` key whose mode equals `currentStripeMode()`. Otherwise `false`, with one `error` log `bos_boost_publishable_key_mismatch` (missing / unknown / mismatch). The panel keeps a no-key fallback. M3 proves it |
| C-3 tenant isolation of the status read | ✅ The account comes only from `getUser()`. The repository checks `assertUuid` / `assertSessionId` before any query, then `.eq('user_id').eq('stripe_checkout_session_id')` with an explicit column list. Another owner, a missing session or a malformed id → `{ purchase: null }`. The view excludes Stripe ids, the session id, the flag reason, livemode and the lot id. M1 proves it |
| C-4 single flight | ✅ The ref is held from the click until the form mounts, released on any failure, re-armed on Back and reset on every open. M2 proves it |
| C-5 the cap body | ✅ `{ capMinor, windowDays }` only on `cap_reached`; `countedMinor` stays in the server log. The panel formats it with `formatMinorAmount` |
| C-6 §7 | ✅ (§7) |
| Q-1 to Q-8 | ✅ As ruled |

#### The points asked

- **Buy authority:** `startCheckout` returns unless `payload.purchaseAvailable === true`, and the checkout route still re-checks the flag and the list (404 otherwise). ✅
- **The return notice:**
  - It never writes or credits; it only reads our row by session id, scoped by the server to the caller.
  - The session id must match `^cs_(test|live)_…`, or nothing is fetched.
  - The address is cleaned with `replaceState` before the first read.
  - The poll is bounded to 5 reads, then "still confirming", and stops on any final status.
  - **StrictMode** is handled by capturing once per page load (deviation 3): the second effect run reuses the captured id, and the cleanup cancels the first run's timer.

  ✅
- **Embedded checkout lifecycle:**
  - `EmbeddedCheckoutProvider` mounts only in the checkout view. Back sets `checkout` to null, which unmounts it. Closing the sheet unmounts `SheetContent`, and every open resets to the list.
  - A new Buy gets a new reservation, a new `clientSecret` and a fresh provider, so a secret is never changed on a live provider.
  - `loadStripe` is called once per page (module-level promise), so no Stripe.js instance leaks.

  ✅
- **The 5a behaviour holds:** focus returns to Top up (`onCloseAutoFocus` → `returnFocusRef`), Escape closes (Radix), the Hebrew side is `left` with `dir="rtl"` and the Back arrow flips, `SheetDescription` is present (N-2) and there is no `title` on the disabled Buy (N-1). ✅
- **Copy:** no raw codes are shown, and the cap message names the cap and window only, never the counted spend. ✅

#### §6.1 deviations: all eight accepted

#### Notes (no change required)

- **N-1:** Dismiss hides the banner, but the poll keeps running. A later `credited` read would show "Credits added." again. That is harmless, and arguably useful. If the UI review prefers it, Dismiss could also cancel the poll.
- **N-2:** after a final status, the captured id becomes `null` for the rest of the page's life. A second purchase in the same page would not show a notice. That cannot happen today: the embedded checkout's completion is a **full-page** navigation to the return URL, which reloads the module. Revisit it only if completion ever becomes in-place (`onComplete`).

#### Code Approved for QA: **Yes**

### SA Code Review (5b.2)

**Code Review by SA — 2026-10-08 (branch `feature/bos-credits-boost-slice-5b2`, off `031a2af3`)**
**Status:** ✅ **Code Approved for QA.** There are no must-fix items.

#### What I verified myself

| Check | Result |
|---|---|
| 11 suites: the new list render, the purchases route, the 5a and 5b.1 panel suites, the return notice, the UsageCard Top-up suite, the credit-signal census, both boost views, `creditFigures`, `enforcementPoints` | ✅ **317 passed** |
| Types-first `tsc` over every touched `.ts` / `.tsx` | ✅ **0 errors in the touched files.** The only errors are the 24 pre-existing duplicate keys in `LanguageContext.tsx`; none is a `usage.boost.*` line |
| Mutation M1: the list `limit` cap raised from 50 to 500 | ✅ Caught (route, 1 red) |
| Mutation M2: a non-https receipt link rendered | ✅ Caught (list render, 2 red) |
| Restoration after each mutation | ✅ SHA-1 checked |
| `console.*`; `package.json` | ✅ 0; unchanged |

#### The points asked

- **Tenant isolation:** the account comes only from `getUser()`. The list reuses `listForAccount(user.id, { livemode, limit })`, which is `.eq('user_id')` plus `.eq('livemode')`, an explicit column list and newest first. The response is `BoostPurchaseView[]`, with the exact key set pinned by the view test (no Stripe ids, session id, flag reason, livemode or lot id). Another owner's rows cannot appear. ✅
- **Query validation:** the Zod object is `.strict()`. `limit` must be an integer from 1 to 50. `sessionId` and `limit` together → 400. Unknown keys → 400. An unknown Stripe mode → 500, never an empty list (deviation, accepted: an empty list would hide a misconfiguration). `no-store` is on every answer. ✅
- **Receipt link:** https only, both server-side (the view) and client-side (`new URL().protocol`), with `target="_blank" rel="noopener noreferrer"`. M2 proves it. ✅
- **Dates and time zone:** `timeZoneOptions` from `LanguageContext`, the same business-clock path the credit history uses. **When `user_preferences.timezone` is NULL** (not asked yet), `LanguageContext` falls back to `'UTC'` (`useState('UTC')` and `safeTimezone`), so purchase times show in UTC. That is the platform-wide display behaviour today, not something 5b.2 introduces. The NULL-vs-`'UTC'` distinction CLAUDE.md requires is kept **in storage** and is the readiness gate's concern; a display fallback does not write it. Accepted. ✅
- **No figures typed:** credits come from the payload through `Intl`, prices through `formatMinorAmount`, and the strings use placeholders. The `creditFigures` guard has the list in `SOURCES`. ✅
- **RTL:** inherited from the sheet's `dir`; the strings are present in en, he and es. ✅
- **Refetching:** on open, on `onCreditUsageChanged` while open, on Try again, and on remount when returning to the package view after Back (the list lives only in the package view, deviation accepted). The fetch is aborted on close. There is no timer or poll. ✅
- **5b.1 is unchanged:** the Buy, return-notice and UsageCard suites pass. The only intended change to the 5b.1 contract is that "no `sessionId` → 400" becomes the list. ✅

#### §6.3 deviations: all accepted

- Reusing `listForAccount`.
- An unknown Stripe mode answers 500, not an empty list.
- The list shows only in the package view.
- Pending and Processing are distinct chips.

#### Note (no change required)

- **N-1:** time zones. An owner who has never set a time zone sees UTC times in the list, as in the credit history. If that reads oddly in the UI review, the fix belongs to the shared time-zone gap prompt (`journeyReadiness`), not to this list.

#### Code Approved for QA: **Yes**

**SA re-check of the 5b.2 follow-ups (2026-10-08, diff only):** ✅ still Code Approved. When the catalogue fails, the `usage.boost.purchases.unavailable` notice sits inside the packages error block; the copy is static, in en/he/es, has no digits and creates no new data path. QA tests R-1 to R-4 pass. The 30 s budget on the return-notice test bounds real time only; fake timers still drive the 2–77 s schedule. 156 tests re-run green.

## QA Testing Report

### QA — 5b.1 (2026-10-08)

**Verdict:** ✅ **PASS.** Two notes, one Low and one Info, need no change before the PR.

All of the following held under mocks:
- the availability matrix;
- one POST per intentional start;
- every refusal message;
- the form's lifecycle;
- the owner-scoped status read and its key set;
- the bounded return poll;
- focus and RTL;
- no writes from the notice.

**Test mode:** full
**Strategy used:** A + B (Jest, jsdom; `@stripe/stripe-js` and `@stripe/react-stripe-js` mocked; no real Stripe, no Supabase, no dev server). Two scratch suites live in the session scratchpad and are **not committed**:
- `qa/server5b.qa.test.ts`: 41 tests;
- `qa/ui5b.qa.test.tsx`: 52 tests.

Two more source mutations of my own, each restored and SHA-1 checked.
**Focus:** api, ui, a11y, security (tenant scope, owner payload)
**Skipped:**
- a real browser: the embedded Stripe form itself, layout and scroll are left to the user's §7 test purchase;
- `oneAddressPolicy` (Linux-path copy, run by the Dev).

**Input source:** coordinator brief + workplan §3, §6, §7

#### Commands run

| Check | Result |
|---|---|
| Broad set (JSX scratch config, `--ci`):<br>• all of `app/api/business-os/credits/boost/**`;<br>• `lib/business-os/boost/__tests__`;<br>• **all of `components/business-os/__tests__`** (the 5 UsageCard suites **unedited**: empty `git diff`);<br>• `lib/business-os/entitlements/__tests__`;<br>• every `app/api/stripe/webhook/__tests__` suite;<br>• the repository test;<br>• `formatMinorAmount` | ✅ **79 suites, 2,178 tests, 100 snapshots passed** |
| Types-first tsc (`tsconfig.5b.json`) | ✅ **0 errors in 5b.1 files.** The 24 errors are the known `TS1117` duplicate keys; every `usage.boost.*` key occurs exactly 3 times (en/he/es), and none is a duplicate |
| QA server suite | ✅ 41 / 41 |
| QA UI suite | ✅ 52 / 52, with two observations below |
| Mutations | ✅ (Q1) The key-mode check bypassed (`return true`) → **5 red** (access + packages route). (Q2) The return notice keeping a `null` purchase polling → **1 red**. Both restored, SHA-1 identical |
| `console.*` | ✅ None in the panel, the notice, the purchases route or the view |
| Source untouched | ✅ The SHA-1 of the 26 non-doc files and the `git status --porcelain` output match the pre-QA snapshot |

#### Test matrix

| Area | Result | Notes |
|---|---|---|
| Availability (C-2), via the real packages route | ✅ | **true:** all good (`pk_test_` + `sk_test_`); all good (`pk_live_` + `sk_live_`); own id (upper-cased) on the allow-list; a restricted key `rk_test_` with `pk_test_`. **false:** flag unset or `false`; not on the list; a malformed list; publishable key missing, empty, or actually an `sk_` key; **`pk_live_` with a test secret**; **`pk_test_` with a live secret**; secret key missing. Always `private, no-store`; `?purchaseAvailable=true` in the query is ignored; the mismatch log never contains either key value |
| Buy state | ✅ | Not available → all "Coming soon", disabled, and clicks send nothing. Available → "Buy" |
| Single flight (C-4) | ✅ | Two clicks in one tick, another after a microtask, then clicks on the other two packages → **1 POST**, body exactly `{"packageId":"plus"}`, every Buy disabled, the chosen one reads "Starting…". After Back, one new click → exactly one more POST (`{"packageId":"max"}`). After any refusal the guard re-arms, and the next click is one more POST |
| Form lifecycle | ✅ | 200 → the embedded checkout mounts; the summary reads "Plus · 13,750 credits · $25 excl. tax". **Back unmounts the provider** (unmount counted). Closing the sheet mid-checkout and reopening → the form is gone, the list shows, and one more POST is allowed. Closing **while the POST is in flight** and reopening: the buttons stay disabled (`Starting…`), so no second POST; the first answer then opens its form (acceptable, as it is the purchase the owner started) |
| Refusal messages (20 cases) | ✅ | **cap with figures** → "…($150 in 30 days)…"; an **override cap** 30000 → "$300"; 12550 / 7 → "$125.50 in 7 days". Cap without figures, with `countedMinor` only, with string figures, or with `windowDays: 0` → the plain cap line (**the counted spend never appears**). `awaiting_payment`, `not_eligible`, and 404 (flag off or `unknown_package`) → "isn't available… reopen Top up" **plus a packages re-read**. 401 → "Please sign in again." 500, 502, 503, network, non-JSON, a 200 without or with an empty `clientSecret`, and a 200 `success:false` → the generic line. No raw code is ever shown, and no form mounts |
| Languages | ✅ | he cap: "…( 150 $ ב-30 ימים)…"; es cap: "…(150 US$ en 30 días)…". The Back arrow flips (`→` in he), and the summary is localised ("25 $ לא כולל מס", "13.750 créditos · 25 US$ sin impuestos") |
| No publishable key | ✅ | The checkout view shows "Payments are not available right now." and nothing mounts |
| Focus and RTL (5a QA5a-D1) | ✅ | From the Credits card, in en **and he**: open → Buy → the form is mounted → Escape → the dialog closes and **focus returns to Top up**. In he the sheet is on the left (`data-side="left"`) with `dir="rtl"` |
| Status read (C-3) | ✅ | 401 signed out with no repository read. **400 before any read** for: no `sessionId`, an empty value, `pi_1`, a hyphen, 191+ characters, `cs_other_`, extra keys (`userId`, `limit`), a quote. The repository is called with **the session user's id** and the session id. Own row → exactly 13 keys (`createdAt, creditsBonus, creditsTotal, currency, id, kind, name, packageId, paidAt, priceMinor, receiptUrl, status, taxExclusive`); the body never contains the session id, payment intent, charge id, flag reason, lot id, livemode or retail version. Statuses: pending→processing, abandoned→expired, flagged / disputed / dispute_lost→under_review, paid→credited, and the rest unchanged. Missing or another owner's → `{purchase:null}`. A repository error → 500 with no details in production. Always `no-store` |
| Repository read | ✅ | Exactly `.from('business_os_boost_purchases').eq('user_id', account).eq('stripe_checkout_session_id', id)`, with an explicit column list. A bad account uuid, a `pi_` id or a null input → `{ error }` with **no query** |
| Return notice: params | ✅ | No params, `boost=other`, or `session_id` without `boost=return` → nothing and no read. `boost=return` with a missing, empty, `<script>`, `;drop`, `pi_` or 200+ character `session_id` → the URL is cleaned, nothing is shown, no read, no crash |
| Return notice: poll | ✅ | Valid id → the URL is cleaned (another query param and the hash are kept) and "Payment received…" is shown. Reads at **t = 2, 7, 17, 37 and 77 s** (2/5/10/20/40), then "still being confirmed", and **no 6th read** after 10 more minutes. 500 and 401 replies keep the same bounded five reads, with no crash. **StrictMode** double mount → one sequence (1 read at 2 s, 5 in total). Unmount mid-poll → no further read. Only `GET` reads are made |
| Return notice: outcomes | ✅ | `awaiting_payment`, `failed`, `expired` and `under_review` → each its message, the poll stops, no signal. `credited` → "Credits added.", **`notifyCreditUsageChanged` exactly once**, hidden after 8 s, no further read. `null` / `refunded` → the banner is removed. Every return key exists in he and es; Dismiss has the accessible name "Dismiss" |

#### Issues Found

##### Bugs

None blocking.

##### Edge Cases / Info

1. **QA5b-L1 (Low, UX; same as SA N-1): Dismiss hides the banner, but the poll continues and a later final answer shows it again.**
   - Steps to reproduce: return with `processing`, click ×, and the next read answers `credited`.
   - Observed: the banner reappears as "Credits added." (`data-state="credited"`) for 8 s.
   - It is harmless; the card refresh it triggers is useful. If the UI review wants Dismiss to be final, Dismiss could cancel the timers but still refresh the card on a later `credited`.
2. **I-1 (Info):** closing the sheet while the checkout POST is in flight, then reopening, opens that checkout's form once the answer lands. Buy stays disabled meanwhile, so there is no second reservation. This is the purchase the owner started, so it is acceptable.

#### Recommended additions

| # | Test | Where | Priority |
|---|---|---|---|
| R-1 | The full availability matrix (`pk_live_` + test secret, `pk_test_` + live secret, an `sk_` value in the publishable variable, a missing secret) through the packages route | packages route test | Should |
| R-2 | The cap message with an override (`capMinor` 30000) and with `countedMinor` only (plain line, no figure) | `.buy` render test | Should |
| R-3 | The poll's exact read times (2, 7, 17, 37, 77 s) and no 6th read; StrictMode → one sequence | notice render test | Nice |
| R-4 | Status read: 400 for extra query keys (`userId`, `limit`) and 191+ characters, with no repository call | purchases route test | Nice |
| R-5 | Back unmounts the provider; closing the sheet mid-checkout and reopening → the list, one more POST | `.buy` render test | Nice |

#### Test Outputs / Logs

```text
Broad set:  Test Suites: 79 passed, 79 total   Tests: 2178 passed, 2178 total   Snapshots: 100 passed, 100 total
QA server:  Tests: 41 passed  (all good test/live true; flag off, not listed, pk_live+sk_test, pk_test+sk_live, missing keys false)
QA UI:      Tests: 52 passed
  he cap: הגעת למגבלת הרכישות לעת עתה ( 150 $ ב-30 ימים). אפשר לפנות לתמיכה אם צריך יותר.
  es cap: Alcanzaste el límite de recargas por ahora (150 US$ en 30 días). Contacta con soporte si necesitas más.
  in-flight then reopen: buttons disabled after reopen = true ; POSTs = 1 ; form mounted = true
  right after the 2nd read, banner = credited   (after Dismiss)
Mutations:  key-mode bypass -> 5 failed | null purchase keeps polling -> 1 failed | both RESTORED (SHA-1)
Scoped tsc: 24 x TS1117 (pre-existing duplicate keys, none usage.boost.*), 0 in 5b.1 files
```

#### Final Status
- [x] The 5b.1 acceptance criteria pass. Ready for the user's diff review and the §7 test purchase (Production only, `pk_test_`, Preview unticked). The two notes need no change.
- [ ] Issues found that the Dev must address before commit

### QA — 5b.2 (2026-10-08)

**Verdict:** ✅ **PASS.** No defects; three Info notes. QA confirmed:
- the list route is owner-scoped, mode-scoped and strictly validated;
- the Purchases list renders, localises and refreshes as specified;
- the receipt link is https-only;
- the 5b.1 status read is unchanged.

**Test mode:** full
**Strategy used:** A + B (Jest, jsdom; Stripe mocked; no Supabase, no dev server). Two scratch suites live in the session scratchpad and are **not committed**:
- `qa/server5b2.qa.test.ts`: 36 tests;
- `qa/ui5b2.qa.test.tsx`: 38 tests.

Two more mutations of my own, each restored and SHA-1 checked.
**Focus:** api, ui, security (tenant scope, owner payload, link safety)
**Skipped:** a real browser (layout is left to the user's §7 step 7); `oneAddressPolicy` (Linux-path copy, run by the Dev).
**Input source:** coordinator brief + workplan §6.3

#### Commands run

| Check | Result |
|---|---|
| Broad set (JSX scratch config, `--ci`):<br>• all of `app/api/business-os/credits/boost/**`;<br>• `lib/business-os/boost/__tests__`;<br>• all of `components/business-os/__tests__` (the UsageCard suites unedited: empty `git diff`);<br>• `lib/business-os/entitlements/__tests__`;<br>• the repository test;<br>• `formatMinorAmount` | ✅ **69 suites, 1,972 tests passed** |
| Types-first tsc (`tsconfig.5b2.json`) | ✅ 0 errors in 5b files. Only the 24 known `TS1117` duplicate keys remain; each of the 13 `usage.boost.purchases.*` keys appears exactly 3 times |
| QA server suite | ✅ 36 / 36 (two runs, identical) |
| QA UI suite | ✅ 37 / 38. The one red is a test artefact: my expected "00:30" for a 12-hour English clock, where the rendered "12:30 AM" is correct |
| Mutations | ✅ (Q1) The list route's `livemode` pinned to `false` → **1 red** (route). (Q2) An empty list rendered (`length === 0` check removed) → **2 red** (list render). Both restored, SHA-1 identical |
| `console.*` | ✅ None in the list or the route |
| Source untouched | ✅ The SHA-1 of the 9 non-doc files matches the pre-QA snapshot; `git status` is unchanged |

#### Test matrix

| Area | Result | Notes |
|---|---|---|
| Route: auth | ✅ | 401 signed out, with no repository read |
| Route: owner and mode scope | ✅ | `listForAccount` is called with **the session user's id** and `livemode` from the server key: `sk_test_` / `rk_test_` → `false`, `sk_live_` → `true`. A missing, empty or garbage key → **500 with no read** and no details. The repository itself issues `.eq('user_id').eq('livemode').order('created_at', desc).range(0, limit-1)` with an explicit column list, and clamps a limit of 500 to 200 |
| Route: limit | ✅ | Default 50. `1`, `7` and `50` are accepted. `0`, `51`, `-1`, `1.5`, `abc`, empty, `1e2` and a duplicate `limit` → **400 with no read**. `limit` with `sessionId`, and `userId`, `accountId`, `livemode` or `offset` → 400 with no read (Info I-1: a URL-encoded leading space before a digit is coerced) |
| Route: payload | ✅ | `data` holds exactly `purchases`; each item has exactly the 13 view keys. The repository order is preserved (newest first). A retired package → `name: null` with its id. A flagged row → `under_review`. **No** session id, payment-intent, charge or dispute id, flag reason, lot id, livemode or retail version anywhere. `http:` and `javascript:` receipts from the database → `null`. Empty → `{purchases: []}`. A repository error → 500 with no details. Always `no-store` |
| Route: `sessionId` branch | ✅ | Unchanged. The six malformed cases → 400 with no read. Own row → the view, read with the session user's id. Missing → `{purchase:null}`. The list is never read on this branch |
| List: visibility | ✅ | Closed (`open={false}`) → **no read**, nothing rendered. Zero purchases → nothing rendered (no title, no empty state) |
| List: status chips | ✅ | credited "Credits added", processing "Processing", awaiting_payment "Pending", failed "Didn't go through", expired "Expired", refunded "Refunded", partially_refunded "Partly refunded", under_review "Payment under review" |
| List: row (en) | ✅ | Heading "Purchases"; "Plus" + "Bought"; "13,750 credits"; "$25 excl. tax"; "Receipt" with `href` exactly the https URL, `target="_blank"`, `rel="noopener noreferrer"` |
| Receipt safety | ✅ | **No link** for `http:`, `javascript:`, `data:`, malformed, null, empty or protocol-relative `//evil.com`. A link for `HTTPS://…` (upper case is a valid https URL) and for `" https://x.com"` (the URL parser trims the space; the server filter would already null this one) |
| Retired package | ✅ | `name: null` → the package id "mega_2025" is shown |
| Dates and timezone | ✅ | Business timezone `Asia/Jerusalem`, across the 25 Oct 2026 DST change: `2026-10-24T22:30Z` → "Oct 25, 2026, 01:30 AM" (+03); `2026-10-25T00:30Z` → "Oct 25, 2026, 02:30 AM" (+02); `2026-12-31T22:30Z` → Jan 1, 2027, 12:30 AM. A NULL timezone (the provider's `UTC` fallback, SA N-1) → "Oct 24, 2026, 10:30 PM" |
| he / es | ✅ | he: "פלוס", "נרכש", "הקרדיטים נוספו", "8 באוק׳ 2026, 22:30", "13,750 קרדיטים", "25 $ לא כולל מס", "קבלה", title "רכישות"; inside the panel the list sits in the `dir="rtl"` sheet. es: "Comprado", "Créditos añadidos", "8 oct 2026, 22:30", "13.750 créditos", "25 US$ sin impuestos", "Recibo", title "Compras" |
| Error states | ✅ | A 500, a network error, a 200 with `success:false`, one malformed row (`status:'paid'`), an EUR row, fractional credits, or a bad date → "We couldn't load your purchases." + Try again, **never an empty list**. Try again → one more read, then the list |
| Credit signal | ✅ | While open, `notifyCreditUsageChanged` → **exactly one** extra read. After closing, the signal → no read |
| Request storm | ✅ | 5 open/close cycles of the panel → 5 purchases reads and 5 packages reads (one each per open); none while closed |
| With the payment form | ✅ | Buy → the form mounts and **the Purchases section is gone**. Back → it reappears, with one re-read (1 → 2) |
| Strings | ✅ | 13 `usage.boost.purchases.*` keys, present in en/he/es, with no digit in any (figures are placeholders) |

#### Issues Found

##### Bugs

None.

##### Info

- **I-1:** `?limit=%205` (a leading space) is coerced to 5 by `z.coerce.number()`. It is harmless (still 1–50).
- **I-2:** the list sits inside the package view, so when the **packages** read fails (catalogue down) the Purchases section is not shown either (0 purchases reads). An owner then cannot see past purchases until the catalogue is back. This is acceptable for v1; if wanted, mount the list outside the package-view condition.
- **I-3:** each row shows `createdAt` (when the checkout started), not `paidAt`. For a delayed payment method the date is the day the purchase began. That matches the plan ("the date"), and is noted for the UI review.

#### Recommended additions

| # | Test | Where | Priority |
|---|---|---|---|
| R-1 | The list route with a missing or garbage server key → 500 with no read; `sk_live_` → `livemode: true` | purchases route test | Should |
| R-2 | Receipt edge cases: `data:`, protocol-relative, malformed → no link | list render test | Nice |
| R-3 | The business-timezone date across the DST change (Asia/Jerusalem, 25 Oct 2026) | list render test | Nice |
| R-4 | Five open/close cycles → one read per open; the credit signal after close → no read | list or panel render test | Nice |

#### Test Outputs / Logs

```text
Broad set:  Test Suites: 69 passed, 69 total   Tests: 1972 passed, 1972 total
QA server:  Tests: 36 passed (two runs)        QA UI: 37 passed + 1 test-artefact red (12-hour clock expectation)
  Asia/Jerusalem: 'Oct 25, 2026, 01:30 AM', 'Oct 25, 2026, 02:30 AM'
  he ["פלוס","נרכש","הקרדיטים נוספו","8 באוק׳ 2026, 22:30","13,750 קרדיטים","25 $ לא כולל מס","קבלה"] | title: רכישות
  es ["Plus","Comprado","Créditos añadidos","8 oct 2026, 22:30","13.750 créditos","25 US$ sin impuestos","Recibo"] | title: Compras
  5 opens -> purchases reads: 5 packages reads: 5 | reads before buy 1 after back 2 | catalogue down: purchases shown = false
Mutations:  livemode pinned false -> 1 failed | empty list rendered -> 2 failed | both RESTORED (SHA-1)
Scoped tsc: 24 x TS1117 (pre-existing), 0 in 5b files
```

#### Final Status
- [x] The 5b.2 acceptance criteria pass (FR-26, BQ-B1). Ready for the user's diff review and §7 step 7. No change required.
- [ ] Issues found that the Dev must address before commit

## Commit Info

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-08 | Created | Slice 5b workplan against `e2813fca` (after #259). Buy for allowed accounts (`purchaseAvailable` from the server-side access check, `no-store`), Stripe's embedded checkout inside the Top up panel (existing packages, no new dependency), every checkout refusal mapped, a return notice that only reads our row (bounded poll), and the owner Purchases route and list (FR-26, BQ-B1). The user's test-purchase steps are in §7. About 2.5 days; split 5b.1 / 5b.2 proposed. Eight SA questions; no business question |
| 2026-10-08 | SA workplan review: approved with conditions | C-1: 5b.1 must include the purchases route's `sessionId` branch and the view (the notice polls it). C-2: `purchaseAvailable` also requires a publishable key whose mode matches the server key. C-3: the user-scoped status read shape. C-4: single flight. C-5: `{capMinor, windowDays}` only on the 409. C-6: §7 completions (`pk_test_` check, Production-only scope, the delayed-card note). Q-1 to Q-8 ruled. No user question |
| 2026-10-08 | SA approved with conditions; 5b.1 implemented; Code Complete | C-1 to C-6 applied (§3.0). Built: `purchaseAvailable` from the server (the switch, the allow-list and matching Stripe keys), `no-store`; Buy → one checkout → Stripe's embedded form in the panel, with every refusal mapped (the cap figures added to the 409); the return notice with a bounded read of the owner's own purchase (the `sessionId` branch of the new purchases route, the owner view); strings in en/he/es; guards replaced and registered. 251 suites / 6,628 tests green with the UsageCard suites unedited; 3 mutations caught; 0 tsc errors in 5b.1 files. 5b.2 (the Purchases list) next. Nothing committed |
| 2026-10-08 | SA code review (5b.1): Code Approved for QA | 599 tests green; types-first tsc 0 in the touched files. Mutations caught: the status read losing its user scope, the double-click guard removed, the key-mode check reduced to presence. C-1 to C-6 met; deviations 1–8 accepted. Notes N-1 (Dismiss does not stop the poll) and N-2 (one notice per page load) need no change |
| 2026-10-08 | QA (5b.1): PASS | Broad set 79 suites / 2,178 tests / 100 snapshots green (UsageCard suites unedited); types-first tsc 0 in 5b.1 files. QA scratch suites (41 server + 52 UI, Stripe mocked) cover:<br>• the availability matrix (flag, allow-list, missing or mismatched `pk_` / `sk_` modes → false; matching → true; `no-store`);<br>• one POST per intentional start (double clicks, microtasks, Back);<br>• 20 refusal messages (cap with and without figures, override, never the counted spend);<br>• Back and closing the sheet unmount the form;<br>• focus returns to Top up in en and he;<br>• the owner-scoped status read: exact 13 keys, nothing internal, cross-owner null, malformed → 400 before any read;<br>• the return notice: URL cleaned, reads at 2/7/17/37/77 s then stop, every final status, one card refresh, StrictMode, garbage ids, GET only.<br>Two mutations caught. QA5b-L1 (Low, same as SA N-1): Dismiss does not stop the poll. No change required |
| 2026-10-08 | QA R-1 to R-5 added; QA5b-L1 accepted | The user approved 5b.1 (SA approved, QA PASS). Tests only: the availability matrix (R-1), cap lines including an override and counted-only answers (R-2), the 2/7/17/37/77 s read times and StrictMode (R-3), the status read's refused queries (R-4), Back and close unmounting the form with one more POST allowed (R-5). QA5b-L1 / SA N-1 (Dismiss stops the poll) accepted by the user as is. 251 suites / 6,661 tests / 100 snapshots green; 0 tsc errors in 5b.1 files. Nothing committed |
| 2026-10-08 | 5b.1 approved and committed, PR #264 open | The user saw the diff and approved the commit (2026-10-08). RM committed on `feature/bos-credits-boost-slice-5b` and opened [PR #264](https://github.com/AgentsPilot/neuronforge/pull/264) to `main`. After deploy the user runs the test purchase (§7). 5b.2 is next |
| 2026-10-08 | 5b.1 merged (#264); 5b.2 implemented; Code Complete | The Purchases list: the purchases route's list branch (current mode only, newest first, at most 50, owner view only, reusing `listForAccount`) and a Purchases section at the bottom of Top up, shown only after the first purchase. It has the business-clock date, name, Bought, credits, price excl. tax, a status chip and an https-only Receipt link; en/he/es, RTL; it re-reads on open, Try again and when credits change. 252 suites / 6,695 tests / 100 snapshots green; 0 tsc errors in 5b files. Nothing committed |
| 2026-10-08 | SA code review (5b.2): Code Approved for QA | 317 tests green; types-first tsc 0 in the touched files. Mutations caught: the limit cap raised, a non-https receipt rendered. Tenant isolation, strict query, `no-store`, https-only receipts with `noopener noreferrer`, no typed figures and RTL all verified. A NULL time zone displays as UTC, as platform-wide (N-1, no change) |
| 2026-10-08 | QA (5b.2): PASS | Broad set 69 suites / 1,972 tests green (UsageCard suites unedited); types-first tsc 0 in 5b files. QA scratch suites (36 server + 38 UI) cover:<br>• the list route: owner and mode scope from the session and the server key (unknown key → 500 with no read), limit 1–50 with every bad value and `limit` + `sessionId` → 400 with no read, the exact 13-key view with nothing internal, `no-store`, a repository error → 500, the `sessionId` branch unchanged;<br>• the list: hidden when closed or empty, all 8 chips, https-only receipts (no link for http / javascript / data / malformed / protocol-relative) with `target` and `rel`, the retired-package id, business-timezone dates across the Israel DST change and the UTC fallback, he / es / RTL, the error with Try again, exactly one re-read on the credit signal, one read per open, hidden behind the payment form and back after Back.<br>Two mutations caught. No defects; Info I-1 to I-3 |
| 2026-10-08 | 5b.2 after review: decisions and QA tests | User approved 5b.2 (SA approved, QA PASS). Decided: the row date is the checkout start; on a catalogue failure the purchases stay hidden with the notice "Your purchases can't be shown right now either. Please check back later." (en/he/es, no digits). QA R-1 to R-4 added, plus the notice tests. A 5b.1 poll-timing test given a 30 s budget (it timed out once under load). 252 suites / 6,712 tests / 100 snapshots green twice; 0 tsc errors in 5b files. Nothing committed |
| 2026-10-08 | SA re-check of the 5b.2 follow-ups: still Code Approved | Purchases-unavailable notice on a catalogue failure (static en/he/es copy, no digits); QA R-1 to R-4; a 30 s real-time budget on the fake-timer return-notice test. 156 tests green |
| 2026-10-08 | 5b.2 approved and committed, PR #267 open | The user saw the diff and approved the commit (2026-10-08). RM committed on `feature/bos-credits-boost-slice-5b2` and opened [PR #267](https://github.com/AgentsPilot/neuronforge/pull/267) to `main` |
