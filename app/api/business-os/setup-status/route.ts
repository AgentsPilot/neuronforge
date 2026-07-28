/**
 * GET /api/business-os/setup-status - Get user's setup completion status
 * Returns which setup steps are complete and which are pending
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'SetupStatusAPI' });

export interface SetupStep {
  id: string;
  complete: boolean;
}

export interface SetupStatus {
  steps: SetupStep[];
  completedCount: number;
  totalCount: number;
  allComplete: boolean;
  dismissed: boolean;
}

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

    requestLogger.info({ userId: user.id }, 'Fetching setup status');

    // 2. Fetch all setup-related data in parallel
    const [
      { data: businessProfile },
      { count: servicesCount },
      { data: availabilityData },
      { data: stripeConnection },
    ] = await Promise.all([
      // Business profile (from onboarding)
      supabaseServer
        .from('business_profiles')
        .select('id, setup_checklist_dismissed')
        .eq('user_id', user.id)
        .maybeSingle(),
      // Services count
      supabaseServer
        .from('scheduling_services')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'active'),
      // Availability - check if business_profiles has scheduling_availability set
      supabaseServer
        .from('business_profiles')
        .select('scheduling_availability')
        .eq('user_id', user.id)
        .maybeSingle(),
      // Stripe connection
      supabaseServer
        .from('plugin_connections')
        .select('id')
        .eq('user_id', user.id)
        .eq('plugin_key', 'stripe')
        .eq('is_active', true)
        .maybeSingle(),
    ]);

    // 3. Determine completion status for each step
    const hasBusinessProfile = !!businessProfile;
    const hasServices = (servicesCount || 0) > 0;
    const hasAvailability = !!(availabilityData?.scheduling_availability &&
      Object.keys(availabilityData.scheduling_availability).length > 0);
    const hasStripe = !!stripeConnection;

    // 4. Build steps array (order matters for display)
    // Note: CRM contacts removed - doesn't require initial setup, users add contacts over time
    const steps: SetupStep[] = [
      { id: 'profile', complete: hasBusinessProfile },
      { id: 'services', complete: hasServices },
      { id: 'availability', complete: hasAvailability },
      { id: 'payments', complete: hasStripe },
      // Google Calendar is optional - only show if not connected
      // { id: 'calendar', complete: hasGoogleCalendar },
    ];

    const completedCount = steps.filter(s => s.complete).length;
    const totalCount = steps.length;
    const allComplete = completedCount === totalCount;
    const dismissed = businessProfile?.setup_checklist_dismissed || false;

    const status: SetupStatus = {
      steps,
      completedCount,
      totalCount,
      allComplete,
      dismissed,
    };

    requestLogger.info(
      { userId: user.id, completedCount, totalCount, allComplete },
      'Setup status fetched'
    );

    return NextResponse.json({
      success: true,
      status,
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to fetch setup status');
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

/**
 * POST /api/business-os/setup-status - Dismiss the setup checklist
 */
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

    requestLogger.info({ userId: user.id }, 'Dismissing setup checklist');

    // 2. Update business_profiles to mark checklist as dismissed
    const { error } = await supabaseServer
      .from('business_profiles')
      .update({ setup_checklist_dismissed: true })
      .eq('user_id', user.id);

    if (error) {
      // If no business profile exists, create one with dismissed flag
      const { error: insertError } = await supabaseServer
        .from('business_profiles')
        .insert({
          user_id: user.id,
          setup_checklist_dismissed: true,
        });

      if (insertError) {
        requestLogger.error({ err: insertError, userId: user.id }, 'Failed to dismiss setup checklist');
        return NextResponse.json(
          { success: false, error: 'Failed to dismiss checklist' },
          { status: 500 }
        );
      }
    }

    requestLogger.info({ userId: user.id }, 'Setup checklist dismissed');

    return NextResponse.json({ success: true });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to dismiss setup checklist');
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
