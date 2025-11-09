# Stripe Integration Setup Guide

## Overview

NeuronForge uses Stripe for billing with a **custom credit purchase model** (not fixed subscription plans).

**Business Model:**
- Users purchase a specific amount of **Pilot Credits** (e.g., 100,000 credits)
- Price is calculated from database: **$0.00048 per Pilot Credit** (configurable)
- This becomes a monthly recurring charge
- Users can increase/decrease credit amount for next billing cycle
- Users can purchase one-time "boost packs" for extra credits
- **All credits roll over completely** (no expiration)

**Pilot Credit System:**
- **1 Pilot Credit = 10 LLM Tokens**
- Default pricing: **$0.00048 per Pilot Credit** (from `ais_system_config` table)
- Example: 100,000 credits = $48/month
- Pricing is fetched from database and can be changed by admin

---

## 1. Environment Variables

Add these to your `.env.local` file:

```bash
# Stripe API Keys
STRIPE_SECRET_KEY=sk_test_...  # Get from Stripe Dashboard > Developers > API Keys
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...  # Get from Stripe Dashboard > Developers > API Keys

# Stripe Webhook Secret (for webhook signature verification)
STRIPE_WEBHOOK_SECRET=whsec_...  # Get after creating webhook endpoint in Stripe Dashboard

# Supabase Admin Key (for webhook handler to bypass RLS)
SUPABASE_SERVICE_ROLE_KEY=...  # Get from Supabase Dashboard > Settings > API

# App URL (for redirect URLs)
NEXT_PUBLIC_APP_URL=http://localhost:3000  # Change to production URL in production
```

---

## 2. Stripe Account Setup

