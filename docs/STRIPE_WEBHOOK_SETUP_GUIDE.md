# Stripe Webhook Setup - Step by Step Guide

This guide will walk you through setting up Stripe webhooks for both **local development** and **production**.

---

## Prerequisites

Before starting, ensure you have:
- ✅ Stripe account created
- ✅ `STRIPE_SECRET_KEY` in your `.env.local`
- ✅ `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` in your `.env.local`
- ✅ `SUPABASE_SERVICE_ROLE_KEY` in your `.env.local`
- ✅ Application running on `http://localhost:3000`

---

## Part 1: Local Development Setup (Using Stripe CLI)

### Step 1: Install Stripe CLI

**macOS (using Homebrew):**
```bash
brew install stripe/stripe-cli/stripe
```

**Windows (using Scoop):**
```bash
scoop bucket add stripe https://github.com/stripe/scoop-stripe-cli.git
scoop install stripe
```

**Linux:**
```bash
# Download the latest linux tar.gz file from https://github.com/stripe/stripe-cli/releases/latest
tar -xvf stripe_X.X.X_linux_x86_64.tar.gz
sudo mv stripe /usr/local/bin
```

**Verify installation:**
```bash
stripe --version
```

---

### Step 2: Login to Stripe CLI

```bash
stripe login
```

This will:
1. Open your browser
2. Ask you to allow access to your Stripe account
3. Display a success message in the terminal

**Expected output:**
```
Your pairing code is: word-word-word
Press Enter to open the browser (^C to quit)
> Done! The Stripe CLI is configured for [YOUR ACCOUNT NAME]
```

---

### Step 3: Start Your Next.js Application

Make sure your application is running:

```bash
npm run dev
```

Your app should be running at `http://localhost:3000`

---

### Step 4: Forward Webhooks to Your Local Server

Open a **new terminal window** (keep your app running in the first one) and run:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

**Expected output:**
```
> Ready! You are using Stripe API Version [2024-XX-XX]. Your webhook signing secret is whsec_xxxxxxxxxxxxxxxxxxxxx (^C to quit)
```

**⚠️ IMPORTANT:** Copy the webhook signing secret that starts with `whsec_`

---

### Step 5: Add Webhook Secret to Environment Variables

1. Open your `.env.local` file
2. Add or update the following line:

```bash
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxxx
```

Replace `whsec_xxxxxxxxxxxxxxxxxxxxx` with the actual secret from Step 4.

3. **Restart your Next.js application** for the changes to take effect:
   - Stop the dev server (Ctrl+C in the first terminal)
   - Run `npm run dev` again

---

### Step 6: Test the Webhook Connection

With both terminals running:
- Terminal 1: `npm run dev` (your Next.js app)
- Terminal 2: `stripe listen --forward-to localhost:3000/api/stripe/webhook`

You should see webhook events being forwarded in Terminal 2:

```
2024-01-29 10:30:15   --> payment_intent.created [evt_xxxxx]
2024-01-29 10:30:16   <-- [200] POST http://localhost:3000/api/stripe/webhook [evt_xxxxx]
```

---

### Step 7: Test with a Real Payment

1. Go to your app: `http://localhost:3000/settings?tab=billing`
2. Try to purchase credits
3. Use Stripe test card: `4242 4242 4242 4242`
4. Watch the webhook events in Terminal 2:

```
2024-01-29 10:35:20   --> checkout.session.completed [evt_xxxxx]
2024-01-29 10:35:21   <-- [200] POST http://localhost:3000/api/stripe/webhook [evt_xxxxx]
2024-01-29 10:35:22   --> invoice.paid [evt_xxxxx]
2024-01-29 10:35:23   <-- [200] POST http://localhost:3000/api/stripe/webhook [evt_xxxxx]
```

5. Check your database to verify credits were added

---

## Part 2: Production Setup (Stripe Dashboard)

### Step 1: Deploy Your Application

Make sure your application is deployed to production (e.g., Vercel, AWS, etc.) and accessible via HTTPS.

Example: `https://neuronforge.com`

---

### Step 2: Create Webhook Endpoint in Stripe Dashboard

1. **Go to Stripe Dashboard:**
   - Visit: https://dashboard.stripe.com
   - Make sure you're in **Live Mode** (toggle in top right)

2. **Navigate to Webhooks:**
   - Click **Developers** in the left sidebar
   - Click **Webhooks**

