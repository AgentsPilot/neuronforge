/**
 * End-to-End Test: Business Requirements → Narrative Prompt → V6 Pipeline
 *
 * This test demonstrates the complete flow:
 * 1. Start with plain business requirements
 * 2. Use GPT-4 to generate a structured narrative prompt
 * 3. Feed narrative prompt into V6 pipeline
 * 4. Validate the generated workflow
 *
 * Usage:
 *   npx tsx scripts/test-narrative-generation-e2e.ts <business-requirements-file.md>
 */

import fs from 'fs'
import path from 'path'
import { config as dotenvConfig } from 'dotenv'
import OpenAI from 'openai'
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2'
import { PluginVocabularyExtractor } from '@/lib/agentkit/v6/vocabulary/PluginVocabularyExtractor'
import { IRFormalizer } from '@/lib/agentkit/v6/semantic-plan/IRFormalizer'
import { CapabilityBinderV2 } from '@/lib/agentkit/v6/capability-binding/CapabilityBinderV2'
import { IntentToIRConverter } from '@/lib/agentkit/v6/compiler/IntentToIRConverter'
import { ExecutionGraphCompiler } from '@/lib/agentkit/v6/compiler/ExecutionGraphCompiler'

// Load environment variables
dotenvConfig({ path: '.env.local' })

interface BusinessRequirements {
  title: string
  data: string[]
  actions: string[]
  output?: string[]
  delivery?: string[]
  config_parameters: Record<string, any>
}

const NARRATIVE_GENERATION_PROMPT = `You are an expert Business Process Documentation Specialist.

Your task is to convert plain business requirements into a structured narrative prompt that guides an LLM to generate a correct, executable automation workflow.

## Narrative Prompt Format

The narrative prompt must follow this structure:

1. **Role and Task Definition**
   "You are a Senior Business Analyst and Automation Architect responsible for translating business process requirements into a structured automation workflow..."

2. **WORKFLOW DESIGN METHOD** (Critical section)
   Before generating the workflow, you must internally identify:
   - Source systems
   - Collections that require iteration
   - The fundamental processing unit
   - Required data evaluation and classification logic
   - Conditional rules
   - Output destinations
   - Exception handling paths

3. **PROCESS OBJECTIVE**
   Clear statement of what the workflow accomplishes

4. **SOURCE SYSTEM** (one section per system)
   - System type (Google Sheets, email, etc.)
   - Connection details (IDs, paths)
   - Execution guidance subsection with implementation hints

5. **DATA STRUCTURE** (if applicable)
   - Fields that must be preserved
   - Data types
   - Required transformations

6. **PROCESSING RULES** (one section per rule)
   - Rule name (e.g., "LEAD CLASSIFICATION")
   - Rule logic in plain English
   - Execution guidance subsection with implementation hints

7. **OUTPUT DESTINATIONS** (one section per destination)
   - Where results go
   - Format requirements
   - Execution guidance subsection

8. **SYSTEM INTEGRATIONS**
   - List of all systems involved

9. **WORKFLOW EXECUTION REQUIREMENTS**
   - Complete checklist of what the workflow must support

10. **FINAL TASK**
    "Using the above business process specification, generate a workflow that fully implements the described process..."

## Critical Guidelines

**Always include "Execution guidance:" subsections** - These guide the LLM on HOW to implement:
- "Collections must always be processed using iteration logic"
- "Decision rules must be represented using conditional branches"
- "This rule must be handled as an exception branch"

**Use section dividers**: ⸻ (unicode character U+2E3B)

**Be explicit about**:
- What is a collection (must iterate)
- What is the processing unit (row, item, record)
- What is a decision point (conditional)
- What is an exception (else branch)
- What is a grouping operation (aggregate)

**Example execution guidance formats**:
- "The rows of the sheet must be treated as a collection."
- "Each row represents a single lead record."
- "This rule must be implemented using conditional logic."
- "This grouping is required so that each X receives Y."
- "This rule must be handled as an exception branch."

## Your Task

Convert the business requirements below into a complete narrative prompt following the above format.

Focus on:
1. ✅ Clear section structure with proper dividers
2. ✅ "Execution guidance:" subsections for implementation hints
3. ✅ Explicit identification of collections, processing units, conditionals
4. ✅ Plain English (no jargon)
5. ✅ Complete coverage of all rules and requirements

Return ONLY the narrative prompt text (no JSON wrapper, no markdown code blocks).`

