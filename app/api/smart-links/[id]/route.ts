/**
 * Smart Link Detail API
 * GET - Get a smart link by ID with stats
 * PUT - Update a smart link
 * DELETE - Delete (deactivate) a smart link
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { smartLinkRepository } from '@/lib/repositories/SmartLinkRepository';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { z } from 'zod';

// Placeholder that can be used in destination URLs - will be replaced with actual userCode
const USER_CODE_PLACEHOLDER = '{userCode}';

const logger = createLogger({ module: 'SmartLinkDetailAPI' });

interface RouteParams {
  params: Promise<{ id: string }>;
}

// Metadata schema for smart link configuration
const SmartLinkMetadataSchema = z.object({
  journeyType: z.enum(['contact-only', 'full']).optional(),
  serviceIds: z.array(z.string()).optional(),
  flow: z.array(z.string()).optional(),
  destinationType: z.enum(['form', 'booking']).optional()
}).optional();

// Validation schema for updating a smart link
const UpdateSmartLinkSchema = z.object({
  name: z.string().max(255).optional(),
  destination_url: z.string().url().optional(),
  destination_type: z.enum(['booking', 'form', 'payment', 'landing', 'website']).optional(),
  source: z.string().max(100).optional().nullable(),
  medium: z.string().max(100).optional().nullable(),
  campaign: z.string().max(100).optional().nullable(),
  content: z.string().max(100).optional().nullable(),
  is_active: z.boolean().optional(),
  metadata: SmartLinkMetadataSchema
});

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, linkId: id });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Get the smart link
    const result = await smartLinkRepository.findById(id, user.id);

    if (result.error) {
      throw result.error;
    }

    if (!result.data) {
      return NextResponse.json({ success: false, error: 'Link not found' }, { status: 404 });
    }

    // Get stats if requested
    const url = new URL(request.url);
    const includeStats = url.searchParams.get('stats') === 'true';
    const statsDays = parseInt(url.searchParams.get('days') || '30', 10);

    let stats = null;
    if (includeStats) {
      const statsResult = await smartLinkRepository.getClickStats(id, user.id, statsDays);
      if (statsResult.data) {
        stats = statsResult.data;
      }
    }

    // Build the short URL
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.agentspilot.com';
    const shortUrl = `${baseUrl}/go/${result.data.code}`;

    return NextResponse.json({
      success: true,
      link: result.data,
      shortUrl,
      ...(stats ? { stats } : {})
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to get smart link');
    return NextResponse.json(
      { success: false, error: 'Failed to get smart link' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, linkId: id });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const validated = UpdateSmartLinkSchema.parse(body);

    // Verify link exists and belongs to user
    const existingResult = await smartLinkRepository.findById(id, user.id);
    if (!existingResult.data) {
      return NextResponse.json({ success: false, error: 'Link not found' }, { status: 404 });
    }

    // If destination_url contains {userCode} placeholder or /c/ path, replace with actual userCode
    let destinationUrl = validated.destination_url;
    if (destinationUrl && (destinationUrl.includes(USER_CODE_PLACEHOLDER) || destinationUrl.includes('/c/'))) {
      const userCodeResult = await businessProfileRepository.getUserCode(user.id);
      if (userCodeResult.data) {
        const actualUserCode = userCodeResult.data;
        // Replace all placeholder occurrences
        destinationUrl = destinationUrl.replaceAll(USER_CODE_PLACEHOLDER, actualUserCode);
        // Fix any /c/[wrongCode]/ patterns - match userCode followed by / or ?
        destinationUrl = destinationUrl.replace(/\/c\/[a-z0-9]+(?=\/|\?)/i, `/c/${actualUserCode}`);
        requestLogger.info({ originalUrl: validated.destination_url, fixedUrl: destinationUrl, actualUserCode }, 'Fixed userCode in destination URL');
      }
    }

    // Update the link
    const result = await smartLinkRepository.update(id, user.id, {
      name: validated.name,
      destination_url: destinationUrl,
      destination_type: validated.destination_type,
      source: validated.source ?? undefined,
      medium: validated.medium ?? undefined,
      campaign: validated.campaign ?? undefined,
      content: validated.content ?? undefined,
      is_active: validated.is_active,
      metadata: validated.metadata
    });

    if (result.error || !result.data) {
      throw result.error || new Error('Failed to update smart link');
    }

    requestLogger.info({ userId: user.id, linkId: id }, 'Smart link updated');

    return NextResponse.json({
      success: true,
      link: result.data
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error }, 'Failed to update smart link');
    return NextResponse.json(
      { success: false, error: 'Failed to update smart link' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, linkId: id });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Verify link exists and belongs to user
    const existingResult = await smartLinkRepository.findById(id, user.id);
    if (!existingResult.data) {
      return NextResponse.json({ success: false, error: 'Link not found' }, { status: 404 });
    }

    // Soft delete (deactivate)
    const result = await smartLinkRepository.delete(id, user.id);

    if (result.error) {
      throw result.error;
    }

    requestLogger.info({ userId: user.id, linkId: id }, 'Smart link deleted');

    return NextResponse.json({ success: true });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to delete smart link');
    return NextResponse.json(
      { success: false, error: 'Failed to delete smart link' },
      { status: 500 }
    );
  }
}
