# Billing UX Improvements - Implementation Plan

## Current State Analysis

### 1. Manage Subscription Button
**Current Behavior**: Opens Stripe Customer Portal (external)
**Purpose**: Allows users to:
- Cancel subscription
- Update payment method
- View Stripe-managed invoice history
- See billing information

**Issue**: Takes user away from our app to Stripe's portal

**Proposed Solution**:
- Keep the button for payment method updates and cancellation (Stripe-only features)
- Rename to "Manage Payment Method" or "Billing Portal"
- Move critical info (dates, pending changes, invoices) into our UI

---

## Implementation Tasks

### Task 1: Show Subscription Dates in Active Subscription Card ✅ (Already Implemented)
**Status**: DONE - Already showing next billing date (line 869-880)

**Current Display**:
```typescript
{userSubscription.current_period_end && (
  <div>Next billing date: {formatted_date}</div>
)}
```

**Enhancement Needed**: Add start date
```typescript
- Subscription started: {current_period_start or created_at}
- Next billing date: {current_period_end}
```

---

### Task 2: Show Pending Changes (Update Affects Next Cycle)
**Problem**: When user updates subscription (e.g., 20K → 50K credits), they don't see:
- Current amount: 20K credits
- Pending amount: 50K credits (effective {date})

**Solution**: Track pending subscription changes in database

**Database Addition Needed**:
```sql
ALTER TABLE user_subscriptions ADD COLUMN pending_change JSONB;
-- Structure: {
--   "new_amount_usd": 24.00,
--   "new_pilot_credits": 50000,
--   "effective_date": "2025-12-01T00:00:00Z",
--   "changed_at": "2025-11-05T10:30:00Z"
-- }
```

**UI Display**:
```
Active Subscription
├─ Current: 20,834 Pilot Credits/month
├─ Pending Change: ⏰ 52,085 Pilot Credits/month
└─ Takes effect: December 1, 2025
```

---

### Task 3: Invoices Tab
**Current**: Empty stub component
**Needed**: Display Stripe invoices from database

**Tables to Query**:
1. `billing_events` - Our internal events (renewal_success, payment_failed, etc.)
2. Stripe API - Actual invoices with PDF links

**Implementation**:
```typescript
// Fetch from Stripe
const invoices = await stripe.invoices.list({
  customer: stripe_customer_id,
  limit: 100
});

// Display:
- Invoice date
- Amount
- Status (paid, pending, failed)
- Description
- PDF download link
- Pilot Credits allocated
```

---

### Task 4: Usage & Transactions Tab
**Current**: Shows UsageAnalytics component
**Issue**: Missing credit transaction history

**Data Source**: `credit_transactions` table
```sql
SELECT
  created_at,
  transaction_type,  -- allocation, usage, refund
  activity_type,     -- subscription_renewal, agent_execution, etc.
  credits_delta,     -- +208330 or -1500
  balance_before,
  balance_after,
  description,
  metadata
FROM credit_transactions
WHERE user_id = ?
ORDER BY created_at DESC
```

**UI Display**:
```
Date         | Type              | Credits    | Balance
-------------|-------------------|------------|----------
Nov 5, 2024  | Subscription      | +208,330   | 208,330
Nov 5, 2024  | Agent Execution   | -1,500     | 206,830
Nov 4, 2024  | Agent Execution   | -2,300     | 204,530
```

---

### Task 5: Audit Logging for Subscription Changes
**Current**: Some events in `billing_events`, but not comprehensive

**Needed**: Log every subscription action with full context

**Events to Log**:
1. `subscription_created` - New subscription started
2. `subscription_updated` - Amount changed
3. `subscription_renewed` - Monthly renewal
4. `subscription_canceled` - User canceled
5. `payment_method_updated` - Card changed
6. `payment_failed` - Payment didn't go through
7. `credits_allocated` - Monthly credits awarded
8. `credits_refunded` - Credits returned

**Audit Log Structure**:
```typescript
{
  user_id: string
  event_type: string
  timestamp: Date
  actor: 'user' | 'system' | 'webhook'
  changes: {
    before: { monthly_amount_usd: 10, pilot_credits: 20834 }
    after: { monthly_amount_usd: 25, pilot_credits: 52085 }
  }
  metadata: {
    stripe_subscription_id
    stripe_invoice_id
    ip_address
    user_agent
  }
}
```

---

## Implementation Order

### Phase 1: Information Display (High Priority)
1. ✅ Add start date to Active Subscription card
2. ✅ Build Invoices Tab with Stripe invoice history
3. ✅ Build Transactions Tab with credit_transactions history

### Phase 2: Pending Changes (Medium Priority)
4. Add `pending_change` column to database
5. When user updates subscription, store pending change
6. Display pending change in Active Subscription card
7. Clear pending change when Stripe webhook confirms update

### Phase 3: Comprehensive Audit (Medium Priority)
8. Enhance `billing_events` table or create dedicated `audit_log`
9. Add audit logging to all subscription operations
10. Create admin view of audit trail

---

## Database Schema Changes Needed

```sql
-- 1. Add pending change tracking
ALTER TABLE user_subscriptions
ADD COLUMN pending_change JSONB,
ADD COLUMN pending_change_created_at TIMESTAMP;

-- 2. Enhance billing_events for better audit trail
ALTER TABLE billing_events
ADD COLUMN actor VARCHAR(50), -- 'user', 'system', 'webhook'
ADD COLUMN ip_address VARCHAR(45),
ADD COLUMN user_agent TEXT,
ADD COLUMN changes_before JSONB,
ADD COLUMN changes_after JSONB;

-- 3. Index for performance
CREATE INDEX idx_billing_events_user_created
ON billing_events(user_id, created_at DESC);

CREATE INDEX idx_credit_transactions_user_created
ON credit_transactions(user_id, created_at DESC);
```

---

## User Flow Examples

### Scenario 1: User increases subscription
1. User slides from 20K → 50K credits
2. Clicks "Update Subscription"
3. ✅ Success message: "Subscription Updated!"
4. Active Subscription card shows:
   ```
   Current: 20,834 credits/month
   Pending: 52,085 credits/month (effective Dec 1, 2025)
   ```
5. Stripe processes on Dec 1
6. Webhook fires → Clear pending_change → Update monthly_amount_usd
7. Card now shows: "52,085 credits/month"

### Scenario 2: User views invoice history
1. Click "Invoices" tab
2. See list of all past invoices:
   - Nov 1, 2024 - $10.00 - Paid - Download PDF
   - Oct 1, 2024 - $10.00 - Paid - Download PDF
   - Sep 1, 2024 - $10.00 - Paid - Download PDF
3. Click PDF to download from Stripe

### Scenario 3: User checks credit usage
1. Click "Usage & Transactions" tab
2. See:
   - Graph of credit balance over time
   - Transaction list showing all credits in/out
   - Filter by type (allocations vs usage)

---

## Next Steps
1. Start with Phase 1 (Information Display) - highest user value
2. Then Phase 2 (Pending Changes) - prevents confusion
3. Finally Phase 3 (Audit) - for compliance and debugging
