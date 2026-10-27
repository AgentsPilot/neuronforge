# Requirement: Environment Configuration Hardening

> **Last Updated**: 2026-10-27

**Created by:** BA
**Date:** 2026-10-27
**Status:** SA-approved (2026-10-27, with the conditions in § SA Review)

## Overview

A small configuration cleanup in three parts. Remove an unused build-time env passthrough from `next.config.js`, move a deprecated V1 Slack strategy to the server-only variable name, and make two secret readers fail closed when their variable is unset. Each part keeps the admin environment catalogue (`lib/admin/environment/catalogue.ts`) in step with the code, and each part has a Jest test.

---

## User Stories

- As a platform operator, I want `next.config.js` to pass through only the variables the code actually uses, so the build configuration is minimal and easy to audit.
- As a developer, I want every plugin to read its secrets under one server-only name, so configuration is consistent between V1 and V2.
- As a platform operator, I want a missing required secret to cause a clear error, so a misconfigured environment never runs on a built-in default value.

---

## Functional Requirements

### FR-1: Remove the unused Nango env passthrough
1. Remove `NANGO_PUBLIC_KEY` and `NANGO_SECRET_KEY` from the `env` block in `next.config.js`. No code reads either name.
2. Remove the `env` block itself once it is empty.
3. Remove the two Nango entries in `lib/admin/environment/catalogue.ts` (they currently carry `scope: 'browser-inlined'`). The drift guard (`catalogueDrift.guard.test.ts`) fails any entry that no code reads and that has no `consumedBy` marker, so removing them is the expected outcome.
4. Update `lib/admin/environment/__tests__/catalogue.test.ts` K-3, which special-cases the two Nango names.

### FR-2: Use the server-only Slack variable name in the V1 strategy
1. `lib/plugins/strategies/slackPluginStrategy.ts` reads `NEXT_PUBLIC_SLACK_CLIENT_SECRET`. V2 reads `SLACK_CLIENT_SECRET`. Make V1 read `SLACK_CLIENT_SECRET` (recommended; see OQ-1).
2. Update the header comments in `slackPluginStrategy.ts` and `slackDataStrategy.ts` that name the old variable.
3. Remove the catalogue entry `NEXT_PUBLIC_SLACK_CLIENT_SECRET`, which will have no reader.
4. Do not retire the V1 registry in this work. `lib/plugins/pluginRegistry.ts` is still imported by live routes (`app/oauth/[plugin]/start/route.ts`, `app/oauth/token/route.ts`, `app/api/plugin-connections/disconnect/route.ts`, `app/api/generate-agent/route.ts`, and others).

### FR-3: Fail closed when a required secret is unset
1. `lib/encryptCredentials.ts`: drop the `|| 'fallback-secret'` default. If `ENCRYPTION_SECRET` is unset or empty, encrypting or decrypting raises an error. It never falls back to a constant.
2. `app/api/plugins/webhooks/whatsapp-business/route.ts`: drop the `|| 'your-verify-token-here'` default. If `WHATSAPP_VERIFY_TOKEN` is unset or empty, the verification GET logs an error (Pino), returns a non-200 response, and never matches any supplied token.
3. Both readers treat an empty string the same as a missing value.
4. When to check (call time or import time) is OQ-2.

---

## Non-Functional Requirements

- **Security:** Secret readers fail closed. Secret values are never logged or returned to the client. Error responses follow the CLAUDE.md error format.
- **Build:** `next build` must still pass when `ENCRYPTION_SECRET` or `WHATSAPP_VERIFY_TOKEN` is absent from the build environment (see OQ-2).
- **Logging:** Any file touched follows CLAUDE.md rule 3. If it still has `console.*` calls, flag them per § Logging.
- **CI:** Adds no CI time beyond the existing Jest run.

---

## Acceptance Criteria

