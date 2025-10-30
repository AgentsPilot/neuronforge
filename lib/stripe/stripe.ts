// lib/stripe/stripe.ts
// Stripe SDK initialization and utilities

import Stripe from 'stripe';

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is not set in environment variables');
}

// Initialize Stripe with secret key (server-side only)
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-12-18.acacia',
  typescript: true,
});

// Product IDs for dynamic pricing
export const STRIPE_PRODUCTS = {
  pilotCredits: process.env.STRIPE_PILOT_CREDITS_PRODUCT_ID || '',
};

// Price ID mapping for boost packs
export const STRIPE_BOOST_PACK_PRICES = {
  boost_25k: process.env.STRIPE_PRICE_BOOST_25K || '',
  boost_100k: process.env.STRIPE_PRICE_BOOST_100K || '',
  boost_250k: process.env.STRIPE_PRICE_BOOST_250K || '',
};

// Helper to get boost pack price ID
export function getBoostPackPriceId(packKey: string): string {
  return STRIPE_BOOST_PACK_PRICES[packKey as keyof typeof STRIPE_BOOST_PACK_PRICES] || '';
}
