# Complete Billing System Status & Stripe Integration Plan

**Date**: 2025-01-05
**Author**: System Analysis
**Purpose**: Comprehensive overview of existing billing infrastructure and Stripe integration requirements

---

## 📊 EXECUTIVE SUMMARY

### What Works Today ✅
- ✅ **Credit tracking system** - Fully functional
- ✅ **Credit consumption** - Working with intensity multiplier
- ✅ **Reward system** - Users earn credits by sharing agents
- ✅ **Trial credits** - 1,000 credits on signup
- ✅ **Transaction ledger** - Complete audit trail
- ✅ **Low balance alerts** - Automatic notifications
- ✅ **Agent pausing** - Automatic when balance = 0

### What's Missing ❌
- ❌ **Payment processing** - No Stripe integration (was removed)
- ❌ **Subscription billing** - No recurring charges
- ❌ **Invoice generation** - No PDF invoices
- ❌ **Boost pack purchases** - No one-time payments
- ❌ **Payment method management** - No card storage
- ❌ **Failed payment handling** - No dunning workflow

---

## 🗄️ DATABASE STATUS

### ✅ EXISTING TABLES (Production Ready)

#### 1. `plans` Table
**Status**: ✅ FULLY FUNCTIONAL
**Created**: `/supabase/migrations/20250127_update_pricing_plans.sql`

**Current Plans**:
```
┌───────────┬──────────┬──────────────┬───────────┐
│ Plan      │ Monthly  │ Credits/Mo   │ Max Agents│
├───────────┼──────────┼──────────────┼───────────┤
│ Explorer  │ $12.00   │ 25,000       │ 3         │
│ Navigator │ $20.00   │ 120,000      │ 10        │
│ Commander │ $35.00   │ 250,000      │ 20        │
└───────────┴──────────┴──────────────┴───────────┘
```

**Schema**:
```sql
- id: UUID PRIMARY KEY
- plan_key: VARCHAR ('explorer' | 'navigator' | 'commander')
- plan_name: VARCHAR
- price_usd: DECIMAL
- price_annual_usd: DECIMAL (10x monthly)
- monthly_credits: INTEGER
- max_agents: INTEGER
- max_executions_per_day: INTEGER
- features: JSONB array
- is_active: BOOLEAN
```

---

#### 2. `boost_packs` Table
**Status**: ✅ FULLY FUNCTIONAL
**Created**: `/supabase/migrations/20250127_update_pricing_plans.sql`

**Current Packs**:
```
┌──────────┬────────┬──────────┬──────────────┬───────────────┐
│ Pack     │ Price  │ Credits  │ Bonus        │ Badge         │
├──────────┼────────┼──────────┼──────────────┼───────────────┤
│ 25K      │ $8.00  │ 25,000   │ 0            │ -             │
│ 100K     │ $20.00 │ 100,000  │ +5,000       │ BEST VALUE    │
│ 250K     │ $40.00 │ 250,000  │ +15,000      │ MOST POPULAR  │
└──────────┴────────┴──────────┴──────────────┴───────────────┘
```

---

#### 3. `user_subscriptions` Table
**Status**: ✅ EXISTS - Needs Stripe Fields
**File**: `/lib/services/CreditService.ts` (active usage)

**Current Schema**:
```sql
CREATE TABLE user_subscriptions (
  id UUID PRIMARY KEY,
  user_id UUID UNIQUE REFERENCES auth.users,

  -- ✅ Credit tracking (WORKING)
  balance INTEGER,
  total_earned INTEGER,
  total_spent INTEGER,
  trial_credits_granted INTEGER DEFAULT 1000,
  free_trial_used BOOLEAN,

  -- ✅ Subscription info (WORKING)
  monthly_amount_usd DECIMAL,
  monthly_credits INTEGER,
  subscription_type VARCHAR ('dynamic' | 'fixed'),
  status VARCHAR ('trial' | 'active' | 'past_due' | 'canceled' | 'paused'),
  agents_paused BOOLEAN DEFAULT false,

  -- ✅ Stripe placeholders (EXIST but UNUSED)
  stripe_customer_id VARCHAR,
  stripe_subscription_id VARCHAR,
  stripe_price_id VARCHAR,

  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

**❌ Missing Stripe Fields** (need to add):
```sql
-- Billing periods
current_period_start TIMESTAMPTZ,
current_period_end TIMESTAMPTZ,

