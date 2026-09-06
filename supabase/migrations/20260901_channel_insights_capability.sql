-- Connecting Facebook, Instagram, Google Analytics and a Google listing is its
-- own capability, granted only by the person asking for it.
--
-- The onboarding chat already asks — "Connect Facebook, Instagram or Google —
-- see where clients come from" — and the answer was being recorded as the broad
-- `insights` capability. But `insights` is also granted for seeing 5+ clients a
-- week, for a data-analysis goal, and by one pain-point mapping. So it could not
-- answer the only question the channels card needs answered: did this person ask
-- for their accounts to be connected?
--
-- Gating the card on `insights` showed it to people who never asked. Gating it
-- on account age — its previous behaviour — showed it to everyone eventually and
-- to nobody in their first four days, which is exactly when somebody who HAS
-- just asked for it goes looking.

INSERT INTO capabilities (
  capability_key,
  name_en, name_es, name_he,
  description_en, description_es, description_he,
  category,
  icon,
  color,
  is_core,
  verticals
) VALUES (
  'channel_insights',
  'Channel Insights', 'Información de Canales', 'תובנות ערוצים',
  'Connect Facebook, Instagram, Google Analytics and your Google listing to see where clients come from',
  'Conecta Facebook, Instagram, Google Analytics y tu ficha de Google para ver de dónde vienen tus clientes',
  'חברו פייסבוק, אינסטגרם, גוגל אנליטיקס והרישום בגוגל כדי לראות מאיפה מגיעים הלקוחות',
  'system',
  'Share2',
  '#4F6EF7',
  false, -- Never core: it is only ever switched on by asking for it.
  '{}'
) ON CONFLICT (capability_key) DO NOTHING;

-- Backfill: anyone who has already connected a channel demonstrably wanted this,
-- whatever they said during onboarding — and several of them predate the
-- question being asked at all. Taking the card away from them would be a
-- regression dressed up as a fix.
--
-- Nobody else is granted it. An account that never connected anything and never
-- asked simply does not have it, which is the point.
INSERT INTO user_capabilities (user_id, capability_id, is_active, activation_source)
SELECT DISTINCT cc.user_id, c.id, true, 'backfill'
FROM channel_connections cc
CROSS JOIN capabilities c
WHERE c.capability_key = 'channel_insights'
  AND NOT EXISTS (
    SELECT 1 FROM user_capabilities uc
    WHERE uc.user_id = cc.user_id AND uc.capability_id = c.id
  );

-- Second backfill: people who ticked the box before this capability existed.
--
-- Their answer was recorded as the broad `insights` capability, and the reason
-- string that came with it is the only trace of WHY. `capability_reasons` is
-- stored verbatim in business_profiles.extracted_data, so the Q4 wording
-- identifies them exactly.
--
-- Known to under-count, and deliberately not widened: `addCapability` keeps the
-- FIRST reason given, and a pain-point mapping can grant `insights` earlier in
-- the same computation. Somebody who both had that goal and ticked the box
-- carries the goal's reason instead, and is missed here. Matching on the
-- capability alone would be the alternative, and it would grant channels to
-- every account seeing five clients a week — the exact over-showing this
-- migration exists to stop. A miss can be corrected by asking for it; a wrong
-- grant is the platform pushing an integration at someone who declined it.
INSERT INTO user_capabilities (user_id, capability_id, is_active, activation_source)
SELECT DISTINCT bp.user_id, c.id, true, 'backfill'
FROM business_profiles bp
CROSS JOIN capabilities c
WHERE c.capability_key = 'channel_insights'
  AND bp.extracted_data -> 'capability_reasons' ->> 'insights'
      = 'You want to see where your clients come from'
  AND NOT EXISTS (
    SELECT 1 FROM user_capabilities uc
    WHERE uc.user_id = bp.user_id AND uc.capability_id = c.id
  );
