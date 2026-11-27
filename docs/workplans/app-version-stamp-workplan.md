# App Version Stamp — Workplan

> **Last Updated**: 2026-11-27

## Overview

ClickUp **R19** (under PROD-4, "MVP1 - Production Readiness"). Every build must be able to say which build it is, so that a bug report can quote it, the release smoke test (R10) can check it is testing the right build, and the release PR can record the SHA that was checked on Staging. The spec is [DEVELOPMENT_LIFECYCLE.md §5.4](/docs/DEVELOPMENT_LIFECYCLE.md), on `main` since PR #688, together with the user's brief. Branch: `feature/app-version-stamp`, cut from `origin/main`.

---

## 1. Scope (from the user's brief)

| # | Item |
|---|---|
| S-1 | `GET /api/version` returns `{ environment, commit, builtAt }` and **nothing else**: no other env values, config or internals |
| S-2 | One small version line, e.g. `Staging · a1b2c3d · built 2026-11-26 14:02`, in Business OS **Settings** and in the **admin** area |
| S-3 | Values come from the build: `VERCEL_GIT_COMMIT_SHA`, `VERCEL_GIT_COMMIT_REF` and the environment name. Show the SHA, **not** a CalVer tag (Vercel builds from a shallow clone with no tags) |
| S-4 | Reuse `lib/admin/environment/` for the environment label. Do not build a second, different label |

Out of scope: the smoke test itself (R10), the release PR template, the §5.4 text in `DEVELOPMENT_LIFECYCLE.md`.

---

## 2. What exists

| Fact | Where |
|---|---|
| `environmentLabelOf(env)` gives `production / preview / vercel-development / local / unknown` from `VERCEL_ENV` (and `NODE_ENV` for local). It is pure and takes the env object as an argument | `lib/admin/environment/classifyEnvironment.ts` |
| The page words for those labels (`Production`, `Preview`, …) | `app/admin/environment/environmentDisplay.ts` `ENVIRONMENT_LABEL_WORDS` |
| `VERCEL_GIT_COMMIT_SHA` / `_REF` are catalogued with a `consumedBy: environment-page` marker ("read by no code") | `lib/admin/environment/catalogue.ts` |
| A drift guard fails when code reads an uncatalogued name, or reads a name that still carries a `consumedBy` marker. It scans `next.config.js` too | `lib/admin/environment/__tests__/catalogueDrift.guard.test.ts` |
| Middleware skips `/api/*`, so an API route is reachable without a session unless it checks one | `middleware.ts` |
| Topology: `main` → **Dev/Staging**, `production` branch → **Production**. Production never builds from `main` | `docs/DEVELOPMENT_LIFECYCLE.md` §3 |

**The gap the brief names.** `environmentLabelOf` reads `VERCEL_ENV` only. Once production is its own branch, `VERCEL_ENV` can be `production` for both (two Vercel projects) or `preview` for Staging (one project with `production` as its production branch). Neither tells Staging from Production alone. The **branch** does: `main` is Staging and `production` is Production, whichever way the Vercel projects are set up.

---

## 3. Design (Dev proposal, for SA ruling)

### 3.1 Environment role: one function, in the existing module

Add `deploymentRoleOf(env)` to `lib/admin/environment/classifyEnvironment.ts`, next to `environmentLabelOf` and built **on** it, so there is still one classifier:

| `environmentLabelOf` | `VERCEL_GIT_COMMIT_REF` | Role | Words |
|---|---|---|---|
| `production` or `preview` | `production` | `production` | Production |
| `production` or `preview` | `main` | `staging` | Staging |
| `preview` | anything else | `preview` | Preview |
| `production` | anything else (unexpected) | `unknown` | Unknown |
| `vercel-development` | — | `development` | Development |
| `local` | — | `local` | Local |
| `unknown` | — | `unknown` | Unknown |

- The ref is compared exactly (`main`, `production`): no prefix match, no case folding.
- Production built from a branch that is not `production` is reported as `unknown`, not as Production. Under the §3 rules that build should not exist, and it must not be called Production.
- **Before the cutover** the live deployment builds `main` with `VERCEL_ENV=production`, so it reads **Staging**. That matches §3 (main is Dev/Staging) and the user's example.
- The words go in a small `DEPLOYMENT_ROLE_WORDS` map in a client-safe file (`lib/version/appVersion-types.ts`), so the browser needs no import from the server-only module.
- `/admin/environment` keeps its current label. Changing that page is not in scope. **SA Q1:** should the Environment page also show the role? (Proposed: no, a follow-up.)

