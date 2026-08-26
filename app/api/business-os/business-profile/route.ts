/**
 * Business Profile API Endpoint
 *
 * Lightweight endpoint to fetch user's business vertical and language
 * for UI components that need personalization context.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'BusinessProfileAPI' });

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

    requestLogger.info({ userId: user.id }, 'Fetching business profile context');

    // 2. Fetch business profile
    const { data: profile, error } = await supabaseServer
      .from('business_profiles')
      .select('vertical, sub_vertical, language, company_size')
      .eq('user_id', user.id)
      .single();

    if (error) {
      requestLogger.error({ err: error, userId: user.id }, 'Failed to fetch business profile');
      return NextResponse.json(
        { success: false, error: 'Failed to fetch business profile' },
        { status: 500 }
      );
    }

    // 3. Return profile context
    return NextResponse.json({
      success: true,
      vertical: profile?.vertical || null,
      sub_vertical: profile?.sub_vertical || null,
      language: profile?.language || 'en',
      company_size: profile?.company_size || null,
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Business profile request failed');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
