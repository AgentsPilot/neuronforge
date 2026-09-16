-- Monthly AI allowance, in dollars, for the credits card on the dashboard.
--
-- ONE parameter. The card needs a total to count down from, and the dollar
-- figure is the one a human actually decides — "ten dollars a month per user"
-- is a business call; "20,833 Pilot Credits" is arithmetic. So the dollars are
-- stored and the credits are derived at read time from `pilot_credit_cost_usd`,
-- which already lives in this table and already drives Stripe billing. Storing
-- the credit figure instead would fork the two the first time the credit price
-- moves, and the card would quietly bill against a stale rate.
--
-- At today's $0.00048 per credit, $10 is 20,833 Pilot Credits.
--
-- `ais_system_config` is key/value — `config_key` primary key, `config_value`
-- TEXT — so the value is written as text and parsed by the reader, exactly as
-- `tokens_per_pilot_credit` and `pilot_credit_cost_usd` already are.

INSERT INTO ais_system_config (config_key, config_value, description, category)
VALUES (
  'monthly_ai_allowance_usd',
  '10',
  'Monthly AI allowance per user in USD. Converted to Pilot Credits at read time using pilot_credit_cost_usd; drives the depleting ring on the Business OS credits card. Set to 0 to show consumption with no ceiling.',
  'billing'
)
ON CONFLICT (config_key) DO NOTHING;
