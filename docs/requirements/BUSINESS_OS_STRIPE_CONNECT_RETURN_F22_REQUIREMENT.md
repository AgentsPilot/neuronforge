# Requirement: Where an Owner Lands After Stripe Connect (F-22)

> **Last Updated**: 2026-10-16

**Created by:** BA
**Date:** 2026-10-16
**Status:** Draft. The user's business decisions D-1 and D-2 were taken on 2026-10-16 (§3). Next step: SA requirement review.
**Branch / worktree:** `feature/stripe-connect-return-f22` (`../neuronforge-f22`), from `main`
**Origin:** finding F-22 in [BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md](/docs/requirements/BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md) §7 and §0.4. SA ruled it Medium and asked for a small slice of its own in the S-5 code review (Q-5), recorded in [S-5 workplan](/docs/workplans/BUSINESS_OS_SETTINGS_DRAWER_S5_WORKPLAN.md).

---

## Overview

An owner connects their Stripe account so clients can pay by card. When the owner goes through Stripe's own pages, Stripe sends them back to us when they finish, or when the link has expired or they abandon it. Today both cases land on the plain account settings page. The owner gets no "connected" confirmation, the Payments section is closed, an expired link offers no way to carry on, and an owner who started during onboarding is taken out of onboarding. This requirement sets where the owner lands in each case, decided by the user on 2026-10-16: they go back to where they started, the Payments section opens by itself, and it shows the true status from Stripe with a "Continue with Stripe" button when setup is not finished. It also tidies the other old `?tab=` links that point at the settings page, which does not read them. Nothing here changes code.

---

## Table of Contents

