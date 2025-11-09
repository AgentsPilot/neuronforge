# Clean State Testing - Ready to Go!

## Current State ✅

Your database has been reset to a clean state:

- **Balance**: 500 tokens = 50 Pilot Credits (reward only)
- **Stripe Subscription**: None
- **Stripe Customer**: None
- **Status**: Active

You're now ready to test all three scenarios from scratch!

---

## Test Scenario 1: Start Monthly Subscription

### Steps

1. **Open Billing Page**
   ```
   http://localhost:3000/settings?tab=billing
   ```

2. **Go to Subscription Tab** (should be default view)

3. **Enter Amount in Calculator**
   - Example: `2000` Pilot Credits
   - Calculator shows: `$0.96/month`
   - Button should say: **"Start Subscription"**

4. **Click "Start Subscription"**
   - Stripe Checkout modal opens
   - Mode: `subscription` (recurring)

5. **Complete Payment**
   - Test card: `4242 4242 4242 4242`
   - Expiry: Any future date (e.g., 12/26)
   - CVC: Any 3 digits (e.g., 123)
   - ZIP: Any 5 digits (e.g., 12345)

6. **Click "Pay"**

### Expected Results

1. ✅ Stripe creates subscription
2. ✅ Webhook `checkout.session.completed` saves subscription IDs
3. ✅ Webhook `invoice.paid` awards 20,000 tokens (2,000 Pilot Credits)
4. ✅ Database updated:
   ```
   balance: 20,500 tokens (2,050 Pilot Credits)
     = 500 (reward)
     + 20,000 (subscription)

   stripe_subscription_id: 'sub_xxxxx'
   stripe_customer_id: 'cus_xxxxx'
   monthly_amount_usd: 0.96
   status: 'active'
   ```

5. ✅ UI shows:
   ```
   Active Subscription
   2,000 Pilot Credits/month
   $0.96/month

   [Update Subscription] button
   Next billing: Dec 5, 2025
   ```

### Verify

```bash
npx ts-node scripts/check-subscription-details.ts
```

Expected output:
```
✅ RECURRING MONTHLY SUBSCRIPTION
Monthly: 2,000 Pilot Credits
Price: $0.96/month
Balance: 2,050 Pilot Credits
```

---

## Test Scenario 2: Upgrade Subscription

**Prerequisites**: Must complete Scenario 1 first.

### Steps

1. **Go back to Subscription Tab**
   - Button should now say: **"Update Subscription"**

2. **Enter New Amount**
   - Example: `5000` Pilot Credits
   - Calculator shows: `$2.40/month`

3. **Click "Update Subscription"**
   - No Stripe modal (direct API call)
   - Alert message appears: "Subscription updated! Your new amount of 5,000 Pilot Credits/month will take effect on your next billing date."

### Expected Results

1. ✅ Stripe subscription updated (no proration)
2. ✅ Database updated:
   ```
   monthly_amount_usd: 2.40 (updated)
   balance: 20,500 tokens (unchanged)
   ```

3. ✅ Change takes effect: **Next billing cycle**
4. ✅ Current balance: Still 2,050 Pilot Credits
5. ✅ Next renewal: Will receive 5,000 Pilot Credits

### Verify

```bash
npx ts-node scripts/check-subscription-details.ts
```

Expected output:
```
✅ RECURRING MONTHLY SUBSCRIPTION
Monthly: 5,000 Pilot Credits (updated)
Price: $2.40/month (updated)
Balance: 2,050 Pilot Credits (unchanged)
```

---

## Test Scenario 3: Boost Pack (One-Time)

**Prerequisites**: Can be done with or without subscription.

### Steps

1. **Navigate to Boost Packs Tab**
   ```
   Settings → Billing → Boost Packs tab
   ```

2. **Select a Boost Pack**
   - Example: "Pro Pack" - 10,000 Pilot Credits
   - Price: $4.80 (one-time)

3. **Click "Purchase"**
   - Stripe Checkout modal opens
   - Mode: `payment` (one-time, NOT subscription)

4. **Complete Payment**
   - Test card: `4242 4242 4242 4242`
   - Complete payment

### Expected Results

1. ✅ Stripe creates payment (mode: 'payment')
2. ✅ Webhook `checkout.session.completed`
3. ✅ Converts: 10,000 Pilot Credits → 100,000 tokens
4. ✅ Database updated:
   ```
   balance: += 100,000 tokens
   monthly_amount_usd: UNCHANGED
   stripe_subscription_id: UNCHANGED
   ```

5. ✅ Transaction created:
   ```
   activity_type: 'boost_pack_purchase'
   credits_delta: 100,000 tokens
   description: "Boost pack purchase: 100,000 credits"
   ```

