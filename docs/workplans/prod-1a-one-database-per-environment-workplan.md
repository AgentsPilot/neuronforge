# Workplan: PROD-1a, One Database per Environment (A1 + A2)

> **Last Updated**: 2026-11-23

**Developer:** Dev
**Requirement:** Production build-out, Workstream A, items A1 and A2 (the private environments strategy doc, untracked; the approved scope is quoted in section 1)
**Branch:** `fix/prod-1a-one-database-per-environment` (created by RM from `origin/main` at `cf379a2a`; confirmed by Dev with `git branch --show-current` before the first edit)
**Baseline read:** `origin/main` at `cf379a2a` (every file:line below is from that commit, read with `git show` / `git grep`, never from a local checkout)
**Date:** 2026-11-23
**Status:** SA Code Approved, awaiting QA (SA approved the workplan with conditions C-1 to C-10, folded in below; code review in section 15. Not committed)

## Overview

A second Supabase project (production) is about to sit next to the existing one, which becomes development and staging. Two pieces of code assume one database and both fail silently. **A1:** the service-role client in `lib/supabaseAdmin.ts` (and 16 other app/lib read sites) reads `SUPABASE_URL`, while `lib/supabaseServer.ts` and about 99 other files read `NEXT_PUBLIC_SUPABASE_URL`. Two settable variables, one database: if they disagree, some service-role writes land in the other project with RLS bypassed and no error. **A2:** `middleware.ts` hardcodes the development project's ref in the auth cookie name, so against any other project the onboarding gate never finds a session and passes everyone through.

This slice makes `NEXT_PUBLIC_SUPABASE_URL` the only variable any server or browser code reads, derives the auth cookie name from that same variable (never throwing at import), and adds a source guard to an existing gate suite so neither problem can come back. Removing the retired variable from Vercel is a separate, later env change handed to DevOps (section 11). No migration, no schema claim, no LLM call, no entitlements import, no new API route.

---

## Table of Contents

