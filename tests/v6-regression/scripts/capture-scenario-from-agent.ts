/**
 * Capture a complete v6-regression scenario from a saved agent.
 *
 * Reverse-engineers a live agent into the canonical scenario snapshot files by
 * re-running the SAME pipeline the production route
 * (`/api/v6/generate-ir-intent-contract`) runs — Phases 0-4 — but headless,
 * sourcing the Enhanced Prompt and the owner `user_id` from the agent row.
 *
 * Unlike `build-scenario-from-agent.ts` (EP + stored DSL only) this also
 * regenerates the Phase 1 IntentContract (LLM), Phase 3 data_schema, and a
 * FRESH Phase 4 DSL — so all snapshot files are mutually consistent (the
 * intent-contract.json actually compiles to the committed phase4 DSL).
 *
 * IMPORTANT: Phase 1 is an LLM call and is non-deterministic. Re-running may
 * emit a slightly different IntentContract. Capture, then review the IC before
 * committing.
 *
 * Writes (into tests/v6-regression/scenarios/<name>/):
 *   - enhanced-prompt.json               (from agent.user_prompt)
 *   - intent-contract.json               (Phase 1, fresh LLM)
 *   - phase2-bound-intent-contract.json  (Phase 2 binding, reference)
 *   - phase2-data-schema.json            (Phase 3 ir.execution_graph.data_schema)
 *   - phase4-pilot-dsl-steps.json        (Phase 4 compiled workflow, fresh)
 *   - phase4-workflow-config.json        (input_schema + creation metadata + plugins_used)
 *   - scenario.json.suggested            (skeleton metadata to review/rename to scenario.json)
 *
 * Does NOT overwrite an existing scenario.json (hand-authored metadata).
 *
 * Usage (run from project root, env preloaded):
 *   npx tsx --import ./scripts/env-preload.ts tests/v6-regression/scripts/capture-scenario-from-agent.ts <agent_id> <scenario_folder_name>
 */

import { config } from 'dotenv'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'
import { writeFileSync, existsSync, mkdirSync } from 'fs'
import { PluginVocabularyExtractor } from '../../../lib/agentkit/v6/vocabulary/PluginVocabularyExtractor'
import { generateGenericIntentContractV1 } from '../../../lib/agentkit/v6/intent/generate-intent'
import { CapabilityBinderV2 } from '../../../lib/agentkit/v6/capability-binding/CapabilityBinderV2'
import { IntentToIRConverter } from '../../../lib/agentkit/v6/compiler/IntentToIRConverter'
import { ExecutionGraphCompiler } from '../../../lib/agentkit/v6/compiler/ExecutionGraphCompiler'
import { PluginManagerV2 } from '../../../lib/server/plugin-manager-v2'

