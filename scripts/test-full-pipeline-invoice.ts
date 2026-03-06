/**
 * Full Pipeline Test: Invoice Processing (Nested Loops)
 *
 * Tests the complete V6 pipeline with semantic skeleton enabled.
 * This workflow has nested loops (emails → attachments) which previously failed.
 */

import { V6PipelineOrchestrator } from '../lib/agentkit/v6/pipeline/V6PipelineOrchestrator.js'
import { createLogger } from '../lib/logger/index.js'
import fs from 'fs/promises'

const logger = createLogger({ module: 'TEST', service: 'FullPipelineInvoice' })

async function test() {
  try {
    logger.info('🚀 Starting full pipeline test with complete enhanced prompt...')

    // Load the complete enhanced prompt from file
    const enhancedPromptPath = 'enhanced-prompt-invoice-extraction.json'
    logger.info({ path: enhancedPromptPath }, '📖 Loading enhanced prompt...')

    const enhancedPrompt = JSON.parse(
      await fs.readFile(enhancedPromptPath, 'utf-8')
    )

    logger.info({
      title: enhancedPrompt.plan_title,
      sections: Object.keys(enhancedPrompt.sections),
      resolvedInputs: enhancedPrompt.specifics.resolved_user_inputs.length
    }, '✅ Enhanced prompt loaded')

    const orchestrator = new V6PipelineOrchestrator()
    const result = await orchestrator.run(enhancedPrompt)

    logger.info({
      success: result.success,
      hasWorkflow: !!result.workflow,
      hasIR: !!result.ir,
      hasSemanticPlan: !!result.semanticPlan
    }, '✅ Pipeline completed successfully')

    if (result.ir) {
      const nodeCount = Object.keys(result.ir.execution_graph.nodes).length
      const variableCount = result.ir.execution_graph.variables?.length || 0
      logger.info({ nodeCount, variableCount }, 'IR Statistics')
    }

    if (result.workflow) {
      const stepCount = result.workflow.length
      logger.info({ stepCount }, 'PILOT DSL Statistics')
    }

    // Write outputs to files for inspection
    if (result.workflow) {
      const outputDir = 'output/test-invoice-pipeline'
      await fs.mkdir(outputDir, { recursive: true })

      await fs.writeFile(
        `${outputDir}/pilot-dsl-steps.json`,
        JSON.stringify(result.workflow, null, 2)
      )
      logger.info({ outputDir }, '📁 Wrote PILOT DSL to output directory')

      if (result.ir) {
        await fs.writeFile(
          `${outputDir}/execution-graph-ir-v4.json`,
          JSON.stringify(result.ir, null, 2)
        )
        logger.info('📁 Wrote IR to output directory')
      }

      if (result.semanticPlan) {
        await fs.writeFile(
          `${outputDir}/semantic-plan.json`,
          JSON.stringify(result.semanticPlan, null, 2)
        )
        logger.info('📁 Wrote semantic plan to output directory')
      }
    }

    if (!result.success) {
      logger.error({ errors: result.errors }, '❌ Pipeline failed')
      process.exit(1)
    }

    logger.info('✨ Test completed successfully')
    process.exit(0)

  } catch (error: any) {
    logger.error({
      error: error.message,
      stack: error.stack
    }, '❌ Pipeline failed')
    process.exit(1)
  }
}

test()
