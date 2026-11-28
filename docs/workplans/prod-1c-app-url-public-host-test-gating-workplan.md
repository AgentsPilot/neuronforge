# Workplan: PROD-1c, One App Address, a Configured Public-Site Host, and a Gated Test Surface (A3 + A4 + A6)

> **Last Updated**: 2026-11-27

**Developer:** Dev
**Requirement:** Production build-out, Workstream A, items A3, A4 and A6 (the private environments strategy doc, untracked; the approved scope is quoted in section 1)
**Branch:** `fix/prod-1c-app-url-and-test-gating` (created by RM from `origin/main` at `259a7e21`; confirmed by Dev with `git branch --show-current` before writing this file)
**Baseline read:** `origin/main` at `259a7e21`. Every file:line below is from that commit
**Date:** 2026-11-26
**Status:** A-1 code complete. B-3 ruled option (c) by SA: the two pages answer HTTP 200 with the not-found screen (`noindex`, no content), and the routes a real 404. FR-1 and FR-2 wording fixes applied; waiting on SA's wording re-check, then QA (FR-3). A-2 and A-2b not started. Nothing committed

## Overview

The scope was measured in September. Since then the codebase has changed a lot, and most of A3 and A4 is already done. A resolver exists: `lib/utils/origins.ts` landed on 2026-09-22 as "resolve every web address in one place" and was refined on 2026-10-13. **67 files** already import it. The public-site host is already read from configuration (`NEXT_PUBLIC_PUBLIC_SITE_HOST`) by middleware and by every address the interface shows. The "~53 sites" of September are now **5 direct readers of the app-address variable**, **1 loader** that pastes the raw variable into 21 plugin OAuth redirect URIs, **2 request-derived bases** (one of them in an emailed link), **1 link in customer email** to a host that is not ours, **1 dead `vercel.json` rewrite**, and **1 tour screen** that shows the retired `.agentspilot.com` suffix.

What is left for A3 is mainly **precedence**, not scatter. The resolver's Rule 2 lets a preview's per-deployment host outrank configuration (`origins.ts:194-199`). That was the right fix for PR previews. It is the wrong rule for staging: staging is a Preview deployment of `main`, and it needs one stable address that OAuth providers, Stripe Connect and Supabase Auth can register. Section 7 reverses the order. Configuration wins, with a refusal rule (1b) so that a Preview can never hand out production's address. Below configuration, the branch URL is preferred to the deployment hash. The five raw readers then move onto the resolver.

A6 has not been started. Eight test or debug API routes (nine handlers) and two test pages are reachable on the production target. Two routes have no authentication at all, and one of those spends LLM money attributed to `'system'`. One route compares the caller to a hardcoded user id. Section 9 adds one gate. In production it answers **404** to everyone except an admin, using `requireAdmin` / `requireAdminPage`.

**Recommendation: two PRs, not one** (section 6). A-1 is A6, the test-surface gate. It needs no environment change and closes a live exposure, so it goes first. A-2 is A3 + A4. It changes link precedence and has to wait for DevOps sequencing and for an in-flight change to the OAuth callback route. A third, very small PR (A-2b) later flips warn-only to a failing build.

No migration, no schema claim, no LLM call, no entitlements import, no new API route.

---

## Table of Contents

