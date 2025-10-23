// app/api/newsletter/subscribe/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabaseServer';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email } = body;

    // Validate email
    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Email is required' },
        { status: 400 }
      );
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { success: false, error: 'Invalid email format' },
        { status: 400 }
      );
    }

    const supabase = createServerSupabaseClient();

    // Check if email already exists
    const { data: existing } = await supabase
      .from('newsletter_subscribers')
      .select('id, is_active')
      .eq('email', email.toLowerCase())
      .single();

    if (existing) {
      if (existing.is_active) {
        return NextResponse.json(
          { success: false, error: 'This email is already subscribed' },
          { status: 409 }
        );
      } else {
        // Reactivate subscription
        const { error: updateError } = await supabase
          .from('newsletter_subscribers')
          .update({ is_active: true, subscribed_at: new Date().toISOString() })
          .eq('id', existing.id);

        if (updateError) {
          console.error('Error reactivating subscription:', updateError);
          return NextResponse.json(
            { success: false, error: 'Failed to reactivate subscription' },
            { status: 500 }
          );
        }

        return NextResponse.json({
          success: true,
          message: 'Welcome back! Your subscription has been reactivated.'
        });
      }
    }

    // Insert new subscription
    const { error: insertError } = await supabase
      .from('newsletter_subscribers')
      .insert({
        email: email.toLowerCase(),
        source: 'footer_form',
        metadata: {
          user_agent: req.headers.get('user-agent') || 'unknown',
          referrer: req.headers.get('referer') || 'direct'
        }
      });

    if (insertError) {
      console.error('Error inserting subscription:', insertError);
      return NextResponse.json(
        { success: false, error: 'Failed to subscribe. Please try again.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Thank you for subscribing! Check your email for updates.'
    });

  } catch (error: any) {
    console.error('Newsletter subscription error:', error);
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
