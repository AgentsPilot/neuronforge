# Stripe Connect Plugin - Setup Guide for Testing

> **Last Updated**: 2026-08-01

This guide will walk you through setting up Stripe Connect for the AgentPilot Stripe plugin, including getting API keys for testing.

---

## Prerequisites

- AgentPilot development environment running
- Access to create a Stripe account
- Email address for Stripe account

---

## Step 1: Create a Stripe Account

### Option A: New Stripe Account (Recommended for Testing)

1. **Go to Stripe Sign Up**
   - Visit: https://dashboard.stripe.com/register
   - Use your email address
   - Create a strong password
   - Click "Create account"

2. **Skip Business Details (For Testing)**
   - When asked about your business, you can skip this for now
   - Click "Skip for now" or "I'll do this later"
   - You'll land on the Stripe Dashboard in **Test Mode**

### Option B: Use Existing Stripe Account

1. Visit: https://dashboard.stripe.com/login
2. Log in with your credentials
3. Make sure you're in **Test mode** (toggle in top-right)

---

## Step 2: Get Your API Keys

### 2.1 Get Secret Key and Publishable Key

1. **Navigate to API Keys**
   - In Stripe Dashboard, click "Developers" in left sidebar
   - Click "API keys"
   - Make sure **Test mode** toggle is ON (top-right)

2. **Copy Your Keys**
   - **Publishable key**: Starts with `pk_test_...`
     - Click "Reveal test key" if hidden
     - Copy the entire key
   - **Secret key**: Starts with `sk_test_...`
     - Click "Reveal test key token"
     - Copy the entire key

   **IMPORTANT**: Never commit these keys to Git. They're already in `.env.local` which is gitignored.

### 2.2 Get Stripe Connect Client ID

This is required for OAuth (connecting existing Stripe accounts).

1. **Enable Stripe Connect**
   - In Stripe Dashboard, click "Connect" in left sidebar
   - If you see "Get started with Connect", click it
   - Click "Continue" to enable Connect

2. **Access Connect Settings**
   - Click "Settings" (top-right of Connect page)
   - Or go directly to: https://dashboard.stripe.com/settings/applications

3. **Create OAuth Application**
   - Scroll to "OAuth settings" section
   - Under "Redirect URIs", click "Add redirect URI"
   - Add these URIs:
     ```
     http://localhost:3000/oauth/callback/stripe
     http://localhost:3000/api/payments/stripe-connect/callback
     ```
   - Click "Save changes"

4. **Copy Client ID**
   - In the "OAuth settings" section, find "Client ID"
   - It starts with `ca_...`
   - Copy the entire Client ID

### 2.3 Get Webhook Secret (Optional for Testing)

Only needed if you want to test webhook events.

1. **Create Webhook Endpoint**
   - In Stripe Dashboard, click "Developers" > "Webhooks"
   - Click "Add endpoint"
   - Enter your endpoint URL:
     ```
     http://localhost:3000/api/stripe/webhook
     ```
   - For local testing, use **Stripe CLI** or **ngrok** (see below)
   - Select events to listen to (or select "receive all events" for testing)
   - Click "Add endpoint"

2. **Copy Signing Secret**
   - After creating endpoint, click on it
   - Find "Signing secret"
   - Click "Reveal" and copy the secret (starts with `whsec_...`)

---

## Step 3: Update Environment Variables

1. **Open `.env.local` file** in your AgentPilot project root

2. **Update Stripe variables:**

```bash
# ============================================================================
# Stripe Configuration (Payment Processing)
# ============================================================================
# Get your keys from: https://dashboard.stripe.com/apikeys
STRIPE_SECRET_KEY=sk_test_YOUR_SECRET_KEY_HERE
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_YOUR_PUBLISHABLE_KEY_HERE

# Webhook signing secret (get from: https://dashboard.stripe.com/webhooks)
STRIPE_WEBHOOK_SECRET=whsec_YOUR_WEBHOOK_SECRET_HERE

# Stripe Connect OAuth Client ID (get from: https://dashboard.stripe.com/settings/applications)
# Required for connecting user Stripe accounts via OAuth
STRIPE_CLIENT_ID=ca_YOUR_CLIENT_ID_HERE
```

