/**
 * Remove the business's Stripe Connect account ("Remove connection")
 * DELETE /api/payments/stripe-connect/delete
 *
 * Self-service exit SX-5 / D5 (C-5, SA-14, BQ-19; SA workplan review W-1 to
 * W-13). Our record goes ONLY after Stripe confirms the account is released:
 * an Express / Custom account deleted, a Standard (OAuth) account's access
 * revoked, or Stripe saying it is already gone. Before D5 a refused Stripe
 * delete was swallowed and our row deleted anyway (K-4), which cleared the
 * deletion guard G-8 while the account still lived at Stripe.
 *
 * Order, nothing before it (each refusal changes nothing, at Stripe or here):
 *   401  no session
 *   503  `check_failed`        a row, the shared-account check or the money check could not be read
 *   404  `not_found`           no Stripe record in either table
 *   409  `not_available`       a record naming no account, two different accounts (W-9),
 *                              an account another business also names (W-10),
 *                              or a release Stripe would not confirm (contact us)
 *   409  `client_money_in_flight`  running client plans or pending payments / refunds (D-2)
 *   409  `stripe_refused`      Stripe would not delete an Express account (a balance, a payout on its way)
 *   502  `stripe_unreachable`  Stripe could not answer; try again
 *
 * No request body and no caller-supplied id: the user is the session, every
 * row is read by that user's id, and the Stripe account id comes only from our
 * own rows. Service role (`supabaseServer`, rule 4): the Connect and plugin
 * tables are written by the server only; every read and write here is scoped
 * to the session user except the W-10 count, which is cross-user by design and
 * returns a number only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { StripeConnectRepository } from '@/lib/repositories/PaymentRepository';
import { pluginConnectionRepository } from '@/lib/repositories/PluginConnectionRepository';
import { supabaseServer } from '@/lib/supabaseServer';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { checkConnectExit, isStripeAccountShared } from '@/lib/business-os/account-deletion/connectExitGuard';
import { releaseConnectedAccount, type StripeErrorFacts } from '@/lib/business-os/account-deletion/connectRelease';
import type { BlockerView } from '@/lib/business-os/account-deletion/blockerCopy';
import { pluginStatusCache } from '@/app/api/plugins/user-status/route';

const logger = createLogger({ module: 'StripeConnectDelete' });
const auditTrail = AuditTrailService.getInstance();

const STRIPE_ACCOUNT_ID = /^acct_[A-Za-z0-9]+$/;

/** The account id a `stripe` plugin row names, read as `resolveUserConnectAccounts` reads it. Null when none. */
function accountIdOfPluginRow(profileData: unknown): string | null {
  if (typeof profileData !== 'object' || profileData === null) return null;
  const { stripe_account_id: named, id } = profileData as { stripe_account_id?: unknown; id?: unknown };
  const candidate = typeof named === 'string' && named ? named : typeof id === 'string' ? id : null;
  return candidate && STRIPE_ACCOUNT_ID.test(candidate) ? candidate : null;
}

/** "No row" from a `.single()` read: PostgREST's PGRST116. Anything else is a real read failure (W-8). */
function isNoRow(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'PGRST116';
}

type RefusalCode = 'check_failed' | 'not_available' | 'client_money_in_flight' | 'stripe_refused' | 'stripe_unreachable';

const STATUS_OF: Record<RefusalCode, number> = {
  check_failed: 503,
  not_available: 409,
  client_money_in_flight: 409,
  stripe_refused: 409,
  stripe_unreachable: 502,
};

