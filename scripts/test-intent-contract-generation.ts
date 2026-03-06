/**
 * Test Intent Contract Generation - PRODUCTION SETUP
 *
 * Uses REAL production components:
 * - UserPluginConnections to get connected plugins
 * - PluginManagerV2 to get capabilities
 * - generateIntentContract with real Anthropic API
 * - Real Enhanced Prompt structure
 *
 * NO mocking, NO hardcoding
 */

import { generateIntentContract, type ConnectedPluginSummary } from '../lib/agentkit/v6/intent/index.js'
import { CapabilityBinder } from '../lib/agentkit/v6/capability-binding/index.js'
import { UserPluginConnections } from '../lib/server/user-plugin-connections.js'
import { PluginManagerV2 } from '../lib/server/plugin-manager-v2.js'
import { writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { createLogger } from '../lib/logger/index.js'

const logger = createLogger({ module: 'TEST', service: 'IntentContract' })

// Load environment variables from .env.local
const envPath = join(process.cwd(), '.env.local')
const envContent = readFileSync(envPath, 'utf-8')

// Parse all env vars
envContent.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.+)$/)
  if (match) {
    const [, key, value] = match
    process.env[key.trim()] = value.trim()
  }
})

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error('ANTHROPIC_API_KEY not found in .env.local')
}

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Supabase environment variables not found in .env.local')
}

// Production user ID (Offir)
const TEST_USER_ID = process.env.TEST_USER_ID || '08456106-aa50-4810-b12c-7ca84102da31'

// REAL Enhanced Prompt from production
const enhancedPrompt = {
  "plan_title": "Invoice & Receipt Extraction Agent (Gmail → Drive + Sheets + Summary Email)",
  "plan_description": "Extracts invoices/receipts from unread Gmail emails, stores the files in Google Drive, logs transactions over $50 to a Google Sheet tab, and emails you a summary of all extracted transactions.",
  "sections": {
    "data": [
      "- Scan Gmail for unread emails only.",
      "- From each unread email, consider PDF attachments and image attachments (e.g., .pdf, .jpg, .png) as candidate invoices/receipts.",
      "- Treat each attachment as a separate candidate transaction (do not combine multiple attachments into one transaction).",
      "- Capture source email metadata for each attachment: sender and subject.",
      "- Store each attachment file in a newly created Google Drive folder (folder name to be confirmed).",
      "- Extract standard transaction fields from each attachment: date, vendor, amount, currency, and invoice/receipt number."
    ],
    "actions": [
      "- For each candidate attachment, extract the standard fields (date, vendor, amount, currency, invoice/receipt number) as structured data.",
      "- If the agent cannot confidently find an amount for an attachment, skip creating a transaction record for it and add a note about it in the summary email (include sender + subject and the Drive file link).",
      "- If the extracted amount is greater than $50, append a new row to the specified Google Sheet tab (\"Expenses\").",
      "- If the extracted amount is $50 or less, do not write it to Google Sheets, but still include it in the summary email's \"all transactions\" table."
    ],
    "output": [
      "- Produce an email-friendly summary that includes a table of all extracted transactions (including transactions with amount <= $50).",
      "- Include a separate section listing only transactions with amount > $50.",
      "- Include a Google Drive link for each stored file.",
      "- Include source email info for each transaction (sender and subject).",
      "- Include totals summary (at minimum: number of transactions extracted, sum of amounts for all extracted transactions, and sum of amounts for the > $50 subset).",
      "- Include a separate note section listing any attachments that were skipped because the amount was missing/unclear."
    ],
    "delivery": [
      "- Send the summary email to offir.omer@gmail.com."
    ],
    "processing_steps": [
      "- Find unread emails in Gmail.",
      "- For each unread email, collect PDF and image attachments.",
      "- Create (or ensure) the target Google Drive folder exists, then upload/store each attachment there.",
      "- Extract standard fields from each stored attachment.",
      "- Split extracted transactions into two groups: amount > $50 and amount <= $50.",
      "- Append only the amount > $50 group to the specified Google Sheet tab.",
      "- Generate the summary email content with the required tables/sections and send it."
    ]
  },
  "specifics": {
    "services_involved": [
      "google-mail",
      "google-drive",
      "google-sheets",
      "chatgpt-research"
    ],
    "resolved_user_inputs": [
      { "key": "user_email", "value": "offir.omer@gmail.com" },
      { "key": "amount_threshold_usd", "value": "50" },
      { "key": "sheet_tab_name", "value": "Expenses" },
      { "key": "google_sheet_id_candidate", "value": "1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc" }
    ]
  }
}