### 3.2 Where each value comes from

| Field | Source | Notes |
|---|---|---|
| `environment` | `deploymentRoleOf(process.env)` at runtime | Vercel sets `VERCEL_ENV` and `VERCEL_GIT_COMMIT_REF` per deployment, so the runtime value is the build's value. The admin Environment page already relies on these at runtime |
| `commit` | `APP_BUILD_COMMIT`, set in `next.config.js` `env` at build: `VERCEL_GIT_COMMIT_SHA`, otherwise `git rev-parse HEAD` (try/catch, so a build without git still succeeds), otherwise empty. The route returns the **first 7 characters**, or `null` if the value is not a 40-character hex SHA | The git fallback makes a **local build** report its commit too ("Done when" asks for the three fields on a local build) |
| `builtAt` | `APP_BUILT_AT`, set in `next.config.js` `env` to `new Date().toISOString()` at build | Vercel offers no build-time variable. Under `npm run dev` it is the time the dev server started |

`next.config.js` `env` inlines the values into the compiled code, so they are fixed at build and cannot be changed by a runtime setting. Both new names are catalogued (`config`, shape `gitSha` / a new `isoTimestamp` shape or `identifier`, see SA Q2), and the `consumedBy` marker comes off `VERCEL_GIT_COMMIT_SHA`, which `next.config.js` now reads. `VERCEL_GIT_COMMIT_REF` gets read by the role function, so its marker comes off too.

**SA Q2:** an inlined value is not in the runtime `process.env`, so the Environment page will show both new names as "Not set" on a deployment. Proposed: catalogue them as `OPTIONAL` with a role sentence that says so. Alternative: give them a `consumedBy: platform`-style marker. Which one?

### 3.3 The route: `app/api/version/route.ts`

- `GET` only. `export const dynamic = 'force-dynamic'` and `Cache-Control: no-store`, so a CDN never serves one build's answer for another.
- The response passes through a **strict Zod output schema** (`lib/validation/app-version-schema.ts`, `.strict()`), so an extra field fails the parse instead of reaching the client. Input: the route takes no parameters. Query parameters are ignored (validated as "none are read").
- Body: `{ success: true, data: { environment, commit, builtAt } }`, the project's response format. **SA Q3:** the smoke test would find a flat body simpler. Proposed: keep the project format.
- Pino via `createLogger({ module: 'AppVersionAPI' })` with a `correlationId` child. It logs at `debug` only (a probe endpoint must not fill the logs). No audit: nothing changes.
- An error returns 500 with the standard error body, `details` only in development.

**SA Q4, public or authenticated.** Proposed: **public**. Reasons: the smoke test (R10) must call it against Staging and Production with no session, and a smoke test that needs a login can fail for a reason that has nothing to do with the build. What it exposes: the role word, a 7-character SHA of a **public** repository, and a timestamp. The SHA tells a reader which public commit is live. That is the purpose of the endpoint, and nothing else is returned. Alternative: authenticated, which makes R10 hold a test account on Production.

### 3.4 The version line

- `components/version/AppVersionLine.tsx` (`'use client'`). It fetches `/api/version` once on mount and renders `Staging · a1b2c3d · built 2026-11-26 14:02 UTC` in small muted text. While loading it renders nothing. On a failure it renders nothing and logs nothing (the line is a convenience and must never break a page).
- A pure formatter `formatVersionLine(data)` in `lib/version/formatVersionLine.ts`, unit-tested. Time: **UTC**, `YYYY-MM-DD HH:MM UTC`. **SA Q5:** a build time is not a client-facing business hour, so `user_preferences.timezone` does not apply. Showing UTC with a label avoids the timezone trap and gives the same string to everyone who quotes it in a bug report.
- Placement:
  - Settings: `app/business-os/settings/page.tsx`, under the last settings card (after Delete account), centred.
  - Admin: `app/admin/components/AdminChrome.tsx`, at the bottom of `<main>`, so every admin page shows it.
- Text is not translated: it is a technical identifier that is quoted in bug reports. The role words are English on purpose. **SA Q6:** confirm.

---

## 4. Files

