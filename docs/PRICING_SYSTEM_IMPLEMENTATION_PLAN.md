# 🚀 AGENTPILOT PRICING SYSTEM - COMPLETE IMPLEMENTATION PLAN

**Version:** 1.0
**Date:** 2025-01-27
**Status:** Ready for Implementation

---

## 🎯 OBJECTIVE

Implement a **smart, embedded Pilot Credits pricing system** that integrates seamlessly with the existing AgentPilot codebase, including full plan management in Settings with upgrade/downgrade, invoices, and Stripe billing.

---

## 📦 WHAT WE'RE BUILDING

### **1. Database Schema** (5 new tables + 1 junction table)
- `plans` - Pricing tiers (Explorer, Navigator, Commander)
- `user_subscriptions` - Active subscriptions with Pilot Credits balance
- `credit_transactions` - Complete ledger linking to existing `token_usage`
- `boost_packs` - One-time credit purchases
- `billing_events` - Audit trail for all financial events
- `subscription_invoices` - Stripe invoice records

**Integration**: Links to your existing `token_usage` table for margin analysis

### **2. Credit Engine** (`lib/credits/`)
- `pilotCreditsEngine.ts` - Core credit calculation & deduction
  - `calculatePilotCredits()` - Dynamic: 1 credit = ~10 tokens
  - `reservePilotCredits()` - Pre-check before LLM call
  - `finalizePilotCredits()` - Post-charge with refunds
  - `resetAndCarryOver()` - Monthly renewal
  - `applyBoostPack()` - Instant top-up

**Integration**: Hooks into existing `usageTracker.ts`

### **3. Enhanced Settings Page** (Upgrade existing component)
- **Plan Tab Enhancements**:
  - Real-time Pilot Credits balance with fuel gauge
  - Plan upgrade/downgrade modals with preview
  - Invoice history table with PDF downloads
  - Payment method management (Stripe Elements)
  - Usage graphs (credits burned vs allocated)
  - Boost Pack purchase flow

### **4. Stripe Integration** (`app/api/stripe/`)
- `/api/stripe/checkout` - Create subscription checkout
- `/api/stripe/portal` - Billing portal redirect
- `/api/stripe/webhooks` - Handle events
- `/api/stripe/boost-pack` - One-time payment

### **5. API Route Modifications**
- Modify `/api/generate-agent/route.ts` - Add credit reservation
- Modify `/api/run-agent/route.ts` - Add credit checks
- Modify `lib/utils/usageTracker.ts` - Trigger credit finalization

### **6. UI Components** (`components/billing/`)
- `FuelTankWidget.tsx` - Dashboard credit balance
- `LowFuelModal.tsx` - Warning when <20% credits
- `UpgradePlanModal.tsx` - Plan comparison & upgrade
- `BoostPackCard.tsx` - Credit top-up options
- `InvoiceTable.tsx` - Billing history
- `PaymentMethodCard.tsx` - Manage cards

---

## 🏗️ ARCHITECTURE DECISIONS

### **Smart Design Principles**

#### 1. **Dual-Table Separation**
```
┌─────────────────────────────────────┐
│ token_usage (Analytics)             │
│ - Tracks actual OpenAI costs in USD │
│ - Used for margin analysis          │
│ - Shows YOU what it costs           │
└─────────────────────────────────────┘
              ↓ (links via token_usage_id)
┌─────────────────────────────────────┐
│ credit_transactions (Billing)       │
│ - Tracks Pilot Credits charged      │
│ - Used for user billing             │
│ - Shows USERS what they pay         │
└─────────────────────────────────────┘
```

**Why this is smart:**
- ✅ Clean separation of concerns (cost vs. billing)
- ✅ Analytics dashboard stays intact (no breaking changes)
- ✅ Easy margin calculation: `credit_value - actual_cost`
- ✅ Audit trail: every credit charge links to actual usage
- ✅ Flexibility: change credit pricing without touching analytics

#### 2. **Dynamic Credit Calculation**

```typescript
Pilot Credits = (tokens / 10) × activity_multiplier

Multipliers:
├── agent_creation: 1.5x      (complex, multi-step LLM workflow)
├── agent_execution: 1.2x     (plugin orchestration overhead)
├── agent_enhancement: 1.4x   (analysis + generation)
├── plugin_call_simple: 0.8x  (minimal LLM processing)
├── plugin_call_complex: 1.3x (heavy parsing/transformation)
├── chat_message: 1.0x        (standard conversation)
├── file_analysis: 1.3x       (document processing)
└── prompt_analysis: 1.1x     (quality checks)
```

**Example Calculation:**
```
Agent Creation:
├── Tokens used: 5,000 input + 3,000 output = 8,000 total
├── Base: 8,000 / 10 = 800 credits
├── Multiplier: 1.5x (agent_creation complexity)
└── Final: 800 × 1.5 = 1,200 Pilot Credits ✅

Actual cost: $0.052 (GPT-4o)
Revenue: 1,200 × $0.00048 = $0.576
Margin: $0.576 - $0.052 = $0.524 (91% gross margin!)
```

#### 3. **Reserve-Execute-Finalize Flow**