// Convert Enhanced Prompt to natural language
const userPrompt = `
${enhancedPrompt.plan_description}

DATA SOURCES:
${enhancedPrompt.sections.data.join('\n')}

ACTIONS:
${enhancedPrompt.sections.actions.join('\n')}

OUTPUT:
${enhancedPrompt.sections.output.join('\n')}

DELIVERY:
${enhancedPrompt.sections.delivery.join('\n')}

PROCESSING STEPS:
${enhancedPrompt.sections.processing_steps.join('\n')}

USER INPUTS:
${enhancedPrompt.specifics.resolved_user_inputs.map(ui => `- ${ui.key}: ${ui.value}`).join('\n')}
`.trim()

/**
 * Get connected plugins for user using REAL production code
 */
async function getConnectedPlugins(userId: string): Promise<ConnectedPluginSummary[]> {
  // Use REAL UserPluginConnections
  const userConnections = UserPluginConnections.getInstance()
  const connections = await userConnections.getConnectedPlugins(userId)

  logger.info(`Found ${connections.length} connected plugins for user ${userId}`)

  if (connections.length === 0) {
    logger.warn('No connected plugins found. Using services_involved from Enhanced Prompt as fallback.')
    // Fallback: Use services_involved from Enhanced Prompt
    const pluginManager = await PluginManagerV2.getInstance()
    return enhancedPrompt.specifics.services_involved.map(pluginKey => {
      const def = pluginManager.getPluginDefinition(pluginKey)
      if (!def) {
        throw new Error(`Plugin ${pluginKey} not found in registry`)
      }
      return {
        plugin_key: pluginKey,
        display_name: def.plugin.name,
        capabilities: Object.keys(def.actions)
      }
    })
  }

  // Convert connections to ConnectedPluginSummary format
  const pluginManager = await PluginManagerV2.getInstance()
  return connections.map(conn => {
    const def = pluginManager.getPluginDefinition(conn.plugin_key)
    if (!def) {
      throw new Error(`Plugin ${conn.plugin_key} not found in registry`)
    }
    return {
      plugin_key: conn.plugin_key,
      display_name: def.plugin.name,
      capabilities: Object.keys(def.actions)
    }
  })
}

async function runTest() {
  logger.info('='.repeat(80))
  logger.info('Intent Contract Generation Test (PRODUCTION)')
  logger.info('='.repeat(80))

  logger.info('')
  logger.info(`Workflow: ${enhancedPrompt.plan_title}`)
  logger.info(`Test User ID: ${TEST_USER_ID}`)

  // Get REAL connected plugins
  const connectedPlugins = await getConnectedPlugins(TEST_USER_ID)

  logger.info('')
  logger.info('Connected Plugins:')
  connectedPlugins.forEach(p => {
    logger.info(`  - ${p.display_name} (${p.plugin_key}): ${p.capabilities.length} capabilities`)
  })

  logger.info('')
  logger.info('='.repeat(80))
  logger.info('Generating Intent Contract...')
  logger.info('='.repeat(80))

  try {
    const startTime = Date.now()

    const result = await generateIntentContract({
      userPrompt,
      connectedPlugins
    })

    const elapsedTime = Date.now() - startTime

    logger.info('')
    logger.info('✅ Intent Contract generated!')
    logger.info(`⏱️  ${elapsedTime}ms`)

    // Save outputs
    writeFileSync('/tmp/intent-contract.json', JSON.stringify(result.intent, null, 2))
    writeFileSync('/tmp/intent-contract-raw.txt', result.rawText)
    logger.info('📁 Saved to /tmp/intent-contract.json')

    // Validation
    logger.info('')
    logger.info('Validation:')
    logger.info(`  Version: ${result.intent.version}`)
    logger.info(`  Goal: ${result.intent.goal?.substring(0, 60)}...`)
    logger.info(`  Unit of work: ${result.intent.unit_of_work}`)
    logger.info(`  Plugins: ${result.intent.plugins.length}`)
    logger.info(`  Steps: ${result.intent.steps.length}`)
    logger.info(`  Outputs: ${result.intent.outputs.length}`)
    logger.info(`  Constraints: ${result.intent.constraints.length}`)

    // Show structure
    logger.info('')
    logger.info('Steps:')
    result.intent.steps.forEach((s: any, i: number) => {
      logger.info(`  ${i + 1}. [${s.kind}] ${s.name}`)
    })

    logger.info('')
    logger.info('Constraints:')
    result.intent.constraints.forEach((c: any, i: number) => {
      logger.info(`  ${i + 1}. [${c.kind}] ${c.value || c.rule || c.field_path}`)
    })

    if (result.intent.questions) {
      logger.info('')
      logger.info('Questions:')
      result.intent.questions.forEach((q: any) => {
        logger.info(`  ❓ ${q.question}`)
      })
    }

    // ============================================================================
    // PHASE 2: CAPABILITY BINDING
    // ============================================================================
    logger.info('')
    logger.info('='.repeat(80))
    logger.info('Phase 2: Capability Binding (Deterministic)')
    logger.info('='.repeat(80))

    const pluginManager = await PluginManagerV2.getInstance()
    const binder = new CapabilityBinder(pluginManager)

    const bindingStartTime = Date.now()
    const boundIntent = await binder.bind(result.intent)
    const bindingElapsedTime = Date.now() - bindingStartTime

    logger.info('')
    logger.info('✅ Capability binding complete!')
    logger.info(`⏱️  ${bindingElapsedTime}ms`)

    // Save bound intent
    writeFileSync('/tmp/bound-intent-contract.json', JSON.stringify(boundIntent, null, 2))
    logger.info('📁 Saved to /tmp/bound-intent-contract.json')

    // Analyze bindings
    const bindingStats = analyzeBindings(boundIntent.steps)
    logger.info('')
    logger.info('Binding Statistics:')
    logger.info(`  Total actionable steps: ${bindingStats.total}`)
    logger.info(`  Exact matches: ${bindingStats.exact}`)
    logger.info(`  Semantic matches: ${bindingStats.semantic}`)
    logger.info(`  Metadata matches: ${bindingStats.metadata}`)
    logger.info(`  Unbound: ${bindingStats.unbound}`)
    if (bindingStats.total > 0) {
      logger.info(`  Success rate: ${((1 - bindingStats.unbound / bindingStats.total) * 100).toFixed(1)}%`)
    }

    // Show sample bindings
    logger.info('')
    logger.info('Sample Bindings:')
    showSampleBindings(boundIntent.steps, 10)

    if (bindingStats.unbound > 0) {
      logger.info('')
      logger.warn('⚠️  Unbound Steps:')
      showUnboundSteps(boundIntent.steps)
    }

    logger.info('')
    logger.info('✅ PIPELINE COMPLETE (Phase 1 + Phase 2)!')
    logger.info(`⏱️  Total time: ${elapsedTime + bindingElapsedTime}ms`)

  } catch (error) {
    logger.error({ error }, '❌ Test failed')
    throw error
  }
}