### A. Create Stripe Account
1. Go to [https://dashboard.stripe.com/register](https://dashboard.stripe.com/register)
2. Create account and verify email
3. Complete business profile (optional for test mode)

### B. Enable Test Mode
1. In Stripe Dashboard, toggle **Test Mode** ON (top right)
2. All setup below should be done in **Test Mode** first

### C. Configure Customer Portal
1. Go to **Settings** > **Customer Portal**
2. Enable:
   - **Update payment method** ✅
   - **View invoice history** ✅
   - **Cancel subscription** ✅
   - **Update subscription** (to allow users to change amount)
3. Set cancellation behavior:
   - **Cancel at period end** ✅ (recommended)
   - Allow immediate cancellation: ❌
4. Save settings

---

## 3. Webhook Configuration

Webhooks are critical - they handle:
- Crediting users when payment succeeds
- Recording invoices
- Handling failed payments
- Managing subscription lifecycle

### A. Local Development (using Stripe CLI)

1. **Install Stripe CLI:**
   ```bash
   # Mac
   brew install stripe/stripe-cli/stripe

   # Windows
   scoop bucket add stripe https://github.com/stripe/scoop-stripe-cli.git
   scoop install stripe
   ```

2. **Login to Stripe:**
   ```bash
   stripe login
   ```

3. **Forward webhooks to local server:**
   ```bash
   stripe listen --forward-to localhost:3000/api/stripe/webhook
   ```

4. **Copy webhook signing secret** from output:
   ```
   > Ready! Your webhook signing secret is whsec_xxx (^C to quit)
   ```

5. **Add to `.env.local`:**
   ```bash
   STRIPE_WEBHOOK_SECRET=whsec_xxx
   ```

### B. Production Setup

1. Go to **Stripe Dashboard** > **Developers** > **Webhooks**
2. Click **Add endpoint**
3. Set endpoint URL: `https://yourdomain.com/api/stripe/webhook`
4. Select events to listen for:
   - `checkout.session.completed`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `customer.subscription.deleted`
   - `customer.subscription.updated`
5. Click **Add endpoint**
6. Copy **Signing secret** and add to production environment variables

---

## 4. Testing the Integration

### A. Test Cards

Use these test card numbers in Stripe checkout:

| Card Number | Scenario |
|-------------|----------|
| `4242 4242 4242 4242` | Successful payment |
| `4000 0000 0000 9995` | Payment declined |
| `4000 0025 0000 3155` | Requires authentication (3D Secure) |

- Use any future expiration date (e.g., 12/34)
- Use any 3-digit CVC (e.g., 123)
- Use any valid US ZIP (e.g., 12345)

### B. Test Custom Credit Purchase

1. Go to your app: `http://localhost:3000/settings?tab=billing`
2. Enter custom amount (e.g., $20)
3. Click "Purchase Credits"
4. Complete checkout with test card `4242 4242 4242 4242`
5. Verify:
   - Credits appear in dashboard
   - Invoice appears in billing history
   - Transaction logged in credit_transactions table
   - Subscription created in Stripe Dashboard

### C. Test Boost Pack Purchase

1. Go to billing settings
2. Click on a boost pack (e.g., "100K Boost - $20")
3. Complete checkout with test card
4. Verify credits added immediately (one-time, no subscription)

### D. Test Subscription Management

1. Go to billing settings
2. Click "Manage Subscription"
3. Opens Stripe Customer Portal
4. Test:
   - Update payment method
   - View invoices
   - Cancel subscription (should cancel at period end)

### E. Test Failed Payment

1. Create subscription with successful card
2. In **Stripe Dashboard** > **Subscriptions**, find your subscription
3. Click **...** > **Simulate** > **Payment failure**
4. Verify:
   - `payment_retry_count` incremented
   - Billing event logged
   - Grace period logic kicks in (configurable in admin settings)
   - Agents paused after grace period

---

## 5. Database Schema

### Tables Created (via migration):
- ✅ `boost_packs` - Available credit packages
- ✅ `subscription_invoices` - Invoice history
- ✅ `boost_pack_purchases` - One-time purchase tracking
- ✅ Extended `user_subscriptions` with Stripe fields
- ✅ Extended `billing_events` with Stripe fields

### Key Fields in `user_subscriptions`:
```sql
stripe_customer_id VARCHAR           -- Stripe customer ID
stripe_subscription_id VARCHAR       -- Stripe subscription ID
current_period_start TIMESTAMPTZ     -- Billing period start
current_period_end TIMESTAMPTZ       -- Billing period end
cancel_at_period_end BOOLEAN         -- Cancel scheduled?
grace_period_days INTEGER            -- Days before pausing agents (default: 3)
payment_retry_count INTEGER          -- Failed payment attempts
last_payment_attempt TIMESTAMPTZ     -- Last payment date
```

---

## 6. API Routes

### Created Routes:

1. **POST /api/stripe/create-checkout**
   - Creates Stripe checkout session
   - Supports: `custom_credits` or `boost_pack`
   - Returns: `{ sessionId, url }`

2. **POST /api/stripe/create-portal**
   - Creates customer portal session
   - Returns: `{ url }`

3. **POST /api/stripe/webhook**
   - Receives Stripe webhook events
   - Processes: invoice.paid, payment_failed, etc.
   - Updates database accordingly

---

## 7. Admin Configuration

Grace period for failed payments is configurable per user in `user_subscriptions.grace_period_days`.

**Default:** 3 days

To change system-wide default, update the migration or add to system settings.

---

## 8. Go Live Checklist

Before switching to production:

- [ ] Test all flows in test mode
- [ ] Configure production webhook endpoint
- [ ] Update environment variables with live API keys
- [ ] Disable test mode in Stripe Dashboard
- [ ] Configure tax collection (if needed)
- [ ] Set up payment retry logic (Stripe automatically retries)
- [ ] Configure email notifications for failed payments
- [ ] Test with real card (use small amount like $1)
- [ ] Monitor webhook deliveries in Stripe Dashboard

---

## 9. Monitoring

### Stripe Dashboard
- **Payments** > View all transactions
- **Subscriptions** > Monitor active subscriptions
- **Webhooks** > Check delivery status and logs

### Database Queries

```sql
-- Check user subscription status
SELECT * FROM user_subscriptions WHERE user_id = 'xxx';

-- View recent invoices
SELECT * FROM subscription_invoices ORDER BY created_at DESC LIMIT 10;

-- Check credit transactions
SELECT * FROM credit_transactions WHERE user_id = 'xxx' ORDER BY created_at DESC;

-- View billing events
SELECT * FROM billing_events ORDER BY created_at DESC LIMIT 20;
```

---

## 10. Troubleshooting

### Credits Not Added After Payment
1. Check webhook delivery in Stripe Dashboard
2. Check server logs for webhook processing errors
3. Verify `STRIPE_WEBHOOK_SECRET` is correct
4. Check `subscription_invoices` table for invoice record

### Webhook Signature Verification Failed
- Ensure `STRIPE_WEBHOOK_SECRET` matches webhook endpoint secret
- Check that raw body is passed to webhook handler (no JSON parsing before verification)

### Subscription Not Created
- Check checkout session metadata includes `user_id`
- Verify `stripe_customer_id` is saved in `user_subscriptions`
- Check Stripe Dashboard for subscription status

---

## 11. Security Notes

- ✅ Webhook signature verification implemented
- ✅ Server-side validation for all payment amounts
- ✅ User authentication required for checkout
- ✅ Admin Supabase client used in webhook (bypasses RLS securely)
- ✅ Idempotent webhook processing (using Stripe event IDs)
- ✅ Audit trail for all billing events (SOC2 compliant)

---

## Support

**Stripe Documentation:** https://stripe.com/docs
**Stripe Support:** https://support.stripe.com
**Test Mode Dashboard:** https://dashboard.stripe.com/test/dashboard