```
┌─────────────────────────────────────────────────────────────┐
│ PHASE 1: RESERVE (Pre-flight check)                        │
├─────────────────────────────────────────────────────────────┤
│ User triggers action                                        │
│   ↓                                                         │
│ Estimate credits needed (e.g., 1,200 for agent creation)   │
│   ↓                                                         │
│ Check: user balance >= estimated?                          │
│   ├─ NO → Block operation, show "Low Fuel" modal           │
│   └─ YES → Create "reserved" transaction (status: pending) │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ PHASE 2: EXECUTE (Flight in progress)                      │
├─────────────────────────────────────────────────────────────┤
│ Make LLM API call (GPT-4o)                                  │
│   ↓                                                         │
│ Track tokens via existing usageTracker.ts                  │
│   ↓                                                         │
│ Insert into token_usage (actual cost in USD)               │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ PHASE 3: FINALIZE (Post-flight reconciliation)             │
├─────────────────────────────────────────────────────────────┤
│ Calculate actual credits: (tokens / 10) × multiplier       │
│   ↓                                                         │
│ Update "reserved" → "completed" transaction                │
│   ↓                                                         │
│ If actual < reserved → refund difference                   │
│ If actual > reserved → charge difference (if balance OK)   │
│   ↓                                                         │
│ Update user_subscriptions.pilot_credits_balance            │
└─────────────────────────────────────────────────────────────┘
```

**Benefits:**
- ✅ Prevents "insufficient credits" errors mid-operation
- ✅ Charges only for actual usage
- ✅ Refunds over-reservation automatically
- ✅ User-friendly: transparent pricing

#### 4. **Settings Tab Integration Strategy**

```
Existing Settings Page Structure:
┌─────────────────────────────────────┐
│ Settings                            │
├─────────────────────────────────────┤
│ Tabs:                               │
│ ├─ Profile ✅ (keep as-is)          │
│ ├─ Plugins ✅ (keep as-is)          │
│ ├─ Notifications ✅ (keep as-is)    │
│ ├─ Security ✅ (keep as-is)         │
│ └─ Plan 🔧 (MAJOR UPGRADE)          │
└─────────────────────────────────────┘
```

**What we'll upgrade in Plan tab:**
1. Replace placeholder data with real Supabase queries
2. Add Fuel Tank widget (visual credit balance)
3. Add Stripe checkout integration
4. Add invoice history table
5. Add upgrade/downgrade modals
6. Add boost pack purchase cards

**Zero breaking changes** to other tabs!

---

## 🗄️ DATABASE SCHEMA

### **Complete SQL Migration**

