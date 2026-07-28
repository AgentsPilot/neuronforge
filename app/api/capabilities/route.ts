/**
 * GET /api/capabilities - Get user's enabled capabilities
 * Returns the list of capability keys the user has enabled
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'CapabilitiesAPI' });

export async function GET(request: NextRequest) {
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

    requestLogger.info({ userId: user.id }, 'Fetching user capabilities');

    // 2. Fetch user's enabled capabilities with capability details
    const { data: userCapabilities, error } = await supabaseServer
      .from('user_capabilities')
      .select(`
        id,
        is_active,
        configuration,
        capability_id,
        capabilities (
          capability_key,
          name_en,
          name_es,
          name_he,
          icon,
          color,
          category
        )
      `)
      .eq('user_id', user.id)
      .eq('is_active', true);

    if (error) {
      requestLogger.error({ err: error, userId: user.id }, 'Failed to fetch user capabilities');
      return NextResponse.json(
        { success: false, error: 'Failed to fetch capabilities' },
        { status: 500 }
      );
    }

    // 3. Extract capability keys for easy lookup
    const enabledCapabilities = (userCapabilities || []).map(uc => {
      const cap = uc.capabilities as {
        capability_key: string;
        name_en: string;
        name_es: string;
        name_he: string;
        icon: string;
        color: string;
        category: string;
      };
      return {
        key: cap.capability_key,
        name_en: cap.name_en,
        name_es: cap.name_es,
        name_he: cap.name_he,
        icon: cap.icon,
        color: cap.color,
        category: cap.category,
        configuration: uc.configuration
      };
    });

    // 4. Create a simple set of enabled capability keys for quick checks
    const enabledKeys = enabledCapabilities.map(c => c.key);

    requestLogger.info(
      { userId: user.id, enabledCount: enabledKeys.length, enabledKeys },
      'User capabilities fetched'
    );

    // 5. Return success
    return NextResponse.json({
      success: true,
      capabilities: enabledCapabilities,
      enabledKeys
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Request failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
      },
      { status: 500 }
    );
  }
}
