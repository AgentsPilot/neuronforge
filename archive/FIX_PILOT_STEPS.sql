-- SQL to fix the Expense Processing Agent workflow in pilot_steps table
-- Agent ID: ee7f1270-6ba4-4787-a5ae-55e47ecfb155

-- First, let's see the current pilot_steps for this agent
SELECT
  id,
  agent_id,
  step_order,
  step_definition->>'id' as step_id,
  step_definition->>'name' as step_name,
  step_definition->>'type' as step_type
FROM pilot_steps
WHERE agent_id = 'ee7f1270-6ba4-4787-a5ae-55e47ecfb155'
ORDER BY step_order;

-- FIX STEP 2: Update conditional field reference
UPDATE pilot_steps
SET step_definition = jsonb_set(
  step_definition,
  '{condition,field}',
  '"step1.data.emails.length"'
)
WHERE agent_id = 'ee7f1270-6ba4-4787-a5ae-55e47ecfb155'
  AND step_definition->>'id' = 'step2';

-- FIX STEP 3: Update scatter input AND remove outputKey
UPDATE pilot_steps
SET step_definition = jsonb_set(
  jsonb_set(
    step_definition,
    '{scatter,input}',
    '"{{step1.data.emails}}"'
  ),
  '{gather}',
  '{"operation": "collect"}'::jsonb
)
WHERE agent_id = 'ee7f1270-6ba4-4787-a5ae-55e47ecfb155'
  AND step_definition->>'id' = 'step3';

-- FIX STEP 3 NESTED: Update extract_attachments.data reference
-- Note: This assumes the nested step structure, adjust if needed
UPDATE pilot_steps
SET step_definition = jsonb_set(
  step_definition,
  '{scatter,steps,1,input}',
  '"{{extract_attachments.data}}"'
)
WHERE agent_id = 'ee7f1270-6ba4-4787-a5ae-55e47ecfb155'
  AND step_definition->>'id' = 'step3'
  AND step_definition->'scatter'->'steps'->1->>'id' = 'process_attachments';

-- FIX STEP 4: Update transform input
UPDATE pilot_steps
SET step_definition = jsonb_set(
  step_definition,
  '{input}',
  '"{{step3.data}}"'
)
WHERE agent_id = 'ee7f1270-6ba4-4787-a5ae-55e47ecfb155'
  AND step_definition->>'id' = 'step4';

-- FIX STEP 5: Update conditional field reference
UPDATE pilot_steps
SET step_definition = jsonb_set(
  step_definition,
  '{condition,field}',
  '"step4.data.length"'
)
WHERE agent_id = 'ee7f1270-6ba4-4787-a5ae-55e47ecfb155'
  AND step_definition->>'id' = 'step5';

-- FIX STEP 6: Update transform input
UPDATE pilot_steps
SET step_definition = jsonb_set(
  step_definition,
  '{input}',
  '"{{step4.data}}"'
)
WHERE agent_id = 'ee7f1270-6ba4-4787-a5ae-55e47ecfb155'
  AND step_definition->>'id' = 'step6';

-- FIX STEP 7: Update sheets values reference
UPDATE pilot_steps
SET step_definition = jsonb_set(
  step_definition,
  '{params,values}',
  '"{{step6.data}}"'
)
WHERE agent_id = 'ee7f1270-6ba4-4787-a5ae-55e47ecfb155'
  AND step_definition->>'id' = 'step7';

-- FIX STEP 8: Update AI processing input with correct variable references
UPDATE pilot_steps
SET step_definition = jsonb_set(
  jsonb_set(
    step_definition,
    '{input}',
    '"Emails found: {{step1.data.total_found}}, Valid expenses processed: {{step4.data.length}}, Sheets updated: {{step7.data}}"'
  ),
  '{executeIf,field}',
  '"step1.data.total_found"'
)
WHERE agent_id = 'ee7f1270-6ba4-4787-a5ae-55e47ecfb155'
  AND step_definition->>'id' = 'step8';

-- FIX STEP 9: Update email subject reference
UPDATE pilot_steps
SET step_definition = jsonb_set(
  step_definition,
  '{params,content,subject}',
  '"Expense Processing Complete - {{step4.data.length}} expenses processed"'
)
WHERE agent_id = 'ee7f1270-6ba4-4787-a5ae-55e47ecfb155'
  AND step_definition->>'id' = 'step9';

-- VERIFY ALL FIXES
SELECT
  step_definition->>'id' as step_id,
  step_definition->>'name' as step_name,
  CASE
    WHEN step_definition->>'id' = 'step2' THEN step_definition->'condition'->>'field'
    WHEN step_definition->>'id' = 'step3' THEN step_definition->'scatter'->>'input'
    WHEN step_definition->>'id' = 'step4' THEN step_definition->>'input'
    WHEN step_definition->>'id' = 'step5' THEN step_definition->'condition'->>'field'
    WHEN step_definition->>'id' = 'step6' THEN step_definition->>'input'
    WHEN step_definition->>'id' = 'step7' THEN step_definition->'params'->>'values'
    WHEN step_definition->>'id' = 'step8' THEN step_definition->>'input'
    WHEN step_definition->>'id' = 'step9' THEN step_definition->'params'->'content'->>'subject'
  END as critical_field,
  updated_at
FROM pilot_steps
WHERE agent_id = 'ee7f1270-6ba4-4787-a5ae-55e47ecfb155'
ORDER BY step_order;

-- Expected results after fixes:
-- step2: step1.data.emails.length
-- step3: {{step1.data.emails}}
-- step4: {{step3.data}}
-- step5: step4.data.length
-- step6: {{step4.data}}
-- step7: {{step6.data}}
-- step8: Emails found: {{step1.data.total_found}}, Valid expenses processed: {{step4.data.length}}...
-- step9: Expense Processing Complete - {{step4.data.length}} expenses processed
