# Workplan: Environment Configuration Hardening

> **Last Updated**: 2026-10-27

**Developer:** Dev
**Requirement:** [ENV_CONFIG_HARDENING_REQUIREMENT.md](/docs/requirements/ENV_CONFIG_HARDENING_REQUIREMENT.md) (SA-approved 2026-10-27; § SA Review rulings and conditions are binding)
**Branch:** `fix/env-config-hardening` (created by TL; confirmed with `git branch --show-current`)
**Status:** Code Complete

## Overview

Configuration cleanup only: drop an unused build env passthrough, align the V1 Slack strategy with the server-only variable name, and make two secret readers fail closed when unset or empty. No DB tables, no migrations, no UI.

## Implementation Approach

| Fix | Approach |
|---|---|
| FR-1 Nango | Delete the `env` block in `next.config.js` (it holds only the two Nango names). Remove the two catalogue entries; drift guard then passes without them. |
| FR-2 Slack (OQ-1) | V1 reads `SLACK_CLIENT_SECRET`; header comments in both strategy files updated. V1 not retired. Remove catalogue entry `NEXT_PUBLIC_SLACK_CLIENT_SECRET`. |
| FR-3a encrypt (OQ-2) | Copy `bookingTokenSecret()` from `lib/services/bookingToken.ts`: private `encryptionKey()` reads `ENCRYPTION_SECRET` per call, treats `''` as unset, throws `Error('ENCRYPTION_SECRET must be set ...')` (variable name only), derives the sha256 key on each call. No module-level read, no cache. Algorithm and IV unchanged, so existing ciphertext still decrypts. |
| FR-3b WhatsApp (OQ-3) | Read `WHATSAPP_VERIFY_TOKEN` inside `GET`. Unset/empty: `logger.error` (no token value) and return the same `Forbidden` 403 as a wrong token; challenge never echoed. POST unchanged. |
| Logging (cond. 1) | Convert 40 `console.*` in `slackPluginStrategy.ts` and 12 in `slackDataStrategy.ts` to `createLogger({ module })`, context-first, errors as `{ err }`. The `NEXT_PUBLIC_APP_URL` lines (9, 55-56) stay byte-identical. Proceed unless the user declines. |
| Comments (cond. 3) | New comments say "fails closed when unset" only; never repeat the removed default strings. |

## Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `next.config.js` | modify | FR-1.1/1.2 remove `env` block |
| `lib/admin/environment/catalogue.ts` | modify | FR-1.3, FR-2.3 remove three entries |
| `lib/admin/environment/__tests__/catalogue.test.ts` | modify | FR-1.4 K-3: browser-inlined == `NEXT_PUBLIC_` prefix only |
| `lib/plugins/strategies/slackPluginStrategy.ts` | modify | FR-2.1/2.2 + Pino conversion |
| `lib/plugins/strategies/slackDataStrategy.ts` | modify | FR-2.2 + Pino conversion |
| `lib/encryptCredentials.ts` | modify | FR-3.1 call-time check |
| `app/api/plugins/webhooks/whatsapp-business/route.ts` | modify | FR-3.2 in-handler read, fail closed |
| `lib/__tests__/encryptCredentials.test.ts` | create | AC-6 unit tests |
| `app/api/plugins/webhooks/whatsapp-business/__tests__/route.test.ts` | create | AC-7 unit tests |
| `lib/__tests__/envConfigHardening.guard.test.ts` | create | Cond. 2: both source guards in one file, plain `fs` reads |
| `docs/TWO_REPO_DEPLOYMENT_GUIDE.md` | modify | Cond. 4: delete "### 3. Nango Configuration" block; renumber any following numbered subsections (none follow today, next heading is `## Testing Checklist`) |
| `docs/requirements/ADMIN_ENVIRONMENT_CONFIGURATION_VIEW_REQUIREMENT.md` | modify | Cond. 4: one Change History row (three catalogue rows removed by this work); § 5 untouched |
| `docs/requirements/ENV_CONFIG_HARDENING_REQUIREMENT.md` | modify | Status + Change History per stage |

## Task List