- [ ] `next.config.js` has no `NANGO_*` names. If an `env` block remains, it holds no non-`NEXT_PUBLIC_` secret. A Jest source guard enforces this.
- [ ] The two Nango catalogue entries are removed and `catalogue.test.ts` K-3 is updated.
- [ ] No code under `lib/`, `app/` or `components/` reads `NEXT_PUBLIC_SLACK_CLIENT_SECRET`. A Jest source guard enforces this.
- [ ] `slackPluginStrategy.ts` reads `SLACK_CLIENT_SECRET`. The header comments in both Slack strategy files name `SLACK_CLIENT_SECRET`.
- [ ] The catalogue entry `NEXT_PUBLIC_SLACK_CLIENT_SECRET` is removed.
- [ ] Jest test: with `ENCRYPTION_SECRET` unset, and again with it empty, encrypt and decrypt raise an error. With it set, a round trip succeeds.
- [ ] Jest test: with `WHATSAPP_VERIFY_TOKEN` unset, and again with it empty, the verification GET returns non-200 and logs an error, whatever token is supplied (including `your-verify-token-here`). With it set, the correct token verifies and a wrong one is refused.
- [ ] `next build` passes with both variables absent.
- [ ] These existing guards pass: `lib/admin/environment/__tests__/catalogueDrift.guard.test.ts`, `lib/admin/environment/__tests__/catalogue.test.ts`, `lib/utils/__tests__/oneAddressPolicy.guard.test.ts`, `app/api/plugin-connections/__tests__/route.test.ts`.

---

## Out of Scope / Future Roadmap

- Retiring the V1 plugin registry and strategies (`lib/plugins/pluginRegistry.ts`, `lib/plugins/strategies/`). This is a separate migration of the live routes listed in FR-2.4.
- Any wider review of env defaults beyond the two readers in FR-3.
- Changes to the admin environment page UI.

---

## Open Questions

- [x] **OQ-1: V1 Slack strategy: switch the name, or retire it?** (raised by: BA | status: resolved by SA, see § SA Review)
  Suggested resolution: switch to `SLACK_CLIENT_SECRET`. It is a one-line change that lines V1 up with V2. Retiring the strategy means migrating live OAuth, disconnect and generate-agent routes off the V1 registry, which is out of scope here.
- [x] **OQ-2: When should the secret check run?** (raised by: BA | status: resolved by SA, see § SA Review)
  Suggested resolution: at call time, not import time. `lib/encryptCredentials.ts` currently reads the variable at module load, so a throw there would crash `next build` page-data collection in a build environment without the variable. Read and validate inside the encrypt and decrypt functions (or a lazy getter).
- [x] **OQ-3: WhatsApp verification when no token is configured** (raised by: BA | status: resolved by SA, see § SA Review)
  Suggested resolution: refuse verification. Log an error and return a non-200 response (503 or 403, SA to pick), never echo the challenge, and treat an empty string as unset. SA to confirm the status code and whether the POST handler needs the same guard.
- [x] **OQ-4: Existing data encrypted under the default** (raised by: BA | status: resolved by SA, see § SA Review)
  Suggested resolution: assume every deployed environment sets `ENCRYPTION_SECRET`, so no stored data depends on the default. SA to confirm before merge. If any environment does lack it, decrypting stored credentials would start to fail, and that needs a separate plan.

---

## SA Review

**Reviewed by SA — 2026-10-27**
**Status:** Approved, with the conditions below

### Claims checked against the code

All claims hold. `next.config.js` lines 9-12 hold the `env` block with only the two Nango names, and no code under `lib/`, `app/` or `components/` reads either name. `catalogue.ts` lines 281 and 288-289 hold the three entries to remove. `catalogue.test.ts` K-3 (line 98-103) special-cases the Nango names. `slackPluginStrategy.ts` reads the old name at line 81, and both Slack strategy headers name it at line 8. `encryptCredentials.ts` builds its key at module load (lines 3-5). The WhatsApp route reads its token at module load (line 8). The POST handler does not use the verify token.

### Rulings

