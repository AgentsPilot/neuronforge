/**
 * Test IR Auto-Fix Mechanism
 *
 * Uses a pre-generated semantic skeleton to test IR generation + auto-fix.
 * This avoids needing ANTHROPIC_API_KEY for skeleton generation.
 */

import { IRFormalizer } from '../lib/agentkit/v6/semantic-plan/IRFormalizer.js'
import type { EnhancedPrompt } from '../lib/agentkit/v6/semantic-plan/SemanticPlanGenerator.js'
import type { SemanticSkeleton } from '../lib/agentkit/v6/semantic-plan/types/semantic-skeleton-types.js'
import type { HardRequirements } from '../lib/agentkit/v6/requirements/HardRequirementsExtractor.js'
import { createLogger } from '../lib/logger/index.js'
import { readFileSync, writeFileSync } from 'fs'

const logger = createLogger({ module: 'TEST', service: 'IRAutoFixOnly' })

// Load pre-generated skeleton
const skeletonPath = '/tmp/semantic-test1-production.json'
const skeleton: SemanticSkeleton = JSON.parse(readFileSync(skeletonPath, 'utf-8'))

logger.info({ skeletonPath }, 'Loaded pre-generated skeleton')
logger.info({
  goal: skeleton.goal,
  unit_of_work: skeleton.unit_of_work,
  flowLength: skeleton.flow.length
}, 'Skeleton details')

// Enhanced Prompt (reconstruct from skeleton for context)
const enhancedPrompt: EnhancedPrompt = {
  plan_title: 'Invoice Processing',
  plan_description: skeleton.goal,
  sections: {
    data: [
      '- Read Gmail Inbox messages (unread)',
      '- Look for attachments that are PDFs or images'
    ],
    actions: [
      '- For each email, process each attachment',
      '- Upload attachment to Google Drive',
      '- Extract invoice data using AI',
      '- If amount > $50, append to Google Sheets'
    ],
    output: [
      '- One row per attachment in Google Sheets with extracted data'
    ],
    delivery: [
      '- Store attachments in Google Drive',
      '- Append to Google Sheets',
      '- Send summary email'
    ]
  },
  specifics: {
    services_involved: ['gmail', 'google-drive', 'google-sheets']
  }
}

// Minimal hard requirements
const hardRequirements: HardRequirements = {
  requirements: [],
  unit_of_work: 'attachment',
  thresholds: [
    {
      requirement_id: 'threshold_1',
      field: 'amount',
      operator: '>',
      value: 50,
      action: 'append to Google Sheets'
    }
  ],
  routing_rules: [],
  invariants: []
}

async function test() {
  try {
    logger.info('=' .repeat(80))
    logger.info('Testing IR Generation with Auto-Fix Mechanism')
    logger.info('=' .repeat(80))

    logger.info('Expected error: LLM generates {{current_email}} instead of {{current_email.attachments}}')
    logger.info('Expected fix: Auto-recovery detects pattern and fixes it')

    const formalizer = new IRFormalizer({
      model: 'claude-opus-4-5-20251101',
      temperature: 0.0,
      max_tokens: 12000,
      anthropic_api_key: process.env.ANTHROPIC_API_KEY,
      pluginManager: null,
      servicesInvolved: ['gmail', 'google-drive', 'google-sheets']
    })

    const result = await formalizer.formalize(
      enhancedPrompt,
      hardRequirements,
      skeleton
    )

    const ir = result.ir

    logger.info({
      irVersion: ir.ir_version,
      nodeCount: Object.keys(ir.execution_graph?.nodes || {}).length,
      variableCount: ir.execution_graph?.variables?.length || 0,
      startNode: ir.execution_graph?.start
    }, '✅ IR generated')

    // Check for filter transforms to see if auto-fix worked
    let filterNodeFound = false
    let filterNodeDetails: any = null

    for (const [nodeId, node] of Object.entries(ir.execution_graph?.nodes || {})) {
      if (node.type === 'operation' && node.operation?.operation_type === 'transform') {
        const transform = (node.operation as any).transform
        if (transform && (transform.type === 'filter' || transform.type === 'map')) {
          filterNodeFound = true
          filterNodeDetails = {
            nodeId,
            transformType: transform.type,
            input: transform.input,
            condition: transform.condition || transform.mapping
          }
          break
        }
      }
    }

    if (filterNodeFound) {
      logger.info(filterNodeDetails, '🔍 Filter transform node found')

      // Check if input uses nested field access (indicates auto-fix worked)
      if (filterNodeDetails.input.includes('.attachments')) {
        logger.info('✅ AUTO-FIX CONFIRMED: Filter input uses nested field access')
        logger.info({ input: filterNodeDetails.input }, 'Correct input pattern')
      } else {
        logger.warn('⚠️ AUTO-FIX MAY NOT HAVE WORKED: Filter input doesn\'t use nested field')
        logger.warn({ input: filterNodeDetails.input }, 'Check this input')
      }
    } else {
      logger.warn('⚠️ No filter transform node found in IR')
    }

    // Save IR for inspection
    writeFileSync(
      '/tmp/test-ir-autofix.json',
      JSON.stringify(ir, null, 2)
    )
    logger.info('📁 IR saved to /tmp/test-ir-autofix.json')

    logger.info('')
    logger.info('=' .repeat(80))
    logger.info('Test completed - Check logs for auto-fix confirmation')
    logger.info('=' .repeat(80))

  } catch (error: any) {
    logger.error({
      error: error.message,
      stack: error.stack
    }, '❌ Test failed')
    process.exit(1)
  }
}

test()