- [x] 1. Branch `fix/env-config-hardening` confirmed and recorded above. ✅
- [x] 2. FR-1: `env` block removed from `next.config.js`; two Nango catalogue entries removed; K-3 is now prefix-only. ✅
- [x] 3. FR-2: V1 Slack reads `SLACK_CLIENT_SECRET`; both headers updated; catalogue entry removed. ✅
- [x] 4. Pino conversion, both Slack files, server `createLogger` from `@/lib/logger` (SA 2, 3): 0 `console.*` left. Not one-for-one: the token request and token response logs were dropped; logs carry status, ids (`userId`, `teamId`), counts, Slack error codes and `{ err }` only; no tokens, codes, channel names, message text, inputs, origins or event data; old "Debug -" lines are one `debug` call. `NEXT_PUBLIC_APP_URL` lines 9 and 55-56 unchanged (SA 4). ✅
- [x] 5. FR-3a: private `encryptionKey()` reads per call, empty = unset, message names the variable only, no cache. ✅
- [x] 6. FR-3b: GET reads the token per request; unset/empty logs an error (no value) and returns `Forbidden` 403. POST unchanged. ✅
- [x] 7. Tests written: encrypt E-1..E-3 (E-3 per SA 6), WhatsApp W-1..W-4 (mocks logger and `@/lib/server/user-plugin-connections`; env set before each GET, SA 5), guards G-1..G-3. ✅
- [x] 8. Deployment guide §3 Nango block deleted (last numbered subsection, nothing to renumber); admin env requirement Change History row added; this requirement's history row added. ✅
- [x] 9. Verification, see § Verification Results. ✅

## Tests

| Test | Cases |
|---|---|
| `encryptCredentials.test.ts` | `ENCRYPTION_SECRET` unset: encrypt throws, decrypt throws; `''`: both throw; error message names the variable and contains no value; set: round trip returns the input; key changes when the env changes between calls (proves no cache). Env saved/restored per test. |
| WhatsApp `route.test.ts` | Unset and `''`: GET with `hub.mode=subscribe` and any token (incl. the old placeholder string as input) returns 403 body `Forbidden`, challenge not in body, `logger.error` called and its args contain no token value (logger mocked). Set: correct token returns 200 + challenge; wrong token returns 403 `Forbidden`. |
| `envConfigHardening.guard.test.ts` | G-1 `next.config.js` contains no `NANGO_`; G-2 no file under `lib/`, `app/`, `components/` (excluding `catalogue.ts` and `*.test.ts`/`__tests__`) contains `NEXT_PUBLIC_SLACK_CLIENT_SECRET`. |
| Existing, must pass | `catalogue.test.ts` (K-3 updated), `catalogueDrift.guard.test.ts`, `oneAddressPolicy.guard.test.ts`, `app/api/plugin-connections/__tests__/route.test.ts`, `serialisation.test.ts`, `classifyEnvironment.test.ts`. |

## Verification Commands

```bash
npx jest lib/__tests__/encryptCredentials.test.ts app/api/plugins/webhooks/whatsapp-business lib/__tests__/envConfigHardening.guard.test.ts
npx jest lib/admin/environment lib/utils/__tests__/oneAddressPolicy.guard.test.ts app/api/plugin-connections/__tests__/route.test.ts
npx tsc --noEmit -p . 2>&1 | grep -E "encryptCredentials|whatsapp-business|slack(Plugin|Data)Strategy|catalogue|envConfigHardening|next.config" ; echo "tsc exit/tail check"
grep -c "console\." lib/plugins/strategies/slackPluginStrategy.ts lib/plugins/strategies/slackDataStrategy.ts   # expect 0
npm run build   # with ENCRYPTION_SECRET and WHATSAPP_VERIFY_TOKEN absent from the build env
```

The tsc output is checked for a completed run (no V8 stack trace) before the filtered grep is read as clean.

## Verification Results (2026-10-27)

