# Workplan: Admin Layout Standard — Slice L-1a (shared header, states, read helpers, Refresh bar, folder guard → pilot Health)

> **Last Updated**: 2026-10-09

**Developer:** Dev
**Requirement:** [ADMIN_LAYOUT_STANDARD_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md): §5.3, §5.5 (part 6), §5.10, §5.11, §5.12, §6.1 (S-1 to S-10), §6.2 (C-1 to C-5, C-8 Refresh part, C-14), §7.1, §12.2; SA re-check 2026-10-09 ("L-1a scope for the Dev workplan", RC-1 to RC-5)
**Branch:** `feature/admin-layout-standard`, cut from `origin/main` `88f97171` (worktree `neuronforge-admin-layout`)
**Date:** 2026-10-09
**Status:** Code Complete (2026-10-09). SA code review 2026-10-09: APPROVED, ready for QA. SA workplan review 2026-10-09: APPROVED WITH CONDITIONS (W-1 to W-10), applied. Nothing is committed: the user reads the diff first.
**Path:** full cycle (new shared pattern, CLAUDE.md rule 7).

## Overview

L-1a creates the shared folder `app/admin/components/layout/` with the first six shared parts (page header, loading and error states, two JSON read helpers, the UTC formatter, the Refresh-only filter bar) and its guard (C-14). It ships them with exactly one pilot, Health (`/admin`), which uses every new export. It also removes the page title from the shell header, makes the admin chrome render native controls dark, and turns the Business OS AI `readJsonBody.ts` into a re-export. No data, request, permission or API changes. Estimate: about 2 days.

---

## 1. Analysis Summary (code verified at `88f97171`)

| File | As built | L-1a change |
|---|---|---|
| `app/admin/components/AdminHeader.tsx` (112 lines) | `usePathname` import `:3`, `pathname` `:29`, `getPageTitle` `:34-43`, menu button with no name `:64-69`, `<h1>` `:72`, date line `:73-80`, Sign out `:99-108` | Remove `:3`, `:29`, `:34-43`, `:72`. Menu button gets `type="button"` and `aria-label="Open menu"`; icon `aria-hidden`. Date line and Sign out unchanged |
| `app/admin/components/AdminChrome.tsx` (54 lines) | Root `div` `:32` | Add `[color-scheme:dark]` to the root class list |
| `app/admin/business-os-llm/readJsonBody.ts` (24 lines) | `ApiBody` `:11-15`, `readJsonBody` `:17-24`; importers `ActivityTab.tsx:45`, `ActivityDrillDown.tsx:60` | Body moves verbatim to the shared folder; this file becomes a one-line re-export of `readJsonBody` and the `ApiBody` type (kept until L-8). Importers unchanged |
| `app/admin/components/health/HealthGrid.tsx` (105 lines) | `createLogger` `:15`, `:19`; ISO slicing `utcTime` / `utcDateTime` `:21-28` (F-58); `fetch` `:39`; `.json().catch` `:40`; error from `body.error` or `err.message` `:44-50`; `<header>` with h1, purpose, As of (`text-slate-500`) and Refresh `:62-86`; error `<p role="alert" data-testid="health-error">` `:88-92`; "Loading…" `:94`; grid `:96-102` | Migrated to the shared parts (§3.7) |
| `app/admin/page.tsx` (20 lines), `components/health/HealthTile.tsx` | Page renders `HealthGrid`. Each tile is a `<section aria-labelledby>` (`HealthTile.tsx:92`, the region the count test counts) with an `h2` (`:99`) | **Not edited** |
| `app/admin/components/jobs/jobsFormat.ts` | `formatUtc(iso: string or null)` `:14-20`: through `Date`, "YYYY-MM-DD HH:mm UTC", em dash for null or invalid | Copied (not moved) to the shared folder; Jobs keeps its copy until L-1b |
| `lib/logger/client.ts` | `export { clientLogger } from '../logger'` | Because of this re-export, a test that mocks `@/lib/logger` with `createLogger` only leaves `clientLogger` undefined, and `clientLogger.child` at module scope throws on import (RC-1) |

**Existing test facts this plan depends on:**

| Test | Fact |
|---|---|
| `app/admin/__tests__/health.render.test.tsx` | Mocks `@/lib/logger` with `createLogger` only (`:17-25`). Fetch mock is `{ ok, status, json }` only (`:106-111`). Region count equals tile count (`:140-150`). Exactly one fetch with `{ cache: 'no-store' }` (`:116-121`). Refresh by name `/Refresh/` (`:231`) and aria-busy (`:227-237`). `health-error` textContent exactly "Forbidden" on a 500 with `error: 'Forbidden'` (`:239-244`). Green regex over the whole page HTML (`:152-157`) |
| `app/admin/__tests__/health.source.guard.test.ts` | Explicit 3-file list. Every file starts with `'use client'`; no runtime import of `@/lib/business-os`, `@/lib/repositories`, `callCatalog`, `adminSettingsView`, `server-only` or the health rules; never the word "OK"; no green outside `GREEN_STYLE`; page and grid carry no green; no `console.` |
| `app/admin/__tests__/health.qa-slice5.render.test.tsx` | Renders `HealthTile` alone with the real evaluator; pins green per tile, status labels, the entitlements tile's single link. Does not render `HealthGrid`, so it is unaffected |
| `app/admin/components/__tests__/AdminHeader.render.test.tsx` | Mocks `next/navigation` (`:25-27`) and `@/lib/logger/client` (`:33-37`). "keeps the page title" `:75-78`; "exactly 2 buttons, no links" `:80-89` |
| `app/admin/business-os-llm/__tests__/source.guard.test.ts` | Walks the folder; every `from '…'` specifier starting `@/lib/` is refused except `@/lib/business-os/llm/ledgerCheckCopy` (`:111-117`). `@/app/admin/components/layout/readJsonBody` passes |
| `lib/admin/__tests__/admin-authz-surface.guard.test.ts` | Render-entry regex `:882-883` matches a file named `page`, `layout`, `template`, `default`, `loading`, `error`, `not-found` or `global-error` anywhere under `app/admin/`. `AdminError.tsx`, `AdminStates.tsx` do not match (the regex needs the slash before the name) |

---

## 2. Scope (the SA re-check table, nothing more)

| Area | In L-1a |
|---|---|
| Shared folder | `AdminPageHeader` (title, purpose, asOf); `AdminLoading`; `AdminError` (RC-3); `readJsonBody` (moved) + `readAdminResponse` (RC-2, RC-4); `formatUtc`; `AdminFilterBar` (Refresh only); tests for each; C-14 guard (part (a) with RC-5, part (b) registry = Health) |
| Shell | `AdminHeader.tsx`, `AdminChrome.tsx` (C-1) |
| BOS AI | `business-os-llm/readJsonBody.ts` → re-export |
| Pilot | `HealthGrid.tsx` only |
| Tests edited | `health.render.test.tsx`, `AdminHeader.render.test.tsx` (exact edits in §5.2) |

