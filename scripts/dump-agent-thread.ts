/**
 * dump-agent-thread.ts — evidence collector for an AGENT-CREATION-FLOW RCA.
 *
 * Pulls the turn-by-turn creation conversation (the primary evidence for "which
 * phase authored a bad value, and why") plus the creation context, writes them to
 * c:/tmp/, and prints a per-iteration phase table + an optional "first appearance"
 * trace for a suspect value.
 *
 * Companion to scripts/dump-agent.ts (agent row: pilot_steps/input_schema) and
 * scripts/dump-calibration.ts (downstream calibration evidence). See the runbook:
 * docs/investigations/AGENT_CREATION_RCA_RUNBOOK.md
 *
 * Usage:
 *   npx tsx scripts/dump-agent-thread.ts <agent_id> [suspect_value]
 *   e.g. npx tsx scripts/dump-agent-thread.ts 3fc703fd-9834-... "Sheet1"
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';

config({ path: resolve(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const agentId = process.argv[2];
const suspect = process.argv[3]; // optional: a value to trace (e.g. "Sheet1")
if (!agentId) {
  console.error('Usage: tsx scripts/dump-agent-thread.ts <agent_id> [suspect_value]');
  process.exit(1);
}

const prefix = agentId.slice(0, 8);
const asStr = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));

(async () => {
  // 1) Agent row — creation context (original prompt, EP, clarification answers).
  const { data: agent, error: aErr } = await supabase
    .from('agents')
    .select('id, agent_name, agent_config, user_prompt, input_schema, pilot_steps')
    .eq('id', agentId)
    .single();
  if (aErr || !agent) {
    console.error('Agent lookup failed:', aErr);
    process.exit(1);
  }

  const aiCtx = agent.agent_config?.ai_context ?? {};
  const creationMeta = agent.agent_config?.creation_metadata ?? {};
  const clarAnswers =
    creationMeta?.clarification_answers ??
    creationMeta?.generated_plan?.clarification_answers ??
    aiCtx?.generated_plan?.clarification_answers ??
    null;

  writeFileSync(`c:/tmp/agent-${prefix}-aictx.json`, JSON.stringify(aiCtx, null, 2));
  writeFileSync(`c:/tmp/agent-${prefix}-creation-metadata.json`, JSON.stringify(creationMeta, null, 2));

  // 2) The thread — the turn-by-turn conversation (PRIMARY evidence).
  const { data: threads, error: tErr } = await supabase
    .from('agent_prompt_threads')
    .select('*')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false });
  if (tErr) {
    console.error('Thread lookup failed:', tErr);
    process.exit(1);
  }
  const thread = threads?.[0];
  if (thread) {
    writeFileSync(`c:/tmp/agent-${prefix}-thread.json`, JSON.stringify(thread, null, 2));
  }

  const iterations: any[] = thread?.metadata?.iterations ?? [];

  // ---- Report ----
  console.log('AGENT:', agent.agent_name, `(${agentId})`);
  console.log('ORIGINAL PROMPT:', asStr(aiCtx?.original_prompt ?? '(none)').slice(0, 300));
  console.log('CONFIDENCE:', aiCtx?.confidence ?? '(none)');
  console.log('CLARIFICATION ANSWERS:', clarAnswers ? JSON.stringify(clarAnswers) : '(none)');
  console.log('THREAD:', thread ? thread.id : '(no thread row found)');
  console.log('ITERATIONS:', iterations.length);
  console.log('');

  // Per-iteration phase table.
  console.log('# | phase | reqLen | resLen | question/verdict');
  iterations.forEach((it, i) => {
    const res = typeof it.response === 'string' ? safeParse(it.response) : it.response;
    let note = '';
    if (res?.question?.question) note = `Q ${res.question.id}: ${res.question.question}`;
    else if (res?.phase2_done) note = `phase2_done (${res.termination_reason ?? ''})`;
    else if (res?.enhanced_prompt) note = 'EP produced';
    else if (it.phase === 1) note = 'Phase 1 narrative';
    console.log(
      `${i} | ${it.phase} | ${asStr(it.request).length} | ${asStr(it.response).length} | ${note}`
    );
  });
  console.log('');

  // Optional: trace where a suspect value first appears (req vs res, prose vs structured).
  if (suspect) {
    console.log(`RCA HINT — first appearance of "${suspect}":`);
    let foundRes = -1;
    iterations.forEach((it, i) => {
      const req = asStr(it.request);
      const res = asStr(it.response);
      const inReq = req.includes(suspect);
      const inRes = res.includes(suspect);
      if (inReq || inRes) {
        console.log(`  iter ${i} (phase ${it.phase}): ${inReq ? 'REQUEST ' : ''}${inRes ? 'RESPONSE' : ''}`);
        if (inRes && foundRes === -1) foundRes = i;
      }
    });
    if (foundRes >= 0) {
      const it = iterations[foundRes];
      console.log(
        `  → AUTHORED in iter ${foundRes} (phase ${it.phase}) RESPONSE. That phase's prompt logic owns it.`
      );
      console.log(
        `  → Check prose-vs-structured divergence: does the narrative preserve the true intent while the`
      );
      console.log(`     structured value (resolved_user_inputs) is a guess? If so → an EP-production gap.`);
    } else {
      console.log(`  "${suspect}" never appears in any response — check the agent row / downstream instead.`);
    }
    console.log('');
  }

  console.log('WRITTEN:');
  console.log(`  c:/tmp/agent-${prefix}-thread.json           (metadata.iterations[] — the conversation)`);
  console.log(`  c:/tmp/agent-${prefix}-aictx.json            (ai_context: original_prompt, enhanced_prompt, confidence)`);
  console.log(`  c:/tmp/agent-${prefix}-creation-metadata.json (generated_plan.clarification_answers)`);
})();

function safeParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
