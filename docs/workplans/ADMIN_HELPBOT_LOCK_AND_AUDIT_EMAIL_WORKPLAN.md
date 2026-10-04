# Workplan: HelpBot embedding-model lock + audit-row email fallback

> **Last Updated**: 2026-10-04

**Developer:** Dev
**Branch:** `fix/admin-helpbot-lock-audit-email` (from `origin/main` `5f10a926`)
**Requirement:** short path (small change); context in [ADMIN_BOS_CLEANUP_REQUIREMENT.md](/docs/requirements/ADMIN_BOS_CLEANUP_REQUIREMENT.md) §12 and [ADMIN_BOS_CLEANUP_SLICE_4_WORKPLAN.md](/docs/workplans/ADMIN_BOS_CLEANUP_SLICE_4_WORKPLAN.md) (Q-SA4-1, O-7)
**Date:** 2026-10-04
**Status:** Code Complete

## Overview

Two small admin fixes on one branch. **A** stops the hidden HelpBot config page from rewriting `helpbot_embedding_model`, a key Business OS chat depends on. **B** shows the row's sign-in email on `/admin/audit-trail` when the account has no profile name.

---

## User's request and decisions

| Item | Request | Decision |
|---|---|---|
| A | Lock HelpBot's embedding-model field. `PUT /api/admin/helpbot-config` wrote it on every save (the GET defaults it to `text-embedding-3-small`), so any save of the page could rewrite a key whose change invalidates every stored vector (BOS chat's `PlanCache` and `VerifiedQuestions`; `modelSettingsPolicy.ts:84-88`). | The PUT never writes the key. A body value that differs from the stored one is a 400 (logged). The same value, or no value, passes. The page shows the field read-only with one warning sentence and stops sending it. |
| B | Q-SA4-1, **user-approved**: an unnamed account's audit rows show the sign-in email. | Label order: name → row `user_email` → account id, on the row line and the expanded "User" tile. Not in the CSV. |

---

## Files

| File | Action | Reason |
|---|---|---|
| `app/api/admin/helpbot-config/route.ts` | modify | Key constant; drop the key from the write set; reject a changed value with 400 + Pino warn |
| `app/admin/helpbot-config/page.tsx` | modify | Read-only field + warning sentence; save body omits `semantic.embeddingModel` |
| `app/api/admin/helpbot-config/__tests__/embeddingLock.test.ts` | create | Behaviour tests (PUT) + source guard on the write set |
| `app/admin/helpbot-config/__tests__/embeddingReadOnly.render.test.tsx` | create | Page renders the field read-only; save body has no `embeddingModel` |
| `app/admin/audit-trail/page.tsx` | modify | `user_email` on the row type; one `auditUserLabel()` used by the row line and the User tile |
| `app/admin/audit-trail/__tests__/userEmailFallback.render.test.tsx` | create | Name / email / id / system-row cases |
| `docs/requirements/ADMIN_BOS_CLEANUP_REQUIREMENT.md` | modify | §12 line + Change History row |

---

## Task List

- ✅ 1. A-server: `HELPBOT_EMBEDDING_MODEL_KEY` constant (also used by the GET); remove from `updates`; if `config.semantic.embeddingModel` is present (not null/undefined) and differs from `SystemConfigService.getString(key, 'text-embedding-3-small')` (the same default `EmbeddingService` uses), `warn` and return 400 before any write. `requireAdmin` stays first.
- ✅ 2. A-page: replace the `<select>` with a read-only `Input` (labelled) and the warning sentence; `saveConfig` sends `semantic` without `embeddingModel`.
- ✅ 3. A-tests: route behaviour (no field → no write of the key; different → 400 + no write; same → 200 and key still not written); source guard; page render (read-only, save body).
- ✅ 4. B: `auditUserLabel(log)` = `users.full_name || user_email || users.email || user_id`, used in the row line and the User tile.
- ✅ 5. B-tests: named, unnamed-with-email, neither, system row.
- ✅ 6. Requirement §12 line + Change History row.
- ✅ 7. Verify: new tests fail on old code; wide suites; ESLint; `lint:hooks`; scoped tsc.

---

## Test plan

| ID | Test | Proves |
|---|---|---|
| H-1 | PUT without `embeddingModel` → 200; no `set` call for `helpbot_embedding_model` | A save no longer touches the key |
| H-2 | PUT with a different value → 400, clear message, warn logged, **no** `set` call at all | Change rejected, nothing written |
| H-3 | PUT with the stored value → 200; key still not written | Unchanged value passes |
| H-4 | PUT with a value when nothing is stored → compared with the reader default | The 400 matches what `EmbeddingService` actually uses |
| H-5 | Source guard: the route's `updates` literal and any `updates.`/`updates[` assignment never name the key | It cannot come back into the write set |
| P-1 | Page: Embedding Model input is `readOnly`, shows the stored value, warning sentence present; no `<select>` for it | Read-only UI |
| P-2 | Page: clicking Save sends a body whose `config.semantic` has no `embeddingModel` | Page no longer sends the field |
| E-1..E-4 | Audit page: named → name; unnamed + email → email (row + tile); neither → id; system row (no `user_id`) → no User line | B |

