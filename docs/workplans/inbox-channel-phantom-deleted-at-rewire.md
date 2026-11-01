# Inbox-channel reads: rewire onto repositories (phantom `deleted_at` fix)

> **Last Updated**: 2026-11-01

## Overview

A production Supabase request returns HTTP 400 because
`lib/business-os/leads/inboxChannel.ts` filters `crm_contacts` on
`deleted_at`, a column that does not exist on that table. PostgREST rejects the
whole select (42703), the caller destructures only `data`, and every inbox
channel has therefore reported **zero leads** on all four surfaces that ask.

The repository methods that fix this already exist — commit `21b99976`
(2026-10-31) added them and said the call site would be rewired "in a separate
commit, once this branch is up to date with main". **This is that commit.**
Nothing else is in scope.

> **Status: shipped.** The change landed as
> [#598](https://github.com/AgentsPilot/neuronforge/pull/598) (the fix),
> [#599](https://github.com/AgentsPilot/neuronforge/pull/599) (the fixture
> status and its guard) and [#600](https://github.com/AgentsPilot/neuronforge/pull/600)
> (`findStateByTag`, narrowing the hot read). This document is landed after the
> fact, as the record of the diagnosis and the follow-up register; it is not a
> plan awaiting execution. Task 8 below was **withdrawn** — see its entry.

## Table of Contents

- [Diagnosis](#diagnosis)
- [Scope](#scope)
- [Tasks](#tasks)
- [SA Review](#sa-review)
- [QA Report](#qa-report)

---

## Diagnosis

Measured against live project ref `jgccgkyhpwirgknnceoh`, tree
`claude/gifted-bouman-eca375` @ `df71761e` (not behind `origin/main` on either
touched file).

### The failing request

```
GET /rest/v1/crm_contacts
  ?select=source_metadata
  &user_id=eq.<uuid>
  &deleted_at=is.null
  &created_at=gte.<30d ago>
  &source_metadata=cs.%7B%22via%22%3A%22inbox_channel%22%7D   -> 400
```

### The original hypothesis was wrong

The reported suspicion was that `source_metadata` is not `jsonb`, making `cs.`
invalid. The live schema says otherwise:

| Column | Live type | Notes |
|---|---|---|
| `source_metadata` | **`jsonb`** | `cs.` / `.contains()` is correct and valid |
| `referrer_domain`, `utm_source`, `utm_medium`, `utm_campaign` | `text` | `GENERATED ALWAYS` over `source_metadata->>…` |
| `deleted_at` | **does not exist** | ⬅ the actual cause |

`agents` is the **only** table in `public` carrying a `deleted_at` column —
verified by querying `information_schema.columns` across the whole schema.
Deletes on `crm_contacts` are hard.

So the malformed filter is `deleted_at=is.null`, not the `cs.` operator.

### Why nobody noticed (rule 4 shape)

```typescript
const [{ data: agents }, { data: connections }, { data: profile }, { data: leadRows }] =
  await Promise.all([ /* … */ ]);
//   ^ no `error` binding anywhere — the 42703 is discarded
```

`leadRows` is `null`, `leadRows ?? []` is empty, `leadsByProvider` stays empty,
and every channel's `leads` computes to `0`. The function is documented "never
throws", so the failure produces a plausible number rather than an error.

The UI then **hides the zero**: `ChannelsCard` renders the lead count only when
`channel.leads > 0`, otherwise falling back to `channel.watching`. An owner sees
"Gmail · new enquiries" where they should see "Gmail · 12 leads" — there is no
`0` on screen to query. Affected surfaces: the Channels card, the onboarding
build page, My Day, and the readiness gate.

**Blast radius is one query.** A scan of all 94 `from('crm_contacts')` chains in
`lib/` and `app/` found this as the only one filtering `deleted_at`.
`ChannelAttributionRepository.findAttributedContacts` carries a doc comment
recording that the same mistake emptied it once before.

---

## Scope

| In | Out |
|---|---|
| Rewire the four reads in `inboxChannelStatus` onto repositories | Any change to the repository methods themselves (landed in `21b99976`) |
| Surface read failures through Pino instead of discarding them | The S0.3 Supabase key rotation — unrelated stream, must not be bundled |
| Jest guard that the phantom filter cannot come back | Broadening the fix to other `crm_contacts` callers (none are affected) |

Rule 1 is satisfied for the whole `Promise.all`, not just the broken read: all
four reads move off `supabaseServer`.

| Read | Repository method | Status |
|---|---|---|
| `agents` by tag | `agentRepository.findByTag` | Already existed; exact match (same scope, tag, valid `deleted_at`, same order) |
| `plugin_connections` | `pluginConnectionRepository.findByUserAndPlugins` | Added by `21b99976` |
| `business_profiles.lead_autosend_enabled` | `businessProfileRepository.getLeadAutosendEnabled` | Added by `21b99976` |
| `crm_contacts` leads | `channelAttributionRepository.findLeadsByVia` | Added by `21b99976`; **drops the phantom filter** |

## Tasks

- [x] 1. Replace the four inline `supabaseServer` reads with the repository calls
- [x] 2. Bind and log each read's `error` so a future malformed query is loud
- [x] 3. Keep `null` vs `false` distinct for `lead_autosend_enabled` — behaviour was
      already right, but shipped with **no guard** (QA's M3 mutant passed 8/8);
      four tests added, M3 now caught
- [x] 4. Jest guard: `leads` is tallied from the repository result, and no
      soft-delete filter is reintroduced on a contacts read
- [x] 5. Typecheck the touched files; run the affected suites
- [x] 6. *(added after review)* Fix B-1: the unattributed-lead rule read the channel
      count off `seen` mid-loop, so with two mailboxes the older one took every
      unmarked lead. Unreachable before this fix; reachable the moment the read
      works. Two tests
- [x] 7. *(added after review)* Fix the fixture status `'connected'` — a value the
      live table never holds, so every test in the suite ran against a mailbox the
      code considered unplugged. Plus a test that guards the fixture itself
- [ ] 8. *(added after review, then **withdrawn**)* Record in
      `AgentRepository.findByTag` that its `select('*')` is load-bearing for
      `last_run`. The comment was written and then removed again in `11bb605b`:
      [#600](https://github.com/AgentsPilot/neuronforge/pull/600) landed the very
      change it warned against, but did it safely — adding `findStateByTag`
      (four columns, `last_run` declared on `TaggedAgentState`) instead of
      narrowing `findByTag`. After #600 the lead reader no longer calls
      `findByTag` at all, so the comment pointed at a caller that does not exist.
      #600's own doc block records the accurate reason

### Review outcome

SA: **approved as-is**, three low comments. QA: **PASS**, four findings plus two
live defects of the same class found elsewhere. Every comment from both is either
fixed above or listed under Follow-ups below. Verification after the fixes:

| Check | Result |
|---|---|
| `npx jest lib/business-os/leads lib/repositories lib/business-os/channel-insights lib/business-os/automations` | 165 suites / 3631 tests pass |
| The touched suite | 15 tests (was 8) |
| Mutation M3 (`!== true`, collapses null into false) | **caught** — 2 failures (passed 8/8 before) |
| Mutation B1 (channel count off `seen` again) | **caught** — 1 failure |
| Mutation B4 (impossible fixture status back) | **caught** — 1 failure |
| `tsc --noEmit` | 0 diagnostics in touched files; ~1.9k pre-existing elsewhere, no `TS2688`, so the semantic pass provably ran |

---

## Follow-ups — NOT in this change

Deliberately out of scope. None is bundled here, and the S0.3 key rotation is
untouched.

| # | Finding | Severity |
|---|---|---|
| F-1 | **Handed to Offir 2026-11-01 by email, with the live-schema evidence.** `lib/services/CapabilityConditionEvaluator.ts` `activateBlock` filters `user_capability_blocks.user_id` / `.block_id`; the real columns are `user_capability_id` / `building_block_id`. The select is valid so `schema:check` cannot see it, the error is discarded, and the INSERT repeats the phantom keys — **the function can never succeed**, and its live caller is `app/api/onboarding/build/route.ts`. Same shape as this bug | **High** — live and reachable |
| F-2 | `scripts/schema-check.ts` validates **select** columns only. This defect hid for 30 days inside a query whose select was perfectly valid, and the same blind spot is hiding F-1 and F-3 right now | High (tooling) |
| F-3 | Write-payload phantoms QA found unverified: `billing_events.credits_delta`/`.description`/`.metadata`, `agents.config` (`duplicateAgent`), `agent_logs.status_message`, `sla_events.agent_id`, `run_memories.metadata`. Counts are floors; each needs its own check before anyone acts | Medium, unverified |
| F-4 | `lib/services/workflowService.ts` selects a phantom `workflow_executions.workflow_id`, but the code is unreachable and the error is thrown, not swallowed | Low |
| F-5 | Declare `last_run?: string \| null` on the shared `Agent` type. Removes four casts (one here, three in `automations/install.ts`) and is what would let `findByTag` narrow its select safely | Low |
| F-6 | `findByTag`'s `select('*')` pulls 56 columns incl. 11 jsonb on a `no-store` path four surfaces hit. Blocked on F-5 — narrowing it today reintroduces the `never_run` trap. **Partly addressed by [#600](https://github.com/AgentsPilot/neuronforge/pull/600)**, which gave the lead reader a four-column `findStateByTag` rather than narrowing `findByTag`; `automations/install.ts` still takes the wide read | Low (perf) |
| F-7 | A failed read still renders a confident, wrong card (`0` leads, `not_connected`). The log is there for us; the owner sees a plausible number. A `degraded` flag on `InboxChannelStatus` would let a surface say "could not read" | Low |
| F-8 | `lib/business-os/leads/captureEnquiry.ts` still makes six direct `supabaseServer` calls — rule 1 debt in the same directory | Low |
| F-9 | 24 of 729 selects fail `npm run schema:check` on the live DB. All pre-existing; none touches `crm_contacts` or anything in this change | Medium, pre-existing |
| F-10 | **Handed to Offir 2026-11-01 by email.** Two unrelated production 400s seen in the same log window: `/rest/v1/rpc/search_similar_memories` (5 hits) and `/rest/v1/insights?select=*` (1). Narrowed before handover: the RPC **does** exist in prod with a matching signature, `anon` and `authenticated` both hold EXECUTE, and the dimensions agree (`run_memories.embedding` is `vector(1536)`; `system_settings_config` has `text-embedding-3-small` / 1536) — so `MemoryInjector.ts:325`'s "function not found" message is false, and its fallback silently caps the search at 100 candidate rows. Root cause still unfound; `insights` exists with RLS on, so that one needs the untruncated request line | Unknown |
| F-11 | With two mailboxes, unattributable leads are now counted for neither channel. That is what the code's own comment intends and nothing regressed (the number was never displayed), but whether those leads should instead be shown as an "unattributed" total is a product call | Product decision |

---

## SA Review

**Code Review by SA — 2026-11-01**
**Status:** ✅ Code Approved (no required fixes; three low-severity items recommended, none blocking)

Verified independently, not taken from the submission:

| Claim | How it was checked | Result |
|---|---|---|
| `crm_contacts` has no `deleted_at` | every `CREATE TABLE`/`ALTER TABLE … ADD COLUMN deleted_at` in `supabase/migrations/` — no hit on `crm_contacts`; corroborated by `CRMContactRepository.ts:349`, `ChannelAttributionRepository.ts:75` | ✅ holds |
| `agents.last_run` is real and means "the runner finished a run" | `lib/execution/scheduledAgentRunner.ts:112` selects it, `:638` writes it only after success, `:355` / `:624` state it is deliberately not written at claim time or on failure | ✅ holds — `never_run` reads the right fact |
| Typecheck of the touched files | `npx tsc --noEmit -p tsconfig.json`, filtered to the two files: 0 diagnostics. The run emitted 1,916 pre-existing errors repo-wide, so the semantic pass genuinely executed (not a parse-error short circuit) | ✅ clean |
| Tests | `npx jest lib/business-os/leads lib/repositories/__tests__/{ChannelAttribution…,PluginConnection…,BusinessProfile…,AgentRepository.existsWithTag}` → 10 suites, 105 tests, all pass | ✅ green |

### Rulings on the four questions put to review

1. **Semantics preserved.** Read-by-read, the repository call issues the same query as the inline read it replaced — same `user_id` scope, same filters, same order, same (or wider) column set. `findByTag` (`lib/repositories/AgentRepository.ts:219-234`) keeps `.contains('tags', [tag])`, the **valid** `.is('deleted_at', null)` on `agents`, and `.order('created_at', { ascending: true })`, so the oldest-first guarantee the duplicate-provider rule and the unmarked-lead credit depend on is intact. `select('*')` is an over-fetch, not a semantic change.
2. **`lead_autosend_enabled` null-vs-false is equivalent in all four states.** `getLeadAutosendEnabled` collapses to `data?.lead_autosend_enabled ?? null`, so: no profile row → `null` → silent (old: `profile` falsy → silent); column SQL NULL → `null` → silent (old: `null !== false` → silent); `true` → silent; `false` → `replies_off` in both. A **failed** read also yields `data: null`, so a broken read cannot invent a `replies_off` warning — and it is now logged, which is the right pairing.
3. **The `last_run` cast is the right call for this commit.** It is a narrow structural cast, not `any`, it carries a comment, and it matches the three existing occurrences in `lib/business-os/automations/install.ts:248,1014,1129`. Declaring `last_run?: string | null` on `Agent` would be the better end state (optional property, additive, removes all four casts) but it is a shared-type edit outside this fix's scope — **follow-up, not a condition of approval.**
4. **CLAUDE.md compliance:** rule 1 ✅ (all four reads now go through repositories; `supabaseServer` import removed from the module), rule 3 ✅ (`createLogger`, context-first, `{ err }`; zero `console.*` in either touched file), rule 4 ✅ (every one of the four methods filters `.eq('user_id', userId)`; `userId` originates from `getUser()` in all three routes, never from the request body), rule 6 ✅ (no `any`; the `as const` tuple loop typechecks because all four results expose `error: Error | null`).

### Code Review Comments

1. `lib/business-os/leads/__tests__/theWizardOpensOnWhatIsRunning.test.ts:113-115` — the fixture sets `status: 'connected'`, but production accepts only `'active'` (`inboxChannel.ts:313`, and `PluginConnectionRepository.upsert` writes `'active'`). So the comment "A connected Gmail, so the channel is a real one rather than an orphan" is false: every test in the suite runs with a *disconnected* mailbox, `mailbox_disconnected` is always in `problems`, and `connectable` is always empty. Carried over from the old mock, but the Dev edited this block — **Priority: Low** (recommend `'active'` plus an assertion that `problems` is empty, which makes the connected path actually covered).
2. `lib/repositories/AgentRepository.ts:223` / `inboxChannel.ts:350` — `lastRunAt` and `never_run` now depend on `findByTag` doing `select('*')`, and nothing records that. Narrow that select later and `last_run` becomes `undefined`, so every running channel silently reports `never_run` and the card says "never run". The cast hides it from the compiler. **Priority: Low–Medium** — cheapest guard is one line of comment in `findByTag` naming the dependency, or the `Agent`-type follow-up in ruling 3.
3. `lib/business-os/leads/inboxProviders.ts:8` — comment still says "that module imports `supabaseServer`". Now true only transitively (via the repositories). The sibling comment in `inboxChannel.ts:88` was updated; this one was not. **Priority: Low.**

### Optimisation Suggestions

- `findByTag`'s `select('*')` pulls `pilot_steps`, `workflow_steps`, `generated_plan` and `ai_context` on a path four surfaces hit. Real but small (one or two channel agents per account); a column-narrowed variant would reinstate comment 2's trap, so accepting it is reasonable.
- A failed read still renders a plausible-but-wrong card (`0` leads, `not_connected`). The log is now there for us; the owner still sees a confident number. A `degraded?: boolean` on `InboxChannelStatus` would let a surface say "could not read" — out of scope, worth a follow-up.
- Mocking the whole `@/lib/logger` module gives every module in the graph a logger with no `child()`; `captureEnquiry.ts:316` calls it inside a function, so it is latent only. Fine today.
- `inboxChannel.ts:365` `agent.id as string` is now a redundant cast (`Agent.id` is `string`).
- Pre-existing, out of scope, noted so it is not lost: `lib/business-os/leads/captureEnquiry.ts` still makes six direct `supabaseServer` calls (rule 1).

### Code Approved for QA: Yes

## QA Report

**QA — 2026-11-01**
**Test mode:** full
**Strategy used:** B (integration/unit via Jest) + C (standalone live-schema scripts) + mutation testing. Not E: the suites run, so there was no need to reason from logs. Not D: the change is server-side and has no new UI.
**Focus:** schema, api, security (rule 1 / rule 4), performance
**Skipped:** `e2e` — Playwright is not installed and the four consuming surfaces are unchanged. `npm run test:bos-entitlements` — not required: neither touched file imports from `lib/business-os/entitlements/` (verified by grep), and neither `catalog.ts` nor `tierMatrix.ts` is in the diff.
**Input source:** QA judgment, guided by the trigger message
**Measured against:** worktree `determined-tu-5450e6`, branch `claude/gifted-bouman-eca375` @ `df71761e` (working tree dirty — the change under test), live project `jgccgkyhpwirgknnceoh`.

**Verdict: PASS.** The diagnosis is independently confirmed, the fix is correct, and the guards are load-bearing. Three findings are logged below; **none blocks this change** (B-1 is a latent pre-existing defect that this fix makes reachable, B-2/B-3 are a test-coverage gap and a payload regression). Separately, the bug-class hunt found **live defects of the same class elsewhere**, listed under "Same bug class elsewhere" — all out of scope here and needing their own cycle.

### 1. Diagnosis — independently confirmed

Verified without reference to the Dev's findings, by reading PostgREST's own OpenAPI document (`GET /rest/v1/`) for the whole exposed schema and by replaying the request.

| Claim | Method | Result |
|---|---|---|
| `crm_contacts` has no `deleted_at` | OpenAPI property list + `select=deleted_at&limit=0` | ✅ Absent. `HTTP 400 42703 column crm_contacts.deleted_at does not exist` |
| `agents` is the only `public` table with `deleted_at` | OpenAPI across **all 215 exposed tables** | ✅ `["agents"]` — exactly one |
| `source_metadata` is `jsonb`, so `cs.` was never the problem | OpenAPI `format` + `cs.` probe in isolation | ✅ `"format":"jsonb"`; `source_metadata=cs.{"via":"inbox_channel"}` alone → `HTTP 200` |
| The production request 400s, and only because of that filter | Replayed both shapes | ✅ with `deleted_at=is.null` → **400 / 42703**; identical request without it → **200** |

```
GET crm_contacts?select=source_metadata&user_id=eq.<uuid>&deleted_at=is.null
    &created_at=gte.<30d>&source_metadata=cs.{"via":"inbox_channel"}   -> 400 42703
GET (same, minus deleted_at=is.null)                                   -> 200 []
```

Also confirmed live, so the rewire is not trading one phantom for another:
`agents.last_run` ✅, `agents.deleted_at` ✅, `business_profiles.lead_autosend_enabled` ✅ (boolean, default `false`), `plugin_connections.plugin_name` / `status` / `user_id` ✅.

**Blast radius confirmed.** `inboxChannelStatus` has three server callers (`/api/business-os/leads/inbox/status`, `…/enable`, `…/toggle`) and four client surfaces fetch the status route: `app/business-os/page.tsx`, `app/onboarding-build/page.tsx`, `components/business-os/leads/InboxChannelCard.tsx`, `components/business-os/leads/InboxChannelSetupDialog.tsx`. The "four surfaces" in the Overview is accurate.

### 2. Test Coverage

| Acceptance criterion (Tasks §) | Tested? | Result | Notes |
|---|---|---|---|
| 1. Four inline `supabaseServer` reads replaced with repository calls | ✅ | Pass | `grep -n supabase lib/business-os/leads/inboxChannel.ts` → **no match**; the import is gone. Rule 1 satisfied for all four reads, not just the broken one |
| 1a. Each repository method is a faithful replacement | ✅ | Pass | Read all four. `findByTag` keeps `user_id` + `contains('tags')` + valid `is('deleted_at', null)` + `order('created_at', asc)`; `findByUserAndPlugins` keeps `user_id` + `in(plugin_name)` and guards the empty-list `in.()` case; `getLeadAutosendEnabled` keeps `maybeSingle()`; `findLeadsByVia` keeps `user_id` + `gte(created_at)` + `contains(source_metadata)` and **drops only** the phantom filter. Rule 4 holds on all four |
| 2. Each read's `error` bound and logged | ✅ | Pass | 12 probe cases; all four names appear with `read: '<table>'` and message `Inbox channel read failed`. Four simultaneous failures → exactly 4 log lines, and the function still returns a renderable status |
| 3. `null` vs `false` kept distinct for `lead_autosend_enabled` | ⚠️ | **Pass in code, unguarded in tests** | Behaviour is correct (`null` → no warning, `false` → `replies_off`, failed read → no warning). But no committed test asserts it — see **B-2** |
| 4. Jest guard that the phantom filter cannot come back | ✅ | Pass | Two layers. Caller: the three new tests in `theWizardOpensOnWhatIsRunning.test.ts`. Repository: `ChannelAttributionRepository.findLeadsByVia.test.ts` asserts the **absence** — `expect(calls.is).toEqual([])` — which is the only assertion shape that fails when a tidying reader puts a soft-delete filter back |
| 5. Typecheck the touched files; run the affected suites | ✅ | Pass | See §3 and §4 |
| Function still never throws | ✅ | Pass | All four reads failing at once returns `{channels:[],connectable:[],state:'not_connected',problems:[]}` |
| Two mailboxes tally independently | ✅ | Pass | 2 Gmail + 1 Outlook → `[['google-mail',2],['outlook',1]]` |
| Agent with no `agent_config.inbox_channel.provider` | ✅ | Pass | Skipped, not guessed; `agent_config: null` also handled without throwing |

### 3. Typecheck — and proof the measurement is real

`NODE_OPTIONS="--max-old-space-size=8192" npx tsc --noEmit -p tsconfig.json`, written to a file so the exit code is tsc's and not a pipe's:

```
TSC_EXIT=1
TOTAL_ERROR_LINES=1916          <- the run produced diagnostics; it did not die
no FATAL / "heap limit" / TS2688 in the output
errors matching leads/inboxChannel.ts or theWizardOpensOnWhatIsRunning.test.ts:  NONE
```

The 1916 are the repo's documented pre-existing errors that `next.config.js` ignores. The non-zero count is the point: the earlier "0 errors" the Dev flagged was a dead process (TS2688, `node_modules` absent), and a zero here would have meant the same thing. **Both touched files are clean.**

`(agent as { last_run?: string | null })` is the right call — `last_run` is a live `agents` column (confirmed via OpenAPI) that the shared `Agent` type does not declare, and `automations/install.ts` already reads it with the same cast.

### 4. Suites

```
npx jest lib/business-os/leads lib/repositories lib/business-os/channel-insights
Test Suites: 155 passed, 155 total
Tests:       3473 passed, 3473 total      (91 s)
```
Run twice: once on arrival, once after restoring the tree from the mutation tests. Identical both times — the Dev's figure reproduces exactly.

### 5. Mutation testing — are the guards load-bearing?

Four mutations, each applied to `inboxChannel.ts` alone with the test file untouched. The source was restored from a byte-verified copy after each; see §8.

| # | Mutation | Committed guard suite | Verdict |
|---|---|---|---|
| **M0** | Full revert of the source to `HEAD` | **8 of 8 fail**, including all three new tests | Decisive but diffuse — the whole suite fails because the mocks no longer match the reads |
| **M1** | Reintroduce the disease surgically: `const leadRows = null` (as if the 42703 were swallowed again) | **2 fail** — `tallies the rows the repository returns`, `credits an unmarked lead…`. The third correctly still passes (it expects 0 *with* a log) | ✅ Specific and correct |
| **M2** | Delete the error-logging loop (`if (false && read.error)`) | **1 fail** — `reports a failed read instead of printing its zero as an answer` | ✅ Specific and correct |
| **M3** | Collapse `null` into `false`: `autosendRead.data !== true` | **8 of 8 PASS** | ❌ **Not caught** — see B-2 |

M1 and M2 reproduce the Dev's two checks exactly (2 failures and 1 failure). M3 is new and is the one gap.

### 6. Issues found

#### Bugs

**B-1 — With two channels, every unmarked lead is credited to the oldest one. Pre-existing code; this fix makes it reachable for the first time.** — File: `lib/business-os/leads/inboxChannel.ts` (the `leads:` expression, unchanged by this diff) — Severity: **Low–Medium**

The guard is `seen.size === 1`, evaluated *inside* the per-agent loop rather than against the final channel count. On the first iteration `seen.size` is always 1, whatever the total, so the first (oldest) channel always absorbs the unmarked bucket.

- Steps to reproduce (measured, not reasoned): two channels (`google-mail` oldest, `outlook`), and four lead rows — one marked `google-mail`, one marked `outlook`, one `{via}` with no provider, one with `source_metadata: null`.
- Expected: an unmarked lead cannot be attributed when two channels could have filed it — withhold it from both, or report it separately.
- Actual: `[["google-mail",3],["outlook",1]]`. Both unattributable rows went to Gmail. The total (4) still equals the row count, so nothing is double-counted; the **attribution** is wrong, and an Outlook lead from before provider recording is reported as Gmail's.
- Why it is only now reachable: before this fix `leadRows` was always `null` in production, so `leads` was always `0` and this rule had no observable effect. It becomes live the moment this merges. The code comment ("the only channel that could have filed it") states a premise that is false for two channels.
- Not a merge blocker: single-channel accounts — the overwhelming majority, and the only shape setup produces today — are unaffected, and the fix is a strict improvement over reporting zero.

#### Edge cases / test quality

**B-2 — Task 3 (`null` vs `false`) ships with no guard. A plausible wrong implementation passes the suite 8/8.** — File: `lib/business-os/leads/__tests__/theWizardOpensOnWhatIsRunning.test.ts` — Severity: **Medium** (missing coverage on an explicitly in-scope task; the behaviour itself is correct)

- Reproduction: change `if (autosendRead.data === false)` to `if (autosendRead.data !== true)` and run the suite → **8 passed**.
- What that mutant would do in production: warn `replies_off` at every business with **no profile row**, and at every business whose profile read merely **failed** — turning a read error into a confident false statement about the owner's settings. Exactly the class of silent-wrongness this whole change exists to stop.
- Recommendation: add three cases to the new `describe` — `getLeadAutosendEnabled` returning `null`, `false`, and `{data:null,error:Error}` — asserting `problems` contains `replies_off` only in the middle case. The existing mock already takes a mutable value, so this is a few lines.

**B-3 — `agentRepository.findByTag` uses `select('*')`; the read it replaced asked for 5 columns.** — File: `lib/repositories/AgentRepository.ts:219` (not in this diff) — Severity: **Low** (Performance)

`agents` has **56 columns live, 11 of them jsonb** — including `pilot_steps`, `pilot_steps_original`, `generated_plan`, `workflow_steps`, which carry whole DSL payloads. The old read asked for `id, status, agent_config, tags, last_run`. `/api/business-os/leads/inbox/status` is fetched `cache: 'no-store'` by four surfaces, so this is a hot path. Behaviour is unaffected (a superset), and it is the correct trade for rule 1 today — but a narrow variant (`findByTagSummary`, or a column-list parameter) is worth a follow-up.

**B-4 — The suite's shared fixture uses a `plugin_connections.status` value the table never holds.** — File: same test file, `beforeEach` — Severity: **Low** (pre-existing; test quality)

The fixture is `{ plugin_name: 'google-mail', status: 'connected' }`, commented "A connected Gmail, so the channel is a real one rather than an orphan." Live, `plugin_connections.status` is `active` (31 rows sampled) or `disconnected` (5) — never `connected` — and the code filters `status === 'active'`. So every channel in this suite is in fact `mailbox_disconnected` with an empty `connectable` list, and the comment is the opposite of the truth. Nothing currently asserted depends on it, so the suite is green either way; the cost is that the `mailbox_disconnected` and `connectable` paths are never exercised here and a regression in them would go unnoticed. My probe used `'active'` and the connected/disconnected/connectable paths all behave correctly.

### 7. Same bug class elsewhere — the hunt

**The Dev's scan reproduces.** 93 `from('crm_contacts')` chains in `lib/` + `app/` (90 excluding test files and `archive/`); **exactly one** chain mentions `deleted_at`, at `lib/repositories/CRMContactRepository.ts:~327` — and that is a **false positive**: the word appears in a doc comment ("No `deleted_at` filter: this answers whose it is"), not in a query. So after this fix, **no `crm_contacts` read filters `deleted_at`.** Claim upheld.

**`npm run schema:check`, run against the live DB** (`729 distinct selects` across `3010 files`; tool exit code **1**, captured to a file rather than through a pipe):

```
FAIL — 24 of 729 selects cannot run
```

All 24 are pre-existing and **none** touches `crm_contacts`, `inboxChannel.ts`, or any of the four repositories this change uses — grepped for each by name, zero hits. This change introduces no phantom select and removes the one `schema:check` could never have seen, because the phantom was in a **filter**, not a select.

**Widening beyond the script, in its two documented blind spots.** I wrote two scanners that validate what `schema:check` does not, both against the live PostgREST OpenAPI document:

*(a) Filter and order columns* — 2,604 `.from()` chains, 4,575 filter arguments checked. Three sites name a column their table does not have. One (`scheduling_services.name`) `schema:check` already reports. The other two it structurally cannot:

| Site | Phantom | Why `schema:check` misses it | Live | Impact |
|---|---|---|---|---|
| `lib/services/CapabilityConditionEvaluator.ts:~339` | `user_capability_blocks.user_id`, `.block_id` in `.eq()` | the `select('id, is_active')` is **valid**; only the filters are phantom | both `42703` | **Reachable and silently failing.** Real columns are `user_capability_id` / `building_block_id`. The SELECT error is discarded (`const { data: existing } =`), so `existing` is always null; the code then INSERTs the same phantom keys plus `updated_at` (also absent) and omits both required real columns, so the insert 400s too. `activateBlock` can never succeed. Live caller: `app/api/onboarding/build/route.ts:587` — the onboarding build path, one of this feature's own four surfaces. Note the file already carries a comment about having been bitten by exactly this on `business_profiles.has_website` |
| `lib/services/workflowService.ts:~775` | `workflow_executions.workflow_id` in `.eq()` | the select is `'*'` | `42703` | Low — `getWorkflowExecutions` has **no caller**; dead code. The error is bound and thrown, so it would at least be loud |

*(b) `.insert()` / `.update()` payload keys* — 574 literal payloads parsed. Candidates below are each **confirmed absent live** by a `select=<col>&limit=0` probe returning `42703`. These are write paths, so the failure is a rejected write rather than a wrong number:

| Site | Phantom key(s) |
|---|---|
| `lib/services/CreditService.ts:~70` | `billing_events.credits_delta`, `.description` (and `.metadata` at `~252`) |
| `lib/repositories/AgentRepository.ts:~748` (`duplicateAgent`) | `agents.config` — the very column `inboxChannel.ts`'s own comment warns does not exist |
| `lib/repositories/AgentLogsRepository.ts:~57` | `agent_logs.status_message` |
| `lib/repositories/SLARepository.ts:~306` | `sla_events.agent_id` |
| `lib/memory/MemoryConsolidationScheduler.ts:~139` | `run_memories.metadata` |
| `lib/services/CapabilityConditionEvaluator.ts:~349,~362` | `user_capability_blocks.updated_at`, `user_id`, `block_id` |
| `lib/services/workflowService.ts:~668,~747` | `workflow_executions.workflow_id`, `input_data`, `results`, `steps_completed` (dead code) |

**Honest limits of my scanners, so nobody over-reads the list.** The write scan reports ~15 false positives of one known shape: it sometimes grabs the *options* object of `.upsert(payload, { onConflict })` or `.update(…, { count })` when the payload is a variable rather than a literal — every `onConflict` / `ignoreDuplicates` / `count` "finding" is that artifact and should be ignored. One further false positive was caught by reading the source: `credit_transactions.execution` is `execution_type` **nested inside** the real `metadata` key, mangled by my flattener. Both scanners skip embedded joins, json paths and template literals. The counts are floors, like `schema:check`'s. **All of §7's out-of-scope findings need their own verification pass before anyone acts on them** — they are reported here as leads, not as a remediation list, and belong in `docs/workplans/business-os-phantom-column-remediation.md` per the skill's "when you find something" step 2.

### 8. Tree integrity after the mutation tests

The mutations required editing `inboxChannel.ts` in place. Restoration was verified, not assumed:

```
sha256 before mutations:  9c8a1ca54d07586234d56d3b252c567f5b746e00b603cde664c72adf8e69fd14
sha256 after restore:     9c8a1ca54d07586234d56d3b252c567f5b746e00b603cde664c72adf8e69fd14
grep -rn "QA-M1|QA-M2|QA-M3" lib/ app/   ->  none
git status --short  ->  M …/theWizardOpensOnWhatIsRunning.test.ts
                        M lib/business-os/leads/inboxChannel.ts
                        ?? docs/workplans/inbox-channel-phantom-deleted-at-rewire.md
```

Identical to the state at the start of this QA pass. The temporary probe suite (`__tests__/zzQaEdgeProbe.test.ts`, 12 cases) was deleted; its cases are the ones listed in §2 and are worth re-adding selectively as per B-2. No commit, push or branch was made. Nothing was written to the database: every live check was an OpenAPI read or a `limit=0` select.

### 9. Reconciliation with the SA review

The SA review landed while this pass was running; the two were independent and **do not conflict** anywhere. Points of contact:

| SA item | QA position |
|---|---|
| SA verified the schema claims from `supabase/migrations/` | QA verified them from the **live database** (OpenAPI across all 215 exposed tables, plus a replay of the failing request). Two independent methods, same answer — which is the standard the schema-check skill's Rule 1 and Rule 2 ask for, since migrations state intent and the database states fact |
| SA ruling 2 — null-vs-false is behaviourally equivalent in all four states | ✅ Agreed, and measured the same four states. QA's **B-2** is a different point: the behaviour is right, but **no test holds it there** — the mutant `!== true` passes the suite 8/8 |
| SA comment 1 — the `status: 'connected'` fixture | ✅ Same finding, independently (QA **B-4**). QA adds the live evidence: `plugin_connections.status` is `active`/`disconnected` on the real table, never `connected` |
| SA comment 2 — `lastRunAt` / `never_run` silently depend on `findByTag` doing `select('*')` | ✅ Confirmed, and **worse than noted: nothing tests it.** `grep` across all test files finds **zero** assertions on `never_run` or `lastRunAt` for this feature, and the suite's fixture always supplies `last_run`, so a mocked repository can never expose the trap. Narrowing that select would make every running channel report "never run", invisibly to both the compiler and the suite. QA endorses SA's one-line comment in `findByTag` as the minimum, and prefers the `Agent`-type follow-up |
| SA optimisation — `findByTag`'s `select('*')` is a real but small over-fetch | ✅ Agreed (QA **B-3**), with the live measurement: 56 columns, 11 jsonb. QA also accepts SA's reasoning that narrowing it today would reinstate comment 2's trap — so the type fix should come first |
| SA optimisation — a failed read still renders a confident wrong card; a `degraded` flag would fix it | ✅ Agreed and worth emphasising: QA's probes confirm a four-way read failure returns a status indistinguishable from a healthy quiet account. The logging this change adds closes the gap **for us**, not for the owner |

Nothing in the SA review changes QA's verdict, and nothing QA found contradicts an SA ruling.

### 10. Final status

- [x] **All acceptance criteria pass — ready for commit.** Task 3's behaviour is correct but unguarded (B-2), which is a coverage gap rather than a failed criterion.
- [ ] Issues found — Dev must address before commit

**Recommended follow-ups, none blocking:**

1. **B-2** — add the three `lead_autosend_enabled` cases. Smallest, highest value: it is the one criterion a wrong implementation could pass today.
2. **B-1** — decide the product rule for an unmarked lead when two channels exist, then fix the `seen.size === 1` guard. Worth doing before a two-mailbox account exists.
3. **B-4** — correct the fixture's `status` to `'active'` so the suite exercises a genuinely connected mailbox.
4. **B-3** — a narrow `findByTag` variant for this hot path.
5. **§7** — open a separate cycle for `CapabilityConditionEvaluator.activateBlock`, which is live, reachable from onboarding, and cannot succeed. Record the §7 leads in `business-os-phantom-column-remediation.md`.
6. Consider teaching `scripts/schema-check.ts` to validate **filter** columns too. This bug sat in production for thirty days inside a query whose select was perfectly valid, so the existing gate was structurally incapable of catching it — and the same blind spot is hiding two more live defects today.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-11-01 | Created | Diagnosis of the production 400 and the rewiring plan |
| 2026-11-01 | SA code review | Approved for QA; schema and `last_run` claims re-verified, three low-severity comments, no required fixes |
| 2026-11-01 | Landed after the fact | Shipped as #598 / #599 / #600 and merged to `main`. Task 8 withdrawn (#600 superseded it); F-1 and F-10 handed to Offir by email; F-6 partly addressed by #600. Nine follow-ups (F-2..F-5, F-7..F-9, F-11) remain open |
| 2026-11-01 | QA full pass | PASS. Diagnosis re-confirmed against the live DB (215 tables, only `agents` has `deleted_at`); 155 suites / 3473 tests green; 4 mutations run (3 caught, 1 gap); 12 edge cases probed; bug-class hunt widened to filter columns and write payloads, finding 2 live defects elsewhere. 4 non-blocking findings B-1..B-4 |
