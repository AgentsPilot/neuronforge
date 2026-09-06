-- Business OS — expose lead attribution as queryable columns
-- Last Updated: 2026-08-26
--
-- WHY THIS EXISTS
--
-- Every lead already carries its attribution. `lib/utils/attribution.ts` records
-- the referrer and any UTM parameters into `crm_contacts.source_metadata` on the
-- website contact form, the intake form, booking creation, and the /go/[code]
-- smart-link redirect. That has been running since the conversion layer shipped.
--
-- Nothing has ever read it. `ConvSourceUnderperformDetector` groups on the flat
-- `crm_contacts.source` text column instead, and the reports page has no notion
-- of a channel at all. The data to answer "which channel brings me clients" is
-- sitting in the database, unqueried.
--
-- WHY GENERATED COLUMNS RATHER THAN READING THE JSONB
--
-- The BizQL compiler (lib/business-os/bizql/compiler.ts) has no JSONB path
-- operator. Teaching it one means changing the compiler, the plan validator and
-- the planner prompt. Generated columns cost none of that: PostgREST exposes
-- them as ordinary columns, so scripts/generate-business-catalog.ts picks them
-- up, they can be declared in SEMANTIC_CATALOG, and the chat can answer
-- "how many leads came from Instagram" through the existing compute/group_by
-- path with no new code.
--
-- They are also free of write-path risk: `source_metadata` remains the single
-- source of truth, every writer is untouched, and existing rows backfill
-- automatically — so this lights up with full history the moment it is applied.

-- =============================================
-- 1. ATTRIBUTION COLUMNS
-- =============================================

ALTER TABLE crm_contacts
  ADD COLUMN IF NOT EXISTS referrer_domain TEXT
    GENERATED ALWAYS AS (source_metadata->>'referrer_domain') STORED,
  ADD COLUMN IF NOT EXISTS utm_source TEXT
    GENERATED ALWAYS AS (source_metadata->>'utm_source') STORED,
  ADD COLUMN IF NOT EXISTS utm_medium TEXT
    GENERATED ALWAYS AS (source_metadata->>'utm_medium') STORED,
  ADD COLUMN IF NOT EXISTS utm_campaign TEXT
    GENERATED ALWAYS AS (source_metadata->>'utm_campaign') STORED;

COMMENT ON COLUMN crm_contacts.referrer_domain IS
  'Host the lead arrived from (e.g. l.instagram.com), derived from source_metadata. Primary attribution signal — requires no tagging by the user.';
COMMENT ON COLUMN crm_contacts.utm_source IS
  'utm_source from source_metadata. Present only on tagged links; referrer_domain is the fallback.';
COMMENT ON COLUMN crm_contacts.utm_medium IS
  'utm_medium from source_metadata.';
COMMENT ON COLUMN crm_contacts.utm_campaign IS
  'utm_campaign from source_metadata.';

-- =============================================
-- 2. INDEXES
-- =============================================
-- Grouping leads by channel is always scoped to one user, so the user_id
-- prefix matters more than the attribute alone.

CREATE INDEX IF NOT EXISTS idx_contacts_user_referrer_domain
  ON crm_contacts (user_id, referrer_domain)
  WHERE referrer_domain IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_user_utm_source
  ON crm_contacts (user_id, utm_source)
  WHERE utm_source IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_user_utm_campaign
  ON crm_contacts (user_id, utm_campaign)
  WHERE utm_campaign IS NOT NULL;

-- Superseded by idx_contacts_user_utm_source: the expression index could not be
-- used for the user-scoped grouping this feature performs, and the plain column
-- now indexes more cheaply than the expression.
DROP INDEX IF EXISTS idx_contacts_utm_source;

-- Note: idx_contacts_source_metadata (GIN) is deliberately kept. It still serves
-- containment queries against the parts of source_metadata that are not promoted
-- to columns — session_id, smart_link_id, device_type, referrer_url.
