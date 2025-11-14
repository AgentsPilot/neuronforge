// app/api/stripe/create-portal/route.ts
// API route to create Stripe customer portal session for subscription management

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getStripeService } from '@/lib/stripe/StripeService';

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

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get user's Stripe customer ID
    const { data: userSub, error: subError } = await supabase
      .from('user_subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .single();

    if (subError || !userSub?.stripe_customer_id) {
      return NextResponse.json(
        { error: 'No active subscription found' },
        { status: 404 }
      );
    }

    // Get Stripe service
    const stripeService = getStripeService();

    // Construct return URL
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.headers.get('origin') || 'http://localhost:3000';
    const returnUrl = `${baseUrl}/settings?tab=billing`;

    // Create portal session
    const session = await stripeService.createPortalSession(
      userSub.stripe_customer_id,
      returnUrl
    );

    // AUDIT TRAIL: Log portal session created
    await fetch(`${baseUrl}/api/audit/log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': user.id
      },
      body: JSON.stringify({
        action: 'CUSTOMER_PORTAL_ACCESSED',
        entityType: 'subscription',
        entityId: userSub.stripe_customer_id,
        userId: user.id,
        resourceName: 'Stripe Customer Portal',
        details: {
          session_id: session.id,
          timestamp: new Date().toISOString()
        },
        severity: 'info',
        complianceFlags: ['SOC2']
      })
    });

    return NextResponse.json({
      url: session.url
    });

  } catch (error: any) {
    console.error('Error creating portal session:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create portal session' },
      { status: 500 }
    );
  }
}
