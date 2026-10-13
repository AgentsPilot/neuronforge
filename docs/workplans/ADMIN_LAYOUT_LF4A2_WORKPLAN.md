# Workplan: Admin Layout LF-4a.2 (Businesses drawer layout outside the money blocks)

> **Last Updated**: 2026-10-13

**Developer:** Dev
**Requirement:** [ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md) §1.2 (BD-1 to BD-13), §1.3 (PIN-a to PIN-k), §7.3 (AC-4.2, AC-4.3, AC-4.4, AC-4.5 outside money, AC-4.8, AC-4.9), §8, §13 (SA-C4, SA-C6, SA-C7, SA-C12, SA-F3), §14
**Branch:** `feature/admin-layout-lf4a2` (cut from `feature/admin-layout-lf4a1`). PRs #338, #339 and #340 are merged; `origin/main` was merged into the branch before Step 4 with merge commit `c4d62096` (C11). The pins ran green on that base: 3 suites, 34 tests
**Path:** Full cycle. SA approved this workplan with conditions C1 to C11, applied below (see "SA conditions applied")
**Date:** 2026-10-13
**Status:** PR #343 open — fast-track (SA approved with fixes F1 to F3, applied; QA pass; TL browser check pass). Code commit `752c10c5`

## Overview

The Businesses drawer gets the layout the requirement settled: a read-only summary strip at the top, then six sections in a fixed order (Credits & billing, Plan & entitlements, AI usage, Account & security, Activity, Danger area). The two AI-spend figures sit together in AI usage, Business OS first and "All products" folded with a note that they can differ. Four small account sections merge into one with three groups. Long lists outside the money blocks fold after three entries. A non-Business OS account says so in the strip and never shows zero. `BusinessOsPanel` reads its two bodies through `readJsonBody`, and the requests stay byte-identical. Failure times are shown in UTC.

`CreditsBlock`, `BoostBlock`, their dialogs and the danger area move as whole units. None of their files is edited. Their insides belong to LF-4b, reconcile to LF-4c, and the Escape-mid-delete defect to LF-F1.

The plan needs no edit to the three pin files. Every test id, every text and every DOM relation they assert is kept (see "Pins").

---

## Table of Contents

