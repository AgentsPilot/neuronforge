/**
 * Website Actions API
 * Handles website management actions from the Control Center chat
 *
 * POST - Execute a website intent (toggle sections, update content, publish, etc.)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { WebsiteActionHandler, type WebsiteIntent } from '@/lib/business-os/actions/WebsiteActionHandler';
import { AuditTrailService } from '@/lib/services/AuditTrailService';

const logger = createLogger({ module: 'WebsiteActionsAPI' });
const auditTrail = AuditTrailService.getInstance();

// Intent validation schema
const intentSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('toggle_block'),
    block_type: z.string(),
    enabled: z.boolean()
  }),
  z.object({
    action: z.literal('update_block_content'),
    block_type: z.string(),
    field: z.string(),
    value: z.string()
  }),
  z.object({
    action: z.literal('reorder_blocks'),
    block_type: z.string(),
    position: z.union([z.literal('up'), z.literal('down'), z.number()])
  }),
  z.object({ action: z.literal('publish') }),
  z.object({ action: z.literal('unpublish') }),
  z.object({
    action: z.literal('create_page'),
    template_id: z.string().optional(),
    title: z.string()
  }),
  z.object({
    action: z.literal('regenerate_content'),
    block_type: z.string().optional()
  })
]);

const requestSchema = z.object({
  intent: intentSchema.optional(),
  text: z.string().optional() // Natural language text to parse
}).refine(data => data.intent || data.text, {
  message: 'Either intent or text must be provided'
});

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2. Parse and validate request
    const body = await request.json();
    const parseResult = requestSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid request', details: parseResult.error.errors },
        { status: 400 }
      );
    }

    const { intent: providedIntent, text } = parseResult.data;

    // 3. Initialize handler
    const handler = new WebsiteActionHandler(supabaseServer);

    // 4. Get intent (either provided or parsed from text)
    let intent: WebsiteIntent | null = providedIntent as WebsiteIntent || null;

    if (!intent && text) {
      intent = handler.parseIntent(text);

      if (!intent) {
        return NextResponse.json({
          success: false,
          error: 'Could not understand website action',
          message: 'I didn\'t understand that. Try something like "remove the testimonials section" or "publish my website".'
        });
      }
    }

    if (!intent) {
      return NextResponse.json(
        { success: false, error: 'No intent provided' },
        { status: 400 }
      );
    }

    requestLogger.info({ userId: user.id, intent }, 'Processing website action');

    // 5. Execute intent
    const result = await handler.handleIntent(intent, user.id);

    // 6. Audit log (non-blocking)
    auditTrail.log({
      action: `WEBSITE_${intent.action.toUpperCase()}`,
      userId: user.id,
      entityType: 'website',
      changes: { intent, result: result.success },
      request
    }).catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    // 7. Return response
    return NextResponse.json({
      success: result.success,
      message: result.message,
      data: result.data
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Website action failed');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
