import { createClient } from '@supabase/supabase-js';
const OWNER = '08456106-aa50-4810-b12c-7ca84102da31';
const RECEPTIONIST = '4eec16a0-1310-4363-9801-a078beeb550d';
async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const now = Date.now();
  console.log('reading at', new Date(now).toISOString().slice(11,19), 'UTC\n');

  const { data: runs } = await db.from('agent_executions')
    .select('created_at, started_at, updated_at, status, execution_type, progress, retry_count, error_message, models_used')
    .eq('agent_id', RECEPTIONIST).gte('created_at', '2026-11-13T18:40:00Z')
    .order('created_at');
  console.log(`receptionist runs since 18:40: ${(runs ?? []).length}`);
  for (const r of (runs ?? []) as Record<string, unknown>[]) {
    const moved = r.started_at && r.updated_at
      ? Math.round((new Date(r.updated_at as string).getTime() - new Date(r.started_at as string).getTime()) / 1000)
      : null;
    console.log(`  ${String(r.created_at).slice(11,19)}  ${String(r.status).padEnd(10)} ${String(r.execution_type).padEnd(9)} prog=${String(r.progress ?? '-').padEnd(4)} moved=${moved === null ? '-' : moved + 's'}  models=${JSON.stringify(r.models_used ?? [])}`);
    if (r.error_message) console.log(`      error: ${String(r.error_message).slice(0, 180)}`);
  }

  const { data: a } = await db.from('agents').select('last_run, next_run').eq('id', RECEPTIONIST).maybeSingle();
  console.log(`\nlast_run ${a?.last_run}   next_run ${a?.next_run}`);

  const { count } = await db.from('crm_activities').select('id', { count: 'exact', head: true })
    .eq('user_id', OWNER).in('activity_type', ['reply_needs_owner','reply_drafted','reply_handled','reply_sent'])
    .gte('created_at', '2026-11-13T18:40:00Z');
  console.log(`escalations written since 18:40: ${count ?? 0}`);
}
main().catch(e => { console.error(e.message); process.exit(1); });
