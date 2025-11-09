// app/api/stripe/invoices/route.ts
// API route to fetch Stripe invoices for the authenticated user

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-10-29.clover'
});

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

export async function GET(request: NextRequest) {
  try {
    // Create Supabase client
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get: (name) => cookieStore.get(name)?.value,
          set: async () => {},
          remove: async () => {},
        },
      }
    );

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get pagination params
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '10');
    const starting_after = searchParams.get('starting_after') || undefined;

    console.log('📋 [Invoices] Fetching invoices for user:', user.id, { limit, starting_after: starting_after || 'none' });

    // Get user's Stripe customer ID
    const { data: userSub } = await supabaseAdmin
      .from('user_subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .single();

    if (!userSub?.stripe_customer_id) {
      console.log('⚠️  [Invoices] No Stripe customer found');
      return NextResponse.json({ invoices: [], has_more: false });
    }

    // Get pricing config for credit calculation
    const { data: configData } = await supabaseAdmin
      .from('ais_system_config')
      .select('pilot_credit_cost_usd, tokens_per_pilot_credit')
      .single();

    const pilotCreditCostUsd = configData?.pilot_credit_cost_usd || 0.00048;
    const tokensPerPilotCredit = configData?.tokens_per_pilot_credit || 10;

    // Fetch invoices from Stripe with pagination
    const invoices = await stripe.invoices.list({
      customer: userSub.stripe_customer_id,
      limit,
      starting_after
    });

    console.log(`📋 [Invoices] Found ${invoices.data.length} invoices (has_more: ${invoices.has_more})`);

    // Transform invoices for frontend
    const formattedInvoices = await Promise.all(invoices.data.map(async (invoice) => {
      let pilotCredits = null;

      // Try to get credits from subscription metadata
      if ((invoice as any).subscription) {
        try {
          const subscription = await stripe.subscriptions.retrieve((invoice as any).subscription as string);
          const creditsFromMetadata = parseInt(subscription.metadata?.credits || subscription.metadata?.pilot_credits || '0');
          if (creditsFromMetadata > 0) {
            pilotCredits = creditsFromMetadata;
          }
        } catch (err) {
          console.log('⚠️  Could not fetch subscription for invoice:', invoice.id);
        }
      }

      // If no credits from subscription, calculate from amount paid
      if (!pilotCredits && invoice.amount_paid > 0) {
        const amountPaidUsd = invoice.amount_paid / 100;
        pilotCredits = Math.floor(amountPaidUsd / pilotCreditCostUsd);
      }

      return {
        id: invoice.id,
        number: invoice.number,
        created: invoice.created,
        amount_paid: invoice.amount_paid,
        amount_due: invoice.amount_due,
        currency: invoice.currency,
        status: invoice.status,
        hosted_invoice_url: invoice.hosted_invoice_url,
        invoice_pdf: invoice.invoice_pdf,
        description: invoice.lines.data[0]?.description || 'Subscription',
        period_start: invoice.period_start,
        period_end: invoice.period_end,
        metadata: invoice.metadata,
        pilot_credits: pilotCredits
      };
    }));

    return NextResponse.json({
      invoices: formattedInvoices,
      has_more: invoices.has_more,
      last_invoice_id: invoices.data.length > 0 ? invoices.data[invoices.data.length - 1].id : null
    });

  } catch (error: any) {
    console.error('❌ [Invoices] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch invoices' },
      { status: 500 }
    );
  }
}
