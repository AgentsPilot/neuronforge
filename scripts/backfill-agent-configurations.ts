/**
 * One-shot: backfill missing agent_configurations rows for agents
 * imported by import-regression-scenarios-as-agents.ts.
 *
 * Reads tests/v6-regression/imported-agents.json and, for every entry with
 * status === 'imported', inserts the corresponding agent_configurations row
 * if one does not already exist for that agent.
 *
 * Usage:
 *   npx tsx --import ./scripts/env-preload.ts scripts/backfill-agent-configurations.ts
 */

import fs from 'fs'
import path from 'path'

const REPORT_PATH = path.join(process.cwd(), 'tests', 'v6-regression', 'imported-agents.json')
const SCENARIOS_DIR = path.join(process.cwd(), 'tests', 'v6-regression', 'scenarios')

async function main() {
  const userId = process.env.TEST_USER_ID
  if (!userId) {
    console.error('TEST_USER_ID not found in .env.local')
    process.exit(1)
  }

  if (!fs.existsSync(REPORT_PATH)) {
    console.error(`Report not found: ${REPORT_PATH}`)
    process.exit(1)
  }

  const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf-8'))
  const imported = (report.results as any[]).filter(r => r.status === 'imported' && r.agent_id)

  if (imported.length === 0) {
    console.log('No imported agents in report.')
    process.exit(0)
  }

  const { createServerSupabaseClient } = await import('../lib/supabaseServer')
  const supabase = createServerSupabaseClient()

  console.log('======================================================================')
  console.log(`Backfilling agent_configurations for ${imported.length} agent(s)`)
  console.log('======================================================================\n')

  let inserted = 0
  let skipped = 0
  let failed = 0

  for (const entry of imported) {
    const { agent_id, agent_name, slug } = entry
    const configPath = path.join(SCENARIOS_DIR, slug, 'output', 'phase4-workflow-config.json')
    const intentPath = path.join(SCENARIOS_DIR, slug, 'intent-contract.json')

    if (!fs.existsSync(configPath)) {
      console.log(`[FAIL] ${slug} — workflow config not found at ${configPath}`)
      failed++
      continue
    }

    const workflowConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'))

    let inputSchema: any[] = []
    if (fs.existsSync(intentPath)) {
      const intent = JSON.parse(fs.readFileSync(intentPath, 'utf-8'))
      if (Array.isArray(intent.config)) {
        inputSchema = intent.config.map((c: any) => ({
          name: c.key,
          type: c.type || 'string',
          description: c.description || '',
          required: false,
          default: c.default ?? null,
        }))
      }
    }

    const { data: existing } = await supabase
      .from('agent_configurations')
      .select('id')
      .eq('agent_id', agent_id)
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle()

    if (existing) {
      console.log(`[SKIP] ${slug} — configuration already exists (${existing.id})`)
      skipped++
      continue
    }

    const configRow = {
      id: `${agent_id}-${userId}-${crypto.randomUUID()}`,
      agent_id,
      user_id: userId,
      input_values: workflowConfig,
      input_schema: inputSchema,
      status: 'configured',
      created_at: new Date().toISOString(),
    }

    const { error } = await supabase.from('agent_configurations').insert([configRow])
    if (error) {
      console.log(`[FAIL] ${slug} — ${error.message}`)
      failed++
      continue
    }

    console.log(`[OK]   ${slug} — ${agent_name} (${agent_id})`)
    inserted++
  }

  console.log('\n======================================================================')
  console.log(`Inserted: ${inserted}   Skipped: ${skipped}   Failed: ${failed}`)
  console.log('======================================================================')

  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