| Check | Result |
|---|---|
| Targeted Jest (9 suites: 3 new + drift guard, `catalogue.test.ts`, `serialisation.test.ts`, `classifyEnvironment.test.ts`, `oneAddressPolicy.guard.test.ts`, plugin-connections route) | 8 suites pass; 146 of 147 tests pass. The one failure is `oneAddressPolicy.guard.test.ts` "only the resolver and the documented exceptions read the variable", and it is a Windows-only path issue that was already there: `relative()` strips `ROOT + '/'`, so on Windows every name keeps backslashes and no allow-list matches (8 unrelated files listed). Not caused by this change, which leaves the `NEXT_PUBLIC_APP_URL` lines untouched. Expected green on CI (Linux). |
| Typecheck (`tsc --noEmit`, full project) | Completed (exit 2, 1849 repo-wide errors, no heap crash). Filtered to touched files: 1 error, `slackPluginStrategy.ts(11,15)` TS2305 `PluginStrategy` not exported by `pluginRegistry`. It was already there: line 11 and `pluginRegistry.ts` are unchanged. New files: 0 errors. |
| `next build` with `ENCRYPTION_SECRET` and `WHATSAPP_VERIFY_TOKEN` empty | Pass (exit 0): compiled successfully and generated 324 of 324 static pages; `/api/plugins/webhooks/whatsapp-business` built as a dynamic route. This used the same placeholder Supabase, OpenAI, Stripe and QStash values as `.github/workflows/build.yml`. A first run without those placeholders failed at page-data collection for `/api/admin/execution-stats` ("supabaseUrl is required"). That was a gap in the local environment, not this change. |

## Out of Scope

Retiring V1 registry/strategies; other env defaults; admin page UI; OQ-4 pre-merge check (owned by the user, via TL).

## SA Review Notes

**Reviewed by SA — 2026-10-27**
**Status:** Approved, with the conditions below

The plan matches every ruling and condition in the requirement's § SA Review: OQ-1 to OQ-3, conditions 1 to 5, the doc edits and the guard file. Nothing here blocks the work.

### Comments
1. Header / Task 1: TL has created the branch `fix/env-config-hardening`, so the branch blocker is resolved. Record that branch in the header. SA: resolved
2. Task 4, Pino conversion (`slackPluginStrategy.ts`): a straight one-for-one swap would carry over logs that must not move to structured logging.
   - Line 185 logs the whole token response.
   - Lines 163-166 log the token request, including the authorization `code`.
   - `slackDataStrategy.ts` line 234 logs the processed inputs, and line 189 logs the channel name.
   - Log only status, ids, counts and error codes: no tokens, no authorization codes, no message content or user inputs. Use `debug` for the old "Debug -" lines.
   
   SA: condition
3. Task 4, logger import: use the server `createLogger` from `@/lib/logger`. Today every importer of `pluginRegistry` is server-side (routes plus `lib/` services), so this is safe. Do not add a client import of either file. SA: condition
4. Task 4, line 55 of `slackPluginStrategy.ts`: the commented-out line stays as it is, for the `oneAddressPolicy` byte-identical rule. Do not remove it in this change. SA: resolved
5. Tests, WhatsApp `route.test.ts`: mock `@/lib/server/user-plugin-connections` as well as `@/lib/logger`, so importing the route does not create a Supabase client. Set the env var before each `GET` call, not before import. That way the test proves the value is read on each call. SA: condition
6. Tests, `encryptCredentials.test.ts`: write the "no cache" case as: encrypt under value A, then decrypt under value B, and expect a throw. Then decrypt under A and expect the round trip to succeed. SA: suggestion

### Approval
[x] Workplan approved — proceed to implementation (comments 2, 3 and 5 apply; code review checks them)

**Code Review by SA — 2026-10-27**
**Status:** Code Approved

I reviewed `git diff` (9 files) and the 3 new test files, and ran the targeted Jest suites myself: 141 of 142 pass, and `app/api/plugin-connections/__tests__/route.test.ts` passes 5 of 5.

