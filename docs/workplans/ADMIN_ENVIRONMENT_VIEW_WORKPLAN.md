# Workplan: Admin Environment Configuration View

> **Last Updated**: 2026-10-26

**Developer:** Dev
**Requirement:** [ADMIN_ENVIRONMENT_CONFIGURATION_VIEW_REQUIREMENT.md](/docs/requirements/ADMIN_ENVIRONMENT_CONFIGURATION_VIEW_REQUIREMENT.md) (§10.1 SA Review overrides §3 to §8)
**Branch:** `feature/admin-environment-view`
**Date:** 2026-10-26
**Status:** EC-1 Code Complete (workplan SA-approved with changes RC-1..RC-8, applied); awaiting SA code review

## Overview

A read-only "Environment" page under Settings in `/admin` that lists every environment variable the application reads, grouped, with a one-sentence role, secrets reduced to Set / Not set on the server. This workplan has one section per slice. **EC-1** (catalogue, platform deny-list, server-side classifier, `GET /api/admin/environment`, audit event, access-register row; no UI) is planned in full. EC-2 to EC-4 are stubs, filled when their slice starts.

> **Public repository.** This workplan names variables, groups, roles and design only. It contains no value, partial value, project reference or remark about the state of any credential, and neither may the code, fixtures, tests, QA report or PR description that follow it (SA-C14). Test fixtures use obviously fake strings.

---

## Table of Contents

