import { createClient } from '@supabase/supabase-js';
const RECEPTIONIST = '4eec16a0-1310-4363-9801-a078beeb550d';
async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data } = await db.from('agents').select('agent_config, pilot_steps').eq('id', RECEPTIONIST).maybeSingle();
  const bos = ((data?.agent_config ?? {}) as Record<string, unknown>).business_os_automation as Record<string, unknown> ?? {};
  const steps = (data?.pilot_steps ?? []) as Record<string, unknown>[];
  const sg = steps.find(s => s.type === 'scatter_gather') as Record<string, unknown>;
  const inner = (sg?.scatter as Record<string, unknown>)?.steps as Record<string, unknown>[] ?? [];
  const gate = inner.find(s => s.type === 'conditional') as Record<string, unknown>;
  const c7c = (gate?.steps as Record<string, unknown>[])?.find(s => s.id === 'step7c') as Record<string, unknown>;
  const branch = (c7c?.steps as Record<string, unknown>[]) ?? [];
  const s8 = branch.find(s => s.id === 'step8') as Record<string, unknown>;
  const outcomes = ((s8?.output_schema as Record<string, unknown>)?.properties as Record<string, unknown>)?.outcome as { enum?: string[] };
  const s1 = steps.find(s => s.id === 'step1') as Record<string, unknown>;

  console.log('planVersion :', bos.planVersion, '   (was d03933cc)');
  console.log('branches    :', branch.map(s => s.id).join(', '));
  console.log('outcomes    :', JSON.stringify(outcomes?.enum));
  console.log('scan query  :', (s1?.params as Record<string, unknown>)?.query);
  const ready = (outcomes?.enum ?? []).includes('refund_request');
  console.log('\n' + (ready ? 'READY — the new plan is installed' : 'NOT YET — load the automations page on localhost'));
}
main().catch(e => { console.error(e.message); process.exit(1); });
