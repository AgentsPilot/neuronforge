# Workplan: Business OS Upgrade Modal, UM-3 "Conversion copy and polish"

> **Last Updated**: 2026-10-20

**Developer:** Dev
**Requirement:** [BUSINESS_OS_UPGRADE_MODAL_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_UPGRADE_MODAL_REQUIREMENT.md) §6 (CV-1 to CV-11), §9 (Accessibility, Responsive), §11 (UM-3 row)
**Earlier workplans:** [UM-0](/docs/workplans/BUSINESS_OS_UPGRADE_MODAL_UM0_WORKPLAN.md) · [UM-1a](/docs/workplans/BUSINESS_OS_UPGRADE_MODAL_UM1A_WORKPLAN.md) · [UM-1b](/docs/workplans/BUSINESS_OS_UPGRADE_MODAL_UM1B_WORKPLAN.md) · [UM-2](/docs/workplans/BUSINESS_OS_UPGRADE_MODAL_UM2_WORKPLAN.md)
**Branch:** `feature/bos-upgrade-modal-um3`, created by RM from UM-2's committed tip `73a6628d` in its own worktree (UM-2 SA X-6). Built there, uncommitted.
**Date:** 2026-10-20
**Status:** Code Complete (UM-3 + UM-D3), uncommitted, awaiting SA code review and QA
**Path:** UI short path (UM-SA11: confirmed for UM-3). Dev → SA code review + QA in parallel → the user sees the diff → RM. Live checks go into the single end-of-stream session (UM-1b UD-1), not mid-way.

## Overview

UM-3 is the last slice of the upgrade modal. It adds **no new data, route, payload field or entitlements import**. It does three things:

1. **Conversion copy.** It goes through every recommended idea in §6 (CV-1 to CV-11) against what UM-0 to UM-2 already shipped. It adds the one CV-5 sentence that is still missing, plus a translated "Close". It records why each of the other ideas is done, superseded or out of scope. Every new string comes with he / es drafts, collected into **one** table (§6) for one batched user approval.
2. **Accessibility pass.** Contrast on and around the band (C-9), the muted small text left over from UM-1a, the light-indigo link and the islands' buttons; focus order; screen-reader names, including the English-only "Close" deferred by UM-1a Q-4. Each item has a stated test method (§7).
3. **Phone polish at 360 px.** The headline wraps (UM-1a D-7); the trial sentence sits under an open card form (UM-1b QA edge case 2); only about 220 px of card form is visible (UM-1b QA edge case 3).

---

## Table of Contents

