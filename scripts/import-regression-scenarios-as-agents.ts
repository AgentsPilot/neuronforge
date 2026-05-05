/**
 * Import V6 regression scenarios as runnable agents.
 *
 * For each folder under tests/v6-regression/scenarios/, reads the scenario
 * artefacts and inserts a new agent row + agent_configurations row, so the
 * agent can be opened and run from the UI.
 *
 * Skips scenarios where scenario.expected.phase_e_success !== true.
 * Inserts new rows on every run (no upsert) — duplicates are expected.
 *
 * Usage:
 *   npx tsx --import ./scripts/env-preload.ts scripts/import-regression-scenarios-as-agents.ts
 *   npx tsx --import ./scripts/env-preload.ts scripts/import-regression-scenarios-as-agents.ts --only expense-invoice-email-scanner
 *   npx tsx --import ./scripts/env-preload.ts scripts/import-regression-scenarios-as-agents.ts --dry-run
 *
 * Requires: TEST_USER_ID in .env.local
 */

import fs from 'fs'
import path from 'path'

const SCENARIOS_DIR = path.join(process.cwd(), 'tests', 'v6-regression', 'scenarios')
const OUTPUT_REPORT = path.join(process.cwd(), 'tests', 'v6-regression', 'imported-agents.json')

interface ScenarioMeta {
  name: string
  description?: string
  plugins?: string[]
  expected?: {
    phase_e_success?: boolean
    [k: string]: any
  }
}

interface IntentContractConfig {
  key: string
  type: string
  description?: string
  default?: any
}

interface IntentContract {
  goal?: string
  config?: IntentContractConfig[]
  [k: string]: any
}

interface EnhancedPrompt {
  plan_title?: string
  plan_description?: string
  [k: string]: any
}

