# Workplan: Business OS Upgrade Modal, UM-2 "Open the modal from anywhere"

> **Last Updated**: 2026-10-20

**Developer:** Dev
**Requirement:** [BUSINESS_OS_UPGRADE_MODAL_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_UPGRADE_MODAL_REQUIREMENT.md) (§5 entry points; UM-FR8, UM-FR9; UM-SA1, UM-SA2, UM-SA5, UM-SA8, UM-SA10, UM-SA11; C-4, C-6, C-7, C-12, C-14; AC-UM5, AC-UM9)
**Previous slice:** [UM-1b workplan](/docs/workplans/BUSINESS_OS_UPGRADE_MODAL_UM1B_WORKPLAN.md) (built, uncommitted, under SA code review and QA on 2026-10-20). UM-1a merged (#483), UM-0 merged (#480)
**Date:** 2026-10-20
**Status:** Code Complete (uncommitted; awaiting SA code review, then QA)
**Branch:** `feature/bos-upgrade-modal-um2`, created by RM from UM-1b's committed tip `2bde7a81` (pushed as `origin/feature/bos-upgrade-modal-um1b`, no PR yet), worktree `neuronforge-upgrade-modal-um2`. Never `git stash`, never switch branches inside the UM-1b worktree, never delete a worktree's `node_modules` junction
**Path:** **Not** the short path, no fast-track (C-14, UM-SA11): SA code review, then QA, then the user sees the diff, then RM. Go-live row 20 part (c) ("the upgrade modal opened on its own from another Business OS page") is this slice's **merge gate** (UM-1b §15, W-7). It is checked in the user's end-of-stream run (UM-1b UD-1)

## Overview

UM-2 lets any Business OS page open the plan comparison window with one call, `useUpgradeModal().openUpgradeModal(context)`, through a provider in the Business OS layout. The caller passes only a context: `{ kind: 'settings' }`, `{ kind: 'locked_feature'; planId }` or `{ kind: 'founding_partner' }`. The window reads the plan itself, once per open (`readMyPlan()`), runs its own `usePlanFlow` instance, and shows "Upgrading…" and "You're on {plan}" in its own body. A checkout still returns to Settings → Plan (UM-SA10). Two context variants are added. **`locked_feature`** gets a lock header "This needs {plan}" and highlights that plan's column. This overrides the Recommended rule, for this context only. **`founding_partner`** gets "Keep everything you have", and only when the server offers a plan and says buying ends free access (UM-FR9, BQ-P10). No production screen calls the contract yet, so the demo is a test-only surface (§7, SA Q-1) plus render tests. No route, payload, migration or entitlements import changes.

---

## Table of Contents

1. [Scope and binding conditions](#1-scope-and-binding-conditions)
2. [Analysis summary](#2-analysis-summary)
3. [Implementation approach](#3-implementation-approach)
4. [The open contract and the provider](#4-the-open-contract-and-the-provider)
5. [The standalone window: read, flow, status, return](#5-the-standalone-window-read-flow-status-return)
6. [Context variants](#6-context-variants)
7. [Demo surface](#7-demo-surface)
8. [Copy keys (en / he / es)](#8-copy-keys-en--he--es)
9. [Files to create / modify](#9-files-to-create--modify)
10. [Task list and estimate](#10-task-list-and-estimate)
11. [Test plan and guards](#11-test-plan-and-guards)
12. [Risks](#12-risks)
13. [End-of-stream run sheet additions](#13-end-of-stream-run-sheet-additions)
14. [Open questions for SA](#14-open-questions-for-sa)
15. [Needs the user](#15-needs-the-user)
16. [SA Review Notes](#sa-review-notes)
17. [QA Testing Report](#qa-testing-report)
18. [Commit Info](#commit-info)
19. [Change History](#change-history)

---

## 1. Scope and binding conditions

**Approved scope (requirement §11, verbatim):**
> **UM-2 — Open the modal from anywhere.** One contract to open the modal from any Business OS page with a context. The `locked_feature` variant (lock header, "This needs {plan}", that card highlighted) and the `founding_partner` variant (shown only when the server signals it) are demoed from `/test-business-os` or Storybook-style tests, since no real caller exists yet. A Founding Partner with no end date sees no buy button. No real trigger is wired — 2 d

SA slicing table: "UM-2 — As written, plus the provider placement in `app/business-os/layout.tsx` (check `ownerLanguageFirstFrame.guard` pins) — 2 d".

| Condition / ruling | How UM-2 meets it |
|---|---|
| **C-4 / UM-SA5** Layout provider + `useUpgradeModal()`, `ConfigurationDialogProvider` shape, lazy-loaded (PERF-1), context = the three-member union only, no URL parameter, no window event | §4. `UpgradeModalProvider` inside `LanguageProvider` and `CapabilitiesProvider`, beside `ConfigurationDialogProvider`; the window comes through `createLazyDialog` in `lazyDialogs.tsx`; the union is the only argument. Guard (q) pins "no `useSearchParams` / `window.location` / `addEventListener` / `CustomEvent` / `dispatchEvent`" in the new files |
| **UM-SA1 / UM-SA8** From elsewhere: its own `usePlanFlow` instance, one `readMyPlan()` on open (no prefetch, nothing at page load), B5 / B6 in its body | §5. A fresh session per open (keyed child), so the hook state and the read never leak from one open to the next |
| **UM-SA2** Never portal from the provider while the Settings drawer is open | §4.3. While `PlanSection` is mounted (the drawer is open), the provider refuses `openUpgradeModal` and logs a `debug` line. Settings keeps its own nested instance (UM-1b), unchanged |
| **UM-SA10** Checkout return stays `settings_plan` | §5.4. `PlanPurchase` already calls `router.replace(settingsPlanReturnPath(sessionId))`; the standalone window hands off (closes) on `onComplete`, before the drawer opens |
| **C-6 / UM-SA7** Zero imports from `lib/business-os/entitlements/` (type-only included) in every new file and the demo | Types from `planPayloadTypes.ts`; guard (d) list extended to the new files |
| **C-7** No tier id literal in product code or the demo: the `locked_feature` demo takes its plan id from the payload | §7: the demo's plan picker is filled from the read payload's `plans`; `tierLiteral.forbidden` covers the new files |
| **C-12** One Stripe Embedded Checkout per page | The provider instance and the Settings instance are never open together (§4.3); one flow at a time inside each (UM-1b) |
| **C-14** SA code review + QA before the user's diff; no fast-track | Header "Path" |
| **UM-FR8** The context changes the headline and the highlight only, never what is offered | §6.4: `upgradeModalView(plan, context)` keeps `action` independent of `context`, pinned by a test over every fixture × context |
| **UM-FR9** `founding_partner` copy only when `endsFreeAccessOnPurchase === 'free_access'` and the server offers a plan; otherwise the `settings` copy | §6.3 |
| **UM-FR11** Close always available except Confirm and 3-D Secure | Unchanged busy lock from UM-1b; it applies to the standalone window as is |
| **AC-UM5** Founding Partner with no end date: no buy button; with an end date: "Keep everything you have" + Choose | §6.3, tests §11.2 |
| **AC-UM9** `locked_feature` + the top plan: lock header, that column highlighted; not offered → no button | §6.2, tests §11.2 |

**Not in UM-2:** a real caller (UM-F2, each refusing slice wires its own); deciding when or to whom the Founding Partner prompt is shown (UM-F1); returning to the opening page after checkout (UM-F3); English sr-only "Close" in he / es, the long phone headline and contrast polish (UM-3); conversion copy CV-1 to CV-8 (UM-3).

---

## 2. Analysis summary

Read on the UM-1b worktree (`origin/main` `c9e1dfba` + UM-1b's uncommitted diff).

| Area | Finding |
|---|---|
| `UpgradeModal.tsx` | Takes `open`, `onOpenChange`, `plan: PlanPayload` (never null) and `flow: UpgradeModalFlow` (`checkoutAllowed`, `upgradeAllowed`, `paymentsConfigured`, `onCheckoutComplete`, `onUpgrading`, `onUpgradeCheckAgain`). On `onComplete` / `onUpgrading` / the Q-12 landing it always `handOff()`s, which **closes**: correct in Settings, wrong standalone for the upgrade (nothing would show "Upgrading…"). It does no read (guard (b)). Focus return to the opener is done by hand (D-1); this already covers a trigger-less dialog, which is what the provider's is |
| `upgradeModalView.ts` | `upgradeModalView(plan)`: `headline: 'choose' \| 'top_plan' \| 'compare'`, `isRecommended` = last offered, not-current plan (amended UM-SA4 / C-10), `action` per column, `somethingOffered`, `hasActions`. No context input yet |
| `usePlanFlow.ts` | Pure client hook; takes `plan`, `setPlan`, `setFailed`, `loading`, `checkoutMarker`. Bounded re-read runs while `processing`. Usable by a second host as is: no change needed. `paymentsConfigured` is memoised per hook instance |
| `PlanSection.tsx` | Owns the drawer's B5 / B6 lines (lines 307–339 on the worktree). Pinned by `planPrefetch.guard` P-G8: no new effect before the `[language]` effect |
| `ConfigurationDialogProvider.tsx` | The shape to follow: `createContext` + throwing hook + optional hook + flag hook, `useCallback` opener, `isConfigurationOpen` with a 350 ms closing grace for surfaces below, the lazy dialog rendered closed after `{children}` |
| `lazyDialogs.tsx` / `lazyDialogLoader.tsx` | `createLazyDialog<P extends { isOpen; onClose }>`, one module-level loader per dialog, the closed instance warms the chunk after paint, an open instance shows a loading / "Try again" surface. **`lazyDialogs.guard` pins exactly two `createLazyDialog<` calls and the `HEAVY_MODULES` list**: a third dialog amends that guard in the same diff |
| `app/business-os/layout.tsx` | Server component; providers `UserProvider` → `V2ThemeProvider` → `LanguageProvider` → `CapabilitiesProvider` → `ConfigurationDialogProvider` → chrome + children. The comment already explains why a dialog provider sits outside the sticky chrome |
| `ownerLanguageFirstFrame.guard` | G-1 (script before every provider; `LanguageProvider initial=`), G-2 (the language read before the payment hold, `Promise.all` shape after it, `readPlanBadge()` / `readPaymentNotice()` once), G-3 (**only three layouts mount `<LanguageProvider`**), G-4 / G-5 / G-6. A client provider added inside `LanguageProvider` touches none of them. Also pinning the layout: `themePrepaint.guard`, `paymentHold.test` (the gate is the first awaited statement), `enforcementPoints.test` (the layout's entitlements import is `readPlanBadge` only) |
| `/test-business-os` | **Outside** the Business OS layout: its own server layout (payment hold only) and one client page with no `LanguageProvider`, no `V2ThemeProvider`, no `CapabilitiesProvider`. `useLanguage()` **throws** there, and G-3 forbids mounting `LanguageProvider` in it. So the real provider and the real modal cannot run on that page as it is (§7, SA Q-1) |
| `PlanPayload` | `kind: 'tier' \| 'cohort' \| null`, `accessEndsAt`, `endsWhen` (server sentence), `purchase.endsFreeAccessOnPurchase: 'trial' \| 'free_access' \| null`, `plans`, `comparison` |
| DB / routes | None touched |

---

## 3. Implementation approach

1. **The provider holds only "open, and with which context".** Like `ConfigurationDialogProvider`: state + opener in context, the window rendered lazily after `{children}`. The plan read and the flow live in the window, not in the provider. Nothing runs at page load except the PERF-1 chunk warm-up.
2. **A thin standalone host, not a second modal.** `StandaloneUpgradeModal` (lazy, `isOpen` / `onClose` props as the loader requires) mounts a per-open session: one `readMyPlan()`, one `usePlanFlow`, then the **same** `UpgradeModal` component. That is the "second instance of the same component" UM-SA5 accepted.
3. **`UpgradeModal` gains three optional props, defaults = UM-1b behaviour.** `context` (default `{ kind: 'settings' }`), `afterUpgrade: 'close' | 'stay'` (default `'close'`), and a read state for the window's own loading / failure body. Settings passes none of them, so UM-1b's suites stay green unchanged.
4. **The view decides variants from server data and the context.** `upgradeModalView(plan, context)` returns the headline / subheading variant and the highlighted column. It compares only ids from the payload, and never a cohort name (C-7, UM-FR7).
5. **One rendering of B5 / B6.** The drawer's status lines move verbatim from `PlanSection` into `PlanFlowStatus.tsx`. Both the drawer and the standalone window render that component from their own hook instance. This keeps C-2: one copy of each predicate, and also one copy of the lines that show them (SA Q-4).

---

## 4. The open contract and the provider

### 4.1 Types (`components/business-os/settings/upgradeModalContext.ts`)

```typescript
/** UM-SA5 / C-4: the only thing a caller may pass. No name, price, offer or callback. */
export type UpgradeModalContext =
  | { kind: 'settings' }
  | { kind: 'locked_feature'; planId: string }
  | { kind: 'founding_partner' };

export const SETTINGS_CONTEXT: UpgradeModalContext = { kind: 'settings' };
```

`planId` is whatever id the server's refusal named. The window joins it against the payload. An id it cannot find falls back to the `settings` copy and highlight (§6.2). It is never sent to a server.

### 4.2 Provider (`components/business-os/settings/UpgradeModalProvider.tsx`)

| Export | Shape | Notes |
|---|---|---|
| `UpgradeModalProvider` | `{ children }` | `useState<UpgradeModalContext \| null>`; renders `{children}` then `<LazyUpgradeModal isOpen={context !== null} onClose={close} context={context ?? SETTINGS_CONTEXT} />` |
| `useUpgradeModal()` | `{ openUpgradeModal(context): void; isUpgradeModalOpen: boolean }` | **Throws** outside the provider, as `useConfigurationDialog` does: a locked action whose upgrade link silently does nothing is the worse failure |
| `useUpgradeModalOpen()` | `boolean` | Flag only, `false` without a provider. True from open until 350 ms after close: the same closing grace and the same reason as `isConfigurationOpen`, so a sheet below a future caller can hold its ground (SA Q-6) |
| `useUpgradeModalInlineHost()` | `void` (registers while mounted) | Called by `PlanSection` (§4.3). A no-op without a provider (PlanSection's suites render without one) |

`openUpgradeModal` is a `useCallback` with an empty dependency list. The context value is `useMemo`'d. A second `openUpgradeModal` while the window is open replaces nothing and is ignored (SA Q-5).

### 4.3 Never over the Settings drawer (UM-SA2)

`PlanSection` mounts only while the plan drawer is open (closing the drawer unmounts it, UM-1b §13), so it is the signal. `PlanSection` calls `useUpgradeModalInlineHost()`. The hook increments a provider counter in a mount effect and decrements it in cleanup. It is declared **after** the `[language]` effect, so P-G8 still holds. While the counter is above 0:

- `openUpgradeModal` refuses. It logs `debug` `{ contextKind }` 'Upgrade modal open refused: the Settings plan drawer hosts its own'. Nothing portals.
- If a provider window were somehow open when the drawer mounts, nothing changes. This cannot happen: the window is modal, so nothing under it can open the drawer. The one path that leads to Settings, the checkout return, closes the window first (§5.4).

The Settings "See plans" button keeps the nested instance from UM-1b and never goes through the provider.

### 4.4 Placement in `app/business-os/layout.tsx`

```tsx
<CapabilitiesProvider>
  <ConfigurationDialogProvider>
    <UpgradeModalProvider>
      <div className={…}>{/* sticky chrome + children, unchanged */}</div>
    </UpgradeModalProvider>
  </ConfigurationDialogProvider>
</CapabilitiesProvider>
```

- Inside `LanguageProvider` (the window is translated) and `CapabilitiesProvider` (C-4). Outside the `sticky top-0 z-50` chrome, for the stacking reason the layout's own comment gives.
- Inside `ConfigurationDialogProvider` rather than beside it, so a future caller inside the configuration dialog could read both contexts. It renders nothing of its own on the server (the loader's server snapshot is empty). The first frame and hydration are unchanged.
- **Guards that pin this file, all expected to pass unchanged:** `ownerLanguageFirstFrame.guard` G-1 (the script stays before `<V2ThemeProvider` / `<UserProvider` / `<LanguageProvider`), G-2 (no new awaited read, the `Promise.all` shape untouched), G-3 (no `<LanguageProvider` added anywhere); `themePrepaint.guard`; `paymentHold.test` (the gate stays the first awaited statement); `enforcementPoints.test` (no new entitlements import). Task 9 runs all four.
- **New pin** (`upgradeModalProvider.placement.guard`, §11.3): exactly one `<UpgradeModalProvider` in production code, in this layout, positioned after `<LanguageProvider` and `<CapabilitiesProvider` and before the `sticky` wrapper.

### 4.5 Lazy loading (PERF-1)

`lazyDialogs.tsx` gains `LazyUpgradeModal = createLazyDialog<StandaloneUpgradeModalProps>('UpgradeModal', () => import('@/components/business-os/settings/StandaloneUpgradeModal').then(…))`, with a type-only import, as for the other two. `lazyDialogs.guard` is amended in the same diff. `HEAVY_MODULES` gains `components/business-os/settings/StandaloneUpgradeModal`, the `createLazyDialog<` count goes 2 → 3, and the `it.each` gains `UpgradeModalProvider.tsx renders LazyUpgradeModal`. `PlanSection`'s static import of `UpgradeModal` stays. It loads only with the Settings drawer, and `UpgradeModal.tsx` itself is **not** added to `HEAVY_MODULES` (SA Q-7).

---

## 5. The standalone window: read, flow, status, return

### 5.1 `StandaloneUpgradeModal` (`components/business-os/settings/StandaloneUpgradeModal.tsx`)

Props `{ isOpen: boolean; onClose: () => void; context: UpgradeModalContext }` (the loader's contract). While `isOpen`, it renders `<UpgradeSession key={openCount} …/>`, a fresh child per open. Closed, it renders nothing, so the closed layout instance reads nothing and costs nothing (`ConfigurationDialog` precedent).

`UpgradeSession`:

| Part | Rule |
|---|---|
| The read | One `readMyPlan()` per open, started in a ref-guarded mount effect (the C-b pattern: StrictMode's second run starts nothing). No prefetch, no read at page load (UM-SA8). Result through `planFrom()`. `throw` → `logger.warn({ err })` + failed state |
| The flow | `usePlanFlow({ plan, setPlan, setFailed, loading, checkoutMarker: null })`: no URL marker is read outside Settings (C-4); a checkout completed here leaves through the return path (§5.4) |
| Render | `<UpgradeModal open onOpenChange={…→ onClose} plan={plan} flow={…} context={context} afterUpgrade="stay" readState={…} />` |
| Language | The window covers the chrome, so the language cannot change while it is open; no re-read effect (SA Q-8) |
| Logging | `createLogger({ module: 'BusinessOsUpgradeModal' })`; `warn` on a failed read; no plan name or body in any line |

### 5.2 `UpgradeModal` additions (all optional; Settings passes none)

| Prop | Default | Effect |
|---|---|---|
| `context?: UpgradeModalContext` | `{ kind: 'settings' }` | Passed to `upgradeModalView` (§6); the band shows the `Lock` icon for the locked variant instead of `Sparkles` |
| `afterUpgrade?: 'close' \| 'stay'` | `'close'` | `'stay'`: `onUpgrading` calls `flow.onUpgrading(tier)` and then `resetFlow()`, not `handOff()`. The window stays open with the table area showing `<PlanFlowStatus>` (§5.3) while `flow.upgradeProcessing \|\| flow.upgradeSucceeded`. The Q-12 landing effect does the same. Checkout is unaffected: it always hands off (§5.4) |
| `readState?: 'loading' \| 'failed' \| 'ready'` | `'ready'` | `'loading'`: the band (headline "Compare our plans", the context-free default) and in the table area `plan.loading` with a spinner, an `aria-busy` region (the NFR's "not a blank modal"). `'failed'`: `plan.problem.unavailable`. `plan.status !== 'ok'`: the server's `problem` sentence. Closable in all three. `plan` may be `null` only when not `'ready'` |

`UpgradeModalFlow` widens by three **read-only** values from the same hook: `upgradeProcessing`, `upgradeSucceeded`, `exhausted`. These are values, not copies of predicates (C-2); guard (c) stays as it is.

### 5.3 `PlanFlowStatus` (moved, not rewritten)

`PlanSection` lines 307–339 (`plan-purchase-done`, `plan-upgrade-done`, `plan-upgrade-upgrading`, `plan-purchase-processing`, `plan-purchase-slow` with its "Check again" link to `SETTINGS_PLAN_PATH`) move verbatim into `components/business-os/settings/PlanFlowStatus.tsx`. Test ids, keys and conditions do not change. `PlanSection` renders it in the same place; the standalone window renders it in the table area after an upgrade. In the standalone window, "Check again" after the bounded re-read runs out links to Settings → Plan, the account home. Every drawer suite that asserts those ids passes unmodified. Any change to them is a finding.

### 5.4 Return after checkout (UM-SA10)

| Step | What happens |
|---|---|
| Stripe completes in the standalone window | `PlanPurchase`'s handler: `onComplete(sessionId)` (the window's wrapped callback: `flow.onCheckoutComplete` then `handOff()`, which **closes**), then `router.replace(settingsPlanReturnPath(sessionId))` |
| Navigation | `/business-os/settings?section=plan&checkout=…`; the layout (and so the provider) stays mounted, its window already closed |
| Settings | The page's `?section=plan` handling opens the drawer; `PlanSection` mounts (registering the inline host, §4.3), reads fresh (B-2: a marker always reads fresh) and shows B5 "Payment processing" → the server's answer |
| Opened on the Settings page itself, drawer closed | Same `router.replace` on the same path; the drawer opens on the marker. Tested |

Nothing new on the server; the standalone window's own `usePlanFlow` simply unmounts with the session. The window is closed, so no `EmbeddedCheckoutProvider` survives into the drawer's page (C-12).

---

## 6. Context variants

### 6.1 Rules in `upgradeModalView(plan, context = SETTINGS_CONTEXT)`

The view gains `variant: 'settings' | 'locked_feature' | 'founding_partner'` (the copy actually used after fallback), `subheading: 'default' | 'locked_feature' | 'founding_partner'`, `lockedPlan: { planId; name; offered: boolean } | null`, and `highlightReason: 'recommended' | 'locked_feature' | null` on the highlighted column.

### 6.2 `locked_feature`

| Case (server data only) | Headline | Highlighted column | Buttons |
|---|---|---|---|
| `planId` ∈ `comparison.planIds`, ≠ the current tier, offered (`offer.tiers` ∪ `upgrade.tiers`) | `Lock` + "This needs {plan}" (name **from `plans`**, never from the caller) | That column | As the server offers (UM-FR8: unchanged) |
| Same, **not** offered (e.g. Founding Partner with no end date, BQ-P10) | "This needs {plan}" | That column | None for it. One muted line under the table: "{plan} can't be bought from your account right now." (`upgrade_modal.locked.not_offered`). The column's "Coming soon" chip still shows where the server says so |
| `planId` is the current tier, or not in the table, or `comparison` missing | Fallback to the `settings` copy (`variant: 'settings'`), the normal Recommended rule | — | As the server offers |

**Override O-1 (recorded here, and in the requirement after SA rules):** only in `locked_feature`, the highlighted column is the caller's plan, **even when it is not offered and not the last offered plan**. This overrides amended UM-SA4 / C-10 ("the last offered, non-current plan"), and is the UM-BQ4 decision "on a locked action, the plan that unlocks it". When O-1 applies, no other column carries the highlight. `settings` and `founding_partner` keep amended UM-SA4 / C-10. Its visual is the same tint and top border as Recommended. The badge text is SA Q-2.

### 6.3 `founding_partner`

| Case | Copy | Highlight |
|---|---|---|
| `purchase.endsFreeAccessOnPurchase === 'free_access'` **and** `somethingOffered` | Headline "Keep everything you have"; subheading "Choose a plan to carry on without a break." The free-access end date stays in the status strip, from the server's `endsWhen` sentence (SA Q-3) | Amended UM-SA4 (the last offered plan) |
| Anything else (no end date set: nothing offered, BQ-P10; a trial, `'trial'`; a paying tier) | Fallback to the `settings` copy. For an open-ended Founding Partner this is "Compare our plans" with no buy button anywhere (AC-UM5) | As `settings` |

The view keys on `endsFreeAccessOnPurchase` and the offer only. It never compares `kind`, a cohort id or a plan name (UM-FR7). The founder discount is not shown (UM-FR10, P-11).

### 6.4 What the context never changes (UM-FR8)

`columns[].action`, `comingSoon`, `ownPlanNote`, `somethingOffered`, `hasActions`, `sections` (identity) and the status strip are computed without `context`. A test asserts they are equal for every fixture under all three contexts.

---

## 7. Demo surface

**Constraint found (SA Q-1).** `/test-business-os` is outside the Business OS layout. It has no `LanguageProvider`, theme provider or capabilities provider, so `useLanguage()` throws there. `ownerLanguageFirstFrame.guard` G-3 forbids mounting `LanguageProvider` anywhere but the three layouts. A tab there cannot run the real provider in the real layout, and that is exactly what row 20 (c) must check.

| Option | What it is | Trade-off |
|---|---|---|
| **D-A (Dev recommends)** | A test-only page **inside** the Business OS segment, `app/business-os/upgrade-modal-demo/page.tsx` (client). Server switch `BUSINESS_OS_UPGRADE_MODAL_DEMO_ENABLED` (developer `.env.local` only, never Vercel; `notFound()` when off, the TC-1 pattern). Its buttons call the real `useUpgradeModal().openUpgradeModal(...)`: **settings**, **founding_partner**, and **locked_feature** with a plan picked from a select filled from one `readMyPlan()` of the session account's `plans` (C-7: no id typed). Plus a line saying what the server currently offers this account. `/test-business-os` gets a **"Upgrade modal" tab** with instructions and a plain link to the page (no query string) | The real layout, the provider, stacking, PERF-1 loader and payment hold: the evidence row 20 (c) needs. One new route in the product tree, switched off by default |
| D-B | Mount `LanguageProvider` + `V2ThemeProvider` + the provider inside a `/test-business-os` tab | Needs G-3 and `themePrepaint.guard` amended, and `initial` language read on a non-layout path (G-4). Still not "another Business OS page", so row 20 (c) stays unproven |
| D-C | Jest only ("Storybook-style tests") | Allowed by the requirement, and done anyway (§11). Gives no live surface for the end-of-stream run |

The scope doc (`docs/BUSINESS_OS_TEST_PAGE_SCOPE.md`) gains a "Tab: Upgrade modal" subsection: Purpose, the switch, use cases (each context; a Founding Partner with and without an end date; a trial; an Essentials owner; locked on a not-offered plan) and its Change History row.

---

## 8. Copy keys (en / he / es)

New keys in each dictionary's "Your plan" block. **He / es are drafts for the user's approval before merge**, batched into one question (§15). No figure in any value. Guard (i) applies: no wording claims what a plan lacks.

| Key | en | he (draft) | es (draft) |
|---|---|---|---|
| `upgrade_modal.headline.locked_feature` | This needs {plan} | לשם כך צריך את {plan} | Esto requiere {plan} |
| `upgrade_modal.subheading.locked_feature` | See what {plan} includes, side by side with the other plans. | מה כוללת {plan}, לצד התוכניות האחרות. | Mira lo que incluye {plan}, junto a los demás planes. |
| `upgrade_modal.locked.not_offered` | {plan} can't be bought from your account right now. | כרגע לא ניתן לרכוש את {plan} מהחשבון שלך. | Ahora mismo no puedes comprar {plan} desde tu cuenta. |
| `upgrade_modal.headline.founding_partner` | Keep everything you have | שומרים על כל מה שיש לך | Conserva todo lo que tienes |
| `upgrade_modal.subheading.founding_partner` | Choose a plan to carry on without a break. | בוחרים תוכנית וממשיכים בלי הפסקה. | Elige un plan y sigue sin interrupciones. |
| *(only if SA Q-2 picks a distinct badge)* `upgrade_modal.badge.needed` | Needed for this | נדרשת לשם כך | Necesario para esto |

**Reused, unchanged:** `upgrade_modal.subheading` (the `settings` subheading), every `upgrade_modal.headline.*` of UM-1a, `plan.loading`, `plan.problem.unavailable`, `plan.upgrade.upgrading`, `plan.upgrade.done`, `plan.purchase.processing`, `plan.purchase.done`, `plan.purchase.slow`, `plan.purchase.check_again`. Net: +5 keys (+6 with the badge). The demo page and the harness tab are English-only test UI, inline, as the harness convention is: no dictionary keys.

The requirement's §5 table says "Keep everything you have **with Founding Partner**" with a dated subheading. The draft drops both, for two reasons. The owner is leaving Founding Partner, so "with Founding Partner" reads backwards. And the date is already one line below, in the server's own sentence, so the client formats no date (SA Q-3).

---

## 9. Files to create / modify

| File | Action | Reason |
|---|---|---|
| `components/business-os/settings/upgradeModalContext.ts` | create | The union and `SETTINGS_CONTEXT` (§4.1) |
| `components/business-os/settings/UpgradeModalProvider.tsx` | create | Provider, `useUpgradeModal`, `useUpgradeModalOpen`, `useUpgradeModalInlineHost` (§4.2, §4.3) |
| `components/business-os/settings/StandaloneUpgradeModal.tsx` | create | Per-open session: read, `usePlanFlow`, `UpgradeModal` (§5.1) |
| `components/business-os/settings/PlanFlowStatus.tsx` | create (move) | B5 / B6 lines out of `PlanSection`, verbatim (§5.3) |
| `components/business-os/settings/UpgradeModal.tsx` | modify | Optional `context`, `afterUpgrade`, `readState`; lock icon; locked not-offered line; status in the table area (§5.2) |
| `components/business-os/settings/upgradeModalView.ts` | modify | `context` parameter, variants, O-1 highlight, fallbacks (§6) |
| `components/business-os/settings/PlanSection.tsx` | modify | Renders `PlanFlowStatus`; calls `useUpgradeModalInlineHost()` after the `[language]` effect; passes the three widened flow values |
| `components/business-os/lazyDialogs.tsx` | modify | `LazyUpgradeModal` (§4.5) |
| `app/business-os/layout.tsx` | modify | `<UpgradeModalProvider>` (§4.4) |
| `app/business-os/upgrade-modal-demo/page.tsx` (+ a server `layout.tsx` or `page` wrapper for the switch) | create | Demo D-A, if SA accepts (§7) |
| `app/test-business-os/page.tsx` | modify | "Upgrade modal" tab: instructions + link (§7) |
| `lib/business-os/translations/{en,he,es}.ts` | modify | +5 keys (§8) |
| `components/business-os/__tests__/lazyDialogs.guard.test.ts` | modify | Third lazy dialog (§4.5) |
| `components/business-os/settings/__tests__/upgradeModal.guard.test.ts` | modify | `NEW_FILES` extended; new pins (p)–(s) (§11.3) |
| `components/business-os/settings/__tests__/upgradeModalView.test.ts` | modify | Context cases (§11.1) |
| `components/business-os/settings/__tests__/UpgradeModalProvider.render.test.tsx` | create | Contract, read once, suppression, lazy (§11.2) |
| `components/business-os/settings/__tests__/upgradeModal.standalone.render.test.tsx` | create | Standalone flow, status, return, variants, RTL (§11.2) |
| `components/business-os/settings/__tests__/upgradeModalProvider.placement.guard.test.ts` | create | Layout placement (§11.3) |
| `docs/BUSINESS_OS_TEST_PAGE_SCOPE.md` | modify | Tab subsection + Change History (§7) |
| `docs/requirements/BUSINESS_OS_UPGRADE_MODAL_REQUIREMENT.md` | modify | UM-2 workplan, SA rulings (O-1 recorded against UM-SA4 / C-10), PR / merge (standing preference) |

**Not touched:** `components/ui/dialog.tsx`, `SettingsDrawer.tsx`, `app/business-os/settings/page.tsx`, the islands (`PlanPurchase`, `PlanUpgrade`, `PlanEmbeddedCheckout`), `usePlanFlow.ts`, `planDrawerReads.ts`, `ConfigurationDialogProvider.tsx`, every route, every billing / entitlements server file, the DB.

---

## 10. Task list and estimate

| # | Task | Est. |
|---|---|---|
| ✅ 0 | RM creates the branch from UM-1b's committed tip (§12 R-1); baseline run of the settings, `components/business-os`, settings page, `test-business-os` and layout-guard suites plus `test:bos-entitlements`, recorded here | 0.1 d |
| ✅ 1 | `upgradeModalContext.ts`; `upgradeModalView(plan, context)` variants, O-1, fallbacks, the UM-FR8 invariance; `upgradeModalView.test` | 0.3 d |
| ✅ 2 | `PlanFlowStatus` move (drawer suites green unmodified); `UpgradeModal` optional props (`context`, `afterUpgrade`, `readState`), lock icon, not-offered line, status body | 0.35 d |
| ✅ 3 | `StandaloneUpgradeModal` (per-open session, ref-guarded read, own `usePlanFlow`) | 0.25 d |
| ✅ 4 | `UpgradeModalProvider` (open / refuse / grace / inline host), `LazyUpgradeModal`, `lazyDialogs.guard` amendment, layout placement, `PlanSection` registration | 0.3 d |
| ✅ 5 | Demo per SA Q-1 (D-A: switch-gated page + harness tab link), scope doc | 0.25 d |
| ✅ 6 | Copy keys en / he / es; `dictionariesStayInStep` | 0.05 d |
| ✅ 7 | New suites and guards (§11) incl. planted-violation controls | 0.3 d |
| ✅ 8 | Full runs: the suites above, `ownerLanguageFirstFrame.guard`, `themePrepaint.guard`, `paymentHold.test`, `enforcementPoints.test`, `lazyDialogs.guard`, `tierLiteral.forbidden`, `npm run test:bos-entitlements`, `npm run lint:hooks`, `npx eslint` on touched files, `npx tsc --noEmit -p .`; `git diff --stat` / `--numstat` (no deletion-only file) | 0.1 d |
| ✅ 9 | Requirement MD update; run-sheet rows to QA (§13) | 0.05 d |
| | **Total** | **≈ 2.05 d** (requirement and SA: 2 d) |

The likeliest overrun is Task 2: if the `PlanFlowStatus` move breaks a drawer suite, the cause must be found, not the assertion loosened. Flag at 2.25 d.

---

## 11. Test plan and guards

Payloads as in UM-1a / UM-1b: real `buildCustomerPlanView` + `readPlanPurchaseView` through JSON (`upgradeModalPayloads.ts`). Tier ids only under `components/business-os/settings/__tests__/` (FR-12). Stripe: the existing `@stripe/react-stripe-js` and `stripeJs` mocks.

### 11.1 View (`upgradeModalView.test`)

| Case | Expectation |
|---|---|
| No context / `settings` | Deep-equal to UM-1b's output for every fixture (regression pin) |
| `locked_feature` + the top plan, Essentials owner (upgrade offered) | `variant 'locked_feature'`, highlighted = top, `lockedPlan.offered true` |
| `locked_feature` + the top plan, Founding Partner no end date | Highlighted = top (O-1, not offered), `offered false`, every `action` ≠ button (AC-UM9) |
| `locked_feature` + the lower plan, trial | Highlighted = lower, **not** the top (O-1 overrides UM-BQ4); exactly one highlighted column |
| `locked_feature` + the current tier / an id not in the table / no `comparison` | Fallback `variant 'settings'`, normal Recommended |
| `founding_partner`, Founding Partner with end date (`free_access`, offered) | `variant 'founding_partner'`, Recommended per amended UM-SA4 |
| `founding_partner`, open-ended Founding Partner / trial / Essentials | Fallback `'settings'` (UM-FR9); open-ended: no button anywhere (AC-UM5) |
| UM-FR8 invariance | For every fixture × 3 contexts: `action`, `comingSoon`, `ownPlanNote`, `somethingOffered`, `hasActions` equal; `sections` identical (`toBe`) |

### 11.2 Render

**`UpgradeModalProvider.render`** (real `LanguageProvider` test wrapper as in the existing suites; the loader with zero retry delays):

| Test | Assertion |
|---|---|
| No read at page load | Provider mounted, closed: zero `my-plan` requests; the chunk warm-up only |
| Open | `openUpgradeModal({ kind: 'settings' })` → modal visible; exactly **one** `my-plan` GET; in `<React.StrictMode>` still one |
| Reopen | Close → open: one fresh GET (two total), no state carried over (a previous "Upgrading…" is gone) |
| Refused over the drawer (UM-SA2) | With a `PlanSection` mounted (inline host registered): `openUpgradeModal` renders nothing, no GET, one `debug` line; after it unmounts, the next open works |
| Outside the provider | `useUpgradeModal()` throws; `useUpgradeModalOpen()` returns `false` |
| Closing grace | `isUpgradeModalOpen` true while open and for 350 ms after close (fake timers) |
| Second open while open | Ignored: context unchanged, no second GET |
| Focus | Focus returns to the caller's button on close (D-1 path, trigger-less) |
| Type contract | A `// @ts-expect-error` block: a context with `name`, `price`, `offer`, a callback, or `kind: 'other'` does not compile (checked by `tsc` in Task 8) |

**`upgradeModal.standalone.render`:**

| Test | Assertion |
|---|---|
| Loading / failed / not `ok` | Spinner + `plan.loading` in an `aria-busy` region; `plan.problem.unavailable`; the server's `problem` sentence; closable in each |
| Upgrade stays (`afterUpgrade 'stay'`) | Confirm → `upgraded`: window **still open**, table area shows `plan-upgrade-upgrading`; the bounded re-read showing the tier renewing → `plan-upgrade-done`; never before the re-read (U-5) |
| Failed re-read | Keeps "Upgrading…", never "You're on"; after the limit `plan-purchase-slow` with the link to `SETTINGS_PLAN_PATH` |
| 3-D Secure | Busy lock as UM-1b (Escape / X / backdrop refused; Stripe-reachable style present only while busy); `succeeded` → status in the body |
| Q-12 landing in `'stay'` | Check again shows the upgrade landed → status in the body, window open |
| Checkout return (UM-SA10) | Stripe `onComplete` → window closed and `router.replace(settingsPlanReturnPath(id))` in the same act; no `fake-checkout` left in the document |
| One checkout per page (C-12) | After the hand-off, mounting the Settings `PlanSection` with the marker shows `plan-purchase-processing` and exactly one Stripe provider ever existed at a time |
| Variants | `locked_feature`: lock icon, "This needs {plan}" with the payload's name; not-offered line only when not offered; `founding_partner`: headline only per §6.3 |
| No dead button | Same rule as UM-1b, for each context |
| RTL / es | Hebrew: `dir="rtl"`, the variant headlines from the dictionary; Spanish: same keys |
| Settings unchanged | The UM-1b suites (`UpgradeModal.render`, `.qa`, `.layers`, `upgradeModal.flow.render`, `PlanPurchase.render`, `PlanUpgrade.render`, both prefetch suites) pass **unmodified** |

### 11.3 Guards

| Guard | Expectation |
|---|---|
| `upgradeModal.guard` (b) | Unchanged: `UpgradeModal.tsx` and `upgradeModalView.ts` take no read |
| (d), (e), (g) | `NEW_FILES` gains `upgradeModalContext.ts`, `UpgradeModalProvider.tsx`, `StandaloneUpgradeModal.tsx`, `PlanFlowStatus.tsx` and the demo page: no entitlements import (type-only included), no `console.*`, no capability id / row label literal |
| (p) new | `readMyPlan` is called only in `planDrawerReads.ts`, `usePlanFlow.ts`, `PlanSection.tsx`, `StandaloneUpgradeModal.tsx` and the demo page; never in the provider |
| (q) new (C-4) | The provider, the host and the context file contain no `useSearchParams`, `window.location`, `addEventListener`, `CustomEvent`, `dispatchEvent`, `postMessage` |
| (r) new (C-4) | `upgradeModalContext.ts` declares exactly the three members (`settings`, `locked_feature` with `planId`, `founding_partner`), no other field |
| (s) new (UM-SA2) | `PlanSection.tsx` calls `useUpgradeModalInlineHost()` after the `[language]` effect (source-order pin, alongside P-G8) |
| `upgradeModalProvider.placement.guard` new | One production `<UpgradeModalProvider`, in `app/business-os/layout.tsx`, after `<LanguageProvider` and `<CapabilitiesProvider`, before the `sticky top-0` wrapper |
| `lazyDialogs.guard` amended | Three `createLazyDialog<`; `StandaloneUpgradeModal` in `HEAVY_MODULES` (no static value import anywhere); the provider renders `<LazyUpgradeModal` |
| `tierLiteral.forbidden` | Covers the new files and the demo unchanged (C-7) |
| `ownerLanguageFirstFrame`, `themePrepaint`, `paymentHold`, `enforcementPoints` | Unchanged and green |

Each new pin has a planted-violation control, as UM-1a's and UM-1b's do. `npm run test:bos-entitlements` runs on the final diff (skill checklist: no module file changes, but its guards scan `components/` and `app/`).

---

## 12. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | **Stacking on unmerged UM-1b.** The user batched every live check to the end of the stream, so UM-1b's PR may still be open when UM-2 starts; a PR based on UM-1b's branch can merge into that branch, not `main` (memory: stacked PR merges) | RM creates `feature/bos-upgrade-modal-um2` from UM-1b's **committed** tip; UM-2's PR targets `main` and opens only after UM-1b merges (or is rebased onto `main` then), never based on the UM-1b branch. TL to confirm (SA Q-9) |
| R-2 | **The provider window over a drawer elsewhere.** A future caller inside a Radix sheet (e.g. a contact drawer) hits the `ConfigurationDialogProvider` dismissal bug: a click in the window is "outside" the sheet | `useUpgradeModalOpen()` with the closing grace (§4.2), the same answer `isConfigurationOpen` gives; documented on the hook for UM-F2's callers. The Settings drawer is handled by refusal (§4.3) |
| R-3 | **Two Embedded Checkouts** (provider window and Settings instance) | Refusal while `PlanSection` is mounted; checkout always hands off before navigating; test §11.2 |
| R-4 | **The layout edit trips a first-frame or prepaint guard** | Client provider only, inside `LanguageProvider`, no new await; the four guards run in Task 8 |
| R-5 | **The `PlanFlowStatus` move changes the drawer** | Verbatim move; drawer suites must pass unmodified (§11.2 last row) |
| R-6 | **A reopened window shows stale state** (an old "Upgrading…") | Keyed per-open session (§5.1); test "Reopen" |
| R-7 | **The demo page reaches production** | Server switch off by default, `notFound()`, `.env.local` only; the harness tab only links to it |
| R-8 | **3-D Secure in the standalone window** (no drawer beneath, one Radix layer) | Same mitigation as UM-1b (scoped `pointer-events` style while busy); live evidence is row 20 (c) in the end-of-stream run (§13) |
| R-9 | **A caller passes a plan id the account cannot use** | Joined against the payload; unknown / current → `settings` fallback; never sent to a server |
| R-10 | Worktree hazards (shared `node_modules` junction, shared stash list) | Never `git stash`; never remove the junction; RM handles worktrees |

---

## 13. End-of-stream run sheet additions

Rows QA adds to UM-1b's §14 sheet for the user's single end-of-stream session (UD-1). The user sets `BUSINESS_OS_UPGRADE_MODAL_DEMO_ENABLED=true` in `.env.local`. Agents never sign in or handle keys.

| # | Account | Click steps | Expected |
|---|---|---|---|
| U2-1 | Essentials owner (the S-6 account) | `/business-os/upgrade-modal-demo` → "Open: settings" → Autopilot "Upgrade to Autopilot" → Confirm with `4000 0027 6000 3184` → Complete. Desktop and 360 px | **Row 20 (c):** the bank's check can be clicked and typed into, the window stays open, then the window body says "Upgrading…" → "You're on Autopilot" |
| U2-2 | A trial account | Demo → "Open: settings" → Choose Essentials → `4242…` | The window closes; Settings → Your plan opens on "Payment processing" → "You're on Essentials" (UM-SA10) |
| U2-3 | Any | Demo → "Open: locked_feature" with each plan in the picker | "This needs {plan}" with a lock; that column highlighted; buttons only where the server offers |
| U2-4 | Founding Partner, no end date | Demo → "Open: founding_partner", then "Open: locked_feature" on the top plan | "Compare our plans", no button anywhere; locked: "This needs …" + "can't be bought from your account right now", no button |
| U2-5 | Founding Partner with an end date (admin sets it) | Demo → "Open: founding_partner" | "Keep everything you have"; Choose buttons; "Buying ends your free access today…" |
| U2-6 | Any | Settings → Your plan (drawer open) → "See plans" → upgrade or Choose as in UM-1b | (X-5) Re-checks only that the drawer's own window still works as in UM-1b. The refusal of the provider while the drawer is open cannot be reached from the Settings page by any click, so it is proven by Jest only (`UpgradeModalProvider.render`, "never over the Settings drawer") |
| U2-7 | Any | Hebrew, Spanish, dark mode | Variant headlines translated; RTL; readable |
| U2-8 | Any | Remove `BUSINESS_OS_UPGRADE_MODAL_DEMO_ENABLED` (or set `false`), restart, open `/business-os/upgrade-modal-demo` | 404. The harness "Upgrade modal" tab still shows its note and link |
| U2-9 | Any | Demo → "Open: settings" at 360 px, then close with "Back to your plan" | Focus lands back on the demo button; the page behind is unchanged |

---

## 14. Open questions for SA

| # | Question | Dev proposal |
|---|---|---|
| Q-1 | **Demo surface.** `/test-business-os` has no Business OS providers and G-3 forbids adding `LanguageProvider` there (§7) | **D-A:** a switch-gated test page inside `app/business-os/`, linked from a new harness tab; plus the Jest suites |
| Q-2 | O-1's badge on the locked column: reuse "Recommended", or a distinct "Needed for this"? | Distinct (`upgrade_modal.badge.needed`): "Recommended" on a plan the account cannot buy reads as a pitch |
| Q-3 | `founding_partner` copy: drop "with Founding Partner" and the date from the subheading (the date is in the status strip, from the server)? | Yes; no client date formatting |
| Q-4 | `PlanFlowStatus` moved out of `PlanSection` (one rendering of B5 / B6), vs. the window rendering its own lines | Move (C-2 spirit; drawer suites unmodified) |
| Q-5 | A second `openUpgradeModal` while open: ignore, or replace the context? | Ignore (nothing on screen changes under the owner) |
| Q-6 | Ship `useUpgradeModalOpen()` (closing grace) now, with no consumer yet? | Yes: it is part of the contract any caller inside a sheet will need (R-2), and it is tested |
| Q-7 | `UpgradeModal.tsx` stays statically imported by `PlanSection` (Settings), only the standalone host is lazy | Accept |
| Q-8 | No language re-read in the standalone window (it covers the chrome) | Accept |
| Q-9 | Branch / PR order given UM-1b is unmerged until the end-of-stream run (R-1) | Branch from UM-1b's committed tip; PR to `main` only after UM-1b merges |
| Q-10 | §5.3 of the requirement says "You have every Autopilot feature, free" for an open-ended Founding Partner; UM-FR9 says fall back to the `settings` copy | UM-FR9: the sentence would need the client to know the cohort equals the top plan (a rule the UI must not hold) |
| Q-11 | `locked_feature` subheading names the plan ("See what {plan} includes…") rather than "what the plan adds" (the requirement), which would need `nextPlanUp` joined to an arbitrary plan | Accept the generic sentence; UM-3 may refine copy |

---

## 15. Needs the user

1. **He / es wording** for the five new strings (§8), batched into one question, plus the badge if SA picks it (Q-2).
2. **The demo switch** (`BUSINESS_OS_UPGRADE_MODAL_DEMO_ENABLED=true`) in your `.env.local` for the end-of-stream run, and a Founding Partner test account with an end date set (U2-5).
3. **Row 20 (c) is UM-2's merge gate**: the PR may open, but it merges only after U2-1 is recorded in the end-of-stream run.

---

## Implementation Notes

**Dev, 2026-10-20.** Built in the worktree `neuronforge-upgrade-modal-um2` on `feature/bos-upgrade-modal-um2` (from UM-1b's committed tip `2bde7a81`). Nothing committed, no stash, no branch switch.

### User decisions recorded (2026-10-20)

| # | Decision |
|---|---|
| UD-UM2-1 | All he / es wording **approved as drafted** (§8): `headline.locked_feature` "This needs {plan}" / לשם כך צריך את {plan} / Esto requiere {plan}; `subheading.locked_feature` and `locked.not_offered` as drafted; `headline.founding_partner` "Keep everything you have" / שומרים על כל מה שיש לך / Conserva todo lo que tienes; `subheading.founding_partner` "Choose a plan to carry on without a break." / בוחרים תוכנית וממשיכים בלי הפסקה / Elige un plan y sigue sin interrupciones |
| UD-UM2-2 | The locked column gets the **separate badge** "Needed for this" / נדרשת לשם כך / Necesario para esto, not "Recommended" (SA Q-2) |
| UD-UM2-3 | Live checks are batched into the user's end-of-stream session: UM-2's rows U2-1 to U2-9 (§13) join that run sheet. No sign-in in this slice |

### SA conditions, as met

| # | How |
|---|---|
| X-1 | `app/business-os/upgrade-modal-demo/page.tsx` is a server component, `force-dynamic`; its first statement is `if (!isUpgradeModalDemoEnabled()) notFound();`, then it renders the `'use client'` `UpgradeModalDemo.tsx`. Flag module `lib/business-os/upgradeModalDemoFlag.ts` copies `testCreditToolsFlag.ts` (server-only, `parseBooleanFlag(…, false)`, no `NODE_ENV` check, TEST ONLY note). Not admin-gated; the reason is in the page's header comment. Linked from no product nav |
| X-2 | `app/business-os/upgrade-modal-demo/__tests__/upgradeModalDemo.guard.test.ts`: default off (unset, blank, unrecognised, `false`), on only when set; the page's first statement and `force-dynamic`; no `NEXT_PUBLIC_` variant in the source tree or `.env.example`; the client child never reads the switch. Planted controls for each. Harness tab: plain link + "answers 404 unless the switch is set" |
| X-3 | `UpgradeModalRead = { readState?: 'ready'; plan: PlanPayload } \| { readState: 'loading' \| 'failed'; plan?: null }` |
| X-4 | The inline-host counter is a `useRef`; the registrar sits in its own stable context, so registering re-renders nothing |
| X-5 | U2-6 reworded (§13) |
| X-6 | No PR opened. Branch chain as ruled |
| X-7 | The demo's only `readMyPlan()` is ref-guarded on mount; listed explicitly in guard (p)'s allow-list |
| X-8 | The not-offered line states the offer only ("{plan} can't be bought from your account right now."), no reason |
| X-9 | Requirement (status, §5 table, §5.2 as-built note with O-1 as UM-BQ4's locked-action clause and the demo route, §5.3 superseded by UM-FR9 per Q-10, §11, Change History), `docs/BUSINESS_OS_TEST_PAGE_SCOPE.md` (Tab: Upgrade modal + ToC + Change History), `docs/FEATURE_FLAGS.md` (table row, section, Change History 1.12.0). `.env.example` also gains the switch, `false` |

### Deviations from the workplan (for SA)

| # | What | Why |
|---|---|---|
| D-1 | `UpgradeModalFlow` is **not** widened. The status values reach the modal through a new optional prop `flowStatus?: PlanFlowStatusValues` (the seven values `PlanFlowStatus` reads, all from the same hook; values, not predicates) | `PlanFlowStatus` needs `marker`, `succeeded`, `checkoutProcessing`, `processing` as well as the three listed. Widening the required `UpgradeModalFlow` type would have broken the type of the UM-1b suites' `FLOW` objects; optional keeps them unmodified and Settings passes nothing new |
| D-2 | The context cases live in a new `upgradeModalView.context.test.ts`; `upgradeModalView.test.ts` is unchanged | Keeps the UM-1b view suite unmodified; the regression pin compares `settings` / no-context field for field against the UM-1b output |
| D-3 | No open counter key: `StandaloneUpgradeModal` renders `null` when closed, so each open mounts a fresh `UpgradeSession` | Same effect (a fresh read and flow per open), one less moving part; pinned by the "reopen" render test |
| D-4 | `highlightReason` added on each column; `isRecommended` is now `highlightReason === 'recommended'` (false everywhere while O-1 applies). The modal's tint, top border, badge and primary button key on `highlightReason !== null` | One column marked at most, and the badge text follows the reason (Q-2). Unchanged for `settings` (pinned) |
| D-5 | In `ready` with `plan.status !== 'ok'` or no usable `comparison`, the window shows the server's problem sentence (or `plan.problem.unavailable`) instead of an empty table | Settings never opens the window in those states (its button is hidden), so this only reaches the standalone window; it keeps the NFR "not a blank modal" |
| D-6 | `app/business-os/layout.tsx`: the children of `<UpgradeModalProvider>` are not re-indented | Minimal diff on a guard-pinned file; JSX is unaffected |
| D-7 | The worktree had **no** `node_modules` junction (Jest could not find `ts-jest`). Created it as a junction to `neuronforge/node_modules` (no install; the first `mklink` produced a malformed target, which was removed as a link only and recreated with PowerShell `New-Item -ItemType Junction`) | Needed to run any test. The shared `node_modules` was never touched |

### Findings for SA / UM-3 (not changed here)

| # | Finding |
|---|---|
| N-1 | The not-offered line sits under the table, so on a desktop window with the full comparison it is below the fold (shot 2). A candidate for UM-3: place it under the band or in the locked column's slot |
| N-2 | Repo-wide `npx tsc --noEmit -p .` reports 1,853 pre-existing errors (none in UM-2 files; the translation `TS1117` duplicates at `en.ts` 2126+ / `es.ts` 2032+ are pre-existing). A scoped `tsc` over every touched file and test is clean apart from the pre-existing styled-jsx error in `BusinessProfileSection.tsx` |
| N-3 | `docs/workplans/BUSINESS_OS_UPGRADE_MODAL_UM3_WORKPLAN.md` appeared untracked in this worktree during the build; not written by this slice |

### Runs (final code)

| Run | Result |
|---|---|
| `npx jest components/business-os/settings` (after the move, before new suites) | 34 / 34 suites, 651 / 651 tests: every UM-1b and drawer suite **unmodified** |
| `npx jest components/business-os app/business-os app/test-business-os` + `ownerLanguageFirstFrame.guard`, `themePrepaint.guard`, `paymentHold.test`, `enforcementPoints.test`, `tierLiteral.forbidden`, `dictionariesStayInStep.guard` (incl. `lazyDialogs.guard`, `planPrefetch.guard`, `upgradeModal.guard`) | **90 / 90 suites, 1,760 / 1,760 tests** |
| New suites in that run | `upgradeModalView.context` 14, `UpgradeModalProvider.render` 10, `upgradeModal.standalone.render` 19, `upgradeModalProvider.placement.guard` 6, `upgradeModalDemo.guard` 13; `upgradeModal.guard` 63 (pins (p)–(s) with 4 planted controls, `NEW_FILES` widened to 11), `lazyDialogs.guard` 12 |
| `npm run test:bos-entitlements` | 301 suites, 9,131 tests: 300 / 9,130 on the run; the one failure was `BusinessOsBillingEventRepository` reading a temporary screenshot-dump test file the moment it was deleted (ENOENT). Re-run alone: 67 / 67 pass. No module file changed, no entitlements import added |
| `npm run lint:hooks` | Clean (0 warnings) |
| `npx eslint` on every touched and new file | Clean |
| Scoped `tsc` (touched files + tests, `@ts-expect-error` type contract included) | Clean (see N-2) |
| `console.*` | None in any touched or new product file (guard (e) over the 11 `NEW_FILES`) |

### Screenshots (static render, not the running app)

Rendered from the real `StandaloneUpgradeModal` in Jest with real payloads, styled with the project's own CSS compiled by its Tailwind, captured with headless Chrome (phone shots in a 360 px iframe). Folder `scratchpad/um2-shots/` in the session scratchpad: `1-desktop-locked-feature-essentials`, `2-desktop-locked-feature-not-offered`, `3-desktop-founding-partner-ending`, `4-desktop-hebrew-locked-feature`, `5-desktop-hebrew-dark-founding-partner`, `6-phone-360-locked-feature`, `7-phone-360-hebrew-founding-partner`, `8-phone-360-dark-not-offered`. The temporary dump test was deleted after use.

---

## SA Review Notes

**Reviewed by SA — 2026-10-20**
**Status:** ✅ Approved with conditions X-1 to X-9

The architecture follows the patterns already in the codebase. The provider has the `ConfigurationDialogProvider` shape. The host is the third `createLazyDialog`, with its guard amended in the same diff. There is one read per open in a keyed session, and the window reuses the same `UpgradeModal`. Settings keeps its nested instance (UM-SA2), and checkout still returns to `settings_plan` (UM-SA10). Nothing is imported from the entitlements module, and no route, migration or DB change is made. I checked every touched file for `console.*`: `layout.tsx`, `lazyDialogs.tsx`, `test-business-os/page.tsx`, `PlanSection.tsx`, `UpgradeModal.tsx` and `upgradeModalView.ts` all have 0, so there is nothing to flag. The skills checked are `business-os-entitlements` (no import, so no registration is needed, but `test:bos-entitlements` still runs) and the admin gate rule (no admin surface; see X-1).

### Rulings on the open questions

| Q | Ruling |
|---|---|
| Q-1 | **D-A accepted, under X-1.** It is the only option that proves row 20 (c) in the real layout. D-B is rejected: it amends G-3 and `themePrepaint`, and it still does not run on "another Business OS page" |
| Q-2 | **Distinct badge, "Needed for this"** (`upgrade_modal.badge.needed`), and only in `locked_feature` when O-1 applies. "Recommended" on a plan the owner cannot buy reads as a pitch, and the lock header already says why that column is marked. Same tint and border. **Recommended default for the user:** "Needed for this" / נדרשת לשם כך / Necesario para esto. The es draft is correct as written: "Necesario" agrees with *plan* |
| Q-3 | **Accepted.** Headline "Keep everything you have". Subheading "Choose a plan to carry on without a break." The date comes only from the server's `endsWhen` sentence in the status strip, and the client formats no date. "With Founding Partner" is dropped because it reads backwards and would need a cohort name (UM-FR7). **Recommended default:** Dev's §8 wording. This is minor copy: include it in the single he / es batch question, not as a separate decision |
| Q-4 | **Move accepted.** It must be verbatim: the drawer suites pass unmodified, and any edit to an assertion is a code-review finding |
| Q-5 | Ignore. Accepted |
| Q-6 | Accepted. It is small, tested, and part of the contract that R-2 needs. The JSDoc must say why it exists (a caller inside a Radix sheet) |
| Q-7 | Accepted |
| Q-8 | Accepted |
| Q-9 | **Accepted with X-6** |
| Q-10 | **UM-FR9 wins.** The §5.3 sentence "You have every Autopilot feature, free" would need the client to equate the cohort with the top plan, which UM-FR7 forbids. An open-ended Founding Partner gets the `settings` copy with no button (AC-UM5). Record in the requirement that §5.3's sentence is superseded by UM-FR9 |
| Q-11 | Accepted. The generic, plan-named subheading is fine, and UM-3 may refine it |

**O-1 is not an override.** UM-BQ4 already says "on a locked action, the plan that unlocks it", and the requirement's §5 table gives `locked_feature` the highlight "the plan the caller passed". Record it as UM-BQ4's locked-action clause, with C-10 / UM-SA4 still governing `settings` and `founding_partner`. Do not record it as a deviation.

### Conditions

1. **X-1 (demo safety, High).** Build `app/business-os/upgrade-modal-demo/page.tsx` as a **server** component with `export const dynamic = 'force-dynamic'`. Its first statement calls `isUpgradeModalDemoEnabled()` and returns `notFound()` when that is false. Only after that does it render a separate `'use client'` child (`UpgradeModalDemo.tsx`), so the client bundle carries no switch logic. The flag lives in its own module and copies `testCreditToolsFlag.ts`: server-only, no `NEXT_PUBLIC_`, `parseBooleanFlag(…, false)`, ".env.local only, never Vercel", and no `NODE_ENV` check instead of the switch, because development points at the live DB. Mark it "TEST ONLY: remove with the demo, at the latest when UM-F2 wires a real caller". The page links from no product nav. It is not admin-gated, and the reason goes in the file: the trial and Founding Partner test accounts the run sheet needs are not admins, and the page can do nothing that Settings → Plan cannot already do for the same account. The middleware auth and the layout's payment hold apply as they do on every page in the segment.
2. **X-2.** A guard with a planted-violation control pins three things: the flag defaults to off; the page calls the flag and `notFound()` before any render; and no `NEXT_PUBLIC_` variant of the switch exists. The harness tab is a plain link plus a note that the page answers 404 unless the switch is set.
3. **X-3 (types, Medium).** `UpgradeModal` takes the read state as a discriminated prop, `{ readState: 'ready'; plan: PlanPayload } | { readState: 'loading' | 'failed'; plan?: null }`, not a nullable `plan` alongside a separate enum, so `tsc` rules out "ready with no plan".
4. **X-4.** Hold the inline-host counter in a `useRef`, not in state. Registering it must not re-render the layout subtree.
5. **X-5.** Reword U2-6. Nothing on the Settings page can call the provider while the drawer is open, so the refusal is proven by Jest only. The live row only re-checks the drawer instance.
6. **X-6 (branches and PRs, per the user decision of 2026-10-20).**
   - Chain the branches locally: `um1b` from `main`, `um2` from UM-1b's **final committed** tip, and `um3` from UM-2's tip. Each branch gets its own new worktree, and no branch is switched inside an existing worktree.
   - If an SA or QA fix lands on UM-1b after `um2` exists, **merge** `um1b` into `um2`. Do not rebase or rewrite a pushed branch.
   - Every PR's base is **`main`**, never a feature branch.
   - Open PRs strictly in order, and only after the single end-of-stream live session. Open the UM-2 PR only after UM-1b's PR has merged, and first check `git merge-base --is-ancestor <um1b tip> origin/main`.
   - Merge with **merge commits** (`--merge`), never squash. Squashing would orphan UM-1b's commits inside UM-2's history and conflict.
   - Auto-merge is allowed only once the live gate for that PR (row 20 (c) for UM-2) is recorded.
7. **X-7.** In the demo, the only `readMyPlan()` is the one that fills the picker. It runs on mount and never on a timer. Add it to guard (p)'s allow-list explicitly, as §11.3 already lists.
8. **X-8.** Treat the not-offered line as the client's statement of the server's offer, not as a reason. Use no wording about *why* (guard (i)).
9. **X-9.** In the same diff, update the requirement for O-1 (as recorded above), Q-10 and the demo route. Add the `BUSINESS_OS_TEST_PAGE_SCOPE.md` subsection, and add the new switch to `docs/feature_flags.md`.

### Approval
[x] Workplan approved. Proceed to implementation once UM-1b is committed and the `um2` branch exists (X-6).

**Code Review by SA — 2026-10-20**
**Status:** ✅ Code Approved (no required fixes; one trivial doc nit fixed by SA)

| Condition | Verdict |
|---|---|
| X-1 | ✅ `page.tsx` is a server component, `force-dynamic`, first statement `if (!isUpgradeModalDemoEnabled()) notFound();`, client child after. Flag copies `testCreditToolsFlag.ts` (`parseBooleanFlag(…, false)`, no `NODE_ENV`, TEST ONLY note). Not admin-gated, reason in the header. `.env.example` ships `false` |
| X-2 | ✅ `upgradeModalDemo.guard` pins default off, page order, no `NEXT_PUBLIC_` variant (tree + `.env.example`), client never reads the switch, each with a planted control. Harness tab is a plain link + 404 note |
| X-3 | ✅ `UpgradeModalRead` discriminated; `StandaloneUpgradeModal` yields `ready` only with a plan |
| X-4 | ✅ Counter is a `useRef`; the registrar lives in its own stable context, so registering re-renders nothing |
| X-7 | ✅ Demo's single ref-guarded `readMyPlan()` on mount |
| X-8 | ✅ Not-offered line states the offer only |
| X-9 | ✅ Requirement, `BUSINESS_OS_TEST_PAGE_SCOPE.md` (tab, ToC, history), `FEATURE_FLAGS.md` (row, section, history) |

Also verified: layout placement inside `LanguageProvider` / `CapabilitiesProvider` / `ConfigurationDialogProvider`, outside the sticky chrome (`ownerLanguageFirstFrame.guard`, `themePrepaint.guard`, `paymentHold.test`, placement guard green). UM-SA2 refusal through `useUpgradeModalInlineHost()` in `PlanSection`, declared before the early returns and after the `[language]` effect. One read per open: closed renders `null`, so each open mounts a fresh `UpgradeSession` (D-3 accepted). No second Embedded Checkout: the refusal plus checkout hand-off/close (C-12). The context changes only headline, subheading and highlight (UM-FR8, pinned by `upgradeModalView.context`). `locked_feature` falls back for the current tier or an unknown id. The "Needed for this" badge replaces Recommended, with one highlighted column at most (D-4 accepted). `founding_partner` applies only on `free_access` with an offer (BQ-P10). No entitlements import in any new client file (C-6). No tier literals: the `'founding_partner'` strings are context kinds, and the demo picks its plan from the payload (C-7). No `console.*` in any touched file. D-1 (`flowStatus` optional prop, values not predicates), D-2, D-5, D-6 and D-7 are accepted.

### Code Review Comments
1. `docs/FEATURE_FLAGS.md:4`: the header Version still said 1.11.0 while the history row added 1.12.0. **Fixed by SA** (trivial). Priority: Low
2. N-1 (not-offered line below the fold, shot 2): an open-ended Founding Partner sees "This needs {plan}" with no button and no visible reason until they scroll. Not blocking, because UM-2 has no real caller (UM-F2). **Carry to UM-3 as required:** place it under the band or in the locked column's action slot. Priority: Medium
3. `UpgradeModal.tsx:468`: the footer close reads "Back to your plan" when the window was opened outside Settings, where there is no plan view to go back to. Review the wording in UM-3 (for example "Close" for a non-`settings` origin). Priority: Low

### Runs (SA)
- `jest components/business-os/settings` + `lazyDialogs.guard` + `app/business-os` + `app/test-business-os`, in parallel: 44 / 48 suites passed. The 4 failures (`PlanPurchase`, `PlanUpgrade`, `PlanSection.prefetch`, `SettingsDrawer.discard`) were load timeouts (suites took 135–236 s). Re-run `--runInBand`, they pass 4 / 4 suites, 161 / 161 tests
- Guards (`ownerLanguageFirstFrame`, `themePrepaint`, `paymentHold`, `enforcementPoints`, `tierLiteral.forbidden`, `dictionariesStayInStep`, `lazyDialogs`, `upgradeModal`, placement, demo): 10 / 10 suites, 348 / 348 tests
- `npm run lint:hooks`: clean
- Screenshots 2 and 6 inspected: lock band, badge, not-offered state and phone layout are as specified

### Code Approved for QA: Yes (comments 2 and 3 go to UM-3)

---

## QA Testing Report

**QA — 2026-10-20** (automated pass; worktree `neuronforge-upgrade-modal-um2`, UM-1b tip `2bde7a81` + the uncommitted UM-2 diff, after SA's code review)
**Test mode:** full, automated only
**Strategy used:** A + B (Jest render suites through the real provider, the real PERF-1 loader, the real `StandaloneUpgradeModal` and real payloads; routes faked at `fetch`, Stripe at its modules; guards) and a review of Dev's static 360 px headless renders. D (the browser run) is the user's end-of-stream session (UD-UM2-3)
**Focus:** ui, security (demo switch, one checkout per page), performance (one read per open)
**Skipped:** every live check (sign-in, keys, purchases, real 3-D Secure, the running demo page): batched into the end-of-stream run. No agent signed in or handled a key
**Input source:** prompt keywords (TL brief) + workplan §11 / §13, SA X-1 to X-9

### Runs

| Run | Result |
|---|---|
| `components/business-os/settings` + `components/business-os/__tests__` + `app/business-os` + `app/test-business-os` + `components/test-business-os` + guards `ownerLanguageFirstFrame`, `tierLiteral.forbidden`, `creditFigures.fromConfig`, `enforcementPoints`, `dictionariesStayInStep`, `themePrepaint`, `paymentHold` (the set includes `lazyDialogs`, `settingsDeepLinks`, `planPrefetch`, `upgradeModal.guard`, `upgradeModalProvider.placement`, `upgradeModalDemo.guard`). Dev's tree, default workers | 72 / 77 suites, 1,641 / 1,657 tests. **All 16 failures were load timeouts** (suites ran 2–4× their normal time while SA ran in parallel; SA saw the same). The 5 suites re-run alone: **5 / 5, 174 / 174** |
| Same set + QA's new file, `--maxWorkers=4` | **78 / 78 suites, 1,672 / 1,672 tests** (1,657 + QA's 15) |
| Each guard named in the brief | `lazyDialogs`, `ownerLanguageFirstFrame`, `tierLiteral`, `creditFigures`, `enforcementPoints`, `dictionariesStayInStep`, `settingsDeepLinks`, `planPrefetch`: all PASS (plus `themePrepaint`, `paymentHold`, `upgradeModal.guard`, placement, demo guard) |
| New `components/business-os/settings/__tests__/upgradeModal.um2.qa.render.test.tsx` | **15 / 15** (14 QA cases + the fixtures' self-check); `npx eslint` clean |
| `npm run test:bos-entitlements` | **301 / 301 suites, 9,131 / 9,131 tests** (Dev's ENOENT race did not recur) |
| `npm run lint:hooks` | Clean (exit 0, `--max-warnings 0`) |
| Where the demo switch is read | Only `lib/business-os/upgradeModalDemoFlag.ts`, called only by the server `page.tsx`. The client child and the harness tab name it in prose only. No `NEXT_PUBLIC_` variant. The only link to the page is the harness tab |

### Test Coverage

| Acceptance point | Tested? | Result | Evidence |
|---|---|---|---|
| Demo page 404s with the switch off; on → the client demo | ✅ | Pass | **QA added** a behaviour test: `page()` with the switch unset, `''`, `false`, `off` calls `notFound()`; `true` returns `UpgradeModalDemo` (control). Source pins: `upgradeModalDemo.guard` (first statement, `force-dynamic`, default off, planted controls) |
| Switch is server-side only | ✅ | Pass | Demo guard + QA grep (row above) |
| Provider opens per context (`settings`, `locked_feature`, `founding_partner`) | ✅ | Pass | Provider and standalone suites; **QA added** the demo client inside the real provider: its buttons open the real window with their context |
| Refused while the Settings drawer is open (UM-SA2) | ✅ | Pass | `UpgradeModalProvider.render` "never over the Settings drawer": refused, one `debug` line, nothing portals, no GET; works after unmount. Jest only, by design (X-5) |
| One read per open, none at page load, StrictMode one | ✅ | Pass | Provider suite; **QA added**: the demo reads once on mount (StrictMode too), and every open adds exactly one read (1 → 2 → 3) |
| Close / reopen: fresh read, nothing carried over | ✅ | Pass | Provider suite "reopen"; **QA added**: failed read → Escape → reopen shows the table; a slow read closed before it answers leaves nothing behind |
| Read states: loading (never blank, `aria-busy`), failed (unavailable), server problem; closable in each | ✅ | Pass | Standalone suite; the QA cases above |
| `locked_feature`: lock, "This needs {plan}" (the payload's name), "Needed for this" badge (not "Recommended") | ✅ | Pass | Standalone + `upgradeModalView.context`; he / es badge |
| `locked_feature` with a plan not offered: the not-offered line, no button | ✅ | Pass | Standalone "AC-UM9" |
| `locked_feature` with an unknown id or the current plan: settings copy, no lock, no badge, no not-offered line | ✅ | Pass | View suite; **QA added** the rendered fallback through the provider |
| Founding Partner, no end date: no buy button anywhere (AC-UM5) | ✅ | Pass | Standalone + view, under `founding_partner` and `locked_feature` |
| Founding Partner with an end date: "Keep everything you have" + Choose | ✅ | Pass | Standalone; **QA added** the Hebrew (RTL) case |
| Checkout from the standalone window hands off to Settings → Plan (UM-SA10, C-12) | ✅ | Pass | Standalone "a checkout returns to Settings → Plan": the window closes and `router.replace(settings plan + marker)` in one act, then `PlanSection` shows "Payment processing"; one provider ever |
| Upgrade stays in the window: "Upgrading…" → "You're on" only after the re-read; failed re-reads never claim it; 3-D Secure busy lock; Q-12 landing | ✅ | Pass | Standalone suite |
| Hebrew RTL / Spanish | ✅ | Pass | Standalone he / es; QA Hebrew `founding_partner`; `dictionariesStayInStep` |
| Keyboard / focus / Escape | ✅ | Pass | **QA added**: Enter on the caller opens, focus moves into the window, Escape closes, focus returns to the caller. Provider suite: focus back after "Back to your plan" |
| No dead button under any context | ✅ | Pass | Standalone `it.each` (4 contexts × 3 accounts) |
| UM-1b drawer suites unmodified after the `PlanFlowStatus` move | ✅ | Pass | All green in the 78-suite run |
| 360 px | ⚠️ | Static pass | Dev's headless shots 6–8 re-viewed by QA (`scratchpad/um2-shots/`): lock header, "Needed for this" chip, Upgrade button, Hebrew RTL columns and dark mode all read correctly. In shot 8 the not-offered line is below the fold (SA comment 2, carried to UM-3). Real 360 px: run sheet |
| Row 20 (c) in the real layout, real 3-D Secure, the running demo page | ⚠️ | Deferred | End-of-stream run, rows below |

### Issues Found

#### Bugs (must fix before commit)
None found by QA.

#### Performance Issues (should fix)
None. One read per open, none at page load; the demo adds one read on its own mount (X-7).

#### Edge Cases (nice to fix)
1. **Not-offered line below the fold**: `UpgradeModal.tsx`, Low here. Already SA comment 2 (required in UM-3). QA confirms that it also happens at 360 px (shot 8).
2. **The `locked_feature` demo picker lists the owner's own plan**: `UpgradeModalDemo.tsx` (test UI only), Low. Picking it opens the `settings` copy. That fallback is correct and tested. Not a defect; the run sheet now says what to expect.

### End-of-stream run sheet (UM-1b §14 is the master)

UM-1b workplan §14 is the master sheet. In the same session, the user runs **§14 first (S-1 to S-16), then this workplan's §13 (U2-1 to U2-9)**. QA records both, ticks row 20 (b) from §14, and ticks row 20 (c) from U2-1 and U2-1p. QA revisions to §13:

| Row | Revision |
|---|---|
| U2-1 | Desktop on **Trial A** (Essentials after S-2; S-13 and S-16 do not buy). The 360 px run becomes a separate row, **U2-1p**, on **Trial D**, because an account can upgrade only once |
| U2-2 | Needs a fourth trial account, **Trial D**: A, B and C have all bought by then. Trial D ends as Essentials, so it then serves U2-1p |
| U2-3 | Picking the plan the account is already on shows "Compare our plans" with no lock (the fallback, by design). Every other plan shows "This needs {plan}" |
| U2-4 | Use the S-12 account |
| U2-5 | Opens only and buys nothing, so the end date survives for a re-run |
| U2-8 | Run last, after every other row (it switches the demo off) |

### Test Outputs / Logs
```text
Run 1 (default workers, SA in parallel): Test Suites: 5 failed, 72 passed, 77 total  Tests: 16 failed, 1641 passed, 1657 total  (all timeouts)
Re-run of the 5 alone:                   Test Suites: 5 passed, 5 total               Tests: 174 passed, 174 total
Run 2 (--maxWorkers=4, + QA file):       Test Suites: 78 passed, 78 total             Tests: 1672 passed, 1672 total
upgradeModal.um2.qa.render.test.tsx      Tests: 15 passed, 15 total
test:bos-entitlements                    Test Suites: 301 passed, 301 total           Tests: 9131 passed, 9131 total
lint:hooks                               exit 0 (--max-warnings 0)
```

### Final Status
- [ ] All acceptance criteria pass — ready for commit
- [x] Automated criteria pass and no bugs were found. SA has approved the code. **Ready for the user's diff view.** Go-live row 20 (c) is UM-2's merge gate. It is recorded only in the end-of-stream run (U2-1 / U2-1p)

---

## Commit Info

| Item | Value |
|---|---|
| Branch | `feature/bos-upgrade-modal-um2` (from UM-1b tip `2bde7a81`), pushed to `origin` |
| Code commit | `357c1105` feat(business-os): open the plan comparison modal from anywhere (UM-2) |
| Docs commit | `e85d8c91` docs(business-os): UM-2 workplan, SA/QA records; requirement incl. UM-D3 decision; test page scope + feature flags docs |
| PR | Not opened. Chained branches; PRs are opened in order, based on `main`, after the user's end-of-stream live session (SA Q-9). Go-live row 20 (c) is the merge gate |
| Pre-commit runs | settings + Business OS + app/business-os + test-business-os: 71 / 71 suites, 1,372 tests; the 8 named guards 8 / 8, 298 tests; `test:bos-entitlements` 301 / 301, 9,131 tests; `lint:hooks` clean. No secrets; no blanked file |
| Excluded | `docs/workplans/BUSINESS_OS_UPGRADE_MODAL_UM3_WORKPLAN.md` (next slice, left untracked) |

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-20 | Created | Dev workplan for UM-2 from the UM-1b worktree (UM-1b built, uncommitted, under review). The open contract: `UpgradeModalProvider` in the Business OS layout (inside `LanguageProvider` and `CapabilitiesProvider`), `useUpgradeModal().openUpgradeModal(context)` with the three-member union, a lazy `StandaloneUpgradeModal` (third `createLazyDialog`, `lazyDialogs.guard` amended) that reads once per open and runs its own `usePlanFlow`, "Upgrading…" / "You're on" in the window body via a moved `PlanFlowStatus`, checkout handing off to Settings → Plan (UM-SA10), refusal while the Settings drawer hosts its own instance (UM-SA2). Variants: `locked_feature` (lock header, the caller's plan highlighted: override O-1 of UM-SA4 / C-10 for this context only; a not-offered line) and `founding_partner` (only on `free_access` + an offer, else `settings` copy). Demo: a switch-gated page inside `app/business-os/` linked from a new harness tab, since `/test-business-os` has no Business OS providers (SA Q-1). +5 copy keys with he / es drafts, end-of-stream rows U2-1 to U2-7 (row 20 (c)), 11 SA questions. Estimate ≈ 2.05 d. Status: Planning |
| 2026-10-20 | SA workplan review | Approved with conditions X-1 to X-9. Q-1: D-A is accepted. It is a server page with `force-dynamic`, a default-off server switch, and `notFound()` before render, following the TC-1 flag precedent. It is not admin-gated, and the reason is recorded. Q-2: a distinct "Needed for this" badge. Q-3: Dev's copy is accepted. Q-10: UM-FR9 supersedes §5.3. Q-9: chained local branches, every PR based on `main`, opened in order after the end-of-stream run, merge commits only. O-1 is recorded as UM-BQ4's locked-action clause, not as an override. Other conditions: the read state as a discriminated prop, the inline host in a ref, U2-6 reworded |
| 2026-10-20 | Implemented (Dev), uncommitted | User decisions UD-UM2-1 to UD-UM2-3 recorded (he / es approved as drafted; distinct "Needed for this" badge; live checks batched, rows U2-1 to U2-9). Built: `upgradeModalContext.ts`, `UpgradeModalProvider.tsx` (open / refuse / closing grace / inline host in a ref), lazy `StandaloneUpgradeModal.tsx` (third `createLazyDialog`), `PlanFlowStatus.tsx` moved verbatim from `PlanSection`, `UpgradeModal` optional `context` / `afterUpgrade` / `flowStatus` / discriminated read state, `upgradeModalView(plan, context)` variants and O-1, layout placement, switch-gated demo page + flag + harness tab, +6 copy keys. Guards: `upgradeModal.guard` (p)–(s), `lazyDialogs.guard` 2 → 3, new placement and demo guards. X-1 to X-9 met; deviations D-1 to D-7; findings N-1 to N-3. Runs: 90 / 90 suites, 1,760 tests; `test:bos-entitlements` 9,130 / 9,131 (one ENOENT race, re-run green); `lint:hooks`, eslint, scoped tsc clean. Screenshots `scratchpad/um2-shots/` 1–8. Status: Code Complete |
| 2026-10-20 | SA code review | Code Approved for QA. X-1 to X-9 verified. D-1 to D-7 accepted. SA fixed the `FEATURE_FLAGS.md` header version (1.12.0). Carried to UM-3: N-1, the not-offered line below the fold (Medium, required there), and the "Back to your plan" footer label off Settings (Low). Runs: settings + guards green (4 load timeouts when run in parallel, green with `--runInBand`), `lint:hooks` clean |
| 2026-10-20 | QA (automated) | No bugs. 78 / 78 suites, 1,672 tests (first parallel run: 16 load timeouts, all green when re-run). `test:bos-entitlements` 301 / 9,131, `lint:hooks` clean. QA added `upgradeModal.um2.qa.render.test.tsx` (15 tests): the demo page 404 behaviour, the demo inside the real provider (one read per mount and per open), keyboard, Escape and focus, failed and slow reads then reopen, `locked_feature` fallbacks, Hebrew `founding_partner`. Run sheet: UM-1b §14 is the master, then U2-1 to U2-9, with QA revisions (U2-1p, Trial D). Row 20 (c) is deferred to the end-of-stream run |
| 2026-10-20 | Committed (RM) | Code `357c1105`, docs `e85d8c91` on `feature/bos-upgrade-modal-um2`, pushed; no PR (opened after the end-of-stream run) |
