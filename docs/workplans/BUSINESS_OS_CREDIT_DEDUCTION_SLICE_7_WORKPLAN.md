# Workplan: Business OS credit deduction — slice 7, the credit diary ("Credit history") and the typical range

> **Last Updated**: 2026-10-02

**Developer:** Dev
**Requirement:** [BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md) — §12 "Slice 7 — Credit diary and typical range", "Slice 7 scoping (BA, 2026-10-02)" and the BA fold-in note after it (C-S7-1 to C-S7-3), §13 "Slice 7 decisions for the user (2026-10-02)" (D-i to D-q decided as recommended; **D-r decided 2026-10-02: A + "up to N"**), §14 SQ-29 to SQ-38 (ruled), AC-5 (display), AC-19, AC-20, AC-35 (diary half), AC-38, AC-39, FR-6, FR-8, FR-26, FR-27, FR-28, FR-40d/f, KI-19, KI-20, the §18 slice 7 row, and **"SA review — slice 7 scoping (2026-10-02)"** (binding; its conditions 2–6 are answered in §4.13 and §5.3)
**Previous slice:** [BUSINESS_OS_CREDIT_DEDUCTION_SLICE_6_WORKPLAN.md](/docs/workplans/BUSINESS_OS_CREDIT_DEDUCTION_SLICE_6_WORKPLAN.md) (the 6a read path this slice reuses)
**Worktree:** `neuronforge-llm-deduction`
**Branch:** `feature/business-os-credit-deduction-slice-7` (off `origin/main` `894150f5`; confirmed with `git branch --show-current`). 7b gets its own branch from RM after 7a merges (suggested `feature/business-os-credit-deduction-slice-7b`), see §3.
**Date:** 2026-10-02
**Status:** **Parked by user decision 2026-10-02 — shipped dark behind flag** `NEXT_PUBLIC_BUSINESS_OS_CREDIT_HISTORY` (default off: no link on the card, the route answers 404). 7a Code Complete; SA code review approved with conditions, QA pass with notes; review fixes and SA C-1 (`next build` exit 0) done — §4.15.1, §4.15.2. Uncommitted on `feature/business-os-credit-deduction-slice-7`. 7b parked, not started. *(Previous status, superseded: 7a Code Complete — awaiting SA code review.)*

## Overview

Slice 7 gives the owner the explanation behind the Credits card's number: a **"Credit history"** link on the card opens a side panel listing every charged action of the card's own window, newest first, with the period's exact total and its "by you / automatic" split, and — in 7b — up to five "typical cost" sentences drawn from the owner's own last 90 days. SA confirmed the split by sub-slice, each its own PR, **7a first**:

- **7a — The credit diary.** One shared window function (card and diary read the same period), a paged owner-repository read, a server-only diary builder (effective fields, labels by (service, action type), corrections), a hardened opaque cursor, a new route `GET /api/business-os/credits/history`, a one-decimal line formatter, the card link and the `Sheet` panel in en / he / es, and the D-q label edit.
- **7b — The typical range.** A bounded read of the owner's succeeded charges over 90 days, p10 / p90 per labelled action type, the D-o / D-r display rule, five sentences and a caption in the panel's summary. Touches only the summary of the route 7a builds.

**No migration** in either part (SA "Migration": none; 20261016 stays reserved for 4c, 20261017–20261019 unused). If implementation finds a need, Dev stops and goes back to SA.

## Table of Contents

