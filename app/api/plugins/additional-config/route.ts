// app/api/plugins/additional-config/route.ts
//
// IDENTITY: every handler resolves the acting user from the SESSION via
// resolveActingUserIdentity(). A caller-supplied `userId` is not an identity claim — it
// is an act-as request, honoured only for platform admins and audited. Before this
// change all three handlers took `userId` from the caller with NO authentication, so an
// anonymous caller could read or overwrite any user's plugin configuration.
// See docs/workplans/BUSINESS_OS_PLUGIN_ROUTE_IDENTITY_HARDENING_WORKPLAN.md.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { UserPluginConnections } from '@/lib/server/user-plugin-connections';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { AdditionalConfig } from '@/lib/types/plugin-additional-config';
import { resolveActingUserIdentity } from '@/lib/server/route-identity';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'PluginAdditionalConfigAPI' });
const auditTrail = AuditTrailService.getInstance();

// Force dynamic rendering
export const dynamic = 'force-dynamic'

const WriteSchema = z.object({
  // Optional act-as target; identity still comes from the session.
  userId: z.string().optional(),
  pluginKey: z.string().min(1),
  additionalData: z.record(z.any()),
});

const ReadQuerySchema = z.object({
  userId: z.string().optional(),
  pluginKey: z.string().min(1),
});

function validationError(details: unknown) {
  return NextResponse.json(
    {
      success: false,
      error: 'Invalid request',
      details: process.env.NODE_ENV === 'development' ? details : undefined,
    },
    { status: 400 }
  );
}

/**
 * POST (create) and PUT (update) were near-identical copies; both are served here so the
 * identity check, validation and audit write can never drift apart between them.
 */
async function writeAdditionalConfig(request: NextRequest, verb: 'POST' | 'PUT') {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const body = await request.json().catch(() => null);
    const parsed = WriteSchema.safeParse(body);
    if (!parsed.success) {
      requestLogger.warn({ errors: parsed.error.flatten() }, 'Validation failed');
      return validationError(parsed.error.flatten());
    }

    const { pluginKey, additionalData } = parsed.data;

    const identity = await resolveActingUserIdentity({
      requestedUserId: parsed.data.userId,
      route: `${verb} /api/plugins/additional-config`,
      request,
      details: { pluginKey },
    });
    if (!identity.ok) {
      return NextResponse.json(
        { success: false, error: identity.error },
        { status: identity.status }
      );
    }
    const userId = identity.userId;

    // Get plugin definition to validate required fields
    const pluginManager = await PluginManagerV2.getInstance();
    const pluginDefinition = pluginManager.getPluginDefinition(pluginKey);

    if (!pluginDefinition) {
      return NextResponse.json(
        { success: false, error: 'Plugin not found' },
        { status: 404 }
      );
    }

    const additionalConfig: AdditionalConfig | undefined = (pluginDefinition.plugin as any).additional_config;

    if (!additionalConfig?.enabled) {
      return NextResponse.json(
        { success: false, error: 'Plugin does not support additional configuration' },
        { status: 400 }
      );
    }

    // Validate required fields
    const requiredFields = additionalConfig.fields.filter(f => f.required);
    const missingFields = requiredFields.filter(
      f => !additionalData[f.key] || String(additionalData[f.key]).trim() === ''
    );

    if (missingFields.length > 0) {
      const fieldNames = missingFields.map(f => f.label).join(', ');
      return NextResponse.json(
        { success: false, error: `Missing required fields: ${fieldNames}` },
        { status: 400 }
      );
    }

    const userConnections = UserPluginConnections.getInstance();
    const success = await userConnections.updateAdditionalConfig(userId, pluginKey, additionalData);

    if (!success) {
      requestLogger.error({ pluginKey, userId }, 'Failed to save additional configuration');
      return NextResponse.json(
        { success: false, error: 'Failed to save additional configuration' },
        { status: 500 }
      );
    }

    // Audited on both verbs — PUT previously wrote config with no audit entry at all.
    auditTrail
      .log({
        action: AUDIT_EVENTS.PLUGIN_PERMISSION_GRANTED,
        entityType: 'connection',
        resourceName: pluginKey,
        userId,
        actorId: identity.actingAs ? identity.sessionUserId : undefined,
        request,
        details: {
          plugin_key: pluginKey,
          verb,
          // Field KEYS only — never the values. Today every additional_config field is
          // free text, but the day someone adds a token/password field the raw value
          // would otherwise be persisted in plaintext in audit_trail. PUT newly writes
          // this entry, so this PR would have widened that surface.
          additional_config_fields: Object.keys(additionalData),
        },
        severity: 'warning',
        complianceFlags: ['SOC2'],
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    requestLogger.info({ pluginKey, userId, verb }, 'Additional config saved');

    return NextResponse.json({
      success: true,
      data: additionalData
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Error saving additional config');
    return NextResponse.json(
      { success: false, error: 'Failed to save additional configuration' },
      { status: 500 }
    );
  }
}

// POST /api/plugins/additional-config
// Save additional configuration data for a plugin connection
export async function POST(request: NextRequest) {
  return writeAdditionalConfig(request, 'POST');
}

// PUT /api/plugins/additional-config
// Update existing additional configuration data
export async function PUT(request: NextRequest) {
  return writeAdditionalConfig(request, 'PUT');
}

// GET /api/plugins/additional-config?pluginKey={pluginKey}
// Retrieve additional configuration data for a plugin connection
export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const { searchParams } = new URL(request.url);
    const parsed = ReadQuerySchema.safeParse({
      userId: searchParams.get('userId') ?? undefined,
      pluginKey: searchParams.get('pluginKey') ?? undefined,
    });
    if (!parsed.success) {
      return validationError(parsed.error.flatten());
    }

    const { pluginKey } = parsed.data;

    const identity = await resolveActingUserIdentity({
      requestedUserId: parsed.data.userId,
      route: 'GET /api/plugins/additional-config',
      request,
      details: { pluginKey },
    });
    if (!identity.ok) {
      return NextResponse.json(
        { success: false, error: identity.error },
        { status: identity.status }
      );
    }
    const userId = identity.userId;

    // Get additional configuration
    const userConnections = UserPluginConnections.getInstance();
    const additionalData = await userConnections.getAdditionalConfig(userId, pluginKey);

    requestLogger.debug({ pluginKey, userId }, 'Retrieved additional config');

    return NextResponse.json(
      {
        success: true,
        data: additionalData || {}
      },
      // User-specific data: never store in a shared cache.
      { headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } }
    );

  } catch (error) {
    requestLogger.error({ err: error }, 'Error getting additional config');
    return NextResponse.json(
      { success: false, error: 'Failed to retrieve additional configuration' },
      { status: 500 }
    );
  }
}