1. [EC-1: catalogue, reader, masking, route](#1-ec-1-catalogue-reader-masking-route)
   1. [Rulings and conditions this slice carries](#11-rulings-and-conditions-this-slice-carries)
   2. [Analysis summary](#12-analysis-summary)
   3. [Inventory: method and result](#13-inventory-method-and-result)
   4. [Proposed catalogue](#14-proposed-catalogue)
   5. [Implementation approach](#15-implementation-approach)
   6. [Files to create / modify](#16-files-to-create--modify)
   7. [Task list](#17-task-list)
   8. [Test plan](#18-test-plan)
   9. [Questions for SA](#19-questions-for-sa)
   10. [Findings for other streams (not fixed here)](#110-findings-for-other-streams-not-fixed-here)
   11. [Implementation notes](#111-implementation-notes)
2. [EC-2: page and sidebar entry](#2-ec-2-page-and-sidebar-entry)
3. [EC-3: catalogue drift guard (stub)](#3-ec-3-catalogue-drift-guard-stub)
4. [EC-4: diagnostics (stub)](#4-ec-4-diagnostics-stub)
5. [SA Review Notes](#5-sa-review-notes)
6. [QA Testing Report](#6-qa-testing-report)
7. [Commit Info](#7-commit-info)
8. [Change History](#change-history)

---

## 1. EC-1: catalogue, reader, masking, route

### 1.1 Rulings and conditions this slice carries

Quoted from requirement §10.1 so review can check each against the plan. Where §3 to §8 differ, these win.

| Ref | What EC-1 must do | Where in this plan |
|---|---|---|
| OQ-2 | Route file exports `runtime = 'nodejs'` and `dynamic = 'force-dynamic'`, nothing else at segment level. Every response (200, 400, 500, and the gate's 401/403) carries `Cache-Control: no-store`. A source test pins both exports, the header on success and error, and `GET` as the only exported method. | §1.5.5, T-12, R-1..R-4 |
| OQ-3 / SA-C1 | Name pattern (case-insensitive substring of the whole name): `KEY`, `SECRET`, `TOKEN`, `PASS`, `PWD`, `SALT`, `PRIVATE`, `CREDENTIAL`, `CREDS`, `SIGNING`, `AUTH`, `DSN`, `CERT`, `HOOK`, `COOKIE`, `SESSION`, `CONNECTION`. Forces status-only on `config`, `personal` and uncatalogued names. No exceptions. A `flag` whose name matches still shows On / Off. | §1.5.3 step 3, C-1..C-4 |
| OQ-3 / SA-C2 | Each `config` entry declares a `shape`: `url`, `host`, `integer`, `enum` (values listed), `gitSha` (40 hex), `region`, `identifier`. Shown only if: matches its shape, at most 200 characters, no whitespace or quotes, not JWT-shaped, no unbroken run of 40+ chars from `[A-Za-z0-9+/=]` (`gitSha` exempt from that last rule only). Else "Hidden: does not look like plain configuration". | §1.5.3 step 5, C-5..C-12 |
| OQ-4 | Filter and summarise platform noise. Precedence: catalogue, then deny-list, then Uncategorised. The deny-list can never hide a catalogued name. | §1.5.2, C-20, C-21 |
| OQ-5 | `lib/admin/environment/catalogue.ts` (pure data, type imports only), `platformDenyList.ts`, `classifyEnvironment.ts` (`import 'server-only'`, pure function taking the env object as an argument). Types in `lib/admin/environment-types.ts`. `flagDefault` repeated in the catalogue; a test checks each against its reader. | §1.5.1, §1.6, F-1..F-6 |
| OQ-7 | `expectedIn: { production, preview, local }`, each `required` / `optional` / `forbidden`, in the catalogue **and** in each response row. EC-4 only displays it. | §1.4, §1.5.4 |
| OQ-8 | `AUDIT_EVENTS.ADMIN_ENVIRONMENT_VIEWED`, severity `info`, metadata entry in `lib/audit/events.ts`. Payload: actor from `requireAdmin`, environment label, counts (rows, set, not set, uncategorised, platform-hidden). No names, no values. Non-blocking `.catch`. | §1.5.5, T-9, R-8, R-9 |
| OQ-10 | `personal` list shows a count; `ADMIN_EMAILS` counted with `parseAdminEmails` from `lib/admin/adminEmailsEnv.ts`, plus a link to Admin users. A `personal` single value shows Set / Not set. | §1.5.3 step 4, C-13..C-15 |
| SA-C3 | `flag` rows carry `{ state: 'on' \| 'off', source: 'set' \| 'default' \| 'unrecognised' }` and no raw text at all. | C-16..C-18 |
| SA-C4 | A `url` value is reduced to its origin (scheme, host, port). User-info, path, query, fragment dropped. Not parseable as a URL: masked. | C-8, C-9 |
| SA-C5 | The response is built by explicit field picking from a typed row DTO; the `display` union is `shown` / `status` / `flag` / `count` / `hidden`. The raw value is never a field on any object reaching `NextResponse.json`. | §1.5.1, §1.5.3 |
| SA-C6 | No value in errors, ever. A per-row classification error masks that row; the route logs the variable name and the error's class name only, never `err.message`. Route-level `details` (development only) is a fixed code. | §1.5.3 step 7, C-19, R-7 |
| SA-C7 | **Acceptance gate.** With fixtures for every class (a JWT-shaped `config`, a key-shaped value under a `config` entry, a URL with credentials in user-info, path and query, an uncatalogued secret), no fixture secret and no 8-character substring of one appears in the response body, any captured logger call, or the audit mock's arguments. | §1.8.3, S-1..S-4 |
| SA-C8 | The classifier enumerates `Object.keys(env)` and reads `env[name]`; it contains no literal `process.env.NAME`. | §1.5.3, R-5 |
| SA-C9 | The query string is parsed with a strict empty Zod object; any parameter answers 400 in the standard format with `no-store`. | §1.5.5, R-3 |
| SA-C10 | Next numbered row (119) in the handler register of `ADMIN_IDENTIFICATION_AND_ACCESS.md`; update any count or ratchet in `admin-authz-surface.guard.test.ts` that holds for gated handlers; the route's own test pins `requireAdmin` as the first statement. | T-13, T-14, R-6 |
| SA-C12 | `NANGO_PUBLIC_KEY` scope `browser-inlined`; `SMTP_USER` and `NEXT_PUBLIC_TEST_PAGE_USER_ID` are `personal`; any variable that names a real account or user is `personal`. | §1.4 |
| SA-C14 | No value, no screenshot from a real deployment in any evidence. | Whole document |

### 1.2 Analysis summary

| Area | What EC-1 touches |
|---|---|
| New module | `lib/admin/environment/` (catalogue, deny-list, classifier) and `lib/admin/environment-types.ts` |
| New route | `app/api/admin/environment/route.ts` (`GET` only) |
| Audit | One new event constant + metadata entry in `lib/audit/events.ts`; one audience tag in `lib/audit/eventAudience.ts` (its test fails on an untagged event). Entity type: the existing `'system'` (see Q-6), so `lib/audit/types.ts`, `ownerVisibility.ts` and the owner RLS policy are **not** touched and no migration is needed. |
| Reused, unchanged | `lib/admin/requireAdminRoute.ts` (`requireAdmin`), `lib/utils/parseBooleanFlag.ts`, `lib/admin/adminEmailsEnv.ts` (`parseAdminEmails`), `lib/services/AuditTrailService.ts`, `lib/logger` |
| Docs | `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` row 119; requirement §1 Progress row for EC-1 (on each stage, per standing preference) |
| Database | None read or written except the one audit row. No repository is needed (FR-8), so CLAUDE.md rule 1 is not engaged. No migration. |
| Providers / LLM | None |
| Entitlements | The catalogue writes the name `BOS_ENTITLEMENTS_MODE` as a plain string and **does not import** `lib/business-os/entitlements/` (not even its `MODE_ENV_VAR` constant), so the entitlements skill's import trigger is not hit. The mode words `off` / `shadow` / `enforce` are not capability ids or tier names. SA to confirm (Q-9). |
| Pattern status | The catalogue and masking module are a new pattern (CLAUDE.md rule 7), hence the full cycle. |

Precedents followed: `app/api/admin/business-os/billing/subscriptions/route.ts` (the `runtime`/`dynamic` pair, `noStore(gate)` wrapping the gate's 401/403, a strict Zod query object, the error helper with `NO_STORE` headers) and its `__tests__/route.test.ts` (real gate with `getUser` and `AdminAccessService` mocked, a recording logger mock). `lib/admin/adminList-types.ts` for a types-only response module.

### 1.3 Inventory: method and result

**Method (mechanical, re-runnable).** A plain Node script (kept in the session scratchpad, not committed; EC-3 turns the same rules into the Jest guard) walked `app/`, `lib/`, `components/`, `hooks/` recursively plus root-level `middleware.ts`, `next.config.js` and `instrumentation*.ts` (none exists), reading `.ts .tsx .js .jsx .mjs .cjs` files and skipping `node_modules`, `.next`, `*.test.*` / `*.spec.*` and any `__tests__` / `__mocks__` folder. Block and line comments were stripped first. It matched:

| Pattern | Regex (simplified) |
|---|---|
| Dot read | `process\.env\.([A-Za-z_][A-Za-z0-9_]*)` |
| Bracket literal | `process\.env\[\s*['"\`]NAME['"\`]\s*\]` |
| Destructuring | `(const\|let\|var)\s*\{ … \}\s*=\s*process\.env` |
| Other computed reads | `process\.env\[` not followed by a string literal (reported, then resolved by hand) |

Then two read paths that no `process.env` regex can see were added by hand:

- **Plugin definition placeholders.** `lib/server/plugin-manager-v2.ts:155` substitutes `${NAME}` in every `lib/plugins/definitions/*.json` with `process.env[NAME]`, and `lib/plugins/v2/core/UniversalOAuthHandler.ts:134,138` reads `process.env[config.oauth.clientIdEnvVar / clientSecretEnvVar]` from `lib/plugins/v2/configs/*.json`. Both JSON trees were scanned for `${NAME}` and `"…EnvVar": "NAME"`.
- **Library- and page-consumed names.** `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY` are read inside `@upstash/qstash` (`verifySignatureAppRouter`, `app/api/cron/process-queue/route.ts:5`). `VERCEL_REGION`, `VERCEL_GIT_COMMIT_REF` and `VERCEL_GIT_COMMIT_SHA` are read by no code today; only this page will read them (deployment facts).

**Result.**

| Count | What |
|---|---|
| 2,930 | Source files scanned (tests excluded) |
| 101 | Distinct names from literal reads (all dot reads; no bracket-literal or destructuring read exists in the scanned roots). Before comment stripping the count was 103: `NEXT_PUBLIC_` (a bare prefix inside a comment) and `VAR_NAME` (a comment in the plugin manager) were false positives |
| 9 | Computed reads. Resolved: 3 read a module constant that names a variable not otherwise read (`DELETION_RECEIPT_FINGERPRINT_KEY`, `BOS_ENTITLEMENTS_MODE`, `TEST_CLEANUP_SECRET`); 1 reads `SUPABASE_SERVICE_ROLE_KEY` through a constant (`lib/business-os/purge/previewToken.ts`); 1 is a list of names already read literally (`app/api/analyze-prompt-clarity/route.ts:41`); 3 are the plugin substitution paths above; 1 is a test helper under `lib/testing/` that writes, not reads |
| 29 | Names in plugin JSON; **24** of them are read nowhere else |
| 2 | Library-consumed (QStash signing keys) |
| 3 | Page-consumed deployment facts |
| **133** | **Total distinct names to catalogue** (101 + 3 + 24 + 2 + 3) |
| **64** | **Of the 133, not named in the BA seed (§5).** 19 of those 64 resolve a seed row that said "(confirm names)": the 3 AWS Textract names, 4 Slack names, 2 HubSpot, 2 LinkedIn, 2 Airtable, and 6 WhatsApp/Meta names (`WHATSAPP_CLIENT_ID`, `WHATSAPP_CLIENT_SECRET`, `WHATSAPP_CONFIG_ID`, `WHATSAPP_VERIFY_TOKEN`, `META_ADS_CLIENT_ID`, `META_ADS_CLIENT_SECRET`). The other 45 are genuinely new to the seed |
| 2 | Seed names that **no code reads**, so they are not catalogued and are listed for the user to remove from the environments: `MISTRAL_API_KEY` (no Mistral provider exists in `lib/ai/`) and `NEXT_PUBLIC_WEBSITE_BASE_HOST`. The seed's "Upstash Redis URL and token" row also matches nothing: no Redis variable is read |

Seed "(confirm)" rows resolved: `VERCEL_REGION`, `VERCEL_GIT_COMMIT_REF`, `VERCEL_GIT_COMMIT_SHA` confirmed as names (page-consumed); `NEXT_PUBLIC_SUPABASE_ANON_KEY` read in 35 files; `NEXT_PUBLIC_TEST_PAGE_USER_ID` read by `app/test-plugins-v2/page.tsx`; `SMTP_USER` is `personal` (SA-C12); AWS Textract names are `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` (`lib/extraction/TextractClient.ts`).

Local timing of the script (Windows, includes Node start-up): 3.0 to 5.4 s across three runs. Recorded for EC-3's 5 s budget (OQ-9); the Jest version avoids a second Node start-up but adds the JSON trees.

### 1.4 Proposed catalogue

One entry per name. Columns: **Class** (`F` flag, `S` secret, `C` config, `P` personal); **Scope** (`B` = `browser-inlined`, else server); **Shape / parser** (config shape, flag parser and default, personal kind); **Expected** = `expectedIn` as production / preview / local, with `R` required, `O` optional, `X` forbidden; **Read by** (`lit` literal read, `const` computed via a constant, `json` plugin definition, `sdk`, `page`).

`expectedIn` values are a **proposal**: EC-1 ships them as data and nothing displays them until EC-4, so SA (and the user, if SA wants) can correct any row before EC-4 without reshaping the route. The role sentence for each entry is written in code from the BA's §5 wording where one exists; for new names it is written from the read site, one sentence, plain English, saying what it does and what happens when missing.

**Group 1. Environment & deployment (11)**

| Name | Class | Scope | Shape / parser | Expected | Read by |
|---|---|---|---|---|---|
| `NODE_ENV` | C | | enum: development, production, test | R/R/R | lit |
| `VERCEL_ENV` | C | | enum: production, preview, development | R/R/O | lit |
| `NEXT_PUBLIC_VERCEL_ENV` | C | B | enum: production, preview, development | O/O/O | lit |
| `VERCEL` | C | | enum: 1 | O/O/O | lit |
| `VERCEL_URL` | C | | host | O/O/O | lit |
| `NEXT_PUBLIC_VERCEL_URL` | C | B | host | O/O/O | lit |
| `VERCEL_PROJECT_PRODUCTION_URL` | C | | host | O/O/O | lit |
| `NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL` | C | B | host | O/O/O | lit |
| `VERCEL_REGION` | C | | region | O/O/O | page |
| `VERCEL_GIT_COMMIT_REF` | C | | identifier | O/O/O | page |
| `VERCEL_GIT_COMMIT_SHA` | C | | gitSha | O/O/O | page |

**Group 2. Database (Supabase) (6)**

| Name | Class | Scope | Shape / parser | Expected | Read by |
|---|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | C | B | url | R/R/R | lit |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | S | B | | R/R/R | lit |
| `SUPABASE_SERVICE_ROLE_KEY` | S | | | R/R/R | lit, const |
| `SUPABASE_URL` | C | | url | R/R/R | lit |
| `SUPABASE_MAX_CONCURRENCY` | C | | integer | O/O/O | lit |
| `SUPABASE_REQUEST_TIMEOUT_MS` | C | | integer | O/O/O | lit |

**Group 3. Admin & sign-in (3)**

| Name | Class | Scope | Shape / parser | Expected | Read by |
|---|---|---|---|---|---|
| `ADMIN_EMAILS` | P | | list, `parseAdminEmails`; link to Admin users | O/O/O | lit |
| `NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID` | C | B | identifier | O/O/O | lit |
| `SYSTEM_ADMIN_USER_ID` | P | | single (a real user id, SA-C12) | O/O/O | lit |

**Group 4. App addresses (3)**

| Name | Class | Scope | Shape / parser | Expected | Read by |
|---|---|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | C | B | url | R/R/R | lit, json |
| `NEXT_PUBLIC_PUBLIC_SITE_HOST` | C | B | host | O/O/O | lit |
| `NEXT_PUBLIC_MARKETING_URL` | C | B | url | O/O/O | lit |

**Group 5. AI providers (6)**

| Name | Class | Scope | Shape / parser | Expected | Read by |
|---|---|---|---|---|---|
| `OPENAI_API_KEY` | S | | | R/R/O | lit |
| `ANTHROPIC_API_KEY` | S | | | R/R/O | lit |
| `GROQ_API_KEY` | S | | | O/O/O | lit |
| `KIMI_API_KEY` | S | | | O/O/O | lit |
| `OPENAI_MODEL` | C | | identifier | O/O/O | lit |
| `OPENAI_CHAT_MODEL` | C | | identifier | O/O/O | lit |

**Group 6. Plugins & OAuth (34)**

| Name | Class | Scope | Shape / parser | Expected | Read by |
|---|---|---|---|---|---|
| `GOOGLE_CLIENT_ID` | C | | identifier | O/O/O | lit, json |
| `GOOGLE_CLIENT_SECRET` | S | | | O/O/O | lit, json |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | C | B | identifier | O/O/O | lit, json |
| `AIRTABLE_CLIENT_ID` | C | | identifier | O/O/O | json |
| `AIRTABLE_CLIENT_SECRET` | S | | | O/O/O | json |
| `DISCORD_CLIENT_ID` | C | | identifier | O/O/O | json |
| `DISCORD_CLIENT_SECRET` | S | | | O/O/O | json |
| `DROPBOX_APP_KEY` | S (name pattern) | | | O/O/O | json |
| `DROPBOX_APP_SECRET` | S | | | O/O/O | json |
| `HUBSPOT_CLIENT_ID` | C | | identifier | O/O/O | json |
| `HUBSPOT_CLIENT_SECRET` | S | | | O/O/O | json |
| `LINKEDIN_CLIENT_ID` | C | | identifier | O/O/O | json |
| `LINKEDIN_CLIENT_SECRET` | S | | | O/O/O | json |
| `META_ADS_CLIENT_ID` | C | | identifier | O/O/O | json |
| `META_ADS_CLIENT_SECRET` | S | | | O/O/O | json |
| `MICROSOFT_CLIENT_ID` | C | | identifier | O/O/O | json |
| `MICROSOFT_CLIENT_SECRET` | S | | | O/O/O | json |
| `NOTION_CLIENT_ID` | C | | identifier | O/O/O | json |
| `NOTION_CLIENT_SECRET` | S | | | O/O/O | json |
| `SALESFORCE_CLIENT_ID` | C | | identifier | O/O/O | json |
| `SALESFORCE_CLIENT_SECRET` | S | | | O/O/O | json |
| `SLACK_CLIENT_ID` | C | | identifier | O/O/O | json |
| `SLACK_CLIENT_SECRET` | S | | | O/O/O | json |
| `NEXT_PUBLIC_SLACK_CLIENT_ID` | C | B | identifier | O/O/O | lit (deprecated V1 strategy) |
| `NEXT_PUBLIC_SLACK_CLIENT_SECRET` | S | B | | O/O/O | lit (deprecated V1 strategy) |
| `NGROK_SLACK_REDIRECT_URI` | C | | url | X/X/O | lit |
| `NEXT_PUBLIC_NGROK_SLACK_REDIRECT_URI` | C | B | url | X/X/O | lit |
| `WHATSAPP_CLIENT_ID` | C | | identifier | O/O/O | json |
| `WHATSAPP_CLIENT_SECRET` | S | | | O/O/O | json |
| `WHATSAPP_CONFIG_ID` | C | | identifier | O/O/O | json |
| `WHATSAPP_VERIFY_TOKEN` | S | | | O/O/O | lit |
| `NANGO_PUBLIC_KEY` | S | B (SA-C12) | | O/O/O | lit (`next.config.js` `env` only) |
| `NANGO_SECRET_KEY` | S | B (see Q-4) | | O/O/O | lit (`next.config.js` `env` only) |
| `ENCRYPTION_SECRET` | S | | | R/R/R | lit |

**Group 6b. Other external services (9).** Proposed new group, placed after Plugins & OAuth; see Q-3. Default if SA declines: these rows go into group 6.

| Name | Class | Scope | Shape / parser | Expected | Read by |
|---|---|---|---|---|---|
| `AWS_ACCESS_KEY_ID` | S | | | O/O/O | lit (see Q-5) |
| `AWS_SECRET_ACCESS_KEY` | S | | | O/O/O | lit (see Q-5) |
| `AWS_REGION` | C | | region | O/O/O | lit (see Q-5) |
| `GOOGLE_SEARCH_API_KEY` | S | | | O/O/O | lit |
| `GOOGLE_SEARCH_ENGINE_ID` | C | | identifier | O/O/O | lit |
| `NEXT_PUBLIC_GOOGLE_PLACES_API_KEY` | S | B | | O/O/O | lit |
| `PEXELS_API_KEY` | S | | | O/O/O | lit |
| `EXCHANGE_RATE_API_KEY` | S | | | O/O/O | lit |
| `FIXER_API_KEY` | S | | | O/O/O | lit |

**Group 7. Payments (Stripe) (11)**

| Name | Class | Scope | Shape / parser | Expected | Read by |
|---|---|---|---|---|---|
| `STRIPE_SECRET_KEY` | S | | | R/R/O | lit, json |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | S | B | | R/R/O | lit |
| `STRIPE_WEBHOOK_SECRET` | S | | | R/O/O (SA Q-10) | lit |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | S | | | O/O/O | lit |
| `STRIPE_CLIENT_ID` | C | | identifier | O/O/O | lit |
| `NEXT_PUBLIC_STRIPE_CLIENT_ID` | C | B (by prefix) | identifier | O/O/O | json |
| `BUSINESS_OS_PLAN_PRICES_ENABLED` | F | | lenient, default off; `isPlanPriceRecognitionEnabled` | O/O/O | lit |
| `BUSINESS_OS_PLAN_CHECKOUT_ENABLED` | F | | lenient, off; `isPlanCheckoutEnabled` | O/O/O | lit |
| `BUSINESS_OS_CREDITS_BOOST_ENABLED` | F | | lenient, off; `isBusinessOsCreditsBoostEnabled` | O/O/O | lit |
| `BUSINESS_OS_CREDITS_BOOST_TEST_ACCOUNTS` | P | | list, comma split (as `parseBoostTestAccounts` splits) | O/O/O | lit |
| `INVOICE_BARE_URL_GRACE_DAYS` | C | | integer | O/O/O | lit |

**Group 8. Email (14)**

| Name | Class | Scope | Shape / parser | Expected | Read by |
|---|---|---|---|---|---|
| `RESEND_API_KEY` | S | | | O/O/O | lit |
| `RESEND_FROM_EMAIL` | P | | single (an address) | O/O/O | lit |
| `RESEND_WEBHOOK_SECRET` | S | | | O/O/O | lit |
| `SMTP_HOST` | C | | host | O/O/O | lit |
| `SMTP_PORT` | C | | integer | O/O/O | lit |
| `SMTP_SECURE` | F | | strict `=== 'true'`, off (see Q-1) | O/O/O | lit |
| `SMTP_USER` | P | | single (SA-C12) | O/O/O | lit |
| `SMTP_PASS` | S | | | O/O/O | lit |
| `SMTP_FROM` | P | | single (an address) | O/O/O | lit |
| `SMTP_FROM_NAME` | C | | identifier (a name with a space is hidden; accepted) | O/O/O | lit |
| `GMAIL_USER` | P | | single | O/O/O | lit |
| `GMAIL_CLIENT_ID` | C | | identifier | O/O/O | lit |
| `GMAIL_CLIENT_SECRET` | S | | | O/O/O | lit |
| `GMAIL_REFRESH_TOKEN` | S | | | O/O/O | lit |

**Group 9. Background jobs & queues (6)**

| Name | Class | Scope | Shape / parser | Expected | Read by |
|---|---|---|---|---|---|
| `CRON_SECRET` | S | | | R/O/O | lit |
| `QSTASH_TOKEN` | S | | | O/O/O | lit |
| `QSTASH_URL` | C | | url | O/O/O | lit |
| `QSTASH_CURRENT_SIGNING_KEY` | S | | | O/O/O | sdk |
| `QSTASH_NEXT_SIGNING_KEY` | S | | | O/O/O | sdk |
| `SENTINEL_WEBHOOK_SECRET` | S | | | O/O/O | lit |

**Group 10. Tokens & data protection (5)**

| Name | Class | Scope | Shape / parser | Expected | Read by |
|---|---|---|---|---|---|
| `BOOKING_TOKEN_SECRET` | S | | | R/R/O | lit |
| `CONSENT_TOKEN_SECRET` | S | | | O/O/O | lit |
| `NEXTAUTH_SECRET` | S | | (fallback signing secret for four token modules) | O/O/O | lit |
| `IP_HASH_SALT` | S | | | O/O/O | lit |
| `DELETION_RECEIPT_FINGERPRINT_KEY` | S | | | O/O/O | const |

**Group 11. Feature switches (17)**

| Name | Class | Scope | Shape / parser | Expected | Read by |
|---|---|---|---|---|---|
| `NEXT_PUBLIC_USE_V6_AGENT_GENERATION` | F | B | lenient, off; `isV6AgentGenerationEnabled` | O/O/O | lit |
| `NEXT_PUBLIC_USE_V6_REVIEW_MODE` | F | B | lenient, **on**; `isV6ReviewModeEnabled` | O/O/O | lit |
| `NEXT_PUBLIC_MOVE_TO_CALIBRATION_AFTER_AGENT_CREATION` | F | B | lenient, off; `isMoveToCalibrationAfterCreationEnabled` | O/O/O | lit |
| `NEXT_PUBLIC_USE_THREAD_BASED_AGENT_CREATION` | F | B | lenient, off; `isThreadBasedAgentCreationEnabled` | O/O/O | lit |
| `NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI` | F | B | lenient, off; `isNewAgentCreationUIEnabled` | O/O/O | lit |
| `NEXT_PUBLIC_USE_AI_DATA_LAYER` | F | B | lenient, off; `isAIDataLayerEnabled` (a second, strict reader exists, see Q-1) | O/O/O | lit |
| `CALIBRATION_AUTO_RCA_ENABLED` | F | | **strict**, off; `isCalibrationAutoRcaEnabled` | O/O/O | lit |
| `NEXT_PUBLIC_ENABLE_BUSINESS_DELETE` | F | B | lenient, off; `isBusinessDeleteSurfaceVisible`, `isBusinessDeleteSurfaceEnabled` | O/O/O | lit |
| `NEXT_PUBLIC_BUSINESS_OS_CREDIT_HISTORY` | F | B | lenient, off; `isBusinessOsCreditHistoryEnabled`, `isCreditHistoryRouteEnabled` | O/O/O | lit |
| `ADMIN_BUSINESS_DELETE_ENABLED` | F | | lenient, off; `isAdminBusinessDeleteEnabled` | O/O/O | lit |
| `BUSINESS_OS_ACCOUNT_SELF_DELETE_ENABLED` | F | | **strict**, off; `isAccountSelfDeleteEnabled` | O/O/O | lit |
| `BOS_ENTITLEMENTS_MODE` | C | | enum: off, shadow, enforce (shows what is asked; the launch gate may downgrade `enforce`, said in the role) | O/O/O | const |
| `V6_SEMANTIC_SKELETON_ENABLED` | F | | **strict**, off; inline reads only | O/O/O | lit |
| `V6_VALIDATION_DRIVEN_ENABLED` | F | | **strict**, off; inline read only | O/O/O | lit |
| `HARD_REQS_FORMAT` | C | | identifier | O/O/O | lit |
| `SEMANTIC_PLAN_PROMPT_VERSION` | C | | identifier | O/O/O | lit |
| `V6_VERSION` | C | | identifier | O/O/O | lit |

**Group 12. Logging & observability (3)**

| Name | Class | Scope | Shape / parser | Expected | Read by |
|---|---|---|---|---|---|
| `LOG_LEVEL` | C | | enum: trace, debug, info, warn, error, fatal, silent | O/O/O | lit |
| `DEBUG_IR_FORMALIZER` | F | | **strict**, off; inline read | O/O/O | lit |
| `BIZQL_DUMP_PROMPT` | P | | single (a local file path, which can carry a user name) | X/X/O | lit |

**Group 13. Test & development tools (5)**

| Name | Class | Scope | Shape / parser | Expected | Read by |
|---|---|---|---|---|---|
| `BUSINESS_OS_TEST_CREDIT_TOOLS_ENABLED` | F | | lenient, off; `isTestCreditToolsEnabled` | X/X/O | lit |
| `BUSINESS_OS_UPGRADE_MODAL_DEMO_ENABLED` | F | | lenient, off; `isUpgradeModalDemoEnabled` | X/O/O | lit |
| `NEXT_PUBLIC_ALLOW_EARLY_SESSION_OUTCOME` | F | B | lenient, off; `isEarlySessionOutcomeEnabled` | X/O/O | lit |
| `TEST_CLEANUP_SECRET` | S | | | O/X/O | const |
| `NEXT_PUBLIC_TEST_PAGE_USER_ID` | P | B | single (SA-C12) | X/X/O | lit |

Group totals: 11 + 6 + 3 + 3 + 6 + 34 + 9 + 11 + 14 + 6 + 5 + 17 + 3 + 5 = **133**.

Catalogue sanity rules (pinned by tests C-22..C-25): every `config` and `personal` name is checked against the SA-C1 pattern, and any match must be catalogued as `secret` instead (so the catalogue says what the classifier will do); every `NEXT_PUBLIC_` name, plus the two Nango names, has scope `browser-inlined`; every `flag` has a `flagParser` and `flagDefault`; every `enum` lists its values; names are unique.

### 1.5 Implementation approach

#### 1.5.1 Types (`lib/admin/environment-types.ts`)

Types only, no runtime export and no import, as `lib/admin/adminList-types.ts` (so EC-2's page can `import type` it, SA-C11).

```typescript
export type EnvGroupId =
  | 'environment' | 'database' | 'admin' | 'addresses' | 'ai' | 'plugins'
  | 'external' /* Q-3 */ | 'payments' | 'email' | 'jobs' | 'tokens'
  | 'features' | 'logging' | 'testing' | 'uncategorised';
export type EnvSensitivity = 'flag' | 'secret' | 'config' | 'personal';
export type EnvScope = 'server' | 'browser-inlined';
export type EnvExpectation = 'required' | 'optional' | 'forbidden';
export interface EnvExpectedIn { production: EnvExpectation; preview: EnvExpectation; local: EnvExpectation }

export type EnvDisplay =
  | { kind: 'shown'; text: string }
  | { kind: 'status'; set: boolean }
  | { kind: 'flag'; state: 'on' | 'off'; source: 'set' | 'default' | 'unrecognised' }
  | { kind: 'count'; entries: number }
  | { kind: 'hidden'; reason: 'not-plain-config' | 'classification-error' };

export interface EnvRow {
  name: string;
  group: EnvGroupId;
  role: string;
  sensitivity: EnvSensitivity;      // uncatalogued rows: 'secret' (§3.2)
  scope: EnvScope;
  expectedIn: EnvExpectedIn | null; // null only for uncatalogued rows
  display: EnvDisplay;
  seeAlsoPath?: '/admin/settings';  // ADMIN_EMAILS only (OQ-10)
  docLink?: string;
}

export type EnvironmentLabel = 'production' | 'preview' | 'vercel-development' | 'local' | 'unknown';

export interface EnvironmentViewPayload {
  environment: {
    label: EnvironmentLabel;
    // Each fact is the `shown` text of its catalogued row, or null. Never a second read path.
    facts: { host: string | null; region: string | null; branch: string | null; commit: string | null };
  };
  groups: Array<{ id: Exclude<EnvGroupId, 'uncategorised'>; rows: EnvRow[] }>; // §3.4 order
  uncategorised: EnvRow[];          // always present, may be empty (FR-15)
  counts: { rows: number; set: number; notSet: number; uncategorised: number; platformHidden: number };
  generatedAt: string;              // ISO
}
```

Decisions inside SA's frame: `hidden` is only ever for a value that is set (an unset `config` is `status: false`); a `config` or `personal` entry caught by the SA-C1 name pattern becomes `status`, not `hidden`; a set `personal` single is `status`, a `personal` list is `count`. `counts.set` counts rows whose value is set (non-empty after trim), whatever their display.

The catalogue entry type (`EnvCatalogueEntry`) lives in `catalogue.ts` beside the data, server-side, and is not exported to the client: `name`, `group`, `role`, `sensitivity`, `scope`, `expectedIn`, `docLink?`, `seeAlsoPath?`, and per class: `config` → `shape` (+ `enumValues` for `enum`); `flag` → `flagParser: 'lenient' | 'strict-true'` (Q-1) and `flagDefault: boolean`; `personal` → `personalKind: 'single' | 'list-admin-emails' | 'list-comma'`. Plus `consumedBy?: 'sdk' | 'platform' | 'environment-page'` with `consumedByNote` (SA-C13's marker, shipped as data now so EC-3 does not reshape the catalogue; Q-2 covers the names the closed enum does not fit). A discriminated union on `sensitivity` makes a `config` entry without a `shape`, or a `flag` without a default, a type error.

#### 1.5.2 Platform deny-list (`lib/admin/environment/platformDenyList.ts`)

Pure data plus one pure matcher `isPlatformNoise(name: string): boolean`, matched **case-insensitively** (Windows environment names are case-insensitive and arrive as `Path`, `windir`, …). Consulted only for names the catalogue does not list (OQ-4 precedence), so it cannot hide `NODE_ENV`, `AWS_REGION` or any `VERCEL_*` entry.

| Kind | Entries |
|---|---|
| Prefixes | `VERCEL_`, `NOW_`, `AWS_`, `LAMBDA_`, `NPM_`, `NODE_`, `NEXT_` (Next internals such as `NEXT_RUNTIME`), `__`, `_`, `LC_`, `XDG_`, `GIT_`, `VSCODE_`, `TERM_`, `SSH_`, `MSYS`, `MINGW`, `CLAUDE_CODE_`, `PROCESSOR_`, `EFC_`, `FPS_BROWSER_`, `PKG_CONFIG_`, `COREPACK_`. (SA CR-3 removed the broad `CLAUDE`, `ONEDRIVE`, `PYTHON`, `PROGRAM` and `COMMONPROGRAM` prefixes; their tools' own names are exact entries below) |
| Prefix exceptions (SA RC-1) | `NEXT_PUBLIC_`: always app-defined, so never noise; an uncatalogued one lands in Uncategorised, masked |
| Exact names | `PATH`, `PATHEXT`, `HOME`, `HOMEDRIVE`, `HOMEPATH`, `USER`, `USERNAME`, `USERPROFILE`, `USERDOMAIN`, `USERDOMAIN_ROAMINGPROFILE`, `LOGNAME`, `SHELL`, `SHLVL`, `PWD`, `OLDPWD`, `TEMP`, `TMP`, `TMPDIR`, `LANG`, `LANGUAGE`, `TERM`, `TZ`, `HOSTNAME`, `COMPUTERNAME`, `LOGONSERVER`, `SESSIONNAME`, `OS`, `COMSPEC`, `SYSTEMROOT`, `SYSTEMDRIVE`, `WINDIR`, `APPDATA`, `LOCALAPPDATA`, `ALLUSERSPROFILE`, `PUBLIC`, `DRIVERDATA`, `PSMODULEPATH`, `NUMBER_OF_PROCESSORS`, `LD_LIBRARY_PATH`, `INIT_CWD`, `EXEPATH`, `COLORTERM`, `FORCE_COLOR`, `NO_COLOR`, `CI`, `EDITOR`, `PAGER`, `LESS`, `MANPATH`, `HISTFILE`, `MAIL`, `DISPLAY`, `CHROME_CRASHPAD_PIPE_NAME`, `ORIGINAL_XDG_CURRENT_DESKTOP`, `ACSVCPORT`, `ACSETUPSVCPORT`, `ACLOCAL_PATH`, `CONFIG_SITE`, `INFOPATH`, `ORIGINAL_PATH`, `ORIGINAL_TEMP`, `ORIGINAL_TMP`, `PLINK_PROTOCOL`, `NODEFAULTCURRENTDIRECTORYINEXEPATH`, `ZES_ENABLE_SYSMAN`; and since SA CR-3: `CLAUDECODE`, `ONEDRIVE`, `ONEDRIVECONSUMER`, `ONEDRIVECOMMERCIAL`, `PROGRAMFILES`, `PROGRAMFILES(X86)`, `PROGRAMDATA`, `PROGRAMW6432`, `COMMONPROGRAMFILES`, `COMMONPROGRAMFILES(X86)`, `COMMONPROGRAMW6432`, and Python's own `PYTHONPATH`, `PYTHONHOME`, `PYTHONSTARTUP`, `PYTHONDONTWRITEBYTECODE`, `PYTHONUNBUFFERED`, `PYTHONIOENCODING`, `PYTHONUTF8`, `PYTHONHASHSEED`, `PYTHONWARNINGS`, `PYTHONNOUSERSITE`, `PYTHONUSERBASE`, `PYTHONPYCACHEPREFIX` |

Over-hiding is safe (it only counts); under-hiding lands a name in Uncategorised, masked, which is also safe. **Final list (T-15):** tuned against one local run on a Windows developer machine, reading uncategorised **names only** through a throwaway script in the session scratchpad (never values, never committed). Before tuning: 92 hidden, 27 uncategorised. After adding the Git-for-Windows, Python, pkg-config, Corepack and browser-profile names: 108 hidden, 11 uncategorised. **Re-tuned after SA CR-3 (2026-10-27):** 103 hidden, 16 uncategorised. The five that moved back are names in the AI coding tool's session that start `CLAUDE_` but not `CLAUDE_CODE_`; they now show in Uncategorised, masked, which is the intended cost of not hiding a possible app `CLAUDE_*` setting. All 16 remaining belong to the developer's own AI tooling session (for example an AI SDK base-address override and tool-protocol settings) and are deliberately **not** hidden: an SDK override such as a provider base address is something an admin should see listed.

#### 1.5.3 Classifier (`lib/admin/environment/classifyEnvironment.ts`)

```typescript
import 'server-only';
export function classifyEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  options?: { catalogue?: readonly EnvCatalogueEntry[]; isNoise?: (name: string) => boolean; now?: () => Date },
): { payload: EnvironmentViewPayload; rowErrors: Array<{ name: string; errorClass: string }> };
```

Pure: no logger, no `process.env`, no I/O. Options exist so tests inject a catalogue entry that throws (C-19) or a fixed clock. `rowErrors` is returned **beside** the payload so the route can log it, and the route copies only `payload` into the response.

Steps per request (one pass):

1. `names = Object.keys(env)` (SA-C8). Build the catalogue map. For each catalogue entry, read `env[entry.name]`; for each remaining name, `isNoise(name)` ? count it : make an uncategorised row (status only). Uncategorised rows are sorted by name.
2. `isSet = typeof value === 'string' && value.trim() !== ''`.
3. **Name pattern** (SA-C1): if `sensitivity` is `config` or `personal` (or the name is uncatalogued) and the name matches the pattern, the display is `{ kind: 'status', set: isSet }`. A `flag` is not affected.
4. **By class**: `secret` → `status`. `personal` single → `status`; `list-admin-emails` → `count: parseAdminEmails(value).size`; `list-comma` → `count` of non-blank comma-separated entries (0 when unset is shown as `status: false`, not `count: 0`). `flag` → step 6.
5. **`config`**: unset → `status: false`. Set → run the gates in this order, any failure gives `hidden: 'not-plain-config'`: length ≤ 200; no whitespace and no `'`, `"`, `` ` ``; not JWT-shaped (`^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$` with each segment ≥ 4); no run of ≥ 40 characters from `[A-Za-z0-9+/=]` (skipped for `gitSha`); then the shape:

   | Shape | Accepts | Shown text |
   |---|---|---|
   | `url` | `new URL(v)` succeeds and protocol is `http:` or `https:` | `url.origin` only (SA-C4); a non-parsing value is hidden |
   | `host` | `^[A-Za-z0-9.-]+(:\d{1,5})?$`, at least one letter | as is |
   | `integer` | `^-?\d{1,15}$` | as is |
   | `enum` | exact match (trimmed, case-insensitive) to one of `enumValues` | the matched **catalogue** value, not the input |
   | `gitSha` | `^[0-9a-f]{40}$` (case-insensitive) | as is |
   | `region` | `^[a-z]{2,}(-[a-z]+)*-?\d{0,2}$` or a short Vercel region id `^[a-z]{3}\d$` | as is |
   | `identifier` | `^[A-Za-z0-9._:/@-]+$` | as is |

   The 40-character run rule is applied to the **original** value and, for `url`, also to the origin, so a long opaque host label is still hidden.
6. **`flag`**: unset → `{ state: default, source: 'default' }`. Set and `flagParser: 'lenient'` → `parseBooleanFlag`'s token set (`true`/`1`, `false`/`0`, trimmed, case-insensitive): recognised → `source: 'set'`; otherwise `{ state: default, source: 'unrecognised' }`, matching what `parseBooleanFlag(value, default)` returns. `flagParser: 'strict-true'` → exactly `'true'` is on/`set`, exactly `'false'` is off/`set`, anything else is off/`unrecognised` (the code reads it as off). No raw text in any branch (SA-C3).
7. Each row is built inside its own `try`/`catch`. On a throw: display `{ kind: 'hidden', reason: 'classification-error' }`, push `{ name, errorClass: err?.constructor?.name ?? 'Unknown' }`; never read `err.message` (SA-C6). An unknown `sensitivity` or `shape` (only possible through a type escape) throws inside the row, so it lands here and masks (M-4).
8. **Environment label** from `env['VERCEL_ENV']` and `env['NODE_ENV']` per requirement §3.1 (`production`, `preview`, `development` → `vercel-development`; no `VERCEL_ENV` and `NODE_ENV === 'development'` → `local`; else `unknown`). `NODE_ENV` alone never yields `production`.
9. **Facts** copy the `shown` text of the `VERCEL_URL`, `VERCEL_REGION`, `VERCEL_GIT_COMMIT_REF` and `VERCEL_GIT_COMMIT_SHA` rows, else null, so a fact cannot bypass the shape gates.
10. Rows are constructed field by field from the entry and the computed display (SA-C5); nothing is spread from the entry and the value variable never leaves the row function.

If building the whole payload throws (for example a catalogue that fails to load), the classifier throws and the route answers 500: never an unmasked list (requirement §6 fail-closed).

#### 1.5.4 Catalogue (`lib/admin/environment/catalogue.ts`)

`export const ENVIRONMENT_CATALOGUE: readonly EnvCatalogueEntry[]` holding the 133 entries of §1.4, plus `ENVIRONMENT_GROUP_ORDER` (the §3.4 order) and a one-line description per group (for EC-2). Pure data; its only imports are `import type` from `@/lib/admin/environment-types`. It deliberately does not import the flag readers (OQ-5) or `MODE_ENV_VAR` (§1.2). Not marked `server-only` itself (it has no secrets and EC-3's Jest guard reads it), but the client-boundary test that EC-2 adds (SA-C11) forbids any `'use client'` file importing `lib/admin/environment/`.

#### 1.5.5 Route (`app/api/admin/environment/route.ts`)

```typescript
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'AdminEnvironmentAPI' });
const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const QuerySchema = z.object({}).strict();

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, route: '/api/admin/environment' });

  const gate = await requireAdmin(requestLogger);   // first statement that does work
  if (gate instanceof NextResponse) return noStore(gate);
  const adminId = gate.user.id;

  // SA-C9: any query parameter is a 400.
  if (!QuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams)).success) → 400 'This page takes no parameters.' code 'invalid_input'

  try {
    const { payload, rowErrors } = classifyEnvironment(process.env);
    for (const e of rowErrors) requestLogger.warn({ variable: e.name, errorClass: e.errorClass }, 'Environment row masked after a classification error');
    requestLogger.info({ adminUserId: adminId, environment: payload.environment.label, ...payload.counts }, 'Environment view built');
    auditTrail.log({ action: AUDIT_EVENTS.ADMIN_ENVIRONMENT_VIEWED, entityType: 'system', entityId: null,
                     userId: adminId, actorId: adminId, severity: 'info',
                     details: { correlationId, environment: payload.environment.label, ...payload.counts }, request })
      .catch((err) => requestLogger.error({ errorClass: err?.constructor?.name }, 'Audit failed (non-blocking)'));
    return NextResponse.json({ success: true, data: payload }, { headers: NO_STORE });
  } catch (err) {
    requestLogger.error({ errorClass: err?.constructor?.name }, 'Environment view failed');
    return 500 { success: false, error: 'The environment view could not be built.',
                 details: NODE_ENV === 'development' ? 'environment_classification_failed' : undefined }  // fixed code, SA-C6
  }
}
```

Notes on choices:

- The two `const` lines before the gate do no I/O and read no input; this is the same shape as `app/api/admin/model-pricing/history/route.ts`, and the authz guard's R1 accepts it. The route test pins that `requireAdmin` is called before the query is parsed or `classifyEnvironment` runs.
- `process.env` appears in the route as a whole object only, plus the one `process.env.NODE_ENV === 'development'` guard that the standard error format requires. That is a literal read of `NODE_ENV`, which Next.js inlines at build; correct for that guard, and `NODE_ENV` is catalogued.
- Error logs carry `errorClass`, not `{ err }`. CLAUDE.md says "errors always as `{ err }`", but Pino's error serializer writes `err.message`, and SA-C6 forbids a value-derived message. The classifier never builds a message from a value, so `{ err }` would be safe in practice; logging the class only removes the dependency on that being true. **SA to confirm the deviation (Q-7).**
- Audit is non-blocking with no awaited flush: this is a read, not a WC-7 money, access, entitlement or price write. OQ-8 says the same.
- `request` is passed to `auditTrail.log` as other admin routes do (IP and user agent), never the body.

### 1.6 Files to create / modify

| # | File | Action | Reason |
|---|---|---|---|
| F-1 | `lib/admin/environment-types.ts` | create | Response and row types, types only (OQ-5, SA-C5, SA-C11) |
| F-2 | `lib/admin/environment/catalogue.ts` | create | The 133 entries, group order and descriptions (OQ-5, OQ-7) |
| F-3 | `lib/admin/environment/platformDenyList.ts` | create | Deny-list data and `isPlatformNoise` (OQ-4) |
| F-4 | `lib/admin/environment/classifyEnvironment.ts` | create | `server-only` pure classifier (§1.5.3) |
| F-5 | `lib/admin/environment/__tests__/classifyEnvironment.test.ts` | create | Classes, backstops, precedence, label, error masking |
| F-6 | `lib/admin/environment/__tests__/catalogue.test.ts` | create | Catalogue sanity + `flagDefault` vs readers (OQ-5) |
| F-7 | `lib/admin/environment/__tests__/serialisation.test.ts` | create | SA-C7 acceptance gate (route + logger + audit) |
| F-8 | `app/api/admin/environment/route.ts` | create | The route (§1.5.5) |
| F-9 | `app/api/admin/environment/__tests__/route.test.ts` | create | 200, 401, 403, 400, 500, audit failure, source pins |
| F-10 | `lib/audit/events.ts` | modify | `ADMIN_ENVIRONMENT_VIEWED` constant + `EVENT_METADATA` entry (severity `info`, `complianceFlags: ['SOC2']`, description) |
| F-11 | `lib/audit/eventAudience.ts` | modify | Tag `ADMIN_ENVIRONMENT_VIEWED: 'shared'` (admin/system rule) |
| F-12 | `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` | modify | Register row 119; Change History line |
| F-13 | `lib/admin/__tests__/admin-authz-surface.guard.test.ts` | verify, modify only if needed | Gated-handler checks are floors (`>= 40` route files), not equalities, and the caps are on exemptions; a new gated route should need no edit. Run it and record. The header comment's census figures are prose, not asserted; left alone unless SA wants them refreshed |
| F-14 | `docs/requirements/ADMIN_ENVIRONMENT_CONFIGURATION_VIEW_REQUIREMENT.md` | modify | §1 Progress row for EC-1 at each stage (standing preference) |
| F-15 | this workplan | modify | Ticks, SA notes, final deny-list, timings |

No file touched by EC-1 uses `console.*` today (checked: `lib/audit/events.ts`, `lib/audit/eventAudience.ts`, `lib/admin/adminEmailsEnv.ts`, `lib/utils/parseBooleanFlag.ts` all 0), so no CLAUDE.md § Logging conversion is triggered.

### 1.7 Task list

- ✅ T-1: SA reviews this workplan; rulings on §1.9 recorded in §5
- ✅ T-2: Requirement §1 Progress row EC-1 updated (F-14; also carries RC-8)
- ✅ T-3: `environment-types.ts` (F-1)
- ✅ T-4: `catalogue.ts` with the entry union type, 133 entries, role sentences, group order and descriptions (F-2; RC-6 applied)
- ✅ T-5: `platformDenyList.ts` (F-3; RC-1 applied)
- ✅ T-6: `classifyEnvironment.ts` (F-4; RC-2 applied)
- ✅ T-7: Classifier unit tests (F-5)
- ✅ T-8: Catalogue tests incl. `flagDefault` and parser agreement with readers (F-6; RC-4 applied)
- ✅ T-9: Audit event constant, metadata, audience tag (F-10, F-11); `lib/audit/__tests__` run (the audience split pin needed +1 shared, see §1.11)
- ✅ T-10: Route (F-8)
- ✅ T-11: Route tests (F-9)
- ✅ T-12: Source pins: segment exports, `GET` only, `no-store` everywhere, no `process.env` text in the classifier, RC-5 pin R-10
- ✅ T-13: Serialisation acceptance test (F-7), SA-C7 with RC-3 (a) to (d)
- ✅ T-14: Access register row 119 (F-12); `npm run test:authz-guard` passes with no edit to F-13
- ✅ T-15: Deny-list tuned against a local run, names only; final list in §1.5.2
- ✅ T-16: Gates: new suites, `test:authz-guard`, `test:bos-entitlements`, `tsc --noEmit` filtered to touched files, `eslint` and the hooks lint on touched files. **`npm run build` not run** (see §1.11, left to the RM's ship drill and CI)
- ✅ T-17: Status → Code Complete; requirement Progress row updated; hand to SA for code review

### 1.8 Test plan

All fixtures are made up and obviously fake (for example `FAKE-only-for-tests-…` strings, `example.test` hosts). No test reads `process.env` for real values; classifier tests pass an object. Tests that must exercise readers set and restore `process.env` keys they own.

#### 1.8.1 Classifier (`classifyEnvironment.test.ts`)

| # | Case | Expect |
|---|---|---|
| C-1 | A catalogued `config` whose name contains `SECRET` (injected test catalogue), set to a short plain word | `status: true`, the word absent from the payload |
| C-2 | A `NEXT_PUBLIC_*_KEY` name catalogued as `config` (injected) | `status`; a `NEXT_PUBLIC_` prefix does not lift the rule |
| C-3 | Each SA-C1 token, upper and lower case, in an uncatalogued name | `status` |
| C-4 | A `flag` whose name contains `SESSION` | On / Off, not status |
| C-5 | JWT-shaped value under an `identifier` entry | `hidden: not-plain-config` |
| C-6 | 40-char base64-ish run under an `identifier` entry; 39 chars | hidden; shown |
| C-7 | 201 chars; whitespace; each quote character | hidden |
| C-8 | `url` with user-info, path, query, fragment | `shown` text is the origin only |
| C-9 | `url` that does not parse; `ftp:` scheme | hidden |
| C-10 | `enum` value in other case / with spaces around | shown as the catalogue's spelling; an out-of-set value hidden |
| C-11 | `gitSha` 40 hex shown; 39 hex hidden; `identifier` given a 40-hex string hidden by the run rule | as stated |
| C-12 | `integer`, `host`, `region` positive and negative cases | as stated |
| C-13 | `ADMIN_EMAILS` with mixed separators and blanks | `count` equals `parseAdminEmails(v).size`; `seeAlsoPath` set |
| C-14 | `list-comma` with blanks | count of non-blank entries; unset → `status: false` |
| C-15 | `personal` single set / unset | `status` true / false |
| C-16 | lenient flag: unset, `TRUE`, ` 1 `, `0`, `false`, `yes`, empty | default/default; on/set; on/set; off/set; off/set; default/unrecognised; default/default |
| C-17 | strict flag: `true`, `TRUE`, `1`, `false`, unset | on/set; off/unrecognised; off/unrecognised; off/set; off/default |
| C-18 | Any flag row | JSON has no key other than `kind`, `state`, `source` in `display` |
| C-19 | Injected entry whose processing throws an error whose message contains a fixture secret | row `hidden: classification-error`; `rowErrors` has name + class; the fixture appears nowhere in the return value |
| C-20 | A catalogued name that matches the deny-list (`VERCEL_ENV`, `AWS_REGION`, `NODE_ENV`) | listed in its group, not counted as hidden |
| C-21 | Deny-listed uncatalogued names in mixed case (`Path`, `windir`, `npm_config_x`, `AWS_SESSION_TOKEN`) | counted in `platformHidden`, not listed, names absent from the payload |
| C-22 | An uncatalogued non-noise name | in `uncategorised`, `status`, role "Not described in the catalogue yet." |
| C-23 | Catalogued and unset | in its group with `status: false` (or flag default) |
| C-24 | Environment label table of §3.1, including `NODE_ENV=production` without `VERCEL_ENV` | `unknown`, never `production` |
| C-25 | Facts | come from shown rows only; a fact whose row is hidden is null |
| C-26 | Group order and the always-present `uncategorised` array | as `ENVIRONMENT_GROUP_ORDER`; `[]` when none |
| C-27 | Counts | match rows; `set` counts set values across classes |
| C-28 | Source pin: `classifyEnvironment.ts` contains no `process.env` text at all and starts with `import 'server-only'` | pass |

#### 1.8.2 Catalogue (`catalogue.test.ts`)

| # | Case |
|---|---|
| K-1 | Names unique; every group id valid; every entry has a non-empty role ending in a full stop and no underscore-code prose |
| K-2 | No `config` or `personal` entry name matches the SA-C1 pattern (so the catalogue states what the classifier does) |
| K-3 | Every `NEXT_PUBLIC_*` entry and both Nango entries have scope `browser-inlined`; no other entry does |
| K-4 | Every `config` has a shape, every `enum` lists values, every `flag` has `flagParser` and `flagDefault`, every `personal` has a kind |
| K-5 | **`flagDefault` and parser agree with the reader** (OQ-5). For each flag with a named reader, set the variable to each of: unset, `true`, `TRUE`, `1`, `0`, `false`, `yes`, and assert the classifier's `state` equals the reader's boolean. Readers: the `featureFlags.ts` functions, `isPlanCheckoutEnabled`, `isPlanPriceRecognitionEnabled`, `isTestCreditToolsEnabled`, `isUpgradeModalDemoEnabled`, `isCreditHistoryRouteEnabled`, `isBusinessDeleteSurfaceEnabled`, `isCalibrationAutoRcaEnabled` (its module's Supabase import mocked). Flags read only inline (`V6_SEMANTIC_SKELETON_ENABLED`, `V6_VALIDATION_DRIVEN_ENABLED`, `DEBUG_IR_FORMALIZER`, `SMTP_SECURE`) assert against the SA fallback: `parseBooleanFlag(undefined, flagDefault)` for the default, and for `strict-true` the documented `=== 'true'` rule |
| K-6 | `consumedBy` present exactly on the page- and sdk-consumed entries listed in §1.4, each with a note |
| K-7 | `catalogue.ts` has only `import type` imports |

#### 1.8.3 Serialisation acceptance gate (`serialisation.test.ts`, SA-C7)

Runs the **real route** with the real classifier and real catalogue; mocks only `getUser`, `AdminAccessService`, `recordRefusedAccess`, the logger (recording every call's arguments) and `AuditTrailService.getInstance().log` (recording its argument). `process.env` is extended for the test with fixture values and restored after.

| # | Fixture | Placed under |
|---|---|---|
| S-1 | A distinct fake secret for every `secret` entry, every `personal` entry and two uncatalogued names (one non-matching the pattern, one matching) | those names |
| S-2 | A JWT-shaped fake under `GOOGLE_SEARCH_ENGINE_ID`; a 48-char key-shaped fake under `STRIPE_CLIENT_ID` | config entries |
| S-3 | `NEXT_PUBLIC_APP_URL` = a URL with fake secrets in user-info, password, path and query | config `url` |
| S-4 | An unrecognised flag value that is itself a fake secret | a lenient and a strict flag |

Assertions: for every fixture secret (and every user-info / path / query part of S-3), neither the whole string nor **any 8-character substring** of it appears in (a) the serialised response body, (b) `JSON.stringify` of every recorded logger call, (c) `JSON.stringify` of the audit mock's argument. Fixture strings are generated so no 8-character window of them occurs in any catalogue role or name (asserted first, so the test cannot pass or fail for the wrong reason). Also run once with an audit mock that rejects with an error carrying a fixture secret in its message: still no leak in logs (this is what `errorClass` logging buys). Plus: the audit argument contains no variable name from the uncategorised fixtures.

#### 1.8.4 Route (`app/api/admin/environment/__tests__/route.test.ts`)

| # | Case | Expect |
|---|---|---|
| R-1 | Admin, no query | 200, `success: true`, payload shape, `Cache-Control: no-store` |
| R-2 | Signed out; signed in non-admin | 401; 403; both `no-store`; classifier and audit never called |
| R-3 | Admin with `?a=1`; with `?a=1&a=2` | 400 standard format, `no-store`; classifier and audit not called |
| R-4 | Classifier throws (module mock) | 500, fixed sentence, `details` only in development and equal to the fixed code, `no-store` |
| R-5 | Source pin: route file exports exactly `runtime = 'nodejs'`, `dynamic = 'force-dynamic'` and `GET`; no `revalidate`, `fetchCache`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS` (CRLF-safe parse, no `\n`-anchored regex) |
| R-6 | Source pin: `requireAdmin(` is the first awaited call in `GET`, before `searchParams` and `classifyEnvironment(` |
| R-7 | A row error from the classifier | logged with `variable` and `errorClass` only |
| R-8 | Audit called once per 200 with `ADMIN_ENVIRONMENT_VIEWED`, `entityType: 'system'`, details = label + counts + correlationId, nothing else |
| R-9 | Audit rejects | response still 200 |

Coverage against CLAUDE.md: happy path (R-1), auth failure (R-2), invalid input (R-3), plus one server failure (R-4).

### 1.9 Questions for SA

| # | Question | Dev's recommendation |
|---|---|---|
| Q-1 | **Strict flag readers.** Six flags are read with `=== 'true'`, not `parseBooleanFlag`: `CALIBRATION_AUTO_RCA_ENABLED`, `BUSINESS_OS_ACCOUNT_SELF_DELETE_ENABLED`, `V6_SEMANTIC_SKELETON_ENABLED`, `V6_VALIDATION_DRIVEN_ENABLED`, `DEBUG_IR_FORMALIZER`, `SMTP_SECURE`. With `parseBooleanFlag` alone the page would show On for `TRUE` or `1` while the code is off. `NEXT_PUBLIC_USE_AI_DATA_LAYER` has two readers that disagree (`featureFlags.ts` lenient, `app/api/business-os/chat-v2/route.ts:70,212` strict). | Add `flagParser: 'lenient' \| 'strict-true'` per entry (§1.5.3 step 6), and K-5 tests it against each reader. For the AI data layer flag, catalogue it `lenient` (the shared reader) and say in its role that one route reads it strictly; the fix to the route belongs to its owner (§1.10). |
| Q-2 | **Names the drift guard cannot see and the `consumedBy` enum does not fit.** 24 names are read only through plugin definition placeholders (`${NAME}` substituted by `plugin-manager-v2.ts`) or `*EnvVar` fields; 3 are read through a module constant (`process.env[KEY_ENV]`). SA-C13's closed enum (`sdk`, `platform`, `environment-page`) fits neither. | For EC-3: scan `lib/plugins/definitions/*.json` and `lib/plugins/v2/configs/*.json` for `${NAME}` and `"…EnvVar": "NAME"` as a read source (cheap, keeps the guard honest), and resolve `const X = 'NAME'` + `process.env[X]` in the same file. If SA prefers a marker instead, add `plugin-definition` and `constant` to the enum. EC-1 ships `consumedBy` only on the 5 sdk/page entries either way. |
| Q-3 | **Group for external data services** (Textract, Google Search, Places, Pexels, two exchange-rate keys): no §3.4 group fits; they are not plugins. | A new group "Other external services" after Plugins & OAuth (§1.4 6b). Fallback: group 6. |
| Q-4 | **Scope of `NANGO_SECRET_KEY`.** It is declared in the same `next.config.js` block as `NANGO_PUBLIC_KEY`, which SA-C12 ruled `browser-inlined`. | Same scope, `browser-inlined`, by the same reasoning. |
| Q-5 | **`AWS_*` names on Vercel.** Vercel documents that `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` and `AWS_REGION` may appear in Functions even when the project does not set them. So "Set" on Production may describe the runtime's own name, not the Textract credential. | Keep them catalogued (precedence beats the `AWS_` deny prefix, so they show Set / Not set), and say so in each role sentence: "On Vercel the runtime may set this name itself, so Set does not prove the Textract credential is configured." No name change in EC-1. |
| Q-6 | **Audit entity type.** A new entity type would require `lib/audit/types.ts`, `ownerVisibility.ts` and a migration of the owner RLS policy list. | Use the existing `'system'` with `entityId: null`, as the boost reconcile and entitlements launch routes do. The admin is the row's `user_id`, so the admin could read their own view rows on `/monitoring`; they hold only the label and counts. |
| Q-7 | **Logging errors as `{ errorClass }` instead of `{ err }`** in this route (§1.5.5). | Accept the deviation for this route only, with a comment citing SA-C6. |
| Q-8 | **`config` client IDs shown in plain text.** OAuth client IDs (`GOOGLE_CLIENT_ID`, the plugin `*_CLIENT_ID`s, `STRIPE_CLIENT_ID`) are not secrets and pass the shape gates, so they will be shown to admins. | Accept: they are public by design, and SA-C14 keeps them out of evidence. |
| Q-9 | **Entitlements skill.** Confirm that catalogueing `BOS_ENTITLEMENTS_MODE` as a string with the enum `off`/`shadow`/`enforce`, without importing `lib/business-os/entitlements/`, does not engage the `business-os-entitlements` skill. | Not engaged; `npm run test:bos-entitlements` runs in T-16 anyway because it covers `lib/audit/__tests__`. |
| Q-10 | **`expectedIn` proposals** (§1.4). Shipped as data now, displayed in EC-4. | SA reviews the R and X cells now; anything doubtful defaults to O, which shows no diagnostic. |

### 1.10 Findings for other streams (not fixed here)

Code facts found by the inventory. Names only; nothing about any deployment's values.

| # | Finding | Owner / suggestion |
|---|---|---|
| X-1 | `MISTRAL_API_KEY` and `NEXT_PUBLIC_WEBSITE_BASE_HOST` are read by no code; no Upstash Redis variable is read either | User: remove from the environments if present |
| X-4 | Two Stripe Connect client id names: `STRIPE_CLIENT_ID` (code) and `NEXT_PUBLIC_STRIPE_CLIENT_ID` (Stripe plugin definition) | Payments owner: pick one |
| X-5 | `NEXT_PUBLIC_USE_AI_DATA_LAYER` read leniently in `featureFlags.ts` and strictly in `chat-v2/route.ts` | Business OS chat owner: use the shared reader |

Security-relevant findings from the inventory are tracked privately, not in this public repository (SA-C14).

### 1.11 Implementation notes

**Files.** Created: `lib/admin/environment-types.ts`, `lib/admin/environment/catalogue.ts`, `lib/admin/environment/platformDenyList.ts`, `lib/admin/environment/classifyEnvironment.ts`, `app/api/admin/environment/route.ts`, and tests `lib/admin/environment/__tests__/{classifyEnvironment,catalogue,serialisation}.test.ts`, `app/api/admin/environment/__tests__/route.test.ts`. Modified: `lib/audit/events.ts`, `lib/audit/eventAudience.ts`, `lib/audit/__tests__/eventAudience.test.ts`, `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md`, the requirement, this workplan.

**How each SA required change landed.**

| RC | Where |
|---|---|
| RC-1 | `PLATFORM_NOISE_PREFIX_EXCEPTIONS = ['NEXT_PUBLIC_']`, checked before any prefix; test C-21b |
| RC-2 | `IDENTIFIER` is `^[A-Za-z0-9._:/-]+$`; C-12 has the address-shaped negative case. No catalogued `identifier` needed `@` |
| RC-3 | `serialisation.test.ts`: (a) windows and sinks lowercased; (b) the logger mock records `createLogger` and `child()` bindings at every depth, and `console.*` is spied as a fourth sink; (c) S-5 with `AWS_SESSION_TOKEN`, `npm_config_fixture_secret`, `lc_fixture_thing`, checked for value and name; (d) S-6a (`parseAdminEmails` throws with a fixture in its message) and S-6b (the deny-list throws with a fixture, a whole-classification failure, so 500) both under `NODE_ENV=development`, `details` is the fixed code. Plus a negative control showing the detector does fire on an upper-cased 8-character window |
| RC-4 | K-4: every `strict-true` flag has `flagDefault: false` |
| RC-5 | R-10 in `route.test.ts`, over the route and the classifier with comments stripped (CRLF-safe): no `.message`, no `{ err` logger argument, no spread of `process.env` or `env`; exactly two `process.env` uses in the route, `classifyEnvironment(process.env)` and the `NODE_ENV === 'development'` details guard |
| RC-6 | `external` group in `EnvGroupId` and `ENVIRONMENT_GROUPS` (order, label, description as ruled); `STRIPE_WEBHOOK_SECRET` R/O/O; AWS caveat on all three AWS roles; AI data layer role names the strict route; `BOOKING_TOKEN_SECRET` role names its fallback. No quoted tier name or capability id in any role |
| RC-7 | Register row written as 119 with a note that the RM re-checks the number against `main` at commit; no test or code comment names the number |
| RC-8 | Requirement Progress row 1 and a Change History line |

**SA optimisation suggestions.** Adopted: `region` anchored to the two known formats (`^[a-z]{3}\d$`, `^[a-z]{2}-[a-z]+-\d$`). Not adopted: `correlationId` as the audit `entityId` (a caller can supply `x-correlation-id`, so it is not guaranteed to be a UUID, and the column's type was not checked against the live schema; it stays `null`, with the correlation id in `details`). `NODE_TLS_REJECT_UNAUTHORIZED`: left for EC-4 as SA suggested.

**Deviations and interpretations for SA to check.**

1. **JWT rule.** As first written (three dot-separated base64url segments of 4+ characters) it hid ordinary three-label hosts such as `deploy-x.example.test`, which test C-25 caught. Now: three segments of **10+** characters each, **or** any segment starting `eyJ` (the encoded-JSON opening every JWT has) followed by a dot. Still fail closed for every real JWT; pinned by new cases in C-5.
2. **Config values are trimmed** before the gates and shapes, so a trailing newline pasted into a deployment setting does not hide an otherwise plain value. Internal whitespace still hides.
3. **`npm run build` not run** in this slice (T-16). The coordinator's gate list for this hand-over did not include it and it takes most of the worktree's memory; it stays the first step of the RM's ship drill and runs in CI.
4. **`eventAudience.test.ts` edited**: its pinned split moved from 222 / 76 shared to 223 / 77 shared, with the dated comment line its convention requires.
5. **Access register census not re-derived.** 89 `route.ts` files are on disk against 82 at the last count; six of them were landed on `main` by other streams without register rows (billing accounts, plans, subscriptions; exchange rates x3). Recorded in the doc's Change History, not fixed here.

**Gate results (local, Windows).**

| Gate | Result |
|---|---|
| New suites (`lib/admin/environment`, `app/api/admin/environment`, `lib/audit/__tests__/eventAudience.test.ts`) | 5 suites, 109 tests, all pass; Jest time 9.5 s, wall 21 s. The 4 new suites hold 88 tests: classifier 40, catalogue 29, serialisation 6, route 13; each suite 5 to 9 s locally |
| `npm run test:authz-guard` | 2 suites, 203 tests pass; 60 s Jest, 70 s wall. No guard edit needed |
| `npm run test:bos-entitlements` | 313 suites, 9,399 tests pass, 5 min 51 s wall (the first run failed only on the audience split pin, fixed as deviation 4) |
| `npx tsc --noEmit` (full project, 8 GB heap) | Completed, no OOM, exit 2 with 1,852 pre-existing diagnostics; **0** in any touched file. 11 min wall |
| `eslint` on touched files | 0 errors; 1 warning, pre-existing, at `lib/audit/events.ts:1834` (outside the diff) |
| Hooks lint (`eslint.hooks.config.mjs`, `--max-warnings 0`) on the new files | Clean |

**SA code review fixes (CR-1 to CR-3, 2026-10-27).**

| CR | Change | Test |
|---|---|---|
| CR-1 (High) | `serialisation.test.ts`: every sink (logger records, audit records, console records, and the name checks) is now turned into text by `sinkText()`, which is `util.inspect(value, { depth: null, maxArrayLength: null, maxStringLength: null, breakLength: Infinity })`, not `JSON.stringify`. That expands an `Error` (name, message, stack, `cause`), `Map` and `Set` contents and nested objects. The response body is still checked as the raw response text | New negative control: a logger record `{ level: 'error', args: [{ err: new Error(fixture) }] }`, an Error whose `cause` carries the fixture, a `Map` and a `Set` are each detected; and `JSON.stringify({ err: new Error(fixture) })` is shown NOT to be detected, which is why the change was needed |
| CR-2 (Medium) | `classifyEnvironment.ts`: `JWT_OPENING` is unanchored, `/eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+/`, so it matches anywhere in the value | C-5 adds `prefix:eyJfakeHeader.fakePayload_with-dash.sig` and `path/eyJfake.x` (both hidden); `deploy-x.example.test` is still shown |
| CR-3 (Medium) | `platformDenyList.ts`: `CLAUDE` → prefix `CLAUDE_CODE_` + exact `CLAUDECODE`; `ONEDRIVE` → exact `ONEDRIVE`, `ONEDRIVECONSUMER`, `ONEDRIVECOMMERCIAL`; `PYTHON` → 12 exact Python names; `PROGRAM` / `COMMONPROGRAM` → the 7 exact Windows names. Re-tuned, names only; §1.5.2 updated (103 hidden, 16 uncategorised) | C-21c: `CLAUDE_MODEL`, `ONEDRIVE_CLIENT_ID`, `PYTHON_SERVICE_URL`, `PROGRAM_NAME` land in Uncategorised, masked, while `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `OneDrive`, `PYTHONPATH`, `ProgramFiles(x86)`, `CommonProgramW6432` are counted as platform noise |

**Gate results after CR-1 to CR-3 (local, Windows, 2026-10-27).**

| Gate | Result |
|---|---|
| New suites + `eventAudience.test.ts` | 5 suites, 111 tests, all pass; Jest time 15.8 s. The 4 new suites hold 90 tests: classifier 41, catalogue 29, serialisation 7, route 13 |
| `npm run test:authz-guard` | 2 suites, 203 tests pass; 1 min 45 s wall |
| `npm run test:bos-entitlements` | 313 suites, 9,399 tests pass; 3 min 29 s wall |
| `eslint` on touched files | 0 errors; the same 1 pre-existing warning at `lib/audit/events.ts:1834` |
| Hooks lint on the new files | Clean |
| `npx tsc --noEmit` | Not re-run for this round (not in the requested gates). The CR changes are one regex, a deny-list data change and test code; `new Error(msg, { cause })` is typed by the project's `esnext` lib. The RM's ship drill re-runs the typecheck |

**QA fixes (QF-1 to QF-3, SA ruling on QA's EC-1 notes, 2026-10-27).** All in `lib/admin/environment/classifyEnvironment.ts`; no route, export or catalogue entry changed.

| QF | Change | Test |
|---|---|---|
| QF-1 | New `hasMixedKeyRun()`: a `[A-Za-z0-9]{20,}` run holding an upper-case letter, a lower-case letter and a digit hides the value under `identifier` and `host`. `host` also hides any value with an upper-case letter | C-12b: hidden are an `sk-proj-…`-style fake broken by `-`, an AWS-access-key-shaped fake under `host`, `Mail.Example.test`, and a host label holding a mixed run. Still shown: the Google-style lower-case fake, a UUID, `feature/some-branch`, and a 19-character mixed run (below the floor) |
| QF-2 | `url` requires the trimmed value to match `^https?://` (case-insensitive) before parsing | C-9: `https:opaqueword` hidden; `HTTPS://Example.test/x` still shown as its origin |
| QF-3 | `scopeOfName` checks `NEXT_PUBLIC_` case-sensitively; the deny-list's case-insensitive exception is unchanged | C-22b: an uncategorised `next_public_x` is listed (platform count 0) with scope `server` |
| Optional | `isEnvironmentViewPayload` (EC-2 file) also requires `counts.platformHidden` to be a number | Two new guard cases in `environmentDisplay.test.ts` |

Gates after QF-1 to QF-3: the `lib/admin/environment`, `app/api/admin/environment` and `app/admin/environment` suites, 7 suites, **125 tests pass** (classifier 43, catalogue 29, serialisation 7, route 13, render 21, display 6, client boundary 6), 16 s. `eslint` on `lib/admin/environment` and `app/admin/environment`: clean.

---

## 2. EC-2: page and sidebar entry

**Status:** Workplan SA-approved with changes (E2-1 to E2-4, 2026-10-27); implementation in progress. **Path:** UI short path (OQ-1): Dev → SA review + QA in parallel → RM. **EC-1 and EC-2 ship together in one PR** (the user allowed grouping; SA review 2026-10-27), so EC-2 is built on this branch on top of EC-1's route and types and does not wait for a merge. The user waived the diff review for this stream (2026-10-27): SA approval plus QA approval is the gate before the RM commits.

### 2.1 Rulings and conditions this slice carries

| Ref | What EC-2 must do | Where |
|---|---|---|
| FR-9 | New page `/admin/environment`, a new item appended at the **end** of the Settings section (after Admin users). Label "Environment", description "How this deployment is configured, read-only" | §2.4, T2-6 |
| FR-10 | Server-guarded like every `/admin` page. `app/admin/layout.tsx` already calls `requireAdminPage()` for every page under `/admin`, so the page adds no guard of its own. It is `'use client'` with no server props, which keeps authz rule R8 true | §2.3 |
| FR-11 | Admin Layout Standard as Admin users (L-12) does it: `AdminPageHeader` (h1 = "Environment", one-sentence purpose, the neutral "Read-only" badge), the Refresh-only `AdminFilterBar` with "Read at", `AdminLoading` / `AdminError` (Try again), the response read through `readAdminResponse` with `sessionEndedCopy: true`, the standard card shell, an always-mounted `aria-busy` content area, and an entry in the migrated-pages registry | §2.3, T2-7 |
| FR-12 | An environment card under the header: the environment chip, the deployment facts, and the standing notes C-1 (redeploy), C-2 (`NEXT_PUBLIC_*` built into the bundle) and C-5 (local merged files) in plain words | §2.3.2 |
| FR-13 | One card per group in the payload's group order (which includes `external`, SA Q-3), each with its description and a standard table: Name, Value, Role, Scope. Status is never colour alone: Set, Not set, On, Off are words; chips use `StatusChip` | §2.3.3 |
| FR-14 | Masked rows show Set or Not set. Nothing offers to reveal, copy or download a value | §2.3.4, P2-11 |
| FR-15 | The Uncategorised card always shows, with "None" when empty; the platform count line sits under it | §2.3.5 |
| FR-16 | A failed refresh clears the tables and "Read at" (the L-12 rule) | §2.3.1, P2-5 |
| OQ-1 | The only change allowed in `AdminSidebar.tsx` and `AdminSidebar.nav.test.ts` is one item appended to Settings (and the counts that follow from it). SA reviews that diff explicitly | §2.4 |
| OQ-10 | A `personal` list row shows its count. The `ADMIN_EMAILS` row (the only entry with `seeAlsoPath`) also links to Admin users | §2.3.4 |
| SA-C11 | The page imports only `lib/admin/environment-types.ts` from the feature, as `import type`. No `'use client'` file anywhere imports `lib/admin/environment/`. Role sentences reach the browser only through the response. A source test pins both | §2.7 G2-1, G2-2 |
| SA-C14 | No real value and no screenshot from a real deployment in this workplan, the QA report, the PR or any test. Render-test fixtures are fake | Whole slice |
| SA note (workplan review) | The client must not add a cache-busting query parameter: the route answers 400 to any parameter (SA-C9). Freshness comes from the route's `no-store` and `cache: 'no-store'` on the fetch | §2.3.1, P2-12 |

### 2.2 Analysis summary

| Area | What EC-2 touches |
|---|---|
| New page | `app/admin/environment/page.tsx` (`'use client'`) and page-local view files under `app/admin/environment/` |
| Sidebar | `app/admin/components/AdminSidebar.tsx`: one item appended to Settings, plus one `lucide-react` icon in the existing import |
| Pins | `AdminSidebar.nav.test.ts` (Settings list and total), `layoutFolder.guard.test.ts` (migrated-pages registry entry) |
| Shared layout components | Used as they are: `AdminPageHeader`, `AdminFilterBar`, `AdminLoading`, `AdminError`, `StatusChip`, `readAdminResponse`, `ADMIN_NETWORK_ERROR`, `formatUtc`, the `adminTable.ts` class constants. **No new shared export and no change to the shared folder** |
| Server | None. The route, catalogue and classifier are EC-1's and do not change. If EC-2 finds it needs a response field, that is a route change and goes back to the full cycle |
| Database, LLM, entitlements | None |
| Logging | `clientLogger.child({ module: 'AdminEnvironmentPage' })`, HTTP status only, never a body (the L-12 precedent) |

### 2.3 Page design

#### 2.3.1 Read and states (copied from the Admin users page, L-12)

- One request: `fetch('/api/admin/environment', { method: 'GET', cache: 'no-store' })`, no query string, on mount and on Refresh. A request counter (`latestRequest`) drops a late answer, as Admin users does.
- The body goes through `readAdminResponse<EnvironmentViewPayload>(response, { what: 'the environment settings', sessionEndedCopy: true })`. The page accepts the data only if a small type guard confirms its shape (`environment.label` is one of the five labels, `groups` and `uncategorised` are arrays, `counts` is an object). Otherwise it shows the shared fallback sentence, as Admin users' `UNUSABLE` does.
- **A failed read clears everything** (FR-16): the environment card, every group card, Uncategorised, the count line and "Read at" go. Only the header, the bar and `AdminError` with Try again remain, so no configuration stays on screen looking current.
- The content area is always mounted, with `aria-busy` while reading, so a refresh keeps the last good tables on screen until it ends. The first read shows `AdminLoading`.

#### 2.3.2 Environment card (FR-12)

| Element | Rendering |
|---|---|
| Environment chip | `StatusChip`: `production` → "Production", `preview` → "Preview", `vercel-development` → "Vercel development", `local` → "Local (merged .env files)", all tone `info`; `unknown` → "Unknown environment", tone `warn` (amber with its icon and words, requirement §3.1). See Q2-1 |
| Deployment facts | A short definition list: Host, Region, Branch, Commit. Each shows the payload's fact text, or "Not provided" when it is null. The route has already filtered the facts |
| Standing notes | Neutral text. (C-1) "Shows this deployment's settings. A change made in Vercel appears here after the next deploy." (C-2) "Settings whose name starts with NEXT_PUBLIC_ are built into the browser code when the app is built; this page shows the server's copy." (C-5, only when the label is `local`) "On a developer machine the values are the merged result of the .env files; the page cannot say which file a value came from." |

#### 2.3.3 Group cards (FR-13)

- One `<section>` card per entry of `data.groups`, in the order the payload gives (the catalogue's order; `external` sits after Plugins & OAuth). The card title is the group's `label` (h2), followed by its `description`.
- A group with no rows cannot occur today (every group has entries); if it does, the card shows "None".
- The table uses the `adminTable.ts` constants (`ADMIN_TABLE_WRAP`, `ADMIN_TABLE`, `ADMIN_THEAD`, `ADMIN_TH`, `ADMIN_TBODY`, `ADMIN_TD`), with named column headers Name, Value, Role, Scope. Names are monospace. No row opener, no drawer, no sorting (the payload is already ordered).
- Scope column: `server` → "Server"; `browser-inlined` → "Built into the browser bundle".

#### 2.3.4 Value column: one rendering per display kind

A pure, page-local function `describeDisplay(row)` returns words and a tone. The cell renders a `StatusChip`, or plain monospace text for `shown`. Always words, never colour alone.

| `display` | Shown as |
|---|---|
| `shown` | The text, monospace, as received (already filtered on the server) |
| `status`, set | Chip "Set", tone `neutral` |
| `status`, not set | Chip "Not set", tone `unknown`. EC-4 adds the amber "Required, not set" |
| `flag`, source `set` | Chip "On" (tone `info`) or "Off" (tone `neutral`) |
| `flag`, source `default` | As above, followed by "(default)" in plain text |
| `flag`, source `unrecognised` | The On / Off chip by state, followed by "Set, not a recognised value: reads as Off" (or "On"). See Q2-2 |
| `count` | "1 entry" / "N entries", plain text. If the row has `seeAlsoPath`, a `next/link` "See Admin users" to that path (only `ADMIN_EMAILS` today, OQ-10) |
| `hidden`, `not-plain-config` | Chip "Set" (tone `neutral`) plus "Hidden: does not look like plain configuration" |
| `hidden`, `classification-error` | Chip "Set" plus "Hidden: could not be checked" |

The page builds text only from these fields. There is no copy, reveal or download control anywhere (FR-14).

#### 2.3.5 Uncategorised card and count line (FR-15)

- Always rendered after the group cards, titled "Uncategorised", with the description "Present in this deployment's environment but not described in the catalogue. Values are never shown." Rows use the same table. An empty list shows "None".
- Under it, the count line (`ADMIN_COUNT_LINE`): "N settings set by the hosting platform or operating system are not shown." It uses the singular for 1, and is shown at 0 too ("No settings…"), so "none" cannot be confused with "not checked".

#### 2.3.6 Header copy

`AdminPageHeader`: title "Environment" (= the sidebar label), purpose "How this deployment is configured: every setting the app reads, with secrets shown only as Set or Not set.", badge `{ label: 'Read-only', testId: 'read-only-badge' }`. No `actions`: Refresh lives in the bar.

### 2.4 Sidebar entry (OQ-1, SA reviews this diff)

**File:** `app/admin/components/AdminSidebar.tsx`

```typescript
      {
        name: 'Admin users',
        href: '/admin/settings',
        icon: Settings,
        description: 'People who can sign in to admin'
      },
      {
        // Admin environment view EC-2 (FR-9, SA OQ-1): appended, nothing else moves.
        name: 'Environment',
        href: '/admin/environment',
        icon: SlidersHorizontal,
        description: 'How this deployment is configured, read-only'
      },
```

Plus `SlidersHorizontal` added to the existing `lucide-react` import list. No other line in the file changes.

**File:** `app/admin/components/__tests__/AdminSidebar.nav.test.ts`: `hrefsOf('Settings')` gains `'/admin/environment'` last, and the listed-pages total goes 27 → 28 with a dated comment line in the file's own style. The on-disk floor (`>= 28`) needs no change. Nothing else in the test changes.

### 2.5 Files to create / modify

| # | File | Action | Reason |
|---|---|---|---|
| F2-1 | `app/admin/environment/page.tsx` | create | The page: read, states, layout (§2.3.1, §2.3.6) |
| F2-2 | `app/admin/environment/components/EnvironmentView.tsx` | create | Environment card, group cards, Uncategorised card, count line (§2.3.2 to §2.3.5); props are the payload |
| F2-3 | `app/admin/environment/environmentDisplay.ts` | create | Pure word mapping: labels, chip tones, `describeDisplay`, scope words, count wording. Type-only import from `lib/admin/environment-types.ts` |
| F2-4 | `app/admin/environment/__tests__/page.render.test.tsx` | create | P2-1 to P2-14 |
| F2-5 | `app/admin/environment/__tests__/environmentDisplay.test.ts` | create | D2-1 to D2-4 |
| F2-6 | `app/admin/environment/__tests__/clientBoundary.guard.test.ts` | create | G2-1, G2-2 (SA-C11) |
| F2-7 | `app/admin/components/AdminSidebar.tsx` | modify | One item appended to Settings (§2.4) |
| F2-8 | `app/admin/components/__tests__/AdminSidebar.nav.test.ts` | modify | Settings list and total (§2.4) |
| F2-9 | `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` | modify | Migrated-pages registry entry `'/admin/environment (Environment)'` listing F2-1, F2-2 and F2-3, with an L-12-style comment (header with the Read-only badge, the Refresh-only bar, shared states, `readAdminResponse`; no strip, no filters, no drawer, no dialog) |
| F2-10 | `docs/requirements/ADMIN_ENVIRONMENT_CONFIGURATION_VIEW_REQUIREMENT.md` | modify | Progress row 2 at each stage |
| F2-11 | this workplan | modify | Ticks and notes |

All page files live under `app/admin/environment/`; nothing is added to `app/admin/components/layout/`.

### 2.6 Task list

- ✅ T2-1: SA reviews this section; rulings recorded in §5 (E2-1 to E2-4)
- ✅ T2-2: Built on this branch on top of EC-1 (one PR for both slices, SA 2026-10-27); no merge wait
- ✅ T2-3: `environmentDisplay.ts` and its unit test (F2-3, F2-5; E2-1, E2-2)
- ✅ T2-4: `EnvironmentView.tsx` (F2-2)
- ✅ T2-5: `page.tsx` (F2-1)
- ✅ T2-6: Sidebar item and nav pin test (F2-7, F2-8)
- ✅ T2-7: Migrated-pages registry entry (F2-9)
- ✅ T2-8: Render tests and the client-boundary guard (F2-4, F2-6; E2-3, E2-4)
- ✅ T2-9: Gates (results in §2.9)
- ⬜ T2-10: Requirement Progress row 2 (not edited: this round's instruction limited edits to the EC-2 files and §2; left for the coordinator or BA); hand to SA + QA (the gate; the user waived the diff review)

### 2.7 Test plan

All fixtures are hand-written payloads with fake names and values (for example a `shown` text `example.test`); no test calls the real route. `fetch` is mocked, and `@/lib/logger/client` is mocked as on Admin users.

**Render tests (`page.render.test.tsx`).** P2-1 to P2-5 are the guardrails listed for EC-2 in requirement §7.

| # | Case | Expect |
|---|---|---|
| P2-1 | Header | One h1 "Environment", the purpose sentence, the neutral "Read-only" badge, no button in the header; Refresh "Refresh the environment settings" in the bar with "Read at" in UTC |
| P2-2 | Environment chip, each label (5 cases) | "Production", "Preview", "Vercel development", "Local (merged .env files)", "Unknown environment"; `data-tone` `info` for the first four and `warn` for unknown; the C-5 note only for `local` |
| P2-3 | Masked rows | A set `status` row reads "Set", an unset one "Not set"; neither renders any other text in the Value cell |
| P2-4 | Uncategorised always shown | With an empty `uncategorised` the card is there and says "None"; with two rows both names are listed with Set / Not set |
| P2-5 | Failed refresh clears | Good load, then Refresh answers 500: the environment card, every group table, Uncategorised, the count line and "Read at" are gone; `AdminError` with Try again is shown; Try again recovers |
| P2-6 | Group order | Cards appear in the payload's order, including an `external` card between Plugins & OAuth and Payments; each shows its label and description and the four named column headers |
| P2-7 | Count line | "12 settings set by the hosting platform or operating system are not shown."; singular for 1; the 0 wording |
| P2-8 | Standing notes and scope | The redeploy sentence (C-1) and the browser-bundle sentence (C-2) on every label; a `browser-inlined` row reads "Built into the browser bundle" in Scope, a `server` row "Server" |
| P2-9 | Flags | On / Off chips; "(default)" for a default; the unrecognised words; no other text |
| P2-10 | Personal | A `count` row reads "3 entries" ("1 entry" for one); the row with `seeAlsoPath` has a link "See Admin users" to `/admin/settings`; a row without it has no link |
| P2-11 | Read-only invariant | In ready, loading and error states the only buttons are Refresh and (on error) Try again; no input, and no copy, reveal or download control |
| P2-12 | Request invariant | Every request is exactly `GET /api/admin/environment`, no query string, `cache: 'no-store'`, across mount, Refresh and Try again |
| P2-13 | Malformed 200, non-JSON body, 401 | The first two show the shared fallback words (the Admin users S-5 precedent); a 401 shows the session-ended words |
| P2-14 | Late answer | A slow first response that arrives after a newer one does not overwrite it |

**Unit test (`environmentDisplay.test.ts`).** D2-1: every `EnvironmentLabel` maps to non-empty words and a tone. D2-2: every `EnvDisplay` kind and reason maps to non-empty words, through a `switch` with an exhaustive `never` check, so a new kind fails to compile. D2-3: count wording, singular and plural. D2-4: no mapping returns text taken from anything except the display's own `text` field.

**Source guard (`clientBoundary.guard.test.ts`, SA-C11).** G2-1: the page's files import from `@/lib/admin/` only `environment-types`, and only as `import type`. G2-2: no file under `app/`, `components/` or `hooks/` that starts with `'use client'` imports anything under `lib/admin/environment/` (comment-stripped, CRLF-safe scan).

**Existing pins updated.** `AdminSidebar.nav.test.ts` (Settings list, total 28) and `layoutFolder.guard.test.ts` (the registry entry, which then checks the shared header import, no own `<h1`, no direct `.json(`, and alias-only imports of the shared folder).

**QA (manual, SA-C14).** On a real deployment: the page opens from the sidebar, the chip names the right environment, and every masked class shows Set / Not set. Recorded as pass or fail per class, with no value quoted and no screenshot.

### 2.8 Questions for SA

| # | Question | Dev's recommendation |
|---|---|---|
| Q2-1 | **Chip tones.** The header's one neutral badge is taken by "Read-only", so the environment chip goes in the environment card as a `StatusChip`. Which tones? | `info` for the four known labels, `warn` for "Unknown environment" (requirement §3.1 says amber). "Not set" uses `unknown` (dashed grey), so it is not read as a warning before EC-4 decides which ones are amber |
| Q2-2 | **Unrecognised flag words now or in EC-4?** FR-19 is listed under EC-4, but EC-1 already ships `source: 'unrecognised'`. A bare "Off" now would hide that the setting holds something the code ignores | Show the FR-19 words in EC-2 as plain text, with no amber; EC-4 adds only the emphasis |
| Q2-3 | **Hidden rows show "Set".** A `hidden` display only ever occurs for a value that is set (EC-1 rule). Showing "Set" beside the reason tells the admin the setting exists | Accept |
| Q2-4 | **Personal link scope.** OQ-10 rules the link for `ADMIN_EMAILS`. The page links any row that carries `seeAlsoPath`, and today only `ADMIN_EMAILS` does | Accept: the catalogue owns which rows link; the page does not hard-code the name |

### 2.9 Implementation notes

**Files.** Created: `app/admin/environment/page.tsx`, `app/admin/environment/components/EnvironmentView.tsx`, `app/admin/environment/environmentDisplay.ts`, and tests `app/admin/environment/__tests__/{page.render.test.tsx,environmentDisplay.test.ts,clientBoundary.guard.test.ts}`. Modified: `app/admin/components/AdminSidebar.tsx` (one item appended to Settings plus `SlidersHorizontal` in the existing `lucide-react` import; nothing else), `app/admin/components/__tests__/AdminSidebar.nav.test.ts` (Settings list gains `/admin/environment` last; total 27 → 28 with a dated line), `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` (registry entry `/admin/environment (Environment)` with the three page files). No EC-1 file and nothing under `app/admin/components/layout/` changed.

| Change | Where |
|---|---|
| E2-1 | `describeDisplay`: `classification-error` → note "Hidden: could not be checked", no chip; `not-plain-config` keeps the Set chip. D2-2 and P2-3 pin both |
| E2-2 | `SEE_ALSO_LINKS` allow-list (`'/admin/settings'` → "See Admin users"), looked up with `hasOwnProperty` so `__proto__` or `constructor` cannot match. Unmapped paths render no link. The E2-2 unit case and P2-10 (`/admin/elsewhere` gets no link) pin both |
| E2-3 | `clientBoundary.guard.test.ts`: the directive check strips a BOM and comments first and accepts either quote; the import scan covers `import`/`export … from` (noting `import type`), side-effect imports, dynamic `import()` and `require()`, resolved through the alias or a relative path. G2-1 holds every non-test file in the page folder to a type-only import of `environment-types` and nothing else from `lib/admin/`. Negative controls exercise each case (BOM, leading comments, double quotes, CRLF, relative, dynamic, `require`, non-type import, re-export, commented-out import) |
| E2-4 | Same guard: no `dangerouslySetInnerHTML` in any file of the page folder |
| Q2-2 | The unrecognised words follow `display.state` ("reads as On" for a default-on flag), never a literal; D2-2 and P2-9 pin it |

**Deviations.**
1. The shape-guard fallback uses the shared `adminReadFallback(WHAT)` instead of a page literal (Admin users kept a literal plus a test that the two match). Same words, one home.
2. P2-14 (late answer) uses `StrictMode`'s double mount to start two reads, because the Refresh button is disabled while a read is in flight, so a second click cannot race the first.
3. The 0 count line reads "No settings set by the hosting platform or operating system were left out." (§2.3.5 said only "No settings…").
4. T2-10's requirement Progress row was not edited (see the task list).

**After SA's EC-2 code approval (2026-10-27).** One optional SA hardening applied: `isEnvironmentViewPayload` also requires `counts.platformHidden` to be a number, since the count line renders it; pinned by two cases in `environmentDisplay.test.ts`. The EC-1 QA fixes QF-1 to QF-3 are recorded in §1.11.

**QA EC-2 notes (§6.2), fixed 2026-10-27.** All in `app/admin/environment/`.

| Note | Change | Test |
|---|---|---|
| 1 (Low) malformed row crashed the page | `isEnvironmentViewPayload` now validates deeply: every group (string `id`, `label`, `description`, `rows` an array of valid rows); every row in groups and Uncategorised (string `name` and `role`, `scope` one of the two values, `seeAlsoPath` absent or a string, and a valid `display`); each display kind's field types (`shown.text` string, `status.set` boolean, `flag.state`/`source` from their closed sets, `count.entries` a finite number ≥ 0, `hidden.reason` a string; any other kind fails); the four facts each a string or null; `counts.platformHidden` a finite number ≥ 0. An invalid payload takes the existing `adminReadFallback` error state | Render: rows not an array, display null, `shown.text` an object, a fact that is an object. Each shows the fallback words with Try again, no card, and the fake nested text appears nowhere. Unit: 17 invalid shapes refused |
| 2 (Low) unknown display kinds | `describeDisplay`'s default branch returns the fixed "Hidden: could not be checked" (one constant, shared with the `hidden` branch) and reads no field of the object; the compile-time `never` check stays | Unit: an unknown kind carrying `text`/`note` fields, and an unknown `hidden` reason, both give exactly the fixed words |
| 3 (Cosmetic) long names | Name cell `break-all` (monospace, as the audit trail and call-details code do); value cell `break-words` (its monospace text already had `break-all`; the notes wrap at words so they do not split mid-word); role cell `break-words` (prose, as the other admin tables' prose cells do) | Render: the classes are present on the name cell, the shown text and the value cell |

Gates: the `app/admin/environment`, `lib/admin/environment` and `app/api/admin/environment` suites, 7 suites, **132 tests pass** (EC-2: render 26, display 8, client boundary 6; EC-1: 92), 19 s. `eslint` and the hooks lint on `app/admin/environment`: clean.

### 2.10 Gate results (local, Windows, 2026-10-27)

| Gate | Result |
|---|---|
| New suites (`app/admin/environment`) | 3 suites, 33 tests pass: render 21, display 6, client boundary 6 |
| `AdminSidebar.nav.test.ts` + `layoutFolder.guard.test.ts` | 2 suites, 470 tests pass |
| `npm run test:authz-guard` | 2 suites, 203 tests pass, 45 s wall (rule R8 accepts the new `'use client'` page) |
| `eslint` on touched files | Clean (0 errors, 0 warnings) |
| Hooks lint (`--max-warnings 0`) on the page folder and the sidebar | Clean |
| `npx tsc --noEmit` (8 GB heap), filtered to touched files | Completed, no OOM; exit 2 with 1,852 diagnostics, the same pre-existing count as the EC-1 run; **0** in any EC-1 or EC-2 file. 2 min wall |

- ✅ Workplan section written (2026-10-27)
- ✅ Implementation (2026-10-27)
- ⬜ SA + QA

---

## 3. EC-3: catalogue drift guard (stub)

Filled when EC-3 starts. Carries R-3 to R-5, OQ-9 (one Jest file in the existing sharded gate, at most 5 s, no new job or script), SA-C13, and the answer to Q-2. Inputs from EC-1: the inventory method in §1.3 and its local timing.

- ⬜ Workplan section written
- ⬜ Implementation, negative controls, CI timing measured by QA

---

## 4. EC-4: diagnostics (stub)

Filled when EC-4 starts. Carries FR-17 to FR-21. Reads `expectedIn`, which EC-1 ships (OQ-7). An `unknown` environment label shows no diagnostics.

- ⬜ Workplan section written
- ⬜ Implementation

---

## 5. SA Review Notes

**Reviewed by SA, 2026-10-26 (EC-1 workplan)**
**Status:** ✅ Approved with changes. Dev applies the changes listed under "Required changes" (RC-1 to RC-8) and then implements. No second workplan review is needed; SA checks each item at code review.

### Rulings on §1.9

| # | Ruling |
|---|---|
| Q-1 | **Accepted.** `flagParser: 'lenient' \| 'strict-true'` per entry, with K-5 asserting the classifier's `state` against each real reader for the listed inputs. Add to K-4: every `strict-true` entry has `flagDefault: false` (an `=== 'true'` reader cannot default on). `NEXT_PUBLIC_USE_AI_DATA_LAYER` is catalogued `lenient` (the shared reader), its role sentence says one route reads it strictly, and the route fix stays with its owner (X-5). |
| Q-2 | **EC-3 scans the plugin JSON trees and resolves same-file constants; the `consumedBy` enum stays closed** (`sdk`, `platform`, `environment-page`). A `${NAME}` placeholder or `"…EnvVar": "NAME"` field is a read for the guard, and `const X = 'NAME'` + `process.env[X]` in the same file is resolved. A constant exported and read from another file (`MODE_ENV_VAR`) is resolved by following that one import, or, if that costs too much of the 5 s budget, EC-3's workplan brings the residue to SA; it does not widen the enum on its own. EC-1 ships `consumedBy` on the 5 sdk/page entries only. |
| Q-3 | **Accepted.** New group id `external`, label "Other external services", placed directly after Plugins & OAuth, with a one-line description ("Outside services the app calls that are not connected-app plugins"). It is a deviation from requirement §3.4; record it in the requirement Progress row so BA folds it into §3.4 with the other rulings. |
| Q-4 | **Accepted.** `NANGO_SECRET_KEY` scope `browser-inlined` (SA-C12 reasoning; the marker states the build path, it does not claim a bundle contains the value). K-3 pins both Nango names. |
| Q-5 | **Accepted.** Keep the three `AWS_*` names catalogued (precedence beats the `AWS_` deny prefix); each role sentence carries the caveat that on Vercel the runtime may set the name itself, so Set does not prove the extraction credential is configured. `AWS_SESSION_TOKEN` stays uncatalogued and is counted as platform noise. |
| Q-6 | **Accepted.** `entityType: 'system'`, `entityId: null` (precedent: boost reconcile and entitlements launch routes). Owner visibility of the admin's own view rows is harmless: label and counts only. |
| Q-7 | **Accepted, scoped.** Log errors as `{ errorClass }` in this route and in the audit `.catch`, with a comment citing SA-C6 at the first use. The deviation covers this feature's files only; it is not a new house pattern. RC-5 pins it in source. |
| Q-8 | **Accepted.** OAuth and Connect client IDs are `config` and shown to admins, subject to the shape gates. SA-C14 keeps them out of every evidence artefact. |
| Q-9 | **Not engaged, confirmed.** The skill's tripwires are an import from `lib/business-os/entitlements/**` (type-only included), a capability-id literal, or a tier-name literal. The variable name as a string and the mode words `off` / `shadow` / `enforce` are none of these (`TIER_ORDER` is `basic`, `pro`). Two conditions: (a) no role sentence or group description may contain a quoted tier name or a capability id (the `tierLiteral.forbidden` guard matches a quoted tier word in any string); (b) keep `npm run test:bos-entitlements` in T-16 as planned, and if any file in the diff gains an import from the module, the skill applies in full. Note the reader lowercases and trims, so the `enum` case-insensitive match agrees with it; an out-of-set value is hidden, which is correct (the reader treats it as off). |
| Q-10 | **Accepted with one change.** `STRIPE_WEBHOOK_SECRET` becomes **R/O/O**: a preview has no stable webhook endpoint, so "required" there would be a standing false amber. All other R and X cells stand. `BOOKING_TOKEN_SECRET` stays R in production even though its readers fall back to `NEXTAUTH_SECRET`: its role sentence says so, so an amber there reads as "the canonical name is missing", not "links are broken". |

### Review of the whole plan

| Area | Finding | Status |
|---|---|---|
| Masking fails closed (SA-C1 to C5) | Order of gates is right: name pattern before class, shape gates before display, unknown class or shape throws into the row catch and masks, uncatalogued is status-only, `hidden` only for set values. URL origin plus the 40-run rule on both the raw value and the origin is stricter than SA-C4 asked; fine. Two holes, RC-1 and RC-2. | RC-1, RC-2 |
| SA-C7 gate | Real route, real classifier, real catalogue, three sinks, 8-character windows, a pre-check that fixtures do not collide with catalogue text, and the rejecting-audit run. Strong, but four gaps: case folding, child-logger bindings, the deny-list path, and the route-level error paths with a secret in an error message. | RC-3 |
| Route exports (OQ-2) | Matches the billing precedent exactly; R-5 pins exports and methods CRLF-safe; `noStore(gate)` covers 401/403. | OK |
| Zod strict query (SA-C9) | `z.object({}).strict()` over `Object.fromEntries(searchParams)` refuses any key, including a bare `?=`. Parsed after the gate, so a non-admin learns nothing from a 400. EC-2's client must not add a cache-busting parameter (note for EC-2). | OK |
| Access register + authz guard (SA-C10) | The guard's gated-handler checks are floors and the caps are on exemptions, so no edit is expected; T-14 records the run. The two `const` lines before `requireAdmin` do no I/O and match accepted routes. Row number: see RC-7. | RC-7 |
| File layout (OQ-5) | Matches the ruling. `server-only` is mapped in `jest.config.js`, so classifier tests import it directly. | OK |
| Test plan | Happy path (R-1), non-admin (R-2), invalid input (R-3), server failure (R-4), audit failure (R-9). Meets CLAUDE.md coverage. | OK |
| CLAUDE.md rules | Rule 1 not engaged (no DB access beyond the audit row, FR-8). Rule 2 SA-C9. Rule 3 Pino with `correlationId`; no touched file uses `console.*`. Rule 5/LLM not engaged. Rule 6: the entry type is a discriminated union, no `any`. Rule 7: this review. Audit non-blocking with `.catch`; no WC-7 flush needed for a read. Admin gate is `requireAdmin`. | OK |
| Public-repo hygiene | No value, partial value or project reference found. SA removed two pointers that tied rows to a moved private finding: the "see §1.10" note on the `NEXT_PUBLIC_SLACK_CLIENT_SECRET` row and the remark in Q-4; Q-4 now states only the scope question. | Done by SA |

### Required changes (Dev, before or during implementation)

1. **RC-1 Deny-list must not swallow app names.** The `NEXT_` prefix currently also hides an uncatalogued `NEXT_PUBLIC_*` name, which is always app-defined and is exactly what Uncategorised exists to surface. Exclude `NEXT_PUBLIC_` from the `NEXT_` prefix match (an uncatalogued `NEXT_PUBLIC_*` lands in Uncategorised, masked). Add a classifier case beside C-21.
2. **RC-2 `identifier` shape drops `@`.** As written it admits an address, so an account name wrongly catalogued as `config` would be shown. Remove `@` from the `identifier` character set; if any catalogued `identifier` entry needs it, that entry is `personal` (SA-C12). Add a C-12 negative case (an address-shaped value under an `identifier` entry is hidden).
3. **RC-3 Strengthen the SA-C7 gate (F-7):**
   - (a) compare case-insensitively (lowercase both the sink text and each fixture window), so a transform such as URL host lowercasing cannot hide a leak from the check;
   - (b) the recording logger mock records `child()` bindings at every depth, not only the level methods, and a `console.*` spy asserts no fixture window reaches the console;
   - (c) add **S-5**: deny-listed names carrying fake secrets (`AWS_SESSION_TOKEN`, a lowercase OS-style name): absent from all three sinks, value and name;
   - (d) add **S-6**, through the real route: a row error whose message carries a fixture secret (for example `parseAdminEmails` spied to throw), and a whole-classifier throw carrying a fixture secret, both run with `NODE_ENV=development`: the body's `details` equals the fixed code, and no fixture window appears in any sink.
4. **RC-4 K-4 addition:** every `strict-true` flag has `flagDefault: false` (Q-1).
5. **RC-5 Source pin R-10** (route and classifier files): no `err.message`, no `{ err }` / `{ err:` logger argument, no spread of `process.env` or of the `env` argument, and the route passes `process.env` to nothing but `classifyEnvironment`. CRLF-safe parse.
6. **RC-6 Catalogue edits:** add the `external` group (Q-3) to `EnvGroupId`, `ENVIRONMENT_GROUP_ORDER` and the descriptions; `STRIPE_WEBHOOK_SECRET` `expectedIn` R/O/O (Q-10); AWS role caveat (Q-5); AI data layer role note (Q-1); `BOOKING_TOKEN_SECRET` role names its fallback (Q-10). No tier name or capability id in any role text (Q-9).
7. **RC-7 Register row number:** take the next free row number in `ADMIN_IDENTIFICATION_AND_ACCESS.md` at commit time, after syncing with `main` (119 today; other streams add rows). Do not hard-code 119 in tests or comments.
8. **RC-8 Requirement Progress row:** record Q-3 (new group) and the Q-10 change for BA to fold into §3.4 and §5, per the standing always-update-the-requirement preference.

### Optimisation suggestions (not blocking)

- Put the `correlationId` in the audit row's `entityId` instead of `null`, so a view row can be joined to its log lines without reading `details`.
- The `NODE_` prefix hides `NODE_OPTIONS` and `NODE_TLS_REJECT_UNAUTHORIZED`, which an admin may want to know are set. Hiding is safe, so not required; consider cataloguing `NODE_TLS_REJECT_UNAUTHORIZED` as a `config` enum (`0`, `1`) with `expectedIn` X/X/O in EC-4.
- `region` accepts any lowercase word up to 39 characters; consider anchoring it to the known region formats only (`^[a-z]{3}\d$` and `^[a-z]{2}-[a-z]+-\d$`).

### Approval

[x] Workplan approved with changes: proceed to implementation applying RC-1 to RC-8. SA verifies each at code review.

---

**Code Review by SA, 2026-10-27 (EC-1)**
**Status:** 🔄 Approved with changes. Three small fixes (CR-1 to CR-3), then QA. No second SA pass is needed: QA confirms each fix has its test, and SA spot-checks the diff before the RM commits.

SA re-ran the new suites in the worktree: 5 suites, 109 tests, all pass (9.1 s). Read in full: the four new modules, the route, the four test files, and the tracked diffs to `lib/audit/events.ts`, `lib/audit/eventAudience.ts`, its test, and the access register.

### Required changes from the workplan review (RC-1 to RC-8)

| RC | Verdict | Evidence |
|---|---|---|
| RC-1 | ✅ | `PLATFORM_NOISE_PREFIX_EXCEPTIONS` is checked before both the exact names and the prefixes; C-21b pins it |
| RC-2 | ✅ | `IDENTIFIER` has no `@`; C-12 has the address case |
| RC-3 | ✅ with one gap (CR-1) | (a) case-insensitive windows plus an upper-case negative control; (b) `createLogger` and `child()` bindings recorded at every depth, and `console.*` is a fourth sink; (c) S-5 checks deny-listed names and their values; (d) S-6a and S-6b run in development, `details` is the fixed code |
| RC-4 | ✅ | K-4 |
| RC-5 | ✅ | R-10 runs over the route and the classifier with comments stripped; exactly two uses of `process.env` |
| RC-6 | ✅ | `external` group, `STRIPE_WEBHOOK_SECRET` R/O/O, the AWS caveat on all three names, the AI data layer note, the `BOOKING_TOKEN_SECRET` fallback; no quoted tier name or capability id (K-1 also bans underscores in role text) |
| RC-7 | ✅ | Row 119, with a note that the RM re-checks the number at commit; no test or code names the number |
| RC-8 | ✅ | Requirement Progress row 1 lists (a) to (c) for BA to fold in |

The Q-1 to Q-10 rulings landed as ruled: strict and lenient parsers are tested against every real reader, `consumedBy` sits on exactly 5 entries, the Nango scope, the `'system'` entity, `{ errorClass }` logging scoped and commented, client IDs shown, no import from the entitlements module, and the `expectedIn` values.

### Rulings on Dev's deviations (§1.11)

| # | Ruling |
|---|---|
| 1 JWT rule | **Accepted with CR-2.** The rule still fails closed for standard JWTs: every JOSE header is a JSON object, so its compact form opens with `eyJ`. Lifting the plain three-segment floor to 10 characters only matters for non-JWT dotted tokens with a short segment, and those still meet the 40-character run rule and the shape checks. Hole: `JWT_OPENING` is anchored to the start of the value or a dot, so a JWT after `:` or `/` (both legal in `identifier`), for example `prefix:eyJ…`, escapes it, and the run rule misses it when the base64url segments contain `-` or `_`. Fix in CR-2. |
| 2 Trim | **Accepted.** The trimmed text still goes through every check, and internal whitespace still hides. Not a leak path. (Suggestion for EC-4: flag a value that has surrounding whitespace, because a reader that does not trim will see a different value from the one shown.) |
| 3 Build | **Accepted as sequencing.** `npm run build` plus the touched-file typecheck is ship-drill step 1, and the RM runs it before committing. It is a condition of commit, not optional. |
| 4 Audience pin | **Accepted.** The edit follows the file's convention (a dated "+1 shared" line). On syncing with `main`, the RM must re-add this +1 to whatever split `main` has by then rather than take either side of a conflict wholesale. This file has caused a semantic merge conflict before. |
| 5 `entityId` null | **Accepted.** It was an optional suggestion, and Dev's reason (a caller-supplied header is not guaranteed to be a UUID; the column type was not checked) is sound. |
| 6 Deny-list tuned from a dev machine | **Accepted with CR-3.** No entry identifies this machine, its user or the project. The vendor and driver names (`ACSVCPORT`, `ZES_ENABLE_SYSMAN`, `EFC_`, `FPS_BROWSER_`) are generic OS or tooling names. RC-1 holds. But four prefixes are broader than the tool namespace they target, so they would hide an app-defined name from Uncategorised: `CLAUDE` (a future `CLAUDE_*` model setting is plausible, since the app has an Anthropic provider), `ONEDRIVE` (a OneDrive plugin credential is plausible), `PYTHON` (an app `PYTHON_*` service setting), and `PROGRAM`. Fix in CR-3. |
| 7 Register row and census | **Accepted.** Row 119 is correct today. **Follow-up for the TL (not this slice):** six admin route files landed on `main` without register rows (`business-os/billing/accounts/[accountId]`, `business-os/billing/plans/[planId]`, `business-os/billing/subscriptions`, `exchange-rates`, `exchange-rates/sync`, `exchange-rates/[currencyCode]`). A census pass should register them and re-count. All are gated; the gap is in the docs only. |

### Code Review Comments

1. `lib/admin/environment/__tests__/serialisation.test.ts:224-228` — **CR-1.** The sinks are serialised with `JSON.stringify`, which writes an `Error` as `{}` and drops `Map` and `Set` contents. A future `logger.error({ err }, …)` anywhere on the request path (the gate, the audit `.catch`, a helper the classifier imports) would therefore carry the secret in `err.message` past this gate, and Pino would then write it. R-10 only pins the route and classifier source. Serialise each sink with a function that expands errors (name, message, stack, `cause`) and collections, for example `util.inspect(value, { depth: null })`. Add a negative control showing that a logger record `{ err: new Error(fixture) }` is detected. — Priority: **High** (it is the acceptance gate, and the fix is a few lines)
2. `lib/admin/environment/classifyEnvironment.ts:90` — **CR-2.** Unanchor the opening check, `/eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+/`, so it matches anywhere in the value. Add C-5 cases: `prefix:eyJfakeHeader.fakePayload_with-dash.sig` and `path/eyJfake.x` are hidden, and `deploy-x.example.test` is still shown. — Priority: Medium
3. `lib/admin/environment/platformDenyList.ts:43,47,48,53` — **CR-3.** Narrow these four prefixes to the tools' own names, either as exact names or as the tightest prefix:
   - `CLAUDE` → `CLAUDECODE` plus the prefix `CLAUDE_CODE_`;
   - `ONEDRIVE` → exact `ONEDRIVE`, `ONEDRIVECONSUMER`, `ONEDRIVECOMMERCIAL`;
   - `PYTHON` → Python's documented `PYTHON…` names with no underscore after `PYTHON`, as a small exact list;
   - `PROGRAM` / `COMMONPROGRAM` → exact `PROGRAMFILES`, `PROGRAMFILES(X86)`, `PROGRAMDATA`, `PROGRAMW6432`, `COMMONPROGRAMFILES`, `COMMONPROGRAMFILES(X86)`, `COMMONPROGRAMW6432`.

   Add a C-21c case: `CLAUDE_MODEL`, `ONEDRIVE_CLIENT_ID`, `PYTHON_SERVICE_URL` and `PROGRAM_NAME` land in Uncategorised, masked. Re-run the local check (uncategorised **names** only) and update the list recorded in §1.5.2. — Priority: Medium

### Checked and fine

- **Masking fails closed.** An unknown sensitivity, shape, flag parser or personal kind throws inside the row and masks it. An empty or missing catalogue throws, giving a 500. Uncatalogued rows are `secret` with status only. A row is built field by field and no value becomes a field. Facts come only from `shown` rows. `enum` shows the catalogue's spelling.
- **Other paths a secret could take.** None found beyond CR-1:
  - Response headers carry no value.
  - The 400, 401 and 403 bodies are fixed text.
  - The audit `details` holds only the label, counts and correlation id; `request` is passed for IP and user agent, as other admin routes do.
  - `AuditTrailService.log` is `async`, so a synchronous throw becomes a rejection that the `.catch` absorbs.
  - Row-error logs carry catalogue names only.
- **Route.** Exports are exactly `runtime`, `dynamic` and `GET`. `noStore(gate)` covers the 401 and 403. The Zod query is strict and parsed after the gate (R-3 covers `?=` and a bare `?refresh`). Errors use the standard format plus a fixed `code`. Pino logs carry a `correlationId`. No `console.*`. No `any`.
- **Server-only boundary.** The types file has no runtime export. The catalogue has type-only imports (K-7). The classifier opens with `import 'server-only'` (C-28).
- **CLAUDE.md.** Rule 1 is not engaged (no DB read besides the audit row). Rules 2, 3 and 6 are met. Admin authz uses `requireAdmin`, and `test:authz-guard` passes with no edit. The audit call is non-blocking. The entitlements skill is not engaged: no import from the module, and the mode words are not tier or capability literals.
- **Public repo.** SA scanned every new file and the tracked diffs for key or JWT prefixes, project hosts, long hex or base64 runs, real addresses and personal or project names. Only obviously fake fixtures appear (`FAKE…`, `example.test`, an `abcdef0123…` test SHA, `eyJfake…`). No role sentence or note remarks on the state of any credential.
- **Dead code and pattern.** None found. The test seams on `classifyEnvironment` are options, not globals.

### Optimisation Suggestions

- `x-correlation-id` is caller-supplied and is bound to the logger before the gate, so an anonymous caller can put an arbitrary string into the logs. Pino escapes it, and the pattern is repo-wide, so this is not blocking here. A repo-wide follow-up could validate it as a UUID or cap its length.
- EC-4: the trim note in deviation 2; `NODE_TLS_REJECT_UNAUTHORIZED` as before.

### Code Approved for QA: Yes, once CR-1 to CR-3 are in

Conditions for commit: CR-1 to CR-3 each come with their test; the new suites, `test:authz-guard` and `test:bos-entitlements` are re-run green; and the RM runs ship-drill step 1 (`npm run build` plus the typecheck filtered to touched files, checking it did not die) before committing.

---

**CR spot-check by SA, 2026-10-27**
**Status:** ✅ CR-1 to CR-3 match the rulings. The EC-1 code is approved for QA and for commit, subject to the ship-drill condition above.

SA re-ran `lib/admin/environment` and `app/api/admin/environment`: 4 suites, 90 tests, all pass.

| CR | Verdict | Evidence |
|---|---|---|
| CR-1 | ✅ | `sinkText()` (`util.inspect`, `depth: null`, no length caps) now serialises the logger, audit and console sinks, both in `expectNoLeakAnywhere` and in the name-absence checks; the body is already a string. The negative control proves that a logged `Error`, an `Error` `cause`, a `Map` and a `Set` are all caught, and that `JSON.stringify` would have missed the `Error` |
| CR-2 | ✅ | `JWT_OPENING = /eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+/`, unanchored. C-5 adds `prefix:eyJ…` and `path/eyJ…` (both hidden), and `deploy-x.example.test` is still shown (C-5 and the C-25 facts) |
| CR-3 | ✅ | `CLAUDE` is narrowed to the `CLAUDE_CODE_` prefix plus the exact name `CLAUDECODE`. `ONEDRIVE`, `PROGRAM`, `COMMONPROGRAM` and `PYTHON` are now exact-name lists (Python's documented names only). C-21c shows the four app-style names land in Uncategorised and the tool names are counted. The remaining prefixes are tool or platform namespaces; RC-1 still holds |

Authz-guard (203) and bos-entitlements (9,399) results are Dev's; SA did not re-run them.

---

**EC-2 workplan review by SA, 2026-10-27 (§2)**
**Status:** ✅ Approved with changes. Dev applies E2-1 to E2-4 while implementing; SA checks them at the EC-2 code review (UI short path, OQ-1).

**Sequencing corrected by SA:** EC-1 and EC-2 ship together in **one PR**, which the user allowed. SA edited the §2 status line and T2-2. EC-2 builds on this branch on EC-1's route and types and does not wait for a merge. Consequences: the user sees the combined diff before the RM commits; QA's report covers both slices; and the PR body states both slices and their two review paths.

SA also fixed the ToC link to §2 (it pointed at the old `-stub` anchor).

#### Rulings on Q2-1 to Q2-4

| # | Ruling |
|---|---|
| Q2-1 | **Accepted.** The environment chip is a `StatusChip` with tone `info` for the four known labels and `warn` for "Unknown environment"; each tone carries its icon and words. "Not set" uses `unknown` (dashed grey), so nothing reads as a warning before EC-4 decides which rows are amber. |
| Q2-2 | **Accepted.** The FR-19 words show now as plain text, with no amber. They follow `display.state` ("reads as Off" / "reads as On"), never a literal, so a default-on flag reads correctly. EC-4 adds only the emphasis. |
| Q2-3 | **Accepted for `not-plain-config` only (E2-1).** EC-1 builds that reason only for a set value, so "Set" is true. `classification-error` is **not** guaranteed set: an unknown sensitivity, or any throw before the set check, masks an unset row too. Show "Hidden: could not be checked" with no Set chip there. |
| Q2-4 | **Accepted with an allow-list (E2-2).** The catalogue decides which rows link, but `seeAlsoPath` is typed `string`, so the page must not render an arbitrary path with a fixed "See Admin users" label. Put a page-local map in `environmentDisplay.ts` (`'/admin/settings'` → "See Admin users"); a row whose path is not in the map renders no link. A unit test pins both cases. |

#### Checks

| Area | Finding | Status |
|---|---|---|
| SA-C11 client boundary | G2-1 holds every file under `app/admin/environment/`, directive or not, to `import type` from `environment-types` only. That matters because `environmentDisplay.ts` has no directive but is bundled for the client. G2-2 covers the repo-wide `'use client'` scan. One gap: E2-3 | E2-3 |
| Sidebar diff (OQ-1) | One item appended after Admin users, plus the `SlidersHorizontal` import (not imported today). Nav pin: `hrefsOf('Settings')` gains `/admin/environment` last, total 27 → 28 with a dated line, and the on-disk floor `>= 28` is unchanged. The in-object comment sits before `name:`, so the pin's `name: … href: … description:` parser still reads the item. This is the only allowed change; SA reviews the diff at code review. Because this ships in the same PR as EC-1, the RM re-checks the total against `main` at sync time (other streams move it) | OK |
| Migrated-pages registry | F2-9 adds `'/admin/environment (Environment)'` listing the page, the view and the display module, with an L-12-style comment. The guard's checks (shared header, no own `<h1`, no direct `.json(`, alias-only imports of the shared folder) then apply | OK |
| No new shared export | Confirmed: only existing exports are used (`AdminPageHeader`, `AdminFilterBar`, `AdminLoading`/`AdminError`, `StatusChip`, `readAdminResponse`, `ADMIN_NETWORK_ERROR`, `formatUtc`, the `adminTable.ts` constants including `ADMIN_COUNT_LINE`). Nothing is added under `app/admin/components/layout/` | OK |
| Admin Layout Standard as L-12 | Same shape as `app/admin/settings/page.tsx`: the `latestRequest` counter, `readAdminResponse` with `sessionEndedCopy: true`, an `UNUSABLE` fallback behind a shape guard, the Read-only badge, the Refresh-only bar with Read at, an always-mounted `aria-busy` area, a failed read clearing everything (FR-16), and `clientLogger.child` logging status only. Tables are an addition L-12 did not need; they use the shared constants with named headers | OK |
| Read path | One `GET` with no query string and `cache: 'no-store'` (P2-12), consistent with SA-C9 | OK |
| Server and route | EC-2 changes nothing server-side; any response-field need sends it back to the full cycle. Correct | OK |
| Test plan | P2-1 to P2-5 are requirement §7's guardrails; P2-11 (read-only invariant), P2-13 (401 and malformed) and P2-14 (late answer) match L-12. D2-2's exhaustive `never` switch is good | E2-4 |
| Public repo | No values; fixtures are fake | OK |

#### Required changes (EC-2)

1. **E2-1:** `hidden` with `classification-error` shows "Hidden: could not be checked" with no "Set" chip (Q2-3). Add it to D2-2 and P2-3.
2. **E2-2:** Use a link allow-list map for `seeAlsoPath` (Q2-4). An unmapped path renders no link; pin both cases in D2 and P2-10.
3. **E2-3:** The G2-2 directive check must tolerate a BOM, leading comments and either quote style before `'use client'`. Simplest: treat any file whose comment-stripped first statement is the directive as client. G2-1 must also forbid a non-type import of `@/lib/admin/environment-types`, and forbid any import of `@/lib/admin/environment/` from these files, including via a relative path.
4. **E2-4:** Add a render case showing the page never renders `role`, `name` or `shown` text through `dangerouslySetInnerHTML` (a source pin: no `dangerouslySetInnerHTML` under `app/admin/environment/`). It is cheap, and the payload text comes from the environment.

### EC-2 workplan approved: Yes, with E2-1 to E2-4

---

**Code Review by SA, 2026-10-27 (EC-2) + rulings on QA's EC-1 notes**
**Status:** ✅ EC-2 code approved, no changes. 🔄 EC-1 takes three small tightenings from QA's notes (QF-1 to QF-3), in this same PR. SA spot-checks them; no full re-review.

SA re-ran the EC-2 suites, the nav pin and the layout-folder guard: 5 suites, 503 tests, all pass.

#### EC-2 checks

| Area | Finding |
|---|---|
| E2-1 | ✅ `classification-error` reads "Hidden: could not be checked" with no Set chip; only `not-plain-config` carries Set |
| E2-2 | ✅ `SEE_ALSO_LINKS` allow-list checked with `hasOwnProperty`; an unmapped path gives no link; the link shows only on `count` rows |
| E2-3 | ✅ `isClientSource` tolerates a BOM, comments and both quote styles; `pageFileViolations` catches alias, relative, dynamic and `require` imports of `lib/admin/environment/`, any non-type or re-export of the types module, and any other `lib/admin/` import; negative controls for each |
| E2-4 | ✅ Source pin: no `dangerouslySetInnerHTML` under `app/admin/environment/`. All text is rendered as React children |
| Q2-1, Q2-2 | ✅ Tones as ruled; the unrecognised words follow `chip.text` (the state) |
| Sidebar (OQ-1) | ✅ The diff is exactly one appended Settings item plus the `SlidersHorizontal` import (the `-1` line is the comma added after `Wallet`). Nav pin: Settings list `+ '/admin/environment'` last, total 27 → 28 with a dated line. Nothing else moved |
| Migrated-pages registry | ✅ Entry lists page, view and display module, with an L-12-style comment |
| No new shared export | ✅ `git status` shows no change under `app/admin/components/layout/` except the guard test; `adminReadFallback` already exists there |
| Layout Standard (L-12) | ✅ Same structure as Admin users: `latestRequest`, `readAdminResponse` with `sessionEndedCopy`, a shape guard, the Read-only badge, the Refresh-only bar with Read at, `aria-busy` always mounted, and a failed read clearing data and Read at |
| `_rsc` (QA note) | ✅ The page makes one plain `fetch('/api/admin/environment', { method: 'GET', cache: 'no-store' })` with no query string. P2-12 pins it across mount, Refresh and Try again. `_rsc` is added only to RSC page navigations, never to a client `fetch` of an API route |
| Logging | ✅ `clientLogger.child`; status only for a bad response; `{ err }` only for the fetch network error (a browser `TypeError`, no payload). The Q-7 `errorClass` rule was scoped to the server route |
| Public repo | ✅ Fixtures fake; no values |

#### Rulings on Dev's deviations (§2.9 / §2.10)

| # | Ruling |
|---|---|
| 1 `adminReadFallback` for a malformed body | **Accepted.** It is an existing shared export and better than a page-local copy; the wording matches every other migrated page. |
| 2 P2-14 via StrictMode double mount; Refresh disabled in flight | **Accepted.** The double mount is a real two-request race, so the test exercises `latestRequest` honestly. Disabling Refresh while busy is the shared bar's behaviour (`busy`), as on L-12. |
| 3 Zero-count wording | **Accepted.** "No settings set by the hosting platform or operating system were left out." says "checked, none hidden", which is what FR-15 asks. |

#### Rulings on QA's EC-1 notes (§6)

| # | Ruling |
|---|---|
| QA-1 | **Tighten, in this PR (QF-1).** A credential pasted into the wrong variable is the one realistic path left to an admin's browser, and two cheap rules close most of it. (a) `identifier` and `host`: hide a value containing a `[A-Za-z0-9]` run of 20 or more characters that holds an upper-case letter, a lower-case letter **and** a digit (provider keys look like this; Google-style lower-case client IDs and UUIDs do not). (b) `host`: hide any value with an upper-case letter. Host names are case-insensitive and written lower-case, so a capital is a sign it is not a host; this catches the AWS-access-key-under-`SMTP_HOST` example. Accepted cost: a few mixed-case client IDs (for example a Connect `ca_…` or a Salesforce consumer key) now read "Set, hidden". That is fail-closed and correct. No per-entry length cap: it would need tuning per provider for little gain. |
| QA-2 | **Accepted as proposed (QF-2).** The `url` shape requires the raw (trimmed) value to match `^https?://` (case-insensitive) before parsing, so `https:word` is hidden. |
| QA-3 | **Confirmed for EC-4.** Count `BUSINESS_OS_CREDITS_BOOST_TEST_ACCOUNTS` with the reader's own rule (OQ-10's one-parser reasoning) or label the count "not validated". Carried into EC-4's workplan; no change now. |
| QA-4 | **Fix, one line (QF-3).** `scopeOfName` uses a case-sensitive `startsWith('NEXT_PUBLIC_')`, as the catalogue's `scopeOf` already does, because Next inlines only the exact prefix. Leave the deny-list's case-insensitive `NEXT_PUBLIC_` exception as it is, so a lower-case name still lands in Uncategorised (RC-1). |

#### Required changes (EC-1 files, this PR)

1. **QF-1** `lib/admin/environment/classifyEnvironment.ts`: implement (a) and (b) of QA-1. Add C-12 cases:
   - hidden: an `sk-proj-…`-style fake with `-`-broken mixed runs under `identifier`; an AWS-access-key-shaped fake (upper-case and digits) under `host`; `Mail.Example.test` under `host`;
   - still shown: a Google-style fake `123456789012-abcdefghij0123456789abcdefghij.apps.example.test` under `identifier`, a UUID under `identifier`, and `feature/some-branch`.

   Check that the serialisation and catalogue suites still pass.
2. **QF-2** same file, `url` case: the raw value must start with `http://` or `https://` (case-insensitive). Add a C-9 case: `https:opaqueword` is hidden.
3. **QF-3** same file, `scopeOfName`: make the prefix check case-sensitive. Add a C-22 case: an uncategorised `next_public_x` is listed (not counted as noise) with scope `server`.

Gates after the change: `lib/admin/environment` and `app/api/admin/environment` suites green. This touches no route, export or catalogue entry, so no other pin moves.

#### Optimisation suggestion (not blocking)

- `isEnvironmentViewPayload` checks only that `counts` is an object. Checking `typeof counts.platformHidden === 'number'` would stop a malformed body from rendering "undefined settings…".

### EC-2 code approved for QA: Yes. EC-1: approved once QF-1 to QF-3 are in (SA spot-check).

**QF spot-check by SA, 2026-10-27:** ✅ **Approved.** SA re-ran the EC-1 and EC-2 suites: 7 suites, 125 tests, all pass.

| Item | Verdict | Evidence |
|---|---|---|
| QF-1 | ✅ | `hasMixedKeyRun` (a run of 20+ letters and digits holding an upper-case letter, a lower-case letter and a digit) applies to `identifier` and `host`; `host` also hides any capital. C-12b covers hidden (the `sk-proj`-style dash-broken fake, `ZZFAKEKEY0EXAMPLE123` (hidden by the capital rule), `Mail.Example.test`, a mixed run inside a host label) and shown (a Google-style lower-case id, a UUID, a branch name, a 19-character mixed run) |
| QF-2 | ✅ | `URL_SCHEME = /^https?:\/\//i` is checked before parsing; C-9 hides `https:opaqueword` and still shows an upper-case `HTTPS://` origin |
| QF-3 | ✅ | `scopeOfName` is case-sensitive; C-22b shows `next_public_x` is listed with scope `server` and is not counted as noise (RC-1 intact) |
| `platformHidden` guard | ✅ | `isEnvironmentViewPayload` requires `counts.platformHidden` to be a number |

**Secret-scanning check of the fixtures.** SA scanned every file in `lib/admin/environment/`, `app/api/admin/environment/` and `app/admin/environment/`, plus the types file, against the AWS (`AKIA`/`ASIA`), Stripe (`sk_`/`rk_` live and test, `whsec_`), Slack (`xox?-`), GitHub (`gh?_`, `github_pat_`), Google (`AIza`), OpenAI (`T3BlbkFJ`), Anthropic (`sk-ant-`), GitLab, SendGrid, Resend (`re_`), npm and PEM key formats, and three-segment JWTs.

- **No match** for any provider format.
- **JWT-like strings:** the only ones are the C-5 literals (`eyJfakeHeader.…`). Their segments do not decode to JSON, so they are not valid JWTs, and GitHub push protection has no generic-JWT rule.
- **`sk-proj-FAKE…` in C-12b** lacks the `T3BlbkFJ` marker that GitHub's OpenAI pattern requires, so it is safe as it is.
- **Serialisation fixtures** are generated at run time (`FAKE…` plus a seeded alphabet), so no literal exists in the source.
- The coordinator's change of the AWS-shaped fixture to `ZZFAKEKEY0EXAMPLE123` is correct.

No fixture needs changing.

---

## 6. QA Testing Report

*Per SA-C14: results recorded as pass or fail per class, no value quoted, no screenshot from a real deployment.*

**QA — 2026-10-27 (EC-1, after CR-1 to CR-3)**
**Test mode:** full
**Strategy used:** A (Jest unit, pure classifier with fixture objects) + B (Jest integration, the real route with the real admin gate; `getUser`, `AdminAccessService`, the logger and the audit service mocked). The slice has no UI, so there is no browser check.
**Focus:** security, api, schema
**Skipped:** the network-response check on a real deployment (§8, second half of criterion 5): no page exists until EC-2, and no deployment of this branch exists. It is owed when EC-2 ships. `npm run build` was not run either: it is the RM's ship-drill step 1, a condition of commit per the SA ruling.
**Input source:** TL brief (prompt), checked against requirement §8 and §10.1 and workplan §1 and §5

The adversarial cases ran as a throwaway Jest file, written in the session scratchpad, copied into `lib/admin/environment/__tests__/` for the run and **deleted afterwards** (`git status` confirms only the slice's own test files remain). Every fixture was obviously fake (`FAKE…` strings, `example.test` hosts). No real environment value was opened or recorded.

### Test Coverage

| Acceptance criterion / condition | Tested? | Result | Notes |
|---|---|---|---|
| Non-admin gets the standard refusal (§8) | ✅ | Pass | Signed out 401, non-admin 403, both `no-store`. A non-admin **with** a query string gets 403, not 400, so the gate runs first. When `getUser` throws, the gate answers 401. The classifier and the audit are never reached |
| Environment label (§3.1, §8) | ✅ | Pass | 16 cases. `production`, `preview`, `development` → vercel-development; no `VERCEL_ENV` + `NODE_ENV=development` → local; everything else → unknown. `NODE_ENV=production` alone, `NEXT_PUBLIC_VERCEL_ENV=production` alone and `VERCEL=1` alone all give **unknown, never production**. An unrecognised `VERCEL_ENV` gives unknown even with `NODE_ENV=development`. Matching ignores case and surrounding whitespace; a whitespace-only `VERCEL_ENV` counts as absent |
| Every catalogued variable appears with its role (§8) | ✅ | Pass | Existing K-1 and R-1 tests. Confirmed in the probe payloads |
| Flags read On / Off, "(default)" when unset, and agree with the reader (§8, SA-C3) | ✅ | Pass | Lenient: a fake secret string → default + unrecognised (Off, or On for the default-on V6 review flag, which is what `parseBooleanFlag` returns); `TRUE` surrounded by spaces and a newline → on/set; `0` with tab and CRLF → off/set; whitespace only → default. Strict: `true` with a leading space or a trailing newline → off/unrecognised, which matches the code's `=== 'true'`. Every flag `display` has exactly the keys `kind`, `state`, `source`; no raw text |
| No secret, personal or uncatalogued value in the response, logs or audit (§8, SA-C7) | ✅ (automated) / ⬜ (real deployment) | Pass | See the per-class table below. The real-deployment network check is deferred to EC-2 (see Skipped) |
| Catalogued and not set shows Not set (§8) | ✅ | Pass | C-23 + probe payloads |
| Uncatalogued → Uncategorised, masked; platform names counted (§8) | ✅ | Pass | See the per-class table below |
| Route exports `GET` only (§8, OQ-2) | ✅ | Pass | The module's runtime exports are exactly `GET`, `dynamic` (`force-dynamic`) and `runtime` (`nodejs`); no `revalidate` or `fetchCache`. R-5 also pins this in source |
| One audit event per view; audit failure does not fail (§8, OQ-8) | ✅ | Pass | Audit `details` keys are exactly `correlationId`, `environment`, `rows`, `set`, `notSet`, `uncategorised`, `platformHidden`. No variable name (catalogued or uncategorised) appears in the audit argument. R-9 and the serialisation test cover a rejecting audit |
| SA-C9 strict empty query → 400 | ✅ | Pass | `?a=1`, `?a=1&b=2`, `?a`, `?=`, `?__proto__=1`, `?constructor=x`, `?%00=1` and `?_rsc=abc` all give 400 with `no-store`, without classifying or auditing. `?` and `?&` parse to no parameters and are treated as no query (correct). Note for EC-2: Next's `_rsc` is refused, so the page must fetch the route with a plain `fetch`, adding no parameter |
| `Cache-Control: no-store` on 200, 400, 401, 403, 500 (OQ-2) | ✅ | Pass | Checked on every status |
| SA-C6: `NODE_ENV=development` with a throwing classifier | ✅ | Pass | Four throw shapes, each carrying a fake secret: an `Error` with the secret as its message; a thrown bare string; a thrown plain object with `message` and a fake `constructor.name`; and an `Error` subclass whose `name` is the secret. Each gave 500, `details` equal to the fixed code `environment_classification_failed`, `no-store`, and no 8-character window of the secret in the body or the logs |
| CR-1 (serialisation gate expands errors) | ✅ | Pass | Negative control present and green (`util.inspect`; it also shows that `JSON.stringify` would miss the leak) |
| CR-2 (unanchored JWT opening) | ✅ | Pass | A JWT after `:`, a JWT inside a host value, and a three-long-segment token without `eyJ` are all hidden. C-5 also pins it |
| CR-3 (narrowed deny-list prefixes) | ✅ | Pass | C-21c present and green |
| FR-8 / performance (§6, under 200 ms) | ✅ | Pass | Average of 4.5 ms per classification of the full process environment over 50 runs (local, Windows) |

**Masking, pass or fail per class (SA-C14), through the classifier and through the real route:**

| Class / probe | Result |
|---|---|
| `secret` (every catalogued secret, existing S-1) | Pass: Set / Not set only |
| `config`, JWT-shaped (plain; after `:`; inside a host; three long segments without `eyJ`) | Pass: hidden |
| `config`, a 40+ character base64 run (including `+/=`) | Pass: hidden |
| `config`, a real-length Stripe-style `sk_` key | Pass: hidden (the run rule catches the body) |
| `config` URL with credentials in user-info, path, query or fragment; a backslash user-info trick | Pass: origin only, no part of the credentials in the output |
| `config` URL with a non-http scheme (`javascript:`, `postgres:`) | Pass: hidden |
| `config` URL with a 40+ character host label | Pass: hidden |
| `config` host with `user:pass@`; an integer with a query appended; an enum or region value outside its set; an identifier containing `@` | Pass: hidden |
| `config` with whitespace inside (space, tab, newline, NBSP, zero-width space), quotes, RTL override, emoji, fullwidth letters, non-ASCII digits | Pass: hidden |
| `config` with whitespace or a BOM only around the value | Shown trimmed (accepted deviation 2) |
| `config` length 200 / 201 / 100,000 | Shown / hidden / hidden; no slowdown |
| IDN URL / zero-width space in a URL host | Shown as the parser's normalised (punycode) origin; no added characters |
| `flag` set to a fake secret (lenient and strict) | Pass: verdict only |
| `personal` email lists (`ADMIN_EMAILS` with mixed `,` `;` newline separators, blanks and a duplicate; the boost accounts list) | Pass: a count only (`ADMIN_EMAILS` counts 3 unique, which agrees with `parseAdminEmails`). No address in the payload |
| `personal` single values (SMTP user, sender address, test-page user id) | Pass: Set only |
| Uncatalogued `NEXT_PUBLIC_*_KEY`, uncatalogued lowercase names, a mixed-case `SeCrEt` name, `constructor` / `toString` as names | Pass: listed in Uncategorised, status only, value absent |
| Injected catalogue: a `config` named with mixed-case `SeCrEt`, a `NEXT_PUBLIC_…_Api_Key` `config`, a `personal` list whose name contains `TOKEN` | Pass: status only (SA-C1 beats the catalogue, case-insensitive) |
| Deny-listed names (`VERCEL_*` token-like, a `_`-prefixed name) | Pass: counted, never listed |
| Logs and audit for all of the above, through the route | Pass: no probe marker and no uncategorised name in any logger record (including `child()` bindings) or in the audit argument |

### Issues Found

#### Bugs (must fix before commit)

None.

#### Performance Issues (should fix)

None. 4.5 ms per classification.

#### Edge Cases (nice to fix; none is a leak under the ruled design)

1. **A key-shaped value whose opaque runs are broken by `-` or `_` is shown under an `identifier` entry.** — File: `lib/admin/environment/classifyEnvironment.ts` (`IDENTIFIER`, `LONG_OPAQUE_RUN`) — Severity: Low
   - Steps: put a fake `sk-proj-`-style value made of 35-character chunks joined by `-` (about 160 characters) under an `identifier` entry such as `OPENAI_MODEL`. A short `sk_test_` plus 20 characters behaves the same, as does a 20-character AWS-access-key-shaped value under `SMTP_HOST`.
   - Expected under SA-C2 as written: shown, because no gate fires (no run of 40, under 200 characters, legal characters).
   - Actual: shown in full. This is what SA-C2 says, so it is not a defect. But it is the one shape where a credential pasted into the wrong variable reaches an admin's browser. Exposure needs a misconfiguration and an admin viewer, and the value never reaches logs or audit. Suggestion for SA (EC-4 or a follow-up): a per-entry maximum length for `identifier` (model names, client IDs and branch names are short), or reject an `identifier` value whose longest `[A-Za-z0-9]` run mixes upper case, lower case and digits beyond about 20 characters.
2. **`https:` without slashes turns an opaque string into the shown host.** — Same file, `url` case — Severity: Low. The WHATWG parser reads `https:` followed by a word as `https://word`, so an opaque string under 40 characters is shown, lower-cased, as an origin. Same class and same mitigation as item 1. A cheap tightening: require the raw value to start `http://` or `https://`.
3. **The boost test-accounts count can disagree with its reader.** — `catalogue.ts` (`list-comma`) vs `lib/business-os/boost/boostCheckoutAccess.ts` `parseBoostTestAccounts` — Severity: Low (display only; EC-4 territory). The page counts non-blank comma entries, but the reader keeps only valid account ids and closes the checkout to everyone when none is valid. So a list of addresses shows as "2 entries" while the reader honours 0. This follows requirement §3.2's wording, but per OQ-10's "one parser" reasoning, EC-4 should count with the reader's rule (or label the count as "entries, not validated").
4. **Scope of an uncategorised lowercase `next_public_*` name** is reported as `browser-inlined`, because `scopeOfName` upper-cases the name, but Next inlines only the exact upper-case prefix. — `classifyEnvironment.ts` `scopeOfName` — Severity: cosmetic. Masking is unaffected.

### Test Outputs / Logs

| Gate | Result |
|---|---|
| New suites + `lib/audit/__tests__/eventAudience.test.ts` | 5 suites, **111 tests, all pass** (27.7 s). The 4 new suites: classifier 41, catalogue 29, serialisation 7, route 13; eventAudience 21 |
| QA adversarial file (throwaway, deleted) | 1 suite, **93 cases, all pass** (classifier probes 61, environment label 16, route 16) |
| `npm run test:authz-guard` | 2 suites, 203 tests pass |
| `npm run test:bos-entitlements` | Not required: no file in the diff imports `lib/business-os/entitlements/` (grep: none). Dev's run after CR-1 to CR-3 was green |
| `npx tsc --noEmit` (full project, `NODE_OPTIONS=--max-old-space-size=8192`) | Completed, **no OOM** (no heap or fatal line in the output; the diagnostics list was printed), exit 2 with 1,852 pre-existing diagnostics, **0 in any touched file** (`lib/admin/environment/**`, `lib/admin/environment-types.ts`, `app/api/admin/environment/**`, `lib/audit/events.ts`, `lib/audit/eventAudience.ts`) |
| `eslint` on touched files | 0 errors; 1 pre-existing warning at `lib/audit/events.ts:1834` (outside the diff) |
| `console.*` in the new source files | 0 |

### Final Status
- [x] All acceptance criteria in EC-1's scope pass — ready for commit, subject to the SA-ruled condition that the RM runs `npm run build` plus the touched-file typecheck first. The real-deployment network check (criterion 5, second half) is owed at EC-2
- [ ] Issues found — Dev must address before commit

**Verdict: PASS with notes.** No bugs. Four Low or cosmetic edge cases, none a leak under the ruled design. Items 1 and 2 are offered to SA as an optional tightening of SA-C2.

### 6.2 EC-2 QA (the `/admin/environment` page), 2026-10-27

**Test mode:** full · **Strategy:** A + render tests (Jest, jsdom, mocked `fetch`); D (live browser) **owed: live check after deploy** (needs an admin sign-in) · **Focus:** ui, security · **Input source:** TL brief.
The final code was tested after Dev's parallel changes to `classifyEnvironment.ts`, `environmentDisplay.ts` and the payload guard: the files were stable for several minutes and everything was re-run afterwards. The adversarial cases ran from a throwaway file copied in for the run and deleted afterwards. Fixtures are fake; no screenshot, no real value (SA-C14).

| Check | Result | Notes |
|---|---|---|
| Error states: malformed 200 (null data, missing `success`, unknown label, `__proto__` label, non-array groups, missing `platformHidden`), non-JSON body, 401, 403, 500, HTML 500, network error | Pass | No card is shown. Each case gets the shared fallback, session-ended, route-message or network words. The 500 `details` code is not shown |
| Failed refresh after a good read (500, 401, network, malformed) | Pass | The environment card, every group card, Uncategorised, the count line and "Read at" all clear. Try again recovers |
| Unknown environment label | Pass | Refused by the guard (fallback words); `unknown` itself renders "Unknown environment", tone `warn` (P2-2) |
| Unmapped `seeAlsoPath` (`/admin/elsewhere`, `javascript:…`, `__proto__`, `constructor`); `seeAlsoPath` on a non-count row | Pass | No link in any case |
| HTML or script in role, name, group label, description, shown text and a fact | Pass | Renders as literal text. 0 `img`, `script` or `b` elements created; the injected handler never ran |
| Long names and values | Pass (by class inspection) | Tables sit in `overflow-x-auto`; shown values and facts are `break-all`. A long **name** does not wrap (monospace, no break class), so on a phone it scrolls inside its card, not the page. jsdom cannot measure page-level horizontal scroll: part of the owed live check |
| Accessibility | Pass | Every chip carries words (Read-only, the label, Set, Not set, On, Off). `aria-busy` is true while reading and false after. Headings are one h1 then h2 cards, the same pattern as Admin users. Tables have `scope="col"` headers: Name, Value, Role, Scope |
| One plain GET | Pass | Every call is exactly `('/api/admin/environment', { method: 'GET', cache: 'no-store' })`, with no query string, across mount, Refresh and Try again |
| No reveal, copy or download control | Pass | No clipboard, download, Blob or `innerHTML` in the page files; the only buttons are Refresh and Try again (P2-11) |
| Client boundary (SA-C11) | Pass | The page files import only `environment-types` from the feature, as `import type`; the G2 guard is green |
| Sidebar | Pass | One item appended at the end of Settings, plus the icon import; nothing else changed |

**Bugs**
1. **A payload that is malformed inside a row crashes the whole page.** — `app/admin/environment/environmentDisplay.ts` (`isEnvironmentViewPayload`), `components/EnvironmentView.tsx` — Severity: **Low** (the only producer is the same build's typed route, so this needs a server bug; no data leaks)
   - Steps: answer 200 with a top-level-valid payload where one group's `rows` is not an array, or a row's `display` is null, or a `shown.text` or a fact is an object.
   - Expected: the shared fallback words, as for other unusable payloads (§2.3.1).
   - Actual: React throws during render and the page unmounts. There is no `error.tsx` under `app/` or `app/admin/`, so in production this is Next's generic client-error screen. The guard checks only the top level.
   - Fix: validate each group's `rows`, each row's `display.kind` with its fields' types, and that facts are string or null. Alternatively, render rows defensively.

**Edge cases**
2. **An unknown `display.kind` renders whatever `mono`, `note` or `chip` fields it carries.** The `never` default in `describeDisplay` returns the display object itself as `ValueWords`. Also, a non-number `count.entries` is printed ("… entries"). — `environmentDisplay.ts` — Severity: Low. Not a leak path, because the server sends only the closed union. Suggest that the default branch return the fixed "Hidden: could not be checked" words.
3. **A long variable name does not wrap** (see Long names and values above). Cosmetic.

**Gates (final code):** 10 suites, **616 tests pass**. These are the EC-2 suites (render, display, client boundary), the EC-1 suites, `eventAudience`, `AdminSidebar.nav` and `layoutFolder.guard`. QA adversarial render file: 35 cases, 31 pass, 4 fail (bug 1). `npm run test:authz-guard`: 203 pass (R8 accepts the page). `eslint` and the hooks lint (`--max-warnings 0`) on the EC-2 files and the sidebar: clean.

**Owed:** a live check after deploy. Open the page from the sidebar as an admin; check that the chip names the right environment, that every masked class reads Set / Not set, and that there is no page-level horizontal scroll at phone width. Record pass or fail per class, with no values and no screenshot.

**EC-2 verdict: PASS with notes.** Bug 1 is Low and does not block commit; Dev should harden the guard in this PR if cheap, otherwise as a follow-up.

---

## 7. Commit Info

**Branch:** `feature/admin-environment-view` · **PR:** [#522](https://github.com/AgentsPilot/neuronforge/pull/522), EC-1 and EC-2 together, on auto-merge (merge commit) through the merge queue

| Commit | Message |
|---|---|
| `7d3b89a0` | docs(admin): environment configuration view requirement and workplan |
| `657f10b8` | feat(admin): environment catalogue, classifier and read-only route (EC-1) |
| `c866088e` | feat(admin): environment configuration page and sidebar item (EC-2) |
| `2bcde8fb` | Merge `origin/main` into the branch (no conflicts) |

**Ship drill (RM, 2026-10-27):** `npm run build` passed. `tsc --noEmit` showed 0 errors in the touched files (1,860 pre-existing elsewhere) and did not run out of memory. Re-checked against `main` after the sync: register row 119 is the next free number, the audit split is 62 / 77 / 84 (223), and the nav total is 28. After the sync, 10 suites and 623 tests pass, and `test:authz-guard` passes 203. Secrets scan of the diff: clean.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-26 | Workplan created | EC-1 planned in full: rulings and conditions carried, mechanical inventory (133 names, 64 not in the BA seed, 2 seed names unread), proposed catalogue, classifier and route design, file list, task list, test plan with the SA-C7 gate, ten questions for SA. EC-2 to EC-4 stubbed. |
| 2026-10-26 | SA workplan review: approved with changes | Q-1 to Q-10 ruled in §5; required changes RC-1 to RC-8 (deny-list keeps `NEXT_PUBLIC_*` visible, `identifier` drops `@`, stronger SA-C7 gate, strict flags default off, error-logging source pin, catalogue edits incl. the `external` group, register row taken at commit time, requirement Progress row). SA removed two pointers to a privately tracked finding (Slack row note, Q-4 wording). |
| 2026-10-26 | EC-1 implemented: Code Complete | RC-1 to RC-8 applied; T-1 to T-17 ticked; final deny-list recorded in §1.5.2; §1.11 Implementation notes added (files, RC map, deviations, gate results). |
| 2026-10-27 | SA code review EC-1: approved with changes | RC-1 to RC-8 and Q-1 to Q-10 verified; deviations 1 to 7 ruled; required CR-1 (serialisation gate must expand Error objects), CR-2 (unanchored JWT opening check), CR-3 (narrow four over-broad deny-list prefixes). Follow-up: six admin routes on `main` lack register rows. |
| 2026-10-27 | SA: CR spot-check passed; EC-2 workplan approved with changes | CR-1 to CR-3 verified (90 tests re-run). EC-2: Q2-1 to Q2-4 ruled; E2-1 to E2-4 required; §2 sequencing corrected to one PR for EC-1 + EC-2; ToC anchor for §2 fixed. |
| 2026-10-27 | RM: commit, PR and auto-merge | EC-1 and EC-2 committed (`7d3b89a0`, `657f10b8`, `c866088e`), synced with `main` without conflicts, PR #522 opened on auto-merge. §7 filled in. |
