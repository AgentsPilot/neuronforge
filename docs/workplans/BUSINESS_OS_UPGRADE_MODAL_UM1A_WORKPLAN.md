# Workplan: Business OS Upgrade Modal, UM-1a "Plan cards modal, view only"

> **Last Updated**: 2026-10-19

**Developer:** Dev
**Requirement:** [BUSINESS_OS_UPGRADE_MODAL_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_UPGRADE_MODAL_REQUIREMENT.md) (SA APPROVED WITH CONDITIONS C-1 to C-14; user accepted UM-BQ1 to UM-BQ4 defaults; **SA Re-review (UM-D1) C-15 to C-28; user decisions UM-D1 (comparison table) and UM-D2 (short grouped rows)**)
**Date:** 2026-10-19
**Status:** Code Complete (uncommitted). SA code review: FIX REQUIRED F-1 to F-3 (2026-10-19; UM-SA4 amended per UM-BQ4). Workplan SA APPROVED WITH CONDITIONS W-1 to W-11
**Depends on:** [UM-0 workplan](/docs/workplans/BUSINESS_OS_UPGRADE_MODAL_UM0_WORKPLAN.md) — the `comparison` field in the plan read. **UM-1a's PR opens only after UM-0 is merged** (C-15). Tasks 0–2a touch only client files and may start in parallel
**Branch:** `feature/bos-upgrade-modal-um1a` (created by RM from the tip of `feature/bos-upgrade-modal-um0`, `5243d900`; rebase on `origin/main` owed once PR #480 merges, C-15)
**Code base read:** `origin/main` at `4583d21e` (the local checkout is about 300 commits behind and was not used for code)
**Path:** UI short path (SA code review + QA in parallel → user sees the diff → RM), per UM-SA11

## Overview

UM-1a adds a colourful, **view-only** plan comparison window to Business OS. Inside Settings → "Your plan", a new "Compare plans" button opens a wide modal with a gradient header, a status strip ("You're on Essentials · $79 a month · Renews on …"), and one card per plan in the server's order: the current plan marked "Your plan" with what it includes, the recommended plan wearing a ribbon and framed "Everything in {plan}, plus:" from `nextPlanUp`, and the other plans as name and price. **No money behaviour moves**: Choose and Upgrade stay in the drawer, and the modal mounts no island (C-1, C-12). The slice also extracts the checkout / upgrade flow out of `PlanSection` into one hook, `usePlanFlow`, as a pure move proven by the existing tests passing with no test-file change (C-2). UM-1b will later move the islands into the modal and consume that hook.

> **Revised 2026-10-19 for UM-D1 / UM-D2 (SA re-review "workplan impact").** The cards are replaced by a **comparison table**: a scope column of short grouped rows under section headings, and one column per plan with the name, the price under it and the action slot under the price, repeated in a footer row. Every row, label, ✓ / ✕, value, highlight and order comes from the server's new `comparison` field (UM-0); the UI decides none of them (C-21). The current tier column is marked "Your plan" and, when the server offers nothing for it, carries a **non-interactive "Current plan" label**, never a disabled button (C-22). On a phone the same semantic table re-flows: sticky plan header row, each feature label above its two compact cells, no sideways scroll at 360 px (C-24). Still view only: no Choose / Upgrade control in the modal (C-1). Where this revision replaces SA-approved text, the old text is kept and marked **Superseded (UM-D1)**.

---

## Table of Contents

1. [Scope and binding conditions](#1-scope-and-binding-conditions)
2. [Analysis summary](#2-analysis-summary)
3. [Implementation approach](#3-implementation-approach)
4. [The usePlanFlow extraction](#4-the-useplanflow-extraction)
5. [The modal](#5-the-modal)
6. [Copy keys (en / he / es)](#6-copy-keys-en--he--es)
7. [Files to create / modify](#7-files-to-create--modify)
8. [Task list and estimates](#8-task-list-and-estimates)
9. [Test plan](#9-test-plan)
10. [Existing assertions moved: old → new (C-5)](#10-existing-assertions-moved-old--new-c-5)
11. [Logging (CLAUDE.md § Logging)](#11-logging-claudemd--logging)
12. [Risks](#12-risks)
13. [Open questions for SA](#13-open-questions-for-sa)
14. [SA Review Notes](#sa-review-notes)
15. [QA Testing Report](#qa-testing-report)
16. [Commit Info](#commit-info)

---

## 1. Scope and binding conditions

**Approved scope (SA slicing table, verbatim):**
> **UM-1a — Plan cards modal, view only.** `usePlanFlow` extraction (pure move, existing tests green unchanged), the modal with cards, markers, `nextPlanUp` framing, "Compare plans" button in the drawer. Choose and Upgrade **stay in the drawer**. No money behaviour moves — 2.5 d

| Condition | How UM-1a meets it |
|---|---|
| **C-1** UM-1a moves no money button | `PlanPurchase` / `PlanUpgrade` stay exactly where they are in `PlanSection`. The modal renders no Choose, Pay for or Upgrade control. A source guard refuses any import of `PlanPurchase`, `PlanUpgrade` or `PlanEmbeddedCheckout` into `UpgradeModal.tsx` |
| **C-2** `usePlanFlow` verbatim, no second copy of a predicate | §4. Checkpoint after the move: all PlanSection-driven suites green with **zero** diff under `__tests__/`. A guard pins that `succeeded` / `upgradeSucceeded` / the bounded re-read exist only in `usePlanFlow.ts` |
| **C-3** In Settings the modal is a child of `SheetContent`, shares PlanSection's flow instance, takes no read | The modal is rendered **by `PlanSection`**, which is already a child of `SettingsDrawer`'s `SheetContent`. It receives `PlanSection`'s `plan` state as a prop. It never calls `readMyPlan`, `fetch`, or `planDrawerReads` (guarded). Closing on `onComplete` / `onUpgrading` is UM-1b (no island in the modal yet) |
| **C-5** Every island test id kept; moved assertions mapped | No island is touched, so every `plan-*` test id stays. Five `queryByRole('button')` absence assertions and two vacuous "some button exists" assertions in `PlanPurchase.render.test.tsx` are narrowed, mapped in §10 |
| **C-6** Zero imports from `lib/business-os/entitlements/` | Payload types move from `PlanSection.tsx` to a client-side `planPayloadTypes.ts` in the same folder (types only). New files are added to the existing `CLIENT_FILES` source guard |
| **C-7** No tier id literal in product code | The modal never names a plan id: current = id equality against the payload, recommended = `nextPlanUp.planId` or the last of `plans` (UM-SA4). Tier ids appear only in `components/business-os/settings/__tests__/`. `tierLiteral.forbidden` stays green unchanged |
| **C-8** `dialog.tsx` unchanged; flex variant + `sm:max-w-*`; X restyled via layout | `DialogContent className="flex flex-col p-0 overflow-hidden w-full h-[100dvh] sm:h-auto sm:max-h-[90dvh] sm:max-w-4xl …"` (the `CRMContactModal` shape, no second base `max-w-*`). The built-in X sits on the band; the header reserves its corner (`pe-12`) and the X's colour is set from the content (§5.4, SA Q-4) |
| **C-9** Small white text only on `--v2-primary-dark`; gradient only behind large text / decoration; mirrors in RTL | §5.4: all band text on solid `--v2-primary-dark`; the gradient to `--v2-secondary` is a decorative `aria-hidden` layer at the band's end edge, direction flipped in RTL. Ribbon on `--v2-primary-dark` |
| **C-10** Ribbon only on an offered, non-current plan; "Everything in {plan}, plus:" only when the current plan is a tier card | `upgradeModalView.ts` (pure, unit tested): recommended per UM-SA4 with both guards. Heading: `upgrade_modal.everything_in_plus` when a current tier card exists, else `plan.next.adds_heading` |
| **C-12** Islands never in drawer and modal at once | UM-1a: no island in the modal at all (guarded) |

> **C-10 row above: second half superseded (UM-D1, C-26).** "Everything in {plan}, plus:" and the `nextHeading` choice no longer exist; the ribbon half (offered, non-current, UM-SA4) stands.

**Revised approved scope (SA re-review (a)):** **UM-1a "Comparison table modal, view only"** — renders UM-0's `comparison`; table, sticky phone layout, reworked tests — **3 d**. Tasks 0–2a, W-2, W-5, W-6, the band, X, contrast (Q-4, Q-5) and the "Compare plans" button (§5.5) unchanged.

| Condition (re-review) | How the revised UM-1a meets it |
|---|---|
| **C-6** (re-affirmed) | The `comparison` type is **mirrored** in `planPayloadTypes.ts` (§7), no import from `lib/business-os/entitlements/` |
| **C-15** UM-0 first | Header "Depends on". Task 2b rebases on `origin/main` after UM-0's merge before any table code; the PR is not opened earlier |
| **C-21** The UI decides no ✓ / ✕, highlight, row, label or order | `upgradeModalView` passes `comparison.sections` through **by identity** (unit test `toBe`); the component maps it in order. `upgradeModal.guard` refuses capability ids, config row labels and tier literals in the client files (§9.3) |
| **C-22** "Your plan" only for `kind = 'tier'` by id equality; its action is the server's action if one is offered, else "Current plan" as a non-interactive label | §5.2a `action` per column. The label is a `<span>` (no `role="button"`, no `tabIndex`, no `aria-disabled`), styled like a quiet button. In UM-1a an offered plan's slot is **empty** (C-1); UM-1b puts the trigger there |
| **C-23** ✕ reads "Not included"; screen-reader text names the plan; no exclusion phrasing in any language | `upgrade_modal.not_included` + `upgrade_modal.cell_label` ("{plan}: {state}"); the guard runs the `noExclusions` phrasing pattern over every `upgrade_modal.*` value in en / he / es |
| **C-24** Phone M-A | §5.3a: one semantic table, sticky header row, label row above compact cells, 360 px without horizontal scroll; explicit ARIA table roles where `display` re-flows |
| **C-25** Flows replace the table area | UM-1b (no flow in UM-1a). The table area is one element (`plan-compare-table-area`) so UM-1b can swap it |
| **C-26** Card-only items superseded | §5.2, §5.3, §6 `everything_in_plus` marked superseded; `included` / `nextPlanUp` are not rendered in the modal (the drawer's B9 is unchanged) |
| **C-27** More than two plans | The tripwire is built in UM-0 (UM-0 Q-7); UM-1a's `max-sm:grid-cols-2` is the assumption it protects, and the guard names it |

**Not in UM-1a** (named so nobody builds them early): C-4 provider and `useUpgradeModal` (UM-2); context union `locked_feature` / `founding_partner` (UM-2); busy lock and `onBusyChange` (UM-1b); C-11 go-live row 20 (UM-1b); C-13 `text-red-700` → `--v2-error-text` in the islands (UM-1b, when the islands are restyled for the modal; SA to confirm, Q-10); the "See plans" label (UM-1b); CV copy polish (UM-3).

---

## 2. Analysis summary

| Area | Finding on `origin/main` |
|---|---|
| `components/business-os/settings/PlanSection.tsx` (823 lines) | Owns: the payload types (mirrored), `planFrom`, `fetchPlan`, `renderSentence`, `fill`, `priceLine`, `CategoryRowText`, `ACCOUNT_CLOCK_SENTENCE_KEYS` (exported), the first read with the C-b prefetch hand-over, and the checkout / upgrade flow (state, predicates, callbacks, bounded re-read). Renders B1 to B11 |
| Where `PlanSection` mounts | `app/business-os/settings/page.tsx` line ~1054, as the child of `<SettingsDrawer>` → inside `SheetContent`. So a dialog rendered by `PlanSection` is already nested the way C-3 / UM-SA2 require. **The page needs no change** |
| `components/ui/dialog.tsx` | Base `max-w-lg`, `cn` does not merge; `className.includes('flex')` opts out of the grid / gutter / scroll. Built-in X: `absolute end-4 top-4`, `text-[var(--v2-text-muted…)]`, sr-only label hard-coded `Close` |
| Precedent for a nested dialog | `SettingsDrawer`'s discard prompt (`DialogContent` inside `SheetContent`); test `SettingsDrawer.layers.test.tsx` |
| Precedent for the flex variant | `components/crm/CRMContactModal.tsx` (`w-full sm:max-w-3xl h-[100dvh] sm:h-auto sm:max-h-[90dvh] flex flex-col p-0 overflow-hidden`) |
| Tokens | `--v2-primary-dark` #4F46E5, `--v2-secondary` #8B5CF6, `--v2-error-text` present in `app/v2/globals-v2.css` (SA R-tokens confirmed) |
| Guards that read `PlanSection.tsx` source | `planPrefetch.guard` **pg8** (the first-read effect holds `takePrefetched?.(` exactly once and is declared immediately before the `[language]` effect); `PlanPurchase.render` `CLIENT_FILES` (no entitlements import, no console, billing value imports only `checkoutReturnMarker`); `creditFigures.fromConfig` `SOURCES` (no typed credit figure); `tierLiteral.forbidden` (no tier literal outside `__tests__`) |
| Tests importing from `PlanSection` | `ACCOUNT_CLOCK_SENTENCE_KEYS`, `PlanSection`, `type PlanPayload` (6 suites). All must keep resolving: `PlanSection.tsx` re-exports what moves |
| DB / routes | None touched. No migration, no route, no change to `my-plan`, checkout or upgrade |
| Deprecated patterns | None found in the touched files |

---

## 3. Implementation approach

1. **Fresh worktree off `origin/main`** (RM's branch). Never `git stash`; never switch branches in the shared checkout. If the worktree links a shared `node_modules` junction, unlink the junction before any `git worktree remove` (known hazard).
2. **Move first, then build.** Tasks 1 and 2 are a pure move with no behaviour change and no test edit. A checkpoint run proves it before any new UI code lands. RM may commit this as its own commit (`refactor:`) so the proof is visible in history.
3. **One pure view function.** Everything the modal derives (which card is current, which is recommended, which heading the plan-above card gets, which headline) sits in `upgradeModalView.ts`, unit tested per §2.2 state with real payloads. The component only renders its answer. This keeps "renders, does not decide" reviewable in one place and keeps tier ids out of product code.
4. **The modal is a sibling of the section's content, rendered by `PlanSection`.** `PlanSection` owns `const [compareOpen, setCompareOpen] = useState(false)` and renders `<UpgradeModal open={compareOpen} onOpenChange={setCompareOpen} plan={plan} />` beside the "Compare plans" button. No new effect is added to `PlanSection` (pg8 counts effects).
5. **"Compare plans" sits at the end of the section, after the islands.** In UM-1b the islands leave, and this becomes its natural place under B9. In UM-1a, being last keeps `getAllByRole('button')[0]` in the purchase tests on the Choose button.

---

## 4. The usePlanFlow extraction

### 4.1 What moves, and where

| Item (today in `PlanSection.tsx`) | Moves to | Note |
|---|---|---|
| `PlanFeature`, `PlanSentence`, `PlanCategory`, `PlanChange`, `PlanUpgrade` (interface), `PlanPayload` | `planPayloadTypes.ts` (new, types only; `import type` from `./PlanPurchase` and `lib/business-os/billing/planPurchaseTypes` only) | `PlanSection.tsx` keeps `export type { PlanPayload } from './planPayloadTypes'` so the six test suites still import it from `PlanSection`. The `PlanUpgrade` interface is renamed `PlanUpgradeView` inside the new file to stop shadowing the `PlanUpgrade` component name; `PlanSection` imports it under that name (type only, no runtime effect) |
| `ACCOUNT_CLOCK_SENTENCE_KEYS`, `renderSentence`, `fill`, `priceLine`, `CategoryRowText`, `Notice` | `planText.tsx` (new) | Shared by the drawer and the modal, so the two cannot word a row, a date or a price differently. `PlanSection.tsx` re-exports `ACCOUNT_CLOCK_SENTENCE_KEYS` (imported by `PlanPurchase.render`). Bodies verbatim |
| `planFrom`, `fetchPlan` | `usePlanFlow.ts` (exported `planFrom`, module-private `fetchPlan`) | `PlanSection` imports `planFrom` for its first read and `isUsableWarm` / `discardContext` |
| State `completedSession`, `refreshes`, `upgradeTarget`, `upgradeWatching`; ref `mounted` + its effect; derived `marker`, `succeeded`, `checkoutProcessing`, `upgradeSucceeded`, `upgradeProcessing`, `processing`, `exhausted`; callbacks `onCheckoutComplete`, `onUpgrading`, `onUpgradeCheckAgain`; the bounded re-read effect | `usePlanFlow.ts` | Verbatim, comments included. Logger stays `createLogger({ module: 'BusinessOsPlanSection' })` so log lines are unchanged |

**What stays in `PlanSection`:** `plan` / `loading` / `failed` state, the C-b first-read effect (`firstStarted`, `firstRead`, `takePrefetched`), the `[language]` effect, `isUsableWarm`, `discardContext`, `NextPlanUp`, and all JSX. Keeping the first read in `PlanSection` is deliberate: `planPrefetch.guard` pg8 reads `PlanSection.tsx` and pins those effects there and their order. Moving them would mean editing the guard, which C-2 ("existing tests green unchanged") forbids.

### 4.2 Signature

```typescript
// components/business-os/settings/usePlanFlow.ts ('use client')
export function usePlanFlow(args: {
  plan: PlanPayload | null;
  setPlan: (plan: PlanPayload) => void;
  setFailed: (failed: boolean) => void;
  loading: boolean;
  checkoutMarker: string | null;
}): {
  marker: string | null;
  succeeded: boolean;
  checkoutProcessing: boolean;
  upgradeSucceeded: boolean;
  upgradeWatching: boolean;
  upgradeProcessing: boolean;
  processing: boolean;
  exhausted: boolean;
  onCheckoutComplete: (sessionId: string) => void;
  onUpgrading: (tier: string) => void;
  onUpgradeCheckAgain: (tier: string) => Promise<void>;
};
```

`setPlan` / `setFailed` are React state setters (stable identity), so the callbacks' empty dependency lists stay correct, as today.

### 4.3 Why the behaviour cannot change

| Concern | Argument |
|---|---|
| Hook call order | `PlanSection` calls `useLanguage`, then `plan` / `loading` / `failed` state, then `usePlanFlow(...)`, then the `firstStarted` / `firstRead` refs. The hook's internal order matches today's (state, `mounted` ref, `mounted` effect, callbacks, re-read effect) |
| Effect order | Today: `mounted` → bounded re-read → first read → `[language]`. After: identical, because the hook's two effects run where the hook is called, before `PlanSection`'s two. pg8 ("first-read effect immediately before the `[language]` effect", "`takePrefetched?.(` once") still holds on `PlanSection.tsx` |
| StrictMode | No ref or effect changes its guard. `mounted` keeps its set/unset effect |
| One copy | Nothing is duplicated: the predicates leave `PlanSection` and exist only in the hook. `PlanSection`'s JSX uses the hook's return values with the same names, so the render body is unchanged text |

### 4.4 How the existing tests prove it is a pure move

**Checkpoint (end of Task 2), recorded in this workplan before Task 3 starts:**

1. `git diff --stat origin/main -- components/business-os/settings/__tests__ app/business-os/settings/__tests__ lib/business-os` shows **nothing**.
2. These suites pass unchanged: `PlanSection.render`, `PlanPaymentState.render`, `PlanSection.prefetch.render`, `PlanDrawer.prefetch.render`, `PlanPurchase.render`, `PlanUpgrade.render`, `planDrawerReads`, `useDrawerPrefetch`, `app/business-os/settings/__tests__/planPrefetch.guard`, `accountCard.guard`, `settingsDeepLinks.guard`, `downloadMyData.render`, `lib/business-os/entitlements/__tests__/tierLiteral.forbidden`, `creditFigures.fromConfig.guard`, `enforcementPoints`.
3. `npx tsc --noEmit -p .` shows no new error in the touched files, and `npm run lint` is clean on them.

These suites cover every flow branch: M-6 processing / success / exhausted / slow (PlanPurchase.render, PlanPaymentState), U-5 upgrading / done / not confirmed / check again (PlanUpgrade.render), C-b take-once and B-1 to B-3 (both prefetch suites), and the source pins on `PlanSection.tsx` (pg8, CLIENT_FILES). If any of them needs an edit to pass, the move was not pure: stop, fix the move, and do not edit the test.

---

## 5. The modal

### 5.1 Component

`components/business-os/settings/UpgradeModal.tsx` (`'use client'`; location per UM-SA6):

```typescript
export function UpgradeModal(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** PlanSection's own plan state (C-3): the modal never reads it itself. */
  plan: PlanPayload;
}): JSX.Element;
```

No context prop in UM-1a: the headline set below is the `settings` context only. UM-2 adds the three-member union (C-4).

### 5.2 Pure view: `upgradeModalView.ts`

> **Superseded (UM-D1):** the card view model below (`PlanCardView`, `details`, `nextHeading`, `everything_in_plus`). Replaced by §5.2a. The rules table (offered tiers, current, recommended, headline, coming soon) **still applies** to the columns, except its "Plan-above heading (C-10)" row (C-26).

```typescript
export interface PlanCardView {
  planId: string;            // from the payload, never compared to a literal
  name: string;
  monthlyPriceUsd: number;
  isCurrent: boolean;        // plans[i].planId === plan.planId && plan.kind === 'tier' (UM-SA4)
  isRecommended: boolean;    // UM-SA4 + C-10 guards
  details: 'included' | 'next' | null; // the current card lists `included`; the nextPlanUp card lists adds / improves / changes
  comingSoon: boolean;       // !availableToBuy (see SA Q-1)
}
export function upgradeModalView(plan: PlanPayload): {
  cards: PlanCardView[];     // server order, untouched
  headline: 'choose' | 'top_plan' | 'compare';
  nextHeading: 'everything_in_plus' | 'adds_heading'; // C-10
  somethingOffered: boolean;
};
```

| Rule | Definition (all from server data) |
|---|---|
| Offered tiers | `purchase.offer.kind === 'choose' ? offer.tiers : []` ∪ `purchase.upgrade?.tiers ?? []` |
| Current | The `plans` entry whose `planId === plan.planId`, only when `plan.kind === 'tier'`. Trial and cohort accounts have no current card; the status strip names their plan |
| Recommended | `nextPlanUp?.planId`, else the last entry of `plans`, else none; **and** it is in the offered tiers **and** it is not the current card. So an Autopilot owner, an open-ended Founding Partner, or anyone with the switches off sees no ribbon |
| Plan-above heading (C-10) | `everything_in_plus` ("Everything in {current}, plus:") when a current tier card exists; else `plan.next.adds_heading` ("What {plan} would add", today's copy) |
| Headline | `choose` when anything is offered; else `top_plan` when the current card is the last entry of `plans`; else `compare` (SA Q-2) |
| Coming soon | `availableToBuy === false` on the card; on the `nextPlanUp` card, the server's `actionUnavailableBecause` sentence beside it (SA Q-1) |

### 5.2a Pure view, revised for the table (UM-D1)

```typescript
export interface PlanColumnView {
  planId: string;            // from comparison.planIds, never compared to a literal
  name: string;              // joined from plans[] by planId
  monthlyPriceUsd: number;
  isCurrent: boolean;        // plan.kind === 'tier' && planId === plan.planId (C-22)
  isRecommended: boolean;    // UM-SA4 + C-10 first half, unchanged
  comingSoon: boolean;       // !availableToBuy (SA Q-1)
  /**
   * What sits under the price and in the footer row (C-22):
   *  'offered'       the server offers this plan to this account (offer.tiers ∪ upgrade.tiers);
   *                  UM-1a renders NOTHING here (C-1), UM-1b mounts the trigger
   *  'current_label' current column and nothing offered for it: the non-interactive "Current plan"
   *  'none'          everything else (a Coming soon chip may still show)
   */
  action: 'offered' | 'current_label' | 'none';
}
export function upgradeModalView(plan: PlanPayload): {
  available: boolean;        // comparison non-null, planIds non-empty, every planId found in plans
  columns: PlanColumnView[]; // comparison.planIds order, untouched
  sections: PlanComparisonSection[]; // === plan.comparison.sections (identity; C-21)
  headline: 'choose' | 'top_plan' | 'compare'; // unchanged, W-1 applies
  somethingOffered: boolean; // unchanged, excludes the current tier's own id (W-1)
};
```

| Rule | Definition |
|---|---|
| Columns | `comparison.planIds`, in that order, each joined to its `plans` entry by `planId` for name, price, `availableToBuy`. If any id is missing from `plans`, `available = false` (defensive; UM-0 tests pin the equality) |
| Rows, cells, labels, values, highlight, section headings and order | **Not derived.** `sections` is the server's array, returned by identity; the component maps it in order (C-21) |
| Current column | Only when `plan.kind === 'tier'`; trial and cohort accounts get none (the status strip carries them) |
| `action` | `'offered'` if the plan's id is in `offer.tiers` (when `offer.kind === 'choose'`) or `upgrade.tiers`; else `'current_label'` when `isCurrent`; else `'none'`. So an admin-assigned tier whose own plan is offered "Pay for" gets `'offered'`, not the label (C-22, plan payments Q-5) |
| `available = false` | No "Compare plans" button (§5.5); the drawer is unchanged |

### 5.3 Layout

| Part | Content | Classes / notes |
|---|---|---|
| `DialogContent` | `dir={isRTL ? 'rtl' : 'ltr'}`, `data-testid="plan-compare-modal"` | `flex flex-col p-0 overflow-hidden w-full h-[100dvh] sm:h-auto sm:max-h-[90dvh] sm:max-w-4xl bg-[var(--v2-bg)] border-[var(--v2-border)]` plus the X colour (§5.4) |
| Header band (sticky, `flex-shrink-0`) | `Sparkles` (aria-hidden), `DialogTitle` = headline (`text-2xl font-semibold`, white), `DialogDescription` = `upgrade_modal.subheading` (`text-sm`, white) | `data-testid="plan-compare-band"`; solid `bg-[var(--v2-primary-dark)]` behind all text, `pe-12` keeps the X's corner free |
| Scroll body (`flex-1 overflow-y-auto p-4 sm:p-6`) | Status strip: `upgrade_modal.status_on` · `priceLine` · `renderSentence(endsWhen)`, muted, one line (wraps on a phone) | `data-testid="plan-compare-status"` |
| Cards | `<ul aria-label={t('upgrade_modal.plans_label')}>`, one `<li aria-labelledby>` per card, server order | `grid grid-cols-1 gap-4 sm:grid-flow-col sm:auto-cols-fr` (no class built from a count); RTL mirrors through `dir` |
| Card | Name (`h3`, the `aria-labelledby` target), "Your plan" chip (`Check`) or "Recommended" ribbon (`Star`), big price `$79` (`text-3xl font-semibold`, digits, USD) + `upgrade_modal.price_suffix` small; details list; Coming soon chip | `bg-[var(--v2-surface)]`, `shadow-[var(--v2-shadow-card)]`, `rounded-[var(--v2-radius-card)]`; current: `ring-1 ring-[var(--v2-border)]`; recommended: `ring-2 ring-[var(--v2-primary)] bg-[var(--v2-primary)]/5`, and `order-first sm:order-none` (phone: recommended first) |
| Current card details | `plan.includes` heading, `included` rows through `CategoryRowText`, `Check` in `--v2-primary` | Same component as the drawer |
| Plan-above card details | Heading per C-10; `adds` rows (`Plus`, `--v2-secondary`) and `improves` rows (`TrendingUp`, `--v2-success`, `plan.next.improves_line`); `changes` under `plan.next.changes_heading` with `ArrowRight` (mirrored in RTL), never as gains (SA R2-1) | Each list `aria-label`ed by its heading, as in `NextPlanUp` |
| Footer (`flex-shrink-0`, border-top) | `upgrade_modal.footer_prices`; the server's free-access sentence (`plan.choose.trial_ends_today` / `free_access_ends_today`) when `endsFreeAccessOnPurchase` is set; the B7 `whenThisChanges` sentence; `upgrade_modal.view_only_note` when something is offered; a secondary "Back to your plan" button (`DialogClose`) | `data-testid="plan-compare-footer"`; one button, secondary style. No Choose / Upgrade (C-1) |

Icons: `Sparkles`, `Check`, `Plus`, `TrendingUp`, `ArrowRight`, `Star` from `lucide-react`, all `aria-hidden`. No `Lock` (locked-action header is UM-2).

> **Superseded (UM-D1):** the "Cards", "Card", "Current card details" and "Plan-above card details" rows above, the recommended card's `order-first sm:order-none`, and the `Plus` / `TrendingUp` / `ArrowRight` icons. Replaced by §5.3a. `DialogContent`, the header band, the status strip and the footer rows **still apply** (the footer keeps the prices line, the free-access and B7 sentences, `view_only_note` and "Back to your plan").

### 5.3a Layout, revised: the comparison table (UM-D1, C-24)

One semantic `<table>` at every width, inside `data-testid="plan-compare-table-area"` (the element UM-1b's flows replace, C-25).

| Part | Content | Classes / notes |
|---|---|---|
| `<table>` | `<caption className="sr-only">` = `upgrade_modal.plans_label` | `w-full table-fixed border-separate border-spacing-0 text-sm`; `data-testid="plan-compare-table"`. No `min-w-*`, no fixed pixel width, no `overflow-x-auto` (guarded) |
| Header row (`<thead>`) | Corner cell (empty, `aria-hidden`, `max-sm:hidden`); one `<th scope="col">` per column: badge ("Your plan" chip with `Check` / "Recommended" ribbon with `Star`), plan name, price `$79` (`text-2xl font-semibold`, digits, USD) + `upgrade_modal.price_suffix` (`text-xs`), the action slot (§5.2a) | **`sticky top-0 z-10`** inside the modal's scroll body, on `bg-[var(--v2-bg)]` so rows do not show through. Recommended column: `border-t-2 border-[var(--v2-primary)] bg-[var(--v2-primary)]/5`; current column: `border-t-2 border-[var(--v2-border)] bg-[var(--v2-surface-hover)]` |
| Section heading rows (one `<tbody>` per section) | `<th scope="colgroup" colSpan={columns.length + 1}>` = `t(section.labelKey)`, uppercase small muted | `colSpan` is a number attribute, not a class built from a count |
| Feature rows | `<th scope="row">` = `row.label`; one `<td>` per cell, same order as columns | Tint of the recommended / current column repeated on its `<td>`s (from `columns[i]`, not from the cell) |
| Cell | `value !== null` → the value text, `highlight` → `text-[var(--v2-primary-dark)] font-semibold`. Else `included` → `Check` in `--v2-primary`; not included → `X` in `--v2-text-muted`. Icons `aria-hidden`; an `sr-only` span carries `upgrade_modal.cell_label` = "{plan}: {state}" where state is `upgrade_modal.included` / `upgrade_modal.not_included` / the value (C-23) | `text-center`. ✓ and ✕ differ in shape, not only colour (WCAG 1.4.1) |
| Footer row (`<tfoot>`) | Corner cell + the same action slot per column (C-22: the label appears twice for the current column) | Not sticky |
| "Current plan" label | `<span data-testid="plan-compare-current-label">` with `upgrade_modal.current_plan`, styled as a quiet outline button (`border border-[var(--v2-border)] rounded-[var(--v2-radius-button)] text-[var(--v2-text-muted)]`) | **Not** a `<button>`, no `role`, no `tabIndex`, no `aria-disabled` (C-22) |
| Coming soon | `plan.next.coming_soon` chip in the action slot's place when `comingSoon`; on the `nextPlanUp` column the server's `actionUnavailableBecause` sentence under it (SA Q-1 unchanged) | — |

**Phone, below 640 px (M-A, C-24):**

| Element | Re-flow |
|---|---|
| `<tr>` (header, feature, footer) | `max-sm:grid max-sm:grid-cols-2` — two plan columns, the assumption the C-27 tripwire (UM-0) protects |
| Row header `<th scope="row">` | `max-sm:col-span-2` — the feature label spans the row **above** its two compact cells |
| Section heading | `max-sm:col-span-2` |
| Corner cells | `max-sm:hidden` |
| Header row | Stays `sticky top-0` (name, price, action) |
| ARIA | Because `display` changes drop the native table semantics in some browsers, every element carries its explicit role: `table`, `rowgroup`, `row`, `columnheader`, `rowheader`, `cell` (SA (f)) |
| Width | Modal full width; body `p-3 sm:p-6`; cells `break-words`; at 360 px each plan column is about 164 px, enough for "$129", "19,750" and a two-line action label |

RTL: `dir` on the content mirrors the table (scope column on the right); no directional icon remains in the table. Dark: tokens only, as §5.4.

### 5.4 Colour and contrast (C-9)

- **All band text on solid `--v2-primary-dark`** (6.3:1 with white on default tokens). The `--v2-primary-dark` → `--v2-secondary` gradient is an `aria-hidden` decorative layer (`pointer-events-none absolute inset-y-0 end-0 w-1/3`) at the band's end edge; `bg-gradient-to-r` in LTR, `bg-gradient-to-l` in RTL, from transparent to `--v2-secondary`. The text column is kept clear of it by the band's own padding. SA Q-5 asks whether this reading of C-9 is right, or whether the 24 px title may sit on the full gradient.
- **The built-in X** is a direct child `<button>` of `DialogContent`. Its colour on the band is set from `DialogContent`'s className with a child selector, `[&>button]:text-white [&>button]:opacity-90 [&>button:focus]:ring-white`, the same child-selector technique `SettingsDrawer` uses on `SheetContent` (`[&>button]:hidden`). No duplicate X, no change to `dialog.tsx`. White on `--v2-primary-dark` passes the 3:1 graphics contrast. SA Q-4 confirms this is within C-8.
- **Ribbon**: white `text-xs` on solid `--v2-primary-dark`. **Chip "Your plan"**: `--v2-text-primary` on `--v2-surface-hover`.
- No hex value, no `text-red-*`, no `bg-white`, no `dark:` override in the file (guarded). Dark mode works through the `.dark` token overrides; primary / secondary are the same in both modes.
- The theme provider may overwrite `--v2-primary-dark` from platform custom tokens, so QA checks contrast on the computed token in the running app, light and dark (Jest cannot).

### 5.5 The "Compare plans" button in the drawer

- Rendered by `PlanSection` at the end of the `status === 'ok'` branch, after `PlanPurchase`.
- Shown when `(plan.plans?.length ?? 0) > 0 && !processing` (the hook's `processing`, not a new predicate). Not shown while B5 / B6 are on screen (SA Q-3). Not shown on loading, failure, or `status !== 'ok'`.
- **Revised (UM-D1):** additionally requires `upgradeModalView(plan).available` (a `comparison` the server sent, C-21). A payload without `comparison` (null, or a pre-UM-0 server) shows no button rather than a table the UI would have to invent.
- A coloured card-button: `Sparkles` + `upgrade_modal.open_compare`, `data-testid="plan-compare-open"`, `aria-haspopup="dialog"`, gradient chip on `--v2-primary-dark` with white `text-sm font-medium` (C-9: small white text on the dark end only).
- Focus returns to it on close (Radix default `onCloseAutoFocus`; a test pins it).

---

## 6. Copy keys (en / he / es)

New keys go into each dictionary's "Your plan" block (`lib/business-os/translations/{en,he,es}.ts`), next to `plan.*`. **The he and es wording is a draft for the user's approval before merge** (precedent P-4.2, P-6a.2). No key contains a credit figure (`creditFigures.fromConfig` scans the dictionaries).

| Key | en | he (draft) | es (draft) |
|---|---|---|---|
| `upgrade_modal.open_compare` | Compare plans | השוואת תוכניות | Comparar planes |
| `upgrade_modal.headline.choose` | Choose the plan that fits your business | בחירת התוכנית שמתאימה לעסק שלך | Elige el plan que mejor encaja con tu negocio |
| `upgrade_modal.headline.top_plan` | You're on our top plan | התוכנית שלך היא התוכנית המלאה ביותר שלנו | Ya tienes nuestro plan más completo |
| `upgrade_modal.headline.compare` | Compare our plans | השוואת התוכניות שלנו | Compara nuestros planes |
| `upgrade_modal.subheading` | See what each plan includes, side by side. | כל התוכניות זו לצד זו, ומה כל אחת כוללת. | Mira lo que incluye cada plan, uno al lado del otro. |
| `upgrade_modal.status_on` | You're on {plan} | התוכנית שלך: {plan} | Estás en {plan} |
| `upgrade_modal.your_plan` | Your plan | התוכנית שלך | Tu plan |
| `upgrade_modal.recommended` | Recommended | מומלצת | Recomendado |
| `upgrade_modal.price_suffix` | a month, excluding tax | לחודש, לא כולל מס | al mes, impuestos no incluidos |
| ~~`upgrade_modal.everything_in_plus`~~ **Superseded (UM-D1, C-26): dropped** | ~~Everything in {plan}, plus:~~ | ~~כל מה שיש ב־{plan}, ובנוסף:~~ | ~~Todo lo de {plan}, y además:~~ |
| `upgrade_modal.plans_label` | ~~Plans~~ **Revised: the table caption** — Plan comparison | ~~תוכניות~~ השוואה בין התוכניות | ~~Planes~~ Comparación de planes |
| `upgrade_modal.footer_prices` | Prices in USD, excluding tax. | המחירים בדולר ארה״ב, לא כולל מס. | Precios en USD, impuestos no incluidos. |
| `upgrade_modal.view_only_note` | To choose or upgrade, go back to Your plan. | לבחירה או לשדרוג, אפשר לחזור אל ״התוכנית שלך״. | Para elegir o mejorar tu plan, vuelve a Tu plan. |
| `upgrade_modal.back_to_plan` | Back to your plan | חזרה לתוכנית שלך | Volver a tu plan |

**Added (UM-D1)** — he / es drafts for the user's approval, as above:

| Key | en | he (draft) | es (draft) |
|---|---|---|---|
| `upgrade_modal.current_plan` | Current plan | התוכנית הנוכחית | Plan actual |
| `upgrade_modal.included` | Included | כלול | Incluido |
| `upgrade_modal.not_included` | Not included | לא כלול | No incluido |
| `upgrade_modal.cell_label` | {plan}: {state} | {plan}: {state} | {plan}: {state} |

**Revised key count: 17** (14 − `everything_in_plus` + 4). The section headings (`plan.comparison.section.*`) and the row labels are **not** UM-1a copy: they come from the server (UM-0 §7). "Not included" alone does not match the `noExclusions` phrasing rule ("not included in your …"); the guard checks all `upgrade_modal.*` values (C-23).

**Reused, unchanged** (revised: `plan.includes`, `plan.next.adds_heading`, `plan.next.improves_line`, `plan.next.changes_heading`, `plan.next.changes_line` and `plan.category.*` are **no longer rendered by the modal** after UM-D1; the drawer still uses them): `plan.includes`, `plan.price.per_month`, `plan.price.free`, `plan.price.free_no_end`, `plan.next.adds_heading`, `plan.next.improves_line`, `plan.next.changes_heading`, `plan.next.changes_line`, `plan.next.coming_soon`, `plan.choose.trial_ends_today`, `plan.choose.free_access_ends_today`, every `plan.category.*` and the sentence keys the server sends.

Notes: the Hebrew uses gershayim (״), not ASCII `"`, so no string needs escaping. `view_only_note` and `back_to_plan` exist only for UM-1a; UM-1b replaces the note with real actions and removes or keeps the button (SA Q-6).

---

## 7. Files to create / modify

All paths are relative to the worktree root (`C:/…/neuronforge` equivalent).

| File | Action | Reason |
|---|---|---|
| `components/business-os/settings/planPayloadTypes.ts` | create | Mirrored payload types, client-side, types only (C-6) |
| `components/business-os/settings/planText.tsx` | create | `renderSentence`, `fill`, `priceLine`, `CategoryRowText`, `Notice`, `ACCOUNT_CLOCK_SENTENCE_KEYS`, moved verbatim and shared by drawer and modal |
| `components/business-os/settings/usePlanFlow.ts` | create | The extracted flow (C-2), plus `planFrom` / `fetchPlan` |
| `components/business-os/settings/upgradeModalView.ts` | create | Pure card / marker / headline rules (UM-SA4, C-10) |
| `components/business-os/settings/UpgradeModal.tsx` | create | The view-only modal |
| `components/business-os/settings/PlanSection.tsx` | modify | Consume `usePlanFlow`, import from the two new modules, re-export `ACCOUNT_CLOCK_SENTENCE_KEYS` and `type PlanPayload`, add the "Compare plans" button and render `UpgradeModal` |
| `lib/business-os/translations/en.ts` | modify | 14 `upgrade_modal.*` keys |
| `lib/business-os/translations/he.ts` | modify | Same keys, draft wording |
| `lib/business-os/translations/es.ts` | modify | Same keys, draft wording |
| `components/business-os/settings/__tests__/upgradeModalView.test.ts` | create | Unit tests, one per §2.2 state, real payloads |
| `components/business-os/settings/__tests__/UpgradeModal.render.test.tsx` | create | Render tests (states, RTL, classes, a11y) |
| `components/business-os/settings/__tests__/UpgradeModal.layers.test.tsx` | create | Nested in `SettingsDrawer`: Escape / X / backdrop close the modal only, focus returns |
| `components/business-os/settings/__tests__/upgradeModal.guard.test.ts` | create | Source guards (C-1, C-2, C-3, C-6, C-8, C-9, C-12, no console) |
| `components/business-os/settings/__tests__/PlanPurchase.render.test.tsx` | modify | §10 assertion mapping; add the new client files to `CLIENT_FILES` |
| `lib/business-os/entitlements/__tests__/creditFigures.fromConfig.guard.test.ts` | modify | Add `UpgradeModal.tsx` and `planText.tsx` to `SOURCES` (the file's own instruction: "an upgrade dialog … add it") |
| `docs/requirements/BUSINESS_OS_UPGRADE_MODAL_REQUIREMENT.md` | modify | Record UM-1a workplan, SA ruling, PR and merge in the main requirement (standing preference) |

**Revised (UM-D1):**

| File | Change to the table above |
|---|---|
| `components/business-os/settings/planPayloadTypes.ts` | Also gains the **mirrored** `PlanComparison`, `PlanComparisonSection`, `PlanComparisonRow`, `PlanComparisonCell` types (UM-0 §5 field by field) and `comparison?: PlanComparison \| null` on `PlanPayload` (optional, so an older payload type-checks and reads as "not available"). Written by hand, **no import from `lib/business-os/entitlements/`, type-only included** (C-6); a type-equality test is not possible without that import, so `upgradeModalView.test` drives real `buildCustomerPlanView` output through JSON instead (tests may import the module) |
| `components/business-os/settings/upgradeModalView.ts` | Columns + action slot + identity pass-through of sections (§5.2a), instead of cards |
| `components/business-os/settings/UpgradeModal.tsx` | The table (§5.3a) instead of cards |
| `lib/business-os/translations/{en,he,es}.ts` | **17** `upgrade_modal.*` keys (not 14) |
| Test files | Same four new files, rewritten for the table (§9); `PlanPurchase.render` §10 mapping re-checked (§10 note) |
| `components/business-os/settings/__tests__/planComparison.twoPlans.tripwire.test.ts` | **Not created here** — UM-0 creates it (C-27); UM-1a only relies on it |

**Not touched:** `components/ui/dialog.tsx`, `app/business-os/settings/page.tsx`, `SettingsDrawer.tsx`, `PlanPurchase.tsx`, `PlanUpgrade.tsx`, `billing/PlanEmbeddedCheckout.tsx`, `planDrawerReads.ts`, `useDrawerPrefetch.ts`, every route, every entitlements / billing server file, the DB.

---

## 8. Task list and estimates

| # | Task | Est. |
|---|---|---|
| ⬜ 0 | In the RM-created worktree: `npm ci` or link `node_modules`, run the baseline of every suite in §4.4 and record it green | 0.1 d |
| ⬜ 1 | Move payload types to `planPayloadTypes.ts` and the text helpers to `planText.tsx`; re-exports from `PlanSection.tsx` | 0.25 d |
| ⬜ 2 | Extract `usePlanFlow.ts` verbatim (§4); `PlanSection` consumes it | 0.4 d |
| ⬜ 2a | **Checkpoint** (§4.4): zero test diff, suites green, tsc / lint clean. Result recorded here. RM may commit Tasks 1 to 2 as their own `refactor:` commit | 0.05 d |
| ⬜ 3 | `upgradeModalView.ts` + `upgradeModalView.test.ts` (one case per §2.2 state with a card) | 0.3 d |
| ⬜ 4 | 14 copy keys in en / he / es; `dictionariesStayInStep` green | 0.15 d |
| ⬜ 5 | `UpgradeModal.tsx`: band, status strip, cards, footer, RTL, mobile, tokens | 0.6 d |
| ⬜ 6 | "Compare plans" button in `PlanSection` and modal wiring | 0.15 d |
| ⬜ 7 | `UpgradeModal.render`, `UpgradeModal.layers`, `upgradeModal.guard`; §10 mapping in `PlanPurchase.render`; guard list additions | 0.5 d |
| ⬜ 8 | Full runs: the §4.4 list again, the new suites, `npm run test:bos-entitlements` (a file in `entitlements/__tests__` changed), `npm run lint`, `npx tsc --noEmit`; `git diff --stat` sanity check (no deletion-only file) | 0.15 d |
| ⬜ 9 | Screenshots for the user diff (light, dark, Hebrew, 360 px) from `npm run dev`; update the requirement MD | 0.1 d |
| | **Total** | **≈ 2.75 d** (SA: 2.5 d; the extra is the checkpoint and the layers test) |

> **Revised task list (UM-D1).** Tasks 0, 1, 2, 2a are **unchanged** and may run before UM-0 merges. Tasks 3–9 above are superseded by the rows below.

| # | Task | Est. |
|---|---|---|
| ✅ 0–2a | As above, unchanged (types, `planText`, `usePlanFlow` extraction, recorded checkpoint W-6). Checkpoint: see Implementation Notes | 0.8 d |
| 🟡 2b | **Wait for UM-0 to merge**, then rebase the branch on `origin/main`; re-run the §4.4 checkpoint list (still zero test diff). Met locally (branch cut from UM-0's tip); the rebase after #480 merges is still owed | 0.05 d |
| ✅ 3 | Mirrored `comparison` types in `planPayloadTypes.ts`; `upgradeModalView.ts` (§5.2a) + `upgradeModalView.test.ts` | 0.35 d |
| ✅ 4 | 17 copy keys in en / he / es; `dictionariesStayInStep` green | 0.15 d |
| ✅ 5 | `UpgradeModal.tsx`: band, status strip, the table (§5.3a), sticky header row, phone re-flow with explicit ARIA roles, footer, RTL, tokens | 0.9 d |
| ✅ 6 | "Compare plans" button in `PlanSection` (with `available`) and modal wiring | 0.15 d |
| ✅ 7 | `UpgradeModal.render`, `UpgradeModal.layers`, `upgradeModal.guard` for the table (§9); §10 mapping in `PlanPurchase.render`; guard list additions | 0.6 d |
| ✅ 8 | Full runs (as old Task 8) | 0.15 d |
| 🟡 9 | Screenshots for the user diff (light, dark, Hebrew, 360 px, an Essentials and a trial account) ✅ (static render, see Implementation Notes); update the requirement MD ⬜ (W-7 / W-11, BA / TL) | 0.1 d |
| | **Revised total** | **≈ 3.25 d** (SA re-review: ≈ 3 d; the extra is the phone re-flow with explicit roles) |

---

## 9. Test plan

### 9.1 Per §2.2 state (`upgradeModalView.test.ts` and `UpgradeModal.render.test.tsx`)

Payloads are built like `PlanPurchase.render.test.tsx` does (real `buildCustomerPlanView` + `readPlanPurchaseView`, through JSON), so the tests break if the server payload drifts. Tier ids appear only in these test files (C-7).

| §2.2 state | Expected in the modal |
|---|---|
| Trial (Test Flight) | No current card; status "You're on Test Flight · Free · {trial end}"; Autopilot card recommended (offered via `offer.tiers`) with `plan.next.adds_heading` (not "Everything in"); Essentials card name + price only; footer shows `plan.choose.trial_ends_today` and the B7 sentence; headline `choose`; view-only note shown |
| Founding Partner, no end date | No current card, **no ribbon** (nothing offered); no `nextPlanUp` card details; headline `compare`; no ends-today sentence; no view-only note |
| Founding Partner, end date set | Ribbon on the last plan (no `nextPlanUp`, offered via `choose`); footer `plan.choose.free_access_ends_today`; headline `choose` |
| No plan / paused / ended | As sent: offered → ribbon and `choose` headline |
| Essentials, renewing | Essentials current card with "Your plan" chip and `included` rows; Autopilot recommended with "Everything in Essentials, plus:", adds and improves rows; headline `choose` |
| Essentials, cancelling | Whatever the server sends for `upgrade`: if offered, as renewing; if not, no ribbon and headline `compare` (both cases tested) |
| Autopilot, renewing | Autopilot current; **no ribbon**; headline `top_plan`; Essentials card without "Coming soon" (it is on sale, just not to them) |
| Payment failed / 3-D Secure on renewal | Status strip carries the server's ending sentence; the modal shows **no** `plan-update-card-email` and **no** `plan-confirm-payment` (account matters stay in the drawer) |
| Admin-assigned tier, no billing | Current card for the assigned tier; its own plan offered (Q-5) but current, so no ribbon on it; ribbon on `nextPlanUp` if offered |
| Stripe key missing | Modal unaffected (no control in UM-1a); the drawer still shows the not-configured line |
| Just paid / just upgraded (B5 / B6) | "Compare plans" is not on screen while `processing` (render test through `PlanSection`) |
| `nextPlanUp.availableToBuy = false` | That card shows "Coming soon" + the server's reason sentence, no control |
| Old payload (no `plans`) / `purchase: null` | No `plans` → no "Compare plans" button; `purchase: null` → button shown, nothing offered, no ribbon |
| **No dead button (every state)** | Inside `plan-compare-modal` the only buttons are the X and "Back to your plan" |

### 9.2 Behaviour, RTL, dark, mobile

| Test | Assertion |
|---|---|
| Open / close (AC-UM1, view-only part) | Click "Compare plans" opens the modal; Escape, the X and "Back to your plan" close it; focus returns to the button |
| Layers (`UpgradeModal.layers`) | Inside `SettingsDrawer`: Escape and a backdrop press close the modal only; the drawer stays open; a press inside the modal does not close the drawer (UM-SA2) |
| Shared state (C-3) | `fetch` count does not change when the modal opens; after a bounded re-read updates `plan`, the open modal shows the new value |
| Title / description | `getByRole('dialog', { name: headline })`, description is the subheading |
| List semantics | `getByRole('list', { name: 'Plans' })`; each `listitem` named by its plan name |
| RTL (`language = 'he'`) | Content `dir="rtl"`; Hebrew headline, chip, ribbon from the dictionary; decorative layer uses `bg-gradient-to-l`; `ArrowRight` in the changes list carries `scale-x-[-1]`; prices stay `$79` digits |
| es | Spanish strings, no English left in the modal (checked against the en values) |
| Dark | Source guard: no hex, no `text-red-`, no `bg-white`, no `dark:` in `UpgradeModal.tsx`; render: band has `bg-[var(--v2-primary-dark)]`, cards `bg-[var(--v2-surface)]` |
| C-9 classes | Every element with `text-white` inside the band or ribbon has `bg-[var(--v2-primary-dark)]` on itself or its band ancestor; the gradient layer is `aria-hidden` and holds no text |
| Mobile classes (C-8) | `DialogContent` class contains `flex`, `h-[100dvh]`, `sm:h-auto`, `sm:max-w-4xl`, and **no** `max-w-` token without an `sm:` prefix; card list `grid-cols-1` + `sm:grid-flow-col`; recommended card `order-first sm:order-none` |

### 9.3 Guards

| Guard | Expectation |
|---|---|
| `lib/business-os/entitlements/__tests__/tierLiteral.forbidden.test.ts` | Green **unchanged**: zero tier literals in the five new product files (the guard scans them automatically) |
| `app/business-os/settings/__tests__/planPrefetch.guard.test.ts` | Green **unchanged** (pg8 on `PlanSection.tsx`; page untouched) |
| `accountCard.guard`, `settingsDeepLinks.guard` | Green unchanged (page untouched) |
| `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts` | Green unchanged: no new importer from the module (C-6) |
| `lib/business-os/__tests__/dictionariesStayInStep.guard.test.ts` | Green: all 14 keys in en, he, es |
| `creditFigures.fromConfig.guard` | Green with `UpgradeModal.tsx` and `planText.tsx` added to `SOURCES` |
| `PlanPurchase.render` › source guards | `CLIENT_FILES` gains `planPayloadTypes.ts`, `planText.tsx`, `usePlanFlow.ts`, `upgradeModalView.ts`, `UpgradeModal.tsx`; all `'use client'` where they render |
| **New** `upgradeModal.guard.test.ts` | (a) `UpgradeModal.tsx` imports none of `PlanPurchase`, `PlanUpgrade`, `PlanEmbeddedCheckout`, `stripeJs` (C-1, C-12); (b) `UpgradeModal.tsx` and `upgradeModalView.ts` contain no `readMyPlan`, `fetch(`, `planDrawerReads`, `my-plan` (C-3); (c) in `components/business-os/settings/*.ts(x)` product files, `billing?.state === 'renewing'`, `PROCESSING_REFRESH_LIMIT`, `setUpgradeWatching(` and `setCompletedSession(` appear only in `usePlanFlow.ts` (C-2); (d) no import from `lib/business-os/entitlements` in the five new files (C-6); (e) no `console.` (rule 3); (f) the C-8 / C-9 class rules above, each with a planted-violation self-test as `planPrefetch.guard` does |
| `npm run test:bos-entitlements` | Green on the final diff (skill checklist) |

### 9.4 Revised for the table (UM-D1)

> **Superseded (UM-D1) in §9.1–§9.3:** every expectation about cards — "card", "`included` rows", "Everything in Essentials, plus:", "`plan.next.adds_heading`", "name + price only", the `list` / `listitem` semantics, and "recommended card `order-first sm:order-none`" in the mobile classes. Everything else there (open / close, layers, W-2 shared state, title / description, RTL, es, dark, C-9 classes, guards (a)–(f), the unchanged-guard rows) **still applies**, read against columns instead of cards.

**Per §2.2 state** (payloads from real `buildCustomerPlanView` + `readPlanPurchaseView` through JSON, so `comparison` is the server's):

| State | Expected |
|---|---|
| Trial | **No current column**, no "Your plan" badge, no `plan-compare-current-label`; Autopilot column recommended; both columns' action slots empty (offered, UM-1a renders nothing); view-only note shown; headline `choose` |
| Founding Partner, no end date | No current column, no ribbon, no label; headline `compare` |
| Founding Partner, end date | No current column; ribbon on the recommended column; headline `choose` |
| Essentials, renewing | Essentials column "Your plan" + **two** `plan-compare-current-label` (header and footer); Autopilot recommended; headline `choose` |
| Autopilot, renewing | Autopilot column "Your plan" + label ×2; no ribbon; headline `top_plan` |
| **Admin-assigned tier, own plan offered (C-22)** | Current column "Your plan", **no** "Current plan" label (the server has an action; slot empty in UM-1a); W-1 headline `top_plan` / `compare` |
| `comparison: null` / no `comparison` key | `available === false`; no "Compare plans" button |
| `nextPlanUp.availableToBuy = false` | "Coming soon" chip + reason sentence in that column's slot |

**Table behaviour and C-21:**

| Test | Assertion |
|---|---|
| Identity pass-through | `upgradeModalView(plan).sections` **is** (`toBe`) `plan.comparison.sections` |
| Rendering follows the payload | Rows render in payload order with payload labels; the ✓ / ✕ / value per cell equals the payload; flipping one cell's `included` in a copied payload flips exactly that cell's icon and sr text; a planted extra row appears; removing a section removes its heading |
| Highlight | Only cells with `highlight: true` carry the `--v2-primary-dark` / `font-semibold` classes |
| Semantics | `getByRole('table', { name: 'Plan comparison' })`; one `columnheader` per plan named by the plan; one `rowheader` per row; section headings are `colgroup` headers |
| Screen-reader text (C-23) | Every cell has "{plan}: Included" / "{plan}: Not included" / "{plan}: {value}"; counts computed from the payload, never from config |
| "Current plan" is not a control (C-22) | `queryAllByRole('button', { name: /Current plan/ })` is empty; the label has no `tabIndex`, no `role`, no `aria-disabled` |
| **No dead button** | Inside `plan-compare-modal` the only buttons are the X and "Back to your plan", in every state |
| Phone classes (C-24) | Rows `max-sm:grid max-sm:grid-cols-2`; row headers and section headings `max-sm:col-span-2`; header row `sticky top-0`; explicit ARIA roles on every table element; no `min-w-`, no `overflow-x-auto`, no fixed pixel width on the table or its cells |
| RTL | `dir="rtl"`; the column order is the payload's (mirroring is CSS / `dir`, not a reversed array) |

**Guards added to `upgradeModal.guard.test.ts` (C-21, C-23):** (g) no catalog capability id (the test reads `CAPABILITY_IDS`; tests may import the module) and no config row label in any language (the test reads `PLAN_COMPARISON_ROWS`) appears in `UpgradeModal.tsx`, `upgradeModalView.ts`, `planPayloadTypes.ts`; (h) `upgradeModalView.ts` calls no `.sort(`, `.filter(` or `.reverse(` on `sections`, `rows` or `cells`; (i) the `noExclusions` phrasing pattern matches no `upgrade_modal.*` value in en / he / es; (j) the "Current plan" label element is not a `button`; (k) the `max-sm:grid-cols-2` assumption is named with a pointer to the C-27 tripwire. Each with a planted-violation self-test.

---

## 10. Existing assertions moved: old → new (C-5)

Only `components/business-os/settings/__tests__/PlanPurchase.render.test.tsx` changes, and only because the payloads there carry `plans`, so the new view-only "Compare plans" button is now on screen. A helper `moneyButtons()` returns every button except `plan-compare-open`. Line numbers are on `origin/main` `4583d21e`.

| Line | Test | Old | New |
|---|---|---|---|
| 228 | a Founding Partner WITH an end date may buy… | `expect(screen.getAllByRole('button').length).toBeGreaterThan(0)` | `expect(moneyButtons().length).toBeGreaterThan(0)` (otherwise vacuous) |
| 236 | BQ-P10: an open-ended Founding Partner sees no Choose at all | `expect(screen.queryByRole('button')).not.toBeInTheDocument()` | `expect(moneyButtons()).toEqual([])` + `expect(screen.getByTestId('plan-compare-open')).toBeInTheDocument()` |
| 246 | a paying account: no Choose… | same old | same new |
| 300 | the switches off (production today)… | same old | same new |
| 310 | purchase: null… | same old | same new |
| 318 | M-2: no usable publishable key… | same old | same new |
| 409 | a refused start (%s)… "The buttons come back" | `expect(screen.getAllByRole('button').length).toBeGreaterThan(0)` | `expect(moneyButtons().length).toBeGreaterThan(0)` |
| 381, 404, 514 | `getAllByRole('button')[0]` clicks Choose | unchanged | unchanged: "Compare plans" is last in the DOM (§3.5). Recorded so SA sees the dependency |

**Re-checked for UM-D1 (C-22):** the mapping above stands unchanged. (1) The "Current plan" label is a `<span>`, not a button, so it can never enter `moneyButtons()` or any `getAllByRole('button')` count, even with the modal open. (2) The modal content is not in the DOM while closed (Radix unmounts it), and none of these tests opens it. (3) **W-3** holds: `moneyButtons()` still excludes by the exact id `plan-compare-open` only, and each mapped absence test still asserts that button is present. (4) **W-4** holds: `plan-compare-open` stays the last button in the section; the table adds no button to the drawer. (5) New in the revision: the "Compare plans" button now also needs `comparison` (§5.5). The payloads in `PlanPurchase.render` come from `buildCustomerPlanView` after UM-0, so they carry it and the mapping applies; if one does not, keep its original assertion and record it here (W-3).

`PlanSection.render.test.tsx` lines 233 and 254 (`queryByRole('button')` absent) stay unchanged: their payload is the plan builder's output alone, which has no `plans`, so no button is shown. If either fails, the payload does carry `plans`; map it the same way and record it here. **No assertion is deleted.** Every island test id is unchanged.

---

## 11. Logging (CLAUDE.md § Logging)

`console.*` count on `origin/main` in every file this slice touches: `PlanSection.tsx` 0, `PlanPurchase.render.test.tsx` 0 (source guard pins it), `lib/business-os/translations/en.ts` 0, `he.ts` 0, `es.ts` 0, `creditFigures.fromConfig.guard.test.ts` 0. Nothing to flag. The new files use `createLogger` only where they log (`usePlanFlow.ts`, the moved `warn` lines); `UpgradeModal.tsx` logs nothing (it does no I/O). The new guard pins no `console.`.

---

## 12. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | The extraction changes effect order or StrictMode behaviour without a test noticing | §4.3 argument; checkpoint with zero test diff; pg8 still pins the first-read effect position |
| R-2 | The "Compare plans" button turns "no button" assertions red | Mapped in §10; button placed last so index-based clicks still hit Choose |
| R-3 | Nested-layer dismissal (a press in the modal closes the drawer) | Modal rendered inside `SheetContent` by `PlanSection`; `UpgradeModal.layers` test |
| R-4 | Built-in X's sr-only label is the English "Close" in he / es | `dialog.tsx` must stay unchanged (C-8), so UM-1a inherits it. Flag for UM-3 (a11y pass) or an SA-approved `dialog.tsx` change (Q-4) |
| R-5 | Theme provider custom tokens lower contrast on `--v2-primary-dark` | QA checks computed tokens, light and dark (C-9) |
| R-6 | On a phone, CSS `order-first` puts the recommended card first visually while the DOM keeps server order | Harmless in UM-1a (no focusable control in a card). In UM-1b the cards gain buttons and focus order would differ from visual order; SA Q-8 |
| R-7 | Between 512 px and 639 px wide, the base `max-w-lg` caps the modal at 512 px | Acceptable (cards stack below `sm`); no second base `max-w` (C-8) |
| R-8 | The modal opened over an open embedded checkout in the drawer | No second checkout (C-12 holds); the drawer's frame stays mounted beneath. QA notes it; UM-1b removes the case |
| R-9 | A copy draft carries a credit figure | None does; `creditFigures.fromConfig` scans the dictionaries |
| R-10 | Stale local checkout, shared `node_modules` junction, shared stash list | Work only in the fresh worktree; never `git stash`; unlink the junction before removing a worktree |
| R-11 | Bundle size on Settings (modal imported eagerly) | Small, Settings-only; lazy loading arrives with the provider in UM-2 (`lazyDialogs`) |

**Revised (UM-D1):** R-6 is **moot** (no `order-first`; the table keeps one order at every width). New:

| # | Risk | Mitigation |
|---|---|---|
| R-12 | Re-flowing table elements with `display: grid` drops native table semantics in some browsers | Explicit ARIA roles on every element (SA (f)); a render test asserts them; QA checks VoiceOver / TalkBack on a phone |
| R-13 | `position: sticky` on a table header misbehaves inside the dialog's flex scroll body (iOS Safari) | Sticky on the header row's cells as well as on `<thead>`; QA checks 360 px on iOS and Android. Fallback, recorded not built: M-B (one plan at a time) only after QA, per C-24 |
| R-14 | UM-0's field shape changes in its review | Tasks 3–9 start only after UM-0 merges (Task 2b); the mirrored type follows the merged shape |

---

## 13. Open questions for SA

| # | Question | Dev proposal |
|---|---|---|
| Q-1 | "Coming soon" on a card: by `availableToBuy === false`, or by "not in the offered tiers" (`PlanPurchase`'s rule)? The second marks Essentials "Coming soon" for an Autopilot owner, which is untrue | `!availableToBuy`, plus `actionUnavailableBecause` on the `nextPlanUp` card |
| Q-2 | Headline "You're on our top plan" uses a positional rule (current tier card is the last of `plans`, nothing offered); otherwise "Compare our plans". Accept, as UM-SA4 accepted position for the ribbon? | Accept |
| Q-3 | Hide "Compare plans" while `processing` (B5 / B6)? Show it when `purchase` is null or the switches are off? | Hide while processing; show otherwise whenever `plans` is non-empty |
| Q-4 | Restyling the built-in X with `[&>button]:text-white …` on `DialogContent`'s className: within C-8? The English sr-only "Close" remains | Yes, within C-8; English label flagged for UM-3 |
| Q-5 | C-9 reading: all band text on solid `--v2-primary-dark`, gradient only as an `aria-hidden` decorative layer at the end edge. Or may the 24 px bold title sit on the full gradient? | Solid behind text, decorative gradient |
| Q-6 | UM-1a footer: "To choose or upgrade, go back to Your plan." + a secondary "Back to your plan" button. Acceptable as interim copy that UM-1b replaces? | Yes |
| Q-7 | `usePlanFlow` takes `plan` / `setPlan` / `setFailed` / `loading` from `PlanSection` (the first read stays there to keep pg8 green unchanged). The standalone modal in UM-2 then needs its own read beside the hook. Confirm that is UM-2's call | Confirm |
| Q-8 | Phone ordering by CSS `order` (DOM stays server order). Fine for UM-1a; does UM-1b need DOM reordering for focus order? | CSS for UM-1a; decide in UM-1b |
| Q-9 | "Compare plans" placed after the islands in UM-1a (keeps index-based tests stable, lands under B9 once UM-1b moves the islands) | Accept |
| Q-10 | C-13 (`text-red-700` → `--v2-error-text` in `PlanPurchase` / `PlanUpgrade`) deferred to UM-1b, since UM-1a touches no island | Defer |

**Revised (UM-D1):** Q-8 is **moot** for UM-1a (SA re-review). New questions for the re-review:

| # | Question | Dev proposal |
|---|---|---|
| Q-11 | In view-only UM-1a an offered column's action slot is **empty** (C-1), so a trial owner sees two columns with no action and the footer's view-only note. Acceptable until UM-1b, or show a non-interactive hint in the slot? | Empty slot + the existing footer note; no new copy |
| Q-12 | For the admin-assigned tier whose own plan is offered, the current column shows "Your plan" but no "Current plan" label in UM-1a (C-22 reserves the slot for the server's action). Confirm | Confirm |
| Q-13 | `comparison` on the mirrored `PlanPayload` is optional (`?:`), so an older payload reads as "not available" and hides the button. Accept, or require it once UM-0 is merged? | Optional; the button rule covers both |
| Q-14 | Sticky header: on both `<thead>` and its cells (R-13), at every width, not only on a phone. Accept? | Accept |

---

## Implementation Notes

**Worktree:** `neuronforge-upgrade-modal-um1a`, branch `feature/bos-upgrade-modal-um1a`, created by RM from the tip of `feature/bos-upgrade-modal-um0` (`5243d900`, PR #480, not yet merged). So UM-0's `comparison` is present locally and Task 2b's dependency is met **locally**. The rebase on `origin/main` after #480 merges is still owed before the PR opens (C-15). Changes are left uncommitted for the user's review. The worktree had no `node_modules`; a junction to the main checkout's `node_modules` was created (ignored by git; never delete it, never `git worktree remove` without unlinking it first).

### Checkpoint 2a (W-6), recorded before Task 3

| Check | Result |
|---|---|
| Baseline before any edit (Task 0) | §4.4 list + `components/business-os/settings/__tests__` + `app/business-os/settings/__tests__` + `dictionariesStayInStep`: **38 / 38 suites, 836 / 836 tests**; `components/business-os/__tests__`: **17 / 17, 391 / 391** |
| `git status -- components/business-os/settings/__tests__ app/business-os/settings/__tests__ lib/business-os` after Tasks 1–2 | **Empty**: no test file and no `lib/business-os` file changed |
| Same suites after Tasks 1–2 | **55 / 55 suites, 1,227 / 1,227 tests** (= 38 + 17, 836 + 391), no test edited |
| `npx tsc --noEmit -p .` | No error in `components/business-os/settings/` |
| `npx eslint` on the four touched / new files | Clean |

**Result: pure move confirmed.** No suite needed a test edit.

**§4.3 hook-order sentence, corrected (SA note):** today `firstStarted` / `firstRead` were declared *before* the `mounted` effect; after the move they are declared *after* the `usePlanFlow(...)` call (which holds the flow state, the `mounted` ref, its effect, the callbacks and the bounded re-read). Hook order only has to be stable from one build to the next, so this is harmless. **Effect order is unchanged**: `mounted` → bounded re-read → first read → `[language]`. P-G8 still holds on `PlanSection.tsx`.

**Move details:** `setPlan` / `setFailed` are now hook arguments, so `exhaustive-deps` cannot see that they are state setters. The two flow hooks carry an `eslint-disable-next-line react-hooks/exhaustive-deps` comment that says why. The dependency lists are the same as before.


### Tasks 3–9: what was built

| Item | Where |
|---|---|
| Mirrored `PlanComparison*` types, `comparison?:` optional (SA Q-13), no entitlements import (C-6) | `components/business-os/settings/planPayloadTypes.ts` |
| Pure view (§5.2a): columns by `planIds`, `sections` by identity, `action` per C-22, W-1 `somethingOffered`, UM-SA4 recommended, `unavailableBecause` on the `nextPlanUp` column (SA Q-1) | `components/business-os/settings/upgradeModalView.ts` |
| The modal (§5.3a): band (solid primary-dark + `aria-hidden` end-edge gradient, mirrored in RTL), status strip, table with explicit ARIA roles, sticky `thead` below `sm` / sticky header cells from `sm` (W-8), phone two-column grid rows via one `PHONE_ROW` constant naming the C-27 tripwire, footer row, "Current plan" `<span>` label, footer notes and "Back to your plan" | `components/business-os/settings/UpgradeModal.tsx` |
| "Compare plans" (last in the section; hidden while `processing` or without a `comparison`; label on solid primary-dark, W-5) | `components/business-os/settings/PlanSection.tsx` |
| 17 `upgrade_modal.*` keys, en + he / es drafts | `lib/business-os/translations/{en,he,es}.ts` |
| Tests | `upgradeModalView.test.ts`, `UpgradeModal.render.test.tsx`, `UpgradeModal.layers.test.tsx`, `upgradeModal.guard.test.ts` (guards (a)–(k), each with a planted-violation control), shared real-payload fixture `upgradeModalPayloads.ts` (it carries its own self-check `describe`, following the `financeRequestPins.ts` precedent, because Jest collects every file under `__tests__`) |
| §10 mapping | `PlanPurchase.render`: lines 228, 236, 246, 300, 310, 318 and 409 mapped exactly as §10 says (exact-id `moneyButtons()`, W-3); W-4 last-button pin added; `CLIENT_FILES` and the `'use client'` checks gain the five new files. **`PlanSection.render` lines 233 and 254 are also mapped**: this is §10's pre-authorised case, because since UM-0 the builder's own output carries `plans` and `comparison`, so the button is on screen. No assertion deleted |
| `creditFigures.fromConfig.guard` `SOURCES` | Adds `UpgradeModal.tsx` and `planText.tsx` |

### Final runs (2026-10-19, in the worktree)

| Run | Result |
|---|---|
| `components/business-os/settings/__tests__` + `components/business-os/__tests__` + `app/business-os/settings/__tests__` (incl. `planPrefetch.guard`, `accountCard.guard`, `settingsDeepLinks.guard`) + `tierLiteral.forbidden` + `creditFigures.fromConfig.guard` + `enforcementPoints` + `dictionariesStayInStep` | **60 / 60 suites, 1,317 / 1,317 tests** |
| `npm run test:bos-entitlements` | **300 / 300 suites, 9,076 / 9,076 tests** |
| `npm run lint:hooks` | Clean (exit 0) |
| `npx eslint` on every new or touched component and test file | Clean |
| `npx tsc --noEmit -p .` | No error in `components/business-os/settings/`, the dictionaries or the guard |
| `console.*` in touched files | 0 in every file (nothing to flag) |

Under a full parallel run, three pre-existing suites each failed once on timing: `PlanUpgrade.render`, the plan section's "cannot be loaded" case and `BoostPurchasesList.render` (Hebrew). All three passed on re-run and alone. For the same reason, the new `PlanSection`-driven modal tests carry a 20 s timeout and open / close only once per test.

### Deviations and findings for SA

| # | What | Why |
|---|---|---|
| D-1 | **Focus return is done by `UpgradeModal`**: `onOpenAutoFocus` remembers the opener and `onCloseAutoFocus` focuses it. §5.5 assumed the Radix default | Radix returns focus only to a `Dialog.Trigger`, and it prevents its focus scope's own return. So a controlled dialog with no trigger left focus on `<body>`; the render test caught it. The fix is generic, so UM-2's "open from anywhere" inherits it. `dialog.tsx` is unchanged (C-8) |
| D-2 | **Section headings use `scope="rowgroup"` / `role="rowheader"`**, not `scope="colgroup"` (§5.3a, §9.4) | In HTML, a heading over a `<tbody>` of rows is a row-group header; `colgroup` would announce it as a column heading. Each heading row also has `aria-hidden` empty cells carrying the column tint, so the recommended and current tints run unbroken, as in the mockup (hidden on a phone) |
| D-3 | **Trial owners see Essentials "Recommended", not Autopilot** | UM-SA4 is binding: `nextPlanUp`, else the last plan. For a trial, the server's `nextPlanUp` is the lowest tier, so the rule picks it. §9.4's table, the requirement's table text (about line 330) and the mockup all expect Autopilot. Not changed in the UI (C-21 / UM-FR7: no client rule). **Needs a BA / SA ruling**: keep it, or add a server-side recommendation field. The tests assert the rule, not a plan name |
| D-4 | `ENDS_FREE_ACCESS_KEYS` (2 entries) repeated in `UpgradeModal.tsx` | The footer's free-access sentence needs `PlanPurchase`'s key map, but guard (a) forbids importing `PlanPurchase` (it pulls in the islands' module graph). A render test pins the modal's sentence against the dictionary value. UM-1b can move the map into `planPurchaseCopy.ts` when it touches the islands |
| D-5 | The `noExclusions` regex is now a third local copy, after `customerPlanView.noExclusions` and `planCopy.i18n` | Same precedent as `planCopy.i18n`; extracting it would mean editing two lib test files. Candidate for a shared test helper |
| D-6 | The ✓ circle uses `--v2-success` at 15 % with a `--v2-success-icon` tick (the mockup's green); the ✕ circle uses `--v2-border` with `--v2-text-secondary` | This follows the mockup's look, per the user brief. `--v2-success-bg` has no dark override, so it is not used. §5.3a said ✓ in `--v2-primary`. QA to confirm contrast on the computed tokens |
| D-7 | The band's text column reserves `pe-[25%]` (phone) / `pe-[22%]` (sm and up), so the title never sits on the gradient (Q-5) | On a 360 px phone the headline wraps to two lines (three in Hebrew). Acceptable; flagged for UM-3 copy / polish |

### Screenshots (static render, not the running app)

These were rendered from the real component in Jest (real payloads) and styled by the project's own `app/globals.css` + `app/v2/globals-v2.css`, compiled with the project's Tailwind. They were captured with headless Chrome; the phone shots sit in a 360 px iframe, so media queries see 360 px. Scratch folder: `um1a-shots/` in the session scratchpad. Set: desktop light (Essentials, trial), desktop dark, desktop Hebrew RTL, phone 360 px (Essentials, trial, Hebrew dark). QA still owes the running-app checks: computed tokens under the theme provider, the sticky header on iOS Safari and Android, VoiceOver / TalkBack, and W-10.

### QA Low items, fixed by Dev (2026-10-20)

| Item | Fixed by Dev |
|---|---|
| Rows showed through the gap above the sticky plan header when scrolled (12 px phone / 24 px desktop) | The scroll container's top padding is gone (`px-3 pb-3 sm:px-6 sm:pb-6`); the status strip carries the top spacing as `mt-3 sm:mt-6`, which scrolls away. So the sticky header sticks flush at the scroll top. Pinned by a render test (no `p-` / `pt-` / `py-` on the scroll container that holds the `thead`). Scrolled re-renders: `um1a-shots/8-desktop-1280-scrolled-dark.png`, `9-phone-360-scrolled-light.png` |
| `UpgradeModal.render` "Payment failed / 3-D Secure" never reached that state | Replaced by an `it.each` through the real `PlanSection`, using a `PlanPaymentState`-shaped failed billing row. It asserts the payload really is `payment_failed` / `action_required`, the drawer shows `plan-update-card-email` / `plan-confirm-payment`, and the open modal shows neither control and no link, with the state's own sentence in the status strip and no dead button |

Requirement Status line updated (UM-0 merged #480; UM-1a code-approved, QA passed). Runs: settings + components + settings page + guards **61 / 61 suites, 1,333 tests** (one more suite than before, from `origin/main`); eslint clean.
---

## SA Review Notes

**Reviewed by SA — 2026-10-19** (against `origin/main` `4583d21e`)
**Status:** APPROVED WITH CONDITIONS (W-1 to W-7 below). No business question for the user beyond the he / es copy approval the workplan already schedules.

### What was verified on `origin/main`

| Area | Finding |
|---|---|
| Extraction scope vs `planPrefetch.guard` pg8 | pg8 pins only `takePrefetched?.(` (once), the `firstStarted` effect, and that it is the `useEffect(` immediately before `}, [language]);`, all on `PlanSection.tsx`. Keeping the first read and the `[language]` effect in `PlanSection` and moving the `mounted` effect + bounded re-read into the hook keeps pg8 green unchanged. Neither remaining effect uses `mounted` (the `[language]` effect uses its own `cancelled`), so `mounted` can live wholly in the hook. `setLoading` stays in `PlanSection`; the hook only reads `loading`. **C-2 and C-3 are satisfied**: one flow owner, the modal gets `plan` as a prop and takes no read |
| §4.3 hook-order wording | Slightly inaccurate: today `firstStarted` / `firstRead` are declared *before* the `mounted` effect; after the move they follow the hook. Harmless (hook order need only be stable per build; effect order — `mounted` → re-read → first read → `[language]` — is unchanged). Correct the sentence when recording the checkpoint |
| C-5 / §10 | All 11 `getAllByRole('button')` / `queryByRole('button')` uses in `PlanPurchase.render` accounted for; line 214 is row-scoped (`row.queryByRole`) and unaffected. Other PlanSection-driven suites (`PlanUpgrade.render`, `PlanPaymentState.render`, both prefetch suites) query buttons by name only, so the new button cannot turn them red. Mapping is a narrowing, not a weakening, provided W-3 holds |
| C-6 | `PlanSection.tsx` imports no entitlements type today; the mirrored types use `PlanChoice` (`./PlanPurchase`) and `PlanPurchaseWire` (`lib/business-os/billing/planPurchaseTypes`). `planPayloadTypes.ts` stays clean. `CLIENT_FILES`' billing-value rule passes for `usePlanFlow.ts` (`checkoutProcessing` is under `components/`, not `lib/business-os/billing`) |
| C-7 | `tierLiteral.forbidden` scans `components/`; the allow-list includes `components/business-os/settings/__tests__`. Five new product files carry no tier id by design |
| C-8 | `cn` is plain concatenation, so `[&>button]:text-white` (`.x > button`, specificity 0,1,1) beats the X's `text-[var(--v2-text-muted…)]` (0,1,0); `hover:opacity-100` still wins over `[&>button]:opacity-90`. The X is the last direct child of `DialogPrimitive.Content`; band and footer are `div`s, so the selector hits only the X. `end-4` follows `dir`, so it flips in RTL |
| Guard (c) strings | `state === 'renewing'`, `setCompletedSession(`, `setUpgradeWatching(` occur only in `PlanSection.tsx` today; `PROCESSING_REFRESH_LIMIT` also in `components/business-os/billing/checkoutProcessing.ts` (its definition) — guard (c) must stay scoped to `components/business-os/settings/` as written |
| `availableToBuy` | Per-plan presentation switch (`planCommercialFlags`), present on every `PlanChoice` and on `nextPlanUp` — Q-1 rule is data-backed |
| i18n | `upgrade_modal.*` namespace matches the requirement (§ Dictionaries). 14 keys, no credit figure |
| Estimate | 2.75 d accepted (the +0.25 d over the slicing table buys the checkpoint and the layers test) |

### Rulings on Q-1 to Q-10

| # | Ruling |
|---|---|
| Q-1 | **Accepted**: "Coming soon" = `availableToBuy === false`, plus the server's `actionUnavailableBecause` on the `nextPlanUp` card. "Not offered to you" is not "coming soon"; `PlanPurchase`'s rule is a buy-control rule and does not transfer to a view-only card |
| Q-2 | **Accepted** with W-1: positional "top plan" is the same server-order reliance UM-SA4 already accepted. The third headline `compare` is right — the requirement's "top plan when nothing is offered" would be false for an open-ended Founding Partner or when the switches are off |
| Q-3 | **Accepted**: hidden while `processing` (the hook's value, no new predicate; this also covers the "slow" `exhausted` state); shown whenever `plans` is non-empty, including `purchase: null` and switches off |
| Q-4 | **Accepted, within C-8**: a child-selector restyle of the built-in X is not a duplicate and leaves `dialog.tsx` untouched. The English sr-only "Close" in he / es is a known gap: record it as a UM-3 (a11y) item in the requirement; do not change `dialog.tsx` in this slice |
| Q-5 | **Accepted**: all band text on solid `--v2-primary-dark`; gradient only as the `aria-hidden` decorative layer. Stricter than C-9 requires, and robust to theme-provider token overrides |
| Q-6 | **Accepted** as interim copy, removed or reworded by UM-1b. Note `view_only_note` and `back_to_plan` in the requirement's UM-1b scope so they are not orphaned |
| Q-7 | **Confirmed**: UM-2's standalone modal owns its `plan` / `loading` / `failed` state and its single on-open `readMyPlan()` (UM-SA8), and calls the same `usePlanFlow`. The hook's signature already allows that; no change now |
| Q-8 | CSS `order` is fine for UM-1a (no focusable control in a card). **UM-1b entry criterion**: once cards hold buttons, visual and focus order must agree (DOM reorder in `upgradeModalView`, or drop `order-first`). Record in the requirement's UM-1b row |
| Q-9 | **Accepted** with W-4 (make the index dependency explicit) |
| Q-10 | **Accepted: defer C-13 to UM-1b.** UM-1a touches no island; C-13 lands when the islands are restyled for the modal. Record the deferral in the requirement |

### Conditions

1. **W-1** `somethingOffered` (drives the `choose` headline, the ribbon and `view_only_note`) excludes the current tier's own `planId`. An admin-assigned tier whose own plan is offered (plan-payments Q-5) must read `top_plan` / `compare`, not "Choose the plan that fits your business". Add that case to `upgradeModalView.test.ts`.
2. **W-2** Replace the §9.2 C-3 test "after a bounded re-read updates `plan`, the open modal shows the new value": in UM-1a it is unreachable (the button is hidden while `processing`, and the overlay blocks the islands). Prove shared state instead with a plan change while the modal is open via a `[language]` re-read (or a rerender with a new payload), plus the unchanged `fetch` count on open.
3. **W-3** `moneyButtons()` excludes by the exact test id `plan-compare-open` only (no name or regex filter), and each mapped absence test also asserts `plan-compare-open` is present (as §10 proposes). If a payload there has no `plans`, keep the original assertion and record it in §10 — never drop the strengthening silently.
4. **W-4** Add one assertion (in `UpgradeModal.render` or `PlanPurchase.render`) that `plan-compare-open` is the **last** button in the section, so the `getAllByRole('button')[0]` dependency at lines 381 / 404 / 514 fails loudly rather than clicking the wrong control.
5. **W-5** "Compare plans" drawer button (§5.5): its label sits on **solid** `--v2-primary-dark`; any gradient on it is an `aria-hidden` layer not behind the text (same reading as Q-5). Guard (f) covers this element too.
6. **W-6** Checkpoint 2a is recorded in this workplan (command output summary, suite count) before Task 3, with the corrected §4.3 hook-order sentence; if any listed suite needs a test edit, stop and return to SA.
7. **W-7** Record in the main requirement: UM-1a workplan approval, Q-4 (UM-3 sr label), Q-6 / Q-8 (UM-1b items), Q-10 (C-13 deferred).

### Optimisation Suggestions
- Radix will put initial focus on "Back to your plan" (first tabbable; the X renders after children). Acceptable; if it reads oddly in QA, focus the title container via `onOpenAutoFocus` — no `dialog.tsx` change.
- Keep the `PlanUpgrade` → `PlanUpgradeView` rename confined to the type file and `PlanSection`; no other importer exists today.

### Approval
[x] Workplan approved with conditions W-1 to W-7 — proceed to implementation

### SA Re-review (UM-D1 / UM-D2 revision)

**Reviewed by SA — 2026-10-19** (against `origin/main` `4583d21e` and the UM-0 workplan as approved, S-1 to S-7)
**Status:** APPROVED WITH CONDITIONS (W-1 to W-7 as restated, plus W-8 to W-11). Tasks 3–9 start only after UM-0 merges (Task 2b, C-15).

**Verified:** §5.2a consumes UM-0 §5 field by field, `sections` by identity (C-21); `action` gives an admin-assigned tier `'offered'` before `'current_label'` (C-22); "Current plan" is a `<span>` with no role / `tabIndex` (C-22); no new client import from the module (C-6); the tripwire is UM-0's (C-27); the §10 mapping is unaffected because the modal is unmounted while closed. Estimate 3.25 d accepted.

**Rulings on Q-11 to Q-14**

| # | Ruling |
|---|---|
| Q-11 | **Accepted**: empty slot + the existing `view_only_note`; no new copy (C-1). UM-1b fills the slot |
| Q-12 | **Confirmed.** Note: `somethingOffered` still excludes the own plan (W-1), so this account sees no `view_only_note`; that is correct, it has nothing to choose here |
| Q-13 | **Accepted: optional.** It is wire compatibility, not a fallback: `available = false` hides the button, and the UI never builds a table itself |
| Q-14 | **Accepted with W-8** (sticky behaves differently once rows are grids) |

**W-conditions:** W-1, W-2, W-3, W-4, W-5, W-6 **stand unchanged** (W-6 also covers the Task 2b re-run after the rebase). W-7 **stands, extended**: also record Q-11 to Q-14 and the UM-0 dependency in the requirement. Q-8 is moot as Dev states.

**New conditions**

8. **W-8** Phone re-flow: below 640 px set `table`, `thead`, `tbody`, `tfoot` to `max-sm:block` as well as `tr` to grid (a grid `tr` inside table-display parents gets wrapped in anonymous table boxes). A sticky `th` inside a grid `tr` cannot move outside that row, so on a phone the sticky element must be `thead`; at `sm+` keep it on the header cells. Render test asserts both class sets; QA confirms on iOS Safari and Android at 360 px.
9. **W-9** Guard (g) matches config row labels as **quoted string literals** in the three client files, not as substrings, so a short label ("CRM", "Emails") cannot false-positive on an identifier or comment.
10. **W-10** Rewrite the QA Testing Report's owed list for the table: "stacked, recommended first" is superseded; add sticky header at 360 px, no horizontal scroll, VoiceOver / TalkBack reading of rowheaders and cell sr text, an Essentials and a trial account.
11. **W-11** C-26: BA's update of the card-era ACs to the table must be in the requirement before UM-1a's code review; SA code review checks the diff against the updated ACs.

**For the user (not decided by SA):** the he / es drafts of the 17 `upgrade_modal.*` keys. Technical constraint: no value may contain a figure or match the `noExclusions` phrasing ("not included in your …"); "Not included" alone is fine.

---

**Code Review by SA — 2026-10-19** (worktree `neuronforge-upgrade-modal-um1a`, uncommitted diff on UM-0 tip `5243d900`)
**Status:** 🔄 Fix Required (F-1 to F-3). The rest of the slice is approved; no re-review of untouched parts needed, only of F-1 to F-3.

### What was verified

| Check | Result |
|---|---|
| C-2 `usePlanFlow` pure move | Every line removed from `PlanSection.tsx` reappears verbatim in `usePlanFlow.ts` / `planText.tsx` / `planPayloadTypes.ts`; the only differences are `export` keywords, the `PlanUpgrade` → `PlanUpgradeView` rename and the `PlanChoice` import moving to the types file. Checkpoint 2a (zero test diff) is recorded. Guard (c) pins the predicates to `usePlanFlow.ts` |
| C-3 | `UpgradeModal` is rendered by `PlanSection` (inside `SheetContent`), takes `plan` as a prop, no read (guard (b)) |
| C-6 | No import from `lib/business-os/entitlements/` in any of the five new files or `PlanSection.tsx`; `enforcementPoints` green |
| C-7 | No tier literal in product code; `tierLiteral.forbidden` green unchanged |
| C-8 | `components/ui/dialog.tsx` (and `page.tsx`) identical to `origin/main`; flex variant, single `sm:max-w-4xl`, X restyled by child selector |
| C-9 (band) | All band / ribbon / drawer-button text on solid `--v2-primary-dark`; gradients `aria-hidden`, mirrored in RTL (W-5 met). **But see F-2 for text on the body in dark mode** |
| C-21 | `sections` by identity (`toBe` test); no sort / filter / reverse (guard (h)); W-9 quoted-literal guard (g) present |
| C-22 | "Current plan" is a `<span>`, no role / tabIndex / aria-disabled; admin-assigned tier gets `'offered'` first |
| C-24 / W-8 | `table` / `thead` / `tbody` / `tfoot` `max-sm:block`, rows `max-sm:grid max-sm:grid-cols-2`, sticky `thead` below `sm`, sticky header cells from `sm`; `PHONE_ROW` names the C-27 tripwire. 360 px screenshots show no horizontal scroll |
| W-3 / W-4 | `moneyButtons()` excludes by exact test id only; every mapped absence test also asserts `plan-compare-open` present; last-button pin added with non-vacuity |
| §10 mapping | `PlanPurchase.render` 228, 236, 246, 300, 310, 318, 409 and `PlanSection.render` 233, 254: each `queryByRole('button')` absence became "no button other than the exact id" plus "that button is present". This is a narrowing, not a weakening. No assertion deleted |
| Copy | 17 `upgrade_modal.*` keys in en, he and es; no figure; `dictionariesStayInStep` green |
| Logging | 0 `console.*` in every touched / new file; `usePlanFlow` keeps `module: 'BusinessOsPlanSection'` |
| Runs (SA, in the worktree) | `components/business-os/settings/__tests__` + `app/business-os/settings/__tests__` + `tierLiteral.forbidden` + `creditFigures.fromConfig.guard` + `enforcementPoints` + `dictionariesStayInStep`: **43 / 43 suites, 926 / 926 tests** |
| Merge with `origin/main` | `5243d900` is an ancestor of `origin/main` (`a9551d9c`), and `git diff 5243d900 origin/main` on every touched path (settings components, translations, the credit-figures guard, `dialog.tsx`) is **empty**. A merge of `origin/main` should be clean. Re-run the suites after it (W-6) |

### Ruling on D-3: UM-SA4 / C-10 amended (user decision UM-BQ4)

The user decided UM-BQ4 on 2026-10-18: **Recommended = Autopilot** for trial and Essentials owners. The approved mockup shows the same. UM-SA4's `nextPlanUp` first rule contradicts that for a trial owner, because a trial's `nextPlanUp` is the lowest tier. The SA rule was wrong, not the business decision. Dev was right not to patch it on their own.

**Amended UM-SA4 (replaces "nextPlanUp, else the last plan", and the C-10 ribbon half):**

> **Recommended** = the **last** entry of `plans` (server order, ascending) whose `planId` is in the offered set (`offer.tiers` when `offer.kind === 'choose'`, ∪ `upgrade.tiers`) **and** is not the current tier's `planId`. If there is no such entry, there is no ribbon. `nextPlanUp` no longer takes part in the ribbon. It still drives the drawer's B9 and the `unavailableBecause` sentence (SA Q-1). No tier literal (C-7).

What this gives:

| Account | Ribbon |
|---|---|
| Trial | Autopilot (both offered) |
| Essentials | Autopilot (upgrade offered). Same as before |
| Autopilot | None (nothing offered) |
| Founding Partner, end date set | Autopilot |
| Founding Partner, no end date / switches off / `purchase: null` | None |
| Admin-assigned tier, own plan offered | The highest offered plan other than its own |
| Top plan not offered, lower one offered | The lower one (the highest one that is offered) |

The locked-action case ("the plan that unlocks it") is UM-2's context-driven rule (C-4). It is not this rule, and this rule does not pre-empt it.

### Code Review Comments

1. **F-1** `components/business-os/settings/upgradeModalView.ts:91-93` — replace `candidate = nextPlanUp?.planId ?? lastPlanId` with the amended UM-SA4 above: walk `plans` from the end and take the first one that is offered and not current. Update the header comment (lines 15-17) and the `isRecommended` doc on `PlanColumnView`. **Tests:** in `upgradeModalView.test.ts`, delete `ruleRecommended`. It restates the implementation, so the test can never fail. Assert by the fixture constants instead: Trial → `column(payload, TOP).isRecommended === true` and `LOWER` false; Founding Partner with an end date → `TOP`. Add two cases: (a) a copied trial payload with `TOP` removed from `offer.tiers` → `LOWER` recommended; (b) a payload where `nextPlanUp` names `LOWER` but `TOP` is offered → `TOP` (this pins that `nextPlanUp` no longer decides). In `UpgradeModal.render.test.tsx` Trial and Founding Partner end-date cases, assert the ribbon sits inside `columnHeader(TOP)`, not only "one ribbon somewhere". Re-render screenshot 4 / 6 (trial). — Priority: **High** (contradicts a user decision)
2. **F-2** `UpgradeModal.tsx:141` (status-strip plan name) and `:353` (highlighted cell value) — `text-[var(--v2-primary-dark)]` on `--v2-surface` in dark mode is #4F46E5 on #1E293B ≈ **2.3:1**, below AA 4.5:1 for `text-sm`. `--v2-primary-dark` has no `.dark` override, and screenshot 2 shows the faint "Essentials". Fix: use `--v2-text-primary` + `font-semibold` for both, so the highlight is carried by weight, which works in both modes, or use a token with a dark override. Do not add a `dark:` class (guard). Light mode (6.3:1) is fine. Add a guard or render assertion that `--v2-primary-dark` text appears only inside the band / ribbon. — Priority: **Medium** (C-9 / AC-UM12)
3. **F-3** W-11 / W-7 not met. The requirement's ACs are still card-era. AC-UM11 says "cards stack with the recommended one first". AC-UMD1 says "a **disabled** 'Current plan'", which contradicts C-22. The status line still reads "UM-1a workplan to be revised". BA must update the ACs to the table, record UM-BQ4 → amended UM-SA4 (line ~130 "the existing rule picks") and record Q-11 to Q-14 and D-1 to D-7 **before the PR opens**. This is a docs gate (TL to route to BA), not a Dev code item. — Priority: **Medium**

### Deviations D-1 to D-7

| # | Ruling |
|---|---|
| D-1 | **Accepted.** The opener captured in `onOpenAutoFocus` and focused in `onCloseAutoFocus` is generic, and `dialog.tsx` is untouched |
| D-2 | **Accepted.** `scope="rowgroup"` is the correct header for a `<tbody>`; §5.3a / §9.4 "colgroup" are corrected by this ruling |
| D-3 | **Ruled above** (F-1) |
| D-4 | **Accepted** for UM-1a. UM-1b moves `ENDS_FREE_ACCESS_KEYS` into `planPurchaseCopy.ts`. Record it in the UM-1b row |
| D-5 | **Accepted.** Shared `noExclusions` test helper is a backlog item, not this slice |
| D-6 | **Accepted** (mockup look). The tick (#059669) on the 15 % success tint stays above 3:1 graphics contrast on both surfaces |
| D-7 | **Accepted**; the headline wraps on a phone. A UM-3 polish item |

### Optimisation Suggestions
- `UpgradeModal.tsx:279`: cells are matched to columns by index. That is correct under UM-0's contract, but a `columns.find(c => c.planId === cell.planId)` lookup would make a future order drift show as a missing tint, not as a wrong plan name in the screen-reader text. Low.
- `UpgradeModal.tsx:187`: `captionId` is a fixed string. Use `useId()` in case UM-2 ever mounts two instances. Low.
- `--v2-text-muted` (#9CA3AF) small text (price suffix, footer, section headings) is about 2.5:1 on white. This is the platform-wide token used across the drawer, so it is not a UM-1a blocker. Raise it in UM-3's a11y pass.
- Phone, trial: the sticky footer holds four sentences (about 190 px of a 800 px viewport, screenshot 6). Acceptable for view-only. UM-1b replaces `view_only_note`; consider folding the B7 sentence into the status strip in UM-3.

### Notes for QA
- After F-1: a trial owner sees **Autopilot** "Recommended"; Essentials owner unchanged; Autopilot owner none.
- After F-2: dark mode, the status-strip plan name and highlighted values read clearly.
- Still owed (W-10): sticky header at 360 px on iOS Safari + Android; no horizontal scroll; VoiceOver / TalkBack read rowheaders and "{plan}: Included / Not included"; computed `--v2-primary-dark` under the theme provider (light + dark); focus returns to "Compare plans" on Escape / X / "Back to your plan"; Escape closes the modal only, not the drawer; Choose / Upgrade in the drawer behave exactly as before (sandbox).

### Code Approved for QA: Yes, conditionally. QA may run in parallel, but the user diff and RM wait for F-1 and F-2 (SA re-check of those two only) and F-3 (BA).

### Dev response to F-1 to F-3 (2026-10-20)

| # | Status | Fixed by Dev |
|---|---|---|
| F-1 | ✅ Fixed | `upgradeModalView.ts`: Recommended = walk `plans` from the end, the first id that is offered (`offer.tiers` when `choose`, plus `upgrade.tiers`) and not the current tier; none otherwise. `nextPlanUp` no longer picks it (it still feeds B9 and `unavailableBecause`). Header comment and `isRecommended` doc updated. Tests: `ruleRecommended` deleted; Trial and Founding Partner (end date) assert `TOP` true / `LOWER` false; new "TOP not offered → LOWER" and "nextPlanUp = LOWER while TOP offered → TOP"; the render tests check the ribbon inside `columnHeader(TOP)`. Screenshots 4 / 6 re-rendered: trial shows Autopilot recommended |
| F-2 | ✅ Fixed | Status-strip plan name and highlighted values now use `--v2-text-primary` + `font-semibold` (non-highlighted values are `font-normal` in `--v2-text-secondary`), with no `dark:` class. New render assertion: `--v2-primary-dark` text only inside the band. Dark screenshots 2 / 7 re-rendered |
| F-3 | ✅ Done (Dev, at TL's request) | Requirement: AC-UM11 superseded by the 360 px table wording, AC-UMD1 "disabled Current plan" replaced by the C-22 non-button label, §4.0 "Recommended" / "Current plan" / "Quantity rows" rows aligned, C-10 marked amended per UM-BQ4, status line updated, two Change History rows |

**he / es wording: APPROVED by the user 2026-10-20.** `plans_label` השוואה בין התוכניות / Comparación de planes; `current_plan` התוכנית הנוכחית / Plan actual; `included` כלול / Incluido; `not_included` לא כלול / No incluido (the other 13 keys as drafted in §6).

**Task 2b:** `origin/main` (with UM-0 #480 merged) taken in by **fast-forward** to `f87eccda`. No merge commit, no overlap with the uncommitted files; checkpoint suites re-run green (see the Change History row).

**SA re-check of F-1 to F-3 — 2026-10-20** (worktree at `f87eccda` + uncommitted diff)
**Status:** ✅ Code Approved

| # | Verified |
|---|---|
| F-1 | `upgradeModalView.ts` implements the amended UM-SA4. It walks `plans` from the end and takes the first plan that is offered and not current. No literal; `nextPlanUp` is not consulted. `ruleRecommended` is gone. The tests assert `TOP` / `LOWER` by fixture constant, and the two new cases are present ("TOP not offered → LOWER"; "nextPlanUp = LOWER, TOP offered → TOP"). The render tests (Trial, Founding Partner with an end date, Essentials) check the ribbon inside `columnHeader(TOP)` |
| F-2 | The status-strip name and highlighted values use `--v2-text-primary` + `font-semibold`, and no `dark:` class was added. The only remaining `--v2-primary-dark` uses are the band and the ribbon background. The new render assertion pins that. Re-rendered dark screenshot 2 reads clearly |
| F-3 | Requirement: AC-UM11 superseded by the 360 px table wording; AC-UMD1 now says a non-interactive "Current plan" (C-22); §4.0 "Recommended" and C-10 (item 10) record the UM-BQ4 amendment; status line updated. Nit, not blocking: the status line still ends "UM-1a workplan to be revised by Dev" in the older UM-D1 clause. BA / TL may trim it with the merge record |
| Runs (SA) | Settings + settings-page suites + `tierLiteral.forbidden` + `creditFigures.fromConfig.guard` + `enforcementPoints` + `dictionariesStayInStep`: **43 / 43 suites, 929 / 929 tests** |

### Code Approved for QA: Yes. The user diff and RM may proceed after QA (the W-10 manual checks remain QA's).

---

## QA Testing Report

**QA — 2026-10-20** (worktree `neuronforge-upgrade-modal-um1a`, `origin/main` `f87eccda` + the uncommitted UM-1a diff, after F-1 / F-2)
**Test mode:** full
**Strategy used:** A + B (Jest render / unit / source guards on real `buildCustomerPlanView` + `readPlanPurchaseView` payloads), plus a headless Chrome render check of the static harness (Option D, partial). No sign-in, no running app
**Focus:** ui, schema (payload pass-through), security (no money control in the modal)
**Skipped:** signed-in click-through, real devices, screen readers (owed, below)
**Input source:** prompt keywords (TL brief) + §9.4 / W-10

### Runs

| Run | Result |
|---|---|
| `components/business-os/settings/__tests__` + `components/business-os/__tests__` + `app/business-os/settings/__tests__` (incl. `planPrefetch.guard`, `accountCard.guard`, `settingsDeepLinks.guard`) + `tierLiteral.forbidden` + `creditFigures.fromConfig.guard` + `enforcementPoints` + `dictionariesStayInStep` | **60 / 60 suites, 1,320 / 1,320 tests** before QA's file; **61 / 61, 1,331 / 1,331** with it. No timeouts, no re-run needed |
| `npm run test:bos-entitlements` | **301 / 301 suites, 9,127 / 9,127 tests** |
| `npm run lint:hooks` | Clean (exit 0) |
| `npx eslint` on QA's new test file | Clean |

**Added by QA (test only, no product change):** `components/business-os/settings/__tests__/UpgradeModal.qa.render.test.tsx`, 11 tests (incl. the fixture self-check): Essentials cancelling, paused subscription, payment failed (B3 stays in the drawer, never in the modal), unreadable plan and `status !== 'ok'` (no "Compare plans"), keyboard (Enter opens, Tab cycles only "Back to your plan" and X, Escape returns focus), money unchanged after open / close (the drawer's "Upgrade to …" still POSTs the preview; trial "Choose …" still POSTs `{ tier, returnTo: 'settings_plan' }`), he / es cell sr text "{plan}: {state}".

### Per state (§2.2)

| State | Your plan column | Recommended | Status strip | "Current plan" | Buttons in modal | Evidence |
|---|---|---|---|---|---|---|
| Essentials, renewing | Essentials | Autopilot | "You're on Essentials · $79 … · Renews on …" | Label ×2 (span) | X + Back only | `UpgradeModal.render`; screenshot 1 |
| Essentials, cancelling | Essentials | Autopilot only if the server offers the upgrade | Ending sentence from the record | Label ×2 | X + Back only | QA test |
| Autopilot | Autopilot | **None** | As sent | Label ×2 | X + Back only; headline "You're on our top plan" | `UpgradeModal.render` |
| Trial | None | **Autopilot** (F-1, UM-BQ4) | Test Flight · Free · trial end | None | X + Back only; footer trial sentence + view-only note | `UpgradeModal.render`, `upgradeModalView.test`; screenshot 4 |
| Founding Partner, no end date | None | None | As sent | None | X + Back only; headline "Compare our plans" | `UpgradeModal.render` |
| Founding Partner, end date | None | Autopilot | As sent | None | X + Back only; free-access sentence | `UpgradeModal.render` |
| Held invitee | n/a: never reaches Settings (page gate; `planPurchaseView` header) | — | — | — | — | Code read |
| Payment failed (`past_due` with notice) | Essentials | — | "Your payment on … didn't go through" | — | No B3 / no confirm link in the modal; B3 still in the drawer | QA test |
| Paused | Renders the server table | — | — | — | X + Back only | QA test |
| Unreadable plan / `status !== 'ok'` / no `comparison` | No "Compare plans" button | — | — | — | — | QA test; `UpgradeModal.render` |

**C-1 (view only):** in every state the only buttons inside `plan-compare-modal` are the X and "Back to your plan". After the modal is opened and closed, the drawer's Choose / Upgrade still POST exactly as before.

### Interaction

| Check | Result |
|---|---|
| Open / close (Escape, X, Back); focus back on "Compare plans" | ✅ (`UpgradeModal.render` ×3, QA keyboard test) |
| Escape / backdrop close only the modal, not the drawer; a press inside closes neither | ✅ (`UpgradeModal.layers`) |
| Keyboard order | ✅ in jsdom: initial focus inside the modal; Tab cycles Back → X only (trapped). "Current plan" labels are not tabbable |
| Screen-reader names | ✅ table named "Plan comparison"; one `columnheader` per plan; a `rowheader` per row; section headers `scope="rowgroup"` (D-2); every cell's sr text is "{plan}: Included / Not included / {value}" in en, he and es |
| he RTL | ✅ `dir="rtl"`, gradient `to-l`, Hebrew copy, `$79` digits; headless Chrome confirms the scope column on the right and Essentials to the right of Autopilot |
| es | ✅ no English `upgrade_modal.*` value left; Spanish cell sr text |

### Render check (headless Chrome, static harness; QA copy in `scratchpad/qa-um1a/`)

| Width | Result |
|---|---|
| 360 px (iframe, so media queries see 360): en light, trial light, he dark | ✅ `scrollWidth === clientWidth` (360 / 360; scroll body 350 / 350), **no element outside the viewport**, rows `display: grid`, two columns at 13 px / 176 px. The sticky `thead` holds after a 400 px scroll |
| 1280 px: en light / dark, he dark | ✅ modal 896 px, no overflow; header cells `position: sticky` and hold after a scroll; band `rgb(79, 70, 229)` (`--v2-primary-dark`, static tokens) |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None.

#### Edge Cases (nice to fix)
1. **Rows show through above the sticky header.** Severity: Low. File: `components/business-os/settings/UpgradeModal.tsx` (scroll body `p-3 sm:p-6` + `top-0`). `top-0` sticks at the scroll body's content edge, so the padding strip above the sticky header (12 px on a phone, 24 px on desktop) shows rows scrolling under it. Headless Chrome: header top 149 px vs body top 137 px at 360 px, 163 vs 139 at 1280 px (`scratchpad/qa-um1a/qa-1280-scrolled-dark.png`: "AI-built website" and its ticks are visible above the header). Expected: nothing visible above the sticky header. Polish for UM-1b / UM-3.
2. **Dev's "Payment failed / 3-D Secure" render test is vacuous.** Severity: Low (test). File: `__tests__/UpgradeModal.render.test.tsx` line 155. `payingRow(LOWER, { subscriptionStatus: 'past_due' })` gives `billing: null` (no notice fields), so the absence assertions can never fail. QA's test covers `payment_failed` with the `PlanPaymentState` fixture. `action_required` (3-D Secure) is still not driven through the modal.
3. Already recorded, not raised again: English sr-only "Close" in he / es (Q-4, UM-3); `--v2-text-muted` small text ≈ 2.5:1 (UM-3).

### Manual checks owed (not attempted, no sign-in)
- [ ] Signed-in click-through in the running app: Settings → Your plan → "Compare plans", with an Essentials and a trial account; the drawer's Choose / Upgrade unchanged (sandbox)
- [ ] Computed `--v2-primary-dark` under the theme provider (custom tokens), light and dark (C-9, R-5)
- [ ] Real iOS Safari + Android Chrome at 360 px: sticky header (R-13), no horizontal scroll
- [ ] VoiceOver + TalkBack: rowheaders and "{plan}: Included / Not included" read correctly in the grid re-flow (R-12)
- [ ] Real Chrome keyboard: whether the scroll body becomes a tab stop (keyboard-focusable scrollers) and how it is announced

### Final Status
- [x] Every UM-1a acceptance criterion that can be automated passes; no Bug. **PASS WITH NOTES**: two Low edge cases and the manual checks above are still owed
- [ ] Issues found — Dev must address before commit

---

## Commit Info

| Field | Value |
|---|---|
| Branch | `feature/bos-upgrade-modal-um1a` |
| Commits | `5d4e2ffa` feat(business-os): plan comparison modal, view only (UM-1a); `a1d46c5a` docs(business-os): UM-1a workplan, SA / QA records and requirement update; `05b50656` merge of `origin/main` (`0c27b576`, clean, no overlap); this Commit Info follow-up |
| Refactor commit | Not split out: `PlanSection.tsx` and `planPayloadTypes.ts` carry both the `usePlanFlow` move and the modal wiring / comparison types |
| Runs after the merge | Settings + components + settings page + guards 61 / 61 suites, 1,333 tests; `test:bos-entitlements` 301 / 301, 9,131 |
| PR | [#483](https://github.com/AgentsPilot/neuronforge/pull/483) to `main` (merge commit) |
| Committed by | RM, 2026-10-20 |

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-19 | Created | Dev workplan for UM-1a from `origin/main` `4583d21e`: `usePlanFlow` pure-move plan with checkpoint, view-only modal design, 14 copy keys (he / es drafts), test plan and guards, C-5 assertion mapping, 10 SA questions. Status: Planning |
| 2026-10-19 | SA workplan review: APPROVED WITH CONDITIONS | Verified pg8 scope, C-2/C-3/C-5/C-6/C-7/C-8 on `origin/main` `4583d21e`; Q-1 to Q-10 ruled (all Dev proposals accepted; Q-8 and Q-6 become UM-1b items, Q-4 sr label a UM-3 item, C-13 deferred to UM-1b); conditions W-1 to W-7 (offered set excludes current plan, reachable C-3 test, exact-id `moneyButtons`, last-button pin, solid label on the drawer button, recorded checkpoint, requirement update) |
| 2026-10-19 | Revised for UM-D1 / UM-D2 (SA re-review "workplan impact") | Cards replaced by a comparison table rendering UM-0's `comparison` (new §5.2a view model with per-column action slot, §5.3a table + phone M-A with sticky header and explicit ARIA roles, C-24); §6 drops `everything_in_plus`, `plans_label` becomes the caption, adds `current_plan` / `included` / `not_included` / `cell_label` (17 keys, he / es drafts); §7 mirrored `comparison` types in `planPayloadTypes.ts` (C-6); §9.4 table tests and guards (C-21, C-22, C-23, admin-assigned tier, no current column for trial / Founding Partner); §10 and W-3 / W-4 re-checked against the non-button "Current plan" label; dependency on UM-0 merging first (C-15, Task 2b); R-6 / Q-8 moot, R-12–R-14, Q-11–Q-14 added; estimate ≈ 3.25 d. Tasks 0–2a unchanged. Superseded text kept and marked. Status: awaiting SA re-review |
| 2026-10-19 | SA re-review (UM-D1 / UM-D2): APPROVED WITH CONDITIONS | Q-11 (empty slot), Q-12, Q-13 (optional `comparison`) accepted; Q-14 accepted with W-8. W-1 to W-6 stand; W-7 extended (Q-11 to Q-14, UM-0 dependency). New W-8 (phone: table sections block, sticky on `thead` below 640 px), W-9 (guard (g) matches quoted literals), W-10 (QA owed list for the table), W-11 (C-26 ACs before code review). Tasks 3–9 after UM-0 merges |
| 2026-10-19 | Implemented (Dev), uncommitted | Tasks 0–8 done, 9 screenshots done; checkpoint 2a recorded (pure move, no test edit). 60 / 60 suites (1,317 tests) + `test:bos-entitlements` 300 / 300 (9,076) green, `lint:hooks` clean. Deviations D-1 to D-7 for SA (D-3 needs a BA / SA ruling). Requirement MD update (W-7 / W-11) still owed. Status: Code Complete |
| 2026-10-19 | SA code review: FIX REQUIRED (F-1 to F-3) | Verified C-2 pure move (line-level), C-3, C-6, C-7, C-8, C-21, C-22, C-24 / W-8, W-3 / W-4, §10 narrowing (no weakening), 17 keys, 0 `console.*`; SA run 43 / 43 suites, 926 tests; no drift on touched paths since `5243d900`, so the `origin/main` merge should be clean. **D-3: UM-SA4 / C-10 amended per user decision UM-BQ4**: Recommended = the last `plans` entry that is offered and not current (`nextPlanUp` no longer decides the ribbon). F-1: implement it, and replace the tautological `ruleRecommended` test with fixture-constant assertions plus two new cases. F-2: dark-mode contrast of `--v2-primary-dark` body text (≈ 2.3:1). F-3: requirement ACs / UM-BQ4 amendment by BA before the PR. D-1, D-2, D-4 to D-7 accepted |
| 2026-10-20 | F-1 / F-2 fixed, F-3 docs done, he / es approved | Recommended per amended UM-SA4 (UM-BQ4); dark-mode text off `--v2-primary-dark`; requirement ACs updated; fast-forwarded to `origin/main` `f87eccda` (UM-0 merged). Runs: settings + components + guards 60 / 60 suites, 1,320 tests; `test:bos-entitlements` 301 / 301, 9,127; `lint:hooks` and tsc clean. Awaiting SA re-check of F-1 / F-2 |
| 2026-10-20 | SA re-check: CODE APPROVED | F-1 (amended UM-SA4 rule + fixture-constant tests + ribbon in `columnHeader(TOP)`), F-2 (no `--v2-primary-dark` body text; render pin) and F-3 (AC-UM11, AC-UMD1, §4.0, C-10 amended) verified; SA run 43 / 43 suites, 929 tests. Non-blocking nit: stale "to be revised by Dev" clause in the requirement status line |
| 2026-10-20 | QA: PASS WITH NOTES | 61 / 61 suites, 1,331 tests (incl. QA's new `UpgradeModal.qa.render.test.tsx`, 11 tests); `test:bos-entitlements` 301 / 301, 9,127; `lint:hooks` clean. Headless Chrome: no horizontal scroll at 360 px, sticky header holds. No Bug. Low edge cases: rows visible in the padding strip above the sticky header; vacuous payment-failed render test. Manual checks owed: signed-in click-through, theme-provider tokens, iOS / Android, VoiceOver / TalkBack |
| 2026-10-20 | Committed (RM), PR #483 opened | Commits `5d4e2ffa` (feat) + `a1d46c5a` (docs), `origin/main` merged clean (`05b50656`); 61 / 61 suites (1,333) + `test:bos-entitlements` 301 / 301 (9,131) green after the merge |
