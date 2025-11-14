# Debugging Boost Pack Purchase

## Issue
- Purchased a boost pack
- `boost_pack_purchases` table is empty
- Not sure if credits were applied
- Need to verify in Stripe

---

## Step 1: Check Stripe Dashboard

### A. Find the Payment
1. Go to [Stripe Dashboard → Payments](https://dashboard.stripe.com/payments)
2. Look for recent successful payment (should be $5, $10, or $20)
3. Click on the payment to see details

### B. Check Payment Metadata
In the payment details, look for **Metadata** section. You should see:
- `user_id`: Your user UUID
- `boost_pack_id`: UUID of the boost pack
- `credits`: Number of Pilot Credits (e.g., 20833)
- `purchase_type`: "boost_pack"

**If metadata is missing**: The checkout wasn't created correctly

### C. Check Checkout Session
1. Go to [Stripe Dashboard → Payments → All Payments](https://dashboard.stripe.com/payments)
2. Click on the payment
3. Look for "Checkout Session" link
4. Verify metadata exists in the session

---

## Step 2: Check Webhook Events

### A. View Webhook Logs
1. Go to [Stripe Dashboard → Developers → Webhooks](https://dashboard.stripe.com/webhooks)
2. Click on your webhook endpoint
3. Look for recent events (should see `checkout.session.completed`)

### B. Check Event Details
Click on the `checkout.session.completed` event:
- **Status**: Should be "Succeeded" (green checkmark)
- **Response**: Check the response from your server
- **Attempts**: Should be 1 (or multiple if it failed initially)

**If webhook failed (red X)**:
- Click on the event
- Look at "Response" tab
- Check the error message

### C. Common Webhook Issues
- ❌ **401/403 Error**: Webhook secret mismatch
- ❌ **500 Error**: Server error (check app logs)
- ❌ **Timeout**: Webhook processing took too long
- ✅ **200 OK**: Webhook processed successfully

---

## Step 3: Check Database

### A. Check User Balance
```sql
-- Check if credits were added to balance
SELECT
  user_id,
  balance,
  total_earned,
  monthly_credits
FROM user_subscriptions
WHERE user_id = 'YOUR_USER_ID';
```

### B. Check Credit Transactions
```sql
-- Look for boost pack purchase transaction
SELECT
  created_at,
  credits_delta,
  balance_before,
  balance_after,
  activity_type,
  description,
  metadata
FROM credit_transactions
WHERE user_id = 'YOUR_USER_ID'
  AND activity_type = 'boost_pack_purchase'
ORDER BY created_at DESC
LIMIT 5;
```

**Expected result**: One row with:
- `credits_delta`: Positive number (e.g., 208330 tokens)
- `balance_after`: Your new balance
- `metadata`: Contains `stripe_session_id` and `boost_pack_id`

### C. Check Boost Pack Purchases
```sql
-- Check boost_pack_purchases table
SELECT
  bp.pack_name,
  bpp.credits_purchased,
  bpp.bonus_credits,
  bpp.price_paid_usd,
  bpp.payment_status,
  bpp.purchased_at,
  bpp.stripe_payment_intent_id
FROM boost_pack_purchases bpp
JOIN boost_packs bp ON bp.id = bpp.boost_pack_id
WHERE bpp.user_id = 'YOUR_USER_ID'
ORDER BY bpp.purchased_at DESC
LIMIT 5;
```

**If empty**: Webhook didn't reach `boost_pack_purchases` insert (line 307-318 in webhook)

---

## Step 4: Check Application Logs

### A. Check Webhook Processing Logs
Look for these log messages in your app logs:

```
🎉 [Webhook] Processing checkout.session.completed: cs_xxxxx
💰 Converting X Pilot Credits → Y tokens
✅ [Webhook] Boost pack processed
```

### B. Check for Errors
Look for these error patterns:

```
❌ [Webhook] No user_id in session metadata
❌ [Webhook] Error processing boost pack purchase
```

---

## Step 5: Manual Verification Steps

### Run These Queries to Debug

#### 1. Get Your User ID
```sql
SELECT id, email FROM auth.users WHERE email = 'your-email@example.com';
```

#### 2. Check All Your Transactions
```sql
SELECT
  created_at,
  activity_type,
  credits_delta,
  description
FROM credit_transactions
WHERE user_id = 'YOUR_USER_ID'
ORDER BY created_at DESC
LIMIT 10;
```

#### 3. Check Boost Pack Configuration
```sql
-- Make sure boost packs exist and have correct values
SELECT
  pack_key,
  pack_name,
  price_usd,
  credits_amount,
  bonus_credits,
  is_active
FROM boost_packs
ORDER BY price_usd;
```

#### 4. Check Recent Stripe Events
```sql
-- If you're logging Stripe events to database
SELECT
  event_type,
  event_id,
  created_at,
  processed
FROM stripe_events
ORDER BY created_at DESC
LIMIT 10;
```

---

## Common Issues and Solutions

### Issue 1: Webhook Not Firing
**Symptoms**: No `checkout.session.completed` event in Stripe

**Causes**:
- Using Stripe test mode but webhook configured for live mode (or vice versa)
- Webhook endpoint not configured in Stripe

**Solution**:
1. Check Stripe mode (test/live) matches your environment
2. Verify webhook endpoint exists: [Stripe → Developers → Webhooks](https://dashboard.stripe.com/webhooks)
3. Endpoint should be: `https://your-domain.com/api/stripe/webhook`

### Issue 2: Webhook Failing
**Symptoms**: Red X on webhook event in Stripe

**Causes**:
- Wrong webhook secret
- Server error in webhook handler
- Missing environment variables

**Solution**:
1. Check `.env` has correct `STRIPE_WEBHOOK_SECRET`
2. Check application logs for errors
3. Test webhook locally: `stripe listen --forward-to localhost:3000/api/stripe/webhook`

### Issue 3: Credits Not Applied
**Symptoms**: Webhook succeeded but balance didn't increase

**Causes**:
- `pilotCreditsToTokens()` conversion error
- Database update failed
- Wrong user ID in metadata

**Solution**:
1. Check webhook logs for conversion message
2. Verify `credits_delta` in `credit_transactions` table
3. Check `user_subscriptions.balance` was updated

### Issue 4: boost_pack_purchases Empty
**Symptoms**: Credits applied but no purchase record

**Causes**:
- Missing `boost_pack_id` in session metadata
- Database insert failed (constraint violation)
- Wrong field names in insert

**Solution**:
1. Check Stripe session metadata has `boost_pack_id`
2. Verify `boost_pack_id` is a valid UUID in `boost_packs` table
3. Check webhook logs for insert errors

---

## Testing Boost Pack Purchase

### Test with Stripe Test Card

1. Make sure you're in **test mode** (check Stripe dashboard toggle)
2. Use test card: `4242 4242 4242 4242`
3. Any future date for expiry
4. Any 3-digit CVC
5. Any ZIP code

### Expected Flow

1. **User clicks "Buy Now"** → Creates Stripe Checkout Session
2. **Stripe processes payment** → Returns to success URL
3. **Stripe sends webhook** → `checkout.session.completed` event
4. **Webhook handler**:
   - Converts Pilot Credits → tokens
   - Updates `user_subscriptions.balance`
   - Creates `credit_transactions` record
   - Creates `boost_pack_purchases` record
5. **User sees updated balance** in UI

### Quick Test Script

Run this to simulate and check:

```bash
# 1. Check boost packs exist
npx tsx scripts/check-boost-packs.ts

# 2. Make a test purchase in UI

# 3. Check Stripe webhook
curl https://dashboard.stripe.com/webhooks

# 4. Query database
psql $DATABASE_URL -c "SELECT * FROM boost_pack_purchases ORDER BY created_at DESC LIMIT 1;"
```

---

## Verification Checklist

After purchase, verify:

- [ ] Payment appears in Stripe Dashboard
- [ ] Payment has correct metadata (user_id, boost_pack_id, credits)
- [ ] Webhook event shows "Succeeded" (green checkmark)
- [ ] Webhook response is 200 OK
- [ ] `user_subscriptions.balance` increased
- [ ] `credit_transactions` has new row with `activity_type = 'boost_pack_purchase'`
- [ ] `boost_pack_purchases` has new row
- [ ] UI shows updated balance

---

## Get Help

If still stuck, provide this info:

1. **Stripe Payment ID**: `pi_xxxxx` (from Stripe Dashboard)
2. **Checkout Session ID**: `cs_xxxxx` (from Stripe Dashboard)
3. **User ID**: Your UUID from database
4. **Boost Pack ID**: UUID of pack you tried to purchase
5. **Webhook Event Status**: Success or Error message
6. **Database Check Results**: Results from SQL queries above
7. **Application Logs**: Any error messages from webhook processing

This will help diagnose exactly where the flow is breaking.
