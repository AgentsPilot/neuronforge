-- Add data_schema column to agents table
-- V6 Workflow Data Schema: stores field-level type declarations for workflow data flow
-- See docs/v6/V6_WORKFLOW_DATA_SCHEMA_DESIGN.md for details

ALTER TABLE agents ADD COLUMN IF NOT EXISTS data_schema JSONB DEFAULT NULL;

COMMENT ON COLUMN agents.data_schema IS 'V6 Workflow Data Schema — centralized field-level type declarations for all data flowing through the workflow. Contains slots with schemas, scopes, and producer/consumer tracking.';