### Conditions checked
| Item | Result |
|---|---|
| OQ-1 Slack name | `slackPluginStrategy.ts` reads `SLACK_CLIENT_SECRET`, and both file headers are updated. G-2 and G-3 enforce it. Pass |
| OQ-2 encrypt | `encryptionKey()` reads the variable on each call, treats empty as unset, and throws a message that names the variable only. No module-level read and no cache. Algorithm and IV are unchanged. The one caller (`app/api/plugin-connections/route.ts`) is inside a `try` that returns a generic 500. Pass |
| OQ-3 WhatsApp | The token is read inside `GET`. When it is unset or empty, the route logs an error with no value and returns the same `Forbidden` 403. The challenge is never echoed. POST is unchanged. Pass |
| Cond. 1 / SA comment 2, Slack logs | 0 `console.*` calls remain. The token-response and token-request logs are deleted outright. Logs carry status, Slack error codes, `userId`, `teamId`, counts and `action` only. There are no tokens, authorization codes, channel names, message text or processed inputs. Pass |
| SA comment 3, logger | Server `createLogger`, and no new client import. Pass |
| SA comment 4, line 55 | The `NEXT_PUBLIC_APP_URL` lines are untouched. Pass |
| SA comment 5, tests | Both modules are mocked. The env var is set before each call, and W-4 proves it is read per request. Pass |
| Cond. 3 / public-repo wording | Comments and docs say "fails closed" and "hardening" only. The removed default strings appear only as removed diff lines and as a test input (allowed). Pass |
| Cond. 4 docs | The Nango block is deleted from the deployment guide. The admin environment requirement has one Change History row, and its § 5 is untouched. Pass |
| Dead code | The commented-out `console.log` in the popup handler is removed. Pass |

### oneAddressPolicy failure (Windows): Dev's claim confirmed
`lib/utils/__tests__/oneAddressPolicy.guard.test.ts` line 101 defines `relative = (file) => file.replace(ROOT + '/', '')`. `ROOT` and `FILES` are built with `path.join`, so on Windows every path uses backslashes, the replace never matches, and no name equals an `ALLOWED` or `OAUTH_FILES` entry. My run lists 8 files. Most are untouched by this change (`gmailPluginStrategy.ts`, `origins.ts`, `platformBranding.ts`, `UniversalOAuthHandler.ts`, the OAuth callback route, `catalogue.ts`), so this is not a regression. On Linux the replace works and `slackPluginStrategy.ts` is exempt through `OAUTH_FILES`. This failure is pre-existing and Windows-only. It is out of scope here and can be filed as a separate small fix (normalise separators in `relative()`).

### Code Review Comments
None blocking.

### Optimisation Suggestions
- `slackPluginStrategy.ts:11`: TS2305, `PluginStrategy` is not exported by `pluginRegistry`. This error is pre-existing and the line is unchanged. Leave it for the V1 retirement work rather than widening this change.

### Code Approved for QA: Yes
QA owes: the targeted suites on CI (Linux), where `oneAddressPolicy` should be green, and a reading of the `next build` result Dev recorded. The OQ-4 pre-merge check on deployed `ENCRYPTION_SECRET` is still owed by the user.

## QA Testing Report

**QA — 2026-10-27**
**Test mode:** full
**Strategy used:** A (Jest unit and source guards) for the code paths, plus a mutation run of the new tests against the `HEAD` sources. Nothing here needs a browser or a database.
**Focus:** security, api, schema (catalogue)
**Skipped:** `next build` was not re-run, because Dev's recorded result (exit 0, 324 of 324 pages, WhatsApp route dynamic) was read and accepted. A Linux CI run of `oneAddressPolicy` is still owed when the PR opens.
**Input source:** TL trigger message

