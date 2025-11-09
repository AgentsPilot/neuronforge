# Stripe Environment Variables Setup

## Required Environment Variables

Add these to your `.env.local` file:

```bash
# Stripe API Keys (Get from: https://dashboard.stripe.com/apikeys)
STRIPE_SECRET_KEY=sk_test_...                      # Required for backend
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...    # Required for frontend

# Stripe Webhook Secret (See instructions below)
STRIPE_WEBHOOK_SECRET=whsec_...                    # Required for webhook verification

# Supabase Admin Key (Get from: Supabase Dashboard > Settings > API)
SUPABASE_SERVICE_ROLE_KEY=eyJ...                   # Required for webhook to bypass RLS
```

---

## How to Get STRIPE_WEBHOOK_SECRET

### Option 1: Local Development (Stripe CLI - Recommended)

The easiest way for local testing:

**Step 1: Install Stripe CLI**
```bash
# Mac
brew install stripe/stripe-cli/stripe

# Windows (using Scoop)
scoop bucket add stripe https://github.com/stripe/scoop-stripe-cli.git
scoop install stripe

# Or download from: https://github.com/stripe/stripe-cli/releases
```

**Step 2: Login to Stripe**
```bash
stripe login
```

This will open your browser to authenticate with Stripe.

**Step 3: Start Webhook Forwarding**
```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

**Step 4: Copy the Webhook Secret**

Stripe CLI will output:
```
> Ready! Your webhook signing secret is whsec_xxxxxxxxxxxxx (^C to quit)
```

Copy `whsec_xxxxxxxxxxxxx` and add to `.env.local`:
```bash
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxx
```

**Step 5: Keep the Terminal Open**

While developing, keep this terminal window open. It will forward all Stripe webhook events to your local server.

---

### Option 2: Production (Stripe Dashboard)

For production deployment:

**Step 1: Go to Stripe Dashboard**
1. Visit [https://dashboard.stripe.com/webhooks](https://dashboard.stripe.com/webhooks)
2. Click **"Add endpoint"**

**Step 2: Configure Endpoint**
- **Endpoint URL**: `https://yourdomain.com/api/stripe/webhook`
- **Description**: "NeuronForge Billing Webhook"
- **Events to send**: Select these events:
  - ✅ `checkout.session.completed`
  - ✅ `invoice.paid`
  - ✅ `invoice.payment_failed`
  - ✅ `customer.subscription.deleted`
  - ✅ `customer.subscription.updated`

**Step 3: Copy Signing Secret**
1. After creating the endpoint, click on it
2. Click **"Reveal"** next to "Signing secret"
3. Copy the secret (starts with `whsec_`)
4. Add to your production environment variables

**Step 4: Test Webhook**
Use the "Send test webhook" button in Stripe Dashboard to verify it's working.

---

## Grace Period Configuration

The payment grace period (days before pausing agents after failed payment) is **now database-driven**.

### System-Wide Default

Add this configuration to the `ais_system_config` table:

```sql
INSERT INTO ais_system_config (
  config_key,
  config_value,
  description,
  category,
  unit
) VALUES (
  'payment_grace_period_days',
  '3',
  'Number of days to wait before pausing agents after a failed payment',
  'billing',
  'days'
)
ON CONFLICT (config_key) DO UPDATE
SET config_value = EXCLUDED.config_value;
```

### Per-User Override

Users can have individual grace periods set in `user_subscriptions.grace_period_days`.

**Priority Order:**
1. **User-specific** (`user_subscriptions.grace_period_days`) - if set
2. **System default** (`ais_system_config.payment_grace_period_days`) - if user-specific not set
3. **Hardcoded fallback** (3 days) - if neither are set

### How It Works

When a payment fails:
1. System checks `user_subscriptions.grace_period_days` for that user
2. If not set, fetches `ais_system_config.payment_grace_period_days`
3. Calculates days since billing period ended
4. If days exceed grace period → pauses agents and sets status to `past_due`
5. Otherwise → keeps agents active and waits for Stripe's automatic retry

---

## Verification

### Test Environment Variables

```bash
# Check if all variables are set
node -e "
console.log('STRIPE_SECRET_KEY:', process.env.STRIPE_SECRET_KEY ? '✅ Set' : '❌ Missing');
console.log('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:', process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ? '✅ Set' : '❌ Missing');
console.log('STRIPE_WEBHOOK_SECRET:', process.env.STRIPE_WEBHOOK_SECRET ? '✅ Set' : '❌ Missing');
console.log('SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅ Set' : '❌ Missing');
"
```

### Test Webhook Secret

After setting up webhook forwarding, test it:

1. **In one terminal**: Run your dev server
   ```bash
   npm run dev
   ```

2. **In another terminal**: Run Stripe webhook forwarding
   ```bash
   stripe listen --forward-to localhost:3000/api/stripe/webhook
   ```

3. **Trigger a test event**:
   ```bash
   stripe trigger checkout.session.completed
   ```

4. **Check your server logs** - you should see:
   ```
   📥 [Webhook] Received event: checkout.session.completed
   ```

---

## Security Notes

### Never Commit These Values!

Ensure `.env.local` is in your `.gitignore`:

```bash
# .gitignore
.env.local
.env*.local
```

### Use Different Keys for Development vs Production

- **Development**: Use `sk_test_` keys from Stripe test mode
- **Production**: Use `sk_live_` keys from Stripe live mode

### Rotate Keys Regularly

If a key is exposed:
1. Go to Stripe Dashboard → Developers → API Keys
2. Click "Roll key" to generate a new one
3. Update your environment variables
4. Redeploy

---

## Common Issues

### Issue: "STRIPE_WEBHOOK_SECRET not configured"

**Solution**: Make sure `.env.local` contains `STRIPE_WEBHOOK_SECRET=whsec_...`

### Issue: "Webhook signature verification failed"

**Causes**:
1. Wrong webhook secret
2. Body parsed before signature verification
3. Using production webhook secret with test mode events

**Solution**: Verify the webhook secret matches the endpoint you're using.

### Issue: Webhook events not reaching local server

**Solution**:
1. Check Stripe CLI is running: `stripe listen --forward-to localhost:3000/api/stripe/webhook`
2. Check dev server is running on port 3000
3. Check firewall isn't blocking the connection

---

## Admin Configuration UI

To allow admins to change grace period without database access:

1. Go to `/admin/system-config` (admin UI)
2. Find "Payment Grace Period Days"
3. Update value (e.g., from 3 to 5)
4. Save

Changes take effect immediately on next payment failure.

---

## Quick Start Checklist

- [ ] Install Stripe CLI
- [ ] Run `stripe login`
- [ ] Run `stripe listen --forward-to localhost:3000/api/stripe/webhook`
- [ ] Copy webhook secret to `.env.local`
- [ ] Add `STRIPE_SECRET_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` from Stripe Dashboard
- [ ] Add `SUPABASE_SERVICE_ROLE_KEY` from Supabase Dashboard
- [ ] Add grace period config to `ais_system_config` table
- [ ] Restart dev server
- [ ] Test with `stripe trigger invoice.paid`

---

**Documentation Updated**: 2025-01-05
