# Requirement: Admin Environment Configuration View

> **Last Updated**: 2026-10-27

**Created by:** BA
**Date:** 2026-10-26
**Status:** SA-reviewed 2026-10-26: **approved with changes**. OQ-1 to OQ-10 ruled and conditions SA-C1 to SA-C14 set in §10.1; where §3 to §8 disagree with §10.1, §10.1 wins until BA folds the rulings into the body. EC-1 may start its workplan. Not yet "Approved": that needs user or TL sign-off.
**Related:** [ADMIN_LAYOUT_STANDARD_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md), [ADMIN_IDENTIFICATION_AND_ACCESS.md](/docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md), [feature_flags.md](/docs/feature_flags.md), [ENVIRONMENTS_AND_DEPLOYMENT_STRATEGY.md](/docs/ENVIRONMENTS_AND_DEPLOYMENT_STRATEGY.md)

## Overview

Admins have no way to see how a running deployment is configured. To learn whether a feature switch is on, whether an email provider is set up, or which environment they are looking at, someone has to open the Vercel dashboard or a developer's `.env.local`. This feature adds a **read-only "Environment" page under Settings in `/admin`**. It lists every environment variable the application uses, grouped by what it is for, with a one-sentence role for each. Switches (true/false) are shown in plain text. Secrets are never sent to the browser: the page shows only whether each one is set. Variables the code expects but that are missing show as **Not set**. Nothing on the page can change a setting.

> **Public repository.** This document lists variable **names**, groups, roles and design only. It must never contain a value, part of a value, a project reference, or a remark about the state of any credential. The same rule applies to every later edit, workplan and PR description in this stream.

---

## Table of Contents