3. **Add Endpoint:**
   - Click **Add endpoint** button

4. **Configure Endpoint URL:**
   ```
   https://your-production-domain.com/api/stripe/webhook
   ```

   Example:
   ```
   https://neuronforge.com/api/stripe/webhook
   ```

5. **Select Events to Listen For:**

   Click **Select events** and choose:
   - ✅ `checkout.session.completed`
   - ✅ `invoice.paid`
   - ✅ `invoice.payment_failed`
   - ✅ `customer.subscription.deleted`
   - ✅ `customer.subscription.updated`

6. **Click Add endpoint**

---

### Step 3: Get Production Webhook Secret

After creating the endpoint:

1. Click on the webhook endpoint you just created
2. You'll see **Signing secret** section
3. Click **Reveal** to show the secret
4. Copy the secret (starts with `whsec_`)

---

### Step 4: Add Production Webhook Secret to Environment Variables

Add the webhook secret to your production environment:

**For Vercel:**
1. Go to your project settings
2. Navigate to **Environment Variables**
3. Add new variable:
   - Key: `STRIPE_WEBHOOK_SECRET`
   - Value: `whsec_xxxxxxxxxxxxxxxxxxxxx` (your production secret)
   - Environment: **Production**

**For other platforms:**
- Add `STRIPE_WEBHOOK_SECRET` to your production environment configuration

**⚠️ IMPORTANT:** The production webhook secret is DIFFERENT from your local development secret!

---

### Step 5: Redeploy Your Application

After adding the environment variable, redeploy your application so it picks up the new webhook secret.

---

### Step 6: Test Production Webhooks

1. Go to your production app's billing page
2. Make a test purchase (you can use Stripe test mode in production)
3. Go to Stripe Dashboard → **Developers** → **Webhooks**
4. Click on your webhook endpoint
5. Check the **Recent deliveries** tab

You should see successful webhook deliveries with `200` status codes:

```
✅ checkout.session.completed - 200 OK
✅ invoice.paid - 200 OK
```

---

## Part 3: Verify Everything is Working

### Local Development Checklist

- [ ] Stripe CLI installed and logged in
- [ ] `stripe listen` command running in terminal
- [ ] Webhook secret added to `.env.local`
- [ ] Application restarted after adding secret
- [ ] Test payment completes successfully
- [ ] Credits appear in user account
- [ ] Webhook events show in Stripe CLI terminal

### Production Checklist

- [ ] Webhook endpoint created in Stripe Dashboard
- [ ] All required events selected
- [ ] Production webhook secret added to environment variables
- [ ] Application redeployed
- [ ] Test payment in production completes successfully
- [ ] Webhook deliveries show as successful in Stripe Dashboard
- [ ] Credits appear in user account

---

## Part 4: Troubleshooting

### Problem: "No webhook signature header found"

**Solution:**
- Check that `STRIPE_WEBHOOK_SECRET` is set in your environment
- Restart your application after adding the secret
- Verify the secret starts with `whsec_`

### Problem: "Invalid webhook signature"

**Solutions:**
1. **Wrong secret:** Make sure you're using the correct secret for your environment:
   - Local: Use secret from `stripe listen` command
   - Production: Use secret from Stripe Dashboard

2. **Old secret:** If you recently changed the webhook endpoint, regenerate the secret:
   - Stripe Dashboard → Webhooks → Your endpoint → Roll secret

3. **Body parsing issue:** The webhook handler must receive the raw body (our code already handles this correctly)

### Problem: Webhook events not arriving

**Local Development:**
- Check that `stripe listen` is running
- Verify the forward URL is correct: `localhost:3000/api/stripe/webhook`
- Make sure your Next.js app is running

**Production:**
- Check that your domain is accessible via HTTPS
- Verify the webhook URL is correct in Stripe Dashboard
- Check your server logs for errors
- Look at "Recent deliveries" in Stripe Dashboard for error messages

### Problem: Credits not added to user account

**Check the following:**

1. **Webhook processed successfully?**
   - Check server logs for webhook processing
   - Should see: `🎯 [Webhook] Processing invoice.paid: inv_xxxxx`

2. **User ID in metadata?**
   - Webhook needs `user_id` in invoice metadata
   - Our code adds this automatically during checkout

