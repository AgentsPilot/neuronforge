-- Migration: Agent Generation Configuration
-- Created: 2026-02-12
-- Description: Add configuration settings for Agent Generation (V6) pipeline LLM models

-- Insert default configuration for agent generation phases
INSERT INTO system_settings_config (key, value, category, description, created_at, updated_at)
VALUES
  -- Phase 0: Requirements Extraction
  ('agent_generation_phase_requirements_model', '"gpt-4o-mini"', 'agent_generation', 'LLM model for requirements extraction phase', NOW(), NOW()),
  ('agent_generation_phase_requirements_temperature', '0.0', 'agent_generation', 'Temperature for requirements extraction (0.0 = deterministic)', NOW(), NOW()),

  -- Phase 1: Semantic Planning
  ('agent_generation_phase_semantic_model', '"claude-opus-4-6"', 'agent_generation', 'LLM model for semantic planning phase', NOW(), NOW()),
  ('agent_generation_phase_semantic_temperature', '0.3', 'agent_generation', 'Temperature for semantic planning (higher for reasoning)', NOW(), NOW()),

  -- Phase 3: IR Formalization
  ('agent_generation_phase_formalization_model', '"claude-opus-4-6"', 'agent_generation', 'LLM model for IR formalization phase', NOW(), NOW()),
  ('agent_generation_phase_formalization_temperature', '0.0', 'agent_generation', 'Temperature for IR formalization (0.0 = mechanical precision)', NOW(), NOW())

-- Handle conflicts (if settings already exist, keep existing values)
ON CONFLICT (key) DO NOTHING;

-- Add comment
COMMENT ON TABLE system_settings_config IS 'System-wide configuration settings including agent generation pipeline models';
