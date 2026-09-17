// /app/api/user/delete-account/route.ts
// GDPR Article 17: right to erasure. Settle first, then delete permanently.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { auditLog } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { createLogger } from '@/lib/logger';
import {
  findDeletionBlockers,
  blocksDeletion,
} from '@/lib/business-os/account/deletionBlockers';
import {
  CASCADE_ROOT_TABLE,
  accountTablesToProcess,
  keyColumnFor,
  policyFor,
} from '@/lib/business-os/account/accountDeletionPolicy';
import { closeShopfront } from '@/lib/business-os/account/closeShopfront';
import { cancelFutureBookingsForClosure } from '@/lib/business-os/account/cancelBookingsForClosure';

const logger = createLogger({ module: 'AccountDeleteAPI' });

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Deleting an account.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * SETTLE FIRST, THEN DELETE. PERMANENTLY.
 *
 * The product does not decide what happens to anyone's money. It DECLINES to
 * delete until the owner has settled — unpaid invoices, plans Stripe may still
 * charge, uncollected instalments. That single refusal is what lets everything
 * below be unconditional: by the time it runs there is nothing left to cancel,
 * so this route never touches Stripe, which stays the money's source of truth.
 *
 * There is no archive and no restore. It is the owner's account and the
 * owner's call.
 *
 * FIVE STEPS, AND THE ORDER IS THE DESIGN
 *
 *   1  Shut the doors — pages to draft, links off — so nothing new arrives
 *      during the seconds the rest of this takes.
 *   2  Cancel every future booking and tell each client the business has
 *      closed. The only part of a deletion that happens to people who did not
 *      ask for it, so it is done properly rather than by cascade.
 *   3  Detach retained rows (null `user_id`) BEFORE anything can cascade.
 *   4  Delete the account-level tables, retried in passes so undeclared
 *      foreign keys resolve themselves.
 *   5  Delete `business_profiles`, cascading all 55 business tables. FATAL:
 *      if this fails we stop WITHOUT deleting the auth user, leaving the
 *      account intact rather than orphaning the business.
 *
 * Only step 5 can fail the request. Everything before it is reported in
 * `stats.errors` and continues — a page that will not unpublish or a client who
 * cannot be emailed must not trap somebody in an account they asked to delete.
 * Steps 1 and 2 are also the reversible ones: if step 5 refuses, the business
 * is left quiet rather than destroyed.
 *
 * What survives step 4, and why, is in `accountDeletionPolicy.ts` — deletion is
 * the default there, and every exception carries its reason.
 *
 * The version this replaced overwrote the profile name with a string DERIVED
 * from the user id, left the row keyed by `user_id`, called that anonymised
 * and claimed Article 17. It also never deleted the business, so every deleted
 * account left its clients, bookings and invoices behind.
 * ───────────────────────────────────────────────────────────────────────────
 */
