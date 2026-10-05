# Workplan: Business OS credits boost — slice 1, price rule and package catalogue

> **Last Updated**: 2026-10-04

**Developer:** Dev
**Requirement:** [BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md): FR-1 to FR-5, FR-42, §8.1, §8.2, §18.3 T-3 (a)–(e), §18.5 slice 1, §18.6 item 3, §18.10 (re-baseline: slice 1 scope and gate, B-9, B-10, R-6 to R-13)
**Related:** [BUSINESS_OS_CREDIT_PRICING.md](/docs/architecture/BUSINESS_OS_CREDIT_PRICING.md) (credit value, markup D1, §6.3 change procedure), [BUSINESS_OS_ENTITLEMENTS.md](/docs/architecture/BUSINESS_OS_ENTITLEMENTS.md) (§ Importing the module from outside it, § Metering)
**Worktree:** `neuronforge-boost`
**Branch:** `feature/bos-credits-boost-slice-1`, cut from `origin/docs/bos-credits-boost-requirement` (`dd228b12`, PR #217, the requirement docs, itself off `main` `1a9944a5`). Confirmed with `git branch --show-current` on 2026-10-04. ⚠️ The branch currently tracks `origin/docs/bos-credits-boost-requirement`; RM sets its own upstream at push, and this slice's PR is stacked on #217 (merge #217 first, or retarget).
**Date:** 2026-10-04
**Status:** **Approved and committed 2026-10-05** (user approved the diff; PR open to main, link to fill). **QA 2026-10-04: PASS WITH NOTES** (no bug; Low E-1/E-2, see QA Testing Report). **SA code review 2026-10-04: approved after the CR-1 to CR-3 re-check.** Code Complete 2026-10-04. SA workplan review: approved with conditions C-1 to C-6, all applied (see SA Review Notes). Local bar green (§6.5).

## Overview

Slice 1 gives the credits boost its two numbers-of-record, in code, before anything can sell. It adds the **markup** as a versioned, append-only config (`creditRetail.ts`), so the **base rate** (500 credits per $1) is *computed* from the credit value and the markup instead of being typed anywhere (SA F-3, T-3a). It adds the **package catalogue** (`boostPackages.ts`: Starter, Plus, Max) as plain data in which the only typed commercial numbers are the price and the bonus percentage, with base, bonus and total credits *derived* in integer arithmetic and the displayed bonus % recomputed from credits (FR-42). One **loader seam** (`BoostPackageSource`) is the only way to read the catalogue, so a later move to a database table is a loader swap (FR-3), and an invalid catalogue **fails closed** at run time and fails a Jest test in CI (FR-2). It also holds the **default purchase cap** constant ($150 per 30 days, FR-22). It is config, pure functions, tests and two doc paragraphs: no route, no UI, no migration, no Stripe, no new CI job.

## Table of Contents

1. [Analysis Summary](#1-analysis-summary)
2. [Scope, out of scope and guardrails](#2-scope-out-of-scope-and-guardrails)
3. [Implementation Approach](#3-implementation-approach)
4. [Files to Create / Modify](#4-files-to-create--modify)
5. [Task List](#5-task-list)
6. [Test Plan](#6-test-plan)
7. [CI impact](#7-ci-impact)
8. [Entitlements registration](#8-entitlements-registration)
9. [Estimate and risks](#9-estimate-and-risks)
10. [Open questions for SA](#10-open-questions-for-sa)
11. [SA Review Notes](#sa-review-notes)
12. [QA Testing Report](#qa-testing-report)
13. [Commit Info](#commit-info)
14. [Change History](#change-history)

---

## 1. Analysis Summary

**What exists (verified in this worktree, 2026-10-04):**

| Thing | Where | Relevance |
|---|---|---|
| Credit value, append-only, versioned (v1 `derived`, $0.001) | `lib/business-os/entitlements/config/creditValue.ts` + `creditValue.history.json`, guarded by `__tests__/creditValue.test.ts` | Source of `usdPerCredit`. **Not edited** (guardrail). Its pattern (data-only file, JSON snapshot, append-only test, "imports nothing at run time" test) is reused verbatim for the markup |
| The markup (100%, decision D1) | Only in [BUSINESS_OS_CREDIT_PRICING.md](/docs/architecture/BUSINESS_OS_CREDIT_PRICING.md) §2 and the prose `derivation` string of credit value v1 | **Not in code** (SA V-5 / F-3, re-confirmed §18.10 B-9). This slice gives it a home |
| Config loader seam with lazy validation | `lib/business-os/entitlements/source.ts` (`readCodeConfig`, RC-7: nothing validated at import time) + `schema.ts` (Zod) | Pattern reused for `BoostPackageSource`: data files stay data, Zod lives beside the seam, validation is lazy |
| `Labels` (`{ en, he, es }`) | `lib/business-os/entitlements/types.ts:87` | Reused for package names, descriptions and badges (FR-1) |
| Minor-unit helper | `lib/payments/refundMath.ts` `minorUnitsPerMajor` (:44) | Reused so no `× 100` appears (NFR-9) |
| CI that runs this folder | `npm run test:bos-entitlements` (job "Business OS entitlements invariants", `.github/workflows/bos-entitlements.yml`) and the every-PR Jest gate (#210, `tests.yml`); `tsc` over `lib/business-os/entitlements/` in `bos-llm-typecheck.yml` | FR-2's test lives under `lib/business-os/entitlements/__tests__/`, so all three pick it up with no workflow edit (F-9, B-10) |
| Credit lots (`credits_base`, `credits_bonus`, `credits_granted`) | migration `20261017`, `lib/business-os/credits/creditLots.ts` | **Not touched.** Slice 2/4a will write a boost lot's base and bonus from the figures this slice derives |
| Credit-figure guard | `__tests__/creditFigures.fromConfig.guard.test.ts` | Exempts `entitlements/config/**` by design. Not touched in slice 1; slice 5 must add the picker to its `SOURCES` (noted for slice 5) |

**What this slice touches:** two new config files and one JSON snapshot in `lib/business-os/entitlements/config/`, two new pure modules in `lib/business-os/entitlements/`, four new test files in `lib/business-os/entitlements/__tests__/`, and doc paragraphs in the pricing doc, the entitlements doc and the requirement. **No DB table, no route, no provider, no plugin, no V6 pipeline phase.**

---

## 2. Scope, out of scope and guardrails

### In scope

| # | Item | Requirement |
|---|---|---|
| S-1 | `creditRetail.ts`: versioned, append-only markup history; v1 = markup 1.0 paired with credit value v1, decided 2026-09-30 (D1) | §8.1, T-3a, F-3 |
| S-2 | The computed retail (base) rate: credits per US dollar and per minor unit, from credit value × (1 + markup); never typed | §8.1, FR-42, T-3a |
| S-3 | `boostPackages.ts`: Starter / Plus / Max as data (id, version, priceMinor, currency, taxExclusive, bonusPercent, active, order, labels, optional badge, retailVersion) | FR-1, §8.2, T-3b |
| S-4 | Zod schema, integer derivation of base / bonus / total credits, computed bonus %, whole-catalogue validation | FR-2, FR-42, T-3b |
| S-5 | `BoostPackageSource` loader seam + the code-config implementation; fails closed | FR-3, FR-5, T-3c |
| S-6 | Default purchase cap constant ($150, USD, 30 days) | FR-20, FR-22, T-10 ("a config constant beside the catalogue") |
| S-7 | Tests in `lib/business-os/entitlements/__tests__/` (run by the entitlements job and the Jest gate) | FR-2, F-9, B-10 |
| S-8 | Docs: pricing doc (one paragraph at the end of §6.3, SA C-6), entitlements doc (one paragraph at the end of Metering, SA C-6), requirement status + Change History | CLAUDE.md doc standards; feedback "always update main requirement" |

### Explicitly out of scope

| Not in slice 1 | Where it goes |
|---|---|
| Any migration, `business_os_boost_purchases`, `business_os_boost_cap_overrides`, any SQL function | Slice 2 (migration 20261030) |
| Any route (checkout, history, admin), any Stripe call, inline `price_data`, `tax_behavior`, Adaptive Pricing | Slices 3, 4a |
| The cap **check** (summing purchases, per-account override) | Slice 2 (reserve function) + slice 3 + slice 6 |
| Any UI: picker, badges on screen, "excluding tax" wording, number formatting, `$` display | Slice 5 |
| Native Hebrew / Spanish copy for package names, descriptions, badges | Slice 5 (English fills all three now, FR-1) |
| Any change to `creditValue.ts`, its JSON, the tier matrix, the catalog, cohorts or `entitlements.snapshot.json` | Never in this slice (guardrail G-1) |
| Any import of the new modules from outside `lib/business-os/entitlements/` | Slice 2/3, which register the importers then (§8) |
| A feature flag | Slice 3 (the server flag that gates checkout, F-14). Slice 1 ships nothing reachable, so it needs none |
| Retiring the AgentsPilot boost (`boost_packs`) | Slice 7 |

### Guardrails (must not)

| # | Guardrail | How it is checked |
|---|---|---|
| G-1 | `creditValue.ts` and `creditValue.history.json` are byte-identical | `git diff --stat` shows neither; `creditValue.test.ts` still green |
| G-2 | No typed base rate or credit figure: the strings `500`, `5000`/`5,000`, `12500`, `13750`, `25000`, `28750` (any grouping) do not appear in any new non-test source, comments excluded. **(SA C-1)** The values of `priceMinor:` and `amountMinor:` properties are skipped (money in minor units is a typed input by design; Max's `priceMinor` is 5000) | New source guard test (T-B9), with the C-1 negative control |
| G-3 | The two config files are **data only**: no run-time imports (type imports allowed) | "imports nothing at run time" tests, same as `creditValue.test.ts` |
| G-4 | Importing any new module does no validation and cannot throw (RC-7) | Test T-B13 |
| G-5 | No new file outside `lib/business-os/entitlements/` imports the module; no capability id or tier name literal added | `npm run test:bos-entitlements` green (enforcementPoints, tierLiteral guards) |
| G-6 | No `console.*`; no logging at all in these pure modules (the caller logs, slice 3) | Grep in review |
| G-7 | No `any` | Review + `bos-llm-typecheck` |
| G-8 | No new npm dependency, workflow, script or CI job | `git diff --stat` |

---

## 3. Implementation Approach

### 3.1 `config/creditRetail.ts` — the markup, append-only (T-3a)

A copy of the `creditValue.ts` pattern, data only:

```typescript
export interface CreditRetailVersion {
  /** Recorded (via the package snapshot) on every boost purchase. 1, 2, 3 … no gaps. */
  version: number;
  /** Markup over measured AI cost: 1.0 = 100% (owner pays 2× cost). Finite, >= 0. */
  markup: number;
  /** The `CREDIT_VALUE_HISTORY` version this markup applies to. */
  creditValueVersion: number;
  /** ISO date the markup was decided. */
  decidedOn: string;
  /** Why, in words; points at the pricing doc rather than restating it. */
  derivation: string;
}

export const CREDIT_RETAIL_HISTORY = [
  { version: 1, markup: 1, creditValueVersion: 1, decidedOn: '2026-09-30',
    derivation: 'Decision D1 (user, 2026-09-30): 100% markup … docs/architecture/BUSINESS_OS_CREDIT_PRICING.md.' },
] as const satisfies readonly CreditRetailVersion[];

export function currentCreditRetail(): CreditRetailVersion { … last entry … }
```

**Why versions start at 1, not 0:** there was never a provisional markup in code; v1 is the decision D1. (SA question Q-6.)
**Why a separate file and not a field on `creditValue.ts`:** credit value v1 is shipped and append-only, and the pricing doc §1 says the credit "carries no markup". A markup change must not mint a new credit value version (that would imply a change to recorded charges).
**Snapshot:** `config/creditRetail.history.json`, extended by hand in the same PR as any append, exactly as `creditValue.history.json`.

### 3.2 `retailRate.ts` — the computed base rate (S-2)

Pure, in `lib/business-os/entitlements/` (not in `config/`, because it holds logic):

```typescript
export interface RetailRate {
  retailVersion: number;
  creditValueVersion: number;
  /** Credits one US dollar buys at the standard rate. Computed; 500 today. */
  creditsPerUsd: number;
}
export type RetailRateResult = { ok: true; rate: RetailRate } | { ok: false; issue: string };

/** 1 / (usdPerCredit × (1 + markup)), required to be a whole number of credits. */
export function retailRateFor(retail: CreditRetailVersion, value: CreditValueVersion): RetailRateResult;
/** The current retail entry against the CURRENT credit value; refuses a stale pairing. */
export function currentRetailRate(): RetailRateResult;
/** Whole credits a price buys at the rate; refuses a price that does not convert exactly. */
export function baseCreditsFor(priceMinor: number, currency: string, rate: RetailRate): number | null;
```

**Integer discipline.** `1 / (0.001 × 2)` evaluates to exactly `500` in IEEE-754 (checked: `node -e` prints `500`), but the function does not rely on that: it rounds to the nearest integer and refuses the rate (`ok: false`) unless the raw value is within 1e-9 relative of it. A markup that gives a fractional rate (e.g. 0.5 → 666.67 per $1) is therefore *invalid*, not silently rounded. Credits for a price are then `priceMinor × creditsPerUsd / minorUnitsPerMajor(currency)` in integers, refused (`null`) unless the division is exact. No float multiply of money, no `× 100` (NFR-9).

**Stale pairing fails closed.** `currentRetailRate()` refuses when the last retail entry's `creditValueVersion` is not the current credit value's version. So appending credit value v2 without deciding the markup against it makes the boost catalogue invalid (checkout refuses) rather than selling at a rate nobody decided.

### 3.3 `config/boostPackages.ts` — the catalogue as data (S-3, S-6)

Data only. The only typed commercial numbers per package are `priceMinor` and `bonusPercent` (T-3b):

```typescript
export interface BoostPackageConfig {
  id: string;                 // stable slug: 'starter' | 'plus' | 'max'
  version: number;            // bump on ANY change to this package (FR-4)
  priceMinor: number;         // 1000 = $10.00
  currency: 'USD';            // FR-28
  taxExclusive: true;         // §9 TX-1
  bonusPercent: number;       // integer; 0 | 10 | 15
  active: boolean;            // FR-5
  order: number;              // display order
  labels: { name: Labels; description: Labels; badge?: Labels };
  retailVersion: number;      // the CREDIT_RETAIL_HISTORY entry the package was priced against
}

export const BOOST_PACKAGES = [ /* starter, plus (badge "Most popular"), max (badge "Best value") */ ]
  as const satisfies readonly BoostPackageConfig[];

/** FR-20 / FR-22: the default cap. Per-account overrides are slice 2/6. */
export const BOOST_PURCHASE_CAP_DEFAULT = { amountMinor: 15000, currency: 'USD', windowDays: 30 } as const;
```

Labels: English in all three locales for now (FR-1 allows it); native he/es review is a slice 5 item. **No credit figure and no bonus text in any label** (FR-42); the schema rejects a digit or `%` in any label, so a hand-typed "+10%" cannot slip into a badge.

### 3.4 `boostCatalogue.ts` — schema, derivation, validation and the loader seam (S-4, S-5)

Pure, in `lib/business-os/entitlements/`, following `source.ts` + `schema.ts`:

```typescript
export interface BoostPackage {            // what every consumer reads
  id: string; version: number;
  priceMinor: number; currency: 'USD'; taxExclusive: true;
  baseCredits: number;  bonusCredits: number;  totalCredits: number;   // derived
  bonusPercent: number;                                               // recomputed from credits (FR-42)
  active: boolean; order: number;
  labels: { name: Labels; description: Labels; badge: Labels | null };
  retailVersion: number; creditValueVersion: number;                  // FR-4 snapshot inputs
}

export const boostPackageConfigSchema: z.ZodType<BoostPackageConfig>;   // .strict()
export function bonusPercentFromCredits(baseCredits: number, totalCredits: number): number | null;
export function resolveBoostPackage(config: BoostPackageConfig, rate: RetailRate): ResolveResult;
export function validateBoostCatalogue(
  packages: readonly unknown[], rateResult: RetailRateResult, cap: typeof BOOST_PURCHASE_CAP_DEFAULT,
): { ok: true; packages: BoostPackage[] } | { ok: false; issues: string[] };

export interface BoostPackageSource {                // T-3c, verbatim
  listActive(): Promise<BoostPackage[]>;              // active only, by `order`
  getActive(id: string): Promise<BoostPackage | null>; // null = unknown OR inactive (FR-5)
}
export class BoostCatalogueInvalidError extends Error { readonly issues: string[] }
export function codeBoostPackageSource(): BoostPackageSource;  // reads BOOST_PACKAGES, lazy, memoised
```

**Derivation (integers only):**
`baseCredits = baseCreditsFor(priceMinor, currency, rate)`;
`totalCredits = baseCredits × (100 + bonusPercent) / 100`, required exact;
`bonusCredits = totalCredits − baseCredits`;
`bonusPercent (shown) = bonusPercentFromCredits(base, total) = (total − base) × 100 / base`, required to equal the configured `bonusPercent` (the round-trip is FR-2's two identities and FR-42's formula, `total ÷ (price × rate) − 1`, in one check).

**`bonusPercentFromCredits` takes credits, not a rate,** on purpose: slice 5's purchase history computes the shown bonus from the base and bonus credits stored on the purchase / lot row, so a later rate change never rewrites a past purchase's bonus (FR-4).

**Validation rules** (each with a named issue string, each tested in §6):

| Rule | Catches |
|---|---|
| Strict object: unknown keys refused | a hand-typed `baseCredits` / `totalCredits` / `bonusCredits` / `bonusLabel` in config (FR-42) |
| `id` matches `^[a-z][a-z0-9_]{1,31}$`, unique | typos, duplicates |
| `version` positive integer | |
| `priceMinor` positive integer, ≤ the default cap | a package that could never be bought |
| `currency === 'USD'` | FR-28 |
| `taxExclusive === true` | TX-1 |
| `bonusPercent` integer, 0 ≤ x ≤ 50 | a typo of 150 for 15 (upper bound: SA Q-4) |
| `order` integer, unique among active | ambiguous display |
| every label has non-empty `en`, `he`, `es`; no digit and no `%` | hand-typed bonus or credit text |
| `retailVersion === current retail version` | a markup change that left packages unreviewed (fails closed) |
| price converts to whole base credits; bonus to whole total credits | fractional credits |
| recomputed bonus % === configured `bonusPercent` | drift between credits and the advertised bonus |
| at least one active package | an empty picker |
| cap: positive integer `amountMinor`, `USD`, `windowDays` positive integer | |
| rate result `ok` | stale credit value / markup pairing, fractional rate |

**Fail-closed at run time (FR-2, T-3c).** `codeBoostPackageSource()` validates on the first `listActive` / `getActive` call (never at import, RC-7), memoises the result **per source instance** (SA C-3; the module exports one singleton accessor, and tests build fresh instances so they never share a memo; a memoised failure is acceptable because the catalogue is code and the fix is a deploy), and on failure rejects with `BoostCatalogueInvalidError` carrying the issues. It does not log: the caller (slice 3's checkout) catches it, logs one `error` with the issues, and refuses the checkout; nothing else imports the catalogue, so no other route is affected. A rejected promise rather than an empty list, because an empty picker would hide a broken catalogue as "nothing to sell".

**Async on purpose:** matches T-3c and `balance.ts`, so a later `DbBoostPackageSource` (which reads a table and runs the same `validateBoostCatalogue`) is an implementation swap with no caller change (FR-3).

### 3.5 Version and snapshot discipline (FR-4)

`config/boostPackages.snapshot.json` records every released `(id, version)` **resolved** (derived credits, computed bonus, retail and credit value versions, price, currency, tax flag, active). A test requires every package in the config to appear in the snapshot with an identical resolved form. Consequence:

- Editing a package's price, bonus or labels **without** bumping its version → red.
- A markup or credit value change that shifts a package's credits under the same version → red (and `retailVersion` mismatch also fails validation). This is the acceptance criterion "changing the base rate in a test either changes the shown bonus or fails validation".
- A new version → appended to the snapshot by hand in the same PR (same strength and same caveat as `creditValue.history.json`: catches accidents, not a determined edit; the PR and SA review are the audit record).

**Why resolved values in the snapshot, not only the config:** the purchase row (slice 2) will store the resolved figures; the snapshot is the reviewable record of what each `(id, version)` meant.

---

## 4. Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `lib/business-os/entitlements/config/creditRetail.ts` | create | Markup history, append-only, data only (S-1) |
| `lib/business-os/entitlements/config/creditRetail.history.json` | create | Snapshot for the append-only test |
| `lib/business-os/entitlements/config/boostPackages.ts` | create | Catalogue data + default cap constant (S-3, S-6). Path named by FR-2 |
| `lib/business-os/entitlements/config/boostPackages.snapshot.json` | create | Released `(id, version)` resolved records (§3.5) |
| `lib/business-os/entitlements/retailRate.ts` | create | Computed base rate (S-2) |
| `lib/business-os/entitlements/boostCatalogue.ts` | create | Zod schema, derivation, validation, `BoostPackageSource`, code source, error type (S-4, S-5) |
| `lib/business-os/entitlements/__tests__/creditRetail.test.ts` | create | Append-only + pairing tests |
| `lib/business-os/entitlements/__tests__/retailRate.test.ts` | create | Rate maths, failure paths |
| `lib/business-os/entitlements/__tests__/boostCatalogue.test.ts` | create | Happy path, every validation failure, loader, fail-closed |
| `lib/business-os/entitlements/__tests__/boostCatalogue.guard.test.ts` | create | Source guards: no typed figures (G-2), data-only configs (G-3), lazy import (G-4), snapshot (§3.5) |
| `docs/architecture/BUSINESS_OS_CREDIT_PRICING.md` | modify | **(SA C-6)** One paragraph at the end of §6.3 (markup in `creditRetail.ts`, the computed base rate, re-versioning packages) + a Change History row. Nothing restructured |
| `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` | modify | **(SA C-6)** One paragraph at the end of Metering + a Change History row: "The retail rate and the boost catalogue (boost slice 1)" — files, the computed rate, the loader seam, fail-closed, no importer yet; Change History |
| `docs/requirements/BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md` | modify | Status line + Change History row "Slice 1 — workplan drafted" (done with this workplan) |

Not modified: `creditValue.ts`, `creditValue.history.json`, `schema.ts`, `source.ts`, `types.ts`, `enforcementPoints.ts`, `__tests__/enforcementPoints.test.ts`, `package.json`, any workflow.

---

## 5. Task List

- ✅ Step 0: Confirm branch; apply SA conditions C-1 to C-6 to this workplan; set up the Q-1 scratch Jest config and tsconfig in the session scratchpad (never in the repo, no junction)
- ✅ Step 1: `config/creditRetail.ts` + `creditRetail.history.json` (v1, markup 1, credit value v1, 2026-09-30, D1)
- ✅ Step 2: `creditRetail.test.ts` (append-only snapshot, negative control, version sequence, pairing exists in `CREDIT_VALUE_HISTORY`, never backwards, decidedOn/derivation, data-only)
- ✅ Step 3: `retailRate.ts` + `retailRate.test.ts` (500 per $1; fractional rate refused; stale pairing refused; `baseCreditsFor` exact / refused)
- ✅ Step 4: `config/boostPackages.ts` (three packages, English labels in en/he/es, badges on Plus and Max, `BOOST_PURCHASE_CAP_DEFAULT`)
- ✅ Step 5: `boostCatalogue.ts`: schema, `bonusPercentFromCredits`, `resolveBoostPackage`, `validateBoostCatalogue`
- ✅ Step 6: `boostCatalogue.ts`: `BoostPackageSource`, `BoostCatalogueInvalidError`, `codeBoostPackageSource()` (lazy, memoised, rejects on invalid)
- ✅ Step 7: `boostCatalogue.test.ts` (happy path figures; every validation failure; loader behaviour; fail-closed)
- ✅ Step 8: `boostPackages.snapshot.json` + `boostCatalogue.guard.test.ts` (snapshot equality + negative control, no typed figures, data-only configs, lazy import)
- ✅ Step 9: Docs: (SA C-6) one paragraph at the end of pricing doc §6.3 and one at the end of entitlements doc Metering, both Change Histories
- ✅ Step 10: (SA C-2) Run the Q-1 runner with `--runTestsByPath` on the four new suites + `enforcementPoints`, `accountSeam.guard`, `tierLiteral.forbidden`, `creditFigures.fromConfig.guard`, `creditValue`, `catalog.invariant`; run the scoped tsc and filter to `lib/business-os/entitlements/`; record results here
- ✅ Step 11: `git diff --stat` (G-1, G-8: no deletion-without-insertion, no file outside the list), status → Code Complete, hand to SA. **Leave uncommitted.**

---

## 6. Test Plan

All tests live in `lib/business-os/entitlements/__tests__/`, so `npm run test:bos-entitlements` and the every-PR Jest gate both run them. No mocks of anything external; the "planted" cases pass hand-built catalogues and rates into the pure functions.

### 6.1 Happy path

| # | Test | Expect |
|---|---|---|
| T-H1 | `currentRetailRate()` | `ok`, `creditsPerUsd === 500`, `retailVersion 1`, `creditValueVersion 1` |
| T-H2 | Shipped catalogue validates (**this is FR-2's test**) | `ok`, three packages |
| T-H3 | Approved business figures (pinned in the test, where figures are allowed) | Starter $10 / 5,000 base / 0 bonus / 5,000 total / 0%; Plus $25 / 12,500 / 1,250 / 13,750 / 10% / badge; Max $50 / 25,000 / 3,750 / 28,750 / 15% / badge; all USD, tax-exclusive, active |
| T-H4 | FR-2 identities on every package | `base === priceMinor × creditsPerUsd / 100`; `total === base × (100 + bonus) / 100`; `bonus + base === total` |
| T-H5 | FR-42: the shown bonus is computed | `bonusPercentFromCredits(base, total)` equals each package's `bonusPercent`; Starter 0, Plus 10, Max 15 |
| T-H6 | `listActive()` | active only, ordered Starter, Plus, Max |
| T-H7 | `getActive('plus')` | the Plus package; same object shape as in `listActive` |
| T-H8 | Default cap | 15,000 minor USD, 30 days, ≥ the most expensive active package |
| T-H9 | `bonusPercentFromCredits` on stored figures | works from credits alone, no rate argument (history use, FR-4) |

### 6.2 Failure paths

| # | Planted input | Expect |
|---|---|---|
| T-F1 | Retail markup 0.5 (rate 666.67 per $1) | `retailRateFor` → `ok: false`, "rate is not a whole number of credits" |
| T-F2 | Retail entry paired with credit value v0 while current is v1 | `currentRetailRate`-style check → `ok: false` (stale pairing) |
| T-F3 | Hypothetical retail v2 (markup 1.5 → 400 per $1), packages still on `retailVersion 1` | catalogue invalid (retailVersion stale) — the AC "changing the base rate … fails validation" |
| T-F4 | Same v2 with packages re-pointed to v2 but versions not bumped | resolves (credits 4,000 / 11,000 / 23,000), but the snapshot test's comparison flags all three `(id, version)` as changed — the AC's other branch |
| T-F5 | A package with a hand-typed `totalCredits` (or `bonusCredits`, `baseCredits`) key | schema refuses (strict) |
| T-F6 | Badge "Best value +15%" / name "Starter 5000" | refused: digit or `%` in a label |
| T-F7 | Missing `he` label / empty `es` | refused |
| T-F8 | `currency: 'EUR'` | refused |
| T-F9 | `taxExclusive: false` | refused |
| T-F10 | `priceMinor` 0, −100, 10.5 | refused |
| T-F11 | `priceMinor` 20,000 (above the $150 cap) | refused |
| T-F12 | `bonusPercent` −5, 7.5, 150 | refused |
| T-F13 | `bonusPercent` that gives fractional credits (e.g. price 1001 → 5,005 base at 3% → 5,155.15) | refused |
| T-F14 | Duplicate `id`; duplicate active `order` | refused |
| T-F15 | All packages inactive | refused (empty catalogue) |
| T-F16 | `getActive('nope')`; `getActive` of a planted inactive package | `null` both (FR-5) |
| T-F17 | `codeBoostPackageSource` over a planted invalid catalogue (via an injectable source factory used only by tests) | `listActive` and `getActive` **reject** with `BoostCatalogueInvalidError` whose `issues` name the rule; a second call rejects the same way (memoised) |
| T-F18 | Snapshot negative controls | editing a planted copy's `bonusPercent` under the same version is detected; **(C-4)** a planted snapshot with a released record removed or edited is detected |
| T-F19 | Source guard negative control | the figure scanner detects a planted `'500'`, `5,000`, `13_750` and ignores comments |

### 6.3 Guards

| # | Guard |
|---|---|
| T-B9 | **(SA C-1)** `priceMinor:` / `amountMinor:` values are skipped; negative control: planted `baseCredits: 5000` is caught, `priceMinor: 5000` is not. No credit figure or base rate typed in `config/boostPackages.ts`, `config/creditRetail.ts`, `retailRate.ts`, `boostCatalogue.ts` (comments stripped; the scanner reuses the pattern style of `creditFigures.fromConfig.guard.test.ts`, kept local, not imported from that test) |
| T-B10 | `creditRetail.ts` and `boostPackages.ts` have no run-time imports (type-only allowed) |
| T-B11 | `creditRetail.history.json` equals `CREDIT_RETAIL_HISTORY`; no released entry edited; versions 1, 2, … no gap; each `creditValueVersion` exists in `CREDIT_VALUE_HISTORY` and never goes backwards; **(SA C-5)** the shipped last retail entry pairs with the shipped `currentCreditValue().version` |
| T-B12 | Every config package's resolved form equals its `(id, version)` record in `boostPackages.snapshot.json`; **(SA C-4)** the snapshot is append-only: no record is ever edited or removed, even after a package goes inactive or a version is dropped from config |
| T-B13 | `jest.isolateModules` import of `boostCatalogue.ts` with a planted invalid catalogue does not throw (lazy, RC-7) |

### 6.4 Commands (definition of done)

**(SA C-2)** The worktree has no `node_modules`, so locally the SA's Q-1 procedure is used: a scratch Jest config and a scratch `tsconfig.worktree.json`, both in the session scratchpad (never in the repo), pointing at the main checkout's `node_modules`.

```bash
node "../neuronforge/node_modules/jest/bin/jest.js" -c <scratch>/jest.worktree.config.js --rootDir . --runTestsByPath <files…>
node "../neuronforge/node_modules/typescript/bin/tsc" -p <scratch>/tsconfig.worktree.json   # filter to lib/business-os/entitlements/
```

**Local definition of done:** (a) the four new suites plus `enforcementPoints`, `accountSeam.guard`, `tierLiteral.forbidden`, `creditFigures.fromConfig.guard`, `creditValue` and `catalog.invariant` all green; (b) 0 tsc errors in `lib/business-os/entitlements/`. `npm run test:bos-entitlements` and `npm run typecheck:bos-llm` are run **by CI on the PR** (the entitlements job, the Jest gate and the required type-check job).

Results are recorded in §6.5 before SA code review. No manual QA path exists (nothing is reachable from the product); QA re-runs the local bar and reviews the failure-path table.

### 6.5 Results (Dev, 2026-10-04)

| Check | Result |
|---|---|
| Four new suites (`creditRetail`, `retailRate`, `boostCatalogue`, `boostCatalogue.guard`) | ✅ 4 suites, **72 tests passed** |
| Local bar: the four + `enforcementPoints`, `accountSeam.guard`, `tierLiteral.forbidden`, `creditFigures.fromConfig.guard`, `creditValue`, `catalog.invariant` (Q-1 runner, `--runTestsByPath`) | ✅ **10 suites, 252 tests passed**, 26 s |
| Scoped tsc (`tsconfig.worktree.json`, filtered to `lib/business-os/entitlements/`) | ✅ **0 errors in the module**. 8 errors total, all pre-existing and outside it (`lib/analytics/aiAnalytics.ts` 6, `lib/services/EmbeddingService.ts` 2), matching the SA's baseline |
| Mutation check (Plus `bonusPercent` 10 → 12 planted, then restored) | ✅ 5 tests went red (approved figures, identities, snapshot drift, banned-figure derivation); restored and re-run green |
| `npm run test:bos-entitlements`, `npm run typecheck:bos-llm` | Run by CI on the PR (C-2) |

**SA code review fixes (Dev, 2026-10-04):**

| # | Fix | Test |
|---|---|---|
| CR-1 | `resolveBoostPackage` returns a **deep-frozen** package whose labels are **copies** (not the config's objects); the memo therefore holds frozen data. `BOOST_PACKAGES` and `BOOST_PURCHASE_CAP_DEFAULT` are declared `as const satisfies …` **and** deep-frozen at run time by a local `deepFreeze` (no run-time import, RC-7 kept) | New describe "the catalogue cannot be changed by a caller (SA CR-1)", 3 tests: writes to `priceMinor`, `totalCredits` and `labels.name.en` on a returned package throw `TypeError`, and a second `getActive('plus')` / `listActive()` still return $25 / 13,750 / 10% / "Plus"; resolved labels are equal to but not the same object as the config's; writes to the cap, to a shipped package, to its labels and a `push` onto `BOOST_PACKAGES` all throw, values unchanged |
| CR-2 | `boostPackageConfigSchema` is typed `z.ZodType<BoostPackageConfig>`; the `parsed.data as BoostPackageConfig` cast is gone | Scoped tsc |
| CR-3 | Header sentence in `boostCatalogue.ts`: an invalid inactive package fails the whole catalogue on purpose | — |

Re-run after the fixes: **10 suites, 255 tests passed** (252 + 3 new); scoped tsc **0 errors in `lib/business-os/entitlements/`** (8 total, the same pre-existing ones elsewhere).

**QA follow-ups (Dev, 2026-10-04, after QA PASS WITH NOTES):**

| # | Change | Test |
|---|---|---|
| E-1 | Label check widened to `/[\p{N}%\u066A\uFF05\uFE6A]/u`: any numeric character (digits in any script, ½, Roman numerals) and the Arabic, fullwidth and small percent signs. Number words remain a review item | R-7: `％`, `﹪`, `½`, `Ⅹ`, Arabic-Indic `١` refused; Hebrew / Spanish copy without figures still accepted |
| I-1 | `CREDIT_RETAIL_HISTORY` deep-frozen at run time with a local `deepFreeze` (no run-time import) | `creditRetail.test.ts`: writing `markup` or pushing an entry throws; markup still 1 |
| I-2 | `baseCreditsFor` accepts only the exact literal `'USD'`, matching the schema | `retailRate.test.ts`: `'usd'`, `' USD '` → `null` |
| R-1 | — | price 15,000 allowed, 15,001 refused against the cap |
| R-2 | — | bonus 50 resolves (Max → 37,500), 51 refused |
| R-3 | — | $9.99 → 4,995 at 0%, refused at 10%; $0.01 → 5, and 6 at 20%, refused at 10% (also `baseCreditsFor` 999 → 4,995, 1 → 5, 1001 → 5,005) |
| R-4 | — | schema refuses `'usd'`, `' USD'`, `'USD '` |
| R-5 | — | `getActive` returns `null` for `'PLUS'`, `'Plus'`, `' plus'`, `'plus '`, `''`, `'__proto__'`, `'constructor'` |
| R-6 | — | `listActive` returns a fresh array; truncating one leaves the next at 3 |
| E-2 | No code change; recorded in SA C-7 for slice 3 | — |

Re-run after the follow-ups: **10 suites, 278 tests passed** (255 + 23 new); scoped tsc **0 errors in `lib/business-os/entitlements/`** (8 total, the same pre-existing ones elsewhere).

**Deviations from the plan (small, for SA code review):**
- `baseCreditsFor` also refuses any currency other than USD (the rate is per US dollar; no exchange rate exists, FR-28). Tested.
- The snapshot's append-only rule (C-4) is enforced by a `RELEASED` list in `boostCatalogue.guard.test.ts`: each released `id@version` with a 16-hex SHA-256 fingerprint of its canonical record. A new version appends a line; editing or removing a record is caught (negative controls). Same "accident guard, not tamper-proof" strength as `creditValue.history.json`.
- The banned-figure list in T-B9 is derived from the shipped catalogue and rate (plus a non-vacuity check that it holds 500 / 5,000 / 12,500 / 13,750 / 25,000 / 28,750), so a re-price keeps the guard meaningful.
- `createBoostPackageSource(load)` is exported as the injectable factory (C-3 / T-F17); `codeBoostPackageSource()` is the module singleton over it.
- Labels may not contain a digit in any script (`\p{Nd}`) or `%` / Arabic percent sign, not only ASCII digits.

---

## 7. CI impact

| Question | Answer |
|---|---|
| New job, workflow, script or dependency? | **None.** The tests sit under a path `test:bos-entitlements` already runs (F-9) and the Jest gate (#210) already shards |
| Added time | Four small pure test files, no I/O beyond reading three local files: well under 1 s in a ~10 s job; negligible per Jest-gate shard. Inside the existing critical path (`next build`), per the "no added CI time" rule |
| Does it block a merge? | Only once the user makes "Business OS entitlements invariants" / "Gate tests (jest)" required (B-10). Until then a red result is visible but not blocking; the Dev and QA run it locally regardless (skill DoD) |
| Type-check | New files are inside `bos-llm-typecheck`'s `tsc` scope (a required check), so a type error in them fails a required check |

---

## 8. Entitlements registration

Slice 1 adds **no importer from outside** `lib/business-os/entitlements/`: every new non-test file is inside the module, and test files are exempt. Therefore no `ENFORCEMENT_POINTS` or `KNOWN_NON_GATE_IMPORTERS` entry is added now, and the `enforcementPoints.test.ts` equality lists stay untouched (which also avoids the RV-8 rebase friction on that file).

The first outside importers arrive in slice 2 (the purchase repository, if it reads the types) and slice 3 (the checkout route / `lib/business-os/boost/`). They are **not gates** in the skill's sense (they refuse by catalogue validity and by cap, never by plan or capability), so each will be a `KNOWN_NON_GATE_IMPORTERS` entry with its exact symbols (`codeBoostPackageSource`, `BoostPackage`, `BoostCatalogueInvalidError`, `BOOST_PURCHASE_CAP_DEFAULT`, …) and a `why`. Those workplans must say so. The `business-os-entitlements` skill's DoD (`npm run test:bos-entitlements` green) is still run on this slice.

---

## 9. Estimate and risks

**Estimate:** ~1.5 days (SA's 1.5–2 d; the lower end because the lots tables and registrations already exist).

| Risk | Mitigation |
|---|---|
| Float drift in the rate | Integer domain after one guarded rounding; fractional results refused, not rounded (T-F1, T-F13) |
| Package numbers silently follow a later markup change | `retailVersion` pinned per package + resolved snapshot (§3.5, T-F3, T-F4) |
| A hand-typed bonus label | Strict schema + no digits/`%` in labels (T-F5, T-F6) |
| A bad catalogue takes a route down | Lazy validation, typed rejection, only the boost checkout imports it (T-B13, T-F17) |
| Rebase friction with parallel sessions | Slice 1 touches no shared guard list and no shared config file; only new files plus doc paragraphs |
| Stacked on unmerged PR #217 | Merge #217 first, or RM retargets; slice 1 code does not depend on #217's content, only its docs |

---

## 10. Open questions for SA

| # | Question | Dev's proposal |
|---|---|---|
| Q-1 | (Process, for TL) This worktree has no `node_modules`. How should Dev run Jest/tsc? | Ask the user; do not create the shared junction (memory: junction hazard) |
| Q-2 | T-3b says `boostPackages.ts` is "data plus a Zod schema". The existing convention (RC-7, `creditValue.ts`, `source.ts` + `schema.ts`) keeps config files data only, with Zod beside the loader. | Keep the data in `config/boostPackages.ts` and the Zod schema in `boostCatalogue.ts`. Same validation, follows the existing pattern |
| Q-3 | Runtime fail-closed signal: reject with `BoostCatalogueInvalidError`, or return `[]` / `null` and let the caller detect? | Reject (an empty list hides a broken catalogue as "nothing to sell"); the caller logs `error` and refuses |
| Q-4 | Upper bound on `bonusPercent` | 50 (catches 150-for-15 typos; Max is 15). Raising it is a one-line reviewed change |
| Q-5 | Should a package's `retailVersion` be required to equal the **current** retail version (fail closed on a markup change), or may packages stay priced on an older retail entry? | Require current. A markup change then forces re-versioning the packages in the same reviewed PR |
| Q-6 | `CREDIT_RETAIL_HISTORY` starts at version 1 (no provisional v0), unlike credit value | Start at 1: there was no provisional markup |
| Q-7 | `BOOST_PURCHASE_CAP_DEFAULT` lives in `config/boostPackages.ts` (T-10 "beside the catalogue") rather than its own file | Same file; it is one constant |
| Q-8 | Snapshot of **resolved** packages (§3.5) as the version-bump guard — acceptable as the FR-4 accident guard, given it has the same "not tamper-proof" limit as `creditValue.history.json`? | Yes |
| Q-9 | Importing `minorUnitsPerMajor` from `lib/payments/refundMath.ts` into the entitlements module (NFR-9) — acceptable dependency direction? It is pure and has no imports | Yes; the alternative is a typed `100` |

**Business questions:** none. All figures, labels in English, the cap and USD/tax-exclusive are decided (§1, §8.2). Native he/es copy is a slice 5 item already noted in §8.2 of the requirement.

---

## SA Review Notes

### SA Workplan Review

**Reviewed by SA — 2026-10-04**
**Status:** ✅ Approved with conditions. The conditions are edits to this workplan. The Dev applies them as the first step of implementation, and no second review is needed.

The workplan matches requirement §18.10 (slice 1 scope, B-9, B-10), T-3 (a)–(e), FR-1 to FR-5 and FR-42. It is proportionate: about 1.5 days, config, pure functions and tests, nothing reachable. The guardrails are concrete and testable. I checked the approach against the `business-os-entitlements` skill and every guard that scans `lib/business-os/entitlements/`. I also ran the existing guards from this worktree using the runner procedure in Q-1.

#### Conditions

| # | Severity | Condition |
|---|---|---|
| **C-1** | **High (the guard would fail on the shipped data)** | **G-2 / T-B9 contradicts the catalogue.** The banned figure `5000` is also **Max's `priceMinor`** ($50.00 = 5000 minor units). Starter's base credits are 5,000. The cap's `amountMinor` 15000 and the prices 1000 / 2500 are not banned today, but they are the same kind of number. Make the figure scanner **ignore the value of `priceMinor:` and `amountMinor:` properties** (money in minor units is a typed input by design, T-3b), and keep the ban everywhere else. Add a negative control: a planted `baseCredits: 5000` is caught, while `priceMinor: 5000` is not. Do not work around it by expressing prices in major units. |
| **C-2** | Medium | **§5 step 0, §5 step 10 and §6.4 commands:** replace `npx jest …` and the npm scripts with the Q-1 runner procedure below, always using `--runTestsByPath` with the explicit file list. Record in §6.4 that `npm run test:bos-entitlements` and `npm run typecheck:bos-llm` are run **by CI on the PR** (the entitlements job, the Jest gate and the required type-check job), because the scripts cannot resolve modules without a worktree `node_modules`. The local definition of done is: (a) the four new suites plus `enforcementPoints`, `accountSeam.guard`, `tierLiteral.forbidden`, `creditFigures.fromConfig.guard`, `creditValue` and `catalog.invariant`, all green through the runner; (b) the scoped `tsc` run reports **0 errors in `lib/business-os/entitlements/`**. |
| **C-3** | Medium | **Memoisation scope.** `codeBoostPackageSource()` memoises its validation **per source instance** and is exported as a module-level singleton accessor. T-F17's injectable factory builds fresh instances, so tests never share a memo. A memoised failure is acceptable (the catalogue is code, so the fix is a deploy), and §3.4 says so in one sentence. |
| **C-4** | Low | **The snapshot is append-only, like the credit value history.** T-B12 also asserts that every `(id, version)` record already in `boostPackages.snapshot.json` is still present and unchanged. A released package version is never edited or removed, even after the package goes inactive. The config may drop an old version, and the snapshot keeps it. Add that negative control to T-F18. |
| **C-5** | Low | **The stale-pairing check covers both sides.** `currentRetailRate()` refuses when the last retail entry's `creditValueVersion` ≠ `currentCreditValue().version` (as written). T-B11 also asserts that the **shipped** last retail entry pairs with the **shipped** current credit value. Appending a credit value without a retail entry then fails in CI and not only at checkout. |
| **C-6** | Low | **Doc edits stay narrow.** The entitlements and pricing docs are edited often by the credit-deduction session. Add **one** paragraph each, plus a Change History row, at the end of the section named. Restructure nothing, to keep rebase friction low (RV-8). |
| **C-7** | Info | **For slices 2 and 3, recorded here so it is not lost:** their first outside importers are `KNOWN_NON_GATE_IMPORTERS` entries with exact symbols (as §8 says). The checkout's catch of `BoostCatalogueInvalidError` logs one `error` with `issues` and returns a user-safe refusal. Slice 5 adds the picker to `creditFigures.fromConfig.guard.test.ts`'s `SOURCES` (as §1 notes). **Added after QA (E-2, 2026-10-04):** the slice 3 checkout must refuse on **any** rejection from the source, not only `instanceof BoostCatalogueInvalidError` (a future DB-backed `load()` may throw a plain error, and it is not memoised). |

#### Rulings on §10

| Q | Ruling |
|---|---|
| **Q-1** (process) | **Agreed: no junction, no `npm install` in the worktree.** The coordinator's bare command **does not work as given.** I ran it, and Jest stops with "Preset ts-jest not found relative to rootDir". Node resolves upward, and `../neuronforge/node_modules` is a sibling directory, not a parent. **Procedure that works (verified 2026-10-04 in this worktree):** keep a scratch Jest config **outside the repo** (in the session scratchpad, never committed), with this content:<br>`const path = require('path'); const MAIN_NM = path.resolve('C:/Users/Barak/My Projects/AgentsPilot/neuronforge/node_modules'); const { preset, ...rest } = require(path.resolve(process.cwd(), 'jest.config.js')); module.exports = { ...rest, rootDir: process.cwd(), transform: { '^.+\\.tsx?$': [path.join(MAIN_NM, 'ts-jest'), {}] }, moduleDirectories: ['node_modules', MAIN_NM] };`<br>Run from the worktree root: `node "../neuronforge/node_modules/jest/bin/jest.js" -c <scratch>/jest.worktree.config.js --rootDir . --runTestsByPath <files…>`. Result: `creditValue`, `enforcementPoints` and `accountSeam.guard` passed, 95 tests in 8.7 s.<br>**tsc:** `typecheck:bos-llm` cannot run this way, because its baseline floods with `Cannot find name 'process'`. Use a scratch `tsconfig.worktree.json` (again outside the repo) that extends the worktree's `tsconfig.json`, with `baseUrl` = the worktree, `typeRoots` = `<main>/node_modules/@types`, `types: ["node","jest"]`, `paths: { "@/*": ["./*"], "*": ["<main>/node_modules/*", "<main>/node_modules/@types/*"] }`, `noEmit`, and `include` set to `lib/business-os/entitlements/**/*.ts`. Run `node <main>/node_modules/typescript/bin/tsc -p <scratch>/tsconfig.worktree.json`, then filter the output to `lib/business-os/entitlements/`. Today it reports **8 pre-existing errors, all outside the module** (`lib/analytics/aiAnalytics.ts`, `lib/services/EmbeddingService.ts`, reached through imports), and **0 in the module**. The bar is: 0 errors in the module. The required CI type-check stays the authority. |
| **Q-2** | **Agreed.** Data in `config/boostPackages.ts`, Zod in `boostCatalogue.ts`, following RC-7 and the `source.ts` + `schema.ts` pattern. FR-2's "validated by Zod" is met. T-3b's "data plus a Zod schema" meant the pair, not one file. |
| **Q-3** | **Agreed: reject with `BoostCatalogueInvalidError`.** An empty list would make a broken catalogue look like "nothing to sell". `getActive` still returns `null` for unknown or inactive ids on a **valid** catalogue (FR-5). Only an invalid catalogue rejects. |
| **Q-4** | **Agreed: 0 ≤ bonusPercent ≤ 50, integer.** |
| **Q-5** | **Agreed: require the current retail version.** A markup change forces re-versioning every package in the same reviewed PR, and until then the checkout refuses (fail closed). That is intended. |
| **Q-6** | **Agreed: start at version 1**, contiguous from 1. The test asserts `versions[0] === 1`, not 0. |
| **Q-7** | **Agreed: `BOOST_PURCHASE_CAP_DEFAULT` in `config/boostPackages.ts`.** Validation keeps "every active package ≤ cap". |
| **Q-8** | **Agreed**, with C-4 (append-only). It is an accident guard. The PR and SA review are the audit record, as with `creditValue.history.json`. |
| **Q-9** | **Agreed.** `lib/payments/refundMath.ts` has no imports and is pure. A pure-helper dependency from `retailRate.ts` (logic, not `config/`) is acceptable and avoids a typed `100`. The `config/` files must not import it (G-3). No entitlements registration applies, because the rule covers imports **into** the module from outside, not imports out of it. |

#### Checks performed

- **`business-os-entitlements` skill:** all new non-test files are inside the module, so no `ENFORCEMENT_POINTS` or `KNOWN_NON_GATE_IMPORTERS` entry is due in slice 1. `enforcementPoints.test.ts` scans only importers **outside** the module. ✅
- **Directory-scanning guards in "Business OS entitlements invariants":**
  - `accountSeam.guard.test.ts` classifies every module `.ts` file that handles a user id (`userId`, `user.id`). The new files handle none, so it stays green. Keep the words `userId` and `user.id` out of the code of `retailRate.ts` and `boostCatalogue.ts`.
  - `tierLiteral.forbidden.test.ts` forbids quoted tier ids (`'basic'`, `'pro'` …) in the module outside `config/`. Package ids `starter`, `plus` and `max` are not tier ids. ✅
  - `creditFigures.fromConfig.guard.test.ts` exempts `entitlements/config/**` and scans product surfaces only. ✅
  - The census in `test:bos-entitlements` picks the new tests up by path, with no `package.json` edit. ✅
- **No added CI time:** four small pure suites in jobs that already run. No new job, step or dependency. ✅
- **Size and guardrails:** about 1.5 days, G-1 to G-8 concrete. Nothing reachable, so no flag is needed. ✅
- **Alignment with §18.10:** slice 1 is first, no parallel-session dependency, and the §18.6 corrections are applied (requirement §18.6 header). FR-2 already names `config/boostPackages.ts`. ✅

#### Approval

[x] Workplan approved with conditions C-1 to C-6 (C-7 is a note for later slices). Proceed to implementation. **No user question.**

### SA Code Review

**Code Review by SA — 2026-10-04**
**Status:** 🔄 Fix Required. One small must-fix (CR-1). After it, the code is approved for QA without another full review: SA re-checks only CR-1's diff and test.

**Scope reviewed:**
- the 10 new files under `lib/business-os/entitlements/` (`creditRetail.ts` and `.history.json`, `retailRate.ts`, `boostPackages.ts` and `.snapshot.json`, `boostCatalogue.ts`, four test suites);
- the +3/+3 doc lines in the pricing and entitlements docs;
- the requirement status line.

`git diff --stat` shows 10 insertions and 1 deletion. The deletion is the requirement's replaced status line. There is no deletion without insertion. `creditValue.ts` and `creditValue.history.json` are untouched (G-1).

#### What I verified myself

| Check | Result |
|---|---|
| The 10-suite local bar (Q-1 runner, `--runTestsByPath`) | ✅ 10 suites, **252 passed**, 12.7 s |
| Scoped tsc (scratch `tsconfig.worktree.json`, which includes the new tests) | ✅ **0 errors in `lib/business-os/entitlements/`**. 8 total, all pre-existing and elsewhere |
| **Mutation M1:** Plus `bonusPercent` 10 → 12, no version bump | ✅ caught (`boostCatalogue` and the guard go red, 5 tests) |
| **Mutation M2:** `export const PLUS_TOTAL = 13750;` appended to `boostCatalogue.ts` | ✅ caught by T-B9 (1 test) |
| **Mutation M3:** shipped markup 1 → 1.5 (rate 400) | ✅ caught in all four suites (12 tests: history, rate, figures, snapshot) |
| **Mutation M4:** Max badge "Best value 15" | ✅ caught (label rule and the guard) |
| Restoration after each mutation | ✅ SHA-1 of the three mutated files matches the pre-mutation copies |
| Business facts | ✅ Starter $10 → 5,000 / 0 / 5,000 / 0%. Plus $25 → 12,500 / 1,250 / **13,750** / 10%. Max $50 → 25,000 / 3,750 / **28,750** / 15%. Cap 15,000 minor USD over 30 days. Rate 500 per $1 is **computed** (`1 / (0.001 × 2)`, whole-number check), and the shown bonus is **recomputed from credits** (`bonusPercentFromCredits`) and must equal the configured integer |
| CLAUDE.md | ✅ No `console.*`, no `any`, no model names, no Supabase, no route. Strict types throughout |
| Entitlements skill and guards | ✅ No importer outside the module, so `enforcementPoints` is green. `accountSeam.guard`, `tierLiteral.forbidden` and `creditFigures.fromConfig.guard` are green |

#### Conditions from the workplan review

| | Status |
|---|---|
| C-1 (minor-unit money exempt from the figure guard) | ✅ `maskMinorUnitValues`, with a negative control showing `baseCredits: 5000` is caught and `priceMinor: 5000` is not |
| C-2 (runner and tsc procedure, local definition of done) | ✅ §6.5 |
| C-3 (memo per instance, module singleton) | ✅ `createBoostPackageSource` / `codeBoostPackageSource`. But see CR-1 |
| C-4 (append-only snapshot) | ✅ The `RELEASED` fingerprint map, with edit, removal and drift negative controls |
| C-5 (shipped pairing) | ✅ `creditRetail.test.ts:69` |
| C-6 (narrow doc edits) | ✅ One paragraph and one Change History row in each doc |
| Q-2 to Q-9 | ✅ All followed |

#### §6.5 deviations: all accepted

- **USD-only `baseCreditsFor`:** correct. The rate is per dollar and no exchange rate exists (FR-28).
- **`RELEASED` map with SHA-256 fingerprints:** a sound way to meet C-4, with the same accident-guard strength as the credit value history.
- **Banned figures derived from the catalogue,** with a non-vacuity pin on 500, 5,000, 12,500, 13,750, 25,000 and 28,750: better than a hand list, because it survives a re-price.
- **`\p{Nd}` and the Arabic percent sign:** a good widening. Hebrew and Spanish copy will arrive in slice 5.
- **The dropped `defaultBoostPurchaseCap` helper:** fine. Validation reads the constant through the source.

#### Findings

| # | File | Finding | Priority |
|---|---|---|---|
| **CR-1** | `boostCatalogue.ts` (`createBoostPackageSource`, `resolveBoostPackage`); `config/boostPackages.ts` | **Resolved packages are shared and mutable.** `getActive()` returns the **memoised object itself**. `listActive()` returns a new array of the same objects. Every package's `labels` objects are the **same references** as in `BOOST_PACKAGES`, which is typed `readonly BoostPackageConfig[]` but whose elements are mutable, and `BOOST_PURCHASE_CAP_DEFAULT` is a mutable object. One careless caller in slice 3 or 5 (for example `pkg.priceMinor = …`, or decorating `labels`) would silently change the price, credits or cap for **every later purchase in that serverless instance**. That is money data, and the memo makes it stick. **Fix:** deep-freeze each resolved `BoostPackage` (including `labels` and its locale objects, copied rather than shared with config) before memoising. Declare `BOOST_PACKAGES` and `BOOST_PURCHASE_CAP_DEFAULT` with `as const satisfies …` (the `creditValue.ts` pattern) or `Object.freeze` them deeply. **Test:** after `getActive('plus')`, an attempt to assign `priceMinor` or `labels.name.en` throws (strict mode) **and** a second `getActive('plus')` returns the original figures. | **Medium (must-fix)** |
| CR-2 | `boostCatalogue.ts` (`parsed.data as BoostPackageConfig` in `validateBoostCatalogue`) | A cast between the Zod output and the interface. It is harmless today, because the strict schema plus the shipped-data test would surface a mismatch. It would be cleaner to type the schema as `z.ZodType<BoostPackageConfig>`, or to derive the interface with `z.infer`, so the compiler checks the pairing. | Low (optional) |
| CR-3 | `boostCatalogue.ts` (`validateBoostCatalogue`) | An invalid **inactive** package invalidates the whole catalogue. That is the right fail-closed behaviour (a retired package that no longer resolves is still a config defect). Add one sentence to the file header so a later reader does not "fix" it. | Low (comment) |

#### Optimisation suggestions

- None needed for performance: validation runs once per instance.

#### Code Approved for QA

**No, pending CR-1.** Once CR-1 lands with its test and the 10-suite bar is green again, SA re-checks that diff only, and the code then goes to QA. CR-2 and CR-3 may land in the same change or be skipped.

#### Re-check of the CR-1 to CR-3 fixes (SA, 2026-10-04)

**Status:** ✅ **Code Approved.** The re-check covered only the fix diff.

| Item | Verified |
|---|---|
| **CR-1** | `resolveBoostPackage` returns a `deepFreeze`d package with **copied** labels (`copyLabels`), so nothing is shared with the config. `BOOST_PACKAGES` and `BOOST_PURCHASE_CAP_DEFAULT` are `as const satisfies …` and deep-frozen through a local helper, with no run-time import (G-3 / T-B10 still green). Three new tests cover it: writes to a returned package, to its labels, to the shipped packages and to the cap all throw `TypeError`, and later reads keep 2500 / 13,750 / 10% / "Plus". **Mutation:** with the freeze removed from `resolveBoostPackage`, the CR-1 test goes red (1 failed); the file was restored and SHA-1-checked. ✅ |
| **CR-2** | `boostPackageConfigSchema: z.ZodType<BoostPackageConfig>`, and the cast is gone. ✅ |
| **CR-3** | The header now explains why an invalid inactive package fails the whole catalogue. ✅ |
| Local bar (Q-1 runner) | ✅ **10 suites, 255 tests passed** |
| Scoped tsc | ✅ **0 errors in the module**. 8 total, all pre-existing and elsewhere |

**Code Approved for QA: Yes.** No user question. One note for QA: the local helper `deepFreeze` skips an object that is already frozen. That is fine here, because nothing pre-freezes these objects shallowly. It needs no change.

## QA Testing Report

**QA — 2026-10-04**
**Verdict:** ✅ **PASS WITH NOTES.** No bug. Two Low edge cases and two Info observations, none blocking.
**Test mode:** full
**Strategy used:** A (Jest unit). The slice is config and pure functions, and nothing in the product can reach it, so there is no browser path (Option D does not apply). Tests ran through the Q-1 scratch runner with `--runTestsByPath`. An extra QA suite was written in the session scratchpad and **not committed**.
**Focus:** schema, pipeline of the derived figures (price → rate → credits → bonus %), and the fail-closed loader
**Skipped:** `npm run test:bos-entitlements` and `npm run typecheck:bos-llm` as npm scripts. The worktree has no `node_modules` (SA C-2), so CI runs them on the PR. Locally the same suites ran through the runner, and the scoped tsc ran as the stand-in.
**Input source:** prompt (coordinator brief) + workplan §6

### Commands run

| Check | Result |
|---|---|
| 10-suite local bar (the four new suites + `enforcementPoints`, `accountSeam.guard`, `tierLiteral.forbidden`, `creditFigures.fromConfig.guard`, `creditValue`, `catalog.invariant`) | ✅ **10 suites, 255 tests passed**, 11.6 s |
| Scoped tsc (`tsconfig.worktree.json`) | ✅ **0 errors in `lib/business-os/entitlements/`**. 8 in total, all pre-existing and elsewhere (`lib/analytics/aiAnalytics.ts` 6, `lib/services/EmbeddingService.ts` 2), the same as the SA baseline |
| QA scratch suite `boostSlice1.qa.test.ts` (scratchpad `qa/`, a scratch config that adds the scratchpad to `roots`) | ✅ **72 tests passed**. They are edge probes, and the results are below |
| QA label probe `probe2.qa.test.ts` (scratchpad) | 5 inputs **accepted**, which are finding E-1 |
| Source untouched | No source was mutated during QA. The SHA-1s of every slice 1 file and the `git status --porcelain` output were taken before testing and match after it (only the two doc files below changed, and both were already modified or untracked) |

### Test Coverage

| Acceptance criterion / brief item | Tested? | Result | Notes |
|---|---|---|---|
| Approved figures: Starter $10 / 5,000 / 0%; Plus $25 / 12,500 + 1,250 = 13,750 / +10%; Max $50 / 25,000 + 3,750 = 28,750 / +15% | ✅ | Pass | Read through the shipped singleton `codeBoostPackageSource().getActive(…)`. USD, tax-exclusive, active, order 1/2/3. Badge null / "Most popular" / "Best value" |
| Base rate is 500 credits per $1, **computed** (`1 / (0.001 × (1 + 1))`), retail v1 paired with credit value v1 | ✅ | Pass | `CREDIT_RETAIL_HISTORY` has one entry, markup 1. `usdPerCredit` is 0.001 |
| Cap is $150 over 30 days, USD | ✅ | Pass | `{ amountMinor: 15000, currency: 'USD', windowDays: 30 }`. A price equal to the cap is allowed; one cent over is refused |
| FR-2: the catalogue fails validation if base ≠ price × rate or total ≠ base × (1 + bonus %) | ✅ | Pass | Identities hold on every package. A fractional base or total is refused ($9.99 at 10%, $0.01 at 10%, $10.01 at 3%) |
| FR-42: the bonus % is computed, not typed | ✅ | Pass | The resolved `bonusPercent` equals `(total ÷ (price × rate) − 1) × 100` and `bonusPercentFromCredits(base, total)`. A typed `totalCredits` / `baseCredits` / `bonusCredits` / `bonusLabel` key, or an extra key inside `labels`, is refused (strict). A digit or `%` in a label is refused (ASCII, Arabic-Indic and fullwidth digits) |
| AC: "changing the base rate in a test either changes the shown bonus or fails validation" | ✅ | Pass | A package on `retailVersion 2` against current v1 is refused. A stale pairing (credit value v0) is refused, and so are markups 0.5, NaN, −0.1, ∞ and 1e9. Markup 0 → 1,000/$ and 3 → 250/$ follow the inputs. The Dev's T-F3/T-F4 cover the re-pointed branch |
| Invalid catalogue → the loader **rejects** with `BoostCatalogueInvalidError` (fail closed), on both `listActive` and `getActive`, naming the rule | ✅ | Pass | 27 planted configs, each rejecting both methods with the right issue: negative / NaN / string / zero price, bonus 150 and 51, a label with a digit or `%`, a duplicate id (including when the duplicate is inactive), a typed credit field, an extra label key, a markup-version mismatch, a stale pairing, EUR, `'usd'`, `' USD'`, `taxExclusive: false`, a non-integer order, a `null` entry, an empty catalogue, a `null` cap, a cap with `windowDays` 0, a cap with an extra key, and a price above the cap. `error.name === 'BoostCatalogueInvalidError'` |
| FR-5: an unknown or inactive id → `null` | ✅ | Pass | `'nope'`, `''`, `'PLUS'`, `'Plus'`, `' plus'`, `'plus '`, `'__proto__'` and `'constructor'` all return `null`. An inactive Plus returns `null` and is missing from `listActive`. An inactive package that is itself invalid (above the cap) still fails the whole catalogue (CR-3, intended) |
| CR-1: the outputs are frozen | ✅ | Pass | The package, `labels`, and `labels.badge` are frozen, and a write throws `TypeError`. `listActive` returns a fresh array, so truncating it leaves the next call at 3 items. `resolveBoostPackage` output is frozen too |
| RC-7: validation is lazy, and the import does not throw | ✅ | Pass | `jest.isolateModules` + `doMock` of an invalid config (a bad package **and** a bad cap): the `require` does not throw, the first `listActive` rejects with both issues, and the memoised `getActive` rejects again. `createBoostPackageSource` never calls `load` at construction |
| Rounding and odd prices | ✅ | Pass | `baseCreditsFor`: $9.99 → 4,995; $0.01 → 5; 3¢ → 15; $10.01 → 5,005; 15,000 → 75,000. 0, −1, 0.5, NaN, ∞ and `MAX_SAFE_INTEGER` (overflow) → `null`. A $9.99 catalogue validates end to end, and `MAX_SAFE_INTEGER` is refused by the cap |
| Currency case | ✅ | Pass | The **schema** refuses `'usd'` and `' USD'` (literal `'USD'`). `baseCreditsFor` on its own accepts `'usd'` and `' USD '` (see I-2). JPY and EUR → `null` |
| FR-3: one loader seam | ✅ | Pass (review) | `BoostPackageSource` is async and is the only exported reader. There is no importer outside the module yet (§8) |
| FR-4: version and snapshot discipline | ✅ | Pass (Dev suite) | Covered by `boostCatalogue.guard.test.ts` (resolved snapshot + `RELEASED` fingerprints, negative controls). QA re-ran it; it was not re-probed |
| Native he/es text | ✅ | Pass | `'פלוס'` / `'Más'` are accepted. Surrounding whitespace is trimmed in the resolved label |

### Issues Found

#### Bugs (must fix before commit)

None.

#### Performance Issues (should fix)

None. Validation runs once per source instance.

#### Edge Cases (nice to fix)

1. **E-1: the label figure check misses some figure-like characters.** Severity: **Low**. File: `lib/business-os/entitlements/boostCatalogue.ts:75` (`FIGURE_IN_COPY = /[\p{Nd}%٪]/u`).
   - Steps to reproduce: set a badge to `'Best value ％'` (fullwidth percent, U+FF05), `'Best value ﹪'` (U+FE6A), `'Best value ½'` (`\p{No}`), `'Best value Ⅹ'` (`\p{Nl}`) or `'Ten percent extra'`.
   - Expected: refused, as for `'+15%'`.
   - Actual: all five are **accepted**.
   - Impact: today none (the labels are English and reviewed). It matters in slice 5, when native he/es copy arrives. Suggested fix: `/[\p{N}%٪％﹪]/u` (every numeric category plus the percent variants). Number **words** cannot be caught by a regex; leave those to review. The fix can wait for slice 5, or be a one-line change now.
2. **E-2: a `load()` that throws is not wrapped and is not memoised.** Severity: **Low**. File: `boostCatalogue.ts` `createBoostPackageSource`.
   - Steps to reproduce: `createBoostPackageSource(() => { throw new Error('boom') })`, then call `listActive()` twice.
   - Expected (per the fail-closed contract): a rejection that the caller recognises as "catalogue unavailable".
   - Actual: it rejects with the plain `Error` (not `BoostCatalogueInvalidError`), and `load` is retried on each call.
   - Impact: unreachable for the code source today, because `currentRetailRate()` does not throw. For a future `DbBoostPackageSource`, retrying is arguably right. **For slice 3:** the checkout's catch must treat **any** rejection from the source as a refusal, not only `instanceof BoostCatalogueInvalidError`. That belongs with SA C-7's note.

#### Observations (Info, no action required)

- **I-1:** `CREDIT_RETAIL_HISTORY` is **not** frozen at run time (`as const` is compile-time only). CR-1 froze `BOOST_PACKAGES` and the cap, not the retail history (nor `CREDIT_VALUE_HISTORY`, which follows the same pattern). A caller that mutated it before the first read would shift the rate. Nothing outside the module imports it, and the stale-pairing and snapshot tests would catch it in CI. It is consistent with `creditValue.ts`. Optional: apply the same local `deepFreeze` for symmetry.
- **I-2:** `baseCreditsFor` normalises the currency (`trim().toUpperCase()`), so `'usd'` gives 5,000, while the schema requires the literal `'USD'`. That is harmless, because the catalogue path never reaches `baseCreditsFor` with an unparsed currency. It does mean the two layers disagree on strictness.
- **Not a defect:** the `shownBonus !== config.bonusPercent` check in `resolveBoostPackage` cannot fail for an integer bonus once the exact-division check has passed, so a mutation that removed it would survive. It is defence in depth for the FR-42 identity and should stay.

### Recommended additions to the committed suite

| # | Test | Suggested home | Priority |
|---|---|---|---|
| R-1 | Price at the cap boundary: 15,000 allowed, 15,001 refused | `boostCatalogue.test.ts` (next to T-F11) | Should |
| R-2 | Bonus bounds: 50 resolves, 51 is refused | `boostCatalogue.test.ts` (next to T-F12) | Should |
| R-3 | Odd prices: $9.99 → 4,995 at 0% and refused at 10%; $0.01 → 5, and 6 at 20% | `retailRate.test.ts` / `boostCatalogue.test.ts` | Should |
| R-4 | Schema refuses `currency: 'usd'` and `' USD'` (the case variants, not only EUR) | `boostCatalogue.test.ts` (next to T-F8) | Nice |
| R-5 | `getActive` is exact-match: `'PLUS'`, `' plus'`, `'__proto__'` → `null` | `boostCatalogue.test.ts` (T-F16) | Nice |
| R-6 | `listActive` returns a fresh array (truncating it does not affect the next call) | CR-1 describe | Nice |
| R-7 | If E-1 is fixed: fullwidth `％` and `½` in a label are refused | T-F6 | With the E-1 fix |

The scratch file holding all of the above is `qa/boostSlice1.qa.test.ts` in the session scratchpad. The Dev can lift cases from it.

### Test Outputs / Logs

```text
10-suite bar:  Test Suites: 10 passed, 10 total   Tests: 255 passed, 255 total   Time: 11.605 s
QA scratch:    Test Suites: 1 passed, 1 total     Tests: 72 passed, 72 total     Time: 5.443 s
Label probe:   "Best value ％" ACCEPTED | "Best value ﹪" ACCEPTED | "Ten percent extra" ACCEPTED
               "Best value Ⅹ" ACCEPTED | "Best value ½" ACCEPTED
Scoped tsc:    8 errors total; 0 in lib/business-os/entitlements/
               (6 lib/analytics/aiAnalytics.ts, 2 lib/services/EmbeddingService.ts — pre-existing)
```

### Final Status
- [x] All acceptance criteria in slice 1's scope pass. Ready for commit (after the user has seen the diff, per the standing preference). E-1 and E-2 are Low and do not block. CI still owes `test:bos-entitlements` and the required type-check on the PR.
- [ ] Issues found that the Dev must address before commit

## Commit Info

*(RM populates.)*

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-04 | Created | Slice 1 workplan drafted by Dev against requirement §18.10 (main `1a9944a5`, branch off PR #217 `dd228b12`). Config + pure functions + tests + docs only; nine SA questions, no business question |
| 2026-10-04 | SA workplan review: approved with conditions | C-1: the figure guard must ignore `priceMinor` / `amountMinor` values (Max's 5000 minor collides with the banned 5,000). C-2: local runner and tsc procedure. C-3: memoisation per instance. C-4: append-only snapshot. C-5: shipped retail/credit-value pairing test. C-6: narrow doc edits. Q-1: the coordinator's bare command fails (ts-jest preset not found); a scratch Jest config and a scratch tsconfig on the main node_modules, outside the repo, were verified. Q-2 to Q-9 agreed. No user question |
| 2026-10-04 | Implemented; Code Complete | C-1 to C-6 applied to this workplan first. Files per §4. Local bar green: 10 suites / 252 tests; scoped tsc 0 errors in the module. Results and small deviations in §6.5. Nothing committed |
| 2026-10-04 | SA code review: fix required (CR-1) | Verified locally: 10 suites and 252 tests green, scoped tsc 0 errors in the module, mutations M1–M4 all caught and files restored (SHA-1 checked), business figures correct, C-1 to C-6 and Q-2 to Q-9 met, §6.5 deviations accepted. Must-fix CR-1 (Medium): freeze the resolved packages and the config (the shared mutable memo could change price, credits or cap for later purchases in the same instance). CR-2 (cast) and CR-3 (header note) are optional |
| 2026-10-04 | SA code review fixes CR-1 to CR-3 | CR-1: resolved packages deep-frozen with copied labels; `BOOST_PACKAGES` and the default cap `as const satisfies` and deep-frozen; 3 new tests. CR-2: schema typed `z.ZodType<BoostPackageConfig>`, cast removed. CR-3: header sentence on invalid inactive packages. Local bar 10 suites / 255 tests; scoped tsc 0 errors in the module. Nothing committed |
| 2026-10-04 | SA re-check of CR-1 to CR-3: Code Approved | Frozen and copied packages, frozen config, typed schema, header note. 10 suites and 255 tests green. A mutation removing the freeze is caught. Scoped tsc 0 in the module. Approved for QA |
| 2026-10-04 | QA: PASS WITH NOTES | 10-suite bar 255/255; scoped tsc 0 in the module; a QA scratch suite (72 edge tests, not committed) passed: approved figures, computed 500/$, cap, FR-42, 27 invalid configs rejecting with `BoostCatalogueInvalidError`, unknown and inactive ids → `null`, frozen outputs, lazy import, odd prices. No bug. E-1 (Low): the label check misses `％`, `﹪`, `½` and `Ⅹ`. E-2 (Low): a throwing `load()` is not wrapped, so slice 3 must catch any rejection. I-1/I-2 info. Recommended suite additions R-1 to R-7 |
| 2026-10-04 | QA follow-ups E-1, I-1, I-2, R-1 to R-7; E-2 noted | Label check covers every numeric character and percent variant; retail history deep-frozen; `baseCreditsFor` exact `'USD'`; 23 new tests from QA's recommendations; E-2 added to C-7 for slice 3. Local bar 10 suites / 278 tests; scoped tsc 0 errors in the module. Nothing committed |
| 2026-10-05 | Approved and committed | The user saw and approved the diff. RM committed on `feature/bos-credits-boost-slice-1` and opened a PR to main (link to fill) |
