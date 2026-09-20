# Workplan: Close the `profiles.role` self-promotion hole

> **Last Updated**: 2026-09-20

**Developer:** Dev
**Branch:** `fix/profiles-role-self-promotion` (worktree `../neuronforge-profile-role`, off `origin/main` `0d7544c0`)
**Status:** SA re-check **APPROVED** after QA (14 PASS / 2 PARTIAL-FAIL / 1 BLOCKED, no High defects); all
seven QA defects and all three SA delta items fixed. Awaiting user approval, then RM.
**Nothing committed. Migration written, NOT applied.**

> **For the commit message when this ships: the code merge alone closes nothing — the migration is the fix.**
> `ProfileTabV2` upserts `profiles` directly with the browser anon key (lines 198-209, `role` included) and
> never calls `PUT /api/user/profile`, so until `20261002_profiles_role_privilege_guard.sql` is applied the
> hole is open
> regardless of what ships in the bundle. The route change and the removed dropdown option are defence in
> depth and a correctness fix; the trigger is the control.

## Overview

Any signed-in user can set their own `profiles.role` to `'admin'` with the browser anon key. This closes
that, at the database, without breaking the two legitimate client writes of the column.

---

## Problem & evidence

| # | Evidence | Source |
|---|---|---|
| 1 | `profiles` UPDATE policy is `USING (auth.uid() = id)` — no `WITH CHECK`, no column restriction | measured on production, 2026-09-20 |
| 2 | `app/api/user/profile/route.ts:78,124` destructured `role` from the body and wrote it | source |
| 3 | `components/v2/settings/ProfileTabV2.tsx:40-45` offered `{ value: 'admin', label: 'Administrator' }` | source |

Re-verified before relying on it: **no code authorizes on `profiles.role`.** The only reads are
`lib/user-context/builders.ts:31` (LLM personalization) and `app/api/admin/onboarding-users/route.ts:56`
(display). Admin identity is `admin_users` via `AdminAccessService`
([ADMIN_IDENTIFICATION_AND_ACCESS.md](/docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md)); the last policy that
trusted `profiles.role` was dropped from `system_settings_config` by
`supabase/migrations/20260920a_lock_system_settings_and_pricing_rls.sql`. So the column is a label, and the
fix is to make sure it can never again be read as anything else.

### What changed the picture

A blanket "freeze the role for non-service-role callers" **would have broken onboarding.**
`components/onboarding/RoleStep.tsx:84-90` and `components/onboarding/hooks/useOnboarding.ts:317-356`
both write `profiles.role` **from the browser with the anon key**, with persona values
(`business_owner`, `manager`, `consultant`, `operations`, `sales`, `marketing`, `finance`, `other`).
`ProfileTabV2` likewise writes `profiles` **directly** (lines 198-209, `role` included), not through the API
route — so the route fix alone would not have closed anything. `app/auth/callback/page.tsx:64-73` is a fourth
browser-side writer; see the writer inventory below.

The guard therefore clamps **privileged values only**, and leaves every other value alone.

### Every writer of `profiles.role` (QA D6)

All four client writers use the **browser anon key**, which is why the database is the only place a fix
lands. This inventory is the thing to re-check whenever a fifth appears.

| Writer | Key | Writes `role` as | Can it write a privileged value? |
|---|---|---|---|
| `components/onboarding/RoleStep.tsx:84-90` | anon | one of 8 personas from a closed `UserRole` union | No — union has no privileged member. Unclamped and must stay so. |
| `components/onboarding/hooks/useOnboarding.ts:317-356` | anon | `state.data.role`, same union | No — same union. |
| `components/v2/settings/ProfileTabV2.tsx:198-209` | anon | `profileForm.role`, re-sent on **every** save | **It could** — this is the hole. Now `user`/`viewer` only in the UI, and clamped at the database regardless. |
| `app/auth/callback/page.tsx:64-73` (QA D6) | anon | **hard-coded literal `'user'`** | **No.** Confirmed by reading it: the insert is `{ id, full_name: user.user_metadata?.full_name \|\| '', role: 'user', created_at, updated_at }`. `user_metadata` — which *is* client-writable — flows into `full_name` only, never into `role`, and the insert runs once, guarded by an existence check. Nothing to fix. |
| `app/api/user/profile/route.ts` | anon (user-scoped, server-side) | **nothing, as of this change** | No. |

Two notes on `auth/callback`, flagged not fixed: it is a **direct browser Supabase write outside the
repository layer** (CLAUDE.md mandatory rule 1), and it logs via `console.*`. Neither is touched here — it is
not a file this change edits, and CLAUDE.md is explicit about not reformatting files you are not working on.

---

## The three changes

### 1. Migration (written, **not applied**) — `supabase/migrations/20261002_profiles_role_privilege_guard.sql`

`BEFORE INSERT OR UPDATE OF role ON public.profiles`, per row. If the caller is not privileged **and** the
incoming role is a privilege-sounding value, the old value is silently kept (`NULL` on INSERT) and a
`RAISE WARNING` is logged. Everything else passes through untouched, so both onboarding writes and the
profile save keep working and never see an error.

The incoming value is normalised with `lower(regexp_replace(coalesce(NEW.role,''),'[^a-zA-Z0-9]','','g'))` —
every non-alphanumeric character removed, not trimmed. `btrim` (the first version, SA finding 1) strips ASCII
spaces only, so `E'\tadmin'`, `E'admin\n'` and an NBSP-padded `admin` were stored verbatim while JavaScript's
`.trim()` would read them back as exactly `admin`. The comparison stays **exact equality**: with separators
stripped, the persona `business_owner` becomes `businessowner`, which *contains* `owner`, so a substring test
would clamp a legitimate onboarding answer.

**Service-role detection: `current_user IN ('service_role','postgres','supabase_admin','supabase_auth_admin')`.**
PostgREST switches the session into `anon` / `authenticated` / `service_role` per request, so `current_user`
*is* the database's own identity for the caller, and it is the same signal that decides `BYPASSRLS`. The
alternative — `auth.role()` / `current_setting('request.jwt.claims')` — reads a GUC: set by PostgREST from a
verified token, but still a settable session variable, and it would make the guard depend on the `auth` helper
schema. `current_user` is strictly narrower, so it is the one used. `postgres` / `supabase_admin` /
`supabase_auth_admin` are included so migrations, the SQL editor, and any GoTrue-side profile bootstrap keep
working. Consequence, documented in the file: a `SECURITY DEFINER` function owned by `postgres` runs as
`postgres` and is therefore allowed — the intended escape hatch for server-authored RPCs.

Coexistence checked: the only `profiles` trigger in the repo is `auto_set_profile_org_id`
(`20260616_add_org_id_to_profiles.sql`), and it is `AFTER INSERT ON organizations` — a different table, no
conflict. The migration opens with a pre-apply check that lists any trigger the live DB has which the repo
does not. It also carries a commented rollback and a commented verification block (attacker simulation +
persona regression), and a commented, *not applied*, optional `WITH CHECK (auth.uid() = id)` on the UPDATE
policy.

**Filename note:** repo migrations are a monotonic sequence, not true dates — the newest on `main` is
`20261001_user_subscriptions_write_lockdown.sql`, already past today. `20261002_` keeps it applying last
while still satisfying "2026-09-20 or later".

### 2. `app/api/user/profile/route.ts`

`role` is no longer destructured or written. **Silently ignored, not rejected** — that matches how the route
already treats every other field it does not list (`job_title`, `domain`, `onboarding_*` are all dropped
without comment), and rejecting would turn a stale client into a failed profile save. A Pino `warn` records
each attempt, so it is silent to the client but not to us.

**Standards:** this route did **not** meet the project API standard. Flagged, not fixed (out of scope): no Zod
on the PUT body, no `UserProfileRepository` (direct `from('profiles')` in the route), no `correlationId`, and
3 pre-existing `tsc` errors at lines 186/195/197 (`generateDiff` / `auditLog` argument types). It had
**10 `console.*` calls** (lines 48, 64, 100, 110, 139, 146, 178, 205, 208, 218); since this is the file being
edited, they were converted to `createLogger` per CLAUDE.md § Logging.

### 3. `components/v2/settings/ProfileTabV2.tsx` (+ new `profileRoleOptions.ts`)

The `admin` option is gone. `roleOptions` / `getRoleConfig` moved to
`components/v2/settings/profileRoleOptions.ts` so the guarantee is unit-testable rather than a regex over JSX.

The fallback was `roleOptions[1]` — positional, and with `admin` removed that index becomes **`viewer`**, so
every legacy `role = 'admin'` row and every onboarding persona would have displayed as "Viewer". It now
resolves `'user'` by value. Display only: `saveProfile` writes `profileForm.role`, the raw stored value, which
changes only when the user actually picks an option — so an existing `'admin'` row re-saves as `'admin'`, the
trigger sees `NEW.role = OLD.role`, and nothing breaks.

---

## Tests

| File | Asserts |
|---|---|
| `app/api/user/profile/__tests__/route.test.ts` | PUT carrying `role: 'admin'` updates the other fields and the `role` key is **absent** from the payload — for all fourteen spellings, including tab-, newline-, NBSP- and zero-width-padded; a normal PUT still writes its fields; the timezone mirror still fires; 401 without a session |
| `components/v2/settings/__tests__/profileRoleOptions.test.ts` | No privileged value is offered; the normalisation semantics the SQL guard depends on (padded and separator spellings clamp, all ten personas do not, and `business_owner` ⊃ `owner` proves it is equality not a substring test); `getProfileRoleConfig` returns `user` (not `viewer`) for a stored `'admin'`, for a persona, and for unknown input |

Mutation-checked: re-adding `updateData.role` to the route fails 6 of its tests. A JS mirror is **not** a test
of the trigger — jest cannot run Postgres and this repo has no pgTAP harness — so the migration's VERIFICATION
block is the only proof of the guard itself and must be run live, with its output pasted into the QA report.

## Gates

`npx tsc --noEmit` (needs `NODE_OPTIONS=--max-old-space-size=8192`; it OOMs otherwise), `npm run build`, and
`npx jest` on the touched files. Output in the report. Baseline on `origin/main` `0d7544c0`: **2034**
pre-existing `tsc` errors, 3 of them in `app/api/user/profile/route.ts`.

---

## SQL for the user to run (read-only)

