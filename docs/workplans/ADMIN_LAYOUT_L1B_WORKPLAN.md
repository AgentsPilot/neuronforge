# Workplan: Admin Layout Standard — Slice L-1b (KPI strip and tile, status chip, admin dialog class → pilot Scheduled jobs & queues)

> **Last Updated**: 2026-10-10

**Developer:** Dev
**Requirement:** [ADMIN_LAYOUT_STANDARD_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md): §5.3, §5.4 (K-1 to K-10), §5.5 part 6, §5.9, §5.10, §5.11, §5.12, §6.1 (S-1 to S-10), §6.2 (C-3, C-5, C-10, C-11, C-12, C-14), §7.2, §9 (F-56, F-60, F-88, F-89), §10 (D-4, D-8, D-15), §12.2, §12.3; SA re-check RC-1 and RC-5; L-1a SA code review carry-overs CR-1 and CR-4 ([ADMIN_LAYOUT_L1A_WORKPLAN.md](/docs/workplans/ADMIN_LAYOUT_L1A_WORKPLAN.md))
**Branch:** `feature/admin-layout-l1b`, cut from `origin/main` `a42bae2a` (L-1a merged as PR #285; finance page PR #284 also on main). Worktree `neuronforge-admin-layout`
**Date:** 2026-10-10
**Status:** Code Complete — uncommitted, awaiting SA code review (workplan SA-approved with conditions 2026-10-10; M-1 to M-3 met, S-1, S-2, S-4 done; see Implementation Notes)
**Path:** full cycle (new shared patterns, CLAUDE.md rule 7)

## Overview

L-1b adds three shared parts to `app/admin/components/layout/`: the KPI strip and tile (anchor mode), the status chip, and the admin dialog class constants. It also adds `formatCount` (deferred from L-1a; its first consumer is the KPI values). It ships them with exactly one pilot, Scheduled jobs & queues (`/admin/jobs-queues`), which uses every new export and also moves onto the L-1a parts (`AdminPageHeader`, `AdminFilterBar` Refresh, `AdminLoading`, `AdminError`, `readAdminResponse`, `formatUtc`). Jobs' three dialogs (Drain now, Cancel item, Retry item) adopt the dialog class, which fixes the close-X contrast in the light scheme (F-88). The C-14 guard is tightened (CR-1, RC-5: exactly one green constant) and Jobs joins its registry. No route, request, data, permission or action changes. Estimate: about 3 days (moderate, per the SA re-check).

---

## Table of Contents

1. [Analysis Summary](#1-analysis-summary-code-verified-at-a42bae2a)
2. [Scope](#2-scope)
3. [Implementation Approach and Component APIs](#3-implementation-approach-and-component-apis)
4. [FinanceKpiStrip reuse decision, and notes for L-1c](#4-financekpistrip-reuse-decision-and-notes-for-l-1c)
5. [The C-14 guard changes](#5-the-c-14-guard-changes)
6. [Tests](#6-tests)
7. [Verification](#7-verification)
8. [Task List](#8-task-list)
9. [Risks](#9-risks)
10. [Out of scope](#10-out-of-scope)
11. [Questions for SA](#11-questions-for-sa)

---

## 1. Analysis Summary (code verified at `a42bae2a`)

### 1.1 Files this slice touches, as they are today

| File | As built (line numbers at `a42bae2a`) | L-1b change |
|---|---|---|
| `app/admin/jobs-queues/page.tsx` (16 lines) | Renders `JobsQueuesView` through a relative import `:12` | **Not edited.** Listed in the C-14 registry |
| `app/admin/components/jobs/JobsQueuesView.tsx` (386 lines) | `createLogger` `:29`, `:42`; `import { ageWords, formatUtc } from './jobsFormat'` `:32`; `type Tone` `:44`; `GREEN_STYLE` `:47`; `TONE_CLASSES` `:49-54`; `JOB_TONE` `:56-65`; `QUEUE_TONE` `:67-76`; `export { formatUtc }` `:80` (for the render test); `Badge` `:89-99` (used `:120`, `:215`); one `fetch` `:273`, `.json().catch` `:274-277`, error from `body.error` or `err.message` `:278-284`; `<header>` with `<h1>`, purpose (legend + pinned action sentence), As of on slate-500 via `.slice(11)` (F-60), own Refresh button `:297-322`; error `<p role="alert" data-testid="jobs-error">` `:324-328`; "Loading…" `:329`; `<section id="jobs">` `:333-367`, `<section id="queues">` `:369-381` | Migrated (§3.6) |
| `app/admin/components/jobs/QueueItemsPanel.tsx` (333 lines) | `createLogger` `:36`, `:43`; `import { ageWords, formatUtc } from './jobsFormat'` `:37`; one GET `:161-164`; `.json().catch` `:165-168`; fixed sentences `LOAD_FAILED`, `SESSION_ENDED` `:52-53`; 3 `<button` elements `:227`, `:313`, `:321` | Logger (F-56), `readJsonBody`, formatter import. Nothing else |
| `app/admin/components/jobs/DrainNowDialog.tsx` (304 lines) | `createLogger` `:32`, `:36`; `DARK_DIALOG` `:38`; `.json().catch` `:170`; `className={DARK_DIALOG}` `:201`; title `!text-white` `:210`; description `!text-slate-400` `:211` | Logger, dialog constants, `readJsonBody` |
| `app/admin/components/jobs/CancelQueueItemDialog.tsx` (321 lines) | `createLogger` `:42`, `:46`; `DARK_DIALOG` `:48`; `.json().catch` `:209`; `className={DARK_DIALOG}` `:238`; title `:247`; description `:248` | Same as Drain |
| `app/admin/components/jobs/RetryQueueItemDialog.tsx` (379 lines) | `createLogger` `:43`, `:49`; `import { formatUtc } from './jobsFormat'` `:44`; `DARK_DIALOG` `:51`; `.json().catch` `:253`; `className={DARK_DIALOG}` `:287`; title `:296`; description `:297` | Same as Drain, plus the formatter import |
| `app/admin/components/jobs/jobsFormat.ts` (28 lines) | `formatUtc` `:14-20`, `ageWords` `:23-28`; no imports (pinned) | `formatUtc` removed (Jobs uses the shared copy); `ageWords` stays; still no imports |
| `app/admin/components/layout/adminFormat.ts` (25 lines) | `formatUtc` only | Gains `formatCount` |
| `app/admin/components/layout/__tests__/adminFormat.test.ts` (31 lines) | Parity test imports `jobsFormat.formatUtc` `:7`, `:26-30` (CR-4) | Parity test dropped; `formatCount` tests added |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` (356 lines) | `EXPECTED_SOURCES` `:48-55`; `greenVerdict` `:125-142` (CR-1 loophole: scope runs from `const` to the next `;`, any name, any initializer); "at most one" `:190-194` (RC-5); green self-tests `:266-282`; registry `MIGRATED_PAGES` `:295-304` (Health only) | §5 |
| `components/ui/dialog.tsx` | Close button is a direct child of `DialogPrimitive.Content` `:101-104`, class `opacity-70 text-[var(--v2-text-muted,var(--foreground))] ring-offset-background … focus:ring-2 focus:ring-ring focus:ring-offset-2`. Title `text-[var(--v2-text-primary,inherit)]` `:145`; description `text-[var(--v2-text-muted,var(--muted-foreground))]` `:159` | **Not edited** (SA Q-4). Wrapped by child selectors |
| `lib/admin/jobs/buildJobsQueuesView.ts` | `queueStatus` `:298-309`: `stuck >= 1` → `stuck` (first rule); `deadLettered24h >= 1` → `dead_lettered_24h` unless already `stuck` or `stopped_draining`; all three are red in `QUEUE_TONE` | **Not edited.** Read only, to confirm the K-5 (i) source of the two red tiles (§3.6) |

### 1.2 Existing test facts this plan depends on

| Test | Fact |
|---|---|
| `app/admin/__tests__/jobsQueues.render.test.tsx` (207 lines) | Mocks `@/lib/logger` with `createLogger` only `:16-18` (RC-1). Imports `JOB_TONE, QUEUE_TONE, TONE_CLASSES, formatUtc` from the view `:21`. Exactly one fetch, `['/api/admin/jobs-queues', { cache: 'no-store' }]` `:70-75`. `[data-testid^="job-"]` count = `BOS_CRON_JOBS.length` and `[data-testid^="queue-"]` count = 5 `:82-83`. `status-badge` textContent exact `:84-86`. **Exactly 11 buttons**, one containing "Refresh", each card exactly `['Drain now','View items']` `:101-115`. Green only on Healthy or Clear badges by className, `tone === 'green'` iff healthy / clear, `TONE_CLASSES` has 4 distinct values `:117-127`. Refresh by `/Refresh/` and aria-busy `:148-156`. `jobs-error` textContent exactly "Forbidden" on a 500 with `error: 'Forbidden'` `:158-162`. QA-L2 formatter unit test uses the view's re-export `:165-172` |
| `app/admin/__tests__/jobsQueues.source.guard.test.ts` (300 lines) | `FILES` = page, view, panel `:51`; `CLIENT_FILES` = the 6 client files `:53`. The view's header sentence is pinned verbatim (`VIEW_HEADER_SENTENCE` `:54-55`), and stripped before the "no Retry / Requeue / Cancel / Drain, no POST, no console, no OK" check `:85-93`. **Green lives only in `GREEN_STYLE`, referenced exactly twice** `:95-102`. View: "Drain" exactly once `:112-116`; **exactly one `fetch(`, the literal `fetch('/api/admin/jobs-queues', { cache: 'no-store' })`** `:118-122`. Each dialog: one POST, one fetch, pinned body, no green, no console, never "OK" `:124-144`, `:208-236`, `:264-299`. Panel: one GET, 3 `<button` elements, no green `:147-173`. `jobsFormat.ts`: no imports `:175-181`. **Cancel and Retry never read `.error`, `.details` or `.message`** from a response `:233-236`, `:291-295` (dialogs never show server text) |
| `jobsQueues.drain.render.test.tsx` (329), `jobsQueues.cancel.render.test.tsx` (408), `jobsQueues.retry.render.test.tsx` (502), `jobsQueues.items.render.test.tsx` (657) | Each mocks `@/lib/logger` with `createLogger` only (drain `:21-23`, cancel `:22-33`, retry `:23-34`, items `:19-30`). Cancel, retry and items route `warn` / `error` to `mockLoggerWarn` / `mockLoggerError` and assert on them (cancel `:369-381`, retry `:460-472`, items `:461`, `:519`, `:530`). Fetch mocks are `{ ok, status, json }` only; every action body is an object or `null` (a `json()` that throws). Drain's in-flight test clicks the corner close by name "Close" `:165-169`. Items: Refresh by `/Refresh/` `:489`, `:653` |
| `app/admin/components/layout/__tests__/*` | L-1a shared tests; `AdminFilterBar` prop is `onRefresh` (D-15), accessible name "Refresh {what}" |
| `app/admin/__tests__/health.source.guard.test.ts` | Scans its explicit 3-file Health list only, so the shared folder's single green constant does not affect it (C-11 note) |

### 1.3 Logging (CLAUDE.md "non-compliant files you touch")

None of the 6 Jobs files calls `console.*` (pinned by the Jobs guard). Five of them use `createLogger` from `@/lib/logger` in a client file (F-56); they are converted to `clientLogger.child({ module })` because they are touched (SA Q-6). Module names are kept (`AdminJobsQueuesView`, `AdminQueueItemsPanel`, `AdminDrainNowDialog`, `AdminCancelQueueItemDialog`, `AdminRetryQueueItemDialog`).

---

## 2. Scope

| Area | In L-1b |
|---|---|
| Shared folder, new | `KpiStrip.tsx` (`KpiStrip`, `KpiTile`, anchor mode, neutral and "Needs action" only); `StatusChip.tsx` (`StatusChip`, tones `danger`, `warn`, `ok`, `unknown`; the one green constant); `adminDialog.ts` (`ADMIN_DIALOG_CLASS`, `ADMIN_DIALOG_TITLE_CLASS`, `ADMIN_DIALOG_DESCRIPTION_CLASS`); tests for each |
| Shared folder, extended | `adminFormat.ts` gains `formatCount` (C-5, deferred from L-1a) |
| Guard | `layoutFolder.guard.test.ts`: CR-1, RC-5 (exactly one), expected files, registry entry for Jobs |
| Pilot | `JobsQueuesView.tsx` (header, KPI strip, Refresh bar, states, read helper, chip, formatter, logger); `QueueItemsPanel.tsx` and the 3 dialogs (logger, `readJsonBody`, dialog constants, formatter import); `jobsFormat.ts` (`formatUtc` removed) |
| Tests edited | The 5 Jobs render tests (RC-1 logger mock; `jobsQueues.render` also tone and Refresh-name edits), `jobsQueues.source.guard` (green rule rewritten, dialog-class pins added), `adminFormat.test.ts` (CR-4) — exact edits in §6.2 |
| Tests new | `StatusChip.render`, `KpiStrip.render`, `adminDialog.render` (shared folder); `jobsQueues.layout.render` (pilot) |

**Built here because the pilot uses it (moved from L-1a):** `formatCount` (KPI values).

**Still deferred, to be recorded by Dev in the requirement's §1 L-1b notes during implementation (SA-R-3 rule; L-1a ruling 10 precedent):** the KPI tile's cross-page `next/link` mode (Q-2) and its other K-4 statuses "Needs a look", "Healthy", "Not measured yet", "Could not check" (Q-3); the `info` and `neutral` chip tones (Q-4); `AdminEmpty`, `AdminNotice`, `formatUtcDate` (Jobs has no empty state and no amber notice; first consumer expected L-1c); the `badge` and `actions` props of `AdminPageHeader` (Jobs has neither); the same-page filter tile mode (already L-2a, R-7).

---

## 3. Implementation Approach and Component APIs

All shared `.tsx` files start with `'use client'`; `adminDialog.ts` and `adminFormat.ts` are plain modules with no imports. Shared files import only from the S-3 allow-list (react, lucide-react, files inside the folder). No shared file logs in L-1b. Classes are explicit slate (T-1, T-2); meaningful text is slate-400 or lighter (T-5); focus ring `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500` (A-1); no `<section>`, no `role="region"` (A-9, S-8); no override that depends on `cn()` order (S-9: the shared files do not use `cn()` at all).

### 3.1 `adminFormat.ts`: add `formatCount` (C-5)

```ts
/** Thousands separators per §5.11 ("12,345"); em dash for a value that is not a finite number. */
export function formatCount(value: number): string;
```

`Number.isFinite(value) ? value.toLocaleString('en-US') : '—'`. `formatUtc` is unchanged. (The finance page has its own `financeFormat.formatCount`; converging it is the finance adoption slice's job, §4.)

### 3.2 `StatusChip.tsx` (C-12, §5.9)

```ts
/** §5.9 tones built in L-1b: the four the pilot uses. `info` and `neutral` arrive with their first consumer (Q-4). */
export type StatusTone = 'danger' | 'warn' | 'ok' | 'unknown';

export interface StatusChipProps {
  tone: StatusTone;
  /** The status in words. Always present (A-7): colour is never the only signal. */
  children: string;
  /** Lets a page keep its existing test id (Jobs: "status-badge"). */
  testId?: string;
}
export function StatusChip(props: StatusChipProps);
```

- Markup: `<span data-testid={testId} data-tone={tone} className="inline-flex items-center gap-1 whitespace-nowrap rounded border px-2 py-0.5 text-xs font-medium {tone classes}">` → icon `h-3 w-3`, `aria-hidden="true"` → `{children}`. A `<span>`, never a `<div>` (F-62). The icon adds no text, so the chip's `textContent` is exactly the words (keeps the Jobs `status-badge` text pins).
- Tones (§5.9 classes and icons): `danger` `border-red-500/40 bg-red-500/15 text-red-300` + `AlertOctagon`; `warn` `border-amber-500/40 bg-amber-500/15 text-amber-300` + `AlertTriangle`; `ok` + `CheckCircle2`; `unknown` `border-dashed border-slate-600 bg-slate-800/60 text-slate-400` + `CircleDashed`.
- **The one green constant of the shared folder (S-7, T-6):** `const OK_TONE = 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300';` — an ALL-CAPS name whose initializer is a string literal, so it passes the tightened CR-1 rule (§5). The tone table references it by name; no other green anywhere in the folder.

### 3.3 `KpiStrip.tsx` (C-11, §5.4) — anchor mode only

```ts
export interface KpiStripProps {
  /** K-10: the first read is in flight; render `placeholderCount` fixed-height placeholders and no tiles. */
  loading?: boolean;
  placeholderCount?: number;
  children?: ReactNode;
}
export function KpiStrip(props: KpiStripProps);

/** K-4 status rows built in L-1b: the one the pilot uses (Q-3). Absent = a neutral tile (no status row). */
export type KpiTileStatus = 'needs_action';

export interface KpiTileProps {
  label: string;
  /** Already formatted by the page (formatCount, a money formatter, …). */
  value: string;
  /** K-3 / K-8 sub-line, e.g. "at least: 1 of 5 queues could not be checked". */
  sub?: string | null;
  status?: KpiTileStatus | null;
  /** K-6 anchor mode: a same-page anchor such as "#queues". Cross-page and same-page filter modes come later (Q-2, R-7). */
  href: `#${string}`;
  testId?: string;
}
export function KpiTile(props: KpiTileProps);
```

- `KpiStrip`: `<div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">` (K-2), no role. With `loading`, it renders `placeholderCount` `<div aria-hidden="true" className="h-28 rounded-xl border border-slate-700 bg-slate-800/40 animate-pulse" />` (K-10: no layout jump) and ignores `children`.
- `KpiTile`: the whole tile is one `<a href={href}>` (K-6), **never a `<button>` and never a `<section>`**, so the Jobs 11-button pin holds. Classes: `block rounded-xl border bg-slate-800 p-4 transition-colors hover:bg-slate-700/60` + A-1 focus ring + the card border: neutral `border-slate-700`; `needs_action` `border-red-500/40` (Health `STATUS_STYLES.red`, K-4).
- Content (K-3): label `<span className="block text-sm font-medium text-white">`; value `<span className="mt-1 block text-2xl font-semibold tabular-nums text-white">`; optional sub `<span id={subId} className="mt-1 block text-xs text-slate-400">`; for `needs_action` a status row `<span className="mt-1 flex items-center gap-1 text-xs font-medium text-red-300">` with `AlertOctagon` (`aria-hidden`) and the text "Needs action" (K-4: icon + text always). Spans, not `<p>`/`<div>`, because the content sits inside `<a>`.
- K-7 accessible name: `aria-label="{label}, {value}"` plus `", needs action"` for that status; the sub-line is linked with `aria-describedby={subId}` (`useId`), so it is announced but not part of the name. The label text starts the name (WCAG 2.5.3).
- No green in this file (Jobs uses neutral and red only). When the "Healthy" status arrives, it must take its green from `StatusChip`'s single constant (Q-3), so S-7 stays at exactly one.

### 3.4 `adminDialog.ts` (C-10, F-88, F-89)

```ts
/** Replaces the 6 DARK_DIALOG copies (one page at a time, SA Q-5). Pass to ui/dialog DialogContent. */
export const ADMIN_DIALOG_CLASS: string;
/** For DialogTitle: the title colour cannot lose to the primitive's token class. */
export const ADMIN_DIALOG_TITLE_CLASS: string;
/** For DialogDescription. */
export const ADMIN_DIALOG_DESCRIPTION_CLASS: string;
```

Values (each class a literal in the file, so Tailwind sees it):

| Constant | Classes | Why |
|---|---|---|
| `ADMIN_DIALOG_CLASS` | `!border-slate-700 !bg-slate-900 !text-slate-100` | Today's `DARK_DIALOG` palette, unchanged |
| | `[color-scheme:dark]` | T-4 / SA-R-7: the dialog portals to `body`, outside the chrome |
| | `[&>button]:text-slate-300 [&>button]:opacity-100 [&>button:hover]:text-white` | **F-88 fix.** The corner close is the only direct-child `<button>` of the content (`dialog.tsx:101`; the Jobs dialogs' own buttons sit inside `DialogFooter` or other wrappers). `.x>button` (0,1,1) beats the primitive's `text-[var(--v2-text-muted,var(--foreground))]` (0,1,0), which resolves to `#171717` in the light scheme. Specificity, not `cn()` order, decides (T-3, S-9) |
| | `[&>button:focus]:ring-purple-500 [&>button]:ring-offset-slate-900` | The close's focus ring (`focus:ring-ring` has no colour, F-66) and its offset (`ring-offset-background` is white in the light scheme). `.x>button:focus` (0,2,1) beats `.focus:ring-ring:focus` (0,2,0) |
| `ADMIN_DIALOG_TITLE_CLASS` | `!text-white` | Today's title class. `!` wins over `text-[var(--v2-text-primary,inherit)]` whatever the order or whether `--v2-*` happens to be defined |
| `ADMIN_DIALOG_DESCRIPTION_CLASS` | `!text-slate-400` | Today's description class |

`components/ui/dialog.tsx` is not edited (SA Q-4). No `AdminDialogContent` wrapper (C-10 marks it optional): three constants are the smallest change and keep every dialog's own `DialogContent` props (test ids, `aria-label`, the Escape and outside-click guards while busy) exactly as they are (Q-8).

### 3.5 Jobs: shared read for the panel and dialogs

Each of the 4 remaining direct reads becomes `readJsonBody(response)` (§5.10 "every fetch body goes through readJsonBody"; Q-5):

| File | Today | After | Behaviour |
|---|---|---|---|
| `QueueItemsPanel.tsx:165-168` | `(await response.json().catch(() => null)) as …` | `(await readJsonBody(response)) as …` (same cast) | Identical: object bodies pass through; a body that does not parse is `null` in both |
| `DrainNowDialog.tsx:170` | `const body: unknown = await response.json().catch(() => null);` | `const body: unknown = await readJsonBody(response);` | Identical for every object body and every unparseable body. Only a JSON body that is an array or a primitive changes, from "unknown" to "timed out"; no drain route answer is ever one (named in the PR) |
| `CancelQueueItemDialog.tsx:209` | same | same | Identical: `classify` and `currentLabelOf` already treat any non-object as "no body" |
| `RetryQueueItemDialog.tsx:253` | same | same | Identical, as Cancel (`field()` reads only objects) |

The panel keeps its own fixed sentences (`LOAD_FAILED`, `SESSION_ENDED`) and the dialogs keep their outcome maps: `readAdminResponse` is **not** used there, because its rule 1 shows the route's `error` string and these four files are pinned never to show server text. `readJsonBody` never calls `fetch`, so every one-fetch pin holds. The dialogs read no `.error`, `.details` or `.message`, so the "never renders server text" pins hold.

### 3.6 Jobs pilot: `JobsQueuesView.tsx`

**Imports.** `@/lib/logger/client`; the shared parts through the alias (S-1): `AdminPageHeader`, `AdminFilterBar`, `AdminError` + `AdminLoading`, `ADMIN_NETWORK_ERROR` + `readAdminResponse`, `formatUtc` + `formatCount`, `KpiStrip` + `KpiTile` (+ `type KpiTileProps`), `StatusChip` + `type StatusTone`. `RefreshCw` and the local `formatUtc` import are dropped; `ageWords` still comes from `./jobsFormat`. Type imports from `lib/admin/jobs` stay `import type` (C-21).

**Removed:** `type Tone`, `GREEN_STYLE`, `TONE_CLASSES`, `Badge`, `export { formatUtc }`, the own `<header>` / `<h1>` / Refresh button / "Loading…" / `<p role="alert">`.

**Tones.**

```ts
export const JOB_TONE: Record<JobStatus, StatusTone> = {
  stopped: 'danger', keeps_failing: 'danger',
  late: 'warn', last_run_failed: 'warn', partly_done: 'warn',
  no_run_yet: 'unknown', could_not_check: 'unknown',
  healthy: 'ok',
};
export const QUEUE_TONE: Record<QueueStatus, StatusTone> = {
  stuck: 'danger', stopped_draining: 'danger', dead_lettered_24h: 'danger',
  behind: 'warn', dead_lettered_7d: 'warn', failures_24h: 'warn',
  could_not_check: 'unknown',
  clear: 'ok',
};
```

Green still appears only on Healthy and Clear (T-6), now through the chip's `ok` tone. Grey becomes `unknown` (dashed border + `CircleDashed`), which is §5.9's meaning for "not measured / could not check" (Q-4). Both chips keep `testId="status-badge"`.

**Copy.** The purpose text is unchanged, word for word. It is kept as two constants so the pinned action sentence stays one contiguous literal in the source (the guard's `toContain` and `replace` on `VIEW_HEADER_SENTENCE`):

```ts
const PURPOSE_LEGEND = 'The Business OS scheduled jobs and the queues they drain. Red needs action, …could not check.';
const PURPOSE_ACTIONS = "Each queue has a Drain now button; a waiting, failed or orphaned item can be cancelled, and a recently failed item can be retried, from its queue's list; everything else here is read-only.";
const WHAT = 'the jobs and queues';
```

No other new copy contains "Drain", "Cancel", "Retry", "Requeue" or "OK" (all pinned in this file).

**Read loop** (the HealthGrid shape, SA W-5): only `fetch('/api/admin/jobs-queues', { cache: 'no-store' })` sits inside the inner `try` (the literal is unchanged, so the one-fetch pin holds); its `catch` logs `{ err }` and shows `ADMIN_NETWORK_ERROR`. Then `readAdminResponse<JobsQueuesViewData>(response, { what: WHAT, sessionEndedCopy: true })` (RC-4 opt-in; SA L-1a ruling 3b named Jobs its first consumer; the panel and dialogs already say the same sentence on 401/403). Not ok → `logger.error({ status }, …)` and `setError(result.message)`; the previous view stays on screen, as today. `finally` keeps `setLoading(false)` and the `refreshKey` bump (FR-Q7). A 500 with `error: 'Forbidden'` still shows "Forbidden" (rule 1).

**KPI tiles** (§7.2, K-5 / SA-R-4), computed in a pure in-file function from the payload the page already reads (K-9; no second request):

| Tile (`testId`) | Value | Sub-line | Status | `href` |
|---|---|---|---|---|
| Jobs (`kpi-jobs`) | `formatCount(view.jobs.length)` | Count per each job's own `statusWords`, in payload order, e.g. "6 Healthy · 1 Last run failed" | **Neutral always** (SA-R-4) | `#jobs` |
| Queues (`kpi-queues`) | `formatCount(view.queues.length)` | Count per each queue's own `statusWords` | **Neutral always** | `#queues` |
| Stuck items (`kpi-stuck`) | Sum of `figures.stuck` over queues whose figures were read | "across N queues", or K-8 "at least: M of N queues could not be checked" | `needs_action` when the sum is ≥ 1, else neutral | `#queues` |
| Dead-lettered (24 h) (`kpi-dead-lettered`) | Sum of `figures.deadLettered24h` | as Stuck | `needs_action` when ≥ 1, else neutral | `#queues` |

K-5 (i) holds for the two red tiles: by `queueStatus` (`buildJobsQueuesView.ts:302-304`), any queue with `stuck >= 1` already has status `stuck`, and any with `deadLettered24h >= 1` already has `stuck`, `stopped_draining` or `dead_lettered_24h`; all three are red on the page. The tile repeats a red the payload already carries; it adds no threshold (Q-10 asks SA to confirm the count form). Test ids avoid the `job-` and `queue-` prefixes the render test counts.

**Render order** (§5.1): `AdminPageHeader` (title "Scheduled jobs & queues", purpose, `asOf` = `As of ${formatUtc(view.now)}.` when a view is loaded, Q-7) → `KpiStrip` (tiles when a view exists; `loading placeholderCount={4}` while the first read is in flight; nothing after a failed first read, K-10) → `AdminFilterBar` (`what={WHAT}`, `busy={loading}`, `onRefresh={() => void load()}`, no Read-at: the header shows the server "As of", §5.5 part 6) → `AdminError` (`testId="jobs-error"`, `onRetry={() => void load()}`) → `AdminLoading what={WHAT}` while there is no view → the two sections unchanged inside `<div aria-busy={loading} className="space-y-6">` (§5.10 refresh state). `#jobs` and `#queues` keep their ids (Health links to them).

**Not changed in this file:** the table markup and classes (C-13 is L-1d), the queue cards' shell and `<dl>`, the Drain now / View items buttons, `QueueItemsPanel` wiring, `refreshKey`, every copy line other than the header.

### 3.7 Jobs: panel, dialogs, `jobsFormat.ts`

- `QueueItemsPanel.tsx`: logger → `clientLogger.child({ module: 'AdminQueueItemsPanel' })`; `formatUtc` from the shared `adminFormat`, `ageWords` from `./jobsFormat`; the read per §3.5. Its 3 `<button` elements, tabs, paging, fixed sentences and "Loading…" are unchanged.
- Each dialog: logger → `clientLogger.child({ module: … })`; `DARK_DIALOG` declaration deleted; `className={ADMIN_DIALOG_CLASS}` on `DialogContent`; `className={ADMIN_DIALOG_TITLE_CLASS}` on `DialogTitle`; `className={ADMIN_DIALOG_DESCRIPTION_CLASS}` on `DialogDescription`; the read per §3.5. `RetryQueueItemDialog` takes `formatUtc` from the shared `adminFormat`. The header comment line about `!` classes is updated to name the shared constant. Nothing else (copy, POST bodies, outcome maps, busy guards).
- `jobsFormat.ts`: `formatUtc` deleted; header comment updated (the shared formatter replaced it in L-1b). `ageWords` and the "no imports" rule stay.

### 3.8 Visible changes on `/admin/jobs-queues` (all forced by the standard; named in the PR)

The shell shows no title (already true since L-1a); a 4-tile KPI strip under the header (each tile a link to its section); Refresh moves into a bar under the strip (accessible name "Refresh the jobs and queues", D-15); As of moves from slate-500 to slate-400 and shows the full UTC date-time; status chips gain icons, and grey chips become dashed; "Loading…" becomes the spinner "Reading the jobs and queues…" with tile placeholders; the error becomes the red box with "Try again"; the fallback copy becomes "Could not read the jobs and queues. Try again in a moment."; a network failure shows the fixed network copy instead of the browser's message; a 401/403 shows "Your admin session has ended. Sign in again."; the three dialogs' corner X is readable in the light scheme, with a purple focus ring.

---

## 4. FinanceKpiStrip reuse decision, and notes for L-1c

### 4.1 Decision: build the shared tile from Health's `STATUS_STYLES` (C-11); do not generalise `FinanceKpiStrip`

PR #284 added `app/admin/finance/components/FinanceKpiStrip.tsx` (52 lines). Read in full. It is the closest existing tile, but it cannot be lifted into the shared folder, and the shared tile does not need it:

| `FinanceKpiStrip` today | Standard / shared-folder rule | Consequence |
|---|---|---|
| Imports `@/lib/business-os/finance/financeTypes` (`FinancePayload`, `FinanceTile`) | S-4: never `@/lib/business-os/**`, type-only included | Its props are finance-shaped; a generalisation must drop them anyway |
| Imports `STATUS_STYLES` from `@/app/admin/components/health/HealthTile` and `cn` from `@/lib/utils` | S-3 allow-list (no other app folder, no `@/lib/utils`) | Cannot move as is |
| Tile is a `<div>`; no link | K-6: the whole tile is an `<a>`; a tile with no target says so by not being a link | Different element and interaction |
| Every tile always shows a status row, including green and "For information" | K-4: a neutral tile shows **no** status row; K-5 colour sources | Different anatomy for neutral tiles |
| `grid gap-3 sm:grid-cols-3`; label `text-xs`, value `text-lg` | K-2 grid; K-3 label `text-sm font-medium`, value `text-2xl tabular-nums` | Different sizes |
| No composed accessible name | K-7 | Missing |

What **is** reused: the anatomy both share (label, value, optional sub-line, icon + text status row) and its source, Health's `STATUS_STYLES` labels and red/amber/green/slate classes, which K-4 names as the colour source. The shared `KpiTile`'s `needs_action` row is Health's `STATUS_STYLES.red` (label "Needs action", `AlertOctagon`, `border-red-500/40`, `text-red-300`).

**Finance adopts the shared tile later, in its own slice — not in L-1b.** L-1b does not edit `app/admin/finance/**`. That slice will need, at least: the remaining K-4 statuses in `KpiTile` (finance tiles carry `healthy`, `amber`, `not_measured`, `unavailable`, `neutral` from the server), with "Healthy" taking its green from `StatusChip`'s single constant (S-7); a decision per tile on K-6 (link target or plainly not a link); K-2/K-3 sizes; and its `financeFormat.formatCount` converging on the shared `formatCount`. Q-1 asks SA to confirm.

### 4.2 Notes for L-1c (from PR #284; nothing to do in L-1b)

| # | Finding | Why L-1c cares |
|---|---|---|
| N-1 | `app/admin/components/adminWindowPresets.ts` (86 lines, + `__tests__/adminWindowPresets.test.ts`) **already exists**: pure, UTC, presets `today`, `7d`, `30d`, `this_month` plus `custom` (the U-6 ids), `resolveAdminWindow`, `customRangeProblem`, `ADMIN_WINDOW_MAX_DAYS = 92` | C-8 says `resolveWindow` reuses `activityPresets.ts`; this sibling is the closer match and is already tested. L-1c should reuse it, not write a third preset module |
| N-2 | It lives **outside** `app/admin/components/layout/`, and is imported by `app/admin/finance/financeUrl.ts`, `FinanceFilterBar.tsx`, `app/api/admin/business-os/finance/route.ts` and **`lib/business-os/finance/financeWindow.ts`** | S-3 forbids the shared folder importing it. Moving it into `layout/` would make a `lib/` file and an API route import from the admin layout folder. L-1c needs an SA ruling: extend S-3 by this one pure module, or leave the filter bar's preset logic to the page |
| N-3 | Finance's URL keys are `preset`, `from`, `to`, `accountId`, written with `router.replace` (`FinanceView.tsx`, `financeUrl.ts:30`, `:70-78`) | U-5 canonical names are `range` and `account`; Q-2 says `history.replaceState` inside `useAdminFilters` only. Finance's later adoption has to map or alias them |
| N-4 | `FinanceFilterBar.tsx` imports the original `@/app/admin/audit-trail/BusinessAccountPicker` | A fourth importer of the original picker, beyond the ones RC-7 / R-11 listed. L-1c (picker contract test) and L-8 (deletion) must count it |

---

## 5. The C-14 guard changes (`layoutFolder.guard.test.ts`)

| # | Change | Detail |
|---|---|---|
| G-1 | `EXPECTED_SOURCES` | Add `KpiStrip.tsx`, `StatusChip.tsx`, `adminDialog.ts` |
| G-2 | **CR-1: tighten `greenVerdict`** | A green match counts as "inside the constant" only when its enclosing declaration is `const NAME = <literal>` where NAME is ALL-CAPS (letters, digits, underscores, starting with a capital), and the initializer starts with a quote (string literal) or `{` (object literal), and the declaration span (to the next `;`) contains no `=>` and no `<`. Any other green match is reported in `outside`, with the file name |
| G-3 | **RC-5: exactly one** | `expect(verdict.names.size).toBeLessThanOrEqual(1)` becomes `toBe(1)`; `verdict.outside` stays `[]`. Plus: the one constant is declared in `StatusChip.tsx` (Q-9), so a later slice cannot add a second green file silently |
| G-4 | CR-1 self-tests (no dead regex) | Each is reported as `outside`: (a) the arrow component from CR-1, `const Badge = () => <span className="bg-green-500" />;`; (b) an ALL-CAPS arrow, `const OK = () => 'bg-green-500';`; (c) a camelCase constant, `const okStyle = 'bg-green-500';`; (d) an ALL-CAPS constant built by a call, `const OK = make('bg-green-500');`. Each is **counted**: (e) `const OK_TONE = 'border-emerald-500/40';`; (f) `const GREEN = { card: 'bg-emerald-500/10' };`. The existing "two constants in two files count as 2" self-test is kept (W-7) |
| G-5 | Registry: Jobs entry | `{ page: '/admin/jobs-queues (Scheduled jobs & queues)', files: ['app/admin/jobs-queues/page.tsx', 'app/admin/components/jobs/JobsQueuesView.tsx', 'app/admin/components/jobs/QueueItemsPanel.tsx', 'app/admin/components/jobs/DrainNowDialog.tsx', 'app/admin/components/jobs/CancelQueueItemDialog.tsx', 'app/admin/components/jobs/RetryQueueItemDialog.tsx'] }` (the Jobs guard's `CLIENT_FILES`). Existing assertions per entry: files exist; one imports `AdminPageHeader` through the alias; no `<h1`; no `.json(` (true after §3.5); alias only (S-1) |

Rules S-2 to S-8 need no change: the three new files have allowed names, imports and no `<section>`. The new `[&>button]:…` and `[color-scheme:dark]` strings do not trip the `dark:` rule (its existing self-test covers `[color-scheme:dark]`).

---

## 6. Tests

### 6.1 New

| File | Happy path | Failure path(s) |
|---|---|---|
| `layout/__tests__/StatusChip.render.test.tsx` | For each of the 4 tones: a `<span>` with `data-tone`, textContent exactly the words, one `svg` with `aria-hidden="true"`; `testId` reaches `data-testid` | Only `ok` carries a green class; `danger`, `warn`, `unknown` carry none (the green regex of the Jobs guard); no `div` inside the chip |
| `layout/__tests__/KpiStrip.render.test.tsx` | A neutral tile is one link (`getByRole('link')`) with `href="#queues"`, name "Queues, 5", no "Needs action" text, `border-slate-700`; a `needs_action` tile is named "Stuck items, 3, needs action", shows the icon (`aria-hidden`) and the text "Needs action", `border-red-500/40`; the sub-line is the link's description (`aria-describedby`); focus-ring classes; the strip carries the K-2 grid classes | No `button` role and no `region` role anywhere; `loading` renders `placeholderCount` `aria-hidden` placeholders and no link even when children are passed; no `sub` → no `aria-describedby` |
| `layout/__tests__/adminDialog.render.test.tsx` | A `ui/dialog` opened with the three constants: the close button (name "Close") is a **direct child** of the dialog element (so the `[&>button]` selectors reach it); the dialog's class list contains `[color-scheme:dark]`, `[&>button]:text-slate-300`, `[&>button:focus]:ring-purple-500`; the title carries `!text-white` | The constants contain no `var(--v2-`, no `dark:` variant and no green; a `<button>` inside the dialog body (not a direct child) is not the element the selector targets (asserted by DOM position). jsdom cannot compute Tailwind; the contrast itself is the browser check (V-7) |
| `app/admin/__tests__/jobsQueues.layout.render.test.tsx` (pilot; new file so the strict existing pins stay exact, the `health.layout.render` precedent) | Exactly one level-1 heading, "Scheduled jobs & queues", while loading and once loaded; the purpose text unchanged; 4 tile links with hrefs `#jobs`, `#queues`, `#queues`, `#queues`; Jobs tile value = job count and neutral **even though a job is "Last run failed"** (SA-R-4); Queues tile neutral; Stuck tile red with "Needs action" when one queue has `stuck: 2`, neutral at 0; Dead-lettered tile likewise; the "at least: 1 of 5 queues could not be checked" sub-line (the fixture's `insight_actions` is unreadable); As of reads `As of 2026-09-27 12:00 UTC.`; Refresh named "Refresh the jobs and queues" and no "Read at" text; chips carry an icon; "No run recorded yet" and "Could not check" chips have `data-tone="unknown"`; clicking Drain now opens a dialog whose class list contains `ADMIN_DIALOG_CLASS` and whose "Close" button is its direct child | A 403 → "Your admin session has ended. Sign in again." (opt-in); a 500 whose `json()` throws → "Could not read the jobs and queues. Try again in a moment."; a rejected fetch → the network copy, and `logger.error` called; "Try again" refetches (2 fetches) and clears the error; placeholders while the first read is in flight, and no strip after a failed first read; a failed Refresh keeps the tiles and both sections on screen |
| `layout/__tests__/adminFormat.test.ts` (extended) | `formatCount(0)` "0", `formatCount(12345)` "12,345", `formatCount(1234567)` "1,234,567" | `NaN` and `Infinity` → em dash |

Every new `.render.test.tsx` carries the `@jest-environment jsdom` docblock (W-6) and, where it renders a Jobs file, the RC-1 logger mock.

### 6.2 Edited deliberately

| File | Edit | Why |
|---|---|---|
| `jobsQueues.render.test.tsx` | Add `jest.mock('@/lib/logger/client', …)` returning `clientLogger.child` → `{ error, warn, info, debug }` no-ops. The `@/lib/logger` mock stays (the test imports `lib/admin/jobs` builders) | RC-1 |
| `jobsQueues.render.test.tsx` `:21` | Import only `JOB_TONE, QUEUE_TONE` from the view; import `formatUtc` from `@/app/admin/components/layout/adminFormat` | `TONE_CLASSES` and the view's `formatUtc` re-export are removed (§3.6) |
| `jobsQueues.render.test.tsx` `:124-126` | `tone === 'green'` → `tone === 'ok'` (still iff `healthy` / `clear`); the line "`TONE_CLASSES` has 4 distinct values" → "the tones used are exactly `danger`, `warn`, `ok`, `unknown`" (a set over both maps). `:121-123` (className green only on Healthy / Clear) is **unchanged** | Tones now come from `StatusChip` |
| `jobsQueues.render.test.tsx` `:152` | `{ name: /Refresh/ }` → `{ name: 'Refresh the jobs and queues' }` | §7.2, D-15 |
| `jobsQueues.render.test.tsx` `:165-172` | Body unchanged; it now exercises the shared formatter (import change above) | CR-4 companion: the QA-L2 pin keeps covering the formatter Jobs prints with |
| `jobsQueues.drain.render.test.tsx`, `jobsQueues.cancel.render.test.tsx`, `jobsQueues.retry.render.test.tsx`, `jobsQueues.items.render.test.tsx` | Add the `@/lib/logger/client` mock **routing `warn` and `error` to the file's existing `mockLoggerWarn` / `mockLoggerError`** (no-ops in drain), so the existing log assertions keep holding. No other edit (items' `/Refresh/` queries still match the new name) | RC-1 |
| `jobsQueues.source.guard.test.ts` `:95-102` | "green lives in exactly one constant, `GREEN_STYLE`" → "no Jobs file holds a green class (all of `CLIENT_FILES` and `jobsFormat.ts`); green reaches the page only through the shared chip's `ok` tone (C-14 S-7); the view maps exactly two statuses to `'ok'` (`healthy`, `clear`)". The "referenced exactly twice" count is kept in spirit: exactly 2 occurrences of `: 'ok'` in the view | The green moved to the shared chip (§7.2 names this edit) |
| `jobsQueues.source.guard.test.ts` (new `it` in a new "L-1b" block) | Each dialog passes `className={ADMIN_DIALOG_CLASS}` to `DialogContent` exactly once, and its title and description use the two constants; no dialog declares `DARK_DIALOG` or any `!bg-` class of its own | Pins the C-10 adoption (F-88, F-89) |
| `jobsQueues.source.guard.test.ts` header comment | One paragraph "Amended by Admin Layout Standard L-1b" listing the two edits above, in the file's existing style | Audit trail of guard changes |
| `layoutFolder.guard.test.ts` | §5 (G-1 to G-5) | CR-1, RC-5, registry |
| `adminFormat.test.ts` `:7`, `:26-30` | Drop the `jobsFormat` import and the parity test; add the `formatCount` cases (§6.1). The header comment drops "so the L-1b swap is a no-op" | CR-4: Jobs' copy of `formatUtc` is deleted. The swap is proven by `jobsQueues.render` "the page renders a +02:00 start as UTC", which now runs through the shared formatter |

### 6.3 Must stay green with no edit

Every other assertion in the 5 Jobs render tests (11 buttons and per-card buttons; single fetch with `no-store`; `job-` / `queue-` testid counts; `status-badge` texts; "Forbidden" on a 500; dialog flows, busy guards and outcome sentences; corner close by name "Close"; panel paging and races); every other `jobsQueues.source.guard` rule (Drain exactly once, the header sentence verbatim, one view `fetch(` with its literal, dialog POST bodies, "never renders server text", panel's 3 buttons, `jobsFormat.ts` no imports); `health.render`, `health.layout.render`, `health.source.guard`, `health.qa-slice5.render`; the other L-1a shared tests; `AdminHeader.render`, `AdminSidebar.nav`; `app/admin/finance/__tests__/*`, `adminWindowPresets.test.ts`; `app/admin/business-os-llm/__tests__/*`; `lib/admin/__tests__/admin-authz-surface.guard.test.ts`; `app/__tests__/tailwind-css-escape.guard.test.ts`.

---

## 7. Verification (Dev, before handover; QA repeats the type check)

| # | Step | Expect |
|---|---|---|
| V-1 | `npx jest app/admin/components/layout app/admin/__tests__/jobsQueues app/admin/__tests__/health --ci` | all green |
| V-2 | `npx jest app/admin/components/__tests__ app/admin/finance app/admin/business-os-llm lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci` | all green, no edit |
| V-3 | `npm run test:bos-entitlements` | green (nothing in the slice imports `lib/business-os/entitlements`; proves S-4) |
| V-4 | Scoped type check: a scratch tsconfig **in the session scratchpad** (never committed), `extends` the worktree `tsconfig.json`, `incremental: false`, **absolute** `include` of `next-env.d.ts`, every shared source and test file, the 7 Jobs files (page, view, panel, 3 dialogs, `jobsFormat.ts`), the 6 Jobs tests, `HealthGrid.tsx` (a shared-folder consumer). **Run 1:** with a canary (`const canary: number = 'x';` in `StatusChip.tsx`) → exactly that TS2322. **Run 2:** canary removed → zero errors in the listed files. Never a whole-repo `tsc` | both runs recorded in Results |
| V-5 | `npx eslint <touched files> --no-config-lookup --no-inline-config --config eslint.hooks.config.mjs --max-warnings 0`, then `npx eslint <touched files>` | no hook violation (`KpiTile`'s `useId` is a real hook in a component); no new findings |
| V-6 | `git diff --stat` before reading the diff | insertions where expected, no blanked file; absent: `components/ui/*`, `lib/utils.ts`, `AdminSidebar.tsx`, `app/admin/layout.tsx`, `app/admin/finance/**`, `app/admin/components/health/**`, `app/admin/jobs-queues/page.tsx`, `lib/admin/jobs/**`, any route |
| V-7 (QA, browser) | `/admin/jobs-queues` signed in as an admin, DevTools emulation of the **light** and the **dark** colour-scheme preference (SA Q-8). Per scheme: page at rest (one h1, strip of 4 tiles, Refresh in the bar, As of readable, chips with icons); KPI tile focus ring when tabbing, and a tile click scrolls to `#jobs` / `#queues`; **each of the 3 dialogs open (Drain now on any queue; Cancel item and Retry item from a queue's item list, if the data offers a row; otherwise record "no eligible row")**: corner X visible, title readable, Tab to the X shows a purple ring, Escape closes and focus returns; error state (block the route: red box, network copy, Try again); loading (throttled reload: placeholders and spinner, header and bar stay). **F-88:** before the change (on `main`) and after (on the branch), record whether the X is near-invisible in the light scheme (§12.2 asks QA to record whether it was seen) | screenshot or one line per item in the QA report |

The worktree's `node_modules` is a junction to the main checkout; never remove or replace it. The known load-sensitive Jobs items test (W7A-2) passes alone; if it flakes in a full run, re-run it alone and record both.

---

## 8. Task List

- ✅ T-1 `adminFormat.ts`: `formatCount`; `adminFormat.test.ts` edit (CR-4) + new cases; header comment updated (Jobs no longer keeps its own copy)
- ✅ T-2 `StatusChip.tsx` + `StatusChip.render.test.tsx`
- ✅ T-3 `KpiStrip.tsx` (`KpiStrip`, `KpiTile`) + `KpiStrip.render.test.tsx` (M-1: `KpiTileStatus = 'red'`)
- ✅ T-4 `adminDialog.ts` + `adminDialog.render.test.tsx` (M-2: no "flex", test + comment)
- ✅ T-5 `layoutFolder.guard.test.ts`: G-1 to G-4 plus M-3; red-then-green against a planted arrow component, plant removed
- ✅ T-6 RC-1 logger mocks in the 5 Jobs render tests (suite green before any Jobs source edit: 180/180)
- ✅ T-7 Dialogs: logger, constants, `readJsonBody`, Retry's formatter import
- ✅ T-8 `QueueItemsPanel.tsx`: logger, `readJsonBody`, formatter import
- ✅ T-9 `JobsQueuesView.tsx` migration (§3.6); `jobsFormat.ts` `formatUtc` removed
- ✅ T-10 `jobsQueues.render.test.tsx` edits (§6.2); `jobsQueues.source.guard.test.ts` edits; new `jobsQueues.layout.render.test.tsx` (S-1, S-2)
- ✅ T-11 G-5 registry entry for Jobs
- ✅ T-12 Deferred items recorded in the requirement's §1 L-1b notes cell; S-4 findings F-95, F-96 added to §9
- ✅ T-13 Verification V-1 to V-6, results below
- ✅ T-14 Hand over to TL for SA code review (uncommitted)

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| A Jobs test renders the view without the `@/lib/logger/client` mock and throws on import (RC-1) | T-6 first; the mock routes to the existing spies so log assertions keep their meaning |
| A tile renders a `<button>` and breaks the 11-button pin | `KpiTile` is an `<a>` only; `KpiStrip.render` asserts no `button` role; the 11-button test is not edited |
| A new string in the view says "Drain", "Cancel", "Retry" or "OK", or a second `fetch(` appears | Copy reviewed against the Jobs guard; tile sub-lines are built from fixed words plus payload status words (runtime, not source); KPIs reuse the one read |
| The pinned header sentence is split or reworded | Kept as one literal constant; the guard's `toContain` proves it |
| `[&>button]` styles a page button placed directly in the dialog content | None of the 3 Jobs dialogs has one (their buttons sit in wrappers); `adminDialog.render` pins the close as the direct child; later adopters (L-3, L-4) check their own markup |
| The light-scheme X fix does not show in a real browser (Tailwind arbitrary-variant output) | V-7 in both schemes, before and after; the class strings are literal so Tailwind generates them |
| CR-1 tightening flags an existing constant elsewhere in the folder | Only `StatusChip.tsx` holds green; the walk covers the folder; G-4 self-tests prove both directions |
| `readJsonBody` changes a dialog outcome | §3.5: identical for every object or unparseable body; the one changed case (array or primitive JSON on a drain) is named |
| Grey chips change look (dashed + icon) | Forced by §5.9; named in the PR; Q-4 |
| Type errors invisible to ts-jest | V-4 with a canary first |
| Shared `node_modules` junction, shared stash list | No `git worktree remove`, no `git stash` |

---

## 10. Out of scope

`components/ui/*` (SA Q-4); `lib/utils.ts` (`cn()`); `AdminSidebar.tsx`, its nav test, `app/admin/layout.tsx` (X-1 to X-3); `app/admin/jobs-queues/page.tsx` (no edit needed); `lib/admin/jobs/**` and every route; **`app/admin/finance/**`** (adopts the shared tile in its own later slice, §4.1); `app/admin/components/adminWindowPresets.ts` (§4.2); Health files (`HealthGrid.tsx`, `HealthTile.tsx`, `app/admin/page.tsx`); the other 3 `DARK_DIALOG` copies (Archiving L-3, Businesses L-4, D-8 (a)); Jobs' tables and card shells (C-13 table constants are L-1d; the cards keep their shell); Jobs' remaining `text-slate-500` informational lines (T-5; not in the §7.2 forced list — reported for §9 by TL/BA, Q-12); `runs-read-message` styling (not an amber notice today; `AdminNotice` deferred); the KPI tile's cross-page and same-page filter modes and its other statuses; `info` / `neutral` chip tones; `AdminEmpty`, `AdminNotice`, `formatUtcDate`, header `badge` / `actions`; any new CI workflow or npm script; CR-2, CR-3, CR-5, CR-6, CR-7 (L-1a notes, not carried here).

---

## 11. Questions for SA

| # | Question | Dev proposal |
|---|---|---|
| Q-1 | **FinanceKpiStrip.** Generalise it into the shared tile, or build `KpiTile` from Health's `STATUS_STYLES` as C-11 says? | Build from `STATUS_STYLES` (C-11). `FinanceKpiStrip` cannot move (S-3/S-4 imports, `<div>` tile, status row on every tile, finance-shaped props; §4.1). Finance adopts `KpiTile` later in its **own** slice; L-1b does not touch `app/admin/finance/**` |
| Q-2 | C-11 says L-1b builds the anchor **and cross-page** modes, but Jobs' tiles are all same-page anchors, so the cross-page (`next/link`) mode has no consumer (SA-R-3) | Defer the cross-page mode to its first consumer (finance adoption or L-2a); `href` typed as a `#…` anchor for now; Dev records the move in §1 |
| Q-3 | The tile's K-4 status set: Jobs uses only neutral and "Needs action" | Build only `needs_action`; add "Needs a look", "Healthy", "Not measured yet", "Could not check" with their first consumer. Rule recorded now: "Healthy" must take its green from `StatusChip`'s single constant (export it then), so S-7 stays at exactly one |
| Q-4 | Chip tones: build `danger`, `warn`, `ok`, `unknown` (Jobs' four) and defer `info` / `neutral`? And map Jobs' grey (`no_run_yet`, `could_not_check`) to `unknown` (dashed border + `CircleDashed`)? | Yes to both. `unknown` is §5.9's meaning for these two statuses; the visible change (dashed, icon) is named in the PR. Alternative: a `neutral` tone with no icon, which §5.9 reserves for plain state words |
| Q-5 | **Registry scope and `.json(`.** Register all 6 Jobs client files and move the 4 remaining direct reads (panel + 3 dialogs) to `readJsonBody` (§5.10 "every fetch body"), or register only page + view and leave the panel and dialogs reading as today? | Register all 6 and convert (§3.5). Behaviour is identical for every object or unparseable body; only an array or primitive JSON drain answer moves from "unknown" to "timed out" (no route returns one). `readAdminResponse` is not used there, because they must never show server text |
| Q-6 | Jobs opts into `sessionEndedCopy` (L-1a ruling 3b named Jobs its first consumer): a 401/403 on the page read shows "Your admin session has ended. Sign in again." instead of the route's text | Opt in; matches the panel and the dialogs; named in the PR. The 500 "Forbidden" pin is unaffected |
| Q-7 | As of: the full `formatUtc(view.now)` ("As of 2026-10-10 14:02 UTC.") instead of today's time tail (F-60) | Full value: no slicing at all, and no em-dash edge (L-1a W-4). Alternative: Health's tail with the W-4 rule |
| Q-8 | Dialog class shape: three constants in `adminDialog.ts` (content, title, description), `!` for the palette and `[&>button]` child selectors for the corner close; no `AdminDialogContent` wrapper | Approve. `!` and child-selector specificity do not depend on `cn()` order (S-9); the constants keep each dialog's own `DialogContent` props untouched |
| Q-9 | RC-5 "exactly one green constant": also pin **where** it lives (`StatusChip.tsx`)? | Pin file and count, not the name |
| Q-10 | Red rule for "Stuck items" and "Dead-lettered (24 h)": the requirement's "red when ≥ 1" on the summed figures, or derived from queue statuses? | Use the summed figures as §7.2 says. By `queueStatus` (`buildJobsQueuesView.ts:302-304`) a sum ≥ 1 always coincides with at least one red queue in the same payload, so it is K-5 (i) with no new threshold. Confirm |
| Q-11 | K-10 when a Refresh fails while a view is on screen: keep the (stale) strip, like the content? | Keep it; hide the strip only when there is no view (first read failed). Matches today's "the previous view stays on screen" |
| Q-12 | Jobs keeps several informational lines on `text-slate-500` (T-5), not in the §7.2 forced list | Leave in L-1b; TL/BA records it in §9 for a later short-path touch. Fixing it here is a style sweep across a strictly pinned file |
| Q-13 | For L-1c, not for ruling now: `adminWindowPresets.ts` exists outside the shared folder and is imported by a `lib/` file and an API route (§4.2 N-1 to N-4) | Flagged so the L-1c workplan starts from it |

---

## SA Review Notes

The workplan review is the next section. The code review will be added below it.

## SA Workplan Review — 2026-10-10

**Reviewed by SA — 2026-10-10**
**Status:** ✅ APPROVED WITH CONDITIONS. Implementation may start. Conditions M-1 to M-3 must be met in the code. SA code review checks S-1 to S-4.

SA checked the workplan against `a42bae2a`: the requirement (§5.2 to §5.12, §6.1 S-1 to S-10, §6.2 C-10 to C-12, §7.2, §10 D-4 / D-8 / D-15, §12.2 / §12.3, SA Review, SA re-check RC-1 / RC-5), the L-1a code under `app/admin/components/layout/` (the guard, `readJsonBody`, `readAdminResponse`, `AdminFilterBar`, `AdminPageHeader`, `adminFormat`), `components/ui/dialog.tsx`, `app/globals.css`, the 6 Jobs client files, `jobsFormat.ts`, `buildJobsQueuesView.ts` `queueStatus`, `jobsQueues.render.test.tsx`, `jobsQueues.source.guard.test.ts`, the items render test's logger mock, `FinanceKpiStrip.tsx`, `financeFormat.ts`, `adminWindowPresets.ts` and its importers, and `finance.source.guard.test.ts`. The line citations in §1 match the code.

### Rulings on §11

| # | Ruling | Reason |
|---|---|---|
| Q-1 | **Approved: build `KpiTile` in the shared folder, taking its values from Health `STATUS_STYLES`. Do not generalise `FinanceKpiStrip`. Condition M-1 applies.** | This does honour "reuse, justify anything new". `FinanceKpiStrip` is itself a consumer of `STATUS_STYLES`, not a separate source. Both tiles therefore come from one origin, and K-4 names that origin. The shared tile cannot import it (S-3), so it copies the values. It cannot lift `FinanceKpiStrip` either: that file has `@/lib/business-os` type imports (S-4), uses `cn`, has a `<div>` tile and a status row on every tile, and its props are shaped for finance. Without M-1, though, the finance adoption would need a translation table. M-1 makes it a pass-through. |
| Q-2 | **Approved: defer the cross-page (`next/link`) mode.** Record the move in §1. | SA-R-3 and §12.2 do not allow an export with no consumer, and that rule beats the C-11 wording. Widening `href` from `` `#${string}` `` to a page path later does not break existing callers. |
| Q-3 | **Approved: build only the red ("Needs action") status row.** When Healthy is added later, it must take its green from the folder's single constant. That constant may change from a string into one object literal (for example `{ chip, card, accent }`). The G-2 rule already counts an object literal as one constant. | A tile needs a card border and accent colours, not the chip's background. Reshaping the one constant keeps S-7 at exactly one. |
| Q-4 | **Standard-forced: map `no_run_yet` and `could_not_check` to `unknown` (dashed border plus `CircleDashed`).** Do not keep today's grey look. Defer `info` and `neutral` until they have a consumer. | §5.9 defines `unknown` as "Not measured / could not check", and those are exactly these two statuses. §5.9 also requires the icon for `unknown`. §7.2 lists Badge → StatusChip as forced. `neutral` is reserved for plain state words, so using it here would misuse a tone. Name the change in the PR. |
| Q-5 | **In scope: register all 6 files and move the 4 reads to `readJsonBody`. The drain edge is accepted as no behaviour change for real responses.** | §5.10 says "every fetch body", and the registry's "no direct `.json(`" check scans every listed file. Leaving the panel and the dialogs out would make the Jobs registry entry partial. SA checked `classify` (`DrainNowDialog.tsx`): only a JSON body that is an array or a primitive moves from `unknown` to `timed_out`. Both outcomes are in `REFRESH_AFTER`, so only the sentence changes. Every return in the drain route is a `NextResponse.json` object, and the `requireAdmin` gate returns one too. Name the edge in the PR, as planned. |
| Q-6 | **Approved: opt in to `sessionEndedCopy`.** | The L-1a ruling named Jobs as its first consumer. The panel and dialogs already say this sentence. The pinned "Forbidden" test has no status field, so it stays on rule 1. |
| Q-7 | **Approved: show the full `formatUtc(view.now)`.** | F-60 is fixed with no slicing. Jobs has no window line (Health has one) to carry the date. |
| Q-8 | **Approved: three constants, no wrapper. Condition M-2 applies.** | SA checked the specificity argument against `dialog.tsx` (the full analysis is under Findings below). The argument holds, it does not depend on `cn()` order, and `components/ui/dialog.tsx` stays unedited. |
| Q-9 | **Approved: pin the file (`StatusChip.tsx`) and the count (exactly one), not the name.** | The name can change when Q-3 reshapes the constant. The file and the count are what S-7 protects. |
| Q-10 | **Confirmed: use the summed figures with "red when ≥ 1", as §7.2 says.** | SA checked `queueStatus` (`buildJobsQueuesView.ts:297-308`). `stuck >= 1` returns `stuck` before any other rule. A queue with `deadLettered24h >= 1` is always `stuck`, `stopped_draining` or `dead_lettered_24h`, and all three are red. A sum of 1 or more therefore always repeats a red the payload already shows (K-5 (i)). The threshold comes from §7.2, not from this slice. Should-fix S-1 pins the link between the two. |
| Q-11 | **Approved: keep the stale strip when a Refresh fails.** Hide the strip only when there is no view. | Under §5.10, a refresh keeps the current content. K-10's "error hides the strip" applies to a page that has nothing to show. |
| Q-12 | **Approved: leave the `text-slate-500` lines alone in L-1b. Record them as a §9 finding; do not fix them.** | There are 18 uses across the Jobs files, and some of them sit in strictly pinned copy. §12.3 says "any new finding is added to §9, not fixed". |
| Q-13 | **Leaning (final ruling in the L-1c workplan review): keep `adminWindowPresets.ts` where it is.** Add its exact path to the S-3 allow-list as a single, named exception. Add a C-14 assertion that this module has zero imports and no `'use client'`. Correct C-8 so that `resolveWindow` reuses this module instead of `activityPresets.ts`. | Moving the file into `layout/` would make a `lib/` file (`financeWindow.ts`) and an API route import from the client UI layout folder. It would also edit `finance.source.guard`, which lists the path, and repoint 5 importers outside any layout slice. S-3 exists to stop imports leaking in through other files. One module with zero imports, guarded to stay that way, leaks nothing. Reusing it, not writing a third preset module, follows the user's "reuse before creating". |

### Findings

**Must (conditions for implementation)**

| # | Finding / condition |
|---|---|
| M-1 | **The `KpiTile` status vocabulary mirrors Health `TileStatus` keys.** L-1b builds only `'red'`: `KpiTileStatus = 'red'`. An absent status means a neutral tile with no status row. Its label is "Needs action", `STATUS_STYLES.red.label`. Later statuses use the same keys (`amber`, `green`, `not_measured`, `unavailable`). A comment names `HealthTile.tsx` `STATUS_STYLES` as the source of the values, copied because of S-3. The finance adoption can then pass `tile.status` straight through. Do not invent a second vocabulary (`needs_action`). |
| M-2 | **`dialog.tsx:36` turns off the dialog's grid, padding, gutter and `max-h` scroll when the className contains the substring `flex`** (`hasFlex = className?.includes('flex')`). `adminDialog.render.test` asserts that `ADMIN_DIALOG_CLASS` does not contain `flex`. A comment in `adminDialog.ts` gives the reason. Otherwise one later "flex" addition would silently break the layout of all 6 admin dialogs. |
| M-3 | **G-2 must close two remaining holes.** The initializer starts with a single or a double quote, or with `{`. A backtick does not count, because a template literal can embed any expression. The declaration span also contains no `(`, as well as no `=>` and no `<`. Add self-test (g): `const GREEN = { a: make('bg-green-500') };` is reported as `outside`. |

**Should (SA code review checks)**

| # | Finding |
|---|---|
| S-1 | In `jobsQueues.layout.render`, the red-tile cases build their data through the real `buildJobsQueuesView`, as the existing fixture does. They also assert the K-5 (i) link: when the Stuck or Dead-lettered tile shows "Needs action", at least one queue chip has `data-tone="danger"`. A later change to the server rule then breaks a test instead of making the tile and the chips disagree without anyone noticing. |
| S-2 | `KpiStrip` receives `loading` only on the first read (`loading && !view`). Add one case: while a Refresh is in flight, the tiles stay and no placeholders show (K-10: no layout jump). |
| S-3 | V-7 adds a computed-style check in the **light** scheme, on `main` and on the branch. The close button's computed `color` is about `rgb(203 213 225)` (slate-300) and its opacity is 1. On focus, the ring is purple. This also proves Tailwind generated the arbitrary-variant rules. |
| S-4 | Two findings go into requirement §9, recorded but not fixed. The first is Q-12. The second: Jobs' tables do not yet meet §5.7 (C-13 lands in L-1d with Audit trail as its pilot, and nothing moves Jobs' tables). §1 notes that both items are outside L-1b. |

**Notes**

- **Dialog specificity check (Q-8), verified.** The close button (`dialog.tsx:101-104`) is the only direct child `<button>` of the content element in all 3 Jobs dialogs. Their direct children are `DialogHeader`, `ul`, `p`, conditional `div` / `p` blocks and `DialogFooter`. `.x>button` (0,1,1) beats `text-[var(--v2-text-muted,var(--foreground))]` and `opacity-70` (0,1,0). `.x>button:focus` (0,2,1) beats `focus:ring-ring` (0,2,0). `[&>button]:ring-offset-slate-900` beats `ring-offset-background`. All of these rules are in the Tailwind 4 utilities layer. `app/globals.css` has no rule outside a layer that sets a button's colour or opacity. The light-scheme cause is confirmed: `--foreground` is `#171717` outside the dark media query (`globals.css:54` vs `:88`), which is near-invisible on slate-900. The title and description already win through `!` today, so they stay as they are.
- **Pins hold.** The 11 buttons hold: the header has no buttons, the bar has one Refresh, the tiles are `<a>`, and "Try again" appears only in the error state. Exactly one view `fetch(` holds, with its literal unchanged; the helpers never fetch. "Drain" appears exactly once, because `DrainNowDialog` has no word boundary after "Drain". `onRetry` does not trip the guard's whole-word "Retry" pattern, also because of the word boundary. The `job-` / `queue-` testid counts hold: `kpi-*` does not match, and `jobs-error` does not match `^="job-"`. The "Forbidden" pin holds through rule 1 plus RC-3. The panel keeps its 3 buttons. The dialogs never read server text, because `readJsonBody` only parses.
- **CR-1, CR-4, RC-1 and RC-5 are handled correctly** (G-2 plus M-3, G-3, G-4, the `adminFormat.test` edit, the logger mocks routed to the existing spies). Also update the `adminFormat.ts` header comment, which still says Jobs keeps its copy.
- **Scope is clean.** Nothing is planned in `app/admin/finance/**`, `components/ui/*`, `lib/admin/jobs/**`, `adminWindowPresets.ts`, Health files or routes, and V-6 checks it. The only doc edit is the §1 L-1b cell (T-12) plus the S-4 §9 rows.
- **Size.** Four small shared files, the guard tightening, 6 Jobs files (4 of them mechanical) and 8 test files. About 3 days is realistic, and within "a few days".
- **Type check and browser plans are adequate.** V-4 runs the canary first with absolute includes in the scratchpad. ts-jest does not type-check in this repo, so V-4 is the only type gate. V-7 covers both schemes, with S-3 added.

### Verdict

**APPROVED WITH CONDITIONS.** Dev implements with M-1 to M-3. S-1 to S-4 are checked at SA code review. The changes stay uncommitted until SA code review, QA and the user's diff review are done.

## Implementation Notes (Dev) — 2026-10-10

### SA conditions and should-items

| # | How it is met |
|---|---|
| M-1 | `KpiStrip.tsx`: `export type KpiTileStatus = 'red'`; absent status = neutral tile, no status row. `TILE_STATUS_STYLES.red` copies Health `STATUS_STYLES.red` (label "Needs action", `AlertOctagon`, `border-red-500/40`, `text-red-300`); a comment names `HealthTile.tsx` `STATUS_STYLES` as the source and S-3 as the reason for copying, and lists the later keys (`amber`, `green`, `not_measured`, `unavailable`). No `needs_action` anywhere. The tile also renders `data-status` (`red` or `neutral`) for tests |
| M-2 | `adminDialog.ts` header comment explains the `className.includes('flex')` switch in `DialogContent`; `adminDialog.render.test` asserts `ADMIN_DIALOG_CLASS.includes('flex')` is false and that a real dialog keeps the primitive's `grid` and `overflow-y-auto` |
| M-3 | `isLiteralConstant` in the guard: ALL-CAPS name; initializer starts with `'`, `"` or `{` (a backtick does not count); span to the next `;` has no `(`, no `=>`, no `<`. Self-tests (a) to (d), (g) `const GREEN = { a: make('bg-green-500') };` and a template-literal case are all reported in `outside` with the file name; (e), (f) and a double-quoted string are counted |
| S-1 | `jobsQueues.layout.render`: the red-tile cases build the payload with the real `buildJobsQueuesView` (`stuck: 2` on lead_responses; `deadLettered24h: 1` on payment_reminders) and assert at least one queue chip with `data-tone="danger"`, plus the specific queue's chip |
| S-2 | `KpiStrip loading={loading && !view}`. Test "a Refresh in flight keeps the tiles and shows no placeholders": second fetch held pending, tiles present, zero placeholders, content `aria-busy="true"`. Mutation check: with `loading={loading}` this test fails (1 failed, 17 passed); restored |
| S-3 | QA's browser step (V-7), not Dev's |
| S-4 | Requirement §9: F-95 (17 `text-slate-500` uses in the 5 Jobs client files; one fewer than SA's 18 because the As of line moved to slate-400) and F-96 (Jobs tables vs §5.7); count line 94 → 96. §1 L-1b notes cell records both as outside L-1b, plus the deferred items (T-12) |

### Deviations from the plan (all small)

| # | Deviation | Why |
|---|---|---|
| DV-1 | `greenVerdict` also returns `files` (the files holding a green constant), so G-3 pins the file as `[app/admin/components/layout/StatusChip.tsx]` | SA Q-9 "pin the file and the count" needed the file from the verdict |
| DV-2 | Guard: a `const` with a type annotation (`const X: T = …`) is not a literal constant under M-3 (the `=` must follow the name) | Stricter, not looser; no shared file needs an annotated green constant. Health's annotated `GREEN_STYLE` is outside this folder and its own guard |
| DV-3 | `KpiStrip` placeholders carry `data-testid="kpi-placeholder"` | Lets the K-10 and S-2 tests count them without class selectors |
| DV-4 | Jobs source guard: the rewritten green rule is an `it.each` over `CLIENT_FILES` plus `jobsFormat.ts`, plus one test pinning exactly two `: 'ok'` in the view (`healthy`, `clear`) and the `StatusChip` alias import | §6.2 as planned, split per file so a failure names the file |
| DV-5 | The Cancel and Retry dialogs had no "`!` classes" header line to update (only Drain did); each got one sentence naming the shared classes instead | §3.7 asked for the header to name the shared constant |
| DV-6 | Jobs source files and the 5 edited Jobs tests keep their CRLF working-copy line endings (the repo stores LF; `core.autocrlf=true`); the diff shows only real changes | Avoids whole-file churn |

### Verification results

| # | Command | Result |
|---|---|---|
| V-1 + V-2 | `npx jest app/admin/components/layout app/admin/__tests__ app/admin/components/__tests__ app/admin/business-os-llm app/admin/finance lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci` | **41 suites, 1101 tests, all passed** (the load-sensitive items test W7A-2 passed in the full run) |
| T-5 plant | Appended `export const PlantBadge = () => <span className="bg-green-500" />;` to `StatusChip.tsx`, ran the guard's green test | Red: `outside` received `"app/admin/components/layout/StatusChip.tsx: bg-green-"`. Plant removed (file restored from a scratch copy, 0 matches), re-run green |
| V-3 | `npm run test:bos-entitlements` | **227 suites, 6057 tests, all passed** |
| V-4 run 1 | Scratch `tsconfig.l1b.json` in the session scratchpad (extends the worktree `tsconfig.json`, `incremental: false`, absolute includes: `next-env.d.ts`, the 9 shared sources, the 9 shared tests, the 7 Jobs files, the 7 Jobs tests, `HealthGrid.tsx`), canary `const canary: number = 'x';` appended to `StatusChip.tsx` | Exactly one error: `app/admin/components/layout/StatusChip.tsx(60,7): error TS2322: Type 'string' is not assignable to type 'number'.` Canary removed (0 matches) |
| V-4 run 2 | Same config, canary removed | **0 errors** (exit 0) |
| V-5 | `npx eslint <22 touched files> --no-config-lookup --no-inline-config --config eslint.hooks.config.mjs --max-warnings 0`, then `npx eslint <same files>` | Both exit 0, no findings |
| V-6 | `git status --short`, `git diff --stat` | 16 modified (442 insertions, 174 deletions; no file with deletions only), 7 new source/test files plus this workplan. No change under `components/ui`, `lib/`, `app/admin/finance`, `app/admin/components/health`, `app/admin/jobs-queues/page.tsx`, `adminWindowPresets.ts`, `app/api` |

### Visible changes on `/admin/jobs-queues` (for the PR body)

1. A strip of 4 KPI tiles under the header: Jobs, Queues, Stuck items, Dead-lettered (24 h). Each tile is a link to its section (`#jobs` or `#queues`). Jobs and Queues are always neutral, with a per-status breakdown sub-line. Stuck items and Dead-lettered (24 h) turn red with "Needs action" when the sum is 1 or more. When a queue could not be read, the sub-line says "at least: N of 5 queues could not be checked".
2. Refresh moves out of the header into a bar under the strip. Its accessible name is now "Refresh the jobs and queues", and it shows a purple focus ring.
3. As of changes from slate-500 to slate-400 and shows the full UTC date and time ("As of 2026-10-10 14:02 UTC."), not only the time.
4. Status chips gain icons. "No run recorded yet" and "Could not check" become dashed grey chips with a dashed-circle icon.
5. Loading changes from "Loading…" to a spinner with "Reading the jobs and queues…", plus 4 tile placeholders. A Refresh keeps the tiles and the content on screen.
6. Errors show in the red box, with a "Try again" button. A body that is not JSON shows "Could not read the jobs and queues. Try again in a moment.". A network failure shows "Could not reach the server. Check your connection and try again." instead of the browser's message. A 401 or 403 shows "Your admin session has ended. Sign in again.". A route error string is still shown as is.
7. In the three dialogs (Drain now, Cancel item, Retry item), the corner X is readable in the light colour scheme and gets a purple focus ring. The dialogs now render in the dark colour scheme.
8. Edge case, no change for real responses: if the drain route answered with a JSON array or a bare value, the drain dialog now says "ran out of time" instead of "did not complete". No drain route answer has that shape.

## SA Code Review — 2026-10-10

**Code Review by SA — 2026-10-10**
**Status:** ✅ Code Approved (no must-fix; two low should-fix items that need no code change)

SA reviewed the uncommitted worktree `neuronforge-admin-layout` on branch `feature/admin-layout-l1b` (base `a42bae2a`). `git diff --stat` shows 16 modified files with 442 insertions and 174 deletions, and no file with deletions only. There are also 7 new source and test files plus this workplan. SA read the full diff and every new file: `KpiStrip.tsx`, `StatusChip.tsx`, `adminDialog.ts`, their three tests, and `jobsQueues.layout.render.test.tsx`. SA also re-checked them against `components/ui/dialog.tsx`, `readAdminResponse.ts`, `readJsonBody.ts` and `lib/logger/client.ts`.

### Conditions and should-items

| # | Verdict | Evidence |
|---|---|---|
| M-1 | ✅ Met | `KpiStrip.tsx:29` is `KpiTileStatus = 'red'`. `TILE_STATUS_STYLES.red` (`:45-52`) holds the Health `STATUS_STYLES.red` values. The comment at `:38-44` names `HealthTile.tsx` and S-3, and `:22-28` lists the later keys. `needs_action` appears nowhere. `data-status` is `red` or `neutral` |
| M-2 | ✅ Met | The `adminDialog.ts` header explains the `includes('flex')` switch. `adminDialog.render.test` asserts that `ADMIN_DIALOG_CLASS` has no `flex`, and that a real dialog keeps `grid` and `overflow-y-auto`. The string contains no "flex" (checked) |
| M-3 | ✅ Met | `isLiteralConstant` in the guard requires an ALL-CAPS name and an initializer that starts with `'`, `"` or `{`. It rejects a backtick, `(`, `=>` and `<`. Self-tests (a) to (d), (g) and the template literal are all reported `outside` with the file name. (e), (f) and a double-quoted string are counted. DV-2 (an annotated `const` never counts) makes the rule stricter, so it is accepted |
| S-1 | ✅ Met | The red-tile cases build data through the real `buildJobsQueuesView`. They assert at least one `danger` queue chip and the specific queue's chip |
| S-2 | ✅ Met | `JobsQueuesView.tsx:379` passes `loading && !view`. The "a Refresh in flight keeps the tiles" test checks this, and Dev recorded a mutation check |
| S-3 | Open, with QA | This is V-7's computed-style check in the light scheme, on `main` and on the branch. It is the only proof that Tailwind generated the `[&>button]` rules |
| S-4 | ✅ Met | Requirement §9 has F-95 and F-96, and the count is 96. The §1 L-1b cell records the deferred items and the two §9 rows |

### Verified

- **Scope.** There is no diff under `app/admin/finance/**`, `components/ui/*`, `lib/**`, `app/api/**`, `app/admin/components/health/**`, `app/admin/jobs-queues/page.tsx` or `adminWindowPresets.ts`. The doc edits are only the §1 rows, §9 F-95/F-96 and the count line. Neither MD contains a backslash.
- **Jobs strict pins hold.** The run passed: 11 buttons (the tiles are `<a>`, the bar has one Refresh, and "Try again" shows only in the error state), the single view `fetch('/api/admin/jobs-queues', { cache: 'no-store' })` literal is unchanged, "Drain" appears exactly once, the panel keeps its 3 `<button>`s, the `job-`/`queue-` testid counts are unchanged, and "Forbidden" on a 500 still shows through rule 1. The dialogs read only through `readJsonBody`, which parses but never surfaces `.error`, `.details` or `.message`, so they never show server text. The panel keeps its fixed sentences.
- **The dialog class beats the primitive in the light scheme.** The close is `DialogPrimitive.Close`, the content's only direct-child `<button>` (`dialog.tsx`, after `{children}`). In all three Jobs dialogs, the direct children are `DialogHeader`, `ul`, `p`, conditional blocks and `DialogFooter`. Every other `<button>` is either the trigger (outside the content) or inside the footer. Tailwind 4 emits `[&>button]:x` as `.cls>button` (0,1,1). That beats `text-[var(--v2-text-muted,var(--foreground))]` and `opacity-70` (0,1,0). `[&>button:focus]:ring-purple-500` (0,2,1) beats `focus:ring-ring` (0,2,0). `[&>button]:ring-offset-slate-900` (0,1,1) beats `ring-offset-background` (0,1,0). The win comes from specificity in the same utilities layer, not from `cn()` order. The string contains no "flex", so the primitive keeps its grid, padding, gutter and scroll.
- **Guards are meaningful and self-tested.** Exactly one green constant is pinned to `StatusChip.tsx` (DV-1). The Jobs guard's green rule now runs per file over `CLIENT_FILES` plus `jobsFormat.ts`. It requires exactly two `: 'ok'` mappings (`healthy`, `clear`). A new block pins each dialog to the three constants and bans `DARK_DIALOG` and `!bg-`. The Jobs registry entry reuses the existing per-entry assertions (alias header import, no `<h1`, no `.json(`).
- **Read helpers.** The view uses the HealthGrid shape: only `fetch` sits in the inner try, followed by `readAdminResponse(..., { what, sessionEndedCopy: true })`. The panel and the dialogs use `readJsonBody`. Nothing calls `.json(` directly.
- **Accessibility.** `KpiTile` is one `<a>`. Its name is "label, value[, needs action]" and starts with the visible label. The sub-line is linked through `aria-describedby` (`useId`). The icon is `aria-hidden`, and the tile has no button, region or `<section>`. The placeholders are `aria-hidden`, and `AdminLoading` provides the `status` announcement. `StatusChip` is a `<span>` that always carries the words, with an `aria-hidden` icon, so colour is never the only signal.
- **Standards.** No `console.*` anywhere in the diff. The 5 client files moved from `createLogger` to `clientLogger.child` (F-56, the HealthGrid precedent), with `{ err }` and `{ status }` contexts. The only `any` is a test fetch stub, with a justified eslint-disable. No `jobsFormat.formatUtc` importer remains.
- **Line endings.** Every touched or new file is consistently CRLF in the working copy (CR count equals line count, nothing mixed). The repo stores LF under `core.autocrlf=true`, so the diff shows only real changes (DV-6).
- **SA test run.** `npx jest app/admin/components/layout app/admin/__tests__/jobsQueues app/admin/__tests__/health --ci` gave 20 suites and 445 tests, all passing. The new files alone gave 10 suites and 184 tests, all passing.

### Code Review Comments

| # | File:line | Finding | Priority |
|---|---|---|---|
| CR-1 | `docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md:49` | Should-fix (doc, TL/BA at handover): the L-1b status cell still says "Workplan SA-reviewed". Update it to code complete, SA code-approved 2026-10-10, QA pending, following the always-update-the-main-requirement rule | Low |
| CR-2 | `app/admin/__tests__/jobsQueues.layout.render.test.tsx:321-330` | Should-fix (optional, test hygiene): the S-2 test leaves the pending Refresh promise unresolved at the end. Releasing it (as the K-10 test does at `:309`) would avoid a dangling state update after teardown. It is harmless today, and this suite exits cleanly on its own | Low |
| CR-3 | `app/admin/components/jobs/JobsQueuesView.tsx:337-358` | Note: the outer `try` has a `finally` and no `catch`. This is safe because `readJsonBody` catches and `readAdminResponse` never throws. If a later edit adds a throwing step there, it becomes an unhandled rejection in `void load()`, so keep the outer block free of throwing work | Note |
| CR-4 | `layoutFolder.guard.test.ts` `isLiteralConstant` | Note: an object literal whose value is a template literal (a backtick string inside the braces) is still counted. It cannot contain a call (no `(`), so the green it holds is static text. Accepted | Note |
| CR-5 | (suite run) | Note: the multi-suite run printed "A worker process has failed to exit gracefully". The new suites alone do not cause it. It comes from the existing long Jobs suites (items and retry use user-event timers), so it is not introduced by L-1b | Note |

### Optimisation Suggestions

- None blocking. `KpiStrip` uses `xl:grid-cols-5` with 4 tiles, which leaves one empty column at xl. That is K-2 as written, so it is not changed here.

### Code Approved for QA: Yes

QA runs V-7 in the browser, in the light and dark schemes, including S-3's computed-style check of the corner close (colour about slate-300, opacity 1, purple focus ring) on `main` and on the branch. Everything stays uncommitted until the user has seen the diff.

## QA Testing Report

## QA Report — 2026-10-10

**QA — 2026-10-10**
**Test mode:** full
**Strategy used:** A (Jest unit and render tests in jsdom) + a scoped `tsc` with a canary + throwaway edge-case tests (deleted afterwards). D (browser) is handed to TL as a checklist, because it needs an admin login.
**Focus:** ui, types, security (no route, request or permission change, confirmed by the diff scope)
**Skipped:** the browser check (V-7, SA S-3). QA cannot sign in as an admin; the checklist is below
**Input source:** TL trigger prompt + workplan §6 / §7 + SA conditions

### Commands and results

| # | Command | Result |
|---|---|---|
| Q-1 | `npx jest app/admin/components/layout app/admin/__tests__ app/admin/components/__tests__ app/admin/business-os-llm app/admin/finance lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci` | **41 suites, 1101 tests, all passed** (83 s). The load-sensitive `jobsQueues.items` test (W7A-2) passed in the full run, so no solo re-run was needed |
| Q-2 | `npm run test:bos-entitlements` | **227 suites, 6057 tests, all passed** |
| Q-3 | Scoped tsc, run 1 (canary). Scratch `tsconfig.canary.json` in the session scratchpad `qa-l1b/`: extends the worktree `tsconfig.json`, `incremental: false`, `noEmit`, absolute includes of `next-env.d.ts`, the 9 shared sources, the 9 shared tests, the 6 Jobs component files, `jobs-queues/page.tsx`, the 7 Jobs tests and `HealthGrid.tsx`. Plus a **scratch** `canary.ts` (not a source file) that imports `formatCount` and `KpiTile` from the worktree and misuses them | Exactly the 2 planted errors, nothing else: `canary.ts(3,14): TS2322 Type 'string' is not assignable to type 'number'` (the `formatCount` return type) and `canary.ts(4,58): TS2322 Type '"jobs"' is not assignable to type` the `#`-anchor template type (the `KpiTile` `href` type bites). The scope reaches the shared folder |
| Q-4 | Scoped tsc, run 2 (clean): the same include list, no canary | **0 errors, exit 0** |
| Q-5 | Throwaway `app/admin/__tests__/zzqa.l1b.render.test.tsx` (the pilot test's mocks and fixture, plus 30 QA cases) | **30 of 30 passed**. File deleted; `git status --short` and `git diff --stat` (16 files, +442 / −174) are the same as before the run |

### Edge cases (Q-5, plus the existing pilot tests where they already cover the case)

| Area | Case | Result |
|---|---|---|
| `formatCount` | 0, 1, 999, 1000, −1234, 1e15, `MAX_SAFE_INTEGER` | ✅ "0", "1", "999", "1,000", "-1,234", "1,000,000,000,000,000", "9,007,199,254,740,991" |
| `formatCount` | NaN, Infinity, −Infinity, `null` and `undefined` from an untyped caller | ✅ em dash every time, never "NaN" or "null" |
| `KpiTile` | value 0 (neutral); 123456789012 (red); em-dash value; `sub={null}` and `sub=""` | ✅ names "Zero, 0", "Huge, 123,456,789,012, needs action", "Bad, —"; no `aria-describedby` without a sub-line; `data-status="neutral"` with no status |
| `KpiTile` | 400-character label and sub-line | ✅ name = label + value; the sub-line is the description; describedby ids are unique across tiles. ⚠️ see E-3 |
| `KpiStrip` | `loading` with children, `placeholderCount={0}` | ✅ no links rendered; no `button` or `region` role in the strip |
| `StatusChip` | each of `danger`, `warn`, `ok`, `unknown` | ✅ `<span>`, `data-tone`, textContent exactly the words, exactly one `svg` with `aria-hidden="true"`, no `div` inside; a green class **only** on `ok` |
| Jobs view | all 5 queues unreadable | ✅ Stuck and Dead-lettered "0", neutral, sub-line "at least: 5 of 5 queues could not be checked"; Queues sub-line "5 Could not check". ⚠️ see E-2 |
| Jobs view | some queues unreadable (fixture: 1) | ✅ "at least: 1 of 5 queues could not be checked" (pilot test) |
| Jobs view | zero jobs and zero queues | ✅ no crash; "Jobs, 0" with no sub-line; Stuck "0" with sub-line "across 0 queues" (E-1) |
| Jobs view | Stuck exactly 0 vs exactly 1; Dead-lettered 0 vs 1 | ✅ 0 → neutral; 1 → red "Stuck items, 1, needs action" with a `danger` queue chip; Dead-lettered 1 → red (pilot test), 0 → neutral |
| Jobs view | 1500 stuck | ✅ "Stuck items, 1,500, needs action" |
| Refresh | in flight | ✅ tiles stay, no placeholders, Refresh `aria-busy="true"`, content wrapper `aria-busy="true"` (pilot S-2 test) |
| First-load failure | network, 401, 403, 502 with a non-JSON body | ✅ no strip and no placeholders; the header (one h1), the Refresh bar and the red box with "Try again" stay |
| Refresh failure | network; 403 after a good read | ✅ the stale strip (4 links), As of and both sections stay; the 403 shows the session copy |
| Error copy | 401 and 403 | ✅ "Your admin session has ended. Sign in again." |
| Error copy | 502 and 500 with a non-JSON body; 200 with a non-JSON body | ✅ "Could not read the jobs and queues. Try again in a moment."; never a parser message |
| Error copy | network reject (`TypeError: Failed to fetch`) | ✅ `ADMIN_NETWORK_ERROR`, never "Failed to fetch"; `logger.error` called |
| Error copy | 500 with `{ error: 'Forbidden' }` | ✅ "Forbidden" (existing pin in `jobsQueues.render`) |
| Dialogs | Drain now opened in jsdom | ✅ the corner "Close" is a direct child of the dialog and its **only** direct-child button; the dialog carries every `ADMIN_DIALOG_CLASS` token; its class list has `grid` and no `flex` token; the title has `!text-white` and the description `!text-slate-400` (found through `aria-labelledby` and `aria-describedby`) |
| Dialogs | Cancel, Retry and Drain sources | ✅ each passes `ADMIN_DIALOG_CLASS`, `ADMIN_DIALOG_TITLE_CLASS` and `ADMIN_DIALOG_DESCRIPTION_CLASS` as `className`; no `DARK_DIALOG` (also pinned by the Jobs source guard) |
| Pins | buttons at rest | ✅ exactly 11 |
| Tiles | element, target, name | ✅ 4 `<a>` with `#jobs`, `#queues`, `#queues`, `#queues`; composed names ("Jobs, N", "Queues, 5", "Stuck items, 2, needs action"); the purple focus-visible ring class on each |

### Accessibility (jsdom)

| Check | Result |
|---|---|
| Exactly one h1, "Scheduled jobs & queues", while loading, once loaded, and on a first-load error | ✅ |
| Tiles are links, not buttons | ✅ 4 links; the button count is still 11 |
| Chips have text and an icon | ✅ every `status-badge` has non-empty text and an `aria-hidden` svg |
| No new landmark regions | ✅ 7 regions = `#jobs` + `#queues` + 5 queue cards, all `<section>`, the same markup as `main`; no `role="region"` and no `role="search"` anywhere (the header, strip, bar and states add none) |
| Refresh | ✅ name "Refresh the jobs and queues"; `aria-busy="false"` at rest and `"true"` in flight; the content wrapper's `aria-busy` follows it |

### Issues Found

#### Bugs (must fix before commit)

None.

#### Performance Issues (should fix)

None. The KPIs reuse the single read (the one-`fetch(` pin holds), and the tile computation is linear in jobs plus queues.

#### Edge Cases (nice to fix; none blocks)

1. **E-1 "across 0 queues"** — `JobsQueuesView.tsx` `sumOverQueues`: with an empty `queues[]`, the Stuck and Dead-lettered sub-line reads "across 0 queues". Not reachable today: the route always returns the 5 `BOS_QUEUES`. Severity: Low.
2. **E-2 "0" when nothing could be read** — with all 5 queues unreadable, Stuck and Dead-lettered show "0" (neutral) with "at least: 5 of 5 queues could not be checked". This meets K-8 to the letter, but a lower bound of 0 over zero readings says nothing. Health would say "Not measured yet" or "Could not check", statuses deliberately deferred (SA Q-3). Suggest BA/SA record it for the slice that adds those statuses (an em dash or "Could not check" when no queue was read). Severity: Low.
3. **E-3 long unbroken text in a tile** — the `KpiTile` spans have no `break-words` or `min-w-0`, so a very long unbroken label or sub-line could overflow its grid cell. Jobs' labels are short and its sub-lines contain spaces, so there is no visible effect on this page. Severity: Low (check when a later page adopts the tile).

SA's CR-1 (requirement §1 status cell) and CR-2 (pending promise in the S-2 test) remain as SA recorded them; QA adds nothing to them.

### Browser check owed by TL (V-7, SA S-3, §12.2) — `/admin/jobs-queues`, signed in as an admin

Do items 1 to 7 twice: DevTools → Rendering → "Emulate CSS media feature prefers-color-scheme" = **light**, then = **dark**. Record one line or a screenshot per item.

1. **At rest:** exactly one title, "Scheduled jobs & queues"; the purpose text below it; "As of YYYY-MM-DD HH:mm UTC." readable (slate-400, full date); a strip of 4 tiles (Jobs, Queues, Stuck items, Dead-lettered (24 h)): 2 per row when narrow, 3 at md, one row at xl; Refresh sits in a bar under the strip, not in the header.
2. **Tiles:** Jobs and Queues are neutral (slate border) with a per-status sub-line. Stuck and Dead-lettered have a red border and "Needs action" with an icon only when the value is 1 or more, and then at least one queue chip is red too. Tab reaches the tiles before Refresh, and each shows a **purple** focus ring. Clicking Jobs scrolls to the jobs table; the other three scroll to Queues.
3. **Chips:** every status chip has an icon; "Healthy" and "Clear" are green; "No run recorded yet" or "Could not check" (if present) are dashed grey with a dashed-circle icon.
4. **Refresh:** click it. The icon spins, the tiles and tables stay (no placeholders, no jump). Tab focus shows a purple ring.
5. **Loading:** DevTools Network throttling "Slow 3G", hard reload. The header and Refresh bar show, with 4 grey tile placeholders and the spinner "Reading the jobs and queues…"; no layout jump when the tiles arrive.
6. **Error:** Network → block request URL `/api/admin/jobs-queues`, reload. A red box "Could not reach the server. Check your connection and try again." with "Try again", and no tile strip. Unblock, click "Try again": the page loads. Then, with the page loaded, block again and click Refresh: the red box shows and the old tiles and tables stay.
7. **Dialogs:** open **Drain now** on any queue (close it with Cancel; do not run it). From a queue's "View items", open **Cancel item** and **Retry item** if a row offers them (otherwise record "no eligible row"). Per dialog: dark panel; title white and readable; description readable; the corner **X clearly visible**; Tab to the X shows a **purple** ring with a dark (not white) offset; Escape closes and focus returns to the opener.
8. **SA S-3 computed style, light scheme, on `main` AND on this branch** (the Drain now dialog is enough). Inspect the corner X (the direct-child `button` of `[role="dialog"]`) → Computed tab; record `color` and `opacity`. Expected on the branch: `color` about `rgb(203, 213, 225)` (slate-300; Tailwind 4 may print `oklch(0.869 0.022 252.894)`) and `opacity: 1`. Expected on `main`: near-black (`rgb(23, 23, 23)`, the light `--foreground`) at `opacity: 0.7`. Record F-88 as "seen" or "not seen" for §12.2. Then Tab to the X and record the ring colour (`box-shadow`): purple, about `rgb(168, 85, 247)` (purple-500), on the branch. A slate-300 reading also proves Tailwind generated the `[&>button]` arbitrary-variant rules.
9. **Dark scheme, once:** the X is already light on `main` and on the branch; confirm it did not regress.

### Final Status

- [x] All automated checks pass (1101 + 6057 tests, scoped tsc canary then clean, 30 throwaway edge cases)
- [ ] Browser check (items 1 to 9 above) owed by TL before the user's diff review
- **Verdict: PASS WITH NOTES** — no bugs; 3 low edge cases (E-1 to E-3) for the record. Ready for the user's diff review once TL records the browser check, including the F-88 "seen / not seen" line for §12.2.

## Commit Info

(RM populates.)

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-10 | Created (Dev workplan) | L-1b scope from §7.2 and the L-1a carry-overs (CR-1, CR-4, RC-5); code and test mocks verified at `a42bae2a`; FinanceKpiStrip reuse decision (§4.1) and L-1c notes from PR #284 (§4.2); 13 questions for SA |
| 2026-10-10 | SA workplan review | APPROVED WITH CONDITIONS: Q-1 to Q-13 ruled (Q-13 a lean for L-1c); conditions M-1 (KpiTile status keys mirror Health TileStatus), M-2 (dialog class never contains "flex"), M-3 (G-2: no backtick, no call); S-1 to S-4 for SA code review |
| 2026-10-10 | Dev implementation | T-1 to T-14 done, uncommitted. M-1 to M-3 met; S-1, S-2, S-4 done; deviations DV-1 to DV-6; verification V-1 to V-6 recorded (1101 + 6057 tests green, scoped tsc canary then clean, ESLint clean) |
| 2026-10-10 | SA code review | CODE APPROVED for QA: M-1 to M-3, S-1, S-2, S-4 met; scope clean; Jobs pins hold; dialog specificity verified against `dialog.tsx`; 445 tests re-run green. CR-1 and CR-2 low should-fix (requirement status cell, pending promise in the S-2 test); S-3 is with QA (V-7) |
| 2026-10-10 | QA report | PASS WITH NOTES: 1101 + 6057 tests green; scoped tsc canary (2 planted errors) then 0; 30 throwaway edge cases green and deleted; no bugs; edge cases E-1 to E-3 (Low); browser checklist (incl. SA S-3 computed style, F-88 seen or not seen) owed by TL |