-- Cancellation tracking
cancel_at_period_end BOOLEAN DEFAULT false,
canceled_at TIMESTAMPTZ,
trial_ends_at TIMESTAMPTZ,

-- Failed payment handling
grace_period_days INTEGER DEFAULT 3,
payment_retry_count INTEGER DEFAULT 0,
last_payment_attempt TIMESTAMPTZ
```

---

#### 4. `credit_transactions` Table
**Status**: ✅ FULLY OPERATIONAL
**Usage**: Active ledger tracking every credit movement

**Schema**:
```sql
CREATE TABLE credit_transactions (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users,

  -- Transaction details
  credits_delta INTEGER, -- Positive = add, Negative = subtract
  balance_before INTEGER,
  balance_after INTEGER,

  -- Classification
  transaction_type VARCHAR, -- 'trial' | 'charge' | 'reward' | 'allocation' | 'refund'
  activity_type VARCHAR,     -- 'agent_creation' | 'agent_execution' | 'reward_credit'

  -- Context
  agent_id UUID,
  description TEXT,
  metadata JSONB,

  created_at TIMESTAMPTZ
);
```

**Current Transaction Types**:
- ✅ `trial` - Welcome bonus (1,000 credits)
- ✅ `charge` - Agent creation/execution costs
- ✅ `reward` - Earned credits (agent sharing, achievements)
- ⚠️ `allocation` - Not yet used (will be monthly renewal)
- ⚠️ `refund` - Not yet used (will be payment refunds)

---

#### 5. `billing_events` Table
**Status**: ✅ PARTIALLY FUNCTIONAL
**Usage**: Audit trail for financial events

**Current Schema**:
```sql
CREATE TABLE billing_events (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users,
  event_type VARCHAR,
  credits_delta INTEGER,
  description TEXT,
  created_at TIMESTAMPTZ
);
```

**Current Events Logged**:
- ✅ `trial_granted` - User signup
- ✅ `low_balance_alert` - Balance < 25%

**❌ Missing Fields** (need to add):
```sql
stripe_event_id VARCHAR,    -- Webhook idempotency
stripe_invoice_id VARCHAR,  -- Link to invoices
amount_cents INTEGER,       -- Payment amounts
currency VARCHAR(3),        -- Multi-currency support
```

---

#### 6. `reward_config` Table
**Status**: ✅ FULLY FUNCTIONAL
**Usage**: Admin-configurable reward definitions

**Schema**:
```sql
CREATE TABLE reward_config (
  id UUID PRIMARY KEY,
  reward_key VARCHAR UNIQUE ('agent_sharing' | 'first_agent' | etc.),
  reward_name VARCHAR,
  display_name VARCHAR,
  description TEXT,

  -- Reward amount
  credits_amount INTEGER,

  -- Eligibility rules
  max_per_user INTEGER,      -- Limit per user (NULL = unlimited)
  cooldown_hours INTEGER,     -- Hours between redemptions
  valid_from TIMESTAMPTZ,     -- Reward active period
  valid_until TIMESTAMPTZ,

  -- Status
  is_active BOOLEAN,

  created_at TIMESTAMPTZ
);
```

**Example Rewards**:
```sql
-- Agent Sharing Reward
{
  reward_key: 'agent_sharing',
  credits_amount: 100,  -- Configurable by admin
  max_per_user: NULL,   -- Can share unlimited agents
  cooldown_hours: 0     -- No cooldown
}
```

---

#### 7. `user_rewards` Table
**Status**: ✅ FULLY FUNCTIONAL
**Usage**: Tracks user reward redemptions

**Schema**:
```sql
CREATE TABLE user_rewards (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users,
  reward_config_id UUID REFERENCES reward_config,

  -- Tracking
  redemption_count INTEGER DEFAULT 0,
  total_credits_earned INTEGER DEFAULT 0,
  last_redeemed_at TIMESTAMPTZ,

  -- Entity tracking (for agent sharing)
  related_entity_id UUID,
  related_entity_type VARCHAR,
  transaction_id UUID REFERENCES credit_transactions,

  metadata JSONB,

  UNIQUE(user_id, reward_config_id, related_entity_id)
);
```

**Purpose**: Prevents duplicate rewards for same agent sharing

---

### ❌ MISSING TABLES (Need to Create)

#### 8. `subscription_invoices` Table
**Status**: ❌ DOES NOT EXIST
**Priority**: **HIGH** - Required for billing history UI

**Purpose**: Store Stripe invoice records for user access

**Schema Needed**:
```sql
CREATE TABLE subscription_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  subscription_id UUID REFERENCES user_subscriptions(id),

  -- Stripe references
  stripe_invoice_id VARCHAR UNIQUE NOT NULL,
  stripe_invoice_pdf VARCHAR,          -- PDF download URL
  stripe_hosted_invoice_url VARCHAR,   -- Stripe-hosted page
  stripe_payment_intent_id VARCHAR,

  -- Invoice details
  invoice_number VARCHAR NOT NULL,
  amount_due_cents INTEGER NOT NULL,
  amount_paid_cents INTEGER NOT NULL,
  tax_cents INTEGER DEFAULT 0,
  currency VARCHAR(3) DEFAULT 'usd',
  status VARCHAR NOT NULL, -- 'paid' | 'open' | 'void'

  -- Billing information (for PDF)
  billing_name VARCHAR,
  billing_email VARCHAR,
  billing_address JSONB,
  tax_id VARCHAR,

  -- Dates
  invoice_date TIMESTAMPTZ NOT NULL,
  due_date TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,

  -- Metadata
  line_items JSONB DEFAULT '[]',
  metadata JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Use Cases**:
