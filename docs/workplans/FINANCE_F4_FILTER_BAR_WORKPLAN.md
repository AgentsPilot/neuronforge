# Workplan: Finance F-4, filter bar and URL state on the shared building blocks

**Developer:** Dev
**Requirement:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md) §11G (F-4 row, AC-173 to AC-177, AC-182, AC-183; user decisions BD-28 to BD-31 of 2026-10-15, final); [ADMIN_LAYOUT_STANDARD_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md) §5.5, §5.6 (U-1 to U-10), §5.8 D-2 as amended by LF-8; [ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md) row F-2/F-4/F-5
**Branch:** `feature/finance-f4-filter-bar` (from main `067c4a3e`; F-2 #424 included)
**Worktree:** `neuronforge-finance-health` (node_modules is a junction: no `git worktree remove`, no `git stash`)
**Date:** 2026-10-16
**Status:** Code Complete (SA approved the workplan with conditions F4-R1 to F4-R5; awaiting SA code review and QA)
**Path:** Full cycle, about 2 days. It touches the request path and the URL contract. No data, money, API, `lib/` or migration change.

---

## Table of Contents

- [Scope](#scope)
- [Analysis Summary](#analysis-summary)
- [Implementation Approach](#implementation-approach)
- [URL contract](#url-contract)
- [U-4 per key (bad links, BD-30)](#u-4-per-key-bad-links-bd-30)
- [Old links that must keep working](#old-links-that-must-keep-working)
- [AC-173: the byte-identical request pin (written first)](#ac-173-the-byte-identical-request-pin-written-first)
- [Visible text, old → new](#visible-text-old--new)
- [Files to Create / Modify](#files-to-create--modify)
- [Tests](#tests)
- [Guards](#guards)
- [AC mapping](#ac-mapping)
- [SA-W questions](#sa-w-questions)
- [Verification Plan](#verification-plan)
- [Risks](#risks)
- [Estimate](#estimate)
- [Checklist](#checklist)
- [Implementation Notes](#implementation-notes)
- [SA Review Notes](#sa-review-notes)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)

---

## Scope

In scope (§11G F-4 row):

1. **Filter bar:** `AdminFilterBar` with `windowControl` (`DatePresets` / `adminWindow`, `requireBothDates: true`), `business` = `AdminBusinessPicker`, `onClear`, `chips` and `help` (the existing account help line). Refresh and Read-at move into the bar, ending F-2's DV-1.
2. **Removals and labels:** delete `FinanceActiveChip` and the local preset buttons. Labels become the standard ones ("7 days", "30 days"); Custom becomes a real button.
3. **URL state:** `useAdminFilters` with canonical `range` / `from` / `to` / `account`, aliases `preset` → `range` and `accountId` → `account` (U-9). `tab`, `sort`, `group`, `show` keep their names (SA-Q44).
4. **API request unchanged:** `serialiseFinanceUrl` stays, as the API serialiser only. The request to `/api/admin/business-os/finance` and the route's Zod schema are byte-identical, pinned by a test written first (AC-173).
5. **Bad links (BD-30):** a bad value drops only that filter (U-4). No full reset, no notice.
6. **F2-R3:** the notice's "so the default view is shown" is no longer true. Recommendation: delete the notice (SA-W1).

Out of scope: KPI tiles and region order (F-5). The Accounts tab body (`AccountsTab.tsx`) is not changed. No `lib/`, `app/api/` or requirement MD edits (TL records the workplan link).

Kept intact (F-0 to F-3, F-2):
- the contrast guard's Finance entry, including the `FinanceFilterBar.tsx` path (`contrast.lf1.source.guard.test.ts:126-136`). The file is kept and rewritten, never deleted;
- the `ADMIN_*` table constants;
- `StatusChip` on `FinanceSection`;
- `readAdminResponse` and `clientLogger` in `useFinanceData`, with `useFinanceData(queryString)` taking one argument;
- the `aiCostVocabulary` floors: `AiCostSection.tsx` 28 is untouched;
- the Finance `MIGRATED_PAGES` entry (extended, not replaced);
- the "Try again" pins (F2-R2).

---

## Analysis Summary

Current finance code on `067c4a3e`:

| Today (file:line) | What it does | Standard |
|---|---|---|
| `FinanceView.tsx:83-87` | `parseFinanceUrl(useSearchParams)` → `FinanceQuery`; `serialiseFinanceUrl(query)` is both the page URL and the request | §5.6: `useAdminFilters` owns state, URL is its projection |
| `FinanceView.tsx:90-93` | Writes with `router.replace(…, { scroll: false })` | U-2: `window.history.replaceState(null, …)` inside the hook only |
| `FinanceView.tsx:96-121` | `onPick` (drops `tab`/`sort`/`group`/`show`), `onSelectTab` (leaving Accounts resets them) | kept, through `setFilters` |
| `FinanceView.tsx:126-128` | `windowLabel` from `PRESET_LABELS` ("7d", "30d") | §5.5 labels "7 days", "30 days" |
| `FinanceView.tsx:136-148` | Refresh in the header (DV-1) | §5.5 part 6: in the bar |
| `FinanceView.tsx:151-157` | Local `FinanceFilterBar` | `AdminFilterBar` |
| `FinanceView.tsx:159-160` | `AdminNotice` "…so the default view is shown." | U-4: silent; BD-30: no notice |
| `FinanceFilterBar.tsx:46-65` | Local `FinanceActiveChip` | the bar's own chip row |
| `FinanceFilterBar.tsx:101-122` | Local presets with "7d" / "30d"; Custom is a `<span>` | `DatePresets` |
| `FinanceFilterBar.tsx:125-142` | From / To / Apply always visible; `customRangeProblem` checks on Apply (`:90-94`) | `DatePresets` Custom row (only from > to is checked there, SA Q-11) |
| `FinanceFilterBar.tsx:156-158` | Help line, page-owned, `describedBy` | the bar's `help` prop |
| `financeUrl.ts:77-137` | `parseFinanceUrl`: any invalid key, or a repeated key, resets everything and sets the notice | U-4 per key |
| `financeUrl.ts:144-159` | `serialiseFinanceUrl`: `preset` always; `from`/`to` for custom; `accountId`; `tab` (no business) and non-default `sort`/`group`/`show` | kept unchanged as the request serialiser |
| `route.ts:123-161` | `buildQuerySchema`: `preset`/`from`/`to`/`accountId`/`tab`/`sort`/`group`/`show`, strict, E-48, SA-W84, custom rules | unchanged (AC-173, AC-182) |
| `route.ts:88-89` | Imports `ADMIN_WINDOW_CHOICES`, `customRangeProblem`, `isRealDate`, and `FINANCE_ACCOUNTS_SORTS`, `FINANCE_ACCOUNTS_SHOWS`, `FINANCE_GROUP_SHAPE` from `financeUrl.ts` | those exports stay byte-identical |
| `users/components/BusinessOsPanel.tsx:261` | Emits `/admin/finance?accountId={id}&preset=this_month` | legacy keys, read through aliases |
| `financeLinks.ts:110-119` | `accountViewHref` emits `preset` (+ `from`/`to`) + `accountId` | legacy keys, read through aliases |

Reference pages read: `analytics` (`AnalyticsFilterBar.tsx`, `analyticsFilters.ts`), `business-os-llm` Activity (`activityFilters.ts`, `tabWindowFilter.ts`: the "two whole dates" window field that spreads `windowFilter` and overrides `parse`), the BOS AI page-level `?tab=` writer (`business-os-llm/page.tsx:170-188`), and the shared blocks `AdminFilterBar.tsx`, `DatePresets.tsx`, `adminWindow.ts`, `useAdminFilters.ts`, `AdminBusinessPicker.tsx`.

Two facts shape the design:
- **Two writers race.** `onPick` changes `account` (a hook key) and drops `tab`/`sort`/`group`/`show` in the same click. With two writers (the hook plus a page-level `replaceState(null)` for the page keys), Next syncs `useSearchParams` once per write. The intermediate string (new `tab`, old `account`) differs from the hook's `lastKnown`, so the hook can re-parse it and undo the pick. One spec owning all eight keys writes once per change (SA-W2).
- **The finance route needs two whole dates.** It needs `from` ≤ `to`, `to` not after today UTC, and at most 92 days. `DatePresets` refuses only from > to. The window field must drop the rest on arrival, and Apply must not write a window a reload would drop (SA-W5, SA-W6).

---

## Implementation Approach

### Step 0 (first, on the unchanged code): the AC-173 pin

`app/admin/finance/__tests__/financeRequest.pin.render.test.tsx` (details in [AC-173](#ac-173-the-byte-identical-request-pin-written-first)). Run it green on `067c4a3e` before any other edit, and record the run in Implementation Notes. If the RM wants it as its own commit, it is self-contained; Dev does not commit.

### Step 1: `app/admin/finance/financeFilters.ts` (new, pure: no `'use client'`, no fetch)

Mirrors `activityFilters.ts`:

```ts
export interface FinanceFilters {
  window: AdminWindowValue;        // default { kind: 'preset', preset: 'this_month' }
  account: string;                 // '' = all businesses; lower-case UUID
  tab: '' | 'accounts';            // '' = Overview
  sort: FinanceAccountsSort;       // default 'ai_cost'
  group: string;                   // '' = every group; FINANCE_GROUP_SHAPE
  show: FinanceAccountsShow;       // default 'all'
}
export const FINANCE_DEFAULT_WINDOW: AdminWindowValue;
export const FINANCE_FILTER_SPEC: AdminFilterSpec<FinanceFilters>;   // module-level (hook requirement)
export function toFinanceQuery(filters: FinanceFilters): FinanceQuery; // the ONLY input to serialiseFinanceUrl
export function fromFinanceQuery(query: FinanceQuery): Partial<FinanceFilters>; // AccountsTab's onChange → setFilters
export function financeFilterRepair(filters: FinanceFilters): Partial<FinanceFilters> | null; // cross-key U-4
export const FINANCE_CLEAR_PATCH: Partial<FinanceFilters>;           // SA-W4
export function financeWindowProblem(value: AdminWindowValue, now: Date): string | null; // SA-W5
```

**Fields** (spec order = URL write order):
- `window`: `{ ...windowFilter({ defaultValue }), aliases: { preset: 'range' }, parse }` (SA-W7). `parse` = `base.parse(get)`, then `undefined` for:
  - `linked`;
  - `extra`;
  - `custom` with a null side;
  - `custom` where `customRangeProblem(from, to, new Date()) !== null` (SA-W6).
  `keys`, `serialise` and `equals: windowEquals` are kept (the L-8 SA M-1 rule: structural `equals`).
- `account`: own field, key `account`, `aliases: { accountId: 'account' }`, `parse` → UUID test, then `.toLowerCase()` (SA-W11), default `''`.
- `tab`: choice `['accounts']`, default `''`.
- `sort`: choice `FINANCE_ACCOUNTS_SORTS`, default `'ai_cost'`.
- `group`: text, `isValid` `FINANCE_GROUP_SHAPE.test`, default `''`.
- `show`: choice `FINANCE_ACCOUNTS_SHOWS`, default `'all'`.

The enum lists and shape come from `financeUrl.ts`, so the page and route keep ONE definition.

**`toFinanceQuery`:**
- A `preset` window becomes that `preset`; a `custom` window with both dates becomes `preset: 'custom'` with `from` / `to`; anything else falls back to `DEFAULT_FINANCE_QUERY`'s window (defensive, unreachable).
- `account` `''` becomes `null`.
- `tab` is set only when `account === ''`. `sort` / `group` / `show` are carried as they are; `serialiseFinanceUrl` already writes them only with the tab (`financeUrl.ts:152-157`).

**`financeFilterRepair`:** returns a reset of `tab` / `sort` / `group` / `show` when:
- `account` is set and any of them is not at its default; or
- `tab === ''` and any of `sort` / `group` / `show` is not at its default.

It returns `null` otherwise.

### Step 2: `app/admin/finance/financeUrl.ts` (trim; the route's imports untouched)

- Delete `FINANCE_URL_KEYS` (`:58-59`), `FINANCE_URL_NOTICE` (`:61`), `UUID_PATTERN` (`:75`) and `parseFinanceUrl` (`:77-137`).
- Drop the now-unused value imports `ADMIN_WINDOW_CHOICES` and `customRangeProblem` (`:23-27`). Keep `type AdminWindowChoice`.
- Rewrite the header comment (`:1-21`): API serialiser only, the page URL is `financeFilters.ts`.
- `FinanceQuery`, `DEFAULT_FINANCE_QUERY`, `FINANCE_ACCOUNTS_SORTS`, `FINANCE_ACCOUNTS_SHOWS`, `FINANCE_GROUP_SHAPE` and `serialiseFinanceUrl` (`:30-56`, `:63-73`, `:139-159`) stay **byte-identical**.

### Step 3: `app/admin/finance/components/FinanceFilterBar.tsx` (rewrite in place; thin wrapper, as `AnalyticsFilterBar`)

- Delete `FinanceActiveChip` (`:40-65`), the local presets (`:99-123`), the From / To / Apply fields (`:125-142`), the local `problem` state (`:82`, `:90-94`, `:160-164`) and the classes `FIELD` / `INPUT` (`:35-38`).
- Props: `filters`, `onWindowChange`, `onPick`, `onRemoveBusiness`, `chipName`, `onClear`, `canClear`, `busy`, `readAt`, `onRefresh`, `windowProblem`.
- Renders:
  ```tsx
  <AdminFilterBar what={FINANCE_WHAT} busy readAt onRefresh
    windowControl={{ value: filters.window, defaultValue: FINANCE_DEFAULT_WINDOW, onChange: onWindowChange, requireBothDates: true }}
    business={<div className="w-64"><AdminBusinessPicker selectedAccountId={filters.account} onSelect={onPick} describedBy={helpId} /></div>}
    onClear canClear
    chips={filters.account ? [businessFilterChip({ accountId: filters.account, name: chipName, onRemove: onRemoveBusiness })] : []}
    help={{ id: helpId, text: FILTER_BUSINESS_HELP, testId: 'finance-business-help' }} />
  {windowProblem && <p role="alert" className="text-xs text-red-300" data-testid="finance-window-problem">{windowProblem}</p>}
  ```
  The last line is used only under SA-W5 (a).
- Header comment: F-4 replaces the LF-6 local alignment and M-1's local chip with the shared bar.

### Step 4: `app/admin/finance/components/FinanceView.tsx`

- **Imports (`:40-62`):**
  - drop `usePathname`, `useRouter`, `useSearchParams`, `RefreshCw`, `AdminNotice`, `parseFinanceUrl`, `PRESET_LABELS` and `REFRESH`;
  - add `useAdminFilters`, `ADMIN_WINDOW_LABELS`, `FINANCE_FILTER_SPEC`, `toFinanceQuery`, `fromFinanceQuery`, `financeFilterRepair`, `FINANCE_CLEAR_PATCH` and `financeWindowProblem`.
- **`:83-88`:**
  ```ts
  const { filters, setFilters } = useAdminFilters(FINANCE_FILTER_SPEC);
  const query = useMemo(() => toFinanceQuery(filters), [filters]);
  const queryString = serialiseFinanceUrl(query);
  ```
  `useFinanceData(queryString)` is unchanged (the F-2 pin).
- **`:90-93`:** delete `setQuery` / `router.replace`. Add:
  - `setQuery = (next: FinanceQuery) => setFilters(fromFinanceQuery(next))`, for AccountsTab's `onChange` only, whose API stays `FinanceQuery`;
  - `useEffect(() => { const fix = financeFilterRepair(filters); if (fix) setFilters(fix); }, [filters, setFilters])`. It cleans the URL; no extra request, because `toFinanceQuery` already ignores the same combinations.
- **`:96-111` `onPick`:** `setPickedName(...)`, then one `setFilters({ account: accountId.toLowerCase(), tab: '', sort: 'ai_cost', group: '', show: 'all' })`. M3-FR-1 is kept; it is one write.
- **`:112-121` `onSelectTab`:** the same rules through `setFilters`.
- **`:126-128` `windowLabel`:** `ADMIN_WINDOW_LABELS[...]` (SA-W8).
- **`:132-149`:** `AdminPageHeader` loses `actions` (DV-1 ends).
- **`:151-157`:** the new `FinanceFilterBar` props:
  - `onWindowChange` checks `financeWindowProblem` first (SA-W5);
  - `onClear={() => setFilters(FINANCE_CLEAR_PATCH)}`;
  - `canClear` = any field in the patch is not at its default;
  - `readAt={data?.generatedAt ?? null}`, `busy={loading}`, `onRefresh={reload}`.
- **`:159-160`:** delete the notice (SA-W1).
- **Header comment (`:3-38`):** the URL section is rewritten for the hook. DV-1 is removed. F-4 is noted.

### Step 5: `app/admin/finance/financeCopy.ts`

- Delete `PRESET_LABELS` (`:19-25`) (SA-W8), `FILTER_FROM`, `FILTER_TO`, `FILTER_APPLY` (`:27-29`) and `REFRESH` (`:37`). The shared bar owns those words.
- `FILTER_BUSINESS_HELP` (`:35-36`) and `RETRY` (`:39`) stay.
- Re-measure the `financeCopy.ts` floor (439) with the guard's own `visibleTexts`. F-2 measured about 456; this removes at most 9, so about 447. If it lands under 439, stop and ask SA (no floor edit by Dev).

### Step 6: tests and guards (lists below), then verification

---

## URL contract

| Old key | New canonical key | Alias (read forever, never written, U-9) | Default (omitted, U-3) | Valid values | Kind |
|---|---|---|---|---|---|
| `preset` | `range` | `preset` → `range` | `this_month` | `today`, `7d`, `30d`, `this_month`, `custom` (no extras: finance has none, D-2 (b)) | standard |
| `from` | `from` | — | absent | real `YYYY-MM-DD`; only with `range=custom` or with `range` absent (implied custom, U-7) | standard |
| `to` | `to` | — | absent | as `from`; both sides required; `from` ≤ `to`, `to` ≤ today UTC, ≤ 92 days | standard |
| `accountId` | `account` | `accountId` → `account` | `''` (all businesses) | UUID, any case; lower-cased on read (SA-W11) | standard |
| `tab` | `tab` (unchanged) | — | `''` (Overview) | `accounts`; only with no business | page key (SA-Q44) |
| `sort` | `sort` (unchanged) | — | `ai_cost` | `ai_cost`, `margin`, `paid`, `credits`; only with `tab=accounts` | page key |
| `group` | `group` (unchanged) | — | `''` (every group) | `FINANCE_GROUP_SHAPE`; only with `tab=accounts` | page key |
| `show` | `show` (unchanged) | — | `all` | `all`, `active`, `negative`; only with `tab=accounts` | page key |

- **Write order:** `range`, `from`, `to`, `account`, `tab`, `sort`, `group`, `show`. Unknown keys (e.g. `utm_source`) are kept, as the hook does on every page.
- **Precedence:** a canonical key beats its alias when both are present (`?range=7d&preset=30d` → 7 days).
- **Default view:** the URL is `/admin/finance` with no query. The **request** is still `?preset=this_month`, because `serialiseFinanceUrl` always writes `preset`.
- **The page URL and the request differ by design.** The page URL is `range=7d&account=…`; the request is `preset=7d&accountId=…`. `toFinanceQuery` + `serialiseFinanceUrl` are the only bridge (U-8: "a page maps the resolved window onto its existing server params").

---

## U-4 per key (bad links, BD-30)

Each bad value is ignored silently; everything else on the link is kept; no notice. Rows marked † change the request against today on purpose, so they are not in the AC-173 pin (SA-W10).

| Link | Today | After F-4 |
|---|---|---|
| `range=year` / `preset=year` | everything reset + notice | window → This month; `account`, `tab`… kept † |
| `range=custom` with no dates | reset + notice | window → This month † (only if other keys present) |
| `range=custom&from=2026-10-05&to=2026-10-01` (from > to) | reset + notice | window → This month; rest kept † |
| `to` after today UTC, or more than 92 days, or `2026-02-30` | reset + notice | window → This month; rest kept † |
| one-sided (`range=custom&from=2026-09-01`) | reset + notice | window → This month; rest kept † (deviation from U-7, SA-W6) |
| minute / instant bounds (`from=2026-09-01T10:00`) | reset + notice | window → This month; rest kept † (deviation from U-7, SA-W6; as Analytics Q-4 / Activity) |
| `from=…&to=…` with no `range`/`preset` | This month (dates silently dropped) | custom implied (U-7) when the dates are valid † |
| `preset=7d&from=…&to=…` | 7d, dates dropped | 7 days, dates dropped (unchanged); the URL cleaned to `range=7d` |
| `accountId=acme` / `account=acme` | reset + notice | all businesses; window and tab keys kept † |
| `tab=overview`, `tab=` | reset + notice | Overview; window and account kept † |
| `tab=accounts&account=A` (SA-W84 combination) | reset + notice | business A kept; `tab`/`sort`/`group`/`show` dropped by `financeFilterRepair`, URL cleaned (SA-W3) † |
| `sort=margin` with no tab (E-48) | reset + notice | `sort` dropped, URL cleaned (SA-W3) † |
| `tab=accounts&sort=name` / `show=x` / `group=vip` | reset + notice | that one key at its default; tab kept † |
| a repeated key (`preset=7d&preset=30d`) | reset + notice | the first value wins (the hook's `get`) † |

---

## Old links that must keep working

| Source | Emits | Expected after F-4 | Test |
|---|---|---|---|
| `users/components/BusinessOsPanel.tsx:261` ("Open money view") | `/admin/finance?accountId={id}&preset=this_month` | business picked, This month; request `preset=this_month&accountId={id}`; exactly one fetch; URL rewritten to `?account={id}`; chip "Business: …" | new `financeUrlState.render.test.tsx` "BusinessOsPanel link"; `businessOsPanel.render.test.tsx:197` href pin **unchanged** |
| `financeLinks.ts:110-119` `accountViewHref` (Accounts row → one-account view), each of the 5 windows | `preset={p}[&from&to]&accountId={id}` | the same window and business; no tab; request equal to today's | `financeLinks.test.ts:130-148` rewritten to parse through `FINANCE_FILTER_SPEC` with a U-9 alias-aware getter (expects the same window and id); plus one render case per window in `financeUrlState.render.test.tsx` (real hook, request literal, one fetch) |
| Bookmarks with old keys, e.g. `?preset=custom&from=2026-09-01&to=2026-09-30&accountId=…` | — | the same view; URL canonical | AC-173 pin rows (old-key inputs) + `financeUrlState` canonical-rewrite case |
| Same-page navigation from an Accounts row (Next `Link` with legacy keys) | — | the hook re-reads the outside change, `tab` falls back to Overview (as today: `accountViewHref` carries no tab) | `financeUrlState` "outside change re-read" (re-render with a new `mockSearch`) |

Both emitters keep the legacy keys in F-4 (SA-W9). AC-174 names them as the old links that must keep working, and the alias pins prove they do.

---

## AC-173: the byte-identical request pin (written first)

**File:** `app/admin/finance/__tests__/financeRequest.pin.render.test.tsx` (new; written and run green on the unchanged `067c4a3e` before any other edit).

**Part A, the request:** for each state, render `FinanceView` with `useSearchParams` mocked to the link, wait for the read to settle, and assert:
- **exactly one** fetch;
- its URL equals the literal below;
- `{ cache: 'no-store' }`.

The `next/navigation` mock provides `useSearchParams`, `useRouter` and `usePathname`, so the same file runs before (router) and after (hook). Before each case, `window.history.replaceState(null, '', '/admin/finance')`. Custom dates are in the past and within 92 days (`2026-09-01`..`2026-09-30`), so they stay valid on any later run date.

| # | Link (old keys, valid on both sides) | Request (literal) |
|---|---|---|
| 1 | `` | `/api/admin/business-os/finance?preset=this_month` |
| 2 | `preset=today` | `…?preset=today` |
| 3 | `preset=7d` | `…?preset=7d` |
| 4 | `preset=30d` | `…?preset=30d` |
| 5 | `preset=this_month` | `…?preset=this_month` |
| 6 | `preset=custom&from=2026-09-01&to=2026-09-30` | `…?preset=custom&from=2026-09-01&to=2026-09-30` |
| 7 | `preset=this_month&accountId={A}` | `…?preset=this_month&accountId={A}` |
| 8 | `preset=7d&accountId={A upper-case}` | `…?preset=7d&accountId={A lower-case}` |
| 9 | `preset=custom&from=2026-09-01&to=2026-09-30&accountId={A}` | `…?preset=custom&from=2026-09-01&to=2026-09-30&accountId={A}` |
| 10 | `accountId={A}&preset=this_month` (BusinessOsPanel form) | `…?preset=this_month&accountId={A}` |
| 11 | `tab=accounts` | `…?preset=this_month&tab=accounts` |
| 12 | `tab=accounts&sort=margin&group=trial&show=negative` | `…?preset=this_month&tab=accounts&sort=margin&group=trial&show=negative` |
| 13 | `preset=30d&tab=accounts&group=tier%3Aessentials&show=active` | `…?preset=30d&tab=accounts&group=tier%3Aessentials&show=active` |
| 14 | `preset=custom&from=2026-09-01&to=2026-09-30&tab=accounts&sort=paid` | `…?preset=custom&from=2026-09-01&to=2026-09-30&tab=accounts&sort=paid` |
| 15 | `preset=30d&from=2020-01-01&to=2020-01-02` (a preset's client dates are dropped) | `…?preset=30d` |

The table is exported as `PINNED_REQUESTS` (state → literal) from a test-only helper, `__tests__/financeRequestPins.ts`, so the new interaction tests assert against the same literals. For example, clicking "7 days" from row 7 must fetch row 7's literal with `preset=7d`, and picking a business must fetch row 7's literal.

**Part B, the route's schema:**
- Read `app/api/admin/business-os/finance/route.ts` with CRLF normalised to LF (the F-0 / #394 lesson).
- Cut the text from `const DATE = ` through the closing `}` of `function buildQuerySchema`.
- Assert its SHA-256 equals a constant recorded at Step 0.
- Also assert the imported lists' values: `ADMIN_WINDOW_CHOICES`, `FINANCE_ACCOUNTS_SORTS`, `FINANCE_ACCOUNTS_SHOWS` and `FINANCE_GROUP_SHAPE.source`.
- A planted control (the same cut of a one-character-edited copy) must give a different hash.

**Part C, the serialiser itself:** `serialiseFinanceUrl` source pinned the same way (hash of `:139-159`), so "API serialiser only" cannot drift silently.

---

## Visible text, old → new

| Where | Old | New |
|---|---|---|
| Window buttons | Today · 7d · 30d · This month, then "Custom" as a non-button label | Today · **7 days** · **30 days** · This month · **Custom** (a real button, `aria-pressed`) |
| Window label | none (group named "Window" by `aria-label`) | visible "Window" label above the group (shared `DatePresets`) |
| From (UTC) / To (UTC) / Apply | always visible | shown after Custom is pressed, or while a custom window is applied; same words |
| Clicking the pressed preset | nothing | goes back to This month (shared SA M-2 rule) |
| Custom date problems | amber inline alert with `customRangeProblem` text, e.g. "The end date must not be after today (UTC)" | "The start date must not be after the end date" (shared, red). The other `customRangeProblem` sentences (unchanged words) appear under the bar, red `role="alert"` (SA-W5 a) |
| Refresh | header button "Refresh" (accessible name "Refresh") | in the bar: "Refresh", accessible name "Refresh the finance page", spinning icon while busy |
| Read at | none | "Read at HH:mm UTC" in the bar (from the payload's `generatedAt`) |
| Clear | none | "Clear" (disabled when nothing to clear, SA-W4) |
| Business chip | "Business: {name}" with X "Remove business", under the bar | unchanged words, in the bar's chip row |
| Help line | unchanged sentence under the row | unchanged sentence, the bar's last line (inside the bordered bar) |
| Bar frame | plain block | bordered panel, `role="search"` "Filters" |
| URL notice | "The link had a filter this page could not use, so the default view is shown." | removed (BD-30; SA-W1) |
| As-of line and every section's window label | "7d, 2026-10-03 to 2026-10-09 UTC" | "7 days, 2026-10-03 to 2026-10-09 UTC" (SA-W8). "Today", "This month", "Custom" are unchanged |
| Address bar | `?preset=7d&accountId=…`; default `?preset=this_month` | `?range=7d&account=…`; default `/admin/finance` with no query |

---

## Files to Create / Modify

| File | Action | Reason |
|------|--------|--------|
| `app/admin/finance/__tests__/financeRequest.pin.render.test.tsx` | create (Step 0) | AC-173 parts A to C |
| `app/admin/finance/__tests__/financeRequestPins.ts` | create (Step 0) | the shared literal table (test-only, no `.test.` suffix) |
| `app/admin/finance/financeFilters.ts` | create | spec, adapters, repair, clear patch, window check |
| `app/admin/finance/__tests__/financeFilters.test.ts` | create | per-key U-4, aliases, precedence, adapters, repair |
| `app/admin/finance/__tests__/financeUrlState.render.test.tsx` | create | the hook on the page: canonical rewrite, old links, interactions, single fetch |
| `app/admin/finance/financeUrl.ts` | modify | `:1-21` comment; `:23-27` imports; delete `:58-61`, `:75-137`; `:30-56`, `:63-73`, `:139-159` byte-identical |
| `app/admin/finance/components/FinanceFilterBar.tsx` | rewrite in place | thin `AdminFilterBar` wrapper (the path stays, for the contrast entry) |
| `app/admin/finance/components/FinanceView.tsx` | modify | `:3-38`, `:40-62`, `:83-128`, `:132-160` as in Step 4 |
| `app/admin/finance/financeCopy.ts` | modify | delete `:19-25`, `:27-29`, `:37` |
| `app/admin/finance/__tests__/financeFilterBar.layout.render.test.tsx` | rewrite | the LF-6 local-alignment pins become the shared-bar pins |
| `app/admin/finance/__tests__/financeUrl.test.ts` | modify | parse sections → removed (moved to `financeFilters.test.ts`); serialise tests kept with literal expectations |
| `app/admin/finance/__tests__/financePage.render.test.tsx` | modify | listed below |
| `app/admin/finance/__tests__/accountsTab.render.test.tsx` | modify | listed below |
| `app/admin/finance/__tests__/financeLinks.test.ts` | modify | `:126-148` only |
| `app/admin/finance/__tests__/source.guard.test.ts` | modify | listed below |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` | modify | Finance `MIGRATED_PAGES` entry (`:688-697`): add `FinanceFilterBar.tsx` and `financeFilters.ts`; comment "DV-1 ended in F-4" |
| `docs/workplans/FINANCE_F4_FILTER_BAR_WORKPLAN.md` | create | this workplan |

Not touched: anything under `lib/` or `app/api/` (AC-182), `app/admin/components/layout/*` (no shared change), `AccountsTab.tsx`, `useFinanceData.ts`, `financeLinks.ts`, `users/components/BusinessOsPanel.tsx`, the requirement MDs.

---

## Tests

### Must change (each one named in the PR)

| Test | Why |
|---|---|
| `financePage.render.test.tsx:794-811` "the URL is the state (AC-24)" | `preset=year` now drops only the window (no notice, request `preset=this_month`, notice absent); the preset click asserts the fetch (row 7 → `preset=7d`) and `replaceState(null, '/admin/finance?range=7d&account=A')`, not `router.replace`; the button name is "7 days" |
| `financePage.render.test.tsx:1588-1596` AC-109 after a pick | `mockReplace` → the replaceState spy and the second fetch; the name never in either |
| `:1598-1611` the picked name after a pick | no `rerender` with a new `mockSearch` is needed (the hook state changes at once); intent kept |
| `:1661-1668` chip X "Remove business" | expects the URL `/admin/finance` and a fetch with `preset=this_month` |
| `:1716-1722` clicking Accounts | expects `?tab=accounts` and the row 11 request |
| `:1845-1852` DV-1 pin | **deliberately inverted:** Refresh ("Refresh the finance page") is inside `role="search"`, not inside `<header>` |
| `:1894`, `:1908` Refresh clicks | button name "Refresh the finance page" |
| `:1917-1927` URL notice | replaced: a bad link shows no `finance-url-notice` and no amber notice (AC-175) |
| `:1829-1843` as-of | unchanged text for This month; one added case asserts "7 days, … UTC" for `range=7d` (SA-W8) |
| `accountsTab.render.test.tsx:186-190` keyboard then click | `mockReplace` → URL `/admin/finance` (Overview) |
| `:193-202` select / leave Accounts | URL assertions through the spy; leaving resets `sort`/`group`/`show` (now visible in the URL, since the hook state really changes) |
| `:204-211` pick from Accounts | URL `?account={OWNER}`; request row 7 form |
| `:213-224` malformed tab | no notice; Overview; request has no `tab=` |
| `financeUrl.test.ts:23-72`, `:125-140` (parse, notice) | deleted; their cases move to `financeFilters.test.ts` with U-4 expectations |
| `financeUrl.test.ts:79-81`, `:89-93`, `:106-119` (round trips through `parseFinanceUrl`, `FINANCE_URL_KEYS`) | replaced by literal request strings (the same strings as `PINNED_REQUESTS`) |
| `financeLinks.test.ts:126-148` | parses back through `FINANCE_FILTER_SPEC` + a U-9 alias getter instead of `parseFinanceUrl` |
| `financeFilterBar.layout.render.test.tsx` (whole file) | rewritten: `role="search"` "Filters"; the shared `DatePresets` group with the five labels; Custom is a button; the help line is the bar's last line with `finance-business-help` and the picker input's `aria-describedby`; Refresh and Read at in the bar |
| `source.guard.test.ts:70-75` | becomes: FinanceView calls `useAdminFilters(FINANCE_FILTER_SPEC)`; no `router.replace`, `router.push`, `history.replaceState` or `history.pushState` anywhere under `app/admin/finance` (S-6: only the hook writes history) |
| `source.guard.test.ts:110-129` SA-WR-39 | becomes: `FinanceActiveChip` is defined nowhere; `FinanceFilterBar.tsx` imports `AdminFilterBar` and `businessFilterChip` by alias (planted controls kept) |
| `source.guard.test.ts:145-159` AC-109 sinks | sink regex gains `setFilters(`; keeps `serialiseFinanceUrl(`, `fetch(`; `useFinanceData(queryString)` pin unchanged |
| `source.guard.test.ts` F-2 block `SHARED_STATES` | `AdminNotice` no longer required in the import (SA-W1); `HAND_NOTICE` check kept |
| `layoutFolder.guard.test.ts:688-697` | two files added to the Finance entry |

### New

- `financeRequest.pin.render.test.tsx`: AC-173 (above).
- `financeFilters.test.ts`:
  - every row of the U-4 table, per key, with the other keys kept;
  - alias reads (`preset`, `accountId`) and canonical-wins precedence;
  - lower-casing;
  - `toFinanceQuery` / `fromFinanceQuery` round trip for every `PINNED_REQUESTS` state;
  - `financeFilterRepair` cases;
  - `financeWindowProblem` (today, 93 days, future `to`);
  - `FINANCE_FILTER_SPEC` is a module-level constant (identity across imports).
- `financeUrlState.render.test.tsx`, with the real hook, real jsdom `history` and a `replaceState` spy:
  - an old-key link is rewritten to canonical keys with `replaceState(null, …)` and **one** fetch;
  - the BusinessOsPanel link;
  - `accountViewHref` for each window;
  - presets: a click writes `range` and fetches the pinned literal; a second click on the pressed preset goes back to This month;
  - Custom: the row opens; Apply is disabled until both dates are set; a valid Apply fetches the row 6 form; a 93-day Apply shows the problem and sends nothing (SA-W5 a);
  - Clear: resets per SA-W4 and stays on the tab; disabled at defaults;
  - chip X;
  - Refresh re-sends the same URL and does not touch the address bar;
  - Read at shows after the first read;
  - an outside change (new `mockSearch`) is re-read;
  - a bad link plus a good one keeps the good one with no notice (AC-175);
  - never `pushState`; never a name in the URL.

### Must stay untouched and green

- `useFinanceData.render.test.tsx` (the request pin, F-3 outcomes, the reader and logger walks).
- `financePage.render.test.tsx`, everything not listed above: the sections, Section 4, takings, problems, revenue, M-4, F2-R2 "Try again" (`:1937-1949`), first-load / error / failure-clears / aria-busy (except the Refresh name), AC-110, AC-113, AC-116.
- `financeAccount.render.test.tsx`, `financeAccount.test.ts`, `recordedCost.render.test.tsx`.
- `accountsTab.render.test.tsx`, everything not listed above (incl. `:326-341` AC-140/141, whose `onChange` is the tab's own API).
- `financeLinks.test.ts`, everything except `:126-148`.
- `users/__tests__/businessOsPanel.render.test.tsx:197` (the legacy href).
- `app/api/admin/business-os/finance/__tests__/route.test.ts` (incl. `:1445`, the `FINANCE_GROUP_SHAPE` import pin).
- Every file in `app/admin/components/layout/__tests__/` except the one `MIGRATED_PAGES` edit.
- `contrast.lf1.source.guard.test.ts` and `aiCostVocabulary.source.guard.test.ts`, with no edit.

---

## Guards

| Guard | Effect in F-4 |
|---|---|
| `layoutFolder.guard.test.ts` part (a) (S-rules, the G-2 presets exception) | unchanged; nothing added to the shared folder |
| `layoutFolder.guard.test.ts` part (b) `MIGRATED_PAGES` | Finance entry gains `FinanceFilterBar.tsx` and `financeFilters.ts`; both must import the shared folder by alias, no `<h1`, no `.json(` |
| `contrast.lf1.source.guard.test.ts` Finance entry (`:126-136`) | unchanged; `FinanceFilterBar.tsx` still exists; the new markup is shared (slate-400 or lighter); the problem line is `text-red-300` |
| `aiCostVocabulary.source.guard.test.ts` | unchanged; `AiCostSection.tsx` 28 untouched; `financeCopy.ts` ≥ 439 re-measured (Step 5) |
| `finance/__tests__/source.guard.test.ts` | edits listed above; repository, `server-only`, wire-types-only, no `console.`, Suspense, no `route.ts` under `app/admin`, M-1 dim-text, AC-112, SA-W56, 6a, M-4 blocks unchanged |
| `financeUrl.ts` purity (SA-W83, `financeUrl.test.ts` / route.test pins) | stronger: the file loses its only clock-using function |
| URL tests | `financeFilters.test.ts` (pure, per key) + `financeUrlState.render.test.tsx` (hook on the page) + AC-173 pin |
| AC-173 / AC-182 | request literals, route schema hash, serialiser hash; `git diff --stat` shows no `lib/` or `app/api/` file |
| Admin authz surface (`npm run test:authz-guard`) | unchanged: `page.tsx` stays a client page under `requireAdminPage` |
| `npm run lint:hooks` | `useAdminFilters` is a real hook; no `use…` plain functions added |

---

## AC mapping

| AC | Covered by |
|---|---|
| AC-169 to AC-172 (F-2) | stay green: header, states, aria-busy, one-argument hook, F-1/F-3 guards (only the DV-1 and Refresh-name edits above) |
| **AC-173** | `financeRequest.pin.render.test.tsx` A (15 request literals, single fetch), B (route schema hash + list values), C (serialiser hash); green on `067c4a3e` before any change, green after |
| **AC-174** | `financeUrlState`: canonical keys written; BusinessOsPanel and `accountViewHref` links (5 windows) open the same view; `financeLinks.test.ts:126-148`; `businessOsPanel.render:197` unchanged |
| **AC-175** | `financeFilters.test.ts` U-4 table; `financeUrlState` "one bad + one good"; `financePage.render` notice-absent case; `accountsTab.render:213` |
| **AC-176** | AC-173 rows 11-14; `accountsTab.render` tab tests; `financeFilters` repair cases; `onPick` drops the tab keys in one write |
| **AC-177** | `source.guard` (no `FinanceActiveChip`, shared bar by alias); `financeFilterBar.layout.render` (labels, Custom button, help); `financeUrlState` (chips, Clear, Refresh + Read at in the bar); inverted DV-1 pin |
| AC-182 | `git diff --stat` at handover; AC-173 part B |
| AC-183 | the user's read-only browser look (Verification step 9) |

---

## SA-W questions

- **SA-W1 (F2-R3): the URL notice.**
  - (a) **Delete it**, with `FINANCE_URL_NOTICE` and `AdminNotice` in `FinanceView`. BD-30 and AC-175 say "no notice", and U-4 says "silently". **Recommended.**
  - (b) Keep a reworded notice ("The link had a filter this page could not use; it was left out."), which contradicts AC-175.
  - Under (a) the F-2 guard's `SHARED_STATES` regex drops `AdminNotice`.
- **SA-W2: where the page keys live.**
  - (a) `tab` / `sort` / `group` / `show` are fields of the same `FINANCE_FILTER_SPEC`, keeping their names (SA-Q44), so every change is one hook write. **Recommended.**
  - (b) A page-level `replaceState(null)` writer, as BOS AI does for `?tab=` (U-2). Under (b), `onPick` and `onSelectTab` make two writes, and the intermediate `useSearchParams` string can be re-parsed by the hook and undo the pick ([Analysis](#analysis-summary)).
  - Under (a), `tab` is no longer an "unrelated param kept" in the U-2 sense on this page. This is a recorded page deviation.
- **SA-W3: cross-key rules under U-4.** Today, `tab` with a business, or `sort`/`group`/`show` without the tab, resets everything. Proposed:
  - keep the business and the window; drop only the dependent page keys;
  - `toFinanceQuery` ignores them at once, so no bad request is ever sent;
  - `financeFilterRepair` then cleans the URL with one `setFilters`, which sends no extra request.
  - Confirm "the bad filter" here means the dependent key (the business wins, as a pick already drops the tab, M3-FR-1).
- **SA-W4: what Clear resets.**
  - (a) Everything except `tab`: window, business, sort, group, show. This is U-3's "Clear removes every filter param and keeps `tab`" read literally. **Recommended.**
  - (b) The bar's own controls only (window, business).
  - (c) The hook's `clear()`, which also leaves the Accounts tab.
  - `canClear` follows the chosen set.
- **SA-W5: custom-window rules `DatePresets` does not check** (to after today UTC, over 92 days; SA Q-11 left them to the page).
  - (a) `FinanceView` wraps `onChange`: a custom value failing `customRangeProblem` is not applied, and its sentence shows as a red `role="alert"` line under the bar. The draft row stays open, so the admin can fix it. This keeps today's guarantee that a refused window never sends a request. It also means the URL never holds a window a reload would drop. **Recommended.**
  - (b) Apply it and let the route's 400 show in `AdminError` (Activity's SA Q-7 deviation). Under (b) a reload then silently drops it.
- **SA-W6: the window field drops more than U-7 allows.**
  - Linked (minute or instant) bounds, a one-sided custom window, and a custom window failing `customRangeProblem` (the clock is read inside `parse` with `new Date()`, as `FinanceView` did for `parseFinanceUrl`) all fall back to This month.
  - The reason: the finance route takes only two whole dates within 92 days.
  - The same recorded deviation as Analytics L-2a Q-4 and Activity `tabWindowFilter.ts`. Confirm.
- **SA-W7: the `preset` alias.** `windowFilter`'s `aliases` option is typed `'from' | 'to'` only.
  - (a) Set `aliases: { preset: 'range' }` on the finance field itself (`AdminFilterField.aliases` is `Record<string, string>`). No shared edit. **Recommended.**
  - (b) Widen the shared option type to `'range' | 'from' | 'to'`, which is a shared-folder change with its own tests.
- **SA-W8: the as-of and section window labels.** The bar shows "7 days". Should the as-of line and every section subtitle follow?
  - (a) Delete `PRESET_LABELS` and use the shared `ADMIN_WINDOW_LABELS`, so there is one label set: "7 days, … UTC". **Recommended.**
  - (b) Keep "7d" outside the bar.
  - No current test pins "7d," in a label.
- **SA-W9: the outbound emitters.** §5.6 lets the emitting page move its links to canonical keys in its own slice.
  - (a) `accountViewHref` and the BusinessOsPanel link keep `preset`/`accountId` in F-4. AC-174 names them as the old links, the alias tests prove them, and their tests stay unchanged. **Recommended.**
  - (b) Move `accountViewHref` to `range`/`account` now.
- **SA-W10: requests that change by design.** The † rows in the U-4 table change the request for that link against today:
  - a bad key next to good ones (BD-30);
  - `from`/`to` with no `range` (U-7 implied custom; today: This month);
  - a repeated key (first wins; today: full reset).
  - They are excluded from the AC-173 pin and pinned in `financeFilters.test.ts` instead. Confirm AC-173's "fixed set of page states" means valid states only.
- **SA-W11: account case.** `parseFinanceUrl` lower-cased `accountId` (`financeUrl.ts:103`). The new field lower-cases too, so pin row 8 stays byte-identical. The hook then writes the lower-cased `account` to the URL. Confirm (the shared `textFilter` keeps case, so this is a finance-local field).

---

## Verification Plan

1. **Step 0 evidence.** `npx jest app/admin/finance/__tests__/financeRequest.pin.render.test.tsx --ci` green on the unchanged tree. Record the pass count and the schema hash in Implementation Notes.
2. `npx jest app/admin/finance app/admin/users app/admin/components --ci`
3. `npx jest app/admin/__tests__/contrast.lf1.source.guard.test.ts app/admin/__tests__/aiCostVocabulary.source.guard.test.ts app/api/admin/business-os/finance lib/business-os/finance --ci`
4. `npm run test:authz-guard`
5. `npm run lint:hooks`
6. **Scoped `tsc --noEmit`.**
   - Use a tsconfig written to the scratchpad, **outside the worktree**. It extends the repo `tsconfig.json` and includes the changed and new files plus `AccountsTab.tsx` and `route.ts`.
   - Run it once with a planted canary (`const canary: number = 'x'`), which must fail, then without the canary, which must pass.
   - Delete the canary and the config.
7. **Mutations.** Restore each one by checksum. Each must fail a named test:
   - `serialiseFinanceUrl` writes `range` instead of `preset` (AC-173 A and C);
   - drop the `accountId` alias (old-link tests);
   - make the window parse return the default for the whole spec on one bad key (AC-175);
   - put Refresh back in `actions` (inverted DV-1);
   - write the URL with `router.replace` (source guard);
   - drop `financeFilterRepair` (repair / URL-clean tests);
   - edit one character in `buildQuerySchema` (part B, then restore).
8. `git diff --stat` and `git status` before handover:
   - only the files above may change;
   - nothing under `lib/` or `app/api/`;
   - no deletion without insertion except the listed removals (agent-file-write truncation check).
9. **The user's read-only browser look at `/admin/finance` (AC-183).**
   - **Presets:** Today / 7 days / 30 days / This month / Custom. The address bar shows `range=…`, and the default view has no query. Custom opens the From / To row, Apply needs both dates, and a 93-day range is refused with a sentence. Clicking the pressed preset goes back to This month.
   - **Old links:** "Open money view" from a business on `/admin/users` opens Finance for that business, and the address bar becomes `?account=…`. An Accounts-tab row opens the one-account view.
   - **A typed old bookmark:** `?preset=7d&accountId=<id>` opens 7 days for that business.
   - **Bad link:** `?range=year&account=<id>` shows This month for that business, with no notice. `?account=acme&range=7d` shows 7 days for all businesses.
   - **Bar:** Refresh and "Read at" sit in the bar (none in the header). Clear works. The chip X returns to all businesses.

---

## Risks

| Risk | Mitigation |
|---|---|
| The alias rewrite on mount re-renders and sends a second request | The hook records `lastKnown` before writing, and the filters keep their identity; every old-link test asserts **one** fetch |
| Two writers per click undo a business pick | SA-W2 (a): one spec, one writer |
| The request drifts while the page URL changes | AC-173 A/B/C written first; `toFinanceQuery` is the only bridge and is unit-tested against the same literals |
| Clock inside `parse` (custom validation) makes a link valid today but not later | Intended: a window older than the route allows falls back (U-4) exactly as the route would refuse it; tests use past dates within 92 days, so they do not age |
| A test still mocks `useRouter` and asserts `mockReplace` | Listed edits; the source guard forbids `router.replace` in the folder, so a stale assertion fails loudly rather than passing vacuously |
| Section subtitles change ("7 days") beyond the bar | SA-W8; grep shows no test pins "7d,"; covered by one new as-of case |
| `financeCopy.ts` vocabulary floor | Re-measured with the guard's function; stop and ask SA if under 439 |
| Contrast guard expects `FinanceFilterBar.tsx` | The file is kept (rewritten), never deleted |
| CRLF on Windows breaks the schema-hash cut | LF normalisation before cutting (F-0 / #394 lesson) |
| Shared `node_modules` junction / other sessions' WIP | No `git stash`, no `git worktree remove`; requirement MDs untouched; `git diff --stat` before handover |
| A visible behaviour change surprises the user (From/To hidden until Custom; second click resets) | Listed in the old → new table; part of the browser look |

---

## Estimate

About 2 days.

| Work | Time |
|---|---|
| Step 0, the AC-173 pin (A, B, C) | 0.25 d |
| `financeFilters.ts` + its unit tests | 0.5 d |
| `FinanceFilterBar` / `FinanceView` / copy / `financeUrl` trim | 0.5 d |
| Test edits (page, Accounts tab, links, layout, source guard) + `financeUrlState` | 0.5 d |
| Verification, mutations, tsc canary | 0.25 d |

---

## Checklist

- ⬜ SA workplan review; SA-W1 to SA-W11 answered
- ✅ Step 0: AC-173 pin (A, B, C) written and green on unchanged `067c4a3e`; result recorded
- ✅ Step 1: `financeFilters.ts` + `financeFilters.test.ts`
- ✅ Step 2: `financeUrl.ts` trimmed; the route's imports and `serialiseFinanceUrl` byte-identical
- ✅ Step 3: `FinanceFilterBar.tsx` rewritten on `AdminFilterBar`; `FinanceActiveChip` and local presets gone
- ✅ Step 4: `FinanceView.tsx` on `useAdminFilters`; Refresh and Read at in the bar (DV-1 ended); notice per SA-W1
- ✅ Step 5: `financeCopy.ts` trimmed; vocabulary floor re-measured
- ✅ Step 6: test edits and new tests; guard edits (`source.guard`, `MIGRATED_PAGES`)
- ✅ Step 7: verification steps 1 to 8; results in Implementation Notes
- ⬜ Step 8: hand to SA code review + QA; the user's browser look (step 9)

---

## Implementation Notes

### Step 0 (F4-R1, F4-R5): the AC-173 pin, on the unchanged tree

- HEAD `067c4a3ef3467610665eec79ee49b4479b805d97`; no source file edited yet (only the two new test files below exist).
- `npx jest app/admin/finance/__tests__/financeRequest.pin.render.test.tsx app/admin/finance/__tests__/financeRequestPins.ts --ci` → **Test Suites: 2 passed, 2 total; Tests: 22 passed, 22 total** (part A 15 rows, part B 3, part C 2, plus the table self-check, which runs in both files).
- Recorded constants: route `DATE` + `buildQuerySchema` SHA-256 `da2682843092d8a64b1ba46daaf884f33521f69cfd3b23e8c95506c2459ed87f`; `serialiseFinanceUrl` (with its doc comment) SHA-256 `60518fb6b4129371bb2fba2d248de5f28e0b60266e9df15c1917f9904fe0dcd8`.
- **Pin file hashes at Step 0** (`sha256sum`, F4-R5):
  - `app/admin/finance/__tests__/financeRequest.pin.render.test.tsx` → `4583aa2108f55de24823f1b8c5b3c16629be1b25470d66f9221cb88e0f3c0ea6`
  - `app/admin/finance/__tests__/financeRequestPins.ts` → `b84e0c961e60c994414af7b418dd7f9dc94273e45695d632956427fade68aabf`
- Deviation (Jest constraint, no behaviour): `jest.config.js` collects every `.ts` under `__tests__/`, so `financeRequestPins.ts` carries one self-check of the table (rows 1-15, every request on the route) instead of being a pure helper. A file importing it runs that check too.
- Part A settles each read on a 404 body (`finance-error`), so no payload fixture is needed; it then flushes one macrotask before counting fetches.

### Steps 1-6: what was built

- `financeFilters.ts` (new, pure): `FINANCE_FILTER_SPEC` (window with `aliases: { preset: 'range' }` and the SA-W6 narrowed parse; `account` with `aliases: { accountId: 'account' }`, lower-cased; `tab` / `sort` / `group` / `show` as spec fields), `toFinanceQuery`, `fromFinanceQuery`, `financeFilterRepair`, `FINANCE_CLEAR_PATCH`, `financeWindowProblem`, plus one small addition, `financeCanClear` (the SA-W4 `canClear`, kept pure so it is unit-tested).
- `financeUrl.ts`: `FINANCE_URL_KEYS`, `FINANCE_URL_NOTICE`, `UUID_PATTERN`, `parseFinanceUrl` deleted; imports now type-only; header rewritten. `serialiseFinanceUrl` hash unchanged (part C green).
- `FinanceFilterBar.tsx`: rewritten in place as a thin `AdminFilterBar` wrapper; `FinanceActiveChip` (a function inside this file, not a file of its own), local presets, From/To/Apply and the local problem state are gone. No file was deleted in F-4.
- `FinanceView.tsx`: `useAdminFilters(FINANCE_FILTER_SPEC)`; the repair effect; SA-W5 (a) refusal on `onWindowChange`; Refresh and Read at in the bar; header `actions` removed (DV-1 ended); notice removed (SA-W1); `ADMIN_WINDOW_LABELS` (SA-W8). One small fix beyond the plan: `onPick` holds the picked name against the lower-cased id, so an upper-case pick still shows its name in the chip.
- `financeCopy.ts`: `PRESET_LABELS`, `FILTER_FROM`, `FILTER_TO`, `FILTER_APPLY`, `REFRESH` deleted. Vocabulary floor re-measured with the guard's own `visibleTexts` (temporary copy of the guard, removed): **financeCopy.ts 447** (floor 439, no floor edit), **AiCostSection.tsx 28** (unchanged).
- Tests: as listed in [Tests](#tests). Two test-only adjustments not in the list: `accountsTab.render.test.tsx` stubs the seven Overview section components and adds `credits.farOverAllowancePercent` to its tab-only payload, because leaving the tab now renders the Overview at once with the stale tab payload; `financeUrlState.render.test.tsx` sets `jest.setTimeout(30_000)` (a full parallel run timed one case out at 5 s and the timeout leaked into the next cases). "Read at" and the "7 days" as-of case went into `financePage.render.test.tsx`, which has the full payload fixture.

### F4-R1: deliberate request changes (E-60), each pinned with its new literal in `financeUrlState.render.test.tsx`

| # | Link | Request before F-4 | Request after F-4 |
|---|---|---|---|
| 1 | `preset=7d&accountId=acme&tab=accounts&sort=margin` (one bad value among good ones) | `preset=this_month` | `preset=7d&tab=accounts&sort=margin` |
| 2a | `tab=accounts&account=A&sort=margin` (business with the tab) | `preset=this_month` | `preset=this_month&accountId=A` (row 7) |
| 2b | `preset=30d&sort=margin&show=active` (sort/show without the tab) | `preset=this_month` | `preset=30d` |
| 3 | `from=2026-09-01&to=2026-09-30&accountId=A` (no range) | `preset=this_month&accountId=A` | `preset=custom&from=2026-09-01&to=2026-09-30&accountId=A` |
| 4 | `preset=7d&preset=30d` (repeated key) | `preset=this_month` | `preset=7d` |

- **F4-R2:** cases 2a and 2b assert exactly one fetch and the cleaned URL (`?account=A`, `?range=30d`). Mutations m3 and m6 below turn exactly those two red.
- **F4-R3:** six cases in `financeUrlState.render.test.tsx` ("SA-W5 (a) and F4-R3"): refused > 92 days and end after today (red `role="alert"`, no read, no `replaceState`, row still open, nothing in the URL), then cleared by a valid Apply, a preset click, Clear, and an outside change.

### Step 7: verification (each suite run alone, 2026-10-16)

| Run | Result |
|---|---|
| `npx jest app/admin/finance --ci` | 14 suites, **458 passed** (run three times green; one earlier run under heavy parallel load timed out the pin file's row 8 `findByTestId` and the then-5 s `financeUrlState` cases, see Risks below) |
| `npx jest app/admin/users --ci` (incl. `businessOsPanel.render.test.tsx`, its `:197` href pin unedited) | 26 suites, **615 passed** |
| `npx jest app/admin/components --ci` (incl. `layoutFolder.guard.test.ts`) | 23 suites, **734 passed** |
| `npx jest app/admin/__tests__/aiCostVocabulary.source.guard.test.ts app/admin/__tests__/contrast.lf1.source.guard.test.ts lib/business-os/finance/__tests__/finance.source.guard.test.ts app/admin/finance/__tests__/source.guard.test.ts --ci` | 4 suites, **1,237 passed** |
| `npx jest app/api/admin/business-os/finance --ci` | 1 suite, **90 passed** |
| `npm run test:authz-guard` | 2 suites, **203 passed** |
| `npm run lint:hooks` | exit 0, no output |
| `npx eslint` on the 16 touched/new code and test files `--max-warnings 0` | exit 0 |
| Scoped `tsc --noEmit` (config in the scratchpad, outside the worktree; changed + new files, `AccountsTab.tsx`, `financeLinks.ts`, `route.ts`) | canary `const canary: number = 'x'` → exit 2 (TS2322, the canary only); without it → **exit 0**. It first caught one real error (`financeFilters.ts` account `serialise` return type), fixed. Config and canary deleted. |

**Mutations** (scratchpad runner; each restored and its SHA-256 re-checked equal):

| Mutation | Red tests |
|---|---|
| m1 `serialiseFinanceUrl` writes `range` | pin file: 17 failed (part A rows, part C) |
| m2 drop the `accountId` alias | `financeFilters` + `financeUrlState`: 18 failed |
| m3 reset the window and business on a bad combination | `financeUrlState` F4-R1 2a, 2b |
| m4 Refresh back in the header | `financePage`: inverted DV-1 pin + 2 Refresh cases |
| m5 `router.replace` in FinanceView | `source.guard`: "no page file writes the URL itself" |
| m6 drop the repair effect | `financeUrlState` F4-R1 2a, 2b |
| m7 one character in `buildQuerySchema` | pin file part B (hash; the planted control too, as its anchor moved) |

**`git diff --stat`:** 11 code/test files modified (530 insertions, 588 deletions across all 13 listed paths, two of them requirement MDs edited by other agents, not by Dev), 5 new files. Every modified file has insertions (`git diff --numstat`); no file deleted. `git diff --stat -- app/api lib` is **empty**.

**Pin file hashes at handover (F4-R5):** `financeRequest.pin.render.test.tsx` → `4583aa2108f55de24823f1b8c5b3c16629be1b25470d66f9221cb88e0f3c0ea6`; `financeRequestPins.ts` → `b84e0c961e60c994414af7b418dd7f9dc94273e45695d632956427fade68aabf`. **Equal to Step 0.**

### Open points for SA / QA

- **Pin-file timing risk:** part A uses `findByTestId` with the default 1 s wait. In one heavily loaded local run, row 8 timed out (it passed alone and in three later full runs). F4-R5 forbids editing the file, so it is unchanged. If SA wants it hardened (a longer wait), that is a one-time, SA-approved amendment with a new hash.
- **Stale comments, not edited (out of the planned file list):** `AccountsTab.tsx:11-12` and `FinanceTabs.tsx:15` still say the view writes with `router.replace`. Comment-only; can be fixed in F-5.
- AC-183 (the user's read-only browser look, Verification step 9) is still owed.

### SA follow-ups (after SA code approval, 2026-10-16)

- **Pin amendment (the one SA allowed):** `financeRequest.pin.render.test.tsx` changed in exactly two hunks: `findByTestId('finance-error', {}, { timeout: 10_000 })` and a `30_000` per-test timeout on part A's `it.each`. The literals, the cut, LF and hash functions, both recorded hashes and every assertion are unchanged (diff against the Step-0 copy shows only those two hunks).
  - **New frozen pin-file SHA-256:** `3a1a2dd415b3d0e0ffe44488a8c410b8e67a0bedf2ca908bbf064b6708bcf6f8` (supersedes `4583aa21…0ea6`).
  - Helper `financeRequestPins.ts` unchanged: `b84e0c961e60c994414af7b418dd7f9dc94273e45695d632956427fade68aabf`.
- **Comments:** `AccountsTab.tsx` (header) and `FinanceTabs.tsx` (header) no longer say `router.replace`; both now say the view writes through its URL filter state (`useAdminFilters`). Comment-only.
- **Re-run:** `npx jest app/admin/finance --ci` → 14 suites, 458 passed. Pin file alone, three runs → 21 passed each time. `npm run lint:hooks` → exit 0. ESLint on the three touched files `--max-warnings 0` → exit 0.

## SA Review Notes

### SA Workplan Review

**Reviewed by SA — 2026-10-16, against `067c4a3e`. This is also the SA requirement review of the F-4 part of §11G.**
**Status:** ✅ **APPROVED WITH CONDITIONS** (F4-R1 to F4-R5). Full cycle. SA applied E-60 and E-61 to the requirement. The requirement's F-4 part is sound and BD-28 to BD-31 are unchanged.

**Checked against the code**
- **Aliases and precedence.**
  - The hook's getter is canonical-first, then the first non-empty alias (`useAdminFilters.ts:88-99`). That gives the precedence the workplan states.
  - `AdminFilterField.aliases` is a `Record<string, string>`, so SA-W7 (a) needs no shared edit. `windowFilter`'s option is `'from' | 'to'` only (`adminWindow.ts:163`).
- **DatePresets.** If the page's `onChange` refuses a value, the applied value does not move, so the draft row stays open (`DatePresets.tsx:102-108`). SA-W5 (a) works with no shared change.
- **The two inputs exist.** `generatedAt` is in the payload (`financeTypes.ts:428`), so Read-at needs no API change. The BusinessOsPanel emitter is `?accountId=…&preset=this_month` (`:261`), the legacy form AC-174 names.
- **AC-173 pin.** It is written first. Part A has 15 request literals, each with exactly one fetch. Part B hashes the route's `DATE` and `buildQuerySchema` text with LF normalisation and checks the imported lists, with a planted control. Part C hashes `serialiseFinanceUrl`. This is the right shape.
- **Old links.** BusinessOsPanel and `accountViewHref` (all 5 windows) are tested through the real hook. The `businessOsPanel.render:197` href pin is left unedited.
- **Kept work.** F-0 to F-3 and F-2 stay intact. The contrast entry keeps `FinanceFilterBar.tsx`, which is rewritten, not deleted. The vocabulary floors are re-measured. The F2-R2 "Try again" pins stay. `MIGRATED_PAGES` is extended.
- **Nothing in `lib/`, `app/api/` or the shared folder changes**, so there is no data, API or money change.
- **The guard table and the AC mapping are complete** (AC-169 to AC-177, AC-182, AC-183).
- **The estimate of about 2 days is accepted.**

**Rulings**

| # | Ruling |
|---|---|
| **SA-W10** | **Approved. This does not break the AC-173 contract, provided it is named.** AC-173's "fixed set of page states" means the states a user can reach by a valid link or an in-page choice, and for those the request must be byte-identical (rows 1-15). The requests that change are all **bad or non-canonical links**, and each change is required by a final decision or by the standard: (1) one bad value next to good ones (BD-30: the good ones are now kept, where today everything resets to `preset=this_month`); (2) `tab=accounts` with a business, or `sort`/`group`/`show` without the tab (BD-30 per key, SA-W3: the business and window are kept); (3) `from`/`to` with no `range`/`preset` (U-7 implied custom; today the dates are silently dropped); (4) a repeated key (the shared hook's first-value rule; today a full reset). No emitter in the codebase produces any of these. They are in scope, as the F-4 behaviour the user decided. **Condition F4-R1:** each of the four is pinned by its **new request literal** (not only its filters) in `financeUrlState.render.test.tsx`, and listed in Implementation Notes as "deliberate request changes". Recorded as E-60 on AC-173. |
| **SA-W6** | **Approved as a recorded page deviation.** The finance route takes only two whole dates within 92 days, ending no later than today UTC. A minute or instant bound, a one-sided window, or a window the route refuses therefore drops to This month, exactly as Analytics (L-2a Q-4) and Activity (`tabWindowFilter.ts`) do. Forwarding them would turn a link into a 400. Recorded as E-61, and TL/BA note it in the standard's Finance deviations (F4-R4). Reading `new Date()` inside `parse` is acceptable: a past window inside 92 days never becomes invalid later, and the 92-day cap is the route's own rule. |
| **SA-W1** | **(a) Delete the notice**, with `FINANCE_URL_NOTICE`, the `AdminNotice` import and the `SHARED_STATES` requirement for it. BD-30 and AC-175 say no notice, and U-4 says silently. This closes F2-R3. |
| **SA-W5** | **(a) Approved.** A custom window failing `customRangeProblem` is not applied; its sentence shows as a red `role="alert"` line under the bar and the draft stays open. That keeps today's guarantee: no refused window is ever sent, and the URL never holds one. **F4-R3:** the line clears on any applied window, on a preset click and on Clear, and the problem text never reaches the URL. |
| **SA-W11** | **Approved.** Lower-casing is today's behaviour (`financeUrl.ts:103`), so the **request is unchanged** (pin row 8). Only the page URL now shows the lower-cased `account`, which is harmless. It stays a finance-local field. |
| **SA-W2** | **(a) Approved.** One spec owns all eight keys, so every change is one write, which avoids the two-writer race the analysis shows. The page keys keep their names (SA-Q44). `tab` being a hook key rather than an "unrelated param" (U-2) is a recorded page deviation (F4-R4). |
| **SA-W3** | **Approved.** The dependent key is the bad filter, and the business and window win (a pick already drops the tab, M3-FR-1). **F4-R2:** `financeFilterRepair` must cause **no second request**. A test with `?tab=accounts&account=A&sort=margin` asserts exactly one fetch (row 7's literal) and the cleaned URL `?account=A`. |
| **SA-W4** | **(a) Approved.** U-3 read literally: Clear resets the window, the business, `sort`, `group` and `show`, and keeps `tab`. `canClear` follows that set. |
| **SA-W7** | **(a) Approved.** `aliases: { preset: 'range' }` on the finance field. No shared edit. |
| **SA-W8** | **(a) Approved.** Use one label set, `ADMIN_WINDOW_LABELS`, so the as-of line and the section subtitles read "7 days", matching the bar and §11G's "what the user will see". |
| **SA-W9** | **(a) Approved.** Both emitters keep the legacy keys in F-4; the alias tests prove them. Moving them is optional, in their own slice. |

**Required changes (SA verifies at code review)**
1. **F4-R1 (Medium).** The four deliberate request changes of SA-W10 are pinned by their new request literals and listed in Implementation Notes.
2. **F4-R2 (Medium).** The repair effect causes no second fetch (one-fetch test, as in SA-W3).
3. **F4-R3 (Low).** The SA-W5 problem line clears on any applied window, a preset click or Clear (test). It is never in the URL.
4. **F4-R4 (Low).** TL/BA record the page deviations (SA-W2: `tab` is a hook key; SA-W6: U-7 narrowed to whole dates within the route's limits) in the Admin Layout Standard's Finance row.
5. **F4-R5 (Low).** The AC-173 pin file is **not edited** after it goes green on `067c4a3e`. Record its SHA-256 at Step 0 and again at handover; they must be equal. Mutation 1 (serialiser writes `range`) must turn it red.

**Requirement edits (SA applied; recorded in §0.3 as SA-WP-F4)**
- **E-60 (AC-173).** Appended: "'Page states' are the states a valid link or an in-page choice reaches; for those the request is byte-identical. Four kinds of link now read differently, by decision, and so change their request on purpose:
  - one bad value next to good ones (BD-30);
  - a business together with `tab`, or `sort` / `group` / `show` without the tab (BD-30 per key);
  - `from` / `to` with no range (U-7 implied custom);
  - a repeated key (first value wins).

  Each is pinned with its new request literal (SA-WP-F4, F4-R1). The pin test is written and run green on the unchanged tree first; it may land in the same PR."
- **E-61 (§11G.2, F-4 row).** Appended: "Recorded page deviations (SA-WP-F4): the window keeps only two whole dates the route accepts (`to` not after today UTC, at most 92 days); a minute or instant bound, a one-sided window or a refused window falls back to This month, as on Analytics and Activity (SA-W6). A custom window the route would refuse is not applied on Apply; its sentence shows under the bar (SA-W5). `tab`, `sort`, `group` and `show` are fields of the page's one filter spec, so each change is one write (SA-W2)."

_(SA to populate)_

### SA Code Review

**Code Review by SA — 2026-10-16** (uncommitted on `feature/finance-f4-filter-bar`)
**Status:** ✅ **Code Approved**, with one permitted pin amendment (below) and one comment-only fix. Nothing else blocks QA.

**1. The AC-173 pin amendment (F4-R5).** SA confirmed the frozen hashes: pin file `4583aa21…0ea6`, helper `b84e0c96…aabf`. SA ran the pin 3 times in parallel while other suites ran: 21/21 each time. A load-sensitive required test is still a merge-queue risk, so **ONE amendment is allowed**:
- **May change.** In `financeRequest.pin.render.test.tsx` only:
  - (a) `await screen.findByTestId('finance-error')` gains `{}, { timeout: 10_000 }`;
  - (b) the `it.each` callback gains a per-test timeout of `30_000` as its third argument.
  - Nothing else in the file.
- **Must not change:**
  - `financeRequestPins.ts` (its hash stays `b84e0c96…aabf`);
  - every literal, `PINNED_REQUESTS`, `cut`, `lf`, `routeSchemaText`, `serialiserText` and the two recorded hash constants;
  - every assertion, including `toHaveBeenCalledTimes(1)` and the `setTimeout(0)` settle.
- **After the edit:**
  - run the pin alone and with the finance suite, each green;
  - record the new file SHA-256 in Implementation Notes as the **frozen value from here on**;
  - `git diff --no-index` of the old and new pin file must show only those two hunks;
  - QA verifies the hash.

**2. Conditions and rulings, all verified in code**
- **F4-R1.**
  - The 15 request literals are each asserted with exactly one fetch.
  - Part B hashes the route's `DATE` and `buildQuerySchema` text (LF-normalised) and checks the list values; Part C hashes `serialiseFinanceUrl`. Each part has a planted control.
  - The four E-60 kinds are each pinned with their new literal (`financeUrlState` 1, 2a, 2b, 3, 4).
- **F4-R2.** `toFinanceQuery` already sends the tab only with no business, and the serialiser writes `sort`/`group`/`show` only with the tab. The repair effect therefore changes the URL without changing `queryString`. Cases 2a and 2b and pin rows assert one read.
- **F4-R3.** The sentence clears on a valid Apply, a preset click, Clear, and an outside window change (`windowProblem.on === filters.window`). It is never in the URL.
- **W1.** The notice is deleted. **W5 (a).** A refused window is not applied and no read is sent (the 92-day and future-end tests).
- **W3.** `financeFilterRepair` drops the dependent keys, and the business and window win.
- **Aliases.** `preset` → `range` and `accountId` → `account`; the hook's getter is canonical-first.
- **Old links.** BusinessOsPanel and `accountViewHref` (each window) are tested through the real hook with one read, and the `businessOsPanel.render:197` pin is unedited.
- **URL.** Defaults are omitted, so the default URL has no query.
- **DV-1 ended.** Refresh and Read-at (`generatedAt`) are in the bar, and the header has no `actions`.
- **Labels.** "Today · 7 days · 30 days · This month · Custom", with Custom a real button. `ADMIN_WINDOW_LABELS` is used for the as-of line (W8).
- **Nothing outside the page.** `git diff --stat -- lib app/api` is empty, so there is no data, API or money change. There is no `console.*` and no `any` in the product files.
- **Earlier slices.** The F-0 to F-3 and F-2 work is intact: the contrast entry (the `FinanceFilterBar.tsx` path is kept), the `ADMIN_*` constants, `StatusChip`, `readAdminResponse` with `clientLogger`, `useFinanceData(queryString)`, the "Try again" pins and the vocabulary floors. `MIGRATED_PAGES` is extended.

**3. Deviations**

| # | Ruling |
|---|---|
| Self-check `describe` in `financeRequestPins.ts` | ✅ **Approved.** Jest collects every `.ts` under `__tests__`, so a test-only module must hold a test. The check (rows 1-15, each on the finance route) adds a real guard on the table, and the file's hash is frozen with it. |
| `financeCanClear()` | ✅ **Approved.** It is pure, sits beside `FINANCE_CLEAR_PATCH` in one module, and enables Clear for exactly the SA-W4 set. Its tests cover disabled at defaults and enabled on the tab keys. |
| `onPick` keys the picked name to the lower-cased id | ✅ **Approved.** The picked-name lookup now matches the lower-cased `account` the hook holds, so the name is found on the first render. No name reaches the URL or a request (AC-109, tested). |
| The `accountsTab` test stubs the Overview sections | ✅ **Approved.** It is test-only and isolates the tab's URL behaviour; the Overview sections are covered by `financePage.render`. |
| 30 s timeout on `financeUrlState` | ✅ **Approved.** It is a render-heavy suite under the merge queue. It only extends the wait and changes no assertion. |

**4. Stale comments.** **Fix them in this PR, comment only:** `AccountsTab.tsx:12` and `FinanceTabs.tsx:15` say `router.replace`; they should say the view's `setFilters` (the hook's `replaceState`). Comment-only changes inside AC-182's scope (no `lib/`, no `app/api/`). The source guard reads code, so it is unaffected.

**5. SA re-run** (one suite at a time, own exit codes)

| Run | Result |
|---|---|
| `app/admin/finance` (incl. the pin) | exit 0, 14 suites, 458 tests |
| The pin, 3 runs in parallel | 21/21 each |
| `app/admin/users` | exit 0, 26 suites, 615 tests |
| `app/admin/components` | exit 0, 23 suites, 734 tests |
| `npm run test:authz-guard` | exit 0, 2 suites, 203 tests |

**Code Approved for QA: Yes** (after the permitted pin amendment and the two comment fixes; QA confirms the new pin hash and the two-hunk diff).

---

## QA Testing Report

**QA — 2026-10-16**
**Test mode:** full (AC-173 to AC-177, AC-182; the F-2 ACs re-run; AC-183 manual)
**Strategy used:** A + B (pure, render and route suites), each run alone; the AC-173 pin run 5 times, once under load; scoped `tsc` with a canary; a byte-level check of the pin amendment; code reading for the edge cases; D (read-only browser look) listed for the user.
**Focus:** ui, url, api (unchanged)
**Skipped:** the browser look (AC-183): L-112 to L-119, for the user
**Input source:** prompt keywords from TL, plus the coordinator's pin-amendment note.
**Verdict:** ✅ **PASS**. No bug found.

**Pin amendment (F4-R5, SA-approved)**
- **Current pin file SHA-256:** `3a1a2dd415b3d0e0ffe44488a8c410b8e67a0bedf2ca908bbf064b6708bcf6f8`. It **equals the frozen value Dev recorded** in Implementation Notes.
- **Helper `financeRequestPins.ts`:** `b84e0c961e60c994414af7b418dd7f9dc94273e45695d632956427fade68aabf`, **unchanged** from Step 0.
- **Only the two approved hunks.** The pin file is untracked, so QA could not take a `git diff` against HEAD. Instead, QA rebuilt the Step-0 file by reversing exactly the two approved changes: the `{}, { timeout: 10_000 }` on `findByTestId('finance-error')` (line 103), and the `30_000` third argument of the `it.each` (lines 112-113). The rebuilt file hashes to **`4583aa21…0ea6`, the Step-0 value**. `diff` between the rebuilt file and the current one shows exactly those two hunks, so nothing else in the file changed.
- **Comment fixes:** `git diff` of `AccountsTab.tsx` and `FinanceTabs.tsx` is comment lines only (the `router.replace` wording replaced by `useAdminFilters`).

**Test runs** (worktree `neuronforge-finance-health`, branch `feature/finance-f4-filter-bar`, uncommitted)

| # | Command | Result |
|---|---|---|
| Q-1 | `npx jest app/admin/finance --ci` | exit 0; **14 suites, 458 passed** |
| Q-2 | `npx jest app/admin/users --ci` (incl. `businessOsPanel.render`, its `:197` href pin unedited) | exit 0; **26 suites, 615 passed** |
| Q-3 | `npx jest app/admin/components --ci` (incl. `layoutFolder.guard`) | exit 0; **23 suites, 734 passed** |
| Q-4 | Vocabulary + contrast + both finance source guards | exit 0; **4 suites, 1,237 passed** |
| Q-5 | `npx jest app/api/admin/business-os/finance --ci` | exit 0; **1 suite, 90 passed** |
| Q-6 | `npm run test:authz-guard` | exit 0; **2 suites, 203 passed** |
| Q-7 | `npm run lint:hooks` | exit 0 |
| Q-8 | **AC-173 pin, 5 runs** (`financeRequest.pin.render.test.tsx`, the amended file) | Runs 1 to 4, alone: **21 / 21 each**, exit 0. Run 5, **under load** (started 8 s into a concurrent `npx jest app/admin/users app/admin/finance` run, 40 suites, which itself passed 1,073 / 1,073): **21 / 21**, exit 0, 33.4 s. **No timeout in any run** |
| Q-9 | Scoped `tsc`: `tsconfig.qa-f4.json` in the session scratchpad (outside the worktree), absolute `extends`, `include` = types + the 20 changed and new `.ts` / `.tsx` files + `route.ts` + `financeLinks.ts` | **Canary** in `financeFilters.ts` → exit 2, `financeFilters.ts(205,7): error TS2322`. **Restored** byte-identical (`cmp`, `grep -c qaCanary` = 0). Re-run: **exit 0, 0 diagnostics** |
| Q-10 | `git diff --stat -- app/api lib`; deletion-only check | **empty**; no file only loses lines |

**Test coverage**

| AC | Result | Evidence |
|---|---|---|
| AC-169 to AC-172 (F-2, re-run) | ✅ Pass | The F-2 describe in `financePage.render` is green; the DV-1 pin is inverted (Refresh is no longer in the header) |
| AC-173 | ✅ Pass | Pin part A: 15 literals, one fetch each. Part B: the route schema hash plus the list values. Part C: the serialiser hash. Q-8, plus the amendment proof above. The four E-60 request changes are pinned with their new literals (`financeUrlState` "1.", "2a.", "2b.", "3.", "4.") |
| AC-174 | ✅ Pass | `financeUrlState`: "an old-key bookmark is rewritten once to range / account … with ONE read"; "the Businesses page 'Open money view' link (BusinessOsPanel) …". `financeLinks.test` (`accountViewHref`, 5 windows) parsed through the spec. `financeFilters`: "reads the old keys as aliases, and the canonical key wins"; "writes the canonical keys only" |
| AC-175 | ✅ Pass | `financeFilters` per-key U-4 `it.each`; `financeUrlState` "one bad value among good ones …", "range=year with a business …", "a malformed business with 7 days …"; no notice (`FINANCE_URL_NOTICE` gone) |
| AC-176 | ✅ Pass | Pin rows 11 to 14; the `accountsTab.render` tab tests; the `financeFilters` repair cases; "a pick is one write …" |
| AC-177 | ✅ Pass | No `FinanceActiveChip`, shared bar by alias (source guard); `financeFilterBar.layout.render` (labels "7 days" / "30 days", Custom is a button, help line); `financeUrlState` Clear, chip X, Refresh; Read at in `financePage.render` |
| AC-182 | ✅ Pass | Q-10 (no `app/api` or `lib` change); route schema hash (pin part B) |
| AC-183 | ⬜ NOT-TESTED | Manual L-112 to L-119 |

**Edge cases**

| Case | Result | Evidence |
|---|---|---|
| Old links (`?preset=7d`, `?accountId=<uuid>`, both Businesses-drawer links) give the same view | Confirmed | Aliases `preset` → `range` and `accountId` → `account` (`financeFilters.ts:44, 59`); pin rows 3, 7 and 10; `accountViewHref` 5-window tests; the BusinessOsPanel case (one read, URL rewritten to `?account=`) |
| Canonical key and alias both present | Confirmed | The hook's getter is canonical-first; test "the canonical key wins over its alias" |
| One bad value next to good ones | Confirmed | Each field's `parse` returns `undefined` only for itself (`:32-35, 45-53, 61-64`); test 1 (request `preset=7d&tab=accounts&sort=margin`) |
| A business with `tab=accounts` | Confirmed | `financeFilterRepair` (`:122-125`) drops the tab keys; `toFinanceQuery` already ignores them (`:89`); test 2a: one read, URL `?account=A` |
| `sort` without the tab | Confirmed | Repair `:126`; test 2b: one read, URL `?range=30d` |
| `from` / `to` with no range | Confirmed | Implied custom (U-7) when valid; test 3 |
| A repeated key | Confirmed | The first value wins; test 4 |
| Clear | Confirmed | `FINANCE_CLEAR_PATCH` resets window, business, sort, group and show, and keeps the tab (SA-W4); disabled at the defaults; three tests |
| A refused Custom range | Confirmed | `financeWindowProblem` on Apply: red `role="alert"`, no read, URL untouched, the row stays open. It clears on a valid Apply, a preset, Clear and an outside change (six tests, F4-R3) |
| URL clean-up causes no second fetch | Confirmed | Repair changes only keys that `toFinanceQuery` already ignores, so the query string is identical; the one-fetch assertions in 2a / 2b and on the old-link rewrite |
| Refresh in the bar | Confirmed | "Refresh re-sends the same request and does not touch the address bar"; the header pin is inverted |
| An uppercase business id | Confirmed | The account field lower-cases (`:63`); `onPick` lower-cases; pin row 8 (upper case in, lower case out, request byte-identical) |
| The default view is plain `/admin/finance` | Confirmed | Defaults are never written ("writes the canonical keys only, never an alias and never a default"); the request is still `?preset=this_month` (pin row 1) |

**Issues found**
- **Bugs:** none.
- **Notes (Low):** none new. The pin-file load risk is addressed by the approved amendment: no timeout in 5 runs, one of them under load.

**Manual live steps** (continuing from F-2's L-111): a read-only browser look at `/admin/finance`, signed in as a platform admin

| # | Step | Expected |
|---|---|---|
| L-112 | Open `/admin/finance` | The address bar shows plain `/admin/finance` (no query). A bordered filter bar holds a "Window" group **Today · 7 days · 30 days · This month · Custom**, the business picker, **Refresh**, **"Read at HH:mm UTC"** and **Clear** (greyed). The header has no Refresh button. There is no amber notice |
| L-113 | Click **7 days**, then 7 days again | The first click: `?range=7d`, and the as-of line reads "7 days, … UTC". The second click goes back to This month and the URL is plain again |
| L-114 | Click **Custom** | The From / To row opens; Apply needs both dates. Try 2026-07-01 to 2026-10-15 (more than 92 days): a **red sentence**, nothing reloads and the URL does not change. Then pick 2026-09-01 to 2026-09-30 and Apply: `?range=custom&from=2026-09-01&to=2026-09-30`, the figures follow, and the red sentence is gone |
| L-115 | `/admin/users`, open a business, click **"Open money view"** | Finance opens for that business on This month; the address bar becomes `?account=<id>`; the chip reads "Business: <name>" |
| L-116 | Type an old bookmark: `/admin/finance?preset=7d&accountId=<a business id>` | 7 days for that business; the address bar rewrites itself to `?range=7d&account=<id>` |
| L-117 | Type a bad link: `/admin/finance?range=zzz&account=<a valid id>` | **This month for that business**, no notice (only the bad window was dropped). Then `/admin/finance?account=acme&range=7d`: 7 days for all businesses |
| L-118 | With a business picked and 7 days selected, click **Clear** | Back to This month and all businesses; the URL is plain `/admin/finance`; Clear greys out |
| L-119 | Accounts tab, then sort by AI margin; then pick a business | `?tab=accounts&sort=margin`. Picking a business drops the tab keys in one step (`?account=<id>`). Refresh in the bar re-reads without changing the URL |

---

## Commit Info

_(RM to populate)_
