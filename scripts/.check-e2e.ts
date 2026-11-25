import { createClient } from '@supabase/supabase-js';
const OWNER = '08456106-aa50-4810-b12c-7ca84102da31';
const RECEPTIONIST = '4eec16a0-1310-4363-9801-a078beeb550d';
async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  console.log('now (UTC):', new Date().toISOString().slice(0, 19), '\n');

  // 1. is the column gone?
  const { error: colErr } = await db.from('business_profiles').select('agents_may_reply_directly').limit(1);
  console.log('1. migration applied (column dropped):', colErr ? 'YES' : 'NO — still there');

  // 2. which plan is installed?
  const { data: a } = await db.from('agents').select('agent_config, pilot_steps').eq('id', RECEPTIONIST).maybeSingle();
  const steps = (a?.pilot_steps ?? []) as Record<string, unknown>[];
  const sg = steps.find(s => s.type === 'scatter_gather') as Record<string, unknown>;
  const inner = (sg?.scatter as Record<string, unknown>)?.steps as Record<string, unknown>[] ?? [];
  const gate = inner.find(s => s.type === 'conditional') as Record<string, unknown>;
  const c7c = (gate?.steps as Record<string, unknown>[])?.find(s => s.id === 'step7c') as Record<string, unknown>;
  const branch = (c7c?.steps as Record<string, unknown>[]) ?? [];
  const s8 = branch.find(s => s.id === 'step8') as Record<string, unknown>;
  const outcomes = ((s8?.output_schema as Record<string, unknown>)?.properties as Record<string, unknown>)?.outcome as { enum?: string[] };
  console.log('2. installed plan outcomes :', JSON.stringify(outcomes?.enum));
  console.log('   branches                :', branch.map(s => s.id).join(', '));

  // 3. is the refund agent installed?
  const { data: agents } = await db.from('agents').select('id, agent_config, status').eq('user_id', OWNER).is('deleted_at', null);
  const refund = (agents ?? []).find(x => ((x.agent_config as Record<string, unknown>)?.business_os_automation as Record<string, unknown>)?.id === 'assess_refund_requests');
  console.log('3. refund agent installed  :', refund ? `yes (${String(refund.id).slice(0,8)}, ${refund.status})` : 'NO');

  // 4. the run
  const { data: runs } = await db.from('agent_executions').select('created_at, status, progress').eq('agent_id', RECEPTIONIST).order('created_at', { ascending: false }).limit(2);
  console.log('\n4. receptionist runs:');
  for (const r of (runs ?? []) as Record<string, unknown>[]) console.log(`   ${String(r.created_at).slice(11,19)}  ${r.status}  prog=${r.progress}`);

  // 5. what it did
  const since = new Date(Date.now() - 60*60*1000).toISOString();
  const { data: acts } = await db.from('crm_activities').select('created_at, activity_type, title, source_thread_id')
    .eq('user_id', OWNER).gte('created_at', since).order('created_at');
  console.log(`\n5. activity in the last hour: ${(acts ?? []).length}`);
  for (const r of (acts ?? []) as Record<string, unknown>[]) console.log(`   ${String(r.created_at).slice(11,19)}  ${r.activity_type}  ${String(r.title ?? '').slice(0,45)}`);

  // 6. did a door go out?
  const { data: sends } = await db.from('email_sends').select('created_at, to_email, subject, email_kind')
    .eq('user_id', OWNER).gte('created_at', since).order('created_at', { ascending: false }).limit(5);
  console.log(`\n6. emails sent in the last hour: ${(sends ?? []).length}`);
  for (const e of (sends ?? []) as Record<string, unknown>[]) console.log(`   ${String(e.created_at).slice(11,19)} -> ${e.to_email}  [${e.email_kind}] ${String(e.subject ?? '').slice(0,40)}`);
}
main().catch(e => { console.error(e.message); process.exit(1); });
