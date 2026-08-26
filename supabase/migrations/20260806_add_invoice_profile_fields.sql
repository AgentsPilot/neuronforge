-- ============================================================================
-- Invoice Business Profile Fields Migration
-- Adds invoice-specific fields to business_profiles for professional invoicing
-- and Stripe invoice integration fields to payment_invoices
-- ============================================================================

-- ===========================================
-- Part 1: Business Profile Invoice Fields
-- ===========================================

-- Invoice company name (may differ from main company name)
ALTER TABLE business_profiles
ADD COLUMN IF NOT EXISTS invoice_company_name TEXT;

-- Invoice address as structured JSONB
-- Structure: { line1, line2, city, state, postal_code, country }
ALTER TABLE business_profiles
ADD COLUMN IF NOT EXISTS invoice_address JSONB DEFAULT '{}';

-- Tax identification number (VAT, EIN, etc.)
ALTER TABLE business_profiles
ADD COLUMN IF NOT EXISTS invoice_tax_id TEXT;

-- Bank details for wire transfers
ALTER TABLE business_profiles
ADD COLUMN IF NOT EXISTS invoice_bank_name TEXT;

ALTER TABLE business_profiles
ADD COLUMN IF NOT EXISTS invoice_bank_account TEXT;

ALTER TABLE business_profiles
ADD COLUMN IF NOT EXISTS invoice_bank_routing TEXT;

-- Custom payment instructions shown on invoice
ALTER TABLE business_profiles
ADD COLUMN IF NOT EXISTS invoice_payment_instructions TEXT;

-- Custom footer text for invoices
ALTER TABLE business_profiles
ADD COLUMN IF NOT EXISTS invoice_footer_text TEXT;

-- Invoice number prefix (default: INV)
ALTER TABLE business_profiles
ADD COLUMN IF NOT EXISTS invoice_number_prefix TEXT DEFAULT 'INV';

-- Logo URL for invoices (separate from website logo)
ALTER TABLE business_profiles
ADD COLUMN IF NOT EXISTS invoice_logo_url TEXT;

-- ===========================================
-- Part 2: Payment Invoices Stripe Integration
-- ===========================================

-- Stripe invoice ID for invoices created via Stripe Invoicing API
ALTER TABLE payment_invoices
ADD COLUMN IF NOT EXISTS stripe_invoice_id TEXT;

-- Stripe hosted invoice URL (where client pays)
ALTER TABLE payment_invoices
ADD COLUMN IF NOT EXISTS stripe_hosted_invoice_url TEXT;

-- Stripe invoice PDF URL
ALTER TABLE payment_invoices
ADD COLUMN IF NOT EXISTS stripe_invoice_pdf TEXT;

-- Client details (for display/PDF generation)
ALTER TABLE payment_invoices
ADD COLUMN IF NOT EXISTS client_name TEXT;

ALTER TABLE payment_invoices
ADD COLUMN IF NOT EXISTS client_email TEXT;

ALTER TABLE payment_invoices
ADD COLUMN IF NOT EXISTS client_address JSONB DEFAULT '{}';

-- Link to booking (optional - for booking-based invoices)
ALTER TABLE payment_invoices
ADD COLUMN IF NOT EXISTS booking_id UUID REFERENCES scheduling_bookings(id) ON DELETE SET NULL;

-- ===========================================
-- Part 3: Indexes
-- ===========================================

-- Index for looking up invoices by Stripe invoice ID (for webhook handling)
CREATE INDEX IF NOT EXISTS idx_payment_invoices_stripe_id
ON payment_invoices(stripe_invoice_id)
WHERE stripe_invoice_id IS NOT NULL;

-- Index for looking up invoices by booking
CREATE INDEX IF NOT EXISTS idx_payment_invoices_booking_id
ON payment_invoices(booking_id)
WHERE booking_id IS NOT NULL;

-- ===========================================
-- Part 4: Comments
-- ===========================================

COMMENT ON COLUMN business_profiles.invoice_address IS 'Structured address for invoices: {line1, line2, city, state, postal_code, country}';
COMMENT ON COLUMN business_profiles.invoice_tax_id IS 'Tax ID/VAT number displayed on invoices';
COMMENT ON COLUMN business_profiles.invoice_payment_instructions IS 'Custom payment instructions (wire transfer details, payment terms, etc.)';
COMMENT ON COLUMN business_profiles.invoice_number_prefix IS 'Prefix for invoice numbers (e.g., INV, BILL). Default: INV';

COMMENT ON COLUMN payment_invoices.stripe_invoice_id IS 'Stripe Invoice ID when created via Stripe Invoicing API';
COMMENT ON COLUMN payment_invoices.stripe_hosted_invoice_url IS 'Stripe hosted invoice page URL where client can pay';
COMMENT ON COLUMN payment_invoices.stripe_invoice_pdf IS 'Stripe-generated PDF URL for the invoice';
COMMENT ON COLUMN payment_invoices.client_address IS 'Client billing address: {line1, line2, city, state, postal_code, country}';
COMMENT ON COLUMN payment_invoices.booking_id IS 'Optional link to booking for booking-based invoices';
