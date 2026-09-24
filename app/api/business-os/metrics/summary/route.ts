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
  /**
   * Owed in the PRIMARY currency only — not a sum across currencies.
   *
   * Identical to the old field for a single-currency business. For a mixed one
   * the old figure was meaningless (300 USD + 300 ILS = 600 of nothing), so
   * read `pendingPaymentsByCurrency` whenever more than one row comes back.
   */
  pendingPaymentsAmount: number;
  /** Owed per currency — the only totals that may honestly be added. */
  pendingPaymentsByCurrency: { currency: string; amount: number }[];
  /** What `pendingPaymentsAmount` is denominated in. Null when nothing is owed. */
  primaryCurrency: string | null;
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
      { data: businessProfile },
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

      // Pending invoices (for count + amount). `currency` is selected because
      // the total below cannot be computed without it — see the note there.
      supabaseServer
        .from('payment_invoices')
        .select('amount, currency')
        .eq('user_id', user.id)
        .in('status', ['sent', 'overdue']),

      // Active clients
      supabaseServer
        .from('crm_contacts')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('stage', 'client'),

      // The business's own currency, to label invoices written before
      // `payment_invoices.currency` was populated. Nullable by design: NULL
      // means the owner has not stated one, which is not the same as USD.
      supabaseServer
        .from('business_profiles')
        .select('currency')
        .eq('user_id', user.id)
        .maybeSingle(),
    ]);

    const businessCurrency = businessProfile?.currency?.toUpperCase() ?? null;

    const pendingPayments = pendingInvoices?.length || 0;

    /*
     * MONEY IS ONLY ADDABLE WITHIN ONE CURRENCY.
     *
     * This used to `reduce` every pending invoice into one number regardless of
     * what each was denominated in, so a business owed 300 USD and 300 ILS was
     * told it was owed 600 — of nothing. There is no FX rate anywhere in the
     * platform, and inventing one here would be worse than not answering.
     *
     * Grouped instead, following `stats/route.ts`, which reports
     * `revenue_by_currency` alongside a `primary_currency` for the same reason.
     *
     * `pendingPaymentsAmount` is kept and still a bare number, because existing
     * callers read it — but it is now the total in the PRIMARY currency alone
     * rather than a sum across all of them. For the single-currency business,
     * which is nearly all of them, it is exactly the same figure as before.
     */
    const byCurrency = new Map<string, number>();
    for (const inv of pendingInvoices ?? []) {
      // NULL currency predates the column being populated; group it with the
      // business default rather than inventing a bucket nothing can label.
      const code = (inv.currency || businessCurrency || 'USD').toUpperCase();
      byCurrency.set(code, (byCurrency.get(code) ?? 0) + (parseFloat(inv.amount) || 0));
    }

    const pendingByCurrency = [...byCurrency.entries()]
      .map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 }))
      // Largest first, so the primary currency is the one carrying the money
      // rather than whichever invoice happened to be read first.
      .sort((a, b) => b.amount - a.amount);

    const primaryCurrency = pendingByCurrency[0]?.currency ?? businessCurrency ?? null;
    const pendingPaymentsAmount = pendingByCurrency[0]?.amount ?? 0;

    const metrics: BusinessMetrics = {
      sessionsToday: sessionsToday || 0,
      sessionsThisWeek: sessionsThisWeek || 0,
      pendingPayments,
      pendingPaymentsAmount,
      pendingPaymentsByCurrency: pendingByCurrency,
      primaryCurrency,
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
