# Test-Account Cleanup: the replaces_meeting_id Link (G-18) — Workplan

> **Last Updated**: 2026-10-30

## Overview

Migration `20261097_a_session_knows_what_it_replaced.sql` (scheduling, outside the cleanup generator) added `scheduling_meetings.replaces_meeting_id → scheduling_meetings(id) ON DELETE SET NULL`. The cleanup function's G-18 guard refuses any link into a table it empties that `INBOUND_FOREIGN_KEYS` has not reviewed, so on prod **every** check, hard delete and anonymise is refused. The admin and the owner self-delete paths both run this function. This was first seen live on 2026-10-30, in the admin check of the closurespike test account.

It is the same class of failure as [20261092](/docs/workplans/TEST_ACCOUNT_CLEANUP_MEETINGS_FK_FIX_WORKPLAN.md), and it gets the same fix.

---

## Change

| File | Change |
|---|---|
| `scripts/generate-test-account-cleanup-sql.ts` | One `INBOUND_FOREIGN_KEYS` row: `['scheduling_meetings', 'scheduling_meetings_replaces_meeting_id_fkey', 'user_id']`. `FUNCTION_MIGRATION` → `20261101_operator_test_account_cleanup_meeting_replaces`, previous → `20261096`. History, purpose and rollback text. |
| Generated | `scripts/test-account-cleanup-{check,delete}.sql`, the 20261101 migration and rollback, and `cleanupFunctionVersion.generated.ts` (stamp `b1203c526bc9ec91` → `41d799d7a76e829b`). |
| `scripts/precheck-test-account-cleanup-meeting-replaces.sql` | Read-only pre-check (4 rows). |
| `scripts/check-test-account-cleanup-meeting-replaces-migration.sql` | Read-only checker (8 rows; row 8 is the md5 operator gate). |
| `scripts/__tests__/testAccountCleanupSql.test.ts` | 20261096 moves to APPLIED and its block is frozen to literals. 20261101 is pinned as the target. A new block proves the body is the 96 body plus the review row and the new stamp, and nothing else. |

Owner column `user_id`: a meeting of **another** account whose `replaces_meeting_id` points at a meeting of the target blocks. The target's own self-links are removed with the meetings.

---

## Apply Plan (PROD)

1. **Pre-check:** run `scripts/precheck-test-account-cleanup-meeting-replaces.sql`. Rows 1–4 must be ok. *Done 2026-10-30: 4/4 ok.*
2. **Apply** `supabase/migrations/20261101_operator_test_account_cleanup_meeting_replaces.sql` (pasted by the user). It runs in one transaction.
3. **Checker:** run `scripts/check-test-account-cleanup-meeting-replaces-migration.sql`. Rows 1–8 must be ok.
4. **Merge and deploy fast.** Between steps 2 and 4, the deployed build pins `b1203c526bc9ec91` and the function returns `41d799d7a76e829b`. The Danger Zone and the self-delete then refuse on the version stamp. That is fail-closed, but keep it short. The PR is migration-gated, so merge it by hand, not with auto-merge.
5. Run an admin check on the closurespike account. G-18 must be absent.

**Rollback:** run `supabase/SQL Scripts/20261101_…_rollback.sql`, then redeploy a build that pins `b1203c526bc9ec91`. G-18 then refuses again.

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-30 | Created | G-18 blocked every cleanup on prod after 20261097. The fix is 20261101; the pre-check ran ok on prod. |
