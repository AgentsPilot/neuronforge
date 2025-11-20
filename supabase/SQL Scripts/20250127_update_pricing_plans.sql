-- =====================================================
-- MIGRATION: Update Pricing Plans per Specification
-- Description: Updates plans to match PRICING_SYSTEM_IMPLEMENTATION_PLAN.md
-- Version: 1.0
-- Date: 2025-01-27
-- =====================================================

-- Upsert Explorer Plan ($12/month, 25K credits)
INSERT INTO public.plans (
  plan_key,
  plan_name,
  display_name,
  description,
  price_usd,
  price_annual_usd,
  monthly_credits,
  max_agents,
  max_executions_per_day,
  features,
  is_active
) VALUES (
  'explorer',
  'Explorer',
  'Explorer',
  'Perfect for individuals and small projects',
  12.00,
  120.00,
  25000,
  3,
  500,
  '["25,000 Pilot Credits/month", "3 Agents", "10 Plugin Integrations", "5GB Storage", "Community Support", "Basic Analytics"]'::jsonb,
  true
)
ON CONFLICT (plan_key) DO UPDATE SET
  plan_name = EXCLUDED.plan_name,
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  price_usd = EXCLUDED.price_usd,
  price_annual_usd = EXCLUDED.price_annual_usd,
  monthly_credits = EXCLUDED.monthly_credits,
  max_agents = EXCLUDED.max_agents,
  max_executions_per_day = EXCLUDED.max_executions_per_day,
  features = EXCLUDED.features,
  is_active = EXCLUDED.is_active;

-- Upsert Navigator Plan ($20/month, 120K credits)
INSERT INTO public.plans (
  plan_key,
  plan_name,
  display_name,
  description,
  price_usd,
  price_annual_usd,
  monthly_credits,
  max_agents,
  max_executions_per_day,
  features,
  is_active
) VALUES (
  'navigator',
  'Navigator',
  'Navigator',
  'Ideal for growing teams and businesses',
  20.00,
  200.00,
  120000,
  10,
  2000,
  '["120,000 Pilot Credits/month", "10 Agents", "25 Plugin Integrations", "30GB Storage", "Priority Email Support", "Advanced Analytics", "Credit Rollover"]'::jsonb,
  true
)
ON CONFLICT (plan_key) DO UPDATE SET
  plan_name = EXCLUDED.plan_name,
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  price_usd = EXCLUDED.price_usd,
  price_annual_usd = EXCLUDED.price_annual_usd,
  monthly_credits = EXCLUDED.monthly_credits,
  max_agents = EXCLUDED.max_agents,
  max_executions_per_day = EXCLUDED.max_executions_per_day,
  features = EXCLUDED.features,
  is_active = EXCLUDED.is_active;

-- Upsert Commander Plan ($35/month, 250K credits)
INSERT INTO public.plans (
  plan_key,
  plan_name,
  display_name,
  description,
  price_usd,
  price_annual_usd,
  monthly_credits,
  max_agents,
  max_executions_per_day,
  features,
  is_active
) VALUES (
  'commander',
  'Commander',
  'Commander',
  'For power users and large organizations',
  35.00,
  350.00,
  250000,
  20,
  5000,
  '["250,000 Pilot Credits/month", "20 Agents", "Unlimited Plugin Integrations", "80GB Storage", "Priority Support", "Advanced Analytics", "Credit Rollover", "Custom Integrations"]'::jsonb,
  true
)
ON CONFLICT (plan_key) DO UPDATE SET
  plan_name = EXCLUDED.plan_name,
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  price_usd = EXCLUDED.price_usd,
  price_annual_usd = EXCLUDED.price_annual_usd,
  monthly_credits = EXCLUDED.monthly_credits,
  max_agents = EXCLUDED.max_agents,
  max_executions_per_day = EXCLUDED.max_executions_per_day,
  features = EXCLUDED.features,
  is_active = EXCLUDED.is_active;

-- Upsert Boost Packs per pricing plan
INSERT INTO public.boost_packs (
  pack_key,
  pack_name,
  display_name,
  description,
  credits_amount,
  bonus_credits,
  price_usd,
  badge_text,
  is_active
) VALUES
(
  'boost_25k',
  '25K Boost Pack',
  '25K Boost',
  'Quick refill for extra tasks',
  25000,
  0,
  8.00,
  NULL,
  true
),
(
  'boost_100k',
  '100K Boost Pack',
  '100K Boost',
  'Best value for heavy users',
  100000,
  5000,
  20.00,
  'BEST VALUE',
  true
),
(
  'boost_250k',
  '250K Boost Pack',
  '250K Boost',
  'Maximum power boost',
  250000,
  15000,
  40.00,
  'MOST POPULAR',
  true
)
ON CONFLICT (pack_key) DO UPDATE SET
  pack_name = EXCLUDED.pack_name,
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  credits_amount = EXCLUDED.credits_amount,
  bonus_credits = EXCLUDED.bonus_credits,
  price_usd = EXCLUDED.price_usd,
  badge_text = EXCLUDED.badge_text,
  is_active = EXCLUDED.is_active;

COMMENT ON TABLE public.plans IS 'Subscription pricing plans with Pilot Credits allocation per PRICING_SYSTEM_IMPLEMENTATION_PLAN.md';
COMMENT ON TABLE public.boost_packs IS 'One-time Pilot Credits purchase packs per PRICING_SYSTEM_IMPLEMENTATION_PLAN.md';
