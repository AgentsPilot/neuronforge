/**
 * Clear Advisor Cache API
 *
 * DELETE /api/v2/advisor/clear - Delete cached advisor report for current user
 *
 * Used for testing the user-triggered generation flow.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'AdvisorClearAPI' });

export async function DELETE(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { error } = await supabaseServer
      .from('advisor_reports')
      .delete()
      .eq('user_id', user.id);

    if (error) {
      requestLogger.error({ err: error }, 'Failed to clear advisor cache');
      return NextResponse.json(
        { success: false, error: 'Failed to clear cache' },
        { status: 500 }
      );
    }

    requestLogger.info({ userId: user.id }, 'Advisor cache cleared');

    return NextResponse.json({
      success: true,
      message: 'Advisor cache cleared. Refresh the page to see the prompt state.',
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to clear advisor cache');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