3. **Save the file**

4. **Restart your development server:**
   ```bash
   npm run dev
   ```

---

## Step 4: Test the Plugin

### Test 1: Verify Plugin Appears

1. Start your dev server: `npm run dev`
2. Log into AgentPilot: `http://localhost:3000`
3. Go to **Settings → Connections**
4. Search for "Stripe"
5. You should see:
   - Name: **Stripe**
   - Description: "Accept payments, manage subscriptions, process refunds"
   - Icon: Purple credit card
   - Status: **Not Connected**

### Test 2: Test Express Account Creation (New Users)

1. **Click "Connect" on Stripe plugin**
2. **Choose "Create New Account"** (if wizard is implemented)
3. **Fill in details:**
   - Country: United States
   - Business Type: Individual
4. **Click "Create Account"**
5. **Complete Stripe Onboarding:**
   - You'll be redirected to Stripe
   - Fill in required information (in test mode, you can use fake data)
   - For testing, Stripe accepts test data like:
     - SSN: `000-00-0000`
     - Date of Birth: Any past date
     - Address: Any US address
6. **Complete Setup**
7. **Return to AgentPilot**
   - You should see Stripe marked as "Connected"

### Test 3: Test OAuth Connection (Existing Accounts)

**IMPORTANT**: For OAuth to work, you need the `STRIPE_CLIENT_ID` configured.

1. **Click "Connect" on Stripe plugin**
2. **Choose "Connect Existing Account"** (if wizard is implemented)
3. **OAuth Popup Opens:**
   - Log into your Stripe account
   - Authorize AgentPilot to access your account
   - Click "Connect"
4. **Popup Closes:**
   - You should see Stripe marked as "Connected"

### Test 4: Test Payment Action

Create a test agent to verify the plugin works:

1. **Create New Agent**
2. **Agent Prompt:**
   ```
   Create a checkout session for $50 USD with success URL http://localhost:3000/success
   ```
3. **Run Agent**
4. **Expected Result:**
   ```json
   {
     "success": true,
     "data": {
       "session_id": "cs_test_...",
       "url": "https://checkout.stripe.com/c/pay/cs_test_...",
       "amount": 5000,
       "currency": "usd"
     },
     "message": "Checkout session created successfully"
   }
   ```
5. **Click the URL** - You should see a Stripe checkout page

---

## Step 5: Test with Stripe Test Cards

When testing payments, use these test card numbers:

### Successful Payments

| Card Number | Brand | Description |
|-------------|-------|-------------|
| `4242 4242 4242 4242` | Visa | Always succeeds |
| `5555 5555 5555 4444` | Mastercard | Always succeeds |
| `3782 822463 10005` | American Express | Always succeeds |

**Other Test Details:**
- Expiry: Any future date (e.g., `12/34`)
- CVC: Any 3 digits (e.g., `123`)
- ZIP: Any 5 digits (e.g., `12345`)

### Payment Failures (For Testing Error Handling)

| Card Number | Brand | Outcome |
|-------------|-------|---------|
| `4000 0000 0000 9995` | Visa | Declined (insufficient funds) |
| `4000 0000 0000 0002` | Visa | Declined (generic) |
| `4000 0000 0000 9987` | Visa | Declined (lost card) |

Full list: https://stripe.com/docs/testing#cards

---

## Step 6: Local Testing with Webhooks (Optional)

If you want to test webhook events locally:

### Option A: Stripe CLI (Recommended)

1. **Install Stripe CLI**
   ```bash
   brew install stripe/stripe-cli/stripe
   ```

2. **Login to Stripe**
   ```bash
   stripe login
   ```

3. **Forward Webhooks to Local Server**
   ```bash
   stripe listen --forward-to localhost:3000/api/stripe/webhook
   ```

4. **Copy Webhook Signing Secret**
   - The CLI will display a webhook secret starting with `whsec_...`
   - Update `.env.local` with this secret

5. **Test Webhook**
   ```bash
   stripe trigger payment_intent.succeeded
   ```

### Option B: ngrok

