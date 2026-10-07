# Workplan: Business OS Credits Boost — Slice 5a "Show the packages"

> **Last Updated**: 2026-10-07

**Developer:** Dev
**Requirement:** [BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md) (FR-1, FR-5, FR-24, FR-28, FR-29, FR-42; §18.5 slice 5, split 2026-10-07)
**Branch:** `feature/bos-credits-boost-slice-5a` (cut from `origin/main` 0c3c1800, after #247)
**Date:** 2026-10-07
**Status:** **Approved and committed 2026-10-07, PR open.** **QA follow-ups applied 2026-10-07.** SA code review approved (no must-fix); QA PASS WITH NOTES, QA5a-D1 and D2 fixed, I-2 applied, R-1 to R-6 added (§6.1). *(Earlier: **QA (5a) 2026-10-07: PASS WITH NOTES** (QA5a-D1 Medium, focus return; QA5a-D2 Low; see QA Testing Report). **SA code review (5a) 2026-10-07: Code Approved for QA** (no must-fix). Previously: **Code Complete 2026-10-07, awaiting SA code review.** SA approved the workplan with conditions C-1 to C-5 (applied, §3.0); the user said start. Tests green (§6.1). Nothing is committed. *(Earlier: SA approved with conditions 2026-10-07.)*)*

## Overview

Slice 5 is split in two (user, 2026-10-07). **5a** shows what can be bought: a **Top up** button on the Credits card opens a package picker with the three packages. Their prices, credits and bonus all come from the catalogue. **The Buy button is disabled with "Coming soon".** **5b** (after 4a) turns Buy on and adds the embedded Stripe form, the return landing and the Purchases history. Both are listed under Out of scope below.

**User decision B (2026-10-07):** every Business OS owner sees Top up and the picker. 5a does not read `BUSINESS_OS_CREDITS_BOOST_ENABLED` (off on Vercel) and never calls the checkout route.

---

## 1. Analysis Summary

| Area | What exists | 5a use |
|---|---|---|
| Catalogue | `codeBoostPackageSource().listActive()` in `lib/business-os/entitlements/boostCatalogue.ts`. It returns active packages in display order, already derived: `baseCredits`, `bonusCredits`, `totalCredits`, `bonusPercent` (FR-42). It is lazy, rejects on an invalid catalogue, and holds labels for en, he and es | The only data source |
| Labels | Labels are en/he/es. Today all three are English (`en()` helper; FR-1 allows that) | Sent as-is, all three. The client picks, as `CreditHistoryPanel` does (`label[language] ?? label.en`) |
| Credits card | `components/business-os/UsageCard.tsx`: title row, ring, "Extra credits" (11d), the "Credit history" link (behind a flag that is off in prod), then `CreditHistoryPanel` mounted on first open | Add the button; mount the picker the same way |
| Panel pattern | `CreditHistoryPanel.tsx`: the `Sheet` primitive, `side={isRTL ? 'left' : 'right'}`, `dir` on the content, reads when it opens, checks the payload before showing it | The picker copies it |
| Sibling routes | `app/api/business-os/usage`, `.../credits/history`: `getUser` → 401, `runtime nodejs`, `force-dynamic`, `Cache-Control: private, no-store` | Same skeleton |
| Language | No Business OS route reads a locale on the server: `LanguageContext` lives on the client (localStorage plus preferences) | Return all three labels (see Q-1) |
| Money | `lib/business-os/currency.ts` has `currencySymbol` only, no formatter | `Intl.NumberFormat(language, { style: 'currency', currency })` with the payload's currency (Q-3) |
| Guards | `creditFigures.fromConfig.guard.test.ts` (`SOURCES`; its dictionary scan covers `usage.*` keys and any value mentioning credits); `enforcementPoints.test.ts` (`KNOWN_NON_GATE_IMPORTERS`) | Add the picker, the view mapper and the route to `SOURCES` (slice 1 C-7). Register the new importers |

No database, no Stripe, no migration, no audit (a read of public prices).

---

## 2. Scope and guardrails

**In:** `GET /api/business-os/credits/boost/packages`, a pure view mapper, the Top up button, the picker panel, en/he/es strings with RTL, tests, guard registrations, docs.

**Out (5b and later):** the Buy flow, the embedded Stripe form, the return landing, the Purchases history, "payment processing" states. The cap is not shown.

**Guardrails (must not):**
- call `/api/business-os/credits/boost/checkout`, or import anything from `lib/business-os/boost/boostCheckout*`;
- read `BUSINESS_OS_CREDITS_BOOST_ENABLED` or the test-account list;
- type a price, a credit figure or a bonus % in a component, a string or the route;
- sum or convert currencies (USD only, FR-28);
- change the ring, the percentage, the band or the "Extra credits" figure, or add anything to them (FR-24, BD-25);
- import server code into a `'use client'` file.

---

## 3. Implementation Approach

### 3.0 SA conditions applied (2026-10-07)

| # | Condition | How it is met |
|---|---|---|
| C-1 | Money through `refundMath`, never a typed `/ 100` | `formatMinorAmount(minor, currency, language)` in `lib/business-os/currency.ts` uses `fromMinorUnits` / `minorUnitsPerMajor`; whole vs fractional from `minor % minorUnitsPerMajor(currency)`. Test `lib/business-os/__tests__/currency.formatMinorAmount.test.ts`: $10 / $25 / $50, $12.50, he/es/en, JPY and KWD minor units |
| C-2 | The client-facing types import nothing from entitlements | `boostPackagesTypes.ts` declares its own `BoostLabels`; only the route and the view mapper are registered |
| C-3 | Inert state pinned | (a) source guard in `boostPackagesView.test.ts`: the panel, the view, the types and the route never contain `/checkout`, `boostCheckout`, `isBoostCheckoutOpenFor` or `BUSINESS_OS_CREDITS_BOOST` (whole file, comments included); (b) render test: `purchaseAvailable: true` still disables every Buy and a click fetches nothing; (c) the 5b note is in §9 |
| C-4 | Nothing internal in the payload | The view picks fields by name; the route test asserts the exact key set of each package view and of `labels`, and that no `retailVersion`, `creditValueVersion`, `active`, cost, markup or rate appears |
| C-5 | he/es drafts listed for the PR body | §10 |

### 3.1 The view — `lib/business-os/boost/boostPackagesView.ts` (pure, new)

`toBoostPackageView(pkg: BoostPackage): BoostPackageView` keeps only what the picker shows:

```ts
interface BoostPackageView {
  id: string; version: number; order: number;
  priceMinor: number; currency: 'USD'; taxExclusive: true;
  baseCredits: number; bonusCredits: number; totalCredits: number;
  bonusPercent: number;            // straight from the catalogue's computed figure (FR-42), never re-typed
  labels: { name: Labels; description: Labels; badge: Labels | null };
}
interface BoostPackagesPayload { packages: BoostPackageView[]; purchaseAvailable: false }
```

- It leaves out `active` (always true here), `retailVersion` and `creditValueVersion`, which are internal.
- The view type lives in `lib/business-os/boost/boostPackagesTypes.ts` (types only), so the client never imports the entitlements module.

### 3.2 The route — `app/api/business-os/credits/boost/packages/route.ts` (new; `new-api-route` skill)

- `GET` only. `runtime nodejs`, `force-dynamic`, Pino child logger with a `correlationId`.
- `getUser` → **401**. There is no input, so there is no Zod body or query; any query string is ignored.
- `await codeBoostPackageSource().listActive()`.
  - **Any rejection** (not only `BoostCatalogueInvalidError`, per slice 1 C-7 E-2) → one `error` log with `issues` when present → **503** `{ success: false, error: 'packages_unavailable' }`.
  - An empty list cannot happen: validation refuses "no active package". If it did happen, it is treated the same way (503), never "nothing to sell".
- **200** `{ success: true, data: { packages: [...].map(toBoostPackageView), purchaseAvailable: false } }`.
- `Cache-Control: private, max-age=60` (Q-2).
- `purchaseAvailable` is the **literal `false`** in 5a (Q-4).

### 3.3 The button — in `UsageCard.tsx`

- **Where:** the last row of the card, pushed to the bottom (`marginTop: 'auto'`), full width.
  - It sits under the ring, under "Extra credits" when shown, and under the "Credit history" link when that flag is on.
  - The card is `height: 100%` in a grid. Pushing the button to the bottom keeps it level with the neighbouring cards' bottoms whatever the ring area shows.
- **Look:** a secondary button. 34 px high, `borderRadius: 10`, `1px solid var(--v2-border)`, `var(--v2-surface)` background, `var(--v2-primary)` text, 12.5 px semibold, with a small `Plus` icon (lucide) before the text. Text: "Top up" / "Recargar" / "הוספת קרדיטים".
- **When:**
  - Shown once the first read has settled (loaded, no allowance, or the error line). Buying does not depend on the usage read.
  - Hidden only while the very first read is loading, so the card does not jump.
- **How:** it opens the picker. The picker is mounted on first open (as history is), so the card's own mount makes no extra request.

### 3.4 The picker — `components/business-os/BoostPackagesPanel.tsx` (new, `'use client'`)

A `Sheet` like `CreditHistoryPanel`: same side rule, `dir`, width and title style.

1. **Title** "Top up credits". One line under it: "One-off credits that sit beside your plan. They are added to Extra credits."
2. **Three package cards, stacked**, in the catalogue's `order` (Starter, Plus, Max). Each is a rounded `var(--v2-border)` box:
   - **Top row:** the name (14 px semibold) on the start side, and the badge pill on the end side when the package has one ("Most popular" on Plus, "Best value" on Max). The pill is `var(--v2-primary)` text on a light primary tint, 11 px.
   - **Price line:** the price, large (20 px bold), e.g. "$25", followed by a small muted "excl. tax" (FR-29).
   - **Credits line:** "13,750 credits".
   - **Bonus line,** only when `bonusPercent > 0`: "Includes a +10% bonus (1,250 credits)". The % is `Intl` percent of the payload's `bonusPercent`; the credits are the payload's `bonusCredits`.
   - **Description,** muted 12 px.
   - **Buy button:** full width and **disabled**, labelled "Coming soon", with `aria-disabled` and a `title` "Purchasing opens soon". It is disabled whenever `purchaseAvailable` is not `true`; in 5a that is always.
3. **Footer note,** muted 11.5 px: "Prices are in US dollars and exclude tax." (FR-28, FR-29).
4. **States:**
   - **Loading:** three grey placeholder boxes.
   - **Error** (a non-200, or a payload that fails the check): "We couldn't load the packages right now." with a **Try again** link. Never an empty list.
   - The panel reads when it opens, and again on Try again. No timer.

**Formatting** (all in the reader's `language`, all figures from the payload):
- Price: `Intl.NumberFormat(language, { style: 'currency', currency: pkg.currency, minimumFractionDigits: priceMinor % 100 === 0 ? 0 : 2 })`, applied to `priceMinor / 100`.
- Credits: `Intl.NumberFormat(language, { maximumFractionDigits: 0 })`.
- Bonus: `Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 2 })`, applied to `bonusPercent / 100`.

**Payload check** (`isBoostPackagesPayload`):
- `packages` is a non-empty array;
- every number is finite and the credits are integers;
- `currency === 'USD'` (any other value is an error, never converted);
- the labels have en, he and es strings;
- `purchaseAvailable` is a boolean.

**Strings:** new keys under `usage.boost.*` in `LanguageContext.tsx`, en/he/es. The `usage.` prefix puts them inside the figure guard's dictionary scan. Every figure is a placeholder (`{price}`, `{credits}`, `{percent}`). Hebrew and Spanish are drafts and need native review, as §8.2 already notes.

### 3.5 Registrations

| Guard | Entry |
|---|---|
| `enforcementPoints.test.ts` › `KNOWN_NON_GATE_IMPORTERS` | `app/api/business-os/credits/boost/packages/route.ts` → `['codeBoostPackageSource']`: it displays prices and refuses nothing by plan. `lib/business-os/boost/boostPackagesView.ts` → `['BoostPackage']` (type only) |
| `creditFigures.fromConfig.guard.test.ts` › `SOURCES` | The route, `boostPackagesView.ts` and `BoostPackagesPanel.tsx` (slice 1 C-7). `UsageCard.tsx` is already listed. Q-5 asks whether the guard should also check the boost figures |

---

## 4. Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `app/api/business-os/credits/boost/packages/route.ts` | create | The packages read |
| `app/api/business-os/credits/boost/packages/__tests__/route.test.ts` | create | Route tests |
| `lib/business-os/boost/boostPackagesTypes.ts` | create | Client-safe payload types |
| `lib/business-os/boost/boostPackagesView.ts` (+ test) | create | Pure mapper |
| `components/business-os/BoostPackagesPanel.tsx` | create | The picker |
| `components/business-os/__tests__/BoostPackagesPanel.render.test.tsx` | create | Picker render tests |
| `components/business-os/__tests__/UsageCard.topUp.render.test.tsx` | create | Button tests |
| `components/business-os/UsageCard.tsx` | modify | The button; mount the picker; header note |
| `lib/business-os/LanguageContext.tsx` | modify | `usage.boost.*` strings, en/he/es |
| `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts` | modify | Two non-gate entries |
| `lib/business-os/entitlements/__tests__/creditFigures.fromConfig.guard.test.ts` | modify | Three `SOURCES` (+ Q-5) |
| `docs/requirements/BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md` | modify | Status and Change History |

---

## 5. Task List

- ✅ T5a.1 Types and view mapper, plus a unit test (fields kept and dropped; the bonus is the catalogue's, not re-typed)
- ✅ T5a.2 Route plus its test
- ✅ T5a.3 Strings (en/he/es) under `usage.boost.*`
- ✅ T5a.4 `BoostPackagesPanel` plus a render test
- ✅ T5a.5 The button in `UsageCard`, plus a render test; the existing UsageCard suites stay green unchanged
- ✅ T5a.6 Guard registrations; run `enforcementPoints`, `creditFigures.fromConfig.guard`, `tierLiteral.forbidden` and `accountSeam.guard`
- ✅ T5a.7 Re-run the broad set (the `test:bos-entitlements` set plus UsageCard/CreditHistory suites) and scoped tsc; record in §6
- ✅ T5a.8 Requirement status and Change History

---

## 6. Test Plan

**Route** (mocks `@/lib/auth` and the catalogue source):
- happy path: 200, three packages in order, `purchaseAvailable: false`, `Cache-Control` private, and all three labels for each package;
- the figures equal the catalogue's (`bonusPercent` 0 / 10 / 15, totals from the source, not literals);
- 401 when signed out, and the catalogue is never read;
- the source rejects with `BoostCatalogueInvalidError` → 503 `packages_unavailable`, with issues logged and not returned; a plain `Error` → 503 as well;
- internal fields absent (`retailVersion`, `creditValueVersion`, `active`);
- a query string is ignored;
- no import of the checkout modules (source check).

**Picker render:**
- three cards in payload order;
- the badges come from labels;
- the bonus line is shown only when `bonusPercent > 0`, and its % and credits come from the payload (a planted payload with 12 % proves no literal);
- "excl. tax" on every price;
- every Buy is `disabled` with "Coming soon";
- a payload with `purchaseAvailable: true` still disables Buy in 5a (Q-4);
- he: `dir="rtl"`, the Hebrew name label used when present, the English fallback otherwise;
- error state on a 503 and on a malformed payload (currency `EUR`, a missing label), never an empty list;
- Try again reads again;
- it never fetches `/checkout`.

**UsageCard:**
- the button is hidden while the first read is loading, then shown (loaded, no allowance, error line);
- the card's mount makes no packages request, and opening does;
- nothing else on the card changes (the existing four UsageCard suites pass unedited).

**Guards:** the entitlements registrations and `creditFigures` `SOURCES`.

**Commands:** the scratch Jest configs with `--runTestsByPath` (JSX config for `.tsx`), and the scoped tsc. `npm run test:bos-entitlements` runs in CI.

---

### 6.1 Results (Dev, 2026-10-07)

| Run (scratch configs, `--runTestsByPath`) | Result |
|---|---|
| The five new suites (route, view + inert guard, `formatMinorAmount`, picker render, card Top up render) | ✅ 42 tests |
| The four existing UsageCard suites, `CreditHistoryPanel`, `creditUsageSignal.raiseSites` — **unedited** | ✅ green (inside the run below) |
| `lib/business-os/entitlements/**` (incl. `enforcementPoints`, `creditFigures.fromConfig.guard`, `tierLiteral.forbidden`, `accountSeam.guard`), `lib/business-os/boost/__tests__`, the boost routes, `components/business-os/__tests__`, `formatMinorAmount`, and `oneAddressPolicy.guard` **with Linux-normalised paths** (a temporary copy whose `ROOT` / `relative()` use `/`, deleted after) | ✅ 56 suites, 1,493 tests |
| The rest of the `test:bos-entitlements` file set (repositories, migrations, credits, audit, admin users, usage route, `lib/business-os/__tests__`, `lib/i18n`) | ✅ 184 suites, 4,337 tests |
| Mutations | ✅ Buy enabled (`PURCHASE_BUILT = true`) and Top up hidden on the error line: both caught (2 failures), then restored |
| Q-5 dry run | ✅ With the boost figures (12,500 / 1,250 / 13,750 / 25,000 / 3,750 / 28,750, derived; price-in-cents values skipped) added to the guard, every `SOURCES` file and every dictionary string still pass, so the check stays on all surfaces. A planted "13,750 credits" for each figure is caught |
| Scoped tsc (`tsconfig.slice5a.json`) | ✅ **0 errors in the 5a `.ts` files** (route, route test, types, view, view test, `currency.ts` and its test, both guards). The `.tsx` files cannot be fully checked by the scratch config: it does not resolve `@types/react` from the shared `node_modules` (TS7016 on every React import, including the untouched `CreditHistoryPanel` and `components/ui/sheet`). The only other errors are 24 pre-existing duplicate dictionary keys in `LanguageContext.tsx` (`crm.task.*`, present on `origin/main`); each of the 12 new `usage.boost.*` keys occurs exactly 3 times (en, es, he). CI's type-check covers the `.tsx` files |

**QA follow-ups (Dev, 2026-10-07):**

| # | Change | Tests |
|---|---|---|
| QA5a-D1 (Medium, a11y) | Focus returns to Top up when the picker closes. The panel is mounted lazily, so a `SheetTrigger` cannot wrap the card's button. Instead `BoostPackagesPanel` takes `returnFocusRef`, and its `onCloseAutoFocus` prevents Radix's default (focus a trigger it does not have, landing on `<body>`) and focuses that ref. `UsageCard` passes a ref to the Top up button. `CreditHistoryPanel` is unchanged (§9 follow-up) | R-1 in `UsageCard.topUp.render.test.tsx`: focus is on Top up after Escape, after the close button, and after a second open. Mutation (no `focus()`): 3 failures |
| QA5a-D2 (Low) | The figure guard now catches a hand-typed "5,000 credits", replacing deviation 3. **Every** boost figure is guarded. One that equals a package price in cents (5,000 = Max's `priceMinor`) is caught only when a credits word follows it (`credits` / `créditos` / `קרדיטים`); the others are caught bare. The value of a `priceMinor:` / `amountMinor:` property is never a credit figure (`stripMinorAmounts`, slice 1 C-1). **Dry run:** banning 5,000 bare hit one false positive, `ceiling: 5_000` (a paging limit) in `adminCreditPercent.ts`, which is why that figure needs the credits word. With the rule above, every `SOURCES` file and dictionary string passes | R-2 in the guard: "5,000 credits", "5,000 créditos" and "5,000 קרדיטים" caught; `priceMinor: 5000`, `amountMinor: 5000` and `ceiling: 5000` not. Mutation: QA's planted `'5,000 credits'` in the panel is now red (restored, SHA-1 equal) |
| I-2 | The loading placeholder has `role="status"`, named "Loading packages…" | `getByRole('status', { name })` |
| R-3 | The en/he/es price, credits and bonus strings are pinned exactly as rendered. Intl's right-to-left marks in Hebrew prices are stripped in the comparison only | 3 tests |
| R-4 | Route: an empty catalogue, a thrown string or `undefined` → 503 `packages_unavailable`, `no-store`; `getUser` throwing → 503 with no details in production | 4 tests |
| R-5 | Panel: fractional credits, a negative bonus, a missing `taxExclusive` or `purchaseAvailable`, `packages` not an array, a 200 with `success:false`, a non-JSON 502 and a network failure → error, never an empty list | 8 tests |
| R-6 | `formatMinorAmount`: `$1,234,567.89`, `$1,000,000`, `$0.01`, `$9.99`; es `10 US$`, `12,50 US$`, `1.234.567,89 US$`; he `10 $`, `12.50 $`, `1,234,567.89 $` | 3 tests |

**Re-run after the QA follow-ups:**
- **The five 5a suites:** 64 tests (was 42).
- **Broad set:** 239 suites, 5,847 tests, all green. It covers the whole `test:bos-entitlements` file set, the boost suites and routes, all of `components/business-os/__tests__` (the four UsageCard suites, `CreditHistoryPanel` and `creditUsageSignal.raiseSites`, **unedited**; `git diff` shows no change to them or to `CreditHistoryPanel.tsx`), and `oneAddressPolicy.guard` on a Linux-path copy (deleted after).
- **Scoped tsc:** `tsconfig.slice5a.json` reports 0 errors in the `.ts` files. **SA's types-first `tsconfig.5a.json`** reports 0 errors in `UsageCard.tsx`, `BoostPackagesPanel.tsx` and both new render tests; its only errors are the 24 pre-existing `crm.task.*` duplicate keys (TS1117) in `LanguageContext.tsx`.

**Deviations from the plan (small, for SA code review):**
1. **The C-3 source guard also covers `boostPackagesTypes.ts`** (stricter than asked); its 5b comment therefore names the purchase route's access check without the function name. The exact call is in §9.
2. **Buy is hard-disabled by a constant** (`PURCHASE_BUILT = false` in the panel), and `canBuy` is `PURCHASE_BUILT && purchaseAvailable === true`. 5b deletes the constant.
3. ~~**The figure guard skips any boost figure equal to a package price in cents** (SA Q-5). Starter's 5,000 credits equals Max's price in cents (5000), so 5,000 is not banned; the other six figures are.~~ *Superseded by QA5a-D2 (above): 5,000 is guarded when a credits word follows it.*
4. **An unexpected error in the route is also 503 `packages_unavailable`** (not 500), with details only in development, so the picker has one failure shape.
5. **The picker's fetch does not pass `cache: 'no-store'`**, so the approved `private, max-age=60` can apply.
6. **The Hebrew bonus string has no "+" before the percentage** ("כולל בונוס של {percent} …"): a leading plus beside a right-to-left phrase renders on the wrong side. English and Spanish keep "+{percent}".
7. **The view mapper copies the labels** (new objects, not the catalogue's frozen ones).
8. **No screenshots.** There is no way to render the picker without a dev server, which would read PROD data, so the layout is described in §3.3 and §3.4 instead.

## 7. Estimate and risks

About **1.5 to 2 days**.

| Risk | Mitigation |
|---|---|
| Owners see a picker they cannot use yet | User decision B; the disabled "Coming soon" says so plainly |
| English-only labels in he/es | FR-1 allows it; native review is already noted in §8.2 |
| `creditFigures` false positives if boost figures are added (Q-5) | Measure on all `SOURCES` before adding them; add only if green |

---

## 9. Notes for 5b

- **`purchaseAvailable`** comes from the **server-side** `isBoostCheckoutOpenFor(user.id)` in the packages route, never from the browser. The checkout route's flag gate (`BUSINESS_OS_CREDITS_BOOST_ENABLED`, 404 while off) stays the authority whatever the UI shows (SA C-3).
- Remove `PURCHASE_BUILT` from the panel and drop `BoostPackagesPanel.tsx` from the C-3 inert guard (or narrow the guard) in the same change.
- **Cache (SA Q-2):** once `purchaseAvailable` is per user and depends on the flag, use `private, no-store`, or keep 60 s only if a stale `false` for up to a minute is acceptable.

- **Follow-up (QA5a-D1, out of scope here):** `CreditHistoryPanel` has the same focus defect. It is opened by a plain button, not a `SheetTrigger`, so focus lands on `<body>` on close. It sits behind a flag that is off, so nobody hits it today. The same `returnFocusRef` / `onCloseAutoFocus` fix applies when that flag is turned on.

## 10. Draft strings for native review (SA C-5, for the PR body)

| Key | en | es (draft) | he (draft) |
|---|---|---|---|
| `usage.boost.top_up` | Top up | Recargar | הוספת קרדיטים |
| `usage.boost.title` | Top up credits | Recargar créditos | הוספת קרדיטים |
| `usage.boost.intro` | One-off credits that sit beside your plan. They are added to your extra credits. | Créditos puntuales que se suman a tu plan. Se añaden a tus créditos extra. | קרדיטים חד-פעמיים לצד התוכנית שלך. הם מתווספים לקרדיטים הנוספים. |
| `usage.boost.excl_tax` | excl. tax | sin impuestos | לא כולל מס |
| `usage.boost.credits` | {credits} credits | {credits} créditos | {credits} קרדיטים |
| `usage.boost.bonus` | Includes a +{percent} bonus ({credits} credits) | Incluye un bono del +{percent} ({credits} créditos) | כולל בונוס של {percent} ({credits} קרדיטים) |
| `usage.boost.coming_soon` | Coming soon | Próximamente | בקרוב |
| `usage.boost.coming_soon_hint` | Purchasing opens soon | La compra estará disponible pronto | הרכישה תיפתח בקרוב |
| `usage.boost.footer` | Prices are in US dollars and exclude tax. | Los precios están en dólares estadounidenses y no incluyen impuestos. | המחירים בדולר אמריקאי ואינם כוללים מס. |
| `usage.boost.error` | We couldn't load the packages right now. | No pudimos cargar los paquetes en este momento. | לא הצלחנו לטעון את החבילות כרגע. |
| `usage.boost.retry` | Try again | Reintentar | נסו שוב |
| `usage.boost.loading` | Loading packages… | Cargando paquetes… | טוען חבילות… |

The package names, descriptions and badges come from the catalogue and are English in all three languages for now (FR-1; native review is noted in requirement §8.2).

**Also for the native reviewer (QA I-3, I-4):**
- **I-3:** the shared `Sheet` close button's screen-reader text is the English "Close" in Hebrew and Spanish too (`components/ui/sheet.tsx`). It predates 5a and affects every sheet; not changed here.
- **I-4:** Spanish writes four-digit numbers without a separator ("5000 créditos", "1250"). That is correct CLDR behaviour for `es` (minimum grouping digits 2), not a bug; the reviewer may still prefer otherwise.

## 8. Questions for SA

| # | Question | Dev proposal |
|---|---|---|
| Q-1 | Labels: send all three locales and let the client pick (the `CreditHistoryPanel` pattern; no Business OS route has a server-side locale), or resolve one language on the server? | All three; client `labels[language] ?? labels.en` |
| Q-2 | Cache header | `private, max-age=60`: the catalogue only changes on deploy, and `purchaseAvailable` will be per user in 5b. Alternatively `private, no-store`, like the siblings |
| Q-3 | Money formatting: `Intl` inline in the panel, or a new `formatMinorAmount(minor, currency, language)` in `lib/business-os/currency.ts` (which has no formatter today)? | Add the small pure helper to `currency.ts`, so 5b's history reuses it |
| Q-4 | `purchaseAvailable` in 5a | The literal `false`, and the UI also hard-disables Buy in 5a, so neither the flag nor the allow-list is read. 5b replaces it with `isBoostCheckoutOpenFor(user.id)` plus "5b shipped" |
| Q-5 | Should `creditFigures.fromConfig.guard` also scan for the boost figures (5,000 / 12,500 / 13,750 / 25,000 / 28,750) from the catalogue? | Yes, derived from `validateBoostCatalogue` (never typed), if a dry run shows no false positives on current `SOURCES`; otherwise only the three new files |
| Q-6 | Button visibility on the error line | Shown: buying does not depend on reading usage |

## Business questions

None. Decision B covers who sees it. The wording "Coming soon" and the placement are shown to the user with the diff (UI review).

---

## SA Review Notes

### SA Workplan Review

**Reviewed by SA — 2026-10-07, against `0c3c1800`**
**Status:** ✅ Approved with conditions (C-1 to C-5). The Dev writes them in as the first step, and no second review is needed. **No user question:** decision B (every owner sees Top up and the picker, Buy disabled) is the user's, and the UI is reviewed with the diff.

The slice is proportionate (about 1.5–2 days) and reuses existing infrastructure: the slice 1 catalogue seam, the `CreditHistoryPanel` `Sheet` pattern with its RTL side rule, the sibling-route skeleton and the `LanguageContext` keys. It adds no new pattern. It does not touch the checkout, the flag, the database or Stripe.

#### Is an inert purchase UI for every owner safe?

**Yes. Two independent gates stand between this UI and taking money:**
1. The Buy button is hard-disabled in 5a, whatever `purchaseAvailable` says.
2. **Server side**, `/api/business-os/credits/boost/checkout` answers 404 while `BUSINESS_OS_CREDITS_BOOST_ENABLED` is off, and slice 3 C-1 keeps it off on Vercel until 4a is deployed.

So even a future change that flipped `purchaseAvailable`, or the UI disable, could not start a payment before 4a: the flag stays the kill switch. C-3 pins the 5a side and binds 5b.

#### Conditions

| # | Severity | Condition |
|---|---|---|
| **C-1** | Low | **Money formatting follows NFR-9.** `formatMinorAmount(minor, currency, language)` in `lib/business-os/currency.ts` (Q-3) converts with `fromMinorUnits` / `minorUnitsPerMajor` from `lib/payments/refundMath.ts`, not with a typed `/ 100` or `% 100`. That file has **no imports**, so it is safe in a client bundle. Decide whole versus fractional display from `minor % minorUnitsPerMajor(currency) === 0`. One unit test covers USD $10, $25 and $50, a fractional amount, and he/es/en output. |
| **C-2** | Low | **Entitlements registration covers type-only imports.** If `boostPackagesTypes.ts` imports `Labels` from `lib/business-os/entitlements/types`, that is a third outside importer (type-only counts) and needs its own `KNOWN_NON_GATE_IMPORTERS` entry. **Preferred:** declare a local `type BoostLabels = { en: string; he: string; es: string }` in `boostPackagesTypes.ts`, so the client-facing types file imports nothing from the module and only the route and the view mapper are registered. |
| **C-3** | Low | **Pin the inert state.** (a) A source guard: `BoostPackagesPanel.tsx`, `boostPackagesView.ts` and the packages route never mention `/checkout`, `boostCheckout`, `isBoostCheckoutOpenFor` or `BUSINESS_OS_CREDITS_BOOST`. (b) The render test proves `purchaseAvailable: true` still renders Buy disabled (it is already in §6). (c) **Recorded for 5b:** the route sets `purchaseAvailable` from the **server-side** `isBoostCheckoutOpenFor(user.id)`, and the checkout route's flag gate stays the authority, whatever the UI shows. |
| **C-4** | Low | **The payload exposes nothing internal.** It keeps `id`, `version`, `order`, price, currency, tax flag, the three derived credit figures, `bonusPercent` and labels, and drops `active`, `retailVersion` and `creditValueVersion`, as planned. No cost, markup, credit value or rate appears anywhere. The route test asserts the **exact key set** of a package view, so a later field added to `BoostPackage` cannot leak by spread. |
| **C-5** | Info | **Hebrew and Spanish strings** are drafts for native review. They are listed in the PR description, as for the credit diary labels. Every figure in a string is a placeholder (the `usage.` prefix keeps them inside the figure guard). |

#### Rulings on Q-1 to Q-6

| Q | Ruling |
|---|---|
| **Q-1** | **All three locales** in the payload; the client picks `labels[language] ?? labels.en`. That matches `CreditHistoryPanel`, and no Business OS route resolves a locale on the server. |
| **Q-2** | **`private, max-age=60`, approved for 5a.** The data is the same for every owner and changes only on deploy. `private` keeps it out of shared caches. **5b revisits it:** once `purchaseAvailable` is per user and flag-dependent, use `private, no-store` (or keep 60 s only if a stale `false` for up to a minute is acceptable to the UI). |
| **Q-3** | **Yes**, the helper in `currency.ts`, with C-1. |
| **Q-4** | **The literal `false`**, plus the UI hard-disable (C-3). Neither the flag nor the allow-list is read in 5a. |
| **Q-5** | **Yes, with the dry run.** Derive the banned boost figures from `validateBoostCatalogue` (never typed), and scan only the guard's `SOURCES`. **Price minor values (1,000 / 2,500 / 5,000) are not credit figures:** apply slice 1's C-1 rule and skip `priceMinor` values. If the dry run shows false positives elsewhere, limit the new check to the three new files. |
| **Q-6** | **Shown on the error line.** Buying does not depend on the usage read. It stays hidden only during the very first load, so the card does not jump. |

#### Other checks

- **Catalogue failure:** **any** rejection → 503 `packages_unavailable` with the issues logged and not returned, and an empty list is treated the same. The panel shows an error with Try again, never an empty list. ✅
- **Auth:** `getUser` → 401. There is no input, so no Zod is needed. The query string is ignored. Held or no-plan-row owners can read public prices, which is harmless. ✅
- **i18n / RTL:** the `Sheet` side follows `isRTL`, `dir` sits on the content, and numbers and money go through `Intl` in the reader's language. USD only, never converted (FR-28), and "excl. tax" on every price (FR-29). ✅
- **The UsageCard guards and tests:** the four existing suites must pass **unedited**. The ring, the percentage, the bands and "Extra credits" are untouched (FR-24, BD-25). The picker mounts on first open, so the card itself makes no extra request. ✅
- **CI:** mocked suites in existing jobs; no time added. **Size:** about 1.5–2 days, plus about 0.25 day for C-1 to C-4. ✅

#### Approval

[x] Workplan approved with conditions C-1 to C-5. Proceed to implementation.

### SA Code Review (5a)

**Code Review by SA — 2026-10-07**
**Status:** ✅ **Code Approved for QA.** There are no must-fix items, and the two notes below need no change.

**Scope:**
- **Created:** the packages route and its test, `boostPackagesTypes.ts`, `boostPackagesView.ts` and its test (including the inert guard), the `formatMinorAmount` test, `BoostPackagesPanel.tsx` and its render test, `UsageCard.topUp.render.test.tsx`.
- **Modified:** `UsageCard.tsx` (+48 / −1), `LanguageContext.tsx` (12 `usage.boost.*` keys × 3 languages), `currency.ts` (`formatMinorAmount`), the `creditFigures` guard, `enforcementPoints`.
- `git diff --stat`: 159 insertions and 3 deletions over 6 tracked files. **The existing UsageCard tests are unedited** (no diff under `components/business-os/__tests__` for them).

#### What I verified myself

| Check | Result |
|---|---|
| 14 suites: the 5 new ones, the 4 existing UsageCard suites, `CreditHistoryPanel`, `creditFigures.fromConfig.guard`, `enforcementPoints`, `tierLiteral.forbidden`, `accountSeam.guard` (the JSX scratch config) | ✅ **380 passed** |
| **The `.tsx` type-check** the Dev could not run. A scratch tsconfig resolves `@types/*` **before** the main checkout's packages (`paths "*": [<main>/node_modules/@types/*, <main>/node_modules/*]`), over `UsageCard.tsx`, `BoostPackagesPanel.tsx` and both render tests | ✅ **0 errors in the 5a files.** The only errors are 24 pre-existing `TS1117` duplicate keys elsewhere in `LanguageContext.tsx` (`config.intake.preview`, `crm.booking.status.*`, …). **None is a `usage.boost.*` key** (checked line by line) |
| Mutation M1: `PURCHASE_BUILT = true` | ✅ Caught (the picker render test, 1 red) |
| Mutation M2: the view mapper also emits `retailVersion` | ✅ Caught (the view test and the route's exact-key test, 3 red) |
| Restoration after each mutation | ✅ SHA-1 checked |
| `console.*` in the touched files | ✅ 0 |

#### Conditions C-1 to C-5 and the Q rulings

| | Met? |
|---|---|
| C-1 NFR-9 money | ✅ `formatMinorAmount` uses `minorUnitsPerMajor` / `fromMinorUnits`, with no typed `/ 100` |
| C-2 client types free of entitlements imports | ✅ `boostPackagesTypes.ts` declares its own `BoostLabels`. Only the route (`codeBoostPackageSource`) and the view (`type BoostPackage`) are registered |
| C-3 inert pinned | ✅ The source guard bans `/checkout`, `boostCheckout`, `isBoostCheckoutOpenFor` and `BUSINESS_OS_CREDITS_BOOST` in the panel, view, route **and** types (deviation 1, stricter than asked). `canBuy = PURCHASE_BUILT && purchaseAvailable === true`. **The Buy button has no `onClick`**, so it cannot call anything even if enabled. The 5b note is in §9 |
| C-4 exact payload keys | ✅ `Object.keys(view).sort()` equals the allowed list, and the labels' keys are pinned too. M2 proves it |
| C-5 native-review strings | ✅ §10 |
| Q-1 to Q-6 | ✅ All three languages; `private, max-age=60` with `no-store` on errors; the helper in `currency.ts`; the literal `false`; the dry-run guard extension; Top up shown on the error line |

#### §6.1 deviations: all accepted

- 1: the stricter guard.
- 2: the `PURCHASE_BUILT` constant, which 5b deletes.
- 3: Starter's 5,000 is not banned because it equals Max's 5000 cents. That is correct under the Q-5 rule, and the other six figures are banned.
- 4: an unexpected error is also 503 `packages_unavailable`, giving one failure shape, with `details` only in development.
- 5: no `cache: 'no-store'` on the fetch, which is consistent with Q-2.
- 6: the Hebrew bonus line has no leading "+", which is the right RTL call.
- 7: the labels are copied.
- 8: no screenshots, which is right: a dev server would read PROD data.

#### Other checks

- **Nothing internal is exposed:** no cost, markup, rate, credit value or versions beyond the package's own `version`. A catalogue failure is a 503, never an empty list, and the issues are logged and not returned. `getUser` → 401. ✅
- **The existing UsageCard behaviour is unchanged:** Top up is the last row (`marginTop: auto`), shown after the first read settles (usage **or** the error line) and hidden while loading. The picker mounts on first open. The ring, %, bands and "Extra credits" are untouched, and the four existing suites pass unedited. ✅
- **Accessibility and RTL:** both buttons are real `<button type="button">` elements with visible text, and the icon is `aria-hidden`. The `Sheet` primitive (Radix) traps focus and closes on Escape. `SheetTitle` is present. The side and `dir` follow `isRTL`. Loading is `aria-busy` with a label. Disabled Buy carries `disabled` and `aria-disabled`, and the visible "Coming soon" text is the accessible name. ✅
- **Entitlements registration, no added CI time, no new pattern** (the CreditHistoryPanel `Sheet` reused). ✅

#### Notes (no change required)

- **N-1:** the `title` tooltip on a `disabled` button is not reachable by keyboard or screen reader. The visible "Coming soon" label already says it. 5b removes the disabled state anyway.
- **N-2:** `aria-describedby={undefined}` silences Radix's missing-description warning deliberately. When 5b adds the Stripe form, add a `SheetDescription` (the subtitle line is a natural fit).

#### Code Approved for QA: **Yes**

## QA Testing Report

### QA — 5a (2026-10-07)

**Verdict:** ✅ **PASS WITH NOTES.** The route, the payload, the figures, the inert Buy, the error and loading states, RTL and the guards all hold. There are **one Medium accessibility defect** (focus is not returned to Top up when the sheet closes) and **one Low guard gap**. Neither touches money or data.

**Test mode:** full
**Strategy used:** A + B (Jest, jsdom). The route ran with `getUser`, the logger and the catalogue source mocked; the UI rendered with the real dictionary in en, he and es and `fetch` mocked. Three scratch suites live in the session scratchpad and are **not committed**:
- `qa/packagesRoute5a.qa.test.ts`: 9 tests;
- `qa/boostUi5a.qa.test.tsx`: 28 tests;
- plus four planted guard mutations, each restored and SHA-1 checked.

**No dev server was started**, because it would read PROD data (deviation 8 stands).
**Focus:** api, ui, a11y, guards
**Skipped:** a real browser pass. The layout, the colours and the scroll in the sheet remain for the user's diff review (short-path UI rule). The `oneAddressPolicy` guard was not re-run, because it needs Linux paths (the Dev ran it on a normalised copy).
**Input source:** coordinator brief + workplan §3, §6

#### Commands run

| Check | Result |
|---|---|
| Broad set (JSX scratch config, `--runTestsByPath`):<br>• all of `app/api/business-os/credits/boost/**`;<br>• `components/business-os/__tests__` (the 5 new suites, the **4 existing UsageCard suites unedited**, `CreditHistoryPanel`, `creditUsageSignal.raiseSites`);<br>• `lib/business-os/boost/__tests__`;<br>• `lib/business-os/entitlements/__tests__`;<br>• `currency.formatMinorAmount` | ✅ **55 suites, 1,489 tests passed**. `git diff` shows no change to any existing test under `components/business-os/__tests__` |
| QA route suite | ✅ 9 / 9 |
| QA UI suite | ✅ 28 / 28, with the focus-return check recorded as an observation (QA5a-D1) |
| Planted guard mutations | ✅ 3 of 4 caught as asked; 1 gap (QA5a-D2). All restored, SHA-1 `OK` |
| Scoped tsc (`tsconfig.slice5a.json`) | ✅ 0 errors in the 5a `.ts` files. The remaining errors are the known `.tsx` / `@types/react` resolution limit of this scratch config (TS7016 and its cascades in untouched files) and the 24 pre-existing duplicate keys (TS1117). SA's types-first config already showed 0 errors in the 5a `.tsx` files |
| Source untouched | ✅ The SHA-1 of the 14 non-doc files and the `git status --porcelain` output match the pre-QA snapshot |

#### Test matrix

| Area | Result | Notes |
|---|---|---|
| Route: signed out | ✅ | 401 `private, no-store`; the catalogue is never read |
| Route: payload shape (C-4) | ✅ | Top level exactly `{success, data}`; `data` exactly `{packages, purchaseAvailable}` with `purchaseAvailable: false` even with `?purchaseAvailable=true&lang=he`. Every package has exactly 11 keys, and its labels exactly `name, description, badge`, each with `en, he, es`. No `retailVersion`, `creditValueVersion`, `active`, markup, rate or cost anywhere |
| Route: figures | ✅ | In order Starter, Plus, Max: price 1000 / 2500 / 5000; base 5,000 / 12,500 / 25,000; **bonus credits 0 / 1,250 / 3,750**; **totals 5,000 / 13,750 / 28,750**; **bonus 0 / 10 / 15 %**. All from the real catalogue. Badges `null` / "Most popular" / "Best value" |
| Route: cache | ✅ | 200 `private, max-age=60`; every failure is `private, no-store` |
| Route: any catalogue failure → 503, never a list | ✅ | `BoostCatalogueInvalidError`, a plain `Error`, a thrown string, an **empty list**, and a throwing `getUser` → all 503 `{success:false, error:'packages_unavailable'}` with no details in production. The catalogue issues are logged and never returned |
| Route: surface | ✅ | Exports only `GET`, `dynamic`, `runtime` |
| `formatMinorAmount` | ✅ | en: `$10`, `$25`, `$50`, **`$12.50`**, `$0.01`, `$9.99`, `$1,234,567.89`, `$1,000,000`. he: `10 $`, `12.50 $`, `1,234,567.89 $`. es: `10 US$`, `12,50 US$`, `1.234.567,89 US$`. Lower-case `usd`, JPY (`¥1,000`) and KWD (3 decimals) also correct |
| Picker: cards | ✅ | A reversed payload is shown in catalogue order (Starter, Plus, Max), with the right badges, "excl. tax" on every price, the footer, and a bonus line only when there is a bonus. **en:** `$25`, `13,750 credits`, `Includes a +10% bonus (1,250 credits)`; `$50` … `+15% bonus (3,750 credits)`. **he:** `25 $`, `לא כולל מס`, `13,750 קרדיטים`, `כולל בונוס של 10% (1,250 קרדיטים)` (no leading "+", per deviation 6). **es:** `25 US$`, `sin impuestos`, `13.750 créditos`, `… +10 % (1250 créditos)`. The 4-digit "1250" and "5000" without a separator are correct CLDR Spanish (minimum grouping digits 2), not a bug |
| Picker: Buy inert (C-3) | ✅ | With `purchaseAvailable: **true**`, all three Buy buttons are `disabled`, `aria-disabled="true"` and read "Coming soon". A click or Enter on each fires **no** request; no URL with `checkout` is ever fetched |
| Picker: error states | ✅ | 503; empty list; `EUR`; fractional credits; a missing `he` label; `purchaseAvailable` missing; `success:false` with a 200; a non-JSON 502 → each shows the error with Try again, and **never an empty list**. A network rejection, then Try again → refetches (2 calls) and shows the three cards |
| Picker: loading | ✅ | Three placeholders, `aria-busy="true"`, `aria-label="Loading packages…"` (see I-2) |
| Picker: dialog | ✅ | `role="dialog"` with accessible name "Top up credits" |
| RTL | ✅ | he: the sheet has `dir="rtl"` and opens from the **left** (`data-side="left"`); the Top up label is `הוספת קרדיטים` |
| Top up visibility | ✅ | Covered by the Dev suite and re-run green: hidden during the first read, shown after load **and** on the error line; the card's mount makes no packages request |
| Keyboard | ✅ / ❌ | Top up has accessible name "Top up". On open, **focus moves into the sheet**, and **Escape closes it**. ❌ **Focus is not returned to Top up after closing; it lands on `<body>`** (QA5a-D1) |
| Repeated open / close | ✅ (Info) | 4 opens → 4 `fetch` calls. The fetch passes only `signal`, so the browser's HTTP cache (`max-age=60`) serves repeats within a minute without a network round trip (deviation 5). Closing mid-load and reopening shows the list (no stuck loading) |
| C-3 source guard | ✅ | A planted `'/api/business-os/credits/boost/checkout'` constant, and even a `// see /checkout` comment, in the panel → `boostPackagesView.test` red (1) |
| creditFigures guard | ✅ / ⚠️ | A planted `'13,750 credits'` in the panel → red. `"Get 13,750 credits."` planted in the en `usage.boost.intro` dictionary string → red. ⚠️ A planted `'5,000 credits'` (Starter's figure) in the panel → **green** (QA5a-D2) |

#### Issues Found

##### Bugs

1. **QA5a-D1: focus is not returned to Top up when the picker closes.** Severity: **Medium** (accessibility; WCAG 2.4.3 focus order). File: `components/business-os/UsageCard.tsx` with `BoostPackagesPanel.tsx`.
   - Steps to reproduce: focus Top up, press Enter (the sheet opens and focus moves inside), then press Escape.
   - Expected: focus goes back to Top up, so a keyboard or screen-reader user continues where they were.
   - Actual: focus lands on `<body>`. A keyboard user must tab again from the top of the page.
   - Cause (confirmed in `@radix-ui/react-dialog` 1.1.20, `dist/index.js:205`): the modal content's `onCloseAutoFocus` calls `event.preventDefault()` and then `context.triggerRef.current?.focus()`. The sheet is opened by a plain button rather than a `SheetTrigger`, so `triggerRef` is null and nothing receives focus. This is a real browser behaviour, not a jsdom artefact. `CreditHistoryPanel` has the same pattern (behind its flag, which is off).
   - Fix (small):
     - **Either** let the panel accept an `onCloseAutoFocus` / `returnFocusTo` ref, and focus the Top up button there;
     - **or** open it through `<SheetTrigger asChild>`.

     Add one render test: Escape → `document.activeElement` is Top up.
2. **QA5a-D2: the figure guard cannot catch a hand-typed "5,000 credits".** Severity: **Low**. File: `lib/business-os/entitlements/__tests__/creditFigures.fromConfig.guard.test.ts`.
   - Steps to reproduce: add `'5,000 credits'` to the panel or a `usage.*` string.
   - Expected: red, like 13,750.
   - Actual: green. Deviation 3 drops 5,000 from the banned set because it equals Max's 5000 cents, so the most likely hand-typed figure (the entry package) is the one left unguarded.
   - Fix: skip a price only in a `priceMinor:` property (slice 1's C-1 rule), or ban any banned figure **followed by a credits word** (`credits`, `créditos`, `קרדיטים`) regardless of the price collision.

##### Performance Issues

None. One fetch per open, cached by the browser for 60 s.

##### Info

- **I-1:** each open re-reads (4 opens → 4 fetches in jsdom). This is by design (§3.4: "the panel reads when it opens"), and the 60 s `private` cache absorbs it in a browser. The panel stays mounted after the first open, so a reopen shows the previous list while it re-reads, with no skeleton flash.
- **I-2:** `aria-label` on the loading `<div>` (no role) is not announced by most screen readers, because a generic element cannot be named. `role="status"` (or visually hidden text) would announce "Loading packages…". This is a nice-to-have, alongside SA's N-1 and N-2.
- **I-3:** the shared `Sheet` close button's screen-reader text is the English "Close" in he and es as well (`components/ui/sheet.tsx`). It predates 5a and affects every sheet.
- **I-4:** in Spanish, `5000 créditos` and `1250` have no thousands separator. That is correct CLDR behaviour for 4-digit numbers in `es`, and worth knowing for the native review (C-5).

#### Recommended additions

| # | Test | Where | Priority |
|---|---|---|---|
| R-1 | Escape (and the close button) returns focus to Top up | `UsageCard.topUp.render.test.tsx` | **With the D1 fix** |
| R-2 | A planted "5,000 credits" in a `SOURCES` file or `usage.*` string is caught | `creditFigures.fromConfig.guard.test.ts` | With the D2 fix |
| R-3 | Picker in he/es: the formatted price, credits and bonus line strings (pins locale output: `25 $`, `13.750 créditos`, no "+" in he) | `BoostPackagesPanel.render.test.tsx` | Should |
| R-4 | Route: an empty catalogue list → 503 (not 200 `[]`), and a thrown string → 503 | route test | Should |
| R-5 | Malformed payloads: fractional credits, a 200 with `success:false`, a non-JSON body → error, never an empty list | panel render test | Nice |
| R-6 | `formatMinorAmount` large values (`$1,234,567.89`) and es `12,50 US$` | currency test | Nice |

#### Test Outputs / Logs

```text
Broad set:   Test Suites: 55 passed, 55 total   Tests: 1489 passed, 1489 total   Time: 61.069 s
QA route:    Tests: 9 passed, 9 total
QA UI:       Tests: 28 passed, 28 total
  en [["$10","excl. tax","5,000 credits",""],["$25","excl. tax","13,750 credits","Includes a +10% bonus (1,250 credits)"],["$50","excl. tax","28,750 credits","Includes a +15% bonus (3,750 credits)"]]
  he [["10 $","לא כולל מס","5,000 קרדיטים",""],["25 $","לא כולל מס","13,750 קרדיטים","כולל בונוס של 10% (1,250 קרדיטים)"],...]
  es [["10 US$","sin impuestos","5000 créditos",""],["25 US$","sin impuestos","13.750 créditos","Incluye un bono del +10 % (1250 créditos)"],...]
  focus after close: BODY
  packages fetches after 4 opens: 4 fetch options: ["signal"]
Guards:      M1 '/checkout' constant -> 1 failed | M1b '/checkout' comment -> 1 failed
             M2 '13,750 credits' in panel -> 1 failed | M3 '13,750 credits' in usage.boost.intro -> 1 failed
             M4 '5,000 credits' in panel -> 39 passed (gap)
             restore: BoostPackagesPanel.tsx: OK  LanguageContext.tsx: OK
```

#### Final Status
- [x] The 5a acceptance criteria pass, and nothing touches money or data. Ready for the user's diff review. **Recommended before the PR:** the small QA5a-D1 focus-return fix with its test. QA5a-D2 is Low and can ride along or wait for 5b.
- [ ] Issues found that the Dev must address before commit

## Commit Info

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-07 | Created | Slice 5 split (user): 5a shows the packages on the Credits card, with a disabled "Coming soon" Buy, for every owner (decision B), not tied to the checkout flag. A GET packages route, a pure view, the Top up button, the picker panel, strings, tests and guard registrations. About 1.5 to 2 days. Six SA questions; no business question |
| 2026-10-07 | SA workplan review: approved with conditions | Inert UI safe: Buy is hard-disabled and the checkout route stays 404 behind the flag until 4a. C-1 money formatting via `refundMath` (NFR-9). C-2 keep the client types free of entitlements imports or register them. C-3 source guard pinning 5a inert, and 5b sets `purchaseAvailable` server-side. C-4 an exact payload key set. C-5 he/es drafts for native review. Q-1 to Q-6 ruled (Q-2 max-age 60 for 5a, revisit in 5b; Q-5 skip `priceMinor` values). No user question |
| 2026-10-07 | SA approved with conditions; implemented; Code Complete | C-1 to C-5 applied (§3.0). The packages route, the view and its types, `formatMinorAmount`, the picker panel, the Top up button, 12 strings in en/es/he, two non-gate registrations, three `creditFigures` sources plus the derived boost figures (after a clean dry run). 42 new tests; 56 + 184 suites green, including the four UsageCard suites unedited and the address guard with Linux paths; 0 tsc errors in the `.ts` files (the `.tsx` files are left to CI, see §6.1). Nothing committed |
| 2026-10-07 | SA code review (5a): Code Approved for QA | 380 tests green (new, existing UsageCard unedited, guards). The `.tsx` files type-checked by SA (types resolved first): 0 errors in 5a files; 24 pre-existing duplicate keys elsewhere in LanguageContext, none a boost key. Mutations (Buy enabled; a version leak in the view) caught. C-1 to C-5 met; deviations 1–8 accepted. Notes N-1 and N-2 for 5b |
| 2026-10-07 | QA (5a): PASS WITH NOTES | Broad set 55 suites / 1,489 green (the existing UsageCard suites unedited). QA scratch suites: route 9/9 (401, exact keys, figures 5,000 / 13,750 / 28,750 with bonus 0 / 1,250 / 3,750 and 0 / 10 / 15 %, cache headers, any catalogue failure including an empty list → 503); UI 28/28 (order, badges, en/he/es prices incl. `$12.50` and large values, Buy inert even with `purchaseAvailable: true` and no request on click, the error states, Try again, the skeleton, RTL left side, focus into the sheet, Escape). Guards: planted `/checkout` and `13,750 credits` (panel and dictionary) caught. QA5a-D1 (Medium, a11y): focus is not returned to Top up on close (the Radix sheet has no trigger ref). QA5a-D2 (Low): a hand-typed "5,000 credits" passes the figure guard. Recommended tests R-1 to R-6 |
| 2026-10-07 | QA follow-ups applied; ready for user review | SA code review approved. QA PASS WITH NOTES: D1 (focus returns to Top up on close via `returnFocusRef` + `onCloseAutoFocus`), D2 ("5,000 credits" now caught; a figure that equals a price in cents needs a credits word, after the dry run found `ceiling: 5_000`), I-2 (`role="status"`), R-1 to R-6 added. 64 tests in the 5a suites; broad set 239 suites / 5,847 green with the UsageCard suites unedited; tsc clean on both configs apart from the 24 existing duplicate keys. `CreditHistoryPanel` focus and I-3 / I-4 noted in §9 / §10. Nothing committed |
| 2026-10-07 | Approved and committed, PR open | The user saw the diff and approved the commit (2026-10-07). RM committed on `feature/bos-credits-boost-slice-5a` and opened a PR to `main` |