### Verify

```bash
npx ts-node scripts/check-subscription-details.ts
```

Expected output (if you did Scenarios 1 & 2 first):
```
✅ RECURRING MONTHLY SUBSCRIPTION
Monthly: 5,000 Pilot Credits (unchanged)
Price: $2.40/month (unchanged)
Balance: 12,050 Pilot Credits
  = 50 (reward)
  + 2,000 (monthly subscription)
  + 10,000 (boost pack)
```

---

## Complete Test Flow

### Starting Point
```
Balance: 50 Pilot Credits (reward only)
Subscription: None
```

### After Scenario 1 (Start Subscription - 2,000/month)
```
Balance: 2,050 Pilot Credits
Subscription: 2,000 Pilot Credits/month
Price: $0.96/month
Next billing: Dec 5, 2025
```

### After Scenario 3 (Boost Pack - 10,000)
```
Balance: 12,050 Pilot Credits
Subscription: 2,000 Pilot Credits/month (unchanged)
Price: $0.96/month
Next billing: Dec 5, 2025
```

### After Scenario 2 (Upgrade - 2,000 → 5,000)
```
Balance: 12,050 Pilot Credits (unchanged)
Subscription: 5,000 Pilot Credits/month (effective Dec 5)
Price: $2.40/month
Next billing: Dec 5, 2025
```

### Next Month (Dec 5)
```
Balance: 17,050 Pilot Credits
  = 12,050 (current)
  + 5,000 (new monthly amount)

Subscription: 5,000 Pilot Credits/month
Price: $2.40/month
Next billing: Jan 5, 2026
```

---

## Key Differences Between Scenarios

| Aspect | Subscription | Update | Boost Pack |
|--------|-------------|--------|------------|
| **Type** | Recurring | Update existing | One-time |
| **Stripe Mode** | `subscription` | API call | `payment` |
| **Modal** | Opens Stripe | No modal | Opens Stripe |
| **Updates Monthly** | YES | YES | NO |
| **Credits** | Next cycle | Next cycle | Immediate |
| **Changes Plan** | Creates new | Updates existing | Doesn't change |
| **Button Text** | "Start Subscription" | "Update Subscription" | "Purchase" |

---

## Verification Scripts

### Check Subscription Status
```bash
npx ts-node scripts/check-subscription-details.ts
```

### Reset to Clean State (if needed)
```bash
npx ts-node scripts/reset-stripe-subscription.ts
```

---

## Important Notes

1. **Pilot Credits vs Tokens**:
   - UI always shows Pilot Credits (user-facing)
   - Database stores tokens (1 Pilot Credit = 10 tokens)
   - Conversion fetched from database (`ais_system_config`)

2. **No Proration**:
   - Subscription updates take effect NEXT billing cycle
   - Balance doesn't change immediately when updating subscription
   - Boost packs add to balance immediately

3. **Button Text**:
   - Changes from "Start Subscription" → "Update Subscription"
   - Based on presence of `stripe_subscription_id`

4. **Test Cards**:
   - Success: `4242 4242 4242 4242`
   - Declined: `4000 0000 0000 0002`
   - Requires Auth: `4000 0025 0000 3155`

---

## Troubleshooting

### Issue: Button still says "Start Subscription" after creating one

**Check**:
```bash
npx ts-node scripts/check-subscription-details.ts
```

**Solution**: Refresh the page or check that `stripe_subscription_id` exists in database.

### Issue: Balance not updating after payment

**Check Webhooks**:
1. Go to Stripe Dashboard → Webhooks
2. Check recent events for `invoice.paid` or `checkout.session.completed`
3. Should show 200 status code

**Check Database**:
```sql
SELECT * FROM credit_transactions
WHERE user_id = '08456106-aa50-4810-b12c-7ca84102da31'
ORDER BY created_at DESC
LIMIT 5;
```

### Issue: Calculator not showing correct price

**Check Pricing Config**:
```sql
SELECT * FROM ais_system_config
WHERE config_key IN ('pilot_credit_cost_usd', 'tokens_per_pilot_credit');
```

Expected:
- `pilot_credit_cost_usd`: 0.00048
- `tokens_per_pilot_credit`: 10

---

## Ready to Test! 🚀

Your system is now in a clean state and ready to test all three billing scenarios. Start with Scenario 1, then test Scenarios 2 and 3 in any order.

For detailed webhook testing and troubleshooting, see:
- [THREE_SCENARIOS_TESTING_GUIDE.md](THREE_SCENARIOS_TESTING_GUIDE.md)
- [STRIPE_TESTING_GUIDE.md](STRIPE_TESTING_GUIDE.md)
