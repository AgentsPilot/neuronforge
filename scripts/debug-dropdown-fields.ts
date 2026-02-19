/**
 * Debug script to check why dropdown fields aren't showing up in run agent page
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env.local') })

async function debugDropdownFields() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Get a sample agent
  const { data: agents, error } = await supabase
    .from('agents')
    .select('id, agent_name, input_schema')
    .not('input_schema', 'is', null)
    .limit(5)

  if (error) {
    console.error('Error fetching agents:', error)
    return
  }

  console.log('\n=== AGENTS WITH INPUT SCHEMA ===\n')

  for (const agent of agents || []) {
    console.log(`\n📋 Agent: ${agent.agent_name} (${agent.id})`)
    console.log(`Input Schema Fields: ${agent.input_schema?.length || 0}`)

    if (agent.input_schema && agent.input_schema.length > 0) {
      console.log('\nFields:')
      agent.input_schema.forEach((field: any, index: number) => {
        console.log(`  ${index + 1}. ${field.name}`)
        console.log(`     Type: ${field.type}`)
        console.log(`     Label: ${field.label || 'N/A'}`)
        console.log(`     Required: ${field.required || false}`)
        console.log(`     Placeholder: ${field.placeholder || 'N/A'}`)

        // Check if field name suggests it should have dynamic options
        const fieldNameLower = field.name.toLowerCase()
        const mightNeedDropdown =
          fieldNameLower.includes('folder') ||
          fieldNameLower.includes('spreadsheet') ||
          fieldNameLower.includes('channel') ||
          fieldNameLower.includes('drive') ||
          fieldNameLower.includes('sheet') ||
          fieldNameLower.includes('doc') ||
          fieldNameLower.includes('calendar') ||
          fieldNameLower.includes('range')

        if (mightNeedDropdown) {
          console.log(`     ⚠️  Might need dropdown!`)
        }
        console.log('')
      })
    }
  }

  console.log('\n=== END ===\n')
}

debugDropdownFields()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err)
    process.exit(1)
  })
