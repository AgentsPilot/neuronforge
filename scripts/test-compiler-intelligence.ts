/**
 * Test script for context-aware compiler intelligence
 *
 * Tests the new methods added to ExecutionGraphCompiler:
 * - findDownstreamDeliveryNodes
 * - analyzePluginDataFormat
 * - chooseTransformOperation
 * - detectUnnecessaryTransform
 */

import { ExecutionGraphCompiler } from '../lib/agentkit/v6/compiler/ExecutionGraphCompiler'
import type { ExecutionGraph, ExecutionNode } from '../lib/agentkit/v6/logical-ir/schemas/declarative-ir-types-v4'

async function testCompilerIntelligence() {
  console.log('🧪 Testing Compiler Intelligence\n')

  // Test Case 1: Gmail + Sheets workflow with transform step
  const testGraph: ExecutionGraph = {
    start: 'fetch_emails',
    nodes: {
      'fetch_emails': {
        id: 'fetch_emails',
        type: 'operation',
        operation: {
          operation_type: 'fetch',
          fetch: {
            plugin_key: 'google-mail',
            action: 'search_messages',
            config: { query: 'has:attachment' }
          }
        },
        outputs: [{ variable: 'emails' }],
        next: 'loop_emails'
      },
      'loop_emails': {
        id: 'loop_emails',
        type: 'loop',
        loop: {
          iterate_over: 'emails',
          item_variable: 'current_email',
          body_start: 'extract_data',
          collect_outputs: true,
          output_variable: 'processed_items'
        },
        inputs: [{ variable: 'emails' }],
        outputs: [{ variable: 'processed_items' }],
        next: 'end'
      },
      'extract_data': {
        id: 'extract_data',
        type: 'operation',
        operation: {
          operation_type: 'ai',
          ai: {
            type: 'deterministic_extract',
            instruction: 'Extract: from, subject, id',
            input: '{{current_email}}',
            output_schema: {
              fields: [
                { name: 'from', type: 'string' },
                { name: 'subject', type: 'string' },
                { name: 'id', type: 'string' }
              ]
            }
          }
        },
        inputs: [{ variable: 'current_email' }],
        outputs: [{ variable: 'email_data' }],
        next: 'construct_url'
      },
      'construct_url': {
        id: 'construct_url',
        type: 'operation',
        operation: {
          operation_type: 'transform',
          transform: {
            type: 'map',  // This should be detected as wrong!
            config: {
              template: 'https://mail.google.com/mail/u/0/#inbox/{{email_data.id}}'
            }
          }
        },
        inputs: [{ variable: 'email_data' }],
        outputs: [{ variable: 'gmail_url' }],
        next: 'append_sheets'
      },
      'append_sheets': {
        id: 'append_sheets',
        type: 'operation',
        operation: {
          operation_type: 'deliver',
          deliver: {
            plugin_key: 'google-sheets',
            action: 'append_rows',
            config: {
              spreadsheet_id: '1234',
              values: [['{{email_data.from}}', '{{email_data.subject}}', '{{gmail_url}}']]
            }
          }
        },
        inputs: [{ variable: 'email_data' }, { variable: 'gmail_url' }],
        next: 'loop_end'
      },
      'loop_end': {
        id: 'loop_end',
        type: 'end'
      },
      'end': {
        id: 'end',
        type: 'end'
      }
    },
    variables: [
      { name: 'emails', type: 'array', scope: 'global' },
      { name: 'current_email', type: 'object', scope: 'loop' },
      { name: 'email_data', type: 'object', scope: 'loop' },
      { name: 'gmail_url', type: 'string', scope: 'loop' },
      { name: 'processed_items', type: 'array', scope: 'global' }
    ]
  }

  const compiler = new ExecutionGraphCompiler()

  console.log('📊 Test Case: Gmail + Sheets with unnecessary transform step\n')

  // Compile the IR
  const ir = {
    ir_version: '4.0' as const,
    goal: 'Test workflow',
    execution_graph: testGraph
  }

  try {
    const result = await compiler.compile(ir)

    if (result.success) {
      console.log('✅ Compilation successful!\n')
      console.log('📝 Compilation Logs:')
      result.logs.forEach(log => console.log(`   ${log}`))

      console.log('\n⚠️  Warnings:')
      if (result.errors && result.errors.length > 0) {
        result.errors.forEach(warning => console.log(`   ${warning}`))
      } else {
        console.log('   None')
      }

      console.log('\n🔍 Generated Workflow Steps:')
      result.workflow.forEach((step: any, idx) => {
        console.log(`   ${idx + 1}. ${step.step_id} (${step.type})${step.operation ? ' - ' + step.operation : ''}`)
      })

      // Check if Step7 was detected as unnecessary
      const logs = result.logs.join('\n')
      if (logs.includes('appears unnecessary')) {
        console.log('\n✅ SUCCESS: Unnecessary transform detected!')
      } else {
        console.log('\n⚠️  WARNING: Unnecessary transform not detected')
      }

      // Check if downstream analysis was performed
      if (logs.includes('downstream analysis')) {
        console.log('✅ SUCCESS: Downstream delivery analysis performed!')
      } else {
        console.log('⚠️  WARNING: Downstream analysis not found in logs')
      }

      // Check for type mismatch detection
      if (logs.includes('requires array input')) {
        console.log('✅ SUCCESS: Type mismatch detected!')
      }

    } else {
      console.log('❌ Compilation failed')
      console.log('Errors:', result.errors)
    }

  } catch (error: any) {
    console.log('❌ Test failed with error:', error.message)
    console.log(error.stack)
  }
}

// Run the test
testCompilerIntelligence().then(() => {
  console.log('\n✨ Test completed')
  process.exit(0)
}).catch(error => {
  console.error('❌ Test failed:', error)
  process.exit(1)
})
