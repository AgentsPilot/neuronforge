-- Add metadata column to smart_links for storing configuration
-- This enables editing smart links by preserving the original wizard settings

ALTER TABLE smart_links
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Add comment explaining the metadata structure
COMMENT ON COLUMN smart_links.metadata IS 'Stores smart link configuration: {
  "journeyType": "contact-only" | "full",
  "serviceIds": string[],
  "flow": string[],
  "destinationType": "form" | "booking"
}';

-- Create index for efficient querying by journey type
CREATE INDEX IF NOT EXISTS idx_smart_links_metadata_journey_type
ON smart_links ((metadata->>'journeyType'));
