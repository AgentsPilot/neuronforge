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

**QA — 2026-09-21**
**Test mode:** targeted (proportionate to a 29-line, two-route fix) — live security probes + full regression + one negative control
**Strategy used:** C (live test script against the branch dev server on :3006) + A/B (the two new Jest suites, plus full `npm test` vs the `ae902874` baseline) + E (code-path read for the client degradation path, since no browser session was available)
**Focus:** security (identity / anonymous surface), regression
**Skipped:** Playwright/E2E — not installed in this repo (CLAUDE.md § Testing). No staging, no commits, no server start/stop; other worktrees untouched.
**Input source:** prompt keywords + SA's § Notes for QA (items 1–6 mapped one-for-one)

**Tree under test:** `fix/help-bot-v2-auth` @ `fd9dc0e8` (committed by the user at 14:15 while QA was running — see Process note). Working tree verified byte-identical to that commit for both routes and both test suites; the only local modification afterwards is this report.

### Test Coverage

| Acceptance Criterion | Tested? | Result | Notes |
|---|---|---|---|
| Anonymous `POST /api/help-bot-v2` with victim `x-user-id` **and** body `userId`, agent-search question → 401, no answer, no agent names | ✅ | Pass | Live on :3006, cookie-less. `HTTP/1.1 401`, body exactly `{"error":"Unauthorized"}`. No `response`, no `source`, no agent names/ids/statuses anywhere in the payload |
| Same for input-help mode (`context.mode = 'input_help'`) | ✅ | Pass | Live: 401, same body. Unit test 4 additionally asserts the Groq `chatCompletion` mock is never called, so the branch costs nothing |
| Gate sits before `request.json()` (SA note 2) | ✅ | Pass | Extra live probe: anonymous POST with a deliberately malformed body (`not-json`) → **401**, not 400/500. The gate runs before parsing, so no body shape can slip past it |
| Anonymous `POST /api/help-bot-v2/feedback` with a **real** `cacheId` → 401 and the counter does not move | ✅ | Pass | Live, using a real `support_cache` id read read-only through the service role (`09ee441e-…`, `thumbs_up: 0`). Response 401 `{"error":"Unauthorized"}`; re-read after the call still `thumbs_up: 0, thumbs_down: 0`. **No production write performed** — two reads plus the rejected request |
| `GET /api/help-bot-v2/search` stays open and returns article content only | ✅ | Pass | Live anonymous `?q=agent&context=/v2/dashboard` → 200, 10 scored `help_articles` rows (title/snippet/url/score/category/pageContext). Global documentation text only; no user-keyed field. `help_articles` is not user-keyed |
| `GET /api/help-bot-v2/article/[id]` stays open and returns article content only | ✅ | Pass | Live anonymous `/article/1` → 200 `{id,title,body,url,keywords,category}` from `help_articles`. Same conclusion |
| Identity is server-derived; `x-user-id` is inert | ⚠️ | Partial — pass at unit level | Unit test 3 drives a session + a victim header and asserts the `agents` query carries exactly one `user_id` filter equal to the **session** id, and that the victim value appears in no `.eq()` at all. Live signed-in confirmation is PENDING the user's session (below) |
| Regression: `npm test` failure set unchanged vs `ae902874` | ✅ | Pass | Branch: **21 suites / 129 tests failed**, 8 skipped, **365 suites / 5727 tests passed** (386/394 suites, 154 s). Baseline per § Results: 21/129 failed, 363/5721 passed. Failure counts **identical**; the whole delta is +2 suites / +6 tests. All 21 pre-existing failures are the unrelated `Cannot find module '../lib/agentkit/v6/compiler/DeclarativeCompiler'` class |
| The 6 new tests pass | ✅ | Pass | `npx jest app/api/help-bot-v2 --verbose` → 2 suites / 6 tests green (15 s). Re-run green after the negative control |
| Negative control: removing the gate reddens the right tests | ✅ | Pass | See below |
| Degradation on an anonymous `/v2` shell → "I'm having trouble connecting right now" | ✅ | Pass (code-path verification) | See below |
| Signed-in: FAQ / cache-hit / Groq layers all still answer | ⏳ | PENDING | Needs the user's browser session — not faked |
| Signed-in: agent search finds *my* agents, and a second account's agent is not findable | ⏳ | PENDING | Unit test 3 plus the `.eq('user_id', <session id>)` read are the standing evidence; the cross-account check needs two live sessions |
| Signed-in: thumbs up/down still records (200) | ⏳ | PENDING live | Covered at unit level: 200 with `{ success: true, feedback: 'up', newCount: 4 }` and exactly one `{ thumbs_up: 4 }` write |