- Display invoice history in Settings > Billing
- Download PDF invoices
- Tax compliance
- Accounting integration

---

## 🎁 REWARD SYSTEM (Fully Implemented)

### How It Works

**File**: `/lib/credits/rewardService.ts`

**Flow**:
```
User shares agent
  ↓
System calls: rewardService.awardAgentSharingReward(userId, agentId)
  ↓
Check eligibility (cooldown, max redemptions, etc.)
  ↓
If eligible:
  ├─ Add credits to user_subscriptions.balance
  ├─ Create credit_transaction (type: 'reward')
  ├─ Update user_rewards tracking
  └─ Return success message
```

**Example: Agent Sharing**:
```typescript
const result = await rewardService.awardAgentSharingReward(
  userId,
  agentId,
  agentName
);

// Result:
{
  success: true,
  creditsAwarded: 100,
  transactionId: "uuid",
  message: "100 credits awarded for Agent Sharing"
}
```

**Anti-Fraud Protection**:
- ✅ **Duplicate prevention**: Can't earn twice for same agent
- ✅ **Cooldown periods**: Admin-configurable delays
- ✅ **Max redemptions**: Limit rewards per user
- ✅ **Date ranges**: Time-limited campaigns
- ✅ **Audit trail**: Complete transaction history

**Admin Control**:
- Configure reward amounts via `reward_config` table
- Set eligibility rules (cooldowns, limits)
- Enable/disable rewards
- Track redemption analytics

---

## 💰 CREDIT PRICING & ECONOMICS

### Credit Calculation Formula
```
Base Formula: 1 Pilot Credit = 10 LLM Tokens

With Intensity Multiplier:
Final Credits = ceil((tokens / 10) × intensityMultiplier)
```

### Intensity Multipliers (Admin Configurable)
```typescript
Agent Creation:      tokens/10 × 1.5  // Complex workflow
Agent Execution:     tokens/10 × 1.2  // Plugin orchestration
Agent Enhancement:   tokens/10 × 1.4  // Analysis + generation
Chat Message:        tokens/10 × 1.0  // Standard conversation
File Analysis:       tokens/10 × 1.3  // Document processing
```

### Economics Example
```
Agent Execution:
├─ Tokens used: 8,000
├─ Base credits: 800
├─ Intensity: 1.2x
├─ Final charge: 960 credits
│
├─ User cost: 960 × $0.00048 = $0.461
├─ Actual LLM cost: ~$0.052 (GPT-4o)
└─ Margin: $0.409 (88% gross margin)
```

---

## 🚀 STRIPE INTEGRATION REQUIREMENTS

### Phase 1: Database Migrations (CRITICAL)

**Files to Create**:
1. `/supabase/migrations/20250105_extend_user_subscriptions_for_stripe.sql`
2. `/supabase/migrations/20250105_create_subscription_invoices.sql`
3. `/supabase/migrations/20250105_extend_billing_events_for_stripe.sql`