export async function DELETE(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const refuse = (
      code: RefusalCode,
      facts: { step: string; accountId?: string | null; blockers?: BlockerView[]; stripe?: StripeErrorFacts; shared?: boolean }
    ) => {
      requestLogger.warn(
        { userId: user.id, code, step: facts.step, stripe: facts.stripe, blockers: facts.blockers?.map((blocker) => blocker.code) },
        'Stripe Connect removal refused'
      );
      // Refusals: non-blocking, no flush (W-12).
      auditTrail
        .log({
          action: AUDIT_EVENTS.STRIPE_CONNECT_DELETE_REFUSED,
          userId: user.id,
          entityType: 'stripe_connect_account',
          entityId: facts.accountId ?? null,
          details: {
            reason: code,
            step: facts.step,
            blockers: facts.blockers,
            stripe: facts.stripe ? { type: facts.stripe.type, code: facts.stripe.code } : undefined,
            shared: facts.shared ? true : undefined,
          },
          severity: 'info',
          request,
        })
        .catch((err) => requestLogger.error({ err }, 'Audit log failed'));
      return NextResponse.json(
        {
          success: false,
          error: code,
          ...(facts.blockers ? { blockers: facts.blockers } : {}),
          details:
            process.env.NODE_ENV === 'development' && facts.stripe ? { type: facts.stripe.type, code: facts.stripe.code } : undefined,
        },
        { status: STATUS_OF[code] }
      );
    };

    // Service role (rule 4, intentional): both tables are server-written; every call below is scoped to user.id.
    const stripeConnectRepo = new StripeConnectRepository(supabaseServer);

    // ── W-8: read both tables, surfacing errors ─────────────────────────────
    const connectRead = await stripeConnectRepo.findByUserId(user.id);
    if (connectRead.error) return refuse('check_failed', { step: 'read_connect' });
    const pluginRead = await pluginConnectionRepository.findByUserAndPlugin(user.id, 'stripe');
    if (pluginRead.error && !isNoRow(pluginRead.error)) return refuse('check_failed', { step: 'read_plugin' });

    const connectRow = connectRead.data;
    const pluginRow = pluginRead.error ? null : pluginRead.data;
    if (!connectRow && !pluginRow) {
      return NextResponse.json({ success: false, error: 'not_found' }, { status: 404 });
    }

    const pluginAccountId = pluginRow ? accountIdOfPluginRow(pluginRow.profile_data) : null;
    if (pluginRow && !pluginAccountId) return refuse('not_available', { step: 'plugin_row_unnamed' });

    // ── W-9: exactly one account, or support handles it ─────────────────────
    const accountIds = [...new Set([connectRow?.stripe_account_id, pluginAccountId].filter((id): id is string => Boolean(id)))];
    if (accountIds.length !== 1) return refuse('not_available', { step: 'more_than_one_account' });
    const accountId = accountIds[0];

    // ── W-10: never cut off another business ────────────────────────────────
    const shared = await isStripeAccountShared(accountId, user.id);
    if (shared === 'unreadable') return refuse('check_failed', { step: 'shared_check', accountId });
    if (shared === 'shared') return refuse('not_available', { step: 'shared_account', accountId, shared: true });

    // ── D-2 (SA-14): no client money in flight ──────────────────────────────
    const verdict = await checkConnectExit({ id: user.id, email: user.email ?? null }, 'delete');
    if (verdict.kind === 'unreadable') return refuse('check_failed', { step: `money_check:${verdict.reason}`, accountId });
    if (verdict.kind === 'blocked') return refuse('client_money_in_flight', { step: 'money_check', accountId, blockers: verdict.blockers });

    // ── Stripe decides ──────────────────────────────────────────────────────
    const release = await releaseConnectedAccount(accountId);
    if (release.kind === 'refused') {
      if (release.step === 'config') requestLogger.error({ alert: true }, 'STRIPE_CLIENT_ID is not set: a Standard account cannot be released');
      return refuse(release.reason, { step: release.step, accountId, stripe: release.stripe });
    }

    // QA B-2: Stripe has already let go, but our row stayed. Recorded (non-blocking) as a refusal of the
    // removal, because our record was NOT removed, with how Stripe released it and which table stuck, so
    // support (X-10) can see the Stripe-side release in the trail. No new event: DELETE_REFUSED fits.
    const recordNotRemoved = (table: 'stripe_connect_accounts' | 'plugin_connections') => {
      auditTrail
        .log({
          action: AUDIT_EVENTS.STRIPE_CONNECT_DELETE_REFUSED,
          userId: user.id,
          entityType: 'stripe_connect_account',
          entityId: accountId,
          details: { reason: 'record_not_removed', step: 'remove_rows', table, how: release.how, account_kind: release.accountKind },
          severity: 'info',
          request,
        })
        .catch((err) => requestLogger.error({ err }, 'Audit log failed'));
      return NextResponse.json({ success: false, error: 'record_not_removed' }, { status: 500 });
    };

    // ── W-5: our rows go only now; both name the released account (W-9) ────
    if (connectRow) {
      const removed = await stripeConnectRepo.delete(connectRow.id, user.id);
      if (removed.error) {
        // Support must act: Stripe let go, G-8 still sees our row, and a retry gets "contact us" (SA F-1).
        requestLogger.error({ err: removed.error, accountId, how: release.how, alert: true }, 'Stripe released the account but our Connect row could not be removed');
        return recordNotRemoved('stripe_connect_accounts');
      }
    }
    if (pluginRow) {
      const removed = await pluginConnectionRepository.deleteByUserAndPlugin(user.id, 'stripe');
      pluginStatusCache.invalidate(`plugin-status-${user.id}`);
      if (removed.error) {
        requestLogger.error({ err: removed.error, accountId, how: release.how, alert: true }, 'Stripe released the account but our plugin row could not be removed');
        return recordNotRemoved('plugin_connections');
      }
    }

    // W-12: the removal of a payment account is recorded before the response.
    await auditTrail
      .log({
        action: AUDIT_EVENTS.STRIPE_CONNECT_ACCOUNT_DELETED,
        userId: user.id,
        entityType: 'stripe_connect_account',
        entityId: accountId,
        details: {
          account_type: connectRow?.stripe_account_type ?? 'plugin',
          account_kind: release.accountKind,
          how: release.how,
          rows: { connect: Boolean(connectRow), plugin: Boolean(pluginRow) },
        },
        severity: 'warning',
        request,
      })
      .catch((err) => requestLogger.error({ err }, 'Audit log failed'));
    await auditTrail.flush().catch((err) => requestLogger.error({ err }, 'Audit flush failed'));

    requestLogger.info({ accountId, how: release.how }, 'Stripe Connect account removed');
    return NextResponse.json({ success: true, data: { how: release.how } });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to remove Stripe Connect account');
    return NextResponse.json({ success: false, error: 'Failed to remove payment account' }, { status: 500 });
  }
}