```sql
-- =====================================================
-- MIGRATION: AgentPilot Pricing System
-- Description: Implements Pilot Credits billing
-- Version: 1.0
-- =====================================================

-- =====================================================
-- 1. PLANS TABLE
-- =====================================================
CREATE TABLE plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_code VARCHAR(50) UNIQUE NOT NULL, -- 'explorer', 'navigator', 'commander'
  plan_name VARCHAR(100) NOT NULL,

  -- Pricing
  monthly_price_cents INTEGER NOT NULL,
  annual_price_cents INTEGER NOT NULL,

  -- Pilot Credits allocation
  credits_per_month INTEGER NOT NULL,

  -- Resource limits
  max_agents INTEGER NOT NULL,
  max_plugins INTEGER NOT NULL, -- -1 = unlimited
  storage_gb INTEGER NOT NULL,

  -- Features
  carry_over_enabled BOOLEAN DEFAULT true,
  priority_support BOOLEAN DEFAULT false,
  advanced_analytics BOOLEAN DEFAULT false,

  -- Metadata
  is_active BOOLEAN DEFAULT true,
  features JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed plan data
INSERT INTO plans (plan_code, plan_name, monthly_price_cents, annual_price_cents, credits_per_month, max_agents, max_plugins, storage_gb, priority_support, advanced_analytics) VALUES
('explorer', 'Explorer', 1200, 12000, 25000, 3, 10, 5, false, false),
('navigator', 'Navigator', 2000, 20000, 120000, 10, 25, 30, false, true),
('commander', 'Commander', 3500, 35000, 250000, 20, -1, 80, true, true);

CREATE INDEX idx_plans_code ON plans(plan_code);
CREATE INDEX idx_plans_active ON plans(is_active);

-- =====================================================
-- 2. BOOST PACKS (One-time credit purchases)
-- =====================================================
CREATE TABLE boost_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_code VARCHAR(50) UNIQUE NOT NULL,
  pack_name VARCHAR(100) NOT NULL,
  credits INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed boost pack data
INSERT INTO boost_packs (pack_code, pack_name, credits, price_cents, display_order) VALUES
('boost_25k', '25K Boost Pack', 25000, 800, 1),
('boost_100k', '100K Boost Pack', 100000, 2000, 2),
('boost_250k', '250K Boost Pack', 250000, 4000, 3);

CREATE INDEX idx_boost_packs_active ON boost_packs(is_active);

-- =====================================================
-- 3. USER SUBSCRIPTIONS
-- =====================================================
CREATE TABLE user_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES plans(id),

  -- Billing cycle
  billing_cycle VARCHAR(20) NOT NULL CHECK (billing_cycle IN ('monthly', 'annual')),

  -- Pilot Credits tracking
  pilot_credits_balance INTEGER DEFAULT 0,
  pilot_credits_allocated_this_cycle INTEGER DEFAULT 0,
  pilot_credits_used_this_cycle INTEGER DEFAULT 0,
  pilot_credits_carried_over INTEGER DEFAULT 0,
  total_lifetime_credits INTEGER DEFAULT 0,

  -- Stripe integration
  stripe_customer_id VARCHAR(255),
  stripe_subscription_id VARCHAR(255),
  stripe_price_id VARCHAR(255),

  -- Billing periods
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,

  -- Status
  status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'past_due', 'canceled', 'paused', 'trialing')),
  cancel_at_period_end BOOLEAN DEFAULT false,
  canceled_at TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id) -- One subscription per user
);

CREATE INDEX idx_user_subscriptions_user ON user_subscriptions(user_id);
CREATE INDEX idx_user_subscriptions_stripe_customer ON user_subscriptions(stripe_customer_id);
CREATE INDEX idx_user_subscriptions_stripe_sub ON user_subscriptions(stripe_subscription_id);
CREATE INDEX idx_user_subscriptions_status ON user_subscriptions(status);
CREATE INDEX idx_user_subscriptions_period_end ON user_subscriptions(current_period_end);

-- =====================================================
-- 4. CREDIT TRANSACTIONS (The Ledger)
-- =====================================================
CREATE TABLE credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES user_subscriptions(id) ON DELETE SET NULL,

  -- Transaction type
  transaction_type VARCHAR(50) NOT NULL CHECK (transaction_type IN (
    'allocation',      -- Monthly credit allocation
    'reservation',     -- Pre-flight credit hold
    'deduction',       -- Actual charge (completed)
    'refund',          -- Over-reservation return
    'boost_pack',      -- Top-up purchase
    'carry_over',      -- Monthly rollover
    'adjustment'       -- Manual admin change
  )),

  -- Amount (positive for additions, negative for deductions)
  pilot_credits_amount INTEGER NOT NULL,

  -- Link to analytics (for margin analysis)
  token_usage_id UUID REFERENCES token_usage(id) ON DELETE SET NULL,

  -- Activity context
  activity_type VARCHAR(100), -- 'agent_creation', 'agent_execution', etc.
  activity_name VARCHAR(255),
  agent_id UUID,
  session_id UUID,

  -- Balance snapshot
  balance_before INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,

  -- Metadata
  metadata JSONB DEFAULT '{}',

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_credit_transactions_user ON credit_transactions(user_id, created_at DESC);
CREATE INDEX idx_credit_transactions_subscription ON credit_transactions(subscription_id);
CREATE INDEX idx_credit_transactions_type ON credit_transactions(transaction_type);
CREATE INDEX idx_credit_transactions_token_usage ON credit_transactions(token_usage_id);
CREATE INDEX idx_credit_transactions_agent ON credit_transactions(agent_id);
CREATE INDEX idx_credit_transactions_session ON credit_transactions(session_id);
CREATE INDEX idx_credit_transactions_activity_type ON credit_transactions(activity_type);

-- =====================================================
-- 5. BOOST PACK PURCHASES
-- =====================================================
CREATE TABLE boost_pack_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES user_subscriptions(id) ON DELETE SET NULL,
  boost_pack_id UUID NOT NULL REFERENCES boost_packs(id),

  -- Purchase details
  credits_purchased INTEGER NOT NULL,
  amount_paid_cents INTEGER NOT NULL,

  -- Stripe integration
  stripe_payment_intent_id VARCHAR(255),
  stripe_charge_id VARCHAR(255),

  -- Fulfillment
  credits_applied BOOLEAN DEFAULT false,
  applied_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_boost_purchases_user ON boost_pack_purchases(user_id, created_at DESC);
CREATE INDEX idx_boost_purchases_subscription ON boost_pack_purchases(subscription_id);
CREATE INDEX idx_boost_purchases_stripe_payment ON boost_pack_purchases(stripe_payment_intent_id);
CREATE INDEX idx_boost_purchases_applied ON boost_pack_purchases(credits_applied);

-- =====================================================
-- 6. BILLING EVENTS (Audit Trail)
-- =====================================================
CREATE TABLE billing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES user_subscriptions(id) ON DELETE SET NULL,

  -- Event type
  event_type VARCHAR(100) NOT NULL,
  -- Examples: 'subscription_created', 'subscription_updated', 'subscription_canceled',
  --           'renewal', 'carry_over', 'boost_purchased', 'plan_changed'

  -- Financial details
  pilot_credits_before INTEGER,
  pilot_credits_after INTEGER,
  pilot_credits_allocated INTEGER,
  pilot_credits_carried_over INTEGER,
  amount_paid_cents INTEGER,

  -- Stripe reference
  stripe_event_id VARCHAR(255),
  stripe_invoice_id VARCHAR(255),

  -- Metadata
  metadata JSONB DEFAULT '{}',

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_billing_events_user ON billing_events(user_id, created_at DESC);
CREATE INDEX idx_billing_events_subscription ON billing_events(subscription_id);
CREATE INDEX idx_billing_events_type ON billing_events(event_type);
CREATE INDEX idx_billing_events_stripe_event ON billing_events(stripe_event_id);
CREATE INDEX idx_billing_events_stripe_invoice ON billing_events(stripe_invoice_id);

-- =====================================================
-- 7. SUBSCRIPTION INVOICES
-- =====================================================
CREATE TABLE subscription_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES user_subscriptions(id) ON DELETE SET NULL,

  -- Invoice details
  invoice_number VARCHAR(100),
  amount_due_cents INTEGER NOT NULL,
  amount_paid_cents INTEGER NOT NULL,

  -- Status
  status VARCHAR(50) NOT NULL CHECK (status IN ('draft', 'open', 'paid', 'void', 'uncollectible')),

  -- Stripe integration
  stripe_invoice_id VARCHAR(255) UNIQUE,
  stripe_invoice_pdf VARCHAR(500),
  stripe_hosted_invoice_url VARCHAR(500),

  -- Dates
  invoice_date TIMESTAMPTZ,
  due_date TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,

  -- Period
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,

  -- Metadata
  metadata JSONB DEFAULT '{}',

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_invoices_user ON subscription_invoices(user_id, created_at DESC);
CREATE INDEX idx_invoices_subscription ON subscription_invoices(subscription_id);
CREATE INDEX idx_invoices_status ON subscription_invoices(status);
CREATE INDEX idx_invoices_stripe ON subscription_invoices(stripe_invoice_id);

-- =====================================================
-- 8. ROW LEVEL SECURITY POLICIES
-- =====================================================

-- Plans & Boost Packs are publicly readable
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE boost_packs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Plans are publicly readable" ON plans FOR SELECT USING (is_active = true);
CREATE POLICY "Boost packs are publicly readable" ON boost_packs FOR SELECT USING (is_active = true);

-- User subscriptions: users can only see their own
ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own subscription" ON user_subscriptions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own subscription" ON user_subscriptions FOR UPDATE USING (auth.uid() = user_id);

-- Credit transactions: users can only see their own
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own transactions" ON credit_transactions FOR SELECT USING (auth.uid() = user_id);

-- Boost pack purchases: users can only see their own
ALTER TABLE boost_pack_purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own purchases" ON boost_pack_purchases FOR SELECT USING (auth.uid() = user_id);

-- Billing events: users can only see their own
ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own billing events" ON billing_events FOR SELECT USING (auth.uid() = user_id);

-- Invoices: users can only see their own
ALTER TABLE subscription_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own invoices" ON subscription_invoices FOR SELECT USING (auth.uid() = user_id);

-- =====================================================
-- 9. HELPER FUNCTIONS
-- =====================================================

-- Get user's current Pilot Credits balance
CREATE OR REPLACE FUNCTION get_user_pilot_credits(p_user_id UUID)
RETURNS INTEGER AS $$
  SELECT COALESCE(pilot_credits_balance, 0)
  FROM user_subscriptions
  WHERE user_id = p_user_id AND status = 'active'
  LIMIT 1;
$$ LANGUAGE SQL STABLE;

-- Check if user has sufficient Pilot Credits
CREATE OR REPLACE FUNCTION has_sufficient_pilot_credits(p_user_id UUID, p_credits_needed INTEGER)
RETURNS BOOLEAN AS $$
  SELECT get_user_pilot_credits(p_user_id) >= p_credits_needed;
$$ LANGUAGE SQL STABLE;

-- Get user's current plan
CREATE OR REPLACE FUNCTION get_user_plan(p_user_id UUID)
RETURNS TABLE (
  plan_code VARCHAR,
  plan_name VARCHAR,
  credits_per_month INTEGER,
  max_agents INTEGER,
  max_plugins INTEGER
) AS $$
  SELECT
    p.plan_code,
    p.plan_name,
    p.credits_per_month,
    p.max_agents,
    p.max_plugins
  FROM user_subscriptions us
  JOIN plans p ON us.plan_id = p.id
  WHERE us.user_id = p_user_id AND us.status = 'active'
  LIMIT 1;
$$ LANGUAGE SQL STABLE;

-- =====================================================
-- 10. TRIGGERS
-- =====================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_plans_updated_at BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_subscriptions_updated_at BEFORE UPDATE ON user_subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- END MIGRATION
-- =====================================================
```

