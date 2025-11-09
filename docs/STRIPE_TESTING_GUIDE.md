# Stripe Testing Guide - End-to-End Flow

## Overview

This guide shows how to test the complete billing flow including transactions, invoices, and credit allocation without deleting your existing subscription.

## Option 1: Trigger Test Webhooks from Stripe Dashboard (Recommended)

### Step 1: Access Stripe Webhook Testing

1. Go to [Stripe Dashboard](https://dashboard.stripe.com/test/webhooks)
2. Click on your webhook endpoint (the one for your local/dev environment)
3. Click "Send test webhook" button

### Step 2: Test Invoice Payment

```json
{
  "event": "invoice.paid",
  "data": {
    "object": {
      "id": "in_test_123",
      "customer": "cus_test_123",
      "amount_paid": 48,
      "currency": "usd",
      "metadata": {
        "user_id": "YOUR_USER_ID_HERE",
        "credits": "1000"
      },
      "lines": {
        "data": [
          {
            "period": {
              "start": 1730851200,
              "end": 1733529600
            }
          }
        ]
      }
    }
  }
}
```

### Step 3: Test Checkout Completion (Boost Pack)

```json
{
  "event": "checkout.session.completed",
  "data": {
    "object": {
      "id": "cs_test_123",
      "customer": "cus_test_123",
      "mode": "payment",
      "amount_total": 10000,
      "currency": "usd",
      "metadata": {
        "user_id": "YOUR_USER_ID_HERE",
        "credits": "5000",
        "purchase_type": "boost_pack",
        "boost_pack_id": "boost-pack-id"
      }
    }
  }
}
```

### Step 4: Verify Results

After triggering the webhook, check:

1. **Balance Updated**:
   ```sql
   SELECT balance, total_earned FROM user_subscriptions WHERE user_id = 'YOUR_USER_ID';
   ```

2. **Transaction Created**:
   ```sql
   SELECT * FROM credit_transactions WHERE user_id = 'YOUR_USER_ID' ORDER BY created_at DESC LIMIT 1;
   ```

3. **Invoice Recorded** (for invoice.paid):
   ```sql
   SELECT * FROM subscription_invoices WHERE user_id = 'YOUR_USER_ID' ORDER BY created_at DESC LIMIT 1;
   ```

4. **Billing Event Logged**:
   ```sql
   SELECT * FROM billing_events WHERE user_id = 'YOUR_USER_ID' ORDER BY created_at DESC LIMIT 1;
   ```

## Option 2: Create a New Test Purchase

### Using Stripe Test Cards

1. **Navigate to Billing Tab** in your app
2. **Select a Boost Pack** or create custom subscription
3. **Use test card**: `4242 4242 4242 4242`
   - Any future expiry date
   - Any 3-digit CVC
   - Any billing postal code

### Expected Flow

1. ✅ Checkout modal opens
2. ✅ Stripe form loads
3. ✅ Enter test card details
4. ✅ Click "Pay"
5. ✅ Webhook receives `checkout.session.completed`
6. ✅ Converts Pilot Credits → Tokens
7. ✅ Updates balance
8. ✅ Creates transaction record
9. ✅ Modal closes
10. ✅ UI refreshes showing new balance

## Option 3: Use Stripe CLI for Local Testing

### Setup

```bash
# Install Stripe CLI (if not already installed)
brew install stripe/stripe-cli/stripe

# Login to Stripe
stripe login

# Forward webhooks to local server
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

### Trigger Events

```bash
# Test invoice payment
stripe trigger invoice.payment_succeeded

# Test checkout completion
stripe trigger checkout.session.completed

# Test subscription renewal
stripe trigger customer.subscription.updated
```

## Option 4: Manual Test Script (Current Database)

You can use the test scripts to simulate transactions:

```bash
# View current balance and transactions
npx ts-node scripts/check-transactions.ts

# Award test credits (simulates a purchase)
npx ts-node scripts/process-test-payment.ts

# Verify the transaction was recorded
npx ts-node scripts/check-transactions.ts
```

## Verification Checklist

After any test, verify the following:

### 1. Database State

```sql
-- Check balance (should be in tokens)
SELECT
  balance,
  balance / 10 as pilot_credits,
  total_earned,
  total_spent,
  status
FROM user_subscriptions
WHERE user_id = 'YOUR_USER_ID';

-- Check transactions
SELECT
  created_at,
  activity_type,
  credits_delta,
  credits_delta / 10 as pilot_credits_delta,
  balance_before,
  balance_after,
  description
FROM credit_transactions
WHERE user_id = 'YOUR_USER_ID'
ORDER BY created_at DESC
LIMIT 5;

-- Check invoices
SELECT
  invoice_number,
  amount_paid,
  credits_allocated,
  credits_allocated / 10 as pilot_credits,
  status,
  invoice_date
FROM subscription_invoices
WHERE user_id = 'YOUR_USER_ID'
ORDER BY created_at DESC
LIMIT 5;

-- Check billing events
SELECT
  created_at,
  event_type,
  credits_delta,
  credits_delta / 10 as pilot_credits_delta,
  description
FROM billing_events
WHERE user_id = 'YOUR_USER_ID'
ORDER BY created_at DESC
LIMIT 5;
```

### 2. UI Verification

1. **Settings → Billing Tab**
   - Balance should show correct Pilot Credits
   - Total earned should match
   - Status should be "active"

2. **Invoices Sub-tab**
   - Latest invoice should appear
   - Shows correct amount and credits
   - PDF/download link works

3. **Usage & Transactions Sub-tab**
   - Latest transaction visible
   - Shows "+1,000 Pilot Credits" (or amount purchased)
   - Running balance correct

### 3. Console Logs

When webhook processes:

```
🎯 [Webhook] Processing invoice.paid: in_xxx
💰 Converting 1000 Pilot Credits → 10000 tokens
✅ [Webhook] Invoice processed successfully: {
  userId: 'xxx',
  credits: 10000,
  newBalance: 20500
}
```

## Testing Different Scenarios

### Scenario 1: First Purchase (New User)

```
Initial: 500 tokens (50 Pilot Credits - reward)
Purchase: 1,000 Pilot Credits
Expected: 10,500 tokens (1,050 Pilot Credits)
```

### Scenario 2: Boost Pack Purchase

```
Current: 10,500 tokens (1,050 Pilot Credits)
Purchase: 5,000 Pilot Credits
Expected: 60,500 tokens (6,050 Pilot Credits)
```

### Scenario 3: Subscription Renewal

```
Current: 5,000 tokens (500 Pilot Credits)
Renewal: 1,000 Pilot Credits (monthly)
Expected: 15,000 tokens (1,500 Pilot Credits)
```

### Scenario 4: Payment Failure

```
Current: 5,000 tokens (500 Pilot Credits)
Event: invoice.payment_failed
Expected:
  - Balance unchanged
  - Status: 'past_due' (after grace period)
  - agents_paused: true (after grace period)
  - Billing event created
```

## Quick Test Script

Create a quick test to verify everything:

```bash
# 1. Check current state
npx ts-node scripts/check-transactions.ts

# 2. Get your user ID from output
# USER_ID="08456106-aa50-4810-b12c-7ca84102da31"

# 3. Test webhook locally (if using Stripe CLI)
stripe trigger checkout.session.completed \
  --add checkout_session:metadata.user_id=$USER_ID \
  --add checkout_session:metadata.credits=1000 \
  --add checkout_session:metadata.purchase_type=boost_pack

# 4. Verify results
npx ts-node scripts/check-transactions.ts
```

## Expected Output

### After Successful Purchase

**Transaction Record:**
```
{
  id: "xxx",
  activity_type: "boost_pack_purchase",
  credits_delta: 10000,  // tokens
  balance_before: 500,
  balance_after: 10500,
  description: "Boost pack purchase: 10,000 credits"
}
```

**Invoice Record:**
```
{
  id: "xxx",
  invoice_number: "INV-xxx",
  amount_paid: "0.48",
  credits_allocated: 10000,  // tokens
  status: "paid"
}
```

**UI Display:**
```
Balance: 1,050 Pilot Credits
Total Earned: 1,050 Pilot Credits
Latest Transaction: +1,000 Pilot Credits
Latest Invoice: Invoice #INV-xxx - $0.48 - 1,000 Pilot Credits
```

## Troubleshooting

### Issue: Balance not updating

1. Check webhook was received:
   ```bash
   # Check your server logs
   tail -f logs/app.log | grep "Webhook"
   ```

2. Check Stripe Dashboard → Webhooks → Events
   - Should show event with 200 status

3. Check database directly:
   ```sql
   SELECT * FROM credit_transactions
   WHERE created_at > NOW() - INTERVAL '1 hour'
   ORDER BY created_at DESC;
   ```

### Issue: Conversion incorrect

1. Verify database config:
   ```sql
   SELECT * FROM ais_system_config
   WHERE config_key = 'tokens_per_pilot_credit';
   ```

2. Should return: `config_value: '10'`

### Issue: UI shows wrong amount

1. Check `formatCredits()` in BillingSettings.tsx
2. Verify it divides by `pricingConfig.tokens_per_pilot_credit`
3. Check console for pricing config load:
   ```javascript
   console.log('Pricing config loaded:', pricingConfig);
   ```

## Clean Up Test Data (Optional)

After testing, you can remove test transactions:

```sql
-- View test transactions
SELECT * FROM credit_transactions
WHERE metadata->>'test_payment' = 'true';

-- Delete test transactions (careful!)
DELETE FROM credit_transactions
WHERE metadata->>'test_payment' = 'true';

-- Reset balance to specific amount
UPDATE user_subscriptions
SET balance = 500, total_earned = 500
WHERE user_id = 'YOUR_USER_ID';
```

## Recommended Test Flow

**For comprehensive testing:**

1. ✅ Check initial state (`check-transactions.ts`)
2. ✅ Trigger test webhook (Stripe Dashboard or CLI)
3. ✅ Verify database updated (SQL queries)
4. ✅ Check UI updated (Billing tab)
5. ✅ Verify transaction appears (Usage tab)
6. ✅ Verify invoice appears (Invoices tab)
7. ✅ Test with different amounts
8. ✅ Test payment failure scenario

This gives you confidence that the entire flow works correctly!