| File | Change |
|---|---|
| `lib/admin/environment/classifyEnvironment.ts` | + `deploymentRoleOf` |
| `lib/version/appVersion-types.ts` | New: `DeploymentRole`, `AppVersion`, `DEPLOYMENT_ROLE_WORDS` (client-safe, no imports) |
| `lib/version/readAppVersion.ts` | New, server-only: builds `AppVersion` from an env argument (pure, testable) |
| `lib/version/formatVersionLine.ts` | New, pure formatter |
| `lib/validation/app-version-schema.ts` | New: strict Zod output schema |
| `app/api/version/route.ts` | New route |
| `components/version/AppVersionLine.tsx` | New client component |
| `app/business-os/settings/page.tsx` | + one `<AppVersionLine />` |
| `app/admin/components/AdminChrome.tsx` | + one `<AppVersionLine />` |
| `next.config.js` | + `env: { APP_BUILD_COMMIT, APP_BUILT_AT }` |
| `lib/admin/environment/catalogue.ts` | + two entries; `consumedBy` off the SHA and REF entries |
| Tests | `app/api/version/__tests__/route.test.ts`, `lib/version/__tests__/*.test.ts`, `deploymentRoleOf` cases in `classifyEnvironment.test.ts` |

No database, no migration, no env var to set on any platform, no feature flag.

---

## 5. Tasks

| # | Task | Status |
|---|---|---|
| T-1 | `deploymentRoleOf` + tests | ✅ |
| T-2 | Types, reader, formatter, Zod schema + tests | ✅ |
| T-3 | `next.config.js` env + catalogue entries; drift guard green | ✅ |
| T-4 | Route + route test (happy path, failure path, no extra field) | ✅ |
| T-5 | `AppVersionLine` + placement in Settings and admin | ✅ |
| T-6 | Typecheck of touched files, `npm run build`, local probe of `/api/version` | ✅ (SA-V9 open until the Vercel preview build) |

### 5.1 Dev implementation notes (deviations from §3–§4, all within SA-V1 to SA-V11)

