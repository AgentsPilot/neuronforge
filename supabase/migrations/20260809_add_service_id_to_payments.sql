-- Add service_id column to payment tables and total_amount to bookings
-- This enables the "Revenue by Service" feature in the cash flow dashboard

-- =====================================================
-- 1. Add service_id to payment_invoices
-- =====================================================
ALTER TABLE payment_invoices
ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES scheduling_services(id) ON DELETE SET NULL;

-- Add index for efficient querying
CREATE INDEX IF NOT EXISTS idx_payment_invoices_service_id ON payment_invoices(service_id);

COMMENT ON COLUMN payment_invoices.service_id IS 'References the service this invoice is for (optional)';

-- =====================================================
-- 2. Add service_id to payment_transactions
-- =====================================================
ALTER TABLE payment_transactions
ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES scheduling_services(id) ON DELETE SET NULL;

-- Add index for efficient querying
CREATE INDEX IF NOT EXISTS idx_payment_transactions_service_id ON payment_transactions(service_id);

COMMENT ON COLUMN payment_transactions.service_id IS 'References the service this payment is for (optional)';

-- =====================================================
-- 3. Add total_amount to scheduling_bookings
-- =====================================================
ALTER TABLE scheduling_bookings
ADD COLUMN IF NOT EXISTS total_amount DECIMAL(10, 2);

COMMENT ON COLUMN scheduling_bookings.total_amount IS 'Total amount for this booking (copied from service price or custom amount)';

-- Backfill total_amount from service prices for existing completed bookings
UPDATE scheduling_bookings sb
SET total_amount = ss.price
FROM scheduling_services ss
WHERE sb.service_id = ss.id
  AND sb.total_amount IS NULL
  AND sb.status = 'completed';