---

## 💻 CODE IMPLEMENTATION

### **Phase 1: Pilot Credits Engine**

**File:** `lib/credits/types.ts`

```typescript
// lib/credits/types.ts

export interface CreditReservation {
  allowed: boolean;
  reservationId?: string;
  currentBalance: number;
  estimatedCredits?: number;
}

export interface CreditFinalization {
  success: boolean;
  creditsCharged: number;
  refunded: number;
  newBalance: number;
}

export interface CreditTransaction {
  id: string;
  user_id: string;
  transaction_type: 'allocation' | 'reservation' | 'deduction' | 'refund' | 'boost_pack' | 'carry_over' | 'adjustment';
  pilot_credits_amount: number;
  balance_before: number;
  balance_after: number;
  activity_type?: string;
  activity_name?: string;
  metadata?: Record<string, any>;
  created_at: string;
}

export interface UserSubscription {
  id: string;
  user_id: string;
  plan_id: string;
  pilot_credits_balance: number;
  pilot_credits_allocated_this_cycle: number;
  pilot_credits_used_this_cycle: number;
  pilot_credits_carried_over: number;
  current_period_start: string;
  current_period_end: string;
  status: 'active' | 'past_due' | 'canceled' | 'paused' | 'trialing';
  billing_cycle: 'monthly' | 'annual';
}

export interface Plan {
  id: string;
  plan_code: string;
  plan_name: string;
  monthly_price_cents: number;
  annual_price_cents: number;
  credits_per_month: number;
  max_agents: number;
  max_plugins: number;
  storage_gb: number;
  carry_over_enabled: boolean;
  priority_support: boolean;
  advanced_analytics: boolean;
}
```

**File:** `lib/credits/constants.ts`

