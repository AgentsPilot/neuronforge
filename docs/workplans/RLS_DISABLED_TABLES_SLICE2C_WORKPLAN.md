# Workplan: RLS-disabled tables, slice 2c (the six agent-platform tables)

> **Last Updated**: 2026-10-15

**Developer:** Dev
**Requirement:** none. This is a security fix commissioned by TL, on the same footing as slices 2a and 2b. Parent workplan: [RLS_DISABLED_TABLES_SLICE2_WORKPLAN.md](/docs/workplans/RLS_DISABLED_TABLES_SLICE2_WORKPLAN.md) (2c sections, SA conditions C-1 to C-11, "2c acceptance"). The stopgap and route map are in [EXPOSED_VIEWS_SLICE1B_WORKPLAN.md](/docs/workplans/EXPOSED_VIEWS_SLICE1B_WORKPLAN.md) ("Slice 2c: anon-only stopgap assessment").
**Base:** `origin/main` @ `49b66feb`. It holds PR #360 (1b `20261059` and stopgap `20261060`), which merged after the brief was written. Nothing here branches from `fix/exposed-views-slice-1b`.
**Branches:** RM creates them. Two PRs, both off `origin/main`, **not stacked**. The file sets do not overlap:
- `fix/rls-2c1-sharing-off` (2c-1; was `fix/rls-2c1-agent-share-routes`, renamed by the re-scope. RM may keep the old name if the branch already exists)
- `fix/rls-2c2-agent-tables-rls` (2c-2)