---

## Risks

| Risk | Mitigation |
|---|---|
| An old browser tab (pre-deploy page) still sends `embeddingModel`. | Sends the loaded value, which equals the stored one → passes; only a deliberate change is refused. |
| No row stored for the key: GET shows the default, comparison uses the same default. | H-4. |
| B puts sign-in emails on screen. | Admin-only page; `user_email` is already in every row of the route's response (`select('*')`) and searchable. The route is not changed, so nothing new leaves it. |
| Account chip (`accountFilterLabel`) still uses business → `users.email` → name, not `user_email`. | Out of the requested scope (row + tile only); noted for the user. |

---

## Draft PR body

```markdown
## Summary
- **HelpBot embedding model is locked.** `PUT /api/admin/helpbot-config` no longer writes `helpbot_embedding_model`. That key is shared with Business OS chat (plan cache, verified questions), and changing it invalidates every stored vector, so it is a data migration, not a setting. Before this, every save of the hidden HelpBot page rewrote it. A request that tries to change it now gets a 400 and nothing is written; the page shows the value read-only with a one-line warning.
- **Audit rows show the sign-in email when there is no name** (Q-SA4-1, user-approved). Label order: name → row `user_email` → account id, on the row line and the expanded User tile. The email was already in the route's response; the route is unchanged. Not added to the CSV.

## Tests
- New: route lock (no field / different / same / no stored row), source guard on the write set, page read-only render + save body, audit email fallback (4 cases).
- New tests fail on the old code.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

---

## Implementation Notes

- `users.email` stays in the label chain after `user_email`, as a legacy fixture shape: the route never sends it (slice 4 O-7), but three existing suites render `users: { email }` and assert it. Keeping it is the smallest change; removing it would mean editing those suites.
- The 400 check reads the stored value only when the body carries the field, so a normal save adds no read.
- `console.*`: 0 in all three touched source files (route, HelpBot page, audit page).
- Old-code proof: the three new suites run against `git show HEAD:` copies in the scratchpad: 10 of 14 fail (H-1..H-5, P-1, P-2, E-2); the 4 that pass on old code are regression pins (admin gate first, E-1, E-3, E-4). Same suites against the new code in the scratchpad: 14/14.
- Wide set (`app/admin`, `app/api/admin`, `lib/admin`, `lib/business-os/llm`): 127/128 suites, 3,204/3,208 tests; the one red suite, `business-os-invites/page.render`, took 74 s under load and passes 52/52 alone (load timeout, untouched area).
- Scoped tsc: 0 new errors. 13 pre-existing TS2322 in the HelpBot page (optional `prompts`/`welcomeMessages`/`theme` spreads, lines ~620-873) reproduce on the `HEAD` copy. ESLint: 0 errors; the 18 warnings are all on pre-existing lines. `lint:hooks` clean.

## SA Review Notes

### SA Code Review + QA (2026-10-04)

**Reviewed by SA (combined code review and QA pass, short path)**
**Status:** ✅ Code Approved. Follow-ups are recorded below. None blocks this PR.

#### Is the lock enforced on the server?

On the HelpBot route, yes. The PUT's write set no longer contains the key. A changed value gets a 400 before `setMultiple`, and `requireAdmin` still runs first. The comparison uses `SystemConfigService.getString(key, 'text-embedding-3-small')`, which is the same reader and default that `EmbeddingService.ts:111-115,168-172` uses. A non-string or empty value is also refused.

Platform-wide, no. The other writers of `helpbot_embedding_model`:

| # | Writer | Reachable by | Ruling |
|---|---|---|---|
| W-1 | `PUT /api/admin/system-config` (`app/api/admin/system-config/route.ts:200-275`): a generic key/value writer. It refuses only `bos_llm_area_*` (`isReservedKey`, :79). | An admin who sends a hand-written request. No UI sends this key: the route's only page caller, `app/admin/agentspilot-billing/page.tsx:289`, sends `payment_grace_period_days`. | **Record, do not block.** The path a user can reach (the page) is closed. Follow-up: extend that route's refusal to cover `helpbot_embedding_model`. The pattern is already there. It needs its own message and test. |
| W-2 | `supabase/SQL Scripts/20251115_semantic_search_config.sql:11`: a manual seed with `ON CONFLICT (key) DO UPDATE` (:116). | Only someone who re-runs the script by hand. | **Record.** A re-run resets the key to `text-embedding-3-small`. |
| none | `SystemConfigService.set*` callers: `CurrencyService.ts:285` writes a different key. No script under `scripts/` names the key. The memory-config route writes `memory_embedding_model`, a separate key. | none | n/a |

#### Findings

| # | Where | Finding | Severity |
|---|---|---|---|
| F-1 | `app/api/admin/system-config/route.ts:200` | W-1 above: the generic writer can still set the key. | Medium (recorded follow-up) |
| F-2 | `app/api/admin/helpbot-config/route.ts:125-128` | The 400 log is safe: it holds model names only and no PII. Suggestion: add `userId: gate.user.id`, as the system-config route does, and cap `requestedEmbeddingModel` at about 100 characters. It is a value the caller supplies. | Low (optimisation) |
| F-3 | `app/api/admin/helpbot-config/route.ts:9-12,107,205-207` | **Pre-existing debt, not introduced here:** the PUT has no Zod schema, the route builds its own service-role client (rule 1), and the 500 returns `error.message` without logging it. This approval does not cover these. They stay recorded debt on a hidden AgentsPilot page, and this PR only narrows what the route writes. | Medium (recorded) |
| F-4 | route.ts:60 vs :119 | The GET shows `value \|\| default`, while the 400 compares against `getString`. If the stored value were `''`, the two disagree. Only a stale tab that sends the field could notice. | Info |
| F-5 | `app/admin/audit-trail/page.tsx:168-175` | Deviation 1: the account chip does not use `user_email`. **Ruling: leave it, and record it.** The user scoped the change to the row line and the User tile. The chip shows the business name first, so the difference shows only for an unnamed account with no business, which shows the 8-character id. Separately, the chip's `users.email` branch is dead: the route never sends it (O-7). | Low (recorded) |
| F-6 | `app/admin/helpbot-config/page.tsx` | 13 pre-existing TS2322 errors (the optional spreads). They reproduce on `HEAD` and are not new. | Info |

#### Checks

- **Source guard (H-5):** each way of reintroducing the write is caught. A literal property (`helpbot_embedding_model:`), a quoted key or a second `set(…, 'helpbot_embedding_model')` (the literal count goes from 1 to 2), `updates.`/`updates[` assignment, `[HELPBOT_EMBEDDING_MODEL_KEY]`, any second use of the constant in the PUT, and `: config.semantic.embeddingModel`. H-1..H-3 catch the same thing at runtime.
- **Other HelpBot settings still save:** `withoutEmbeddingModel` copies `semantic` and deletes only `embeddingModel`. Everything else goes through unchanged, which P-2 asserts. `readOnly` on a controlled `Input` raises no React warning.
- **B privacy:** `/api/admin/audit-trail` is gated by `requireAdmin` (:41), the page by the admin layout's `requireAdminPage`, and the route is unchanged (`select('*')`, :94, already carries `user_email`). The CSV export is unchanged.
- **B order:** name → `user_email` → legacy `users.email` → `user_id`. This is correct. A system row (no `user_id`) is not rendered, which E-4 covers.
- **Requirement doc:** 4 insertions and 1 deletion. The only removed line is the old `Last Updated`.
- `console.*`: 0 in all three touched source files. ESLint: 0 errors, 18 warnings, all on lines that predate this change.

#### Test results (SA re-run, 2026-10-04)

| Set | Suites | Tests |
|---|---|---|
| The 3 new suites, plus the audit-trail page (11), the audit-trail route (5), and `app/api/admin/__tests__/adminGate.writes.test.ts` | 19/19 | 512/512 |
| The Dev's wide set: `app/admin`, `app/api/admin`, `lib/admin`, `lib/business-os/llm` | **128/128** | **3,208/3,208** |

The Dev reported 127/128, with `business-os-invites/page.render` timing out under load. That suite passed in this run, which is consistent with a flake.

#### Browser checklist (user)

1. Open `/admin/helpbot-config`. The page is hidden from the menu, so type the URL. With semantic search on, **Embedding Model** shows the current value in a field you cannot edit, with the warning "Read-only: this model is shared with Business OS chat…".
2. Change one harmless value, such as the cache threshold, and click **Save Changes**. You should see a success message. Reload the page. The new value is kept, and Embedding Model is unchanged. Optional: in DevTools → Network, the PUT body's `config.semantic` has no `embeddingModel`. Set the value back afterwards. Note that Save writes every HelpBot setting, as it did before.
3. Open `/admin/audit-trail` and find a row for an account with no profile name. The row's "User:" line and the expanded **User** tile show the sign-in email, not the long id.
4. A row for a named account still shows the name. A system row has no User line.

### Code Approved for QA: Yes. The QA pass is combined with this review, and the follow-ups are recorded (F-1, F-3, F-5, W-2).

## QA Testing Report

See "SA Code Review + QA (2026-10-04)" under SA Review Notes. It was a combined pass on the short path.

## Commit Info

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-04 | Created | Short-path workplan for items A and B; implemented same day, uncommitted |
| 2026-10-04 | SA code review + QA (combined) | Approved. 128/128 suites and 3,208 tests in the wide set. Recorded follow-ups: the generic system-config writer (F-1), pre-existing route debt (F-3), the account chip (F-5), and the manual seed script (W-2). |
| 2026-10-04 | SA F-1 closed in this PR (main session) | `PUT /api/admin/system-config` now also refuses `helpbot_embedding_model` (exact key, compared in canonical form, so case and zero-width variants are caught) with 400 before any write, next to the existing `bos_llm_area_*` refusal. 3 new cases in `app/api/admin/system-config/__tests__/route.test.ts`. The lock now holds on both admin write paths; the manual seed SQL (W-2) stays recorded. Affected suites 21/21, 570/570. |
