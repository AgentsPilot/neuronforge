# Workplan: Daily briefing stale-date guard (P1)

> **Last Updated**: 2026-10-04

**Developer:** Dev
**Branch:** `fix/briefing-stale-date-guard` (from origin/main `82cf7b14`)
**Requirement / ruling:** SA Workplan Review (2026-10-04) of `docs/workplans/ADMIN_BOS_CLEANUP_SLICE_7C_WORKPLAN.md` (on `feature/admin-queue-retry`), §B ruling on OP-1 and condition W7C-2 (a)–(k)
**Date:** 2026-10-04
**Status:** Code Complete (uncommitted; awaiting SA code review, QA, user diff review)

## Overview

A small standalone fix for an existing production defect: the morning briefing can be sent twice when the briefing cron does not run across a business's local midnight. This PR adds one send-time guard in the dispatcher. It does not depend on slice 7c, and 7c depends on it.

---

## The bug

| Where | What |
|---|---|
| `supabase/migrations/20260911_daily_briefing.sql:138-146` | `claim_due_daily_briefings` claims any `pending` row whose `next_attempt_at` is due. There is **no date predicate**. |
| `lib/services/DailyBriefingDispatchService.ts:74` (before) | `processDueBriefings` calls `dispatchOne(row.user_id, row.timezone, now)`. `row.briefing_date` is never read. |
| `lib/services/DailyBriefingDispatchService.ts:169` (before) | `dispatchOne` computes `businessDayFor(now, timezone)`, so it renders the day of the **run**, not the day of the **row**. |
| `lib/services/DailyBriefingDispatchService.ts:237` (before) | The email's `date` is that recomputed `day.date`. |
| `:147-148` | The 07:00–10:59 local window gates **enqueue only**. The cron runs `10 * * * *`. |

**Failure sequence.** A row for day D is enqueued about 10:10 local. The cron (or `CRON_SECRET`) is down until after local midnight. The first run on D+1 claims the D row and sends **D+1's** content. At 07:10 on D+1 the D+1 row is enqueued and sent too. The business gets D+1's briefing twice. A late admin retry (slice 7c) or a reaper re-pend that lands after midnight reaches the same path.

---

## The fix

In `processDueBriefings`, **inside the existing per-row `try`** (W7C-2(a)):

1. Compute the business day **once per row**: `businessDayFor(now, row.timezone)`. This uses the row's stored zone, the zone its `briefing_date` was written in, not the current `user_preferences` zone (W7C-2(d)). A zone change mid-day therefore cannot cause a false mismatch.
2. If `row.briefing_date !== day.date` (exact `'YYYY-MM-DD'` string compare, W7C-2(e)):
   - `markSkipped(row.id, 'stale_date')` (W7C-2(c));
   - `logger.warn({ rowId, userId, briefingDate, runDate }, …)` — ids and dates only, no email, no name, no content (W7C-2(b));
   - count it as `skipped` and `continue`. Facts, narration (AI spend), branding and email are never reached.
3. Otherwise call `dispatchOne(row.user_id, day)`. The **same** `BusinessDay` object is used for the check and the render, so the date that was checked is the date that is rendered.
4. `dispatchOne`'s `now` and `timezone` parameters are removed; nothing else in it used them (W7C-2(f)). It is not exported.

A future-dated row (clock skew, a hand-written row) is also skipped. That is fail-closed and intended (W7C-2(i)).

**Unchanged:** the claim RPC, the reaper, the lease, `MAX_ATTEMPTS`, `BATCH`, the enqueue window, the enqueue path, and the cron route. No migration: `skip_reason` is `TEXT` with no CHECK (SA confirmed live).

**`markSkipped` failure.** The repository logs and returns an error; it does not throw. The row stays `processing`, the reaper re-pends it, the next run's guard skips it again, and after `MAX_ATTEMPTS` it dead-letters. It is **never sent**. No new behaviour is added on that path; it matches how the existing `quiet_day` skip handles the same return value.

