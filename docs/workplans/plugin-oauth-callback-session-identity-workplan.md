# Workplan: Scope the plugin OAuth callback's identity to the session (S11.5-1)

> **Last Updated**: 2026-11-27

**Developer:** Dev
**Slice:** S11.5-1
**Branch:** `fix/s11-5-1-oauth-callback-session-identity` (off `origin/main` at `e797bc0d`). The slice was first written on `fix/plugin-oauth-callback-session-identity` at `115cedec` and never committed; see [Port to main (2026-11-27)](#port-to-main-2026-11-27).
**Requirement:** SA-approved scope handed over in-session (security slice; the finding itself is kept out of tracked text — see "Wording" below)
**Date:** 2026-11-07 (ported 2026-11-27)
**Status:** Code Complete (ported). SA port review 2026-11-27: approved for QA after Dev makes two Low fixes (F-1, F-2 in SA Review Notes). QA port pass 2026-11-27: PASS, ready for commit

## Overview

`app/oauth/callback/[plugin]/route.ts` decided **who** a vendor OAuth grant belongs to from the
`state` query parameter rather than from the session. This slice moves that decision to
`getUser()`, refuses on any disagreement, and does so **before** the token exchange runs.
The invariant this establishes: **identity is session-scoped; the state is never an identity
source.**

**That claim, and no larger one.** The state is still unsigned and is not yet bound to the flow
that issued it, so this slice does **not** make the callback trustworthy end to end. Binding the
state to its flow (signed state) is the next slice. Nothing in this workplan or in the code
comments may be read as claiming otherwise.

## Table of Contents

- [Analysis Summary](#analysis-summary)
- [Implementation Approach](#implementation-approach)
- [Files to Create / Modify](#files-to-create--modify)
- [Task List](#task-list)
- [Out of Scope](#out-of-scope-this-slice)
- [SA Review Notes](#sa-review-notes)
- [QA Testing Report](#qa-testing-report)
- [Port to main (2026-11-27)](#port-to-main-2026-11-27)
- [QA Testing Report — port (2026-11-27)](#qa-testing-report--port-2026-11-27)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## Analysis Summary

| Surface | What it does today |
|---|---|
| `app/oauth/callback/[plugin]/route.ts` | Unauthenticated `GET`. Never calls `getUser()`. No Zod. Passes `state` through, reflects `error.message` into the HTML with no `NODE_ENV` guard, and logs every query parameter **value** in one WARN. |
| `lib/server/user-plugin-connections.ts` → `handleOAuthCallback` | `JSON.parse(decodeURIComponent(state))` into an implicit `any`, then takes `user_id` and `plugin_key` out of it and upserts the vendor tokens under them. The failure-path audit also attributes itself to `state.user_id`. |
| `lib/repositories/PluginConnectionRepository` | Runs on `supabaseServer` (**service role**) and upserts with `onConflict: 'user_id,plugin_key'`. |

**`tenant-isolation-guard` applies, and this is exactly its case:** service role (RLS bypassed)
+ a **caller-supplied id** + an **upsert conflict target** the caller can aim. The skill's
"scope-defeating three" names the upsert-conflict shape directly. The repository being
`user_id`-scoped is **not** a mitigation here, because `user_id` *is* the caller-supplied field.

> **RLS on `plugin_connections` must never be cited as a mitigation for this path — it is
> bypassed.** The route/service is the tenant-isolation boundary.

Gate cleared before this slice (SA): the Supabase auth cookie **does** reach this route on a
cross-site top-level `GET` from the vendor. Measured with a paired, failable probe — cookie
present → `200` with payload, same path with no cookie → `401`. So `getUser()` here is viable
and fail-closed is correct.

Both state producers (`app/api/v2/plugins/connect/route.ts`, `lib/client/oauth-handler.ts`)
always send `user_id` and `plugin_key`, so in-flight flows must keep working: the fields are
**tolerated**, never **trusted**.

## Implementation Approach

1. **Identity is a required parameter, not a parsed field.** `handleOAuthCallback` gains required
   `userId` and `pluginKey` parameters and stops destructuring `user_id` / `plugin_key` from the
   parsed state entirely. An optional parameter with a state fallback would leave the old path
   alive for the next caller, so there is no fallback: the positional signature change makes any
   caller that does not supply an identity a compile error. Only `code_verifier` is still read
   from the state.
2. **The checks run before `exchangeCodeForTokens`.** Refusing after the exchange would mint a
   live vendor grant for a request we then discard — an unrevoked token with no owner — and
   would give an unauthenticated `GET` a free outbound call. So: session → state checks →
   plugin definition → only then the service call.
3. **Disagreement refuses; it is not silently overridden.** Writing under the session id while
   ignoring a state that named someone else is itself the wrong outcome (the write still lands on
   the signed-in user). Refusing keeps the bar at "must already know the target id" and gives us
   a detector.
4. **`plugin_key` is the path segment.** Tokens are exchanged with the **path** plugin's
   `auth_config`, so storing them under a `plugin_key` from the state can label a grant as a
   different surface than the one whose scopes it carries. Route param wins; a mismatching state
   refuses.
5. **Zod at the boundary** (CLAUDE.md rule 2): a query schema (`code`, `state`, length-capped)
   and a state schema (`user_id` **required** uuid, `plugin_key` string, `code_verifier` optional,
   unknown keys stripped). The state schema lives in `lib/validation/` so the route and the
   service share one definition. `user_id` is required (SA review, non-blocking item 2): both
   producers always send it, so requiring it costs no real flow, and a callback that arrives
   without one is then refused rather than accepted on the session alone. It is still only ever
   **compared** — never read as the identity.
6. **Refusals are audited with the bounded writer, not with a hand-rolled log-then-flush.**
   New catalogued event `PLUGIN_AUTH_REFUSED` in **both** `AUDIT_EVENTS` and `EVENT_METADATA`
   (`getEventMetadata` falls back to `info` with no compliance flags for an unknown action, which
   would make the row invisible in the admin filter). Attributed to the **session user or
   `null`** — never to the state.

   The write goes through `logAndFlush` (`lib/audit/boundedAuditFlush.ts`). **This is SA finding
   B1 and it was a real defect in the first revision:** `AuditTrail.log()` awaits
   `buildLogEntry()` *before* it queues, so a `flush()` issued in the same tick finds
   `logQueue.length === 0`, takes its early return, reports success and leaves the row to the
   5-second batch timer that a freezing serverless instance beats. `logAndFlush` chains
   `log() → flush()`, is bounded by `AUDIT_FLUSH_TIMEOUT_MS`, serialises against other callers
   and never rejects. Because it owns both halves, **no path here depends on how many awaits sit
   between the queue and the response** — which is why the success and failure rows moved to the
   same helper inside `handleOAuthCallback` instead of being flushed at the call site, where they
   were only flushing *incidentally* (one intervening await each).

   `lib/audit/recordRefusedAccess.ts` is the sibling precedent and its **conventions are
   followed** — no `request` on a refusal row (SA D-1: `extractRequestContext` copies a bearer or
   refresh token into `session_id`, so a refusal row must never become a place credentials
   accumulate; ip and user-agent go in `details`, omitting the key when unknown), and no
   `severity` / `complianceFlags` at the call site (the PR #157 / #160 lesson — the registration
   owns the classification). The module itself is **not** reusable here: it is the single writer
   of `SECURITY_UNAUTHORIZED_ACCESS`, with a test-pinned surface list and the fixed reason
   `not_an_admin`, none of which describe a plugin callback.
7. **Telemetry that licenses the next step.** The refusal WARN carries `correlationId`, `plugin`
   and a boolean "was an auth cookie present at all" — and never the state or the code. That
   boolean is what will later justify making the cookie mandatory with evidence.
8. **Stop logging secrets.** The profile-param WARN logged `Object.fromEntries(searchParams)` —
   i.e. the `code` and the whole `state` verbatim. There is **no redaction backstop**:
   `lib/logger/config.ts` deliberately does not redact `code` (so `err.code` survives) and
   nothing matches `state`, `received.*` or `code_verifier`. It now logs `Object.keys(...)` —
   parameter **names** only. The sibling `logger.info({ profileData })` is left alone:
   `phone_number_id` / `waba_id` are identifiers, not secrets.
9. **No internal detail in the HTML.** The catch block's `error.message` (which can be
   `OAuth credentials not configured`, or whatever the vendor token endpoint returned) goes
   behind `process.env.NODE_ENV === 'development'`, per CLAUDE.md § Error Response Format.
10. **`escapeJs` → `JSON.stringify`** (the optional hardening): the message payload is serialised
    once and injected with `</`, U+2028 and U+2029 escaped, instead of hand-built single-quoted
    literals that did not cover `\r` or the two separators. Note `postMessage(msg, '')` **throws**
    in the browser when `NEXT_PUBLIC_APP_URL` is unset, so no server-side decision — least of all
    a refusal — may depend on the opener hearing anything.
11. **The refusal is also rendered in the page body** (SA review, non-blocking item 3). The body
    used to be empty on a failure, so the message reached the user only through that
    `postMessage`. When it throws on an empty origin the script aborts before `window.close()`,
    which is exactly when the user needs to see something — so the text is in the HTML too,
    escaped.

## Files to Create / Modify

| File | Action | Reason |
|------|--------|--------|
| `lib/validation/oauth-callback-schema.ts` | create | Shared Zod state schema (`user_id` required, unknown keys stripped) + max lengths, used by the route and the service |
| `app/oauth/callback/[plugin]/route.ts` | modify | `getUser()` before the exchange, Zod on query + state, refusal path (`logAndFlush` + WARN, no `request`), `NODE_ENV`-guarded error text, `Object.keys` logging, `JSON.stringify` payload, refusal text in the body |
| `lib/server/user-plugin-connections.ts` | modify | `handleOAuthCallback` takes required `userId` + `pluginKey`; stops reading identity from the state; connection and failure rows written through `logAndFlush`; failure audit attributed to the session id; PKCE-is-decorative comment at the `code_verifier` read site |
| `lib/audit/events.ts` | modify | Catalogue `PLUGIN_AUTH_REFUSED` in `AUDIT_EVENTS` **and** `EVENT_METADATA` (severity `warning`, SOC2) |
| `lib/audit/eventAudience.ts` | modify | Tag the new event `shared` — `lib/audit/__tests__/eventAudience.test.ts` requires the audience map to be **exhaustive** over the catalogue, so adding the event without this fails that guard |
| `lib/audit/__tests__/eventAudience.test.ts` | modify | Move the pinned split (236 → 237, shared 79 → 80) with a `+1` provenance line, the convention that file already follows |
| `app/oauth/callback/[plugin]/__tests__/route.test.ts` | create | The four invariant locks (plus three adjacent ones) |

## Task List

- [x] Step 1: Branch off `origin/main` (`fix/plugin-oauth-callback-session-identity`)
- [x] Step 2: Write this workplan
- [x] Step 3: Add the shared Zod state schema + query schema
- [x] Step 4: `handleOAuthCallback` — required `userId` / `pluginKey`, no identity from the state
- [x] Step 5: Route — `getUser()` and both agreement checks **before** the service call
- [x] Step 6: Catalogue `PLUGIN_AUTH_REFUSED`; audit the refusal as session-user-or-null
- [x] Step 7: WC-7 durability — every row written through `logAndFlush`, no path dependent on hop count (revised after SA B1)
- [x] Step 8: Refusal WARN with `correlationId`, `plugin`, cookie-present boolean
- [x] Step 9: `Object.keys` in the profile-param WARN
- [x] Step 10: `NODE_ENV` guard on the HTML error text
- [x] Step 11: `JSON.stringify` payload hardening (optional item, done)
- [x] Step 12: PKCE-is-decorative comment at the `code_verifier` read site
- [x] Step 13: Tests — four cases, all seams mocked (`getUser`, repository, `OAuthTokenService`, `AuditTrail.log` **and** `.flush`)
- [x] Step 14: Run the new suite + the neighbouring plugin/audit suites; typecheck the touched files

### Verification run (after the SA revision)

| Check | Result |
|---|---|
| `npx jest app/oauth/callback` | **9/9 pass** |
| `npx jest app/oauth/callback lib/audit lib/validation app/admin/audit-trail/.../filterOptions.guard` | **28 suites, 500 tests pass** |
| `npx jest` on the five suites that import `user-plugin-connections` | **5 suites, 70 tests pass** |
| `tsc --noEmit` (full project, 8 GB heap so it does not OOM; plus a focused re-run over the touched files) | 1898 pre-existing errors repo-wide, **0 in any file this slice touches** |
| `eslint` on the touched files | 0 errors; warnings only — `no-explicit-any` (each commented) and one pre-existing unused import |
| **Failable probe for the B1 fix** | The ordering was temporarily reverted to `log()` + `flush()` in the refusal path: **6 of 9 tests failed** (`writtenRow('PLUGIN_AUTH_REFUSED')` → `undefined`). Restored, 9/9 green. So the new assertion can fail, and it fails on exactly the regression it guards. |

Two `app/admin/audit-trail/*.render.test.tsx` suites failed **only** under a full parallel run and
pass in isolation (8/8 and 6/6) — jsdom timing, unrelated to this change (they render the audit
page from mocked rows).

## Out of Scope (this slice)

| Item | Why it is not here |
|---|---|
| Signing the state / adding a nonce | The next slice. This one removes the identity dependency; signing removes the forgeability. |
| Moving state issuance server-side; touching `lib/client/oauth-handler.ts`, `lib/client/plugin-api-client.ts`, `app/api/v2/plugins/connect/route.ts` | Also the next slice. Consolidating the URL building naively drops `access_type=offline` for every non-Google non-PKCE plugin, producing connections that die after an hour. |
| Removing `code_verifier` from the state | PKCE is **decorative** on this path until the state is signed: the verifier travels inside the same client-chosen blob as the challenge, so it proves nothing about the requester. Removing it would break the three `requires_pkce` plugins (airtable, dropbox, salesforce) for no gain. A comment at the read site says so, so nobody cites PKCE as a mitigation in a later review. |
| `lib/plugins/strategies/slackPluginStrategy.ts:437` | Dead V1 surface with its own implementation. Left untouched (CLAUDE.md § Deprecated). |
| Making the auth cookie mandatory in a middleware/matcher sense | Licensed later by the telemetry this slice adds. |
| **`lib/server/user-plugin-connections.ts` `generateOAuthState`** (SA comment 7) | Now has no callers — the surviving generator is the client one in `lib/client/oauth-handler.ts`. Deleting it belongs with the slice that removes that generator, so the diff is one change, not two halves. **Deferred, verified dead:** the only references in `app`, `lib` and `components` are the client method and this definition. |
| **The provider-error branch** (`?error=…&error_description=…`, SA comment 5) | Reflected and logged with no Zod and no length cap, before the session check. SA rates it Low and safe to render today (`serializeForScript` escapes it). **Deferred on SA's ruling — do not fix here.** |

### postMessage listener inventory (full set, for the next slice)

The response shape (`type`, `plugin`, `success`, `error?`, `data?`) is read by six listeners, all
compatible and none status-dependent: `lib/client/oauth-handler.ts`,
`lib/plugins/strategies/slackPluginStrategy.ts`, `lib/plugins/strategies/chatgptResearchStrategy.ts`,
`components/business-os/leads/InboxChannelSetupDialog.tsx`,
`components/payments/StripeConnectWizard.tsx` and **`hooks/useChannelConnect.ts:141-142`** (the
sixth, which SA added). The 401 change deferred to the signing slice has to clear all six.

### Wording

Commit/PR wording for this slice is **"scope the plugin OAuth callback's identity to the
session"**. No attack narrative, no sample state, no exploit string in any tracked file, test
name or comment — the guards and tests are worded as invariants. The finding itself stays in the
private notes.

### Deprecated patterns noticed, not extended

- `lib/plugins/strategies/slackPluginStrategy.ts` (V1 strategy system) has its own OAuth callback
  handling. Flagged, untouched.
- No `console.*` in any file touched by this slice (`route.ts`, `user-plugin-connections.ts`,
  `lib/audit/events.ts` — all 0 occurrences), so CLAUDE.md § Logging's flag/propose/convert step
  does not arise.

## SA Review Notes

**Code Review by SA — 2026-11-07**
**Status:** 🔄 Fix Required (two findings; the invariant itself is correct and verified)

The central claim holds. Verified by reading the chain, not the summary: identity on this path
now comes only from `getUser()` and the plugin only from the route segment; `handleOAuthCallback`
reads nothing but `code_verifier` out of the state; the upsert's conflict target is built from
both session-derived values; and `connection.user_id` handed to `extractPluginProfileData` is the
row returned by `.select().single()` after a write whose `user_id` was the session id. The
session check and both agreement checks sit at route.ts:217-238, ahead of
`PluginManagerV2.getInstance()` and of `exchangeCodeForTokens` — there is no path that exchanges
first. The four invariant tests assert the *absence* of the exchange and the upsert, and the
happy-path test proves the mocks allow success, so nothing passes by accident.

### Code Review Comments

1. **`app/oauth/callback/[plugin]/route.ts:154-175` — the awaited WC-7 flush on the refusal path
   is a no-op; the refusal row is not durable. Priority: High (blocking).**
   `AuditTrail.log()` is `async` and `await`s `buildLogEntry()` *before* pushing to the queue
   (`AuditTrailService.ts:114-117`). `refuse()` does not await `log()`, and `flushAudit()` calls
   `flush()` synchronously — so `flush()` reads `logQueue.length === 0` and takes its early
   return (`AuditTrailService.ts:307`) before the entry is ever queued. Measured: with **0**
   awaits between `log()` and `flush()` the queue is empty; with **1** or more the row is
   visible. The refusal path has zero. The success and failure paths each have at least one
   intervening await, so `PLUGIN_CONNECTED` / `PLUGIN_AUTH_FAILED` do flush — but only
   incidentally. Fix: use `logAndFlush` from `lib/audit/boundedAuditFlush.ts`, which chains
   `log().then(() => flush())` and is bounded and non-throwing; `lib/audit/recordRefusedAccess.ts`
   is the established precedent for exactly this kind of row.
2. **`app/oauth/callback/[plugin]/route.ts:162` — `request` passed to the audit service on a
   refusal row. Priority: Medium (fix in this slice).** `extractRequestContext` copies a bearer
   or refresh token into `session_id` when the legacy `sb-access-token` / `sb-refresh-token`
   cookie names are present (`AuditTrailService.ts:265-272`). A prior SA ruling (SA D-1, recorded
   in the `recordRefusedAccess` header) settled that a refusal row must never pass `request` and
   must carry ip/user-agent in `details` instead. With `@supabase/ssr` cookie names the lookup
   falls through today, so nothing is captured in practice — but the rule exists so this does not
   become a place credentials accumulate.
3. **`route.ts:169-170` — `severity` and `complianceFlags` passed at the call site *and*
   registered in `EVENT_METADATA`. Priority: Low.** Same values, so no behaviour change, but the
   documented lesson of PR #157/#160 is that the registration owns the classification. Drop both
   from the call site.
4. **`lib/validation/oauth-callback-schema.ts:53` — `user_id` optional leaves the omit-the-field
   case open. Priority: Medium (recommended, not blocking).** Every producer
   (`lib/client/oauth-handler.ts:177`, `app/api/v2/plugins/connect/route.ts:66-70`) always sends
   it, so making it required costs no legitimate flow and narrows what an unsigned state can
   still carry (see the residual below). Test (iii-b) currently locks the
   opposite; it would become "a state that omits the account is refused". The full fix is the
   signed-state slice either way.
5. **`route.ts:186-194` — the provider-error branch reflects `error` / `error_description`
   with no Zod and no length cap, before the session check. Priority: Low.** Safe to render
   (the new serialiser escapes it) but it is an unvalidated boundary under CLAUDE.md rule 2 and
   an unbounded string in a log line.
6. **`route.ts:60-62` — the refusal page body is empty. Priority: Low.** The refusal text reaches
   the user only through `postMessage`, which **throws** when `NEXT_PUBLIC_APP_URL` is unset. In
   that configuration the user gets a blank page and no explanation anywhere. Rendering
   `REFUSED_MESSAGE` in the body on the failure path costs nothing and does not depend on the
   opener.
7. **`lib/server/user-plugin-connections.ts:793` — `generateOAuthState` now has no callers.
   Priority: Low.** Dead code that still embeds `user_id` in a state blob; the signing slice
   should delete or replace it.

### Rulings requested

- **200 vs 401 on the refusal: 200 is accepted for this slice.** Nothing client-side reads the
  status (all six listeners key off `postMessage`), the refusal is already final server-side, and
  the HTML must still render so the popup closes. 401 with the same body would be more honest for
  logs and WAF rules and is worth doing in the signing slice — not a reason to turn this cycle.
  Conditions: the body must keep rendering (no redirect, no empty 401), and nothing may become
  dependent on the opener hearing the message.
- **`escapeJs` → `JSON.stringify`: approved, this is a real hardening.** Payload keys and order
  are byte-identical (`type`, `plugin`, `success`, `error?`, `data?`) and all six listeners —
  `oauth-handler`, `slackPluginStrategy`, `InboxChannelSetupDialog`, `StripeConnectWizard`,
  `chatgptResearchStrategy` and `hooks/useChannelConnect.ts` (a sixth Dev did not name) — read
  only those fields. `serializeForScript` escapes `<` (so no `</script` can close the block),
  U+2028 and U+2029, and `JSON.stringify` covers the quoting, `\r` and the other control
  characters the hand-rolled escaper missed. No XSS path remains through `plugin`, `error` or
  `data`.
- **Audit registration: `shared` is the right audience** (consistent with `PLUGIN_AUTH_FAILED`
  and the whole `PLUGIN_*` block), and `warning` / `SOC2` / `entityType: 'connection'` are all
  valid catalogue values. **Moving the pinned count is the correct way to satisfy the guard**, not
  a way of silencing it: the pin is a provenance ledger and the `+1` line naming the slice is the
  convention the file already follows. No other registration is owed — the admin filter derives
  from `AUDIT_EVENTS` + `eventAudience`, so the event is selectable with no UI change.
- **Zod: `.strip()` is correct** — both producers send `timestamp` and `random`, so `.strict()`
  would refuse every genuine callback. The query schema gates before anything reads `code` or
  `state`, and `JSON.parse` exists at exactly one site, inside the `try` of
  `parseOAuthCallbackState`.
- **Nothing found that breaks a legitimate connect.** Plugin name equals the callback path
  segment for all 21 OAuth definitions, `getPluginDefinition` does no aliasing, both producers
  send a matching `plugin_key`, Stripe Connect uses its own callback and is unaffected, and the
  4096/256 caps are far above any real code or RFC 7636 verifier. One accepted operational trade,
  worth naming: `getUser()` returns `null` for an auth-server blip as well as for a signed-out
  caller (`lib/auth.ts` says so), so a blip now costs the user a restarted connect instead of a
  wrong-account write. The `auth_cookie_present` boolean is what makes that case distinguishable
  after the fact — which is the right design.
- **The RLS reasoning in this workplan does not depend on the belief we have since corrected**
  (PostgreSQL applies a table's SELECT policy to the NEW row of an UPDATE; `WITH CHECK (true)`
  does not exempt it). §Analysis Summary correctly states RLS is bypassed on this path and is
  never a mitigation. Nothing to correct.

### Residual, correctly deferred

Identity can no longer be *chosen* by the caller. What remains is that the state is not yet
bound to the flow that issued it. Only signed / nonce-bound state closes that, which is the next
slice; comment 4 narrows it meanwhile. The detail is kept in the private notes, not here.

### Notes for RM

Five untracked paths in the tree are **not** part of this slice and must not be committed with
it: `app/admin/audit-trail/__tests__/zz.probe.test.tsx`, `lib/audit/__tests__/__probe.test.ts`,
`docs/ENVIRONMENTS_AND_DEPLOYMENT_STRATEGY.md`,
`docs/workplans/environment-readiness-staging.md`, `scratchpad/`.

### Code Approved for QA: No — comments 1 and 2 first, then this returns for a short re-review.

### Dev responses — 2026-11-07 (all seven addressed)

1. **B1, the no-op flush — Fixed by Dev.** The refusal row now goes through
   `logAndFlush(entry, requestLogger, { reason: 'refused plugin OAuth callback', continues: 'the
   refusal is unaffected' })`. SA's measurement is right and the fix is the one SA named. I also
   took the second half of the comment: the success and failure rows no longer flush
   *incidentally* at the call site — `handleOAuthCallback` writes both through `logAndFlush`
   itself, so **no path here depends on how many awaits sit between the queue and the response**.
   `flushAudit()` is gone from the route, and the route no longer imports `AuditTrail` at all.
   `recordRefusedAccess` was considered and is not reusable (single writer of
   `SECURITY_UNAUTHORIZED_ACCESS`, test-pinned surfaces, fixed reason `not_an_admin`) — its
   *conventions* are followed instead, and the reason it does not fit is recorded at the call
   site so the next reader does not re-ask.
   **Why the old test missed it, and what replaces it:** `expect(auditFlush).toHaveBeenCalled()`
   proved a call, not a row. The suite now drives a faithful fake sink — `log()` awaits once then
   queues, `flush()` returns early on an empty queue — and every assertion is made on what
   reached `written`. Proven failable: reverting the refusal path to the old ordering turns 6 of
   the 9 tests red with `writtenRow('PLUGIN_AUTH_REFUSED')` → `undefined`.
2. **B2, `request` on a refusal row — Fixed by Dev.** Not passed. `refusalRequestDetails(request)`
   puts `ip_address` and `user_agent` in `details`, omitting either key when the header is absent
   (the not-captured-vs-captured-as-unknown distinction `recordRefusedAccess` makes). The reason
   — `extractRequestContext` copying a bearer/refresh token into `session_id`, SA D-1 — is cited
   in the comment. Locked by test (i-c).
3. **Duplicate classification at the call site — Fixed by Dev.** `severity` and
   `complianceFlags` dropped from the refusal entry; `EVENT_METADATA` owns them. Asserted absent
   in test (i). Left in place on the pre-existing `PLUGIN_CONNECTED` / `PLUGIN_AUTH_FAILED`
   entries, which this slice did not otherwise re-classify.
4. **`user_id` required — Done by Dev.** `z.string().uuid()`, no `.optional()`. The route's check
   is now a plain `!==`. Test (iii-b) flipped as SA predicted: it asserts that a callback which
   does not name the account is **refused** (`reason: 'state_unreadable'`, the schema rejecting
   the blob) with no exchange and no write.
5. **Provider-error branch — Deferred, recorded** in Out of Scope on SA's Low rating. Not touched.
6. **Empty refusal body — Done by Dev.** `buildPostMessageResponse` takes an optional
   `bodyMessage`, HTML-escaped, and the refusal passes `REFUSED_MESSAGE`. Because the throwing
   `postMessage` aborts the script before `window.close()`, the text stays on screen in exactly
   the configuration SA described. Locked by a test asserting the body text. Nothing on any path
   depends on the opener hearing the message.
7. **`generateOAuthState` — Deferred, recorded** in Out of Scope, with its deadness verified (no
   callers anywhere in `app`, `lib`, `components`). Left for the slice that removes the client
   generator.

Also taken: the **wording** correction. The route header now says "identity is session-scoped",
names the residual (state not yet bound to its flow) and states explicitly that this does **not** make the
callback unforgeable; the workplan's Overview says the same. The sixth listener is added to the
inventory above.

**Re-review needs only the new `refuse()` body** (`app/oauth/callback/[plugin]/route.ts`), the two
`logAndFlush` calls in `lib/server/user-plugin-connections.ts`, and the fake sink at the top of
the test file.

### SA re-review (second pass) — 2026-11-07

**Status:** ✅ Code Approved for QA. Both blocking findings are genuinely fixed; the two changes
that went beyond the findings are correct. Nothing further is required before QA.

**B1 — fixed, and the wider change is right.** One correction to how it is being described: the
success and failure rows did **not** move across a module boundary. They were always written
inside `handleOAuthCallback` (through the private `this.audit()` helper); the route only ever held
the `flushAudit()` call. What changed is that the writer now owns durability instead of delegating
it to its caller, which is better layering, not new coupling — and the service already imported
`AuditTrail` and `AuditLogInput`, so `logAndFlush` adds no new dependency direction. `this.audit()`
still has one other caller (line 548), so nothing is left dead.

Row-count check, which was the right thing to ask: **exactly one row per audited outcome, never
two and never none.**
- Refusal → one `PLUGIN_AUTH_REFUSED` from the route; the service is never entered.
- Success → one `PLUGIN_CONNECTED` / `PLUGIN_RECONNECTED` from the service. The await cannot
  divert into the `catch` and add a second row, because `logAndFlush` never rejects: its
  `Promise.race` sits inside a `try/catch` and `enqueue` sets `pending` to a never-rejecting
  chain (`boundedAuditFlush.ts:155-162, 199-222`).
- Failure → one `PLUGIN_AUTH_FAILED`, then the rethrow, which is the only thing that leaves.
- The unaudited outcomes (provider error, invalid query, plugin definition missing, and any
  route-level throw outside the service) write nothing — unchanged from before this slice.

Both rows carry session-derived identity from inside the service: `userId` is the required
parameter, `entityId` is `data.id`, `resourceName` / `details.plugin_key` is the route segment,
and the failure row's `userId || null` / `pluginKey || undefined` are reachable only if a future
caller skips the guards at the top of the method (this route cannot).

**`recordRefusedAccess` rejection: accepted.** Dev's reasoning matches that module's own header —
it is the single writer of `SECURITY_UNAUTHORIZED_ACCESS`, with a test-pinned surface list and the
fixed reason `not_an_admin`. Widening it to describe a plugin callback would have damaged a
deliberately narrow writer. The reuse point was `logAndFlush` plus that module's conventions (no
`request`, metadata in `details`, classification in `EVENT_METADATA`), and all three landed.

**B2 — fixed.** `refusalRequestDetails` (route.ts:130-138) reads the two headers from the
`NextRequest` the handler already holds, omits an absent key rather than writing 'unknown', and no
`request` reaches the audit service on the refusal row. Test (i-c) locks both halves.
*Residual, not for this slice:* `request` is still passed on the pre-existing `PLUGIN_CONNECTED`
and `PLUGIN_AUTH_FAILED` rows, so the `session_id` concern applies to those two. They are not
refusal rows and this slice did not re-classify them — a follow-up candidate, Low.

**The fake sink is faithful at the boundary that matters.** Real `log()` resumes after awaiting an
async `buildLogEntry` and only then queues; measured against the real shape, **0** intervening
awaits leaves the row invisible to `flush()` and **1** makes it visible. The fake behaves
identically at 0 and 1, so it fires on exactly the regression it exists to catch, and the
assertions read `written` rather than "flush was called". Two deliberate simplifications, neither
affecting this guard: it does not model the `isFlushing` early return (the documented
concurrent-flush limit) or the `batchSize`-triggered flush. The real `logAndFlush` is **not**
mocked, which is the correct seam.

*One number to recheck, not a finding:* seven tests assert `writtenRow('PLUGIN_AUTH_REFUSED')` —
(i), (i-b), (i-c), (ii), (iii-b), (iv) and "refuses an unreadable state" — so restoring the old
ordering should turn **7** red, not 6. The guard is structurally failable either way. If one
refusal test really stayed green, name it: that would mean its row is written on a path not
accounted for here.

**Ruling on `state_unreadable` for a missing `user_id`: accepted for this slice, with a Low
recommendation.** The stated purpose of this slice's telemetry is to license the next step, and
"valid JSON with no `user_id`" is precisely the shape the signing slice will need to count — conflating it with "not
JSON at all" loses the signal that argument will need. Cheapest fix keeping one code path: add a
shape marker to `details` (`state_shape: 'unparseable' | 'invalid'`), or give
`parseOAuthCallbackState` a discriminated return. Not worth another cycle; the signing slice
removes the question.

**Confirmations asked for:** leaving `severity` / `complianceFlags` in place on the pre-existing
`PLUGIN_CONNECTED` / `PLUGIN_AUTH_FAILED` entries is exactly the line intended — the comment was
about the new call site only. The `escapeHtml` helper is correct for the one context it is used in
(text content in `<body>`, never an attribute), and `REFUSED_MESSAGE` is a constant in any case.

**Accepted cost, recorded:** each audited path now awaits up to `AUDIT_FLUSH_TIMEOUT_MS` plus any
wait behind the shared `logAndFlush` chain. For the success path this replaces the previous awaited
flush (no regression); for the refusal path it is new, bounded, and on an interactive low-volume
route — the same cost `recordRefusedAccess` documents. A timed-out `logAndFlush` still returns, so
under chain contention a row can be left to a link a freezing instance may not run: the helper's
documented bound, and strictly better than what was there.

**Nits for QA, none blocking:** (a) no case locks the third audited path — `exchangeCodeForTokens`
rejecting should write exactly one `PLUGIN_AUTH_FAILED` to the sink, attributed to the session,
with the route still answering `success:false`; this revision is what made that row durable, so it
is worth a test. (b) The suite does not call `__resetAuditFlushChainForTests()` in `beforeEach`;
every link settles within each test today, so there is no bleed, but it would make the file robust
if a future case deliberately hangs a flush.

**Verified independently:** `npx jest app/oauth/callback lib/audit lib/validation` → 28 suites,
492 tests pass; eslint on the four touched files → 0 errors, 6 warnings (all commented
`no-explicit-any`, plus the pre-existing `refreshAccessToken` unused import). The RM note above
still stands — and note that `lib/audit/__tests__/__probe.test.ts`, which must not be committed, is
inside that suite count.

### Code Approved for QA: Yes

### SA port review (third pass) — 2026-11-27

**Code Review by SA — 2026-11-27**, of the port onto `e797bc0d` described in
[Port to main (2026-11-27)](#port-to-main-2026-11-27). Reviewed `git diff HEAD` in the port
worktree plus the two untracked files (`lib/validation/oauth-callback-schema.ts`, this workplan).
**Status:** ✅ Code Approved for QA, **with two Low fixes Dev makes first** (F-1, F-2 below). Neither
needs another SA pass; QA confirms both.

#### The invariant, re-traced on the ported code

Every path that leaves `GET` was walked, and none reaches `exchangeCodeForTokens` before the
identity checks:

| Path | Exchange reached? | Write? | Row |
|---|---|---|---|
| Provider `?error=` | No (returns before the query check) | No | None (unchanged, deferred comment 5) |
| Query fails Zod | No | No | None |
| `getUser()` null / throws | No (`refuse` / the catch) | No | `PLUGIN_AUTH_REFUSED`, `userId: null` / none on a throw |
| State unreadable, user or plugin mismatch | No | No | `PLUGIN_AUTH_REFUSED`, session id |
| Plugin definition missing | No | No | None |
| Service: empty `userId` / `pluginKey`, or state fails the schema | No (all three throw above the exchange) | No | `PLUGIN_AUTH_FAILED`, session id |
| Exchange or upsert fails | Yes, after every check | No | `PLUGIN_AUTH_FAILED`, session id |
| Success | Yes | Upsert keyed on (`userId`, `pluginKey`) params | `PLUGIN_CONNECTED` / `_RECONNECTED`, session id |

`handleOAuthCallback` reads only `code_verifier` from the state; `parseOAuthState` and
`OAuthState` are gone with no remaining reference. The route is still the method's only caller
(`StripeService.handleOAuthCallback` and the V1 strategy are unrelated methods of the same name).
The only other route in `app/` that reads a `state` query value is the Stripe Connect callback,
which is session-scoped already. Dev's finding stands: **no code that landed since `115cedec`
takes an identity from the state or writes a grant before the session check.**

**Main's later behaviour survives**, checked hunk by hunk. The route diff removes only the old
`code` / `state` reads and the `if (!code || !state)` block. Still in place: `escapeJs` and its
hardening, the generic `'OAuth callback failed'` + development-only `details`, `receivedKeys` /
`storedParams` names-only logging, the no-opener success fallback, and the typed
`extractPluginProfileData`. The service diff is confined to `handleOAuthCallback` and the removed
helper. Refresh coalescing, dead-grant marks, `updateRefreshedToken` / `updateSettings` and the
token-fingerprint diagnostics are not in any hunk.

#### Rulings

- **R-1 — main's `escapeJs` in place of `serializeForScript`: accepted.** The approval was for
  what the serialiser achieved, not for `JSON.stringify` as such, and main's escaper achieves the
  same for this sink. Every interpolated value sits in a single-quoted JS literal inside
  `<script>`. Backslash is escaped first (so later escapes cannot be undone), then `'`. All four
  JS line terminators (`\n`, `\r`, U+2028, U+2029) are covered. `<` / `>` become JS hex escapes,
  so neither `</script>` nor `<!--` can form. The other control characters are legal inside a JS
  string literal and cannot end it. The `data` keys are four fixed literals in the route, and
  `success` is a boolean, so nothing unescaped is caller-influenced. Main's
  "runs, and hands the opener the provider text unchanged" case executes the script with every
  hostile character at once, which is stronger evidence than the original review had. One
  serialiser in the file is better than two.
- **R-2 — the service refuses any state that fails the full schema: confirmed.** It is
  fail-closed, it sits inside the `try` and above the exchange, and it is audited as
  `PLUGIN_AUTH_FAILED` with the generic `Invalid state`. That is main's contract, and
  `aMalformedOAuthStateIsNotEchoed` locks it. The route parses the same input with the same
  function first, so the two cannot disagree and no real flow reaches the service-level refusal.
  The double parse is cheap and deliberate: the service must stay fail-closed for any future
  caller that skips the route's checks. Being stricter than the field it reads (a non-uuid
  `user_id` refuses although only `code_verifier` is used) is the right direction for a
  service-role write path.
- **R-3 — the instant-close refusal page and the opener's `isPluginConnected` fallback: defer to
  the signing slice, as Dev recommends.** Three reasons:
  1. **It is not specific to the refusal.** On main today, every failure page with no opener
     (catch block, invalid query, missing definition) runs `window.close()` at once. The same
     fallback then reports success on a reconnect of an already-active plugin. This slice adds
     one more failure reason to an existing behaviour.
  2. **The obvious in-slice fix does not fix it.** Keeping the refusal page open shows
     `bodyMessage`. But when the user closes that page, the opener's poll runs the same
     `isPluginConnected` check and still reports success. The real fix is on the opener side:
     the check must tell a connection made by *this* round trip from one that already existed,
     for example a `connected_at` / `updated_at` later than the popup's open time, or a
     server-issued flow id. That belongs with moving state issuance server-side.
  3. **Nothing is written, and the invariant holds.** The previous grant is untouched and still
     works, so the false "connected" misleads only about whether the grant was refreshed.

  **Condition on the deferral:** the signing slice's requirement must carry this as an
  acceptance criterion ("a refused or failed callback is never reported as a successful connect,
  with or without an opener"), next to the 200 → 401 change. TL records it there.

#### The merged test file

The merged file is sound. One set of module mocks, with the slice's cases on the real service
and main's cases on prototype spies. That is the correct way to satisfy both, given that
`jest.mock` is per file. The singleton resolves methods through the prototype, so the spies take
effect, and `mockRestore` in `afterEach` returns the real methods. Dev's three `--randomize`
seeds back that up.

Main's leak checks are **more** meaningful than before, not less. The planted marker now sits
inside a real state (`code_verifier`), and it is made only of unreserved characters, so it
survives both encoding layers verbatim. It would therefore show up in any log line that carried
the state or any part of it. Main's two popup-page cases assert `error: 'OAuth callback failed'`,
which only the catch block produces, so they cannot pass through a refusal. The profile-param
cases assert the service stub or `receivedKeys`, so they prove the identity checks were passed.

**Ran it myself:** `npx jest app/oauth/callback lib/server/__tests__/aMalformedOAuthStateIsNotEchoed.test.ts lib/audit/__tests__/eventAudience.test.ts`
→ **3 suites, 51 tests pass**. `eslint` on the five touched code files → 0 errors, 4 warnings
(three commented `any` in the test, plus the pre-existing unused `refreshAccessToken` import).
`console.*` count is 0 in every touched source file, so the Logging flag/convert step does not
arise.

#### Code Review Comments (port)

1. **F-1 — `app/oauth/callback/[plugin]/route.ts:180-183`. Priority: Low, required before
   commit.** The invariant header still names the open residual and then spells out how it
   plays out (the sentence after "what remains is"). That is the attack narrative the Wording
   rule keeps out of tracked text, and on a public repo it describes a hole that is still open.
   Keep the meaning and drop the mechanism. Suggested:
   *"Precisely that, and no more. The state is still unsigned and not yet bound to the flow that
   issued it, so this is not end-to-end protection of the callback; signed state is the next
   slice."* (The same wording in this workplan's Overview, comment 4, the Residual, the
   `state_unreadable` ruling and the QA coverage row was neutralised by SA in this pass.)
2. **F-2 — `app/oauth/callback/[plugin]/__tests__/route.test.ts:537-545`, "does not log the code
   or state when the token exchange throws". Priority: Low, required before commit.** On main
   this case reached the service unconditionally. After the port it reaches it only if the
   identity checks pass, and it asserts only absences. So if the session default or the planted
   state ever stopped agreeing, it would pass through a refusal and test nothing. Add
   `expect(mockHandleOAuthCallback).toHaveBeenCalled()`. That makes it prove it reached the catch
   path it names, as its two popup-page siblings already do.

#### Optimisation Suggestions (non-blocking)

- Item 10 of the Implementation Approach, the Files table's `route.ts` row ("`JSON.stringify`
  payload") and Out of Scope's provider-error row ("`serializeForScript` escapes it") now
  describe the dropped serialiser. Mark them superseded by P-2 so the doc matches the code. The
  Files table should also list `lib/server/__tests__/aMalformedOAuthStateIsNotEchoed.test.ts`
  (modify), and `route.test.ts` is now a modify, not a create.
- The `state_shape` marker from the second pass is still a good cheap addition if the signing
  slice wants the counts. It is not owed here.

#### The red guard: `lib/utils/__tests__/oneAddressPolicy.guard.test.ts`

**Dev's claim is verified. It is a Windows path-separator artifact, it is pre-existing on clean
main, and this change does not cause it.**

- **Clean `origin/main` (`1f24faeb`) on Windows:** extracted with `git archive` into a scratch
  directory and ran the unmodified guard against that tree. It fails the same way: test 3 lists
  the **same five files** as offenders, each as an absolute backslash path (`origins.ts`,
  `platformBranding.ts`, `catalogue.ts`, `slackPluginStrategy.ts`,
  `app/oauth/callback/[plugin]/route.ts`). Those are exactly the resolver, the allow-list, the
  name-only listing and the two OAuth files. The other three tests pass.
- **The port worktree:** an identical failure, with the same five files and nothing else.
- **CI on main (Linux):** the Tests run for `e797bc0d`, the port's base, is green, and its shard
  log shows `PASS lib/utils/__tests__/oneAddressPolicy.guard.test.ts`. The two later main runs
  were documentation-only and were skipped correctly.
- **Cause:** `relative = (file) => file.replace(ROOT + '/', '')`. `join()` produces `\` on
  Windows, so the prefix never matches and no allow-list lookup can hit. Fixing it with
  `path.relative` plus normalising to `/` is a one-line change to a guard this slice does not
  own. It is a follow-up candidate, not part of S11.5-1.

### Code Approved for QA: Yes (port, 2026-11-27) — after Dev makes F-1 and F-2, which QA confirms

## QA Testing Report

**QA — 2026-11-08**
**Test mode:** full (within the approved slice scope)
**Strategy used:** A + B — Jest unit/route tests for the invariant, plus a failability pass that
reverted the product behaviour in the working tree and watched the named tests go red. No manual
browser step: `AgentsPilot` is parked for manual testing, and this route cannot be exercised
end-to-end without a live vendor grant.
**Focus:** security (identity scoping) + the audit durability the slice depends on
**Skipped:** D (browser) — parked by standing preference, and the one thing it would have
confirmed is recorded below as unverifiable without it. E (log analysis) — not applicable.
**Input source:** prompt keywords from the QA brief

### Verdict

**Ready for commit.** Every acceptance criterion in scope passes, the new tests are proven
failable on exactly the regressions they name, and the two SA nits are closed. Two findings, both
**Low** and both now locked by a test rather than left open: see Edge Cases.

---

### Verified — commands run and their output

#### 1. `npm test -- app/oauth/callback`

Run after the two tests QA added. Pino lines stripped.

```
> jest app/oauth/callback

PASS app/oauth/callback/[plugin]/__tests__/route.test.ts
  plugin OAuth callback: identity comes from the session
    √ (i) refuses with no session, and performs no token exchange and no write (39 ms)
    √ (i-c) records the refusal with the request metadata in details, not the request (10 ms)
    √ (i-b) reports when no auth cookie reached the route at all (5 ms)
    √ (ii) refuses when the callback names a different account, and writes nothing (6 ms)
    √ (iii) stores the connection under the session id when the callback agrees (15 ms)
    √ (iii-b) refuses a callback that does not name the account at all (7 ms)
    √ (iv) refuses when the callback names a plugin other than the route segment (5 ms)
    √ (v) records one failure row, attributed to the session, when the exchange fails (56 ms)
    √ (vi) accepts the extra fields the real producers send, and stores none of them (11 ms)
    √ shows the refusal on the page, not only through the opener message (6 ms)
    √ refuses an unreadable state before any token exchange (5 ms)

Test Suites: 1 passed, 1 total
Tests:       11 passed, 11 total
Time:        3.608 s
```

#### 2. `npm test -- lib/audit`

```
Test Suites: 17 passed, 17 total
Tests:       195 passed, 195 total
Time:        20.741 s
```

All 17 named: `eventAudience`, `__probe`, `adminAuditTrailQuerySchema`, `stepZeroRegistrations`,
`ownerPolicyMigration`, `dataExportSeverity.guard`, `passwordChangeSeverity.guard`,
`filterOptions`, `boundedAuditFlush.list`, `paymentRefundSeverity.guard`,
`ownerEventPresentation`, `creditLowLineSeverity.guard`, `refusedAccessAudit`,
`paymentPlanCancelledSeverity.guard`, `ownerVisibility`, `boundedAuditFlush`,
`ownerAuditReads.guard`.

> ⚠️ One of those 17, `lib/audit/__tests__/__probe.test.ts`, is an untracked file belonging to
> another session. It must not be committed. The same applies to
> `app/admin/audit-trail/__tests__/zz.probe.test.tsx`. Both are collected by the PR gate.

#### 3. Neighbouring suites (everything that imports a touched module)

```
> jest app/api/plugins/webhooks/whatsapp-business/__tests__/route.test.ts
       app/api/plugins/__tests__/identity-hardening.test.ts
       lib/execution/__tests__/connectionsAreAskedBeforeTheRun.test.ts
       lib/server/__tests__/aRejectedTokenIsRefreshedOnce.test.ts
       tests/plugins/unit-tests/stripe-subscription-period.test.ts
       lib/validation

Test Suites: 15 passed, 15 total
Tests:       358 passed, 358 total
```

#### 4. Typecheck

The **first** attempt died rather than passing:

```
FATAL ERROR: Ineffective mark-compacts near heap limit
Allocation failed - JavaScript heap out of memory
```

— i.e. `grep "error TS"` on it would have returned nothing and read as clean. Re-run with
`NODE_OPTIONS=--max-old-space-size=12288`:

```
exit=2        (tsc exits 2 when it reports errors — it did not crash)
2782 output lines, 1896 "error TS" lines   (pre-existing, ignored by next.config.js)
grep -c "FATAL ERROR|heap out of memory" → 0
errors in the eight slice files → 0
```

A second, focused program (`tsconfig.qa-slice.json`, the eight files as `include`, `incremental:
false`, deleted afterwards) reports **0** errors in any slice file; its only four errors are
pre-existing ones in transitive imports (`lib/business-os/catalog/catalog.ts`,
`lib/pilot/insight/MemoryManager.ts` ×2, `lib/repositories/CalibrationSessionRepository.ts`).

**That focused run was itself proven able to fail**, so the 0 is not a file tsc skipped: a
deliberate `const x: number = "s"` appended to the route produced

```
app/oauth/callback/[plugin]/route.ts(408,7): error TS2322: Type 'string' is not assignable to type 'number'.
```

and was removed immediately (file restored byte-for-byte, md5 `a5c688cd…`).

#### 5. `eslint` on the eight files

`0 errors, 7 warnings` — three `no-explicit-any` in the test file and two in the route (each
commented), plus two pre-existing: the unused `_` in `events.ts:2004` and the unused
`refreshAccessToken` import in `user-plugin-connections.ts:8`.

#### 6. No test reached the network

`tests/jest-no-network.ts` is a `setupFiles` entry in `jest.config.js:71-73`, so it was live for
every run above. Zero guard hits / `ENOTFOUND` / `ECONNREFUSED` across the runs. Nothing in the
suite passes because a call failed: the four seams (`getUser`, `OAuthTokenService`,
`pluginConnectionRepository`, `AuditTrailService`) are all mocked, and every refusal case asserts
a row **present** in `written`, not merely an absence.

#### 7. Collected by the PR gate

`npx jest --config jest.gate.config.js --listTests` includes
`app/oauth/callback/[plugin]/__tests__/route.test.ts` (2018 tests collected), and the suite passes
under that config — so the lock runs in CI, not only locally.

---

### Verified — the tests can fail (failability pass)

Each probe reverted the product behaviour **in the working tree**, ran the suite, and was then
restored from a byte-exact copy (md5 re-checked each time). No `git stash`, nothing staged, no
`git checkout --` (which would have discarded the uncommitted slice).

| Probe | Product behaviour reverted | Red | Green | Reading |
|---|---|---|---|---|
| **A** | Identity taken from the callback's own claim again (`parsedState.user_id` passed to `handleOAuthCallback`, user-agreement check dropped) | **(ii)** only | 8 | Exactly the named test, and it failed on the right line: `expect(exchangeCodeForTokens).not.toHaveBeenCalled()` → "Received number of calls: 1" |
| **B** | Plugin taken from the state again (`parsedState.plugin_key`, plugin-agreement check dropped) | **(iv)** only | 8 | Exactly the named test |
| **C** | Refusal row back to un-awaited `AuditTrail.log()` + immediate `flush()` | **7**: (i), (i-b), (i-c), (ii), (iii-b), (iv), "unreadable state" | 2 | **SA's count of 7 is right; the workplan's earlier "6" was wrong.** The two that stay green are correct to: (iii) asserts a *different* row written inside the service, which this probe did not touch, and the body-text case makes no audit assertion at all. |
| **D** | No session falls back to the callback's own claim (pre-slice behaviour) | **4**: (i), (i-b), (i-c), body-text case | 6 | The three state-disagreement cases still have a session, so they correctly stay green |
| **E2** | Failure row attributed to nobody (`userId: null`) | **(v)** | 10 | `Expected: "1111…"  Received: null` — the attribution half is live |
| **F** | Failure row back to un-awaited `log()` + immediate `flush()` — the exact no-op that shipped in the first pass | **(v)** | 10 | `Expected length: 1  Received length: 0  Received array: []` — the durability half is live |
| **G** | `PLUGIN_AUTH_REFUSED` removed from `AUDIT_EVENT_AUDIENCE` | 2 in `eventAudience.test.ts`: exhaustiveness **and** the pinned 237/80 split | 19 | The count pin is derived from `Object.values(AUDIT_EVENTS)`, so it is not vacuous |
| **H** | `.strip()` → `.strict()` on the state schema | **nothing — 493/493 green** before QA's addition; **(vi)** after it | — | See Edge Case 1. This is the finding of the pass |

**Nothing stayed green that names the thing it was asked to guard.** Probe C is the one place the
workplan's own number was off, and the correction is in QA's favour (one more test fires, not one
fewer).

---

### Verified — SA's two nits are closed

**(a) The third audited path is now locked.** Added **(v) `records one failure row, attributed to
the session, when the exchange fails`**. It asserts, after `exchangeCodeForTokens` rejects:
`written` holds **exactly one** `PLUGIN_AUTH_FAILED` (`.filter(...)` then `toHaveLength(1)`, so a
second row fails too), `queued` is empty, `userId === SESSION_ID`, `details.plugin_key === 'gmail'`,
no `PLUGIN_CONNECTED` / `PLUGIN_RECONNECTED` row slipped out alongside it, `upsert` was never
called, and the route still answers `"success":false`. Proven failable by probes E2 and F above.

**(b) `__resetAuditFlushChainForTests()` added to `beforeEach` — and it was masking nothing.**
Stated plainly, because that was the question: with the reset removed, the suite is **10/10 green
three runs in a row**; with it, **10/10 three runs in a row**; and `--randomize` is also green.
There is no cross-test bleed today, and the reason is structural — every case `await`s `GET`, which
`await`s `logAndFlush`, so each chain link has settled before the next test starts. The call is
worth keeping because the chain is module state Jest holds for the whole file: the first case that
deliberately hangs or rejects a flush would otherwise queue every later case behind its link. The
comment in the file says exactly that, so nobody reads it as a fix for a bug that existed.

---

### Verified — every audit assertion is on the effect, not the call

Checked line by line (the fourth item in the QA brief). The suite declares `auditLog` / `auditFlush`
as mocks but **never asserts on either**: `grep "auditFlush\|auditLog"` finds them only in the
declaration, the `jest.mock` factory and the two `mockImplementation`s. Every audit assertion goes
through `written` (via `writtenRow(action)` or a `.filter`), and three cases additionally assert
`queued` is empty — i.e. the entry left the queue rather than merely entering it. The fake sink
reproduces both halves of the real bug (one `await` before queueing; `flush()` early-returns on an
empty queue), which is why probes C and F turn it red. **No assertion in the file proves only that
a mock was called.**

---

### Test Coverage

| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| Identity comes from `getUser()`, never from the callback's own claim | ✅ | Pass | (ii), (iii); failable via probes A and D |
| The plugin comes from the route segment | ✅ | Pass | (iv); failable via probe B |
| A callback with no session is refused, nothing exchanged, nothing stored | ✅ | Pass | (i) asserts all three negatives plus the row |
| All three agreement checks run **before** `exchangeCodeForTokens` | ✅ | Pass | Every refusal case asserts `exchangeCodeForTokens` not called — the only way to prove "before" from outside |
| `handleOAuthCallback` requires identity, with no fallback | ✅ | Pass | Required positional params; an identity-less call is a compile error (typecheck clean). Sole caller is the route (`grep` confirms; `StripeService` and the dead V1 `slackPluginStrategy` have unrelated methods of the same name) |
| Only `code_verifier` is still read from the state | ✅ | Pass | Read by inspection; (vi) confirms nothing else from the state reaches the stored row |
| One `PLUGIN_AUTH_REFUSED` row, attributed to the session or to nobody, reaching the sink | ✅ | Pass | (i), (i-b), (i-c), (ii), (iii-b), (iv) |
| The refusal row carries no credential and no `request` | ✅ | Pass | (i) asserts `details` does not contain the code and `entry.request` is undefined; (i-c) asserts the two headers land in `details` |
| Classification is left to `EVENT_METADATA` | ✅ | Pass | (i) asserts no `severity` / `complianceFlags` at the call site. QA also checked the registered values are legal: `'warning'` is in `AuditSeverity` and `'connection'` is in `AUDIT_ENTITY_TYPES` — so the row cannot be the kind that kills an insert batch |
| `PLUGIN_AUTH_REFUSED` registered in `AUDIT_EVENTS`, `EVENT_METADATA`, audience `shared` | ✅ | Pass | `eventAudience.test.ts` 237/80/84; failable via probe G |
| One `PLUGIN_AUTH_FAILED` row, attributed to the session, on an exchange failure | ✅ | Pass | **(v)**, added by QA |
| Neither producer's real state shape is refused | ✅ | Pass | **(vi)**, added by QA |
| No unrelated suite regressed | ✅ | Pass | 15 neighbouring suites / 358 tests, plus 17 `lib/audit` suites |
| The state is bound to the flow that issued it | ⬜ | Out of scope | Deliberately not tested — slice 2 (signed state) |

---

### Reasoned — read and believed, not executed

1. **The session cookie does reach this route in a real browser, so the slice should not break
   connects.** This is the slice's main functional risk and Jest cannot see it: `getUser()` reads
   `cookies()`, so if the Supabase auth cookie were not sent on the vendor's cross-site top-level
   GET, **every** plugin connect would start refusing with `no_session`. It should be sent: the
   cookie is `SameSite=Lax` (how our own code writes and expires it — `lib/client/auth-actions.ts:391-397`,
   `lib/business-os/account-deletion/authCookies.ts:20`), and a Lax cookie *is* sent on a top-level
   GET navigation, including one arriving via a cross-site redirect, which is exactly the shape of
   this callback (the connect flow navigates a popup, it does not POST). **Unverifiable here** —
   it needs one real connect in a browser, and the app is parked for manual testing. The telemetry
   this slice adds (`auth_cookie_present`) is what would show it if the reasoning is wrong: a burst
   of `no_session` refusals with `auth_cookie_present: true` after deploy is the signal to look at
   first.
2. **`authCookiePresent` is truthful.** The route's predicate (`route.ts:113`,
   `c.name.includes('auth-token')`) is character-for-character the one `lib/auth.ts:89` uses to
   decide there is a session to verify, so the boolean really does separate "no cookie reached us"
   from "a cookie reached us and did not verify". The route reads `request.cookies` and `getUser()`
   reads the ambient `cookies()`, which are the same request in a route handler.
3. **The test fixture's double encoding is faithful to production.** Both producers emit
   `encodeURIComponent(JSON.stringify(state))` and then hand that to `searchParams.set('state', …)`,
   which encodes again; the test helper does the same two steps, and
   `parseOAuthCallbackState` undoes exactly one layer after `searchParams.get` has undone the other.
4. **`user_id: z.string().uuid()` cannot refuse a real producer.** Both send a Supabase auth uid:
   `app/api/v2/plugins/connect/route.ts:67` uses `user.id` from the authenticated request, and
   `lib/client/oauth-handler.ts:176-189` is reached only with `sessionUser.id` / `user.id` from its
   two callers.
5. **Line endings are not a hazard for this slice.** No test asserts on file text, so the CRLF trap
   does not apply. The three new files are LF; `user-plugin-connections.ts` and
   `eventAudience.test.ts` are CRLF and stayed CRLF (QA's temporary edits preserved each file's own
   endings and every file was md5-verified back to its pre-probe bytes).
6. **Exactly one row per audited outcome**, re-derived independently and agreeing with SA's
   re-review: refusal → one, from the route, service never entered; success → one, from the
   service; failure → one, then the rethrow. `logAndFlush` cannot reject, so the success path's
   `await` cannot divert into the `catch` and add a second row.

---

### Issues Found

#### Bugs (must fix before commit)

**None.**

#### Performance issues (should fix)

**None new.** Each audited path now awaits up to `AUDIT_FLUSH_TIMEOUT_MS` (2 s) plus any wait
behind the shared chain. SA recorded this as an accepted cost; QA measured nothing that contradicts
it — on the failure path the suite shows ~60 ms against ~10 ms for the unaudited paths, which is
mock overhead, not the bound.

#### Edge cases (nice to fix — both now closed by a test QA added)

1. **The suite's state fixtures were not the shape production sends, so the one schema decision
   that could break every connect was unlocked.** Both producers always add fields no consumer
   reads — `timestamp`, and `random` from the client producer — but every original case sent only
   `user_id` and `plugin_key`. Measured, not assumed: changing `.strip()` to `.strict()` in
   `lib/validation/oauth-callback-schema.ts` left **493/493 tests green** across
   `app/oauth/callback lib/audit lib/validation`, while in production that one-word change would
   refuse **every** real plugin connect with `state_unreadable`. Closed by **(vi) `accepts the
   extra fields the real producers send, and stores none of them`**, which sends
   `{ user_id, plugin_key, timestamp, random }`, asserts `"success":true` and the upsert under the
   session id, and asserts neither extra field reaches the stored row. Re-running the same probe
   now turns (vi) red. Severity: **Low** (the behaviour is correct today; only the guard was
   missing).
2. **`lib/validation/oauth-callback-schema.ts` still has no direct unit test.** The route suite now
   covers the branches that matter behaviourally — valid, not-JSON, missing `user_id`, unknown keys
   — but these are reached only through `GET`. Untested: the 4096-character caps on `code` and
   `state`, a non-uuid `user_id`, and a `code_verifier` over 256 characters. Those three are refusal
   paths, so a regression fails safe (it refuses rather than mis-attributes), which is why QA did
   not add them here. Recommend a small `lib/validation/__tests__/oauth-callback-schema.test.ts`
   when the signing slice touches this module. Severity: **Low**.

---

### Files QA changed

Tests only. **No product file was changed** — `route.ts`, `user-plugin-connections.ts`,
`oauth-callback-schema.ts`, `events.ts` and `eventAudience.ts` are byte-identical to what SA
approved (md5 verified after every probe).

| File | Change |
|---|---|
| `app/oauth/callback/[plugin]/__tests__/route.test.ts` | `+` import of `__resetAuditFlushChainForTests`; `+` the call in `beforeEach` with a comment saying it masks nothing today; `+` case **(v)** (SA nit (a)); `+` case **(vi)** (Edge Case 1). 9 tests → 11. |

### Note for RM

`git ls-files -s` shows the three new files registered in the index as **intent-to-add with the
empty blob** (`e69de29…`), i.e. `git add -N` from the implementation session — `git diff --cached`
is empty. They must be `git add`-ed properly or they will be committed empty. And the two untracked
probe files named above must stay out of the commit.

### Final Status

- [x] All acceptance criteria in scope pass — ready for commit
- [ ] Issues found — Dev must address before commit

## Port to main (2026-11-27)

**Dev — 2026-11-27.** The slice above was written, SA-approved and QA-passed on top of `115cedec`
and never committed. Main has since moved to `e797bc0d`, and nine commits touched the same files.
This section records how the slice was re-applied onto main's current versions. **Everything SA
and QA approved above is kept**; where main had solved the same problem a different way, main's
version was kept and the slice's dropped, and each such case is listed for SA to re-rule.

### What main changed underneath the slice

| Main commit | File | What it did |
|---|---|---|
| `4e1410d6` | `route.ts`, `route.test.ts` (new on main) | Logs callback parameter **names**, not values (`receivedKeys`, `storedParams`) — the same fix as the slice's item 8, done independently |
| `9f415d0e` | `route.ts`, `route.test.ts`, `user-plugin-connections.ts`, `aMalformedOAuthStateIsNotEchoed.test.ts` (new) | Generic `error: 'OAuth callback failed'` plus a development-only `details` field; `escapeJs` hardened for `\r`, U+2028, U+2029; a `parseOAuthState` helper in the service that throws a generic `Invalid state` so a parser message never reaches logs, audit or client |
| `202fb388` | `route.ts` | The no-opener branch on a **success** page says "Connected" and closes, instead of a red "try again" (Google's COOP leaves `window.opener` null); typed `extractPluginProfileData` params |
| `f9acad90`, `d1822c38`, `926269b0`, `6e885a48`, `57d8821e`, `e40362e8` | `user-plugin-connections.ts` | Refresh, grant and token-refusal handling: refresh coalescing, dead-grant marks, targeted `updateRefreshedToken` / `updateSettings` writes instead of whole-row upserts, token fingerprints in diagnostics. None of it is in `handleOAuthCallback` |

### Conflicts and how each was resolved

| # | Where | Conflict | Resolution |
|---|---|---|---|
| P-1 | `lib/audit/events.ts`, `lib/audit/eventAudience.ts`, `lib/audit/__tests__/eventAudience.test.ts`, `lib/validation/oauth-callback-schema.ts` | None. Main has not touched these since `115cedec` | Applied from the original patch unchanged. The pinned 237 / 80 split still holds (no event was catalogued on main in between) |
| P-2 | `route.ts` — escaping | The slice replaced `escapeJs` with `serializeForScript` (`JSON.stringify`, item 10, SA-approved). Main's `9f415d0e` kept `escapeJs` and closed the same gaps (`\r`, U+2028, U+2029), and main's tests assert on its literal output (`error: 'OAuth callback failed'`, `details: '…'`) and execute the script | **Main's `escapeJs` kept; the slice's serialiser dropped.** It now escapes backslash, `'`, `<`, `>` and all four JS line terminators, which is everything item 10 was for. Payload keys and order are unchanged for all six listeners. **SA to re-rule** (R-1 below) |
| P-3 | `route.ts` — catch block | The slice put `error.message` in `error` in development only. Main's `9f415d0e` keeps `error` generic always and adds a development-only `details` | **Main's kept.** Same CLAUDE.md § Error Response Format intent, and main's two tests lock it |
| P-4 | `route.ts` — page body | The slice's `bodyMessage` (SA comment 6) vs main's new no-opener success text | **Both kept.** `bodyMessage` is rendered on a failure page when given; main's success fallback is untouched |
| P-5 | `route.ts` — `extractPluginProfileData` | The slice kept `any` params (commented) and the old `profileData` INFO; main typed the params and logs `storedParams` / `receivedKeys` | **Main's kept** in full. The slice's own `Object.keys` change (item 8) is therefore main's version |
| P-6 | `route.ts` — query check | Main's plain `if (!code \|\| !state)` vs the slice's Zod query schema | **The slice's Zod schema kept** (CLAUDE.md rule 2). The failure log carries issue paths and codes only, never a value, so main's leak tests still pass on it |
| P-7 | `user-plugin-connections.ts` — state parsing | Main's `parseOAuthState` (throws `Invalid state`) vs the slice's `parseOAuthCallbackState` (Zod, returns `null`, the slice then read `parsedState?.code_verifier` and carried on) | **The slice's shared Zod parser kept, with main's fail-closed behaviour:** a `null` now throws `new Error('Invalid state')` before the exchange, inside the `try`, so it is audited as `PLUGIN_AUTH_FAILED` with the generic message exactly as main's test requires. `parseOAuthState` and its `OAuthState` interface had no other callers and were removed. Side effect, worth naming: the service now refuses any state that fails the full schema (for example a non-uuid `user_id`), although it reads only `code_verifier`. The route already refuses such a state first, so no real flow reaches this. **SA to confirm** (R-2) |
| P-8 | `user-plugin-connections.ts` — `handleOAuthCallback` body | The patch's context lines no longer matched (main's `parseOAuthState` call sites) | Re-applied by hand: required `userId` / `pluginKey` parameters, the PKCE-is-decorative comment, the conflict target built from both parameters, and both rows through `logAndFlush`, attributed to the session. The SA re-review's reading of this method still holds line for line |
| P-9 | `app/oauth/callback/[plugin]/__tests__/route.test.ts` | Main created this file (10 tests) with a different seam: it mocks the whole `user-plugin-connections` module and the logger. The slice's 11 tests run the **real** service against mocked repository, token service and audit sink. `jest.mock` is per file, so the two cannot coexist as written | **One file, one set of module mocks:** the slice's seams plus main's capturing logger mock. Main's tests stub the two service methods with `jest.spyOn(UserPluginConnections.prototype, …)` and restore both spies after each case, so the slice's cases always run the real service. Main's tests now also need a session and a readable state to get past the identity checks: `getUser` returns the session, and the state is a real one whose `code_verifier` carries the planted marker, so the leak checks now cover the state's contents rather than an opaque string. The mocked connection's `user_id` is the session id. The slice's `'"success":false'` string matches were written against `JSON.stringify` output; they now read the message the script actually posts (a `postedMessage` helper that runs the page script against a stub window, the way main's last test already does), so they hold whatever the serialiser is. **Added one test:** the code and state stay out of the logs on a refusal too |
| P-10 | `lib/server/__tests__/aMalformedOAuthStateIsNotEchoed.test.ts` | Main's test calls the old four-argument signature and uses `user_id: 'user-1'` / `'u'` | Moved to the new signature with a session uuid; the non-string `code_verifier` case now uses a valid `user_id`, so it is refused for the reason it names rather than for the uuid; `flush` added to its audit mock (`logAndFlush` calls both). **Added one test:** the service stores under its `userId` / `pluginKey` parameters, whatever the state names. That locks the layer below the route's checks |

### Main's new code against the invariant

Checked, because the question is whether anything that landed since `115cedec` takes an identity
from `state` or stores a grant before the session check.

| Question | Finding |
|---|---|
| Does any path on main still take an identity from `state`? | **No, after this port.** On main as it stands, `handleOAuthCallback` still did (`parseOAuthState(state)` → `user_id`, `plugin_key`), in both the success path and the failure audit. That was the only server-side reader. The dead V1 `lib/plugins/strategies/slackPluginStrategy.ts:113` still parses its own state (already flagged above, untouched) |
| Is a grant stored, or a token exchanged, before the session check? | **No.** `getUser()` and all three agreement checks still sit ahead of `PluginManagerV2.getInstance()` and `handleOAuthCallback`, and so ahead of `exchangeCodeForTokens`. Main added no new caller of `exchangeCodeForTokens` or of `pluginConnectionRepository.upsert` outside this method. The one other grant upsert in `app` / `lib`, `app/api/payments/stripe-connect/callback/route.ts:173`, predates `115cedec`, takes `user.id` from `getUser()` and checks a cookie-bound CSRF state, so it is already session-scoped |
| Main's refresh / grant / token-refusal changes | Every write in them (`updateRefreshedToken`, `updateSettings`, `recordDeadGrant`, `recordRefreshFailure`) is keyed on `connection.user_id` / `connection.plugin_key` from a **stored** row, never on request input. They narrow writes compared with the old whole-row upserts. No interaction with this slice |
| New state producers | None. `lib/client/oauth-handler.ts` gained only `isPluginConnected` (below); `generateOAuthState` on the client is unchanged, and the server one is still dead (SA comment 7, deferred) |
| `waitForOAuthCompletion` / `isPluginConnected` (main, `lib/client/oauth-handler.ts`) | **An interaction, not a breach (R-3).** When the popup closes with no message, the opener asks `/api/plugin-connections` whether the plugin is now active. A refusal page with no opener (the Google COOP case) runs `window.close()` at once, so the user never sees `bodyMessage`, and the opener decides from the server. For a **first** connect that shows "Authorization window was closed before completion". For a **reconnect** of a plugin that is already active, it reports success, although the refused callback stored nothing and the old grant is untouched. Nothing is written in either case, so the invariant holds; the message is wrong. The slice's original had the same `window.close()` on the failure no-opener branch, so this is not new to the port, but main's fallback is what makes the reconnect case read as success |

### Rulings requested from SA

- **R-1 — escaping.** Main's hardened `escapeJs` kept instead of the slice's `serializeForScript`
  (P-2). The slice's approval was for `JSON.stringify` specifically. Is main's escaper an
  acceptable substitute? Dev's reading: yes. It now covers every JS line terminator, the quote,
  the backslash and `<`. The only unescaped interpolation is the `data` keys, which are four fixed
  literals in the route.
- **R-2 — the service refuses a state that fails the full schema** (P-7), not just an unparseable
  one. This keeps main's `Invalid state` contract and is stricter than the slice's original, which
  carried on with no verifier.
- **R-3 — the refusal page with no opener closes immediately**, so on a reconnect the opener's
  server check can report success for a refused callback. Fix in this slice (for example: keep a
  refusal page open, showing `bodyMessage`), or defer to the signing slice with the 200-vs-401
  change? Dev recommends deferring: it is UX, nothing is stored, and it sits with the other
  popup-contract changes that slice has to clear across all six listeners.

### Verification

| Check | Result |
|---|---|
| `npx jest app/oauth/callback` | **22/22 pass**: the slice's 11, main's 10, plus the one added in P-9. Also green under `--randomize` three times (seeds 1289435715, -96594406, 1979553592), so the prototype spies restore cleanly whatever the order |
| `npx jest lib/server/__tests__/aMalformedOAuthStateIsNotEchoed.test.ts` | **8/8 pass**: main's 7 plus the one added in P-10 |
| Neighbouring suites: `app/oauth/callback`, `lib/audit`, `lib/validation`, `lib/server/__tests__`, `app/api/plugins`, `app/api/admin/jobs-queues/items/action/__tests__`, `app/admin/audit-trail/__tests__/filterOptions.guard`, the leads / execution / plugins guards and `stripe-subscription-period` | **53 of 54 suites, 1026 of 1027 tests pass.** The one red, `lib/utils/__tests__/oneAddressPolicy.guard.test.ts`, is a Windows path-separator artifact: it builds relative paths with `ROOT + '/'`, so on Windows every allow-listed file reads as an offender. Its list includes `lib/utils/origins.ts` (the resolver itself) and three other files this slice does not touch, and `route.ts` is on its allow-list. Not caused by this port |
| `tsc --noEmit -p tsconfig.json` (12 GB heap) | `exit=2` (errors reported, not a crash), **0** `FATAL ERROR` / heap lines, 1846 `error TS` lines repo-wide (pre-existing), **0 in any touched file**. The semantic pass ran (TS2339 ×640, TS2322 ×176, …), so the 0 is not a skipped pass |
| Focused `tsc` over the eight touched files (temporary tsconfig, deleted afterwards) | 0 errors in touched files; the only 5 are the pre-existing transitive ones QA recorded (`catalog.ts` ×2, `MemoryManager.ts` ×2, `CalibrationSessionRepository.ts`). **Proven able to fail:** a planted `const plantedProbe: number = "s"` in `route.ts` gave `route.ts(423,7): error TS2322`, and the file was restored byte-exact (sha256 `4d8b1627…` before and after) |
| `eslint` on the touched files | 0 errors, 5 warnings: three commented `no-explicit-any` in the test file, plus the pre-existing unused `_` (`events.ts`) and unused `refreshAccessToken` import. `route.ts` now has no `any` (main typed `extractPluginProfileData`) |
| **Failability probe: identity checks after the token exchange** | `getUser()` kept early (the call needs an id), and the no-session check plus all three agreement checks moved to just after `handleOAuthCallback`, with `user?.id ?? ''` passed in. **9 tests red**: (i), (i-b), (i-c), (ii), (iii-b), (iv), "unreadable state", the body-text case, and the new "refused" logging case. (ii) fails on `expect(exchangeCodeForTokens).not.toHaveBeenCalled()` → "Received number of calls: 1". The three agreeing-state cases (iii), (v), (vi) stay green, correctly. Restored from a byte copy (sha256 matched); 51/51 green across the three suites afterwards |

No `git stash`, nothing staged, nothing committed.

## QA Testing Report — port (2026-11-27)

**QA — 2026-11-27**, re-test of the port onto `e797bc0d`, after SA's third pass and Dev's F-1 and F-2.
**Test mode:** full, within the approved slice scope (the port, F-1, F-2, R-2, and regressions against main)
**Strategy used:** A + B. Jest route and service tests; a failability pass that reverts product or
test behaviour in the working tree and watches the named tests go red; a focused and a full
typecheck; and the full PR gate (`jest.gate.config.js --ci`) on the port and on a clean extract of
its base.
**Focus:** security (identity scoping, order of checks against the token exchange) and regression
**Skipped:** D (browser). The app is parked for manual testing, and this route cannot be driven end
to end without a live vendor grant. The cookie-reach reasoning in the 2026-11-08 report still stands
and is still unverified. E (log analysis): not applicable.
**Input source:** prompt keywords from the QA brief

### Verdict

**PASS. Ready for commit.** F-1 and F-2 are both confirmed. All five named suite groups are green.
The key probe and both R-2 probes turn the right tests red. The touched files have no type errors,
and the run did not die. The gate shows **no new failure** against a clean base.
No Bug, Performance or Edge Case finding is new in this pass.

### 1. F-1: the comment is clean

`route.ts:179-181` now reads, word for word, the wording SA suggested: *"Precisely that, and no
more. The state is still unsigned and not yet bound to the flow that issued it, so this is not
end-to-end protection of the callback; signed state is the next slice."*

I grepped every added line in the eight touched code files (`git diff e797bc0d` plus the untracked
schema file) for attack-narrative vocabulary: attack, forge, victim, csrf, hijack, replay, steal,
craft, impersonate, malicious, exploit, takeover, trick, lure, phish, spoof, tamper, "another user",
"their account". **No hit describes the open residual.** The only hits are benign: "leak check"
(logging), "fire-and-forget" and "failure". I also read every added comment block in full. The
"would let a caller write audit rows against an account that is not theirs" lines (route `refuse`,
service failure audit, test (v)) describe behaviour this slice **removes**, not an open hole.

One judgment call for SA, not a Bug. The PKCE comment at the `code_verifier` read site in
`user-plugin-connections.ts` explains why PKCE is not a control until the state is signed. It
names that weakness but does not spell out how it plays out. SA has read it in all three passes
and left it, so QA does not raise it.

### 2. F-2: the case now fails if the route refuses before the service

`route.test.ts:541-542` adds `expect(mockHandleOAuthCallback).toHaveBeenCalled()` with a comment.

| Probe (test file only) | Result |
|---|---|
| `getUser.mockResolvedValue(null)` in **"does not log the code or state when the token exchange throws"** only | **1 red, 21 green.** Exactly that case: `Expected number of calls: >= 1, Received number of calls: 0` |
| Same probe, **with F-2's assertion removed** | **22/22 green.** This proves it is F-2's line that catches the refusal. Without it, the case passed vacuously |
| Restored from the byte copy | sha256 `fdcde991…` before and after |

### 3. The suites, green

| Run | Result |
|---|---|
| `app/oauth/callback` (the route test) | **22/22** |
| `lib/server/__tests__/aMalformedOAuthStateIsNotEchoed.test.ts` | **8/8** |
| `lib/audit/__tests__/eventAudience.test.ts` | **21/21**, split pinned at 73 / 80 / 84 |
| user-plugin-connections tests: every suite that imports the module (`aRefusedTokenIsWrittenDown.guard`, `aRejectedTokenIsRefreshedOnce`, `access-strategy`, `aRefusedGrantIsNotAConnection.guard`, `aFailingRunStopsRetrying.guard`, `connectionsAreAskedBeforeTheRun`, `stripe-subscription-period`) | all pass |
| `app/api/plugins` (8 suites, including `identity-hardening`, `no-secret-egress`, `dead-plugin-routes-removed.guard`, the WhatsApp webhook) | all pass |
| **Combined** | **18 suites, 215 tests, 0 failed.** No network-guard refusal in the output |

The gate collects all three touched suites (`--config jest.gate.config.js --listTests`, 2125 suites).

### 4. The probes

Each probe edited the working tree only, ran the tests, and was restored from a byte copy taken
before any probe. All eight touched files were sha256-verified against that baseline at the end:
**8/8 OK**.

| Probe | Behaviour reverted | Red | Reading |
|---|---|---|---|
| **Key** | `route.ts`: `getUser()` kept early, but the no-session check and all three agreement checks moved to just after `handleOAuthCallback` (so after `exchangeCodeForTokens`), with `user?.id ?? ''` passed in | **9 of 22**: (i), (i-b), (i-c), (ii), (iii-b), (iv), the body-text case, "unreadable state", and "does not log … when the callback is refused" | The same 9 Dev reported. (ii) fails on `exchangeCodeForTokens` `Expected number of calls: 0, Received: 1`. (iii), (v), (vi) and main's 10 route-alone cases stay green, which is correct: they have an agreeing state, or a stubbed service. Restored (sha256 `2d2d96d7…`) |
| **R-2a** (QA's choice) | Service fails open: `if (!parsedState) throw new Error('Invalid state')` replaced by `const codeVerifier = parsedState?.code_verifier` | **6 of 8** in `aMalformedOAuthStateIsNotEchoed`: not-JSON, JSON null, JSON number, bad percent-escape, non-string `code_verifier`, and the state-out-of-logs case | The service-level refusal is locked. This includes a **schema-invalid but parseable** state (the non-string verifier), not only an unparseable one |
| **R-2b** (extra) | Service refuses, but only **after** `exchangeCodeForTokens` (the check moved below the exchange) | **5 of 8**: the same rejection cases, each on `Expected number of calls: 0, Received: 1` for the exchange | "Before the exchange" is locked too, not only "refuses". The log-leak case stays green, correctly: it asserts logs, not order. Restored (sha256 `1ca5f374…`) |

### 5. Typecheck

| Run | Result |
|---|---|
| Focused program over the eight touched files (temporary tsconfig in the scratchpad, extending the worktree's, `incremental: false`) | `exit=2`, **0 FATAL / heap lines**, **0 errors in touched files**. The only 5 errors are the known pre-existing transitive ones (`catalog.ts` ×2, `MemoryManager.ts` ×2, `CalibrationSessionRepository.ts`) |
| The same, **proven able to fail** | `const qaPlantedProbe: number = "s"` appended to `route.ts` and to `user-plugin-connections.ts` gave `route.ts(422,7)` and `user-plugin-connections.ts(1178,7)` `error TS2322`. Both restored byte-exact |
| Full `tsc --noEmit -p tsconfig.json --incremental false` (12 GB heap) | `exit=2` (errors reported, not a crash), **0 FATAL / heap lines**, 2709 lines, **1846** `error TS`, the same total Dev recorded. The semantic pass ran (TS2339 ×640, TS2322 ×176, TS7006 ×170). **0 in any touched file.** Every other file that names `handleOAuthCallback` / `OAuthState` was checked: the errors in `stripe-connect/callback/route.ts`, `googleDriveDataStrategy.ts` and `slackPluginStrategy.ts` are pre-existing. One of them, the `repository` private-access error at `stripe-connect/callback/route.ts:173`, names `UserPluginConnections`, but `repository` is `private` on `e797bc0d` too, and the diff does not touch its declaration |

### 6. Gate run against a clean base

**Baseline:** `git archive e797bc0d` extracted into the scratchpad, `node_modules` junctioned to
the shared install (removed with `rmdir` afterwards, and the shared install was checked intact).
`e797bc0d` is the main commit the port sits on, so the comparison isolates this diff exactly.
`origin/main` has moved 9 commits since then, and none of them touches a file in this slice
(`git diff --name-only e797bc0d origin/main`). Both trees ran the same command, one after the
other: `npx jest --config jest.gate.config.js --ci --maxWorkers=4 --json`. Failures were diffed by
suite path and by test full name from the JSON, one entry per suite, so the gate's doubled FAIL
lines play no part.

| | Suites | Tests |
|---|---|---|
| Base `e797bc0d` | 25 failed / 2100 passed / 2125 | 35 failed / 29 skipped / 52502 passed / 52566 |
| Port | 21 failed / 2104 passed / 2125 | 31 failed / 29 skipped / 52519 passed / 52579 |

- **New failures on the port: none.** No new suite and no new test.
- **Red on both (21):** the same set, including the two known Windows-only guards,
  `oneAddressPolicy.guard` (the same `+ 7` offenders in both) and
  `publicEndpointsAreThrottled.guard`, plus 19 Business OS / CRM / scheduling suites unrelated
  to this slice.
- **Red on base only (4):** `BusinessDataExportRepository.test`, `security-definer-surface.guard`,
  `jest-gate-check.g8.test` and `tailwind-css-escape.guard`. These are artifacts of the extract,
  not fixes: they shell out to `git grep`, `git ls-files` or `git cat-file`, and a `git archive`
  extract has no `.git`. They pass in the real worktree.
- The port adds 13 tests (52579 − 52566): route test 10 → 22, `aMalformedOAuthStateIsNotEchoed`
  7 → 8. All pass under the gate config.

### Test Coverage (port)

| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| Identity from `getUser()`, the plugin from the route segment | ✅ | Pass | (ii), (iii), (iv); the key probe |
| All identity checks run before `exchangeCodeForTokens` | ✅ | Pass | Key probe: 9 red |
| The service refuses a schema-invalid state, before the exchange (R-2) | ✅ | Pass | R-2a: 6 red; R-2b: 5 red |
| The service stores under its `userId` / `pluginKey` parameters, whatever the state names | ✅ | Pass | P-10's added case, green |
| Main's leak, generic-error and escaping behaviour survives | ✅ | Pass | Main's 10 route cases + the refused-path leak case, green |
| F-1: no residual narrative in tracked text | ✅ | Pass | Grep + full read of the added comments |
| F-2: the exchange-throws case cannot pass through a refusal | ✅ | Pass | Red with the probe, green without the assertion |
| No regression against main | ✅ | Pass | Gate: 0 new failures |
| A refused or failed callback is never reported as a successful connect (R-3) | ⬜ | Deferred | SA R-3: an acceptance criterion of the signing slice |
| The state is bound to the flow that issued it | ⬜ | Out of scope | Signing slice |

### Issues Found (port)

- **Bugs:** none.
- **Performance:** none new.
- **Edge cases:** none new. Edge case 2 of the 2026-11-08 report (no direct unit test for
  `oauth-callback-schema.ts`) still stands, as recommended for the signing slice.

### Files QA changed (port)

**None.** Every probe was reverted from a byte copy, and all eight touched files match their
pre-QA sha256. Nothing staged, committed or stashed. The only file QA edited is this workplan.

### Final Status (port)

- [x] All acceptance criteria in scope pass — ready for commit
- [ ] Issues found — Dev must address before commit

**Note for RM (carried forward):** the two untracked files (`lib/validation/oauth-callback-schema.ts`,
this workplan) must be `git add`-ed. Check they are not intent-to-add empty blobs, as on the
original branch.

## Commit Info

_RM to populate. Nothing is committed in this slice until the user has seen the diff._

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-11-07 | Workplan created, slice implemented | S11.5-1: session-scoped identity on the plugin OAuth callback |
| 2026-11-07 | SA review, then revision | B1 (refusal row was not durable) and B2 (`request` on a refusal row) fixed; the four non-blocking items taken; two deferred with SA's reasons recorded |
| 2026-11-08 | QA pass | Suites green (11 + 195 + 358); typecheck clean in all eight files (first run OOM'd and was re-run); eight failability probes, each turning only the tests it names red; SA's two nits closed with cases (v) and (vi); SA's count of 7 red under the ordering probe confirmed against the workplan's earlier 6; two Low edge cases found, both now locked by a test |
| 2026-11-27 | Ported onto main `e797bc0d` | New branch `fix/s11-5-1-oauth-callback-session-identity`; ten conflicts resolved (P-1..P-10); main's escaping, generic errors, name-only logging and `Invalid state` contract kept; the two route test files merged into one (22 tests); two tests added; SA re-ruling requested on R-1..R-3 |
| 2026-11-27 | SA port review | R-1 accepted (main's `escapeJs`), R-2 confirmed, R-3 deferred to the signing slice with an acceptance-criterion condition; approved for QA after two Low fixes (F-1 comment wording, F-2 a reach assertion); the `oneAddressPolicy` guard red verified as a pre-existing Windows path artifact on clean main; residual-describing wording in this workplan neutralised |
| 2026-11-27 | QA port pass: PASS | F-1 and F-2 confirmed (F-2 probe red, green without the assertion); 18 suites / 215 tests green; key probe 9 red, R-2a 6 red, R-2b 5 red, all restored byte-exact; focused and full typecheck clean in touched files (no OOM, full total 1846 unchanged); gate vs clean `e797bc0d`: 0 new failures |
