/**
 * Per-Field AI Regeneration API
 * POST - Regenerate a single field in a website block using AI
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { WebsiteBlockRepository } from '@/lib/repositories/WebsiteBlockRepository';
import { WebsiteAIContentService, type WebsiteLanguage } from '@/lib/services/WebsiteAIContentService';
import { newBosGroupId } from '@/lib/business-os/llm/callCatalog';
import { runAiAction } from '@/lib/business-os/llm/aiActionAudit';
import { z } from 'zod';

const logger = createLogger({ module: 'RegenerateFieldAPI' });

const RegenerateFieldSchema = z.object({
  field: z.string().min(1).max(100),
  blockType: z.string().min(1).max(50),
  language: z.enum(['en', 'es', 'he']).optional().default('en'),
  context: z.object({
    businessName: z.string().optional(),
    vertical: z.string().optional(),
    description: z.string().optional(),
    existingContent: z.record(z.unknown()).optional()
  }).optional()
});

interface RouteParams {
  params: Promise<{ blockId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { blockId } = await params;
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const validated = RegenerateFieldSchema.parse(body);

    requestLogger.info(
      { userId: user.id, blockId, field: validated.field, blockType: validated.blockType },
      'Regenerating field'
    );

    // Verify block ownership
    const blockRepo = new WebsiteBlockRepository(supabaseServer);
    const blockResult = await blockRepo.findById(blockId);

    if (blockResult.error || !blockResult.data) {
      return NextResponse.json({ success: false, error: 'Block not found' }, { status: 404 });
    }

    // Fetch business profile for context
    const { data: profile } = await supabaseServer
      .from('business_profiles')
      .select('company_name, vertical, description')
      .eq('user_id', user.id)
      .single();

    // One usage group per regeneration request; never taken from the request.
    const groupId = newBosGroupId();
    requestLogger.info({ userId: user.id, blockId, groupId }, 'Regeneration usage group');

    // Use AI service to regenerate the field
    const aiService = new WebsiteAIContentService();
    // Read before the callback: TypeScript does not carry the null check into it.
    const existingContent = validated.context?.existingContent || blockResult.data.content;
    // One AI action, one audit entry (Layer 3, FR-12).
    const regenerated = await runAiAction(
      { area: 'website', actionType: 'website_field_regenerate', groupId, trigger: 'user', accountId: user.id },
      () =>
        aiService.regenerateField({
          blockType: validated.blockType,
          targetLanguage: validated.language as WebsiteLanguage,
          businessProfile: profile || undefined,
          existingContent,
          fieldToRegenerate: validated.field
        }, { userId: user.id, groupId })
    );

    /*
     * The website area's AI is switched off (Layer 2 FR-14). HTTP **200**, not
     * 5xx: nothing failed, an operator turned the feature off, and a 500 would
     * put it in the error logs and the client's catch branch as though the
     * platform were broken (Q-9). No field was written, so the owner's text is
     * exactly as they left it; the page shows its `ai_unavailable` label.
     */
    if (!regenerated.ok) {
      requestLogger.info(
        { userId: user.id, blockId, field: validated.field, reason: 'disabled' },
        'Field regeneration refused: website AI writing is switched off'
      );
      return NextResponse.json({ success: false, code: regenerated.code, field: validated.field });
    }

    requestLogger.info(
      { userId: user.id, blockId, field: validated.field },
      'Field regenerated successfully'
    );

    return NextResponse.json({
      success: true,
      field: validated.field,
      value: regenerated.text
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error, blockId }, 'Failed to regenerate field');
    return NextResponse.json(
      { success: false, error: 'Failed to regenerate field' },
      { status: 500 }
    );
  }
}
