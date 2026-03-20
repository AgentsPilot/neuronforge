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

async function main() {
  console.log('🚀 Testing COMPLETE Pipeline with Vocabulary Injection')
  console.log('=' .repeat(80))
  console.log('\nThis tests the NEW deterministic pipeline with vocabulary-guided')
  console.log('IntentContract generation for accurate domain/capability matching.\n')
  console.log('=' .repeat(80))

  const userId = '08456106-aa50-4810-b12c-7ca84102da31'

  // Output directory: use --output-dir arg if provided, otherwise default
  const outputDirArgIndex = process.argv.indexOf('--output-dir')
  const outputDir = outputDirArgIndex !== -1 && process.argv[outputDirArgIndex + 1]
    ? path.resolve(process.argv[outputDirArgIndex + 1])
    : path.join(process.cwd(), 'output', 'vocabulary-pipeline')
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
  const vocabPath = path.join(outputDir, 'phase0-plugin-vocabulary.json')
  fs.writeFileSync(vocabPath, JSON.stringify(vocabulary, null, 2))
  console.log(`   Saved: ${vocabPath}`)

  // Save formatted vocabulary
  const vocabTextPath = path.join(outputDir, 'phase0-vocabulary-for-prompt.txt')
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
    const promptPath = path.resolve(customPromptFile)
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
  const intentPath = path.join(outputDir, 'phase1-intent-contract.json')
  fs.writeFileSync(intentPath, JSON.stringify(intentContract, null, 2))
  console.log(`   Saved: ${intentPath}`)

  // Save raw LLM output
  const rawPath = path.join(outputDir, 'phase1-intent-raw-llm-output.txt')
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
  const boundIntentPath = path.join(outputDir, 'phase2-bound-intent-contract.json')
  fs.writeFileSync(boundIntentPath, JSON.stringify(boundIntent, null, 2))
  console.log(`   Saved: ${boundIntentPath}`)

  // Log data_schema
  if (boundIntent.data_schema) {
    const slots = boundIntent.data_schema.slots
    const slotNames = Object.keys(slots)
    const sourceBreakdown = { plugin: 0, ai_declared: 0, inferred: 0 }
    for (const slot of Object.values(slots)) {
      const src = slot.schema.source || 'inferred'
      if (src in sourceBreakdown) sourceBreakdown[src as keyof typeof sourceBreakdown]++
    }

    console.log(`\n   📊 data_schema: ${slotNames.length} slots`)
    console.log(`      Sources: ${sourceBreakdown.plugin} plugin, ${sourceBreakdown.ai_declared} ai_declared, ${sourceBreakdown.inferred} inferred`)
    for (const [name, slot] of Object.entries(slots)) {
      const fields = slot.schema.properties ? Object.keys(slot.schema.properties).join(', ') : '-'
      console.log(`      • ${name} [${slot.schema.type}] (${slot.schema.source || 'inferred'}) → produced_by: ${slot.produced_by}`)
      if (slot.schema.properties) {
        console.log(`        fields: ${fields}`)
      }
    }

    // Save data_schema as separate file
    const dataSchemaPath = path.join(outputDir, 'phase2-data-schema.json')
    fs.writeFileSync(dataSchemaPath, JSON.stringify(boundIntent.data_schema, null, 2))
    console.log(`   Saved: ${dataSchemaPath}`)
  } else {
    console.log('\n   ⚠️  No data_schema generated')
  }

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
    for (const w of conversionResult.warnings) {
      console.log(`      - ${w}`)
    }
  }

  // Verify data_schema carried through to IR
  if (executionGraphIR.execution_graph?.data_schema) {
    const irSlots = Object.keys(executionGraphIR.execution_graph.data_schema.slots)
    console.log(`   📊 data_schema on IR: ${irSlots.length} slots ✅`)
  } else {
    console.log(`   ⚠️  data_schema NOT present on IR`)
  }

  // Save IR
  const irPath = path.join(outputDir, 'phase3-execution-graph-ir-v4.json')
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
  console.log(`   User-provided config: ${Object.keys(workflowConfig).length} parameters`)

  // Log IntentContract config defaults (carried through IR)
  if (executionGraphIR.config_defaults && executionGraphIR.config_defaults.length > 0) {
    console.log(`   IntentContract config_defaults: ${executionGraphIR.config_defaults.length} entries`)
    for (const entry of executionGraphIR.config_defaults) {
      const hasDefault = entry.default !== undefined
      const inUserConfig = entry.key in workflowConfig
      const status = inUserConfig ? '(user override)' : hasDefault ? '(default)' : '(no value!)'
      console.log(`      ${status} ${entry.key}: ${inUserConfig ? workflowConfig[entry.key] : hasDefault ? JSON.stringify(entry.default) : 'MISSING'}`)
    }
  } else {
    console.log(`   ⚠️  No config_defaults on IR — IntentContract config not carried through`)
  }

  // Save user-provided config (pre-merge)
  const configPath = path.join(outputDir, 'phase0-workflow-config.json')
  fs.writeFileSync(configPath, JSON.stringify(workflowConfig, null, 2))
  console.log(`   Saved: ${configPath}`)

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
  const pilotPath = path.join(outputDir, 'phase4-pilot-dsl-steps.json')
  fs.writeFileSync(pilotPath, JSON.stringify(pilotSteps, null, 2))
  console.log(`   Saved: ${pilotPath}`)

  // Save merged workflow config (IntentContract config defaults + user overrides)
  const mergedConfig: Record<string, any> = {}
  // Start with IntentContract config defaults (LLM-produced clean keys + translated values)
  if (executionGraphIR.config_defaults) {
    for (const entry of executionGraphIR.config_defaults) {
      if (entry.default !== undefined) {
        mergedConfig[entry.key] = entry.default
      }
    }
  }
  // Override with user-provided config where keys match
  for (const [key, value] of Object.entries(workflowConfig)) {
    if (key in mergedConfig) {
      mergedConfig[key] = value
    }
  }
  const mergedConfigPath = path.join(outputDir, 'phase4-workflow-config.json')
  fs.writeFileSync(mergedConfigPath, JSON.stringify(mergedConfig, null, 2))
  console.log(`   Saved: ${mergedConfigPath}`)

  // =======================
  // DATA SCHEMA VALIDATION SUMMARY (Phase 6.4)
  // =======================
  if (boundIntent.data_schema) {
    console.log('\n📐 Data Schema Validation Summary')
    console.log('-'.repeat(80))

    const slots = boundIntent.data_schema.slots
    const slotEntries = Object.entries(slots)
    let hasAnyType = false

    for (const [name, slot] of slotEntries) {
      const schema = slot.schema
      const fields = schema.properties ? Object.keys(schema.properties) : []
      const consumers = slot.consumed_by?.length || 0

      let status = '✅'
      if (schema.type === 'any') {
        status = '⚠️'
        hasAnyType = true
      }
      if (schema.type === 'array' && !schema.items) {
        status = '⚠️'
      }
      if (schema.type === 'object' && !schema.properties) {
        status = '⚠️'
      }

      console.log(`   ${status} ${name}`)
      console.log(`      type: ${schema.type} | source: ${schema.source || 'inferred'} | scope: ${slot.scope}`)
      console.log(`      produced_by: ${slot.produced_by} | consumed_by: ${consumers} step(s)`)
      if (fields.length > 0) {
        console.log(`      fields: ${fields.join(', ')}`)
      }
      if (schema.items) {
        console.log(`      items: ${schema.items.type}${schema.items.properties ? ` (${Object.keys(schema.items.properties).join(', ')})` : ''}`)
      }
    }

    console.log(`\n   Total slots: ${slotEntries.length}`)
    console.log(`   Has type "any": ${hasAnyType ? '⚠️  YES' : '✅ NO'}`)

    // Check O10 field reconciliation results
    const reconciliationLogs = (compilationResult.logs || []).filter((l: string) =>
      l.includes('O10') || l.includes('Phase 3.7') || l.includes('reconcil') || l.includes('schema map') || l.includes('field mismatch') || l.includes('field correction')
    )
    if (reconciliationLogs.length > 0) {
      console.log(`\n   🔧 O10 Field Reconciliation:`)
      reconciliationLogs.forEach((l: string) => console.log(`      ${l}`))
    } else {
      console.log(`\n   ⚠️  No O10 reconciliation logs found`)
    }

    // Check O11 config reference consistency results
    const configConsistencyLogs = (compilationResult.logs || []).filter((l: string) =>
      l.includes('O11') || l.includes('Phase 3.8') || l.includes('config key') || l.includes('Config reference') || l.includes('unreferenced')
    )
    if (configConsistencyLogs.length > 0) {
      console.log(`\n   🔧 O11 Config Reference Consistency:`)
      configConsistencyLogs.forEach((l: string) => console.log(`      ${l}`))
    }

    // Check compilation warnings for schema-related issues
    const schemaWarnings = (compilationResult.logs || []).filter((l: string) =>
      l.includes('Schema mismatch') || l.includes('Shape-preserving') ||
      l.includes('Loop "') || l.includes('AI-declared slot') || l.includes('Type mismatch')
    )
    if (schemaWarnings.length > 0) {
      console.log(`\n   ⚠️  Schema validation warnings from compiler:`)
      schemaWarnings.forEach((w: string) => console.log(`      - ${w}`))
    } else {
      console.log(`   ✅ No schema validation warnings from compiler`)
    }

    // Cross-step type compatibility summary (Task 6.5)
    const crossStepLog = (compilationResult.logs || []).find((l: string) =>
      l.includes('Cross-step type compatibility')
    )
    if (crossStepLog) {
      console.log(`   ${crossStepLog}`)
    }

    const typeMismatches = (compilationResult.logs || []).filter((l: string) =>
      l.includes('Type mismatch:')
    )
    if (typeMismatches.length > 0) {
      console.log(`\n   ⚠️  Producer→Consumer type mismatches:`)
      typeMismatches.forEach((w: string) => console.log(`      - ${w}`))
    }
  }

  // =======================
  // PHASE 5: Summary
  // =======================
  console.log('\n✅ Phase 5: Pipeline Summary')
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
