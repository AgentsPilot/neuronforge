# Workplan: Data Export onto the Repository Layer

> **Last Updated**: 2026-10-04

**Developer:** Dev
**Requirement:** none of its own. This is the repository half of FU-1 in [BUSINESS_OS_BD26_OWNER_AUDIT_HIDING_WORKPLAN.md](/docs/workplans/BUSINESS_OS_BD26_OWNER_AUDIT_HIDING_WORKPLAN.md), and it enforces CLAUDE.md rule 1
**Branch:** `refactor/data-export-repositories`, stacked on `fix/bos-owner-audit-hides-admin-entries` (PR #202). Retarget to `main` once #202 merges
**Date:** 2026-10-04
**Status:** Code Complete (awaiting SA code review; nothing committed)

## Overview

`GET /api/user/data-export` (GDPR Art. 15 / 20) makes eight direct Supabase reads through a service-role client it builds inline. This breaks CLAUDE.md rule 1. The refactor moves each read into a repository method and changes nothing about behaviour: the same tables, columns, filters, order and limits, the same exported JSON, the same status codes and the same route logging. Before anything moves, a characterization test pins how the route behaves today.

---

## 1. Call inventory (today, `app/api/user/data-export/route.ts`)

The **auth** step uses `createServerClient` (anon key + cookies) and only calls `auth.getUser()`. It reads no table, so it stays in the route.

**DB reads.** Every one goes through `createClient(URL, SERVICE_ROLE_KEY)`, a fresh service-role client built per request. **The route ignores the error from every read**: it destructures only `data` and falls back to `{}`, `[]` or `null`.

| # | Table | Columns | Filters / modifiers | Result handling | Existing repo method | Matches? |
|---|---|---|---|---|---|---|
| R1 | `profiles` | `*` | `.eq('id', uid).single()` | Spread over `{id, email, created_at}` from auth. Profile keys **override** those three | `UserProfileRepository.findById` | No: 5 columns, `maybeSingle` |
| R2 | `agents` | `*` | `.eq('user_id', uid).order('created_at' desc)` | `?? []`. Includes deleted and inactive agents | `AgentRepository.findAllByUser` | No: excludes deleted/inactive, adds `total_runs` |
| R3 | `agent_executions` | `*` | `.eq('user_id', uid).gte('created_at', now-90d).order('created_at' desc).limit(1000)` | `?? []` | `ExecutionRepository` (by agent only) | No user-scoped method. **Default client is the browser anon client** |
| R4 | `agent_configurations` | `*` | `.eq('user_id', uid).order('created_at' desc)` | `?? []` | `AgentConfigurationRepository` (by id / agent) | No |
| R5 | `plugin_connections` | `user_id, plugin_key, created_at, updated_at, metadata` | `.eq('user_id', uid)`, no order | Mapped to `{plugin_key, connected_at, last_updated, metadata}`. Credentials never selected | `PluginConnectionRepository.findAllByUser` | No: `*` (would read credentials), ordered |
| R6 | `user_subscriptions` | `*` | `.eq('user_id', uid).single()` | `row ? [row] : []` | `UserSubscriptionRepository.findGrantStateByUserId` | No: narrow columns |
| R7 | `credit_transactions` | `*` | `.eq('user_id', uid).gte('created_at', now-1y).order('created_at' desc).limit(5000)` | `?? []` | none. No repository owns this table | n/a |
| R8 | `audit_trail` | `*` | `.eq('user_id', uid).not('entity_type','in',(OWNER_HIDDEN_ENTITY_TYPES)).not('action','like','BUSINESS_AI_ACTION_%').gte('timestamp', now-90d).order('timestamp' desc).limit(10000)` | `?? []`. **Always `[]` today**: `timestamp` does not exist, so PostgREST returns 42703 and the error is swallowed (FU-1) | `AuditTrailRepository.listOwnerEntries` | No: `OWNER_COLUMNS`, paged, `created_at` |

No `.rpc(...)` calls. Nothing called inline touches the DB, except `auditLog(...)`, which is the queued `AuditTrailService` writer and is out of scope. `console.*` count: **0** in the route and in all 7 repositories touched below, and 0 in the guard test.

**Why service role:** this is history, not a measured requirement. The route has always read with the service role, and it is not documented why. Owner read policies per table were **not** verified for this workplan. Moving to the user-auth client would mean changing behaviour if any policy is missing, so that move is out of scope. Tenant isolation comes from `.eq('user_id' | 'id', user.id)` on every read, where `user.id` is always the authenticated caller and is never taken from the client (`tenant-isolation-guard`: no caller-supplied id, no write). The refactor keeps that property. It uses the shared `supabaseServer` singleton (same key, same privileges) instead of a per-request `createClient`.

---

## 2. Implementation approach

**Reuse first, but no existing method fits.** Each existing method differs in columns, filters or row set (table above), and reusing any of them would change the export. So each owning repository gets **one new, purpose-named read**, `listForUserDataExport(userId)` (for R1 and R6, `findForUserDataExport(userId)`). Each method:

- reproduces the route's query chain exactly, keeping the `.single()` calls on R1 and R6;
- keeps `.eq('user_id', userId)` (R1: `.eq('id', userId)`, since `profiles.id` is the user id);
- follows the `new-repository` shape: try/catch, `{ data, error }` `RepositoryResult`, Pino `{ err }` on error;
- carries a short `GDPR export only` JSDoc saying the column set is fixed and must not change without a privacy decision.

| Read | Home | Note |
|---|---|---|
| R1 | `UserProfileRepository.findForUserDataExport` | |
| R2 | `AgentRepository.listForUserDataExport` | No status filter, on purpose (the export includes deleted agents) |
| R3 | `ExecutionRepository.listForUserDataExport(userId, since)` | The route builds it with `new ExecutionRepository(supabaseServer)`, because the default client is anon (OP-2) |
| R4 | `AgentConfigurationRepository.listForUserDataExport` | |
| R5 | `PluginConnectionRepository.listForUserDataExport` | Keeps the 5-column select, so credentials are never read |
| R6 | `UserSubscriptionRepository.findForUserDataExport` | |
| R7 | **new** `CreditTransactionRepository.listForUserDataExport(userId, since)` | No repository owns the table (OP-1) |
| R8 | `AuditTrailRepository.listOwnerEntriesForExport(userId, since)` | Same two BD-26 exclusions, written the same way. Keeps `timestamp` and its comment pointing to FU-1 |

The **route** keeps the auth block, the `exportData` assembly, the plugin-connection mapping, the profile spread, the summary, the logs, `auditLog(...)`, the headers and the 500 handler. Each read becomes `const { data: x } = await repo.method(...)`. The error is still ignored, so the fallbacks behave exactly as today. The 90-day and 1-year cut-offs stay computed in the route and passed in, so the dates do not move.

**Errors must stay ignored.** If a repository error failed the route instead, R8's permanent 42703 would turn every export into a 500. Not a fix for this slice.

**Not changed (called out, not fixed here):**
- FU-1: the `timestamp` filter on R8 stays broken. A test pins it. *(✅ Closed by the data export follow-ups PR, branch `fix/data-export-history-and-columns`: `created_at`.)*
- `select('*')` on R1, R2, R3, R4, R6, R7 and R8 stays as it is. A **privacy follow-up** (FU-P1) should decide on explicit column lists, for example the internal fields in `audit_trail.*` and `user_subscriptions.*`. *(✅ Closed by the same PR: explicit column constants, plus NF-1, plugin connections were never exported because `metadata` does not exist.)*
- The 500 body returns `error.message` in production, which breaks the security rule in CLAUDE.md. Follow-up FU-P2. The response shape is pinned as is. *(✅ Closed by the same PR.)*
- `exportData: any` and `catch (error: any)` (rule 6). They stay untouched, and adding types is left for the follow-up so this diff stays mechanical. *(`catch` typed `unknown` by the same PR; `exportData: any` still open.)*

**Follow-up status** (updated 2026-10-04, [DATA_EXPORT_FOLLOWUPS_WORKPLAN.md](/docs/workplans/DATA_EXPORT_FOLLOWUPS_WORKPLAN.md)):

| # | Follow-up | Status | Owner |
|---|---|---|---|
| FU-1 | Export audit history (`timestamp` → `created_at`) | ✅ Closed by the data export follow-ups PR | — |
| FU-P1 | Explicit export column lists | ✅ Closed by the data export follow-ups PR | — |
| FU-P2 | No `error.message` in the production 500 | ✅ Closed by the data export follow-ups PR | — |
| FU-P3 | **Business OS data is not in the GDPR export.** The export covers only the 8 agent-platform tables; Business OS data (account and plan, credit charges / lots, invoices, CRM contacts, bookings, intake answers, …) is not in it at all. The requirement must separate the owner's own personal data from data the owner holds about their clients (where we are the processor), and settle size limits and whether it is the same download. **Until it is built, a Business OS owner's access request is answered by hand** | ⬜ Open | BA (requirement), routed by TL |

---

## 3. Files to create / modify

| File | Action | Reason |
|---|---|---|
| `app/api/user/data-export/__tests__/route.characterization.test.ts` | create | Pins today's behaviour. Written and green **before** the refactor, then kept unchanged |
| `app/api/user/data-export/route.ts` | modify | Reads go through repositories. Drop the `createClient` import and the BD-26 filter literals, and update the header comment |
| `lib/repositories/{UserProfile,Agent,Execution,AgentConfiguration,PluginConnection,UserSubscription,AuditTrail}Repository.ts` | modify | One export read each |
| `lib/repositories/CreditTransactionRepository.ts` | create | Single read method (OP-1) |
| `lib/repositories/__tests__/userDataExportReads.test.ts` | create | One recording-client test per new method: exact chain, `user_id` scoping, error returns `{data:null, error}` |
| `app/api/user/data-export/__tests__/route.test.ts` | modify | Its query assertions move to the repository level, see §4 |
| `lib/audit/__tests__/ownerAuditReads.guard.test.ts` | modify | Retarget the data-export rule to the repository method (§4, OP-3) |

---

## 4. Tests

1. **Characterization pin (step 1, before any move).** It uses the same `@supabase/supabase-js` mock style as the existing route test. That mock also covers `supabaseServer`, because the singleton is built with `createClient` at import time. It pins:
   - per table, the full ordered call chain (`select`, `eq`, `not`, `gte`, `order`, `limit`, `single`), with the date arguments frozen through `jest.useFakeTimers().setSystemTime(...)`;
   - the full response body for a seeded fixture: the profile spread including the override, the plugin mapping, the `[sub]` / `[]` cases and the `summary` keys;
   - status 200, the headers and the `Content-Disposition` prefix;
   - a PostgREST `{ data: null, error }` on any table gives an empty section and a 200;
   - 401 with no reads.

   The same file must pass, unedited, after the refactor.
2. **Repository unit tests.** One test per new method using a recording client: the exact chain matches the pin, scoping is present, and an error returns `{ data: null, error }` and logs `{ err }`. These live in `lib/repositories/__tests__`, which `test:bos-entitlements` already runs in CI.
3. **Existing route test.** It stays green. One case changes: "unexpected failure gives 500" today makes `profiles.single()` reject. After the refactor the repository catches that rejection and returns an error, so the case is driven by a rejecting `getUser()` instead (OP-4). postgrest-js already turns a fetch failure into `{ error }` rather than rejecting, so production behaviour does not change.
4. **BD-26 guard.** After the move the route no longer names `audit_trail`. The guard's stale-entry check and its "data export applies both exclusions" check would then fail. Proposed change:
   - remove the `DATA_EXPORT_ROUTE` special case, so the route falls under the normal rule and naming the table there again fails;
   - add a check that the body of `AuditTrailRepository.listOwnerEntriesForExport` matches `appliesBothOwnerExclusions`, with negative controls for each missing exclusion;
   - add a check that the route calls that method.

   `AuditTrailRepository.ts` is already allow-listed. Also check that `adminReadMethods.guard.test.ts` does not need the new method (it is owner-scoped, not admin).
5. Run `npm run test:bos-entitlements`, plus `npx tsc --noEmit` on the touched files (ts-jest does not type-check here).

---

## 5. Task list

- [x] ✅ 1. Write the characterization test against the current route and confirm it is green (no source change yet). With C-1's `createBrowserClient` mock (anon reads record under `anon:<table>`) and C-2's rules (route-owned log lines only; `jest.useFakeTimers({ now, doNotFake: ['nextTick','queueMicrotask','setImmediate'] })`). 27 tests green against the unmodified route
- [x] ✅ 2. Add the 7 repository methods and the new `CreditTransactionRepository`, with the C-6 table-driven unit test (20 tests)
- [x] ✅ 3. Switch the route to the repositories. Characterization test still green with no edit caused by the refactor (see deviation D-1 for two fixture-only edits, both re-verified against the original route)
- [x] ✅ 4. Adjust `route.test.ts`: C-1 `createBrowserClient` mock, OP-4 500 driver (rejecting `getUser()`), one new case "reads nothing on the browser anon client". The BD-26 query assertion is kept: it still holds end to end through `supabaseServer`
- [x] ✅ 5. Retarget the BD-26 guard (OP-3) and add negative controls
- [x] ✅ 6. `npm run test:bos-entitlements` green, tsc clean on the touched files, `git diff --numstat` sanity check

### Implementation results (Dev, 2026-10-04)

| Check | Result |
|---|---|
| `route.characterization.test.ts` (new, 464 lines) | 27/27 green against the ORIGINAL route (before any source change) and 27/27 against the refactored route. Final file re-run against both: the original route was swapped back in from `git show HEAD:` in a scratch copy, run, then the refactored route restored byte-identical (`cmp`). Mutation check: switching R3 to the default `ExecutionRepository()` (anon) fails 2 pin tests (read order + chain) |
| `route.test.ts` (modified) | 8/8 green (7 existing incl. the OP-4 change + 1 new anon-client case) |
| `lib/repositories/__tests__/userDataExportReads.test.ts` (new, C-6) | 20/20 green: per method the table, the scoping filter, the rows, the error path (`{ data: null, error }` + one `error` log with `{ err, userId }`), `[]` on null data, plugin 5-column select, R8 both exclusions |
| `lib/audit/__tests__/ownerAuditReads.guard.test.ts` (OP-3) | 14/14 green. `DATA_EXPORT_ROUTE` special case removed (route falls under the normal rule). New: method exists by name in `AuditTrailRepository.ts` (stale-entry check); the method BODY applies both exclusions; the route calls `auditTrailRepository.listOwnerEntriesForExport(` and names no `audit_trail` literal. Negative controls: route naming the table again (even with both exclusions) fails; each exclusion missing from the method body fails (the sibling `listOwnerEntries` has both, so a whole-file check would wrongly pass — the body is extracted); exclusions only in a comment fail; method renamed fails; route not calling the method (or only in a comment, or calling `listOwnerEntries`) fails |
| `npm run test:bos-entitlements` | 162 suites / 3803 tests green |
| `npm run test:authz-guard` | 1 suite / 119 tests green |
| `npm run typecheck:bos-llm` | passed: 405 files, 28 errors, 0 new. It reports 1 baseline entry fixed in `app/api/onboarding/build/route.ts` (not touched by this slice; not updated) |
| Scoped `tsc` (6 GB heap; temp tsconfig extending the root, the 13 touched files) | 0 errors |
| `eslint` on the 13 touched files | 0 errors, 4 warnings, all pre-existing `any` (route `exportData: any` / `catch (error: any)` per OP-6; `AgentConfigurationRepository:229`, `AgentRepository:110`) |
| `app/__tests__/tailwind-css-escape.guard.test.ts` | 6/6 green |
| `lib/business-os/__tests__/serverModulesStayServer.guard.test.ts` | green |
| Backslash + hex-digit scan (13 files + this workplan, and all added diff lines) | 0 |
| `console.*` in touched files | 0 in all 13 |
| `git diff --numstat` | route 38+/65-, guard 97+/16-, route.test 22+/8-, AuditTrailRepository 37+/1- (header comment line), the other 6 repositories additions only. No deletion without insertion |

### Deviations

- **D-1. Two fixture-only edits to the characterization test after the refactor, neither caused by it.** (a) The subscription fixture had `plan: 'pro'`, which the FR-12 tier-literal guard (`tierLiteral.forbidden.test.ts`, in `test:bos-entitlements`) flags; changed to `status: 'active'`. (b) Scoped tsc flagged `profile: null` against `FULL_SECTIONS.profile`'s type; widened the cast to `Record<string, unknown> | null` (type only). After each edit the pin was re-run against the original route (swapped in from `HEAD`) and the refactored route: 27/27 both times. No assertion, chain, or expected value changed.
- **D-2. `route.test.ts` keeps its BD-26 query assertion** rather than moving it out entirely: it still passes end to end via `supabaseServer` and costs nothing. The per-method check is in `userDataExportReads.test.ts`.
- **D-3. `lib/repositories/index.ts` not touched.** The route imports each repository from its own file; `CreditTransactionRepository` is not added to the barrel (not in §3's file list).
- **D-4. `PluginConnectionRepository` gained an exported `PluginConnectionExportRow` interface and a private `USER_DATA_EXPORT_COLUMNS` constant** (same 5-column string as before). The other export reads return `Record<string, unknown>` rows, since `select('*')` returns the row as stored.

**Estimate:** about 0.5 to 1 day (pin 2h, repos and tests 3h, route, guard and verification 2h). 🟢

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| A subtle change to a chain (order, `single` vs `maybeSingle`, column list) changes the export | The characterization pin compares the full chain per table and the body. It is written first and not edited afterwards |
| R3 accidentally reads with the anon browser client and returns `[]` under RLS | Explicit `new ExecutionRepository(supabaseServer)`. The pin checks R3 is called on the mocked service client |
| A repository error-logs R8's 42703 on every export | Accepted and visible. It actually surfaces FU-1. Level is `error` per standard (OP-5) |
| Weakening the guard while retargeting it | The negative controls stay. The route naming the table again fails the guard |
| Stacked branch drift if #202 changes before merging | Rebase onto #202 or `main` before review |

---

## 7. Open points for SA

- **OP-1.** Should the new `CreditTransactionRepository` hold one method, or should R7 go on `UserSubscriptionRepository` as the billing home? Dev recommends a new repository: one table per repository. ~~It becomes the future home for `CreditService`'s direct calls.~~ (Struck per SA OP-1: any write method there is a separate SA decision.)
- **OP-2.** Should R3 use `ExecutionRepository` built with an injected `supabaseServer`, or go on `AgentRepository` (service default, already queries `agent_executions`)? Dev recommends `ExecutionRepository` with injection.
- **OP-3.** Approve the guard retarget in §4.4. Changing the guard is a review decision, according to its header.
- **OP-4.** Approve the one change to an existing test case: the 500 path is driven by `getUser()` rejecting instead of a table read rejecting.
- **OP-5.** Should repository error logs on the export reads (notably R8's permanent 42703 until FU-1) use `error` or `warn`?
- **OP-6.** Confirm that the follow-ups FU-P1 (explicit export columns), FU-P2 (`error.message` in the production 500) and the `any` typing stay out of this slice.

---

## SA Review Notes

## SA Workplan Review (2026-10-04)

**Reviewed by SA — 2026-10-04**
**Status:** ✅ Approved with conditions (C-1 to C-6). Dev may start at task 1 once C-1 is folded into the pin.

The inventory matches `route.ts` line for line (8 reads, all service role, every error dropped, no rpc, 0 `console.*`). The approach is proportionate: one purpose-named read per owning repository, nothing reused that would change the export. Tenant isolation holds: every read is keyed on `user.id` from `getUser()`, never a request value, and nothing writes. Moving from a per-request `createClient(URL, SERVICE_ROLE_KEY)` to the shared `supabaseServer` singleton grants the same rights with the same key, so it is not a behaviour change. Acceptable.

### Rulings on the open points

| OP | Ruling |
|---|---|
| OP-1 | **New `CreditTransactionRepository`, approved — read-only by design.** One table per repository is the pattern. Conditions in C-3. Strike "future home for `CreditService`'s direct calls" from §7: any write method there is a separate SA decision, not implied by this slice |
| OP-2 | **`new ExecutionRepository(supabaseServer)`, approved.** The table's owner is the right home. `AgentRepository` querying `agent_executions` is an existing smell and should not grow. See C-1 for the test consequence |
| OP-3 | **Guard retarget approved as written in §4.4**, plus: keep a stale-entry check that `listOwnerEntriesForExport` exists by name in `AuditTrailRepository.ts`, and keep all three negative controls (each exclusion missing, and the route naming `audit_trail` again). `adminReadMethods.guard.test.ts` needs nothing: the method is owner-scoped |
| OP-4 | **Approved.** Driving the 500 through a rejecting `getUser()` is the honest equivalent: once a repository catches table rejections, the only way to reach the catch is a throw outside the reads. postgrest-js v2 resolves `{ error }` on fetch failure (no `throwOnError` in the route), so production behaviour is unchanged |
| OP-5 | **`error`.** Standard level for a failed read, and R8's 42703 is a real defect, so it should be loud until FU-1 lands. Same for the `.single()` reads: a user with no profile or no `user_subscriptions` row will log PGRST116 at `error` on R1 / R6. Accepted for this slice; do not add per-code level logic here. Exports are rare, so the noise is small |
| OP-6 | **Confirmed out of scope:** FU-P1 (explicit export columns), FU-P2 (`error.message` in the production 500), and the `any` typing (`exportData: any`, `catch (error: any)`). They are pre-existing and pinned as is. Keep the diff mechanical |

### Conditions

1. **C-1 (blocking, task 1). Make the pin refactor-proof up front.** `ExecutionRepository` imports `@/lib/supabaseClient`, which calls `createBrowserClient` from `@supabase/ssr` at module load. The current route-test mock of `@supabase/ssr` exposes only `createServerClient`, so as soon as the route imports `ExecutionRepository` the test file fails at import, and the "unedited" rule would be broken. The characterization test must, from its first version, mock `createBrowserClient` too, returning a **distinct** client whose `from()` records under an `anon:` key (or throws). That is also the only way the §6 mitigation "the pin checks R3 is called on the mocked service client" can actually be asserted: today both `createClient` calls return the same mock. The same mock addition goes into `route.test.ts` under task 4.
2. **C-2. The pin asserts route-owned behaviour only.** Assert the route's own log lines (`Data export started`, `Data export completed`, audit-logged / audit-failed, `Data export failed`), not the total log count or "no error logs". The repositories legitimately add an `error` log on the `{ data: null, error }` case after the move. Freeze time with `jest.useFakeTimers({ now })` or `setSystemTime`, and keep `nextTick` / `queueMicrotask` real if anything awaits through them. Do not pin `export_duration_ms` / the `Content-Disposition` timestamp beyond what the frozen clock makes deterministic.
3. **C-3. `CreditTransactionRepository` is read-only and says so.** Header comment: `credit_transactions` is a Pilot-Credit (agent platform) table; writes stay in `CreditService` / `rewardService` / Stripe routes; Business OS must not read or write it through this repository (B-8 / RD-2); adding any write method needs SA review. Constructor takes an optional client and defaults to `supabaseServer`, plus the exported singleton, as with its siblings. The same applies to the new `UserSubscriptionRepository.findForUserDataExport`: a read only, no change to the grant writers.
4. **C-4. Repository shape.** Each new method: `.eq('user_id', userId)` (R1 `.eq('id', userId)`), try/catch, returns `RepositoryResult` `{ data, error }`, logs `{ err, userId }` with the repository's existing Pino logger, and has the `GDPR export only` JSDoc. R2's JSDoc must say that including deleted / inactive agents is deliberate. R8's two exclusions are written as in `listOwnerEntries`. Do not refactor `listOwnerEntries` to share a helper in this slice.
5. **C-5. Errors stay ignored in the route.** `const { data: x } = await repo.method(...)` with the same `|| []` / `|| {}` / `? [x] : []` fallbacks. No new early return, no new 500. This is required, because R8 fails permanently until FU-1.
6. **C-6. Trim the repository unit tests.** The characterization pin already covers the exact chain per table. `userDataExportReads.test.ts` should be one table-driven file that checks, per method, the scoping filter and the error path (`{ data: null, error }` plus an `{ err }` log), and for R8 that both exclusions are present. Do not re-pin each full chain a second time.

### Housekeeping (non-blocking)
- Update the route header comment (drop "use a direct service-role client rather than a repository"), and mark the repository half of FU-1 as done in the BD-26 workplan when this merges.
- `git diff --stat` before reading the diff (truncation hazard). Rebase on `main` once #202 merges.

### Business questions
None.

### Approval
[x] Workplan approved — proceed to implementation once C-1 is reflected in task 1. Estimate of 0.5 to 1 day stands; C-6 trims it slightly.

## SA Code Review (2026-10-04)

**Code Review by SA — 2026-10-04**
**Status:** ✅ Code Approved. No blocking findings. Per the user's request for proportionate effort, SA also ran the QA-style pass below, so no separate QA cycle is needed.

### What was checked

| Area | Result |
|---|---|
| Zero behaviour change | ✅ The 8 repository chains match the original route's chains exactly (table, columns, filters, `.single()` on R1 / R6, order, limits; R5's 5-column select). Cut-offs are still computed in the route and passed in. Profile spread, plugin mapping, `[sub]` / `[]`, summary, logs, `auditLog`, headers and the 500 handler are unchanged |
| Pin re-verified against the ORIGINAL route by SA | ✅ Independently, with no repo edit: `git show HEAD:` route copied to the scratchpad and mapped in for `../route` through a scratch Jest config. 27/27 green. Mutation control: `.limit(1000)` changed to `999` in the scratch copy fails 1 test, which proves the mapping was live. The D-1 edits (`plan` changed to `status`, a type-only widening of the cast) change no assertion, chain or expected value |
| R3 on `supabaseServer` | ✅ Route builds `new ExecutionRepository(supabaseServer)`. The C-1 anon trap is real: both test files mock `createBrowserClient` as a distinct `anon:`-recording client. The pin asserts the read order is all `service:` and that nothing is read on `anon:`. `route.test.ts` adds the same check |
| C-5 errors ignored | ✅ `const { data: x } = await ...` with the original fallbacks (`or []`, profile spread, `? [x] : []`). No new early return or 500. The pin covers a PostgREST error on each of the 8 tables plus all failing at once: still 200 with empty sections |
| C-4 method shape | ✅ All 8: user filter (R1 `.eq('id')`), try/catch, `{ data, error }` `RepositoryResult`, `error` log with `{ err, userId }` on the repository's existing logger, `GDPR export only` JSDoc. R2's JSDoc says deleted / inactive are included on purpose. R8's exclusions are written character for character as in `listOwnerEntries`, with no shared helper, and the `timestamp` / FU-1 note is kept |
| C-3 `CreditTransactionRepository` | ✅ One read method, no writes. The header says Pilot-Credit table, writes stay in CreditService / rewardService / Stripe, no Business OS use (B-8 / RD-2), and SA review for any write. Optional client with `supabaseServer` default, plus the singleton |
| No writes / nothing else changed | ✅ The repository diffs are additions only (one read each, plus D-4's private constant and export-row type). `AuditTrailRepository` has one header comment line changed. `UserSubscriptionRepository` grant writers are untouched. `index.ts` is untouched (D-3, fine) |
| OP-3 guard retarget | ✅ The `DATA_EXPORT_ROUTE` special case is gone. New: the method exists by name (stale-entry check), the method BODY applies both exclusions (it is extracted so the sibling `listOwnerEntries` cannot mask a gap), and the route calls the method and names no `audit_trail` literal. Negative controls: the route naming the table again (even with both exclusions), each exclusion missing, exclusions only in a comment, the method renamed, the route not calling it / calling it only in a comment / calling `listOwnerEntries` |
| CI coverage | ✅ All 4 files are in `test:bos-entitlements` (`app/api/user/data-export/__tests__`, `lib/repositories/__tests__`, `lib/audit/__tests__`) |
| Logging / hygiene | ✅ 0 `console.*` in the 14 touched / new files. No backslash+hex sequences. No dead imports in the route (`createClient`, `OWNER_HIDDEN_ENTITY_TYPES`, `AI_ACTION_EVENT_PREFIX` removed) |

### Code Review Comments
1. **CRX-1** `app/api/user/data-export/route.ts` (module scope) — the route now imports `ExecutionRepository`, whose module loads the `'use client'` `@/lib/supabaseClient` and builds a browser client at import time on the server. This is not new: `app/api/agents/route.ts` and others already do it, and the route never uses that client. Note only. A later cleanup could give `ExecutionRepository` a server default. — Priority: Low (no action this slice)
2. **CRX-2** `lib/repositories/UserSubscriptionRepository.ts` `findForUserDataExport` — logs an extra `method` field besides `{ err, userId }`. That matches the file's existing convention, so it is correct as is. — Priority: Low (informational)
3. **CRX-3** `lib/audit/__tests__/ownerAuditReads.guard.test.ts` `methodBody` — counts braces naively, as its comment states. A future body with an unbalanced `{` inside a string would mis-extract it, but that fails CLOSED (the exclusion check returns false or the body is null), so it cannot let a gap through silently. — Priority: Low (informational)
4. **CRX-4** R1 / R6 `.single()` — an account with no `profiles` or `user_subscriptions` row now logs PGRST116 at `error` on every export, and R8 logs 42703 on every export until FU-1. Accepted under OP-5 and pinned only as route behaviour. Recorded so the logs are not mistaken for a regression after deploy. — Priority: Low (accepted)

### Optimisation Suggestions
- When this merges: mark the repository half of FU-1 done in the BD-26 workplan (housekeeping from the workplan review), and keep FU-P1 / FU-P2 / the `any` typing tracked as follow-ups. *(2026-10-04: FU-1, FU-P1 and FU-P2 closed by the data export follow-ups PR; FU-P3 added; see "Follow-up status" in §2.)*

### QA-style pass (SA, 2026-10-04)
| Run | Result |
|---|---|
| `route.characterization.test.ts` vs refactored route | 27/27 |
| `route.characterization.test.ts` vs ORIGINAL route (scratch mapping, + mutation control) | 27/27 (mutation: 1 fail as expected) |
| The 4 named files (characterization, `route.test.ts`, `userDataExportReads.test.ts`, `ownerAuditReads.guard.test.ts`) | 4 suites / 69 tests green (27 + 8 + 20 + 14) |
| `npm run test:bos-entitlements` | 162 suites / 3803 tests green |

### Code Approved for QA: Yes. The QA pass is folded in above, so this can go to the user diff view and then RM.

## QA Testing Report

_(QA)_

## Commit Info

_(RM)_

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-04 | Created | Dev workplan: call inventory, per-repository read plan, characterization pin, guard retarget, open points OP-1 to OP-6 |
| 2026-10-04 | SA workplan review | Approved with conditions C-1 to C-6. OP-1 new read-only `CreditTransactionRepository`; OP-2 `ExecutionRepository` with injected `supabaseServer`; OP-3 guard retarget approved; OP-4 approved; OP-5 `error`; OP-6 follow-ups stay out. Blocking C-1: the pin must mock `createBrowserClient` from the start |
| 2026-10-04 | Implemented (Dev) | Characterization pin written first (C-1/C-2) and green on the original route; 7 repository reads + read-only `CreditTransactionRepository` (C-3/C-4); route switched with errors still ignored (C-5); C-6 table-driven repository test; `route.test.ts` C-1 mock + OP-4; BD-26 guard retargeted to the repository method body with negative controls (OP-3); OP-1 line struck in §7. All checks green; deviations D-1 to D-4. Status Code Complete, uncommitted |
| 2026-10-04 | SA code review | Code Approved, no blocking findings (CRX-1 to CRX-4, all Low). The pin was re-verified by SA against the original route via a scratch mapping, with a mutation control. QA-style pass folded in: 4 named files 69/69, `test:bos-entitlements` 162 suites / 3803 tests green |
| 2026-10-04 | Follow-ups closed (Dev) | FU-1, FU-P1 and FU-P2 marked closed by the data export follow-ups PR (`fix/data-export-history-and-columns`); FU-P3 (Business OS data is not in the GDPR export) added, routed to BA |
