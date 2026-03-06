/**
 * Test SchemaCompatibilityValidator Fix
 *
 * Verifies that the validator now detects missing fields in loop item variables
 * when the loop iterates over a filter transform output.
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { validateSchemaCompatibility } from '../lib/agentkit/v6/logical-ir/validation/SchemaCompatibilityValidator.js'
import type { ExecutionGraph } from '../lib/agentkit/v6/logical-ir/schemas/declarative-ir-types-v4.js'
import type { PluginDefinition } from '../lib/types/plugin-types.js'

// Lightweight plugin manager for testing (avoids Supabase dependency)
class TestPluginManager {
  private plugins: Map<string, PluginDefinition> = new Map()

  constructor() {
    this.loadPlugins()
  }

  private loadPlugins() {
    const pluginFiles = [
      'google-mail-plugin-v2.json',
      'google-drive-plugin-v2.json',
      'google-sheets-plugin-v2.json',
      'document-extractor-plugin-v2.json',
    ]

    const pluginsDir = join(process.cwd(), 'lib', 'plugins', 'definitions')

    for (const fileName of pluginFiles) {
      const filePath = join(pluginsDir, fileName)
      const content = readFileSync(filePath, 'utf-8')
      const plugin = JSON.parse(content) as PluginDefinition
      const pluginKey = fileName.replace('-plugin-v2.json', '')
      this.plugins.set(pluginKey, plugin)
    }
  }

  getPlugin(pluginKey: string): PluginDefinition | undefined {
    return this.plugins.get(pluginKey)
  }
}

async function testValidatorFix() {
  console.log('Testing SchemaCompatibilityValidator fix for loop item variables...\n')

  // Load the execution graph IR
  const irPath = 'output/vocabulary-pipeline/execution-graph-ir-v4.json'
  const ir = JSON.parse(readFileSync(irPath, 'utf-8'))
  const graph: ExecutionGraph = ir.execution_graph

  // Initialize lightweight plugin manager
  const pluginManager = new TestPluginManager() as any

  // Run validation with autoFix enabled
  console.log('Running validation with autoFix=true...')
  const result = validateSchemaCompatibility(graph, pluginManager, true)

  console.log(`\nValidation Results:`)
  console.log(`  Valid: ${result.valid}`)
  console.log(`  Errors: ${result.errors.length}`)
  console.log(`  Warnings: ${result.warnings.length}`)
  console.log(`  Fixes Applied: ${result.fixes_applied}`)

  if (result.errors.length > 0) {
    console.log('\n❌ ERRORS:')
    for (const error of result.errors) {
      console.log(`  - [${error.category}] ${error.message}`)
      if (error.suggestion) {
        console.log(`    💡 ${error.suggestion}`)
      }
    }
  }

  if (result.warnings.length > 0) {
    console.log('\n⚠️  WARNINGS:')
    for (const warning of result.warnings) {
      console.log(`  - [${warning.category}] ${warning.message}`)
      if (warning.auto_fixed) {
        console.log(`    ✅ ${warning.suggestion}`)
      }
    }
  }

  if (result.fixes_applied > 0) {
    console.log(`\n✅ Validator auto-fixed ${result.fixes_applied} schema mismatch(es)`)
    console.log('\nExpected fixes:')
    console.log('  1. Added "message_id" to all_attachments output_schema')
    console.log('  2. Added "attachment_id" to all_attachments output_schema')
  }

  // Verify the fix was applied to node_1 (flatten transform) and node_2 (filter)
  const node1 = graph.nodes['node_1']
  if (node1?.type === 'operation' && node1.operation?.operation_type === 'transform') {
    const transform = node1.operation.transform as any
    const schema = transform?.output_schema
    if (schema?.items?.properties) {
      const fields = Object.keys(schema.items.properties)
      console.log(`\nNode_1 (flatten → all_attachments) output_schema fields:`)
      console.log(`  ${fields.join(', ')}`)
    }
  }

  const node2 = graph.nodes['node_2']
  if (node2?.type === 'operation' && node2.operation?.operation_type === 'transform') {
    const transform = node2.operation.transform as any
    const schema = transform?.output_schema
    if (schema?.items?.properties) {
      const fields = Object.keys(schema.items.properties)
      console.log(`\nNode_2 (filter → invoice_attachments) output_schema fields:`)
      console.log(`  ${fields.join(', ')}`)

      const hasMessageId = fields.includes('message_id')
      const hasAttachmentId = fields.includes('attachment_id')

      if (hasMessageId && hasAttachmentId) {
        console.log('\n✅ SUCCESS: Validator correctly added missing fields to filter output!')
      } else {
        console.log('\n❌ FAILURE: Missing fields not added to filter:')
        if (!hasMessageId) console.log('  - message_id')
        if (!hasAttachmentId) console.log('  - attachment_id')
      }
    } else if (!schema) {
      console.log(`\nNode_2 (filter) has NO output_schema - it should inherit from input`)
    }
  }

  console.log('\n' + '='.repeat(80))

  if (result.fixes_applied >= 2) {
    console.log('✅ TEST PASSED: Validator detected and fixed missing fields in loop item schema')
    process.exit(0)
  } else {
    console.log('❌ TEST FAILED: Validator did not detect missing fields')
    process.exit(1)
  }
}

testValidatorFix().catch((error) => {
  console.error('Test script error:', error)
  process.exit(1)
})
