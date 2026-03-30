/**
 * Complete End-to-End Pipeline Test with Vocabulary Injection
 *
 * Full Flow:
 * 0. Extract vocabulary from connected plugins
 * 1. Generate IntentContract with vocabulary injection (LLM)
 * 2. Bind capabilities deterministically (CapabilityBinderV2)
 * 3. Convert to IR (IntentToIRConverter)
 * 4. Compile to PILOT DSL (ExecutionGraphCompiler)
 */

import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'
import { PluginVocabularyExtractor } from '../lib/agentkit/v6/vocabulary/PluginVocabularyExtractor'
import { generateGenericIntentContractV1 } from '../lib/agentkit/v6/intent/generate-intent'
import { CapabilityBinderV2 } from '../lib/agentkit/v6/capability-binding/CapabilityBinderV2'
import { IntentToIRConverter } from '../lib/agentkit/v6/compiler/IntentToIRConverter'
import { ExecutionGraphCompiler } from '../lib/agentkit/v6/compiler/ExecutionGraphCompiler'
import { PluginManagerV2 } from '../lib/server/plugin-manager-v2'

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env.local') })

interface ValidationError {
  severity: 'error' | 'warning'
  category: string
  step_id: string
  message: string
  details?: string
}

interface ValidationResult {
  errors: ValidationError[]
  stepsValidated: number
  actionSteps: number
  parametersValidated: number
}

/**
 * Validates PILOT DSL steps against plugin schemas
 * Checks:
 * - Required parameters are present
 * - Parameter types match schema expectations
 * - Parameter formats are correct (e.g., values is 2D array, range has A1 notation)
 */
function validatePilotDslAgainstSchemas(
  steps: any[],
  pluginManager: PluginManagerV2
): ValidationResult {
  const errors: ValidationError[] = []
  let stepsValidated = 0
  let actionSteps = 0
  let parametersValidated = 0

  function validateStepRecursive(step: any, parentPath: string = '') {
    stepsValidated++
    const stepPath = parentPath ? `${parentPath}.${step.step_id}` : step.step_id

    // Validate action steps
    if (step.type === 'action') {
      actionSteps++

      const plugin = pluginManager.getPluginDefinition(step.plugin)
      if (!plugin) {
        errors.push({
          severity: 'error',
          category: 'unknown_plugin',
          step_id: stepPath,
          message: `Unknown plugin: ${step.plugin}`,
        })
        return
      }

      const action = plugin.actions?.[step.operation]
      if (!action) {
        errors.push({
          severity: 'error',
          category: 'unknown_action',
          step_id: stepPath,
          message: `Unknown action: ${step.plugin}.${step.operation}`,
        })
        return
      }

      const paramSchema = action.parameters
      if (!paramSchema) {
        // No schema to validate against
        return
      }

      const required = paramSchema.required || []
      const properties = paramSchema.properties || {}

      // Check all required parameters present
      for (const paramName of required) {
        parametersValidated++

        if (!(paramName in step.config)) {
          errors.push({
            severity: 'error',
            category: 'missing_parameter',
            step_id: stepPath,
            message: `Missing required parameter '${paramName}' for ${step.plugin}.${step.operation}`,
          })
          continue
        }

        const paramValue = step.config[paramName]
        const paramDef = properties[paramName]

        if (!paramDef) continue

        // Validate parameter type and format
        const typeError = validateParameterType(paramName, paramValue, paramDef, step.plugin, step.operation)
        if (typeError) {
          errors.push({
            severity: 'error',
            category: 'parameter_type_mismatch',
            step_id: stepPath,
            message: typeError.message,
            details: typeError.details,
          })
        }
      }

      // Validate optional parameters that are present
      for (const paramName of Object.keys(step.config)) {
        if (required.includes(paramName)) continue // Already validated

        parametersValidated++
        const paramDef = properties[paramName]

        if (!paramDef) {
          errors.push({
            severity: 'warning',
            category: 'unknown_parameter',
            step_id: stepPath,
            message: `Unknown parameter '${paramName}' for ${step.plugin}.${step.operation}`,
          })
          continue
        }

        const paramValue = step.config[paramName]
        const typeError = validateParameterType(paramName, paramValue, paramDef, step.plugin, step.operation)
        if (typeError) {
          errors.push({
            severity: 'error',
            category: 'parameter_type_mismatch',
            step_id: stepPath,
            message: typeError.message,
            details: typeError.details,
          })
        }
      }
    }

    // Recursively validate nested steps (scatter_gather, conditional)
    if (step.type === 'scatter_gather' && step.scatter?.steps) {
      for (const nestedStep of step.scatter.steps) {
        validateStepRecursive(nestedStep, stepPath)
      }
    }

    if (step.type === 'conditional') {
      if (step.branches?.then) {
        for (const nestedStep of step.branches.then) {
          validateStepRecursive(nestedStep, `${stepPath}.then`)
        }
      }
      if (step.branches?.else) {
        for (const nestedStep of step.branches.else) {
          validateStepRecursive(nestedStep, `${stepPath}.else`)
        }
      }
    }
  }

  // Validate all top-level steps
  for (const step of steps) {
    validateStepRecursive(step)
  }

  return {
    errors,
    stepsValidated,
    actionSteps,
    parametersValidated,
  }
}

