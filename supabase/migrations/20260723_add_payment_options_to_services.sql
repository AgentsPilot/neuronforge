-- Add payment options to scheduling_services
-- Allows defining payment type (full or installments) directly on the service

-- Payment type: 'full' (single payment) or 'installments' (multiple payments)
ALTER TABLE scheduling_services
ADD COLUMN IF NOT EXISTS payment_type TEXT DEFAULT 'full';

-- Number of installments (only used when payment_type = 'installments')
ALTER TABLE scheduling_services
ADD COLUMN IF NOT EXISTS installment_count INTEGER DEFAULT 1;

-- Frequency of installment payments
-- 'weekly', 'biweekly', 'monthly', 'quarterly'
ALTER TABLE scheduling_services
ADD COLUMN IF NOT EXISTS installment_frequency TEXT DEFAULT 'monthly';

-- When the first payment is due
-- 'on_booking' = payment due immediately when booking is created
-- 'days_after' = payment due X days after booking date
ALTER TABLE scheduling_services
ADD COLUMN IF NOT EXISTS first_payment_due TEXT DEFAULT 'on_booking';

-- Number of days after booking for first payment (only used when first_payment_due = 'days_after')
ALTER TABLE scheduling_services
ADD COLUMN IF NOT EXISTS first_payment_days INTEGER DEFAULT 0;

-- Add constraint for payment_type
ALTER TABLE scheduling_services
ADD CONSTRAINT check_payment_type
CHECK (payment_type IN ('full', 'installments'));

-- Add constraint for installment_frequency
ALTER TABLE scheduling_services
ADD CONSTRAINT check_installment_frequency
CHECK (installment_frequency IN ('weekly', 'biweekly', 'monthly', 'quarterly'));

-- Add constraint for first_payment_due
ALTER TABLE scheduling_services
ADD CONSTRAINT check_first_payment_due
CHECK (first_payment_due IN ('on_booking', 'days_after'));

-- Add constraint for installment_count (1-24 range)
ALTER TABLE scheduling_services
ADD CONSTRAINT check_installment_count
CHECK (installment_count >= 1 AND installment_count <= 24);

-- Add constraint for first_payment_days (0-365 range)
ALTER TABLE scheduling_services
ADD CONSTRAINT check_first_payment_days
CHECK (first_payment_days >= 0 AND first_payment_days <= 365);
