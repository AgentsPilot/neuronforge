/**
 * Import V6 regression scenarios as runnable agents.
 *
 * For each folder under tests/v6-regression/scenarios/, reads the scenario
 * artefacts and upserts an agent row + agent_configurations row keyed by
 * agent_config.scenario_slug, so the agent can be opened and run from the UI.
 *
 * Skips scenarios where scenario.expected.phase_e_success !== true.
 *
 * Default behaviour: upsert — update if a row with the same slug exists for
 * the user, insert otherwise. User-editable fields (status, mode, schedule,
 * trigger_conditions, connected_plugins) are preserved on update.
 *
 * Usage:
 *   npx tsx --import ./scripts/env-preload.ts scripts/import-regression-scenarios-as-agents.ts
 *   npx tsx --import ./scripts/env-preload.ts scripts/import-regression-scenarios-as-agents.ts --only expense-invoice-email-scanner
 *   npx tsx --import ./scripts/env-preload.ts scripts/import-regression-scenarios-as-agents.ts --dry-run
 *   npx tsx --import ./scripts/env-preload.ts scripts/import-regression-scenarios-as-agents.ts --insert-only
 *   npx tsx --import ./scripts/env-preload.ts scripts/import-regression-scenarios-as-agents.ts --update-only
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
  status: 'inserted' | 'updated' | 'skipped' | 'failed'
  agent_id?: string
  agent_name?: string
  reason?: string
}

type Mode = 'upsert' | 'insert-only' | 'update-only'

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
  const insertOnly = hasFlag('insert-only')
  const updateOnly = hasFlag('update-only')

  if (insertOnly && updateOnly) {
    console.error('--insert-only and --update-only are mutually exclusive')
    process.exit(1)
  }

  const mode: Mode = insertOnly ? 'insert-only' : updateOnly ? 'update-only' : 'upsert'

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
  console.log(`Mode:    ${mode}`)
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
    const nowIso = new Date().toISOString()

    const agentConfigField = {
      scenario_slug: slug,
      scenario_meta: scenario,
      enhanced_prompt: enhancedPrompt,
      intent_contract: intentContract,
    }

    let existingAgentId: string | null = null
    if (mode !== 'insert-only') {
      const { data: existing, error: lookupError } = await supabase
        .from('agents')
        .select('id')
        .eq('user_id', userId)
        .eq('agent_config->>scenario_slug', slug)
        .neq('status', 'deleted')
        .maybeSingle()

      if (lookupError) {
        results.push({ slug, status: 'failed', reason: `lookup failed: ${lookupError.message}` })
        console.log(`[FAIL] ${slug} — lookup: ${lookupError.message}`)
        continue
      }
      existingAgentId = existing?.id ?? null
    }

    if (mode === 'update-only' && !existingAgentId) {
      results.push({ slug, status: 'skipped', reason: 'no existing agent (update-only mode)' })
      console.log(`[SKIP] ${slug} — no existing agent (update-only)`)
      continue
    }

    const isUpdate = existingAgentId !== null
    const agentId = isUpdate ? existingAgentId! : crypto.randomUUID()
    const finalStatus: 'updated' | 'inserted' = isUpdate ? 'updated' : 'inserted'

    if (dryRun) {
      results.push({ slug, status: finalStatus, agent_id: agentId, agent_name: scenario.name })
      console.log(`[DRY] [${isUpdate ? 'UPDATE' : 'INSERT'}] ${slug} — "${scenario.name}" (${agentId}); ${dslSteps.length} steps; plugins: ${pluginsRequired.join(', ')}; ${inputSchema.length} input fields`)
      continue
    }

    if (isUpdate) {
      // Preserve user-editable fields: status, mode, schedule_cron, timezone, trigger_conditions, connected_plugins
      const { error: updateError } = await supabase
        .from('agents')
        .update({
          agent_name: scenario.name,
          description: scenario.description ?? null,
          user_prompt: intentContract?.goal ?? scenario.description ?? scenario.name,
          created_from_prompt: enhancedPrompt?.plan_description ?? null,
          pilot_steps: dslSteps,
          workflow_steps: dslSteps,
          plugins_required: pluginsRequired,
          input_schema: inputSchema,
          agent_config: agentConfigField,
          ai_generated_at: nowIso,
        })
        .eq('id', agentId)
        .eq('user_id', userId)

      if (updateError) {
        results.push({ slug, status: 'failed', reason: `agents update failed: ${updateError.message}` })
        console.log(`[FAIL] ${slug} — agents update: ${updateError.message}`)
        continue
      }
    } else {
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
        agent_config: agentConfigField,
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

      const { error: insertError } = await supabase.from('agents').insert([agentRow])
      if (insertError) {
        results.push({ slug, status: 'failed', reason: `agents insert failed: ${insertError.message}` })
        console.log(`[FAIL] ${slug} — agents insert: ${insertError.message}`)
        continue
      }
    }

    const { data: existingConfig } = await supabase
      .from('agent_configurations')
      .select('id')
      .eq('agent_id', agentId)
      .eq('user_id', userId)
      .maybeSingle()

    let configError: { message: string } | null = null
    if (existingConfig) {
      const { error } = await supabase
        .from('agent_configurations')
        .update({
          input_values: workflowConfig,
          input_schema: inputSchema,
          status: 'configured',
        })
        .eq('id', existingConfig.id)
      configError = error
    } else {
      const { error } = await supabase
        .from('agent_configurations')
        .insert([{
          id: crypto.randomUUID(),
          agent_id: agentId,
          user_id: userId,
          input_values: workflowConfig,
          input_schema: inputSchema,
          status: 'configured',
          created_at: nowIso,
        }])
      configError = error
    }

    if (configError) {
      console.log(`[WARN] ${slug} — agent_configurations: ${configError.message}`)
      results.push({ slug, status: finalStatus, agent_id: agentId, agent_name: scenario.name, reason: `config warning: ${configError.message}` })
    } else {
      results.push({ slug, status: finalStatus, agent_id: agentId, agent_name: scenario.name })
    }

    console.log(`[${isUpdate ? 'UPD' : 'INS'}] ${slug} — ${scenario.name} (${agentId})`)
  }

  const inserted = results.filter(r => r.status === 'inserted')
  const updated = results.filter(r => r.status === 'updated')
  const skipped = results.filter(r => r.status === 'skipped')
  const failed = results.filter(r => r.status === 'failed')

  console.log('\n======================================================================')
  console.log('IMPORT SUMMARY')
  console.log('======================================================================')

  if (inserted.length > 0) {
    console.log(`\nInserted (${inserted.length}):`)
    const idCol = Math.max(...inserted.map(r => (r.agent_id || '').length))
    for (const r of inserted) {
      console.log(`   ${(r.agent_id || '').padEnd(idCol)}  ${r.agent_name}`)
    }
  }

  if (updated.length > 0) {
    console.log(`\nUpdated (${updated.length}):`)
    const idCol = Math.max(...updated.map(r => (r.agent_id || '').length))
    for (const r of updated) {
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