**Drain now** reaches the guard by construction: `runQueueDrain` maps `daily_briefing_sends` to `processDueBriefings()` (already pinned by `runQueueDrain.test.ts`). This replaces 7c's D-7 (W7C-2(g)).

**Correction carried from SA §A (W7C-2(h)).** No owner surface reads `daily_briefing_sends` (RLS on, no policy). A `stale_date` row appears only in the admin Jobs page count "Skipped, last 7 days (expected)".

**Behaviour change (user FYI).** During an outage that spans a business's midnight, yesterday's unsent briefing is now dropped instead of being sent late with today's content. Today's own briefing still goes out normally.

---

## Files

| File | Action | Reason |
|---|---|---|
| `lib/services/DailyBriefingDispatchService.ts` | modify | Stale-date guard; `dispatchOne(userId, day)` |
| `lib/services/__tests__/DailyBriefingDispatchService.staleDate.test.ts` | create | First direct test of `processDueBriefings` |
| `docs/workplans/BRIEFING_STALE_DATE_GUARD_WORKPLAN.md` | create | This workplan |

### Flagged, not changed in this PR

- **`console.*` in the touched file:** 0. Compliant.
- **CLAUDE.md rule 1:** the file makes **4 direct `supabaseServer.from(...)` calls** (`business_profiles` and `user_preferences`, twice each: in `enqueueDueBusinesses` and in `dispatchOne`). That breaks the repository rule. Per the brief it is **neither extended nor refactored** here; the guard adds no DB access. Candidate backlog item: route these through `BusinessProfileRepository` / `UserPreferencesRepository`.

---

## Tests

New suite `lib/services/__tests__/DailyBriefingDispatchService.staleDate.test.ts`. It mocks `supabaseServer` (the enqueue reads, the profile and preferences reads, `auth.admin.getUserById`), the send repository, `buildBriefingFacts`, `getBriefing`, branding, the email template and `sendEmail`. `businessDayFor` is the real module. `briefing_date` is fed as a `'YYYY-MM-DD'` string, the shape PostgREST returns for a `date` column.

| # | Case |
|---|---|
| T-1 | Same-day row: facts built with the checked `BusinessDay`, email rendered with that date, `markSent`; summary unchanged |
| T-2 | Stale row after local midnight: `markSkipped(id, 'stale_date')`; facts, AI, branding and email never called |
| T-3 | Asia/Jerusalem 23:59 (sends) vs 00:00 (skips) |
| T-4 | America/Los_Angeles: UTC date already D+1 while local is still D — sends (a UTC compare would wrongly skip) |
| T-5 | Asia/Kolkata (+05:30): at 18:29:59Z local is still D; at 18:30Z it is D+1 and the row skips |
| T-6 | Future-dated row: skipped `stale_date` |
| T-7 | `markSkipped` returns an error: nothing sent, `markSent` not called |
| T-8 | Warn log carries only `rowId, userId, briefingDate, runDate`; no email, name or content |
| T-9 | Mixed batch: one stale, one fresh — only the fresh one sends |
| T-10 | Source pin: `dispatchOne` no longer calls `businessDayFor` and has no `now` parameter |

**Mutation proofs (each must turn the suite red):** M-1 remove the guard; M-2 compare against `businessDayFor(now, 'UTC')`; M-3 let `dispatchOne` render with `businessDayFor(now, …)` instead of the passed day; M-4 compute the day from the current `user_preferences` zone instead of `row.timezone`.

**Regression:** briefing suites, `runQueueDrain.test.ts`, drain route tests, cron route tests (`runRecord.adoption`, `qa-slice5-pr2.baseCompare`, `vercelCrons`), `lib/business-os/llm`.

---

## Task List

- ✅ Step 1: Read the service, `businessDay`, the repository, the claim RPC and the SA ruling
- ✅ Step 2: Workplan
- ✅ Step 3: Guard + `dispatchOne(userId, day)`
- ✅ Step 4: New suite
- ✅ Step 5: Mutation proofs (scratch copies, file restored after each)
- ✅ Step 6: Regression suites, ESLint, `lint:hooks`, scoped tsc

