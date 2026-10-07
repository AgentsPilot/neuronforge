# Workplan: Admin boost-packs route to the mandatory rules + drop the dead `boost_packs` policies

> **Last Updated**: 2026-10-07

**Developer:** Dev
**Requirement:** coding-standards / infra only, no requirement MD. Follow-up to [P-10 workplan](/docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P10_WORKPLAN.md) migration 20261039 (PR #243) and [Plan payments requirement](/docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md) §9.3.
**Date:** 2026-10-07
**Branch:** `refactor/admin-boost-packs-route-standards` (worktree `neuronforge-boost-packs-route`), from `origin/main` `7ffe5162`. Created by RM.
**Status:** Code Complete (uncommitted, awaiting SA review)

## Overview

`app/api/admin/boost-packs/route.ts` (the agent-platform boost-pack catalog behind `/admin/agentspilot-billing`) breaks four project rules: it builds its own service-role client and queries `boost_packs` directly (rule 1), reads three request bodies without Zod (rule 2), logs with `console.*` (rule 3), and returns raw `error.message` to the browser (security rule). This slice moves data access into a repository, adds Zod schemas, converts logging to Pino and guards error details behind `NODE_ENV === 'development'`. **No behaviour change for the admin:** same methods, same accepted fields, same response shapes. In the same PR, migration **20261040** drops the two `boost_packs` RLS policies that 20261039 left dead, keeping RLS enabled.

## Analysis Summary

| Area | Finding |
|---|---|
| Route | 4 handlers (GET list ordered by `price_usd`, POST insert, PUT update by `id`, DELETE by `id` from the body). `requireAdmin` already first in each. No audit trail today (not added: no new pattern in this slice). |
| Caller | `app/admin/agentspilot-billing/page.tsx`: GET reads `{ success, data }`; POST/PUT send the whole pack row (`...pack`, so extra keys such as `created_at` arrive and must be ignored, not rejected); DELETE sends `{ id }`. On `!response.ok` the page shows its own generic text, so status/message changes on failure are invisible to the admin. |
| Columns used | `id, pack_key, pack_name, display_name, description, price_usd, bonus_percentage, credits_amount, bonus_credits, badge_text, is_active` (route + page + `scripts/initialize-boost-packs.ts`). No `user_id`: platform catalog, so rule 4 does not apply (documented in the repo header). |
| Tests pinning the route | `app/api/admin/__tests__/adminGate.writes.test.ts` (denial oracle, mocks `@/lib/supabaseServer`), `app/admin/system-config/__tests__/source.guard.test.ts` (page only). |
| Policies | Prod pre-check 2026-10-07: 2 policies, both dead after 20261039 (no browser grant left; service_role bypasses RLS). |

## Implementation Approach

- **Repository** `lib/repositories/BoostPackRepository.ts`, modelled on `AiModelPricingRepository` (platform catalog, service role intentional, documented rule-4 exemption, never throws). Methods mirror the route one-to-one: `listAll`, `create`, `update`, `deleteById`. `update` does not stamp `updated_at` (the route never did; keeping it out avoids a behaviour change).
- **Zod**: unknown keys are stripped (default `z.object`), never rejected, because the page posts the full row. POST keeps today's rule (the four text fields required and non-empty); PUT keeps today's partial-update semantics (only `id` required, every other field optional, an empty string still allowed). Field types match what the page sends. Malformed JSON and schema failures return 400 `{ success:false, error, details(dev only) }`. `null` is accepted exactly where the column is nullable in the table definition (`docs/BOOST_PACK_ADMIN_INTERFACE.md`): `badge_text` and `is_active` (SA/QA round 1).

**Intentional small behaviour changes** (failure paths only; the page shows its own generic error on any non-ok response, so the admin sees no difference):

| Case | Before | After |
|---|---|---|
| Malformed JSON body | 500 | 400 |
| NaN or Infinity in a number field (JSON turns it into `null`) for a NOT NULL column | 500 (DB error) | 400 |
| Text of a 400 | 'Missing required fields' / 'Missing boost pack ID' | 'Invalid input' |
- **Errors**: user-friendly message; `details` only in development.
- **Migration 20261040**: copy of the 20261039 four-file set, pasteable-SQL rules (no comments, no `into`, plain literals).

## Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `lib/repositories/BoostPackRepository.ts` | create | Rule 1 |
| `lib/repositories/types.ts`, `lib/repositories/index.ts` | modify | Types + exports per `new-repository` skill |
| `lib/repositories/__tests__/BoostPackRepository.test.ts` | create | One unit test per method |
| `app/api/admin/boost-packs/route.ts` | modify | Rules 1, 2, 3 + error details |
| `app/api/admin/boost-packs/__tests__/route.test.ts` | create | Happy path + 403 + 400 |
| `supabase/migrations/20261040_boost_packs_drop_dead_policies.sql` | create | Drop the 2 dead policies |
| `supabase/SQL Scripts/20261040_boost_packs_drop_dead_policies_rollback.sql` | create | Re-create both exactly as in prod |
| `scripts/precheck-boost-packs-dead-policies.sql`, `scripts/check-boost-packs-dead-policies-migration.sql` | create | Read-only pre-check and checker |
| `supabase/migrations/__tests__/boost-packs-drop-dead-policies.migration.test.ts` | create | Static guard over the 4 SQL files |
| P-10 workplan, tier-billing reuse plan, plan-payments requirement | modify | Record 20261039 applied, packs inactive, 20261040 |

## Task List

- ✅ Step 1: Repository + types + index export + unit test
- ✅ Step 2: Route refactor (repository, Zod, Pino, dev-only details)
- ✅ Step 3: Route test (happy path, 403, 400)
- ✅ Step 4: Migration 20261040 set + static test
- ✅ Step 5: Doc updates (targeted edits)
- ✅ Step 6: Run tests, authz guard, type-check, lint

## Test Plan

| Test | Command |
|---|---|
| Repository unit | `npx jest lib/repositories/__tests__/BoostPackRepository.test.ts` |
| Route | `npx jest app/api/admin/boost-packs` |
| Admin gate oracle | `npx jest app/api/admin/__tests__/adminGate.writes.test.ts` |
| Admin authz guard | `npm run test:authz-guard` |
| Migrations 20261038/39/40 static | `npx jest supabase/migrations/__tests__/boost-packs purchase-path-tables` |
| Type-check | `npx tsc --noEmit -p .` (touched files only) |

Manual (QA): on `/admin/agentspilot-billing` list, edit, add and delete a boost pack; same messages as before. After applying 20261040 in prod: run the pre-check (expects 2 policies), the migration in a new tab, then the checker (expected `VERDICT PASS`, 22 pass 0 fail). The **20261039 checker's C5 reads FAIL after 20261040 by design** (it pins 2 policies); use the 20261040 checker from then on.

## SA Review Notes

**APPROVED WITH NITS** (round 1). Nits applied: `BoostPack` numeric columns narrowed to `number` (PostgREST returns JSON numbers); `null` accepted for nullable columns (`is_active`, `badge_text`) with a test; repository create/update/delete success logs moved to debug (the route logs info with `userId`); intentional behaviour changes recorded above. Nit 2 closed: the user's 2026-10-07 pre-check showed `check none` for both policies, so the rollback (no WITH CHECK) is exact.

## QA Testing Report

**QA — 2026-10-07**
**Test mode:** full · **Strategy:** A/B (Jest, repository mocked; no DB, no dev server) + static SQL checks · **Focus:** api, security, schema · **Skipped:** live browser check (no non-prod DB; success shapes shown to be identical instead)

| Check | Result | Notes |
|---|---|---|
| New route test, repository test, migration static test, `adminGate.writes.test.ts` | ✅ Pass | 4 suites, 381 tests |
| `npm run test:authz-guard` | ✅ Pass | 119 tests |
| Page contract: Add / Edit (full DB row incl. `created_at`/`updated_at`, decimals, badge) / badge cleared + active toggled off / Delete | ✅ Pass | 7 cases added to `app/api/admin/boost-packs/__tests__/route.test.ts`, payloads built as `handleSaveBoostPack` builds them (credits via the page's `calculateBoostPackCredits`) |
| Success shapes vs `origin/main` | ✅ Identical | `{ success, data }`; DELETE `{ success: true }`; same `price_usd` ordering; extra keys dropped as the old destructure did |
| Auth fail (403 before any repo call) | ✅ Pass | all 4 handlers |
| Invalid input (400, no repo call, details dev-only) | ✅ Pass | |
| Repo error / repo throws (500, no internal text outside development) | ✅ Pass | |
| SQL paste-safety (4 files) | ✅ Pass | `--` 0, `into` 0, `/*` 0, backslash 0, `$` 0, no punctuated literals |
| ESLint on touched TS files, `tsc` errors in touched files | ✅ Clean | |

**Bugs:** none.

**Edge cases (no action needed, recorded):**
1. NaN/Infinity cannot reach the DB: `JSON.stringify` turns them into `null`, now a 400 (before: forwarded to a NOT NULL column, so a 500). The page cannot produce them (`parseFloat || 0`, cost falls back to 0.00048).
2. A PUT carrying `null` for a non-nullable field is now 400 instead of being forwarded. Only reachable from the page if a stored row has `is_active` NULL (the original DDL has no NOT NULL on it). Page shows its generic error either way.
3. Malformed JSON body: 400 now, 500 before. Not reachable from the page.

**Verdict: PASS** — ready for commit after user diff review.

## Known Issues (not fixed — legacy AgentsPilot)

Found by Dev during this refactor. All four are in the **AgentsPilot** (agent platform) boost-pack admin, not Business OS: `boost_packs` is the retired Pilot Credit boost catalog, managed only at `/admin/agentspilot-billing`; the purchase is switched off (`create-checkout` answers 410 since P-10a) and all 3 packs are inactive in prod (2026-10-07). User decision 2026-10-07: log as known issues, not sent to Offir. Revisit only if the boost purchase is ever revived.

| # | Issue | Where |
|---|---|---|
| KI-1 | Create, edit and delete of a boost pack write no audit row, although they are price changes | `app/api/admin/boost-packs/route.ts` |
| KI-2 | No price sanity checks: zero or negative `price_usd`, `bonus_percentage` or credit amounts are accepted | Route Zod schemas (kept equal to the old behaviour on purpose) |
| KI-3 | If the Pilot Credit cost setting is 0, the page computes `credits_amount` as Infinity (sent as `null`); now a 400 instead of a DB error | `app/admin/agentspilot-billing/page.tsx` (`calculateBoostPackCredits`) |
| KI-4 | Delete is a hard delete, ignores whether a row matched, and may orphan or block on `boost_pack_purchases` rows that reference the pack | `BoostPackRepository.deleteById` (same as before) |

## Commit Info

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-07 | Workplan created | Route standards refactor + migration 20261040 + doc status updates |
| 2026-10-07 | SA nits applied (Dev) | SA APPROVED WITH NITS, QA PASS. Numeric types narrowed to `number`; `is_active` accepts `null` (nullable column; PUT of a stored null row passes as before) + test; repository success logs to debug; intentional behaviour changes table (malformed JSON 500→400, NaN/Infinity→null on NOT NULL 500→400, 400 text 'Invalid input'). SA nit 2 closed: prod pre-check showed `check none` for both policies, rollback exact |
| 2026-10-07 | Known issues KI-1 to KI-4 logged (TL) | Dev's four findings are AgentsPilot legacy (retired boost catalog); user decided to log them here rather than send them to Offir |
