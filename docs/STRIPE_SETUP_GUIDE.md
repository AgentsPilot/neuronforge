# 🔒 Stripe Integration Setup Guide

Complete guide for setting up Stripe payment processing for Pilot Credits billing.

---

## 📋 Prerequisites

- Stripe account (sign up at https://stripe.com)
- AgentPilot database with tables created (see PRICING_SYSTEM_IMPLEMENTATION_PLAN.md)
- Node.js packages installed (`stripe`, `@stripe/stripe-js`)

---

## 🚀 Setup Steps

### Step 1: Create Stripe Account

1. Go to https://dashboard.stripe.com/register
2. Complete account registration
3. Verify your email

### Step 2: Get API Keys

1. Go to https://dashboard.stripe.com/test/apikeys
2. Copy your **Publishable key** (starts with `pk_test_`)
3. Copy your **Secret key** (starts with `sk_test_`)
4. Add them to `.env.local`:

```bash
STRIPE_SECRET_KEY=sk_test_YOUR_SECRET_KEY_HERE
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_YOUR_PUBLISHABLE_KEY_HERE
```

### Step 3: Create Products and Prices

#### Create Subscription Plans

1. Go to https://dashboard.stripe.com/test/products
2. Click **"Add product"**
3. Create each plan:

**Explorer Plan:**
- Name: `Explorer Plan`
- Description: `Perfect for individuals and small projects`
- Pricing: `$12.00` per month (recurring)
- Copy the Price ID (starts with `price_`)
- Add to `.env.local`: `STRIPE_PRICE_EXPLORER_MONTHLY=price_xxx`

**Navigator Plan:**
- Name: `Navigator Plan`
- Description: `For growing teams and businesses`
- Pricing: `$20.00` per month (recurring)
- Copy the Price ID
- Add to `.env.local`: `STRIPE_PRICE_NAVIGATOR_MONTHLY=price_xxx`

**Commander Plan:**
- Name: `Commander Plan`
- Description: `For power users and enterprises`
- Pricing: `$35.00` per month (recurring)
- Copy the Price ID
- Add to `.env.local`: `STRIPE_PRICE_COMMANDER_MONTHLY=price_xxx`

#### Create Annual Plans (Optional)

Repeat above for annual pricing with 2-month discount:
- Explorer Annual: `$120/year` (save $24)
- Navigator Annual: `$200/year` (save $40)
- Commander Annual: `$350/year` (save $70)

Add annual price IDs to `.env.local`:
```bash
STRIPE_PRICE_EXPLORER_ANNUAL=price_xxx
STRIPE_PRICE_NAVIGATOR_ANNUAL=price_xxx
STRIPE_PRICE_COMMANDER_ANNUAL=price_xxx
```

#### Create Boost Packs

Create one-time payment products:

**25K Boost Pack:**
- Name: `25K Pilot Credits Boost Pack`
- Pricing: `$8.00` (one-time)
- Add to `.env.local`: `STRIPE_PRICE_BOOST_25K=price_xxx`

**100K Boost Pack:**
- Name: `100K Pilot Credits Boost Pack (+5K Bonus)`
- Pricing: `$20.00` (one-time)
- Add to `.env.local`: `STRIPE_PRICE_BOOST_100K=price_xxx`

**250K Boost Pack:**
- Name: `250K Pilot Credits Boost Pack (+15K Bonus)`
- Pricing: `$40.00` (one-time)
- Add to `.env.local`: `STRIPE_PRICE_BOOST_250K=price_xxx`

### Step 4: Set Up Webhooks

1. Go to https://dashboard.stripe.com/test/webhooks
2. Click **"Add endpoint"**
3. Endpoint URL: `https://yourdomain.com/api/stripe/webhook`
   - For local testing: Use ngrok or Stripe CLI
4. Select events to listen for:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
5. Click **"Add endpoint"**
6. Copy the **Signing secret** (starts with `whsec_`)
7. Add to `.env.local`:
```bash
STRIPE_WEBHOOK_SECRET=whsec_YOUR_WEBHOOK_SECRET_HERE
```

### Step 5: Configure Stripe Customer Portal

1. Go to https://dashboard.stripe.com/test/settings/billing/portal
2. Enable the customer portal
3. Configure allowed actions:
   - ✅ Customers can update payment methods
   - ✅ Customers can cancel subscriptions
   - ✅ Customers can switch plans
4. Set cancellation behavior:
   - Choose "Cancel at end of billing period" (recommended)
5. Save settings

---

## 🧪 Testing Locally

### Option 1: Use Stripe CLI (Recommended)

1. Install Stripe CLI: https://stripe.com/docs/stripe-cli
2. Login: `stripe login`
3. Forward webhooks to localhost:
```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```
4. This will give you a webhook signing secret starting with `whsec_`
5. Use this for local testing in `.env.local`

### Option 2: Use ngrok

1. Install ngrok: https://ngrok.com/
2. Start ngrok: `ngrok http 3000`
3. Copy the HTTPS URL (e.g., `https://abc123.ngrok.io`)
4. Add webhook endpoint in Stripe Dashboard with ngrok URL
5. Use the webhook secret from Dashboard

### Test Card Numbers

Use these test cards for development:

- **Success:** `4242 4242 4242 4242`
- **Requires authentication:** `4000 0025 0000 3155`
- **Declined:** `4000 0000 0000 0002`

Use any future expiry date (e.g., `12/34`) and any 3-digit CVC.

---

## 🔍 Verification Checklist

- [ ] Stripe API keys added to `.env.local`
- [ ] All plan price IDs configured
- [ ] All boost pack price IDs configured
- [ ] Webhook endpoint created and secret added
- [ ] Customer portal configured
- [ ] Test checkout flow works
- [ ] Test subscription creation
- [ ] Test invoice generation
- [ ] Test webhook events received
- [ ] Test boost pack purchase

---

## 📊 Monitoring

### View in Stripe Dashboard

- **Payments:** https://dashboard.stripe.com/test/payments
- **Subscriptions:** https://dashboard.stripe.com/test/subscriptions
- **Customers:** https://dashboard.stripe.com/test/customers
- **Webhooks:** https://dashboard.stripe.com/test/webhooks
- **Logs:** https://dashboard.stripe.com/test/logs

### Database Monitoring

Check Supabase tables:
- `user_subscriptions` - Current subscription status
- `credit_transactions` - Credit movements
- `subscription_invoices` - Invoice records
- `billing_events` - Audit trail

---

## 🚨 Troubleshooting

### Webhook not receiving events

1. Check webhook URL is correct
2. Verify webhook secret matches
3. Check endpoint is publicly accessible
4. Test with Stripe CLI: `stripe trigger checkout.session.completed`

### Checkout session creation fails

1. Verify price IDs are correct
2. Check API keys are set
3. Ensure customer doesn't already have active subscription
4. Check server logs for error details

### Credits not allocated after payment

1. Check webhook received `invoice.paid` event
2. Verify `user_subscriptions` table updated
3. Check `credit_transactions` for allocation record
4. Review webhook handler logs

---

## 🔄 Going to Production

### Before Launch

1. Switch from test keys to live keys:
   - Update `STRIPE_SECRET_KEY` with `sk_live_` key
   - Update `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` with `pk_live_` key
2. Recreate products in live mode
3. Update price IDs with live price IDs
4. Create live webhook endpoint with production URL
5. Test entire flow in live mode with real card

### Security Checklist

- [ ] Webhook signature verification enabled
- [ ] API keys stored in environment variables (never in code)
- [ ] HTTPS enabled on production domain
- [ ] RLS policies enabled on database tables
- [ ] Rate limiting on API endpoints
- [ ] Error messages don't leak sensitive data

---

## 📚 Resources

- **Stripe Docs:** https://stripe.com/docs
- **Checkout Session:** https://stripe.com/docs/payments/checkout
- **Subscriptions:** https://stripe.com/docs/billing/subscriptions/overview
- **Webhooks:** https://stripe.com/docs/webhooks
- **Testing:** https://stripe.com/docs/testing
- **Customer Portal:** https://stripe.com/docs/billing/subscriptions/integrating-customer-portal

---

## 🆘 Support

Need help? Check:
1. Stripe Dashboard logs
2. Next.js server logs
3. Browser console for client errors
4. Supabase logs for database issues
5. Stripe support: https://support.stripe.com

---

**Happy billing! 💳✨**