/**
 * Validates parameter type matches schema definition
 * Returns null if valid, error object if invalid
 */
function validateParameterType(
  paramName: string,
  paramValue: any,
  paramDef: any,
  pluginKey: string,
  actionName: string
): { message: string; details?: string } | null {
  // Skip validation for variable references (e.g., "{{config.user_email}}")
  if (typeof paramValue === 'string' && paramValue.includes('{{')) {
    return null // Variables are resolved at runtime
  }

  // Special case: Google Sheets 'values' parameter
  if (paramName === 'values' && pluginKey === 'google-sheets') {
    // Should be 2D array: [[val1, val2, val3]]
    if (!Array.isArray(paramValue)) {
      return {
        message: `Parameter 'values' must be an array for ${pluginKey}.${actionName}`,
        details: `Expected: [[...]], Got: ${typeof paramValue}`,
      }
    }

    // Check if it's 2D array
    if (paramValue.length > 0 && !Array.isArray(paramValue[0])) {
      return {
        message: `Parameter 'values' must be 2D array for ${pluginKey}.${actionName}`,
        details: `Expected: [["val1", "val2"]], Got: ["val1", "val2"] (missing outer array)`,
      }
    }
  }

  // Special case: Google Sheets 'range' parameter
  if (paramName === 'range' && pluginKey === 'google-sheets') {
    if (typeof paramValue === 'string') {
      // Should have A1 notation (either "SheetName!A:Z" or just "A:Z")
      const hasA1Notation = paramValue.includes(':') || paramValue.includes('!')
      if (!hasA1Notation) {
        return {
          message: `Parameter 'range' must include A1 notation for ${pluginKey}.${actionName}`,
          details: `Expected: "SheetName!A:Z" or "A:Z", Got: "${paramValue}"`,
        }
      }
    }
  }

  // Generic type validation
  const expectedType = paramDef.type

  if (expectedType === 'object' && typeof paramValue !== 'object') {
    return {
      message: `Parameter '${paramName}' must be an object for ${pluginKey}.${actionName}`,
      details: `Expected: object, Got: ${typeof paramValue}`,
    }
  }

  if (expectedType === 'array' && !Array.isArray(paramValue)) {
    return {
      message: `Parameter '${paramName}' must be an array for ${pluginKey}.${actionName}`,
      details: `Expected: array, Got: ${typeof paramValue}`,
    }
  }

  if (expectedType === 'string' && typeof paramValue !== 'string') {
    return {
      message: `Parameter '${paramName}' must be a string for ${pluginKey}.${actionName}`,
      details: `Expected: string, Got: ${typeof paramValue}`,
    }
  }

  if (expectedType === 'number' && typeof paramValue !== 'number') {
    return {
      message: `Parameter '${paramName}' must be a number for ${pluginKey}.${actionName}`,
      details: `Expected: number, Got: ${typeof paramValue}`,
    }
  }

  if (expectedType === 'boolean' && typeof paramValue !== 'boolean') {
    return {
      message: `Parameter '${paramName}' must be a boolean for ${pluginKey}.${actionName}`,
      details: `Expected: boolean, Got: ${typeof paramValue}`,
    }
  }

  return null // Valid
}

