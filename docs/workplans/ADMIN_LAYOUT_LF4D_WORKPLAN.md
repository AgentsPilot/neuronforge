# Workplan: Admin Layout LF-4d (Businesses drawer: a box and a one-line purpose per section)

> **Last Updated**: 2026-10-14

**Developer:** Dev
**Requirement:** [ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md) §1 (BD-1 to BD-15, the §1.3 hard constraints and pin rule), §14 (findings); user request 2026-10-13 (below)
**Branch:** `feature/admin-layout-lf4d`, cut from `feature/admin-layout-lf4c` at `49e2d7fd` (PR #354 open). Confirmed with `git branch --show-current` in worktree `neuronforge-admin-layout`; working tree clean before this workplan
**Path:** Full cycle (the slice touches the two money blocks' markup). SA reviews this workplan before any code
**Date:** 2026-10-14
**Status:** PR #356 open — fast-track (SA code review approved with fixes F1 and F2, applied; QA PASS WITH NOTES, no bugs). Read-only browser check owed (session expired)

## Overview

User request, 2026-10-13: every section and sub-section of the Businesses drawer gets its own box, like the summary strip (plan, credits left), and one short sentence under its title that says what the section is for. Today the sections are headings over loose content, and an admin cannot tell what each one does.

This slice is **markup and classes only**. No request, confirmation, dialog, button, figure or word that exists today changes, except the sentences added. The money blocks keep their nodes (SA C7), the five labelled groups stay exactly five (D-20), and focus return still lands on the section heading (BD-15). The pin suite is unedited, except one strengthening line in OWN-1 if SA rules the requirement allows it (SQ-4).

A first, separate step applies SA's LF-4c flake ruling to two test files.

---

## Table of Contents

1. [Analysis Summary](#analysis-summary)
2. [Implementation Approach](#implementation-approach)
3. [The section tree with test ids](#the-section-tree-with-test-ids)
4. [The copy table](#the-copy-table)
5. [The box look and contrast](#the-box-look-and-contrast)
6. [Files to Create / Modify](#files-to-create--modify)
7. [Pin impact](#pin-impact)
8. [Other existing tests at risk, and how the design keeps them green](#other-existing-tests-at-risk-and-how-the-design-keeps-them-green)
9. [Tests to add](#tests-to-add)
10. [Mutation runs planned](#mutation-runs-planned)
11. [Browser checks (read-only)](#browser-checks-read-only)
12. [Logging and entitlements](#logging-and-entitlements)
13. [Size estimate](#size-estimate)
14. [Risks](#risks)
15. [Questions for SA](#questions-for-sa)
16. [Questions for the user](#questions-for-the-user)
17. [Task List](#task-list)
18. [SA Review Notes](#sa-review-notes)
19. [QA Testing Report](#qa-testing-report)
20. [Commit Info](#commit-info)
21. [Change History](#change-history)

---

## Analysis Summary

Read on the branch at `49e2d7fd`.

| Piece | Where | Today |
|---|---|---|
| Drawer shell | `app/admin/components/layout/AdminDrawer.tsx` | `AdminDrawer` body is a `space-y-6` div. `DrawerSection` is a `div role="group" aria-labelledby` named by its `h3`, `space-y-2`, **no `className` prop**. Shared folder; S-8 refuses `<section` and region roles there |
| Summary strip | `BusinessSummaryStrip.tsx:68` | The look the user wants: `rounded-lg border border-slate-700 bg-slate-800/40 p-3` around a `dl`. No sentence |
| Panel | `BusinessOsPanel.tsx` | One root `bos-panel` (`space-y-6`): header line, strip, then three `DrawerSection`s always rendered (SA C7): `drawer-section-credits`, `drawer-section-plan`, `drawer-section-ai` |
| Credits & billing | `BusinessOsPanel.tsx:263-288` | `CreditsBlock` then `BoostBlock` in a `space-y-6` div, mounted only after both reads settle and only for a Business OS account (BD-13) |
| Credits | `CreditsBlock.tsx:342` | Root `div data-testid="credits-block" ref={rootRef}`, no class. A label `p` ("Credits", coin icon), then the action bar, notice, figures, lots |
| Top-ups and Spending limit | `BoostBlock.tsx:499`, `:371` | Root `boost-block` (no class): label "Credit top-ups", notice, test-key note, purchases, then **`CapSection` (`boost-cap`, label "Spending limit") inside the same block**, then own-account line, then the pointer line, which must stay last (T-A2) |
| Plan & entitlements | `BusinessOsPanel.tsx:294-325` | `details` with the plan summary and `EntitlementSnapshot` (which holds its own `h3`, the one D-20 exception) |
| AI usage | `BusinessOsPanel.tsx:329-422` | Three parts, labels as `p` (not headings): `bos-panel-spend`, `bos-panel-failures`, then `{allProducts}` = `AllProductsUsage` root `ai-spend-card` |
| Account & security | `BusinessDetail.tsx:245-353` | Three groups, each a `div` whose **first `p` is its label** (L-8 pins that): `account-group-account`, `account-group-signin` (`pt-2`), `plugins-card` (`pt-2`, label "Connected plugins") |
| Activity | `BusinessAuditSection.tsx` | `DrawerSection title="Activity" testId="detail-audit"`, toggle first, fold hidden never unmounted (SA M-2) |
| Danger area | `BusinessDetail.tsx:358-407` | Already a box (`rounded-xl border border-rose-500/40 bg-rose-500/5 p-6`) with an `h3` and a sentence: "Permanent actions for this account. Each runs a check first; a refused check changes nothing." Pinned: it is the drawer body's last child, and the cleanup panel is its last child (DANGER-1, L-1) |
| Focus return | `moneyBlockUi.ts:625` `focusSectionHeading` | `from.closest('[role="group"][aria-labelledby]')`, then its heading. **Any new labelled group inside a money section would capture focus** |

What the user listed, mapped to code:

| User's name | Code | Kind |
|---|---|---|
| Credits & billing | `drawer-section-credits` | section |
| Credits | `credits-block` | part |
| Top-ups | `boost-block` ("Credit top-ups") | part |
| Spending limit | `boost-cap` (inside `boost-block`) | part |
| Plan & entitlements | `drawer-section-plan` | section |
| AI usage | `drawer-section-ai` | section |
| Business OS spend | `bos-panel-spend` | part |
| Recent failures | `bos-panel-failures` | part |
| All products | `ai-spend-card` | part |
| Account & security | `drawer-section-account` | section |
| Account | `account-group-account` | part |
| Sign-in | `account-group-signin` | part |
| Plugins | `plugins-card` (label "Connected plugins", kept) | part |
| Activity | `detail-audit` | section |
| Danger area | `danger-area` | section (already boxed) |

---

## Implementation Approach

### Step 1 (first, on its own): SA's flake ruling

SA's LF-4c ruling (check 8): apply the LF-4a.2 F2 shape to `businessDetail.render.test.tsx` and `businessesLayout.render.test.tsx`. In each file: add `configure` to the existing `@testing-library/react` import, and after the imports:

```typescript
// As the pin files (SA F2 on LF-4a.2; SA ruling on LF-4c, check 8): the whole
// page under a parallel Jest run can take more than RTL's 1 s default to
// settle. Both limits are raised, so the longer wait does not just hit Jest's
// 5 s test timeout. A longer wait can only turn a pass into a fail.
jest.setTimeout(30_000);
configure({ asyncUtilTimeout: 5000 });
```

No assertion changes. **No later step touches these two files**, so RM can commit Step 1 alone by path (the user's rule: Dev leaves everything uncommitted until the diff is reviewed).

### Step 2: one local box file, no shared change

A new local file `app/admin/users/components/DrawerBox.tsx` (`'use client'`, module-level components only):

| Export | What it is |
|---|---|
| `SECTION_BOX` | `rounded-lg border border-slate-700 bg-slate-800/40 p-3`: the strip's classes, exactly |
| `PART_BOX` | `rounded-lg border border-slate-700/70 bg-slate-900/50 p-3`: one step darker than the section box, so a part reads as inside its section |
| `PURPOSE_LINE` | `text-xs text-slate-400` |
| `DRAWER_PURPOSE` | the copy table below, one key per box, `as const` |
| `DrawerBox` | `({ section, title, testId, children })`: `<div data-testid={'drawer-box-' + section} className={SECTION_BOX}><DrawerSection title={title} testId={testId}><p data-testid={'drawer-purpose-' + section} className={PURPOSE_LINE}>{DRAWER_PURPOSE[section]}</p>{children}</DrawerSection></div>` |
| `PartPurpose` | `({ part })`: `<p data-testid={'drawer-purpose-' + part} className={PURPOSE_LINE}>{DRAWER_PURPOSE[part]}</p>` |

Why a wrapper around `DrawerSection` and not a change to it: `DrawerSection` has no `className` prop, and the shared folder is used by four other drawers (AI Activity, Messages, Analytics, Audit trail). A wrapper keeps the shared folder untouched. The cost: the purpose line cannot be wired as the group's `aria-describedby` (that needs the prop). It still sits straight after the heading inside the named group, so a screen reader reads heading, then sentence. SQ-1 asks SA whether the shared prop is preferred.

Why the section-key design: the sentence and its test id come from one key, so a section cannot get another section's sentence, and the tests read `DRAWER_PURPOSE` rather than repeating the words.

**The parts are not groups.** Part boxes are plain `div`s with no role and no `aria-labelledby`, and their purpose line is a `p`, never a heading. Three things depend on it: D-20 counts exactly five `[role="group"][aria-labelledby]` and one heading per section; `focusSectionHeading` takes the closest labelled group, so a labelled part would steal focus from the section heading (BD-15, T-R2 to T-R5); L-1d M-4 is one heading per section.

### Step 3: apply the boxes

| Where | Change |
|---|---|
| `BusinessOsPanel.tsx` | The three `DrawerSection`s become `DrawerBox section="credits" / "plan" / "ai"`, same titles and test ids. The Credits & billing inner wrapper `space-y-6` becomes `space-y-3`. `bos-panel-spend` and `bos-panel-failures` get `PART_BOX` beside `space-y-2`, and a `PartPurpose` straight after their label `p` |
| `CreditsBlock.tsx` (money file) | Root `div` gains `className={PART_BOX}`; one `PartPurpose part="credits-part"` straight after the label `p`. Nothing else |
| `BoostBlock.tsx` (money file) | Root `div` gains `className={PART_BOX}`; `PartPurpose part="topups"` after the label `p`. In `CapSection`: the `boost-cap` div gains `PART_BOX` beside its classes, and `PartPurpose part="limit"` after the "Spending limit" label. The pointer stays the block's last element |
| `AllProductsUsage.tsx` | Root `ai-spend-card` gains `PART_BOX`; `PartPurpose part="ai-all"` after its label `p` |
| `BusinessDetail.tsx` | `DrawerSection title="Account & security"` becomes `DrawerBox section="account"`. The three groups gain `PART_BOX` (the `pt-2` spacers go, the section's `space-y-2` spaces them) and a `PartPurpose` straight **after** the label `p` (L-8 reads the first `p`). Danger area: **unchanged**, byte for byte |
| `BusinessAuditSection.tsx` | `DrawerSection title="Activity" testId="detail-audit"` becomes `DrawerBox section="activity"`, same title and test id. The purpose line sits between the heading and the toggle (SQ-6) |

**Spending limit stays inside Top-ups** (nested box, SQ-2). `CapSection` renders inside `boost-block`, between the purchases and the pointer line, and T-A2 pins that nothing in `boost-block` follows the pointer. Making the limit a sibling box would mean splitting the money block's `ok` branch and moving its notice, loading and error lines: a money-markup restructure, not a box. The nesting is also true to the data: the spending limit is the cap on top-up purchases.

**No remount.** Every wrapper added is unconditional within its parent (the `DrawerBox` around each section renders in every state, like the section did), and `DrawerBox` is declared at module level, never inside a render, so React sees the same component type on every render and keeps the money blocks' nodes. The C7 test proves it, unedited.

**The strip and the header line are unchanged.** The strip is the model and the user did not list it; the header line (business, login, vertical) is the drawer's title context, not a section (SQ-9).

---

## The section tree with test ids

`[S]` = section box (`SECTION_BOX`), `[P]` = part box (`PART_BOX`), `(new)` = added by this slice. Everything else exists today.

```text
users-drawer (AdminDrawer, h2 title)
  bos-panel
    bos-panel-header                       unchanged, no box
    drawer-strip                           unchanged (the model box)
    drawer-box-credits [S] (new)
      drawer-section-credits  group, h3 "Credits & billing"
        drawer-purpose-credits (new)
        bos-panel-not-bos | loading line   (non-Business OS / loading)
        div space-y-3
          credits-block [P]                label "Credits"
            drawer-purpose-credits-part (new)
            credits-actions, credits-usage, credits-extra, lots ...
          boost-block [P]                  label "Credit top-ups"
            drawer-purpose-topups (new)
            boost-notice, test-key note, purchases ...
            boost-cap [P, nested]          label "Spending limit"
              drawer-purpose-limit (new)
              boost-cap-actions, override | default, history
            boost-own-account
            boost-reconcile-pointer        stays last (T-A2, REC-0)
    drawer-box-plan [S] (new)
      drawer-section-plan  group, h3 "Plan & entitlements"
        drawer-purpose-plan (new)
        bos-panel-plan (details) | bos-plan-not-bos | bos-panel-plan-error
    drawer-box-ai [S] (new)
      drawer-section-ai  group, h3 "AI usage"
        drawer-purpose-ai (new)
        bos-panel-summary-error            (when the summary failed)
        bos-panel-spend [P]                label "Business OS, last 30 days (USD estimated)"
          drawer-purpose-ai-bos (new)
        bos-panel-failures [P]             label "Recent Business OS AI failures (last 30 days)"
          drawer-purpose-ai-failures (new)
        ai-spend-card [P]                  label "All products, token records ..."
          drawer-purpose-ai-all (new)
  drawer-box-account [S] (new)
    drawer-section-account  group, h3 "Account & security"
      drawer-purpose-account (new)
      account-group-account [P]            label "Account" (first p)
        drawer-purpose-account-account (new)
      account-group-signin [P]             label "Sign-in" (first p)
        drawer-purpose-account-signin (new)
        account-login-stats
      plugins-card [P]                     label "Connected plugins" (first p)
        drawer-purpose-account-plugins (new)
  drawer-box-activity [S] (new)
    detail-audit  group, h3 "Activity"
      drawer-purpose-activity (new)
      detail-audit-toggle, detail-audit-fold
  danger-area                              unchanged rose box, h3, existing sentence; last child
```

States: a non-Business OS login shows all five section boxes with their sentences; in AI usage only the `ai-spend-card` part; no money part. While the panel's reads run, the three panel section boxes show their sentence and the loading line. A part that fails its read shows today's error line; the part box is present wherever its root element is today (`boost-cap-error` replaces `boost-cap` and is not boxed, as today it is not the limit part).

---

## The copy table

The user sees these in the PR. Checked against what each part renders (file references in the Analysis Summary). No `$`, no figure, nothing that names a plan tier (entitlements rule: no tier name as a literal).

| Box | Sentence | Words | Checked against |
|---|---|---|---|
| Credits & billing | Credits, top-up purchases and the top-up spending limit. | 9 | Credits block, top-ups, limit. **TL copy change after the user saw the draft** (QA note 1): was "This business's credits, top-up purchases and top-up spending limit.", which reads wrong above "Not a Business OS account" for a login with no business |
| Credits | Plan allowance, credits used this period, and extra credits given or bought. | 12 | `credits-usage` (allowance, used, plan left, over the plan); lots are "Given by an admin" or "Bought" |
| Credit top-ups | Credit packages this business bought through Stripe, newest first. | 9 | purchase rows, both Stripe modes, route sends newest first |
| Spending limit | The most this business can spend on top-ups, and its changes. | 11 | default or admin limit per window, "Limit changes (latest 20)" |
| Plan & entitlements | The Business OS plan and what it includes. | 8 | tier and cohort line, capabilities in `EntitlementSnapshot`. **TL copy change after the user saw the draft** (QA note 1): was "The plan this business is on and what it includes." |
| AI usage | AI cost, calls and failures for this account over 30 days. | 11 | all three parts are 30-day figures; "account", not "business": a non-Business OS login still sees All products here (SA C1) |
| Business OS spend | Estimated cost of this business's Business OS AI calls, in USD. | 11 | `aiSpend30d` total, calls, tokens, per-area lines |
| Recent failures | Business OS AI actions that failed, newest first, with audit links. | 11 | `recentAiFailures`, "In audit trail" links |
| All products | This account's AI token use in every product, from older records. | 11 | this login's `token_usage` figures (the existing "may not match" note stays) (SA C1) |
| Account & security | Who this login is, how it signs in, and its plugins. | 11 | the three groups |
| Account | Name, user id and creation date, plus company and phone when given. | 12 | Full Name, User ID, Created, Last Updated; Company and Phone only when present (SA C1) |
| Sign-in | Email verification, sign-in methods, last sign-in, login counts and IPs. | 11 | Email Verified, Auth Providers, Last Sign In, login counts, IPs; no history list (SA C1) |
| Connected plugins | Plugins this account connected, and which of them are active. | 10 | `n/m active` and the chips with "inactive" (SA C1) |
| Activity | This account's audit events, such as sign-ins and settings changes. | 10 | audit list with Login / Security / Settings filters |
| Danger area | Permanent actions for this account. Each runs a check first; a refused check changes nothing. | 15 | **Existing sentence, kept unchanged** (SQ-5; the user may ask for a shorter one) |

---

## The box look and contrast

| Class | Value | Why |
|---|---|---|
| `SECTION_BOX` | `rounded-lg border border-slate-700 bg-slate-800/40 p-3` | The strip's classes exactly, as the user asked |
| `PART_BOX` | `rounded-lg border border-slate-700/70 bg-slate-900/50 p-3` | Darker than the section box, so a part sits visibly inside it; distinct from `MONEY_ACTION_BAR` (`p-2`, `bg-slate-900/40`), which stays inside the money parts unedited |
| `PURPOSE_LINE` | `text-xs text-slate-400` | T-5 information colour |

Contrast (WCAG relative luminance): `text-slate-400` (#94a3b8, L 0.359) on opaque `slate-800` (#1e293b, L 0.022) is **5.70:1**; on the drawer's `slate-900` it is 6.96:1. Both boxes paint between those two (slate-800 at 40 percent over slate-900; slate-900 at 50 percent over that), so every slate-400 line inside a box is between 5.7:1 and 7.0:1, above 4.5:1. Every other text colour inside the boxes (slate-200/300, white, rose-300, red-300, amber-300, blue-300) is lighter than slate-400, so its contrast is higher still. No box uses a decorative colour (L-9), and nothing adds `text-slate-500` or `-600` (contrast guard, money T-dim test).

---

## Files to Create / Modify

### Product files

| File | Action | Reason |
|---|---|---|
| `app/admin/users/components/DrawerBox.tsx` | create | `SECTION_BOX`, `PART_BOX`, `PURPOSE_LINE`, `DRAWER_PURPOSE`, `DrawerBox`, `PartPurpose`. Local, not shared |
| `app/admin/users/components/BusinessOsPanel.tsx` | modify | three sections into `DrawerBox`; two AI parts boxed with a purpose line; inner credits spacing |
| `app/admin/users/components/CreditsBlock.tsx` | modify (money file: class on root, one `p`) | Credits part box and sentence |
| `app/admin/users/components/BoostBlock.tsx` | modify (money file: class on root and on `boost-cap`, two `p`) | Top-ups and Spending limit part boxes and sentences |
| `app/admin/users/components/AllProductsUsage.tsx` | modify | All products part box and sentence |
| `app/admin/users/components/BusinessDetail.tsx` | modify | Account & security into `DrawerBox`; three groups boxed with sentences; danger area untouched |
| `app/admin/users/components/BusinessAuditSection.tsx` | modify | Activity into `DrawerBox` |

### Test and guard files

| File | Action | Reason |
|---|---|---|
| `app/admin/users/__tests__/businessDetail.render.test.tsx` | modify (Step 1 only) | SA flake ruling: `jest.setTimeout(30_000)`, `configure({ asyncUtilTimeout: 5000 })` |
| `app/admin/users/__tests__/businessesLayout.render.test.tsx` | modify (Step 1 only) | same |
| `app/admin/users/__tests__/businessDrawer.layout.render.test.tsx` | modify (additions only) | new describe "L-12: a box and a purpose line per section (LF-4d)"; no existing assertion edited |
| `app/admin/users/__tests__/drawerBox.render.test.tsx` | create | unit tests of `DrawerBox`, `PartPurpose`, `DRAWER_PURPOSE` |
| `app/admin/users/__tests__/source.guard.test.ts` | modify (addition) | `DrawerBox.tsx` joins `SCREEN_FILES` and the no-fetch list (it reads nothing) |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` | modify (addition) | `DrawerBox.tsx` joins the Businesses file list (alias imports, no own `h1`, no `.json(`) |
| `app/admin/users/__tests__/businessDrawer.pins.credits.render.test.tsx` | modify **only if SA allows (SQ-4)** | OWN-1 name list gains `Reconcile top-ups now (all accounts)` (LF-4c QA note 1) |

### Docs

| File | Action |
|---|---|
| `docs/workplans/ADMIN_LAYOUT_LF4D_WORKPLAN.md` | this file |
| `docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md` | §1 LF-4d row and Change History (done with this workplan); a BD-16 rule and, if SA allows, the OWN-1 permission, after SA |

### Not touched

`app/admin/components/layout/**` (shared, including `AdminDrawer.tsx` and `DrawerSection`), `BusinessSummaryStrip.tsx`, `CreditFormDialog.tsx`, `BoostCapDialog.tsx`, `DeleteBusinessDialog.tsx`, `TestAccountCleanupPanel.tsx`, `moneyBlockUi.ts`, `drawerFolds.tsx`, every route, every copy file (`creditCopy.ts`, `boostCopy.ts`), `page.tsx`, `useBusinessDetails.ts`, the pin harness `tests/admin/drawerPinHarness.ts`, `businessDrawer.pins.boost` and `businessDrawer.pins.dangerReads`.

---

## Pin impact

All three pin files run through the whole drawer and find things by test id, role and name, never by box structure. Pin by pin:

| Pin family | What it reads | Effect of this slice |
|---|---|---|
| GIVE-1 to GIVE-5 | `credits-give`, the dialog, requests, `credits-success` lines (`p` inside the notice), read counts | None. The purpose `p` is outside the notice; no request added |
| TAKE-1 to TAKE-5 | `credits-take-back` inside `credits-lot`, dialog, requests | None |
| TOPUP-1 to TOPUP-5 | `boost-take-back`, `-above`, `-none`, lots in the fold | None |
| CAP-1 to CAP-5 | `boost-cap-actions` inside `boost-cap`, the buttons, requests | None. `boost-cap` keeps its test id and its bar; the bar's class is not touched |
| REC-0 | no reconcile button; `boost-reconcile-pointer` inside `boost-block`, exact text and link | None. The pointer stays last; its words are untouched |
| OWN-1 | zero money buttons by test id and by name; the two own-account sentences; lots and limit still shown | None. Optional strengthening, SQ-4 |
| READS-1 to READS-4 | the requests one opening sends | None. No request added; the slice adds no read |
| DANGER-1 to DANGER-n | `danger-area` is the body's last child; the cleanup panel is the danger area's last child; the panel's requests | None. The danger area is not edited, and the boxes around Account & security and Activity sit before it |

**No pin breaks.** The OWN-1 addition is not needed for green; it is QA's LF-4c note, and §1.3 lets only LF-4a.2, LF-4b and LF-4c edit pins (and only for named reasons). So it is listed for SA (SQ-4), not planned as a default.

---

## Other existing tests at risk, and how the design keeps them green

None of these is edited.

| Test | What it asserts | Why it stays green |
|---|---|---|
| `businessDetail.render` D-20 | exactly five `[role="group"][aria-labelledby]`; one heading per section (Plan has the snapshot's); none in the money blocks | part boxes have no role; purpose lines are `p`; no heading added |
| `businessDrawer.layout` L-1 | order strip, five groups, danger; `danger.parentElement.lastElementChild === danger`; each group's `h3` is its label | groups keep test ids and titles; the danger area stays the body's last child |
| L-8 | in each account group the first `p` is its label; `dt` lists; one heading | the purpose `p` comes after the label `p` |
| L-9 | no decorative colour outside the money blocks and danger | slate only |
| L-10 / SA C7 | the panel, `credits-block` and `boost-block` keep their nodes over folds and a list Refresh | wrappers unconditional, `DrawerBox` at module level |
| `businessDrawer.money` T-A1, T-A2 | bar classes exact; order bar, figures; nothing after the pointer in `boost-block`; no heading in the blocks | bars untouched; purpose lines before the bars; pointer last |
| T-R2 to T-R5 (BD-15) | focus returns to the opener, else to the section heading | `focusSectionHeading` still finds the section group: parts are not groups |
| money T-dim | no `text-slate-500/600` in the blocks | slate-400 only |
| `contrast.lf1.source.guard` | no slate-500/600 text in `app/admin/users` | same |
| `source.guard` | danger-area position, CreditsBlock placement regex (`<CreditsBlock accountId=... businessLabel=...`), panel `<details>` around `EntitlementSnapshot` | the JSX of those lines is unchanged |
| `creditsBlock.render`, `boostBlock.render`, `boostBlock.actions.render`, `businessOsPanel.render` | blocks or panel alone; exact texts by test id | no existing text changes; the new sentences match no existing exact string, none contains `$`, "Reading", "Email Verified" or "Auth Provider" |

---

## Tests to add

### `drawerBox.render.test.tsx` (new, unit)

| # | Test |
|---|---|
| DB-1 | `DrawerBox` renders `drawer-box-<key>` with exactly `SECTION_BOX`; its only child is the `role="group"` named by the `h3`; the heading's next sibling is `drawer-purpose-<key>` with `DRAWER_PURPOSE[key]` and class `text-xs text-slate-400` |
| DB-2 | `PartPurpose` renders one `p`, the key's sentence, `PURPOSE_LINE`; no role, no heading |
| DB-3 | every `DRAWER_PURPOSE` sentence: 1 to 12 words, ends with a full stop, no `$`; keys are unique and match the 14 boxes listed |
| DB-4 | `SECTION_BOX` equals the rendered `drawer-strip`'s `className` (`BusinessSummaryStrip` rendered, not its source parsed; SA SQ-9 suggestion), so the boxes cannot drift from the model |

### `businessDrawer.layout.render.test.tsx`, new describe L-12 (whole page, the file's existing route table)

| # | Test |
|---|---|
| L-12a | Business OS account (Dana): the five section boxes exist, each with `SECTION_BOX`, each directly wrapping its named group (Credits & billing, Plan & entitlements, AI usage, Account & security, Activity), in order, then the unchanged danger area last |
| L-12b | each section's sentence is the element straight after its `h3`, with its own exact sentence (a table of title to key, so a swap fails) |
| L-12c | each of the nine parts (`credits-block`, `boost-block`, `boost-cap`, `bos-panel-spend`, `bos-panel-failures`, `ai-spend-card`, `account-group-account`, `account-group-signin`, `plugins-card`) has `PART_BOX` and holds exactly one purpose line whose closest part box is itself, its own, after the part's label. For `boost-block` that is `drawer-purpose-topups`; `drawer-purpose-limit` is asserted inside `boost-cap` (SA C3) |
| L-12d | `boost-cap` sits inside `boost-block`; the pointer is still `boost-block`'s last element |
| L-12e | parts are not groups: the drawer has exactly five `[role="group"]`, and no purpose line is a heading |
| L-12f | non-Business OS login (Oren): five section boxes with their sentences; in AI usage only the All products part and its sentence; no money part box |
| L-12g | the danger area keeps its rose classes and its existing sentence, exact |
| L-12h | while the summary read is held: the three panel section boxes and their sentences are shown with the loading lines (sentences do not wait for reads) |

C7 and T-R are existing tests that already prove "no remount" and "focus to the section heading"; they run unedited.

---

## Mutation runs planned

Each applied to product code, the named tests run, the file restored by SHA-256.

| # | Mutation | Must fail |
|---|---|---|
| MD1 | `SECTION_BOX` drops `border` | L-12a, DB-1, DB-4 |
| MD2 | `DrawerBox` drops the purpose `p` | L-12b, DB-1 |
| MD3 | two `DRAWER_PURPOSE` values swapped (credits and plan) | L-12b |
| MD4 | `CreditsBlock` purpose line removed | L-12c |
| MD5 | a part box gets `role="group" aria-labelledby` to its label | D-20, L-12e, T-R4 |
| MD6 | `DrawerBox` declared inside `BusinessOsPanel`'s render | SA C7 (L-10) |
| MD7 | an account group's purpose line moved before its label | L-8 |
| MD8 | the Top-ups purpose line moved after the pointer | T-A2, L-12d |
| MD9 | `PURPOSE_LINE` uses `text-slate-500` | contrast guard, money T-dim |
| MD10 | the purpose line rendered as an `h4` | D-20, L-12e |
| MD11 | the account section rendered with a plain `DrawerSection` (box lost) | L-12a |
| MD12 | a sentence lengthened to 13 words | DB-3 |
| MD13 | the danger area wrapped in a `DrawerBox` | L-1, DANGER-1, L-12g |
| MD14 | the AI usage box rendered only when not loading | L-12h |

---

## Browser checks (read-only)

On the preview or local build, signed in as admin. **Never press** Give credits, Take back, Take back credits, Set limit, Back to default, Check or Delete. Folds and Show more may be toggled (they send nothing).

| # | Check |
|---|---|
| QB-1 | Open a Business OS business: strip, then five boxes in order, then the danger area last; each box has its sentence under its title |
| QB-2 | Credits & billing: Credits and Credit top-ups are boxes inside it; Spending limit is a box inside Top-ups; the action bars still read as bars, not as another box |
| QB-3 | AI usage: three part boxes; All products folded as before |
| QB-4 | Account & security: three part boxes, labels then sentences |
| QB-5 | A login with no Business OS business: five boxes, the not-Business-OS lines, All products only |
| QB-6 | Your own account: no money buttons, both own-account sentences, boxes present |
| QB-7 | Contrast: a script in the console lists computed foreground and painted background for every `drawer-purpose-*` and reports any element below 4.5:1 (expect none) |
| QB-8 | Narrow window (drawer full width): boxes do not overflow; long ids still wrap |
| QB-9 | Give credits opened and closed with Escape only (no submit): focus returns to the button (BD-15 unchanged) |

---

## Logging and entitlements

No logger call is added or changed; no file touched uses `console.*` (the users `source.guard` checks). `DrawerBox.tsx` imports nothing from `lib/business-os/entitlements/`, and no touched file gains such an import or a tier literal; `npm run test:bos-entitlements` runs in the hand-over set anyway, because the run set includes the Plans snapshot through the panel.

### Run set before handover

- `npm test -- app/admin/users app/admin/components/layout app/admin/__tests__/contrast.lf1.source.guard.test.ts`
- the three pin files, twice, and once each at `--maxWorkers=4` after the OWN-1 line is in (SA C7)
- `git diff --numstat` on the three pin files: `0 0` for boost and dangerReads, `1 0` for credits (SA C5)
- `npm run test:bos-entitlements`
- `npx tsc --noEmit -p .` reported clean for the touched files, with a planted canary type error to prove the scoped filter sees them (SA C7; ts-jest does not type-check here)
- MD6 must fail L-10 (SA C4); its failure output goes into the Implementation Notes. If it survives: stop and report
- `npm run lint:hooks`

---

## Size estimate

| Part | Lines (approx) |
|---|---|
| Step 1 (two test files) | +12 |
| `DrawerBox.tsx` | +75 |
| Six product edits | +45 / -20 |
| New tests (`drawerBox.render`, L-12) | +230 |
| Guard additions | +4 |
| Docs | requirement row, BD-16, change history |

Small: about half a day to build, plus mutations and the browser pass. One PR, two commits (Step 1, then the rest).

---

## Risks

| Risk | Mitigation |
|---|---|
| A wrapper remounts the money blocks (lost dialog state, extra reads) | unconditional wrappers, module-level components; C7 and READS pins unedited; MD6, MD14 |
| A part box becomes a labelled group and steals focus or breaks D-20 | parts are plain `div`s; MD5, MD10 |
| Nested Top-ups and Spending limit boxes look heavy | `PART_BOX` used for both with a border only step; QB-2; SQ-2 offers the alternative |
| Sentences go stale when a section changes | one `DRAWER_PURPOSE` source; L-12b and L-12c assert each by key |
| More vertical space in a long drawer | `p-3` and `text-xs` sentences; the folds stay closed by default |

---

## Questions for SA

| # | Question | Dev recommendation |
|---|---|---|
| SQ-1 | Local wrapper (`DrawerBox` around `DrawerSection`, no shared change) or a shared change: `DrawerSection` gains optional `className` and `description` props, the description wired as the group's `aria-describedby`? The shared change is better for screen readers and avoids one wrapper `div`, but changes a component four other drawers use | Local wrapper now; the shared prop can follow when a second screen wants it |
| SQ-2 | Spending limit as a box nested inside Top-ups (markup stays in place) or as a sibling box (splits `BoostBlock`'s `ok` branch and moves its notice, loading and error lines)? | Nested: smaller money diff, T-A2 order kept, and true to the data |
| SQ-3 | The two money files (`CreditsBlock`, `BoostBlock`) get a class on their root and on `boost-cap`, one purpose `p` each (two in `BoostBlock`) and an import from `./DrawerBox`. Is that within "markup and classes only" for a money file? | Yes: no handler, state, request or existing text changes |
| SQ-4 | OWN-1: add `Reconcile top-ups now (all accounts)` to its button-name list (LF-4c QA note 1). §1.3 lets only LF-4a.2, LF-4b and LF-4c edit pins. May LF-4d make this one strengthening addition, named in the PR, with the requirement amended to say so? | Yes, as a named addition (it only adds a check) |
| SQ-5 | Danger area: keep its existing 15-word sentence unchanged (no touch to the danger markup), or shorten it to fit the 12-word rule? | Keep: zero change to the danger area; the user can ask for a shorter one |
| SQ-6 | Activity: the purpose line now sits between the heading and the toggle, so the toggle is no longer the first thing after the heading (L-4b SA Q-7). Acceptable? | Yes: the toggle stays the first control |
| SQ-7 | New whole-page tests go in `businessDrawer.layout.render` (its route table, SQ-F precedent: not the pin harness). Agreed? | Yes |
| SQ-8 | Guard additions: `DrawerBox.tsx` joins `source.guard` (`SCREEN_FILES`, no-fetch list) and `layoutFolder.guard`'s Businesses list | Yes |
| SQ-9 | The strip and the header line stay as they are, with no sentence (the user did not list them). Should the strip import `SECTION_BOX` instead of repeating the string? DB-4 already pins that they match | Leave the strip file untouched; DB-4 holds them equal |
| SQ-10 | A requirement rule BD-16 for this slice: "each section and part is a box with one purpose sentence; parts are never labelled groups or headings; the danger area keeps its own box and sentence". Add it? | Yes, after SA |

---

## Questions for the user

Only the copy table above. Please glance at the sentences: each is under 12 words and says what the box is for. Any you would word differently? The danger area keeps today's sentence unless you want a shorter one.

---

## Task List

- ✅ Step 0 (SA C6, before the pin edit): requirement §1.3 amended for the OWN-1 addition; BD-16 added with SA's extra clause
- ✅ Step 1: SA flake ruling: `jest.setTimeout(30_000)` and `configure({ asyncUtilTimeout: 5000 })` in `businessDetail.render.test.tsx` and `businessesLayout.render.test.tsx`; uncommitted, path-separable for RM (no later step touches the two files)
- ✅ Step 2: create `DrawerBox.tsx` and `drawerBox.render.test.tsx` (DB-1 to DB-5)
- ✅ Step 3: `BusinessOsPanel.tsx`: three `DrawerBox` sections; AI parts boxed with sentences; credits spacing
- ✅ Step 4: `CreditsBlock.tsx`, `BoostBlock.tsx`: part classes and sentences only (C2)
- ✅ Step 5: `AllProductsUsage.tsx`: part class and sentence
- ✅ Step 6: `BusinessDetail.tsx` (Account & security and its groups) and `BusinessAuditSection.tsx` (Activity)
- ✅ Step 7: L-12a to L-12h in `businessDrawer.layout.render`; guard additions
- ✅ Step 8: OWN-1 addition (SQ-4, after C6)
- ✅ Step 9: run set; pin numstat; MD1 to MD14 (see Implementation Notes; MD6 now also bites the SA F1 source guard in about 3 s)
- ✅ Step 10: requirement row and Change History; implementation notes here

## SA conditions applied

| # | Applied |
|---|---|
| C1 | Five sentences replaced word for word in the copy table and in `DRAWER_PURPOSE`; DB-5 pins all 14 sentences literally |
| C2 | Money-file diffs limited to the import, the root class, `PART_BOX` appended to `boost-cap`, and the `PartPurpose` elements; full diffs below |
| C3 | L-12c asserts one purpose line whose closest part is itself; the limit line is asserted inside `boost-cap` (L-12d too) |
| C4 | MD6 run; result below. SA ruling (code review): the runaway loop alone is not an acceptable signal, so SA F1 adds a source guard; MD6 now fails that guard in about 3 s with the offending file named, and L-10 stays as the behavioural proof |
| C5 | `git diff --numstat`: pins.credits `1 0`; pins.boost and pins.dangerReads absent (byte-identical) |
| C6 | §1.3 sentence and BD-16 added before the OWN-1 line was written |
| C7 | Run set below, including the three pin files at `--maxWorkers=4` after the OWN-1 line, and scoped `tsc` with a canary |

---

## SA Review Notes

### SA Review (workplan)

**Reviewed by SA — 2026-10-14**
**Status:** APPROVED WITH CONDITIONS (C1 to C7 below). Dev may start Step 1 now and Step 2 onward once C1 (the copy) is applied to the copy table.

Read on `feature/admin-layout-lf4d` at `49e2d7fd` (working tree: only this workplan and the requirement's LF-4d row). Every claim below was checked against the code, not the workplan.

#### Checks

| # | Check | Finding |
|---|---|---|
| 1 | Money and danger byte-identical; C7 node identity | Holds. `CreditsBlock` root (`:342`) and `BoostBlock` root (`:499`) gain a class only; `CapSection`'s `boost-cap` (`:371`) gains classes beside `space-y-1 text-sm text-slate-300`; the `PartPurpose` elements are unconditional siblings after the label `p`, so no existing child changes position by condition and no element type changes at runtime. No opener, handler, dialog, request or copy constant is touched. `BoostCapDialog` is portalled, so it is not a DOM node after the pointer. Danger area (`BusinessDetail.tsx:224-275`) untouched. C7 holds provided `DrawerBox` is module-level (C4) |
| 2 | Pins unedited and green | Walked. T-A2 compares document position inside `boost-block`; the limit sentence sits inside `boost-cap`, before the pointer, so nothing follows it. D-20 counts `[role="group"][aria-labelledby]` and reads each one's `h3`: part boxes have no role, purpose lines are `p`. L-8 reads `querySelector('p')` per group: the label stays first. `focusSectionHeading` (`moneyBlockUi.ts:30`) takes `closest('[role="group"][aria-labelledby]')`: no new labelled ancestor is added between a money opener and its section. L-1 and DANGER-1 use `danger.parentElement.lastElementChild`: the new boxes wrap Account and Activity only, before the danger area. No test pins `credits-block`'s or `boost-cap`'s class string, the inner `space-y-6`, or the `pt-2` spacers (grepped). T-A1's `expectInOrder([bar, usage, extra])` is unaffected by a `p` before the bar |
| 3 | Copy accuracy | Five sentences overclaim or mislead; corrected in C1 |
| 4 | Contrast | Verified: slate-400 L 0.359; slate-800 L 0.022 gives 5.70:1; the drawer is `bg-slate-900` (`AdminDrawer.tsx:37`), 6.9:1. Both box shades, and the nested limit box (slate-900/50 over slate-900/50 over the section), composite between those two, so every slate-400 line is at least 5.7:1. Borders are grouping decoration, not a UI component state, so WCAG 1.4.11 does not bind |
| 5 | Step 1 separable by path | Yes. Both files import from `@testing-library/react` today and no later step touches them; the change is config only |
| 6 | SQ rulings | Below |
| 7 | Mutations and browser checks | Adequate with C3 and C4. QB-1 to QB-9 are read-only; QB-9 opens a dialog and closes it with Escape only, which sends nothing. Keep it so |
| 8 | Size | About +370 lines, two thirds tests. One PR, two commits. Proportionate |

#### Conditions

1. **C1 Copy corrections (apply to the copy table and `DRAWER_PURPOSE` verbatim before the user sees it):**
   - **Account:** "Name, user id and creation date, plus company and phone when given." (12 words). Reason: Company and Phone render only when present (`BusinessDetail.tsx:116-117`), and the field is labelled "User ID", not account id.
   - **Sign-in:** "Email verification, sign-in methods, last sign-in, login counts and IPs." (11 words). Reason: there is no login history list; the group shows Last Sign In plus counts and IPs (`:150-169`).
   - **All products:** "This account's AI token use in every product, from older records." (11 words). Reason: the Dev's wording reads as platform-wide; the figures are this login's `token_usage`.
   - **Connected plugins:** "Plugins this account connected, and which of them are active." (10 words). Reason: "Outside apps" is a claim the card does not make or verify; it lists plugin connections and the `n/m active` line.
   - **AI usage:** "AI cost, calls and failures for this account over 30 days." (11 words). Reason: a non-Business OS login has no business but still sees the All products part in this section.
   - All other sentences are accurate as written: Credits & billing, Credits, Credit top-ups, Spending limit, Plan & entitlements, Business OS spend, Recent failures, Account & security, Activity.
2. **C2 Money-file diff scope.** In `CreditsBlock.tsx` and `BoostBlock.tsx` the diff is exactly: one import line from `./DrawerBox`, `className={PART_BOX}` on the root `div`, `PART_BOX` appended to `boost-cap`'s existing class string (existing classes kept), and the `PartPurpose` elements. Paste `git diff --stat` and the two files' full diffs into the implementation notes. Any other line in either file is a stop and report.
3. **C3 L-12c nested count.** `boost-block` contains `boost-cap`, so "exactly one purpose line" is false for Top-ups as written. Define it as: each part holds exactly one purpose line whose closest part box is itself; for `boost-block` that is `drawer-purpose-topups`, and `drawer-purpose-limit` is asserted inside `boost-cap`.
4. **C4 MD6 must bite.** Show the C7 (L-10) failure output for MD6. If the list Refresh does not re-render `BusinessOsPanel` and MD6 survives, stop and report rather than adding a new trigger on your own.
5. **C5 Pin files.** `businessDrawer.pins.boost` and `businessDrawer.pins.dangerReads` byte-identical; `businessDrawer.pins.credits` byte-identical except the one OWN-1 name allowed under SQ-4. Prove with `git diff --numstat` on all three (expect `1 0` or `0 0` for credits, `0 0` for the other two, never a deletion).
6. **C6 Requirement amendment before the pin edit.** Add to §1.3, after the sentence naming LF-4a.2, LF-4b and LF-4c: "LF-4d may add one name, `Reconcile top-ups now (all accounts)`, to OWN-1's button-name list (LF-4c QA note 1); an addition only, no existing pin line changes." Add BD-16 as worded in SQ-10, plus: "a part box is never a labelled group, so focus return still lands on the section heading (BD-15)."
7. **C7 Run set.** As listed, plus the three pin files once each at `--maxWorkers=4` after the OWN-1 line is in, and `npx tsc --noEmit -p .` reported clean for the touched files.

#### SQ rulings

| # | Ruling |
|---|---|
| SQ-1 | Local wrapper approved. No change to the shared `DrawerSection`. The purpose line sits straight after the heading inside the named group, so reading order is right without `aria-describedby`. Revisit the shared prop only when a second screen wants it |
| SQ-2 | Nested approved. A sibling box would restructure the money block's `ok` branch, which this slice must not do; the nesting matches the data |
| SQ-3 | Yes, within "markup and classes only", bounded by C2 |
| SQ-4 | Allowed, on C6: the requirement is amended first, the line is an addition only, it lands in the second commit, and the PR body names it. It strengthens OWN-1 against the renamed button and changes no request or confirmation |
| SQ-5 | Keep the existing 15-word danger sentence, byte for byte. The 12-word limit is this workplan's own rule for new sentences (DB-3), not a requirement, and the danger area is a §1.3 hard-constraint zone. The user may ask for a shorter one; that would be its own change |
| SQ-6 | Accepted. The toggle stays the section's first control; the sentence is text, not a control, so L-4b SA Q-7's intent holds. No test pins the toggle as the heading's next sibling (checked) |
| SQ-7 | Agreed: `businessDrawer.layout.render`, not the pin harness |
| SQ-8 | Agreed. Use the import style the touched file already uses (`./drawerFolds` precedent for same-folder imports) |
| SQ-9 | Leave the strip file untouched. Suggestion: make DB-4 render `BusinessSummaryStrip` and compare `drawer-strip`'s `className` rather than parsing source, which is sturdier |
| SQ-10 | Add BD-16, with C6's extra clause |

#### Optimisation suggestions (not blocking)

- The Spending limit label (`text-slate-400`, `:372`) and its purpose line (`text-xs text-slate-400`) will look close in weight. Leave the label alone in this slice (money file); note it for the user at QB-2.
- The danger area keeps `rounded-xl p-6` and `text-sm` for its sentence while the new boxes use `rounded-lg p-3` and `text-xs`. Correct for this slice (untouched); mention it to the user in case they want them aligned later.

### Approval
[x] Workplan approved with conditions C1 to C7 — proceed to implementation

---

## Implementation Notes

Built 2026-10-14 in worktree `neuronforge-admin-layout`, branch `feature/admin-layout-lf4d` (base `49e2d7fd`). Everything is uncommitted.

### Files

| File | Change |
|---|---|
| `app/admin/users/components/DrawerBox.tsx` | new: `SECTION_BOX`, `PART_BOX`, `PURPOSE_LINE`, `DRAWER_PURPOSE` (C1 wording), `DrawerBox`, `PartPurpose`; module-level components only |
| `app/admin/users/components/BusinessOsPanel.tsx` | three sections into `DrawerBox`; `bos-panel-spend` and `bos-panel-failures` get `PART_BOX` and a purpose line; credits inner `space-y-6` to `space-y-3`; `DrawerSection` import dropped |
| `app/admin/users/components/CreditsBlock.tsx` | money file, C2 scope (diff below) |
| `app/admin/users/components/BoostBlock.tsx` | money file, C2 scope (diff below) |
| `app/admin/users/components/AllProductsUsage.tsx` | `ai-spend-card` gets `PART_BOX` and its purpose line |
| `app/admin/users/components/BusinessDetail.tsx` | Account & security into `DrawerBox`; three groups get `PART_BOX` (the `pt-2` spacers go) and a purpose line after the label; danger area untouched |
| `app/admin/users/components/BusinessAuditSection.tsx` | Activity into `DrawerBox` |
| `app/admin/users/__tests__/businessDetail.render.test.tsx` | Step 1 only |
| `app/admin/users/__tests__/businessesLayout.render.test.tsx` | Step 1 only |
| `app/admin/users/__tests__/drawerBox.render.test.tsx` | new: DB-1 to DB-5 (20 tests) |
| `app/admin/users/__tests__/businessDrawer.layout.render.test.tsx` | additions only: L-12a to L-12h |
| `app/admin/users/__tests__/businessOsPanel.render.test.tsx` | **deliberate edit, not in the workplan** (see Deviations): P-3 |
| `app/admin/users/__tests__/source.guard.test.ts` | `DrawerBox.tsx` joins `SCREEN_FILES`; new "no fetch, no state" case |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` | `DrawerBox.tsx` joins the Businesses list |
| `app/admin/users/__tests__/businessDrawer.pins.credits.render.test.tsx` | OWN-1: one added line (SQ-4, C6) |

### Money-file diffs (C2)

**File:** `app/admin/users/components/CreditsBlock.tsx`

```diff
@@ -49,6 +49,7 @@
 import { CreditFormDialog, type CreditFormMode } from './CreditFormDialog';
 import { ShowMoreList } from './drawerFolds';
 import { MONEY_ACTION_BAR, useReturnFocus } from './moneyBlockUi';
+import { PART_BOX, PartPurpose } from './DrawerBox';
@@ -339,12 +340,13 @@
   return (
-    <div data-testid="credits-block" ref={rootRef}>
+    <div data-testid="credits-block" ref={rootRef} className={PART_BOX}>
       {/* A label, not a heading: the section's h3 is its only heading (D-20, LF-4b). */}
       <p className="flex items-center gap-2 text-sm font-semibold text-slate-300">
         <Coins className="h-4 w-4 text-amber-300" aria-hidden="true" />
         {CREDIT_COPY.heading}
       </p>
+      <PartPurpose part="credits-part" />
```

**File:** `app/admin/users/components/BoostBlock.tsx`

```diff
@@ -62,6 +62,7 @@
 import { ShowMoreList } from './drawerFolds';
 import { MONEY_ACTION_BAR, useReturnFocus } from './moneyBlockUi';
+import { PART_BOX, PartPurpose } from './DrawerBox';
@@ -368,8 +369,9 @@ function CapSection({
   return (
-    <div data-testid="boost-cap" className="space-y-1 text-sm text-slate-300">
+    <div data-testid="boost-cap" className={`space-y-1 text-sm text-slate-300 ${PART_BOX}`}>
       <p className="text-slate-400">{BOOST_BLOCK_COPY.limitHeading}</p>
+      <PartPurpose part="limit" />
@@ -496,12 +498,13 @@ export function BoostBlock(...)
   return (
-    <div data-testid="boost-block" ref={rootRef}>
+    <div data-testid="boost-block" ref={rootRef} className={PART_BOX}>
       {/* A label, not a heading: the section's h3 is its only heading (D-20, LF-4b). */}
       <p className="flex items-center gap-2 text-sm font-semibold text-slate-300">
         <Receipt className="h-4 w-4 text-sky-300" aria-hidden="true" />
         {BOOST_BLOCK_COPY.heading}
       </p>
+      <PartPurpose part="topups" />
```

`git diff --stat`: `CreditsBlock.tsx | 4 +-`, `BoostBlock.tsx | 7 +-`. Nothing outside the C2 list.

### Pin files (C5)

```text
1	0	app/admin/users/__tests__/businessDrawer.pins.credits.render.test.tsx
```

`businessDrawer.pins.boost` and `businessDrawer.pins.dangerReads` do not appear in `git diff` (byte-identical). The OWN-1 line is added after the existing name loop, so no existing line changes: `expect(within(drawer).queryByRole('button', { name: 'Reconcile top-ups now (all accounts)' })).toBeNull();`

### Verification (C7)

| Run | Result |
|---|---|
| Step 1 files alone (`businessDetail.render`, `businessesLayout.render`) | 2 suites, 59 tests, pass |
| `npx jest app/admin/users app/admin/components/layout app/admin/__tests__/contrast.lf1.source.guard.test.ts` | 42 suites, 1,255 tests, pass (run twice; first full pass 1,254 before DB-5 was added) |
| The three pin files, twice | 3 suites, 32 tests, pass both times |
| Each pin file at `--maxWorkers=4`, after the OWN-1 line | credits 11, boost 12, dangerReads 9: pass |
| `npm run test:bos-entitlements` | 255 suites, 7,398 tests, pass |
| `npm run lint:hooks` | clean |
| `npx tsc --noEmit -p .` (8 GB heap; the default heap runs out) | canary `export const TSC_CANARY_LF4D: number = 'canary'` in `DrawerBox.tsx` reported as `DrawerBox.tsx(52,14): error TS2322`; with the canary removed (SHA-256 checked) no error in `app/admin/users/` or `app/admin/components/layout/`. 1,917 errors elsewhere in the repo, none in touched files |

### Mutation runs

Every product file restored by SHA-256 after each run (all seven OK at the end).

| # | Mutation | Bit |
|---|---|---|
| MD1 | `SECTION_BOX` drops `border` | DB-4 only. L-12a and DB-1 compare against the constant, so they move with it; DB-4 (the rendered strip) is the anchor |
| MD2 | `DrawerBox` drops the purpose line | DB-1, L-12b, L-12e, L-12f, L-12h |
| MD3 | `credits` and `plan` sentences swapped in `DRAWER_PURPOSE` | DB-5 (added for this: the constant-based tests cannot see a swap inside the constant) |
| MD3b | the Plan box given `section="activity"` | L-12a, L-12b, L-12f, L-12h |
| MD4 | `CreditsBlock` purpose line removed | L-12c, L-12e |
| MD5 | `boost-cap` made `role="group"` labelled by its label | D-20, L-12e. T-R4 did **not** bite: after a Set limit success the re-read unmounts `boost-cap`, so focus resolves from the block root to the section group anyway |
| MD6 | `DrawerBox` declared inside `BusinessOsPanel`'s render | **L-10 fails, but not on the C7 assertion.** Every panel render makes a new component type, so the money blocks remount, re-read, report their lots, re-render the panel and remount again: an endless read loop. `quiet()` never settles and the Jest worker dies after about 209 s with `FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory`. No assertion message is printed. **SA ruling:** not acceptable as the only signal; F1 added (below). **Re-run after F1:** `source.guard` fails in 3.2 s (13 s wall clock including Jest start-up) on "the box components are declared once, at module level, in DrawerBox.tsx, and the drawer imports them from there", received `declaresDrawerBoxOrPartPurpose: ["app/admin/users/components/BusinessOsPanel.tsx"]`. File restored, all seven product checksums OK |
| MD7 | Sign-in purpose line moved before its label | L-8, L-12c |
| MD8 | Top-ups purpose line moved after the pointer | T-A2, L-12d |
| MD9 | `PURPOSE_LINE` uses `text-slate-500` | contrast guard (`DrawerBox.tsx`), money T-C1, DB-3 |
| MD10 | purpose line rendered as `h4` | D-20, L-12e |
| MD11 | Account & security rendered with a plain `DrawerSection` | L-12a, L-12b, L-12e, L-12f |
| MD12 | limit sentence lengthened to 13 words | DB-3, DB-5 |
| MD13 | danger area wrapped in a box | L-12g only. L-1 and DANGER-1 still pass, because the wrapper's last child is the danger area |
| MD14 | AI usage box rendered only when not loading | L-12h |

### Deviations from the workplan

1. **`businessOsPanel.render` P-3 edited** (not planned). C1's plugins sentence ("Plugins this account connected, and which of them are active.") contains "active", and P-3 asserted the plugins card's whole text never contains "active" when the plugins read failed. The test now removes the purpose sentence from the card text, then applies the old assertions unchanged, and also asserts that the sentence is present. Changing the copy instead would break C1's word-for-word rule. Needs SA sign-off.
2. **DB-5 added** (a literal pin of all 14 sentences), so that MD3 can bite; MD3b added for the call-site swap.
3. **DB-4 renders the strip** (SA SQ-9 suggestion), rather than reading its source.
4. **MD1, MD5 and MD13 bit fewer tests than planned** (see the table); MD6 bit L-10 only by a crash, now also the F1 guard (C4).
5. `tsc` needed `NODE_OPTIONS=--max-old-space-size=8192`; the default heap runs out on this repo.

SA accepted deviations 1 to 4 in the code review.

### Review fixes (SA F1, F2; QA notes 1 and 3)

| Item | Change |
|---|---|
| SA F1 | `source.guard`, LF-4d describe: (a) `/^export function DrawerBox[(]/m` and `/^export function PartPurpose[(]/m` on the comment-stripped `DrawerBox.tsx` (column 0, so a nested declaration cannot satisfy it); (b) every other `.tsx` in `app/admin/users/components` plus `app/admin/users/page.tsx` declares no `function`, `const`, `let`, `var` or `class` binding named `DrawerBox` or `PartPurpose` (imports do not match), and the failure lists the offending files; (c) `BusinessOsPanel`, `BusinessDetail` and `BusinessAuditSection` import from `'./DrawerBox'`. A second case plants samples so the pattern is not dead (nested `const DrawerBox`, `function PartPurpose`, an import, `DrawerBoxModule`, an indented export). No backslash in either regex: character classes stand in for word boundaries |
| MD6 re-run | See the MD6 row: the guard fails in about 3 s naming `BusinessOsPanel.tsx`. L-10 unedited |
| SA F2 | This section, the MD6 row, the C4 row, and the requirement's LF-4d Change History row |
| QA note 1 (TL copy change after the user saw the draft) | `DRAWER_PURPOSE` and DB-5: Credits & billing "Credits, top-up purchases and the top-up spending limit." (9 words); Plan & entitlements "The Business OS plan and what it includes." (8 words). A login with no business no longer reads "this business" above "Not a Business OS account" |
| Run after the fixes | `npx jest app/admin/users app/admin/__tests__/contrast.lf1.source.guard.test.ts`: 25 suites, 630 tests, pass. The three pin files: 3 suites, 32 tests, pass. `lint:hooks`: clean. Pin numstat unchanged (credits `1 0`, the other two untouched) |
| QA note 3 | L-12e also checks focus return directly: from `credits-give` and `boost-cap-set`, and from each of the nine parts, the closest `[role="group"][aria-labelledby]` is the part's section group. A part turned into a labelled group would be its own closest group and fail this |

---

## SA Code Review

**Code Review by SA — 2026-10-14**
**Status:** APPROVED WITH FIXES (F1 below; F2 is docs only)

Read in worktree `neuronforge-admin-layout`, branch `feature/admin-layout-lf4d`, uncommitted on `49e2d7fd`. Every check below was run against `git diff` and the files, not against the Implementation Notes.

### Checks

| # | Check | Finding |
|---|---|---|
| 1 | C2 money-file diffs | Holds. `CreditsBlock.tsx` (4 +-): one import from `./DrawerBox`, `className={PART_BOX}` on the root, one `PartPurpose`. `BoostBlock.tsx` (7 +-): one import, `className={PART_BOX}` on the root, `PART_BOX` appended to `boost-cap` with `space-y-1 text-sm text-slate-300` kept, two `PartPurpose`. No handler, state, request, copy constant or bar class touched. The diffs pasted above match `git diff` exactly |
| 2 | C5 pins | `git diff --numstat`: `pins.credits` is `1 0`; `pins.boost` and `pins.dangerReads` are absent from `git status` (byte-identical). The one line is an added `queryByRole(... 'Reconcile top-ups now (all accounts)')` `toBeNull()` after the existing loop; no existing line changes |
| 3 | C6 order | The §1.3 sentence is in the requirement word for word as C6 gave it, and BD-16 carries C6's extra clause. Order cannot be proven from an uncommitted tree; the Task List records Step 0 first and both land in the same (second) commit, so history never shows the pin line without its permission. Accepted |
| 4 | C1 copy | All 14 `DRAWER_PURPOSE` values match the copy table, and the five C1 corrections (Account, Sign-in, All products, Connected plugins, AI usage) are word for word. DB-5 pins them literally |
| 5 | Danger area | Untouched. `BusinessDetail.tsx` has three hunks, all above the danger area; L-12g pins its class string, its sentence, no purpose line and no `drawer-box-` ancestor |
| 6 | Module level, shared folder | `DrawerBox` and `PartPurpose` are `export function` at module level in `DrawerBox.tsx`; no other file declares either. `app/admin/components/layout/**` product files unchanged; the only change under that folder is one entry in `layoutFolder.guard`'s Businesses file list, the established registration pattern (LF-4a.2 precedent). Accepted |
| 7 | Contrast | Re-derived. Drawer `bg-slate-900`; `SECTION_BOX` is slate-800 at 40 percent over it, `PART_BOX` slate-900 at 50 percent over that, and the nested limit box once more. Every composite lies between slate-900 and slate-800, so slate-400 text is between 5.70:1 and 6.96:1, above 4.5:1. No slate-500/600 added (contrast guard and T-dim green) |
| 8 | Rulings | See below |
| 9 | Step 1 separable | Yes. `businessDetail.render` and `businessesLayout.render` carry only the `configure` import, `jest.setTimeout(30_000)` and `configure({ asyncUtilTimeout: 5000 })`; no LF-4d change touches either file. RM can commit them alone by path |
| 10 | Logging and types | No `console.*` in any touched file (0 in all six product files and the new file); no `any` added. `DrawerBox.tsx` has no entitlements import |

### Rulings

**MD6 (remount loop ends in a heap-out-of-memory, not an assertion): not acceptable as the only signal. Fix F1.** A red that takes about 209 s, prints no assertion and kills the worker (it can take sibling suites in the same worker down with it) tells the next reader nothing about the cause and costs CI time. Keep L-10 as is (it is still the behavioural proof); add a cheap source guard that fails in milliseconds with a clear message. A bounded render-count check is not required: it needs a render probe in product code or a mock of the panel, which is more machinery than the risk warrants.

**Deviation 1 (`businessOsPanel.render` P-3): accepted, no weakening.** The new code first asserts the purpose sentence is present, then removes exactly that sentence (one literal from the constant, not a pattern) and applies the two old assertions unchanged to everything else in the card. Any other "active" or "No plugins connected" text in the failed-read card still fails P-3. Changing the C1 copy instead would have broken C1.

**Deviation 2 (DB-5 and MD3b): accepted, and correct.** Constant-based tests cannot see a swap inside the constant; DB-5 is the anchor for that, and MD3b covers the call-site swap.

**Deviation 3 (DB-4 renders the strip): accepted.** It is the SQ-9 suggestion.

**Deviation 4 (fewer bites for MD1, MD5, MD13): accepted.** Each mutation still bites at least one targeted test: MD1 by DB-4 (the rendered strip is the anchor by design), MD5 by D-20 and L-12e (T-R4 not biting is explained: the re-read unmounts `boost-cap`), MD13 by L-12g (L-1 and DANGER-1 check last-child position, which a wrapper preserves; L-12g's no-`drawer-box-`-ancestor check is the right one).

### SA mutations (both bit, both restored and checked by SHA-256)

| # | Mutation | Result |
|---|---|---|
| SA-M1 | `CreditsBlock` root loses `className={PART_BOX}` (money file) | L-12c fails (`boxed: false` for `credits-block`) |
| SA-M2 | Sign-in group renders `PartPurpose part="account-plugins"` (wrong sentence, right count) | L-12c fails (two `account-plugins` lines, none for Sign-in) |

Working tree identical to the Dev hand-over afterwards (`git diff --stat` unchanged, 14 files, 250 insertions, 30 deletions).

### Code Review Comments

1. **F1 (Medium): source guard for module-level declaration (MD6).** In `app/admin/users/__tests__/source.guard.test.ts`, inside the existing LF-4d describe, add one test that:
   - (a) in `DrawerBox.tsx`, matches the multiline regex `/^export function DrawerBox[(]/m` and `/^export function PartPurpose[(]/m` (column 0, so a declaration nested in a function body, which is indented, cannot satisfy it);
   - (b) for every other `.tsx` file under `app/admin/users/components` plus `app/admin/users/page.tsx`, the comment-stripped code (`codeOf`) declares no binding named `DrawerBox` or `PartPurpose`: no match for a word-bounded `function`, `const`, `let`, `var` or `class` keyword, then whitespace, then either name as a whole word (imports do not match). Put the file name in the failure message;
   - (c) `BusinessOsPanel.tsx`, `BusinessDetail.tsx` and `BusinessAuditSection.tsx` each import from `'./DrawerBox'`.
   Then re-run MD6 (the same mutation as before) and record that the new guard fails within seconds with its message. L-10 is left unedited. Rerun `source.guard` and the users folder once.
2. **F2 (Low, docs):** record F1 and its MD6 rerun in the Implementation Notes and the requirement's LF-4d Change History row; replace "MD6 bites by a runaway re-read loop, flagged for SA" with the ruling above.

### Optimisation Suggestions

- The two notes from the workplan review stand for the user at QB-2: the Spending limit label and its purpose line look close in weight; the danger area keeps `rounded-xl p-6` and `text-sm`.

### Code Approved for QA: Yes, with F1 applied before RM commits (F1 is a test-only addition; QA may run in parallel and need not repeat the full run for it)

---

## QA Testing Report

### QA Report

**QA — 2026-10-14**
**Test mode:** full
**Strategy used:** A + B (Jest render tests through the whole page with the route-table stub; guards). Browser checks QB-1 to QB-9 left to TL, as instructed
**Focus:** ui, drawer markup, money-block safety
**Skipped:** browser checks (TL owns them)
**Input source:** prompt keywords from TL
**Verdict:** PASS WITH NOTES. No bug found. Three notes below, none blocking

Read on `feature/admin-layout-lf4d`, uncommitted, worktree `neuronforge-admin-layout`, before SA's F1 was applied (F1 is test-only; SA says QA need not repeat the full run for it). Source not edited.

#### Runs

| Run | Result |
|---|---|
| `npx jest app/admin/users app/admin/components app/admin/__tests__` | 60 suites, 1,637 tests, all pass |
| Guards: `admin-authz-surface`, `security-definer-surface` (the `test:authz-guard` pair), `tailwind-css-escape`, `creditBands.guard`, `creditBands`, `creditFigures.fromConfig.guard` | 6 suites, 373 tests, all pass |
| `npm run test:bos-entitlements` (default workers) | 255 suites, 7,399 tests, all pass, exit 0 |
| `npm run lint:hooks` | clean, exit 0 |
| Pin files (`git diff --numstat`) | pins.credits `1 0`; pins.boost and pins.dangerReads unchanged |

#### Flake check (Step 1: `businessDetail.render` and `businessesLayout.render`)

Both files run together, 10 times in all, 59 tests each run:

| Set | Load | Result |
|---|---|---|
| First 5 runs | in parallel with `test:bos-entitlements` (runs 1, 2 and part of 3 overlapped it) | 5 of 5 pass; slowest file 41.2 s |
| Second 5 runs | in parallel with a looping `npx jest app/admin lib/business-os/credits` (load ran across all five) | 5 of 5 pass; slowest file 39.9 s |

No timeout, no "Unable to find", no failure in any of the 10 runs.

#### Probes (one throwaway file, `app/admin/users/__tests__/zzQaLf4d.test.tsx`, 9 tests, all pass; deleted)

The probe reused the layout test's route table, added an own-account switch, and typed the copy table from this workplan by hand (it does not read `DRAWER_PURPOSE`, so it checks the words independently).

| # | Check | Result |
|---|---|---|
| Q1 | Business OS account: 14 purpose lines, each a `p` with no role, class exactly `text-xs text-slate-400`, text equal to the copy table word for word; 14 boxes (5 section, 9 part); every box holds exactly one purpose line whose nearest box is itself; the strip has none | Pass |
| Q2 | `boost-cap` is inside `boost-block` and its nearest box is `boost-block`; no element in `boost-block` follows the pointer in document order | Pass |
| Q3 | Exactly five `[role="group"][aria-labelledby]` and five `role="group"` in all; headings per group: credits 1, plan 2 (the snapshot's own h3, the known D-20 exception), ai 1, account 1, activity 1; each group's labelling heading is its first heading; no box has a role or `aria-labelledby`; from `credits-give` and `boost-cap-set` the closest labelled group is `drawer-section-credits`, so the heading fallback lands on Credits & billing | Pass |
| Q4 | Give credits and Set limit opened, closed with Escape: focus returns to the opener, never body; no request sent. The heading fallback after a success is covered by the unedited T-R2 to T-R5, green in the 60-suite run | Pass |
| Q5 | Every fold toggled twice, the plan summary toggled, then a list Refresh: the panel, `credits-block`, `boost-block`, `boost-cap` and all five `drawer-box-*` keep their nodes; the refresh sends only the list read | Pass |
| Q6 | One opening sends nine reads, each once (login-stats, audit-logs, stats, entitlements, summary, archiving, cleanup check, credits, boost): the PIN-k list. READS-1 to READS-4 green, file unedited | Pass |
| Q7 | Danger area: the body's last child, the same five class tokens, the existing sentence word for word, no purpose line inside, no box around it. `git diff` shows no change in the danger markup | Pass |
| Q8 | Non-Business OS login (Oren): five section boxes with their sentences; "Not a Business OS account. This login has no Business OS business." kept in Credits & billing and Plan; no money part, no BOS spend or failures part; All products part with its sentence; one purpose line per box | Pass |
| Q9 | Admin's own account: no money button by test id or by name (including "Reconcile top-ups now (all accounts)"); both own-account sentences present; boxes and all 14 purpose lines present | Pass |

#### Bugs (must fix before commit)

None.

#### Edge cases and notes (nice to fix, not blocking)

1. **Non-Business OS copy reads oddly (Low, copy).** For a login with no business, Credits & billing says "This business's credits, top-up purchases and top-up spending limit." and Plan says "The plan this business is on and what it includes.", each directly above "Not a Business OS account. This login has no Business OS business." SA C1 reworded AI usage for this exact case but not these two. Worth showing the user at QB-5; a fix would be a copy change only.
2. **MD6 signal (process note).** Agrees with SA's F1: today a remount regression shows only as a worker OOM after about 3.5 minutes. F1 was not yet applied when QA ran; RM should confirm F1 is in and `source.guard` is green before committing.
3. **MD5 did not bite T-R4 (coverage note).** A part made into a labelled group is still caught by D-20 and L-12e, so it is covered; Q3's static closest-group check is the direct proof for BD-16's focus clause, and it was a probe (deleted). Optional: keep a copy of that check in L-12e.

The unplanned P-3 edit in `businessOsPanel.render` was read: it asserts the purpose sentence is there, removes only that sentence, then applies the old checks unchanged. No weakening (agrees with SA).

#### Working tree after QA

`git status` shows only the Dev's 17 files (13 modified, 4 new including this workplan); no `zz` file left. No stash, reset or commit.

### Final Status
- [x] All acceptance criteria pass — ready for commit once SA's F1 is applied and TL's browser checks pass
- [ ] Issues found — Dev must address before commit

---

## Commit Info

| Item | Value |
|---|---|
| Branch | `feature/admin-layout-lf4d` (stacked on `feature/admin-layout-lf4c`, PR #354 open) |
| Step 1 commit | `51bc982b` test(admin): give two slow Businesses suites a longer wait (LF-4d step 1) |
| Code commit | `303f792a` feat(admin): every Businesses drawer section gets its own box and a one-line purpose (LF-4d) |
| `origin/main` merge | not needed, already contained |
| PR | [#356](https://github.com/AgentsPilot/neuronforge/pull/356), fast-track, the user merges |
| RM run set | jest users/components/admin + 4 guards: 64 suites / 1,891 pass; `test:bos-entitlements` 255 / 7,401 pass; `lint:hooks` clean; `typecheck:bos-llm` passed (0 new) |

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-14 | Workplan written (Dev) | Box and one-line purpose per section and part; local `DrawerBox`, no shared change; Spending limit nested in Top-ups; danger area untouched; Step 1 is SA's LF-4c flake ruling on its own; pins unedited except the optional OWN-1 addition (SQ-4); SA questions SQ-1 to SQ-10; the copy table for the user |
| 2026-10-14 | SA workplan review | APPROVED WITH CONDITIONS C1 to C7: five copy corrections (Account, Sign-in, All products, Connected plugins, AI usage); money-file diff scope; L-12c nested count; MD6 must bite; pin files byte-identical except the OWN-1 addition; §1.3 amendment and BD-16 first; run set. SQ-1 to SQ-10 ruled |
| 2026-10-14 | Built (Dev) | C1 to C7 applied; Step 1 path-separable; 7 product files (1 new), money diffs within C2; pins.credits `1 0` (OWN-1), the other two pin files untouched; run set green (users and layout 42 suites / 1,255 tests, entitlements 255 / 7,398, lint:hooks clean, scoped tsc clean with canary). MD1 to MD14 all bite; MD6 bites by a runaway re-read loop (OOM), not the C7 assertion, so it is flagged for SA. Unplanned edit: `businessOsPanel.render` P-3 (the C1 plugins sentence contains "active") |
| 2026-10-14 | QA | PASS WITH NOTES. Users, components and admin tests 60 suites / 1,637 pass; 6 guards / 373 pass; entitlements 255 / 7,399 pass; lint:hooks clean. Step 1 flake files 10 of 10 green under parallel load. Nine probes (copy word for word, slate-400, nesting, five groups, focus, no remount, PIN-k reads, danger, non-BOS, own account) pass; probe deleted. No bugs. Notes: non-BOS copy for Credits & billing and Plan says "this business"; F1 not yet applied at QA time; MD5 does not bite T-R4 |
| 2026-10-14 | Committed, PR opened (RM) | `51bc982b` (step 1) and `303f792a` (code) on `feature/admin-layout-lf4d`; PR #356 open, fast-track; contains #354. Run set green. Read-only browser check owed |
