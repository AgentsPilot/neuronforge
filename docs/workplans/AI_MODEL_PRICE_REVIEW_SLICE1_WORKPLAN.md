# Workplan: AI Model Price Review, Slice 1 (truth fix + sync audit flush)

> **Last Updated**: 2026-10-09

**Developer:** Dev
**Requirement:** [AI_MODEL_PRICE_REVIEW_REQUIREMENT.md](/docs/requirements/AI_MODEL_PRICE_REVIEW_REQUIREMENT.md) (MP-FR-1; AB-5 to AB-8; SA Requirement Review 2026-10-08: R-5, R-7, findings 1 and 4)
**Branch:** workplan written on `docs/model-pricing-audited-sync-req` (worktree `neuronforge-model-pricing`, off `origin/main` `a689de3f`). Implementation branch: to be created by RM, see O-1
**Date:** 2026-10-09
**Status:** Code Complete (SA workplan-approved 2026-10-09; uncommitted, awaiting SA code review)

## Overview

Slice 1 makes the Model pricing page (`/admin/system-config`) tell the truth and makes the existing Sync leave a durable audit row. It changes page text, the per-token display format, one route's audit flush, one route's header comment, the tests that pin them, and one docs pointer. There is **no migration, no database write, and no change to how any price is stored, read, synced, edited or charged**. The Sync button, its handler, the Sync route's catalogue and the single-row editor all keep their behaviour; slice 8 retires them.

## Table of Contents

