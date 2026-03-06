/**
 * Direct Test: Semantic Skeleton → IR Generation
 *
 * Tests the formalizeWithSkeleton method directly without API infrastructure.
 * This bypasses Supabase dependencies and focuses on the core skeleton → IR flow.
 */

import { IRFormalizer } from '../lib/agentkit/v6/semantic-plan/IRFormalizer.js'
import { SemanticSkeletonGenerator } from '../lib/agentkit/v6/semantic-plan/SemanticSkeletonGenerator.js'
import type { EnhancedPrompt } from '../lib/agentkit/v6/semantic-plan/SemanticPlanGenerator.js'
import type { SemanticSkeleton } from '../lib/agentkit/v6/semantic-plan/types/semantic-skeleton-types.js'
import type { HardRequirements } from '../lib/agentkit/v6/requirements/HardRequirementsExtractor.js'
import { createLogger } from '../lib/logger/index.js'
import { writeFileSync } from 'fs'

const logger = createLogger({ module: 'TEST', service: 'SkeletonToIRDirect' })

// Test case: Invoice processing with nested loops (emails → attachments)
const enhancedPrompt: EnhancedPrompt = {
  plan_title: 'Invoice Processing',
  plan_description: 'Extract invoice data from Gmail attachments',
  sections: {
    data: [
      '- Read Gmail Inbox messages from the last 7 days.',
      '- Look for attachments that are PDFs or images',
      '- Extract invoice data from attachments using AI'
    ],
    actions: [
      '- For each email, process each attachment',
      '- Upload attachment to Google Drive',
      '- Extract: date, vendor, amount, currency, invoice number',
      '- If amount > $50, append to Google Sheets tab Expenses'
    ],
    output: [
      '- One row per attachment in Google Sheets',
      '- Columns: date, vendor, amount, currency, invoice_number, drive_link'
    ],
    delivery: [
      '- Store attachments in Google Drive folder InvoiceUploads',
      '- Append rows to spreadsheet 1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc'
    ]
  },
  specifics: {
    services_involved: ['gmail', 'google-drive', 'google-sheets']
  }
}

// Minimal hard requirements (unit_of_work enforcement)
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
    logger.info('PHASE 1: Generate Semantic Skeleton')
    logger.info('=' .repeat(80))

    const skeletonGenerator = new SemanticSkeletonGenerator({
      model: 'claude-sonnet-4-5-20250929',
      temperature: 0.0
    })

    const skeleton: SemanticSkeleton = await skeletonGenerator.generate(enhancedPrompt)

    logger.info({
      goal: skeleton.goal,
      unit_of_work: skeleton.unit_of_work,
      flowLength: skeleton.flow.length
    }, '✅ Skeleton generated')

    // Save skeleton for inspection
    writeFileSync(
      '/tmp/test-skeleton-invoice.json',
      JSON.stringify(skeleton, null, 2)
    )
    logger.info('📁 Skeleton saved to /tmp/test-skeleton-invoice.json')

    logger.info('')
    logger.info('=' .repeat(80))
    logger.info('PHASE 2: Generate IR from Skeleton')
    logger.info('=' .repeat(80))

    const formalizer = new IRFormalizer({
      model: 'claude-opus-4-5-20251101',
      temperature: 0.0,
      max_tokens: 12000,
      anthropic_api_key: process.env.ANTHROPIC_API_KEY,
      pluginManager: null, // We'll mock this or use null for testing
      servicesInvolved: ['gmail', 'google-drive', 'google-sheets']
    })

    const ir = await formalizer.formalizeWithSkeleton(
      enhancedPrompt,
      skeleton,
      hardRequirements
    )

    logger.info({
      irVersion: ir.ir_version,
      nodeCount: Object.keys(ir.execution_graph.nodes).length,
      variableCount: ir.execution_graph.variables?.length || 0,
      startNode: ir.execution_graph.start
    }, '✅ IR generated')

    // Save IR for inspection
    writeFileSync(
      '/tmp/test-ir-invoice.json',
      JSON.stringify(ir, null, 2)
    )
    logger.info('📁 IR saved to /tmp/test-ir-invoice.json')

    logger.info('')
    logger.info('=' .repeat(80))
    logger.info('SUCCESS: Semantic Skeleton → IR Pipeline Completed')
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
