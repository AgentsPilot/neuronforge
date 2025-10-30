// lib/stripe/client.ts
// Client-side Stripe utilities

import { loadStripe } from '@stripe/stripe-js';

// Initialize Stripe.js with publishable key
export const getStripe = () => {
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (!publishableKey) {
    throw new Error('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set');
  }
  return loadStripe(publishableKey);
};

// Create checkout session and redirect
export async function createCheckoutSession({
  planKey,
  billingCycle,
  boostPackSize,
  mode,
}: {
  planKey?: string;
  billingCycle?: 'monthly' | 'annual';
  boostPackSize?: '25k' | '100k' | '250k';
  mode: 'subscription' | 'boost_pack';
}) {
  try {
    // Get auth token
    const token = localStorage.getItem('supabase.auth.token');
    if (!token) {
      throw new Error('Not authenticated');
    }

    const response = await fetch('/api/stripe/create-checkout-session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        planKey,
        billingCycle,
        boostPackSize,
        mode,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create checkout session');
    }

    const { url } = await response.json();

    // Redirect to Stripe Checkout
    if (url) {
      window.location.href = url;
    }
  } catch (error) {
    console.error('Error creating checkout session:', error);
    throw error;
  }
}

// Open billing portal
export async function openBillingPortal() {
  try {
    // Get auth token
    const token = localStorage.getItem('supabase.auth.token');
    if (!token) {
      throw new Error('Not authenticated');
    }

    const response = await fetch('/api/stripe/create-portal-session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create portal session');
    }

    const { url } = await response.json();

    // Redirect to Stripe Customer Portal
    if (url) {
      window.location.href = url;
    }
  } catch (error) {
    console.error('Error opening billing portal:', error);
    throw error;
  }
}