```typescript
// lib/credits/constants.ts

/**
 * Activity type multipliers for Pilot Credits calculation
 *
 * Base formula: credits = (tokens / 10) × multiplier
 *
 * Multipliers account for:
 * - LLM complexity (single vs multi-step)
 * - Plugin orchestration overhead
 * - Infrastructure costs (Upstash, Supabase)
 */
export const ACTIVITY_MULTIPLIERS: Record<string, number> = {
  // Agent operations (complex, multi-step)
  'agent_creation': 1.5,
  'agent_generation': 1.5, // Same as agent_creation
  'agent_execution': 1.2,
  'agent_enhancement': 1.4,
  'agent_update': 1.1,

  // Plugin operations
  'plugin_call_simple': 0.8,
  'plugin_call_standard': 1.0,
  'plugin_call_complex': 1.3,
  'plugin_execution': 1.0,

  // Content processing
  'file_analysis': 1.3,
  'pdf_generation': 1.1,
  'email_generation': 0.9,
  'document_processing': 1.2,

  // Conversational
  'chat_message': 1.0,
  'chat_completion': 1.0,
  'conversation': 1.0,

  // Prompt operations
  'prompt_analysis': 1.1,
  'prompt_enhancement': 1.2,
  'prompt_generation': 1.0,
  'clarification_questions': 0.9,

  // Research & analysis
  'research': 1.2,
  'analysis': 1.1,
  'summarization': 1.0,
  'web_search': 1.1,

  // Default
  'default': 1.0,
};

/**
 * Get multiplier for activity type
 */
export function getActivityMultiplier(activityType: string): number {
  return ACTIVITY_MULTIPLIERS[activityType] || ACTIVITY_MULTIPLIERS.default;
}

/**
 * Pilot Credits pricing constants
 */
export const PRICING_CONSTANTS = {
  // Base conversion: 1 Pilot Credit ≈ 10 tokens
  TOKENS_PER_CREDIT: 10,

  // Estimated internal cost per credit
  COST_PER_CREDIT_USD: 0.00012,

  // Low fuel warning thresholds
  LOW_FUEL_PERCENT: 20,
  CRITICAL_FUEL_PERCENT: 10,

  // Reservation buffer (% over estimated)
  RESERVATION_BUFFER_PERCENT: 10,
};
```

**File:** `lib/credits/pilotCreditsEngine.ts`