1. [The problem in business terms](#1-the-problem-in-business-terms)
2. [What exists today](#2-what-exists-today)
3. [User decisions](#3-user-decisions)
4. [Decided behaviour](#4-decided-behaviour)
5. [How "where they started" is remembered](#5-how-where-they-started-is-remembered)
6. [Legacy `?tab=` links](#6-legacy-tab-links)
7. [What must not change](#7-what-must-not-change)
8. [Functional requirements](#8-functional-requirements)
9. [Non-functional requirements](#9-non-functional-requirements)
10. [Acceptance criteria](#10-acceptance-criteria)
11. [Proposed slices](#11-proposed-slices)
12. [Open questions](#12-open-questions)
13. [For SA](#13-for-sa)
14. [Found during this work, not in scope](#14-found-during-this-work-not-in-scope)
15. [Out of scope / future roadmap](#15-out-of-scope--future-roadmap)
16. [Notes on integration points](#16-notes-on-integration-points)
17. [Change History](#change-history)

---

## 1. The problem in business terms

Connecting Stripe is the step that lets a business take card payments. It is the longest step an owner does by hand (Stripe asks for ID and a bank account, about 5 minutes), and the one most likely to be interrupted.

| What the owner experiences today | Why it matters |
|---|---|
| They finish on Stripe and arrive at their **account** page (name, password, plan). No message says Stripe is connected | They cannot tell whether it worked, so they may try again or contact support |
| The Payments section, where the status is shown, is **closed**, and it lives in a different window (Business Setup), not on this page | They have to know where to look to check |
| If Stripe's link **expired** or they left half way, they land on the same page with **no way to carry on** | A half-finished setup stays half finished. Card payments do not work, and nothing tells them |
| If they started from the **onboarding setup screen**, they are taken **out of onboarding** and do not see the remaining "only you can do this" steps | The onboarding screen exists so a business does not leave setup unable to trade. Here we take them away from it |

Who is affected: every owner whose Stripe setup goes through Stripe's own pages instead of the form inside our window (see §2.2). Today that is fewer paths than it looks, but the cost on each one is high because it is a money step.

---

## 2. What exists today

### 2.1 Where Stripe sends the owner back

| Route that builds the Stripe link | Return (finished) | Refresh (expired or left) |
|---|---|---|
| `app/api/payments/stripe-connect/onboarding-link/route.ts` | `/business-os/settings?tab=payments&stripe=connected` | `…?tab=payments&stripe=refresh` |
| `app/api/payments/stripe-connect/update-account/route.ts` | same | same |
| `app/api/payments/stripe-connect/create-account-custom/route.ts` (the **third** route) | same | same |
| `app/api/payments/stripe-connect/create-account/route.ts` and `oauth-link/route.ts` | `/api/payments/stripe-connect/callback?type=onboarding` (or `type=oauth`), which then redirects to `/business-os/orders?setup=complete\|pending\|incomplete\|error` | `callback?type=refresh`, which redirects to the same Orders address. It does **not** make a new Stripe link |

`app/business-os/settings/page.tsx` reads only `?section=` (`business`, `invoice`, `timezone`, `plan`, `password`). Nothing reads `tab` or `stripe`.

`?section=business` and `?section=invoice` already open the Business Setup window (the Configuration window) on that tab, through `openConfiguration` in `components/business-os/ConfigurationDialogProvider.tsx`. That window already has a `payments` tab, so the destination the user chose already exists. It needs a link that opens it.

### 2.2 How owners connect Stripe today

| Where the owner starts | What happens | Does the owner leave for Stripe's site? |
|---|---|---|
| Business Setup → Payments → **Connect Stripe** | Creates a minimal account, then shows Stripe's form **inside the window** (embedded onboarding) | No |
| Business Setup → Payments → **Continue setup** / **Reconnect** | Shows Stripe's form inside the window again | No |
| Business Setup → Payments, the 5-step wizard, and the onboarding screen's **Connect payments** step (`StripeConnectWizard`) | After the wizard, Stripe's form is shown inside the dialog (`useEmbeddedOnboarding` is on by default). It sends the owner to Stripe's site only if that setting is off | Only on the fallback path |
| `StripeConnectStatus` (create-account / OAuth) | Sends the owner to Stripe's site, back through `callback`, to Orders | Yes. Where this card is shown today needs confirming (§13, SA-F22-1) |

So the `?tab=payments&stripe=…` addresses are reached on fewer paths than the number of routes suggests. **This requirement still applies to every path that does send an owner to Stripe's site, now and in future.** Slice F22-0 (§11) confirms the list before building, so no slice is built for a path nobody can reach.

### 2.3 What the platform knows about a Stripe account

The platform stores, per owner, whether the account **can take charges**, **can receive payouts**, and **has submitted its details**, and refreshes these from Stripe (`refresh-status`). The Business Setup window already re-reads from Stripe every time it opens and shows one of: **Connected**, **Setup incomplete** (with Continue setup), **Disconnected** (with Reconnect), or **Connect Stripe**. Whether the platform also knows *what* Stripe still needs (Stripe's "requirements") is for SA to confirm (SA-F22-4).

### 2.4 The onboarding screen

`/onboarding-build` keeps its state in the browser tab's session storage and recovers the plan from the server if that is gone. Its "Connect payments" step opens `StripeConnectWizard` in place and marks the step done when the wizard reports completion. That record also survives a reload.

---

## 3. User decisions

| # | Decision (user, 2026-10-16) |
|---|---|
| **D-1** | **(a) Back where they started.** After Stripe, an owner who started in Business Setup lands in **Business Setup → Payments**. It shows **"Connected ✓"**, or **"Setup not finished — Continue with Stripe"**, and that button starts a fresh Stripe setup link. An owner who started in the **onboarding setup** goes back to the **onboarding payments step**. |
| **D-2** | **Yes.** The Payments section opens by itself on return. |

---

## 4. Decided behaviour

"Status" always means the status read from Stripe when the owner lands, **never** what the return address says (§7).

### 4.1 Behaviour table

| # | Case | Where the owner lands | What they see |
|---|---|---|---|
| B-1 | Finished on Stripe, started in **Business Setup**, Stripe says the account is fully ready | Business Setup window opens by itself on **Payments** | **"Connected ✓"** and a short one-time confirmation: "Stripe is connected. Clients can now pay by card." (OQ-5) |
| B-2 | Finished on Stripe, started in Business Setup, but Stripe says **details are still missing** | Business Setup → Payments | **"Setup not finished"** and **Continue with Stripe**. No "connected" wording |
| B-3 | Finished, details submitted, **Stripe is still reviewing** (cannot take charges yet) | Business Setup → Payments | Recommended: **"Stripe is checking your details"**, a "Check again" action, and Continue with Stripe only if Stripe asks for more (OQ-3). Today's window shows this as "Setup incomplete" |
| B-4 | Finished, **can take charges but payouts are not on yet** (Stripe still verifying the bank) | Business Setup → Payments | **"Connected ✓"** plus one line: "Payouts to your bank start once Stripe finishes checking your details." (OQ-4) |
| B-5 | **Link expired or owner left** Stripe part way (refresh), started in Business Setup | Business Setup → Payments | Current status. If not finished: **"Setup not finished — Continue with Stripe"**. A new Stripe link is made **only when they press the button**, never automatically on landing. If Stripe in fact says it is complete: **"Connected ✓"** |
| B-6 | Finished, started in **onboarding**, Stripe says ready | `/onboarding-build`, the remaining-steps screen | The **Connect payments** step is marked done, with a short "Stripe is connected" confirmation. The other open steps are still listed |
| B-7 | Finished-but-not-ready, or expired/left, started in **onboarding** | `/onboarding-build` | The **Connect payments** step opens by itself, showing **"Setup not finished — Continue with Stripe"** (or "Stripe is checking your details", per OQ-3). The step is **not** marked done |
| B-8 | Started in onboarding, but the owner has **since left onboarding** (went to the dashboard), or the onboarding screen has nothing to show on this device | Business Setup → Payments, as B-1 to B-5 (OQ-8) | Same as the Business Setup rows. Never a blank onboarding screen and never a restart of onboarding |
| B-9 | **Not signed in** when Stripe sends them back (session expired, other browser) | Sign-in first, then the destination from this table | No status of any kind before sign-in. If sign-in cannot carry the destination through (SA-F22-5), the agreed fallback is Business OS home. The status then shows correctly the next time Payments is opened |
| B-10 | **Opened later or twice** (back button, bookmark, history, a second tab) | Same as above | The **current** status. Nothing is created or changed by opening it again: no new Stripe account, no duplicate connection, no repeated confirmation after the first view. Once handled, the return markers leave the address, so a **reload shows the page as normal** (same rule as settings drawer Q-6 (a)) |
| B-11 | Someone types `…stripe=connected` by hand, and the account is **not** connected (or there is no account) | Business Setup → Payments | The true state: **Connect Stripe** or **Setup not finished**. Never "Connected ✓" |
| B-12 | Signed in as a **different account** from the one that started | Business Setup → Payments of the signed-in account | That account's own status. The return address carries no account or user identity |
| B-13 | **Stripe cannot be reached** when they land | Business Setup → Payments | The last status we stored, with "We couldn't check with Stripe just now", plus "Check again". The return address never upgrades it to "Connected" |
| B-14 | The business sells only by invoice, so the Payments tab is normally **hidden** | Business Setup → Payments | The Payments tab is shown because the owner was sent to it (the window already keeps a tab that was asked for) |
| B-15 | The Stripe account was **deleted or disconnected** in the meantime | Business Setup → Payments | The normal **Connect Stripe** or **Reconnect** state, without an error |

### 4.2 The "Continue with Stripe" button

- It restarts setup **for the same Stripe account** and never creates a second account.
- Where the owner started inside our window, the recommended form of "a fresh setup link" is **Stripe's form shown inside the window again**, as today's "Continue setup" button already does. Each opening is a fresh Stripe session, so this meets D-1, and the owner does not leave the platform again (OQ-2). Where the flow is one that goes to Stripe's site, the button makes a new Stripe link at the moment it is pressed. That link carries the same "where they started" as the first one.
- It is shown only when Stripe says setup is not finished (or, per OQ-3, when Stripe asks for more).

---

## 5. How "where they started" is remembered

**Business rule:** the link we hand to Stripe says where the owner started, as one of a **fixed short list** of places: `settings` (Business Setup) or `onboarding`. The return address carries that word, and the landing page uses it to decide between B-1–B-5 and B-6–B-8.

| Rule | Why |
|---|---|
| The starting place is **one of a fixed list**, never a free address or full URL | Stops the return link being used to send an owner to another site (an open redirect) |
| Anything missing or unknown counts as **Business Setup** | Links already handed out before this change, and links typed by hand, still land somewhere useful |
| It carries **no** account id, user id, email, Stripe id or secret | The address shows up in browser history and server logs |
| Business Setup is the default for every route that does not say otherwise | Most starts happen there |

The mechanics are for SA, for example a `from=` value on the return and refresh addresses that the server builds, chosen by the screen that asked for the link. That includes how the existing link routes learn where the request came from. Such a value is new route input, so it is validated (CLAUDE.md rule 2).

---

## 6. Legacy `?tab=` links

| Sender | Link today | Recommendation |
|---|---|---|
| Stripe return and refresh, three routes (§2.1) | `?tab=payments&stripe=connected\|refresh` | **Replace** with the new destination (§5). Also **honour the old form** on the settings page, as Business Setup → Payments (B-1 to B-5), because links handed to Stripe before the release may still come back |
| `components/website/blocks/ProcessFlowSection.tsx` (the "set your hours" link in the owner's own booking preview) | `?tab=availability` | **Map** to Business Setup → **Availability**. Its own code comment already says it is meant to open that window. One link, and it sits on the path to publishing |
| `components/business-os/insight/OperationalStatusCard.tsx` | `?tab=services\|availability\|payments\|integrations` | SA reported this card is **not shown anywhere**. BA could not search the repository in this session (no search tool), so F22-0 confirms it. **If it is unused:** leave it, record it as dead code, and spend nothing on it. **If it is used:** map `services`, `availability` and `payments` to the matching Business Setup tab. **Drop** `integrations`, because Business Setup has no such tab. That link should land on the plain page as it does today, unless SA names the screen that holds integrations (OQ-7) |

**General rule (recommended):** the settings page treats an old `?tab=X` exactly like the new link for the same Business Setup tab, for `services`, `availability`, `intake` and `payments`. Any other `tab` value is ignored, as today. Honoured with no end date, because it costs nothing and old emails and bookmarks live for years (OQ-6). Whether that is one rule or per-value handling is SA's call. Adding new deep-link values is a pattern decision (rule 7).

---

## 7. What must not change

| # | Rule | Why |
|---|---|---|
| MN-1 | **Stripe's status is the only source of truth.** The `stripe=connected` (or any) marker in the address is **never** evidence of anything. "Connected ✓" is shown only when the stored status, refreshed from Stripe, says the account can take charges | Anyone can type an address. A wrong "connected" tells the owner card payments work when they do not |
| MN-2 | **No new Stripe calls on the read path unless needed.** The Business Setup window already re-reads the status from Stripe when it opens, and the landing reuses that. No second re-read, no polling loop, and no new Stripe link made on landing (only when Continue is pressed) | Cost, rate limits, speed, and no surprise side effects from opening a link |
| MN-3 | **Landing changes nothing** except the existing status refresh. No account is created, deleted or reconnected, and no plugin connection is added | Opening a link twice (B-10) must be harmless |
| MN-4 | **No identity in the address** (§5), and the starting place comes from a fixed list | Privacy; no open redirect |
| MN-5 | **The existing deep links keep working**: `?section=business`, `invoice`, `timezone` (the publish gate's "Fix" button), `plan` (and plan checkout's `checkout=`), `password`. `?section=preferences` stays ignored | Settings drawer review §4.1 |
| MN-6 | **Reload does not reopen.** After the landing is handled, the markers leave the address (replace, never push), so a reload shows the normal page and Back is not polluted | Settings drawer review Q-6 (a), C-3 |
| MN-7 | **Money rules unchanged.** The Stripe account's settlement currency is not the business's default currency and does not change it. Nothing here sums or converts money | CLAUDE.md § Currency & Timezone |
| MN-8 | **The embedded flows are not changed.** Connecting from inside the window, which does not leave the platform, keeps working exactly as today | Main path; already works |
| MN-9 | **Test and live mode behave the same.** Preview builds use Stripe test mode and production uses live. The return addresses are built from the platform's own address (`platformOrigin()`), never localhost on a deployed build | Existing rule in the routes |

---

## 8. Functional requirements

1. **FR-1** Every route that hands Stripe a return or refresh address for Connect onboarding points it at a destination that opens **Business Setup → Payments** (from Business Setup) or the **onboarding payments step** (from onboarding), per §5.
2. **FR-2** Landing on the Business Setup destination opens the Business Setup window on the Payments tab without a click (D-2), over the settings page (OQ-1).
3. **FR-3** The Payments tab shows the status read from Stripe on landing, using the states in §4.1 (B-1 to B-5, B-11 to B-15).
4. **FR-4** On a "finished" return where Stripe says the account can take charges, a one-time confirmation is shown (OQ-5). It is not shown again on reload or on a second visit after the markers are cleared.
5. **FR-5** When setup is not finished, **Continue with Stripe** is offered and restarts setup for the same account (§4.2). Nothing restarts setup automatically.
6. **FR-6** Landing on the onboarding destination shows the remaining-steps screen. The Connect payments step is marked done only when Stripe says the account can take charges (B-6). Otherwise the step opens with Continue with Stripe (B-7).
7. **FR-7** If the onboarding screen cannot be shown (B-8), the owner lands on Business Setup → Payments instead.
8. **FR-8** A signed-out owner is asked to sign in and then reaches the destination (B-9), or the agreed fallback if the destination cannot be carried through sign-in.
9. **FR-9** The settings page honours the old `?tab=payments&stripe=…` as Business Setup → Payments, and the other `?tab=` values per §6.
10. **FR-10** `ProcessFlowSection`'s "set your hours" link opens Business Setup → Availability.
11. **FR-11** After the landing is handled, the return markers are removed from the address (MN-6).
12. **FR-12** The callback path (`/api/payments/stripe-connect/callback`, landing on Orders) is either brought into line with FR-1 to FR-3, or recorded as unreachable and left, per F22-0 (SA-F22-1).

---

## 9. Non-functional requirements

- **Performance:** landing adds no request beyond what opening the Business Setup window already makes (MN-2). The window opens as soon as the page has loaded, with the existing "checking status" state while the status is read.
- **Security:** MN-1, MN-3, MN-4. Any new input on the link routes is validated with Zod (rule 2). The existing auth checks (`getUser`, then 401) are unchanged. No internal error detail reaches the client in production.
- **Logging:** Pino through `createLogger` with a correlation id on any route touched (rule 3). The starting place may be logged; no identity or Stripe id is added to the address.
- **Accessibility:** the window that opens by itself takes focus in the normal way. The confirmation and status lines are announced (status role). Hebrew is right to left, as the window already is.
- **Languages:** every new line of text (confirmation, "Stripe is checking your details", the payouts note, "couldn't check with Stripe") in English, Hebrew and Spanish, through the existing translation keys.
- **Mobile:** the window is already full screen on a phone. Nothing new.

---

## 10. Acceptance criteria

- [ ] **AC-1** *Given* an owner started Stripe from Business Setup and Stripe says the account can take charges and payouts, *when* Stripe returns them, *then* the Business Setup window opens on Payments without a click, shows "Connected ✓" and the one-time confirmation.
- [ ] **AC-2** *Given* the same, but Stripe says details are missing, *when* they return, *then* Payments shows "Setup not finished — Continue with Stripe" and no "connected" wording.
- [ ] **AC-3** *Given* the Stripe link expired, *when* Stripe sends the owner to the refresh address, *then* they land on Business Setup → Payments with the current status, and **no** new Stripe link has been made until they press Continue with Stripe.
- [ ] **AC-4** *Given* "Setup not finished" is shown, *when* the owner presses Continue with Stripe, *then* setup restarts for the **same** Stripe account (no second account appears in Stripe or in our records).
- [ ] **AC-5** *Given* an owner started on the onboarding screen and Stripe says the account can take charges, *when* they return, *then* they are on `/onboarding-build`, the Connect payments step is marked done, and the other open steps are still listed.
- [ ] **AC-6** *Given* an owner started on the onboarding screen and did not finish, *when* they return (finished-but-not-ready or refresh), *then* the Connect payments step is open, shows Continue with Stripe, and is **not** marked done.
- [ ] **AC-7** *Given* an owner started in onboarding but has since left it, *when* the return link is opened, *then* they land on Business Setup → Payments, not a blank or restarted onboarding.
- [ ] **AC-8** *Given* an account that is **not** connected, *when* someone opens the return address with `stripe=connected` (or the new equivalent) by hand, *then* "Connected ✓" is **not** shown.
- [ ] **AC-9** *Given* the owner is signed out, *when* the return link is opened, *then* no status is shown before sign-in. After sign-in they reach the destination, or the agreed fallback.
- [ ] **AC-10** *Given* the owner has landed and seen the result, *when* they reload, *then* the page shows normally, with no window reopening by itself and no repeated confirmation, and Back does not reopen it.
- [ ] **AC-11** *Given* the return link is opened twice, *then* nothing is created or changed the second time (no new account, connection or audit side effect beyond the existing status refresh).
- [ ] **AC-12** *Given* Stripe cannot be reached, *when* the owner lands, *then* the last stored status is shown with "We couldn't check with Stripe just now", and the address does not turn it into "Connected".
- [ ] **AC-13** *Given* a business that sells only by invoice (Payments tab normally hidden), *when* it lands from Stripe, *then* the Payments tab is shown and selected.
- [ ] **AC-14** *Given* an old link `/business-os/settings?tab=payments&stripe=connected`, *when* it is opened, *then* it behaves as AC-1 or AC-2 according to Stripe's status.
- [ ] **AC-15** *Given* the owner's booking preview shows "set your hours", *when* they press it, *then* Business Setup opens on Availability.
- [ ] **AC-16** *Given* the existing links `?section=business`, `invoice`, `timezone`, `plan` (with and without `checkout=`) and `password`, *then* each behaves exactly as before (regression).
- [ ] **AC-17** *Given* a return address whose starting place is missing or not in the fixed list, *then* it is treated as Business Setup, and it can never send the owner to another site.
- [ ] **AC-18** *Given* an owner connecting from inside the Business Setup window (embedded form), *then* nothing about that flow has changed (regression).

QA records a manual check of AC-1, AC-3, AC-5 and AC-8 against Stripe **test mode** on a Preview or local build. Each needs a real Stripe-hosted onboarding round trip.

---

## 11. Proposed slices

Small, numbered, a few days each, one at a time from fresh `main`. This is a money setup step, so slices touching the link routes or the status logic take the **full cycle** (Dev workplan → SA workplan review → Dev → SA code review + QA → user sees the diff → RM). Pure link mapping can take the UI short path if SA agrees.

| Slice | Scope | Path | Size |
|---|---|---|---|
| **F22-0** | **Confirm the paths** (inside the F22-1 workplan, read-only): which screens actually send an owner to Stripe's site (the wizard fallback, `StripeConnectStatus`, anything else); whether `OperationalStatusCard` and `StripeConnectStatus` are shown anywhere; what sign-in does with a destination today (B-9); whether the stored status includes what Stripe still needs (OQ-3). Its findings decide FR-12 and §6 | Part of F22-1's workplan | 🟢 ~0.5 d |
| **F22-1** | **Business Setup landing.** A deep link that opens the window on Payments. The three routes' return and refresh addresses point at it, with the starting place (default Business Setup). Old `?tab=payments&stripe=…` honoured. One-time confirmation (B-1). Not finished → Continue with Stripe (B-2, B-5). Markers cleared after landing. Status only from the existing re-read | Full cycle | 🟡 ~2 d |
| **F22-2** | **Onboarding landing.** The onboarding screen's Connect payments step asks for links marked `onboarding`. Return to `/onboarding-build` marks the step done only on Stripe's word (B-6). Not finished → step opens with Continue (B-7). Fallback to Business Setup (B-8) | Full cycle | 🟡 ~1.5–2 d |
| **F22-3** | **Old `?tab=` links.** `ProcessFlowSection` → Availability. The settings page honours `?tab=services\|availability\|intake`. `OperationalStatusCard` per F22-0 (map or leave as dead code) | UI short path (SA confirms) | 🟢 ~0.5–1 d |
| **F22-4** *(only if OQ-3 / OQ-4 are answered "yes")* | **Clearer status wording** in the Payments tab: "Stripe is checking your details" + Check again, and the payouts-pending note. May need Stripe's "requirements" in the stored status (SA-F22-4) | Full cycle if the stored status changes, otherwise UI short path | 🟢–🟡 ~1 d |
| **F22-5** *(if F22-0 finds it reachable)* | **Callback path** (`callback` → Orders) brought into line with F22-1, including making a new link on `refresh` | Full cycle | 🟢 ~1 d |

Recommended order: F22-1 → F22-2 → F22-3, then F22-4 or F22-5 only if needed. Each slice is recorded back into this document (status, SA rulings, PR, merge).

---

## 12. Open questions

Business terms only. Each has a recommendation. Technical choices are for SA (§13).

| # | Question | Options | Recommendation |
|---|---|---|---|
| **OQ-1** | When Business Setup opens by itself after Stripe, what page should be **behind** it? | (a) The settings page, as for every other "fix your setup" link today (b) The dashboard (My Day) | **(a).** Same as the existing setup links. The owner sees the window either way, and closing it leaves them in a sensible place |
| **OQ-2** | "Continue with Stripe" after a return: reopen Stripe's form **inside the window**, or send the owner to **Stripe's site** again? | (a) Inside the window, as today's "Continue setup" does (b) Stripe's site | **(a)** where the owner started inside the window, because it is a fresh Stripe session without leaving the platform again. **(b)** only for a flow that started on Stripe's site |
| **OQ-3** | The owner has sent Stripe everything, and Stripe is **reviewing** (cannot take payments yet). What should Payments say? | (a) "Stripe is checking your details" + Check again. Continue only if Stripe asks for more (b) Keep today's "Setup incomplete — Continue setup" | **(a).** Telling someone to continue a form they have finished sends them in circles. Needs F22-4 |
| **OQ-4** | The account **can take card payments**, but Stripe has not switched on **payouts to the bank** yet. What should Payments say? | (a) "Connected ✓" plus "Payouts to your bank start once Stripe finishes checking your details" (b) Plain "Connected ✓" (c) "Not finished" | **(a).** They can trade, which is what matters, and the note stops a "where is my money" surprise |
| **OQ-5** | Show a one-time **"Stripe is connected"** message on return, or rely on the green status alone? | (a) One-time message, gone on reload (b) Status only | **(a).** It answers "did it work?" right where they land |
| **OQ-6** | How long should the **old `?tab=` links** keep working? | (a) Indefinitely (b) A transition period, then ignored | **(a).** It costs nothing, and old emails and bookmarks live for years |
| **OQ-7** | The unused status card's **"integrations"** link: where should it go? | (a) Drop it: plain settings page, as today (b) Point it at an integrations screen | **(a)**, and only if F22-0 finds the card in use at all |
| **OQ-8** | An owner who started in onboarding, but has **already left onboarding**, opens the return link later. Where should they land? | (a) Business Setup → Payments (b) Back into the onboarding screen | **(a).** Onboarding is over for them, and reopening it would confuse more than help |
| **OQ-9** | An owner returns **signed out**. If sign-in today cannot bring them back to the right place, is landing on Business OS home acceptable for now? | (a) Yes, Payments shows the true status when next opened (b) No, carrying the destination through sign-in is part of this work | **(a)** for this requirement. Carrying a destination through sign-in affects every link, not just Stripe, so it is its own piece of work if wanted |

---

## 13. For SA

| # | Item |
|---|---|
| SA-F22-1 | Confirm which UI paths reach Stripe's **hosted** onboarding (wizard fallback with `useEmbeddedOnboarding=false`, `StripeConnectStatus`, others), and whether `StripeConnectStatus` and `OperationalStatusCard` are rendered anywhere. Decide FR-12 (callback → Orders) from that |
| SA-F22-2 | The deep-link shape for "Business Setup → tab": a new `?section=payments` (and `availability`, `services`, `intake`) beside the existing `business` / `invoice` handling, plus treating legacy `?tab=` the same. New deep-link values are a pattern decision (rule 7). Removing the markers after handling (`section`, `tab`, `stripe`, the starting place) with replace (C-3). Today `settingsUrlWithoutSection` removes only `section` |
| SA-F22-3 | How the link routes learn the starting place (a validated, allow-listed value from the caller). Whether the three routes' duplicated address-building becomes one helper |
| SA-F22-4 | Whether the stored or refreshed status can tell "Stripe needs more from you" apart from "Stripe is reviewing" (OQ-3, F22-4) without an extra Stripe call on landing |
| SA-F22-5 | What happens today when a signed-out owner opens a Business OS address or `/onboarding-build` (both send to the marketing login). Can the destination survive sign-in (OQ-9)? |
| SA-F22-6 | Onboarding return: how `/onboarding-build` opens the Connect payments step from the address and reads the status, given its state lives in the tab's session storage (survives a same-tab round trip to Stripe, lost in a new tab). `StripeConnectWizard` starts at "choice" when no existing account is passed |
| SA-F22-7 | Confirm MN-2: the window's existing on-open re-read (`refresh-status`) is the only Stripe call on landing |

---

## 14. Found during this work, not in scope

Recorded so they are not lost. None is fixed by F-22 unless the user asks.

| # | Finding | Where | Severity (BA view, SA to confirm) |
|---|---|---|---|
| FX-1 | Security finding, details withheld from this public repository. Reported privately to the owner of the Stripe Connect area on 2026-10-16 | Stripe Connect route | Medium |
| FX-2 | The callback path's `refresh` does not make a new Stripe link. It redirects to Orders, where only `StripeConnectStatus` reads `setup=` | `callback/route.ts` | Low–Medium (covered by F22-5 if reachable) |
| FX-3 | `create-minimal` writes the account currency as `USD`, or else `EUR`, the same one-line guess that `create-account-custom` was corrected away from (an Israeli business filed as euros). It also defaults the country to `US` from the window | `create-minimal/route.ts`; `ConfigurationDialog.tsx` `handleConnectStripe` | Medium (money label) |
| FX-4 | `create-minimal` deletes from `stripe_connect_accounts` with the service-role client directly in the route (CLAUDE.md rule 1) | `create-minimal/route.ts` | Low |
| FX-5 | `StripeConnectOnboarding` polls `refresh-status` and checks `result.account?.onboarding_completed`, but the route returns `data`, so it can never report completion. It is likely unused | `components/payments/StripeConnectOnboarding.tsx` | Low |
| FX-6 | `ProcessFlowSection`'s comment says the link "opens the same Configuration dialog". It does not (fixed by F22-3) | `ProcessFlowSection.tsx` | Low |

---

## 15. Out of scope / future roadmap

- Changing how Stripe onboarding itself works (embedded versus hosted, the wizard steps, supported countries).
- Stripe's later "more information needed" requests on an account that was already connected (Stripe emails the owner). A future "Stripe needs something from you" notice belongs to readiness or insights.
- Carrying any destination through sign-in for all links (OQ-9 (b)).
- The plan-payments (platform subscription) checkout return, which already uses `?section=plan&checkout=…`.
- The FX findings in §14.

---

## 16. Notes on integration points

| Area | Files |
|---|---|
| Link routes | `app/api/payments/stripe-connect/onboarding-link/route.ts`, `update-account/route.ts`, `create-account-custom/route.ts`; also `create-account/route.ts`, `oauth-link/route.ts`, `callback/route.ts` |
| Status | `app/api/payments/stripe-connect/route.ts` (`GET`), `refresh-status/route.ts`, `lib/stripe/StripeService.ts` (`getConnectAccountStatus`), `stripe_connect_accounts` through `lib/repositories/PaymentRepository.ts` |
| Business Setup window | `components/business-os/ConfigurationDialogProvider.tsx` (`openConfiguration`, `ConfigTab` includes `payments`), `components/business-os/ConfigurationDialog.tsx` (`checkStripeConnection`, Payments tab states, tab visibility by business shape) |
| Settings deep links | `app/business-os/settings/page.tsx` (deep-link effect), `components/business-os/settings/useLinkOpenedDrawer.ts`, `settingsSectionUrl.ts`, `lib/business-os/journeyGapFix.ts` (`gapFixAction`, must not change) |
| Onboarding | `app/onboarding-build/page.tsx` (`openStep`, `settleOwnerStep`, session storage keys), `components/payments/StripeConnectWizard.tsx`, `StripeEmbeddedOnboarding.tsx` |
| Legacy links | `components/website/blocks/ProcessFlowSection.tsx` (`?tab=availability`), `components/business-os/insight/OperationalStatusCard.tsx` |
| Possibly unused | `components/payments/StripeConnectStatus.tsx`, `StripeConnectOnboarding.tsx` |
| Tables | `stripe_connect_accounts` (read; refreshed by the existing route), `plugin_connections` (read only by the window's status check). No schema change expected |
| Related docs | [BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md](/docs/requirements/BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md) §0.4, §4.1, §7 F-22, Q-6; [S-5 workplan](/docs/workplans/BUSINESS_OS_SETTINGS_DRAWER_S5_WORKPLAN.md) (SA ruling Q-5); [BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md) (platform subscriptions; separate from Connect) |

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-16 | Created (BA) | Requirement for F-22 from the settings drawer review. Records user decisions D-1 (a) and D-2 (yes). Behaviour table B-1 to B-15, starting-place rule, legacy `?tab=` mapping, must-not-change rules MN-1 to MN-9, AC-1 to AC-18, slices F22-0 to F22-5, OQ-1 to OQ-9, SA items SA-F22-1 to SA-F22-7, findings FX-1 to FX-6. Status Draft, next SA review |
