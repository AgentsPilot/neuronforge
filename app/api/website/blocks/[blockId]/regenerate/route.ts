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

    // Use AI service to regenerate the field
    const aiService = new WebsiteAIContentService();
    const regeneratedValue = await aiService.regenerateField({
      blockType: validated.blockType,
      targetLanguage: validated.language as WebsiteLanguage,
      businessProfile: profile || undefined,
      existingContent: validated.context?.existingContent || blockResult.data.content,
      fieldToRegenerate: validated.field
    });

    requestLogger.info(
      { userId: user.id, blockId, field: validated.field },
      'Field regenerated successfully'
    );

    return NextResponse.json({
      success: true,
      field: validated.field,
      value: regeneratedValue
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