1. [Approved scope (verbatim)](#1-approved-scope-verbatim)
2. [Analysis summary](#2-analysis-summary)
3. [Every reader of SUPABASE_URL](#3-every-reader-of-supabase_url)
4. [The single variable, and the transition order](#4-the-single-variable-and-the-transition-order)
5. [The cookie-name fix (A2)](#5-the-cookie-name-fix-a2)
6. [The guard so this does not come back](#6-the-guard-so-this-does-not-come-back)
7. [Decisions needed from SA](#7-decisions-needed-from-sa)
8. [Files to create / modify](#8-files-to-create--modify)
9. [Task list](#9-task-list)
10. [Test plan](#10-test-plan)
11. [Environment changes (handed to DevOps)](#11-environment-changes-handed-to-devops)
12. [Risks](#12-risks)
13. [Rollback](#13-rollback)
14. [Observed, out of scope](#14-observed-out-of-scope)
15. [SA Review Notes](#15-sa-review-notes)
16. [QA Testing Report](#16-qa-testing-report)
17. [Commit Info](#17-commit-info)
18. [Change History](#change-history)

---

## 1. Approved scope (verbatim)

> **A1** — `supabaseAdmin.ts` reads `SUPABASE_URL`; `supabaseServer.ts` reads `NEXT_PUBLIC_SUPABASE_URL`. Both are service-role. Two settable vars, one database. Set both in production but leave one pointing at staging and **a subset of production writes lands in the staging DB with RLS bypassed** — correct-looking responses, no error. Highest severity in this workstream.
>
> **A2** — Supabase project ref hardcoded in the auth cookie name (`middleware.ts`). Against a different project the cookie is never found and the onboarding gate silently passes everyone through. Fix with `createServerClient` from `@supabase/ssr` or derive the name from the URL; **do not throw at module load** — the middleware matcher covers every path, so a throw is a site-wide outage.

Brief constraints carried into this plan: transition-safe order (code first, env removal later as a separate change); no throw at module load; the guard lives in an existing gate suite and is line-ending-proof; happy path plus at least one failure path per change; env var names only, no values and no project refs in this tracked file.

---

## 2. Analysis summary

| Area | What this slice touches | Facts measured on `origin/main` |
|---|---|---|
| Service-role clients | `lib/supabaseAdmin.ts` (and 13 app routes + 3 lib modules that build their own client) | `lib/supabaseAdmin.ts:4` reads `SUPABASE_URL` and throws at module load when it is unset; `lib/supabaseServer.ts:12` reads `NEXT_PUBLIC_SUPABASE_URL` |
| Middleware | `middleware.ts` onboarding check | `middleware.ts:278` hardcodes the development project's auth cookie name; lines 283-291 only read the chunked form `.0`, `.1`, ... |
| Existing ref helper | `lib/business-os/account-deletion/authCookies.ts` | Already has `supabaseProjectRef()` (derives the ref from `NEXT_PUBLIC_SUPABASE_URL`, returns `null`, never throws). Its only remaining caller is its own test |
| Admin Environment page | `lib/admin/environment/catalogue.ts:232` | Catalogues `SUPABASE_URL` as required in all three environments, and `classifyEnvironment.ts:443` already raises `supabase-url-mismatch` when the two variables disagree |
| CI | `.github/workflows/build.yml:145` | Sets a placeholder `SUPABASE_URL` so `next build` does not die on `supabaseAdmin`'s import-time throw |
| Jest | `tests/plugins/jest-setup.ts:21` | Stubs `SUPABASE_URL` for the same reason |
| Generated catalog | `lib/business-os/catalog/catalog.generated.ts:5,20` | The 2 ref hits are **provenance only**: the header comment and the `source` field, both written by `scripts/generate-business-catalog.ts:245,253` from the host of `NEXT_PUBLIC_SUPABASE_URL`. Nothing reads `PHYSICAL_CATALOG.source` at runtime (checked: `lib/business-os/catalog/index.ts` and both catalog tests read `.tables` only) |
| Other cookie readers | `lib/auth.ts:89`, `lib/client/auth-actions.ts:275`, `lib/server/route-identity.ts` | All project-agnostic: `lib/auth.ts` matches by `includes('auth-token')` for a cache key; sign-out clears by a shape regex (`SESSION_KEY_PATTERN`); identity resolution uses `createServerClient`, which derives the name itself. **None builds the cookie name by hand.** No change needed |

Skills checked: `tenant-isolation-guard` (not engaged: no caller-supplied id, no write logic changes; this slice only changes which variable names the project), `business-os-schema-check` (no column or table claim), `business-os-entitlements` (no import), `bos-llm-call-standards` and `durable-queue-drain` (not engaged). Three files sit in areas with their own skill and receive a **one-token change only**: `lib/agentkit/v6/config/AgentGenerationConfigService.ts` (V6: no pipeline phase is touched; this is the config loader's Supabase address, not IntentContract, CapabilityBinderV2, IntentToIRConverter or ExecutionGraphCompiler), `lib/calibration/calibrationRcaConfig.ts` (calibration config load), and the three `app/api/agent-creation/*` routes (no flow change).

---

## 3. Every reader of SUPABASE_URL

Found with `git grep -n -E '(^|[^_A-Z])SUPABASE_URL' origin/main -- ':!docs' ':!*.md'`, which excludes `NEXT_PUBLIC_SUPABASE_URL`. **58 hit lines in 42 files.** Every one is classified below.

### 3.1 Runtime readers in app/ and lib/ (change: 17 files, 18 read sites)

| # | File:line | Form | Depends on it today? |
|---|---|---|---|
| 1 | `lib/supabaseAdmin.ts:4` (also `:19` in an error message) | `process.env.SUPABASE_URL`, throws when unset | Yes |
| 2 | `app/api/admin/backfill-embeddings/route.ts:10` | module-scope `createClient(process.env.SUPABASE_URL!, …)` | Yes |
| 3 | `app/api/admin/migrate-labels/route.ts:12` | module-scope `createClient` | Yes |
| 4 | `app/api/agent-creation/init-thread/route.ts:28` | module-scope `createClient` | Yes |
| 5 | `app/api/agent-creation/process-message/route.ts:36` | module-scope `createClient` | Yes |
| 6 | `app/api/agent-creation/thread/[id]/route.ts:15` | module-scope `createClient` | Yes |
| 7 | `app/api/agents/[id]/execution-status/route.ts:15` | `const supabaseUrl = process.env.SUPABASE_URL!` | Yes |
| 8 | `app/api/analyze-prompt-clarity/route.ts:40` and `:59` | name in a `required` list, then `createClient` | Yes (2 sites) |
| 9 | `app/api/enhance-prompt/route.ts:17` | module-scope `createClient` | Yes |
| 10 | `app/api/generate-clarification-questions/route.ts:27` | module-scope `createClient` | Yes |
| 11 | `app/api/help-bot-v2/route.ts:20` | module-scope `createClient` | Yes |
| 12 | `app/api/help-bot-v2/feedback/route.ts:9` | module-scope `createClient` | Yes |
| 13 | `app/api/help-bot-v2/search/route.ts:11` | module-scope `createClient` | Yes |
| 14 | `lib/agent-creation/agent-prompt-thread-repository.ts:24` | `createClient` in the repository | Yes |
| 15 | `app/api/analyze-workflow/route.ts:51` | `NEXT_PUBLIC_SUPABASE_URL \|\| SUPABASE_URL` | No (fallback only) |
| 16 | `lib/agentkit/v6/config/AgentGenerationConfigService.ts:52` | `NEXT_PUBLIC_… \|\| SUPABASE_URL` | No (fallback only) |
| 17 | `lib/calibration/calibrationRcaConfig.ts:69` | `NEXT_PUBLIC_… \|\| SUPABASE_URL` | No (fallback only) |

So **14 files really route through `SUPABASE_URL` today**; 3 only fall back to it. No hit in `components/`, `hooks/`, `middleware.ts`, `next.config.js`, `vercel.json` or `.env.example`.

### 3.2 Scripts (change: 4 files, all fallback form)

| File:line | Form |
|---|---|
| `scripts/bos-llm-settings.ts:160` | `NEXT_PUBLIC_… \|\| SUPABASE_URL \|\| ''` |
| `scripts/check-duplicate-executions.ts:5` | `NEXT_PUBLIC_… \|\| SUPABASE_URL!` |
| `scripts/check-token-differences.ts:5` | same |
| `scripts/verify-fix.ts:5` | same |

### 3.3 CI and test config that SET it (change: 2 files)

| File:line | Why it exists | Change |
|---|---|---|
| `.github/workflows/build.yml:145` | placeholder so `supabaseAdmin`'s import-time throw does not kill `next build` | Remove the line. Once nothing reads the variable, a green Build **is the probe** that no import-time reader is left |
| `tests/plugins/jest-setup.ts:21` (and its comment `:14-20`) | stub for the same throw under Jest | Remove the stub and its comment; the gate going green proves the same under Jest |

### 3.4 Files that NAME it but are correct to keep (no reader change)

| File:line | Why it stays |
|---|---|
| `lib/admin/environment/catalogue.ts:232` | The Environment page reports on the variable. Expectation and wording change (D-5), the row stays so the page can still flag it |
| `lib/admin/environment/supabaseProjects.ts:36` | `SUPABASE_URL_ROW_NAMES` feeds the existing mismatch check |
| `lib/admin/environment/classifyEnvironment.ts:53,443` | Uses `SUPABASE_URL_ROW_NAMES` (constant name only) |
| `supabase/functions/run-scheduled-agents/index.ts:6` | A Supabase Edge Function (Deno). There `SUPABASE_URL` is injected by the Supabase platform per project, not set in Vercel, so it is always the function's own project. Out of scope; not scanned by the guard |

### 3.5 Comments that describe the old behaviour (change wording: 3 files)

| File:line | Change |
|---|---|
| `app/api/run-scheduled-agents/route.ts:123` | Comment says `supabaseAdmin` throws unless `SUPABASE_URL` is set; reword to the public address. The lazy import stays (still correct) |
| `lib/business-os/plugins/brokenConnections.ts:60` | Same reword |
| `app/api/admin/__tests__/adminGate.writes.test.ts:123,126` | Same reword; the mock of `@/lib/supabaseAdmin` stays |

### 3.6 Tests (update 6 setters; 4 data-only stay)

| Files | Today | Change |
|---|---|---|
| `app/api/analyze-prompt-clarity/__tests__/auth.test.ts:64`, `app/api/enhance-prompt/__tests__/auth.test.ts:66`, `app/api/generate-clarification-questions/__tests__/auth.test.ts:65`, `app/api/help-bot-v2/__tests__/auth.test.ts:98`, `app/api/help-bot-v2/feedback/__tests__/auth.test.ts:74`, `app/api/plugins/__tests__/no-secret-egress.test.ts:168` | `process.env.SUPABASE_URL = 'https://example.supabase.co'` (all mock `createClient`) | Set `NEXT_PUBLIC_SUPABASE_URL` instead, so the test still names the variable the route reads |
| `app/admin/environment/__tests__/environmentDisplay.test.ts:374`, `lib/admin/environment/__tests__/classifyEnvironment.test.ts:580…`, `lib/admin/environment/__tests__/serialisation.test.ts:90,159,300`, `scripts/__tests__/check-bos-llm-literals.test.ts:138` | The name as test data (an env-page row, a scanner fixture) | None |

### 3.7 False positives (no change)

`scripts/apply-migrations.sh:11-45` assigns a local shell variable from `NEXT_PUBLIC_SUPABASE_URL`; `scripts/test-memory-integration.ts:21-32` declares a local const from `NEXT_PUBLIC_SUPABASE_URL`. Neither reads the retired variable.

**Count check:** 17 (3.1) + 4 (3.2) + 2 (3.3) + 4 (3.4) + 3 (3.5) + 10 (3.6) + 2 (3.7) = **42 files**.

---

## 4. The single variable, and the transition order

### 4.1 Chosen: `NEXT_PUBLIC_SUPABASE_URL`

| Argument | Detail |
|---|---|
| The browser needs it anyway | `lib/supabaseClient.ts` builds the browser client with `createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, …)`. It cannot be removed, so the only way to have one variable is to make it this one |
| It is already the majority | About 99 non-test files under `app/`, `lib/`, `components/`, `hooks/` and `middleware.ts` read it (`supabaseServer`, `supabaseServerAuth`, `lib/auth.ts`, `onboardingVerdict`, every `createServerClient` route), against 17 for `SUPABASE_URL` |
| It is the cookie's source | The browser's auth cookie name is derived by supabase-js from the address the browser client was built with, which is this variable. The middleware fix (section 5) must derive from the same one, or A2 comes back in a new form |
| One value per build | Next inlines `NEXT_PUBLIC_*` into both server and browser bundles at build time, so every reader in a deployment sees one value, fixed for the life of that deployment. That is what we want (a deployment is pinned to one database), and Vercel needs a redeploy for any env change anyway |
| "Public" is not a leak | The project address is already shipped to every browser; the ref is not a secret (as `supabaseProjects.ts` records) |

Rejected: keeping `SUPABASE_URL` as the server's variable. The browser variable cannot go, so that leaves two variables, which is exactly A1.

### 4.2 Transition-safe order

| # | When | What | Why this order |
|---|---|---|---|
| 0 | **On the day of the merge** (DevOps, Read tier; merge blocker, C-3) | Positive evidence that both variables name the same project in every target where either is set, including branch-scoped Preview overrides and any custom environment, and that wherever the retired variable is set the public one is set too (section 11, step 0) | If they disagree anywhere today, merging silently moves 14 files to the other project in that target. This is the one real hazard of the switch. An absent mismatch diagnostic proves nothing (C-3) |
| 1 | This PR | Every reader moves to `NEXT_PUBLIC_SUPABASE_URL`; CI and Jest stop setting the old one; the catalogue marks it optional and retired | Code no longer needs the old variable; it stays set in Vercel and is simply inert. Reverting this PR is safe while it stays set |
| 2 | After deploy (DevOps) | Probe Production (section 11, step 1), with the deployment's commit SHA checked against the merge commit (C-10 b) | Proves the deployed build reads the right variable |
| 2a | After step 2, a short soak (C-10 e) | Let the D-3 behaviour (the unchunked-cookie gate) run in Production before any removal | The removals turn a one-step revert into a two-step one (section 13), so they wait until the new gate behaviour has been seen working |
| 3 | After the soak, separate env change | Remove `SUPABASE_URL` from Preview, then Production, then Development, one scope per step with a redeploy and probe | Removal comes last, when nothing reads it |
| 3a | **Gate (C-4, merge blocker as a plan item)** | Env step 3 (remove the retired variable from **Production**) must be **complete before** Production's `NEXT_PUBLIC_SUPABASE_URL` is pointed at the new production project. Also recorded as a gate in the PROD-1 master doc (TL/BA to add; that doc is untracked and outside this slice) | If production is wired while the retired variable still names the old project, reverting this PR sends the 14 service-role files to the development/staging database with RLS bypassed: A1 recreated by the rollback itself |
| 4 | Next PROD-1 slice (no extra PR) | Flip the catalogue row to forbidden (`X`) so the Environment page flags it as `should-not-be-set` if anyone re-adds it. Tracked as a named item in the PROD-1 master doc (D-5) | Not done now: during steps 1-3 the variable is legitimately still set, and the classifier tests pin the pair rows' exact diagnostics |

### 4.3 A runtime guard for "both set and disagree"

Recommended: **no new runtime guard** (D-2). Reasons:

1. After step 1 nothing reads `SUPABASE_URL`, so a disagreeing leftover value changes nothing. The danger is a *future* reader, and the source guard (section 6) blocks that at PR time.
2. A runtime check has to read the retired variable, which contradicts the source guard's rule, and it needs a home that runs once on a server and cannot take the site down. The natural candidate, `lib/supabaseServer.ts`, is imported by client components (its own header says so), so it cannot pull in the Node logger.
3. The comparison already exists: `classifyEnvironment.ts:443` puts `supabase-url-mismatch` on both rows of the admin Environment page, and step 4 turns a re-added variable into a `should-not-be-set` warning there.

If SA wants a loud log anyway, the smallest form is one `logger.error` in `lib/supabaseAdmin.ts` (server-only, already rewritten in this slice), with that file added to the guard's exemption list. It must log, never throw.

---

## 5. The cookie-name fix (A2)

### 5.1 Approach: derive the name from the configured address, read it the way the library writes it

Rejected: `createServerClient` from `@supabase/ssr` in the middleware. It would derive the name correctly, but `getSession()` can refresh an expired session, which means a network call and `Set-Cookie` writes on the middleware response, on every protected path. That changes the burst behaviour `onboardingVerdict` was built to contain. It is a bigger change than A2 needs.

Chosen:

1. **Move** `supabaseProjectRef()` unchanged from `lib/business-os/account-deletion/authCookies.ts` into a new, edge-safe module `lib/supabaseAuthCookie.ts`, next to the other `lib/supabase*.ts` modules. `authCookies.ts` re-exports it, so its test import does not change. The project then has one derivation of the ref, and the middleware does not import from the account-deletion domain.
2. Add `supabaseAuthStorageKey(url?)`: returns `sb-<ref>-auth-token`, or `null` when the ref is `null`. This is the exact formula supabase-js uses for its default storage key (`node_modules/@supabase/supabase-js/dist/main/SupabaseClient.js:52`). A parity test pins that (section 10).
3. Add `readSessionAccessToken(getCookie, storageKey)`: reassembles the session with `combineChunks` from `@supabase/ssr` (already a dependency at `^0.6.1`, exported from its package index), strips the `base64-` prefix once and decodes with the same package's `stringFromBase64URL` (falling back to plain JSON when the prefix is absent, as the library does), then returns `access_token` or `null`. Malformed JSON still throws to the caller, where the middleware's existing `try/catch` logs it, as today.
4. In `middleware.ts` replace lines 276-301 with: compute the storage key **per request** (no module-scope work, so nothing can throw at import); if it is `null`, log at **error** level and continue; otherwise read the token with `request.cookies.get(name)?.value` and call `onboardingVerdict` as today. `Buffer` and the hand-built chunk regex go.

Using `combineChunks` also fixes a second silent pass in the same lines: `@supabase/ssr` writes the session as a single **unchunked** cookie, `sb-<ref>-auth-token` with no suffix, whenever the encoded value fits in 3180 characters (`node_modules/@supabase/ssr/dist/main/utils/chunker.js:23-28`). Today's loop only looks for `.0`, `.1`, ..., so a user with a small session skips the gate on every project, the development one included. D-3 asks SA to confirm this stays in scope.

Shape of the new module (signatures only; this is what the tests pin):

**File:** `lib/supabaseAuthCookie.ts`

```typescript
export function supabaseProjectRef(url: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL): string | null;
export function supabaseAuthStorageKey(url?: string): string | null;
export function readSessionAccessToken(
  getCookie: (name: string) => string | undefined,
  storageKey: string
): Promise<string | null>;
```

### 5.2 Behaviour

| Case | Today | After this slice |
|---|---|---|
| **Correct project**: deployment and browser both built with project P | Works on the development project only, and only for chunked cookies | Key `sb-P-auth-token` found (chunked or not), verdict runs, un-onboarded users are redirected to `/onboarding-chat` |
| **Different project**: deployment built for project Q (e.g. production) | Middleware looks for the development name, never finds it: **everyone passes, silently** | The browser (built with Q) writes `sb-Q-…`; the middleware derives `sb-Q-…` from the same build-time value: found, gate works |
| Stale cookie from another project on the same host (e.g. a developer who switched `.env.local`) | Found only if it is the development one | Ignored: it is not this project's session. Same as signed out; the page's own auth handles it. Correct, because the configured project would reject that token anyway |
| Unchunked session cookie | Missed: passes silently | Found (D-3) |
| **URL missing**, empty or not a URL | Unaffected by the name (hardcoded), but `onboardingVerdict`'s `createClient` throws, which the catch turns into a pass | No throw at import or per request. `supabaseAuthStorageKey()` returns `null`; the middleware logs `error` (visible in production, unlike the `debug` lines here) and lets the request through |
| Cookie present but malformed | `JSON.parse` throws; caught, logged, request passes | Unchanged |

**How "fail safe, not pass everyone" is met (D-1).** The onboarding gate is a routing step, not an authorisation check; every protected page and route still authenticates on its own. When the name cannot be derived, the address is missing or unparseable, and supabase-js validates the same address with `new URL` when it builds any client. So in that case no browser can sign in, `supabaseServerAuth` cannot build a client, and no session exists for the gate to act on. The deployment is already down for every signed-in feature. The gate can therefore only "pass everyone" when there is nobody signed in to pass. The case that silently passed real, signed-in users (a name derived from the wrong project) is removed by construction, because the name and the browser's cookie now come from the same build-time value. The recommendation is **F1: log at error and continue**, consistent with the existing `'unknown'` verdict policy. The alternative, **F3**, answers `503` on protected paths when the key is `null`. That is louder, but it turns a config fault into a hard outage of pages that are already broken, and the error log plus the Environment page's `required-not-set` on `NEXT_PUBLIC_SUPABASE_URL` already make the fault visible.

---

## 6. The guard so this does not come back

### 6.1 Placement: the existing `lib/__tests__/envConfigHardening.guard.test.ts`

This suite already exists for this purpose ("environment configuration hardening"), runs in the Jest gate (it is not in `.github/ci/jest-quarantine.json`), and already walks `lib/`, `app/` and `components/` (about 5,090 source files) for G-2. The plan:

- Refactor the walk so each file is **read once** in a `beforeAll`, every rule runs in that one pass, and only the hits are kept (C-9 supersedes the earlier "cache the bodies" idea); G-2, G-4 and G-5 assert over the kept hits. The new checks add regex passes over text already in memory, plus `hooks/` (15 files), `scripts/` (478), `tests/` (73) and a few root files. No new suite, so no extra Jest worker start-up. Dev records the suite's wall time before and after in section 16; the target is no measurable growth.
- Names are built from parts (`['SUPABASE', 'URL'].join('_')`), as G-2 already does, so the guard does not match itself.

### 6.2 G-4: no code reads the retired variable

| Item | Rule |
|---|---|
| Scanned | Non-test files under `lib/`, `app/`, `components/`, `hooks/`, `scripts/`; root `middleware.ts` and `next.config.js`; `.github/workflows/*.yml`; `tests/plugins/jest-setup.ts` (a setup file, not a test: it is where a stub would hide a reintroduced import-time reader) |
| Forms caught | `process.env.NAME`; `process.env[ 'NAME' ]` with any quote; the name as a quoted string literal (catches `required` lists and `Deno.env.get`); destructuring from `process.env`; a YAML key `NAME:` in a workflow. Word boundaries keep `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_URL_ROW_NAMES` out |
| Exempt (2 files, with reasons in the test) | `lib/admin/environment/catalogue.ts` and `lib/admin/environment/supabaseProjects.ts`: they name the variable so the Environment page can report it |
| Failure message | Lists file and line, and says to read `NEXT_PUBLIC_SUPABASE_URL` |

### 6.3 G-5: no hardcoded project ref

| Item | Rule |
|---|---|
| Scanned | Everything G-4 scans **plus test files**, because a test that hardcodes a ref goes vacuous when the code stops using it (section 10.3 shows two that would) |
| Known refs | Every key of `SUPABASE_PROJECTS`, imported from `supabaseProjects.ts`. When production's ref is added to the map later, the guard covers it with no edit |
| Shapes | Any 20-character lowercase-alphanumeric label followed by `.supabase.co` or `.supabase.in`, and any `sb-` + 20 such characters + `-auth-token`. Measured on `origin/main`: these shapes hit exactly the 5 known lines and nothing else, so the rule starts clean once this slice lands |
| Exempt (2 files) | `lib/admin/environment/supabaseProjects.ts` (the label map); `lib/business-os/catalog/catalog.generated.ts` (generated provenance, written by the generator from the configured address and never read at runtime; editing it by hand would be overwritten on the next run). The `catalog.generated.ts` exemption is **line-confined** (C-8 e): hits there are allowed only on the `Source` header line and the `"source"` field; a hit on any other line fails |
| Fixtures (C-2) | Every fixture that would match a shape (a 20-character label before `.supabase.co`, an `sb-<20>-auth-token` name, a known ref) is **built from parts** at runtime (`'a'.repeat(20)`, or joined pieces), never written as one literal. That applies to this slice's own tests (10.1, `authCookies.test.ts`, the guard's self-tests), so G-5 is green on landing. Follow-up (not this slice): have the catalog generator write the project label instead of the host, which needs a live regeneration |

### 6.4 Line-ending proof

The CRLF failures came from scans that looked for a literal line feed. These rules never do:

1. No pattern contains a newline, `^` or `$`, or the `m` flag. Boundaries are lookarounds on characters (`(?<![A-Za-z0-9_])`), and whitespace is matched with a whitespace class, which covers carriage returns.
2. Content is normalised once on read (CR LF and lone CR become LF), so line numbers in failure messages agree across platforms.
3. A self-test runs each matcher over a sample in an LF form and a CRLF form and asserts the same hits. Another asserts each forbidden form in 6.2 is caught and each allowed lookalike is not, so the guard cannot pass vacuously.
4. G-2's existing "scanned more than 100 files" floor is kept, and an equivalent floor is added for each new scan set.

### 6.5 Guard details fixed by SA (C-8, C-9)

| # | Rule |
|---|---|
| C-8 a | **No comment stripping.** A quoted retired name inside a comment counts as a hit. The 3.5 rewording therefore describes the variable ("the server-only address variable") without quoting its name |
| C-8 b | Relative paths are normalised to `/` (`split(path.sep).join('/')`) before any exemption or scope comparison, so POSIX exemption strings match on Windows |
| C-8 c | Workflow forms also caught: `secrets.NAME`, `vars.NAME`, `env.NAME`; both `*.yml` and `*.yaml` under `.github/workflows/` are scanned. The walk skips dot-directories, so `.github/workflows` is listed explicitly |
| C-8 d | Allowed-lookalike self-tests include a local `const NAME =` identifier (as in `scripts/test-memory-integration.ts`), `SUPABASE_URL_ROW_NAMES` and `NEXT_PUBLIC_SUPABASE_URL` |
| C-8 e | A self-test asserts each exempt file exists and still has a hit, so a stale exemption fails; `catalog.generated.ts` hits are confined to its two provenance lines |
| C-9 | One pass: each file is read once and every rule (G-2, G-4, G-5) runs in that pass; hits are kept, file bodies are not cached. A byte prefilter skips decoding files that cannot match. Budget: at most +1 s for this suite **measured on CI** (the gate shard's per-suite timing); local Windows numbers are recorded in 9.2 and are not the measure. Over budget: narrow G-5's test-file scan with a prefilter before anything else |

---

## 7. Decisions needed from SA

| # | Decision | Recommendation |
|---|---|---|
| D-1 | When the cookie name cannot be derived (address missing or not a URL): **F1** log at error and continue, or **F3** answer 503 on protected paths | **F1** (argued in 5.2) |
| D-2 | Add a runtime "both set and disagree" log in `lib/supabaseAdmin.ts`? | **No**: rely on the source guard, the existing `supabase-url-mismatch` diagnostic, and the step 4 flip to forbidden (4.3) |
| D-3 | (a) Keep the unchunked-cookie fix in this slice, since it is the same silent pass in the same lines; (b) use `combineChunks` and `stringFromBase64URL` from `@supabase/ssr`, the exact inverse of what writes the cookie, rather than a hand-rolled loop | **Yes to both** |
| D-4 | `console.*` in touched files (section 8.1): 137 calls in 10 files. Convert `lib/supabaseAdmin.ts` (3 calls) in this slice, and the other 9 files in a separate mechanical slice right after, or all in this slice | **Decided by the user (2026-11-23, via TL): split.** PROD-1a converts only the 3 calls in `lib/supabaseAdmin.ts`. The other 134 calls in the 9 files listed in 8.1 stay untouched here and become the follow-up slice **PROD-1a.2** |
| D-5 | Catalogue row for `SUPABASE_URL`: change to optional (`exp('O','O','O')`) with "retired" wording now, and forbidden (`X`) in the next PROD-1 slice | **Yes** (4.2, step 4) |
| D-6 | New module `lib/supabaseAuthCookie.ts`, with `supabaseProjectRef` moved into it and re-exported from `authCookies.ts` (rule 7: confirm it is not a new pattern) | **Yes**: it sits beside `lib/supabaseFetch.ts` and the clients, and reuses the existing helper rather than duplicating it |

---

## 8. Files to create / modify

| File | Action | Reason |
|---|---|---|
| `lib/supabaseAuthCookie.ts` | create | `supabaseProjectRef` (moved), `supabaseAuthStorageKey`, `readSessionAccessToken`. Edge-safe: no Node-only imports |
| `lib/__tests__/supabaseAuthCookie.test.ts` | create | Unit tests and supabase-js parity (10.1) |
| `lib/business-os/account-deletion/authCookies.ts` | modify | Import and re-export `supabaseProjectRef` from the new module; no behaviour change |
| `lib/business-os/account-deletion/__tests__/authCookies.test.ts` | modify | Replace the real development ref constant with a neutral fake ref (G-5) |
| `middleware.ts` | modify | Derived key per request, `readSessionAccessToken`, error log on `null` (section 5) |
| `app/__tests__/middleware.sessionCookie.test.ts` | create | Positive control and the behaviour table (10.2) |
| `app/account-deleted/__tests__/middleware.accountDeleted.test.ts` | modify | Build the cookie from the configured address (10.3) |
| `app/invite/__tests__/middleware.invite.test.ts` | modify | Same |
| `lib/supabaseAdmin.ts` | modify | Read `NEXT_PUBLIC_SUPABASE_URL`; Pino in place of 3 `console.*` (D-4); keep throw-when-missing (existing behaviour for its 6 importers, none is middleware) |
| `lib/__tests__/supabaseAdmin.test.ts` | create | Reads the public address and ignores the retired one; throws when the public address is missing (10.4) |
| The 16 other files in 3.1 (rows 2-17) | modify | One token each: `SUPABASE_URL` to `NEXT_PUBLIC_SUPABASE_URL`; the 3 fallback forms lose the fallback. `analyze-prompt-clarity` changes both sites |
| The 4 scripts in 3.2 | modify | Drop the fallback |
| `.github/workflows/build.yml` | modify | Remove the `SUPABASE_URL` placeholder (line 145) |
| `tests/plugins/jest-setup.ts` | modify | Remove the stub and its comment (lines 13-21) |
| `app/api/run-scheduled-agents/route.ts`, `lib/business-os/plugins/brokenConnections.ts`, `app/api/admin/__tests__/adminGate.writes.test.ts` | modify | Comment wording only (3.5) |
| The 6 auth tests in 3.6 | modify | Set `NEXT_PUBLIC_SUPABASE_URL` instead |
| `lib/admin/environment/catalogue.ts` | modify | Row 232: optional everywhere, "retired, nothing reads it, remove it; while set it must name the same project" (D-5) |
| `lib/__tests__/envConfigHardening.guard.test.ts` | modify | Read-once cache, G-4, G-5, CRLF self-tests (section 6) |
| `docs/SUPABASE_CLIENTS.md` | modify | Lines 123 and 172 name the retired variable as the admin client's; add a Change History row |
| `docs/VERCEL_DEPLOYMENT_SETUP.md` | modify | Drop the `SUPABASE_URL` line (25); replace the concrete ref in line 22 with a `<project-ref>` placeholder (public-repo rule); add a Change History row |
| `tests/helpers/supabaseSessionCookie.ts` | create | (C-7 a) The shared session-cookie writer, on the library's own `stringToBase64URL` and `createChunks` |
| `lib/admin/environment/__tests__/catalogue.test.ts` | modify | (C-1, R-9) K-6's `consumedBy` list gains the retired row |
| `docs/HELP_BOT_FEATURES_SUMMARY.md`, `docs/HOW_GROQ_HELPBOT_WORKS.md` | modify | (SA check 5) One line each: the example env block names `NEXT_PUBLIC_SUPABASE_URL`. Neither has a Change History |

### 8.1 `console.*` in files this slice touches (CLAUDE.md § Logging: flagged, conversion proposed)

| File | `console.*` lines |
|---|---|
| `lib/supabaseAdmin.ts` | 3 |
| `app/api/admin/backfill-embeddings/route.ts` | 6 |
| `app/api/admin/migrate-labels/route.ts` | 6 |
| `app/api/agents/[id]/execution-status/route.ts` | 7 |
| `app/api/analyze-prompt-clarity/route.ts` | 51 |
| `app/api/enhance-prompt/route.ts` | 23 |
| `app/api/generate-clarification-questions/route.ts` | 22 |
| `app/api/help-bot-v2/feedback/route.ts` | 4 |
| `app/api/help-bot-v2/search/route.ts` | 9 |
| `lib/agentkit/v6/config/AgentGenerationConfigService.ts` | 6 |
| **Total** | **137 in 10 files** |

The other touched app/lib files have none (`init-thread`, `process-message`, `thread/[id]`, `analyze-workflow`, `help-bot-v2/route.ts`, `agent-prompt-thread-repository.ts`, `calibrationRcaConfig.ts`, `middleware.ts`, `catalogue.ts`, `authCookies.ts`, `run-scheduled-agents/route.ts`, `brokenConnections.ts`). Scripts are outside the rule's scope (`lib/`, `app/`, `components/`). Proposal: D-4.

### 8.2 Debt noticed, not extended

The 13 app routes and `AgentGenerationConfigService` build their own service-role clients with `createClient` instead of going through `lib/repositories/` (CLAUDE.md rule 1). This slice changes only the variable they read; it does not move them. A later slice could route them through `supabaseServer`, which would also leave one service-role construction site.

---

## 9. Task list

- 🟡 0. (branch ✅ confirmed by Dev; DevOps step 0 still owed) RM creates `fix/prod-1a-one-database-per-environment` from `origin/main`; Dev confirms with `git branch --show-current` before the first edit. DevOps runs section 11 step 0 (read-only) and reports the result before merge.
- ✅ 1. Create `lib/supabaseAuthCookie.ts` (move `supabaseProjectRef`, add `supabaseAuthStorageKey`, `readSessionAccessToken`); re-export from `authCookies.ts`; neutral fake ref in `authCookies.test.ts`.
- ✅ 2. `lib/__tests__/supabaseAuthCookie.test.ts` (10.1), including supabase-js parity.
- ✅ 3. `middleware.ts`: per-request derived key, library reassembly, error log on `null` (D-1, D-3).
- ✅ 4. `app/__tests__/middleware.sessionCookie.test.ts` (10.2); update the two existing middleware tests (10.3).
- ✅ 5. `lib/supabaseAdmin.ts` to the public address, with Pino (D-4); `lib/__tests__/supabaseAdmin.test.ts` (10.4).
- ✅ 6. The 16 one-token reader changes (3.1 rows 2-17) and the 4 scripts (3.2).
- ✅ 7. Comment rewording (3.5); the 6 auth tests (3.6).
- ✅ 8. Remove the placeholder from `build.yml` and the stub from `tests/plugins/jest-setup.ts`.
- ✅ 9. Catalogue row (D-5); run the Environment page suites (`lib/admin/environment/__tests__`, `app/admin/environment/__tests__`).
- ✅ 10. Guard: read-once refactor, G-4, G-5, CRLF self-tests; record wall time before and after.
- ✅ 11. Docs: `SUPABASE_CLIENTS.md`, `VERCEL_DEPLOYMENT_SETUP.md`.
- 🟡 12. (partial: typecheck, lint:hooks and the touched suites done, see 9.2; `npm run build`, `npm run test:gate` and the R-6 bundle size not run by Dev) Ship drill step 1: `npm run build` succeeds and the typecheck is clean for every touched file (filtered to those files, and the command checked for an OOM crash); `npm run lint:hooks`; the touched suites, then `npm run test:gate`. Record the middleware bundle size before and after from the build output (R-6).
- ✅ 13. A final `git grep` on the branch for the retired variable and the development ref, to confirm the only hits are the exempt files in 3.4 and 6.3 and the docs history.

### 9.1 SA conditions folded in

| Condition | Task | Where it lives | Owner |
|---|---|---|---|
| C-1 `consumedBy` on the retired row; run `catalogueDrift.guard.test.ts` | 9 | `lib/admin/environment/catalogue.ts` (the retired row) | Dev |
| C-2 fixtures built from parts | 1, 2, 4, 10 | 6.3 "Fixtures"; every new or changed test | Dev |
| C-3 step 0 with positive evidence, on the merge day | 0 | 11 step 0; 4.2 row 0 | DevOps (merge blocker) |
| C-4 env step 3 before production is wired | 0 | 4.2 row 3a; 11 step 3; 13 | DevOps / user / TL (merge blocker; also a gate in the PROD-1 master doc) |
| C-5 who D-3 newly gates | 0 | 12 R-10, R-11 (**measured 2026-11-23, closed**) | TL (measured) |
| C-6 null-means-createClient-throws property; gap closed | 1, 2 | 10.1; `lib/supabaseAuthCookie.ts` (`supabaseProjectRef` now uses supabase-js's own formula) | Dev |
| C-7 shared cookie writer; in-file positive controls; extra 10.2 cases | 4 | 10.2, 10.3; `tests/helpers/supabaseSessionCookie.ts` | Dev |
| C-8 guard details | 10 | 6.5; `lib/__tests__/envConfigHardening.guard.test.ts` | Dev |
| C-9 one pass; +1 s budget on CI | 10 | 6.5; local numbers in 9.2; CI number owed in 16 | Dev (local), QA/RM (CI timing) |
| C-10 env probes; rollback row | 11 | 11 steps 1 and 2; 13 | Dev (written), DevOps (executes) |

Extra tasks from SA's "Adjusted items" and check 5:

- ✅ 14. (C-7) Shared session-cookie writer test helper built on the library's own `stringToBase64URL` and `createChunks`, used by 10.2 and both 10.3 files; an in-file positive control in each 10.3 file.
- ✅ 15. (Check 5) Docs: `docs/HELP_BOT_FEATURES_SUMMARY.md` and `docs/HOW_GROQ_HELPBOT_WORKS.md`, one line each.
- ✅ 16. (C-6) Property test: whenever the helper returns null, supabase-js `createClient` throws; plus the converse (whenever it returns a ref, `createClient` builds and its storage key equals ours).
- ✅ 17. (D-4, user decision) Convert only the 3 `console.*` calls in `lib/supabaseAdmin.ts`. The 134 calls in the other 9 files of 8.1 are **out of this slice**: follow-up slice PROD-1a.2 (not started; TL to schedule).

### 9.2 Implementation notes and verification output (Dev, 2026-11-23)

**Design notes**

| Item | What was done |
|---|---|
| C-6 gap | Closed by aligning `supabaseProjectRef` itself with supabase-js `validateSupabaseUrl` (trim, http(s) only, trailing slash, first hostname label), so there is still exactly one derivation. `authCookies.ts` re-exports it; its `authCookiePattern` already regex-escapes the ref, so an unusual label is safe there |
| D-6 | `lib/supabaseAuthCookie.ts` imports only `@supabase/ssr`; reads the address as the literal `process.env.NEXT_PUBLIC_SUPABASE_URL` in a default parameter, evaluated per call; nothing runs at import |
| A1 | `lib/supabaseAdmin.ts` reads the public address; its 3 `console.*` calls became Pino (`createLogger({ module: 'supabaseAdmin' })`), and the old error log that printed the address value now logs presence booleans only |
| C-1 | Retired row: `OPTIONAL` plus `consumedBy: { by: 'environment-page', … }`. `catalogueDrift.guard.test.ts` passes; `catalogue.test.ts` K-6 updated (R-9) |
| C-8 a | Comment policy applied: the reworded comments in `run-scheduled-agents/route.ts`, `brokenConnections.ts`, `adminGate.writes.test.ts` and `jest-setup.ts` describe the variable without quoting its name |
| Guard scope note | G-4's "key" form (`NAME:`) applies to every scanned file, not only workflows, so an object key handing the retired name to a child process is also caught. Measured clean on the branch |

**Tests (local, Windows).** `npx jest` over every added or changed suite plus the middleware, account-deletion, invite, environment-catalogue, envConfigHardening, security, stripe-webhook, repository-lockdown, run-scheduled-agents, business-os plugins and catalog suites:

(Windows printed the three route paths with backslashes; shown here with `/`, because Tailwind scans `docs/` and a backslash before a hex character breaks `next build`.)

```text
FAIL lib/security/__tests__/publicEndpointsAreThrottled.guard.test.ts (6.851 s)
Test Suites: 1 failed, 66 passed, 67 total
Tests:       3 failed, 29 skipped, 2139 passed, 2171 total
Time:        63.069 s
  ● the unauthenticated surface › app/api/book/manage/[token]/calendar/route.ts is throttled, or named as deliberately open
  ● the unauthenticated surface › app/api/public/consent-copy/route.ts is throttled, or named as deliberately open
  ● the unauthenticated surface › app/api/public/invoice/[id]/pay/route.ts is throttled, or named as deliberately open
```

The one failing suite is not touched by this slice (`git diff cf379a2a -- lib/security app/api/book app/api/public` is empty). It builds its list with `path.relative(process.cwd(), f)`, so on Windows the paths carry backslashes and miss its POSIX allow-list. Recorded in section 14.

**Typecheck.** `NODE_OPTIONS=--max-old-space-size=12288 npx tsc --noEmit -p tsconfig.json`, full project, filtered to the touched files. First run: exit 2 after 532 s, 1850 diagnostics, no heap or FATAL lines (tsc completed; it did not run out of memory). It found 2 real errors in `lib/__tests__/supabaseAdmin.test.ts` (a script-scope `load` colliding with another test's global), fixed with `export {}`. Second run: exit 2 after 117 s, **1848** diagnostics, no out-of-memory lines. Touched-file diagnostics left, all from before this slice:

```text
app/api/help-bot-v2/route.ts(512,5): error TS2322: ... is not assignable to type 'null'.
app/api/help-bot-v2/route.ts(564,24): error TS18047: 'systemPromptTemplate' is possibly 'null'.
app/invite/__tests__/middleware.invite.test.ts(77,17): error TS2540: Cannot assign to 'NODE_ENV' because it is a read-only property.
app/invite/__tests__/middleware.invite.test.ts(89,19): error TS2540: Cannot assign to 'NODE_ENV' because it is a read-only property.
```

The only change to `help-bot-v2/route.ts` is line 20. The two `NODE_ENV` assignments exist at `cf379a2a` (lines 66 and 78 there; this slice added 11 lines above them).

**Lint.** `npm run lint:hooks`: exit 0. `npx eslint` on the new and heavily changed files: clean (one unused-argument warning in `supabaseAdmin.test.ts` was fixed).

**The tests can fail.** Each probe is a temporary change, restored byte-exact and checked with `cmp`.

| Probe | Result |
|---|---|
| G-4: appended `export const probeAddress = process.env.<retired name>;` to `app/api/help-bot-v2/search/route.ts` | `× G-4 …` with `+   "app/api/help-bot-v2/search/route.ts:135"`; `Tests: 1 failed, 30 passed, 31 total`. Restored: `RESTORED-BYTE-EXACT` |
| G-4: re-added the CI placeholder to `.github/workflows/build.yml` | `× G-4 …` with `+   ".github/workflows/build.yml:145"`. Restored byte-exact |
| G-5: appended a cookie-name constant holding the known development ref to `lib/supabaseFetch.ts` | `× G-5 …` with `+   "lib/supabaseFetch.ts:242"`; `Tests: 1 failed, 30 passed, 31 total`. Restored byte-exact |
| G-5: appended a comment with a new 20-character hosted address to a test file (`lib/__tests__/supabaseFetch.test.ts`) | `× G-5 …` with `+   "lib/__tests__/supabaseFetch.test.ts:183"`. Restored byte-exact |
| C-6: swapped the previous `supabaseProjectRef` back in | `Tests: 5 failed, 25 passed, 30 total`: the IPv6 loopback, the underscore host, the non-http scheme (property and failure-path cases) and the "names the two hosts" case. Restored byte-exact |
| 10.2: ran `middleware.sessionCookie.test.ts` against the `cf379a2a` middleware | `Tests: 7 failed, 2 passed, 9 total` (both positive controls red). Restored byte-exact |
| 10.4: ran `supabaseAdmin.test.ts` against the `cf379a2a` module | `Tests: 3 failed, 3 total`. Restored byte-exact |

**Guard suite runtime, LOCAL.** Measured on Windows, so this is not the C-9 measure; the CI per-suite timing is owed in section 16. Jest-reported suite time, 3 runs each:

| | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| Before (`cf379a2a`, 3 tests) | 6.201 s | 4.641 s | 4.478 s |
| After (31 tests, one-pass scan of lib, app, components, hooks, scripts, tests, root files, workflows) | 5.347 s | 5.100 s | 5.974 s |

Local medians: 4.641 s before, 5.347 s after (+0.7 s). Local run-to-run noise is larger than the difference.

**Final grep (task 13).** Outside `docs/` and `*.md`, the development ref appears only in `lib/admin/environment/supabaseProjects.ts:39` and the two provenance lines of `catalog.generated.ts` (5, 20). Outside tests, the retired name is read nowhere. The remaining hits are the 3.4 and 3.7 files (`catalogue.ts`, `supabaseProjects.ts`, `scripts/apply-migrations.sh`, `scripts/test-memory-integration.ts`, the Supabase Edge Function).

**Not done by Dev (task 12):** `npm run build`, `npm run test:gate`, and the R-6 middleware bundle size before and after. The Build job on the PR is the probe that no import-time reader is left now that the placeholder is gone.

---

## 10. Test plan

### 10.1 `lib/__tests__/supabaseAuthCookie.test.ts`

| Case | Expectation |
|---|---|
| Hosted address `https://<20 letters>.supabase.co` | key is `sb-<those letters>-auth-token` |
| Custom domain, local `http://127.0.0.1:54321` | key follows the first host label, as supabase-js does |
| `undefined`, `''`, `'not a url'` | `null`, no throw (failure path) |
| **Parity**: for 3 addresses, compare with the storage key a real supabase-js client builds (`createClient(url, 'k', { auth: { persistSession: false, autoRefreshToken: false } })`, read through a typed cast with a comment) | equal. Fails if a supabase-js upgrade changes the derivation (R-4). Construction makes no connection; `tests/jest-no-network.ts` would refuse one |
| `readSessionAccessToken`: unchunked, chunked `.0` + `.1`, `base64-` prefix, plain JSON | the access token |
| No cookie, or JSON without `access_token` | `null` |
| Malformed base64 / JSON | throws (the caller's catch is the existing contract) |
| **C-6 property, both ways**, over `undefined`, `''`, whitespace, `'not a url'`, a non-http scheme, `http://` alone, `http://[::1]:54321`, an underscore host, hosted (built from parts), padded and upper-case hosted, a custom domain, `127.0.0.1` and `localhost` | whenever the helper returns null, supabase-js `createClient` throws; whenever it returns a key, `createClient` builds and its `storageKey` is the same. **Shown to fail with the previous helper** (5 cases red, 9.2) |
| Both unchunked and chunked present; a lone `-code-verifier` cookie; another project's name; a non-string token | unchunked wins; `null`; `null`; `null` |

All fixtures are written by the shared helper `tests/helpers/supabaseSessionCookie.ts` (C-7 a), which uses the library's own `stringToBase64URL` and `createChunks`.

### 10.2 `app/__tests__/middleware.sessionCookie.test.ts`

`onboardingVerdict` is mocked (it is the seam to Supabase); the protected path is one not on the skip list, such as `/v2/dashboard`; the cookie name is built from `process.env.NEXT_PUBLIC_SUPABASE_URL` (stubbed by `tests/plugins/jest-setup.ts`).

| Case | Expectation |
|---|---|
| **Positive control**: chunked cookie under the derived name, verdict `'onboard'` | redirect to `/onboarding-chat`, verdict called with the token. Without this case every other "not called" assertion could pass vacuously |
| Unchunked cookie, verdict `'onboard'` | redirect (D-3) |
| Verdict `'ok'` | passes through |
| Cookie under a different project's name | verdict not called, passes through |
| `NEXT_PUBLIC_SUPABASE_URL` unset, module required inside `jest.isolateModules` | **import does not throw**; a request passes through; verdict not called; one error-level line is emitted (the edge logger writes through `console.error`, which the test spies on) |
| `NEXT_PUBLIC_SUPABASE_URL` set to `'not a url'` | same as unset |
| (C-7) Both unchunked and chunked present | the unchunked token is passed to the verdict |
| (C-7) A lone `-code-verifier` cookie | not read as a session; verdict not called |
| (C-7) A session large enough that `createChunks` splits it | asserted to split (more than one cookie), then redirected (the chunked positive control) |
| (C-7) A malformed cookie on a protected path | passes through with exactly one error line, the catch's `Onboarding check failed; allowing the request through` |

### 10.3 The two existing middleware tests

`app/account-deleted/__tests__/middleware.accountDeleted.test.ts:18` and `app/invite/__tests__/middleware.invite.test.ts:22` build the cookie with the development project's literal name and assert `createClient` is **not** called, meaning the onboarding check was skipped. After the fix, under Jest the derived name follows the setup stub, so the literal cookie would never be read: the tests would stay green **vacuously**, and would still pass if `/account-deleted` or `/invite` fell off the skip list. Both are updated to build the name from `supabaseAuthStorageKey()`, which restores their meaning ("a cookie that *would* be read is present, and still the check is skipped").

**C-7 b (in-file positive controls).** The 10.2 control proves reachability only in its own file, behind a different seam. So each 10.3 file builds its cookie with the shared writer and carries its own control: the same cookie on `/v2/dashboard` **does** call the mocked `createClient`. `middleware.accountDeleted.test.ts` gains an `afterEach` with `mockClear` (it had none).

### 10.4 `lib/__tests__/supabaseAdmin.test.ts`

`@supabase/supabase-js` is mocked; each case uses `jest.isolateModules`.

| Case | Expectation |
|---|---|
| Public address set, retired variable set to a **different** project | `createClient` receives the public address. This is A1's failure mode, pinned |
| Public address set, retired variable unset | imports and builds the client |
| Public address unset | throws, as today (failure path; unchanged contract for its importers) |

### 10.5 Guard and CI

| Check | Expectation |
|---|---|
| G-4, G-5 on the branch | pass; their self-tests prove each forbidden form is caught in LF and CRLF |
| G-4 negative check (manual, recorded in 16) | temporarily re-adding `process.env.SUPABASE_URL` to any route makes G-4 fail with that file and line; reverted |
| Build job with the placeholder removed | green, proving no import-time reader is left |
| Jest gate with the stub removed | green; the Environment page suites green with the catalogue change |
| Route auth tests (3.6) | green, now setting the variable the route reads |

---

## 11. Environment changes (handed to DevOps)

Done by DevOps, or by the user where the tier says so, following `env-change-protocol`. Names and roles only. The concrete record (scopes found, deployment ids, timestamps) goes in the untracked private docs, with a by-role summary here.

### Step 0: confirm the two variables agree today

| Field | Value |
|---|---|
| What | Positive evidence that, in every Vercel target where either `NEXT_PUBLIC_SUPABASE_URL` or `SUPABASE_URL` is set, both are set and both name the same project (C-3) |
| Where (by role) | The web project: Production, Preview (the generic scope **and every branch-scoped Preview override**), any **custom environment**, and Development |
| Tier | Read |
| When | **On the day of the merge**, not earlier (C-3 c). Merge blocker |
| Before-state | Which targets hold each variable: names, targets and git-branch scoping only, never values |
| Exact action | (1) List env var names and targets for the web project, including branch-scoped Preview entries and custom environments (C-3 a). (2) For every target where the retired variable is set, confirm the public one is set **in the same target** (C-3 b). (3) Open the admin Environment page on the Production deployment and on a current Preview deployment of each branch override found, and read the two Supabase address rows |
| How to undo | Nothing to undo (read only) |
| Probe | Passes **only** when, on each deployment checked, **both rows are shown, and both carry the same project label**. Today `SUPABASE_PROJECTS` has exactly one entry, so an unlabelled row fails the check. An absent `supabase-url-mismatch` diagnostic is **not** evidence: the pair check only runs when both rows are shown, so a hidden, masked or mis-shaped row produces no diagnostic (C-3). Development is a developer pull, not a deployment, and only one project exists, so a lighter check is acceptable there (that both names are listed in the Development target), provided it needs no secret in hand. Do **not** `vercel env pull` secrets just to compare |
| Evidence | (DevOps fills: targets by role, both labels per deployment, date checked) |
| Executed by | DO |

If any target disagrees, has an unlabelled row, or holds the retired variable without the public one: **stop**, do not merge; report to TL. Merging would move 14 files to the other project, or to no project, in that target.

### Step 1: probe Production after the deploy

| Field | Value |
|---|---|
| What | Prove the deployed build reads the public address everywhere and the onboarding gate is live |
| Where (by role) | The Production deployment of the web project |
| Tier | Read |
| When | After merge and deploy, before any removal |
| Exact action | (0) Record the deployment's commit SHA and check it **equals the merge commit** (C-10 b). (a) as an admin, `GET /api/admin/execution-tiers` (imports `supabaseAdmin`, reads `ais_system_config` with the service role). (a′) **No-session alternative, usable on Preview too (C-10 c):** an **unauthenticated** `GET /api/admin/execution-tiers` must answer the admin gate's `401`/`403`; a `500` means the module threw at import. That proves the module loaded; the Environment page's project label on the public address row proves which project it reads. (b) Vercel runtime logs since the deploy time, searched for the exact strings below. (c) with a test account whose onboarding is **not** complete, open a protected page |
| Exact strings in the merged code (C-10 a) | `lib/supabaseAdmin.ts` log: `Missing Supabase environment variables for the admin client`; its thrown error: `Missing Supabase environment variables. URL: <bool>, ServiceKey: <bool>` (both contain `Missing Supabase environment variables`, so that substring still finds either). `middleware.ts` edge log: `Session cookie name cannot be derived: the public Supabase address is missing or invalid; skipping the onboarding check`. Also watch `Onboarding check failed; allowing the request through` (the middleware's catch, unchanged) |
| How to undo | Not a change |
| Probe | (0) SHA matches; (a) answers `success: true` with rows only when the admin client was built; (a′) `401`/`403`, never `500`; (b) zero lines of each "Missing" and "cannot be derived" string, timestamped after the deploy; (c) **must redirect to `/onboarding-chat`**. An onboarded account loading normally proves nothing, because that is what "passes everyone" looks like. Note: (c) needs a manual sign-in; under the standing "no click-through asks" preference TL decides who runs it, or accepts the 10.2 positive control plus (a) and (b) |
| Evidence | (DevOps fills) |
| Executed by | DO (0, a, a′, b); TL decides for (c) |

### Step 2: remove `SUPABASE_URL` from Preview

| Field | Value |
|---|---|
| What | Delete `SUPABASE_URL` from the Preview scope only |
| Where (by role) | Preview environment of the web project |
| Tier | Reversible write (Preview-only); applied only with the user's quoted approval |
| When | After deploy, once step 1 has passed **and** the D-3 behaviour has run in Production for a short soak (C-10 e). The removals turn a one-step revert into a two-step one (section 13) |
| Before-state | Targets the variable holds (names only) |
| Exact action | Vercel project settings, Environment Variables, `SUPABASE_URL`: remove the Preview target; trigger a Preview redeploy of `main` |
| How to undo | Re-add `SUPABASE_URL` to Preview with the same value as that scope's `NEXT_PUBLIC_SUPABASE_URL`; redeploy |
| Probe | The Preview build succeeds (a remaining import-time reader would throw while collecting page data); step 1 (0), (a′) and (b) on that Preview deployment; the Environment page there shows the row unset with no `required-not-set` (the D-5 catalogue change) |
| Executed by | DO |

### Step 3: remove `SUPABASE_URL` from Production

As step 2, for the Production scope. **Tier: Production. The user executes**; SA reviewed this plan (section 15); a Production redeploy follows; the probe is step 1 (0), (a) or (a′), and (b) on the new Production deployment plus the Environment page row. Undo: re-add with the Production `NEXT_PUBLIC_SUPABASE_URL` value and redeploy.

**Ordering gate (C-4).** This step must be **complete before** Production's `NEXT_PUBLIC_SUPABASE_URL` is pointed at the new production project. While the retired variable still names the old project, reverting this PR would send the 14 service-role files to the development/staging database with RLS bypassed. Whoever wires the production project (the PROD-1 cutover slice) checks this step's evidence first. TL/BA to record the same gate in the PROD-1 master doc.

### Step 4: remove `SUPABASE_URL` from Development

As step 2, for the Development scope (pulled by `vercel env pull`). Developers may also drop it from their own `.env.local`; it is inert either way.

---

## 12. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | The two variables disagree in some scope today, so the switch moves 14 files to the other project there | Step 0 is a merge blocker |
| R-2 | `NEXT_PUBLIC_*` is inlined at build. A Preview build promoted to Production would carry the Preview (staging) address | Not introduced here (the browser has always worked this way), but it matters once production exists. DevOps to confirm, before the production project is wired, that a promote rebuilds with Production values, or to forbid promote-from-Preview. Flagged for the next PROD-1 slice |
| R-3 | Tests that hardcode a ref go vacuous | 10.3 updates, the 10.2 positive control, and G-5 including test files |
| R-4 | A supabase-js or `@supabase/ssr` upgrade changes the cookie key or chunking | Parity test (10.1); `combineChunks` comes from the same package that writes the cookie |
| R-5 | Guard false positives on future fixtures | Two short exemption lists with reasons in the test; shapes measured clean on `origin/main` |
| R-6 | Importing `@supabase/ssr` grows the edge middleware bundle | The middleware already pulls in supabase-js through `onboardingVerdict`; size recorded before and after (task 12); SA to judge any material growth |
| R-7 | Reverting this PR after step 3 breaks 14 files (and `supabaseAdmin` throws at import) | Rollback order in section 13 |
| R-8 | The `console.*` conversion grows the slice past the launch window | D-4 split |
| R-9 | Environment page tests pin the old `required` expectation | Task 9 runs those suites; adjust only expectations that name this row, with a reason. Outcome: one expectation changed, `catalogue.test.ts` K-6 (the list of `consumedBy` entries now includes the retired row, C-1) |
| R-10 | (C-5) D-3 newly gates small (unchunked) sessions: users with no `business_profiles` row, or `onboarding_completed` false, are redirected to `/onboarding-chat` on their next protected navigation. `/admin` is not on the skip list, so un-onboarded platform admins would be sent away from the admin console | **Measured and closed** (read-only count on the current project, 2026-11-23, by role, no ids): 16 users; 8 the gate would now send to onboarding (all 8 have no profile row); 1 of those signed in during the last 30 days; 2 admins, **0 admins affected**. No `/admin` exemption and no BA/SA decision needed. TL tells the user about the redirect for the newly gated population |
| R-11 | (C-5) Onboarded users with a small session now pay the verdict lookup (`auth.getUser`, measured at 1.58 s, plus a profile read) once per token per instance per 60 s, where before they paid nothing | Bounded by `onboardingVerdict`'s cache and in-flight sharing; the population is the same 16 users today. TL tells the user before the merge |

---

## 13. Rollback

| Situation | Steps |
|---|---|
| Before env step 2 (variable still set everywhere) | Revert the PR. Every old reader finds the variable it expects; nothing else to do |
| After step 2, 3 or 4 | **First** re-add `SUPABASE_URL` to each scope it was removed from, with the same value as that scope's `NEXT_PUBLIC_SUPABASE_URL`. **Then** revert the PR; the reverted build must be created after the variable is back (the revert's own deploy picks it up, so a redeploy in between is harmless but not needed). In the reverse order, `supabaseAdmin` throws at import and the other 13 dependent files get an undefined address |
| Middleware only misbehaves (C-10 d) | **Not** a hand-revert of the middleware hunk: that brings back the hardcoded ref, which fails G-5 and the 10.2/10.3 tests, so it is not a clean hotfix. While the retired variable is still set (before step 2), the rollback is to **revert the whole PR** |
| Fast path (DO to confirm) | Vercel Instant Rollback to a pre-merge deployment keeps that deployment's own env snapshot, so it does not depend on the env steps. DO confirms this and records it |
| **After production is wired (C-4)** | A revert of this PR, or an Instant Rollback across the cutover, would send service-role traffic to whatever the retired variable names. That is why env step 3 must be complete before production is wired. Corollary for PROD-1: **never Instant Rollback across the production cutover** |

---

## 14. Observed, out of scope

| Observation | Where | Note |
|---|---|---|
| Two service-role clients with different auth options | `lib/supabaseAdmin.ts`, `lib/supabaseServer.ts` | After this slice they read the same address; merging them is a separate refactor |
| Session-context capture reads cookie names the current auth library never writes | `lib/services/AuditTrailService.ts:274-275` | Not about project routing; candidate for a later fix |
| Legacy localStorage key lookup | `lib/client/agent-api.ts:78` | Same |
| Edge Function reads the Supabase-provided variable | `supabase/functions/run-scheduled-agents/index.ts:6` | Correct for its runtime |
| Public-repo-rule debt: the development ref in docs | `MIGRATION_GUIDE.md` and many historical workplans | Out of scope (SA check 5); this slice only placeholders `docs/VERCEL_DEPLOYMENT_SETUP.md` |
| The catalog generator writes the host, not the label | `scripts/generate-business-catalog.ts` → `catalog.generated.ts` | Follow-up (C-8 e): write the project label instead; needs a live regeneration |
| A pre-existing guard fails on Windows paths | `lib/security/__tests__/publicEndpointsAreThrottled.guard.test.ts` | 3 cases fail locally on route paths printed with `\`; that test and those routes are untouched by this slice (9.2). Not investigated further here |
| 134 `console.*` calls in 9 touched route/config files | section 8.1 | Follow-up slice **PROD-1a.2** (D-4, user decision) |

---

## 15. SA Review Notes

**Reviewed by SA — 2026-11-23** (workplan review, environment change plan included)
**Status:** ✅ Approved with conditions. C-1 to C-10 go into this workplan before task 1 starts. C-3 and C-4 block the merge. C-5 needs TL to tell the user before the merge.

Everything was verified against `origin/main` at `cf379a2a` with `git show` / `git grep`, not the local checkout. The reader inventory in section 3 is confirmed: 58 hit lines, 42 files, the same per-file counts. The 5 hits for the ref shapes in 6.3 are confirmed. The middleware loop at `middleware.ts:276-291` is confirmed to match only `.0`, `.1`, ... The approach is sound and proportionate, and no phase, RLS, Zod or entitlements concern is engaged.

### Rulings on the decisions

| # | Ruling | Reason |
|---|---|---|
| D-1 | **F1 approved** (log at error and continue), subject to C-6 | The claim holds for a value that is missing or that `new URL` cannot parse. The middleware, the browser client (`lib/supabaseClient.ts`) and every server client read the same `NEXT_PUBLIC_SUPABASE_URL`, which is inlined at build. supabase-js `validateSupabaseUrl` throws on a missing, non-http(s) or unparseable value, so no session can exist for the gate to act on. No code sets `storageKey` or `cookieOptions.name` (checked), so the browser's cookie name always follows the default formula. **One narrow gap:** `supabaseProjectRef` (`lib/business-os/account-deletion/authCookies.ts:33`) also rejects a first host label outside `[A-Za-z0-9-]`, which supabase-js accepts (e.g. the IPv6 loopback `http://[::1]:54321`, or a host with an underscore). In that case a client builds, users sign in, the helper returns `null`, and the gate silently passes signed-in users. That is the D-1 premise failing. It only affects exotic local or custom hosts, so it does not block F1, but C-6 must close it |
| D-2 | **Approved: no runtime "both set and disagree" check** | Once this slice lands, nothing reads the retired variable, so a leftover value that disagrees is inert. G-4 blocks a future reader at PR time, and `supabase-url-mismatch` (`classifyEnvironment.ts:451-460`) plus the later flip to forbidden cover a value someone re-adds. A runtime check would itself have to read the retired name. The real danger windows are pre-merge and rollback, and C-3 and C-4 cover those instead |
| D-3 | **In this slice, (a) and (b) both approved**, subject to C-5 | If it is left out, A2 is only half fixed: the gate stays off for every session that `@supabase/ssr` writes unchunked (`chunker.js:23-28`, at most 3180 encoded chars), on every project. Whether the step 1 (c) probe passes would then depend on the test account's session size. `combineChunks` reads the unsuffixed name before `.0`, `.1`, ..., exactly as the library's own reader does, and `stringFromBase64URL` is the exact inverse of its writer. Both are exported from the package index (`dist/main/utils/index.js`). **Yes, it changes behaviour for users mid-session.** Today the gate never runs for small sessions, which in practice are mostly email/password sign-ins (an OAuth user's metadata usually pushes the session past the chunk size). Once it ships, on their next protected navigation those users: (1) are redirected to `/onboarding-chat` if they have no `business_profiles` row or `onboarding_completed` is false; they are not signed out and no data changes. The `onboardingVerdict.ts:51-55` header says users with no profile row are "most of this project's users". `/admin` and `/` are not on the skip list (`middleware.ts:217`), so this includes **platform admins who never completed business onboarding: they would be sent away from the admin console**. (2) If they are onboarded, they now pay the verdict lookup (`auth.getUser`, measured at 1.58 s, plus a profile read) once per token per instance per 60 s, where before they paid nothing |
| D-5 | **Approved**: optional (`O`,`O`,`O`) with "retired" wording now, forbidden (`X`) in the next PROD-1 slice. Subject to C-1 | The variable stays legitimately set until env steps 2 to 4 have run, so `X` now would put a false warning on every environment. The flip to `X` must be tracked as a named item in the PROD-1 master doc, so it is not lost |
| D-6 | **Approved; not a new pattern under rule 7** | It is a pure helper module next to the existing `lib/supabase*.ts` modules. It moves an existing helper rather than duplicating it, adds no dependency (`@supabase/ssr` is already at `^0.6.1`, resolved 0.6.1), and introduces no new architecture. Conditions: it is edge-safe (only `@supabase/ssr` plus type-only imports; no logger, `Buffer`, `fs` or `next/headers`, and the middleware does the logging); `authCookies.ts` imports from it, never the other way round; and it reads the variable only as the literal `process.env.NEXT_PUBLIC_SUPABASE_URL` (never destructured and never `process.env[name]`), so Next inlines the same build-time value into the middleware that the browser gets |
| D-4 | **Not ruled (user's decision).** Surface answer, as asked: **yes, converting all of them in this slice materially enlarges the review** | The A1/A2 change is about 20 one-token hunks, the middleware hunk, one new module and the guard. Converting the 134 route-file calls adds about 134 hunks across 9 files (51 in `analyze-prompt-clarity` alone). API routes also have to attach a `correlationId` child logger (rule 3), which means editing handler bodies, and each line needs a judgement on level, context and `err` shape. The security-relevant one-token switches would be buried in logging churn, inside handlers that have auth tests. Converting the 3 calls in `supabaseAdmin.ts` here costs almost nothing, because the file is rewritten anyway |

### Conditions (fold into the workplan before implementation)

1. **C-1, the catalogue drift guard (task 9, missing step).** After this slice no code reads the retired variable. That makes `catalogue.ts:232` an entry "read by no code" without a `consumedBy` marker, and `lib/admin/environment/__tests__/catalogueDrift.guard.test.ts` (G3-1, header lines 5-8) fails the gate on it. The D-5 change must add `consumedBy: { by: 'environment-page', note: … }`, following the pattern of the `VERCEL_GIT_COMMIT_*` rows (`catalogue.ts:217-222`). Add the drift guard to the task 9 suite list. — SA: pending
2. **C-2, G-5 trips on this slice's own fixtures.** G-5 scans test files for any 20-character lowercase-alphanumeric label before `.supabase.co`. Section 10.1's "hosted address `https://<20 letters>.supabase.co`" and the "neutral fake ref" for `authCookies.test.ts` both match that shape, so the gate goes red on landing. Build every such fixture from parts (`'a'.repeat(20)`, or join pieces, as the guard does for its own names), and add that rule to 6.3. — SA: pending
3. **C-3, step 0 must give positive evidence (merge blocker).** The pair check at `classifyEnvironment.ts:442-450` only runs when *both* rows are `shown`. If a row is hidden, masked or fails the url shape, it produces no `supabase-url-mismatch`, so "no mismatch diagnostic" reads as "they agree" when it proves nothing. Change the step 0 probe and its evidence to: on each deployment checked, **both rows shown, both with the same project label** (today there is exactly one entry in `SUPABASE_PROJECTS`, so an unlabelled row fails the check). Also: (a) enumerate targets with names and targets only, including **branch-scoped Preview overrides and any custom environment**, not just the generic Preview scope; (b) confirm the converse too: wherever `SUPABASE_URL` is set, `NEXT_PUBLIC_SUPABASE_URL` is set in the same target, because otherwise the merge breaks the 14 files there; (c) run step 0 on the day of the merge, not earlier. The Development scope is a developer pull, not a deployment, and today only one project exists, so a lighter check is acceptable there, provided it needs no secret in hand. Do not `vercel env pull` secrets just to compare. — SA: pending
4. **C-4, order against wiring the production project (merge blocker; add to 4.2, 11 and 13).** Env step 3 (remove the retired variable from Production) must **complete before** Production's `NEXT_PUBLIC_SUPABASE_URL` is pointed at the new project. If production is wired while the retired variable still names the old project, then reverting this PR (section 13, first row) sends the 14 service-role files to the development/staging database with RLS bypassed. That is A1 recreated, by the rollback itself. Record this as a gate in the PROD-1 master doc as well. — SA: pending
5. **C-5, measure who D-3 newly gates, and tell the user (before merge).** Run a read-only count on the current project: (a) members of `admin_users` whose `business_profiles` row is missing or has `onboarding_completed` false; (b) recently active users in the same state. Record the counts by role in this workplan, with no ids. If (a) is above zero, TL brings it to the user before the merge: those admins will be redirected from `/admin` to onboarding. Whether to complete their onboarding or exempt `/admin` is a requirement decision through BA and SA, not a Dev change in this slice. TL also tells the user about the redirect and the verdict latency for the newly gated population in general. Add these as R-10 and R-11 in section 12. — SA: pending
6. **C-6, a parity property for D-1.** In 10.1, besides key equality for 3 hosted addresses, assert the property "**whenever the helper returns null, supabase-js `createClient` throws**" over a table that includes `undefined`, `''`, `'not a url'`, a non-http scheme, `http://[::1]:54321` and an underscore host. Then close the gap, either by deriving the storage key with supabase-js's own formula (first label of `new URL(trimmed).hostname`, null only where supabase-js would throw) or by aligning `supabaseProjectRef`. The test must not be able to pass with today's helper unchanged. — SA: pending
7. **C-7, the two existing middleware tests need an in-file positive control (10.3).** The 10.2 control proves reachability only in its own file, behind a different seam (mocked `onboardingVerdict`). The 10.3 files assert `createClient` *not* called. If the cookie in one of those files fails to decode (for example, a fixture in standard base64 containing `+` or `/`, which `stringFromBase64URL` rejects), the catch passes the request through and the "not called" assertion stays green vacuously, the very failure 10.3 is meant to prevent. Required: (a) one shared test helper that builds the session cookie with the library's own writer (`stringToBase64URL` with the `base64-` prefix, and `createChunks` for the chunked case), used by 10.2 and both 10.3 files; (b) in each 10.3 file, one control: the same cookie on a protected path such as `/v2/dashboard` **does** call the mocked `createClient`, with `mockClear` between cases (`middleware.accountDeleted.test.ts` has no `afterEach` today). Also add to 10.2: both unchunked and chunked present, so the unchunked one wins as in the library; a lone `-code-verifier` cookie is not read as a session; a session large enough that `createChunks` splits it; and a malformed cookie on a protected path, which passes through with one error line (the middleware's catch path). — SA: pending
8. **C-8, guard details (section 6).** (a) **Comment policy, stated explicitly.** Recommended: no comment stripping, so a backtick-quoted retired name in a comment counts as a hit. The 3.5 rewording must then describe the variable without quoting its name. (b) Normalise relative paths to `/` before comparing exemptions. `path.relative` gives `\` on Windows, so a POSIX exemption string would never match there. (c) Workflow forms: also catch `secrets.NAME`, `vars.NAME` and `env.NAME`, and scan `*.yaml` as well as `*.yml`. Note that the existing walk skips dot-directories, so `.github` must be added explicitly. (d) Allowed-lookalike self-tests must include a local `const SUPABASE_URL =` identifier (`scripts/test-memory-integration.ts:21`), `SUPABASE_URL_ROW_NAMES` and `NEXT_PUBLIC_SUPABASE_URL`. (e) Exemptions must stay justified: a self-test asserts each exempt file exists and still contains a hit, so a stale exemption fails. For `catalog.generated.ts`, the hits must be confined to the two provenance lines (the `Source` header and the `"source"` field), so the exemption cannot hide a ref anywhere else in the file. Exempting it is otherwise justified: it is generated from the configured address, nothing reads `PHYSICAL_CATALOG.source` (confirmed: every reader indexes `.tables`), and a hand edit would be overwritten. The cleaner fix is for the generator to write the project label instead of the host, but that needs a live regeneration and is a follow-up, not this slice. — SA: pending
9. **C-9, CI wall time (standing rule).** Placing the checks in the existing suite is approved: no new suite, job or workflow step. The added work is about 2,000 more file reads (mostly test files, for G-5) plus regex passes, in one suite on one of the 3 gate shards. Budget: **at most +1 s for this suite, measured on CI** (the gate shard's per-suite timing), recorded in section 16 before and after. Local timing on Windows is not the measure. To stay inside it, read each file once and run every rule in that single pass, keeping hits rather than caching ~5,600 file bodies in memory. A byte prefilter like the one in `catalogueDrift.guard.test.ts:20-23` is also acceptable. If the budget is exceeded, narrow G-5's test-file scan with a prefilter before adding anything else. — SA: pending
10. **C-10, env step probes (section 11).** (a) Step 1 (b) searches for the message "Missing Supabase environment variables", but the D-4 conversion of `supabaseAdmin.ts` changes that text. A search for a string the code no longer emits cannot fail. Record the exact messages in the merged code before running the probe. (b) Step 1 records the deployment's commit SHA and checks that it equals the merge commit. (c) As a no-session alternative to step 1 (a), and usable on Preview as well: an **unauthenticated** `GET` to a route that imports `supabaseAdmin` must answer the admin gate's 401/403. A 500 means the module threw at import. This proves the module loaded; the Environment page's project label on the public row proves which project it reads. (d) Rewrite section 13's "middleware only misbehaves" row. Hand-reverting only the middleware hunk brings back the hardcoded ref, which fails G-5 and the 10.2/10.3 tests, so it is not a clean hotfix. While the retired variable is still set (before step 2), the rollback is to **revert the whole PR**. (e) Do not run step 2 until step 1 has passed **and** the D-3 behaviour has run in Production for a short soak. The removals turn a one-step revert into a two-step one, but C-4 still requires step 3 before production is wired. — SA: pending

### Answers to the specific checks

1. **Transition safety.** The order (code first, removal later, one scope per step) is correct. The step 0 probe as written **can pass when it should fail** (C-3), and the plan was missing the ordering against wiring the production project (C-4). With both conditions in place it is enough. The hazard is also small today, because only one project exists, so both variables can only name it unless someone pointed one at an unrelated project.
2. **The guard.** Wall time: acceptable within C-9. CRLF: the design is sound (normalise on read; no `^`, `$` or `m` flag; LF and CRLF self-tests). Add the Windows path-separator point (C-8 b). Able to fail: yes, through the positive and negative self-tests, the floors and the manual G-4 negative check, plus the exemption self-test (C-8 e). Exemptions: `catalogue.ts` and `supabaseProjects.ts` are justified, since they name the variable or the ref precisely so the page can report it. `catalog.generated.ts` is justified only with the line confinement in C-8 e. G-5 as written would also go red on this slice's own fixtures (C-2).
3. **Middleware tests.** Dev is right that both turn vacuous: under Jest the derived name follows `https://test.supabase.co` from `tests/plugins/jest-setup.ts:12`. The 10.2 control does prove that the cookie reaches the check on a protected path, but only in its own file. It does not carry over to the 10.3 files, which need C-7.
4. **Rollback.** "Put the variable back before reverting the code" is correct. The reverted build must be created after the variable is back. A redeploy in between is harmless but not needed, because the revert's own deploy picks the variable up. It is not complete, though: it is missing C-4 (once production is wired, a revert recreates A1) and C-10 d (a middleware-only revert is not clean). Vercel Instant Rollback to a pre-merge deployment keeps that deployment's own env snapshot. DO should confirm this, and record it as the fast path that does not depend on the env steps. DO should also record the PROD-1 corollary: never Instant Rollback across the production cutover.
5. **Anything missing.**
   - *Other service-role entry points:* none. `git grep` over `app`, `lib`, `components`, `hooks`, `scripts`, `middleware.ts` and `next.config.js` finds only two Supabase address variables (`NEXT_PUBLIC_SUPABASE_URL` and the retired one). There is no `DATABASE_URL` or `POSTGRES_*` reader. No workflow other than `build.yml:145` sets the retired name; `plugin-tests.yml` sets only the public one. `vercel.json` has none.
   - *Edge runtime:* `@supabase/ssr` 0.6.1 is edge-safe, and removing `Buffer` from the middleware is an improvement. R-6 (bundle size) stays a recorded check.
   - *Build-time inlining:* R-2 is correctly flagged and correctly not a blocker here. Vercel env is bound per deployment, so a Preview promoted without a rebuild already carries Preview values for every variable today, including the runtime-read ones. This slice does not widen that. It must be closed in the cutover slice, before production is wired: confirm whether promote rebuilds with Production values, and if it does not, forbid promote-from-Preview.
   - *Computed read:* the `analyze-prompt-clarity` `required` list is read through `process.env[key]`, which Next does not inline. It still works at runtime, because the variable is present in the function env, and it stays covered by the drift guard's existing pin (count-based, so it is unaffected).
   - *Docs:* `docs/HELP_BOT_FEATURES_SUMMARY.md:240` and `docs/HOW_GROQ_HELPBOT_WORKS.md:591` also tell readers to set the retired variable. Add them to task 11 (one line each, no Change History needed if they have none). The development ref also appears in `MIGRATION_GUIDE.md` and many historical workplans. That is out of scope; note it as public-repo-rule debt in section 14.

### Environment change plan (section 11) against `env-change-protocol`

| Check | Verdict |
|---|---|
| Tier | Correct: step 0 and step 1 Read; step 2 Preview, reversible, with the user's quoted approval; **step 3 Production, user executes**; step 4 Development, as step 2 |
| One change per step | Yes |
| Before-state | Present for steps 0 and 2; steps 3 and 4 inherit it ("as step 2") |
| Probe can fail and targets the exact deployment | Step 0 does not yet (C-3); steps 1 and 2 do once C-10 a to c are in |
| Order against the deploy | Stated for each step. Missing: the order against wiring the production project (C-4) |
| Rollback | Each step has an undo. Section 13 needs C-4 and C-10 d |
| Public-repo rule | Clean: names and roles only, no ref or ID in this file |

Approving this plan clears step 3 for the **user** to execute at its stated point, after step 2's probe passes and subject to C-4 and C-10 e.

### Adjusted items (marked by SA)
- Task 9: add `consumedBy` to the catalogue row and run `catalogueDrift.guard.test.ts` (C-1).
- Task 4: shared cookie-writer test helper, plus in-file positive controls in both 10.3 files (C-7).
- Task 10: fixtures built from parts, comment policy, path normalisation, workflow forms, exemption self-test, single-pass read (C-2, C-8, C-9).
- Task 11: the two help-bot docs (check 5).
- Task 0: step 0 with positive evidence on the merge day (C-3); C-5 counts recorded before merge.

### Approval
[x] Workplan approved with conditions. Fold C-1 to C-10 into the workplan, then proceed to implementation. C-3, C-4 and C-5 must be closed before RM merges.

---

**Code Review by SA — 2026-11-23**
**Status:** ✅ Code Approved (no blocking finding). QA items Q-1 to Q-6 below are owed before RM commits, and C-3 and C-4 still block the merge.

I reviewed the uncommitted diff in the PROD-1a worktree against `cf379a2a`: 44 modified files and the 5 new code and test files. I re-ran every claim below myself and did not rely on 9.2.

### What was verified

| Area | Verdict | Evidence |
|---|---|---|
| Name derived per request, nothing at import | ✅ | `middleware.ts` calls `supabaseAuthStorageKey()` inside the handler's `try`. `lib/supabaseAuthCookie.ts` has no module-scope statement apart from one string constant, and it reads the address as the literal `process.env.NEXT_PUBLIC_SUPABASE_URL` in a default parameter. `middleware.sessionCookie.test.ts` re-imports the module under `jest.isolateModules` with the address unset and set to `'not a url'`, and asserts that the import does not throw |
| Library halves used as the library writes | ✅ | `combineChunks(key, get)` reads the unsuffixed key first, then `.0`, `.1`, … (`@supabase/ssr` 0.6.1 `chunker.js`). The `base64-` prefix is stripped once and decoded with `stringFromBase64URL`, with plain JSON as the fallback: the same branch as the library's own reader (`cookies.js:146-147`). Fixtures come from the library's own writer (`tests/helpers/supabaseSessionCookie.ts`) |
| Unsuffixed wins | ✅ | By construction (`combineChunks` returns early). Pinned in both `supabaseAuthCookie.test.ts` and `middleware.sessionCookie.test.ts` |
| Lone `-code-verifier` not a session | ✅ | The reader only ever asks for `key` and `key.N`. Pinned in both files |
| Malformed cookie: passes through, exactly one error line | ✅ | `stringFromBase64URL` throws on `+`/`/`, and `JSON.parse` throws on bad JSON. The handler's existing catch writes the one error record, and the test counts level-50 records, not `console.error` calls |
| Edge-safe | ✅ | `Buffer` and the hand-built regex are gone from `middleware.ts` (no `Buffer` or `process.` reads remain outside the env literal). `@supabase/ssr`'s `dist/main` has no `fs`/`crypto`/`buffer` require outside its own test file. The middleware already bundled supabase-js through `onboardingVerdict`. No dependency change (`package.json` and the lockfile are untouched) |
| C-6 parity | ✅ | `supabaseProjectRef` now mirrors supabase-js 2.75.1 `validateSupabaseUrl` line for line (trim, `^https?://`i, trailing slash, `new URL`). The storage-key formula matches `SupabaseClient.js:52`. The property table asserts both directions. `authCookiePattern` escapes the ref, so the newly accepted labels (`[::1]`, underscore) are safe there |
| D-3 does not reach API routes | ✅ | `/api` is on the skip list (`middleware.ts:155`), so un-onboarded users' fetches are not redirected to HTML |
| No server reader of the retired variable | ✅ | My own `git grep` in the worktree (word-bounded, all tracked files outside `docs/` and `*.md`) finds only the 3.4/3.6/3.7 set: env-page test data, `catalogue.ts`, `supabaseProjects.ts`, the shell local in `apply-migrations.sh`, the local const in `test-memory-integration.ts`, and the Deno Edge Function. The untracked new files have no hit. No `.env.example`, `vercel.json` or `next.config.js` hit |
| Guard can fail | ✅ | I ran the **branch's** guard file over a `git archive` of `cf379a2a`. G-4 failed on all 27 base read/set/comment sites: every row of 3.1 (including both `analyze-prompt-clarity` sites and `supabaseAdmin.ts:19`), the 4 scripts, `jest-setup.ts:14,21`, `build.yml:145`, and the 2 quoted comments. G-5 failed on exactly `middleware.ts:278` and the 3 test fixtures. On the branch it passes 31/31 |
| Exemptions, line endings, paths | ✅ | Two G-4 exemptions and one G-5 exemption, each with a reason, plus a self-test that they still hit. `catalog.generated.ts` is confined to its provenance lines. Content is normalised once; no pattern uses `^`, `$`, a newline or the `m` flag; LF and CRLF self-tests assert the same lines. `toPosix` runs before every scope or exemption comparison. Workflows are listed explicitly (`*.yml` and `*.yaml`) |
| CI time | 🟡 owed (Q-4) | One read per file with a byte prefilter. No new suite, job or step, and `build.yml` loses a line. Dev's local +0.7 s is noise-level, but the C-9 measure is the CI per-suite time |
| Logging and secrets | ✅ | `supabaseAdmin.ts` uses Pino `createLogger({ module })`, with booleans only (`hasUrl`, `hasServiceRoleKey`). The old `console.error` that printed the address is gone, and the thrown message carries booleans only. The middleware's new error line names no address or ref. No `console.*` in `supabaseAdmin.ts`, `middleware.ts` or the new module. The other 134 calls are out of scope by the user's D-4 decision (PROD-1a.2), which satisfies the touched-file rule |
| Public-repo rule | ✅ | No ref, host or attack narrative in this workplan or the 4 changed docs. `VERCEL_DEPLOYMENT_SETUP.md` now uses a `<project-ref>` placeholder. Every 20-character fixture is built from parts (`'q'/'a'/'p'/'o'/'z'.repeat(20)`) |
| Tailwind scan | ✅ | The only backslashes in this workplan are `\|` table escapes and two `` `\` `` code spans followed by a backtick. No backslash-hex sequence. The 4 changed docs add no backslash |
| Scope | ✅ | Every hunk traces to a reader or a condition. `run-scheduled-agents/route.ts:123` and `brokenConnections.ts:60` are **G-4 hits at base** (quoted name in a comment, C-8 a), so they had to change. `adminGate.writes.test.ts` is a stale-comment fix approved in 3.5; it also drops the inaccurate "six routes / boost-packs" claim (5 importers today: 4 admin routes and `RoutingService`). `catalogue.test.ts` is C-1/R-9, `tests/helpers/` is C-7, and the help-bot docs are check 5 |
| Pre-existing failure | ✅ not caused by this slice | `publicEndpointsAreThrottled.guard.test.ts` run from a `git archive` of `cf379a2a`: `Tests: 3 failed, 23 passed, 26 total`, the same 3 routes printed with `\`, identical to the branch. `lib/security` is unchanged in the diff |

I re-ran the 24 touched suites on the branch: 23 pass, and the only failure is the throttled guard above. That covers the guard, both new unit suites, the middleware suites, `authCookies`, every Environment-page suite including `catalogueDrift.guard`, and `adminGate.writes`.

### Code Review Comments
1. `lib/supabaseAdmin.ts:34` — The client-side branch now logs through the server Pino logger. No client importer exists (the 5 importers are server routes and `RoutingService`), and the branch throws either way, so this is harmless today. If a client import ever appears, the right fix is to remove the import, not the log. — Priority: Low (no change required)
2. `middleware.ts` null-key branch — With the address missing, the error line repeats on every protected navigation. That is intended (D-1 F1 wants it loud, and the deployment is already down for sign-in). Noted so nobody reads the volume as a separate incident. — Priority: Low (no change)
3. Section 11 step 0 (3) — The probe reads the admin Environment page on Production and on each branch-override Preview, which needs a **signed-in admin session**. "Executed by: DO" does not say who signs in. TL must assign it before the merge day, under the "no click-through asks" preference. Choices: the user opens the page; or DO compares only the two address values per target through the Vercel API with the user's quoted approval, records same/different plus the project label, and never prints the values (both are non-secret addresses, so this is not the secret pull the step forbids). The step is otherwise executable as written. — Priority: Medium (blocks the merge only through C-3, not QA)
4. C-4 — Written correctly in 4.2 row 3a, in 11 step 3 "Ordering gate" and in 13's last row. It is closed for merge only once TL/BA confirm the same gate is recorded in the PROD-1 master doc, which is untracked and outside this diff. RM must see that confirmation before merging. — Priority: Medium (merge blocker, not QA)

### Optimisation Suggestions
- G-4 walks `scripts/` but not the repo-root `*.mjs` one-off scripts. None reads the retired name today, and they are not deployed. Extend the root list if those scripts are ever revived.
- After PROD-1a.2, consider having G-4 flag a computed `process.env[x]` read in files that already name the retired variable. Today such a read is caught only when the name is quoted.

### What QA must run (owed before RM commits)

| # | Check | Done when |
|---|---|---|
| Q-1 | `npm run build` in the worktree, as ship drill step 1. Do **not** `npm install`: `node_modules` is a shared junction | Exit 0, no V8/OOM trace. Note: a local `.env.local` that still sets the retired variable cannot prove "no import-time reader". The **PR's CI Build job** (no `.env.local`, placeholder removed) is the authoritative probe, and QA records it green |
| Q-2 | R-6: the `ƒ Middleware` size line from Q-1, against the same line in the latest green `main` Build log (no need to build the base) | Both sizes recorded in 16. Growth beyond a few kB comes back to SA |
| Q-3 | `npm run test:gate` | Green apart from failures that also fail on clean `main` (dedupe: the gate prints FAIL twice). The throttled guard is expected red on Windows only, and must be **green on CI** |
| Q-4 | C-9: the per-suite time of `envConfigHardening.guard.test.ts` on the CI gate shard, before (latest `main` run) and after (this PR) | At most +1 s. Over budget comes back to Dev with the G-5 test-file prefilter |
| Q-5 | Typecheck filtered to the touched and new files, checked for an OOM crash | Only the 4 pre-existing diagnostics in 9.2 |
| Q-6 | Failure paths, recorded in 16: the D-1 unset and invalid-address cases and the malformed-cookie case in `middleware.sessionCookie.test.ts`, the throw case in `supabaseAdmin.test.ts`, and one manual G-4 negative probe (re-add a read, see the file:line, restore byte-exact) | Each seen red, then restored |

### Code Approved for QA: Yes

---

## 16. QA Testing Report

**QA — 2026-11-23**
**Test mode:** full
**Strategy used:** A (Jest unit: the new module, the admin client, the middleware) and the full Jest gate (`npm run test:gate`), plus the ship-drill build and typecheck, plus failure-path mutation probes (Q-6). No browser check: the change has no UI, and section 11 step 1 (c) is the live probe.
**Focus:** api, security, schema (guard)
**Skipped:** e2e (no UI flow; the live redirect check is section 11 step 1 (c), owned by TL/DO)
**Input source:** prompt keywords (SA's Q-1 to Q-6) and QA judgment

Everything below was run by QA in the PROD-1a worktree on the uncommitted diff over `cf379a2a`. "Verified" means seen in output; "reasoned" is marked as such.

### Q-1 Build (verified locally; CI Build owed)

The worktree has **no `.env.local`** (only `.env.example`), and the shell had no Supabase variable set. The build ran with the exact env block of the branch's `build.yml` Build step (the retired variable absent, the public one set to the `.invalid` placeholder). So unlike a developer checkout, this local green does exercise "no import-time reader of the retired variable is left". No next/font flake; no retry needed.

```text
 ⚠ Compiled with warnings
 ✓ Compiled successfully
 ✓ Generating static pages (332/332)
+ First Load JS shared by all                                       88.9 kB
ƒ Middleware                                                        66.4 kB
EXIT=0
```

`Missing Supabase` appears 0 times in the build log. The 2 edge-runtime warnings (`process.versions` in realtime-js, `process.version` in supabase-js, both via `lib/security/onboardingVerdict.ts`) are identical to the `main` Build log for `cf379a2a`; nothing new traces to `@supabase/ssr` or `lib/supabaseAuthCookie.ts`.

**Owed to CI:** the PR's Build job is the authoritative probe.

### Q-2 R-6 middleware size (verified)

| Build | `ƒ Middleware` |
|---|---|
| `main` Build run for `cf379a2a` (the #670 merge, this branch's base), and the run before it | 65.8 kB |
| This branch, local build | 66.4 kB |

Growth **+0.6 kB**, inside "a few kB". No return to SA.

### Q-3 Jest gate (verified)

```text
Test Suites: 19 failed, 2068 passed, 2087 total
Tests:       29 failed, 29 skipped, 51448 passed, 51506 total
Time:        880.204 s
```

Deduplicated (each FAIL prints twice): 19 suites. The same 19 suites were run from a `git archive` of `cf379a2a` in a scratch dir (shared `node_modules` linked by a junction; only the junction was removed afterwards; the shared folder still lists 842 entries and the worktree's junction still resolves):

```text
Test Suites: 19 failed, 19 total
Tests:       29 failed, 306 passed, 335 total
```

The sorted sets of failing test names are **identical** on base and branch (29 = 29; `diff` empty apart from a `● Console` header). No failure is introduced by this slice. `publicEndpointsAreThrottled.guard.test.ts` is among them, as expected on Windows. `lib/__tests__/supabaseFetch.test.ts` also fails, identically at base (`timeoutMs()` 20000 vs 60000 under a forced `NODE_ENV`); `lib/supabaseFetch.ts` and its test are unchanged in the diff. Every new and changed suite passes, `envConfigHardening.guard.test.ts` included.

### Q-4 C-9 guard time on CI (owed)

Owed to the PR's gate shard. For whoever reads it: on the `main` Tests run for `cf379a2a` (gate shard 3) the line is `PASS lib/__tests__/envConfigHardening.guard.test.ts` with **no time printed**, meaning under Jest's 5 s slow-suite threshold; the log gives no finer baseline. If the PR's line also prints no time, the suite stayed under 5 s, but that alone does not prove the +1 s budget; an exact figure needs a verbose/JSON timing or the shard wall time. Local, not the measure: 9.083 s inside the full gate run (under load), 7.5 to 11.3 s in the small reruns.

### Q-5 Typecheck (verified)

`NODE_OPTIONS=--max-old-space-size=12288 npx tsc --noEmit -p tsconfig.json`: exit 2 after 134 s, 1858 diagnostics, **0** FATAL / heap / out-of-memory lines, so it completed. 1858 is Dev's 1848 plus 10 in `.next/types/**`, which exist only because QA's build had just generated `.next` (tsconfig includes `.next/types`). Filtered to the 44 touched and new `.ts`/`.tsx` files:

```text
app/api/help-bot-v2/route.ts(512,5): error TS2322: ... is not assignable to type 'null'.
app/api/help-bot-v2/route.ts(564,24): error TS18047: 'systemPromptTemplate' is possibly 'null'.
app/invite/__tests__/middleware.invite.test.ts(77,17): error TS2540: Cannot assign to 'NODE_ENV' because it is a read-only property.
app/invite/__tests__/middleware.invite.test.ts(89,19): error TS2540: Cannot assign to 'NODE_ENV' because it is a read-only property.
```

Exactly the 4 pre-existing diagnostics. The filter also matched one generated `.next/types/app/api/generate-clarification-questions/route.ts` line (TS2344: the route exports `buildClarifySystemPrompt`). That export is identical at `cf379a2a`, and the slice changes one token in that file, so it is pre-existing and build-artifact only.

### Q-6 Failure paths seen red (verified; every file restored byte-exact)

A backup was taken before each probe; each restore was checked with `cmp` (`RESTORED-BYTE-EXACT`), and finally with `sha256sum -c` against the pre-probe hashes (all `OK`).

| # | Mutation (temporary) | Result |
|---|---|---|
| 1 | `middleware.ts`: module-scope `if (supabaseAuthStorageKey() === null) throw` (the site-wide outage A2 forbids) | `× unset: import does not throw…` and `× not a url: import does not throw…`, error `QA probe: no key at import`; `Tests: 2 failed, 7 passed, 9 total` |
| 2 | `middleware.ts`: the null-key branch logs at `debug` instead of `error` (a silent pass) | the same 2 cases red, `Expected length: 1`, `Received length: 0`; `Tests: 2 failed, 7 passed, 9 total` |
| 3 | `lib/supabaseAuthCookie.ts`: `readSessionAccessToken` swallows bad base64url / JSON and returns null | `× a malformed session cookie: passes through with one error line`, `Expected length: 1`, `Received length: 0`; `Tests: 1 failed, 8 passed, 9 total` |
| 4 | `lib/supabaseAdmin.ts`: the public address, falling back to the retired variable | `× throws at import when the public address is missing, even if the retired one is set`, `Received function did not throw`; `Tests: 1 failed, 2 passed, 3 total` |
| 5 | `lib/supabaseAdmin.ts`: the retired variable preferred over the public one (A1 itself) | `× builds the client from the public address, even when the retired variable names another project` plus the throw case; `Tests: 2 failed, 1 passed, 3 total` |
| 6 | G-4 manual negative: appended a server read of the retired variable to `lib/supabaseServer.ts` (a file the slice does not touch) | `× G-4 no code reads the retired Supabase address variable…` with `+   "lib/supabaseServer.ts:31"`; `Tests: 1 failed, 30 passed, 31 total` |

After the restores, the 4 core suites plus `app/account-deleted`, `app/invite` and `lib/business-os/account-deletion` re-run green: `Tests: 962 passed, 962 total`.

### Test Coverage

| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| A1: every server reader uses `NEXT_PUBLIC_SUPABASE_URL`; the admin client follows it even when the retired one names another project | ✅ | Pass | Happy path: `supabaseAdmin.test.ts` case 1. Failure path: case 3 (throws when the public address is missing). Both seen red under probes 4 and 5 |
| A1: no import-time reader of the retired variable remains | ✅ | Pass (local) | Q-1 built with the retired variable absent and no `.env.local`. CI Build owed |
| A1: a reintroduced reader is caught at PR time | ✅ | Pass | G-4 green on the branch; probe 6 red with file:line |
| A2: cookie name derived from the configured address, chunked and unchunked | ✅ | Pass | Happy path: the two positive controls in `middleware.sessionCookie.test.ts`, plus the in-file controls in the two 10.3 files |
| A2: no throw at module load; a missing or invalid address logs at error and passes | ✅ | Pass | Failure path: the unset and `not a url` cases; red under probes 1 and 2 |
| A2: a malformed cookie passes through with one error line | ✅ | Pass | Red under probe 3 |
| No hardcoded ref (G-5) | ✅ | Pass | G-5 green; Dev's G-5 negatives in 9.2 |
| Build, typecheck, gate | ✅ | Pass | Q-1, Q-5, Q-3 above |
| Middleware bundle growth (R-6) | ✅ | Pass | +0.6 kB |
| Guard CI time within +1 s (C-9) | ⚠️ | Owed | Q-4, CI only |

### Hygiene checks (verified)

- **No ref, URL or secret in tracked text.** Every hit of the development ref, or of any 20-character `.supabase.co` / `sb-<20>-auth-token` shape, in the full diff plus the untracked files is on a **removed** line. Added URLs are only `localhost`, `127.0.0.1`, `[::1]`, `under_score`, `ci.invalid`, `example.supabase.co`, `test.supabase.co`, `db.example.com`, `<project-ref>`, and template literals built from parts. No key- or token-shaped strings. The comments describe the failure mode (two variables, writes landing in the other project) with no exploitation narrative.
- **Nothing staged** (`git diff --cached` empty). 44 modified tracked files, as SA reviewed.
- **The untracked files are exactly the slice's 6:** `lib/supabaseAuthCookie.ts`, `lib/__tests__/supabaseAuthCookie.test.ts`, `lib/__tests__/supabaseAdmin.test.ts`, `app/__tests__/middleware.sessionCookie.test.ts`, `tests/helpers/supabaseSessionCookie.ts`, and this workplan. QA's build left `.next/`, which is git-ignored.
- **No entitlements import** in the diff, so `test:bos-entitlements` is not engaged.

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None found. C-9 stays owed to CI (Q-4).

#### Edge Cases (nice to fix)
1. G-4 does not catch a computed read built by concatenation, for example `process.env['SUPABASE' + '_URL']`. Reasoned, not run; it is the same gap as SA's second optimisation suggestion. Low.

### Owed to CI (record on the PR)
- **Q-1:** the PR's Build job green (the authoritative probe for "no import-time reader").
- **Q-3:** `publicEndpointsAreThrottled.guard.test.ts` green on CI (it fails on Windows only, at base as well).
- **Q-4:** the `envConfigHardening.guard.test.ts` per-suite time on the PR's gate shard against `main` (no time printed on `main`, so under 5 s); budget at most +1 s.

Q-2 is closed: the `main` log was available.

### Final Status
- [x] All acceptance criteria testable locally pass — ready for commit (Q-1 CI Build and Q-4 CI timing owed on the PR; C-3 and C-4 still block the **merge**, not the commit)
- [ ] Issues found — Dev must address before commit

---

## 17. Commit Info

*(RM to populate.)*

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-11-23 | Workplan created | Dev: reader inventory (58 lines, 42 files) from `origin/main` `cf379a2a`; variable choice; cookie-name design; guard design; DevOps handoff; decisions D-1 to D-6 for SA |
| 2026-11-23 | SA workplan review | SA: approved with conditions C-1 to C-10; D-1 F1, D-2 no runtime check, D-3 in scope with a behaviour-change measurement, D-5 and D-6 approved; D-4 left to the user; env plan reviewed (C-3, C-4 merge blockers) |
| 2026-11-23 | Implemented; SA conditions folded in | Dev: C-1 to C-10 folded into 4.2, 6, 9.1 and 10 to 14; C-5 recorded as measured and closed (0 admins affected); D-4 recorded as the user's decision (split; PROD-1a.2). Code, tests, guard G-4 and G-5, and docs done; verification output in 9.2 |
| 2026-11-23 | SA code review | SA: code approved for QA, no blocking finding. Guard shown to fail on the base inventory; the throttled-guard failure reproduced at `cf379a2a`; QA owes Q-1 to Q-6 (build, R-6, gate, C-9 CI time, typecheck, failure paths); C-3 step 0 needs an assigned admin session; C-4 needs the PROD-1 master-doc gate confirmed before merge |
| 2026-11-23 | QA report | QA: ready for commit. Build green with no `.env.local` and the CI env block; middleware 65.8 kB to 66.4 kB; gate failures identical to `cf379a2a` (19 suites, 29 tests); typecheck only the 4 pre-existing diagnostics; 6 failure-path probes red, all restored byte-exact. Owed to CI: Build job, the throttled guard green, C-9 guard timing (section 16) |
