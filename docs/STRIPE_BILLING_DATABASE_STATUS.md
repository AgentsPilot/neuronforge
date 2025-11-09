# Stripe Billing & Database Status - Current State Analysis

**Date**: 2025-01-05
**Purpose**: Document existing database tables and identify what needs to be created for Stripe integration

---

## ✅ EXISTING TABLES (Already Created)

### 1. `plans`
**Status**: ✅ EXISTS
**File**: Created via `/supabase/migrations/20250127_update_pricing_plans.sql`
**Schema**:
```sql
- id: UUID PRIMARY KEY
- plan_key: VARCHAR UNIQUE ('explorer', 'navigator', 'commander')
- plan_name: VARCHAR
- price_usd: DECIMAL
- price_annual_usd: DECIMAL
- monthly_credits: INTEGER
- max_agents: INTEGER
- max_executions_per_day: INTEGER
- features: JSONB
- is_active: BOOLEAN
```

**Current Data**:
- Explorer: $12/month, 25,000 credits, 3 agents
- Navigator: $20/month, 120,000 credits, 10 agents
- Commander: $35/month, 250,000 credits, 20 agents

---

### 2. `boost_packs`
**Status**: ✅ EXISTS
**File**: Created via `/supabase/migrations/20250127_update_pricing_plans.sql`
**Schema**:
```sql
- id: UUID PRIMARY KEY
- pack_key: VARCHAR UNIQUE
- pack_name: VARCHAR
- credits_amount: INTEGER
- bonus_credits: INTEGER
- price_usd: DECIMAL
- badge_text: VARCHAR (nullable)
- is_active: BOOLEAN
```

**Current Data**:
- 25K Boost: $8.00, 25,000 credits, 0 bonus
- 100K Boost: $20.00, 100,000 credits, 5,000 bonus (BEST VALUE)
- 250K Boost: $40.00, 250,000 credits, 15,000 bonus (MOST POPULAR)

---

### 3. `user_subscriptions`
**Status**: ✅ EXISTS (in use by CreditService.ts)
**File**: Part of core schema
**Schema** (confirmed by code usage):
```sql
- id: UUID PRIMARY KEY
- user_id: UUID REFERENCES auth.users (UNIQUE)
- balance: INTEGER (current credit balance)
- total_earned: INTEGER
- total_spent: INTEGER
- trial_credits_granted: INTEGER
- free_trial_used: BOOLEAN
- monthly_amount_usd: DECIMAL
- monthly_credits: INTEGER
- subscription_type: VARCHAR ('dynamic' | 'fixed')
- status: VARCHAR ('trial' | 'active' | 'past_due' | 'canceled' | 'paused')
- agents_paused: BOOLEAN
- stripe_customer_id: VARCHAR (nullable) ⚠️ EXISTS but unused
- stripe_subscription_id: VARCHAR (nullable) ⚠️ EXISTS but unused
- stripe_price_id: VARCHAR (nullable) ⚠️ EXISTS but unused
- created_at: TIMESTAMPTZ
- updated_at: TIMESTAMPTZ
```

**Missing Fields for Stripe**:
- ❌ current_period_start: TIMESTAMPTZ
- ❌ current_period_end: TIMESTAMPTZ
- ❌ cancel_at_period_end: BOOLEAN
- ❌ canceled_at: TIMESTAMPTZ
- ❌ trial_ends_at: TIMESTAMPTZ
- ❌ grace_period_days: INTEGER
- ❌ payment_retry_count: INTEGER
- ❌ last_payment_attempt: TIMESTAMPTZ

---

### 4. `credit_transactions`
**Status**: ✅ EXISTS (in use by CreditService.ts)
**File**: Part of core schema
**Schema** (confirmed by code usage):
```sql
- id: UUID PRIMARY KEY
- user_id: UUID REFERENCES auth.users
- credits_delta: INTEGER (positive or negative)
- balance_before: INTEGER
- balance_after: INTEGER
- transaction_type: VARCHAR ('trial' | 'charge' | 'reward' | 'allocation' | 'refund')
- activity_type: VARCHAR ('agent_creation' | 'agent_execution' | 'reward_credit')
- description: TEXT
- metadata: JSONB
- agent_id: UUID (nullable)
- created_at: TIMESTAMPTZ
```

**Already Tracking**:
- Trial credits
- Agent creation charges
- Agent execution charges
- Reward credits

---

### 5. `billing_events`
**Status**: ✅ EXISTS (in use by CreditService.ts)
**File**: Part of core schema
**Schema** (confirmed by code usage):
```sql
- id: UUID PRIMARY KEY
- user_id: UUID REFERENCES auth.users
- event_type: VARCHAR
- credits_delta: INTEGER
- description: TEXT
- created_at: TIMESTAMPTZ
```

**Current Events Logged**:
- `trial_granted` - When user signs up
- `low_balance_alert` - When balance < 25%

