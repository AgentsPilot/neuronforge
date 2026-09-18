// app/api/stripe/create-checkout/route.ts
// API route to create Stripe checkout session for custom credit purchases or boost packs

import { NextRequest, NextResponse } from 'next/server';
import { AuditTrail as auditTrail } from '@/lib/services/AuditTrailService';
import { createLogger } from '@/lib/logger';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getStripeService } from '@/lib/stripe/StripeService';

const logger = createLogger({ module: 'StripeCreateCheckoutAPI' });

export async function POST(request: NextRequest) {
  try {
    // Create Supabase client with cookie handler (same pattern as working API routes)
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

    console.log('👤 [Stripe Checkout] Auth check:', {
      hasUser: !!user,
      userId: user?.id,
      error: authError?.message
    });

    if (authError || !user) {
      console.error('❌ [Stripe Checkout] Auth failed:', authError);
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { purchaseType, boostPackId } = body;

    // Validate purchase type
    if (!['custom_credits', 'boost_pack'].includes(purchaseType)) {
      return NextResponse.json(
        { error: 'Invalid purchase type' },
        { status: 400 }
      );
    }

    // Get user profile for name
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, display_name')
      .eq('id', user.id)
      .single();

    const userName = profile?.full_name || profile?.display_name || undefined;

    // Get Stripe service
    const stripeService = getStripeService();

    // Construct URLs
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.headers.get('origin') || 'http://localhost:3000';
    const successUrl = `${baseUrl}/v2/billing?success=true`;
    const cancelUrl = `${baseUrl}/v2/billing?canceled=true`;

    let session;

    if (purchaseType === 'custom_credits') {
      // Custom credit amount with recurring billing
      const { pilotCredits } = body;

      if (!pilotCredits || pilotCredits < 1000) {
        return NextResponse.json(
          { error: 'Minimum purchase is 1,000 Pilot Credits' },
          { status: 400 }
        );
      }

      if (pilotCredits > 10000000) {
        return NextResponse.json(
          { error: 'Maximum purchase is 10,000,000 Pilot Credits' },
          { status: 400 }
        );
      }

      session = await stripeService.createCustomCreditSubscription({
        supabase,
        userId: user.id,
        email: user.email!,
        name: userName,
        pilotCredits,
        successUrl,
        cancelUrl
      });

      // AUDIT TRAIL: Log subscription checkout initiated
      // In-process, not an HTTP call to /api/audit/log: that route now takes the
      // account from the session, which a server-to-server fetch does not carry.
      // Severity and flags come from EVENT_METADATA, set to exactly what this
      // route sent before (Layer 3 step 0, Q-1, WC-12). Not awaited.
      void auditTrail
        .log({
          action: 'SUBSCRIPTION_CHECKOUT_INITIATED',
          entityType: 'subscription',
          entityId: session.id,
          resourceName: `${pilotCredits.toLocaleString()} Pilot Credits/month`,
          details: {
            pilot_credits: pilotCredits,
            session_id: session.id,
            timestamp: new Date().toISOString()
          },
          userId: user.id,
        })
        .catch((err: unknown) => logger.error({ err, userId: user.id }, 'Audit entry could not be queued'));

    } else if (purchaseType === 'boost_pack') {
      // One-time boost pack purchase
      if (!boostPackId) {
        return NextResponse.json(
          { error: 'Boost pack ID is required' },
          { status: 400 }
        );
      }

      session = await stripeService.createBoostPackCheckout({
        supabase,
        userId: user.id,
        email: user.email!,
        name: userName,
        boostPackId,
        successUrl,
        cancelUrl
      });

      // AUDIT TRAIL: Log boost pack checkout initiated
      // In-process, not an HTTP call to /api/audit/log: that route now takes the
      // account from the session, which a server-to-server fetch does not carry.
      // Severity and flags come from EVENT_METADATA, set to exactly what this
      // route sent before (Layer 3 step 0, Q-1, WC-12). Not awaited.
      void auditTrail
        .log({
          action: 'BOOST_PACK_CHECKOUT_INITIATED',
          entityType: 'boost_pack',
          entityId: boostPackId,
          resourceName: 'Boost Pack Purchase',
          details: {
            boost_pack_id: boostPackId,
            session_id: session.id,
            timestamp: new Date().toISOString()
          },
          userId: user.id,
        })
        .catch((err: unknown) => logger.error({ err, userId: user.id }, 'Audit entry could not be queued'));
    }

    return NextResponse.json({
      sessionId: session!.id,
      clientSecret: session!.client_secret // For embedded checkout
    });

  } catch (error: any) {
    console.error('Error creating checkout session:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create checkout session' },
      { status: 500 }
    );
  }
}