async function generateNarrativePrompt(
  requirements: BusinessRequirements,
  apiKey: string
): Promise<string> {
  console.log('\n🤖 Phase 1: Generate Narrative Prompt from Business Requirements')
  console.log('-'.repeat(80))

  const client = new OpenAI({ apiKey })

  const requirementsText = `
# Business Requirements: ${requirements.title}

## Data
${requirements.data.join('\n')}

## Actions
${requirements.actions.join('\n')}

${requirements.output ? `## Output\n${requirements.output.join('\n')}\n` : ''}

${requirements.delivery ? `## Delivery\n${requirements.delivery.join('\n')}\n` : ''}

## Configuration Parameters
${JSON.stringify(requirements.config_parameters, null, 2)}
`

  console.log('📋 Business Requirements:')
  console.log(requirementsText)

  console.log('\n🔄 Calling GPT-4 to generate narrative prompt...')

  const response = await client.chat.completions.create({
    model: 'gpt-4-turbo-preview',
    max_tokens: 4096,
    messages: [{
      role: 'system',
      content: NARRATIVE_GENERATION_PROMPT
    }, {
      role: 'user',
      content: requirementsText
    }]
  })

  const narrativePrompt = response.choices[0]?.message?.content || ''

  console.log(`✅ Generated narrative prompt (${narrativePrompt.length} chars)`)

  return narrativePrompt
}

async function runV6Pipeline(
  narrativePrompt: string,
  config: Record<string, any>,
  servicesInvolved: string[]
): Promise<any> {
  console.log('\n📊 Phase 2: Run V6 Pipeline with Narrative Prompt')
  console.log('-'.repeat(80))

  // Phase 0: Vocabulary Extraction
  console.log('\n⏳ Phase 0: Extract Plugin Vocabulary...')
  const pluginManager = await PluginManagerV2.getInstance()
  const userId = '08456106-aa50-4810-b12c-7ca84102da31'

  const vocabularyExtractor = new PluginVocabularyExtractor(pluginManager)
  const vocabulary = await vocabularyExtractor.extract(userId, { servicesInvolved })

  console.log(`✅ Vocabulary extracted:`)
  console.log(`   Domains: ${vocabulary.domains.length}`)
  console.log(`   Capabilities: ${vocabulary.capabilities.length}`)
  console.log(`   Plugins: ${vocabulary.plugins.length}`)

  // Phase 1: Generate IntentContract
  console.log('\n⏳ Phase 1: Generate IntentContract (LLM)...')
  const irFormalizer = new IRFormalizer({
    model: 'claude-sonnet-4-20250514',
    model_provider: 'anthropic'
  })

  const startTime = Date.now()
  const intentContract = await irFormalizer.formalize(
    narrativePrompt,
    vocabulary,
    config
  )
  const llmTime = Date.now() - startTime

  console.log(`✅ IntentContract generated (${llmTime}ms)`)
  console.log(`   Steps: ${intentContract.intent.steps.length}`)
  console.log(`   Goal: ${intentContract.intent.goal}`)

  // Phase 2: Capability Binding
  console.log('\n⏳ Phase 2: Capability Binding (DETERMINISTIC)...')
  const capabilityBinder = new CapabilityBinderV2(pluginManager, userId)

  const bindStartTime = Date.now()
  const boundContract = await capabilityBinder.bindCapabilities(intentContract)
  const bindTime = Date.now() - bindStartTime

  const boundCount = boundContract.steps.filter(s => s.plugin_key).length
  console.log(`✅ Binding complete (${bindTime}ms)`)
  console.log(`   Bound: ${boundCount}/${boundContract.steps.length} steps`)

  // Phase 3: IR Conversion
  console.log('\n⏳ Phase 3: Intent → IR Conversion (DETERMINISTIC)...')
  const converter = new IntentToIRConverter(pluginManager)

  const convertStartTime = Date.now()
  const executionGraph = await converter.convert(boundContract)
  const convertTime = Date.now() - convertStartTime

  console.log(`✅ Conversion complete (${convertTime}ms)`)
  console.log(`   IR Nodes: ${executionGraph.nodes.length}`)

  // Phase 4: IR Compilation
  console.log('\n⏳ Phase 4: IR Compilation (DETERMINISTIC)...')
  const compiler = new ExecutionGraphCompiler(pluginManager)

  const compileStartTime = Date.now()
  const pilotSteps = await compiler.compile(executionGraph, config)
  const compileTime = Date.now() - compileStartTime

  console.log(`✅ Compilation complete (${compileTime}ms)`)
  console.log(`   PILOT Steps: ${pilotSteps.length}`)

  return {
    vocabulary,
    intentContract,
    boundContract,
    executionGraph,
    pilotSteps,
    timings: {
      llmTime,
      bindTime,
      convertTime,
      compileTime,
      totalTime: llmTime + bindTime + convertTime + compileTime
    }
  }
}

async function validateWorkflow(
  pilotSteps: any[],
  config: Record<string, any>
): Promise<{ errors: number; warnings: number; details: any[] }> {
  console.log('\n🔍 Phase 3: Validate Generated Workflow')
  console.log('-'.repeat(80))

  // Import validator
  const { NarrativeWorkflowValidator } = await import('./validate-narrative-workflow')

  // Create minimal plugin manager
  const pluginManager = {
    getPlugin: (key: string) => {
      try {
        const pluginPath = path.join(process.cwd(), 'lib/plugins/definitions', `${key}-plugin-v2.json`)
        return JSON.parse(fs.readFileSync(pluginPath, 'utf-8'))
      } catch (e) {
        return null
      }
    }
  }

  const validator = new (NarrativeWorkflowValidator as any)(pluginManager)
  const issues = await validator.validate(pilotSteps, config)

  const errors = issues.filter((i: any) => i.severity === 'error')
  const warnings = issues.filter((i: any) => i.severity === 'warning')

  console.log(`\n📊 Validation Results:`)
  console.log(`   Errors: ${errors.length}`)
  console.log(`   Warnings: ${warnings.length}`)

  if (errors.length > 0) {
    console.log(`\n❌ ERRORS:`)
    errors.forEach((e: any) => console.log(`   [${e.category}] ${e.step_id}: ${e.message}`))
  }

  if (warnings.length > 0) {
    console.log(`\n⚠️  WARNINGS:`)
    warnings.forEach((w: any) => console.log(`   [${w.category}] ${w.step_id}: ${w.message}`))
  }

  return {
    errors: errors.length,
    warnings: warnings.length,
    details: issues
  }
}

async function main() {
  console.log('🚀 End-to-End Test: Business Requirements → Narrative → V6 Pipeline')
  console.log('=' .repeat(80))

  // Check if business requirements file provided
  const requirementsFile = process.argv[2]
  if (!requirementsFile) {
    console.error('❌ Usage: npx tsx scripts/test-narrative-generation-e2e.ts <requirements-file.json>')
    process.exit(1)
  }

  // Load business requirements
  const requirementsPath = path.join(process.cwd(), requirementsFile)
  if (!fs.existsSync(requirementsPath)) {
    console.error(`❌ Requirements file not found: ${requirementsPath}`)
    process.exit(1)
  }

  const requirements: BusinessRequirements = JSON.parse(fs.readFileSync(requirementsPath, 'utf-8'))
  console.log(`\n📋 Loaded business requirements: ${requirements.title}`)

  // Get API key
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.error('❌ OPENAI_API_KEY environment variable not set')
    process.exit(1)
  }

  // Extract services involved from data section
  const servicesInvolved: string[] = []
  const dataText = requirements.data.join(' ').toLowerCase()

  // Detect common service patterns
  if (dataText.includes('google sheet')) servicesInvolved.push('google-sheets')
  if (dataText.includes('google mail') || dataText.includes('email') || dataText.includes('gmail')) servicesInvolved.push('google-mail')
  if (dataText.includes('google drive')) servicesInvolved.push('google-drive')
  if (dataText.includes('google docs')) servicesInvolved.push('google-docs')
  if (dataText.includes('google calendar')) servicesInvolved.push('google-calendar')
  if (dataText.includes('slack')) servicesInvolved.push('slack')
  if (dataText.includes('airtable')) servicesInvolved.push('airtable')
  if (dataText.includes('hubspot')) servicesInvolved.push('hubspot')

  // Always include AI service for text processing
  if (!servicesInvolved.includes('chatgpt-research')) {
    servicesInvolved.push('chatgpt-research')
  }

  console.log(`📦 Services involved: ${servicesInvolved.join(', ')}`)

  try {
    // Step 1: Generate narrative prompt from business requirements
    const narrativePrompt = await generateNarrativePrompt(requirements, apiKey)

    // Save narrative prompt
    const narrativePath = path.join(process.cwd(), 'output/narrative-e2e/narrative-prompt.txt')
    fs.mkdirSync(path.dirname(narrativePath), { recursive: true })
    fs.writeFileSync(narrativePath, narrativePrompt)
    console.log(`\n💾 Saved narrative prompt: ${narrativePath}`)

    // Step 2: Run V6 pipeline with narrative prompt
    const pipelineResult = await runV6Pipeline(
      narrativePrompt,
      requirements.config_parameters,
      servicesInvolved
    )

    // Save outputs
    const outputDir = path.join(process.cwd(), 'output/narrative-e2e')
    fs.mkdirSync(outputDir, { recursive: true })

    fs.writeFileSync(
      path.join(outputDir, 'intent-contract.json'),
      JSON.stringify(pipelineResult.intentContract, null, 2)
    )
    fs.writeFileSync(
      path.join(outputDir, 'bound-contract.json'),
      JSON.stringify(pipelineResult.boundContract, null, 2)
    )
    fs.writeFileSync(
      path.join(outputDir, 'execution-graph.json'),
      JSON.stringify(pipelineResult.executionGraph, null, 2)
    )
    fs.writeFileSync(
      path.join(outputDir, 'pilot-dsl-steps.json'),
      JSON.stringify(pipelineResult.pilotSteps, null, 2)
    )

    console.log(`\n💾 Saved pipeline outputs to: ${outputDir}`)

    // Step 3: Validate workflow
    const validation = await validateWorkflow(
      pipelineResult.pilotSteps,
      requirements.config_parameters
    )

    // Save validation results
    fs.writeFileSync(
      path.join(outputDir, 'validation-results.json'),
      JSON.stringify(validation.details, null, 2)
    )

    // Final report
    console.log('\n' + '=' .repeat(80))
    console.log('🎉 END-TO-END TEST COMPLETE')
    console.log('=' .repeat(80))

    console.log('\n📊 Performance Summary:')
    console.log(`   Narrative Generation: ${pipelineResult.timings.llmTime}ms`)
    console.log(`   V6 Pipeline:`)
    console.log(`     - Binding:          ${pipelineResult.timings.bindTime}ms`)
    console.log(`     - IR Conversion:    ${pipelineResult.timings.convertTime}ms`)
    console.log(`     - IR Compilation:   ${pipelineResult.timings.compileTime}ms`)
    console.log(`   Total Time:          ${pipelineResult.timings.totalTime}ms`)

    console.log('\n📊 Workflow Summary:')
    console.log(`   IntentContract Steps: ${pipelineResult.intentContract.steps.length}`)
    console.log(`   Execution Graph Nodes: ${pipelineResult.executionGraph.nodes.length}`)
    console.log(`   PILOT DSL Steps: ${pipelineResult.pilotSteps.length}`)

    console.log('\n📊 Validation Summary:')
    console.log(`   Errors: ${validation.errors}`)
    console.log(`   Warnings: ${validation.warnings}`)

    if (validation.errors === 0) {
      console.log('\n✅ WORKFLOW IS EXECUTABLE - Ready for runtime testing!')
    } else {
      console.log('\n❌ WORKFLOW HAS ERRORS - Not executable')
      process.exit(1)
    }

  } catch (error) {
    console.error('\n❌ Test failed:', error)
    throw error
  }
}

main().catch(console.error)
