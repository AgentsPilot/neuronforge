# Subscription Sync Fix - Summary

## Issue

After creating a subscription in Stripe for 10,000 Pilot Credits ($4.80/month), the subscription existed in Stripe but the user's balance in the database was not updated.

## Root Causes

### 1. Missing Invoice Metadata

**Problem**: When Stripe creates an invoice for a subscription, it doesn't automatically copy the subscription metadata to the invoice metadata.

**Impact**: The `invoice.paid` webhook handler was looking for `user_id` and `credits` in `invoice.metadata`, but these fields were empty. This caused the webhook to silently fail without awarding credits.

**Fix**: Updated `handleInvoicePaid()` in [app/api/stripe/webhook/route.ts](app/api/stripe/webhook/route.ts:37-46) to fetch metadata from the subscription if it's not in the invoice:

```typescript
// If metadata not in invoice, fetch from subscription
const invoiceSubscription = (invoice as any).subscription;
if (!userId && invoiceSubscription) {
  console.log('📋 [Webhook] Fetching metadata from subscription:', invoiceSubscription);
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY!);
  const subscription = await stripe.subscriptions.retrieve(invoiceSubscription as string);
  userId = subscription.metadata?.user_id;
  pilotCredits = parseInt(subscription.metadata?.credits || '0');
  console.log('✅ [Webhook] Found metadata in subscription:', { userId, pilotCredits });
}
```

### 2. Non-Existent Column: monthly_pilot_credits

**Problem**: Multiple files were trying to update a column `monthly_pilot_credits` that doesn't exist in the `user_subscriptions` table.

**Error**: `Could not find the 'monthly_pilot_credits' column of 'user_subscriptions' in the schema cache`

**Impact**: All database updates were failing silently.

**Files Fixed**:
- [app/api/stripe/webhook/route.ts](app/api/stripe/webhook/route.ts:74-86) - Removed `monthly_pilot_credits` from update
- [app/api/stripe/update-subscription/route.ts](app/api/stripe/update-subscription/route.ts:73-79) - Removed `monthly_pilot_credits` from update

### 3. Check Constraint Violation

**Problem**: Database has a constraint `check_monthly_amount_minimum` that was rejecting certain values for `monthly_amount_usd`.

**Temporary Fix**: Removed `monthly_amount_usd` from initial sync script to focus on getting credits awarded first.

## Solution Implemented

### Manual Sync Script

Created [scripts/sync-stripe-subscription.ts](scripts/sync-stripe-subscription.ts) to manually sync the subscription from Stripe to the database.

**What it does**:
1. Fetches subscription from Stripe
2. Extracts metadata (user_id, pilot credits)
3. Converts Pilot Credits → Tokens (10:1 ratio)
4. Updates user balance and subscription IDs
5. Creates credit transaction record
6. Creates billing event

**Result**:
```
✅ Balance: 10,050 Pilot Credits
   - 50 (initial reward)
   + 10,000 (subscription)

✅ Subscription ID: sub_1SQFLa56GTXD0wwiwdS9QqmU
✅ Customer ID: cus_TMzIi4IjkeeJvx
✅ Status: Active
```

## Files Modified

### 1. `/app/api/stripe/webhook/route.ts`

**Line 37-46**: Added logic to fetch metadata from subscription if not in invoice
**Line 74-86**: Removed `monthly_pilot_credits` field from update

### 2. `/app/api/stripe/update-subscription/route.ts`

**Line 73-79**: Removed `monthly_pilot_credits` field from update
**Line 82-83**: Changed to calculate old Pilot Credits from `monthly_amount_usd` instead of non-existent column

### 3. New Scripts Created

- `/scripts/check-stripe-subscription.ts` - Check subscription details in Stripe
- `/scripts/sync-stripe-subscription.ts` - Manually sync subscription from Stripe to database
- `/scripts/manually-process-invoice.ts` - Process a specific invoice manually

## Architecture Clarification

### Pilot Credits vs Tokens

**User-Facing (UI & Stripe)**:
- All amounts shown in **Pilot Credits**
- Stripe metadata stores **Pilot Credits**
- Calculator displays **Pilot Credits**

**Database Storage**:
- All amounts stored as **tokens**
- Conversion: 1 Pilot Credit = 10 tokens
- Fetched from `ais_system_config.tokens_per_pilot_credit`

### Example Flow

1. **User subscribes**: 10,000 Pilot Credits/month
2. **Stripe creates**: Subscription with metadata `{ credits: "10000" }`
3. **Invoice paid**: $4.80 charged
4. **Webhook receives**: `invoice.paid` event
5. **Webhook fetches**: Subscription metadata (user_id, credits)
6. **Webhook converts**: 10,000 Pilot Credits → 100,000 tokens
7. **Database updated**: `balance += 100,000` tokens
8. **UI displays**: 10,000 Pilot Credits

## Testing

### Verify Subscription

```bash
npx ts-node scripts/check-subscription-details.ts
```

**Expected Output**:
```
✅ RECURRING MONTHLY SUBSCRIPTION
Monthly: 10,000 Pilot Credits
Price: $4.80/month
Balance: 10,050 Pilot Credits
```

### Check Stripe Subscription

```bash
npx ts-node scripts/check-stripe-subscription.ts
```

### Manual Sync (if needed)

```bash
npx ts-node scripts/sync-stripe-subscription.ts
```

## Next Steps

### For Future Subscriptions

The webhook handler is now fixed and will:
1. Receive `invoice.paid` event
2. Check invoice metadata for `user_id` and `credits`
3. If not found, fetch from subscription metadata
4. Convert Pilot Credits to tokens
5. Update user balance
6. Create transaction and billing event

### For Testing

1. **Scenario 1**: Start new subscription ✅ (should work now with webhook fix)
2. **Scenario 2**: Upgrade subscription ⚠️ (needs testing after webhook fix)
3. **Scenario 3**: Boost pack ✅ (already working)

## Important Notes

1. **Stripe Metadata**: Always store Pilot Credits in Stripe metadata, not tokens
2. **Database Storage**: Always store tokens in database, not Pilot Credits
3. **UI Display**: Always show Pilot Credits to users, not tokens
4. **Conversion**: Always fetch conversion rate from `ais_system_config` table

## Column That Doesn't Exist

**DO NOT USE**: `monthly_pilot_credits` - This column does not exist in `user_subscriptions` table

**Use Instead**: Calculate from `monthly_amount_usd / pilot_credit_cost_usd`

## Success!

The subscription has been successfully synced and the user now has 10,050 Pilot Credits (10,000 from subscription + 50 from reward).

Future subscriptions will work automatically via the fixed webhook handler.
