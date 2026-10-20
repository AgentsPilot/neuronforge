# Workplan: Business OS Upgrade Modal, UM-1b "Buy and upgrade in the modal"

> **Last Updated**: 2026-10-20

**Developer:** Dev
**Requirement:** [BUSINESS_OS_UPGRADE_MODAL_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_UPGRADE_MODAL_REQUIREMENT.md) (SA C-1 to C-14; SA re-review UM-D1 C-15 to C-28; UM-SA4 / C-10 amended per UM-BQ4)
**Previous slice:** [UM-1a workplan](/docs/workplans/BUSINESS_OS_UPGRADE_MODAL_UM1A_WORKPLAN.md) (PR #483, auto-merging). UM-0 merged (#480)
**Date:** 2026-10-20
**Status:** Code Complete (uncommitted, 2026-10-20). Workplan SA-approved with conditions W-1 to W-8; user decisions 2026-10-20 recorded in § Implementation Notes. Awaiting SA code review; the live sandbox checks are batched into the user's end-of-stream run (§14)
**Branch:** `feature/bos-upgrade-modal-um1b`, created by RM from the UM-1a branch tip `9dd18562`. Worktree `neuronforge-upgrade-modal-um1b` (its `node_modules` is a junction to the main checkout: never delete it, never `git stash`, never switch branches). Merge `origin/main` once #483 lands, then re-run the checkpoint (Task 0)
**Path:** **Not** the short path, and no fast-track (C-14, UM-SA11). SA code review, then the QA sandbox run (buy, upgrade, 3-D Secure, checkout return, §14), then the user sees the diff, then RM. Go-live row 20, extended (C-11, §15), is a **merge gate**: the PR may open, but auto-merge stays off until that row is recorded

## Overview

UM-1b turns the plan comparison window from view only into the place where an owner buys or upgrades. Each plan column gets the server's action under its price and again at its foot: "Choose {plan}", "Pay for {plan}", "Upgrade to {plan}", a "Coming soon" chip, or the non-interactive "Current plan" label. Pressing either button of a column replaces the table area with that plan's flow: the embedded Stripe checkout, or the upgrade preview with Confirm. Both flows reuse the existing islands, `PlanPurchase` and `PlanUpgrade`, and their requests and payloads are unchanged (UM-FR4). The islands leave the Settings drawer. The drawer keeps what you are on, billing problems and what is included (B1 to B9), and gets a "See plans" button ("Compare plans" when nothing is offered). When Stripe completes a checkout, or an upgrade goes through, the modal closes and the drawer shows "Payment processing" or "Upgrading…" (B5 / B6), from the one `usePlanFlow` instance UM-1a extracted. While Confirm or 3-D Secure is in flight the modal cannot be closed. No route, no payload, no migration and no entitlements import changes.

---

## Table of Contents

1. [Scope and binding conditions](#1-scope-and-binding-conditions)
2. [Analysis summary](#2-analysis-summary)
3. [Implementation approach](#3-implementation-approach)
4. [Buttons per column, per account state](#4-buttons-per-column-per-account-state)
5. [How a column button reaches the island](#5-how-a-column-button-reaches-the-island)
6. [The flow area (C-25)](#6-the-flow-area-c-25)
7. [Busy lock and onBusyChange (UM-FR11)](#7-busy-lock-and-onbusychange-um-fr11)
8. [Hand-off to the drawer, and the drawer button](#8-hand-off-to-the-drawer-and-the-drawer-button)
9. [Copy keys (en / he / es)](#9-copy-keys-en--he--es)
10. [Files to create / modify](#10-files-to-create--modify)
11. [Task list and estimate](#11-task-list-and-estimate)
12. [Test plan](#12-test-plan)
13. [Existing assertions moved: old → new (C-5)](#13-existing-assertions-moved-old--new-c-5)
14. [QA sandbox run sheet](#14-qa-sandbox-run-sheet)
15. [Go-live row 20, proposed text (C-11)](#15-go-live-row-20-proposed-text-c-11)
16. [Logging](#16-logging)
17. [Risks](#17-risks)
18. [Open questions for SA](#18-open-questions-for-sa)
19. [Needs the user](#19-needs-the-user)
20. [SA Review Notes](#sa-review-notes)
21. [QA Testing Report](#qa-testing-report)
22. [Commit Info](#commit-info)
23. [Change History](#change-history)

---

## 1. Scope and binding conditions

**Approved scope (SA slicing table, verbatim):**
> **UM-1b — Buy and upgrade in the modal.** Islands move, "See plans" label, busy lock, hand-off on `onComplete` / `onUpgrading`, test migration (C-5), sandbox QA incl. 3-D Secure — 2 d

Re-estimated by SA in the UM-D1 re-review (a): **2.25 d** ("one island behind two triggers per column").

| Condition | How UM-1b meets it |
|---|---|
| **C-2** One flow owner | The modal uses the same `usePlanFlow` instance as the drawer (passed down from `PlanSection`). Two new derived values, `checkoutAllowed` and `upgradeAllowed`, are **moved** into the hook from the island mount conditions in `PlanSection` (§8.3); they do not exist anywhere else afterwards. Guard (c) is extended to pin them |
| **C-3** Child of `SheetContent`, shared flow, no read, closes on `onComplete` / `onUpgrading` | Unchanged placement (rendered by `PlanSection`). The modal wraps the island callbacks: flow callback first, then close (§8.1). Still no `readMyPlan` / `fetch` in `UpgradeModal.tsx` or `upgradeModalView.ts` (guard (b) unchanged) |
| **C-5** Island test ids kept; moved assertions mapped | No island test id is renamed or removed. Every assertion that pressed a drawer island button now opens the modal and presses the column button; mapped in §13. None deleted without a replacement |
| **C-6** Zero entitlements imports | No new import. `ENDS_FREE_ACCESS_KEYS` moves to `planPurchaseCopy.ts` (D-4), which imports types only |
| **C-7** No tier literal | Columns, labels and offers are server ids compared by equality. Tier ids only in `__tests__` |
| **C-8** `dialog.tsx` unchanged | Unchanged. The X is refused by the `onOpenChange` gate while busy and dimmed by a child selector (§7) |
| **C-11** Go-live row 20 extended; merge gate | Proposed text in §15 for TL. QA's sandbox run (§14) produces the evidence; auto-merge off until the row is recorded |
| **C-12** Islands never in drawer and modal at once | `PlanSection.tsx` no longer imports or renders `PlanPurchase` / `PlanUpgrade`. Inside the modal, the island mounts only after a column button is pressed, and only one flow exists at a time (`flow` state, §6). Guard (a) is inverted: islands only in `UpgradeModal.tsx`, never in `PlanSection.tsx` |
| **C-13** `text-red-700` → `--v2-error-text` in `PlanPurchase` and `PlanUpgrade` only | Four lines: `PlanPurchase.tsx:172`, `PlanUpgrade.tsx:403, 411, 453`. `PlanEmbeddedCheckout.tsx:159` **stays** `text-red-700` (it also renders on `/invite/awaiting-payment`, outside the theme provider) |
| **C-14** SA code review + QA sandbox before the user diff; no fast-track | Header "Path" |
| **C-22** "Current plan" only when nothing is offered for the current column | Unchanged rule; the offered slot now holds the server's button. "Pay for" on an admin-assigned tier (Q-5) |
| **C-25** Flows replace the table area; two buttons, one island instance; "Back to plans" only where §4.5 allows | §6. "Back to plans" hidden during Confirm, 3-D Secure and "Could not confirm" |
| **UM-FR3** A button exactly for `offer.tiers` / `upgrade.tiers`; "Coming soon" for shown-not-offered; never a dead button | §4. See SA Q-1 below on "Coming soon" in the choose context |
| **UM-FR4** Islands reused, requests unchanged | Optional props only (§5). The checkout still POSTs `{ tier, returnTo: 'settings_plan' }`; the upgrade still POSTs `{ tier }` and `{ tier, prorationDate }` |
| **UM-FR5 / FR6** Return and upgrade success from the server only | Unchanged: B5 / B6 stay in the drawer, driven by `usePlanFlow` |
| **UM-FR11** Close always available except Confirm and 3-D Secure | §7 |
| **UM-1a carry-overs** | Q-6: `view_only_note` removed (§9). Q-8: visual and focus order agree (§6.4). Q-10: C-13 lands here. D-4: `ENDS_FREE_ACCESS_KEYS` moved to `planPurchaseCopy.ts`. QA edge 2: an `action_required` (3-D Secure renewal) payload driven through the modal (§12) |

**Not in UM-1b:** the provider and `useUpgradeModal` (UM-2, C-4); `locked_feature` / `founding_partner` headlines (UM-2); English sr-only "Close" in he / es, muted-text contrast, the long phone headline (UM-3); returning to the page the modal was opened on (UM-F3).

---

## 2. Analysis summary

Read on the branch tip `9dd18562` (UM-1a as built).

| Area | Finding |
|---|---|
| `PlanSection.tsx` | Renders `PlanUpgrade` when `marker === null && !upgradeWatching && !upgradeSucceeded && upgrade.tiers.length > 0 && plans.length > 0`, and `PlanPurchase` when `marker === null && offer.kind === 'choose' && plans.length > 0`. "Compare plans" is last, hidden while `processing` or without a `comparison`. Holds `compareOpen` state; no new effect may be added before the `[language]` effect (pg8) |
| `usePlanFlow.ts` | One instance per `PlanSection`; returns `marker`, `succeeded`, `processing`, `upgradeSucceeded`, `upgradeWatching`, `exhausted` and the three callbacks |
| `upgradeModalView.ts` | `action: 'offered' \| 'current_label' \| 'none'`. "Offered" merges choose and upgrade, so UM-1b must split it to pick the island and the label |
| `UpgradeModal.tsx` | `ActionSlot` renders an empty `<span aria-hidden>` for `'offered'`. `plan-compare-table-area` is the element to swap. Footer: prices, free-access sentence, B7, `view_only_note`, "Back to your plan" (`DialogClose`). Focus return to the opener done by hand (D-1) |
| `PlanPurchase.tsx` | List of every plan; the Choose button **is** `PlanEmbeddedCheckout`'s own start button (`testId plan-choose-{id}` → `-start`, `-frame`). Once a frame opens the other rows' buttons go away. Not-offered rows read "Coming soon". On Stripe `onComplete`: `onComplete(sessionId)` then `router.replace(settingsPlanReturnPath(sessionId))` |
| `PlanEmbeddedCheckout.tsx` | Owns the start button, the POST and the Stripe provider. Shared with `/invite/awaiting-payment` and the `/test-business-os` harness. No way to start it from outside today |
| `PlanUpgrade.tsx` | Owns the "Upgrade to {plan}" button and phases `idle → previewing → quoted / awaiting → confirming → authenticating → declined / not_confirmed / unknown / refused`. `busy = confirming \|\| authenticating`. 3-D Secure: `stripe.handleNextAction`, which mounts Stripe's challenge on `document.body`. Hooks are declared before its `if (offered.length === 0) return null` |
| `SettingsDrawer.tsx` | The busy shape to copy: `onOpenChange(false)` ignored, `onEscapeKeyDown` / `onInteractOutside` `preventDefault`, X disabled, `aria-busy` |
| Checkout replacing an open session | `planCheckout.ts` step 9 (M-3): the account's own unexpired session is expired and replaced, so "Back to plans" then Choose again is not blocked for 31 minutes |
| Tests driving the islands | All through `PlanSection` or the real settings page: `PlanPurchase.render` (31 tests), `PlanUpgrade.render` (36), `PlanSection.prefetch.render`, `PlanDrawer.prefetch.render`, `UpgradeModal.render`, `UpgradeModal.qa.render`, `upgradeModal.guard`. None renders an island directly |
| Go-live row 20 | Plan payments §9.5 row 20 covers the drawer only, and is unticked (☐) |
| DB / routes | None touched |

---

## 3. Implementation approach

1. **Spike first (Task 1).** The single largest risk is the 3-D Secure challenge, which Stripe mounts on `body` outside the Radix layers (R-1). Before building the rest, QA and Dev run the test card through today's drawer and through a throwaway modal-over-drawer stack in the sandbox, and record what happens (clickable, typeable, focus kept, closes cleanly). The answer decides whether a mitigation is needed and which (§17, SA Q-7).
2. **Islands gain optional props only.** Each island keeps its default behaviour for every existing caller; the modal passes a start tier (§5). No request, payload or test id changes.
3. **The view decides the button kind from server data.** `upgradeModalView` splits `'offered'` into `'choose' | 'pay_for' | 'upgrade'`, with the same id-equality rules UM-1a uses. The component renders it.
4. **One flow at a time.** The modal holds `flow: null | { kind: 'checkout' | 'upgrade'; planId }`. `null` shows the table; anything else shows that plan's island in the table area.
5. **The drawer stays the account home.** After the hand-off, B5 / B6 render exactly as today, from the same hook.

---

## 4. Buttons per column, per account state

Every label below comes from the server's offer and the plan names in the payload; no tier id is written in product code. Both buttons of a column are the same button twice (header under the price, footer at the foot) and start the same flow.

**Rule (in `upgradeModalView`):**

| Column `action` | When (server data only) | Button | Opens |
|---|---|---|---|
| `upgrade` | `planId ∈ purchase.upgrade.tiers` | "Upgrade to {plan}" (`plan.upgrade.button`) | Upgrade flow |
| `pay_for` | `offer.kind === 'choose'`, `planId ∈ offer.tiers`, and the account is on that tier (`kind === 'tier' && planId === plan.planId`) | "Pay for {plan}" (`plan.choose.button_own`) | Checkout flow |
| `choose` | `offer.kind === 'choose'`, `planId ∈ offer.tiers`, otherwise | "Choose {plan}" (`plan.choose.button`) | Checkout flow |
| `current_label` | The current tier column with none of the above | Non-interactive "Current plan" (C-22) | — |
| `none` | Everything else | Nothing, or the "Coming soon" chip (SA Q-1) | — |

If one plan id were in both `offer.tiers` and `upgrade.tiers` (the server makes them exclusive: choose needs no live subscription, upgrade needs one), `upgrade` wins and a unit test pins it (SA Q-3).

**Gates that are not about the plan** (today's rules, kept):

| Gate | Today | In the modal |
|---|---|---|
| A payment or upgrade is landing | Islands not mounted while `marker !== null` (both) or `upgradeWatching` / `upgradeSucceeded` (upgrade) | "See plans" is hidden while `processing` (UM-1a). When it is open in the other cases (for example after a successful return, marker still on the URL), the column buttons render only when the hook's `checkoutAllowed` / `upgradeAllowed` allow it; otherwise the slot is empty, as in UM-1a (SA Q-4) |
| No usable publishable key (M-2) | `PlanPurchase` shows "Payments are not set up on this site yet." and no Choose | Choose / Pay for columns show that line (`plan.choose.not_configured`, muted) in the slot instead of a button. Upgrade columns keep their button: today the preview still runs and the island shows the line in place of Confirm |
| `purchase: null` / switches off | Nothing offered | Nothing offered: no button anywhere |

**Per §2.2 state** (two shown plans: the lower tier `LOWER` = Essentials, the top tier `TOP` = Autopilot, in server order):

| Account state | `LOWER` column | `TOP` column | Notes in the footer (table view) |
|---|---|---|---|
| Trial (Test Flight) | Choose Essentials | **Choose Autopilot** (Recommended) | "Buying ends your free trial today…" + B7 |
| Founding Partner, no end date | — | — | none (BQ-P10: nothing offered) |
| Founding Partner, end date set | Choose Essentials | **Choose Autopilot** (Recommended) | "Buying ends your free access today…" |
| No plan / paused / ended | Choose | **Choose** (Recommended) | As sent |
| Essentials, renewing | "Your plan" + Current plan | **Upgrade to Autopilot** (Recommended) | — |
| Essentials, cancelling | "Your plan" + Current plan | Upgrade only if the server offers it, else — | — |
| Autopilot, renewing | — (on sale, not to them; no chip) | "Your plan" + Current plan | — |
| Payment failed / 3-D Secure on renewal | As the server sends (`upgrade` is normally null) | As sent | B3 / B4 stay in the drawer only (UM-1a QA test kept) |
| Admin-assigned tier, no Stripe billing (Q-5) | "Your plan" + **Pay for Essentials** | **Choose Autopilot** (Recommended) | The own-plan note (`plan.choose.own_plan_note`), §6.3 |
| Paying lower tier, admin-assigned top tier (upgrade own-plan note) | Upgrade column is the current column: "Your plan" + **Upgrade to Autopilot** | — | `plan.upgrade.own_plan_note` |
| Shown, not offered, `availableToBuy = false` | "Coming soon" + the server's reason on the `nextPlanUp` column | | |
| Stripe key missing | "Payments are not set up…" in Choose slots | Upgrade button kept | |
| Just paid / just upgraded | "See plans" not on screen (B5 / B6 in the drawer) | | |
| Held invitee | Never reaches Settings | | |

---

## 5. How a column button reaches the island

SA (g) left this to the workplan: "a minimal start prop, requests and payloads unchanged".

### 5.1 Proposal A (recommended): a start prop on each island

| Component | New optional prop | Behaviour when set | Default (all current callers) |
|---|---|---|---|
| `PlanEmbeddedCheckout` | `autoStart?: boolean` | Calls its own `start()` once on mount, from an effect guarded by a ref (the C-b pattern: StrictMode's second effect run starts nothing). Same POST, same body. The start button is still rendered and shows `labels.starting` while the POST runs, and comes back after a refusal so the owner can retry | `false`: the holding screen and the harness are unchanged (guard pins that neither passes it) |
| `PlanPurchase` | `startTier?: string` | Renders only that plan's row (still only if it is in `tiers`), with its own-plan note and the free-access sentence, and passes `autoStart` to its `PlanEmbeddedCheckout`. Heading "Choose a plan" not shown in this mode (the flow area names the plan) | undefined: the full list, as today |
| `PlanUpgrade` | `startTier?: string`, `onBusyChange?: (busy: boolean) => void`, `onCancel?: () => void` | Renders only that tier's row and runs `preview(startTier)` once on mount (ref-guarded; the existing `inFlight` ref also refuses a second POST). "Not now" calls `onCancel` after resetting the phase, so the modal goes back to the table. `onBusyChange` reports `confirming \|\| authenticating` (§7). After declined / not confirmed / refused, the island's own "Upgrade to {plan}" button shows again inside the flow area, as today, so a retry needs no trip back | undefined: as today |

Why A: one press does what one press does today (Choose posts the checkout; Upgrade posts the preview). The column buttons are plain modal buttons, so header and footer can both exist without two island instances (C-12, C-25). The props are additive and every existing caller ignores them.

**Hooks order in `PlanUpgrade`:** the new effects (auto-preview, busy report) are declared with the other hooks, before `if (offered.length === 0) return null`.

### 5.2 Fallback B (no island change)

The column button only opens the flow area, which mounts the unchanged island filtered to that one plan, and the owner presses the island's own "Choose {plan}" / "Upgrade to {plan}" a second time. Zero change to `PlanEmbeddedCheckout`, but two presses with the same label, one after the other. Offered only if SA prefers not to touch the shared checkout component (SA Q-2).

---

## 6. The flow area (C-25)

### 6.1 State

`UpgradeModal` holds `const [flow, setFlow] = useState<{ kind: 'checkout' | 'upgrade'; planId: string } | null>(null)`. A column button sets it; "Back to plans" and the island's "Not now" reset it; closing the modal resets it (the island unmounts with the content). Only one flow exists at a time, so only one island and at most one Stripe Embedded Checkout are mounted (C-12).

### 6.2 Layout

`plan-compare-table-area` renders either the table (UM-1a) or, when `flow !== null`, `data-testid="plan-compare-flow"`:

| Part | Content |
|---|---|
| "Back to plans" | A text button with a directional chevron (mirrored in RTL), `data-testid="plan-compare-back"`. Shown only when the flow allows it (below) |
| Heading | `h3` (the region's `aria-labelledby`): the plan name, then `plan.choose.price_ex_tax` ("$79 a month, excluding tax"); prices in digits and USD |
| The island | `PlanPurchase startTier=…` or `PlanUpgrade startTier=…`, with the modal's wrapped callbacks (§8.1). Full width of the modal body; on a phone the modal is full screen, so the Stripe frame gets the whole width |

The status strip stays above the area. The sticky table header does not apply (no table). The footer keeps "Prices in USD, excluding tax." and the close button; the free-access sentence and the own-plan note move into the island in a flow (both islands already render them), so the footer drops them while a flow is open.

**"Back to plans" is hidden** (§4.5, C-25) when the upgrade island reports busy (Confirm, 3-D Secure) and when its phase is "Could not confirm". The island reports that phase through the same callback as busy, as a second value: `onBusyChange(busy)` plus `onUnsureChange(unsure)`, or one `onPhaseClass('idle' | 'busy' | 'unsure')` (SA Q-5 picks the shape; Dev proposes the single callback). In the checkout flow it is always shown: the server replaces an abandoned session (M-3).

### 6.3 Footer notes in the table view

| Note | When |
|---|---|
| `upgrade_modal.footer_prices` | Always |
| The free-access sentence (`plan.choose.trial_ends_today` / `free_access_ends_today`, keys from `planPurchaseCopy.ts` after D-4) | Something is offered and `endsFreeAccessOnPurchase` is set (UM-1a rule) |
| B7 `whenThisChanges` | When sent |
| Own-plan note (`plan.choose.own_plan_note` or `plan.upgrade.own_plan_note`) | A column's action is `pay_for`, or `upgrade` on the current column. New test id `plan-compare-own-plan-note`; the islands' own `plan-choice-own-plan-note` / `plan-upgrade-own-plan-note` remain inside the islands (C-5) |
| ~~`upgrade_modal.view_only_note`~~ | **Removed** (Q-6) |

### 6.4 Focus (Q-8 entry criterion)

- **Visual and focus order agree.** The table has one DOM order at every width (no CSS `order` since UM-D1). Tab order: header row buttons in column order, then footer row buttons, then the footer close. RTL mirrors through `dir`, so focus moves right to left as the columns do.
- **Initial focus is not a money button.** Radix would focus the first tabbable, which is now "Choose Essentials". `onOpenAutoFocus` (which already records the opener) also calls `preventDefault()` and focuses the dialog title container (`tabIndex={-1}`), so an Enter press right after opening starts nothing (SA Q-6).
- **Entering a flow** moves focus to the flow heading; **"Back to plans"** returns focus to the column button that opened the flow (header or footer, whichever was pressed).
- Focus return to "See plans" on close: unchanged (D-1).

---

## 7. Busy lock and onBusyChange (UM-FR11)

| Layer | While busy (the island reported `confirming` or `authenticating`) |
|---|---|
| `onOpenChange` gate | `UpgradeModal` ignores `onOpenChange(false)`; this also covers the built-in X, which calls it (C-8) |
| Escape | `onEscapeKeyDown` → `preventDefault()` |
| Outside press / focus | `onInteractOutside` → `preventDefault()` (covers `onPointerDownOutside` and `onFocusOutside`). This also stops a press on Stripe's 3-D Secure overlay, which lives outside the dialog, from dismissing it |
| The X | Dimmed and not pressable: `[&>button]:pointer-events-none [&>button]:opacity-40` added to `DialogContent` while busy (child selector, `dialog.tsx` unchanged). Keyboard activation still reaches the gate, which refuses it |
| "Back to plans" and "Back to your plan" | Hidden |
| `aria-busy` | On the flow region |

Shape copied from `SettingsDrawer` (`isBusy`), as UM-SA2 ruled. The busy value lives in `UpgradeModal` state, set only by `PlanUpgrade`'s `onBusyChange`; `PlanUpgrade` reports `false` from its effect cleanup, so an unmount can never leave the modal locked. The checkout flow never reports busy: once Stripe's frame is open nothing of ours is in flight, and closing is allowed as today (SA Q-8 asks whether an outside press should be refused while a frame is open, to protect a half-typed card).

The drawer beneath is not involved: Radix sends Escape and outside presses to the top layer only (UM-1a `UpgradeModal.layers`), so the drawer cannot close under a busy modal.

---

## 8. Hand-off to the drawer, and the drawer button

### 8.1 Callbacks

| Island event | Modal does | Drawer then shows |
|---|---|---|
| `PlanPurchase.onComplete(sessionId)` (Stripe completed) | `flow.onCheckoutComplete(sessionId)`, then close the modal. The island has already called `router.replace(settingsPlanReturnPath(sessionId))` in the same handler, as today | B5 "Payment processing" (marker from `completedSession`, then from the URL), the bounded re-read, then "You're on {plan}" or "taking longer" |
| `PlanUpgrade.onUpgrading(tier)` (upgraded, processing, 3-D Secure completed, or a re-read code) | `flow.onUpgrading(tier)`, then close | B6 "Upgrading…", the bounded re-read, then "You're on {plan}" (U-5) |
| `PlanUpgrade.onCheckAgain(tier)` ("Could not confirm" → Check again) | `flow.onUpgradeCheckAgain(tier)` (one re-read), modal stays open | — |
| The re-read shows the upgrade landed (the target is no longer in `upgrade.tiers`) while the flow is open | The flow can no longer render (`PlanUpgrade` returns `null` for a tier no longer offered), so `UpgradeModal` closes itself: one effect in `UpgradeModal` (not in `PlanSection`, so pg8 is untouched) watches "flow is `upgrade` and its tier is not in `upgrade.tiers`" | `upgradeSucceeded` ("You're on {plan}") from the hook, because `onUpgradeCheckAgain` set the target |
| Refusals, declined, not confirmed | Stay in the flow area (island's own lines, now `--v2-error-text`) | — |

Closing uses the same `onOpenChange(false)` path as the X, after the busy flag has cleared (the island reports `false` before it calls `onUpgrading`, because it sets the phase to `idle` first).

### 8.2 The drawer after UM-1b

`PlanSection` keeps B1 to B9, B5 / B6 and the free-plan notice, and **no longer imports or renders `PlanPurchase` / `PlanUpgrade`** (C-12). The button stays last in the section, under B9:

| Label | When | Key |
|---|---|---|
| **"See plans"** | The server offers something: any column action is `choose`, `pay_for` or `upgrade` (§5.1: `offer.kind = choose` or `upgrade.tiers` not empty; the admin-assigned "Pay for" counts) | `upgrade_modal.open_see_plans` (new) |
| "Compare plans" | Nothing is offered | `upgrade_modal.open_compare` (UM-1a) |

Visibility rule unchanged: `plans` non-empty, not `processing`, and a `comparison` from the server. The view gains `hasActions` for the label (computed once in `upgradeModalView`).

NextPlanUp's line "Available to choose." stays suppressed whenever a purchase view exists (unchanged), so the drawer never promises a choice that only the modal offers without pointing to it: the "See plans" button is the pointer.

### 8.3 `checkoutAllowed` / `upgradeAllowed`

Today these conditions sit in `PlanSection`'s JSX as island mount conditions: `marker === null` (checkout) and `marker === null && !upgradeWatching && !upgradeSucceeded` (upgrade). They move into `usePlanFlow` as two returned booleans and leave `PlanSection` (C-2: one copy). The payload halves (`offer.kind`, `tiers`, `plans`) are already in `upgradeModalView`. The modal receives the hook's values as props.

---

## 9. Copy keys (en / he / es)

New or changed keys in each dictionary's "Your plan" block. **He and es are drafts for the user's approval before merge** (batched into one question, §19). No figure in any value; `upgrade_modal.*` stays clear of the `noExclusions` phrasing (guard (i)).

| Key | Change | en | he (draft) | es (draft) |
|---|---|---|---|---|
| `upgrade_modal.open_see_plans` | **New** | See plans | הצגת התוכניות | Ver planes |
| `upgrade_modal.back_to_plans` | **New** | Back to plans | חזרה לתוכניות | Volver a los planes |
| `upgrade_modal.view_only_note` | **Removed** (Q-6) | ~~To choose or upgrade, go back to Your plan.~~ | ~~(removed)~~ | ~~(removed)~~ |
| `upgrade_modal.back_to_plan` | Kept (footer close, "Back to your plan") | — | — | — |

**Reused, unchanged:** `plan.choose.button`, `plan.choose.button_own`, `plan.choose.own_plan_note`, `plan.choose.price_ex_tax`, `plan.choose.not_configured`, `plan.choose.trial_ends_today`, `plan.choose.free_access_ends_today`, `plan.upgrade.button`, `plan.upgrade.own_plan_note`, and every key the islands already use. Net: +2, −1 = 18 `upgrade_modal.*` keys.

"Back to plans" (to the table) and "Back to your plan" (closes the window) differ by one word in English. If SA or the user finds that confusing, the footer button could read "Close" (`upgrade_modal.close`, new), at the cost of one more key (SA Q-9).

---

## 10. Files to create / modify

| File | Action | Reason |
|---|---|---|
| `components/business-os/billing/PlanEmbeddedCheckout.tsx` | modify | Optional `autoStart` (§5.1). Colour untouched (C-13) |
| `components/business-os/settings/PlanPurchase.tsx` | modify | Optional `startTier`; `text-red-700` → `text-[var(--v2-error-text)]` (C-13); `ENDS_FREE_ACCESS_KEYS` imported from `planPurchaseCopy.ts` (D-4) |
| `components/business-os/settings/PlanUpgrade.tsx` | modify | Optional `startTier`, `onBusyChange` (or the single phase callback, SA Q-5), `onCancel`; three `text-red-700` → `--v2-error-text` (C-13) |
| `components/business-os/settings/planPurchaseCopy.ts` | modify | Exports `ENDS_FREE_ACCESS_KEYS` (D-4) |
| `components/business-os/settings/upgradeModalView.ts` | modify | `action` split (`choose` / `pay_for` / `upgrade` / `current_label` / `none`), `ownPlanNote`, `hasActions`, choose-context "Coming soon" (SA Q-1) |
| `components/business-os/settings/UpgradeModal.tsx` | modify | Column buttons, flow area, "Back to plans", busy lock, hand-off, focus (§6–§8); takes the flow values and callbacks as props; imports the two islands |
| `components/business-os/settings/usePlanFlow.ts` | modify | Returns `checkoutAllowed`, `upgradeAllowed` (§8.3) |
| `components/business-os/settings/PlanSection.tsx` | modify | Islands removed; "See plans" / "Compare plans" label; flow props to the modal |
| `lib/business-os/translations/{en,he,es}.ts` | modify | +2, −1 keys |
| `components/business-os/settings/__tests__/PlanPurchase.render.test.tsx` | modify | §13 mapping; `CLIENT_FILES` unchanged list still holds |
| `components/business-os/settings/__tests__/PlanUpgrade.render.test.tsx` | modify | §13 mapping |
| `components/business-os/settings/__tests__/PlanSection.prefetch.render.test.tsx` | modify | §13 mapping (P-10 and the processing / done cases that press an island) |
| `components/business-os/settings/__tests__/PlanDrawer.prefetch.render.test.tsx` | modify | §13 mapping (D-8 re-shaped) |
| `components/business-os/settings/__tests__/UpgradeModal.render.test.tsx` | modify | View-only assertions inverted (§13); new flow / busy / focus tests |
| `components/business-os/settings/__tests__/UpgradeModal.qa.render.test.tsx` | modify | "money unchanged after open / close" re-pointed at the modal; `action_required` state added |
| `components/business-os/settings/__tests__/UpgradeModal.layers.test.tsx` | modify | Busy lock inside the drawer: Escape / backdrop / X refused while busy, the drawer stays open |
| `components/business-os/settings/__tests__/upgradeModal.guard.test.ts` | modify | Guard (a) inverted; new guards (l)–(o) (§12.3) |
| `components/business-os/settings/__tests__/upgradeModalView.test.ts` | modify | Per-state `action` kinds |
| `components/business-os/settings/__tests__/upgradeModal.flow.render.test.tsx` | create | The flow suite: one island instance, StrictMode single POST, hand-off, Back to plans, busy (§12.2) |
| `docs/requirements/BUSINESS_OS_UPGRADE_MODAL_REQUIREMENT.md` | modify | UM-1b workplan, SA ruling, PR / merge recorded (standing preference) |
| `docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md` §9.5 row 20 | **TL** edits | C-11, text in §15. Dev does not edit it |

**Not touched:** `components/ui/dialog.tsx`, `SettingsDrawer.tsx`, `app/business-os/settings/page.tsx`, `app/invite/awaiting-payment/HeldPaymentCheckout.tsx`, `components/test-business-os/PlanCheckoutPanel.tsx`, `planDrawerReads.ts`, every route, every billing / entitlements server file, the DB.

---

## 11. Task list and estimate

| # | Task | Est. |
|---|---|---|
| ✅ 0 | Merge `origin/main` after #483 lands (fast-forward or clean merge, no stash). Baseline run: settings + components + settings page + guards suites and `test:bos-entitlements`, recorded here | 0.1 d |
| 🟡 1 | **3-D Secure spike** — re-shaped by SA W-1 and the user (2026-10-20): **1a done** (jsdom probe, `UpgradeModal.layers`); **1b skipped by the user** (moved to the end-of-stream run). Original text:  with QA in the sandbox: today's drawer, and a throwaway modal-over-drawer stack (never committed). Record clickable / typeable / focus / close for the upgrade challenge and the checkout challenge. Result here; SA rules Q-7 if a mitigation is needed | 0.25 d |
| ✅ 2 | Island props (§5.1), C-13 colours, D-4 key map move | 0.35 d |
| ✅ 3 | `upgradeModalView`: action split, `ownPlanNote`, `hasActions`, choose-context "Coming soon"; `upgradeModalView.test` per state | 0.2 d |
| ✅ 4 | `usePlanFlow` `checkoutAllowed` / `upgradeAllowed`; `PlanSection` drops the islands, label rule, props to the modal | 0.15 d |
| ✅ 5 | `UpgradeModal`: column buttons, flow area, "Back to plans", busy lock, hand-off, focus, footer | 0.5 d |
| ✅ 6 | Copy keys en / he / es; `dictionariesStayInStep` | 0.05 d |
| ✅ 7 | Test migration (§13) across the seven suites | 0.5 d |
| ✅ 8 | New tests (§12.2, §12.3) incl. StrictMode single-POST and planted-violation controls | 0.25 d |
| ✅ 9 | Full runs: suites above, `npm run test:bos-entitlements`, `npm run lint:hooks`, `npx eslint` on touched files, `npx tsc --noEmit -p .`; `git diff --stat` / `--numstat` check (no deletion-only file) | 0.1 d |
| 🟡 10 | Requirement MD update ✅; row 20 text to TL ⬜ (§15, TL edits). Original text: Requirement MD update; hand TL the row 20 text (§15) | 0.05 d |
| | **Total** | **≈ 2.5 d** (SA: 2.25 d; the extra 0.25 d is the 3-D Secure spike, which de-risks the merge gate) |

The QA sandbox run (§14) is QA's time, not in this total.

---

## 12. Test plan

Payloads as in UM-1a: real `buildCustomerPlanView` + `readPlanPurchaseView`, through JSON (`upgradeModalPayloads.ts`). Stripe is the existing `@stripe/react-stripe-js` and `stripeJs` mocks.

### 12.1 Per state (`upgradeModalView.test`, `UpgradeModal.render`)

One case per §4 row: the column's `action` kind, the button's accessible name in header **and** footer (exactly two per offered column), "Current plan" ×2 only for `current_label`, "Coming soon" only per Q-1, the "not set up" line in Choose slots with no key, "See plans" vs "Compare plans". **No dead button:** every button in the modal is the X, the footer close, or a column button whose plan is in `offer.tiers` / `upgrade.tiers` (checked against the payload, never config).

### 12.2 Flow (`upgradeModal.flow.render`, new)

| Test | Assertion |
|---|---|
| Header and footer start the same flow | Pressing either replaces `plan-compare-table` with `plan-compare-flow`; one POST each time (`{ tier, returnTo: 'settings_plan' }` or `{ tier }` to the preview) |
| One island, one checkout (C-12) | After pressing Choose, exactly one `plan-choose-*` and one `fake-checkout` in the document; the drawer holds none; no other column button remains |
| StrictMode | Rendered in `<React.StrictMode>`: one checkout POST and one preview POST per press |
| Double press | Two quick presses on header + footer: one POST |
| Back to plans | Returns to the table; focus on the column button pressed; a second Choose replaces the session (POST again) |
| "Not now" in the quote | Back to the table |
| Busy | During Confirm and during 3-D Secure (`handleNextAction` held open): Escape, X, backdrop and `onOpenChange(false)` do nothing; "Back to plans" and "Back to your plan" absent; `aria-busy` set. After it settles: closable again |
| Could not confirm | "Back to plans" hidden; Check again posts no write and does one re-read; if that re-read shows the upgrade landed, the modal closes and the drawer shows "You're on {plan}" |
| Hand-off: checkout | `stripe.completes[0]()` → modal closed, `router.replace` with the return path, drawer `plan-purchase-processing`, never `plan-purchase-done` before the re-read |
| Hand-off: upgrade | Confirm `upgraded` → modal closed, drawer `plan-upgrade-upgrading`; the re-read showing the tier renewing → `plan-upgrade-done` |
| Refusals in the flow | Localised line in `--v2-error-text`, the island's button back, modal still open |
| Initial focus | On open, focus is on the title container, not a button; Enter starts nothing |
| RTL | `dir="rtl"`, chevron mirrored, Hebrew labels from the dictionary |
| 3-D Secure renewal (`action_required`) payload | Drawer shows `plan-confirm-payment`; the modal shows none of it (closes UM-1a QA edge 2) |

### 12.3 Guards (`upgradeModal.guard`)

| Guard | Expectation |
|---|---|
| (a) **inverted** (C-12) | `UpgradeModal.tsx` may import `PlanPurchase` and `PlanUpgrade` and nothing from `billing/PlanEmbeddedCheckout` or `stripeJs` directly; `PlanSection.tsx` imports neither island |
| (b), (d)–(k) | Unchanged |
| (c) extended (C-2) | `checkoutAllowed` / `upgradeAllowed` are defined only in `usePlanFlow.ts`; `PlanSection.tsx` no longer contains `!upgradeWatching && !upgradeSucceeded` |
| (l) new | `autoStart` is passed only by `PlanPurchase.tsx`; `HeldPaymentCheckout.tsx` and `PlanCheckoutPanel.tsx` do not pass it |
| (m) new (C-13) | No `text-red-` in `PlanPurchase.tsx` / `PlanUpgrade.tsx`; `PlanEmbeddedCheckout.tsx` still has its line (pins "untouched") |
| (n) new | The busy gate exists: `UpgradeModal.tsx` refuses `onOpenChange(false)` while busy, and `onEscapeKeyDown` / `onInteractOutside` call `preventDefault` behind the same flag |
| (o) new (Q-6) | No `view_only_note` key in any dictionary or file |

Each new guard has a planted-violation control, as UM-1a's do. `npm run test:bos-entitlements` on the final diff (skill checklist; no file in the module changes, but the guards there scan `components/`).

---

## 13. Existing assertions moved: old → new (C-5)

**Shared helpers** (added once per suite; the island test ids are unchanged):

- `openPlans()` — clicks `plan-compare-open` and returns `within(getByTestId('plan-compare-modal'))`. The modal is portalled to `body`, so suites that scoped to the sheet (`within(sheet)`) scope to the modal instead.
- `columnButton(tier, where = 'header')` — the column's button by accessible name inside `plan-compare-col-{tier}` (header) or the footer cell.
- The old drawer helpers keep their names and change their body: `upgradeButton(payload)` and `toQuote(payload)` in `PlanUpgrade.render` now go through `openPlans()` + `columnButton(TOP)`. `chooseLabel` is unchanged.

| Suite | Old (line on `9dd18562`) | New |
|---|---|---|
| `PlanPurchase.render` 193 | Choose list (`role=list`, name `plan.choose.heading`) has every plan's `price_ex_tax` and a Choose button | In the modal: every offered column has the Choose / Pay-for button **twice** (header, footer) and `$X` + `price_suffix`; `price_ex_tax` checked in the flow heading after pressing. Drawer: no Choose button (C-12) |
| 211 | Not-offered row: no button, "Coming soon" | Not-offered column (`buyable: [first]`): no button; "Coming soon" per SA Q-1 ruling |
| 227, 232 | `plan-purchase-ends-free-access` in the drawer | Modal footer `plan-compare-ends-free-access` (table view), and `plan-purchase-ends-free-access` inside the flow |
| 236, 246, 300, 310, 318 | `moneyButtons()` empty + `plan-compare-open` present | Unchanged in the drawer (now true by construction: no island); **plus** the modal's money buttons empty for those states (open-ended FP, paying, switches off, `purchase: null`) |
| 326 | M-2: one "not set up" line, no POST | In the modal: the Choose slots show the line, no button, no POST |
| 335 | W-4: "Compare plans" is the last drawer button, `buttons[0]` is Choose | Replaced: the drawer has exactly one button, `plan-compare-open`, labelled "See plans" when offered. The index dependency it protected is gone (the three `[0]` clicks below become named clicks) |
| 347 | Choose posts `{ tier, returnTo }`, frame mounts, other plans' buttons hidden | Same through the modal column button; other columns' buttons gone (table replaced) |
| 364 | While the first start is pending, other Choose buttons are disabled | Stronger: other columns' buttons are not in the document; the in-flow start button reads `plan.choose.starting`; one POST |
| 404, 427, 537 | `getAllByRole('button')[0]` clicks Choose | `columnButton(first)` by name |
| 401 | Completion: return path, processing, no done | Same, plus modal closed (hand-off) |
| 424 | Refusal line; "the buttons come back" (`moneyButtons().length > 0`) | Inside the flow: refusal line, the island's own start button back |
| 451–513 | Return marker / re-read / malformed / stale marker | Unchanged (drawer B5). "Choose as usual" (507) → "See plans" present and the modal offers Choose |
| 523, 534 | he / es list and refusal | Through the modal, same keys |
| `PlanUpgrade.render` 193–219 helpers | `upgradeButton` / `toQuote` press the drawer button | Bodies re-pointed (above). All 36 tests keep their assertions on `plan-upgrade-*` ids |
| 223 | Paying lower tier: Upgrade button, no `plan-purchase` | Upgrade in the `TOP` column ×2; no Choose anywhere; drawer has neither island |
| 232 (it.each) | No `plan-upgrade` for five states | No Upgrade column button for those states, and no `plan-upgrade` anywhere |
| 301, 453, 553, 641 | After decline / not confirmed / refusal the Upgrade button is back | Back **inside the flow area** (island button), modal still open |
| 306–418 | Confirm → "Upgrading…" → done only from the re-read | Same, plus the modal closes on `onUpgrading`; the B6 / done assertions stay on the drawer |
| 419–541 | 3-D Secure in place | Same, plus busy lock assertions while `handleNextAction` is pending |
| 537 | No Confirm button after the outcome | Unchanged, inside the flow |
| 658 | Q-7 own plan "Pay for" + `plan-choice-own-plan-note` in its row | Column `LOWER` button "Pay for {plan}"; note in the modal footer (`plan-compare-own-plan-note`) and inside the flow (`plan-choice-own-plan-note`, id unchanged) |
| 677–700 | he / es quote and refusal; `plan-upgrade` inside `dir` | Through the modal; the `dir` ancestor is now the modal content |
| `PlanSection.prefetch.render` 276, 369, 401 | Processing / done after a warm open; quote reached by the drawer button | Upgrade reached through the modal; the processing / done assertions unchanged; `planGets()` counts unchanged (the modal takes no read, C-3) |
| P-10 (≈ 392–412) | "Check again" after a warm open → one request | Check again inside the flow; exactly one request |
| `PlanDrawer.prefetch.render` 289–325 (D-8) | Close the **drawer** while the confirm is in flight; the answer lands after the close; reopen → one fresh read | **Re-shaped** (the busy lock makes "close mid-confirm" unreachable): the close attempt during the confirm is refused (new assertion); the answer lands → modal hands off → close the drawer → reopen within 60 s → one fresh read. Intent kept: no warm read is reused after an upgrade made in this mount. The exact `planGets()` count is recomputed because B6's bounded re-read now runs before the close; recorded here when written (SA Q-10) |
| `UpgradeModal.render` 83 | Trial: view-only note shown | No note; two Choose buttons per offered column |
| 146 | Admin-assigned own plan: slot empty, no note | "Pay for" button ×2 and the own-plan footer note |
| `UpgradeModal.render` / `qa` "no dead button" | Only X and "Back to your plan" in the modal | Only X, the footer close and the server-offered column buttons (§12.1) |
| `UpgradeModal.qa.render` 186–207 | After modal open / close, the **drawer's** Upgrade / Choose still POST | The **modal's** Upgrade / Choose POST the same bodies (`{ tier }` to the preview; `{ tier, returnTo: 'settings_plan' }`) |
| `UpgradeModal.qa.render` 162 | Tab cycles Back → X only | Tab cycles the column buttons in DOM order, then the footer close, then X |
| `upgradeModal.guard` (a) | Modal imports no island | Inverted (§12.3) |

**Deleted without replacement:** none. If a line number above has drifted after the `origin/main` merge, the mapping is by test name and is re-recorded here.

---

## 14. The user's end-of-stream run sheet (W-6)

> **Rewritten per SA W-6 and the user's decision of 2026-10-20.** This is the **user's own** run, done **once, at the end of the stream** (after UM-2 and UM-3, before the PRs merge), together with go-live row 20 (§15). QA prepares this sheet and records the result; agents never sign in and never handle keys.

**Setup (the user).** In this worktree (or the latest stream worktree), run `npm run dev` with your own local environment (standard Stripe sandbox, both plan switches on, as for P-7b.1). Sign in to your own test accounts. Use the browser's device toolbar at **360 px** for the phone rows; real phones are optional (S-15).

**Cards** (Stripe test cards): `4242 4242 4242 4242` (no authentication) · `4000 0027 6000 3184` (3-D Secure on every payment) · `4000 0000 0000 0341` (declines on charge). Any future expiry, any CVC, any postcode.

**Accounts (three trial accounts; QA revision 2026-10-20).** An account can buy only once, so the desktop and the 360 px 3-D Secure runs need separate accounts:

| Account | Used for | Ends as |
|---|---|---|
| **Trial A** | S-1, S-17, S-2 (card `4242…`, no authentication), later S-13 and S-16 | Essentials |
| **Trial B** | S-4, S-3 at desktop size (card `3184`), S-5, then the upgrade rows S-6, S-9, S-7, S-8 at desktop size, then S-11 | Autopilot |
| **Trial C** | S-3p and S-8p: the same two 3-D Secure rows at **360 px** (card `3184`) | Autopilot |

The `3184` card used to buy in S-3 is the card the upgrade charges in S-6 to S-9, so no card swap in the Stripe dashboard is needed. S-10 (a declining card) is optional and needs a card swap.

> **Before every upgrade row (S-6 onward): open Settings from the menu, so the address bar has no `checkout=…`.** While `checkout=…` is still in the address (as after S-5's reload), the plan window opens but shows **no** Upgrade button (the same rule the old drawer had: no new payment while one is landing). That is expected, not a failure.

Run in this order, top to bottom.

| # | Account | Click steps | Expected | Observed (you fill in) |
|---|---|---|---|---|
| S-1 | Trial A | Settings → Your plan → **See plans** → Autopilot column, **top** button "Choose Autopilot" | The table is replaced by "Back to plans", "Autopilot · $129 a month, excluding tax", the trial sentence, the Stripe card form. Only one card form on the page | |
| S-17 | Trial A | With the card form open: click the dark area outside the window; then press the X; then **See plans** → "Choose Autopilot" again | The outside click does nothing; the X closes the window; the window reopens on the table (not the old card form); choosing again opens a fresh card form | |
| S-2 | Trial A | **See plans** → Essentials column, **bottom** button "Choose Essentials" → pay with `4242 4242 4242 4242` | The window closes by itself; the drawer says "Payment processing", then "You're on Essentials" within about a minute | |
| S-4 | Trial B | **See plans** → "Choose Essentials" → `4000 0027 6000 3184` → in the bank's check press **Fail**, then close it | Stripe shows its own error inside the card form; the window stays open and usable; "Back to plans" works; nothing paid (drawer unchanged) | |
| S-3 | Trial B | **See plans** → "Choose Essentials" → `4000 0027 6000 3184` → in the bank's check press **Complete**. Desktop size | **Row 20 (b), checkout, desktop:** the bank's check shows above everything, can be clicked and typed into, the window stays open; then the window closes and the drawer says "Payment processing" → "You're on Essentials" | |
| S-5 | Trial B | Reload the page (the address still has `checkout=…`) | The drawer opens on "Payment processing" or straight on "You're on Essentials"; once done, the drawer button reads "See plans" (pressing it now shows no buy button: expected, see the note above) | |
| S-6 | Trial B | **Open Settings from the menu** (no `checkout=` in the address) → Your plan → **See plans** → Autopilot "Upgrade to Autopilot" | The price check: "Back to plans", the amount due now excluding tax, "renews on … at $129 a month", Confirm / Not now | |
| S-9 | Trial B | **Confirm** → in the bank's check press **Fail** (or close it) | "The payment was not confirmed, so nothing changed. You're still on Essentials." in red (readable in dark mode too); the "Upgrade to Autopilot" button is back inside the window; the window can be closed. (If a retry is then refused, note the message and use Trial C for S-7 / S-8) | |
| S-7 | Trial B | **See plans** → "Upgrade to Autopilot" → **Not now** → you are back at the table → "Upgrade to Autopilot" → **Confirm** | "Not now" returns to the table. While Confirm works, Escape, the X (dimmed) and an outside click do nothing, and "Back to plans" / "Back to your plan" are gone; then the bank's check opens (this card asks every time) | |
| S-8 | Trial B | In the bank's check click into it, type if asked, press **Complete**. Desktop size | **Row 20 (b), upgrade, desktop:** the check can be clicked and typed into, focus is not pulled back into the window, the window stays open; then it closes by itself and the drawer says "Upgrading…" → "You're on Autopilot" | |
| S-3p | Trial C, **360 px** | As S-3 (See plans → Choose Essentials, `3184`, **Complete**) | **Row 20 (b), checkout, phone width:** as S-3; the card form and the bank's check fit the width and can be scrolled to | |
| S-8p | Trial C, **360 px** | Open Settings from the menu → **See plans** → "Upgrade to Autopilot" → **Confirm** → **Complete** | **Row 20 (b), upgrade, phone width:** as S-8 | |
| S-10 | Optional: an Essentials owner paying with `4000 0000 0000 0341` (needs a card swap) | Upgrade → Confirm | "Your card was declined…" and when to retry; the window can be closed | |
| S-11 | Trial B (now Autopilot) | Settings → Your plan | The drawer button reads **"Compare plans"** (not "See plans"); in the window no Choose / Upgrade anywhere; Autopilot shows "Current plan" twice | |
| S-12 | Founding Partner, no end date | Compare plans | No button anywhere in the window | |
| S-13 | Trial A (Essentials, so it has an Upgrade button) | Switch to Hebrew, then Spanish; open the window, press Upgrade, then "Back to plans" | Everything translated, right to left in Hebrew (the "Back to plans" arrow points right), prices `$79` / `$129` | |
| S-14 | Any | Dark mode: open the window and a flow | The red lines and every label readable | |
| S-15 | Optional | Real iPhone / Android | Only if a phone can reach your local sign-in; the 360 px browser view is the required evidence | |
| S-16 | Trial A | Tab to "See plans", press Enter, then press Tab repeatedly | Focus starts on the window title (Enter right away buys nothing); Tab goes through the column buttons (top row, then bottom row), "Back to your plan", the X | |

**After the run:** QA records the observed column, ticks row 20 (b) if S-3, S-8, S-3p and S-8p passed, and lists the Stripe test subscriptions created (Trial A, B, C: cancel them or keep them, as you prefer).

---

## 15. Go-live row 20, proposed text (C-11)

TL updates plan payments §9.5 row 20 (Dev does not edit that file). Proposed replacement, same columns (`# | Item | Owner | When | Done`):

```markdown
| 20 | **3-D Secure (checkout and upgrade) verified inside the Settings plan drawer and inside the upgrade modal** (settings drawer S-1, SA W-2, added 2026-10-15; extended 2026-10-20 by upgrade modal C-11). Checkout and the upgrade each with `4000 0027 6000 3184`, each on desktop and phone width, in three places: (a) the plan drawer (until UM-1b moves the buttons out of it); (b) the upgrade modal opened from the drawer, stacked on it (UM-1b); (c) the upgrade modal opened on its own from another Business OS page (UM-2, once it ships). In each: the challenge can be clicked and typed into, focus is not pulled back into the drawer or modal, the drawer or modal stays open (the modal refuses to close while the upgrade confirm or its challenge runs), completing it ends in "Upgrading…" / "Payment processing" and then the server's answer, and abandoning it leaves the surface usable. (b) is a merge gate for UM-1b and (c) for UM-2. Neither payment switch goes on in production until (b) is ticked, and (c) too if UM-2 has shipped by then. (a) is needed only if a switch goes on before UM-1b merges | User; QA records | Before row 15 | ☐ |
```

Note for TL: once UM-1b merges, part (a) no longer exists in the product (no money button in the drawer). The user skipped the pre-build drawer check (W-1 part b, decision 2026-10-20), so (a) is checked, if at all, only in the end-of-stream run.

---

## 16. Logging

`console.*` count in every file this slice touches, on `9dd18562`: `PlanEmbeddedCheckout.tsx` 0, `PlanPurchase.tsx` 0, `PlanUpgrade.tsx` 0, `planPurchaseCopy.ts` 0, `PlanSection.tsx` 0, `UpgradeModal.tsx` 0, `upgradeModalView.ts` 0, `usePlanFlow.ts` 0, `en.ts` / `he.ts` / `es.ts` 0. Nothing to flag. No new log line: the islands keep their existing `warn` lines (`BusinessOsPlanUpgrade`, `BusinessOsPlanSection`); the modal does no I/O.

---

## 17. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | **3-D Secure stacking.** `handleNextAction` mounts Stripe's challenge iframe on `body`, outside both Radix layers (the Sheet and the modal). A modal Radix dialog sets `pointer-events: none` on `body` (which the challenge may inherit), treats a press on it as "outside", and its focus trap can pull focus back from the iframe. Any of these makes the challenge unusable. The same mechanics apply to the drawer today, and row 20 is still unticked there | Task 1 spike before building. In the build: `onInteractOutside` `preventDefault` while busy (stops dismissal; in §7 anyway). If the spike shows pointer-events or focus problems, mitigation options for SA (Q-7), in order of preference: (i) none needed; (ii) while `authenticating`, the modal's `onFocusOutside` / `onPointerDownOutside` prevented **and** the trap released through Radix's own props (no `dialog.tsx` change); (iii) a scoped style restoring `pointer-events: auto` on Stripe's challenge container while authenticating (new pattern, SA review); (iv) a `dialog.tsx` change (C-8 forbids without SA). Never: moving 3-D Secure out of the island |
| R-2 | **One Stripe Embedded Checkout per page.** A second `EmbeddedCheckoutProvider` on the page throws | Islands removed from the drawer (C-12, guard (a)); one `flow` at a time in the modal; header and footer are two buttons for one island; QA S-1 / S-2 check one session. UM-2's standalone modal must never coexist with the Settings instance (note for UM-2) |
| R-3 | StrictMode double effect starts two checkouts (`checkout_busy` refusal or two sessions) | `autoStart` ref guard; StrictMode test with one POST (§12.2) |
| R-4 | Closing during Confirm loses the "Could not confirm" retry with the same `prorationDate` | Busy lock (§7); "Could not confirm" hides "Back to plans"; whether closing in that phase should also be refused is SA Q-11 |
| R-5 | Hand-off race: `onComplete` closes the modal while `router.replace` puts the marker on the URL | Both in the same handler as today; the page's `?section=plan` handling keeps the drawer open (it sets the link flag every time, W-3); test: drawer open, B5 shown after the hand-off |
| R-6 | Embedded checkout's own 3-D Secure renders inside or above its iframe, inside a scrolling dialog body | QA S-3 / S-4 on desktop and phone |
| R-7 | Test migration hides a weakened assertion | §13 maps each one; SA code review checks the mapping is a narrowing or equal, as in UM-1a |
| R-8 | The shared `PlanEmbeddedCheckout` change affects the invite holding screen | Default `false`; guard (l); the holding screen's tests run unchanged in Task 9 |
| R-9 | An Enter press right after opening starts a checkout | Initial focus on the title (§6.4), test |
| R-10 | Worktree hazards (shared `node_modules` junction, shared stash list) | Never `git stash`; never remove the junction; RM handles worktree removal |

---

## 18. Open questions for SA

| # | Question | Dev proposal |
|---|---|---|
| Q-1 | "Coming soon" in the modal: UM-1a ruled `!availableToBuy` (view only). Today's Choose list also says "Coming soon" for a shown plan the server does not offer **while choosing** (`PlanPurchase.render` 211; UM-FR3). Carry that into the choose context? | Yes: chip when `!availableToBuy`, **or** when `offer.kind === 'choose'` and the plan is not in `offer.tiers` / `upgrade.tiers`. Outside the choose context, Q-1 stands (Essentials is not "coming soon" to an Autopilot owner) |
| Q-2 | Start prop (A) on `PlanEmbeddedCheckout`, a shared component, or two presses (B)? | A: additive `autoStart`, default off, guarded |
| Q-3 | A plan id in both `offer.tiers` and `upgrade.tiers`: `upgrade` wins? | Yes, pinned by a unit test; the server makes them exclusive today |
| Q-4 | Modal opened while `marker !== null` but not processing (successful return, marker still on the URL): column slots empty, as the drawer hides the islands today? | Yes (parity, UM-FR1) |
| Q-5 | How `PlanUpgrade` reports the phase: `onBusyChange(busy)` plus a second callback for "unsure", or one `onPhaseClass('idle' \| 'busy' \| 'unsure')`? | One callback, one effect |
| Q-6 | Initial focus on the title container (not the first column button)? | Yes |
| Q-7 | 3-D Secure mitigation, if the spike needs one (R-1 options ii to iv) | Decide on the spike evidence |
| Q-8 | While a checkout frame is open, refuse an outside press (keep X and Escape)? Protects a half-typed card from a stray backdrop click | Yes, not a full lock |
| Q-9 | Footer close keeps "Back to your plan", next to the new "Back to plans"? | Keep; switch to "Close" only if the user finds it confusing |
| Q-10 | D-8 (`PlanDrawer.prefetch`) re-shaped as in §13, with the read count recomputed | Accept |
| Q-11 | Refuse closing in "Could not confirm" as well (it holds the idempotent retry)? | No: today's drawer allows it, and Check again / the server's `upgrade_processing` code protect a second charge; "Back to plans" is hidden there |
| Q-12 | The close-on-landing effect (§8.1) lives in `UpgradeModal`, not `PlanSection` (pg8) | Accept |

---

## 19. Needs the user

1. **The sandbox key location and the test accounts** for QA's run (§14): confirm where the standard sandbox (`acct_1UPKR4…`) key is kept today, and which signed-in accounts to use for trial, Essentials-paying and Autopilot states. No key is printed or copied.
2. **He / es wording** of `upgrade_modal.open_see_plans` (הצגת התוכניות / Ver planes) and `upgrade_modal.back_to_plans` (חזרה לתוכניות / Volver a los planes), batched into one question with any other copy SA adds.
3. **Row 20 is a merge gate** (C-11): the PR may open, but it merges only after the 3-D Secure checks are recorded. If the spike shows today's drawer already fails 3-D Secure, that is a defect on `main` to decide on separately (payment switches stay off in production until row 20 is ticked).
4. Whether QA should cancel the sandbox subscriptions it creates after the run.

---

## Implementation Notes

### User decisions (2026-10-20)

| # | Decision (user's words where quoted) | Effect |
|---|---|---|
| UD-1 | "this is just a UI change … let's finish the UI and then run any tests. don't want to get this delayed, i want to see the full UI + full flow" | **W-1 part b skipped** (the signed-in drawer 3-D Secure check before the build), and every other mid-way live check. W-1 part a (jsdom probe, no sign-in) done. All live sandbox checks (go-live row 20 (b), the §14 sheet) are batched into **one user session at the end of the stream, after UM-2 and UM-3, before the PRs merge**. The 3-D Secure mitigation is implemented as far as it can be decided without the live check (below) |
| UD-2 | he / es **approved**: "See plans" → צפייה בתוכניות / Ver planes; "Back to plans" → חזרה לתוכניות / Volver a los planes | Keys `upgrade_modal.open_see_plans`, `upgrade_modal.back_to_plans`. (The workplan's he draft for "See plans", הצגת התוכניות, is superseded by the approved wording) |
| UD-3 | Close button: keep the current X with its existing accessible name (no change) | No "Close" key; the footer keeps "Back to your plan" (SA Q-9) |

### W-1a probe and the 3-D Secure mitigation (SA Q-7)

`UpgradeModal.layers` › "W-1a probe", with the real `SettingsDrawer` and the modal both open and a `__privateStripeFrame…` iframe appended to `body`:

| Question | Observed in jsdom | Consequence |
|---|---|---|
| Does `body` get `pointer-events: none`? | **Yes** (Radix, modal layer) | A frame on `body` that sets no pointer events of its own would be unclickable. **Mitigation (iii) applied**: while the upgrade is `busy`, the modal renders a scoped `<style>` (`STRIPE_CHALLENGE_REACHABLE_CSS`, `iframe[name^="__privateStripeFrame"]{pointer-events:auto !important;}`), removed when the step settles. Test: present only while busy, gone after |
| Is focus moved to a node on `body` pulled back? | **No, while busy** — recorded, not designed: the trap pulls back to the last focused element in the modal, which is the now-disabled Confirm button, so the refocus is a no-op | No mitigation (ii) needed on this evidence; whether a real cross-origin iframe keeps focus is **left for the live check** (S-8) |
| Does a press on it dismiss a layer while busy? | **No** (`onInteractOutside` prevented while busy) | Covered by the busy lock |
| Option (iv) `dialog.tsx` | Not touched (C-8) | — |

**Left for the live check (row 20 (b)):** the real challenge's clickability with the style applied, focus in the real cross-origin iframe, and the embedded checkout's own 3-D Secure inside the modal.

### What was built (against W-2 to W-8)

| Condition | Where |
|---|---|
| Q-2 `autoStart` | `PlanEmbeddedCheckout.tsx`: optional, default off, read once through a ref (StrictMode: one POST, test), never re-fires, nothing without a key; JSDoc says why. Guard (l) pins that only `PlanPurchase` passes it |
| Q-5 `onLockChange` | `PlanUpgrade.tsx`: one derived value (`confirming` / `authenticating` → `busy`, `unknown` → `unsure`), one effect keyed on it, cleanup reports `none`. Only `busy` locks; `unsure` hides "Back to plans" |
| Q-8 `onFrameOpenChange` | `PlanPurchase.tsx`: one effect, cleanup reports `false`. The modal refuses an outside press while a frame is open; X and Escape still close (test) |
| W-2 hand-off | `UpgradeModal.handOff()` clears the lock and closes without the gate; used by `onComplete`, `onUpgrading` and the Q-12 landing effect. Tests: Confirm → `upgraded` and 3-D Secure → `succeeded` each close the modal in the same act, drawer `plan-upgrade-upgrading`. Guard (n) pins that the hand-off does not consult `busy` |
| W-3 `paymentsConfigured` | `usePlanFlow` (one memoised `getStripePromise() !== null`), passed in; guard (c) pins it there. Without a key the Choose / Pay for slots stay empty and the modal footer says "Payments are not set up on this site yet." **once** (parity with the Choose list's one line, M-2) |
| W-4 `onCancel` | Only the quote's "Not now" calls it (tests: "Not now" → table; a refusal stays in the flow) |
| W-8 | C-13 four lines + guard (m); `ENDS_FREE_ACCESS_KEYS` in `planPurchaseCopy.ts` (type-only import); `test:bos-entitlements` green; tsc clean on touched files |
| Q-1 / Q-3 precedence | `upgradeModalView`: `upgrade` > `pay_for` > `choose` > `current_label` > chip > `none`; chip in the choose context for a shown plan not offered; never on the current column (unit tests) |
| Q-6 focus | `onOpenAutoFocus` records the opener, prevents Radix's default and focuses the title; Enter right after opening posts nothing (test). "Back to plans" returns focus to the pressed button |
| Q-12 | One effect in `UpgradeModal` (not `PlanSection`, pg8 untouched), once per flow, hand-off path (test) |

### Deviations for SA

| # | What | Why |
|---|---|---|
| D-1 | `PlanEmbeddedCheckout` now builds its provider `options` once per session and calls the latest `onComplete` through a ref | Stripe's provider warns and keeps the first `onComplete` when the option changes ("You cannot change the onComplete option after setting it"); the modal re-renders while the frame is open (Q-8 state), which would trip it. Behaviour for existing callers unchanged (the holding-screen and harness suites pass unchanged) |
| D-2 | In flow mode `PlanPurchase` keeps its plan name / price line but `sr-only` | The flow heading already shows "Autopilot · $129 a month, excluding tax"; the visual duplicate went, the text stays for the island's own tests and screen readers |
| D-3 | The "not set up" line is in the modal footer, once, instead of in each Choose slot (§4 said "in the slot") | One line for the whole table, as the Choose list had (M-2); four identical lines in four slots read as an error list |
| D-4 | `upgradeModal.guard` normalises CRLF in its `read()` | On this Windows worktree (`core.autocrlf=true`) the UM-1a guard (j) negative control failed locally before any UM-1b change (baseline below); the `'\n'`-based plant could not match a CRLF file (known pattern, memory "Jest local-vs-CI flake patterns") |
| D-5 | `PlanPurchase.render` "on completion" test calls the **latest** recorded `onComplete` | The fake provider records `onComplete` on every render, and the modal re-renders once the frame opens. The assertion it guarded was a precondition, not a behaviour |
| D-6 | The `UpgradeModal.render` "nextPlanUp not available to buy" fixture now also drops `upgrade` | A plan the server cannot sell is not offered as an upgrade; with the old fixture the precedence (upgrade wins, chip only when `none`) gives a button, which the server would never send |

### §13 as built (W-5 additions)

| Suite | Old → new |
|---|---|
| `UpgradeModal.layers` | All four UM-1a assertions kept unchanged. **Added:** busy refusals in the drawer stack (Escape, X, backdrop during the confirm; hand-off closes the modal only, drawer "Upgrading…") and the W-1a probe |
| `upgradeModalView.test` | Each `'offered'` assertion → its split kind: Trial `every 'offered'` → `every 'choose'` (+ `hasActions`); Essentials TOP `'offered'` → `'upgrade'`; admin-assigned TOP `'offered'` → `'pay_for'` + `ownPlanNote 'choose'`; admin-assigned LOWER `'offered'` → `'pay_for'` (+ `hasActions`). The "not available to buy" case gains `action 'none'`. **Added:** precedence (Q-3), choose-context chip and its absence outside it (Q-1), no chip on the current column, upgrade own-plan note |
| `PlanPurchase.render` | Mapped as §13 (all named presses via the column buttons); W-4 index test replaced by "the drawer has one button, See plans"; absence tests keep the drawer assertions and add "no Choose / Pay for in the modal"; M-2 now "one line in the modal" |
| `PlanUpgrade.render` | `upgradeButton()` opens the modal and returns the TOP header button (or the island's own in a flow); all 36 tests keep their `plan-upgrade-*` assertions. Q-5 note → modal footer `plan-compare-own-plan-note`; Q-7 → column buttons + footer note + the island's note in the flow; the five "no Upgrade" states also assert no Upgrade in the modal |
| `PlanSection.prefetch` / `PlanDrawer.prefetch` | `paying()` fixtures gain a `comparison` (the button needs one, C-21). P-10 through the modal. **D-8 re-shaped** (SA Q-10): the close is refused during the confirm (new), hand-off, then the drawer closes; the exact `planGets()` counts are **unchanged** (1 before the reopen, 2 after): the bounded re-read's first tick (4 s) never fires before the drawer closes, and closing unmounts `PlanSection` |
| `UpgradeModal.render` / `.qa` | "No dead button" now: X, "Back to your plan", and two column buttons per server-offered column (checked against the payload). Per-state rows assert the button names (Choose ×2, Upgrade ×2, Pay for ×2 + note). Keyboard: focus on the title, Tab order header → footer → Back → X. "Money unchanged after open / close" now presses the modal's buttons and checks the same POST bodies |
| New `upgradeModal.flow.render` | 15 tests: one flow per column (header / footer), one island and one frame, StrictMode one POST (checkout and preview), Back to plans + focus + re-choose, Not now, refusal stays in flow, busy during Confirm and 3-D Secure + hand-off, Could not confirm (no back, closable), Q-12 landing, Q-8 frame + backdrop, Q-6 Enter posts nothing, Hebrew |

No assertion deleted without a replacement.

### Runs (2026-10-20, worktree at `origin/main` `c9e1dfba` (#483 merged, fast-forward) + the uncommitted diff)

| Run | Result |
|---|---|
| Baseline before any edit: settings + settings page + `components/test-business-os` + `app/invite` + guards | 57 suites, 1,248 tests: **1 failed** (`upgradeModal.guard` (j) negative control, CRLF on this Windows checkout; D-4), 1,247 passed |
| After: `components/business-os/settings/__tests__` + `app/business-os/settings/__tests__` + `components/business-os/__tests__` + `components/business-os/billing` + `components/test-business-os` + `app/invite` + `tierLiteral.forbidden` + `creditFigures.fromConfig.guard` + `enforcementPoints` + `dictionariesStayInStep` | **76 / 76 suites, 1,686 / 1,686 tests** |
| `npm run test:bos-entitlements` | **301 / 301 suites, 9,131 / 9,131 tests** |
| `npm run lint:hooks` | Clean (exit 0) |
| `npx eslint` on every touched / new file | Clean |
| `npx tsc --noEmit -p .` | No error in `components/business-os/settings/`, `components/business-os/billing/` or the dictionaries |
| `git diff --numstat` | Every file has insertions and deletions in proportion; no deletion-only file |
| `console.*` | 0 in every touched file |

### SA code review fixes CR-1 to CR-3 (Dev, 2026-10-20)

| # | Status | Fixed by Dev |
|---|---|---|
| CR-1 | ✅ Fixed, **with a deviation (D-7) for SA** | `usePlanFlow.paymentsConfigured` now asks `getStripePromise()` **only when the server offers a checkout** (`offer.kind === 'choose'`), memoised on that. An account with nothing to buy (Autopilot owner, open-ended Founding Partner) never loads Stripe.js from the section or the modal; an Essentials owner loads it only when pressing Upgrade (the island, as before UM-1b). Tests (`upgradeModal.flow.render` › "Stripe.js is loaded only when it can be needed"): Autopilot and open-ended Founding Partner → 0 loads after opening drawer and modal; control: a trial loads it and gets its Choose buttons |
| D-7 | Deviation | SA suggested a pure key-shape check exported from `lib/client/stripeJs.ts`. Not done that way: twelve suites mock `@/lib/client/stripeJs` with `getStripePromise` only, including QA's new `upgradeModal.flow.qa.render` (which Dev may not edit). A new export would be `undefined` in every one of them (a TypeError on render), and a check reading the env directly would bypass those mocks (no key in Jest, so no Choose button anywhere). Gating the existing call on the server's offer meets the review's aim (no Stripe.js without something to buy) with no mock change. If SA still wants the pure helper, it is a follow-up that updates the mocks together with QA |
| CR-2 | ✅ Fixed | The Stripe-frames style renders while `busy` **or** a checkout frame is open (`frameOpen`); the comment above `STRIPE_CHALLENGE_REACHABLE_CSS` names both phases. Tests: absent on the table, present while the frame is open, gone after "Back to plans", gone after the X (modal closed) |
| CR-3 | ✅ Done (optional) | Focus return after "Back to plans" uses a ref map of the column buttons (`registerAction`), not a `data-testid` lookup; the now-unused content ref was removed |

**Runs after the fixes:** settings + settings page + `components/business-os/__tests__` + billing + `components/test-business-os` + `app/invite` + the four guards: **77 / 77 suites, 1,700 / 1,700 tests** (incl. QA's new suite). `npm run lint:hooks` clean; eslint clean on the touched files; tsc clean on `components/business-os/settings/` and `billing/`.

### Screenshots (static render, not the running app)

Rendered from the real component in Jest (real payloads; the Stripe frame is a labelled placeholder) and styled with the project's own CSS compiled by its Tailwind, captured with headless Chrome. Folder: `scratchpad/um1b-shots/` in the session scratchpad: `1-desktop-light-essentials-upgrade`, `2-desktop-light-flow-upgrade-preview`, `3-desktop-light-flow-checkout`, `4-desktop-light-trial-two-choose`, `5-desktop-hebrew-rtl-essentials`, `6-desktop-hebrew-dark-flow-upgrade`, `7-phone-360-essentials`, `8-phone-360-trial`, `9-phone-360-flow-checkout`. The temporary dump test was deleted after use.

---

## SA Review Notes

**Reviewed by SA — 2026-10-20** (branch tip `9dd18562`; `PlanEmbeddedCheckout.tsx`, `PlanPurchase.tsx`, `PlanUpgrade.tsx`, `planPurchaseCopy.ts`, `UpgradeModal.tsx`, `usePlanFlow.ts`, plan payments §9.5 row 20 read)
**Status:** ✅ Approved with conditions (W-1 to W-8). No code may start before W-1 (spike re-shape) is accepted by TL; W-2 to W-8 are build conditions checked at code review.

### Rulings on Q-1 to Q-12

| # | Ruling |
|---|---|
| Q-1 | **Accepted.** "Coming soon" when `!availableToBuy`, or in the choose context (`offer.kind === 'choose'`) for a shown plan in neither `offer.tiers` nor `upgrade.tiers` (parity with today's list, UM-FR3). Precedence in `upgradeModalView`, pinned by one unit test: `upgrade` > `pay_for` > `choose` > `current_label` > chip > `none`. The current column never shows the chip |
| Q-2 | **A accepted** (`autoStart`). Conditions: read once on mount through a ref (StrictMode: one POST); never re-fires on a prop change or after a refusal (the retry is the island's start button); with no key it does nothing (M-2 path unchanged); default `false`; guard (l) with a planted control; the holding-screen and harness suites run unchanged in Task 9. JSDoc on the prop says why it exists |
| Q-3 | Accepted: `upgrade` wins, unit-pinned |
| Q-4 | Accepted (parity): slots empty when `checkoutAllowed` / `upgradeAllowed` are false |
| Q-5 | **One callback**, supersedes the `onBusyChange` name in UM-SA2: `onLockChange(lock: 'none' \| 'busy' \| 'unsure')`, derived from the phase (`confirming`/`authenticating` → busy; `unknown` → unsure), reported from **one** effect keyed on the derived value (not on every phase change), cleanup reports `'none'`. Only `'busy'` locks closing; `'unsure'` only hides "Back to plans" |
| Q-6 | Accepted. Keep D-1's opener recording in the same `onOpenAutoFocus`; test that Enter right after open posts nothing |
| Q-7 | Decided on the spike evidence (W-1). Pre-ruled order: (i) nothing; (iii) a scoped `pointer-events: auto` restore on Stripe's challenge container **only while `'busy'`**, removed on settle, with a test — approved now as a contained exception if the spike needs it; (ii) only via props Radix actually exposes (Dialog does not expose the focus trap; `modal={false}` while authenticating is **rejected**, it changes layering under the drawer); (iv) any `dialog.tsx` change comes back to SA first (C-8). Never move 3-D Secure out of the island |
| Q-8 | **Accepted**: while a checkout frame is open, an outside press is refused; X and Escape still close (so UM-FR11 holds). Needs one optional `PlanPurchase` callback (`onFrameOpenChange`, same cleanup-reports-false rule). Not an `aria-busy` state |
| Q-9 | Keep "Back to your plan" for now; put "Close" as the alternative in the batched copy question to the user (§19.2) |
| Q-10 | Accepted. The recomputed `planGets()` count is an **exact** number with a comment deriving it, not `>=`; plus the new "close refused during confirm" assertion |
| Q-11 | Accepted: closing allowed in "Could not confirm" (server `upgrade_processing` + idempotent `prorationDate` protect a second charge); "Back to plans" hidden there |
| Q-12 | Accepted. The effect fires once per flow, only when `flow.kind === 'upgrade'` and the tier has left `upgrade.tiers` after a re-read, and uses the hand-off close path (W-2) |

### Conditions

1. **W-1 Spike re-shaped (agents never sign in or handle keys).** Task 1 becomes two parts. **1a (Dev, no sign-in):** a jsdom probe (kept as a real test in `UpgradeModal.layers`) with the drawer + modal stack open, a node appended to `body` the way `handleNextAction` mounts its frame: record whether `body` gets `pointer-events: none`, whether focus moved to that node is pulled back, and whether a press on it dismisses either layer. **1b (user, signed in, on `main` before any build):** today's drawer upgrade and checkout with `4000 0027 6000 3184`, desktop + browser 360 px emulation — this is row 20 (a) and tells us whether one Radix layer already breaks Stripe. The throwaway modal-over-drawer sandbox build is **dropped**: the built branch is the probe, re-checked in §14 S-3/S-8. If 1b fails on `main`, that is a `main` defect for the user (§19.3), and Q-7's mitigation is applied in UM-1b.
2. **W-2 Hand-off close must bypass the busy gate (defect in §8.1).** `PlanUpgrade` calls `setPhase({ kind: 'idle' })` then `onUpgrading(tier)` synchronously (`PlanUpgrade.tsx:289-290`, `:256-257`); a lock reported from an effect is still `'busy'` when `onUpgrading` arrives, so `onOpenChange(false)` would be **refused** and the modal would stay open over "Upgrading…". The wrapped `onUpgrading` / `onComplete` / Q-12 close use a dedicated hand-off close that clears the lock and closes; the user-facing gate stays strict. Test: Confirm → `upgraded` → modal closed in the same act, drawer `plan-upgrade-upgrading`; same for 3-D Secure `succeeded`.
3. **W-3 "Payments not set up" in the slot (contradiction §4 vs guard (a)).** The modal may not import `stripeJs`, so it cannot know the key is missing. `usePlanFlow` exposes `paymentsConfigured` (one `getStripePromise() !== null` read, memoised); the modal takes it as a prop. Guard (c) pins it to `usePlanFlow.ts`; guard (a) unchanged. No Choose button rendered without it (no dead button).
4. **W-4 `onCancel`** fires only from the quote's "Not now" button, never from the `idle` set on success or refusal paths. Test both.
5. **W-5 §13 additions.** Add rows for `UpgradeModal.layers` (existing assertions kept, plus busy refusals and W-1a probe) and `upgradeModalView.test` (each existing `'offered'` assertion → its split kind). Each moved assertion must be equal or narrower; SA checks at code review.
6. **W-6 §14 is the user's run sheet, QA prepares and records.** Remove "ask the user where the key lives" and "never copy the key" instructions aimed at agents: the user runs `npm run dev` in this worktree with their own env, signed in to their own test accounts. Chain the accounts: the S-3 account (paid with `3184`) is the S-8 account, so no dashboard card swap is needed. S-15 real phones are optional (localhost sign-in on a phone is impractical); browser 360 px emulation is the required evidence. Add **S-17**: frame open → backdrop press does nothing, X closes, reopen → Choose again opens a new session (M-3 expired the first). QA writes the sheet as plain click steps with an "observed" column the user fills.
7. **W-7 Row 20 text (§15).** Replace the last sentence with: "(b) is a merge gate for UM-1b and (c) for UM-2. Neither payment switch goes on in production until (b) is ticked, and (c) too if UM-2 has shipped by then. (a) is needed only if a switch goes on before UM-1b merges." Name the upgrade card number (`4000 0027 6000 3184`) instead of "always requires authentication". Otherwise accepted for TL.
8. **W-8 Standards.** C-13 four lines plus guard (m); D-4 move keeps `planPurchaseCopy.ts` free of entitlements imports (run `test:bos-entitlements`); `npx tsc --noEmit -p .` on the touched files clean; requirement MD updated with this ruling.

### Estimate
2.5 d accepted (W-1 replaces the throwaway build with a 0.1 d probe; W-2/W-3 add ≈ 0.1 d). Test migration (0.5 d over seven suites) is the likeliest overrun; flag at 2.75 d.

### Needs the user (business terms)
- Run the today's-drawer 3-D Secure check (W-1b) signed in, before the build, and later the §14 sheet.
- Copy: he / es for the two new labels, and whether the window's close button should read "Close" instead of "Back to your plan".
- If today's drawer already fails 3-D Secure: that is a live gap (payments stay switched off until fixed).

### Approval
[x] Workplan approved with conditions W-1 to W-8 — proceed to Task 0 and W-1; build after TL accepts W-1

---

**Code Review by SA — 2026-10-20** (worktree at `origin/main` `c9e1dfba` + the uncommitted UM-1b diff; 21 modified files + 2 new tests; screenshots `scratchpad/um1b-shots/` 1–9 viewed)
**Status:** 🔄 Fix Required (two small fixes, CR-1 and CR-2; no re-review of the rest needed, SA re-checks only those two)

**Runs by SA:** settings + settings page + `components/business-os/__tests__` + billing + `components/test-business-os` + `app/invite`: **72 / 72 suites, 1,492 tests**. Guards `tierLiteral.forbidden`, `creditFigures.fromConfig.guard`, `enforcementPoints`, `dictionariesStayInStep`: **4 / 4, 194 tests**. `npx eslint` on the seven product files clean; `npm run lint:hooks` clean. `git diff` on `app/` and `components/test-business-os/`: empty (holding screen and harness untouched).

### Verified (no action)

| Area | Finding |
|---|---|
| Money unchanged (UM-FR4) | `PlanPurchase` / `PlanUpgrade` requests and bodies untouched; only optional props added. Flow suite and `.qa` re-point "money unchanged" at the modal with the same bodies |
| `autoStart` inert by default | Default `false`, read once into a ref, effect returns immediately when false, nothing without a key. D-1 (options memoised per session, latest `onComplete` through a ref) is behaviour-equivalent for the holding screen and harness; their suites pass unchanged. Guard (l) pins the callers |
| C-12 | `PlanSection.tsx` imports neither island; one `openFlow` at a time; one island, one frame (flow suite) |
| W-2 | `handOff()` resets the lock and calls `onOpenChange(false)` directly; used by `onComplete`, `onUpgrading` and the Q-12 effect. Tested for `upgraded` and 3-D Secure `succeeded` |
| W-3 | `paymentsConfigured` from `usePlanFlow` only; no checkout button without it; one footer line (D-3 accepted). See CR-1 for how it is computed |
| Q-5 / W-4 | One derived `lock`, one effect, cleanup `'none'`; `onCancel` only from "Not now" |
| Q-8 | `onInteractOutside` refused while `frameOpen`; X and Escape close; cleanup reports `false` |
| 3-D Secure style (Q-7 iii) | Scoped to `iframe[name^="__privateStripeFrame"]` (Stripe's own frames only; no effect on our DOM). Rendered as a React child of `DialogContent` from the derived `busy`, so it goes on **every** exit path by construction: settle (`declined` / `not_confirmed` / `unknown` / `refused` → lock not busy), hand-off (`resetFlow`), island unmount (cleanup `'none'`), modal close or `PlanSection` unmount (the content unmounts). Tests: present while busy, gone after declined, unknown and hand-off. Safe. Residual: that Stripe names its challenge frame with that prefix is only provable live (S-8) |
| C-13 | Exactly the four lines; `PlanEmbeddedCheckout.tsx` keeps its `text-red-700` (now line 196); guard (m) pins both |
| Test mapping (C-5, R-7) | Every removed `expect` reviewed: each is replaced by an equal or narrower one (e.g. "other Choose disabled" → "not in the document" + "starting"; view-only note → removed per Q-6 with guard (o); `'offered'` → its split kind). D-5 and D-6 accepted (D-6 fixture now matches what the server can send). D-8 re-shape keeps exact counts (1, then 2) with a comment. None deleted without replacement |
| D-2, D-4 | Accepted |
| Screenshots | Layout, RTL chevron, dark mode, 360 px trial and flow read correctly |

### Code Review Comments

1. **CR-1 `usePlanFlow.ts` (`paymentsConfigured`) — Priority: Medium (required).** `getStripePromise()` is not a pure check: it calls `loadStripe(key)`, which injects Stripe.js into the page. Before UM-1b it ran only when an island mounted (something was offered); now it runs on **every** plan drawer mount, including accounts with nothing to buy (open-ended Founding Partner, Autopilot owners). Fix: export a pure key-shape check from `lib/client/stripeJs.ts` (for example `hasPublishableKey()`, the same `PUBLISHABLE_KEY_SHAPE` test, used by `getStripePromise` too) and use it for `paymentsConfigured`. Guard (c) keeps pinning the value to `usePlanFlow.ts`; add one test that `loadStripe` is not called when nothing is offered.
2. **CR-2 `UpgradeModal.tsx:239` — Priority: Medium (required).** The reachable-frames style covers only the upgrade's busy phase. The embedded checkout's own 3-D Secure (S-3) can also put a Stripe frame on `body` under Radix's `pointer-events: none`, and the checkout flow never reports busy. Render the style while `busy || frameOpen` (same selector; still only Stripe's frames, still removed by construction when the frame closes or the flow ends). Extend the test: present while a checkout frame is open, gone after "Back to plans" and after the X. This widens the Q-7 (iii) exception that SA approved; it is approved here, and the comment above `STRIPE_CHALLENGE_REACHABLE_CSS` should say both phases. Cheaper than discovering it in the batched end-of-stream run and re-opening the cycle.
3. `UpgradeModal.tsx:168` — the focus return finds the pressed button by `data-testid` from product code. Works, but test ids become a runtime contract. Low; see suggestions.

### Optimisation Suggestions
- Focus return (comment 3): keep a ref map or a stable `id` per action button instead of a `data-testid` lookup.
- `UpgradeModal.tsx` is now ≈ 625 lines; when UM-2 touches it, consider moving `ActionSlot` and the flow area into their own files.

#### SA re-check of CR-1 to CR-3 — 2026-10-20

**Status:** ✅ Code Approved.

| Item | Ruling |
|---|---|
| CR-1 / **D-7 accepted** | `paymentsConfigured = checkoutOffered && getStripePromise() !== null`, memoised on `offer.kind === 'choose'`. That is sufficient. The value is read only by the Choose / Pay-for slots and the footer "not set up" line, and both exist only when a checkout is offered, so `false` when nothing is offered is correct and loads nothing. Upgrade-only accounts no longer load Stripe.js when the drawer opens: `PlanUpgrade` loads it when the modal mounts the island, which is narrower than before UM-1b. Trial accounts load it when the drawer opens, as `PlanPurchase` did before. Tests: no load for an Autopilot owner or an open-ended Founding Partner, plus a trial control. Skipping the pure-check export (twelve module mocks lack it) is an acceptable trade |
| CR-2 | The style renders while `busy \|\| frameOpen`; the comment names both phases. Tests: absent on the table, present while the frame is open, gone after "Back to plans" and after the X |
| CR-3 | Focus return goes through a ref map (`actionKey` → button); no `data-testid` lookup left in product code |

SA run: `components/business-os/settings` **34 / 34 suites, 651 tests**; eslint clean on `UpgradeModal.tsx` and `usePlanFlow.ts`.

### Code Approved for QA: **Yes**, after the CR-1 to CR-3 re-check above. First pass read: No, until CR-1 and CR-2 land (then yes, without a full re-review: SA checks the two diffs and their tests). Go-live row 20 (b) remains the merge gate (C-11); the live checks stay batched per UD-1.

---

## QA Testing Report

**QA — 2026-10-20** (automated pass; worktree `origin/main` `c9e1dfba` + the uncommitted UM-1b diff, read before SA's CR-1 / CR-2 fixes: CR-2 was landing in `UpgradeModal.tsx` during the last run, CR-1 not yet)
**Test mode:** full, automated only
**Strategy used:** A + B (Jest render suites through the real `PlanSection` with real payloads, routes faked at `fetch`, Stripe faked at its modules; guards) and a static headless render at 360 px. D (the browser run) is the user's §14 sheet, per UD-1
**Focus:** ui, api (request bodies), security (busy lock, one checkout per page)
**Skipped:** every live sandbox check (sign-in, Stripe keys, purchases, the real 3-D Secure challenge): batched into the user's end-of-stream run (UD-1, §14). No agent signed in or handled a key
**Input source:** prompt keywords (TL brief) + workplan §12 / §14

### Runs

| Run | Result |
|---|---|
| `components/business-os/settings/__tests__` + `app/business-os/settings/__tests__` + `components/business-os/__tests__` + `components/business-os/billing` + `components/test-business-os` + `app/invite` + guards (`tierLiteral.forbidden`, `creditFigures.fromConfig.guard`, `enforcementPoints`, `dictionariesStayInStep`) — Dev's tree | **76 / 76 suites, 1,686 / 1,686 tests** (matches Dev) |
| Same set + QA's new file | **77 / 77 suites, 1,696 / 1,696 tests** |
| New `upgradeModal.flow.qa.render.test.tsx` | **10 / 10**; `npx eslint` clean |
| `npm run test:bos-entitlements` | **301 / 301 suites, 9,131 / 9,131 tests** |
| `npm run lint:hooks` | Clean (exit 0, `--max-warnings 0`) |
| Request-shaping lines in the product diff (`fetch(`, `JSON.stringify`, `method:`, `returnTo`, `prorationDate`, `/api/`) | **None changed** (`git diff -U0`, tests excluded) |
| `git diff` on `app/invite/**`, `components/test-business-os/**` | Empty; neither passes `autoStart` |

### Test Coverage

| Acceptance point (TL brief / §2.2 / §12) | Tested? | Result | Evidence |
|---|---|---|---|
| Which button each column shows, server-driven, per state (trial, FP with / without end date, Essentials, Autopilot, admin-assigned "Pay for", not-buyable "Coming soon", switches off, `purchase: null`, no key) | ✅ | Pass | `upgradeModalView.test` (precedence upgrade > pay_for > choose > current_label > chip), `UpgradeModal.render` per-state rows (×2 per column), `PlanPurchase.render` / `PlanUpgrade.render` absence states |
| No dead button | ✅ | Pass | `UpgradeModal.render` / `.qa`; **QA added** a payload-checked "no dead button" for trial, Essentials, top-plan owner and the `action_required` state |
| Flow area replaces the table; header and footer start one flow | ✅ | Pass | `upgradeModal.flow.render` |
| "Back to plans": back to the table, focus on the pressed button; hidden during Confirm, 3-D Secure, "Could not confirm" | ✅ | Pass | flow suite |
| Busy lock: X, Escape, outside press refused during Confirm and 3-D Secure; footer close gone; `aria-busy`; drawer below stays open | ✅ | Pass | flow suite + `UpgradeModal.layers` |
| Checkout frame open: outside press refused, X closes | ✅ | Pass | flow suite |
| Checkout frame open: **Escape** closes; a reopen shows the table, no frame, no second POST | ✅ | Pass | **QA added** |
| Close on the quote ("Back to your plan"), reopen: no stale flow or lock | ✅ | Pass | **QA added** |
| Hand-off: checkout complete → modal closes, `router.replace` return path, drawer "Payment processing", never "done" before the re-read | ✅ | Pass | `PlanPurchase.render` "on completion" |
| Hand-off: upgrade `upgraded` / 3-D Secure `succeeded` → modal closes in the same act, drawer "Upgrading…"; Q-12 landing → "You're on {plan}" | ✅ | Pass | flow suite, `PlanUpgrade.render` |
| Refusals shown in the modal (checkout and upgrade), localised, `--v2-error-text`, island button back | ✅ | Pass | `PlanPurchase.render` it.each refusals, flow suite |
| No second embedded checkout mounted | ✅ | Pass | flow suite (one island, one frame, StrictMode one POST); **QA added** two presses in one act (same column header + footer, and two different columns): one POST, one provider, one frame |
| Requests and payloads byte-identical to `origin/main` | ✅ | Pass | No request-shaping line changed in product code; tests assert `{ tier, returnTo: 'settings_plan' }`, `{ tier }`, `{ tier, prorationDate }` unchanged (`UpgradeModal.qa` "money unchanged", flow suite) |
| `autoStart` off by default on the invite holding screen | ✅ | Pass | Guard (l); `awaitingPayment.render` "Pay POSTs exactly…": `fetchCalls` holds exactly the one POST made by the press, so nothing posted on mount; holding-screen and harness suites unchanged and green |
| SA Q-4: a checkout marker on the URL empties the column slots | ✅ | Pass | **QA added** (non-vacuous: the same payload offers Upgrade without the marker) |
| §12.2 last row: 3-D Secure renewal (`action_required`) keeps "Confirm payment" in the drawer only | ✅ | Pass | **QA added** (the Dev suites did not cover this row) |
| Keyboard: initial focus on the title, Enter posts nothing; Tab order header row → footer row → "Back to your plan" → X; Escape returns focus to "See plans" | ✅ | Pass | `UpgradeModal.qa` keyboard, flow suite |
| he / es / RTL | ✅ | Pass | `UpgradeModal.render` he / es (no English left), flow suite Hebrew (labels, mirrored chevron, "See plans" in Hebrew); `dictionariesStayInStep` |
| 360 px layout (static) | ✅ | Pass | Dev shots 7–9 re-viewed; **QA rendered** `scratchpad/um1b-shots/qa-360-essentials-he-dark.png`, `qa-360-trial-he-light.png`, `qa-360-flow-checkout-he-light.png`, `qa-360-flow-upgrade-he-dark.png` (headless Chrome, project CSS): RTL columns, Upgrade button, chevron pointing right, quote buttons, dark mode all read correctly |
| Real 3-D Secure challenge clickable / typeable / focus kept (row 20 (b)), embedded checkout's own 3-D Secure in the modal, real 360 px | ⚠️ | Deferred | User's end-of-stream run: §14 S-3, S-8, S-3p, S-8p |

### Issues Found

#### Bugs (must fix before commit)
None found by QA. SA's CR-1 (`paymentsConfigured` calls `loadStripe`) and CR-2 (frames reachable while a checkout frame is open) are SA's findings, tracked in the SA section; after they land QA re-runs the settings suites and the QA file (not a full pass).

#### Performance Issues (should fix)
None beyond SA CR-1.

#### Edge Cases (nice to fix)
1. **"See plans" with nothing to press while a checkout marker is on the URL** — `upgradeModalView.ts` / `PlanSection.tsx` — Low. After a checkout returns (`?checkout=…` still in the address, payment landed), the drawer button reads "See plans" (`hasActions` is payload-only) but the modal shows no Upgrade button (`upgradeAllowed` is false, SA Q-4 parity). The rule itself is the old drawer's; only the label now over-promises. Options: label from `hasActions && (checkoutAllowed || upgradeAllowed)`, or accept. §14 S-5 / S-6 now tell the user to expect this.
2. **Trial's "nothing is charged before you choose one" (B7) stays under an open card form** — `UpgradeModal.tsx` footer — Low, copy. In the checkout flow at 360 px the footer shows B7 right under the Stripe frame, next to the island's "Buying ends your free trial today, and the first month is charged now." Mixed message mid-purchase; consider hiding B7 while a flow is open, as the footer already does for the free-access sentence.
3. **Phone height for the card form** — Low, for the live check. At 360 × 780 the band, status strip, heading and footer leave about 220 px of Stripe frame visible before scrolling (`9-phone-360-flow-checkout`, `qa-360-flow-checkout-he-light`). Scrolls correctly; S-3p records whether the real form is comfortable.
4. **Checkout flow is never "busy"** — by design (Q-8: X and Escape still close). If the embedded checkout's own 3-D Secure is open and the owner presses the X, the session is abandoned (the server replaces it on the next Choose, M-3). Observe in S-4 / S-3; no change proposed.

### §14 revised by QA
Three trial accounts instead of two (one account can buy only once, so the 360 px 3-D Secure rows S-3p / S-8p get their own account C); S-9 moved before S-7 / S-8 so the failed 3-D Secure runs while the account is still on Essentials; a note to open Settings from the menu before the upgrade rows (no `checkout=` in the address, see edge case 1); S-11 starts from "Compare plans"; row 20 (b) ticks on S-3, S-8, S-3p and S-8p.

### Test Outputs / Logs
```text
Test Suites: 77 passed, 77 total
Tests:       1696 passed, 1696 total
test:bos-entitlements  Test Suites: 301 passed, 301 total  Tests: 9131 passed, 9131 total
lint:hooks             eslint app lib components hooks ... --max-warnings 0  → exit 0
upgradeModal.flow.qa.render.test.tsx  Tests: 10 passed, 10 total
```

### Final Status
- [ ] All acceptance criteria pass — ready for commit
- [x] Automated criteria pass; **not ready for commit**: SA CR-1 / CR-2 open (QA re-run of the touched suites after they land), and go-live row 20 (b) is the merge gate, recorded only in the user's end-of-stream §14 run

---

## Commit Info

[RM will populate this section]

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-20 | Created | Dev workplan for UM-1b from the UM-1a branch tip `9dd18562`: column buttons per §2.2 state from the server offer (`choose` / `pay_for` / `upgrade` / `current_label` / `none`), optional start props on the islands (A) with a no-change fallback (B), flow area replacing the table (C-25), busy lock with `onBusyChange` (UM-FR11), hand-off to the drawer's B5 / B6, "See plans" label, C-13 colours, D-4 key map move, 2 new and 1 removed copy keys (he / es drafts), §13 old → new mapping across seven suites, QA sandbox run sheet incl. 3-D Secure, proposed go-live row 20 text (C-11), 12 SA questions. Estimate ≈ 2.5 d. Status: Planning |
| 2026-10-20 | SA workplan review: APPROVED WITH CONDITIONS | Q-1 to Q-12 ruled (A `autoStart`; single `onLockChange('none'\|'busy'\|'unsure')`; outside press refused while a checkout frame is open). Conditions W-1 to W-8: spike split into an agent jsdom probe + a user signed-in drawer check on `main` (throwaway build dropped); hand-off close must bypass the busy gate (`setPhase(idle)` then `onUpgrading` is synchronous); `paymentsConfigured` from `usePlanFlow`; `onCancel` only from "Not now"; §13 gains `layers` / `view` rows; §14 rewritten as the user's run sheet + S-17; row 20 last sentence reworded. Estimate 2.5 d accepted |
| 2026-10-20 | Implemented (Dev), uncommitted | Merged `origin/main` (#483) by fast-forward. User decisions UD-1 (skip the pre-build drawer 3-D Secure check; batch every live check into one end-of-stream session after UM-2 / UM-3), UD-2 (he / es for "See plans" / "Back to plans" approved), UD-3 (X unchanged). W-1a jsdom probe: `body` gets `pointer-events: none`, so mitigation (iii) applied while busy; focus not pulled back while busy (recorded). Built W-2 to W-8; deviations D-1 to D-6. §14 rewritten as the user's end-of-stream run sheet (W-6, incl. S-17, chained accounts); §15 row text per W-7. Runs: 76 / 76 suites, 1,686 tests; `test:bos-entitlements` 301 / 301, 9,131; `lint:hooks`, eslint, tsc clean. Screenshots in `scratchpad/um1b-shots/`. Status: Code Complete |
| 2026-10-20 | SA code review: FIX REQUIRED (CR-1, CR-2) | SA runs: 72 / 72 suites (1,492 tests), 4 guards (194), eslint and `lint:hooks` clean. Money paths, `autoStart` default, C-12, W-2, W-3, Q-5, Q-8, C-13 and the test mapping verified; the 3-D Secure style is removed on every exit path by construction. Required: CR-1 `paymentsConfigured` must not call `loadStripe` (pure key check in `stripeJs.ts`); CR-2 keep Stripe's frames reachable while a checkout frame is open too (`busy \|\| frameOpen`), with tests. SA re-checks only those two |
| 2026-10-20 | QA automated pass | 77 / 77 suites, 1,696 tests (incl. new `upgradeModal.flow.qa.render.test.tsx`, 10 tests: Escape with a frame open + reopen, close on the quote, double press → one checkout, SA Q-4 marker, `action_required` renewal, payload-checked no dead button); `test:bos-entitlements` 301 / 9,131; `lint:hooks` clean; request lines unchanged; 360 px Hebrew shots. No QA bugs; 4 low edge cases. §14 revised (three trial accounts, S-9 before S-7 / S-8, open Settings without `checkout=` before upgrade rows). Live checks deferred to the user's end-of-stream run |
| 2026-10-20 | SA code review CR-1 to CR-3 fixed (Dev) | CR-1: Stripe.js loaded only when a checkout is offered (deviation D-7: gated, not a new pure helper, to keep the twelve `stripeJs` mocks incl. QA's working); tests for no load on Autopilot / open-ended Founding Partner. CR-2: the Stripe-frames style also while a checkout frame is open; tests for present / gone after Back to plans / gone after X. CR-3: focus return by ref map. 77 / 77 suites, 1,700 tests; lint:hooks, eslint, tsc clean. Awaiting SA re-check of CR-1 / CR-2 |
| 2026-10-20 | SA re-check: CODE APPROVED | D-7 accepted for CR-1: Stripe.js loads only when a checkout is offered, and `paymentsConfigured` is correct without loading it, because nothing else reads it (tested for Autopilot and open-ended Founding Partner, with a trial control). CR-2 (style while `busy \|\| frameOpen`, tested) and CR-3 (ref-map focus return) verified. Settings suites 34 / 34, 651 tests; eslint clean |
