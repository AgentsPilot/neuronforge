/**
 * POST /api/business-os/channel-insights/connect
 *
 * Runs after the standard plugin OAuth callback has stored a connection, and
 * turns that into an analysed channel.
 *
 * Account discovery happens here, on the server, because the users this is built
 * for will not paste an account ID. When there is exactly one Page/property/
 * location — the ordinary case — it is selected automatically and they see
 * nothing but "connected". A chooser is returned only when there is genuinely
 * more than one, and it carries names and pictures, never IDs.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { PluginExecuterV2 } from '@/lib/server/plugin-executer-v2';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { channelConnectionRepository } from '@/lib/repositories/ChannelConnectionRepository';
import { channelMetricsSyncService } from '@/lib/business-os/channel-insights/ChannelMetricsSyncService';
import { CHANNEL_PROVIDERS } from '@/lib/business-os/channel-insights/providers';
import { capabilityActivationService } from '@/lib/services/CapabilityActivationService';

const logger = createLogger({ module: 'ChannelConnectAPI' });
const auditTrail = AuditTrailService.getInstance();

const bodySchema = z.object({
  provider: z.enum(['meta', 'google_analytics', 'google_business_profile']),
  /** Supplied only when the user picked from a chooser. */
  account_id: z.string().min(1).optional(),
});

/**
 * Failures leave here as a code, never as a sentence.
 *
 * The card speaks the user's language — Hebrew, Spanish or English — and a
 * sentence written on the server can only be in one of them. `error` carries
 * the kind ('api_not_enabled', 'no_accounts', …) and the wording lives beside
 * the rest of the card's copy, where it gets translated like everything else.
 */

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Validate input
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
    }
    const { provider, account_id } = parsed.data;
    const config = CHANNEL_PROVIDERS[provider];

    // 3. Discover what this user can analyse
    const executer = await PluginExecuterV2.getInstance();
    const listResult = await executer.execute(user.id, config.pluginKey, config.listAction, {});

    if (!listResult?.success) {
      const reason = listResult?.message || listResult?.error || '';

      requestLogger.warn(
        { userId: user.id, provider, error: reason },
        'Could not list accounts for provider'
      );

      // Classify the failure, and never hand the provider's own sentence to the
      // person clicking Connect. Google answers a disabled API with "My Business
      // Account Management API has not been used in project 921980058947" —
      // accurate, actionable for whoever owns the Cloud project, and meaningless
      // to the business owner it was being shown to.
      //
      // The raw text stops here: it is logged above, where whoever owns the
      // Cloud project can read it, and never shown in the product.
      // 'has not been granted' covers the Business Profile case, where the API
      // is enabled but its quota stays at zero until Google approves access.
      // Same meaning to the person clicking Connect: not available yet, and not
      // their fault — so not the "try again" message they were getting.
      const apiDisabled = /has not been used in project|is disabled|SERVICE_DISABLED|accessNotConfigured|has not been granted/i.test(reason);
      const needsReauth = /token|expired|invalid_grant|unauthorized|401/i.test(reason);

      const kind = apiDisabled ? 'api_not_enabled' : needsReauth ? 'reauth_required' : 'not_connected';

      return NextResponse.json({ success: false, error: kind }, { status: 409 });
    }

    const raw = (listResult.data?.[config.listField] ?? []) as any[];
    const accounts = raw.map(config.toAccount);

    // Nothing to analyse. The card says specifically why, per provider, rather
    // than showing an empty page — it knows which one was being connected.
    if (accounts.length === 0) {
      return NextResponse.json({ success: false, error: 'no_accounts' });
    }

    // More than one, and the user hasn't chosen: return the chooser.
    if (accounts.length > 1 && !account_id) {
      return NextResponse.json({
        success: true,
        data: {
          needsSelection: true,
          accounts: accounts.map(a => ({
            id: a.id,
            name: a.name,
            picture_url: a.picture_url ?? null,
            detail: a.detail ?? null,
            has_secondary: !!a.secondary,
          })),
        },
      });
    }

    const account = account_id ? accounts.find(a => a.id === account_id) : accounts[0];
    if (!account) {
      return NextResponse.json(
        { success: false, error: 'Selected account not found on this connection' },
        { status: 400 }
      );
    }

    // 4. Record the opt-in
    const connected: string[] = [];

    const { data: primary, error: primaryError } = await channelConnectionRepository.upsert({
      user_id: user.id,
      platform: config.platform,
      plugin_key: config.pluginKey,
      account_id: account.id,
      account_name: account.name,
      account_token: account.token ?? null,
      insights_enabled: true,
    });
    if (primaryError) throw primaryError;
    connected.push(config.platform);

    if (account.secondary) {
      const { error: secondaryError } = await channelConnectionRepository.upsert({
        user_id: user.id,
        platform: account.secondary.platform,
        plugin_key: config.pluginKey,
        account_id: account.secondary.id,
        account_name: account.secondary.name,
        account_token: account.token ?? null,
        insights_enabled: true,
      });
      if (secondaryError) throw secondaryError;
      connected.push(account.secondary.platform);
    }

    // Connecting IS the opt-in.
    //
    // The dashboard's channels card is gated on the `channel_insights`
    // capability, which the onboarding chat grants to whoever ticks the box. A
    // business that declined then, and connected an account here through the
    // readiness step, has plainly changed its mind — and without this it would
    // connect Facebook successfully and still be shown no channels card,
    // because a one-off answer from week one was still deciding.
    //
    // 'manual' rather than 'onboarding': this was an act, not an answer.
    // Non-blocking, and idempotent — activateCapability no-ops if it is already
    // on, and a failure here must not undo a connection that worked.
    capabilityActivationService
      .activateCapability(user.id, 'channel_insights', 'manual')
      .catch(err =>
        requestLogger.error({ err, userId: user.id }, 'Failed to activate channel_insights (non-blocking)')
      );

    auditTrail
      .log({
        action: AUDIT_EVENTS.PLUGIN_PERMISSION_GRANTED,
        entityType: 'connection',
        entityId: primary?.id ?? account.id,
        userId: user.id,
        resourceName: account.name,
        severity: 'warning',
        request,
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    // 5. Backfill without blocking — the user should see "connected" now, not
    // wait on 90 days of API calls.
    channelMetricsSyncService
      .syncUser(user.id)
      .catch(err => requestLogger.error({ err, userId: user.id }, 'Initial channel sync failed'));

    requestLogger.info({ userId: user.id, provider, connected }, 'Channel insights connected');

    return NextResponse.json({
      success: true,
      data: {
        needsSelection: false,
        connected,
        account_name: account.name,
        // Meta only: lets the UI explain the one thing a user may need to act on.
        secondary_missing:
          provider === 'meta' && !account.secondary ? 'no_business_instagram' : null,
      },
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to connect channel insights');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}