### Negative control (independent of SA's mutation test)

Mutated **one** route — `app/api/help-bot-v2/route.ts`, the F15 hole itself — by replacing the four gate lines with the pre-fix identity shape (`const user = { id: request.headers.get('x-user-id') || 'anon' }`), then re-ran both suites:

| Suite | Mutated | Reading |
|---|---|---|
| `app/api/help-bot-v2/__tests__/auth.test.ts` | **4/4 fail** (both 401 tests, the header-scoping positive control, and the input-help test) | ✅ the gate is what they assert |
| `app/api/help-bot-v2/feedback/__tests__/auth.test.ts` | **2/2 still pass** | ✅ correct — the suites are route-scoped, so neither is masking the other |

Restored from a byte-level backup: `md5` before mutation and after restore are identical (`0a647033ec6e18c14ee3e4a9da86eb73`), `git diff HEAD` empty, `git status` clean, both suites green again (6/6). A live anonymous re-probe after the restore returns 401, confirming the running dev server serves the restored (gated) route, not the mutant.

### Degradation check (SA note 4)

No browser session was available, so this was verified in the client code paths. The path is short and unambiguous:

- `components/v2/ModernHelpDialog.tsx:273` and `components/v2/HelpBot.tsx:127`: `const data = await response.json(); if (data.error) throw new Error(data.error)`.
- The `catch` in both appends an assistant message with the literal text **"I'm having trouble connecting right now. Please try again or contact support."**
- Both have `finally { setIsLoading(false) }`, so the typing indicator clears — **not a hang**, and **not a blank bubble** (the content is a non-empty constant, never `data.response`, which is `undefined` on the 401 path).

This is precisely why the bare `{ error }` shape matters. The CLAUDE.md `{ success: false, error }` envelope also has a truthy `error` and would still work — but any refusal body *without* an `error` key would render as a successful empty answer. SA's note 1 is correct and worth keeping.

Also re-verified SA's premise independently: the only callers of the two gated routes are `HelpBot.tsx:121/171` and `ModernHelpDialog.tsx:263/359` (repo-wide grep across `app`, `components`, `lib`, `scripts`, `hooks`), and every mount is under `/v2/*`. `app/admin/helpbot-config/page.tsx` matches on the string "HelpBot" only — it configures the bot and mounts neither component. No anonymous surface is lost.

### Issues Found

#### Bugs (must fix before commit)

None. No High/Medium/Low bug found in the change.

#### Performance Issues (should fix)

None attributable to this change. The gate adds one `getUser()` per request — the cost the rest of the API already pays — and it *saves* a Groq completion plus an OpenAI embedding on every anonymous hit.

#### Edge Cases (nice to fix)

1. **Feedback client never checks the response.** `HelpBot.tsx:171` / `ModernHelpDialog.tsx:359` `await fetch(...)` without reading `response.ok`, then set `feedbackGiven` optimistically — so a 401/404/500 still turns the thumb solid while nothing is recorded. Pre-existing, not introduced here, and not reachable in practice now that a `cacheId` can only come from an authenticated answer. Bundle with the F18/Zod tidy of the same file. Severity: Low.
2. **F18 (SA-recorded) still stands:** the `select` → `update` increment in `feedback/route.ts` loses concurrent counts. Out of scope by SA's cap. Low.
3. **`console.*` counts in the route family (F17)**, measured while testing so whoever picks F17 up has the numbers: `route.ts` 33, `feedback/route.ts` 4, `search/route.ts` 9 (that last file is untouched by this branch). Deferred per the standing scope instruction — flagged only, per CLAUDE.md § Logging.

### Test Outputs / Logs

