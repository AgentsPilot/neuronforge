/**
 * In-place DSL corrector — Item 11 / WP-58 (Batch 3, sub-phase 3A)
 *
 * Repairs an ALREADY-SAVED agent whose `ai_processing` step inside a scatter
 * references the scatter's loop variable in its instruction but does not carry
 * that variable in its `input` context (so the model never receives the value →
 * blank output columns). This does NOT self-heal on recalibration, hence the
 * scripted in-place edit.
 *
 * The detection is the SAME shared logic as the generation-time fix
 * (`lib/agentkit/v6/compiler/ai-input-context.ts`) — no divergent copy. The
 * rewrite mirrors `ExecutionGraphCompiler.compileAIOperation`'s labelled-object
 * promotion.
 *
 * SAFETY:
 *   - Default mode is a READ-ONLY dry run: it prints the before/after diff and
 *     writes NOTHING. It only writes when `--apply` is passed explicitly.
 *   - All DB access goes through `AgentRepository`, owner-scoped by `--user`
 *     (mandatory `.eq('user_id', userId)`); the write reuses batch-1's
 *     `updatePilotSteps`.
 *
 * USAGE:
 *   # Dry run (default — reads only, prints diff):
 *   npx tsx scripts/fix-ai-scatter-loopvar-input.ts --agent <AGENT_ID> --user <USER_ID>
 *
 *   # Apply (owner-scoped write):
 *   npx tsx scripts/fix-ai-scatter-loopvar-input.ts --agent <AGENT_ID> --user <USER_ID> --apply
 *
 * Env: this MUST stay the first import. It is a side-effecting module that runs
 * `dotenv.config({ path: .env.local })`. ES modules evaluate imports in source
 * order, so it loads env BEFORE the `AgentRepository → supabaseServer` chain
 * below is evaluated (which instantiates the Supabase client at module load and
 * would otherwise throw `supabaseUrl is required`). No `--import` flag needed.
 */

import './env-preload'
import { createLogger } from '@/lib/logger'
import { AgentRepository } from '@/lib/repositories/AgentRepository'
import {
  detectReferencedInScopeVariables,
  extractBaseVarName,
} from '@/lib/agentkit/v6/compiler/ai-input-context'

const logger = createLogger({ module: 'FixAIScatterLoopVarInput', service: 'V6-Item11' })

interface CliArgs {
  agentId: string
  userId: string
  apply: boolean
}

interface StepChange {
  stepId: string
  itemVariable: string
  injected: string[]
  before: unknown
  after: unknown
}

/** Parse `--agent`, `--user`, `--apply` flags. */
function parseArgs(argv: string[]): CliArgs {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag)
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined
  }
  const agentId = get('--agent')
  const userId = get('--user')
  const apply = argv.includes('--apply')
  if (!agentId || !userId) {
    throw new Error(
      'Missing required args. Usage: --agent <AGENT_ID> --user <USER_ID> [--apply]'
    )
  }
  return { agentId, userId, apply }
}

/** Base variable names currently bound in a DSL step's `input` field. */
function inputBaseVars(input: unknown): string[] {
  if (typeof input === 'string') {
    const b = extractBaseVarName(input)
    return b ? [b] : []
  }
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return Object.keys(input as Record<string, unknown>)
      .map(extractBaseVarName)
      .filter(Boolean)
  }
  return []
}

/**
 * Build the labelled-object input (same shape the compiler produces): the
 * existing primary input plus each injected variable as a `{{var}}` block.
 */
function buildLabelledInput(
  currentInput: unknown,
  extraVars: string[]
): Record<string, unknown> {
  const labelled: Record<string, unknown> = {}
  if (currentInput && typeof currentInput === 'object' && !Array.isArray(currentInput)) {
    Object.assign(labelled, currentInput as Record<string, unknown>)
  } else if (typeof currentInput === 'string' && currentInput.length > 0) {
    const bare = currentInput.replace(/\{\{|\}\}/g, '').trim()
    const primaryKey = bare.split('.').pop() || bare
    labelled[primaryKey] = `{{${bare}}}`
  }
  for (const v of extraVars) {
    if (!(v in labelled)) labelled[v] = `{{${v}}}`
  }
  return labelled
}