1. [Scope and inputs](#1-scope-and-inputs)
2. [What UM-3 must respect](#2-what-um-3-must-respect)
3. [Analysis summary](#3-analysis-summary)
4. [CV-1 to CV-11: status and decision](#4-cv-1-to-cv-11-status-and-decision)
5. [Implementation approach](#5-implementation-approach)
6. [Copy for one batched user approval](#6-copy-for-one-batched-user-approval)
7. [Accessibility checklist and how each item is tested](#7-accessibility-checklist-and-how-each-item-is-tested)
8. [Phone at 360 px](#8-phone-at-360-px)
9. [Files to create / modify](#9-files-to-create--modify)
10. [Task list and estimate](#10-task-list-and-estimate)
11. [Tests and guards](#11-tests-and-guards)
12. [End-of-stream run sheet additions](#12-end-of-stream-run-sheet-additions)
13. [Risks](#13-risks)
14. [Open questions for SA](#14-open-questions-for-sa)
15. [Needs the user](#15-needs-the-user)
16. [Logging](#16-logging)

---

## 1. Scope and inputs

**Requirement §11, UM-3 row:** "The recommended copy from §6 (CV-1 to CV-8) in en / he / es, with the user's approval of the he / es wording; the a11y pass (contrast on the gradient, focus order, screen-reader names); a mobile check at 360 px. No new data. 1.5 d." This workplan covers CV-1 to CV-11, as the brief asks. CV-9 to CV-11 are mostly recorded as out of scope or already done (§4).

**Items deferred to UM-3 by the earlier slices** (each one is either handled here or marked "not doing", with the reason):

| # | From | Item | UM-3 handling |
|---|---|---|---|
| D-1 | UM-1a R-4 / Q-4 (SA: "record it as a UM-3 (a11y) item") | The built-in X's screen-reader name is the English "Close" in he / es (`dialog.tsx` hard-codes `<span className="sr-only">Close</span>`) | §5.4. Needs a decision, because UM-1b UD-3 recorded "keep the current X with its existing accessible name". SA Q-1 and user item U-2 |
| D-2 | UM-1a D-7 / SA "A UM-3 polish item" | On a 360 px phone the headline wraps to two lines (three in Hebrew) because the band reserves `pe-[25%]` for the gradient | §8.1: layout fix, no copy change |
| D-3 | UM-1a SA note / QA item 3 | `--v2-text-muted` (#9CA3AF) small text is about 2.5:1 on white (price suffix, section headings, footer, "Current plan" label, flow price line, "Coming soon" chip, unavailable reason) | §5.2 / §7 A-4 |
| D-4 | UM-1a SA note | Phone trial: the sticky footer holds four sentences (about 190 px); "consider folding the B7 sentence into the status strip in UM-3" | §8.2: B7 hidden while a flow is open; the folding is SA Q-4 |
| D-5 | UM-1a QA item 1 | Rows show through above the sticky header | Already fixed in UM-1b (no top padding on the scroll body, comment in `UpgradeModal.tsx`). UM-3 re-checks it at 360 px and 1280 px only (§8.4 M-5) |
| D-6 | UM-1b QA edge case 2 | Trial's "nothing is charged before you choose one" (B7, `whenThisChanges`) stays in the footer under an open card form, next to the island's "Buying ends your free trial today, and the first month is charged now" | §8.2: hidden while a flow is open, as the free-access sentence and the own-plan note already are |
| D-7 | UM-1b QA edge case 3 | At 360 × 780 about 220 px of the Stripe card form is visible before scrolling | §8.3: compact band and footer during a flow. Target ≥ 300 px, measured |
| D-8 | UM-1b QA edge case 1 (Low, not explicitly deferred) | With `?checkout=…` still on the URL, the drawer button reads "See plans" but the window has nothing to press | §5.6, **optional**, SA Q-5 |
| D-9 | UM-1b QA edge case 4 | The X during the embedded checkout's own 3-D Secure abandons the session | No change (by design, Q-8); the live run observes it (UM-1b §14 S-4 / S-3) |
| D-10 | UM-2 Q-11 (SA: "UM-3 may refine it") | The `locked_feature` subheading is generic ("See what {plan} includes, side by side with the other plans.") | Kept. A "what the plan adds" sentence would need `nextPlanUp` joined to an arbitrary plan, which is a client rule (§4, CV-1) |
| D-11 | UM-0 Q-5 | A per-member highlight on the grouped "Team seats · locations" row is "UM-3 polish if ever wanted" | **Not doing.** It would need a per-member highlight from the server (new data), and C-21 forbids the UI from deciding a highlight |

**Not in UM-3:** a real `locked_feature` caller (UM-F2); deciding when or whom the Founding Partner prompt is shown (UM-F1); returning to the opening page after checkout (UM-F3); founder discount (UM-F4, P-11); "Cancel anytime" (CV-10, until P-7a ships); social proof, annual prices (CV-12, CV-13, UM-F6); any change to `my-plan`, the checkout or upgrade routes, `customerPlanView.ts` or the entitlements module.

---

## 2. What UM-3 must respect

| Rule | How this workplan keeps it |
|---|---|
| **§6 / UM-FR10 / AC-UM14:** no fake urgency, countdowns, "most popular", social proof, pre-ticked options, confirm-shaming; closing always one click | No new string mentions time pressure, other customers or loss. The close label stays neutral ("Close", "Back to your plan"). The guard gains a word list (§11, guard U3-c) |
| **No figures in labels** (UM-2 §8, UM-0) | No new value contains a digit or a currency sign. Prices and dates come only from the payload, through existing slots. Guard U3-c checks for digits |
| **C-9:** small white text only on `--v2-primary-dark`; the gradient only behind large text or as decoration; mirrored in RTL; checked on the computed tokens, light and dark | §7 A-1 to A-3. The phone band change (§8.1) keeps the text off the gradient. The islands' white `text-xs` buttons on `--v2-primary` (4.47:1, below AA) move to `--v2-primary-dark` (SA Q-3) |
| **C-23:** ✕ reads "Not included"; nothing matches the `noExclusions` phrasing ("not included in your plan", "you do not have") in any language | No ✕ wording changes. Guard (i) already covers every `upgrade_modal.*` value; the new keys fall under it automatically |
| **C-21:** the UI decides no row, ✓ / ✕, highlight, label or order | No change to `sections` or cells. The new subheading variant is derived from **column actions** (the server's offer), the same way the headline already is. CV-8 (a note under the Credits row) is **not** done client-side, because picking "the credits row" would be a client rule about rows (§4) |
| **C-6 / `business-os-entitlements` skill:** zero imports from `lib/business-os/entitlements/` in client files, type-only included | No new import. `npm run test:bos-entitlements` runs on the final diff anyway, because the skill requires it for any work near the module, and guard (d) stays |
| **C-7:** no tier id literal in product code | No tier id anywhere. Test fixtures stay in `components/business-os/settings/__tests__/` |
| **C-8:** `dialog.tsx` unchanged unless SA approves | The only `dialog.tsx` change in this plan (an optional `closeLabel` prop, §5.4) depends on SA Q-1 **and** user U-2. Without both, D-1 is recorded as "kept English, by decision" |
| **Guard (f):** tokens only, no hex, no `dark:` override | Every colour fix in this plan is a token swap. None uses `dark:`, which is why the indigo link becomes a text-primary link (§7 A-5) |
| **UM-1b UD-1:** live checks happen in one end-of-stream session | §12 adds UM-3's rows to the UM-1b §14 sheet (and UM-2 §13). No live check mid-way |
| **Memory "Never git stash" / worktree hazards** | Never stash, never switch branches inside a worktree, never remove the `node_modules` junction |

---

## 3. Analysis summary

| Area | Touched? | Notes |
|---|---|---|
| `components/business-os/settings/UpgradeModal.tsx` | Yes | Token swaps, phone band and footer during a flow, subheading variant, footer close label, `closeLabel` on `DialogContent` (if approved) |
| `components/business-os/settings/upgradeModalView.ts` | Yes, small | One derived field, `subheading` gains `'upgrade'` (UM-2 adds `'default' \| 'locked_feature' \| 'founding_partner'`) |
| `components/business-os/settings/PlanPurchase.tsx`, `PlanUpgrade.tsx` | Yes, classes only (SA Q-3) | `PRIMARY_BUTTON` white `text-xs` on `--v2-primary` → `--v2-primary-dark`; muted small lines → `--v2-text-secondary` inside the flow. The islands render only in the modal since UM-1b (C-12), so this changes no other surface. Requests, payloads and test ids unchanged (UM-FR4, C-5) |
| `components/business-os/settings/PlanSection.tsx` | Only if SA Q-5 = yes | The "See plans" label uses `hasActions && (checkoutAllowed \|\| upgradeAllowed)` |
| UM-2's standalone host (`StandaloneUpgradeModal`) | One prop | Passes `closeLabel="close"` so the standalone footer reads "Close" (§5.5) |
| `components/ui/dialog.tsx` | Only if SA Q-1 and user U-2 agree | An optional, additive `closeLabel?: string` prop, default `'Close'`. Every existing caller is unchanged |
| `lib/business-os/translations/{en,he,es}.ts` | Yes | +2 keys, maybe +1 (§6) |
| Server, routes, DB, entitlements module | **No** | — |

Current a11y baseline (read on the UM-2 worktree at `2bde7a81`, UM-1b committed):

| Already right | Source |
|---|---|
| Band text on solid `--v2-primary-dark` (≈ 6.3:1); the gradient is a decorative `aria-hidden` layer at the end edge, mirrored in RTL | UM-1a Q-5, `plan-compare-band` |
| Dialog title = headline, description = subheading; initial focus on the title (Enter buys nothing); focus returns to the opener | UM-1b Q-6 |
| A semantic table with explicit ARIA roles at every width; caption "Plan comparison"; each cell's sr text "{plan}: {state}" | C-24, C-23 |
| ✓ and ✕ differ in shape, not only colour; icons `aria-hidden` | WCAG 1.4.1 |
| "Current plan" is a span with no role (no dead control) | C-22, guard (j) |
| Busy region `aria-busy`; the islands' outcomes have their own live regions | UM-1b |

---

## 4. CV-1 to CV-11: status and decision

| # | Idea (§6) | Status after UM-0 to UM-2 | UM-3 decision |
|---|---|---|---|
| CV-1 | Outcome headline per context | Done: `choose`, `top_plan`, `compare` (UM-1a), `locked_feature`, `founding_partner` (UM-2), he / es approved for UM-1a | **Keep.** The phone wrap (D-2) is fixed by layout, not by shortening approved copy. The `locked_feature` subheading stays generic (D-10) |
| CV-2 | Big price, small "a month, excluding tax" | Done (`upgrade_modal.price_suffix`, M-8 wording) | **Keep.** Contrast fix only (A-4: muted → secondary) |
| CV-3 | "Everything in {current}, plus:" | **Superseded** by the table (C-26) | Not reintroduced |
| CV-4 | Credits jump as before → after | **Superseded**: the server's `highlight` on the higher value carries it (C-26, F-2) | Not reintroduced. No figure may be typed into a label |
| CV-5 | For Essentials payers: "Applies immediately. You pay only the difference for the rest of this month." | **Half done.** "Applies immediately" is in the flow (`plan.upgrade.immediate`, beside Confirm). The "only the difference" reassurance is nowhere before pressing Upgrade | **Add** `upgrade_modal.subheading.upgrade`, shown in the `settings` context when any column's action is `upgrade` (the server's offer). Wording says "billing period", not "month": the period is the subscription's, not the calendar month (SA Q-2 confirms the proration claim) |
| CV-6 | One highlighted column, one primary button per state | Done: one Recommended column; its two buttons (header and footer) are one flow (C-25); other columns use the secondary style. In the flow, the islands' Confirm / Try again are the only primary buttons | **Keep.** Contrast fix on the islands' primary button (A-3) |
| CV-7 | Founding Partner "Keep everything you have" | UM-2 (headline + subheading drafts, SA Q-3 accepted) | **Keep** UM-2's wording. If UM-2's he / es are still pending when UM-3 is reviewed, they are listed again in §6 so the user approves everything once |
| CV-8 | Plain-language note under Credits | The note exists only in `included` (current plan, `noteKey`, chosen by the allowance's shape: monthly or one-off). `comparison` rows carry **no** note | **Not done in UM-3** (Dev proposal; SA Q-6). Attaching it to "the credits row" means the client picks a row (C-21), and the `included` note describes the account's own allowance (a trial's is one-off), not the plans in the table. The right fix is a server-chosen `noteKey` on a comparison row, which is new data: proposed follow-up **UM-F8** |
| CV-9 | One benefit sentence per added capability | Optional; needs copy per capability from config (UM-SA4) | **Out of scope** (new server copy) |
| CV-10 | "Cancel anytime" | Only after P-7a ships in-app cancel. P-7a has not shipped | **Not shown** (UM-FR10, AC-UM14). Guard U3-c forbids it |
| CV-11 | Full contents on every column | Done by UM-0 (`comparison`) | Nothing to do |
| CV-12 / CV-13 | Social proof; annual price | Not now / out of scope | Not shown. Guard U3-c forbids social-proof words |

---

## 5. Implementation approach

### 5.1 Copy keys (Task 2)

Two new keys, plus a third if SA Q-1 is approved: `upgrade_modal.subheading.upgrade` and `upgrade_modal.close` (§6). Each goes into all three dictionaries in the "Your plan" block, next to UM-2's keys, and `dictionariesStayInStep` keeps them in step.

**View:** `upgradeModalView` already returns `subheading` (UM-2: `'default' | 'locked_feature' | 'founding_partner'`). UM-3 adds `'upgrade'`, chosen **only** when the final variant is `settings` **and** some column has `action === 'upgrade'`. `locked_feature` and `founding_partner` keep their own subheadings. The input is the server's offer per column, never a plan id or name (C-7, UM-FR7). The `action` per column does not change (UM-FR8 test over every fixture × context stays green).

### 5.2 Contrast token swaps (Task 1)

Inside `UpgradeModal.tsx`, every `--v2-text-muted` used for **text** becomes `--v2-text-secondary`. That is #6B7280: about 4.8:1 on white, about 4.6:1 on the current-column and recommended tints. Dark mode uses #CBD5E1 on #1E293B. The swap covers the price suffix, section headings, footer notes, the "Current plan" label, the flow's price line, the "Coming soon" chip and the unavailable reason. The token stays as is platform-wide (the drawer has 20 uses; out of scope).

Inside the islands (SA Q-3), the small `text-[var(--v2-text-muted)]` lines rendered in the flow get the same swap. `PRIMARY_BUTTON` (`bg-[var(--v2-primary)]`, white `text-xs`, 4.47:1) becomes `bg-[var(--v2-primary-dark)]`, as the modal's own primary button already is (C-9). The class strings change and nothing else does: test ids, requests and copy stay the same.

"Back to plans" (`text-[var(--v2-primary)]`, 14 px) is 4.47:1 on white and about 3.2:1 on the dark surface, so it fails in both themes. `--v2-primary-dark` has no dark override (≈ 2.3:1, UM-1a F-2), and guard (f) forbids `dark:`. So the link becomes `text-[var(--v2-text-primary)]`, `underline` with an offset, and keeps the chevron. Its link-ness then comes from the underline and the icon, not from colour (WCAG 1.4.1).

### 5.3 Phone band, footer and flow height (Task 3)

Details are in §8. The changes are CSS classes and one condition in `UpgradeModal.tsx`; the DOM order does not change.

### 5.4 Translated screen-reader name for the X (Task 4, conditional)

`dialog.tsx` hard-codes `Close`, so the only route that keeps C-8's "no hidden duplicate X" rule is an **additive** prop on `DialogContent`: `closeLabel?: string`, default `'Close'`, rendered in the existing `sr-only` span. No other caller changes, and a test pins the default. The modal passes `t('upgrade_modal.close')`. This needs **SA Q-1** (a `dialog.tsx` change under C-8) **and user U-2**, because UM-1b UD-3 recorded "keep the current X with its existing accessible name". Dev reads UD-3 as being about the X's look and behaviour in UM-1b, but that is the user's call. If either says no: no change; the decision is recorded in the requirement and A-9 is closed as "accepted".

### 5.5 Footer close label in the standalone window (Task 5)

In Settings the footer button reads "Back to your plan" and goes back to the drawer. In UM-2's standalone window there is no drawer behind it, so "Back to your plan" is untrue. `UpgradeModal` gains `closeLabel?: 'back_to_plan' | 'close'` (default `'back_to_plan'`). `StandaloneUpgradeModal` passes `'close'` → `upgrade_modal.close`. This is copy only: the button stays the same `DialogClose`.

### 5.6 Optional: "See plans" label while a checkout marker is on the URL (Task 6, SA Q-5)

`PlanSection` uses `hasActions && (flow.checkoutAllowed || flow.upgradeAllowed)` for the "See plans" / "Compare plans" choice. Both are existing `usePlanFlow` values, so no new rule and no read. Without it the user keeps the UM-1b note in S-5 / S-6. Dev recommends doing it (0.1 d), because the label otherwise promises a button that is not there.

---

## 6. Copy for one batched user approval

**One question to the user**, by TL after SA review. English is Dev's proposal; he / es are **drafts**. No figure in any value; nothing claims what a plan lacks; no urgency or social proof.

### 6.1 New in UM-3

| # | Key | Where it shows | en | he (draft) | es (draft) |
|---|---|---|---|---|---|
| UC-1 | `upgrade_modal.subheading.upgrade` | Band subheading, Settings context, when the server offers an upgrade (Essentials owner). CV-5 | Upgrade any time. You pay only the difference for the rest of your billing period. | אפשר לשדרג בכל עת. משלמים רק את ההפרש על יתרת תקופת החיוב הנוכחית. | Mejora cuando quieras. Solo pagas la diferencia por lo que queda de tu periodo de facturación. |
| UC-2 | `upgrade_modal.close` | Footer close button in the standalone window (§5.5); and, if U-2 = yes, the X's screen-reader name everywhere in the modal | Close | סגירה | Cerrar |

### 6.2 Kept as approved (shown for context; no action needed)

| Key | en | Status |
|---|---|---|
| `upgrade_modal.headline.choose` / `.top_plan` / `.compare` | Choose the plan that fits your business / You're on our top plan / Compare our plans | Approved (UM-1a, 2026-10-20). Phone wrap fixed by layout (§8.1) |
| `upgrade_modal.subheading` | See what each plan includes, side by side. | Approved (UM-1a); stays the default subheading |
| `upgrade_modal.open_see_plans`, `.back_to_plans` | See plans / Back to plans | Approved (UM-1b UD-2) |
| `upgrade_modal.back_to_plan` | Back to your plan | Approved (UM-1a); still the Settings footer label |

### 6.3 Carried from UM-2, only if still pending at UM-3 review

UM-2 §8 drafts. If the user has already approved them in UM-2's own question, TL removes this block before asking.

| Key | en | he (draft) | es (draft) |
|---|---|---|---|
| `upgrade_modal.headline.locked_feature` | This needs {plan} | לשם כך צריך את {plan} | Esto requiere {plan} |
| `upgrade_modal.subheading.locked_feature` | See what {plan} includes, side by side with the other plans. | מה כוללת {plan}, לצד התוכניות האחרות. | Mira lo que incluye {plan}, junto a los demás planes. |
| `upgrade_modal.locked.not_offered` | {plan} can't be bought from your account right now. | כרגע לא ניתן לרכוש את {plan} מהחשבון שלך. | Ahora mismo no puedes comprar {plan} desde tu cuenta. |
| `upgrade_modal.headline.founding_partner` | Keep everything you have | שומרים על כל מה שיש לך | Conserva todo lo que tienes |
| `upgrade_modal.subheading.founding_partner` | Choose a plan to carry on without a break. | בוחרים תוכנית וממשיכים בלי הפסקה. | Elige un plan y sigue sin interrupciones. |
| `upgrade_modal.badge.needed` | Needed for this | נדרשת לשם כך | Necesario para esto |

### 6.4 Decided not to add (for the record)

| Idea | Why not |
|---|---|
| "Cancel anytime" (CV-10) | P-7a not shipped; UM-FR10 |
| "Most popular", "Join N businesses" (CV-12) | No real data; §6 |
| A Credits explanation under the Credits row (CV-8) | The client would pick the row (C-21); needs a server note (UM-F8, SA Q-6) |
| "Limited time", a countdown, a dated offer | §6: no fake urgency |
| A shorter phone headline | The approved copy stays; layout fixes the wrap |

---

## 7. Accessibility checklist and how each item is tested

Tools: Jest + Testing Library (accessible-name queries, which compute names the way browsers do), a **test-only** WCAG contrast helper that reads the token hex values from `app/v2/globals-v2.css` (no product code, no new dependency), source guards, and QA's headless-Chrome screenshots at 360 / 1280 px with the project CSS, as in UM-1a / UM-1b. **No `jest-axe` or other new tool**: adding one is a new pattern (CLAUDE.md Testing), and the checks below do not need it. The user's end-of-stream run adds one screen-reader pass with Windows Narrator (built in, nothing to install).

| # | Item | Criterion | Change | How tested |
|---|---|---|---|---|
| A-1 | Band headline and subheading | White on `--v2-primary-dark` ≥ 4.5:1 (C-9) | None (already right) | Contrast test: white vs `--v2-primary-dark` ≥ 4.5 (light; primary is not overridden in dark). Guard (f) keeps the text off the gradient. QA screenshot: the text box does not overlap the gradient layer at 360 / 1280, en and he |
| A-2 | X icon on the band's gradient end | Non-text ≥ 3:1 (1.4.11) | None | Contrast test: white vs `--v2-secondary` ≥ 3 and vs `--v2-primary-dark` ≥ 3 |
| A-3 | Primary buttons (modal and islands) | White `text-sm` / `text-xs` ≥ 4.5:1 | Islands `--v2-primary` → `--v2-primary-dark` (SA Q-3) | Contrast test on the pair; guard U3-a: no `bg-[var(--v2-primary)]` with `text-white` in `UpgradeModal.tsx`, `PlanPurchase.tsx`, `PlanUpgrade.tsx` (planted-violation control) |
| A-4 | Small grey text (price suffix, section headings, footer, "Current plan", flow price, chip, unavailable reason) | ≥ 4.5:1 light and dark, on the surface **and** on both column tints | `--v2-text-muted` → `--v2-text-secondary` for text in the modal (and in the islands, SA Q-3) | Contrast test: `--v2-text-secondary` vs `--v2-surface`, `--v2-surface-hover`, and `--v2-primary` at 5 % over the surface, light and dark. Guard U3-b: no `text-[var(--v2-text-muted)]` in `UpgradeModal.tsx` (control) |
| A-5 | "Back to plans" link | ≥ 4.5:1 both themes; not colour-only | `text-[var(--v2-text-primary)] underline` + chevron | Contrast test; render test: the link has the class and the name "Back to plans" |
| A-6 | ✓ / ✕ marks and highlight | Non-text ≥ 3:1; meaning in words | None expected; `--v2-success-icon` on its tint is close to 3:1 in dark mode | Contrast test (light and dark). If dark mode fails, the mark's text token is swapped (it stays a token) and the change is reported to SA. Existing sr text tests stay |
| A-7 | Focus order | Logical and complete (2.4.3); visible focus (2.4.7) | None planned | Render test (existing UM-1b keyboard test, extended): title → header buttons in column order → footer buttons → footer close → X, in en and **he** (DOM order, so RTL keeps the logical sequence while the columns mirror visually). In a flow: Back to plans → flow heading → island controls → footer close → X. The X is last in DOM because `dialog.tsx` appends it; Dev accepts that (SA Q-7) rather than editing `dialog.tsx` for order. QA: each focus ring visible in light and dark (screenshots) |
| A-8 | Dialog name and description | Name = headline; description = the subheading actually shown | New subheading variant | Render test: `getByRole('dialog', { name })` and `toHaveAccessibleDescription` per variant (`default`, `upgrade`, `locked_feature`, `founding_partner`) in en / he / es |
| A-9 | X's screen-reader name | In the reader's language | `closeLabel` (if SA Q-1 + U-2) | Render test: `getByRole('button', { name: 'סגירה' })` in Hebrew; `dialog.tsx` default test: name "Close" when no prop (every other dialog). If not approved: recorded as accepted |
| A-10 | Column headers | Each named, includes the plan name and its marker ("Recommended" / "Your plan") | None planned | Render test: `getAllByRole('columnheader')` names contain the plan name and, on the marked column, the badge text. Dev does **not** add an `aria-label` (it would hide the badge) unless SA asks (Q-7) |
| A-11 | Cells | "{plan}: Included / Not included / {value}" | None | Existing tests; one new he case asserting `לא כלול` |
| A-12 | Buttons | Every button named; no dead control | None | Existing "no dead button" test, plus the standalone footer named "Close" |
| A-13 | Target size | ≥ 24 × 24 or spaced (2.5.8) | None expected | QA measures in headless Chrome: column buttons ≈ 36 px high; the X is 16 px but has no other target within 24 px (spacing exception). Recorded |
| A-14 | Reflow at 360 px / 400 % zoom | No horizontal scroll (1.4.10) | §8 | QA: `scrollWidth ≤ clientWidth` on the dialog and the scroll body at 360, en / he, table and both flows |
| A-15 | Status and busy messages | Announced (4.1.3) | None | Existing island live-region tests; QA Narrator row in §12 |

---

## 8. Phone at 360 px

### 8.1 Headline wrap (D-2)

Today the gradient layer is `w-1/4` and the text column reserves `pe-[25%]` (phone) / `pe-[22%]` (sm+). At 360 px that leaves about 230 px for the headline. Proposal: **below `sm` only**, the gradient becomes a narrow strip under the X (`max-sm:w-14`), and the text column's reservation becomes the band's existing `pe-12` (the X's space), dropping `pe-[25%]` below `sm`. Desktop is unchanged. The text still never sits on the gradient (C-9), because the strip is no wider than the reserved space. **Target:** the English headline on two lines and the Hebrew one on two lines at 360 px (today three), measured from QA screenshots.

### 8.2 Footer during a flow (D-4, D-6)

While a flow is open the footer already hides the free-access sentence, the own-plan note and "not set up". UM-3 hides **B7** (`whenThisChanges`) too, for the same reason: the island states the purchase terms beside its own button, and "nothing is charged before you choose one" under an open card form contradicts them. In the table view B7 stays where it is. **Folding B7 into the status strip** (UM-1a SA note) is SA Q-4. Dev recommends not doing it: the strip is one line by design ("You're on {plan} · {price} · {ending}"), and B7 is a full sentence.

### 8.3 Card form height (D-7)

The space comes from three phone-only changes while a flow is open:

1. The footer then holds one line ("Prices in USD…") plus the close button: B7 is hidden (§8.2). Gain: about 40–60 px for a trial.
2. The band's subheading becomes `max-sm:sr-only` while a flow is open. It stays the dialog's description, so screen readers are unaffected, and the band loses about 25 px.
3. The band padding drops to `max-sm:py-3` while a flow is open (about 16 px).

**Target:** ≥ 300 px of the Stripe frame visible at 360 × 780 before scrolling (today ≈ 220). QA measures it on the screenshots (`qa-360-flow-checkout-*`). The real Stripe form is judged by the user in S-3p.

### 8.4 360 px checks QA runs (headless Chrome, project CSS, en + he, light + dark)

| # | Check | Pass |
|---|---|---|
| M-1 | Table view, trial and Essentials owner | No horizontal scroll; both columns side by side; sticky header works |
| M-2 | Headline lines | ≤ 2 lines en and he |
| M-3 | Checkout flow (trial) | ≥ 300 px of frame area visible; no B7 under the frame; no horizontal scroll |
| M-4 | Upgrade flow (Essentials) | Quote, Confirm and Not now visible without horizontal scroll; Confirm reachable |
| M-5 | Scrolled table | Nothing visible above the sticky header (UM-1a QA item 1 stays fixed) |
| M-6 | Standalone window (UM-2 demo page) | Footer reads "Close"; same layout |

---

## 9. Files to create / modify

| File | Action | Reason |
|---|---|---|
| `components/business-os/settings/UpgradeModal.tsx` | modify | Token swaps (A-4, A-5), phone band / footer in a flow (§8), subheading variant, `closeLabel` prop, `closeLabel` to `DialogContent` (if approved) |
| `components/business-os/settings/upgradeModalView.ts` | modify | `subheading: 'upgrade'` from the column actions |
| `components/business-os/settings/PlanPurchase.tsx`, `PlanUpgrade.tsx` | modify (classes only, SA Q-3) | A-3, A-4 inside the flow |
| UM-2's `StandaloneUpgradeModal` file | modify (one prop) | §5.5 |
| `components/business-os/settings/PlanSection.tsx` | modify only if SA Q-5 = yes | §5.6 |
| `components/ui/dialog.tsx` | modify only if SA Q-1 + U-2 = yes | Additive `closeLabel` (§5.4) |
| `lib/business-os/translations/en.ts`, `he.ts`, `es.ts` | modify | UC-1, UC-2 |
| `components/business-os/settings/__tests__/upgradeModal.contrast.test.ts` | create | Test-only WCAG ratio helper over the `globals-v2.css` tokens, light and dark (A-1 to A-6) |
| `components/business-os/settings/__tests__/upgradeModal.guard.test.ts` | modify | Guards U3-a to U3-c with planted-violation controls (§11) |
| `components/business-os/settings/__tests__/UpgradeModal.render.test.tsx`, `upgradeModal.flow.render.test.tsx`, `upgradeModalView.test.ts` | modify | A-7 to A-12, B7 hidden in a flow, subheading variants, standalone "Close" |
| `components/ui/__tests__/dialog…` (existing or new) | modify / create, only with §5.4 | The default name stays "Close" |
| `docs/requirements/BUSINESS_OS_UPGRADE_MODAL_REQUIREMENT.md` | modify | Status, CV decisions (§4), UM-F8, the D-1 decision, run sheet rows (memory: always update the main requirement) |
| `docs/workplans/BUSINESS_OS_UPGRADE_MODAL_UM1B_WORKPLAN.md` §14 | **QA** appends §12's rows (Dev does not edit it) | One end-of-stream sheet |

---

## 10. Task list and estimate

| # | Task | Est. |
|---|---|---|
| ✅ 0 | Confirm the branch `feature/bos-upgrade-modal-um3` (own worktree, from UM-2's tip). Baseline: settings + settings page + `components/business-os/__tests__` + billing + `components/test-business-os` + `app/invite` + the guards; `test:bos-entitlements`; record counts | 0.05 d |
| ✅ 1 | Contrast: modal muted → secondary, "Back to plans" link, islands' primary button and small lines (after SA Q-3); write `upgradeModal.contrast.test.ts` first (red on today's island button and muted text, then green) | 0.3 d |
| ✅ 2 | Copy: UC-1 / UC-2 in en / he / es; `subheading: 'upgrade'` in the view + unit tests (only `settings`, only with an `upgrade` action; UM-FR8 matrix unchanged) | 0.15 d |
| ✅ 3 | Phone: band strip and text reservation below `sm`; B7 hidden in a flow; subheading `sr-only` and tighter band padding in a flow on phone; render tests | 0.25 d |
| ✅ 4 | (SA Q-1 approved; U-2 dropped) `dialog.tsx` `closeLabel` + default test; modal passes `t('upgrade_modal.close')` | 0.1 d |
| ✅ 5 | Standalone footer `closeLabel: 'close'` + test | 0.05 d |
| ~~6~~ | **Dropped by D3-13** (a checkout marker now always opens the pop-up). Was: (If SA Q-5) "See plans" label with `checkoutAllowed \|\| upgradeAllowed` + drawer tests | 0.1 d |
| ✅ 7 | A11y render tests A-7 to A-12 (en / he / es); guards U3-a to U3-c with controls | 0.25 d |
| ✅ 8 | Own 360 / 1280 screenshots (M-1 to M-6) for the SA review; final runs (suites, `test:bos-entitlements`, `lint:hooks`, eslint, tsc on touched folders, `git diff --numstat`); requirement update; Implementation Notes | 0.25 d |
| | **Total** | **≈ 1.5 d** (1.3 d without the optional Tasks 4 and 6) |
| ✅ D3-a | Decision function + page wiring + pending / fallback (D3-1, D3-3, D3-4) | 0.5 d |
| ✅ D3-b | Session props, `afterCheckout: 'stay'`, inline host, footer close (D3-2, D3-7, D3-10, D3-11) | 0.4 d |
| ✅ D3-c | Strip: badge, B3 / B4, B8 disclosure, shared markup (D3-5, D3-6) | 0.3 d |
| ✅ D3-d | Warm-read hand-over + request-count tests + guard re-maps (D3-8, D3-12) | 0.45 d |
| ✅ D3-e | Docs; run-sheet rows below, hand-over to QA for the UM-1b §14 / UM-2 §13 sheets (D3-13, D3-14) | 0.1 d |

---

## 11. Tests and guards

**New guards** in `upgradeModal.guard.test.ts`. Letters continue after UM-2's last guard; the names below are placeholders. Each has a planted-violation control, read through the CRLF-normalising `read()` (UM-1b D-4):

| # | Pins | Control |
|---|---|---|
| U3-a | No `bg-[var(--v2-primary)]` with `text-white` on one element in the modal or the islands (C-9) | Plant the old `PRIMARY_BUTTON` |
| U3-b | No `text-[var(--v2-text-muted)]` in `UpgradeModal.tsx` | Plant one |
| U3-c | No `upgrade_modal.*` value, in any language, contains a digit, a currency sign, or a word from an urgency / social-proof / cancel list ("only today", "limited", "popular", "businesses already", "cancel anytime", and he / es equivalents) (§6, UM-FR10, no figures). `{…}` slots are allowed | Plant "Limited time" and a "$" value |

**Unchanged and must stay green:** guards (a) to (o) and UM-2's additions; `tierLiteral.forbidden`; `enforcementPoints`; `dictionariesStayInStep`; `creditFigures.fromConfig.guard`; the C-27 two-plan tripwire; `planComparison.twoPlans.tripwire`; every island test id (C-5). The UM-FR8 "context never changes `action`" matrix gets the new `'upgrade'` subheading case added, and none removed.

**No assertion is deleted.** Where a class assertion changes (e.g. a test that pinned `--v2-text-muted`), the workplan's Implementation Notes map it old → new, as in UM-1a / UM-1b.

---

## 12. End-of-stream run sheet additions

> **QA, 2026-10-20 (UM-3 D3-13):** these rows now live in the single MASTER sheet, [UM-1b workplan §14](/docs/workplans/BUSINESS_OS_UPGRADE_MODAL_UM1B_WORKPLAN.md#14-the-users-end-of-stream-run-sheet-w-6--master), re-worded for UM-D3 and in one running order. Run that sheet, not this table.

QA appends these rows to the UM-1b §14 sheet (after UM-2's U2-1 to U2-7, UM-2 §13) for the user's single end-of-stream session (UM-1b UD-1). The same accounts are used: Trial A / B / C and the Founding Partner of §14. No new account. Agents never sign in or handle keys.

| # | Account | Click steps | Expected | Observed |
|---|---|---|---|---|
| U3-1 | Trial A **before** S-2 (still a trial), 360 px | See plans → Choose Autopilot → look at the card form | No "nothing is charged before you choose one" under the form; the headline is on two lines at most; the card form area starts high enough that the card number field is visible without scrolling | |
| U3-2 | Trial B **after** S-5 (Essentials) | Settings → Your plan (D3-13: the pop-up opens from the row) | The subheading reads "When you upgrade, you pay only the price difference for the rest of your current billing period." (the Hebrew / Spanish line in those languages) | |
| U3-3 | Trial B (Essentials), desktop and 360 px, light and dark | Look at every small grey line (price "a month, excluding tax", section headings, footer), the "Back to plans" link, and the Confirm button in the upgrade flow | All comfortably readable; "Back to plans" is underlined; Confirm is the darker indigo | |
| U3-4 | Any, Hebrew | Windows Narrator on (Ctrl + Win + Enter) → open the window → Tab through, then off (Ctrl + Win + Enter) | Narrator reads the Hebrew title and subheading; each column button by name; the X as "סגירה" (only if U-2 = yes; otherwise "Close", as decided) | |
| U3-5 | Any, standalone (UM-2 demo page) | Demo → "Open: settings" → look at the footer button | It reads "Close" (סגירה / Cerrar), not "Back to your plan" | |
| ~~U3-6~~ | — | **Dropped by D3-13**: a checkout marker now always opens the pop-up | — | |
| U3-7 | Trial A (before S-2), DevTools → Network → "Slow 3G" | Settings → Your plan | The row shows a spinner for about 2 s, then the **drawer** opens (its loading line, then the plan and "See plans"); the pop-up never replaces it | |
| U3-8 | Trial A (before S-2) | Settings → Your plan | The **pop-up** opens straight away; the strip reads "[Your plan] Test Flight · Free · Ends on …"; no plan column is marked "Your plan"; "What your plan includes" is collapsed and opens the drawer's list | |
| U3-9 | The payment-failed / 3-D Secure account of §14 (S-4 / S-3 state) | Settings → Your plan | "Use the link in Stripe's email…" / "Confirm your payment" shows at the top of whichever surface opens (pop-up strip or drawer); the link opens Stripe in a new tab | |
| U3-10 | Autopilot owner, and the open-ended Founding Partner | Settings → Your plan | The **drawer** opens, with "Compare plans" (view-only pop-up) | |

---

## 13. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | The island class changes look like a money change in review | Classes only; the request lines, payloads and test ids are unchanged, and the islands' suites pass unmodified apart from class pins mapped old → new |
| R-2 | The theme provider writes `--v2-primary` / `--v2-primary-dark` / `--v2-secondary` from platform custom tokens, so contrast measured on defaults can differ live (SA UM-SA3 note) | The contrast test uses the defaults (the source of truth in `globals-v2.css`). U3-3 checks the live theme. Any custom token that fails AA is a theme-config issue outside UM-3, reported, not patched in the modal |
| R-3 | The phone band change brings the text onto the gradient | The strip is narrower than the reserved space by construction; QA screenshot check A-1 at 360 px in en and he |
| R-4 | CV-5 overstates proration ("only the difference") for an account whose upgrade is billed differently (e.g. `due_later_small`: added to the next bill) | SA Q-2 confirms the claim against the upgrade route's proration behaviour. If not always true, the fallback line is "Upgrade any time. You see the exact amount before you confirm." |
| R-5 | `dialog.tsx` is shared by many dialogs | An additive prop with the default unchanged; a test pins the default; only if SA Q-1 + U-2 |
| R-6 | UM-2 is still in flight; its keys or view shape may change before UM-3 starts | UM-3 starts from UM-2's **final** committed tip (X-6). Task 0 re-reads UM-2's `subheading` type and its last guard letter, and Dev reports any drift to SA before coding |
| R-7 | Hiding B7 during a flow hides information a trial owner needs | The island states the purchase terms beside its button ("Buying ends your free trial today, and the first month is charged now"); B7 returns on "Back to plans" |
| R-8 | Worktree hazards | Never `git stash`; never remove the `node_modules` junction; no branch switch in a worktree |

---

## 14. Open questions for SA

| # | Question | Dev proposal |
|---|---|---|
| Q-1 | D-1: an additive `closeLabel?: string` on `DialogContent` (default `'Close'`), the only way to translate the X's sr name without a hidden duplicate X (C-8). Allowed? | Yes, subject to user U-2 (UD-3 recorded the opposite for UM-1b) |
| Q-2 | CV-5 wording: is "You pay only the difference for the rest of your billing period" true for every upgrade the server offers (proration behaviour in the upgrade route), including `due_now_zero` and `due_later_small`? | Yes for the common case; if not always, use the R-4 fallback |
| Q-3 | May UM-3 change the islands' classes (`PRIMARY_BUTTON` → `--v2-primary-dark`; muted → secondary inside the flow)? They render only in the modal since UM-1b (C-12). Precedent: UM-SA12 / C-13 | Yes, classes only |
| Q-4 | Fold B7 into the status strip (UM-1a SA note), or only hide it while a flow is open? | Only hide it in a flow |
| Q-5 | D-8: "See plans" label from `hasActions && (checkoutAllowed \|\| upgradeAllowed)`? | Yes (optional Task 6) |
| Q-6 | CV-8: agree that a Credits note in the table needs a server-chosen `noteKey` on a comparison row (follow-up UM-F8), and is not done client-side in UM-3? | Yes, defer to UM-F8 |
| Q-7 | Focus order with the X last in DOM, and column-header names left as their full content (badge + name + price + button), with no `aria-label`. Acceptable? | Yes to both |
| Q-8 | The standalone footer label: a `closeLabel: 'back_to_plan' \| 'close'` prop on `UpgradeModal`, set by UM-2's host? | Yes |

---

## 15. Needs the user

Batched by TL into **one** message after SA review:

1. **U-1:** approve the copy in §6.1 (and §6.3 if still pending): en wording and he / es drafts.
2. **U-2:** "Hebrew and Spanish screen-reader users currently hear the window's close button as the English word 'Close'. Translate it (סגירה / Cerrar)?" Recommended: yes. In UM-1b you chose to keep the X unchanged; this changes only what a screen reader says, not how it looks.
3. **U-3:** the six UM-3 rows (§12) join the end-of-stream session. No new account is needed.

---

## 16. Logging

`console.*` count in each file this slice may touch, on `2bde7a81`: `UpgradeModal.tsx` 0, `upgradeModalView.ts` 0, `PlanPurchase.tsx` 0, `PlanUpgrade.tsx` 0, `PlanSection.tsx` 0 (UM-1b §16 / UM-2 SA). Task 0 re-counts `dialog.tsx`, UM-2's standalone host and the dictionaries. Any count above zero is flagged to the user per CLAUDE.md § Logging. No new log line: UM-3 does no I/O.

---

## SA Review Notes

**Reviewed by SA — 2026-10-20**
**Status:** ✅ Approved with conditions Y-1 to Y-9

Read-only checks on the UM-2 worktree: `components/ui/dialog.tsx` (42 importers, 0 `console.*`, X hard-codes `<span className="sr-only">Close</span>`), `UpgradeModal.tsx` (X styled by `[&>button]:text-white [&>button]:opacity-90`), `PlanPurchase.tsx` / `PlanUpgrade.tsx` (`PRIMARY_BUTTON` = `bg-[var(--v2-primary)] … text-xs … text-white`; 8 muted lines), importers of the islands (only `UpgradeModal.tsx`; `PlanSection.tsx` and the settings page mention them in comments only), `globals-v2.css` tokens, `planUpgradeCopy.ts`, `planUpgrade.ts`, plan payments requirement §F7 / P-7b.1 / U-1.

### Rulings on Q-1 to Q-8

| # | Ruling |
|---|---|
| Q-1 | **Approved: additive `closeLabel?: string` on `DialogContent`, default `'Close'`.** The alternative (the modal renders its own `DialogClose`) is worse: the built-in X would then have to be hidden, which is either a second `dialog.tsx` prop (`hideClose`, a bigger change to the shared primitive and to C-8) or a CSS-hidden duplicate (forbidden by C-8). An optional prop with an unchanged default is inert for the other 41 importers. Conditions Y-1, Y-2. **U-2 is not a user question:** UM-1b UD-3 "keep the X unchanged" was the lead's instruction about the X's look, not a business decision, and the visible X does not change. The he / es words (סגירה / Cerrar) are already in UC-2, so the user approves them once under U-1. TL drops U-2 from §15 |
| Q-2 | **The claim holds, but the sentence is reworded.** Every upgrade the server offers runs one Stripe call: `proration_behavior: 'always_invoice'` + `payment_behavior: 'pending_if_incomplete'`, never `billing_cycle_anchor` (plan payments §F7, U-1). Stripe credits the unused time on the current price and charges the remaining time on the new price, so the amount is the prorated price difference for the rest of the current period, with the anchor unchanged. The three preview cases are all that difference. `due_now`: charged now. `due_now_zero`: covered by the account credit. `due_later_small`: under Stripe's 50-cent minimum, so it goes on the next bill (E-5). Two things the draft gets slightly wrong. (a) "Upgrade any time": accounts that are cancelling, have an upgrade pending or are not active are refused (`subscription_cancelling`, `upgrade_pending`, `not_active`). The subheading only shows when the server offers `upgrade`, but "any time" still reads as a promise. (b) "the difference" without "price" can read as a difference in features. Tax is excluded, the same as every price in the modal (footer). Final copy below. The R-4 fallback is not needed |
| Q-3 | **Approved, classes only.** The precedent is C-13 / UM-SA12. The islands are imported only by `UpgradeModal.tsx` (C-12, verified), so no other surface changes. Test ids, requests, payloads and copy stay as they are. The class pins in the islands' suites are mapped old → new in Implementation Notes. Condition Y-4 |
| Q-4 | **Hide only while a flow is open.** Do not fold B7 into the one-line status strip |
| Q-5 | **Yes** (Task 6). The inputs are existing `usePlanFlow` values, so this adds no rule and no read |
| Q-6 | **Agreed.** A Credits note in the table needs a `noteKey` chosen by the server on a comparison row. Record **UM-F8** in the requirement. Nothing is done client-side (C-21) |
| Q-7 | **Yes to both.** The X comes last in the DOM because the primitive appends it. That order is logical (content first, dismiss last), and the X is still reachable by Tab and by Escape. Column headers keep their full content, with no `aria-label` |
| Q-8 | **Yes, but rename it** (Y-1): two different props both called `closeLabel`, one a string and one a union, is a trap for the reader. `UpgradeModal` gets `footerClose?: 'back_to_plan' \| 'close'`. `DialogContent` keeps `closeLabel` |

### Final copy for UC-1 (replaces the §6.1 row)

| Lang | Text |
|---|---|
| en | When you upgrade, you pay only the price difference for the rest of your current billing period. |
| he (draft) | בשדרוג משלמים רק את הפרש המחיר על יתרת תקופת החיוב הנוכחית. |
| es (draft) | Al mejorar, solo pagas la diferencia de precio por lo que queda de tu periodo de facturación actual. |

U3-2's expected text in §12 changes to match. There are no digits and no currency sign, so guard U3-c passes. The sentence makes no "now" claim, so it stays true when the amount is carried to the next bill (`due_later_small`).

### Conditions

- **Y-1** `dialog.tsx`: `closeLabel` is **destructured** out of the props before `{...props}`, so it never reaches `DialogPrimitive.Content` (it would land as an unknown DOM attribute). JSDoc says why it exists (a translated screen-reader name). Nothing else in the file changes. `UpgradeModal`'s own prop is `footerClose` (Q-8).
- **Y-2** Create `components/ui/__tests__/dialog.closeLabel.test.tsx`. With no prop, the X is named "Close". With the prop, the X is named by it. There is still exactly one X button (C-8: no duplicate). Amend C-8 in the requirement: "`dialog.tsx` unchanged except the additive, default-inert `closeLabel` (UM-3 SA Q-1)".
- **Y-3** A-2: the contrast test models the X as it renders: white at `opacity-90` blended over the band's backdrop. Measure it against `--v2-secondary` (the gradient end) and against `--v2-primary-dark`, each ≥ 3:1. The busy `opacity-40` state is disabled, so it is exempt (record that).
- **Y-4** Guard U3-b covers `PlanPurchase.tsx` and `PlanUpgrade.tsx` as well as `UpgradeModal.tsx`, since the swap is made there too. U3-a matches the `PRIMARY_BUTTON` constant strings, not only JSX. Each guard has a planted-violation control.
- **Y-5** §8.1 geometry: `max-sm:w-14` is 56 px and `pe-12` is 48 px, so the strip is **wider** than the text reservation, unless the band's own end padding makes up the gap. Before coding, Dev shows this from the actual classes: strip width ≤ band end padding + text reservation. If it does not hold, use `max-sm:w-12`. QA screenshot A-1 at 360 px, en and he, confirms it (R-3).
- **Y-6** U3-c word list: match whole words / phrases, so the he / es equivalents raise no false positives on approved values (for example "limitado" vs a legitimate use). The `{…}` slots are stripped before the digit check.
- **Y-7** A-4 contrast pairs include the `--v2-bg` chip background (the "Coming soon" chip in `PlanPurchase.tsx:135`), in light and dark.
- **Y-8** Task 0 re-reads UM-2's final `subheading` union and its last guard letter, and reports any drift before coding (R-6). The new `'upgrade'` variant is chosen only for `settings` + some column `action === 'upgrade'`. The UM-FR8 matrix gains the case and loses none.
- **Y-9** Requirement update: CV decisions (§4), UM-F8, the C-8 amendment (Y-2), the D-1 resolution (translated, SA Q-1; U-2 dropped), and the UC-1 final wording.

### Checks of the findings

The contrast numbers were re-derived from the tokens and agree with the workplan. White on `#6366F1` is 4.47:1, a fail at `text-xs`. `#9CA3AF` on white is about 2.5:1, a fail. `#6B7280` on white is about 4.8:1, a pass. White on `#4F46E5` is about 6.3:1, a pass. Making "Back to plans" a `--v2-text-primary` link with an underline is right, given guard (f) and the missing dark override of `--v2-primary-dark`. The phone fixes (B7 hidden, subheading `max-sm:sr-only` but still the description, tighter band padding) are proportionate and change no DOM order. The ≥ 300 px target is measured by QA. The guards and the "no assertion deleted" rule are adequate with Y-4 and Y-6. The tools are right: a test-only contrast helper, and no `jest-axe`. The estimate of ≈ 1.5 d is accepted; Task 4 is now in scope and U-2 is gone. Logging: `dialog.tsx` has 0 `console.*`.

### Approval
[x] Workplan approved. Proceed once the branch exists from UM-2's final tip (X-6), with Y-1 to Y-9. U-1 (copy, with the UC-1 wording above) and U-3 go to the user in one message.

### Addendum UM-D3 (2026-10-20): "Your plan" opens the pop-up directly

**Reviewed by SA — 2026-10-20**
**Status:** ✅ Approved with conditions D3-1 to D3-14 (on top of Y-1 to Y-9). Decided by the user 2026-10-20 (UM-BQ1 reversed, with the refinement: current plan always marked; nothing offered → drawer; slow or failed read → drawer). Rulings R-1 to R-14 and the per-state table: requirement § SA Review, "SA ruling UM-D3". Dev revises §§ 3, 5, 9, 10, 11, 12 of this workplan to match before coding; SA re-reads only the revised sections.

**Design summary.** The page decides, once per open, between the Settings pop-up and today's drawer. Pop-up when the server offers something (`status === 'ok'` and `upgradeModalView(plan).available && .hasActions`) or a checkout return marker is on the URL; drawer otherwise, and whenever the read fails or takes over 2 s. The pop-up is a Settings-owned instance of UM-2's session component (not the layout provider). Its strip carries the "Your plan" badge, B1–B4 and a collapsed B8; its body carries B5 / B6. The drawer path is unchanged and nothing is deleted.

#### Conditions

- **D3-1** Decision = R-1 in **one pure exported function** beside `upgradeModalView` (inputs: the plan payload or a read failure, and whether a valid marker is present; output `'modal' | 'drawer'`), unit-tested for every §2.2 state of the requirement. No plan id, tier literal or cohort name in it (C-7, UM-FR7); `hasActions` is the only offer predicate used.
- **D3-2** Settings-owned instance: export UM-2's `UpgradeSession` (or rename it, one component) and add two optional props: a handed-over first read (`Promise<PlanRead>`) and `checkoutMarker`. Defaults keep UM-2's standalone behaviour byte-for-byte (its suites pass unmodified). The provider and C-4's context union are not changed.
- **D3-3** `planDrawer = useLinkOpenedDrawer()` stays the single "plan surface open" state (link flag, address clean-up, `returnFocusRef`); a decided surface `'pending' | 'modal' | 'drawer'` is added. The decision is taken once per open; a `?section=plan` link arriving while a surface is open keeps it; closing clears it. The row's `onClick` stays `planDrawer.openFromRow` (P-G2).
- **D3-4** Pending: row spinner + `aria-busy`, nothing else rendered; budget a named 2 000 ms constant; timeout / throw / non-`ok` → drawer, which reads fresh. A late answer is dropped, never swaps surfaces. One `debug` line with the reason only (SA-CB-4; Pino, no `console.*`).
- **D3-5** Strip, in order: "Your plan" badge (`upgrade_modal.your_plan`, column-badge look) + plan name semibold + price + ending (B1, B2); B3 (`plan.update_card_email`, test id `plan-update-card-email`) and B4 (`billing.notice.confirm_payment` link, new tab, `rel="noopener noreferrer"`, test id `plan-confirm-payment`) under the same conditions as `PlanSection`; then a collapsed disclosure "What your plan includes" (`plan.includes`) rendering `included` with `CategoryRowText`. Shared markup moves to `planText.tsx` rather than being copied (no second copy of the B3 / B4 conditions). The strip has an accessible name. B7 stays in the footer (hidden in a flow, §8.2). B9 is not rendered in the pop-up. No new copy key.
- **D3-6** Current plan per R-6: the strip badge for every account; the column badge for `kind === 'tier'` only (C-22 unchanged); render tests for trial, Founding Partner with an end date, no-plan, Essentials and admin-assigned.
- **D3-7** Checkout: marker → pop-up immediately, no warm read (B-2), marker passed to the session's `usePlanFlow`; body shows `PlanFlowStatus` ("Payment processing" → "You're on {plan}" only from the re-read, or "taking longer" + "Check again"). New `afterCheckout?: 'close' | 'stay'` on `UpgradeModal` (default `'close'`); the Settings instance passes `'stay'` for checkout and upgrade. Standalone keeps closing and returning to Settings → Plan (UM-SA10), where it now lands in the pop-up. Tests: marker on mount; completed inside the pop-up; a failed re-read never shows "You're on".
- **D3-8** Warm read: one take per open, in a ref-guarded effect that runs when the surface opens (never in render, never in the deep-link effect, never in `loadData`); usable only if `ok`, same language and no marker; the same set is handed to the session (first read) or to `PlanSection` (`takePrefetched`, returns it once). Rule 7 (no warm after the first close) unchanged. A render test counts `readMyPlan` calls: exactly one per open, warm and cold, for each surface.
- **D3-9** Nothing on the drawer path is deleted: `PlanSection`, its nested "See plans" / "Compare plans" instance (still nested in `SheetContent`, UM-SA2), `afterUpgrade: 'close'`. Its suites stay green; page-level tests that open the drawer use a nothing-offered fixture.
- **D3-10** The Settings pop-up calls `useUpgradeModalInlineHost()` while open; a test proves `openUpgradeModal` refuses meanwhile and that the drawer and the Settings pop-up are never mounted together (C-12).
- **D3-11** The Settings pop-up passes `footerClose: 'close'` (Q-8 / §5.5).
- **D3-12** Test re-map, old → new in Implementation Notes, none deleted (C-5): `settingsDeepLinks.guard` (plan branch still calls the link opener unconditionally; add a pin that the surface is chosen by the D3-1 function, not by the branch); `planPrefetch.guard` P-G3 re-mapped (the decider takes the set and hands it on), P-G1 / P-G2 / P-G4 / P-G6 / P-G8 unchanged (P-G8 still pins `PlanSection`'s own take order, now of the handed-over set); `PlanDrawer.prefetch.render` kept for the drawer and mirrored by a pop-up prefetch render test; `upgradeModal.standalone.render` unchanged.
- **D3-13** UM-3 Task 6 (SA Q-5) and run-sheet row U3-6 are **dropped**: a checkout marker now always opens the pop-up, so the drawer never shows "See plans" over a marker. QA updates the end-of-stream sheets (UM-1b §14, UM-2 §13, this §12): offered accounts open the window from the row (no "See plans" step); checkout returns expect the pop-up with "Payment processing"; the Autopilot owner and the open-ended Founding Partner expect the drawer with "Compare plans"; new rows: (a) a forced slow read (DevTools network throttling, "Slow 3G") on the row opens the drawer; (b) a trial opens the pop-up and the strip reads "Your plan · Test Flight …"; (c) a payment-failed / 3-D Secure account sees B3 / B4 at the top of whichever surface opens. U3-2's step becomes "Settings → Your plan".
- **D3-14** Path: no route, payload, request, DB or entitlements change (C-6; `npm run test:bos-entitlements` on the final diff). SA code review + QA sandbox (buy, checkout return, upgrade, 3-D Secure, all from the row-opened pop-up) before the user diff; not fast-tracked (UM-SA11 / C-14). Dev updates the requirement's §2.3, §5.1 and §17 to the as-built behaviour (Y-9 widened).

#### Estimate

| Task | Est. |
|---|---|
| D3-a Decision function + page wiring + pending / fallback (D3-1, D3-3, D3-4) | 0.5 d |
| D3-b Session props, `afterCheckout: 'stay'`, inline host, footer close (D3-2, D3-7, D3-10, D3-11) | 0.4 d |
| D3-c Strip: badge, B3 / B4, B8 disclosure, shared markup (D3-5, D3-6) | 0.3 d |
| D3-d Warm-read hand-over + request-count tests + guard re-maps (D3-8, D3-12) | 0.45 d |
| D3-e Docs and run-sheet hand-over to QA (D3-13, D3-14) | 0.1 d |
| Task 6 dropped | −0.1 d |
| **UM-D3 net** | **≈ +1.65 d** |

UM-3 total ≈ **3.15 d** (was 1.5 d). Order: Tasks 0–3 as planned, then D3-a → D3-d, then Tasks 4, 5, 7, 8 (Task 7's focus-order test covers the Settings pop-up too).

---

## Implementation Notes

**Dev, 2026-10-20.** Built on `feature/bos-upgrade-modal-um3` from `73a6628d`, uncommitted. Task 0 (Y-8): UM-2's final `subheading` union was `'default' | 'locked_feature' | 'founding_partner'` and the last guard letter `(s)`, as the plan assumed; no drift.

### What was built

| Area | Change |
|---|---|
| Copy (UC-1, UC-2, user-approved 2026-10-20) | `upgrade_modal.subheading.upgrade`, `upgrade_modal.close` in en / he / es. **No other new user-visible string.** The strip reuses `upgrade_modal.your_plan` and `plan.includes`; B3 / B4 reuse their drawer keys |
| `upgradeModalView.ts` | `subheading` gains `'upgrade'` (settings variant + some column `action === 'upgrade'`, computed after the columns, Y-8). New pure `planSurfaceFor(plan \| null, checkoutReturn)` (D3-1): marker → modal; otherwise `status === 'ok' && available && hasActions` |
| `components/ui/dialog.tsx` | Optional `closeLabel` (default `'Close'`), destructured before `{...props}`, JSDoc (Y-1). Nothing else |
| `UpgradeModal.tsx` | `closeLabel={t('upgrade_modal.close')}` on the X; new optional props `footerClose`, `afterCheckout`, `strip`, `returnFocusRef` (defaults = UM-2 behaviour); the `your_plan` strip (badge + name + price + ending, B3 / B4, collapsed `<details>` B8 hidden in a flow, `role="group"` named "Your plan"); checkout `stay` + marker → status body; focus moves to the status body; muted → secondary everywhere; "Back to plans" → primary text + underline; phone band (`w-12 sm:w-1/4` strip, `sm:pe-[22%]` only; `max-sm:py-3` and subheading `max-sm:sr-only` in a flow); B7 hidden in a flow; N-1 line moved above the table; "Coming soon" chip text → `--v2-text-primary` (see Y-7 finding) |
| Islands | `PlanPurchase` `CHOOSE_BUTTON` and `PlanUpgrade` `PRIMARY_BUTTON` → `--v2-primary-dark`; every muted line → secondary; PlanPurchase's chip → text-primary. Classes only (Q-3) |
| `planText.tsx` | New shared `PlanBillingNotices` (B3 / B4, same keys, test ids, conditions) and `PlanIncludedList` (B8). `PlanSection` now renders both from here (D3-5: one copy) |
| `UpgradeSession.tsx` (new) | UM-2's session, moved verbatim, plus `firstRead` / `checkoutMarker` and pass-through props; always `footerClose="close"` |
| `StandaloneUpgradeModal.tsx` | Now a 5-line wrapper over `UpgradeSession` (footer "Close", §5.5) |
| `usePlanSurface.ts` (new) | The decider: one decision per open (ref-guarded effect on `open`); marker → modal with no warm read; else warm set (same language) or a cold `startPlanDrawerRead`; 2 000 ms budget (`PLAN_SURFACE_DECISION_BUDGET_MS`); late answers dropped by an open counter; hands the read to the session (`modalFirstRead`) or to `PlanSection` (`takeForDrawer`, once); `debug` line with the reason only |
| `SettingsPlanModal.tsx` (new) | Settings-owned instance: renders nothing closed; open, calls `useUpgradeModalInlineHost()` and mounts `UpgradeSession` with `afterCheckout="stay"`, `strip="your_plan"`, `returnFocusRef` |
| `app/business-os/settings/page.tsx` | `usePlanSurface({ open: planDrawer.open, checkoutMarker, takePrefetched: planPrefetch.take })`; row `aria-busy` + spinner while pending; drawer `open={planDrawer.open && surface === 'drawer'}` with `takePrefetched={planSurface.takeForDrawer}`; `SettingsPlanModal` beside it. Deep-link branch unchanged |

### Deviations (for SA)

| # | Deviation | Why |
|---|---|---|
| DV-1 | `UpgradeSession` lives in its own file, not exported from `StandaloneUpgradeModal.tsx` (D3-2 / R-2 say "export") | `lazyDialogs.guard` forbids ANY static import of `StandaloneUpgradeModal` (PERF-1). One component still, moved verbatim; guard (p)'s allowed caller `STANDALONE` → `SESSION` |
| DV-2 | On a **timeout** the drawer takes the read still in flight instead of reading fresh (R-4 says "reads fresh") | Keeps one request per open (D3-8). A throw or a non-`ok` answer still reads fresh: `PlanSection` re-reads any unusable handed-over answer (`isUsableWarm`), as for a warm read |
| DV-3 | The decider imports `planFrom` from `usePlanFlow.ts` besides `upgradeModalView` / `planDrawerReads` (R-14) | The existing one-copy body judge; no second copy (C-2). No entitlements import |
| DV-4 | The standalone footer reads "Close" (UM-3 §5.5) while D3-2 says standalone stays byte-for-byte | §5.5 / SA carry-over asked for it; its read and flow are unchanged. One provider test re-mapped (below) |
| DV-5 | B3 in the drawer is now `--v2-text-secondary` (was muted) | It is the shared component now; a payment-critical line at 2.5:1 was the A-4 defect. Drawer B8 / B9 left muted (out of scope, §5.2) |
| DV-6 | The "Coming soon" chip text is `--v2-text-primary`, not secondary | Y-7 finding: `--v2-text-secondary` on `--v2-bg` is 4.44:1 in light (just under AA); pinned by the contrast test |

### Findings / open items

| # | Item |
|---|---|
| F-1 | AC-UM7 says "closing the pop-up removes the checkout marker from the address"; R-7 says "the link hook, unchanged", which removes `section` only (C-11; `settingsDeepLinks.guard` forbids touching `checkout`). Built as R-7 (hook unchanged). After a close, a row reopen with `checkout=` still on the URL opens the pop-up showing the server's answer. **SA / BA to reconcile the AC wording** |
| F-2 | `PlanFlowStatus` lines ("Payment processing…", "Upgrading…") stay `--v2-text-muted` (shared with the drawer; outside guard U3-b). Visible in shot 05. Candidate follow-up |
| F-3 | Hebrew: the native `<details>` marker points left when closed (shot 10). Browser behaviour; acceptable, noted for QA |

### Test re-map (old → new; none deleted, C-5)

| Test | Old | New |
|---|---|---|
| `UpgradeModal.render` `expectNoDeadButton` | X named `'Close'` in every language | `translations[language]['upgrade_modal.close']` (SA Q-1) |
| `UpgradeModal.render` "opens from See plans" ×3 | description = default subheading | `upgrade_modal.subheading.upgrade` (Essentials fixture: CV-5) |
| `upgradeModalView.context` ×3 | `subheading: 'default'` | `settingsSubheading(view)` (upgrade when a column offers it) |
| `UpgradeModalProvider.render` D-1 | footer "Back to your plan" | footer "Close", scoped to the footer (§5.5) |
| `planPrefetch.guard` P-G3 | section takes `planPrefetch.take` | section takes `planSurface.takeForDrawer`; the decider takes `planPrefetch.take` (its only taker), marker byte-for-byte in both (D3-12); +2 negative controls; P-G4 also forbids `planSurface` in the deep-link effect / `loadData` |
| `upgradeModal.guard` (p) | `STANDALONE` reads | `SESSION` reads (DV-1); NEW_FILES +3; (q) +3 files |
| `settingsDeepLinks.guard` | — | + the surface is the decider's, never the branch; the two surfaces exclusive (+ negative controls) |
| P-G1, P-G2, P-G4–P-G8, `PlanDrawer.prefetch.render`, `upgradeModal.standalone.render` | — | unchanged, green |

### New tests

`planSurfaceFor.test.ts` (every §2.2 state, refused states, not-ok, marker, CV-5 subheading), `SettingsPlanSurface.render.test.tsx` (page harness: pop-up vs drawer, one request per open warm and cold for each surface, 2 s fallback + late answer dropped, thrown read, checkout return, failed re-read, checkout stays in the pop-up, inline-host refusal, strip for trial / FP / Essentials / admin-assigned, B8 collapsed, B3 / B4 in the strip and in a flow, Hebrew), `upgradeModal.um3.render.test.tsx` (A-5, A-7 to A-12, §8, Y-5, N-1), `upgradeModal.contrast.test.ts` (A-1 to A-6, Y-3, Y-7), `components/ui/__tests__/dialog.closeLabel.test.tsx` (Y-2). Guards `(t)` U3-a, `(u)` U3-b, `(v)` U3-c, `(w)` D3-1 / D3-10, each with planted-violation controls.

### Runs (2026-10-20)

| Run | Result |
|---|---|
| Settings + settings page + `components/business-os/__tests__` (lazyDialogs incl.) + `app/business-os` + `components/test-business-os` + `components/ui/__tests__` + ownerLanguageFirstFrame, dictionariesStayInStep, tierLiteral.forbidden, creditFigures.fromConfig, enforcementPoints | **94 / 94 suites, 1,809 / 1,809 tests** |
| `npm run test:bos-entitlements` | 299 / 301 suites, 9,129 / 9,131 on the parallel run; the 2 failures were load timeouts in `app/admin/users` (`businessDrawer.money` 164 s, `creditsBlock.recentGrant`). Re-run alone: 28 / 28 and 9 / 9 green |
| `npm run lint:hooks` | clean (exit 0) |
| eslint on touched folders | 0 errors; 5 pre-existing warnings, none on a changed line |
| `tsc --noEmit` | no error in any touched path |
| `console.*` | 0 in every touched / new file |

### Screenshots (static render, not the running app)

Real `SettingsPlanModal` / drawer rendered in Jest with real payloads, the project CSS compiled by its Tailwind, headless Chrome (phone in a 360 × 780 iframe). Session scratchpad `um3-shots/`: 01 Essentials pop-up · 02 trial pop-up with the strip · 03 "What your plan includes" open · 04 Autopilot still the drawer · 05 checkout return "Payment processing" · 06 Hebrew Essentials · 07 dark trial · 08 dark Hebrew trial · 09 phone trial · 10 phone Hebrew dark Essentials · 11 phone checkout flow (≈ 340 px of card area visible, B7 gone, band compact) · 12 phone Essentials. Headline is 2 lines at 360 px in en and he (M-2). The temporary dump test was deleted after use.

### SA code review fixes (Dev, 2026-10-20)

| Item | Fix |
|---|---|
| SA's own change | Kept: `!statusBody` on the B7 footer line, so "Nothing is charged…" is hidden under "Payment processing" |
| CR-1 | `upgradeModal.um3.render.test.tsx` "CR-1 / CR-2": with a flow marker in `stay` (a return, or a checkout completed in the pop-up), the status body shows and `plan-compare-when-this-changes` is absent; with the marker gone, the table and B7 return. Control: without `stay` (the drawer's nested instance) a marker changes nothing |
| CR-2 | `PlanFlowStatus.tsx`: every `--v2-text-muted` line → `--v2-text-secondary` (also the drawer). Pinned in the same test; no existing class pin to map |
| Low: B4 link | `planText.tsx` `PlanBillingNotices`: "Confirm your payment" `text-[var(--v2-primary)]` → `text-[var(--v2-text-primary)] font-medium underline underline-offset-2` (the A-5 treatment). Pinned |
| Low: separator | Strip: each "·" now ends the item before it, after a no-break space (`STRIP_SEPARATOR`), so a wrapped line never starts with "·" (shots 10–12). Pinned |

Runs after the fixes: 94 / 95 suites, 1,821 / 1,822 tests on the parallel run (includes QA's new `SettingsPlanSurface.qa.render`); the one failure was a load timeout in `upgradeModal.flow.render`, which passes alone (19 / 19). `lint:hooks` clean. Shots 05, 10, 11 and 12 re-rendered.

### Run sheet (D3-13)

This workplan's §12 is updated (U3-2 step, U3-6 dropped, U3-7 to U3-10 added). **QA**: append U3-1 to U3-10 to the UM-1b §14 sheet and update the UM-1b §14 / UM-2 §13 rows as D3-13 lists (offered accounts open the window from the row, no "See plans" step; checkout returns expect the pop-up with "Payment processing"; Autopilot and the open-ended Founding Partner expect the drawer with "Compare plans").

---

## SA Code Review

**Code Review by SA — 2026-10-20**
**Status:** ✅ Code Approved with conditions CR-1 and CR-2 (small; QA may run in parallel, both land before the user diff)

Read: the full diff (19 modified, 8 new files) and the 12 screenshots. Ran: settings + settings page + `components/ui/__tests__` + `components/business-os/__tests__` **82 / 82 suites, 1,482 tests**; `dictionariesStayInStep`, `tierLiteral.forbidden`, `creditFigures.fromConfig`, `enforcementPoints`, `lazyDialogs` **5 / 5, 206 tests**. After the SA fix below, the modal suites (`upgradeModal*`, `UpgradeModal*`, `SettingsPlanSurface`) re-ran **16 / 16, 296 tests**. One load flake seen once in the 51-suite run (`upgradeModal.flow.render` "Could not confirm"), green twice alone and in the 82-suite run.

### Money path (C-14 equivalent)

| Check | Result |
|---|---|
| Requests and payloads | ✅ Unchanged. `PlanPurchase` / `PlanUpgrade` diffs are class strings only; no fetch, body, route or test id touched. `router.replace(settingsPlanReturnPath(…))` untouched |
| Open-time decision | ✅ `planSurfaceFor` = marker → modal; else `status === 'ok' && available && hasActions`. `hasActions` is the existing view predicate; no plan id, tier or cohort (D3-1, C-7) |
| 2 s / failed read | ✅ Named `PLAN_SURFACE_DECISION_BUDGET_MS`; threw / non-`ok` / no plan → drawer; late answer dropped by `settled` + open counter. DV-2 (timeout hands the in-flight read to the drawer) **accepted**: still one request, and `PlanSection` re-reads any unusable answer |
| Checkout return | ✅ Marker → pop-up at once, no warm read used (the set is still taken and discarded, rule 1), marker passed to `usePlanFlow`; success only from the re-read (`succeeded` unchanged) |
| Completion inside the pop-up | ✅ `afterCheckout="stay"`: `onCheckoutComplete` then `resetFlow`, `checkoutStatus` from `flowStatus.marker`; the `section=plan` link the return writes keeps the open surface (decision taken once per open) |
| One embedded checkout per page | ✅ `SettingsPlanSession` calls `useUpgradeModalInlineHost()` only while mounted; drawer `open` and pop-up `open` are mutually exclusive on `surface`; the Sheet unmounts its content when closed |
| 3-D Secure frame style | ✅ `STRIPE_CHALLENGE_REACHABLE_CSS` still rendered only while `busy \|\| frameOpen`, cleared by `onFrameOpenChange(false)` on unmount; unchanged |
| Nothing lost (B1..B11) | ✅ B1/B2 strip, B3/B4 via the one shared `PlanBillingNotices` (same keys, ids, conditions, `rel="noopener noreferrer"`), B5/B6 status body, B7 footer, B8 `<details>`, B9 drawer only (R-5), B10/B11 islands. Drawer path not deleted (D3-9) |
| Deep links / guards | ✅ Deep-link branch unchanged; `settingsDeepLinks.guard` + `planPrefetch.guard` re-maps match D3-12, with negative controls; no write of `checkout` anywhere |
| `dialog.tsx` (Y-1/Y-2) | ✅ `closeLabel = "Close"` destructured before `...props`; JSDoc; nothing else changed; `dialog.closeLabel.test.tsx` pins default, override and one X |
| Contrast (Y-3..Y-5) | ✅ Tests present; Y-5 resolved as `w-12` inside `pe-12` (screens 09–12: text never on the strip, headline 2 lines en/he) |
| Entitlements / tiers / copy | ✅ No import from `lib/business-os/entitlements/` in any client file (only the `/api/…/my-plan` URL string); no tier literal; only UC-1 / UC-2 added, as approved; 0 `console.*` in every touched file |

### F-1 reconciled (AC-UM7 vs R-7)

**The code is right; the AC was wrong.** `useLinkOpenedDrawer` has always removed `section` only, and C-11 plus `settingsDeepLinks.guard` forbid any write of `checkout`. R-7's last sentence (SA's own wording) wrongly said both are removed, and AC-UM7 copied it. SA corrected both in the requirement (AC-UM7 and the R-7 cell), with a note. Consequence, recorded: after a close, reopening the row with `checkout=` still on the address opens the pop-up in its status body, which then shows the server's answer ("You're on {plan}"). Not a money risk; it is the same stale-marker behaviour the drawer had (D-8). Clearing the marker is a C-11 change and stays out of UM-3.

### Code Review Comments

1. `UpgradeModal.tsx:551` — B7 ("Nothing is charged before you choose one") still showed under "Payment processing" (screen 05): untrue once a payment has been made. **Fixed by SA** (trivial): `openFlow === null && !statusBody && whenThisChanges`, the same gate the free-access and not-configured lines already use. — Priority: Medium — SA: resolved
2. **CR-1** `upgradeModal.um3.render.test.tsx` — add a pin for comment 1: with a checkout marker (and after an in-pop-up completion), `plan-compare-when-this-changes` is absent; back in the table view it returns. — Priority: Medium — pending (Dev)
3. **CR-2** `PlanFlowStatus.tsx` (F-2) — "Payment processing…" / "Upgrading…" stay `--v2-text-muted` (≈ 2.5:1, screen 05). Since UM-D3 this is the pop-up's main message after a payment, so it is inside A-4's scope. Swap its text lines to `--v2-text-secondary` (token swap only, also improves the drawer), map any class pin old → new. — Priority: Medium — pending (Dev)
4. `planText.tsx` `PlanBillingNotices` — the B4 "Confirm your payment" link is `text-sm text-[var(--v2-primary)]`, the same pair A-5 found failing (4.47:1 light, ≈ 3.2:1 dark), now also inside the modal. Pre-existing drawer markup moved verbatim. — Priority: Low — follow-up (record beside F-2; fix with the same A-5 treatment when next touched)
5. `UpgradeModal.tsx` strip — at 360 px the "· Ends on …" separator wraps to the start of a line (screens 10, 11). Cosmetic. — Priority: Low — optional

### Optimisation Suggestions
- `usePlanSurface` leaves the 2 s timer running after a close (by design, for StrictMode); `current()` makes it inert. Acceptable; no change.
- DV-1, DV-3, DV-4, DV-5, DV-6 accepted as written.

### Code Approved for QA: Yes (CR-1 and CR-2 before the user diff; not fast-tracked, D3-14)

---

## QA Testing Report

**QA — 2026-10-20**
**Test mode:** full
**Strategy used:** A + B (Jest unit, render and guard suites on real `my-plan` payloads) and D, headless (Chrome at 360 px on a static render with the project CSS). Live checks are batched into the user's end-of-stream session (user decision): no sign-in, no keys, no purchases now.
**Focus:** ui, schema (copy), security (one checkout per page, no entitlements import), performance (one request per open)
**Skipped:** live sandbox (buy, checkout return, upgrade, 3-D Secure, Narrator). These are in the master run sheet, UM-1b §14
**Input source:** prompt keywords + workplan §7, §8.4, D3-1 to D3-14

### Runs

| Run | Result |
|---|---|
| Settings + `app/business-os` + `components/business-os/__tests__` + `components/test-business-os` + `components/ui/__tests__` + `app/invite` + guards (ownerLanguageFirstFrame, dictionariesStayInStep, tierLiteral.forbidden, creditFigures.fromConfig, enforcementPoints) | Run 1: **101 / 101 suites, 2,026 / 2,026 tests**. After SA's CR-1, CR-2 and Low fixes landed: run 2 **102 / 102 suites, 2,039 / 2,039 tests**, QA file included. One load timeout in a 53-suite subset (`upgradeModal.um3.render`) passed alone, 18 / 18 |
| `npm run test:bos-entitlements` | **301 / 301 suites, 9,131 / 9,131 tests**, exit 0. Ran before the CR fixes, which are class strings and tests only, with no entitlements import |
| `npm run lint:hooks` | exit 0 (`--max-warnings 0`) |
| New QA file `components/business-os/settings/__tests__/SettingsPlanSurface.qa.render.test.tsx` | **10 / 10** |

### Test Coverage

| Acceptance criterion / check | Tested? | Result | Notes |
|---|---|---|---|
| AC-UM1: an offered account gets the pop-up and no drawer | ✅ | Pass | `planSurfaceFor` for trial, FP with an end date, Essentials, admin "Pay for" and (QA) an ended record → modal. Page harness, warm and cold |
| AC-UM1: an account offered nothing gets the drawer with "Compare plans" | ✅ | Pass | Autopilot, FP with no end date, refused upgrade, and (QA) Essentials cancelling → drawer |
| AC-UM1: Escape, X, footer "Close" and backdrop close it; focus returns to the row | ✅ | Pass | Footer Close (Dev). **QA:** Escape on the pop-up and on the drawer, focus back on the row both times, and a fresh decision on the next open. Backdrop is pinned by the UM-1b suites |
| AC-UM7: a checkout return opens the pop-up on "Payment processing"; "You're on" comes only from the re-read; a failed re-read never claims it | ✅ | Pass | No 2 s wait and no warm read (B-2). A completion inside the pop-up stays open (`afterCheckout="stay"`), with focus on the status |
| AC-UM7: closing removes the marker | ✅ | Pass (as corrected by SA) | SA corrected the AC: `section` only. **QA test** pins the as-built result: after a close, reopening with `checkout=` still on the address shows the status body again |
| AC-UMD3 (a): the current plan is marked | ✅ | Pass | Strip badge + name for trial, FP, Essentials and admin-assigned. Column badge only for a tier. he, and (QA) es |
| AC-UMD3 (b): B3 / B4 at the top, also during a flow | ✅ | Pass | QA confirmed that the fixture carries an upgrade, so the flow half of the test really runs |
| AC-UMD3 (c): "What your plan includes" collapsed | ✅ | Pass | `<details>`, closed; same list length as `included` |
| AC-UMD3 (d): slow read (2 s) or a failed read opens the drawer; a late answer never swaps | ✅ | Pass | Timeout, thrown read and non-`ok` cases; the debug line carries the reason only |
| AC-UMD3 (e): one surface at a time | ✅ | Pass | The provider refuses while the pop-up is open. **QA:** pressing the row twice → one request, one pop-up |
| Spinner, `aria-busy`, deep links (`?section=plan`) | ✅ | Pass | Harness + `settingsDeepLinks.guard`: the branch is unchanged, and the decider picks the surface |
| B1..B11 reachable on the surface that opens | ✅ | Pass | **QA:** trial pop-up shows B1/B2 in the strip, B7 in the footer, B8 collapsed, B11 buttons, no B9. Essentials: B10 reachable. B5/B6 come from the checkout tests |
| Keyboard / focus order (A-7), names (A-9 to A-12) | ✅ | Pass | en / he; flow order; X "סגירה" / "Cerrar" |
| Other dialogs keep "Close" (`closeLabel` default) | ✅ | Pass | `dialog.closeLabel.test`. The two other `closeLabel` callers are `SettingsDrawer`, not `DialogContent` |
| UC-1 / UC-2 copy, no digits / urgency | ✅ | Pass | Guard (v) U3-c; `dictionariesStayInStep` |
| Contrast A-1 to A-6 | ✅ | Pass | `upgradeModal.contrast.test` |
| 360 px M-1 to M-4 (fresh QA render after the CR fixes) | ✅ | Pass | Headless Chrome, 360 × 780 iframe, en/he, light/dark: page and dialog `scrollWidth = clientWidth` (360/360, 358/358); headline **2 lines** in en and he; the gradient strip (48 px) never overlaps the headline (en: text ends at x 311, strip 311–359; he mirrored); checkout flow shows ≈ 340 px of card area (target ≥ 300); B7 is gone in the flow and in the status body; no line starts with "·". Shots in the session scratchpad `qa-shots/qa-360-*.png` |
| M-5 / M-6, Narrator, live Stripe | ⚠️ | Deferred | Master run sheet rows 2, 11, 14–24, 29 |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None. One request per open, warm and cold, for both surfaces (Dev tests, plus QA's double-press case).

#### Edge Cases (nice to fix)
1. **The checkout-return pop-up keeps the "Choose the plan…" headline above "Payment processing".** `UpgradeModal.tsx`, Low, copy only (fresh shot `qa-360-checkout-return-en-light`). It reads fine, but a status headline would be clearer. Candidate for later polish; nothing to do in UM-3.
2. **Row U3-9 (renewal failure) needs a renewal to fail.** The old §12 pointed at the S-4 / S-3 account, but those are checkout-time checks, so `billing.state` never becomes `payment_failed` / `action_required` there. In the master sheet the row is now optional (Stripe test clock). Jest covers it.
3. SA's Low item 4 (B4 link contrast) was fixed by Dev, so nothing is left from it.

### §14 master sheet (D3-13)
UM-1b §14 is now the single MASTER sheet: 34 rows in one running order, with UM-2 §13 and UM-3 §12 merged into it. UM-2 §13 and this §12 now carry a pointer line, and their rows are kept for the record. Changes: offered accounts open the pop-up from the row, with no "See plans" step; buys and upgrades stay in the pop-up; Autopilot and FP with no end date open the drawer with "Compare plans"; U2-6 now runs inside the slow-read row (row 2), which is the only way to reach the drawer's "See plans"; U2-9 now expects "Close"; Trial D and both Founding Partner accounts are listed.

### Test Outputs / Logs
```text
Run 2 (after CR fixes): Test Suites: 102 passed, 102 total   Tests: 2039 passed, 2039 total
test:bos-entitlements:  Test Suites: 301 passed, 301 total   Tests: 9131 passed, 9131 total   EXIT=0
lint:hooks:             exit 0
SettingsPlanSurface.qa.render.test.tsx: Tests: 10 passed, 10 total
360 px (trial-checkout-flow-en-light): doc 360/360 | dialog 358/358 | h2lines 2 | strip x 311-359 | h2 x 57-311
```

### Final Status
- [ ] All acceptance criteria pass — ready for commit
- [x] Every automated criterion passes and no bugs were found. **Ready for the user's diff view.** The live criteria (AC-UM7 in the sandbox, go-live row 20 (b) / (c), Narrator) are recorded only in the end-of-stream master run, UM-1b §14

---

## Commit Info

| Field | Value |
|---|---|
| Branch | `feature/bos-upgrade-modal-um3` (chained from UM-2 tip `73a6628d`) |
| Product commit | `44df7ca8` feat(business-os): Your plan opens the comparison pop-up, copy and polish (UM-3, UM-D3) |
| Docs commit | `d4fcb1a4` docs(business-os): UM-3 workplan + SA/QA records; master end-of-stream run sheet; requirement ACs |
| Pushed | 2026-10-20, `origin/feature/bos-upgrade-modal-um3` |
| PR | Not opened (user: chained branches, PRs only after the end-of-stream live session). Per UM-2 SA X-6: PR based on `main`, opened after the UM-2 PR merges, merge commit (`--merge`), never squash |
| Pre-commit runs (RM) | UI suites 90 / 90 (1,597 tests); `test:bos-entitlements` 301 / 301 (9,131); `lint:hooks` clean; secret scan clean; numstat: no blanked file |

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-20 | Created | Dev workplan for UM-3, drafted read-only in the UM-2 worktree while UM-2 is being built (branch `feature/bos-upgrade-modal-um3` to be created by RM from UM-2's tip). CV-1 to CV-11 reconciled with UM-0 to UM-2: CV-5 sentence added, CV-3 / CV-4 superseded, CV-8 deferred to a server follow-up (UM-F8), CV-9 / CV-10 / CV-12 / CV-13 out. Deferred items D-1 to D-11 from UM-0 / UM-1a / UM-1b / UM-2 handled or recorded. A11y checklist A-1 to A-15 with test methods (test-only contrast helper, no new tool); findings: islands' white `text-xs` on `--v2-primary` (4.47:1), "Back to plans" link (4.47:1 light, ≈ 3.2:1 dark), muted small text (≈ 2.5:1). Phone: band strip, B7 hidden in a flow, ≥ 300 px card form target. 2 new keys (+ UM-2's if pending) for one batched approval; 6 end-of-stream rows U3-1 to U3-6; 8 SA questions. Estimate ≈ 1.5 d. Status: Planning |
| 2026-10-20 | SA workplan review | Approved with conditions Y-1 to Y-9. Q-1: additive `closeLabel` on `DialogContent` approved (default-inert, destructured, default pinned by a test, C-8 amended); U-2 dropped as a user question. Q-2: the proration claim holds (`always_invoice`, anchor unchanged; `due_now` / `due_now_zero` / `due_later_small` are all the difference), and UC-1 is reworded to "When you upgrade, you pay only the price difference for the rest of your current billing period." (he / es drafts in the SA notes). Q-3 approved (C-13 precedent, the islands render only in the modal). Q-4 hide only; Q-5 yes; Q-6 UM-F8; Q-7 yes; Q-8 yes, renamed `footerClose`. §8.1 strip geometry to be verified (Y-5) |
| 2026-10-20 | SA addendum UM-D3 | User decision UM-D3 (UM-BQ1 reversed, refined: current plan always marked; nothing offered or a slow / failed read → drawer) built in this slice. Conditions D3-1 to D3-14: one pure decision function (`available && hasActions`, or a checkout marker); Settings-owned instance of UM-2's session component with a handed-over first read and the marker; one open state + decided surface; 2 s fallback to the drawer; strip with "Your plan" badge, B1–B4 and a collapsed B8; checkout and upgrade stay in the pop-up with their status; warm read handed to whichever surface opens (one request per open); nothing deleted; Task 6 and U3-6 dropped; run-sheet rows updated by QA. Estimate ≈ +1.65 d net, UM-3 ≈ 3.15 d. Dev revises §§ 3, 5, 9–12 before coding |
| 2026-10-20 | Implemented (Dev), uncommitted | UM-3 Tasks 0–5, 7, 8 and UM-D3 D3-a to D3-e built (Task 6 dropped by D3-13). See Implementation Notes: deviations DV-1 to DV-6, findings F-1 to F-3, test re-map. 94 / 94 suites, 1,809 tests; `test:bos-entitlements` 9,129 / 9,131 (2 load timeouts, green alone); lint:hooks clean. Status: Code Complete |
| 2026-10-20 | SA code review | Code Approved for QA with conditions CR-1 (pin B7 hidden under the status body) and CR-2 (`PlanFlowStatus` muted → secondary). Money path unchanged (classes only in the islands; decision via `hasActions`; 2 s / failed → drawer; checkout return and in-pop-up completion stay; one checkout per page; 3-D Secure style unchanged). SA trivial fix: B7 hidden under "Payment processing" (`UpgradeModal.tsx`). F-1 reconciled: code right, AC-UM7 and R-7 corrected in the requirement (`section` removed, `checkout` kept, C-11). DV-1..DV-6 accepted. 82 / 82 + 5 / 5 suites green |
| 2026-10-20 | QA automated pass | 102 / 102 suites, 2,039 tests, including the new `SettingsPlanSurface.qa.render.test.tsx` (10 tests: Escape on both surfaces with focus back on the row and a fresh decision on reopen, the as-built stale marker, B1..B11 placement, ended → pop-up, cancelling → drawer, es strip and X, double press → one request). `test:bos-entitlements` 9,131 / 9,131; `lint:hooks` clean. Fresh 360 px render: no horizontal scroll, headline 2 lines in en/he, ≈ 340 px of card area. No bugs; 2 Low edge cases. UM-1b §14 made the single MASTER run sheet (34 rows, D3-13) |
| 2026-10-20 | Committed (RM) | Product `44df7ca8` + docs `d4fcb1a4` on `feature/bos-upgrade-modal-um3`, pushed; no PR until the end-of-stream live session |
