-- Migration: Add bonus_percentage column to boost_packs table
-- This stores the percentage used to calculate bonus_credits
-- Example: bonus_percentage = 10 means 10% bonus
-- Run this in Supabase SQL Editor

-- Step 1: Add the column
ALTER TABLE public.boost_packs
ADD COLUMN IF NOT EXISTS bonus_percentage NUMERIC(5,2) NOT NULL DEFAULT 0;

-- Step 2: Update existing records to calculate their bonus_percentage from existing bonus_credits
-- Formula: bonus_percentage = (bonus_credits / credits_amount) * 100
UPDATE public.boost_packs
SET bonus_percentage = CASE
  WHEN credits_amount > 0 AND bonus_credits > 0
  THEN ROUND((bonus_credits::numeric / credits_amount::numeric) * 100, 2)
  ELSE 0
END
WHERE credits_amount > 0;

-- Step 3: Add comment to explain the column
COMMENT ON COLUMN public.boost_packs.bonus_percentage IS 'Percentage bonus applied to base credits (e.g., 10 for 10% bonus). Used by admin UI to calculate bonus_credits.';

-- Step 4: Verify the migration
SELECT
  pack_key,
  pack_name,
  price_usd,
  credits_amount,
  bonus_credits,
  bonus_percentage,
  CASE
    WHEN credits_amount > 0
    THEN CONCAT(ROUND((bonus_credits::numeric / credits_amount::numeric) * 100, 2), '%')
    ELSE '0%'
  END as calculated_percentage_check
FROM public.boost_packs
ORDER BY price_usd;
