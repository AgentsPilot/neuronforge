/**
 * E2E Test: Business Requirements → GPT-4 Narrative → V6 Pipeline
 *
 * Step 1: GPT-4 generates narrative prompt from business requirements
 * Step 2: Use existing V6 pipeline test with the generated narrative
 * Step 3: Validate the workflow
 */

import fs from 'fs'
import path from 'path'
import { config as dotenvConfig } from 'dotenv'
import OpenAI from 'openai'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

// Load environment variables
dotenvConfig({ path: '.env.local' })

interface BusinessRequirements {
  title: string
  description?: string
  data: string[]
  actions: string[]
  output?: string[]
  delivery?: string[]
  config_parameters?: Record<string, any>
  specifics?: {
    services_involved?: string[]
    user_inputs_required?: any[]
    resolved_user_inputs?: Array<{
      key: string
      value: any
    }>
  }
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

Return ONLY the narrative prompt text (no JSON wrapper, no markdown code blocks).`

async function generateNarrativePrompt(
  requirements: BusinessRequirements,
  apiKey: string
): Promise<string> {
  console.log('\n🤖 Step 1: Generate Narrative Prompt (GPT-4)')
  console.log('=' .repeat(80))

  const client = new OpenAI({ apiKey })

  const requirementsText = `
# Business Requirements: ${requirements.title}

${requirements.description ? `## Description\n${requirements.description}\n` : ''}

## Data
${requirements.data.join('\n')}

## Actions
${requirements.actions.join('\n')}

${requirements.output ? `## Output\n${requirements.output.join('\n')}\n` : ''}

${requirements.delivery ? `## Delivery\n${requirements.delivery.join('\n')}\n` : ''}

${requirements.config_parameters ? `## Configuration Parameters\n${JSON.stringify(requirements.config_parameters, null, 2)}\n` : ''}

${requirements.specifics ? `## Specifics\n${JSON.stringify(requirements.specifics, null, 2)}\n` : ''}
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

async function main() {
  console.log('🚀 E2E Test: Business Requirements → GPT-4 Narrative → V6 Pipeline')
  console.log('=' .repeat(80))

  // Check if business requirements file provided
  const requirementsFile = process.argv[2]
  if (!requirementsFile) {
    console.error('❌ Usage: npx tsx scripts/test-gpt4-narrative-e2e.ts <requirements-file.json>')
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

  try {
    // Step 1: Generate narrative prompt from business requirements
    const narrativePrompt = await generateNarrativePrompt(requirements, apiKey)

    // Save narrative prompt as JSON file (matching existing format)
    // Convert resolved_user_inputs to config parameters if not explicitly provided
    let config: Record<string, any> = {}

    if (requirements.config_parameters) {
      config = requirements.config_parameters
    } else if (requirements.specifics?.resolved_user_inputs) {
      // Convert resolved_user_inputs array to config object
      config = requirements.specifics.resolved_user_inputs.reduce((acc, input) => {
        acc[input.key] = input.value
        return acc
      }, {} as Record<string, any>)
      console.log(`\n💡 Converted ${requirements.specifics.resolved_user_inputs.length} resolved_user_inputs to config parameters`)
    }

    const narrativePromptFile = {
      prompt: narrativePrompt,
      config: config
    }

    const narrativeJsonPath = path.join(process.cwd(), 'enhanced-prompt-gpt4-generated.json')
    fs.writeFileSync(narrativeJsonPath, JSON.stringify(narrativePromptFile, null, 2))
    console.log(`\n💾 Saved narrative prompt file: ${narrativeJsonPath}`)

    // Step 2: Run existing V6 pipeline test with the generated narrative
    console.log('\n📊 Step 2: Run V6 Pipeline with Generated Narrative')
    console.log('=' .repeat(80))

    console.log('🔄 Running: npx tsx scripts/test-narrative-prompt-experiment.ts enhanced-prompt-gpt4-generated.json')

    const { stdout, stderr } = await execAsync(
      'npx tsx scripts/test-narrative-prompt-experiment.ts enhanced-prompt-gpt4-generated.json'
    )

    console.log(stdout)
    if (stderr) console.error(stderr)

    // Step 3: Validate the generated workflow
    console.log('\n🔍 Step 3: Validate Generated Workflow')
    console.log('=' .repeat(80))

    console.log('🔄 Running: npx tsx scripts/validate-narrative-workflow.ts')

    const validationResult = await execAsync('npx tsx scripts/validate-narrative-workflow.ts')

    console.log(validationResult.stdout)
    if (validationResult.stderr) console.error(validationResult.stderr)

    console.log('\n' + '=' .repeat(80))
    console.log('🎉 E2E TEST COMPLETE')
    console.log('=' .repeat(80))

    console.log('\n📁 Output Files:')
    console.log(`   - Narrative Prompt: enhanced-prompt-gpt4-generated.json`)
    console.log(`   - IntentContract: output/vocabulary-pipeline/intent-contract.json`)
    console.log(`   - PILOT DSL: output/vocabulary-pipeline/pilot-dsl-steps.json`)
    console.log(`   - Validation: output/vocabulary-pipeline/validation-results.json`)

  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message)
    if (error.stdout) console.log(error.stdout)
    if (error.stderr) console.error(error.stderr)
    throw error
  }
}

main().catch(console.error)