1. [Analysis](#1-analysis)
2. [Approach and decisions](#2-approach-and-decisions)
3. [Files to create / modify](#3-files-to-create--modify)
4. [Exact text changes (old to new)](#4-exact-text-changes-old-to-new)
5. [Code changes](#5-code-changes)
6. [Test plan](#6-test-plan)
7. [Risks](#7-risks)
8. [Open questions for SA](#8-open-questions-for-sa)
9. [Task list](#9-task-list)
10. [SA Review Notes](#sa-review-notes)
11. [QA Testing Report](#qa-testing-report)
12. [Commit Info](#commit-info)
13. [Change History](#change-history)

---

## 1. Analysis

All line numbers are on `a689de3f`.

### 1.1 What the slice touches

| Area | File | Today |
|---|---|---|
| Page | `app/admin/system-config/page.tsx` | False text at `:301` (S-1 helper), `:346` (routing in the intro), `:350` / `:353` ("per 1,000 tokens"), `:356` (S-4, "Automatically fetches ... from OpenAI and Anthropic APIs"), `:359` ("immediately"), `:362-367` ("Impact on Intelligent Routing" box). `formatCost` at `:220-227` fixes 8 decimals, so a per-token price of `0.000000075` ($0.075 per 1M) shows as `$0.00000008` ($0.08 per 1M) |
| Sync route | `app/api/admin/system-config/pricing/sync/route.ts` | `logAIPricingSynced` is awaited (`:420-424`) but only **queues**; nothing flushes before the response (AB-5). Header comment `:12-20` says it syncs "from external sources" and "uses official pricing from provider documentation"; it contacts no provider (AB-4) |
| Sibling route (reference only, not changed) | `app/api/admin/system-config/pricing/route.ts` | Module-level `const auditTrail = AuditTrailService.getInstance();` (`:50`); each write handler ends with `await auditTrail.flush().catch((err) => requestLogger.error({ err }, 'Audit flush failed'));` (`:257`, `:319`, `:367`) |
| Page source guard | `app/admin/system-config/__tests__/source.guard.test.ts` | S-1 (`:146-148`) and S-4 (`:155-159`) pin the two false strings byte for byte |
| Page render tests | `app/admin/system-config/__tests__/pages.render.test.tsx`, `pages.edge.qa.test.tsx` | Assert formatted prices such as `$0.00000015`, `$0.00000250`, `$0.00000080`, `$0.00000800`, `$0.00000150` |
| Sync route test | `app/api/admin/system-config/pricing/sync/__tests__/route.test.ts` | Pins gate, sync and audit call; no flush assertion |
| Docs | `docs/requirements/ADMIN_BOS_CLEANUP_REQUIREMENT.md` §11 | Row "⏸ Model price source and Sync" (parked, UC-5) has no pointer to the new requirement |

### 1.2 Which guard S-ids the edited text touches

Checked each assertion in `source.guard.test.ts` against every edit in §4 and §5:

| S-id | Pins | Touched by slice 1? |
|---|---|---|
| S-1 | Helper text `:301` | **Yes**, re-pinned (T-1 in §4) |
| S-2, S-3 | `Sync Latest Pricing`, `Syncing...` labels | No. Both strings still appear (the button is unchanged, and the new S-4 paragraph still begins with `Sync Latest Pricing:`) |
| S-4 | Info-box Sync paragraph `:356` | **Yes**, re-pinned (T-5 in §4) |
| S-5 to S-7 | Handler comment `// Refresh pricing data after sync since it fetches from external API`, route literal, handler fragments | No. The false comment stays until slice 8 (R-5) |
| S-9 | Whole `handleSyncPricing` | No |
| S-10 | Whole Sync button | No |
| G-1, G-2, G-3, G-7, G-8, W2-4 | Page-level fetches, no `boost`, no `console.`, `'use client'` + `clientLogger`, h1, handler bindings | No. New text contains no `boost`, no `console.`, no new fetch. Re-verified by running the suite |

So exactly **S-1 and S-4** change, as R-5 rules.

### 1.3 `console.*` check (CLAUDE.md Logging)

| File | `console.*` calls |
|---|---|
| `app/admin/system-config/page.tsx` | 0 (already on `clientLogger`; ADMIN_BOS_CLEANUP TA-13 is out of date on this point) |
| `app/api/admin/system-config/pricing/sync/route.ts` | 0 |
| `app/admin/system-config/__tests__/source.guard.test.ts` | 0 calls (the only match is the G-3 assertion string `'console.'`) |
| `app/admin/system-config/__tests__/pages.render.test.tsx` | 0 |
| `app/api/admin/system-config/pricing/sync/__tests__/route.test.ts` | 0 |

Nothing to flag.

### 1.4 Skills checked

- `new-api-route` (audit-flush checklist line, WC-7): applies to the Sync route change. No new route.
- `tenant-isolation-guard`: not applicable. No caller-supplied id, no new service-role write; `syncMany` is unchanged.
- `business-os-entitlements`: no import from `lib/business-os/entitlements/`.
- `bos-llm-call-standards`, `durable-queue-drain`, `business-os-schema-check`: not applicable (no LLM call, no drain, no column claim beyond what the requirement already verified).

---

## 2. Approach and decisions

### D-1 Sync audit flush: `await auditTrail.flush().catch(...)`, as the sibling route (recommended)

Two repo patterns exist:

| | (a) `await auditTrail.flush().catch(...)` after `logAIPricingSynced` | (b) `logAndFlush(entry, logger, context)` from `lib/audit/boundedAuditFlush.ts` |
|---|---|---|
| Used by | `pricing/route.ts` (PUT/POST/DELETE), admin entitlements, invites, archiving runs | Logout, refused access, plan change, boost webhook, credit-low line |
| Skill | `new-api-route` checklist names (a) as the WC-7 standard for audited writes | Not named by the skill |
| Bound | Unbounded (flush is one insert) | 2 s total, never rejects |
| Concurrency | Subject to the known `isFlushing` early return | Serialised against other `logAndFlush` callers only; still subject to the `isFlushing` return against everyone else (its own header, "SCOPE") |
| Fit here | Keeps `logAIPricingSynced` (the registered helper, severity `info`) unchanged | Needs a raw `AuditLogInput`, so the route would rebuild the helper's entry inline or the helper would be refactored. That is more change for no gain on this path |

**Recommendation: (a).** R-7 asks for it in those words; it is the skill's WC-7 standard; it is byte-for-byte the pattern of the sibling route the requirement compares against (AB-8); and it leaves the audit helper untouched. `logAndFlush`'s advantages (bound, burst serialisation) matter for paths that must answer fast or come in bursts (a 403, a logout). A Sync is a rare admin click that already takes seconds. R-2 chooses `logAndFlush` for the new proposal routes in slices 3 and 7, which build their entries fresh; that is consistent with this choice.

Shape of the change:

**File:** `app/api/admin/system-config/pricing/sync/route.ts`

```typescript
import { AuditTrailService } from '@/lib/services/AuditTrailService';

// The same singleton `logAIPricingSynced` queues into, so `flush()` drains its row.
const auditTrail = AuditTrailService.getInstance();

// ...after the existing `await logAIPricingSynced(...).catch(...)`:

// WC-7 / MP-FR-1 (AB-5): flushed BEFORE the response, exactly as the
// single-row writes in `../route.ts`. `auditLog` only queues; a serverless
// instance frozen after the response would lose the record of a sync that
// rewrote the table. Non-blocking: a failed flush never turns a sync that
// already happened into a 500.
await auditTrail.flush().catch((err) => requestLogger.error({ err }, 'Audit flush failed'));
```

Placement: after the audit call and before `return NextResponse.json({ success: true, ... })`. Not on the error path (no audit is queued there) and not on the gate path (the gate's own refusal audit is `logAndFlush`'d by `requireAdmin`).

### D-2 Display unit: per token, exact, with a per-1M line under it (recommended)

| Option | What the cell shows | Assessment |
|---|---|---|
| **A** Per 1M only | `$0.075` | Matches R-1's later display. But the editor in the same cell still takes **per token** (it is unchanged until slice 8, and the PUT has no upper bound). An admin reading `$0.15` and typing `0.15` into the editor would save $0.15 per token, a million-fold overcharge on every customer. Not acceptable on a money path |
| **B** Per token only, exact | `$0.000000075` | One unit everywhere (stored, shown, edited). Exact. Hard to read at a glance |
| **C (recommended)** Per token, exact, primary; per 1M as a muted second line | `$0.000000075` over `$0.075 per 1M` | One unit for what is stored and edited, plus the readable per-1M figure. The column headers stay `Input Cost/Token` / `Output Cost/Token`, which are true |

Formatters (C):

| Function | Unit | Format | Why these digits |
|---|---|---|---|
| `formatCost` (existing name kept) | per token | USD, `minimumFractionDigits: 8`, `maximumFractionDigits: 15` | 8 minimum keeps every existing rendering identical (`$0.00000015`, `$0.00000250`), so no current test assertion changes. 15 maximum is per-token for R-4's 9 decimals per 1M (6 + 9), so no price the future proposal flow can accept is rounded, and the binary float noise of a JS number (around the 17th significant digit) is never shown |
| `formatCostPerMillion` (new) | per 1M tokens | USD of `cost * 1_000_000`, `minimumFractionDigits: 2`, `maximumFractionDigits: 9` | 9 is R-4's bound. Same noise argument |

Verified in Node 22 with the exact options above: `7.5e-8` gives `$0.000000075` / `$0.075`; `3.75e-8` gives `$0.0000000375` / `$0.0375`; `1.5e-7` gives `$0.00000015` / `$0.15`; `2.5e-6` gives `$0.00000250` / `$2.50`; `0` gives `$0.00000000` / `$0.00`.

**What the display proves and does not prove (finding 1):** the page now shows whatever value the GET returns, unrounded. If the database itself stores `0.075/1M` as `0.08/1M`, the page will now show `$0.00000008` / `$0.08 per 1M`, which is the truth of the store. Slice 2's read-only `numeric_scale` check settles AB-10. This slice only removes the display rounding.

### D-3 Effective-time wording (finding 4)

The cache is per server instance and refreshes when older than 1 hour (`lib/ai/pricing.ts:37`, `:198-199`). The only honest claim is "in effect on all servers within 1 hour". The text says that, for both an edit and a Sync.

### D-4 No new pattern

Every change follows an existing pattern in the same files or the sibling route. No new dependency, no new route, no migration.

---

## 3. Files to create / modify

| File | Action | Reason |
|---|---|---|
| `app/admin/system-config/page.tsx` | modify | Text T-1 to T-7 (§4), remove the routing box, `formatCost` digits, new `formatCostPerMillion`, the per-1M line in both cost cells, header comment |
| `app/api/admin/system-config/pricing/sync/route.ts` | modify | Import + module-level `auditTrail`; awaited non-blocking flush (D-1); header comment T-8 |
| `app/admin/system-config/__tests__/source.guard.test.ts` | modify | Re-pin S-1 and S-4 (R-5); header records "SA 2026-10-08 R-5"; describe title; new truth assertions (O-2) |
| `app/admin/system-config/__tests__/pages.render.test.tsx` | modify | New case R-11: exact per-token and per-1M display of `0.000000075` |
| `app/api/admin/system-config/pricing/sync/__tests__/route.test.ts` | modify | Mock `AuditTrailService`, capture logs; new flush cases SF-1 to SF-4; flush-not-called assertions on the failure and gate cases |
| `docs/requirements/ADMIN_BOS_CLEANUP_REQUIREMENT.md` | modify | §11 pointer to the new requirement (targeted), Last Updated, one Change History row |
| `docs/requirements/AI_MODEL_PRICE_REVIEW_REQUIREMENT.md` | modify | Status line + Change History row for slice 1 progress (standing user preference: every slice stage recorded in the main requirement) |
| `docs/workplans/AI_MODEL_PRICE_REVIEW_SLICE1_WORKPLAN.md` | create | This file |

`pages.edge.qa.test.tsx` needs **no** change under D-2 (C): its asserted strings render identically. It is run, not edited.

---

## 4. Exact text changes (old to new)

All in `app/admin/system-config/page.tsx` unless stated. JSX indentation and `className`s unchanged unless stated.

**T-1 Helper text under "AI Model Pricing" (`:301`, guard S-1)**

- Old: `Token costs for all AI models. Sync to get latest pricing from providers.`
- New: `Cost per token for each AI model. Sync copies a built-in price list; it does not fetch prices from providers.`

**T-2 Intro paragraph (`:346`)**

- Old: `This table defines the cost per token for each AI model's input (prompts) and output (responses). These prices directly impact cost calculations, billing, and intelligent routing decisions. Accurate pricing ensures reliable cost estimates and optimal model selection.`
- New (C-1): `This table defines the cost per token for each AI model's input (prompts) and output (responses). Business OS credit charges for the models listed here are computed from these prices, so a wrong price here is a wrong charge for every customer who uses that model.`

**T-3 Input Cost (`:350`)**

- Old: `<strong className="text-green-300">Input Cost:</strong> Price per 1,000 input tokens (prompts, context, memory). Measured in USD. Example: $0.00015 = 15 cents per 1M tokens.`
- New: `<strong className="text-green-300">Input Cost:</strong> Price per single input token (prompts, context, memory), in USD. This is the unit stored and the unit the editor takes; the smaller figure under each price is the same price per 1M tokens. Example: $0.00000015 per token = $0.15 per 1M tokens.`

**T-4 Output Cost (`:353`)**

- Old: `<strong className="text-green-300">Output Cost:</strong> Price per 1,000 output tokens (AI responses, generated content). Typically 2-3x higher than input. Example: $0.0006 = 60 cents per 1M tokens.`
- New: `<strong className="text-green-300">Output Cost:</strong> Price per single output token (AI responses, generated content), in USD. Usually higher than input. Example: $0.00000060 per token = $0.60 per 1M tokens.`

("Typically 2-3x" is dropped: it is not true across the table, e.g. 4x for `gpt-4o-mini`.)

**T-5 Sync paragraph (`:356`, guard S-4)**

- Old: `<strong className="text-green-300">Sync Latest Pricing:</strong> Automatically fetches current rates from OpenAI and Anthropic APIs. Keeps system aligned with provider pricing changes. Run monthly or when providers announce updates.`
- New (C-2): `<strong className="text-green-300">Sync Latest Pricing:</strong> Copies a built-in price list, kept in the code, into this table: it overwrites the price of every model on that list, including manual edits, and adds any listed model that is missing. It does not contact OpenAI, Anthropic or any other provider.`

(The overwrite and insert claims are AB-4: `syncMany` updates the newest row per listed model or inserts one.)

**T-6 Manual Edits (`:359`)**

- Old: `<strong className="text-green-300">Manual Edits:</strong> Override prices for custom contracts, volume discounts, or testing. Changes affect cost calculations immediately but don't alter provider billing.`
- New: `<strong className="text-green-300">Manual Edits:</strong> Override prices for custom contracts, volume discounts, or testing. Each server keeps its own copy of these prices for up to 1 hour, so a change (an edit or a Sync) is in effect on all servers within 1 hour. Changes don't alter provider billing.`

**T-7 "Impact on Intelligent Routing" box (`:362-367`)**

- Old: the whole `<div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 mt-2">` block, containing `Impact on Intelligent Routing` and `Lower model costs increase routing priority. If GPT-4o-mini price drops, more agents route there. If Claude Haiku becomes cheaper than GPT-4o-mini, <strong className="text-white">medium complexity agents automatically switch</strong> to maximize savings.`
- New: removed (six lines). No replacement text.

**T-8 Sync route header comment (`app/api/admin/system-config/pricing/sync/route.ts:12-20`)**

- Old:
  ```text
   * POST /api/admin/system-config/pricing/sync
   * Sync latest pricing from external sources (OpenAI, Anthropic, Google, Kimi)
   *
   * This uses official pricing from provider documentation:
   * - OpenAI: https://openai.com/api/pricing/
   ...
  ```
- New:
  ```text
   * POST /api/admin/system-config/pricing/sync
   * Copies the built-in catalogue below into `ai_model_pricing`: overwrites the
   * newest row of every listed model and inserts any listed model that is missing.
   * It contacts NO provider (AI_MODEL_PRICE_REVIEW AB-4).
   *
   * The provider pricing pages, for reference only; this handler never fetches them:
   * - OpenAI: https://openai.com/api/pricing/
   ...
  ```
  The four URL lines and the rest of the header are unchanged. A sentence is added after the RC-W10 / Step 0 paragraph: `The audit entry is flushed before the response (WC-7, MP-FR-1), as in the single-row routes.`

**T-9 Page header comment (`page.tsx:16-17`)**

- Old: `Sync is parked (UC-5) and frozen byte for byte (C2-1); its one logging line is the only change to it.`
- New: `Sync is parked (UC-5) and its handler and button are frozen byte for byte (C2-1). AI_MODEL_PRICE_REVIEW slice 1 (SA 2026-10-08 R-5) rewrote the false info-box and helper text around it; slice 8 retires Sync.`

**Not changed (deliberately):** the handler comment `// Refresh pricing data after sync since it fetches from external API` (S-5; R-5 moves it to slice 8 with the handler); the h1, the page description at `:247`, the column headers, the button labels, the success message from the route.

---

## 5. Code changes

### 5.1 `page.tsx`

- `formatCost`: `minimumFractionDigits: 8` stays; `maximumFractionDigits: 8` becomes `15`, with a why-comment (D-2).
- New `formatCostPerMillion(cost: number)`: formats `cost * 1_000_000` with `minimumFractionDigits: 2`, `maximumFractionDigits: 9`.
- Both non-editing cost cells (`:447`, `:481`) become:

  ```tsx
  <span className="font-mono">{formatCost(model.input_cost_per_token)}</span>
  <span className="block text-xs text-slate-500 font-mono">
    {formatCostPerMillion(model.input_cost_per_token)} per 1M
  </span>
  ```
  (output likewise). The editing branch is unchanged.
- Text T-1 to T-7, comment T-9.

No state, handler, fetch or prop changes. `handleSyncPricing` and the Sync button are untouched (S-9, S-10).

### 5.2 `pricing/sync/route.ts`

D-1 and T-8 only. The catalogue, `syncMany` call, response shape, error path and log lines are unchanged.

---

## 6. Test plan

### 6.1 Sync route: `app/api/admin/system-config/pricing/sync/__tests__/route.test.ts`

Setup changes, mirroring `pricing/__tests__/route.test.ts`:

- `jest.mock('@/lib/services/AuditTrailService', () => ({ AuditTrailService: { getInstance: () => ({ flush: () => mockFlush() }) } }))`. The route takes the singleton at module load, so `getInstance` returns a stable object delegating to the per-test `mockFlush`.
- `mockFlush` default: pushes `flush:start`, awaits one `setImmediate`, pushes `flush:end` (proves it is awaited, not fired).
- `logAIPricingSynced` mock pushes `synced` into the same `mockEvents`.
- The logger mock records `{ level, context, message }` into `logs` (existing cases ignore it).

| ID | Case | Expectation |
|---|---|---|
| SF-1 (happy path) | Admin sync succeeds | 200; `mockEvents` equals `['synced', 'flush:start', 'flush:end']`; `mockFlush` called once |
| SF-2 (failure path) | `mockFlush` rejects with `new Error('audit_trail unreachable')` | Still 200 with `success: true` and the unchanged body shape; `logs` holds an `error` entry with message `Audit flush failed` and `context.err` an `Error` |
| SF-3 | Audit write rejects (existing case) and flush resolves | 200; flush still called once (a queued-or-not row never decides the response) |
| SF-4 | `syncMany` errors (existing 500 case) | 500; `mockFlush` not called |
| existing | 401 / 403 / gate throws | Add `expect(mockFlush).not.toHaveBeenCalled()` to the route-level flush (the gate's own refusal audit is `requireAdmin`'s `logAndFlush`, not this `flush`) |

All existing cases keep passing unchanged apart from the added assertions.

### 6.2 Page source guard: `source.guard.test.ts`

- S-1 re-pinned to T-1's new string; S-4 re-pinned to T-5's new string (the C-2 text: `Copies a built-in price list, kept in the code, into this table: it overwrites the price of every model on that list, including manual edits, and adds any listed model that is missing. It does not contact OpenAI, Anthropic or any other provider.`), both still `toContain`, byte-exact.
- Header: add `S-1 and S-4 re-pinned to the true text: AI_MODEL_PRICE_REVIEW slice 1, approved SA 2026-10-08 R-5.` Describe title `'P: Sync is unchanged (C2-1, G-5)'` becomes `'P: Sync is unchanged apart from its true text (C2-1, G-5; R-5)'`.
- S-2, S-3, S-5 to S-7, S-9, S-10, G-*, W2-4: unchanged.
- **Additions (O-2, approved for MT-1 and MT-2; MT-3 dropped by SA):** a new describe `'P: the info box tells the truth (MP-FR-1)'`:
  - MT-1: `P` does not contain `Automatically fetches`, `Intelligent Routing`, `intelligent routing`, `per 1,000`, or `immediately`.
  - MT-2: `P` contains `in effect on all servers within 1 hour`.

### 6.3 Page render: `pages.render.test.tsx`

- New R-11: GET returns a row with `input_cost_per_token: 0.000000075`, `output_cost_per_token: 0.0000003`. The row shows `$0.000000075` and `$0.075 per 1M`, and `$0.00000030` and `$0.30 per 1M`; `$0.00000008` is not shown.
- Existing R-* and all `pages.edge.qa.test.tsx` E-* cases pass unedited (D-2 keeps the per-token strings identical).

### 6.4 Commands

Run from the worktree root, with the shared `node_modules` (no install):

```bash
npx jest app/api/admin/system-config/pricing --ci
npx jest app/admin/system-config --ci
npm run test:authz-guard
npx eslint app/admin/system-config/page.tsx app/api/admin/system-config/pricing/sync/route.ts app/admin/system-config/__tests__ app/api/admin/system-config/pricing/sync/__tests__
npx tsc --noEmit -p .
```

The first two cover the sibling route suite too (it must stay green: nothing in it changes). `tsc` because ts-jest does not type-check in this repo.

### 6.5 Manual check (QA, critical path)

On a dev server, signed in as an admin: open `/admin/system-config`; confirm T-1 to T-6 read as in §4 and the routing box is gone; confirm a row shows its per-token price and the per-1M line; do **not** click Sync against a shared database (it overwrites prices).

---

## 7. Risks

| # | Risk | Mitigation |
|---|---|---|
| RK-1 | Mixed units in one cell lead an admin to type a per-1M figure into the per-token editor | D-2 (C) keeps per token as the primary figure, the header says `/Token`, and T-3 states the editor takes per token. Option A rejected for this reason. Removed fully in slice 8 |
| RK-2 | The page now shows rounded storage, if storage is rounded (finding 1), which may look like a new bug | It is the truth; recorded in D-2. Slice 2 measures `numeric_scale` |
| RK-3 | `auditTrail.flush()` returns early while another flush runs (`isFlushing`), so the row can still be lost under concurrency | Project-wide WC-7 limit, already recorded in the skill and ADMIN_BOS_CLEANUP §11; the same exposure as the sibling routes. Sync clicks are rare. R-2 moves the new flow to `logAndFlush` |
| RK-4 | An unbounded flush could hold the Sync response if the audit insert hangs | Same exposure as the sibling routes; the Sync already does dozens of writes. Not worse than today's sibling paths |
| RK-5 | Guard re-pin done by editing both sides at once could pin wrong text | The guard and page edits use the exact strings in §4; SA checks them against this workplan; QA reads the rendered page |
| RK-6 | The editor's `toFixed(10)` truncates per-token values beyond 10 decimals when the admin types | Pre-existing, unchanged by this slice (typing is a deliberate overwrite; Save without typing sends the exact number). Recorded for slice 8, which removes the editor |
| RK-7 | Tailwind scans docs; a backslash followed by hex in a scanned file breaks `next build` | This workplan and the docs edits contain no backslashes |
| RK-8 | Worktree `node_modules` is a junction to the main checkout | No `npm install`; never `git worktree remove --force` on this worktree |

---

## 8. Open questions for SA

- **O-1 Branch.** The worktree is on `docs/model-pricing-audited-sync-req`, a docs branch carrying the requirement. Should slice 1 code go on that branch (one PR: requirement + slice 1), or should RM cut `fix/ai-model-price-review-slice1` off `origin/main`? Dev does not create branches. Recommendation: a separate `fix/` branch so the requirement PR can merge on its own.
- **O-2 Extra truth assertions.** R-5 says S-2/3/5–7/9/10 stay unchanged; MT-1 to MT-3 (§6.2) are additions in a new describe, not changes to those ids. Approve, or keep the guard to the re-pin only?
- **O-3 Display unit.** Confirm D-2 option C (per token exact + per-1M second line) over option A.
- **O-4 Flush helper.** Confirm D-1 (a) over `logAndFlush` for this route.

---

## 9. Task list

- [x] T-0: SA approved this workplan 2026-10-09 (C-1 and C-2 applied to §4 / §6.2). `git branch --show-current` before the first edit: `docs/model-pricing-audited-sync-req`. TL directed implementation in this worktree, uncommitted; the O-1 `fix/` branch is still for RM to cut (the uncommitted change moves with it)
- [x] T-1: `page.tsx`: text T-1 to T-7 (T-2 per C-1, T-5 per C-2), comment T-9 (matched across the `page.tsx:16-17` wrap)
- [x] T-2: `page.tsx`: `formatCost` digits, `formatCostPerMillion`, per-1M line in both cost cells (wrapped in a fragment, since each cell is one branch of a ternary)
- [x] T-3: `sync/route.ts`: `auditTrail` + awaited non-blocking flush (D-1), header comment T-8
- [x] T-4: `source.guard.test.ts`: re-pin S-1 and S-4, header approval note, describe title; MT-1 and MT-2 (MT-3 dropped per O-2)
- [x] T-5: `pages.render.test.tsx`: R-11
- [x] T-6: `sync/__tests__/route.test.ts`: `AuditTrailService` mock, log capture, SF-1 to SF-4, flush-not-called on gate cases
- [x] T-7: Run §6.4; results: `npx jest app/api/admin/system-config/pricing --ci` 2 suites / 49 tests passed; `npx jest app/admin/system-config --ci` 3 suites / 39 tests passed; `npm run test:authz-guard` 1 suite / 119 tests passed; eslint 0 errors, 2 warnings (`react/no-unescaped-entities` on the apostrophes in "model's" and "don't", both pre-existing: the base file has the same two); `npx tsc --noEmit -p .` (with `NODE_OPTIONS=--max-old-space-size=8192`; the default heap ran out) exit 2 with 1941 pre-existing errors, none in a touched file
- [x] T-8: `ADMIN_BOS_CLEANUP_REQUIREMENT.md` §11: in the "⏸ Model price source and Sync" row's Item cell, append `**Superseded 2026-10-09 by [AI_MODEL_PRICE_REVIEW_REQUIREMENT.md](/docs/requirements/AI_MODEL_PRICE_REVIEW_REQUIREMENT.md)**; its slice 1 fixes the info box text and flushes the Sync audit.`; bump Last Updated; add one Change History row. No other edit to that file
- [x] T-9: `AI_MODEL_PRICE_REVIEW_REQUIREMENT.md`: status line and Change History row for slice 1
- [x] T-10: `git diff --stat` (check for deletion-without-insertion), then hand to SA for code review. Leave everything uncommitted

---

## SA Review Notes

**Reviewed by SA — 2026-10-09** (against `a689de3f`, worktree `neuronforge-model-pricing`)
**Status:** ✅ Approved with changes (C-1 and C-2 are wording edits to this workplan; apply them, then implement. No second SA workplan pass needed)

### Verification

- Every quoted old string in T-1 to T-7 exists verbatim in `page.tsx` (`:301`, `:346`, `:350`, `:353`, `:356`, `:359`, `:362-367`). T-8's old lines exist in `sync/route.ts:13-16`. `formatCost` at `:220-227` and the two non-editing cost cells at `:447` / `:481` are as described. The audit call is at `:419-423` (workplan says `:420-424`; off by one, harmless).
- T-9's old string is real but **wraps** at `page.tsx:16-17` (`... (C2-1); its one logging line` / ` * is the only change to it.`). Match across the ` * ` continuation, not as one line.
- Guard: only S-1 (`:146-148`) and S-4 (`:155-159`) pin text that changes. S-9 / S-10 fixtures (`SYNC_HANDLER`, `SYNC_BUTTON`) contain none of T-1 to T-9; S-2 / S-3 still match the unchanged button; S-5 comment is kept. Matches R-5.
- MT-1 terms appear in `page.tsx` only on the lines T-2 to T-7 replace, so MT-1 will hold after the edit.
- `logAIPricingSynced` -> `auditLog` -> `AuditTrail` = `AuditTrailService.getInstance()` (`AuditTrailService.ts:665, 715`): the module-level `auditTrail` is the same singleton, so `flush()` drains the sync row. D-1 is correct.
- Test mock pattern for `AuditTrailService` is copied from the sibling suite, whose 401/403 cases already pass with it (gate refusal goes through `recordRefusedAccess`, not `getInstance().flush`), so the "flush not called" assertions on gate cases are sound.
- Formatters re-run in Node: `7.5e-8` -> `$0.000000075` / `$0.075`; `1.23456789e-7` -> `$0.000000123456789` / `$0.123456789`; `0.0000011` -> `$0.00000110` / `$1.10`. Existing render assertions (`$0.00000015`, `$0.00000250`, `$0.00000080`) are exact `getByText` on the per-token span and still match with the new sibling span.
- Charging / price values: untouched. No change to `lib/ai/pricing.ts`, `chargePricing.ts`, the repository, the Sync catalogue, `syncMany`, the PUT/POST/DELETE handlers or the editor. Display-only plus one awaited flush.
- `console.*`: 0 in every touched file (confirmed).

### Comments

1. **C-1 (required) T-2 overclaims.** "Every Business OS credit charge is computed from these prices" is false: `text-embedding-3-small` and `gpt-image-1` are not in this table (AB-13), and a model missing from the table or an unreadable table falls back to code (AB-1 to AB-3). A truth slice must not add a new false sentence. Use: `This table defines the cost per token for each AI model's input (prompts) and output (responses). Business OS credit charges for the models listed here are computed from these prices, so a wrong price here is a wrong charge for every customer who uses that model.` — SA: pending Dev
   Dev 2026-10-09: applied to §4 T-2 and to `page.tsx`.
2. **C-2 (required) T-5 omits the insert.** `syncMany` updates the newest row per listed model **or inserts one** (AB-4), so "over the matching models" understates what a click does. S-4 is byte-pinned, so fix the wording now rather than re-pin later. Use: `<strong className="text-green-300">Sync Latest Pricing:</strong> Copies a built-in price list, kept in the code, into this table: it overwrites the price of every model on that list, including manual edits, and adds any listed model that is missing. It does not contact OpenAI, Anthropic or any other provider.` Update T-5, the S-4 re-pin and §6.2 to this exact string. — SA: pending Dev
   Dev 2026-10-09: applied to §4 T-5, §6.2, the S-4 re-pin in `source.guard.test.ts` and `page.tsx`.
3. T-9 old string wraps two lines (see Verification). — SA: note only
4. §6.1 SF-3: keep it; it pins that a rejected audit call never skips the flush or changes the status. — SA: resolved

### Rulings on open questions

- **O-1 Branch:** separate `fix/ai-model-price-review-slice1` branch, cut by RM **off `origin/main` after the requirement PR (`docs/model-pricing-audited-sync-req`) has merged**. The requirement file does not exist on `origin/main` yet, and T-9 edits it, so a fix branch cut before that merge would not carry it. RM commits the requirement on the docs branch first (no `git stash`); this workplan file travels with the slice 1 PR. If the user wants it in one PR instead, keeping the docs branch is acceptable, but do not stack a `fix/` branch on the unmerged docs branch.
- **O-2 Extra truth assertions:** MT-1 and MT-2 approved (new describe, S-ids untouched; cheap and they stop the false text from returning). **MT-3 dropped:** it asserts an implementation detail in source, and R-11 already proves the behaviour (no 8-decimal rounding) at render level.
- **O-3 Display unit:** option C confirmed. Per-token exact stays primary because the inline editor and the stored value are per token; per-1M-only (A) would invite a million-fold mis-entry on a money path. Per-1M muted line only on the non-editing branch, as written.
- **O-4 Flush helper:** D-1 (a) confirmed: `await auditTrail.flush().catch((err) => requestLogger.error({ err }, 'Audit flush failed'))` with module-level `AuditTrailService.getInstance()`, byte-matching the sibling route, as R-7 rules. `logAndFlush` is reserved for the new proposal routes (R-2); not here.

### Adjusted items (marked by SA)

- T-2 text: replaced per C-1.
- T-5 text (and S-4 re-pin, §6.2): replaced per C-2.
- §6.2 / task T-4: MT-3 removed; MT-1 and MT-2 only.
- Task T-0: branch per O-1 ruling.

### Proportionality

Appropriate for a small truth fix: one route line + import, page text, one formatter, tests that pin exactly the two required behaviours (flush awaited before 200; flush failure still 200). No new pattern, no migration. Do not widen it.

### Approval

[x] Workplan approved — proceed to implementation once C-1 and C-2 are applied to §4 / §6.2 and the branch is set per O-1

### SA Code Review

**Code Review by SA — 2026-10-09** (uncommitted diff in worktree `neuronforge-model-pricing`)
**Status:** ✅ Code Approved with one required comment fix (CR-1, a two-line comment edit; no re-review needed, QA may proceed in parallel)

#### Verification

- Fidelity: T-1 to T-7 and T-9 in `page.tsx` match §4 byte for byte, with C-1 (T-2) and C-2 (T-5) applied. The routing box is removed entirely. The editing branch, `handleSyncPricing` and the Sync button are untouched (S-9, S-10 pass).
- Charging and price values: not affected. The diff touches no file under `lib/`. The Sync catalogue, the `syncMany` call, the response shape, the error path and the PUT/POST/DELETE handlers are unchanged. `formatCost` and `formatCostPerMillion` are display-only. `cost * 1_000_000` feeds only `Intl.NumberFormat` (max 9 digits), so float noise never shows.
- Flush: it is a module-level `AuditTrailService.getInstance()` (the same singleton `logAIPricingSynced` queues into), called after the audit `.catch` and before the 200 `return`. It is absent from the 500 path and the gate paths, and it is byte-identical to the sibling `pricing/route.ts:257`. Error handling is `.catch` to `requestLogger.error({ err }, 'Audit flush failed')`, so a failed flush cannot turn a completed sync into a 500.
- Tests: `npx jest app/api/admin/system-config/pricing app/admin/system-config --ci` passes 5 suites / 88 tests, re-run by SA.
  - SF-1 proves the flush is awaited (`flush:end` is recorded before the handler resolves) and ordered after `synced`.
  - SF-2 proves a rejected flush still returns 200, with an unchanged body and an `error` log carrying `{ err }`.
  - SF-3 proves a rejected audit call still flushes once.
  - SF-4, and the gate cases, prove no flush on the 500 or 401/403 paths.
  - The mock pattern is copied from the sibling suite (F-1 to F-5).
  - R-11 asserts both spans and that the 8-decimal rounding is absent.
  - MT-1 and MT-2 are as approved; MT-3 is dropped.
  - Only S-1 and S-4 are re-pinned, and the header carries the R-5 approval note.
- React fragment: correct and needed, because each cell is one branch of a ternary. It renders two sibling spans with no keys required, and the second span is `block`, so it sits under the price inside the `whitespace-nowrap` cell. Existing exact `getByText('$0.00000015')` assertions still match the first span, and E-* pass unedited.
- `console.*`: 0 in every changed file. No backslash followed by a hex character in any changed or new file (grep). All paths in comments and docs use forward slashes.
- Docs: the `ADMIN_BOS_CLEANUP_REQUIREMENT.md` diff is the targeted §11 pointer, Last Updated and one Change History row. Nothing else.
- Proportionality: right-sized. No new pattern, dependency, route or migration.

#### Code Review Comments

1. **CR-1** `app/api/admin/system-config/pricing/sync/route.ts:12-13` (T-8 header, Dev's open point). **Ruling: fix now.** "over the matching rows" repeats the exact understatement that C-2 corrected in the UI. `syncMany` also inserts every listed model that is missing (`AiModelPricingRepository.ts:339`), and a truth slice should not leave a fresh half-truth in the file it rewrites. Replace the two lines
   `* Copies the built-in catalogue below over the matching rows of`
   `` * `ai_model_pricing`. It contacts NO provider (AI_MODEL_PRICE_REVIEW AB-4).``
   with
   `` * Copies the built-in catalogue below into `ai_model_pricing`: overwrites the``
   `* newest row of every listed model and inserts any listed model that is missing.`
   `* It contacts NO provider (AI_MODEL_PRICE_REVIEW AB-4).`
   Also update §4 T-8 "New" to match. Comment only; no test change. — Priority: Low (required before commit)
2. `sync/__tests__/route.test.ts:236`: the `logs` array is read inside a `jest.mock` factory without the `mock` prefix. It works because ts-jest's hoist does not enforce the name rule, and the array is read only at call time. It is also the sibling suite's exact convention, so leave it. — Priority: note only

#### Optimisation Suggestions

- None for this slice. RK-6 (the editor's `toFixed(10)`) stays with slice 8, as recorded.

#### Code Approved for QA: Yes (CR-1 is a comment edit; Dev applies it before RM commits, and SA does not need a re-pass)

---

## QA Testing Report

**QA — 2026-10-09** (worktree `neuronforge-model-pricing`, uncommitted diff)
**Test mode:** full
**Strategy used:** A (Jest unit/render + source guard), B (route test with mocked repository and audit service), mutation checks on scratchpad copies, Node runs of the formatters. D (browser) not possible in this session; checklist below.
**Focus:** api, ui
**Skipped:** browser check (no dev server allowed); `tsc` not re-run (Dev recorded it in T-7; ts-jest does not type-check)
**Input source:** TL prompt + §6

### Test Coverage
| Check | Tested? | Result | Notes |
|---|---|---|---|
| `npx jest app/api/admin/system-config/pricing --ci` | ✅ | Pass | 2 suites, 49 tests passed |
| `npx jest app/admin/system-config --ci` | ✅ | Pass | 3 suites, 39 tests passed (R-* and E-* unedited and green) |
| `npm run test:authz-guard` | ✅ | Pass | 1 suite, 119 tests passed |
| SF-1 catches a removed flush line | ✅ | Pass | Mutant killed: SF-1, SF-2, SF-3 fail (3 failed, 7 passed) |
| SF-1 catches a fired, not awaited flush (`void auditTrail.flush()`) | ✅ | Pass | Mutant killed: SF-1 fails |
| SF-2 catches a flush without `.catch` | ✅ | Pass | Mutant killed: SF-2 fails |
| R-11 catches the old 8-decimal formatter | ✅ | Pass | Mutant killed: R-11 fails (1 failed, 13 passed) |
| Tailwind CSS-escape guard | ✅ | Pass | 6 of 6 passed. The guard only scans tracked files, so the untracked workplan and requirement were checked by hand: 0 backslashes. The 3 in `ADMIN_BOS_CLEANUP_REQUIREMENT.md` were already there; the diff adds none |
| `npx jest lib/ai --ci` | ✅ | Pass | 6 suites, 78 tests passed |
| eslint on touched files | ✅ | Pass | 0 errors, 2 warnings (`react/no-unescaped-entities`). Base `page.tsx` has the same 2 |
| `console.*` in touched source | ✅ | Pass | 0 |
| Order of the audit write and the flush | ✅ | Pass | `logAIPricingSynced` awaits `auditLog`, so the row is queued before `flush()` runs |
| "within 1 hour" text against the code | ✅ | Pass | `lib/ai/pricing.ts` `CACHE_TTL_MS = 60 * 60 * 1000` (see edge case 2) |
| `formatCost` / `formatCostPerMillion` edge cases | ✅ | Pass | See below |
| Manual check on `/admin/system-config` | ⚠️ | Not run | No browser available. Checklist below |

**Formatter runs (Node, same options as `page.tsx`):** `0` gives `$0.00000000` / `$0.00`; `1e-9` gives `$0.000000001` / `$0.001`; `7.5e-8` gives `$0.000000075` / `$0.075`; `3.0000000000000004e-7` (0.1+0.2-style float noise) gives `$0.00000030` / `$0.30`; `8e-7` (times 1e6 = 0.7999999999999999) gives `$0.80`; `1.23456789e-7` gives `$0.000000123456789` / `$0.123456789`; large values (1, 1e6, 1e21) format with grouping and do not throw. A sweep of 200,000 per-1M prices from $0.001 to $200.000 (stored per token) found 0 mismatches between the displayed and the exact per-token and per-1M strings.

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None. The awaited flush adds one audit insert to the Sync response. That is the accepted RK-4 exposure, the same as the sibling routes.

#### Edge Cases (nice to fix; none blocks)
1. **A null or missing price looks free or broken** (Low, pre-existing). `null` renders `$0.00000000` / `$0.00`, the same as a real zero. `undefined` renders `$NaN`. The old formatter did the same. Out of scope here; slice 8 can handle it.
2. **"In effect on all servers within 1 hour" assumes the database read succeeds** (Low). If the reload after the TTL fails, `loadPricingFromDatabase` keeps the old cache and tries again on the next call. A server can therefore charge an old price for more than 1 hour while the pricing read is failing. The text is true in normal operation. Recorded only, no change asked for in this slice.
3. Negative values render `-$0.00000015`. That is pre-existing and only reachable through the editor or the database.

### Manual critical-path checklist (after deploy, as an admin)
- [ ] Open `/admin/system-config`. The page loads with no error banner.
- [ ] The helper text under "AI Model Pricing" says Sync copies a built-in price list and does not fetch prices from providers.
- [ ] The info box: Input and Output say "per single ... token" with the per-1M examples. Sync says it overwrites listed models (manual edits included) and adds missing ones. Manual Edits says "within 1 hour". The "Impact on Intelligent Routing" box is gone.
- [ ] Each row shows the per-token price, with a smaller "$X per 1M" line under it, for both input and output.
- [ ] A sub-cent model (for example a Gemini Flash row, if one exists) shows its exact per-token value, not one rounded to 8 decimals.
- [ ] Click edit on a row: the per-1M line is replaced by the editor. Cancel without saving.
- [ ] **Do not click Sync** on a shared or production database: it overwrites prices. If the route needs proving live, do it only on a disposable database, then confirm one `AI_PRICING_SYNCED` row in the audit trail.

### Test Outputs / Logs
```text
pricing:        Test Suites: 2 passed, 2 total | Tests: 49 passed, 49 total
system-config:  Test Suites: 3 passed, 3 total | Tests: 39 passed, 39 total
authz-guard:    Test Suites: 1 passed, 1 total | Tests: 119 passed, 119 total
tailwind guard: Tests: 6 passed, 6 total
lib/ai:         Test Suites: 6 passed, 6 total | Tests: 78 passed, 78 total
M1 flush removed:    3 failed, 7 passed  (SF-1, SF-2, SF-3)
M2 flush not awaited: 1 failed, 9 passed (SF-1)
M3 flush no .catch:  1 failed, 9 passed  (SF-2)
M4 max 8 decimals:   1 failed, 13 passed (R-11)
formatter sweep: checked 200000 mismatches 0
```

**CR-1:** applied to the `sync/route.ts` header (comment only) while QA was running. The pricing suites were re-run after it: 2 suites, 49 tests passed.

**CLAUDE.md minimum:** met. Happy path: SF-1 (200, flush awaited after the audit write) and R-11 / R-* (render). Failure paths: SF-2 (flush rejects, still 200 and logged), SF-3 (audit rejects, still flushes), SF-4 (sync error, 500, no flush), plus 401, 403 and gate-throws (no flush).

### Final Status
- [x] All acceptance criteria pass — ready for commit (pending the manual browser check above, and the user seeing the diff)
- [ ] Issues found — Dev must address before commit

---

## Commit Info

_RM to populate._

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-09 | Created | Dev workplan for slice 1 (MP-FR-1, R-5, R-7): exact text changes T-1 to T-9, flush decision D-1, display unit D-2, test plan, risks, open questions O-1 to O-4. No code written |
| 2026-10-09 | SA approved; implemented | C-1 and C-2 applied; MT-3 removed per O-2. Tasks T-0 to T-10 done and §6.4 results recorded in T-7. Uncommitted, for SA code review |
