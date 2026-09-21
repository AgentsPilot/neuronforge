# Workplan: help-bot-v2 identity lock (SA finding F15)

**Developer:** Dev
**Branch:** `fix/help-bot-v2-auth` (from `ae902874`, includes PR #80)
**Date:** 2026-09-21
**Status:** SA-approved for QA (2026-09-21) — pending CR1, a five-line gate on the sibling feedback route

## Problem

`app/api/help-bot-v2/route.ts` has no `getUser()` anywhere. It holds a module-level
service-role Supabase client (`:15`, RLS bypassed) and at `:697` took its identity from
the request:

```ts
const userId = request.headers.get('x-user-id') || null
```

That value flowed into `searchAgents(query, userId)` →
`.from('agents').eq('user_id', userId).ilike('agent_name', '%query%')`. Any anonymous
caller could set `x-user-id` to a victim's uuid and enumerate that user's agent names,
ids and statuses through the bot's reply text. Same class as F4/F13 fixed in PR #80.

## Decision: require authentication for the whole route

`POST` now calls `getUser()` before the body is read and 401s without a session; `userId`
is `user.id` and the header is never read. Rationale:

1. **No anonymous surface exists to preserve.** Both callers are rendered only on
   signed-in pages: `HelpBot` on `/v2/agents/[id]/run` and `/v2/sandbox/[agentId]`,
   `ModernHelpDialog` on `/v2/dashboard`, `/v2/agent-list`, `/v2/agents/[id]`,
   `/v2/analytics`, `/v2/billing`, `/v2/notifications`, `/v2/settings`. `/v2` is not in
   middleware's skip list. No marketing, `/site/*`, onboarding or booking page mounts
   either component. Requiring auth costs no real user anything.
2. **The anonymous path is worth more than the agent leak alone.** Every FAQ+cache miss
   spends a Groq completion plus an OpenAI embedding, and `storeInCache` writes the
   attacker's question and the model's answer into `support_cache`, which is **global** —
   the next user asking a similar question is served that row via semantic match. Gating
   only `searchAgents` would close the enumeration and leave an unauthenticated
   cost-burn and shared-cache-poisoning endpoint behind.
3. Smallest diff, and the same shape as the merged PR #80 routes.

Alternative considered and rejected: keep the route open and make only the personalised
branch session-only. Correct for the leak, but leaves (2) open for no benefit, since no
anonymous caller exists.

The 401 body is `{ error: 'Unauthorized' }` — this file's own envelope for its 400/500
responses, and what both callers already handle (`if (data.error) throw`).

## Other user-keyed reads through the service-role client

Audited every query in the file. `help_articles`, `support_cache`, `system_config`
(via `SystemConfigService`) and the `update_support_analytics` /
`search_support_cache_semantic` RPCs are all global, non-user-keyed. `agents` in
`searchAgents` was the only user-keyed read. `AIAnalyticsService` is only used here for
writes (`chatCompletion` attribution), not its user-filtered read paths.

## Sibling routes — checked, reported, not changed

| Route | Finding | Action |
|---|---|---|
| `search/route.ts` | Service-role read of `help_articles` only. Global documentation content, no user keying, no caller-supplied identity. | None needed |
| `article/[id]/route.ts` | Same, via `supabaseServer`, already on Pino. | None needed |
| `feedback/route.ts` | No identity of any kind, but it is an **unauthenticated write**: caller-supplied `cacheId` increments `thumbs_up`/`thumbs_down` on the global `support_cache`. Not the F15 shape (no cross-tenant read), so out of scope — but anyone can stuff the quality signal for any cached answer. Recommend a separate ticket. | **Gated in this branch** — see CR1 below (SA ruled it in scope) |

## Files changed

| File | Action | Reason |
|---|---|---|
| `app/api/help-bot-v2/route.ts` | modify | `getUser()` gate; `userId` from session; `searchAgents` takes a non-nullable id |
| `app/api/help-bot-v2/__tests__/auth.test.ts` | create | Identity lock, shape of `app/api/enhance-prompt/__tests__/auth.test.ts` |
| `app/api/help-bot-v2/feedback/route.ts` | modify | CR1 — same `getUser()` gate (see CR1 section) |
| `app/api/help-bot-v2/feedback/__tests__/auth.test.ts` | create | CR1 — 2 tests, same shape |

Client components are unchanged — they may keep sending `x-user-id`; the server ignores
it. PR #80 left its equivalent client sends in place for the same reason.

`console.*` in this file is deliberately untouched (tracked as F17).

## Task list

- [x] Read route, callers, render sites, sibling routes
- [x] Decide the fix and record the rationale
- [x] Implement the `getUser()` gate
- [x] Audit the remaining service-role reads
- [x] Write the identity-lock tests
- [x] New suite, full `npm test` vs `ae902874` baseline, tsc, eslint, `next build`

## Test plan

`app/api/help-bot-v2/__tests__/auth.test.ts`:
1. No session + victim `x-user-id` → 401, and `from('agents')` is never called.
2. No session + victim id in the body → 401, no agents query.
3. Session present + victim `x-user-id` → the agents query is scoped to the **session**
   user id, never the header value.
4. Input-help mode (the pre-`userId` branch) also 401s anonymously — it spends Groq.

## Results

| Check | Baseline `ae902874` | Branch |
|---|---|---|
| `npx jest app/api/help-bot-v2` | n/a (suite is new) | **4/4 pass**; all 4 fail if the route fix is reverted |
| `npm test` | 21 suites / 129 tests failed, 363 suites / 5721 tests passed | 21 suites / 129 tests failed, 364 / 5725 passed — **failure counts identical**, the whole delta is the new suite |
| `tsc --noEmit` | 2031 errors, 2 of them in `help-bot-v2/route.ts` (501, 554 — the `SystemConfigService.get(..., null)` inference in `callGroq`) | 2031 errors, same 2 in that file, shifted to 504/557 by the added lines. **No new errors.** |
| `eslint` on changed files | — | 0 errors. 11 pre-existing warnings in `route.ts` (`any`, unused vars), none on a changed line; the test file is clean |
| `next build` | — | Succeeds (exit 0) |

## Caller impact

Neither client component changes and neither needs to: browser `fetch` to a same-origin
path sends the session cookie by default, so every signed-in user is unaffected. The one
behaviour change: `/v2/*` pages are guarded at the page level, not by middleware, so an
anonymous visitor can still *load* e.g. `/v2/dashboard` (empty — every data load bails on
`if (!user) return`) and open the help dialog. They now get the client's generic
"I'm having trouble connecting right now" instead of an answer. That is the intended
outcome on a page that shows them nothing anyway.

## SA Review Notes

**Code Review by SA — 2026-09-21**
**Status:** ✅ **Code Approved** — with **one required addition (CR1, ~5 lines + 2 tests, same file family)**.
The 19-line fix itself is correct, minimal and well-argued; nothing in it needs changing.

Proportionate review for a proportionate fix — four checks, all run rather than read.

| Check | Method | Result |
|---|---|---|
| Do the tests actually gate it? | **Mutation test** — replaced the gate with the pre-fix shape (`const user = { id: request.headers.get('x-user-id') \|\| 'anon' }`), re-ran, then restored from backup and confirmed the diffstat returned to +19/−5 | ✅ **all 4 tests fail**, including the positive control (test 3 asserts the `agents` query is `.eq`-scoped to the session id and never the header value). Restored suite: 4/4 green |
| Any identity path left? | Grepped `x-user-id` / `headers.get` / `userId` in the route | ✅ none. The only remaining `userId`/`user_id` occurrences are `searchAgents`' now-non-nullable parameter, its `.eq('user_id', userId)`, and the two `'system'` analytics constants |
| Any other user-keyed read through the service-role client? | Read every `.from(` and `.rpc(` in the file | ✅ Dev's audit holds: `agents` (`:86`) is the only user-keyed one. `help_articles`, the three `support_cache` queries and the insert are global, and both RPCs (`search_support_cache_semantic`, `update_support_analytics`) take no user id |
| Anything beyond route + test + workplan? | `git status` / `git diff --stat` | ✅ exactly three paths, `+19/−5` in the route |

**The whole-route gate is the right call, and I verified the premise rather than accepting it.** I enumerated the
render sites myself: `ModernHelpDialog` in `/v2/{agent-list, agents/[id], analytics, billing, dashboard,
notifications, settings}` and `HelpBot` in `/v2/agents/[id]/run` and `/v2/sandbox/[agentId]` — **every mount is under
`/v2/*`**, and nothing outside `/v2` renders either component (`app/admin/helpbot-config` only *configures* the bot).
So no legitimate anonymous surface is lost. Dev's second and third arguments are the stronger ones anyway and I agree
with both: the anonymous path spent a Groq completion plus an OpenAI embedding per cache miss, and `storeInCache`
wrote the caller's question and answer into the **global** `support_cache` that is then served to other users by
semantic match — so an unauthenticated route here is a cost-burn and cache-poisoning vector, not only an agent-name
IDOR. Gating only the `searchAgents` branch would have closed the smallest of the three holes.

Two details worth recording because a future reviewer might "correct" them:

1. **The 401 body is `{ error: 'Unauthorized' }`, not the CLAUDE.md `{ success: false, error }` envelope — and that is
   correct here.** Both clients branch on `data.error` (`HelpBot.tsx:127`, `ModernHelpDialog.tsx:273`), and every other
   error in this route already uses the bare shape. Switching to the standard envelope would make the 401 render as a
   *successful* empty answer. If the envelope is ever normalised, the two clients must change in the same commit.
2. **The gate sits before `request.json()`**, so the input-help branch — which returns before the old `userId` line and
   would otherwise still cost a model call — is covered. Test 4 locks exactly that, which is the non-obvious case.

### CR1 — required: gate `app/api/help-bot-v2/feedback/route.ts` in this branch

**Ruling: it belongs here, not in a separate ticket.** It is the same route family, the same threat class
(unauthenticated access to the service-role client), the same five-line remedy, and the same two callers
(`HelpBot.tsx:171`, `ModernHelpDialog.tsx:359`) that this branch's QA already exercises — so it carries no regression
risk of its own and needs no separate QA pass.

The substantive reason: shipping this branch as-is closes the *read* hole on `support_cache` and leaves an
unauthenticated *write* to the same table one path over, where a caller-supplied `cacheId` increments `thumbs_up` /
`thumbs_down` on the global quality signal that decides which cached answers keep getting served. That is the same
asymmetry I created last cycle by splitting `action-schema` from `execute`, and the cost was an extra round-trip plus
a route whose own comment justified itself by pointing at a hole that had since been closed. Not repeating it.

**Cap it tightly — this is a five-line change:** `getUser()` + 401 as the first statement in the `try`, matching this
route's `{ error }` shape, plus two tests (401 signed out and the counter never updates; 200 signed in). Explicitly
**not** in scope: converting the hand-rolled validation to Zod, the `console.*` (F17), and the non-atomic
read-modify-write below.

If TL would rather not reopen the branch, the only acceptable alternative is landing it as an immediate follow-on
commit on **this** branch before QA signs off — not a new cycle.

### Recorded, not for this branch

| # | Item | Severity |
|---|---|---|
| **F18** | `feedback/route.ts` increments via read-then-write (`select` → `update`), so concurrent feedback loses counts. CLAUDE.md § Gotchas already prescribes the remedy: an RPC for safe concurrent updates. Bundle with the Zod tidy of the same file | Low |
| **F17** | `console.*` in this file remains deferred and tracked — correct per the standing scope instruction | — |

### Notes for QA

1. **Happy path first:** signed in on `/v2/dashboard`, open the help dialog and ask a question that hits each layer —
   a FAQ answer, a repeat question (cache hit), and a novel one (Groq). All three must still work; the gate sits above
   all of them.
2. **The agent-search branch is the one that was leaking:** signed in, ask the bot about one of your own agents by
   name and confirm it finds it. Then confirm a *second* account's agent name is not findable from your session.
3. **Signed out**, `curl -X POST /api/help-bot-v2` with `x-user-id: <some other user id>` and a `messages` array →
   must be 401, with no answer body.
4. **Deliberate degradation:** `/v2/*` pages are guarded at page level, not by middleware, so an anonymous visitor can
   still load an empty `/v2/dashboard` shell and open the help bot. Expect the client's generic "I'm having trouble
   connecting right now" — confirm it is that, not a hang or a blank bubble.
5. Both clients still send an `x-user-id` header; it is now inert. No client change was needed or made.
6. If CR1 lands: signed out, `curl -X POST /api/help-bot-v2/feedback` with a real `cacheId` → 401 and the counter
   unchanged; signed in, thumbs up/down from the dialog still records.

### Code Approved for QA: **Yes — after CR1 (five lines + two tests, this branch)**

## CR1 Implementation (Dev) — 2026-09-21

SA's CR1 taken as ruled: `feedback/route.ts` gated on this branch, capped exactly as
specified. Nothing else in the file touched — no Zod, no `console.*` (F17), and the
select→update lost-update race left alone as F18.

**Change:** `app/api/help-bot-v2/feedback/route.ts`, **+10 / −0** — `getUser()` + 401 as
the first statement in the `try`, in the route's own `{ error: 'Unauthorized' }` shape
(same reasoning as the parent route: both callers branch on `data.error`), plus the
four-line comment recording why an unauthenticated write to the global quality signal is
the same threat class as the read hole.

**Tests:** `app/api/help-bot-v2/feedback/__tests__/auth.test.ts`, new, 2 tests in the same
shape as the parent suite — signed out → 401, `support_cache` never touched and no update
recorded; signed in → 200 with `{ success: true, feedback: 'up', newCount: 4 }` and exactly
one `{ thumbs_up: 4 }` write. Mutation-checked: with the gate removed the 401 test fails
and the signed-in test still passes, which is the intended split (the second test is the
no-regression control, not a gate assertion).

### Results after CR1

| Check | Baseline `ae902874` | Branch |
|---|---|---|
| `npx jest app/api/help-bot-v2` | n/a (both suites new) | **2 suites / 6 tests pass** |
| `npm test` | 21 suites / 129 tests failed; 363 suites / 5721 tests passed | 21 suites / 129 tests failed; **365 / 5727 passed** — failure counts identical to baseline, the whole delta is the two new suites (+6 tests) |
| `tsc --noEmit` | 2035 errors | 2035 errors — **identical**. (Both re-measured with the same `.next/` present: the earlier 2031 figures were taken before any `next build`, and a build adds 4 pre-existing errors in generated `.next/types/app/api/**` stubs for three routes this branch never touches. No new errors in either changed file; the 2 long-standing ones in `route.ts` are the `SystemConfigService.get(..., null)` inference in `callGroq`.) |
| `eslint` on changed files | — | 0 errors. 1 pre-existing warning in `feedback/route.ts` (`catch (error: any)`), none on a changed line; the new test file is clean |
| `next build` | — | Exit 0, "Compiled successfully"; all four `/api/help-bot-v2*` routes emit dynamic (ƒ). The `DYNAMIC_SERVER_USAGE` prerender logs are pre-existing noise from unrelated routes and present in the pre-CR1 build too |

**Total branch diff:** `route.ts` +19/−5, `feedback/route.ts` +10/−0, two new test suites
(156 + 99 lines), this workplan. No client component changed. Nothing staged, committed or
pushed.

## QA Testing Report

_(QA)_

## Commit Info

_(RM)_