1. **Install ngrok**
   ```bash
   brew install ngrok
   ```

2. **Start ngrok**
   ```bash
   ngrok http 3000
   ```

3. **Copy HTTPS URL** (e.g., `https://abc123.ngrok.io`)

4. **Add Webhook in Stripe Dashboard**
   - Go to: https://dashboard.stripe.com/webhooks
   - Add endpoint: `https://abc123.ngrok.io/api/stripe/webhook`
   - Copy signing secret to `.env.local`

---

## Troubleshooting

### Error: "Stripe account ID not found"

**Cause**: Plugin connection doesn't have `stripe_account_id` in `profile_data`

**Fix**:
1. Disconnect and reconnect the plugin
2. Check database `plugin_connections` table
3. Verify `profile_data` contains `stripe_account_id`

### Error: "OAuth credentials not configured"

**Cause**: `STRIPE_CLIENT_ID` not set in `.env.local`

**Fix**:
1. Follow Step 2.2 above to get Client ID
2. Add to `.env.local`
3. Restart dev server

### Error: "Account not fully onboarded"

**Cause**: Express account setup incomplete

**Fix**:
1. Go to Settings → Connections → Stripe
2. Click "Continue Setup"
3. Complete Stripe onboarding process

### Plugin Not Appearing

**Check**:
1. Plugin definition exists: `lib/plugins/definitions/stripe-plugin-v2.json`
2. Executor registered: `lib/server/plugin-executer-v2.ts`
3. Plugin list updated: `lib/plugins/pluginList.tsx`
4. Dev server restarted

### Checkout Session Creation Fails

**Check**:
1. Stripe account is fully onboarded (charges_enabled = true)
2. Amount is in cents (e.g., 5000 = $50.00)
3. Currency is valid 3-letter code (e.g., "usd", "eur")
4. Success URL is a valid URL

---

## Production Setup

### Before Going Live:

1. **Switch to Live Mode** in Stripe Dashboard
2. **Complete Business Verification:**
   - Stripe requires full business verification for live mode
   - Provide tax ID, business documents, etc.
3. **Get Live API Keys:**
   - Go to: https://dashboard.stripe.com/apikeys
   - Toggle to "Live mode"
   - Copy live keys (start with `pk_live_` and `sk_live_`)
4. **Update Production Environment:**
   ```bash
   STRIPE_SECRET_KEY=sk_live_...
   NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
   STRIPE_CLIENT_ID=ca_...  # Same for live and test
   ```
5. **Create Live Webhook Endpoint:**
   - Use your production URL
   - Copy new signing secret

### Production Checklist

- [ ] Business verification complete in Stripe
- [ ] Live API keys configured in production environment
- [ ] Production webhook endpoint created
- [ ] Test payment flow with real card
- [ ] Test refund flow
- [ ] Test subscription creation/cancellation
- [ ] Error monitoring set up (Sentry, etc.)
- [ ] Customer support process documented

---

## Resources

- **Stripe Dashboard**: https://dashboard.stripe.com
- **Stripe API Docs**: https://stripe.com/docs/api
- **Stripe Connect Docs**: https://stripe.com/docs/connect
- **Test Cards**: https://stripe.com/docs/testing
- **Stripe CLI**: https://stripe.com/docs/stripe-cli
- **AgentPilot Stripe Plugin Docs**: `/docs/plugins/stripe-plugin.md`

---

## Support

### Getting Help

- **Stripe Support**: https://support.stripe.com
- **Stripe Discord**: https://discord.gg/stripe
- **AgentPilot Issues**: GitHub Issues (if open source)

### Common Questions

**Q: Can I test without a real Stripe account?**
A: No, you need a Stripe account (even for testing), but it's free to create.

**Q: Will I be charged for testing?**
A: No, test mode transactions are free and don't process real money.

**Q: Can I use the same Stripe account for multiple environments?**
A: Yes, use test keys for development and live keys for production.

**Q: How do I delete test data?**
A: In Stripe Dashboard (test mode), go to "Developers" → "Delete test data"

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-08-01 | Initial release | Complete setup guide for Stripe Connect plugin |
