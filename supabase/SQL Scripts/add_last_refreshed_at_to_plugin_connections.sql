-- Add last_refreshed_at column to plugin_connections table for rate limiting token refreshes
-- This column tracks when a token was last refreshed to prevent duplicate refresh attempts

ALTER TABLE plugin_connections
ADD COLUMN IF NOT EXISTS last_refreshed_at TIMESTAMPTZ;

-- Add comment to explain the column's purpose
COMMENT ON COLUMN plugin_connections.last_refreshed_at IS 'Timestamp of the last token refresh, used for rate limiting to prevent excessive refresh attempts';

-- Create an index for better query performance when checking recent refreshes
CREATE INDEX IF NOT EXISTS idx_plugin_connections_last_refreshed_at
ON plugin_connections(user_id, plugin_key, last_refreshed_at)
WHERE status = 'active';
