# Workplan: Money MK-5b, Converted this month

> **Last Updated**: 2026-10-20

**Developer:** Dev
**Requirement:** [ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md](/docs/requirements/ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md) §12 MK-5b; §5 F-K5b row; §5.1 (F-K5b definition, G-1 to G-4, "New read"); Q-12 (accepted); SA-RR-MK SA-10 and the pins table (MK-5b: AC-145, one ruled update); FIN BD-9, BD-37, BD-49, BD-52; PAY SR-6
**Branch:** `feature/admin-money-mk5b-converted-this-month` (from main `f87eccda`; MK-5 and MK-0a merged)
**Date:** 2026-10-20
**Status:** Code Approved (SA-CR-MK5B), QA passed; committed `4747c281`, PR [#485](https://github.com/AgentsPilot/neuronforge/pull/485) opened 2026-10-20, auto-merge on
**Path:** full cycle (one new bounded read, payload change, one ruled AC-145 update). No migration.

## Overview

F-K5 "Paying accounts" gains a small second figure, **Converted this month** (leading). It counts the accounts that are paying now **and** whose first plan payment above $0, in the current Stripe mode, was paid in the current UTC calendar month. The figure has its own "Leading" pill. The Plans & subscriptions tab gains the **Converted this month** list: business, plan, date of first payment, where it came from, and the accounts that converted this month but no longer pay.

---

## 1. Code facts (at `f87eccda`)

| # | Fact | Where |
|---|---|---|
| CF-1 | Every paid plan invoice is a `business_os_billing_events` row: `kind = 'invoice_paid'`, with `livemode`, `amount_minor`, `paid_at`, `user_id` | `supabase/migrations/20261027_business_os_billing_events.sql` |
| CF-2 | **Boosts never write a billing event.** They are `business_os_boost_purchases` rows, so `kind = 'invoice_paid'` alone already leaves them out (PAY SR-6). `amount_minor > 0` leaves out a $0 invoice | same migration; `BusinessOsBoostPurchaseRepository` |
| CF-3 | `BusinessOsBillingAdminReadRepository` is the one mode-filtered admin billing reader. It has two reads, both of `business_os_billing_accounts`, and its own test pins its `.from(` list | `lib/repositories/BusinessOsBillingAdminReadRepository.ts` and its test |
| CF-4 | The R4 pattern: `lib/admin/billing/*` decides the mode, and `financeHealthDeps.ts` wires a function by name, so the finance tree never names a mode | `currentModeBillingStatus.ts`, `financeHealthDeps.ts` |
| CF-5 | F-K5 is `payload.paying`, built from the plan walk and the current-mode paying set. Platform accounts are left out | `financeHealth.ts:771-791` |
| CF-6 | The lineage `source` is `admin_invite`, `account_invite` (a friend invite) or `organic`. An account may have no lineage row (G-2). The existing batched lineage read has a pinned single caller (C-7) | migration `20261014`; `BusinessOsAccountLineageRepository.ts`; `BusinessOsPaymentVisibilityReads.test.ts` |
| CF-7 | The Plans & subscriptions tab renders from the finance payload (Plan mix) plus its own subscriptions fetch. The F-K5 tile is a link (`<a>`), so a second pill cannot sit inside it | `FinanceView.tsx`, `KpiStrip.tsx` |

## 2. Design

### 2.1 The new read (SA-10)

**`BusinessOsBillingAdminReadRepository.listFirstPlanPaymentsForAccounts(accountIds, livemode, opts?)`** returns `{ user_id, paid_at }[]`: the earliest qualifying payment of each given account that has one.

- **Filter:** `.from('business_os_billing_events')`, with `kind = 'invoice_paid'`, `livemode = <mode>`, `amount_minor > 0`, `paid_at` not null, and `user_id IN (<chunk>)`.
- **Chunking:** ids are checked as UUIDs, lower-cased and de-duplicated, then split into chunks of at most **100**.
- **Paging:** each chunk is keyset-paged on `id`, at most **1,000** rows per request.
- **Ceiling:** reaching the ceiling (all chunks together, default 20,000) is an **error**, never a partial answer.
- **Isolation:** the read is limited to the given ids by `.in('user_id', chunk)`. As a defence, a returned row whose `user_id` was not asked for is an **error**, never kept.
- **Bad data:** an unparseable `paid_at` is an error, never skipped, so an earlier payment can never be hidden.
- **Logging:** counts only, never an id.

**`lib/admin/billing/firstPlanPayments.ts`, `listCurrentModeFirstPlanPayments(accountIds)`** resolves the current mode (`currentStripeMode`) and calls the read. It returns `{ accountId, paidAt }[]`; the mode never travels on. An unknown key mode fails closed.

**`BusinessOsAccountLineageRepository.findSignupSourcesForAccountsForAdmin(accountIds)`** is new and select-only. It returns `account_id, source, first_paid_at`, for at most 200 UUIDs. Its doc carries INTENTIONAL SERVICE-ROLE and names its caller.
- **Why a new method:** the existing batched read has one pinned caller (C-7), so it is not reused.
- **Use:** only the "where it came from" column, and `first_paid_at` as a cross-check (counted in the log, never shown).

### 2.2 The builder

`FinanceHealthDeps` gains an **optional** `converted` dep: `{ firstPlanPayments(ids), signupSources(ids) }`.
- `financeHealthDeps()` wires it.
- The snapshot wiring picks deps explicitly, so it never calls it.
- Absent means no `converted` key, so builder tests written before MK-5b are unchanged.

**The read runs after the plan walk and the paying read**, because it needs their ids:
- **All businesses:** every non-platform plan-row account. That is F-K5's denominator, so "converted, no longer paying" can be found.
- **A business picked:** exactly that id.

**The pure rule is `convertedThisMonth.ts`.** "This month" is `[first day of now's UTC month, first day of next month)` (BD-9). It is always this month, whatever window is picked.

| First payment this month? | Paying now? | Result |
|---|---|---|
| Yes | Yes | **Converted**: counted in the figure, listed |
| Yes | No | **Converted, no longer paying**: listed, not counted |
| No, or none | — | Not converted |

**Payload `converted`** (in the builder, after `paying`):
- **All businesses:** `{ scope: 'all', status, month, converted, paying, stopped, rows, shownLimit }`.
  - `status` is `ok`; or `partial` when the plan walk is capped (counts are "at least"); or `unknown` when the plan, paying or first-payment read failed, or the ceiling was reached. **Never 0.**
  - `rows`: at most 100, newest first payment first. Names come from `findNames` and the source from the lineage read, for the shown rows only.
- **A business picked:** `{ scope: 'one', status, month, state: 'converted' | 'stopped' | 'not_converted' | null, firstPaidAt }`.

**Log line:** `counts.converted` holds the status, the account and row counts, the shown count, sources found and cross-check differences. Counts only.

### 2.3 Display

**F-K5 tile.** With a `converted` key in the payload:
- **All businesses:** the tile's `detail` is "Converted this month: 2 of 9 paying". When cut off: "Converted this month: at least 2, of at least 9 paying". When the read failed: "Converted this month: Unknown".
- **A business picked:** §5.1 says nothing about this case, so the tile shows that business's yes or no, and this is a recorded decision. The words are "Converted this month: Yes", "Yes, no longer paying", "No" or "Unknown".
- **The pill:** a "Leading" `KpiIndicator`. Its tooltip is `FINANCE_KPIS.converted.definition`, the §5 definition plus "always the current calendar month in UTC, whatever window the page shows" (the tile says so).
  - It is placed in a `relative h-full` wrapper around the tile, at the bottom-right, beside the figure. It is outside the link (interactive content cannot sit inside an `<a>`).
  - The shared `KpiTile` is not edited.
- **Without a `converted` key** the tile renders exactly as before, so Pin B and Pin A hold.

**Plans & subscriptions tab.** A new `ConvertedThisMonthSection`, from the **same finance payload**. The tab makes no new request, and AC-173 still gives one fetch on load.
- **Position:** between Plan mix and Subscriptions.
- **Table:** Business, Plan, First payment (UTC), Came from, Status.
  - "Came from": Friend invite, Admin invite, Organic; "Not recorded" when the account has no lineage row (G-2); "Unknown" when the lineage read failed.
  - Status: a chip, "Paying" or "Converted, no longer paying".
- **States:**
  - Empty: "No account paid for a plan for the first time this month."
  - Cut off: an "at least" notice.
  - Read failed: the section's could-not-load state.

**Mode wording.** No mode wording appears in `lib/business-os/finance/**` or `app/admin/finance/**`. The mode is decided only in `lib/admin/billing`.

## 3. Files to Create / Modify

| File | Action | Reason |
|------|--------|--------|
| `lib/repositories/BusinessOsBillingAdminReadRepository.ts` | modify | The new read (SA-10) |
| `lib/repositories/BusinessOsAccountLineageRepository.ts` | modify | The select-only source read |
| `lib/admin/billing/firstPlanPayments.ts` | create | Current-mode wiring (R4 pattern) |
| `lib/business-os/finance/convertedThisMonth.ts` | create | The pure rule |
| `lib/business-os/finance/financeTypes.ts` | modify | `FinanceConverted`, `FinanceConvertedRow` |
| `lib/business-os/finance/financeHealth.ts` | modify | The optional dep, the read, the payload key, the log counts |
| `lib/business-os/finance/financeHealthDeps.ts` | modify | Wires `converted` |
| `app/admin/finance/financeCopy.ts` | modify | One copy constant per text |
| `app/admin/finance/components/FinanceKpiStrip.tsx` | modify | The figure and its pill |
| `app/admin/finance/components/ConvertedThisMonthSection.tsx` | create | The list |
| `app/admin/finance/components/FinanceView.tsx` | modify | Mounts the list on the Plans tab |
| Tests (§4) | create/modify | — |
| `app/api/admin/business-os/finance/__tests__/route.test.ts` | modify | AC-145 ruled update |

## 4. Tests

### 4.1 Repository method (`BusinessOsBillingAdminReadRepository.test.ts`)

| # | Case |
|---|---|
| R-1 | **Filter:** one query reads `business_os_billing_events` with `select('id, user_id, paid_at')`, `eq('livemode', mode)`, `eq('kind', 'invoice_paid')`, `gt('amount_minor', 0)`, `not('paid_at', 'is', null)`, `in('user_id', ids)`, ordered by `id`, `limit(1000)` |
| R-2 | **Current mode only:** `true` and `false` pass through as asked, and a mode that is not a boolean is refused before any query |
| R-3 | **Chunking:** 250 ids give 3 chunks of 100, 100 and 50, and no chunk is over 100 |
| R-4 | **Paging:** a page of exactly 1,000 asks for the next page after the last `id`, inside the same chunk |
| R-5 | **Ceiling:** reaching the ceiling across chunks is `AdminBillingReadCeilingError`, with `data` null |
| R-6 | **Earliest:** several payments per account give the earliest `paid_at` only, and accounts with none are absent |
| R-7 | **$0 and boosts:** the query carries `gt('amount_minor', 0)` and `eq('kind', 'invoice_paid')`. As a planted control, a fake that ignores the filter would return a $0 row, and the filter args make that row unreachable. The source pins that this method reads no boost table |
| R-8 | **Isolation:** a returned row for an id not asked for is an error, never kept. A non-UUID id is refused before any query. An empty list makes no query |
| R-9 | **Bad data:** an unparseable `paid_at` is an error |
| R-10 | **Logging:** a DB error is returned, never thrown, and logs counts only, with no ids |
| R-11 | **Source:** the `.from(` list is now accounts, accounts, events, and every read filters `livemode` (this file's own source test, updated) |

### 4.2 Other tests

- **`firstPlanPayments.test.ts`:**
  - the mode is resolved and passed;
  - an unknown mode makes no read;
  - the reader error is passed on;
  - the mapping is field by field.
- **Lineage repository:** the new method's limit, UUID check, columns and error handling.
- **`convertedThisMonth.test.ts`, the pure rule:**
  - the month bounds;
  - converted;
  - "converted, no longer paying" (listed, not counted);
  - last month not counted;
  - the sort;
  - the cap.
- **Builder (`financeHealth.test.ts`):**
  - all businesses: the ids passed are the non-platform plan rows;
  - `ok`, `partial` and `unknown` (plan, paying, first-payment and ceiling failures);
  - one business: exactly its id, and each state;
  - absent dep means no key.
- **UI:**
  - the strip: the detail text for each state and the "Leading" pill with the definition; no key means the tile is unchanged;
  - the list: rows, sources ("Not recorded", "Unknown"), the stopped chip, empty, partial and unknown.
- **AC-173:** the Plans tab still makes only the subscriptions request; there is no converted request.
- **Route AC-145, the one ruled update:**
  - `converted` is added to the expected keys, and the new read joins the expected calls;
  - a new hash, with before and after recorded;
  - with `converted` stripped, the payload gives MK-5's `a13f1ccd…`.

## 5. Task List

- ✅ Step 1: The repository read, with tests R-1 to R-11
- ✅ Step 2: The lineage source read, with tests
- ✅ Step 3: `lib/admin/billing/firstPlanPayments.ts`, with tests
- ✅ Step 4: The pure rule and types, with tests
- ✅ Step 5: The builder and wiring, with tests
- ✅ Step 6: The strip figure and pill, the list, and the view
- ✅ Step 7: The AC-145 ruled update
- ✅ Step 8: The runs listed in the task, and the pins

## Implementation Notes

**Built as designed (§2).** The deviations and recorded decisions are listed here.

### Recorded decisions and deviations

| # | Item | Why |
|---|---|---|
| D-1 | **A business picked:** F-K5 shows "Converted this month: Yes", "Yes, no longer paying", "No" or "Unknown" | §5.1 says nothing for the picked case (the task's instruction) |
| D-2 | **A second new read:** `BusinessOsAccountLineageRepository.findSignupSourcesForAccountsForAdmin`, select-only, at most 200 UUIDs | The "where it came from" column needs the lineage `source`, and the existing batched read has a pinned single caller (C-7). It is called for the shown rows only (at most 100). **SA to confirm** |
| D-3 | **Two own-repository tests updated:** the billing admin repository's `.from(` list (accounts, accounts, **events**; mode filter 2 to 3) and the lineage repository's method list (4 to 5) | Each repository's self-description, which must change when a method is added. **These are not ruled pins** |
| D-4 | **The F-K5 pill sits outside the tile.** `FinanceKpiStrip` wraps F-K5 in one more `relative h-full` box, and the "Leading" pill is that box's child at `bottom-2 right-2` | Kept outside the link, so the shared `KpiTile` is not edited and the F-5 source guard (one import line, five `<KpiTile`) holds |
| D-5 | **The month label** ("October 2026") is read from the ISO text of the month's start | The DF-6 guard bans the word for a zone in Finance files, so `toLocaleDateString` with a zone option is not used |
| D-7 | **Fields renamed for the P5-C4 guard.** The billing-event date is `firstPaymentAt`, because it is not the lineage stamp. The lineage repository maps `first_paid_at` to `stamped_at` itself | `firstPaymentStamp.guard.test.ts` keeps the stamp's names inside its known readers. The first full gate caught it, and the guard is not edited |
| D-6 | **The `converted` dep is optional.** Without it the payload has no `converted` key and `counts.converted` is absent | Every builder and page fixture written before MK-5b stays valid. Production always wires it |

### AC-145, the one ruled update

The update is in `app/api/admin/business-os/finance/__tests__/route.test.ts`:
- `mockDeps.converted` added, so `allReads()` covers it;
- the expected calls gain `converted.firstPlanPayments: [[[ACCOUNT]]]` and `converted.signupSources: []`;
- `converted` added to the expected keys, after `paying`.

| Hash | Value |
|---|---|
| Payload, before | `a13f1ccd7a95db60cce67bccc0df7450290b3162506b6e06f50edac3016f0060` (MK-5), still asserted with `converted` stripped |
| Payload, after | `23a12c7ebd13e5549b1ed8926e108289f504de1a57dc841413bcd68c4b862069` |
| File (LF), before → after | `ff387500` → `d980a389` |

The 200 key list gains `converted`. Four MK-5b route cases are added below the baseline.

### Other pins: all unchanged

All hashes are LF-normalised file hashes.

| Pin | Hash |
|---|---|
| Pin A | `98cadff3` |
| Pin B | `a1b3db0c` |
| AC-173 file and helper | `3a1a2dd4`, `b84e0c96` |
| Pin C and helper | `98ea0507`, `02813360` |
| Pin D | `1f7cf07a` |

**AC-173:** the Plans tab renders the list from the finance payload, so there is no new request. The page test pins exactly 2 requests: finance once and subscriptions once.

### Runs (after D-7)

| Run | Result |
|---|---|
| `app/admin/finance` | 23 suites, 808 tests |
| `lib/admin/billing` | 5 suites, 72 tests |
| `lib/business-os/finance` | 21 suites, 2,104 tests |
| `lib/repositories` | 113 suites, 2,742 tests |
| Finance route | 2 suites, 131 tests |
| `app/admin/components` | 26 suites, 878 tests |
| Vocabulary, layout, range-cap and contrast guards, plus the 5 pins | 9 suites, 799 tests |
| `test:authz-guard` | 203 tests |
| `test:bos-entitlements` | 301 suites, 9,151 tests |
| `lint:hooks` | 0 problems |
| Scoped tsc | 377 files, including 8 touched tests: 0 errors. The canary gave TS2322, and the file was restored byte-identical |
| Full gate | 20 suites and 140 tests failed, the same set as the Windows baseline |

### SA-CR-MK5B follow-ups

| # | Item | State |
|---|---|---|
| Low | Rename `payingRows` to `planRows` in `financeHealth.ts`. It holds the non-platform plan rows, F-K5's denominator. Behaviour is unchanged | ✅ Done. No test named the variable. AC-145 is still `23a12c7e` |
| MK5B-FU-1 | **The first-payment read asks about every plan-row account.** It makes one request for each 100 ids (more with paging), so its cost grows with the account count. Rework it when there are more than 1,000 accounts. Options include reading only the paying accounts plus this month's payers, a this-month `paid_at` filter with an earlier-payment check, or a server-side "first payment per account" view | ⬜ Recorded, not fixed (SA). Also in FIN §0.4 |

### Logging

There are no `console.*` calls in any touched file.

## SA Review Notes

### SA Code Review (MK-5b)

**Code Review by SA, 2026-10-20. Reviewed: the uncommitted tree on `feature/admin-money-mk5b-converted-this-month` (from main `f87eccda`).**
**Status: Code Approved (SA-CR-MK5B).** No blocking condition. One scale follow-up and one Low tidy.

#### Deviation rulings

- **D-2 (a second new read, a new pattern): approved.** `BusinessOsAccountLineageRepository.findSignupSourcesForAccountsForAdmin` is the right shape:
  - **Select-only** (`account_id, source, first_paid_at`).
  - **Isolated by its argument:** `.in('account_id', ids)` with every id UUID-checked.
  - **Bounded:** at most `LINEAGE_LOOKUP_LIMIT` (200) ids, so at most 200 rows, under the 1,000-row cap. It is called only for the ≤ 100 rows shown.
  - **Errors are returned, never thrown**, through `safeDbError`.

  Reusing the existing batched read would add a second caller to its **pinned single-caller** contract (C-7), which guards the invite write path. A separate admin-only read keeps that pin honest. This follows the existing `…ForAdmin` precedent (`findAdminIdentitiesByUserIds`). It is not a new architectural pattern: it is one more read-only method.
- **D-3 (two repository self-description tests): ordinary tests, not frozen pins.** Each repository's own method and `.from(` lists must grow when a method is added. None of the seven pins or AC-145 is involved.
- **D-7 (renames for the first-payment stamp guard): approved.** The billing-event date is `firstPaymentAt` (not the lineage stamp), and the lineage repository maps `first_paid_at` to `stamped_at` inside itself. `firstPaymentStamp.guard.test.ts` holds **unedited**.
- **D-1, D-4, D-5, D-6:** approved.
  - D-4: the pill is the shared `KpiIndicator`, outside the link.
  - D-5: the month label is built from ISO text, with no zone word (DF-6 guard).
  - D-6: production always wires the optional dep.

#### Verified

| Item | Result |
|---|---|
| SA-10 read | ✅ `listFirstPlanPaymentsForAccounts` is on `BusinessOsBillingAdminReadRepository`. It takes `.in()` chunks of ≤ 100 ids (sorted, de-duplicated), keyset on `id` at ≤ 1,000 per page, with `>=` ceiling → error. It **refuses a row for an account not asked** (`AdminBillingReadIsolationError`). It selects only `id, user_id, paid_at`, and is wired through `lib/admin/billing/firstPlanPayments.ts`, which resolves the mode there (the R4 pattern) |
| Current mode only | ✅ `.eq('livemode', …)` from `currentStripeMode`; an unknown key gives an error, so the figure is Unknown |
| $0 and boosts excluded | ✅ `.eq('kind', 'invoice_paid')`, `.gt('amount_minor', 0)` and `paid_at` not null. Boosts live in another table and are never read |
| "Converted, no longer paying" | ✅ The read asks **every non-platform plan-row account** (`financeHealth.ts:826`, `:853`), not just those paying now. An account that converted this month and stopped is therefore found and listed as `stopped`, never counted (`convertedThisMonth.ts`; test `:2750`) |
| UTC calendar month | ✅ `currentUtcMonth(now)` = `[1st of now's UTC month, 1st of next)`, independent of the page window |
| Never 0 when unknown | ✅ A failed read, an unknown mode or a missing paying set gives `status: 'unknown'` and null figures. A capped plan walk gives `partial` ("at least") |
| One fetch (AC-173) | ✅ The figure and the list ride the finance payload. There is no new page request, and AC-173 and its helper are unchanged |
| Mode allow-list | ✅ `lib/business-os/finance/**` names no mode (SA grep finds nothing). The mode is decided in `lib/admin/billing` |
| One pill constant | ✅ The "Leading" pill is the shared `KpiIndicator` with `FINANCE_KPIS.converted.definition` (LL-4); F-K5 itself stays lagging |
| Pins | ✅ AC-145 `a13f1ccd` → `23a12c7e` is the one ruled update. SA recomputed the rest unchanged: AC-173 `3a1a2dd4`, its helper `b84e0c96`, Pin A `98cadff3`, Pin B `a1b3db0c`, Pin C `98ea0507`, its helper `02813360`, Pin D `1f7cf07a` |

#### Follow-up and tidy (not blocking)

- **MK5B-FU-1 (scale).** The first-payment read asks every plan-row account, so its requests grow with the account count: 100 ids per request, sequential (about 1 request today; about 50 at 5,000 accounts, each a PostgREST round trip). **Trigger:** plan rows above 1,000, or `durationMs` on the finance line rising. **The better shape at that point:** first read **this month's** `invoice_paid > 0` events in the current mode (a small set), then check "first ever" only for those accounts with the same method.
- **Low (naming).** In `financeHealth.ts:826`, `payingRows` now holds the **plan rows** (the denominator, after MK-5 C-1), not billing rows. Rename it to `denominatorRows` or similar in the next touch, so it is not misread as the paying set.

#### Code Approved for QA: Yes

## QA Testing Report

**QA — 2026-10-20** (worktree `neuronforge-finance-m8`, branch `feature/admin-money-mk5b-converted-this-month` on `f87eccda`, uncommitted; source stable since 14:14, before every run below)
**Test mode:** full
**Strategy used:**
- **A + B:** every suite and guard, each run alone.
- **Two temporary, untracked QA probes, deleted afterwards** (`git status` is clean of `zz_*`):
  - **(1) The repository, end to end.** A fake Supabase client that **really applies** the query's `eq` / `gt` / `not` / `in` / `order` / `limit` to seeded billing-event rows. The real `BusinessOsBillingAdminReadRepository` runs on it, then `listCurrentModeFirstPlanPayments`, then `convertedThisMonth`.
  - **(2) The UI:** the real `FinanceKpiStrip` and `ConvertedThisMonthSection` with `user-event`.
- **Layout:** the strip's real HTML, compiled with the repo's Tailwind 4 and measured in **headless Chrome** at 1168px, 852px and 452px content widths.
- A wide scoped tsc with a canary.

**Focus:** api, ui, security (isolation)
**Skipped:** a live signed-in page (user, below).
**Input source:** prompt + workplan

**Verdict: PASS. No bugs.** One performance note, which extends SA's MK5B-FU-1, and one copy nit.

### Behaviour

| Item | Result | Evidence |
|---|---|---|
| F-K5 shows "Converted this month: n of m paying" | ✅ | Probe 2: "Converted this month: 2 of 9 paying" as the tile's detail line. 0 is shown as "0 of 9 paying" (a real zero, read OK). m is F-K5's own `paying.paying`, and n counts only accounts that are both in the plan-row set and in the paying set, so n ≤ m by construction |
| A "Leading" pill with the right tooltip | ✅ | Probe 2: the pill text is exactly `Leading`. The accessible name is "Leading indicator. " + `FINANCE_KPIS.converted.definition`. The tooltip carries the definition **word for word** ("Of the accounts paying now, how many paid us for a plan for the first time this month. Always the current calendar month in UTC, whatever window the page shows.") plus "Leading indicator: it tells you early what is coming". F-K5's own pill stays `lagging`. The new pill has no `<a>` ancestor; a click opens it and does not navigate. Tab order is the tile link, then the Lagging pill, then the Leading pill. Escape is consumed only while open (a window listener sees 0 calls, then 1) |
| Layout of the second pill | ✅ | Chrome at all three widths: the two pills never overlap each other, and neither overlaps any tile text (label, value, sub, the converted line). The Leading pill sits inside the box's bottom-right corner. **Both tooltips open below the box** (top = box bottom + 8px) and never cover the tile. **All 5 tiles stay one size** (211×186, 268×170, 211×186), and the tile fills the extra box |
| Counted: paying now **and** first plan payment above $0 in the current UTC month, whatever the window | ✅ | Probe 1, now = 2026-10-20, live mode. Converted: **A** (first payment Oct 5), **C** (test-mode Sept, first **live** Oct 2), **H** (exactly `2026-10-01T00:00:00Z`) and **I** (`2026-09-30T23:30-01:00`, which is Oct 1 00:30 UTC). `converted = 4`, sorted newest first. Re-running the rule with a September `now` gives a different set (B, D, G), so only `now` decides, never the page window (`currentUtcMonth` → `[2026-10-01, 2026-11-01)`) |
| Excluded: boosts | ✅ | The read touches only `business_os_billing_events` (every probe request's table). Boosts are a separate table and never write a billing event (PAY SR-6); the kind filter is `eq(kind, invoice_paid)`. In the probe, **E** (only `refunded` and `subscription_updated` rows in October) gets **no** first payment |
| Excluded: $0 invoices | ✅ | **B:** a $0 invoice on Oct 3 and $49 on Sept 15 gives a first payment of **Sept 15**, so B is not converted. **K:** a negative amount is excluded (`gt(amount_minor, 0)`) |
| Excluded: a first payment in the other Stripe mode | ✅ | **D:** live first payment in September and a **test** payment in October, in live mode: not converted. In test mode the same data reads only test rows (C, D), with `eq(livemode,false)` on the request. An unknown mode makes **no request** and returns an error |
| Excluded: a first payment in a previous month | ✅ | **G:** first payment `2026-09-30T23:59:59Z`, then again Oct 12: not converted (the earliest wins). **J:** `invoice_paid` with a null `paid_at` is ignored |
| Converted but no longer paying: listed, not counted | ✅ | **F:** first payment Oct 10, not in the paying set. It is in `accounts` with `payingNow: false`, `stopped = 1`, and **not** in `converted`. The read asks every non-platform **plan-row** account, not just those paying now, so F is found. The list shows the chip "Converted, no longer paying" |
| List columns | ✅ | Probe 2: the headers are exactly Business, Plan, First payment, Came from, Status. A row reads "Acme Dental · Essentials · 2026-10-05 10:00 UTC · Friend invite · Paying". With no plan group it shows "Unknown plan"; with a missing name, "No business name (44444444…)". The subtitle reads "…first plan payment was in October 2026 (UTC). Always this month, whatever window is picked." |
| Sources | ✅ | `account_invite` → **Friend invite**, `admin_invite` → **Admin invite**, `organic` → **Organic**. No lineage row → **Not recorded**. A failed lineage read → **Unknown** (exact order checked in probe 2) |
| Ceiling or read failure: "at least" or Unknown, never 0 | ✅ | Tile: **partial** gives "Converted this month: at least 2, of at least 9 paying"; **unknown** gives "Converted this month: Unknown", and no "Converted this month: 0" appears. List: partial shows the "at least" notice and "At least 4 converted and paying · At least 1 …"; unknown shows the section's "Could not load this section" with **Try again**, with no table, no empty state and no "0 converted". Empty and OK reads "No account paid us for a plan for the first time this month." Builder: a ceiling error, a failed first-payment read, a failed plan read or a failed paying read each give `unknown` (Dev's tests, all green) |
| A business picked: the tile shows that business's state | ✅ | Probe 2, all four states: "Converted this month: Yes", "Yes, no longer paying", "No" and "Unknown". The tile is not a link (no tab target). The route lower-cases `accountId` and refuses platform ids before the builder, so the one-id read cannot mis-match on case |
| Exactly one fetch on load (AC-173) | ✅ | AC-173 file `3a1a2dd4` and helper `b84e0c96` are unchanged and green. Dev's page test pins the Plans tab at **2 requests** (finance once, subscriptions once, as before MK-5b): the list renders from the finance payload |
| Repository: chunks at 100, pages at 1,000 | ✅ | Probe 1, with 250 ids plus 5 upper-case duplicates: de-duplicated to 250, then the `in()` sizes are **100, 100, 50**, never above 100. Every request has `limit(1000)`. A chunk holding 2,700 rows gives 3 requests (1,000, 1,000, 700), the 2nd and 3rd keyset `gt(id, last)`, so 5 requests in total. The earliest `paid_at` per account is kept. `pageSize: 1001` and `ceiling: 20001` are refused before any request |
| Repository: the ceiling is an error | ✅ | `{pageSize: 2, ceiling: 5}` gives `AdminBillingReadCeilingError`, with `data: null` (never a partial list) |
| Repository: isolated to the given ids | ✅ | A stray row for an id not asked for gives `AdminBillingReadIsolationError`, `data: null`. A non-UUID (`x' or 1=1`) is refused with **0 requests**; an empty list makes 0 requests and returns `[]`. A row for an id that was never asked for never enters the result, even with a matching month. An unreadable `paid_at` is an error, never skipped. The error and warn logs carry the method and error type only, **no account id** (seen in the probe output) |
| Lineage source read | ✅ | Select-only (`account_id, source, first_paid_at`), at most 200 UUIDs, refused otherwise; called for the ≤ 100 shown rows only (Dev's tests; SA D-2) |
| Mode never named in the finance tree | ✅ | `finance.source.guard` and the app finance `source.guard` are green; the mode is decided in `lib/admin/billing/firstPlanPayments.ts` |

### Pins (LF-normalised)

| Pin | Expected | Got |
|---|---|---|
| AC-145 payload `EXPECTED_SHA256` | `23a12c7e…2069` (ruled) | ✅ asserted. `AFTER_MK5_SHA256 a13f1ccd…0060` is asserted with `converted` stripped; route suite green |
| Pin A / Pin B | `98cadff3` / `a1b3db0c` | ✅ unchanged |
| AC-173 file / helper | `3a1a2dd4` / `b84e0c96` | ✅ unchanged |
| Pin C / helper | `98ea0507` / `02813360` | ✅ unchanged |
| Pin D (`m5WordingOnly.pin.test.ts`) | `1f7cf07a` | ✅ unchanged |

Doc note (Low): the Implementation Notes record the `route.test.ts` file hash as `ff387500 → d980a389`. The file on disk now hashes **`b5ca95dd`**: it was edited at 13:46, after that note (the D-7 pass). The ruled payload hash is the pin and it holds. Dev should update the recorded file hash.

### Suite runs (each alone)

| Suite | Result |
|---|---|
| `app/admin/finance` | 23/23, **808/808** |
| `lib/admin/billing` | 5/5, **72/72** |
| `lib/business-os/finance` | 21/21, **2104/2104** |
| `lib/repositories` | 113/113, **2742/2742** |
| Finance route (AC-145) | 2/2, **131/131** |
| `app/admin/components` | 26/26, **878/878** |
| Guards: vocabulary, contrast, layout folder (C-14), range-cap, first-payment stamp (P5-C4), finance source (lib and app), USD copy | 8/8, **2250/2250** |
| `npm run test:authz-guard` | 2/2, 203/203 |
| `npm run test:bos-entitlements` | 301/301, **9151/9151** |
| `npm run lint:hooks` | exit 0 |

All counts match Dev's.

**Wide scoped tsc:**
- Scope: `app/admin/finance/**`, `app/admin/components/**`, `app/api/admin/business-os/finance/**`, `lib/business-os/finance/**`, `lib/admin/billing/**` and `lib/repositories/**`. That is 784 app and lib files with their imports, every touched file included.
- The canary in `firstPlanPayments.ts` gave `(62,7) TS2322`. The file was restored with `cp` and checked with `cmp` (identical).
- The clean run gives **0 errors in any file this branch touches or adds**. The 56 errors it reports are all pre-existing, in 16 untouched files pulled in through `lib/repositories` imports (for example `StripeInvoiceService.ts`, `WebsiteBlockEnrichmentService.ts`, `hubspot-plugin-executor.ts`).

### Issues Found

**Bugs:** none.

**Performance (should fix, at MK5B-FU-1's trigger).** This adds to SA's MK5B-FU-1. The read pulls **every historical** `invoice_paid` row of every plan account (accounts × months of renewals), only to keep the earliest per account. So besides the request count SA notes, the **20,000-row ceiling** is reached at, for example, about 1,700 paying accounts after a year of monthly invoices. Past that point the figure is **Unknown** every time (correctly never 0, but permanently). SA's proposed shape fixes both: read this month's events first, then check "first ever" for those accounts only. Add "the finance line's `counts.converted.status` is `unknown` with a ceiling error" as a second trigger.

**Edge cases (nice to fix, Low):**
1. **Copy nit:** with partial counts, the list's count line reads "At least 4 converted and paying · **At least** 1 converted, no longer paying". The second "At least" is capitalised mid-sentence, because `atLeast()` capitalises. Cosmetic.
2. **Pill position:** in a tall row (`auto-rows-fr`) the Leading pill sits at the tile's bottom-right corner, about 27px below the "Converted this month" line at 1168px. It is clearly separate from the Lagging pill, but not level with the line it explains. Cosmetic; the user can judge in the browser look.

### User browser steps (signed in as an admin)
1. **Money → Finance**, Overview. The Paying accounts tile shows its % and "N of M accounts", then the line **"Converted this month: n of m paying"**. It has a grey **"Lagging"** pill at the top right and a grey **"Leading"** pill at the bottom right; neither covers any text. All five tiles are the same size.
2. Hover or Tab to the **Leading** pill. The explanation opens **below** the tile and ends "…Always the current calendar month in UTC, whatever window the page shows." Clicking the pill does not open the Plans tab; clicking the tile does.
3. Change the window to **Last month**. The Converted line does **not** change (it is always this calendar month).
4. Open **Plans & subscriptions**. Between Plan mix and Subscriptions there is **"Converted this month"**, with the columns Business, Plan, First payment (UTC), Came from, Status. Came from is Friend invite, Admin invite, Organic or Not recorded. An account that paid this month and has since cancelled shows the chip **"Converted, no longer paying"** and is not in the tile's number. In the browser's network panel, opening the tab adds only the subscriptions request.
5. Pick one business in the business picker. The tile's line reads "Converted this month: Yes", "Yes, no longer paying" or "No".
6. In test mode today, the figure counts only test-mode payments. After live keys, earlier test payments no longer stop a business from counting as converted.

### Final Status
- [x] All MK-5b behaviours pass. AC-145 moved to `23a12c7e` as ruled; Pins A to D and AC-173 are unchanged. No bugs. **Ready for RM.** The performance note joins MK5B-FU-1; the two Low items are optional.
- [ ] Issues found

## Commit Info

- **Branch:** `feature/admin-money-mk5b-converted-this-month` (from main `f87eccda`)
- **Commit:** `4747c281` feat(finance): Converted this month in the Paying accounts tile, plus the converted list (MK-5b)
- **Merge:** origin/main (`adb1c6e8`) merged in `48796149`, no conflicts
- **Pins:** AC-145 `23a12c7e` (ruled); Pins A to D and AC-173 equal main
- **PR:** [#485](https://github.com/AgentsPilot/neuronforge/pull/485), auto-merge on (merge commit, via the merge queue)

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-20 | Created (Dev) | Workplan for MK-5b |
| 2026-10-20 | Implemented (Dev) | The read, the lineage source read, the wiring, the builder, the F-K5 figure and pill, the Plans list; AC-145 ruled update `a13f1ccd` to `23a12c7e`; other pins unchanged |
| 2026-10-20 | SA code review | Code Approved (SA-CR-MK5B): the lineage ForAdmin read approved (select-only, at most 200 UUIDs, keeps the C-7 single-caller pin); D-3 tests are ordinary; D-7 keeps the stamp guard unedited; stopped accounts are listed and not counted; only AC-145 moved. MK5B-FU-1 scale follow-up; rename payingRows (Low) |
| 2026-10-20 | SA-CR-MK5B follow-ups (Dev) | `payingRows` renamed `planRows`; MK5B-FU-1 recorded here and in FIN §0.4 |