```typescript
// lib/credits/pilotCreditsEngine.ts

import { supabase } from '@/lib/supabaseClient';
import { getActivityMultiplier, PRICING_CONSTANTS } from './constants';
import type { CreditReservation, CreditFinalization, UserSubscription } from './types';

/**
 * Calculate Pilot Credits based on token usage
 *
 * Formula: credits = (total_tokens / 10) × activity_multiplier
 *
 * @param inputTokens - GPT-4o input tokens
 * @param outputTokens - GPT-4o output tokens
 * @param activityType - Type of activity (e.g., 'agent_creation')
 * @returns Number of Pilot Credits to charge (rounded up)
 */
export function calculatePilotCredits(
  inputTokens: number,
  outputTokens: number,
  activityType: string
): number {
  const totalTokens = inputTokens + outputTokens;
  const baseCredits = totalTokens / PRICING_CONSTANTS.TOKENS_PER_CREDIT;
  const multiplier = getActivityMultiplier(activityType);

  // Round up to avoid fractional credits
  return Math.ceil(baseCredits * multiplier);
}

/**
 * Reserve Pilot Credits before an operation
 *
 * This creates a "pending" transaction and checks if user has sufficient balance.
 * If successful, returns a reservationId that must be used to finalize the charge.
 *
 * @param userId - User ID
 * @param estimatedCredits - Estimated credits needed
 * @param activityType - Type of activity
 * @param metadata - Additional context (agentId, sessionId, etc.)
 * @returns Reservation result with allowed flag and reservationId
 */
export async function reservePilotCredits(
  userId: string,
  estimatedCredits: number,
  activityType: string,
  metadata: Record<string, any> = {}
): Promise<CreditReservation> {
  try {
    // Get current subscription and balance
    const { data: subscription, error: subError } = await supabase
      .from('user_subscriptions')
      .select('id, pilot_credits_balance')
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();

    if (subError || !subscription) {
      console.error('No active subscription found:', subError);
      return {
        allowed: false,
        currentBalance: 0,
      };
    }

    const currentBalance = subscription.pilot_credits_balance;

    // Check if user has sufficient credits
    if (currentBalance < estimatedCredits) {
      console.warn(`Insufficient Pilot Credits: need ${estimatedCredits}, have ${currentBalance}`);
      return {
        allowed: false,
        currentBalance,
        estimatedCredits,
      };
    }

    // Create reservation transaction (status: pending via metadata)
    const { data: reservation, error: reservationError } = await supabase
      .from('credit_transactions')
      .insert({
        user_id: userId,
        subscription_id: subscription.id,
        transaction_type: 'reservation',
        pilot_credits_amount: -estimatedCredits, // Negative for deduction
        activity_type: activityType,
        balance_before: currentBalance,
        balance_after: currentBalance - estimatedCredits,
        metadata: {
          status: 'pending',
          estimated: true,
          ...metadata,
        },
      })
      .select()
      .single();

    if (reservationError) {
      console.error('Failed to create reservation:', reservationError);
      return {
        allowed: false,
        currentBalance,
      };
    }

    console.log('✅ Pilot Credits reserved:', {
      userId,
      reservationId: reservation.id,
      credits: estimatedCredits,
      activityType,
    });

    return {
      allowed: true,
      reservationId: reservation.id,
      currentBalance,
      estimatedCredits,
    };
  } catch (error) {
    console.error('Error in reservePilotCredits:', error);
    return {
      allowed: false,
      currentBalance: 0,
    };
  }
}

/**
 * Finalize Pilot Credits after LLM operation completes
 *
 * Calculates actual credits based on tokens used, updates the reservation
 * to "completed" status, and refunds any over-reservation.
 *
 * @param userId - User ID
 * @param reservationId - ID from reservePilotCredits()
 * @param actualTokens - Actual tokens used {input, output}
 * @param activityType - Type of activity
 * @param tokenUsageId - Link to token_usage record
 * @param actualCostUSD - Actual OpenAI cost
 * @returns Finalization result with credits charged and refunded
 */
export async function finalizePilotCredits(
  userId: string,
  reservationId: string,
  actualTokens: { input: number; output: number },
  activityType: string,
  tokenUsageId: string,
  actualCostUSD: number
): Promise<CreditFinalization> {
  try {
    // Calculate actual credits based on tokens
    const actualCredits = calculatePilotCredits(
      actualTokens.input,
      actualTokens.output,
      activityType
    );

    // Get reservation details
    const { data: reservation, error: reservationError } = await supabase
      .from('credit_transactions')
      .select('pilot_credits_amount, balance_after, subscription_id')
      .eq('id', reservationId)
      .single();

    if (reservationError || !reservation) {
      console.error('Reservation not found:', reservationError);
      throw new Error('Reservation not found');
    }

    const estimatedCredits = Math.abs(reservation.pilot_credits_amount);
    const creditDifference = estimatedCredits - actualCredits;

    // Update reservation to completed
    await supabase
      .from('credit_transactions')
      .update({
        transaction_type: 'deduction',
        pilot_credits_amount: -actualCredits,
        token_usage_id: tokenUsageId,
        metadata: {
          status: 'completed',
          estimated_credits: estimatedCredits,
          actual_credits: actualCredits,
          tokens_input: actualTokens.input,
          tokens_output: actualTokens.output,
          tokens_total: actualTokens.input + actualTokens.output,
          actual_cost_usd: actualCostUSD,
          refunded: creditDifference > 0 ? creditDifference : 0,
        },
      })
      .eq('id', reservationId);

    // Calculate new balance
    const newBalance = reservation.balance_after + (creditDifference > 0 ? creditDifference : 0);

    // Update subscription balance and usage
    await supabase
      .from('user_subscriptions')
      .update({
        pilot_credits_balance: newBalance,
        pilot_credits_used_this_cycle: supabase.rpc('increment', {
          current_value: 'pilot_credits_used_this_cycle',
          increment_by: actualCredits,
        }),
        updated_at: new Date().toISOString(),
      })
      .eq('id', reservation.subscription_id);

    // If we over-reserved, create refund transaction
    if (creditDifference > 0) {
      await supabase.from('credit_transactions').insert({
        user_id: userId,
        subscription_id: reservation.subscription_id,
        transaction_type: 'refund',
        pilot_credits_amount: creditDifference,
        activity_type: activityType,
        balance_before: newBalance - creditDifference,
        balance_after: newBalance,
        metadata: {
          reason: 'over_reservation',
          original_reservation_id: reservationId,
          estimated: estimatedCredits,
          actual: actualCredits,
        },
      });

      console.log('💰 Refunded over-reservation:', {
        userId,
        reservationId,
        estimated: estimatedCredits,
        actual: actualCredits,
        refunded: creditDifference,
      });
    }

    console.log('✅ Pilot Credits finalized:', {
      userId,
      reservationId,
      actualCredits,
      refunded: creditDifference > 0 ? creditDifference : 0,
      newBalance,
    });

    return {
      success: true,
      creditsCharged: actualCredits,
      refunded: creditDifference > 0 ? creditDifference : 0,
      newBalance,
    };
  } catch (error) {
    console.error('Error in finalizePilotCredits:', error);
    throw error;
  }
}

/**
 * Apply Boost Pack credits to user balance
 *
 * @param userId - User ID
 * @param boostPackId - Boost pack ID
 * @param purchaseId - Purchase record ID
 * @returns New balance and credits added
 */
export async function applyBoostPack(
  userId: string,
  boostPackId: string,
  purchaseId: string
): Promise<{ success: boolean; newBalance: number; creditsAdded: number }> {
  try {
    // Get boost pack details
    const { data: boostPack, error: packError } = await supabase
      .from('boost_packs')
      .select('credits')
      .eq('id', boostPackId)
      .single();

    if (packError || !boostPack) {
      throw new Error('Boost pack not found');
    }

    // Get current subscription
    const { data: subscription, error: subError } = await supabase
      .from('user_subscriptions')
      .select('id, pilot_credits_balance, total_lifetime_credits')
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();

    if (subError || !subscription) {
      throw new Error('No active subscription found');
    }

    const creditsToAdd = boostPack.credits;
    const newBalance = subscription.pilot_credits_balance + creditsToAdd;

    // Update subscription balance
    await supabase
      .from('user_subscriptions')
      .update({
        pilot_credits_balance: newBalance,
        total_lifetime_credits: subscription.total_lifetime_credits + creditsToAdd,
        updated_at: new Date().toISOString(),
      })
      .eq('id', subscription.id);

    // Create boost pack transaction
    await supabase.from('credit_transactions').insert({
      user_id: userId,
      subscription_id: subscription.id,
      transaction_type: 'boost_pack',
      pilot_credits_amount: creditsToAdd,
      activity_type: 'boost_pack_purchase',
      balance_before: subscription.pilot_credits_balance,
      balance_after: newBalance,
      metadata: {
        boost_pack_id: boostPackId,
        purchase_id: purchaseId,
      },
    });

    // Mark purchase as applied
    await supabase
      .from('boost_pack_purchases')
      .update({
        credits_applied: true,
        applied_at: new Date().toISOString(),
      })
      .eq('id', purchaseId);

    console.log('✅ Boost Pack applied:', {
      userId,
      boostPackId,
      creditsAdded,
      newBalance,
    });

    return {
      success: true,
      newBalance,
      creditsAdded,
    };
  } catch (error) {
    console.error('Error applying boost pack:', error);
    throw error;
  }
}

/**
 * Monthly renewal: Reset credits and apply carry-over
 *
 * Formula: New_Balance = MonthlyAllocation + Carry_Over
 *
 * @param userId - User ID
 * @returns New balance, allocated, and carried over
 */
export async function resetAndCarryOver(
  userId: string
): Promise<{
  success: boolean;
  newBalance: number;
  creditsAllocated: number;
  creditsCarriedOver: number;
}> {
  try {
    // Get subscription and plan details
    const { data: subscription, error: subError } = await supabase
      .from('user_subscriptions')
      .select(`
        id,
        pilot_credits_balance,
        pilot_credits_used_this_cycle,
        billing_cycle,
        plans (
          credits_per_month,
          carry_over_enabled
        )
      `)
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();

    if (subError || !subscription) {
      throw new Error('No active subscription found');
    }

    const plan = subscription.plans as any;
    const monthlyAllocation = plan.credits_per_month;
    const carryOverEnabled = plan.carry_over_enabled;

    // Calculate carry-over
    const currentBalance = subscription.pilot_credits_balance;
    const creditsToCarryOver = carryOverEnabled ? Math.max(0, currentBalance) : 0;

    // Calculate new balance
    const newBalance = monthlyAllocation + creditsToCarryOver;

    // Calculate next billing date
    const nextBillingDate = new Date();
    if (subscription.billing_cycle === 'monthly') {
      nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);
    } else {
      nextBillingDate.setFullYear(nextBillingDate.getFullYear() + 1);
    }

    // Update subscription
    await supabase
      .from('user_subscriptions')
      .update({
        pilot_credits_balance: newBalance,
        pilot_credits_allocated_this_cycle: monthlyAllocation,
        pilot_credits_used_this_cycle: 0, // Reset usage counter
        pilot_credits_carried_over: creditsToCarryOver,
        total_lifetime_credits: subscription.total_lifetime_credits + monthlyAllocation,
        current_period_start: new Date().toISOString(),
        current_period_end: nextBillingDate.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', subscription.id);

    // Log billing event
    await supabase.from('billing_events').insert({
      user_id: userId,
      subscription_id: subscription.id,
      event_type: 'monthly_renewal_carry_over',
      pilot_credits_before: currentBalance,
      pilot_credits_after: newBalance,
      pilot_credits_allocated: monthlyAllocation,
      pilot_credits_carried_over: creditsToCarryOver,
      metadata: {
        billing_cycle: subscription.billing_cycle,
        used_last_cycle: subscription.pilot_credits_used_this_cycle,
      },
    });

    console.log('✅ Monthly renewal completed:', {
      userId,
      newBalance,
      allocated: monthlyAllocation,
      carriedOver: creditsToCarryOver,
    });

    return {
      success: true,
      newBalance,
      creditsAllocated: monthlyAllocation,
      creditsCarriedOver: creditsToCarryOver,
    };
  } catch (error) {
    console.error('Error in resetAndCarryOver:', error);
    throw error;
  }
}

/**
 * Get user's credit balance and subscription info
 */
export async function getUserCreditInfo(userId: string) {
  const { data, error } = await supabase
    .from('user_subscriptions')
    .select(`
      pilot_credits_balance,
      pilot_credits_allocated_this_cycle,
      pilot_credits_used_this_cycle,
      pilot_credits_carried_over,
      current_period_end,
      status,
      billing_cycle,
      plans (
        plan_name,
        plan_code,
        credits_per_month,
        max_agents,
        max_plugins,
        storage_gb
      )
    `)
    .eq('user_id', userId)
    .eq('status', 'active')
    .single();

  if (error || !data) {
    return null;
  }

  const usagePercent =
    data.pilot_credits_allocated_this_cycle > 0
      ? (data.pilot_credits_used_this_cycle / data.pilot_credits_allocated_this_cycle) * 100
      : 0;

  return {
    creditBalance: data.pilot_credits_balance,
    creditsAllocated: data.pilot_credits_allocated_this_cycle,
    creditsUsed: data.pilot_credits_used_this_cycle,
    creditsCarriedOver: data.pilot_credits_carried_over,
    usagePercent: Math.round(usagePercent),
    renewalDate: data.current_period_end,
    status: data.status,
    billingCycle: data.billing_cycle,
    plan: data.plans,
  };
}
```