**Moved to later slices (SA re-check R-2; Dev records them in the requirement's §1 during implementation; SA workplan review adds `AdminFilterBar` `readAt`, to L-1c):** `AdminEmpty`, `AdminNotice`, `formatUtcDate`, `formatCount`, the `badge` and `actions` props of `AdminPageHeader`, the filter controls, presets, Clear and chips of `AdminFilterBar`.

---

## 3. Implementation Approach and Component APIs

All shared `.tsx` files start with `'use client'`; the three `.ts` helpers are plain modules. Shared files import only from the S-3 allow-list. No shared file logs in L-1a (callers log), so none imports `@/lib/logger/client` yet. Classes are explicit slate (T-1, T-2); text is slate-400 or lighter (T-5); no green (RC-5); focus ring `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500` (A-1).

### 3.1 `adminFormat.ts` (C-5, `formatUtc` only)

```ts
/** "YYYY-MM-DD HH:mm UTC" through Date (never sliced from the input); em dash for null or an invalid value. */
export function formatUtc(iso: string | null): string;
```

Byte-for-byte the behaviour of `jobsFormat.ts:14-20`, so the L-1b swap in Jobs is a no-op. The file name leaves room for `formatUtcDate` and `formatCount` later.

### 3.2 `readJsonBody.ts` (C-4, moved)

```ts
export interface ApiBody { success?: unknown; error?: unknown; data?: unknown }
export async function readJsonBody(response: Response): Promise<ApiBody | null>;
```

The current body verbatim (header comment updated to say where it moved from). The only `.json(` in the folder (S-6). Touches `response.json()` only (RC-2).

### 3.3 `readAdminResponse.ts` (C-4)

```ts
export const ADMIN_NETWORK_ERROR = 'Could not reach the server. Check your connection and try again.';

export interface ReadAdminResponseOptions {
  /** Noun phrase for the fixed fallback: "Could not read {what}. Try again in a moment." */
  what: string;
  /** RC-4: 401 and 403 show "Your admin session has ended. Sign in again." Default false. */
  sessionEndedCopy?: boolean;
}

export type AdminReadResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; message: string };

export async function readAdminResponse<T>(
  response: Response,
  options: ReadAdminResponseOptions,
): Promise<AdminReadResult<T>>;
```

Rules:
- Reads only `response.ok`, `response.status` and, through `readJsonBody`, `response.json()`. No `headers`, `text()`, `clone()` (RC-2). Never calls `fetch` (the Health single-fetch pin).
- **Status first.** `ok: true` only when `response.ok` is true **and** the body is readable **and** `body.success === true`. `data` is `body.data` cast to `T` (no runtime shape check, the same trust as today's cast in `HealthGrid.tsx:40-43`; commented).
- Message on failure, for every status (§5.10, RC-4): (a) if `sessionEndedCopy` and status is 401 or 403, the session copy; (b) else a non-blank string `body.error`, verbatim (rule 1); (c) else the fixed fallback (rule 2). Never a parser message, never `statusText` (rule 4).
- Rule 3 (network) cannot happen inside this helper (it receives a `Response`). The caller's `catch` around `fetch` shows `ADMIN_NETWORK_ERROR`.

### 3.4 `AdminPageHeader.tsx` (C-2)

```ts
export interface AdminPageHeaderProps {
  /** Equals the sidebar label (D-3 (a)). Rendered as the page's only h1. */
  title: string;
  /** What the page is for (§5.3). */
  purpose: string;
  /** Optional server-clock line; omitted when absent. */
  asOf?: string | null;
}
export function AdminPageHeader(props: AdminPageHeaderProps): JSX.Element;
```

Markup: `<header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-700 pb-4">` → `<div>` → `<h1 className="text-xl font-semibold text-white">`, `<p className="mt-1 max-w-3xl text-sm text-slate-400">`, and when `asOf` is set `<p data-testid="as-of" className="mt-1 text-xs text-slate-400">`. No `<section>`, no role (A-9). Inside `<main>` the `<header>` element is not a landmark; in a bare render it is `banner`, never `region`, so the count pin holds.

### 3.5 `AdminStates.tsx` (C-3, loading and error only)

```ts
export interface AdminLoadingProps { /** "Reading {what}…" */ what: string }
export function AdminLoading(props: AdminLoadingProps): JSX.Element;

export interface AdminErrorProps {
  message: string;
  /** RC-3: placed on the message element itself, so its textContent is exactly `message`. */
  testId?: string;
  /** When set, a "Try again" button follows the message (outside the testid element). */
  onRetry?: () => void;
}
export function AdminError(props: AdminErrorProps): JSX.Element;
```

- `AdminLoading`: `<div role="status" className="flex items-center gap-2 text-sm text-slate-300">` with `RefreshCw h-5 w-5 animate-spin text-purple-500` (`aria-hidden`) and "Reading {what}…". `role="status"` is a live region, not a landmark (see Q-2).
- `AdminError`: `<div role="alert" className="flex items-start gap-3 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">` → `AlertCircle` (`aria-hidden`) → `<p data-testid={testId} className="flex-1">{message}</p>` → optional `<button type="button">Try again</button>` (`rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700` + focus ring).

### 3.6 `AdminFilterBar.tsx` (C-8, Refresh part only)

```ts
export interface AdminFilterBarProps {
  /** Re-runs the page's current read unchanged (§5.5). */
  onReread: () => void;
  /** A read is in flight: icon spins, aria-busy, button disabled. */
  busy: boolean;
  /** Noun phrase; the button's accessible name is "Refresh {what}". */
  what: string;
  /** ISO instant of the last read; shows "Read at HH:mm UTC". Omit on a page with a server "As of" (§5.5 part 6). */
  readAt?: string | null;
}
export function AdminFilterBar(props: AdminFilterBarProps): JSX.Element;
```

Markup: plain `<div className="flex flex-wrap items-end gap-3">` (no role, SA-R-13) → `<div className="ml-auto flex items-center gap-3">` → optional `<span className="text-xs text-slate-400">Read at {time}</span>` (time = the "HH:mm UTC" tail of `formatUtc(readAt)`, the same tail Jobs prints at `JobsQueuesView.tsx:308`) → `<button type="button" aria-label="Refresh {what}" aria-busy={busy} disabled={busy}>` with `RefreshCw h-4 w-4` (spins while busy, `aria-hidden`) and the visible text "Refresh" (the accessible name starts with the visible text, WCAG 2.5.3).

### 3.7 Health pilot: `HealthGrid.tsx`

- Stays `'use client'`. Imports: react, `@/lib/logger/client`, `type HealthSummary`, `./HealthTile`, and the four shared files **through the alias** `@/app/admin/components/layout/…` (S-1).
- `const logger = clientLogger.child({ module: 'AdminHealthGrid' })` replaces `createLogger` (F-56).
- `utcTime` / `utcDateTime` deleted (F-58). As of line, through `formatUtc`, on `text-slate-400` via `asOf`:
  "As of 10:30 UTC. Last 24 h = 2026-09-25 10:30 UTC to 2026-09-26 10:30 UTC; last 7 days from 2026-09-19 10:30 UTC." (the time is the tail of `formatUtc(end)`, as in Jobs). See Q-3.
- `load` keeps its single `fetch('/api/admin/health-summary', { cache: 'no-store' })`. Then `readAdminResponse<HealthSummary>(response, { what: 'the health summary' })` (no session copy, RC-4). Not ok → `logger.error({ status }, …)` and `setError(result.message)`. The `catch` (network only) → `logger.error({ err }, …)` and `setError(ADMIN_NETWORK_ERROR)`. On failure the previous summary stays on screen, as today.
- Render order (§5.1): `AdminPageHeader` (title "Health", the purpose text unchanged) → `AdminFilterBar` (`what="the health summary"`, `busy={loading}`, no `readAt`) → `AdminError` (`testId="health-error"`, `onRetry={() => void load()}`) when `error` → `AdminLoading what="the health summary"` when no summary and loading → the tile grid unchanged, plus `aria-busy={loading}` (§5.10 refresh state).
- No green, no "OK", no `console`, no `<section>`, no `<h1`, no `.json(`.

**Visible changes on `/admin` (all forced by the standard, named in the PR):** the shell no longer shows "Health" a second time; Refresh becomes "Refresh" in a bar below the header; As of moves from slate-500 to slate-400, shows a full UTC date-time on every instant; "Loading…" becomes a spinner with "Reading the health summary…"; the error is a red box with a "Try again" button; the fallback copy becomes "Could not read the health summary. Try again in a moment."; a network failure shows the fixed network copy instead of the browser's `err.message` (§5.10 rule 4). The server's own error string is still shown verbatim.

### 3.8 Shell and BOS AI one-liner

- `AdminHeader.tsx` per §1 table. `AdminChrome.tsx` root: `min-h-screen [color-scheme:dark] bg-gradient-to-br …` (T-4).
- `business-os-llm/readJsonBody.ts` becomes: `export { readJsonBody, type ApiBody } from '@/app/admin/components/layout/readJsonBody';` (TypeScript 5.9.3, inline `type` modifier is valid under `isolatedModules`). L-8 deletes it.

---

## 4. The C-14 guard (`app/admin/components/layout/__tests__/layoutFolder.guard.test.ts`)

Pure `fs` reads, runs in the existing Jest gate, no script, no workflow (S-10). Comment stripping uses the same approach as `health.source.guard.test.ts`. The folder is **walked**, so a file added later is covered. Every pattern has a "no dead regex" self-test (it matches a planted violation and passes a clean sample).

**Part (a), shared-folder rules:**

| Test | Rule | Scope |
|---|---|---|
| finds the expected files (the scan cannot be empty) | — | the six source files exist and are in the walk |
| no Next special-file name | S-2 | every file, tests included: basename before the first dot is not `page`, `layout`, `template`, `default`, `loading`, `error`, `not-found`, `global-error`, `route` |
| every `.tsx` starts with `'use client'` | §6 | source files |
| imports only from the allow-list | S-3 | every `import … from`, `import '…'`, `export … from` (type-only included): react, lucide-react, next/link, next/navigation, `@/components/ui/sheet`, `@/components/ui/dialog`, `@/lib/logger/client`, a `./` path inside the folder (no `../`), or `@/app/admin/components/layout/…` |
| never `@/lib/business-os`, repositories, Supabase, `server-only` | S-4 | explicit refusal, so the failure message names the rule even though S-3 already covers it. Tier and capability literals: enforced by the entitlements suite, which scans all product code; Dev runs it (§6) |
| no `var(--v2-`, no `dark:` variant, no `console.` | S-5 | source files (code without comments). The `dark:` check must not trip on `[color-scheme:dark]` (self-test) |
| `.json(` only in `readJsonBody.ts`; `history.pushState` / `replaceState` only in a file named `useAdminFilters.ts` (none in L-1a) | S-6 | source files |
| **at most one** green constant, and no green outside it | S-7, **RC-5** | source files. Green = the 13 colour prefixes of the Health guard followed by green or emerald. Every green match must sit inside one `const NAME = …` declaration, and the set of such names has size 0 or 1. L-1b tightens this to exactly 1 |
| no landmark region: no `<section`, no `role="region"` (either quote) | S-8 | source files (stricter than "a named section": no shared part needs one) |

**Part (b), migrated-pages registry:**

```ts
const MIGRATED_PAGES = [
  {
    page: '/admin (Health)',
    files: [
      'app/admin/page.tsx',
      'app/admin/components/health/HealthGrid.tsx',
      'app/admin/components/health/HealthTile.tsx',
    ],
  },
] as const;
```

Per entry: every listed file exists; at least one imports `AdminPageHeader` from `@/app/admin/components/layout/AdminPageHeader`; no file contains `<h1`; no file contains `.json(`; every import that reaches the shared folder uses the alias, never a relative path (S-1). Code is read without comments.

---

## 5. Tests

### 5.1 New

| File | Happy path | Failure path(s) |
|---|---|---|
| `layout/__tests__/adminFormat.test.ts` | Z instant → "2026-10-09 14:02 UTC"; an offset instant (`+02:00`) converts to UTC | null and an invalid string → em dash |
| `layout/__tests__/readAdminResponse.test.ts` (covers `readJsonBody` too) | 200 + `success: true` → `ok`, `data`. `readJsonBody`: object returned | `readJsonBody`: array, `null`, a throwing `json()` → null. `readAdminResponse`: 403 + "Forbidden" → "Forbidden" (session copy off by default); 401 and 403 with `sessionEndedCopy` → session copy; 500 whose `json()` throws (HTML) → fallback, never the parser text; 200 + `success: false` + error → that error; blank or non-string `error` → fallback. **RC-2 probe:** responses are built as a Proxy over `{ ok, status, json }` that throws on any other property, so a read of `headers`, `text`, `clone` or `statusText` fails the test |
| `layout/__tests__/AdminPageHeader.render.test.tsx` | one h1 with the title; purpose text; As of text and its slate-400 class | no `asOf` → no `as-of` element; no `region` role rendered |
| `layout/__tests__/AdminStates.render.test.tsx` | `AdminLoading` "Reading X…", icon hidden. `AdminError` with `testId`: that element's textContent is exactly the message; `role="alert"` on the box | no `onRetry` → no button; with `onRetry`, "Try again" calls it once and is outside the testid element |
| `layout/__tests__/AdminFilterBar.render.test.tsx` | button named "Refresh the x", visible text "Refresh", `aria-busy` false, click calls `onReread`; `readAt` → "Read at 14:02 UTC"; the bar has no `search` or `region` role | `busy` → `aria-busy` true, disabled, click does not call; no `readAt` → no "Read at" text |
| `layout/__tests__/layoutFolder.guard.test.ts` | §4 | §4 self-tests |
| `app/admin/__tests__/health.layout.render.test.tsx` (Health pilot, new file so the SA-listed edits to `health.render` stay exact) | As of uses the shared format ("As of 10:30 UTC." and "2026-09-25 10:30 UTC"); the Refresh bar has no "Read at"; "Try again" after a failure refetches (fetch count 2) | a 502 whose `json()` throws → "Could not read the health summary. Try again in a moment."; a rejected fetch → the network copy and `logger.error` called; a 403 with "Forbidden" shows "Forbidden", not the session copy (RC-4); a failed Refresh keeps the tiles on screen. Mocks `@/lib/logger/client` (RC-1) |

### 5.2 Edited deliberately

| File | Edit | Why |
|---|---|---|
| `health.render.test.tsx` | Add `jest.mock('@/lib/logger/client', …)` returning `clientLogger.child` → `{ error, warn, info, debug }` (the `AdminHeader.render` pattern). The `@/lib/logger` mock stays | RC-1 |
| `health.render.test.tsx` `:231` | `getByRole('button', { name: /Refresh/ })` → `{ name: 'Refresh the health summary' }`; the test title "Refresh refetches…" → "Refresh refetches…" | §7.1 |
| `health.render.test.tsx` | New `it`: while loading and once loaded, `getAllByRole('heading', { level: 1 })` has length 1 and its text is "Health" | R-1 restated Q-11 |
| `AdminHeader.render.test.tsx` `:75-78` | "keeps the page title" → "renders no heading": `queryAllByRole('heading')` has length 0 | C-1 |
| `AdminHeader.render.test.tsx` | New `it`: "the menu button is named Open menu": `getByRole('button', { name: 'Open menu' })` | C-1 |
| `AdminHeader.render.test.tsx` `:25-27` | The `next/navigation` mock removed (dead once `AdminHeader.tsx` imports nothing from it) | SA ruling 7, W-10 |

Unchanged in `AdminHeader.render`: "exactly 2 buttons, no links".

### 5.3 Must stay green with no edit

`health.source.guard`, `health.qa-slice5.render`, `AdminSidebar.nav`, every test in `app/admin/business-os-llm/__tests__/` (guard, Activity tab, drill-down), `lib/admin/__tests__/admin-authz-surface.guard.test.ts`, `app/admin/__tests__/jobsQueues.*` (Jobs untouched), `app/__tests__/tailwind-css-escape.guard.test.ts` (added by SA, W-9).

---

## 6. Verification (Dev, before handover; QA repeats the type check)

| # | Step | Expect |
|---|---|---|
| V-1 | `npx jest app/admin/components/layout app/admin/__tests__/health app/admin/components/__tests__` | all green |
| V-2 | `npx jest app/admin/business-os-llm lib/admin/__tests__/admin-authz-surface.guard.test.ts app/admin/__tests__/jobsQueues` | all green, no edit |
| V-3 | `npm run test:bos-entitlements` | green (proves S-4: no tier or capability literal added) |
| V-4 | Scoped type check: a scratch tsconfig **in the session scratchpad** (never committed) that `extends` the worktree `tsconfig.json`, sets `incremental: false`, and `include`s only `next-env.d.ts`, the 6 new source files, the 6 new shared tests, `health.layout.render`, `HealthGrid.tsx`, `app/admin/page.tsx`, `HealthTile.tsx`, `AdminHeader.tsx`, `AdminChrome.tsx`, both `readJsonBody.ts` files, `ActivityTab.tsx`, `ActivityDrillDown.tsx`, and the two edited tests. **Run 1:** with a deliberate canary (`const canary: number = 'x';` in `adminFormat.ts`) → must report TS2322 at that line. **Run 2:** canary removed → zero errors in the listed files. Errors in transitively imported files that are not touched are recorded, not fixed. Never rely on a whole-repo `tsc` (it runs out of memory silently and reads as clean) | both runs recorded in §8 |
| V-5 | ESLint on the touched files: `npx eslint <files> --no-config-lookup --no-inline-config --config eslint.hooks.config.mjs --max-warnings 0` (the `lint:hooks` rule), then `npx eslint <files>` with the default config | no hook violation; no new findings in touched files |
| V-6 | `git diff --stat` before reading the diff | every touched file shows insertions where expected; no file blanked; `AdminSidebar.tsx`, `app/admin/layout.tsx`, `components/ui/*`, `lib/utils.ts`, `app/admin/page.tsx`, `HealthTile.tsx` absent |
| V-7 (QA) | Browser, `/admin`, preview tools or DevTools emulation of the light and of the dark colour-scheme preference (SA Q-8). Per scheme: page at rest (one h1 "Health", shell shows no title, date and Sign out intact, Refresh in a bar under the header, As of readable); narrow viewport: menu button named "Open menu"; error state (block `/api/admin/health-summary` or go offline: red box, network copy, Try again works); loading spinner visible on a throttled reload; the page looks the same in both schemes. Spot-check two other admin pages still show their own h1 once loaded | screenshot or one line per item in the QA report |

The worktree's `node_modules` is a junction to the main checkout and lacks `lib-address`; `/admin` does not import it, so the dev server for V-7 is not affected.

---

## 7. Task List

- ✅ T-1 `layout/adminFormat.ts` + `adminFormat.test.ts`
- ✅ T-2 `layout/readJsonBody.ts` (moved body) + `layout/readAdminResponse.ts` + `readAdminResponse.test.ts`
- ✅ T-3 `business-os-llm/readJsonBody.ts` → one-line re-export; run V-2's BOS AI tests
- ✅ T-4 `layout/AdminPageHeader.tsx` + render test
- ✅ T-5 `layout/AdminStates.tsx` (`AdminLoading`, `AdminError`) + render test
- ✅ T-6 `layout/AdminFilterBar.tsx` (Refresh only, no `readAt` per W-2) + render test
- ✅ T-7 `HealthGrid.tsx` migration (§3.7)
- ✅ T-8 `health.render.test.tsx` edits (§5.2) + new `health.layout.render.test.tsx`
- ✅ T-9 `AdminHeader.tsx` + `AdminChrome.tsx` (C-1) + `AdminHeader.render.test.tsx` edits (incl. W-10 mock removal)
- ✅ T-10 `layout/__tests__/layoutFolder.guard.test.ts` (C-14, part (a) with RC-5, part (b) Health)
- ✅ T-11 Verification V-1 to V-6, results in §8
- ✅ T-12 Hand over to TL for SA code review (uncommitted)

---

## 8. Results

Implementation and verification by Dev, 2026-10-09, on `feature/admin-layout-standard` (uncommitted).

### 8.1 Files

| File | Action |
|---|---|
| `app/admin/components/layout/adminFormat.ts` | created (`formatUtc`) |
| `app/admin/components/layout/readJsonBody.ts` | created (body moved verbatim, header comment updated) |
| `app/admin/components/layout/readAdminResponse.ts` | created (`ADMIN_NETWORK_ERROR`, `readAdminResponse`, options with `sessionEndedCopy`) |
| `app/admin/components/layout/AdminPageHeader.tsx` | created |
| `app/admin/components/layout/AdminStates.tsx` | created (`AdminLoading`, `AdminError`) |
| `app/admin/components/layout/AdminFilterBar.tsx` | created (Refresh only, no `readAt`) |
| `app/admin/components/layout/__tests__/` (6 files) | created: `adminFormat.test.ts`, `readAdminResponse.test.ts`, `AdminPageHeader.render.test.tsx`, `AdminStates.render.test.tsx`, `AdminFilterBar.render.test.tsx`, `layoutFolder.guard.test.ts` |
| `app/admin/__tests__/health.layout.render.test.tsx` | created |
| `app/admin/components/health/HealthGrid.tsx` | edited (§3.7) |
| `app/admin/components/AdminHeader.tsx`, `AdminChrome.tsx` | edited (C-1) |
| `app/admin/business-os-llm/readJsonBody.ts` | edited (re-export plus one comment line) |
| `app/admin/__tests__/health.render.test.tsx`, `app/admin/components/__tests__/AdminHeader.render.test.tsx` | edited (§5.2) |
| `docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md` | §1 row 1 (L-1a) notes cell only: deferred exports recorded (ruling 10) |

### 8.2 Conditions applied

| # | How |
|---|---|
| W-1 | S-3 allow-list runs over `SOURCE_FILES` only; S-2 runs over every walked file, tests included |
| W-2 | No `readAt` prop; no "Read at" cases except one assertion that the bar shows no "Read at" text |
| W-3 | Proxy throws only on string keys outside `ok`, `status`, `json`; `then` returns undefined; symbols pass through. A self-test proves the probe throws on `headers`, `statusText`, `text`, `clone` |
| W-4 | `asOfLine` shows the em dash whole when `formatUtc(end)` is the em dash; test "shows the em dash, never an empty As of ." |
| W-5 | Inner `try` wraps only `fetch`; its `catch` alone maps to `ADMIN_NETWORK_ERROR` |
| W-6 | Every new `.render.test.tsx` carries the `@jest-environment jsdom` docblock |
| W-7 | `greenVerdict` collects green-holding `const` names across all source files; self-test plants two constants in two files and expects size 2 |
| W-8 | Absolute include paths; both runs below; canary removed (grep confirms) |
| W-9 | Tailwind escape guard in V-2; a scratch scan of every new and changed file with the same decoder found 0 bad escapes and 0 backslash-u / backslash-x |
| W-10 | `next/navigation` mock removed |
| Ruling 3b | `sessionEndedCopy` built; both branches tested (401 and 403 with it on, 403 "Forbidden" with it off, 500 untouched with it on) |

### 8.3 Verification results

| # | Command | Result |
|---|---|---|
| V-1 | `npx jest app/admin/components/layout app/admin/__tests__/health app/admin/components/__tests__ --ci` | 13 suites passed, 214 tests passed, 0 failed |
| V-2 | `npx jest app/admin/business-os-llm lib/admin/__tests__/admin-authz-surface.guard.test.ts app/admin/__tests__/jobsQueues app/__tests__/tailwind-css-escape.guard.test.ts --ci` | 19 suites passed, 735 tests passed, 0 failed |
| V-3 | `npm run test:bos-entitlements` | 215 suites passed, 5776 tests passed, 0 failed |
| V-4 run 1 | `npx tsc -p <scratchpad>/tsconfig.l1a.json --pretty false`, canary `const canary: number = 'x';` in `adminFormat.ts` | exit 2, exactly one error: `app/admin/components/layout/adminFormat.ts(19,7): error TS2322: Type 'string' is not assignable to type 'number'.` |
| V-4 run 2 | same, canary removed | exit 0, zero errors |
| V-5 hooks | `npx eslint <19 touched files> --no-config-lookup --no-inline-config --config eslint.hooks.config.mjs --max-warnings 0` | exit 0, no output |
| V-5 default | `npx eslint <19 touched files>` | exit 0, no findings (JSON format confirmed the files are linted, not ignored) |
| V-6 | `git diff --stat` | 6 tracked files, 95 insertions, 101 deletions; the only deletion-heavy file is `business-os-llm/readJsonBody.ts` (24 lines out, 2 in: the expected move). `AdminSidebar.tsx`, `app/admin/layout.tsx`, `app/admin/page.tsx`, `HealthTile.tsx`, `components/ui/*`, `lib/utils.ts` absent |

V-4 include list (absolute paths in the scratch tsconfig, `extends` the worktree `tsconfig.json`, `incremental: false`): `next-env.d.ts`; the 6 shared source files; the 6 shared tests; `health.layout.render.test.tsx`, `health.render.test.tsx`, `AdminHeader.render.test.tsx`; `HealthGrid.tsx`, `HealthTile.tsx`, `app/admin/page.tsx`, `AdminHeader.tsx`, `AdminChrome.tsx`, `business-os-llm/readJsonBody.ts`, `ActivityTab.tsx`, `ActivityDrillDown.tsx`. No errors in transitively imported files.

### 8.4 Deviations from the plan

| # | Deviation | Why |
|---|---|---|
| D-1 | `readAdminResponse.ts` keeps the session copy and the fallback template as module-private (`ADMIN_SESSION_ENDED`, `adminReadFallback`), not exported | Every export needs a consumer in the pilot (SA-R-3); Health uses only `ADMIN_NETWORK_ERROR` and `readAdminResponse`. Tests assert the literal strings |
| D-2 | `business-os-llm/readJsonBody.ts` carries one comment line above the re-export | Says where the code went and that L-8 deletes the file |
| D-3 | `AdminHeader.render` "Open menu" test also clicks the button and checks `onMenuClick` is called once | Proves the named button is the real toggle; no other change |
| D-4 | `health.layout.render` adds two cases beyond §5.1: the loading state shows and then clears, and the tile grid is `aria-busy` during a Refresh | Cover `AdminLoading` in the pilot and the §5.10 refresh state |

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| A test that renders `HealthGrid` without the `@/lib/logger/client` mock throws on import (RC-1) | Both Health render files mock it; V-1 proves it |
| The read helper touches a `Response` member a mock lacks (RC-2) | Proxy probe in `readAdminResponse.test.ts` |
| The region count changes | Shared parts render no `<section>` and no region (S-8 guard); `health.render :140-150` unchanged |
| A second `fetch` slips in (Try again, Refresh) | Both call the existing `load`; the single-fetch pin and the fetch-count assertions stay |
| Four pages (Analytics, Businesses, Messages, Model pricing) show no h1 while their spinner shows | Accepted by SA (Q-11) until their own slices |
| A file in the folder gets a Next special name and becomes a render entry | S-2 in C-14 |
| Type errors invisible to ts-jest | V-4 with the canary first |
| Shared `node_modules` junction | No `git worktree remove`, no `git stash` |

---

## 10. Out of scope

`AdminSidebar.tsx` and its nav test; `app/admin/layout.tsx`; `app/admin/page.tsx`; `HealthTile.tsx` (F-57 stays open); `components/ui/*`; `lib/utils.ts` (`cn()`); `jobsFormat.ts` and every Jobs file (L-1b); the BOS AI importers of `readJsonBody` (L-8); every other admin page; `AdminEmpty`, `AdminNotice`, `formatUtcDate`, `formatCount`, header `badge` / `actions`; KPI tiles, status chip, dialog class; filter controls, presets, URL state, business picker, table constants, drawer; any route, request or data change; any CI workflow or npm script.

---

## 11. Questions for SA

| # | Question | Dev proposal |
|---|---|---|
| Q-1 | "Try again" is optional in `AdminError`. Health passes `onRetry`, so the prop has a consumer (SA-R-3) and the error box matches §5.10; Refresh stays in the bar at the same time | Use it on Health |
| Q-2 | `AdminLoading` carries `role="status"` (a polite live region, not a landmark, so A-9 and the region count hold) | Keep |
| Q-3 | The shared `formatUtc` appends "UTC" to every instant, so Health's As of line gains "UTC" after each date-time and keeps "As of HH:mm UTC" by taking the time tail (as Jobs does). No test pins the wording | Accept the wording in §3.7 |
| Q-4 | `readAdminResponse` treats a 2xx as success only when `body.success === true` (Health's current rule). A later page whose route omits `success` would need an option | Keep for L-1a; extend in the slice that needs it |

---

## SA Review Notes

See "SA Workplan Review — 2026-10-09" below. The code review pass is appended there after implementation.

## SA Workplan Review — 2026-10-09

**Reviewed by SA — 2026-10-09** (workplan stage, no code). Verified against the worktree at `88f97171`: `HealthGrid.tsx`, `AdminHeader.tsx`, `AdminChrome.tsx:32`, `business-os-llm/readJsonBody.ts` and its two importers, `jobsFormat.ts:14-20`, `lib/logger/client.ts`, `health.render.test.tsx`, `health.source.guard.test.ts`, `AdminHeader.render.test.tsx`, the BOS AI `source.guard.test.ts` import rule, the authz surface guard (render-entry regex `:882-883`, route-handler rule `:1687`), `jest.config.js` (default environment `node`, `testMatch` includes every file under `__tests__/`), `tsconfig.json`, and `/api/admin/health-summary` (returns `success: true` / `success: false`).

**Status:** APPROVED WITH CONDITIONS. Dev may start implementation and applies W-1 to W-10 below as part of it; none needs a re-review of the workplan.

### Rulings on the Dev questions

| # | Question | Ruling |
|---|---|---|
| 1 | "As of" wording with "UTC" after every date-time (Q-3) | **Approved.** §5.11 requires one shared formatter; the extra "UTC" is its output, not a copy decision. "As of HH:mm UTC" from the tail is fine, subject to W-4 |
| 2 | Health copy changes (fallback text, network copy) | **Confirmed standard-forced, not side quests.** §5.10 rules 2 to 4 replace "The health summary could not be loaded" and the raw `err.message`; §7.1 names the error move. The server's own `error` string stays verbatim (rule 1). Name both in the PR as forced changes |
| 3a | Health passes `onRetry`, so two reload controls show in the error state (Q-1) | **Approved.** §5.10 Error requires "Try again" in the error box, and §5.5 requires Refresh in the bar on every page; both call the same `load`, so the single-fetch pin holds. Health is the prop's consumer, so SA-R-3 is met |
| 3b | `sessionEndedCopy` has no consumer in L-1a | **Build it now.** RC-4 makes the opt-in part of the helper's contract, and its default-off branch is exactly what Health relies on (403 shows "Forbidden"); both branches are tested. First consumer: Jobs, L-1b |
| 3c | `readAt` has no consumer in L-1a | **Defer to L-1c** (W-2). Health and Jobs both omit it (§5.5 part 6), so its first consumer is Audit trail; building it now is an unconsumed prop plus its own time-tail formatting for two slices. This narrows the "optional Read-at" line of the SA re-check scope table; consistent with R-2 |
| 4 | Health purpose is two sentences (§5.3 says one) | **Keep it unchanged in L-1a.** The scope table says "purpose sentence unchanged"; the second sentence is the colour legend the tiles depend on. Recorded as a known deviation; no guard counts sentences |
| 5 | `AdminLoading` `role="status"` (Q-2) | **Approved.** A polite live region, not a landmark: the region count and A-9 hold |
| 6 | Success is `body.success === true` (Q-4) | **Approved.** The route returns literal `true`; stricter than today's truthy check with no behaviour change. A page whose route omits `success` adds an option in its own slice |
| 7 | Leftover `next/navigation` mock in `AdminHeader.render.test.tsx` | **Remove it** (W-10). Once `AdminHeader.tsx` imports nothing from `next/navigation`, the mock is dead test code (code review item 8) and misleads the next reader. It is part of the C-1 test edit, not a new one |
| 8 | `type="button"` and `aria-hidden` on the menu button and its icon | **Approved** (A-2; `type="button"` matches Sign out). Do not touch the Sign out icon: out of scope |
| 10 | Recording the deferred exports | **Dev records them** in the requirement's §1 row 1 (L-1a) notes during implementation, per R-2: `AdminEmpty`, `AdminNotice`, `formatUtcDate`, `formatCount`, header `badge` / `actions`, the filter controls, and now `readAt` (L-1c). Doc-only edit; §2 of this workplan corrected by SA |

### Checks requested by TL

| Check | Result |
|---|---|
| Guard design (C-14 part (a) and (b)) | **Sound**, with W-1 and W-7. Walked folder, explicit registry per R-1, "no dead regex" self-tests, comment stripping as in `health.source.guard`. The authz render-entry regex needs `/name.ext`, so neither the folder name `layout/` nor any planned file name matches it; S-2 adds the stricter in-folder rule |
| Inside the existing Jest gate, no CI time added | **Yes.** Pure `fs` reads; `testMatch` picks up `app/admin/components/layout/__tests__/**`; no script, no workflow (S-10). Adds a few hundred milliseconds to one shard |
| Scoped tsc with canary (V-4) | **Honest**, with W-8. `typeRoots`, `types` and `paths` are inherited from the extended config and TypeScript resolves them relative to the worktree `tsconfig.json`, so jest globals and the alias work; the canary proves the run actually checks |
| Nothing outside scope | **Confirmed.** `AdminSidebar.tsx`, `app/admin/layout.tsx`, `app/admin/page.tsx`, `HealthTile.tsx`, `components/ui/*`, `lib/utils.ts` absent from the plan; V-6 checks it |
| Tests that stay green unedited | **Listed** (§5.3); SA added the Tailwind escape guard (W-9) |
| BOS AI re-export | Passes the BOS AI import rule (only `@/lib/` specifiers are refused); no BOS AI test imports `readJsonBody` directly |
| Health strict pins | Region count, single fetch, "Forbidden" verbatim (500 + `error`, rule 1), no green, no "OK" (new copy and `response.ok` are lower case; the shared constant lives outside the three Health files), `'use client'` — all hold on the plan as written |

### Findings and conditions

| # | Severity | Finding / condition |
|---|---|---|
| W-1 | must | §4 S-3 row: the import allow-list (and its "no `../`" clause) applies to **source files only**, not `__tests__/`. The new tests import `@testing-library/react`, `fs`, `path` and `../AdminStates`; applied to them the rule is red on day one. S-2 still covers every file, tests included |
| W-2 | must | Ruling 3c: no `readAt` prop on `AdminFilterBar` in L-1a; drop the "Read at" happy-path and failure-path cases from `AdminFilterBar.render.test.tsx` and the "no Read at" assertion in `health.layout.render`. Record the move (ruling 10) |
| W-3 | should | RC-2 Proxy probe: throw only on **string** keys outside `ok`, `status`, `json`; return `undefined` for `then` and pass every **symbol** key through. Otherwise promise resolution or Jest's pretty-printer reading a symbol produces a false failure that looks like an RC-2 breach |
| W-4 | should | Health's "As of HH:mm UTC" is the tail of `formatUtc(end)`; when `formatUtc` returns the em dash, show the em dash, never "As of ." One test in `health.layout.render` |
| W-5 | should | In `HealthGrid.load`, keep only the `fetch` call inside the `try` that maps to `ADMIN_NETWORK_ERROR`, so an unexpected throw elsewhere is never labelled as a connection problem |
| W-6 | should | Every new `.render.test.tsx` carries the `@jest-environment jsdom` docblock: `jest.config.js` defaults to `node` |
| W-7 | should | RC-5 "at most one green constant" counts the set of green-holding `const` names **across the whole folder**, not per file; the self-test plants two constants in two files and expects red |
| W-8 | note | V-4: the scratch tsconfig's `include` entries must be absolute paths (they resolve from the scratchpad, not the worktree). Record the exact file list and both runs in §8. Remove the canary before V-6 |
| W-9 | note | Add `app/__tests__/tailwind-css-escape.guard.test.ts` to V-2 (it scans all tracked files, the new guard's regex literals included); write no backslash-u or backslash-x escapes in the new files |
| W-10 | note | Ruling 7: remove the `next/navigation` mock from `AdminHeader.render.test.tsx` with the C-1 edit; list it in §5.2 at hand-over |

**Optimisation suggestions (non-blocking):** omit explicit `JSX.Element` return types on the new components (the admin folder does not use them, and the global `JSX` namespace is deprecated in newer React types); keep `ADMIN_NETWORK_ERROR` and the fallback template as the only copy in `readAdminResponse.ts` so later pages cannot drift.

### Verdict

**APPROVED WITH CONDITIONS.** Musts W-1 and W-2 and shoulds W-3 to W-7 are applied during implementation; SA checks them at code review. Corrections made by SA in this file: §2 (who records the deferred exports), §5.3 (Tailwind escape guard), status line.

## SA Code Review — 2026-10-09

**Code Review by SA — 2026-10-09** (uncommitted worktree `neuronforge-admin-layout`, branch `feature/admin-layout-standard`).
**Status:** ✅ Code Approved (no must-fix). One should-fix is carried to L-1b (CR-1); the rest are notes.

### What was checked

| Area | Result |
|---|---|
| `git diff --stat` first | 6 tracked files, 95+/101-. The only deletion-heavy file is `business-os-llm/readJsonBody.ts` (24 out, 2 in), which is the planned move; its body is present verbatim in `layout/readJsonBody.ts:16-29`. No blanked file |
| Scope | Modified: `health.render.test.tsx`, `business-os-llm/readJsonBody.ts`, `AdminChrome.tsx`, `AdminHeader.tsx`, `AdminHeader.render.test.tsx`, `HealthGrid.tsx`. New: `components/layout/**`, `health.layout.render.test.tsx`, the two docs. `AdminSidebar.tsx`, `app/admin/layout.tsx`, `app/admin/page.tsx`, `HealthTile.tsx`, `components/ui/*`, `lib/utils.ts` untouched |
| `readAdminResponse` | Reads only `status`, `ok` and `json()` via `readJsonBody` (RC-2), never `fetch`. Success needs `response.ok` and `body.success === true` (status first; a 500 that claims success is a failure, tested). Message order: opt-in session copy for 401/403, then a non-blank string `error` verbatim (untrimmed), then the fixed fallback. Never a parser message or `statusText` (RC-4, §5.10 rules 1, 2 and 4). D-1 (session copy and fallback kept module-private) accepted |
| RC-2 probe | The Proxy throws on any string key other than `ok`/`status`/`json`, ignores `then`, and passes symbols through (W-3). It has its own self-test, so it is not a dead probe |
| `AdminError` (RC-3) | `data-testid` is on the `<p>` message element (`AdminStates.tsx:43`); the icon is `aria-hidden`; "Try again" is a sibling outside it. Tested |
| `formatUtc` | Same code as `jobsFormat.ts:14-20`, and a parity test runs both on five samples |
| HealthGrid parity | `'use client'`; `clientLogger.child({ module })`; one `fetch('/api/admin/health-summary', { cache: 'no-store' })`; Refresh and Try again both call the same `load`; the server `error` is shown verbatim (the "Forbidden" pin is unchanged and green); no green, no "OK", no `<section>`, no `<h1`, no `.json(`; the previous summary stays on screen on failure. W-4 (em dash shown whole) and W-5 (only `fetch` inside the network `try`) are applied and tested |
| C-14 guard | Walks the folder; S-2 runs on every file, S-3 on sources only (W-1); S-4, S-5, S-6, S-7/RC-5 (counted across the folder, W-7) and S-8; part (b) is the explicit Health registry with the S-1 relative-path check. Every regex has a self-test that matches a planted violation and passes a clean sample. Read through, these self-tests would go red if a pattern were weakened |
| AdminHeader | No heading; `type="button"` and `aria-label="Open menu"` with an `aria-hidden` icon; still exactly 2 buttons and no links (test unchanged); dead `next/navigation` mock removed (W-10) |
| Accessibility | One h1 per page, pinned while loading and once loaded. Refresh's accessible name starts with its visible text. `aria-busy` is set on the button and on the grid. Focus rings on the new buttons. No landmark regions |
| Standards | No `console.*` and no `any` in the new or changed source files (`as any` appears only in the two test fetch stubs, each with an eslint comment). No `cn()` overrides (S-9). The new shared pattern is under SA review as rule 7 requires |
| Tests run by SA | `npx jest app/admin/components/layout app/admin/__tests__/health app/admin/components/__tests__/AdminHeader.render.test.tsx app/admin/business-os-llm/__tests__/source.guard.test.ts --ci`: 12 suites, 388 tests, all passed. `npx jest lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts app/admin/business-os-llm --ci`: 13 suites, 555 tests, all passed |

### Code Review Comments

| # | Where | Finding | Severity |
|---|---|---|---|
| CR-1 | `layout/__tests__/layoutFolder.guard.test.ts:125-142` (`greenVerdict`) | A declaration's "scope" runs from `const` to the next `;`. As a result, an arrow component such as `const Badge = () => <span className="bg-green-500" />;` counts as "the one green constant", so green rendered inline in a component passes S-7. Nothing in L-1a is green, so the rule holds today. **Fix it in L-1b**, when this rule tightens to "exactly one": accept only a SCREAMING_SNAKE name whose initializer is a string or object literal (no `=>`, no `<`). Add a self-test that plants the arrow-component case and expects it to be reported as `outside` | Should-fix (L-1b, not blocking L-1a) |
| CR-2 | `HealthGrid.tsx:55-79` | The outer `try` has only a `finally`. After W-5, a throw that is not a network failure would become an unhandled rejection from `void load()`: the spinner stops, but no error shows and nothing is logged. This cannot happen today, because `readAdminResponse` never throws (`readJsonBody` swallows parse errors). Optional: an outer `catch` that logs `{ err }` and shows the fixed fallback. Worth considering when L-1b extracts the read loop for reuse | Note |
| CR-3 | `AdminHeader.tsx:21-30` | Two consecutive block comments above the component. Merge them into one | Note (style) |
| CR-4 | `layout/__tests__/adminFormat.test.ts` | The parity test imports `jobsFormat.formatUtc`. When L-1b moves Jobs to the shared formatter and deletes its copy, it must drop or rewrite this test. Record this in the L-1b workplan | Note (carry to L-1b) |
| CR-5 | `AdminStates.tsx:19-26` / `HealthGrid.tsx` | `AdminLoading` mounts its `role="status"` region together with its text, and some screen readers do not announce a live region's initial content. After "Try again" succeeds, the button unmounts and focus falls to `<body>`. Neither blocks L-1a. QA V-7 should note what it observes. Address in a later slice if the standard wants focus moved to the content | Note |
| CR-6 | Requirement §6.2 C-4 vs `readAdminResponse.ts:36-38` | The requirement describes the return as `{ ok, status, body, message }`. The built (and workplan-approved) shape is a discriminated union with `data` on success and `message` on failure. This is better typed and needs no code change. BA/Dev: align the C-4 wording at the next requirement edit | Note (doc) |
| CR-7 | `layoutFolder.guard.test.ts:67-72` (`specifiersOf`) | Covers static `import`/`export … from` and side-effect imports, but not dynamic `import('…')` or `require('…')`. No shared file uses either. Add both when the folder first needs lazy loading | Note |

### Optimisation Suggestions
- None blocking. The PR body must name the forced visible changes on `/admin` from §3.7 (ruling 2): the shell title removed, Refresh → Refresh in a bar, As of on slate-400 with full UTC date-times, the spinner copy, the red error box with Try again, the new fallback and network copy.

### Code Approved for QA: Yes

**Verdict: APPROVED.** No must-fix. CR-1 is a should-fix assigned to L-1b (record it in the L-1b workplan). CR-2 to CR-7 are notes. Proceed to QA (V-7 browser check in both colour schemes), then the user diff review.

## QA Testing Report

## QA Report — 2026-10-09

**QA — 2026-10-09** (worktree `neuronforge-admin-layout`, branch `feature/admin-layout-standard`, uncommitted)
**Test mode:** full
**Strategy used:** A (unit: read helpers, formatter), B-lite (jsdom render of the Health page with a mocked `fetch`), scoped `tsc` with a canary first (§12.2). D (browser) is deferred to TL, because it needs an admin login.
**Focus:** ui, schema (read-helper contract), security (no session copy leaked onto Health), accessibility
**Skipped:** browser check V-7 (no admin login in a QA session; checklist for TL below)
**Input source:** TL prompt

### Commands and results

| # | Command | Result |
|---|---|---|
| Q-1 | `npx jest app/admin/components/layout app/admin/__tests__ app/admin/components/__tests__ app/admin/business-os-llm lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci` | **33 suites passed, 954 tests passed, 0 failed** (74.9 s). Includes `layoutFolder.guard`, `health.render`, `health.layout.render`, `health.source.guard`, `health.qa-slice5.render`, `AdminHeader.render`, `AdminSidebar.nav`, every BOS AI test, all 7 `jobsQueues.*`, the authz surface guard and the Tailwind escape guard |
| Q-2 | `npm run test:bos-entitlements` | **215 suites passed, 5776 tests passed, 0 failed** (88.7 s), exit 0. One "worker process has failed to exit gracefully" warning (existing teardown noise) |
| Q-3a | Scoped `tsc`, **canary run**. QA's own `tsconfig.canary.json` in the session scratchpad: `extends` the worktree `tsconfig.json`, `incremental: false`, absolute `include` of the 25 files in V-4 plus a scratch `canary.ts`. No source file was edited | **exit 2, exactly the 3 planted errors:** `canary.ts(4,14) TS2322` (plain `number = 'x'`); `canary.ts(6,14) TS2322` (`number = formatUtc(null)` through the `@/` alias, which proves the alias resolves into the worktree and types flow through); `canary.ts(8,69) TS2561` ("'wat' does not exist in type 'ReadAdminResponseOptions'. Did you mean to write 'what'?") |
| Q-3b | Same file list, **clean run** (`tsconfig.clean.json`, no canary) | **exit 0, zero errors.** `--listFiles` shows 42 files under `app/admin` in the program (the 25 listed plus transitive imports), all clean |
| Q-4 | Throwaway Jest file `app/admin/__tests__/zzqa-l1a-temp.test.tsx` (the edge cases below) | **34 passed, 0 failed.** File deleted afterwards |
| Q-5 | `git status --short` after cleanup | Identical to the start of QA: the 6 modified files, `health.layout.render.test.tsx`, `components/layout/`, the requirement and this workplan. `git diff --stat`: 6 files, 95 insertions, 101 deletions (unchanged) |

### Edge cases tested (QA, beyond the Dev tests)

Every `readAdminResponse` case used a strict RC-2 Proxy (`ok`, `status` and `json` only; any other string key throws).

| Unit | Input | Expected | Result |
|---|---|---|---|
| `readAdminResponse` | 200 + non-JSON body (`json()` throws) | `{ ok: false, status: 200 }` with the fallback copy | ✅ Pass |
| `readAdminResponse` | 200 + JSON array | fallback | ✅ Pass |
| `readAdminResponse` | 200 + `{ success: false, error: 'x' }` | `'x'` | ✅ Pass |
| `readAdminResponse` | 200 + `{ success: 'true' }` (truthy, not `true`) | not ok | ✅ Pass |
| `readAdminResponse` | 200 + `{ success: true }` with no `data` | `ok: true`, `data: undefined` (no shape check, by design) | ✅ Pass (see E-2) |
| `readAdminResponse` | 500 + HTML | fallback, never the parser text | ✅ Pass |
| `readAdminResponse` | 500 + `{ success: true }` | not ok (status first) | ✅ Pass |
| `readAdminResponse` | 401 and 403 without `sessionEndedCopy` | route `error` verbatim; an HTML body → fallback | ✅ Pass |
| `readAdminResponse` | 401 and 403 with `sessionEndedCopy` | session copy, even when the body has an error or is HTML | ✅ Pass |
| `readAdminResponse` | `sessionEndedCopy` on 404, 500 and a 200 failure | untouched (route error or fallback) | ✅ Pass |
| `readAdminResponse` | 404 + `error: ''` and an error of three spaces plus a newline | fallback | ✅ Pass |
| `readAdminResponse` | `error` = 42, an object, an array, null, true | fallback | ✅ Pass |
| `readAdminResponse` | JSON `null` body (502) | fallback | ✅ Pass |
| `readAdminResponse` | `error: ' Bad '` | shown verbatim, untrimmed | ✅ Pass (rule 1) |
| `formatUtc` | `null`, `''`, `'not a date'`, `'2026-13-45T99:99:99Z'` | em dash | ✅ Pass |
| `formatUtc` | `+02:00`, `-05:00`, and `+01:00` across a year boundary | converted to UTC (`2026-01-01T00:30+01:00` → `2025-12-31 23:30 UTC`) | ✅ Pass |
| `formatUtc` | `…14:02:59.999Z` | `14:02` (truncates, never rounds up) | ✅ Pass |
| `formatUtc` | date-only `'2026-10-09'` | `2026-10-09 00:00 UTC` | ✅ Pass |
| `HealthGrid` | fetch never resolves | `role="status"` "Reading the health summary…"; one h1 "Health"; Refresh `aria-busy="true"` and disabled; no alert; 0 regions; no As of; 1 fetch | ✅ Pass |
| `HealthGrid` | fetch rejects (`TypeError: Failed to fetch`) | `health-error` text is exactly the network copy; the browser message is absent; "Try again" is inside the alert; Refresh not busy; `logger.error` called once; one h1 | ✅ Pass |
| `HealthGrid` | 403 `{ error: 'Forbidden' }` | "Forbidden" verbatim, no session copy, `logger.error({ status: 403 }, …)` | ✅ Pass |
| `HealthGrid` | 200 `{ success: true, data }` | regions = tile count (3); 1 fetch; one h1; As of text exactly "As of 10:30 UTC. Last 24 h = 2026-09-25 10:30 UTC to 2026-09-26 10:30 UTC; last 7 days from 2026-09-19 10:30 UTC."; no status, no alert; Refresh text "Refresh", not busy | ✅ Pass |
| `HealthGrid` | success → Refresh gets a 502 HTML → Try again | fallback copy; tiles stay (3 regions); Try again clears the error; 3 fetches in total | ✅ Pass |
| `HealthGrid` | 200 `{ success: true }` with no `data` | (probe) | Blank body: no tiles, no error, no spinner (E-2) |

### Accessibility checks (jsdom)

| Check | Result |
|---|---|
| Exactly one h1 on Health (loading, error, loaded) | ✅ 1 in each state, text "Health" |
| Refresh accessible name "Refresh the health summary", visible text "Refresh" | ✅ |
| Refresh `aria-busy="true"` and disabled while loading; `"false"` after | ✅ |
| `AdminError` is `role="alert"`; the `health-error` text is exactly the message; Try again sits outside it | ✅ |
| No region landmarks added: 0 while loading; region count = tile count once loaded | ✅ |
| `AdminHeader`: exactly 2 buttons, 0 links, 0 headings; menu button named "Open menu", `type="button"`, icon `aria-hidden="true"` | ✅ |
| A-1 focus ring on the shared parts (Refresh, Try again) | ✅ both carry `focus-visible:ring-2 focus-visible:ring-purple-500` |
| A-1 focus ring on the shell's menu button | ⚠️ Absent (E-1) |

### Acceptance criteria coverage (§12.2, L-1a)

| Criterion | Tested? | Result | Notes |
|---|---|---|---|
| Shared parts exist, each with tests for the happy path and one failure path | ✅ | Pass | Every new unit has both (the Dev tests plus the QA edge cases above) |
| One pilot (Health) uses every new export | ✅ | Pass | `AdminPageHeader`, `AdminFilterBar`, `AdminError`, `AdminLoading`, `readAdminResponse`, `ADMIN_NETWORK_ERROR` and `formatUtc` are all used; `readJsonBody` is used through `readAdminResponse` |
| No other page migrated; sidebar and `layout.tsx` untouched | ✅ | Pass | `git status`, `git diff --stat` |
| C-14 guard green, Health in the registry | ✅ | Pass | `layoutFolder.guard` |
| Scoped `tsc` with a canary first | ✅ | Pass | Q-3a, Q-3b |
| Jest gate green, no added CI time | ✅ | Pass | No workflow or script change |
| `AdminHeader` change ships with its test edited; one h1 per visible page | ✅ | Pass (jsdom) | Other pages' h1 after their spinner: browser spot-check (TL) |
| Health pins: region count, single fetch, `GREEN_STYLE`, never "OK", client file, verbatim error | ✅ | Pass | `health.render`, `health.source.guard`, QA cases |
| `business-os-llm/readJsonBody.ts` is a re-export | ✅ | Pass | Two lines (comment + re-export, D-2); BOS AI tests green |
| Chrome root carries `[color-scheme:dark]` | ✅ | Pass | Diff |
| Both colour schemes checked (SA Q-8) | ❌ | Not run | Browser only; TL checklist below |

### Issues Found

#### Bugs (must fix before commit)

None.

#### Performance Issues (should fix)

None. One fetch per read; Try again and Refresh share `load`.

#### Edge Cases (nice to fix)

1. **E-1 — The shell's menu button has no visible focus ring (A-1)** — File: `app/admin/components/AdminHeader.tsx:59` — Severity: Low. The button L-1a touched (now named "Open menu") has `lg:hidden p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors` and no `focus-visible:ring-*`; Sign out (`:96`) has none either. Not a regression, and the workplan scoped C-1 to the name and `type`, but §5.12 A-1 says "every interactive element". Either add the A-1 classes to both buttons in this slice (two class strings) or record it in requirement §9.
2. **E-2 — `{ success: true }` with no `data` renders a silent blank page** — Files: `app/admin/components/layout/readAdminResponse.ts`, `HealthGrid.tsx` — Severity: Low. `setSummary(undefined)` leaves no tiles, no error and no spinner; on a Refresh it also removes the tiles already on screen. The code before L-1a behaved the same way (`setSummary(body.data)`), and SA ruling 6 / §3.3 accepted "same trust as today's cast", so this is not a regression. Worth a `data !== undefined` check when a later slice adds options to the helper.
3. **E-3 — Refresh disables itself while it has focus** — File: `app/admin/components/layout/AdminFilterBar.tsx` — Severity: Low (browser to confirm). A keyboard user who presses Refresh gets a disabled button; browsers blur a disabled element, so focus falls to `<body>`. This is the same pattern as SA CR-5 (focus lost when Try again unmounts). jsdom cannot show it; TL checks items 6 and 7 below. If confirmed, `aria-disabled` plus ignoring clicks while busy would keep focus.

### Browser checklist for TL (V-7, both schemes)

At `/admin`, signed in as an admin, in DevTools → Rendering → "Emulate CSS media feature prefers-color-scheme": run every item once in **light** and once in **dark**. The page should look the same in both.

1. Page at rest: exactly one title, "Health", in the page body under the shell. The shell header shows **no** title: only the date line (weekday, month, day, year), the admin name and Sign out.
2. Refresh sits in a bar under the page header, right-aligned, text "Refresh", grey button. The line "As of HH:mm UTC. Last 24 h = … UTC to … UTC; last 7 days from … UTC." is readable (slate-400 on the dark background).
3. Focus rings: Tab through the page from the address bar. Refresh shows a purple ring; in the error state, Try again shows a purple ring. Note whether the shell's menu button and Sign out show any ring (E-1).
4. Refresh: click it. The icon spins, the button greys while reading, the tiles stay on screen, and the Network tab shows one request to `/api/admin/health-summary` with no query string.
5. Loading: Network throttling "Slow 3G", hard reload. The title and Refresh stay visible while a purple spinner reads "Reading the health summary…"; no blank page.
6. Keyboard Refresh: Tab to Refresh, press Enter. After the read finishes, where is focus? Record "stays on Refresh" or "lost to the page" (E-3).
7. Error state: in the Network tab, block the request URL `health-summary` (or go Offline), then click Refresh. Expect a red box with an alert icon, the text "Could not reach the server. Check your connection and try again.", and a "Try again" button; the previous tiles stay below. The red text is readable in both schemes. Unblock, press Try again with the keyboard: the box disappears, the As of time updates; record where focus lands (SA CR-5).
8. Narrow viewport (under 1024 px): the menu button appears; in the Accessibility pane its name is "Open menu"; clicking it opens the sidebar.
9. Native controls dark: with the light scheme emulated, the page scrollbar stays dark (the chrome root carries `color-scheme: dark`).
10. Spot-check two other admin pages (for example Scheduled jobs & queues and Audit trail): each shows its own h1 once loaded, and the shell shows no second title.

### Final Status

- [x] Every acceptance criterion that can run outside a browser passes: no bugs, 3 Low edge cases recorded
- [ ] Browser check in both colour schemes (SA Q-8) still owed by TL before commit

**Verdict: PASS WITH NOTES.** No bug. Notes: E-1 to E-3 (Low), and the two-scheme browser check is still owed.

## Commit Info

(RM populates.)

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-09 | Created (Dev workplan) | L-1a scope from the SA re-check; code verified at `88f97171`; RC-1 to RC-5 mapped to §3.3, §3.5, §4, §5 |
| 2026-10-09 | SA workplan review | APPROVED WITH CONDITIONS; rulings on Q-1 to Q-4 and the TL-relayed questions; W-1 to W-10 (`readAt` deferred to L-1c, S-3 scoped to source files); SA corrections to §2, §5.3, status |
| 2026-10-09 | Dev implementation | T-1 to T-12 done, uncommitted; W-1 to W-10 applied; §5.2 W-10 row; §8 results (V-1 to V-6) |
| 2026-10-09 | SA code review | APPROVED, code approved for QA. No must-fix; CR-1 (green-constant scope loophole) should-fix carried to L-1b; CR-2 to CR-7 notes. SA re-ran 25 suites / 943 tests green |
| 2026-10-09 | QA report | PASS WITH NOTES: 954 + 5776 tests green; scoped tsc canary (3 planted errors) then clean (0); 34 QA edge-case tests (deleted afterwards); no bugs; E-1 to E-3 Low; browser checklist for TL |