The workplan itself was drafted in the Dev agent worktree. It is not committed.
**Migration number:** `20261062`. `20261061` is skipped (SA ruling 1, 2c-2 code review). See [Migration number](#migration-number).
**Date:** 2026-10-14
**Status:** ✅ **COMPLETE** (2026-10-15). 2c-1 and 2c-2 are merged (PRs #369, #370), and 2c-2 (`20261062`) was applied to production on 2026-10-14. See [2c-2 production apply record](#2c-2-production-apply-record-2026-10-14). The 24h log watch is noted in the apply record.
**Earlier status:** SA workplan review 2026-10-14: **APPROVED WITH CHANGES** (see [SA Review Notes](#sa-review-notes)). **Re-scoped by SA the same day after the user's BQ-1..BQ-4 answers: sharing is switched off.** The [re-scope section](#re-scope-after-the-users-decisions-2026-10-14) overrides everything below it where they differ. 2c-1 is now "switch sharing off" (mostly deletions). 2c-2 locks the two sharing tables to the service role and drops T-1. S-2 (D-0a) and S-3 are captured, so the 2c-2 SQL may be written. Nothing applied and nothing committed.

## Overview

The last six `public` tables with row level security off all belong to the agent platform:

- `agent_configurations`
- `agent_executions`
- `agent_logs`
- `agent_stats`
- `shared_agents`
- `shared_agent_imports`

The stopgap `20261060` closed them to signed-out visitors. **Any signed-in user can still read, change and delete every other user's rows**, because RLS is off and `authenticated` holds SELECT, INSERT, UPDATE and DELETE. Supabase still reports `rls_disabled_in_public` for all six. The stopgap also broke one user action: "Share agent to template gallery". Three API routes run on the server with the browser client, so they talk to the database as `anon`.

This slice finishes the job in small parts. **The table below is the original plan and is SUPERSEDED (re-scope).** The current slice list is in [Re-scope § New slice list](#new-slice-list).

| Slice | What | Ships as | Restores / closes |
|---|---|---|---|
| **2c-0** | TL runs read-only prod captures (F1–F8). Dev cannot write the SQL without them | no PR | the facts the SQL pins |
| **2c-1** | Fix the three share/metrics routes: session identity, cookie client, Zod, Pino with correlationId. Remove the browser-client repository defaults. Add the C-7 guard | code PR | **"Share agent" works again** once deployed. Closes the `x-user-id` header IDOR on these routes |
| **2c-2** | Migration `20261062`: enable RLS, add owner policies with agent-ownership checks (C-4), least-privilege grants, and make the import counter trigger definer-rights. Ships with a pre-check, checker, rollback, static test and PGlite dry run | SQL PR, hand-applied by TL **after 2c-1 is live** (C-6) | Closes the cross-tenant hole for signed-in users. Clears `rls_disabled_in_public`. Keeps the template gallery and import counter working |

## Table of Contents

0. [Re-scope after the user's decisions (2026-10-14)](#re-scope-after-the-users-decisions-2026-10-14)
1. [Starting state (pinned, not re-derived)](#starting-state-pinned-not-re-derived)
2. [Migration number](#migration-number)
3. [Code-path census](#code-path-census)
4. [Database-side callers](#database-side-callers)
5. [Design decisions](#design-decisions)
6. [Slice 2c-0: prod captures (TL, read-only)](#slice-2c-0-prod-captures-tl-read-only)
7. [Slice 2c-1: route fixes (code PR)](#slice-2c-1-route-fixes-code-pr)
8. [Slice 2c-2: RLS migration 20261062](#slice-2c-2-rls-migration-20261062)
9. [Non-compliant files](#non-compliant-files)
10. [Risks](#risks)
11. [Open questions for SA](#open-questions-for-sa)
12. [Business questions for the user](#business-questions-for-the-user)
13. [Follow-ups (not in 2c)](#follow-ups-not-in-2c)
14. [SA Review Notes](#sa-review-notes)
14a. [2c-2 production apply record (2026-10-14)](#2c-2-production-apply-record-2026-10-14)
15. [QA Testing Report](#qa-testing-report)
16. [Commit Info](#commit-info)
17. [Change History](#change-history)

---

## Re-scope after the user's decisions (2026-10-14)

**By SA, 2026-10-14.** This section overrides everything below it where they differ. The items it replaces are marked **SUPERSEDED (re-scope)** where they stand.

### User decisions

| # | Question | Decision (user, 2026-10-14) | Effect |
|---|---|---|---|
| BQ-1 | Template gallery for signed-out visitors | **Signed-in users only** | Moot in practice: the gallery is switched off (BQ-2) |
| BQ-2 | Keep sharing working? | **No. Switch sharing off.** The template gallery and "share an agent" are no longer wanted as working features | Sharing is removed, not restored. 2c-1 becomes "switch sharing off". 2c-2 locks the two sharing tables to the service role |
| BQ-3 | The sharing credit reward | **Remove the promise** | It goes with the Share UI (R-2). No server-side grant is built. FU-3 becomes "delete the reward code" |
| BQ-4 | Re-own the one `agent_stats` row to the agent owner | **Yes** | D-0b goes ahead as specified in S-2: a guarded single-row UPDATE plus a reverse script, both pasted by the user |

### Findings that shaped the ruling

- **The metrics route has one caller, and it is the Share flow.** `/api/agents/[id]/metrics` is called only through `metricsApi.getBasicMetrics` (`lib/client/agent-api.ts:399`), and only from `handleShareAgent` (`app/v2/agents/[id]/page.tsx:1879`). Once Share is gone, nothing calls it. It is broken today (500 since the stopgap) and trusts `x-user-id`. **Delete it. Do not fix it.**
- **`SharedAgentRepository` is used only by the two `/api/shared-agents` routes.** It is dead once they go.
- **`components/v2/templates/*` is used only by `app/v2/templates/page.tsx`.**
- **`app/v2/agents/[id]/page-redesign.tsx` is dead.** It is not a routed file and nothing imports it, but it imports `sharedAgentApi`, so it would stop type-checking once that export is removed.
- **No one is owed anything.** `shared_agents` and `shared_agent_imports` hold 0 rows (F5), so no sharing reward is outstanding and no import history is lost.
- **The legacy `/agents/[id]` page already fails safe.** In `app/(protected)/agents/[id]/page.tsx`:
  - It shows its Share button only while `/api/rewards/agent-sharing` reports the `agent_sharing` reward as active.
  - It ignores the `error` on its `shared_agents` reads. Under a 42501, those reads mean "not shared" or "Assistant not found", and both answers are correct.
  - Its share is a direct browser INSERT into `shared_agents`, which 2c-2 closes.
- **`update_agent_schedule_safe` writes `agent_executions`** (S-3 capture): it cancels queued and pending runs and swallows every error. Under owner RLS it can cancel only the caller's own runs. Another user's queued run on the same agent is skipped silently. D-0a found no queued or pending run in the mismatch set, so this is accepted (census corrected below, FU-13).
- **The unqualified table name in `increment_shared_agent_import_count`** mattered only for T-1. T-1 is dropped (R-6).

### Rulings

**R-1. Switch sharing off by removing it, not with a flag.**

- **Why not a flag.** The env flags in `lib/utils/featureFlags.ts` are rollout and kill switches for live features ([feature_flags.md](/docs/feature_flags.md)). A "sharing enabled" flag would be false advertising after 2c-2: the tables become service-role only, so turning the flag on would produce a broken feature. Bringing sharing back needs a migration and new routes either way.
- **Why not fixed 404/410 handlers.** A route kept only to refuse is still surface to maintain and guard.
- **What to do instead.** Delete the route files. Next.js returns 404 on its own, and git history is the restore path.
- No new flag, no 410 handlers.

**R-2. The bonus promise goes with the Share UI.**

- **On `/v2/agents/[id]`**, these all go: "Share with community and earn credits", "Share & Earn Credits", the reward panel, the success toast, and the "will be credited later" alert.
- **On the legacy `/agents/[id]` page**, reuse the existing switch instead of editing a 24-`console.*` file. The user deactivates the `agent_sharing` reward in `/admin/reward-config` (operator step **OS-1**: no code, reversible). `/api/rewards/agent-sharing` then reports it inactive, and the legacy Share button and its credit text stay hidden.
- **The reward code itself** is deleted later, under FU-3.

**R-3. One code slice.** All the sharing-off code ships as one PR (2c-1). It is mostly deletions and has no database step.

**R-4. 2c-1 no longer gates the 2c-2 apply.** C-6, T1-8 as a gate, and S-8 step 1 are superseded. Either order is safe:

| Order | What happens in between | Verdict |
|---|---|---|
| 2c-2 applied first | v2 Share already fails today (500). Signed-in visits to the unlinked gallery pages get a permission error instead of a list. The legacy page reads degrade to "not shared". The sidebar badge hides itself (`templateCount = null`). | No data exposure and no new write path. Cosmetic errors only, on pages nobody is sent to |
| 2c-1 deployed first | Routes and pages are gone. The tables stay in the stopgap state, so the legacy page could still insert directly until OS-1 or 2c-2. That is today's state, not a new one | Safe |

The preferred order is still 2c-1 first, then 2c-2. But TL must not hold the security migration for the UI PR.

**R-5. The two sharing tables are locked completely.**

- **The lock.** On `shared_agents` and `shared_agent_imports`:
  - RLS enabled, never forced (D-3)
  - `REVOKE ALL ... FROM PUBLIC, anon, authenticated`
  - no client grant and **no policies**
  - `service_role` keeps ALL (untouched)
- **Owner-only policies were considered and rejected.** They need client INSERT/SELECT grants and the C-4 check for a feature that no longer has a legitimate client caller. They would also keep the legacy page's direct INSERT working, which is exactly what BQ-2 switches off.
- **Advisor.** After apply, Supabase may report `rls_enabled_no_policy` (INFO) on the two tables. That is intended: record it in the apply record and do not "fix" it.

**R-6. T-1 is dropped, and the trigger is left exactly as it is.**

- **Why the trigger still works.** With no client grant on `shared_agent_imports`, only the service role or the owner can insert, and both bypass RLS. The invoker trigger therefore keeps working for every caller that can still reach it.
- **What goes with T-1.** No SECURITY DEFINER function, no EXECUTE revoke, no function rollback, no body pins.
- **Parent ruling 2 (option a) stands.** T-1 no longer supersedes it.
- **Superseded:** S-6, S-7, Q-2C-1, Q-2C-6, R2-4, R2-9.

**R-7. Kept unchanged:**

- the C-4 owner policies on the four agent tables (D-1 rows 1–4, 12 policies)
- D-2 grants for those four
- D-3 (never FORCE)
- S-1 (the documented exception rows)
- **the S-4 pin-based stop rule** (agent_stats 0 after D-0b)
- D-0b (now approved by the user)
- C-8 `lock_timeout`, C-10 paste rules
- the pre-check / migration / checker / rollback / static test / PGlite dry-run structure
- probes P-11 and P-12

**R-8. Q-2C-2 (singletons), re-ruled.**

- **`ExecutionRepository`: kept.**
  - The constructor requires a client, and the singleton and the `@/lib/supabaseClient` import are removed.
  - Once the metrics route goes, nothing imports the singleton, and every other caller already passes a client. It is free hardening.
  - The `findByAgentId` `userId` option is **reverted**: its only caller was the metrics route. Q-2C-7 is superseded.
- **`SharedAgentRepository`: superseded.** Delete the file and its `index.ts` export.

**R-9. The C-7 guard is kept, with changes.**

- **(a) stays:** no `lib/repositories/` file imports `@/lib/supabaseClient`. The allow-list of 3 keeps S-13 (dated, capped by equality, stale-entry check).
- **(b) is dropped.** The two singletons no longer exist, and importing a removed export already fails the build.
- **(c) is new, and cheap.** No file under `app/`, `components/`, `lib/` or `hooks/` may reference `/api/shared-agents`, `/api/agents/import-shared` or `/v2/templates`, and `app/(protected)/layout.tsx` has no `href="/templates"`. It has mutation self-tests, runs in milliseconds, and sits inside the existing Jest gate. It stops a dead link from creeping back.

**R-10. The `existsByOriginalAgent` fix is superseded**, because the file is deleted. S-9, S-10, S-11 and S-12 are superseded too, since their routes are deleted.

**R-11. Logging rule for the touched files** (CLAUDE.md § Logging):

| File | `console.*` calls |
|---|---|
| `app/v2/agents/[id]/page.tsx` | 54 |
| `components/v2/Footer.tsx` | 13 |
| `app/api/help-bot-v2/route.ts` | 33 |

- Dev flags all three, and TL puts the conversion to the user as **one** question.
- Convert unless the user declines. If converted, do it as a separate commit in the same PR, so the sharing deletions stay readable in review.
- Every file this slice deletes leaves the count by deletion. `app/(protected)/layout.tsx` is already compliant.

### New slice list

| # | Slice | Who | Ships as | Gate |
|---|---|---|---|---|
| 1 | **2c-0: prod captures** (F1–F8, S-3 bodies, D-0a pins) | TL | ✅ done: [capture doc](/docs/workplans/RLS_DISABLED_TABLES_SLICE2C_PROD_CAPTURE_2026-10-14.md) | — |
| 2 | **2c-1: switch sharing off** | Dev | code PR `fix/rls-2c1-sharing-off` | SA code review → QA → user diff → RM |
| 3 | **OS-1: deactivate the `agent_sharing` reward** in `/admin/reward-config` | user (admin UI) | no PR | any time. Recommended with or before 2c-1 deploy |
| 4 | **2c-2: migration `20261062` + D-0b scripts** | Dev writes, user pastes D-0b, TL applies the migration with the user's authorization | SQL PR `fix/rls-2c2-agent-tables-rls` | not gated on slice 2 (R-4) |

**2c-2 apply order** (replaces S-8):

1. D-0b (user pastes; the reverse script is on hand)
2. pre-check CLEAN, including the S-4 pin with `agent_stats` = 0
3. migration in a new tab
4. checker
5. probes
6. advisor
7. 24 h log watch

#### Slice 2c-1: switch sharing off (replaces [Slice 2c-1: route fixes](#slice-2c-1-route-fixes-code-pr))

**Skills:** `new-api-route` does not apply, because no route is created or kept. `tenant-isolation-guard` does not apply either: no new write path.

| File | Action | Reason |
|---|---|---|
| `app/api/shared-agents/route.ts` | **delete** | share POST: R-1 |
| `app/api/shared-agents/exists/route.ts` | **delete** | R-1 |
| `app/api/agents/import-shared/route.ts` | **delete** | gallery import: R-1. It closes FU-2 |
| `app/api/agents/[id]/metrics/route.ts` | **delete** | its only caller was the Share flow (findings). It also removes the `x-user-id` IDOR |
| `app/(protected)/templates/page.tsx` | **delete** | legacy gallery, including its browser INSERT into `shared_agent_imports` |
| `app/v2/templates/page.tsx` | **delete** | v2 gallery |
| `components/v2/templates/AgentTemplateCard.tsx`, `AgentTemplateList.tsx`, `TemplatePreviewModal.tsx`, `index.ts` | **delete** | only importer is the v2 gallery page |
| `app/v2/agents/[id]/page-redesign.tsx` | **delete** | dead (not routed, no importer) and imports `sharedAgentApi`. Dev re-confirms that nothing imports it |
| `lib/repositories/SharedAgentRepository.ts` | **delete** | R-8 |
| `app/v2/agents/[id]/page.tsx` | modify (deletions only) | Remove:<br>• the "Share to Templates" button<br>• the share confirmation modal and success toast<br>• `handleShareAgentClick`, `handleShareAgent`, `checkSharingEligibility` and its effect<br>• the `/api/rewards/agent-sharing` fetch<br>• the `agent_sharing_reward_amount` key (keep `tokens_per_pilot_credit`)<br>• the share and reward state<br>• the now-unused imports (`sharedAgentApi`, `metricsApi`, `Share2` if unused)<br>Nothing else changes. Logging: R-11 |
| `lib/client/agent-api.ts` | modify | remove `sharedAgentApi` and `metricsApi` |
| `app/(protected)/layout.tsx` | modify | remove the Templates `SidebarLink`, the `shared_agents` count fetch, and its state and ref |
| `components/v2/Footer.tsx` | modify | remove the Templates menu button (and `Sparkles` if unused). Logging: R-11 |
| `app/api/help-bot-v2/route.ts` | modify | remove the `[Templates](/v2/templates)` line from the help text. Logging: R-11 |
| `lib/repositories/ExecutionRepository.ts` | modify | the client is required; the singleton and the browser import go (R-8). No `userId` option |
| `lib/repositories/index.ts` | modify | drop the `executionRepository` singleton export and the `SharedAgentRepository` export line |
| `lib/repositories/__tests__/anon-default-repositories.guard.test.ts` | create | R-9 (a) + (c), with mutation self-tests |
| `docs/workplans/RLS_DISABLED_TABLES_SLICE2C_WORKPLAN.md` | modify | ticks, QA notes |

**Not touched, on purpose:**

- **The legacy `app/(protected)/agents/[id]/page.tsx`.** OS-1 hides its Share button, and 2c-2 closes its write.
- **The code that `/agents/[id]` page still uses:** `/api/rewards/agent-sharing`, `ConfigRepository.isRewardActive`, `AgentSharingValidator`, `RewardService` and `AgentScoreService`.
- **`app/api/cron/update-template-scores`**, which runs as the service role over 0 rows.
- **`lib/cron/__tests__/vercelCrons.test.ts`.**

All of these are FU-12.

**Tasks:**

- ⬜ T1-1 Confirm the branch. **Open:** the work sits on `worktree-agent-a5313d72f06a51a47` (base `49b66feb`), not `fix/rls-2c1-sharing-off`. RM moves it at PR time
- ✅ T1-2 Apply the stop/revert list below
- ✅ T1-3 The deletions. Then `git grep` for every deleted module path and export name: zero importers (see [Dev implementation notes](#dev-implementation-notes-2c-1))
- ✅ T1-4 The modifications
- ✅ T1-5 The guard
- ✅ T1-6 Guard, `lib/repositories/__tests__`, `supabase/__tests__`, `supabase/migrations/__tests__`, the authz guard, eslint on touched files, `lint:hooks`, and scoped `tsc`: zero new errors. The full `npm test` is left to CI (see notes)
- ✅ T1-6b R-11 logging conversion of the three touched files, kept as a separable change
- ⬜ T1-7 SA code review → QA → user sees the diff → RM PR
- ⬜ T1-8 QA on production after deploy. Not a gate for 2c-2.
  - `/v2/agents/[id]` shows no Share action and no credit promise.
  - `/v2/templates`, `/templates`, `/api/shared-agents`, `/api/shared-agents/exists`, `/api/agents/import-shared` and `/api/agents/<id>/metrics` all return 404.
  - Neither sidebar nor footer shows Templates.
  - After OS-1, the legacy `/agents/<id>` shows no Share button.

**Risks:** removing an export breaks an importer that the grep missed. The mitigations are T1-3's grep, `tsc` on the touched set, the full Jest suite and `next build` in CI. R1-1..R1-4 are superseded.

#### 2c-2 changes (a delta on [Slice 2c-2](#slice-2c-2-rls-migration-20261062))

| Item | Was | Now |
|---|---|---|
| D-1 `shared_agents` | gallery SELECT `true` + owner INSERT | **no policies** |
| D-1 `shared_agent_imports` | owner INSERT | **no policies** |
| Policy count | 16 | **12** (4 tables × select/insert/update) |
| D-2 sharing tables | authenticated SELECT, INSERT / INSERT | **nothing** for PUBLIC, anon or authenticated; `service_role` ALL, untouched |
| D-4 / T-1 | definer-rights trigger function | **dropped.** The function and the trigger are not touched |
| Pre-check Q10 and pre-guard function pins | T-1 pins | **dropped.** Q9 still lists triggers, for information |
| Checker | T-1 rows | removed. Added: both sharing tables have RLS on, are not forced, have 0 policies, and give no privilege to PUBLIC, anon or authenticated |
| Rollback | drop 16 policies; restore the function body and ACL | drop **12** policies by name; `REVOKE ALL` + `GRANT SELECT, INSERT, UPDATE, DELETE ... TO authenticated` on all six; DISABLE RLS; no function step. The final DO still asserts the stopgap state |
| Static test | exactly one SECURITY DEFINER | **no SECURITY DEFINER** in any of the six SQL files (the four 2c-2 files + the D-0b pair). Exactly 12 CREATE POLICY statements. No CREATE POLICY and no GRANT to a client role on the two sharing tables |
| Probes | P-6 gallery count equal; P-8 / P-8b import counter | **P-6:** authenticated SELECT on `shared_agents` → 42501. **P-8:** authenticated INSERT into `shared_agent_imports` → 42501. P-8b is dropped. P-10 stays (42501). P-11 (D-0b agent) and P-12 stay |
| PGlite dry run | included the invoker trigger and T-1 | sets up the trigger as today, and asserts it is unchanged after the migration and the rollback |
| Advisor | no SECDEF finding | no `rls_disabled_in_public` on the six. `rls_enabled_no_policy` (INFO) on the two sharing tables is expected (R-5) |
| Apply prerequisite | T1-8 (2c-1 live) | **none on 2c-1** (R-4). D-0b first, then a CLEAN pre-check |
| T2-12 parent update | "T-1 supersedes ruling 2" | "ruling 2 stands; the user switched sharing off (BQ-2, 2026-10-14); the two sharing tables are service-role only" |

The census row for `update_agent_schedule_safe` is corrected: it updates `agents`, **and** cancels the queued and pending `agent_executions` of that agent. Under 2c-2, that means only the caller's own (FU-13).

### Superseded, closed and new follow-ups

- **Superseded:**
  - T-1 / D-4, D-5, S-6, S-7, S-9..S-12
  - C-6 as an apply gate, and S-8 step 1
  - Q-2C-1, Q-2C-5, Q-2C-6, Q-2C-7
  - B-4, B-5, R1-1..R1-4, R2-4, R2-7, R2-8, R2-9
  - P-8b, and the old P-6 / P-8 expectations
  - the `existsByOriginalAgent` fix
  - the integration tests for the three routes
  - C-7 guard part (b)
- **Follow-ups closed:**
  - FU-2: the route is deleted.
  - FU-4: no more client-supplied scores.
  - FU-10: no duplicate shares are possible while sharing is off.
- **Follow-ups changed:**
  - FU-3 becomes "delete the sharing reward code", with no server grant.
  - FU-8 is downgraded: it bites only if a row is ever inserted, and inserts are now service-role only. Fix it if sharing is ever revived, or under FU-12.
- **New follow-ups:** FU-12 and FU-13, in the [follow-up table](#follow-ups-not-in-2c).

### Dev: stop and revert (uncommitted work in this worktree)

Use `git checkout -- <file>`, `git rm` or `rm`. **Never `git stash`.**

| Path | Action |
|---|---|
| `app/api/agents/[id]/metrics/route.ts` | **stop.** Discard the edits and delete the file |
| `app/api/agents/[id]/metrics/__tests__/` | delete |
| `app/api/shared-agents/route.ts`, `app/api/shared-agents/exists/route.ts` | discard the edits and delete both files |
| `app/api/shared-agents/__tests__/`, `app/api/shared-agents/exists/__tests__/` | delete |
| `lib/repositories/SharedAgentRepository.ts` | delete the file |
| `lib/repositories/__tests__/SharedAgentRepository.test.ts` | delete |
| `lib/repositories/ExecutionRepository.ts` | **keep** the required client and the singleton removal. **Revert** the `findByAgentId` `userId` option and its doc comment |
| `lib/repositories/__tests__/ExecutionRepository.findByAgentId.test.ts` | delete |
| `lib/repositories/index.ts` | keep the `executionRepository` removal. Delete the `SharedAgentRepository` export line and reword the comment |
| `lib/repositories/__tests__/anon-default-repositories.guard.test.ts` | keep (a). Drop (b). Add (c) (R-9) |

---

## Starting state (pinned, not re-derived)

TL's brief gives the production state on 2026-10-14. The 2c-2 pre-guard pins exactly this state, as the parent workplan's "2c acceptance" note requires:

| Item | State |
|---|---|
| Stopgap `20261060` | Applied. anon and PUBLIC hold none of the 8 table privileges on the six tables, and nothing on owned sequences (there are 0) |
| `authenticated` | Holds SELECT, INSERT, UPDATE and DELETE only. TRUNCATE, REFERENCES, TRIGGER and MAINTAIN were revoked |
| `service_role` | Untouched |
| Row security | Off on all six, not forced. 0 policies on the six |
| Views slice 1b `20261059` | Applied. `agent_executions_with_details` is `security_invoker = true` and has no client grant |
| Merge state | Both are on `origin/main` (PR #360, `49b66feb`) |

If prod does not match, the 2c-2 pre-guard refuses with "nothing was applied", and Dev and SA decide. It must not accept two different starting states silently.

---

## Migration number

**`20261062`** (SA ruling 1 in [Code Review by SA: 2c-2 SQL](#code-review-by-sa-2c-2-sql-2026-10-14)). The first check below found `20261061` free on every ref, but it is held by an untracked file in the `determined-davinci-cea7bf` worktree, so it is skipped ([2c-2 as written](#2c-2-as-written)). First check, 2026-10-14:

- **`origin/main`** tops at `20261060_rls_disabled_agent_tables_anon_stopgap.sql`.
- **Every ref:** `git log --all -- supabase/migrations/2026106* supabase/migrations/202610[7-9]*` finds only `20261060`.
- **Every worktree:** no file `202610(6[1-9]|[7-9]*)` exists in `supabase/migrations` of the main checkout, the `neuronforge-*` sibling worktrees, or `.claude/worktrees/*`.
- **Docs:** none reserves `20261061` (`git grep 2026106[1-9] origin/main`). It appears only as "2c takes 20261061 or later".

RM re-checks at PR time and again just before merge (C-1). The parent workplan's leftover `20261058` references to 2c get updated in the 2c-2 PR (task T2-12).

---

## Code-path census

Method: grep `app/ lib/ components/ hooks/ supabase/functions/ middleware.ts` for the six table names and for the RPCs `increment_agent_stats`, `update_agent_stats`, `aggregate_execution_model_usage` and `update_agent_schedule_safe`. Each repository and service that touches the tables was then followed to its constructors, to find the runtime client.

**Clients and roles:**

| Client | Runs as |
|---|---|
| browser | `authenticated` when signed in |
| browser default in server code | **`anon`** |
| cookie: `createAuthenticatedServerClient`, `createRouteHandlerClient`, `createServerClient` + anon key | `authenticated` |
| service: `supabaseServer`, `createClient` with the service key, `supabaseAdmin` | `service_role`, which bypasses RLS |

**Verdict "after 2c-2"** assumes 2c-1 is deployed and 2c-2 is applied with the policies in [Design decisions](#design-decisions):

| Verdict | Meaning |
|---|---|
| **OK** | Unchanged |
| **NARROWS** | Returns only the caller's rows, where it used to return every user's. This is the intended fix |
| **BREAKS** | Fails |
| **DATA** | OK unless 2c-0 F5 finds rows whose `agent_id` is NULL or belongs to another user |

### A. Anon on the server (the R-1 class)

| Path | Tables / ops | Client today | After 2c-2 without 2c-1 | After 2c-1 + 2c-2 |
|---|---|---|---|---|
| `app/api/agents/[id]/metrics` GET | `agent_executions` SELECT through the `executionRepository` singleton. Agent ownership through the `agentRepository` singleton (**service role**), fed the `x-user-id` header | browser default = **anon** (and service role for the ownership check) | **BREAKS** (already broken by the stopgap: 500) | OK: cookie client, session user |
| `app/api/shared-agents/exists` GET | `shared_agents` SELECT through the `sharedAgentRepository` singleton | anon | **BREAKS** (already broken) | OK |
| `app/api/shared-agents` POST | `agents` read (service role, header id). `shared_agents` SELECT + INSERT ... RETURNING through the singleton | anon | **BREAKS** (already broken: "Failed to share agent") | OK: owner INSERT. C-4 checks that `original_agent_id` is owned |

Only one place in the UI calls these routes: the Share action on `/v2/agents/[id]` (`app/v2/agents/[id]/page.tsx:1865-1897`), through `lib/client/agent-api.ts` (`sharedAgentApi`, `metricsApi`).

**Pre-existing bug found.** `SharedAgentRepository.existsByOriginalAgent` returns `Promise<boolean>`, but both routes destructure `{ data, error }` from it. So `/exists` always answers `exists: false`, and the POST's "already shared → 409" check never fires. Nothing catches this, because no CI job runs `tsc` over these files (`next.config.js` ignores TS errors). 2c-1 fixes it.

### B. Browser (`authenticated`)

| Path | Tables / ops | After 2c-2 |
|---|---|---|
| `app/(protected)/agents/[id]/page.tsx` | `agent_configurations`, `agent_stats` and `agent_executions` SELECT (own agent). `shared_agents` SELECT by `original_agent_id` + `user_id`, and by id (it views a gallery agent). `shared_agents` **INSERT** (legacy share, owner) | OK. INSERT passes C-4 when the agent is the caller's |
| `app/(protected)/agents/[id]/history`, `.../runs` | `agent_logs`, `agent_stats` SELECT | OK / NARROWS |
| `app/(protected)/agents/AgentStatsBlock.tsx`, `app/(protected)/dashboard`, `app/v2/dashboard` | `agent_stats`, `agent_logs`, `agent_executions` SELECT | OK (user-filtered already) |
| `app/v2/agents/[id]/page.tsx` | `agent_executions` SELECT. The Share action builds `AgentSharingValidator(supabase)` (reads `agent_executions` and `shared_agents`) and `AgentScoreService(supabase)` (reads `shared_agents`, `agent_executions`) | OK. The gallery SELECT covers the `shared_agents` reads |
| `app/v2/agents/[id]/run/page.tsx` | `agent_configurations` SELECT | OK |
| `app/(protected)/layout.tsx` | `shared_agents` count of **all** rows (template badge) | OK: gallery SELECT `USING (true)` |
| `app/(protected)/templates/page.tsx` | `shared_agents` SELECT all. `agents` INSERT (import). **`shared_agent_imports` INSERT**, which fires the import counter trigger (UPDATE of another user's `shared_agents` row) | gallery OK. **The import insert BREAKS without the trigger fix** (42501 aborts the tracking row; the import itself still succeeds). OK with the definer-rights trigger in 2c-2 |
| `app/v2/templates/page.tsx` | `shared_agents` SELECT all. Import goes through `/api/agents/import-shared` | OK signed in. **Signed out: empty gallery**, which is already the case since the stopgap (BQ-1) |
| `components/dashboard/AlertFeed.tsx` | `agent_logs` SELECT + **UPDATE** (`dismissed`, `is_read`) | **DATA**: owner UPDATE with the C-4 WITH CHECK |
| `components/dashboard/AgentSandBox/useAgentSandbox.ts` | `agent_configurations` SELECT + **upsert** `onConflict: 'id'`, where id = `config_<agent>_<user>` | OK for own rows (needs SELECT + INSERT + UPDATE). An upsert onto another user's predictable id now fails, which is the fix |
| `components/dashboard/AgentStatsTable.tsx`, `AgentStatsChart.tsx` | `agent_stats` SELECT with **no user filter** | **NARROWS** (today they show every user's stats) |
| `components/dashboard/AgentHistoryBlock.tsx`, `RunningExecutionsCard.tsx`, `components/settings/UsageAnalytics.tsx`, `components/v2/analytics/FailedOperationsDialog.tsx`, `components/v2/Footer.tsx` | SELECT on `agent_logs`, `agent_executions`, `agent_stats` | OK |
| `lib/execution/agentExecutionEngine.ts`, `lib/hooks/useDashboardData.ts`, `app/(protected)/agents/[id]/page.backup-20251101-215528.tsx` | dead code: no importer, and the backup file is not a routed `page.tsx` | n/a |

### C. Cookie client on the server (`authenticated`)

| Path | Tables / ops | After 2c-2 |
|---|---|---|
| `app/api/run-agent` | `AgentStatsRepository(cookie)`: `getLastRunCost`, `incrementStats` → `increment_agent_stats`. `AgentConfigurationRepository(cookie)`: `getInputValues`, `updateStatus`. `AgentLogsRepository(cookie).create`. `ExecutionRepository(cookie)`: `updateLogs`, `findById` | **DATA** for the UPDATE and upsert paths. OK otherwise |
| `app/api/agent-stream` | `agent_configurations` INSERT/UPDATE, `agent_logs` INSERT, `increment_agent_stats`. `agent_id` comes from the body, `user_id` from `getUser()` | OK for the caller's own agent. **Refused for an agent the caller does not own**, which is the fix (C-4) |
| `app/api/agents/[id]/repair-hardcode` | `agent_configurations` SELECT / INSERT / UPDATE | OK / DATA |
| `app/api/v2/calibrate/load-configuration`, `save-configuration`, `v2/calibrate/batch` (non-admin) | `AgentConfigurationRepository(cookie)`. `calibrationRcaService` → `ExecutionRepository(cookie).findById` | OK / DATA. Admin-initiated batch runs switch to the service role (`resolveCalibrationIdentity`), so they are OK |
| `lib/pilot/WorkflowPilot` (cookie client from run-agent, run-agent-sandbox, calibrate/resume, non-admin v2/calibrate/batch), plus `WorkflowOrchestrator` → `StateManager(this.supabase)` | `StateManager:511, 693`: `agent_executions` INSERT (no RETURNING), `agent_id = context.agentId`, `user_id = context.userId`. `TokenReconciliationService(cookie)`: `agent_executions` SELECT only | OK when the run is the session user's own agent. **Correction to slice 2:** `aggregate_execution_model_usage` is now called with the module **`supabaseAdmin`** (service role, `StateManager.ts:547, 730`), not with the pilot's client |
| `app/api/agents/import-shared` | `shared_agents` SELECT by id (another user's row: gallery). `agents` INSERT. **`shared_agent_imports` INSERT** fires the counter trigger | gallery OK. **The tracking insert BREAKS without the trigger fix**; OK with it |
| `app/api/agents/[id]` PUT | `update_agent_schedule_safe` RPC, cookie client | OK. **Corrected (re-scope, S-3 capture):** it updates `agents` **and** cancels queued/pending `agent_executions` of that agent, swallowing all errors. Under 2c-2 it cancels only the caller's own runs (FU-13) |
| `app/api/agents/[id]` DELETE | `agent_executions` count: **service role** module client (SA V-4) | OK |

### D. Service role (RLS bypassed): unaffected

All of these use the service role, so they are OK whatever the policies say.

| Area | Paths |
|---|---|
| **Admin** | `app/api/admin/dashboard` (`requireAdmin`); `app/api/agent-executions/stats` (`requireAdmin`); `app/api/v2/analytics/system-overview` (`SystemAnalyticsService`, `MetricBaselineService`, both default to `supabaseServer`); `app/admin/system-flow/page.tsx` (only names the table in a static diagram, no query). **No `app/admin/**` page queries the six tables from the browser** |
| **Crons and queues** | `app/api/cron/process-queue` (`increment_agent_stats` as the service role); `app/api/cron/update-template-scores` (`shared_agents` UPDATE); `app/api/run-scheduled-agents`, `run-scheduled-agents-direct`; `lib/queues/qstashQueue.ts`; `lib/database/executionHelpers.ts`; Edge Function `run-scheduled-agents` (`agents` only) |
| **V6 and agent creation** | `app/api/v6/agents/[agentId]/executions/[executionId]`; `app/api/v6/execute-test` (`requireAdmin` → `WorkflowPilot(service)`); `app/api/create-agent` and `app/api/agent-configurations/save-inputs` (the `agentConfigurationRepository` singleton, whose default is `supabaseServer`); `app/api/agent-creation/**` does not touch the six tables; `lib/pilot/shadow/DryRunValidator` (`supabaseServer`); `lib/pilot/insight/AutomationAdvisor`, `CorrelationEngine` (default `supabaseServer`) |
| **Other routes** | `app/api/sentinel/webhook/[agentId]`; `app/api/agents/[id]/executions`; `app/api/agents/[id]/execution-status`; `app/api/worker-status`; `app/api/v2/analytics/*`; `app/api/v2/advisor*`; `app/api/v2/debug/data-check`; `app/api/user/data-export`; **`app/api/business-os/stats`** (Business OS, `supabaseServer`) |
| **Scripts** | every script under `scripts/` uses the service key (slice 2 fact) |
| **Owner (`postgres`)** | the test-account cleanup and purge (definer-rights). Fine as long as RLS is **never FORCEd** (C-9) |

### Paths that break under owner RLS (summary)

| # | Path | Why | Fixed by |
|---|---|---|---|
| B-1 | `/api/agents/[id]/metrics` | anon on the server (also broken by the stopgap today) | 2c-1 |
| B-2 | `/api/shared-agents/exists` | anon on the server | 2c-1 |
| B-3 | `/api/shared-agents` POST | anon on the server | 2c-1 |
| B-4 | `shared_agent_imports` INSERT from `(protected)/templates` and `/api/agents/import-shared` | the invoker trigger updates another user's `shared_agents` row → 42501 → the tracking row and the counter are lost | 2c-2 (definer-rights trigger) |
| B-5 | `/v2/templates` signed out | anon has no read | already broken by the stopgap. Product decision BQ-1 |
| B-6 | Owner UPDATE/upsert on rows whose `agent_id` is NULL or belongs to another user (AlertFeed, run-agent `updateLogs` / `updateStatus`, `increment_agent_stats`, agent-stream config update) | the C-4 WITH CHECK fails | measured by 2c-0 F5. The 2c-2 pre-check STOPs if the count is > 0 |

---

## Database-side callers

| Object | Rights | Callers and role | Under 2c-2 |
|---|---|---|---|
| `increment_agent_stats` (2 overloads) | invoker | run-agent and agent-stream (`authenticated`); process-queue (`service_role`) | Works for the caller's own agent: the upsert needs owner SELECT, INSERT and UPDATE, all granted. Fails for a foreign `agent_id` (C-4), which is the intent. **The body is dashboard-created:** F3 captures it to confirm there is no other table write and to find the conflict target |
| `update_agent_stats(uuid,uuid)` | invoker | no code caller | covered by the same policies |
| `aggregate_execution_model_usage(uuid)` | invoker | `StateManager` through **`supabaseAdmin`** (service role) | Unaffected. It would still work as an owner caller: owner SELECT on `token_usage` (2b) + owner SELECT/UPDATE on `agent_executions` |
| `update_agent_schedule_safe` | invoker (slice 2 Q3) | `app/api/agents/[id]` PUT, cookie | **Corrected (re-scope):** updates `agents` and cancels queued/pending `agent_executions` (S-3 capture). Under 2c-2, the caller's own rows only (FU-13) |
| `increment_shared_agent_import_count()` | **invoker**, AFTER INSERT trigger on `shared_agent_imports` | after 2c-2, fired only by service-role or owner inserts | **Unchanged (re-scope R-6).** The D-4 definer-rights change is superseded |
| Policy "Users can view their execution routing decisions" on `execution_routing_decisions` | `TO public`, `execution_id IN (SELECT id FROM agent_executions WHERE user_id = auth.uid())` | any client reading that table | Still works. The subquery runs with the caller's rights, and the owner SELECT policy on `agent_executions` returns exactly the rows the predicate already asks for. Pinned by md5 in the pre-guard (C-3). Probe P-7 compares the owner's count before and after |
| `agent_executions_with_details` view | invoker since 1b, no client grant | service role only | unchanged. The post-assert re-checks it |
| Definer-rights functions that read these tables (`check_execution_anomaly`, `update_execution_baseline`, `get_user_usage_summary`, `operator_test_account_cleanup` ...) | owner `postgres` | — | unaffected (the owner bypasses non-forced RLS) |
| FK cascades (`agents` → children, `agent_executions` ← `agent_scheduler_state`, `execution_anomalies`, `execution_routing_decisions`) | RI triggers | — | RLS does not apply to RI actions |
| Realtime | — | none of the six is in a publication (slice 2 Q8) | — |

---

## Design decisions

### D-1. Policies (2c-2), all `TO authenticated`, PERMISSIVE

> **Re-scope (R-5):** the `shared_agents` and `shared_agent_imports` rows below are **SUPERSEDED**. Those two tables get no policy. The four agent-table rows stand, so there are 12 policies, not 16.

`uid` below stands for `(SELECT auth.uid())`, the wrapped form from 2b.

**Columns inside the `EXISTS` are qualified with the table name** (`agent_logs.agent_id`, not `agent_id`). An unqualified name would bind to an `agents` column if one ever existed with the same name, and `agents` has its own `user_id`.

| Table | SELECT `USING` | INSERT `WITH CHECK` | UPDATE `USING` / `WITH CHECK` | DELETE |
|---|---|---|---|---|
| `agent_configurations` | `uid = user_id` | `uid = user_id AND EXISTS (SELECT 1 FROM public.agents a WHERE a.id = agent_configurations.agent_id AND a.user_id = uid)` | `uid = user_id` / same as INSERT | none |
| `agent_executions` | `uid = user_id` | same shape | same shape | none |
| `agent_logs` | `uid = user_id` | same shape | same shape | none |
| `agent_stats` | `uid = user_id` | same shape | same shape | none |
| `shared_agents` | **`true`** (gallery, signed-in only; BQ-1) | `uid = user_id AND EXISTS (... a.id = shared_agents.original_agent_id AND a.user_id = uid)` | none | none |
| `shared_agent_imports` | none | `uid = imported_by_user_id AND EXISTS (... a.id = shared_agent_imports.created_agent_id AND a.user_id = uid)` (the shape depends on F1 nullability; Q-2C-3) | none | none |

Why the shapes are what they are:

- **Agent checks (C-4).** They are in WITH CHECK only, so reads stay a plain `user_id` comparison and remain cheap and index-friendly.
- **UPDATE `WITH CHECK`.** Repeating the ownership check stops a row from being re-pointed at a foreign agent.
- **No DELETE anywhere** (Q-SA-5 ruling).
- **`shared_agent_imports` gets INSERT only.** Both inserts return nothing, and the only reader (`AgentScoreService.getUniqueImporterCount`) has no caller.

Policy names follow 2b: `<table>_owner_select|insert|update`, plus `shared_agents_authenticated_select`.

### D-2. Grants (2c-2)

> **Re-scope (R-5):** the two sharing-table rows are **SUPERSEDED**. They get nothing for PUBLIC, anon or authenticated; `service_role` keeps ALL.

| Table | anon, PUBLIC | authenticated | service_role |
|---|---|---|---|
| the 4 agent-keyed tables | none | SELECT, INSERT, UPDATE | ALL |
| `shared_agents` | none | SELECT, INSERT | ALL |
| `shared_agent_imports` | none | INSERT | ALL |

The form is `REVOKE ALL ... FROM PUBLIC, anon, authenticated`, then the GRANTs above. This removes DELETE, which the stopgap left, and the UPDATE/DELETE on `shared_agents` and the SELECT/UPDATE/DELETE on `shared_agent_imports`, which nothing uses.

### D-3. Enable, never force

Every table gets `ENABLE ROW LEVEL SECURITY` and never FORCE (C-9). The owner-run cleanup, purge and the definer-rights trigger all depend on the owner bypass.

### D-4. Import counter: a definer-rights trigger function

> **SUPERSEDED (re-scope R-6).** Sharing is off and the sharing tables are service-role only, so T-1 is dropped. The trigger and its function are left untouched, and parent ruling 2 stands. Kept below for the record.

TL asked for a decision. The options:

| Option | How | For | Against |
|---|---|---|---|
| **T-1 (recommended)** | `CREATE OR REPLACE FUNCTION public.increment_shared_agent_import_count() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''`, with a fully qualified body (`UPDATE public.shared_agents SET import_count = ..., last_imported_at = pg_catalog.now() WHERE id = NEW.shared_agent_id; RETURN NEW;`). Then, in the same file, `REVOKE EXECUTE ON FUNCTION public.increment_shared_agent_import_count() FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role;`. The trigger object is untouched | Both import paths keep working. No grant of UPDATE on `shared_agents`, which Q-SA-2 ruled out. This is the slice 5 pattern, which SECDEF slice 5 proved on prod (PostgreSQL does not check EXECUTE when a trigger fires) | Adds one definer-rights function in `public` |
| T-2 | Move tracking server-side: `import-shared` inserts the tracking row with `supabaseServer`, the legacy `(protected)/templates` page calls that route, and `shared_agent_imports` becomes server-only | No new definer function | More code: two files with `console.*` and direct Supabase calls to convert, plus a new service-role write on a caller-supplied id (tenant-isolation-guard). A legacy page changes behaviour |
| T-3 | Accept that the counter stops (Q-SA-2 option a) | No work | Contradicts the goal "restore Share to gallery". Adoption scores freeze |

**T-1 against the SECDEF lockdown.** The function stays compliant with [SECURITY_DEFINER_FUNCTIONS_LOCKDOWN_REQUIREMENT.md](/docs/requirements/SECURITY_DEFINER_FUNCTIONS_LOCKDOWN_REQUIREMENT.md) and the slice 6 guard (`supabase/__tests__/security-definer-surface.guard.test.ts`):

| Guard rule | How T-1 meets it |
|---|---|
| R-a / R-b | A schema-qualified `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` after the last CREATE |
| R-c | `SET search_path` on the CREATE |
| R-d | No later grant to PUBLIC or anon |
| F-1 / F-2 | Top-level `CREATE OR REPLACE FUNCTION`, never inside a DO block or a string |

Two more effects:

- The requirement's metric "anon-executable SECURITY DEFINER = 0" stays 0. The authenticated-executable count stays at the 6 slice 4a functions.
- **This supersedes SA ruling 2 (Q-SA-2 option a)** of the parent workplan. That ruling accepted the loss "while sharing is dormant" and named this exact pattern as the prerequisite for bringing sharing back. Restoring sharing is now the goal (Q-2C-1).

**T-1 against tenant isolation.** The function runs as the owner on a caller-chosen `NEW.shared_agent_id`, so `tenant-isolation-guard` applies:

- Its only effect is +1 on a public gallery counter and a timestamp.
- The `shared_agent_imports` WITH CHECK pins the importer to the caller and the created agent to an agent the caller owns.
- Spam is limited by whatever unique constraint F2 finds (Q-2C-4).
- No caller-supplied field reaches anything other than the `WHERE id =`.

**Rollback of T-1.** `CREATE OR REPLACE` restores the original invoker body **verbatim**, as captured by F3. It then restores the function ACL from the saved pre-check. The pre-guard pins `md5(prosrc)` of today's body, so drift refuses. If the captured body contains `--` or the word "into", it cannot be pasted under the paste rules (R-9 / Q-2C-6).

### D-5. Route identity and client (2c-1)

> **SUPERSEDED (re-scope R-1).** The three routes are deleted, not fixed.

These follow SA ruling Q-SA-1 of the parent workplan:

- The user comes from `getUser()` (`@/lib/auth`, cookie-verified, cached). It returns 401 when there is no user.
- Data access uses `createAuthenticatedServerClient()`, passed to `AgentRepository`, `ExecutionRepository` and `SharedAgentRepository`. The `x-user-id` header is ignored. The browser can keep sending it.
- Never `supabaseServer` in these routes.

Under today's post-stopgap grants (RLS off, authenticated holds SELECT and INSERT), the cookie client already works. So **2c-1 alone restores "Share agent"**, and 2c-2 then keeps it working (C-6).

---

## Slice 2c-0: prod captures (TL, read-only)

These must exist before the 2c-2 SQL is written. Each block is read-only. Paste each into its own SQL-editor tab and copy the full output to Dev and SA.

**F1. Key columns, nullability, defaults and types**

```sql
SELECT c.table_name, c.column_name, c.data_type, c.udt_name, c.is_nullable, c.column_default
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name IN ('agent_configurations','agent_executions','agent_logs','agent_stats','shared_agents','shared_agent_imports')
  AND c.column_name IN ('id','user_id','agent_id','original_agent_id','imported_by_user_id','shared_agent_id','created_agent_id','import_count','last_imported_at')
ORDER BY 1, 2;
```

**F2. Constraints: unique, FK and on-delete actions**

```sql
SELECT con.conrelid::regclass AS on_table, con.conname, con.contype, pg_get_constraintdef(con.oid) AS def
FROM pg_constraint con
WHERE con.conrelid IN ('public.agent_configurations'::regclass,'public.agent_executions'::regclass,'public.agent_logs'::regclass,'public.agent_stats'::regclass,'public.shared_agents'::regclass,'public.shared_agent_imports'::regclass)
ORDER BY 1, 2;
```

**F3. The five caller-rights functions and the trigger function: rights, config, owner, ACL, body md5 and body**

```sql
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.prosecdef, p.proconfig,
       pg_get_userbyid(p.proowner) AS owner, p.proacl::text AS acl, md5(p.prosrc) AS src_md5, p.prosrc
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
WHERE p.proname IN ('increment_agent_stats','update_agent_stats','aggregate_execution_model_usage','update_agent_schedule_safe','increment_shared_agent_import_count')
ORDER BY 1, 2;
```

**F4. Triggers on the six tables**

```sql
SELECT c.relname AS on_table, t.tgname, t.tgenabled, p.proname, p.prosecdef, pg_get_triggerdef(t.oid) AS trigger_def
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE NOT t.tgisinternal
  AND c.relname IN ('agent_configurations','agent_executions','agent_logs','agent_stats','shared_agents','shared_agent_imports')
ORDER BY 1, 2;
```

**F5. C-4 data check: rows the agent-ownership WITH CHECK would reject on UPDATE.** F1 must confirm that the agent-id columns are `uuid` before this runs. If a type differs, TL reports it and Dev adjusts the join.

```sql
SELECT 'agent_configurations' AS t, count(*) AS total_rows,
       count(*) FILTER (WHERE x.agent_id IS NULL) AS null_agent,
       count(*) FILTER (WHERE x.agent_id IS NOT NULL AND a.id IS NULL) AS agent_missing,
       count(*) FILTER (WHERE a.id IS NOT NULL AND a.user_id IS DISTINCT FROM x.user_id) AS agent_owner_differs
FROM public.agent_configurations x LEFT JOIN public.agents a ON a.id = x.agent_id
UNION ALL
SELECT 'agent_executions', count(*), count(*) FILTER (WHERE x.agent_id IS NULL), count(*) FILTER (WHERE x.agent_id IS NOT NULL AND a.id IS NULL), count(*) FILTER (WHERE a.id IS NOT NULL AND a.user_id IS DISTINCT FROM x.user_id)
FROM public.agent_executions x LEFT JOIN public.agents a ON a.id = x.agent_id
UNION ALL
SELECT 'agent_logs', count(*), count(*) FILTER (WHERE x.agent_id IS NULL), count(*) FILTER (WHERE x.agent_id IS NOT NULL AND a.id IS NULL), count(*) FILTER (WHERE a.id IS NOT NULL AND a.user_id IS DISTINCT FROM x.user_id)
FROM public.agent_logs x LEFT JOIN public.agents a ON a.id = x.agent_id
UNION ALL
SELECT 'agent_stats', count(*), count(*) FILTER (WHERE x.agent_id IS NULL), count(*) FILTER (WHERE x.agent_id IS NOT NULL AND a.id IS NULL), count(*) FILTER (WHERE a.id IS NOT NULL AND a.user_id IS DISTINCT FROM x.user_id)
FROM public.agent_stats x LEFT JOIN public.agents a ON a.id = x.agent_id
UNION ALL
SELECT 'shared_agents', count(*), count(*) FILTER (WHERE x.original_agent_id IS NULL), count(*) FILTER (WHERE x.original_agent_id IS NOT NULL AND a.id IS NULL), count(*) FILTER (WHERE a.id IS NOT NULL AND a.user_id IS DISTINCT FROM x.user_id)
FROM public.shared_agents x LEFT JOIN public.agents a ON a.id = x.original_agent_id
UNION ALL
SELECT 'shared_agent_imports', count(*), count(*) FILTER (WHERE x.created_agent_id IS NULL), count(*) FILTER (WHERE x.created_agent_id IS NOT NULL AND a.id IS NULL), count(*) FILTER (WHERE a.id IS NOT NULL AND a.user_id IS DISTINCT FROM x.imported_by_user_id)
FROM public.shared_agent_imports x LEFT JOIN public.agents a ON a.id = x.created_agent_id;
```

**F6. Policies to pin: `agents` (C-4 prerequisite, re-captured) and `execution_routing_decisions` (C-3), with md5**

```sql
SELECT tablename, policyname, cmd, roles, permissive, md5(qual) AS qual_md5, md5(with_check) AS check_md5, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('agents','execution_routing_decisions')
ORDER BY 1, 2;
```

**F7. Indexes on the owner and agent columns** (policy cost)

```sql
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('agent_configurations','agent_executions','agent_logs','agent_stats','shared_agents','shared_agent_imports')
ORDER BY 1, 2;
```

**F8. Any other function, view or policy that names the six tables** (drift since 2026-10-11)

```sql
SELECT 'function' AS kind, p.proname AS name, p.prosecdef::text AS detail
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
WHERE p.prosrc ~ '(agent_configurations|agent_executions|agent_logs|agent_stats|shared_agents|shared_agent_imports)'
UNION ALL
SELECT 'policy', tablename || ' ' || policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND (coalesce(qual,'') || coalesce(with_check,'')) ~ '(agent_configurations|agent_executions|agent_logs|agent_stats|shared_agents|shared_agent_imports)'
UNION ALL
SELECT DISTINCT 'view', v.relname, coalesce(array_to_string(v.reloptions, ' '), 'no options')
FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid JOIN pg_class v ON v.oid = r.ev_class JOIN pg_class s ON s.oid = d.refobjid
JOIN pg_namespace n ON n.oid = s.relnamespace AND n.nspname = 'public'
WHERE s.relname IN ('agent_configurations','agent_executions','agent_logs','agent_stats','shared_agents','shared_agent_imports') AND v.oid <> s.oid
ORDER BY 1, 2;
```

**What each capture decides:**

| Capture | Decides |
|---|---|
| F1 | NULL handling in WITH CHECK (Q-2C-3) and the uuid join |
| F2 | spam bound on imports, duplicate shares |
| F3 | the T-1 pins and the rollback body |
| F4 | the pinned trigger set |
| F5 | **STOP if any non-zero** in `null_agent`, `agent_missing` or `agent_owner_differs` → SA rules before the SQL |
| F6 | the C-3 / C-4 pins |
| F7 | whether to record a perf follow-up |
| F8 | anything new to clear before apply |

---

## Slice 2c-1: route fixes (code PR)

> **SUPERSEDED (re-scope).** 2c-1 is now "switch sharing off". See [Re-scope § Slice 2c-1](#slice-2c-1-switch-sharing-off-replaces-slice-2c-1-route-fixes). This section is kept for the record only. Do not implement it.

**Branch:** `fix/rls-2c1-agent-share-routes` off `origin/main`. **Skills:** `new-api-route` (template, Zod, Pino + correlationId, error format, tests) and `tenant-isolation-guard` (a caller-supplied `agentId` is checked against the session user before any effect, the create payload is an allow-list, and `user_id` comes from auth). `business-os-entitlements` does not apply: nothing imports from that module.

### Files

| File | Action | Reason |
|---|---|---|
| `app/api/agents/[id]/metrics/route.ts` | modify | `getUser()` → 401. Zod `id: uuid` → 400. `const db = await createAuthenticatedServerClient()`. `new AgentRepository(db).findById(id, user.id)` → 404. `new ExecutionRepository(db).findByAgentId(id, { userId: user.id })`. Drop `getUserIdFromRequest`. Error details behind the `development` guard. Response shape unchanged (`{ success, metrics }`) |
| `app/api/shared-agents/route.ts` | modify | Same identity and client. Zod body: `agentId` uuid, `description` optional trimmed string with a max length, the five scores as optional numbers 0–100, `base_executions` an optional int ≥ 0, `base_success_rate` optional 0–100. Unknown keys are stripped, so an injected `user_id` is dropped. The create payload is the existing explicit field list with `user_id: user.id`. 409 when already shared (now real). `AGENT_SHARED` audit stays non-blocking with `.catch`. Response shape unchanged (`{ success, id, sharedAgent }`) |
| `app/api/shared-agents/exists/route.ts` | modify | Same identity and client. Zod query `agentId: uuid` → 400. Response shape unchanged (`{ success, exists, sharedAgentId }`) |
| `lib/repositories/SharedAgentRepository.ts` | modify | `existsByOriginalAgent` returns `AgentRepositoryResult<{ exists: boolean; sharedAgentId: string \| null }>` and surfaces DB errors instead of swallowing them. **Constructor requires a client.** Delete the `sharedAgentRepository` singleton and the `@/lib/supabaseClient` import (Q-2C-2) |
| `lib/repositories/ExecutionRepository.ts` | modify | `findByAgentId` options gain an optional `userId`, which adds `.eq('user_id', userId)` (CLAUDE.md rule 4, defence in depth; existing service-role callers are unchanged). **Constructor requires a client.** Delete the `executionRepository` singleton and the `@/lib/supabaseClient` import (Q-2C-2) |
| `lib/repositories/index.ts` | modify | Stop exporting the two singletons |
| `app/api/agents/[id]/metrics/__tests__/route.test.ts` | create | happy path, 401, 400 (bad uuid), 404 (not owned), forged `x-user-id` ignored (the repository receives the session id), cookie client used and never `supabaseServer` |
| `app/api/shared-agents/__tests__/route.test.ts` | create | happy path, 401, 400 (no or bad `agentId`, out-of-range score), 404 not owned, 409 already shared, forged `x-user-id` ignored, injected body `user_id` dropped, audit failure does not fail the request |
| `app/api/shared-agents/exists/__tests__/route.test.ts` | create | happy (true and false), 401, 400, DB error → 500 with no details in production, forged header ignored |
| `lib/repositories/__tests__/SharedAgentRepository.test.ts` | create | `existsByOriginalAgent`: found, not found, error surfaced. `create` sends exactly the given fields |
| `lib/repositories/__tests__/anon-default-repositories.guard.test.ts` | create | **C-7 guard**, pure fs scan, milliseconds. (a) No file under `lib/repositories/` imports `@/lib/supabaseClient`, with a frozen, dated allow-list for the three that still do: `AgentMetricsRepository`, `ConfigRepository`, `MemoryRepository` (Q-2C-2). (b) No non-`'use client'` file under `app/` or `lib/` imports `executionRepository` or `sharedAgentRepository`. (c) Mutation self-tests |
| `docs/workplans/RLS_DISABLED_TABLES_SLICE2C_WORKPLAN.md` | modify | task ticks, notes |

### Tasks

- ⬜ T1-1 Confirm the branch is `fix/rls-2c1-agent-share-routes` (`git branch --show-current`)
- ⬜ T1-2 Repository changes, with their unit tests
- ⬜ T1-3 The three routes, using the `new-api-route` template
- ⬜ T1-4 The integration tests, and the C-7 guard with mutation self-tests
- ⬜ T1-5 `npx jest app/api/agents/[id]/metrics app/api/shared-agents lib/repositories/__tests__`; `npm run test:authz-guard`; `npm run lint`; the full `npm test`
- ⬜ T1-6 `npx tsc --noEmit -p .`, filtered to the touched files: zero new errors there (no CI job runs `tsc` on these)
- ⬜ T1-7 SA code review → QA → user sees the diff → RM PR
- ⬜ T1-8 **After merge: confirm the Vercel production deployment contains the merge commit** (TL). QA check on prod: Share on `/v2/agents/[id]` succeeds for an own agent that passes validation. A forged `x-user-id` returns the session user's data

### Apply order and acceptance

Code only, no database step:

1. Merge and deploy.
2. The Share action on `/v2/agents/[id]` succeeds. The alert "Agent shared. The credit reward could not be applied right now..." is expected: it comes from the pre-existing `user_subscriptions` lockdown (BQ-3).
3. Within 24 h, logs show no 500 from the three routes.

### Risks

| # | Risk | Mitigation |
|---|---|---|
| R1-1 | Removing the singletons breaks an importer the grep missed | `tsc` on the touched set, the full Jest suite and `next build` in CI. The census found only the three routes |
| R1-2 | `getUser()` false 401 on a dropped auth socket | the existing `supabaseFetch` cap (`lib/supabaseServerAuth.ts`). The browser shows "Failed to share" and the user can retry |
| R1-3 | Fixing `exists` turns a duplicate share that used to be silent into a visible 409 | this is the correct behaviour. The UI already says "already shared" |
| R1-4 | Client-supplied quality scores can still be set by the sharer (they could before, and the legacy page inserts them directly) | Zod bounds them to 0–100. `cron/update-template-scores` recomputes them. Server-side scoring is follow-up FU-4 |

---

## Slice 2c-2: RLS migration 20261062

> **Re-scope:** apply the [2c-2 changes delta](#2c-2-changes-a-delta-on-slice-2c-2) on top of this section. In short:
> - the two sharing tables are locked with no policies
> - 12 policies, not 16
> - no T-1 and no SECURITY DEFINER
> - P-6 and P-8 expect 42501; P-8b is dropped
> - the apply is **not** gated on 2c-1 (R-4)
>
> Text below that contradicts the delta is superseded.

**Branch:** `fix/rls-2c2-agent-tables-rls` off `origin/main`. It may merge before or after 2c-1. ~~TL applies it only after 2c-1 is confirmed live (T1-8, C-6).~~ Superseded by R-4: there is no 2c-1 gate. **Skills:** `business-os-schema-check` (every column named in the SQL is checked against F1/F2 and is never assumed), `tenant-isolation-guard` (T-1).

### Files

| File | Action | Reason |
|---|---|---|
| `scripts/precheck-rls-disabled-agent-tables-slice2c.sql` | create | Read-only, one grid, `PRECHECK STATUS` first (CLEAN or STOP plus the reasons). The slice 2a / stopgap shape. |
| `supabase/migrations/20261062_rls_disabled_agent_tables_slice2c_owner_policies.sql` | create | One transaction with `SET LOCAL lock_timeout = '5s'` (C-8). Steps:<br>• pre-guard DO<br>• T-1 `CREATE OR REPLACE FUNCTION` + REVOKE + GRANT (top level)<br>• per table: ENABLE RLS, REVOKE ALL from PUBLIC, anon and authenticated, the D-2 grants, the D-1 policies<br>• post-assert DO that raises "nothing was applied" on any mismatch |
| `scripts/check-rls-disabled-agent-tables-slice2c-migration.sql` | create | Read-only, VERDICT first. Expected about 75 checks; the exact count is fixed at implementation |
| `supabase/SQL Scripts/20261062_rls_disabled_agent_tables_slice2c_owner_policies_rollback.sql` | create | Exact inverse to the **post-stopgap** state. The first statement is the warning: it re-opens cross-tenant read and write for signed-in users, anon stays closed, and TL may run it only with the user's explicit authorization. Then: drop the 16 policies by exact name; restore the original trigger function body verbatim (invoker, no `search_path`) and its ACL from the saved pre-check; `REVOKE ALL ... FROM authenticated` + `GRANT SELECT, INSERT, UPDATE, DELETE ... TO authenticated` on all six; DISABLE RLS. The final DO asserts the stopgap state (the same assertions as the `20261060` post-assert). It does **not** restore anon |
| `supabase/migrations/__tests__/rls-disabled-agent-tables-slice2c.migration.test.ts` | create | Static guard in the 1b / stopgap style over the four SQL files and this workplan. See [Tests](#tests-2c-2) |
| `docs/workplans/RLS_DISABLED_TABLES_SLICE2_WORKPLAN.md` | modify | Point 2c at `20261062` and this workplan. Record that T-1 supersedes ruling 2. Correct the `aggregate_execution_model_usage` caller (now service role) |
| `docs/workplans/RLS_DISABLED_TABLES_SLICE2C_WORKPLAN.md` | modify | ticks, dry-run record, apply record |

**Pre-check contents:**

| Query | Shows |
|---|---|
| Q0 | version (`server_version_num`), `pg_has_role(current_user,'postgres','SET')` |
| Q1–Q3 | per table: exists, relkind, owner, RLS and force flags |
| Q4 | the 8 privileges for PUBLIC, anon, authenticated and service_role, with a matches / differs verdict against the pinned stopgap state |
| Q5 | grantors |
| Q6 | column ACLs |
| Q7 | owned sequences |
| Q8 | the policies on the six (expect 0) |
| Q9 | triggers (expect the `updated_at` set + the import counter) |
| Q10 | T-1 function: prosecdef false, owner postgres, ACL, `md5(prosrc)` equal to the F3 pin |
| Q11 | `execution_routing_decisions` policy md5 (C-3) |
| Q12 | `agents` policies md5 (C-4) |
| Q13 | F5 consistency counts (STOP if > 0) |
| Q14 | functions, views and policies naming the six (F8) |
| Q15 | `agent_executions_with_details`: invoker, no client grant |
| Q16 | row counts |

**Pre-guard pins**, to refuse on any of:

- RLS on or forced, or any policy present
- a column ACL
- anon or PUBLIC holding any of the 8 privileges
- authenticated not holding exactly SELECT, INSERT, UPDATE and DELETE
- service_role lacking SELECT, INSERT, UPDATE or DELETE
- the trigger function not invoker, not owned by `postgres`, or with a different md5
- the trigger missing or disabled
- the `execution_routing_decisions` policy or the `agents` policies differing from their md5 pins
- `agent_executions_with_details` not invoker or holding a client grant

**Checker** (read-only, VERDICT first):

| Scope | Checks |
|---|---|
| Per table | RLS on, not forced, owner postgres, no PUBLIC/anon privilege (all 8), the exact authenticated set, service_role ALL, no column ACL, the exact policy set by name/cmd/roles/permissive/md5 |
| T-1 function | prosecdef true, `proconfig` has `search_path=""`, owner postgres, no EXECUTE for PUBLIC/anon/authenticated, service_role EXECUTE, trigger attached and enabled |
| Boundary | routing policy md5 unchanged, `agents` policies unchanged, the 1b view unchanged |

### Tasks

- ⬜ T2-1 2c-0 captures received. F5 all zero, or SA ruling on the non-zero rows
- ⬜ T2-2 Confirm the branch; re-check the number `20261062` on `origin/main`, every ref and every worktree (`20261061` stays skipped, SA ruling 1)
- ⬜ T2-3 Pre-check
- ⬜ T2-4 Migration, with policies as D-1, grants as D-2, T-1 as D-4
- ⬜ T2-5 Checker
- ⬜ T2-6 Rollback (verbatim F3 body)
- ⬜ T2-7 Static test, including mutation self-tests
- ⬜ T2-8 `npx jest supabase/migrations/__tests__ supabase/__tests__/security-definer-surface.guard.test.ts`; `npm run test:authz-guard`; the Tailwind escape guard; the full `npm test`
- ⬜ T2-9 PGlite (PG 17.x) dry run in the scratchpad only, never against Supabase. Setup: three roles, `auth.uid()` from `request.jwt.claims`, `agents` with the F6 policies, the six tables in the post-stopgap state, `increment_agent_stats` (the F3 body), the invoker trigger, the routing-decisions table and policy, the 1b view. Steps: pre-check CLEAN → migration → re-run refuses → checker PASS → probes P-1..P-10 → rollback → pre-check CLEAN again (exact round trip) → fail-closed cases (FORCE on, a column grant, a drifted routing policy, a drifted function md5)
- ⬜ T2-10 SA code review → QA → user diff → RM PR
- ✅ T2-11 Apply (TL, user-authorized, after T1-8): see below. **Done 2026-10-14** (no 2c-1 gate, per R-4): see [2c-2 production apply record](#2c-2-production-apply-record-2026-10-14)
- ⬜ T2-12 Parent workplan updated (number `20261062`; ruling 2 stands, per the re-scope delta; caller correction). The 2c-2 apply follows SA's [Apply procedure for 2c-2](#apply-procedure-for-2c-2-tl-and-the-user-production-jgccgkyhpwirgknnceoh) (CR2-3), which replaces the apply order above and in S-8

### Tests (2c-2)

The static Jest test follows the stopgap test's shape:

- **Paste rules on all four SQL files (C-10):**
  - no `--` and no `/*`
  - **no "into" anywhere**, case-insensitive, including `SELECT ... INTO` (use `x := (SELECT ...)`)
  - an even quote count
  - literals limited to `[A-Za-z0-9_ ]` and md5 hex
  - `COLLATE "C"` on every `string_agg`
  - no FORCE
- **SECURITY DEFINER:** exactly one occurrence, in the migration. It sits in a top-level `CREATE OR REPLACE FUNCTION public.increment_shared_agent_import_count()` with `SET search_path = ''`, followed by `REVOKE EXECUTE ON FUNCTION public.increment_shared_agent_import_count() FROM PUBLIC, anon, authenticated`, and no later grant to PUBLIC or anon. It must not appear in any DO block or string, and nowhere in the pre-check, checker or rollback.
- **The migration:**
  - `lock_timeout`
  - the exact DDL list, in order
  - the 16 policy statements, textually as D-1, with the table-qualified columns inside each `EXISTS`
  - no `FOR DELETE` and no `FOR ALL`
  - grants exactly as D-2
- **The rollback:**
  - the warning comes first
  - it drops every created policy by name
  - it re-grants authenticated exactly SELECT, INSERT, UPDATE and DELETE
  - it never grants anon
  - it restores the function as invoker
- **The pre-guard** pins the post-stopgap state (the "2c acceptance" note), not the Q6 `GRANT ALL` state.
- **Boundary:** the files name no objects outside the six tables, `agents` (read-only, in the policies), `execution_routing_decisions` (read-only pin) and `agent_executions_with_details` (read-only pin).

`supabase/__tests__/security-definer-surface.guard.test.ts` (CI, unchanged) also scans the new migration and must stay green.

### Apply order (TL; applying needs the user's explicit authorization in the session)

1. **Prerequisite:** T1-8 done (2c-1 live in production).
2. **Pre-check.** Expect `CLEAN run the migration in a NEW tab`. Save the output. It is the rollback's record of the function ACL and the grants. Copy Q9, Q13 and Q14 to SA and wait for clearance (stopgap SC-1 precedent).
3. **Migration in a NEW tab.** Any error means nothing was applied. A lock timeout means retry.
4. **Checker:** `VERDICT PASS n pass 0 fail`.
5. **Probes.** Each block is separate and ends in ROLLBACK. `<a>` and `<b>` are two real users; `<agentA>` is an agent of `<a>`; `<agentB>` is an agent of `<b>`. The JWT claim setup is the 2b form: `SELECT set_config('request.jwt.claims', '{"sub":"<a>","role":"authenticated"}', true);`.

   | # | Probe | Expect |
   |---|---|---|
   | P-1 | anon SELECT on each of the six | 42501 |
   | P-2 | `<a>` count on `agent_executions` = the service-role count `WHERE user_id = '<a>'` | equal |
   | P-3 | `<a>` INSERT into `agent_logs` with `user_id <a>`, `agent_id <agentB>` (C-4) | `new row violates row-level security policy` |
   | P-4 | `<a>` `SELECT public.increment_agent_stats(...)` for `<agentA>` | succeeds. For `<agentB>`: RLS violation |
   | P-5 | `<a>` DELETE on `agent_logs` / TRUNCATE on `agent_executions` | 42501 |
   | P-6 | `<b>` count on `shared_agents` = the total count | equal (gallery) |
   | P-7 | `<a>` count on `execution_routing_decisions` = the value captured before apply | equal |
   | P-8 | **Import counter.** As postgres, insert one `shared_agents` row for `<agentA>`. Then, as `<b>`, insert an agent and a `shared_agent_imports` row for it | the insert succeeds and `import_count` = 1 (read back as postgres). This replaces the parent workplan's "42501 is expected" probe |
   | P-9 | `<a>` UPDATE of their own `agent_logs` row (the AlertFeed path) | 1 row |
   | P-10 | `<a>` UPDATE of `shared_agents` | 42501 |

6. **Advisor.** Re-run Supabase advisors. `rls_disabled_in_public` lists none of the six, and no new `function_search_path_mutable` or `security_definer` finding names `increment_shared_agent_import_count`.
7. **Watch logs for 24 h.** Supabase API logs show no new 4xx or 5xx on the six tables. Agent runs keep writing `agent_executions` (from the service-role count over time).

### Rollback

Run the rollback file only with the user's explicit authorization. Before running it:

- compare its GRANTs and function ACL with the saved pre-check Q4/Q10 rows, and adjust both the GRANTs and the final DO block if they differ (stopgap SC-3 rule);
- if 2c-1 also has to be reverted, revert the code **after** the rollback. The old routes run as anon and fail under either state.

### Risks

| # | Risk | Mitigation |
|---|---|---|
| R2-1 | Lock wait on the hot `agent_executions` / `agent_stats` | `lock_timeout = '5s'`. The transaction aborts cleanly and can be retried off-peak |
| R2-2 | Rows with a NULL or foreign `agent_id` (F5) become un-updatable by their owner | pre-check STOP. SA rules (back-fill, or `agent_id IS NULL OR EXISTS` for that table) before the SQL is finalised |
| R2-3 | A client path the grep missed | F8 / Q14 database scan, the 24 h log watch, the rollback |
| R2-4 | The T-1 function runs as owner on a caller-chosen id | the effect is bounded (a counter), and the WITH CHECK pins the importer and the created agent. F2 bounds repeats |
| R2-5 | `increment_agent_stats` conflicts with an `agent_stats` row owned by someone else (squatted before 2c) | F5 shows it as `agent_owner_differs`. Pre-check STOP |
| R2-6 | The policy `EXISTS` on `agents` adds cost to every client insert/update | a PK lookup on `agents.id`. F7 confirms the index |
| R2-7 | Applied before 2c-1 is live | the three routes stay broken as they are today (they are already broken by the stopgap), so nothing new breaks. Apply order step 1 still forbids it |
| R2-8 | Gallery rows expose the sharer's `user_id` and full prompts to every signed-in user | this is the existing gallery design. Q-2C-5 |
| R2-9 | The original trigger body contains `--` or "into", so it cannot be pasted verbatim in the rollback | F3 shows the body before any SQL is written. If needed, the rollback restores a behaviour-equal body (Q-2C-6) |

---

## Non-compliant files

Files this plan touches:

| File | `console.*` | Direct Supabase calls | Action |
|---|---|---|---|
| `app/api/agents/[id]/metrics/route.ts` | 0 | 0 | trusts `x-user-id` and uses a browser-default singleton → fixed in 2c-1 |
| `app/api/shared-agents/route.ts` | 0 | 0 | same; no Zod → fixed |
| `app/api/shared-agents/exists/route.ts` | 0 | 0 | same → fixed |
| `lib/repositories/SharedAgentRepository.ts` | 0 | n/a (repository) | imports the `'use client'` browser client as a server default → removed |
| `lib/repositories/ExecutionRepository.ts` | 0 | n/a (repository) | same → removed |
| `lib/repositories/index.ts` | 0 | 0 | — |

Files read and **not** touched by the recommended plan, flagged per CLAUDE.md § Logging (convert only if touched):

| File | `console.*` | Direct Supabase calls |
|---|---|---|
| `app/api/agents/import-shared/route.ts` | 4 | 3 (`shared_agents`, `agents`, `shared_agent_imports`), no Zod, `createRouteHandlerClient` (deprecated helper). **Touched only under option T-2** |
| `app/(protected)/templates/page.tsx` | 4 | 3. Touched only under T-2 |
| `app/v2/agents/[id]/page.tsx` | 54 | 6 |
| `app/api/agent-stream/route.ts` | 22 | several |
| `app/api/agents/[id]/route.ts` | 51 | several |
| `app/api/cron/process-queue/route.ts` | 16 | several |
| `lib/pilot/StateManager.ts` | yes (for example `:540`) | several |
| `lib/credits/agentSharingValidation.ts` | yes | 3 |

**Pre-existing defects seen during the census.** None of them is in scope:

- `app/api/run-agent/route.ts` calls `ExecutionRepository.create`, `findRunningByAgentId` and `findForStatusQuery`, which **do not exist** on the class. Those calls throw at runtime.
- `RewardService.awardAgentSharingReward` writes `user_subscriptions` and `credit_transactions` **from the browser**. That has been blocked since `20261001`, so the share reward never lands (BQ-3).

---

## Risks

Cross-slice risks only. The per-slice risks are under each slice.

| # | Risk | Mitigation |
|---|---|---|
| R-1 | Order inversion: 2c-2 applied before 2c-1 is deployed | Apply order step 1 plus the TL check of the Vercel deployment SHA. The consequence is bounded (R2-7) |
| R-2 | The agent platform is out of the user's test scope, so proof is in-database and by code | probes P-1..P-10, the PGlite dry run, the 2c-1 integration tests, and one QA click-through of Share on production |
| R-3 | A stacked-PR accident | two independent branches off `origin/main`, with disjoint files |

---

## Open questions for SA

> **Re-scope:**
> - **Superseded:** Q-2C-1, Q-2C-5, Q-2C-6 and Q-2C-7.
> - **Re-ruled:** Q-2C-2, by R-8 (`ExecutionRepository` kept, `SharedAgentRepository` deleted).
> - **Unchanged:** Q-2C-3, Q-2C-4 and Q-2C-8 stand as ruled. Q-2C-8 is now answered by BQ-3.

- **Q-2C-1 (import counter).** Approve T-1, the definer-rights trigger function with `search_path = ''` and EXECUTE revoked from PUBLIC, anon and authenticated? It supersedes parent ruling 2 (option a). T-2 (server-side tracking) is the alternative. Dev recommends T-1.
- **Q-2C-2 (repository defaults).** Remove the two anon-default singletons and require a client in `ExecutionRepository` and `SharedAgentRepository` in 2c-1, as your earlier optimisation suggested, with the C-7 guard as a backstop? Or keep the singletons and rely on the guard alone? Three more repositories import the browser client: `AgentMetricsRepository`, `ConfigRepository` and `MemoryRepository`. Freeze them on the guard's allow-list for now?
- **Q-2C-3 (NULL `created_agent_id` / `agent_id`).** If F1 shows a nullable agent column, should the WITH CHECK require the agent (reject NULL) or accept `IS NULL OR EXISTS (...)`? Dev recommends rejecting NULL wherever F5 shows 0 NULL rows.
- **Q-2C-4 (import spam).** If F2 shows no unique constraint on `(shared_agent_id, imported_by_user_id)`, a user who creates many agents can inflate a template's `import_count`. Accept this (the counter only feeds the adoption score), or add the constraint in a later slice?
- **Q-2C-5 (gallery columns).** The gallery `SELECT USING (true)` exposes every column, including the sharer's `user_id`, `system_prompt` and `workflow_steps`, to every signed-in user. Is that accepted as the gallery's design? Column grants would break the pages' `select('*')`.
- **Q-2C-6 (rollback fidelity).** Is a behaviour-equal rollback body acceptable if the F3 body cannot be pasted verbatim?
- **Q-2C-7 (new pattern check).** `ExecutionRepository.findByAgentId` gains an optional `userId`. Fine, or a separate method?
- **Q-2C-8 (sharing reward).** The defect noted under [Non-compliant files](#non-compliant-files): the browser-side reward write. Record it as follow-up FU-3 only? Dev recommends yes (see BQ-3).

---

## Business questions for the user

> **Answered by the user, 2026-10-14:**
> - **BQ-1:** signed-in only.
> - **BQ-2:** switch sharing off.
> - **BQ-3:** remove the bonus promise.
> - **BQ-4:** yes, re-own the row through D-0b.
>
> The rulings that follow from these are in [Re-scope § User decisions](#user-decisions). The questions are kept below as asked.

- **BQ-1. Template gallery for visitors who are not signed in.** Today, and since the 2026-10-13 fix, only signed-in users can see shared agent templates. Should people who are not signed in also be able to browse them? **Recommendation: no.** Nothing in the product links there for signed-out visitors. Templates contain the full instructions of other users' agents. Keeping the gallery behind sign-in is safer, and we can open it later as a deliberate marketing decision.
- **BQ-2. What "fixed" means for sharing.** After 2c-1 ships, "Share agent to template gallery" works again. After 2c-2, it keeps working, and each import of a template is counted again (that count feeds the template's ranking). Is the template gallery still a feature you want kept working? If not, the cheaper path is to switch sharing off instead.
- **BQ-3. The credit reward for sharing.** Since an earlier security fix, the bonus credits for sharing an agent have not been paid. The user sees "the credit reward could not be applied right now and will be credited later", but nothing credits it later. Is the sharing reward still part of the offer? If yes, it needs its own small fix (a server-side grant). If no, the message should be removed.
- **BQ-4 (added by SA). One automation's run counters.** One automation has a run-counter record (number of runs, successes, last run cost) that is filed under a different account from the automation's current owner. It dates from early June. Once this security fix is live, the owner's runs can no longer update that record, so the automation's run counts and last-run cost would freeze for the owner. The runs themselves keep working. May we refile that single record under the automation's owner? It holds counts only, no customer content, and the change can be undone. **Recommendation: yes.** If no, we leave it and accept that this automation's counters stop moving.

---

## Follow-ups (not in 2c)

> **Re-scope status:**
> - **Closed:** FU-2 (route deleted), FU-4 (no client scores) and FU-10 (no shares while sharing is off).
> - **Changed:** FU-3 is now "delete the sharing reward code (`RewardService.awardAgentSharingReward`, the `agent_sharing` reward row and `agent_sharing_reward_amount`). No server-side grant is built (BQ-3)". FU-8 is downgraded: inserts are service-role only, so fix it if sharing is ever revived, or under FU-12.
> - **New:** FU-12 and FU-13.

| ID | Item | Owner |
|---|---|---|
| FU-1 | `run-agent` calls the non-existent `ExecutionRepository.create`, `findRunningByAgentId` and `findForStatusQuery` | agent-platform backlog |
| FU-2 | Convert `app/api/agents/import-shared/route.ts` to the `new-api-route` standard (Zod, Pino, cookie helper) | agent-platform backlog |
| FU-3 | The sharing reward is written from the browser and blocked since `20261001`. Move it to a server route, or drop it (BQ-3) | TL / BA |
| FU-4 | Compute the share quality scores server-side instead of trusting the client | agent-platform backlog |
| FU-5 | Remove the browser-client default from `AgentMetricsRepository`, `ConfigRepository` and `MemoryRepository` | backlog |
| FU-6 | Revoke anon EXECUTE on the invoker functions (parent Q-SA-7) | backlog |
| FU-7 | Other API routes still read `x-user-id` (27 matches under `app/api`). This is the identity-hardening sweep, Slice A guard | security backlog |
| FU-8 (SA) | `shared_agent_imports.imported_by_user_id` is NOT NULL but its FK is `ON DELETE SET NULL` (F2). Once anyone imports a template, deleting that account fails with 23502, the same class as the profiles FK delete blocker. Fix it (CASCADE, or make the column nullable) before sharing sees real use, and tell the admin delete-user owner | agent-platform backlog, **before sharing is promoted** |
| FU-9 (SA) | No `user_id` index on `agent_logs` (89 rows) or `agent_stats` (38 rows), and no `agent_id` index on `agent_logs` (F7). Revisit when `agent_logs` passes about 10k rows | backlog |
| FU-10 (SA) | `shared_agents` has no UNIQUE `(original_agent_id, user_id)` (F2), so a concurrent double share can create duplicates. Add it once prod is checked for duplicates (0 rows today) | backlog |
| FU-11 (SA) | `agent_executions.user_id` and `agent_stats.user_id` are nullable (F1), with 0 NULL rows (S-1 arithmetic). Optional NOT NULL | backlog |
| FU-12 (SA, re-scope) | Retire the dormant sharing code once the user confirms sharing is permanently gone:<br>• the share code in the legacy `app/(protected)/agents/[id]/page.tsx` (24 `console.*`)<br>• `AgentSharingValidator`, `AgentScoreService` and `RewardService.awardAgentSharingReward`<br>• `/api/rewards/agent-sharing` and `ConfigRepository.isRewardActive`, once nothing reads them<br>• `app/api/cron/update-template-scores` and its `vercelCrons` test entry<br>Decide separately whether to drop the two empty sharing tables | agent-platform backlog / product |
| FU-13 (SA, re-scope) | `update_agent_schedule_safe` cancels queued and pending `agent_executions` and swallows every error (`EXCEPTION WHEN OTHERS` → `{success:false}`). Under 2c-2 it silently skips another user's queued run on the same agent. Make the failure visible and decide whether cross-user queued runs can exist at all | agent-platform backlog |
| FU-14 (SA, 2c-1 code review) | Help-bot content in the database may still advertise the removed gallery. Two places to check:<br>• the `helpbot_general_prompt` setting, which overrides the hard-coded fallback prompt that 2c-1 edited<br>• `help_articles` rows with `page_context` `/v2/templates` (seeded by `supabase/SQL Scripts/20250129_helpbot_page_contexts.sql`)<br>TL checks this read-only. If the prompt mentions Templates, the user edits it in the admin UI. Orphaned `/v2/templates` articles are harmless and can stay | operator, with 2c-1 deploy |
| FU-15 (SA, 2c-1 code review) | `app/api/help-bot-v2/route.ts` predates the route standards. Pre-existing gaps, none of them a 2c-1 regression:<br>• the body is parsed with `request.json()` and no Zod schema<br>• it uses direct `.from()` on a module-level service-role client instead of repositories<br>• it calls Groq directly, outside the provider factory and model settings | backlog |

---

## SA Review Notes

**Reviewed by SA — 2026-10-14**
**Status:** 🔄 **APPROVED WITH CHANGES**

**Inputs:** this workplan; TL's prod capture [RLS_DISABLED_TABLES_SLICE2C_PROD_CAPTURE_2026-10-14.md](/docs/workplans/RLS_DISABLED_TABLES_SLICE2C_PROD_CAPTURE_2026-10-14.md) (F1–F8); the parent workplan (C-1..C-11, rulings 1–7, "2c acceptance"); the slice 1b workplan; the `tenant-isolation-guard` and `new-api-route` skills; the SECDEF lockdown requirement and `supabase/__tests__/security-definer-surface.guard.test.ts`. I spot-checked the code at `49b66feb`.

**In short:**
- **2c-1:** approved with S-9..S-13. It can start now, because it does not depend on F5.
- **2c-2:** D-1..D-4 and T-1 are approved as designed.
  - **Writing the SQL** waits on S-2 (D-0a capture) and S-3 (the function bodies, which F3 did not capture).
  - **Applying** waits on T1-8 (2c-1 live) and on the user's answer to BQ-4.
- **Slice split:** 2c-0/1/2 is approved, plus a new data step D-0 that runs between 2c-0 and the 2c-2 apply (S-2). There are still two PRs, not stacked. The D-0 scripts ride in the 2c-2 PR.

### S-1. F5 ruling: the 15 owner-mismatch rows

**C-4 stays as written.** There is no `agent_id IS NULL OR` relaxation and no per-table carve-out in any policy. The exception lives in the data and in the pins only.

| Table | Rows | Ruling | Why |
|---|---|---|---|
| `agent_executions` | 11 (2 agents) | **Leave in place.** A documented exception, pinned by id set | Run history is usage and billing evidence, attributed to the account that ran it; that account's `token_usage` and credit charges carry the same user. **Re-owning** would falsify who ran what. It would also hand that account's run outputs, which can hold its own plugin data, to another tenant: the exact disclosure C-4 exists to stop. **Deleting** cannot be undone, cascades to `execution_routing_decisions`, `execution_anomalies` and `agent_scheduler_state`, and destroys the evidence. **Under 2c-2 the rows are harmless.** Only the account that made them can read them. No client path updates them: they are terminal, and that account can no longer load the agent under the `agents` owner policy, so run-agent and agent-stream stop before any write. Service-role readers are unchanged |
| `agent_configurations` | 3 | **Leave, pinned** | The same reasoning: the rows hold the old account's input values. Ids are `config_<agent>_<user>`, so the agent owner's own config row has a different id and no upsert collides with these |
| `agent_stats` | 1 | **Re-own to the agent owner** through D-0b, **only with the user's approval (BQ-4)**. If the user declines, leave it and pin it, and record the consequence | `agent_stats` is keyed by `agent_id` (one row per agent), so this row **is** that agent's stats row. Under 2c-2 the owner's `increment_agent_stats` reaches ON CONFLICT on a row the owner cannot see, and PostgreSQL raises instead of skipping. Every run then logs "Failed to update agent_stats" (non-fatal: `run-agent/route.ts:506, 1036`), and the agent's counters and `last_run_cost` freeze. The row holds counters, not tenant payload (confirm with D-0a's column list), so re-owning it discloses nothing. **Its user_id is not billing evidence**: the charges sit in `credit_transactions` / `token_usage` |

**Cause (SA hypothesis, not blocking).** It is probably not agent re-owning: no code path updates `agents.user_id` (I grepped `app/`, `lib/` and `scripts/`). The likelier cause is cross-user runs before 2026-07-03, when admin calibration started running as the owner (`resolveCalibrationIdentity`, `ab68f84a`). Nothing is newer than 2026-06-02, which fits. D-0a checks whether the row users are platform admins. If the cause turns out to be a live code path, SA re-rules.

**NULL check (Q-2C-3 input).** F5 shows `agent_missing = 0`, and `agent_owner_differs` uses `IS DISTINCT FROM`. So any NULL `user_id` row would have been counted among the 15, and the breakdown shows none of them is NULL. **There are therefore 0 NULL `user_id` rows overall** in `agent_executions` and `agent_stats`. The pre-check still asserts it (S-4).

### S-2. D-0: the pre-apply data step (read-only until the user approves)

**D-0a: TL, read-only, now.** Paste rules apply. One grid:

- For each of the 15 rows:
  - table and row key (`id`, or `agent_id` for `agent_stats`)
  - `agent_id`, the row `user_id` and the agent owner
  - the row's `created_at`, and `status` for executions
  - whether the row user and the agent owner are each in `admin_users`, and each still exists in `auth.users`
- The `agent_stats` column list (`information_schema.columns`), for the `business-os-schema-check` skill.
- The pin values for each table: count, and `md5(string_agg(<key>::text, ' ' ORDER BY <key>::text COLLATE "C"))` over the mismatch set. The separator is a space so that the literal rule holds.

**D-0b: written by Dev, pasted by the user, only after BQ-4 is answered yes.** It is committed in the 2c-2 PR:

- **Script:** `scripts/data-fix-rls-2c-agent-stats-reown.sql`, plus its reverse `..._reverse.sql`.
- **Shape:**
  - One transaction with `SET LOCAL lock_timeout = '5s'`.
  - A DO block that updates `public.agent_stats SET user_id = <owner>`, with a WHERE clause on all three pins: `agent_id = <pinned>`, `user_id = <pinned old>`, and `EXISTS (agents a WHERE a.id = agent_stats.agent_id AND a.user_id = <pinned owner>)`.
  - `GET DIAGNOSTICS n = ROW_COUNT`; if `n <> 1`, raise "nothing was applied".
  - A final SELECT that shows the before and after values.
- **Reverse:** the mirror image (swap the two user ids), with the same guards.
- **Paste rules (C-10):** they apply to both files. Write the uuids as 32 hex digits without hyphens, which PostgreSQL accepts, so the literal rule holds.
- **Tests:** the static test covers both files.
- **Record:** the apply record (date, the user's authorization, before and after) goes in this workplan. That is the audit trail for an operator data fix.
- **Order:** D-0b runs **before** the 2c-2 pre-check.

### S-3. F3 did not capture the bodies (blocks writing the 2c-2 SQL)

The capture says so itself. TL must capture `prosrc` (read-only) for:

- `increment_shared_agent_import_count`: the T-1 body and the verbatim rollback.
- Both `increment_agent_stats` overloads: the conflict target, and that they write no other table. This confirms the S-1 ON CONFLICT analysis. If the body is UPDATE-then-INSERT, the owner gets 23505 instead, with the same outcome.
- `update_agent_schedule_safe`. **The census row is wrong as it stands.** It says "touches `agents` only (slice 2 Q3; F3 re-confirms)", but F3 holds no bodies, and **F8 lists `update_agent_schedule_safe` as naming one of the six tables.** Dev resolves which table it names and on which path (PUT `/api/agents/[id]`, cookie client), and updates the census and the D-1 reasoning if it writes one of the six.

### S-4. The pre-check, pre-guard, post-assert and checker carry the F5 pin

- **Q13 changes** from "STOP if > 0" to **"STOP unless the mismatch set equals the pin"**:
  - per-table count plus the md5 of the id set (S-2)
  - `agent_configurations` 3/`<md5>` and `agent_executions` 11/`<md5>`
  - `agent_stats` 0 after D-0b, or 1/`<md5>` if the user declines
  - every other table 0
  - `null_agent` and `agent_missing` 0
  - NULL `user_id` 0 on `agent_executions` and `agent_stats`
- **The migration's pre-guard** refuses on the same condition.
- **The checker** reports it as one PASS/FAIL line, so a new mismatch after apply is visible.
- **Text to update:** B-6, R2-2, R2-5 and T2-1 now point at S-1.

### S-5. Probes

- **P-8b:** `<b>` inserts a second `shared_agent_imports` row for the same template. Expect 23505 (F2 UNIQUE), with `import_count` still 1.
- **P-11** (only if D-0b ran): the owner of the D-0b agent calls `increment_agent_stats` for it. Expect success.
- **P-12:** the old row user of an S-1 execution reads it (1 row), and the agent owner reads it through the cookie client (0 rows). This proves the documented exception behaves as ruled.
- **P-8 stays as the replacement** for the parent's "42501 expected" probe. This is correct, now that T-1 supersedes ruling 2.

### S-6. T-1 conditions (Q-2C-1)

**Approved.** I checked T-1 against the SECDEF guard. It scans `supabase/migrations`, `supabase/SQL Scripts` and `supabase/held`, and T-1 passes all of it:

- **R-a and R-b:** a schema-qualified REVOKE from PUBLIC, anon and authenticated after the only CREATE.
- **R-c:** `SET search_path = ''` matches `SEARCH_PATH_PIN`.
- **R-d:** no later grant.
- **F-1 and F-2:** top level, not in a DO block or a string.
- **Metrics:** "anon-executable SECDEF" stays 0, and the authenticated count stays 6.

Conditions:

1. **The body is the S-3 captured body.** The only allowed changes are schema-qualification (`public.`, `pg_catalog.`). Keep the original's semantics exactly, including how a NULL `import_count` behaves. Show the diff against the captured body in the code review.
2. **Assert `proconfig` exactly.** The post-assert and the checker assert `proconfig = {search_path=""}`, and that the trigger is still attached and enabled.
3. **The service_role GRANT is a no-op.** The explicit service_role ACL entry survives the REVOKE, so the GRANT can stay or go. The checker asserts the **whole** end ACL, which must be exactly the owner and service_role.
4. **Tenant isolation is accepted as bounded.** The definer UPDATE targets a caller-chosen `shared_agent_id`, but its only effect is +1 and a timestamp on a public gallery row. The INSERT WITH CHECK pins the importer and the created agent, and F2's UNIQUE caps it at one per user per template.

### S-7. Rollback conditions (Q-2C-6)

1. **Order:** `CREATE OR REPLACE` back to invoker first (write `SECURITY INVOKER` explicitly), **then** the GRANTs.
2. **Grant form:** the restoring `GRANT EXECUTE ... TO PUBLIC, anon, authenticated` must be the plain readable form. Otherwise the guard's C-2 backstop raises F-1. The file contains no SECURITY DEFINER, so the guard forms no pair for it.
3. **Final DO block:** it asserts `prosecdef = false`, `proconfig IS NULL` (CREATE OR REPLACE replaces the config; the PGlite dry run proves it), the ACL against the saved pre-check Q10, and `md5(prosrc)` = `5cbf1c07ab4b7de5d89d2709132c5d03` when the body is verbatim.
4. **Behaviour-equal fallback.** It is allowed only if the verbatim body breaks a paste rule. Record the new md5 and the textual diff here, and SA approves that specific body at code review.
5. **D-0b is separate.** The rollback does **not** undo D-0b. D-0b has its own reverse script, and the re-owned row is correct under either state.

### S-8. Apply order (replaces step 1–2 of the 2c-2 apply order)

1. T1-8: the Vercel production deployment contains the 2c-1 merge commit. Quote the deployment SHA in the apply record.
2. D-0b, if BQ-4 is yes.
3. Pre-check CLEAN, including the S-4 pin.
4. Migration, checker, then probes P-1..P-12.

Migrations here are hand-applied (there is no auto-apply on merge), so the 2c-2 PR may merge in either order. The PR body says so.

### Rulings on Q-2C-1..8

| Q | Ruling |
|---|---|
| Q-2C-1 | **T-1 approved**, with S-6. It supersedes parent ruling 2, as the parent's own follow-up anticipated. T-2 is rejected: it adds a new service-role write on a caller-supplied id, and two non-compliant files to convert |
| Q-2C-2 | **Remove both singletons and require a client** in `ExecutionRepository` and `SharedAgentRepository`. No other no-argument constructor exists: `agents/[id]/executions`, `run-agent`, `user/data-export` and `calibrationRcaService` all pass a client. Freeze `AgentMetricsRepository`, `ConfigRepository` and `MemoryRepository` on the C-7 allow-list, with S-13 |
| Q-2C-3 | **Reject NULL everywhere: require the EXISTS.** The agent columns are NOT NULL except `shared_agent_imports.created_agent_id`, and both inserters always set it (`import-shared/route.ts:86`, `(protected)/templates/page.tsx:282`). On the nullable `user_id` columns, `uid = user_id` already rejects NULL. There are 0 NULL rows (S-1). No NOT NULL constraint in 2c (FU-11) |
| Q-2C-4 | **Answered by F2:** UNIQUE `(shared_agent_id, imported_by_user_id)` exists. A repeat import raises 23505, and both callers treat tracking as best-effort. Probe P-8b. FU-8 records the FK defect found next to it |
| Q-2C-5 | **Accepted as the gallery's design.** Sharing an agent publishes its instructions to every signed-in user; that is what "share to gallery" means. Before the stopgap, anon could read all of it. The sharer's `user_id` is an opaque uuid. Column grants would break `select('*')` and are not worth it. BQ-1 covers signed-out visitors |
| Q-2C-6 | **Verbatim is required.** The behaviour-equal fallback is allowed only under S-7.4 |
| Q-2C-7 | **The optional `userId` is fine.** It is backward compatible, and the existing service-role callers are unchanged. It is not a new pattern |
| Q-2C-8 | **FU-3 only.** BQ-3 goes to the user. 2c-1 does not touch the reward code or its message |

### Ruling: anon EXECUTE on the caller-rights functions (F3, FU-6)

**Not in 2c-2. It stays FU-6, as its own small slice after 2c-2 is live.** The reasons:

1. **No exposure.** After 2c-2, anon holds no privilege on the six tables. Every statement inside these invoker functions raises 42501 for anon, so anon EXECUTE reaches nothing.
2. **Scope.** `update_agent_schedule_safe` and `aggregate_execution_model_usage` touch tables outside the six (`agents`, `token_usage`). Revoking pulls their callers, pins and rollback into the one migration that locks hot tables.
3. **ACL shape.** The revoke must be from PUBLIC as well, since anon inherits it, while authenticated must keep EXECUTE on `increment_agent_stats` (run-agent, agent-stream). Each function needs its own ACL shape and its own proof.

The one function inside 2c-2 is `increment_shared_agent_import_count`, whose revoke the SECDEF guard requires anyway.

### Ruling: F7 indexes

**Not in 2c-2. Recorded as FU-9.** At 89 and 38 rows, a sequential scan of a few pages is as cheap as an index lookup. A `CREATE INDEX` inside the migration would also take a SHARE lock that blocks writes on `agent_stats`, which every run writes, and would widen the transaction for no measured gain.

### Ruling: pre-existing bugs

| Bug | Ruling |
|---|---|
| `existsByOriginalAgent` return shape | **In 2c-1.** It is on the exact path being fixed, and the 409 test cannot pass without it. Use `.limit(1)`, not `.maybeSingle()` (S-9) |
| FU-1: `ExecutionRepository.create`, `findRunningByAgentId` and `findForStatusQuery` do not exist | **Follow-up, not 2c-1.** It is a different route with a different risk. **Add to FU-1:** the queue path computes `executionUserId = provided_user_id \|\| user.id` (`run-agent/route.ts:772`), so the row's `user_id` comes from the **request body**. Today the path is unreachable, because the missing method throws first. Under 2c-2, C-4's WITH CHECK would refuse a foreign `user_id` anyway. FU-1 must drop `provided_user_id` when it revives the path |
| BQ-3: the broken share reward | **Follow-up FU-3 plus a user question.** It is not in 2c-1. Note that 2c-1 puts the misleading "will be credited later" message back in front of users, so try to get the user's answer before 2c-1 deploys. It does not block |

### TL's specific checks

1. **C-6 ordering: holds.**
   - Under the post-stopgap state (RLS off, authenticated holds SELECT and INSERT), the 2c-1 cookie client works. Under 2c-2 it also works: owner policies, and the POST's `insert ... select()` RETURNING passes the gallery SELECT.
   - Applying 2c-2 before 2c-1 breaks nothing new (R2-7).
   - S-8 adds the deployment-SHA evidence.
2. **new-api-route compliance: mostly yes.**
   - The plan has `getUser()` from `@/lib/auth` (the skill template, cookie-verified), Zod before any logic, the cookie client passed to repositories, Pino with a correlationId, the development guard on details, a non-blocking audit, and the 401/400/happy-path tests.
   - The gaps are S-10 and S-11.
   - Parent ruling 1 named `createAuthenticatedServerClient().auth.getUser()`. Where the two differ, the skill wins. Use one identity call per request, not both.
3. **T-1 against the SECDEF guard: passes** (S-6, S-7).
4. **Do any "OK" paths break under owner RLS? No.** The one exception is the S-1 `agent_stats` row, which is not a code path. What I verified:
   - **`run-agent`.** It uses `createAuthenticatedServerClient()` (`:67`), and every repository is built on that client (`:94-100`); credits run on `supabaseServer`. `WorkflowPilot(supabase)` (`:229`) receives an agent loaded through `AgentRepository(cookie).findById(agent_id, user.id)`, so it is always the caller's own agent.
   - **`agent-stream`.** It uses `createServerClient` with the anon key and cookies (`:161`) and `getUser` (`:173`). The `agents` read by id (`:180`) runs under the owner policy, so a foreign agent is "not found" before any write.
   - **`lib/pilot`.**
     - `StateManager` inserts `agent_executions` with `this.supabase` (`:511, :693`), with `user_id = context.userId`. The aggregate runs on `supabaseAdmin` (`:547`).
     - Constructions on the cookie client, each scoped to the session user: `run-agent-sandbox` (`user.id`), `calibrate/resume` (it checks `execution.user_id === user.id`, `:77`), and the non-admin `v2/calibrate/batch` (`:182`).
     - Constructions on the service role: the admin `v2/calibrate/batch` cross-user path, `v6/execute-test` (`requireAdmin` + `createServerSupabaseClient`), `sentinel` (`supabaseAdmin`) and `DryRunValidator` (`supabaseServer`).
   - **Others.**
     - `AgentScoreService.updateSharedAgentScore` (a browser UPDATE of `shared_agents`) has no caller; only `calculateQualityScore` and `getExecutionDiversityPenalty` are called. Under 2c-2 it would get 42501, which is correct.
     - `qstashQueue.cleanupOldJobs` DELETEs as the service role.
     - The census verdicts hold, except the `update_agent_schedule_safe` row (S-3).

### Changes required

**2c-2:**

1. **S-1.** Adopt the F5 ruling. Update B-6, R2-2, R2-5 and T2-1. — Priority: High
2. **S-2.** Add D-0a (TL, read-only, now) and D-0b (user-pasted, after BQ-4), with the files, tests and apply record. — High
3. **S-3.** Get the `prosrc` capture before any 2c-2 SQL. Correct the `update_agent_schedule_safe` census row from F8. — High
4. **S-4.** The F5 pin goes in the pre-check Q13, the pre-guard, the post-assert and the checker. — High
5. **S-5.** Probes P-8b, P-11 and P-12. — Medium
6. **S-6 and S-7.** The T-1 and rollback conditions. — High
7. **S-8.** The apply order, with D-0b and the deployment SHA. — Medium

**2c-1:**

8. **S-9.** `existsByOriginalAgent` uses `.limit(1)` and returns `{ exists, sharedAgentId }`. F2 shows no UNIQUE `(original_agent_id, user_id)` on `shared_agents`, so once errors surface, `.maybeSingle()` would turn a duplicate pair into a 500 on Share (FU-10). — Medium
9. **S-10.** WC-7: publishing an agent's instructions to every signed-in user is an **access change**. After the `AGENT_SHARED` `log()`, `await auditTrail.flush().catch(...)` before responding, per the `new-api-route` checklist. Use `AuditTrailService.getInstance()` if the `auditLog` helper cannot flush. Add a test that a flush failure does not fail the request. — Medium
10. **S-11.** A malformed JSON body on POST `/api/shared-agents` returns 400, not 500. Catch the `request.json()` failure before Zod, and add it to the test list. — Low
11. **S-12.** The tests assert that the identity comes from `getUser()` and that `createAuthenticatedServerClient` is the client for **all three** repositories, `AgentRepository` included. The `agentRepository` singleton defaults to the service role, so it must not survive in these routes. — Medium
12. **S-13.** C-7 guard allow-list: each entry is dated with SA approval 2026-10-14, the list is capped at 3 by equality, and a stale-entry check fails when an allow-listed file no longer imports the browser client (the SECDEF / authz guard ratchet pattern). — Low

**Both:**

13. **S-14.** Follow-ups FU-8..FU-11 are added to the table. FU-1 carries the `provided_user_id` note. — Low

### Business questions for the user (via TL)

- **BQ-1, BQ-2, BQ-3** as written above. I agree with the recommendations.
- **BQ-4 is new** (the one automation's run counters). It must be answered **before 2c-2 is applied**. 2c-1 and the writing of the 2c-2 SQL do not wait for it.
- **For information, no decision needed:** 14 old records (3 saved input settings and 11 run histories, May to June) were made by one account on automations that now belong to another account. They are left exactly as they are: still visible only to the account that made them, and never handed to the other account. Moving them would show one customer's run data to another, and deleting them cannot be undone.

### Approval

[x] Workplan approved with changes S-1..S-14. ~~**2c-1 may proceed now** with S-9..S-13.~~ **2c-2:** write the SQL after S-2 (D-0a) and S-3 are in. ~~Apply only after T1-8,~~ D-0b ~~(or the user's "no" to BQ-4, with the pins adjusted)~~ and a CLEAN pre-check.

### Re-scope ruling: SA, 2026-10-14

**Status:** ✅ **Re-scoped workplan approved.** The full ruling is in [Re-scope after the user's decisions](#re-scope-after-the-users-decisions-2026-10-14) (R-1..R-11, the new slice list, the 2c-2 delta, and the Dev stop/revert list).

- **2c-1** proceeds as "switch sharing off", after Dev applies the stop/revert list.
- **2c-2** SQL may be written now, with the delta. S-2 (D-0a) and S-3 are in the capture doc.
- **The 2c-2 apply** needs D-0b (BQ-4 = yes) and a CLEAN pre-check with `agent_stats` pinned at 0. It no longer waits on 2c-1 being live.
- **OS-1** (deactivate the `agent_sharing` reward) is a user action in the admin UI and is recommended with the 2c-1 deploy.
- **R-11:** TL asks the user one question about converting the three touched non-compliant files.

### Code Review by SA: 2c-1 "switch sharing off" (2026-10-14)

**Status:** 🔄 **APPROVED WITH CHANGES.** CR-1 must be fixed before QA. CR-2 goes in the same PR. Everything else is Low or a follow-up.

**What was checked.** The full uncommitted diff: 12 deleted files and 10 modified files, plus the new guard. Both logical changes were checked separately, using Dev's snapshots in the session scratchpad (`after-sharing-off/`):
- HEAD → snapshot is the sharing-off change.
- snapshot → working tree is the logging change.

`git grep` was run over the whole repo, excluding `docs/archive` and the `*.backup*` files, for:
- every deleted path and export
- `/templates`, `/v2/templates`, `/api/shared-agents`, `/api/agents/import-shared` and `/metrics`

Coverage: nav, footer, middleware, `next.config`/`vercel.json`, sitemap and robots, rate-limit and public-route lists, admin pages, email templates, and test files. The guard and the three edited tests were re-run: 4 suites, 89 tests, all green.

#### Verdicts on the review points

| Point | Verdict |
|---|---|
| Nothing still links to or calls the deleted routes and pages | ✅ **Code is clean.** No match in `app/`, `components/`, `lib/`, `hooks/`, `middleware.ts`, config, or any test. The help-bot fallback prompt lost its Templates line. Every remaining `ExecutionRepository` construction passes a client (`executions`, `run-agent` ×2, `data-export`, `calibrationRcaService`, one test). `page-redesign.tsx` had no importer. `docs/V2_TEST_PAGE_SCOPE.md` never mentioned the gallery (its "templates" are parameter templates). The stale references are in **docs** (CR-2) and in **DB help-bot content** (FU-14) |
| No dead code that would 500 at runtime | ✅ All deleted endpoints now 404 by absence (R-1). No surviving code fetches them. The `Promise.all` in `fetchAllData` lost the reward fetch **and** its `rewardStatus` destructuring slot together, so the later results are not shifted. `systemConfigApi.getByKeys` still gets `tokens_per_pilot_credit` |
| `/v2/agents/[id]` still works without the share UI | ✅ The JSX cut is balanced: it removes the Share button between the preceding button and Export, the confirm modal, and the success toast. Every removed icon has 0 remaining uses; `AlertTriangle`, `Loader2` and `supabase` are still used. No `share` or `reward` identifiers are left. The only leftover is `'share'` as a possible value of `actionLoading`, which is harmless |
| Legacy layout | ✅ `refreshTemplateCount` was never called or exposed (0 references at HEAD), so removing it is correct. `refreshCounts` and `refreshAgentCount` are also unreferenced, but they were dead before this change. Leave them |
| C-7 guard part (c) | ✅ **Sound for what R-9 asked.** The three path families are scanned across the four trees, with the test files excluded. Its regexes have catch and ignore self-tests. It runs in milliseconds inside the existing Jest gate. Gaps are Low (CR-4, CR-5) |
| Deviation: 3 lockdown/QA tests edited | ✅ **Accepted. Required by the deletion.** The `RewardService` caller lists now pin only the legacy page, so a new caller still fails. The v2 RC9-7 assertions became negative pins (no banner, no reward call, no "earn credits" or "credited later"), which is stronger than deleting them. The legacy page's RC9-7 assertions are unchanged |
| Deviation: extra unused imports removed | ✅ **Accepted.** Each one was used only by the removed share UI (verified at 0 remaining uses). Under R-2's "now-unused imports" |
| Deviation: `refreshTemplateCount` removed | ✅ **Accepted.** It was part of the removed count state, and dead |
| Logging conversion (R-11) | ✅ **Correct for the page and the footer.** Context comes first, errors are passed as `{ err }`, and the message is static. No control flow changed. The only effect is the level: `console.log` became `debug`, which is suppressed in production (`lib/logger.ts` pins `info`). That is intended (D-OI8), and it also keeps help-bot question text out of production logs. The help-bot route needs a correlationId (CR-1) |
| Split into two commits | ✅ **Clean.** In all three files:<br>• HEAD → snapshot contains only sharing-off hunks. In the page, the only `+` lines are the two rewritten `Promise.all` lines.<br>• snapshot → working tree contains only logging hunks: `console.*` → logger, plus the logger import and instance.<br>The page snapshot keeps all 54 `console.*` calls, because none of them were in the removed share code |

#### Code Review Comments

1. **`app/api/help-bot-v2/route.ts` (`POST`): no correlationId.** Priority: **Medium. Required before QA.**
   - **Ruling: yes, it is required.** CLAUDE.md rule 3 says API routes "also attach a `correlationId`". § Logging says request handlers use `logger.child({ correlationId })`, and a touched file must be converted to the Pino standard. For an API route, that standard includes the correlationId. A conversion without it leaves the file half-compliant.
   - **Fix, in the logging commit.**
     - Near the top of `POST`, add the repo-standard line `const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID()` and `const requestLogger = logger.child({ correlationId })`. This form is used in about 430 routes.
     - `POST`'s own log lines use `requestLogger`.
     - Pass `requestLogger` as a `Logger` parameter to the helpers that `POST` calls and that log. Today those are `searchAgents`, `searchFAQ`, `searchCache`, `handleInputHelp`, `callGroqForInputHelp`, `storeInCache` and `updateAnalytics`. Most of the route's error lines live in these helpers, and they are exactly the lines that need to be tied to a request.
   - **Constraints.**
     - Signatures change only by that one parameter. The helpers have no callers outside this file.
     - No change to responses, status codes or the auth order. `getUser()` stays the first awaited call; deriving the id from a header is not a data access.
     - Add one source-level Jest pin, next to the existing `app/api/help-bot-v2` tests: the file has no `console.` and contains `logger.child({ correlationId })`.
2. **`docs/REPOSITORY_STRATEGY.md`: describes code that no longer exists.** Priority: **Medium. Same PR, as a docs commit or folded into the sharing-off commit.**
   - **Stale content.** It is a living high-level doc. It still documents:
     - `SharedAgentRepository` (tree line 134, § at 180, table at 646)
     - `sharedAgentApi` and `metricsApi` (699–760)
     - the `executionRepository` singleton (498, 790–791)
     - the deleted `/api/agents/[id]/metrics` and `/api/shared-agents*` rows (778, 781–782)
   - **Fix.**
     - Remove those entries.
     - Show `ExecutionRepository` constructed with an explicit client.
     - Add a Change History row that cites 2c-1 / BQ-2.
     - Leave historical workplans alone: they are records.
3. **`docs/HELPBOT_ADMIN_CONFIGURATION_IMPLEMENTATION.md:197`: lists `/v2/templates` as a help-bot page context.** Priority: Low. Remove the line, or mark it "removed 2026-10-14 (sharing off)", in the same docs touch as CR-2.
4. **Guard (c) does not cover `/api/agents/<id>/metrics`.** Priority: Low, optional. The only caller used a template literal, so a path regex is harder to write. Adding a pattern for `` /api/agents/${…}/metrics `` with a mutation pair would close the last deleted endpoint. Not required: the route is gone, and a new caller would get a 404 that QA sees.
5. **Guard (c) checks the bare `/templates` link only in the legacy layout.** Priority: Low, optional. A quote-anchored pattern (a quote or backtick immediately before `/templates`, then a quote, backtick, `/`, `?` or `#`) over all `CODE_FILES` currently has 0 matches. It would catch a `router.push('/templates')` anywhere, without matching `/api/website/templates`-style paths.
6. **Guard mutation test "a fourth allow-list entry would break the cap" is tautological.** Priority: Low. It compares a locally built array with a constant, so it can never fail. Either delete it, or replace it with an assertion against the real list: equality is already pinned in the S-13 test.

#### Optimisation Suggestions (non-blocking)

- **The help-bot route keeps pre-existing standard gaps, out of 2c-1 scope:**
  - `request.json()` without a Zod schema
  - direct `.from()` on a module-level service-role client instead of repositories
  - a direct Groq call
  These are not regressions and should not grow this slice. Record them as FU-15.
- **Legacy layout:** `refreshCounts` and `refreshAgentCount` are unreferenced. Leave them out of this PR. Delete them when the layout is next touched.

#### Ruling on the split (instruction to RM)

The split is clean enough for two commits. **No `git stash`.**

1. **Save the final versions.** Copy the three final files (`app/v2/agents/[id]/page.tsx`, `components/v2/Footer.tsx`, `app/api/help-bot-v2/route.ts`, after the CR-1 fix) to the scratchpad.
2. **Commit 1 (`fix:` sharing off).** Copy Dev's three `after-sharing-off/` snapshots over the working files. Stage them with every other change: the deletions, the layout, `agent-api`, the repositories, the three tests, the guard, docs CR-2/CR-3 and the workplan.
3. **Commit 2 (`refactor:` logging).** Copy the saved final versions back and commit only those three files, plus the CR-1 Jest pin.

Before each commit, run `git diff --cached --stat` to confirm that:
- commit 1 shows no `logger.` additions in the three files
- commit 2 shows only those three files (and the pin)

**Snapshot caveat:** the snapshots predate CR-1. CR-1 lands only in commit 2, so commit 1 is unaffected.

### Code Approved for QA: **No**, until CR-1 and CR-2 are done.

Once they are, QA may start without a second SA pass, provided the re-diff shows:
- **CR-1:** only the correlationId, the `requestLogger` threading and the pin
- **CR-2:** docs changes only

### Code Review by SA: 2c-2 SQL (2026-10-14)

**Status:** 🔄 **APPROVED WITH CHANGES.** The SQL is correct and safe to apply to production once CR2-1 and CR2-2 are done. CR2-3 binds TL's apply procedure, not the files.

**Reviewed:** the D-0b pair, the pre-check, the migration `20261062`, the checker, the rollback and the static test, against the re-scope, [2c-2 as written](#2c-2-as-written) and the prod capture. I re-ran the static test and the SECDEF guard (2 suites, 155 tests, green), scanned all six files for paste-rule breaks and for `CASE` inside an `IF` myself, and grepped the code for client DELETEs. Nothing was applied and no database was touched.

#### What I verified

| Check | Result |
|---|---|
| **C-4, INSERT** | `uid = user_id AND EXISTS (agents owned_agent WHERE owned_agent.id = <table>.agent_id AND owned_agent.user_id = uid)`. The column is table-qualified, and the `agents` read runs under the caller's own `agents` policy, which is consistent. ✅ |
| **C-4, UPDATE** | `USING uid = user_id`. The WITH CHECK repeats the full INSERT check against the **new** row, so re-pointing `agent_id` at a foreign agent fails the EXISTS, and re-pointing `user_id` fails `uid = user_id`. Both are refused (dry run: "re-pointing to a foreign agent refused"). ✅ |
| **No DELETE for signed-in users** | No client or cookie-client `.delete()` on the four agent tables anywhere in `app/ lib/ components/ hooks/`. The only hits are `lib/queues/qstashQueue.ts:274, 282`, whose module client is built with `SUPABASE_SERVICE_ROLE_KEY` (service role, unaffected). Agent deletion deletes from `agents`, and the FK cascades are RI actions, which bypass RLS. `agent_logs` is FK NO ACTION, which is pre-existing and unchanged. Nothing live breaks. ✅ |
| **`increment_agent_stats` after D-0b** | It is an `INSERT ... ON CONFLICT (agent_id) DO UPDATE` (S-3). For the owner, the proposed row passes the INSERT check. The existing row (now `user_id` = owner) passes SELECT and the UPDATE USING. The result row keeps `user_id` and `agent_id`, so it passes the UPDATE WITH CHECK. Grants SELECT, INSERT and UPDATE cover the upsert. Proven by P-11 in the dry run. ✅ |
| **`update_agent_schedule_safe`** | The owner's cancel UPDATE sees only rows with `user_id` = caller. It changes only `status` and `error_message`, so the WITH CHECK passes, nothing raises, and the `EXCEPTION WHEN OTHERS` branch (which would also roll back the `agents` schedule change) is not reached. None of the 11 S-1 executions is queued or pending. Another user's queued run is skipped silently, which is FU-13 and accepted. ✅ |
| **`execution_routing_decisions` policy** | For `authenticated`, the subquery now runs under the `agent_executions` owner SELECT policy, whose predicate is the same `user_id = auth.uid()`, so the result is identical. The policy is md5-pinned in the pre-guard and in checker B2, and P-7 compares counts. **Note, not a defect:** an `anon` read of that table already hits 42501 inside the subquery, since the stopgap, so 2c-2 changes nothing there. ✅ |
| **Rollback = exact inverse to the `20261060` state** | Per table, it is the mirror of the migration: DROP the 3 policies by name (reverse order), `REVOKE ALL ... FROM PUBLIC, anon, authenticated`, `GRANT SELECT, INSERT, UPDATE, DELETE ... TO authenticated`, DISABLE. The sharing tables get REVOKE, the 4-grant and DISABLE. `service_role` is never touched. The final DO asserts the stopgap post-assert state plus RLS off and 0 policies. It never grants anon, and it leaves D-0b alone (S-7.5). The dry run's pre-check after the rollback was identical to the one before the migration. ✅ |
| **Paste rules, FORCE, SECURITY DEFINER** | No `--` or `/*`, no "into", even quote counts, literals limited to `[A-Za-z0-9_ ]`/hex, `COLLATE "C"` on every `string_agg`, no single-letter alias, no hyphenated uuid, no FORCE and no SECURITY DEFINER in any of the six files. No function, view, trigger or sequence is created, dropped or altered. ✅ |
| **lock_timeout and one transaction** | The migration, the rollback and both D-0b scripts are `BEGIN; SET LOCAL lock_timeout = '5s'; ... COMMIT;`. Every refusal is a `RAISE EXCEPTION ... so nothing was applied` inside the transaction. The pre-check and checker are read-only (`default_transaction_read_only`) and write nothing. ✅ |
| **The CASE-inside-IF bug** | Every `CASE` is now assigned to a variable before the `IF` (migration 260–268, 521, 576–584; rollback 42). My own scan of the four DO-bearing files finds no `CASE` inside an `IF`/`ELSIF` condition, and the static test pins it with a self-test. The pre-check and checker have no DO block. Fixed everywhere. ✅ |
| **Pre-guard and post-assert** | The pre-guard pins the post-stopgap state exactly, plus the S-4 pin on all six tables. The post-assert re-checks the grants, the policy count and shape, and the pin. `has_table_privilege(..., 'MAINTAIN')` requires PG 17, which prod is (the stopgap already used it). ✅ |
| **Migration number** | `20261062`: `origin/main` (`5e44871d`) still tops at `20261060`; `20261061` is only in `determined-davinci-cea7bf` (untracked); `20261066` only in `neuronforge-model-pricing-s3`. ✅ RM re-checks before merge |

#### Rulings on Dev's open questions

| # | Question | Ruling |
|---|---|---|
| 1 | Migration number | **`20261062` approved.** Do not reclaim `20261061`, even though it is only held by an untracked file. A collision on `main` costs more than a gap. RM re-checks at PR time and right before merge (C-1) |
| 2 | D-0b uuids as placeholders | **TL's view is upheld: placeholders in the committed files, filled at paste time.** The repo is public. Two admin user ids plus an agent id are minor, but they serve no purpose in git, and the capture doc already avoided them. The design is safe because a wrong fill cannot do harm: the agent must hash to `2a4cf06b…`, the owner is checked by the EXISTS on `agents`, and the old user must equal the row's current user, or `ROW_COUNT` ≠ 1 and the script refuses. **Conditions:** CR2-1 and CR2-3 (steps 2–3 and 10) |
| 3 | md5 formula: comma via `chr(44)`, plus `COLLATE "C"` | **Approved. It supersedes S-2's space separator.** The pins in the capture were computed with a comma, so the scripts must use a comma. `chr(44)` keeps the literal rule. `COLLATE "C"` gives the same order as the capture's default collation for these ids: uuids, and same-shape `config_<uuid>_<uuid>` text ids, which are fixed length with the punctuation in the same positions. If prod ever disagrees, the result is a pre-check STOP on that one Q13 row, never a wrong apply. In that case TL re-captures under `COLLATE "C"` (read-only) and SA approves the pin swap |
| 4 | Policy alias `owned_agent` | **Approved.** D-1's `a` is notation. The paste rule bans single-letter aliases, the columns inside the EXISTS are still table-qualified, and the checker keys on `owned_agent` |
| 5 | Extra pre-guard pins (0 owned sequences, 0 policies on the six, exactly 3 `agents` policies) | **Approved.** All three fail closed, and the pre-check reports each one. A fourth `agents` policy, which could widen what the EXISTS sees, is exactly the drift that must stop the apply |
| 6 | Pin the 12 new policy md5s after the first prod run | **Record them, do not edit the checker now.** The md5 is of the server's deparsed text, and PGlite 18 cannot be trusted to deparse the same way as prod 17. The checker C10 rows print all 12 qual/check md5s. TL copies them into the apply record. **Sanity check:** the 8 SELECT/UPDATE `qual` md5s are identical, and each table's INSERT check md5 equals its UPDATE check md5. The next slice that touches these tables pins them in its pre-guard (FU-16) |
| 7 | Keep the sharing tables in the S-4 pin | **Keep them.** At 0 rows they cost nothing. They also catch a row written before the apply that the lock would strand: a NULL `created_agent_id` after an agent delete, or a mismatched importer. A legitimate legacy share has a matching owner, so it does not trip the pin |

#### Code Review Comments

1. **CR2-1** `supabase/migrations/__tests__/rls-disabled-agent-tables-slice2c.migration.test.ts:477-481`. The test accepts **either** `FILL_*` or 32 hex digits for the three D-0b pins, so a filled-in copy saved over the file would pass CI and publish the ids. Under ruling 2, require exactly `FILL_AGENT_ID`, `FILL_OLD_USER_ID` and `FILL_NEW_OWNER_ID`, all five occurrences per file (3 in the DECLARE, 2 in the final SELECT), and no 32-hex literal other than the md5 pins. Add a mutation self-test that a filled value fails. — Priority: **Medium**
2. **CR2-2** Workplan text still says `20261061` in the header (line 13), the original slice table (line 36), the ToC entry and the heading "Slice 2c-2: RLS migration 20261061", the new slice list row 4, Migration number, Files and T2-2. Point each live reference at `20261062`, or mark it superseded where it stands, keeping the anchors working. This is part of T2-12. — Priority: **Low**
3. **CR2-3** The apply procedure below **replaces** the 2c-2 apply order (re-scope list and S-8). Three things in it are new and binding:
   - **Pre-check #1 comes before D-0b.** The D-0b fill values come from Q13.
   - **The fill values are saved outside the repo before D-0b runs.** After D-0b, Q13 prints "none", and the database keeps no record of the old user, so the reverse script cannot be filled any other way.
   - **No live TRUNCATE probe on production.** — Priority: **High** (procedure)

#### Apply procedure for 2c-2 (TL and the user; production `jgccgkyhpwirgknnceoh`)

Use the file text exactly as it passed QA and the user's diff review. Every step needs the user's explicit authorization in the session. Each numbered SQL step runs in a **new** SQL-editor tab: the pre-check and checker set `default_transaction_read_only`, which would make a later write fail for the wrong reason.

1. **Pre-check #1** (`scripts/precheck-rls-disabled-agent-tables-slice2c.sql`). Expect `STOP 1`, where the single STOP row is `Q13 owner mismatch pin agent_stats ... the D0a row is still there so run D0b first`. Every other row should read ok, configurations `3` with md5 `b31a2dae…` and executions `11` with md5 `23439f47…`. `Q13 D0b fill values` should hold **exactly one** entry ending in `is the D0a agent`. Any other STOP: halt and send the output to SA.
2. **Save the three hex values** (agent, old user, new owner) from `Q13 D0b fill values` **outside the repo**, in the TL session or with the user. Never commit them, and never put them in this workplan.
3. **D-0b, new tab, pasted by the user.**
   - Fill `scripts/data-fix-rls-2c-agent-stats-reown.sql` in the editor only, never in the repo file. Replace all five placeholders: `FILL_AGENT_ID` ×2, `FILL_OLD_USER_ID` ×2, `FILL_NEW_OWNER_ID` ×1. A search for `FILL_` must then find 0.
   - Expect the final row `D0b done`, `row user is the agent owner`, with `after_user_hex` = the new owner. Any exception means nothing was applied: halt.
   - Fill the reverse script the same way and keep it unrun, beside the saved values.
4. **Pre-check #2, new tab.** Expect `CLEAN run the migration in a NEW tab`, with Q13 `agent_stats 0 rows md5 none ... equals the pin ok`. **Save the full output.** It is the rollback's grant record (stopgap SC-3 rule).
5. **Migration `20261062`, new tab.** Any error means nothing was applied. A lock timeout means retry off-peak.
6. **Checker, new tab.**
   - Expect `VERDICT PASS 66 pass 0 fail`.
   - Copy the 12 policy md5s from the C10 rows into the apply record, with the ruling 6 sanity check.
7. **Probes, new tab.** Each probe is its own block:
   - **Block form:** `BEGIN; SET LOCAL ROLE authenticated` (or `anon`), then `SELECT set_config('request.jwt.claims', '{"sub":"<uuid>","role":"authenticated"}', true);`, then the probe, then `ROLLBACK;`.
   - **Probes to run:** P-1, P-2, P-3, P-4 (both calls inside the ROLLBACK block), P-6 (42501), P-7, P-8 (INSERT into `shared_agent_imports`, 42501), P-9, P-10 (42501), P-11 (inside ROLLBACK, so the real counter is not bumped) and P-12.
   - **P-5 is changed:** run `DELETE FROM public.agent_logs WHERE id IS NULL` as `authenticated` (expect 42501), so that even under the wrong role it deletes nothing. **Do not run a TRUNCATE probe on production.** Checker C7 already proves `authenticated` holds no TRUNCATE.
8. **Advisors.**
   - `rls_disabled_in_public` names none of the six tables.
   - `rls_enabled_no_policy` (INFO) on `shared_agents` and `shared_agent_imports` is expected (R-5). Record it; do not fix it.
9. **Watch the logs for 24 h:** no new 4xx or 5xx on the six tables, and `agent_executions` keeps growing.
10. **Apply record** in this workplan, without uuids:
    - date and the user's authorization
    - the D-0b result line, with the ids replaced by "D-0a agent"
    - the pre-check #2 status, the checker verdict, the 12 policy md5s and the probe outcomes
    - the advisor result

**Rollback** runs only with the user's explicit authorization. Before running it, compare its grants with pre-check #2 Q4/Q5. The D-0b reverse is separate, and it needs the values saved in step 2. The re-owned row is correct under either state, so the reverse is optional.

#### Optimisation Suggestions

- The post-assert and C10 match policies by name, cmd, role and `strpos`, not by exact text. That is acceptable because the static test pins the exact `CREATE POLICY` text, and ruling 6 adds the md5 record. No change is needed now.
- **FU-16 (new):** once the 12 md5s are recorded, the next slice that touches these four tables pins them in its pre-guard.

### Code Approved for QA: **Yes, after CR2-1 and CR2-2.** No second SA pass is needed if the re-diff touches only the test (CR2-1) and the workplan text (CR2-2). CR2-3 is TL's apply procedure.

---

## Dev implementation notes (2c-1)

**Dev, 2026-10-14.** Worktree `.claude/worktrees/agent-a5313d72f06a51a47`, branch `worktree-agent-a5313d72f06a51a47`, base `49b66feb`. Nothing committed, nothing staged, no database touched.

**Stop/revert list:** applied as written. The earlier route-fix work (the metrics route, both shared-agents routes, their tests, `SharedAgentRepository` and its test, the `findByAgentId` test) is deleted. `ExecutionRepository` keeps the required client and loses the singleton; the `userId` option is reverted.

**Deleted (R-1, R-8):** `app/api/shared-agents/route.ts`, `app/api/shared-agents/exists/route.ts`, `app/api/agents/import-shared/route.ts`, `app/api/agents/[id]/metrics/route.ts`, `app/(protected)/templates/page.tsx`, `app/v2/templates/page.tsx`, `components/v2/templates/*` (4 files), `app/v2/agents/[id]/page-redesign.tsx` (re-confirmed: no importer), `lib/repositories/SharedAgentRepository.ts`.

**Modified, sharing off (deletions only):** `app/v2/agents/[id]/page.tsx` (Share button, confirm modal, success toast, both handlers, `checkSharingEligibility` and its effect, the `/api/rewards/agent-sharing` fetch, the `agent_sharing_reward_amount` key, the share/reward state, and the imports this left unused: `sharedAgentApi`, `metricsApi`, `Share2`, `CheckCircle2`, `AlertCircle`, `Shield`, `Zap`, `Brain`); `lib/client/agent-api.ts` (`sharedAgentApi`, `metricsApi`); `app/(protected)/layout.tsx` (Templates link, the `shared_agents` count, its state, ref, refresh helper and the `Workflow` icon); `components/v2/Footer.tsx` (Templates button, `Sparkles`); `app/api/help-bot-v2/route.ts` (the Templates help line); `lib/repositories/ExecutionRepository.ts`; `lib/repositories/index.ts`.

**Guard (R-9):** `lib/repositories/__tests__/anon-default-repositories.guard.test.ts` keeps (a) with the S-13 allow-list of 3, drops (b), adds (c) (no `/api/shared-agents`, `/api/agents/import-shared` or `/v2/templates` under `app/`, `components/`, `lib/`, `hooks/`; no `href="/templates"` in the legacy layout), with mutation self-tests. 27 tests.

**Three existing tests updated (not on SA's list, required by the deletion):** `userSubscriptionsWriteLockdownMigration.test.ts`, `paymentTablesWriteLockdownMigration.test.ts` and `userSubscriptionsWriteLockdown.qa.test.ts` pinned the v2 page as a `RewardService` caller and pinned its reward-failure alert. The caller lists now hold only the legacy page. The v2 assertions are replaced by "the v2 page makes no sharing-credit promise and calls no `RewardService`". The legacy page's RC9-7 assertions are unchanged.

**Importer grep:** `git grep` for every deleted path and export name finds no importer. Remaining matches are not imports: local variables named `executionRepository` (each built with an explicit client), two `page.tsx.backup-*` files (not compiled, not routed), and the 2025 seed `supabase/SQL Scripts/20250129_helpbot_page_contexts.sql`, which lists `/v2/templates` as a help-bot page context.

**Logging (R-11), a separate logical change:** `console.*` converted in the three files: 54 in `app/v2/agents/[id]/page.tsx`, 13 in `components/v2/Footer.tsx`, 33 in `app/api/help-bot-v2/route.ts`. `console.log` became `debug`, `warn` stayed `warn`, `error` became `error` with `{ err }`. Context goes first and the message second. The page reuses its existing `clientLogger` import (`@/lib/logger/client`). The footer uses `createLogger({ module: 'V2Footer' })` from `@/lib/logger`, the pattern of the `'use client'` components under `components/business-os/`. The route uses `createLogger({ module: 'HelpBotV2API' })`. No control flow changed.

**Results:** the guard plus the authz guard, `supabase/__tests__`, `supabase/migrations/__tests__`, `lib/repositories/__tests__`, `app/api/help-bot-v2`, `lib/credits` and `lib/client` give 134 suites and 4242 tests, all passing. eslint on the touched files: 0 errors, and no file gained warnings. `lint:hooks`: clean. Scoped `tsc` over the 34 touched files and importers of `lib/client/agent-api.ts` and `lib/repositories/index.ts`: no new errors. The errors it reports in those files are pre-existing: message-first `clientLogger` calls in the page, `marketingLoginUrl` in the layout, the footer's `<style jsx>`, the help-bot prompt typing, and run-agent's FU-1.

**SA code review fixes (CR-1..CR-6), 2026-10-14:**
- **CR-1 (logging commit):** `app/api/help-bot-v2/route.ts` `POST` derives `correlationId` (`request.headers.get('x-correlation-id') || crypto.randomUUID()`, before `try`, not awaited, so `getUser()` stays the first awaited call) and `requestLogger = logger.child({ correlationId })`. `requestLogger` is passed as a trailing `log: Logger` parameter to `searchAgents`, `searchFAQ`, `searchCache`, `handleInputHelp` (which passes it on to `callGroqForInputHelp`), `storeInCache` and `updateAnalytics`; their log lines use it. `searchCache`'s `pageContext?: string` became `pageContext: string | undefined`, because a required parameter cannot follow an optional one (its one caller already passes it). No response, status or auth-order change. New pin `app/api/help-bot-v2/__tests__/logging.guard.test.ts`: no `console.`, the correlationId line and `logger.child({ correlationId })` present, and the module logger used only for `.child(`.
- **CR-2:** `docs/REPOSITORY_STRATEGY.md` (841 to 803 lines). Removed `SharedAgentRepository` (tree, catalog, logging table), `sharedAgentApi` / `metricsApi` (services table, example, method tables), the deleted route rows, and the `executionRepository` singleton (import example now shows `new ExecutionRepository(client)`; route rows name the class with its client). "Adding New Repositories" now says never to default to the browser client (C-7). Change History row added. The `SharedAgent` type row stays: the type is still in `types.ts`.
- **CR-3:** `docs/HELPBOT_ADMIN_CONFIGURATION_IMPLEMENTATION.md:197` marked "page removed 2026-10-14 ... the seeded row may remain in the database, FU-14" instead of deleted, because that list records what the seed migrated.
- **CR-4 / CR-5 / CR-6 (guard):** `METRICS_ROUTE` covers `/api/agents/<literal or ${...}>/metrics`; `TEMPLATES_PAGE_PATH` (quote-anchored `/templates`) now scans every code file instead of only the layout; the S-13 check is a predicate (`allowListViolations`) used by the real test and by the mutation self-test (grown, shrunk and undated lists). Catch/ignore pairs for both new patterns. 0 matches in the tree today.
- **Re-run:** guard + the 3 edited tests + `app/api/help-bot-v2` (incl. the pin): 7 suites, 114 tests, all green. eslint: 0 errors (help-bot route 11 warnings, unchanged; new files 0). `lint:hooks` clean. Scoped `tsc` on the route, the pin and the guard: only the two pre-existing prompt-typing errors.
- **Snapshots:** `after-sharing-off/` not touched; CR-1 and the pin belong to commit 2 only. CR-2/CR-3 and the guard changes belong to commit 1.

**Open:** the branch (T1-1). The help-bot prompt and page context may also be stored in the database (`helpbot_general_prompt`, help-bot page contexts), and may still mention Templates. That is a content follow-up, not code.

## 2c-2 as written

**Dev, 2026-10-14.** SQL only, written to the [re-scope](#re-scope-after-the-users-decisions-2026-10-14) and its [2c-2 delta](#2c-2-changes-a-delta-on-slice-2c-2). Same worktree as 2c-1; no 2c-1 file touched. Nothing committed, nothing applied, no database touched.

**Migration number: `20261062`, not `20261061`.** `20261061` is free on `origin/main` (`096f86e0`) and on every ref, but the worktree `.claude/worktrees/determined-davinci-cea7bf` (branch `fix/gpt-image-1-retirement`) holds an untracked `20261061_bos_llm_images_model_gpt_image_2_5_flare.sql`. `20261062` is free on `origin/main`, every ref and every worktree (`neuronforge-model-pricing-s3` holds `20261066`). RM re-checks at PR time.

**Files (all new):**

| File | What |
|---|---|
| `scripts/data-fix-rls-2c-agent-stats-reown.sql` | D-0b. One transaction, `lock_timeout`, one DO: the three pins must be 32 lowercase hex digits, the agent must hash to the D-0a pin `2a4cf06b…`, old user ≠ new owner, exactly 1 `agent_stats` mismatch before (and it is the pinned one), a single UPDATE guarded by agent + old user + `EXISTS` agent owned by the new owner, `ROW_COUNT` = 1, 0 mismatches after. Any other outcome raises "so nothing was applied". A read-only SELECT after COMMIT shows before and after |
| `scripts/data-fix-rls-2c-agent-stats-reown_reverse.sql` | The mirror image (owner back to the old user). Asserts 0 before, 1 after, and the restored set hashes to the D-0a pin |
| `scripts/precheck-rls-disabled-agent-tables-slice2c.sql` | Read-only, `PRECHECK STATUS` first. Q0 version and role, Q1–Q3 table state, Q4 privileges (PUBLIC/anon none, authenticated exactly the four, service_role the four), Q5 grantors, Q6 column ACLs, Q7 owned sequences (STOP if any), Q8 policies (STOP if any), Q9 triggers (information, with body md5), Q11 routing policy pin, Q12 `agents` policy pins, Q13 the S-4 pin per table plus the **D0b fill values**, Q14 mentions, Q15 the 1b view, Q16 row counts. Before D-0b it says `STOP 1` ("the D0a row is still there so run D0b first") |
| `supabase/migrations/20261062_rls_disabled_agent_tables_slice2c_owner_policies.sql` | One transaction, `lock_timeout = '5s'`. Pre-guard DO (the post-stopgap state, 0 policies, 0 owned sequences, no column ACL, the `agents` and routing policy md5 pins, the 1b view, the S-4 pin on all six). Per agent table: ENABLE, `REVOKE ALL ... FROM PUBLIC, anon, authenticated`, `GRANT SELECT, INSERT, UPDATE ... TO authenticated`, the three D-1 policies. Per sharing table: ENABLE and the REVOKE only. Post-assert DO. Never FORCE, no SECURITY DEFINER, no function or trigger touched |
| `scripts/check-rls-disabled-agent-tables-slice2c-migration.sql` | Read-only, `VERDICT` first. 66 checks: C1–C10 per table (C7 is the exact authenticated set; C10 the exact policy set, printing each policy's qual/check md5) and B1–B6 (S-4 pin as one line, routing policy, `agents` policies, 1b view, import trigger untouched, no owned sequence) |
| `supabase/SQL Scripts/20261062_rls_disabled_agent_tables_slice2c_owner_policies_rollback.sql` | Warning first. Pre-guard (RLS on, 3 or 0 policies). Per table, the exact inverse: DROP the three policies by name, `REVOKE ALL ... FROM PUBLIC, anon, authenticated`, `GRANT SELECT, INSERT, UPDATE, DELETE ... TO authenticated`, DISABLE. The final DO asserts the `20261060` post-assert state plus RLS off and 0 policies. It does not undo D-0b (S-7.5) |
| `supabase/migrations/__tests__/rls-disabled-agent-tables-slice2c.migration.test.ts` | Static guard over the six files, with mutation self-tests |

**Departures from the text, for SA:**

- **Policy alias.** D-1 writes `agents a`; the files use `AS owned_agent`, because the paste rules forbid a single-letter alias. The columns inside each `EXISTS` are table-qualified as D-1 requires.
- **The md5 formula follows the capture, not S-2.** The capture's pins use `md5(string_agg(id::text, ',' ORDER BY id::text))`; S-2 asked for a space separator and `COLLATE "C"`. A comma literal breaks the literal rule, so the files write `chr(44)`, and add `COLLATE "C"`. For these ids the order is the same under any collation (fixed-length, punctuation at the same positions, lowercase hex). The dry run computed the fixture pins with the capture's exact formula, and the scripts reproduced them.
- **D-0b pins are placeholders.** The capture records the agent only as an md5, not the three uuids. The scripts hold `FILL_AGENT_ID`, `FILL_OLD_USER_ID` and `FILL_NEW_OWNER_ID`; the pre-check row **Q13 D0b fill values** prints the three hex values (and whether the agent is the D-0a one). An unfilled or wrongly filled script refuses with "nothing was applied". Both files must carry the same three values (static test). **CR2-1:** the static test now requires exactly the five placeholders per file and rejects any other 32-hex literal, with a self-test that a filled copy fails; fill only in the SQL editor (SA ruling 2).
- **The migration also pins 0 owned sequences**, 0 policies, and the 1b view, and asserts it again after the change.
- **plpgsql gotcha found by the dry run:** a `CASE` inside an `IF` condition is a syntax error at apply time (plpgsql reads up to the first `THEN`). The files assign the expected value first; the static test forbids `CASE` inside any `IF`.

**PGlite dry run** (PGlite 0.5.8, PostgreSQL 18.3, in memory, scratchpad only). Setup: `anon`, `authenticated`, `service_role` (BYPASSRLS), `auth.uid()` from `request.jwt.claims`, `agents` with the three F6 policies, the six tables with F1 columns, the two `updated_at` triggers, the invoker import-counter trigger, invoker `increment_agent_stats`, `execution_routing_decisions` with both policies, the 1b view; `GRANT ALL` to the three roles, then the real `20261060` file. Fixture: 3 configuration, 11 execution and 1 stats mismatch rows (admin on admin). The `agents` and routing policy md5s in PGlite **equal the prod capture**; only the three data pins were substituted with the fixture's own.

| Step | Result |
|---|---|
| Pre-check before D-0b | `STOP 1`: only Q13 `agent_stats`, "run D0b first"; Q13 D0b fill values printed |
| D-0b | unfilled refuses; wrong old user refuses (0 rows); filled applies 1 row; re-run refuses |
| Pre-check after D-0b | `CLEAN run the migration in a NEW tab` (97 rows) |
| Migration, re-run | applies; re-run refuses ("row security is already on") |
| Checker | `VERDICT PASS 66 pass 0 fail` |
| anon | SELECT on all six: 42501 (P-1) |
| authenticated owner | own count = service count (P-2); INSERT on a foreign agent or as another user: RLS violation (P-3); `increment_agent_stats` own agent OK, foreign agent RLS violation (P-4); DELETE and TRUNCATE 42501 (P-5); routing decisions count unchanged (P-7); UPDATE own `agent_logs` 1 row (P-9); re-pointing to a foreign agent refused; D-0b agent owner `increment_agent_stats` OK (P-11) |
| authenticated other user | sees 0 of the owner's rows on all four tables; UPDATE of them affects 0 rows; SELECT `shared_agents` 42501 (P-6); INSERT `shared_agent_imports` 42501 (P-8); UPDATE `shared_agents` 42501 (P-10) |
| S-1 exception | old row user reads 6, agent owner reads 0 (P-12); the old user's UPDATE is refused by C-4 |
| service_role | SELECT on all six OK; DELETE OK; an import fires the unchanged trigger (`import_count` 1) |
| Trigger | function, ACL, md5 and enabled state identical after the migration and after the rollback |
| Rollback, re-run | applies; re-run refuses ("already off") |
| Pre-check after rollback | **identical** to the pre-check before the migration (exact round trip); anon still closed; signed-in users see every row again (the stopgap state) |
| D-0b reverse | applies; pre-check `STOP 1` again; reverse re-run refuses; migration refuses while the row is back |
| Fail-closed | FORCE on, an anon column grant, authenticated with TRUNCATE, authenticated without DELETE, a stray policy, a drifted routing policy, an extra `agents` policy, a new mismatch row, a changed S-1 execution set, and the 1b view granted: each gives pre-check STOP and migration "nothing was applied" |

**Apply order:** superseded by SA's [Apply procedure for 2c-2](#apply-procedure-for-2c-2-tl-and-the-user-production-jgccgkyhpwirgknnceoh) (CR2-3). It is binding: pre-check #1 runs before D-0b, the fill values are saved outside the repo, and there is no live TRUNCATE probe on production.

## 2c-2 production apply record (2026-10-14)

**Project:** `jgccgkyhpwirgknnceoh` (production). **Applied by:** TL, through the Supabase connector, at the user's explicit request in the session on 2026-10-14. **Procedure:** SA's [Apply procedure for 2c-2](#apply-procedure-for-2c-2-tl-and-the-user-production-jgccgkyhpwirgknnceoh) (CR2-3).

| Step | Result |
|---|---|
| Pre-check #1 | `STOP 1`: only Q13 `agent_stats`, "run D0b first". `agent_configurations` 3 rows, md5 `b31a2dae…`; `agent_executions` 11 rows, md5 `23439f47…`; one fill entry "is the D0a agent". All Q4/Q5 grants as the stopgap left them |
| D-0b fill values | Saved outside the repo, in the session scratchpad. Never committed |
| D-0b re-own | "D0b done"; the row's user is the agent owner. Counters unchanged: `run_count` 1, `success_count` 1 |
| Pre-check #2 | `CLEAN`. Q13 `agent_stats` 0 rows |
| Migration `20261062` | Applied in one transaction; the pre-guard and the post-assert passed |
| Checker | `VERDICT PASS`, 66 pass, 0 fail |
| Policy md5s (SA ruling 6, FU-16) | SELECT/UPDATE qual: all `ff452c766f1dd1d84c376129b36406c1`. INSERT check = UPDATE check per table: `agent_configurations` `a30304b64b5eb0037cabc3ada8896d0f`, `agent_executions` `9680e2a8014f9f0c87e925e5e5e9b301`, `agent_logs` `ebf08590d507551e9802bc3dfe04ae0d`, `agent_stats` `5a22604b73891a6e19dd0a0ee3b18a75`. The two sharing tables have 0 policies |
| Probes | Run in one `DO` block that ended with `RAISE EXCEPTION`, so everything was rolled back; the counter was confirmed back at 1 afterwards. P1/P1b: anon on executions and `shared_agents` → 42501. P2: the owner sees 910 of their own 910. P3: insert on a foreign agent → 42501. P4: re-point to a foreign agent → 42501. P9: the owner updates their own rows (554). P5: DELETE → 42501. P6/P8: signed-in on `shared_agents` and `shared_agent_imports` → 42501. P10: the 1b view → 42501. P7: routing decisions 0, because the table is empty for everyone. X1/X2: another user sees 0 and updates 0 of the owner's rows. P11: the owner's `increment_agent_stats` is OK. No TRUNCATE probe was run on production, per SA |
| Advisor | `rls_disabled_in_public` and `security_definer_view` are gone; 0 ERROR lints. INFO `rls_enabled_no_policy` on `shared_agents` and `shared_agent_imports` is expected (locked to the service role, per the re-scope) and is not to be "fixed" |
| 24h log watch | See the TL note in the PR (pending at write time) |

## QA Testing Report

### QA: slice 2c-1 (switch sharing off)

**QA, 2026-10-14**
**Test mode:** full
**Strategy used:** A (Jest static guards and source pins), static grep, eslint, full-project `tsc`, and D by code read (no browser session in this worktree)
**Focus:** api, ui, security
**Skipped:** `next build` (see below). Browser click-through is left to T1-8 on production
**Input source:** prompt from TL, plus the re-scope section of this workplan
**Covers:** the worktree as it stood after Dev applied SA CR-1..CR-5: the help-bot `correlationId`, `logging.guard.test.ts`, the broader guard (c), the `allowListViolations` self-test, and the two doc edits. The untracked 2c-2 SQL files and their test are out of scope

#### Test Coverage

| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| The 12 files in the 2c-1 list are deleted | ✅ | Pass | `git status`: all 12 are `D`. `page-redesign.tsx` had no importer |
| No importer or caller remains for a deleted route, page, module or export | ✅ | Pass | Grep over the whole worktree (not `node_modules`, `.next` or other worktrees), tracked and untracked. Every hit is classified below. No import or call remains |
| `ExecutionRepository` requires a client; no singleton and no browser import | ✅ | Pass | All 6 `new ExecutionRepository(...)` calls pass a client. There is no `findByAgentId` `userId` option. Guard (a) is green |
| `lib/repositories/index.ts` exports neither the singleton nor `SharedAgentRepository` | ✅ | Pass | |
| `/v2/agents/[id]`: no Share action and no credit promise; run, edit, schedule, toggle, duplicate and delete still wired | ✅ | Pass (code read) | Nothing matches `share`, `reward` or `sharing`. `handleRunNow`, `handleEditClick`, `handleEditScheduleClick`, `handleToggleStatus`, `handleToggleInsights`, `handleDuplicateAgent` and `handleDeleteAgent` are all bound. The `Promise.all` destructure stays aligned (9 calls, 9 names), and only `tokens_per_pilot_credit` is requested |
| Legacy sidebar renders without Templates | ✅ | Pass (code read) | The link, count, state, ref, abort and `Workflow` icon are gone, and both effect dependency arrays are updated. The 7 remaining `SidebarLink`s are intact |
| Footer menu works without Templates | ✅ | Pass (code read) | Agent List and Create Agent are intact. The `createLogger` client pattern matches `components/business-os/Boost*.tsx` |
| Help bot: the Templates line is gone; response shapes and auth order are unchanged | ✅ | Pass (code read) | `getUser()` still comes first (401), then the 400s, then 200 `{ response, source }` × 5, then 500 `{ error }`. No `NextResponse` line is in the diff. The `correlationId` is derived before `try`, and every helper gets `requestLogger`. `crypto` comes from `import crypto from 'crypto'` |
| C-7 guard: (a), (c) (incl. CR-4 metrics, CR-5 `/templates`), mutation self-tests | ✅ | Pass | Guard passes. Its self-tests cover the cap and dating via `allowListViolations` |
| R-11 logging conversion of the 3 files | ✅ | Pass | No `console.*` in the help-bot route (pinned by `logging.guard.test.ts`). Lint shows no new warnings (below) |
| Three RC9-7 tests updated | ✅ | Pass | 3 suites, 62 tests |
| Docs (CR-2, CR-3) | ✅ | Pass (read) | `REPOSITORY_STRATEGY.md` drops the repository, client APIs, routes and singleton, and adds a Change History row. The help-bot doc marks `/v2/templates` as removed |
| Entitlements registration | ✅ | N/A | The diff imports nothing from `lib/business-os/entitlements/` |
| Prod: 404s, no Share, OS-1 hides the legacy Share (T1-8) | ⬜ | Not run | Needs the deploy. Stays T1-8 |

**Grep hits, classified.** Patterns: `/api/shared-agents`, `/api/agents/import-shared`, `/api/agents/[id]/metrics`, `/v2/templates`, `(protected)/templates`, `sharedAgentApi`, `metricsApi`, `SharedAgentRepository`, `executionRepository` imports, `components/v2/templates`.

| Hit | Class |
|---|---|
| `executionRepository` in `app/api/agents/[id]/executions/route.ts`, `app/api/run-agent/route.ts`, `app/api/user/data-export/route.ts` | Local variable built with an explicit client. Not an import of the singleton |
| `app/v2/agents/[id]/page.tsx.backup-20260202-193944`, `page.tsx.backup-before-redesign` (`sharedAgentApi`, `metricsApi`) | Non-compiled file. The extension is not `.tsx`, and it is not routed |
| `supabase/SQL Scripts/20250129_helpbot_page_contexts.sql` (`/v2/templates`) | Non-compiled historical seed (FU-14) |
| `lib/repositories/__tests__/anon-default-repositories.guard.test.ts` | Comment, or mutation self-test input |
| `docs/**` (2c, 1b and slice-2 workplans, help-bot doc) | Doc |
| `/api/business-os/metrics/summary`, `lib/business-os/insight/metrics`, `components/v2/metrics` | False positive: an unrelated `metrics` path |
| `app/(protected)/agents/[id]/page.tsx`, its `.backup-20251101` twin, `/api/rewards/agent-sharing`, `cron/update-template-scores`, `lib/credits/*` (`shared_agents`, `agent_sharing`) | Intentionally kept (FU-12). Not a removed path |
| **Import or call of a removed module, export, route or page** | **None (0)** |

#### Issues Found

##### Bugs (must fix before commit)

None.

##### Performance Issues (should fix)

None.

##### Edge Cases (nice to fix)

1. **The legacy `/agents/[id]` Share button stays live until OS-1 or 2c-2.** This is known and accepted (R-2, R-4). The user still owes OS-1.
2. **Help-bot DB content.** FU-14 is closed for the prompt: `helpbot_general_prompt` is not set in prod `system_settings_config`, so the route uses the edited fallback prompt. The seeded `/v2/templates` page-context row may remain. It is harmless (FU-14 note).
3. **PR hygiene (for RM).** This worktree also holds the untracked 2c-2 SQL files and `rls-disabled-agent-tables-slice2c.migration.test.ts`, which is red mid-work (8 of 71 failing). The 2c-1 PR must not pick them up.

#### Test Outputs / Logs

| Run | Result |
|---|---|
| `anon-default-repositories.guard.test.ts` + `app/api/help-bot-v2/**` (incl. new `logging.guard.test.ts`), re-run after the CR edits | 4 suites, 52 tests, all pass |
| 3 edited RC9-7 tests | 3 suites, 62 tests, all pass |
| `lib/repositories/__tests__`, `lib/admin/__tests__/admin-authz-surface.guard.test.ts`, `supabase/__tests__`, `supabase/migrations/__tests__`, `app/v2`, `components/v2`, `app/api/help-bot-v2` | **135 suites, 4361 tests pass.** One more suite, the out-of-scope 2c-2 test (`rls-disabled-agent-tables-slice2c.migration.test.ts`), has 8 of 71 failing on the in-progress 2c-2 SQL |
| eslint, touched files (base → now) | 0 errors everywhere. Warnings: layout 14 → 13, v2 page 95 → 89, footer 18 → 18, help-bot 11 → 11; the rest 0 → 0 |
| `lint:hooks` | exit 0 |
| Full-project `tsc --noEmit` (`--typeRoots` pointed at the parent `node_modules/@types`) | 1863 errors, all pre-existing. Not one is on a changed line of the page or the help-bot route; those are message-first `clientLogger` calls and the prompt typing. There is no TS2307 or TS2305 for any deleted module and no constructor-arity error for `ExecutionRepository`. The `run-agent` errors (`create` and `findRunningByAgentId` missing on `ExecutionRepository`) were already on base `49b66feb` (FU-1) |
| `next build` | **Not run.** `next.config.js` has `ignoreBuildErrors: true` and no `typedRoutes`, so a build could not fail on a dead typed route or link. A missing import would surface as a module-not-found, and the full `tsc` already rules that out. Building would also write `.next` into a shared worktree that has no local `node_modules`. CI's Build check covers it on the PR |

#### Final Status

- [x] All acceptance criteria testable before deploy pass. **Ready for user diff review, then RM.** T1-8 (prod) stays open
- [ ] Issues found: Dev must address before commit

### QA: slice 2c-2

**QA, 2026-10-14**
**Test mode:** full
**Strategy used:**
- **C:** an independent PGlite dry run. QA wrote its own fixture script; Dev's fixture and results were not reused.
- **A:** the Jest static test and the guards.
- A static paste-rule scan by QA.

**Focus:** schema, security
**Skipped:** nothing was run against production or any remote database. Steps 8–10 of SA's apply procedure (advisors, 24 h log watch, apply record) can only happen on production and stay with TL.
**Input source:** prompt from TL. The spec is the [re-scope](#re-scope-after-the-users-decisions-2026-10-14), [2c-2 as written](#2c-2-as-written) and [SA's 2c-2 code review](#code-review-by-sa-2c-2-sql-2026-10-14), including its binding apply procedure.
**Covers:** these files as they stand, uncommitted, after CR2-1 and CR2-2:
- the D-0b pair
- the pre-check
- the migration `20261062`
- the checker
- the rollback
- `rls-disabled-agent-tables-slice2c.migration.test.ts`

No SQL or code file was edited.

#### Dry run setup

- **Engine:** PGlite 0.5.8, which is PostgreSQL 18.3, in memory. Scratchpad `qa2c2/qa-dryrun.mjs`.
- **Fixture (QA's own):**
  - Uuids and users are not Dev's.
  - The `auth.uid()` is Supabase-style.
  - `agents` carries the three F6 policies.
  - The six tables use the F1 columns and the F2 checks.
  - Both `increment_agent_stats` overloads, `update_agent_schedule_safe` (cancels queued and pending runs, swallows errors), the invoker import trigger, the routing-decisions table with both policies, and the 1b view.
  - `GRANT ALL` to the three roles, then the real `20261060`.
- **Data:**
  - 3 configuration mismatches: 3 agents, 2 row users, 2 owners.
  - 11 execution mismatches: 7 + 4 rows on 2 agents.
  - 1 `agent_stats` mismatch, plus clean rows, queued and pending runs, and routing decisions.
- **Pins:**
  - The fixture pins were computed with the **capture's** formula (`','`, default collation), not the scripts' `chr(44)` + `COLLATE "C"`. The scripts reproduced them, which confirms ruling 3.
  - In PGlite, the `agents` and routing-policy qual md5s are equal to prod (`19300d15…`, `97a65517…`). Only the three data pins were substituted.
- **Fill values:** taken from the pre-check's `Q13 D0b fill values` row, as TL will do, never from the fixture constants.

#### Test Coverage

| Acceptance criterion / SA apply step | Tested? | Result | Notes |
|---|---|---|---|
| 1. Pre-check #1 → `STOP 1`; the only STOP row is Q13 `agent_stats` "run D0b first"; configurations 3 and executions 11 equal the pin; fill values hold exactly one entry ending `is the D0a agent` | ✅ | Pass | 99 rows: the status row, the one STOP row and 97 others. The printed hex values are the right agent, old user and owner |
| 2–3. D-0b refusals | ✅ | Pass | Every refusal below says "nothing was applied", and the row is untouched afterwards:<br>• unfilled<br>• uppercase hex<br>• hyphenated uuids<br>• a different agent (not the D-0a pin)<br>• old user and owner swapped (0 rows)<br>• a new owner who does not own the agent (0 rows)<br>• old user = new owner |
| 3. D-0b filled | ✅ | Pass | 0 `FILL_` remain after filling. It applies. The final row reads `D0b done`, `row user is the agent owner`, `after_user_hex` = the new owner. The counters are unchanged. A re-run refuses |
| 4. Pre-check #2 → `CLEAN run the migration in a NEW tab` | ✅ | Pass | Q13 `agent_stats` reads `0 rows md5 none … equals the pin ok`. The fill values row reads "none". Q4/Q5 show authenticated with exactly the four privileges, granted by postgres |
| 5. Migration | ✅ | Pass | It applies. A re-run refuses ("row security is already on") |
| 6. Checker → `VERDICT PASS 66 pass 0 fail` | ✅ | Pass | C10 prints 12 md5s. **Ruling 6 sanity check holds:** the 8 SELECT/UPDATE quals are identical, and each table's INSERT check equals its UPDATE check |
| 7. P-1 anon SELECT on the six | ✅ | Pass | 42501 × 6 |
| P-2 owner count = service count | ✅ | Pass | 7 = 7 |
| P-3 INSERT on a foreign agent | ✅ | Pass | RLS violation. Control: an INSERT on the user's own agent succeeds |
| P-4 `increment_agent_stats` (both calls in one ROLLBACK block) | ✅ | Pass | Own agent passes on both the update and the insert path. A foreign agent gives an RLS violation |
| P-5 (SA revision) `DELETE FROM public.agent_logs WHERE id IS NULL` | ✅ | Pass | 42501. **No TRUNCATE probe was run** |
| P-6 SELECT `shared_agents` | ✅ | Pass | 42501 |
| P-7 routing decisions count before = after | ✅ | Pass | 7 = 7 for a normal user. 9 = 9 for the S-1 row user |
| P-8 INSERT `shared_agent_imports` | ✅ | Pass | 42501 |
| P-9 UPDATE own `agent_logs` | ✅ | Pass | 1 row |
| P-10 UPDATE `shared_agents` | ✅ | Pass | 42501 |
| P-11 D-0b agent owner calls `increment_agent_stats` (in ROLLBACK) | ✅ | Pass | It succeeds, and the real counter is not bumped |
| P-12 S-1 exception | ✅ | Pass | The old row user reads 7 of 7. The agent owner reads 0. The old user's UPDATE is refused by C-4 |
| Extra probes | ✅ | Pass | • **Other users:** another user sees 0 rows and updates 0 rows on all four tables.<br>• **DELETE:** gives 42501 on all four tables.<br>• **Re-pointing:** re-pointing `agent_id` and re-owning `user_id` are both refused.<br>• **`update_agent_schedule_safe`:** the owner cancels their own 2 queued and pending runs.<br>• **1b view:** still 42501.<br>• **service_role:** SELECT on all six works, and so does DELETE. An import fires the unchanged trigger (`import_count` 1).<br>• **Triggers and functions:** body md5, SECDEF, ACL and enabled state are identical after the migration and after the rollback |
| Rollback | ✅ | Pass | • It applies. A re-run refuses ("already off").<br>• The pre-check afterwards is **byte-identical** to pre-check #2.<br>• anon is still 42501 on all six.<br>• Signed-in users see every row again (the stopgap state) |
| D-0b reverse | ✅ | Pass | • Unfilled, it refuses.<br>• Filled, it applies. The row is back on the old user and reads `row user differs from the agent owner`.<br>• A re-run refuses.<br>• The pre-check is back to `STOP 1`, with the same fill values.<br>• The migration then refuses ("owner mismatch count differs … agent_stats") |
| Static paste rules, all six SQL files | ✅ | Pass | 0 "into" (case-insensitive), 0 `--`, 0 `/*`, 0 FORCE, 0 SECURITY DEFINER, 0 hyphenated uuids. Quote counts are even. Literals are only `[A-Za-z0-9_ ]`. Every `string_agg` has `COLLATE "C"`. LF line endings |
| No CASE inside an IF | ✅ | Pass | The scanner was self-tested on a positive case, and it skips `END IF`. Conditions found: D-0b 7 + 7, migration 36, rollback 15. None contains `CASE`. The pre-check and checker have no DO block |
| Committed D-0b holds only placeholders | ✅ | Pass | **Forward** `FILL_AGENT_ID` 2, `FILL_OLD_USER_ID` 2, `FILL_NEW_OWNER_ID` 1.<br>**Reverse** 2 / 1 / 2.<br>The only 32-hex literal is the D-0a md5 pin `2a4cf06b…`. The CR2-1 test and its four mutation self-tests are present and green |
| Entitlements registration | ✅ | N/A | The SQL diff imports nothing |

**QA drift cases, none of which Dev ran.** Each starts from a fresh database in the post-D-0b state. Each must:
- make the pre-check STOP, with only the expected row(s)
- make the migration refuse with "nothing was applied"
- leave 0 tables with RLS on and 0 policies

| # | Drift | Pre-check | Migration |
|---|---|---|---|
| D-1 | `service_role` lost DELETE on `agent_stats` | STOP 1 (Q4 service_role) | refused: "service_role lacks DELETE" |
| D-2 | A sequence OWNED BY an `agent_logs` column | STOP 1 (Q7) | refused: "an owned sequence exists" |
| D-3 | DELETE granted to `authenticated` by **another grantor** (service_role WITH GRANT OPTION) | STOP 1 (Q5 "OTHER GRANTOR") | refused by the **post-assert** ("authenticated still holds DELETE"). The postgres REVOKE cannot remove another grantor's grant. The pre-guard does not check grantors, but the transaction rolls back (see Edge Cases) |
| D-4 | A new `agent_executions` row with NULL `user_id` | STOP 1 (Q13 executions) | refused: "count differs from the pin" |
| D-5 | A `shared_agent_imports` row whose created agent is NULL | STOP 1 (Q13 imports) | refused: "a row has no agent or no user" |
| D-6 | A `shared_agents` row whose user is not the agent owner | STOP 1 (Q13 shared_agents) | refused |
| D-7 | RLS already on one table (a half-applied earlier attempt) | STOP | refused: "already on". Only the drifted table has RLS on |
| D-8 | An `agents` policy with the same name but a wider qual (`true`) | STOP 1 (Q12) | refused: "agents read policy differs" |
| D-9 | A second `agent_stats` mismatch before D-0b | STOP. The fill values list both, one marked `is NOT the D0a agent` | D-0b refuses ("mismatch count is not 1 before"), and the row is untouched |
| D-10 | After the migration, one policy dropped by hand, then the rollback | — | The rollback refuses ("policy count is not the migrated one … agent_logs"). Nothing changes |
| D-11 | After the migration, authenticated given DELETE on `agent_logs`, and FORCE turned on for `shared_agents` | — | The checker gives `FAIL 64 pass 2 fail` (C7 `agent_logs`, C4 `shared_agents`) |
| D-12 | D-0b pasted into the pre-check's tab (`default_transaction_read_only` still on) | — | It fails closed: "cannot execute UPDATE in a read-only transaction". This confirms SA's new-tab rule |

#### Issues Found

##### Bugs (must fix before commit)

None.

##### Performance Issues (should fix)

None.

##### Edge Cases (nice to fix)

1. **The migration pre-guard does not check grantors.** Pre-check Q5 does. In D-3, the post-assert caught the leftover privilege and rolled everything back, so the migration fails closed. Only the error message is less direct than Q5's. Not a defect. TL already runs pre-check #2 first, and it STOPs on this.
2. **The policy md5s are PGlite-deparsed.** The 12 C10 md5s above are not the prod values (ruling 6). TL records the prod values from the real checker run.

#### Test Outputs / Logs

| Run | Result |
|---|---|
| QA PGlite dry run (`qa2c2/qa-dryrun.mjs`) | **100 assertions, 0 failed.** The full apply procedure ran: pre-check #1, D-0b refusals and apply, pre-check #2, migration, checker, P-1..P-12 plus the extras, rollback, D-0b reverse. Then 12 QA drift cases. **Interim run (fixture defect, not a product one):** 3 drift cases failed because the execution ids used `gen_random_uuid()`, so every fresh database had a different pin. Fixed with deterministic ids. On the re-run, each drift case's pre-check STOP rows are exactly the expected ones |
| Fixture C10 md5s (PGlite) | qual `ff452c76…` × 8. Check: configurations `a30304b6…`, executions `9680e2a8…`, logs `ebf08590…`, stats `5a22604b…`, each × 2 |
| `rls-disabled-agent-tables-slice2c.migration.test.ts` | 1 suite, **77 tests pass** |
| `supabase/migrations/__tests__` + `supabase/__tests__` (incl. the SECDEF surface guard) | **39 suites, 2064 tests pass** |

#### Final Status

- [x] All acceptance criteria testable before apply pass. **Ready for user diff review, then RM.** The apply itself (SA procedure steps 1–10 on production) needs the user's explicit authorization and stays with TL
- [ ] Issues found: Dev must address before commit

---

## Commit Info

_RM populates this section._

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-14 | Created | Workplan only, no code or SQL. Base `origin/main` @ `49b66feb` (PR #360 merged). The starting state is pinned to the post-stopgap state from TL's brief. Migration number `20261061`, verified free on `origin/main`, every ref and every worktree. Full code-path census of the six tables: anon-on-server (3 routes), browser, cookie, service role, admin, crons, pilot, V6 and agent creation. Database-side caller audit. Correction: `aggregate_execution_model_usage` now runs as the service role. Found that `existsByOriginalAgent` returns a boolean that the routes destructure, so the duplicate-share check never fires. Slices 2c-0 (TL captures F1–F8), 2c-1 (route fixes, repository defaults, C-7 guard), 2c-2 (RLS + owner policies with the C-4 agent check + least-privilege grants + definer-rights import counter, with pre-check, checker, rollback to the post-stopgap state, static test, PGlite dry run and probes P-1..P-10). Recommended option T-1 for the counter, which supersedes parent ruling 2. Open questions Q-2C-1..8; business questions BQ-1..3 |
| 2026-10-14 | SA workplan review | **APPROVED WITH CHANGES** (S-1..S-14). **F5 ruling:** the 11 `agent_executions` and 3 `agent_configurations` mismatch rows stay as a documented exception, pinned by id-set md5. Re-owning would disclose one tenant's run data to another and falsify usage evidence; deleting cannot be undone and cascades. The 1 `agent_stats` row is re-owned to the agent owner through user-pasted D-0b, if the user approves BQ-4, because otherwise the owner's stats updates fail under ON CONFLICT. New D-0a read-only capture. F3 `prosrc` capture required before any SQL; F8 contradicts the `update_agent_schedule_safe` census row. T-1 approved (passes the SECDEF guard), with conditions. Anon EXECUTE revoke (FU-6) and F7 indexes (FU-9) are out of 2c-2. `existsByOriginalAgent` fix in 2c-1 (`.limit(1)`); FU-1 and BQ-3 stay follow-ups (FU-1 now notes the body `user_id` in the run-agent queue path). WC-7 flush on `AGENT_SHARED`. New FU-8 (the imports FK SET NULL on a NOT NULL column blocks account deletion), FU-9, FU-10, FU-11. New BQ-4 |
| 2026-10-14 | SA re-scope after the user's decisions | **User answers:** BQ-1 signed-in only; **BQ-2 switch sharing off**; BQ-3 remove the bonus promise; BQ-4 yes (D-0b). **2c-1 becomes "switch sharing off"** (R-1..R-3). It deletes the share POST, `/exists`, `/api/agents/import-shared`, both gallery pages, `components/v2/templates`, the dead `page-redesign.tsx` and `SharedAgentRepository`. It also deletes `/api/agents/[id]/metrics`, whose only caller was the Share flow. It removes the Share UI and its credit promise from `/v2/agents/[id]` and the Templates entry points from the sidebar, footer and help bot. No feature flag and no 410 handlers. **OS-1:** the user deactivates the `agent_sharing` reward in the admin UI, which hides the legacy page's Share button. **2c-2:** the two sharing tables get RLS on, no client grants and no policies (service role only). T-1 is dropped and the trigger is untouched; parent ruling 2 stands. 12 policies instead of 16; no SECURITY DEFINER; P-6/P-8 expect 42501, P-8b dropped. The apply is no longer gated on 2c-1 being live (R-4). C-4 on the four agent tables, the S-4 pin stop rule and D-0b are kept. `ExecutionRepository` singleton removal kept, its `userId` option reverted; C-7 guard keeps (a), drops (b) and adds a dead-link check (c). `update_agent_schedule_safe` census rows corrected. Superseded: D-4, D-5, S-6, S-7, S-9..S-12, Q-2C-1/5/6/7, the old 2c-1 section. FU-2, FU-4 and FU-10 closed; FU-3 and FU-8 changed; new FU-12 (retire dormant sharing code) and FU-13 (`update_agent_schedule_safe` swallows errors). Dev stop/revert list recorded |
| 2026-10-14 | Dev: 2c-1 implemented (uncommitted) | Sharing switched off as re-scoped: 12 files deleted, 7 modified by deletion, C-7 guard (a)+(c), three RC9-7 tests updated for the removed v2 reward path. R-11 logging conversion of the three touched files as a separable change. Suites green; no new type errors in the touched set. See [Dev implementation notes](#dev-implementation-notes-2c-1) |
| 2026-10-14 | SA code review: 2c-1 | **APPROVED WITH CHANGES.** No live link or caller remains to any deleted route or page. No runtime-500 leftovers. The `/v2/agents/[id]` cut is clean. Guard (c) is sound. The three test edits, the extra import removals and the `refreshTemplateCount` removal are all accepted. The logging conversion is correct, and the two-commit split is clean (RM procedure recorded). **CR-1 (required):** the help-bot API route must attach a correlationId via `logger.child`, threaded to the helpers it calls, with a source pin. **CR-2:** update `docs/REPOSITORY_STRATEGY.md` for the deleted repository, client APIs, routes and singleton. CR-3..CR-6 Low. New FU-14 (help-bot DB content) and FU-15 (help-bot route standards) |
| 2026-10-14 | Dev: 2c-2 SQL written (uncommitted) | Migration takes `20261062` (`20261061` is held by an untracked file in another worktree). D-0b pair, pre-check, migration (12 policies, sharing tables locked, never FORCE, no SECURITY DEFINER), checker (66 checks), rollback to the post-stopgap state, static test. PGlite dry run passed end to end. See [2c-2 as written](#2c-2-as-written) |
| 2026-10-14 | QA: 2c-1 | **PASS, 0 bugs.** Static grep: no import or call of any removed route, page, module or export (hits are backups, docs, a 2025 seed, local variables and FU-12 keepers). Jest 135 suites, 4361 tests green (the in-progress 2c-2 suite excluded). eslint: 0 errors, no file gained warnings. `lint:hooks` clean. Full `tsc`: no new error. Code read of the v2 page, sidebar, footer and help-bot auth order and response shapes. `next build` not run (`ignoreBuildErrors`, no `typedRoutes`, so CI Build covers it). T1-8 still owed on prod. See [QA Testing Report](#qa-testing-report) |
| 2026-10-14 | SA code review: 2c-2 SQL | **APPROVED WITH CHANGES.** C-4 INSERT/UPDATE (including re-pointing), no live client DELETE on the four tables (the only hits are service role), `increment_agent_stats` ON CONFLICT for the owner after D-0b, `update_agent_schedule_safe`, the routing-decisions policy, the exact-inverse rollback, paste rules, no FORCE and no SECURITY DEFINER, `lock_timeout` and single transaction, and the CASE-in-IF fix are all verified. Rulings: `20261062`; placeholders upheld (fill at paste time, never commit ids); comma via `chr(44)` + `COLLATE "C"`; `owned_agent`; extra pins kept; policy md5s recorded at apply (FU-16); sharing tables stay in the S-4 pin. **CR2-1** (Medium): the static test must require the placeholders. **CR2-2** (Low): stale `20261061` text. **CR2-3** (procedure): pre-check #1 before D-0b, fill values saved outside the repo, no live TRUNCATE probe on prod. Apply procedure recorded. See [Code Review by SA: 2c-2 SQL](#code-review-by-sa-2c-2-sql-2026-10-14) |
| 2026-10-14 | Dev: CR2-1, CR2-2 | **CR2-1:** the D-0b static test requires exactly the `FILL_*` placeholders (5 per file) and rejects any other 32-hex literal, with mutation self-tests. **CR2-2:** live `20261061` references now say `20261062` (header, slice table, ToC and heading, slice-list row 4, Migration number, Files, T2-2); T2-12 and [2c-2 as written](#2c-2-as-written) point at SA's apply procedure (CR2-3). No SQL changed |
| 2026-10-14 | QA: 2c-2 | **PASS, 0 bugs.** QA wrote its own PGlite dry run (PG 18.3) and followed SA's apply procedure: pre-check #1 STOP 1, D-0b (7 refusals, then applied), pre-check #2 CLEAN, migration, checker PASS 66/0, P-1..P-12 with P-5 as the `WHERE id IS NULL` DELETE and no TRUNCATE, rollback (a byte-identical round trip), D-0b reverse. 100 assertions, 0 failed. 12 drift cases of QA's own all fail closed. Static paste rules are clean on all six files, and the D-0b placeholders are 2/2/1 and 2/1/2. Jest: 2c-2 test 77 pass; `supabase/migrations/__tests__` + `supabase/__tests__` 39 suites, 2064 pass. See [QA: slice 2c-2](#qa-slice-2c-2) |
| 2026-10-15 | 2c-2 production apply recorded; status COMPLETE | 2c-1 (#369) and 2c-2 (#370) merged. TL applied `20261062` to production (`jgccgkyhpwirgknnceoh`) on 2026-10-14 at the user's explicit request, following SA's apply procedure: pre-check #1 `STOP 1` (only `agent_stats`), D-0b re-own (fill values kept outside the repo), pre-check #2 `CLEAN`, migration in one transaction, checker PASS 66/0, policy md5s recorded (FU-16), rolled-back probe block all as expected (no TRUNCATE probe), advisor clean of the two ERROR lints. T2-11 ticked. 24h log watch noted in the PR. See [2c-2 production apply record](#2c-2-production-apply-record-2026-10-14) |