---

## Risks and rollback

| Risk | Likelihood | Mitigation |
|---|---|---|
| A legitimate same-day row is skipped | Low | Check and render share one `BusinessDay` from the row's own zone; T-1/T-3/T-4/T-5 pin the boundaries. Enqueue writes `day.date` from the same function and zone, so a fresh row always matches |
| Row `timezone` invalid | Very low (enqueue writes only validated zones) | `businessDayFor` falls back to UTC — the same fallback the enqueue would have used |
| A run straddling midnight | Accepted | `now` is fixed once per run, so a row is checked and rendered for the same day |
| Yesterday's briefing dropped during an outage | Intended | See behaviour change above |

**Rollback:** revert this PR alone. It touches one service function and adds one test file; no migration, no RPC, no shared contract. Reverting restores the pre-existing double-send risk and nothing else. Note: slice 7c's briefing-retry dialog copy relies on this guard, so 7c must not be live without it.

---

## PR body draft

```markdown
## fix: daily briefing stale-date guard (fixes a production double send)

**This fixes an existing production bug.** When the daily-briefing cron is down across a business's local midnight, yesterday's still-pending briefing row is claimed after midnight and sent with *today's* content, and then today's own row is sent too. The business receives today's briefing twice.

Cause: `claim_due_daily_briefings` has no date predicate, and `DailyBriefingDispatchService` rendered `businessDayFor(now, …)` without ever reading `row.briefing_date`.

### Change
- `processDueBriefings` computes the business day once per row from the row's stored timezone, inside the per-row `try`.
- If `row.briefing_date` is not that day, the row is closed `skipped` / `stale_date`, a `warn` is logged (ids and dates only), and no facts, AI narration or email happen.
- Otherwise the same day object is passed to `dispatchOne`, so the checked date is the rendered date. `dispatchOne` no longer takes `now`.
- No change to the claim RPC, reaper, lease, enqueue or cron route. No migration (`skip_reason` is unconstrained TEXT).

### Behaviour change (FYI)
During an outage that spans a business's midnight, yesterday's unsent briefing is now dropped instead of being sent late with today's content. Today's own briefing still goes out.

### Tests
New `DailyBriefingDispatchService.staleDate.test.ts` — the first direct test of `processDueBriefings`: same-day send, stale skip, Jerusalem/Los Angeles/Kolkata midnight boundaries, future-dated row, `markSkipped` failure, PII-free warn, mixed batch. Mutation-proven.

### Rollback
Revert this PR alone. Slice 7c depends on it and must merge after.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

---

## SA Review Notes

### SA Review + QA (2026-10-04)

**Reviewed by SA — 2026-10-04** (one combined pass: workplan, code and QA, per TL brief)
**Status:** ✅ Approved (workplan and code). No code change required; three Low notes below, non-blocking.

#### Workplan review (retrospective — the workplan was not SA-reviewed before code)

Checked against the OP-1 ruling and W7C-2 (a)–(k) in `ADMIN_BOS_CLEANUP_SLICE_7C_WORKPLAN.md` § "SA Workplan Review (2026-10-04)", the `durable-queue-drain` skill and CLAUDE.md.

| Condition | Result | Evidence |
|---|---|---|
| (a) inside the per-row `try` | ✅ | `DailyBriefingDispatchService.ts:89-98`, inside the `try` opened at `:73` |
| (b) `warn`, ids and dates only | ✅ | `:93-96`; T-8 pins the exact key set |
| (c) literal `stale_date` | ✅ | `:91`; `skip_reason TEXT`, no CHECK (`20260911_daily_briefing.sql:105`) |
| (d) day from `row.timezone` | ✅ | `:89`; T-3b, proven by M4 |
| (e) exact `'YYYY-MM-DD'` compare, DB shape in tests | ✅ | `:90`; the claim RPC returns `SETOF daily_briefing_sends`, and a `date` column serialises as `'YYYY-MM-DD'`, which is what the suite feeds |
| (f) `dispatchOne(userId, day)` | ✅ | `:195`. `now` and `timezone` had no other use in the body (only `day.date` / `day.timezone` at `:262-263`). Not exported; the only call site is `:100` (the `LeadResponseDispatchService` `dispatchOne` is a different, module-private function) |
| (g) supabaseServer mocked; D-7 replaced | ✅ | Suite mocks `from` / `maybeSingle` / `auth.admin`; `runQueueDrain.ts:42` maps `daily_briefing_sends` → `processDueBriefings()` |
| (h) owner-card sentence corrected | ✅ | "The fix", Correction paragraph |
| (i) future-dated row skipped | ✅ | T-6 |
| (j) mutation proofs | ✅ | M1, M3, M4 are the three (j) names; M2 (UTC compare) is extra |
| (k) PR body wording + FYI | ✅ | PR body draft |

Skill fit: the guard is a Step 6 guardrail at the choke point. Claim, reaper, lease, enqueue and terminal-on-the-claimed-row (Step 5) are unchanged. Every path (cron, Drain now, a 7c retry) reaches it.

#### Code review

- **Diff scope vs `82cf7b14`:** one tracked file, +33/−8. `git diff 82cf7b14 --quiet` is clean for `supabase/`, `app/` (cron route included), `lib/repositories/`, `lib/business-os/` (BriefingStore narration attribution included) and `lib/admin/`. The claim, reaper, lease, `MAX_ATTEMPTS`, `BATCH`, enqueue and LLM attribution are untouched.
- **Same-day path:** byte-identical apart from where `day` is computed. It used to be `businessDayFor(now, timezone)` inside `dispatchOne`, called with `row.timezone`. Now it is the same call with the same arguments one frame up, still inside the `try`, so a throw from `businessDayFor` still lands in the same `catch`.
- **`markSkipped` failure:** the repository returns an error and never throws (`DailyBriefingSendRepository.ts:128-144`), so the row stays `processing`. The reaper (`20260911:157-186`) re-pends it with backoff while `attempts < 3`. Each claim increments `attempts`, the guard skips it again, and at `attempts >= 3` it is dead-lettered `failed`. That bounds it to 3 claims, and it is never sent. Same handling as the existing `quiet_day` return.
- **Rule 1:** the 4 direct `supabaseServer.from(` calls (`:132`, `:146`, `:209`, `:223`) are pre-existing and correctly flagged as backlog. The diff adds **zero** `.from(`. Not extended. ✅ TL should record the backlog item.
- **Logging:** 0 `console.*`; Pino `warn` with object-first context. ✅
- **Types:** a scoped `tsc` over the service and the new suite reports no errors in either file. The remaining errors are pre-existing, in transitive files such as `lib/analytics/aiAnalytics.ts`. ESLint is clean on both files.

| # | File:line | Finding | Priority |
|---|---|---|---|
| 1 | `DailyBriefingDispatchService.ts:92` | `summary.skipped` counts a stale row even when `markSkipped` failed. This matches the existing `quiet_day` path (`:106-107`) and is only a run-summary figure. No change | Low (note) |
| 2 | This workplan, Tests table | T-3b (row zone beats the current preference) is in the suite but not in the table, and the suite has 14 tests where the table lists 10 cases. Add a T-3b row when convenient | Low (doc) |
| 3 | This workplan, Risks | After a persistent `markSkipped` failure, a stale row ends as `failed` / "dead-letter: max attempts", not `skipped`. On the Jobs page it counts as a failure. That is acceptable and visible, but worth knowing when reading the page | Low (note) |

#### Rulings on Dev deviations

1. **Workplan not reviewed before code:** accepted retroactively. It meets every W7C-2 condition (table above). This is not a precedent: send-path changes still get the workplan review first.
2. **`rowId` in the warn log:** **keep it.** It is an opaque UUID, not PII. It ties the log line to the exact ledger row (and the 7c admin item) without a DB lookup. W7C-2(b) set a floor of ids and dates, not a closed set. T-8 pins exactly these four keys, so a fifth (PII) key would go red.
3. **No dedicated midnight-straddle test:** **the identity pin is enough.** `now` is bound once per run (`:55`) and passed down. The check and the render share one object: T-1 `toBe` on the `BusinessDay` instance, plus the T-10 source pin. I proved this with my own M3, where `dispatchOne` recomputes a same-date day: T-1 and T-10 both go red. A run that crosses midnight therefore renders the date it checked. That is the old behaviour for that row, and it is not a double send.
4. **Mutation M4 added:** accepted. Note that M4 (the `user_preferences` zone) is one of the three mutations (j) required. The genuinely extra one is M2 (the UTC compare). Both are welcome.

**Code Approved for QA: Yes.**

## QA Testing Report

**QA by SA (combined pass) — 2026-10-04.** Read-only, no DB access, nothing committed, no stash.

| Run | Result |
|---|---|
| New suite `DailyBriefingDispatchService.staleDate.test.ts` | **14 / 14 pass** |
| Regression: new suite + `lib/business-os/briefing` + `lib/business-os/llm` + `lib/admin/jobs` + `app/api/admin/jobs-queues/drain` + `app/api/cron` + `lib/cron` | **51 suites / 1,488 tests, all pass** |
| ESLint (both files) | clean |

**Coverage checked:** Jerusalem 23:59:59.999 sends and 00:00 skips (the UTC date is still D). Los Angeles sends when the UTC date has already moved to D+1, and skips after its own midnight. Kolkata sends at 18:29:59Z and skips at 18:30Z (the half-hour zone). T-3b: the row zone wins over a changed preference. Future-dated row skipped. `markSkipped` failure: nothing sent, `markFailed` not forced. Warn keys exactly `rowId, userId, briefingDate, runDate`, with no `@`, name or content. Mixed batch: only the fresh row is built, sent and `markSent`.

**Independent mutation proofs.** These are SA's own scratch copies under `scratchpad\saP1\`, run through a scratch Jest config that maps the module to the mutant. The worktree was never edited.

| Mutant | Change | Result |
|---|---|---|
| M0 (control) | unmodified copy | 14 / 14 pass (harness valid) |
| M1 | guard condition → `false` | **8 red** (T-2, 3 boundary skips, T-6, T-7, T-8, T-9) |
| M3 | `dispatchOne` recomputes a same-date `day` | **2 red** (T-1 identity, T-10 source pin) |
| M4 | day from current `user_preferences.timezone` | **1 red** (T-3b) |

**Verdict:** ✅ QA passed. The happy path and the failure paths are covered.

### User browser / ops checklist (after deploy)

This fix cannot really be exercised in a browser. Its trigger is a cron outage across a business's local midnight, and QA must not hand-edit queue rows. After deploy:

- [ ] **Normal mornings are unchanged:** your own test business still gets its briefing between 07:00 and 11:00 local, once.
- [ ] **Admin → Jobs, daily briefing queue:** in normal operation "Skipped, last 7 days (expected)" should hold only the usual quiet days. A rise right after a known cron outage (or an unset `CRON_SECRET`) that spanned midnight is this guard working: yesterday's rows closed `stale_date` instead of being double-sent.
- [ ] **Logs (Vercel):** the warn line `Briefing row is not for the business day; closed without sending` should **never** appear on a healthy day. If it appears, check whether the cron missed runs. It carries `rowId`, `userId`, `briefingDate` and `runDate` only.
- [ ] **No duplicate briefing emails** the morning after any outage. That double send is the bug this fixes.
- [ ] Rare: a stale row whose skip write itself failed shows as a dead-lettered `failed` row, not as skipped. It was still never sent.

## Commit Info

[RM will populate this section]

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-04 | Created | Dev: workplan + implementation of P1 per SA ruling OP-1 / W7C-2 |
| 2026-10-04 | SA Review + QA | Combined SA workplan/code review and QA: approved; 14/14 new tests, 51 suites / 1,488 tests green; independent mutations M1/M3/M4 red, control green; deviation rulings; post-deploy ops checklist |
