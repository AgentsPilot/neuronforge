-- Migration to add user-friendly labels to existing input_schema fields
-- This updates all agents that have input_schema without labels

DO $$
DECLARE
  agent_record RECORD;
  updated_schema JSONB;
  field JSONB;
  field_name TEXT;
  field_label TEXT;
BEGIN
  -- Loop through all agents that have input_schema
  FOR agent_record IN
    SELECT id, agent_name, input_schema
    FROM agents
    WHERE input_schema IS NOT NULL AND input_schema != '[]'::jsonb
  LOOP
    updated_schema := '[]'::jsonb;

    -- Process each field in the input_schema
    FOR field IN SELECT * FROM jsonb_array_elements(agent_record.input_schema)
    LOOP
      field_name := field->>'name';

      -- Generate user-friendly label if it doesn't exist
      IF field->>'label' IS NULL THEN
        -- Apply label conversion rules
        field_label := CASE
          -- Common ID fields
          WHEN field_name = 'spreadsheet_id' THEN 'Spreadsheet ID'
          WHEN field_name = 'database_id' THEN 'Database ID'
          WHEN field_name = 'folder_id' THEN 'Folder ID'
          WHEN field_name = 'file_id' THEN 'File ID'
          WHEN field_name = 'workspace_id' THEN 'Workspace ID'
          WHEN field_name = 'channel_id' THEN 'Channel ID'
          WHEN field_name = 'page_id' THEN 'Page ID'
          WHEN field_name = 'document_id' THEN 'Document ID'

          -- Email fields
          WHEN field_name = 'recipient_email' THEN 'Recipient Email'
          WHEN field_name = 'sender_email' THEN 'Sender Email'

          -- Google Sheets fields
          WHEN field_name = 'range' THEN 'Cell Range'
          WHEN field_name = 'sheet_name' THEN 'Sheet Name'

          -- Common fields
          WHEN field_name = 'file_name' THEN 'File Name'
          WHEN field_name = 'query' THEN 'Search Query'
          WHEN field_name = 'subject' THEN 'Email Subject'
          WHEN field_name = 'message' THEN 'Message'
          WHEN field_name = 'topic' THEN 'Topic'

          -- Default: Title Case with proper ID handling
          ELSE
            INITCAP(
              REGEXP_REPLACE(
                REGEXP_REPLACE(field_name, '_id$', ' ID', 'i'),
                '[_-]', ' ', 'g'
              )
            )
        END;

        -- Add label to the field
        field := jsonb_set(field, '{label}', to_jsonb(field_label));
      END IF;

      -- Add updated field to the schema
      updated_schema := updated_schema || jsonb_build_array(field);
    END LOOP;

    -- Update the agent with the new schema
    UPDATE agents
    SET input_schema = updated_schema
    WHERE id = agent_record.id;

    RAISE NOTICE 'Updated agent: % (%) - % fields updated',
      agent_record.agent_name,
      agent_record.id,
      jsonb_array_length(updated_schema);
  END LOOP;
END $$;
