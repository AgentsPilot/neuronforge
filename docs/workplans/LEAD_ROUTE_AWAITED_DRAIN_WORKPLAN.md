# Workplan: Lead route waits for its drain (P2, BL-7a part 2)

> **Last Updated**: 2026-10-05

**Developer:** Dev
**Branch:** `fix/lead-route-awaited-drain` (from origin/main `f9448054`)
**Requirement:** SA ruling on OP-2, section C of the SA Workplan Review in `docs/workplans/ADMIN_BOS_CLEANUP_SLICE_7C_WORKPLAN.md` (on the 7c branch, draft PR #228); Q-SA7C-1
**Date:** 2026-10-05
**Status:** Code Complete (uncommitted)

## Overview

The owner's "Send now" on a queued lead reply now waits for the reply to be sent, with a 60 second cap. This closes the one claim path whose runner the 90 second lease could not prove dead. It is the P2 gate for slice 7c (#228).

---

## 1. Problem

`app/api/business-os/leads/[id]/route.ts` (92 lines on main), lines 80-82:

```ts
dispatchLeadResponses().catch(err =>
  requestLogger.warn({ err }, 'Immediate drain failed; the cron will pick it up')
);
```

- The drain is fire-and-forget, and the route has no `maxDuration`. On Vercel the instance can be frozen and resumed after the response, so the runner can outlive `LEASE_SECONDS = 90` (`lib/services/LeadResponseDispatchService.ts:51`).
- The reaper then dead-letters the row. If an admin retries it (slice 7c), the cron sends it, and the resumed runner sends it again from memory. The lead gets the reply twice.
- Every other caller is awaited under `maxDuration = 60`: `app/api/cron/lead-response/route.ts:22,58`, and `lib/admin/jobs/runQueueDrain.ts:43` behind `app/api/admin/jobs-queues/drain/route.ts:51`.

## 2. User decision

**Option A (2026-10-05):** the owner's "Send now" waits until the reply has actually been sent, capped at 60 s. The user approved this directly; Offir is told afterwards.

## 3. Fix

1. Route: `export const maxDuration = 60;`, with a comment tying it to `LEASE_SECONDS = 90`.
2. Route: `try { await dispatchLeadResponses({ batch: SEND_NOW_BATCH }); } catch (err) { requestLogger.warn({ err }, ...) }`. The response stays `{ success: true }` once `sendNow` has scheduled the row. A failed drain leaves the row `pending`, and the cron sends it within 5 minutes, as today.
3. Service: an optional `{ batch }` argument on `dispatchLeadResponses`. It is passed straight to `claimDue(runnerId, batch)`, which already hands it to `claim_due_lead_responses(p_runner, p_batch INT)`, so no RPC change. The default stays `BATCH = 25`. Values outside `1..25` fall back to 25, so no caller can widen a batch. The cron and Drain now still call it with no argument (W7D-5 S-1 holds). The route passes **5**.
4. Route comment block rewritten: awaited drain, the 60 s cap, and why (BL-7a, the double send under an admin retry).
5. UI (CR-P2-1, ruled in by SA): while "Send now" or "Cancel" is in flight, the queued strip in `NeedsYouCard.tsx` shows `gaps.working` ("Working…") in place of the two buttons, so there is feedback and no second click. It reads the `queued:<contactId>` key that `control()` already sets. No new i18n key; the strip's outer condition, `control()` and the refusal line are unchanged.
6. Service and route (CR-P2-2, ruled in by SA): `dispatchLeadResponses({ sweep })`, default true; only an explicit `false` skips `enqueueApprovedChases()`. The reaper always runs. The route passes `{ batch: 5, sweep: false }`: the cron sweeps every 5 minutes, and the sweep is every business's service-role work, not this owner's. The cron and Drain now still call with no argument, so they still sweep.

## 4. Files

| File | Action | Reason |
|------|--------|--------|
| `app/api/business-os/leads/[id]/route.ts` | modify | `maxDuration`, awaited drain with small batch and no sweep, comment |
| `lib/services/LeadResponseDispatchService.ts` | modify | optional `{ batch, sweep }`, defaults unchanged |
| `components/business-os/insight/NeedsYouCard.tsx` | modify | CR-P2-1: "Working…" in place of Send now · Cancel while queued request runs |
| `app/api/business-os/leads/[id]/__tests__/route.test.ts` | create | L-1..L-5, tenant scoping |
| `lib/services/__tests__/LeadResponseDispatchService.batch.test.ts` | create | default 25, custom batch, out-of-range fallback; sweep (i)-(iii) |
| `components/business-os/insight/__tests__/NeedsYouCard.queuedWorking.render.test.tsx` | create | CR-P2-1 (a)-(d) |
| `app/api/cron/__tests__/drainLeaseInvariant.guard.test.ts` | create | L-6 repo-wide guard |
| `docs/workplans/LEAD_ROUTE_AWAITED_DRAIN_WORKPLAN.md` | create | this file |

## 5. Tests

- **L-1** a held drain keeps the response pending; it resolves only after the drain does.
- **L-2** a rejected drain returns 200 `{ success: true }` and logs one `warn` with `{ err }`.
- **L-3** `cancel` (both outcomes) and `send_now` with `scheduled: false` never drain.
- **L-4** 401 with no user, 400 on an invalid body; no repository call, no drain.
- **L-5** source pin: `export const maxDuration = 60`, `await dispatchLeadResponses(`, no un-awaited call (comments stripped, read with `fs`).
- **L-6** the callers of the five drain functions under `app/` and `lib/` are exactly the five cron routes, `runQueueDrain.ts` and the lead route. Every route caller exports `maxDuration = 60` and awaits every call. The route that calls `runQueueDrain(` is held to the same rule.
- Tenant scoping: `cancelPending` / `sendNow` receive the session `user.id`, never a body field.
- Batch: the route passes `{ batch: 5, sweep: false }`; the service defaults to 25 and sweeps unless `sweep` is explicitly `false` (CR-P2-2, (i)-(iii)).
- UI (CR-P2-1): `NeedsYouCard.queuedWorking.render.test.tsx` (a)-(d).
- Mutation proofs on scratch copies (`scratchpad\devP2\`): remove `await`; remove `maxDuration`; drain on cancel.

## 6. Task list

- [x] ✅ Step 1: workplan
- [x] ✅ Step 2: service `{ batch }` argument
- [x] ✅ Step 3: route change and comment
- [x] ✅ Step 4: route tests L-1..L-5 and batch test
- [x] ✅ Step 5: L-6 guard
- [x] ✅ Step 6: mutation proofs, suites, lint, scoped tsc
- [x] ✅ Step 7 (CR-P2-1): queued strip shows "Working…" in place of Send now · Cancel; render test (a)-(d); mutation M9
- [x] ✅ Step 8 (CR-P2-2): `{ sweep: false }` on the send-now path; batch tests (i)-(iii), L-1 updated; mutations M10, M11

## 7. Risks

| Risk | Mitigation |
|------|-----------|
| The owner waits a few seconds after "Send now" | Batch 5 instead of 25. The user accepted the wait (Option A) |
| A slow drain hits the 60 s cap (504) | The row is already `pending` and due now. A killed runner is provably dead before the 90 s lease, so the reaper returns any claimed row and the cron sends it. Same end state as a failed drain, but the card shows the generic refusal. With the sweep skipped (CR-P2-2) the click is one reaper RPC plus at most 5 sends, so the cap is not a realistic outcome. While it waits, the card shows "Working…" (CR-P2-1) |
| The drain also runs the reaper and the cross-business chase sweep before claiming | Resolved by CR-P2-2: the click passes `sweep: false`, so only the reaper runs before the claim. The cron still sweeps every 5 minutes |
| The owner's own row is not in the claimed 5 when more than 5 older rows are due | The claim orders by `next_attempt_at NULLS FIRST, created_at`, so older due rows go first. The cron sends it within 5 minutes, which is today's outcome whenever the batch was full |

## 8. Open points for SA

- **OP-P2-1: the card does not show a working state for "Send now".** `NeedsYouCard.tsx:240-262` sets `rows['queued:<contactId>']` to `working`, but the queued strip renders on `state.kind === 'idle'` where `state = rows[rowKey(gap, item)]` (`:470-471`, `:590`), a different key. Only `refused` is ever read from the queued key (`:640`). So while the request is in flight the strip stays visible and both buttons stay enabled, with no indicator. This was true before P2, but the request was instant then. It is safe: a second "Send now" or a "Cancel" during the wait hits the pending-only guard and gets the honest "already sending" refusal, and the claim RPC is exclusive. Per the brief, no UI change is made. Proposed follow-up (UI short path): render the strip on the queued key too, and show `gaps.working` and disable both buttons while it is `working`. **SA ruled this INTO P2 (CR-P2-1); built: "Working…" replaces both buttons while the queued request runs.**
- **OP-P2-2: the owner's click also runs the reaper and `enqueueApprovedChases`.** **SA ruled this INTO P2 (CR-P2-2); built: the route passes `sweep: false`.** The sweep lists up to 200 approved businesses per sweeping automation (3 of them) and runs `findGaps` for each, before the claim. Batch 5 bounds the sending part but not the sweep, so the sweep is the likeliest cause of a long wait. A `{ sweep: false }` option on this path would be a small change (the cron already sweeps every 5 minutes).
- **OP-P2-3: there are no lead service, lead repository or lead cron route suites on main.** The brief listed them. I ran what exists (section 8b) and added the batch test.
- **OP-P2-4: L-6 also holds `runQueueDrain(`'s callers to the rule** (only `app/api/admin/jobs-queues/drain/route.ts`, `maxDuration = 60`, awaited). `runQueueDrain.ts` is not a route, so without this the rule would stop one level short. It overlaps W7D-5 S-5/S-6; SA may drop it.
- **Worst-case wait (not measured live; no DB access), after CR-P2-2.** One reaper RPC plus at most 5 sends (each a profile read, eligibility reads and one email). No sweep on the click. The 60 s cap is the hard bound. (Before CR-P2-2 the click also ran the sweep: up to 3 automations x 200 businesses x (`automationApplies` + `findGaps`).)

## 8a. Compliance notes

- `console.*`: 0 in the lead route, 0 in `LeadResponseDispatchService.ts`, 0 in `NeedsYouCard.tsx`, 0 in the three new test files.
- CLAUDE.md rule 1: the lead route has no direct `.from(` or `.rpc(`; it goes through `leadResponseRepository`. **`LeadResponseDispatchService.ts` is non-compliant (pre-existing):** 9 direct `supabaseServer.from(` reads (`business_profiles`, `scheduling_bookings`, `crm_activities`, `payment_invoices`, at lines 155, 207, 228, 285, 309, 327, 387, 425, 511). Flagged, not extended: P2 adds no query.
- Admin authz: the lead route is not an admin route; `npm run test:authz-guard` is unchanged at 119/119.

## 8b. Verification (Dev, 2026-10-05)

- New suites: 3 suites, 35 tests green (route L-1..L-5 + scoping + 500, 14; batch, 13; L-6 guard, 8 incl. 4 matcher self-checks).
- 7c's `leadRetry.p2Gate.test.ts` (copied read-only into a scratch tree with 7c's `retryHolds.ts`, hold `false`): **green** against this route.
- Related suites: 32 suites, 1,224 tests green (`app/api/business-os/leads`, the new service test, `app/api/cron/__tests__`, `lib/admin/jobs`, `app/api/admin/jobs-queues`, `lib/business-os/gaps`, `components/business-os/insight`, `lib/business-os/leads`, `InsightActionDispatchService`, `adminGate.writes`).
- Mutations, on a scratch copy of `app/` and `lib/` (`scratchpad\devP2\base`), worktree untouched; all killed:

| # | Mutation | Red |
|---|----------|-----|
| M1 | remove `await` | L-1 (held drain), L-5 await pin, L-6 route rule, 7c P2 gate; L-2 crashes the suite with an unhandled rejection |
| M2 | remove `maxDuration` | L-5 maxDuration pin, L-6 route rule, 7c P2 gate |
| M3 | drain on cancel | L-3 cancel |
| M4 | restore the old fire-and-forget `.catch` shape | L-1, L-5, L-6, 7c P2 gate |
| M5 | service ignores `batch` | batch test (1 and 5) |
| M6 | a new `lib/` caller of `dispatchLeadResponses` | L-6 caller set |

- ESLint on the 5 touched files: clean. `npm run lint:hooks`: clean.
- Scoped tsc (scratch tsconfig over the touched files): 0 errors in touched files; 64 pre-existing errors in untouched transitive imports. The full-project `tsc` runs out of memory locally.

## 8c. Verification of CR-P2-1 / CR-P2-2 (Dev, 2026-10-05)

- P2 suites + new UI suite: 4 suites, 42 tests green (route 14, batch 16, L-6 8, UI 4).
- Related, in the worktree: 72 suites, 1,595 tests green (`app/api/business-os/leads`, lead service, `app/api/cron`, `lib/admin/jobs`, `app/api/admin/jobs-queues`, `lib/business-os/gaps`, `components/business-os/insight`, `lib/business-os/insight`, `lib/business-os/leads`, `InsightActionDispatchService`, `adminGate.writes`).
- 7c `leadRetry.p2Gate.test.ts` (scratch tree `scratchpad\devP2\tree2`, 7c `retryHolds.ts`, hold `false`): 7/7 green.
- `npm run test:authz-guard`: 119/119.
- Mutations on `scratchpad\devP2\tree2`, each restored by copy and checked with `diff -q`:

| # | Mutation | Red |
|---|----------|-----|
| M9 | drop the `isQueuedWorking` branch (`false && isQueuedWorking`) | UI (a), and (b)-(d) |
| M10 | service ignores `sweep` (unconditional `enqueueApprovedChases()`) | batch (ii) |
| M11 | route drops `sweep: false` | route L-1 |

- `console.*`: 0 in `NeedsYouCard.tsx` and the new UI test. Hooks: `isQueuedWorking` is a plain value inside the `map` callback, no hook added; `npm run lint:hooks` clean.
- ESLint on the 7 touched files: clean.
- Scoped tsc (`scratchpad\devP2\tsconfig.scoped2.json`, adds `NeedsYouCard.tsx` and its test): 0 errors in touched files. 88 in untouched transitive imports: the 64 from 8b plus 24 in `lib/business-os/LanguageContext.tsx` (unmodified), which `NeedsYouCard.tsx` now pulls into the scoped program.
- Not verified: live wait time and the card in a browser (no DB access).

## 9. Rollback

Revert the PR. It stands alone: no migration, no RPC change. The one UI change (CR-P2-1) reverts with it, and the card goes back to showing no working state. After a revert the route is fire-and-forget again, and slice 7c's `leadRetry.p2Gate.test.ts` turns red, which correctly blocks lead retry.

## 10. PR body draft

```markdown
## fix: the lead route waits for its drain (BL-7a part 2, P2)

This is the **P2 gate for slice 7c (#228)**. 7c's `leadRetry.p2Gate.test.ts` is red until this merges and 7c is rebased on it.

### Why
`PATCH /api/business-os/leads/[id]` ("Send now") drained the lead queue fire-and-forget with no `maxDuration`. A frozen-and-resumed runner could outlive the 90 s lease. Once 7c lets an admin retry a dead-lettered lead reply, that runner and the cron could both send it, so the lead would get it twice.

### User decision (Q-SA7C-1, 2026-10-05)
Option A: "Send now" waits until the reply has actually gone, capped at 60 s.

### What changes
- `export const maxDuration = 60` on the lead route (below `LEASE_SECONDS = 90`).
- The drain is awaited inside try/catch. A failed drain is logged at warn, the response is still `{ success: true }`, and the cron sends it within 5 minutes.
- `dispatchLeadResponses({ batch, sweep })`: both optional; batch defaults to 25, sweep to true (cron and Drain now unchanged). The route passes `{ batch: 5, sweep: false }`: the click does not run the cross-business chase sweep, which the cron does every 5 minutes. The reaper always runs.
- Needs-you card: while "Send now" or "Cancel" on a queued reply is in flight, the strip shows "Working…" in place of both buttons, so the owner sees it is happening and cannot click twice.
- New L-6 guard: the five drain functions are called only by the five cron routes, `runQueueDrain.ts` and the lead route, and every route caller exports `maxDuration = 60` and awaits.

### Expected wait
One reaper RPC plus at most 5 sends; no chase sweep on the click. Typically a few seconds. The hard cap is 60 s.

### Not in this PR
BL-7a part 1 (`claimed_by` fence), BL-7c, the claim RPC (it is global: the click may claim other businesses' due rows first; future BA item).

### Rollback
Revert. No migration.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

## SA Review Notes

### SA Review + QA (2026-10-05)

**Reviewed by SA (combined code review and QA pass), 2026-10-05**, on `fix/lead-route-awaited-drain` @ base `f9448054`, uncommitted.
**Status:** 🔄 Fix Required (APPROVED WITH CHANGES). The server change is correct and matches §C of the 7c SA review. Before RM, two small additions are ruled **into** P2 (CR-P2-1, CR-P2-2) and the doc must be brought in line (CR-P2-3). After that, SA re-checks the delta and QA re-runs it. No other re-review is needed.

#### Verified claims

| Claim | Result | Evidence |
|---|---|---|
| `maxDuration = 60` | ✅ | `route.ts:34`, with the comment tying it to `LEASE_SECONDS = 90` (`:28-33`) |
| Drain awaited in try/catch, `warn` with `{ err }`, still `{ success: true }` | ✅ | `route.ts:106-112`. A thrown drain cannot reach the outer 500 path |
| `batch` feeds `claim_due_lead_responses(p_runner, p_batch)` unchanged | ✅ | `LeadResponseDispatchService.ts:88-95,111` → `LeadResponseRepository.ts:130-134`. A value outside 1..25 (0, -3, 26, 2.5, NaN, Infinity) falls back to 25 |
| Cron and `runQueueDrain` unchanged | ✅ | `app/api/cron/lead-response/route.ts:58` and `runQueueDrain.ts:43` still call with no argument, so they claim 25 (W7D-5 S-1 holds). Reap-then-enqueue-then-claim order is unchanged |
| Tenant scoping unchanged | ✅ | `cancelPending` / `sendNow` still take the session `user.id` (`route.ts:74,82`). The repository still has `.eq('user_id', userId)` and pending-only. A body `user_id` / `userId` is ignored (test) |
| L-6 guard is meaningful | ✅ | SA walked `app/` + `lib/` independently (2,614 files, comments stripped). The code call sites are exactly the 5 cron routes, `runQueueDrain.ts` and the lead route. The definitions are correctly excluded. One comment-only mention (`drainCounts.ts:47`) is correctly ignored. All route callers export `maxDuration = 60` and await. The only `runQueueDrain(` caller is `app/api/admin/jobs-queues/drain/route.ts:120` (awaited, `:51` = 60) |
| 7c `leadRetry.p2Gate.test.ts` passes against this route | ✅ | 7/7 green, with 7c's `retryHolds.ts` (`LEAD_RETRY_HELD = false as boolean`) in a scratch tree |
| `console.*` | ✅ | 0 in the route, the service, `NeedsYouCard.tsx` and the 3 new tests |
| ESLint on the 5 touched files | ✅ | clean (SA re-run) |
| Scoped tsc | ✅ | 0 errors in touched files; 64 pre-existing in untouched transitive imports (SA re-run, same count as Dev) |

#### Code Review Comments

1. **CR-P2-1. `components/business-os/insight/NeedsYouCard.tsx:240-262, :470-471, :590-613, :645`. "Send now" gives no feedback while it waits.** Priority: **Medium**. **Ruled INTO P2 (OP-P2-1).** The error is SA's own: §C item 4 of the 7c review said "the client already shows a working state". That is wrong. `control()` sets `queued:<contactId>` to `working`, but the strip renders from `rows[rowKey(gap, item)]`, and the `queued:` key is read only for `refused`. Before P2 the request was instant, so this did not matter. Now the owner waits seconds with both buttons live and nothing on screen. A UI defect introduced by the behaviour change ships with that change. The user was told "no UI change needed"; that statement is withdrawn. See the exact change under Rulings.
2. **CR-P2-2. `lib/services/LeadResponseDispatchService.ts:109` (via `route.ts:107`). The owner's click runs the cross-business chase sweep before claiming.** Priority: **Medium**. **Ruled INTO P2 (OP-P2-2).** See Rulings.
3. **CR-P2-3. This workplan, §3 item 5, §4, §7 rows 2-3, §8 OP-P2-1/OP-P2-2, §9 ("no UI change"), §10 PR body ("Not in this PR: any UI change", "Expected wait").** Priority: **Low**. These are stale once CR-P2-1/2 land. Update them so the PR body tells the user the truth: a UI change is included, and the click does not sweep.
4. **Informational, backlog (not P2): `claim_due_lead_responses` is global.** The owner's click claims up to 5 due rows of *any* business, and the owner's own row may not be among them (§7 row 4). This is pre-existing (the fire-and-forget drain did the same with 25). It exposes nothing to the caller: the response is `{ success: true }` only. Changing it is an RPC change, which §C item 5 keeps out of P2. If "Send now" should send *this* row first, that is a future BA item (claim by id).
5. **Informational: a 60 s kill returns a 504.** The client's `response.json()` then throws, and the card shows `gaps.refused.generic`, although the row is still due and the cron sends it. Accepted: once CR-P2-2 lands, the click is reap + at most 5 sends, so the cap is not a realistic outcome.
6. **Informational: under M1 (remove `await`) the route suite dies of an unhandled rejection** (L-2) rather than failing on L-1/L-5 assertions. It is still red, and L-6 and the 7c gate fail on assertions independently. No change.
7. **Rule 1 (CLAUDE.md): `LeadResponseDispatchService.ts` has 9 direct `supabaseServer.from(` reads** (lines 155, 207, 228, 285, 309, 327, 387, 425, 511; SA re-counted). **Confirmed as backlog only.** They are pre-existing, P2 adds no query (CR-P2-2 removes work rather than adding a query), and they are flagged in §8a. Not a P2 blocker. Track it with the repo-conformance sweep.

#### Rulings on the open points

**OP-P2-1: INCLUDED in P2 (CR-P2-1).** Exact minimal change, UI only, no new i18n key (`gaps.working` exists in en/es/he, `LanguageContext.tsx:394, 4386, 10437`):
- In the `gap.items.map` body (`NeedsYouCard.tsx:470-471`), add `const isQueuedWorking = rows[`queued:${item.contactId}`]?.kind === 'working';`.
- In the queued strip (`:598-613`), when `isQueuedWorking` is true, render `<span className="text-[11px] text-[var(--v2-text-muted)]" aria-live="polite">{t('gaps.working')}</span>` **in place of** the two-button `div`. Otherwise render the buttons exactly as today. This both shows "Working…" and removes both buttons, so no second click is possible. It is also correct for Cancel, which is why a label on the Send now button alone is not used.
- Do not change the strip's outer condition (`item.queued && state.kind === 'idle'`), `control()`, the `queued:` refusal line (`:645`), or any other row.
- Test: new `components/business-os/insight/__tests__/NeedsYouCard.queuedWorking.render.test.tsx` (jsdom, following the existing `*.render.test.tsx` pattern). (a) With a held `fetch`, clicking Send now shows "Working…", and neither Send now nor Cancel is in the DOM. (b) Releasing it with `{ success: true }` calls `onChanged` and hides "Working…". (c) Releasing it with `{ success: false, reason: 'already_sending' }` shows the refusal, and the buttons return. (d) Cancel shows "Working…" too. Mutation: drop the `isQueuedWorking` branch → (a) red.
- This stays within the UI short path. SA reviews it in the delta re-check. It does not reopen the server review.

**OP-P2-2: INCLUDED in P2 (CR-P2-2). It is safe.** Evidence:
- The only callers of `dispatchLeadResponses` are the cron (`*/5`, `vercel.json:45-46`), Drain now (`runQueueDrain.ts:43`) and this route (L-6 proves it).
- Nothing relies on the click to enqueue chases. The owner's own row already exists: `sendNow` only re-times a pending row (`LeadResponseRepository.ts:231-243`). Any chase the sweep would create is picked up by the cron within 5 minutes, exactly as it is when no owner clicks.
- Skipping the sweep is also the tenant-correct shape. Today one owner's click does service-role reads across up to 3 × 200 businesses (`findGaps` per business) and enqueues for all of them, inside a request that now waits.

Exact change:
- Service: add `sweep?: boolean` to `DispatchOptions`, documented as "default true; only an explicit `false` skips the chase sweep; the reaper always runs". In the body: `if (options.sweep !== false) result.enqueued = await enqueueApprovedChases();`. The reaper, the claim and the defaults stay unchanged. The cron and Drain now still call with no argument.
- Route: `await dispatchLeadResponses({ batch: SEND_NOW_BATCH, sweep: false });`, with one comment line: the cron sweeps every 5 minutes, and the sweep is every business's work, not this owner's.
- Tests: batch suite adds (i) no argument → the sweep runs (mock one sweeping automation and `supabaseServer.from` returning `{ data: [], error: null }`; assert `from` was called); (ii) `{ sweep: false }` → `from` was not called, while the reaper and the claim were; (iii) `{ batch: 5 }` alone still sweeps. Route L-1 expects `{ batch: 5, sweep: false }`. Mutation: the service ignores `sweep` → (ii) red.
- Update §8 "worst-case wait": reaper 1 RPC + at most 5 sends.

**OP-P2-3:** accepted as stated. The missing service, repository and cron suites are not P2's to add.

**OP-P2-4: KEEP** the `runQueueDrain(` rule in L-6. It costs one test, it closes the rule one level up where `runQueueDrain.ts` is not a route, and it was killed by mutation (M8 below). The overlap with W7D-5 S-5/S-6 is harmless because both pins assert the same truth. Note its limits: it does not inspect `runQueueDrain.ts`'s own `await DRAINS[queue]()`, which `runQueueDrain.test.ts` covers.

**Deviation 5 (early ticks): confirmed done, as of this review.** Every §6 item exists and holds. SA re-ran the suites, ESLint, scoped tsc and the mutations (below). The ticks stand. CR-P2-1/2 add new task lines 7 and 8, which must be ticked only when done.

#### Optimisation Suggestions
- The L-6 comment stripper (`(^|[^:])\/\/.*$`) would also strip a `'//'` inside a string literal on the same line as a call. That is an edge case, the same stripper the 7c gate uses, and it is not worth changing.

### Code Approved for QA: **Yes, conditionally.** The server change is approved as is. CR-P2-1 and CR-P2-2 must land and pass an SA delta re-check before RM, and CR-P2-3 before the PR is opened.

### SA delta re-check (2026-10-06)

**Scope:** CR-P2-1, CR-P2-2, CR-P2-3 only. Not a full re-review.
**Status:** ✅ Code Approved (delta). CR-P2-1/2/3 resolved.

- **CR-P2-1: resolved.** `isQueuedWorking` is a plain value inside `gap.items.map` (`NeedsYouCard.tsx:473`), no hook added (still the two `useState`s). When true, the strip renders `<span … aria-live="polite">{t('gaps.working')}</span>` in place of the two-button div; otherwise the buttons are unchanged apart from indentation. The outer condition, `control()`, the `queued:` refusal line (now `:655`) and other rows are untouched. Line endings: the file is LF at HEAD and in the worktree (0 CR in both), so nothing was converted and there is no whole-file churn (diff +27/-17). The render test covers (a) to (d) with a held `fetch`; (a) also pins URL and body, (c) checks the refusal and that both buttons return.
- **CR-P2-2: resolved.** `DispatchOptions.sweep` is documented "default true; only an explicit `false` skips"; the body is `if (options.sweep !== false)`; the reaper, the claim and `batchSize` are unchanged. The route calls `{ batch: SEND_NOW_BATCH, sweep: false }` (5). The cron (`cron/lead-response/route.ts:58`) and `runQueueDrain.ts:43` call with no argument, so they still sweep. Batch tests (i) to (iii) and route L-1 match the ruling.
- **CR-P2-3: resolved.** §3 items 5-6, §4, §5, §6 steps 7-8, §7, §8 worst-case wait, §9 and the §10 PR body now describe the UI change and the no-sweep click; "Not in this PR" no longer claims "no UI change". Leftovers, non-blocking: §8 OP-P2-2 still carries the pre-ruling sentence "Not built … SA to rule." beside the bold "built" resolution, and the QA report's "UI (CR-P2-1 not yet built)" / "(once CR-P2-1 is in)" are QA's to refresh on its re-run.

**SA re-runs** (fresh scratch copy `scratchpad\saP2\tree2` of this worktree + 7c `retryHolds.ts` (hold `false`) and `leadRetry.p2Gate.test.ts`; worktree untouched):

| Run | Suites | Tests | Result |
|---|---|---|---|
| 4 P2 suites + 7c p2Gate | 5 | 49 (42 + 7) | ✅ green |
| Related (Dev's §8c list + `lib/admin/jobs` incl. p2Gate) | 73 | 1,602 | ✅ green |
| `test:authz-guard` | 1 | 119 | ✅ green |
| M9 (SA): `false && isQueuedWorking` | 1 | 4 / 4 red | ✅ killed |
| M10 (SA): unconditional `enqueueApprovedChases()` | 1 | 1 / 16 red, test (ii) | ✅ killed |

Both mutations restored by copy and checked with `diff -q`.

### Code Approved for QA (delta): **Yes.** QA re-runs the delta; then the user diff and RM.

## QA Testing Report

### SA Review + QA (2026-10-05): test evidence

All runs were on a scratch copy (`scratchpad\saP2\tree`: `app`, `lib`, `components`, `types`, `hooks`, `__mocks__`, `tests/helpers`, `supabase/migrations` copied from this worktree; shared `node_modules` read through `moduleDirectories`; worktree untouched, `git status` unchanged apart from this doc).

| Run | Suites | Tests | Result |
|---|---|---|---|
| 3 new suites (route 14, batch 13, L-6 8) | 3 | 35 | ✅ green |
| 7c `leadRetry.p2Gate.test.ts` against this route (7c `retryHolds.ts`, hold `false`) | 1 | 7 | ✅ green |
| Related: `app/api/business-os/leads`, lead service, `app/api/cron/**`, `lib/admin/jobs` (+ p2Gate), `app/api/admin/jobs-queues/**`, `lib/business-os/gaps`, `components/business-os/insight`, `lib/business-os/leads`, `InsightActionDispatchService`, `adminGate.writes` | 35 | 1,246 | ✅ green (34 / 1,239 without the 7c gate) |
| `lib/business-os/insight` | 37 | 349 | ✅ green |

**Mutations (scratch tree, each restored by copy from the worktree and verified with `diff -rq`):**

| # | Mutation | Killed by |
|---|---|---|
| M1 (Dev's, re-run) | remove `await` from the route's drain | route suite (crashes, L-2 unhandled rejection), L-6 route rule, 7c P2 gate |
| M6 (Dev's, re-run) | new `lib/` caller of `dispatchLeadResponses` | L-6 caller set |
| M7 (SA) | `payment-retry` cron route `maxDuration = 300` | L-6 route rule |
| M8 (SA) | `runQueueDrain(queue)` un-awaited in the drain route | L-6 `runQueueDrain(` rule (OP-P2-4) |

**Not tested here:** live wait time (no DB access), and the UI in a real browser (CR-P2-1 is covered by the render test `NeedsYouCard.queuedWorking.render.test.tsx`).

### User check after deploy (what the owner should see)

On the Business OS dashboard's "Needs you" card, take a lead with a queued reply ("Sending: … · in N min") and press **Send now**:
1. Immediately, the two links "Send now · Cancel" are replaced by **"Working…"**. Nothing can be pressed a second time.
2. Within a few seconds, typically under 10, the card refreshes, and the queued strip for that lead is gone. The reply has been sent, or skipped for a stated reason (already booked, already replied, auto-send off).
3. The lead receives the email once.
4. If it says "already sending" instead, a runner got there first. That is correct, and the email still goes once.
5. If it ever shows the generic "couldn't do that" after a long wait, the reply is still due, and the cron sends it within 5 minutes. Report it: that means the 60 s cap was hit.
6. **Cancel** still answers at once (it never drains).

## Commit Info

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-05 | Created | Workplan and implementation, uncommitted |
| 2026-10-05 | SA Review + QA | Fix Required (approved with changes). Server change verified: `maxDuration = 60`, awaited drain + warn, batch 5 → `p_batch`, cron/Drain now unchanged, scoping unchanged, L-6 meaningful (independent walk), 7c p2Gate green. 3 new suites 35/35; related 35 suites / 1,246; insight 37 / 349; M1, M6 + SA M7, M8 killed. Ruled into P2: CR-P2-1 (Send now "Working…" state, OP-P2-1, SA's earlier "no UI change" withdrawn), CR-P2-2 (`{ sweep: false }` on the click, OP-P2-2). OP-P2-4 kept. Rule 1 (9 `.from(`) backlog only |
| 2026-10-05 | CR-P2-1, CR-P2-2, CR-P2-3 applied | "Working…" on the queued strip; `{ sweep: false }` on the send-now path; doc brought in line (§3, §4, §5, §6 steps 7-8, §7, §8, §8c, §9, §10). 4 P2 suites / 42; related 72 / 1,595; p2Gate 7/7; M9-M11 killed |
| 2026-10-06 | SA delta re-check | Approved. CR-P2-1/2/3 resolved. 4 P2 suites + p2Gate 49/49; related 73 / 1,602; authz-guard 119/119; SA M9, M10 killed. Two stale doc leftovers noted, non-blocking |