/**
 * Walk the DSL tree tracking the enclosing scatter/loop item variables. For each
 * `ai_processing` step whose instruction references an in-scope loop variable not
 * already in its input, rewrite `input` to a labelled object and record the change.
 */
function repairSteps(steps: any[], itemVarStack: string[], changes: StepChange[]): void {
  if (!Array.isArray(steps)) return

  for (const step of steps) {
    if (!step || typeof step !== 'object') continue

    if (step.type === 'ai_processing' && itemVarStack.length > 0) {
      const instruction = [step.prompt, step.description, step.config?.prompt_template]
        .filter((s): s is string => typeof s === 'string' && s.length > 0)
        .join('\n')
      const boundVars = inputBaseVars(step.input)
      const extraVars = detectReferencedInScopeVariables(
        instruction,
        itemVarStack,
        boundVars
      ).filter(v => !boundVars.includes(v))

      if (extraVars.length > 0) {
        const before = step.input
        const after = buildLabelledInput(step.input, extraVars)
        step.input = after
        changes.push({
          stepId: step.step_id || step.id || '(unknown)',
          itemVariable: itemVarStack[itemVarStack.length - 1],
          injected: extraVars,
          before,
          after,
        })
      }
    }

    // Recurse into nested scatter/loop bodies, extending the item-var scope.
    const childItemVar: string | undefined =
      step.scatter?.itemVariable || step.loop?.item_variable
    const nested: any[] | undefined = step.scatter?.steps || step.steps
    if (nested) {
      repairSteps(
        nested,
        childItemVar ? [...itemVarStack, childItemVar] : itemVarStack,
        changes
      )
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const repo = new AgentRepository()

  logger.info(
    { agentId: args.agentId, mode: args.apply ? 'APPLY' : 'DRY-RUN' },
    'Loading agent (owner-scoped)'
  )

  const { data: agent, error } = await repo.findById(args.agentId, args.userId)
  if (error || !agent) {
    logger.error(
      { err: error, agentId: args.agentId },
      'Agent not found for this user (owner-scoped read failed)'
    )
    process.exitCode = 1
    return
  }

  const pilotSteps = (agent as any).pilot_steps
  if (!Array.isArray(pilotSteps) || pilotSteps.length === 0) {
    logger.warn({ agentId: args.agentId }, 'Agent has no pilot_steps — nothing to repair')
    return
  }

  // Deep clone so the dry-run never mutates the loaded object in a way that leaks.
  const workingSteps = JSON.parse(JSON.stringify(pilotSteps))
  const changes: StepChange[] = []
  repairSteps(workingSteps, [], changes)

  if (changes.length === 0) {
    logger.info(
      { agentId: args.agentId },
      'No AI-in-scatter loop-variable wiring gaps found — no change needed'
    )
    return
  }

  for (const c of changes) {
    logger.info(
      {
        stepId: c.stepId,
        itemVariable: c.itemVariable,
        injected: c.injected,
        before: c.before,
        after: c.after,
      },
      `[Item 11/WP-58] Would inject loop variable(s) [${c.injected.join(', ')}] into AI step '${c.stepId}' input`
    )
  }

  if (!args.apply) {
    logger.info(
      { agentId: args.agentId, changeCount: changes.length },
      'DRY-RUN complete — no write performed. Re-run with --apply to persist.'
    )
    return
  }

  const { error: writeError } = await repo.updatePilotSteps(
    args.agentId,
    args.userId,
    workingSteps
  )
  if (writeError) {
    logger.error({ err: writeError, agentId: args.agentId }, 'Failed to persist pilot_steps')
    process.exitCode = 1
    return
  }

  logger.info(
    { agentId: args.agentId, changeCount: changes.length },
    'APPLIED — pilot_steps updated in place (owner-scoped). Recalibrate to verify.'
  )
}

main().catch(err => {
  logger.error({ err }, 'Script failed')
  process.exit(1)
})
