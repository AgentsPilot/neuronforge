-- Payment Tables Migration
-- Creates payment processing functionality: transactions, invoices, payment methods

-- =====================================================
-- 1. Payment Invoices Table (Created FIRST to avoid circular dependency)
-- =====================================================
CREATE TABLE IF NOT EXISTS payment_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES crm_contacts(id) ON DELETE SET NULL,

  -- Invoice details
  invoice_number TEXT NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'draft', -- 'draft', 'sent', 'paid', 'overdue', 'cancelled'

  -- Line items (JSONB array)
  -- Example: [{"description": "Therapy Session", "quantity": 1, "unit_price": 120.00, "total": 120.00}]
  line_items JSONB DEFAULT '[]',

  -- Payment terms
  due_date DATE,
  payment_terms TEXT DEFAULT 'Due upon receipt',

  -- Notes
  notes TEXT,
  internal_notes TEXT, -- Private notes

  -- Metadata
  sent_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(user_id, invoice_number)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_payment_invoices_user_id ON payment_invoices(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_invoices_contact_id ON payment_invoices(contact_id);
CREATE INDEX IF NOT EXISTS idx_payment_invoices_status ON payment_invoices(status);
CREATE INDEX IF NOT EXISTS idx_payment_invoices_invoice_number ON payment_invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_payment_invoices_due_date ON payment_invoices(due_date);

-- RLS Policies
ALTER TABLE payment_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own invoices" ON payment_invoices;
CREATE POLICY "Users can view their own invoices"
  ON payment_invoices FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own invoices" ON payment_invoices;
CREATE POLICY "Users can insert their own invoices"
  ON payment_invoices FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own invoices" ON payment_invoices;
CREATE POLICY "Users can update their own invoices"
  ON payment_invoices FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own invoices" ON payment_invoices;
CREATE POLICY "Users can delete their own invoices"
  ON payment_invoices FOR DELETE
  USING (auth.uid() = user_id);

-- =====================================================
-- 2. Payment Transactions Table (Created SECOND - references invoices)
-- =====================================================
CREATE TABLE IF NOT EXISTS payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES crm_contacts(id) ON DELETE SET NULL,

  -- Stripe details
  stripe_payment_intent_id TEXT UNIQUE,
  stripe_charge_id TEXT,
  stripe_customer_id TEXT,

  -- Transaction details
  amount DECIMAL(10, 2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'succeeded', 'failed', 'refunded'
  payment_method TEXT, -- 'card', 'bank_transfer', 'cash', 'other'

  -- Description
  description TEXT,
  invoice_id UUID REFERENCES payment_invoices(id) ON DELETE SET NULL,

  -- Metadata
  metadata JSONB DEFAULT '{}',
  failure_reason TEXT,

  -- Timestamps
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_payment_transactions_user_id ON payment_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_contact_id ON payment_transactions(contact_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_invoice_id ON payment_transactions(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_status ON payment_transactions(status);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_stripe_intent ON payment_transactions(stripe_payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_created_at ON payment_transactions(created_at DESC);

-- RLS Policies
ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own transactions" ON payment_transactions;
CREATE POLICY "Users can view their own transactions"
  ON payment_transactions FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own transactions" ON payment_transactions;
CREATE POLICY "Users can insert their own transactions"
  ON payment_transactions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own transactions" ON payment_transactions;
CREATE POLICY "Users can update their own transactions"
  ON payment_transactions FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own transactions" ON payment_transactions;
CREATE POLICY "Users can delete their own transactions"
  ON payment_transactions FOR DELETE
  USING (auth.uid() = user_id);

-- =====================================================
-- 3. Payment Methods Table (Stripe)
-- =====================================================
CREATE TABLE IF NOT EXISTS payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Stripe details
  stripe_customer_id TEXT NOT NULL,
  stripe_payment_method_id TEXT NOT NULL UNIQUE,

  -- Payment method details
  type TEXT NOT NULL, -- 'card', 'bank_account'
  card_brand TEXT, -- 'visa', 'mastercard', 'amex', etc.
  card_last4 TEXT,
  card_exp_month INT,
  card_exp_year INT,

  -- Status
  is_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_payment_methods_user_id ON payment_methods(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_methods_stripe_customer ON payment_methods(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_payment_methods_default ON payment_methods(is_default);

-- RLS Policies
ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own payment methods" ON payment_methods;
CREATE POLICY "Users can view their own payment methods"
  ON payment_methods FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own payment methods" ON payment_methods;
CREATE POLICY "Users can insert their own payment methods"
  ON payment_methods FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own payment methods" ON payment_methods;
CREATE POLICY "Users can update their own payment methods"
  ON payment_methods FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own payment methods" ON payment_methods;
CREATE POLICY "Users can delete their own payment methods"
  ON payment_methods FOR DELETE
  USING (auth.uid() = user_id);

-- =====================================================
-- 4. Stripe Connect Accounts Table
-- =====================================================
CREATE TABLE IF NOT EXISTS stripe_connect_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,

  -- Stripe Connect details
  stripe_account_id TEXT NOT NULL UNIQUE,
  stripe_account_type TEXT DEFAULT 'express', -- 'standard', 'express', 'custom'

  -- Onboarding status
  charges_enabled BOOLEAN DEFAULT false,
  payouts_enabled BOOLEAN DEFAULT false,
  details_submitted BOOLEAN DEFAULT false,
  onboarding_completed BOOLEAN DEFAULT false,

  -- Account details
  country TEXT,
  currency TEXT DEFAULT 'USD',
  business_type TEXT, -- 'individual', 'company'

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_stripe_connect_accounts_user_id ON stripe_connect_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_stripe_connect_accounts_stripe_id ON stripe_connect_accounts(stripe_account_id);

-- RLS Policies
ALTER TABLE stripe_connect_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own Stripe account" ON stripe_connect_accounts;
CREATE POLICY "Users can view their own Stripe account"
  ON stripe_connect_accounts FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own Stripe account" ON stripe_connect_accounts;
CREATE POLICY "Users can insert their own Stripe account"
  ON stripe_connect_accounts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own Stripe account" ON stripe_connect_accounts;
CREATE POLICY "Users can update their own Stripe account"
  ON stripe_connect_accounts FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own Stripe account" ON stripe_connect_accounts;
CREATE POLICY "Users can delete their own Stripe account"
  ON stripe_connect_accounts FOR DELETE
  USING (auth.uid() = user_id);

-- =====================================================
-- 5. Updated_at Triggers
-- =====================================================
CREATE OR REPLACE FUNCTION update_payment_transactions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_payment_transactions_updated_at_trigger ON payment_transactions;
CREATE TRIGGER update_payment_transactions_updated_at_trigger
  BEFORE UPDATE ON payment_transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_payment_transactions_updated_at();

CREATE OR REPLACE FUNCTION update_payment_invoices_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_payment_invoices_updated_at_trigger ON payment_invoices;
CREATE TRIGGER update_payment_invoices_updated_at_trigger
  BEFORE UPDATE ON payment_invoices
  FOR EACH ROW
  EXECUTE FUNCTION update_payment_invoices_updated_at();

CREATE OR REPLACE FUNCTION update_stripe_connect_accounts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_stripe_connect_accounts_updated_at_trigger ON stripe_connect_accounts;
CREATE TRIGGER update_stripe_connect_accounts_updated_at_trigger
  BEFORE UPDATE ON stripe_connect_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_stripe_connect_accounts_updated_at();

-- =====================================================
-- 6. Trigger: Auto-create CRM activity when payment is received
-- =====================================================
CREATE OR REPLACE FUNCTION log_payment_activity()
RETURNS TRIGGER AS $$
DECLARE
  activity_title TEXT;
  activity_desc TEXT;
BEGIN
  -- Only log when payment status changes to succeeded
  IF NEW.status = 'succeeded' AND (OLD IS NULL OR OLD.status != 'succeeded') THEN
    activity_title := 'Payment Received: $' || NEW.amount;
    activity_desc := COALESCE(NEW.description, 'Payment processed successfully');

    -- Create activity if contact exists
    IF NEW.contact_id IS NOT NULL THEN
      INSERT INTO crm_activities (
        user_id,
        contact_id,
        activity_type,
        title,
        description,
        auto_logged,
        source_capability,
        source_entity_id,
        activity_date
      ) VALUES (
        NEW.user_id,
        NEW.contact_id,
        'payment',
        activity_title,
        activity_desc,
        true,
        'payments',
        NEW.id,
        NEW.paid_at
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS log_payment_activity_trigger ON payment_transactions;
CREATE TRIGGER log_payment_activity_trigger
  AFTER INSERT OR UPDATE OF status ON payment_transactions
  FOR EACH ROW
  EXECUTE FUNCTION log_payment_activity();

-- =====================================================
-- 7. Trigger: Auto-update invoice status when paid
-- =====================================================
CREATE OR REPLACE FUNCTION update_invoice_on_payment()
RETURNS TRIGGER AS $$
BEGIN
  -- When payment succeeds, mark invoice as paid
  IF NEW.status = 'succeeded' AND NEW.invoice_id IS NOT NULL THEN
    UPDATE payment_invoices
    SET
      status = 'paid',
      paid_at = NEW.paid_at
    WHERE id = NEW.invoice_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_invoice_on_payment_trigger ON payment_transactions;
CREATE TRIGGER update_invoice_on_payment_trigger
  AFTER INSERT OR UPDATE OF status ON payment_transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_invoice_on_payment();
