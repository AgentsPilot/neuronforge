// app/api/stripe/session-status/route.ts
// API route to check Stripe checkout session status

import { NextRequest, NextResponse } from 'next/server';
import { getStripeService } from '@/lib/stripe/StripeService';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const sessionId = searchParams.get('session_id');

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Missing session_id parameter' },
        { status: 400 }
      );
    }

    const stripeService = getStripeService();
    const session = await stripeService['stripe'].checkout.sessions.retrieve(sessionId);

    return NextResponse.json({
      status: session.status,
      customer_email: session.customer_details?.email,
      payment_status: session.payment_status
    });

  } catch (error: any) {
    console.error('Error retrieving session status:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to retrieve session status' },
      { status: 500 }
    );
  }
}