1. [Progress](#1-progress)
2. [User Stories](#2-user-stories)
3. [Settled design points](#3-settled-design-points)
4. [Functional Requirements](#4-functional-requirements)
5. [Variable catalogue: groups and roles (seed)](#5-variable-catalogue-groups-and-roles-seed)
6. [Non-Functional Requirements](#6-non-functional-requirements)
7. [Slices](#7-slices)
8. [Acceptance Criteria](#8-acceptance-criteria)
9. [Out of Scope / Future Roadmap](#9-out-of-scope--future-roadmap)
10. [Open Questions for SA](#10-open-questions-for-sa) (rulings and conditions: [10.1 SA Review](#101-sa-review-2026-10-26))
11. [Notes on Integration Points](#11-notes-on-integration-points)
12. [Change History](#change-history)

---

## 1. Progress

> The single source of truth for this stream. Every SA ruling, PR, merge and deferral is recorded here.

| # | Slice | Status | PR | Notes |
|---|---|---|---|---|
| 0 | This requirement | SA-reviewed 2026-10-26: approved with changes. Awaiting user or TL sign-off | — | SA 2026-10-26: OQ-1..OQ-10 ruled; conditions SA-C1..SA-C14 (§10.1). BA to fold the rulings into §3 to §8 on the next revision |
| 1 | EC-1: catalogue, server reader, masking, admin route | 🟡 In PR 2026-10-27: SA code review approved (CR-1..CR-3, QF-1..QF-3), QA passed | PR pending (with EC-2) | Full cycle (new pattern, security-sensitive). Carries SA-C1..SA-C10, SA-C12, SA-C14. Workplan [ADMIN_ENVIRONMENT_VIEW_WORKPLAN.md](/docs/workplans/ADMIN_ENVIRONMENT_VIEW_WORKPLAN.md) SA-approved with changes (RC-1..RC-8). Inventory: 133 names catalogued. **For BA to fold in:** (a) a new group "Other external services" (`external`) directly after Plugins & OAuth, for outside services that are not plugins (SA Q-3; amends §3.4 and §5); (b) `STRIPE_WEBHOOK_SECRET` is expected required on production only, optional on preview and local (SA Q-10; amends §5.7); (c) §5 seed names `MISTRAL_API_KEY` and `NEXT_PUBLIC_WEBSITE_BASE_HOST` are read by no code and are not catalogued |
| 2 | EC-2: the page and the sidebar entry | 🟡 In PR 2026-10-27: SA approved, QA PASS with notes (owed: live admin check after deploy) | PR pending (with EC-1) | UI short path (OQ-1), SA reviews the sidebar and nav-pin diff. Carries SA-C11, SA-C14 |
| 3 | EC-3: catalogue drift guard (Jest) | ⬜ | — | Full cycle. Budget ruled (OQ-9): at most 5 s in a gate shard, no new job or script. Carries SA-C13 |
| 4 | EC-4: diagnostics: required-but-missing, wrong-environment, flag-value checks, KPI strip, filters | ⬜ | — | Reads `expectedIn` (OQ-7), which EC-1 already ships as data |
| 5 | EC-5 (optional): safe descriptors for selected secrets | Deferred by SA (OQ-6) | — | Moved to §9 roadmap; not built in this stream |

---

## 2. User Stories

- As a platform admin, I want to see every setting the running deployment uses, grouped by what it is for, so that I can understand how the system is set up without opening Vercel or a developer's machine.
- As a platform admin, I want to know which environment I am looking at (Production, Preview, or Local), so that I never confuse a preview's setup with production's.
- As a platform admin, I want to see each feature switch as On or Off, so that I can tell at a glance which features are live here.
- As a platform admin, I want secrets shown only as Set or Not set, so that I can confirm a provider is configured without the secret ever reaching my browser.
- As a platform admin, I want settings the code needs but that are missing to show as Not set, so that I find a missing setting before it causes a problem.
- As a developer, I want a test that fails when code reads a variable the catalogue does not describe, so that the page cannot fall out of date without anyone noticing.

---

## 3. Settled design points

Each point the brief asked this requirement to settle, with the recommended answer. SA rules on each (§10 lists the ones that need an explicit ruling).

### 3.1 Where the values come from

**Recommendation: the server reads its own `process.env` at request time. No Vercel API, no file read.**

| Where the app runs | What `process.env` holds | What the page therefore shows |
|---|---|---|
| Vercel Production | That production deployment's environment variables, plus variables Vercel and the runtime inject | Production's setup |
| Vercel Preview | That preview deployment's variables | That preview's setup, not production's |
| Local `npm run dev` | The merged result of the `.env*` files Next.js loads (`.env.local` among them) plus the developer's operating-system environment | The developer's local setup |

Consequences the page must state in words, not leave to be inferred:

| # | Caveat | How the page handles it |
|---|---|---|
| C-1 | **A change in Vercel is not visible until a redeploy.** A running deployment keeps the variables it was deployed with. | A standing note: "Shows this deployment's settings. A change made in Vercel appears here after the next deploy." |
| C-2 | **`NEXT_PUBLIC_*` values are inlined into the browser bundle at build time.** The server sees the runtime value; the browser code uses the value baked in at build. On Vercel both come from the same deployment build, so they agree. | Each `NEXT_PUBLIC_*` row carries a scope marker "Built into the browser bundle". The page does **not** try to read the bundle's copy. |
| C-3 | **Computed reads (`process.env[name]`) are populated only in the Node.js runtime.** On the Edge runtime only literal `process.env.NAME` accesses are filled in. | The route must run on the Node.js runtime (SA to confirm the exact route-segment config). |
| C-4 | **A route that Next.js can render at build time would freeze the values at build.** | The route must be dynamic and answer `Cache-Control: no-store` (SA to confirm the config). |
| C-5 | **Locally, the page cannot say which `.env*` file a value came from.** It sees only the merged result. | The Local label says "Local (merged `.env*` files)". |

**Environment label.** The page header shows one environment chip, decided on the server:

| Condition | Label |
|---|---|
| `VERCEL_ENV` is `production` | Production |
| `VERCEL_ENV` is `preview` | Preview |
| `VERCEL_ENV` is `development` (Vercel CLI dev) | Vercel development |
| No `VERCEL_ENV`, `NODE_ENV` is `development` | Local |
| Anything else | Unknown environment (shown amber) |

`NODE_ENV` alone is never used to decide Production: Vercel builds previews with `NODE_ENV=production`. Next to the chip, the page shows the non-secret deployment facts that help an admin place the deployment: the deployment host, region, and git branch and commit, when the platform provides them (§5.1).

### 3.2 Masking: server-side, fails closed

**Rule zero: a value the catalogue does not positively allow to be shown never leaves the server.** Masking happens in the route, before the response is built. The browser receives a display string or a status, never the raw value of a masked variable, not even to an admin.

Every variable has exactly one **sensitivity class**:

| Class | Examples (names) | What the response carries | Shown as |
|---|---|---|---|
| `flag` | `ADMIN_BUSINESS_DELETE_ENABLED`, `NEXT_PUBLIC_USE_V6_AGENT_GENERATION` | The parsed verdict from the shared `parseBooleanFlag` (with the variable's documented default), plus the raw value **only** when it is one of `true`, `false`, `1`, `0` (case-insensitive, trimmed) | **On** / **Off**, with "(default)" when unset. A set but unrecognised value shows "Set, not a recognised value: reads as Off" and the raw text is **not** echoed (it could be a pasted secret) |
| `secret` | API keys, client secrets, webhook secrets, signing keys, salts, passwords, tokens, service-role keys | Status only: `set` / `not_set` | **Set** / **Not set**. No length, no prefix, no suffix (recommended; see OQ-6 for the only proposed exception) |
| `config` | App URLs, public hosts, log level, region, numeric limits, public client IDs | The value, after the value-shape backstop below | Plain text |
| `personal` | `ADMIN_EMAILS`, account allow-lists | A count of non-blank comma-separated entries | "3 entries" (and for `ADMIN_EMAILS`, a link to Admin users, which already shows the addresses under its own rules) |
| *(not in catalogue)* | anything present in the environment that the catalogue does not list | Status only, as `secret` | Listed under **Uncategorised**, masked |

**Backstops (all fail closed, recommended):**

| # | Backstop | Rule |
|---|---|---|
| M-1 | **Name pattern overrides the catalogue.** | If a name contains `KEY`, `SECRET`, `TOKEN`, `PASS`, `PASSWORD`, `SALT`, `PRIVATE`, `CREDENTIAL` or `SIGNING`, it is treated as `secret` whatever the catalogue says. A `NEXT_PUBLIC_` prefix does **not** lift this rule. A catalogue entry that wants to show such a name in plain text (for example a publishable or "public" key) needs an explicit, reviewed exception flag on that entry. Recommendation: grant **no** exceptions in EC-1; showing a public key adds nothing an admin needs. |
| M-2 | **Value shape check for `config`.** | A `config` value is shown only if it looks like a URL, a host name, a number, or a short word from a small character set (letters, digits, `-`, `_`, `.`, `:`, `/`, up to a length SA sets). Anything else (long opaque strings, anything shaped like a JWT, anything with whitespace or quotes) is masked and the row says "Hidden: does not look like plain configuration". |
| M-3 | **URLs are shown without user-info or query string.** | A `config` URL has any `user:password@` part and any `?query` removed before it is returned. A connection string that carries credentials is catalogued as `secret`, not `config`. |
| M-4 | **Unknown means masked.** | Not in the catalogue, an unrecognised class, or any error while classifying: the row is masked. The route never falls back to "show". |
| M-5 | **Values are never logged.** | The route logs counts and names only. It never logs the environment object, a value, or the response body. |

### 3.3 The catalogue

**Recommendation: one typed, code-side registry, the single source of truth for what the page knows.** Location, file name and exact shape are SA's call (suggested: a module under `lib/admin/`, server-only, importing nothing that reads the environment itself).

Each entry carries:

| Field | Meaning |
|---|---|
| `name` | The exact variable name |
| `group` | One of the groups in §3.4 |
| `role` | One plain-English sentence: what it is for and what happens when it is missing |
| `sensitivity` | `flag` / `secret` / `config` / `personal` (§3.2) |
| `scope` | `server` or `browser-inlined` (`NEXT_PUBLIC_*`) |
| `requirement` | `required`, `optional`, `local-only` or `test-only` |
| `flagDefault` | For `flag` only: the default the reader applies when unset, so the page agrees with the code |
| `docLink` | Optional: a repository doc path, shown as text (the app does not serve `/docs`) |

How the page treats what it finds:

| Case | Shown as |
|---|---|
| Catalogued and set | In its group, value per its class |
| Catalogued and not set | In its group, **Not set**. EC-4 adds the emphasis: amber when `requirement` is `required` |
| Present, not catalogued, not platform noise | Group **Uncategorised**, masked, with the role "Not described in the catalogue yet." |
| Platform-injected noise | Not listed. One summary line: "N variables set by the hosting platform or operating system are not shown." |

**Platform noise (recommended: filter and summarise).** A small fixed list of useful platform variables is catalogued normally under "Environment & deployment" (§5.1). Everything else the platform or operating system injects is dropped from the list and counted: names beginning `VERCEL_` that are not catalogued, `AWS_` names that are not catalogued (the serverless runtime injects its own, some of which are credentials), `LAMBDA_`, `npm_`, Node.js internals, and the usual operating-system names (`PATH`, `HOME`, `USER`, `USERNAME`, `TEMP` and similar). The deny-list lives next to the catalogue. Locally this filter matters most: a developer's machine contributes dozens of operating-system variables that would otherwise flood Uncategorised. **No platform variable is ever shown in plain text unless the catalogue lists it as `config`.**

**Adding a new variable (process rule).** Whoever adds a `process.env.NAME` read adds a catalogue entry in the same PR. EC-3's guard enforces it (§3.5).

### 3.4 Groups

Groups follow what the setting is responsible for, not which vendor provides it. Order on the page:

| # | Group | What it covers |
|---|---|---|
| 1 | Environment & deployment | Which environment and deployment this is; Node mode |
| 2 | Database (Supabase) | Where the database is and the keys the app uses to reach it |
| 3 | Admin & sign-in | Who is an admin; sign-in options |
| 4 | App addresses | The addresses the app hands out: platform, public business sites |
| 5 | AI providers | Keys for each LLM provider |
| 6 | Plugins & OAuth | Client IDs and secrets for connected-app plugins; plugin credential encryption |
| 7 | Payments (Stripe) | Platform and Connect keys, webhook secrets, plan and boost switches |
| 8 | Email | Transactional email providers, in the order the transport tries them |
| 9 | Background jobs & queues | Cron authentication, the queue service and its signing keys |
| 10 | Tokens & data protection | Secrets that sign links or protect stored data |
| 11 | Feature switches | Product feature flags not owned by a group above |
| 12 | Logging & observability | Log level |
| 13 | Test & development tools | Settings for test harnesses; should not be on production |
| 14 | Uncategorised | Present in the environment but not described in the catalogue |

A flag that belongs to a domain sits in that domain's group (for example the plan checkout switch sits in Payments). "Feature switches" holds the rest.

### 3.5 Read-only, audit, and catalogue drift

| # | Point | Recommendation |
|---|---|---|
| R-1 | **Read-only guarantee** | The route exports `GET` only. The page has no input that changes anything. No code path in this feature writes to the environment, the database (apart from the audit row) or any external service. A source-level test pins that the route file exports no other method. |
| R-2 | **Audit of views** | **Yes.** Log one audit event per successful read: who viewed it, when, which environment label, and the counts. Never values or names of masked variables. Non-blocking: `AuditTrailService.getInstance().log({...}).catch(err => logger.error({ err }, 'Audit failed'))`; an audit failure never fails the request. A new constant in `AUDIT_EVENTS` (name for SA). Refused (non-admin) attempts are already recorded by the admin gate. |
| R-3 | **Catalogue drift guard** | **Yes, as a Jest test in the existing Jest job.** It scans `app/`, `lib/`, `components/`, `middleware.ts` and `next.config.js` for literal `process.env.NAME` reads (excluding tests) and fails when a name is read but not catalogued. It also fails when a catalogue entry is read by no code, unless that entry carries a reviewed `readBy: 'sdk'` (or similar) marker: some variables are consumed by a library rather than read directly, and must not be pruned for looking unused. |
| R-4 | **What the guard cannot see** | Computed reads (`process.env[name]`) and reads inside third-party packages. The test prints, as information only, the files with computed reads so a reviewer can check them. |
| R-5 | **CI time** | The guard runs inside the Jest job that already runs on every PR; it adds no job. It must be a plain file scan (no TypeScript compile, no build) and finish within a few seconds. SA rules on its runtime before EC-3 is built, under the standing rule that no new gate may extend the critical path (`next build`). |

---

## 4. Functional Requirements

### 4.1 Route (EC-1)

1. **FR-1** A new admin route, suggested `GET /api/admin/environment`. `requireAdmin` is its first statement (Security Rules; the CI admin-authz guard fails otherwise). The route is added to the handler register in [ADMIN_IDENTIFICATION_AND_ACCESS.md](/docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md).
2. **FR-2** The route takes no input. Any query string is ignored, or refused with 400 if SA prefers a Zod schema of "no parameters" (CLAUDE.md rule 2).
3. **FR-3** The route builds its answer from `process.env`, the catalogue and the platform deny-list, applying §3.2 on the server. Response shape (names for SA): the environment label and deployment facts; one entry per group, each with its rows (name, role, class, scope, requirement, display value or status); the Uncategorised rows; the hidden-platform count; `generatedAt`.
4. **FR-4** The route runs on the Node.js runtime, is never statically rendered, and answers `Cache-Control: no-store` (C-3, C-4).
5. **FR-5** Errors follow the standard format: a fixed user-facing sentence, details only when `NODE_ENV === 'development'`, and never a value.
6. **FR-6** Structured Pino logging via `createLogger`, with a `correlationId`. Logs carry counts only (M-5).
7. **FR-7** One non-blocking audit event per successful read (R-2).
8. **FR-8** No database access other than the audit write. No repository is needed.

### 4.2 Page (EC-2)

9. **FR-9** A new page, suggested `/admin/environment`, a **new sibling item in the Settings section of the sidebar**, after Admin users. Sidebar label "Environment", description "How this deployment is configured, read-only". Rationale in §4.4.
10. **FR-10** Server-guarded like every other `/admin` page (`requireAdminPage`).
11. **FR-11** Page shape per the Admin Layout Standard, as Admin users (L-12) already does it: `AdminPageHeader` (h1 = the sidebar label, one-sentence purpose, the "Read-only" chip), the Refresh-only `AdminFilterBar` with "Read at", `AdminLoading` / `AdminError` (Try again), the response read through `readAdminResponse` with the session-ended copy, the standard card shell, an always-mounted `aria-busy` content area, and the page added to the migrated-pages registry.
12. **FR-12** Under the header, an environment card: the environment chip (§3.1), the deployment facts, and the standing notes C-1, C-2 and C-5 in plain words.
13. **FR-13** One card per group, in the §3.4 order, each with a short group description and a standard table: Name | Value | Role | Scope. Status is never colour alone: Set, Not set, On, Off are words, and chips use `StatusChip`.
14. **FR-14** Masked rows show "Set" or "Not set". Nothing on the page offers to reveal, copy or download a value.
15. **FR-15** The Uncategorised card always shows, with "None" when empty, so an admin can tell "nothing unknown" apart from "not checked". The platform summary line sits under it.
16. **FR-16** A failed refresh clears the tables and "Read at" (the L-12 rule), so no stale configuration stays on screen looking current.

### 4.3 Diagnostics (EC-4)

17. **FR-17** A `required` variable that is not set is marked amber with "Required, not set".
18. **FR-18** A `test-only` or `local-only` variable that is set on Production or Preview is marked amber with "Should not be set on this environment". Recommendation: amber, not red; the page reports and does not judge intent.
19. **FR-19** A `flag` whose raw value is set but not recognised shows "Set, not a recognised value: reads as Off" (or the documented default), without echoing the raw value.
20. **FR-20** A KPI strip under the header, all tiles no-target counts: Set, Required not set (amber when above 0), Should not be set here (amber when above 0), Uncategorised. Each count tile may anchor to the first matching row (L-10 precedent).
21. **FR-21** A page-held search by variable name and a group filter. Per the standard, search is never in the URL; the group filter may be.

### 4.4 Why a new sibling page, not a tab on Admin users

| Option | Assessment |
|---|---|
| **A. New sibling page under Settings (recommended)** | One subject per page, which is how every admin page is organised today. Admin users is a finished L-12 page with pinned tests and a single read; adding tabs would rework it for an unrelated subject. The sidebar highlights by exact path, so a separate route gives the item its own highlight. Cost: one new sidebar item and an update to the sidebar nav pin test. |
| B. A tab on `/admin/settings` | The route name "settings" fits, but the page is titled "Admin users" and is about people. A tab would need tab coordination with the URL (as Business OS AI did, L-8a / L-9a), which is more work than a new page. |

The Admin Layout Standard says the sidebar's sections, their order and existing positions and labels do not change in layout slices. Adding one new item at the end of Settings changes none of those, but it is a sidebar change, so it is listed in §10 (OQ-1) for SA to confirm.

---

## 5. Variable catalogue: groups and roles (seed)

> **This is a seed, not the inventory.** It was compiled from `docs/feature_flags.md`, `.env.example`, `next.config.js`, `middleware.ts` and spot reads of the code. Earlier surveys counted more variables than are listed here. **EC-1 must re-derive the full list mechanically** (every literal `process.env.NAME` in `app/`, `lib/`, `components/`, `middleware.ts`, `next.config.js`, excluding tests), and the catalogue in code becomes the source of truth. Rows marked "(confirm)" name a variable whose exact name or reader EC-1 must confirm. Variables that no code reads are not catalogued: EC-1 lists them in its workplan for the user to remove from the environments.

### 5.1 Environment & deployment

| Name | Class | Role |
|---|---|---|
| `NODE_ENV` | config | Whether the app runs in development or production mode; decides development-only fallbacks and log verbosity. |
| `VERCEL_ENV` | config | Which Vercel environment this deployment belongs to (production, preview, development); the source of the page's environment chip. |
| `NEXT_PUBLIC_VERCEL_ENV` | config | The same environment name, built into the browser bundle so browser code can tell where it runs. |
| `VERCEL` | config | Set by Vercel on every deployment; tells the code it is running on Vercel. |
| `VERCEL_URL` / `NEXT_PUBLIC_VERCEL_URL` | config | This deployment's own host; used for preview links and callbacks to this exact deployment. |
| `VERCEL_PROJECT_PRODUCTION_URL` / `NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL` | config | The project's stable production host; a fallback when no app address is configured. |
| `VERCEL_REGION` (confirm) | config | The region serving this request; shown as a deployment fact. |
| `VERCEL_GIT_COMMIT_REF`, `VERCEL_GIT_COMMIT_SHA` (confirm) | config | The branch and commit this deployment was built from; shown as deployment facts. |

### 5.2 Database (Supabase)

| Name | Class | Role |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | config | Address of the Supabase project; every database, auth and storage call goes here. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` (confirm) | secret | The browser's key to Supabase; access is limited by row-level security. Public by design, masked anyway (M-1). |
| `SUPABASE_SERVICE_ROLE_KEY` | secret | The server's full-access key, which bypasses row-level security; used only by server code that must act across users. |
| `SUPABASE_URL` | config | A second, server-only setting for the Supabase address, read by one older server client; must name the same project as `NEXT_PUBLIC_SUPABASE_URL`. |

### 5.3 Admin & sign-in

| Name | Class | Role |
|---|---|---|
| `ADMIN_EMAILS` | personal | Addresses granted admin access by configuration, in addition to the `admin_users` table; changing it needs a redeploy. |
| `NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID` | config | Google client ID for "Continue with Google" on a signup invite; unset means the button is off. |

### 5.4 App addresses

| Name | Class | Role |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | config | The platform's own address, used in links the app sends out (emails, payment returns, OAuth redirects). |
| `NEXT_PUBLIC_PUBLIC_SITE_HOST` | config | The host under which each business's public pages are served as subdomains. |
| `NEXT_PUBLIC_WEBSITE_BASE_HOST` (confirm whether still read) | config | Older setting for the business-website host; EC-1 confirms whether any code still reads it. |

### 5.5 AI providers

| Name | Class | Role |
|---|---|---|
| `OPENAI_API_KEY` | secret | Key for OpenAI models; calls routed to OpenAI fail without it. |
| `ANTHROPIC_API_KEY` | secret | Key for Anthropic models. |
| `GROQ_API_KEY` | secret | Key for Groq-hosted models. |
| `MISTRAL_API_KEY` (confirm) | secret | Key for Mistral models. |
| `KIMI_API_KEY` | secret | Key for Kimi (Moonshot) models. |

### 5.6 Plugins & OAuth

| Name | Class | Role |
|---|---|---|
| `GOOGLE_CLIENT_ID` | config | Google OAuth client used by the Google plugins (Gmail, Drive, Calendar, Sheets, Docs). |
| `GOOGLE_CLIENT_SECRET` | secret | Secret for that Google OAuth client. |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | config | The Google plugin client ID, built into the browser bundle. |
| Slack, HubSpot, LinkedIn, Airtable, WhatsApp/Meta client IDs and secrets (confirm names) | config / secret | OAuth app credentials for each connected-app plugin; a plugin cannot connect without its pair. |
| `NANGO_PUBLIC_KEY` | secret (M-1) | Key for the Nango integration service, passed through `next.config.js`. |
| `NANGO_SECRET_KEY` | secret | Server key for the Nango integration service. |
| `ENCRYPTION_SECRET` | secret | Key used to encrypt plugin credentials stored in the database. |
| AWS Textract access key, secret and region (confirm names) | secret / config | Credentials for document text extraction. Catalogued explicitly so they are not confused with the runtime's own injected `AWS_*` names (§3.3). |

### 5.7 Payments (Stripe)

| Name | Class | Role |
|---|---|---|
| `STRIPE_SECRET_KEY` | secret | The platform's Stripe key: plan and boost checkouts, price lookups, Connect calls. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | secret (M-1) | Stripe's browser key for embedded checkout. Public by design, masked anyway. |
| `STRIPE_WEBHOOK_SECRET` | secret | Verifies that platform webhook events really come from Stripe. |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | secret | Verifies Stripe Connect webhook events for businesses' connected accounts. |
| `STRIPE_CLIENT_ID` | config | The Stripe Connect platform client ID used when a business connects its Stripe account. |
| `BUSINESS_OS_PLAN_PRICES_ENABLED` | flag (default off) | Lets the webhook recognise Business OS plan prices; off means every plan invoice is treated as unknown. |
| `BUSINESS_OS_PLAN_CHECKOUT_ENABLED` | flag (default off) | Opens the Business OS plan checkout; needs plan price recognition on. |
| `BUSINESS_OS_CREDITS_BOOST_ENABLED` | flag (default off) | Lets owners buy a credits boost. |
| `BUSINESS_OS_CREDITS_BOOST_TEST_ACCOUNTS` | personal | Optional list of accounts allowed to buy a boost; unset means everyone when the boost switch is on. |

### 5.8 Email

| Name | Class | Role |
|---|---|---|
| `RESEND_API_KEY` | secret | Key for Resend, the first email provider the transport tries. |
| `SMTP_HOST`, `SMTP_PORT` | config | SMTP server, the second provider tried. |
| `SMTP_USER` | config (confirm: may be an address, then `personal`) | SMTP login name. |
| `SMTP_PASS` | secret | SMTP password. |
| `GMAIL_USER` | personal | Gmail account for the third email provider (Gmail OAuth). |
| `GMAIL_CLIENT_ID` | config | OAuth client for the Gmail email provider. |
| `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` | secret | Credentials for the Gmail email provider. |

### 5.9 Background jobs & queues

| Name | Class | Role |
|---|---|---|
| `CRON_SECRET` | secret | Shared secret scheduled jobs must present; protects the cron endpoints from outside callers. |
| `QSTASH_TOKEN` | secret | Key for Upstash QStash, the queue that runs agent executions. |
| `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` | secret | Verify that queue callbacks really come from QStash; read by the QStash library (`readBy: 'sdk'`). |
| Upstash Redis URL and token (confirm names and whether still read) | config / secret | The Redis store, if any code still uses it. |

### 5.10 Tokens & data protection

| Name | Class | Role |
|---|---|---|
| `BOOKING_TOKEN_SECRET` | secret | Signs the links in client emails (booking management, quotes) whose token is the client's authorisation. |
| `IP_HASH_SALT` | secret | Salt for hashing visitor IP addresses, so analytics never stores a raw IP. |
| `DELETION_RECEIPT_FINGERPRINT_KEY` | secret | Keys the email fingerprint stored in deletion receipts; without it admin deletions are refused. |

### 5.11 Feature switches

| Name | Class (default) | Role |
|---|---|---|
| `NEXT_PUBLIC_USE_V6_AGENT_GENERATION` | flag (off) | Uses the V6 agent generation pipeline in agent creation. |
| `NEXT_PUBLIC_USE_V6_REVIEW_MODE` | flag (on) | With V6 on, shows the review step before compiling. |
| `NEXT_PUBLIC_MOVE_TO_CALIBRATION_AFTER_AGENT_CREATION` | flag (off) | Offers calibration right after an agent is created. |
| `NEXT_PUBLIC_USE_THREAD_BASED_AGENT_CREATION` | flag (off) | Legacy agent-creation route only: thread-based flow. |
| `NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI` | flag (off) | Legacy agent-creation route only: newer builder UI. |
| `NEXT_PUBLIC_USE_AI_DATA_LAYER` | flag (off) | Business OS chat uses the AI data layer with tool calling. |
| `CALIBRATION_AUTO_RCA_ENABLED` | flag (off) | Adds an AI root-cause analysis to failed-calibration admin alerts. |
| `NEXT_PUBLIC_ENABLE_BUSINESS_DELETE` | flag (off) | Draws the customer "delete my business" surface; the server makes its own check. |
| `NEXT_PUBLIC_BUSINESS_OS_CREDIT_HISTORY` | flag (off) | Shows the owner's Credit history on the Credits card. |
| `ADMIN_BUSINESS_DELETE_ENABLED` | flag (off) | Lets an admin delete a business from Businesses. |

### 5.12 Logging & observability

| Name | Class | Role |
|---|---|---|
| `LOG_LEVEL` | config | Minimum log level written; when unset, debug in development and info otherwise. |

### 5.13 Test & development tools (`test-only` or `local-only`)

| Name | Class | Role |
|---|---|---|
| `BUSINESS_OS_TEST_CREDIT_TOOLS_ENABLED` | flag (off) | Enables the "Test credits" tab on the test harness; developer machines only. |
| `NEXT_PUBLIC_ALLOW_EARLY_SESSION_OUTCOME` | flag (off) | Temporary: lets a package session be marked held before its hour, for testing; must not be on in production. |
| `TEST_CLEANUP_SECRET` | secret | Unlocks the test-account cleanup tool; production only, never preview. (EC-4 needs a per-environment rule for this one, see OQ-7.) |
| `NEXT_PUBLIC_TEST_PAGE_USER_ID` (confirm) | config | User ID the test pages act as. |

---

## 6. Non-Functional Requirements

- **Security:** masking happens only on the server (§3.2). Admin-only route (`requireAdmin`, first statement) and page (`requireAdminPage`). `Cache-Control: no-store`. No value in logs, audit rows, error details or test snapshots. Tests use made-up fixture values, never real ones. Nothing in this feature may read `.env*` files from disk; the process environment is the only source.
- **Fail-closed:** every classification error or unknown masks (M-4). If the catalogue cannot be loaded the route answers an error; it never answers an unmasked list.
- **Performance:** one in-memory pass over `process.env` per request; no database read besides the audit write. Target: under 200 ms server time.
- **CI time:** the drift guard (EC-3) runs inside the existing Jest job, as a file scan of a few seconds, and adds no job (R-5).
- **Accessibility:** status in words, not colour alone; tables with named headers; keyboard-reachable Refresh; per the Admin Layout Standard.
- **Logging:** Pino via `createLogger`, `correlationId` on the route, counts only.
- **No new pattern without SA:** the catalogue and the masking module are a new pattern (CLAUDE.md rule 7); EC-1 runs the full cycle.

---

## 7. Slices

Small numbered slices, a few days each, reusing the admin layout infrastructure. Each slice is its own PR, merged before the next starts.

| Slice | Scope | Guardrails | Size | Recommended path |
|---|---|---|---|---|
| **EC-1** Catalogue, reader, masking, route | Mechanical inventory of every `process.env` read; the typed catalogue with every entry; the platform deny-list; the server-side classifier (§3.2 incl. M-1 to M-5); `GET /api/admin/environment` (FR-1 to FR-8); the audit event; the register row in the admin access doc. No UI. | Unit tests: every class; each backstop (a `config` entry with a JWT-shaped value is masked; a name with `SECRET` catalogued as `config` is masked; a `NEXT_PUBLIC_*_KEY` is masked; URL user-info stripped; unknown masked; unrecognised flag raw not echoed). A serialisation test: with fixture secrets in the environment, no fixture value appears anywhere in the response body or in captured logs. Route tests: happy path, non-admin refused, `GET` the only export. | 🟡 ~3 days | Full cycle |
| **EC-2** Page and sidebar entry | `/admin/environment` (FR-9 to FR-16); sidebar item at the end of Settings; nav pin test updated; migrated-pages registry entry. | Render tests: header, environment chip for each label, a masked row shows Set / Not set, Uncategorised always shown, failed refresh clears. No new shared export. | 🟢 ~2 days | UI short path (SA + QA, user sees the diff), unless SA rules the new sidebar item needs the full cycle (OQ-1) |
| **EC-3** Catalogue drift guard | The Jest guard (R-3, R-4); a "how to add an environment variable" step in [feature_flags.md](/docs/feature_flags.md) and a pointer in `.env.example`'s header. | SA rules on runtime before it is built (R-5). Negative controls: the guard fails on an injected uncatalogued name and on an unreferenced entry without the SDK marker. | 🟢 ~1–2 days | Full cycle (a new CI-enforced rule) |
| **EC-4** Diagnostics | Required-but-missing (FR-17), should-not-be-set-here (FR-18), unrecognised flag values (FR-19), KPI strip (FR-20), search and group filter (FR-21). | Tests per diagnostic; KPI tiles follow the standard's tile rules. | 🟡 ~2–3 days | UI short path for the page; full cycle if it changes the route's response shape (it will, for the requirement and environment-rule fields) |
| **EC-5** (optional) Safe descriptors | Only if SA approves OQ-6: per-variable descriptors that return a fixed label (for example Stripe "Live mode" / "Test mode") derived on the server, never characters of the value. | Each descriptor returns one of a closed set of labels; a test pins that no descriptor output contains any substring of its input. | 🟢 ~1 day | Full cycle |

---

## 8. Acceptance Criteria

- [ ] A non-admin gets the standard refusal from the route and cannot open the page.
- [ ] On a Production deployment the page says Production; on a Preview it says Preview; locally it says Local. A preview never shows "Production".
- [ ] Every catalogued variable appears in its group with its one-sentence role.
- [ ] Every `flag` row reads On or Off, and "(default)" when unset, agreeing with the code's own reader.
- [ ] No `secret`, `personal` or uncatalogued value appears in the route response, in the browser, in logs or in the audit row. Verified by an automated test with fixture values and by QA inspecting the network response on a real deployment.
- [ ] A catalogued variable that is not set shows "Not set".
- [ ] A variable present in the environment but not catalogued appears under Uncategorised, masked; platform and operating-system variables are counted, not listed.
- [ ] The page has no control that changes any setting; the route exports `GET` only.
- [ ] Each successful view writes one audit event, and an audit failure does not fail the page.
- [ ] (EC-3) Adding a `process.env.NEW_NAME` read without a catalogue entry fails the Jest job, and the guard adds no CI job.
- [ ] (EC-4) A required variable that is not set, and a test-only variable set on Production or Preview, are each marked amber with words.
- [ ] Before each slice is committed, QA confirms at least the happy path and one failure path.

---

## 9. Out of Scope / Future Roadmap

- **Editing** any setting from the page, or any link that writes to Vercel. Out of scope by the user's request.
- **Comparing environments** side by side (Production vs Preview). A future option: each deployment publishes an HMAC fingerprint of each secret under a platform-held key, so "same key or not" can be answered without revealing either. Needs its own design and SA review.
- **Reading Vercel's project settings through the Vercel API** (for example to show what the *next* deploy will get). Not needed: the page deliberately shows what the running deployment has.
- **Safe descriptors for secrets (former EC-5)**, for example Stripe live or test mode as a closed-set label. Deferred by SA on 2026-10-26 (OQ-6); needs its own SA review if revived.
- **A Health tile** on `/admin` for "required setting missing". Natural follow-up once EC-4 exists.
- **Database-held settings** (`system_settings_config`, orchestration flags, Business OS AI model settings). They have their own admin pages; this page covers environment variables only. A link card to those pages could be added later.
- **Fixing** any configuration this page reveals. Findings go to the owning stream; this feature only shows.

---

## 10. Open Questions for SA

Each question has a recommended answer. None needs the user unless SA says so.

- [x] **OQ-1** Placement: a new sibling page `/admin/environment` at the end of the Settings section (recommended), not a tab on Admin users. Does adding one sidebar item need the full cycle, or is EC-2 a UI short path? *Recommended: short path; the item adds no shared export and moves no existing item.* (raised by: BA | status: ruled by SA 2026-10-26, see §10.1)
- [x] **OQ-2** Route runtime and caching config to guarantee C-3 and C-4 (Node.js runtime, dynamic, `no-store`). *Recommended: explicit route-segment exports plus a source test that pins them.* (raised by: BA | status: ruled by SA 2026-10-26, see §10.1)
- [x] **OQ-3** The name-pattern list for M-1 and the length and character rules for M-2. *Recommended: the list in §3.2; `config` values up to 200 characters from the stated set.* (raised by: BA | status: ruled by SA 2026-10-26, see §10.1)
- [x] **OQ-4** Platform noise: filter and summarise with a deny-list kept next to the catalogue (recommended), versus listing everything under Uncategorised. *Recommended: filter and summarise; locally the operating system alone would flood the list.* (raised by: BA | status: ruled by SA 2026-10-26, see §10.1)
- [x] **OQ-5** Catalogue location and shape (suggested a server-only module under `lib/admin/`), and whether the `flagDefault` field should be derived from the existing flag readers rather than repeated. *Recommended: repeat it in the catalogue, and add a test that each `flagDefault` agrees with its reader's behaviour when unset, so the two cannot drift.* (raised by: BA | status: ruled by SA 2026-10-26, see §10.1)
- [x] **OQ-6** Secrets fully hidden (Set / Not set) versus a suffix or length hint. *Recommended: fully hidden. A suffix is part of a value, and this repository and its screenshots are public-facing. The only proposed exception is EC-5's closed-set descriptors (for example Stripe live or test mode), which reveal no characters; SA decides whether EC-5 is worth doing at all.* (raised by: BA | status: ruled by SA 2026-10-26, see §10.1)
- [x] **OQ-7** Per-environment rules for EC-4: a variable may be `test-only` (never on Vercel), `local-only`, or the reverse (`TEST_CLEANUP_SECRET` belongs on production only). *Recommended: replace the single `requirement` value with an `expectedIn` set (`production`, `preview`, `local`) per entry, and derive both "Required, not set" and "Should not be set here" from it.* (raised by: BA | status: ruled by SA 2026-10-26, see §10.1)
- [x] **OQ-8** The audit event name and payload (counts and environment label only). *Recommended: add one `AUDIT_EVENTS` constant; severity info.* (raised by: BA | status: ruled by SA 2026-10-26, see §10.1)
- [x] **OQ-9** The drift guard's runtime budget and whether the unreferenced-entry check fails or warns. *Recommended: both checks fail; SDK-consumed entries carry an explicit marker; budget a few seconds inside the existing Jest job.* (raised by: BA | status: ruled by SA 2026-10-26, see §10.1)
- [x] **OQ-10** `personal` class: count only (recommended), or the addresses for `ADMIN_EMAILS` as the Admin users page already shows. *Recommended: count plus a link to Admin users, so addresses are shown in one place under one set of rules.* (raised by: BA | status: ruled by SA 2026-10-26, see §10.1)

### 10.1 SA Review (2026-10-26)

**Reviewed by SA, 2026-10-26.** **Verdict: approved with changes.** The shape is right: server-side read of `process.env`, a code-side catalogue, masking before the response is built, `GET` only behind `requireAdmin`, and a drift guard inside the existing Jest gate. The changes below tighten the masking where the draft's backstops would have let a credential through (a Stripe-style key and a JWT both fit the draft M-2 character set; a secret can sit in a URL path), and fix the field shapes in EC-1 so later slices do not reshape the route. None of them needs the user. EC-1 may start its workplan; the workplan quotes the rulings and conditions it carries (see the Progress table).

#### Rulings on OQ-1 to OQ-10

| OQ | Ruling | Reason |
|---|---|---|
| OQ-1 | **Accept, with one amendment.** A new sibling page `/admin/environment`, last item in Settings. EC-2 takes the UI short path (SA + QA, the user sees the diff), **but** SA reviews the `AdminSidebar.tsx` and `AdminSidebar.nav.test.ts` diff explicitly: the only change allowed is one item appended to Settings. | The Layout Standard's sidebar freeze (X-1, X-2) governs *layout slices*; this is a feature, so one appended item is allowed. The nav pin test is a contract, so its edit is reviewed rather than waved through. |
| OQ-2 | **Accept, exact exports ruled.** The route file has `export const runtime = 'nodejs';` and `export const dynamic = 'force-dynamic';`, nothing else at segment level (no `revalidate`, no `fetchCache`). Every response the handler builds (200, 400, 500) sets `Cache-Control: no-store`. A source test pins both exports, the header on success and error, and that `GET` is the only exported method. | This is the repo's existing pair (the large majority of `app/api/admin` routes use it) and the billing routes already pin `no-store` the same way; `force-dynamic` alone stops build-time rendering, so `revalidate = 0` would be redundant. |
| OQ-3 | **Amend.** M-1 list extended and M-2 replaced by per-entry declared shapes; see SA-C1 and SA-C2. Maximum shown length 200 characters. | The draft M-2 character set (letters, digits, `-_.:/`) admits a JWT and most provider API keys, so on its own it does not fail closed. |
| OQ-4 | **Accept, with precedence fixed.** Filter and summarise with a deny-list next to the catalogue. Listing precedence: catalogue, then deny-list, then Uncategorised. A deny-listed name is never shown, only counted; the deny-list can never hide a catalogued name. | Locally the operating system floods the list; hiding never leaks, so the filter is safe as long as it cannot override the catalogue. |
| OQ-5 | **Accept, location ruled.** `lib/admin/environment/`: `catalogue.ts` (pure data, no imports beyond types), `platformDenyList.ts`, and `classifyEnvironment.ts` (`import 'server-only'`, a **pure function that takes the environment object as an argument**; only the route passes `process.env`). The response type lives in `lib/admin/environment-types.ts`, as `lib/admin/adminList-types.ts` does. `flagDefault` is repeated in the catalogue, and a test checks each one against its reader when unset (calling the named reader in `lib/utils/featureFlags.ts` where one exists, else `parseBooleanFlag(undefined, flagDefault)` against the reading site's documented default). | A pure classifier lets tests inject fixture environments without mutating `process.env`; deriving defaults from the readers would mean importing the flag module's dependency graph into the classifier. |
| OQ-6 | **Accept: fully hidden. EC-5 deferred** to §9, not built in this stream. | A suffix or length is part of a value, and the repository is public. Stripe live or test mode already has a server-side home in the billing admin code, so EC-5 would duplicate it for little gain. |
| OQ-7 | **Accept, amended shape, and moved into EC-1.** Replace `requirement` with `expectedIn: { production, preview, local }`, each one of `required` / `optional` / `forbidden`. EC-1 ships the field in the catalogue and in each response row; EC-4 only adds the display. "Required, not set" and "Should not be set here" both derive from it; an Unknown environment label shows no diagnostics. | A tri-state per environment expresses both `test-only` and the reverse case (`TEST_CLEANUP_SECRET`), and shipping the field in EC-1 means EC-4 does not reshape the route. |
| OQ-8 | **Accept.** `AUDIT_EVENTS.ADMIN_ENVIRONMENT_VIEWED`, severity `info`, with its entry in the event metadata map in `lib/audit/events.ts`. Payload: actor from `requireAdmin`, the environment label, and counts only (rows, set, not set, uncategorised, platform-hidden). No variable names, no values. Non-blocking `.catch` per CLAUDE.md Audit Trail; the WC-7 flush rule of the `new-api-route` skill applies if the workplan awaits it. | Matches the existing event conventions; names of uncategorised variables can hint at what a deployment holds, so they stay out of the audit row. |
| OQ-9 | **Accept: both checks fail, budget ruled.** The guard is one Jest test file collected by the existing sharded gate (`Gate tests (jest)`), with **no new job, no new npm script, and no addition to the narrow required jobs** (`test:authz-guard`, `test:bos-entitlements`, `test:bos-llm`). Budget: **at most 5 s** of wall time in its shard (the workplan records a local measurement; QA re-measures in CI). Plain recursive file read plus regex; no TypeScript compile, no build, no `ts-morph`. SDK- or page-consumed entries carry SA-C13's marker. | The gate already finishes inside the `next build` critical path with margin; a few seconds added to one shard does not move it, which satisfies the standing no-added-CI-time rule. |
| OQ-10 | **Accept, one detail.** `personal` shows a count plus, for `ADMIN_EMAILS`, a link to Admin users. The `ADMIN_EMAILS` count uses the existing `parseAdminEmails` from `lib/admin/adminEmailsEnv.ts`, never a second split. A `personal` single value (an account or user id) shows Set / Not set, no count. | One parser keeps the count equal to what the Admin users page and the admin gate see; addresses stay on one page under one set of rules. |

#### Conditions (SA-C1 to SA-C14)

Each is binding on the slice named in the Progress table. Unit tests with made-up fixture values pin each one.

| # | Condition | Replaces or adds to |
|---|---|---|
| SA-C1 | **M-1 name pattern, extended.** Case-insensitive substring match on the whole name for: `KEY`, `SECRET`, `TOKEN`, `PASS`, `PWD`, `SALT`, `PRIVATE`, `CREDENTIAL`, `CREDS`, `SIGNING`, `AUTH`, `DSN`, `CERT`, `HOOK`, `COOKIE`, `SESSION`, `CONNECTION`. Applies to `config` and `personal` entries and to every uncatalogued name. **No exceptions** in this stream (no exception flag is built). A `flag` entry whose name matches is still shown as On / Off, because a flag's output is a closed enum built from no characters of the value (SA-C3). Over-matching (for example `BYPASS`) is accepted: it only masks. | §3.2 M-1 |
| SA-C2 | **M-2 becomes a per-entry declared shape.** Each `config` entry declares a `shape` from a closed set: `url`, `host`, `integer`, `enum` (with its allowed values listed in the entry), `gitSha` (exactly 40 hex), `region`, `identifier`. A value is shown only if it matches its entry's shape, is at most 200 characters, contains no whitespace or quotes, and passes the global opaque-token rejects: anything shaped like a JWT (three dot-separated base64url segments), and any unbroken run of 40 or more characters from `[A-Za-z0-9+/=]` (the `gitSha` shape is the only exemption). Otherwise the row is masked with "Hidden: does not look like plain configuration". | §3.2 M-2; OQ-3 |
| SA-C3 | **`flag` returns no raw text at all.** The row carries `{ state: 'on' \| 'off', source: 'set' \| 'default' \| 'unrecognised' }`. The draft's "raw value when it is one of true/false/1/0" is dropped: the verdict carries the same information. | §3.2 `flag` row; FR-19 |
| SA-C4 | **URLs are reduced to their origin.** A `url`-shaped value is shown as scheme, host and port only. User-info, path, query and fragment are all dropped (incoming-webhook style URLs carry their secret in the path). A value that does not parse as a URL is masked. | §3.2 M-3 |
| SA-C5 | **The response is built by explicit field picking** from a typed row DTO (`name`, `group`, `role`, `sensitivity`, `scope`, `expectedIn`, and one `display` union: `{ kind: 'shown', text }`, `{ kind: 'status', set }`, `{ kind: 'flag', state, source }`, `{ kind: 'count', entries }`, `{ kind: 'hidden', reason }`). The raw value is never a field on any object that reaches `NextResponse.json`. | FR-3 |
| SA-C6 | **No value in errors, ever.** The classifier never builds an error message from a value. A per-row classification error masks that row and logs the variable name and error class name only, never `err.message`. Route-level `details` (development only) is a fixed code, not the caught error's message. | FR-5; M-4, M-5 |
| SA-C7 | **The serialisation test is the acceptance gate for EC-1.** With fixture values for every class (including a JWT-shaped `config`, a key-shaped value under a `config` entry, a URL with credentials in user-info, path and query, and an uncatalogued secret), assert that no fixture secret, and no 8-character substring of one, appears in: the response body, any captured logger call, or the audit mock's arguments. | §7 EC-1 guardrails |
| SA-C8 | **Runtime reads only.** The classifier enumerates `Object.keys(env)` and reads `env[name]`; it contains no literal `process.env.NAME`. In server code Next.js inlines literal `process.env.NEXT_PUBLIC_*` at build, so a literal read would show the build-time value, not the deployment's. | C-2, C-3 |
| SA-C9 | **Input: Zod, refuse with 400.** The query string is parsed with a strict empty Zod object; any parameter answers 400 in the standard error format with `no-store`. | FR-2 (CLAUDE.md rule 2) |
| SA-C10 | **Access register and authz guard.** EC-1 adds the next numbered row to the handler register in [ADMIN_IDENTIFICATION_AND_ACCESS.md](/docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md) (gated, `requireAdmin` first, `GET` only, counts-only logging, the masking summary), and updates in the same PR any count or ratchet that `lib/admin/__tests__/admin-authz-surface.guard.test.ts` holds for gated handlers. The route's own test pins `requireAdmin` as the first statement. | FR-1 |
| SA-C11 | **Client boundary.** The page imports only `lib/admin/environment-types.ts`; no `'use client'` file imports `lib/admin/environment/`. A source test pins it. Role sentences reach the browser only through the response. EC-2 follows the closed Layout Standard as the Admin users page (L-12) does, and registers the page in the migrated-pages registry. | FR-9 to FR-16 |
| SA-C12 | **Seed corrections for EC-1's mechanical inventory.** `NANGO_PUBLIC_KEY` is passed through `next.config.js` `env`, so its scope is `browser-inlined`. `SMTP_USER` is `personal` (fail closed; it is often an address). `NEXT_PUBLIC_TEST_PAGE_USER_ID` is `personal` (a real user id), shown Set / Not set. Any variable that names a real account or user is `personal`, not `config`. | §5 |
| SA-C13 | **Drift guard details.** Detects literal `process.env.NAME`, `process.env['NAME']` / `process.env["NAME"]`, and destructuring from `process.env`; reports other computed reads as information only. Scans the deployed source roots (`app/`, `lib/`, `components/`, `hooks/`, plus root-level `middleware.ts`, `next.config.js` and any `instrumentation*.ts`), excluding test files and `__tests__`/`__mocks__` folders. Line-ending safe (no `\n`-anchored patterns; CRLF on Windows has bitten source scans before). The unreferenced-entry marker is a closed enum `consumedBy: 'sdk' \| 'platform' \| 'environment-page'` plus a required one-line note; `environment-page` covers the deployment facts that only this page reads. Negative controls as §7 states. | R-3, R-4, R-5 |
| SA-C14 | **Public-repo hygiene for evidence.** Workplans, QA reports, PR descriptions and issues quote no value the page displays and attach no screenshot of the page from a real deployment. QA's network-response check on a real deployment is recorded as pass or fail per class, without quoting values. | §8 |

#### Other notes (no action needed before EC-1)

- Performance target (under 200 ms, one in-memory pass) is sound; no caching beyond `no-store` is wanted.
- No rate limit is needed: the route is admin-only, reads no database, and every view is audited.
- Middleware runs on the Edge runtime and reads its own variables; that does not affect this route, which is pinned to Node.js (OQ-2).

---

## 11. Notes on Integration Points

| Area | Effect |
|---|---|
| `app/admin/components/AdminSidebar.tsx` | One new item at the end of Settings; the sidebar nav pin test is updated. No other item moves. |
| `app/admin/environment/` (new) | The page, built from the shared admin layout components. |
| `app/api/admin/environment/route.ts` (new) | The read-only route; `requireAdmin` first. |
| `lib/admin/...` (new, location per SA) | The catalogue, the platform deny-list and the server-side classifier. Server-only. |
| `lib/utils/parseBooleanFlag.ts` | Reused for `flag` rows so the page agrees with the code. Not changed. |
| `lib/services/AuditTrailService.ts`, `AUDIT_EVENTS` | One new event constant; non-blocking write. |
| [ADMIN_IDENTIFICATION_AND_ACCESS.md](/docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md) | One register row for the new handler. |
| [feature_flags.md](/docs/feature_flags.md), `.env.example` | EC-3 adds the "add a catalogue entry" step to the flag-authoring checklist and a pointer in the example file's header. |
| Admin Layout Standard migrated-pages registry | The new page is registered (EC-2). |
| Database | No table read or written, apart from one audit row per view. No migration. |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-26 | Initial draft | BA scoped the read-only environment configuration page from the user's request: server-side source of values, fail-closed masking classes, code-side catalogue, groups with role sentences (seed list), read-only and audit rules, catalogue drift guard, slices EC-1 to EC-5, and ten questions for SA. |
| 2026-10-26 | SA review: approved with changes | SA ruled OQ-1 to OQ-10 (§10.1): EC-2 UI short path with an explicit sidebar-diff review; route exports `runtime = 'nodejs'` and `dynamic = 'force-dynamic'` plus `no-store` on every response; M-1 list extended and M-2 replaced by per-entry shapes; deny-list precedence; catalogue under `lib/admin/environment/` with a pure classifier; secrets fully hidden and EC-5 deferred; `expectedIn` tri-state shipped in EC-1; `ADMIN_ENVIRONMENT_VIEWED` audit event; drift guard at most 5 s inside the existing Jest gate with no new job; `personal` counts via `parseAdminEmails`. Conditions SA-C1 to SA-C14 added. Status and Progress table updated; OQ bullets marked ruled. |
| 2026-10-26 | EC-1 workplan SA-approved; EC-1 code complete | Progress row 1 updated (Dev, per SA RC-8): EC-1 implemented on `feature/admin-environment-view`, awaiting SA code review. Recorded for BA to fold into §3.4 and §5: the new `external` group (SA Q-3), `STRIPE_WEBHOOK_SECRET` expected required on production only (SA Q-10), and the two seed names that no code reads. |
| 2026-10-27 | EC-1 and EC-2 in PR | RM: Progress rows 1 and 2 set to in PR. Both slices ship together in one PR to `main` (EC-1 full cycle, EC-2 UI short path); SA approved, QA passed (EC-2 with notes); the user waived the diff review for this stream. Owed after deploy: a live admin check of the environment label, the masked classes and phone-width scroll, recorded with no values. EC-3 and EC-4 follow in PR 2. |
