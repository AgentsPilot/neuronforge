# `supabase/held/` — migrations deliberately NOT in the apply path

> **Last Updated**: 2026-10-05

## Overview

Files in this directory are **written and reviewed, but must not be applied yet**. They live outside `supabase/migrations/` on purpose: this repo has `supabase/config.toml`, so a bulk `supabase db push` applies everything in `migrations/` regardless of what any file's header comment says. A "DO NOT APPLY" comment is not a control. Moving the file out of the apply path is.

A held migration is **a hold kept by people, not by the system.** This README is where that hold is written down, with the exact condition for releasing it.

---

## Currently held

| File | Held until | Why |
|---|---|---|
| `20260916b_purge_business_data.sql` (slice 2 Reset **and** slice 3 Purge — extended in place 2026-10-05 with delete-graph controls 5, 6 and 7) | **The `service_role` key is rotated** — see the release checklist below | The function is a single-call, transactional, correctly-ordered delete of one business's data. PostgREST exposes it to anyone holding the `service_role` key. As of 2026-09-16 that key is published in a tracked file (`docs/VERCEL_DEPLOYMENT_SETUP.md`, line 19) on the **public** `origin/main`. Every guard the purge feature has lives in the TypeScript layer above the function, and none of them applies to a direct PostgREST call. Applying it before rotation turns a known credential leak into a remote "delete any business by user id" endpoint |

---

## Releasing `20260916b_purge_business_data.sql` — in order

Do these in order. Each one is a check on the one before it; skipping ahead is how a step that silently failed goes unnoticed.

> **This list is duplicated in the workplan's Parking State (C-40).** If you change one, change the other — two copies of a checklist drifting apart is the same failure this feature has already shipped three times in its UI copy.

1. **Rotate the `service_role` key** in the Supabase dashboard.
2. **Update the key** in Vercel and in `.env.local`.
3. **Confirm the OLD key is actually rejected.** Rotation that hasn't taken is indistinguishable from rotation that has, until you test it. The old key's hash starts `sha256[:12] = 0b022ec57c77`; a request made with it should now fail authentication.
4. **Remove the key from `docs/VERCEL_DEPLOYMENT_SETUP.md`.** On its own this does nothing — the old key is in public git history, which is why rotation comes first — but the file should stop publishing whatever key replaces it.
5. **Move the file back:** `supabase/held/20260916b_purge_business_data.sql` → `supabase/migrations/`.
6. **Apply it** in the Supabase SQL editor.
7. **Reload PostgREST's schema cache:**
   ```sql
   NOTIFY pgrst, 'reload schema';
   ```
   ⚠️ **Do not skip this.** Until PostgREST reloads, the API still cannot see the new function. Reset keeps refusing with `rpc_not_applied`, the page keeps saying so, and it looks exactly like a bug in the migration when it is only a stale cache.
8. **Confirm the probe sees it.** `purgeFunctionExists()` should now return `true`.
   **Then confirm it is the slice-3 body** (SA 3b, logged 2026-10-05): the probe is version-blind, so it also returns `true` for a slice-2 body without the graph controls. Run `SELECT pg_get_functiondef('purge_business_data(uuid, text, jsonb, jsonb)'::regprocedure) LIKE '%control 7%';` and expect `true` before trusting the LIVE banner.
9. **Confirm the Danger Zone banner says Reset and Purge are LIVE.** It is driven by the same probe, so if step 8 passed and the banner still says "function not applied", the page is reading a stale response — reload it.
10. **Run a Reset preview and confirm the preview panel AGREES with the banner.** Its first line must read *"⚠️ RESET IS LIVE…"* (a Purge preview reads *"⚠️ PURGE IS LIVE…"*). Both are driven by the same probe; if they disagree, stop — something is reading a stale response.

    **Then run a Purge preview (every option off) and confirm the delete-graph verdict reads CLEAN.** The same graph rules run again inside the function (controls 5 and 6), so a preview that is not clean means the commit will refuse. With *integrations* or *activity history* ticked it must also read CLEAN. (There is no agents option: a purge never deletes agents.)
11. **First Reset on the owner's own test data only** — a throwaway account, never a real login — and compare the result against the demonstration snapshot already in the bucket (`868fda6a-…/2026-09-16T16-31-09-257Z.json`).

    ⚠️ **The numbers will not match exactly, and that is not a bug.** The demo snapshot recorded **75 rows**; a later preview showed **74**. The difference is `external_calendar_events`, which changes as calendar data syncs. Compare per table: drift confined to `external_calendar_events` is expected; a mismatch in contacts, invoices or bookings is worth investigating.

Then delete this row from the table above.

> **Static proofs (CI).** `supabase/held/__tests__/purgeBusinessData.held.test.ts` fails if any file under `supabase/migrations/` defines or grants `purge_business_data`, if this README stops listing the file, or if the held function loses its revokes, its service_role-only grant, its transaction-scoped lock, or controls 5–7 ahead of the lock. Step 5 above (moving the file) is expected to turn I-1 red: move the test's assertion in the same PR that releases the hold.
