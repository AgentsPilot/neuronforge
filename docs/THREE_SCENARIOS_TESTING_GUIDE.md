# Three Scenarios Testing Guide

## Overview

This guide covers testing all three billing scenarios in NeuronForge.

---

## ✅ Scenario 1: Start Monthly Subscription

### What It Does
User subscribes to a recurring monthly plan (e.g., 2,000 Pilot Credits/month).

### How to Test

1. **Navigate to Billing**
   ```
   http://localhost:3000/settings?tab=billing
   ```

2. **Go to Subscription Tab** (should be default)

3. **Enter Monthly Amount**
   - Example: `2000` Pilot Credits/month
   - Calculator shows: `$0.96/month`

4. **Click "Subscribe Now"**

5. **Complete Payment**
   - Test card: `4242 4242 4242 4242`
   - Expiry: Any future date
   - CVC: Any 3 digits
   - ZIP: Any 5 digits

### Expected Flow

1. ✅ Stripe creates subscription (mode: 'subscription')
2. ✅ Webhook: `checkout.session.completed` → Saves subscription IDs
3. ✅ Webhook: `invoice.paid` → Awards 20,000 tokens (2,000 Pilot Credits)
4. ✅ Database updates:
   ```sql
   stripe_subscription_id: 'sub_xxxxx'
   stripe_customer_id: 'cus_xxxxx'
   monthly_pilot_credits: 20000 (tokens)
   balance: += 20000 tokens
   ```

5. ✅ UI shows:
   ```
   ✅ Active Subscription
   2,000 Pilot Credits/month
   $0.96/month

   [Manage Subscription] button
   Next billing: Dec 5, 2025
   ```

### Verify

```bash
# Check subscription details
npx ts-node scripts/check-subscription-details.ts

# Should show:
# ✅ RECURRING MONTHLY SUBSCRIPTION
# Monthly: 2,000 Pilot Credits
# Price: $0.96/month
```

---

## ✅ Scenario 2: Upgrade Monthly Subscription

### What It Does
User increases their monthly plan (e.g., from 2,000 to 5,000 Pilot Credits/month).

### Prerequisites
Must have an active subscription from Scenario 1.

### How to Test

**Option A: Via New API Endpoint**

```bash
# Call the upgrade API
curl -X POST http://localhost:3000/api/stripe/update-subscription \
  -H "Content-Type: application/json" \
  -d '{"newPilotCredits": 5000}'
```

**Option B: Via Stripe Customer Portal (Current)**

1. Click **"Manage Subscription"** button
2. Opens Stripe portal
3. Update subscription amount

**Option C: Add UI Button (TODO)**

1. Click **"Upgrade Subscription"** button
2. Enter new amount: `5000` Pilot Credits
3. Shows: Old: 2,000 → New: 5,000 (+$1.44/month)
4. Click **"Confirm Upgrade"**

### Expected Flow

1. ✅ Stripe updates subscription
2. ✅ Database updates:
   ```sql
   monthly_pilot_credits: 50000 (tokens) -- updated
   monthly_amount_usd: 2.40 -- updated
   ```

3. ✅ Change takes effect: **Next billing cycle**
4. ✅ Current month: Still 2,000 Pilot Credits
5. ✅ Next month: Will receive 5,000 Pilot Credits

### Important Notes

- ⚠️ **No proration**: Change takes effect next cycle
- ⚠️ **Balance unchanged**: Doesn't add credits immediately
- ⚠️ **Next renewal**: Will receive new amount (5,000)

### Verify

```bash
npx ts-node scripts/check-subscription-details.ts

# Should show:
# Monthly: 5,000 Pilot Credits
# Price: $2.40/month
```

---

## ✅ Scenario 3: Boost Pack (One-Time)

### What It Does
User purchases additional credits NOW without changing monthly subscription.

### Use Case
- User has 2,000/month subscription
- Needs 10,000 credits immediately for a big task
- Doesn't want to increase monthly subscription

### How to Test