3. **Database connection?**
   - Verify `SUPABASE_SERVICE_ROLE_KEY` is set
   - Check Supabase logs for any database errors

4. **Check database directly:**
   ```sql
   -- Check user subscription
   SELECT * FROM user_subscriptions WHERE user_id = 'your-user-id';

   -- Check credit transactions
   SELECT * FROM credit_transactions WHERE user_id = 'your-user-id' ORDER BY created_at DESC;

   -- Check invoices
   SELECT * FROM subscription_invoices WHERE user_id = 'your-user-id' ORDER BY created_at DESC;
   ```

---

## Part 5: Monitoring Webhooks

### Stripe Dashboard Monitoring

**View webhook deliveries:**
1. Go to Stripe Dashboard → **Developers** → **Webhooks**
2. Click on your webhook endpoint
3. Check **Recent deliveries** tab

**What to look for:**
- ✅ Status code `200` = Success
- ❌ Status code `400` or `500` = Error (click for details)

### Application Logs

Look for these log messages in your server logs:

**Success:**
```
📥 [Webhook] Received event: invoice.paid
🎯 [Webhook] Processing invoice.paid: inv_xxxxx
✅ [Webhook] Invoice processed successfully: { userId: 'xxx', credits: 100000, newBalance: 100000 }
```

**Errors:**
```
❌ [Webhook] No user_id in invoice metadata
❌ [Webhook] Error: Failed to update user subscription
```

---

## Part 6: Security Best Practices

### ✅ DO:
- Always verify webhook signatures (our code does this)
- Use HTTPS in production
- Keep webhook secrets in environment variables (never commit to git)
- Monitor webhook deliveries regularly
- Set up alerts for failed webhook deliveries

### ❌ DON'T:
- Never hardcode webhook secrets in your code
- Never commit `.env.local` to git
- Never use the same webhook secret for local and production
- Never disable signature verification

---

## Part 7: Testing Different Scenarios

### Test Successful Payment

1. Purchase credits with test card: `4242 4242 4242 4242`
2. Expected webhooks:
   - `checkout.session.completed`
   - `invoice.paid`
3. Expected result: Credits added to account

### Test Failed Payment

1. Use test card that requires authentication: `4000 0025 0000 3155`
2. Expected webhook: `invoice.payment_failed`
3. Expected result:
   - Retry count incremented
   - Grace period logic kicks in
   - After grace period: agents paused

### Test Subscription Cancellation

1. Go to billing settings
2. Click "Manage Subscription"
3. Cancel subscription in Stripe Customer Portal
4. Expected webhook: `customer.subscription.deleted`
5. Expected result: Subscription marked as canceled in database

---

## Quick Reference

### Environment Variables Needed

```bash
# Stripe API Keys
STRIPE_SECRET_KEY=sk_test_xxxxx           # From Stripe Dashboard → API Keys
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxxxx  # From Stripe Dashboard → API Keys

# Webhook Secret
STRIPE_WEBHOOK_SECRET=whsec_xxxxx         # From stripe listen OR Stripe Dashboard

# Supabase Admin Key
SUPABASE_SERVICE_ROLE_KEY=xxxxx          # From Supabase Dashboard → Settings → API

# App URL
NEXT_PUBLIC_APP_URL=http://localhost:3000 # Change to production URL in production
```

### Webhook Events We Handle

| Event | Purpose |
|-------|---------|
| `checkout.session.completed` | Initial subscription setup or boost pack purchase |
| `invoice.paid` | Monthly renewal - award credits to user |
| `invoice.payment_failed` | Payment failed - increment retry count, check grace period |
| `customer.subscription.deleted` | User canceled subscription |
| `customer.subscription.updated` | User changed subscription (e.g., credit amount) |

### Stripe CLI Commands

```bash
# Login
stripe login

# Forward webhooks to local server
stripe listen --forward-to localhost:3000/api/stripe/webhook

# Test a specific webhook event
stripe trigger payment_intent.succeeded

# View webhook logs
stripe logs tail
```

---

## Need Help?

- **Stripe Documentation:** https://stripe.com/docs/webhooks
- **Stripe CLI Documentation:** https://stripe.com/docs/stripe-cli
- **Stripe Support:** https://support.stripe.com
- **Test Cards:** https://stripe.com/docs/testing

---

**✅ Setup Complete!**

Once you've completed all steps, your Stripe webhook integration should be fully functional for both local development and production.
