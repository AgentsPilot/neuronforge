/**
 * Spike: compile the mailbox-enquiry agent, Phases 0 to 4.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS ASKING
 *
 * The mailbox channel files its leads through `crm.capture_enquiry`, an action
 * that exists so an enquiry read out of a mailbox becomes the SAME row as one
 * typed into the website's own form. The Enhanced Prompt deliberately does not
 * name it — naming an action in a prompt is the hardcoding the Platform Design
 * Principles forbid — so the question this answers is whether the pipeline
 * picks it from the schema on its own, against `create_contact` sitting right
 * beside it.
 *
 * It also answers two cheaper questions: whether the two configuration values
 * (`mail_query`, `field_labels`) survive as config rather than being baked into
 * the plan, and whether the whole thing compiles to a DSL at all.
 *
 * `scripts/test-complete-pipeline-with-vocabulary.ts` does the same five phases
 * but hardcodes its own `servicesInvolved`, which is why this exists rather
 * than a flag on that one.
 *
 *   npx tsx scripts/spike-mailbox-enquiry-agent.ts <enhanced-prompt.json> [--output-dir DIR]
 *
 * Phase 1 is one real LLM call, and it is non-deterministic: run it more than
 * once before concluding anything from a single result.
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { PluginVocabularyExtractor } from '../lib/agentkit/v6/vocabulary/PluginVocabularyExtractor';
import { generateGenericIntentContractV1 } from '../lib/agentkit/v6/intent/generate-intent';
import { CapabilityBinderV2 } from '../lib/agentkit/v6/capability-binding/CapabilityBinderV2';
import { IntentToIRConverter } from '../lib/agentkit/v6/compiler/IntentToIRConverter';
import { ExecutionGraphCompiler } from '../lib/agentkit/v6/compiler/ExecutionGraphCompiler';
import { PluginManagerV2 } from '../lib/server/plugin-manager-v2';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const USER_ID = '08456106-aa50-4810-b12c-7ca84102da31';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const promptFile = process.argv[2];
  if (!promptFile || promptFile.startsWith('--')) {
    console.error('Usage: npx tsx scripts/spike-mailbox-enquiry-agent.ts <enhanced-prompt.json> [--output-dir DIR]');
    process.exit(1);
  }

  const outputDir = arg('--output-dir') ?? path.join(process.cwd(), '.spike-output');
  fs.mkdirSync(outputDir, { recursive: true });

  const enhancedPrompt = JSON.parse(fs.readFileSync(path.resolve(promptFile), 'utf-8'));
  const servicesInvolved: string[] = enhancedPrompt.specifics?.services_involved ?? [];

  console.log('── Phase 0: vocabulary ' + '─'.repeat(50));
  const pluginManager = await PluginManagerV2.getInstance();
  const vocabulary = await new PluginVocabularyExtractor(pluginManager).extract(USER_ID, {
    servicesInvolved,
  });
  console.log(`   plugins: ${vocabulary.plugins.map((p: { key: string }) => p.key).join(', ')}`);

  /* Does the catalog the LLM is shown even contain the action we hope it picks? */
  const crm = vocabulary.plugins.find((p: { key: string }) => p.key === 'crm') as
    | { key: string; actions?: { name?: string; id?: string }[] }
    | undefined;
  const crmActions = (crm?.actions ?? []).map(a => a.name ?? a.id).filter(Boolean);
  console.log(`   crm actions offered: ${crmActions.join(', ') || '(none)'}`);
  console.log(`   capture_enquiry offered to the LLM: ${crmActions.includes('capture_enquiry')}`);

  if (enhancedPrompt.specifics?.resolved_user_inputs?.length) {
    vocabulary.userContext = enhancedPrompt.specifics.resolved_user_inputs;
  }

  /*
   * Phase 1 is the only paid, non-deterministic phase, so a saved contract can
   * be replayed through 2–4 for free. That is how you iterate on a binder or
   * compiler question without re-rolling the LLM — and without the result
   * quietly changing underneath you between runs.
   */
  const replayFrom = arg('--from-contract');
  let intentContract: unknown;

  if (replayFrom) {
    console.log('\n── Phase 1: SKIPPED, replaying a saved contract ' + '─'.repeat(25));
    const saved = JSON.parse(fs.readFileSync(path.resolve(replayFrom), 'utf-8'));
    /* Accept either the generator's envelope or a bare contract. */
    intentContract = saved.intent ?? saved;
  } else {
    console.log('\n── Phase 1: IntentContract (LLM) ' + '─'.repeat(40));
    const icResult = await generateGenericIntentContractV1({ enhancedPrompt, vocabulary });
    /* `{ intent, rawText, provider, model }` — the contract is `.intent`. */
    intentContract = (icResult as { intent?: unknown }).intent;
    fs.writeFileSync(path.join(outputDir, 'intent-contract.json'), JSON.stringify(icResult, null, 2));
  }

  const ic = intentContract as {
    goal?: string;
    config?: { key?: string }[];
    steps?: { id?: string; kind?: string; capability?: string; domain?: string }[];
  };
  console.log(`   goal: ${ic.goal ?? '(none)'}`);
  console.log(`   config: ${(ic.config ?? []).map(c => c.key).join(', ') || '(none)'}`);
  for (const s of ic.steps ?? []) {
    console.log(`   step ${s.id}: kind=${s.kind} domain=${s.domain ?? '-'} capability=${s.capability ?? '-'}`);
  }

  console.log('\n── Phase 2: capability binding ' + '─'.repeat(42));

  /*
   * `crm`, `scheduling`, `payments` and `website` carry
   * `visibility: "business_os"`, which keeps them out of the binding candidate
   * set unless a plan asks for them BY KEY — so they can never be auto-bound to
   * a generic capability like "create something". See
   * docs/PLUGIN_VISIBILITY_SCOPING.md.
   *
   * This agent genuinely wants `crm.capture_enquiry`, so it says so. That is
   * the mechanism working, not a workaround: we author this agent, so we are
   * the ones entitled to name the key. A user-written prompt would not be.
   */
  const allowedBusinessOsKeys = servicesInvolved.filter(k =>
    ['crm', 'scheduling', 'payments', 'website'].includes(k)
  );
  if (allowedBusinessOsKeys.length) {
    console.log(`   business_os keys opted in: ${allowedBusinessOsKeys.join(', ')}`);
  }

  const bound = await new CapabilityBinderV2(pluginManager).bind(
    intentContract as never,
    USER_ID,
    { allowedBusinessOsKeys }
  );
  fs.writeFileSync(path.join(outputDir, 'phase2-bound.json'), JSON.stringify(bound, null, 2));

  const boundSteps = (bound as { steps?: { id?: string; binding?: { plugin?: string; action?: string } }[] }).steps ?? [];
  for (const s of boundSteps) {
    console.log(`   ${s.id} → ${s.binding?.plugin ?? '?'}.${s.binding?.action ?? '?'}`);
  }

  console.log('\n── Phase 3: IR ' + '─'.repeat(58));
  const conversion = new IntentToIRConverter(pluginManager).convert(bound as never);
  const ir = (conversion as { ir?: unknown }).ir ?? conversion;
  fs.writeFileSync(path.join(outputDir, 'phase3-ir.json'), JSON.stringify(ir, null, 2));
  console.log('   converted');

  console.log('\n── Phase 4: DSL ' + '─'.repeat(57));
  const workflowConfig: Record<string, unknown> = {};
  for (const input of enhancedPrompt.specifics?.resolved_user_inputs ?? []) {
    workflowConfig[input.key] = input.value;
  }
  const compiled = await new ExecutionGraphCompiler(pluginManager).compile(
    ir as never,
    workflowConfig as never
  );
  fs.writeFileSync(path.join(outputDir, 'phase4-dsl.json'), JSON.stringify(compiled, null, 2));

  const steps =
    (compiled as { workflow_steps?: unknown[]; steps?: unknown[] }).workflow_steps ??
    (compiled as { steps?: unknown[] }).steps ??
    [];
  console.log(`   steps: ${steps.length}`);
  for (const s of steps as { id?: string; type?: string; plugin?: string; action?: string }[]) {
    console.log(`   ${s.id ?? '?'} type=${s.type ?? '?'} ${s.plugin ?? ''}${s.action ? '.' + s.action : ''}`);
  }

  console.log(`\nWrote phase output to ${outputDir}`);
}

main().catch(err => {
  console.error('\nSPIKE FAILED:', err?.message ?? err);
  if (err?.stack) console.error(err.stack.split('\n').slice(1, 6).join('\n'));
  process.exit(1);
});
