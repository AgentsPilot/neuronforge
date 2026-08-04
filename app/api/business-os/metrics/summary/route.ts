/**
 * GET /api/business-os/metrics/summary
 * Returns summary metrics for the Business OS dashboard
 * - Sessions today/this week
 * - Pending payments (count + amount)
 * - Active clients count
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'BusinessMetricsSummaryAPI' });

export interface BusinessMetrics {
  sessionsToday: number;
  sessionsThisWeek: number;
  pendingPayments: number;
  pendingPaymentsAmount: number;
  activeClients: number;
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

    requestLogger.info({ userId: user.id }, 'Fetching business metrics summary');

    // Calculate date ranges
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

    // Week starts on Sunday
    const dayOfWeek = now.getDay();
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek).toISOString();
    const weekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek + 7).toISOString();

    // 2. Fetch all metrics in parallel
    const [
      { count: sessionsToday },
      { count: sessionsThisWeek },
      { data: pendingInvoices },
      { count: activeClients },
    ] = await Promise.all([
      // Sessions today (confirmed bookings)
      supabaseServer
        .from('scheduling_bookings')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('start_time', todayStart)
        .lt('start_time', todayEnd)
        .in('status', ['confirmed', 'completed']),

      // Sessions this week
      supabaseServer
        .from('scheduling_bookings')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('start_time', weekStart)
        .lt('start_time', weekEnd)
        .in('status', ['confirmed', 'completed']),

      // Pending invoices (for count + amount)
      supabaseServer
        .from('payment_invoices')
        .select('amount')
        .eq('user_id', user.id)
        .in('status', ['sent', 'overdue']),

      // Active clients
      supabaseServer
        .from('crm_contacts')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('stage', 'client'),
    ]);

    // Calculate pending payments totals
    const pendingPayments = pendingInvoices?.length || 0;
    const pendingPaymentsAmount = pendingInvoices?.reduce(
      (sum, inv) => sum + (parseFloat(inv.amount) || 0),
      0
    ) || 0;

    const metrics: BusinessMetrics = {
      sessionsToday: sessionsToday || 0,
      sessionsThisWeek: sessionsThisWeek || 0,
      pendingPayments,
      pendingPaymentsAmount,
      activeClients: activeClients || 0,
    };

    requestLogger.info(
      { userId: user.id, metrics },
      'Business metrics fetched'
    );

    return NextResponse.json({
      success: true,
      data: metrics,
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to fetch business metrics');
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