### Test Coverage
| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| `ENCRYPTION_SECRET` set: encrypt/decrypt round trip | ✅ | Pass | E-2 |
| `ENCRYPTION_SECRET` unset or `''`: encrypt and decrypt both throw, and the message names the variable | ✅ | Pass | E-1 x2. The variable has no value in either case, so the message cannot carry one. |
| Key read per call, no cache | ✅ | Pass | E-3 (A, then B throws, then A works) |
| WhatsApp GET with the correct token echoes the challenge with 200 | ✅ | Pass | W-2 |
| Wrong, unset or `''` token returns 403 with the same `Forbidden` body, and the challenge is never echoed | ✅ | Pass | W-1 (6 cases), W-3 |
| Token read per request | ✅ | Pass | W-4 |
| No token value in any log call | ✅ | Pass | W-1 checks the `logger.error` args. The source shows the `info`/`warn`/`error` calls in `GET` are fixed strings with no token, mode or challenge. |
| `next.config.js` has no `NANGO_`, no source reads the old public Slack secret name, V1 Slack reads `SLACK_CLIENT_SECRET` | ✅ | Pass | G-1, G-2 (scan size above 100), G-3 |
| Catalogue rows removed, K-3 updated, drift guard green | ✅ | Pass | 4 suites in `lib/admin/environment/__tests__` |
| Slack V1 files have no `console.*` and log no tokens, codes or content | ✅ | Pass | 0 `console.` in both files. Diff read: no token, authorization code, channel name or input values are logged. |
| `plugin-connections` route (sole `encryptCredentials` caller) unaffected | ✅ | Pass | 5 of 5 |

### Targeted run (worktree, jest from the parent install)
9 suites: **8 pass, 1 fail. 146 of 147 tests pass.** The only failure is `oneAddressPolicy.guard.test.ts` › "only the resolver and the documented exceptions read the variable".

**Why that failure is pre-existing (no stash used).** I added a scratch worktree at `HEAD`, but it could not run Jest there (no `ts-jest` resolvable outside the repo tree), so I removed it and reasoned from the flagged list:
- It flags 8 files: `catalogue.ts`, `platformBranding.ts`, `gmailPluginStrategy.ts`, `googleDrivePluginStrategy.ts`, `slackPluginStrategy.ts`, `UniversalOAuthHandler.ts`, `origins.ts` and `app/oauth/callback/[plugin]/route.ts`.
- Every one of them is on the test's own `ALLOWED`, `OAUTH_FILES` or `NAME_ONLY_LISTINGS` list, or is the resolver. They are flagged only because `relative()` strips `ROOT + '/'`, which never matches Windows backslash paths.
- The `NEXT_PUBLIC_APP_URL` occurrence count in each of the 8 files is identical at `HEAD` and in the working tree. No added or removed diff line mentions `NEXT_PUBLIC_APP_URL`.
- The `HEAD` run would therefore flag the same 8 files. The failure is Windows-only and not caused by this change.

### Mutation check
I swapped `HEAD` versions of `lib/encryptCredentials.ts`, the WhatsApp `route.ts`, `next.config.js` and `slackPluginStrategy.ts` in temporarily, ran the 3 new suites, then restored the four files. An md5 check confirmed all 4 were byte-identical afterwards.

Result: **15 of 16 failed.** The one pass is E-2 (round trip), which is expected: the old code round-trips under its fallback key. Every fail-closed, per-call and guard test goes red without the fix.

### Wording check
Grep over the added diff lines and the 5 new files for `expos|leak|readable|bundle|rotat|compromis`: **0 hits.**

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None.

#### Edge Cases (nice to fix)
1. **The token-log assertion covers only `logger.error`.** W-1 checks only the `logger.error` args for the supplied token; `info`/`warn` are bare mocks. Today's source is clean, so this is test hardening only, not a defect. Severity: Low.
2. **Browser-only Slack code now uses the server logger.** `slackPluginStrategy.ts` `handlePopupAuth` touches `window` but now calls the server Pino logger. SA ruled this safe (all importers are server-side, comment 3), and the V1 strategy is deprecated. Noted for the V1 retirement work. Severity: Low.

### Final Status
- [x] All acceptance criteria pass — ready for commit (on CI, `oneAddressPolicy` is expected green on Linux; confirm when the PR runs)
- [ ] Issues found — Dev must address before commit

## Commit Info

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-27 | Created | Dev workplan for SA review; no code yet |
| 2026-10-27 | Code complete | Dev: all tasks done per SA review notes; verification recorded |
| 2026-10-27 | SA review | Approved with conditions (SA comments 2, 3, 5) |
| 2026-10-27 | SA code review | Code approved for QA; Windows-only oneAddressPolicy failure confirmed pre-existing |
| 2026-10-27 | QA | Pass: 146 of 147 targeted tests pass (only failure is the pre-existing Windows-only oneAddressPolicy case); mutation 15 of 16 red; 0 wording hits |
