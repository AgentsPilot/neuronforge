-- Fix creation score ranges to start from 0 instead of 1
-- This fixes the bug where agents with 1 plugin/step/field score 0.0 (same as 0)

UPDATE ais_normalization_ranges
SET
  best_practice_min = 0
WHERE range_key = 'creation_plugins';

UPDATE ais_normalization_ranges
SET
  best_practice_min = 0
WHERE range_key = 'creation_workflow_steps';

UPDATE ais_normalization_ranges
SET
  best_practice_min = 0
WHERE range_key = 'creation_io_fields';
