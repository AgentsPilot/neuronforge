/**
 * Smart Links API
 * GET - List user's smart links
 * POST - Create a new smart link
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { smartLinkRepository } from '@/lib/repositories/SmartLinkRepository';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { z } from 'zod';

// Placeholder that can be used in destination URLs - will be replaced with actual userCode
const USER_CODE_PLACEHOLDER = '{userCode}';

const logger = createLogger({ module: 'SmartLinksAPI' });

// Metadata schema for smart link configuration
const SmartLinkMetadataSchema = z.object({
  journeyType: z.enum(['contact-only', 'full']).optional(),
  serviceIds: z.array(z.string()).optional(),
  flow: z.array(z.string()).optional(),
  destinationType: z.enum(['form', 'booking']).optional()
}).optional();

// Validation schema for creating a smart link
const CreateSmartLinkSchema = z.object({
  name: z.string().max(255).optional(),
  destination_url: z.string().url(),
  destination_type: z.enum(['booking', 'form', 'payment', 'landing', 'website']).optional(),
  source: z.string().max(100).optional(),
  medium: z.string().max(100).optional(),
  campaign: z.string().max(100).optional(),
  content: z.string().max(100).optional(),
  metadata: SmartLinkMetadataSchema
});

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const activeOnly = url.searchParams.get('active') !== 'false';
    const destinationType = url.searchParams.get('type') as 'booking' | 'form' | 'payment' | 'landing' | 'website' | null;
    const includeDefaults = url.searchParams.get('includeDefaults') === 'true';

    // Get user's smart links
    const result = await smartLinkRepository.listByUser(user.id, {
      activeOnly,
      destinationType: destinationType || undefined
    });

    if (result.error) {
      throw result.error;
    }

    // If requested, ensure default links exist
    let defaultLinks = null;
    if (includeDefaults) {
      const userCodeResult = await businessProfileRepository.getUserCode(user.id);
      if (userCodeResult.data) {
        const defaultsResult = await smartLinkRepository.getOrCreateDefaultLinks(user.id, userCodeResult.data);
        defaultLinks = defaultsResult.data;
      }
    }

    requestLogger.info(
      { userId: user.id, linkCount: result.data?.length || 0, includeDefaults },
      'Listed smart links'
    );

    return NextResponse.json({
      success: true,
      links: result.data || [],
      ...(defaultLinks ? { defaultLinks } : {})
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to list smart links');
    return NextResponse.json(
      { success: false, error: 'Failed to list smart links' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const validated = CreateSmartLinkSchema.parse(body);

    // If destination_url contains {userCode} placeholder or /c/ path, replace with actual userCode
    let destinationUrl = validated.destination_url;
    if (destinationUrl.includes(USER_CODE_PLACEHOLDER) || destinationUrl.includes('/c/')) {
      // Get user's actual userCode from database
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

    const result = await smartLinkRepository.create(user.id, {
      name: validated.name,
      destination_url: destinationUrl,
      destination_type: validated.destination_type,
      source: validated.source,
      medium: validated.medium,
      campaign: validated.campaign,
      content: validated.content,
      metadata: validated.metadata
    });

    if (result.error || !result.data) {
      throw result.error || new Error('Failed to create smart link');
    }

    // Build the short URL
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.agentspilot.com';
    const shortUrl = `${baseUrl}/go/${result.data.code}`;

    requestLogger.info(
      { userId: user.id, linkId: result.data.id, code: result.data.code },
      'Smart link created'
    );

    return NextResponse.json({
      success: true,
      link: result.data,
      shortUrl
    }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error }, 'Failed to create smart link');
    return NextResponse.json(
      { success: false, error: 'Failed to create smart link' },
      { status: 500 }
    );
  }
}
