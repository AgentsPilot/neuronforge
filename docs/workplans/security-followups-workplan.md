# Workplan: Security Follow-ups from PR #73 (F4 / F8 / F9 / F10 / F11 + CR1 / F12 / F13)

> **Last Updated**: 2026-09-21

## Overview

Five small, independent follow-ups left open by the merged `auth_config` exposure fix
([plugin-auth-config-exposure-workplan.md](/docs/workplans/plugin-auth-config-exposure-workplan.md), PR #73).
The user's explicit constraint for this branch: **small, tightly-scoped fixes, no drift** — each item stands alone and
is separately revertable.

**Branch:** `fix/security-followups` (worktree `neuronforge-followups`, rebased onto `origin/main` **9aeeb50e**; originally cut from e08091da)
**Status:** ✅ SA-approved for QA — 8 items (F4/F8/F9/F10/F11 first pass; CR1/F12/F13 second pass), 2026-09-21
**Developer:** Dev · **Reviewer:** SA

## Table of Contents

- [Items](#items)
- [Files Changed](#files-changed)
- [SA Review Notes](#sa-review-notes)
- [SA Review Notes — Second Pass (CR1 / F12 / F13)](#sa-review-notes--second-pass-cr1--f12--f13)
- [QA Testing Report](#qa-testing-report)
- [Change History](#change-history)

---

## Items

| # | Item | Change |
|---|---|---|
| **F4** | `POST /api/analyze-prompt-clarity` was unauthenticated and derived identity from `body.userId` / `x-user-id` / the literal `'anonymous'` | `getUser()` + 401 before the body is parsed; identity is session-only; `details: error.message` dev-guarded at both 500 sites. The 51 `console.*` are deliberately **not** converted (proportionality — SA decision 9 of the parent workplan) |
| ~~**F8**~~ | **DROPPED from this branch (QA-1, 2026-09-21)** — `main` @ 9aeeb50e already deleted `eslint.config.js` and rewrote `eslint.config.mjs` (PR #76) | Reverted here; branch no longer touches any eslint config or `package.json`. The still-missing half — pointing `npm run lint` at the flat config — is carried as **F15**. The 9,992-error figure below was measured under the OLD config and is obsolete: ~~`Deleted eslint.config.js`; `lint` script is now `eslint .`; added an `ignores` block for build output and agent worktrees. Reveals 9,992 errors / 247 warnings (7,598 `no-explicit-any`) — **none fixed here**~~ |
| **F9** | SA residual risk R1: the branded wire type binds only where a response type is declared, and `toJSON()` covers only context class instances | New source-level guard test scanning every `app/api/**/route.ts` for an unprojected plugin definition / `auth_config` in a response body, with a 4-entry reviewed allow-list |
| **F10** | `GET /api/plugins/execute` (catalogue mode) allowed anonymous enumeration of every plugin key and action name | `getUser()` + 401; 3 tests |
| **F11** | The 401/400 responses of `available` and `llm/context` carried no cache headers | `Cache-Control: private, no-store` + `Vary: Cookie` on both failure paths; 500s untouched |
| **F12** | `GET /api/plugins/action-schema` was the remaining anonymous enumeration path, and a superset of what F10 closed | `getUser()` + 401, same shape as `available` / `execute`; header invariant amended; 401 test added (added to this branch on user approval, 2026-09-21) |
| **F13** | Same cross-user disclosure as F4 in `POST /api/enhance-prompt` and `POST /api/generate-clarification-questions` — both unauthenticated, both passing a caller-supplied id to `getUserActionablePlugins` | `getUser()` + 401; every downstream use switched to the session id; 3 tests each, copied from the F4 shape (added to this branch on user approval, 2026-09-21) |

---

## Files Changed

| File | Item | Action |
|---|---|---|
| `app/api/analyze-prompt-clarity/route.ts` | F4 | modify (+14/−4) |
| `app/api/analyze-prompt-clarity/__tests__/auth.test.ts` | F4 | create (99 lines) |
| ~~`eslint.config.js`~~ | F8 | ~~delete~~ — **reverted 2026-09-21 (QA-1); main deleted it in PR #76** |
| ~~`eslint.config.mjs`, `package.json`~~ | F8 | ~~modify~~ — **reverted 2026-09-21 (QA-1); this branch no longer touches either** |
| `app/api/plugins/__tests__/plugin-definition-egress.guard.test.ts` | F9 | create (212 lines) |
| `app/api/plugins/execute/route.ts` | F10 | modify |
| `app/api/plugins/__tests__/identity-hardening.test.ts` | F10 | modify (+46) |
| `app/api/plugins/available/route.ts`, `app/api/llm/context/route.ts` | F11 | modify |
| `app/api/plugins/available/__tests__/route.test.ts`, `app/api/llm/context/__tests__/route.test.ts` | F11 | modify (+15 each) |
| `app/api/plugins/action-schema/route.ts` | F12 | modify (+19/−7) — route now gated; header invariant amended (was comment-only before F12 was approved) |
| `app/api/plugins/action-schema/__tests__/route.test.ts` | F12 | modify (+23/−4) — `getUser` mock + 401 test |
| `app/api/plugins/__tests__/no-secret-egress.test.ts` | F12 | modify (+1/−1) — test label no longer says "intentionally unauthenticated" |
| `app/api/enhance-prompt/route.ts` | F13 | modify (+13/−6) |
| `app/api/enhance-prompt/__tests__/auth.test.ts` | F13 | create (100 lines) |
| `app/api/generate-clarification-questions/route.ts` | F13 | modify (+19/−10) |
| `app/api/generate-clarification-questions/__tests__/auth.test.ts` | F13 | create (98 lines) |
| `app/api/plugins/execute/route.ts`, `app/api/plugins/action-schema/route.ts` | QA-2 | modify — `no-store` + `Vary: Cookie` on the new 401s (1 line each) |
| `app/api/plugins/__tests__/identity-hardening.test.ts`, `app/api/plugins/action-schema/__tests__/route.test.ts` | QA-2 | modify — 2 header assertions added to each existing 401 test |

---

## SA Review Notes

**Code Review by SA — 2026-09-21**
**Status:** ✅ **Code Approved** — approved for QA with **one required fix (CR1, ~4 lines, no drift)**.
**Scope discipline: clean.** Nothing outside the five items changed; the one extra file
(`action-schema/route.ts`) is a comment-only correction of a justification that F10 invalidated, which is the right
call, not drift.

Verified by running the code in the worktree, not from the report.

### Verification summary

| Question | Method | Result |
|---|---|---|
| Do the suites pass? | `npx jest app/api/plugins app/api/llm/context app/api/analyze-prompt-clarity lib/plugins/__tests__` | ✅ **10 suites, 117 tests, all green** |
| Does F4 ignore client identity *everywhere downstream*? | Grepped every `userId` / `x-user-id` / `userIdToUse` occurrence in the route | ✅ the body's `userId` is no longer destructured; `userIdToUse = user.id` is the single source, used at `:312, 340, 389, 427, 556`. No remaining header or body read |
| Is `isDevEnv` in scope at the two new guards? | Read `:239-241` | ✅ declared at the top of `POST`, before both `:452` and `:591` |
| Does F4 break a live caller? | Traced `components/agent-creation/useConversationalBuilder.ts:129` | ✅ safe — `:108` returns early unless `user?.id`, and it already sends its **own** session id, so the value is unchanged for the live flow |
| Does F10 have a live caller? | Grepped the route path and the wrapper `PluginAPIClient.getPluginActions` across `app/`, `components/`, `lib/` | ✅ **zero callers**. The `getPluginActions` at `app/test-plugins-v2/page.tsx:1227` is an unrelated local function reading already-fetched state |
| Can F8 redden CI or the build? | Read all four workflows + `next.config.js` | ✅ no workflow runs `npm run lint`, and `next.config.js` sets `eslint.ignoreDuringBuilds: true`, so `next build` is unaffected. The non-zero exit is developer-visible only |
| Does F11 cover what it claims? | Read the diff + the two new tests | ✅ 401 and 400 on both routes; 500s deliberately untouched (they carry no per-user data) |
| Anything beyond the five items? | `git status` / `git diff --stat` | ✅ 11 modified/deleted + 2 new test paths, all attributable |

### The F9 guard — probed, not trusted

I ran the guard's own exported analysis functions against nine synthetic shapes (throwaway probe, since deleted).
What it **catches**: a spread of a raw definition; a fully inline `.map` over definitions inside the
`NextResponse.json(...)` call; an offence that follows a string containing an unbalanced-looking paren (the depth scan
recovers); and it correctly ignores comments and URLs. The corpus guard (`> 200` route files) and the
can-actually-fail self-test are both real, and the 4 allow-list entries are each accurate — I re-read all four routes
and confirmed the `auth_config` value is consumed server-side and never reaches a response body.

What it **misses** — three proven blind spots:

| Shape | Result |
|---|---|
| `const payload = { plugin: definition }; return NextResponse.json(payload)` | **not caught** — the serialised expression is the bare identifier |
| `NextResponse.json({ safe: toClientPluginInfo(k, d), raw: definition })` | **not caught** — one projection token anywhere clears the *whole* expression |
| `const plugins = defs.map(...); return NextResponse.json({ plugins })` | **not caught** |

The third one matters most: **that is the exact source shape of the original P0 leak in `available/route.ts`**, so as
written the guard would not have caught the bug it memorialises. It would also not have caught the second leak
(`connectedPluginsMetaData` — a context-typed variable with a domain name); that class is covered at runtime by
`PluginDefinitionContext.toJSON()` instead.

This does not make the guard worthless — it is free, fail-closed on corpus size, and forces a deliberate allow-list
entry — but a green run must not be read as coverage.

1. **CR1 (required, ~4 lines, no drift)** — state those three blind spots in the guard's header comment, right under
   the "If this test fails on YOUR new route" paragraph. The file currently reads as if a new route doing
   `NextResponse.json({ plugin: definition })` is the general case; a future reader will over-trust it.
   — Priority: Medium
2. **CR2 (recommended, own PR — F14)** — strengthen the analysis with one level of local-variable resolution: for each
   serialised expression, take its bare identifiers and also test the right-hand side of a same-file
   `const <id> = …` assignment. That converts all three misses into hits. Roughly 15 lines, but it is new behaviour
   with its own false-positive surface, so it does **not** belong in this branch. — Priority: Medium
3. **CR3 (note, no action)** — `mentionsUnprojectedAuthConfig` fires on **any** route whose source contains the string
   `auth_config` without a projection helper — including one that only reads `auth_config.auth_type` server-side, and
   one that merely has the words in a string literal. So the honest answer to "will it false-positive on ordinary new
   routes?" is **yes, by design**: any new route touching `auth_config` must be allow-listed. The failure message is
   actionable and the allow-list has a staleness check, so this is an acceptable trade — but QA and Dev should expect
   it. — Priority: Low

### Finding outside the five items — the IDOR class is not closed

F4 fixed **one of three** identical instances of the same bug. Both siblings are unauthenticated and both take the
user id from the request body, and both are called by the same live hook (`useConversationalBuilder`, which sends
`x-user-id`):

| Route | Line | Shape |
|---|---|---|
| `app/api/enhance-prompt/route.ts` | `:58, :97` | `extractIdFromRequest(userId,'x-user-id','anonymous')` → `getUserActionablePlugins(userId)`, and the result **is returned** (`:460 connectedPluginData`, plus `metadata.connectedPlugins`) |
| `app/api/generate-clarification-questions/route.ts` | `:160` | `getUserActionablePlugins(userId)` from the body → the keys are returned as `connectedPlugins` |

So an anonymous caller can still enumerate any user id's connected plugins via `POST /api/enhance-prompt`. Same class
as the `/api/llm/context` IDOR that was already fixed, same ~8-line remedy, same test shape as
`analyze-prompt-clarity/__tests__/auth.test.ts`. **Not in scope for this branch** (the user asked for no drift), but it
must be tracked and done next — recorded as **F13, Priority: High**.

### The two decisions Dev raised

**Decision A — `GET /api/plugins/action-schema`: separate follow-up (F12), not this branch.**
Dev is right that the old justification ("a strict superset of the already-unauthenticated `execute` GET") died with
F10, and updating the comment rather than silently leaving it was the correct move. On the substance: action-schema
exposes a **superset** of what F10 just closed (every action's parameter and output schema), so while it stays open,
**F10's security value is largely symbolic** — an attacker enumerates the registry through action-schema instead. The
two should share one rule. I am still not gating it here, for three reasons: it reverses an explicit prior SA decision
(Q1 / CR3) that deserves its own record; its three live callers (`/test-business-os` at `page.tsx:215`,
`FormTester.tsx:42`, `PluginAPIClient` at `:251`) are internal test surfaces that need a deliberate logged-out QA
pass; and this branch is already five items against a "no drift" instruction. **F12: gate `action-schema` with
`getUser()` + 401, same shape as F10, + tests — next PR, and soon.** Until then, record in the workplan that anonymous
registry enumeration remains possible.

**Decision B — CI for the guard tests: wire them, in their own one-file PR.**
A guard that no automated job runs is documentation. The precedent already exists and is a close match:
`.github/workflows/admin-authz-guard.yml` runs a single static-scan guard through a dedicated npm script, with **no
`paths:` filter** — deliberately, because a path-filtered workflow is defeated by the very change it guards (a brand
new `app/api/**/route.ts` matches none of `plugin-tests.yml`'s filters). Neither existing workflow runs `npm test`, so
these two guards have nowhere to attach today. **Recommendation:** add `test:security-guards` (running
`plugin-definition-egress.guard.test.ts` + `dead-plugin-routes-removed.guard.test.ts` with `--ci`) and a
`security-guards.yml` modelled on the authz workflow, including its "not a gate until it is a required status check"
header. Two caveats carried from that precedent: the check is matched **by job name**, and **the user must enable it**
under branch protection or it blocks nothing. Keep it out of this branch — it is a sixth item and it needs a user
action to mean anything.

### Standards compliance

| Standard | Verdict |
|---|---|
| Zod at touched input boundaries | ✅ unchanged and still present on all three routes |
| Auth before side effects | ✅ F4 authenticates **before** the body parse; both F10 tests assert the registry is never read on 401 |
| Error bodies `NODE_ENV`-guarded | ✅ both `analyze-prompt-clarity` 500 sites now match the CLAUDE.md pattern |
| Pino / no new `console.*` | ✅ none added. The 51 pre-existing in `analyze-prompt-clarity` remain a recorded, user-approved deferral (F4 of the parent workplan) — note this file is now being touched for the second time, so the deferral should be re-confirmed rather than assumed permanent |
| Repository pattern / RLS | ✅ n/a — no DB access added |
| TypeScript strict, no new `any` | ✅ none added |
| Tests for new behaviour | ✅ every item ships a failure-path test; F10's asserts the "never runs" property, which is the one that matters |

### Notes for QA

1. **F4 behaviour change (deliberate):** `/test-plugins-v2`'s AI-service panel for `analyze-prompt-clarity` now runs as
   the **session** user and 401s when signed out. Its template still contains a `userId: "test_user_123"` field, which
   is now inert — confirm the panel shows a clear error rather than appearing to succeed. (Removing the dead field is
   cosmetic; do not fix it in this branch.)
2. **F4 happy path:** the real consumer is the conversational agent-creation flow — run it signed in end-to-end
   (prompt → clarity analysis → questions) and confirm the connected-plugin list is still correct. It should be
   *identical*, because the hook already sent its own session id.
3. **F10:** `curl /api/plugins/execute` and `…?plugin=google-mail` with no cookie → 401; with a cookie → the catalogue.
   Then confirm the plugin **execution** path (POST) is untouched: run one operation from `/test-business-os` → Modules.
4. **F11:** `curl -i` the 401 of both `available` and `llm/context` and check for `Cache-Control: private, no-store`
   and `Vary: Cookie`.
5. **F8:** `npm run lint` now exits **non-zero** (9,992 errors). That is expected and is not a regression — verify only
   that `npm run build` still exits 0 and that no CI job invokes lint.
6. **Regression watch for the earlier cycle:** `/test-business-os` Modules tab and `settings/connections` must still
   load plugins.

### For the user

1. **The cross-user disclosure class is not fully closed.** `POST /api/enhance-prompt` (and
   `generate-clarification-questions`) still accept a caller-supplied user id with no session — F13 above. Small fix,
   same shape as F4, but it needs its own PR.
2. **Anonymous registry enumeration is still possible** via `GET /api/plugins/action-schema` — F12. Until that ships,
   F10 mostly tidies rather than closes.
3. **CI decision needs you:** a guard workflow only blocks a merge once it is added as a **required status check**
   under Settings → Branches for `main`. The existing `admin-authz-guard` job is in the same position.
4. **F8 leaves `npm run lint` red** (9,992 errors, 7,598 of them `no-explicit-any`). Nothing is gated on it today, so
   this is safe — but a decision is owed on whether to ratchet (e.g. lint only changed files) before it becomes a gate.

### Code Approved for QA: **Yes** — after CR1 (comment-only)

---

## Dev Response — CR1, F12, F13 (2026-09-21)

_Appended by Dev after SA's review above. The review's own text is unchanged._

### CR1 — done (comment-only)

Added a `KNOWN BLIND SPOTS (SA probe)` block to the header of
`app/api/plugins/__tests__/plugin-definition-egress.guard.test.ts`, directly under the "If this test fails on YOUR new
route" paragraph. It names all three misses — assign-then-serialise, mixed payloads where one projection token clears
the whole expression, and `const plugins = defs.map(...); NextResponse.json({ plugins })` — and states explicitly that
the third is the source shape of the original P0 leak, so the guard would not have caught the bug it memorialises. It
closes with: a pass means "no known-bad shape found", **not** "no leak possible", pointing at F14 (CR2) as the
strengthening follow-up. No logic changed; the suite still passes 6/6.

### F12 — `GET /api/plugins/action-schema` gated

`getUser()` + 401 at the top of the handler, before the Zod parse and before the registry is read — same shape as
`available` and `execute`. The `METADATA-ONLY INVARIANT` header block is amended rather than deleted: the metadata-only
property still holds and is still why the body needs no projection; what changed is that the route is no longer
anonymous, and the comment now records why (the "strict superset of the unauthenticated `execute` GET" justification
died with F10, and this route exposes more than that one did).

**The three live callers, and why none breaks.** All three are internal test surfaces, all use plain `fetch` with the
default `same-origin` credentials, so the session cookie is sent:

| Caller | Evidence it runs signed in |
|---|---|
| `app/test-business-os/page.tsx:215` (`getModuleActionSchema`) | the Modules tab only loads when `user` is truthy (`page.tsx:207`) |
| `components/test-plugins/tester/FormTester.tsx` (via `getActionSchema` prop) | wired at `app/test-plugins-v2/page.tsx:1156` to `PluginAPIClient.getActionSchema`; the tester sits behind the page's connection-completeness gate and a session-seeded userId |
| `lib/client/plugin-api-client.ts:251` | `fetch(url, { cache: 'no-store' })` — no `credentials` override |

**For QA — each of the three needs a deliberate signed-out check** (expect a clean error surface, not a silent empty
form): (a) `/test-business-os` → Modules → pick a module, (b) `/test-plugins-v2` → Form Tester → pick a plugin/action,
(c) `curl '/api/plugins/action-schema?plugin=google-drive'` with and without a cookie → 401 / 200.

### F13 — the two siblings of the F4 IDOR

Same ~8-line remedy in both, copied from F4: `getUser()` + 401 as the first statement in the `try`, before the body is
read; every downstream use of the id switched to the session value.

| Route | What changed |
|---|---|
| `app/api/enhance-prompt/route.ts` | `userId` dropped from the destructure; `userIdToUse = user.id` replaces `extractIdFromRequest(userId,'x-user-id','anonymous')`; `:97` now passes `userIdToUse` (it previously passed the raw body `userId`, not even the fallback variable) |
| `app/api/generate-clarification-questions/route.ts` | `userId` dropped from the destructure; `userIdToUse = user.id`; the plugin-lookup branch, the AI-analytics call, the `clarification_analytics` insert and the response payload's `userId` all use it |

**Internal error text:** checked both, as asked. Neither leaks — both catch blocks return a flat
`{ error: 'Internal server error' }` with no `details` / `message` / `stack`, so no `NODE_ENV` guard was needed and
none was added.

**One deliberate behaviour change in `generate-clarification-questions`:** the plugin-lookup branch was
`else if (userId)`, which was skipped entirely when no id was supplied. It is now a plain `else` using the session id —
that branch is the one that leaked, and with identity server-derived there is no longer a "no id" case. In the live
flow this branch is rarely reached: the hook passes `connectedPlugins` from step 1, which wins on the earlier branch.

**Callers — no live breakage.** The live consumer of both routes is `components/agent-creation/useConversationalBuilder.ts`
(`:159` step 2, `:578` step 3). Both already run only with a signed-in user and send their own session id, so the value
used is unchanged; their `x-user-id` headers are now inert. The three wizard callers
(`components/wizard/Step1ClarificationQuestions.tsx:118`, `Step2BasicsPrompts.tsx:174`, `Step2Prompts.tsx:191`) are
**dead code** — their only parent is `components/AgentWizard.tsx`, which has zero importers (it hangs off the disabled
`agents/new/page.tsxold`), consistent with the earlier cycle's finding.

**Same test-page change as F4:** the `/test-plugins-v2` AI-service panel templates for `enhance-prompt` and
`generate-clarification-questions` still carry a `userId: "test_user_123"` field which is now inert, and the panel 401s
when signed out. Cosmetic; not removed in this branch.

### Verification after F12 + F13

| Check | Result |
|---|---|
| Touched suites | `enhance-prompt` 3/3, `generate-clarification-questions` 3/3, `action-schema` 7/7, `plugins/*` + `llm/context` + `analyze-prompt-clarity` all green |
| `npm test` vs the main `e08091da` baseline | **Identical failing-suite set** (21 suites / 129 tests, all pre-existing). Passing: 355 suites / 5,527 tests vs 351 / 5,506 on main — i.e. +4 suites, +21 tests, all new |
| `tsc --noEmit` | 2,038 errors repo-wide — **byte-identical count to the pre-F12/F13 run**; none in any touched file. (The one `.next/types/app/api/generate-clarification-questions/route.ts` error is a stale generated-types artefact present in the earlier run too. Needs `--max-old-space-size=8192`; it OOMs at the 4 GB default) |
| `eslint` on changed files | 8 errors, all on pre-existing lines (unused imports, pre-existing `any`, `prefer-const`); zero on added lines; both new test files clean |
| `next build` | ✓ Compiled successfully, exit 0 |

### Notes for SA on this increment

1. **F12 reverses a prior SA decision (Q1 / CR3)** by design and on user approval; the amended header comment is the
   record. `no-secret-egress.test.ts`'s label for that route was updated for the same reason.
2. **The IDOR class is now closed across all three prompt routes** (F4 + F13). Grepping
   `getUserActionablePlugins` shows no remaining caller that takes a client-supplied id.
3. **`console.*` untouched in all four legacy route files** (51 in `analyze-prompt-clarity`, plus those in
   `enhance-prompt` / `generate-clarification-questions`), per the standing scope instruction. SA's point stands that
   the `analyze-prompt-clarity` deferral has now been re-used twice and should be re-confirmed rather than assumed.
4. **Six trailing-whitespace-only lines** appear in the two F13 destructure blocks (the edit dropped pre-existing
   trailing spaces). Cosmetic, no semantic content.

---

## Dev Response — QA-1 rebase, F8 dropped (2026-09-21)

_Appended by Dev after QA's report. QA's and SA's text are unchanged._

### QA-1 — resolved by dropping F8 and rebasing

QA is right on all three counts. **F8 is removed from this branch entirely** — `main` owns that file now and we do not
fight it. The branch no longer touches `eslint.config.js`, `eslint.config.mjs` or `package.json`, so the merge-conflict
risk in QA-1(a) is gone, and with it any chance of clobbering main's warn-downgrade.

**Rebase performed** (work was uncommitted, so: back up → `git reset --hard origin/main` → reapply):

| Step | Result |
|---|---|
| Base moved | `e08091da` → **`9aeeb50e`** (`Merge pull request #78 from AgentsPilot/fix/react-hooks-violations`) |
| Did `main` touch any file this branch changes? | **No.** `git diff --stat e08091da origin/main -- <the 12 security files>` is empty. Main's 31 changed files are CI/workflows, eslint configs, feature flags, admin-authz, React-hooks fixes and docs |
| Conflicts resolved | **None — zero.** The only overlap was F8's three files, and those were dropped rather than merged |
| Did every security change survive? | **Verified mechanically.** Pre- and post-rebase `git diff` were split per file and compared (ignoring blob-hash `index` lines): 15 file-diffs before → 12 after; dropped = exactly `eslint.config.js`, `eslint.config.mjs`, `package.json`; added = none; **the 12 security file-diffs are byte-identical**. The 5 untracked paths (4 new test files + this workplan) survived `reset --hard` and were diffed against the backup — identical |
| Anything from main clobbered? | **No.** `git status` shows only the 12 intended modifications plus the 5 untracked paths |

The only caller of a touched route that main changed is `components/agent-creation/useConversationalBuilder.ts`
(4 lines, a React-hooks fix from PR #78). It is a *caller*, not a route, and main's version is untouched here.

### Answer to the question asked: does `npm run lint` work on current `main`?

**No — still broken, in a different way than F8 described.** On `9aeeb50e`, `package.json` still has
`"lint": "next lint"`, and `next lint` (Next 14) does not read flat config, so:

```
$ npm run lint  </dev/null
> next lint
? How would you like to configure ESLint?  ❯ Strict (recommended) / Base / Cancel
```

It drops into the **interactive setup prompt** and lints nothing. PR #76 fixed the *config* half of F8 (deleted the
shadowing `eslint.config.js`, downgraded the three backlog rules to `warn`) but not the *script* half — nothing points
`npm run lint` at the working flat config. ESLint does run in CI, but only via `npm run lint:hooks`, which bypasses the
main config entirely (`--no-config-lookup --config eslint.hooks.config.mjs`).

So the surviving, genuinely-new part of F8 is one line — `"lint": "eslint ."` — plus optionally the `ignores` block
(without it, `eslint .` also walks `.next/` and `.claude/worktrees/`). **Not fixed here, as instructed.** Recommended
as its own small follow-up (**F15**), where the error count should be re-measured under main's warn-downgrades: the
"9,992 errors" figure in the Items table and in SA's notes was measured against this branch's *old* config and is now
obsolete, exactly as QA-1(b) says.

### QA-2 — fixed (it met the 1–2-line bar)

The F11 no-store rule now applies to the two newly-gated GETs, so all four registry routes share one rule. One line
per route plus the existing 401 tests extended — no new constant, no refactor:

| File | Change |
|---|---|
| `app/api/plugins/execute/route.ts` | 401 now carries `Cache-Control: private, no-store` + `Vary: Cookie` |
| `app/api/plugins/action-schema/route.ts` | same |
| `app/api/plugins/__tests__/identity-hardening.test.ts` | 2 assertions added to the existing `refuses an unauthenticated request…` test |
| `app/api/plugins/action-schema/__tests__/route.test.ts` | 2 assertions added to the existing 401 test |

### QA-3 — NOT fixed, deliberately

QA sizes it at ~10 lines (a new `NODE_ENV=production` case in
`app/api/analyze-prompt-clarity/__tests__/auth.test.ts`, copied from the two sibling suites). That is past the
"1–2 lines with an existing test to extend" bar I was given, and it adds a new test case rather than extending one, so
it stays open. It is a real gap — F4's `isDevEnv ? … : undefined` guard is currently locked by review only.
Recommended for the same follow-up as F14/F15.

QA-4 (six trailing-whitespace lines) — confirmed cosmetic, unchanged.

### Fresh verification on base `9aeeb50e`

The e08091da baseline is discarded; everything below was re-measured after the rebase.

| Check | Result |
|---|---|
| Affected suites | `npx jest app/api/plugins app/api/llm/context app/api/analyze-prompt-clarity app/api/enhance-prompt app/api/generate-clarification-questions lib/plugins/__tests__` → **12 suites, 124 tests, all green** |
| **Fresh** `npm test` baseline on `main` @ `9aeeb50e` | 21 failed / 8 skipped / **351 passed** suites; 129 failed / 58 skipped / **5,527 passed** tests |
| `npm test` on the rebased branch | 21 failed / 8 skipped / **355 passed** suites; 129 failed / 58 skipped / **5,548 passed** tests |
| Failing-suite set vs the fresh baseline | **IDENTICAL** (diffed name-by-name). Δ = **+4 suites, +21 tests, all new and passing** |
| `tsc --noEmit` | branch **2,031** vs `main` **2,035** — the branch is lower only because the worktree's stale `.next/types` was cleared first; **zero errors in any touched file**. Needs `--max-old-space-size=8192` on both |
| `eslint` on changed files, **using main's config** | **3 errors, 26 warnings — all on pre-existing lines, none on a line this branch adds.** The errors are `prefer-const` (`analyze-prompt-clarity:208,333`, `enhance-prompt:320`); the warnings are the backlog rules main downgraded. Both new test files are clean |
| `npm run lint:hooks` (what CI actually runs) on every touched directory | **exit 0, clean** — this branch cannot redden `react-hooks-guard.yml` |
| `next build` | ✓ Compiled successfully, exit 0 |

### Net change set after the rebase

6 security items — F4, F9 (+CR1), F10, F11, F12, F13 — plus the QA-2 fix: **12 modified files + 4 new test files**
(+ this workplan). No config files, no `package.json`, no CI files. P1–P7 remain pending a signed-in session.

---

## SA Review Notes — Second Pass (CR1 / F12 / F13)

**Code Review by SA — 2026-09-21 (delta only; F4/F8/F9/F10/F11 were approved in the first pass)**
**Status:** ✅ **Code Approved — no required fixes.**
**Final verdict for the whole branch: ✅ APPROVED FOR QA (all eight items).**

Scope re-checked before reviewing content: the per-file diffstat of every first-pass file is **byte-for-byte the
same** as at my first review (18 / 15 / 15 / 46 / 15 / 15 / 14 / 6 / 5 / 2). The only additions are `enhance-prompt`
(19), `generate-clarification-questions` (29), `action-schema` (26) + its test (27), the one-line label fix in
`no-secret-egress.test.ts`, the comment-only CR1 block, and two new `__tests__` directories. **Nothing beyond
CR1 / F12 / F13 changed.**

### Verification

| Question | Method | Result |
|---|---|---|
| Do the F13 tests actually gate the 401, or would they pass without it? | **Mutation test**: backed the three routes up, deleted the `if (!user) …401` block from each (keeping the `getUser()` call so the file still compiled), re-ran, restored from backup and confirmed the diffstat returned to 19/29/26 | ✅ **5 tests failed exactly where they should** — both `401s…` cases in each F13 suite and the F12 `401 when signed out` case. The guards are load-bearing, not decorative |
| Any caller-supplied identity path left into `getUserActionablePlugins`? | Grepped every call site repo-wide | ✅ **none.** All three (`analyze-prompt-clarity:340`, `enhance-prompt:104`, `generate-clarification-questions:169`) now pass `userIdToUse`, which is `user.id` in each file. The class F4 opened is closed |
| Do the F13 catch blocks leak internal error text? | Read both | ✅ confirmed — each returns a flat `{ error: 'Internal server error' }`, no `details` / `message` / `stack`. Dev's claim is correct and no `NODE_ENV` guard was needed |
| Is the `else if (userId)` → `else` change safe? | Traced the live hook | ✅ **correct, and inert for the live flow** — see below |
| CR1 wording | Read the header | ✅ names all three shapes I proved, including that shape 3 is the original P0 leak's own source form, and states a pass means "no known-bad shape found, NOT no leak possible" with the F14 pointer. Exactly the ask |
| F12 callers | Re-verified all three | ✅ `app/test-business-os/page.tsx:215`, `components/test-plugins/tester/FormTester.tsx:42` (via `PluginAPIClient.getActionSchema`, `:251`) and the wrapper itself — all same-origin `fetch` (cookies sent by default) from session-backed internal test surfaces. `getActionSchema` throws on `success:false` and `FormTester` catches at `:133`, so a logged-out load degrades rather than crashes |
| Dead-code claims | Re-verified | ✅ `components/AgentWizard.tsx` has **zero importers**, so the three wizard callers of these routes are unreachable — consistent with the previous cycle's finding |
| Suites | `npx jest app/api/plugins app/api/llm/context app/api/analyze-prompt-clarity app/api/enhance-prompt app/api/generate-clarification-questions lib/plugins/__tests__` | ✅ **12 suites, 124 tests, all green** (117 before + the 7 new) |

**On the `generate-clarification-questions` branch change.** Ruling: keep it as Dev wrote it. Before, the plugin
lookup ran only when the caller supplied an id — and that id was whatever the caller claimed, which *is* the bug.
With identity server-derived there is no "no id" case, so `else` is the honest shape; guarding it on a value that can
no longer be absent would be dead logic. Live impact is nil: `useConversationalBuilder` reaches this route with
`analysis` populated from step 1, so the first branch (`analysis.requiredServices`) wins; and in the rare fall-through
the old code also ran the lookup, because the hook always sent `userId`. The only new cost is one extra manager call
in the previously-skipped "no id at all" case, which now returns the session user's own plugins — strictly more
correct. The response's `userId` echo and the `clarification_analytics` row now carry the session id rather than a
claimed one, which is also an improvement.

### New findings outside this branch (record, do not fix here)

Found while auditing the identity flow. Both are pre-existing on `main` and neither is caused by this branch.

| # | Finding | Severity |
|---|---|---|
| **F15** | `app/api/help-bot-v2/route.ts` — **no `getUser()` anywhere**, a module-level `createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)` (`:15-18`, so RLS is bypassed), and `:697` takes `x-user-id` straight from the header into `searchAgents(query, userId)` → `.from('agents').eq('user_id', userId).ilike('agent_name', …)` (`:85-87`). An anonymous caller who knows or guesses a user id can enumerate that user's **agent names**. Same class as the IDOR just fixed, but it reads real user data rather than plugin keys, and it does so through the service role | **High — recommend fixing next** |
| **F16** | `app/api/analyze-workflow/route.ts:40` — the same `userId \|\| x-user-id \|\| 'anonymous'` pattern, but the value is only used for AI-analytics attribution (`:72`); no user-scoped read. Spoofable attribution, not a disclosure | Low |

**Architectural recommendation for TL:** stop fixing this one route at a time. Four routes have now been hardened
across two cycles and the grep still finds more. Commission a single **legacy `x-user-id` sweep**: enumerate every
`app/api/**` route that derives identity from a body field or header, classify each as (a) user-scoped read/write →
must gate, (b) attribution only → replace with the session id, (c) genuinely public → document; then add a guard test
in the shape of `admin-authz-surface.guard.test.ts` so the next one cannot land. The guard is what makes it stick.

### Decision for TL — the `console.*` deferral in the legacy prompt routes

**Ruling: it becomes its own ticket (F17). It does not stay deferred indefinitely.**

The deferral was correct both times — converting logging inside a P0 security branch enlarges the review surface for
no security gain, and the user approved it on exactly that basis. But "deferred again" twice in two cycles is how a
mandatory standard (CLAUDE.md § Mandatory Rules #3) quietly becomes a permanent exception, and these files are
demonstrably hot: they have been edited in both cycles and will be edited again for F17's own sake.

Measured scope, so TL can size it honestly:

| File | `console.*` |
|---|---|
| `app/api/analyze-prompt-clarity/route.ts` | 51 |
| `app/api/enhance-prompt/route.ts` | 23 |
| `app/api/generate-clarification-questions/route.ts` | 22 |
| `app/api/analyze-workflow/route.ts` | 12 |
| **Total** | **108** |

Three conditions on the ticket:

1. **Its own branch, no behaviour change** — pure logging conversion, so the diff is reviewable at a glance and a
   regression is bisectable. Pair it with F16, which touches the same fourth file.
2. **Treat it as a log-hygiene pass, not a find-and-replace.** These routes log prompt text and AI payloads
   (`generate-clarification-questions:184,186` log the full system and user prompts, dev-gated; others are not gated).
   Conversion is the moment to decide what is `debug` vs `info` and what must never be logged at all — that is the
   real value, and it is why a mechanical sed would waste the opportunity.
3. **Until it ships, the deferral is re-confirmed by the user each time one of these files is touched** — which is
   what CLAUDE.md § Logging already requires, and what happened correctly in both cycles.

### Notes for QA — additions for this increment

1. **F13 is the highest-value manual check in the branch.** Run the full signed-in agent-creation flow end to end
   (prompt → clarity → clarification questions → enhanced prompt) and confirm the connected-plugin list and the
   generated questions are **unchanged**. All three routes now derive identity from the session, and the hook already
   sent its own id, so any difference is a bug.
2. Signed **out**, `curl -X POST` each of `/api/analyze-prompt-clarity`, `/api/enhance-prompt`,
   `/api/generate-clarification-questions` with `{"userId":"<some other id>"}` and an `x-user-id` header → all three
   must be 401 with no body beyond `{success:false,error:'Unauthorized'}`.
3. **F12:** `curl /api/plugins/action-schema?plugin=google-mail` with no cookie → 401; with a cookie → the schema.
   Then load `/test-plugins-v2` → Form Tester and `/test-business-os` → Modules **signed in** and confirm action
   schemas still populate; **signed out**, confirm both degrade to a visible error rather than an empty form.
4. The `/test-plugins-v2` AI-service templates for all three prompt routes still show `userId: "test_user_123"`,
   which is now inert. Expected; cosmetic only.

### For the user — additions

1. **`/api/help-bot-v2` (F15) is a live, unauthenticated, service-role read of any user's agent names.** It is not
   caused by this work and is not fixed by it. Of everything outstanding, this is the one I would schedule next.
2. The identity-hardening work is now 4 routes deep with more remaining — the sweep-plus-guard recommendation above is
   the way to finish it rather than discovering the next one by accident.
3. **The logging deferral now has a ticket (F17, 108 `console.*` across four files)** rather than an open-ended
   promise. Nothing blocks on it.

### Code Approved for QA: **Yes — whole branch, no conditions**

---

## QA Testing Report

**QA — 2026-09-21**
**Test mode:** full
**Strategy used:** C (live test script against the running dev server on `:3005`) + B (Jest integration/unit suites) + A (source-level guard) + E (code reading where `NODE_ENV` made a live check inconclusive). Chosen because five of the seven items are HTTP-surface auth/header changes that are only honestly verified over the wire, while F4/F13's production error shape cannot be observed on a dev server and had to be read.
**Focus:** security, api
**Skipped:** E2E/Playwright — not installed in this repo (CLAUDE.md § Testing). The two UI surfaces were assessed by reading their error-handling paths instead, and the signed-in journeys are listed as PENDING.
**Input source:** prompt keywords (explicit 8-task QA brief) + SA's "Notes for QA" in both review passes.

**Environment:** worktree `neuronforge-followups`, branch `fix/security-followups` (base `origin/main` e08091da), uncommitted. Dev server already running on `http://localhost:3005`, `NODE_ENV=development`. Nothing staged or committed; `git status --porcelain` and `git diff --stat` were captured before and after testing and are **byte-identical** at the end.

---

### Test Coverage

| # | Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|---|
| **F4** | `POST /api/analyze-prompt-clarity` 401s without a session | ✅ live | **Pass** | 401, body exactly `{"success":false,"error":"Unauthorized"}` |
| **F4** | Client-supplied identity is ignored | ✅ live + unit | **Pass** | Still 401 with `{"userId":"<victim>"}` **and** `x-user-id: <victim>`. No `x-user-id` / `'anonymous'` read survives (only comments) |
| **F4** | Error `details` dev-guarded at both 500 sites | ✅ code | **Pass** | See "F4/F13 error details" below — the guard is on the right fields |
| **F13** | `POST /api/enhance-prompt` 401s, identity server-derived | ✅ live + unit | **Pass** | 401 plain and with spoofed id + header |
| **F13** | `POST /api/generate-clarification-questions` — same | ✅ live + unit | **Pass** | 401 plain and with spoofed id + header |
| **F13** | No internal error text in either catch block | ✅ code | **Pass** | Flat `{ error: 'Internal server error' }`; zero `details` / `stack` / `.message` in any response body in either file |
| **F12** | `GET /api/plugins/action-schema` 401s, registry never read | ✅ live + unit | **Pass** | 401 for `?plugin=google-mail` and `?plugin=google-drive`; unit test asserts `getPluginDefinition` / `getActionDefinition` are never called |
| **F10** | `GET /api/plugins/execute` 401s in both forms | ✅ live + unit | **Pass** | Catalogue form and `?plugin=google-mail` form both 401; registry-never-read asserted |
| **F11** | `no-store` + `Vary: Cookie` on the **401** of `available` + `llm/context` | ✅ live | **Pass** | `cache-control: private, no-store` and `vary: Cookie` present on both |
| **F11** | Same on the **400** of both | ⚠️ test-only | **Pass (covered)** | Unreachable cookie-less — auth precedes Zod, so a bad query returns 401. Covered by the new `marks the error responses private too` case in both suites |
| **F11** | Same still on the **200** | ⚠️ test-only | **Pass (covered)** | Needs a session; pre-existing 200-header assertions still green, and both routes now share one `NO_STORE_HEADERS` constant |
| **F9** | Source-level egress guard is real and can fail | ✅ live negative control | **Pass** | A synthetic offending route under `app/api/` turned it red with an actionable message |
| **CR1** | Blind spots documented in the guard header | ✅ code | **Pass** | All three SA-proved shapes named, including "would NOT have caught the bug it memorialises", plus the F14 pointer |
| **F8** | `npm run lint` actually runs | ✅ live | **Pass** | Exits **1**, `10239 problems (9992 errors, 247 warnings)` — exactly Dev's figure |
| **F8** | `npm run build` still exits 0 | ✅ live | **Pass** | `BUILD_EXIT=0` |
| **F8** | No CI workflow invokes lint | ⚠️ live, **stale base** | **Partial** | True on this branch's base. **Not true on current `origin/main`** — see Bug QA-1 |
| **Reg.** | `npm test` failure set matches the main baseline | ✅ live | **Pass** | 21 failed / 129 failed tests — identical counts to Dev's e08091da baseline; none of the 21 is a file this branch touches |
| **Reg.** | The 21 new tests pass | ✅ live | **Pass** | Counted and confirmed, 21 exactly (breakdown below) |
| **Neg.** | The new 401s are load-bearing | ✅ mutation test | **Pass** | 2 suites reddened and restored byte-identically |
| **Obs.** | Signed-out `/test-plugins-v2` + `/test-business-os` degrade visibly | ✅ code | **Partial** | One silent-empty-state path — Observation 3 |
| **—** | Signed-in happy paths (all five routes + the agent-creation flow) | ❌ | **PENDING** | No session available to QA — see Pending |

---

### Live evidence — cookie-less probes on `:3005`

Ten requests, two per gated route: one bare, one carrying a victim id **both** in the body and as `x-user-id: a1b2c3d4-0000-4000-8000-000000000001`. **All ten returned `401 Unauthorized` with the body `{"success":false,"error":"Unauthorized"}` and nothing else** — no plugin keys, no action names, no schema, no `connectedPlugins`.

| Request | Status | Body |
|---|---|---|
| `POST /api/analyze-prompt-clarity` (bare) | 401 | `{"success":false,"error":"Unauthorized"}` |
| `POST /api/analyze-prompt-clarity` + victim id + `x-user-id` | 401 | same |
| `POST /api/enhance-prompt` (bare) | 401 | same |
| `POST /api/enhance-prompt` + victim id + `x-user-id` | 401 | same |
| `POST /api/generate-clarification-questions` (bare) | 401 | same |
| `POST /api/generate-clarification-questions` + victim id + `x-user-id` | 401 | same |
| `GET /api/plugins/execute` (catalogue) | 401 | same |
| `GET /api/plugins/execute?plugin=google-mail&userId=<victim>` + `x-user-id` | 401 | same |
| `GET /api/plugins/action-schema?plugin=google-mail` | 401 | same |
| `GET /api/plugins/action-schema?plugin=google-drive&userId=<victim>` + `x-user-id` | 401 | same |

Independently confirmed the spoofing surface is genuinely gone rather than merely unreachable:

- `grep` for `x-user-id` / `'anonymous'` / `body.userId` in the three prompt routes returns **comments only**.
- All three now assign `const userIdToUse = user.id` (`analyze-prompt-clarity:297`, `enhance-prompt:65`, `generate-clarification-questions:123`).
- Every `getUserActionablePlugins(` call site repo-wide (`:340`, `:104`, `:169`) passes `userIdToUse`. No caller-supplied id reaches it.
- `getUser()` (`lib/auth.ts:4-34`) resolves identity from the **cookie store** via `supabase.auth.getUser()`, i.e. server-validated against Supabase Auth — it is not a header read and not an unverified JWT decode. The whole branch's gate rests on this, so it was checked explicitly.

### F11 header evidence

```
GET /api/plugins/available          |  GET /api/llm/context
HTTP/1.1 401 Unauthorized           |  HTTP/1.1 401 Unauthorized
vary: RSC, Next-Router-State-Tree…  |  vary: RSC, Next-Router-State-Tree…
vary: Cookie                        |  vary: Cookie
cache-control: private, no-store    |  cache-control: private, no-store
```

`Vary` arrives as two header lines (Next's own RSC vary plus the route's `Cookie`); per RFC 9110 repeated field lines are equivalent to the comma-joined form, so the directive is correctly in effect. The 400 path is genuinely unreachable without a session — auth runs before the Zod parse, so `?includeBusinessOs=bogus` cookie-less returns **401**, confirmed live — and is therefore test-covered rather than wire-covered, which is the right coverage for it.

### F4 / F13 error details — what production would return

`NODE_ENV=development` locally, so the dev-guarded fields do appear here; the verdict below is from reading the code.

`isDevEnv` is declared at `analyze-prompt-clarity:241`, in the first statement region of `POST`, which is before **both** guarded sites (`:452`, `:591`) — in scope at both. (The second declaration at `:204` is a local inside `parseAIResponse` and is unrelated.)

**Fields that would appear in a production response body:**

| Site | Production body | Leaks internals? |
|---|---|---|
| `analyze-prompt-clarity:449` (500, Claude fetch failed) | `error: 'Claude API connection failed'` (static) + the fallback analysis + `connectedPlugins` + `connectedPluginsMetaData` (projected via `toShortLLMContext()`) + `sessionId` + `agentId` + optional `pluginWarning`. **`details` is absent** — `undefined` is dropped by `JSON.stringify` | No |
| `analyze-prompt-clarity:485` (500, empty AI response) | `error: 'Empty AI response'` + the same projected fallback. Never carried `details` | No |
| `analyze-prompt-clarity:588` (500, unexpected) | `error: 'Unexpected server error'` + fallback + `connectedPluginData: []`. **Both `details` and `stack` absent** | No |
| `enhance-prompt:489` (500) | `{ error: 'Internal server error' }` — flat | No |
| `generate-clarification-questions:280` (500) | `{ error: 'Internal server error' }` — flat | No |

The guard is on the right fields: `details` carried `fetchError.message` / `error.message` and `stack` carried `error.stack`, and those are the only two internal-text fields in either body. The `logError()` helper at `:30-35` does write `message` + `stack`, but to the **server console only** — it never reaches a response. Grepping `details:` / `stack:` / `.message` / `.stack` across all three routes finds no other response-body occurrence. The `connectedPlugins*` fields on the 500s are the **session user's own** plugins post-F4, projected, so they are not a disclosure.

### Regression — `npm test` (`MSYS_NO_PATHCONV=1`)

```
Test Suites: 21 failed, 8 skipped, 355 passed, 376 of 384 total
Tests:       129 failed, 58 skipped, 5527 passed, 5714 total
```

Identical to Dev's stated `main` e08091da baseline (21 / 129 failing; 355 vs 351 passing suites and 5527 vs 5506 passing tests, i.e. **+4 suites / +21 tests, all new**).

I did not re-run the baseline on `main` myself — the QA constraints forbid touching `...\neuronforge` or the other worktrees — so instead I enumerated the 21 failing suites and confirmed **none is a file this branch touches, and none is under `app/api/` at all**: 6 × `__tests__/DeclarativeCompiler-*` + `v6-integration`, `lib/agentkit/v4`, `lib/agentkit/v6/**` (4), `lib/orchestration/**` (2), `lib/pilot/**` (5), `lib/utils/featureFlags`, `lib/website-builder/archetypes`. All pre-existing V6 / pilot / orchestration debt.

**The 21 new tests, counted:**

| Suite | New tests |
|---|---|
| `app/api/analyze-prompt-clarity/__tests__/auth.test.ts` (new) | 3 |
| `app/api/enhance-prompt/__tests__/auth.test.ts` (new) | 3 |
| `app/api/generate-clarification-questions/__tests__/auth.test.ts` (new) | 3 |
| `app/api/plugins/__tests__/plugin-definition-egress.guard.test.ts` (new) | 6 |
| `identity-hardening.test.ts` — `GET /api/plugins/execute (catalogue)` | 3 |
| `action-schema/__tests__/route.test.ts` — 401 when signed out | 1 |
| `available/__tests__/route.test.ts` — error responses private | 1 |
| `llm/context/__tests__/route.test.ts` — error responses private | 1 |
| **Total** | **21** |

All touched suites green together: `npx jest app/api/plugins app/api/llm/context app/api/analyze-prompt-clarity app/api/enhance-prompt app/api/generate-clarification-questions lib/plugins/__tests__` → **12 suites, 124 tests, all passed**.

### Negative controls

SA mutation-tested the three F12/F13 guards in its second pass. I deliberately chose the **two it did not** — F4 and F10 — so coverage is now complete across all five gated routes, plus an end-to-end control for F9 that its embedded self-test does not provide.

| Control | Method | Result |
|---|---|---|
| **F4** `analyze-prompt-clarity` | Deleted the `if (!user) …401` block, kept `getUser()` | ✅ **red** — both `401s…` tests failed (`Expected: 401, Received: 500`) |
| **F10** `GET /api/plugins/execute` | Same | ✅ **red** — exactly `refuses an unauthenticated request and never reads the registry` and `refuses the per-plugin form unauthenticated too`. No unrelated test moved |
| **F9** guard, end-to-end | Created a throwaway `app/api/__qa_negative_control__/route.ts` doing `NextResponse.json({ success: true, plugin: definition })` | ✅ **red** — reported `app/api/__qa_negative_control__/route.ts:4 serialises definition unprojected`. This proves the corpus scan is wired to real files, which the in-suite `can actually fail` test (synthetic strings only) does not |

**Restoration verified.** Both routes restored from byte-level backups; `git diff --stat` and `git status --porcelain` diffed against the captures taken before the mutation → **IDENTICAL** on both. The throwaway route directory was deleted and leaves no residue in `git status`. Both mutated suites re-run green afterwards (12 suites / 124 tests). Nothing staged, nothing committed. The dev server on `:3005` was re-probed after the build and still serves correctly.

### F8 evidence

| Check | Result |
|---|---|
| `npm run lint` runs | ✅ `✖ 10239 problems (9992 errors, 247 warnings)`, **exit 1** |
| `npm run build` exit 0 | ✅ `BUILD_EXIT=0`, full route table emitted |
| CI invokes lint (**this branch's base**) | ✅ none — 4 workflows, only a comment in `build.yml` mentions eslint |
| CI invokes lint (**current `origin/main`**) | ❌ **`react-hooks-guard.yml:124` runs `npm run lint:hooks`** — see Bug QA-1 |

---

### Issues Found

#### Bugs (must fix before commit)

1. **QA-1 — F8 has already been done on `main`, and the branch base predates it** — Files: `eslint.config.mjs`, `package.json`, `eslint.config.js` — Severity: **Medium** (correctness of the merge, not of the security fixes)
   - The branch is cut from `e08091da`. `origin/main` is now at `9aeeb50e` and **PR #76 (2026-09-20) already deleted `eslint.config.js`** for exactly the reason F8 gives, already rewrote `eslint.config.mjs`, and already added `eslint.hooks.config.mjs` + `.github/workflows/react-hooks-guard.yml`.
   - Steps to reproduce: `git cat-file -e origin/main:eslint.config.js` → absent. `git show origin/main:eslint.config.mjs` → carries the comment *"It was deleted on 2026-09-20 — do not reintroduce it"* plus a `rules` block downgrading `no-explicit-any`, `no-unused-vars` and `no-unescaped-entities` to `warn`. `git grep -n "npm run lint" origin/main -- .github/workflows/` → `react-hooks-guard.yml:124`.
   - Expected: F8 rebased onto current `main` so it contributes only what is genuinely new — the `ignores` block and `"lint": "eslint ."` (main still has `"lint": "next lint"`).
   - Actual: three concrete consequences.
     - **(a) `eslint.config.mjs` is edited by both sides in adjacent regions.** The branch inserts an `ignores` object immediately after `const eslintConfig = [`; main inserts a comment block immediately before that same line and a `rules` object immediately after `...compat.extends(...)`. Merge-conflict risk is high, and a careless resolution silently drops **main's warn-downgrade**, which would turn ~9,750 findings back into hard errors.
     - **(b) The workplan's headline number is stale.** The 9,992 errors I reproduced are against *this branch's* config. Under main's config the great majority (7,598 `no-explicit-any`, plus unused-vars and unescaped-entities) are warnings, so post-merge `npm run lint` will report a very different, much smaller error count. The "9,992 errors" framing in the Items table and in SA's Note 5 / For-the-user item 4 should be re-measured after rebase.
     - **(c) SA's "no workflow runs `npm run lint`" check was run against the stale `.github/` in this worktree.** On current main a workflow *does* run ESLint (`lint:hooks`). It is insulated — `--no-config-lookup --config eslint.hooks.config.mjs` means it never reads `eslint.config.mjs`, so the `ignores` block cannot redden it — but the premise must be re-stated correctly rather than left as written, or the next person will rely on a false invariant.
   - Not a security defect, and it does not block the other six items. It does mean **F8 must not be merged as-is without a rebase and a re-measure.**

#### Performance Issues (should fix)

_None found._ The added work per request is a single `getUser()` call placed **before** the body parse, the Zod parse and every registry read — strictly less work on the rejection path than before. The F11 change replaced two inline header literals with one shared constant; no runtime cost.

#### Edge Cases (nice to fix)

1. **QA-2 — the F11 cache invariant is not applied to the two newly-gated GETs** — Files: `app/api/plugins/execute/route.ts`, `app/api/plugins/action-schema/route.ts` — Severity: Low
   - Measured live: the 401s of `plugins/execute` and `plugins/action-schema` carry **no** `Cache-Control` and no `Vary: Cookie`, while `available` and `llm/context` now do.
   - This is faithful to F11's stated scope (it named only two routes), so it is not a delivered-item failure. But F10/F12 have just made those two responses session-dependent, which is precisely the condition that motivated F11 — a shared cache could store a 401 and replay it to a signed-in caller. The impact is degradation, not disclosure, since the cacheable artefact is the *denial*.
   - Suggest folding the same `NO_STORE_HEADERS` constant into both in a follow-up, so the four sibling registry routes share one rule.
2. **QA-3 — F4's dev-guard has no production-500 test** — File: `app/api/analyze-prompt-clarity/__tests__/auth.test.ts` — Severity: Low
   - `available` and `llm/context` each carry a `does not leak internals in a production 500 body` test that flips `NODE_ENV` and asserts the body. `analyze-prompt-clarity` does not, so F4's `isDevEnv ? … : undefined` guard is currently locked by code review only. A future edit could drop the ternary and every test would stay green.
   - The pattern to copy already exists in both sibling suites; roughly 10 lines.
3. **QA-4 — six trailing-whitespace-only lines** in the two F13 destructure blocks, as Dev self-reported. Cosmetic, confirmed present, no action needed.

---

### Observations — the behaviour changes I was asked to judge, not fix

1. **`/test-plugins-v2` → AI-service panel (all three prompt routes): clear error. Good.**
   `executeAIService` (`app/test-plugins-v2/page.tsx:1420-1468`) checks `response.ok`, and on a 401 calls `addDebugLog('error', 'AI service failed: Unauthorized')` **and** `setAiServiceResponse(result)`, so the raw `{"success":false,"error":"Unauthorized"}` is rendered in the response panel. The user cannot mistake it for success. The inert `userId: "test_user_123"` in the templates is cosmetic as SA said — note it is still forwarded as the `x-user-id` header at `:1447`, which is now ignored server-side; harmless, but it is the last thing that makes the panel *look* identity-bearing.
2. **`/test-plugins-v2` → Form Tester (F12): clear error. Good.**
   `PluginAPIClient.getActionSchema` (`lib/client/plugin-api-client.ts:256-264`) throws on `success:false`; `FormTester` catches it into `loadError` (`:129-133`) and renders it in red at `:329`. A logged-out schema load shows a visible message, not an empty form.
3. **`/test-business-os` → Modules tab (F12): partially silent — the one soft spot.** Severity: Low.
   `getModuleActionSchema` (`app/test-business-os/page.tsx:212-221`) does `return { actions: data?.actions || [] }`. `callApi` returns the parsed 401 body rather than throwing, so the `|| []` swallows it and the action selector renders **empty with no inline error**. The failure *is* surfaced — `callApi` writes `Schema: <plugin> → Unauthorized` to the debug log and puts the 401 in the Last Response panel — so it is not wholly silent, but the Modules panel itself shows an empty state that reads like "this module has no actions".
   Mitigating: the Modules tab only loads when `user` is truthy (`page.tsx:207`), so a fully signed-out visitor never reaches this. The real exposure is a session that expires mid-session. Reported as an observation per the brief; the one-line fix (surface the error the way `FormTester` does) belongs in a follow-up, not here.

---

### Pending — needs a real signed-in session (QA has none)

Everything below is blocked on the user, not on Dev. None of it is expected to fail — in every case the live caller already sent its own session id, so the value used is unchanged — but none of it has been observed.

| # | Check | Why it matters |
|---|---|---|
| P1 | **The full signed-in agent-creation flow**: prompt → clarity analysis → clarification questions → enhanced prompt. Confirm the connected-plugin list and generated questions are **identical** to before | SA's highest-value manual check. All three routes now derive identity from the session; any difference is a bug |
| P2 | `GET /api/plugins/execute` and `?plugin=google-mail` **with** a cookie → 200 catalogue | F10's happy path |
| P3 | `GET /api/plugins/action-schema?plugin=google-mail` **with** a cookie → 200 schema | F12's happy path |
| P4 | `POST /api/plugins/execute` still executes — run one operation from `/test-business-os` → Modules | F10 touched only `GET`; confirms no collateral damage |
| P5 | `curl -i` the **200** of `available` and `llm/context` signed in → `private, no-store` + `Vary: Cookie` | F11's 200 path (test-covered, not wire-observed) |
| P6 | `/test-business-os` → Modules and `/test-plugins-v2` → Form Tester **signed in** → action schemas still populate | F12's three live callers |
| P7 | `settings/connections` still lists plugins | Regression watch carried over from the previous cycle |

---

### Final Status

- [x] **All seven security items (F4, F9, F10, F11, F12, F13 + CR1) pass — no High or Medium security defect found.** The cookie-less attack surface is closed on all five routes, verified over the wire with spoofed identity in body and header, and the guards are proven load-bearing by mutation.
- [ ] **F8 must be rebased onto current `origin/main` and re-measured before commit** (Bug QA-1). It is not a security item and it does not gate the other six.
- [ ] **P1–P7 pending a signed-in session.**

**Verdict: CONDITIONAL PASS.** Ship-ready on the security substance; hold the commit until QA-1 is resolved and the user (or QA with a session) clears at minimum P1–P4.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-21 | Created + SA code review | Five follow-ups (F4/F8/F9/F10/F11) from PR #73 reviewed; approved with CR1; F12/F13/F14 raised |
| 2026-09-21 | SA second pass | CR1/F12/F13 reviewed (401 guards mutation-tested); whole branch approved for QA; F15/F16 found outside scope; F17 opened for the 108 `console.*` in the four legacy prompt routes |
| 2026-09-21 | Dev response appended | CR1 applied (comment-only); F12 + F13 added to the branch on user approval — 7 items total. F14 remains out of scope |
| 2026-09-21 | QA-1 rebase | F8 dropped entirely (main owns the eslint config since PR #76); branch rebased onto `origin/main` 9aeeb50e with zero conflicts; QA-2 fixed; QA-3 deferred; F15 raised. 6 security items remain |
| 2026-09-21 | QA report appended | Live cookie-less probes on :3005 (10/10 401), F11 headers verified, full npm test vs baseline, 2 mutation controls + 1 end-to-end guard control, lint/build checked. Verdict CONDITIONAL PASS: 7 security items pass; F8 needs a rebase (QA-1); P1-P7 pending a session |