1. **Navigate to Boost Packs Tab**
   ```
   http://localhost:3000/settings?tab=billing
   → Click "Boost Packs" tab
   ```

2. **Select a Boost Pack**
   - Example: "Pro Pack" - 10,000 Pilot Credits
   - Price: $4.80 (one-time)

3. **Click "Purchase"**

4. **Complete Payment**
   - Test card: `4242 4242 4242 4242`
   - Expiry: Any future date
   - CVC: Any 3 digits

### Expected Flow

1. ✅ Stripe creates payment (mode: 'payment') - NOT subscription
2. ✅ Webhook: `checkout.session.completed`
3. ✅ Converts: 10,000 Pilot Credits → 100,000 tokens
4. ✅ Database updates:
   ```sql
   balance: += 100,000 tokens
   monthly_pilot_credits: UNCHANGED (still 20,000)
   ```

5. ✅ Transaction created:
   ```
   activity_type: 'boost_pack_purchase'
   credits_delta: 100,000 (tokens)
   description: "Boost pack purchase: 100,000 credits"
   ```

### Verify

```bash
npx ts-node scripts/check-transactions.ts

# Should show:
# Balance: 120,500 tokens = 12,050 Pilot Credits
#   - 500 (reward)
#   - 20,000 (monthly subscription)
#   - 100,000 (boost pack)
```

### Key Differences

| Aspect | Subscription | Boost Pack |
|--------|-------------|------------|
| Type | Recurring | One-time |
| Stripe mode | `subscription` | `payment` |
| Updates monthly? | YES | NO |
| Credits | Monthly renewal | Immediate |
| Rolls over? | N/A (monthly) | YES |
| Changes plan? | YES | NO |

---

## Complete Test Scenario

### Starting Point
```
Balance: 500 tokens (50 Pilot Credits - reward)
Subscription: None
```

### Step 1: Create Subscription (2,000/month)
```
Balance: 20,500 tokens (2,050 Pilot Credits)
Monthly: 2,000 Pilot Credits
Next billing: Dec 5, 2025
```

### Step 2: Buy Boost Pack (10,000)
```
Balance: 120,500 tokens (12,050 Pilot Credits)
Monthly: 2,000 Pilot Credits (unchanged)
Next billing: Dec 5, 2025
```

### Step 3: Upgrade Subscription (2,000 → 5,000)
```
Balance: 120,500 tokens (unchanged)
Monthly: 5,000 Pilot Credits (effective Dec 5)
Next billing: Dec 5, 2025 (will receive 5,000)
```

### Step 4: Next Month (Dec 5)
```
Balance: 170,500 tokens (17,050 Pilot Credits)
  = 120,500 + 50,000 (new monthly amount)
Monthly: 5,000 Pilot Credits
Next billing: Jan 5, 2026
```

---

## Database Verification Queries

### Check Subscription
```sql
SELECT
  monthly_pilot_credits / 10 as monthly_pilot_credits_display,
  monthly_amount_usd,
  balance / 10 as balance_display,
  stripe_subscription_id,
  current_period_end
FROM user_subscriptions
WHERE user_id = 'YOUR_USER_ID';
```

### Check Transactions
```sql
SELECT
  created_at,
  activity_type,
  credits_delta / 10 as pilot_credits_delta,
  balance_after / 10 as balance_after_display,
  description
FROM credit_transactions
WHERE user_id = 'YOUR_USER_ID'
ORDER BY created_at DESC;
```

### Expected Transaction Types
1. `reward_credit` - Initial reward
2. `subscription_renewal` - Monthly credits from invoice.paid
3. `boost_pack_purchase` - One-time boost pack
4. `agent_execution` - When agent runs (deduction)
5. `agent_creation` - When agent is created (deduction)

---

## Summary

✅ **Scenario 1**: Start subscription → Recurring monthly credits
✅ **Scenario 2**: Upgrade subscription → New amount next cycle
✅ **Scenario 3**: Boost pack → Immediate credits, no subscription change

All three scenarios are now implemented and use database-driven conversion rates!
