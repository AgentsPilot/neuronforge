import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'MyDayAPI' });

interface StoryBeat {
  type: 'done' | 'next' | 'run';
  titleKey: string;
  titleParams?: Record<string, string | number>;
  subtitleKey: string;
  subtitleParams?: Record<string, string | number>;
}

interface SummaryData {
  key: string;
  params?: Record<string, string | number>;
  parts?: Array<{ key: string; params?: Record<string, string | number> }>;
}

function getGreeting(): 'morning' | 'afternoon' | 'evening' {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

export async function GET(request: NextRequest) {
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

    requestLogger.info({ userId: user.id }, 'Fetching My Day data');

    // Fetch user profile for name
    const { data: profile } = await supabaseServer
      .from('business_profiles')
      .select('business_name, owner_name')
      .eq('user_id', user.id)
      .single();

    // Get user's first name from profile or auth metadata
    const userName = profile?.owner_name?.split(' ')[0] ||
                     user.user_metadata?.full_name?.split(' ')[0] ||
                     user.email?.split('@')[0] ||
                     'there';

    // Fetch recent successful agent executions (done tasks)
    const { data: recentExecutions } = await supabaseServer
      .from('agent_executions')
      .select('id, agent_id, created_at, status')
      .eq('user_id', user.id)
      .eq('status', 'success')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(5);

    // Fetch today's upcoming bookings
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const { data: todaysBookings } = await supabaseServer
      .from('scheduling_bookings')
      .select('id, client_first_name, start_time, status')
      .eq('user_id', user.id)
      .gte('start_time', today.toISOString())
      .lt('start_time', tomorrow.toISOString())
      .eq('status', 'confirmed')
      .order('start_time', { ascending: true })
      .limit(5);

    // Fetch running automations (active agent executions)
    const { data: runningExecutions } = await supabaseServer
      .from('agent_executions')
      .select('id, agent_id')
      .eq('user_id', user.id)
      .eq('status', 'running')
      .limit(10);

    // Fetch pending invoices
    const { data: pendingInvoices } = await supabaseServer
      .from('payment_invoices')
      .select('id, amount, status')
      .eq('user_id', user.id)
      .in('status', ['pending', 'overdue'])
      .limit(10);

    // Fetch new contacts from the last 24 hours
    const { data: newContacts } = await supabaseServer
      .from('crm_contacts')
      .select('id')
      .eq('user_id', user.id)
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    // Build story beats with translation keys
    const storyBeats: StoryBeat[] = [];

    // Done beat - recent completions
    const completedCount = recentExecutions?.length || 0;
    const newContactCount = newContacts?.length || 0;
    if (completedCount > 0 || newContactCount > 0) {
      storyBeats.push({
        type: 'done',
        titleKey: newContactCount > 0
          ? 'myday.beat.replied_enquiries'
          : 'myday.beat.completed_tasks',
        titleParams: { count: newContactCount > 0 ? newContactCount : completedCount },
        subtitleKey: 'myday.beat.overnight_subtitle'
      });
    } else {
      storyBeats.push({
        type: 'done',
        titleKey: 'myday.beat.all_caught_up',
        subtitleKey: 'myday.beat.no_tasks_subtitle'
      });
    }

    // Next beat - upcoming sessions
    const upcomingCount = todaysBookings?.length || 0;
    if (upcomingCount > 0) {
      const nextBooking = todaysBookings![0];
      const time = new Date(nextBooking.start_time).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
      storyBeats.push({
        type: 'next',
        titleKey: upcomingCount === 1
          ? 'myday.beat.session_at'
          : 'myday.beat.session_at_more',
        titleParams: { name: nextBooking.client_first_name, time, count: upcomingCount - 1 },
        subtitleKey: upcomingCount > 1 ? 'myday.beat.sessions_today_plural' : 'myday.beat.sessions_today',
        subtitleParams: { count: upcomingCount }
      });
    } else {
      storyBeats.push({
        type: 'next',
        titleKey: 'myday.beat.no_sessions',
        subtitleKey: 'myday.beat.calendar_clear'
      });
    }

    // Running beat 1 - follow-ups
    const runningCount = runningExecutions?.length || 0;
    storyBeats.push({
      type: 'run',
      titleKey: runningCount > 0
        ? 'myday.beat.following_up'
        : 'myday.beat.monitoring',
      titleParams: runningCount > 0 ? { count: runningCount } : undefined,
      subtitleKey: runningCount > 0
        ? 'myday.beat.following_subtitle'
        : 'myday.beat.monitoring_subtitle'
    });

    // Running beat 2 - invoice chasing
    const pendingAmount = pendingInvoices?.reduce((sum, inv) => sum + (inv.amount || 0), 0) || 0;
    const pendingCount = pendingInvoices?.length || 0;
    storyBeats.push({
      type: 'run',
      titleKey: pendingAmount > 0
        ? 'myday.beat.chasing_invoices'
        : 'myday.beat.all_paid',
      titleParams: pendingAmount > 0 ? { amount: `$${pendingAmount.toLocaleString()}` } : undefined,
      subtitleKey: pendingCount > 0
        ? (pendingCount > 1 ? 'myday.beat.clients_reminded_plural' : 'myday.beat.clients_reminded')
        : 'myday.beat.no_outstanding',
      subtitleParams: pendingCount > 0 ? { count: pendingCount } : undefined
    });

    // Build summary data with translation keys
    const summaryParts: Array<{ key: string; params?: Record<string, string | number> }> = [];
    if (newContactCount > 0) {
      summaryParts.push({ key: 'myday.summary.new_people', params: { count: newContactCount } });
    }
    if (upcomingCount > 0) {
      summaryParts.push({
        key: upcomingCount > 1 ? 'myday.summary.sessions_today_plural' : 'myday.summary.sessions_today',
        params: { count: upcomingCount }
      });
    }
    if (pendingAmount > 0) {
      summaryParts.push({ key: 'myday.summary.chasing_owed' });
    }

    const summaryData: SummaryData = summaryParts.length > 0
      ? { key: 'myday.summary.composite', parts: summaryParts }
      : { key: 'myday.summary.default' };

    return NextResponse.json({
      success: true,
      data: {
        userName,
        greeting: getGreeting(),
        summaryData,
        storyBeats
      }
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to fetch My Day data');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