**Missing Events for Stripe**:
- ❌ subscription_created
- ❌ subscription_updated
- ❌ subscription_canceled
- ❌ renewal_success
- ❌ renewal_failed
- ❌ payment_succeeded
- ❌ payment_failed
- ❌ boost_pack_purchased
- ❌ plan_changed

---

## ❌ MISSING TABLES (Need to Create)

### 6. `subscription_invoices`
**Status**: ❌ DOES NOT EXIST
**Purpose**: Store Stripe invoice data for user billing history
**Priority**: HIGH - Required for invoice display in Settings

**Schema Needed**:
```sql
CREATE TABLE subscription_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  subscription_id UUID REFERENCES user_subscriptions(id),

  -- Stripe references
  stripe_invoice_id VARCHAR UNIQUE NOT NULL,
  stripe_invoice_pdf VARCHAR,
  stripe_hosted_invoice_url VARCHAR,
  stripe_payment_intent_id VARCHAR,

  -- Invoice details
  invoice_number VARCHAR NOT NULL,
  amount_due_cents INTEGER NOT NULL,
  amount_paid_cents INTEGER NOT NULL,
  tax_cents INTEGER DEFAULT 0,
  currency VARCHAR(3) DEFAULT 'usd',
  status VARCHAR NOT NULL, -- 'draft' | 'open' | 'paid' | 'void'

  -- Billing details (for PDF generation)
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

CREATE INDEX idx_invoices_user_id ON subscription_invoices(user_id);
CREATE INDEX idx_invoices_stripe_id ON subscription_invoices(stripe_invoice_id);
CREATE INDEX idx_invoices_status ON subscription_invoices(status);

-- RLS Policy
ALTER TABLE subscription_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own invoices"
ON subscription_invoices FOR SELECT
USING (auth.uid() = user_id);
```

---

### 7. `boost_pack_purchases` (Optional but Recommended)
**Status**: ❌ DOES NOT EXIST
**Purpose**: Track one-time boost pack purchases separately from subscriptions
**Priority**: MEDIUM - Can track in billing_events initially

**Schema Needed**:
```sql
CREATE TABLE boost_pack_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  boost_pack_id UUID REFERENCES boost_packs(id) NOT NULL,

  -- Purchase details
  credits_purchased INTEGER NOT NULL,
  bonus_credits INTEGER DEFAULT 0,
  amount_paid_cents INTEGER NOT NULL,
  currency VARCHAR(3) DEFAULT 'usd',

  -- Stripe references
  stripe_payment_intent_id VARCHAR,
  stripe_charge_id VARCHAR,

  -- Fulfillment
  credits_applied BOOLEAN DEFAULT false,
  applied_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_boost_purchases_user_id ON boost_pack_purchases(user_id);
CREATE INDEX idx_boost_purchases_stripe_payment ON boost_pack_purchases(stripe_payment_intent_id);

-- RLS Policy
ALTER TABLE boost_pack_purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own boost purchases"
ON boost_pack_purchases FOR SELECT
USING (auth.uid() = user_id);
```

---

## 🔧 REQUIRED DATABASE MIGRATIONS

### Migration 1: Extend `user_subscriptions`
**File**: `/supabase/migrations/20250105_extend_user_subscriptions_for_stripe.sql`

```sql
-- Add missing Stripe-related fields to user_subscriptions
ALTER TABLE user_subscriptions
ADD COLUMN IF NOT EXISTS current_period_start TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS canceled_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS grace_period_days INTEGER DEFAULT 3,
ADD COLUMN IF NOT EXISTS payment_retry_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_payment_attempt TIMESTAMPTZ;

-- Add index for period end (for renewal cron jobs)
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_period_end
ON user_subscriptions(current_period_end);

COMMENT ON COLUMN user_subscriptions.grace_period_days IS 'Number of days to wait before pausing agents after failed payment (admin configurable)';
```

---

### Migration 2: Create `subscription_invoices`
**File**: `/supabase/migrations/20250105_create_subscription_invoices.sql`

```sql
-- Create subscription_invoices table
CREATE TABLE IF NOT EXISTS subscription_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  subscription_id UUID REFERENCES user_subscriptions(id),

  -- Stripe references
  stripe_invoice_id VARCHAR UNIQUE NOT NULL,
  stripe_invoice_pdf VARCHAR,
  stripe_hosted_invoice_url VARCHAR,
  stripe_payment_intent_id VARCHAR,

  -- Invoice details
  invoice_number VARCHAR NOT NULL,
  amount_due_cents INTEGER NOT NULL,
  amount_paid_cents INTEGER NOT NULL,
  tax_cents INTEGER DEFAULT 0,
  currency VARCHAR(3) DEFAULT 'usd',
  status VARCHAR NOT NULL CHECK (status IN ('draft', 'open', 'paid', 'void', 'uncollectible')),

  -- Billing details
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

-- Indexes
CREATE INDEX idx_invoices_user_id ON subscription_invoices(user_id);
CREATE INDEX idx_invoices_stripe_id ON subscription_invoices(stripe_invoice_id);
CREATE INDEX idx_invoices_status ON subscription_invoices(status);
CREATE INDEX idx_invoices_created_at ON subscription_invoices(created_at DESC);

-- RLS Policy
ALTER TABLE subscription_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own invoices"
ON subscription_invoices FOR SELECT
USING (auth.uid() = user_id);

COMMENT ON TABLE subscription_invoices IS 'Stripe invoice records for subscription billing and credit purchases';
```

