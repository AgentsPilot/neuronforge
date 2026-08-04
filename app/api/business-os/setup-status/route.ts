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
  dismissedSteps: string[];
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

    // 2. Fetch all setup-related data in parallel (optimized - 4 queries instead of 6)
    const [
      { data: businessProfile },
      { count: servicesCount },
      { data: pluginConnections },
      { data: websitePage },
    ] = await Promise.all([
      // Business profile - includes availability and dismissed steps
      // Using * to ensure we get all columns including newly added ones
      supabaseServer
        .from('business_profiles')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle(),
      // Services count
      supabaseServer
        .from('scheduling_services')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'active'),
      // All relevant plugin connections in one query
      supabaseServer
        .from('plugin_connections')
        .select('plugin_key')
        .eq('user_id', user.id)
        .in('plugin_key', ['stripe', 'google_calendar', 'outlook_calendar'])
        .eq('status', 'active'),
      // Website page - check if user has a published homepage
      supabaseServer
        .from('website_pages')
        .select('id, published, subdomain')
        .eq('user_id', user.id)
        .eq('page_type', 'homepage')
        .maybeSingle(),
    ]);

    // Debug: Log the full businessProfile to see all fields
    requestLogger.info({ businessProfile }, 'Full business profile from DB');

    // 3. Determine completion status for each step
    const connectedPlugins = new Set(pluginConnections?.map(p => p.plugin_key) || []);
    const hasServices = (servicesCount || 0) > 0;

    // Check if availability has at least one day with time slots
    const availability = businessProfile?.scheduling_availability as Record<string, Array<{ start: string; end: string }>> | null;
    const hasAvailability = !!(availability &&
      Object.values(availability).some(slots => Array.isArray(slots) && slots.length > 0));

    const hasStripe = connectedPlugins.has('stripe');
    const hasCalendar = connectedPlugins.has('google_calendar') || connectedPlugins.has('outlook_calendar');
    const hasWebsite = !!(websitePage?.published && websitePage?.subdomain);

    // 4. Build steps array (order matters for display)
    // Only include steps that are NOT complete - we only show what's missing
    const steps: SetupStep[] = [
      { id: 'services', complete: hasServices },
      { id: 'availability', complete: hasAvailability },
      { id: 'payments', complete: hasStripe },
      { id: 'calendar', complete: hasCalendar },
      { id: 'website', complete: hasWebsite },
    ];

    const completedCount = steps.filter(s => s.complete).length;
    const totalCount = steps.length;
    const allComplete = completedCount === totalCount;
    const dismissed = businessProfile?.setup_checklist_dismissed || false;

    // Handle dismissed_setup_steps which might be TEXT[] array or JSON string
    let dismissedSteps: string[] = [];
    const rawDismissed = businessProfile?.dismissed_setup_steps;
    requestLogger.info({ rawDismissed, type: typeof rawDismissed, isArray: Array.isArray(rawDismissed) }, 'Raw dismissed steps from DB');
    if (rawDismissed) {
      if (Array.isArray(rawDismissed)) {
        dismissedSteps = rawDismissed;
      } else if (typeof rawDismissed === 'string') {
        try {
          dismissedSteps = JSON.parse(rawDismissed);
        } catch {
          dismissedSteps = [];
        }
      }
    }
    requestLogger.info({ dismissedSteps }, 'Parsed dismissed steps');

    const status: SetupStatus = {
      steps,
      completedCount,
      totalCount,
      allComplete,
      dismissed,
      dismissedSteps,
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
