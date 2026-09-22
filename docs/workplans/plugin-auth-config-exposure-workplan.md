# Workplan: Plugin auth_config Secret Exposure (SECURITY)

**Developer:** Dev
**Requirement:** No BA requirement MD — security defect found by QA during the Business OS plugin-profile cycle (PR #59), verified 2026-09-19 against a local dev server. SA decision 4 confirmed proceeding without one; **this workplan is the record.**
**Branch:** `fix/plugin-auth-config-exposure` (worktree `C:\Users\Barak\My Projects\AgentsPilot\neuronforge-plugin-secrets`, cut from `origin/main` 124cfadb)
**Date:** 2026-09-20
**Status:** Code Complete — awaiting SA code review
**Severity:** P0 — unauthenticated disclosure of platform OAuth client secrets and the live Stripe secret key

---

## Vulnerability

`GET /api/plugins/available` required **no authentication** and returned each plugin definition's complete
`plugin.auth_config` object, **after** `PluginManagerV2` had substituted `${ENV_VAR}` placeholders with real
process env values (`lib/server/plugin-manager-v2.ts:150-169`).

Verified on a cookie-less request (2026-09-19):

| Plugin | Field | Observed |
|---|---|---|
| `google-calendar`, `google-analytics`, `google-business-profile` | `auth_config.client_secret` | real 35-char value (`GOOGLE_CLIENT_SECRET`) |
| `stripe` | `auth_config.client_secret` | real 107-char value — the definition maps this field to `${STRIPE_SECRET_KEY}` |
| `business-os` | `auth_config.client_secret` | 8-char value (the literal `"platform"`, non-secret) |

Before PR #59 narrowed plugin loading to the Business OS profile, **all 28 definitions** were exposed this way.

Grounding measured from `lib/plugins/definitions/*.json` (28 definitions):

- `auth_config` keys present: `auth_type`(28), `client_id`(28), `client_secret`(28), `redirect_uri`(28),
  `auth_url`(28), `token_url`(28), `required_scopes`(28), `profile_url`(27), `refresh_url`(24),
  `token_expiry_seconds`(8), `requires_pkce`(4), `profile_method`(2), `_scope_note`(2), `uses_basic_auth`(1),
  `token_format`(1), `profile_headers`(1), `user_scopes`(1), `supports_express_account`(1),
  `additional_params`(1), `oauth_callback_profile_params`(1).
- Env-substituted keys: `client_id`(21), `client_secret`(21), `redirect_uri`(21). **Stripe's `client_secret` is
  `${STRIPE_SECRET_KEY}` — a full-privilege live API key, not an OAuth client secret.**

**Out of scope:** rotating the leaked secrets (user action, and the highest-priority item of this whole cycle —
`STRIPE_SECRET_KEY` first), and redesigning the plugin definition format (SA decision 8 → follow-up F2).

---

## Analysis Summary

### What this touches

- One unauthenticated API route (`app/api/plugins/available`) — the primary secret-bearing egress.
- Two further egress points that leak the same data through a **class instance** rather than a literal
  `auth_config:` property (`PluginDefinitionContext` aliases the cached definition and `NextResponse.json`
  stringifies it) — found by SA, missed by the original audit.
- One browser consumer chain: `lib/client/plugin-api-client.ts` → `lib/client/oauth-handler.ts`, which builds the
  OAuth authorize URL client-side and therefore legitimately needs a small subset of `auth_config`.
- One adjacent unauthenticated route (`app/api/llm/context`) that leaked *per-user* connection state via a
  caller-supplied `userId` — no secrets, but an IDOR.
- Two dead endpoints, **deleted** rather than hardened (user decision).
- No database, no migration, no provider-factory change.

### Leak-path audit (corrected after SA review)

Legend — **Disposition**: 🔴 fixed · 🟠 fixed (adjacent) · 🗑️ deleted · 🟡 hardened · ✅ already safe, regression test added.

| # | Path / symbol | Auth before | What crossed the boundary | Secrets? | Severity | Disposition |
|---|---|---|---|---|---|---|
| 1 | `GET /api/plugins/available` (`route.ts:35`) | **none** | `auth_config` **in full**, env-substituted | **Yes — `client_secret` for every plugin, incl. `STRIPE_SECRET_KEY`** | **P0 Critical** | 🔴 Sanitised + `getUser()` + Zod + no-store |
| 2 | `lib/client/plugin-api-client.ts:345-351` → `:91` | n/a (browser) | consumed #1's `auth_config` | received the secret | High (consumer) | 🔴 Retyped to `ClientSafeAuthConfig`; 401 handled with an actionable message |
| 3 | `lib/client/oauth-handler.ts:40-57, 220-237` | n/a (browser) | reads `auth_url`, `client_id`, `redirect_uri`, `required_scopes`, `user_scopes`, `requires_pkce` | no | — | 🟡 Defines the allow-list; `OAuthConfig` = `ClientSafeAuthConfig`; 15 `console.*` → `clientLogger` |
| 4 | `GET /api/llm/context` | **none**; trusted `?userId=` | that user's connected + disconnected plugin names and `auth_url` | No secrets, **cross-user data** | High (IDOR) | 🟠 `getUser()`, session-derived userId, Zod, 3 `console.*` → Pino |
| **5** | **`GET /api/user/plugins:84-95`** — **row #14 of the original table was WRONG** | ✅ session | `_meta.connectedPluginData`: raw `PluginDefinitionContext[]`, whose `plugin.auth_config` stringifies with the real `client_secret` of every connected plugin | **Yes** | **High** | 🗑️ **Route DELETED** (user decision; superseded SA's one-line projection). Zero live callers |
| **6** | **`POST /api/analyze-prompt-clarity:445,466`** | **none** (`:287` falls back to an `x-user-id` header or `'anonymous'`) | both 500 fallback bodies spread the same raw `PluginDefinitionContext[]` | **Yes** | **High** | 🟠 Both bodies projected via `toShortLLMContext()`. Full auth hardening + 51 `console.*` = follow-up F4 |
| 7 | `POST /api/plugins/suggest` | **none** | plugin keys only, but called GPT-4o on anonymous input with no validation and no `try/catch` | No | Medium (LLM spend/abuse) | 🗑️ **Route DELETED** (user decision; superseded SA decision 3's hardening). Zero live callers |
| 8 | `PluginDefinitionContext` (`lib/types/plugin-definition-context.ts`) | — | the shared cause of #5 and #6: constructor aliases `definition.plugin`; class had no `toJSON` | Yes, by serialisation | High (systemic) | 🔴 `toJSON()` added — sanitises `auth_config` for every current and future serialiser |
| 9 | `GET /api/plugins/user-status:147-180` | ✅ session identity | hand-picked fields; `auth_type` + `auth_url` only | No | — | ✅ In the egress sweep |
| 10 | `POST /api/v2/plugins/connect` | ✅ `getUser()` | server-built `authUrl` (`client_id` + `state`) | No | Low | 🟡 Zod added; full `authUrl` removed from the `info` log (it embeds `user_id` in `state`) |
| 11 | `GET /api/plugins/action-schema` | none, *by design, documented* | action metadata, projected field by field | No | — | ✅ In the egress sweep |
| 12 | `GET /api/plugins/schema-metadata` | ✅ | action param metadata | No | — | ✅ No change |
| 13 | `POST/PUT /api/plugins/additional-config` | ✅ | reads `plugin.additional_config`; echoes submitted data | No | — | ✅ No change |
| 14 | `GET /api/plugins/fetch-options` | ✅ | `options` array | No | — | ✅ No change |
| 15 | `POST /api/plugins/test-audit` | ✅ | `{success:true}` | No | — | ✅ No change |
| 16 | `GET /api/plugins/execute` (catalogue) | none | key, name, action names | No | — | ✅ In the egress sweep |
| 17 | `POST /api/plugins/execute` | ✅ | execution result | No | — | ✅ No change |
| 18 | `GET/POST /api/plugin-connections` | ✅ | `has_access_token` boolean only | No | — | ✅ Confirmed safe |
| 19 | `app/api/agent-creation/process-message:209-228` | ✅ | `{name, context}` via `toShortLLMContext()` | No | — | ✅ No change |
| 20 | `app/api/v6/compile-workflow:125-128` | ✅ | plugin **keys** array | No | — | ✅ No change |
| 21 | `app/api/generate-agent-v4:210-218` | ✅ | builds `loadedPluginContexts` with `plugin: ctx.plugin` but passes it only into the generator (SA verified it is not in the response at `:390`) | No | — | ✅ Verified-safe-but-fragile; now covered by #8's `toJSON` if it ever is serialised |
| 22 | `app/oauth/callback/[plugin]/route.ts` | server-only | uses `auth_config` server-side for the token exchange; returns none of it | No | — | ✅ No change |
| 23 | **Corrected row #19 of the original table**: client components fetching #1 — `components/v2/Footer.tsx`, `app/(protected)/settings/connections/page.tsx`, `app/test-plugins-v2/page.tsx`, `app/test-business-os/page.tsx` | inherited #1 | whatever #1 returned | inherited | — | 🟡 All four verified session-backed. **Correction:** `V2Footer` is imported **only** by `app/v2/layout.tsx` — it does **not** render on the public booking pages, which makes the auth gate safer, not riskier |
| 24 | Server components serialising a `PluginDefinition` into client props | — | **none found** (SA independently confirmed) | No | — | ✅ Verified |
| 25 | `generateSkinnyLLMContextByPluginName` | — | returns whole definitions — but has **zero consumers**, and mutates cached definitions (`action.rules = {}`) | latent | — | ✅ Left alone → follow-up F7 |

**Also recorded:** `whatsapp-business-plugin-v2.json`'s `auth_config.additional_params.config_id`
(`${WHATSAPP_CONFIG_ID}`) has **no consumer anywhere** (SA re-confirmed), so excluding it from the allow-list
carries no regression risk.

### Root cause

Two shapes of the same mistake, both fixed at the shape rather than the site:

1. **A typed public contract that included the secret.** `PluginInfo.auth_config: PluginAuthConfig`
   (`lib/types/plugin-types.ts:373`) made `auth_config: definition.plugin.auth_config` look correct to both the
   compiler and the reviewer. Fixed by a **branded** wire type only the sanitiser can mint.
2. **A class instance handed to `JSON.stringify`.** `PluginDefinitionContext` aliases the cached definition and had
   no `toJSON`, so routes leaked secrets without ever writing the words `auth_config`. Fixed by adding `toJSON()`.

---

## Implementation Approach (as built)

### 1. One shared sanitiser — `lib/plugins/sanitize-plugin-definition.ts`

- `CLIENT_SAFE_AUTH_CONFIG_FIELDS` — the 7-field allow-list, the single source the tests assert against.
- `sanitizeAuthConfig()` — builds a **new** object field by field. No spread, no `delete`, no iteration over the
  input's keys, so an unknown or future field cannot appear in the output. Arrays are copied (`.slice()`), because
  the definitions live in a process-wide `Map` for the lambda's lifetime and other code already mutates them in
  place — aliasing `required_scopes` would be a cross-request corruption vector.
- `sanitizePluginDefinition()` / `toClientPluginInfo()` — the projections routes and `toJSON` use.
- Malformed input (missing config, wrong types) degrades to empty values rather than throwing: a sanitiser that can
  crash a route invites someone to skip it.

**Allow-list** (unchanged from the approved plan): `auth_type`, `auth_url`, `client_id`, `redirect_uri`,
`required_scopes`, `user_scopes`, `requires_pkce`. Everything else is excluded — see
[PLUGIN_CLIENT_SAFE_CONTRACT.md](/docs/PLUGIN_CLIENT_SAFE_CONTRACT.md).

### 2. Enforcement, not documentation (SA comments 4 + 5)

- **Compile time:** `ClientSafeAuthConfig` carries a required `unique symbol` brand. A narrow type would have
  enforced nothing — `PluginAuthConfig` is structurally assignable to a 7-field subset and the excess-property check
  only fires on fresh literals. With the brand, `auth_config: definition.plugin.auth_config` is a compile error.
  The brand is type-only, so the wire shape is unchanged. Locked by a `@ts-expect-error` assertion under ts-jest.
- **Runtime:** `PluginDefinitionContext.toJSON()` returns a sanitised `plugin.auth_config`. Precondition checked
  before adding it: no caller round-trips a context through `JSON.parse(JSON.stringify(...))` expecting
  `auth_config` to survive (SA found none; Dev re-grepped and confirmed). Server-side reads are unaffected — the
  token exchange still sees the real secret, asserted in the sweep test.

### 3. Routes

| Route | Change |
|---|---|
| `available` | `getUser()` 401; Zod on the query (`includeBusinessOs` as `'true' \| 'false'`, so a typo 400s instead of silently hiding plugins); `toClientPluginInfo()`; `correlationId` child logger; `Cache-Control: private, no-store` + `Vary: Cookie`; **`error.message` removed from the production 500 body** (SA comment 6) |
| `llm/context` | `getUser()` 401; identity from the session; a caller-supplied mismatching `userId` is ignored **and logged at warn**; Zod; 3 `console.*` → Pino; no-store |
| `v2/plugins/connect` | Zod on the body (replacing the truthiness check); full `authUrl` removed from the `info` log. Nothing else restructured (SA comment 7) |
| `analyze-prompt-clarity` | Both 500 bodies now `connectedPluginsMetaData.map(p => p.toShortLLMContext())` — projection only, exactly as scoped |

### 4. Deletions (user decision, superseding SA decision 3 and its `user/plugins` projection)

Verified dead by repo-wide grep before deleting — including the URL string literals, not just imports:

| Deleted | Why it was safe |
|---|---|
| `app/api/user/plugins/route.ts` | self-declared deprecated in favour of `/api/plugins/user-status`; secret egress (#5) |
| `app/api/plugins/suggest/route.ts` | unauthenticated anonymous GPT-4o proxy (#7) |
| `components/wizard/Step3Plugins.tsx` | the **only** caller of both routes, and itself has **zero importers** — the wizard chain hangs off the disabled `app/(protected)/agents/new/page.tsxold`, which does not even reference it |

No live caller exists for any of the three. Remaining references are documentation only
(`docs/AGENT_EXECUTION_FLOW.md`, the identity-hardening workplan), which the guard test deliberately does not scan.
**Judgement call flagged for the user:** deleting `Step3Plugins.tsx` was not explicitly requested. It was the only
thing referencing the two deleted URLs, so leaving it would have meant a component whose every fetch 404s and a
guard test that cannot assert "no source references the removed routes". Trivial to restore from git if unwanted.

### 5. `console.*` conversions (user decision 1)

| File | Before | After |
|---|---|---|
| `app/api/llm/context/route.ts` | 3 | 0 — `createLogger` + `{ err }`, `correlationId` child logger |
| `lib/client/oauth-handler.ts` | 15 | 0 — `clientLogger`, structured context. The `private debug` field existed only to gate `console.log` and was removed (the logger handles levels) |
| `components/v2/Footer.tsx` | 13 | unchanged — read only, never modified (CLAUDE.md: don't reformat files you aren't working on) |
| `app/api/analyze-prompt-clarity/route.ts` | 51 | unchanged — two-line projection only; conversion deferred to F4 per SA decision 9 and accepted by the user |
| `app/api/user/plugins/route.ts` | 5 | n/a — file deleted |

---

## Files Created / Modified (as built)

| File | Action | Reason |
|---|---|---|
| `lib/plugins/sanitize-plugin-definition.ts` | create | Allow-list sanitiser, branded `ClientSafeAuthConfig`, `toClientPluginInfo` |
| `lib/plugins/__tests__/sanitize-plugin-definition.test.ts` | create | 39 tests: kitchen-sink guard, array copies, brand `@ts-expect-error`, all 28 definitions |
| `lib/testing/plugin-secret-matcher.ts` | create | Shared matcher: env-seeded sentinels + forbidden key names + secret value shapes |
| `app/api/plugins/available/route.ts` | modify | Sanitiser + auth + Zod + correlationId + no-store + production 500 fix |
| `app/api/plugins/available/__tests__/route.test.ts` | create | 8 tests: 401, allow-list, visibility scoping, 400, headers, prod 500 |
| `app/api/llm/context/route.ts` | modify | Auth, session-derived identity, Zod, Pino |
| `app/api/llm/context/__tests__/route.test.ts` | create | 6 tests incl. the IDOR lock |
| `app/api/plugins/__tests__/no-secret-egress.test.ts` | create | 10 tests: cross-route sweep incl. both `analyze-prompt-clarity` 500 paths + the `toJSON` choke point |
| `app/api/plugins/__tests__/dead-plugin-routes-removed.guard.test.ts` | create | 6 tests: the deletions stay deleted |
| `lib/types/plugin-definition-context.ts` | modify | `toJSON()` serialisation choke point |
| `lib/types/plugin-types.ts` | modify | `PluginInfo.auth_config` → branded `ClientSafeAuthConfig` (server `PluginAuthConfig` untouched) |
| `lib/client/plugin-api-client.ts` | modify | Retyped auth config; actionable 401 error for the non-auth-gated test pages |
| `lib/client/oauth-handler.ts` | modify | `OAuthConfig` = `ClientSafeAuthConfig`; 15 `console.*` → `clientLogger` |
| `app/api/v2/plugins/connect/route.ts` | modify | Zod body; `authUrl` out of the log |
| `app/api/analyze-prompt-clarity/route.ts` | modify | Two 500-path projections |
| `docs/PLUGIN_CLIENT_SAFE_CONTRACT.md` | create | The client-safe contract (SA decision 4b — mandatory) |
| `app/api/user/plugins/route.ts` | **delete** | Secret egress, deprecated, no live caller |
| `app/api/plugins/suggest/route.ts` | **delete** | Anonymous LLM-spend proxy, no live caller |
| `components/wizard/Step3Plugins.tsx` | **delete** | Only caller of both; zero importers |

No migrations. No provider-factory changes. No repository changes. Plugin definitions untouched (SA decision 8).

---

## Task List

- [x] **1.** Confirm branch `fix/plugin-auth-config-exposure`, `npm ci` complete
- [x] **2.** SA review — approved with conditions, no second workplan round
- [x] **3.** `lib/plugins/sanitize-plugin-definition.ts` — allow-list, **branded** type (SA 4), **copied arrays** (SA 8), no `additional_config` (SA 9)
- [x] **4.** Sanitiser unit tests — kitchen-sink guard, unknown-field drop, brand `@ts-expect-error`, all 28 definitions
- [x] **5.** Rewrite `available/route.ts` — auth + Zod + correlationId + sanitiser + no-store + **production 500 fix** (SA 6)
- [x] **6.** `available` integration tests — 401, sanitised 200, `includeBusinessOs` regression, 400, headers, prod 500
- [x] **7.** Retype `PluginInfo.auth_config`, `plugin-api-client`, `OAuthHandler.OAuthConfig`; tsc clean for touched files
- [x] **8.** `lib/client/oauth-handler.ts` 15 `console.*` → `clientLogger` (user decision 1)
- [x] **9.** Harden `app/api/llm/context/route.ts` (auth, session identity, Zod, Pino) + tests
- [x] **9a.** ~~Project `auth_config` out of `/api/user/plugins`~~ → **route DELETED** (user decision supersedes)
- [x] **9b.** Project both 500 fallback bodies in `analyze-prompt-clarity` (SA comment 2)
- [x] **9c.** `PluginDefinitionContext.toJSON()` (SA comment 5), after re-grepping for JSON round-trip clone users
- [x] **9d.** ~~Harden `/api/plugins/suggest`~~ → **route DELETED** (user decision supersedes SA decision 3)
- [x] **9e.** Delete `components/wizard/Step3Plugins.tsx` (orphaned sole caller of both deleted routes)
- [x] **10.** `v2/plugins/connect` — Zod body (SA 7) + `authUrl` out of the log
- [x] **11.** Cross-route egress sweep incl. `analyze-prompt-clarity` (both 500 paths) + `llm/context`, sentinels seeded via `process.env` (SA 12)
- [x] **11a.** Guard test that the deleted routes stay deleted (user decision, system-initializer style)
- [x] **12.** Graceful logged-out behaviour for the two non-auth-gated test pages (SA 11) — see QA notes
- [x] **13.** `npm test` / tsc / ESLint / build — results recorded in the Implementation Report below
- [x] **14.** [PLUGIN_CLIENT_SAFE_CONTRACT.md](/docs/PLUGIN_CLIENT_SAFE_CONTRACT.md) written (SA decision 4b)
- [ ] **15.** SA code review → QA → user approval → RM (Dev makes **no** commits)
- [ ] **16.** TL to open follow-ups F1-F7 (SA requirement)
- [ ] **17.** **User: rotate the exposed secrets** — `STRIPE_SECRET_KEY` first, then every `*_CLIENT_SECRET`

---

## Test Plan (as executed)

### A. Sanitiser unit tests — `lib/plugins/__tests__/sanitize-plugin-definition.test.ts` (39 tests ✅)

1. **Kitchen-sink guard** — every excluded key seen in the 28 definitions plus 12 invented secret-ish keys and a
   `future_secret_field`, each with a `SENTINEL_<KEY>` value: none survives, and `Object.keys(result)` ⊆
   `CLIENT_SAFE_AUTH_CONFIG_FIELDS`.
2. Allow-listed values preserved exactly; absent optionals omitted rather than emitted as `undefined`/`null`.
3. **Array aliasing** — mutating `result.required_scopes` / `user_scopes` does not touch the source arrays.
4. Malformed/missing config degrades instead of throwing.
5. **Brand** — a `@ts-expect-error` assertion that a raw `PluginAuthConfig` is *not* assignable to
   `ClientSafeAuthConfig`. Under ts-jest this fails if the brand is ever weakened (the directive becomes unused).
6. All 28 shipped definitions: no excluded key survives, and no `${*SECRET*}` placeholder reaches the wire shape.

### B. Route tests

`lib/testing/plugin-secret-matcher.ts` is shared by every route test and fails a response that contains
(a) any sentinel seeded into `process.env`, (b) any forbidden key **name** — which is what catches an empty-env dev
box where `${STRIPE_SECRET_KEY}` survives verbatim — or (c) a secret-shaped value
(`sk_live_`/`sk_test_`/`sk-…`/`GOCSPX-`/an unsubstituted `${*SECRET*}`). It has its own self-test so it cannot pass
vacuously.

| Suite | Tests | Covers |
|---|---|---|
| `available/__tests__/route.test.ts` | 8 ✅ | 401 signed out (and the registry is never touched); no secret for an authenticated caller; allow-listed keys only; the fields clients *do* use survive; `includeBusinessOs` default-hide + opt-in (PR #59); 400 on `?includeBusinessOs=maybe`; `private, no-store` + `Vary: Cookie`; production 500 body carries no `details` |
| `llm/context/__tests__/route.test.ts` | 6 ✅ | 401 signed out (context never built); **IDOR lock** — a victim's `userId` never reaches the manager and the attempt is logged at warn; works with no `userId`; 400 on a malformed one; no-store; production 500 |
| `plugins/__tests__/no-secret-egress.test.ts` | 10 ✅ | matcher self-test; `available`, `llm/context`, `user-status`, `action-schema`, `execute` (catalogue, both modes); `analyze-prompt-clarity` **success + both 500 paths**; and `PluginDefinitionContext.toJSON` — including the assertion that server-side `context.plugin.auth_config.client_secret` is **still** the real value, so the token exchange is unaffected |
| `plugins/__tests__/dead-plugin-routes-removed.guard.test.ts` | 6 ✅ | the three deleted files stay absent, their route directories are gone, no source file references the removed URLs or component, the replacement route still exists, and the literal check can actually fail |

### C. Manual verification (for QA — Dev cannot run these)

Requires a logged-in session and real OAuth credentials, so these are QA/user steps:

| # | Check | Expected |
|---|---|---|
| 1 | `curl -s -i http://localhost:3000/api/plugins/available` with **no cookie** | `401`, no plugin data |
| 2 | Same with a session cookie, grepped for `client_secret`/`sk_`/`GOCSPX-` | zero matches |
| 3 | `/settings/connections` | plugin cards render; connect buttons unchanged |
| 4 | **Connect a Google plugin** (browser popup → `oauth-handler`) | authorize URL carries the right `client_id`/`scope`/`redirect_uri`; full round-trip connects |
| 5 | Connect a PKCE plugin (Airtable) and, if reachable, Slack (`user_scope`) | unchanged |
| 6 | Business OS channel-card connect (`/api/v2/plugins/connect`) | unchanged |
| 7 | `/test-plugins-v2` and `/test-business-os` Modules tab, logged **in** | plugin lists unchanged (`?includeBusinessOs=true` still returns BOS plugins) |
| 8 | **Same two pages logged OUT** (SA 11 — behaviour change) | debug panel shows `Not signed in - sign in to load the plugin registry`; no blank crash, no unhandled rejection |
| 9 | V2 Footer plugin strip logged in, then a public booking page logged out | strip renders when authed; no 401 noise when anonymous (Footer self-guards) |

---

## Acceptance Criteria

1. ✅ No API response contains `client_secret`, an `sk_`/`sk_live`/`sk_test`/`sk-` value, a `GOCSPX-` value, or any
   other excluded `auth_config` field — enforced by the matcher across every route in the leak table.
2. ✅ The `auth_config` fields crossing the boundary are exactly the allow-list, enforced **by construction**; a new
   secret-bearing field in a definition cannot leak without editing the allow-list.
3. ✅ `GET /api/plugins/available` 401s without a session and is otherwise unchanged in shape.
4. ⏳ Plugin connect works end-to-end on both OAuth paths incl. PKCE and Slack `user_scope` — **QA manual check 4-6**.
5. ✅ `includeBusinessOs` scoping from PR #59 behaves identically (locked by test).
6. ✅ `/api/llm/context` no longer serves another user's connection state, authenticated or not.
7. ✅ **No response from the deleted `/api/user/plugins` or from `/api/analyze-prompt-clarity` (including its two 500
   paths) contains any excluded `auth_config` field** (SA addition).
8. ✅ **An un-sanitised `auth_config` cannot be assigned to the wire type — proven by a `@ts-expect-error` test**
   (SA addition).
9. ✅ Every touched file: Pino not `console.*`, Zod at the boundary, `@/` imports, CLAUDE.md API-route pattern with
   `correlationId`.
10. ✅ `tsc` introduces no new error in a touched file; `npm test` introduces no new failure vs `main` 124cfadb;
    ESLint clean on changed files; `next build` succeeds.
11. ✅ Client-safe contract documented.

---

## Risk / Rollback

| Risk | Status after implementation |
|---|---|
| A client needed a removed field | Allow-list derived from the only two browser consumers; every excluded field re-grepped for a browser reader (none). An OAuth URL missing a param would fail loudly at QA check 4, not silently. |
| Requiring auth breaks a caller | All four callers verified session-backed. **Known, accepted behaviour change:** `/test-plugins-v2` and `/test-business-os` are not auth-gated by middleware, so a logged-out visit now shows an error state instead of the plugin list (SA 11) — handled with an explicit 401 message rather than a generic failure. The gate is a separately revertable hunk; the sanitiser is the load-bearing fix. |
| `PluginInfo` retype fallout | `tsc` shows no new error in any touched file (2038 pre-existing errors repo-wide, unchanged). |
| `toJSON` changes an existing consumer's expectations | Re-grepped: no `JSON.parse(JSON.stringify(context))` round-trip depends on `auth_config`. Server-side field access is unaffected — asserted in the sweep test. |
| Deleting `Step3Plugins.tsx` was broader than asked | Zero importers; restorable with one `git checkout`. Flagged for the user. |
| Fix creates false comfort | **The leaked secrets remain valid until rotated.** Out of scope here; `STRIPE_SECRET_KEY` is the highest priority, and the repo is public, so treat git history as compromised too. |

**Rollback:** one branch, no migrations, no data change. The sanitiser, the auth gate, the `toJSON` choke point, the
`llm/context` hardening and the deletions are separable hunks; the sanitiser and `toJSON` are the two that must
survive any partial rollback.

---

## Implementation Report (Dev)

### Deviations from the approved plan

| # | Deviation | Why |
|---|---|---|
| 1 | `/api/plugins/suggest` and `/api/user/plugins` **deleted** rather than hardened/projected | User decision, explicitly superseding SA decision 3 and SA comment 1's one-line fix. Both verified to have no live caller. |
| 2 | `components/wizard/Step3Plugins.tsx` also deleted | Sole caller of both deleted routes; zero importers. Needed for the guard test to be meaningful. Flagged as a judgement call. |
| 3 | `uuid` is mocked in the egress sweep | `uuid` ships ESM only and Jest does not transform `node_modules`; `analyze-prompt-clarity` imports it. The mock keeps the suite about egress rather than module formats. |
| 4 | `OAuthHandler.debug` field removed | It existed solely to gate `console.log`; `clientLogger` handles levels. |
| 5 | The shared secret matcher lives in `lib/testing/`, not under `__tests__` | `jest.config.js` `testMatch` collects **every** `.ts` under `__tests__`, so the helper was reported as "a suite with no tests" — caught by the baseline diff. `lib/testing/` is the repo's existing home for shared test helpers (`GenericTestSystem.ts`). |

### Verification results

**New / changed suites — 69 tests, all passing:**

| Suite | Tests |
|---|---|
| `lib/plugins/__tests__/sanitize-plugin-definition.test.ts` | 39 ✅ |
| `app/api/plugins/__tests__/no-secret-egress.test.ts` | 10 ✅ |
| `app/api/plugins/available/__tests__/route.test.ts` | 8 ✅ |
| `app/api/llm/context/__tests__/route.test.ts` | 6 ✅ |
| `app/api/plugins/__tests__/dead-plugin-routes-removed.guard.test.ts` | 6 ✅ |

**`npm test` (full suite) vs `main` 124cfadb** — baseline captured by stashing this branch's changes in the same
worktree and re-running, so the comparison is like-for-like:

| | Baseline 124cfadb | This branch | Delta |
|---|---|---|---|
| Failed suites | 21 | 21 | **0** |
| Failed tests | 129 | 129 | **0** |
| Passed tests | 4,944 | 5,013 | **+69** (exactly the new tests) |
| Total tests | 5,131 | 5,200 | +69 |

Failing-suite name sets are **identical** (`comm` diff empty in both directions) — the 21 red suites are
pre-existing (V6 compiler, pilot transforms, feature flags, orchestration). No test was fixed or broken by this
work. The one transient regression during development — the shared matcher being collected as an empty suite —
was caught by this diff and fixed (deviation 5).

**TypeScript:** `npx tsc --noEmit` reports 2,041 errors repo-wide, all pre-existing (`next.config.js` ignores TS
errors, per CLAUDE.md § Build). **Zero** errors in any of the 15 files this branch creates or modifies — verified
file by file, not inferred from the total. Movement versus the pre-change run (2,038):

- **−1** — the one error this work did introduce, in the first cut of `toJSON()` (`this & {...}` not assignable
  to `Record<string, unknown>`): found and fixed.
- **+4** — in `.next/types/app/api/{plugins/user-status,generate-clarification-questions,test-integration-connectivity}/route.ts`.
  These are **Next-generated** route validators (`tsconfig.json` includes `.next/types/**/*.ts`) that appeared
  only because `next build` regenerated them during this verification. They flag routes exporting non-route
  symbols (`pluginStatusCache`, `buildClarifySystemPrompt`) in files this branch does not touch — a pre-existing
  smell, separate concern.

Note: `tsc` OOMs at the default heap on this repo — it needs `NODE_OPTIONS=--max-old-space-size=8192`.

**The brand was verified by experiment, not assumed.** A scoped `tsc` run under the project's own `tsconfig.json`
with a positive and a negative control:

| Assignment | Result |
|---|---|
| raw `auth_config` → `ClientSafeAuthConfig` (branded) | ❌ `TS2322: Property '[CLIENT_SAFE_BRAND]' is missing` |
| raw `auth_config` → `ClientSafeAuthConfigFields` (identical 7 fields, unbranded) | ✅ **compiles** |

That second row is SA comment 4's point made concrete: the unbranded version originally proposed would have
enforced nothing.

⚠️ **Near-miss worth recording:** the first version of the brand test had explanatory prose whose comment line
*began* with the directive name, so TypeScript parsed it as a second, genuinely unused `@ts-expect-error` —
`TS2578` in a full-project `tsc` run, while `ts-jest` stayed green. Caught by re-running `tsc` after the final
edit instead of trusting the earlier run. The prose was reworded and now warns the next editor.

**ESLint:** every new file and every rewritten route lints **clean** (0 problems). The 47 `no-explicit-any` errors
reported across the partially-touched files (`plugin-types.ts`, `plugin-definition-context.ts`,
`plugin-api-client.ts`, `oauth-handler.ts`) are all pre-existing lines; this branch adds no `any` and
`plugin-api-client.getPluginAuthConfig` actually **removes** one (`Promise<any>` → `Promise<ClientSafeAuthConfig>`).

> ⚠️ **Pre-existing tooling defect found (not fixed here — it is a config change):** `npm run lint` /
> `next lint` cannot run in this repo. `eslint.config.js` exports an **eslintrc-shaped** object
> (`{ extends: [...] }`) as if it were a flat config, so ESLint 9 matches no files and reports
> *"File ignored because no matching configuration was supplied"* for everything, while `next lint` (Next 14)
> finds no `.eslintrc*` and drops into its interactive setup prompt. The valid `eslint.config.mjs` sitting beside
> it is shadowed. Linting above was therefore run as `npx eslint --config eslint.config.mjs`. **Effectively, lint
> has been a no-op repo-wide.** Recommend a follow-up (F8) to delete `eslint.config.js`.

**Build:** `next build` exits **0**. `/api/plugins/available` and `/api/llm/context` compile as dynamic routes;
`/api/user/plugins` and `/api/plugins/suggest` are absent from the route manifest, confirming the deletions.
Build warnings (dynamic-server-usage during static analysis, Google Fonts fetch failures offline, Stripe ConnectJS
SSR notice) are pre-existing and unrelated.

**Not verified by Dev:** the live OAuth round-trips and the logged-out page behaviour — they need a session and
real provider credentials. See § Test Plan C for QA.

### For QA

1. The manual matrix in § Test Plan C — especially checks 4-6 (real OAuth round-trips), which no automated test
   in this repo covers.
2. **Behaviour change to verify deliberately:** logged-out `/test-plugins-v2` and `/test-business-os` now show an
   error state instead of a plugin list.
3. `/api/llm/context` has no UI consumer (its client wrapper `PluginAPIClient.getLLMContext()` has zero callers),
   so the hardening cannot be exercised through the UI — use `curl` with and without a cookie.

---

## Suggested Commit Message

```
fix(security): stop leaking plugin OAuth secrets to clients

/api/plugins/available required no authentication and returned each plugin
definition's full auth_config after PluginManagerV2 substituted the ${ENV}
placeholders - so an anonymous request received the real Google OAuth client
secret and the live STRIPE_SECRET_KEY. Two further routes leaked the same
values without ever naming auth_config: PluginDefinitionContext aliases the
cached definition and had no toJSON, so serialising an instance emitted the
secrets (/api/user/plugins, and both 500 fallbacks in analyze-prompt-clarity).

Fix the shape rather than the call sites:

- lib/plugins/sanitize-plugin-definition.ts projects auth_config through an
  explicit allow-list (auth_type, auth_url, client_id, redirect_uri,
  required_scopes, user_scopes, requires_pkce), copying field by field so a new
  secret-bearing field cannot leak by default, and copying arrays so a wire
  object cannot mutate the process-cached registry.
- ClientSafeAuthConfig is branded with a unique symbol only the sanitiser mints,
  so assigning a raw auth_config is a compile error, not a silent leak. A narrow
  type alone enforced nothing: PluginAuthConfig is structurally assignable to a
  subset and the excess-property check only fires on fresh literals.
- PluginDefinitionContext.toJSON() sanitises auth_config, closing the
  accidental-serialisation class for every current and future route.

Also: require a session on /api/plugins/available (all four callers already had
one) with Zod on its query and no internals in its production 500 body; derive
identity from the session in /api/llm/context, which served any user's
connection state to an anonymous caller via ?userId=; add Zod to
/api/v2/plugins/connect and stop logging an authorize URL that embeds user_id.

Delete two dead endpoints instead of hardening them - /api/user/plugins
(deprecated, and the second secret egress) and /api/plugins/suggest
(unauthenticated GPT-4o proxy) - plus their only caller, the orphaned
components/wizard/Step3Plugins.tsx. A guard test keeps them deleted.

Tests: 69 new, covering the allow-list (incl. a kitchen-sink guard that feeds
every secret-ish key and a @ts-expect-error that locks the brand), a
cross-route egress sweep with sentinels seeded through process.env, and the
IDOR lock. No change to the repo's pre-existing test failures.

NOTE: the exposed secrets stay valid until rotated - STRIPE_SECRET_KEY first.
Rotation is tracked separately.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

## SA Review Notes

**Reviewed by SA — 2026-09-20**
**Status:** 🔄 Revision Required — the diagnosis and the sanitiser design are sound, but the leak-path audit is
**incomplete**: two further egress points ship the same env-substituted `auth_config`, and one of them contradicts
row #14 of Dev's table. Approved in substance; re-scope per the conditions below, then proceed to implementation
without a second workplan round (SA will verify the additions at code review).

All claims below were re-verified independently in this worktree (`git log` head `124cfadb`) by reading the routes
and grepping the repo — not taken from the workplan.

### What SA confirmed independently

| Claim | Verdict | Evidence |
|---|---|---|
| `available/route.ts` ships the whole env-substituted `auth_config` with no auth | ✅ confirmed | `route.ts:35` `auth_config: definition.plugin.auth_config`; no `getUser()` anywhere in the file; `plugin-manager-v2.ts:144-171` `processEnvironmentVariables` rewrites every `${VAR}` string before the definition is cached |
| 28 definitions, 21 env-substituted `client_secret` | ✅ confirmed | enumerated all of `lib/plugins/definitions/*.json`: 21 `${*_SECRET}`-style values, 4 `internal`, 2 `platform`, 1 `${STRIPE_SECRET_KEY}` |
| Stripe's `client_secret` is the live platform API key | ✅ confirmed | `stripe-plugin-v2.json` → `"client_secret": "${STRIPE_SECRET_KEY}"`, `auth_type: oauth2_stripe_connect` |
| `oauth-handler.ts` reads only 6 `auth_config` fields, never `client_secret` | ✅ confirmed | every `authConfig.` reference in the file: lines 29, 40-46, 51, 57 and 212, 220-226, 231, 237 — exactly `requires_pkce`, `auth_url`, `client_id`, `redirect_uri`, `required_scopes`, `user_scopes` |
| `plugin-api-client` is the only browser reader of `auth_config` | ✅ confirmed | repo-wide grep for `auth_config` outside `app/api/**`: only `plugin-api-client.ts:346-350` |
| Four HTTP callers of `/api/plugins/available` | ✅ confirmed | grep for the path: `Footer.tsx:182`, `test-business-os/page.tsx:189`, `plugin-api-client.ts:31` (used by `settings/connections/page.tsx:58` and `test-plugins-v2/page.tsx:1007`). No test, script or e2e caller |
| `user-status`, `action-schema`, `execute` (catalogue), `additional-config`, `fetch-options`, `refresh-token`, `oauth/callback` do not egress `auth_config` | ✅ confirmed | each projects field-by-field or uses the config server-side only |
| WhatsApp `additional_params.config_id` has no consumer | ✅ confirmed | grep for `config_id` / `WHATSAPP_CONFIG_ID`: only unrelated `reward_config_id` hits |
| No server component serialises a `PluginDefinition` into client props | ✅ confirmed | every `getAvailablePlugins()` caller outside `app/api/**` is a `'use client'` page or server-only pipeline code |
| `toShortLLMContext()` / `toLongLLMContext()` never carry `auth_config` into an LLM prompt | ✅ confirmed (worth stating in the workplan) | `plugin-definition-context.ts:162-211` project explicitly; `generateSkinnyLLMContextByPluginName`, which *does* return whole definitions, has **zero consumers** |

### Comments

1. **`app/api/user/plugins/route.ts:84-95` — leak-table row #14 is wrong; this is a second secret egress.** — The route
   returns `_meta.connectedPluginData: connectedPluginData`, i.e. raw `PluginDefinitionContext` instances. The
   constructor assigns `this.plugin = definition.plugin` (`plugin-definition-context.ts:36`) and the class has **no
   `toJSON()`**, so `JSON.stringify` emits `_meta.connectedPluginData[].plugin.auth_config` — the env-substituted
   `client_secret` for every plugin the caller has connected (Stripe ⇒ `STRIPE_SECRET_KEY`). Authenticated-only
   (`supabase.auth.getUser()` at `:21-28`), so **High** rather than P0 — but any registered user can read the
   platform's Google client secret. The route is self-declared deprecated (`:17`) and its only callers are
   `components/wizard/Step3Plugins.tsx:87,165`, imported **only** by `app/(protected)/agents/new/page.tsxold` — a
   disabled file, so there is no live consumer. Fix is a one-line projection (`.map(p => p.toShortLLMContext())`) or
   dropping `connectedPluginData` from `_meta`. **In scope — Priority: High.** — [SA: pending]
2. **`app/api/analyze-prompt-clarity/route.ts:445, 466` — third egress, and this one is unauthenticated.** — Both 500
   fallback bodies spread `connectedPluginsMetaData` (raw `PluginDefinitionContext[]`, built at `:334`) into the
   response. Same serialisation as comment 1, so those error paths emit real `client_secret` values. The route has **no
   `getUser()`**: `:287` `const userIdToUse = userId || request.headers.get('x-user-id') || 'anonymous'`, and `:330`
   fetches *that* user's actionable plugins — so it is simultaneously the same IDOR as `/api/llm/context`. The happy
   path (`:546`) is already safe (`toShortLLMContext()`). Minimum fix in this branch: project both error bodies the
   same way (two lines). Full auth hardening of this 584-line legacy route is **not** required here — see decision 9.
   **In scope (projection only) — Priority: High.** — [SA: pending]
3. **The leak-path audit is presented as exhaustive and is not.** — Both misses share one shape the audit never looked
   for: a **class instance** (`PluginDefinitionContext`) carrying `plugin.auth_config` handed to `JSON.stringify`,
   rather than a literal `auth_config:` property. Re-run the sweep for that shape before implementing: grep response
   bodies for `PluginDefinitionContext`-typed values, `ctx.plugin`, `definition.plugin` and `_meta`.
   `generate-agent-v4/route.ts:210-218` builds `loadedPluginContexts` with `plugin: ctx.plugin` but only passes it into
   the generator (SA verified it is not in the `NextResponse.json` at `:390`) — record it as verified-safe-but-fragile.
   — Priority: High — [SA: pending]
4. **`ClientSafeAuthConfig` as proposed does not stop the mistake it is designed to stop — brand it.** — TypeScript's
   excess-property check fires only on *fresh object literals*. `auth_config: definition.plugin.auth_config` against a
   target typed `ClientSafeAuthConfig` compiles **clean** and leaks at runtime, because `PluginAuthConfig` is
   structurally assignable to the narrower type. Make the wire type unforgeable — e.g.
   `export type ClientSafeAuthConfig = { …7 fields… } & { readonly __clientSafe?: never }`, or a symbol brand that only
   `sanitizeAuthConfig()` can produce (a `never`/symbol-branded field does not serialise, so the wire shape is
   unchanged). Then the only way to obtain the type is to call the sanitiser, and "forgetting" becomes a compile error
   instead of a silent leak. This is the difference between decision 7 being answered and merely described.
   — Priority: High — [SA: pending]
5. **Add the real choke point: `PluginDefinitionContext.toJSON()`.** — Routes are not a single boundary (comments 1-2
   prove it), and `getAvailablePlugins()` cannot be the choke point because the V6 compiler resolves plugins by key
   from it and `OAuthTokenService` needs `client_secret`/`token_url` server-side. The one place that *is* a choke point
   for the accidental-serialisation class is the context class: add
   `toJSON()` returning `{ ...this, plugin: { ...this.plugin, auth_config: sanitizeAuthConfig(this.plugin.auth_config) } }`.
   Any current or future route that serialises a context instance is then safe by construction. Precondition: grep for
   code that round-trips a context through `JSON.parse(JSON.stringify(...))` expecting `auth_config` to survive (SA
   found none — confirm). Keep this *in addition to* explicit route-level projection: `toJSON` does not protect a
   direct `definition.plugin.auth_config` read. — Priority: High — [SA: pending]
6. **`available/route.ts:54` still returns `error.message` in the production 500 body.** — Pre-existing (logged as N-3
   in the route-identity-hardening review) but the file is being rewritten, so fix it here: guard with
   `process.env.NODE_ENV === 'development'` per CLAUDE.md § Error Response Format. — Priority: Medium — [SA: pending]
7. **`app/api/v2/plugins/connect/route.ts` — while you are in the file, add Zod.** — `:23-31` validates `plugin_key`
   with a hand-rolled truthiness check; CLAUDE.md mandates Zod at the input boundary. Trimming `authUrl` from the
   `info` log (`:91`) is correct — the URL carries `client_id` and the `state`, which embeds `user_id` (`:58-62`), so
   this is real log hygiene, not cosmetics. Do not restructure anything else in that route. — Priority: Medium —
   [SA: pending]
8. **The sanitiser must copy arrays, not alias them.** — `required_scopes` / `user_scopes` are arrays inside the
   **process-cached** definition object (`PluginManagerV2` holds definitions in a `Map` for the lambda's lifetime, and
   other code already mutates cached definitions — e.g. `plugin-manager-v2.ts:665-672` assigns `action.rules = {}`).
   Return `[...value]` for array fields so a consumer cannot mutate the cached registry through the wire object.
   — Priority: Medium — [SA: pending]
9. **Pre-existing dead branch — do not "fix" it by widening the allow-list.** — `plugin-api-client.ts:354-357`
   (`connectPlugin`) reads `(pluginDefinition as any)?.additional_config`, but `/api/plugins/available` has never
   returned `additional_config`, so the `requiresAdditionalConfig` callback is unreachable today. Leave it dead in this
   branch, record it as a follow-up, and **do not** add `additional_config` to the projection to "restore" it — that
   would be a behaviour change smuggled into a P0 security fix, and `additional_config` is not secret-audited.
   — Priority: Low — [SA: pending]
10. **Footer factual correction (conclusion unaffected, and strengthened).** — §2 states the Footer renders on
    `/c/[userCode]/book`, `/site/[subdomain]/book` and `/business-os/*`. It does not: `V2Footer` is imported **only** by
    `app/v2/layout.tsx`, so it never mounts on those public pages. The `if (!user) return` guard at `Footer.tsx:178`
    holds regardless. Correct the table so the evidence trail is accurate. — Priority: Low — [SA: pending]
11. **Anonymous access to the two internal test pages is a real (acceptable) behaviour change.** —
    `middleware.ts:117-118` lists `/test-plugins-v2` and `/test-business-os` in the **skip-onboarding** set, and SA
    confirmed the middleware performs no authentication for them — an anonymous browser can load both pages today and
    see the plugin list. After the gate they get 401, and `plugin-api-client.getAvailablePlugins()` **throws** on
    `success: false` (`:33-35`). Add to the manual matrix: load both pages logged **out** and confirm an error state,
    not a blank page or an unhandled rejection. — Priority: Medium — [SA: pending]
12. **Secret matcher: two additions.** — The proposed matcher is good. (a) Also fail on any value equal to a seeded
    `process.env` value — set `process.env.STRIPE_SECRET_KEY = 'SENTINEL_STRIPE'` in the test env and assert the
    sentinel never appears; that is stronger than prefix regexes. (b) Assert the absence of the *key names* too, so a
    dev box with an empty env (where substitution leaves `${STRIPE_SECRET_KEY}` verbatim) cannot make the test pass
    vacuously. — Priority: Medium — [SA: pending]

### SA decisions (answers to § "SA decisions required")

**Decision 1 — keep `client_id` on the wire: ✅ APPROVED as Dev proposes.**
Verified rather than accepted: `oauth-handler.ts:41` and `:221` set `client_id` from the config, and the server-side
alternative genuinely is not equivalent today. `app/api/v2/plugins/connect/route.ts` builds the authorize URL with
**no** `code_challenge`/PKCE branch (it never reads `requires_pkce`), **no** `user_scope` (Slack's user scopes would be
dropped), `access_type=offline`/`prompt=consent` only when `auth_type === 'oauth2_google'` (`:85-89`), and it returns a
URL string — none of the popup/`postMessage`/state-timeout handling in `oauth-handler.ts:92-190`. Routing all connects
through it inside a P0 fix would risk breaking live OAuth for PKCE and Slack plugins. `client_id` is public by
RFC 6749 §2.2 and is already visible in every authorize URL the browser opens.
**Condition:** open follow-up F1 ("move OAuth authorize-URL construction fully server-side — PKCE + `user_scope` +
popup-state parity") and reference it from the contract doc.

**Decision 2 — `/api/llm/context`: ✅ IN SCOPE.**
Verified unauthenticated and `?userId=`-trusting (`route.ts:14-22, 30`). It returns connected plugin
names/descriptions plus disconnected plugins with `auth_url` (`plugin-manager-v2.ts:599-643`) — no secrets, but
cross-user disclosure, so the IDOR classification is right. Deciding factor for scope: its only client wrapper,
`plugin-api-client.getLLMContext()` (`:208`), has **zero callers** in the repo, so deriving `userId` from the session
cannot regress anything. Harden it here as planned (auth, session-derived `userId`, Zod, Pino). Do **not** delete the
route in this branch — raise F3 to delete route + dead client method after the fix ships.

**Decision 3 — `/api/plugins/suggest`: ✅ IN SCOPE, minimal hardening only (SA overrides Dev's follow-up-only
recommendation).**
Verified: no auth, `const { prompt } = await req.json()` with no validation and **no `try/catch` at all**
(`route.ts:11-12`), calling GPT-4o on arbitrary anonymous text. Its only caller is
`components/wizard/Step3Plugins.tsx:51`, imported only by `app/(protected)/agents/new/page.tsxold` — a disabled file,
so the route has **no live consumer** and gating it carries zero regression risk for roughly ten lines. Leaving a known
anonymous LLM-spend proxy open at the end of a P0 security review is not defensible when the fix is that cheap.
**Scope it tightly:** `getUser()` 401, Zod on `prompt` (with a max length), `try/catch` + standard error envelope,
`createLogger`. **Explicitly out of scope:** rate limiting, and the hardcoded `OPENAI_MODELS.GPT_4O` (a CLAUDE.md
provider-factory violation — follow-up F5, do not fix here). Deleting the route instead is acceptable but is a TL/user
call, not Dev's.

**Decision 4 — no BA requirement MD: ✅ CONFIRMED, proceed without one.**
This is a defect fix with no new product surface: the user-visible contract change is "anonymous callers get 401" plus
"a field no client reads disappears". A retro-requirement would only restate the workplan. **Conditions:** (a) this
workplan is the record — keep the decision table and the *corrected* leak-path audit in it; (b) the client-safe
contract doc (task 14) is mandatory, not optional; (c) TL notes in the retrospective that the defect escaped because
`PluginInfo.auth_config: PluginAuthConfig` (`lib/types/plugin-types.ts:373`) made the secret part of the **typed**
public contract — that is the reusable lesson.

**Decision 5 — allow-list: ✅ APPROVED exactly as proposed (7 fields), copy-key-by-key, no spread, no `delete`.**
Validated against every consumer, not only the ones Dev cited: the sole browser reader of `auth_config` in the repo is
`plugin-api-client.ts:346-350`, which passes it straight to `OAuthHandler`, whose complete set of reads is those same
fields minus `auth_type` (needed by the UI for the `platform_key`/`internal` vs OAuth branch, and already duplicated at
the top level of the response). `user_scopes` exists in exactly one definition (Slack) and `requires_pkce` in four —
both required. Every excluded field was grep-checked for a browser reader: none. Conditions: comments 4 (brand the
type), 8 (copy arrays), 9 (do not add `additional_config`), and `CLIENT_SAFE_AUTH_CONFIG_FIELDS` stays the single
source the tests assert against. Also keep the top-level `auth_type`, `isSystem` and `visibility` keys —
`Footer.tsx:216` filters on `isSystem` and `/test-business-os` filters on `visibility` (PR #59 regression risk).

**Decision 6 — require auth on `/api/plugins/available`: ✅ CONFIRMED.**
All four callers re-verified session-backed: `settings/connections/page.tsx:44-58` returns early without `user?.id`;
`Footer.tsx:178` returns early without `user`; `/test-plugins-v2` and `/test-business-os` run as the logged-in session.
No public or marketing page, no script and no e2e test calls it. Two caveats to carry into the plan: Dev's claim that
the Footer renders on the public booking pages is wrong (comment 10) — it is `/v2`-only, which makes the gate *safer*,
not riskier; and the two internal test **pages** are not themselves auth-gated (comment 11), so verify their
logged-out behaviour. Keeping the gate as a separately revertable hunk is right, and SA agrees the sanitiser — not the
gate — is the load-bearing fix.

**Decision 7 — sanitiser boundary: 🔄 REVISION REQUIRED.**
A per-route sanitiser that each route must remember to call is precisely the design that produced this bug, and the
audit already proves the failure mode exists twice more in-tree (comments 1-2). No single choke point is available at
the manager level — `getAvailablePlugins()` must keep returning full definitions because the V6 compiler and
`OAuthTokenService` need `client_secret`/`token_url` server-side. So the answer is **two layers**:
(a) a **branded** `ClientSafeAuthConfig` that only `sanitizeAuthConfig()` can produce, making an un-sanitised
assignment a compile error rather than a silent leak (comment 4); and (b) `PluginDefinitionContext.toJSON()` returning a
sanitised `plugin.auth_config` (comment 5), which closes the accidental-serialisation class for every current and
future route in one place. **Yes — a distinct `ClientSafePluginDefinition`/`ClientSafeAuthConfig` type is warranted, but
only if branded**; the unbranded version Dev proposed is documentation, not enforcement. Explicit route-level
projection stays as well.

**Decision 8 — `${STRIPE_SECRET_KEY}` in `auth_config.client_secret`: ⚠️ correct-as-modelled; separate cleanup, not this
branch.**
SA checked the server consumer before answering: `OAuthTokenService.buildOAuthRequest` (`:35-41`) puts
`authConfig.client_secret` into the token request (body, or Basic auth for PKCE flows), and Stripe Connect's
`https://connect.stripe.com/oauth/token` authenticates with the platform **secret key** — so mapping it onto
`client_secret` is correct for that flow, not a modelling bug. `user-plugin-connections.ts:231` also requires the field
to be present. Therefore **do not touch the definitions in this branch.** Follow-up F2: stop storing secret *values* in
definitions at all — declare the env var name (e.g. `"client_secret_env": "STRIPE_SECRET_KEY"`) and resolve it in a
server-only credential resolver at the point of use, so no secret is ever present on the object that gets passed around
and serialised. That change touches `processEnvironmentVariables`, `OAuthTokenService`, the callback route and 21
definitions — its own cycle, its own tests.

**Decision 9 (Dev's item 5) — `console.*` conversions: approved in principle; user approval still required per
CLAUDE.md § Logging.**
- **Convert** (files being substantially rewritten): `app/api/llm/context/route.ts` (3), `lib/client/oauth-handler.ts`
  (15 → `clientLogger`), and `app/api/plugins/suggest/route.ts` (0 today — add `createLogger` as part of the new
  pattern).
- **Leave, and say so explicitly:** `components/v2/Footer.tsx` (13 — read only, agreed);
  `app/api/analyze-prompt-clarity/route.ts` (**51** in 584 lines) and `app/api/user/plugins/route.ts` (5), where the fix
  is a one-to-two-line projection. Converting 51 `console.*` calls inside a P0 security branch is disproportionate and
  enlarges the review surface. Surface both to the user with the counts, propose the conversion, and record the
  deferral here plus follow-up F4 — that satisfies CLAUDE.md's "flag it and propose it" duty without bloating this
  branch.

### Adjusted items (marked by SA)

- **Task 2** — SA review: done, this section. Verdict 🔄 with conditions; no second workplan round needed.
- **New task 9a** — Project `auth_config` out of `app/api/user/plugins/route.ts` `_meta.connectedPluginData`
  (comment 1) + test.
- **New task 9b** — Project the two 500 fallback bodies in `app/api/analyze-prompt-clarity/route.ts:445,466`
  (comment 2) + test. Projection only; no auth or logging rewrite of that route in this branch.
- **New task 9c** — Add `PluginDefinitionContext.toJSON()` with sanitised `auth_config` (comment 5), after grepping for
  JSON-round-trip clone users.
- **New task 9d** — Harden `app/api/plugins/suggest/route.ts` (auth + Zod + `try/catch` + Pino only) — decision 3.
- **Task 3** — `ClientSafeAuthConfig` must be **branded** (comment 4) and arrays must be copied (comment 8).
- **Task 5** — also fix the `error.message` production leak at `available/route.ts:54` (comment 6).
- **Task 10** — also add Zod to the connect route body (comment 7).
- **Task 11** — extend the cross-route sweep to `/api/user/plugins`, `/api/analyze-prompt-clarity` (success **and** both
  500 paths) and `/api/llm/context`; seed sentinels via `process.env` (comment 12).
- **Task 12** — add: both internal test pages loaded **logged out** degrade to an error state (comment 11).
- **§ Analysis Summary / leak-path table** — correct rows #14 and #19 and add the three new rows *before* implementing;
  that table is what QA will test against.
- **§ Acceptance Criteria** — add: "no response from `/api/user/plugins` or `/api/analyze-prompt-clarity` (including its
  500 paths) contains any excluded `auth_config` field", and "an un-sanitised `auth_config` cannot be assigned to the
  wire type — proven by a `@ts-expect-error` test".

### Follow-up tickets SA requires TL to open (not this branch)

| # | Item | Why deferred |
|---|---|---|
| F1 | Move OAuth authorize-URL construction fully server-side (PKCE + `user_scope` + popup-state parity) | Decision 1 — real regression risk inside a P0 branch |
| F2 | Stop storing secret *values* in plugin definitions — declare env var names, resolve server-side at point of use | Decision 8 — touches 21 definitions + token service |
| F3 | Delete `/api/llm/context` + dead `PluginAPIClient.getLLMContext()`, and the dead `Step3Plugins` / `agents/new/page.tsxold` chain | Decisions 2-3 — deletions after the fix ships |
| F4 | `console.*` → Pino in `analyze-prompt-clarity` (51) and `user/plugins` (5); full auth hardening of `analyze-prompt-clarity` (unauthenticated + body-supplied `userId`) | Decision 9 / comment 2 — disproportionate here |
| F5 | `/api/plugins/suggest` hardcodes `OPENAI_MODELS.GPT_4O` (CLAUDE.md § AI Provider Factory) and has no rate limit | Decision 3 |
| F6 | `plugin-api-client.connectPlugin`'s `additional_config` branch is unreachable (route never returned the field) | Comment 9 |
| F7 | `generateSkinnyLLMContextByPluginName` is dead **and** mutates cached definitions (`action.rules = {}`) | Found during this review — latent cross-request corruption |

### Approval

- [x] Workplan approved **with the conditions above** — proceed to implementation; SA will verify comments 1-12 at code
      review. No second workplan round required.
- [ ] Blocking gate for code review: comments 1, 2, 4 and 5 (the two missed egress points, the branded wire type, the
      `toJSON` choke point). Anything left undone must be argued in the workplan, not silently dropped.

**For the user (beyond rotation, which you already know):** the Stripe value exposed is `STRIPE_SECRET_KEY` — a
full-privilege live API key, not merely an OAuth client secret — so it is the highest-priority rotation of the set, and
every consumer of that env var has to be cut over together. Also note the repo is public, so assume the values in git
history are compromised independently of this endpoint.

---

**Code Review by SA — 2026-09-20**
**Status:** ✅ Code Approved — **Approved for QA.** No blocking fix. The four comments below are
carry-forward items, not gates.

Everything in this section was re-verified in the worktree by running the code, not read from the
implementation report. Where Dev's claim and SA's measurement differ, the measurement is recorded.

### What SA verified independently (method, then result)

| # | Claim under test | Method | Result |
|---|---|---|---|
| 1 | The brand actually enforces | Wrote a throwaway probe (`__sa_brand_check.ts`) compiled under the project's own `tsconfig.json`, then deleted it | ✅ raw `auth_config` → `PluginInfo['auth_config']` fails `TS2322: Property '[CLIENT_SAFE_BRAND]' is missing`; a **fresh literal with all 7 allow-listed fields** also fails; `sanitizeAuthConfig(...)` compiles; reading `client_id`/`required_scopes` off the branded type still works; reading `client_secret` off it is an error |
| 2 | No escape hatch in the diff | Grepped the added lines for `as any`, `as unknown`, `@ts-ignore`, `structuredClone`, and every occurrence of `ClientSafeAuthConfig` repo-wide | ✅ **one** mint site (`sanitize-plugin-definition.ts:123`), zero `as any` / `as unknown` / `@ts-ignore` added, zero `structuredClone` anywhere in the repo. Every other reference is a type position or a comment |
| 3 | `@ts-expect-error` is really enforced | Checked `jest.config.js` — `preset: 'ts-jest'` with diagnostics on, not babel/SWC | ✅ the compile-time assertion is a real gate; a weakened brand surfaces as `TS2578` in a full `tsc` run |
| 4 | Tests pass | `npx jest lib/plugins/__tests__ app/api/plugins/__tests__ app/api/plugins/available/__tests__ app/api/llm/context/__tests__` | ✅ **6 suites, 91 tests, all green** (69 new + the pre-existing identity-hardening suite, which did not regress) |
| 5 | Dev's tsc figures | `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit`, full repo | ✅ **2,037 errors, zero in any of the 15 touched files, zero in `.next/types`** — the +4 Dev reported were indeed regenerated Next route validators (absent once `.next` is not freshly built), i.e. artifacts, not regressions. **Also proven:** retyping `PluginInfo.auth_config` produced **no** error anywhere else — grepping all 2,037 errors for `CLIENT_SAFE_BRAND` / `ClientSafeAuthConfig` / `PluginInfo` / `auth_config` returns nothing |
| 6 | `getUser()` is a real gate | Read `lib/auth.ts` | ✅ cookie/session via `supabase.auth.getUser()` — server-verified, not a header |
| 7 | `Step3Plugins.tsx` is unreferenced | Repo-wide grep across **all** file types (not just imports) for `Step3Plugins`, `/api/user/plugins`, `/api/plugins/suggest`; plus `grep -rn "components/wizard"` from `app/`, `components/`, `lib/` | ✅ zero code references. Stronger than Dev's claim: **nothing outside `components/wizard/` imports anything from that directory at all** — the whole wizard chain is dead |
| 8 | No secret in any touched route's bodies | Read every `NextResponse.json` in `available`, `llm/context`, `v2/plugins/connect`, `analyze-prompt-clarity` (all response sites: success, both 500 fallbacks, outer catch) | ✅ none. `generateLLMContext` (`plugin-manager-v2.ts:599-643`) projects field-by-field — verified by reading the real implementation, not the test mock |
| 9 | Egress sweep re-run over the current tree | Re-ran SA's own sweep, widened to every `getAvailablePlugins` / `getPluginDefinition` / `PluginDefinitionContext` caller under `app/` (30 files), every `auth_config` reader outside `app/api/`, all `app/api/v6/*`, `generate-agent-v*`, and the LLM prompt builders | ✅ no remaining unsanitised path — details below |
| 10 | `console.*` in touched files | Counted per file | ✅ 0 in all 8 modified source files. `analyze-prompt-clarity` (51) remains, deferred to F4 with user approval per decision 9 |

### Egress sweep — two sites neither Dev's audit nor SA's workplan review listed

Both turn out to be **safe**, and finding them is itself the argument for the `toJSON` choke point:

| Site | What it returns | Verdict |
|---|---|---|
| `app/api/enhance-prompt/route.ts:460` — `connectedPluginData: connectedPluginsMetaData` | typed `IPluginContext[]`, populated at `:99` via `toShortLLMContext()` (or echoed from the request body at `:94`) | ✅ safe — projected before it reaches the response. **One refactor away from leaking**, i.e. exactly the shape that produced this bug |
| `app/api/generate-clarification-questions/route.ts:264` — `connectedPluginsData` | client-supplied payload echoed back, never a definition | ✅ safe |

Also re-verified safe: `generate-agent-v4:210-218` (`plugin: ctx.plugin` is a **plain object**, so `toJSON` does *not*
cover it — traced through `V4WorkflowGenerator` → `StepPlanExtractor` → `buildPluginContextForLLM`
(`lib/agentkit/v4/utils/plugin-helpers.ts:166`), which emits only `displayName`, `key`, `capabilities`, so no secret
reaches the LLM either); all `app/api/v6/*` definition users (schema/actions only — `buildPluginCapabilityContract`
copies `parameters`/`output_schema` only); `plugins/execute` catalogue mode; `plugin-manager-v2.ts:148`'s
`JSON.parse(JSON.stringify(definition))` (operates on a plain definition before substitution, unaffected by `toJSON`);
and the two internal test pages, which are `'use client'` API consumers, not server serialisers.

**Round-trip precondition for `toJSON` re-confirmed:** the only `JSON.parse(JSON.stringify(...))` applied to a context
anywhere in the repo is the egress test's own assertion. No server path depends on `auth_config` surviving
serialisation.

### Code Review Comments

1. `docs/AGENT_EXECUTION_FLOW.md:196,468` — still documents `app/api/plugins/suggest/route.ts` as a live route, with a
   file link that is now a 404. One-line correction (mark removed, point at this workplan). — Priority: Low
2. `app/api/analyze-prompt-clarity/route.ts:354-360` — a commented-out block containing
   `connectedPluginData: connectedPluginsMetaData`, i.e. **verbatim the leak this branch fixes**. Pre-existing and
   inert, but it is a copy-paste hazard sitting six lines above the two lines just fixed. Delete the block while you
   are in the file. — Priority: Low
3. § Leak-path audit — add the two sites above (`enhance-prompt:460`, `generate-clarification-questions:264`) as
   ✅-verified rows. That table is QA's test basis, and "not in the table" currently reads as "not checked".
   — Priority: Low
4. `app/api/v2/plugins/connect/route.ts:29` — `ConnectBodySchema.safeParse(await request.json())`: the `await` sits
   inside the `safeParse` argument, so a malformed JSON body throws past the Zod branch into the outer catch and
   returns **500 where 400 is correct**. Pre-existing shape, not introduced here, not a security issue.
   — Priority: Low

### Residual risks (recorded, not blocking)

| # | Risk | Assessment |
|---|---|---|
| R1 | **The brand only binds where a type annotation exists.** A future `NextResponse.json({ plugins: pluginManager.getAvailablePlugins() })` has no target type, so nothing stops it; and `toJSON` covers only `PluginDefinitionContext` **instances**, not raw definitions. | The honest limit of the two-layer design, and why F2 (stop putting secret *values* in definitions at all) is the real fix. Recommend **F9**: a guard test scanning `app/api/**` for a `getAvailablePlugins()` / `.plugin.auth_config` expression inside a response body — the same cheap shape as the existing deletion guard. |
| R2 | Spread-laundering type-checks: `{ ...sanitizeAuthConfig(x), ...rawAuthConfig }` is assignable to `ClientSafeAuthConfig`, because the spread keeps the brand. | Verified by experiment. Requires deliberately spreading a raw config; no such code exists. Not worth complicating the type for — record it in PLUGIN_CLIENT_SAFE_CONTRACT.md so the next author is not surprised. |
| R3 | The `/api/llm/context` row of the egress sweep runs against a **mocked** `generateLLMContext`, so that assertion proves nothing about the real projection. | SA verified the real implementation by reading it (`plugin-manager-v2.ts:599-643` — field-by-field, `auth_url` only). Consider unmocking it, or noting the limitation in the test. |

### On the `Step3Plugins.tsx` deletion (judgement call flagged by Dev)

**SA recommendation: keep it deleted.** It is not merely "unreferenced by the deleted routes" — nothing in `app/`,
`components/` or `lib/` imports **any** file from `components/wizard/`, so the component was unreachable by every
path, not just the two that were removed. Keeping it would leave a component whose every fetch 404s and would defeat
the guard test's literal check. Restoring is one command if the user disagrees:
`git checkout 124cfadb -- components/wizard/Step3Plugins.tsx`. This is scope the user did not explicitly authorise —
the call is theirs, and the branch is correct either way.

### The `available` auth change and logged-out test pages

Confirmed safe to ship: `getUser()` is session-verified, all four callers are session-backed, the sanitiser — not the
gate — is the load-bearing fix, and the gate is a separately revertable hunk. Logged-out behaviour, per SA comment 11:
`/test-business-os` never calls the route without `user` (`page.tsx:206`), so it is unaffected; `/test-plugins-v2`
catches the thrown 401 and writes `Failed to load plugins: Not signed in…` into its debug console
(`page.tsx:1004-1013`) — no unhandled rejection, but the **main panel simply shows an empty list**, so the signal is
in the side console only. Acceptable for an internal page; QA should confirm it reads as an error rather than
"no plugins exist".

### Optimisation Suggestions (never blocking)

- `copyStrings` calls `.filter(...).slice()`; `filter` already returns a new array, so `.slice()` is redundant.
  Harmless, and arguably self-documenting given SA comment 8 — keep it if the explicitness is preferred.
- Add `enhance-prompt` to the egress sweep: it returns plugin metadata on the success path and is the closest
  remaining relative of the fixed leak shape.

### Standards compliance

| Standard | Verdict |
|---|---|
| Zod on every touched input boundary | ✅ `available` (query), `llm/context` (query), `v2/plugins/connect` (body) |
| Pino, no `console.*` in touched files | ✅ 0 in all 8 modified sources; the 51 in `analyze-prompt-clarity` are a user-approved F4 deferral, recorded in this workplan |
| `correlationId` on API routes | ✅ all three rewritten routes |
| Error bodies guarded by `NODE_ENV` | ✅ including the pre-existing `available:54` leak (SA comment 6) |
| Repository pattern / RLS | ✅ n/a — no DB access added, no `supabaseServer` introduced |
| Provider factory | ✅ n/a — the one hardcoded-model violation left with the deleted `suggest` route |
| TypeScript strict, no new `any` | ✅ net **−1** `any` (`getPluginAuthConfig`) |
| Dead code | ✅ none added; two dead routes and one dead component removed, with a guard test |
| New pattern (branded wire type) | ✅ SA-mandated in the workplan review, documented in PLUGIN_CLIENT_SAFE_CONTRACT.md |

**All four blocking-gate items from the workplan review are met:** comment 1 (`user/plugins` — deleted, guard test),
comment 2 (`analyze-prompt-clarity` 500 bodies — projected, both asserted), comment 4 (branded type — proven by
experiment), comment 5 (`toJSON` choke point — added, round-trip precondition re-confirmed).

### Notes for QA

1. Rotation of `STRIPE_SECRET_KEY` and every `*_CLIENT_SECRET` is **independent of this branch** and still
   outstanding. A green QA pass does **not** mean the exposure is closed — the repo is public and the values are in
   git history.
2. Highest-value manual checks, in order: (a) a real OAuth round-trip for a **PKCE** plugin and for **Slack**
   (`user_scopes`) — the allow-list is the only thing between the browser and a broken authorize URL, and no automated
   test covers a real provider; (b) `curl /api/plugins/available` with no cookie → 401, and with a cookie → grep the
   body for `client_secret` / `token_url`; (c) `/api/llm/context?userId=<other user>` with a cookie → must serve the
   **session** user.
3. Logged-out `/test-plugins-v2` — see above: expect an error line in the debug console and an empty list.
4. `/api/llm/context` has no UI consumer; exercise it with `curl` only.
5. PR #59 regression watch: `/test-business-os` Modules tab must still list Business OS modules
   (`?includeBusinessOs=true` + `visibility` survived the projection), and `settings/connections` must still render
   plugin cards and connect.

### For the user

1. **`Step3Plugins.tsx` was deleted without explicit authorisation.** SA recommends keeping it deleted (reasoning
   above); it is restorable with one command.
2. Follow-ups F1-F7 from the workplan review, plus **F8** (`eslint.config.js` shadows the valid `eslint.config.mjs`,
   so `npm run lint` has been a repo-wide no-op — found by Dev; config change, not this branch) and **F9** (R1 above).
   F2 remains the only change that actually removes secrets from the objects being passed around.

### Code Approved for QA: **Yes**

## QA Testing Report

**QA — 2026-09-20**
**Test mode:** full
**Strategy used:** B + C + A — integration (Jest: the 5 new suites plus the full 364-suite run), a live-server test
script against this worktree's own dev server on `http://localhost:3004` (`curl`, cookie-less and with forged
credentials), and a compile-time probe (`tsc`) for the branded type. Option D (Playwright) was **not available** —
this repo has no `playwright` dependency and no `test:e2e` script despite CLAUDE.md § Testing listing it, so the
browser-only items were verified by code-path analysis plus anonymous SSR fetches.
**Focus:** security (primary), api, schema
**Skipped:** e2e (tooling absent — see above); every authenticated-session check and the live OAuth round-trips
(no credentials available to QA — listed as PENDING below)
**Input source:** prompt keywords from TL + § Test Plan C + SA's § Notes for QA
**Environment:** worktree `neuronforge-plugin-secrets`, branch `fix/plugin-auth-config-exposure`, uncommitted on
HEAD `124cfadb`. No commits, no staging, no server start/stop, no other worktree touched. The worktree was verified
byte-identical before and after QA (`git status --porcelain` and `git diff --stat` diffed clean; the one
temporarily-edited file was restored from a SHA-256-verified backup).

### Verdict

✅ **PASS — ready for commit.** Zero bugs found in this branch's changes. 9 of 11 acceptance criteria verified by
QA; **AC4 (live OAuth round-trips) and the live half of AC5 are PENDING the user** — they need a real session and
real provider credentials, which QA does not have.

⚠️ This verdict covers the **code fix only**. The exposed secrets stay valid until rotated, and the repo is public,
so git history is compromised independently of this branch. `STRIPE_SECRET_KEY` first (task 17).

### Test Coverage

| Acceptance Criterion | Tested? | Result | Notes |
|---|---|---|---|
| **1.** No API response contains `client_secret`, an `sk_`/`sk_live`/`sk_test`/`sk-` value, a `GOCSPX-` value, or any other excluded `auth_config` field | ✅ | **Pass** | Two independent methods. (a) Jest: the 10-test egress sweep across `available`, `llm/context`, `user-status`, `action-schema`, `execute` (both modes) and `analyze-prompt-clarity` (success + both 500 paths) — green. (b) **Live, against the real env**: 8 real secret values were read out of this worktree's `.env.local` (`GOOGLE_CLIENT_SECRET`, `STRIPE_SECRET_KEY`, `SLACK_`/`NOTION_`/`AIRTABLE_`/`HUBSPOT_CLIENT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`) and every captured response body was `grep -F`'d against them → **0 hits**. Bodies swept: `available` (401), `llm/context` (401), `execute` catalogue + single-plugin, `action-schema`, `analyze-prompt-clarity` (live 500) |
| **2.** The `auth_config` fields crossing the boundary are exactly the allow-list, enforced **by construction** | ✅ | **Pass** | `sanitizeAuthConfig()` read line by line: field-by-field copy, no spread, no `delete`, no iteration over input keys; arrays via `copyStrings` (`.filter().slice()`); malformed input degrades rather than throwing. 39 unit tests green incl. the kitchen-sink guard and `future_secret_field`. **Independently re-proved by mutation** — see § Egress sweep mutation test |
| **3.** `GET /api/plugins/available` 401s without a session and is otherwise unchanged in shape | ✅ | **Pass** | Live 401 for: no cookie; a junk `sb-access-token` cookie; an `x-user-id: <uuid>` header; `Authorization: Bearer <forged JWT>`; and a **correctly-named, well-formed forged `@supabase/ssr` session cookie** (`sb-<project-ref>-auth-token`, base64 envelope, HS256 JWT with `exp` in 2100 and a victim `sub`) → still 401. `lib/auth.ts` read: `supabase.auth.getUser()` over the cookie store, i.e. server-verified, not header-trusted. Auth is checked **before** Zod, so `?includeBusinessOs=maybe` 401s rather than 400 — correct ordering, no pre-auth information disclosure |
| **4.** Plugin connect works end-to-end on both OAuth paths incl. PKCE and Slack `user_scope` | ⏳ | **PENDING (user)** | Needs a logged-in browser and real provider credentials. Verified statically only: the 7-field allow-list is a superset of every field `lib/client/oauth-handler.ts` reads, so the authorize URL has all of its inputs. **The one item no automated test in this repo covers** (SA's highest-value manual check) |
| **5.** `includeBusinessOs` scoping from PR #59 behaves identically | ✅ / ⏳ | **Pass (test-locked)**, live half PENDING | Locked by `available/__tests__/route.test.ts` (default-hide + opt-in + 400 on a typo) — green. The live authenticated check (`/test-business-os` Modules tab still lists BOS modules) is **PENDING the user**. Evidence the projection preserves the filter keys: `toClientPluginInfo` explicitly emits `isSystem` and `visibility` |
| **6.** `/api/llm/context` no longer serves another user's connection state | ✅ | **Pass** | Live: `?userId=<another user's id>` with no cookie → 401; with the forged session cookie → 401; with no `userId` → 401. Route read: identity is `user.id` from the session; the supplied `userId` is only compared so a mismatch can be `warn`-logged, and never reaches `generateLLMContext`. The authenticated-mismatch path is covered by the 6-test suite (IDOR lock asserts the victim id never reaches the manager) |
| **7.** No response from the deleted `/api/user/plugins` or from `/api/analyze-prompt-clarity` (incl. its two 500 paths) contains any excluded `auth_config` field | ✅ | **Pass** (one caveat) | Live: `/api/user/plugins` and `/api/plugins/suggest` → **404 for both GET and POST**. `analyze-prompt-clarity` with a **valid-looking body** (`prompt` + `userId` + `sessionId`) reached the real `CLAUDE_FETCH` 500 path (the configured Anthropic model 404s on this box) and returned `connectedPluginsMetaData: []` — 0 matches for `client_secret\|token_url\|refresh_url\|profile_url\|auth_config\|sk_live\|sk_test\|GOCSPX\|${*SECRET*}` and 0 matches against the 8 real env values. **Caveat:** that live call ran with an *empty* connected-plugin set, so it exercises the 500 path but not a populated projection — a read-only DB lookup for a user with active `plugin_connections` was **blocked by the sandbox (Production Reads)**. The populated case is covered by the Jest sweep, which mocks `getUserActionablePlugins` to return real `PluginDefinitionContext` instances built from sentinel-bearing definitions and asserts `connectedPluginsMetaData` is both defined and secret-free |
| **8.** An un-sanitised `auth_config` cannot be assigned to the wire type | ✅ | **Pass** | Re-proved independently of Dev's and SA's runs with a throwaway probe compiled under the project's own `tsconfig.json` (created, compiled, deleted; worktree re-verified clean). **3 negative controls all rejected, 1 positive control accepted** — exact output in § Branded-type probe |
| **9.** Every touched file: Pino not `console.*`, Zod at the boundary, `@/` imports, CLAUDE.md API-route pattern with `correlationId` | ✅ | **Pass** | `available` and `llm/context` read in full: `createLogger` + `logger.child({ correlationId })`, Zod `safeParse` on the query, `@/` imports, `NODE_ENV`-guarded `details` on both 400 and 500, `Cache-Control: private, no-store` + `Vary: Cookie` on the 200. `v2/plugins/connect` Zod confirmed by diff. The 51 `console.*` in `analyze-prompt-clarity` remain — user-approved F4 deferral, recorded in this workplan |
| **10.** `tsc` introduces no new error in a touched file; `npm test` introduces no new failure vs `main` 124cfadb; ESLint clean; `next build` succeeds | ✅ | **Pass** (one method caveat) | **tsc:** QA ran `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` → **2,037 errors repo-wide, 0 in any of the 15 created/modified files and 0 in the 5 new test files** (grepped by explicit path list). Matches SA's 2,037 exactly. **Jest:** `MSYS_NO_PATHCONV=1 npm test` run **twice**, identical both times: `21 failed, 8 skipped, 335 passed, 356/364 suites` · `129 failed, 58 skipped, 5013 passed, 5200 total` — **byte-identical to Dev's recorded branch numbers**. All 21 failing suites are named and classified below; none touches plugin or auth code. **Caveat:** QA did **not** re-derive the `main` baseline itself — that requires stashing this branch's uncommitted work, which the no-staging constraint forbids. Evidence used instead: (a) the totals match Dev's branch run exactly and Dev's baseline was `21 / 129 / 4,944 / 5,131` (+69 = exactly the new tests); (b) the 21 failing suites were scanned for imports of any touched file — only `lib/agentkit/v4/__tests__/v4-generator.test.ts` matched, via a **type-only** `import { IPluginContext }`, and its failures are all `expect(result.success).toBe(true)` on an LLM-dependent generator, a pre-existing class; (c) the diffs to the two shared type files are additive/type-only (`toJSON()` added; `PluginInfo.auth_config` retyped), so no runtime behaviour reaches those suites. **ESLint and `next build` were not re-run by QA** — recorded as verified by Dev and unchallenged by SA |
| **11.** Client-safe contract documented | ✅ | **Pass** | `docs/PLUGIN_CLIENT_SAFE_CONTRACT.md` read in full: allow-list table with per-field justification, both enforcement layers, contributor rules, an SA-sign-off gate for widening, F1/F2/F4/F6 cross-links, Change History. Its allow-list matches `CLIENT_SAFE_AUTH_CONFIG_FIELDS` exactly — same 7 fields, same order |

### Egress sweep mutation test — does the sweep actually fail when it should?

**Yes.** Method: `app/api/plugins/available/route.ts` was backed up (SHA-256 recorded), then one line was changed to
re-introduce the leak in the shape a future refactor would take:

```ts
// as built
.map(([key, definition]) => toClientPluginInfo(key, definition));
// deliberately broken
.map(([key, definition]) => ({ ...toClientPluginInfo(key, definition), raw: definition }));
```

Result — **3 tests went red across both suites**, each naming the leaked key precisely:

```
● GET /api/plugins/available › returns no secret for an authenticated caller
● GET /api/plugins/available › hides business_os plugins by default … (PR #59 scoping)
● no plugin route serialises a secret › GET /api/plugins/available
    + "forbidden key present: client_secret",
    + "forbidden key present: token_url",
  at assertNoSecrets (lib/testing/plugin-secret-matcher.ts:85:44)
Test Suites: 2 failed, 2 total   Tests: 3 failed, 15 passed, 18 total
```

Restored from the backup → `sha256sum -c` **OK**; `git diff --stat` and `git status --porcelain` **identical** to
the pre-QA snapshot; both suites back to `18 passed, 18 total`; the live endpoint re-checked → still 401.

**Two findings from this experiment:**

1. The sweep is **not** vacuous — it fails closed, and the message identifies the leaked key by name.
2. **SA's residual risk R1 is empirically confirmed.** The deliberately broken line **compiled clean** — the spread
   had no target type annotation, so the brand never bound. Only the *runtime* sweep caught it. That is direct
   evidence for opening **F9** (a guard test scanning `app/api/**` for a `getAvailablePlugins()` /
   `.plugin.auth_config` expression inside a response body).

### Branded-type probe (AC8)

A throwaway file at the repo root, compiled under the project `tsconfig.json`, then deleted:

| Control | Expression | Result |
|---|---|---|
| Negative 1 | `const leaky: PluginInfo['auth_config'] = raw` (a raw `PluginAuthConfig`) | ❌ `TS2322: Type 'PluginAuthConfig' is not assignable to type 'ClientSafeAuthConfig'` |
| Negative 2 | a **fresh literal with all 7 allow-listed fields** | ❌ `TS2322` — the brand cannot be forged even by writing the correct shape by hand |
| Negative 3 | `const leakyInfo: Pick<PluginInfo,'auth_config'> = { auth_config: raw }` — the original bug's exact shape | ❌ `TS2322` |
| Positive | `sanitizeAuthConfig(raw)`, then reading `.client_id` and `.required_scopes` off the result | ✅ compiles, reads work |

Only one mint site exists (`sanitize-plugin-definition.ts:123`), and the brand is a `declare const … unique symbol`,
so it has no runtime value and never reaches the wire.

### Full-suite result (AC10)

`Test Suites: 21 failed, 8 skipped, 335 passed, 356 of 364` · `Tests: 129 failed, 58 skipped, 5013 passed, 5200
total` — identical across two consecutive runs.

**The 5 new suites all pass** (69 tests), as does the pre-existing `identity-hardening` suite that shares the
directory: run together → `6 suites, 91 tests, 91 passed`, matching SA's measurement exactly.

The 21 pre-existing failures, all outside this branch's surface:

| Area | Suites |
|---|---|
| V6 / Declarative compiler | `DeclarativeCompiler-{comprehensive,dataflow,dataflow-contract,regression,stress}`, `v6-integration`, `v6-end-to-end`, `LogicalIRCompiler`, `EnhancedPromptToIRGenerator`, `logical-ir/schemas/validation`, `IRToNaturalLanguageTranslator` |
| Pilot | `ConditionalEvaluator`, `ConditionalEvaluator.contains_any`, `StructuredTransforms`, `StructuredTransforms.wp33`, `StructuredTransforms.wp37` |
| Orchestration | `IntentClassifier`, `TokenBudgetManager` (5 s timeouts) |
| Other | `lib/utils/featureFlags`, `lib/website-builder/archetypes`, `lib/agentkit/v4/v4-generator` |

### Issues Found

#### Bugs (must fix before commit)

**None.** No bug of any severity was found in this branch's changes.

#### Performance Issues (should fix)

**None observed.** The sanitiser is an O(7) field copy per plugin on a route returning ~11-28 elements, and the
added `Cache-Control: private, no-store` is correct for per-session data — it regresses nothing, since the route
previously set no cache headers at all.

#### Edge Cases (nice to fix — none blocking)

1. **401 and 400 bodies carry no `Cache-Control`.** `available` and `llm/context` set `private, no-store` +
   `Vary: Cookie` only on the 200. Observed live: the 401's only `vary` is Next's own
   `RSC, Next-Router-State-Tree, Next-Router-Prefetch`. No secret is at risk (the body is
   `{"success":false,"error":"Unauthorized"}`) and Vercel does not cache dynamic route-handler responses by
   default, but a shared cache storing a 401 under a cookie-less key would be an availability annoyance. One-line
   fix if wanted: hoist the header object above the auth check. — Severity: Low
2. **`GET /api/plugins/execute` still enumerates the registry anonymously.** Verified live: **11 plugins with full
   action-name lists, no cookie**, 4.9 KB. Zero secrets (grepped against all 8 real env values → 0 hits), and it is
   row #16 of the leak table marked ✅, so this is correct per the approved scope. Recorded only because gating
   `available` while `execute` stays open means *registry enumeration* is not actually closed by this branch — if
   the intent behind AC3's gate was the route's own comment ("the registry is not public information"), that intent
   is half-realised. A follow-up decision, not a change here. — Severity: Low
3. **`analyze-prompt-clarity` returns `details: error.message` unguarded.** Confirmed live: the outer catch
   (`route.ts:~588`) and the `CLAUDE_FETCH` 500 both emit `details` with no `NODE_ENV` guard, and QA's live call
   returned the full Anthropic error payload in it. `stack` **is** correctly dev-guarded (`isDevEnv`). Pre-existing,
   outside this branch's two-line scope, already tracked as **F4** — confirming it is still true, not raising it as
   new. The two fixed 500 bodies themselves are clean. — Severity: Low
4. **SA's R3 stands.** The `llm/context` row of the egress sweep asserts against a **mocked** `generateLLMContext`,
   so it proves the route wrapper is clean rather than the projection. QA did not unmock it (that would be a code
   change) but did confirm by reading `plugin-manager-v2.ts:599-643` that the real implementation projects field by
   field. Suggest a one-line comment in the test recording the limitation. — Severity: Low

### UX observation — logged-out `/test-plugins-v2` (SA comment 11 / § Notes for QA item 3)

**Not a blocker. SA's description is accurate, and QA's judgement is that it does *not* read as an error to a user.**

Verified: both `/test-plugins-v2` and `/test-business-os` still return **HTTP 200** anonymously (no middleware
auth), so the shell renders. Playwright is unavailable, so the client behaviour was traced through the code:

- `loadAvailablePlugins()` runs **unconditionally on mount** (`page.tsx:946-949`), receives the 401, and
  `plugin-api-client` throws `Not signed in - sign in to load the plugin registry` — caught, and written **only**
  to the debug log. No unhandled rejection, no blank crash. ✅ as designed.
- The **default tab is `form`**, not `classic`. There `availablePlugins` feeds only `pluginLabels`, and the visible
  state is the `ConnectionGatePanel`. Because `NEXT_PUBLIC_TEST_PAGE_USER_ID` **is set in this worktree's
  `.env.local`**, the User ID box is pre-seeded even when logged out, so the gate does *not* show its "user ID
  required" state — it shows every required plugin as **not connected**. To an operator that reads as *"my plugins
  are disconnected"*, not *"I am signed out"*.
- On the `classic` tab the plugin `<select>` renders with only `-- Select Plugin --` and no options, and there is no
  empty-state or error banner anywhere in the main panel.
- The only truthful signal is the "Debug Logs" box at **line ~5,502 of a ~5,600-line page** — always rendered, never
  collapsed, but far below the fold.

**Judgement:** it reads as *"no plugins exist / the page is broken"* rather than *"sign in"*. Acceptable for an
internal-only page (SA's conclusion) and **explicitly not a blocker**. Cheap improvement if anyone wants it later:
keep the thrown message in state and render one line above the plugin selector. `/test-business-os` is genuinely
unaffected — it never calls the route without `user` (`page.tsx:206`).

### Test Outputs / Logs

**Live server (`http://localhost:3004`, this worktree's dev server) — cookie-less unless stated:**

```
GET  /api/plugins/available                                  -> 401 {"success":false,"error":"Unauthorized"}
GET  /api/plugins/available   (junk sb-access-token cookie)  -> 401
GET  /api/plugins/available   (x-user-id: <uuid> header)     -> 401
GET  /api/plugins/available   (Authorization: Bearer <JWT>)  -> 401
GET  /api/plugins/available   (forged sb-<ref>-auth-token)   -> 401   <- correctly-named @supabase/ssr cookie
GET  /api/plugins/available?includeBusinessOs=true (header)  -> 401
GET  /api/plugins/available?includeBusinessOs=maybe          -> 401   (auth before Zod - correct)
GET  /api/llm/context?userId=<other user>                    -> 401
GET  /api/llm/context         (forged cookie + victim id)    -> 401
GET  /api/llm/context         (no userId)                    -> 401
GET  /api/user/plugins                                       -> 404      POST -> 404
GET  /api/plugins/suggest                                    -> 404      POST -> 404
GET  /api/plugins/user-status                                -> 401 {"error":"Authentication required"}
POST /api/v2/plugins/connect  {"plugin_key":"google-mail"}   -> 401
POST /api/v2/plugins/connect  (malformed JSON body)          -> 401   (auth short-circuits SA comment 4's 500)
POST /api/analyze-prompt-clarity {}                          -> 500, no plugin data; `stack` present
                                                                 (NODE_ENV=development, dev-guarded),
                                                                 `details` unguarded (F4)
POST /api/analyze-prompt-clarity <valid body>                -> 500 CLAUDE_FETCH path,
                                                                 connectedPluginsMetaData: [], 0 secret matches
GET  /api/plugins/execute (catalogue)                        -> 200, 11 plugins, action names only,
                                                                 0 secret matches
GET  /api/plugins/action-schema?plugin=...&action=...        -> 200, metadata only, 0 secret matches
GET  /test-plugins-v2  and  /test-business-os                -> 200 (no middleware auth; see UX observation)
```

**Real-secret sweep of every captured body** (8 values read from `.env.local`, never printed):

```
apc-valid.json -> real-secret-value hits: 0
exec-cat.json  -> real-secret-value hits: 0
exec-one.json  -> real-secret-value hits: 0
actsch.json    -> real-secret-value hits: 0
unauth body    -> real-secret-value hits: 0
```

**Jest (new suites, run together with the directory's pre-existing suite):**

```
PASS lib/plugins/__tests__/sanitize-plugin-definition.test.ts
PASS app/api/plugins/available/__tests__/route.test.ts
PASS app/api/plugins/__tests__/identity-hardening.test.ts
PASS app/api/llm/context/__tests__/route.test.ts
PASS app/api/plugins/__tests__/dead-plugin-routes-removed.guard.test.ts
PASS app/api/plugins/__tests__/no-secret-egress.test.ts
Test Suites: 6 passed, 6 total     Tests: 91 passed, 91 total
```

**TypeScript:** `2,037 errors repo-wide · 0 in any created or modified file · 0 in the 5 new test files.`

### Items PENDING the user (cannot be closed by QA)

| # | Item | Why QA cannot do it | Blocks |
|---|---|---|---|
| P1 | **Real OAuth round-trip — Google connect** (§ Test Plan C check 4) | needs a logged-in browser session + real provider credentials | AC4 |
| P2 | **PKCE plugin (Airtable), and Slack (`user_scopes`)** (check 5) | same — and the single highest-risk gap: the allow-list is all that stands between the browser and a malformed authorize URL, and no automated test covers a real provider | AC4 |
| P3 | **Business OS channel-card connect** via `/api/v2/plugins/connect` (check 6) | same | AC4 |
| P4 | **Authenticated `GET /api/plugins/available`** — grep the 200 body for `client_secret` / `token_url` / `sk_` / `GOCSPX-` | no session cookie available to QA; equivalent coverage exists in the route test + egress sweep, but not live | AC1 / AC3 (live half) |
| P5 | **`/settings/connections` renders plugin cards**, and **`/test-business-os` Modules tab still lists BOS modules** (check 7) | needs a session | AC5 (live half) |
| P6 | **V2 Footer plugin strip** logged in, then a public booking page logged out (check 9) | needs a session | — |
| P7 | **Rotate `STRIPE_SECRET_KEY`, then every `*_CLIENT_SECRET`** (task 17) | user/ops action, out of this branch's scope | **the incident — not the commit** |

P1-P6 are behaviour-preservation checks; a failure there would be a regression in the *gate* or the *allow-list*,
both separately revertable hunks. P7 is what actually closes the incident.

### Final Status

- [x] **All QA-verifiable acceptance criteria pass — ready for commit.** 9/11 verified by QA; AC4 and the live half
      of AC5 are PENDING the user (P1-P6). No bug of any severity found in this branch's changes; nothing is
      assigned back to Dev.
- [ ] Issues found — Dev must address before commit *(not applicable)*

**Follow-ups arising from QA** (for TL's F-list; none blocks the commit):

| # | Item | Source |
|---|---|---|
| F9 | Guard test scanning `app/api/**` for `getAvailablePlugins()` / `.plugin.auth_config` inside a response body | **Empirically justified by QA's mutation test** — the re-introduced leak compiled clean; only the runtime sweep caught it (SA R1) |
| F10 | Decide whether anonymous registry enumeration via `GET /api/plugins/execute` should also be gated | Edge case 2 |
| F11 | Set the no-store headers on the 401/400 paths of `available` and `llm/context` too | Edge case 1 |
| F12 | Note the mock limitation in the `llm/context` row of the egress sweep, or unmock `generateLLMContext` | SA R3 / Edge case 4 |
| F13 | Logged-out `/test-plugins-v2`: surface the 401 message above the plugin selector, not only in the bottom debug log | UX observation |
| — | Re-confirmed still open: **F4** (`analyze-prompt-clarity` — 51 `console.*`, unguarded `details`, still unauthenticated) | Edge case 3 |

## Commit Info

_(RM to populate)_

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-20 | QA testing (QA) | **Verdict: PASS — ready for commit; zero bugs in this branch's changes.** 9/11 acceptance criteria verified by QA; AC4 (live OAuth round-trips) and the live half of AC5 are PENDING the user. Re-ran every TL check on port 3004 and extended them: a junk cookie, an `x-user-id` header, a bearer JWT and a **correctly-named forged `@supabase/ssr` session cookie** all 401 on `available` and `llm/context`; both deleted routes 404 on GET and POST; `analyze-prompt-clarity` driven with a valid body reached the real `CLAUDE_FETCH` 500 path and returned no plugin data. Swept every captured body against **8 real secret values read from `.env.local`** → 0 hits. `npm test` run twice: `21/129/5013/5200`, matching Dev's branch numbers exactly, with all 5 new suites green (69 tests; 91 with the shared directory's existing suite). **Mutation-tested the egress sweep** — re-introducing the leak turned 3 tests red naming `client_secret`/`token_url`, and the route was restored byte-exact (SHA-256 + `git status` verified); the broken line **compiled clean**, empirically confirming SA's residual risk R1 and justifying F9. Re-proved the brand with an independent `tsc` probe: 3 negative controls rejected (incl. a hand-written 7-field literal), positive control accepted. `tsc`: 2,037 errors repo-wide, **0 in any touched or new file**. Four Low edge cases recorded (no cache headers on 401/400; anonymous registry enumeration still open via `execute` GET; `analyze-prompt-clarity`'s unguarded `details` — F4; the mocked `llm/context` sweep row — SA R3) plus a UX observation on logged-out `/test-plugins-v2`. Five follow-ups proposed (F9-F13). No commits, no staging; worktree verified unchanged. |
| 2026-09-20 | Implemented | All SA conditions folded in (branded type, toJSON choke point, the two missed egress points, array copies, prod-500 fix, connect-route Zod, extended sweep); two dead endpoints deleted per user decision; leak table corrected (rows #14/#19) and extended to 25 rows |
| 2026-09-20 | Workplan created | Leak-path audit over 20 candidate paths; allow-list grounded in the 28 plugin definitions and the two browser consumers |
| 2026-09-20 | SA workplan review (SA) | Verdict: approved with conditions (status: Revision Required on the boundary design). Every Dev claim re-verified by reading the routes: the leak at `available/route.ts:35`, env substitution in `plugin-manager-v2.ts:144-171`, 21 of 28 definitions env-substituting `client_secret`, Stripe = `${STRIPE_SECRET_KEY}`, the six `auth_config` fields `oauth-handler.ts` actually reads, and all four callers session-backed. Found **two further egress points Dev missed** - `/api/user/plugins` `_meta.connectedPluginData` and the two 500 bodies in `analyze-prompt-clarity` - both serialising `PluginDefinitionContext.plugin.auth_config`; leak-table row #14 corrected. Decisions: keep `client_id`; `llm/context` in scope; `plugins/suggest` in scope as minimal hardening (SA override); no BA requirement MD; allow-list approved as proposed; auth gate confirmed; boundary needs a **branded** wire type + `PluginDefinitionContext.toJSON()`; Stripe field mapping is correct-as-modelled (separate cleanup F2). Seven follow-ups raised for TL. |
