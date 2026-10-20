# Workplan: Money MK-6, payment problems where they belong

> **Last Updated**: 2026-10-20

**Developer:** Dev
**Requirement:** [ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md](/docs/requirements/ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md) §12 MK-6; §6 items 14 and 15; C-1 (BD-38); SA-RR-MK pins table ("MK-1, MK-6, MK-7: none expected")
**Branch:** `feature/admin-money-mk6-payment-problems` (from main `4f1514f4`; MK-5b #485 and Exchange rates 2a #486 merged)
**Date:** 2026-10-20
**Status:** Code Complete
**Path:** UI short path. Markup and copy only. The payload, the request and the reads are unchanged.

## Overview

The Overview's separate "Payment problems" section goes away. Its two lists move to their owners:

| List | From | To | Why (§6) |
|---|---|---|---|
| Our payment problems (boosts) | Payment problems, block A | **Revenue** section, after the boosts part | Our money's problems sit with our money |
| Client payment problems (its five parts) | Payment problems, block B | **Client payments** block (`TakingsSection`), after the takings body | Same owner as the client payments: the businesses |

Plan payment problems (slice 7) are not built, so no plans block is added.

## Design

**`PaymentProblemsSection.tsx`** keeps its file name, its `Part` helper and its private bodies (boosts, client plans, reminders). The file name is kept because #486's tab tests mock this module path. Its section export is replaced by two block exports:
- **`OurBoostProblems({ part, accountId })`:** the existing "boosts" `Part`. The title, the "As of now, UTC" subtitle, the per-currency table, the notices and the Businesses link are unchanged, and so are the test ids `problems-boosts-*`.
- **`ClientPaymentProblems({ problems, windowLabel })`:** the existing `problems-clients` group, with its "Client payment problems" heading, its neutral "The businesses' problem, not ours" chip, and the five parts in their order. The frame's subtitle (`PROBLEMS_SUBTITLE`: as of now, the plans window, "covers businesses that still exist") moves under this heading unchanged, because it describes these parts.

**`RevenuePanel`** gains optional `boostProblems` and `accountId` props. The block renders after the boosts part. It also renders when Revenue is `unknown`, through `FinanceSection.alsoWhenUnknown`, because it is its own read. With the prop absent (older fixtures), the panel is as before.

**`TakingsSection`** gains an optional `problems` prop. The client block renders after the takings body, and also when takings is `unknown` (`alsoWhenUnknown`). The "Not our revenue" badge (BD-1) stays on the block. Each part keeps its own status chip.

**`FinanceView`** no longer mounts the Payment problems section. It passes `paymentProblems.boosts` and the account to `RevenuePanel`, and `paymentProblems` to `TakingsSection`. The Exchange rates tab (#486) is untouched.

**What does not change:**
- Every label, status rule and `PROBLEMS_*` / `BOOST_PROBLEMS_*` string.
- The K-5 red-on-open-dispute rule, which is in the payload.
- The one fetch on load.
- The payload and AC-145 (`23a12c7e`), Pin B (`a1b3db0c`) and Pin A (as on main).

`PAYMENT_PROBLEMS_TITLE` loses its only reader. It stays in the copy file, marked as no longer rendered.

## Files

| File | Action |
|---|---|
| `app/admin/finance/components/PaymentProblemsSection.tsx` | modify: two block exports, the frame removed |
| `app/admin/finance/components/RevenuePanel.tsx` | modify: renders our boost problems |
| `app/admin/finance/components/TakingsSection.tsx` | modify: renders the client problems |
| `app/admin/finance/components/FinanceView.tsx` | modify: the section removed, the props passed |
| `app/admin/finance/financeCopy.ts` | comment only |
| `app/admin/finance/__tests__/financePage.render.test.tsx` | the section's cases re-pointed to the new homes, plus MK-6 placement cases |

## Tests

- Revenue contains `problems-boosts`.
- The Client payments block contains `problems-clients` with its chip and the five parts.
- There is no `section-payment-problems`.
- Both blocks still show when their host section is `unknown`.
- The section order is unchanged otherwise.
- One request on load.
- Pins A and B, AC-145 and AC-173 are unchanged.

## Task List

- ✅ Step 1: Split the section into two blocks
- ✅ Step 2: Host them in Revenue and Client payments; remove the frame from the view
- ✅ Step 3: Update the tests
- ✅ Step 4: Runs and pins

## Implementation Notes

**Built as designed.**
- `OurBoostProblems` and `ClientPaymentProblems` are exported from `PaymentProblemsSection.tsx`, which no longer exports a section.
- `RevenuePanel` and `TakingsSection` host them, each also through `alsoWhenUnknown`.
- `FinanceView` no longer mounts the frame.

**Defensive read.** `FinanceView` reads `data.paymentProblems?.boosts`, because #486's `accountsTab.render.test.tsx` fixture has no `paymentProblems`. Before MK-6 the mocked section never read it. #486's tests are not edited.

**Test edits, all in `financePage.render.test.tsx`.** No pin file is edited.

| Case | Edit |
|---|---|
| Section-order lists | No `section-payment-problems` |
| Client-problems describe (L-32) | Its `renderWith` returns the `problems-clients` block. L-32 asserts the block is inside Client payments, after the takings body, and that there is no "Payment problems" heading |
| AC-66/67 | Asserts that the frame is gone, not that it is `partial` |
| AC-227 | Asserts the boost block is inside Revenue, after the boosts part |
| AC-52 | The "no 0.00 / currency" check excludes the client block, which has its own figures |
| New "Money MK-6" describe | 3 cases: the placement and one request; both blocks still show when their host is `unknown`; the Businesses link in the picked view |

### Runs

| Run | Result |
|---|---|
| `app/admin/finance` | 24 suites, 840 tests |
| `app/admin/components` | 882 tests |
| Guards: vocabulary, layout, contrast, range-cap, finance source, USD copy, Finance F-5 source | 7 suites, 2,231 tests |
| Pins: A, B, AC-173, C, D, and the route (AC-145) | 6 suites, 216 tests. AC-145 is still `23a12c7e`, and no pin file differs from main |
| `test:authz-guard` | 203 tests |
| `test:bos-entitlements` | 301 suites, 9,157 tests |
| `lint:hooks` | Clean |
| Scoped tsc | 383 files, 0 errors. The canary in `financePage.render.test.tsx` gave TS2322, and the file was restored byte-identical |

**Full gate:** 21 suites and 141 tests failed: the 20-suite Windows set plus `components/business-os/settings/__tests__/upgradeModal.guard.test.ts`, negative control (j). It fails because that test builds its planted violation from LF-shaped text, and the files are CRLF in a Windows checkout (the #394 pattern). It came from UM-1a (`5d4e2ffa`, on main). MK-6 touches no file under `components/`.

**Logging:** there are no `console.*` calls in any touched file.

## SA Review Notes

### SA Code Review (MK-6)

**Code Review by SA, 2026-10-20. Reviewed: the uncommitted tree on `feature/admin-money-mk6-payment-problems` (from main `4f1514f4`).**
**Status: Code Approved (SA-CR-MK6).** No conditions.

| Item | Result |
|---|---|
| Scope and pins (my ruling: "If Pin B or AC-145 moves, stop") | ✅ Markup only. `app/api/**` is untouched, so the payload and **AC-145 (`23a12c7e…`) are unchanged**. SA recomputed the seven pin files: none differs from HEAD (AC-173 `3a1a2dd4`, its helper `b84e0c96`, Pin A `96fae2be` as on main, Pin B `a1b3db0c`, Pin C `98ea0507`, its helper `02813360`, Pin D `1f7cf07a`) |
| §6 items 14 and 15, C-1 / BD-38 | ✅ "Our payment problems (boosts)" (`OurBoostProblems`) renders inside **Revenue**. "Client payment problems" (`ClientPaymentProblems`) renders inside **Client payments**. They are two separate, labelled parts, each shown through `alsoWhenUnknown`, so it still appears when its host section's own read failed. There is no plan problems block (slice 7) |
| BD-1 "not ours" | ✅ Client payments keeps its "Not our revenue" chip, and the client problems part keeps its own heading with `PROBLEMS_CHIP` ("The businesses' problem, not ours") |
| K-5 / F-K1 red on an open dispute | ✅ The rule (`boosts.openDispute`) and the tile are untouched. F-K1 opens `#revenue`, which is exactly where the boost problems now sit |
| Old anchors and links | ✅ No source file under `app/` or `lib/` links to `#payment-problems` any more (SA grep). The only references left are inside `PaymentProblemsSection.tsx`'s own markup ids for the parts. The boost part's Businesses link takes `accountId` from the page, as before |
| Exchange rates tab (#486) | ✅ Untouched: `FinanceTabs.tsx` and `app/admin/exchange-rates/**` are not in the diff |
| Guards | ✅ `app/admin/finance`, `app/admin/__tests__` (vocabulary, contrast, C-14) and `app/admin/components`: **2345 passed** |
| `upgradeModal.guard` failure | **Not caused by MK-6.** The suite and every file it scans (`components/business-os/**`) are byte-identical to HEAD (`4f1514f4`, main), and the same case `(j) a button for "Current plan"` fails on SA's run. It comes from UM-1a on main (the Windows CRLF pattern) and belongs to the upgrade-modal stream |
| Leftover constant | `PAYMENT_PROBLEMS_TITLE` is still referenced by the page test's **absence** assertion (`financePage.render.test.tsx:1153`), so it is a test anchor, not dead code. Acceptable |

#### Code Approved for QA: Yes

## QA Testing Report

**QA — 2026-10-20** (worktree `neuronforge-finance-m8`, branch `feature/admin-money-mk6-payment-problems` on `4f1514f4`, uncommitted)
**Test mode:** full (UI short path)
**Strategy used:**
- **A:** Jest suites and guards, each run alone.
- A code read.
- **A temporary before/after probe, deleted afterwards** (`git status` is clean of `zz_*`). Main's `PaymentProblemsSection` (from `git show HEAD:`) and the new `OurBoostProblems` / `ClientPaymentProblems` were rendered from the **same** fixture: boosts with an open dispute and not-credited money; overdue invoices and instalments with a platform row and a missing name; a partial part; reminders failed. Their HTML was compared.
- A scoped tsc with a canary.

**Focus:** ui
**Skipped:** the live page (user, below).
**Input source:** prompt + workplan

**Verdict: PASS. No bugs.**

### Behaviour

| Item | Result | Evidence |
|---|---|---|
| No separate "Payment problems" section | ✅ | `FinanceView` no longer mounts it, and `PaymentProblemsSection.tsx` exports no section. Dev's MK-6 and L-32 tests assert `section-payment-problems` is absent |
| Our boost problems inside Revenue, labelled | ✅ | The block renders after the boosts part, inside `section-revenue` (AC-227 test, and MK-6 "placement"), under its own title "Our payment problems (boosts) · As of now, UTC". It **also shows when Revenue could not load** (`alsoWhenUnknown`: it is its own read; MK-6 test) |
| Client payment problems inside Client payments, "not ours" kept | ✅ | The `problems-clients` group renders after `takings-body`, inside `section-takings` (L-32 / MK-6). Its heading "Client payment problems", the **neutral "The businesses' problem, not ours" chip**, the section's "Not our revenue" badge and all five parts in order are kept. It also shows when the takings could not load |
| Every figure and label the same; only the location changed | ✅ | **Probe:** the boost block's HTML is **byte-identical** to main's, with all businesses and with a business picked (its Businesses link included). In the client block, all **5 parts are byte-identical** (`outerHTML` equal, in order), and so are the heading and chip. The only change is the old frame's subtitle ("as of now … covers businesses that still exist"), which now sits under the client heading with **identical text**. Every `PROBLEMS_*` / `BOOST_PROBLEMS_*` string is unchanged; only a comment was added to `financeCopy.ts` |
| Nothing lost with the frame | ✅ | The old frame's status chip was only a roll-up ("`partial` when any part is partial or unknown", per `financeTypes.ts`). Each part still shows its own status in words, so no information is dropped |
| The K-5 red-on-open-dispute rule, and its link | ✅ | The rule is in `financeHealth.ts`; **`lib/` is unchanged** (`git diff --quiet HEAD -- lib app/api`). The K-5 tile's target is `#revenue`, and the open-dispute line now sits **inside `#revenue`**, so the red tile lands on its cause. Before, the tile went to `#revenue` and the dispute was in a separate section further down |
| No link or anchor at a removed section | ✅ | A grep of `app/`, `lib/` and `components/` (non-test) finds no `payment-problems` id, href or `#` anchor. `FinanceTileSection` never named it |
| Exchange rates tab (#486) | ✅ | `exchangeRatesTab.render.test.tsx` passes **20/20** alone (one finance-route call, tab switching, focus); `app/admin/exchange-rates` passes 3/3, 101/101. The defensive `data.paymentProblems?.boosts` keeps #486's `accountsTab` fixture green without editing it |
| One fetch on load; payload unchanged | ✅ | The MK-6 test asserts `toHaveBeenCalledTimes(1)`. AC-173 `3a1a2dd4` / `b84e0c96` are unchanged. No `lib/` or `app/api` file changed; the route test passes **115/115** with AC-145 still `23a12c7e` |
| Pins unchanged | ✅ | `git diff --quiet HEAD -- '*pin*' app/api`: no pin file differs from main. Pin B `a1b3db0c`, Pin C `98ea0507` / `02813360`, Pin D `1f7cf07a`, AC-173 as above. Pin A reads `96fae2be`, which is **main's** current value (moved on main after MK-0a's `98cadff3`, not by this branch) |

### Suite runs (each alone)

| Suite | Result |
|---|---|
| `app/admin/finance` | 24/24, **840/840**. First run: 1 suite failed (`exchangeRatesTab`, 2 tests, 49 s under load). It passed 20/20 alone, then the whole folder passed 840/840 on a re-run, so this is a **load flake** |
| `app/admin/components` | 26/26, **882/882** |
| `app/admin/exchange-rates` | 3/3, 101/101 |
| Guards: vocabulary, contrast, layout folder, range-cap, finance source (lib and app), USD copy | 7/7, **2231/2231** |
| `npm run test:authz-guard` | 2/2, 203/203 |
| `npm run test:bos-entitlements` | 301/301, **9157/9157** |
| `npm run lint:hooks` | exit 0 |

**Scoped tsc:**
- Scope: `app/admin/finance/**`, `app/admin/components/**` and `app/admin/exchange-rates/**`, 283 app and lib files.
- The canary in `TakingsSection.tsx` gave `(365,7) TS2322`. The file was restored with `cp` and checked with `cmp` (identical).
- The clean run: **0 errors**.

### Issues Found
- **Bugs:** none.
- **Performance:** none. No new read or request.
- **Edge cases:** none. `PAYMENT_PROBLEMS_TITLE` is kept as the page test's absence anchor (SA ruling); agreed.

### User browser steps (signed in as an admin)
1. **Money → Finance**, Overview. Scroll the page: there is **no** "Payment problems" section any more.
2. **Revenue** section: after the boosts part there is **"Our payment problems (boosts) · As of now, UTC"**, with the same open disputes and paid-but-not-credited figures as before.
3. With an open boost dispute, the **Revenue received** tile is red. Click it: the page jumps to Revenue, where the dispute line now is.
4. **Client payments** (last section, "Not our revenue"): after the takings there is **"Client payment problems"**, with the grey "The businesses' problem, not ours" chip, its "As of now…" line, and its five parts: failed payments, overdue invoices, overdue instalments, client plans, reminders.
5. Open the **Exchange rates** tab and come back: both work as before. The network panel shows one finance request on load.

### Final Status
- [x] All MK-6 behaviours pass. Only the location changed; the blocks are byte-identical to main. Pins and the payload are unchanged. **Ready for RM.**
- [ ] Issues found

## Commit Info

[RM will populate this section]

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-20 | Created (Dev) | Short workplan for MK-6 |
| 2026-10-20 | Implemented (Dev) | Boost problems in Revenue; client problems in Client payments; frame removed; no pin moved |
| 2026-10-20 | SA code review | Code Approved (SA-CR-MK6): boost problems in Revenue and client problems in Client payments, both labelled; BD-1 kept; F-K1 opens #revenue; no stale #payment-problems link; pins and AC-145 unchanged; Exchange rates untouched; upgradeModal.guard fails on main itself (UM-1a) |
