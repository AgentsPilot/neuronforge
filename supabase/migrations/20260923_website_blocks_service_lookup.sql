-- Make "which pages use this service?" a cheap question.
--
-- ---------------------------------------------------------------------------
-- WHY
--
-- Removing a service now has to report what it would break: a landing page
-- exists to sell one service, so when that service goes the page has to come
-- down with it. Answering that means finding every block that points at a
-- service id.
--
-- There is no foreign key to follow. The landing-page generator stamps the id
-- into JSONB in three different shapes, because three different blocks need it
-- in three different ways:
--
--   content->>'serviceId'             pricing and CTA blocks
--   capability_config->>'serviceId'   blocks configured through the editor
--   content->'services'               booking widget, as a one-element array
--
-- Without these indexes that lookup is a sequential scan of every block owned
-- by every business on the platform, run in front of an interactive
-- confirmation dialog. It is fast today because the table is small; it gets
-- slower every time anyone publishes anything.
--
-- ---------------------------------------------------------------------------
-- WHY THREE INDEXES AND NOT ONE
--
-- The two `->>` lookups are equality on an extracted text value, which a plain
-- B-tree expression index serves exactly. The third is a containment test
-- (`content->'services' @> '["<id>"]'`), which B-tree cannot answer at all —
-- that one needs GIN.
--
-- `jsonb_path_ops` rather than the default operator class: it only supports
-- containment, which is the only thing asked of it here, and in exchange it is
-- substantially smaller and faster than the default.
--
-- All three are partial, skipping rows where the key is absent. Most blocks on
-- the platform — headers, heroes, testimonials, FAQs — have no service id at
-- all, and there is no reason to carry them in an index built to find the ones
-- that do.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_website_blocks_content_service_id
  ON website_blocks ((content->>'serviceId'))
  WHERE content ? 'serviceId';

CREATE INDEX IF NOT EXISTS idx_website_blocks_capability_service_id
  ON website_blocks ((capability_config->>'serviceId'))
  WHERE capability_config ? 'serviceId';

CREATE INDEX IF NOT EXISTS idx_website_blocks_content_services_gin
  ON website_blocks USING gin ((content->'services') jsonb_path_ops)
  WHERE content ? 'services';

COMMENT ON INDEX idx_website_blocks_content_service_id IS
  'Finds pricing/CTA blocks selling a given service, for the pre-delete reference check in lib/services/ServiceReferenceService.ts';
COMMENT ON INDEX idx_website_blocks_capability_service_id IS
  'Same lookup for blocks that carry the service id in capability_config rather than content';
COMMENT ON INDEX idx_website_blocks_content_services_gin IS
  'Containment lookup for booking_widget blocks, whose service id lives inside a content.services array';

-- Smart links are scoped to services through metadata.serviceIds, and the same
-- delete check asks the same question of them with a containment test.
CREATE INDEX IF NOT EXISTS idx_smart_links_metadata_gin
  ON smart_links USING gin (metadata jsonb_path_ops)
  WHERE metadata IS NOT NULL;

COMMENT ON INDEX idx_smart_links_metadata_gin IS
  'Finds smart links pinned to a given service via metadata.serviceIds';