**Execution Order**:
```bash
# 1. Extend user_subscriptions
ALTER TABLE user_subscriptions ADD COLUMN current_period_start TIMESTAMPTZ;
ALTER TABLE user_subscriptions ADD COLUMN current_period_end TIMESTAMPTZ;
# ... (see detailed migration file)

# 2. Create subscription_invoices
CREATE TABLE subscription_invoices (...);

# 3. Extend billing_events
ALTER TABLE billing_events ADD COLUMN stripe_event_id VARCHAR;
ALTER TABLE billing_events ADD COLUMN stripe_invoice_id VARCHAR;
```

---

### Phase 2: Stripe Setup (Account Configuration)

**Steps**:
1. Create Stripe account (or use existing)
2. Get API keys (test + production)
3. Create products in Stripe dashboard:
   - Explorer Plan ($12/month)
   - Navigator Plan ($20/month)
   - Commander Plan ($35/month)
4. Create prices for each product (monthly + annual)
5. Create one-time prices for boost packs
6. Configure webhook endpoint
7. Enable automatic tax calculation (Stripe Tax)

**Environment Variables**:
```bash
STRIPE_SECRET_KEY=sk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Product/Price IDs (from Stripe dashboard)
STRIPE_PRICE_EXPLORER_MONTHLY=price_...
STRIPE_PRICE_NAVIGATOR_MONTHLY=price_...
STRIPE_PRICE_COMMANDER_MONTHLY=price_...
STRIPE_PRICE_BOOST_25K=price_...
STRIPE_PRICE_BOOST_100K=price_...
STRIPE_PRICE_BOOST_250K=price_...
```

---

### Phase 3: API Routes (Backend Implementation)

**Files to Create**:

1. `/lib/stripe/stripe.ts` - Stripe instance
```typescript
import Stripe from 'stripe';
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia'
});
```

2. `/app/api/stripe/create-checkout-session/route.ts`
   - Purpose: Create subscription checkout
   - Input: Plan key, billing period
   - Output: Checkout session URL

3. `/app/api/stripe/create-boost-checkout/route.ts`
   - Purpose: Create one-time payment checkout
   - Input: Boost pack key
   - Output: Checkout session URL

4. `/app/api/stripe/create-portal-session/route.ts`
   - Purpose: Redirect to Stripe billing portal
   - Input: Return URL
   - Output: Portal session URL

5. `/app/api/stripe/webhook/route.ts` ⚠️ **CRITICAL**
   - Purpose: Handle Stripe events
   - Events to handle:
     - `checkout.session.completed` - Subscription created
     - `invoice.paid` - Allocate monthly credits
     - `invoice.payment_failed` - Start grace period
     - `customer.subscription.updated` - Plan change
     - `customer.subscription.deleted` - Cancellation
   - Must verify webhook signatures!

---

### Phase 4: UI Components (Frontend Integration)

**Files to Modify**:

1. `/components/settings/BillingSettings.tsx`
   - Replace stubbed checkout with real Stripe flow
   - Add payment method display
   - Add invoice history table

2. Create new components:
   - `/components/billing/StripeCheckout.tsx` - Checkout button
   - `/components/billing/PaymentMethodCard.tsx` - Card display
   - `/components/billing/InvoiceRow.tsx` - Invoice table row
   - `/components/billing/UpgradePlanModal.tsx` - Plan comparison

---

### Phase 5: Webhook Event Handlers

**Critical Events**:

#### `invoice.paid` (Most Important)
```typescript
async function handleInvoicePaid(invoice: Stripe.Invoice) {
  // 1. Get user from stripe_customer_id
  // 2. Get subscription credits from plan
  // 3. Add credits to balance (+ rollover from previous period)
  // 4. Create credit_transaction (type: 'allocation')
  // 5. Create billing_event (event_type: 'renewal_success')
  // 6. Insert subscription_invoices record
  // 7. Update user_subscriptions (current_period_start/end)
}
```

#### `invoice.payment_failed`
```typescript
async function handlePaymentFailed(invoice: Stripe.Invoice) {
  // 1. Increment payment_retry_count
  // 2. Update last_payment_attempt
  // 3. If retry_count >= grace_period_days:
  //    - Set agents_paused = true
  //    - Set status = 'past_due'
  // 4. Create billing_event (event_type: 'payment_failed')
  // 5. Send email notification (future)
}
```