- [1. Analysis summary](#1-analysis-summary)
- [2. As-built facts this plan rests on (verified)](#2-as-built-facts-this-plan-rests-on-verified)
- [3. Order, PRs and release](#3-order-prs-and-release)
- [4. Part 7a — the credit diary](#4-part-7a--the-credit-diary)
- [5. Part 7b — the typical range](#5-part-7b--the-typical-range)
- [6. What owners see](#6-what-owners-see)
- [7. Test plan](#7-test-plan)
- [8. Guardrails](#8-guardrails)
- [9. Risks](#9-risks)
- [10. Open questions for SA](#10-open-questions-for-sa)
- [11. Logging, deprecated systems and follow-ups](#11-logging-deprecated-systems-and-follow-ups)
- [SA Review Notes](#sa-review-notes)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## 1. Analysis summary

| Area | Today (as built, 6a/6b) | After slice 7 |
|---|---|---|
| Card (`components/business-os/UsageCard.tsx`) | "N left of M", reset date, refresh icon, explanation tooltip; split not shown (U-1), kept in the API (U-4) | **Unchanged** figures, payload, states and triggers; gains one "Credit history" link that opens the panel |
| Window resolution (`lib/business-os/credits/ownerCreditUsage.ts`) | Inline in `readOwnerCreditUsage` (F7-1), not exported | Extracted into one exported `resolveOwnerCreditWindow`; the card is its first consumer (6a tests unedited), the diary its second |
| Owner repository (`lib/repositories/BusinessOsCreditOwnerReadRepository.ts`) | Totals, adjustments for periods, originals by action id | + `listLedgerRowsForWindow` (keyset, `OWNER_DIARY_COLUMNS`); 7b + `listSucceededChargesSince` (`OWNER_RANGE_COLUMNS`) |
| Route | — | New `GET /api/business-os/credits/history?cursor=…` |
| Labels (`lib/business-os/llm/aiActionAudit.ts`) | 16 DRAFT diary labels, unrendered | Rendered for the first time; `onboarding_turn` → "Replied in your setup conversation" (D-q); stale comments updated |
| Dictionary (`lib/business-os/LanguageContext.tsx`) | `usage.*` card keys | + `credits.history.*` and eight `credits.area.*` keys (7a), `credits.range.*` (7b), en / he / es |

Tables read: `business_os_credit_charges` and `business_os_credit_totals` (owner RLS client, granted columns only), `business_os_account_plans` (service role, `period_anchor` only — the existing 6a wiring). Function called: `business_os_credit_period_start` (existing 6a wiring). **No table written. No AI call** (`bos-llm-call-standards` not engaged; `runAiAction` untouched — the D-q edit is a string in a declaration).

Skills applied in planning: `new-api-route`, `new-repository` (a method on an existing repository), `tenant-isolation-guard`, `business-os-entitlements`, `business-os-schema-check` (columns checked against migration `20261015` GRANT lines, §2).

---

## 2. As-built facts this plan rests on (verified)

Each checked in this worktree at `894150f5` on 2026-10-02.

| # | Fact | Where |
|---|---|---|
| V-1 | `readOwnerCreditUsage(userId, deps, log)` resolves the window inline: period from `resolveCreditPeriod`; trial (`allowance.per === 'total'` and an anchor) → `listTotalsFrom(accountId, period.anchor)`; else `findTotalsForPeriod(accountId, period.periodStart)`; split from the totals rows, corrections through `attributeCorrections` only when `credits_adjustment ≠ 0`. Errors are thrown as `OwnerCreditUsageError` inside one `try` and logged once as `'Owner credit usage read failed'` | `ownerCreditUsage.ts:191-283` |
| V-2 | `ownerCreditUsage.ts` imports exactly `getEntitlementService`, `resolveAccountId`, `creditAllowanceForDisplay` from the entitlements module, and is registered for exactly those (equality-checked, type-only imports counted) | `ownerCreditUsage.ts:46-48`; `enforcementPoints.test.ts:364-367`, `:384-447` |
| V-3 | `OWNER_CHARGE_COLUMNS` has no `id`, `outcome` or `created_at`; all three are in the `authenticated` GRANT on the charges | `BusinessOsCreditOwnerReadRepository.ts:75-76`; migration `20261015:130` |
| V-4 | Charges CHECKs: `kind ∈ {charge, adjustment}`; a charge has non-null `service`, `action_type`, `triggered_by`, `outcome`; an adjustment has all four NULL; `triggered_by ∈ {owner, scheduled, external}`; `outcome ∈ {succeeded, failed}` | migration `20261015:32-40` |
| V-5 | Index `(user_id, period_start, created_at DESC)` only (plus `group_id`) | migration `20261015:52-54` |
| V-6 | `effectiveFields.ts` holds `areaFor(effectiveService, actionType)` (AI only, through `AI_CHARGE_SERVICE`) and `resolveEffectiveFields(row, chargesByActionId)`; it imports `aiActionAudit.ts` and has no `'server-only'` marker | `effectiveFields.ts` |
| V-7 | `serviceColumn.guard.test.ts` forbids, in every file of `lib/business-os/credits/` except `effectiveFields.ts` **and** in the owner repository: a PostgREST filter / order on `service`, an or-expression on it, SQL grouping on it, and **any Node read `.service`** | `serviceColumn.guard.test.ts:18-60` |
| V-8 | `ownerCreditSurface.guard.test.ts` pins: FR-36 words over full source of the owner surface; no timers in the card and signal module; `creditDisplay.ts` imports nothing; `ownerCreditUsageTypes.ts` has no value import; the card imports only those two from the credits directory; route and builder hold no service-role client or repository singleton; the builder calls `getSnapshot(accountId)` and never `check()` / `decide()` | guard file, rules 1–4 |
| V-9 | `creditFigures.fromConfig.guard.test.ts` (inside `test:bos-entitlements`) requires every product file naming `ownerCreditUsage` (word-bounded, so an import of `./ownerCreditUsage` counts) or `creditAllowanceForDisplay` to be in its `SOURCES` list | guard `:81-114`, `:191-201` |
| V-10 | `components/ui/sheet.tsx` (unchanged since `a6703535`): `side: 'right'` → `end-0 … border-s` with `rtl:` slide variants; `'left'` → `start-0`. The positions are **logical** (`inset-inline-end` / `-start`); `LanguageContext` sets `document.documentElement.dir` to `rtl` for Hebrew (`LanguageContext.tsx:11311`). The three existing drawers pass `side={isRTL ? 'left' : 'right'}` and `dir` on the content | `sheet.tsx:30-45`; `MoneyDetailDrawer.tsx:135-138`; `CRMContactDrawerV2.tsx:2725-2727` — see Q-1 |
| V-11 | The 16 diary labels; `onboarding_turn` = "Setup conversation" / "שיחת הקמה" / "Conversación de configuración"; `onboarding_build` is area `website` ("Website — Set up your business", F7-9). Stale comments: `:25` "Nothing reads those facts yet", `:82` "Nothing reads it yet: later slices do", `:98-99` "DRAFT wording … before anything renders it". No test pins the string "Setup conversation" (repo grep) | `aiActionAudit.ts` |
| V-12 | `aiActionAudit.ts` is a registered non-gate importer for one type-only import (`Labels`); slice 7 does not change it | `enforcementPoints.test.ts:266` |
| V-13 | `percentiles.ts` exports `percentileCont` (any p) and `FEW_EXAMPLES_BELOW = 10`; its header says which rows go in is the caller's rule | `percentiles.ts:1-38` |
| V-14 | `UsageCard.render.test.tsx` asserts the fetch count (`toHaveBeenCalledTimes(1)` after mount), the card body text (no "left" in the ungauged state, no split words, no "AI"/token/$), and mocks `useLanguage` with `t`, `language`, `isRTL` and the real `translations` | `UsageCard.render.test.tsx:22-30, 108-121, 339-352` |
| V-15 | No `app/api/business-os/credits/` directory exists | `ls app/api/business-os` |
| V-16 | 0 `console.*` in every file this plan touches (§11) | grep count, 13 files |

---

## 3. Order, PRs and release

| Part | PR | Merge rule |
|---|---|---|
| 7a | PR 1, this branch | Merges alone; releasable alone (FR-26, AC-19, AC-38, AC-35 diary half, AC-5 display). **Release precondition:** the user's native he / es review of the new strings and of the 16 labels (D-p, D-q) |
| 7b | PR 2, a branch RM cuts after 7a merges | **Never before 7a** (SA). FR-27, AC-20, AC-39 |

Standing process: Dev leaves changes uncommitted; SA code review → user sees the diff → QA → user approval → RM commits and opens the PR. Each part runs its own gates (§7).

---

## 4. Part 7a — the credit diary

### 4.0 SA workplan-review conditions (folded at T-a0)

| # | Condition (SA, 2026-10-02) | Folded into |
|---|---|---|
| W7-1 | Q-1: `side={isRTL ? 'left' : 'right'}` + `dir`, as the three drawers; render test pins it; §11 follow-up | §4.9, §7, §11 |
| W7-2 | Q-7: `typicalRangeOf` uses `p90 < 1` (7b) | §5.3 (already strict), §7 |
| W7-3 | `SOURCES` gains `ownerCreditHistory.ts`, `CreditHistoryPanel.tsx` **and** `app/api/business-os/credits/history/route.ts`; no literal ceiling in any listed file | §4.11 |
| W7-4 | `creditPeriod.test.ts` "no `Date` from a key" guard: the display-maths exclusion extended by `displayInstantIso` only; its `it.each` gains `ownerCreditHistory.ts` and `creditHistoryCursor.ts` | §4.4, §4.11, T-a3 |
| W7-5 | One source for `endsBefore` / `resetsOn`: **the window carries `resetsOn`** (computed once, W6-5 rule) and the card passes it through; the diary's `endsBefore` is the window's `resetsOn` | §4.2, §4.6 |
| W7-6 | Q-9 (a) read-only keyset walk on a test account (scratch script, outside the repo, never committed) recorded with results; (b) live "Show more" click recorded as owed | §7, QA report |
| W7-7 | Fix the "§5.8" header reference | header (done) |
| W7-8 | The 6a card render suite passes **unedited**; if it fails because of the link, Dev stops and returns to SA | §4.9, T-a11 |
| W7-9 | (SA suggestion, taken) a fixture test with two rows in the same microsecond `created_at`, pinning the `id` tie-break | §4.3, §7 |

### 4.1 Approach

```text
UsageCard (client) ── "Credit history" link ──► CreditHistoryPanel (client, Sheet)
                                                  │ fetch GET /api/business-os/credits/history[?cursor=…], cache: 'no-store'
                                                  ▼  (on open, on "Show more"; never on a timer, no signal subscription)
app/api/business-os/credits/history/route.ts     getUser() → 401; Zod on `cursor` only → 400
                                                  ▼
lib/business-os/credits/creditHistoryCursor.ts   decode + strict regex (w, t, i) ── never reaches the repository unvalidated
                                                  ▼
lib/business-os/credits/ownerCreditHistory.ts    (server-only; imports NOTHING from the entitlements module)
   ├─ resolveOwnerCreditWindow(userId, deps, log)   ← exported from ownerCreditUsage.ts (the ONE registered importer)
   │     returns { window.ledger, key, kind, used, usedByOwner, usedAutomatic, … }
   ├─ cursor.w ≠ current key → { restart: true }
   ├─ BusinessOsCreditOwnerReadRepository.listLedgerRowsForWindow(accountId, window.ledger, after, 50)   (owner RLS client)
   ├─ findChargesByActionIds(…) for corrections whose original is not on the page
   ├─ effectiveFields.ts: resolveEffectiveFields + diaryLabelFor(effectiveService, actionType)
   └─ payload: summary (first page only) + lines + nextCursor
```

### 4.2 The shared window function (SQ-30; SA condition 2)

**Name:** `resolveOwnerCreditWindow(userId: string, deps: OwnerCreditUsageDeps, log: OwnerCreditUsageLogger): Promise<Result<OwnerCreditWindow>>`, exported from **`lib/business-os/credits/ownerCreditUsage.ts`** (so the module's entitlements symbol list is unchanged, V-2).

```typescript
/** The predicate BOTH the totals read and the ledger-row read use. Declared in the repository file (it is a repository argument). */
export type OwnerLedgerWindow =
  | { kind: 'period'; periodStart: string }        // monthly and calendar_month: .eq('period_start', key)
  | { kind: 'from'; fromPeriodStart: string };     // trial_total: .gte('period_start', anchor)

export interface OwnerCreditWindow {
  accountId: string;                   // from resolveAccountId(userId) only
  kind: OwnerCreditPeriodKind;         // 'monthly' | 'trial_total' | 'calendar_month'
  ledger: OwnerLedgerWindow;
  /** The window key, EXACT string as read: the period key, or the trial anchor. Goes into the cursor's `w`. */
  key: string;
  anchor: string | null;               // exact string, or null with no plan row
  periodStart: string;                 // the current period key, exact string
  allowance: OwnerCreditAllowance | null;
  /** Next period start (display only), the W6-5 rule, computed ONCE here (W7-5). The card's `resetsOn` and the diary's `endsBefore`. */
  resetsOn: string | null;
  used: number;                        // 6 dp, from credits_total (the card's figure)
  usedByOwner: number;                 // with corrections attributed by effective trigger (SQ-22)
  usedAutomatic: number;
}
```

**Refactor shape — a pure extract, no behaviour change:**

1. Lines 197–247 of today's `readOwnerCreditUsage` (account, allowance + period in parallel, `allowance = anchor === null ? null : allowanceRead`, the trial / period branch, `sumTotals`, `attributeCorrections`) move verbatim into a private `computeOwnerCreditWindow(...)` that **throws** `OwnerCreditUsageError` exactly as today. The totals read now takes `window.ledger` (`'from'` → `listTotalsFrom(accountId, ledger.fromPeriodStart)`, `'period'` → `findTotalsForPeriod(accountId, ledger.periodStart)`), so the ledger-row predicate of §4.3 is, by construction, the totals read's predicate.
2. `readOwnerCreditUsage` keeps its signature, its single `try` / `catch` and its single log line (`'Owner credit usage read failed'` with `code`), calls `computeOwnerCreditWindow` inside that `try`, and adds what is card-only: `resetsOn` (W6-5 rule unchanged), `granted`, `remaining`. Same payload, same calls in the same order, same log calls.
3. `resolveOwnerCreditWindow` wraps `computeOwnerCreditWindow` in its own never-throw `try` / `catch`, logging `'Owner credit window read failed'` with the same `code` field.
4. `OwnerCreditUsageDeps` is unchanged (the window needs exactly what the card needed).

**Regression proof (SA condition 2):** `ownerCreditUsage.test.ts`, `ownerCreditUsage.crossCheck.test.ts`, `ownerCreditUsage.payload.test.ts`, `app/api/business-os/usage/__tests__/route.credits.test.ts` and `components/business-os/__tests__/UsageCard.render.test.tsx` pass **unedited** — T-a17 records `git diff --stat` showing zero lines on all five. A new `ownerCreditWindow.test.ts` covers the three kinds, the `ledger` predicate per kind, `key` = anchor for a trial and = period key otherwise, and a cross-check that the card's `used` and the window's `used` are the same number for the same fixture.

### 4.3 The owner repository read (SQ-31; SA condition 2)

On `BusinessOsCreditOwnerReadRepository` (client still required, no singleton — 6a header):

- **New exported constant** `OWNER_DIARY_COLUMNS = 'id, kind, action_id, adjusts_action_id, period_start, credits, service, action_type, triggered_by, outcome, created_at, user_id'` (SA's list; no `group_id`, `reason_code`, `credit_value_version`). Row type `OwnerDiaryRow` (structurally satisfies `EffectiveFieldsInput`, no cast).
- **New method** `listLedgerRowsForWindow(accountId: string, window: OwnerLedgerWindow, after: OwnerDiaryKeyset | null, limit: number): Promise<RepositoryResult<{ rows: OwnerDiaryRow[]; hasMore: boolean }>>`, where `OwnerDiaryKeyset = { createdAt: string; id: string }`.
  - `assertAccount`; `assertPeriodKey` on the window key; `limit` an integer 1..`OWNER_CREDIT_READ_LIMITS.DIARY_PAGE_CEILING` (**100**), else refused.
  - `.from('business_os_credit_charges').select(OWNER_DIARY_COLUMNS).eq('user_id', accountId)`, then `.eq('period_start', key)` or `.gte('period_start', from)` from the window, `.order('created_at', { ascending: false }).order('id', { ascending: false }).range(0, limit)` (**limit + 1** rows; `hasMore = rows.length > limit`, the extra row dropped).
  - Keyset (when `after` is given): `after.createdAt` re-checked against the strict timestamptz regex and `after.id` against the UUID regex **in the repository too** (defence in depth: the route already refused anything else), then `.or(\`created_at.lt."${t}",and(created_at.eq."${t}",id.lt.${i})\`)`. Values are double-quoted so the `.`, `:` and `+` of a timestamptz cannot be read as PostgREST syntax; only regex-validated strings are ever interpolated. (This is a SELECT, so the known UPDATE + `.or()` + `.select()` PostgREST defect does not apply.)
  - Charges **and** adjustments in one list; **no** filter, order or grouping on `service` (V-7); read errors returned, never "no lines"; never throws.
- **Tests** (added to the existing repository test file): `OWNER_DIARY_COLUMNS` ⊆ the parsed `authenticated` GRANT line for the charges (the existing "columns ⊆ GRANT lines" block gains the constant) and equals SA's list exactly; `.eq('user_id', accountId)` present; window predicate per kind; keyset order and the exact `.or(...)` string; `limit + 1` / `hasMore`; limit 0 / 101 / non-integer refused without a query; hostile `after` values (comma, parentheses, `)`, `or=`, a quote) refused without a query; the existing "no write verb, no `.rpc(`" source test covers the new method.

### 4.4 The cursor (SQ-29)

New `lib/business-os/credits/creditHistoryCursor.ts` (server-side; pure, imports only `zod`):

- `encodeHistoryCursor({ w, t, i }): string` → base64url of `JSON.stringify({ w, t, i })`.
- `decodeHistoryCursor(raw: string): { w: string; t: string; i: string } | null` — length ≤ 512 and `^[A-Za-z0-9_-]+$` before decoding; `JSON.parse` in a `try`; then a strict Zod object (`.strict()`, no extra keys):
  - `w`: `^(m|c|t):` + timestamptz, where the prefix is the window kind (`m` monthly, `c` calendar month, `t` trial) — see **Q-2** (a precision on SA's `w`);
  - `t`: timestamptz — `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$` (the PostgREST shape; also matches the calendar-month key `YYYY-MM-01T00:00:00.000Z`);
  - `i`: UUID.
  Anything else → `null` → the route answers **400**.

**Strings end to end (SA condition 2):**

| Value | Born | Travels as | Used in | Never |
|---|---|---|---|---|
| Anchor | `findPeriodAnchor` (PostgREST string) | `window.anchor`, `window.ledger.fromPeriodStart`, `window.key` (trial) | `.gte('period_start', …)` for totals **and** rows; cursor `w` | built from or passed through a `Date` |
| Period key | `business_os_credit_period_start` RPC string, or `calendarMonthStartUtc` (exact at the second) | `window.periodStart`, `window.ledger.periodStart`, `window.key` | `.eq('period_start', …)` for totals **and** rows; cursor `w` | same |
| `created_at` | the row (PostgREST string, microseconds) | `line → cursor.t` verbatim | the keyset `.or(...)` | re-serialised; the payload's display `at` is a **separate** millisecond ISO string made by a new `displayInstantIso(iso)` export of `creditPeriod.ts` (the existing private `displayInstantMs`), display only |
| Row `id` | the row | `line.id`, `cursor.i` | keyset tie-break | — |
| Cursor | `encodeHistoryCursor` on the server | opaque string; the client sends it back byte-for-byte | `decodeHistoryCursor` | parsed or built by the client |

Window change between pages: the server re-resolves the window on **every** request; `cursor.w !== \`${prefix}:${window.key}\`` (plain string equality) → `{ restart: true }`, and the panel reloads from page one under a fresh summary. A test proves the exact-string rule: a fake PostgREST that matches `period_start` and `created_at` by exact string returns 0 rows for a millisecond-truncated value, and a fixture with two rows in the same millisecond but different microseconds across a page boundary is neither skipped nor repeated.

### 4.5 Labels and areas (SQ-33, C-S7-1, D-q)

- **New in `effectiveFields.ts`** (the one file allowed to read `service`, V-7): `diaryLabelFor(effectiveService: string | null, actionType: string | null): DiaryLabel | null` — the sibling of `areaFor`, same rule: only when `effectiveService === AI_CHARGE_SERVICE` and the action type is a declared key; returns `{ en, he, es }` copied into a **local structural type** `DiaryLabel = { en: string; he: string; es: string }` declared in `effectiveFields.ts`. No import of `Labels`; nothing in slice 7 imports from `lib/business-os/entitlements/` except through `ownerCreditUsage.ts` with its symbol list unchanged.
- `effectiveFields.ts` gains `import 'server-only'` (it imports `aiActionAudit.ts`, F7-10). Its existing consumers are all server-side (the report, the leak check, `ownerCreditUsage.ts`); the jest moduleNameMapper already handles `server-only` (6a builder).
- **D-q edit** in `aiActionAudit.ts`: `onboarding_turn.diaryLabels.en` "Setup conversation" → **"Replied in your setup conversation"**; he / es drafts reworded to match ("השבנו בשיחת ההקמה" / "Respuesta en tu conversación de configuración" — **native review**). Stale comments updated: `:25` and `:82` ("Nothing reads … yet") → name the readers (the credit diary, the effective-fields resolver); `:98-99` DRAFT note → "rendered in the credit diary since slice 7; he / es pending native review before release". String-only: no call-site, area or charge change (`bos-llm-call-standards` not engaged). `npm run typecheck:bos-llm` and `npm run check:bos-llm-literals` run as gates because the file is touched.
- **Area names** — eight new client keys `credits.area.chat|insights|briefing|website|intake|leads|onboarding|images` in en / he / es: Chat / צ׳אט / Chat; Insights / תובנות / Novedades; Briefing / תדריך / Resumen; Website / אתר / Sitio web; Forms / טפסים / Formularios; Enquiries / פניות / Consultas; Setup / הקמה / Configuración; Images / תמונות / Imágenes. he / es **need native review** (D-q).
- **Guard test** `creditAreaNames.test.ts`: every code in `BOS_LLM_AREAS` has a non-empty `credits.area.<code>` in en, he and es; no `credits.area.*` key exists for a code not in the list (no dead keys).

### 4.6 The diary builder and its payload (SQ-32, SQ-34, SQ-38)

**`lib/business-os/credits/ownerCreditHistory.ts`** (`import 'server-only'`; imports `resolveOwnerCreditWindow` from `./ownerCreditUsage`, `effectiveFields.ts`, `creditPeriod.ts`'s `displayInstantIso`, the cursor module, types; **nothing** from `lib/business-os/entitlements/`, no repository singleton, no service-role client):

`readOwnerCreditHistory(userId, cursor: DecodedHistoryCursor | null, deps: OwnerCreditHistoryDeps, log): Promise<Result<OwnerCreditHistoryPage>>` — never throws.

1. `window = resolveOwnerCreditWindow(userId, deps, log)`; error → error.
2. If `cursor` and `cursor.w` ≠ the current window's `w` → `{ restart: true }` (logged at `info`: window kind only).
3. `listLedgerRowsForWindow(window.accountId, window.ledger, cursor ? { createdAt: cursor.t, id: cursor.i } : null, 50)`.
4. Corrections (`kind = 'adjustment'`): originals present on the page are used directly; the rest are fetched with the existing `findChargesByActionIds` (same account). `resolveEffectiveFields(row, originals)` gives each line its effective service, action type, area and trigger (N-10). **C-S7-2:** 4c stamps a correction with its original's period, so the original is always in the same window, though possibly on another page.
5. Each line:
   `{ id, at, area, label, who, didNotComplete, isCorrection, credits }` —
   `id` = row id; `at` = `displayInstantIso(created_at)`; `area` = effective area code or `null`; `label` = `diaryLabelFor(effectiveService, effectiveActionType)` or `null` (→ "Other activity"); `who` = effective trigger `owner` → `'you'`, `scheduled` / `external` → `'automatic'`, unresolved → `null`; `didNotComplete` = `outcome === 'failed'` (adjustments: `false`); `isCorrection` = `kind === 'adjustment'`; `credits` = exact (6 dp), parsed with the 6a `figure` rule (string numerics accepted, non-finite → **error**, never 0). An unresolved correction: `area`, `label`, `who` null, still a line, still in the total (logged at `warn` with a count).
6. **First page only** (`cursor === null`): `summary = { period: { kind, startsOn, endsBefore }, used, usedByOwner, usedAutomatic }` where `used` / split are the **window's** (the card's figure — never a page sum), `startsOn` = `displayInstantIso(kind === 'trial_total' ? anchor : periodStart)`, `endsBefore` = `window.resetsOn` — the same value the card sends as `resetsOn` (W7-5), so the two surfaces never disagree.
7. `nextCursor` = `hasMore ? encodeHistoryCursor({ w, t: lastRow.created_at, i: lastRow.id }) : null`.
8. **No runtime full-window reconciliation (C-S7-3).** Proven by builder tests (§7) and, in production, by the operator Costs & credits report (F7-7).

**Payload types** — new client-safe **`lib/business-os/credits/creditHistoryTypes.ts`**: types only, **no import at all** (stronger than "no value import": it cannot reach the entitlements module, C-S7-1), declaring its own `CreditHistoryLabel = { en: string; he: string; es: string }`:

```typescript
export interface CreditHistoryLine {
  id: string;
  at: string;                       // millisecond ISO, display only
  area: string | null;              // a BOS area code; named by `credits.area.<code>`
  label: CreditHistoryLabel | null; // null → "Other activity"
  who: 'you' | 'automatic' | null;
  didNotComplete: boolean;
  isCorrection: boolean;
  credits: number;                  // exact, 6 dp; the client rounds (D-m)
}
export interface CreditHistorySummary {
  period: { kind: 'monthly' | 'trial_total' | 'calendar_month'; startsOn: string; endsBefore: string | null };
  used: number;
  usedByOwner: number;
  usedAutomatic: number;
  // 7b adds: ranges?: CreditHistoryRange[]
}
export type OwnerCreditHistoryPage =
  | { restart: true }
  | { restart?: undefined; summary?: CreditHistorySummary; lines: CreditHistoryLine[]; nextCursor: string | null };
```

Absent by construction (SQ-38): `user_id`, `action_id`, `adjusts_action_id`, `group_id`, `service`, `action_type`, `credit_value_version`, `reason_code`, raw `kind`, `period_start`, raw `created_at`, cost, tokens, model, fallback.

**Deps and wiring:** `OwnerCreditHistoryDeps extends OwnerCreditUsageDeps { ledger: Pick<BusinessOsCreditOwnerReadRepository, 'listLedgerRowsForWindow' | 'findChargesByActionIds'> }`. Production wiring: a second export `ownerCreditHistoryDeps(ownerClient)` in the existing **`ownerCreditUsageDeps.ts`** (`{ ...ownerCreditUsageDeps(ownerClient), ledger: <the same owner repository instance> }`) — no new file naming the plan repository, so the RC-15 guard's `ALLOWED` list is untouched; that file's header "one caller" sentence is updated to name both routes.

### 4.7 The route (SQ-29; `new-api-route` skill)

New **`app/api/business-os/credits/history/route.ts`**:

- `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`; `Cache-Control: private, no-store` on every answer.
- `correlationId` from `x-correlation-id` or `crypto.randomUUID()`; `logger.child({ correlationId })` (`createLogger({ module: 'BusinessOsCreditHistoryAPI' })`).
- `getUser()` **first** → 401 `{ success: false, error: 'Unauthorized' }`, nothing read.
- Input: **only** `cursor` from `searchParams`, Zod `z.object({ cursor: z.string().min(1).max(512).optional() })`; then `decodeHistoryCursor`; failure → **400** `{ success: false, error: 'Invalid request', details: dev-only }`. Every other query parameter (`accountId`, `userId`, …) is never read. No body, no params.
- Account only through the builder's `resolveAccountId(user.id)` (inside the window function). Owner RLS client from `createAuthenticatedServerClient()`; `readOwnerCreditHistory(user.id, cursor, ownerCreditHistoryDeps(ownerClient), requestLogger)`.
- One `info` line: `userId`, window kind, line count, whether more, whether restart — **never** labels, line credits or the total.
- Errors: `{ success: false, error: 'Could not load your credit history', details: process.env.NODE_ENV === 'development' ? … : undefined }`, 500.
- No audit entry (a read of one's own figures, 6a precedent). Imports nothing from the entitlements module and no `supabaseServer`.

### 4.8 The line formatter (SQ-34, D-m)

In **`lib/business-os/credits/creditDisplay.ts`** (pure, import-free, client-safe — the 6a guard already pins it), new:

- `toDiaryCredits(credits: number): { kind: 'tenths'; value: number } | { kind: 'less_than_tenth'; negative: boolean } | { kind: 'zero' }` — one decimal; a non-zero value whose magnitude rounds to 0.0 → "less than 0.1" keeping its sign (never "0.0" or "−0.0"); the caller formats with `Intl.NumberFormat(language, { maximumFractionDigits: 1 })`, so whole numbers show without ".0".
- `toDiarySummary({ used, usedByOwner, usedAutomatic })` — the total at one decimal from the exact `used`; the two parts shared out at tenths with the 6a largest-remainder method so they add up to the displayed total (the D-c rule carried to D-m precision; **Q-6**).

### 4.9 The panel and the card link (SQ-37, D-i, D-j, D-n, D-p)

**`components/business-os/UsageCard.tsx`** — one addition: a small text button **"Credit history"** (`credits.history.link`) under the figures, shown whenever the card has rendered a result (gauged, trial and the no-allowance state; not while loading, not on the error line). It sets `historyOpen`; the panel is **mounted on first open** and kept mounted afterwards (so the close animation runs and the card's mount makes **no** extra request — V-14). Nothing else in the card changes: payload, figures, states, triggers, tooltip.

**`components/business-os/CreditHistoryPanel.tsx`** (new, `'use client'`), on `Sheet` / `SheetContent` / `SheetTitle` from `components/ui/sheet.tsx` — the shell classes of the existing drawers (`w-full sm:max-w-xl p-0 bg-[var(--v2-bg)] border-[var(--v2-border)]`), `dir={isRTL ? 'rtl' : 'ltr'}` on the content, and **`side={isRTL ? 'left' : 'right'}` — the existing drawers' expression (SA Q-1 ruling, condition W7-1)**; the render test pins the prop per language.

- Reads on open (each time it opens) and on "Show more"; `fetch(url, { cache: 'no-store', signal })`; `AbortController` on close / unmount; one request at a time. **No** `setTimeout` / `setInterval` / `requestAnimationFrame`, **no** `onCreditUsageChanged` subscription (source guard, §4.11).
- Payload checked before use (as the card's `isOwnerCreditUsage`): malformed → error state, never empty.
- `{ restart: true }` → drop lines, re-read page one (bounded: a second restart in a row shows the error state rather than looping).
- **Summary:** heading "Credit history"; period line — monthly with `endsBefore`: "This period · {from} – {to}" (`to` = the day before `endsBefore`, business time zone); monthly without (ungauged): "This period · since {from}"; trial: "Since your trial began"; calendar month: "This month"; "{n} credits used"; "{owner} by you · {automatic} automatic". Over the allowance: the true total, **no** "left", no warning / paused / upgrade wording.
- **Lines:** when ("Today 09:14", "Yesterday 16:20", "29 Sep 11:02" — `timeZoneOptions` + `Intl.DateTimeFormat(language)`, today / yesterday decided in the business time zone), area name, label (`label[language]`, or "Other activity"; a correction "Correction to: {label}", an unresolved one "Correction to: Other activity" — **Q-4**), "You" / "Automatic" (nothing when `who` is null), "Didn't complete" marker when failed (credits still shown), credits per §4.8.
- **Footnote** "Each line is rounded; the total is exact." whenever there is at least one line. **"Show more"** while `nextCursor` is set (50 a page, no infinite scroll).
- **States:** loading ("Loading…"); error ("Could not load your credit history" — never the empty state, never a zero); empty — monthly / calendar month "Nothing has used credits yet this period." + the D-b sentence (`usage.explain.monthly`, reused), trial "Nothing has used credits yet." + `usage.explain.trial` (**Q-5**); no D-b sentence when there is no allowance (6a DV-3).

**Dictionary** (`LanguageContext.tsx`, one contiguous block per language, en / he / es — he / es **native review** before release, D-p): `credits.history.link`, `.title`, `.period.this`, `.period.since`, `.period.trial`, `.period.month`, `.used`, `.split`, `.who.you`, `.who.automatic`, `.did_not_complete`, `.correction`, `.other`, `.footnote`, `.empty`, `.empty_trial`, `.error`, `.loading`, `.show_more`, `.less_than_tenth`, `.today`, `.yesterday` (22 keys) + the 8 `credits.area.*` = **30 keys × 3**. Wording from D-p's table where it exists; the new ones (`period.*`, `used`, `split`, `less_than_tenth`, `today`, `yesterday`, `empty_trial`, `loading`, `show_more`, `link`) drafted by Dev and listed for the user. Who labels reuse D-a's split words ("על ידך" / "אוטומטי", "Por ti" / "Automático"). No string contains a figure (the 6b config-figures guard scans `credits`-worded entries).

### 4.10 Docs

- `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` — Metering section: one line on the owner diary (owner RLS repository, the card's window, no new importer of the module); Change History row.
- `docs/architecture/BUSINESS_OS_CREDIT_PRICING.md` — §5 "Fractional credits" row: the diary's precision decided (D-m: one decimal, "less than 0.1", the total from the exact sum, the footnote); Change History row.
- Not edited by Dev (BA's): the requirement's §12 delivery row, AC ticks, KI updates.

### 4.11 Guards extended (SA condition 3)

| Guard | Extension |
|---|---|
| `lib/business-os/credits/__tests__/ownerCreditSurface.guard.test.ts` | `OWNER_SURFACE` (FR-36 words, full source) gains the route, `ownerCreditHistory.ts`, `creditHistoryCursor.ts`, `creditHistoryTypes.ts`, `CreditHistoryPanel.tsx`. Rule 2 (no timers / `BroadcastChannel`) gains the panel **and** a new pin that the panel never names `onCreditUsageChanged` / `creditUsageSignal`. Rule 3: `creditHistoryTypes.ts` has **no import at all**; the panel imports only `creditDisplay` and `creditHistoryTypes` from the credits directory and nothing matching `@/lib/repositories|supabaseServer|business-os/entitlements|server-only|llm/aiActionAudit|effectiveFields|callCatalog|ownerCreditHistory`; the card's rule unchanged. Rule 4: the route and `ownerCreditHistory.ts` hold no service-role client and no repository singleton; neither imports the entitlements module; `ownerCreditHistory.ts` and `effectiveFields.ts` contain `import 'server-only'`. New: **no client file** (any `'use client'` file under `app/ components/ hooks/ lib/`) imports `aiActionAudit`, `effectiveFields`, `callCatalog` or `ownerCreditHistory` — proved on a planted sample first |
| `lib/business-os/credits/__tests__/creditPeriod.test.ts` | (W7-4) the display-maths exclusion gains `displayInstantIso` only; the "no `Date` from a key" `it.each` gains `ownerCreditHistory.ts` and `creditHistoryCursor.ts` |
| `lib/business-os/credits/__tests__/serviceColumn.guard.test.ts` | Already scans every file in `lib/business-os/credits/` and the owner repository, so the new method and the new credits files are covered automatically; a named assertion is added that `listLedgerRowsForWindow` (and in 7b `listSucceededChargesSince`) contain none of the four rules, so a future move of the scan list cannot drop them silently |
| `lib/business-os/entitlements/__tests__/creditFigures.fromConfig.guard.test.ts` | `SOURCES` gains `lib/business-os/credits/ownerCreditHistory.ts` (it imports `./ownerCreditUsage`, so the completeness test would otherwise fail, V-9), `components/business-os/CreditHistoryPanel.tsx` (a surface that shows credit figures) and `app/api/business-os/credits/history/route.ts` (W7-3); no literal ceiling or allowance figure in any of them. `BUILDERS` unchanged. This is not `KNOWN_NON_GATE_IMPORTERS` |
| `enforcementPoints.test.ts` `KNOWN_NON_GATE_IMPORTERS` | **Unchanged** (SA condition 3). Its `why` for `ownerCreditUsage.ts` speaks of the card only; left as is (Q-10) |

### 4.12 Files — 7a

| File | Action | Reason |
|---|---|---|
| `lib/business-os/credits/ownerCreditUsage.ts` | modify | Extract `resolveOwnerCreditWindow` (§4.2) |
| `lib/business-os/credits/ownerCreditUsageDeps.ts` | modify | `ownerCreditHistoryDeps`; header sentence |
| `lib/business-os/credits/__tests__/ownerCreditWindow.test.ts` | create | §4.2 |
| `lib/repositories/BusinessOsCreditOwnerReadRepository.ts` | modify | `OWNER_DIARY_COLUMNS`, `OwnerLedgerWindow`, `listLedgerRowsForWindow`, `DIARY_PAGE_CEILING`; header line |
| `lib/repositories/__tests__/BusinessOsCreditOwnerReadRepository.test.ts` | modify (add) | §4.3 tests incl. grant subset |
| `lib/business-os/credits/creditHistoryCursor.ts` + `__tests__/creditHistoryCursor.test.ts` | create | §4.4 |
| `lib/business-os/credits/creditPeriod.ts` + its test | modify | Export `displayInstantIso` (display only); test |
| `lib/business-os/credits/effectiveFields.ts` + `__tests__/effectiveFields.test.ts` | modify | `diaryLabelFor`, `DiaryLabel`, `server-only` |
| `lib/business-os/llm/aiActionAudit.ts` | modify | D-q label; stale comments |
| `lib/business-os/credits/ownerCreditHistory.ts` + `__tests__/ownerCreditHistory.test.ts`, `ownerCreditHistory.payload.test.ts`, `ownerCreditHistory.reconcile.test.ts` | create | §4.6 |
| `lib/business-os/credits/creditHistoryTypes.ts` | create | Client-safe payload types, no import |
| `lib/business-os/credits/creditDisplay.ts` + `__tests__/creditDisplay.test.ts` | modify | §4.8 |
| `app/api/business-os/credits/history/route.ts` + `__tests__/route.test.ts` | create | §4.7 |
| `components/business-os/UsageCard.tsx` | modify | The link only |
| `components/business-os/CreditHistoryPanel.tsx` + `components/business-os/__tests__/CreditHistoryPanel.render.test.tsx` | create | §4.9 |
| `components/business-os/__tests__/UsageCard.historyLink.render.test.tsx` | create | Link shown / hidden per state; no fetch until opened (the 6a card test stays unedited) |
| `lib/business-os/LanguageContext.tsx` | modify | 30 keys × 3 |
| `lib/business-os/credits/__tests__/creditAreaNames.test.ts` | create | All-areas guard |
| `lib/business-os/credits/__tests__/ownerCreditSurface.guard.test.ts`, `serviceColumn.guard.test.ts` | modify | §4.11 |
| `lib/business-os/entitlements/__tests__/creditFigures.fromConfig.guard.test.ts` | modify | `SOURCES` (§4.11) |
| `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md`, `docs/architecture/BUSINESS_OS_CREDIT_PRICING.md` | modify | §4.10 |

### 4.13 SA condition 2 — where each item is answered

| Condition item | Answered in |
|---|---|
| Names the window function; `readOwnerCreditUsage` consumes it; 6a tests unedited | §4.2 (`resolveOwnerCreditWindow` in `ownerCreditUsage.ts`; five unedited suites, `git diff --stat` proof in T-a17) |
| Period key, anchor, `created_at` and cursor as exact strings end to end | §4.4 table; exact-string fake tests (§7) |
| New repository method, `OWNER_DIARY_COLUMNS`, grant test | §4.3 (`listLedgerRowsForWindow`; constant; GRANT-subset test) |
| New client-safe types file imports nothing from the entitlements module (C-S7-1) | §4.6 (`creditHistoryTypes.ts` imports **nothing**; local `CreditHistoryLabel`); `diaryLabelFor` returns a local `DiaryLabel`; guard §4.11; `test:bos-entitlements` with `KNOWN_NON_GATE_IMPORTERS` unchanged |

### 4.14 Task list — 7a

| # | Task | Estimate |
|---|---|---|
| ✅ **T-a0** | Fold SA's workplan-review conditions into §4 (marked); baselines: `npx tsc --noEmit` error list, `npm run typecheck:bos-llm`, `npm test -- lib/business-os app/api/business-os components/business-os` red list (the 4 known baseline reds) | 0.05 d |
| ✅ **T-a1** | Extract `resolveOwnerCreditWindow` (§4.2); `ownerCreditWindow.test.ts`; run the five 6a suites unedited | 0.25 d |
| ✅ **T-a2** | Repository: `OWNER_DIARY_COLUMNS`, `OwnerLedgerWindow`, `listLedgerRowsForWindow` (keyset, quoted `.or`, limit + 1, cap 100) + tests (§4.3) | 0.5 d |
| ✅ **T-a3** | Cursor module + `displayInstantIso` + tests (round trip, length, alphabet, strict keys, hostile values, calendar-month key) | 0.15 d |
| ✅ **T-a4** | `diaryLabelFor` + `server-only` in `effectiveFields.ts`; D-q label and stale comments in `aiActionAudit.ts`; `typecheck:bos-llm`, `check:bos-llm-literals` | 0.1 d |
| ✅ **T-a5** | `ownerCreditHistory.ts` + `creditHistoryTypes.ts` + `ownerCreditHistoryDeps`; builder, payload and reconciliation tests (§7) | 0.75 d |
| ✅ **T-a6** | Route + integration tests (§7) | 0.35 d |
| ✅ **T-a7** | `toDiaryCredits` / `toDiarySummary` + tests | 0.15 d |
| ✅ **T-a8** | `CreditHistoryPanel.tsx`, the card link, 30 dictionary keys × 3, area guard; render tests en / he / es for every state (§7) | 1.0 d |
| ✅ **T-a9** | Guards extended (§4.11); `npm run test:bos-entitlements` green with `KNOWN_NON_GATE_IMPORTERS` unchanged | 0.15 d |
| ✅ **T-a10** | Docs (§4.10) | 0.1 d |
| ✅ **T-a11** | Gates (§7) with results pasted; `git diff --stat` — zero lines on the five 6a suites, no deletion without insertion | 0.15 d |
| ⬜ **T-a12** | Handover uncommitted: SA code review → user diff (with the he / es list for native review) → QA → user approval → RM | — |
| | **Total 7a** | **≈ 3.75 d** |

Within SA's 3.5–3.75 d, at its upper edge. The two tasks most likely to run long are T-a2 (the keyset against real PostgREST quoting, R-1) and T-a8 (the panel's state matrix in three languages). If either pushes the total past 4 days, Dev returns to SA rather than trimming tests (SA ruling).


### 4.15 7a implementation evidence (Dev, 2026-10-02)

Uncommitted on `feature/business-os-credit-deduction-slice-7`. No migration, no DB read or write, no dev server; Jest with `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9` and stub keys.

**Gates**

| Gate | Result |
|---|---|
| T-a0 baseline `npx tsc --noEmit` (6 GB heap) | 2,092 errors (pre-existing) |
| `npx tsc --noEmit` after | **2,092; identical by file + error code** (the known `IRFormalizer.ts` TS2304 ↔ TS2552 flap, as in 6a). **0 errors in any new or touched file** |
| New + touched suites (28) | **28 / 28 suites, 627 / 627 tests** |
| `npm run test:bos-entitlements` | **103 / 103 suites, 2,205 / 2,205 tests**; `enforcementPoints.test.ts` diff **empty** (`KNOWN_NON_GATE_IMPORTERS` unchanged, W7 condition 3) |
| The five 6a suites (`ownerCreditUsage`, `.crossCheck`, `.payload`, `usage/route.credits`, `UsageCard.render`) and 6a `creditDisplay.test.ts` | **Unedited** (`git diff --stat` on them: empty) and **green** (W7-8: the card suite passes with the link added) |
| Wider: `lib/business-os app/api/business-os components/business-os lib/repositories app/business-os components/test-business-os app/api/admin/business-os` | 316 / 322 suites, 6,070 / 6,082 tests. Red: the **4 baseline reds** (`tokenUsageRepository.contract`, `proposals-capability`, `callParams.boundary.step3`, `chat-v4/route.audit`) plus `InviteFriendsSection.render` and `PlanSection.render`, which failed only by **"Exceeded timeout"** under the parallel load (16 timeouts) and pass alone (**2 / 2 suites, 71 / 71**). Neither is touched by this slice |
| `npm run typecheck:bos-llm` | passed, **0 new** (28 baseline; the one "fixed" baseline entry is pre-existing) |
| `npm run check:bos-llm-literals` | passed, 0 violations |
| `npm run lint:hooks` | clean (exit 0) |
| `npx eslint` on every changed + new `.ts` / `.tsx` | 0 errors; 1 pre-existing warning (`LanguageContext.tsx` `currencyInitialized`) |
| `next build` | **Run on the final diff — exit 0, see §4.15.2 (SA C-1)** |

**What the tests pin (new):** the window (three kinds, `ledger` predicate and `key` per kind, card = window figures, `resetsOn` one source); the repository read against an **evaluating** fake (exact-string period match, microsecond `created_at`, 120 rows walked 50 at a time with no repeat or skip, same-millisecond rows across a page boundary, **two rows in the same microsecond paged by id — W7-9**, a millisecond-truncated keyset demonstrably skipping a row, the exact quoted `.or()` string, refusals of hostile keyset values / limits / accounts with **no query made**, read error ≠ no lines, `OWNER_DIARY_COLUMNS` ⊆ the parsed GRANT and equal to SA's list); the cursor (round trip byte for byte, 16 refusals); `displayInstantIso`; `diaryLabelFor` (service AND action type; D-q label; a copy); the builder (summary = the card's figures, lines, failed, external = automatic, non-`ai` service = "Other activity" and counted, a correction under its charge's service / area / trigger when the charge is a page later, same-page original read without a second query, unresolved correction counted with `warn`, paging 50 / 50 / 20, cursor contents, **restart** for another window and for a rolled-over period, every failure an error); **reconciliation** — over all pages, the exact sum of the lines equals the card's `used` (charges, a failure, a cross-page correction, another service, a row in another period excluded; and a trial spanning two periods); the payload (exact recursive key set for page one, later page and restart; banned words on keys incl. the `ai` segment; a value scan with labels excluded; no account id, raw service / action type or action ids); the route (happy path + `no-store`; 401 reads and decodes nothing; 5 malformed and 4 hostile cursors → 400 with nothing read; `?accountId=` / `?userId=` ignored; RLS client for the ledger, service role only for the anchor + period function; next page by exact keyset; restart; 500 on ledger and window errors; source: only `cursor` read, `getUser()` first); the formatter (one decimal, "less than 0.1" with sign, no "−0.0", summary parts add up in a 2,000-case sweep); the panel in en / he / es (every state of §4.9, **`data-side` = `left` in he, `right` in en / es, `dir`** — W7-1, no "AI" / token / $ / cost, Today / Yesterday in the business clock, restart reload, a second restart → error, reads on each open and never while closed, "Show more" appends with the opaque cursor); the card link (shown gauged / trial / no allowance, absent loading and on error, the card's mount = 1 request, the panel's first request on open); area names (all 8 × 3, no dead keys, D-q English); the guards of §4.11.

**Deviations from the plan as written (for SA)**

| # | What | Why |
|---|---|---|
| DV-1 | The window tests, the reconciliation property and the payload allow-list live in `ownerCreditHistory.test.ts` (not `ownerCreditWindow.test.ts`, `.reconcile`, `.payload`) | One ledger fixture whose totals are DERIVED from its rows serves all three; a shared helper file under `__tests__/` would be collected as a test, and one outside it would be a "product file" to the credits and config-figure guards |
| DV-2 | The diary repository tests are a new sibling `BusinessOsCreditOwnerReadRepository.diary.test.ts` (an evaluating fake); only the GRANT-subset test was added to the existing file | The existing file's recording fake has no `.or`; editing its builder would touch every 6a test there |
| DV-3 | Formatter tests in a new `creditDisplay.diary.test.ts` | Keeps 6a's `creditDisplay.test.ts` unedited |
| DV-4 | `ownerCreditHistoryDeps` builds one owner repository and passes it as both `owner` and `ledger` | One instance per request; `ownerCreditUsageDeps` is unchanged |
| DV-5 | The period line's "to" is the day of the instant before `endsBefore`, in the business clock. For an anchor at 09:31 UTC it reads "14 Sep – 14 Oct" (the period really ends 14 Oct 09:31), not the scoping's illustrative "13 Oct" | Truthful for any anchor time; for a midnight anchor it reads "13 Oct". BA / SA to say if they want the day before regardless |
| DV-6 | A failed "Show more" clears the list and shows the error line | Same rule as 6a DV-6: a list that may be incomplete is never shown as current |
| DV-7 | `creditPeriod.test.ts`'s Date guard also matches `created_at` / `createdAt` (planted cases added) | SA W7-4 asks that the builder and the cursor build no `Date` from `created_at` either; the regex had to know the name |
| DV-8 | `effectiveFields.ts` added to the owner-surface FR-36 scan and to the `server-only` pin | It now produces what the panel shows (labels) |
| DV-9 | he / es drafts for D-q's label: "מענה בשיחת ההקמה" / "Respuesta en tu conversación de configuración" | Nominal style of the other labels; native review owed |
| DV-10 | `resolveOwnerCreditWindow` logs `'Owner credit window read failed'`; the card keeps `'Owner credit usage read failed'` | The card's log line is unchanged (6a tests); the history's has its own |

**Tooling note (no product effect):** an editing script rewrote nine files with CRLF line endings mid-task; the credit-period source guard (which matches `\n}\n`) caught it. All were restored to their original LF; `git diff` was never affected (autocrlf). `UsageCard.tsx`, `LanguageContext.tsx` and the docs keep their CRLF / LF as found.

**`console.*`:** 0 in every touched or new file (counted). **Not done (QA / SA):** the Q-9 (a) read-only keyset walk against live PostgREST (W7-6: QA records it), the Q-9 (b) live "Show more" click (owed), the manual §7 check, and the user's native review of the he / es strings (30 keys × 2 + the D-q label).

**Native-review list (he / es):** every `credits.history.*` and `credits.area.*` key added to `LanguageContext.tsx` (30 per language), and `onboarding_turn`'s diary label in `aiActionAudit.ts`. New en strings beyond D-p (Q-5): "This period · since {from}", "Since your trial began", "This month", "{n} credits used", "{owner} by you · {automatic} automatic", "less than 0.1", "Today {time}", "Yesterday {time}", "Nothing has used credits yet.", "Loading…", "Show more".

**Estimate check:** within the 3.75 d plan; nothing pushed it past 4 days.


#### 4.15.1 After SA code review and QA (Dev, 2026-10-02)

Folded in the review items the coordinator asked for (CR7-6 skipped, as instructed). The 6a card suites remain unedited.

| Item | Fix | Test |
|---|---|---|
| **CR7-3** | `ownerCreditHistory.ts`: the cursor is decoded by its own decoder before it is sent. If the decoder would refuse it, paging ends at this page (`nextCursor: null`), the lines already read are still shown, and an `error` is logged with `code: 'cursor_not_decodable'` — never a cursor that turns "Show more" into a 400 | `ownerCreditHistory.test.ts`: a last row whose `created_at` ends `+00` (no minutes) → lines shown, no cursor, the error log; a normal row → a decodable cursor and no error |
| **CR7-4 / QA-2** | `CreditHistoryPanel.tsx`: "Yesterday" is the calendar day before today's day key in the business clock (`previousDayKey`), not "now − 24 h" | Panel test: London at 00:30 BST on 30 Mar 2026 (the night after the spring-forward), a line on 29 Mar reads "Yesterday" and one on 28 Mar does not — the case "now − 24 h" got wrong |
| **CR7-5** | `ownerCreditUsage.ts` header: the "TWO CONSUMERS" block now sits above the "THIS FILE AND THE ENTITLEMENTS MODULE" heading, which is back directly above its own paragraph | — (comment only) |
| **CR7-7** | New key `credits.history.used_one` — en "{n} credit used", he "נוצל {n} קרדיט", es "{n} crédito usado" (he / es join the native-review list), used when the shown total is exactly 1.0 | Panel test: 1.0 reads the singular in en / he / es; 2 stays plural |
| **QA-1** | A page-one read (every open) first clears the summary, lines and cursor, so "Loading…" shows until page one returns — never the previous opening's figures | Panel test: open, close, reopen with a held fetch → "Loading…", no lines, no total |
| **QA-3** | One minus sign everywhere: every negative figure is U+2212 followed by the formatted magnitude ("−12.5", "−less than 0.1"), never the locale's hyphen-minus | Panel test: both kinds of negative line use U+2212 and contain no "-"; the Q-4 test now asserts "−12.5" exactly |

#### 4.15.2 Parked: shipped dark behind a flag (user decision 2026-10-02)

The user parked the credit history: it ships committed but hidden from owners. 7b is parked with it.

| Piece | As built |
|---|---|
| Flag | **`NEXT_PUBLIC_BUSINESS_OS_CREDIT_HISTORY`**, **default off** (unset, blank or unrecognised = off; `true` / `1`, any case, = on). `NEXT_PUBLIC_` because the card is a client component. Documented in `docs/feature_flags.md` (table row, own section, Change History 1.5.0). The repo has no `.env.example`, so no entry there |
| Client reader | `isBusinessOsCreditHistoryEnabled()` in `lib/utils/featureFlags.ts` (an `is…Enabled` name — `npm run lint:hooks` clean), literal `process.env` access so Next inlines it; added to `getFeatureFlags()` |
| Server reader | `isCreditHistoryRouteEnabled()` in new `lib/business-os/credits/creditHistoryFlag.ts`, through the zero-import `parseBooleanFlag` only — the route never imports the client module (the purge-flag precedent: two readers, one rendering, one serving) |
| Card | `UsageCard.tsx` draws the "Credit history" link and mounts the panel only when the flag is on. Off, the card is exactly the 6a card: the 6a render suite passes **unedited** with the flag unset |
| Route | `GET /api/business-os/credits/history` checks the flag **first** — before `getUser()`, before the cursor, before any read — and answers **404 `{ success: false, error: 'Not found' }`** with `no-store` to every caller while it is off. Order chosen so nothing leaks: an anonymous caller gets the same 404 as a signed-in owner, so the route does not even reveal that it exists (a 401 first would) |
| Dormant code | The panel, builder, repository method, cursor, labels, dictionary keys and all their tests stay in place and run; every guard stays green (the flag file is in the owner-surface scan) |

**How the flag is tested**

| Suite | Flag state | Pinned |
|---|---|---|
| `lib/utils/__tests__/featureFlags.test.ts` (new describe, 9 tests) | unset, `''`, `false`, `0`, `yes` → off; `true`, `TRUE`, `1` → on | Default off; listed in `getFeatureFlags()` |
| `components/business-os/__tests__/UsageCard.render.test.tsx` (6a, **unedited**) | unset | The card exactly as 6a, all 32 tests green |
| `components/business-os/__tests__/UsageCard.historyLink.render.test.tsx` | unset and `false` | No link, no panel, no "Credit history" text, one request, never a history request |
| same file | `true` | The link in gauged / trial / no-allowance states; absent loading and on error; opening it makes the first history request |
| `app/api/business-os/credits/history/__tests__/route.test.ts` | unset, `false`, blank, `yes` | 404 + `no-store` + the error format, with no client built, no query, no RPC, no snapshot read; the same 404 for an anonymous caller (no 401) and for a hostile cursor (never decoded) |
| same file | `true` / `1` | Every earlier route test, run switched on; source: the flag is asked before `getUser()` and the route never imports `utils/featureFlags` |

**To switch it on later:** set `NEXT_PUBLIC_BUSINESS_OS_CREDIT_HISTORY=true` on Vercel and **redeploy** (the value is fixed at build time). Before that: the native he / es review and the signed-in walkthrough (QA report, owed).

**SA C-1 — `next build` on the final diff (flag + review fixes): exit 0.** Run as 6b did: a scratch export of the working tree (`git ls-files -co --exclude-standard`, so no `.env*`) in the session scratchpad, outside the repo; a `node_modules` junction to the shared `neuronforge/node_modules` created with PowerShell `New-Item -ItemType Junction`; the CI placeholder env from `.github/workflows/build.yml` (6 GB heap). Result: "Compiled successfully" (the only warnings are the pre-existing Supabase Edge-runtime ones), `ƒ /api/business-os/credits/history` built as a dynamic route, `/business-os` built, **exit 0**. Afterwards the junction was removed as a link (`cmd rmdir`), a scan found no link left, and only then was the export deleted; the shared `node_modules` was checked intact (841 entries before and after). The worktree's own `.next` was not touched. A first attempt was stopped by the 30-minute tool limit while compiling (the machine was running other sessions' Jest runs); the re-run used a longer limit. A first `mklink` attempt mis-quoted its target; that broken link was removed with `rmdir` before anything ran.

**Gates on the final diff**

| Gate | Result |
|---|---|
| New + touched suites (28) | **28 / 28 suites, 648 / 648 tests** |
| `featureFlags.test.ts` | the 9 new tests pass; **6 failures are pre-existing on HEAD** (the `isThreadBasedAgentCreationEnabled` / `getFeatureFlags` thread tests set `USE_THREAD_BASED_AGENT_CREATION` while the reader reads `NEXT_PUBLIC_USE_THREAD_BASED_AGENT_CREATION` — the same mismatch at HEAD, untouched by this slice) |
| `npm run test:bos-entitlements` | **103 / 103 suites, 2,205 / 2,205 tests**; `enforcementPoints.test.ts` diff empty |
| The five 6a suites | `git diff --stat` on them: **empty** (unedited) and green |
| `npx eslint` on every changed + new `.ts` / `.tsx` | 0 new: `featureFlags.test.ts` has **45 errors, identical to HEAD** (its existing `require()` calls; the new tests use `await import` and add none); `LanguageContext.tsx` 1 pre-existing warning; every other file clean |
| `npm run lint:hooks` | clean (exit 0) |
| `next build` | **exit 0** (above) |
| `npx tsc --noEmit` (6 GB heap) | **2,091 vs the 2,092 baseline — 0 new**; by file + code the only difference is one pre-existing generated `.next/types/…/plugins/user-status` entry no longer reported. 0 errors in any new or touched file |

---

## 5. Part 7b — the typical range

Sequenced after 7a, its own PR. D-o and D-r decided (2026-10-02): at least 10 of the owner's own completed examples; the middle 80% (p10–p90), whole credits rounded outward; "less than 1" below one credit; the last 90 days; the five most frequent action types; the sentence reuses the diary label (**D-r A**) and reads "up to N" when the low end rounds to 0.

### 5.1 Approach

Only the **first page's summary** of the 7a route changes: it gains `ranges`. No new route, no new client fetch, no migration, no index (SQ-36).

### 5.2 The read (SQ-35, SQ-36)

On `BusinessOsCreditOwnerReadRepository`:

- `OWNER_RANGE_COLUMNS = 'service, action_type, credits'` (⊆ GRANT, tested).
- `listSucceededChargesSince(accountId: string, sinceIso: string, ceiling = OWNER_CREDIT_READ_LIMITS.RANGE_CEILING /* 2,000 */): Promise<RepositoryResult<OwnerCeilingResult<OwnerRangeRow>>>` — `.eq('user_id', accountId).eq('kind', 'charge').eq('outcome', 'succeeded').gte('created_at', sinceIso).order('created_at', { ascending: false }).range(0, ceiling - 1)`. `sinceIso` = now − 90 days as an ISO string: a boundary, not a key, so millisecond precision is harmless (documented). No filter or order on `service`. Never throws.

### 5.3 The range module

New **`lib/business-os/credits/ownerCreditRange.ts`** (`server-only`). Its header states the row rule and why it differs from the operator report's (SA condition 6): **succeeded charges only** (a failed action usually stops early and would make the range optimistic), **fallback-priced rows included** (owners hold no grant on `is_fallback_priced`; the case is defect-only, FR-12h; the range describes what the owner was charged), **adjustments ignored** (none exist; revisit with 4c), **90 days**, **ceiling 2,000** (newest first; reaching it computes over those rows and logs at `info`). Revisit trigger: an account above ~5,000 charge rows in 90 days, or the first non-AI bulk service.

`readOwnerCreditRanges(accountId, deps, now, log): Promise<CreditHistoryRange[]>`:

1. Read (§5.2). Each row's effective (service, action type) comes from a new `effectiveFields.ts` helper `chargeIdentity(row: { service; action_type })` — so no `.service` is read outside the resolver (V-7; **Q-3**); its label from `diaryLabelFor`. Rows whose label does not resolve are dropped (an undeclared pair cannot be named).
2. Group by (effective service, action type); keep groups with ≥ `FEW_EXAMPLES_BELOW` (10) examples; sort by count descending, ties by action type ascending; keep the first five.
3. Per group `p10 = percentileCont(credits, 0.1)`, `p90 = percentileCont(credits, 0.9)` (C-S7-3: direct calls; no change to `percentiles.ts`), then the display rule.
4. Errors: the range read failing **omits** `ranges` and logs at `warn`; the page is still answered (**Q-8**).

**Display rule** — pure, import-free, in `creditDisplay.ts`: `typicalRangeOf(p10, p90)`:

- `p90 < 1` → `{ lessThanOne: true }` ("less than 1"; **Q-7** — SA wrote "high ≤ 1"; strict `< 1` keeps an exact 1.0 from reading "less than 1");
- else `low = ⌊p10⌋`, `high = ⌈p90⌉`; if `high ≤ low` → `high = low + 1` (FR-27: never one number); `{ low, high }`.
The client words it: `low === 0` → "up to {high}" (D-r); otherwise "{low}–{high}".

Payload — `CreditHistorySummary.ranges?: CreditHistoryRange[]`, with `CreditHistoryRange = { area: string | null; label: CreditHistoryLabel } & ({ lessThanOne: true } | { low: number; high: number })`. Never the percentiles, the example count or raw credits. Computed on the first page only.

### 5.4 The panel

In the summary, under the split: one sentence per range, then the caption "From your own last 90 days — your past use, not a price." — shown only when at least one range exists; nothing at all (no placeholder) when none qualifies.

| Key | en | he (draft) | es (draft) |
|---|---|---|---|
| `credits.range.between` | {label}: usually {low}–{high} credits | {label}: בדרך כלל {low}–{high} קרדיטים | {label}: normalmente {low}–{high} créditos |
| `credits.range.up_to` | {label}: usually up to {high} credits | {label}: בדרך כלל עד {high} קרדיטים | {label}: normalmente hasta {high} créditos |
| `credits.range.less_than_one` | {label}: usually less than 1 credit | {label}: בדרך כלל פחות מקרדיט אחד | {label}: normalmente menos de 1 crédito |
| `credits.range.caption` | From your own last 90 days — your past use, not a price. | לפי 90 הימים האחרונים שלך — השימוש שלך בעבר, לא מחיר. | Según tus últimos 90 días: tu uso pasado, no un precio. |

he / es need native review. The numbers are formatted with `Intl.NumberFormat(language)`; no figure is written into a dictionary string.

### 5.5 Files — 7b

| File | Action | Reason |
|---|---|---|
| `lib/repositories/BusinessOsCreditOwnerReadRepository.ts` + test | modify | `OWNER_RANGE_COLUMNS`, `listSucceededChargesSince`, `RANGE_CEILING` |
| `lib/business-os/credits/effectiveFields.ts` + test | modify | `chargeIdentity` |
| `lib/business-os/credits/ownerCreditRange.ts` + `__tests__/ownerCreditRange.test.ts` | create | §5.3 |
| `lib/business-os/credits/creditDisplay.ts` + test | modify | `typicalRangeOf` |
| `lib/business-os/credits/ownerCreditHistory.ts`, `creditHistoryTypes.ts`, `ownerCreditUsageDeps.ts` + the 7a payload / builder tests | modify | `ranges` on the first page; deps |
| `components/business-os/CreditHistoryPanel.tsx` + render test | modify | §5.4 |
| `lib/business-os/LanguageContext.tsx` | modify | 4 keys × 3 |
| `ownerCreditSurface.guard.test.ts`, `serviceColumn.guard.test.ts`, `creditFigures.fromConfig.guard.test.ts` | modify | New file in the owner surface; new method named; `SOURCES` if it names a builder |
| `docs/architecture/BUSINESS_OS_CREDIT_PRICING.md` | modify | §5 / §6: the owner-side range rule and its revisit trigger; Change History |

### 5.6 Task list — 7b

| # | Task | Estimate |
|---|---|---|
| ⬜ **T-b0** | Branch from RM after 7a merges; confirm with `git branch --show-current`; baselines | 0.05 d |
| ⬜ **T-b1** | Repository read + tests (columns ⊆ GRANT, `.eq('user_id')`, `kind` / `outcome` / `created_at` predicates, ceiling, no `service` filter) | 0.25 d |
| ⬜ **T-b2** | `chargeIdentity`; `ownerCreditRange.ts` with its header; tests (§7) | 0.3 d |
| ⬜ **T-b3** | `typicalRangeOf` + tests | 0.1 d |
| ⬜ **T-b4** | Payload (`ranges`, first page only); payload key-set / banned-word / value scans updated | 0.15 d |
| ⬜ **T-b5** | Panel section, 4 keys × 3, render tests en / he / es | 0.25 d |
| ⬜ **T-b6** | Guards, docs, gates, `test:bos-entitlements` green with `KNOWN_NON_GATE_IMPORTERS` unchanged; handover | 0.15 d |
| | **Total 7b** | **≈ 1.25 d** |

Within SA's 1–1.25 d.

---

## 6. What owners see

### After 7a

| Owner | Panel |
|---|---|
| Founding Partner, anchor the 14th | "Credit history"; "This period · 14 Sep – 13 Oct"; "63.4 credits used"; "41.2 by you · 22.2 automatic"; lines such as "Today 09:14 · Chat · Answered a question · You · 2.1", "Today 07:00 · Briefing · Wrote your daily briefing · Automatic · 0.2", "Yesterday 16:20 · Enquiries · Picked a reply to a new enquiry · Automatic · less than 0.1", "30 Sep 07:00 · Briefing · Wrote your daily briefing · Automatic · Didn't complete · 0.2"; footnote; "Show more" past 50 lines |
| Setting up the business | "Website · Set up your business" (F7-9, shown to the user with D-q) and "Setup · Replied in your setup conversation" |
| Trial | "Since your trial began", the trial's lines and total from the anchor (matches the card's "N left of 2,000 in total") |
| No plan row | "This month", lines and total as normal |
| Over the allowance | The true total ("32,260.4 credits used"); no "left", no warning; the card still says "0 left" |
| Nothing used | "Nothing has used credits yet this period." and the D-b sentence |
| Unreadable | "Could not load your credit history" |
| The card | Unchanged, plus the "Credit history" link |

Lines from before charging started (2026-09-29 ~15:40 UTC) do not appear, nor do uncharged chat v1 / v2 turns (KI-20, KI-6); a line does not name the business it ran for (KI-19).

### After 7b

Under the split, up to five sentences, e.g. "Answered a question: usually 1–3 credits", "Wrote your daily briefing: usually less than 1 credit", "Checked your business for insights: usually up to 1 credit", and the caption. Nothing for action types with fewer than 10 completed examples in 90 days (images will usually show nothing).

---

## 7. Test plan

| Check | Part | How | Pass criterion |
|---|---|---|---|
| Card unmoved | 7a | the five 6a suites, **unedited** | Green; `git diff --stat` shows 0 lines on them |
| One window | 7a | `ownerCreditWindow.test.ts` | Three kinds; `ledger` predicate and `key` per kind; card `used` = window `used`; the diary summary `used` = the card payload's `used` for the same deps |
| Happy path | 7a | `route.test.ts` | 200, `Cache-Control: private, no-store`, summary + 50 lines + `nextCursor` on page one; page two lines only |
| 401 | 7a | same | No session → 401; no repository, window or decode call |
| Invalid input | 7a | same | Malformed cursor (bad base64url, non-JSON, extra key, wrong regex, > 512) → 400 with the error format; nothing read |
| Hostile cursor | 7a | same + repository | `t` / `w` with `,`, `(`, `)`, `or=`, `"` → 400 at the route; the repository refuses the same values without a query |
| Tenant isolation | 7a | route + repository | `?accountId=<other>&userId=<other>` ignored — the caller's own lines; every query `.eq('user_id', caller)`; ledger only on the RLS client; service role only in the existing 6a wiring (source guard) |
| Restart | 7a | builder + route + render | `w` of a previous period / another kind → `{ restart: true }`; the panel reloads page one; a second restart shows the error state |
| Strings end to end | 7a | exact-string fake PostgREST | Microsecond keys and `created_at` passed verbatim; a truncated value matches nothing; same-millisecond rows across a page boundary neither skipped nor repeated |
| Paging | 7a | builder | 120-line fixture → 50 / 50 / 20, newest first, `(created_at, id)` order, `nextCursor` null on the last |
| Reconciliation (AC-38, C-S7-3) | 7a | `ownerCreditHistory.reconcile.test.ts` | Over all pages of a fixture with charges, a failed charge, a correction whose original is on an earlier page and a non-`ai` row, the exact sum of line credits = the window's `used` (6 dp) |
| Corrections (SQ-32) | 7a | builder | Own signed line; area / label / trigger of its charge; original fetched when off-page; unresolved → `label`, `area`, `who` null, still counted, `warn` |
| Other service (AC-35) | 7a | builder | A `notification_email` charge → `area` null, `label` null, `who` from its trigger, counted |
| Labels (N-11, SQ-33) | 7a | `effectiveFields.test.ts` | `diaryLabelFor` only for `AI_CHARGE_SERVICE` + a declared type; an `ai` action type under another service → null; returns the D-q label for `onboarding_turn` |
| Payload allow-list (SQ-38) | 7a | `ownerCreditHistory.payload.test.ts` | Exact recursive key set for page one, page two and restart; banned-word scan on keys (6a rule incl. the `ai` segment); value scan of the serialised payload for the same words, label strings excluded; none of the absent identifiers |
| Columns ⊆ GRANTs | 7a | repository test | `OWNER_DIARY_COLUMNS` parsed and found in the charges' `authenticated` GRANT; equals SA's list |
| Formatter (D-m) | 7a | `creditDisplay.test.ts` | 2.1, 0.2, 0.04 → "less than 0.1", 250 → "250" (no ".0"), −12.5, −0.04 → "−less than 0.1" (never −0.0), 0; summary parts add up to the shown total in a sweep |
| Area names | 7a | `creditAreaNames.test.ts` | Every `BOS_LLM_AREAS` code named in en / he / es; no dead `credits.area.*` |
| Render — states × languages | 7a | `CreditHistoryPanel.render.test.tsx`, real `translations` | Loading; error (500 and malformed payload); empty period; empty trial; monthly with `endsBefore`; monthly ungauged ("since"); trial; no plan row; over the allowance (true total, no "left" / warning / paused / upgrade); restart; "Show more" appends; correction; "Other activity"; "Didn't complete"; "less than 0.1"; Today / Yesterday in the business time zone — each in en, he, es; he `dir="rtl"` and the `side` of Q-1; no `\bAI\b|\bIA\b|token|\$|cost|dollar|pilot` text in any language |
| Card link | 7a | `UsageCard.historyLink.render.test.tsx` | Link in gauged, trial and no-allowance states; absent while loading and on error; mount makes one fetch (the card's); opening the panel makes the first history fetch |
| No timers, no subscription | 7a | surface guard | Planted samples matched; none in the panel; the panel never names the signal |
| Entitlements | 7a, 7b | `npm run test:bos-entitlements` | Green; `KNOWN_NON_GATE_IMPORTERS` diff empty |
| Range rules (AC-39) | 7b | `ownerCreditRange.test.ts` | 9 examples → nothing; 10 → a range; failed charges not counted; adjustments ignored; undeclared pair dropped; six qualifying types → the five most frequent, ties by action type; ceiling → computed over 2,000 + `info`; read error → no `ranges` + `warn` |
| Display rule | 7b | `creditDisplay.test.ts` | p90 0.8 → less than 1; p10 0.3 / p90 2.4 → 0–3 (worded "up to 3"); p10 1.2 / p90 1.4 → 1–2 (never one number); p10 2 / p90 2 → 2–3; p90 exactly 1 → 0–1 ("up to 1") |
| Range render | 7b | panel render test | en / he / es sentences with the label; caption only with ≥ 1 range; nothing at all with none; never a single number; no "price" wording except the caption's "not a price" |
| Types / lint / build | both | `npx tsc --noEmit` vs T-a0 baseline; `npx eslint` on changed files; `npm run lint:hooks`; `npm run typecheck:bos-llm`; `npm run check:bos-llm-literals`; `next build` (scratch export, as 6b — no worktree, no junction removal in place) | No new error; clean; exit 0 |
| Wider suites | both | `npm test -- lib/business-os app/api/business-os components/business-os lib/repositories` | No new failure vs baseline |
| **Manual (QA)** | 7a | Dashboard signed in as a test account | Card link opens the panel from the inline end; lines newest first; the total equals the **Costs & credits** tab's credits for the same account and period (`/admin/business-os-llm`); a briefing / insight line shows "Automatic"; a chat answer run while the panel is closed appears on the next open; nothing refreshes while open; he and es checked visually (RTL, labels); network tab shows no periodic request; "Show more" on an account with > 50 lines (R-1) |
| Manual (QA) | 7b | same | Ranges appear for action types with ≥ 10 examples; caption; none for rare types |

---

## 8. Guardrails

- No migration, no index, no column, no grant, no function. 20261016 reserved for 4c.
- No service-role read of ledger rows; the only service-role calls remain the anchor and the pure period function in `ownerCreditUsageDeps.ts`. No read of `cost_usd` or `is_fallback_priced`.
- Never reads `audit_trail` or `token_usage`.
- No account id from the request; only `cursor` is read.
- Never shows prompts, owner text, model output, error messages, tokens, dollars, cost or model; never "AI credits".
- No filter, order or grouping on the raw `service`; no label lookup by action type alone; no non-AI label built.
- The diary's window and total come from the card's window function; no second period computation.
- No change to the card's figures, payload, states or refresh triggers; only the link.
- No warning, pause, upgrade, grant or "left" wording or logic in the diary (slices 8, 10, 11).
- No timer, no polling, no signal subscription in the panel.
- `aiActionAudit.ts`, `effectiveFields.ts`, `callCatalog.ts` and the builder never in a client bundle.
- Nothing imported from `lib/business-os/entitlements/` by any new file; `KNOWN_NON_GATE_IMPORTERS` unchanged.
- The range is never one number, never a price, hidden below 10 examples. 7b merges after 7a. Enforcement stays `shadow`. `bos-llm-call-standards` not engaged.

---

## 9. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | The keyset `.or()` with quoted microsecond timestamps is proven only against a fake; real PostgREST quoting is not exercised by Jest. And few live accounts have > 50 lines yet (≈ 116 actions per 30 days; charging began 2026-09-29) | Strict regex before interpolation; double-quoted values; the QA manual check on the busiest test account; if none has > 50 lines at QA time, SA rules between running real actions on a test account until it crosses 50 lines (real AI spend, test account only) and deferring the live paging check to the first account that does (Q-9) |
| R-2 | he / es strings and the 16 labels not native-reviewed | Release precondition (D-p, D-q); the list is handed to the user at the diff review |
| R-3 | `LanguageContext.tsx` is large and busy (30 + 4 keys × 3) | One contiguous block per language; rebase before RM |
| R-4 | The extract changes the card by accident | Pure extract; five 6a suites unedited and green; `git diff --stat` proof |
| R-5 | A busy automatic day pushes the owner's own lines down (D-j accepted) | Accepted; a filter only if owners ask |
| R-6 | A period rolls over while the panel is open → "Show more" restarts | By design (`restart`), tested |
| R-7 | Business time zone `UTC` until `user_preferences` arrives (6a R-7) | Accepted; re-renders when it resolves |
| R-8 | 7b: images rarely reach 10 examples, so the action most in need of a range shows none (D-o trade-off) | Accepted by the user with D-o |

---

## 10. Open questions for SA

| # | Question | Dev proposal |
|---|---|---|
| Q-1 | **`Sheet` sides are logical, not physical (corrects F7-11).** `side: 'right'` is `end-0` with `rtl:` slide variants, and `<html dir>` is `rtl` in Hebrew (V-10). So `side="right"` already opens from the **inline end** (right in en / es, left in he) — SA's intent. `side={isRTL ? 'left' : 'right'}`, as the three drawers do, would open it on the **right** in Hebrew too (inline start) | Use `side="right"` unconditionally (SA's intended inline-end), with `dir` on the content; render test pins the prop; QA confirms visually in he. Alternative: copy the drawers' expression for consistency with them (opens on the right in all languages). SA to choose |
| Q-2 | Cursor `w` carries the window kind as a prefix (`m:` / `c:` / `t:` + key), a precision on SA's "`w` the window key" | Accept: a trial and a monthly window can in principle share a key string (a trial's first period starts at its anchor), and the prefix makes "the window changed" exact at no cost |
| Q-3 | 7b grouping needs each row's service, but `serviceColumn.guard` forbids `.service` outside `effectiveFields.ts` | A small `chargeIdentity(row)` in `effectiveFields.ts` (charges answer for themselves), used by the range module; the range read selects `service, action_type, credits` with `kind = 'charge'` |
| Q-4 | An unresolved correction: "Other activity" or "Correction to: Other activity"? | "Correction to: Other activity" — a negative line with no correction marker would read like a refund |
| Q-5 | Strings D-p does not cover: trial empty state, the ungauged monthly period line, "Show more", "less than 0.1", Today / Yesterday, the period line format | Drafted in §4.9 (en; he / es for native review); the trial empty state is "Nothing has used credits yet." |
| Q-6 | The summary split at one decimal: share out by largest remainder so "by you" + "automatic" = the shown total? | Yes — the 6a D-c rule carried to D-m's precision |
| Q-7 | Range "less than 1": SA's "high ≤ 1" vs strict `p90 < 1` | Strict: a p90 of exactly 1.0 reads "up to 1", not "less than 1" |
| Q-8 | A failed range read on the first page | Omit `ranges`, log `warn`, answer the page (the ranges are optional; showing nothing is not a false figure) |
| Q-9 | QA's "Show more" check if no live account has > 50 lines yet (R-1) | Seed real actions on a test account, or defer the live paging check to the first account that crosses 50 lines — SA to rule |
| Q-10 | `KNOWN_NON_GATE_IMPORTERS`' `why` for `ownerCreditUsage.ts` mentions only the card; the window now also serves the diary | Leave the entry byte-for-byte unchanged (SA condition 3); the file header records the second consumer |

---

## 11. Logging, deprecated systems and follow-ups

**`console.*` in touched files:** none. Counted in all 13 existing files this plan touches (`ownerCreditUsage.ts`, `ownerCreditUsageDeps.ts`, `BusinessOsCreditOwnerReadRepository.ts`, `creditDisplay.ts`, `effectiveFields.ts`, `percentiles.ts`, `aiActionAudit.ts`, `LanguageContext.tsx`, `UsageCard.tsx`, `components/ui/sheet.tsx`, `callCatalog.ts`, `app/api/business-os/usage/route.ts`, `lib/repositories/index.ts`): **0** each. Nothing to flag or convert. New files use `createLogger` (server) or the client Pino logger (panel), never `console.*`.

**Deprecated systems:** none touched.

**Follow-ups recorded (not in slice 7):**

- Earlier periods in the diary (D-k option B), once a period has rolled over for a real owner.
- A "You / Automatic" filter (D-j option C), only if owners ask.
- One line per group for bulk work (D-l), with the first non-AI bulk service.
- 7b read revisit trigger (SQ-36): > ~5,000 charge rows per account in 90 days, or the first bulk service.
- Mirrored drawers in Hebrew (SA Q-1, W7-1): the credit panel copies the three existing drawers' `side={isRTL ? 'left' : 'right'}` and so opens on the physical right in every language. If the product ever wants drawers mirrored in Hebrew, all four change together.
- Binding on 4c (SQ-32): adjustments keep their original's period; if 4c changes that, the diary and the card's split need re-review.

---

## SA Review Notes

### SA Workplan Review (2026-10-02)

**Reviewed by SA — 2026-10-02**, against the requirement's "SA review — slice 7 scoping (2026-10-02)" (binding), §13 D-i to D-r (decided), and the as-built code at `894150f5` in this worktree: `components/ui/sheet.tsx`, the three existing drawers, `LanguageContext.tsx:11309-11313`, `ownerCreditUsage.ts`, `creditPeriod.ts` and its test, `serviceColumn.guard.test.ts`, `ownerCreditSurface.guard.test.ts`, `creditFigures.fromConfig.guard.test.ts`, `enforcementPoints.test.ts`. Review only; no code.

**Status:** ✅ **Approved with conditions.** **7a implementation may start** once the conditions are folded into §4 (task T-a0). 7b's plan is approved as written, with the Q-7 rule below; it is built on its own branch after 7a merges. Estimates accepted: 7a ≈ 3.75 d, 7b ≈ 1.25 d. No migration.

#### Scoping conditions 2–5: verified

| Condition | Verdict | Where |
|---|---|---|
| 2 — window function named; card consumes it, 6a suites unedited; exact strings end to end; repository method, `OWNER_DIARY_COLUMNS`, grant test; types file imports nothing from entitlements | ✅ Met | §4.2 (pure extract, five suites unedited, `git diff --stat` proof), §4.4 table + exact-string fake tests, §4.3, §4.6 (`creditHistoryTypes.ts` imports nothing at all) |
| 3 — `test:bos-entitlements` green, `KNOWN_NON_GATE_IMPORTERS` unchanged; surface guard extended; `serviceColumn` guard covers the new method | ✅ Met | §4.11. Checked: `serviceColumn.guard.test.ts` walks every file under `lib/business-os/credits/` plus the owner repository, so new files are covered automatically; the named assertion Dev adds is a good belt-and-braces |
| 4 — route, builder, render tests incl. every state, RTL, `restart` | ✅ Met | §7 (side assertion follows the Q-1 ruling below) |
| 5 — no migration; service role only in the existing 6a wiring | ✅ Met | §4.6 deps (second export in `ownerCreditUsageDeps.ts`, no new file naming the plan repository), §8 |
| 6 — 7b range module header | ✅ Met | §5.3 (the header says "§5.8"; there is no §5.8 — fix the reference to §5.3) |

#### Rulings on Q-1 to Q-10

| # | Ruling |
|---|---|
| **Q-1** | **Dev is right on the facts; F7-11 was wrong.** `sheet.tsx` positions are logical (`right` → `end-0`, `left` → `start-0`, with `rtl:` slide variants), and `LanguageContext` sets `<html dir>`. **Ruling: copy the existing drawers' expression — `side={isRTL ? 'left' : 'right'}` with `dir` on the content.** All three existing drawers (`MoneyDetailDrawer`, both CRM drawers) use it and therefore open on the physical right in every language. `MoneyDetailDrawer` lives on the same Business OS surface and says in its own comment that drawers must match "class for class". A credit panel sliding in from the opposite side in Hebrew would be the only one that does, and it is not worth a new convention for one panel. This supersedes SA's "inline-end" wording in SQ-37. If the product later wants mirrored drawers in Hebrew, all four change together (record as a follow-up in §11). The render test pins the prop per language |
| **Q-2** | **Accepted.** `w` = `m:` / `c:` / `t:` + exact key; plain string equality decides `restart`. The prefix is regex-checked as part of `w` |
| **Q-3** | **Accepted**, narrowly. `chargeIdentity(row: { service: string \| null; action_type: string \| null })` lives in `effectiveFields.ts` and is documented **charges only**. Its callers pass rows read with `kind = 'charge'`. The range module reads no `.service` itself (the guard proves it). A unit test shows it returns the row's own pair, and the range test shows an adjustment-shaped row (NULL service) yields no label and is dropped |
| **Q-4** | **Accepted:** "Correction to: Other activity". `who` stays null, so no "You" / "Automatic" |
| **Q-5** | **Accepted** as drafted. The new en strings and all he / es strings go on the native-review list handed to the user at the diff review (release precondition, §3) |
| **Q-6** | **Accepted:** largest remainder at tenths, so the shown parts add up to the shown total; ties as in 6a. A sweep test as in §7 |
| **Q-7** | **Dev is right; SA's SQ-35 wording is corrected.** "less than 1" **only when `p90 < 1`**. At exactly 1.0, ⌈p90⌉ = 1 and the rule gives `0–1`, worded "up to 1" (D-r). "less than 1" would be false for an action whose top typical cost is exactly 1. Recorded as a dated SA note in the requirement |
| **Q-8** | **Accepted:** a failed range read omits `ranges`, logs `warn` with the error code (never the figures), and still answers the page. A test covers it |
| **Q-9** | **Ruled in two parts. No live write is needed, so nothing needs the user's approval.** (a) **The real-PostgREST keyset (the actual R-1 risk) is checked read-only on any account with ≥ 3 lines.** QA (or Dev at T-a11) runs a one-off, uncommitted scratch script, outside the repo. It builds the owner repository on a read-only client and walks one test account's current window with `limit = 1` until `hasMore` is false. It then checks that the walk returns exactly the rows of a single `limit = 100` read, in the same order, with no repeat and no skip. This exercises the real `.or()` quoting with microsecond keys against live PostgREST. If the script uses the service-role key, it is read-only, it is scoped by the repository's own `.eq('user_id', …)`, and it is never committed. (b) **The live "Show more" click in the UI is deferred** to the first account that crosses 50 lines in a period, recorded as an owed QA check. The panel's append behaviour is already covered by render tests. **Recommendation, not a requirement:** if the user wants the click checked before release, one way is to run ordinary AI actions on a test account until it passes 50 lines. That is real (small) AI spend and needs the user's go-ahead. SA does not require it |
| **Q-10** | **Accepted:** `KNOWN_NON_GATE_IMPORTERS` is byte-for-byte unchanged. Its `why` for `ownerCreditUsage.ts` stays true: display only, `getSnapshot`, never `check()`. The second consumer is recorded in the file header, and the card-only wording of the `why` is accepted naming debt. The 7a and 7b diffs show zero lines in `enforcementPoints.test.ts` |

#### Other findings

1. **`creditFigures.fromConfig.guard.test.ts` — the finding is correct** (V-9). `\bownerCreditUsage\b` matches the import path `./ownerCreditUsage` in `ownerCreditHistory.ts`, so the completeness test would fail without the `SOURCES` entry. The panel entry is right too. **Also add the new route `app/api/business-os/credits/history/route.ts`**, for parity with `app/api/business-os/usage/route.ts` (listed under "what builds the payloads"). This is the figure guard, not the importer registry; editing it is fine. **Trap for 7b:** this guard catches `2000` typed as `2000`, `2,000` or `2_000` in any listed file (the trial figure). Keep `RANGE_CEILING` in the repository (not listed), as §5.2 already does. If `ownerCreditRange.ts` is ever added to `SOURCES`, its code must not contain the literal.
2. **`creditPeriod.test.ts`'s "no `Date` from a key" guard.** Exporting `displayInstantIso` must extend `withoutDisplayMaths` by exactly that one named function. The `it.each` list (today `creditPeriod.ts`, `ownerCreditUsage.ts`) **gains `ownerCreditHistory.ts` and `creditHistoryCursor.ts`**, so neither builds a `Date` from a key, an anchor or `created_at` (only `displayInstantIso` does, for display).
3. **One source for `endsBefore` / `resetsOn`.** §4.6 step 6 says "the card's `resetsOn` rule", but §4.2 keeps that rule card-only. Do not copy the expression. Either the window carries `resetsOn` (computed once with the W6-5 rule) and the card passes it through, or one small exported helper is called by both. Whichever is chosen, the five 6a suites stay unedited.
4. **The 6a card render test and the new link.** V-14 says the 6a test scans the card's text. The link adds "Credit history" to the card's DOM. Dev's claim that the suite passes unedited must be proven at T-a1/T-a11, not assumed. If it fails only because of the link's text, the Dev comes back to SA. Do not edit that suite to pass.
5. **Keyset filter.** The quoted `.or()` string is accepted. The id tie-break compares UUIDs with `lt`, which is consistent with `.order('id', { ascending: false })` because both use Postgres uuid ordering. Add one fixture test with two rows in the same microsecond `created_at` to pin it.

#### Conditions (fold into §4 at T-a0; SA checks them at code review)

1. Q-1: `side={isRTL ? 'left' : 'right'}` + `dir`; the render test pins it; a §11 follow-up records "mirrored drawers in Hebrew — all four together, if ever wanted".
2. Q-7: `typicalRangeOf` uses `p90 < 1`; the §7 display-rule row keeps "p90 exactly 1 → up to 1".
3. `SOURCES` gains `ownerCreditHistory.ts`, `CreditHistoryPanel.tsx` **and the history route**; no literal ceiling in any listed file.
4. `creditPeriod.test.ts` guard: exclusion extended only by `displayInstantIso`; `it.each` gains the builder and the cursor module.
5. `endsBefore` and the card's `resetsOn` come from one source (finding 3).
6. Q-9 (a) read-only keyset walk recorded in the QA report, with results; (b) the live "Show more" click recorded as owed.
7. Fix the "§5.8" reference in the header.
8. The 6a card suite passes unedited, or the Dev returns to SA (finding 4).

#### Business question for the user

None. The only taste call (Q-1, which side the panel opens from in Hebrew) is ruled for consistency with the product's existing drawers and can be revisited with them.

#### Approval

- [x] Workplan approved — 7a implementation may proceed with conditions 1–8 folded in at T-a0.
- [x] 7b plan approved (its own branch after 7a merges; Q-7 rule applies).

### SA Code Review (2026-10-02)

**Code Review by SA — 2026-10-02**, of slice 7a as implemented (uncommitted) on `feature/business-os-credit-deduction-slice-7`. Read: the full diff of the 18 modified files and the 13 new ones (route and its test, cursor, builder, types, the window extraction, the repository method, formatter, `displayInstantIso`, `diaryLabelFor`, the panel, the card link, dictionary keys, guards, docs). The requirement MD changes belong to the BA and were not reviewed. Static review only: nothing run that writes, no build, no DB.

**Status:** ✅ **Code Approved with conditions.** No High findings. The two conditions are a pre-PR `next build` and QA's live read-only keyset walk (W7-6). Nothing else blocks the user's diff view.

#### Workplan conditions W7-1 to W7-9

| # | Verdict | Evidence |
|---|---|---|
| W7-1 side | ✅ | `CreditHistoryPanel.tsx`: `side={isRTL ? 'left' : 'right'}` + `dir`, as the three drawers; render test pins `data-side` per language |
| W7-2 | n/a (7b) | — |
| W7-3 `SOURCES` | ✅ | `creditFigures.fromConfig.guard.test.ts` gains the route, the builder and the panel; no literal figure in any of them |
| W7-4 Date guard | ✅ | Exclusion extended by `displayInstantIso` only; `it.each` gains the builder and the cursor; `KEY_TO_DATE` also knows `created_at` / `createdAt` (DV-7), with planted cases |
| W7-5 one source | ✅ | `ownerCreditUsage.ts` `computeOwnerCreditWindow` computes `resetsOn` once; the card passes it through and the history's `endsBefore` is `window.resetsOn` |
| W7-6 live keyset walk | ⏳ QA | Owed in the QA report (condition C-2 below) |
| W7-7 | ✅ | Header reference fixed |
| W7-8 6a suites | ✅ | `git diff --stat` on `ownerCreditUsage.test.ts`, `.crossCheck`, `.payload`, `app/api/business-os/usage/**`, `UsageCard.render.test.tsx`, `creditDisplay.test.ts`, `enforcementPoints.test.ts` and `components/ui/sheet.tsx`: **empty** (verified by SA) |
| W7-9 tie-break | ✅ | Two same-microsecond rows paged by id, in `BusinessOsCreditOwnerReadRepository.diary.test.ts` (an evaluating fake) |

#### SQ-29 to SQ-38 and CLAUDE.md rules

- **Route (`app/api/business-os/credits/history/route.ts`)** ✅
  - `getUser()` first (`:61`) and 401 with nothing read.
  - Only `cursor` is read (`:67`); Zod first (`:52-54`), then the strict decoder; 400 in the CLAUDE.md format with the development guard (`:72-79`).
  - Pino child logger with `correlationId` (`:57-58`); the info line carries counts only, never labels or figures (`:98-103`).
  - `force-dynamic`, `no-store` on every answer; no audit entry; no service role and no entitlements import (pinned by the guard).
- **Rule 1 / rule 4 (repository only, `user_id`)** ✅ `listLedgerRowsForWindow` (`BusinessOsCreditOwnerReadRepository.ts`):
  - runs on the caller's RLS client with `.eq('user_id', accountId)`;
  - takes the window predicate from the same `OwnerLedgerWindow` value as the totals read;
  - reads `limit + 1` rows, with the limit capped at 100;
  - never filters on `service` (named guard assertion);
  - selects only `OWNER_DIARY_COLUMNS`, which equals SA's list and is tested against the parsed GRANT.
- **Keyset `.or()` safety (SQ-29)** ✅ A cursor value can reach `.or(...)` only through four layers:
  1. Zod length 1–512 at the route;
  2. a base64url alphabet check;
  3. a `.strict()` schema with full-anchored patterns (`w` = `[mct]:` + timestamptz, `t` = timestamptz, `i` = UUID);
  4. the same timestamptz and UUID patterns re-checked in the repository before interpolation.
  - The patterns admit only digits, `-`, `:`, `.`, `T`, `Z`, `+` and hex. So no comma, parenthesis, quote or `or=` can be smuggled in, and the hostile-cursor tests (route and repository) prove it with no query made.
  - The period key goes through `.eq` / `.gte`, never the or-string.
- **Exact strings (SQ-29, condition 2)** ✅ `t` is `last.created_at` verbatim, `w` is `historyWindowTag(kind, key)` on the exact key, and the restart check is plain string equality. Display goes through `displayInstantIso` only.
- **Effective fields and labels (SQ-32, SQ-33, N-10, N-11)** ✅
  - Each line is resolved through `resolveEffectiveFields`.
  - Originals on the page are reused; missing ones are fetched with `findChargesByActionIds` (same account).
  - An unresolved correction is still a line and still counted, with a `warn`.
  - `diaryLabelFor` applies only for `AI_CHARGE_SERVICE` plus a declared type, and returns a copy in the local `DiaryLabel` type.
- **`server-only` boundaries** ✅
  - `ownerCreditHistory.ts` and `effectiveFields.ts` carry the marker; checked that `effectiveFields`' other consumers (the report, the leak check, their admin and cron routes) are all server code, and the admin page's type mirrors only mention it in comments.
  - The new guard scans every `'use client'` file under `app components hooks lib` for imports of `aiActionAudit`, `effectiveFields`, `callCatalog` and `ownerCreditHistory`, with a planted case.
- **Entitlements** ✅
  - `creditHistoryTypes.ts` imports nothing; the builder, cursor, route and panel import nothing from the module (guard).
  - `enforcementPoints.test.ts` is byte-unchanged, and `ownerCreditUsage.ts` still imports exactly its three registered symbols.
- **Payload (SQ-38)** ✅ The exact recursive key set holds for page one, later pages and restart, plus the banned-word scan on keys (including the `ai` segment) and a value scan with labels excepted. No `user_id`, `action_id`, `group_id`, raw `service` or `action_type`, `period_start` or raw `created_at`.
- **Reconciliation (C-S7-3)** ✅ The summary is the window's `used`. A cross-page fixture (charges, a failure, a correction whose charge is on another page, another service, plus a trial spanning two periods) proves the lines add up exactly.
- **Rule 3 (logging)** ✅ No `console.*` in any new or touched file. The panel uses the client `createLogger`, as the card does.
- **Rule 6 (TypeScript)** ✅ No `any`. The `as unknown as OwnerDiaryRow[]` follows the sibling methods' pattern on an untyped PostgREST result.
- **RTL and i18n** ✅
  - 30 keys × en / he / es; area-name guard (all 8 × 3, no dead keys).
  - Times, Today / Yesterday and dates are in the business clock via `timeZoneOptions`.
  - An unknown area code is never shown raw.

#### Findings

| # | Where | Finding | Priority |
|---|---|---|---|
| CR7-1 | process | **`next build` not run** (§4.15). This slice adds `import 'server-only'` to `effectiveFields.ts`, which three admin and cron routes reach, and puts a new client component on the dashboard. Jest maps `server-only` to a stub, so only a build proves the bundler accepts every importer. Run it once, as 6b did (scratch export, no worktree, no junction removal), before RM opens the PR | Medium — condition |
| CR7-2 | QA | **W7-6 / Q-9(a) live keyset walk** still owed. It is the only proof the quoted `.or()` works against real PostgREST with microsecond keys: walk a test account's window with `limit = 1` and compare it with one `limit = 100` read. Read-only, scratch, never committed | Medium — condition |
| CR7-3 | `ownerCreditHistory.ts:213-214` | The builder emits a cursor without checking that its own decoder accepts it. If PostgREST ever returned a `created_at` or key in a shape the strict pattern rejects (e.g. `+00` without minutes), every "Show more" would turn into a 400. That would be loud only as a route `warn`, and show as the panel's error line. Suggest validating with the same schema at encode time and failing as a logged server error (`unreadable_time`). CR7-2's live walk also catches it | Low |
| CR7-4 | `CreditHistoryPanel.tsx:206` | "Yesterday" is `now − 24 h` in the business clock. On a daylight-saving change day, a line just after midnight can be labelled one day off. Comparing calendar days (yesterday = the day key before today's) avoids it | Low |
| CR7-5 | `ownerCreditUsage.ts:22-29` | Header: the old "── THIS FILE AND THE ENTITLEMENTS MODULE ──" heading now sits directly above the new "── TWO CONSUMERS ──" heading, and its paragraph follows the second heading. Move the new block above or below the whole old one | Low |
| CR7-6 | `ownerCreditUsageDeps.ts` `ownerCreditHistoryDeps` | Builds the owner repository twice (once inside `ownerCreditUsageDeps`, then overrides `owner`). Harmless; one instance would match DV-4's stated intent | Low |
| CR7-7 | `LanguageContext.tsx:1320` (`credits.history.used`) | Exactly 1.0 used reads "1 credits used". Cosmetic; fold into the native-review pass if the user cares | Low |

Nothing in the diff weakens a guard, edits a 6a test, adds a migration or a service-role ledger read, or adds an AI call (`bos-llm-call-standards` not engaged; the D-q edit is a string, and `typecheck:bos-llm` / `check:bos-llm-literals` passed per §4.15).

#### Deviations DV-1 to DV-10

| # | Ruling |
|---|---|
| DV-1 | Accepted — one fixture with totals derived from its rows serves the window, reconciliation and payload tests; the helper-file reasoning is sound |
| DV-2 | Accepted — a sibling test file with an evaluating fake is right; the existing file's recording fake stays untouched |
| DV-3 | Accepted |
| DV-4 | Accepted (see CR7-6, optional) |
| DV-5 | **Ruled; not a business question.** The period's end date is the day of the last instant of the period, in the business clock. Anchors are stamped at plan-change time (any hour), so "14 Sep – 14 Oct" is the common, **truthful** case: lines from 00:00 to 09:31 on 14 Oct really are in this period, and "13 Oct" would put them in a period whose label says it ended the day before. It also matches the card, which says the credits reset on 14 Oct. Keep it. A midnight anchor still reads "– 13 Oct". If the BA later prefers different wording (e.g. "since 14 Sep · resets 14 Oct"), that is a copy change, not a rule change |
| DV-6 | Accepted — a failed "Show more" shows the error line, never a list that may be incomplete as if current (6a DV-6 precedent) |
| DV-7 | Accepted — a necessary extension of the guard, with planted cases |
| DV-8 | Accepted — `effectiveFields.ts` now feeds owner-visible text, so it belongs in the FR-36 scan and the `server-only` pin |
| DV-9 | Accepted as a draft; he / es go on the native-review list (release precondition, §3) |
| DV-10 | Accepted — the card's log line is unchanged, and the history's has its own message with the same `code` field |

#### Required before PR (conditions)

- **C-1:** `next build` exit 0 on the final 7a diff, result pasted into §4.15 (CR7-1).
- **C-2:** QA's read-only live keyset walk (W7-6 / Q-9(a)) recorded with its result; the live "Show more" click recorded as owed (Q-9(b)).

CR7-3 to CR7-7 are optional and may be folded in before the user's diff view without another SA pass. CR7-3 and CR7-4 are worth the few lines.

#### Business question for the user

None. DV-5 is ruled above.

#### Code Approved for QA: Yes (conditions C-1 and C-2 before RM opens the PR)

---

## QA Testing Report

### QA Report (2026-10-02) — slice 7a, the credit history

**QA — 2026-10-02**
**Test mode:** full (7a only; 7b not built)
**Strategy used:** A + B (Jest: unit, builder, route, render, guards); C (read-only scratch scripts against live PostgREST for Q-9 (a), plus a live payload and restart check); an unauthenticated live route probe on `next dev`. D (signed-in browser) is owed to the user, because QA may not sign in with real credentials.
**Focus:** api, ui, security, schema
**Skipped:** the signed-in browser check (owed, steps below); `next build` (SA condition C-1, a Dev / RM gate, not run by QA); a full `npx tsc` baseline comparison (QA ran the whole-project `tsc --noEmit` and filtered it to this slice's files only)
**Input source:** prompt keywords (TL brief) + workplan §7 + SA condition W7-6 / C-2

#### 1. Gates (re-run independently on the uncommitted tree)

| Gate | Result |
|---|---|
| New + touched suites (27 suites: route, panel, card link, card 6a, all of `lib/business-os/credits/__tests__`, both owner-repository suites, `creditFigures.fromConfig.guard`, `usage/route.credits`) | **27 / 27 suites, 542 / 542 tests**, green |
| `npm run test:bos-entitlements` | **103 / 103 suites, 2,205 / 2,205 tests**, green |
| `git diff --stat` on the five 6a suites (`ownerCreditUsage`, `.crossCheck`, `.payload`, `usage/__tests__/route.credits`, `UsageCard.render`), 6a `creditDisplay.test.ts` and `enforcementPoints.test.ts` | **Empty** (unedited), and all green in the run above (W7-8 met) |
| `npx eslint` on every changed and new `.ts` / `.tsx` | 0 errors; 1 pre-existing warning (`LanguageContext.tsx:11306` `currencyInitialized`) |
| `npx tsc --noEmit` (whole project, 6 GB heap), filtered to every file of this slice | **0 errors** in any new or touched file. ts-jest does not type-check here, so this was run separately |
| `console.*` in new files | 0 |

#### 2. Q-9 (a) — read-only keyset walk against live PostgREST (SA W7-6 / C-2)

**Harness:** uncommitted `tsx` scratch scripts in the session scratchpad, outside the repo. **Service-role client, SELECT only.** Every ledger read went through the real `BusinessOsCreditOwnerReadRepository.listLedgerRowsForWindow`, so each query was scoped by the repository's own `.eq('user_id', accountId)`. The window came from the real `resolveOwnerCreditWindow` with the production `ownerCreditHistoryDeps` wiring. The service-role client stood in for the owner client, so RLS itself was not exercised here; it is covered by the 6a policies and the route test. `server-only` was stubbed in the scratch preload only. No write of any kind.

**Accounts chosen** by a read-only query of `business_os_credit_charges`. All live ledger rows are in the shared monthly period `2026-09-23T19:55:01.28632+00:00`.

| Account | Window | limit = 100 read | limit = 1 walk | Result |
|---|---|---|---|---|
| Avital Omer (`9459b49b…`) | monthly, `.eq('period_start', '2026-09-23T19:55:01.28632+00:00')` | 49 rows, `hasMore` false. 43 `created_at` values have 6 fractional digits and 6 have 4–5, because PostgREST trims trailing zeros (e.g. `…10:37:50.6451+00:00`) | 49 calls, 49 rows | **Identical ids in identical order; 0 duplicates; 0 missing** |
| Eyal Omer (`39c134b8…`) | same | 6 rows | 6 calls, 6 rows | **Identical; 0 duplicates; 0 missing** |
| Offir Omer (`08456106…`) | same | 14 rows (3 with 5-digit fractions) | 14 calls, 14 rows | **Identical; 0 duplicates; 0 missing** |

So the quoted `.or(created_at.lt."<t>",and(created_at.eq."<t>",id.lt.<uuid>))` works against real PostgREST, with `+00:00` offsets and fractions of varying length. **Q-9 (a) PASS.** Each step passed the previous row's live `created_at` through the repository's strict timestamptz re-check, so all 69 live values fit the cursor pattern. That is the live evidence for SA's CR7-3 risk: no live shape is refused today. CR7-3 stays a sensible hardening.

**Also checked live (same harness, read-only):**

| Check | Avital | Eyal | Offir |
|---|---|---|---|
| Sum of all line credits (builder, all pages) = summary `used` = card `used` (`readOwnerCreditUsage`) | 296.72004 = 296.72004 = 296.72004 | 1.54485, all three | 2.793, all three |
| `usedByOwner + usedAutomatic` = `used` | 294.89604 + 1.824 ✅ | 0 + 1.54485 ✅ | 1.3875 + 1.4055 ✅ |
| Summary `endsBefore` = window `resetsOn` (the value the card sends, `ownerCreditUsage.ts:356`) | `2026-10-23T19:55:01.286Z` ✅ | ✅ | ✅ |

Live first-page payload (Avital):
- **Keys:** exactly `area, at, credits, didNotComplete, endsBefore, id, isCorrection, kind, label, lines, nextCursor, period, startsOn, summary, used, usedAutomatic, usedByOwner, who`.
- **Value scan** (labels excluded) for `ai / IA / token / cost / $ / dollar / model / gpt / claude / user_id / service / action_type` and the account id: **none found**.
- **Labels:** every line resolved one (areas: chat 15, briefing 25, website 5, insights 3, images 1).
- **Order:** newest first.
- **Restart:** two stale cursors each got `{ restart: true }` live: one whose `w` has the wrong kind letter (`t:` for a monthly window), and one with a millisecond-truncated key (`m:…19:55:01.286+00:00`). The exact-string rule holds.

#### 3. Unauthenticated live probe (`next dev -p 3000`, stopped afterwards)

| Request | Result |
|---|---|
| `GET /api/business-os/credits/history` | **401** `{"success":false,"error":"Unauthorized"}`, `cache-control: private, no-store`, no data |
| `?cursor=abc` | 401 (auth is checked before the cursor) |
| `?accountId=9459b49b-…` (a real account with rows) | 401, no data |
| `?cursor=")%2Cor%3D` (hostile) | 401, no data |

#### Test Coverage

| Acceptance criterion / edge | Tested? | Result | Notes |
|---|---|---|---|
| FR-26 / AC-38: lines of the card's own window, newest first; total = card `used` | ✅ | Pass | Builder and reconciliation tests; **live on 3 accounts** (§2) |
| The summary split adds up to the total (exact and at one decimal) | ✅ | Pass | Exact live; at one decimal by the `creditDisplay.diary.test.ts` 2,000-case largest-remainder sweep |
| Paging and keyset: no duplicate, no gap | ✅ | Pass | Evaluating fake (120 rows, same-ms and same-µs ties, W7-9) and the **live Q-9 (a)** walk |
| Hostile / malformed cursor → 400, nothing read | ✅ | Pass | `route.test.ts` (5 malformed + 4 hostile) and `creditHistoryCursor.test.ts` (16 refusals). The repository re-checks and refuses with no query. An empty `?cursor=` is also a 400 (Zod `min(1)`); the panel never sends one |
| `?accountId=` / `?userId=` ignored | ✅ | Pass | Route test; the source reads only `cursor` (`route.ts:67`); live unauthenticated → 401 |
| 401 before any read | ✅ | Pass | Route test and live probe |
| Restart when the window changes; a second restart → error | ✅ | Pass | Builder, route and render tests; live wrong-kind and truncated-key cursors |
| Trial / no plan row / over the allowance / ungauged / empty / empty trial / error / malformed payload / loading | ✅ | Pass | Builder and panel render tests, one per state |
| Payload: no tokens, dollars, cost, account or action ids, raw service, "AI" | ✅ | Pass | Payload allow-list tests and the **live payload scan** |
| Correction (adjustment) lines: their own signed line under the charge's area / label / who; an off-page original is fetched; an unresolved one reads "Correction to: Other activity", is counted and logs `warn` | ✅ | Pass | Builder and render tests. Fixtures only: no live adjustment rows exist yet (4c is not built) |
| Other service (AC-35) → "Other activity", counted | ✅ | Pass | Builder test; fixtures only, none live |
| he / es; RTL `dir`; side per SA Q-1 (`left` in he, `right` in en / es) | ✅ | Pass (automated) | Render tests; **visual check owed** |
| Card unchanged except the link; the card's mount makes 1 request; the panel reads only when opened | ✅ | Pass | 6a suite unedited and green; `UsageCard.historyLink.render.test.tsx` |
| No timers, polling or signal subscription in the panel | ✅ | Pass | Surface guard |
| Entitlements registration (no new importer) | ✅ | Pass | `test:bos-entitlements` green; `enforcementPoints.test.ts` diff empty |
| Live "Show more" click (Q-9 (b)) | ⬜ | Owed | No account has more than 50 lines yet. **Avital Omer is at 49**, so two more actions in this period put her over 50 |
| Signed-in browser walkthrough (§7 manual row) | ⬜ | Owed | User; steps below |

#### Issues Found

**Bugs (must fix before commit):** none.

**Performance issues:** none found. Each page is one owner-RLS ledger read, plus one `findChargesByActionIds` only when a correction's original is on another page. The panel reads only when opened and on "Show more".

**Edge cases (nice to fix; none blocks):**
1. **Stale content on reopen.** `components/business-os/CreditHistoryPanel.tsx:118-123, 280`. Reopening keeps the previous summary and lines on screen while page one is read again. The "Loading…" line is hidden because `summary !== null`. The figures are replaced within one round trip, but can be briefly out of date. Low. A fix: clear `summary` / `lines` when a page-one read starts, or show "Loading…" over them.
2. **"Yesterday" by subtracting 24 h.** `CreditHistoryPanel.tsx:206`, the same as SA's CR7-4. QA confirms it. Low, cosmetic.
3. **Two minus glyphs.** `CreditHistoryPanel.tsx:189-191`. A negative value in tenths uses `Intl`'s sign (a hyphen-minus in en), while a negative "less than 0.1" uses U+2212 "−". Only corrections are negative, and none exist live yet. Cosmetic.

#### Owed manual checks (user — signed in; QA may not sign in)

1. **Signed-in walkthrough.** On a preview or a local `npm run dev`, as a test account (Avital Omer has the most lines, 49):
   1. Open the Business OS dashboard → the **Credits** card → click **"Credit history"**. The panel should open from the right.
   2. Check that:
      - lines are newest first;
      - the heading total ("N credits used") matches the card's used figure (allowance − left);
      - at one decimal, the total matches the **Costs & credits** tab for the same account and period at `/admin/business-os-llm` (expected now: Avital 296.7, Offir 2.8, Eyal 1.5);
      - "by you · automatic" adds up to the total;
      - a briefing or insight line that the schedule ran shows "Automatic".
   3. Close the panel and run one chat answer, then reopen it. The new line should be at the top and the total should have moved. With the panel open, nothing should refresh by itself: the DevTools Network tab should show no repeated request to `/api/business-os/credits/history`.
   4. Switch the language to **Hebrew**. Text should run right to left, with Hebrew labels and area names, and the panel should still open from the physical right (SA Q-1). Switch to **Spanish** and check for Spanish labels.
2. **Q-9 (b): live "Show more"**, once an account passes 50 lines in a period (Avital Omer needs 2 more actions). Open the panel and confirm it shows 50 lines and a "Show more" button. Click it: the remaining lines should appear below, none repeated and none missing, and the button should disappear on the last page.
3. **Native review** of the he / es strings (30 keys in each language, plus the D-q label). This is the release precondition already listed in §4.15.

Not QA's, still open for the PR: SA condition **C-1** (`next build` exit 0, pasted into §4.15).

#### Test Outputs / Logs

```text
Jest (new + touched): Test Suites: 27 passed, 27 total — Tests: 542 passed, 542 total
test:bos-entitlements: Test Suites: 103 passed, 103 total — Tests: 2205 passed, 2205 total
eslint: ✖ 1 problem (0 errors, 1 warning) — LanguageContext.tsx:11306 currencyInitialized (pre-existing)
tsc --noEmit (filtered to slice files): 0 lines

=== Avital Omer ===
window kind monthly | ledger {"kind":"period","periodStart":"2026-09-23T19:55:01.28632+00:00"} | used 296.72004 | byOwner 294.89604 | auto 1.824
limit=100 rows 49 hasMore false
limit=1 walk: calls 49 rows 49 dupes 0 missing 0 => IDENTICAL ORDER: true
builder: pages 1 lines 49 | sum(lines) 296.72004 | summary.used 296.72004 | card.used 296.72004 | summary.endsBefore 2026-10-23T19:55:01.286Z | split sum 296.72004
=== Eyal Omer ===   limit=1 walk: calls 6 rows 6 dupes 0 missing 0 => IDENTICAL ORDER: true; sum 1.54485 = used = card
=== Offir Omer ===  limit=1 walk: calls 14 rows 14 dupes 0 missing 0 => IDENTICAL ORDER: true; sum 2.793 = used = card
stale-kind cursor -> {"restart":true}
ms-truncated key cursor -> {"restart":true}

GET /api/business-os/credits/history (no session) -> HTTP/1.1 401, cache-control: private, no-store, {"success":false,"error":"Unauthorized"}
```

#### Final Status

**PASS WITH NOTES.** No bugs. Three low or cosmetic edge cases are left to Dev's discretion (one is SA's CR7-4). Q-9 (a) passed live, which satisfies SA condition C-2.

- [x] All automated acceptance criteria pass; Q-9 (a) passed against live PostgREST
- [ ] Owed before release: SA C-1 `next build` (Dev / RM); the signed-in walkthrough including the he / es visual check, Q-9 (b) live "Show more" and the native he / es review (user)

---

## Commit Info

*(RM populates this section.)*

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-02 | Created (Dev) | Workplan for slice 7 as SA ruled it: **7a** the credit diary (shared window function `resolveOwnerCreditWindow` in `ownerCreditUsage.ts` with the 6a tests unedited; `listLedgerRowsForWindow` + `OWNER_DIARY_COLUMNS` on the owner repository; hardened base64url cursor with exact strings end to end and `restart`; server-only builder with effective fields, `diaryLabelFor` and a local label type (C-S7-1); new route `GET /api/business-os/credits/history`; one-decimal formatter; card link + `Sheet` panel; 30 keys × 3; D-q label edit; guards extended; ≈ 3.75 d) and **7b** the typical range as a full plan (D-r decided: label reused, "up to N"; bounded 2,000-row read of succeeded charges over 90 days; p10 / p90; five most frequent; ≈ 1.25 d). No migration. Ten questions for SA, including Q-1 (the `Sheet` sides are logical, which corrects F7-11) |
| 2026-10-02 | SA workplan review — ✅ Approved with conditions | Scoping conditions 2–6 verified. Q-1: F7-11 corrected; the panel copies the existing drawers' `side={isRTL ? 'left' : 'right'}` + `dir` for consistency. Q-2 to Q-6, Q-8 and Q-10 accepted. Q-7: "less than 1" only when p90 < 1 (SA's SQ-35 wording corrected). Q-9: a read-only keyset walk on a test account, with the live "Show more" click deferred to the first account over 50 lines (no live write needed). Findings: `SOURCES` also gains the history route; the `creditPeriod` Date guard is extended to the builder and cursor; one source for `endsBefore` / `resetsOn`; the 6a card suite must pass unedited. Conditions 1–8. 7a may start |
| 2026-10-02 | 7a implemented (Dev) — Code Complete, uncommitted | T-a0: SA conditions W7-1 to W7-9 folded (§4.0). T-a1 to T-a11 done: `resolveOwnerCreditWindow` (card unchanged, 6a suites unedited and green); `listLedgerRowsForWindow` + `OWNER_DIARY_COLUMNS`; cursor; `displayInstantIso`; `diaryLabelFor`; D-q label; `ownerCreditHistory.ts` + types; route `GET /api/business-os/credits/history`; formatter; `CreditHistoryPanel` + card link; 30 keys × 3; guards; docs. Gates §4.15: 28 suites / 627 tests; entitlements 103 / 2,205; tsc identical to baseline; bos-llm typecheck 0 new; literals 0; hooks clean. Deviations DV-1 to DV-10 |
| 2026-10-02 | QA report (7a) — PASS WITH NOTES | Gates re-run: 27 suites / 542 tests; entitlements 103 / 2,205; 6a suites unedited and green; eslint 0 errors; tsc 0 errors in slice files. Q-9 (a) read-only keyset walk on live PostgREST (Avital 49, Offir 14, Eyal 6 rows): identical order, no duplicates, no gaps; live sum of lines = summary = card `used` (SA C-2 met). Unauthenticated route → 401 live. No bugs; 3 low edge cases; signed-in walkthrough, Q-9 (b) and native review owed |
| 2026-10-02 | 7a review fixes (Dev) — CR7-3, CR7-4 / QA-2, CR7-5, CR7-7, QA-1, QA-3 | New §4.15.1: the cursor is checked by its own decoder before it is sent (paging ends cleanly, `error` log); "Yesterday" by calendar day in the business clock; header order; singular "1 credit used" (new key ×3); no stale figures on reopen; one minus sign (U+2212). CR7-6 skipped as instructed |
| 2026-10-02 | **Parked by user decision 2026-10-02 — shipped dark behind flag** | New §4.15.2. `NEXT_PUBLIC_BUSINESS_OS_CREDIT_HISTORY`, default off: `isBusinessOsCreditHistoryEnabled()` (client, `featureFlags.ts`) hides the card's link and panel — the card is exactly 6a's, its suite unedited; `isCreditHistoryRouteEnabled()` (server, `creditHistoryFlag.ts`) makes the route answer 404 to every caller before auth or any read. Both states tested; `docs/feature_flags.md` 1.5.0. Dormant code and tests kept. 7b parked. SA C-1: `next build` exit 0 on the final diff (scratch export, as 6b). Gates: 28 suites / 648 tests; entitlements 103 / 2,205; eslint 0 new; hooks clean |
