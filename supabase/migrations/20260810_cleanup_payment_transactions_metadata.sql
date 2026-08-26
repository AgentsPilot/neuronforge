-- =====================================================
-- Migration: Clean up payment_transactions metadata
--
-- This removes relational data from metadata JSONB that now exists in proper columns:
-- - booking_id → moved to payment_transactions.booking_id column
-- - service_id → already in payment_transactions.service_id column
--
-- Only true metadata should remain (source, notes, custom_fields, etc.)
--
-- IMPORTANT: Run this AFTER all application code is updated to use columns instead of metadata
-- =====================================================

-- Remove booking_id from metadata (now in proper column)
UPDATE payment_transactions
SET metadata = metadata - 'booking_id'
WHERE metadata ? 'booking_id';

-- Remove service_id from metadata (already in proper column since migration 20260809)
UPDATE payment_transactions
SET metadata = metadata - 'service_id'
WHERE metadata ? 'service_id';

-- Add comment explaining metadata cleanup
COMMENT ON COLUMN payment_transactions.metadata IS
'JSONB field for true metadata only (source, notes, campaign_id, custom_fields). Relational data (booking_id, service_id) moved to proper FK columns.';
