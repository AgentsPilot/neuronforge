# Workplan: Finance F-2, header and states on the shared building blocks

**Developer:** Dev
**Requirement:** finance standardisation review of 2026-10-15, slice F-2 (brief from TL); [ADMIN_LAYOUT_STANDARD_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md) §5.3, §5.10; [ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md) §1 (F-0, F-1, F-3 rows)
**Branch:** `feature/finance-f2-header-states` (fast-forwarded by TL to main `8b4db932`, F-3 #420 included)
**Date:** 2026-10-15
**Status:** Code Complete (uncommitted; awaiting SA code review + QA)
**Path:** UI short path (about 1 day). No data, money, API or migration change.

## Analysis Summary

`app/admin/finance/components/FinanceView.tsx` still builds its own header and its own states:

| Today (file:line on `8b4db932`) | Standard |
|---|---|
| Own `<header>` + `<h1>` "Finance & business health" + purpose + as-of (`FinanceView.tsx:121-126`) | §5.3 / C-2: `AdminPageHeader`, h1 = sidebar label "Finance" (user decision 2026-10-15; sidebar `AdminSidebar.tsx:97`) |
| Refresh button in the header (`:127-136`) | §5.3 says Refresh lives in the filter bar. **Stays until F-4 (deviation DV-1)** |
| URL notice: hand-built amber `<p role="status">` "Note: …" (`:147-151`) | §5.10 Partial: `AdminNotice` |
| First load: `<p>Loading…</p>` (`:153`) | §5.10 Loading: `AdminLoading` "Reading {what}…" inside an always-mounted content area |
| Accounts tab waiting for its section: `<p>Loading…</p>` (`:197`) | same |
| Page error: grey row + "Retry" (`:155-162`) | §5.10 Error: `AdminError` + "Try again" |
| No `aria-busy` on the content during a refresh | §5.10 Loading (refresh): `aria-busy` on the content area |

F-3 (#420) moved `useFinanceData` onto `readAdminResponse`. Its second parameter `fallbackError` (`useFinanceData.ts:45`) now feeds only the defensive outer `catch` (`:89-94`), and `FinanceView.tsx:77` still passes `PAGE_LOAD_FAILED` (F-3 workplan step 6 deferred the removal to here).

After F-2 no file under `app/admin/finance` has an own `<h1` or a direct `.json(` (checked: today the only hit is `FinanceView.tsx:123`). So Finance could join the C-14 registry now (SA-W2).

## Implementation Approach

1. **Header.** Replace `FinanceView.tsx:121-137` with:
   ```tsx
   <AdminPageHeader title={PAGE_TITLE} purpose={PAGE_PURPOSE} asOf={data ? windowLabel : null} actions={<refresh button, unchanged>} />
   ```
   `PAGE_TITLE` becomes `'Finance'` (`financeCopy.ts:14`). The Refresh button keeps its markup, `aria-busy`, `disabled` and `onClick={reload}`. As-of stays `text-xs text-slate-400`, `data-testid="as-of"`. The purpose line gains `max-w-3xl` (the component's class).
2. **Content area.** One always-mounted `<div data-testid="finance-content" aria-busy={loading} className="space-y-4">` after the filter bar and the notice. It holds, in order:
   - the error;
   - the first-load state;
   - the data body, which is today's `:164-212` unchanged except `:197`.
   Header and filter bar stay mounted in every state, as today.
3. **States.**
   - `{error && <AdminError message={error} testId="finance-error" onRetry={reload} />}`. The testid moves from the row to the message `<p>`, so its text is exactly the message (RC-3).
   - `{loading && !data && !error && <AdminLoading what={FINANCE_WHAT} />}`.
   - Accounts tab `:197`: `<AdminLoading what={ACCOUNTS_WHAT} />`.
   - The data body keeps its gate `data && !error`. On failure the hook still clears the data (`useFinanceData.ts:84-85`, `:75`), so today's "failure clears the page" behaviour holds. No hook logic changes beyond step 5.
4. **URL notice.** `{notice && <AdminNotice testId="finance-url-notice">{notice}</AdminNotice>}`. The "Note:" prefix goes: the amber icon carries it, as on Analytics and Audit trail. The `role="status"` goes too: §5.10 Partial is a static caveat (the `AdminNotice` doc comment).
5. **SA cleanup carried from F-3.**
   - `useFinanceData(queryString)`: drop `fallbackError` from the signature (`:45`), the doc block (`:40-44`) and the deps (`:101`).
   - The outer `catch` (`:94`) shows the shared fallback "Could not read the finance page. Try again in a moment." (SA-W1 decides how).
   - `export` `FINANCE_WHAT` (`:30`) so the view's loading state names the same noun. The F-3 pin on `{ what: FINANCE_WHAT, sessionEndedCopy: true }` still matches.
   - In `FinanceView.tsx:77`, drop the `PAGE_LOAD_FAILED` argument.
6. **Copy clean-up.**
   - Delete `LOADING`, `PAGE_LOAD_FAILED` (`financeCopy.ts:37-38`) and `NOTICE_LABEL` (`:266`). After F-2 nothing reads them.
   - Add `ACCOUNTS_WHAT = 'the accounts'`.
   - `RETRY` (`:39`) stays: `FinanceSection.tsx:24,91` uses it for the per-section Retry, which is out of scope (SA-W3).
   - Import line `FinanceView.tsx:38` trimmed to match.

Kept intact (F-0, F-1, F-3):
- the contrast guard's Finance entry (`contrast.lf1.source.guard.test.ts:62-63,126-136`);
- the `ADMIN_*` table constants;
- `StatusChip` on `FinanceSection`;
- `readAdminResponse` and `clientLogger` in the hook;
- the `aiCostVocabulary` floors: `AiCostSection.tsx` 28 is untouched; `financeCopy.ts` has 458 texts against its floor of 439, measured with the guard's own `visibleTexts`, and about 456 after the change.

## Visible text, old → new

| Where | Old | New |
|---|---|---|
| h1 | Finance & business health | Finance |
| Purpose | How is Business OS doing this month: accounts, AI cost, credits, and what clients paid the businesses through the platform. | unchanged (now `max-w-3xl`) |
| As-of | `{preset}, {from} to {to} UTC` | unchanged |
| First load | Loading… | Reading the finance page… (spinner, `role="status"`) |
| Accounts tab waiting | Loading… | Reading the accounts… |
| Page error message | route error / shared sentences (F-3) | unchanged |
| Page error button | Retry | Try again |
| Page error box | grey text row, `role="alert"` | red `AdminError` box, `role="alert"`, `AlertCircle` |
| URL notice | Note: The link had a filter this page could not use, so the default view is shown. | The link had a filter this page could not use, so the default view is shown. (amber `AdminNotice`, icon, `text-sm`, no role) |
| Hook outer catch (defensive) | The finance page could not be loaded. | Could not read the finance page. Try again in a moment. |
| Refresh | Refresh (header) | unchanged, still in the header (DV-1) |

## Files to Create / Modify

| File | Action | Reason |
|------|--------|--------|
| `app/admin/finance/components/FinanceView.tsx` | modify | `:38` imports; `:77` one-arg hook; `:121-137` → `AdminPageHeader`; `:147-151` → `AdminNotice`; `:153`, `:155-162`, `:197` → shared states; content wrapper with `aria-busy` around `:153-212`; header comment notes F-2 and DV-1 |
| `app/admin/finance/useFinanceData.ts` | modify | `:30` export `FINANCE_WHAT`; `:40-45` drop `fallbackError`; `:94` shared fallback; `:101` deps |
| `app/admin/finance/financeCopy.ts` | modify | `:14` "Finance"; delete `:37-38` and `:266`; add `ACCOUNTS_WHAT` |
| `app/admin/components/layout/readAdminResponse.ts` | modify, only if SA-W1 picks (a) | `:25` `export function adminReadFallback` (no behaviour change) |
| `app/admin/finance/__tests__/financePage.render.test.tsx` | modify | `:501` heading name → `PAGE_TITLE` ("Finance") |
| `app/admin/finance/__tests__/source.guard.test.ts` | modify | `:157` `/useFinanceData\(queryString,/` → `/useFinanceData\(queryString\)/`; add a pin that FinanceView imports `AdminPageHeader` and `AdminStates` by alias and has no `<h1` |
| `app/admin/finance/__tests__/useFinanceData.render.test.tsx` | modify | `:42` delete `CALLER_FALLBACK`; `:71` `useFinanceData(q)`; add an outer-catch test (mock `readAdminResponse` to throw → `FALLBACK` at `:41`, data null, logged) |
| `app/admin/finance/__tests__/financeHeaderStates.render.test.tsx` | create | the F-2 pins listed below |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` | modify, only if SA-W2 says now | add the Finance entry to `MIGRATED_PAGES` (`:500-684`) |
| `docs/workplans/FINANCE_F2_HEADER_STATES_WORKPLAN.md` | create | this workplan |

Requirement MDs: not touched by Dev (another agent owns them).

## Tests

**Change** (they pin the old text or structure):
- `financePage.render.test.tsx:501`: heading "Finance & business health".
- `source.guard.test.ts:157`: `useFinanceData(queryString,` with two arguments.
- `useFinanceData.render.test.tsx:42,71`: the caller fallback argument.

**Unchanged and must stay green:**
- `financePage.render.test.tsx:677-681`: `finance-error` text "Business not found". It still passes, because the testid sits on the message `<p>`.
- `financePage.render.test.tsx:790-797` and `accountsTab.render.test.tsx:213-223`: the `finance-url-notice` testid is present.
- The per-section Retry tests: `financePage.render.test.tsx:587-596`, `:742-749`, `:969-972`, `:1529`.
- `useFinanceData.render.test.tsx`, everything except `:42,71`: the request pin, F-3 outcomes, newest-read-wins, the `:244` reader pin and the `:251` no-server-logger walk.
- `financeFilterBar.layout.render`, `accountsTab.render`, `financeAccount*`, `recordedCost.render`, `financeUrl`, `financeLinks`.
- `source.guard.test.ts`, the rest: AC-109 `pickedName` sinks and the Suspense wrapper.
- `lib/business-os/finance/__tests__/finance.source.guard.test.ts`: no pin on view copy.

**New** (`financeHeaderStates.render.test.tsx`):
- exactly one h1, named "Finance"; the purpose line;
- `as-of` absent before data and equal to the window label after;
- Refresh stays a header button with `aria-busy` (DV-1 pin);
- first load: "Reading the finance page…" with `role="status"` inside `finance-content`, while the header and filter bar are mounted;
- error: `role="alert"`, the `finance-error` text exactly the message, and "Try again" refetches the same URL;
- a failure after a success removes the sections (`kpi-strip` gone);
- `finance-content` is `aria-busy="true"` during a Refresh and keeps the old sections, then turns `false`;
- URL notice: the exact sentence, no "Note:", no `role`;
- Accounts tab waiting shows "Reading the accounts…".

## Guards

| Guard | Effect |
|---|---|
| `app/admin/__tests__/contrast.lf1.source.guard.test.ts` | unchanged. Finance is walked whole, and the new markup comes from the shared folder (slate-400 or lighter) |
| `layoutFolder.guard.test.ts` part (a) | unchanged; part (b) only if SA-W2 = now |
| `app/admin/__tests__/aiCostVocabulary.source.guard.test.ts` | unchanged. No forbidden phrase is added, and the floors hold (above) |
| `app/admin/finance/__tests__/source.guard.test.ts` | `:157` edit + new header/states pin |
| `useFinanceData.render.test.tsx` F-3 guards (`:236-262`) | unchanged |
| Admin authz surface (`test:authz-guard`) | unchanged. `page.tsx` stays a client page under `requireAdminPage` |

## Deviation

- **DV-1: Refresh stays in the header** (`actions`), against §5.3 and the `AdminPageHeader` prop comment ("Never Refresh"), until F-4 moves it into the filter bar. It is recorded in the `FinanceView` header comment and pinned by one test so F-4 has to remove it deliberately.
- Out of scope, noted only: region order (§5.1). The KPI strip still sits below the filter bar, inside the content. That belongs to a later finance slice, not F-2.

## SA-W questions

- **SA-W1: the hook's defensive outer `catch` message.**
  - (a) Export `adminReadFallback` from the shared `readAdminResponse.ts` and call `adminReadFallback(FINANCE_WHAT)`. One keyword is added in the shared folder and the copy keeps one home. **Recommended.**
  - (b) A local literal in `useFinanceData.ts`, which duplicates the shared sentence.
  - (c) Use `ADMIN_NETWORK_ERROR`. This mislabels a non-network failure, which F-3 deliberately avoided.
- **SA-W2: when Finance joins the C-14 registry.**
  - The brief says by F-5.
  - The F-3 workplan said F-2.
  - After F-2 the whole folder passes part (b): no `<h1`, no `.json(`, `AdminPageHeader` imported by alias.
  - Recommend **now**, listing `page.tsx`, `FinanceView.tsx` and `useFinanceData.ts`, so the gain is locked in. If SA prefers F-5, the new source pin covers FinanceView meanwhile.
- **SA-W3: two words for the same button.** After F-2 the page error says "Try again", but each section's own failure still says "Retry" (`FinanceSection.tsx:91`). Leave the sections for a later slice (recommended, so their tests stay unchanged), or switch `RETRY` to "Try again" now (4 test edits)?
- **SA-W4: the notice loses `role="status"`.** That follows `AdminNotice`'s rule (static caveat). A screen reader no longer announces the fallback on load, but it can still read it in place. Confirm this is acceptable.

## Verification Plan

1. `npx jest app/admin/finance app/admin/components --ci`
2. `npx jest app/admin/__tests__/contrast.lf1.source.guard.test.ts app/admin/__tests__/aiCostVocabulary.source.guard.test.ts lib/business-os/finance --ci`
3. `npm run test:authz-guard`
4. `npm run lint:hooks`
5. Scoped `tsc --noEmit`:
   - Use a tsconfig written to the scratchpad (outside the worktree) that extends the repo config and includes the changed files.
   - Add a planted canary (`const x: number = 'x'`) to prove the run type-checks. It must fail with the canary and pass without it.
   - Then delete the canary and the config.
6. Mutations, each restored by checksum, each must fail a test:
   - restore the own `<h1>`;
   - drop `aria-busy` from the content;
   - render the data body while `error` is set;
   - re-add "Note:".
7. `git diff --stat` before handover. Only the files above may change; deletions only where listed.
8. Read-only browser look for the user, `/admin/finance`:
   - the "Finance" title, the purpose line and the as-of line;
   - "Reading the finance page…" on a cold load;
   - `?preset=year` shows the amber notice;
   - with the network offline, Refresh shows the red box, and "Try again" recovers;
   - Refresh keeps the sections while it reads.

## Risks

| Risk | Mitigation |
|---|---|
| Moving the error inside the content area changes the DOM order tests rely on | Only testid and text pins exist (checked); the order pin at `financePage.render.test.tsx:505-508` covers sections only |
| A second `role="status"` (Accounts tab loading) at the same time as the first load | Cannot happen: the tab state needs `data`, the first-load state needs `!data` |
| Deleting copy constants breaks an importer | grep: `LOADING`, `PAGE_LOAD_FAILED` and `NOTICE_LABEL` are read only by `FinanceView.tsx`; tsc covers the rest |
| Shared-folder edit (SA-W1 a) ripples to other pages | Export only, no behaviour change; the `readAdminResponse` tests and layoutFolder S-rules run in step 1 |
| Other agents' uncommitted requirement MD edits in this worktree | Not touched; `git diff --stat` checked before handover |

## Checklist

- ✅ SA workplan review; SA-W1 to SA-W4 answered (approved with F2-R1 to F2-R3)
- ✅ Step 1: new render tests and the hook outer-catch test
- ✅ Step 2: `useFinanceData.ts`: one parameter, shared fallback, export `FINANCE_WHAT`; `adminReadFallback` exported (SA-W1 a) + F2-R1 test
- ✅ Step 3: `financeCopy.ts`: title "Finance", `RETRY` = "Try again" (F2-R2), `LOADING` / `PAGE_LOAD_FAILED` / `NOTICE_LABEL` deleted, `ACCOUNTS_WHAT` added
- ✅ Step 4: `FinanceView.tsx`: header, content wrapper, states, notice; DV-1 comment
- ✅ Step 5: pinned tests updated; Finance added to `MIGRATED_PAGES` (SA-W2)
- ✅ Step 6: verification steps 1 to 7 (results below)
- ⬜ Step 7: hand to SA code review + QA; user browser look (step 8)

## Implementation Notes

**Dev, 2026-10-15, on `8b4db932`, uncommitted.** SA rulings applied: SA-W1 (a) + F2-R1, SA-W2 now, SA-W3 / F2-R2, SA-W4, DV-1. F2-R3 is not in this slice: the notice sentence is unchanged and gets reworded with U-4 in F-4.

Files (`git diff --numstat`, insertions / deletions):

| File | +/- |
|---|---|
| `app/admin/finance/components/FinanceView.tsx` | 87 / 82. The content area body is re-indented under the new wrapper; the logic inside is unchanged |
| `app/admin/finance/useFinanceData.ts` | 13 / 9 |
| `app/admin/finance/financeCopy.ts` | 6 / 6 |
| `app/admin/components/layout/readAdminResponse.ts` | 6 / 2 (`export` + doc line only) |
| `app/admin/components/layout/__tests__/readAdminResponse.test.ts` | 8 / 1 (F2-R1) |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` | 15 / 0 (Finance entry + amendment note) |
| `app/admin/finance/__tests__/financePage.render.test.tsx` | 158 / 10 |
| `app/admin/finance/__tests__/source.guard.test.ts` | 35 / 1 |
| `app/admin/finance/__tests__/useFinanceData.render.test.tsx` | 23 / 3 |

No file has a deletion without an insertion. The three `docs/requirements/*` diffs in the worktree belong to another agent and were not touched.

**Deviations from this workplan:**
- **DV-2: no new test file.** The 9 F-2 render tests are a new `describe('Finance F-2: header and states')` block at the end of `financePage.render.test.tsx`. That reuses the page's `payload()` and `serve()` fixtures instead of copying about 350 lines of fixture into a new file.
- **The "Retry" test titles were renamed too.** Besides the three button-name pins (`:596`, `:749`, `:972` before the edit), the titles at AC-27, AC-16, AC-66, the 404 test and "both reads failed" now say "Try again". No assertion changed other than the button names.
- **Mutation 3 changed.** "Render the data body while `error` is set" cannot bite, because the hook clears the data on every failure. It was replaced by "the hook keeps the data on a route failure" (`setData(null)` removed).

**Counts:**
- `financeCopy.ts` has 456 visible texts (floor 439), measured with the guard's own `visibleTexts`.
- `AiCostSection.tsx` has 28, the same as its floor; the file is untouched.

**Verification (real results):**

| Run | Result |
|---|---|
| `npx jest app/admin/finance --ci` | 10 suites, 366 tests passed |
| `npx jest app/admin/components --ci` (incl. layoutFolder, readAdminResponse) | 23 suites, 730 tests passed |
| contrast.lf1 + aiCostVocabulary + `lib/business-os/finance/__tests__/finance.source.guard.test.ts` | 3 suites, 1123 tests passed |
| Every other test importing `readAdminResponse` (16 suites: analytics, archiving, audit-trail, invites, 6 business-os-llm, tiers, messages, 2 settings, priceReview, jobsQueues.layout) | 16 suites, 555 tests passed |
| `npm run test:authz-guard` | 2 suites, 203 tests passed |
| `npm run lint:hooks` | exit 0 |
| `npx eslint` on the 9 touched files | exit 0, no output |
| Scoped `tsc` (config in the scratchpad, extends the worktree tsconfig; 35 finance files plus the shared reader and its two tests) | with canary: exactly 1 error, `canary.ts(1,7) TS2322`; without canary: exit 0. Config deleted afterwards |
| Mutations (each restored, SHA-256 prefix checked equal before and after) | M1 own `<h1>`: 4 failed. M2 no `aria-busy` on content: 2 failed. M3 "Note:" re-added: 1 failed. M4 hook keeps data on failure: 1 failed |
| `console.` / `any` in changed source | none |

**Owed:** SA code review, QA, the user's read-only browser look (verification step 8).

## SA Review Notes

### SA Workplan Review

**Reviewed by SA — 2026-10-15, against `8b4db932`**
**Status:** ✅ **APPROVED WITH CONDITIONS** (F2-R1 to F2-R3). UI short path. No data, API or money change.

**Checked against the code**
- **The new texts are the shared components' own words.** `AdminLoading` renders "Reading {what}…" with `role="status"`. `AdminError` has `role="alert"`, the testid on the message `<p>` (RC-3) and a "Try again" button. `AdminNotice` is the amber caveat with no role, by design (its doc comment, §5.10 Partial).
- **Data is still cleared on every failure.** The hook calls `setData(null)` on the error, unknown-outcome and catch paths (`useFinanceData.ts:75`, `:84`, `:93`), and the body keeps its `data && !error` gate.
- **F-0, F-1 and F-3 stay intact:**
  - the contrast entry;
  - the `ADMIN_*` constants;
  - `StatusChip`;
  - `readAdminResponse` plus `clientLogger`;
  - `AiCostSection` is untouched, so its vocabulary floor of 28 holds;
  - `financeCopy` stays above its floor of 439.
- **DV-1 is accepted.** Refresh stays in the header `actions` until F-4, pinned by one test and named in the `FinanceView` header comment. F-4 must remove both.

**Rulings**

| # | Ruling |
|---|---|
| **SA-W1** | **(a) approved.** Exporting `adminReadFallback` from `readAdminResponse.ts` adds the `export` keyword only, with no behaviour change. It keeps the sentence in its one home (the file's own "only copy of these words" rule), and the export has a consumer (SA-R-3). **F2-R1:** a `readAdminResponse` test pins `adminReadFallback('x')` equal to the message the helper returns for a body without an error. The cross-folder edit is recorded in the follow-ups requirement's F-2 row (TL/BA). |
| **SA-W2** | **Now.** Add Finance to `MIGRATED_PAGES` with `page.tsx`, `FinanceView.tsx` and `useFinanceData.ts`, so the gain is locked in. F-4 and F-5 extend the entry. |
| **SA-W3** | **Make them consistent now (F2-R2).** Set `RETRY` to "Try again", so the page and its sections use one word for one action, the standard's word (§5.10). It is one copy constant and about 4 test edits, inside the day. `FinanceSection` keeps its own button markup; moving it onto `AdminError` is not part of F-2. |
| **SA-W4** | **Accepted.** The URL notice is a standing caveat about the view shown, not a status change, which is exactly `AdminNotice`'s no-role rule. It also keeps the page's single `role="status"` for loading, as on Analytics and Audit trail. The text stays readable in place. |

**Required changes**
1. **F2-R1:** the `adminReadFallback` equality test (SA-W1).
2. **F2-R2:** `RETRY` = "Try again", with the section Retry tests updated (`financePage.render.test.tsx:587-596`, `:742-749`, `:969-972`, `:1529`). Add a test that every retry button on the page is named "Try again".
3. **F2-R3 (note for F-4 / F-5):** BD-30 (U-4: a bad link drops only the bad filter) will make the notice's "so the default view is shown" untrue. The slice that implements U-4 must reword it. F-2 keeps today's sentence, because that is today's behaviour.

Region order (BD-29, tiles above the filter bar) stays out of F-2, as the workplan says.

### SA Code Review

**Code Review by SA — 2026-10-15** (uncommitted on `feature/finance-f2-header-states`)
**Status:** ✅ **Code Approved.** Nothing blocks QA, and there are no conditions.

**Checked against the F-2 ruling**

*The F-2 ruling items*
- **F2-R1.** `readAdminResponse.ts` adds the `export` keyword and a doc line, and nothing else. The new test pins `adminReadFallback('x')` equal to the helper's own fallback for a 500 response without an error.
- **SA-W2.** Finance is in `MIGRATED_PAGES` with `page.tsx`, `FinanceView.tsx` and `useFinanceData.ts`, and the guard passes. `grep` finds no own `<h1` and no `.json(` under `app/admin/finance` outside tests.
- **F2-R2.**
  - `RETRY` = "Try again".
  - A new test asserts that every retry-named button on the page reads "Try again".
  - The four section button pins are updated, and no assertion was removed.
- **SA-W4.** `AdminNotice`, with no role. A test pins exactly one `role="status"` during the first load.

*Header and states*
- **Header.** `AdminPageHeader` with title "Finance", `PAGE_PURPOSE`, and `asOf` shown only once data is in (the `as-of` testid comes from the component).
- **DV-1.** Refresh is still in the header `actions` with its markup unchanged, named in the header comment and pinned by one test.
- **States.**
  - **Error:** `AdminError` with `onRetry={reload}`, so the button reads "Try again".
  - **First load:** `AdminLoading`, "Reading the finance page…".
  - **Accounts tab:** "Reading the accounts…".
- **Content area.** It is always mounted and carries `aria-busy={loading}`. Refresh keeps the figures (tested).

*Hook*
- **Data is cleared on all three failure paths** (network, route, defensive catch: `setData(null)`), and error is reset at the start of each read. The new `!error` on the loading state therefore never hides a retry's spinner wrongly.
- `fallbackError` is gone from the signature, the doc block and the deps, and `PAGE_LOAD_FAILED`, `LOADING` and `NOTICE_LABEL` are deleted.

*Whitespace and hidden logic*
- **`git diff -w` of `FinanceView.tsx`:** apart from the header swap, the notice, the content wrapper, the three states, the one-argument hook call and the import lines, the only change is one extra closing `</div>`. The data body (tabs, sections, Accounts tab) is untouched logic, re-indented. No hidden change.

*Everything else unchanged*
- F-0, F-1 and F-3 are intact: the contrast entry, the `ADMIN_*` constants, `StatusChip`, `readAdminResponse` + `clientLogger`. `AiCostSection` is untouched, so its floor of 28 holds.
- No data, API, payload or money change.
- No `console.*` and no `any` in the touched files.

**Deviations**

| Deviation | Ruling |
|---|---|
| The tests are a new block in `financePage.render.test.tsx`, not a new file | ✅ **Approved.** The block reuses that file's `serve`/`payload` helpers and runs in the same suite, so there is no second copy of the fixtures. |
| Renamed test titles ("Retry" → "Try again") | ✅ **Approved.** Titles now describe what they test; no assertion changed beyond the button names. |
| Mutation 3 substituted ("the hook keeps the data on failure") | ✅ **Approved.** The original mutation could not bite, because the hook clears the data. The substitute proves the same user-visible rule (no old figures under an error) at the place it is enforced, and 1 test failed under it. |

**SA re-run** (one at a time, own exit codes)

| Run | Result |
|---|---|
| `app/admin/finance` | exit 0, 10 suites, 366 tests |
| `layoutFolder.guard`, `readAdminResponse.test`, `contrast.lf1` | exit 0, 3 suites, 470 tests |
| `aiCostVocabulary` guard | exit 0, 137 tests |
| `npm run test:authz-guard` | exit 0, 2 suites, 203 tests |

**Code Approved for QA: Yes**

## QA Testing Report

**QA — 2026-10-15**
**Test mode:** full (AC-169 to AC-172; UI short path)
**Strategy used:** A + B (render and guard suites), re-run from the worktree one command at a time; scoped `tsc` with a canary; code reading; D (read-only browser look) listed for the user.
**Focus:** ui
**Skipped:** the browser look (L-106 to L-111), for the user
**Input source:** prompt keywords from TL.
**Verdict:** ✅ **PASS**. No bug found.

**Test runs** (worktree `neuronforge-finance-health`, branch `feature/finance-f2-header-states`, uncommitted; all passed first time)

| # | Command | Result |
|---|---|---|
| Q-1 | `npx jest app/admin/finance --ci` | exit 0; **10 suites, 366 passed** |
| Q-2 | `npx jest app/admin/components --ci` | exit 0; **23 suites, 730 passed** (PASS: `layoutFolder.guard`, `readAdminResponse`) |
| Q-3 | Guards: `contrast.lf1.source.guard`, `aiCostVocabulary.source.guard`, `lib/business-os/finance/__tests__/finance.source.guard`, `app/admin/finance/__tests__/source.guard` | exit 0; **4 suites, 1,215 passed** |
| Q-4 | Every other test importing `readAdminResponse` (QA's own grep: 16 test files across analytics, archiving, audit trail, invites, 6 Business OS AI, tiers, messages, 2 settings, price review, jobs-queues layout) | exit 0; **16 suites, 555 passed** |
| Q-5 | `npx jest app/admin/users --ci` (`users/page.tsx` imports the reader) | exit 0; **25 suites, 606 passed** |
| Q-6 | `npm run test:authz-guard` | exit 0; **2 suites, 203 passed** |
| Q-7 | `npm run lint:hooks` | exit 0 |
| Q-8 | Scoped `tsc`: `tsconfig.qa-f2.json` in the session scratchpad (outside the worktree), absolute `extends`, `include` = types + the 9 changed files | **Canary** in `FinanceView.tsx` → exit 2, `FinanceView.tsx(221,7): error TS2322`. **Restored** byte-identical (`cmp`, `grep -c qaCanary` = 0). Re-run: **exit 0, 0 diagnostics** |
| Q-9 | `git diff --numstat` | 12 tracked files (3 are other agents' requirement MDs); no deletion-only file |

**Test coverage**

| AC | Result | Evidence |
|---|---|---|
| AC-169 | ✅ Pass | `AdminPageHeader` with `PAGE_TITLE = 'Finance'` (`financeCopy.ts:15`), purpose, `asOf` only with data (`FinanceView.tsx`); the F-2 describe pins exactly one h1 "Finance" and the as-of behaviour; the sidebar label is "Finance" (`AdminSidebar.tsx:97`); the page source pin: no own `<h1` |
| AC-170 | ✅ Pass | `AdminLoading what={FINANCE_WHAT}` → "Reading the finance page…"; `AdminError` with "Try again" refetching the same URL; a failure after success removes the sections; the hook clears data on every failure path (Dev mutation M4: keeping data fails a test) |
| AC-171 | ✅ Pass | `finance-content` `aria-busy={loading}` is always mounted; the F-2 test asserts `"true"` during a Refresh with the old sections kept, then `"false"` (mutation M2 fails 2 tests) |
| AC-172 | ✅ Pass | `useFinanceData(queryString)` with one parameter (page source pin); `PAGE_LOAD_FAILED`, `LOADING` and `NOTICE_LABEL` are gone (grep in `app/admin/finance` source: none); the contrast, table-constant, `StatusChip`, `readAdminResponse` / `clientLogger` and vocabulary-floor guards are green (Q-2, Q-3) |

**Edge cases**

| Case | Result | Evidence |
|---|---|---|
| First load fails: AdminError, no stale data, Try again works | Confirmed | `error && <AdminError … onRetry={reload} />`; the body is gated `data && !error`; F-2 tests |
| Refresh fails: data cleared | Confirmed | Hook `setData(null)` on error, unknown and catch paths; F-2 test "a failure after a success removes the sections" |
| `aria-busy` on only while reading | Confirmed, with one note | `aria-busy={loading}` is also `true` during the **first** load, not only a refresh. That matches §5.10 (busy while reading) and AC-171, which pins only the refresh case. Not a defect |
| Bad URL: amber notice, page still loads | Confirmed | `AdminNotice testId="finance-url-notice"`, no "Note:", no role; the query falls back to the defaults, so the data still loads (F-2 test; mutation M3) |
| Accounts tab has its own loading text | Confirmed | `AdminLoading what={ACCOUNTS_WHAT}` ("Reading the accounts…") while `data.accountEconomics` is absent; it can never coexist with the first-load status (it needs `data`) |
| Exactly one h1 "Finance", matching the sidebar | Confirmed | As AC-169 |
| Other `readAdminResponse` users unchanged | Confirmed | The shared diff is the `export` keyword plus its doc comment only; the F2-R1 equality test; Q-4 and Q-5 green |
| Section retry buttons say "Try again" | Confirmed | `RETRY = 'Try again'` (`financeCopy.ts:39`); F2-R2 test "every retry button on the page is named Try again" |

**Issues found**
- **Bugs:** none.
- **Notes (Low):** DV-1, Refresh still in the header, is accepted and pinned for F-4.

**Manual live steps** (continuing from M-4's L-105): a read-only browser look at `/admin/finance`, signed in as a platform admin

| # | Step | Expected |
|---|---|---|
| L-106 | Open `/admin/finance` | The heading reads **"Finance"** (the same word as the sidebar entry), with the purpose line under it and the as-of line once the data is in. Refresh is still at the right of the header. There is no "Finance & business health" anywhere |
| L-107 | Hard-reload (Ctrl+Shift+R) and watch the content area | Before the figures arrive: a spinner with **"Reading the finance page…"**. The header and the filter bar are already shown |
| L-108 | DevTools → Network → **Offline**, then click **Refresh** | A red box with the error message and a **"Try again"** button. The sections disappear (no stale figures). Go back Online and click **Try again**: the page reloads normally |
| L-109 | Click **Refresh** while online | The sections stay on screen while it reads (the content area is marked busy), then update |
| L-110 | Open `/admin/finance?preset=zzz` | An **amber notice** "The link had a filter this page could not use, so the default view is shown." with **no "Note:"** in front. The page loads This month normally under it |
| L-111 | Click the **Accounts** tab | While the accounts are read: **"Reading the accounts…"**, then the table. If a section fails, its button says **"Try again"** |

## Commit Info

_(RM)_
