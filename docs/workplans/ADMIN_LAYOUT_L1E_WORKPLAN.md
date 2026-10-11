# Workplan: Admin Layout Standard — Slice L-1e (shared business picker → pilot Audit trail, part 3)

> **Last Updated**: 2026-10-11

**Developer:** Dev
**Requirement:** [ADMIN_LAYOUT_STANDARD_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md): §1 (row 4a), §5.5 (parts 3 and 7), §5.10, §5.12 (A-1, A-3, A-9), §6.1 (S-1 to S-10), §6.2 C-6 and C-14, §7.3 (picker parts and test edits), §9 F-28, F-31, F-56 (picker), F-70, §12.2 (L-1e line), §12.3; SA re-check RC-6, RC-7, R-11; L-1c workplan SA review N-3, N-4 ([ADMIN_LAYOUT_L1C_WORKPLAN.md](/docs/workplans/ADMIN_LAYOUT_L1C_WORKPLAN.md)); L-1d workplan §2.2, §12 and SA workplan review Q-1, QA re-check note on the focus fallback ([ADMIN_LAYOUT_L1D_WORKPLAN.md](/docs/workplans/ADMIN_LAYOUT_L1D_WORKPLAN.md))
**Branch:** `feature/admin-layout-l1e`, cut from `feature/admin-layout-l1d` (`d31abf10`). The PR targets `main`, so its diff includes L-1d (PR #292) until #292 merges; expected. Worktree `neuronforge-admin-layout`
**Date:** 2026-10-11
**Status:** Code complete — SA approved, QA passed (QA-1/QA-2 fixed) — ready for RM
**Path:** full cycle (it builds the shared export C-6, CLAUDE.md rule 7). Fast-track after SA + QA (user rule for these UI slices)

## Overview

L-1e finishes Audit trail. A shared `AdminBusinessPicker` (C-6) is generalised from `audit-trail/BusinessAccountPicker.tsx` into the shared folder and replaces the original in the filter bar's Business slot, labelled "Business". The active chip becomes "Business: {name}" with X "Remove business" (§5.5 part 7). The chip's name comes from the option the admin picked, then from the loaded rows (in the F-31 order), then a short id. The picker never fetches on mount (RC-6), so the F-28 mount pin holds unchanged. The original picker file is **not edited or deleted**: Activity and Finance still import it until their own slices, and L-8 deletes it (R-11). The picker contract test covers both pickers (RC-7). After this slice Audit trail meets the full §12.3 definition of done.

## Table of Contents

- [1. Analysis Summary](#1-analysis-summary-code-verified-at-d31abf10)
- [2. Scope](#2-scope)
- [3. Implementation Approach and Component API](#3-implementation-approach-and-component-api)
- [4. The C-14 guard changes](#4-the-c-14-guard-changes)
- [5. Tests](#5-tests)
- [6. Verification](#6-verification)
- [7. Task List](#7-task-list)
- [8. Sizing](#8-sizing)
- [9. Risks](#9-risks)
- [10. Out of scope](#10-out-of-scope)
- [11. Questions for SA](#11-questions-for-sa)

---

## 1. Analysis Summary (code verified at `d31abf10`)

### 1.1 Files this slice touches, as they are today

| File | Fact |
|---|---|
| `app/admin/audit-trail/BusinessAccountPicker.tsx` (342 lines, **read only**) | `createLogger` from `@/lib/logger` `:46-48` (F-56); `BUSINESS_SEARCH_PATH` `:51`; `SEARCH_MAX_CHARS = 100` `:54`; debounce 300 ms `:56`; `UUID_PATTERN` `:59`; defensive `readBusinesses` `:84-97`; `response.json()` `:129` (no `readJsonBody`); fixed error copy "Could not load businesses" `:135`, `:147`; log line `:149` carries only `{ err }`; fetch only while `open` `:157-165` (so no fetch on mount today; `open` starts false `:105` and only `onFocus` / typing / arrows set it); hardcoded ids `audit-business-picker` / `audit-business-options` `:217`, `:228`, `:233`, `:251` (F-70); label "Account" `:217-219`; input `text-sm py-1.5 … focus:ring-blue-500` `:246` (F-70); permanent hint `:336-339` with `text-slate-500`; `onSelect(accountId)` carries no name `:76`, `:173-181` |
| `app/admin/audit-trail/page.tsx` (1,238 lines) | Imports the original picker `:51`. `accountFilterLabel` `:178-185` orders company name → `users.email` → `users.full_name` → short id and never reads `user_email` (F-31); `auditUserLabel` `:155-157` is full name → `user_email` → `users.email` → id. Interim chip `:844-858`: "Account {label}", testid `account-filter-chip`, X "Show every account" (L-1c SA N-3). Business slot `:887-899`: `w-full sm:w-72` wrapper + `<BusinessAccountPicker selectedAccountId onSelect>`. Focus fallback `:810-813` → content `div` `:1011` with `focus:outline-none` and no ring (L-1d QA re-check note) |
| `app/admin/components/layout/AdminFilterBar.tsx` | `AdminActiveChip { key, label, title?, testId?, removeLabel, onRemove }` `:30-40`; slot `business` rendered as-is `:162`; chips row `:181-183`; re-exports `ADMIN_FIELD_CONTROL` / `ADMIN_FIELD_LABEL` from `DatePresets.tsx:30-34` |
| `app/admin/components/layout/readAdminResponse.ts` | `readAdminResponse(response, { what, pick? })` → `{ ok, status, data }` or `{ ok: false, message }`: route `error` verbatim, else "Could not read {what}. Try again in a moment."; `ADMIN_NETWORK_ERROR` for a rejected fetch `:19`. Reads the body through `readJsonBody` (S-6) |
| `app/admin/components/layout/adminTable.ts` | `formatShortId(id)` `:49-52` → 8 chars + "…" |
| `app/admin/audit-trail/auditTrailFilters.ts` | `account` spec `:51`: alias `user_id`, `isValid: isUuid`, sent to the route as `user_id` `:85`. Unchanged |
| Other importers of the original picker (unchanged) | `business-os-llm/components/activity/ActivityFilters.tsx:20`, `:121`; `finance/components/FinanceFilterBar.tsx:14`, `:97`; `finance/__tests__/financePage.render.test.tsx:31-32` mocks it to `null` |
| Reused route (unchanged) | `app/api/admin/business-os/llm-usage/businesses/route.ts`: returns `{ userId, companyName }`, `limit`; its own failure copy "Could not load businesses" is pinned in its route test `:140` (server side, not the picker) |

### 1.2 Shared-folder rules that bear on a fetching component

- **No rule bans `fetch(` in the shared folder** (`layoutFolder.guard.test.ts` has no fetch rule). The Health single-fetch pin scans only Health's three files. `readAdminResponse` "never calls fetch" is a property of that helper, not of the folder. The picker is the folder's **first** fetching component (Q-3).
- S-3: the picker needs `react` (`useId`, `useState`, `useEffect`, `useMemo`, `useRef`, `useCallback`), `lucide-react` (`Building2`, `Search`), `@/lib/logger/client`, and folder files (`./readAdminResponse`, `./adminTable`, `./DatePresets`, `./AdminFilterBar` type-only). All allowed.
- S-4: no `@/lib/business-os/**`; the response fields stay re-declared locally. S-5: no `console.`, `dark:`, `--v2-`. S-6: no `.json(`, so the read goes through `readAdminResponse` (which uses `readJsonBody`). S-7: no green. S-8: no region.

### 1.3 Test facts this plan depends on

| Test | Lines that change, or must hold |
|---|---|
| `businessPicker.contract.test.ts` | `PICKER` `:30` single path; `SURFACE_FILES` walks only `app/admin/audit-trail`, `app/api/admin/audit-trail`, `lib/audit` `:34`; "finds the files" `:81-86`; "is the path the picker names" `:141-147`; "the picker logs only the error" `:190-196` |
| `businessPicker.render.test.tsx` | imports `BUSINESS_SEARCH_PATH` from `../BusinessAccountPicker` `:67`; X "Show every account" `:224`; testid `account-filter-chip` `:233`, `:237`; log message `:377`; the hint `:289-298`; the 403 case expects the route's "Forbidden" in the alert `:383-391`; **F-28 mount pin** `:429-437` and "does not touch the business list until the picker is used" `:168-175` must hold unedited |
| `accountChipLabel.render.test.tsx` | `chip()` finds `account-filter-chip` `:101`; the "no identity lookup" pin `:145-157` must hold; the fallback cases `:160-188` must still pass after the F-31 reorder (none sets both `full_name` and an email) |
| `presetAndDeepLink.render.test.tsx` | testid `:97`; X "Show every account" `:104` |
| `filterDensity.render.test.tsx` | label `'Account'` `:92` |
| `auditTrail.layout.render.test.tsx` | testid `account-filter-chip` `:317` (**not in the L-1d §12 outline**; found here) |
| `searchTotals.render.test.tsx` | Verified: no account, chip or picker reference. §7.3 listed it; **no edit needed** (closes the N-4 item) |
| `auditTrail.table.render.test.tsx` `:23` | The `@/lib/logger` mock comment says "until L-1e". The mock becomes unused but harmless; left unedited (no test churn) |

### 1.4 Logging

The shared picker logs through `clientLogger.child({ module: 'AdminBusinessPicker' })` (S-5, F-56). One log line, on a rejected fetch only, with `{ err }` and a fixed message that names no business and no term (AC-B13). No `console.*` exists in `page.tsx` (verified: none) or the picker.

---

## 2. Scope

### 2.1 In L-1e

| # | Item | Source |
|---|---|---|
| E-1 | `app/admin/components/layout/AdminBusinessPicker.tsx` (new): `AdminBusinessPicker`, `businessFilterChip`, `BUSINESS_SEARCH_PATH` | C-6, F-56, F-70, RC-6 |
| E-2 | Audit trail swaps it into the Business slot, label "Business", and builds the chip with `businessFilterChip` | §7.3, §12.2 L-1e |
| E-3 | Chip name: picked option → loaded rows (F-31 order) → short id | F-31 |
| E-4 | Contract test covers both pickers and puts the shared file on the audit surface | RC-7, R-11 |
| E-5 | The deferred picker-swap test edits (§5.2) | §7.3, L-1c N-4 |
| E-6 | C-14: the new file joins the expected files; comments amended (§4) | C-14 |
| E-7 | Requirement sweep at code-complete: §1 row 4a, §6.2 C-6 note, §9 F-31 / F-56 (picker) / F-70 status, §12.2 L-1e box | §12.3 |

### 2.2 The content-area focus ring (L-1d QA note): not added

The fallback at `:810-813` fires only when the drawer's row has left the page, which needs a read to land while the drawer is open. A-1 asks for rings on **interactive** elements; the content `div` is a programmatic focus target with `tabIndex={-1}`. A ring there would draw a purple frame round the whole table each time it fires. It is outside the picker, which is this slice's subject, and QA rated it acceptable. **Decision: not added; recorded for SA (Q-6).** If SA rules otherwise it is one class on `:1011` (`focus-visible:ring-2 focus-visible:ring-purple-500 rounded-lg`) plus one assertion.

---

## 3. Implementation Approach and Component API

### 3.1 `AdminBusinessPicker.tsx` (C-6)

```typescript
export const BUSINESS_SEARCH_PATH = '/api/admin/business-os/llm-usage/businesses';

export interface AdminBusinessPickerProps {
  /** '' when every business is shown. Marks the current row only. */
  selectedAccountId: string;
  /** name is the picked company name, or null (unnamed business, or a pasted id). */
  onSelect: (accountId: string, name: string | null) => void;
  /** Visible label. Default "Business". */
  label?: string;
  /** The input's id. Default from useId(). The listbox and hint ids always come from useId(). */
  id?: string;
  /** Default "Filter by business name…". */
  placeholder?: string;
  /** Optional standing note under the field, linked by aria-describedby. Default none. */
  hint?: string;
}

export function AdminBusinessPicker(props: AdminBusinessPickerProps): JSX.Element;

/** §5.5 part 7: "Business: {name}" or the short id, title = the full id, X "Remove business". */
export function businessFilterChip(args: {
  accountId: string;
  name: string | null;
  onRemove: () => void;
}): AdminActiveChip;
```

| Area | Change from the original (everything else is carried over verbatim: debounce, `SEARCH_MAX_CHARS`, the pasted-UUID option first, "Unnamed business", the cap note, blur-closes-unless-inside, `onMouseDown` `preventDefault`, abort on change and unmount) |
|---|---|
| Ids (F-70) | `const base = useId()`; input `id ?? base + '-input'`; listbox `base + '-options'`; hint `base + '-hint'`; option ids `base + '-option-' + index`. Two pickers on one page never share an id |
| a11y | `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-autocomplete="list"` kept; **adds** `aria-activedescendant` pointing at the highlighted option while open (cheap now that option ids exist; makes arrow keys announced; Q-4) and `aria-describedby` = hint id when a hint is given. Escape closes the list and keeps focus in the input (A-3) |
| Label / styles | `<label htmlFor>` with `ADMIN_FIELD_LABEL`. Input class written out with the `ADMIN_FIELD_CONTROL` tokens (slate border and background, `text-sm`, `py-1.5`, `[color-scheme:dark]`, `focus-visible` purple ring) plus `w-full pl-8 pr-3`, **not** `ADMIN_FIELD_CONTROL` + `pl-8`, because that would put `px-3` and `pl-8` on one element and rely on CSS order (S-9). A test asserts every `ADMIN_FIELD_CONTROL` token except `px-3` is present, so the two cannot drift. Hint and cap note `text-slate-500` → `text-slate-400` (the F-95 contrast point) |
| Read (S-6) | `readAdminResponse(response, { what: 'the business list', pick: readBusinesses })`. A refusal shows the route's own string (the 403 "Forbidden" test holds); an unreadable body shows "Could not read the business list. Try again in a moment."; a rejected fetch shows `ADMIN_NETWORK_ERROR` and logs. "Could not load businesses" (picker copy) goes away; the route's own copy of those words is untouched |
| Logging (F-56) | `clientLogger.child({ module: 'AdminBusinessPicker' })`; message `'Business list for the business picker failed'`, context `{ err }` only |
| No fetch on mount (RC-6) | The load effect runs only while `open`; `open` starts false and nothing opens it at mount. `selectedAccountId` never triggers a read: no name lookup for an inbound id (the page shows the short id until rows or a pick name it) |
| Choose | `onSelect(option.userId, option.kind === 'business' ? option.companyName : null)`, then clear the box, close, blur (as today) |

The file header carries the original's "why" (reused route over HTTP, never an import; privacy AC-B13; platform ids ignored) in shortened form, plus a line that it is the shared folder's only fetching file (Q-3).

### 3.2 Audit trail pilot: `page.tsx`

| Where | Change |
|---|---|
| `:51` | `import { AdminBusinessPicker, businessFilterChip } from '@/app/admin/components/layout/AdminBusinessPicker';` (alias, S-1). The `./BusinessAccountPicker` import goes |
| State | `pickedBusiness` state: the picked `accountId` and its `name` (a string, or null), or null before any pick. Not in the URL (a name is not a filter). It is used only while `pickedBusiness.accountId === filters.account`, so Clear, the chip X, Back/Forward or a link to another id need no reset code |
| `:159-185` | `accountFilterLabel` → `accountFilterName(logs, userId)`, returning the name or null, order **company name → `users.full_name` → `user_email` → `users.email`** (F-31: the same chain as `auditUserLabel`, after the business name). Keeps the load-bearing `user_id === userId` filter and its comment |
| `:844-858` | `chips = filters.account ? [businessFilterChip({ accountId: filters.account, name: (picked name if it matches) ?? accountFilterName(logs, filters.account), onRemove: () => setFilters({ account: '' }) })] : []`. A picked unnamed business (name null) falls through to the rows, then the short id |
| `:887-899` | Business slot: `<div className="w-full sm:w-72"><AdminBusinessPicker selectedAccountId={filters.account} onSelect={(account, name) => { setPickedBusiness({ accountId: account, name }); setFilters({ account }); }} hint="Only accounts with a business profile can be found by name. Paste a full account id to filter by any other account." /></div>`. Label defaults to "Business" |

No change to the two `[filters]` effects, `fetchLogs`, the route params, the drawer or the pager (F-28 unchanged).

### 3.3 Visible changes on `/admin/audit-trail` (named in the PR)

1. The field label reads "Business", not "Account" (smaller grey field label like the other filters).
2. The field's focus ring is purple, not blue.
3. The chip reads "Business: Acme Dental" (or "Business: 1a2b3c4d…"), not "Account Acme Dental"; its X is named "Remove business".
4. Right after a pick, the chip names the business at once instead of showing the short id until rows load.
5. A business with no company name is labelled by the owner's full name before an email; a row's `user_email` is now used (F-31).
6. Picker error copy: the standard "Could not read the business list…" / network sentence instead of "Could not load businesses".
7. Hint and cap-note text slightly lighter (slate-400).

---

## 4. The C-14 guard changes

`layoutFolder.guard.test.ts`:

| # | Edit | Why |
|---|---|---|
| G-1 | `AdminBusinessPicker.tsx` joins `EXPECTED_SOURCES` `:68-84` | The scan must find it |
| G-2 | Header gains "Amended by L-1e"; the Audit trail registry comment `:446-449` says the original picker left the page in L-1e (still not listed: it is not on the page and is unmigrated). Registry files unchanged | Comments stay true |
| G-3 (proposed, Q-3) | New part (a) rule: `fetch(` appears in **no** shared source except `AdminBusinessPicker.tsx`, with a self-test | Keeps the shared folder's helpers fetch-free, as Health's single-fetch posture assumes; a second fetching component then needs a deliberate guard edit |

No other rule changes: the picker uses only allowed imports, no `.json(`, no region, no green.

---

## 5. Tests

### 5.1 New: `app/admin/components/layout/__tests__/AdminBusinessPicker.render.test.tsx`

Harness: two pickers on one page (labels "Business" and "Other business"), a `fetch` mock and a recording `clientLogger` mock (RC-1 shape).

| Case | Happy path | Failure / edge |
|---|---|---|
| RC-6 | Mount with `selectedAccountId` set → **zero** `fetch` calls; focus → exactly one call to `BUSINESS_SEARCH_PATH` | Typing before focus still fetches only after open |
| Ids (F-70) | The two inputs, listboxes and hints have distinct ids; each `getByLabelText` resolves its own input; `aria-controls` names an element that exists and belongs to its own picker | `id` prop overrides the input id only |
| Props | Default label "Business"; custom label; default and custom placeholder | No hint by default (no `aria-describedby`); with a hint, the text is shown and linked |
| Search | Typed text → `?search=acme`, debounced | `maxLength` 100 |
| Choose | Click "Acme Dental" → `onSelect(id, 'Acme Dental')`; box cleared, list closed | Unnamed → `onSelect(id, null)`; pasted UUID → `onSelect(uuid, null)`; partial UUID → no pasted option |
| Keyboard | ArrowDown / ArrowUp wrap; Enter picks; `aria-activedescendant` follows the highlight | Escape closes the list; focus stays on the input |
| Read | Cap note at `limit`; "No business matches that name." on empty | 403 `{ error: 'Forbidden' }` → alert "Forbidden"; HTML body (`json` throws) → "Could not read the business list. Try again in a moment.", never a parser message; rejected fetch → `ADMIN_NETWORK_ERROR` and **one** log line whose JSON contains no term and no name |
| Styles | Every `ADMIN_FIELD_CONTROL` token except `px-3` is on the input; `focus-visible:ring-purple-500` | No `ring-blue`, no `focus:ring` |
| `businessFilterChip` | name → label "Business: Acme Dental", `title` = id, `removeLabel` "Remove business", `testId` "business-filter-chip", `key` "account" | null name → "Business: " + `formatShortId(id)` |

### 5.2 Edited deliberately

| File | Edit | Reason |
|---|---|---|
| `businessPicker.contract.test.ts` | `PICKER` → `PICKERS = [original, shared]`; `SURFACE_FILES` adds `app/admin/components/layout/AdminBusinessPicker.tsx` (the one shared file, not the folder); "finds the files" expects both; "is the path the picker names" and "logs only the error" become `it.each(PICKERS)`; header comment names L-1e and L-8 | RC-7; R-11 (the original stays until L-8) |
| `businessPicker.render.test.tsx` | `:67` import from `@/app/admin/components/layout/AdminBusinessPicker`; `:224` "Remove business"; `:233`, `:237` `business-filter-chip`; `:377` new log message; **new case:** after picking "Acme Dental" with an empty log list, the chip reads "Business: Acme Dental" (the picked-name path, since no row can name it) | The swap; F-31 / E-3 |
| `accountChipLabel.render.test.tsx` | `:101` `business-filter-chip`; header comment; **new cases:** full name preferred over an email when both are loaded; `user_email` used when `users` is null; the label starts with "Business: " | F-31 |
| `presetAndDeepLink.render.test.tsx` | `:97` testid; `:104` "Remove business" | The swap |
| `filterDensity.render.test.tsx` | `:92` `'Account'` → `'Business'` | D-3 / F-70 label |
| `auditTrail.layout.render.test.tsx` | `:317` testid | The swap (found here; not in the L-1d outline) |
| `layoutFolder.guard.test.ts` | §4 | C-14 |

### 5.3 Must stay green with no edit

`businessPicker.render` `:168-175` and the F-28 mount pin `:429-437`; `accountChipLabel` "no identity lookup" `:145-157`; `searchTotals`, `auditTrail.table`, `resourceAndBusiness`, `userEmailFallback`, `userNameAndPlaceholder`, `aiCostPrecision`, `filterOptions.guard`, `auditTrailFilters`; Activity (`activityTab.render` and siblings, which render the original picker) and Finance (`financePage.render`, which mocks it); the businesses route test (`app/api/admin/business-os/llm-usage/businesses/__tests__/route.test.ts`).

---

## 6. Verification

| # | Step | Expect |
|---|---|---|
| V-1 | `npx jest app/admin/components/layout app/admin/audit-trail --ci` | all green |
| V-2 | `npx jest app/admin/finance app/admin/business-os-llm app/api/admin/business-os/llm-usage app/api/admin/audit-trail lib/audit lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci` | all green, no edit (the old picker's users) |
| V-3 | Mutation checks, each restored (md5 before = after): (a) a mount-time `useEffect(() => { void load('', new AbortController().signal) }, [])` in the shared picker → the RC-6 case, `businessPicker.render :168` and the F-28 pin fail; (b) a fixed `const base = 'admin-business-picker'` in place of `useId()` → the two-picker id case fails; (c) add `term` to the error log context → the picker log case, `businessPicker.render :365` and the contract log case fail; (d) chip name from rows only (drop the picked name) → the new `businessPicker.render` chip case fails; (e) F-31 order reverted (email before full name) → the new `accountChipLabel` case fails; (f) plant `import type { X } from '@/lib/business-os/x'` in the shared picker → the contract surface case and guard S-4 fail; (g) replace `readAdminResponse` with `await response.json()` → guard S-6 fails; (h) if G-3 is approved: a `fetch(` in `AdminFilterBar.tsx` → G-3 fails | each red, then green |
| V-4 | `npm run test:bos-entitlements` | green (nothing imports `lib/business-os/entitlements`; S-4) |
| V-5 | Scoped `tsc`: scratch tsconfig in the session scratchpad (never committed), `extends` the worktree `tsconfig.json`, `incremental: false`, absolute `include` of `next-env.d.ts`, the shared folder and its tests, `adminWindowPresets.ts`, `components/ui/sheet.tsx`, the Audit trail page, `auditTrailFilters.ts`, the original picker and the Audit trail tests, `ActivityFilters.tsx`, `FinanceFilterBar.tsx`. **Run 1:** canary `const canary: number = 'x';` in `AdminBusinessPicker.tsx` → exactly that TS2322. **Run 2:** canary removed → zero errors | both runs recorded |
| V-6 | `npm run lint:hooks`, then `npx eslint <touched files>` | no hook violation (`useId` at the top of the component); no new findings |
| V-7 | `git diff --stat feature/admin-layout-l1d` **before reading the diff** | insertions where expected, no blanked file. Absent: `app/admin/audit-trail/BusinessAccountPicker.tsx`, `components/ui/*`, `lib/**`, `app/api/**`, `app/admin/finance/**`, `app/admin/business-os-llm/**`, `AdminSidebar.tsx`, `app/admin/layout.tsx`, Health and Jobs sources |
| V-8 (QA / TL, browser) | Signed in as an admin, DevTools Network open, light **and** dark scheme emulation (SA Q-8). §6.1 | one line or screenshot per item |

The worktree's `node_modules` is a junction to the main checkout: never remove or replace it. No `git stash`, no `git worktree remove`, no commit by Dev.

### 6.1 Browser checks (V-8)

| # | Do | Expect |
|---|---|---|
| E-B1 | Open `/admin/audit-trail`; watch Network | Only the log list and the archive overview; **no** `llm-usage/businesses` request (RC-6). Field labelled "Business", the hint below it, readable in both schemes |
| E-B2 | Tab into the field | Purple ring; the list opens dark (both schemes) and one `businesses` request goes out |
| E-B3 | Type part of a name | One debounced request with `?search=`; matches listed with short ids |
| E-B4 | ArrowDown twice, Enter | The highlighted business is picked; the box clears; the list closes; the chip reads "Business: {name}" at once; one new audit request with `user_id` |
| E-B5 | Escape with the list open | The list closes; focus stays in the field |
| E-B6 | Paste a full account id with no profile | "Use this account id" offered first; picking it gives a short-id chip, then a name once rows load (if they carry one) |
| E-B7 | Click the chip's X | Chip gone; the view returns to every business; the URL drops `account` |
| E-B8 | Open a Businesses panel link (`?user_id=…`) | URL rewritten to `?account=…`; chip shows the short id, then the name from the rows; no `businesses` request |
| E-B9 | DevTools offline, focus the field | The red network sentence inside the list; the rest of the page still works |
| E-B10 | Elements panel | The field's `id`, the listbox `id` and `aria-controls` are generated values (no `audit-business-picker`) |
| E-B11 | `/admin/business-os-llm?tab=activity` and `/admin/finance` | Their pickers still say "Account" and work as before (original picker untouched) |

---

## 7. Task List

- [x] ✅ T-1 `AdminBusinessPicker.tsx` (§3.1) + `AdminBusinessPicker.render.test.tsx` (§5.1)
- [x] ✅ T-2 `layoutFolder.guard.test.ts` (§4; G-3 only if SA approves Q-3)
- [x] ✅ T-3 `businessPicker.contract.test.ts` RC-7 rewrite; green against both pickers before the page swap
- [x] ✅ T-4 `page.tsx` swap, picked-name state, `accountFilterName` (F-31), chip (§3.2)
- [x] ✅ T-5 Test edits (§5.2) and the new cases
- [x] ✅ T-6 Verification V-1 to V-7; results under Implementation Notes
- [x] ✅ T-7 Requirement sweep (E-7) and Change History
- [x] ✅ T-8 Hand over to TL for SA code review (uncommitted)

---

## 8. Sizing

| Part | Days |
|---|---|
| Shared picker (generalisation, ids, read helper, logger, chip helper) + its render test | 0.6 |
| Page swap, picked name, F-31 | 0.25 |
| Contract rewrite + 6 test-file edits + new cases | 0.35 |
| Guard, mutation checks, tsc, lint, docs | 0.3 |
| **Total** | **about 1.5 days** (matches the L-1d §12 estimate) |

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| The picked name and the rows disagree (a business renamed between pick and read) | The picked name wins only for the id it was picked for; it is the list's current name, so the newer of the two |
| `useId` values contain colons (`:r1:`), which are not valid in a CSS selector | Ids are used only in `htmlFor`, `aria-*` and `getElementById`; tests query by role and label, never by `#id` selector |
| The hint makes the Business block taller than its neighbours in an `items-end` bar | Unchanged from today (the interim has the same hint); E-B1 records it. Q-5 offers the alternative |
| The Activity and Finance pickers drift from the shared one until L-2a / L-8 / L-9 | The contract covers both (RC-7); the original is deleted in L-8 |

---

## 10. Out of scope

Editing or deleting the original picker (L-8, R-11); Activity and Finance adopting the shared picker (L-2a, L-8, L-9, finance adoption slice); a name lookup for an inbound id (RC-6 forbids it on mount); F-28 / F-98 (search sequencing and debounce); the content-area focus ring (§2.2, unless Q-6 says otherwise); `components/ui/*`.

---

## 11. Questions for SA

| # | Question | Dev lean |
|---|---|---|
| Q-1 | Name: the requirement's `AdminBusinessPicker` in `AdminBusinessPicker.tsx` (C-6), with the chip helper `businessFilterChip` in the same file returning the bar's `AdminActiveChip` (the chip stays in bar part 7, not inside the picker) | As stated |
| Q-2 | Picker error copy moves to the §5.10 helper (`readAdminResponse`, "the business list") and `ADMIN_NETWORK_ERROR`, dropping "Could not load businesses" | Adopt the standard copy |
| Q-3 | The picker is the shared folder's first `fetch(`. Add guard rule G-3 ("only `AdminBusinessPicker.tsx` may call `fetch(`") | Add it |
| Q-4 | Add `aria-activedescendant` (and option ids) to the combobox; today the highlight is not announced | Add (small, uses the new ids) |
| Q-5 | Audit trail keeps the standing hint, visible under the field (no behaviour loss; the hint test stays unedited). Alternative: show it only inside the open list | Keep it visible |
| Q-6 | The content-area focus fallback gets no ring in L-1e (§2.2) | No ring; it is not an interactive element and is outside this slice |
| Q-7 | The contract adds only the one shared file to the audit surface, not the whole shared folder (C-14 S-4 already bans `@/lib/business-os` there) | One file |
| Q-8 | The stale "until L-1e" comment on the `@/lib/logger` mock in `auditTrail.table.render.test.tsx :23` is left as is (a harmless unused mock) | Leave; tidy when that file is next edited |

---

## Implementation Notes

**Dev, 2026-10-11.** Built on `feature/admin-layout-l1e` in the worktree; nothing committed.

### Files

| File | Action |
|---|---|
| `app/admin/components/layout/AdminBusinessPicker.tsx` | created (C-6: `AdminBusinessPicker`, `businessFilterChip`, `BUSINESS_SEARCH_PATH`) |
| `app/admin/components/layout/__tests__/AdminBusinessPicker.render.test.tsx` | created (28 cases) |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` | edited (§4: G-1, G-2, new rule L-1e F-1 per M-3) |
| `app/admin/audit-trail/page.tsx` | edited (§3.2: swap, `pickedBusiness` state, `accountFilterName`, chip) |
| `app/admin/audit-trail/__tests__/businessPicker.contract.test.ts` | edited (RC-7) |
| `app/admin/audit-trail/__tests__/businessPicker.render.test.tsx` | edited (swap + one new case) |
| `app/admin/audit-trail/__tests__/accountChipLabel.render.test.tsx` | edited (testid + three new cases) |
| `app/admin/audit-trail/__tests__/presetAndDeepLink.render.test.tsx`, `filterDensity.render.test.tsx`, `auditTrail.layout.render.test.tsx` | edited (testid, X label, field label) |
| `docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md` | E-7 sweep (§1 row 4a, §6.2 C-6, §9 F-31 / F-56 / F-70, §12.2 L-1e box, Change History) |

Line endings preserved per file (the shared folder, `auditTrail.layout.render.test.tsx` and the requirement are LF; `page.tsx`, the other Audit trail tests and this workplan are CRLF).

### SA conditions, as built

| # | How |
|---|---|
| M-1 | `if (signal.aborted) return;` right after `await readAdminResponse(...)`, before any state update; the `catch` check is kept. Test "a superseded request shows no alert, and the next result is shown (SA M-1)": the first read's body rejects with an `AbortError` once typing aborts it; no alert, then the second list shows. Mutation (i) turns it red |
| M-2 | `aria-activedescendant` only when open **and** `options[highlight]` exists; ids `{base}-option-{n}` on the `role="option"` buttons; buttons `tabIndex={-1}`. Tests: the attribute names an element inside its own picker's listbox carrying the highlighted text; absent when closed; absent when the highlighted pasted row disappears; `aria-controls` resolves only while open; blur to outside closes, blur to an option does not |
| M-3 | Rule labelled "L-1e F-1": `fetch` not preceded by a letter, digit, underscore or dollar sign, then optional spaces and `(`, run on `codeOf` output; a per-file check plus a non-vacuous check that the fetching files are exactly `[AdminBusinessPicker.tsx]`; the self-test catches `fetch(`, `fetch (`, `window.fetch(` and ignores `refetch(`, `prefetch(` and a commented `fetch(` (and proves the comment would match unstripped) |
| M-4 | `'use client'` first line (also pinned by the existing guard); all seven `business-picker-*` testids kept; `x-correlation-id` header (tested); listbox `aria-label="Businesses"` (tested); `BUSINESS_SEARCH_PATH` single-quoted (the contract reads it for both pickers); `formatShortId` from `./adminTable`; `label`, `placeholder`, `id`, `hint` each have a test |
| S-1 | `readBusinesses` narrows with `isRecord` / `typeof` checks; the three `any` casts are gone |
| S-2 | Business-slot, chip and `accountFilterName` comments rewritten |
| S-3 | `AdminFilterBar.tsx`, `readAdminResponse.ts`, `readJsonBody.ts`, `DatePresets.tsx` absent from the diff (checked) |
| S-4 | For QA (browser): E-B5 also Tab out of the field; E-B10 the Accessibility pane shows `aria-activedescendant`. Two-picker id uniqueness is proved only by the render test |

### Verification (real output)

| # | Result |
|---|---|
| V-1 + V-2 | `npx jest app/admin/components/layout app/admin/audit-trail app/admin/finance app/admin/business-os-llm app/api/admin/business-os/llm-usage app/api/admin/audit-trail lib/audit lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci`: **67 suites, 1,474 tests passed**. All paths exist |
| V-3 | Each mutation red, then restored; md5 before = after for every file (picker `ccfb5ac4…`, page `9d0a6489…`, `AdminFilterBar.tsx` `527d4613…`). (a) mount-time load: 7 red (RC-6, two-picker ids, network-log and M-1 cases; `businessPicker.render` first-use, "does not touch the business list", F-28 mount pin). (b) fixed `base`: 4 red, incl. the two-picker id case. (c) `term` in the log context: 3 red (contract log case for the shared picker, the new network-log case, `businessPicker.render` "logs a failed lookup"). (d) chip from rows only: 1 red (the new picked-name case). (e) email before full name: 1 red (the new F-31 case). (f) planted `import type` from `@/lib/business-os/x`: 3 red (contract surface case for the shared file, guard S-3 and S-4). (g) `response.json()` in place of the helper: 1 red (guard S-6). (h) a `fetch(` in `AdminFilterBar.tsx`: 2 red (F-1 per-file and non-vacuous). (i) post-await abort check dropped: 1 red (the M-1 case) |
| V-4 | `npm run test:bos-entitlements`: 233 suites, 6,382 tests passed |
| V-5 | Scoped `tsc` (scratch tsconfig in the session scratchpad, never in the repo; the §6 V-5 file list, tests included). Run 1 with the canary appended to `AdminBusinessPicker.tsx`: exactly `AdminBusinessPicker.tsx(383,7): error TS2322: Type 'string' is not assignable to type 'number'.`, exit 2. Canary removed (md5 back to `ccfb5ac4…`, no "canary" left in the file). Run 2: zero errors, exit 0 |
| V-6 | Hooks config on `app/admin/components/layout` and `app/admin/audit-trail`: clean, exit 0. Default config on the ten touched code files: 12 warnings, 0 errors, all in `page.tsx` and all pre-existing (the same 12 at `d31abf10`); none from this slice |
| V-7 | `git diff --stat`: insertions where expected, no deletion-only file. Absent from the diff: the original `BusinessAccountPicker.tsx`, `app/admin/finance/**`, `app/admin/business-os-llm/**`, `lib/**`, `app/api/**`, `components/ui/*`, `AdminFilterBar.tsx`, `readAdminResponse.ts`, `readJsonBody.ts`, `DatePresets.tsx` |

### Edited tests, with reasons

| Test | Edit | Reason |
|---|---|---|
| `businessPicker.contract.test.ts` | `PICKERS = [original, shared]`; the shared file added to the surface; "finds the files" expects both; path and log cases `it.each(PICKERS)`; header names L-1e and L-8 | RC-7, R-11, SA Q-7 |
| `businessPicker.render.test.tsx` | import path; X "Remove business"; testid `business-filter-chip` (2 places); new log message; **new** "names the picked business at once" case | The swap; E-3 |
| `accountChipLabel.render.test.tsx` | testid; header note; **new** cases: full name before an email (F-31), `user_email` used when `users` is null, the label starts with "Business: " (name and short id) | F-31, §5.5 part 7 |
| `presetAndDeepLink.render.test.tsx` | testid; X "Remove business" | The swap |
| `filterDensity.render.test.tsx` | `'Account'` to `'Business'` | F-70 label |
| `auditTrail.layout.render.test.tsx` | testid | The swap |
| `layoutFolder.guard.test.ts` | §4 G-1, G-2; rule L-1e F-1 with its self-test | C-14, M-3 |

Unedited and green: `businessPicker.render` "does not touch the business list until the picker is used" and the F-28 mount pin; `accountChipLabel` "no identity lookup"; the 403 "Forbidden" case; the hint case; the Activity and Finance suites.

### Deviations

- `businessFilterChip` treats a blank name (spaces only) like null and shows the short id; tested. Not in §3.1; consistent with the picker's own blank-name rule.
- The new render test has 28 cases: the §5.1 grid plus the M-1 / M-2 / M-4 tests SA asked for and a blur (Tab) case.
- No other deviation. The `@/lib/logger` mock in `auditTrail.table.render.test.tsx` is left as is (SA Q-8).

### User-visible changes (for the PR)

The seven in §3.3, as planned: label "Business"; purple focus ring; chip "Business: {name}" (or the short id) with X "Remove business"; the chip names a just-picked business at once; the F-31 order (full name before an email, `user_email` now used); the standard error copy ("Could not read the business list. Try again in a moment." or the network sentence) instead of "Could not load businesses"; hint and cap note in slate-400. Also: arrow-key moves are now announced to screen readers (`aria-activedescendant`), and the option rows are no longer Tab stops.

### QA-1/QA-2 fix (Dev, 2026-10-11, TL decision)

| # | Fix | Test | Mutation |
|---|---|---|---|
| QA-1 (SA comment 1) | `AdminBusinessPicker.tsx`: Enter selects only when the list is open (`event.key === 'Enter' && open`) and the highlighted option exists. After Escape the options are still in state, so a bare Enter could pick a business the admin cannot see | New `AdminBusinessPicker.render` case: focus, Escape, Enter picks nothing; ArrowDown reopens and Enter picks | `open` condition removed: the new case red (1 of 29); restored, md5 equal (`c3d978d6…`) |
| QA-2 | `page.tsx` `accountFilterName`: each source is trimmed inside the search, so a whitespace-only company name, full name or email falls through to the next source | New `accountChipLabel.render` case: blank company name and blank full name give "Business: owner@acme.test" | trim removed: the new case red (1 of 14); restored, md5 equal (`9ea068a1…`) |

Re-run: `npx jest app/admin/components/layout app/admin/audit-trail --ci` gave 30 suites, 608 tests passed. Hooks lint on the two sources clean (exit 0). Scoped tsc zero errors (exit 0). Line endings unchanged (picker and its test LF; `page.tsx` and `accountChipLabel` CRLF). Nothing committed.

### Out-of-scope issues noticed (listed, not fixed)

- `page.tsx` carries 12 pre-existing ESLint warnings (unused `Calendar`, `User`, `idx`, `user`, `getSeverityColor`; six `any`; one `exhaustive-deps` on the fetch effect).
- The `AdminActiveChip` doc comment in `AdminFilterBar.tsx` still cites "Account Acme Dental" as an example (SA S-3: left until that file is next touched).

## SA Review Notes

## SA Workplan Review — 2026-10-11

**Reviewed by SA — 2026-10-11**
**Status:** ✅ Approved with conditions (M-1 to M-4 are implementation conditions, checked at code review; no re-review of the workplan needed)

Verified against the code at `d31abf10`: the original picker (fetch only while `open`, hardcoded ids, `.json()`, `createLogger`, "Account" label, blue ring), `readAdminResponse` / `readJsonBody`, `AdminActiveChip`, `ADMIN_FIELD_CONTROL` / `ADMIN_FIELD_LABEL`, the page's chip and Business slot, the C-14 guard, the contract test, and every test that names the chip, the label or the picker. The §1.3 inventory is complete: a repo-wide search for `account-filter-chip`, "Show every account", `'Account'`, `BusinessAccountPicker` and "Could not load businesses" finds nothing the plan misses (the Activity `'Account'` label pin at `activityTab.render.test.tsx:516` stays green because Activity keeps the original picker).

### Rulings on §11

| # | Ruling | Reason |
|---|---|---|
| Q-1 | **Approved as stated.** `AdminBusinessPicker` + `businessFilterChip` + `BUSINESS_SEARCH_PATH` in `AdminBusinessPicker.tsx`; the chip helper returns the bar's `AdminActiveChip` (type-only import from `./AdminFilterBar`). Key `account` is fine. | C-6 names the component; the chip stays in bar part 7 (§5.5), and the helper keeps its words in one place for L-2a / L-8 / L-9. |
| Q-2 | **Approved.** `readAdminResponse(response, { what: 'the business list', pick: readBusinesses })`, **without** `sessionEndedCopy`; `ADMIN_NETWORK_ERROR` for a rejected fetch. Picker copy "Could not load businesses" goes; the route's copy stays. | §5.10 precedence and S-6. Session-ended copy stays off: RC-4 is opt-in, the page's own list read already shows it for the same session, and the 403 "Forbidden" pin (`businessPicker.render :383-391`) holds unedited. |
| Q-3 | **Approved, with the M-3 shape.** | The folder's helpers are fetch-free by design (C-4, Health's single-fetch pin); a second fetching shared file must be a deliberate guard edit, not an accident. |
| Q-4 | **Approved, with the M-2 conditions.** | Option ids now exist, so announcing the highlight costs one attribute; without it arrow keys are silent to a screen reader. |
| Q-5 | **Keep the hint visible** on Audit trail, passed through the optional `hint` prop (default none), keeping the `business-picker-hint` testid and linked by `aria-describedby`. | C-6 asks for "optional", not "hidden"; Audit trail loses no behaviour and the hint test (`:289-298`) stays unedited. |
| Q-6 | **No ring on the content-area focus fallback.** Closed; no §9 row. | A-1 covers interactive elements; a `tabIndex={-1}` programmatic target is not one, the fallback is rare, it is outside the picker, and QA rated it acceptable. |
| Q-7 | **One file** on the contract's audit surface. | S-4 (with its self-test) already bans `@/lib/business-os` across the whole folder; listing the folder would duplicate that and bind an audit test to unrelated shared files. |
| Q-8 | **Leave** the stale "until L-1e" comment in `auditTrail.table.render.test.tsx :23`. | Harmless unused mock; no test churn in a file the slice does not otherwise touch. |

### Findings

| # | Level | Finding | Required action |
|---|---|---|---|
| M-1 | **must** | **Abort regression from the read-helper swap.** Today an aborted request rejects inside `response.json()` and the `catch` returns early on `signal.aborted`. `readJsonBody` swallows every `json()` rejection, an `AbortError` included, and returns null, so `readAdminResponse` hands back `{ ok: false, message: 'Could not read the business list…' }` for a request that was merely superseded (typing on, or closing the list). The picker would then set that error and show it on the next open until the new read lands. | After `await readAdminResponse(...)` and before any `setState`, return if `signal.aborted`. Keep the existing `catch` check too. Add one render-test case: a superseded request whose body read rejects with an `AbortError` once its signal is aborted shows no alert, and the next result is shown. Add mutation V-3 (i): drop the post-await check, the case goes red. |
| M-2 | **must** | **`aria-activedescendant` correctness (Q-4).** `highlight` is not reset when `options` shrinks without a load (the pasted-id option appears or disappears as the text changes), so `options[highlight]` can be undefined. | Set `aria-activedescendant` only when the list is open **and** `options[highlight]` exists, to that option's id; otherwise omit the attribute. Option ids `base + '-option-' + index` go on the `role="option"` elements themselves. Give the option buttons `tabIndex={-1}`, so DOM focus stays on the combobox (the pattern `aria-activedescendant` assumes) and Tab leaves the field, closing the list through the existing blur handler. Test: while arrowing, the attribute names an element that exists inside its own picker's listbox and carries the highlighted text; closed, the attribute is absent. Assert `aria-controls` resolves only while open (the listbox is not rendered when closed). |
| M-3 | **must** | **G-3 shape (Q-3).** The guard already uses "G-3" for the presets-exception check (L-1c amendment), and a naive `fetch(` match also hits `refetch(` / `prefetch(`. | Label the new rule distinctly in the guard (for example "L-1e F-1"). Match on comment-stripped code (`codeOf`): `fetch` not preceded by a letter, digit, underscore or dollar sign, then optional spaces and an opening parenthesis (so `window.fetch(` is caught, `refetch(` is not). Assert both directions: no other source file matches, **and** `AdminBusinessPicker.tsx` does (non-vacuous). Self-test: catches `fetch(`, `fetch (`, `window.fetch(`; ignores `refetch(`, `prefetch(` and a `fetch(` inside a comment. |
| M-4 | **must** | **Carry-over list is implicit.** "Everything else verbatim" must include the parts tests and users depend on. | The shared file starts with `'use client'`. Keep the testids `business-picker-input`, `-options`, `-option`, `-pasted`, `-empty`, `-truncated`, `-hint`; the `x-correlation-id` header; `aria-label="Businesses"` on the listbox; `BUSINESS_SEARCH_PATH` written as a single-quoted literal (the contract regex reads it). Use `formatShortId` from `./adminTable`, not a local copy. `label` / `placeholder` / `id` / `hint` are all C-6 gap items, so they ship, and each has a test. |
| S-1 | should | `readBusinesses` keeps three `any` casts. With `pick` it now receives `Readonly<Record<string, unknown>>`. | Narrow with `unknown` checks instead of `any` if it stays short (CLAUDE.md rule 6); if kept, the existing justification comments stay. Not a blocker. |
| S-2 | should | The page's interim comments become false. | Update the Business-slot comment (`:887-893`), the chip comment (`:847-850`) and the `accountFilterLabel` doc comment (it describes the old `email → full_name` order) when renaming to `accountFilterName`. |
| S-3 | should | V-7's "absent" list. | Add `AdminFilterBar.tsx`, `readAdminResponse.ts`, `readJsonBody.ts` and `DatePresets.tsx` to the files that must not appear in the diff (no edit is planned to any of them; the stale "Account Acme Dental" example in the `AdminActiveChip` doc comment is left until that file is next touched). |
| S-4 | should | Browser plan additions. | E-B5: also Tab out of the field; the list closes. E-B10: while arrowing, the Accessibility pane shows `aria-activedescendant` naming the highlighted option. Two-picker id uniqueness cannot be seen on any page yet; the render test is its only proof, and QA says so. |
| N-1 | note | RC-6 / F-28: confirmed. The load effect runs only while `open`, `open` starts false and only focus, typing or arrows set it; no name lookup for an inbound id. `businessPicker.render :168-175` and the mount pin `:429-437` hold unedited; V-3 (a) proves both. | — |
| N-2 | note | Logging: `clientLogger.child({ module: 'AdminBusinessPicker' })`, one `error` line with `{ err }` only, on a rejected fetch only; no log on a refusal (the route logs its own). The `businessPicker.render` `@/lib/logger/client` mock already routes to `record`, so the AC-B13 checks see the new line; only the message text at `:377` changes. The contract's context regex covers both pickers once it is `it.each(PICKERS)`. | — |
| N-3 | note | S-3 / S-4 / S-5 / S-6 / S-8: compliant as planned (`react`, `lucide-react`, `@/lib/logger/client`, folder files only; no `@/lib/business-os`, no `.json(`, no `dark:`, no `console.`, no region). `useId` has precedent in `AdminDrawer`, `DatePresets` and `KpiStrip`. | — |
| N-4 | note | Styles: writing the `ADMIN_FIELD_CONTROL` tokens out with `pl-8` instead of combining the constant with `pl-8` is the right call (S-9), and the token test stops drift. | — |
| N-5 | note | RC-7 / R-11: `PICKERS = [original, shared]` and the shared file on the audit surface cover both; the original is read-only here; Activity and Finance keep importing it; L-8 deletes it. | — |
| N-6 | note | F-31: order company name → `users.full_name` → `user_email` → `users.email` → short id matches `auditUserLabel` after the business name; the existing fallback cases stay green (checked: none sets both a full name and an email). The picked name wins only for its own id, which is correct. | — |
| N-7 | note | Chip: "Business: {name}" or "Business: " + short id, `title` = full id, X "Remove business", testid `business-filter-chip`: matches §5.5 part 7 and C-6. | — |
| N-8 | note | Scope and size: proportionate; about 1.5 days holds (M-1 to M-4 add perhaps an hour). No new pattern beyond the approved C-6. | — |

### Approval

[x] Workplan approved — proceed to implementation, with M-1 to M-4 built in and S-1 to S-4 taken where stated. Code review will check each M item and the V-3 mutation results, including V-3 (i).

## SA Code Review — 2026-10-11

**Code Review by SA — 2026-10-11**
**Status:** ✅ Code Approved (no must-fix; two Low comments and three notes below)

Reviewed the working tree against `d31abf10` only (L-1d excluded): `git status --short` and `git diff --stat HEAD` first (9 tracked files, 178 insertions / 53 deletions, no deletion-only file), then the full diff and the two new files. The original `app/admin/audit-trail/BusinessAccountPicker.tsx` has no diff. `AdminFilterBar.tsx`, `readAdminResponse.ts`, `readJsonBody.ts`, `DatePresets.tsx`, `lib/**`, `app/api/**`, `app/admin/finance/**` and `app/admin/business-os-llm/**` are absent from the diff (S-3 holds). Spot-run: `npx jest app/admin/components/layout app/admin/audit-trail app/admin/finance app/admin/business-os-llm app/api/admin/business-os/llm-usage --ci` gave 46 suites, 1,111 tests passed. No backslash in this workplan or in the requirement's added lines.

Line numbers below are `AdminBusinessPicker.tsx` unless a file is named; test lines are `AdminBusinessPicker.render.test.tsx`.

### Conditions from the workplan review

| # | Verdict | Evidence |
|---|---|---|
| M-1 | ✅ | `:152` returns on `signal.aborted` right after the awaited `readAdminResponse`, before any state update; the `catch` check is kept (`:167`); `finally` leaves `loading` alone for an aborted read (`:173`, as the original). Test `:450-484`: the first read's body rejects with an `AbortError` on abort; no alert after the supersede, the second list shows, two fetches. Without `:152`, `readJsonBody` turns the AbortError into a null body, `readAdminResponse` returns `ok: false` and the alert renders before the `:479` assertion, so the case is a real guard (Dev mutation (i) recorded red) |
| M-2 | ✅ | `:233` sets `aria-activedescendant` only when `open` and `options[highlight]` exists; option ids `{base}-option-{n}` sit on the `role="option"` buttons (`:304`); `tabIndex={-1}` (`:310`). Tests: names an option inside its own listbox carrying the highlighted text, absent when closed (`:333-354`); absent when the highlighted pasted row disappears (`:356-367`); `aria-controls` resolves only while open (`:369-379`); every option `tabindex="-1"` (`:307-315`); blur outside closes, blur to an option does not (`:395-406`) |
| M-3 | ✅ | `layoutFolder.guard.test.ts:154-160`: rule labelled "L-1e F-1", `FETCH_CALL` = `fetch` not preceded by a letter, digit, underscore or dollar sign, then optional spaces and `(`, run on `codeOf` output. Per-file check `:281-283` and the non-vacuous both-direction check `:285-289` (the picker matches, and the fetching set equals exactly that one file). Self-test `:378-388` catches `fetch(`, `fetch (`, `window.fetch(`, ignores `refetch(`, `prefetch(` and commented calls, and proves the comments would match unstripped |
| M-4 | ✅ | `'use client'` line 1; the seven `business-picker-*` testids kept (`:262`, `:279`, `:293`, `:311`, `:345`, `:354`); `x-correlation-id` header (`:144`, tested `:136-150`); `aria-label="Businesses"` (`:278`, tested `:225`); `BUSINESS_SEARCH_PATH` single-quoted (`:41`, read by the contract for both pickers); `formatShortId` from `./adminTable` (`:34`, no local copy); `label` / `placeholder` / `id` / `hint` each tested (`:177-213`) |
| S-1 | ✅ | `readBusinesses` (`:93-106`) narrows with `isRecord` / `typeof`; no `any` in the file |
| S-2 | ✅ | `page.tsx` comments for `accountFilterName` (`:159-179`), the `pickedBusiness` state (`:663-669`), the chip (`:854-857`) and the Business slot (`:897-902`) are true for the new code |
| S-3 | ✅ | The four files are absent from the diff (checked above) |
| S-4 | — | Browser items for QA (E-B5 Tab out, E-B10 Accessibility pane). Two-picker id uniqueness is proved only by test `:154-175` |

### Other checks

| Area | Verdict | Evidence |
|---|---|---|
| RC-6, no fetch on mount | ✅ | The load effect (`:179-187`) returns while `!open`; `open` starts false (`:124`); `selectedAccountId` is read only for `aria-selected`. Test `:123-134` mounts with a selected id and sees zero calls. In `businessPicker.render`, "does not touch the business list until the picker is used" and the F-28 mount pin are unedited (the diff to that file touches only the import, the X label, two testids, one new case and the log message) |
| `useId` uniqueness (F-70) | ✅ | `:117-121`; no hardcoded `audit-business-*` id; the `id` prop overrides the input id only (test `:186-197`) |
| Logging (F-56, AC-B13) | ✅ | `clientLogger.child({ module: 'AdminBusinessPicker' })` (`:38`); the single log line `:171` carries `{ err }` only and a fixed message; no log on a refusal or an unreadable body. Test `:428-448` asserts the context keys are exactly `['err']` and no term or name across two failures; the contract's context check now runs for both pickers |
| `readAdminResponse` / `readJsonBody` | ✅ | `:147` with `what: 'the business list'` and `pick`, no `sessionEndedCopy` (Q-2); no `.json(` in the file (guard S-6). A 403 shows "Forbidden" with no log (`:410-416`); an HTML body shows the fixed copy, never the parser text (`:418-426`) |
| S-3 import list | ✅ | `react`, `lucide-react`, `@/lib/logger/client`, and folder files only (`./AdminFilterBar` type-only, `./DatePresets`, `./adminTable`, `./readAdminResponse`). Nothing from `@/lib/business-os` (entitlements skill not triggered) |
| RC-7 | ✅ | `businessPicker.contract.test.ts`: `PICKERS = [original, shared]`; the path and log checks are `it.each(PICKERS)`; the shared file is on the audit surface and "finds the files" asserts both plus existence |
| F-31 order | ✅ | `page.tsx:180-188`: company name, `users.full_name`, `user_email`, `users.email`, then null (short id). Matches `auditUserLabel` (`page.tsx:155-157`) after the business name; the load-bearing `user_id === userId` filter and its comment stay. The picked name wins only for its own id (`page.tsx:858`); a picked unnamed business (null) falls through to the rows. New cases in `accountChipLabel.render` and `businessPicker.render` cover full-name-first, `user_email` with no join, and the picked-name path |
| Chip wording | ✅ | `businessFilterChip` (`:366-381`): "Business: {name}" or "Business: " + `formatShortId`, `title` = full id, `removeLabel` "Remove business", testid `business-filter-chip`, key `account`. A blank name is treated as none (recorded deviation; sensible and tested) |
| Styles | ✅ | `INPUT_CLASS` (`:57-58`) carries every `ADMIN_FIELD_CONTROL` token but `px-3`, plus `pl-8 pr-3`; purple `focus-visible` ring; drift test `:230-241`. Hint and cap note slate-400 |
| Original picker | ✅ | Unedited; Activity and Finance suites green |
| Scope | ✅ | Matches §2.1 and §3; the requirement sweep (§1 row 4a, C-6, F-31, F-56, F-70, §12.2, Change History) is accurate |
| `console.*`, `any` | ✅ | None in the new component or the page diff. The two `as any` in the new test (`:83`, `:470`) are the standard fetch stub with an eslint-disable and a reason. The page's 12 pre-existing lint warnings are untouched and listed by Dev |

### Code Review Comments

1. `AdminBusinessPicker.tsx:220-226` — Enter picks `options[highlight]` even while the list is closed. After Escape, the options from the last read are still in state, so Enter applies a filter the user cannot see; and with M-2 the `aria-activedescendant` is absent while closed, so a screen-reader user hears nothing before it happens. Carried over verbatim from the original (`BusinessAccountPicker.tsx` Enter branch), so not a regression and not blocking. Follow-up: guard the Enter branch with `open` and add one test. — Priority: Low (follow-up: the next slice that touches the picker, at the latest L-2a)
2. `docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md` §12.2 — the L-1e box is ticked before SA code review and QA. The annotation says "pending", so it is not false, but elsewhere the box is ticked on completion. RM: keep it ticked only if QA passes; otherwise untick it in the commit. — Priority: Low

### Notes (no action)

- N-1: `aria-selected` marks the applied filter, not the highlighted row. Valid ARIA for a single-select listbox where selection and the active option differ; the highlight is announced through `aria-activedescendant`.
- N-2: the error, loading and empty `<p>` lines sit inside `role="listbox"` (non-option children). Carried over from the original; `role="alert"` still announces. Candidate for a later picker touch, not this slice.
- N-3: an aborted read leaves `loading` true until the next read sets it (`:173`), as the original did; every open starts a new read, so nothing sticks on screen.

### Optimisation Suggestions

- When the picker is next touched, the comment 1 Enter guard and moving the error, loading and empty lines out of the listbox (N-2) can go together.

### Code Approved for QA: Yes

No must-fix. Fast-track: on QA PASS (including browser checks E-B1 to E-B11 with the S-4 additions, light and dark) RM may commit and open the PR. Comment 1 is a recorded follow-up, not a condition.

## QA Testing Report

## QA Report — 2026-10-11

**QA — 2026-10-11**
**Test mode:** full
**Strategy used:** A + B (Jest; jsdom render of the real component and the real page, plus throwaway probe tests deleted afterwards), and a scoped `tsc`. D (browser) is listed for TL: it needs a signed-in admin.
**Focus:** ui, api (the reused businesses route), security (logging privacy), schema (guard)
**Skipped:** live browser run (no admin session in this agent); checklist below
**Input source:** prompt keywords (TL) + workplan §5, §6

### Commands and results (real output)

| # | Command | Result |
|---|---|---|
| 1 | `npx jest app/admin/components/layout app/admin/audit-trail app/admin/finance app/admin/business-os-llm app/api/admin/business-os/llm-usage app/api/admin/audit-trail lib/audit lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci` | **67 suites, 1,474 tests passed**, 43.9 s (matches Dev V-1 + V-2) |
| 2 | `npm run test:bos-entitlements` | **233 suites, 6,382 tests passed**, exit 0 (nothing in the diff imports `lib/business-os/entitlements`) |
| 3 | Scoped `tsc -p <session scratchpad>/qa-l1e/tsconfig.json` (extends the worktree config; `noEmit`, `incremental: false`; includes `next-env.d.ts`, the whole shared folder and its tests, the whole Audit trail folder and its tests, `ActivityFilters.tsx`, `FinanceFilterBar.tsx`, and the QA probe files while they existed). Run 1 with a scratch `canary.ts` (`const canary: number = 'x'`) | exactly `canary.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.`, exit 2 |
| 4 | Same, canary file deleted | **zero errors, exit 0** |
| 5 | Throwaway probes `app/admin/components/layout/__tests__/zzqa.l1e.picker.render.test.tsx` (15 cases, component) and `app/admin/audit-trail/__tests__/zzqa.l1e.page.render.test.tsx` (7 cases, real page) | The probes written to expose a defect failed as findings (below); every other case passed. Both files deleted; `git status --short` identical before and after; nothing stashed or committed; `node_modules` untouched |

### Edge cases (throwaway probes)

| Case | Result | Notes |
|---|---|---|
| No request on picker mount, with `selectedAccountId` set | ✅ Pass | 0 calls after 50 ms |
| No request on page mount, incl. `?user_id=` and `?account=` deep links | ✅ Pass | only the audit list read; `businesses` never called |
| First open loads once, no search term; the selected row has `aria-selected="true"` | ✅ Pass | |
| Typing debounces: `a`, `ac`, `acm` quickly → one request `?search=acm` | ✅ Pass | |
| Out-of-order: `acm` resolves after `bra` (stub ignores the signal) → only Bravo shown | ✅ Pass | `acm` signal aborted; the M-1 post-await check drops it |
| Abort on close (Escape) aborts the in-flight read | ✅ Pass | |
| Pasted full UUID (padded, upper-case) → "Use this account id" first; picked as the lower-case id with `name` null; box cleared | ✅ Pass | |
| Partial UUID → no pasted row; empty message | ✅ Pass | |
| Cap note when `businesses.length >= limit` | ✅ Pass | "First 3 matches only" |
| Route 500 `{ error }` → alert shows the route's text verbatim | ✅ Pass | |
| Non-JSON 500 → "Could not read the business list. Try again in a moment.", no parser text | ✅ Pass | |
| Network failure → `ADMIN_NETWORK_ERROR`; every log line's context is exactly `{ err }`, never the typed text | ✅ Pass | |
| 200 with no `data` (shape drift) → empty message, no crash | ✅ Pass | |
| ArrowDown / ArrowUp wrap; `aria-activedescendant` follows and points inside its own listbox; Enter picks `(id, name)`; list closes | ✅ Pass | |
| Escape closes, focus stays on the input, `aria-expanded="false"`, no `aria-activedescendant` | ✅ Pass | |
| **Enter after Escape (list closed)** | ❌ Fail | picks the hidden highlighted business (QA-1; same as SA code review comment 1) |
| Tab / blur to outside closes; options `tabindex="-1"` | ✅ Pass | |
| List shrinks (pasted row disappears): `aria-activedescendant` never names a missing element | ✅ Pass | |
| Two pickers: all ids unique (closed and open), each label resolves its own input, each `aria-describedby` its own hint, `aria-controls` = the open listbox's id | ✅ Pass | |
| `aria-controls` while closed | ⚠️ Note | present, names a listbox not in the DOM (QA-3) |
| Pick on the page: URL `account=` written with `replaceState(null, …)`, never `pushState`; request carries `user_id`; chip "Business: Acme Dental" at once; chip `title` = full id | ✅ Pass | |
| X "Remove business": chip gone, `account` dropped from the URL, exactly one more audit read, zero business reads (waited 400 ms) | ✅ Pass | |
| Logs (page + picker) contain no business name and no search text after a pick with "Secret Clinic Name" typed | ✅ Pass | |
| Deep link, no name: chip `Business: 99999999…` until rows load, then the company name | ✅ Pass | |
| F-31: full name beats emails; `user_email` beats `users.email` | ✅ Pass | |
| Picked unnamed business → name from rows (full name) | ✅ Pass | |
| Picked name never reused for another id (pick Acme, then the unnamed one) → short id | ✅ Pass | |
| `businessFilterChip` whitespace name → short id | ✅ Pass | |
| **Rows with a whitespace-only `company_name`** | ⚠️ Fail (Low) | chip shows the short id instead of falling through to the full name (QA-2) |
| Stale error while a retry is in flight | ⚠️ Note | the previous alert stays until the new read lands (QA-4) |
| First paint after focus | ⚠️ Note | one render of "No business matches that name." before "Loading…" (QA-5) |
| Old picker (Activity `ActivityFilters`, Finance `FinanceFilterBar`) | ✅ Pass | file absent from the diff; Activity suites (render the original, "Account" label pin) and Finance suites green in run 1 |

### Accessibility (jsdom)

| Check | Result |
|---|---|
| `<label for>` "Business" resolves the input (`getByLabelText`) | ✅ |
| `role="combobox"`, `aria-expanded` true / false, `aria-autocomplete="list"` | ✅ |
| `aria-controls` | ⚠️ always present; resolves only while open (QA-3) |
| Listbox `role="listbox"`, `aria-label="Businesses"` | ✅ |
| Options `role="option"`, `tabindex="-1"`, `aria-selected` | ✅ |
| Hint linked by `aria-describedby` (only when a hint is given) | ✅ |
| Error `role="alert"` | ✅ |

### Issues Found

#### Bugs

1. **QA-1: Enter with the list closed picks a hidden business** — File: `app/admin/components/layout/AdminBusinessPicker.tsx` `onKeyDown` (`:220-226`) — Severity: **Medium** (SA rated the same finding Low, code review comment 1). Not a regression: carried over verbatim from the original picker; but it now ships as the shared standard every later page adopts, and this PR is the file's creation.
   - Steps: focus the Business field (list opens, first business highlighted), press Escape (list closes, focus stays, A-3), press Enter.
   - Expected: nothing; the list is closed and nothing is announced (`aria-activedescendant` correctly absent).
   - Actual: `onSelect` fires for the highlighted business; the page applies a database-level filter to a business the admin never saw chosen. Visible afterwards in the chip and reversible with X, so not High.
   - Fix (Dev): handle Enter only while `open` (`if (event.key === 'Enter' && open)`), plus one render case "Enter after Escape picks nothing". QA recommends doing it in this slice (one line + one test). If TL keeps SA's follow-up ruling instead, record it in requirement §9 with L-2a as the latest slice.

#### Edge Cases (nice to fix)

2. **QA-2: whitespace-only `business.company_name` in rows blocks the F-31 fall-through** — `page.tsx` `accountFilterName`: `'   '` is truthy, so it is returned, and `businessFilterChip` then shows the short id instead of `users.full_name` or an email. Low (the picker already treats such names as unnamed, so they can exist; the old chip printed blank text, so this is better than before). Fix: trim in each `find` predicate.
3. **QA-3: `aria-controls` names a missing element while closed** — the listbox unmounts when closed. axe accepts this on a combobox with `aria-expanded="false"`, and SA M-2 asked only that it resolve while open, so a note; TL's brief said "only when open", which would be `aria-controls={open ? listboxId : undefined}` (one existing test asserts the closed value, check before changing).
4. **QA-4: a stale error stays visible while a retry is in flight** — `error` clears only on success, so reopening or typing after a failure shows the old alert until the new read lands. Pre-existing. Low.
5. **QA-5: one render of "No business matches that name." on first open** — the read starts in `setTimeout(…, 0)`, so for one render `loading` is false and the list is empty. Pre-existing. Low (probably invisible in a browser; E-B2 can confirm).
6. Enter during the 300 ms debounce picks from the previous, still-visible results. Pre-existing and visible to the admin; note only.

#### Performance Issues

None. RC-6 holds on the component and the page; X costs one audit read and no business read; superseded reads are aborted.

### Browser checks for TL (signed-in admin; DevTools Network open; light and dark scheme emulation)

| # | Do | Expect |
|---|---|---|
| E-B1 | Open `/admin/audit-trail` | Only the log list and archive overview requests; **no** `llm-usage/businesses`. Field labelled "Business", hint below, readable in both schemes |
| E-B2 | Tab into the field | Purple ring; list opens dark; one `businesses` request (watch for a flash of "No business matches", QA-5) |
| E-B3 | Type part of a name | One debounced `?search=` request; matches with short ids |
| E-B4 | ArrowDown twice, Enter | Highlighted business picked; box clears; list closes; chip "Business: {name}" at once; one audit request with `user_id` |
| E-B5 | Escape with the list open; then Tab out (S-4) | List closes, focus stays; Tab leaves the field and the list stays closed. Also: Enter after Escape currently picks a business (QA-1) |
| E-B6 | Paste a full account id with no profile | "Use this account id" first; short-id chip, then a name once rows load (if they carry one) |
| E-B7 | Click the chip's X | Chip gone; every business shown; URL drops `account` |
| E-B8 | Open a `?user_id=…` link | URL rewritten to `?account=…`; chip short id, then the name from rows; no `businesses` request |
| E-B9 | DevTools offline, focus the field | Red network sentence inside the list; the rest of the page works |
| E-B10 | Elements and Accessibility panes while arrowing (S-4) | Generated ids (no `audit-business-picker`); `aria-activedescendant` names the highlighted option |
| E-B11 | `/admin/business-os-llm?tab=activity` and `/admin/finance` | Their pickers still say "Account" and work as before |

Two pickers on one page cannot be seen in a browser yet; id uniqueness is proved only by render tests (Dev's case and the QA probe).

### Final Status

**Verdict: PASS WITH NOTES.** Every L-1e item passes (C-6 props and ids, §5.5 part 7 chip, RC-6, RC-7, F-31, F-56, F-70, M-1 to M-4); suites green, scoped `tsc` clean with the canary proved, entitlements green. One Medium bug (QA-1, behaviour carried into the new shared file), which QA recommends fixing in this slice before RM; no High bug open. Browser checks E-B1 to E-B11 are owed to TL.

- [ ] All acceptance criteria pass — ready for commit
- [x] Issues found — QA-1 recommended for Dev before commit (TL decides against SA's follow-up ruling); QA-2 to QA-6 optional

## Commit Info

[RM will populate this section]

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-11 | Workplan written | Dev: L-1e scope (shared `AdminBusinessPicker` + chip helper, Audit trail swap, F-31, RC-6, RC-7, deferred test edits, C-14 file list); content-area ring not added (§2.2); 8 SA questions |
| 2026-10-11 | SA workplan review | APPROVED WITH CONDITIONS. Q-1 to Q-8 ruled (all as Dev leaned; Q-3 and Q-4 with conditions). M-1 abort check after the read helper; M-2 `aria-activedescendant` only for an existing option, options `tabIndex={-1}`; M-3 fetch rule shape, distinct label, non-vacuous; M-4 explicit carry-over list. S-1 to S-4 |
| 2026-10-11 | Implemented | Dev: T-1 to T-8 done, uncommitted. M-1 to M-4 and S-1 to S-3 built; V-1 to V-7 green; all nine V-3 mutations red then restored; Implementation Notes added; requirement swept (E-7) |
| 2026-10-11 | SA code review | CODE APPROVED, no must-fix. M-1 to M-4 and S-1 to S-3 verified; 46 suites / 1,111 tests green on spot-run. Low: Enter picks while the list is closed (carried over, follow-up); requirement §12.2 box ticked before QA (RM to confirm) |
| 2026-10-11 | QA report | PASS WITH NOTES: 67 suites / 1,474 tests; entitlements 233 / 6,382; scoped `tsc` clean (canary proved). QA-1 (Medium, carried over): Enter after Escape picks a hidden business, fix recommended in-slice. QA-2 to QA-6 Low / notes. Browser checks E-B1 to E-B11 owed to TL |
| 2026-10-11 | QA-1/QA-2 fixed | Dev (TL decision after SA approval and QA pass with notes): Enter selects only while the list is open; `accountFilterName` trims each source; one test each, both mutation-checked; status set ready for RM |
