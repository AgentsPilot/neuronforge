-- ============================================================================
-- Payment System Enhancement Migration
-- ============================================================================
-- Adds: Payment Plans, Installments, Events, Automation Rules, Reminders
-- Purpose: Modular building blocks for AI automation kernel
-- IMPORTANT: Payment processor agnostic (supports Stripe, PayPal, Square, etc.)
-- ============================================================================

-- ============================================================================
-- 1. PAYMENT PROCESSORS TABLE (supports multiple processors)
-- ============================================================================

CREATE TABLE IF NOT EXISTS payment_processors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  processor_type TEXT NOT NULL, -- 'stripe' | 'paypal' | 'square' | 'manual'
  is_active BOOLEAN DEFAULT true,
  is_default BOOLEAN DEFAULT false,

  -- Processor-specific credentials (encrypted at app level)
  credentials JSONB DEFAULT '{}', -- { account_id, access_token, etc. }

  -- Processor capabilities
  supports_checkout BOOLEAN DEFAULT true,
  supports_saved_methods BOOLEAN DEFAULT true,
  supports_refunds BOOLEAN DEFAULT true,
  supports_partial_refunds BOOLEAN DEFAULT true,

  -- Status
  connection_status TEXT DEFAULT 'pending', -- 'pending' | 'connected' | 'disconnected' | 'error'
  last_verified_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, processor_type)
);