---

### Migration 3: Extend `billing_events`
**File**: `/supabase/migrations/20250105_extend_billing_events_for_stripe.sql`

```sql
-- Add Stripe-specific fields to billing_events
ALTER TABLE billing_events
ADD COLUMN IF NOT EXISTS stripe_event_id VARCHAR,
ADD COLUMN IF NOT EXISTS stripe_invoice_id VARCHAR,
ADD COLUMN IF NOT EXISTS amount_cents INTEGER,
ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'usd';

-- Add indexes for Stripe lookups
CREATE INDEX IF NOT EXISTS idx_billing_events_stripe_event
ON billing_events(stripe_event_id);

CREATE INDEX IF NOT EXISTS idx_billing_events_stripe_invoice
ON billing_events(stripe_invoice_id);

COMMENT ON COLUMN billing_events.stripe_event_id IS 'Stripe webhook event ID for idempotency';
```

---

### Migration 4: Create `boost_pack_purchases` (Optional)
**File**: `/supabase/migrations/20250105_create_boost_pack_purchases.sql`

```sql
-- Create boost_pack_purchases table
CREATE TABLE IF NOT EXISTS boost_pack_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  boost_pack_id UUID REFERENCES boost_packs(id) NOT NULL,

  -- Purchase details
  credits_purchased INTEGER NOT NULL,
  bonus_credits INTEGER DEFAULT 0,
  amount_paid_cents INTEGER NOT NULL,
  currency VARCHAR(3) DEFAULT 'usd',

  -- Stripe references
  stripe_payment_intent_id VARCHAR,
  stripe_charge_id VARCHAR,

  -- Fulfillment
  credits_applied BOOLEAN DEFAULT false,
  applied_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_boost_purchases_user_id ON boost_pack_purchases(user_id);
CREATE INDEX idx_boost_purchases_boost_pack_id ON boost_pack_purchases(boost_pack_id);
CREATE INDEX idx_boost_purchases_stripe_payment ON boost_pack_purchases(stripe_payment_intent_id);
CREATE INDEX idx_boost_purchases_applied ON boost_pack_purchases(credits_applied);

-- RLS Policy
ALTER TABLE boost_pack_purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own boost purchases"
ON boost_pack_purchases FOR SELECT
USING (auth.uid() = user_id);

COMMENT ON TABLE boost_pack_purchases IS 'One-time boost pack credit purchases via Stripe';
```

---

## 📊 DATABASE MIGRATION EXECUTION ORDER

1. **First**: Run `20250105_extend_user_subscriptions_for_stripe.sql`
2. **Second**: Run `20250105_create_subscription_invoices.sql`
3. **Third**: Run `20250105_extend_billing_events_for_stripe.sql`
4. **Fourth** (Optional): Run `20250105_create_boost_pack_purchases.sql`

---

## 🔍 VERIFICATION QUERIES

After running migrations, verify with these queries:

```sql
-- Check user_subscriptions has new columns
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'user_subscriptions'
ORDER BY ordinal_position;

-- Check subscription_invoices table exists
SELECT EXISTS (
  SELECT FROM information_schema.tables
  WHERE table_name = 'subscription_invoices'
);

-- Check billing_events has Stripe columns
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'billing_events'
AND column_name LIKE 'stripe%';

-- Check RLS policies are enabled
SELECT tablename, policyname
FROM pg_policies
WHERE tablename IN ('subscription_invoices', 'boost_pack_purchases');
```

---

## 📝 SUMMARY

### ✅ What We Have
- ✅ Plans table with 3 tiers
- ✅ Boost packs table with 3 options
- ✅ User subscriptions with Stripe placeholders
- ✅ Credit transactions ledger (working)
- ✅ Billing events audit trail (working)
- ✅ Credit consumption logic (CreditService.ts)

### ❌ What We Need to Add
- ❌ **4 database migrations** (see above)
- ❌ **Stripe API routes** (webhook, checkout, portal)
- ❌ **Stripe webhook handlers** (invoice.paid, subscription.updated, etc.)
- ❌ **Invoice UI components** (Settings > Billing tab)
- ❌ **Payment method management UI**
- ❌ **Stripe Customer creation on signup**

### 🎯 Next Steps
1. Create and run the 4 migration files
2. Set up Stripe account and get API keys
3. Create Stripe products/prices in dashboard
4. Implement API routes
5. Implement webhook handler
6. Update UI components to use Stripe
7. Test end-to-end with Stripe test mode

---

**Status**: Ready to begin implementation
**Estimated Time**: 2-3 days for complete integration
