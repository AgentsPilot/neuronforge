/**
 * GET /api/admin/admins — who can open admin, read-only.
 *
 * Backs the "Admin users" page (`app/admin/settings/page.tsx`).
 * ADMIN_BOS_CLEANUP slice 1, conditions C-1 to C-3.
 *
 * ── The gate ──────────────────────────────────────────────────────────────
 * `requireAdmin` is the FIRST statement inside the handler's `try`. Nothing
 * above it touches the request, the database or the environment. It owns the
 * 401/403 split and fails closed. The CI guard proves the gate is present; its
 * position is pinned by this route's own test (R-9) and the shared denial list.
 *
 * ── What it returns ───────────────────────────────────────────────────────
 * - `tableAdmins`: every ACTIVE row of `admin_users`, in `created_at` order.
 * - `envOnlyAdmins`: addresses in `ADMIN_EMAILS` with no active row. That
 *   includes an address whose row was DEACTIVATED: the access check still
 *   grants it through the environment setting, so listing it is the truth.
 * - A table admin who is also in `ADMIN_EMAILS` is listed once, with
 *   `alsoInEnv: true`: removing the row alone does not revoke their access.
 * Emails are compared trimmed and lowercased on both sides through one helper,
 * because a hand-inserted row can be mixed case (SA W-4).
 *
 * The body is built by explicit field picking. The row `id`, `user_id`,
 * `granted_by`, `updated_at`, `is_active` and any profile or auth data never
 * leave this file (C-3).
 *
 * ── Why the repository, not the admin access service ──────────────────────
 * Guard rule R2 forbids a route file from naming the service, and the service's
 * list method returns an empty list on a database error, which would make the
 * page say "no admins" when the read failed. So this reads
 * `adminUserRepository.listActive()` directly and answers a failed read with a
 * 500, never with an empty list.
 *
 * ── Service role, by design ───────────────────────────────────────────────
 * The repository uses the service-role client (documented in its header): this
 * is a cross-account admin list behind `requireAdmin`. There is no
 * caller-supplied id, so there is nothing to scope to a user.
 *
 * ── No input ──────────────────────────────────────────────────────────────
 * No query, params or body is read, so there is no Zod schema: query strings
 * are ignored, not parsed. Any future parameter gets a Zod schema first. No
 * audit event: a read is not a state change.
 *
 * Logs carry counts only, never an address.
 *
 * @see docs/workplans/ADMIN_BOS_CLEANUP_SLICE_1_WORKPLAN.md
 * @see docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md § Bootstrapping Admins
 */

import { NextRequest, NextResponse } from 'next/server';

import { readEnvAdminEmails } from '@/lib/admin/adminEmailsEnv';
import type {
  AdminListData,
  AdminListEnvEntry,
  AdminListTableEntry,
} from '@/lib/admin/adminList-types';
import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';
import { adminUserRepository } from '@/lib/repositories/AdminUserRepository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'AdminAdminsAPI' });

const LOAD_FAILED = 'Failed to load admin list';

/** The one normaliser for both sides of the table/env comparison (SA W-4). */
function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

function failure(err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json(
    {
      success: false,
      error: LOAD_FAILED,
      details: process.env.NODE_ENV === 'development' ? message : undefined,
    },
    { status: 500 }
  );
}

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // FIRST statement: nothing above touches the request body, the database or the env.
    const gate = await requireAdmin(requestLogger);
    if (gate instanceof NextResponse) return gate;

    const { data: rows, error } = await adminUserRepository.listActive();
    if (error || rows === null) {
      // A failed read is an error, never an empty list (B-6).
      requestLogger.error({ err: error }, LOAD_FAILED);
      return failure(error ?? new Error('Admin list missing without an error'));
    }

    const envEmails = new Set([...readEnvAdminEmails()].map(normaliseEmail));
    const tableEmails = new Set<string>();

    const tableAdmins: AdminListTableEntry[] = rows.map((row) => {
      const key = normaliseEmail(row.email);
      tableEmails.add(key);
      return {
        email: row.email,
        linkedToLogin: row.user_id !== null,
        addedAt: row.created_at,
        notes: row.notes,
        alsoInEnv: envEmails.has(key),
      };
    });

    const envOnlyAdmins: AdminListEnvEntry[] = [...envEmails]
      .filter((email) => !tableEmails.has(email))
      .sort()
      .map((email) => ({ email }));

    const data: AdminListData = { tableAdmins, envOnlyAdmins };

    // Counts only: never an address.
    requestLogger.info(
      {
        tableCount: tableAdmins.length,
        envOnlyCount: envOnlyAdmins.length,
        overlapCount: tableAdmins.filter((entry) => entry.alsoInEnv).length,
      },
      'Admin list served'
    );

    return NextResponse.json({ success: true, data });
  } catch (err) {
    requestLogger.error({ err }, 'Unexpected error while building the admin list');
    return failure(err);
  }
}