-- Indexes for payment_processors
CREATE INDEX IF NOT EXISTS idx_payment_processors_user_id ON payment_processors(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_processors_active ON payment_processors(user_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_payment_processors_default ON payment_processors(user_id, is_default) WHERE is_default = true;

-- RLS for payment_processors
ALTER TABLE payment_processors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own payment processors" ON payment_processors;
CREATE POLICY "Users can manage their own payment processors" ON payment_processors
  FOR ALL USING (auth.uid() = user_id);

-- ============================================================================
-- 2. ENHANCE EXISTING TABLES (processor agnostic)
-- ============================================================================

-- Add payment method options to invoices (processor agnostic)
ALTER TABLE payment_invoices
ADD COLUMN IF NOT EXISTS payment_method TEXT,
ADD COLUMN IF NOT EXISTS payment_received_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS payment_notes TEXT,
ADD COLUMN IF NOT EXISTS processor_type TEXT, -- 'stripe' | 'paypal' | 'square' | 'manual'
ADD COLUMN IF NOT EXISTS processor_checkout_id TEXT, -- Checkout session ID (any processor)
ADD COLUMN IF NOT EXISTS processor_payment_id TEXT, -- Payment intent/transaction ID
ADD COLUMN IF NOT EXISTS processor_customer_id TEXT, -- Customer ID for saved methods
ADD COLUMN IF NOT EXISTS processor_payment_method_id TEXT, -- Saved payment method ID
ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_retry_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;

-- Add refund tracking to transactions (processor agnostic)
ALTER TABLE payment_transactions
ADD COLUMN IF NOT EXISTS refund_status TEXT DEFAULT 'none', -- 'none' | 'partial' | 'full'
ADD COLUMN IF NOT EXISTS refunded_amount DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS refund_reason TEXT,
ADD COLUMN IF NOT EXISTS processor_refund_id TEXT, -- Refund ID from any processor
ADD COLUMN IF NOT EXISTS processor_type TEXT; -- 'stripe' | 'paypal' | 'square' | 'manual'

-- Link bookings to payments more explicitly
ALTER TABLE scheduling_bookings
ADD COLUMN IF NOT EXISTS payment_method TEXT,
ADD COLUMN IF NOT EXISTS payment_amount DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS payment_currency TEXT,
ADD COLUMN IF NOT EXISTS invoice_id UUID,
ADD COLUMN IF NOT EXISTS payment_plan_id UUID;

-- Add payment settings to business_profiles (processor agnostic)
ALTER TABLE business_profiles
ADD COLUMN IF NOT EXISTS default_payment_processor TEXT DEFAULT 'manual', -- 'stripe' | 'paypal' | 'square' | 'manual'
ADD COLUMN IF NOT EXISTS payment_retry_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS payment_retry_intervals INTEGER[] DEFAULT '{1,4,24}',
ADD COLUMN IF NOT EXISTS payment_max_retries INTEGER DEFAULT 3,
ADD COLUMN IF NOT EXISTS payment_reminder_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS payment_reminder_days_before INTEGER[] DEFAULT '{3,1}',
ADD COLUMN IF NOT EXISTS payment_overdue_reminder_days INTEGER[] DEFAULT '{1,3,7}',
ADD COLUMN IF NOT EXISTS payment_reminder_channels TEXT[] DEFAULT '{"email"}';

-- ============================================================================
-- 3. PAYMENT PLANS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS payment_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  service_id UUID REFERENCES scheduling_services(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  total_amount DECIMAL(10,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  supported_currencies TEXT[] DEFAULT '{"USD"}',
  installment_count INTEGER NOT NULL DEFAULT 1,
  installment_amount DECIMAL(10,2) NOT NULL,
  installment_frequency TEXT NOT NULL DEFAULT 'monthly', -- 'weekly' | 'biweekly' | 'monthly'

  -- Processor settings (which processors can be used for this plan)
  allowed_processors TEXT[] DEFAULT '{"stripe","paypal","square","manual"}',
  preferred_processor TEXT, -- Optional: preferred processor for this plan

  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for payment_plans
CREATE INDEX IF NOT EXISTS idx_payment_plans_user_id ON payment_plans(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_plans_service_id ON payment_plans(service_id);
CREATE INDEX IF NOT EXISTS idx_payment_plans_active ON payment_plans(user_id, is_active) WHERE is_active = true;

-- RLS for payment_plans
ALTER TABLE payment_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own payment plans" ON payment_plans;
CREATE POLICY "Users can manage their own payment plans" ON payment_plans
  FOR ALL USING (auth.uid() = user_id);

-- ============================================================================
-- 4. PAYMENT PLAN INSTALLMENTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS payment_plan_installments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  payment_plan_id UUID NOT NULL REFERENCES payment_plans(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES scheduling_bookings(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES crm_contacts(id) ON DELETE SET NULL,
  installment_number INTEGER NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  currency TEXT NOT NULL,
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'paid' | 'overdue' | 'cancelled'
  paid_at TIMESTAMPTZ,
  payment_method TEXT,
  processor_type TEXT, -- 'stripe' | 'paypal' | 'square' | 'manual'
  transaction_id UUID REFERENCES payment_transactions(id) ON DELETE SET NULL,
  retry_count INTEGER DEFAULT 0,
  last_retry_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for payment_plan_installments
CREATE INDEX IF NOT EXISTS idx_payment_plan_installments_user_id ON payment_plan_installments(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_plan_installments_plan_id ON payment_plan_installments(payment_plan_id);
CREATE INDEX IF NOT EXISTS idx_payment_plan_installments_booking_id ON payment_plan_installments(booking_id);
CREATE INDEX IF NOT EXISTS idx_payment_plan_installments_contact_id ON payment_plan_installments(contact_id);
CREATE INDEX IF NOT EXISTS idx_payment_plan_installments_due_date ON payment_plan_installments(due_date);
CREATE INDEX IF NOT EXISTS idx_payment_plan_installments_status ON payment_plan_installments(user_id, status);
CREATE INDEX IF NOT EXISTS idx_payment_plan_installments_next_retry ON payment_plan_installments(next_retry_at) WHERE next_retry_at IS NOT NULL;

-- RLS for payment_plan_installments
ALTER TABLE payment_plan_installments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own installments" ON payment_plan_installments;
CREATE POLICY "Users can manage their own installments" ON payment_plan_installments
  FOR ALL USING (auth.uid() = user_id);

-- ============================================================================
-- 5. PAYMENT EVENTS TABLE (for AI analysis)
-- ============================================================================

CREATE TABLE IF NOT EXISTS payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL, -- 'invoice' | 'installment' | 'transaction' | 'plan' | 'processor'
  entity_id UUID NOT NULL,
  contact_id UUID REFERENCES crm_contacts(id) ON DELETE SET NULL,
  processor_type TEXT, -- Which processor was involved
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for payment_events
CREATE INDEX IF NOT EXISTS idx_payment_events_user_type ON payment_events(user_id, event_type);
CREATE INDEX IF NOT EXISTS idx_payment_events_contact ON payment_events(contact_id);
CREATE INDEX IF NOT EXISTS idx_payment_events_entity ON payment_events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_payment_events_created ON payment_events(created_at);
CREATE INDEX IF NOT EXISTS idx_payment_events_user_created ON payment_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_events_processor ON payment_events(processor_type);

-- RLS for payment_events
ALTER TABLE payment_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own payment events" ON payment_events;
CREATE POLICY "Users can view their own payment events" ON payment_events
  FOR ALL USING (auth.uid() = user_id);

-- ============================================================================
-- 6. PAYMENT AUTOMATION RULES TABLE (user-configurable)
-- ============================================================================

CREATE TABLE IF NOT EXISTS payment_automation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,

  -- Trigger condition
  trigger_event TEXT NOT NULL, -- 'invoice.created', 'payment.failed', 'installment.overdue', etc.
  trigger_conditions JSONB DEFAULT '{}', -- { "overdue_days": { "gte": 3 }, "amount": { "gte": 100 }, "processor": "stripe" }

  -- Action (building block to execute)
  action_block TEXT NOT NULL, -- 'send_payment_reminder', 'retry_payment', 'collect_payment', etc.
  action_parameters JSONB DEFAULT '{}', -- { "channel": "email", "processor": "stripe" }

  -- Timing
  delay_minutes INTEGER DEFAULT 0, -- Wait before executing (0 = immediate)

  -- Limits
  max_executions_per_entity INTEGER, -- Max times to run for same invoice/installment
  cooldown_hours INTEGER, -- Min hours between executions

  -- Processor filter (optional - only trigger for specific processor)
  processor_filter TEXT[], -- NULL = all processors, or ['stripe', 'paypal']

  -- Metadata
  execution_count INTEGER DEFAULT 0,
  last_executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for payment_automation_rules
CREATE INDEX IF NOT EXISTS idx_payment_automation_rules_user_id ON payment_automation_rules(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_automation_rules_trigger ON payment_automation_rules(trigger_event);
CREATE INDEX IF NOT EXISTS idx_payment_automation_rules_active ON payment_automation_rules(user_id, is_active) WHERE is_active = true;

-- RLS for payment_automation_rules
ALTER TABLE payment_automation_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own automation rules" ON payment_automation_rules;
CREATE POLICY "Users can manage their own automation rules" ON payment_automation_rules
  FOR ALL USING (auth.uid() = user_id);

-- ============================================================================
-- 7. PAYMENT AUTOMATION EXECUTIONS TABLE (tracking rule executions)
-- ============================================================================

CREATE TABLE IF NOT EXISTS payment_automation_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  rule_id UUID NOT NULL REFERENCES payment_automation_rules(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  processor_type TEXT, -- Which processor was used
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'scheduled' | 'executed' | 'failed' | 'cancelled'
  scheduled_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  result JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for payment_automation_executions
CREATE INDEX IF NOT EXISTS idx_payment_automation_executions_user_id ON payment_automation_executions(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_automation_executions_rule_id ON payment_automation_executions(rule_id);
CREATE INDEX IF NOT EXISTS idx_payment_automation_executions_entity ON payment_automation_executions(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_payment_automation_executions_scheduled ON payment_automation_executions(scheduled_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_payment_automation_executions_status ON payment_automation_executions(user_id, status);

-- RLS for payment_automation_executions
ALTER TABLE payment_automation_executions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own automation executions" ON payment_automation_executions;
CREATE POLICY "Users can view their own automation executions" ON payment_automation_executions
  FOR ALL USING (auth.uid() = user_id);

-- ============================================================================
-- 8. PAYMENT REMINDERS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS payment_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  invoice_id UUID REFERENCES payment_invoices(id) ON DELETE CASCADE,
  installment_id UUID REFERENCES payment_plan_installments(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES crm_contacts(id) ON DELETE SET NULL,
  reminder_type TEXT NOT NULL, -- 'upcoming_due' | 'overdue' | 'retry_failed' | 'payment_received'
  scheduled_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  channel TEXT NOT NULL DEFAULT 'email', -- 'email' | 'sms' | 'in_app'
  template_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'sent' | 'failed' | 'cancelled'
  metadata JSONB DEFAULT '{}',
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for payment_reminders
CREATE INDEX IF NOT EXISTS idx_payment_reminders_user_id ON payment_reminders(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_reminders_invoice_id ON payment_reminders(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payment_reminders_installment_id ON payment_reminders(installment_id);
CREATE INDEX IF NOT EXISTS idx_payment_reminders_contact_id ON payment_reminders(contact_id);
CREATE INDEX IF NOT EXISTS idx_payment_reminders_scheduled ON payment_reminders(scheduled_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_payment_reminders_status ON payment_reminders(user_id, status);

-- RLS for payment_reminders
ALTER TABLE payment_reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own payment reminders" ON payment_reminders;
CREATE POLICY "Users can manage their own payment reminders" ON payment_reminders
  FOR ALL USING (auth.uid() = user_id);

-- ============================================================================
-- 9. SAVED PAYMENT METHODS TABLE (processor agnostic)
-- ============================================================================

CREATE TABLE IF NOT EXISTS saved_payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  contact_id UUID REFERENCES crm_contacts(id) ON DELETE CASCADE,
  processor_type TEXT NOT NULL, -- 'stripe' | 'paypal' | 'square'
  processor_customer_id TEXT NOT NULL, -- Customer ID in the processor
  processor_method_id TEXT NOT NULL, -- Payment method ID in the processor

  -- Display info (masked for security)
  method_type TEXT NOT NULL, -- 'card' | 'bank_account' | 'paypal'
  last_four TEXT, -- Last 4 digits of card/account
  brand TEXT, -- 'visa' | 'mastercard' | 'amex' | etc.
  expiry_month INTEGER,
  expiry_year INTEGER,

  is_default BOOLEAN DEFAULT false,
  is_valid BOOLEAN DEFAULT true, -- Set to false if card expired/declined

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for saved_payment_methods
CREATE INDEX IF NOT EXISTS idx_saved_payment_methods_user_id ON saved_payment_methods(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_payment_methods_contact_id ON saved_payment_methods(contact_id);
CREATE INDEX IF NOT EXISTS idx_saved_payment_methods_processor ON saved_payment_methods(processor_type);
CREATE INDEX IF NOT EXISTS idx_saved_payment_methods_default ON saved_payment_methods(contact_id, is_default) WHERE is_default = true;

-- RLS for saved_payment_methods
ALTER TABLE saved_payment_methods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their contacts saved payment methods" ON saved_payment_methods;
CREATE POLICY "Users can manage their contacts saved payment methods" ON saved_payment_methods
  FOR ALL USING (auth.uid() = user_id);

-- ============================================================================
-- 10. ADD FOREIGN KEY CONSTRAINTS (deferred to avoid circular deps)
-- ============================================================================

-- Add FK for scheduling_bookings.invoice_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'scheduling_bookings_invoice_id_fkey'
  ) THEN
    ALTER TABLE scheduling_bookings
    ADD CONSTRAINT scheduling_bookings_invoice_id_fkey
    FOREIGN KEY (invoice_id) REFERENCES payment_invoices(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Add FK for scheduling_bookings.payment_plan_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'scheduling_bookings_payment_plan_id_fkey'
  ) THEN
    ALTER TABLE scheduling_bookings
    ADD CONSTRAINT scheduling_bookings_payment_plan_id_fkey
    FOREIGN KEY (payment_plan_id) REFERENCES payment_plans(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================================
-- 11. INDEXES FOR RETRY SCHEDULING
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_payment_invoices_next_retry
  ON payment_invoices(next_retry_at)
  WHERE next_retry_at IS NOT NULL AND status != 'paid';

-- ============================================================================
-- 12. FUNCTION: Update installment status to overdue
-- ============================================================================

CREATE OR REPLACE FUNCTION update_overdue_installments()
RETURNS INTEGER AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE payment_plan_installments
  SET
    status = 'overdue',
    updated_at = NOW()
  WHERE
    status = 'pending'
    AND due_date < CURRENT_DATE;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 13. COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE payment_processors IS 'Connected payment processors per user (Stripe, PayPal, Square, etc.)';
COMMENT ON TABLE payment_plans IS 'Payment plan templates that can be applied to bookings/contacts';
COMMENT ON TABLE payment_plan_installments IS 'Individual installments for a payment plan applied to a booking/contact';
COMMENT ON TABLE payment_events IS 'Event log for payment activities - used by AI for analysis and automation';
COMMENT ON TABLE payment_automation_rules IS 'User-configurable automation rules (triggers + actions)';
COMMENT ON TABLE payment_automation_executions IS 'Execution history for automation rules';
COMMENT ON TABLE payment_reminders IS 'Scheduled and sent payment reminders';
COMMENT ON TABLE saved_payment_methods IS 'Saved payment methods for contacts (processor agnostic)';

COMMENT ON COLUMN payment_processors.processor_type IS 'Payment processor: stripe, paypal, square, manual';
COMMENT ON COLUMN payment_automation_rules.trigger_event IS 'Event that triggers this rule: invoice.created, payment.failed, installment.overdue, etc.';
COMMENT ON COLUMN payment_automation_rules.action_block IS 'Building block to execute: send_payment_reminder, retry_payment, collect_payment, etc.';
COMMENT ON COLUMN payment_automation_rules.processor_filter IS 'Optional filter: only trigger for specific processors';