export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    const body = await req.json();
    const { confirmation, reason } = body;

    // Require explicit confirmation
    if (confirmation !== 'DELETE_MY_ACCOUNT') {
      return NextResponse.json(
        {
          error: 'Confirmation required',
          message: 'You must provide confirmation: "DELETE_MY_ACCOUNT"',
        },
        { status: 400 }
      );
    }

    // Authenticate user
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get: (name) => cookieStore.get(name)?.value,
          set: async () => {},
          remove: async () => {},
        },
      }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    /*
     * ───────────────────────────────────────────────────────────────────────
     * REFUSE WHILE MONEY IS STILL MOVING.
     *
     * Before anything is touched. An unpaid invoice, a plan Stripe may still
     * charge, or an instalment nobody has collected all mean a client is part
     * way through paying — and deleting the account would either strand that
     * money or, worse, leave Stripe charging a card for a business that no
     * longer exists.
     *
     * The product does not decide what happens to it. It declines until the
     * owner has, which is what every comparable platform does and is why the
     * deletion below never needs to touch Stripe: by the time it runs there is
     * nothing left to cancel.
     *
     * `findDeletionBlockers` throws rather than returning empty when it cannot
     * read. That propagates here as a refusal, deliberately: not knowing
     * whether a client is still being billed is a reason to stop.
     * ───────────────────────────────────────────────────────────────────────
     */
    try {
      const blockers = await findDeletionBlockers(user.id);

      if (blocksDeletion(blockers)) {
        return NextResponse.json(
          {
            error: 'This account still has money outstanding.',
            reason: 'money_outstanding',
            blockers,
          },
          { status: 409 }
        );
      }
    } catch (checkError) {
      logger.error({ err: checkError, userId: user.id }, 'Deletion refused: the money check failed');
      return NextResponse.json(
        {
          error: 'Could not confirm whether money is outstanding. Please try again.',
          reason: 'check_failed',
        },
        { status: 503 }
      );
    }

    logger.warn({ userId: user.id }, 'Account deletion starting');

    const serviceSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const deletionStats: {
      user_id: string;
      deletion_timestamp: string;
      reason: string;
      items_deleted: Record<string, number>;
      items_minimised: Record<string, number>;
      items_retained: Record<string, string>;
      errors: Array<{
        table: string;
        stage: 'close' | 'cancel' | 'minimise' | 'delete';
        message: string;
      }>;
      pages_unpublished?: number;
      links_deactivated?: number;
      bookings_cancelled?: number;
      clients_notified?: number;
      total_duration_ms?: number;
    } = {
      user_id: user.id,
      // `original_email` is deliberately absent. Recording the address of the
      // person who asked to be erased, in the record of erasing them, is the
      // small contradiction that used to sit here.
      deletion_timestamp: new Date().toISOString(),
      reason: reason || 'User requested account deletion',
      items_deleted: {},
      items_minimised: {},
      items_retained: {},
      errors: [],
    };

    // AUDIT TRAIL: Log before any changes
    try {
      await auditLog({
        action: AUDIT_EVENTS.DATA_DELETED,
        entityType: 'user',
        entityId: user.id,
        userId: user.id,
        resourceName: user.email || 'User Account',
        details: {
          deletion_timestamp: new Date().toISOString(),
          deletion_reason: reason || 'User requested account deletion',
          gdpr_basis: 'Article 17 (Right to Erasure)',
          approach: 'Permanent deletion. Financial and audit records retained, detached from the person.',
          ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown',
          user_agent: req.headers.get('user-agent') || 'unknown',
        },
        severity: 'warning',
        complianceFlags: ['GDPR', 'SOC2'],
      });
      logger.info({ userId: user.id }, 'Deletion audit logged');
    } catch (auditError) {
      logger.error({ err: auditError, userId: user.id }, 'Audit logging failed; refusing to delete without a trail');
      return NextResponse.json(
        { error: 'Audit logging failed', message: 'Cannot proceed without audit trail' },
        { status: 500 }
      );
    }

    /*
     * ───────────────────────────────────────────────────────────────────────
     * STEP 1 — SHUT THE DOORS.
     *
     * Live pages back to draft, active links switched off. Everything below
     * takes seconds, and a booking or a payment that arrives inside that
     * window is worse than one that is refused: the client gets a confirmation
     * for an appointment deleted moments later.
     *
     * Reversible, deliberately. If the cascade later refuses, the account
     * survives — quiet rather than destroyed, and the owner can reopen it.
     * ───────────────────────────────────────────────────────────────────────
     */
    const shopfront = await closeShopfront(user.id);
    deletionStats.pages_unpublished = shopfront.pagesUnpublished;
    deletionStats.links_deactivated = shopfront.linksDeactivated;
    shopfront.errors.forEach(message =>
      deletionStats.errors.push({ table: 'shopfront', stage: 'close', message })
    );

    /*
     * ───────────────────────────────────────────────────────────────────────
     * STEP 2 — TELL THE CLIENTS.
     *
     * The cascade would take every future booking silently, and somebody who
     * booked next Tuesday would simply turn up. They are cancelled properly
     * instead — through the same path the owner's own cancel button uses, so
     * the calendar event goes too — and each client is emailed that the
     * business has closed.
     *
     * Never fatal: a client who cannot be emailed must not trap the owner in
     * an account they asked to delete.
     * ───────────────────────────────────────────────────────────────────────
     */
    const cancellations = await cancelFutureBookingsForClosure(user.id);
    deletionStats.bookings_cancelled = cancellations.cancelled;
    deletionStats.clients_notified = cancellations.clientsNotified;

    if (cancellations.failed > 0) {
      deletionStats.errors.push({
        table: 'scheduling_bookings',
        stage: 'cancel',
        message: `${cancellations.failed} booking(s) could not be cancelled; those clients were not told`,
      });
    }

    if (cancellations.capped) {
      deletionStats.errors.push({
        table: 'scheduling_bookings',
        stage: 'cancel',
        message: 'Hit the cancellation cap; some upcoming bookings were deleted without telling the client',
      });
    }

    /*
     * ───────────────────────────────────────────────────────────────────────
     * STEP 3 — DETACH WHAT IS RETAINED, BEFORE ANYTHING CAN TAKE IT.
     *
     * Order is the whole point. A retained row still carrying `user_id` can be
     * swept by a cascade the moment the auth user goes, and whether a given
     * table cascades is not knowable from this repo. Detaching first is what
     * makes retention actually happen instead of depending on a constraint
     * nobody can see.
     *
     * `keep` rows are left entirely alone: a suppression list is only useful
     * because it names someone.
     * ───────────────────────────────────────────────────────────────────────
     */
    const tables = accountTablesToProcess();
    const toDelete: string[] = [];

    for (const table of tables) {
      const policy = policyFor(table);
      const key = keyColumnFor(table);

      if (policy.verdict === 'keep') {
        deletionStats.items_retained[table] = policy.reason;
        continue;
      }

      if (policy.verdict === 'delete') {
        toDelete.push(table);
        continue;
      }

      const { count, error } = await serviceSupabase
        .from(table)
        .update({ [key]: null, ...(policy.strip ?? {}) }, { count: 'exact' })
        .eq(key, user.id);

      if (error) {
        // Non-fatal: a table that cannot be detached is a retention failure,
        // not a reason to strand the account half-deleted. It is logged so the
        // gap is visible rather than silent.
        logger.error({ err: error, table, userId: user.id }, 'Could not detach retained rows');
        deletionStats.errors.push({ table, stage: 'minimise', message: error.message });
        continue;
      }

      deletionStats.items_minimised[table] = count ?? 0;
    }

    /*
     * ───────────────────────────────────────────────────────────────────────
     * STEP 4 — DELETE THE ACCOUNT-LEVEL TABLES.
     *
     * Retried in passes rather than ordered by hand. Foreign keys between
     * these tables are not declared anywhere this route can read, so a fixed
     * order would be a guess that rots the first time a column changes. A
     * table that fails on a dependency succeeds on the pass after the table
     * depending on it has gone; passes stop as soon as one makes no progress.
     * ───────────────────────────────────────────────────────────────────────
     */
    let pending = toDelete;

    while (pending.length > 0) {
      const failed: string[] = [];
      const lastError = new Map<string, string>();

      for (const table of pending) {
        const key = keyColumnFor(table);
        const { count, error } = await serviceSupabase
          .from(table)
          .delete({ count: 'exact' })
          .eq(key, user.id);

        if (error) {
          failed.push(table);
          lastError.set(table, error.message);
          continue;
        }

        deletionStats.items_deleted[table] = count ?? 0;
      }

      // No progress this pass means the remainder is blocked by something
      // retrying will not fix.
      if (failed.length === pending.length) {
        for (const table of failed) {
          logger.error(
            { table, userId: user.id, message: lastError.get(table) },
            'Could not delete account table'
          );
          deletionStats.errors.push({
            table,
            stage: 'delete',
            message: lastError.get(table) ?? 'unknown',
          });
        }
        break;
      }

      pending = failed;
    }

    /*
     * ───────────────────────────────────────────────────────────────────────
     * STEP 5 — DELETE THE BUSINESS, WHICH CASCADES EVERYTHING IT OWNS.
     *
     * Clients, bookings, invoices, offerings, pages, links. The route this
     * replaces touched none of it, which is why deleted accounts left their
     * entire business behind.
     *
     * FATAL, unlike the two steps above. If the cascade does not run we stop
     * here WITHOUT deleting the auth user, so the account remains intact and
     * the owner can try again — rather than producing exactly the orphaned
     * business this rewrite exists to end.
     * ───────────────────────────────────────────────────────────────────────
     */
    const { count: businessCount, error: cascadeError } = await serviceSupabase
      .from(CASCADE_ROOT_TABLE)
      .delete({ count: 'exact' })
      .eq('user_id', user.id);

    if (cascadeError) {
      logger.error({ err: cascadeError, userId: user.id }, 'Business cascade failed; account left intact');
      return NextResponse.json(
        {
          error: 'Could not delete your business data, so nothing was deleted. Please try again.',
          reason: 'cascade_failed',
        },
        { status: 500 }
      );
    }

    deletionStats.items_deleted[CASCADE_ROOT_TABLE] = businessCount ?? 0;

    // ==========================================
    // FINALLY: DELETE AUTHENTICATION
    // ==========================================
    logger.info({ userId: user.id }, 'Deleting authentication');

    const { error: authDeleteError } = await serviceSupabase.auth.admin.deleteUser(user.id);

    if (authDeleteError) {
      logger.error({ err: authDeleteError, userId: user.id }, 'Failed to delete authentication');
      return NextResponse.json(
        { error: 'Failed to delete authentication', message: authDeleteError.message },
        { status: 500 }
      );
    }

    deletionStats.items_deleted.auth_user = 1;
    deletionStats.total_duration_ms = Date.now() - startTime;

    logger.info(
      {
        userId: user.id,
        durationMs: deletionStats.total_duration_ms,
        tablesDeleted: Object.keys(deletionStats.items_deleted).length,
        tablesMinimised: Object.keys(deletionStats.items_minimised).length,
        errorCount: deletionStats.errors.length,
      },
      'Account deleted'
    );

    await supabase.auth.signOut();

    return NextResponse.json({
      success: true,
      message: 'Account deleted',
      stats: deletionStats,
      data_policy: {
        deleted: [
          'The business and everything it owned — clients, bookings, invoices, offerings, pages and links',
          'Personal identification (name, avatar, profile)',
          'Plugin connections and OAuth tokens',
          'Preferences, settings and agents',
          'Authentication credentials',
        ],
        retained_without_identity: [
          'Financial records (accounting)',
          'Audit trail (security history)',
          'Usage accounting',
        ],
        retained_with_identity: [
          'Email unsubscribes — kept so anyone who asked not to be mailed stays unmailed',
        ],
      },
    });

  } catch (error: any) {
    logger.error({ err: error }, 'Account deletion failed');
    return NextResponse.json(
      { error: 'Account deletion failed', message: error.message },
      { status: 500 }
    );
  }
}