// __dirname = tests/v6-regression/scripts → repo root is three levels up
config({ path: resolve(__dirname, '../../../.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const [agentId, scenarioName] = process.argv.slice(2)
if (!agentId || !scenarioName) {
  console.error('Usage: tsx tests/v6-regression/scripts/capture-scenario-from-agent.ts <agent_id> <scenario_folder_name>')
  process.exit(1)
}

function w(dir: string, file: string, data: unknown) {
  writeFileSync(`${dir}/${file}`, JSON.stringify(data, null, 2))
  console.log('   wrote', file)
}

;(async () => {
  // ── Load agent row ────────────────────────────────────────────────────────
  const { data: agent, error } = await supabase
    .from('agents')
    .select('id, user_id, agent_name, user_prompt, pilot_steps, input_schema, agent_config, ai_reasoning, created_at')
    .eq('id', agentId)
    .single()
  if (error) { console.error('read failed:', error); process.exit(1) }

  const userId: string = agent.user_id
  let ep: any
  try { ep = JSON.parse(agent.user_prompt) } catch (e) {
    console.error('user_prompt is not parseable JSON — cannot capture scenario'); process.exit(1)
  }
  const servicesInvolved: string[] = ep?.specifics?.services_involved || []

  console.log(`Agent     : ${agent.agent_name} (${agent.id})`)
  console.log(`Owner     : ${userId}`)
  console.log(`Services  : ${servicesInvolved.join(', ')}`)

  const scenarioDir = resolve(__dirname, '..', 'scenarios', scenarioName)
  if (!existsSync(scenarioDir)) mkdirSync(scenarioDir, { recursive: true })
  console.log(`Scenario  : ${scenarioDir}\n`)

  w(scenarioDir, 'enhanced-prompt.json', ep)

  // ── Phase 0: vocabulary (owner's connected plugins, filtered to EP services) ─
  const pluginManager = await PluginManagerV2.getInstance()
  const vocabularyExtractor = new PluginVocabularyExtractor(pluginManager)
  const vocabulary = await vocabularyExtractor.extract(userId, { servicesInvolved })
  if (ep?.specifics?.resolved_user_inputs?.length) {
    vocabulary.userContext = ep.specifics.resolved_user_inputs
  }
  console.log(`Phase 0   : ${vocabulary.plugins.length} plugins, ${vocabulary.domains.length} domains in vocabulary`)
  console.log(`            plugins: ${vocabulary.plugins.map((p) => p.key).join(', ')}`)

  // ── Phase 1: IntentContract (LLM) ─────────────────────────────────────────
  const t1 = Date.now()
  const { intent: intentContract } = await generateGenericIntentContractV1({ enhancedPrompt: ep, vocabulary })
  console.log(`Phase 1   : IC generated in ${Date.now() - t1}ms — ${intentContract.steps.length} steps`)
  w(scenarioDir, 'intent-contract.json', intentContract)

  // ── Phase 2: capability binding ───────────────────────────────────────────
  const binder = new CapabilityBinderV2(pluginManager)
  const boundIntent = await binder.bind(intentContract, userId)
  const bound = boundIntent.steps.filter((s: any) => s?.plugin_key).length
  console.log(`Phase 2   : ${bound}/${boundIntent.steps.length} steps bound to plugins`)
  w(scenarioDir, 'phase2-bound-intent-contract.json', boundIntent)

  // ── Phase 3: IR conversion (data_schema lives here) ───────────────────────
  const converter = new IntentToIRConverter(pluginManager)
  const conversion = converter.convert(boundIntent)
  if (!conversion.success || !conversion.ir) {
    console.error('Phase 3 FAILED:', conversion.errors)
    process.exit(1)
  }
  const dataSchema = conversion.ir?.execution_graph?.data_schema ?? null
  console.log(`Phase 3   : IR ok — ${Object.keys(conversion.ir.execution_graph?.nodes || {}).length} nodes`)
  w(scenarioDir, 'phase2-data-schema.json', dataSchema)

  // ── Phase 4: compile to PILOT DSL (fresh, consistent with the IC above) ───
  const compiler = new ExecutionGraphCompiler(pluginManager)
  const compilation = await compiler.compile(conversion.ir)
  if (!compilation.success) {
    console.error('Phase 4 FAILED:', compilation.errors)
    process.exit(1)
  }
  const workflow = compilation.workflow
  console.log(`Phase 4   : DSL compiled — ${workflow.length} steps, plugins: ${(compilation.plugins_used || []).join(', ')}`)
  w(scenarioDir, 'phase4-pilot-dsl-steps.json', workflow)
  w(scenarioDir, 'phase4-workflow-config.json', {
    input_schema: agent.input_schema,
    plugins_used: compilation.plugins_used || [],
    creation_metadata: {
      agent_id: agent.id,
      agent_name: agent.agent_name,
      created_at: agent.created_at,
      thread_id: agent.agent_config?.creation_metadata?.thread_id,
      session_id: agent.agent_config?.creation_metadata?.session_id,
      platform_version: agent.agent_config?.creation_metadata?.platform_version,
    },
  })

  // ── scenario.json skeleton (review + rename to scenario.json) ─────────────
  const stepTypes = Array.from(new Set(workflow.map((s: any) => s.type || s.step_type).filter(Boolean)))
  const suggested = {
    name: `${agent.agent_name} — captured from live agent`,
    description: `Reverse-engineered from live agent ${agent.id} (created ${agent.created_at}). EP services_involved: ${servicesInvolved.join(', ')}. Captured via tests/v6-regression/scripts/capture-scenario-from-agent.ts on a fresh pipeline run.`,
    created: agent.created_at?.slice(0, 10),
    source: {
      type: 'live-agent-capture',
      pipeline: 'A',
      endpoint: 'tests/v6-regression/scripts/capture-scenario-from-agent.ts',
      agent_id: agent.id,
      agent_created_at: agent.created_at,
    },
    plugins: servicesInvolved,
    expected: {
      min_steps: workflow.length,
      step_types: stepTypes,
      phase_a_checks: 0,
      phase_d_success: true,
    },
  }
  w(scenarioDir, 'scenario.json.suggested', suggested)

  console.log('\n✅ Capture complete. Next:')
  console.log('   1. Review intent-contract.json (Phase 1 is non-deterministic).')
  console.log('   2. Review scenario.json.suggested, then save it as scenario.json.')
  console.log('   3. Run the suite: npx tsx --import ./scripts/env-preload.ts tests/v6-regression/run-regression.ts')
  process.exit(0)
})()
