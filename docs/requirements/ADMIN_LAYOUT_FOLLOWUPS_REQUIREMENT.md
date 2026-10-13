# Requirement: Admin Layout Follow-ups

> **Last Updated**: 2026-10-13

**Created by:** BA
**Date:** 2026-10-13
**Status:** Approved (SA with conditions applied; user answers 2026-10-13) — ready for LF-1
**Parent:** [ADMIN_LAYOUT_STANDARD_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md) (the standard; section numbers such as §5.8 below refer to it)

## Overview

The Admin Layout Standard migration is finished for every visible admin page except Model pricing. The user asked for three follow-ups: (1) the Businesses detail drawer is "very messy, hard to track what you see"; (2) two boxes on Plans & entitlements are redundant and "could be viewed in another page"; (3) "open" behaviour differs between pages (drawer on some, an inline section on others). The 2026-10-13 browser checks also found text below WCAG AA contrast on three pilot pages. This document proposes one design per item, cut into small numbered slices, and changes no data, money logic, permission or API. All paths are relative to the repository root; line citations come from a read of the code in worktree `neuronforge-admin-layout` on 2026-10-13.

### Progress

| Slice | Scope | Status | PR |
|---|---|---|---|
| LF-0 | This requirement | Approved 2026-10-13: SA conditions SA-C1 to SA-C14 applied (§13); user answered Q-1 to Q-4 (§9, all (a)) | — |
| LF-1 | Contrast fix: `text-slate-500` information text on Health, Scheduled jobs & queues, Audit trail (UI short path) | MERGED (#338) | [#338](https://github.com/AgentsPilot/neuronforge/pull/338) |
| LF-2 | Plans & entitlements: remove "Look up an account", shrink "Changing any of this" to one line (UI short path plus `npm run test:bos-entitlements`) | MERGED (#339). Workplan: [ADMIN_LAYOUT_LF2_WORKPLAN.md](/docs/workplans/ADMIN_LAYOUT_LF2_WORKPLAN.md) | [#339](https://github.com/AgentsPilot/neuronforge/pull/339) |
| LF-4a.1 | Businesses drawer: the §1.3 characterisation (pin) suite only, on the unchanged code (test-only) | MERGED (#340). Workplan: [ADMIN_LAYOUT_LF4A1_WORKPLAN.md](/docs/workplans/ADMIN_LAYOUT_LF4A1_WORKPLAN.md) | [#340](https://github.com/AgentsPilot/neuronforge/pull/340) |
| LF-4a.2 | Businesses drawer: layout outside the money blocks (strip, order, AI usage, Account & security, folds outside money, BD-11 in non-money files) (full cycle) | MERGED (#343). Workplan: [ADMIN_LAYOUT_LF4A2_WORKPLAN.md](/docs/workplans/ADMIN_LAYOUT_LF4A2_WORKPLAN.md) | [#343](https://github.com/AgentsPilot/neuronforge/pull/343) |
| LF-4b | Businesses drawer: inside the money blocks (action bars, lot and top-up folds, their slate-500 lines, F-108 focus return, re-read after Give or Take back) (full cycle) | PR #349 open — fast-track (SA + QA passed). Two commits: the money step `02510dab` (SA approved with fixes F1/F2, applied; QA pass with notes) and Step 12, the shared pin harness in `tests/admin/` `2a8db5fe` (SA approved, no fixes); `origin/main` (#346) merged in (`ccaab0bc`, clean). Known limitation LF4B-F1 (Medium) open, its own slice. Workplan: [ADMIN_LAYOUT_LF4B_WORKPLAN.md](/docs/workplans/ADMIN_LAYOUT_LF4B_WORKPLAN.md) | — |
| LF-4c | Reconcile moved from the drawer to Scheduled jobs & queues as "Reconcile top-ups now (all accounts)" (full cycle) | Not started | — |
| LF-3a | Open-behaviour rule, part a: Signup Invites ("New invite" in a drawer form, Revoke in a dialog) (full cycle) | Not started | — |
| LF-3b | Open-behaviour rule, part b: Messages (browser `confirm()` replaced by admin dialogs) (UI short path) | MERGED (#348) — fast-track (SA + QA passed). Workplan: [ADMIN_LAYOUT_LF3B_WORKPLAN.md](/docs/workplans/ADMIN_LAYOUT_LF3B_WORKPLAN.md) | — |
| LF-F1 | Fix: "Remove this account" closed mid-delete (Escape) never re-reads the list (LF-4a.1 finding F-1; SA ruling: own small fix slice, one file, no UX change) | MERGED (#347) — fast-track (SA + QA passed). Workplan: [ADMIN_LAYOUT_LF_F1_WORKPLAN.md](/docs/workplans/ADMIN_LAYOUT_LF_F1_WORKPLAN.md) | [#347](https://github.com/AgentsPilot/neuronforge/pull/347) |
| LF-5 | Admin users page wording (user request 2026-10-13; copy approved by the user) | Built, awaiting SA + QA. Workplan: [ADMIN_LAYOUT_LF5_WORKPLAN.md](/docs/workplans/ADMIN_LAYOUT_LF5_WORKPLAN.md) | — |

Rows are in the recommended run order (§8). LF-3 is numbered by topic, but runs after LF-4.

---

## Table of Contents

1. [Item 1: Businesses detail drawer](#1-item-1-businesses-detail-drawer)
2. [Item 2: Plans & entitlements boxes](#2-item-2-plans--entitlements-boxes)
3. [Item 3: One rule for "open"](#3-item-3-one-rule-for-open)
4. [Item 4: Contrast follow-up](#4-item-4-contrast-follow-up)
5. [Browser checks recorded 2026-10-13](#5-browser-checks-recorded-2026-10-13)
6. [Non-functional requirements](#6-non-functional-requirements)
7. [Acceptance criteria](#7-acceptance-criteria)
8. [Slices](#8-slices)
9. [Questions for the user](#9-questions-for-the-user)
10. [Open questions for SA](#10-open-questions-for-sa)
11. [Out of scope / future roadmap](#11-out-of-scope--future-roadmap)
12. [Notes on integration points](#12-notes-on-integration-points)
13. [SA Review](#13-sa-review)
14. [Findings](#14-findings)
15. [Change History](#change-history)

---

## User stories

- As an admin, I want one business's drawer to open on a short summary, then group its facts in a fixed order, so that I can find credits, plan, AI usage and account facts without scrolling through everything.
- As an admin, I want every money action in one visibly separate place, so that I never confuse a fact with a button that moves credits.
- As an admin, I want one place to see one account's plan, so that I am not offered two tools that show the same thing.
- As an admin, I want "open", "create" and "confirm" to behave the same on every page, so that I know where a form or a confirmation will appear.
- As an admin, I want every informational line readable on the dark background.

---

## 1. Item 1: Businesses detail drawer

### 1.1 Today

The drawer body is `app/admin/users/components/BusinessDetail.tsx`, inside the page's one `AdminDrawer` (`app/admin/users/page.tsx:638-659`). Its order, as built in L-4b:

| # | Block | Source | Reads |
|---|---|---|---|
| 1 | Business OS panel (`BusinessOsPanel.tsx:152-316`): header (business name, login name), Vertical, Credits (`CreditsBlock`), Credit top-ups (`BoostBlock`), Plan & entitlements (folded), Business OS AI spend 30 days with per-area chips, Recent Business OS AI failures | `BusinessOsPanel.tsx`, `CreditsBlock.tsx`, `BoostBlock.tsx` | entitlements GET and account summary GET (`BusinessOsPanel.tsx:118-120`); credits position GET (`CreditsBlock.tsx:253`); boost view GET (`BoostBlock.tsx:435-441`) |
| 2 | User information | `BusinessDetail.tsx:90-100` | the list row |
| 3 | Account timeline | `BusinessDetail.tsx:102-116` | the list row |
| 4 | Security | `BusinessDetail.tsx:118-135` | the list row |
| 5 | Login activity | `BusinessDetail.tsx:137-154` | `useBusinessDetails` login stats |
| 6 | Connected plugins | `BusinessDetail.tsx:160-198` | `useBusinessDetails` detailed stats |
| 7 | AI spend, all products (30 days) with Cost by Model | `BusinessDetail.tsx:200-251` | `useBusinessDetails` detailed stats (`token_usage`) |
| 8 | Audit trail (folded) | `BusinessAuditSection.tsx:77-181` | `useBusinessDetails` audit logs |
| 9 | Danger area / Remove this account | `BusinessDetail.tsx:255-305` | `TestAccountCleanupPanel` (shared Business OS component) |

**What makes it hard to follow:**

| # | Problem | Where |
|---|---|---|
| P-1 | No summary: the first screen is the Credits block's long list, so plan, spend and status need scrolling | `BusinessOsPanel.tsx:190-200` |
| P-2 | Facts and money buttons are interleaved: Give credits sits under the lot list, Take back on each lot, Take back credits on each top-up, Set limit under the limit, reconcile at the block's end | `CreditsBlock.tsx:386-399`, `:191-200`; `BoostBlock.tsx:329`, `:362-383`, `:545-561` |
| P-3 | **"Run billing reconcile now (all accounts)" is a global action in a per-account drawer.** It POSTs an empty body to `/api/admin/business-os/credits/boost/reconcile` and runs over every business | `BoostBlock.tsx:550-560`; `BoostReconcileDialog.tsx:22`, `:52-57` |
| P-4 | Two AI-spend blocks with no stated relation (F-24): "Business OS AI spend (last 30 days, USD estimated)" from the Business OS ledger, and "AI spend, all products (30 days; may be incomplete above 1,000 calls)" from `token_usage` | `BusinessOsPanel.tsx:241-279`; `BusinessDetail.tsx:201-251` |
| P-5 | Long lists are always open: credit lots, top-ups, recent failures, cost by model | `CreditsBlock.tsx:370-379`; `BoostBlock.tsx:523-527`; `BusinessOsPanel.tsx:289-301`; `BusinessDetail.tsx:229-245` |
| P-6 | Account facts are spread over four small sections (User information, Account timeline, Security, Login activity) | `BusinessDetail.tsx:90-154` |
| P-7 | Visual noise: an emerald gradient panel and emerald buttons as decoration (T-6), purple provider pills, orange plugin chips, cyan costs | `BusinessOsPanel.tsx:155`; `CreditsBlock.tsx:395`; `BusinessDetail.tsx:125`, `:176`, `:221` |
| P-8 | Smaller defects in the same files: failure times in browser-local time (`BusinessOsPanel.tsx:292`, against §5.11); the panel reads bodies with `response.json()` directly (`BusinessOsPanel.tsx:55`, against §5.10); `text-slate-500` lines (`CreditsBlock.tsx:380` "Dates are shown in UTC", the one element the browser check found; `BoostBlock.tsx:259`, `:277`, `:325`, `:529` when shown) | as cited |

### 1.2 Recommended design: summary strip plus fixed sections in one scroll

One scroll, with a read-only summary strip at the top, then six sections in a fixed order. Money actions sit in one action bar per money section, separated from the facts. Long lists show their newest three entries and fold the rest. The global reconcile leaves the drawer.

```text
+------------------------------------------------------------------+
| Eyal Fitness  3fa2c1d0                                       [X] |  title + short id (unchanged)
| Fitness / Personal training          Dana Levi                    |  vertical, login name
|------------------------------------------------------------------|
| Plan         | Credits left    | Business OS AI | Last sign-in    |  summary strip: read-only,
| Pro (tier)   | as the list row | $4.21, 30 days | 2 days ago      |  no links, no buttons
|------------------------------------------------------------------|
| 1 Credits & billing                                               |
|   [Give credits]  [Set limit]  [Back to default]   <- action bar  |
|   Allowance, used this period, plan left, over the plan,          |
|   extra credits (separate figures, never summed)                  |
|   Bought and given credits: newest 3 ... Show 4 more              |
|      each row: its own [Take back]                                |
|   Credit top-ups: Stripe test-key note; newest 3 ... Show more    |
|      each row: Payment link, session id, its own [Take back credits] |
|   Spending limit: current value; Limit changes (latest 20) folded |
|   "Reconcile top-ups for all accounts: Scheduled jobs & queues"   |
| 2 Plan & entitlements: Pro, cohort ...   [Show all capabilities]  |
| 3 AI usage                                                        |
|   Business OS, last 30 days (USD estimated): total, calls,        |
|   tokens, per-area chips, link to AI cost & usage                 |
|   Recent failures (30 days): newest 3 ... Show more; audit link   |
|   All products, token records (30 days): folded, labelled         |
| 4 Account & security                                              |
|   Account: name, company, phone, user id, created, updated        |
|   Sign-in: email verified, providers, last sign in, logins,       |
|   failed logins, unique IPs, last IP                              |
|   Connected plugins: 2 of 3 active, chips                         |
| 5 Activity: Audit trail   [Show audit events]                     |
| 6 Danger area: Remove this account (unchanged, always last)       |
+------------------------------------------------------------------+
```

**Rules for the layout:**

| # | Rule |
|---|---|
| BD-1 | **Uses only data the drawer already loads.** Summary strip: Plan from the entitlements read (tier, cohort); Credits left rendered exactly as the list's `CreditsLeftCell` from the list row (`page.tsx:560-562`), so the drawer and the list cannot disagree and the Credits block is not read twice; Business OS AI spend from the account summary read (`aiSpend30d.total`, with its "lower bound" sub-line when incomplete); Last sign-in from the row (`formatUtc` plus age, as the list). No new request, no request sent twice. |
| BD-2 | **The strip never sums money and never sums credits.** Plan left and extra credits stay separate figures (credit deduction S11-CR-3); USD stays USD and is labelled "estimated" as today. |
| BD-3 | The strip is read-only: no link, no button. It is a plain `dl` built from the existing `DrawerFields` / `DrawerField` (D-5), not `KpiTile` (SA SQ-3, SA-C7: `KpiTile` takes a string value and the Credits left slot is a React element). The Credits left slot is the list's `CreditsLeftCell` with the row's `business` and `creditsLeft` props (SQ-9). That component hard-codes `data-testid="row-credits-left"`, so with the drawer open the id appears twice: tests scope with `within`, or the component gains a local test-id prop (not a shared change). A part that could not be read says so ("Could not read"), never zero. No shared export changes. |
| BD-4 | Section order is fixed: Credits & billing, Plan & entitlements, AI usage, Account & security, Activity, Danger area. Money first because it is what admins act on; danger always last (unchanged rule). Each section is one `DrawerSection` with an `h3`, no landmark region (A-9). |
| BD-5 | **Money actions are grouped and separated from facts.** Each money section opens with an action bar (Give credits; Set limit, Back to default), visually separated from the read-only facts below it (a bordered action row, not inline buttons between figures). Actions that act on one row (Take back on a lot, Take back credits on a top-up) stay on that row: they name what they act on (§5.8 D-8). |
| BD-6 | **The global reconcile leaves the drawer** (Q-1 in §9, answered (a)). Home: Scheduled jobs & queues, as a button labelled **"Reconcile top-ups now (all accounts)"** in the "Billing reconcile" job's row (`bos-billing-reconcile` in `lib/cron/bosCronJobs.ts:46`). It is not a "Run now" for the job (SA SQ-1, SA-C2): the admin route runs the top-ups pass only (the cron will gain the plan pass in P-8b) and never writes a `bos_cron_runs` row, so a press does not change the job's "last run". The dialog's one-run-at-a-time rule and its request (POST, `Content-Type: application/json`, body the literal `'{}'`, `cache: 'no-store'`) are unchanged. **Dialog copy changes deliberately (pinned):** the description no longer says "every business, not only this one" (that only made sense in a business's drawer); it is reworded for the Jobs page and adds that the press is not recorded as a run of the nightly job. **File split (SA SQ-2, SA-C3):** the dialog moves to `app/admin/components/jobs/` as a new file, opened by `DialogTrigger` like Drain now; the reconcile words, `reconcileOutcome` and `reconcileSentences` move out of `users/boostCopy.ts` into a second new file in `app/admin/components/jobs/` with no imports at all (`boostCopy` imports `@/lib/business-os/currency` at run time, which the Jobs guard refuses, and is shared by `BoostBlock` and `BoostCapDialog`, so it stays); `boostCopy` loses its reconcile keys; the Businesses folder keeps no reconcile code beyond the pointer line. **Jobs guard amendment (named in the PR):** the dialog joins `CLIENT_FILES`; exactly one `fetch(`, one POST, to the literal reconcile URL, with the literal body `'{}'`; `VIEW_HEADER_SENTENCE` ("everything else here is read-only") is updated to name the new action; the jobs button count and render pins are edited deliberately. Businesses tests: the reconcile cases in `boostBlock.actions.render` move to a Jobs render test with the **same** assertions; `users/__tests__/source.guard` drops the file from its dialog list. The drawer keeps a one-line pointer to that page. Slice LF-4c. |
| BD-7 | **The two AI-spend blocks are distinguished, not merged** (F-24; Q-4 in §9). They come from different records (the Business OS ledger against `token_usage`) and can differ, so one combined number would be wrong. Both sit in "AI usage": Business OS first and open; "All products, token records" second and folded, with one sentence saying the two come from different records and may not match. |
| BD-8 | **Long lists fold.** Credit lots, top-ups, recent failures and cost by model show the newest 3 entries, then "Show N more". The audit events and Limit changes stay folded as today; Plan & entitlements stays folded with its summary line. Folds hide, never unmount, anything that owns a read (`BusinessAuditSection` precedent, L-4b SA M-2). |
| BD-9 | A hidden lot can still be taken back from its top-up: "Take back credits" on a top-up opens the Credits block's Take back dialog on that lot whether or not the lot list is unfolded (boost slice 6b wiring, `BusinessOsPanel.tsx:98-113`, unchanged). |
| BD-10 | Account facts become one "Account & security" section with three field groups (account, sign-in, plugins). Same fields, same words, colons dropped as in L-4b. |
| BD-11 | Display fixes in the touched files: failure times through `formatUtc`; decorative greens, purples, oranges and cyans to the standard slate and status-chip tones (T-6, T-7); information text slate-400 (T-5). Bodies read through `readJsonBody` (§5.10) in `BusinessOsPanel` only, for its two GETs (SA SQ-7, SA-C12): request byte-identical (same URL, same `cache: 'no-store'`), the `SUMMARY_ERROR_COPY` and `ENTITLEMENT_ERROR_COPY` contract tests unedited, and the panel added to `layoutFolder.guard`'s Businesses list. `CreditsBlock`, `BoostBlock`, `CreditFormDialog`, `BoostCapDialog` and the reconcile dialog are money files and are not converted (L-4b SA Q-5 precedent). |
| BD-12 | Loading: the strip shows placeholders while its reads run; each section keeps its own loading and error line as today (a failed read affects only its own section, L-4b SA Q-4). |
| BD-13 | **Non-Business OS account** (SA-C6; the list holds agent-platform-only logins): the strip shows "Not a Business OS account" in its Plan, Credits and AI slots, never zero; Credits & billing and Plan & entitlements collapse to today's one-line note; AI usage shows only "All products". `CreditsBlock` and `BoostBlock` keep today's gate: mounted only after the panel's two reads settle and only for a Business OS account, so no credits or top-up read is ever sent for a non-Business OS account. Lifting the panel's two reads to feed the strip keeps each read once per open; the BD-9 state (take-back request, loaded lots) moves with the two blocks as one unit. **Satisfied without lifting the reads** (SA ruling LF-4a.2 SQ-B): the panel stays their owner and renders the strip and the first three sections, so each read keeps its mount point and the BD-9 state does not move. |
| BD-14 | **Re-read after a money action** (SA-C7): after a successful Give or Take back, the drawer calls the existing `refreshList` once, so the strip, the list row and the Credits block agree (otherwise the strip's list figure is stale beside a Credits block that re-read). This is a post-action read, not a per-open read (AC-4.3 unaffected), and a deliberate edit of the "re-read" pin, named in the PR. Slice LF-4b. |
| BD-15 | **Focus return, F-108** (SA SQ-6, SA-C8): an opener ref per block plus an optional `onCloseAutoFocus` on the local dialogs; no shared export. The top-up's Take back credits opens the Credits block's dialog, so its opener ref travels with the take-back request and focus returns to that top-up's button. If the opener is no longer in the document (lot emptied, row gone), focus goes to the section's heading, never `<body>`. Slice LF-4b. |

### 1.3 Hard constraints: money and danger actions

Every action below keeps its exact behaviour, request (URL, method, headers, `cache` option, body), confirmation step and words, except the deliberate reconcile copy change in BD-6. **LF-4a.1 is a test-only PR: a characterisation suite that renders the whole drawer (not the block alone) and pins each one, green on the unchanged code, merged before any drawer code moves (SA reviews the pin list before merge).** LF-4a.2, LF-4b and LF-4c may edit those tests only where the opener's position changes, plus the named, deliberate edits (BD-6 copy and move, BD-14 re-read), never the request or the confirmation.

| Action | Opener today | Confirmation today | Request |
|---|---|---|---|
| Give credits | `CreditsBlock.tsx:391-398` | `CreditFormDialog` (give mode), confirm step names the business | as sent today (captured by the suite) |
| Take back (a lot) | `CreditsBlock.tsx:191-200` | `CreditFormDialog` (take_back mode) | as sent today |
| Take back credits (a top-up) | `BoostBlock.tsx:264-274` | opens the Credits block's Take back dialog on that lot (6b, SA C-5) | as Take back |
| Set limit / Back to default | `BoostBlock.tsx:364-381` | `BoostCapDialog` (set / end) | the entitlements admin route, `set_boost_cap` / `end_boost_cap` |
| Run billing reconcile (all accounts); after LF-4c "Reconcile top-ups now (all accounts)" on Scheduled jobs & queues | `BoostBlock.tsx:550-560` | `BoostReconcileDialog`: confirm step, Run disabled while in flight, cannot close while running | POST `/api/admin/business-os/credits/boost/reconcile`, header `Content-Type: application/json`, body the literal `'{}'`, `cache: 'no-store'` |
| Remove this account | `BusinessDetail.tsx:292-301` | `TestAccountCleanupPanel`, locked to the row's email | as sent today; `onRemoved` re-reads the list |
| Delete… (hidden) | `BusinessDetail.tsx:267-290` | `DeleteBusinessDialog` | stays hidden: `SHOW_AD1_DELETE_ENTRY = false` (`:39`) |

Also unchanged: own-account refusals (the buttons hidden on the admin's own account), success notices and re-reads, the danger area last and only inside the open drawer, the `source.guard` position checks for the danger area (moved with intent kept, as in L-4b).

**Pin list for LF-4a.1 (SA-C5).** Beyond opener, words, confirm step, URL, method, body, single send, notice and re-read, the suite pins, through the whole drawer:

| # | Pin |
|---|---|
| PIN-a | The request id: one per dialog opening, the same id on a retry after a failure, a new id on the next opening (OP-32) |
| PIN-b | Take back bodies: a number and `'rest'`; `confirmPaidCredits` sent only when the lot needs it, and submit blocked until the paid confirmation is ticked |
| PIN-c | Give bodies: `expiresAt` null and dated |
| PIN-d | The exact `set_boost_cap` and `end_boost_cap` bodies |
| PIN-e | Headers and the `cache` option on every POST |
| PIN-f | A double click sends once; the Credit, Cap and Reconcile dialogs refuse to close while in flight |
| PIN-g | One failure path per action: the dialog stays open with the mapped sentence (including `exceeds_remaining` with the remaining figure); a reconcile 200 with `passesFailed` above 0 shows the failure words (QA6b-M1) |
| PIN-h | On the admin's own account no money button renders |
| PIN-i | BD-9: Take back credits on a top-up whose lot is not loaded, and on one whose lot is folded, plus the "Take back in Credits above" and "Nothing left to take back" states |
| PIN-j | Danger: `TestAccountCleanupPanel` gets the row's email lock and is the drawer's last block; `onRemoved` calls the list read once; the Delete… entry is not rendered |
| PIN-k | The per-open request list for three accounts: a Business OS account, a non-Business OS account, and one whose entitlements or summary read fails (this is AC-4.3) |

### 1.4 Alternatives rejected

| Alternative | Why rejected |
|---|---|
| Tabs inside the drawer (Overview, Credits, AI, Account, Activity) | Hides money facts behind a click; a dialog opened from one tab and a Take back request crossing from the top-ups to the Credits block (BD-9) get harder; tabs inside a drawer are a new pattern with keyboard rules (A-4) for little gain over folds |
| Reorder only, no summary strip | Keeps P-1: the first screen still answers nothing |
| Merge the two AI-spend blocks into one figure | Different records; a sum or a choice of one would be wrong (BD-7) |
| A separate full page per business | Loses the list context; deep links to a drawer are out of v1 (U-10) |
| Keep reconcile in the drawer, relabelled | It still reads as an action on this account; the confusion stays |
| Reconcile on Finance | Finance is a read-only report by design; Scheduled jobs & queues already holds the on-demand job actions (Drain now) |

---

## 2. Item 2: Plans & entitlements boxes

### 2.1 Today

`app/admin/business-os-tiers/page.tsx:180-203` renders, after the plans and the not-built panel:

- **"Look up an account"** (`components/AccountLookup.tsx:99-156`): an account-id field and Look up, then `EntitlementSnapshot`; a note explains why it takes an id, not an email (`:109-123`).
- **"Changing any of this"** (`page.tsx:182-203`): static text naming `lib/business-os/entitlements/config/tierMatrix.ts`, plus the payload's `writeOpsNotOnThisPage` as id chips.

**Check: does the Businesses drawer already show the same "decided by which layer" detail?** Yes, exactly. `BusinessOsPanel.tsx:119` calls the same route (`GET /api/admin/business-os/entitlements/accounts/{id}`) and renders the same `EntitlementSnapshot` component (`BusinessOsPanel.tsx:219`), whose table has the "Decided by" column from the resolver's own `decidedBy` (`EntitlementSnapshot.tsx:108-124`). The only differences are that the drawer folds it, and a non-Business OS account shows the panel's one-line note instead of the snapshot. Its error words come from the same `ENTITLEMENT_ERROR_COPY` (`BusinessOsPanel.tsx:226`). And Businesses finds an account by name, company, business name or full account id (SA V-3: the server does not match email; the page's local email filter only covers rows the server already returned, finding SA-F2), which the lookup deliberately cannot.

### 2.2 Recommendation

| Box | Recommendation |
|---|---|
| Look up an account | **Remove it.** In its place, one line at the end of the plans content: "To see one account's plan and which layer decided each capability, open the account on Businesses (Plan & entitlements). Search Businesses by name, business name or account id", with a `next/link` to `/admin/users` (SA-C1). Under the default "Active" status an account with no recent sign-in is filtered out, so the pointer line or Businesses' empty state covers it (one click to search all users, U-4). Delete `AccountLookup.tsx`. `EntitlementSnapshot.tsx` and `ENTITLEMENT_ERROR_COPY` stay in the folder (the drawer imports them). |
| Changing any of this | **Shrink to one footnote line** under the not-built panel: "This page only reads. Per-account changes are audited API operations, not buttons:" followed by the existing id chips. The file path and the one-line or version-bump explanation are already in [BUSINESS_OS_ENTITLEMENTS.md](/docs/architecture/BUSINESS_OS_ENTITLEMENTS.md) (SA V-8), which the footnote may name; LF-2 adds no doc text. The header already says "Read-only". |

Keeping the operation ids on the page respects the original decision that write operations are "named on the page rather than silently absent" (`page.tsx:39-41`); only the box and the long text go.

**Precondition (AC-2.4):** SA verified in code (V-2) that a search matching the UUID pattern adds an exact id read, independent of the 1,000-row read limit and the 100-row screen cap. Dev re-confirms it once in the browser with an id outside the first 100 rows and records the result (SA-C1). F-27 itself (the 100-row cap, unused sort) stays open.

**F-39 becomes moot:** its open half asks for a name picker in the lookup. With the lookup gone, the name search is Businesses' own. F-39 closes when LF-2 merges.

**Entitlements constraints (business-os-entitlements skill):** no change to entitlement logic, routes or payloads; no new import from `lib/business-os/entitlements` (LF-2 removes a component and adds none); the tiers `source.guard` stays green: walked file list still at least 6 files (7 after the deletion), no import leaving the screen, no plan id, price or capability literal, no write method. `writeOpsNotOnThisPage` stays in the payload and is still rendered.

**Test edits (deliberate, listed for the workplan):** `page.render` "the account lookup says why it wants an id" (removed; replaced by a case for the Businesses line and link); `page.render` SA S-2 "a pending lookup shows Reading…" (removed); `page.render` "names the write operations" (the "Changing any of this" heading assertion changes to the footnote words; the two id assertions stay); `accountLookup.render.test.tsx` (deleted with its component); `accountLookup.contract.test.tsx` kept (it proves every route refusal has a sentence in `ENTITLEMENT_ERROR_COPY`, which the drawer still uses), renamed if SA wants.

### 2.3 Alternatives rejected

| Alternative | Why rejected |
|---|---|
| Keep the lookup, add a name picker (F-39) | Builds a second, weaker Businesses search on a configuration page; the SA reason recorded in `AccountLookup.tsx:109-115` |
| Move the lookup to Businesses as a new box | The drawer already is that view |
| Move "Changing any of this" entirely to docs | Drops the named operations, against the original read-only decision |

---

## 3. Item 3: One rule for "open"

### 3.1 Survey: every open, create, view-details and edit interaction on the visible admin pages

| Page | Interaction | Opens in | Citation |
|---|---|---|---|
| Health | Figure and page links | navigation (another page) | `components/health/HealthTile.tsx:118-125`, `:138-147` |
| Health | "How this tile is coloured" | inline disclosure | `HealthTile.tsx:151-167` |
| Finance | none (read-only report; filters only) | — | `finance/components/FinanceView.tsx:55-106` |
| AI cost & usage | Call row "Open" | drawer | `analytics/components/AnalyticsTable.tsx` (`OpenRowButton`, drawer body `AnalyticsCallDetails.tsx`) |
| AI cost & usage | Aggregate row | drill link (navigation, §5.8 D-3) | `AnalyticsTable.tsx` header comment `:7-10` |
| Scheduled jobs & queues | "View items" on a queue | inline panel with its own read and paging | `components/jobs/JobsQueuesView.tsx:309-320` |
| Scheduled jobs & queues | Drain now | modal dialog | `JobsQueuesView.tsx:283-288`, `DrainNowDialog.tsx` |
| Scheduled jobs & queues | Retry item, Cancel item | modal dialog | `components/jobs/QueueItemsPanel.tsx:285-291`, `:298` |
| Audit trail | Row "Open" | drawer | `audit-trail/page.tsx:816-820` |
| Audit trail | Export CSV | download | `audit-trail/page.tsx:848-859` |
| Archiving | Archive (start a run) | modal dialog | `archiving/page.tsx:463-473`, `ArchiveConfirmDialog.tsx` |
| Archiving | Continue a run | no confirmation (posts at once, F-63) | `archiving/page.tsx:334` |
| Businesses | Row "Open" and whole-row click (D-17) | drawer | `users/page.tsx:348-372`, `:638-659` |
| Businesses (drawer) | Give credits, Take back | modal dialog (opened by state) | `CreditsBlock.tsx:391-398`, `:403-415` |
| Businesses (drawer) | Set limit, Back to default, reconcile | modal dialog (opened by state) | `BoostBlock.tsx:364-381`, `:550-560`, `:565-589` |
| Businesses (drawer) | Plan & entitlements, Limit changes, audit events | inline disclosure | `BusinessOsPanel.tsx:207-220`; `BoostBlock.tsx:384-415`; `BusinessAuditSection.tsx:85-96` |
| Businesses (drawer) | Remove this account | inline panel (shared Business OS component) | `BusinessDetail.tsx:292-301` |
| Plans & entitlements | Withholds | inline disclosure | `business-os-tiers/components/PlanCard.tsx:166-200` |
| Plans & entitlements | Look up an account | inline form with inline result | `AccountLookup.tsx:129-154` (removed by LF-2) |
| Signup Invites | **New invite** | **inline form section** at the top of the content | `business-os-invites/page.tsx:175-183`, `:239-249`; `CreateInviteForm.tsx:126-322` |
| Signup Invites | Created link (shown once) | inline panel | `page.tsx:229-237` |
| Signup Invites | **Revoke** | **inline form under the row** | `components/InviteList.tsx:204-222`; `RevokeDialog.tsx:72-111` |
| Messages | Row "Open" and whole-row click | drawer | `messages/page.tsx:297-309`, `:448-465`; `MessagesTable.tsx:106-117`, `:146-150` |
| Messages (drawer) | Admin notes edit, Mark unread | inside the drawer | `messages/components/MessageDetail.tsx` |
| Messages | **Delete** | **browser `confirm()`** | `messages/page.tsx:257`; opener `MessagesTable.tsx:181-188` |
| Messages | **Mark All Read** | **browser `confirm()`** | `messages/page.tsx:284`, `:360-362` |
| Business OS AI, Activity | Row "Open" | drawer | `business-os-llm/components/activity/ActivityTable.tsx:121-130`, `ActivityDrillDown.tsx` |
| Business OS AI, Costs | Leak check (dates and Run) | inline on-demand tool | `components/costs/LeakCheckPanel.tsx:1-29` |
| Business OS AI, Settings | Area card | inline disclosure | `components/AreaCard.tsx:129-134` |
| Model pricing (not migrated) | Row edit | inline row edit | `system-config/page.tsx` (§4.12 of the standard) |
| Admin users | none (read-only) | — | `settings/page.tsx` |

### 3.2 The rule

| # | When | Use |
|---|---|---|
| OR-1 | View a record's details (a row with more than its cells) | **Right-side drawer** (`AdminDrawer`), as §5.8 D-1 to D-7 |
| OR-2 | Create a record, or edit a record's fields, with a form | **Drawer form**: the same `AdminDrawer`, its body a form; for an open record, its edit fields stay in that record's drawer (Messages notes) |
| OR-3 | Confirm an action, including an action that asks for one reason or one amount (Revoke, Delete, Give credits, Take back, Set limit, Drain, Retry, Cancel, Archive, reconcile) | **Modal dialog** (`ui/dialog` with `ADMIN_DIALOG_CLASS`), opened from a named button; focus returns to that button on close. Never the browser's `confirm()` |
| OR-4 | Show more of what is already on the card (folds, "How this is coloured", Withholds, an area card, a queue's item list) | **Inline disclosure**, with `aria-expanded` |
| OR-5 | An on-demand tool that is part of the page (Leak check) | Stays inline on the page |
| OR-6 | Never a new page for open or create; never a hand-built modal | — |

The rule decides **where** a confirmation or form appears, not **whether** one exists. Archiving's Continue (F-63) stays as it is (adding a step is a behaviour decision the user has not asked for). The Businesses cleanup panel (`TestAccountCleanupPanel`) is a shared Business OS component also used by the `/test-business-os` Danger Zone; it stays inline and unchanged (danger action, §1.3).

**Why this rule:** it is what all 5 migrated table pages already do (Businesses, Messages, Audit trail, AI cost & usage, Activity all open details in the drawer, and every money or queue confirmation is a dialog), so it changes the fewest places. A form in a drawer keeps the list visible and gives focus trap, Escape and focus return for free (D-6), which an inline section does not. A dialog is the right weight for one decision; a drawer would be too heavy for "are you sure". The browser's `confirm()` cannot be styled, named or tested like the rest.

### 3.3 Places that change

| Place | Today | After | Slice |
|---|---|---|---|
| Signup Invites, New invite | inline form section | drawer form (`CreateInviteForm` as the drawer body; opener "New invite"); on success the drawer closes and the shown-once link panel appears on the page as today | LF-3a |
| Signup Invites, Revoke | inline form under the row | dialog with the same reason field, words ("Revoke invite", "Keep it") and request; opens with focus on the reason field and refuses to close while in flight; the row keeps its Revoke button, named per row (fixes F-110); closes F-41 | LF-3a |
| Messages, Delete | `confirm()` | dialog, same words, opener the row's Delete button | LF-3b |
| Messages, Mark All Read | `confirm()` | dialog, same words, opener the header button | LF-3b |
| Businesses, three state-opened dialogs | dialog with no trigger: focus falls to body on close (F-108) | same dialogs, focus returns to their opener (BD-15) | LF-4b |
| Businesses, reconcile | dialog in the drawer | dialog on Scheduled jobs & queues, "Reconcile top-ups now (all accounts)" (BD-6) | LF-4c |

**LF-3a rules (SA SQ-4, SA-C9).** A create form inside `AdminDrawer` is a new pattern (CLAUDE.md rule 7), so LF-3a takes the full cycle. No shared code change is needed. The workplan states: the drawer refuses to close while the create request is in flight (the page ignores `onClose`); a half-filled 9-field form survives Escape or an overlay click until Cancel or success, its draft held in page state (SA recommendation); on success, focus moves to the created-link panel, not back to "New invite", so the shown-once link is announced and reachable; the `AdminDrawer` header comment gains the create-form use. OR-2 goes into §5.8 in the same PR.

**LF-3b rules (SA-C11).** The Messages dialogs open with initial focus on the non-destructive button; opening a dialog and pressing Enter does not delete; one send per confirmation; the request pins (DELETE, the PATCH fan-out, one re-read) stay unedited. UI short path.
| Model pricing, row edit | inline row edit | drawer form | when L-11 runs (not in this requirement) |

**Unchanged under the rule:** every other row in §3.1.

### 3.4 D-7 and test impact

| Concern | Finding |
|---|---|
| D-7 (Signup Invites writes no filter to the URL; the created link must not survive a reload) | **Not broken.** The drawer and dialogs never write the URL (U-10: an open drawer is not in the URL), the form still never imports `useAdminFilters`, and the link stays in page state only. The created-link panel stays on the page, outside the drawer, so a drawer close (Escape, overlay) cannot lose the once-shown link. SA confirmed (SQ-5) the transitive walker (G-7) stays sound: it follows `@/components/ui/sheet`, `@/components/ui/dialog` and `@/lib/utils` and stops at packages, none of which names history, storage, the router or search params |
| Invites guards | `source.guard`: exact file list unchanged if no file is added (the dialog lives in `RevokeDialog.tsx`, which finally becomes a dialog). **G-8 amendment (SA-C10), one named amendment:** exactly `@/components/ui/dialog` is let into exactly `RevokeDialog.tsx` (the per-file `escapes()` rule otherwise refuses it); no `@/components/ui/button` (use the shared button classes); `components/ui/sheet.tsx` and `components/ui/dialog.tsx` are added to G-7's positive control, so the walk is proven to reach them. All other imports through the shared alias only |
| Invites tests | `page.render` create-form and revoke cases (location, the "Revoke" name, F-110's two pinned tests); Dev lists them at workplan |
| Messages tests | the characterisation suite (B-cases that stub `window.confirm`) and the source guard's pin of the Q-8 deviation are edited deliberately; the request pins (DELETE, the PATCH fan-out, one re-read) stay unedited |
| Standard text | LF-3a adds OR-1 to OR-6 to §5.8 of the standard and retires the L-6 Q-7 and L-7 Q-8 page deviations (TL links this file; the edit to the standard is part of the slice's PR) |

### 3.5 Alternatives rejected

| Alternative | Why rejected |
|---|---|
| Everything inline (forms and confirmations under their rows) | Contradicts every migrated drawer page; no focus trap; an inline form pushes the table down |
| Create and edit forms in a modal dialog | Long forms (New invite has 9 fields) do not fit a dialog; the drawer is already the admin's form surface |
| Drawers for confirmations too | Too heavy for one decision; stacks a drawer on a drawer in Businesses |

---

## 4. Item 4: Contrast follow-up

Browser check 2026-10-13 (dark scheme; contrast measured against the page background): `text-slate-500` information text is below WCAG AA 4.5:1 on three pilot pages that kept it. The standard's T-5 already forbids it for meaningful text; the pilots were not forced to change it (F-95 for Jobs, F-116 for Activity).

| Page | Elements below 4.5:1 | Ratio | Source |
|---|---|---|---|
| Health | 36 | 3.07:1 | `components/health/HealthTile.tsx:136` (footnote), `:158` (rule condition lines), `:162` (rule otherwise line) |
| Scheduled jobs & queues | about 88 | 4.16:1 | `components/jobs/JobsQueuesView.tsx:174`, `:178`, `:196`, `:201-202`, `:222`, `:235`, `:275`, `:304-305`, `:401`, `:408`, `:432`; `QueueItemsPanel.tsx:258`; one hint line in each of `DrainNowDialog.tsx`, `CancelQueueItemDialog.tsx`, `RetryQueueItemDialog.tsx` (F-95's 17 uses) |
| Audit trail | 8 | below 4.5:1 | `audit-trail/page.tsx:378`, `:515`, `:562`, `:1075`, `:1083` (SA-C13, read 2026-10-13; more than the pagination line). Dev lists every information line at workplan |
| Businesses | 1 | below 4.5:1 | `users/components/CreditsBlock.tsx:380` ("Dates are shown in UTC") |

**Change:** information text from `text-slate-500` to `text-slate-400` (the standard's T-5 colour). Decoration stays (for example `decoration-slate-500` underlines at `HealthTile.tsx:122`, `:143`; icons). No words change.

**Scope decisions:**
- Health, Jobs and Audit trail go in LF-1 (UI short path).
- The Businesses element moves to LF-4b, because `CreditsBlock.tsx` is money UI and is edited there anyway; LF-1 then touches no money file.
- The Activity half of F-116 joins LF-1 for class-only `text-slate-500` to `text-slate-400` changes on information lines the Dev lists at workplan (SA SQ-8); retiring `Chip.tsx` is a component change and stays out.
- Finance's "as of" line (`finance/components/FinanceView.tsx:61`) is slate-500 too; it belongs to the finance adoption slice, not here.

**Guards to keep green:** `health.source.guard` (green only in `GREEN_STYLE`; this change adds no green); the Health slice-5 QA probes (`health.qa-slice5.render` is checked for class pins before the edit, SA-C13, because L-1a deliberately left `HealthTile.tsx` unedited); the Jobs guards (one `fetch(`, 11 buttons, the pinned purpose sentence; class-only edits do not touch them).

---

## 5. Browser checks recorded 2026-10-13

| # | Observation | Result |
|---|---|---|
| BC-1 | All 13 sidebar pages load with exactly one `h1`, no error banner and no horizontal scroll at desktop width | Pass |
| BC-2 | The admin shell forces the dark surface, so the pages render correctly with the OS in light mode | Pass |
| BC-3 | Audit trail presets write `?range=7d` and send the matching date window | Pass |
| BC-4 | `text-slate-500` information text below 4.5:1 on Health, Jobs & queues, Audit trail, Businesses | Fail; §4, slice LF-1 (and LF-4b for Businesses) |

These close the browser-check items for the main L-slices only as far as these observations go; the per-slice browser checklists owed in the standard's §1 are not re-run here.

---

## 6. Non-functional requirements

- **Performance:** no new request on any page. The Businesses drawer sends the same reads, each once per open, as today; folds send nothing.
- **Security:** no permission, route or payload change. No money or danger request changes (§1.3). The reconcile move keeps its admin route and its empty body (no account id is ever sent, SA C-6).
- **Accessibility:** WCAG AA 4.5:1 for information text (T-5); every opener named; dialogs and drawers return focus to their opener (D-6, F-108); folds use `aria-expanded`; no new landmark region (A-9).
- **Consistency:** the standard's shared components only; a new shared export, if SA finds one is needed, runs its slice on the full cycle (R-7).
- **Logging:** any `console.*` or server `createLogger` found in a touched client file is flagged per CLAUDE.md (for example `users/page.tsx:5` imports `createLogger` from `@/lib/logger` in a client file, an F-56 case; converted only if that file is touched and the user agrees).

---

## 7. Acceptance criteria

### 7.1 LF-1 Contrast

- [ ] AC-1.1 No `text-slate-500` on information text in `HealthTile.tsx`, the five Jobs client files and every Audit trail information line the Dev lists at workplan (at least `audit-trail/page.tsx:378`, `:515`, `:562`, `:1075`, `:1083`), not only pagination (SA-C13).
- [ ] AC-1.2 A browser re-check finds 0 elements below 4.5:1 on Health, Jobs & queues and Audit trail.
- [ ] AC-1.3 Health, Jobs and Audit trail guards and render suites green with no weakened assertion. F-95 closed.

### 7.2 LF-2 Plans & entitlements

- [ ] AC-2.1 No "Look up an account" box; one line with a link to `/admin/users` in its place.
- [ ] AC-2.2 No "Changing any of this" box; one footnote line still names every `writeOpsNotOnThisPage` operation.
- [ ] AC-2.3 The tiers `source.guard` green unedited; no import from `lib/business-os/entitlements` added anywhere; no change to any entitlements route, payload or logic; `npm run test:bos-entitlements` green.
- [ ] AC-2.4 Met by the code (SA V-2); Dev re-confirms once in the browser that a Businesses search by full account id finds an account outside the first 100 rows, and records the result. The pointer line says "Search Businesses by name, business name or account id" (no email). F-39 closed.

### 7.3 LF-4a.1 / LF-4a.2 / LF-4b / LF-4c Businesses drawer

- [ ] AC-4.1 (LF-4a.1, test-only PR) The characterisation suite pins, through the whole drawer, every action in §1.3: opener, dialog words, confirm step, request URL, method, headers, `cache` option and body, single send, success notice, re-read, plus PIN-a to PIN-k (SA-C5). Green on the unchanged code; SA reviews the pin list before merge.
- [ ] AC-4.2 (LF-4a.2) The drawer shows the summary strip (`DrawerFields`, `CreditsLeftCell` with the row's props) and the six sections in the BD-4 order; the danger area is last.
- [ ] AC-4.3 No new request: a test counts the drawer's requests per open and asserts the same list as before, for a Business OS account, a non-Business OS account, and one whose entitlements or summary read fails (PIN-k).
- [ ] AC-4.4 Credits figures are never summed (plan left and extra separate); USD labelled estimated.
- [ ] AC-4.5 Long lists show 3 and fold the rest; a Take back from a top-up still opens the Credits dialog on a folded lot (BD-9).
- [ ] AC-4.6 (LF-4c) Reconcile is gone from the drawer and available on Scheduled jobs & queues as "Reconcile top-ups now (all accounts)" in the Billing reconcile job's row, with the same request and the reworded, pinned dialog description (BD-6); the Jobs guard amended as named in BD-6; the drawer shows the pointer line.
- [ ] AC-4.7 (LF-4b) Closing Give credits, Take back, Set limit, Back to default, or Take back credits on a top-up returns focus to its opener; if the opener is gone, focus goes to the section's heading, never `<body>` (F-108, BD-15).
- [ ] AC-4.8 The §1.3 suite still green at the end of each slice, with only position edits and the named deliberate edits.
- [ ] AC-4.9 (LF-4a.2) A non-Business OS account shows "Not a Business OS account" in the strip's Plan, Credits and AI slots, never zero, and sends no credits or top-up read (BD-13).
- [ ] AC-4.10 (LF-4b) After a successful Give or Take back, `refreshList` is called once and the strip, list row and Credits block agree (BD-14).

### 7.4 LF-3a / LF-3b Open behaviour

- [ ] AC-3.1 New invite opens a drawer form; the drawer refuses to close while the request is in flight; success closes it, shows the shown-once link on the page and moves focus to it; nothing writes the URL, history or storage (Invites guard green, with the G-8 amendment only).
- [ ] AC-3.2 Revoke opens a dialog with the same reason rule, words and request, focus on the reason field, refusing to close while in flight; each Revoke button names its invite.
- [ ] AC-3.3 Messages Delete and Mark All Read use admin dialogs with the same words and the same requests; initial focus on the non-destructive button; Enter on open does not delete; one send per confirmation; no `confirm(` left in `app/admin/messages`.
- [ ] AC-3.4 OR-1 to OR-6 recorded in the standard's §5.8.

---

## 8. Slices

Small numbered slices, each a few days at most, each its own PR, merged before the next starts (standard §3 rules 1 to 8 apply). Reuse only the existing shared components.

| Run order | Slice | Scope | Size | Path | Why this path |
|---|---|---|---|---|---|
| 1 | LF-1 | Contrast fix on Health, Jobs & queues, Audit trail, plus the Activity half of F-116 (§4) | About 1 day | UI short path | Class-only, no money file (the Businesses line moved to LF-4b). SA-C13 |
| 2 | LF-2 | Plans & entitlements: remove the lookup, shrink the second box (§2) | About 1 day | UI short path, plus `npm run test:bos-entitlements` | No entitlements import added or removed; tiers `source.guard` stays at 7 files, above its floor of 6; the slice touches the entitlements admin screen (skill: definition of done). SA-C1 |
| 3 | LF-4a.1 | Businesses drawer: the §1.3 characterisation suite only (PIN-a to PIN-k), on the unchanged code | 1 to 2 days | **Test-only**; SA reviews the pin list before merge | Green on unchanged code is the point; any red means the pin is wrong, not the code. Merged before any drawer code moves. SA-C4, SA-C5 |
| 4 | LF-4a.2 | Businesses drawer: layout outside the money blocks: summary strip (BD-1, BD-3), section order, AI usage section, Account & security grouping, folds outside the money blocks, BD-11 in non-money files, `readJsonBody` in `BusinessOsPanel` only, non-Business OS state (BD-13). `CreditsBlock`, `BoostBlock`, the dialogs and the danger area are moved as whole units, not edited | 2 to 3 days | **Full cycle** | Hosts every money and danger action. SA-C6, SA-C7, SA-C12 |
| 5 | LF-4b | Businesses drawer: inside the money blocks: action bars, lot and top-up folds, their slate-500 lines, F-108 focus return (BD-15), `refreshList` after Give or Take back (BD-14); when the money blocks' `h4`s become labels, remove the D-20 Credits & billing heading exception in `businessDetail.render` (LF-4a.2 SA C2, SQ-A) | About 2 days | **Full cycle** | Money UI. SA-C7 (re-read), SA-C8 |
| 6 | LF-4c | Reconcile moved to Scheduled jobs & queues as "Reconcile top-ups now (all accounts)" in the Billing reconcile job's row; two new files in `app/admin/components/jobs/`; Jobs guard amendment; reworded dialog description (BD-6) | About 2 days | **Full cycle** | Moves a cross-account money action to another page and amends the Jobs guard. SA-C2, SA-C3 |
| 7 | LF-3a | Open rule part a: rule into §5.8; Signup Invites New invite as a drawer form, Revoke as a dialog, G-8 guard amendment, F-110, F-41 | About 2 days | **Full cycle** (SA SQ-4) | New pattern; the form grants plans and sends a real email. SA-C9, SA-C10 |
| 8 | LF-3b | Open rule part b: Messages `confirm()` to admin dialogs | 1 day | UI short path | Confirmation surface only; requests pinned. SA-C11 |

**Why this order:** the two quick wins first; then the drawer, which is the user's main complaint; the open-behaviour changes last, because they also amend the standard's text. The user may reorder; within the drawer, LF-4a.1 merges before any drawer code moves, and LF-4a.2, LF-4b and LF-4c run in that order.

---

## 9. Questions for the user

Each has a recommended answer. Answer by number, for example "Q-1: a".

**User answers, 2026-10-13: Q-1 (a), Q-2 (a), Q-3 (a), Q-4 (a), all as recommended.**

| # | Answer | What it means |
|---|---|---|
| Q-1 | (a) | Reconcile moves to Scheduled jobs & queues, labelled "Reconcile top-ups now (all accounts)", in the Billing reconcile job's row (BD-6, LF-4c) |
| Q-2 | (a) | "Look up an account" removed, replaced by a pointer line to Businesses; "Changing any of this" shrinks to one footnote line that still lists the operations (§2.2, LF-2) |
| Q-3 | (a) | The open rule (OR-1 to OR-6) applies everywhere, including Signup Invites and Messages (§3, LF-3a, LF-3b) |
| Q-4 | (a) | Both AI-spend figures kept in one "AI usage" section: Business OS first, "all products" folded underneath, with a note that the two can differ (BD-7) |

**Q-1. Where should the button that reconciles top-ups for every business live?**
A button to reconcile top-ups for all businesses checks billing for every business at once, but today it sits inside one business's panel, which makes it look like an action on that business.
- (a) On Scheduled jobs & queues, as a "Reconcile top-ups now (all accounts)" button next to the nightly billing reconcile job. Same confirmation, same effect; the press is not recorded as a run of the nightly job.
- (b) Keep it in each business's panel.
- (c) On Finance.
- **Recommended: (a).** It sits where an admin looks for billing jobs, like "Drain now" on a queue; Finance is a read-only report.
- **Answer (2026-10-13): (a).**

**Q-2. Plans & entitlements: remove the two boxes?**
"Look up an account" shows one account's plan and which rule decided each feature; the Businesses panel already shows exactly the same thing, and Businesses can find an account by name, business name or account id.
- (a) Remove "Look up an account" and point to Businesses instead; shrink "Changing any of this" to one line that still lists the operations.
- (b) Keep both boxes as they are.
- **Recommended: (a).** One place for one account's plan.
- **Answer (2026-10-13): (a).**

**Q-3. Make "open" behave the same everywhere?**
Rule: details and forms open in the side panel; "are you sure" questions open a small confirmation box. What you would notice: on Signup Invites, "New invite" opens the side panel instead of a section on the page (the once-only link still appears on the page after you create it), and Revoke asks for its reason in a small confirmation box instead of under the row. On Messages, Delete and Mark All Read use the admin's own confirmation box instead of the browser's "Are you sure?" pop-up.
- (a) Yes, apply the rule.
- (b) Apply it to Signup Invites only.
- (c) Leave the pages as they are.
- **Recommended: (a).**
- **Answer (2026-10-13): (a)**, everywhere, including Signup Invites and Messages.

**Q-4. The two "AI spend" figures in a business's panel (F-24)**
One is Business OS AI spend from the Business OS records; the other is "all products" from the older token records. They come from different records and can differ.
- (a) Keep both in one "AI usage" section: Business OS first, "all products" folded underneath with one sentence saying they can differ.
- (b) Remove the "all products" figure from the panel (it stays on AI cost & usage).
- (c) Keep them as today.
- **Recommended: (a).** Nothing is lost, and the panel stops showing two unexplained totals.
- **Answer (2026-10-13): (a).** Business OS first, "all products" folded underneath, with a "can differ" note.

---

## 10. Open questions for SA

| # | Question | BA suggestion |
|---|---|---|
| SQ-1 | Does the admin reconcile route (`/api/admin/business-os/credits/boost/reconcile`) run the same pass as the `bos-billing-reconcile` cron? | If yes, "Run now" on that job's row. If not, a "Run on demand" line under the Scheduled jobs table with the honest label "Billing reconcile (top-ups)". Either way the dialog and request are unchanged |
| SQ-2 | Where do `BoostReconcileDialog` and its copy (`users/boostCopy.ts`) live once Jobs uses them? The Jobs view imports only the shared folder and `lib/admin/jobs` types | Move the dialog and its copy into `app/admin/components/jobs/`, unchanged; the Businesses folder keeps no reconcile code |
| SQ-3 | Summary strip: the shared no-target `KpiTile` inside a drawer, or a plain `dl`? | No-target `KpiTile` (exists since L-2a, no new export); if its grid does not fit the drawer width, a plain `dl` |
| SQ-4 | Is a create form inside `AdminDrawer` a new pattern (CLAUDE.md rule 7, R-7), making LF-3a full cycle? | No new export is built, so UI short path, with SA reviewing the rule text (OR-1 to OR-6) in this requirement |
| SQ-5 | Does the Invites transitive import walker (L-6 M-4) accept `AdminDrawer` and `@/components/ui/dialog` without loosening its proof? | Yes if it stops at packages; SA confirms before LF-3a starts |
| SQ-6 | Focus return for state-opened dialogs (F-108): an opener ref per block plus `onCloseAutoFocus`, or Radix `Trigger`? | Opener ref plus `onCloseAutoFocus` (the L-4b SA proposal); no shared export |
| SQ-7 | May LF-4a move `BusinessOsPanel`'s `readJson` to `readJsonBody` (§5.10), given the requests stay byte-identical? | Yes, pinned by the §1.3 suite and the request-count test |
| SQ-8 | Include the Activity half of F-116 in LF-1? | Yes if its lines render under the same check; same class-only change |
| SQ-9 | The Businesses list's `CreditsLeftCell` in the summary strip: same component, same props, so the drawer never disagrees with the list? | Yes |

---

## 11. Out of scope / future roadmap

- Model pricing (L-11) and its inline row edit; OR-2 applies when L-11 runs.
- Any change to credit, boost, entitlement or deletion logic, routes or payloads.
- Archiving Continue with no confirmation (F-63, the user's).
- Messages hard delete (F-10) and the Mark All Read fan-out (F-12): only their confirmation surface changes in LF-3b.
- Drawer deep links (U-10), tabs inside drawers.
- The finance adoption slice (Finance's header, URL contract F-97, its slate-500 line).
- F-105 (a failed login-stats or audit read is not stated), F-106, F-107: unchanged unless a slice's workplan finds them in its way, then recorded, not fixed.

---

## 12. Notes on integration points

| Area | Files | Note |
|---|---|---|
| Businesses drawer | `app/admin/users/page.tsx`, `components/BusinessDetail.tsx`, `BusinessOsPanel.tsx`, `CreditsBlock.tsx`, `BoostBlock.tsx`, `BusinessAuditSection.tsx`, `CreditFormDialog.tsx`, `BoostCapDialog.tsx`, `BoostReconcileDialog.tsx`, `useBusinessDetails.ts` | `creditBands.guard` scans every file under `app/admin/users`; `source.guard` pins the danger-area position; `businessOsPanel.render`, `businessDetail.render`, `creditsBlock.render`, `boostBlock.render`, `boostBlock.actions.render`, `deleteBusinessDialog.render` pin today's order and requests |
| Shared Business OS component | `components/business-os/purge/TestAccountCleanupPanel.tsx` | Not edited; also used by `/test-business-os` |
| Imports from other modules | `BusinessOsPanel.tsx:27` (`@/lib/audit/events`), `:28-32` (the tiers folder's `EntitlementSnapshot` and types); `BoostBlock.tsx:38-46` (`@/lib/business-os/boost/*`, not the entitlements module) | No new import from `lib/business-os/entitlements` in any slice |
| Plans & entitlements | `app/admin/business-os-tiers/page.tsx`, `components/AccountLookup.tsx`, `components/EntitlementSnapshot.tsx`, `__tests__/*` | Route `GET /api/admin/business-os/entitlements/accounts/{id}` unchanged and still used by the drawer |
| Scheduled jobs & queues | `app/admin/components/jobs/*`, `lib/cron/bosCronJobs.ts` (read only) | Pins: one `fetch(` in the view, the button count, the purpose sentence |
| Signup Invites | `app/admin/business-os-invites/page.tsx`, `components/CreateInviteForm.tsx`, `RevokeDialog.tsx`, `InviteList.tsx`, `__tests__/source.guard.test.ts` | D-7 guard and the transitive walker |
| Messages | `app/admin/messages/page.tsx`, `components/MessagesTable.tsx`, `__tests__/*` | Request pins unchanged |
| Standard | `docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md` | §5.8 gains OR-1 to OR-6 (LF-3a); §9 closes F-24, F-39, F-41, F-95, F-108, F-110 as their slices merge; TL links this file from §1 |
| Docs | `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` | Already holds the "how a plan's contents change" text (SA V-8); LF-2 adds none, the footnote may name it |

---

## 13. SA Review

**Reviewed by SA — 2026-10-13**
**Status:** APPROVED WITH CONDITIONS (SA-C1 to SA-C14 below). The design is sound and proportionate; the conditions correct three code claims, close gaps in the money pin list, and resize the drawer slices. BA folds the conditions into §1 to §9 before the user sees §9; no second SA pass is needed for that fold-in unless a condition is disputed.

### 13.1 Code claims verified

| # | BA claim | Verdict | Evidence |
|---|---|---|---|
| V-1 | The drawer already renders the same `EntitlementSnapshot` with "Decided by" | **True** | `BusinessOsPanel.tsx:119` reads `GET /api/admin/business-os/entitlements/accounts/{id}`, the route `AccountLookup.tsx` reads; `:219` renders `EntitlementSnapshot`; its table has the "Decided by" column from the resolver's own `decidedBy` (`EntitlementSnapshot.tsx:109`, `:124`); `:226` uses `ENTITLEMENT_ERROR_COPY`. The only differences: the drawer folds it, and a non-Business OS account shows the panel's one-line note instead of the snapshot |
| V-2 | F-27: Businesses search finds an account by full id beyond the first 100 rows | **True, with one caveat** | A search matching the UUID pattern adds an exact `.eq('id', search)` read (`UserProfileRepository.ts`, `listForAdmin`), independent of the 1,000-row read limit and the 100-row screen cap (`users/page.tsx:72`, `:342`). Caveat: under the default "Active" status an account with no recent sign-in is filtered out after the read (`api/admin/users/route.ts`, status filter), so the admin gets the empty state and its one-click "search all users" (U-4). F-27 itself (the 100-row cap, unused sort) stays open |
| V-3 | "Businesses finds an account by name, **email** or business name" (§2.1, Q-2) | **False for email** | The server matches `full_name`, `company`, business name and exact id only (`ADMIN_PROFILE_LIST_COLUMNS` has no email). The page's client filter also tests `email` (`users/page.tsx:296`), but only over rows the server already returned, so typing an email finds nothing unless it also matches a name. See SA-C1 and finding SA-F2 |
| V-4 | Reconcile dialog request | **True, one detail added** | `BoostReconcileDialog.tsx`: POST to the literal `RECONCILE_URL`, headers `Content-Type: application/json`, body the literal string `'{}'`, `cache: 'no-store'`; Run disabled and close refused while in flight (`inFlight` ref). The pin must include the header and cache option, not only URL, method and body |
| V-5 | Messages uses `confirm()` | **True** | `messages/page.tsx:257` (Delete) and `:284` (Mark All Read), each a recorded SA Q-8 deviation |
| V-6 | Invites create is an inline section; Revoke is an inline form under the row | **True** | `business-os-invites/page.tsx:175-183` (opener), `:239-249` (form mounted in the content); `InviteList.tsx:204-222` mounts `RevokeDialog` in the row's action cell; `RevokeDialog.tsx` is a `<form>`, POSTs `{ reason }` to `/api/admin/business-os/invites/{id}/revoke` |
| V-7 | The other §1.1 and §1.3 line citations | True within a line or two | `CreditsBlock.tsx:198`, `:380`, `:404`; `BoostBlock.tsx:259`, `:272`, `:277`, `:325`, `:370`, `:379`, `:529`, `:559`, `:566`, `:582`; `BusinessDetail.tsx:39`, `:255`, `:293`; `BusinessOsPanel.tsx:55`, `:155`, `:292` |
| V-8 | `BUSINESS_OS_ENTITLEMENTS.md` may lack "how a plan's contents change" | **Already there** | § Adding or changing a tier, § Removing a capability from a tier, § Admin operations. LF-2 adds no doc text; the footnote may name that document |

### 13.2 Answers to SQ-1 to SQ-9

| # | SA answer |
|---|---|
| SQ-1 | **Same pass today, not by construction.** The admin route runs `runReconcilePasses([boostReconcilePass], …)` with the 45 s budget; the cron runs `RECONCILE_PASSES`, which today is `[boostReconcilePass]` only (`lib/business-os/billing/reconcilePasses.ts`). That file is the seam where plan payments P-8b appends `planReconcilePass` **to the cron only**; the admin route will stay top-ups only. Also, the admin route by design never writes a `bos_cron_runs` row (7d C7-11), so a press does not change the job row's "last run". Ruling: **not** a "Run now" for the job. The button sits in the Billing reconcile job's row (where an admin looks) but is named for what it does: "Reconcile top-ups now (all accounts)". See SA-C2 |
| SQ-2 | **Not as proposed.** `users/boostCopy.ts` imports `@/lib/business-os/currency` at run time, and every Jobs client file is refused any runtime `@/lib/business-os` import (Jobs source guard, C-21). `boostCopy` is also shared by `BoostBlock` and `BoostCapDialog`, so it cannot move. Ruling: the dialog moves to `app/admin/components/jobs/` (one new file); the reconcile words, `reconcileOutcome` and `reconcileSentences` move out of `boostCopy` into a second new jobs-folder file with no imports at all (they need none); `boostCopy` loses its reconcile keys; the Businesses folder keeps no reconcile code beyond the pointer line. See SA-C3 |
| SQ-3 | **A plain `dl` through the existing `DrawerFields` / `DrawerField`** (D-5), not `KpiTile`. `KpiTile` takes `value: string`; SQ-9 needs a React element (`CreditsLeftCell`) in the Credits left slot, so `KpiTile` would need a shared prop change (R-7, full cycle) for no gain. `DrawerFields` already takes children and is the drawer's own primitive. No shared export changes |
| SQ-4 | **Yes, a new pattern.** No admin page puts a form in `AdminDrawer` today (its five users are all row-detail drawers; Messages' notes field edits an open record, not a create). `AdminDrawer`'s own header says "one row's details". CLAUDE.md rule 7 applies: **LF-3a takes the full cycle.** No shared code change is needed (the page owns `open` and can ignore `onClose` while a request is in flight), but the rule text, the AdminDrawer doc comment and the close-while-sending behaviour are new. See SA-C9 |
| SQ-5 | **The transitive walker (G-7) stays sound; the per-file import rule does not accept the dialog.** `AdminDrawer` is through the allowed alias; the walker then follows `@/components/ui/sheet`, `@/components/ui/dialog` and `@/lib/utils` (all `@/` specifiers, so walked) and stops at `@radix-ui/react-dialog` and `class-variance-authority` (packages, as it always has). None of the walked files names history, storage, the router or search params, so the proof is not loosened. But `escapes()` refuses any `@/` specifier outside the screen and the shared layout folder, so a direct `@/components/ui/dialog` import in `RevokeDialog.tsx` fails the per-file rule. See SA-C10 for the narrow amendment |
| SQ-6 | **Opener ref per block plus an optional `onCloseAutoFocus` on the local dialogs**, as the L-4b SA proposed; no shared export. Two additions: the top-ups' Take back credits opens the Credits block's dialog, so its opener ref must travel with the take-back request; and when the opener is gone after success, focus goes to an always-mounted target, never `<body>`. On Jobs, the moved reconcile dialog uses `DialogTrigger` like Drain now, which returns focus for free. See SA-C8 |
| SQ-7 | **Yes for `BusinessOsPanel`'s two GETs only**, in the layout slice (SA-C4's LF-4a.2): same URL, same `cache: 'no-store'`; `readJsonBody` parses identically and maps a non-JSON or non-object body to the same `'unknown'` code. The panel then joins the Businesses list in `layoutFolder.guard`. **No** for `CreditsBlock`, `BoostBlock`, `CreditFormDialog`, `BoostCapDialog` and the reconcile dialog: money files, and converting them is not a layout change (L-4b SA Q-5 precedent, recorded in `layoutFolder.guard`). See SA-C12 |
| SQ-8 | **Yes**, for class-only `text-slate-500` to `text-slate-400` changes on information lines the Dev lists at workplan. Retiring `Chip.tsx` (F-116's other half) is a component change and stays out |
| SQ-9 | **Yes: the same `CreditsLeftCell`, the same `business` and `creditsLeft` props from the row.** Two consequences the requirement must state: the component hard-codes `data-testid="row-credits-left"`, so with the drawer open that id appears twice (tests scope with `within`, or the component gains a local test-id prop, not a shared change); and the figure is the list's, so after a Give or Take back it is stale beside a Credits block that re-read. See SA-C7 |

### 13.3 Conditions

All fourteen conditions were folded into the body on 2026-10-13; the last column says where.

| # | Condition | Applies to | Fold-in |
|---|---|---|---|
| SA-C1 | Correct §2.1 and Q-2: Businesses search matches name, company, business name and full account id, **not email** (V-3). The Plans pointer line says "Search Businesses by name, business name or account id". AC-2.4 is met by the code (V-2); Dev re-confirms it once in the browser with an id outside the first 100 rows and records the result, and the pointer line or the empty state covers the default "Active" filter (one click to search all users) | §2, Q-2, LF-2 | **Applied** 2026-10-13: §2.1, §2.2 (pointer line, precondition), AC-2.4, Q-2 |
| SA-C2 | BD-6, AC-4.6 and Q-1: the button is "Reconcile top-ups now (all accounts)", in the Billing reconcile job's row, not "Run now" (SQ-1). The dialog's description cannot stay word for word: "every business, **not only this one**" only makes sense in a business's drawer. Reword it for the Jobs page and add that the press is not recorded as a run of the nightly job. A deliberate, pinned copy change | §1.2, §1.3, LF-4c | **Applied** 2026-10-13: BD-6, §1.3 table, AC-4.6, Q-1 |
| SA-C3 | Reconcile code moves per SQ-2: two new files in `app/admin/components/jobs/` (the dialog, opened by `DialogTrigger`; a no-import copy file). Jobs source guard amended narrowly and named in the PR: the dialog joins `CLIENT_FILES`; exactly one `fetch(`, one POST, to the literal reconcile URL, with the literal body `'{}'`; the view's header sentence (`VIEW_HEADER_SENTENCE`, "everything else here is read-only") is updated to name the new action; the jobs button count and render pins edited deliberately. Businesses: the reconcile cases in `boostBlock.actions.render` move to a Jobs render test with the **same** assertions; `users/__tests__/source.guard` drops the file from its dialog list | LF-4c | **Applied** 2026-10-13: BD-6 (file split, Jobs guard amendment, test moves), §8 LF-4c |
| SA-C4 | **Re-slice the drawer** (each a few days, each its own PR, all full cycle): **LF-4a.1** the characterisation suite only, test-only PR on the unchanged code, merged before any drawer code moves (SA reviews the pin list against SA-C5 before merge); **LF-4a.2** the layout outside the money blocks (strip, order, AI usage, Account & security, folds outside money, BD-11 in non-money files); **LF-4b** inside the money blocks (action bars, lot and top-up folds, their slate-500 lines, F-108); **LF-4c** the reconcile move to Scheduled jobs & queues. As written, LF-4b mixes money UI on one page with a guarded action move on another; LF-4a mixes the pin suite with the change it guards | §8, Progress table | **Applied** 2026-10-13: Progress table, §1.3, §7.3, §8 (SA sizes and paths) |
| SA-C5 | **The pin suite (AC-4.1) must also pin**, through the whole drawer: (a) the request id: one per dialog opening, the same id on a retry after a failure, a new id on the next opening (OP-32); (b) Take back bodies: a number and `'rest'`; `confirmPaidCredits` sent only when the lot needs it, and submit blocked until the paid confirmation is ticked; (c) Give bodies: `expiresAt` null and dated; (d) the exact `set_boost_cap` and `end_boost_cap` bodies; (e) headers and the `cache` option on every POST; (f) a double click sends once, and Credit, Cap and Reconcile dialogs refuse to close while in flight; (g) one failure path per action: the dialog stays open with the mapped sentence (including `exceeds_remaining` with the remaining figure), and a reconcile 200 with `passesFailed` above 0 shows the failure words (QA6b-M1); (h) on the admin's own account no money button renders; (i) BD-9: Take back credits on a top-up whose lot is not loaded, and on one whose lot is folded, plus the "Take back in Credits above" and "Nothing left to take back" states; (j) danger: `TestAccountCleanupPanel` gets the row's email lock and is the drawer's last block, `onRemoved` calls the list read once, the Delete… entry is not rendered; (k) the per-open request list for three accounts: a Business OS account, a non-Business OS account, and one whose entitlements or summary read fails (this is AC-4.3) | LF-4a.1 | **Applied** 2026-10-13: §1.3 pin list PIN-a to PIN-k, AC-4.1, AC-4.3 |
| SA-C6 | State the drawer for a **non-Business OS account** (the list holds agent-platform-only logins): the strip shows "Not a Business OS account" in its Plan, Credits and AI slots, never zero; Credits & billing and Plan & entitlements collapse to today's one-line note; AI usage shows only "All products". `CreditsBlock` and `BoostBlock` keep today's gate: mounted only after the panel's two reads settle and only for a Business OS account, so no credits or top-up read is ever sent for a non-Business OS account. Lifting the panel's two reads to feed the strip keeps each read once per open; the BD-9 state (take-back request, loaded lots) moves with the two blocks as one unit | §1.2, LF-4a.2 | **Applied** 2026-10-13: BD-13, AC-4.9 |
| SA-C7 | Strip per SQ-3 and SQ-9: `DrawerFields` / `DrawerField`, `CreditsLeftCell` with the row's props. After a successful Give or Take back, the drawer calls the existing `refreshList` once, so the strip, the list row and the Credits block agree. This is a post-action read, not a per-open read (AC-4.3 unaffected), and it is a deliberate edit of the "re-read" pin, named in the PR | LF-4a.2 (strip), LF-4b (the re-read) | **Applied** 2026-10-13: BD-3, BD-14, AC-4.2, AC-4.10 |
| SA-C8 | F-108 per SQ-6: opener refs per block; the top-up Take back's ref travels with the take-back request so focus returns to that top-up's button; if the opener is no longer in the document (lot emptied, row gone), focus goes to the section's heading, never `<body>`. AC-4.7 adds the top-up Take back credits case | LF-4b | **Applied** 2026-10-13: BD-15, AC-4.7 |
| SA-C9 | LF-3a takes the **full cycle** (SQ-4). The workplan states: the drawer refuses to close while the create request is in flight (the page ignores `onClose`; no shared change); what Escape or an overlay click does to a half-filled 9-field form (SA recommends the draft survives until Cancel or success, held in page state); on success, focus moves to the created-link panel, not back to "New invite", so the shown-once link is announced and reachable; the `AdminDrawer` header comment gains the create-form use. OR-2 goes into §5.8 in the same PR | §3, LF-3a | **Applied** 2026-10-13: §3.3 LF-3a rules, AC-3.1, §8 LF-3a |
| SA-C10 | Invites guard per SQ-5: one named amendment (G-8) letting exactly `@/components/ui/dialog` into exactly `RevokeDialog.tsx`; no `@/components/ui/button` (use the shared button classes); `components/ui/sheet.tsx` and `components/ui/dialog.tsx` added to G-7's positive control, so the walk is proven to reach them. The Revoke dialog refuses to close while in flight and opens with focus on the reason field; each row's Revoke button names its invite (F-110) | LF-3a | **Applied** 2026-10-13: §3.3 Revoke row, §3.4 Invites guards (G-8), AC-3.2 |
| SA-C11 | Messages dialogs: initial focus on the non-destructive button; opening and pressing Enter does not delete; one send per confirmation; the request pins (DELETE, the PATCH fan-out, one re-read) unedited. UI short path stands | LF-3b | **Applied** 2026-10-13: §3.3 LF-3b rules, AC-3.3 |
| SA-C12 | `readJsonBody` per SQ-7: `BusinessOsPanel` only, request byte-identical, `SUMMARY_ERROR_COPY` and `ENTITLEMENT_ERROR_COPY` contract tests unedited, the panel added to `layoutFolder.guard`'s Businesses list. BD-11's last sentence is narrowed to say so | §1.2 BD-11, LF-4a.2 | **Applied** 2026-10-13: BD-11 |
| SA-C13 | LF-1: Audit trail has `text-slate-500` information text at more than the pagination line (`audit-trail/page.tsx:378`, `:515`, `:562`, `:1075`, `:1083` on 2026-10-13). AC-1.1 covers every information line the Dev lists at workplan, not only pagination. Health's QA probe (`health.qa-slice5.render`) is checked for class pins before the edit | LF-1 | **Applied** 2026-10-13: §4 table and guards, AC-1.1 |
| SA-C14 | §9 edits: Q-1 reworded per SA-C2 ("a button to reconcile top-ups for all businesses, next to the nightly billing reconcile job"); Q-2 drops "or email" and drops the "if Businesses cannot find it by id" sentence (SA settled it, V-2); Q-3 and Q-4 unchanged. §3.2: "4 of the 5 migrated table pages" lists five pages that all use the drawer; fix the count | §9, §3.2 | **Applied** 2026-10-13: §3.2 ("all 5"), Q-1 reworded, Q-2 trimmed |

### 13.4 Slices: size and path

| Slice | Size | Path | SA note |
|---|---|---|---|
| LF-1 | About 1 day | UI short path | Class-only, no money file (the Businesses line moved to LF-4b). SA-C13 |
| LF-2 | About 1 day | UI short path | No entitlements import added or removed (`AccountLookup` imports none); tiers `source.guard` stays at 7 files, above its floor of 6. Run `npm run test:bos-entitlements` anyway, since the slice touches the entitlements admin screen (skill: definition of done) |
| LF-4a.1 | 1 to 2 days | Test-only; SA reviews the pin list before merge | SA-C4, SA-C5. Green on unchanged code is the point; any red means the pin is wrong, not the code |
| LF-4a.2 | 2 to 3 days | Full cycle | Hosts every money and danger action. SA-C6, SA-C7, SA-C12 |
| LF-4b | About 2 days | Full cycle | Money UI. SA-C7 (re-read), SA-C8 |
| LF-4c | About 2 days | Full cycle | Moves a cross-account money action to another page and amends the Jobs guard. SA-C2, SA-C3 |
| LF-3a | About 2 days | **Full cycle** (SQ-4) | New pattern; the form grants plans and sends a real email. SA-C9, SA-C10 |
| LF-3b | 1 day | UI short path | Confirmation surface only; requests pinned. SA-C11 |

**Does "pin first" cover every money and danger action?** With SA-C5, yes. As written, AC-4.1 named opener, words, confirm step, URL, method, body, single send, notice and re-read, but not the request id behaviour, the paid-credits gate, the close-while-in-flight rule, the failure paths, the own-account hiding, BD-9 on a folded or unloaded lot, the danger panel's email lock, or the non-Business OS request list. Each of those is the kind of behaviour a re-parenting refactor breaks silently.

### 13.5 Findings, not conditions (BA records them in the standard's §9)

| # | Finding | Where |
|---|---|---|
| SA-F1 | The list route enriches rows with `supabase.auth.admin.listUsers()` with no paging arguments. That call returns one page (50 users by default), so past that point a row would get email "N/A" and no last sign-in, and the default "Active" filter would hide it. It also affects the strip's Last sign-in (BD-1). Verify against the production user count before relying on it; not fixed here | `app/api/admin/users/route.ts`, `enrichFromAuth` |
| SA-F2 | Businesses search does not match email on the server (V-3), though the page filters by email locally | `UserProfileRepository.listForAdmin`; `users/page.tsx:296` |
| SA-F3 | Logging: `users/page.tsx:5` and `users/useBusinessDetails.ts:20` import the server `createLogger` into client files (F-56 class). Flag per CLAUDE.md § Logging if LF-4a.2 touches either file | as cited |

### Approval

[x] Requirement approved, conditions SA-C1 to SA-C14 to be folded in by the BA before §9 goes to the user. Each slice's workplan still comes to SA for review.

[x] Conditions SA-C1 to SA-C14 applied 2026-10-13 (see the Fold-in column in §13.3); user answered §9 the same day.

---

## 14. Findings

Recorded from the SA review (§13.5); not fixed by any slice in this requirement. TL carries them into the standard's §9 findings register.

| # | Finding | Where | Action owed |
|---|---|---|---|
| SA-F1 | The Businesses list route enriches rows with `supabase.auth.admin.listUsers()` without paging arguments, so it returns only one page: 50 users by default. Past that point a row gets email "N/A" and no last sign-in, and the default "Active" filter hides it. It also affects the drawer strip's Last sign-in (BD-1) | `app/api/admin/users/route.ts`, `enrichFromAuth` | Check against the production user count before relying on the list's email and last sign-in; if the count is above 50, raise its own fix slice |
| SA-F2 | Businesses search does not match email on the server (V-3), though the page filters by email locally over rows already returned | `UserProfileRepository.listForAdmin`; `users/page.tsx:296` | Recorded; the Plans pointer line names only name, business name and account id (SA-C1) |
| SA-F3 | Logging: `users/page.tsx:5` and `users/useBusinessDetails.ts:20` import the server `createLogger` into client files (F-56 class) | as cited | Flag per CLAUDE.md § Logging if LF-4a.2 touches either file |
| SA-F1 check | Measured 2026-10-13 (TL, browser): production has 12 accounts across all statuses, well under the 50-user page, so nobody is lost today | — | Raise the fix slice before the count nears 50 |
| LF4A1-F1 | "Remove this account" has no in-flight lock: Escape closes the drawer mid-delete, the cleanup panel unmounts, and a CLEAN answer that lands afterwards never calls `onRemoved`, so the list keeps the removed account until a manual Refresh. Data is not at risk | `TestAccountCleanupPanel` | SA ruling 2026-10-13: own fix slice LF-F1 (not LF-4a.2, which moves the danger area unchanged). Preferred fix: when CLEAN arrives after unmount, call `onRemovedRef.current` directly — one file, no UX change. The slice adds the pin "close mid-delete still reads the list once" |
| LF4A1-F2 | TOPUP-3 simulates the lot fold with `hidden` because no fold exists yet | pin suite | LF-4b switches TOPUP-3 to the real fold control and asserts folded rows stay in the DOM (BD-8); a permitted pin edit beside BD-14 |
| LF4A2-F1 | The drawer strip's Credits left reuses the list's `CreditsLeftCell` unedited (SQ-9, SQ-K); its "no business" dash is `text-slate-500` (T-5). In the drawer it shows only when the reads say Business OS but the row has no business | `CreditsLeftCell.tsx` | **Closed by LF-4b** (SA SQ-6, C8): the dash is now `text-slate-400`, and the Businesses entry of the contrast guard walks `app/admin/users` |
| LF4B-F1 | **Medium.** After a successful Give or Take back the drawer re-reads the list once (BD-14). If that list read fails, the page empties the list, so the open row disappears and the drawer closes, and the success notice is lost. The credits were moved and audited, and they show when the drawer is reopened. But an admin who did not see the notice could open Give again, and a new opening mints a new request id, so the server would accept a second gift. The list's own Refresh button behaves the same way today | `app/admin/users/page.tsx` (`fetchUsers`, `fail`, `selected`) | Its own small slice: a list read after a money action that keeps the rows and the open drawer when it fails (a `page.tsx` change, outside LF-4b). Named under known limitations in the LF-4b PR body (SA C9) |
| LF4B-F2 | The hidden AD-1 "Delete…" dialog has two `text-slate-500` information lines | `app/admin/users/components/DeleteBusinessDialog.tsx:276`, `:509` | Excluded by name from the Businesses entry of the contrast guard, because the entry is hidden (`SHOW_AD1_DELETE_ENTRY = false`). The two lines go to `text-slate-400` in the slice that shows the AD-1 entry (SA C8) |
| LF4A1-F3..F5 | No request id on Set limit / Back to default / Reconcile / Remove; cleanup POSTs send no cache option; detail reads call `fetch(url)` with no options | pin suite | Pinned as today; any change is a named, deliberate pin edit |
| LF3B-F1 | No shared admin confirmation dialog exists. Eight confirmations (and now `MessagesConfirmDialog`) each live next to their screen, built from `ui/dialog` plus the `adminDialog` classes, and each repeats the in-flight lock and focus-return logic | `app/admin/**` screen-local dialogs | SA ruling 2026-10-13 (LF-3b code review): page-local is right for LF-3b; LF-3a builds its own screen-local Revoke dialog copying the LF-3b discipline. A shared `AdminConfirmDialog` (or a shared in-flight/focus-return hook) is a follow-up candidate for its own full-cycle slice after LF-3a and LF-4b land, designed against three real consumers |
| LF3B-F2 | SA O-1 / QA N-2: after Mark All Read, where focus lands depends on timing. It goes to the header button if still mounted, else the content area. In a rare partial-failure path (a PATCH that failed to the client but committed on the server), focus returns to the header button, which then unmounts after the re-read, and the A-3 rescue does not fire. Never body; not a regression against the native box | `app/admin/messages/page.tsx` focus return | Recorded, not fixed in LF-3b (Low) |

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-13 | Created (BA) | Three user follow-ups (Businesses drawer layout, Plans boxes, one open rule) plus the contrast follow-up and the 2026-10-13 browser-check record; slices LF-1 to LF-4b; four user questions; nine SA questions |
| 2026-10-13 | SA review: APPROVED WITH CONDITIONS | §13 added. Verified the BA's code claims (email search does not exist on Businesses; id search does reach past 100 rows; reconcile request adds header and cache option). Answered SQ-1 to SQ-9: reconcile is the same pass today but not by construction, so the Jobs button is "Reconcile top-ups now"; reconcile code splits out of `boostCopy` (runtime business-os import refused on Jobs); strip is a `dl`, not `KpiTile`; drawer form is a new pattern, so LF-3a is full cycle; Invites G-7 holds, a narrow G-8 admits `ui/dialog`. Conditions SA-C1 to SA-C14; drawer re-sliced into LF-4a.1, LF-4a.2, LF-4b, LF-4c; findings SA-F1 to SA-F3 |
| 2026-10-13 | SA conditions applied; user answers recorded; Approved | Folded SA-C1 to SA-C14 into the body: email removed from §2.1 and Q-2; reconcile renamed "Reconcile top-ups now (all accounts)" with reworded dialog copy, file split into `app/admin/components/jobs/` and the Jobs guard amendment (BD-6); drawer re-sliced into LF-4a.1 (pin suite, test-only), LF-4a.2, LF-4b, LF-4c with SA sizes and paths in the Progress table and §8; pin list PIN-a to PIN-k (§1.3); new rules BD-13 (non-Business OS account), BD-14 (`refreshList` after Give or Take back), BD-15 (focus return); BD-3 strip via `DrawerFields` and `CreditsLeftCell` test id; BD-11 `readJsonBody` in `BusinessOsPanel` only; LF-3a full cycle with drawer-form rules and the G-8 amendment; Messages dialog focus and Enter rules; Audit trail contrast lines; "all 5" in §3.2. Each condition marked applied in §13.3. User answers Q-1 to Q-4, all (a), recorded in §9. New §14 Findings with SA-F1 to SA-F3. Status: ready for LF-1 |
| 2026-10-13 | LF-1 built (Dev) | §1 LF-1 row: built, awaiting SA code review + QA. `text-slate-500` to `text-slate-400` on every information line listed in the workplan: Health `HealthTile.tsx` (3), Jobs & queues five client files (17, F-95's count), Audit trail `page.tsx` (8: the SA-C13 five plus the "Entity id" label and two empty-value dashes), Activity (6, F-116 Activity half per SQ-8; `Chip.tsx` untouched). No `text-slate-600` text existed in scope. Old `audit-trail/BusinessAccountPicker.tsx` left for the finance slice. `activityLayout.render` T-13 tightened from "slate-500 only on markers" to "none". New per-page guard `app/admin/__tests__/contrast.lf1.source.guard.test.ts` (walked folders) |
| 2026-10-13 | LF-1 PR opened (RM) | §1 LF-1 row: PR #338 open — fast-track (SA + QA passed). Code commit `b5939019`, `origin/main` merged in clean (`d4741aa2`); QA browser PASS, 0 elements below 4.5:1 on Health, Jobs & queues, Audit trail and Activity |
| 2026-10-13 | LF-2 built (Dev) | §1 LF-2 row: built, awaiting SA + QA. "Look up an account" removed (`AccountLookup.tsx` and `accountLookup.render.test.tsx` deleted); the SA-C1 pointer line with a `next/link` to `/admin/users` is the last line of the content; "Changing any of this" is one footnote line under the not-built panel naming every `writeOpsNotOnThisPage` operation, no doc text (V-8). Deviations from the §2.2 test-edit list: `accountLookup.contract` rendered `AccountLookup`, so it is edited (same name, same assertions; recordings render `EntitlementSnapshot` directly, refusals checked on `ENTITLEMENT_ERROR_COPY`); `layoutFolder.guard` drops the deleted path. No entitlements import added; tiers `source.guard` unedited (7 files). F-39 stays open until LF-2 merges (§2.2). AC-2.4 browser re-check owed. Results in [ADMIN_LAYOUT_LF2_WORKPLAN.md](/docs/workplans/ADMIN_LAYOUT_LF2_WORKPLAN.md) |
| 2026-10-13 | LF-2 PR opened (RM) | §1 LF-2 row: PR #339 open — fast-track (SA + QA passed). Code commit `e53e30a3`; `origin/main` already contained, nothing to merge. SA Fix Required with C-1 to C-3 applied, no second pass; TL browser QA PASS incl. AC-2.4 full-id search on Businesses (production has 12 accounts). F-39 closes on merge. PR contains #338 (LF-1) while that is open |
| 2026-10-13 | LF-4a.1 built (Dev) | §1 LF-4a.1 row: built, awaiting SA pin-list review + QA. Test-only: three new files `app/admin/users/__tests__/businessDrawer.pins.{credits,boost,dangerReads}.render.test.tsx`, 34 tests, through the whole drawer, green on the unchanged code; no product file or existing test edited. PIN-a to PIN-k mapped test by test in the workplan; 15 mutations on product files all bite, every file restored by checksum. Findings F-1 to F-5 in the workplan: F-1, closing the drawer while a Remove is in flight loses the list re-read (not pinned, a defect); F-2, there is no lot fold yet, so the folded case is simulated with `hidden` rows and LF-4b must switch to the real fold |
| 2026-10-13 | LF-4a.1 findings recorded (TL) | New progress row LF-F1 (SA ruling on LF4A1-F1: own fix slice). §14 gains the SA-F1 production count (12 accounts) and LF4A1-F1 to F5 |
| 2026-10-13 | LF-4a.1 PR opened (RM) | §1 LF-4a.1 row: PR #340 open — fast-track (SA pin review passed, fixes 1 to 4 applied; S1 and S3 now bite). Code commit `14ef6d46`, test-only; `origin/main` already contained, nothing to merge. PR contains #338 (LF-1) and #339 (LF-2) while those are open. Must merge before any drawer code change (SA-C4) |
| 2026-10-13 | LF-4a.2 workplan written (Dev) | §1 LF-4a.2 row: workplan written, awaiting SA. The panel keeps its two reads and renders the header line, summary strip and sections 1 to 3 (Credits & billing, Plan & entitlements, AI usage); `BusinessDetail` renders Account & security (three groups), Activity and the unchanged danger area. 3 product files modified (`BusinessOsPanel`, `BusinessDetail`, `BusinessAuditSection` title), 3 created (strip, folds, All products). No pin edit; deliberate edits in `businessOsPanel.render` and `businessDetail.render` (D-3, D-5, D-15a, D-20); guards strengthened. SA questions SQ-A to SQ-L in [ADMIN_LAYOUT_LF4A2_WORKPLAN.md](/docs/workplans/ADMIN_LAYOUT_LF4A2_WORKPLAN.md); no user question |
| 2026-10-13 | LF-4a.2 built (Dev) | §1 LF-4a.2 row: built, awaiting SA code review + QA. SA approved the workplan with conditions C1 to C11, applied; `origin/main` merged into the branch (`c4d62096`) and pins green on it. BD-13 ruling recorded (reads not lifted, SQ-B); LF-4b gains the D-20 exception removal (§8); §14 gains LF4A2-F1 (`CreditsLeftCell` slate-500 dash). The three pin files are byte-identical; LM1 to LM13 all bite. Results in [ADMIN_LAYOUT_LF4A2_WORKPLAN.md](/docs/workplans/ADMIN_LAYOUT_LF4A2_WORKPLAN.md) |
| 2026-10-13 | LF-4a.2 SA and QA fixes (Dev) | §1: LF-1, LF-2 and LF-4a.1 rows marked MERGED (#338, #339, #340), SA F3. LF-4a.2 row: SA code review approved with fixes; QA pass. F1 (rejected summary read test, fails under SA-M1) and F2 (wait limits in `businessOsPanel.render`) applied; details in [ADMIN_LAYOUT_LF4A2_WORKPLAN.md](/docs/workplans/ADMIN_LAYOUT_LF4A2_WORKPLAN.md) |
| 2026-10-13 | LF-4a.2 PR opened (RM) | §1 LF-4a.2 row: PR #343 open — fast-track (SA code review approved with fixes F1 to F3, applied; QA pass; TL browser check pass). Code commit `752c10c5`; `origin/main` merged in (`1cb24b12`, clean). Pins and money files unedited |
| 2026-10-13 | LF-F1 built (Dev) | §1 LF-F1 row: built, awaiting SA + QA. Fix for LF4A1-F1 per the SA ruling, one product file (`TestAccountCleanupPanel.tsx`): a `mounted` ref; a CLEAN answer that lands after unmount calls `onRemovedRef.current` directly, once; mounted paths unchanged. No request, body, confirmation or UX change; AdminDrawer untouched. Callers checked: `BusinessDetail` (locked) and `PurgeDangerZone` (/test-business-os, no `onRemoved`). New pin "close mid-delete still reads the list once" plus refused and not-CLEAN after close in `businessDrawer.closeMidDelete.render.test.tsx`; panel-level cases for both callers in `TestAccountCleanupPanel.unmountMidDelete.render.test.tsx`. LF-4a.1 pin files byte-identical; 5 mutations all bite. Results in [ADMIN_LAYOUT_LF_F1_WORKPLAN.md](/docs/workplans/ADMIN_LAYOUT_LF_F1_WORKPLAN.md) |
| 2026-10-13 | LF-F1 SA fixes (Dev) | SA approved with fixes F1 and F2; QA pass with notes, no bugs. F1: two locked-mode cases inside `React.StrictMode` added to `TestAccountCleanupPanel.unmountMidDelete.render.test.tsx` (CLEAN waits for Done, Done calls once, later unmount adds none; unmount before CLEAN calls once); SA mutation S1 bites them. F2: `closeMidDelete` header records the fourth harness copy, accepted for this slice; unused `raw` parameter dropped; one comment moved in `runDelete` (comment only). §1 LF-4b row: first step is extracting the shared pin harness to tests/admin/ (SA ruling on LF-F1); no fifth copy |
| 2026-10-13 | LF-F1 PR opened (RM) | §1 LF-F1 row: PR #347 open — fast-track (SA code review approved with fixes F1 and F2, applied; QA pass with notes, no bugs). Code commit `a200816c`; `origin/main` already contained, no merge needed. LF-4a.1 pin files unedited |
| 2026-10-13 | LF-3b built (Dev) | §1 LF-3b row: built, awaiting SA + QA. Messages Delete and Mark All Read ask in a screen-local admin dialog (`components/MessagesConfirmDialog.tsx`: `@/components/ui/dialog` with the `adminDialog` classes, no shared file added) with the native box's words; initial focus on Cancel, so Enter on open sends nothing; one send per confirmation (a ref guard plus `disabled`); no close while in flight; focus back to the opener, or the content area when the opener left. The DELETE, the PATCH fan-out and the one re-read are unedited. Messages `source.guard` amended (G-1 file list, G-2 admits `ui/dialog` into the dialog file only, new G-10: no native confirm left in `app/admin/messages`, tests included); B-10, B-11 and the layout suite's Delete and Mark All Read paths answer the dialog; new `messages.confirmDialog.render` (22 tests). 7 mutations all bite, each restored by checksum. Results in [ADMIN_LAYOUT_LF3B_WORKPLAN.md](/docs/workplans/ADMIN_LAYOUT_LF3B_WORKPLAN.md) |
| 2026-10-13 | LF-3b PR opened (RM) | §1 LF-3b row: PR #348 open — fast-track (SA code review approved, no fixes; QA PASS WITH NOTES, no bugs). Code commit `5ecfbfd6`; `origin/main` already contained, no merge needed. §14 gains LF3B-F1 (SA shared-dialog ruling) and LF3B-F2 (SA O-1 / QA N-2 focus after Mark All Read) |
| 2026-10-13 | LF-4b workplan written (Dev) | §1 LF-4b row: workplan written, awaiting SA. Branch `feature/admin-layout-lf4b` cut from `feature/admin-layout-lf4a2`. Action bars inside `credits-block` (Give) and `boost-cap` (Set limit, Back to default), so CAP-1 and CAP-2 stay unedited; lots and top-ups through the existing `ShowMoreList` (BD-8); five money-block slate-500 lines to slate-400, `CreditsLeftCell` (LF4A2-F1) pending SA; `h4`s to labels and the D-20 exception removed; BD-14 by one `onCreditsChanged` call in `CreditsBlock.handleSuccess`, wired to `refreshList`; BD-15 by a local `useReturnFocus` hook and a forwarded `onCloseAutoFocus` on `CreditFormDialog` and `BoostCapDialog`, the top-up opener carried in the take-back request (SA-C8). Permitted pin edits only: the BD-14 list counts in 11 tests (GIVE-1 to GIVE-4, TAKE-1 to TAKE-5, TOPUP-1, TOPUP-2) and TOPUP-3 on the real fold (LF4A1-F2). Reconcile untouched (LF-4c). SA questions SQ-1 to SQ-12 in [ADMIN_LAYOUT_LF4B_WORKPLAN.md](/docs/workplans/ADMIN_LAYOUT_LF4B_WORKPLAN.md); no user question |
| 2026-10-13 | LF-4b built (Dev) | §1 LF-4b row: built, awaiting SA code review + QA. SA approved the workplan with conditions C1 to C11, applied; `origin/main` merged into the branch (`4c5d9a88`) and `app/admin/users` green on it before any edit. §14: LF4A2-F1 closed (the `CreditsLeftCell` dash is slate-400); new findings LF4B-F1 (Medium: a failed list re-read after a Give or Take back closes the drawer and loses the notice, with a double-give risk; its own `page.tsx` slice) and LF4B-F2 (two slate-500 lines in the hidden AD-1 dialog, excluded by name from the contrast guard). Pin edits: the BD-14 list counts (11 tests) and TOPUP-3 on the real fold, only. Run set 49 suites / 1,541 tests, `test:bos-entitlements` 253 / 7,367; MB1 to MB21 all bite. The SA ruling to extract the pin harness into `tests/admin/` (made while reviewing LF-F1) is a separate step, not started. Results in [ADMIN_LAYOUT_LF4B_WORKPLAN.md](/docs/workplans/ADMIN_LAYOUT_LF4B_WORKPLAN.md) |
| 2026-10-13 | LF-4b PR opened (RM) | §1 LF-4b row: PR #349 open — fast-track (SA + QA passed). Commit 1 `02510dab` the money step (SA code review approved with fixes F1/F2, applied; QA pass with notes, no bugs); commit 2 `2a8db5fe` Step 12, the shared pin harness (SA approved, no fixes). `origin/main` (#346) merged in (`ccaab0bc`, clean). Pin edits Group A (BD-14 list counts) and Group B (TOPUP-3 real fold) only. LF4B-F1 (Medium) stays open as its own slice |
| 2026-10-13 | LF-5 built (Dev) | §1 LF-5 row added: Admin users page wording (user request 2026-10-13; copy approved by the user). Built on `feature/admin-layout-lf5` from `origin/main` 229a6c2e, uncommitted, awaiting SA + QA (UI short path). Purpose line, second section title, a new `text-slate-400` note line under it, and its empty sentence; tests `page.render` (ENV_HEADING, P-3, P-3b) and `adminUsersLayout.render` (A-1) edited deliberately; A-11, A-12, S-1 to S-4 unedited |
