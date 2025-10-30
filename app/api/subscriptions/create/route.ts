// app/api/subscriptions/create/route.ts
// Creates a dynamic Stripe subscription based on calculator inputs

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { CreditService } from '@/lib/services/CreditService';

export const runtime = 'nodejs';

interface CreateSubscriptionRequest {
  monthlyCredits: number;
  calculatorInputs: {
    numAgents: number;
    avgPluginsPerAgent: number;
    executionsPerDay: number;
  };
}

export async function POST(req: NextRequest) {
  try {
    const body: CreateSubscriptionRequest = await req.json();
    const { monthlyCredits, calculatorInputs } = body;

    // Validate inputs
    if (!monthlyCredits || monthlyCredits < 0) {
      return NextResponse.json(
        { error: 'Invalid monthly credits amount' },
        { status: 400 }
      );
    }

    if (!calculatorInputs) {
      return NextResponse.json(
        { error: 'Calculator inputs are required' },
        { status: 400 }
      );
    }

    // Get authenticated user
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

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Initialize CreditService
    const creditService = new CreditService(supabase);

    // Check if user already has a subscription
    const { data: existingSub } = await supabase
      .from('user_subscriptions')
      .select('stripe_subscription_id, subscription_type')
      .eq('user_id', user.id)
      .maybeSingle();

    if (existingSub?.stripe_subscription_id && existingSub.subscription_type === 'dynamic') {
      // User already has a dynamic subscription - update it instead
      try {
        const updatedSubscription = await creditService.updateSubscription(
          user.id,
          monthlyCredits,
          calculatorInputs
        );

        return NextResponse.json({
          success: true,
          message: 'Subscription updated successfully',
          subscription: {
            id: updatedSubscription.id,
            monthlyCredits,
            monthlyAmount: Math.max(monthlyCredits * 0.00048, 10.00),
          },
        });
      } catch (error) {
        console.error('Failed to update subscription:', error);
        return NextResponse.json(
          { error: 'Failed to update subscription' },
          { status: 500 }
        );
      }
    }

    // Create new subscription
    try {
      const subscription = await creditService.createSubscription(
        user.id,
        monthlyCredits,
        calculatorInputs
      );

      // Get checkout URL from subscription
      // Stripe will redirect back to success_url after payment
      const checkoutUrl = subscription.latest_invoice
        ? typeof subscription.latest_invoice === 'string'
          ? subscription.latest_invoice
          : (subscription.latest_invoice as any).hosted_invoice_url
        : null;

      return NextResponse.json({
        success: true,
        message: 'Subscription created successfully',
        subscription: {
          id: subscription.id,
          monthlyCredits,
          monthlyAmount: Math.max(monthlyCredits * 0.00048, 10.00),
        },
        checkoutUrl: checkoutUrl || `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
      });
    } catch (error: any) {
      console.error('Failed to create subscription:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to create subscription' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Create subscription error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