interface ImportResult {
  slug: string
  status: 'imported' | 'skipped' | 'failed'
  agent_id?: string
  agent_name?: string
  reason?: string
}

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`)
  return idx !== -1 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith('--')
    ? process.argv[idx + 1]
    : undefined
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

function readJsonOrNull<T>(p: string): T | null {
  if (!fs.existsSync(p)) return null
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as T
  } catch (e) {
    return null
  }
}

function walkPluginsFromSteps(steps: any[], acc: Set<string>): void {
  if (!Array.isArray(steps)) return
  for (const step of steps) {
    if (step?.plugin) acc.add(step.plugin)
    if (step?.scatter?.steps) walkPluginsFromSteps(step.scatter.steps, acc)
    if (step?.steps) walkPluginsFromSteps(step.steps, acc)
    if (step?.then_steps) walkPluginsFromSteps(step.then_steps, acc)
    if (step?.else_steps) walkPluginsFromSteps(step.else_steps, acc)
  }
}

function buildInputSchema(intent: IntentContract | null): any[] {
  if (!intent?.config || !Array.isArray(intent.config)) return []
  return intent.config.map(c => ({
    name: c.key,
    type: c.type || 'string',
    description: c.description || '',
    required: false,
    default: c.default ?? null,
  }))
}

async function main() {
  const onlySlug = getArg('only')
  const dryRun = hasFlag('dry-run')

  const userId = process.env.TEST_USER_ID
  if (!userId) {
    console.error('TEST_USER_ID not found in environment. Add it to .env.local')
    process.exit(1)
  }

  if (!fs.existsSync(SCENARIOS_DIR)) {
    console.error(`Scenarios directory not found: ${SCENARIOS_DIR}`)
    process.exit(1)
  }

  const scenarioSlugs = fs.readdirSync(SCENARIOS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .filter(s => !onlySlug || s === onlySlug)
    .sort()

  if (scenarioSlugs.length === 0) {
    console.error(`No scenarios found${onlySlug ? ` matching --only ${onlySlug}` : ''}`)
    process.exit(1)
  }

  console.log('======================================================================')
  console.log(`Importing ${scenarioSlugs.length} scenario(s) as agents${dryRun ? ' (DRY RUN)' : ''}`)
  console.log(`User ID: ${userId}`)
  console.log('======================================================================\n')

  const { createServerSupabaseClient } = await import('../lib/supabaseServer')
  const supabase = createServerSupabaseClient()

  const results: ImportResult[] = []

  for (const slug of scenarioSlugs) {
    const dir = path.join(SCENARIOS_DIR, slug)
    const scenarioPath = path.join(dir, 'scenario.json')
    const enhancedPromptPath = path.join(dir, 'enhanced-prompt.json')
    const intentContractPath = path.join(dir, 'intent-contract.json')
    const dslPath = path.join(dir, 'output', 'phase4-pilot-dsl-steps.json')
    const configPath = path.join(dir, 'output', 'phase4-workflow-config.json')

    const scenario = readJsonOrNull<ScenarioMeta>(scenarioPath)
    if (!scenario) {
      results.push({ slug, status: 'failed', reason: 'scenario.json missing or invalid' })
      console.log(`[FAIL] ${slug} — scenario.json missing or invalid`)
      continue
    }

    if (scenario.expected?.phase_e_success !== true) {
      results.push({ slug, status: 'skipped', reason: `phase_e_success: ${scenario.expected?.phase_e_success}` })
      console.log(`[SKIP] ${slug} — phase_e_success !== true`)
      continue
    }

    const enhancedPrompt = readJsonOrNull<EnhancedPrompt>(enhancedPromptPath)
    const intentContract = readJsonOrNull<IntentContract>(intentContractPath)
    const dslSteps = readJsonOrNull<any[]>(dslPath)
    const workflowConfig = readJsonOrNull<Record<string, any>>(configPath)

    if (!Array.isArray(dslSteps) || dslSteps.length === 0) {
      results.push({ slug, status: 'failed', reason: 'phase4-pilot-dsl-steps.json missing or empty' })
      console.log(`[FAIL] ${slug} — phase4-pilot-dsl-steps.json missing or empty`)
      continue
    }
    if (!workflowConfig) {
      results.push({ slug, status: 'failed', reason: 'phase4-workflow-config.json missing' })
      console.log(`[FAIL] ${slug} — phase4-workflow-config.json missing`)
      continue
    }

    const pluginsSet = new Set<string>()
    walkPluginsFromSteps(dslSteps, pluginsSet)
    const pluginsRequired = Array.from(pluginsSet)

    const inputSchema = buildInputSchema(intentContract)

    const agentId = crypto.randomUUID()
    const nowIso = new Date().toISOString()

    const agentRow = {
      id: agentId,
      user_id: userId,
      agent_name: scenario.name,
      description: scenario.description ?? null,
      user_prompt: intentContract?.goal ?? scenario.description ?? scenario.name,
      created_from_prompt: enhancedPrompt?.plan_description ?? null,
      pilot_steps: dslSteps,
      workflow_steps: dslSteps,
      plugins_required: pluginsRequired,
      connected_plugins: null,
      input_schema: inputSchema,
      output_schema: null,
      agent_config: {
        scenario_slug: slug,
        scenario_meta: scenario,
        enhanced_prompt: enhancedPrompt,
        intent_contract: intentContract,
      },
      status: 'active',
      mode: 'on_demand',
      schedule_cron: null,
      timezone: 'UTC',
      trigger_conditions: null,
      generated_plan: null,
      detected_categories: null,
      ai_reasoning: null,
      ai_confidence: null,
      ai_generated_at: nowIso,
    }

    const configRow = {
      id: `${agentId}-${userId}-${crypto.randomUUID()}`,
      agent_id: agentId,
      user_id: userId,
      input_values: workflowConfig,
      input_schema: inputSchema,
      status: 'configured',
      created_at: nowIso,
    }

    if (dryRun) {
      results.push({ slug, status: 'imported', agent_id: agentId, agent_name: scenario.name })
      console.log(`[DRY] ${slug} — would insert agent "${scenario.name}" (${agentId}); ${dslSteps.length} steps; plugins: ${pluginsRequired.join(', ')}; ${inputSchema.length} input fields`)
      continue
    }

    const { error: agentError } = await supabase.from('agents').insert([agentRow])
    if (agentError) {
      results.push({ slug, status: 'failed', reason: `agents insert failed: ${agentError.message}` })
      console.log(`[FAIL] ${slug} — agents insert: ${agentError.message}`)
      continue
    }

    const { error: configError } = await supabase.from('agent_configurations').insert([configRow])
    if (configError) {
      console.log(`[WARN] ${slug} — agent_configurations insert: ${configError.message}`)
      results.push({ slug, status: 'imported', agent_id: agentId, agent_name: scenario.name, reason: `config insert warning: ${configError.message}` })
    } else {
      results.push({ slug, status: 'imported', agent_id: agentId, agent_name: scenario.name })
    }

    console.log(`[OK]  ${slug} — ${scenario.name} (${agentId})`)
  }

  const imported = results.filter(r => r.status === 'imported')
  const skipped = results.filter(r => r.status === 'skipped')
  const failed = results.filter(r => r.status === 'failed')

  console.log('\n======================================================================')
  console.log('IMPORT SUMMARY')
  console.log('======================================================================')

  if (imported.length > 0) {
    console.log(`\nImported (${imported.length}):`)
    const idCol = Math.max(...imported.map(r => (r.agent_id || '').length))
    for (const r of imported) {
      console.log(`   ${(r.agent_id || '').padEnd(idCol)}  ${r.agent_name}`)
    }
  }

  if (skipped.length > 0) {
    console.log(`\nSkipped (${skipped.length}):`)
    for (const r of skipped) {
      console.log(`   ${r.slug.padEnd(40)} — ${r.reason}`)
    }
  }

  if (failed.length > 0) {
    console.log(`\nFailed (${failed.length}):`)
    for (const r of failed) {
      console.log(`   ${r.slug.padEnd(40)} — ${r.reason}`)
    }
  }

  if (!dryRun) {
    fs.writeFileSync(OUTPUT_REPORT, JSON.stringify({
      timestamp: new Date().toISOString(),
      user_id: userId,
      results,
    }, null, 2))
    console.log(`\nReport saved: ${OUTPUT_REPORT}`)
  }

  console.log('======================================================================')

  process.exit(failed.length > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