async function main() {
  console.log('🚀 Testing COMPLETE Pipeline with Vocabulary Injection')
  console.log('=' .repeat(80))
  console.log('\nThis tests the NEW deterministic pipeline with vocabulary-guided')
  console.log('IntentContract generation for accurate domain/capability matching.\n')
  console.log('=' .repeat(80))

  const userId = '08456106-aa50-4810-b12c-7ca84102da31'

  // Output directory
  const outputDir = path.join(process.cwd(), 'output', 'vocabulary-pipeline')
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  // =======================
  // PHASE 0: Extract Plugin Vocabulary
  // =======================
  console.log('\n📚 Phase 0: Extract Plugin Vocabulary')
  console.log('-'.repeat(80))

  const pluginManager = await PluginManagerV2.getInstance()
  console.log('✅ PluginManager initialized')

  // Define services_involved for this workflow
  const servicesInvolved = ['google-mail', 'google-drive', 'google-sheets', 'chatgpt-research']
  // Note: document-extractor will be auto-included as a system plugin

  const vocabularyExtractor = new PluginVocabularyExtractor(pluginManager)

  console.log(`Extracting vocabulary for services: ${servicesInvolved.join(', ')}`)
  console.log('   (System plugins like document-extractor, chatgpt-research will be auto-included)')
  const vocabulary = await vocabularyExtractor.extract(userId, { servicesInvolved })

  console.log(`\n✅ Vocabulary extracted:`)
  console.log(`   Domains: ${vocabulary.domains.length} (${vocabulary.domains.join(', ')})`)
  console.log(`   Capabilities: ${vocabulary.capabilities.length} (${vocabulary.capabilities.slice(0, 10).join(', ')}...)`)
  console.log(`   Plugins in vocabulary: ${vocabulary.plugins.length}`)
  console.log(`   Plugin keys: ${vocabulary.plugins.map(p => p.key).join(', ')}`)

  // Save vocabulary
  const vocabPath = path.join(outputDir, 'plugin-vocabulary.json')
  fs.writeFileSync(vocabPath, JSON.stringify(vocabulary, null, 2))
  console.log(`   Saved: ${vocabPath}`)

  // Save formatted vocabulary
  const vocabTextPath = path.join(outputDir, 'vocabulary-for-prompt.txt')
  const vocabText = vocabularyExtractor.formatForPrompt(vocabulary)
  fs.writeFileSync(vocabTextPath, vocabText)
  console.log(`   Saved: ${vocabTextPath}`)

  // =======================
  // PHASE 1: Generate IntentContract with Vocabulary
  // =======================
  console.log('\n🤖 Phase 1: Generate IntentContract (LLM with Vocabulary)')
  console.log('-'.repeat(80))

  // Check if custom prompt file provided as argument
  let enhancedPrompt: any
  const customPromptFile = process.argv[2]

  if (customPromptFile) {
    console.log(`Loading custom prompt from: ${customPromptFile}`)
    const promptPath = path.join(process.cwd(), customPromptFile)
    const promptContent = fs.readFileSync(promptPath, 'utf-8')
    enhancedPrompt = JSON.parse(promptContent)
  } else {
    // Default: Enhanced prompt for invoice extraction workflow
    enhancedPrompt = {
      plan_title: 'Invoice & Receipt Extraction Agent (Gmail → Drive + Sheets + Summary Email)',
      plan_description: 'Extracts invoices/receipts from unread Gmail emails, stores the files in Google Drive, logs transactions over $50 to a Google Sheet tab, and emails you a summary of all extracted transactions.',
      sections: {
        data: [
          '- Scan Gmail for unread emails only.',
          '- From each unread email, consider PDF attachments and image attachments (e.g., .pdf, .jpg, .png) as candidate invoices/receipts.',
          '- Treat each attachment as a separate candidate transaction (do not combine multiple attachments into one transaction).',
          '- Capture source email metadata for each attachment: sender and subject.',
          '- Store each attachment file in a newly created Google Drive folder.',
          '- Extract standard transaction fields from each attachment: date, vendor, amount, currency, and invoice/receipt number.',
        ],
        actions: [
          '- For each candidate attachment, extract the standard fields (date, vendor, amount, currency, invoice/receipt number) as structured data.',
          '- If the agent cannot confidently find an amount for an attachment, skip creating a transaction record for it.',
          '- If the extracted amount is greater than $50, append a new row to the specified Google Sheet tab ("Expenses").',
          '- If the extracted amount is $50 or less, do not write it to Google Sheets, but still include it in the summary email.',
        ],
        output: [
          '- Produce an email-friendly summary that includes a table of all extracted transactions.',
          '- Include a separate section listing only transactions with amount > $50.',
          '- Include a Google Drive link for each stored file.',
          '- Include source email info for each transaction (sender and subject).',
          '- Include totals summary (number of transactions extracted, sum of amounts).',
        ],
        delivery: ['- Send the summary email to offir.omer@gmail.com.'],
        processing_steps: [
          '- Find unread emails in Gmail.',
          '- For each unread email, collect PDF and image attachments.',
          '- Create the target Google Drive folder, then upload/store each attachment there.',
          '- Extract standard fields from each stored attachment.',
          '- Split extracted transactions into two groups: amount > $50 and amount <= $50.',
          '- Append only the amount > $50 group to the specified Google Sheet tab.',
          '- Generate the summary email content with the required tables/sections and send it.',
        ],
      },
      specifics: {
        services_involved: ['google-mail', 'google-drive', 'google-sheets', 'chatgpt-research'],
        user_inputs_required: [],
        resolved_user_inputs: [
          { key: 'user_email', value: 'offir.omer@gmail.com' },
          { key: 'amount_threshold_usd', value: '50' },
          { key: 'sheet_tab_name', value: 'Expenses' },
          { key: 'google_sheet_id', value: '1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc' },
        ],
      },
    }
  }

  console.log('Generating IntentContract with vocabulary guidance...')
  console.log(`   Available domains will guide LLM: ${vocabulary.domains.join(', ')}`)

  // Add resolved_user_inputs to vocabulary context
  if (enhancedPrompt.specifics?.resolved_user_inputs && enhancedPrompt.specifics.resolved_user_inputs.length > 0) {
    vocabulary.userContext = enhancedPrompt.specifics.resolved_user_inputs
    console.log(`   User context: ${enhancedPrompt.specifics.resolved_user_inputs.length} configuration values`)
  }

  const intentGenStart = Date.now()

  // Generate with vocabulary (will be injected into system prompt)
  const { intent: intentContract, rawText } = await generateGenericIntentContractV1({
    enhancedPrompt,
    vocabulary, // Pass vocabulary for injection
  })

  const intentGenTime = Date.now() - intentGenStart

  console.log(`\n✅ IntentContract generated (${intentGenTime}ms)`)
  console.log(`   Version: ${intentContract.version}`)
  console.log(`   Goal: ${intentContract.goal}`)
  console.log(`   Steps: ${intentContract.steps.length}`)

  // Save IntentContract
  const intentPath = path.join(outputDir, 'intent-contract.json')
  fs.writeFileSync(intentPath, JSON.stringify(intentContract, null, 2))
  console.log(`   Saved: ${intentPath}`)

  // Save raw LLM output
  const rawPath = path.join(outputDir, 'intent-raw-llm-output.txt')
  fs.writeFileSync(rawPath, rawText)

  // =======================
  // PHASE 2: Capability Binding (Deterministic)
  // =======================
  console.log('\n🔗 Phase 2: Capability Binding (DETERMINISTIC)')
  console.log('-'.repeat(80))

  const binder = new CapabilityBinderV2(pluginManager)

  console.log('Running deterministic capability binding...')
  const bindingStart = Date.now()
  const boundIntent = await binder.bind(intentContract, userId)
  const bindingTime = Date.now() - bindingStart

  let successfulBindings = 0
  let failedBindings = 0

  console.log(`\n✅ Binding complete (${bindingTime}ms)`)
  for (const step of boundIntent.steps) {
    if ('plugin_key' in step && step.plugin_key) {
      successfulBindings++
      const boundStep = step as any
      console.log(
        `   ✅ ${step.id}: ${boundStep.plugin_key}.${boundStep.action} (confidence: ${boundStep.binding_confidence?.toFixed(2) || 'N/A'})`
      )
    } else {
      failedBindings++
      console.log(`   ⚠️  ${step.id}: No binding (kind: ${step.kind})`)
    }
  }

  console.log(`\n   Summary: ${successfulBindings} bound, ${failedBindings} unbound`)

  // Save BoundIntent
  const boundIntentPath = path.join(outputDir, 'bound-intent-contract.json')
  fs.writeFileSync(boundIntentPath, JSON.stringify(boundIntent, null, 2))
  console.log(`   Saved: ${boundIntentPath}`)

  // =======================
  // PHASE 3: Intent → IR Conversion (Deterministic)
  // =======================
  console.log('\n🔄 Phase 3: Intent → IR Conversion (DETERMINISTIC)')
  console.log('-'.repeat(80))

  const converter = new IntentToIRConverter(pluginManager)
  console.log('✅ IntentToIRConverter initialized with PluginManager (schema-aware)')

  console.log('Converting BoundIntentContract → ExecutionGraph (IR v4)...')
  const conversionStart = Date.now()
  const conversionResult = converter.convert(boundIntent)
  const conversionTime = Date.now() - conversionStart

  if (!conversionResult.success || !conversionResult.ir) {
    console.error('❌ Conversion failed!')
    console.error('Errors:', conversionResult.errors)
    process.exit(1)
  }

  const executionGraphIR = conversionResult.ir

  console.log(`\n✅ Conversion complete (${conversionTime}ms)`)
  console.log(`   IR Version: ${executionGraphIR.ir_version}`)
  console.log(`   Start Node: ${executionGraphIR.execution_graph?.start}`)
  console.log(`   Total Nodes: ${executionGraphIR.execution_graph ? Object.keys(executionGraphIR.execution_graph.nodes).length : 0}`)

  if (conversionResult.warnings.length > 0) {
    console.log(`   ⚠️  Warnings: ${conversionResult.warnings.length}`)
  }

  // Save IR
  const irPath = path.join(outputDir, 'execution-graph-ir-v4.json')
  fs.writeFileSync(irPath, JSON.stringify(executionGraphIR, null, 2))
  console.log(`   Saved: ${irPath}`)

  // =======================
  // PHASE 4: IR Compilation (Deterministic)
  // =======================
  console.log('\n⚙️  Phase 4: IR Compilation (DETERMINISTIC)')
  console.log('-'.repeat(80))

  const compiler = new ExecutionGraphCompiler(pluginManager)

  // Extract workflow config from enhanced prompt (generic approach)
  const workflowConfig: Record<string, any> = {}
  for (const input of enhancedPrompt.specifics.resolved_user_inputs) {
    workflowConfig[input.key] = input.value
  }
  console.log(`Extracted workflow config: ${Object.keys(workflowConfig).length} parameters`)

  console.log('Compiling ExecutionGraph → PILOT DSL Steps...')
  const compilationStart = Date.now()
  const compilationResult = await compiler.compile(executionGraphIR, workflowConfig)
  const compilationTime = Date.now() - compilationStart

  if (!compilationResult.success || !compilationResult.workflow) {
    console.error('❌ Compilation failed!')
    console.error('Errors:', compilationResult.errors)
    if (compilationResult.errors) {
      compilationResult.errors.forEach((err: any) => {
        console.error(`   - ${err.message || err}`)
      })
    }
    process.exit(1)
  }

  const pilotSteps = compilationResult.workflow

  console.log(`\n✅ Compilation complete (${compilationTime}ms)`)
  console.log(`   PILOT Steps: ${pilotSteps.length}`)

  // Save PILOT DSL
  const pilotPath = path.join(outputDir, 'pilot-dsl-steps.json')
  fs.writeFileSync(pilotPath, JSON.stringify(pilotSteps, null, 2))
  console.log(`   Saved: ${pilotPath}`)

  // =======================
  // PHASE 5: PILOT DSL Schema Validation
  // =======================
  console.log('\n🔍 Phase 5: PILOT DSL Schema Validation')
  console.log('-'.repeat(80))

  console.log('Validating PILOT DSL steps against plugin schemas...')
  const validationResult = validatePilotDslAgainstSchemas(pilotSteps, pluginManager)

  if (validationResult.errors.length > 0) {
    console.error(`\n❌ PILOT DSL Validation Failed: ${validationResult.errors.length} errors\n`)
    validationResult.errors.forEach((err, idx) => {
      console.error(`   ${idx + 1}. [${err.severity.toUpperCase()}] Step ${err.step_id}: ${err.message}`)
      if (err.details) {
        console.error(`      Details: ${err.details}`)
      }
    })
    console.error('\n⚠️  Workflow cannot be executed - parameter issues detected')
    process.exit(1)
  }

  console.log(`✅ PILOT DSL validation passed`)
  console.log(`   Total steps validated: ${validationResult.stepsValidated}`)
  console.log(`   Action steps: ${validationResult.actionSteps}`)
  console.log(`   Parameters validated: ${validationResult.parametersValidated}`)
  console.log(`   Errors: 0`)

  // =======================
  // PHASE 6: Summary
  // =======================
  console.log('\n✅ Phase 6: Pipeline Summary')
  console.log('=' .repeat(80))

  const totalDeterministicTime = bindingTime + conversionTime + compilationTime

  console.log('\n🎉 COMPLETE PIPELINE WITH VOCABULARY INJECTION SUCCESSFUL!\n')

  console.log('Pipeline Flow:')
  console.log(`  0. ✅ Vocabulary Extraction → ${vocabulary.domains.length} domains, ${vocabulary.capabilities.length} capabilities`)
  console.log(`  1. ✅ IntentContract Generation (LLM) → ${intentContract.steps.length} steps (${intentGenTime}ms)`)
  console.log(`  2. ✅ CapabilityBinderV2 → ${successfulBindings} bindings (${bindingTime}ms)`)
  console.log(`  3. ✅ IntentToIRConverter → ${executionGraphIR.execution_graph ? Object.keys(executionGraphIR.execution_graph.nodes).length : 0} nodes (${conversionTime}ms)`)
  console.log(`  4. ✅ ExecutionGraphCompiler → ${pilotSteps.length} PILOT steps (${compilationTime}ms)`)

  console.log('\n📊 Performance Stats:')
  console.log(`   Intent Generation (LLM):   ${intentGenTime}ms`)
  console.log(`   Deterministic Pipeline:    ${totalDeterministicTime}ms`)
  console.log(`     - Binding:               ${bindingTime}ms`)
  console.log(`     - IR Conversion:         ${conversionTime}ms`)
  console.log(`     - IR Compilation:        ${compilationTime}ms`)
  console.log(`   Total Pipeline Time:       ${intentGenTime + totalDeterministicTime}ms`)

  console.log('\n📊 Binding Stats:')
  console.log(`   Intent Steps:              ${intentContract.steps.length}`)
  console.log(`   Successful Bindings:       ${successfulBindings}`)
  console.log(`   Failed Bindings:           ${failedBindings}`)
  console.log(`   Binding Success Rate:      ${((successfulBindings / (successfulBindings + failedBindings)) * 100).toFixed(1)}%`)

  console.log('\n📁 Output Files:')
  console.log(`   - ${vocabPath}`)
  console.log(`   - ${vocabTextPath}`)
  console.log(`   - ${intentPath}`)
  console.log(`   - ${boundIntentPath}`)
  console.log(`   - ${irPath}`)
  console.log(`   - ${pilotPath}`)

  console.log('\n✨ Key Achievement:')
  console.log('   🎯 Vocabulary-guided IntentContract generation')
  console.log('   🎯 LLM uses actual connected plugin domains')
  console.log('   🎯 Higher binding success rate expected')
  console.log('   🎯 Complete deterministic pipeline validated')

  console.log('\n' + '=' .repeat(80))
  console.log('✅ VOCABULARY-GUIDED DETERMINISTIC PIPELINE COMPLETE')
  console.log('=' .repeat(80))
}

main().catch((err) => {
  console.error('\n❌ Pipeline test failed:', err)
  console.error('\nStack trace:', err.stack)
  process.exit(1)
})
