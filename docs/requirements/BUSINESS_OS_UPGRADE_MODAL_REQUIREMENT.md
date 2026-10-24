# Requirement: Business OS Upgrade Modal

> **Last Updated**: 2026-10-20

**Created by:** BA
**Date:** 2026-10-18
**Status:** UM-1b (buy and upgrade in the modal, [workplan](/docs/workplans/BUSINESS_OS_UPGRADE_MODAL_UM1B_WORKPLAN.md)): workplan SA-approved with conditions W-1 to W-8 (2026-10-20); implemented, uncommitted, awaiting SA code review. User decisions 2026-10-20: the pre-build drawer 3-D Secure check is skipped and every live sandbox check (go-live row 20 (b), the UM-1b run sheet) is batched into one user session at the end of the stream, after UM-2 and UM-3, before the PRs merge; he / es for "See plans" (צפייה בתוכניות / Ver planes) and "Back to plans" (חזרה לתוכניות / Volver a los planes) approved; the close X unchanged. UM-1a merged (PR #483). UM-0 merged (PR #480). UM-1a (comparison table, view only, [workplan](/docs/workplans/BUSINESS_OS_UPGRADE_MODAL_UM1A_WORKPLAN.md)): SA code-approved after F-1 to F-3, QA passed (2026-10-20, two Low items fixed); uncommitted, awaiting the user's diff review, then RM. UM-SA4 / C-10 amended per UM-BQ4 (§4.0 "Recommended"); he / es wording approved by the user 2026-10-20. Next: UM-1b. User decision UM-D2 (2026-10-19): short, grouped rows — amends C-17, confirmed by SA in the UM-0 workplan review. SA re-reviewed UM-D1 2026-10-19 — APPROVED WITH CONDITIONS C-15 to C-28 (slices UM-0 → UM-1a → UM-1b → UM-2 → UM-3). (Previously: SA reviewed 2026-10-18, APPROVED WITH CONDITIONS C-1 to C-14; business questions decided 2026-10-18. UM-BQ2 is now reversed and UM-BQ3 is now "now"; see §4.0 and §12)
**Approved mockup (UM-D1):** `C:/Users/Barak/AppData/Local/Temp/claude/C--Users-Barak-My-Projects-AgentsPilot-neuronforge/87f44241-ddc6-4e58-a75a-a1db084fa69e/scratchpad/upgrade-modal-mockup-v2.html` (session scratchpad; the first, card-based mockup was rejected)
**Related:** [BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md) (F1, F7, F10, BQ-P1, BQ-P10, M-5 to M-8, U-5), [BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md](/docs/requirements/BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md) (S-1, C-b), [BUSINESS_OS_ENTITLEMENTS.md](/docs/architecture/BUSINESS_OS_ENTITLEMENTS.md) (tiers, FR-46 chat gate, shadow mode)

## Overview

Today the Business OS plans appear only inside the Settings → "Your plan" side drawer, as a list of text lines (`PlanSection`). It is accurate, but it does not make anyone want to upgrade. This requirement adds a **standalone, colourful upgrade modal**: plan cards side by side, the current plan marked, a recommended plan highlighted, what the higher plan adds, and one clear button. The modal **can be opened from anywhere** in Business OS: from Settings, later from a locked action ("This needs Autopilot"), and later as a prompt to Founding Partners. **This is a presentation change only.** Buying, upgrading, prices, refusals (including BQ-P10), entitlements, and every server route stay exactly as they are. The modal shows the same server answers in a new layout.

---

## Table of Contents

1. [Conventions](#1-conventions)
2. [As-is: what "Your plan" shows today](#2-as-is-what-your-plan-shows-today)
3. [User stories](#3-user-stories)
4. [The modal](#4-the-modal)
5. [Entry points: the "open upgrade modal" contract](#5-entry-points-the-open-upgrade-modal-contract)
6. [Conversion-oriented presentation](#6-conversion-oriented-presentation)
7. [Wireframes](#7-wireframes)
8. [Functional requirements](#8-functional-requirements)
9. [Non-functional requirements](#9-non-functional-requirements)
10. [What is pure UI and what would need new data](#10-what-is-pure-ui-and-what-would-need-new-data)
11. [Slices](#11-slices)
12. [Business questions for the user](#12-business-questions-for-the-user)
13. [For SA](#13-for-sa)
14. [Acceptance criteria](#14-acceptance-criteria)
15. [Out of scope / future roadmap](#15-out-of-scope--future-roadmap)
16. [Open questions](#16-open-questions)
17. [Notes on integration points](#17-notes-on-integration-points)

---

## 1. Conventions

| Item | Convention |
|---|---|
| Plan names | Internal `basic` / `pro` (tiers), `trial` / `champion` (cohorts). Customer names: Essentials ($79/mo), Autopilot ($129/mo), Test Flight, Founding Partner. Names and prices come **only** from the `my-plan` payload, never typed into the UI |
| Ids | **UM-FRn** functional requirements · **UM-BQn** business questions · **UM-SAn** SA items · **UM-n** slices · **AC-UMn** acceptance criteria |
| "The payload" | The body of `GET /api/business-os/entitlements/my-plan` (`PlanPayload` in `PlanSection.tsx`): `name`, `kind`, `free`, `monthlyPriceUsd`, `endsWhen`, `whenThisChanges`, `included`, `nextPlanUp`, `plans`, `purchase` (`offer`, `upgrade`, `billing`, `endsFreeAccessOnPurchase`), `problem` |
| "Renders, does not decide" | The rule in `PlanSection.tsx`: the UI shows only what the server sent. It never ranks plans, compares cohort names, or decides who may buy. The modal follows the same rule |

---

## 2. As-is: what "Your plan" shows today

**File:** `components/business-os/settings/PlanSection.tsx`, inside `SettingsDrawer` on `app/business-os/settings/page.tsx` (row "Your plan", opened by the row or by `?section=plan`).

### 2.1 Blocks, top to bottom

| # | Block | Shown when | Source |
|---|---|---|---|
| B1 | Plan name + price line ("$79 a month", "Free", "Free, no end date") | Always (status `ok`) | `name`, `free`, `accessEndsAt`, `monthlyPriceUsd` |
| B2 | Ending sentence ("Renews on…", "Ends on… It will not renew.", "Your free access ends on…", trial end) | Server sends `endsWhen` | `endsWhen` (billing instants shown on the account's timezone) |
| B3 | Failed renewal: "use the link in Stripe's email" | `billing.state = payment_failed` | `purchase.billing` |
| B4 | 3-D Secure renewal: "Confirm your payment" link (new tab) | `billing.state = action_required` | `billing.confirmUrl` |
| B5 | After checkout: "Payment processing" (re-read every 4 s, up to 15 times), then "You're on {plan}", or "This is taking longer than usual" + "Check again" | `?checkout=` marker on the URL | Server re-read only (M-6) |
| B6 | After upgrade: "Upgrading…", then "You're on {plan}" | An upgrade made in this mount | Server re-read only (U-5) |
| B7 | Free-plan notice: what happens when free ends | `whenThisChanges` | Server sentence |
| B8 | "Your plan includes" — tick list by category (Credits first, with its note) | Always | `included` |
| B9 | The plan above: "{plan} — $129 a month", "What {plan} would add" (adds + improves), "What changes on {plan}" (changes), or "Coming soon" + reason | Server sends `nextPlanUp` | `nextPlanUp` |
| B10 | **Upgrade island** (`PlanUpgrade`): "Upgrade to {plan}" → preview (amount due now excl. tax, "then {price} from {date}", "applies immediately") → Confirm / Cancel → 3-D Secure in place → Upgrading / Declined (+ retry time) / Not confirmed / Could not confirm (Check again, Try again on the same proration date) / Refused (localised by code) | `purchase.upgrade.tiers` not empty, no marker, no upgrade in flight | Server offer (same predicate as the upgrade routes) |
| B11 | **Choose list** (`PlanPurchase`): each plan with "$X a month, excluding tax", "Choose {plan}" or "Pay for {plan}" (own admin-assigned plan, with note), "Coming soon" for shown-not-offered, "Your trial / free access ends today if you buy" note, "not configured" line, embedded Stripe checkout in place, refusal line | `purchase.offer.kind = choose`, no marker | Server offer (same predicate as the checkout) |
| — | Loading spinner; "Plan unavailable" notice; server `problem` sentence | Loading / failed read / status not `ok` | — |

### 2.2 Per account state

| Account state | Shows today | Actions today |
|---|---|---|
| **Trial (Test Flight)** | B1 "Free", B2 trial end, B7, B8 (trial values), B9 (Autopilot adds) | B11: Choose Essentials / Autopilot, with "your trial ends today if you buy" |
| **Founding Partner, no end date** | B1 "Free, no end date", B8 (Autopilot-level), no B9 (nothing above Autopilot) | **None.** Checkout refuses them (BQ-P10), so no Choose |
| **Founding Partner, end date set** | B1, B2 "free access ends on…", B7, B8 | B11 with "your free access ends today if you buy". No founder discount yet (P-11 not built) |
| **No plan / paused / ended** | B1/B2 as sent, B8 | B11 (F1 buy again) |
| **Essentials, renewing** | B1 "$79 a month", B2 "Renews on…", B8, B9 (Autopilot adds chat + credits) | B10: Upgrade to Autopilot |
| **Essentials, cancelling** | B2 "Ends on… It will not renew." | As sent by the server (upgrade offer is its decision) |
| **Autopilot, renewing** | B1, B2, B8, no B9 | None |
| **Payment failed** | B3 added | As sent |
| **3-D Secure needed on renewal** | B4 added | Confirm payment link |
| **Admin-assigned tier, no Stripe billing** | B1, B8 | B11 "Pay for {plan}" + note; B10 own-plan note (Q-5) |
| **Held invitee** | Not here: the holding screen (`/invite/awaiting-payment`) | Out of scope |
| **Just paid / just upgraded** | B5 / B6 | Check again |
| **Stripe key missing** | "not configured" line instead of buttons | None |

**Every state and action above must survive the redesign** (UM-FR1).

### 2.3 Existing links into the plan view

| From | Goes to | Change in this requirement |
|---|---|---|
| Settings "Your plan" row | Plan drawer | Drawer also gets the "See plans" button (§5.1) |
| `?section=plan` (pill, banner, checkout return, emails) | Plan drawer | Unchanged |
| Founding Partner pill (`PlanBadgePill`) | `?section=plan` | **Unchanged**: one placement, deliberately quiet (user decision 2026-09-27) |
| Payment banner (`PlanPaymentBanner`) | `?section=plan` | **Unchanged**: billing problems belong in the drawer, not in a sales modal |
| Credits card (`UsageCard`) | No plan link | **Unchanged**: "no upgrade wording" on the card is a recorded decision (slice 10). See §15 |

---

## 3. User stories

- As an **owner on a trial**, I want to see the two plans side by side, with prices and what I get, so that I can choose one with confidence.
- As an **Essentials owner**, I want to see clearly what Autopilot adds and what I would pay now, so that I can decide whether to upgrade.
- As an **owner who tried something my plan does not include** (future), I want a window that says which plan unlocks it and lets me get it there, so that I don't have to go looking in Settings.
- As a **Founding Partner whose free access has an end date**, I want an invitation that tells me I can keep everything I have, so that moving to a paid plan feels like continuing, not starting over.
- As the **platform owner**, I want one upgrade window that any screen can open, so that every upgrade prompt looks and behaves the same.
- As an **Autopilot owner**, I want the window to show that I already have the top plan and offer me nothing to buy, so that it never looks like a sales pitch for something I already pay for.

---

## 4. The modal

### 4.0 User design decision UM-D1 (2026-10-19): comparison table, not cards

The user rejected the first (card-based) mockup and approved a second one (path in the header). In the user's words: plans side by side as columns, "one column as the scope and V or X if it's supported or not supported for that tier", the price at the top under the plan name, the upgrade button under the price and at the bottom, and the current plan shown. Then: "yes, let's go with this mockup".

**UM-D1 supersedes the card layout in §4.1, §4.2 and §4.5 wherever they disagree.** What stays: the header band, the status strip, the context headlines (§5), colours and tokens (§4.3, with C-9's contrast rule), icons, RTL, every flow and server rule (UM-FR1 to UM-FR13).

| Part | Decided design |
|---|---|
| **Table shape** | A comparison table. **First column = the scope** (feature rows), grouped under row headings: **Run your business**, **AI assistant**, **Included each month**. Then **one column per plan** (Essentials, Autopilot), side by side, in the server's order |
| **Column header** | Plan name; the **price directly under it** ("$79" big, "a month, excluding tax" small); the **action button under the price** |
| **Column footer** | The **same button repeated** at the bottom of the column |
| **Feature cells** | **✓** where the plan includes the row, **✕** where it does not (e.g. AI chat on Essentials). Icon plus an accessible text label ("Included" / "Not included"), never colour or icon alone |
| **Quantity rows** | Show the value: credits **19,750** vs **32,250**, emails, team seats · locations. The **higher value is highlighted** (the server's `highlight`; in UM-1a, semibold weight in `--v2-text-primary`, because `--v2-primary-dark` text fails AA on the dark surface: SA code review F-2); equal values are not |
| **Current plan** | Column marked **"Your plan"** (badge above the header, calm grey top border and tint); in header and footer it carries a **non-interactive "Current plan" label** styled like a quiet button, never a disabled button (C-22), and only when the server offers nothing for that column |
| **Recommended** | **"Recommended"** badge and a tinted column (`--v2-primary` at about 6 %, `--v2-primary` top border) on the plan picked by **UM-SA4 as amended by UM-BQ4** (2026-10-19): the **last** entry of the server-ordered `plans` that the server offers (`offer.tiers` when choosing, plus `upgrade.tiers`) and that is not the current tier; none if nothing qualifies. `nextPlanUp` no longer picks the ribbon (it still drives the drawer's B9 and the coming-soon reason). So trial and Essentials owners see Autopilot recommended (the user's UM-BQ4 decision) |
| **Status strip** | "You're on {plan} · {price} · {ending}" above the table: unchanged |
| **Trial / Founding Partner** | **No current column** (they are not on a tier). The status strip carries them ("You're on the free trial · ends on …"). Both plan columns show the server's action (Choose / Pay for / Coming soon / none) |
| **Header band and colours** | As before: gradient band, tokens only, C-9 contrast rule applies (small white text on `--v2-primary-dark`) |
| **Phone** | **Not in the mockup: open item UM-D1-M for SA / Dev** (below) |

**Every column needs every row**, so the full per-plan contents (formerly optional UM-4) are now required for the first build (§10, §11, UM-BQ3).

**Feature rows come from the server, never typed per plan in the UI.** The row labels, the group each row sits in, and each plan's ✓ / ✕ / value must be derived server-side from the tier matrix and its existing presentation helpers (on `origin/main`: `lib/business-os/entitlements/config/tierMatrix.ts`, `planPresentation.ts` "how a plan is described to a human", `capabilityDisplay.ts` "how a capability value is written", `customerPlanView.ts`) and carried in the plan read. The mockup's row wording is illustrative. The UI renders the matrix it is sent; it never holds a list of features per plan.

**UM-D1-M: phone layout (open, for SA / Dev to propose).** Two candidates:

| Option | How it works | Trade-off |
|---|---|---|
| **M-A (BA recommendation)** | Keep the table. Plan headers (name, price, button) **sticky** at the top of the scroll body; feature label shown as a full-width row above its two compact ✓ / ✕ cells; two plan columns fit at 360 px because the cells are icons or short numbers | Keeps the side-by-side comparison the user asked for; two plans fit. Breaks down if a third plan is ever shown |
| M-B | **One plan at a time** with a segmented toggle (Essentials / Autopilot), the recommended plan selected first, ✓ / ✕ list below | Scales to more plans; loses the at-a-glance comparison, which is the point of UM-D1 |

BA recommends **M-A** for two plans, with M-B as the fallback if SA finds it does not fit at 360 px without horizontal scroll (§9 Responsive).

### 4.1 Layout (desktop, ≥ 640 px)

> **Superseded in part by UM-D1 (§4.0):** "Plan cards" and "In-card flow" below describe the rejected card layout. The table replaces the cards; where a flow (checkout, upgrade preview) appears in the table layout is for SA / Dev to propose in the re-review (e.g. it replaces the table area, as the checkout replaced the cards area).

| Part | Content | Source |
|---|---|---|
| **Header band** | Gradient band (§4.3) with a `Sparkles` icon, a **headline** that depends on the context (§5), and a one-line subheading. Close X at the end (start in RTL) | Copy keys + context |
| **Status strip** | "You're on {plan} · {price line} · {ending sentence}" in one muted line | B1 + B2 |
| **Plan cards** | One card per plan in `plans`, **side by side**, in the server's order (cheapest first, RTL mirrors it). Each card: name, price ("$79" big, "a month, excluding tax" small), a **"Your plan"** marker on the current one, a **"Recommended"** ribbon on the highlighted one, its feature list (§4.2), and its action | `plans`, `purchase` |
| **Card action** | Exactly what the server offers for that plan: "Choose {plan}" / "Pay for {plan}" (Choose flow, B11) or "Upgrade to {plan}" (upgrade flow, B10). A plan the server does not offer: "Coming soon" chip, **no button**. The current plan: "Your plan" text, no button | `purchase.offer.tiers`, `purchase.upgrade.tiers` |
| **In-card flow** | Choosing opens the embedded Stripe checkout **inside the modal**, replacing the cards area (the other card's buttons go away, as today). Upgrading shows the preview (amount due now, "then … from …", Confirm / Cancel) in the chosen card, and every outcome of B10 | Unchanged components |
| **Footer** | Small print, all existing copy: "Prices in USD, excluding tax"; the "your trial / free access ends today if you buy" sentence when the server sends it; for a trial, the B7 notice | `endsFreeAccessOnPurchase`, `whenThisChanges` |

**Width:** the cards need about 720–880 px; the modal is wider than today's dialogs (UM-SA3). **Height:** the modal body scrolls inside the viewport (the shared dialog already caps height with `100dvh`).

### 4.2 Feature lists on the cards (from today's payload only)

> **Superseded by UM-D1 (§4.0):** every column now shows every row, so the "name, price and action only, until UM-4" line no longer applies. Kept for history.

| Card | Shows | Icon |
|---|---|---|
| The **current** plan | "Your plan includes": `included` rows (Credits first, as today) | `Check` in `--v2-primary` |
| The **plan above** (`nextPlanUp`) | "Everything in {current plan}, plus:" then `adds` and `improves` rows ("Credits: 19,750 → 32,250 per month"); then `changes` under their own heading "What changes", never as gains (SA R2-1, unchanged) | `Plus` / `Sparkles` for adds, `TrendingUp` (or `ArrowUp`) for improves, `ArrowRight` for changes |
| **Any other** plan | Name, price and action only, **until UM-4** (§10, UM-BQ3) | — |
| A plan that can't be bought | "Coming soon" chip + the server's reason sentence (`actionUnavailableBecause`) | — |

> ~~**No withheld list, no lock rows by default**~~ — **SUPERSEDED 2026-10-19 by UM-D1: the user reversed UM-BQ2.** ✕ is now shown on rows a plan does not include (e.g. AI chat on Essentials). The trade-off the BA raised is kept on record: production runs entitlements in **shadow** mode, so Essentials owners can currently still use chat; the table shows the plan **as defined**, not today's enforcement. Also for SA: `origin/main` pins the opposite rule in `lib/business-os/entitlements/__tests__/customerPlanView.noExclusions.test.ts` ("the surface lists what a plan INCLUDES, and never renders a list of what the customer does not have"), so a ✕ in the current-plan column needs an SA ruling (UM-SA13). The original paragraph, for history:

**No withheld list, no lock rows by default** (UM-BQ2): today's screen deliberately lists only what a plan **includes**, because the "missing" items are either things nobody can buy or things the owner already has (chat is not enforced for Essentials: FR-46, entitlements doc). A row of locks on Essentials would tell Essentials owners they lack chat, and they use it today. The **lock icon** appears only in the locked-action header (§5.2), where the server has named the plan.

### 4.3 Colour approach (on-brand, tokens only)

Business OS theming sets the `--v2-*` tokens (`app/v2/globals-v2.css`, overridable by the theme provider), so the modal uses **tokens only**, never hex values.

| Element | Light and dark | Note |
|---|---|---|
| Header band | `bg-gradient-to-br` from `--v2-primary` to `--v2-secondary`, white text | The same pairing as the Settings page header icon (`from-[var(--v2-primary)]/20 to-[var(--v2-secondary)]/20`), at full strength |
| Modal body | `--v2-bg`; cards on `--v2-surface` with `--v2-shadow-card`, `--v2-radius-card` | As every Business OS card |
| Recommended card | 2 px ring in `--v2-primary`, a very light tint (`--v2-primary` at about 6 %), "Recommended" ribbon on the gradient | The only coloured card |
| Current plan card | `--v2-border` ring, "Your plan" chip on `--v2-surface-hover` with `Check` | Calm, never the loud card |
| Primary button | Gradient `--v2-primary` → `--v2-secondary`, white text, `--v2-shadow-button`, `--v2-radius-button` | One primary button per state |
| Ticks | `--v2-primary`; "adds" icons `--v2-secondary`; improves `--v2-success` | Colour is never the only signal: every row has words (WCAG 1.4.1) |
| Errors / declined / refused | `--v2-error-*` tokens | Replaces today's hard-coded `text-red-700` inside the modal only |
| Dark mode | Same tokens: the dark overrides (`.dark`, applied to Radix portals) already cover `--v2-bg`, `--v2-surface`, text and borders. The gradient keeps white text, which is legible on the indigo/violet pair in both themes | Business OS supports dark mode through `V2ThemeProvider` |

**Contrast:** white on `#6366F1` is about 4.5:1 (body text passes AA at 16 px). Small white text on the lighter `#8B5CF6` end is weaker, so the headline sits on the darker end or uses `--v2-primary-dark` (UM-SA3 check).

### 4.4 Icons

`lucide-react` is already used (`Sparkles`, `Check`, `ArrowRight`, `Loader2`, `Info`, `CreditCard`). Proposed: `Sparkles` (header, adds), `Check` (included), `Plus` (adds), `TrendingUp` (improves), `ArrowRight` (changes), `Crown` or `Star` (Recommended ribbon), `Lock` (locked-action header only), `Loader2` (busy states), `X` (close). Icons are decorative (`aria-hidden`); the words carry the meaning.

### 4.5 Mobile (< 640 px)

> **Superseded in part by UM-D1:** "cards stack, recommended first" applied to cards. The phone layout of the table is open item **UM-D1-M** (§4.0; BA recommends sticky plan headers with compact columns). The sheet, sticky header, full lists and "Back to plans" rules below still apply.

- Full-height sheet (the shared dialog's flex variant, like the scheduling dialog), its own scroll body, sticky header with the close X.
- Cards **stack**, the **recommended card first**, and the current plan after it with a "Your plan" chip. The status strip stays at the top.
- Each card's feature list is shown in full (no "+N more" expander: the same reason PlanSection gives).
- When a flow starts (checkout or upgrade preview), the modal shows only that card's flow and a "Back to plans" link (only where the flow allows it: never during Confirm, 3-D Secure or "Could not confirm").

### 4.6 RTL (Hebrew)

- `dir="rtl"` on the content; cards mirror (cheapest on the right); the close X moves to the start edge; directional icons (`ArrowRight`, chevrons) mirror with `scale-x-[-1]`, as the Settings rows do.
- Prices stay in digits and USD (SR-15); every sentence is one dictionary key with slots, so translators can order the words.
- New copy keys exist in en / he / es; the he / es wording is a draft for the user's approval before merge (as in P-4.2 and P-6a.2).

---

## 5. Entry points: the "open upgrade modal" contract

One way to open the modal from any Business OS screen. The caller passes **context** only; the modal reads the plan itself (the same `my-plan` read), so a caller never passes names, prices or offers.

| Context | Who opens it | Headline (copy key) | Highlighted card | Status |
|---|---|---|---|---|
| `settings` | Settings "See plans" button | "Choose the plan that fits your business" (or "You're on our top plan" when nothing is offered) | The recommended plan (UM-BQ4) | **Built in UM-1** |
| `locked_feature` | A screen whose action the server refused, passing the plan the **server's refusal named** | `Lock` + "This needs {plan}", subheading: what the plan adds | The plan the caller passed; if the server does not offer it, the modal says so (no button) | **Contract built in UM-2; no real caller yet** (§5.2) |
| `founding_partner` | Future owner-initiated prompt | "Keep everything you have with Founding Partner", subheading: "Your free access ends on {date}. Choose a plan to carry on without a break." | The recommended plan (UM-BQ4) | **Variant built in UM-2; mechanism out of scope** (§5.3) |

### 5.1 From Settings (recommendation)

**Recommendation: keep the drawer, add a "See plans" button that opens the modal; move the Choose and Upgrade actions into the modal.**

| | Option A: drawer keeps a summary + button (recommended) | Option B: the row opens the modal; the drawer goes away |
|---|---|---|
| Drawer content | B1–B9: what you're on, renewal, billing problems, "processing" / "You're on…" after payment, what's included. Plus a coloured "See plans" card-button | — |
| Modal content | Cards, comparison, Choose and Upgrade | Everything, sales and account status |
| Why | The drawer is the **account** home: billing problems, the checkout return (`?section=plan&checkout=…`) and future card / invoices / cancel (P-7a) belong there. The modal stays a clean **sales** window that any page can open | One place, less to build |
| Risk | Two surfaces to keep consistent (mitigated: both render the same payload) | A paying owner with a failed card gets a sales modal; P-7a would put "Cancel plan" inside an upsell window |

**Button rules:** "See plans" when the server offers something (`offer.kind = choose` or `upgrade.tiers` not empty); "Compare plans" (view-only) otherwise, so an Autopilot owner can still see the plans with no buy buttons. No dead buttons anywhere.

### 5.2 From a locked action (contract now, callers later)

**Fact:** nothing is refused by plan today. Production runs entitlements in `shadow` mode, so every decision is recorded and nothing is blocked (entitlements doc). The first real refusal arrives with entitlements Slice 2 (for example the chat gate, FR-46c, which is specified as an assistant message naming Autopilot).

So this requirement delivers:

1. The **contract**: a caller can open the modal with `locked_feature` and the plan id the server named.
2. The **variant**: lock header, "This needs {plan}" (the name read from the payload, not from the caller), that card highlighted.
3. **No real trigger.** Wiring the modal to an actual refusal is a follow-up for the slice that ships the refusal (§15).

The modal never decides which plan unlocks a feature: that is the refusal's job. If the named plan is not offered to this account (for example a Founding Partner with no end date), the modal shows the plan and the server's reason, with no button.

### 5.3 Founding Partner prompt (UI variant only)

- Shown **only** when the server offers this account a plan and says buying ends free access (`purchase.endsFreeAccessOnPurchase = 'free_access'`). That is a server-decided signal, so the UI compares no cohort names.
- Before an admin sets the end date, the server offers a Founding Partner nothing (BQ-P10). The modal then shows their plan and "You have every Autopilot feature, free" with **no buy button**. It never offers a purchase that checkout would refuse.
- The founder discount (50 % for 24 months, BQ-P1) is **not shown** until P-11 ships it in checkout. Showing it earlier would be untrue.
- **Out of scope:** deciding when and to whom the prompt is shown (who, how often, dismissal memory, email or in-app). That needs new data and behaviour (§15, follow-up UM-F1).

---

## 6. Conversion-oriented presentation

No dark patterns: no fake urgency or countdowns, no "most popular" without data, no pre-ticked options, no confirm-shaming ("No, I don't want to grow"), and closing is always one click.

| # | Idea | Tag | Needs new data? |
|---|---|---|---|
| CV-1 | Outcome headline per context (§5) rather than "Your plan" | **Recommended** | No (copy) |
| CV-2 | Big price figure, small "a month, excluding tax" (M-8 wording kept) | **Recommended** | No |
| CV-3 | "Everything in {current}, plus:" framing on the higher card, from `adds` / `improves` | **Recommended** | No |
| CV-4 | The credits jump as a before → after line ("19,750 → 32,250 credits a month"), from `improves` | **Recommended** | No |
| CV-5 | For Essentials payers: "Applies immediately. You pay only the difference for the rest of this month." (existing `plan.upgrade.immediate` + the preview amount) | **Recommended** | No |
| CV-6 | One highlighted "Recommended" card, one primary button per state | **Recommended** | No |
| CV-7 | Founding Partner framing: "Keep everything you have" (they already have Autopilot-level access) | **Recommended** (variant only) | No |
| CV-8 | Plain-language note under Credits (the existing credit explanation sentence) | **Recommended** | No (existing note) |
| CV-9 | A short "What you can do with Autopilot" line per added capability (one-sentence benefit, not a feature name) | Optional | Copy per capability; must come from config or presentation, never typed per plan in the UI (UM-SA4) |
| CV-10 | "Cancel anytime" reassurance | Optional, **only after P-7a** ships in-app cancel. Before that it's not a button the owner can find | No |
| CV-11 | Full contents on every card (not only the current plan and the one above) | ~~Optional~~ **Required since UM-D1** (every column needs every row) | **Yes**: a read-only per-plan list in the plan read (§10) |
| CV-12 | Customer quotes or "N businesses upgraded" | **Not now**: there is no real social proof yet. Reconsider when real quotes or counts exist | Would need real data |
| CV-13 | Annual price with a saving | **Out of scope** (no annual prices, Q-B8) | Yes |

---

## 7. Wireframes

### 7.0 Desktop comparison table (UM-D1, approved 2026-10-19)

Essentials owner, context `settings` (LTR). Row wording is illustrative; rows come from the server (§4.0).

```text
+----------------------------------------------------------------------------+
| [gradient --v2-primary-dark -> --v2-secondary]                          [X] |
|  Choose the plan that fits your business                                   |
|  Upgrade any time. You only pay the difference for the rest of this month. |
+----------------------------------------------------------------------------+
|  You're on Essentials · $79 a month · renews on 12 November                |
|                                                                            |
|                                      [ Your plan ]      [* Recommended ]   |
|                                   +----------------+ +==================+  |
|                                   |  Essentials    | ||  Autopilot     ||  |
|                                   |  $79           | ||  $129          ||  |
|                                   |  a month,      | ||  a month,      ||  |
|                                   |  excl. tax     | ||  excl. tax     ||  |
|                                   | [Current plan] | || [Upgrade to    ||  |
|                                   |  (disabled)    | ||   Autopilot ] ||  |
|  RUN YOUR BUSINESS                |                | ||  (tinted)      ||  |
|  CRM, contacts and documents      |       v        | ||      v         ||  |
|  Online booking, calendar sync    |       v        | ||      v         ||  |
|  AI-built website                 |       v        | ||      v         ||  |
|  Intake forms and reminders       |       v        | ||      v         ||  |
|  Invoices, card payments          |       v        | ||      v         ||  |
|  Insights and daily briefing      |       v        | ||      v         ||  |
|  Priority support                 |       v        | ||      v         ||  |
|  AI ASSISTANT                     |                | ||                ||  |
|  Chat with your AI assistant      |       x        | ||      v         ||  |
|  Ask it to send emails            |       x        | ||      v         ||  |
|  Ask it to schedule and invoice   |       x        | ||      v         ||  |
|  Reports and bulk actions by chat |       x        | ||      v         ||  |
|  INCLUDED EACH MONTH              |                | ||                ||  |
|  Credits for AI work              |    19,750      | ||   *32,250*     ||  |
|  Emails                           |    10,000      | ||    10,000      ||  |
|  Team seats · locations           |    1 · 1       | ||    1 · 1       ||  |
|                                   | [Current plan] | || [Upgrade to    ||  |
|                                   |  (disabled)    | ||   Autopilot ] ||  |
|                                   +----------------+ +==================+  |
|                                                                            |
|  Prices in USD, excluding tax.                                             |
+----------------------------------------------------------------------------+
```

`v` = ✓ included, `x` = ✕ not included, `*…*` = the higher value highlighted. For a **trial** owner (mockup scenario 2): no "Your plan" column, status strip "You're on the free trial · ends on …", both columns carry the server's Choose button in header and footer, Autopilot recommended. In Hebrew the table mirrors (scope column on the right). Phone: open item UM-D1-M.

### 7.1 Desktop (LTR, Essentials owner, context `settings`)

> **Superseded by UM-D1 (§7.0):** the card wireframes in §7.1 and §7.3 show the rejected design. Kept for history; §7.2's lock header still applies, over the table.

```text
+----------------------------------------------------------------------------+
| [gradient --v2-primary -> --v2-secondary]                               [X] |
|  * Choose the plan that fits your business                                 |
|    Upgrade any time. Prices in USD, excluding tax.                         |
+----------------------------------------------------------------------------+
|  You're on Essentials · $79 a month · Renews on 12 November 2026           |
|                                                                            |
|  +-------------------------------+   +==================================+  |
|  | Essentials        [Your plan] |   ||  [* Recommended]               ||  |
|  | $79                           |   ||  Autopilot                     ||  |
|  | a month, excluding tax        |   ||  $129                          ||  |
|  |                               |   ||  a month, excluding tax        ||  |
|  | Your plan includes            |   ||                                ||  |
|  |  v Credits                    |   ||  Everything in Essentials,     ||  |
|  |    19,750 per month           |   ||  plus:                         ||  |
|  |  v CRM and contacts           |   ||  + AI chat assistant           ||  |
|  |  v Scheduling                 |   ||  ^ Credits 19,750 -> 32,250    ||  |
|  |  v Invoices and payments      |   ||    per month                   ||  |
|  |  v ...                        |   ||                                ||  |
|  |                               |   ||  [  Upgrade to Autopilot  ]    ||  |
|  |  (no button)                  |   ||  Applies immediately. You pay  ||  |
|  |                               |   ||  only the difference this month||  |
|  +-------------------------------+   +==================================+  |
|                                                                            |
|  Prices in USD, excluding tax.                                             |
+----------------------------------------------------------------------------+
```

After "Upgrade to Autopilot", the Autopilot card shows the preview in place:

```text
||  Due now: $41.20 (excluding tax)                     ||
||  Then $129 a month from 12 November 2026             ||
||  Autopilot applies immediately.                      ||
||  [ Confirm upgrade ]   [ Cancel ]                    ||
```

### 7.2 Desktop, context `locked_feature` (future caller)

```text
+----------------------------------------------------------------------------+
| [gradient]  (lock) This needs Autopilot                                 [X] |
|             Autopilot adds the AI chat assistant and more credits.         |
+----------------------------------------------------------------------------+
|  ... same cards, Autopilot highlighted ...                                 |
```

### 7.3 Mobile (stacked, recommended first)

```text
+------------------------------+
| [gradient]               [X] |
| * Choose the plan that       |
|   fits your business         |
+------------------------------+
| You're on Essentials         |
| $79 a month · Renews 12 Nov  |
|                              |
| +==========================+ |
| | [* Recommended]          | |
| | Autopilot   $129 / month | |
| | excluding tax            | |
| | Everything in Essentials,| |
| | plus:                    | |
| | + AI chat assistant      | |
| | ^ Credits 19,750->32,250 | |
| | [ Upgrade to Autopilot ] | |
| +==========================+ |
|                              |
| +--------------------------+ |
| | Essentials  [Your plan]  | |
| | $79 / month              | |
| | v Credits 19,750 / month | |
| | v ...                    | |
| +--------------------------+ |
|                              |
| Prices in USD, excl. tax.    |
+------------------------------+
```

In Hebrew the whole layout mirrors: X on the left, cards right to left, text aligned right.

---

## 8. Functional requirements

| # | Requirement |
|---|---|
| **UM-FR1** | Every state and action in §2 remains reachable and behaves as today: the same server predicates, the same refusals, the same "success only from the server re-read" (M-6, U-5), the same test-id coverage or its documented replacement |
| **UM-FR2** | The modal reads the plan through the existing `my-plan` read (`planDrawerReads`). No new route, no new request field, no query string on that route |
| **UM-FR3** | A Choose button appears exactly for `purchase.offer.tiers`, an Upgrade button exactly for `purchase.upgrade.tiers`. A plan shown but not offered has "Coming soon" and no control. Never a dead button |
| **UM-FR4** | The embedded checkout (`PlanEmbeddedCheckout`) and the upgrade flow (`PlanUpgrade`) are reused, not rewritten. Their requests, payloads and return surface (`settings_plan`) are unchanged |
| **UM-FR5** | After Stripe completes a checkout started in the modal, the owner lands on Settings → Plan with the return marker, as today, and sees "Payment processing", then the server's answer. A checkout started on another page also returns there (UM-SA10) |
| **UM-FR6** | After a confirmed upgrade, the owner sees "Upgrading…" and then "You're on {plan}" only from the server's re-read (U-5) |
| **UM-FR7** | The current-plan marker and the recommended highlight come from server data (§4.2, UM-BQ4, UM-SA4). The UI never compares cohort or plan-id strings to decide them |
| **UM-FR8** | The modal can be opened with a context (`settings`, `locked_feature` + plan id, `founding_partner`). The context changes the headline and the highlight only. It never changes what is offered |
| **UM-FR9** | `founding_partner` copy shows only when `endsFreeAccessOnPurchase = 'free_access'` and the server offers a plan. Otherwise the modal falls back to the `settings` copy |
| **UM-FR10** | No founder discount, social proof, urgency or "cancel anytime" text until the data or feature behind it exists (§6) |
| **UM-FR11** | Closing is always available except while a request that must not lose its screen is in flight (Confirm, 3-D Secure). Today's drawer has no busy lock; the modal adds one for those moments only (UM-SA2) |
| **UM-FR12** | The Settings drawer keeps B1–B9 and gains the "See plans" / "Compare plans" button (§5.1, Option A unless the user picks B in UM-BQ1). `?section=plan` behaviour is unchanged |
| **UM-FR13** | All new strings are dictionary keys in en / he / es; prices in digits and USD; dates formatted as today (billing instants on the account's timezone) |

---

## 9. Non-functional requirements

- **Performance:** opening from Settings reuses the prefetched first read (`useDrawerPrefetch`, C-b) when it is valid; from anywhere else the modal reads once on open. No extra request on page load from other pages. Show the cards' skeleton while loading, not a blank modal.
- **Security:** no new route, no new input; nothing from the URL or the caller decides price, plan or offer. The client secret stays inside `PlanEmbeddedCheckout`; the upgrade confirmation secret stays inside `PlanUpgrade` (V-1). No `console.*`; Pino via `createLogger`.
- **Accessibility:** Radix dialog (focus trap, Escape, focus return to the opener); a real title (the headline) and description; the card list is a list with each card's name as its label; "Recommended" and "Your plan" in text, not only colour; the lock and sparkle icons `aria-hidden`; AA contrast on the gradient (§4.3); visible focus rings on buttons.
- **Responsive:** 360 px to desktop; no horizontal scroll; the Stripe frame fits on a phone.
- **Theming:** `--v2-*` tokens only; correct in light and dark.
- **Testing:** Jest for the modal states (one test per §2.2 row that has an action), RTL rendering, the context variants and the "no dead button" rule. QA manual check of buy, upgrade, 3-D Secure, checkout return and mobile in the sandbox (the precedent of C-b).

---

## 10. What is pure UI and what would need new data

| Item | Pure UI? | Notes |
|---|---|---|
| Modal, cards, colours, icons, mobile, RTL, dark mode | ✅ Yes | — |
| Current-plan marker, statuses, offers, upgrade flow, checkout | ✅ Yes | Already in the payload |
| "What the higher plan adds" on its card | ✅ Yes | `nextPlanUp` |
| Recommended highlight | ✅ Yes, if derived from `nextPlanUp` / server order (UM-SA4) | A server "recommended" field would be new data. Not needed for v1 |
| Founding Partner variant headline | ✅ Yes | Keyed on `endsFreeAccessOnPurchase` |
| Locked-action variant | ✅ Yes (contract) | **Real triggers need entitlement enforcement (Slice 2)**: follow-up |
| Full contents on **every** card (e.g. Essentials' own list while on a trial, or Essentials' list for a Founding Partner) | ❌ **New data** | The payload carries contents only for the current plan (`included`) and the plan directly above (`nextPlanUp`). A per-plan list would be a read-only addition to `my-plan` (or a reuse of the `/invite` page's plan description). ~~UM-4, only if UM-BQ3 is yes~~ **Required for the first build since UM-D1 (2026-10-19)**: a per-plan feature matrix (rows, groups, ✓ / ✕ / value per plan) built server-side from the tier matrix presentation, no input, no Stripe call, no migration expected. This means **the first slice is no longer pure UI**; SA to re-rule slicing and route ownership (UM-SA13); full cycle (money route) |
| Founder discount on cards | ❌ New behaviour | P-11 |
| Deciding when / whom to prompt (champions, upsell nudges) | ❌ New data + behaviour | UM-F1 |
| Returning to the page the modal was opened on after checkout | ❌ Server change | A new checkout return surface: UM-F3 |

---

## 11. Slices

UI short path (Dev → SA code review + QA in parallel → user sees the diff → RM). Because the modal hosts the buy and upgrade buttons, SA's code review must confirm that purchase, checkout return and upgrade are unaffected, and QA must check those three in the sandbox. This follows the C-b precedent (UM-SA11).

| Slice | Scope title | Done means (the demo) | Est. |
|---|---|---|---|
| **UM-1** | **Plan cards modal from Settings** | The Settings drawer shows a coloured "See plans" button. The modal opens with the gradient header, plan cards side by side (stacked on a phone), the current plan marked, Autopilot highlighted, "Everything in Essentials, plus:" from `nextPlanUp`. Choose (embedded checkout) and Upgrade (preview → confirm → outcomes) work inside the modal for every §2.2 state. The checkout return still lands in the drawer with "Payment processing". en / he (RTL) / es, light and dark. Jest per state; QA sandbox buy + upgrade + 3-D Secure | 3–3.5 d |
| **UM-2** | **Open the modal from anywhere** | One contract to open the modal from any Business OS page with a context. The `locked_feature` variant (lock header, "This needs {plan}", that card highlighted) and the `founding_partner` variant (shown only when the server signals it) are demoed from `/test-business-os` or Storybook-style tests, since no real caller exists yet. A Founding Partner with no end date sees no buy button. No real trigger is wired | 2 d |
| **UM-3** | **Conversion copy and polish** | The recommended copy from §6 (CV-1 to CV-8) in en / he / es, with the user's approval of the he / es wording; the a11y pass (contrast on the gradient, focus order, screen-reader names); a mobile check at 360 px. No new data | 1.5 d |
| **UM-4** (~~optional~~ **required, UM-D1**) | **Full contents on every card** → **per-plan feature matrix for the table** | ~~Only if UM-BQ3 = yes.~~ Now required for the first build (UM-BQ3 = now). A read-only, per-plan feature matrix (row labels, groups, ✓ / ✕ / value per plan) added to the plan read (no input, no Stripe call, no migration expected), rendering every column. **Full cycle** (it touches a money route's payload; SA decides the builder: tier matrix presentation / `capabilityDisplay` / `customerPlanView` / the `/invite` description) | 2 d (to be re-estimated) |

Total UM-1..UM-3: about 6.5–7 days. UM-2 and UM-3 can run in either order after UM-1, never as two open PRs on the same files.

> **UM-D1 (2026-10-19) changes this table — SA to re-rule.** The modal is now a comparison table (§4.0, §7.0) and every column needs every row, so UM-4's data must land **before or with** the first view slice (UM-1a). UM-1a is therefore no longer pure UI: it depends on a read-only addition to `my-plan`, which takes the full cycle. BA proposal for SA to accept or replace: **UM-0 "Plan feature matrix in the plan read"** (server-only, read-only, full cycle, no UI) → **UM-1a "Comparison table modal, view only"** (renders UM-0's matrix; money buttons stay in the drawer, as C-1) → UM-1b → UM-2 → UM-3. Slices stay numbered and unstacked. Phone layout UM-D1-M is decided inside UM-1a.

---

## 12. Business questions for the user

> **Decided 2026-10-18 by the user:** all four recommended defaults accepted ("I accept all four BA defaults").
>
> **Changed 2026-10-19 by the user (UM-D1, comparison-table mockup approved):** **UM-BQ2 REVERSED**: ✕ is shown on rows a plan does not include (e.g. AI chat on Essentials). BA trade-off kept on record: entitlements run in shadow mode in production, so Essentials owners can still use chat today; the table shows the plan as defined, not today's enforcement. **UM-BQ3 timing: "later" → "now"**: every column needs every row, so the full per-plan contents are part of the first build. UM-BQ1 and UM-BQ4 unchanged.

| # | Question | Recommended default |
|---|---|---|
| **UM-BQ1** | In Settings, should "Your plan" keep its drawer (status, renewal, billing problems) with a new "See plans" button that opens the colourful window? Or should the row open the colourful window directly, with everything in it? | **Keep the drawer + add the button** (§5.1). Billing problems and, later, card / invoices / cancel stay in Settings, and the colourful window stays a clean place to choose a plan |
| **UM-BQ2** | Should the plan cards show a lock next to what Essentials does not include (for example AI chat)? | **REVERSED 2026-10-19 (UM-D1): yes, ✕ on rows a plan does not include.** Original default, superseded: **No.** Essentials owners can use chat today (it isn't switched off yet), so a lock would tell them something untrue. Show "Autopilot adds…" instead. Use a lock only when a screen actually blocked something |
| **UM-BQ3** | Today we can describe the owner's current plan and the plan just above it. Showing the full contents of **every** plan (for example Essentials' list to a trial owner) needs a small read-only addition to how the plan is read. Buying is not affected. Do you want it, as a later optional slice? | **CHANGED 2026-10-19 (UM-D1): yes, now** — part of the first build. Original default, superseded: **Yes, but later (UM-4)**, after you have seen UM-1 to UM-3. The main case, an Essentials owner looking at Autopilot, is fully covered without it |
| **UM-BQ4** | Which plan should wear the "Recommended" badge? | **Autopilot**: it is the plan above for trial and Essentials owners, and the plan a Founding Partner already has ("keep everything"). On a locked action, the plan that unlocks it |

---

## 13. For SA

| # | Item |
|---|---|
| **UM-SA1** | **Where the flow state lives.** `PlanSection` owns the checkout-return and upgrade re-reads (bounded, M-6 / U-5). With Choose and Upgrade moved to the modal: does the modal host its own copy of the bounded upgrade re-read, or hand off to the drawer? Constraint: one implementation of "success only from the server" (no second copy of the rule) |
| **UM-SA2** | **Layering.** Opening a dialog from inside the Settings `Sheet` (the discard-prompt precedent: rendered inside `SheetContent`) versus closing the drawer first. Both use `z-[60]`. Stripe's 3-D Secure overlay must sit above the modal (this is already go-live item §9.5 row 20 for the drawer). Busy lock during Confirm / 3-D Secure (UM-FR11) |
| **UM-SA3** | **Sizing.** `dialog.tsx` bases `max-w-lg` and `cn` does not merge classes. A wide modal needs a responsive override (`sm:max-w-4xl`, which wins by media order) or the flex variant for the mobile full-height sheet. Also the gradient contrast check (§4.3) |
| **UM-SA4** | **Recommended and current markers without client rules.** Proposed: current = the payload's own plan; recommended = `nextPlanUp.planId` when present, else the last (highest) entry of the server-ordered `plans`. Rule on whether that positional use is acceptable, or whether a server field is needed (that field would be new data → UM-4 or later) |
| **UM-SA5** | **The open contract** (rule 7: new pattern). Options: a Business OS-level provider with an `openUpgradeModal(context)` hook, or a URL parameter handled by a layout-level listener. It must work from any Business OS page, read the plan itself, and never take names, prices or offers from the caller |
| **UM-SA6** | `SettingsDrawer` is Settings-only by SA ruling. The modal is a new component (proposed `components/business-os/plan/UpgradeModal.tsx`) on `components/ui/dialog` |
| **UM-SA7** | **Entitlements registration:** any new import from `lib/business-os/entitlements/`, type-only included, must be registered (SR-17, `business-os-entitlements` skill). Design intent is zero imports, with mirrored payload types as `PlanSection` does today |
| **UM-SA8** | **Prefetch reuse:** the C-b warm read is taken once per mount and spent after the drawer's first close. Rule how the modal opened from the drawer takes it (or reads fresh) without breaking B-1 to B-3 |
| **UM-SA9** | **Tests and guards that pin today's layout:** `payload.contract.test.tsx`, `accountCard.guard`, the PlanPurchase / PlanUpgrade test ids, and the `enforcementPoints` refusal of entitlements imports. Moving the islands must keep or deliberately replace each one |
| **UM-SA10** | **Return surface:** checkout return stays `settings_plan` (no server change). A purchase started from a non-Settings page therefore ends on Settings → Plan. Confirm this is acceptable for v1 (UM-F3 otherwise) |
| **UM-SA11** | **Path:** confirm the UI short path with the C-b conditions (SA code review that purchase, return and upgrade are unaffected; QA of those in the sandbox), given that the money buttons move |
| **UM-SA12** | Today's `text-red-700` refusal lines become `--v2-error-*` inside the modal. Confirm this colour-only change is fine for the shared islands too, or scope it to the modal |
| **UM-SA13** | **Re-review after UM-D1 (2026-10-19).** (a) **Slicing**: UM-4's data now precedes UM-1a; accept or replace the BA's UM-0 → UM-1a → UM-1b → UM-2 → UM-3 proposal (§11) and re-estimate. (b) **Route ownership / path**: the `my-plan` payload gains a read-only per-plan feature matrix; confirm full cycle, owner, and that no new route, input, Stripe call or migration is needed. (c) **Source of the rows**: server-side from the tier matrix presentation (`planPresentation.ts`, `capabilityDisplay.ts`, `customerPlanView.ts` on `origin/main`) vs the `/invite` description; rows, groups and labels never typed per plan in the UI; confirm the C-6 zero-imports rule still holds for the client (types mirrored). (d) **The ✕ conflict**: `customerPlanView.noExclusions.test.ts` on `origin/main` forbids rendering what the customer's own plan excludes; rule how a ✕ in the current-plan column is reconciled (amend that invariant with its documented reasoning, or another shape) — the user's decision is ✕ shown. (e) **C-10 / UM-SA4** still hold for the "Recommended" column; confirm the "Your plan" column for `kind = 'tier'` only. (f) **Phone layout UM-D1-M** (BA recommends sticky headers + compact columns). (g) **Where flows render** in the table (checkout and upgrade preview replacing the table area?). (h) Which test files and guards change (C-5 list) now that cards become a table |

---

## 14. Acceptance criteria

- [ ] **AC-UM1** From Settings → Your plan, "See plans" opens the modal; Escape, the X and the backdrop close it, and focus returns to the button.
- [ ] **AC-UM2** A trial owner sees Essentials and Autopilot side by side, each with "$X a month, excluding tax" and a Choose button, and the "your trial ends today if you buy" sentence.
- [ ] **AC-UM3** An Essentials owner sees Essentials marked "Your plan" with no button, and Autopilot highlighted with "Everything in Essentials, plus:" and "Upgrade to Autopilot". The preview, Confirm, Declined, Not confirmed, Could not confirm (Check again / Try again) and Refused states all render as today.
- [ ] **AC-UM4** An Autopilot owner sees their plan marked and **no** buy or upgrade button.
- [ ] **AC-UM5** A Founding Partner with no end date sees no buy button. With an end date, they see the "Keep everything you have" headline and Choose buttons.
- [ ] **AC-UM6** A plan the server does not offer shows "Coming soon" and no control.
- [ ] **AC-UM7** Completing checkout in the modal (sandbox) lands on Settings → Plan showing "Payment processing", then "You're on {plan}" from the server. A failed re-read never claims success.
- [ ] **AC-UM8** A 3-D Secure upgrade completes in place, above the modal, and ends with "Upgrading…" then "You're on Autopilot".
- [ ] **AC-UM9** Opening with `locked_feature` + `pro` shows the lock header "This needs Autopilot" with the Autopilot card highlighted. If Autopilot is not offered to that account, no button is shown.
- [ ] **AC-UM10** In Hebrew the modal is right to left, cards mirrored, the X on the left, prices in digits and USD.
- [ ] **AC-UM11** ~~At 360 px the cards stack with the recommended one first; no horizontal scroll; the Stripe frame is usable.~~ **Superseded (UM-D1, C-24 / C-26):** at 360 px the comparison table keeps both plan columns side by side (phone M-A): a sticky plan header row (name, price, action), each feature label on its own line above its two compact cells, the columns in server order (no re-ordering), and no horizontal scroll. The Stripe frame is usable (UM-1b).
- [ ] **AC-UM12** Light and dark modes both read correctly; all colours come from `--v2-*` tokens; the gradient text passes AA.
- [ ] **AC-UM13** No new route, no change to `my-plan`, checkout or upgrade routes (UM-1 to UM-3), and no new import from `lib/business-os/entitlements/` without registration. **UM-D1:** `my-plan` now gains the read-only feature matrix (UM-4); the rest of this criterion stands, pending SA UM-SA13.
- [ ] **AC-UMD1** (UM-D1) The modal is a comparison table: scope column + one column per plan; price under the name; the action under the price and repeated at the bottom; ✓ / ✕ per row with text labels; quantity values with the higher one highlighted; the current tier column marked "Your plan" with a **non-interactive "Current plan" label** (not a button, not a disabled control; C-22), shown only when the server offers nothing for that column, otherwise the server's action; the "Recommended" column per UM-BQ4 / amended UM-SA4; no current column for trial / Founding Partner; every row comes from the server payload, none typed in the UI.
- [ ] **AC-UM14** No founder discount, social proof, countdown or "cancel anytime" text appears.

---

## 15. Out of scope / future roadmap

| # | Item | Why / when |
|---|---|---|
| UM-F1 | **When and whom to prompt** (champions to convert, usage-based nudges): targeting, frequency, dismissal memory, in-app vs email | New data and behaviour. Its own requirement once the owner wants to run conversions |
| UM-F2 | **Real locked-action triggers** | Need entitlement enforcement (Slice 2, e.g. the FR-46 chat gate). Each refusing slice wires `locked_feature` |
| UM-F3 | Return to the originating page after checkout | New checkout return surface (server) |
| UM-F4 | Founder discount on cards | Ships with P-11 |
| UM-F5 | Upgrade link on the Credits card when credits run low | Contradicts the recorded "no upgrade wording" decision (credit deduction slice 10). User decision needed first |
| UM-F6 | Social proof, annual plans, downgrade in the modal (P-7b.2), card / invoices / cancel (P-7a) | Data or features not yet built; downgrade and billing admin stay in the drawer |
| UM-F7 | Held invitee holding screen restyle | Different surface (`/invite/awaiting-payment`) |
| — | Changing the Founding Partner pill or the payment banner targets | Settled decisions (§2.3) |

---

## 16. Open questions

- [x] UM-BQ1 to UM-BQ4 (raised by: BA | status: decided by the user 2026-10-18; UM-BQ2 reversed and UM-BQ3 moved to "now" by UM-D1 on 2026-10-19)
- [ ] UM-SA13: SA re-review of UM-D1 (slicing, route ownership, row source, ✕ vs `noExclusions` invariant, phone layout UM-D1-M) (raised by: BA | status: open)
- [x] UM-SA1 to UM-SA12 (raised by: BA | status: answered by SA 2026-10-18, § SA Review)
- [x] (Answered by SA 2026-10-18: every token in §4.3 exists on `origin/main`; see § SA Review, R-tokens.) The exact export `v2-tokens.txt` was empty apart from a fragment; the token names in §4.3 were read from the local `app/v2/globals-v2.css`. SA to confirm none changed on `main` (raised by: BA | status: open; suggested resolution: SA checks `git show origin/main:app/v2/globals-v2.css`)

---

## 17. Notes on integration points

| Area | Files | Change |
|---|---|---|
| Plan view | `components/business-os/settings/PlanSection.tsx` | The drawer keeps B1–B9 and gets the button; the Choose / Upgrade islands move to the modal (UM-SA1) |
| Islands reused | `PlanPurchase.tsx`, `PlanUpgrade.tsx`, `billing/PlanEmbeddedCheckout.tsx`, `planPurchaseCopy.ts`, `planUpgradeCopy.ts` | Reused; restyled through props / classes only |
| Read | `planDrawerReads.ts` → `GET /api/business-os/entitlements/my-plan` | **UM-D1: gains a read-only per-plan feature matrix** (UM-4, now required; route, builder and path per SA UM-SA13) |
| Settings page | `app/business-os/settings/page.tsx` | Button wiring and prefetch hand-over (UM-SA8) |
| Dialog primitive | `components/ui/dialog.tsx` | Reused; no change expected (UM-SA3) |
| New | `components/business-os/plan/UpgradeModal.tsx` (+ the open contract, UM-SA5) | New |
| Dictionaries | en / he / es Business OS dictionaries | New `upgrade_modal.*` keys |
| Not touched | `PlanBadgePill.tsx`, `PlanPaymentBanner.tsx`, `UsageCard.tsx`, all billing / entitlements server code, DB | — |

---

## SA Review

> Superseded in part by UM-D1 (2026-10-19) — see § SA Re-review (UM-D1, 2026-10-19) below.

**Reviewed by SA — 2026-10-18** (against `origin/main` after `git fetch`, not the stale local checkout)
**Verdict:** APPROVED WITH CONDITIONS (C-1 to C-14 below). No business question for the user.

### Verification of the "pure UI" claim

| Claim | Finding |
|---|---|
| No new route, request field or migration for UM-1 to UM-3 | ✅ Confirmed. Everything the cards need is in today's `my-plan` body: `plans` (server-ordered by `config.tierOrder`, `shownPlanChoices` in `customerPlanView.ts`), `planId` / `kind`, `included`, `nextPlanUp`, `purchase.offer` / `upgrade` / `endsFreeAccessOnPurchase` / `billing`. UM-4 is the only data change, as the BA says |
| The my-plan read is sufficient | ✅ For the current plan and the plan above. A trial owner's Essentials card and a Founding Partner's cards are name, price and action only until UM-4. That is the accepted UM-BQ3 outcome, not a gap |
| No import from `lib/business-os/entitlements/` | ✅ Achievable. Today's island imports (`planDrawerReads`, `planPurchaseCopy` → `billing/planCheckout` type, `billing/planPurchaseTypes`, `billing/checkoutReturnMarker`, `planCategoryLine`, `checkoutProcessing`) are all outside the module. The mirrored payload types in `PlanSection.tsx` stay the type source (C-6) |
| Tokens in §4.3 (R-tokens) | ✅ All exist on `origin/main` `app/v2/globals-v2.css`, and Business OS loads that file under `V2ThemeProvider` (`app/business-os/layout.tsx`): `--v2-primary` #6366F1, `--v2-primary-dark` #4F46E5, `--v2-secondary` #8B5CF6, `--v2-bg`, `--v2-surface`, `--v2-surface-hover`, `--v2-border`, `--v2-shadow-card`, `--v2-shadow-button`, `--v2-radius-card`, `--v2-radius-button`, `--v2-success`, `--v2-error-*`. Dark: `.dark` overrides bg / surface / border / text; primary / secondary are not overridden (same indigo-violet in both modes); the theme provider sets dark-aware `--v2-error-*` values. Note: the provider also writes `--v2-primary` / `--v2-primary-dark` / `--v2-secondary` from platform custom tokens, so contrast must be judged on the token, not on a hex (C-9) |

### Rulings on §13

| # | Ruling |
|---|---|
| **UM-SA1** | **One flow owner, extracted, not copied.** Move the bounded re-read and the success predicates (`succeeded`, `upgradeSucceeded`, `processing`, `exhausted`, `onCheckoutComplete`, `onUpgrading`, `onUpgradeCheckAgain`) out of `PlanSection` into one client hook (e.g. `usePlanFlow` beside it), verbatim. `PlanSection` consumes it. **From Settings**, the modal is rendered by `PlanSection` and receives that same instance: when an island reports `onComplete` or `onUpgrading`, the modal closes and the drawer shows B5 / B6 exactly as today. **From elsewhere** (UM-2), the provider's modal mounts its own instance of the same hook and shows B5 / B6 in its body. No second copy of any predicate |
| **UM-SA2** | **Nested, never "close the drawer first".** In Settings the modal is a child of `SheetContent` (the discard-prompt precedent), so Radix layers it above the sheet and a click inside it is not "outside" the sheet. Do not portal it from the layout provider while the drawer is open: that is the `ConfigurationDialogProvider` dismissal bug (a click in the upper dialog closes the surface below). Busy lock: reuse the `SettingsDrawer` three-layer refusal shape (`onOpenChange` gate, `preventDefault` on Escape and outside interaction) for Confirm and 3-D Secure only; `PlanUpgrade` gains one optional `onBusyChange` prop to report it. The built-in `DialogContent` X calls `onOpenChange`, so the gate covers it; see C-8 for its look. 3-D Secure (Stripe.js `handleNextAction` mounts its challenge on `body`, outside the Radix layer) is the real risk: go-live row 20 (plan payments §9.5) must be extended to "inside the upgrade modal, stacked on the drawer and standalone" (C-11) |
| **UM-SA3** | **Reuse `components/ui/dialog.tsx`; no change to it.** Use the flex variant (`className` containing `flex`): the caller owns its scroll body and a full-height sheet on a phone, as the scheduling dialog does. Width by a responsive class only (`sm:max-w-4xl`), never a second base `max-w-*` (`cn` does not merge). Contrast, computed on the default tokens: white on `--v2-primary` 4.47:1 and on `--v2-secondary` 4.24:1 both **fail** AA for normal text; white on `--v2-primary-dark` 6.3:1 passes. So small white text (subheading, ribbon, button label) must sit on `--v2-primary-dark`; the gradient to `--v2-secondary` is allowed behind large text (≥ 24 px, or ≥ 18.66 px bold) and as decoration (C-9) |
| **UM-SA4** | **Positional rule accepted, with two guards.** Current = the `plans` entry whose `planId` equals the payload's `planId` when `kind = 'tier'` (id equality against server data, as `PlanPurchase`'s `currentTierId` does today; trial and cohort accounts have no current card, the status strip carries them). Recommended = `nextPlanUp.planId`, else the last entry of `plans`, else none, **and only if that plan is offered** (in `offer.tiers` or `upgrade.tiers`) **and is not the current plan**. So an Autopilot owner and a Founding Partner with no end date see no ribbon. No server field needed |
| **UM-SA5** | **Not a new pattern: follow `ConfigurationDialogProvider`.** A Business OS layout provider (`UpgradeModalProvider`, inside `LanguageProvider` and `CapabilitiesProvider`) exposing `useUpgradeModal().openUpgradeModal(context)`, with the dialog lazy-loaded through `lazyDialogs` (PERF-1) and every read guarded on open. `context` is a discriminated union: `{ kind: 'settings' } \| { kind: 'locked_feature'; planId: string } \| { kind: 'founding_partner' }`, nothing else (no name, price, offer, callback that decides anything). **No URL parameter and no window event**: a URL param is a new deep-link surface competing with `?section=plan`, and an event bus is a new pattern. The Settings instance (UM-SA2) is a second instance of the same component, the precedent `ConfigurationDialogProvider` documents |
| **UM-SA6** | Agreed: new component, not `SettingsDrawer`. **Location:** `components/business-os/settings/` (beside the islands) rather than a new `plan/` folder, so its tests live under `components/business-os/settings/__tests__/`, the only components path the FR-12 `tierLiteral.forbidden` guard allows tier ids in. A new folder would need that allowlist widened, which is an SA decision this requirement does not need |
| **UM-SA7** | Zero imports from `lib/business-os/entitlements/` (value or type) in the modal, the hook, the provider and the test-page demo. Types come from the mirrored ones in `PlanSection.tsx` (export them, or move them to a client-side `planPayloadTypes.ts` in the same folder). If Dev finds one is needed, stop and register it per the `business-os-entitlements` skill |
| **UM-SA8** | Settled by UM-SA1: from Settings the modal takes **no read** of its own; it renders `PlanSection`'s plan state. The C-b warm read and its take-once rules (B-1 to B-3) are untouched. From elsewhere the modal reads once on open via `readMyPlan()` (no prefetch, no read at page load) |
| **UM-SA9** | Keep every island test id unchanged (islands are not rewritten). Files that pin the moved islands through `PlanSection`: `PlanSection.render`, `PlanPaymentState.render`, `PlanSection.prefetch.render`, `PlanDrawer.prefetch.render`, `planPrefetch.guard`, `accountCard.guard`, `settingsDeepLinks.guard` (plus `PlanPurchase.render` / `PlanUpgrade.render`, which should pass unmodified). The BA's `payload.contract.test.tsx` is the **admin** tiers test and is not affected. The workplan lists each moved assertion as old → new; none is deleted without a replacement (C-5) |
| **UM-SA10** | Accepted for v1: return surface stays `settings_plan`. `PlanPurchase` already `router.replace`s to Settings → Plan on `onComplete`; the provider modal closes on that navigation. UM-F3 stays the follow-up |
| **UM-SA11** | Short path confirmed **only for UM-1a and UM-3**. **UM-1b** (moving the money buttons) and **UM-2** (layout provider) take SA code review with the C-b conditions plus QA sandbox buy, upgrade, 3-D Secure and checkout return before the user diff; no fast-track auto-merge. UM-4 full cycle, as written |
| **UM-SA12** | Change `text-red-700` to `text-[var(--v2-error-text)]` in `PlanPurchase.tsx` and `PlanUpgrade.tsx` themselves (one look in drawer and modal; today's red is unreadable on the dark surface). **Leave `PlanEmbeddedCheckout.tsx` alone**: it also renders on `/invite/awaiting-payment`, outside the Business OS theme provider |

### Slicing and estimates

UM-1 at 3 to 3.5 d is light for what it carries (hook extraction, wide modal, mobile sheet, RTL, dark, seven test files to migrate, sandbox QA). Split it, numbered and not stacked:

| Slice | Scope | Est. |
|---|---|---|
| **UM-1a** | **Plan cards modal, view only.** `usePlanFlow` extraction (pure move, existing tests green unchanged), the modal with cards, markers, `nextPlanUp` framing, "Compare plans" button in the drawer. Choose and Upgrade **stay in the drawer**. No money behaviour moves | 2.5 d |
| **UM-1b** | **Buy and upgrade in the modal.** Islands move, "See plans" label, busy lock, hand-off on `onComplete` / `onUpgrading`, test migration (C-5), sandbox QA incl. 3-D Secure | 2 d |
| UM-2 | As written, plus the provider placement in `app/business-os/layout.tsx` (check `ownerLanguageFirstFrame.guard` pins) | 2 d |
| UM-3 | As written | 1.5 d |

Total UM-1a to UM-3 ≈ 8 d (BA: 6.5 to 7).

### Conditions

1. **C-1** Slice as UM-1a / UM-1b / UM-2 / UM-3 (above); UM-1a moves no money button.
2. **C-2** One flow owner: extract `usePlanFlow` verbatim from `PlanSection`; no second copy of any success or processing predicate (UM-SA1).
3. **C-3** In Settings, the modal is a child of `SheetContent`, shares `PlanSection`'s flow instance, takes no read of its own, and closes on `onComplete` / `onUpgrading` (UM-SA2, UM-SA8).
4. **C-4** Open contract = layout provider + `useUpgradeModal()`, `ConfigurationDialogProvider` shape, lazy-loaded; context is the three-member union only; no URL param, no event (UM-SA5).
5. **C-5** Every existing island test id kept; each moved `PlanSection` assertion mapped old → new in the workplan; none deleted without replacement (UM-SA9).
6. **C-6** Zero imports (type-only included) from `lib/business-os/entitlements/` in all new files and the demo (UM-SA7).
7. **C-7** No tier id literal (`basic`, `pro`, …) in product code or the `/test-business-os` demo: the `locked_feature` demo takes its plan id from the payload (e.g. `nextPlanUp.planId`); tier ids only in `components/business-os/settings/__tests__/` (FR-12 guard).
8. **C-8** `dialog.tsx` unchanged; flex variant + `sm:max-w-*`; the built-in X restyled for the gradient via the header's own layout (not a hidden duplicate), and refused by the `onOpenChange` gate while busy.
9. **C-9** AA on the band: small white text only on `--v2-primary-dark`; gradient to `--v2-secondary` only behind large text or decoration; gradient direction mirrors in RTL; checked with the theme provider's computed tokens, light and dark.
10. **C-10** Recommended ribbon only on an offered, non-current plan (UM-SA4; **amended 2026-10-19 per UM-BQ4**: the last offered, non-current entry of `plans`, see §4.0 "Recommended"); "Everything in {plan}, plus:" only when the current plan is a tier card, else today's `plan.next.adds_heading` copy.
11. **C-11** Go-live row 20 (plan payments §9.5) is extended to cover the modal (stacked on the drawer, and standalone, desktop and phone) and is a merge gate for UM-1b; TL updates that row.
12. **C-12** Islands are never mounted in the drawer and the modal at the same time (one Stripe Embedded Checkout per page).
13. **C-13** `text-red-700` → `--v2-error-text` in `PlanPurchase` and `PlanUpgrade` only; `PlanEmbeddedCheckout` untouched (UM-SA12).
14. **C-14** UM-1b and UM-2 take SA code review + QA sandbox before the user diff and are not fast-tracked (UM-SA11).

### Approval

[x] Requirement approved with conditions C-1 to C-14 — proceed to the Dev workplan for UM-1a

### SA Re-review (UM-D1, 2026-10-19)

**Reviewed by SA — 2026-10-19** (against `origin/main` after `git fetch`)
**Verdict:** APPROVED WITH CONDITIONS (C-15 to C-28 below, on top of C-1 to C-14 where not superseded). The ✕ reversal needs **no new business question**: the user's UM-BQ2 reversal is that decision (reasoning under (d)). C-10's second half ("Everything in {plan}, plus:") is superseded by the table.

#### Rulings on UM-SA13

| # | Ruling |
|---|---|
| **(a) Slicing** | BA proposal **accepted**, numbered and unstacked: **UM-0** "Plan comparison in the plan read" (server only, no UI) → **UM-1a** "Comparison table modal, view only" → **UM-1b** → **UM-2** → **UM-3**. UM-1a's PR opens only after UM-0 merges (it renders UM-0's field); UM-1a's pure-refactor tasks (types, `planText`, `usePlanFlow` extraction + checkpoint) touch only client files and may start in parallel. Estimates: UM-0 **1.5–2 d**, UM-1a **3 d** (table, sticky phone layout, reworked tests), UM-1b **2.25 d** (one island behind two triggers per column), UM-2 2 d, UM-3 1.5 d. **Total ≈ 10.25–10.75 d** (was ≈ 8 d) |
| **(b) Ownership and path** | UM-0 is a Dev slice on the **full cycle** (workplan → SA → code review → QA → user diff → RM), not fast-tracked: it changes the body of a money-adjacent customer route. Verified on `origin/main`: `my-plan/route.ts` takes **no input** (guarded by its `route.test.ts`), resolves the session account only, and already holds `locale`. The comparison is **pure config resolution** (`previewAccountFor` + `resolveEntitlements` per shown tier, the same thing `nextPlanUp` and `describePlanOffer` already do): **no new route, no new input, no Stripe call, no DB read, no migration**. If a workplan finds it needs any of these, stop and return to SA |
| **(c) Builder** | Inside the module, in `customerPlanView.ts`: a pure builder called **from `buildCustomerPlanView`**, so the view gains one field (`comparison`) and the route's imports do not change. Sources: `shownPlanChoices` (columns, `tierOrder`, `shownToCustomers`), `previewAccountFor` + `resolveEntitlements` (each plan **as defined**, never the account's own resolution), `describePlanCapabilities` / `capabilityDisplay` (labels and value strings, in the reader's locale), `isHiddenFromCustomer`, `groupByCategory`'s `CATEGORY_PRESENTATION` (order, heading keys), `comparableAmount` (highlight). **Not** a reading of `tierMatrix.ts` (the module's "it resolves; it does not describe" rule) and **not** `describePlanOffer` (one plan, inclusions only). **Registration:** a change inside the module is not a new importer, so `ENFORCEMENT_POINTS` / `KNOWN_NON_GATE_IMPORTERS` stay as they are **provided** the route still imports exactly `buildCustomerPlanView`, `getEntitlementService`, `resolveAccountId`; if Dev exports a new symbol and calls it from the route, that entry's `symbols` must change in the same diff. It triggers: `customerPlanView.noExclusions` (amended, (d)), `customerPlanView.test`, `planCopy.i18n` (any new `plan.*` key, three languages, exclusion phrasing), `tierMatrix.snapshot` / `entitlements.snapshot.json` (**must stay unchanged**: no matrix or catalog edit), `tierLiteral.forbidden`, and `npm run test:bos-entitlements` on the final diff. Client: **C-6 holds** — zero imports from the module, the `comparison` type mirrored in `planPayloadTypes.ts` |
| **(d) ✕ vs `noExclusions`** | **Why the rule exists** (commit `d6250f1f`, 2026-09-27, WS-2 step 1, `BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md` §6.5 and its Change History): a Dev / SA design rule, reviewed by SA and QA and accepted with the user's WS-2 review when chat stopped being hidden. Its business reasons, in plain words: **(1)** "not included" could mean "your plan does not have it" or "nobody can have it, it is not built", and the owner cannot tell which; **(2)** chat is not switched off for anyone yet (shadow mode), so "not included" tells an Essentials owner something that is not true in practice; **(3)** listing what you get describes a plan better than listing what you lack. **Can it change safely? Yes, narrowly.** Reason (1) is removed structurally by C-17 (a row exists only if some shown plan includes it; unbuilt features never appear). Reason (2) is exactly the trade-off the user accepted when reversing UM-BQ2 on 2026-10-19 (recorded in §4.2 and §12). Reason (3) is preserved where it applies: the comparison is a statement about **plans as defined, side by side**, not a list attached to "your plan"; `included` and `nextPlanUp` keep the rule unchanged. So this is an amendment of a test invariant with its reasoning, not a new business decision (C-18) |
| **(e) C-10 / Your plan** | Recommended unchanged (UM-SA4 / C-10 first half: offered, not current). "Your plan" column only when `kind = 'tier'` and a column's `planId` equals the payload's; trial and cohort accounts get none. The column action is **the server's action for that plan first**: an admin-assigned tier offered "Pay for {plan}" (plan payments Q-5) shows that, not "Current plan". "Current plan" appears only when the server offers nothing for the current column, and is a **non-interactive label styled as a button**, not `<button disabled>` (no dead control; keeps UM-FR3 and the button-count tests honest) |
| **(f) Phone** | **M-A accepted.** One semantic table at every width (`th scope="col"` per plan, `th scope="row"` per feature, a caption for the screen reader). Below 640 px the feature label spans the row above its two compact cells; the plan header row (name, price, action) is `sticky` inside the modal's scroll body; the footer action row stays. If a `display` change is used to re-flow table elements, explicit ARIA table roles are set (browsers drop them otherwise). Each cell's accessible text names the plan and the state ("Essentials: Not included"). Must fit 360 px with no horizontal scroll. M-B only as a recorded fallback if QA cannot get 360 px to fit |
| **(g) Flows** | Both flows **replace the table area** (table + footer actions), never render inside a column: a column is ~150 px on a phone and the upgrade outcomes (3-D Secure, Could not confirm) do not fit. Above the flow: "{plan} · {price}" and "Back to plans" where the flow allows it (§4.5: never during Confirm, 3-D Secure, Could not confirm). Header and footer buttons of a column are **two triggers of one island instance** (C-12); the island is mounted only once a trigger is pressed. How the trigger reaches the island (a minimal start prop, requests and payloads unchanged, UM-FR4) is the UM-1b workplan's to propose and SA's to rule |
| **(h) Tests and guards** | Server (UM-0): `customerPlanView.noExclusions.test.ts` amended (C-18); `customerPlanView.test.ts` new cases (C-19); `my-plan/__tests__/route.test.ts` no-input guard unchanged, plus `comparison` present on `ok` and `null` on failure paths; `planCopy.i18n.test.ts` covers any new `plan.*` key; snapshots unchanged. Client (UM-1a): the UM-1a workplan's `upgradeModalView.test`, `UpgradeModal.render`, `UpgradeModal.layers`, `upgradeModal.guard` rewritten for the table; `PlanPurchase.render` §10 mapping re-checked (the "Current plan" label is not a button); `creditFigures.fromConfig.guard` SOURCES additions stand; `tierLiteral.forbidden` unchanged. UM-1b: island test ids per C-5, mapped old → new where a column trigger replaces an island's own start button |

#### Conditions (continued)

15. **C-15** Slices UM-0 → UM-1a → UM-1b → UM-2 → UM-3, unstacked; UM-1a's PR opens only after UM-0 is merged; UM-0 is full cycle and not fast-tracked.
16. **C-16** UM-0 adds exactly one field to the plan read, `comparison`, built inside `customerPlanView.ts` and called from `buildCustomerPlanView`: no new route, input, Stripe call, DB read or migration; `null` on the `no_plan_record` / `unavailable` paths.
> **Amended by user decision UM-D2 (2026-10-19):** the table shows **short, grouped rows (about 12 to 15, as in the mockup)**, not one row per capability. Related capabilities share one row (e.g. "Invoices, card payments, multi-currency"). The grouping, row labels (en/he/es) and order live in **server config**, never typed in the UI; a grouped row is ✓ for a plan only if that plan includes **every** capability in the group; every customer-visible capability included by some shown plan must belong to exactly one group (guard test). Estimate: about +0.5 d on UM-0. User chose this over "every feature listed" and "short + See all".

17. **C-17** ~~Rows: every capability not hidden from customers (`isHiddenFromCustomer`) **and** included by at least one shown plan; one row per capability (about 29 today, not the mockup's 14); each column is the plan **as defined** (`previewAccountFor`), not the account's own resolution; cells carry `included` (boolean) and a server-formatted `value` (or `null`), never a list.~~ **Amended by UM-D2, SA-confirmed in the UM-0 workplan review (2026-10-19).** *Replaced:* "one row per capability (about 29 today)". *Now:* rows are server-config groups (12 to 15, `lib/business-os/entitlements/config/planComparison.ts`); a group is ✓ for a plan only if that plan grants **every** visible member; every visible capability granted by some shown plan is in exactly one group (guard, `planComparison.config.test.ts`). *Unchanged and still binding:* visible only (`isHiddenFromCustomer`); a row exists only if some shown plan includes it; each column is the plan **as defined** (`previewAccountFor`), not the account's own resolution; cells carry `included` (boolean) and a server-formatted `value` (or `null`), never a list.
> **UM-0 status (2026-10-19):** workplan [BUSINESS_OS_UPGRADE_MODAL_UM0_WORKPLAN.md](/docs/workplans/BUSINESS_OS_UPGRADE_MODAL_UM0_WORKPLAN.md) SA-approved with conditions S-1 to S-7; user copy decisions taken (lead replies own row, 15 rows; "Emails"; third heading "What's included", key `plan.comparison.section.included`; he / es drafts approved). Implemented on `feature/bos-upgrade-modal-um0`, uncommitted, awaiting SA code review. PR and merge: not yet.

18. **C-18** `customerPlanView.noExclusions.test.ts` is amended, not deleted: header records UM-D1 (2026-10-19) and the reasoning in (d); `included` / `nextPlanUp` rules unchanged; `comparison` gets its own exact key-set allow-lists at every level; new non-vacuity tests that no row is excluded by every plan and no `not_built` capability appears.
19. **C-19** `customerPlanView.test.ts` covers: columns in `tierOrder` (shown only), the same matrix for trial / Founding Partner / tier accounts, the highlight rule (strictly greater than every other column, same unit by `comparableAmount`, otherwise none), and labels in all three locales.
20. **C-20** Section headings: the user's three (run your business / AI assistant / included each month) are derived server-side from config only — a `section` per entry in `CATEGORY_PRESENTATION` plus quantity rows by catalog **shape**, never by capability id or plan — with a test that every catalog category maps to a section. If shape does not separate cleanly, fall back to the existing `plan.category.*` headings and show the user in the diff.
21. **C-21** The UI decides no ✓ / ✕, no highlight, no row, no label and no order: it renders `comparison` (guarded in `upgradeModal.guard`: no capability id, feature label or tier literal in client files).
22. **C-22** "Your plan" column only for `kind = 'tier'` by id equality; its action is the server's action for that plan if one is offered; otherwise "Current plan" as a non-interactive label, never `<button disabled>`.
23. **C-23** ✕ cells read "Not included" (sr text names the plan); no wording matching the `noExclusions` phrasing rule ("not included in your plan", "you do not have"), in any language.
24. **C-24** Phone per (f): semantic table, sticky plan header row, label row above compact cells, 360 px with no horizontal scroll; M-B only as a recorded fallback after QA.
25. **C-25** Checkout and upgrade replace the table area; header and footer column buttons are two triggers of one island instance (C-12); "Back to plans" only where §4.5 allows.
26. **C-26** C-10's "Everything in {plan}, plus:" and the card-only items (CV-3, CV-4 framing, AC-UM3 / AC-UM11 card wording) are superseded; BA updates those ACs to the table before UM-1a's code review. The drawer's B9 keeps `nextPlanUp` adds / improves / changes unchanged.
27. **C-27** A tripwire test in `components/business-os/settings/__tests__/` fails when more than two plans are shown to customers, naming UM-D1-M (the phone layout assumes two).
28. **C-28** UM-0 hand-over reports `npm run test:bos-entitlements` green on the final diff and confirms the route's `KNOWN_NON_GATE_IMPORTERS` symbols are unchanged (or updated in the same diff).

#### Impact on the approved UM-1a workplan (Dev to revise; SA re-reviews)

- **Unchanged:** Tasks 0–2a (types, `planText`, `usePlanFlow` extraction, checkpoint), W-2, W-5, W-6; the band, X, contrast (Q-4, Q-5) and "Compare plans" button (§5.5).
- **Revise:** §5.2 view model (columns and rows from `comparison`; drop `details`, `nextHeading`, `everything_in_plus`); §5.3 layout (table, sticky header row, phone per C-24; recommended column no longer `order-first`); §6 copy (drop `everything_in_plus`, `plans_label` becomes the table caption; add "Current plan", "Included", "Not included"); §7 (mirrored `comparison` type in `planPayloadTypes.ts`); §9 tests (no current column for trial / Founding Partner, admin-assigned tier per C-22, C-21 / C-27 guards); §10 and W-3 / W-4 re-checked against a non-button "Current plan" label; dependency on UM-0 (C-15); estimate ≈ 3 d. W-1 stands (applies to the column action). Q-8 is moot for UM-1a.

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-18 | Created | BA draft from the current `main` export: as-is state matrix, modal design, entry-point contract, conversion ideas, slices UM-1 to UM-4, UM-BQ1 to UM-BQ4, UM-SA1 to UM-SA12. Status: Draft — awaiting SA review |
| 2026-10-18 | Business questions decided | User accepted all four defaults: UM-BQ1 keep the drawer + "See plans" button; UM-BQ2 no lock icons, "Autopilot adds…"; UM-BQ3 UM-4 yes, after UM-1 to UM-3; UM-BQ4 Autopilot recommended (or the plan that unlocks a blocked action). Sent to SA review |
| 2026-10-18 | SA review: APPROVED WITH CONDITIONS | New § SA Review: pure-UI claim and §4.3 tokens verified on `origin/main`; rulings UM-SA1 to UM-SA12 (one extracted flow owner, modal nested in the sheet, `ConfigurationDialogProvider`-shaped open contract, reuse `dialog.tsx` flex variant, positional recommended rule with guards, AA needs `--v2-primary-dark` behind small white text); UM-1 split into UM-1a (view only) and UM-1b (money buttons), ≈ 8 d total; conditions C-1 to C-14. Status updated |
| 2026-10-19 | User design decision UM-D1: comparison table | User rejected the card mockup and approved `upgrade-modal-mockup-v2.html`: feature (scope) column + one column per plan, price under the name, button under the price and repeated at the bottom, ✓ / ✕ per row, quantity values with the higher highlighted, "Your plan" column with disabled "Current plan", Recommended column per C-10. New §4.0 and §7.0 (table wireframe); §4.1, §4.2, §4.5, §7.1, §7.3 and the §4.2 "No withheld list" paragraph marked superseded. UM-BQ2 reversed (✕ shown; shadow-mode trade-off recorded); UM-BQ3 moved to "now", so UM-4 is required for the first build and UM-1a is no longer pure UI. Phone layout open (UM-D1-M, BA recommends sticky headers). New UM-SA13 incl. the `customerPlanView.noExclusions` conflict. Status: awaiting SA re-review |
| 2026-10-19 | SA re-review of UM-D1: APPROVED WITH CONDITIONS | New § SA Re-review (UM-D1): rulings on UM-SA13 (a)–(h). Slices UM-0 (server-only `comparison` field in the plan read, built in `customerPlanView.ts`, full cycle) → UM-1a → UM-1b → UM-2 → UM-3, ≈ 10.25–10.75 d. No new route, input, Stripe call, DB read or migration. `noExclusions` invariant traced to `d6250f1f` (WS-2 step 1) and amended narrowly, not deleted: the user's UM-BQ2 reversal is the business decision. Phone M-A accepted; flows replace the table area. Conditions C-15 to C-28; UM-1a workplan impact listed. Status updated |
| 2026-10-19 | User decision UM-D2: short, grouped rows | SA's C-17 gave ~29 rows (one per capability) vs the mockup's 14. User chose short grouped rows (~12–15) over every feature or short + "See all". Grouping, labels and order in server config; group ✓ only when the plan includes every member; every included capability in exactly one group (guard). Amends C-17; +~0.5 d on UM-0; SA confirms in the UM-0 workplan review |
| 2026-10-19 | UM-0: C-17 amendment recorded (SA S-1); UM-0 implemented | C-17 marked amended by UM-D2 and SA-confirmed, with the replaced clause and the clauses that stand. UM-0 status note after C-17: workplan SA-approved (S-1 to S-7), user copy decisions (15 rows, "Emails", "What's included", he / es approved), implemented on `feature/bos-upgrade-modal-um0`, uncommitted, awaiting SA code review |
| 2026-10-19 | UM-1a SA code review: UM-SA4 / C-10 amended per UM-BQ4 | Dev's D-3 found that the positional rule ("`nextPlanUp`, else the last plan") recommends Essentials to a trial owner, against the user's UM-BQ4 decision (Autopilot). SA amended UM-SA4 / C-10: Recommended = the **last** server-ordered `plans` entry that is offered (`offer.tiers` when choosing, plus `upgrade.tiers`) and not the current tier; none if nothing qualifies; `nextPlanUp` no longer picks the ribbon. §4.0 "Recommended" row updated. SA findings F-1 to F-3 |
| 2026-10-20 | ACs updated for the table design (F-3, C-26) | AC-UM11 card wording superseded by the 360 px table (phone M-A: sticky plan header, label above compact cells, server column order, no horizontal scroll). AC-UMD1 "disabled Current plan" replaced by a non-interactive "Current plan" label per C-22. §4.0 "Current plan" and "Quantity rows" (highlight by weight, F-2) rows aligned. Status: F-1 / F-2 fixed, he / es wording approved by the user |
| 2026-10-20 | UM-1b workplan approved and implemented | SA approved the UM-1b workplan with conditions W-1 to W-8 (Q-1 to Q-12 ruled: `autoStart` start prop; one `onLockChange` callback; outside press refused while a checkout frame is open; precedence upgrade > pay for > choose; spike re-shaped into an agent jsdom probe plus a user check). User decisions: skip the pre-build drawer 3-D Secure check and batch all live checks into one end-of-stream session (after UM-2 / UM-3, before the PRs merge); he / es labels approved; X unchanged. Built: column buttons from the server offer, flows replacing the table area, busy lock with the hand-off close bypassing it, "See plans" label, islands removed from the drawer (C-12), C-13 colours, a scoped pointer-events restore for Stripe frames while busy (SA Q-7 (iii), from the probe). Uncommitted, awaiting SA code review |
