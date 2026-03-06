/**
 * Direct test of compiler fuzzy matching
 * Uses pre-generated IR from output directory
 */

import { ExecutionGraphCompiler } from '../lib/agentkit/v6/compiler/ExecutionGraphCompiler.js'
import { extractWorkflowConfig } from '../lib/agentkit/v6/utils/workflow-config-extractor.js'
import { PluginManagerV2 } from '../lib/server/plugin-manager-v2.js'
import fs from 'fs/promises'

async function test() {
  console.log('🧪 Testing Fuzzy Matching for Config Injection\n')

  // Initialize plugin manager
  console.log('🔌 Initializing plugin manager...')
  const pluginManager = await PluginManagerV2.getInstance()
  console.log(`✅ Loaded ${Object.keys(pluginManager.getAvailablePlugins()).length} plugins\n`)

  // Load pre-generated IR
  const irPath = 'output/vocabulary-pipeline/execution-graph-ir-v4.json'
  const enhancedPromptPath = 'enhanced-prompt-invoice-extraction.json'

  console.log(`📖 Loading IR from: ${irPath}`)
  const irData = JSON.parse(await fs.readFile(irPath, 'utf-8'))

  console.log(`📖 Loading enhanced prompt from: ${enhancedPromptPath}`)
  const enhancedPrompt = JSON.parse(await fs.readFile(enhancedPromptPath, 'utf-8'))

  // Extract workflow config
  const workflowConfig = extractWorkflowConfig(enhancedPrompt)
  console.log(`\n📋 Extracted workflow config (${Object.keys(workflowConfig).length} keys):`)
  for (const [key, value] of Object.entries(workflowConfig)) {
    const displayValue = typeof value === 'string' && value.length > 50
      ? value.substring(0, 47) + '...'
      : value
    console.log(`   ${key}: ${JSON.stringify(displayValue)}`)
  }

  // Compile with workflow config
  console.log(`\n🔨 Compiling IR with workflow config...`)
  const compiler = new ExecutionGraphCompiler(pluginManager)
  const result = await compiler.compile(irData, workflowConfig)

  if (result.success) {
    console.log('\n✅ Compilation successful!\n')

    // Check for fuzzy matching logs
    const fuzzyLogs = result.logs.filter(log => log.includes('Fuzzy matched'))
    const injectionLogs = result.logs.filter(log => log.includes('Injected'))

    console.log(`📊 Fuzzy Matching Results:`)
    console.log(`   Fuzzy matches: ${fuzzyLogs.length}`)
    console.log(`   Total injections: ${injectionLogs.length}`)

    if (fuzzyLogs.length > 0) {
      console.log(`\n🎯 Fuzzy Matches:`)
      fuzzyLogs.forEach(log => console.log(`   ${log}`))
    }

    if (injectionLogs.length > 0) {
      console.log(`\n💉 Config Injections:`)
      injectionLogs.forEach(log => console.log(`   ${log}`))
    }

    // Write output
    const outputDir = 'output/test-fuzzy-matching'
    await fs.mkdir(outputDir, { recursive: true })
    await fs.writeFile(
      `${outputDir}/pilot-dsl-steps.json`,
      JSON.stringify(result.workflow, null, 2)
    )
    console.log(`\n📁 Wrote PILOT DSL to ${outputDir}/pilot-dsl-steps.json`)

    // Check specific steps
    const step10 = result.workflow.find((s: any) => s.step_id === 'step10' || s.id === 'step10')
    if (step10) {
      console.log(`\n🔍 Step 10 (append_rows) config:`)
      console.log(JSON.stringify(step10.config, null, 2))
    }

  } else {
    console.log('\n❌ Compilation failed')
    console.log('Errors:', result.errors)
  }
}

test().then(() => {
  console.log('\n✨ Test completed')
  process.exit(0)
}).catch(error => {
  console.error('❌ Test failed:', error)
  process.exit(1)
})