| Planned | Built | Why |
|---|---|---|
| `APP_BUILT_AT` | **`APP_BUILD_TIME`** | Both build-identity names share the `APP_BUILD_` prefix, so one search finds every reader (SA-V6's source test greps for it) |
| `lib/version/appVersion-types.ts` | **Not created.** `DeploymentRole` is in `lib/admin/environment-types.ts` (SA-V2); `AppVersion` is `z.infer` of the schema in `lib/validation/app-version-schema.ts`; the words are `DEPLOYMENT_ROLE_WORDS` in `lib/version/formatVersionLine.ts` | One definition per thing. `environment-types.ts` is types-only, so the runtime role list lives in the schema, with a compile-time check that it matches the type |
| `execSync` (SA-V4) | **`execFileSync('git', ['rev-parse','HEAD'])`** with the same stdio, 3 s timeout and catch | No shell is spawned, so nothing in the command can be interpreted by one |
| — | Admin chip words `Production` / `Preview` → **`Vercel production` / `Vercel preview`** (SA Q1), with the three test strings in `page.render.test.tsx` | SA Q1 |
| — | `catalogue.test.ts` K-6 no longer lists SHA and REF among the `consumedBy` entries | SA-V3: both are now read by code |

The drift guard passes unedited (SA-V3).

---

## 6. SA review — workplan

**Reviewed by SA — 2026-11-27**
**Status:** ✅ APPROVED WITH CONDITIONS (SA-V1 to SA-V11). Implementation may start. Code review checks each condition.

### Findings that drive the conditions

- **(a) Role keyed on the branch: correct.** This is the right reading of "follow how that module labels it": the new label extends `environmentLabelOf` in the same module, so there is still one classifier. Branch is the build's identity under DEVELOPMENT_LIFECYCLE §3, whichever way the Vercel projects end up. The Supabase project role (`supabaseProjects.ts`) is the wrong key. It describes the **database**, and its own wording rule (OQ-5) says it never states which deployment uses it. It only labels origins found in the table. And a stamp keyed on it would hide exactly the misconfiguration it should expose: a Production build pointed at the dev database. **"Staging" on today's live `main` build is right.** §3 says `main` is Dev/Staging, the only project in the table is `development-staging`, and the bug form's environment values are `production / staging`. One correction to the table is needed (SA-V1).
- **(b) Inlining is sound, with one guard trap.** The scanner counts `process.env` reads only. `deploymentRoleOf(env)` reads `env['VERCEL_GIT_COMMIT_REF']` from an argument, which the guard does not see. If the route passes `process.env` whole, the guard counts it as a new unpinned whole-object site and goes red, and the REF entry would then have no read and no marker. See SA-V3. `APP_BUILD_*` are read literally, so a `consumedBy` marker on them would itself fail the guard ("marker on a read name"). That settles Q2.
- **(c) Public: agreed.** §5.4 (now on `main`, PR #688) says the stamp is what "support, customers and the QA agent can see". The endpoint holds no secret, does no DB work and takes no input. The skill's "public routes verify a signature" line is about webhooks that act. A read-only build stamp has nothing to verify. Document this in the route header (SA-V5).
- **Stale baseline.** Since this branch was cut, `origin/main` has gained §5.4, so the Overview's "§5.4 is not on `main` yet" is now wrong (SA-V11).

### Rulings on Q1–Q6

| Q | Ruling |
|---|---|
| Q1 | **No payload change on `/admin/environment` in this slice. But fix the contradiction now.** `AdminChrome` puts the version line on that page as well, so today an admin would see a "Production" chip above "Staging · …". Change the `production` / `preview` text in `ENVIRONMENT_LABEL_WORDS` to "Vercel production" / "Vercel preview", matching the existing "Vercel development". That chip *is* the Vercel environment, and it still drives `checkedAgainst`. Two strings, no logic. Showing the role on that page is a follow-up |
| Q2 | **`OPTIONAL`, sensitivity `config`, no `consumedBy`.** A marker is impossible because the names are read literally (see (b)). Shapes: `gitSha` for `APP_BUILD_COMMIT`, and the existing `identifier` for `APP_BUILT_AT` (an ISO string matches it). **No new `isoTimestamp` shape.** Each role sentence says the value is inlined at build, so this page shows it as not set |
| Q3 | **Keep the project format** `{ success, data }`. A smoke test reads `data.commit` just as easily, and a one-off format is a new pattern |
| Q4 | **Public**, under SA-V5 |
| Q5 | **UTC, labelled.** Agreed: a build time is not a business hour, and every reporter must quote the same string |
| Q6 | **English and untranslated: confirmed.** In an RTL page it must still read left-to-right (SA-V8) |

### Conditions

- **SA-V1 (Production fails closed).** `production` is returned only for `environmentLabelOf === 'production'` **and** ref `production`. `preview` + ref `production` returns `unknown`. A legitimate Production build always has `VERCEL_ENV=production` in both project setups. A preview on a branch named `production` (e.g. created before the cutover) runs Preview's variables and must never call itself Production. Staging stays `production|preview` + `main`. Every row of the table gets a test case, plus an empty or missing ref and a case-variant ref (`Main`, which must not match).
- **SA-V2 (one role type).** Define `DeploymentRole` once, next to `EnvironmentLabel` in `lib/admin/environment-types.ts` (types only, client-safe). `lib/version/appVersion-types.ts` imports it. The admin module must not import from `lib/version/`. The API returns the **lowercase role id** (closed Zod enum). Words are applied only in the UI.
- **SA-V3 (drift guard).** The reader takes an explicit object of literal reads (`{ VERCEL_ENV: process.env.VERCEL_ENV, NODE_ENV: process.env.NODE_ENV, VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF, APP_BUILD_COMMIT: …, APP_BUILT_AT: … }`). **No whole-object `process.env`, no new `PINNED_SITES` entry.** Remove the `consumedBy` marker from SHA (read by `next.config.js`) and from REF (now read literally). Run the guard with no other edits to it, and it must pass.
- **SA-V4 (`next.config.js`).** Use `VERCEL_GIT_COMMIT_SHA` when set. Otherwise run `git rev-parse HEAD` via `execSync` with `stdio: ['ignore','pipe','ignore']`, a timeout of 3 s or less, and try/catch. Keep the value only if it is 40 hex characters, and lower-case it. Both `env` values must always be **strings** (`''` when unknown), never `undefined`. Add a block comment saying why the values are inlined. This is the first `env` block in the repo, and SA approves it as the pattern for build identity only. Nothing else goes in it.
- **SA-V5 (route).** No `getUser`. A header comment explains why the route is public, citing §5.4. `GET` only, `dynamic = 'force-dynamic'`, `Cache-Control: no-store`. The output goes through a `.strict()` schema: `environment` enum, `commit` `/^[0-9a-f]{7}$/` or null, `builtAt` ISO datetime or null. A value that fails maps to `null`, never to a 500. No DB, no audit, logs at `debug` only. `correlationId` is logged and never put in the body.
- **SA-V6 (server-only).** `APP_BUILD_*` are read only in `lib/version/readAppVersion.ts`, which has `import 'server-only'`. The client component reads nothing from `process.env`.
- **SA-V7 (route tests, replacing the skill's 401/400 pair).** Cover: the happy path; a request with **no session** still returns 200; query parameters are ignored; an injected extra field fails the strict parse; a malformed SHA and a malformed builtAt give `null`; and the error path returns 500 with `details` only in development. Tests inject env fixtures and never read real values or assert on any real SHA.
- **SA-V8 (version line).** `fetch('/api/version', { cache: 'no-store' })` once on mount, aborted on unmount. Render nothing while loading or on failure, and no `console.*`. Wrap the line in `dir="ltr"` so an RTL Settings page does not reorder the SHA and date. If a field is null the formatter omits that part and never prints "null".
- **SA-V9 (build cost).** `builtAt` changes on every build. In T-6, check the preview build log: the build cache must be restored, and compile time must be within roughly 20% of a recent `main` build. If the whole webpack cache is invalidated, stop and raise it before PR (CI-time rule).
- **SA-V10 (no values anywhere).** No real SHA, hostname, project ref or build time in code, tests, catalogue roles or docs. Fixtures use obvious fakes (`'a'.repeat(40)`).
- **SA-V11 (baseline).** Before PR, sync the branch with `origin/main`, which now includes PR #688. Point the Overview at DEVELOPMENT_LIFECYCLE §5.4 as the spec. No environment changes are needed (no env var, migration or setting), so there is no `## Environment changes` section.

### Optimisation suggestions (non-blocking)

- Put `deploymentRoleOf` directly under `environmentLabelOf` and give it a one-line pointer to §3, so the next person who edits the topology finds it.
- Note in the R19 row of DEVELOPMENT_LIFECYCLE §13 that it is done, once it merges.

### Approval
[x] Workplan approved. Proceed to implementation under SA-V1 to SA-V11.

## 7. SA review — code

**Code Review by SA — 2026-11-27**
**Status:** 🔄 APPROVED WITH CONDITIONS. Fix SA-C-1 and SA-C-2 (both small, no re-review of the rest needed; SA re-checks those two lines only), then QA. SA-V9 and SA-V11 stay open for T-6 / before PR, as planned.

Re-ran: `npx jest app/api/version lib/version components/version lib/admin/environment app/admin/environment` (10 suites, 265 tests, green, drift guard unedited) and `admin-authz-surface.guard` + `business-os-llm/source.guard` (both read the admin shell; 617 tests, green).

### Per-condition check

| Condition | Result | Evidence |
|---|---|---|
| SA-V1 Production fails closed | ✅ | `deploymentRoleOf`: `production` only for label `production` + ref `production`; `preview` + `production` → `unknown`. Table rows, empty/missing ref, `Main`, `Production`, `production-old` all tested |
| SA-V2 one role type | ✅ | `DeploymentRole` once in `lib/admin/environment-types.ts`; `DEPLOYMENT_ROLE_IDS` has a compile-time match check; API returns the lowercase id (closed enum); words only in `formatVersionLine.ts`. `lib/admin/` imports nothing from `lib/version/`. Dropping `appVersion-types.ts` accepted |
| SA-V3 drift guard | ✅ | Literal reads in `currentAppVersionSource()`, no whole `process.env`, no `PINNED_SITES` change; markers off SHA and REF; guard passes unedited |
| SA-V4 `next.config.js` | ✅ | Vercel SHA first, git fallback with ignored stdin/stderr, 3 s timeout, catch, 40-hex + lower-case, both values always strings, block comment limits the `env` block to build identity. `execFileSync` (no shell) is an improvement, accepted. `APP_BUILD_TIME` rename accepted |
| SA-V5 route | ✅ | No auth import, header cites §5.4 and Q4, GET only, `force-dynamic`, `no-store` on 200 and 500, `.strict()` schema, malformed values → `null` in the reader, debug-only log, `correlationId` logged and not returned |
| SA-V6 server-only | ✅ | Only `lib/version/readAppVersion.ts` reads `APP_BUILD_*` (it has `import 'server-only'`, and a source test pins both facts). The client component imports only the schema and the formatter, which hold type-only imports. Checked against Next 14.2.35: `getNextConfigEnv` defines `process.env.APP_BUILD_*` for every compiler (server included), so the route gets the build values; the client bundle has no reference, so it carries no value |
| SA-V7 route tests | ✅ (see SA-C-3) | Happy path, no session, query ignored, extra field → 500 with no leak, malformed SHA/time → `null`, `details` only in development, fixtures only |
| SA-V8 version line | ✅ | One `no-store` fetch, abort on unmount, nothing while loading or on failure, no `console.*`, `dir="ltr"`, never prints "null" — each one tested |
| SA-V9 build cost | ⬜ open (T-6) | Lower risk than feared: Next 14.2.35's webpack cache `version` key does not include `config.env`, and webpack 5's DefinePlugin rebuilds only the modules that reference a changed key (here, `readAppVersion.ts`). Still check the preview build log in T-6 |
| SA-V10 no values | ✅ | Fixtures are obvious fakes; catalogue roles, comments and docs hold no real SHA, host or time |
| SA-V11 baseline | ⬜ open (before PR) | Overview points at §5.4. The branch does not yet contain the local `origin/main` tip; sync before the PR |

CLAUDE.md: no `console.*` in any touched or new file (rule 3); the route takes no input and parses its output (rule 2); error body matches the standard format with the development guard; no DB access, so rules 1 and 4 do not apply; the `env` block is the pattern SA approved under SA-V4, and `import 'server-only'` is already used in `lib/admin/billing/` (rule 7).

### Code Review Comments

1. **SA-C-1** `app/business-os/settings/page.tsx:1227` — **the version line is in the wrong container.** Parsed the JSX: its parent is the `grid grid-cols-1 lg:grid-cols-2 gap-6` div (line 784), so it becomes a **third grid item**. On a desktop it lands in the left cell of a new grid row, centred in that half of the page, not under Delete account (right column) and not centred on the page. On a phone it looks right, which is why it is easy to miss. Move it after the grid's closing `</div>`, as a direct child of the `PAGE_CONTAINER … space-y-8` div, and drop `mt-6` (the `space-y-8` already spaces it). — Priority: **Medium** (must fix)
2. **SA-C-2** `app/admin/components/AdminChrome.tsx:5-8` — the header still says the file is the old layout "MOVED VERBATIM. The only change is the component name." That is now false. Add one sentence, e.g. "Since R19 it also renders the version line at the bottom of `<main>`." (The matching line in `app/admin/layout.tsx:26-27` describes the move itself and can stay.) — Priority: **Low** (must fix: a comment that is wrong about a security-relevant split misleads the next reader)
3. **SA-C-3** `app/api/version/__tests__/route.test.ts` V-2 — it mocks `@/lib/auth` `getUser`, which the route never imports, so `not.toHaveBeenCalled()` cannot fail. The 200-without-session part is real. Optional: replace the dead assertion with a source check that `route.ts` imports no auth module. — Priority: Low (non-blocking)
4. **SA-C-4** `components/version/AppVersionLine.tsx:35` — the client also parses with the `.strict()` schema, so if a later slice adds a field, a tab still running the older bundle shows no line until reload. This is consistent with S-1 (three fields, nothing else) and fails safe. Whoever extends the payload must change the schema knowingly. — Priority: Info (non-blocking)
5. **SA-C-5** `lib/version/readAppVersion.ts:54-61` — a build time outside years 0–9999 would normalise to the extended ISO form, which `z.string().datetime()` rejects, so the route would return 500 instead of `null`. It cannot happen with the value `next.config.js` sets. Noted only. — Priority: Info (non-blocking)

### Optimisation Suggestions
- Once SA-C-1 is fixed, QA should check the Settings page at desktop width and in Hebrew (RTL), which is the case the move is about.

### Code Approved for QA: Yes, once SA-C-1 and SA-C-2 are fixed

## 8. QA report

**QA — 2026-11-27**
**Test mode:** full
**Strategy used:** A + B (Jest unit, render and route suites), C (production build plus a local `next start` probe with `curl`), and a bundle scan. No browser check (Option D) was done. See "Not verified" below.
**Focus:** api, ui (source level), security (public surface, no values leaked)
**Skipped:** the manual browser check of the version line, because this pass was scoped to automated checks and the local probe
**Input source:** TL prompt (items 1 to 5)

### What was run

| # | Check | Result |
|---|---|---|
| Q-1 | `npx jest app/api/version lib/version components/version lib/admin/environment app/admin/environment app/business-os/settings app/admin/components`, run alone | ✅ PASS: **46/46 suites, 1362/1362 tests**, 51.8 s. No suite timed out. The drift guard (`catalogueDrift.guard.test.ts`) passed with no edits to it |
| Q-2 | `npm run build` with `NODE_OPTIONS=--max-old-space-size=8192` | ✅ PASS, with a note. The first two attempts failed at "Collecting page data" (`supabaseUrl is required`, then `Missing credentials … OPENAI_API_KEY`). The cause is environmental: the worktree has no `.env.local`, and unrelated routes (`/api/admin/boost-packs`, `/api/business-os/chat-v2`) build their clients when imported. This is **not** the next/font flake and **not** caused by this diff. The third build used the same placeholder env set as `.github/workflows/build.yml` (`ci.invalid` and `ci-not-a-real-key` values, no real secret) and succeeded: `✓ Compiled successfully`, exit 0. The route table lists `ƒ /api/version` (Dynamic) |
| Q-3a | Happy path: `curl -i http://localhost:3917/api/version` with no cookies, against `next start` | ✅ PASS: `200`, `cache-control: no-store`, `content-type: application/json`. Body `{"success":true,"data":{"environment":"unknown","commit":<7 hex>,"builtAt":<ISO>}}`. Top-level keys are exactly `success, data`, and `data` keys are exactly `environment, commit, builtAt`. `commit` is 7 lower-case hex characters and **matches HEAD**. `builtAt` is the ISO time this build stamped (the same value found in the server bundle) |
| Q-3b | `environment` value | ✅ PASS: `unknown`. This is correct for `deploymentRoleOf`: `next start` runs with `NODE_ENV=production` and no `VERCEL_ENV`, so `environmentLabelOf` returns `unknown` (`local` needs `NODE_ENV=development`), and the role maps `unknown` to `unknown` |
| Q-3c | No session | ✅ PASS: both probes were sent with no cookies and got 200. That is the public probe R10 will use |
| Q-3d | `?commit=x&environment=production` | ✅ PASS: 200, and the body is byte-identical to Q-3a (`cmp`). The query is ignored |
| Q-3e | Extra: `POST /api/version` | ✅ PASS: 405, GET only |
| Q-3f | Client bundle | ✅ PASS: the full 40-character HEAD SHA is in **0** files under `.next/static` and in exactly 1 server file (`.next/server/app/api/version/route.js`). The 7-character short SHA and the build timestamp are also in 0 files under `.next/static`. The one client hit for the string `APP_BUILD` is Next's own `APP_BUILD_MANIFEST` constant in `main-*.js`, which is unrelated. This confirms SA-V6: the values reach the server bundle only |
| Q-3g | Server shutdown | ✅ The server was stopped by its own PID with `taskkill /PID … /T`. Port 3917 is free and the npx parent has exited. Nothing was killed by image name |
| Q-4 | Failure path (route tests, in Q-1 and re-run alone with `--verbose`: 15/15) | ✅ PASS. **V-6** (×4: short, non-hex, empty and missing SHA each give `commit: null` with 200). **V-7** (×3: garbage, empty and missing build time each give `builtAt: null` with 200). **V-8**: an injected extra field fails the `.strict()` parse, returns 500, and the field does not appear in the body. **V-9**: the 500 includes `details` only in development. Also green: V-1 to V-5 and V-10 (V-2 now checks the source, so `route.ts` imports no auth module, which resolves SA-C-3) |
| Q-5 | SA-V10 scan of `git diff` plus every untracked new file | ✅ PASS. HEAD's SHA appears 0 times, either full or as its 7-character prefix. Every hex string of 7 or more characters is an obvious fake (`a1b2c3d`, `abcdef0`, `0123456`, `fffffff`, `ABCDEF0`, `'0123456789abcdef…'`, `'abcdef0123…'`). There are no email addresses. The only URLs are `http://localhost/api/version` test request URLs. There are no 20-character project-ref strings and no key or secret patterns. The only ISO times are the fake fixture `2026-01-02T03:04:05Z` |

### Test Coverage

| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| S-1 `GET /api/version` returns only `{ environment, commit, builtAt }` | ✅ | Pass | Q-3a key check, V-3, V-8 |
| S-1 public, no session needed | ✅ | Pass | Q-3c, V-2 |
| S-1 query parameters cannot change the answer | ✅ | Pass | Q-3d, V-4 |
| S-1 never cached | ✅ | Pass | `no-store` on the 200 (Q-3a) and the 500 (route tests); `ƒ` dynamic in the build |
| S-3 the SHA comes from the build (git fallback on a local build), shortened to 7 | ✅ | Pass | Q-3a matches HEAD; SHA stays out of the client bundle (Q-3f) |
| S-3 `builtAt` fixed at build | ✅ | Pass | The value served equals the value inlined in the server bundle |
| S-4 role reuses `lib/admin/environment/` and fails closed for Production | ✅ | Pass | `classifyEnvironment.test.ts`, V-5, Q-3b |
| S-2 version line in Settings and admin | ⚠️ | Partial | Render tests (`AppVersionLine.render.test.tsx`) and the settings and admin suites pass. Placement after the SA-C-1 fix was **not checked in a browser** |
| Failure path is soft (malformed value gives null, error gives 500 and no leak) | ✅ | Pass | V-6 to V-9 |
| SA-V10 no real values in the diff | ✅ | Pass | Q-5 |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None found. SA-V9 (the build cache is restored and compile time is within about 20% on a Vercel preview build) can only be checked in the preview build log, so it is still open for T-6 and the PR.

#### Edge Cases / Notes (nice to fix)
1. **Local build needs env placeholders** (Info, not caused by this change). Without `.env.local`, a fresh worktree fails `npm run build` at "Collecting page data" because unrelated routes create clients when imported. CI already sets placeholders in `build.yml`. Dev and QA building in a worktree must do the same.
2. **Not verified:** the Settings version line at desktop width and in Hebrew (RTL), as SA asked in §7. No browser was driven in this pass. The `dir="ltr"` wrapper is covered by the render test only.

### Test Outputs / Logs

```text
Test Suites: 46 passed, 46 total
Tests:       1362 passed, 1362 total
Time:        51.81 s

 ✓ Compiled successfully
├ ƒ /api/version                                                    0 B                0 B

HTTP/1.1 200 OK
cache-control: no-store
{"success":true,"data":{"environment":"unknown","commit":"<matches HEAD>","builtAt":"<this build>"}}
POST /api/version -> 405
```

### Final Status
- [x] All acceptance criteria tested by automation pass, with no bugs. **Verdict: PASS, ready for the user diff.** Still open, none of them a QA blocker: a browser check of the Settings line at desktop width and in RTL (S-2 placement), SA-V9 (preview build log), and SA-V11 (sync with `origin/main` before the PR)
- [ ] Issues found. Dev must address them before commit

### 8.1 Dev follow-up after QA (2026-11-27)

| Item | Result |
|---|---|
| SA-C-1, SA-C-2, SA-C-3 | Fixed before QA ran (QA §8 confirms SA-C-3) |
| Placement, Done-when "shows in Settings and admin" | New render test `app/business-os/settings/__tests__/appVersionPlacement.render.test.tsx`: the real `AppVersionLine` renders in the real Settings page **below** the two-column grid as a sibling, not inside it, and in `AdminChrome` inside `<main>` after the page content. ✅ |
| Touched suites, two workers | 47/47 suites, 1364/1364 tests ✅ |
| SA-V11 | Branch fast-forwarded to `origin/main` after the SA code review ✅ |
| Typecheck | Full `tsc --noEmit` ran to completion with semantic errors elsewhere present (so the semantic pass ran); 0 errors in any touched file ✅ |
| **Still open** | **Browser check** of both lines (desktop, and Settings in Hebrew/RTL): not done, because a signed-in session needs the real `.env.local`, which no worktree here carries. **SA-V9** cache/compile-time check: read from the Vercel preview build log once a PR exists |

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-11-27 | Created | Dev workplan, Q1–Q6 open for SA |
| 2026-11-27 | Implemented | T-1 to T-5 done; §5.1 records the deviations |
| 2026-11-27 | SA code review | §7: approved with conditions; SA-C-1 (Settings placement) and SA-C-2 (AdminChrome header) to fix |
| 2026-11-27 | QA | §8: PASS, no bugs. Jest 46/46 suites (1362 tests), build green with `ƒ /api/version`, local probe 200 + no-store + three fields + commit matches HEAD, SHA absent from the client bundle, SA-V10 scan clean. Open: browser check of the Settings line, SA-V9, SA-V11 |
| 2026-11-27 | Dev follow-up | §8.1: placement render test added, SA-V11 synced, touched suites 47/47; browser check and SA-V9 still open |
