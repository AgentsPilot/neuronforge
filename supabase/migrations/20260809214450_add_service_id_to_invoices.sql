-- Add service_id foreign key to payment_invoices (if not exists)
-- This links invoices to the specific service they're for

ALTER TABLE payment_invoices
ADD COLUMN IF NOT EXISTS service_id UUID;

-- Add foreign key constraint
ALTER TABLE payment_invoices
ADD CONSTRAINT fk_payment_invoices_service
FOREIGN KEY (service_id) REFERENCES scheduling_services(id)
ON DELETE SET NULL;

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_payment_invoices_service_id
ON payment_invoices(service_id);

-- Comment
COMMENT ON COLUMN payment_invoices.service_id IS 'Optional reference to the service this invoice is for (links to scheduling_services)';