| # | Ruling |
|---|---|
| OQ-1 | **Switch the name** to `SLACK_CLIENT_SECRET`. Do not retire V1 here. A one-line rename is not "extending" a deprecated system. |
| OQ-2 | **Check at call time.** Follow the existing `bookingTokenSecret()` pattern in `lib/services/bookingToken.ts`: a private function reads the variable, treats an empty value as unset, and throws. Derive the key inside that function on each call. No module-level `process.env` read, no cache. The thrown message names the variable only, never a value. |
| OQ-3 | **Return 403, with the same body as a wrong token**, so an unauthenticated caller cannot tell "not configured" from "wrong token". Log the misconfiguration at `error` (Pino) without any token value. Read the variable inside `GET`, not at module load. The POST handler needs no change: it does not use the verify token. |
| OQ-4 | **Pre-merge check, owned by the user.** It cannot be checked from the code. See the hand-off to TL. |

### Conditions for implementation

1. **Logging.** `slackPluginStrategy.ts` has 40 `console.*` calls and `slackDataStrategy.ts` has 12. Both files are touched, so Dev flags them and proposes the Pino conversion per CLAUDE.md § Logging. Code review will mark them Fix Required unless the user declines. If they are converted, keep the `NEXT_PUBLIC_APP_URL` lines as they are, because `oneAddressPolicy.guard.test.ts` lists `slackPluginStrategy.ts` in `OAUTH_FILES`.
2. **Source guards.** Put the two new source guards (no `NANGO_*` in `next.config.js`, no reader of the old Slack name) in one new `*.guard.test.ts`. Use plain file reads only, so no CI time is added. Exclude `catalogue.ts` and test files from the Slack scan.
3. **Code comments.** New comments describe the change as hardening only ("fails closed when unset"). Do not echo the removed default strings in comments. Tests may use them as inputs, as AC-7 requires.
4. **Docs.** Delete the Nango block in `docs/TWO_REPO_DEPLOYMENT_GUIDE.md` § 3 (lines 412-421), because it names a variable the build no longer passes through. Add one Change History line to `docs/requirements/ADMIN_ENVIRONMENT_CONFIGURATION_VIEW_REQUIREMENT.md` saying the three catalogue rows were removed by this work. Do not rewrite its § 5 table or the historical `ADMIN_ENVIRONMENT_VIEW_WORKPLAN.md`.
5. **No other changes needed.** `.env.example` and `docs/feature_flags.md` name none of these variables. `serialisation.test.ts` uses `ENCRYPTION_SECRET` only as a catalogue name, and that entry stays. `classifyEnvironment.test.ts` counts the catalogue dynamically. `app/api/plugin-connections/__tests__/route.test.ts` mocks `encryptCredentials`, so call-time checking does not affect it.

---

## Notes on Integration Points

| Area | Files |
|---|---|
| Build config | `next.config.js` |
| Env catalogue + guards | `lib/admin/environment/catalogue.ts`, `lib/admin/environment/__tests__/catalogueDrift.guard.test.ts`, `lib/admin/environment/__tests__/catalogue.test.ts` |
| V1 Slack (deprecated, not extended) | `lib/plugins/strategies/slackPluginStrategy.ts`, `lib/plugins/strategies/slackDataStrategy.ts` |
| Credential encryption | `lib/encryptCredentials.ts` (callers in plugin connection flows) |
| WhatsApp webhook | `app/api/plugins/webhooks/whatsapp-business/route.ts` |

No database tables are affected and there are no migrations.

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-27 | Created | BA draft: three hardening items, four open questions for SA |
| 2026-10-27 | SA review | OQ-1..OQ-4 resolved; status SA-approved with conditions |
| 2026-10-27 | Code complete | Dev, branch `fix/env-config-hardening`: FR-1 to FR-3 implemented per the [workplan](/docs/workplans/ENV_CONFIG_HARDENING_WORKPLAN.md); awaiting SA code review |
