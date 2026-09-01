/**
 * Manage which channels are analysed.
 *
 * GET    - list the user's connected channels and their sync health
 * PATCH  - pause or resume insights for one channel, without disconnecting the
 *          plugin (which may still be used by an agent)
 * DELETE - disconnect and delete the stored history for one channel
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import {
  channelConnectionRepository,
  type ChannelPlatform,
} from '@/lib/repositories/ChannelConnectionRepository';
import { channelMetricsRepository } from '@/lib/repositories/ChannelMetricsRepository';

const logger = createLogger({ module: 'ChannelConnectionsAPI' });
const auditTrail = AuditTrailService.getInstance();

/** A connection whose cursor is older than this is treated as broken, not merely idle. */
const STALE_AFTER_MS = 48 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { data: connections, error } = await channelConnectionRepository.findByUser(user.id);
    if (error) throw error;

    const now = Date.now();

    return NextResponse.json({
      success: true,
      data: {
        connections: (connections || []).map(c => {
          const syncedAt = c.last_synced_at ? new Date(c.last_synced_at).getTime() : 0;
          const isStale = c.insights_enabled && syncedAt > 0 && now - syncedAt > STALE_AFTER_MS;

          return {
            id: c.id,
            platform: c.platform,
            // Needed by DELETE, which clears the stored metrics for this
            // account before dropping the connection row.
            account_id: c.account_id,
            account_name: c.account_name,
            insights_enabled: c.insights_enabled,
            last_synced_at: c.last_synced_at,
            // backfill_completed_at is only set on a SUCCESSFUL sync, so a
            // connection that keeps failing would otherwise show "fetching
            // history…" forever. An error outranks the spinner.
            is_backfilling:
              c.insights_enabled && !c.backfill_completed_at && !c.last_sync_error,
            // Meta tokens are long-lived but not refreshable, so connections do
            // expire. Surfaced as a reconnect prompt rather than silent staleness.
            needs_reconnect: isStale || !!c.last_sync_error,
            last_sync_error: c.last_sync_error,
          };
        }),
      },
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to list channel connections');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

const patchSchema = z.object({
  id: z.string().uuid(),
  insights_enabled: z.boolean(),
});

export async function PATCH(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
    }
    const { id, insights_enabled } = parsed.data;

    const { error } = await channelConnectionRepository.setEnabled(user.id, id, insights_enabled);
    if (error) throw error;

    auditTrail
      .log({
        action: insights_enabled
          ? AUDIT_EVENTS.PLUGIN_PERMISSION_GRANTED
          : AUDIT_EVENTS.PLUGIN_PERMISSION_REVOKED,
        entityType: 'connection',
        entityId: id,
        userId: user.id,
        severity: 'warning',
        request,
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    return NextResponse.json({ success: true, data: { id, insights_enabled } });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to update channel connection');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

const deleteSchema = z.object({
  id: z.string().uuid(),
  platform: z.enum(['facebook_page', 'instagram', 'google_business_profile', 'ga4']),
  account_id: z.string().min(1),
});

export async function DELETE(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = deleteSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
    }
    const { id, platform, account_id } = parsed.data;

    // Metrics first: if the connection row went first and this then failed, the
    // user would have orphaned data they can no longer reach a delete button for.
    const { error: metricsError } = await channelMetricsRepository.deleteForAccount(
      user.id,
      platform as ChannelPlatform,
      account_id
    );
    if (metricsError) throw metricsError;

    const { error } = await channelConnectionRepository.remove(user.id, id);
    if (error) throw error;

    auditTrail
      .log({
        action: AUDIT_EVENTS.PLUGIN_PERMISSION_REVOKED,
        entityType: 'connection',
        entityId: id,
        userId: user.id,
        severity: 'warning',
        request,
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    requestLogger.info({ userId: user.id, platform }, 'Channel disconnected and data deleted');

    return NextResponse.json({ success: true, data: { deleted: true } });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to disconnect channel');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