1. [Approved scope (verbatim) and decided context](#1-approved-scope-verbatim-and-decided-context)
2. [Analysis summary](#2-analysis-summary)
3. [A3 inventory: where the app address comes from](#3-a3-inventory-where-the-app-address-comes-from)
4. [A4 inventory: the platform domain family and the public-site host](#4-a4-inventory-the-platform-domain-family-and-the-public-site-host)
5. [A6 inventory: the test and debug surface](#5-a6-inventory-the-test-and-debug-surface)
6. [One PR or two](#6-one-pr-or-two)
7. [The resolver (A3 design)](#7-the-resolver-a3-design)
8. [The public-site host (A4 design)](#8-the-public-site-host-a4-design)
9. [The test-surface gate (A6 design)](#9-the-test-surface-gate-a6-design)
10. [The guards so this does not come back (G-8, G-9)](#10-the-guards-so-this-does-not-come-back-g-8-g-9)
11. [Decisions needed from SA](#11-decisions-needed-from-sa)
12. [Files to create / modify](#12-files-to-create--modify)
13. [Task list](#13-task-list)
14. [Test plan](#14-test-plan)
15. [Environment changes (handed to DevOps)](#15-environment-changes-handed-to-devops)
16. [Open questions](#16-open-questions)
17. [Risks](#17-risks)
18. [Rollback](#18-rollback)
19. [Observed, out of scope](#19-observed-out-of-scope)
20. [SA Review Notes](#20-sa-review-notes)
    - [SA Review (2026-11-26)](#sa-review-2026-11-26)
    - [SA Code Review (2026-11-27)](#sa-code-review-2026-11-27)
21. [QA Testing Report](#21-qa-testing-report)
22. [Commit Info](#22-commit-info)
23. [Change History](#change-history)

---

## 1. Approved scope (verbatim) and decided context

From the strategy doc's Workstream A table:

> **A3**: "App URL resolution scattered across ~53 sites with four different hardcoded hosts and three fallback styles (`localhost:3000`, `''`, none). Stripe callbacks, OAuth redirect URIs and emailed links all derive from it. The `''` group emits host-less links in customer email *today*." Fix direction: "One `getAppUrl()` resolver; ship warn-only, flip to throwing after Vercel vars are set."
>
> **A4**: "Public-website host `agentpilot.io` hardcoded in ~12 places and in the `vercel.json` rewrite. Subdomain routing cannot work on any other host; the UI tells users their site is live at a production URL that does not serve their page." Fix direction: make the host config-driven.
>
> **A6**: "Test/debug surface reachable in production: `/test-business-os`, `/test-plugins-v2`, `app/api/test/**`, `app/api/debug/**`, `app/api/v6/*test*`. Several operate on a hardcoded user id." Fix direction: "Gate on `VERCEL_ENV === 'production'` with an admin override."

Brief constraints carried into this plan:
- Re-measure A3 before starting (done: section 3).
- PROD-1c: on a Preview deployment (staging = Preview scoped to branch `main`) the app builds links from its own address, not production's.
- Admin checks use `requireAdmin` / `requireAdminPage`, never `profiles.role` (CLAUDE.md Security Rules).
- Gated means a 404 in production.
- The customer public-site domain is **not** decided here (section 16, OQ-1).
- Tests never reach the network.
- Environment variable names only in this tracked file.

Decided context: `agentspilot.ai` is the marketing site. The app will be `app.agentspilot.ai`, already `PROD_PLATFORM_ORIGIN` at `lib/utils/origins.ts:37`, with no DNS yet. Vercel's Production target serves the staging world today. The real production cutover is PROD-3.

**Corrections to the September measurement, found here.**

(a) The `''` group no longer emits host-less links in email. A repo-wide search for an empty-string URL fallback (section 3, Q-6) finds exactly two left. One is the OAuth callback page's `postMessage` target (`app/oauth/callback/[plugin]/route.ts:12`). The other is the email logo, which falls back to "no logo", not to a host-less link (`lib/email/platformBranding.ts:42`).

(b) The hardcoded hosts are now mostly in comments that record the history (56 of the 69 platform-domain lines).

(c) The `vercel.json` rewrite is dead. Middleware already does the same rewrite from configuration (`middleware.ts:107-121`).

---

## 2. Analysis summary

| Area | What this work touches | Facts measured on `origin/main` |
|---|---|---|
| Resolver | `lib/utils/origins.ts` | `platformOrigin()` (`:171-216`): Rule 0 browser origin (`:184-187`), Rule 1 loopback refused on Vercel (`:189-192`), Rule 2 preview deployment host **outranks configuration** (`:194-199`), then the configured value, then the production host / constant (`:206-215`). Reads `NEXT_PUBLIC_APP_URL` (`:172`), `[NEXT_PUBLIC_]VERCEL_URL` (`:101`) and `[NEXT_PUBLIC_]VERCEL_PROJECT_PRODUCTION_URL` (`:114-115`). Isomorphic: imported by middleware (edge), server code and client components |
| Production signal | `lib/utils/deploymentEnvironment.ts:33` | `isProductionDeployment()` reads runtime `VERCEL_ENV` exactly (PROD-1b, SA D-3). Reused by the A6 gate |
| Plugin OAuth redirect URIs | `lib/server/plugin-manager-v2.ts:145-170`; 21 files in `lib/plugins/definitions/` | `${NEXT_PUBLIC_APP_URL}/oauth/callback/<plugin>` is replaced with the raw variable. If unset, the literal placeholder is kept (`:156-158`). The resolved URI is used to build the auth URL on both server and client (`app/api/v2/plugins/connect/route.ts:73`, `lib/client/oauth-handler.ts:42,283`) and for the token exchange (`lib/services/OAuthTokenService.ts:94`) |
| Existing address guard | `lib/utils/__tests__/oneAddressPolicy.guard.test.ts` | Allows `origins.ts` and `platformBranding.ts` to read the variable (`:49-54`). Also exempts OAuth redirect lines and two OAuth files (`:82-91`) **because** Rule 2 cannot serve a registered URI. After section 7 it can, so the exemption shrinks |
| Env catalogue | `lib/admin/environment/catalogue.ts:210-213,250-252` | Rows exist for the Vercel host variables and the three address variables. `NEXT_PUBLIC_APP_URL` is `exp('R','R','R')` (required on Preview too). There is no row for the branch-URL variables. `catalogueDrift.guard.test.ts` fails when code reads a variable that has no row |
| Public-site host | `origins.ts:260-305` (`publicSiteHost`), `middleware.ts:107-121` | Config-driven already, with a loopback refusal off development. `docs/WEB_ADDRESSES.md` is the operator doc |
| Admin gates | `lib/admin/requireAdminRoute.ts:63`, `lib/admin/requireAdminPage.ts:71` | The route gate returns 401/403 as a `NextResponse`. The page gate **redirects** to `/business-os` (`:63`). Neither gives a 404 today. Both audit a refusal that answered "no" |
| Guard suite | `lib/__tests__/envConfigHardening.guard.test.ts` | One-pass, line-ending-proof scan, G-1 to G-7 (PROD-1a, PROD-1b). Section 10 adds G-8 and G-9 |
| In-flight conflict | `app/oauth/callback/[plugin]/route.ts` | Another branch has uncommitted changes to this file (an OAuth callback identity fix). A-2 changes line 12 of the same file (R-3) |

Skills checked:
- `tenant-isolation-guard`: not engaged. No write logic changes. The gate only refuses.
- `business-os-schema-check`: no column or table claim.
- `business-os-entitlements`: no import from that module.
- `bos-llm-call-standards`: no AI call is added. `test-direct-generation`'s existing calls get gated, not changed.
- `durable-queue-drain`: not engaged.
- `new-api-route`: no new route. Each gated route keeps its handler and gets one first statement.
- `env-change-protocol`: section 15.
- V6: `test-direct-generation` and `execute-test` live under `app/api/v6/`, but nothing in IntentContract, CapabilityBinderV2, IntentToIRConverter or ExecutionGraphCompiler changes. The plugin loader change is generic (one placeholder resolved by the resolver, no plugin name).

---

## 3. A3 inventory: where the app address comes from

Scope of every grep: `lib/ app/ components/ hooks/ middleware.ts next.config.js vercel.json`, excluding `*__tests__*`, `*.test.*` and `*.spec.*`. Q-2 alone reads `lib/plugins/definitions/`, which Q-3 excludes. `scripts/` (operator scripts) and `supabase/functions/` were checked and hold no app-address read. The exact commands, run from the repo root in Git Bash:

**File:** rerunnable inventory (A3)

```bash
P=(-- lib app components hooks middleware.ts next.config.js vercel.json ':!*__tests__*' ':!*.test.*' ':!*.spec.*')
# Q-1  direct reads of the address variables
git grep -n -E "process\.env\??\.(NEXT_PUBLIC_APP_URL|VERCEL_URL|NEXT_PUBLIC_VERCEL_URL|VERCEL_BRANCH_URL|NEXT_PUBLIC_VERCEL_BRANCH_URL|VERCEL_PROJECT_PRODUCTION_URL|NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL)" "${P[@]}"
# Q-2  the plugin-definition placeholder (files)
git grep -c -F '${NEXT_PUBLIC_APP_URL}' -- 'lib/plugins/definitions/*.json'
# Q-3  loopback and *.vercel.app literals
git grep -n -i -E "https?://(localhost|127\.0\.0\.1)(:[0-9]+)?|https?://[a-z0-9-]+\.vercel\.app" "${P[@]}" ':!lib/plugins/definitions/*'
# Q-4  request-derived origins
git grep -n -E "nextUrl\.origin|new URL\((req|request)\.url\)\.origin|headers\.get\(['\"](host|x-forwarded-host|origin)['\"]\)|requestUrl\.origin|url\.origin" -- lib app components hooks middleware.ts ':!*__tests__*' ':!*.test.*'
# Q-5  browser origin
git grep -n -E "window\.location\.origin" -- lib app components hooks ':!*__tests__*' ':!*.test.*'
# Q-6  empty-string fallbacks on a URL-ish name
git grep -n -E "(Url|URL|url|origin|Origin|base|Base)\s*(\|\||\?\?)\s*['\"\`]{2}" -- lib app components hooks ':!*__tests__*' ':!*.test.*'
# Q-7  compliant: files importing the resolver
git grep -l -E "from ['\"]@/lib/utils/origins['\"]" "${P[@]}" | wc -l
```

| Query | What it finds | Lines |
|---|---|---|
| Q-1 | Direct reads of the app-address and Vercel host variables | 12 |
| Q-2 | `${NEXT_PUBLIC_APP_URL}` in plugin definitions | 21 (21 files) |
| Q-3 | Scheme-qualified loopback and `*.vercel.app` literals | 14 |
| Q-4 | Request-derived origins | 11 |
| Q-5 | `window.location.origin` | 26 |
| Q-6 | Empty-string fallbacks on a URL-ish name | 20, of which 2 are addresses (the rest are avatar/logo/form fields) |
| Q-7 (compliant) | Files importing `@/lib/utils/origins` | 67 files |

### 3.1 Q-1: direct reads of the address variables (12 lines)

| # | File:line | What it does | Class | Action |
|---|---|---|---|---|
| A-1 | `lib/utils/origins.ts:101`, `:114`, `:115`, `:172` | The resolver's own reads | Resolver | Modify (section 7) |
| A-2 | `app/api/v2/plugins/connect/route.ts:73` | `authConfig.redirect_uri \|\| \`${process.env.NEXT_PUBLIC_APP_URL}/oauth/callback/...\`` (fallback style: none, so `undefined/oauth/...`) | OAuth redirect | `platformUrl('/oauth/callback/<plugin>')` |
| A-3 | `app/oauth/callback/[plugin]/route.ts:12` (used at `:33`) | `NEXT_PUBLIC_APP_URL \|\| ''` is the popup's `postMessage` target origin. `''` is an invalid target, so the message throws in the popup and the opener falls back to polling (`lib/client/oauth-handler.ts:180-201`) | OAuth popup | `platformOrigin()`, read per request (R-3) |
| A-4 | `lib/email/platformBranding.ts:42` | Email logo, used only when the value is https | Email asset | D-7: take the resolution's `source === 'configured'` instead of reading the variable |
| A-5 | `lib/plugins/strategies/slackPluginStrategy.ts:60` | V1 Slack strategy base URL, evaluated at import (`:86`) | Deprecated V1 | **No change**; exempted with a reason (CLAUDE.md: do not extend deprecated systems). Follow-up F-3 |
| A-6 | `components/public/PublicBookingPage.tsx:94`, `components/public/PublicContactPage.tsx:46`, `lib/plugins/strategies/slackPluginStrategy.ts:59`, `lib/services/BookingEmailService.ts:66` | Comments (three record a past migration; one is commented-out code) | Comment | None |

**Count check:** 4 (A-1) + 1 + 1 + 1 + 1 (A-2 to A-5) + 4 (A-6) = 12.

### 3.2 Q-2: the plugin-definition placeholder (21 lines)

All 21 are `"redirect_uri": "${NEXT_PUBLIC_APP_URL}/oauth/callback/<plugin>"`, filled in by `PluginManagerV2.processEnvironmentVariables` (`plugin-manager-v2.ts:145-170`). Action: the loader resolves this one placeholder through `platformOrigin()` (D-6). The JSON files are unchanged. A Preview with the variable unset then gets a real redirect URI instead of the literal placeholder, and a Preview that carries production's value gets its own address (Rule 1b).

### 3.3 Q-3: loopback and `*.vercel.app` literals (14 lines)

| Class | File:line | Action |
|---|---|---|
| Resolver constants | `origins.ts:36` (dev platform), `:49` (dev marketing), `:50` (marketing fallback deployment) | None (the one place allowed) |
| Deprecated V1 | `slackPluginStrategy.ts:256` (popup origin allow-list) | None; exempted (F-3) |
| Comments | `lib/branding/platformSite.ts:135`, `lib/business-os/insight/detectors/catalog/ToilManualBookingEntryDetector.ts:162,176`, `.../WebLinkDeadDestinationDetector.ts:16,22`, `lib/business-os/insight/metrics/snapshots.ts:144`, `lib/email/platformBranding.ts:19`, `lib/services/BookingEmailService.ts:69`, `origins.ts:63,136` | None |

**Count check:** 3 + 1 + 10 = 14.

### 3.4 Q-4: request-derived origins (11 lines)

| # | File:line | Use | Class | Action |
|---|---|---|---|---|
| R-a | `app/api/v2/calibrate/batch/route.ts:5054` | `new URL(req.url).origin \|\| platformOrigin()` is the base of a link **in the calibration result email**. The request origin is never empty, so the resolver never runs. A background run reached on a deployment host would email that host | Emailed link | `platformOrigin()` |
| R-b | `app/api/stripe/create-portal/route.ts:58` | `request.headers.get('origin') \|\| platformOrigin()` is the Stripe billing-portal return URL | Stripe callback | `platformOrigin()` |
| R-c | `app/api/auth/handoff/route.ts:39,60` | CORS / origin check against `marketingOrigin()` | Comparison | None |
| R-d | `app/api/unsubscribe/route.ts:52,56` | Redirect to the consent page on the host the client clicked | Same-host redirect | None (correct by construction) |
| R-e | `app/api/website/booking/create/route.ts:156`, `lib/utils/attribution.ts:296,297` | Parse a session id out of a URL | Parsing | None |
| R-f | `lib/services/AvatarService.ts:123` | Compare an avatar URL with the storage origin | Comparison | None |
| R-g | `middleware.ts:67` | The request host, for subdomain routing | Routing | None |

**Count check:** 1 + 1 + 2 + 2 + 3 + 1 + 1 = 11. Change: 2.

### 3.5 Q-5: `window.location.origin` (26 lines)

| Class | File:line | Action |
|---|---|---|
| Same-origin mechanics (postMessage checks, URL parsing, fetch base, Stripe and Supabase Auth returns to the page itself) | `app/website-preview/[id]/page.tsx:192,213`; `components/business-os/ChatCommandPanel.tsx:508`; `components/settings/BillingSettings.tsx:819`; `lib/client/oauth-handler.ts:134,137`; `lib/plugins/strategies/chatgptResearchStrategy.ts:316,326`; `lib/client/auth-actions.ts:160,219`; `components/payments/PaymentCheckoutButton.tsx:67,68`; `components/website/blocks/PaymentButtonBlock.tsx:102`; `app/site/[subdomain]/book/BookingWidget.tsx:825` | None. The page's own origin is the right answer, and this is exactly the resolver's Rule 0 |
| Shareable links an owner copies to a client | `components/business-os/CustomerAcquisitionList.tsx:153`; `components/business-os/LandingPageWizard.tsx:1416,1465,1499,2052`; `components/business-os/LeadCaptureLinks.tsx:36`; `components/business-os/ShareMenu.tsx:148`; `components/business-os/insight/BeingFoundCard.tsx:266,267` | **Follow-up F-1** (D-15). Correct whenever the owner browses the canonical host. It differs only when they browse an alternate host. Moving these touches 5 client files carrying 12 `console.*` calls |
| Deprecated V1 | `slackPluginStrategy.ts:60` | None (A-5) |
| Comments | `origins.ts:141`, `slackPluginStrategy.ts:59` | None |

**Count check:** 14 + 9 + 1 + 2 = 26.

### 3.6 Q-6: empty-string fallbacks that are addresses (2 of 20)

`app/oauth/callback/[plugin]/route.ts:12` (A-3) and `lib/email/platformBranding.ts:42` (A-4). The other 18 are avatar, favicon, logo, website and privacy-policy **form fields** (for example `app/business-os/settings/page.tsx:385`), not address bases. **Count check:** 2 + 18 = 20.

### 3.7 A3 summary

| | Sites |
|---|---|
| Change in A-2 | A-2, A-3, A-4 (D-7), the Q-2 loader (1 file for 21 URIs), R-a, R-b, plus the resolver itself and the contact-email link (section 4, H-2) |
| Exempt with a reason | A-5 / Q-3 V1 Slack (2 lines, one file) |
| Follow-up | F-1, 9 browser share-link sites |
| Correct as is | 14 browser mechanics, 9 request-origin uses, 18 form fields, every comment |
| Already compliant | 67 files through `origins.ts` |

---

## 4. A4 inventory: the platform domain family and the public-site host

| Query | Pattern | Lines |
|---|---|---|
| Q-8 | `agent[s]?pilot\.(io\|ai\|com\|site)` (case-insensitive; same scope as section 3, plugin definitions excluded) | 69 |
| Q-9 | `grep -n -E 'agentpilot\|"type": "host"' vercel.json` | 2 (`:111`, `:112`, one rule) |
| Q-10 | reads of `NEXT_PUBLIC_PUBLIC_SITE_HOST` | 1 (`origins.ts:261`) |

Q-8 split: **56 lines start as a comment** (after trimming, the line starts with `*`, `//`, `/*` or `{/*`), and **13 do not**:

| # | File:line | What | Class | Action |
|---|---|---|---|---|
| H-1 | `components/business-os/presence-tour/scenes/Ch1Website.tsx:179` | `{subdomain}.agentspilot.com` shown to an owner in the presence tour: a retired domain | UI address | `publicSiteDisplayHost(ctx.subdomain \|\| FAKE.domain)` |
| H-2 | `app/api/contact/route.ts:140`, `:160` | The contact-form confirmation email (HTML link and plain-text sign-off) points at `agentpilot.ai`, missing an "s". That is not our domain | Emailed link | `marketingUrl()`, with the display host taken from it |
| H-3 | `lib/utils/origins.ts:37` | `PROD_PLATFORM_ORIGIN` | Resolver | None |
| H-4 | `app/api/contact/route.ts:74`; `components/onboarding/Onboarding.tsx:281`; `components/onboarding/Onboarding_old.tsx:271`; `lib/business-os/supportContact.ts:21` | Mail **addresses**, not link hosts (two on a retired domain) | Mailbox | Observed, section 19 |
| H-5 | `lib/business-os/automations/agents/draftClientReplies.steps.json:565`, `draftClientRepliesOutlook.steps.json:561` | A sender-domain filter ("not from our own domain") | Mail filter | Observed, section 19 |
| H-6 | `lib/plugins/strategies/chatgptResearchStrategy.ts:86`, `lib/server/chatgpt-research-plugin-executor.ts:322` | Outbound `User-Agent` contact URL on a retired domain | Identification string | Observed, F-4 |
| H-7 | `lib/business-os/catalog/catalog.generated.ts:5248` | A generated column description gives the example `go.agentpilot.io/...` | Generated from the DB | Observed, F-5 |

**Count check (Q-8):** 56 comments + 1 + 2 + 1 + 4 + 2 + 2 + 1 = 69.

**Q-9.** `vercel.json:106-117` rewrites `/:path*` on host `(?<subdomain>[^.]+)\.agentpilot\.io` to `/site/:subdomain/:path*`. Middleware does the same from `publicSiteHost()` (`middleware.ts:107-121`), with the reserved-prefix and one-label checks the JSON rule lacks. Action: delete the `rewrites` block (D-8).

**Q-10.** One read, in the resolver. The host is config-driven already.

**A4 summary:** 3 changes (H-1, H-2, the `vercel.json` rule). September's "~12 places" are now history comments.

---

## 5. A6 inventory: the test and debug surface

Discovery, rerunnable:

```bash
git ls-files 'app/**/route.ts' 'app/**/page.tsx' | grep -v __tests__ \
  | grep -i -E "(^|/)[^/]*(test|debug|lab|demo|mock|seed|sandbox|playground|simulat|dev-|fixture)[^/]*/"
```

That returns 27 paths. The 11 `availability`, `migrate-labels`, `enhance-testimonial` and `plugins/available` hits match only because of substrings ("lab", "test" in "testimonial"), and are not test surface. The 16 that are:

| # | Path | Handlers | Auth today | Hardcoded identity | Action |
|---|---|---|---|---|---|
| T-1 | `app/test-business-os/` (page + `layout.tsx:21`) | page | Open to anyone; has its own in-app sign-in | none | Gate in the layout, before `redirectIfAwaitingPayment()` (`:22`) |
| T-2 | `app/test-plugins-v2/page.tsx` | page | Open | sample session/agent UUID fixtures (`:637-730`), not user ids | New server `layout.tsx` with the gate |
| T-3 | `app/api/test/analyze-prompt/route.ts` | POST `:34` | `getUser()` `:41` | none | Gate |
| T-4 | `app/api/test/generate-agent-v5-test-wrapper/route.ts` | POST `:84` | `getUser()` `:90` | none | Gate |
| T-5 | `app/api/debug/control/route.ts` | POST `:9` | **none**: pauses, resumes or stops any run by id | none | Gate; convert 7 `console.*` |
| T-6 | `app/api/debug/stream/route.ts` | GET `:12` | **none**: streams any run's debug events | none | Gate; convert 6 `console.*` |
| T-7 | `app/api/v2/debug/data-check/route.ts` | GET `:17` | `getUser()` `:20` | **a hardcoded user id** (`:26`, `:30`) returned to any caller | Gate (D-14) |
| T-8 | `app/api/v6/execute-test/route.ts` | POST `:79`, OPTIONS `:214` | `requireAdmin` `:88` | none (the zero-id fallback was removed, `:29`) | Gate (both handlers) |
| T-9 | `app/api/v6/test-direct-generation/route.ts` | POST `:668` | **none**; LLM calls attributed to `'system'` (`:711`, `:753`, `:809`) | `'system'` | Gate |
| T-10 | `app/api/plugins/test-audit/route.ts` | POST `:42` | session identity (`resolveActingUserIdentity`) | none | Gate (D-14); its only caller is the T-2 tester (`lib/client/plugin-api-client.ts:288`) |
| T-11 | `app/api/test-integration-connectivity/route.ts` | Pages-API `default export` (`:6`) | none | none | **Delete** (D-13): an App Router `route.ts` with no named handler never serves |
| T-12 | `app/api/website/analytics/test/route.ts` | POST `:17` | 404 unless `NODE_ENV === 'development'` (`:19`) | none | Exempt (stricter already) |
| T-13 | `app/api/admin/business-os/test/plan-test-clock/route.ts` | POST | `requireAdmin` | none | Exempt (admin tool) |
| T-14 | `app/api/admin/business-os/test/take-credits/route.ts` | POST | `requireAdmin` | none | Exempt (admin tool) |
| T-15 | `app/api/admin/test-account-cleanup/check/route.ts` | GET, POST | `requireAdmin` (×2) | none | Exempt (admin tool, needed in production) |
| T-16 | `app/api/admin/test-account-cleanup/delete/route.ts` | POST | `requireAdmin` | none | Exempt (admin tool) |

**Count check:** 2 pages gated (T-1, T-2), 8 routes / 9 handlers gated (T-3 to T-10), 1 deleted (T-11), 5 exempt (T-12 to T-16). 2 + 8 + 1 + 5 = 16. Of 27 discovery hits, 16 are test surface and 11 are substring matches.

Named and **not** test surface: `app/v2/sandbox/[agentId]/page.tsx` and `app/api/run-agent-sandbox/route.ts` (the product's own sandbox), and `app/business-os/upgrade-modal-demo/page.tsx` (already `notFound()` behind a flag, `:33`). The debug components (`components/debug/*`, `hooks/useDebugStream.ts`) are used only by T-2.

Beyond the measured globs: T-7, T-10 and T-11 are outside the five patterns in the scope quote, but they are the same class of thing (D-14).

**`public/` scanned too (SA N-1).** It served three static test files in production, none referenced by anything but themselves: `public/test-direct-generation.html` (a browser driver for T-9), `public/test-icons.html` and `public/test-pilot-browser.js`. All three are deleted in A-1. The only other mention of `test-icons.html` is a measurement recipe in a closed workplan (`docs/workplans/PERF_BR1A_LANGUAGE_FIRST_FRAME_WORKPLAN.md:762,877`), which stays as a historical record.

---

## 6. One PR or two

**Recommend two, plus a third small one later.**

| PR | Content | Size (estimate) | Env dependency |
|---|---|---|---|
| **A-1** | A6: the gate module, the `requireAdminPage` option, 2 layouts, 8 routes, T-11 deleted, G-9, tests, two `console.*` conversions | ~14 files, ~650 lines with tests | None. Can merge as soon as approved |
| **A-2** | A3 + A4: the resolver precedence, 5 raw readers, the loader, R-a, R-b, H-1, H-2, the `vercel.json` rule, the catalogue rows, the middleware warning, G-8, and shrinking `oneAddressPolicy` | ~20 files, ~700 lines with tests | DevOps steps 0 and 1 (section 15) before merge |
| **A-2b** | The flip from warn-only to a failing Production build (D-5) | 2 files, ~60 lines | After DevOps confirms step 1 on every target |

Why split:
1. **No shared code.** A6 touches the admin gates and test routes. A3/A4 touch `origins.ts` and its callers. Each has its own guard (G-9, G-8).
2. **Different gates.** A-1 can ship now and closes a live exposure (T-5, T-6, T-9 are anonymous on the live target). A-2 has to wait for DevOps to clean up the Preview variables, or every PR preview starts emitting whatever host is configured there (R-1).
3. **A conflict only one half has.** A-2 edits the OAuth callback route, which an in-flight branch is also changing (R-3). A-1 should not wait for that.
4. **Review focus.** A-1 is a security review (admin semantics, 404 behaviour). A-2 is a behaviour review (link precedence, OAuth, email). One combined diff of ~34 files mixes both.
5. Standing preference: one goal per PR, small scopes.

The branch name covers both. RM decides which PR this branch carries and creates the second branch. Recommended order: A-1, then A-2, then A-2b.

---

## 7. The resolver (A3 design)

### 7.1 Reuse, do not add a second resolver (D-2)

`platformOrigin()` already is the "`getAppUrl()`" the scope asks for. It is isomorphic, tested (`lib/utils/__tests__/origins.test.ts`, `origins.inTheBrowser.test.ts`), documented (`docs/WEB_ADDRESSES.md`) and guarded (`oneAddressPolicy.guard.test.ts`). Adding a `getAppUrl()` alongside it would recreate "two answers to one question", which is what that file's header warns against. Proposal: keep the name and change only the rules. There is one new export, `resolvePlatformOrigin()`, which returns `{ origin, source, refused? }` so that callers which need to know *how* the address was found can ask (platformBranding, the middleware warning, tests). `platformOrigin()` becomes `resolvePlatformOrigin().origin`, so its signature and its 63 call lines are unchanged.

### 7.2 Precedence (D-3)

| Rule | Today | Proposed | `source` |
|---|---|---|---|
| 0 | Browser served origin, if the configured value is a loopback or absent | Unchanged | `browser` |
| 1 | Configured `NEXT_PUBLIC_APP_URL`, unless it is a loopback on Vercel | Unchanged, **plus 1b**: on a Preview, a configured value whose host equals the project's production host (`[NEXT_PUBLIC_]VERCEL_PROJECT_PRODUCTION_URL`) or `PROD_PLATFORM_ORIGIN` is refused | `configured`; `refused: 'loopback-on-vercel' \| 'production-host-on-preview'` |
| 2 | On a Preview, the deployment host **outranks** configuration | On a Preview with no usable configured value: the **branch URL** (`[NEXT_PUBLIC_]VERCEL_BRANCH_URL`, stable across a branch's redeploys), then the deployment URL (`[NEXT_PUBLIC_]VERCEL_URL`) | `preview-branch`, `preview-deployment` |
| 3 | Vercel production, nothing usable configured: the project production host, then the constant | Unchanged | `production-host`, `constant` |
| 4 | Not on Vercel: development uses `localhost:3000`, otherwise the constant | Unchanged | `development`, `constant` |

Why the order changes: one configured value is wrong for *every PR preview*, which is the case Rule 2 was written for. It is exactly right for *staging*, which is one branch with one registered address. Vercel scopes a variable to a Preview **branch**, so the variable is set on Preview for `main` only, and PR previews fall through to their branch URL (section 15). Rule 1b makes the PROD-1c requirement true by construction: a Preview never emits production's address, whatever a variable says. The two existing tests that pin "preview outranks configuration" (`origins.test.ts:178-185`, `origins.inTheBrowser.test.ts:100-109`) both configure `PROD_PLATFORM_ORIGIN`, which Rule 1b refuses, so they **pass unchanged**.

### 7.3 What each environment gets

| Where | `NEXT_PUBLIC_APP_URL` | Result |
|---|---|---|
| Local `npm run dev` | localhost from `.env.local` | `http://localhost:3000` (`development`) |
| Jest | usually unset | the constant; tests set what they need |
| PR preview | **absent** (section 15) | `https://<branch alias>` (`preview-branch`) |
| Staging (Preview, branch `main`) | the staging host, or absent (OQ-2) | the staging host (`configured`), or the `main` branch alias |
| Preview carrying production's host by mistake | production host | refused, so the branch alias, and the warning fires |
| Production target | the live host | that host (`configured`) |
| Production, unset or loopback | — | the project production host, else the constant; the warning fires (A-2b: the build fails) |

### 7.4 Server-only vs client

There is one variable, `NEXT_PUBLIC_APP_URL`, inlined at build time for server, edge and browser alike. There is deliberately **no** server-only twin. Two settable addresses for one thing is the PROD-1a A1 lesson (two Supabase addresses). The Vercel system variables are read in both forms, unprefixed on the server and `NEXT_PUBLIC_` in the browser when "Automatically expose System Environment Variables" is on. In the browser, Rule 0 makes that setting irrelevant. New reads: `VERCEL_BRANCH_URL` and `NEXT_PUBLIC_VERCEL_BRANCH_URL`, so they get catalogue rows.

### 7.5 Warn-only (in A-2), and how it flips (A-2b) (D-4, D-5)

**Warn.** `origins.ts` must stay free of a logger, because it runs in the browser and on the edge. The warning lives in `middleware.ts`, which already holds the edge logger (`createEdgeLogger`, `:21`) and sees every request. Once per isolate (a module-level flag), it calls `resolvePlatformOrigin()`. It emits **one** structured `warn` when it is running on Vercel and either of these holds:
- (i) `refused` is set, or
- (ii) `VERCEL_ENV === 'production'` and `source` is `production-host` or `constant`.

The log carries `{ source, refused, vercelEnv }` and never the address itself. This adds no per-request cost after the first request and no new pattern. `source: preview-branch` on a PR preview is normal and does not warn.

**Flip.** This is a code change in A-2b, with **no** switch variable, because a switch is one more thing to forget at cutover. `next.config.js` throws at build when `VERCEL_ENV === 'production'` and `NEXT_PUBLIC_APP_URL` is unset, not `https://`, or a loopback. A failed build never replaces the live deployment, so "throwing" cannot cause an outage. It only stops a misconfigured release. A runtime throw inside `platformOrigin()` is **not** recommended: there are 63 call lines, many in render paths, so a throw becomes a site-wide 500. The middleware warning stays as a backstop.

### 7.6 Callers moved onto the resolver

| Site | Change |
|---|---|
| `connect/route.ts:73` | `authConfig.redirect_uri \|\| platformUrl(\`/oauth/callback/${plugin_key}\`)` |
| `oauth/callback/[plugin]/route.ts:12,33` | Target origin = `platformOrigin()`, computed in `buildPostMessageResponse` (no module-level constant). The popup is served on the redirect URI's host, which is now the same resolver's answer |
| `plugin-manager-v2.ts:153-160` | Inside `replaceEnvVars`, the app-address placeholder is replaced with `platformOrigin()`. Every other placeholder keeps the raw `process.env` lookup. Generic, with no plugin name (D-6) |
| `platformBranding.ts:42` | Logo only when `resolvePlatformOrigin()` has `source === 'configured'` and the origin is `https://` (D-7). The same outcomes as today in every existing test |
| `calibrate/batch/route.ts:5054` | `platformOrigin()` |
| `stripe/create-portal/route.ts:58` | `platformOrigin()` |
| `contact/route.ts:140,160` | `marketingUrl()` / its host |

---

## 8. The public-site host (A4 design)

The host is already config-driven: `NEXT_PUBLIC_PUBLIC_SITE_HOST`, read once (`origins.ts:261`), with the loopback / `lvh.me` refusal off development (`:296`). Middleware routes from it (`middleware.ts:107-121`). Every address an owner sees comes from `publicSiteUrl` / `publicSiteDisplayHost` / `publicSiteSuffix` (12 + 14 + 4 call lines). A-2 finishes it:

1. **H-1**: the tour scene shows `publicSiteDisplayHost(...)`. With the host unset it shows the path form, which is what the published link really is.
2. **`vercel.json`** (D-8). Delete the `rewrites` block. The options, if a platform-level rewrite were still wanted:
   - (a) **Delete (recommended)**: middleware is the single router and already does it from configuration. No new pattern.
   - (b) `next.config.js` `rewrites()` with a `has: [{ type: 'host' }]` built from the variable at build time. This is a sibling of the existing `redirects()`, so low novelty. But it duplicates middleware, and two routers are how the domains drifted.
   - (c) A programmatic Vercel config (`vercel.ts`) that reads the variable. **A new pattern (CLAUDE.md rule 7).** It would replace `vercel.json`, which also carries the crons, `ignoreCommand` and git settings, and is parsed by `lib/cron/__tests__/vercelCrons.test.ts` and G-6. Large blast radius. Not recommended.

   A `vercel.json` rewrite cannot take a variable, so option (a) is also the only one that makes the host config-driven without new machinery.
3. **The domain itself is not decided** (OQ-1). Nothing in A-2 assumes it. When it is chosen, the change is environment only (section 15, step 5), plus `docs/WEB_ADDRESSES.md` § DNS at launch. If the chosen apex is **separate** from the app's (recommended, so tenant pages share no cookie scope with the app), the reserved-prefix rationale in `lib/business-os/reservedPrefixes.ts:5-6` ("siblings on one apex") and `components/website/blocks/AboutBlock.tsx:31` describe a layout that no longer applies. The code stays correct (the reservation is harmless), but the comments need a line. That is recorded for the slice that sets the value.

---

## 9. The test-surface gate (A6 design)

### 9.1 The module

**File:** `lib/security/testSurfaceGate.ts` (new, server-only; `lib/security/` already holds `onboardingVerdict.ts`)

```typescript
/** Null: carry on. A response: return it as is (always a 404). */
export async function testSurfaceRouteGate(logger: AdminGateLogger): Promise<NextResponse | null>;
/** Returns for an admin, or where the surface is open; otherwise calls notFound(). */
export async function testSurfacePageGate(): Promise<void>;
/** Exported for tests and the guard. */
export function isTestSurfaceClosed(env?: NodeJS.ProcessEnv): boolean;
```

`isTestSurfaceClosed()` (D-10, fail-closed) is true when `isProductionDeployment()` is true, **or** when running on Vercel (`VERCEL` set) with a `VERCEL_ENV` that is not exactly `preview` or `development`. A misspelled or empty value therefore closes the surface instead of opening it. Locally and under Jest (`VERCEL` unset) it is false, so the existing route tests are unchanged.

When closed:
- **Route.** Call `requireAdmin(logger)`. A refusal (401 or 403) becomes `NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })`. An admin gets `null` and the route's own auth runs as today.
- **Page.** `await requireAdminPage({ onRefusal: 'notFound' })` (D-11). This is a new **optional** parameter on the existing page gate, and the default (`redirect`) is unchanged. A non-admin and an anonymous visitor get the same 404, which keeps that helper's "same response for both" property. The `admin_page` refusal audit is unchanged.

Admin identity always comes from `AdminAccessService` through these two helpers, never `profiles.role`. The gate is not hand-rolled in any `route.ts`, so admin-authz R2 is not engaged.

### 9.2 Placement

- **Routes:** the gate's `await` is the first `await` in every exported handler, after the logger child and before any body parse or session read:

  ```typescript
  const gate = await testSurfaceRouteGate(requestLogger);
  if (gate) return gate;
  ```

  For T-5 and T-6, which have no logger, the Pino conversion (section 12.3) provides one.
- **Pages:** the layout's first statement is `await testSurfacePageGate();`. T-1 runs it before `redirectIfAwaitingPayment()`. T-2 gets a new `app/test-plugins-v2/layout.tsx` with `export const dynamic = 'force-dynamic'` (the gate reads the session in production; same reason as T-1's `:16-19`).

### 9.3 Behaviour on today's live target (D-17)

Vercel's Production target serves the staging world today, so `VERCEL_ENV` is `production` there. **From the merge, `/test-business-os` and `/test-plugins-v2` are admin-only on the live host.** Its in-app sign-in no longer helps a signed-out visitor, because they get a 404 before the page renders. An admin signs in through the app first. PR previews and local runs are unchanged. Recommendation: accept this, with no opt-out variable (an opt-out is fail-open by definition). OQ-4 asks whether every current tester is an admin.

---

## 10. The guards so this does not come back (G-8, G-9)

Both go into `lib/__tests__/envConfigHardening.guard.test.ts` and its existing one-pass scan (prefilter needles, decode only on a hit, LF/CRLF normalised, POSIX paths). Names and host fragments are built from parts so that the guard does not match itself. Budget: within the suite's existing +1 s.

### 10.1 G-8 (A-2): one app address, no hardcoded host

| Rule | Asserts | Exemptions |
|---|---|---|
| G-8 R1 | No deployed file reads `NEXT_PUBLIC_APP_URL`, `[NEXT_PUBLIC_]VERCEL_URL`, `[NEXT_PUBLIC_]VERCEL_BRANCH_URL` or `[NEXT_PUBLIC_]VERCEL_PROJECT_PRODUCTION_URL` (the read forms from `readPatterns`, so quoted names in comments do not count) | `lib/utils/origins.ts`; `lib/plugins/strategies/slackPluginStrategy.ts` (deprecated V1, PARKED, F-3); each one must still read (self-test) |
| G-8 R2 | `plugin-manager-v2.ts` imports `platformOrigin` from `@/lib/utils/origins`. Every plugin definition that carries the app-address placeholder carries it only in `redirect_uri` | — |
| G-8 R3 | No **non-comment** line carries a scheme-qualified platform-domain, loopback or `*.vercel.app` host | `origins.ts`; `slackPluginStrategy.ts` (V1); the two H-6 `User-Agent` lines until F-4 (pinned by count) |
| G-8 R4 | No non-comment line carries an interpolated subdomain host (`}.` followed by the platform-domain family) | — |
| G-8 R5 | `vercel.json` has no `rewrites`, `redirects` or `headers` entry whose `has` contains `type: "host"` | — |

"Non-comment" means that, after trimming, the line does not start with `*`, `//`, `/*` or `{/*`. **This departs from the suite's C-8 a ruling (no comment stripping)**, and only for R3 and R4 (D-9). The reason: C-8 a protects against a retired *variable name* surviving in a comment, which can mislead a reader into setting it. A host quoted in a history comment hands nobody an address, and 56 such lines document why the code looks the way it does. A trailing comment on a code line still counts. The alternative is a frozen per-file baseline (equality, shrink-only), which is more brittle because every comment edit would need a pin change.

Self-tests: every pattern fires on LF and CRLF on the right line. The lookalikes do not fire: `agentspilot` as a word, a mail address, `marketingUrl(`, and a host in a `*` comment. The JSX shape of H-1 fires. A `vercel.json` sample with a host condition fails R5.

`oneAddressPolicy.guard.test.ts`: its `OAUTH_FILES` shrinks to the V1 Slack file. Its `ALLOWED` loses `platformBranding.ts` if D-7 is taken. Its header note on the two exceptions is updated. Folding it into G-8 is left to SA. Recommendation: keep it (it pins the `|| 'http://localhost` shape and the two client-facing builders) and shrink it.

### 10.2 G-9 (A-1): every test surface is gated

| Rule | Asserts |
|---|---|
| G-9 R1 (discovery) | Every `app/**/route.ts` with a path segment matching `^(test\|debug)$`, `^(test\|debug)[-_]` or `[-_](test\|debug)$`, and every top-level `app/test-*` directory, is either gated (R2 or R3) or in `TEST_SURFACE_EXEMPT` with a reason and a `stillHas` check. Floors: at least 13 routes and 2 page directories found (anti-vacuity) |
| G-9 R2 (route) | The file imports `testSurfaceRouteGate` from `@/lib/security/testSurfaceGate`. The number of `if (gate) return gate` guards equals the number of exported HTTP handlers. In each handler body, the gate's `await` comes before any other `await` |
| G-9 R3 (page) | `app/test-*/layout.tsx` exists, imports `testSurfacePageGate`, and its first `await` is `await testSurfacePageGate()` |
| G-9 R4 (exemptions) | T-12: `stillHas` the development-only 404. T-13 to T-16: `stillHas` `requireAdmin(`. Each exemption's file exists (C-8 e) |

Self-tests: a gated sample passes. These fail, in LF and CRLF:
- a gate placed after `await request.json()`
- a gate imported but never used
- a lookalike name (`testSurfaceRouteGateLegacy`)
- a second handler without the gate
- a layout that awaits something before the gate
- a new `app/api/x/debug-thing/route.ts` sample

---

## 11. Decisions needed from SA

| # | Decision | Dev recommendation |
|---|---|---|
| D-1 | One PR or two | Two (A-1 = A6, A-2 = A3 + A4), then A-2b (section 6) |
| D-2 | New `getAppUrl()` or reuse `platformOrigin()` | Reuse. Add `resolvePlatformOrigin()` for the source; no alias |
| D-3 | Reverse Rule 2: configured beats the preview host; add Rule 1b; prefer the branch URL to the deployment URL | Approve. The existing pinned tests pass unchanged; new tests in 14.2 |
| D-4 | Where the warn-only signal lives | Middleware, warn once per isolate through the edge logger. The alternative, `instrumentation.ts`, needs `experimental.instrumentationHook` on Next 14.2: a new pattern |
| D-5 | How to "flip to throwing" | A build-time assertion in `next.config.js` for Production only (A-2b). No switch variable, no runtime throw |
| D-6 | Plugin placeholder | The loader resolves that one placeholder through the resolver (1 file). The alternative is renaming the placeholder in 21 JSON files |
| D-7 | `platformBranding.ts` | Use `source === 'configured'` and drop its exemption (same outcomes) |
| D-8 | `vercel.json` rewrite | Delete (section 8, option a) |
| D-9 | G-8 R3/R4 skip comment-start lines (departs from C-8 a for hosts only) | Approve; the alternative is a frozen per-file baseline |
| D-10 | Gate predicate | Fail-closed: closed on `production` **or** any unrecognised `VERCEL_ENV` on Vercel |
| D-11 | A 404 for pages | An optional `onRefusal: 'notFound'` on `requireAdminPage` (default unchanged). The alternative is accepting the redirect for pages |
| D-12 | Route gate's refusal audit | Keep `requireAdmin`'s refused-access row for a signed-in non-admin (a probe in production is a signal) |
| D-13 | T-11 (dead Pages-API route) | Delete |
| D-14 | Include T-7 and T-10 (outside the measured globs) | Include |
| D-15 | 9 browser share-link sites | Follow-up F-1 |
| D-16 | Convert T-5 and T-6 to Pino (13 `console.*`) | Convert in A-1 (CLAUDE.md § Logging, flagged in 12.3) |
| D-17 | Test pages become admin-only on today's live target | Accept; no opt-out variable |

---

## 12. Files to create / modify

### 12.1 PR A-1 (A6)

| File | Action | Reason |
|---|---|---|
| `lib/security/testSurfaceGate.ts` | create | The gate (9.1) |
| `lib/security/__tests__/testSurfaceGate.test.ts` | create | Unit tests (14.1) |
| `lib/security/__tests__/testSurfaceRoutes.test.ts` | create | Table test over T-3 to T-10 (14.1) |
| `lib/admin/requireAdminPage.ts` | modify | `onRefusal` option (D-11) |
| `lib/admin/__tests__/requireAdminPage.test.ts` | modify | Cases for the option |
| `app/test-business-os/layout.tsx` | modify | The page gate first |
| `app/test-plugins-v2/layout.tsx` | create | Server layout with the page gate |
| `app/api/test/analyze-prompt/route.ts`, `app/api/test/generate-agent-v5-test-wrapper/route.ts`, `app/api/v2/debug/data-check/route.ts`, `app/api/v6/execute-test/route.ts`, `app/api/v6/test-direct-generation/route.ts`, `app/api/plugins/test-audit/route.ts` | modify | The route gate first (9.2) |
| `app/api/debug/control/route.ts`, `app/api/debug/stream/route.ts` | modify | The route gate first, plus the Pino conversion |
| `app/api/test-integration-connectivity/route.ts` | delete | D-13 |
| `lib/__tests__/envConfigHardening.guard.test.ts` | modify | G-9 |
| `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` | modify | The page-gate option and the test-surface gate as a covered surface |

### 12.2 PR A-2 (A3 + A4)

| File | Action | Reason |
|---|---|---|
| `lib/utils/origins.ts` | modify | `resolvePlatformOrigin`, Rule 1b, branch URL (7.2) |
| `lib/utils/__tests__/origins.test.ts`, `origins.inTheBrowser.test.ts` | modify | New cases; the existing ones stay |
| `middleware.ts` | modify | Warn once (7.5) |
| `app/__tests__/middleware.appUrlWarning.test.ts` | create | Warn-once test (pattern of `app/__tests__/middleware.sessionCookie.test.ts`) |
| `lib/server/plugin-manager-v2.ts` | modify | Placeholder through the resolver (D-6) |
| `lib/server/__tests__/pluginManagerAppOrigin.test.ts` | create | Loader test |
| `app/api/v2/plugins/connect/route.ts` | modify | A-2 |
| `app/oauth/callback/[plugin]/route.ts` | modify | A-3 (after the in-flight change lands, R-3) |
| `lib/email/platformBranding.ts`, `lib/email/__tests__/platformBranding.test.ts` | modify | D-7 |
| `app/api/v2/calibrate/batch/route.ts` | modify | R-a (one line) |
| `app/api/stripe/create-portal/route.ts` | modify | R-b (one line) |
| `app/api/contact/route.ts` | modify | H-2 (G-7 send counts unchanged) |
| `components/business-os/presence-tour/scenes/Ch1Website.tsx` | modify | H-1 |
| `vercel.json` | modify | Delete `rewrites` (D-8) |
| `lib/admin/environment/catalogue.ts` | modify | Rows for `VERCEL_BRANCH_URL` and `NEXT_PUBLIC_VERCEL_BRANCH_URL`; `NEXT_PUBLIC_APP_URL` becomes `exp('R','O','R')` (absent on PR previews by design) |
| `lib/utils/__tests__/oneAddressPolicy.guard.test.ts` | modify | Shrink the exemptions |
| `lib/__tests__/envConfigHardening.guard.test.ts` | modify | G-8 |
| `docs/WEB_ADDRESSES.md` | modify | The precedence, the Preview-per-branch rule, the `vercel.json` removal; Change History row |

### 12.3 PR A-2b (flip)

`next.config.js` (the build assertion) and a test that runs the assertion function on sample environments (`lib/utils/__tests__/appUrlBuildCheck.test.ts`, with the function in `lib/utils/appUrlBuildCheck.js` so `next.config.js` can `require` it).

### 12.4 `console.*` in files these PRs touch (CLAUDE.md § Logging: flagged, conversion proposed)

| File | `console.*` calls | Plan |
|---|---|---|
| `app/api/debug/control/route.ts` | 7 | Convert to `createLogger` + `correlationId` in A-1 (needed for the gate's logger) |
| `app/api/debug/stream/route.ts` | 6 | Same |
| Every other file in 12.1 to 12.3 | 0 | — |
| Deferred with F-1 (not touched here): `components/business-os/LandingPageWizard.tsx` 9, `CustomerAcquisitionList.tsx` 2, `LeadCaptureLinks.tsx` 1 | 12 | Converted when F-1 touches them |

Counts are from `grep -c -E '\bconsole\.[a-z]+\('` on `259a7e21`.

### 12.5 Debt noticed, not extended

- The V1 Slack strategy reads the variable at import and allows a loopback popup origin (F-3, deprecated system).
- `oneAddressPolicy.guard.test.ts` derives relative paths with `ROOT + '/'` (`:104`), which does not strip a Windows path. Dev will run it locally before handing over, and flag it if it is red on Windows only.

---

## 13. Task list

PR A-1:
- ✅ 1. `isTestSurfaceClosed`, `testSurfaceRouteGate`, `testSurfacePageGate`, with unit tests
- ✅ 2. `requireAdminPage({ onRefusal: 'notFound' })` with tests; default path unchanged (B-2)
- ✅ 3. The page gate in T-1, and the new T-2 layout
- ✅ 4. The route gate in T-3, T-4, T-7, T-8 (both handlers), T-9, T-10
- ✅ 5. Convert T-5 and T-6 to Pino, then gate them (D-16, N-10)
- ✅ 6. Delete T-11, and the three `public/` test files (N-1)
- ✅ 7. G-9 and its self-tests; each rule proved red by mutation (13.1)
- ✅ 8. The routes table test; the existing auth tests stay green
- ✅ 9. Doc section; typecheck on the touched files; test subset; `npm run test:authz-guard` suites
- ⬜ 10. B-3 production probe: **STOPPED**, the pages are a 200 with the not-found UI (13.2). Waiting on SA

### 13.1 A-1 implementation notes (Dev, 2026-11-26)

| Item | What was done |
|---|---|
| Gate | `lib/security/testSurfaceGate.ts`. `isTestSurfaceClosed(vercelEnv = process.env.VERCEL_ENV, onVercel = process.env.VERCEL)` (N-3: literal reads, one per parameter). Closed on production, and on Vercel for any value other than exactly `preview` / `development` (D-10). The route gate maps any `requireAdmin` refusal, or a throw, to `{ success: false, error: 'Not found' }` with status 404. The page gate calls `requireAdminPage({ onRefusal: 'notFound' })` with no try/catch around it |
| B-2 | `requireAdminPage(options = {})` with `onRefusal?: 'redirect' \| 'notFound'`, default `'redirect'`. `notFound()` sits next to `redirect()`, after the audit await and outside every try/catch. Identity, logging and the `admin_page` audit are the same code in both modes. The module header gains "The second mode". `app/admin/layout.tsx` is untouched |
| Audit labels | `admin_api` / `admin_page` only; `lib/audit/` untouched (D-12, N-4). The routes table test asserts `surface: 'admin_api'` for a signed-in non-admin |
| Route placement | The gate's `await` is the first `await` of all 9 handlers, after the logger child. T-4, T-7 and T-9 gained a `correlationId` child for it; T-9 gained a module logger (it had none). T-8 keeps its own `requireAdmin` (N-6) |
| T-5, T-6 | 13 `console.*` calls converted to `createLogger` + `child({ correlationId })`, context first, errors as `{ err }`, ids only (N-10). T-5's 500 no longer returns `error.message` to the client: it uses the project error format, with details only in development (CLAUDE.md Security Rules) |
| Deleted | `app/api/test-integration-connectivity/route.ts` (T-11, D-13); `public/test-direct-generation.html`, `public/test-icons.html`, `public/test-pilot-browser.js` (N-1) |
| T-1 ordering test | `lib/business-os/invites/__tests__/paymentHold.test.ts` pinned the payment hold as the first statement of `app/test-business-os/layout.tsx`. It now pins the test-surface gate first and the hold second, with the reason in a comment |
| N-2 | `scanHandlers` lived in `lib/admin/__tests__/admin-authz-surface.guard.test.ts`, not in `tests/helpers/source-scan.ts`, and importing a test file would run its suite twice. It **moved, byte-for-byte**, to `tests/helpers/source-scan.ts` with `matchParen`, `findBodyBrace`, `extractBracedBody`, `findValueParen`, `HTTP_HANDLERS` and `HandlerScan`. The admin guard imports and re-exports it. Admin guard 119/119 before and after the move. **SA please confirm that touching the required-check file this way is acceptable** |
| G-9 | In `lib/__tests__/envConfigHardening.guard.test.ts`, with its own walk of `app/` (names only). R1: discovery of a `test` / `debug` word in any route segment (13 routes: 8 gated + 5 exempt), and of `app/test-*` (2). R2: import plus first `await` in every handler, via `scanHandlers`, comment-stripped and string-blanked. R3: the layout's first statement is the page gate; no `route.ts` under a page segment; every `page` / `template` / `default` / `loading` / `error` / `not-found` under `app/test-*` is `'use client'` or guards itself (B-1). R4: exemptions still on the surface and still have their own check |
| Tests (local, Windows) | New and changed: `testSurfaceGate` and `testSurfaceRoutes` (route table, 9 handlers × 4 cases), `requireAdminPage` (+6 cases), `paymentHold`, `envConfigHardening` (G-9 + self-tests, 97 total), all green. Existing suites, unchanged and green: the three route `auth.test`s, `test-audit` `route.test`, `catalogueDrift`, and the authz-guard pair (admin surface 119, security-definer): 249/249. The one red seen, `lib/security/__tests__/publicEndpointsAreThrottled.guard.test.ts` (3 cases), is a Windows-only path-separator failure (`path.relative` gives backslashes, its keys use `/`) on files this slice does not touch (F-9) |
| Typecheck | Full `npx tsc --noEmit -p tsconfig.json` with an 8 GB heap: it finished (exit 2, 1854 repo-wide errors, no heap or OOM message). **No error in any new line.** The only hits in touched files are 9 in `app/api/debug/control/route.ts` and `app/api/debug/stream/route.ts`, on lines this slice did not change. They call `DebugSessionManager.pause/resume/step/stop/waitForSession/getEvents/subscribe` and `session.state`, none of which exist on that class on `origin/main` either. So both debug routes were already broken at runtime off production (F-8) |
| Mutation proof | Each run went red, then the files were restored from copies (no stash): the gate removed from T-6; the gate moved after `request.json()` in T-10; an `await` put before the page gate in T-2's layout; a new ungated `app/api/zz-debug-probe/route.ts`. The last one first passed, because the segment rule only matched `debug` at a segment's start or end. The rule was widened to a whole word anywhere in the segment, and the discovered set stayed at 13 |

### 13.2 B-3 probe (Dev, 2026-11-26): STOPPED, returned to SA

`next build` (exit 0, CI placeholder env), then `next start` with `VERCEL=1 VERCEL_ENV=production`, no cookies, on a free port. The server was stopped by the PID of its own listening socket (`taskkill /PID <pid> /T /F`), and the port was confirmed closed.

| Target | Status | Body |
|---|---|---|
| `GET /test-business-os` | **200** `text/html` | Not-found UI: `<template data-dgst="NEXT_NOT_FOUND">` inside a client-rendered Suspense boundary. No harness content |
| `GET /test-plugins-v2` | **200** `text/html` | The same. The page's RSC node resolves to `null`, and the harness's visible text (its heading) is absent. Its client chunk is still listed among the preloaded scripts |
| `POST /api/debug/control` (T-5) | **404** `application/json` | `{"success":false,"error":"Not found"}` |
| `GET /api/debug/stream?runId=probe` (T-6) | **404** `application/json` | the same, immediately (no 10 s session wait) |
| `POST /api/v6/test-direct-generation` (T-9) | **404** `application/json` | the same |
| Control: an unknown path | **404** `text/html` | Next's not-found page |

The API routes are a real 404. The two pages are the case B-3 says to stop on: `notFound()` thrown from the segment **layout** yields 200 with the not-found UI streamed, not a 404 status. Following the instruction, the `VERCEL_ENV=preview` control run was **not** performed.

**For SA:**
- Nothing of the harness renders.
- The API routes behind it, which are the boundary (B-1), answer 404.
- The status code is what is wrong.

Options Dev can see, none built:
- (a) A server `page.tsx` that awaits the gate and renders the current client page as a child component. It needs a second probe to show whether a page-level `notFound()` gets a 404 status here.
- (b) A middleware 404 for `/test-*` on production. Middleware runs on the edge and cannot run the admin check (Node-only), so it would be anonymous-only, or admin-less.
- (c) Accept a 200 carrying the not-found UI for the two pages, recorded as such in the admin doc.

PR A-2:
- [ ] 10. `resolvePlatformOrigin`, Rule 1b, branch URL; tests (existing tests unchanged)
- [ ] 11. Catalogue rows and expectation; `catalogueDrift` green
- [ ] 12. Loader placeholder; connect route; OAuth callback (rebased on the in-flight change)
- [ ] 13. platformBranding (D-7), calibrate R-a, create-portal R-b, contact H-2, tour H-1
- [ ] 14. `vercel.json` rewrite removed; `vercelCrons` and G-6 still green
- [ ] 15. Middleware warn-once and its test
- [ ] 16. G-8 with self-tests and mutation proof; shrink `oneAddressPolicy`
- [ ] 17. `docs/WEB_ADDRESSES.md`; typecheck on the touched files; `npm run build`

PR A-2b:
- [ ] 18. The build assertion and its test, after DevOps confirms section 15 step 1

---

## 14. Test plan

All tests are pure or mock their seams. Nothing reaches the network (`tests/jest-no-network.ts`).

### 14.1 A-1

`lib/security/__tests__/testSurfaceGate.test.ts` (`requireAdmin`, `requireAdminPage` and `next/navigation` mocked):

| Case | Expect |
|---|---|
| `VERCEL` unset, `VERCEL_ENV` unset (local) | open; no admin call |
| `VERCEL=1`, `preview` / `development` | open; no admin call |
| `VERCEL=1`, `production`, admin | route: `null`; page: returns |
| `production`, `requireAdmin` returns 401 or 403 | 404, body `{ success: false, error: 'Not found' }`; status is not 401/403 |
| `production`, `requireAdmin` throws | 404 (fail closed) |
| `VERCEL=1`, `VERCEL_ENV` = `Production` / `''` / `staging` | **closed** (D-10) |
| Page, anonymous and non-admin | `notFound()` called; the same for both |

`lib/admin/__tests__/requireAdminPage.test.ts`: the default still redirects (existing cases). With `onRefusal: 'notFound'`: `notFound` for anonymous and non-admin, never `redirect`; the `admin_page` audit row on a "no" only; an admin returns the identity.

`lib/security/__tests__/testSurfaceRoutes.test.ts`: table over the 9 handlers, with `VERCEL=1` and `VERCEL_ENV=production`.
- With `requireAdmin` refusing, every handler answers 404, and none of its mocked dependencies (`getUser`, `PluginManagerV2`, `DebugSessionManager`, `supabaseServer`, the provider factory) is called. That proves the gate runs first.
- With `requireAdmin` admitting, T-8 reaches its own `requireAdmin` path, and T-3 reaches its own `getUser()`.
- Failure path: a 404 for a non-admin. Happy path: an admin passes.

Existing suites that must stay green unchanged (the gate is open under Jest): `app/api/test/analyze-prompt/__tests__/auth.test.ts`, `app/api/test/generate-agent-v5-test-wrapper/__tests__/auth.test.ts`, `app/api/v6/execute-test/__tests__/auth.test.ts`, `app/api/plugins/test-audit/__tests__/route.test.ts`, `lib/business-os/invites/__tests__/paymentHold.test.ts`, `lib/admin/__tests__/admin-authz-surface.guard.test.ts`.

### 14.2 A-2

`origins.test.ts`, new cases:
1. Staging: Preview, configured staging host, branch and deployment hosts present: the configured host wins (`source: configured`).
2. Preview with the configured value equal to `VERCEL_PROJECT_PRODUCTION_URL`: refused, the branch URL is used (`refused: production-host-on-preview`).
3. The same with `PROD_PLATFORM_ORIGIN`.
4. Preview with nothing configured: the branch URL beats the deployment URL.
5. The server-only `VERCEL_BRANCH_URL` is read when the public copy is absent.
6. Production configured: unchanged.
7. Production unset: `production-host`, then `constant`, sources reported.

All 19 existing cases pass unedited. `origins.inTheBrowser.test.ts`: one new case (browser on staging, configured staging host). Its existing preview case passes unchanged (Rule 1b).

Other tests:
- `pluginManagerAppOrigin.test.ts`: on a preview with the variable unset, `redirect_uri` becomes `https://<branch>/oauth/callback/x` (not the literal placeholder). With the variable set to the staging host, it uses that host. A `${OTHER_VAR}` placeholder keeps its raw lookup and placeholder-kept behaviour.
- `middleware.appUrlWarning.test.ts` (edge logger mocked):
  - Production with the variable unset: exactly **one** `warn` across two requests, and its context has no address.
  - Preview with a refused value: one warn.
  - Preview on the branch URL: none.
  - Local: none.
- `platformBranding.test.ts`: the existing 6 cases pass. New: a preview with no configured value gives no logo; a configured https staging host gives the logo.
- The connect route redirect fallback and the OAuth callback target origin: a small assertion each, in the existing test homes or a new co-located test (the callback test home is coordinated with the in-flight change, R-3).
- Guards: G-8 self-tests; `catalogueDrift.guard.test.ts`; `oneAddressPolicy.guard.test.ts`; `lib/cron/__tests__/vercelCrons.test.ts`; G-6 (they parse `vercel.json`); G-7 (the contact route's send counts are unchanged); `components/business-os/presence-tour/__tests__/scenes.render.test.tsx`.

### 14.3 A-2b

The assertion function is tested on these environments:
- production unset: throws
- production `http://`: throws
- production loopback: throws
- production https: passes
- preview unset: passes
- local: passes

The thrown message names the variable and never prints a value.

---

## 15. Environment changes (handed to DevOps)

Names only. Each step follows `env-change-protocol`: verify the exact value deployed, with a probe that can fail.

**PR A-1: none.** `VERCEL_ENV` and `VERCEL` are system variables.

**PR A-2:**

| Step | When | Change |
|---|---|---|
| 0 | Before review ends (read-only) | Report, for `NEXT_PUBLIC_APP_URL`, every target and branch scope that carries it (names and scopes only). Report whether "Automatically expose System Environment Variables" is on. Report which domains are attached to the project, and whether the retired public-site domain is one of them |
| 1 | **Before A-2 merges** | **Preview (all branches):** `NEXT_PUBLIC_APP_URL` absent; remove it if present (R-1). **Preview, branch `main` (staging):** `NEXT_PUBLIC_APP_URL` = the staging stable host (OQ-2), or absent if the `main` branch alias is the staging host. **Production:** `NEXT_PUBLIC_APP_URL` present, `https://`, not a loopback (today's live host). **Development:** none on Vercel; local `.env.local` keeps localhost |
| 2 | Before staging is used for sign-ins | Register the staging host, wherever an address must be pre-registered: each OAuth provider in use on staging (`/oauth/callback/<plugin>`); Stripe Connect in test mode (`/api/payments/stripe-connect/callback`); Supabase Auth Redirect URLs for the staging project (`/auth/callback`, see `docs/WEB_ADDRESSES.md` § Supabase). Without these, staging falls back silently (Supabase) or is refused at the provider |
| 3 | After A-2 deploys | Probes that can fail: (a) Production logs carry **no** app-address warning, and a deliberately wrong Preview build carries one. (b) Staging's admin Environment page shows `NEXT_PUBLIC_APP_URL` set on staging and unset on a PR preview. (c) A plugin connect from staging shows the staging host in the provider's `redirect_uri` |
| 4 | Gate for A-2b | Step 1 verified on Production and on Preview `main`; then A-2b merges. A Production build without the variable will then fail by design |
| 5 | When OQ-1 is decided (not part of these PRs) | `NEXT_PUBLIC_PUBLIC_SITE_HOST` on **Production only** (a staging wildcard on Preview `main` is optional); the wildcard domain on the project; DNS. Remove the retired public-site domain from the project if step 0 finds it attached |

---

## 16. Open questions

| # | Question | Owner |
|---|---|---|
| OQ-1 | **The domain for customers' public sites (wildcard).** Not chosen. Recommended: a registrable domain separate from `agentspilot.ai`, so tenant pages share no cookie scope with the app. A-2 is designed so the choice is pure configuration (section 8.3) | Product owner (via TL), with SA |
| OQ-2 | The staging stable host: Vercel's `main` branch alias, or a staging custom domain? This decides the step 1 value and the step 2 registrations | TL / DevOps |
| OQ-3 | Is `NEXT_PUBLIC_APP_URL` on Preview (all branches) today, and with which host? (Step 0) | DevOps |
| OQ-4 | Is every current tester of `/test-business-os` and `/test-plugins-v2` on the live host an admin? If not, they lose access at the A-1 merge (D-17). **Answered by the user (2026-11-27): yes. The testers are admins only, Barak and Offir for now.** No tester loses access at the merge. See 16.1 for what the gate does off production | ~~TL~~ Answered |
| OQ-5 | The in-flight OAuth callback change: its merge order relative to A-2 | TL / RM |
| OQ-6 | **Off production, the test surface is open to non-admins.** On a Preview (so on staging too, once PROD-3 moves it to Preview `main`), `next dev` and a local `next start`, the gate is off: `/test-plugins-v2` renders for anyone, `/test-business-os` for anyone signed in, and the gated routes answer anyone. A-1 gates production only, as approved, and does not change this. Does the user accept that, or want admin-only off production as a new slice? F-2 (sign-in on Preview, approved) covers part of it for the routes, but not the pages | User (via TL) |

### 16.1 User decisions (2026-11-27)

| # | Decision | Effect on A-1 |
|---|---|---|
| Decision 1 (B-3 / F-10) | **Accepted.** In production the two test pages answer HTTP 200 with the not-found screen (`noindex`, no harness content) until PROD-3 / F-10. The routes keep their real 404 | None. A-1 ships as SA ruled (B-3 option (c)) |
| OQ-4 | **The testers are admins only** (Barak and Offir for now) | None. In production the gate lets admins through, so nobody loses access. **The gating is not admin-only off production, though:** on a Preview, `next dev` or a local `next start`, `isTestSurfaceClosed()` is false and both gates return at once (`lib/security/testSurfaceGate.ts`). `/test-plugins-v2` then renders for anyone, and `/test-business-os` for anyone signed in (signed out, it shows its in-app sign-in), behind only the payment hold. The gated routes are open there too. That is the approved scope (production only). Admin-only off production would be new scope: it overlaps F-2 for the routes and would need the same for the two pages |
| F-2 | **Approved:** require sign-in on T-9 (and the other routes F-2 names) on Preview / staging. **A separate follow-up slice after A-1 merges, not in A-1** | None |
| F-8 | **Decided: delete the broken debugger** (T-5, T-6 and the UI that calls them), **in a follow-up slice, not in A-1**. Corrected by SA 2026-11-27: the earlier entry read "still open". Slice: `docs/workplans/prod-1c-f8-delete-run-debugger-workplan.md` (branch `fix/f8-delete-run-debugger`) | None |
| OQ-6 (open) | **Off production the test surface is not admin-only** (the OQ-4 row above). This is the approved production-only scope, and A-1 does not change it. **Open for the user:** keep it that way, or ask for admin-only on Preview / staging as new scope (that would extend F-2 to the two pages). See OQ-6 in section 16 | None |

---

## 17. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | With configuration now winning on a Preview, a value on Preview (all branches) makes every PR preview emit that host | Step 1 removes it before the merge. Rule 1b refuses production's host anyway. The admin Environment page shows it |
| R-2 | OAuth, Stripe Connect and Supabase sign-in on staging fail until the staging host is registered | Step 2. This is not a regression: staging as Preview `main` does not exist yet |
| R-3 | `app/oauth/callback/[plugin]/route.ts` is changed by an in-flight branch | A-2 rebases on it after it lands (OQ-5). A-1 does not touch it |
| R-4 | Non-admin testers lose the harness on today's live target | OQ-4; an admin signs in first |
| R-5 | `requireAdmin` writes a refused-access row for a signed-in non-admin probing a gated route, which can move the Health "refused access" tile | D-12: intended. An anonymous caller writes nothing |
| R-6 | Removing the `vercel.json` rewrite changes routing | Only for a host the project does not serve (step 0 confirms). Middleware already routes the configured host |
| R-7 | Edge middleware cannot read `VERCEL_ENV` | Then the warning is silent. It has no functional effect, and A-2b's build check does not depend on it |
| R-8 | After A-2b, a Production build fails while the variable is missing | Intended; step 4 orders it. The live deployment is untouched by a failed build |
| R-9 | The loader resolves the placeholder once per instance (singleton) | The resolver is deterministic per deployment on the server; same as today's raw read |
| R-10 | Worktree `node_modules` is a shared junction | No `npm install` / `npm ci`; no `git stash` |

---

## 18. Rollback

There is no migration, and nothing writes data. Each PR reverts on its own.
- **A-1:** revert; the harnesses reopen as today. Nothing in the environment changed.
- **A-2:** revert; Rule 2's old precedence and the raw readers return. Step 1's removal of a Preview (all branches) value is the only environment change that a revert might want undone. Re-adding it restores today's behaviour exactly.
- **A-2b:** revert the assertion. The build no longer checks.
- The `vercel.json` rule comes back with the A-2 revert. It was inert.

---

## 19. Observed, out of scope

| # | Observation | Proposed owner |
|---|---|---|
| F-1 | 9 browser share-link builders use `window.location.origin` instead of `platformOrigin()` (section 3.5). Correct on the canonical host; 12 `console.*` in those files | Follow-up slice |
| F-2 | T-5, T-6 and T-9 stay unauthenticated on **Preview** deployments (the gate covers production only, as approved). T-9 spends LLM money attributed to `'system'` for any caller who can reach a preview | TL: add sign-in or remove. **User approved sign-in on Preview / staging (2026-11-27): a separate follow-up slice after A-1 merges, not in A-1** (16.1) |
| F-3 | V1 Slack strategy: reads the variable at import; allows a loopback popup origin | Deprecated system; with its removal |
| F-4 | Two outbound `User-Agent` strings name a retired domain (H-6) | Small fix, `marketingOrigin()` |
| F-5 | A generated catalogue description gives a retired short-link domain as its example (H-7). The source is a database comment | With the next catalogue regeneration |
| F-6 | Mail addresses on a retired domain in two onboarding components, and the sender-domain filter in two automation step files (H-4, H-5) | Email-domain owner |
| F-7 | `/test-business-os`'s in-app sign-in serves no purpose in production once gated | Test-page owner |
| F-8 | T-5 and T-6 call `DebugSessionManager` methods that do not exist (found by the A-1 typecheck), so the debugger behind `/test-plugins-v2` cannot work anywhere | TL: delete both routes with the debugger UI. **User decided (2026-11-27): delete, in a follow-up slice; out of A-1** (16.1). Slice: `docs/workplans/prod-1c-f8-delete-run-debugger-workplan.md` (branch `fix/f8-delete-run-debugger`) |
| F-9 | `lib/security/__tests__/publicEndpointsAreThrottled.guard.test.ts` fails on Windows only (path separators) | Small test fix |

---

## 20. SA Review Notes

See [SA Review (2026-11-26)](#sa-review-2026-11-26) below.

---

## SA Review (2026-11-26)

**Reviewed by SA, 2026-11-26, on `259a7e21` in this worktree.**
**Status:** ✅ Approved with conditions. A-1 may start now. A-2 is approved as designed, but it does not merge until B-4 to B-9 are met. A-2b gets its own short review when it is opened.

### Verification of the inventory

I reran every query in sections 3 to 5 on `259a7e21`. Each one matches Dev's count: Q-1 12, Q-2 21 files, Q-3 14, Q-4 11, Q-5 26, Q-6 20, Q-7 67, Q-8 69, A6 discovery 27. A broader sweep found no other variable for the app address. It looked for `process.env[...]` reads and for `*_BASE_URL` / `*_SITE_URL` / `APP_ORIGIN` names. The only computed read on the app address is the plugin loader's `process.env[varName]` (`plugin-manager-v2.ts:155`), which D-6 already covers.

Other facts confirmed:
- There is no Pages-router `pages/` tree.
- Both test pages (`app/test-business-os/page.tsx` and `app/test-plugins-v2/page.tsx`) are `'use client'`.
- `debug/control` has 7 `console.*` calls and `debug/stream` has 6. Every other file in 12.1 to 12.3 has 0.
- The catalogue already has rows for `VERCEL` and `VERCEL_ENV`.
- The in-flight OAuth callback change keeps the module-level read of the app address and adds serialisation around it. So R-3 is a real textual conflict, and the "after it lands" order is correct.

**One gap in the inventory.** Discovery scanned `app/**` only. `public/` serves three static test files in production: `test-direct-generation.html` (a UI driver for T-9), `test-icons.html` and `test-pilot-browser.js`. Nothing references them except themselves. See N-1.

### The split (D-1): approved

There are three PRs, in this order: A-1 (A6), then A-2 (A3 + A4), then A-2b. The reasons in section 6 hold:
- The two halves share no code.
- A-1 closes a live anonymous exposure and needs no environment change.
- Only A-2 depends on DevOps sequencing and on the in-flight OAuth branch.

RM carries A-1 on this branch, and creates the A-2 branch from `main` after A-1 merges. Per the standing preference, the user sees and approves each PR when it opens and when it merges. No auto-merge.

### Blocking conditions

**A-1 (before code approval / QA sign-off):**

- **B-1. The page gate is defence-in-depth, and it must be stated and asserted as such.**
  - The `/admin` layout gate can be skipped by a crafted `Next-Router-State-Tree` header (OI-21 in `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md`). That applies to these two new layout gates too. It stays harmless only while every render entry point under the gated segment is a client component with no server props, and the APIs behind it are gated.
  - G-9 R3 must also assert the R8 shape for `app/test-*/**`: every `page` / `template` / `default` / `loading` / `error` / `not-found` is `'use client'`, or awaits the gate as its own first statement.
  - The doc row must say "rendered for admins only in production; the API routes are the boundary". It must not say "admin-only".
- **B-2. The `onRefusal` option on `requireAdminPage` (D-11), with these constraints:**
  - Type it as the union `'redirect' | 'notFound'` with default `'redirect'`. Today's zero-argument call behaves byte-for-byte as before.
  - `notFound()` sits outside every `try/catch`, like `redirect()` (both unwind by throwing). The same applies inside `testSurfacePageGate`: it must not wrap the call.
  - The refusal audit (`admin_page`, on "no" only) and the logging are identical in both modes.
  - `app/admin/layout.tsx` keeps the zero-argument call. Admin guard R6 matches `await requireAdminPage()` with empty parentheses, so it stays green and must not be edited.
  - The module header ("Why a redirect instead of a 403 page") gains a paragraph on the second mode. The BQ-3 invariant now holds per mode: anonymous and non-admin get the same response within a mode. A test asserts this in `notFound` mode.
- **B-3. Prove the 404 is a real 404 status. Jest cannot.**
  - Dev or QA runs a local production-mode probe: `next build`, then `next start` with `VERCEL=1 VERCEL_ENV=production`, with no session.
  - Record the HTTP status for both pages and for T-5, T-6 and T-9. Expect 404 for all of them.
  - Repeat with `VERCEL_ENV=preview` and expect the pages to render. That makes it a probe that can fail.
  - This is a command-line check, not a click-through. It respects the parked-app rule.
  - If the probe shows 200 with the not-found UI (streaming), stop and return to SA.

**A-2 (before merge):**

- **B-4. Precedence (D-3) test hygiene.**
  - The two existing tests that pinned "preview outranks configuration" stay green only because Rule 1b now refuses the value they configure. Their assertions stay unchanged, but their titles and comments must be rewritten to say they pin Rule 1b. The current comment, "The reason configuration cannot win here", becomes false.
  - Add an explicit test that a configured **non-production** host beats both preview hosts (case 1 of 14.2).
  - Rule 1b compares **hosts only**, normalised: lower-cased, scheme and trailing slash stripped, compared both with and without the port.
- **B-5. In the browser, Rule 1b depends on the "expose System Environment Variables" setting.**
  - Without that setting, `vercelEnv()` is null in the browser. A Preview that carries production's value would then still emit it from client components, because Rule 0 only overrides an absent or loopback value.
  - Document this in `docs/WEB_ADDRESSES.md` and pin it with an `origins.inTheBrowser` case.
  - It is acceptable only because step 1 removes the value from Preview. Step 0 must report the setting.
- **B-6. Environment plan.** Section 15 is a hand-off list, not yet an `env-change-protocol` plan.
  - Before A-2 merges, DO writes `## Environment changes` with one change per step. Split step 1 into Preview (all branches), Preview `main`, and Production.
  - Each step states its tier, before-state snapshot, probe, position against the deploy, and rollback. A Production change, if one turns out to be needed, is in the user-executes tier.
  - SA reviews that plan before merge.
  - Step 0 must use non-truncating output (JSON or equivalent) and must **positively** list each scope that carries `NEXT_PUBLIC_APP_URL`. A name missing from a truncated listing is not evidence that it is absent (OQ-3).
  - A-2 does not merge until step 1 is verified on Preview (all branches).
- **B-7. The `vercel.json` deletion (D-8) is gated on step 0.** If step 0 finds the retired public-site domain attached to the project and serving traffic, stop and return to SA before deleting the rule. Removing it would then change live routing.
- **B-8. Order against the in-flight OAuth callback change (OQ-5).** A-2 does not touch `app/oauth/callback/[plugin]/route.ts` while that change is uncommitted elsewhere. The order is the user's call. If the user wants A-2 to land first:
  - drop A-3 from A-2
  - keep that one file's `oneAddressPolicy` exemption
  - add one pinned G-8 R1 exemption naming the file
  - land A-3 as a small follow-up that removes both
- **B-9. G-8 scope and the C-8 a departure (D-9).**
  - R3 and R4 scan **deployed source only**: `lib`, `app`, `components`, `hooks`, `middleware.ts`, `next.config.js`, excluding `__tests__` and `*.test.*`. `scripts/` and `tests/` are out, and the rule text says so.
  - The suite header paragraph "NO COMMENT STRIPPING (C-8 a)" is amended in the same commit, to name the one exception and its reason.
  - The skip is a **line-start check only**, not a comment stripper. A trailing comment on a code line still counts, as Dev proposes.
  - The known false negative (a template-literal line that starts with `*`) is written into a self-test as accepted.

### Non-blocking conditions

- **N-1.** Delete `public/test-direct-generation.html`, `public/test-icons.html` and `public/test-pilot-browser.js` in A-1. Nothing references them. Alternatively, record them as a follow-up with an owner. Either way, list `public/` in section 5 as scanned.
- **N-2.** G-9 R2 reuses the shared scanning primitives in `tests/helpers/source-scan.ts`, the ones the admin guard uses (`scanHandlers`, string blanking). Do not write a second handler parser. The behavioural table test (`testSurfaceRoutes.test.ts`) proves precedence, and G-9 proves presence plus first `await`. Do not escalate the textual rule beyond that (see the admin doc's "STOP HARDENING" entry).
- **N-3.** `isTestSurfaceClosed` reads literal `process.env.VERCEL` and `process.env.VERCEL_ENV`, defaulted per parameter (the `deploymentEnvironment.ts` shape). It does not take a whole `process.env` object, which `catalogueDrift` would need pinned.
- **N-4.** Keep the refusal surfaces as `admin_api` / `admin_page`. Do not add a `test_surface` value. Refusing admin access is what happened, and a new surface would touch `lib/audit/`, which the in-flight branch also edits.
- **N-5.** A gated route answers a JSON 404 (the project error format). An unknown route answers Next's HTML 404, so the two can be told apart. Accepted, because the routes are named in a public repo and concealment is not the goal. Record this in the doc row.
- **N-6.** In production, T-8 runs `requireAdmin` twice (the gate, then its own). This is accepted on a test route. Do not remove T-8's own check.
- **N-7.** On a PR preview browsed by its deployment URL, the OAuth popup's `postMessage` target becomes the branch alias. The message is dropped, and the opener falls back to polling. Note this in `docs/WEB_ADDRESSES.md`. No code.
- **N-8.** For A-2b: a `require` of `lib/utils/appUrlBuildCheck.js` would be the first `require` in `next.config.js`. Keep that file dependency-free and CommonJS. It is re-reviewed with A-2b.
- **N-9.** T-7 (`v2/debug/data-check`) returns a hardcoded identity to any caller. Gating it is enough for A-1. Deleting it is a better follow-up.
- **N-10.** The Pino conversions of T-5 and T-6 use `createLogger` plus `child({ correlationId })`. Context first, errors as `{ err }`, ids only.

### Rulings per decision

| # | Ruling |
|---|---|
| D-1 | ✅ Two PRs plus A-2b, in the order A-1 → A-2 → A-2b (above). |
| D-2 | ✅ Reuse `platformOrigin()`, and add `resolvePlatformOrigin()` returning `{ origin, source, refused? }`. No `getAppUrl()` alias: a second name for one answer is what `origins.ts` exists to prevent. `origins.ts` stays logger-free and isomorphic. |
| D-3 | ✅ with B-4, B-5 and B-6. Configured beats the preview host. Rule 1b refuses production's host on a Preview. The branch URL beats the deployment URL. This is what makes PROD-1c true by construction, and it serves both OQ-2 states without a code change: unset on Preview `main` gives the `main` alias, and set gives the staging custom domain once its DNS is live. The cost is that PR previews now depend on Preview (all branches) carrying no value, which is why B-6 gates the merge. |
| D-4 | ✅ Middleware, warn once per isolate, through the existing edge logger. The context carries no address. `instrumentation.ts` would be a new pattern on Next 14.2, so it is rejected. |
| D-5 | ✅ A build-time assertion in `next.config.js`, Production only, with no switch variable. It is correct, not merely convenient: the variable is inlined at build, so the build is the right witness, and a failed build never replaces the live deployment. A runtime throw in a resolver with 63 call lines, many in render paths, is rejected (a site-wide 500). Re-reviewed with A-2b (N-8). |
| D-6 | ✅ The loader resolves the one app-address placeholder through the resolver. This is generic, with no plugin name, so it breaks no V6 principle. Every other placeholder keeps the raw lookup and its keep-the-placeholder behaviour. The server computes the redirect URI once, and the client and the token exchange both use that string (`oauth-handler.ts:41`, `OAuthTokenService.ts:94`), so they cannot disagree. Pin that in the loader test. |
| D-7 | ✅ `platformBranding` uses `source === 'configured'` plus `https://`, and drops its exemption. |
| D-8 | ✅ Delete the rule (option a), with B-7. Options b and c are rejected: b is a second router, and c is a new pattern with a large blast radius. |
| D-9 | ✅ with B-9. The departure is justified: C-8 a protects against a retired variable **name** that a reader might set again. A host in a history comment configures nothing. A frozen per-file baseline would be more brittle, so it is rejected. |
| D-10 | ✅ Fail closed on `production` **or** on any value outside exactly `preview` / `development` on Vercel. That is the right direction for this gate. It is the inverse of `isProductionDeployment()`'s "unexpected means not production", which fails closed for *its* purpose (keyed sends), and composing the two is correct. `VERCEL_ENV=production` without `VERCEL` also closes, which is what makes the B-3 local probe possible. |
| D-11 | ✅ with B-2. **Is it a new pattern under rule 7? No.** It is an optional parameter on the canonical page gate, with the default unchanged and identity still from `AdminAccessService`, and it is SA-reviewed here, which is what rule 7 asks. It is also consistent with the doc's BQ-3 rationale: a 404 discloses less than a redirect does. The required admin CI guard is not engaged: no `route.ts` imports `AdminAccessService` (R2), the gate lives in `lib/security/`, and `app/admin/layout.tsx` is untouched (R6/R8). |
| D-12 | ✅ Keep `requireAdmin`'s refused-access row for a signed-in non-admin. Anonymous callers write nothing. N-4 applies. |
| D-13 | ✅ Delete T-11. It has a Pages-API default export under the App Router, never serves, and has no references. |
| D-14 | ✅ Include T-7 and T-10. They are the same class, and the scope's "several operate on a hardcoded user id" is T-7. |
| D-15 | ✅ Follow-up F-1. Those sites are correct on the canonical host, and touching them pulls in 12 `console.*` conversions for no A3 gain. |
| D-16 | ✅ Convert T-5 and T-6 to Pino in A-1 (CLAUDE.md § Logging; the gate needs a logger anyway). N-10 applies. |
| D-17 | ✅ Technically accepted, with **no opt-out variable** (an opt-out fails open by definition). From the A-1 merge, the two test pages render for admins only on today's Production target, which serves the staging world. The impact is small while the app is parked with no manual click-through tests, and an admin signs in through the app first. **The user confirms OQ-4 before A-1 merges** (in the PR conversation), because it removes access for any tester who is not an admin. |

### Environment plan (SA check against `env-change-protocol`)

- **A-1:** none. ✅
- **A-2:** 🔄 needs a revision by DO before merge (B-6):
  - One change per step: step 1 bundles four.
  - Each step needs a tier, a before-state, a probe and a rollback.
  - The public-repo rule is met: names and roles only, with no IDs or secret locations.
  - Ordering is right. Step 1 comes before merge, step 2 before staging takes sign-ins, step 3 after deploy, and step 4 gates A-2b.
  - Step 2's registrations (OAuth providers, Stripe Connect test mode, Supabase Auth redirect URLs) are third-party settings. Each one is its own step.

### For the user (via TL)

- **OQ-1.** The customers' public-site domain. Not blocking: A-2 makes the choice configuration only.
- **OQ-4 / D-17.** Is every current tester of the two test pages an admin? Confirm before A-1 merges.
- **OQ-5 / B-8.** The order of A-2 against the in-flight OAuth callback change.
- **F-2.** T-5, T-6 and T-9 stay anonymous on Preview, as the approved scope allows. Once PROD-3 moves staging onto Preview `main`, that means anonymous run control and LLM spend charged to `'system'` on staging. **SA recommends closing F-2 before that cutover.** The fix is either a sign-in requirement on those three routes (one small slice) or DO confirming that Deployment Protection covers every Preview. Owner: TL / user.

### Approval

- [x] Workplan approved. A-1 proceeds to implementation under B-1 to B-3 and N-1 to N-10.
- [ ] A-2 merge: pending B-4 to B-9, and DO's protocol-compliant environment plan reviewed by SA.
- [ ] A-2b: SA review when opened.

---

## SA Code Review (2026-11-27)

**Code review by SA, 2026-11-27: PR A-1, `git diff 259a7e21` plus the untracked files, in this worktree.**
**Status:** 🔄 Fix Required. The fixes are wording and probes only. No logic change is required.

### B-3 ruling: option (c), accept the 200 for the two pages and record it

**Why the pages answer 200.** It is not `loading.tsx`: none exists above these segments. It is not a late flush in the usual sense either. The cause is `components/PlatformChrome.tsx:8-11`, which loads `PlatformShell` through `next/dynamic({ ssr: true })`. In Next 14, `next/dynamic` wraps the component in a Suspense boundary. Neither test path is on the public-surface list, so both render inside it.

During the server render, React catches the `notFound()` thrown in the layout at that boundary, so the shell completes with 200. Next then records the error: it inserts `<meta name="robots" content="noindex">` and renders the not-found screen. The HTTP status is set to 404 only when the error escapes the shell. See `node_modules/next/dist/server/app-render/app-render.js:824`, where 14.2.35 is installed.

**Evidence.** I reproduced this in a minimal app on the same Next 14.2.35 (scratch only, nothing in the repo):

| Where `notFound()` is thrown | Status |
|---|---|
| A nested `force-dynamic` layout (with a slow gate, `cookies()`, an async not-found and a client provider) | **404** |
| A server `page.tsx` | **404** |
| The same root, with children wrapped in a `next/dynamic({ ssr: true })` client component | layout **200**, server page **200**, both with the `noindex` tag and the not-found screen |
| A page outside that wrapper | **404** |

**Would (a) give a 404? No.** A server `page.tsx` that awaits the gate sits under the same `PlatformShell` boundary, and it measured 200. Option (a) adds a file and fixes nothing.

**(b) would give a real 404, but it is rejected for now.** Middleware cannot reach `AdminAccessService` without hand-rolling the admin check at the edge, so (b) has no admin override. That drops the override the approved A6 scope asks for. It would also remove a live-verified admin tool (the take-credits tab on `/test-business-os`) from today's Production target, which serves the staging world.

**(c) is accepted** because the security property holds:
- No harness content renders: the gate throws before `children`.
- Every test and debug route answers a real 404.
- The client chunk that is preloaded is a public static asset of a public repository.
- The `noindex` tag keeps the pages out of search engines.

What is not met is the literal HTTP status on two pages. **Revisit at PROD-3:** once the staging world moves to Preview `main`, production no longer needs admin access to these pages, and (b) can give a real 404. That choice is the user's (see "For the user" below).

**This finding is wider than A-1 (F-10).** Everything under `PlatformShell` is affected: every `notFound()` or `redirect()` thrown during the server render answers 200, never 404 or 307. That includes the `/admin` layout's redirect. By the same mechanism it should be a 200 carrying a meta refresh (`make-get-server-inserted-html.js:42-50`), but I have not probed it. The fix belongs in `PlatformChrome`, which is sensitive for performance (the dynamic import keeps the shell out of public bundles). It is not part of A-1. Owner: TL.

### Required changes

| # | File:line | Change | Priority |
|---|---|---|---|
| FR-1 | `lib/security/testSurfaceGate.ts:16-17`; `app/test-plugins-v2/layout.tsx:5-6`; `app/test-business-os/layout.tsx:11-13`, `:28-29`; `lib/admin/requireAdminPage.ts` header, "second mode" paragraph; `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md:267` and its new Change History row (`:645`, new in this same diff) | Correct every claim that the **pages** answer 404. Say what they actually do: in production a non-admin gets the not-found screen with a `noindex` tag and **no harness content**, but the HTTP status is 200, because `PlatformShell` is loaded through `next/dynamic` (F-10). The **routes** answer a real 404. In `requireAdminPage.ts`, one sentence: `notFound()`, like `redirect()`, cannot set the status for a page rendered inside `PlatformShell`. | Medium |
| FR-2 | `lib/security/testSurfaceGate.ts:28-29` | "every API behind them is gated" is not accurate for `/test-business-os`, which calls the regular Business OS API. Reword: "every API they call enforces its own authorisation, and the test and debug routes do so through this gate". | Low |
| FR-3 | QA report (section 21) | **The B-3 re-probe under (c), plus the preview control run that is still owed.** Production mode (`VERCEL=1 VERCEL_ENV=production`, no session): both pages answer 200, carry the `noindex` tag, and do **not** contain a harness marker string; take one distinctive string per page from the preview run. T-5, T-6 and T-9 answer a JSON 404, and an unknown path answers 404. Preview mode (`VERCEL=1 VERCEL_ENV=preview`): both pages answer 200 **with** their marker and **without** `noindex`. T-3 answers its own 401. T-9 is sent **no body**, so it fails at the parse and never reaches an LLM call, and answers something other than the gate's JSON 404. The not-found screen's text appears in the RSC payload of every page, so it is not a discriminator: use the marker and `noindex`. Record the suite time delta of `envConfigHardening.guard.test.ts` (C-9 budget +1 s). | Medium |

### Review of Dev's notes

1. **Moving `scanHandlers` out of the required admin check is accepted.** I compared what the admin guard lost with what `tests/helpers/source-scan.ts` gained. They are identical apart from `export` keywords and a header comment. The admin guard re-exports them, its parser self-tests stay where they were and still exercise the moved code, and it passes 119/119. This is a refactor that changes no rule, cap or exemption. *Optimisation:* add one line to the moved block saying it is load-bearing for the required admin check, and that any edit runs `npm run test:authz-guard`.
2. **The new order in the `paymentHold.test.ts` layout (gate first, hold second) is accepted.** The SA R-1 / R-2 intent was that no account data is read or shown before the hold decides. The gate reads only the session and the admin answer, and renders nothing.
3. **Widening G-9 to match `test` / `debug` as a whole word of a segment is accepted.** It is stricter than the plan, and the self-tests pin the lookalikes (`testimonial`, `debugger`). A future false positive is handled by `TEST_SURFACE_EXEMPT`, which requires a reason and a `stillHas` check. G-9's own names-only walk of `app/` departs from the suite's one-pass rule (C-9). That is accepted, because only a handful of files are read. FR-3 records the time.
4. **Dropping `error.message` from the control route's 500 is correct** (CLAUDE.md error format). The `details` field is shown only in development.
5. **F-8: delete these routes, do not repair them, and not in A-1.** I confirmed that `pause`, `resume`, `step`, `stop`, `waitForSession`, `getEvents` and `subscribe` do not exist on `DebugSessionManager` (`lib/debug/DebugSessionManager.ts`). So T-5 and T-6 already fail at runtime, and the `/test-plugins-v2` debugger panel is dead. One more detail: the control route creates a stub session *before* the failing call, so on a Preview an anonymous caller can grow that in-memory map (part of F-2). Follow-up, owner TL: delete both routes together with the UI that calls them (`hooks/useDebugStream.ts`, `components/debug/*`, the panel in the tester), unless the user wants the debugger rebuilt. Deleting them also takes T-5 and T-6 out of F-2.
6. **F-9 predates A-1.** I reproduced 3 failures in `publicEndpointsAreThrottled.guard.test.ts` on Windows. The paths are compared with backslashes (`app\api\...`), the same class as the `oneAddressPolicy` Windows note in 12.5. The CI runner is Linux, so A-1 is not blocked. It is a small follow-up.

### Other code review comments

1. `app/api/v6/execute-test/route.ts` OPTIONS — Low, no change. A CORS preflight carries no cookies, so in production every preflight gets the gate's 404, even for an admin. The harness calls this route from the same origin, where browsers send no preflight, so nothing breaks. Accepted, because it is stricter.
2. The gate module, `requireAdminPage` second mode, the 9 handlers and the T-5 / T-6 Pino conversions — no comments:
   - The predicate reads literal env names with defaults per parameter (N-3).
   - `notFound()` is outside every try/catch, and the wrapper does not wrap it (B-2).
   - Unknown `onRefusal` values fall back to redirect.
   - The audit labels are unchanged (N-4).
   - No `console.*` is left in a touched file (0 in each).
   - No new import from the entitlements module.
   - No direct Supabase call is added.
3. B-1 is met: G-9 R3 asserts that every render entry point under `app/test-*` is a client component or guards itself, and that no `route.ts` sits under a test page segment.
4. B-2 is met: the BQ-3 test in `notFound` mode, the audit-parity test, and the zero-argument `/admin` call are all unchanged, and R6 is green.

### Code Approved for QA: Yes, once FR-1 and FR-2 land

SA re-checks only the wording diff. FR-3 is QA's B-3 evidence. A-1 does not go to RM without it.

### Dev: FR-1, FR-2 and the optional note applied (2026-11-27)

No logic changed. Every "the pages answer 404" claim now says what happens: in production a non-admin gets the not-found screen with `noindex` and no harness content, at HTTP 200 (the `next/dynamic` `PlatformShell` boundary, F-10, B-3 option (c)), while the routes answer a real 404.

| # | Where | Now says |
|---|---|---|
| FR-1 | `lib/security/testSurfaceGate.ts` header, "What it does" | Routes: a real HTTP 404 (JSON). Pages: the not-found screen, `noindex`, no content, HTTP 200, with the cause |
| FR-1 | `app/test-plugins-v2/layout.tsx` header | The same, plus "the API routes it calls answer a real 404" |
| FR-1 | `app/test-business-os/layout.tsx` header and the comment above the gate | A non-admin (signed out included) gets the not-found screen at HTTP 200; the in-app sign-in is not reachable there |
| FR-1 | `lib/admin/requireAdminPage.ts` header, "second mode" | "needs a refusal that is a 404" became "not found rather than a redirect". "A 404 discloses less" became "a not-found screen". One new paragraph: neither `notFound()` nor `redirect()` can set the status inside `PlatformShell`; not-found measured 200 with `noindex`; the redirect is expected to be a 200 meta refresh, **not probed**. The function's doc comment no longer says "a 404" |
| FR-1 | `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` § The test and debug surface, and its 2026-11-26 Change History row | The routes give a real 404; the pages give the not-found screen at 200, with `noindex` and no content; F-10; revisit at PROD-3 |
| FR-2 | `lib/security/testSurfaceGate.ts` (OI-21 paragraph); the same sentence in `app/test-plugins-v2/layout.tsx` | "every API they call enforces its own authorisation; the test and debug routes do so through this gate" |
| Optional | `tests/helpers/source-scan.ts`, the moved `scanHandlers` block | Marked as load-bearing for the required admin check (R1): after any edit, run `npm run test:authz-guard` |

F-8 (deleting the debug routes) and F-2 are not built.

**SA re-check (2026-11-27):** ✅ FR-1, FR-2 and the note on the moved parser are accurate, and no "the pages answer 404" claim is left in the touched files or the admin doc. **A-1 code is approved for QA.** RM takes it once QA records FR-3. One condition for RM: the workplan file must go in the same PR, because `lib/admin/requireAdminPage.ts` now cites it for F-10.

### For the user (via TL)

- **The B-3 result:** in production the two test pages show "not found" with no content, but with HTTP 200, not 404. The routes give a real 404. Accept this until PROD-3, then switch the pages to a middleware 404 (no admin access to them in production)? SA recommends yes.
- **F-8:** delete the broken debugger (two routes and its UI) in a follow-up, or rebuild it?
- **F-10 (TL):** the platform-wide 200 for `notFound()` / `redirect()` under `PlatformShell`, including `/admin`.
- Still open from the workplan review: OQ-4 before the A-1 merge, and F-2.

### SA review of the Performance 1 fix (2026-11-27)

**Status:** ✅ Approved. Scope: `lib/__tests__/envConfigHardening.guard.test.ts` (21.1) and section 16.1.

**The guard change.**
1. **No assertion, floor or exemption changed.** The G-9 assertions, the floors (at least 13 routes, at least 2 page directories, at least as many render entries as page directories), the matchers and the five `TEST_SURFACE_EXEMPT` entries are as approved. The test count is still 97.
2. **The cache cannot give G-9 a stale or partial list.** `repositoryTree()` is synchronous and assigns the memo only after every `WALK_DIRS` walk has finished. If a walk throws, the memo is left unset, so nothing partial is stored. Each Jest test file runs in its own module registry, so the memo lasts for one suite run only. `scanRepository()` spreads `sourceFiles` into a new array before it adds the root files and workflows, so it cannot change the shared list. `testSurface()` only calls `.filter` (which makes new arrays) and sorts those copies. Nothing else references `sourceFiles` or `appFiles`.
3. **Order:** a filtered run works because the memo is called lazily, not from the scan's `beforeAll`. I ran the full suite (97/97 pass) and `-t "G-9"` on its own (27 pass, 70 skipped).
4. **Same set, checked independently.** I walked `app/` in a separate Node script with no skip rules. It found 929 non-`__tests__` names, the same 13 routes, and no file under a dot directory or `node_modules`, so the shared walk's skip rules drop nothing that G-9 needs. Dev's fail-proof on `analyze-prompt` (1 red) stands. I did not repeat it.

**Ruling on Performance 1: resolved. It does not block the commit.** The walk that was removed cost about 0.84 s, which accounts for most of QA's +1.20 s. What is left (+0.51 s CPU) is the G-9 tests (about 0.25 s) plus loading `source-scan`, and that is inside the budget. On this machine, wall time cannot resolve a 1 s difference, so the local numbers cannot settle C-9 in either direction. **The first Linux CI run on the PR settles C-9:** RM or QA records this suite's time from that run's Jest output next to the same suite's time on the latest `main` run. If the difference is clearly over +1 s (more than +1.5 s, given the noise in a single run), open a follow-up to make the suite faster. Do not revert G-9 for it.

**Section 16.1.** Decision 1, OQ-4 and F-2 were recorded correctly. **F-8 was recorded wrongly**: it said "still open", but the user decided to delete the debugger in a follow-up. I corrected it in 16.1, in the section 19 row and in the change-history entry. Dev's finding about off production was described accurately in the OQ-4 row, but it was not listed as an open item. I added **OQ-6** to section 16 and a pointer row in 16.1. The scope is unchanged: A-1 gates production only.

**Approved for commit: Yes**, with the conditions already recorded: this workplan goes in the same PR, and the C-9 reading is taken from the PR's first Linux CI run.

---

## 21. QA Testing Report

## QA Report (2026-11-27)

**QA, 2026-11-27, PR A-1 on `fix/prod-1c-app-url-and-test-gating` (uncommitted working tree, base `259a7e21`), after FR-1 / FR-2 and SA's re-check.** No source file changed after the build began. Only this workplan did.
**Test mode:** full, for A-1 only (A-2 and A-2b are not built)
**Strategy used:** C (command-line HTTP probes against a local `next start`, for FR-3 / B-3, which Jest cannot prove) + A/B (the full Jest gate on branch and base, the required admin guard)
**Focus:** security, api, performance (suite time)
**Skipped:** D (click-through). The app is parked for manual tests, and the brief asked for command-line probes only
**Input source:** prompt keywords (SA FR-3, the TL brief)

### Build

`npm run build` with the CI placeholder env from `.github/workflows/build.yml` (`.invalid` hosts, `ci-not-a-real-key` values, `NODE_OPTIONS=--max-old-space-size=6144`). No `.env.local` exists in the worktree. **Exit 0 in 376 s.** `Compiled successfully`, the route table printed in full (it lists `/test-business-os`, `/test-plugins-v2`, `/api/debug/control`, `/api/debug/stream` and `/api/v6/test-direct-generation` as dynamic), and the log has no heap, OOM or V8 stack message. The only error-level lines are the known `DYNAMIC_SERVER_USAGE` lines that pre-existing routes log while page data is collected.

### FR-3 probes

Both servers ran from that build, with the same placeholder env plus the `VERCEL` pair, no cookies and no `x-correlation-id`. Each was stopped by the PID of its own listening socket, after its command line was checked, and the port was confirmed to have no listener afterwards.

**Harness markers** (each page's `<h1>`, unique to it): `Business OS Testing Interface` for `/test-business-os`, `Plugin System Testing Interface` for `/test-plugins-v2`. `noindex` = the `<meta name="robots" content="noindex"/>` tag in the HTML (no `X-Robots-Tag` header in either mode).

**Production mode, `VERCEL=1 VERCEL_ENV=production`:**

| Probe | Expected | Status | Content type | Result |
|---|---|---|---|---|
| `GET /test-business-os` | 200, `noindex`, no marker | 200 | `text/html` | ✅ `noindex` 1; its marker 0, the other page's marker 0; not-found screen ("Page Not Found", `NEXT_NOT_FOUND` digest); no `data-testid="harness…"` |
| `GET /test-plugins-v2` | 200, `noindex`, no marker | 200 | `text/html` | ✅ `noindex` 1; its marker 0; not-found screen; no "User Configuration" panel heading |
| T-5 `POST /api/debug/control` (`{}`) | JSON 404 | 404 | `application/json` | ✅ `{"success":false,"error":"Not found"}` |
| T-6 `GET /api/debug/stream?runId=probe` | JSON 404 | 404 | `application/json` | ✅ the same, immediately |
| T-9 `POST /api/v6/test-direct-generation` (no body) | JSON 404 | 404 | `application/json` | ✅ the same |
| T-3 `POST /api/test/analyze-prompt` (extra) | JSON 404 | 404 | `application/json` | ✅ the same: the gate runs before its own 401 |
| Unknown path `GET /zz-qa-no-such-path-probe` | 404 | 404 | `text/html` | ✅ Next's HTML 404 (told apart from the gate's JSON 404, as SA N-5 accepts) |

**Preview control, `VERCEL=1 VERCEL_ENV=preview`:**

| Probe | Expected | Status | Content type | Result |
|---|---|---|---|---|
| `GET /test-business-os` | 200, marker, no `noindex` | 200 | `text/html` | ✅ marker 1, `noindex` 0, no `NEXT_NOT_FOUND` |
| `GET /test-plugins-v2` | 200, marker, no `noindex` | 200 | `text/html` | ✅ marker 1, `noindex` 0, no `NEXT_NOT_FOUND` |
| T-3 `POST /api/test/analyze-prompt` (no session) | its own 401 | 401 | `application/json` | ✅ `{"success":false,"error":"Unauthorized"}` |
| T-9 (no body) | fails at the parse, not the gate's 404 | 200 | `application/json` | ✅ the route's own envelope, `"issues":[{"level":"fatal","message":"Unexpected end of JSON input"}]`: it failed at `req.json()`, before any LLM call |
| T-5 `POST /api/debug/control` (`{}`) | not the gate's 404 | 400 | `application/json` | ✅ the route's own `{"error":"Missing runId or action"}` |
| T-6 `GET /api/debug/stream?runId=probe` | not the gate's 404 | 500 | (none) | ✅ reaches the handler. The 500 is **F-8**, now seen at runtime: the server logs `TypeError: ….waitForSession is not a function` from the stream route. It predates A-1 |
| Unknown path | 404 | 404 | `text/html` | ✅ |

The control works: every row that was a 404 or a not-found screen in production changes in preview, and both markers appear in preview but not in production. So the production probe could fail.

### Gate diff (full `npm run test:gate`, Windows, local)

| | Suites | Failed suites | Failed tests | Time |
|---|---|---|---|---|
| Branch (working tree) | 2127 | 21 | 31 | 984 s |
| Base `259a7e21` (`git archive` into a scratch dir, `node_modules` junctioned to the shared one) | 2125 | 25 | 35 | 1171 s |

The FAIL lines were deduped by suite path (they print twice), and the failing test titles were deduped and compared too.
- **New failures on the branch: none**, by suite and by test title.
- **Failing only on base: 4.** `tailwind-css-escape.guard`, `BusinessDataExportRepository`, `security-definer-surface.guard` and `jest-gate-check.g8` each fail with `fatal: not a git repository`. That comes from the archive extract, which has no `.git`, and says nothing about the code.
- **Failing on both: the same 21 suites.** These are the known Windows failures (CRLF-sensitive source scans and path separators), including `publicEndpointsAreThrottled.guard` (F-9) and `oneAddressPolicy.guard` (12.5).
- The branch has 2 more suites: `testSurfaceGate` and `testSurfaceRoutes`, both PASS.
- PASS inside the gate run: `envConfigHardening.guard`, `requireAdminPage`, `paymentHold` (plus `.adminGrant`, `Batch`), `admin-authz-surface.guard`, `catalogueDrift.guard`, the three route `auth.test`s and the `test-audit` `route.test`.

### Required admin guard

`npm run test:authz-guard`: **PASS**, 2 suites, 203/203 tests (`admin-authz-surface.guard`, `security-definer-surface.guard`).

### Suite time: `envConfigHardening.guard.test.ts` (C-9, budget +1 s on CI)

Six alternating base/branch runs, one suite each, as reported by Jest. Measured on Windows while another worktree was building:

| | Runs (s) | Mean |
|---|---|---|
| Base (70 tests) | 8.51, 7.63, 7.72, 8.27, 8.21, 8.17 | 8.09 s |
| Branch (97 tests) | 9.34, 9.26, 9.08, 9.36, 9.31, 9.37 | 9.29 s |

The delta is **+1.20 s** (mean). The per-pair deltas run from +0.83 to +1.63 s. In `--verbose`, the G-9 tests themselves take about 0.25 s (R2 124 ms, R3 entry points 110 ms). The rest is set-up outside the timed tests: the extra `app/` walk, and loading the shared `source-scan` helper. See Performance 1.

### Test coverage

| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| B-3 / FR-3: in production the pages answer 200 with `noindex` and no harness content (option (c)) | ✅ | Pass | Probe table above, markers named |
| B-3 / FR-3: T-5, T-6, T-9 answer a JSON 404 in production; an unknown path answers 404 | ✅ | Pass | T-3 also checked |
| B-3 / FR-3: the preview control renders both pages without `noindex`; T-3 answers its own 401; T-9 fails at the parse | ✅ | Pass | The probe can fail |
| A gated route answers a JSON 404, the unknown path an HTML 404 (N-5) | ✅ | Pass | |
| `npm run build` succeeds, with no OOM | ✅ | Pass | 376 s |
| No new Jest gate failures | ✅ | Pass | 0 new; the 4 base-only failures come from the extract |
| The required admin guard stays green (B-2, N-2 move) | ✅ | Pass | 203/203 |
| Happy path (admin passes) + failure path (non-admin 404) | ✅ | Pass | `testSurfaceGate` and `testSurfaceRoutes` in the gate run (Jest, mocked admin). There was no admin session for the live probe, by design |
| C-9 suite budget | ⚠️ | Partial | +1.20 s locally against a +1 s budget on CI (Performance 1) |
| Entitlements registration | n/a | — | No import from `lib/business-os/entitlements/` in the diff |

### Issues found

#### Bugs (must fix before commit)

None.

#### Performance issues (should fix)

1. **`envConfigHardening.guard` grew by about 1.2 s locally (budget +1 s on CI).** This is measured on Windows, on a loaded machine, so it is not the CI number. The G-9 tests take about 0.25 s, so most of the cost is set-up. Ask SA to rule using the suite time on the PR's first Linux CI run, against the same suite on main. If it is over there too, the cheap lever is reusing the suite's existing walk for G-9's `app/` names. Severity: Low.
   **Fixed by Dev (2026-11-27):** G-9 no longer walks `app/` a second time. The suite's one directory walk now also records every `app/` file name (any extension), memoised in `repositoryTree()`, and G-9 filters that list (dropping `__tests__` paths, which its own walk skipped). Measurements and the fail-proof are in 21.1.

#### Edge cases / observed (nice to fix, not A-1)

1. **F-8 confirmed at runtime.** On preview, `GET /api/debug/stream` answers 500 (`waitForSession is not a function`). It is already queued for deletion.
2. **T-9 sends `err.message` to the client.** On preview it returns the raw parse error in `issues[].message` and `error`, and a hardcoded `model` label. This predates A-1, and the route is now closed in production. It is part of F-2 (T-9 on Preview).

### Test outputs / logs

```text
build:    exit=0 secs=376   ✓ Compiled successfully
prod:     /test-business-os 200 noindex=1 marker=0 | /test-plugins-v2 200 noindex=1 marker=0
          T-5 404 json | T-6 404 json | T-9 404 json | T-3 404 json | unknown 404 html
preview:  /test-business-os 200 noindex=0 marker=1 | /test-plugins-v2 200 noindex=0 marker=1
          T-3 401 | T-9 200 "Unexpected end of JSON input" | T-5 400 | T-6 500 (F-8)
gate:     branch 21 failed / 2127 suites, base 25 / 2125; new on branch: 0
authz:    Test Suites: 2 passed; Tests: 203 passed
```

### Final status

- [x] All A-1 acceptance criteria pass. FR-3 is met and nothing blocks the commit.
- [ ] Before RM: SA's C-9 ruling on Performance 1 (non-blocking, Low), and the user's OQ-4 confirmation before the merge, as already recorded. SA's RM condition stands: this workplan goes in the same PR.

### 21.1 Dev: Performance 1 fix (2026-11-27)

**Change.** `lib/__tests__/envConfigHardening.guard.test.ts` only. `walk()` takes an optional second list, which gets every file name under `app/`. `repositoryTree()` runs the walk once and memoises it. `scanRepository()` takes a copy of its source files, and G-9's `testSurface()` filters its `app/` names. The memo also covers a filtered run: `-t G-9` skips the scan's `beforeAll` and still passes, 27/27. The G-9 walker `walkAll` is gone. No assertion, floor, matcher or exemption changed.

**Same files found.** A temporary test, since removed, rebuilt the old `walkAll` result next to the new `testSurface()`. They are equal: 13 routes, 2 page directories, 4 page files and 929 `app/` names. The removed test is byte-identical to the file before it was added (`cmp`).

**Timings.** Windows, in a session with other worktrees' Node processes running. Wall time swung by ±15 s between identical runs, so it cannot show a 1 s change. Three sets of numbers:

| Measure | origin/main | Before the fix | After the fix |
|---|---|---|---|
| The removed work alone: G-9's walk of `app/` (15 runs, median) | n/a | 837 ms (first run 1,201 ms) | 2.5 ms (filtering the shared list) |
| In-band Jest process CPU time, all three suites run in this worktree (4 rounds, median) | 15.42 s | 16.28 s (+0.86) | **15.93 s (+0.51)** |
| Jest `Time:`, `origin/main` from a `git archive` extract (5 rounds, median) | 17.13 s | 20.55 s | 22.67 s |

The CPU row is the comparable one. All three suites ran in this worktree, which carries a 2,817-file `.next/` that the `git archive` extract lacks, so Jest's crawl costs both the same. Against `origin/main`, the suite is now **+0.51 s, inside the +1 s budget**. The wall-time row is noise: within a single round the order flipped from run to run. The first Linux CI run is still the number SA rules on.

**The guard can still fail.** With the gate's two lines removed from `app/api/test/analyze-prompt/route.ts`, the suite went red with 1 failure, 96 passing: `app/api/test/analyze-prompt/route.ts: POST: the first await is not await testSurfaceRouteGate(…) followed by if (gate) return gate`. The lines were put back by edit, and the file is byte-identical to the copy taken before (`cmp`). The suite is green again.

---

## 22. Commit Info

*(RM to populate.)*

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-11-26 | Workplan created (Dev) | Fresh inventory on `259a7e21`: A3 Q-1 12 / Q-2 21 / Q-3 14 / Q-4 11 / Q-5 26 / Q-6 2 of 20; A4 Q-8 69 (56 comments, 13 code) plus 1 `vercel.json` rule; A6 16 surfaces (10 gated, 1 deleted, 5 exempt). Recommends two PRs (A-1 = A6, A-2 = A3 + A4) plus A-2b; 17 decisions for SA; 5 open questions |
| 2026-11-26 | A-1 implemented (Dev) | Gate, `requireAdminPage` second mode, 2 layouts, 9 handlers, T-5/T-6 to Pino, T-11 and 3 `public/` files deleted, G-9, tests; `scanHandlers` moved to the shared helper (N-2). B-3 stopped: the pages answer 200 with the not-found UI, the routes a real 404 (13.2). Not committed |
| 2026-11-26 | SA review: approved with conditions (SA) | Counts re-verified on `259a7e21` (all match); `public/` static test files found (N-1). Split approved (A-1 → A-2 → A-2b). A-1 proceeds under B-1 (the page gate is defence-in-depth; G-9 asserts client-only entry points), B-2 (`onRefusal` constraints; not a new pattern; admin guard R6 untouched), B-3 (a local 404-status probe). A-2 merge waits on B-4 to B-9, including DO's protocol-compliant environment plan. All 17 decisions ruled; OQ-1, OQ-4, OQ-5 and F-2 go to the user |
| 2026-11-27 | SA code review of A-1: fix required, wording only (SA) | B-3 ruled (c): the two pages answer 200 with the not-found screen and `noindex` because `PlatformShell` loads through `next/dynamic`, whose Suspense boundary absorbs `notFound()`. Reproduced on Next 14.2.35 in a scratch app; option (a) also measured 200; (b) to be revisited at PROD-3. FR-1 / FR-2 correct the "404" wording; FR-3 is the re-probe plus the preview control run, for QA. The `scanHandlers` move was verified identical and accepted; F-8 delete in a follow-up; F-9 predates A-1; F-10 (platform-wide 200 under `PlatformShell`) to TL |
| 2026-11-27 | FR-1 / FR-2 applied (Dev) | Wording only, 6 files plus this doc: the pages answer 200 with the not-found screen (`noindex`, no content), the routes a real 404; "every API behind them is gated" corrected; the `scanHandlers` block marked load-bearing for the required admin check. Touched suites rerun. Not committed |
| 2026-11-27 | QA report for A-1: PASS (QA) | Build exit 0 (376 s, no OOM). FR-3 production probe: both pages 200 with `noindex` and no harness marker; T-5, T-6, T-9 (and T-3) a JSON 404; unknown path 404. Preview control: both pages 200 with the marker and no `noindex`; T-3 401; T-9 failed at the parse. Full gate: 0 new failures (the 4 base-only failures come from the `git archive` extract having no `.git`). `test:authz-guard` 203/203. `envConfigHardening` +1.20 s locally against a +1 s CI budget, Low, for SA. F-8 seen at runtime on preview |
| 2026-11-27 | User decisions recorded (Dev, via TL) | Decision 1 (B-3 / F-10): the 200 not-found on the two test pages in production is accepted until PROD-3 / F-10. OQ-4 answered: the testers are admins only (Barak and Offir). Production gating matches; off production the surface stays open to non-admins, as scoped (16.1). F-2 approved as a separate slice after A-1 merges. F-8: delete the debugger in a follow-up, out of A-1 (corrected by SA 2026-11-27; this entry first read "still open"). Section 16.1 added; OQ-4, F-2 and F-8 rows updated |
| 2026-11-27 | QA Performance 1 fixed (Dev) | G-9 reuses the suite's one directory walk (memoised `repositoryTree()`); its own `app/` walk is removed. The set of files found is the same (13 / 2 / 4 / 929). The removed walk took 837 ms; it is now a 2.5 ms filter. Same-tree CPU against `origin/main`: +0.51 s (was +0.86), inside the +1 s budget. The guard still fails with one route's gate removed. Not committed (21.1) |
| 2026-11-27 | F-8 slice pointer added (Dev) | F-8 is built in its own slice, `docs/workplans/prod-1c-f8-delete-run-debugger-workplan.md` (branch `fix/f8-delete-run-debugger`): T-5 and T-6 deleted with the debugger UI. The 16.1 and section 19 F-8 rows now point at it. Everything else here is the record of A-1 and is unchanged |
