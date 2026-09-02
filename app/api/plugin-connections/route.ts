// app/api/plugin-connections/route.ts
//
// IDENTITY: every handler resolves the acting user from the SESSION via
// resolveActingUserIdentity(). A `user_id` in the body or query string is not an
// identity claim — it is an act-as request, honoured only for platform admins and
// audited. Before this change all three handlers took `user_id` from the caller with
// no authentication at all.
//
// SERVICE ROLE / RLS BYPASS (intentional): createServerSupabaseClient is service-role
// so a connection can be written/removed for the resolved user. Tenant scoping is this
// route's responsibility — every query is filtered by the RESOLVED id, never by input.
//
// REMOVED: the previous `GET ?plugin_key=…&user_id=…` branch returned
// decryptCredentials(...) — the stored username/password in plaintext — to an
// unauthenticated caller. It had zero callers repo-wide and has been deleted rather
// than gated: handing decrypted credentials back over HTTP is not a primitive worth
// keeping. See docs/workplans/BUSINESS_OS_PLUGIN_ROUTE_IDENTITY_HARDENING_WORKPLAN.md.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabaseClient } from '@/lib/supabaseServer'
import { resolveActingUserIdentity } from '@/lib/server/route-identity'
import { encryptCredentials } from '@/lib/encryptCredentials'
import { createLogger } from '@/lib/logger'
import { AuditTrailService } from '@/lib/services/AuditTrailService'
import { AUDIT_EVENTS } from '@/lib/audit/events'

const logger = createLogger({ module: 'PluginConnectionsAPI' })
const auditTrail = AuditTrailService.getInstance()

// Force dynamic rendering
export const dynamic = 'force-dynamic'

const ConnectSchema = z.object({
  plugin_key: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
  // Optional act-as target; identity still comes from the session.
  user_id: z.string().optional(),
  access_token: z.string().nullish(),
})

const DeleteQuerySchema = z.object({
  plugin_key: z.string().min(1),
  user_id: z.string().optional(),
})

const ListQuerySchema = z.object({
  user_id: z.string().optional(),
})

function validationError(details: unknown) {
  return NextResponse.json(
    {
      success: false,
      error: 'Invalid request',
      details: process.env.NODE_ENV === 'development' ? details : undefined,
    },
    { status: 400 }
  )
}