```
# Live, cookie-less, :3006 — POST /api/help-bot-v2 (victim header + body userId, agent-search question)
HTTP/1.1 401 Unauthorized
content-type: application/json
{"error":"Unauthorized"}

# Live — POST /api/help-bot-v2, context.mode = input_help
HTTP/1.1 401 Unauthorized
{"error":"Unauthorized"}

# Live — POST /api/help-bot-v2 with a malformed (non-JSON) body
status=401                      # gate precedes request.json()

# Live — POST /api/help-bot-v2/feedback with a REAL cacheId
BEFORE: [{"id":"09ee441e-52ff-419b-b909-0f6b83629ffb","thumbs_up":0,"thumbs_down":0}, ...]
HTTP/1.1 401 Unauthorized
{"error":"Unauthorized"}
AFTER:  [{"id":"09ee441e-52ff-419b-b909-0f6b83629ffb","thumbs_up":0,"thumbs_down":0}, ...]

# Live — GET /api/help-bot-v2/search?q=agent   (intentionally open)
{"results":[{"id":"38","title":"Find agent list page","snippet":"To view all your agents, click the **Active Agents** card ...","url":"/v2/agent-list","relevanceScore":16,"category":"Documentation","pageContext":"/v2/dashboard"}, ...]}

# Live — GET /api/help-bot-v2/article/1        (intentionally open)
{"id":1,"title":"View all agents","body":"The **Active Agents** card shows only the **top 3 most active agents** ...","url":"/v2/agent-list","keywords":[...],"category":"/v2/dashboard"}
```

```
# npx jest app/api/help-bot-v2 --verbose   (branch, as committed)
PASS app/api/help-bot-v2/__tests__/auth.test.ts (6.942 s)
  POST /api/help-bot-v2 - identity is server-derived
    + 401s with no session, and never reads the agents table (117 ms)
    + 401s when a victim id is supplied in the body instead (5 ms)
    + ignores the x-user-id header and scopes the agent search to the session user (14 ms)
    + 401s anonymously in input_help mode too, without calling the model (47 ms)
PASS app/api/help-bot-v2/feedback/__tests__/auth.test.ts (7.208 s)
  POST /api/help-bot-v2/feedback - requires a session
    + 401s with no session and leaves the counter untouched (50 ms)
    + records the vote for a signed-in caller (231 ms)
Test Suites: 2 passed, 2 total
Tests:       6 passed, 6 total

# npm test (branch)
Test Suites: 21 failed, 8 skipped, 365 passed, 386 of 394 total
Tests:       129 failed, 58 skipped, 5727 passed, 5914 total
Time:        154.187 s
# baseline ae902874 (Dev's table): 21 suites / 129 tests failed, 363 suites / 5721 tests passed

# Negative control — gate removed from app/api/help-bot-v2/route.ts only
FAIL app/api/help-bot-v2/__tests__/auth.test.ts             4 failed
PASS app/api/help-bot-v2/feedback/__tests__/auth.test.ts    2 passed
Test Suites: 1 failed, 1 passed, 2 total
Tests:       4 failed, 2 passed, 6 total
# restored: md5 identical (0a647033ec6e18c14ee3e4a9da86eb73), git diff HEAD empty, 6/6 green, live re-probe 401
```

### Process note

The branch was committed and pushed as `fd9dc0e8` at 14:15 local — **while this QA pass was still running** (the commit body reads "Tested by: QA in progress"). It does not compromise the verdict: the negative-control mutation started at 14:17 and was restored byte-exactly at 14:18, so the commit captured the unmutated tree, and every live probe above ran against the pre-mutation server. Verified explicitly — `git diff HEAD` empty for both routes and both suites, `git show HEAD:app/api/help-bot-v2/route.ts` contains the gate, and the commit diff vs `ae902874` is exactly the five expected paths (+520/−5: the 24-line and 10-line route edits, the two new suites, this workplan). **The verdict below applies to `fd9dc0e8`.** QA staged and committed nothing; the only uncommitted change is this report.

### Final Status

- [x] **All criteria testable without a session pass — the fix does what it claims and the tests hold it in place.** No bugs; nothing blocking.
- [ ] Three signed-in criteria remain **PENDING the user's own session** and were not faked: (a) the three answer layers — FAQ, cache hit, novel/Groq; (b) agent search finding the user's own agent by name, and a second account's agent **not** being findable; (c) thumbs up/down recording a 200 from the dialog. Each has unit-level evidence, and none is a new risk from this change: the gate sits *above* all of them, and every signed-in path is byte-for-byte the pre-fix path with `user.id` substituted for the header.

**Verdict: PASS** — ready for release, with the three signed-in checks recorded as a post-merge smoke test for the user rather than a blocker.

## Commit Info

_(RM)_