function analyzeBindings(steps: any[], stats = { total: 0, exact: 0, semantic: 0, metadata: 0, unbound: 0 }): any {
  for (const step of steps) {
    // Skip control flow steps
    if (step.kind === 'decide' || step.kind === 'loop' || step.kind === 'parallel') {
      // But analyze their nested steps
      if (step.kind === 'loop' && step.do) {
        analyzeBindings(step.do, stats)
      }
      if (step.kind === 'decide') {
        if (step.then) analyzeBindings(step.then, stats)
        if (step.else) analyzeBindings(step.else, stats)
      }
      if (step.kind === 'parallel' && step.branches) {
        for (const branch of step.branches) {
          if (branch.steps) analyzeBindings(branch.steps, stats)
        }
      }
      continue
    }

    stats.total++

    if (step.binding_method === 'exact_match') {
      stats.exact++
    } else if (step.binding_method === 'semantic_match') {
      stats.semantic++
    } else if (step.binding_method === 'metadata_match') {
      stats.metadata++
    } else if (step.binding_method === 'unbound') {
      stats.unbound++
    }
  }

  return stats
}

function showSampleBindings(steps: any[], limit: number, shown = { count: 0 }): void {
  for (const step of steps) {
    if (shown.count >= limit) return

    if (step.plugin_key && step.action) {
      const confidence = step.binding_confidence !== undefined
        ? `${(step.binding_confidence * 100).toFixed(0)}%`
        : 'N/A'
      logger.info(`  ${step.id}: ${step.plugin_key}.${step.action} (${step.binding_method}, ${confidence})`)
      shown.count++
    }

    // Recurse into nested steps
    if (step.kind === 'loop' && step.do) {
      showSampleBindings(step.do, limit, shown)
    }
    if (step.kind === 'decide') {
      if (step.then) showSampleBindings(step.then, limit, shown)
      if (step.else) showSampleBindings(step.else, limit, shown)
    }
  }
}

function showUnboundSteps(steps: any[]): void {
  for (const step of steps) {
    if (step.binding_method === 'unbound' && step.kind !== 'decide' && step.kind !== 'loop' && step.kind !== 'parallel') {
      logger.warn(`  ${step.id} (${step.kind}): ${step.description || 'no description'}`)
      if (step.semantic_action) {
        logger.warn(`    semantic_action: ${step.semantic_action}`)
      }
    }

    // Recurse
    if (step.kind === 'loop' && step.do) {
      showUnboundSteps(step.do)
    }
    if (step.kind === 'decide') {
      if (step.then) showUnboundSteps(step.then)
      if (step.else) showUnboundSteps(step.else)
    }
  }
}

runTest()
