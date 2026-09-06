-- =====================================================
-- Migration: Add booking_id column to payment_transactions
--
-- This adds a proper foreign key column for booking_id instead of storing
-- it in the metadata JSONB field. This enables:
-- 1. Efficient queries by booking_id (indexed)
-- 2. Proper foreign key constraints
-- 3. Better data integrity
--
-- Metadata should only contain true metadata (source, notes, custom fields),
-- not relational data like booking_id or service_id.
-- =====================================================

-- Add booking_id column as foreign key to scheduling_bookings
ALTER TABLE payment_transactions
ADD COLUMN IF NOT EXISTS booking_id UUID REFERENCES scheduling_bookings(id) ON DELETE SET NULL;

-- Backfill booking_id from metadata for existing records
UPDATE payment_transactions
SET booking_id = (metadata->>'booking_id')::uuid
WHERE metadata->>'booking_id' IS NOT NULL
  AND booking_id IS NULL;

-- Create index for efficient queries by booking_id
CREATE INDEX IF NOT EXISTS idx_payment_transactions_booking_id
ON payment_transactions(booking_id);

-- Add comment for documentation
COMMENT ON COLUMN payment_transactions.booking_id IS
'Foreign key to scheduling_bookings - moved from metadata JSONB to proper column for better performance and data integrity';

-- Note: We keep booking_id in metadata for backward compatibility with existing code
-- Future migration can clean up metadata after all code is updated to use the column