#### `checkout.session.completed`
```typescript
async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  if (session.mode === 'subscription') {
    // Subscription purchase
    // 1. Update stripe_customer_id
    // 2. Update stripe_subscription_id
    // 3. Wait for invoice.paid webhook to allocate credits
  } else {
    // Boost pack purchase
    // 1. Get boost pack credits
    // 2. Add credits immediately
    // 3. Create credit_transaction (type: 'boost_pack')
    // 4. Insert boost_pack_purchases record
  }
}
```

---

## 📋 IMPLEMENTATION CHECKLIST

### Database Layer
- [ ] Create migration: `20250105_extend_user_subscriptions_for_stripe.sql`
- [ ] Create migration: `20250105_create_subscription_invoices.sql`
- [ ] Create migration: `20250105_extend_billing_events_for_stripe.sql`
- [ ] Run migrations in Supabase
- [ ] Verify RLS policies are correct

### Stripe Account Setup
- [ ] Create/configure Stripe account
- [ ] Create products for 3 plans
- [ ] Create prices (monthly + annual)
- [ ] Create boost pack prices
- [ ] Configure webhook endpoint
- [ ] Enable Stripe Tax
- [ ] Copy API keys to `.env.local`

### Backend Implementation
- [ ] Install `stripe` and `@stripe/stripe-js` packages
- [ ] Create `/lib/stripe/stripe.ts` - Server instance
- [ ] Create `/lib/stripe/client.ts` - Client loader
- [ ] Create `/app/api/stripe/create-checkout-session/route.ts`
- [ ] Create `/app/api/stripe/create-boost-checkout/route.ts`
- [ ] Create `/app/api/stripe/create-portal-session/route.ts`
- [ ] Create `/app/api/stripe/webhook/route.ts` with signature verification
- [ ] Implement all webhook event handlers
- [ ] Add error handling and logging

### Frontend Implementation
- [ ] Update `BillingSettings.tsx` - Replace stubbed functions
- [ ] Create `StripeCheckout.tsx` component
- [ ] Create `PaymentMethodCard.tsx` component
- [ ] Create `InvoiceRow.tsx` component
- [ ] Add invoice PDF download links
- [ ] Add "Manage Payment Methods" button (Stripe Portal)
- [ ] Add loading states for all async operations

### Testing
- [ ] Test subscription purchase with Stripe test cards
- [ ] Test boost pack purchase
- [ ] Test plan upgrade/downgrade
- [ ] Test subscription cancellation
- [ ] Test failed payment handling
- [ ] Test webhook idempotency
- [ ] Test credit allocation on renewal
- [ ] Test invoice generation
- [ ] Test tax calculation
- [ ] Test multi-currency (if enabled)

### Production Deployment
- [ ] Switch to Stripe live keys
- [ ] Update webhook URL to production
- [ ] Monitor first real transactions
- [ ] Verify credit allocations
- [ ] Check invoice generation
- [ ] Monitor error logs

---

## 🎯 RECOMMENDED IMPLEMENTATION ORDER

### Week 1: Database & Stripe Setup
**Days 1-2**: Database migrations
**Days 3-4**: Stripe account configuration
**Day 5**: Create products/prices in Stripe

### Week 2: Backend Implementation
**Days 1-2**: API routes (checkout, portal)
**Days 3-5**: Webhook handler + event processing

### Week 3: Frontend Integration
**Days 1-2**: Update BillingSettings component
**Days 3-4**: Create new billing UI components
**Day 5**: Testing with Stripe test mode

### Week 4: Testing & Launch
**Days 1-3**: Comprehensive testing
**Day 4**: Production deployment
**Day 5**: Monitoring & bug fixes

---

## 💡 KEY INSIGHTS

### What's Already Great
1. **Credit system is bulletproof** - Transaction ledger + audit trail
2. **Reward system works** - Agent sharing incentives in place
3. **UI is ready** - Just needs Stripe wiring
4. **Database schema is 90% done** - Only minor additions needed

### Main Challenges
1. **Webhook reliability** - Must handle retries correctly
2. **Credit rollover logic** - Preserve unused credits
3. **Failed payment grace period** - User-friendly dunning
4. **Tax compliance** - Use Stripe Tax for automation

### Business Considerations
- **Credit rollover** - Major selling point vs competitors
- **Reward system** - Viral growth mechanism (agent sharing)
- **Flexible grace period** - Admin-configurable for customer service
- **Multi-currency** - Ready for international expansion

---

**Status**: Ready for Phase 1 Implementation
**Estimated Time**: 3-4 weeks to production
**Risk Level**: Low (solid foundation exists)