export async function POST(req: NextRequest) {
  const correlationId = req.headers.get('x-correlation-id') || crypto.randomUUID()
  const requestLogger = logger.child({ correlationId })

  try {
    const body = await req.json().catch(() => null)
    const parsed = ConnectSchema.safeParse(body)
    if (!parsed.success) {
      requestLogger.warn({ errors: parsed.error.flatten() }, 'Validation failed')
      return validationError(parsed.error.flatten())
    }

    const { plugin_key, username, password, access_token } = parsed.data

    const identity = await resolveActingUserIdentity({
      requestedUserId: parsed.data.user_id,
      route: 'POST /api/plugin-connections',
      request: req,
      details: { plugin_key },
    })
    if (!identity.ok) {
      return NextResponse.json({ success: false, error: identity.error }, { status: identity.status })
    }
    const userId = identity.userId

    if (plugin_key === 'google-mail' && !username.includes('@gmail.com')) {
      return NextResponse.json(
        { success: false, error: 'Gmail username must be a @gmail.com address' },
        { status: 400 }
      )
    }

    const supabase = createServerSupabaseClient()
    const encrypted = encryptCredentials({ username, password })

    const { error } = await supabase.from('plugin_connections').insert({
      plugin_key,
      user_id: userId,
      credentials: encrypted,
      access_token: access_token || null,
    })

    if (error) {
      requestLogger.error({ err: error, plugin_key, userId }, 'Failed to insert plugin connection')
      return NextResponse.json({ success: false, error: 'Failed to save connection' }, { status: 500 })
    }

    auditTrail
      .log({
        action: AUDIT_EVENTS.PLUGIN_CONNECTED,
        entityType: 'connection',
        entityId: plugin_key,
        userId,
        actorId: identity.actingAs ? identity.sessionUserId : undefined,
        resourceName: plugin_key.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
        details: {
          plugin_key,
          has_access_token: !!access_token,
          connection_type: access_token ? 'oauth' : 'credentials',
        },
        severity: 'info',
        complianceFlags: ['SOC2', 'GDPR'], // Third-party data access
        request: req,
      })
      .catch((err) => requestLogger.error({ err }, 'Audit failed (non-blocking)'))

    requestLogger.info({ plugin_key, userId }, 'Plugin connection saved')
    return NextResponse.json({ success: true })
  } catch (err) {
    requestLogger.error({ err }, 'Failed to save plugin connection')
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const correlationId = req.headers.get('x-correlation-id') || crypto.randomUUID()
  const requestLogger = logger.child({ correlationId })

  try {
    const { searchParams } = new URL(req.url)
    const parsed = DeleteQuerySchema.safeParse({
      plugin_key: searchParams.get('plugin_key') ?? undefined,
      user_id: searchParams.get('user_id') ?? undefined,
    })
    if (!parsed.success) {
      requestLogger.warn({ errors: parsed.error.flatten() }, 'Validation failed')
      return validationError(parsed.error.flatten())
    }

    const { plugin_key } = parsed.data

    const identity = await resolveActingUserIdentity({
      requestedUserId: parsed.data.user_id,
      route: 'DELETE /api/plugin-connections',
      request: req,
      details: { plugin_key },
    })
    if (!identity.ok) {
      return NextResponse.json({ success: false, error: identity.error }, { status: identity.status })
    }
    const userId = identity.userId

    const supabase = createServerSupabaseClient()
    const { error } = await supabase
      .from('plugin_connections')
      .delete()
      .eq('plugin_key', plugin_key)
      .eq('user_id', userId)

    if (error) {
      requestLogger.error({ err: error, plugin_key, userId }, 'Failed to delete plugin connection')
      return NextResponse.json({ success: false, error: 'Failed to remove connection' }, { status: 500 })
    }

    auditTrail
      .log({
        action: AUDIT_EVENTS.PLUGIN_DISCONNECTED,
        entityType: 'connection',
        entityId: plugin_key,
        userId,
        actorId: identity.actingAs ? identity.sessionUserId : undefined,
        resourceName: plugin_key.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
        details: { plugin_key, disconnected_at: new Date().toISOString() },
        severity: 'warning',
        complianceFlags: ['SOC2', 'GDPR'],
        request: req,
      })
      .catch((err) => requestLogger.error({ err }, 'Audit failed (non-blocking)'))

    requestLogger.info({ plugin_key, userId }, 'Plugin connection removed')
    return NextResponse.json({ success: true })
  } catch (err) {
    requestLogger.error({ err }, 'Failed to remove plugin connection')
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const correlationId = req.headers.get('x-correlation-id') || crypto.randomUUID()
  const requestLogger = logger.child({ correlationId })

  try {
    const { searchParams } = new URL(req.url)
    const parsed = ListQuerySchema.safeParse({
      user_id: searchParams.get('user_id') ?? undefined,
    })
    if (!parsed.success) {
      return validationError(parsed.error.flatten())
    }

    const identity = await resolveActingUserIdentity({
      requestedUserId: parsed.data.user_id,
      route: 'GET /api/plugin-connections',
      request: req,
    })
    if (!identity.ok) {
      return NextResponse.json({ success: false, error: identity.error }, { status: identity.status })
    }
    const userId = identity.userId

    const supabase = createServerSupabaseClient()
    const { data: pluginRows, error } = await supabase
      .from('plugin_connections')
      .select('plugin_key, created_at, access_token')
      .eq('user_id', userId)

    if (error) {
      requestLogger.error({ err: error, userId }, 'Failed to list plugin connections')
      return NextResponse.json({ success: false, error: 'Failed to load connections' }, { status: 500 })
    }

    const plugins = (pluginRows ?? []).map((row) => ({
      plugin_key: row.plugin_key,
      plugin_name: formatPluginDisplayName(row.plugin_key),
      status: 'active',
      connected_at: row.created_at,
      has_access_token: !!row.access_token,
    }))

    requestLogger.debug({ userId, count: plugins.length }, 'Listed plugin connections')

    return NextResponse.json(
      { plugins, count: plugins.length },
      // User-specific data: never store in a shared cache.
      { headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } }
    )
  } catch (err) {
    requestLogger.error({ err }, 'Failed to list plugin connections')
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}

function formatPluginDisplayName(pluginKey: string): string {
  // Map of plugin keys to display names
  const displayNames: Record<string, string> = {
    'google-mail': 'Google Mail',
    'google-drive': 'Google Drive',
    'google-calendar': 'Google Calendar',
    'notion': 'Notion',
    'slack': 'Slack',
    'discord': 'Discord',
    'trello': 'Trello',
    'asana': 'Asana',
    'salesforce': 'Salesforce',
    'hubspot': 'HubSpot',
    'teams': 'Microsoft Teams',
    'dropbox': 'Dropbox',
    'github': 'GitHub',
    'linear': 'Linear',
    'figma': 'Figma',
    'openai': 'OpenAI',
    'anthropic': 'Anthropic Claude',
    'chatgpt': 'ChatGPT'
  }

  return displayNames[pluginKey] || pluginKey
    .split(/[-_]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}
