-- Migration: Create or update ais_system_config table
-- This table stores system-wide configuration values for AIS and quota management

-- Create table if it doesn't exist
CREATE TABLE IF NOT EXISTS ais_system_config (
  config_key TEXT PRIMARY KEY,
  config_value TEXT NOT NULL,  -- Changed from NUMERIC to TEXT to support 'null', numbers, and other values
  description TEXT,
  category TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add updated_at column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ais_system_config'
    AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE ais_system_config ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

-- Convert config_value from NUMERIC to TEXT if needed
-- First, we need to handle the calculator_config view that depends on this column
DO $$
DECLARE
  view_definition TEXT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ais_system_config'
    AND column_name = 'config_value'
    AND data_type = 'numeric'
  ) THEN
    -- Store the view definition if it exists
    SELECT pg_get_viewdef('calculator_config', true) INTO view_definition
    FROM pg_views
    WHERE viewname = 'calculator_config';

    -- Drop the view if it exists
    DROP VIEW IF EXISTS calculator_config CASCADE;

    -- Now we can safely alter the column type
    ALTER TABLE ais_system_config ALTER COLUMN config_value TYPE TEXT USING config_value::TEXT;

    -- Recreate the view if it existed
    IF view_definition IS NOT NULL THEN
      EXECUTE 'CREATE OR REPLACE VIEW calculator_config AS ' || view_definition;
    END IF;
  END IF;
END $$;

-- Add category column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ais_system_config'
    AND column_name = 'category'
  ) THEN
    ALTER TABLE ais_system_config ADD COLUMN category TEXT;
  END IF;
END $$;

-- Create index on category for faster lookups
CREATE INDEX IF NOT EXISTS idx_ais_system_config_category ON ais_system_config(category);

-- Create index on config_key pattern matching (for LIKE queries)
CREATE INDEX IF NOT EXISTS idx_ais_system_config_key_pattern ON ais_system_config(config_key text_pattern_ops);
