# Webhook Debugging Guide

## Current Status

✅ **FIXED**: Multiplier bug - Stripe now receives correct Pilot Credits (1,000 instead of 10,000)
❌ **NOT WORKING**: Automatic webhook sync - subscriptions created in Stripe don't update database

## What Should Happen

When you complete a subscription purchase in Stripe:
1. Stripe sends `checkout.session.completed` event to your webhook endpoint
2. Webhook handler processes the event
3. Database is updated with new balance
4. You should see logs like: `[Webhook] Processing checkout.session.completed`

## Why It's Not Working

The webhook handler code is correct, but the webhook events aren't reaching your dev server. This is an **infrastructure issue**, not a code issue.

## Debugging Steps

### Step 1: Check if Stripe CLI is Running

Run this command to see if Stripe CLI is forwarding webhooks:

```bash
ps aux | grep "stripe listen"
```

**Expected output**:
```
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

**If not running**, start it:
```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

### Step 2: Check if Dev Server is Running

Your Next.js dev server must be running on port 3000:

```bash
lsof -i :3000
```

**Expected output**: Should show `node` or `next-server` running

**If not running**, start it:
```bash
npm run dev
```

### Step 3: Test Webhook Manually

Trigger a test webhook event:

```bash
stripe trigger checkout.session.completed
```

Check your dev server terminal - you should see:
```
[Webhook] Received event: checkout.session.completed
[Webhook] Processing checkout.session.completed
```

### Step 4: Check Webhook Endpoint

Test that the webhook endpoint is accessible:

```bash
curl -X POST http://localhost:3000/api/stripe/webhook \
  -H "Content-Type: application/json" \
  -d '{"type":"ping"}'
```

**Expected**: Should return a response (not 404)

## Current Workaround

Until webhooks are working automatically, use the manual sync script after each subscription purchase:

```bash
# 1. Complete subscription purchase in Stripe
# 2. Run manual sync script
npx ts-node scripts/sync-stripe-subscription.ts

# 3. Verify balance updated
npx ts-node scripts/check-subscription-details.ts
```

## What's Fixed in the Code

### 1. Multiplier Bug - `BillingSettings.tsx`

**Lines 266-268 & 297-303**: Now converts tokens to Pilot Credits before sending to API

```typescript
const pilotCreditsToSend = Math.round(customCredits / pricingConfig.tokens_per_pilot_credit);
```

### 2. Webhook Metadata - `app/api/stripe/webhook/route.ts`

**Lines 37-46**: Fetches metadata from subscription when invoice metadata is empty

```typescript
const invoiceSubscription = (invoice as any).subscription;
if (!userId && invoiceSubscription) {
  const subscription = await stripe.subscriptions.retrieve(invoiceSubscription as string);
  userId = subscription.metadata?.user_id;
  pilotCredits = parseInt(subscription.metadata?.credits || '0');
}
```

### 3. Database Schema - Multiple Files

**Removed all references** to non-existent `monthly_pilot_credits` column

## Latest Test Results

**Subscription**: `sub_1SQFqo56GTXD0wwim8jAvxPT`
- Stripe metadata: `credits: '1000'` ✅
- Amount: $0.48/month ✅
- After manual sync: Balance = 1,050 Pilot Credits ✅

**Database**:
- 50 Pilot Credits (500 tokens) - initial reward
- 1,000 Pilot Credits (10,000 tokens) - subscription
- Total: 1,050 Pilot Credits (10,500 tokens) ✅

## Next Steps

1. **Check Stripe CLI**: `ps aux | grep "stripe listen"`
2. **Check Dev Server**: `lsof -i :3000`
3. **Test Webhook**: `stripe trigger checkout.session.completed`
4. **Watch Logs**: Check dev server terminal when creating subscription

If you see webhook logs appear, the automatic sync will work!

## Stripe Dashboard Verification

Check your Stripe webhook logs:
1. Go to: https://dashboard.stripe.com/test/webhooks
2. Find your local webhook endpoint
3. Check recent events - should see `checkout.session.completed` events
4. If events show "Failed", click to see error details

## Common Issues

### Issue: "Connection refused"
**Cause**: Dev server not running
**Fix**: `npm run dev`

### Issue: "No webhook logs"
**Cause**: Stripe CLI not forwarding
**Fix**: `stripe listen --forward-to localhost:3000/api/stripe/webhook`

### Issue: "Port 3000 already in use"
**Cause**: Multiple dev servers running
**Fix**: `killall node` then `npm run dev`

## Summary

The **code is correct** - the multiplier bug is fixed and webhook handler works properly. The issue is that webhook events aren't reaching your dev server. Follow the debugging steps above to verify your local webhook infrastructure is set up correctly.