1. [Analysis Summary](#analysis-summary)
2. [Implementation Approach](#implementation-approach)
3. [The new section tree](#the-new-section-tree)
4. [Reads: each exactly once per opening](#reads-each-exactly-once-per-opening)
5. [Files to Create / Modify](#files-to-create--modify)
6. [Pins and existing tests](#pins-and-existing-tests)
7. [Tests to add](#tests-to-add)
8. [Mutation runs planned](#mutation-runs-planned)
9. [Browser checks (QB-x)](#browser-checks-qb-x)
10. [Logging (SA-F3)](#logging-sa-f3)
11. [Size estimate](#size-estimate)
12. [Risks](#risks)
13. [Questions for SA](#questions-for-sa)
14. [Questions for the user](#questions-for-the-user)
15. [Task List](#task-list)
16. [SA Review Notes](#sa-review-notes)
17. [QA Testing Report](#qa-testing-report)
18. [Commit Info](#commit-info)
19. [Change History](#change-history)

---

## Analysis Summary

On 2026-10-13 I read every file under `app/admin/users/**` in full: the page, the hook, 12 components, the copy files and the 17 test files, including the three pin files. I also read `app/admin/components/layout/AdminDrawer.tsx` (`AdminDrawer`, `DrawerSection`, `DrawerFields`, `DrawerField`), `readJsonBody.ts`, `adminFormat.ts`, the Businesses entry of `layoutFolder.guard.test.ts`, and the LF-4a.1 workplan with its SA review.

| What | Where today | Relevance |
|---|---|---|
| Drawer body | `BusinessDetail.tsx`. While the three detail reads run it renders only `AdminLoading` (`:83`), then `BusinessOsPanel`, User information, Account timeline, Security, Login activity, Connected plugins, AI spend all products, `BusinessAuditSection` and the danger area | The new order is composed here |
| Panel | `BusinessOsPanel.tsx` makes two GETs in one effect keyed on `accountId` (`:115-129`), reads bodies with `response.json()` (`:55`), and holds the BD-9 take-back state (`:98-113`). Money blocks mount only under `!loading && !notBos` (`:175`). It is an emerald `<section data-testid="bos-panel">` with an `h3` header (`bos-panel-business`) | It stays the one owner of both reads and of the BD-9 state |
| Failure time | `BusinessOsPanel.tsx:292`, `new Date(item.createdAt).toLocaleString()` | Change to `formatUtc` |
| Plan fold | `<details data-testid="bos-panel-plan">` around `EntitlementSnapshot`. The summary line reads "Plan & entitlements · tier · cohort" | Moves into section 2 |
| All-products spend | `BusinessDetail.tsx:200-251` (`ai-spend-card`). Cost by Model comes from the stats route, sorted by cost (highest first) and capped at 10 | Moves into section 3, folded |
| Strip data | The row (`AdminUserRow`): `business`, `creditsLeft`, `last_sign_in_at`. The panel's two reads: plan tier and cohort, `aiSpend30d` | BD-1: no new read |
| `CreditsLeftCell` | Hard-codes `data-testid="row-credits-left"`. Imports the band module, which the pinned exception allows only in this file | Reused unedited; tests scope with `within` |
| `DrawerSection` | `div role="group"` named by its `h3`. `DrawerFields` is a `dl` grid; `DrawerField` takes an optional `testId` on its `dd` | Only these shared parts are used. No shared export changes |
| Headings inside money blocks | `CreditsBlock` has `h4` "Credits" and `BoostBlock` has `h4` "Credit top-ups". `EntitlementSnapshot` has `h3` "Capabilities in force" | Affects the existing D-20 test (SA question SQ-A) |

No file in scope imports `lib/business-os/entitlements/`. This slice adds no such import (`business-os-entitlements` skill: nothing to register). The only `lib/business-os` import on the screen stays the band module in `CreditsLeftCell`.

---

## Implementation Approach

**1. The panel keeps its reads and renders sections 1 to 3.** I am not lifting the two reads into a new hook. `BusinessOsPanel` stays the single owner of the entitlements GET, the summary GET and the BD-9 state. It renders, in order: the header line, the summary strip, section 1 (Credits & billing), section 2 (Plan & entitlements) and section 3 (AI usage). `BusinessDetail` then renders section 4 (Account & security), section 5 (Activity, the existing `BusinessAuditSection`) and the danger area (unchanged, last).

The "All products" part of AI usage comes from the page-owned stats read. `BusinessDetail` builds it (new `AllProductsUsage` component) and passes it to the panel as a node prop, `allProducts`. The panel places it inside section 3.

Reasons:
- The reads keep the same mount point and the same timing: after the detail-read gate, as today.
- SA-C12 places `readJsonBody` in `BusinessOsPanel`, which still holds the reads.
- The BD-9 state stays next to the two money blocks without moving at all.
- No new hook and no new data path. SQ-B asks SA to confirm this against BD-13's wording ("lifting the panel's two reads"). Its aim, each read once per opening, holds either way.

**2. The panel takes the row.** The panel's props change from `{ accountId, userName }` to `{ user: AdminUserRow; allProducts: ReactNode }`, because the strip needs `business`, `creditsLeft` and `last_sign_in_at`. Inside the panel, `const accountId = user.id` keeps every JSX line that the source guard matches (`<CreditsBlock accountId={accountId} businessLabel={businessLabel}`) byte-identical.

**3. Kept test ids, new layout.** The `bos-panel` test id stays on a plain wrapper `div` (no gradient, no `<section>`, `space-y-6`) that holds the header line, the strip and sections 1 to 3. `bos-panel-business`, `bos-panel-user` and `bos-panel-vertical` stay as spans in a one-line header under the drawer title. They are no longer a heading: the drawer title is the `h2`, and each section's `h3` is its only heading. `bos-panel-business` keeps today's text exactly ("No Business OS business", "Business OS", or the business name). Pins READS-2 and READS-4 assert that text.

**4. Strip.** New presentational file `BusinessSummaryStrip.tsx`, a `DrawerFields` (`dl`) inside a wrapper `div data-testid="drawer-strip"`. The panel works out each slot's state. The strip only renders it, holds no money formatting (USD stays formatted in the panel, so the source guard's "exactly one `currency: 'USD'` in the panel" still holds) and sends nothing.

| Slot (label) | `dd` test id | While the panel's reads run | Business OS account | Non-Business OS (BD-13) | Read failed |
|---|---|---|---|---|---|
| Plan | `strip-plan` | "Reading…" | tier, plus " · cohort X" when present. No tier: "No plan recorded" (SQ-J) | "Not a Business OS account" | entitlements read failed: "Could not read" |
| Credits left | `strip-credits-left` | "Reading…" | `CreditsLeftCell` with the row's `business` and `creditsLeft` (BD-3, SQ-9) | "Not a Business OS account" | (comes from the row; the cell's own "Unknown" applies) |
| Business OS AI, 30 days | `strip-ai-spend` | "Reading…" | `formatUsd(total)` with the sub-line "estimated" (USD). When `status === 'incomplete'`, "lower bound" is added | "Not a Business OS account" | summary failed, or `aiSpend30d.status === 'error'`: "Could not read" |
| Last sign-in | `strip-last-sign-in` | the row's value at once (it is not a read) | `formatUtc` plus `ageLine`, as the list; "Never" when null | same | — |

The strip has no link and no button (BD-3). A slot never shows "0", "$0.00" or "0%" for something it could not read (BD-3, BD-13). Credits are never summed and USD is never mixed (BD-2): the strip shows the cell's percentage only.

**5. Folds outside the money blocks.** New local file `components/drawerFolds.tsx` with two small components. Neither is a shared export; both live in the Businesses folder.
- `ShowMoreList`: renders the first 3 items in one `ul`, the rest in a second `ul` with the `hidden` attribute (hidden, never unmounted, BD-8), and a button "Show N more" / "Show fewer" carrying `aria-expanded` and `aria-controls`. With 3 items or fewer there is no button.
- `Fold`: a button with `aria-expanded` and `aria-controls`, and a region with the `hidden` attribute.

This is the pattern `BusinessAuditSection` already uses (L-4b SA M-2). Folding sends nothing.

| List | Rule |
|---|---|
| Recent Business OS AI failures | First 3 in the route's order (newest first; Dev confirms the repository's `created_at` descending read at build), then "Show N more" |
| All products (token records) | `Fold`, closed by default (Q-4). The sentence "These come from the older token records, not the Business OS records, so they may not match the Business OS figure." (`ALL_PRODUCTS_COPY.differs`) sits beside the toggle, visible while folded. Wording corrected to match the code (QA E-1) |
| Cost by Model (inside All products) | First 3 in the route's order (highest cost first, the route's own sort), then "Show N more" (SQ-E) |
| Plan & entitlements | Today's `<details>`, unchanged (folded, with its summary line) |
| Audit events | Today's fold in `BusinessAuditSection`, unchanged |
| Credit lots, top-ups, Limit changes | Not here: inside the money blocks, LF-4b |

**6. Account & security (BD-10).** One `DrawerSection`. Each of its three groups has a label in a `p`, not a heading, as "Cost by Model" does today (one heading per section). The fields, their words and their test ids stay.

**7. BD-11 in the non-money files only.** No emerald gradient, emerald icon or emerald link. The plan summary's emerald span and the AI-spend link take the link style the failures link already uses. The purple provider pills, orange plugin chips and cyan costs become slate (decoration, T-6/T-7), and the error lines stay rose/red (status). Information text uses `text-slate-400` (T-5). Failure times go through `formatUtc`. `readJsonBody` is used in the panel only. The money files are not converted (SA-C12).

**8. `readJsonBody` in the panel (SA-C12).** This is the only change to the read function:

```typescript
try {
  const response = await fetch(url, { cache: 'no-store' });
  const body = await readJsonBody(response);
  if (!response.ok || !body?.success) {
    return { state: 'error', code: typeof body?.error === 'string' ? body.error : 'unknown' };
  }
  return { state: 'ok', data: body.data as T };
} catch {
  return { state: 'error', code: 'unknown' };
}
```

(C1: the outer `try`/`catch` stays, so a rejected `fetch` still maps to `'unknown'`. Only the body line changes. The import goes through the alias `@/app/admin/components/layout/readJsonBody`.)

The URL and the init object are byte-identical. On the response side, the old code mapped a JSON array, `null` or a primitive to `'unknown'` through `body?.success`; `readJsonBody` returns `null` for each of them, which still maps to `'unknown'`. A non-JSON body used to throw into the `catch`, giving `'unknown'`; now it becomes `null`, also `'unknown'`. The truthiness test `!body?.success` is kept on purpose (not `=== true`), so no response classifies differently. `SUMMARY_ERROR_COPY` and `ENTITLEMENT_ERROR_COPY` and their contract tests are not touched.

---

## The new section tree

Inside `AdminDrawer` (`users-drawer`; title and short id unchanged). Each section is one `DrawerSection` (an `h3`, `role="group"`, no landmark, A-9). The danger area stays the existing `div`.

```text
users-drawer                                            (AdminDrawer, unchanged)
  h2 title + short id                                   (unchanged)
  AdminLoading "Reading the business details…"          (while the detail reads run, unchanged)
  bos-panel                                             (plain div wrapper, BusinessOsPanel)
    bos-panel-header        p: bos-panel-business · bos-panel-user · bos-panel-vertical
                            ("Business profile not created yet" line when status none)
    drawer-strip            dl: strip-plan, strip-credits-left, strip-ai-spend, strip-last-sign-in
    drawer-section-credits  h3 "Credits & billing"
      loading line "Loading Business OS details…"       (while the panel's reads run)
      bos-panel-not-bos     (non-Business OS: today's one-line note, exact text)
      credits-block         (CreditsBlock, unedited, same props)
      boost-block           (BoostBlock, unedited, same props)
    drawer-section-plan     h3 "Plan & entitlements"
      loading line "Loading the plan…"
      bos-plan-not-bos      (non-Business OS: the same sentence, its own id)
      bos-panel-plan        details > bos-panel-plan-summary + EntitlementSnapshot
      bos-panel-plan-error  (read failed, shown openly, as today)
    drawer-section-ai       h3 "AI usage"
      loading line "Loading Business OS AI usage…"
      bos-panel-summary-error
      bos-panel-spend       "Business OS, last 30 days (USD estimated)": total, calls, tokens,
                            bos-panel-spend-incomplete, per-area chips, link to AI cost & usage
      bos-panel-failures    "Recent failures (last 30 days)": ShowMoreList (3, then
                            bos-panel-failures-more), UTC times, bos-panel-failures-link
      ai-spend-card         "All products, token records (30 days; may be incomplete above
                            1,000 calls)": ai-differ-note (visible), ai-all-products-toggle,
                            ai-all-products-fold (hidden): figures + Cost by Model
                            ShowMoreList (3, then ai-models-more)
  drawer-section-account    h3 "Account & security"          (BusinessDetail)
    account-group-account   p "Account": Full Name, Company, Phone, User ID,
                            Created (detail-created), Last Updated (detail-updated)
    account-group-signin    p "Sign-in": Email Verified, Auth Providers,
                            Last Sign In (detail-last-sign-in); when login stats were read
                            (account-login-stats): Total Logins, Failed Logins, Unique IPs,
                            Last Login IP
    plugins-card            p "Connected plugins": N/M active, chips
  detail-audit              h3 "Activity" (BusinessAuditSection; only the title changes,
                            SQ-I): "Show audit events" fold, unchanged
  danger-area               (unchanged, byte for byte, last child of the drawer body)
```

**Non-Business OS account (BD-13).** The strip shows "Not a Business OS account" in Plan, Credits left and AI, and the row's Last sign-in. Section 1 shows only `bos-panel-not-bos`; section 2 only `bos-plan-not-bos`. Section 3 has only `ai-spend-card`, folded (SQ-D). There is no `credits-block`, `boost-block`, `bos-panel-plan` or `bos-panel-spend`. Sections 4, 5 and the danger area are as for any account.

**Section order, why sections 1 to 3 sit inside `bos-panel`.** These three depend on the panel's two reads, and the panel owns them (approach 1). Inside the wrapper the order is still the BD-4 order. `danger-area` stays the last element child of the drawer body `div` (pin DANGER-1: `danger.parentElement.lastElementChild === danger`).

---

## Reads: each exactly once per opening

The PIN-k lists (READS-1 to READS-4) stay unedited.

| Read | Who sends it | Why it is still once per opening |
|---|---|---|
| login-stats, audit-logs, stats | `useBusinessDetails` (page) | Untouched: `page.tsx` and the hook are not edited |
| entitlements GET, summary GET | `BusinessOsPanel` effect keyed on `[accountId]` | Same component, same mount point (after the `isLoading` gate in `BusinessDetail`), same effect deps. The strip, sections and folds receive props only and contain no `fetch(` (a new source-guard line enforces this) |
| credits GET, boost GET | `CreditsBlock`, `BoostBlock` | Files unedited. They mount under the same condition as today (`!loading && !notBos`) and only inside section 1. No `key` and no wrapper whose element type changes between renders after they have mounted, so React never remounts them. Nothing after mount (a fold, a notice, a strip update) changes their position in the tree |
| archiving GET (`ArchivedBeforeNotice`) | `BusinessAuditSection` | Unchanged; its fold still hides and never unmounts |
| cleanup probe GET | `TestAccountCleanupPanel` | The danger area is unchanged |

Folds use the `hidden` attribute and send nothing. A new layout test toggles every fold and asserts `calls.length` is unchanged after a quiet window.

---

## Files to Create / Modify

### Product files

| File | Action | Reason |
|---|---|---|
| `app/admin/users/components/BusinessOsPanel.tsx` | modify | Props `{ user, allProducts }`. `readJsonBody` in `readJson`. Plain `bos-panel` wrapper with the header line. Strip slot states. Sections 1 to 3 as `DrawerSection`s. Non-Business OS state (BD-13). Failure times through `formatUtc`. Failures folded. Plan summary line without the "Plan & entitlements" prefix (SQ-H). BD-11 colours. The `CreditsBlock` / `BoostBlock` JSX lines and the BD-9 state are unchanged |
| `app/admin/users/components/BusinessDetail.tsx` | modify | Passes `user` and `allProducts` to the panel. Merges the four account sections into "Account & security" with three groups. All-products code moves to `AllProductsUsage.tsx`. BD-11 colours on the chips and costs. The `isLoading` gate and the danger area, including its comments, are unchanged byte for byte |
| `app/admin/users/components/BusinessAuditSection.tsx` | modify | One line: `title="Audit trail"` becomes `title="Activity"` (BD-4, SQ-I). The fold, filter and list are unchanged |
| `app/admin/users/components/BusinessSummaryStrip.tsx` | create | The strip (BD-1, BD-3, BD-12, BD-13): `DrawerFields`/`DrawerField` with `CreditsLeftCell`, no read, no button, no link |
| `app/admin/users/components/AllProductsUsage.tsx` | create | The folded "All products, token records" block (BD-7) with the "can differ" note and Cost by Model in a `ShowMoreList`. It keeps the `ai-spend-card` test id and its "could not be read" sentence |
| `app/admin/users/components/drawerFolds.tsx` | create | `ShowMoreList` and `Fold` (BD-8): hide, never unmount; `aria-expanded`; no read |

### Test and guard files

| File | Action | Reason |
|---|---|---|
| `app/admin/users/__tests__/businessDrawer.layout.render.test.tsx` | create | Order, strip, BD-13, folds, UTC, colours, no request on fold (see Tests to add) |
| `app/admin/users/__tests__/businessSummaryStrip.render.test.tsx` | create | Every slot state of the strip, and the no-zero rule |
| `app/admin/users/__tests__/drawerFolds.render.test.tsx` | create | `ShowMoreList` (≤3 gives no button; 5 gives "Show 2 more"; hidden in the DOM; toggle) and `Fold` |
| `app/admin/users/__tests__/businessOsPanel.render.test.tsx` | modify (deliberate) | See "Existing tests edited" |
| `app/admin/users/__tests__/businessDetail.render.test.tsx` | modify (deliberate) | See "Existing tests edited" |
| `app/admin/users/__tests__/source.guard.test.ts` | modify (strengthen) | `SCREEN_FILES` gains the three new product files, so they too are checked for no `lib/business-os` import, no console and no repository. New `it`: the strip, the folds and `AllProductsUsage` contain no `fetch(`. Nothing is weakened |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` | modify (SA-C12) | The Businesses entry gains `BusinessOsPanel.tsx` and the three new files. The comment drops `BusinessOsPanel` from the "deliberately NOT listed" sentence |

### Not touched

| File | Why |
|---|---|
| `app/admin/users/page.tsx` | The drawer props it passes are already enough (`user`, details, `refreshList`). SA-F3 is therefore not triggered (see Logging) |
| `app/admin/users/useBusinessDetails.ts` | The reads are unchanged |
| `CreditsBlock.tsx`, `BoostBlock.tsx`, `CreditFormDialog.tsx`, `BoostCapDialog.tsx`, `BoostReconcileDialog.tsx`, `DeleteBusinessDialog.tsx` | Money and danger units, moved whole (LF-4b, LF-4c) |
| `CreditsLeftCell.tsx` | Reused as is. The duplicate `row-credits-left` id is handled in tests with `within` (BD-3 first option) |
| `components/business-os/purge/TestAccountCleanupPanel.tsx` | Shared; LF-F1 owns its defect |
| `app/admin/business-os-tiers/**` (incl. `EntitlementSnapshot.tsx`) | Rendered as today |
| `app/admin/components/layout/**` (product files) | No shared export changes |
| `boostCopy.ts`, `creditCopy.ts`, `deletionCopy.ts`, `types.ts`, `usersFormat.ts`, `userName.ts`, `usersFilters.ts`, `BusinessesKpis.tsx`, `UserNameLine.tsx` | Not needed |
| The three pin files | No edit (see Pins) |
| `creditsBlock.render`, `boostBlock.render`, `boostBlock.actions.render`, `deleteBusinessDialog.render`, `creditsLeftCell.render`, `summaryErrors.contract`, `creditErrors.contract`, `creditLayerCopy.contract`, `businessesLayout.render`, `defaultFilter.render`, `userNameLine.render` | Their components and contracts are unchanged. `businessesLayout.render` U-12 finds `bos-panel`, which is kept |

---

## Pins and existing tests

### Pins (`businessDrawer.pins.{credits,boost,dangerReads}.render.test.tsx`)

**Permitted pin edits used in this slice: none.** §1.3 allows edits "only where the opener's position changes". No opener changes file, props or relative order: Give, Take back, top-up Take back, Set limit, Back to default, Reconcile and Remove all render from their unedited blocks. The pins find them by test id and role within the drawer, not by position.

What the pins assert about the layout, and how the plan keeps it:

| Pin assertion | Kept by |
|---|---|
| `bos-panel-business` text "No Business OS business" (READS-2) and "Business OS" (READS-4) | The header line keeps the id and the exact `headerTitle` logic |
| `bos-panel-not-bos` exact text, found once with `getByTestId` (READS-2) | One element with that id (section 1). Section 2's note has its own id, `bos-plan-not-bos` |
| No `bos-panel-plan`, `bos-panel-spend`, `credits-block` or `boost-block` for a non-Business OS account (READS-2) | BD-13 renders none of them |
| `bos-panel-plan-error`, `bos-panel-summary-error` exact text (READS-3, READS-4) | Ids and copy unchanged |
| `danger-area` is the last element child of its parent; the cleanup panel is the danger area's last child (DANGER-1) | `BusinessDetail` still ends with the unchanged danger `div` |
| Exact per-open request lists (READS-1 to READS-4) | See "Reads" |
| `boost-cap` and `Loading credits…` as ready markers | Inside the unedited blocks |
| `OWN-1`: no button named as a money action | New buttons are named "Show N more", "Show fewer", "Show all products", "Hide all products": no clash |

The pin files stay byte-identical; QA checks this with `git diff --stat` on the three paths.

### Existing tests edited (deliberate, not pins)

| Test | Edit | Why |
|---|---|---|
| `businessOsPanel.render`: 9 standalone `render(<BusinessOsPanel …/>)` calls | `accountId`/`userName` become `user={…}` (a row fixture with the same id and name) and `allProducts={null}` | Props change (approach 2). Assertions unchanged |
| `businessOsPanel.render` "orders the panel header, Credits, Plan…" | The summary assertion `'Plan & entitlements · basic'` becomes `'basic'`. The order list (business, credits, fold, spend, failures) stays valid as is | SQ-H: the section heading already says "Plan & entitlements" |
| `businessDetail.render` D-3 | The order list becomes `bos-panel`, `drawer-strip`, groups "Credits & billing", "Plan & entitlements", "AI usage", "Account & security", "Activity", then `danger-area` | BD-4 order |
| `businessDetail.render` D-5 | `getByRole('group', { name: 'Account timeline' })` becomes the "Account & security" group. The UTC and age assertions are unchanged | BD-10 merge |
| `businessDetail.render` D-15a | `queryByRole('group', { name: 'Login activity' })` (null, and present on reopen) becomes `queryByTestId('account-login-stats')` | BD-10 merge; same meaning (the login fields are absent until read) |
| `businessDetail.render` D-15b (C4) | `getByRole('group', { name: 'Login activity' })` (truthy) becomes `getByTestId('account-login-stats')` | BD-10 merge; missing from the first list (SA C4) |
| `businessDetail.render` D-20 | Rewritten per C2: a Business OS account has exactly 5 groups; each group's `aria-labelledby` is its first heading, its `h3`; Credits & billing holds exactly that `h3` plus the one `h4` inside `credits-block` and the one inside `boost-block`; Plan & entitlements holds its `h3` plus exactly the one `h3` inside `bos-panel-plan`; every other group exactly 1 heading. The exceptions are asserted by containment | SQ-A option 1, tightened (C2) |

D-3's new order list keeps `plugins-card`, `ai-spend-card` and `detail-audit` beside the group names (C4). D-5 keeps its `toLocaleDateString` absence check, scoped to the Account & security group.

---

## Tests to add

All three new files follow the `businessDetail.render.test.tsx` style: a route-table `fetch` stub, `UsersPage` rendered whole, and a console guard. They do not use the LF-4a.1 pin harness, so the SA's "fourth file" extraction trigger is not hit (SQ-F).

### `businessDrawer.layout.render.test.tsx` (through the whole page)

| Id | Asserts |
|---|---|
| L-1 order | `drawer-strip` before the groups "Credits & billing", "Plan & entitlements", "AI usage", "Account & security", "Activity", in that document order. `danger-area` is the last element child. `credits-block` and `boost-block` sit inside the Credits & billing group, `bos-panel-plan` inside Plan, `bos-panel-spend`, `bos-panel-failures` and `ai-spend-card` inside AI usage |
| L-2 strip, Business OS | `strip-plan` is "basic". `within(strip-credits-left)` shows the same text and `data-band` as `within(row-credits-cell)` of the open row. `strip-ai-spend` holds the summary's USD figure and the word "estimated". `strip-last-sign-in` holds `formatUtc` plus the age line. The strip holds no `button`, `a` or `input` |
| L-3 strip, non-Business OS (AC-4.9) | Three slots read "Not a Business OS account". No slot text matches `0%`, `$0` or a bare `0`. The AI usage group holds only `ai-spend-card`. The Plan group holds `bos-plan-not-bos` |
| L-4 strip, failed reads | Entitlements 500: `strip-plan` "Could not read", and the other slots are filled. Summary 500: `strip-ai-spend` "Could not read", never "$0.00". Ledger `status: 'error'`: "Could not read" |
| L-5 strip, incomplete | `status: 'incomplete'`: the AI slot carries "lower bound" |
| L-6 failures fold | 5 failures: 3 visible, 2 in the DOM inside a `hidden` list. "Show 2 more" has `aria-expanded="false"` then `"true"`. Each time equals `formatUtc(createdAt)` and none equals `toLocaleString()`. A click sends no request (calls unchanged after a 300 ms quiet window) |
| L-7 All products fold (Q-4, BD-7) | Closed by default. `ai-differ-note` visible. Figures present in the DOM (`ai-spend-card` textContent holds `$0.4321`) but hidden. The toggle opens it and sends no request. Cost by Model with 5 models shows 3 visible and "Show 2 more" |
| L-8 Account & security | One group with three labelled parts in order: Account, Sign-in, Connected plugins. The same field labels as before (Full Name, Company, Phone, User ID, Created, Last Updated, Email Verified, Auth Providers, Last Sign In, Total Logins, Failed Logins, Unique IPs, Last Login IP) |
| L-9 colours (BD-11, non-money parts) | Outside `credits-block` and `boost-block`, no element of the drawer has a class naming `emerald`, `teal`, `purple`, `orange` or `cyan`, and no `bg-gradient`. Error lines keep rose/red |
| L-10 loading (BD-12) | With the summary GET held: the strip's three read-backed slots show "Reading…", Last sign-in is already shown, and no money block is mounted. After release, they fill in |
| L-11 one heading per section | Each of the five groups is named by its own `h3`, and the drawer has exactly one `h2` |

### `businessSummaryStrip.render.test.tsx` (unit)

Each slot in each state (loading, value, not Business OS, unreadable), the "No plan recorded" case, and "never a zero for an unreadable slot". It also checks that the `dl` holds exactly 4 `dt`s in order Plan, Credits left, Business OS AI 30 days, Last sign-in.

### `drawerFolds.render.test.tsx` (unit)

`ShowMoreList` with 0, 3 and 5 items (no button up to 3; "Show 2 more" / "Show fewer"; the extra items are in the DOM under `hidden`; `aria-controls` names the hidden list). `Fold` toggles `hidden` and `aria-expanded`, and its children stay mounted (a child effect counter is 1 after two toggles).

### Run set before handover

- The three pin files, unedited, run alone: 34 tests green.
- Jest on `app/admin/users`, `app/admin/components`, `lib/admin/__tests__/admin-authz-surface.guard.test.ts` and `app/__tests__/tailwind-css-escape.guard.test.ts`.
- `npm run test:bos-entitlements` (it collects `app/admin/users/__tests__`).
- `npm run lint:hooks`, ESLint on the touched files, and scoped `tsc` with a canary (the LF-4a.1 method).
- `git diff --numstat`: no deletion-only file, and the pin files and money files absent from the diff.
- 0 backslashes in this workplan.

---

## Mutation runs planned

The LF-4a.1 scratchpad runner: apply the mutation, run the pin files plus the new and edited tests, restore the file, and compare SHA-256 before and after. Afterwards `git status` must show no unintended change.

| # | File | Mutation | Expected to bite |
|---|---|---|---|
| LM1 | `BusinessOsPanel.tsx` | `readJson` drops `cache: 'no-store'` | READS-1 to READS-4 |
| LM2 | `BusinessOsPanel.tsx` | `readJson` fetches twice (one extra read) | READS-1 to READS-4 |
| LM3 | `BusinessOsPanel.tsx` | Money blocks mount for a non-Business OS account | READS-2, L-3 |
| LM4 | `BusinessOsPanel.tsx` | Failure time back to `toLocaleString()` | L-6 |
| LM5 | `BusinessOsPanel.tsx` | AI slot shows `formatUsd(0)` when the summary failed | L-4, strip unit |
| LM6 | `BusinessOsPanel.tsx` | Credits slot renders `CreditsLeftCell` for a non-Business OS account | L-3 |
| LM7 | `BusinessOsPanel.tsx` | Plan section rendered before Credits & billing | L-1, D-3 |
| LM8 | `drawerFolds.tsx` | `ShowMoreList` drops the rest instead of hiding it | L-6, L-7, folds unit |
| LM9 | `drawerFolds.tsx` | `Fold` unmounts its children when closed | L-7, folds unit |
| LM10 | `AllProductsUsage.tsx` | All products open by default | L-7 |
| LM11 | `BusinessSummaryStrip.tsx` | A button (or link) added to the strip | L-2 |
| LM12 | `BusinessDetail.tsx` | Activity moved below the danger area | DANGER-1, L-1 |
| LM13 | `BusinessSummaryStrip.tsx` | The strip does its own summary `fetch` | READS-1 to READS-4, source guard "no fetch" |

LM14 is a record, not a mutation (SA suggestion 3): `!body?.success` against `body?.success !== true` differs only for a body such as `success: 1`, which no route sends. It is run and recorded separately, so the "every mutation bit" count covers LM1 to LM13 only.

---

## Browser checks (QB-x)

On production, read-only. **Open a drawer only. Never click a money button or a danger button** (Give credits, Take back, Take back credits, Set limit, Back to default, Run billing reconcile, Check, Delete). Fold toggles, Escape and the X are allowed. Two accounts: one Business OS account, and one agent-platform login (Status "All Users").

| # | Check | Pass when |
|---|---|---|
| QB-1 | Open a Business OS account | Strip with Plan, Credits left, Business OS AI 30 days, Last sign-in. Credits left equals the row's cell. No button or link in the strip |
| QB-2 | Section order | Headings read Credits & billing, Plan & entitlements, AI usage, Account & security, Activity, then Danger area at the end |
| QB-3 | Requests per open (DevTools Network, preserve log) | Business OS account: the nine reads, each once. Non-Business OS: the seven, with no credits or boost read |
| QB-4 | Non-Business OS login | Three "Not a Business OS account" slots, no zero. Credits & billing and Plan show the one-line note. AI usage shows only All products (folded) |
| QB-5 | Folds | All products, failures "Show N more" (if the account has more than 3), Cost by Model "Show N more", and "Show all capabilities" each open and close with mouse and keyboard (Enter, Space). Network shows no request on any toggle |
| QB-6 | Times | Failure times and the Last sign-in read in UTC |
| QB-7 | Contrast | No information text below 4.5:1 outside the money blocks (the money blocks' slate-500 lines are LF-4b's) |
| QB-8 | Close | Escape closes the drawer and focus returns to the row's Open button. No console error |
| QB-9 | Money and danger present, not clicked | Give credits, Set limit, Back to default and Run billing reconcile appear inside Credits & billing. Remove this account is inside the Danger area. Looked at, never pressed |
| QB-10 | Width | At desktop width and at the drawer's narrowest, the strip wraps with no horizontal scroll |

---

## Logging (SA-F3)

`app/admin/users/page.tsx:5` and `app/admin/users/useBusinessDetails.ts:20` import the server `createLogger` from `@/lib/logger` into client files (F-56 class, SA-F3). **This plan touches neither file**, so under CLAUDE.md § Logging ("don't reformat files you aren't otherwise working on") no conversion is proposed in this slice, and SA-F3 stays open in §14. If SA's review makes me touch either file, I will flag it with its count (one `createLogger` import each, no `console.*`) and propose converting it to `clientLogger`, converting only once the user agrees.

The touched files (`BusinessOsPanel.tsx`, `BusinessDetail.tsx`, `BusinessAuditSection.tsx`) have no `console.*` and no logger import. The new files will have none (source guard: no console).

---

## Size estimate

| Part | Estimate |
|---|---|
| Product code | about +420 / -190 lines over 6 files (3 modified, 3 new) |
| Tests | about +650 lines (3 new files), about 40 lines edited in 2 render files and 2 guards |
| Time | 2 to 3 days, in line with §8: 1 day build, 1 day tests and mutations, half a day browser checks and fixes |

---

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | A remount of `CreditsBlock`/`BoostBlock` (an element type or `key` change above them) sends a second credits or boost read, or loses BD-9 state mid-dialog | Both mount once, in one fixed JSX position inside section 1. PIN-k with `quiet()` and LM2/LM3 catch any extra read; TOPUP-1 to TOPUP-5 catch lost BD-9 state |
| R-2 | The duplicated `row-credits-left` id breaks a page-level `getByTestId` while the drawer is open | Searched every test: only `creditsLeftCell.render` (unit, no drawer) uses it. New tests use `within`. SQ-K offers the local test-id prop instead |
| R-3 | D-20's one-heading rule conflicts with unedited money blocks and the snapshot (SQ-A) | Named exceptions or a different section element, SA decides |
| R-4 | Pins rely on `bos-panel-*` ids that the design would otherwise drop | The ids stay, with today's text (see Pins) |
| R-5 | Timing: the strip waits for the detail-read gate before its read-backed slots fill | Same as today's panel. BD-12 placeholders. No new read to speed it up (BD-1) |
| R-6 | The "lower bound" wording now appears in the strip and in the section | Same source (`status === 'incomplete'`), so they cannot disagree |
| R-7 | A Give or Take back leaves the strip's Credits left stale beside a re-read Credits block | Known and accepted until LF-4b (BD-14, `refreshList` once after a success); a named pin edit there |
| R-8 | CRLF line endings make the mutation runner miss a multi-line pattern (seen in LF-4a.1) | Single-line mutations only, with the checksum-verified restore |

---

## Questions for SA

| # | Question | Dev proposal |
|---|---|---|
| SQ-A | D-20 says each `DrawerSection` holds exactly one heading. Credits & billing will also hold `CreditsBlock`'s and `BoostBlock`'s `h4`s (unedited until LF-4b), and Plan & entitlements holds `EntitlementSnapshot`'s own `h3` "Capabilities in force" (a Plans-page component, unchanged) | Keep both as `DrawerSection`s (BD-4) and edit D-20 with two named exceptions: the first heading is still the group's label, and the extras are exactly those three. LF-4b removes the Credits exception if it turns the `h4`s into labels. Alternative: render Credits & billing and Plan as a plain `div` with its own `h3` (as the danger area) until LF-4b. I prefer the first, so the sections are uniform |
| SQ-B | BD-13 speaks of "lifting the panel's two reads to feed the strip" | Not lifted: the panel stays the reads' owner and renders the strip and sections 1 to 3; `BusinessDetail` passes the All-products block in as `allProducts: ReactNode`. Same mount point and timing, so PIN-k cannot move. Confirm this meets BD-13 and SA-C12 |
| SQ-C | Keeping `bos-panel` (a plain wrapper) and `bos-panel-business` (now a span in the header line, today's text) so the pins stay unedited. For a Business OS account the header line repeats the business name already in the drawer title | Accept the repetition. It also says "No Business OS business" or "Business OS" when the title cannot |
| SQ-D | Non-Business OS account: All products is the only AI content. Fold it anyway? | Yes, folded, per Q-4's literal answer; the toggle and the "can differ" note say what is inside |
| SQ-E | BD-8 says "newest 3" for Cost by Model, but it has no date: the route sorts by cost (highest first) and caps at 10 | First 3 in the route's order (highest cost), then "Show N more" |
| SQ-F | The new layout test uses the `businessDetail.render`-style stub, not the pin harness | So the "fourth file" extraction trigger (LF-4a.1 SA) is not hit. If SA wants the pin harness, I extract the shared part into `tests/admin/` in this slice, as SA described |
| SQ-G | Strip placeholders: Credits left comes from the row, but whether to show the cell or "Not a Business OS account" depends on the panel's reads | Plan, Credits left and AI show "Reading…" until the two reads settle; Last sign-in shows at once |
| SQ-H | Plan summary line drops its "Plan & entitlements" prefix (the section heading says it) | Yes; one deliberate assertion edit in `businessOsPanel.render` |
| SQ-I | `BusinessAuditSection` title "Audit trail" becomes "Activity" (BD-4's name); the toggle still says "Show audit events" | Yes; no test asserts the old group name |
| SQ-J | Plan slot when the payload has no plan row or no tier | "No plan recorded" (new copy) |
| SQ-K | `CreditsLeftCell`'s fixed `row-credits-left` id appears twice with the drawer open | Leave the component unedited and scope tests with `within` (BD-3's first option) |
| SQ-L | `layoutFolder.guard`: besides `BusinessOsPanel` (SA-C12), also list the three new files | Yes: they are Businesses markup files with no `.json(` and alias-only imports |

---

## Questions for the user

None. The layout was decided in §1.2 and Q-4 (2026-10-13). Every open point above is technical and for SA.

---

## SA conditions applied

| # | How it is applied |
|---|---|
| C1 | Approach 8: the outer `try`/`catch` stays; only the body line changes; alias import |
| C2 | In sections 1 to 3 the non-money titles become `p` labels: the Business OS spend title, the failures title and the All-products title. The plan-error block's own `h4` is dropped. D-20 is rewritten as stated in "Existing tests edited" |
| C3 | `AllProductsUsage` keeps `ai-spend-card` on the element holding the title (with "may be incomplete above 1,000 calls") and the figures. It is not a `DrawerSection`. When `tokens === null` the "could not be read" sentence shows outside any fold, with no toggle. Section 3 renders it in every panel state. L-7 gains the tokens-null case |
| C4 | D-15b added to the edit list; D-3 keeps `plugins-card`, `ai-spend-card`, `detail-audit`; D-5 keeps the locale check, scoped to Account & security |
| C5 | L-9 checks only `bg-`, `text-`, `border-`, `from-`, `to-` with emerald, teal, purple, orange or cyan, plus `bg-gradient`. It excludes `credits-block`, `boost-block` and `danger-area` and allows the T-7 focus accent. The fold buttons use `ADMIN_BUTTON` |
| C6 | Plan summary line: tier and cohort, or "No plan recorded" when neither exists. The show/hide spans take the failures link colour |
| C7 | The panel always returns one root `div[data-testid="bos-panel"]`; the three `DrawerSection`s always render; the money blocks sit in one fixed slot with no `key`. L-10 asserts that `credits-block` and `boost-block` are the same nodes after every fold toggle |
| C8 | The run set gains `creditBands.guard`, `creditFigures.fromConfig.guard` and `contrast.lf1.source.guard` |
| C9 | Requirement splices: BD-13 / SA-C6 ruling, the LF-4b D-20 obligation, and the §14 `CreditsLeftCell` slate-500 follow-up |
| C10 | `layoutFolder.guard` Businesses comment rewritten |
| C11 | Header updated; `origin/main` merged (`c4d62096`); pins green on that base |

Non-blocking suggestions taken: Cost by Model loses its `max-h-48 overflow-y-auto` box; its `text-blue-300` figure becomes slate; LM14 is recorded apart from the mutation table; the label reads "Cost by Model (highest cost first)" (SQ-E). Fold list items are keyed by `item.id` and model name.

## Task List

- ✅ Step 1: Read the requirement (§1, §1.3, §7.3, §8, §13, §14), the LF-4a.1 workplan, every file under `app/admin/users/**` and the shared drawer parts
- ✅ Step 2: Write this workplan; update requirement §1 LF-4a.2 row and Change History
- ✅ Step 3: SA workplan review; conditions C1 to C11 applied; `origin/main` merged (`c4d62096`), pins green on it
- ✅ Step 4: `drawerFolds.tsx` with its unit test
- ✅ Step 5: `BusinessSummaryStrip.tsx` with its unit test
- ✅ Step 6: `BusinessOsPanel.tsx`: `readJsonBody`, props, header line, strip states, sections 1 to 3, BD-13, UTC, failures fold, colours
- ✅ Step 7: `AllProductsUsage.tsx`; `BusinessDetail.tsx` Account & security and composition; `BusinessAuditSection` title
- ✅ Step 8: Deliberate edits to `businessOsPanel.render` and `businessDetail.render`; guard additions (`source.guard`, `layoutFolder.guard`)
- ✅ Step 9: `businessDrawer.layout.render.test.tsx`
- ✅ Step 10: Run set (see Implementation Notes)
- ✅ Step 11: Mutation runs LM1 to LM13 plus the LM14 record, with checksums
- ⬜ Step 12: SA code review; QA runs QB-1 to QB-10

## Implementation Notes

Built 2026-10-13 on `c4d62096`. Everything is uncommitted; RM commits after SA code review, QA and the user's look at the diff.

### Files

| File | Change |
|---|---|
| `app/admin/users/components/BusinessOsPanel.tsx` | modified (+268 / -168): props `{ user, allProducts }`; `readJsonBody` inside the kept `try`/`catch` (C1); one root `bos-panel`; header line; strip slot states; three `DrawerSection`s always rendered (C7); BD-13; failures in a `ShowMoreList` with UTC times; the three former `h4` titles are `p` labels and the plan-error `h4` is gone (C2); plan summary never empty (C6); no emerald, teal or gradient |
| `app/admin/users/components/BusinessDetail.tsx` | modified (+116 / -153): passes `user` and `allProducts`; Account & security with three groups; plugin chips and provider pills to slate. The `isLoading` gate and the danger area are unchanged |
| `app/admin/users/components/BusinessAuditSection.tsx` | modified (+2 / -1): title "Activity" |
| `app/admin/users/components/BusinessSummaryStrip.tsx` | created (96 lines) |
| `app/admin/users/components/AllProductsUsage.tsx` | created (92 lines) |
| `app/admin/users/components/drawerFolds.tsx` | created (87 lines) |
| `app/admin/users/__tests__/businessDrawer.layout.render.test.tsx` | created, 15 tests |
| `app/admin/users/__tests__/businessSummaryStrip.render.test.tsx` | created, 7 tests |
| `app/admin/users/__tests__/drawerFolds.render.test.tsx` | created, 4 tests |
| `app/admin/users/__tests__/businessOsPanel.render.test.tsx` | edited as listed (props through a `panel()` helper, 10 calls; plan summary assertion) |
| `app/admin/users/__tests__/businessDetail.render.test.tsx` | edited as listed (D-3, D-5, D-15a, D-15b, D-20) |
| `app/admin/users/__tests__/source.guard.test.ts` | strengthened: 3 files added to `SCREEN_FILES`; "no `fetch(`" for each; the strip renders the list cell and names no credit figure |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` | 4 files added to the Businesses list; comment rewritten (C10) |

**Pins:** the three `businessDrawer.pins.*` files are byte-identical. Their SHA-256 matched the checksums taken on `c4d62096` before the build, and `git diff --stat` on them is empty. The same holds for `CreditsBlock`, `BoostBlock`, `CreditFormDialog`, `BoostCapDialog`, `BoostReconcileDialog`, `DeleteBusinessDialog`, `CreditsLeftCell`, `page.tsx` and `useBusinessDetails.ts`.

### Verification

| Run | Result |
|---|---|
| Pins on the merged base, before the build | 3 suites, 34 tests, pass |
| Jest: `app/admin/users`, `app/admin/components`, the authz guard, the tailwind guard, `creditBands.guard`, `creditFigures.fromConfig.guard`, `contrast.lf1.source.guard` (C8) | 47 suites, 1,479 tests, all pass |
| `npm run test:bos-entitlements` | 251 suites, 7,312 tests, all pass |
| `npm run lint:hooks` | exit 0 |
| ESLint on the 13 touched or new files | exit 0 |
| Scoped `tsc` (scratchpad tsconfig extending the worktree's, `incremental: false`, `plugins: []`, `include: []`, `next-env.d.ts` plus the 13 files) | with the canary: exactly `zz-canary.ts(1,7) TS2322`, exit 2; without it: exit 0 |
| `git diff --numstat` | 8 modified files, none deletion-only; 6 new files |
| Backslashes in the new files and this workplan | 0 |

### Mutation runs

The scratchpad runner applied each mutation, ran the pins, the layout, strip and folds tests, `businessDetail.render`, `businessOsPanel.render` and `source.guard` (197 tests), then restored the file and compared SHA-256. All 14 restored OK.

| # | File | Mutation | Bites |
|---|---|---|---|
| LM1 | `BusinessOsPanel.tsx` | no `cache: 'no-store'` on the two reads | READS-1 to READS-4 |
| LM2 | `BusinessOsPanel.tsx` | each read sent twice | READS-1 to READS-4, D-13 |
| LM3 | `BusinessOsPanel.tsx` | money blocks mount for a non-Business OS account | READS-2, L-3, "shows no Credits block for a login with no business" |
| LM4 | `BusinessOsPanel.tsx` | failure time back to `toLocaleString()` | L-6 |
| LM5 | `BusinessOsPanel.tsx` | an unreadable AI slot shows `formatUsd(0)` | L-4 (summary failed), L-4 (ledger error) |
| LM6 | `BusinessOsPanel.tsx` | Credits slot shows the cell for a non-Business OS account | L-3 |
| LM7 | `BusinessOsPanel.tsx` | Plan section moved before Credits & billing | L-1, D-3, D-20, the panel order test, the two source-guard and render "Credits above the plan" checks |
| LM8 | `drawerFolds.tsx` | the rest of a list dropped, not hidden | folds unit, L-6, L-7 |
| LM9 | `drawerFolds.tsx` | `Fold` unmounts its children when closed | folds unit, L-7, SA C7 check, and every test that reads `ai-spend-card` text (P-1, P-3, QA-P8, D-14, D-15a) |
| LM10 | `drawerFolds.tsx` | `Fold` open by default | folds unit, L-3, L-7 |
| LM11 | `BusinessSummaryStrip.tsx` | a button in the strip | strip unit, L-2 |
| LM12 | `BusinessDetail.tsx` | Activity moved below the danger area | DANGER-1, L-1, D-3 |
| LM13 | `BusinessSummaryStrip.tsx` | the strip sends its own summary read | source guard "no fetch", READS-1 to READS-4 and every whole-drawer test (an unknown request) |

**LM14 (record, not a mutation):** `!body?.success` changed to `body?.success !== true`. 197 of 197 pass, as expected: no route sends a truthy non-`true` `success`. The truthiness test is kept on purpose.

**Flake seen during the mutation runs:** `businessOsPanel.render` QA-P7 (unchanged by this slice; it uses RTL's 1 s default wait on the whole page) failed in 2 of the 14 mutation runs where its mutation could not affect it (LM4 on the first pass, LM5). It passed in every clean run (5 full runs). The new layout file sets `asyncUtilTimeout` to 5 s, as the pin files do; QA-P7's file is left as it was. QA may want to watch it in CI.

### Deviations from the plan

| # | Deviation | Why |
|---|---|---|
| DV-1 | The layout test sets `configure({ asyncUtilTimeout: 5000 })` | Under the parallel mutation runs it timed out at the 1 s default; same reason and setting as the pin files. A longer wait can only turn a pass into a fail |
| DV-2 | Tests never write a tier name: they read it from `recordedAccountBody.data.plan.tier` | `tierLiteral.forbidden` (FR-12) refused the literal in two test files on the first entitlements run |
| DV-3 | D-3 also places `account-login-stats` and asserts that the "Activity" group is `detail-audit` | Makes the merge of the four account sections and the retitle visible in the order test |
| DV-4 | Strip AI sub-line reads "estimated" or "estimated, a lower bound" | One line for both the USD label and the incomplete marker |
| DV-5 | The `SCREEN_FILES` additions come from a hoisted `LF4A2_FILES()` function, which the new "no fetch" check also uses | One list for both checks |
| DV-6 | The scoped `tsc` needs `"include": []` | Otherwise the worktree's `include` is inherited and the run exhausts the heap |

## SA Review Notes

### SA Review (workplan)

**Reviewed by SA, 2026-10-13**
**Status:** APPROVED WITH CONDITIONS (C1 to C11 below). Dev applies them to this workplan, then builds. No second workplan review is needed unless a condition cannot be met as written.

I checked the plan against the code on the branch: `BusinessOsPanel.tsx`, `BusinessDetail.tsx`, `BusinessAuditSection.tsx`, `CreditsLeftCell.tsx`, `AdminDrawer.tsx` (`DrawerSection`), `readJsonBody.ts`, the three pin files, `businessOsPanel.render`, `businessDetail.render`, `businessesLayout.render` (U-12), `users/__tests__/source.guard`, `layoutFolder.guard`, and the two `lib/business-os` guards that scan `app/admin/users/`.

#### Findings on the nine review points

| # | Point | Finding |
|---|---|---|
| 1 | Reads stay in the panel; once per opening; money blocks mount once | **Confirmed.** The panel keeps one effect keyed on `[accountId]`. The page keys `BusinessDetail` by `selected.id`, so a new account always means a new panel. The panel still mounts after the same `isLoading` gate. `user` becomes a prop, but the effect still keys on the id, so the list Refresh in U-12 (new row object, same id) sends no read. `bos-panel` keeps its element identity there as long as C7 holds. The money blocks keep today's gate (`!loading && !notBos`) and get one fixed slot in section 1. Nothing after mount changes their ancestors' element types. The PIN-k lists hold unedited |
| 2 | No pin edits | **Confirmed.** I read every layout-sensitive assertion in the three pin files. They use `bos-panel-business` (text), `bos-panel-not-bos` (exact text, one element), `bos-panel-plan`, `bos-panel-spend`, `credits-block`, `boost-block` (absence), `bos-panel-plan-error`, `bos-panel-summary-error` (exact text), `danger.parentElement.lastElementChild` and `danger.lastElementChild`, the `Loading credits…` and `boost-cap` ready markers, and OWN-1's button names. The plan keeps all of them. The new button names ("Show N more", "Show fewer", "Show all products", "Hide all products") match none of OWN-1's names. `readJsonBody` calls `response.json()`, so the pin harness's `json`-only stub is still enough |
| 3 | Section tree against the requirement | **Matches** BD-1 to BD-4, BD-7, BD-8 (non-money lists), BD-10, BD-11 (non-money files), BD-12 and BD-13. BD-5, BD-14 and BD-15 are LF-4b. BD-6 is LF-4c. BD-9 is unchanged, because its state does not move. `CreditsBlock`, `BoostBlock`, the dialogs and the danger area are moved whole and not edited. Gaps are in C2 and C3: the plan does not say what happens to the non-money `h4`s, or to a failed tokens read inside the fold |
| 4 | `readJsonBody` (SA-C12) | **The request is byte-identical, and every response maps to the same code.** `readJsonBody` calls `response.json()` and returns `null` for an array, `null`, a primitive or a parse error. In each case the old code also produced `'unknown'`, either through `body?.success` or through the `catch`. Keeping `!body?.success` as a truthiness test keeps `success: 1` classified as before. **However, the snippet drops the outer `try`/`catch`**, see C1 |
| 5 | `drawerFolds.tsx` local; hide, never unmount (BD-8) | **Confirmed local.** The file lives in `app/admin/users/components/` and nothing in `app/admin/components/layout/` changes, so no shared export changes. Both components use the `hidden` attribute with `aria-expanded` and `aria-controls`. That is the `BusinessAuditSection` M-2 pattern, and LM8, LM9 and the unit test's effect counter prove it. Key list items by a stable value: `item.id` for failures, the model name for Cost by Model, not the index |
| 6 | Edits in `businessOsPanel.render` and `businessDetail.render` | **Justified and not weakening**, apart from one omission (C4). The prop change is mechanical. The plan-summary change follows SQ-H. D-3 and D-5 follow the new grouping. D-15a moves from a group name to a test id, with the same meaning. D-20's change is acceptable only in the tightened form in C2. The order test in `businessOsPanel.render` (header, credits, fold, spend, failures) still holds with the strip in between |
| 7 | SQ-A to SQ-L | Rulings below |
| 8 | Browser checks read-only | **Confirmed.** QB-1 to QB-10 only open drawers, toggle folds, press Escape and the X, and read DevTools. Every money button and every danger button, including Check, is named as never pressed. Toggling "Show all capabilities" is a native `details` and sends nothing |
| 9 | Size | **Right.** About 420 product lines over 6 files, about 650 test lines, 2 to 3 days. That matches §8's LF-4a.2 estimate. One PR, no further split |

#### Conditions

| # | Condition | Why |
|---|---|---|
| C1 | `readJson` keeps its outer `try`/`catch`. The only line that changes is `const body = await response.json();`, which becomes `const body = await readJsonBody(response);`. Import it through the alias `@/app/admin/components/layout/readJsonBody` | The snippet in approach 8 has no `try`. A rejected `fetch` (network error) would then reject the `Promise.all`, and the panel would stay on "Loading…" forever. Today that case maps to `'unknown'`. SA-C12 requires the same code for every outcome |
| C2 | **Headings (SQ-A).** In sections 1 to 3, every non-money heading becomes a non-heading label (a `p`, as "Cost by Model" is today): the `bos-panel-spend` title, the `bos-panel-failures` title and the All-products title. The plan-error block's own `h4` "Plan & entitlements" is dropped, because the section's `h3` says it. Rewrite D-20 as follows. A Business OS account has exactly 5 groups. Each group's `aria-labelledby` points at its first heading, which is its `h3`. Credits & billing holds exactly that `h3` plus the one `h4` inside `credits-block` and the one `h4` inside `boost-block`. Plan & entitlements holds its `h3` plus exactly the one `h3` inside `bos-panel-plan` ("Capabilities in force"). Every other group holds exactly 1 heading. Assert the exceptions by containment (the extra heading is inside that block), not only by count | The workplan lists the exceptions but never says that today's three `h4`s in the panel and the All-products title stop being headings. Without that, D-20 fails or the exceptions grow silently. Asserting by containment means a new stray heading still fails |
| C3 | **`AllProductsUsage`.** (a) It keeps `data-testid="ai-spend-card"` on the element whose text holds the title, including "may be incomplete above 1,000 calls" (P-1), and the figures. (b) It is not a `DrawerSection`, so there is no nested group. (c) When `tokens === null`, the "could not be read" sentence is visible, outside the fold, and there is no toggle. A read failure is never folded away (the plan-error precedent, BD-12). (d) Section 3 renders it in every panel state: loading, summary error, not Business OS, and ok. It does not depend on the panel's reads. L-7 gains the tokens-null case | P-1 and P-2 assert this text. Hiding a failure behind a closed fold would break the rule the panel already follows for the plan |
| C4 | Add **D-15b** to "Existing tests edited". Its `getByRole('group', { name: 'Login activity' })` (truthy) becomes `getByTestId('account-login-stats')`. D-3's new order list keeps `plugins-card`, `ai-spend-card` and `detail-audit` as entries next to the group names: the list becomes longer, not shorter. D-5 keeps its `toLocaleDateString` absence check, scoped to the Account & security group | D-15b names the old group and is missing from the edit list. It would fail at build, and that is the kind of unlisted test edit QA must not find |
| C5 | **L-9 scope.** Check decorative colour utilities only: `bg-`, `text-`, `border-`, `from-` and `to-` combined with emerald, teal, purple, orange or cyan, plus `bg-gradient`. Allow the T-7 accent: `ring-purple-500` focus rings, `ADMIN_BUTTON`, `AdminDrawer`'s own `[&>button]:focus:ring-purple-500` and the `AdminLoading` spinner. Exclude `credits-block`, `boost-block` and `danger-area`. The new fold buttons use `ADMIN_BUTTON`, or the standard focus ring, as `detail-audit-toggle` does | As written ("no class naming purple"), L-9 fails on the drawer content element itself, and it would push the Dev to strip the standard focus ring (T-7). `TestAccountCleanupPanel` uses `text-emerald-400` for an OK verdict. That panel is shared, out of scope, and owned by LF-F1 |
| C6 | **Plan summary line (SQ-H, SQ-J).** It is never empty. With no tier and no cohort it reads "No plan recorded", the same words as the strip's Plan slot. The "Show all capabilities" / "Hide capabilities" spans stay, in the failures link style instead of emerald | Dropping the "Plan & entitlements" prefix makes an empty first part possible, which would give " · Show all capabilities" |
| C7 | **Remount discipline, stated and tested.** The panel returns one root, `div[data-testid="bos-panel"]`, in every state. There is no early return of another tree while loading. The three `DrawerSection`s always render, and only their contents switch. `CreditsBlock` and `BoostBlock` sit in one fixed slot, `{!loading && !notBos && (<>…</>)}`, with no `key` on them or on any new ancestor. L-1 or L-10 adds a check: capture `credits-block` and `boost-block` once they mount, toggle every fold outside the money blocks and let the strip settle, then assert both nodes are the same nodes (`toBe`) | The PIN-k request counts catch a remount only through a second GET. An identity check catches lost BD-9 state directly and costs one line. U-12 already relies on the same identity for `bos-panel` |
| C8 | Add to the run set: `lib/business-os/credits/__tests__/creditBands.guard.test.ts` and `lib/business-os/entitlements/__tests__/creditFigures.fromConfig.guard.test.ts`, which scan every non-test file under `app/admin/users/`, and `app/admin/__tests__/contrast.lf1.source.guard.test.ts` | The three new product files fall into their scope. A stray `> 30` in a fold, for example, trips the band guard |
| C9 | Splice the outcome into the requirement (memory rule: always update the main requirement). BD-13 / SA-C6: "satisfied without lifting the reads: the panel stays their owner (SA ruling LF-4a.2 SQ-B)". Add to LF-4b: remove the D-20 Credits & billing heading exception when the money `h4`s become labels (SQ-A). Add to §14: the strip's Credits left reuses `CreditsLeftCell`, whose "no business" dash is `text-slate-500` (T-5). That is a row-component follow-up, not this slice | It keeps the requirement the single source of truth for the next slice |
| C10 | In `layoutFolder.guard`, rewrite the Businesses comment so that its "deliberately NOT listed" sentence no longer names `BusinessOsPanel` and states why the panel joins now (SA-C12, `readJsonBody`). The other six names stay | SQ-L, and so the comment is not left stale |
| C11 | Housekeeping: update the workplan header. PRs #338, #339 and #340 are merged. Merge `origin/main` into the branch before Step 4, and run the pins green on the merged base first | The header still says "open", and the build should start from the real base |

#### Rulings on SQ-A to SQ-L

| # | Ruling |
|---|---|
| SQ-A | **Option 1 (named exceptions), in the tightened form of C2.** Every section stays a `DrawerSection`, so the sections are uniform. The `div`-plus-`h3` alternative would add a second section shape for one slice |
| SQ-B | **Approved: do not lift.** BD-13's "lifting" sentence states a consequence ("keeps each read once per open; the BD-9 state … moves with the two blocks as one unit"), not a required mechanism. Keeping the reads in the panel meets both aims more safely: same mount point, same timing, and the BD-9 state does not move at all. It also fits SA-C12 (`readJsonBody` in `BusinessOsPanel`). A `ReactNode` prop for All products is fine: it is presentational and holds no read. Record the ruling per C9 |
| SQ-C | **Accepted.** Keep `bos-panel-business` with today's `headerTitle` logic. Keep `bos-panel-vertical` under today's exact condition (summary ok and business status ok), and the "Business profile not created yet (setup in progress)." line word for word |
| SQ-D | **Yes, folded.** That is Q-4 literally, and the visible note and toggle name what is inside. C3(c) still applies: a failed read is shown open |
| SQ-E | **Accepted:** first 3 in the route's order, which is highest cost first. Add "(highest cost first)" to the "Cost by Model" label, so "first 3" is not read as "newest 3" |
| SQ-F | **Accepted:** stub style, no pin harness. The LF-4a.1 extraction trigger is not reached. If LF-4b needs the harness in a fourth file, it extracts then |
| SQ-G | **Accepted.** Plan, Credits left and AI show "Reading…" until both reads settle, and Last sign-in shows at once. The panel's reads decide whether this is a Business OS account (BD-13), not the row |
| SQ-H | **Accepted,** with C6 |
| SQ-I | **Accepted.** I searched the admin tests: none asserts the "Audit trail" group name in this screen. D-6 and D-7 use `detail-audit*` test ids |
| SQ-J | **Accepted:** "No plan recorded". It must not read "Could not read", because the read succeeded |
| SQ-K | **Accepted:** leave `CreditsLeftCell` unedited and scope with `within`. New and edited tests never call `getByTestId('row-credits-left')` at page level |
| SQ-L | **Accepted.** `BusinessOsPanel`, `BusinessSummaryStrip`, `AllProductsUsage` and `drawerFolds` join the Businesses list. After C1, none calls `.json(`, has its own `h1`, or imports the shared folder relatively. Comment per C10 |

#### Optimisation suggestions (not blocking)

- Cost by Model: once the list shows 3, drop its `max-h-48 overflow-y-auto` box. A scroll box inside the drawer's own scroll is awkward, and the fold now does that job.
- Cost by Model `text-blue-300` on the input figure is decoration. Moving it to slate is consistent with BD-11, although BD-11 does not name blue.
- LM14 is a record, not a mutation run. Keep it, but list it apart from the mutation table, so QA's "every mutation bit" count stays clean.
- Strip "Credits left": when the row's `business` is `undefined` (the lookup failed) and the panel says this is a Business OS account, the cell shows "Unknown". That is correct. QB-1 can note it if seen.

### Approval
- [x] Workplan approved with conditions C1 to C11. Proceed to implementation once they are applied to this workplan.

### SA Code Review

**Code Review by SA, 2026-10-13**
**Status:** APPROVED WITH FIXES (F1 to F3 below). All three are test or doc edits; no product file changes. No second SA code review is needed: TL or QA confirms F1 bites under mutation SA-M1, then the slice goes to the user's diff view.

Reviewed on the worktree, branch `feature/admin-layout-lf4a2`, uncommitted on `c4d62096`. `origin/main` has since moved to `103dead2` (PR #341, billing P-4.2); that merge touches no file under `app/admin/`, so it does not affect this review.

#### Verification

| Check | Result |
|---|---|
| Pin files byte-identical to main | **Yes.** `git hash-object` of the three `businessDrawer.pins.*.render.test.tsx` equals the blob on `origin/main` and on `c4d62096` |
| Money, danger and untouched files byte-identical to the merge base | **Yes.** `git diff --stat c4d62096` is empty for `CreditsBlock`, `BoostBlock`, `CreditFormDialog`, `BoostCapDialog`, `BoostReconcileDialog`, `DeleteBusinessDialog`, `TestAccountCleanupPanel`, `CreditsLeftCell`, `page.tsx` and `useBusinessDetails.ts` |
| Run set (SA rerun) | `app/admin/users` (all 20 files), `layoutFolder.guard`, `creditBands.guard`, `creditFigures.fromConfig.guard`, `contrast.lf1.source.guard`: 24 suites, 1,018 tests, all pass. Pins pass inside that run. `tierLiteral.forbidden` passes. ESLint on the 7 touched or new component and layout-test files: exit 0 |
| `console.*` and `any` | None in the 6 product files or the 3 new test files (test files only spy on console for the guard) |
| Backslashes in this workplan | 0 |

#### Conditions C1 to C11 in the code

| # | Met | Evidence |
|---|---|---|
| C1 | Yes, but unpinned (F1) | `readJson` keeps the outer `try`/`catch`; only the body line changed; alias import. The old and new functions differ in that one line. `readJsonBody` only reads the response, so the request (URL, `cache: 'no-store'`) is byte-identical. LM1 and LM2 pin the request |
| C2 | Yes | The spend, failures and All-products titles are `p` labels; the plan-error `h4` is gone. D-20 is rewritten as asked: exactly the five section names in order, `aria-labelledby` equals the first heading's id, the extra headings are counted (2 in Credits & billing, 1 in Plan, 0 elsewhere) and compared **by identity and position** (`headings.slice(1)[i]` is `toBe` the `h4` inside `credits-block`, then `boost-block`, or the `h3` inside `bos-panel-plan`). A stray heading or a second `h4` in a money block fails |
| C3 | Yes | `ai-spend-card` holds the title and figures; it is a `div`, not a group; `tokens === null` shows the sentence outside any fold with no toggle (L-7 case); the panel renders `allProducts` after its state switches, so it shows in every panel state |
| C4 | Yes | D-15b edited; D-3 keeps `plugins-card`, `ai-spend-card`, `detail-audit` and gains `account-login-stats` (DV-3); D-5 keeps the locale check, now over the whole Account & security group (a wider scope, not a weaker one) |
| C5 | Yes | L-9 matches only the five prefixes and `bg-gradient`, excludes the two money blocks and the danger area, and has a planted-sample test proving the matcher sees each kind and ignores `ring-purple-500`. Fold buttons use `ADMIN_BUTTON` |
| C6 | Yes | `planSummary` returns "No plan recorded" when there is neither tier nor cohort; the show/hide spans are `text-blue-300` |
| C7 | Yes | One root `div[data-testid="bos-panel"]` in every state; three `DrawerSection`s always render; the money blocks sit in one fixed `!loading && !notBos` slot with no `key`. L-10 captures `credits-block` and `boost-block`, toggles every fold twice plus the plan summary, waits for quiet, and asserts the same nodes and no new request. See the note under Optimisation on what that test can and cannot see |
| C8 | Yes | The three guards run green |
| C9 | Yes | BD-13 ruling, the LF-4b D-20 obligation in §8 and LF4A2-F1 in §14 are spliced into the requirement |
| C10 | Yes | Comment rewritten; `BusinessOsPanel` no longer in the "NOT listed" sentence; the four files are in the Businesses list |
| C11 | Yes | Workplan header updated; merge `c4d62096` |

#### Specific points asked

| Point | Finding |
|---|---|
| Reads once per open; no remount of the money blocks | **Confirmed.** The effect is still keyed on `[accountId]` and mounts after the unchanged `isLoading` gate. The strip, folds and All-products block contain no `fetch(` (new source-guard check). PIN-k passes unedited |
| Folds hide, never unmount | **Confirmed.** `ShowMoreList` puts the rest in a second `ul` with `hidden`; `Fold` uses `hidden` on its region. Tailwind 4 preflight makes `[hidden]` `display: none !important`, and no `listClassName` sets a display utility anyway. The fold unit test's effect counter stays at 1; LM8 and LM9 bite |
| `businessOsPanel.render` edits | Mechanical prop change through a `panel()` helper with the same id and name. The plan-summary assertion moved from "contains" to "starts with the tier", plus a check that the section heading says "Plan & entitlements": stronger, not weaker |
| `businessDetail.render` edits | D-3 longer and ordered; D-5 wider scope; D-15a and D-15b test the same fact by test id; D-20 as above. Nothing weakened |
| DV-1 to DV-6 | **All acceptable.** DV-1: a longer wait can only accept a slower correct state; it cannot pass a wrong one. DV-2: correct reaction to FR-12. DV-3: stronger. DV-4: one sub-line from one source (`status === 'incomplete'`), so the strip and section cannot disagree. DV-5: function declarations hoist, so `SCREEN_FILES` sees the list; one list for two checks. DV-6: tooling only |
| QA-P7 flake | **Raise the wait in this slice (F2).** The test body is unchanged, but this slice makes the drawer heavier (strip, three sections, folds), and the file is already edited here. The Jest gate is a required check on main, so a 1 s wait on a whole-page render is a merge blocker waiting to happen. The pin files and the new layout file already use 5 s for the same reason. A longer wait cannot make a wrong final state pass |

#### SA mutations (both restored, SHA-256 matched before and after; `git status` unchanged)

| # | File | Mutation | Result |
|---|---|---|---|
| SA-M1 | `BusinessOsPanel.tsx` | `catch` rethrows instead of returning `'unknown'` (C1 removed in effect: a rejected `fetch` rejects the `Promise.all` and the panel stays on "Reading…") | **Survived.** 538 of 538 pass across the pins, layout, panel, detail, source guard and layout-folder guard. Nothing tests a rejected `fetch` on the panel's reads. This is F1 |
| SA-M2 | `BusinessDetail.tsx` | `key={Math.random()}` on `BusinessOsPanel` (a remount on every re-render of the drawer body) | **Bit**: U-12 (Refresh keeps the panel, no new reads) and D-13 (reopen). It did not bite the L-10 C7 identity test or any pin, see Optimisation |

#### Code Review Comments (fixes)

1. **F1, `app/admin/users/__tests__/businessDrawer.layout.render.test.tsx` (or `businessOsPanel.render`): pin C1.** Add one test where the summary read's `fetch` **rejects** (a network error, not a 500). Assert that the AI usage section shows `bos-panel-summary-error` with the fallback words, that `strip-ai-spend` reads "Could not read" (never "Reading…", never a "$"), and that the money blocks still mount. Optionally the same for the entitlements read. It must fail under SA-M1. Priority: Medium. Test-only
2. **F2, `app/admin/users/__tests__/businessOsPanel.render.test.tsx`: QA-P7 wait.** Add `jest.setTimeout(30_000)` and `configure({ asyncUtilTimeout: 5000 })` at file level, with the same comment the pin files carry. Both are needed: a 5 s RTL wait inside Jest's default 5 s test timeout would just move the failure. Priority: Low. Test-only
3. **F3, `docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md` §1:** the LF-1, LF-2 and LF-4a.1 rows still say "PR #338/#339/#340 open"; all three are merged. Mark them merged, and set the LF-4a.2 row to "SA code review: approved with fixes F1 to F3". Priority: Low. Doc only

#### Optimisation Suggestions (not blocking)

- The C7 identity test meets C7 as written, but the folds keep their own state, so toggling them never re-renders the panel; SA-M2 shows the test cannot see a remount caused by the drawer body re-rendering. U-12 and D-13 do catch that. If cheap, add a list Refresh (or an audit filter change) between capture and the `toBe` check, so the identity test also covers a re-render from above.
- `businessDetail.render`: under the parallel run a `CreditsBlock` "not wrapped in act" warning is printed (not under a single-file run). D-3 and D-20 now wait for `credits-block` to mount but not for its read to finish, so the read can land after the assertions. Waiting for the block's loaded state (the pins wait for "Loading credits…" to go) would silence it.
- `businessSummaryStrip.render` writes `'basic · cohort pilot'`: it slips past the FR-12 pattern only because the quote is not next to the word. A neutral word or the fixture's tier keeps DV-2's "no tier name in tests" literally true.

### Code Approved for QA: Yes, with F1 to F3 applied before the user's diff view

## QA Testing Report

### QA Report

**QA, 2026-10-13**
**Verdict:** PASS WITH NOTES. QA found no bug in the product code. The notes match the SA code review's F1 to F3, which were not yet applied when QA ran. Tested on the uncommitted tree, before F1 to F3.
**Test mode:** full
**Strategy used:** A and B: Jest render tests through the whole `UsersPage` with a route-table `fetch` stub, plus throwaway probes. QB-1 to QB-10 are TL's browser checks, so QA did not run them.
**Focus:** ui, api (panel reads), security (money buttons on the admin's own account)
**Skipped:** QB-x browser checks (TL runs them, read-only)
**Input source:** the prompt (TL)

#### Runs

| Run | Result |
|---|---|
| Jest: `app/admin/users`, `app/admin/components`, `admin-authz-surface.guard`, `tailwind-css-escape.guard`, `creditBands.guard`, `creditFigures.fromConfig.guard`, `contrast.lf1.source.guard` | 47 suites, 1,479 tests, all pass (the same count as Dev's) |
| `npm run test:bos-entitlements` | 251 suites, 7,312 tests, all pass |
| `npm run lint:hooks` | exit 0 |
| `git diff --stat` on the pin files `businessDrawer.pins.*` | empty (the files are byte-identical) |

#### Flakiness

| Run | Result |
|---|---|
| The three pin files, 3 runs in a row | 34/34, 34/34, 34/34 |
| `businessOsPanel.render`, 5 runs in a row | 23/23 in all 5 |
| `businessOsPanel.render` under load: 4 copies in parallel, with the pin and layout files running at the same time | 23/23 in all 4; pins plus layout 49/49 |

QA-P7 did not flake in 9 runs, including the 4 under load. Dev saw it fail 2 times in 14 mutation runs, so heavier load can still trip its 1 s default wait. SA F2 (a 5 s wait plus `jest.setTimeout(30_000)`) is the right fix. It was not applied at QA time.

#### Probes

Probes are 13 throwaway tests in `app/admin/users/__tests__/zzLf4a2.probe.test.tsx`. All 13 pass. The file was deleted after the run.

| # | Probe | Result |
|---|---|---|
| Q1 | Business OS account: the top-level `h3`s read, in order, Credits & billing, Plan & entitlements, AI usage, Account & security, Activity, Danger area. The strip's `dt`s read Plan, Credits left, Business OS AI 30 days, Last sign-in. The strip shows the tier and $4.21. "(highest cost first)" is present. The differ note is visible while All products is folded | Pass |
| Q2 | Exactly 3 failures: no toggle and no hidden list | Pass |
| Q2b | 4 failures: "Show 1 more", then "Show fewer", then back again; `aria-expanded` follows each click | Pass |
| Q3 | Non-Business OS: three "Not a Business OS account" slots, no zero. No credits read and no top-up read. No plan or summary error line. No "Loading" text left. Each panel read is sent once | Pass |
| Q3b | Non-Business OS with tokens null: the "could not be read" sentence shows open, with no toggle | Pass |
| Q4 | Entitlements read held, then a 500: the three strip slots show "Reading…", then Plan shows "Could not read" and the plan error line appears | Pass |
| Q5 | Summary read held, then a 500: the AI slot shows "Reading…", then "Could not read", never $0 | Pass |
| Q6 | Both reads return a 500: Plan and AI both show "Could not read" | Pass |
| Q7 | C1: `fetch` rejects on both panel reads. The plan and summary error lines show. None of the three loading lines remain. The strip shows "Could not read", and Credits left no longer shows "Reading…" | Pass |
| Q7b | `fetch` rejects on the summary read only: AI shows "Could not read", Plan shows the tier | Pass |
| Q8 | Every fold toggled 3 times (failures, All products, Cost by Model, audit, plan `details`): `credits-block` and `boost-block` are the same nodes, no new request is sent, and there is one credits read and one top-up read in total | Pass |
| Q9 | Keyboard: the three new toggles are `button type="button"`. Each has `aria-expanded`, and an `aria-controls` that points at an element whose `hidden` state matches. Each has the `focus-visible:ring-2` ring from `ADMIN_BUTTON`, is in the tab order and takes focus. The plan fold is a native `summary`. The strip has nothing focusable | Pass |
| Q10 | Admin's own account (`isOwnAccount` true on both reads): no button named Give credits, Take back, Take back credits, Set limit, Back to default or Run billing reconcile. No button in the drawer has text naming credit, limit, default, reconcile, take back or give. The danger area is the last child | Pass |

Q7 and Q7b show that the current code meets C1. They were throwaway tests, though, and SA-M1 shows that no committed test pins C1. SA F1 is still needed.

### Test Coverage

| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| AC-4.2 / BD-4: section order, danger area last | ✅ | Pass | L-1, D-3, DANGER-1, Q1, Q10 |
| BD-1 / BD-3: strip is read-only, uses the row's cell, never shows zero | ✅ | Pass | L-2, strip unit, Q1, Q9 |
| BD-7: All products folded, with the differ note | ✅ | Pass | L-7, Q1, Q3b |
| BD-8: folds hide, never unmount, send nothing | ✅ | Pass | L-6, L-7, folds unit, Q2, Q2b, Q8 |
| BD-10: Account & security in three groups | ✅ | Pass | L-8, D-5 |
| BD-11: colours, UTC times | ✅ | Pass | L-9, L-6 |
| BD-12: placeholders; a failed read never shows zero | ✅ | Pass | L-10, Q4, Q5, Q6 |
| AC-4.9 / BD-13: non-Business OS account | ✅ | Pass | L-3, READS-2, Q3, Q3b |
| AC-4.3: each read once per opening | ✅ | Pass | READS-1 to READS-4, Q3, Q8 |
| SA C1: a network rejection maps to an error | ⚠️ | Pass in probe only | Q7, Q7b. Needs the committed test from SA F1 |
| SA C7: money blocks keep their nodes | ✅ | Pass | C7 test, Q8 |
| Own account: no money button | ✅ | Pass | OWN-1 pin, Q10 |
| Browser checks QB-1 to QB-10 | ⚠️ | Not run by QA | TL runs them |

### Issues Found

#### Bugs (must fix before commit)

None in the product code.

#### Performance Issues (should fix)

None.

#### Edge Cases and notes

These are the same items as the SA code review's F1 to F3. Dev applies them before the user's diff view.

1. **SA F1 (Medium, test-only).** No committed test covers a rejected `fetch` on the panel's reads. QA probe Q7 passes on the current code. Add the permanent test, and confirm that it fails under SA-M1.
2. **SA F2 (Low, test-only).** QA-P7 still uses the 1 s wait. It did not flake in 9 QA runs, but it did in Dev's mutation runs.
3. **SA F3 (Low, docs).** The requirement §1 rows for LF-1, LF-2 and LF-4a.1 still say "PR open".
4. **E-1 (Low, docs).** Approach 5 quotes the differ note as "These figures come from different records than the Business OS figure above and may not match." The code says "These come from the older token records, not the Business OS records, so they may not match the Business OS figure." Both meet BD-7. Only the workplan text is out of date.

### Final Status

- [x] All acceptance criteria tested in Jest pass. Ready for commit once SA F1 to F3 are applied (F1 must fail under SA-M1) and TL's browser checks QB-1 to QB-10 pass.
- [ ] Issues found. Dev must address before commit.

## Commit Info

[RM will populate this section]

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-13 | Workplan written (Dev) | Section tree with a test id per section; the panel keeps its two reads and renders the strip and sections 1 to 3; 3 product files modified, 3 created; no pin edit; deliberate edits in `businessOsPanel.render` (props, plan summary) and `businessDetail.render` (D-3, D-5, D-15a, D-20); 3 new test files; LM1 to LM14; QB-1 to QB-10; SA questions SQ-A to SQ-L; no user question |
| 2026-10-13 | SA workplan review | APPROVED WITH CONDITIONS C1 to C11 (keep the `try`/`catch` around `readJsonBody`; headings and tightened D-20; All-products failure shown open; D-15b edit; L-9 scope allows the T-7 accent; plan summary never empty; remount identity check; run set gains three guards; requirement splice; guard comment; header and merge of `origin/main`). SQ-A to SQ-L ruled; SQ-B: the reads are not lifted |
| 2026-10-13 | Conditions applied; built (Dev) | C1 to C11 applied in "SA conditions applied"; `origin/main` merged (`c4d62096`), pins green on it. 3 product files modified, 3 created; 3 test files created (26 tests); 4 test files edited as listed. Pins byte-identical. Run set 47 suites / 1,479 tests; `test:bos-entitlements` 251 / 7,312; `lint:hooks`, ESLint and scoped `tsc` clean. LM1 to LM13 all bite; LM14 recorded. Deviations DV-1 to DV-6 |
| 2026-10-13 | SA code review | APPROVED WITH FIXES F1 to F3 (test or doc only). C1 to C11 met; pins and money files byte-identical; 24 suites / 1,018 tests green. SA-M1 (C1 catch rethrows) survived: F1 adds a rejected-fetch test. SA-M2 (panel remount) bit U-12 and D-13. F2 raises the wait in `businessOsPanel.render` (QA-P7). F3 marks LF-1, LF-2, LF-4a.1 merged in requirement §1. DV-1 to DV-6 accepted |
| 2026-10-13 | QA (Jest and probes) | PASS WITH NOTES, no product bug, tested before F1 to F3. Run set 47 suites / 1,479 tests; `test:bos-entitlements` 251 / 7,312; `lint:hooks` exit 0; pins byte-identical. Pins green in 3 of 3 runs; `businessOsPanel.render` green in 5 of 5, plus 4 of 4 under load. 13 throwaway probes all pass, then deleted: failed reads, network rejection (C1), non-Business OS, fold counts, keyboard, remount, own account. Notes: SA F1 to F3 still owed; E-1 (differ-note wording in approach 5). QB-1 to QB-10 left to TL |
| 2026-10-13 | SA F1 to F3, QA E-1 and the three SA optimisations applied (Dev) | Test and doc edits only, no product file. F1: `businessDrawer.layout.render` gains "L-4 (SA F1, C1)", a summary read whose `fetch` rejects: the fallback sentence in AI usage, `strip-ai-spend` "Could not read" (no "Reading", no "$"), both money blocks mounted. SA-M1 (the panel's `catch` rethrows) now bites: 1 of 198 fails, exactly that test; file restored, SHA-256 matched. F2: `businessOsPanel.render` sets `jest.setTimeout(30_000)` and `asyncUtilTimeout` 5 s at file level. F3: requirement §1 rows LF-1, LF-2, LF-4a.1 MERGED; LF-4a.2 "SA code review approved with fixes; QA pass". E-1: approach-5 note wording now quotes `ALL_PRODUCTS_COPY.differs`. Optimisations: D-3 and D-20 wait for the Credits read ("Loading credits…" gone) and `boost-cap` (both silent run alone; the remaining parallel-run act warning comes from the unchanged D-7, recorded); the C7 identity test adds a list Refresh and checks `bos-panel`, `credits-block` and `boost-block` keep their nodes with exactly one list read; SA-M2 (`key={Math.random()}` on the panel) now bites that test as well as D-13 (2 of 198 fail), file restored, SHA-256 matched; the strip unit test builds its plan words from the fixture tier. Run set 47 suites / 1,480 tests; `test:bos-entitlements` 251 / 7,313; `lint:hooks` and ESLint exit 0. Pin files byte-identical |
| 2026-10-13 | Committed and PR opened (RM) | Code commit `752c10c5`; `origin/main` merged in (`1cb24b12`, clean, brings #341). After the merge: run set 47 suites / 1,480 tests; `test:bos-entitlements` 251 / 7,330; `lint:hooks` exit 0; `typecheck:bos-llm` passed (0 new). PR [#343](https://github.com/AgentsPilot/neuronforge/pull/343) open, fast-track; the user merges |

## TL Browser Check (QB) — 2026-10-13

**Verdict: PASS (read-only).** Local dev server on this branch, signed-in admin, dark mode; drawer opened on Peak Form Fitness. No money or danger button was clicked.

| Check | Result |
|---|---|
| Section order | Credits & billing → Plan & entitlements → AI usage → Account & security → Activity → Danger area ✅ |
| Summary strip | "Plan: basic · cohort champion · Credits left 99% · Business OS AI, 30 days $0.2765 estimated · Last sign-in 2026-10-11 19:13 UTC, 1d ago" ✅ (showed "Reading…" for about 90 s first — the local dev server is slow against production; not a defect) |
| Folds | "Show all products" and "Show audit events" start closed (aria-expanded=false) ✅ |
| Toggle every fold twice | credits-block and boost-block are the same DOM nodes afterwards; no new /api request ✅ |
| AI usage | Business OS figure first, failures line, "All products" folded with its note ✅ |
| Money buttons present (not clicked) | Take back, Give credits, Take back credits, Set limit; danger Check ✅ |
| Escape | closes the drawer ✅ |