---

### **Phase 2: Integration with Existing Code**

**File:** `lib/utils/usageTracker.ts` (MODIFIED)

```typescript
// ADD THIS IMPORT at top of file
import { finalizePilotCredits } from '@/lib/credits/pilotCreditsEngine';

// MODIFY the trackUsage function
export async function trackUsage(data: UsageData): Promise<boolean> {
  // ... existing code that calculates cost and inserts into token_usage ...

  const cost = calculateCost(data.provider, data.modelName, data.inputTokens, data.outputTokens);

  const { data: result, error } = await supabase
    .from('token_usage')
    .insert({
      user_id: data.userId,
      provider: data.provider,
      model_name: data.modelName,
      input_tokens: data.inputTokens,
      output_tokens: data.outputTokens,
      total_tokens: data.inputTokens + data.outputTokens,
      cost_usd: cost,
      request_type: data.requestType || 'chat',
      session_id: data.sessionId,
      metadata: data.metadata,
      // ... other existing fields
    })
    .select()
    .single();

  if (error) {
    console.error('❌ Supabase insert error:', error);
    return false;
  }

  // ========================================
  // NEW: Finalize Pilot Credits deduction
  // ========================================
  if (data.metadata?.reservationId) {
    try {
      await finalizePilotCredits(
        data.userId,
        data.metadata.reservationId,
        { input: data.inputTokens, output: data.outputTokens },
        data.metadata.activity_type || 'general',
        result.id, // Link to token_usage record
        cost
      );
      console.log('✅ Pilot Credits finalized for token_usage:', result.id);
    } catch (creditError) {
      console.error('❌ Failed to finalize Pilot Credits:', creditError);
      // Don't fail the entire operation, just log the error
    }
  }

  console.log('✅ Supabase insert successful!');
  return true;
}
```

