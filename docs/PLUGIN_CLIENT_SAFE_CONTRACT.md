# Plugin Client-Safe Contract (what may cross the server→client boundary)

> **Last Updated**: 2026-09-20

## Overview

Plugin definitions are **server-side secrets carriers**. `PluginManagerV2` substitutes every
`${ENV_VAR}` placeholder in a definition before caching it, so a cached
`plugin.auth_config` holds the platform's real OAuth client secrets — and for Stripe, the
full-privilege `STRIPE_SECRET_KEY`. This document defines the only fields that may be sent
to a client, the two mechanisms that enforce it, and the rules for changing them.

It exists because `GET /api/plugins/available` shipped the entire env-substituted
`auth_config` to **unauthenticated** callers, and two further routes leaked the same data
by serialising `PluginDefinitionContext` instances. See
[plugin-auth-config-exposure-workplan.md](/docs/workplans/plugin-auth-config-exposure-workplan.md).

## Table of Contents

- [The allow-list](#the-allow-list)
- [What is excluded](#what-is-excluded)
- [How it is enforced](#how-it-is-enforced)
- [Rules for contributors](#rules-for-contributors)
- [Changing the allow-list](#changing-the-allow-list)
- [Related follow-ups](#related-follow-ups)
- [Change History](#change-history)

---

## The allow-list

**File:** `lib/plugins/sanitize-plugin-definition.ts` → `CLIENT_SAFE_AUTH_CONFIG_FIELDS`

| Field | Why a client needs it | Secret? |
|---|---|---|
| `auth_type` | UI branches on it (`platform_key` / internal vs OAuth) | no |
| `auth_url` | the provider authorize endpoint the popup opens | no — public provider URL |
| `client_id` | the browser sets it on the authorize URL (`lib/client/oauth-handler.ts`) | no — public by OAuth 2.0 design, RFC 6749 §2.2 |
| `redirect_uri` | set on the authorize URL; derived from `NEXT_PUBLIC_APP_URL` | no |
| `required_scopes` | joined into the `scope` parameter | no |
| `user_scopes` | joined into `user_scope` (Slack separates bot and user scopes) | no |
| `requires_pkce` | selects the PKCE branch | no |

This set was derived from the **only** browser reader of `auth_config` in the repo —
`lib/client/oauth-handler.ts` — not from what looked harmless.

## What is excluded

Everything else, **including fields that do not exist yet**. As of 2026-09-20 the excluded
keys present in shipped definitions are:

`client_secret`, `token_url`, `refresh_url`, `profile_url`, `profile_method`,
`profile_headers`, `token_expiry_seconds`, `oauth_callback_profile_params`,
`additional_params`, `uses_basic_auth`, `token_format`, `supports_express_account`,
`_scope_note`.

All of these are used **server-side only** — the token exchange (`OAuthTokenService`), the
OAuth callback route, and `user-plugin-connections`. Nothing in the browser reads them.

## How it is enforced

Two independent layers, because a "remember to call the sanitiser" convention is exactly
the design that produced the original bug.

**1. A branded wire type (compile time).**

`ClientSafeAuthConfig` carries a required, `unique symbol` brand that only
`sanitizeAuthConfig()` mints. A narrow type alone would enforce nothing — `PluginAuthConfig`
is structurally assignable to a 7-field subset, and TypeScript's excess-property check fires
only on fresh object literals, so `auth_config: definition.plugin.auth_config` would compile
clean and leak at runtime. With the brand it is a **compile error**. `PluginInfo.auth_config`
(`lib/types/plugin-types.ts`) is typed with it, so every client-facing payload must pass
through the sanitiser. The brand is type-only, so it never appears in JSON — the wire shape
is unchanged.

**2. A serialisation choke point (runtime).**

`PluginDefinitionContext.toJSON()` (`lib/types/plugin-definition-context.ts`) returns a
sanitised `plugin.auth_config`. The class aliases the manager's cached definition, and
`NextResponse.json` stringifies it — which is how two routes leaked secrets without ever
writing the words `auth_config`. `toJSON` closes that class of bug for every current and
future caller in one place.

Neither layer replaces explicit route-level projection: `toJSON` does not protect a direct
`definition.plugin.auth_config` read, and the brand does not protect a route that returns
`any`.

**Tests that hold the line:**

| Test | Guarantees |
|---|---|
| `lib/plugins/__tests__/sanitize-plugin-definition.test.ts` | every secret-ish key (incl. an invented future one) is dropped; arrays are copied; the `@ts-expect-error` case proves the brand still rejects a raw config |
| `app/api/plugins/__tests__/no-secret-egress.test.ts` | cross-route sweep — no route serialises a sentinel seeded through `process.env`, including `analyze-prompt-clarity`'s two 500 paths |
| `app/api/plugins/available/__tests__/route.test.ts` | 401 unauthenticated; allow-listed keys only; visibility scoping intact |
| `app/api/plugins/__tests__/dead-plugin-routes-removed.guard.test.ts` | the two deleted endpoints stay deleted |

## Rules for contributors

1. **Never** put a `PluginDefinition`, a `plugin.auth_config`, or a `PluginDefinitionContext`
   into a response, a server-component prop, or an LLM prompt without projecting it.
2. Build client payloads with `toClientPluginInfo()` / `sanitizePluginDefinition()`, or
   project field by field. Never spread-then-delete.
3. A route that needs a secret (token exchange, refresh) reads it from the definition
   **server-side** and must not echo it — not even in an error body or a log line. The
   authorize URL itself is log-sensitive: it carries `client_id` and a `state` embedding
   `user_id`.
4. Definition **keys** are as revealing as values in an empty-env dev box, where
   substitution leaves `${STRIPE_SECRET_KEY}` verbatim. Assert on both in tests.

## Changing the allow-list

Adding a field widens the public contract, so it requires **SA sign-off** and:

1. evidence of the client that needs it (file + line), and that it cannot be served
   server-side instead;
2. confirmation the field is never env-substituted in any definition;
3. an update to `CLIENT_SAFE_AUTH_CONFIG_FIELDS`, this table, and the route test's
   allow-list assertion.

Do **not** widen the allow-list to revive dead client behaviour — see follow-up F6.

## Related follow-ups

| # | Item |
|---|---|
| F1 | Move OAuth authorize-URL construction fully server-side (PKCE + `user_scope` + popup-state parity). Would let `client_id` leave the wire entirely. |
| F2 | Stop storing secret *values* in definitions — declare the env var name and resolve it in a server-only credential resolver at point of use. |
| F4 | `console.*` → Pino in `analyze-prompt-clarity` (51) and full auth hardening of that route (it still accepts an `x-user-id` header). |
| F6 | `plugin-api-client.connectPlugin`'s `additional_config` branch is unreachable — fix the flow, do not widen the allow-list. |

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-20 | Created | Established the 7-field allow-list, the branded `ClientSafeAuthConfig`, and `PluginDefinitionContext.toJSON()` after the unauthenticated `auth_config` exposure on `GET /api/plugins/available` |
