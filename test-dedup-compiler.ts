/**
 * Test DeclarativeCompiler deduplication logic
 */

import { DeclarativeCompiler } from './lib/agentkit/v6/compiler/DeclarativeCompiler.js'
import type { DeclarativeLogicalIR } from './lib/agentkit/v6/logical-ir/schemas/declarative-ir-types.js'

// Test IR with deduplication pattern (Gmail + Google Sheets reference)
const testIR: DeclarativeLogicalIR = {
  ir_version: '2.0',  // Match what IRFormalizer generates
  goal: 'Scan Gmail for complaint emails, deduplicate against existing sheet, append new complaints',

  data_sources: [
    {
      type: 'api',
      source: 'google_mail',
      role: 'primary',
      plugin_key: 'google-mail',
      operation_type: 'search',
      location: 'inbox',
      config: {
        query: 'in:inbox newer_than:7d',
        max_results: 10,
        include_attachments: false
      }
    },
    {
      type: 'tabular',
      source: 'google_sheets',
      role: 'reference',  // ← This triggers deduplication
      plugin_key: 'google-sheets',
      operation_type: 'read',
      location: 'UrgentEmails sheet',
      config: {
        spreadsheet_id: '1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc',
        range: 'UrgentEmails!A:Z',
        identifier_field: 'id'  // ← Field to use for deduplication
      }
    }
  ],

  delivery_rules: {
    summary_delivery: {
      recipient: 'admin@example.com',
      subject: 'New Complaint Emails',
      plugin_key: 'google-sheets',
      operation_type: 'send'
    }
  }
}

async function testDeduplication() {
  console.log('🧪 Testing DeclarativeCompiler Deduplication Logic\n')

  const compiler = new DeclarativeCompiler()

  try {
    const result = await compiler.compile(testIR)

    if (!result.success) {
      console.error('❌ Compilation failed:', result.errors)
      return
    }

    console.log('✅ Compilation succeeded!\n')
    console.log('📋 Generated Steps:')
    console.log('==================')

    result.workflow!.forEach((step: any, idx: number) => {
      console.log(`\n${idx + 1}. ${step.step_id || step.id} (${step.type})`)
      if (step.name) console.log(`   Name: ${step.name}`)
      if (step.type === 'action') {
        console.log(`   Plugin: ${step.plugin}.${step.action}`)
        console.log(`   Params:`, JSON.stringify(step.params, null, 2))
      } else if (step.type === 'transform') {
        console.log(`   Operation: ${step.operation}`)
        console.log(`   Input: ${step.input}`)
        console.log(`   Config:`, JSON.stringify(step.config, null, 2))
      }
    })

    console.log('\n\n📊 Deduplication Steps Analysis:')
    console.log('=================================')

    const dedupSteps = result.workflow!.filter((s: any) =>
      (s.step_id || s.id || '').includes('dedup') ||
      (s.step_id || s.id || '').includes('reference') ||
      (s.step_id || s.id || '').includes('existing')
    )

    if (dedupSteps.length > 0) {
      console.log(`✅ Found ${dedupSteps.length} deduplication-related steps`)
      dedupSteps.forEach((step: any) => {
        console.log(`   - ${step.step_id || step.id}: ${step.name}`)
      })
    } else {
      console.log('❌ No deduplication steps found')
    }

    console.log('\n\n📝 Compilation Logs:')
    console.log('====================')
    if (result.logs && result.logs.length > 0) {
      result.logs.forEach((log: string) => console.log(`  ${log}`))
    } else {
      console.log('  (No logs)')
    }

  } catch (error) {
    console.error('❌ Test failed with error:', error)
  }
}

testDeduplication()