**File:** `app/api/generate-agent/route.ts` (MODIFIED)

```typescript
// ADD THIS IMPORT at top of file
import { reservePilotCredits } from '@/lib/credits/pilotCreditsEngine';

export async function POST(req: Request) {
  try {
    const { prompt, clarificationAnswers, agentId, sessionId } = await req.json();

    // ... existing auth code ...

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ========================================
    // NEW: Reserve Pilot Credits before LLM call
    // ========================================
    const reservation = await reservePilotCredits(
      user.id,
      1200, // Estimated credits for agent creation
      'agent_creation',
      { sessionId, agentId, prompt: prompt.substring(0, 100) }
    );

    if (!reservation.allowed) {
      console.warn('❌ Insufficient Pilot Credits');
      return NextResponse.json(
        {
          error: 'LOW_FUEL',
          message: 'Insufficient Pilot Credits to create agent',
          currentBalance: reservation.currentBalance,
          needed: 1200,
          upgrade_url: '/settings?tab=plan',
        },
        { status: 402 } // Payment Required
      );
    }

    console.log('✅ Pilot Credits reserved:', reservation.reservationId);

    // ... rest of existing code (LLM call, etc.) ...

    // When calling trackUsage, add reservationId to metadata
    await trackUsage({
      userId: user.id,
      provider: 'openai',
      modelName: 'gpt-4o',
      inputTokens: llmResponse.usage?.prompt_tokens || 0,
      outputTokens: llmResponse.usage?.completion_tokens || 0,
      requestType: 'agent_creation',
      sessionId,
      metadata: {
        activity_type: 'agent_creation',
        agentId,
        reservationId: reservation.reservationId, // 👈 IMPORTANT: Link to reservation
        // ... other existing metadata
      },
    });

    // ... return response ...
  } catch (error) {
    console.error('Error in agent generation:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

---

## 📄 REMAINING IMPLEMENTATION DETAILS

Due to length constraints, the complete implementation plan includes:

### **Phase 3: Stripe Integration** (2 hours)
- Full webhook handlers for all Stripe events
- Checkout session creation
- Billing portal integration
- Boost pack one-time payments

### **Phase 4: Enhanced Settings Page** (3 hours)
- Complete PlanManagementTab.tsx upgrade
- 6 new billing components
- Real-time subscription data hooks

### **Phase 5: Dashboard Widgets** (1 hour)
- Fuel tank widget for dashboard
- Low fuel warnings
- Quick top-up buttons

### **Phase 6: Admin Tools** (1 hour)
- Billing dashboard
- Margin analysis
- Revenue reports

---

## 📊 SUCCESS METRICS

### **Before Launch Checklist**
- [ ] All tables created in Supabase
- [ ] RLS policies tested
- [ ] Stripe webhook endpoint verified
- [ ] Test user can create agent with credit deduction
- [ ] Test user can purchase boost pack
- [ ] Test user can upgrade/downgrade plan
- [ ] Invoice PDF generation works
- [ ] Monthly renewal tested (simulated)
- [ ] Carry-over logic verified
- [ ] Margin analysis dashboard shows correct data

### **Performance Targets**
- Credit deduction latency: <50ms
- Stripe webhook processing: <500ms
- Settings page load: <1s
- Zero breaking changes to existing features

---

## 🎯 FINAL DELIVERABLES

1. ✅ **5 new database tables** with RLS policies
2. ✅ **Credit engine** (`lib/credits/`) fully functional
3. ✅ **Stripe integration** with webhook handlers
4. ✅ **Enhanced Settings page** with plan management
5. ✅ **Modified API routes** (generate-agent, run-agent)
6. ✅ **Dashboard widgets** for credit balance
7. ✅ **Admin tools** for billing oversight
8. ✅ **Complete documentation** (this file)

**Total Implementation Time:** 11 hours
**Total New Code:** ~3,500 lines
**Breaking Changes:** 0

---

**Ready to build!** 🚀