```sql
-- How many rows already claim a privileged role, and are any of them real admins?
SELECT p.role,
       count(*) AS row_count,
       count(*) FILTER (WHERE au.user_id IS NOT NULL) AS also_in_admin_users
FROM public.profiles p
LEFT JOIN public.admin_users au ON au.user_id = p.id
WHERE lower(btrim(p.role)) IN
      ('admin','administrator','superadmin','super_admin','super-admin',
       'platform_admin','owner','root','service_role','service-role')
GROUP BY p.role
ORDER BY row_count DESC;

-- Full distribution, for context (personas vs legacy values).
SELECT coalesce(role, '(null)') AS role, count(*) FROM public.profiles GROUP BY 1 ORDER BY 2 DESC;

-- Confirm the policy really is the unguarded one described above.
SELECT policyname, permissive, roles, cmd, qual, with_check FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'profiles';

-- Any profiles trigger the repo does not know about (the new guard must coexist with it).
SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
WHERE tgrelid = 'public.profiles'::regclass AND NOT tgisinternal;
```

**Answered, 2026-09-20 — see [§ Production evidence](#production-evidence--2026-09-20).** Three rows said
`admin`; two were genuine `admin_users`, one was not. All three were cleared to `'user'` and the re-census
**Applying the migration** still rewrites nothing — deliberately, so it cannot destroy data — which is why
the cleanup lives in `scripts/cleanup-profiles-role-admin.ts` instead. Note the precise scope of that claim
(QA D2): it is about the migration, not a promise that a privileged value survives forever. Once the guard is
live, the next **client upsert** of such a row clears it to NULL. Moot in practice — after the cleanup, no row
can reach either path.

## Also found — reported, not changed

| Finding | Why it is left alone |
|---|---|
| `components/settings/ProfileTab.tsx:37-60` (live at `/(protected)/settings`) offers the same `admin` option | Its parent `app/(protected)/settings/page.tsx:147-156` does **not** persist `role` — the control is cosmetic and writes nothing. Misleading UI, not a hole. Outside the stated scope. |
| `components/onboarding/hooks/useOnboarding_old.ts:60` seeds `role: 'admin'` | Dead file — no importers. The likely origin of the three `role = 'admin'` rows the 2026-09-20 census found (all since cleared). Deletion belongs to a cleanup slice. |
| `app/api/admin/onboarding-users/route.ts:56` returns `profile.role` to an admin screen | Display only, not authorization. |
| `lib/user-context/builders.ts:31` falls back to `user.user_metadata?.role` (SA finding 4) | `user_metadata` is client-writable via `supabase.auth.updateUser({ data: { role: 'admin' } })`, so the same logical field stays user-controlled one line after the column is clamped. Not exploitable today for the same reason the column isn't — nothing authorizes on it — but it means this fix is honestly described as closing *the column*, not the field. Handed to the admin-authz slice. |
| SA ruling 7: the missing `WITH CHECK` also permits rewriting one's own `profiles.org_id` | `public.profiles`' policies do not live in this repo, so the tree cannot prove whether any live policy grants org-scoped data on that column. If one does, that is a live cross-tenant hole worse than this one. SA's read-only query is in [§ Migration go/no-go](#migration-gono-go); triage the answer, do not fix it here. |

## SA Review Notes

SA's full review is in [§ SA Code Review](#sa-code-review) below: **⚠️ APPROVED WITH CHANGES**, 2026-09-20.
Every design call was upheld — denylist over allow-list, `current_user`, the silent clamp, the Pino
conversion as mandatory rather than creep. Dev's resolutions:

| SA # | Sev | Resolution |
|------|-----|------------|
| 1 | High | **Fixed by Dev:** normalisation is now `lower(regexp_replace(coalesce(NEW.role,''),'[^a-zA-Z0-9]','','g'))` — the whole non-alphanumeric class removed, not trimmed, so `E'\tadmin'`, `E'admin\n'`, NBSP- and zero-width-padded values all fold to `admin`. Equality kept, per SA's trap: with separators stripped `business_owner` → `businessowner`, which *contains* `owner`, so a substring test would clamp a legitimate persona — there is now a test named for exactly that. `privileged_values` is written in already-normalised form, so `super_admin` / `super-admin` / `Super Admin` need no entries of their own. Proof at three levels: VERIFICATION 2/2b/2c runs every padded and separator spelling plus all ten personas through the real expression **in the database**; `profileRoleOptions.test.ts` pins the same semantics in JS against a mirror of the expression; the route test sends all fourteen spellings over HTTP. |
| 2 | Medium | **Fixed by Dev:** both `console.error` calls converted to `clientLogger` from `@/lib/logger/client`, structured, errors as `{ err }` with `userId`. Zero `console.*` remain in the file. |
| 3 | High (verification gap) | **Fixed by Dev:** the migration's PRE-APPLY CHECK now carries the `auth.users` query **inline** as item 4, headed "THE ONE THAT CAN DEFEAT THIS MIGRATION. Run it. Do not skip it." — with the expected result (zero rows), what a non-zero result means, and a second query printing the body of any function anywhere that touches `raw_user_meta_data` or writes `profiles.role`. It also records SA's point that exempting GoTrue stays correct (it must be able to create the profile row); the fix, if such a function exists, is to stop *that function* trusting signup metadata, not to un-exempt the caller. |
| 5 | Low | **Fixed by Dev:** added `superuser`, `sysadmin`, `systemadmin`, `supabaseadmin` (normalised form). `staff` and `moderator` deliberately **not** added, with the reason in the migration and a test pinning it: both are plausible ordinary job labels — which is what this column holds — and neither is a privilege name anything in this codebase checks. Clamping them would swallow a legitimate answer to buy nothing. |
| 4, 6, 7 | Medium / deferred | Acknowledged, not actioned — `user_metadata.role` added to "Also found" below and handed to admin-authz; the Zod/repository debt and the migration-filename hazard stand as already flagged. |

---

## SA Code Review

**Reviewed by SA — 2026-09-20**
**Status:** ⚠️ APPROVED WITH CHANGES
**Code Approved for QA:** Yes, after findings 1–3.
**Migration go/no-go:** ✅ **GO, conditional** — see [Migration go/no-go](#migration-gono-go) below.

Independently verified before writing this: the two onboarding write paths, the `UserRole` union,
`ProfileTabV2`'s direct write, the absence of `public.profiles` DDL/policies anywhere in
`supabase/migrations/`, and the two new test files (`npx jest` on both: **17 passed, 2 suites**).

### Code Review Comments

| # | Location | Finding | Severity |
|---|---|---|---|
| 1 | `supabase/migrations/20261002_profiles_role_privilege_guard.sql:154` | **`btrim` strips spaces only.** PostgreSQL's one-argument `btrim` removes the longest run of `' '` — not tabs, newlines, or U+00A0. So `E'\tadmin'`, `E'admin\n'` and `'admin'` padded with a non-breaking space all miss the denylist and are stored verbatim. The workplan's own claim ("case/whitespace-normalised") is therefore only half true, and a later reader doing `role.trim().toLowerCase() === 'admin'` **in JavaScript** — where `.trim()` does strip tabs — would match a value this guard let through. Normalise by stripping every non-alphanumeric instead: `lower(regexp_replace(coalesce(NEW.role, ''), '[^a-zA-Z0-9]', '', 'g'))`. That also collapses `super_admin` / `super-admin` / `Super Admin` into one token, letting the list shrink. **Trap for whoever implements it:** once separators are stripped, `business_owner` becomes `businessowner`, which *contains* `owner` — the comparison must stay exact equality (`= ANY`), never `LIKE '%owner%'`, or the persona breaks. | **High** |
| 2 | `components/v2/settings/ProfileTabV2.tsx:254, 260` | Two `console.error` calls remain in a file this change edits. CLAUDE.md § Logging makes conversion mandatory for any touched file, and the route was correctly converted (0 `console.*` remain there) — this file was missed. Use `clientLogger` from `@/lib/logger/client`, exactly as `components/onboarding/hooks/useOnboarding.ts:6-8` does. | **Medium** |
| 3 | `supabase/migrations/20261002_profiles_role_privilege_guard.sql:106-109` | **The pre-apply inventory looks at the wrong table.** It lists triggers on `public.profiles`. The trigger that would matter for the documented `postgres` / `supabase_auth_admin` exemption lives on **`auth.users`** — a `handle_new_user`-style `SECURITY DEFINER` bootstrap. None exists in this repo (nor does the `profiles` table DDL or any of its policies — confirmed by grep across `supabase/migrations/`), which means anything live was created through the dashboard and is invisible here. If such a function copies `raw_user_meta_data ->> 'role'` into `profiles.role`, that input is **client-supplied at signup** and runs on the exempt path — a bypass of this exact fix. Add the `auth.users` trigger query to the pre-apply check and read the function body before applying. | **High** (verification gap) |
| 4 | `lib/user-context/builders.ts:31` | `role: profile?.role \|\| user.user_metadata?.role`. `user_metadata` is **client-writable** (`supabase.auth.updateUser({ data: { role: 'admin' } })`). Clamping the column while the same logical field falls back to a fully user-controlled value leaves the identical vector one line later. Not this slice's code and not exploitable today for the same reason the column isn't — but the workplan's framing ("makes the column unable to say admin again") is true only of the column. Add to "Also found" and hand to the admin-authz slice. | **Medium** |
| 5 | migration `:134-139` | Denylist gaps even after finding 1: `superuser`, `sysadmin`, `system_admin`, `moderator`, `staff`, `supabase_admin`. Add at least the first three. | **Low** |
| 6 | `app/api/user/profile/route.ts` (whole file) | No Zod on the PUT body (CLAUDE.md mandatory rule 2) and direct `from('profiles')` rather than a repository — both correctly flagged by Dev and correctly left alone. Confirmed `UserProfileRepository` is read-only (`findById` at `:47`), so there is no write method to use; adding one is a real slice, not a drive-by. **Not blocking**, because this change strictly *reduces* the unvalidated surface. But the route now deliberately drops a field, which is precisely what a Zod schema expresses — required before the next feature edit here. | **Medium, deferred** |
| 7 | migration filename | `20261002_` is ahead of today. Consistent with `20261001_user_subscriptions_write_lockdown.sql` already on `main`, and it sorts last, so accept. Flagging that the sequence has fully decoupled from dates — a hazard the next person writing a genuinely-dated migration will hit. | **Low, informational** |

### Rulings on the questions raised

**1. Denylist vs allow-list — denylist is correct here. Keep it.**
The allow-list *is* enumerable, so "we don't know the set" is not the reason: it is the `UserRole` union at
`components/onboarding/hooks/useOnboarding.ts:26` (8 personas) plus `user` and `viewer` from
`profileRoleOptions.ts`. The reason is the failure-mode asymmetry. An allow-list **fails closed**: the next
persona added to `RoleStep.tsx` is silently swallowed by the database, producing a data bug that surfaces
only as wrong LLM personalization, months later, for every user who picks it — and the developer who added
the persona has no reason to look in a migration. A denylist **fails open**: an unlisted privileged synonym
gets stored, which matters *only* if some future code authorizes on the column — and that is exactly what the
real control (`admin_users` / `AdminAccessService`) forbids. Trading a certain product bug for a conditional
second-lock gap is the right trade for a column that is, by decree, a label.
**But make the fail-open mode enforceable:** the durable guarantee is "nothing authorizes on `profiles.role`",
and today that is a grep someone ran once. Add a CI check that fails on `profiles.role` compared to a
privilege value in TS **and** on `p.role = 'admin'`-shaped predicates in `supabase/migrations/*.sql` — the
very shape that `20260920a_lock_system_settings_and_pricing_rls.sql:311` had to remove. That check, not the
list, is what makes this fix permanent. (Admin-authz slice is the right home; note it there.)

**2. `current_user` — correct signal, correct allow-list.**
PostgREST `SET LOCAL ROLE`s the session per request, so `current_user` is the database's own identity for the
caller and is the same identity that decides `BYPASSRLS`; it is not reachable from the request body. The
`auth.role()` / GUC alternative was rightly rejected. `authenticated` holds no membership in `service_role`,
so it cannot `SET ROLE` its way out. `authenticator` is correctly *absent* — it falls to the guarded path,
which is the conservative direction. The `SECURITY DEFINER`-owned-by-`postgres` exemption is an acceptable
escape hatch **conditional on finding 3**: it is only sound while no such function carries a client-supplied
role into `profiles`. Verify, then it is fine.

**3. Trigger mechanics — sound.**
`BEFORE INSERT OR UPDATE OF role` is right: the `OF` list fires whenever `role` appears in the `SET` clause
(changed or not), `role` cannot change when it is absent from `SET`, INSERT is unconditional, and a PostgREST
upsert is `INSERT … ON CONFLICT DO UPDATE` so both `ProfileTabV2:191-207` and `useOnboarding.ts:317-336` are
covered. Idempotent and re-runnable (`CREATE OR REPLACE` + `DROP TRIGGER IF EXISTS` + `CREATE`). Rollback is
complete — no policy, grant or row is touched, so there is genuinely nothing else to restore.
**Silent clamp over `RAISE EXCEPTION` is the right call**, and for a sharper reason than the comment gives:
`ProfileTabV2.tsx:194` re-sends the stored `role` on *every* save, so a raising guard would hard-fail the
profile save of every legacy `admin` row on a field the user never touched. The `IS DISTINCT FROM` check
correctly keeps that no-op case from even emitting a warning. Only defeats found are finding 1 (whitespace /
unicode padding) and finding 5 (unlisted synonyms); the INSERT path, case folding, and the
already-privileged-row case are all handled.

**4. Route — silent-ignore is right; the Pino conversion is in scope, not creep.**
Ignoring matches how `job_title`, `domain` and `onboarding_*` already behave, and a 400 would fail a save the
user did ask for over a field they didn't. The `warn` at `route.ts:136-141` is the correct compensating
control — silent to the client, not to us. The `console.*` → Pino conversion is **mandatory**, not optional:
CLAUDE.md § Logging requires it for any file you touch. Verified 0 `console.*` remain in the route. Process
nit only: the rule is flag-and-propose *before* converting; the workplan flags it retroactively. Accepted.

**5. "The route fix alone closes nothing" — verified, true.**
`components/v2/settings/ProfileTabV2.tsx:191-207` upserts `profiles` **directly with the browser anon key**,
including `role: profileForm.role`, and never calls `PUT /api/user/profile`. So:
**this fix is not complete as a code change — it is complete only once the migration is applied.** Merging the
TypeScript without the migration changes nothing about the hole. State that plainly in the commit message so
nobody reads the merge as the fix.
Stopping the direct browser write (routing the settings save through a server endpoint + repository) is the
right long-term shape and is required by the repository-pattern rule — but it is a refactor of the whole
settings tab, and the trigger makes it unnecessary *for this hole*. Correctly out of scope here; it belongs
with the repo-conformance / admin-authz work.

**6. Tests — they prove the route and the option list, and nothing about the trigger.**
That is the correct division: jest cannot exercise a Postgres trigger. Both suites pass (17 tests) and the
route test asserts the right thing — *key absent from the payload*, not merely "role unchanged". There is no
pgTAP or SQL test harness anywhere in this repo, so **there is no automated proof of the trigger at all**, and
there is no cheap way to add one in this slice. The VERIFICATION block in the migration is therefore the only
proof — it must be run live and its output pasted into the QA Testing Report before RM commits. One gap in
that block: it tests `'  ADMIN '` but not the padding that actually defeats the current code — add the tab
case (see post-apply checks).

**7. Scope — agreed on all exclusions**, with one addition. Legacy `admin` rows, `components/settings/ProfileTab.tsx`'s
cosmetic option, `useOnboarding_old.ts`, the `user_metadata.role` fallback (finding 4) and the optional
`WITH CHECK` all belong to admin-authz. **Addition:** the missing `WITH CHECK` does not only permit an `id`
rewrite — it also lets a user rewrite their own `profiles.org_id`. No repo migration gates anything on
`profiles.org_id`, but `public.profiles`' policies do not live in this repo at all, so that proves nothing.
If any live policy grants org-scoped data on `profiles.org_id`, that is a **live cross-tenant hole, strictly
worse than this one**. Add the read-only query below and triage the answer.

### Migration go/no-go

**GO — conditional on finding 3 being answered first.** The change is strictly safer than today, touches no
rows, no policies and no grants, and rolls back in two statements.

Preferred order: fix findings 1 and 2, re-run jest, then apply once. If you would rather apply now, applying
as-is is still a net improvement and finding 1 can ship later as a bare `CREATE OR REPLACE FUNCTION` — the
trigger does not need to be dropped or recreated to pick up a new function body.

**Before applying — the one blocking question (finding 3):**

```sql
-- Any trigger on auth.users (this repo defines none; anything here was made in the dashboard).
SELECT tgname, pg_get_triggerdef(oid)
FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal;

-- If one exists, read its function body and look for raw_user_meta_data ->> 'role'.
SELECT p.proname, pg_get_functiondef(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE pg_get_functiondef(p.oid) ILIKE '%profiles%'
  AND pg_get_functiondef(p.oid) ILIKE '%role%'
  AND n.nspname NOT IN ('pg_catalog', 'information_schema');
```

If any function copies a signup-supplied role into `profiles.role`, **do not apply yet** — that path is exempt
and would walk straight through the guard. Fix the function first.

**Also run (read-only, not blocking) — the org_id question from ruling 7:**

```sql
SELECT schemaname, tablename, policyname, qual, with_check
FROM pg_policies
WHERE qual ILIKE '%profiles%org_id%' OR with_check ILIKE '%profiles%org_id%';
```

Any row here means a user can move themselves into another organisation by editing their own profile. Report
it; do not fix it in this slice.

**After applying — exact checks:**

| # | Check | Expected |
|---|---|---|
| 1 | `SELECT tgname FROM pg_trigger WHERE tgrelid='public.profiles'::regclass AND NOT tgisinternal;` | includes `profiles_role_privilege_guard` |
| 2 | Migration VERIFICATION block, step 1 (`SET role='admin'` as `authenticated`) | row **unchanged**, a `WARNING` in the output, **no error** |
| 3 | Same block, step 2 (`'  ADMIN '`) | row **unchanged** |
| 4 | **New — add this:** `UPDATE public.profiles SET role = E'\tadmin' WHERE id = :'uid';` then read it back | **Today: stores `\tadmin` (the finding-1 bypass).** After finding 1 is fixed: unchanged. Run it both times — this is how you confirm the fix landed. |
| 5 | Same block, steps 3–4 (`business_owner`, then `viewer`) | value **written** — onboarding and the settings save are not broken |
| 6 | Same block, step 5 (update with `role` absent from `SET`) | succeeds, guard does not fire |
| 7 | Same block, step 6, as `postgres` | `admin` **is** written — server paths unaffected |
| 8 | **Live UI smoke, not SQL:** complete onboarding's role step in a browser, then save Settings → Profile | both persist; no error toast |
| 9 | Browser console as a normal signed-in user: `await supabase.from('profiles').update({ role: 'admin' }).eq('id', (await supabase.auth.getUser()).data.user.id)` then re-read | request **succeeds** (by design — silent clamp) and the stored value is **unchanged**. This is the hole; this is the proof it is closed. |

Steps 2–7 all run inside the `BEGIN … ROLLBACK` already in the migration file and write nothing. Paste the
output into the QA Testing Report.

### Decisions for the user (business terms, not technical)

1. ~~**Existing rows that say "admin".**~~ **Resolved 2026-09-20** — census found 3, the user cleared all 3 to
   `'user'`, re-census returned zero. See [§ Production evidence](#production-evidence--2026-09-20).
2. **Should the Settings → Profile tab offer a role picker at all?** The field now means nothing to the system —
   it is a label used only to flavour LLM responses. Offering "User / Viewer" implies permission levels the
   product does not have. Removing the control entirely is the honest option; keeping it is fine if you want
   the personalization signal.
3. **Tighten the profile policy (the commented `WITH CHECK`)?** Small, safe, and closes a second-order bug where
   a user can re-key or re-org their own profile row. Left unapplied here on purpose. Worth scheduling with
   the admin-authz work rather than bolting onto this fix.

## Production evidence — 2026-09-20

### 1. Pre-apply check: PASSED — the migration is cleared to apply

The `auth.users` / `public.profiles` trigger inventory (PRE-APPLY CHECK item 4) returned exactly two
triggers, **neither of which touches `role`**. SA finding 3 — the `handle_new_user`-style bypass that would
walk through this guard on the exempt `supabase_auth_admin` / `postgres` path — **does not exist here**.

**Trigger 1 — `create_user_settings_trigger` on `auth.users` → `public.create_user_settings()`**

> **CORRECTED 2026-09-20.** The block below was first written with
> `ON CONFLICT … DO NOTHING` on every INSERT. **The live function has no
> `ON CONFLICT` clauses at all.** The version now shown is the
> `pg_get_functiondef` output re-read from production on 2026-09-20 while
> codifying this trigger as a migration
> (`supabase/migrations/20261003_codify_create_user_settings_trigger.sql`,
> PR #71). A migration built from the earlier text would have *added* those
> clauses to the live signup path — a silent behaviour change sourced from a
> document that said it was quoting.
>
> **The finding this section supports is unaffected**, and that is worth being
> precise about: the point here is what the function *writes* — `id` only, never
> `raw_user_meta_data`, never `role` — and that is true of both versions. The
> guard migration this evidence cleared remains correctly applied.
>
> Two consequences of the real definition, recorded because they matter
> elsewhere: each INSERT runs inside the `auth.users` insert, so a conflict
> **aborts the whole signup** rather than being skipped — signup fails closed,
> which is why an `auth.users` row created since this trigger existed cannot be
> missing its `profiles` row (the property PR #70 relies on when it deletes the
> browser-side profile fallback). And making the function idempotent is
> therefore a real production change, not a tidy-up.

```sql
CREATE OR REPLACE FUNCTION public.create_user_settings()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    -- Create default profile
    INSERT INTO public.profiles (id) VALUES (NEW.id);

    -- Create default preferences
    INSERT INTO public.user_preferences (user_id) VALUES (NEW.id);

    -- Create default notification settings
    INSERT INTO public.notification_settings (user_id) VALUES (NEW.id);

    -- Create default security settings
    INSERT INTO public.security_settings (user_id) VALUES (NEW.id);

    RETURN NEW;
END;
$function$
```

It inserts `profiles (id)` and nothing else — **no `raw_user_meta_data`, no `role`**. Signup cannot carry a
self-served role into the column.

**Trigger 2 — `update_profiles_updated_at`, BEFORE UPDATE ON `public.profiles` → `public.update_updated_at()`**

```sql
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
```

**Ordering is harmless, in either direction.** PostgreSQL fires same-event BEFORE row triggers in
**alphabetical order by trigger name**, so `profiles_role_privilege_guard` runs *before*
`update_profiles_updated_at` (`p` < `u`). It would not matter if it were reversed: the two write **disjoint
columns** (`role` vs `updated_at`), neither reads what the other writes, and both `RETURN NEW` rather than
NULL, so neither can cancel the row or discard the other's edit. The new guard is also `UPDATE OF role`
while that one is a plain `BEFORE UPDATE` — on a save that does not mention `role`, only the timestamp
trigger fires, which is correct, because `role` cannot change when it is absent from the `SET` list. Recorded
in the migration's COEXISTENCE block as well.

### 2. The `role = 'admin'` census, and its cleanup

**Before** (census query from [§ SQL for the user to run](#sql-for-the-user-to-run-read-only), 2026-09-20):

| role | row_count | also_in_admin_users |
|------|-----------|---------------------|
| `admin` | 3 | 2 |

Two of the three were genuine platform admins — their real privilege comes from `admin_users`, so clearing
the label costs them nothing. **One was not.** That is the self-promotion path showing up in the data. Not
proof of an attack — `useOnboarding_old.ts:60` seeded `role: 'admin'` and the settings tab offered it as a
choice — but it is exactly the row that would have become a real admin the moment anyone wrote
`WHERE role = 'admin'`.

**Action** — the user ran, on production:

```sql
UPDATE public.profiles SET role = 'user' WHERE lower(btrim(role)) = 'admin';
```

**After:** the census re-run returned **zero rows**. No privileged value remains in `profiles.role`.

### 3. The cleanup is now in the repo as a script

`scripts/cleanup-profiles-role-admin.ts`, following the existing one-off-script convention (`supabaseServer`
+ `createLogger`, dry run by default, `--apply` to write) — the same shape as
`scripts/cleanup-duplicate-insights.ts`. Its header records what it does, that it was **already run on
production on 2026-09-20**, the census that justified it, and that it is safe to re-run (it matches nothing
today).

**Deliberately not folded into the migration:** applying the migration rewrites no rows, and a schema
migration that silently edits user rows is harder to reason about than one that does not. (That is a claim
about the migration only — a later client upsert of a privileged row clears it to NULL; QA D2.) Two intentional differences from the operator's ad-hoc SQL:

- it matches the **trigger's** normalisation (`lower()` + every non-alphanumeric stripped) against the whole
  normalised denylist, so a tab-, NBSP- or separator-padded `admin` is caught too — not just the bare
  spelling `lower(btrim(...))` matched;
- comparison is exact equality, never a substring test, because `business_owner` normalises to
  `businessowner`, which *contains* `owner`, and that persona must not be touched.

`supabaseServer` (service role) is required here, not incidental: the table is RLS-protected per user and the
new trigger exempts `service_role`, so it is the only client that can perform the rewrite at all. It does not
set `updated_at` — the live `update_profiles_updated_at` trigger does that.

### 4. Still with the user

| Decision | Status |
|---|---|
| **(b)** Should the Settings → Profile tab offer a role picker **at all**? The field now means nothing to the system — it is a label used only to flavour LLM responses, and offering "User / Viewer" implies permission levels the product does not have. | **Open — with the user.** Removing the control entirely is the honest option; keeping it is fine if the personalization signal is wanted. Not actioned in this slice either way. |
| **(c)** The same missing `WITH CHECK` that allowed the role rewrite also lets a user rewrite their own `profiles.org_id`. | **Open — handed to the admin-authz slice.** `public.profiles`' policies do not live in this repo, so the tree cannot prove whether any live policy grants org-scoped data on that column. If one does, that is a live cross-tenant hole worse than this one. SA's read-only query is in [§ Migration go/no-go](#migration-gono-go); triage the answer there, do not fix it here. |

## SA re-check of the delta — APPROVED (2026-09-20)

Migration go/no-go unchanged. SA also confirmed the strip-**before**-lower order is the better one, since
`lower()` then only ever sees ASCII and is locale-independent. Three Low items, all fixed:

| SA # | Resolution |
|------|------------|
| **R1** — `normalize()` can *error* on a non-UTF8 server, and it now sits in a BEFORE INSERT trigger, so it would fail **signup** hard rather than fail safe; the old `btrim` expression could not error at all. | **Fixed, two ways.** (a) `SHOW server_encoding;` added to the PRE-APPLY CHECK as item **1b**, expecting `UTF8`, with the exact error text, why it breaks signup rather than failing safe, and an explicit *STOP — do not apply* with the two ways out (drop the `normalize()` call, losing only D4's full-width folding, or fix the encoding). (b) **I also defended the trigger**, rather than relying on the check alone. The check proves the encoding at apply time; it cannot prove it forever, and a restore onto a differently-encoded cluster would turn a security guard into an outage — "nobody can sign up" is a far worse failure than "a label is not NFKC-folded". The normalisation is now wrapped in a `BEGIN … EXCEPTION WHEN others` whose fallback is **the exact expression that shipped before NFKC**, so the guard stays fully operative and loses only the full-width folding: fail-degraded, never fail-open, with a `WARNING` so the degradation is visible in the Postgres log instead of silent. Cost is one subtransaction per role write — irrelevant, since `UPDATE OF role` fires on signup, the onboarding role step and a profile save, never in a hot loop. |
| **R2** — two stale "preserves existing rows" sentences survived the D2 correction. | **Fixed.** Migration PRE-APPLY CHECK item 3 and `scripts/cleanup-profiles-role-admin.ts:29`. The second mattered most: it sat in the very file that records those rows being cleared, so it read as a contradiction. Both now say applying the migration rewrites nothing, and name the upsert path and the script as what actually clears a row. |
| **R3** — the inherited-normaliser rule sat at line 356 of a migration nobody reopens. | **Fixed, minimally.** Carried into `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` — the place someone new actually meets this subject — as a short subsection under *Why not `profiles.role`*: the guard exists, and any future reader must compare against **its** normaliser rather than its own, because a reader that lowercases first or skips NFKC will disagree with the database about what `'admin'` is, and the disagreement is the vulnerability. The two knowingly-unclamped classes are named. While in that doc I also fixed the stale "nothing reads `profiles.role` for access" claim — true of the code, not of history: the dropped `system_settings_config` policy and the profile PUT both trusted it — and updated lifecycle scenario 4 and its Change History. The CI check itself stays with the admin-authz slice. |

## Dev responses to QA (2026-09-20)

QA: **14 PASS, 2 PARTIAL/FAIL, 1 BLOCKED**, no High defects, ship after D1. All seven addressed; the full
report follows below.

| QA # | Sev | Resolution |
|------|-----|------------|
| **D1** | Medium | **Fixed.** `polname` → `policyname` in all three operator-facing queries: the migration's PRE-APPLY CHECK item 2, § SQL for the user, and — the one that matters most — SA's `org_id` cross-tenant triage query. Column names verified against the `pg_policies` **view** (`schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check`), cross-checked against the working query in `20261001_user_subscriptions_write_lockdown.sql:99`, not recalled. All three now select `policyname` plus only columns that view actually exposes, and the migration carries an inline note that `polname`/`polcmd`/`polqual` belong to the catalog *table* `pg_policy` — a different relation — so the next person does not re-mix them. |
| **D2** | Low | **Kept the wipe; corrected both documents.** On a PostgREST upsert the BEFORE INSERT branch nulls the proposed row before `excluded` is built, so a legacy privileged role is **cleared to NULL, not preserved** — and since `ProfileTabV2` re-sends the stored role on every save, that is the realistic path. Keeping it is the right call: *preserving* would mean issuing a `SELECT` of the existing row from inside a BEFORE INSERT trigger on every signup — a read and a race on the hot path — spent conserving the one value this migration exists to eliminate. The user-visible result is a blank label rendering as "User": no error, no failed save, nothing granted lost, because nothing is granted by this column. The docs no longer claim otherwise: "preserves existing rows" is now stated precisely as *applying the migration rewrites nothing*, with the upsert behaviour spelled out in the INSERT branch, in § WHAT IS NOT CHANGED and in all three places in this workplan. New verification step **5b** exercises the real `INSERT … ON CONFLICT DO UPDATE` shape and expects `(null)`. |
| **D3 / D4** | Low | **Took NFKC; documented the rest as accepted residual risk.** Measured rather than assumed: `normalize(…, NFKC)` (PostgreSQL 13+, Supabase is 15) folds the **full-width** class — `ａｄｍｉｎ` → `admin`, now clamped — so D4 is closed in one line and the JS mirrors it with `String.normalize('NFKC')`. It does **not** close D3: NFKC folds compatibility variants, not confusables, so Cyrillic `аdmin` and Greek `ΑDMIN` still normalise to `dmin` and are stored verbatim. Closing that needs a confusables/skeleton table — a dependency, not a line of SQL — which is disproportionate for a display label. Same for D3's unlisted neighbours (`admins`, `adminuser`, `org_admin`): the denylist's designed failure mode, and unfixable by widening into a substring test, because `business_owner` → `businessowner` contains `owner`. Both classes are now written up in a dedicated **ACCEPTED RESIDUAL RISK** block in the migration and asserted in the test suite, so they stay a known quantity. **The rule the admin-authz slice inherits is stated there explicitly:** any future reader of `profiles.role` must compare against *this* normaliser, never its own — a reader that lowercases first, or trims instead of stripping, or skips NFKC, will disagree with the trigger about what "admin" is, and that disagreement *is* the vulnerability. D5 proved it inside this very change. SA's CI check is what actually retires both classes. |
| **D5** | Low | **Fixed.** Both mirrors are now `value.normalize('NFKC').replace(/[^a-zA-Z0-9]/g, '').toLowerCase()` — NFKC, strip, lower, the SQL's exact order. The old lowercase-first form diverged on a dotted capital I: `'ADMİN'.toLowerCase()` is `i` + U+0307, whose combining mark the strip then discards, giving `admin` where the SQL gives `admn` — i.e. the cleanup script would have rewritten a row the database considers legitimate. `ADMİN` is now an asserted case in the test and in the migration's 2c array, on the **must-not-clamp** side, alongside the homoglyphs. |
| **D6** | Low | **Fixed.** `app/auth/callback/page.tsx:64-73` added to a new [writer inventory](#every-writer-of-profilesrole-qa-d6) covering all five writers. **It cannot write a privileged role** — confirmed by reading it: `role` is the hard-coded literal `'user'`, and the client-writable `user_metadata` flows into `full_name` only, never `role`. Two pre-existing issues in that file flagged and *not* fixed (direct browser Supabase write outside the repository layer; `console.*` logging) — it is not a file this change edits, and CLAUDE.md is explicit about not reformatting files you are not working on. |
| **D7** | Informational | **Fixed.** Test count 45 → **51**; `ProfileTabV2` upsert references corrected to **198-209** everywhere. |

**Unchanged and re-confirmed: the merge closes nothing — the migration is the fix.** QA independently
verified `ProfileTabV2.tsx:198-209` upserts `profiles` with the browser anon key, `role` included, and never
calls the route. That statement is in the workplan header and must go in the commit message.

## QA Test Report

**QA — 2026-09-20**
**Test mode:** full
**Strategy used:** A + B (Jest, run by QA) for the TypeScript half; **E — source/SQL analysis** for the trigger half, because there is no Postgres, no pgTAP and no SQL harness in this environment or this repo, so the migration could not be executed. Adversarial work on the normaliser was done on paper **and** reproduced numerically in Node against a faithful strip-then-lower model of the SQL expression.
**Focus:** security, schema, api
**Skipped:** e2e (Playwright is not installed — CLAUDE.md § Testing); executing the migration (explicitly out of scope: "review, do NOT run").
**Input source:** prompt keywords.

### Gates — all three PASS

| Gate | Command | Result |
|---|---|---|
| Types | `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` | **PASS — exit 0**, `2034` errors excluding generated `.next/types` (2038 including the 4 `.next/types` ones) = **exactly the stated baseline**. 3 of them are in `app/api/user/profile/route.ts` — the same 3 pre-existing `generateDiff` / `auditLog` argument-type errors, now at lines 230/239/241 because the Pino conversion shifted them from 186/195/197. No new error anywhere. |
| Build | `npm run build` | **PASS — exit 0.** `✓ Compiled successfully`, 295 pages generated, route table emitted. The `DYNAMIC_SERVER_USAGE` Pino lines in the output are pre-existing prerender noise from `/api/admin/dashboard` and `/api/cron/calendar-sync`, unrelated to this change. |
| Tests | `npx jest app/api/user/profile components/v2/settings` | **PASS — 2 suites, 51 tests, 0 failures, 5.8 s.** (Workplan says 45; the count grew — see D7.) |

```
PASS app/api/user/profile/__tests__/route.test.ts
PASS components/v2/settings/__tests__/profileRoleOptions.test.ts

Test Suites: 2 passed, 2 total
Tests:       51 passed, 51 total
Snapshots:   0 total
Time:        5.809 s
Ran all test suites matching app/api/user/profile|components/v2/settings.
```

### Test coverage

| # | Acceptance criterion / claim under test | Tested? | Result | Evidence |
|---|---|---|---|---|
| 1 | `PUT /api/user/profile` never writes `role` | ✅ | **PASS** | `role` is gone from the destructure and from `updateData`; the diff shows `- if (role !== undefined) updateData.role = role;` removed. Jest asserts the key is **absent from the payload**, not merely unchanged, across 11 spellings. |
| 2 | Route still saves the fields it accepts; timezone mirror still fires; 401 without a session | ✅ | **PASS** | 4 dedicated tests, all green. |
| 3 | Settings picker no longer offers a privileged value | ✅ | **PASS** | `PROFILE_ROLE_OPTIONS` = `['user','viewer']`; tests assert no label/description matches `/admin/` or `/full access/`. |
| 4 | Fallback resolves by value, not index — a legacy `admin` row shows "User", not "Viewer" | ✅ | **PASS** | `getProfileRoleConfig` uses `.find(o => o.value === role)` with a value-resolved default; tested for `admin`, all 8 personas, empty string, unknown. |
| 5 | Trigger clamps privileged values for `anon` / `authenticated` | ❌ | **BLOCKED — live-only** | No Postgres available. The only proof is the migration's VERIFICATION block, unrun. Static read of the SQL is sound (see 6–9). |
| 6 | The comparison is exact equality, not a substring test | ✅ | **PASS (static)** | `IF NOT (incoming = ANY (privileged_values))`. `= ANY(array)` is element-wise equality — there is no `LIKE`, `ILIKE`, `~` or `position()` anywhere in the function body. `business_owner` normalises to `businessowner`, which *contains* `owner` and is **not** equal to it, so the persona passes. SA's trap is genuinely avoided in the SQL, not only in the JS mirror. |
| 7 | No legitimate persona is wrongly clamped | ✅ | **PASS** | Full persona set found at `components/onboarding/hooks/useOnboarding.ts:26` (the `UserRole` union) and `components/onboarding/RoleStep.tsx:27-69` — **8 values**: `business_owner, manager, consultant, operations, sales, marketing, finance, other`. Normalised: `businessowner, manager, consultant, operations, sales, marketing, finance, other`. None equals any of the 11 denylist entries. Same for `user`, `viewer`, `staff`, `moderator`, empty string, and `NULL` (coalesces to empty). **Zero false clamps.** |
| 8 | The trigger cannot break a real write path | ✅ | **PASS (static)** | Every writer of `profiles.role` in the tree triaged — see § Writers of profiles.role below. All four live browser writers write non-privileged values; the only service-side writer is the cleanup script, which is exempt; `create_user_settings()` writes `profiles(id)` only and is exempt twice over. **No legitimate write of a privileged value exists anywhere in the repo**, so the clamp has nothing legitimate to catch. |
| 9 | Guard coexists with `update_profiles_updated_at` | ✅ | **PASS (static)** | Disjoint columns (`role` vs `updated_at`), neither reads the other's write, both `RETURN NEW`, so ordering is irrelevant — and alphabetical ordering puts `p` before `u` anyway. The workplan's analysis is correct. |
| 10 | Migration is re-runnable | ✅ | **PASS** | `CREATE OR REPLACE FUNCTION` + `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`, all inside one `BEGIN … COMMIT`. `COMMENT ON` is idempotent. A second run is a no-op. The explicit `BEGIN;` / `COMMIT;` matches 5 other recent migrations on `main` (`20260828a`, `20260916`, `20260920a`, `20260930`, `20261001`), so it is house convention, not a surprise. |
| 11 | Rollback reverses it | ✅ | **PASS** | Drops the trigger **then** the function — the required order, since `DROP FUNCTION` without `CASCADE` would fail while the trigger depends on it. Nothing else is touched (no policy, grant or row), so "there is nothing else to restore" is accurate. The unrestored `COMMENT ON COLUMN` is correctly called out as cosmetic. |
| 12 | PRE-APPLY CHECK is executable | ⚠️ | **FAIL — see D1** | Items 1, 3 and 4 (the blocking `auth.users` query) are correct and runnable. **Item 2 is not: `pg_policies` has no `polname` column.** |
| 13 | Cleanup script: the dry-run default is real | ✅ | **PASS** | `const APPLY = process.argv.includes('--apply')` at module scope; the write loop sits behind `if (!APPLY) { …; return; }`. The documented `dotenv_config_path=` argv entry cannot collide. |
| 14 | Cleanup script: idempotent | ✅ | **PASS** | Writes `role = 'user'`; `normalise('user') === 'user'`, which is not on the denylist, so a second run matches nothing — consistent with the recorded post-cleanup census of zero rows. |
| 15 | Cleanup script's matching agrees with the trigger's | ⚠️ | **PARTIAL — see D5** | Agrees for every ASCII input, including all padded and separator spellings. Diverges on one Unicode class because it applies `lower()` and the strip in the opposite order to the SQL. |
| 16 | "The route fix is not the control" | ✅ | **PASS — CONFIRMED** | See § The code alone closes nothing below. |
| 17 | Logging standard on touched files | ✅ | **PASS** | `console.*` count: `route.ts` 0, `ProfileTabV2.tsx` 0, `profileRoleOptions.ts` 0, `cleanup-profiles-role-admin.ts` 0. `clientLogger` is a real export (`lib/logger/client.ts:4`). |

**Counts: 14 PASS · 2 PARTIAL/FAIL · 1 BLOCKED.**

### The code alone closes nothing — CONFIRMED

`components/v2/settings/ProfileTabV2.tsx` imports the **browser anon-key client** (`import { supabase } from '@/lib/supabaseClient'`, line 5) and at **lines 198-209** does:

```ts
const { error: profileError } = await supabase
  .from('profiles')
  .upsert({
    id: user.id,
    full_name: profileForm.full_name,
    avatar_url: profileForm.avatar_url,
    job_title: profileForm.job_title,
    role: profileForm.role,          // line 205 — written straight from the browser
    updated_at: new Date().toISOString()
  }, { onConflict: 'id' })
```

There is no `fetch('/api/user/profile')` anywhere in the file. `components/onboarding/RoleStep.tsx:85-91` does the same thing with a plain `.update({ role: selectedRole })`.

**Stated plainly, for the commit message and for the reader of this report: merging this bundle without applying `20261002_profiles_role_privilege_guard.sql` closes nothing. The hole stays exactly as wide as it is today.** The anon key ships in the client bundle, the `profiles` UPDATE policy has no `WITH CHECK` and no column restriction, and an attacker never needed the API route or the dropdown in the first place — one line in a browser console is enough. The route change and the removed option are correctness and defence in depth. **The trigger is the control, and it is not applied.**

### Writers of `profiles.role` — full sweep

62 `from('profiles')` call sites triaged; these are the ones that write the column.

| Writer | Client / DB role | Value written | Under the guard |
|---|---|---|---|
| `components/onboarding/RoleStep.tsx:85-91` | browser anon → `authenticated` | one of 8 personas | passes (UPDATE branch, not privileged) |
| `components/onboarding/hooks/useOnboarding.ts:319-336` + fallback `:346-358` | browser anon → `authenticated` | persona or `null` | passes |
| `components/v2/settings/ProfileTabV2.tsx:198-209` | browser anon → `authenticated` | `user` / `viewer` / the stored value | passes — **except a legacy privileged value, see D2** |
| `app/auth/callback/page.tsx:64-73` | browser anon → `authenticated` | `'user'` on INSERT | passes — **undocumented writer, see D6** |
| `app/api/user/profile/route.ts` | user-scoped | **no longer writes `role`** | n/a |
| `scripts/cleanup-profiles-role-admin.ts` | `supabaseServer` → `service_role` | `'user'` | **exempt** by the first branch |
| `public.create_user_settings()` (live, on `auth.users`) | `supabase_auth_admin`, SECURITY DEFINER | inserts `profiles(id)` only — no `role` | exempt, and would pass anyway |
| `components/onboarding/hooks/useOnboarding_old.ts:60` | — | `role: 'admin'` | **dead file, zero importers** (grep confirms) |
| `components/settings/ProfileTab.tsx` | browser | offers "Administrator" but its parent `app/(protected)/settings/page.tsx:147-157` upserts **without** `role` | cosmetic only — Dev's scoping is correct |
| `app/business-os/settings/page.tsx:260-266` | browser | upserts `profiles` **without** `role` | unaffected |

**Conclusion: the guard breaks no real flow.** There is no code path anywhere that legitimately needs to write a privileged value into this column, so the onboarding persona writes, the Settings save, and the signup path are all safe.

### Adversarial review of the normaliser

The expression is `lower(regexp_replace(coalesce(NEW.role,''),'[^a-zA-Z0-9]','','g'))`, compared with `= ANY` against 11 already-normalised entries. Every case below was computed in Node against a strip-then-lower model matching the SQL's operation order.

| Attack | Normalises to | Clamped? | Verdict |
|---|---|---|---|
| `admin`, `ADMIN`, `AdMiN` | `admin` | ✅ | case folding works |
| `'  ADMIN '`, `E'\tadmin'`, `E'admin\n'` | `admin` | ✅ | SA finding 1 genuinely fixed |
| NBSP-padded `admin` (U+00A0), zero-width-padded (U+200B) | `admin` | ✅ | fixed |
| `Super-Admin`, `super admin`, `super_admin`, `platform.admin`, `sys_admin`, `System Admin` | `superadmin` / `platformadmin` / `sysadmin` / `systemadmin` | ✅ | separator collapsing works; the denylist really does need only one spelling each |
| `service_role` | `servicerole` | ✅ | |
| **Combining marks** — `a` + U+0301 + `dmin` | `admin` | ✅ | the mark is stripped; **defeated** |
| **Cyrillic homoglyph** — `аdmin` (U+0430) | `dmin` | ❌ | stored verbatim — **D3** |
| **Greek homoglyph** — `οwner` (U+03BF) | `wner` | ❌ | stored verbatim — **D3** |
| **Full-width** — `ａｄｍｉｎ` (U+FF41…) | empty string | ❌ | stored verbatim; an NFKC-normalising reader sees `admin` — **D3** |
| **Turkish dotted I** — `ADMİN` (U+0130) | `admn` | ❌ | the trigger allows it; **the cleanup script and the JS mirror test say it is clamped** — **D5** |
| `admin1`, `adm1n` | `admin1` / `adm1n` | ❌ | harmless — no reader would match these |
| **Unlisted privileged-sounding:** `admins`, `adminuser`, `org_admin`, `site_admin`, `tenant_admin`, `superadministrator` | as written | ❌ | accepted denylist fail-open — **D4** |
| **Inverse check — `business_owner`** | `businessowner` | ❌ (correct) | contains `owner` but is not equal to it; `= ANY` is equality. **Proven against the SQL text, not only the JS mirror.** |
| All 8 personas + `user`, `viewer`, `staff`, `moderator`, empty, `NULL` | — | ❌ (correct) | **zero false clamps** |

One informational note on the SQL itself: PostgreSQL warns that bracket-expression **ranges** like `a-z` are collation-dependent in non-C locales, so `[^a-zA-Z0-9]` may strip slightly more or less than expected on a non-ASCII input. The direction of any such drift is leniency (a character survives the strip), which can only cause a **miss**, never a false clamp of an ASCII persona — so it cannot break onboarding. VERIFICATION steps 2b / 2c run the real expression in the real database, which is the right place to settle it; keep them.

### Defects

#### D1 — `pg_policies` has no `polname` column: three operator-facing queries will error — **Medium**

- **Files:** `supabase/migrations/20261002_profiles_role_privilege_guard.sql:139` (PRE-APPLY CHECK item 2); this workplan `:153` (§ SQL for the user to run); and this workplan `:321` — **SA's `org_id` cross-tenant triage query.**
- **Expected:** the operator pastes the PRE-APPLY CHECK and sees the current `profiles` policies.
- **Actual:** `ERROR: column "polname" does not exist`. The view `pg_policies` exposes `schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check`. `polname` belongs to the catalog **table** `pg_policy`, which has `polcmd` / `polqual` / `polwithcheck` instead — so the column *mix* in these queries matches neither relation. The sibling migration `20261001_user_subscriptions_write_lockdown.sql:99` gets it right (`SELECT policyname, permissive, cmd, roles, qual, with_check FROM pg_policies`).
- **Why this is more than a typo:** this migration's *only* proof is manual verification, so the verification apparatus is load-bearing. Worse, `:321` is the query SA flagged as possibly revealing **a live cross-tenant `org_id` hole strictly worse than this one** — it errors, so that triage silently never happens.
- **Fix:** `polname` → `policyname` in all three places.

#### D2 — a PostgREST upsert wipes a legacy privileged role to `NULL`, contradicting "existing rows are preserved" — **Low**

- **Files:** `supabase/migrations/20261002_profiles_role_privilege_guard.sql` (§ WHAT IS NOT CHANGED — "A row that already holds role = 'admin' keeps it"); this workplan `:110-111` ("an existing `'admin'` row re-saves as `'admin'`, the trigger sees `NEW.role = OLD.role`, and nothing breaks").
- **Steps to reproduce:** a user whose stored `role` is `admin` opens Settings → Profile and presses Save. `ProfileTabV2:198-209` issues `INSERT … ON CONFLICT (id) DO UPDATE SET …, role = excluded.role`.
- **Actual** (per documented Postgres semantics — *"the effects of all per-row BEFORE INSERT triggers are reflected in `excluded` values"*): the **INSERT** branch fires first with `TG_OP = 'INSERT'`, sees `admin`, and sets `NEW.role := NULL` — so `excluded.role` is already `NULL`. The `DO UPDATE` then writes `NULL`, and the BEFORE UPDATE pass sees a non-privileged value and lets it through. **The stored value becomes `NULL`, not `admin`.** The `NEW.role := OLD.role` preservation branch is unreachable on any upsert path.
- **Expected per the docs:** unchanged, with no warning.
- **Impact:** the direction is fail-safe (demotion, never escalation) and production now holds zero privileged rows, so today's blast radius is nil. But two documents assert the opposite behaviour, the `RAISE WARNING` will read "tried to insert profile … set NULL" on what is actually a settings save, and anyone reasoning from the doc later will reason wrongly.
- **Not reproduced live** — no Postgres in this environment. Paper analysis. Add an upsert case (`INSERT … ON CONFLICT DO UPDATE`, not a bare `UPDATE`) to the VERIFICATION block and let the database settle it — see post-apply check 8.

#### D3 — Unicode look-alike and full-width spellings survive the normaliser — **Low**

- **File:** `supabase/migrations/20261002_profiles_role_privilege_guard.sql`, the `incoming :=` expression.
- Cyrillic `аdmin` → `dmin`; Greek `οwner` → `wner`; full-width `ａｄｍｉｎ` → empty string. None match, all stored verbatim. Combining marks *are* handled correctly.
- **Two ways this bites:** (a) a future reader doing `String(role).normalize('NFKC').toLowerCase() === 'admin'` matches the full-width form — the same JS-vs-SQL mismatch as SA finding 1, one level further out; (b) `app/api/admin/onboarding-users/route.ts:56` renders the raw value to an admin screen, where `аdmin` is visually indistinguishable from `admin`.
- Same accepted-residual-risk class as D4. Recorded so the residue is explicit rather than assumed absent.

#### D4 — denylist gaps beyond SA finding 5 — **Low**

`admins`, `adminuser` / `admin_user`, `org_admin`, `site_admin`, `tenant_admin`, `admin1` and `superadministrator` all pass. This is the accepted consequence of SA ruling 1 (a denylist fails open, deliberately) and is fine **only** while "nothing authorizes on `profiles.role`" holds. That guarantee is currently a grep someone ran once. **SA's durable control — a CI check that fails on `profiles.role` compared to a privilege value in TS and on `role = 'admin'`-shaped predicates in `supabase/migrations/*.sql` — is still unwritten.** That check, not the list, is what makes this fix permanent. Track it explicitly on the admin-authz slice rather than leaving it in prose.

#### D5 — the cleanup script's normalisation is not the trigger's, and the "mirror" test does not mirror — **Low**

- **Files:** `scripts/cleanup-profiles-role-admin.ts` — `const normalise = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');` — and the identical line in `components/v2/settings/__tests__/profileRoleOptions.test.ts`.
- The SQL **strips then lowercases**; both JS copies **lowercase then strip**. They diverge on any character whose lowercase folds into ASCII: `'ADMİN'` (U+0130) → JS `admin` (privileged), SQL `admn` (not privileged).
- The script's header claims "Normalisation mirrors the trigger exactly" and the test claims to pin "the *semantics* the two halves have to agree on". Both are false for that class.
- Over-matching is the safe direction for a cleanup script (it would rewrite a row the trigger tolerates), so no harm results — but the claim should be true, or stop being made. **Fix:** `value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()` in both files.

#### D6 — `app/auth/callback/page.tsx:64-73` is an undocumented fourth browser writer of `profiles.role` — **Low**

Inserts `{ id, full_name, role: 'user', created_at, updated_at }` with the anon key. It passes the guard cleanly (INSERT branch, `user` is not privileged), so nothing breaks — but it is the one path that exercises the guard's **INSERT** branch in normal operation, and it appears in neither the workplan nor the migration's "two client paths legitimately write this column". List it, so the next person auditing the write paths sees all four.

#### D7 — documentation drift — **Informational**

- The workplan and its Change History say jest is **45 tests**; the actual run is **51**.
- `ProfileTabV2`'s upsert is at **198-209** (`role:` at 205). The workplan cites "191-207" in one place and "218-229" in another; the migration cites "218-229". All three are off.
- `components/settings/ProfileTab.tsx:40` still labels an option "Administrator" — correctly out of scope (its parent never persists `role`) and already in § Also found; noted only so it is not mistaken for a miss.
- `SET search_path = public, pg_temp` on a `SECURITY INVOKER` function: harmless here (the body references only `pg_catalog` built-ins, which resolve first), but `pg_temp` buys nothing on an invoker-rights function. Cosmetic.

### What can only be proven live

**Every claim about the trigger.** Criterion 5 is BLOCKED and cannot be otherwise: jest cannot run Postgres, this repo has no pgTAP or SQL harness, and there is no local database. Criteria 6–11 are static reads of the SQL, not executions. The migration's VERIFICATION block is the only proof that exists, and it is unrun.

### Post-apply checks — run these, in this order

**Before applying**

0. Fix **D1** first (`polname` → `policyname` in the three places), or item 2 of the PRE-APPLY CHECK errors out.
0b. PRE-APPLY item 4 (the `auth.users` blocker) was already run on production on 2026-09-20 and passed — see § Production evidence. Re-run it against any other environment.

**After applying — SQL, all inside the migration's `BEGIN … ROLLBACK`; writes nothing**

| # | Run | Expect |
|---|---|---|
| 1 | `SELECT tgname FROM pg_trigger WHERE tgrelid='public.profiles'::regclass AND NOT tgisinternal;` | includes `profiles_role_privilege_guard` |
| 2 | VERIFICATION step 1 — `UPDATE … SET role='admin'` as `authenticated` | row **unchanged**, a `WARNING`, **no error** |
| 3 | VERIFICATION step 2 — every padded / separator spelling, **especially `E'\tadmin'`** | row **unchanged** every time. This is the case that proves SA finding 1 actually landed. |
| 4 | VERIFICATION steps 2b / 2c | 2b: all `is_clamped = true`. 2c: all ten personas `is_clamped = false` — including `business_owner`, the row that proves equality over substring. |
| 5 | VERIFICATION steps 3-4 — write `business_owner`, then `viewer` | both **written** |
| 6 | VERIFICATION step 5 — an update with `role` absent from `SET` | succeeds; the guard does not fire |
| 7 | VERIFICATION step 6, as `postgres` | `admin` **is** written |
| 8 | **New, for D2** — as `authenticated`, on a row whose role is already `admin`: `INSERT INTO public.profiles (id, full_name, role) VALUES (:'uid','x','admin') ON CONFLICT (id) DO UPDATE SET full_name = excluded.full_name, role = excluded.role;` then read `role` back | Report what you actually get. The docs say `admin`; QA's analysis says `NULL`. Whichever it is, one of the two documents is wrong and should be corrected. |
| 9 | **New, for D1 / SA ruling 7** — `SELECT schemaname, tablename, policyname, qual, with_check FROM pg_policies WHERE qual ILIKE '%profiles%org_id%' OR with_check ILIKE '%profiles%org_id%';` | expect zero rows. **Any row = a live cross-tenant hole worse than this one.** Report it; do not fix it here. |

**After applying — the two load-bearing live checks, not SQL**

**A. The attack, from a browser console, signed in as an ordinary user.** This is the hole; this is the proof it is closed.

```js
const { data: { user } } = await supabase.auth.getUser();
await supabase.from('profiles').update({ role: 'admin' }).eq('id', user.id);   // expect NO error
const { data } = await supabase.from('profiles').select('role').eq('id', user.id).single();
console.log(data.role);   // expect: your previous role — NOT 'admin'
```

**Pass = the request succeeds *and* the stored value is unchanged.** A thrown error is a **fail** — it would mean the guard is raising instead of clamping, which would break the profile save of every legacy row.

**B. The regressions, in the real UI.** Complete onboarding's role step (pick "Business owner") and confirm the choice persists across a reload; then Settings → Profile, change the role to "Viewer" and Save, and confirm it persists with no error toast. **Pass = both persist, no error.** If either silently reverts, the guard is clamping a legitimate persona and must be rolled back (two statements, in the migration's ROLLBACK block).

### Final status

- [x] Gates pass — tsc at baseline (2034), build exit 0, 51/51 tests green.
- [x] No High-severity defect. 1 Medium (D1), 5 Low (D2–D6), 1 Informational (D7). None blocks the merge.
- [ ] **Acceptance criteria are NOT all proven.** The one criterion that matters — the trigger clamps — is BLOCKED and unprovable without applying the migration.

**Ship recommendation: SHIP THE CODE, WITH D1 FIXED FIRST — AND DO NOT RECORD THE MERGE AS THE FIX.**

The TypeScript is correct, tested, and strictly reduces the surface. But as verified in § The code alone closes nothing, `ProfileTabV2` upserts `profiles` from the browser with the anon key and never touches the API route: **merging this bundle without applying `20261002_profiles_role_privilege_guard.sql` leaves the hole exactly as open as it is today.** D1 is a one-word fix and should land before an operator runs the pre-apply block, because it also disables SA's `org_id` cross-tenant triage query. D2 and D5 are documentation-accuracy defects with a fail-safe direction — fix the prose or fix the code, but do not leave a false claim inside a security migration. D4's CI check is the thing that makes this permanent and belongs on the admin-authz slice with a name attached.

Treat the change as delivered only when check **A** above has been run and returns an unchanged role.

## Commit Info

_(RM to populate. Nothing is committed; the migration is not applied.)_

---

## SA Re-check

**Re-reviewed by SA — 2026-09-20** (delta only: the normaliser, D1–D7, and the new cleanup script)
**Status:** ✅ **APPROVED** — three Low doc/verification items to fix before RM commits. None block QA or the migration.
**Migration go/no-go:** ✅ **GO — unchanged**, still conditional on PRE-APPLY item 4 (`auth.users` triggers) returning nothing that copies a signup-supplied role into `profiles`. **One new pre-apply line is now required — see R1.**

### Verified in the delta

| Item | Finding |
|---|---|
| **Normaliser** (`:288`) | `lower(regexp_replace(normalize(coalesce(NEW.role, ''), NFKC), '[^a-zA-Z0-9]', '', 'g'))` is correct. `normalize(text, NFKC)` takes the form as a bare keyword (not a quoted literal) — the syntax here is right; PG13+, Supabase is 15. `coalesce` makes NULL safe, `''` normalises to `''`, and a stored `text` value cannot hold an invalid byte sequence, so there is no input that errors — **except one, R1 below**. **The order is not merely defensible, it is the better of the two:** stripping before lowering means `lower()` only ever sees ASCII, which makes it locale-independent. Lowercasing first would expose it to ICU/Turkish `I`/`İ` behaviour — the D5 divergence — and to the same class for any future locale change. Keep this order and keep the comment explaining it. My finding 1 from the first pass is closed; my finding 5 is closed (list rewritten in normalised form, `staff`/`moderator` correctly *not* added — they are plausible job labels and no codebase reader would check them). |
| **D3 residual** | Confirmed: NFKC folds compatibility variants, not confusables. Cyrillic `аdmin` → `dmin`, Greek `ΑDMIN` → `dmin`, both stored verbatim. **Accepting this is right, and for a stronger reason than the block states:** the surviving spellings are precisely the ones a naive future reader would *also* fail to match — `'аdmin' === 'admin'` is false in JavaScript too. The residual is therefore a gap in the second lock that is only reachable by a reader that deliberately does confusable folding, which nothing does. Same for `admins` / `adminuser` / `orgadmin`. |
| **D2 — upsert wipe** | Mechanism confirmed: `INSERT … ON CONFLICT DO UPDATE` fires BEFORE INSERT against the proposed row first, `excluded` is built from what this trigger returned, so the subsequent UPDATE branch sees a non-privileged value and lets the NULL through. **Ruling: keep the wipe.** Preserving would put a `SELECT` and a race inside a BEFORE INSERT trigger on the signup path to conserve the single value this migration exists to remove — that is a worse trade in both directions. Worth naming what it implies, because it is not obvious: since `ProfileTabV2` and `useOnboarding` both *upsert*, the UPDATE branch's careful "re-saving an existing admin is a no-op, not a demotion" logic is effectively unreachable from the browser. The wipe is the real behaviour for every client path. The census result (3 rows found, all cleared, re-census zero) makes it moot in practice. Documentation is now honest in the INSERT branch and in § WHAT IS NOT CHANGED — but see R2. |
| **D1** | `policyname` is correct for the `pg_policies` **view**, and the selected column sets are valid in all three queries. **Spot-checked the `org_id` triage query specifically:** `SELECT schemaname, tablename, policyname, qual, with_check FROM pg_policies WHERE qual ILIKE '%profiles%org_id%' OR with_check ILIKE '%profiles%org_id%';` runs and matches correctly (`qual`/`with_check` are text; a NULL `with_check` is handled by the `OR`). One limit to state when reporting the result: it matches *policy text*, so a policy that reaches `profiles.org_id` through a helper function would not appear. Zero rows is strong evidence, not proof. |
| **D6** | Verified at `app/auth/callback/page.tsx:64-73`. It `INSERT`s only when no profile exists, hard-codes `role: 'user'`, and the only `user_metadata` value it reads is `full_name`. It cannot write a privileged role, and the guard passes `'user'` through untouched. Correct, and correctly left otherwise alone — it is not a file this change edits, so its `console.*` calls stay out of scope. |
| **New file** `scripts/cleanup-profiles-role-admin.ts` | Not in the reported delta; reviewed anyway. It is a trace of an already-executed action, idempotent, and its JS normaliser (`:98`) mirrors the SQL in the same order. No secrets, no service-role client committed. Acceptable as a committed record. One stale sentence — R2. |

### Must fix before commit (all Low)

**R1 — add `SHOW server_encoding;` to the PRE-APPLY CHECK. This is the one new risk the delta introduces.**
`normalize()` raises `ERROR: Unicode normalization can only be performed if server encoding is UTF8`. The previous expression (`btrim`/`lower`/`regexp_replace`) could not error on any input; this one can, and it would do so *inside a BEFORE INSERT OR UPDATE trigger* — meaning every profile write, including signup, would hard-fail rather than fail safe. Supabase provisions UTF8, so the expected answer is `UTF8` and this is a ten-second confirmation — but it is now the difference between "silently clamps" and "breaks account creation", so it belongs in the pre-apply block, not in assumed knowledge.

**R2 — two stale "preserves" sentences survived the D2 correction.**
`supabase/migrations/20261002_profiles_role_privilege_guard.sql:147-148` (PRE-APPLY item 3: *"This migration PRESERVES them … they are reported, not cleaned"*) and `scripts/cleanup-profiles-role-admin.ts:29` (*"it preserves existing rows so it cannot destroy data"*). Both now contradict the INSERT branch and § WHAT IS NOT CHANGED, and the second sits in the file whose own header records that the rows *were* cleared. D2 fixed the claim in three places and missed these two.

**R3 — the inherited normaliser rule is stated well but stored where a stranger will not find it.**
The ACCEPTED RESIDUAL RISK block (`:356-390`) is the right content — it names the rule, gives the reason, and cites D5 as the proof that drift is the vulnerability. But it lives at line 356 of a migration nobody reopens after it is applied. Put one sentence in **`docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md`** — the doc CLAUDE.md § Security Rules already points every admin-authz task at — saying: *any code that reads `profiles.role` for a privilege-ish decision must use the normaliser in `20261002_profiles_role_privilege_guard.sql`, never its own; the column is a label and this is the only reason it is safe.* That is the one place a reader who did not follow this thread will actually pass through. The CI check itself stays with the admin-authz slice; **that ownership is correct** — it is the same slice that owns `admin_users`, `requireAdminRoute`, and the ~34 unguarded admin routes, and a grep-level lint on `profiles.role` naturally lives with them rather than here.

### Everything else

Gates accepted as reported (tsc at the 2034 baseline, build 295/295, 58 tests). My earlier findings 2 (`console.*` in `ProfileTabV2`) and 3 (`auth.users` pre-apply query) are closed. Findings 4 (`user_metadata.role` fallback in `lib/user-context/builders.ts:31`), 6 (Zod + repository on the profile route) and 7 (migration filename drift) remain open and correctly deferred. The post-apply checks in my first pass stand as written, plus the `server_encoding` line from R1 moved to the front.

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-20 | Created | Workplan for the `profiles.role` self-promotion fix |
| 2026-09-20 | SA delta re-check — APPROVED | Three Low items fixed. **R1**: `SHOW server_encoding;` added to the PRE-APPLY CHECK (expect UTF8, with an explicit STOP and the two ways out), **and** the normalisation wrapped in an exception block falling back to the pre-NFKC expression — `normalize()` can error on a non-UTF8 server and the trigger is on the signup path, so it must fail degraded, never fail open or fail signup. **R2**: the two surviving "preserves existing rows" sentences corrected (migration PRE-APPLY item 3; cleanup script header, where it contradicted the very rows the file records clearing). **R3**: the inherited-normaliser rule carried into `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md`, plus a correction there of the stale "nothing reads `profiles.role` for access" claim (the dropped `system_settings_config` policy and the profile PUT both trusted it) and of lifecycle scenario 4. Gates: tsc 2034 = baseline, build exit 0, jest 2 suites / 58 tests. |
| 2026-09-20 | QA defects addressed | D1 **fixed** (`polname` → `policyname` in all three operator-facing queries, column names verified against the `pg_policies` view and the working sibling query, not recalled). D2 **decided**: keep the upsert wipe — preserving would need a SELECT of the existing row inside a BEFORE INSERT trigger on every signup, a read and a race spent conserving the one value the migration exists to remove — and correct all four places that claimed "preserved"; new verification step 5b exercises the real `ON CONFLICT DO UPDATE` shape and expects `(null)`. D4 **closed** by `normalize(…, NFKC)` (measured: folds full-width `ａｄｍｉｎ` → `admin`); D3 **accepted** — NFKC folds compatibility variants, not confusables, so Cyrillic/Greek homoglyphs and the unlisted neighbours stay, now written up as ACCEPTED RESIDUAL RISK with the rule that any future reader must use *this* normaliser, and handed to the admin-authz slice with SA's CI check. D5 **fixed**: both mirrors now NFKC → strip → lower, the SQL's order (`ADMİN` was the divergence). D6 **fixed**: writer inventory added; `auth/callback` confirmed unable to write a privileged role (hard-coded `'user'`). D7 drift fixed (51 tests; `ProfileTabV2:198-209`). Gates: tsc 2034 = baseline, build exit 0, jest 2 suites / 58 tests. |
| 2026-09-20 | **Recorded function body corrected** | The `create_user_settings()` body under "Production evidence" was shown with `ON CONFLICT … DO NOTHING` on all four INSERTs; **the live function has none**. Caught while codifying the trigger as a repo migration (PR #71), by re-reading `pg_get_functiondef` before writing the file — a migration built from the text here would have added those clauses to the live signup path. The section's own finding is unaffected (the function writes `id` only, never `raw_user_meta_data` or `role`, in both versions), so the guard migration this evidence cleared stays correctly applied. Noted for reuse elsewhere: without `ON CONFLICT`, a conflict aborts the whole signup, so signup fails closed — which is why no `auth.users` row created since the trigger can lack its `profiles` row (relied on by PR #70), and why adding idempotency would be a production change. |
| 2026-09-20 | Production evidence recorded | Pre-apply check run on production and **passed** — the only two triggers (`create_user_settings_trigger` on `auth.users`, `update_profiles_updated_at` on `profiles`) touch `role` in neither body, so SA finding 3's bypass does not exist and the migration is cleared to apply; both function bodies and the trigger-ordering analysis recorded. Census before cleanup: `admin` × 3, of which 2 were real `admin_users` — one was not. User cleared all three to `'user'`; re-census returned zero rows. Cleanup added to the repo as `scripts/cleanup-profiles-role-admin.ts` (idempotent, dry-run by default), kept out of the migration on purpose. Decisions (b) role picker and (c) `org_id` rewrite logged as still open. |
| 2026-09-20 | SA review addressed | Findings 1, 2, 3 and 5 fixed: normalisation moved from `btrim` to stripping every non-alphanumeric character (equality kept, so `business_owner` ⊃ `owner` does not clamp); both `ProfileTabV2` `console.error` calls converted to `clientLogger`; the `auth.users` trigger + function-body queries carried **inline** in the migration's PRE-APPLY CHECK as the blocking item 4; four privileged synonyms added, `staff`/`moderator` deliberately excluded. Tests extended for the padded/separator spellings. Gates re-run: tsc 2034 = baseline, build ✓, jest 2 suites / 51 tests passed. |
| 2026-09-20 | SA code review | APPROVED WITH CHANGES - 3 must-fix (btrim whitespace bypass; 2 leftover console.* in ProfileTabV2; pre-apply check misses auth.users triggers). Denylist design upheld, current_user upheld. Migration GO, conditional on the auth.users query. |
| 2026-09-20 | QA test report | Gates run by QA: `tsc` exit 0 at the **2034** baseline (no new errors; the 3 in `app/api/user/profile/route.ts` are the pre-existing ones, shifted to 230/239/241 by the Pino conversion), `npm run build` exit 0 (compiled, 295 pages), `npx jest app/api/user/profile components/v2/settings` 2 suites / **51** tests green. 17 criteria assessed: **14 PASS, 2 PARTIAL/FAIL, 1 BLOCKED**. The trigger is unprovable here (no Postgres, no pgTAP) - criterion 5 BLOCKED, live-only. Confirmed that `ProfileTabV2:198-209` upserts `profiles` with the browser anon key and never calls the route, so the code merge closes nothing without the migration. Normaliser attacked on paper and in Node: padding, separators and combining marks are all clamped; all 8 personas + `user`/`viewer` pass with zero false clamps; `= ANY` proven to be equality in the SQL itself. 7 defects: **D1 Medium** (`pg_policies` has no `polname` - breaks the PRE-APPLY CHECK and SA's `org_id` triage query in 3 places), D2-D6 Low (a PostgREST upsert wipes a legacy privileged role to NULL vs the documented 'preserved'; Unicode homoglyph / full-width spellings survive; denylist gaps with the CI check still unwritten; the cleanup script normalises in the opposite order to the SQL; an undocumented 4th browser writer at `app/auth/callback/page.tsx:66`), D7 informational drift. Ship the code with D1 fixed; the fix is not delivered until the migration is applied and post-apply check A returns an unchanged role. |
| 2026-09-20 | SA re-check (delta) | APPROVED. Normaliser expression, order (strip-before-lower is locale-safe) and NFKC availability verified; D2 upsert wipe upheld; D1 policyname + org_id triage query spot-checked; D6 auth/callback confirmed unable to write a privileged role. 3 Low must-fix before commit: R1 add SHOW server_encoding to PRE-APPLY (normalize() can ERROR inside the trigger on a non-UTF8 server and would hard-fail signup), R2 two stale "preserves" sentences (migration :147, cleanup script :29), R3 port the inherited-normaliser rule into ADMIN_IDENTIFICATION_AND_ACCESS.md. Migration go/no-go unchanged: GO. |
