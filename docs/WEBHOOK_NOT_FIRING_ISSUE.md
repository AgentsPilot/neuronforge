# Webhook Not Firing Issue

> **Last Updated**: 2026-10-12

## Problem

Subscriptions are being created successfully in Stripe with correct metadata, but webhooks are not being received/processed automatically. Manual sync script works correctly.

## Evidence

### What Works ✅

1. **Multiplier Bug FIXED**: Stripe receives correct Pilot Credits
   - User selects: 1,000 Pilot Credits
   - Stripe creates: 1,000 Pilot Credits ($0.48/month) ✅
   - Metadata: `{ credits: '1000', user_id: '...' }` ✅

2. **Manual Sync Works**: Running `sync-stripe-subscription.ts` correctly:
   - Fetches subscription from Stripe ✅
   - Converts 1,000 Pilot Credits → 10,000 tokens ✅
   - Updates database balance ✅
   - Creates transactions and billing events ✅

3. **Webhook Code is Correct**:
   - Handles `invoice.paid` and `checkout.session.completed`
   - Fetches metadata from subscription if not in invoice
   - Converts Pilot Credits to tokens
   - Updates database properly

### What Doesn't Work ❌

1. **Webhooks Not Received**: No events appear in webhook listener terminal
2. **Database Not Auto-Updated**: After checkout, balance stays at 50 Pilot Credits
3. **No Logs**: Dev server shows no webhook processing logs

## Latest Test (2025-11-05 23:22)

**Subscription Created**:
- ID: `sub_1SQG2b56GTXD0wwiwJh5eVqI`
- Status: Active
- Amount: 48 cents ($0.48/month)
- Metadata: `{ credits: '1000', user_id: '08456106-aa50-4810-b12c-7ca84102da31' }`
- Invoice: `in_1SQG2Z56GTXD0wwic1zAOQSV` (paid, 96 cents)

**Database Before Manual Sync**:
- Balance: 50 Pilot Credits (500 tokens)
- Subscription ID: None

**Database After Manual Sync**:
- Balance: 1,050 Pilot Credits (10,500 tokens) ✅
- Subscription ID: sub_1SQG2b56GTXD0wwiwJh5eVqI ✅

## Root Cause Analysis

### Possible Causes

1. **Stripe CLI Not Forwarding**:
   - Stripe CLI is running: `stripe listen --events invoice.paid,invoice.payment_failed,invoice.finalized,invoice.marked_uncollectible,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,checkout.session.completed,checkout.session.expired,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,payment_intent.succeeded,charge.refunded,charge.dispute.created,charge.dispute.closed,charge.dispute.funds_reinstated --forward-to localhost:3000/api/stripe/webhook`
   - But events may not be reaching the dev server
   - Check: Are events visible in Stripe CLI output?

2. **Dev Server Not Running on Port 3000**:
   - Next.js dev server must be on port 3000
   - Check: `lsof -i :3000`

3. **Webhook Signature Verification Failing**:
   - Stripe requires signature verification in production
   - In dev mode with Stripe CLI, uses webhook signing secret
   - Check: Is webhook signing secret correct?

4. **Route Not Accessible**:
   - Endpoint: `POST /api/stripe/webhook`
   - Check: Can we curl the endpoint?

5. **Checkout Flow Not Triggering Webhooks**:
   - Embedded checkout may have configuration issue
   - Check: Are webhooks enabled for the checkout session?

## Debugging Steps

### Step 1: Check Stripe CLI Output

When you complete a checkout, the Stripe CLI terminal should show:

```
2025-11-05 23:22:59   --> checkout.session.completed [evt_xxx]
2025-11-05 23:22:59   <-- [200] POST http://localhost:3000/api/stripe/webhook [evt_xxx]
```

**If you see this**: Webhooks are being forwarded, issue is in the app
**If you don't see this**: Stripe CLI is not receiving events

### Step 2: Check Dev Server Logs

Your Next.js dev server terminal should show:

```
🎯 [Webhook] Processing checkout.session.completed: cs_xxx
🎯 [Webhook] Processing invoice.paid: in_xxx
✅ [Webhook] Found metadata in subscription: { userId: '...', pilotCredits: 1000 }
```

**If you see this**: Webhook code is executing
**If you don't see this**: Webhook endpoint not being reached

### Step 3: Test Webhook Endpoint Manually

```bash
curl -X POST http://localhost:3000/api/stripe/webhook \
  -H "Content-Type: application/json" \
  -d '{"type":"ping"}'
```

**Expected**: Should return a response (even if error)
**If 404**: Route not registered properly

### Step 4: Check Stripe Dashboard

1. Go to: https://dashboard.stripe.com/test/events
2. Find recent `checkout.session.completed` or `invoice.paid` events
3. Check if they show as "delivered" or "failed"

## Temporary Workaround

Until automatic webhook sync is working, use manual sync after each purchase:

```bash
# 1. User completes checkout in browser
# 2. Update subscription ID in sync script
# 3. Run manual sync
npx ts-node scripts/sync-stripe-subscription.ts

# 4. Verify
npx ts-node scripts/check-subscription-details.ts
```

## Questions to Answer

1. **Do you see ANY output in the Stripe CLI terminal when you complete checkout?**
   - Yes: Webhooks are being sent, issue is in app
   - No: Webhooks aren't being triggered at all

2. **Do you see ANY webhook logs in your Next.js dev server terminal?**
   - Yes: Webhook endpoint is being hit
   - No: Webhook endpoint not being reached

3. **What port is your dev server running on?**
   - Should be: 3000
   - Check with: `lsof -i :3000`

4. **Are there multiple dev servers running?**
   - Check with: `ps aux | grep next`
   - May need to kill old processes

## Next Steps

Based on the answers above, we can determine:

**If Stripe CLI shows events**: Issue is in Next.js app routing or webhook handler
**If Stripe CLI shows nothing**: Issue is with Stripe checkout configuration or CLI setup
**If dev server port is wrong**: Need to restart dev server on correct port
**If multiple servers running**: Need to kill old processes

## Files Involved

- [app/api/stripe/webhook/route.ts](../app/api/stripe/webhook/route.ts) - Webhook handler (correct)
- [lib/stripe/StripeService.ts](../lib/stripe/StripeService.ts) - Creates checkout sessions (correct)
- [components/settings/BillingSettings.tsx](../components/settings/BillingSettings.tsx) - Initiates checkout (fixed)

## Status

🟡 **INVESTIGATING**: Webhook code is correct, but events not being received
✅ **WORKING**: Manual sync as workaround
✅ **FIXED**: Multiplier bug (1,000 vs 10,000)

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-12 | `stripe listen` command updated for Stripe CLI 1.53 | Stripe CLI 1.53 refuses a bare `stripe listen --forward-to …`. Every command now passes an explicit `--events` list (the events the webhook route and its Business OS plan and boost handlers handle), with `--all-snapshot` noted as the alternative and the `whsec_` → `STRIPE_WEBHOOK_SECRET` step spelled out. |
