// API endpoint to add labels to existing input_schema fields
// Run once: POST /api/admin/migrate-labels

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Label conversion map
const LABEL_MAP: Record<string, string> = {
  'spreadsheet_id': 'Spreadsheet ID',
  'database_id': 'Database ID',
  'folder_id': 'Folder ID',
  'file_id': 'File ID',
  'workspace_id': 'Workspace ID',
  'channel_id': 'Channel ID',
  'page_id': 'Page ID',
  'document_id': 'Document ID',
  'recipient_email': 'Recipient Email',
  'sender_email': 'Sender Email',
  'range': 'Cell Range',
  'sheet_name': 'Sheet Name',
  'file_name': 'File Name',
  'query': 'Search Query',
  'subject': 'Email Subject',
  'message': 'Message',
  'topic': 'Topic',
}

function generateLabel(fieldName: string): string {
  // Check predefined mappings first
  if (LABEL_MAP[fieldName]) {
    return LABEL_MAP[fieldName]
  }

  // Default: Convert to Title Case and handle ID suffix
  return fieldName
    .replace(/_id$/i, ' ID')  // spreadsheet_id → spreadsheet ID
    .replace(/[_-]/g, ' ')     // Replace underscores/hyphens with spaces
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

export async function POST() {
  try {
    console.log('[Migrate Labels] Starting migration...')

    // Fetch all agents with input_schema
    const { data: agents, error: fetchError } = await supabase
      .from('agents')
      .select('id, agent_name, input_schema')
      .not('input_schema', 'is', null)

    if (fetchError) {
      console.error('[Migrate Labels] Error fetching agents:', fetchError)
      return NextResponse.json({ error: fetchError.message }, { status: 500 })
    }

    if (!agents || agents.length === 0) {
      return NextResponse.json({ message: 'No agents found with input_schema' })
    }

    console.log(`[Migrate Labels] Found ${agents.length} agents to process`)

    const updates: { id: string; name: string; fieldsUpdated: number }[] = []
    let totalFieldsUpdated = 0

    // Process each agent
    for (const agent of agents) {
      if (!Array.isArray(agent.input_schema) || agent.input_schema.length === 0) {
        continue
      }

      let fieldsUpdated = 0
      const updatedSchema = agent.input_schema.map((field: any) => {
        // Skip if label already exists
        if (field.label) {
          return field
        }

        // Generate label
        const label = generateLabel(field.name)
        fieldsUpdated++

        return {
          ...field,
          label
        }
      })

      // Update the agent
      const { error: updateError } = await supabase
        .from('agents')
        .update({ input_schema: updatedSchema })
        .eq('id', agent.id)

      if (updateError) {
        console.error(`[Migrate Labels] Error updating agent ${agent.id}:`, updateError)
        continue
      }

      if (fieldsUpdated > 0) {
        updates.push({
          id: agent.id,
          name: agent.agent_name,
          fieldsUpdated
        })
        totalFieldsUpdated += fieldsUpdated
        console.log(`[Migrate Labels] Updated ${agent.agent_name}: ${fieldsUpdated} fields`)
      }
    }

    return NextResponse.json({
      success: true,
      message: `Migration completed successfully`,
      agentsUpdated: updates.length,
      totalFieldsUpdated,
      details: updates
    })

  } catch (error: any) {
    console.error('[Migrate Labels] Migration failed:', error)
    return NextResponse.json(
      { error: 'Migration failed', details: error.message },
      { status: 500 }
    )
  }
}
