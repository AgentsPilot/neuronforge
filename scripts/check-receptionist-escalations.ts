/**
 * Did the receptionist record this refund request, and would it even look?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READ ONLY. Two questions, in the order they decide the outcome.
 *
 * 1. WOULD IT LOOK AT ALL. `draftClientReplies.steps.json` step4 asks what this
 *    business has SENT to the address the mail came from, and no rows means the
 *    message is none of the agent's business — it never reaches the classifier.
 *    A test sent from an address the business has never written to produces
 *    nothing, and looks exactly like the agent being broken.
 *
 * 2. WHAT IT RECORDED. A refund request is classified `needs_owner` (the prompt
 *    lists refunds beside complaints, disputes and discounts), and that branch
 *    writes one `reply_needs_owner` activity and labels the thread. It creates
 *    NO draft — step9 gates drafting on `outcome == 'draft'` — and it sends
 *    nothing, which `oneAgentTwoMailboxes.test.ts` enforces.
 *
 * Usage:
 *   npx tsx -r dotenv/config scripts/check-receptionist-escalations.ts \
 *     --owner=offir.omer@gmail.com --from=<the address you sent from> \
 *     dotenv_config_path=.env.local
 */

import { createClient } from '@supabase/supabase-js';

const arg = (name: string, fallback = '') =>
  process.argv.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;

const OWNER_EMAIL = arg('owner', 'offir.omer@gmail.com').toLowerCase();
const FROM = arg('from').toLowerCase();
const HOURS = Number(arg('hours', '48'));

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Run with -r dotenv/config and dotenv_config_path=.env.local');

  const db = createClient(url, key, { auth: { persistSession: false } });
  const since = new Date(Date.now() - HOURS * 3600_000).toISOString();

  /* The owner, by their login. */
  const { data: users } = await db.auth.admin.listUsers({ perPage: 1000 });
  const owner = users?.users.find(u => (u.email ?? '').toLowerCase() === OWNER_EMAIL);
  if (!owner) throw new Error(`No login for ${OWNER_EMAIL}`);
  console.log(`owner  ${OWNER_EMAIL}  ${owner.id}\n`);

  /* 1 ── would it look? */
  if (FROM) {
    /* The SAME window step4 uses: `sent_at >= today - stop_after_days`, and the
       catalogue's default for this agent is 14. A client emailed three months
       ago reads as a stranger, which is the non-obvious half of this check. */
    const STOP_AFTER_DAYS = Number(arg('stop-after', '14'));
    const windowStart = new Date(Date.now() - STOP_AFTER_DAYS * 86400_000).toISOString();

    const { data: sends } = await db
      .from('email_sends')
      .select('to_email, contact_id, sent_at')
      .eq('user_id', owner.id)
      .eq('to_email', FROM)
      .not('contact_id', 'is', null)
      .gte('sent_at', windowStart)
      .order('sent_at', { ascending: false })
      .limit(5);

    /* Outside the window too, so "you have emailed them, just too long ago" is
       distinguishable from "you have never emailed them". */
    const { data: everSent } = await db
      .from('email_sends')
      .select('sent_at')
      .eq('user_id', owner.id)
      .eq('to_email', FROM)
      .not('contact_id', 'is', null)
      .order('sent_at', { ascending: false })
      .limit(1);

    const ok = (sends ?? []).length > 0;
    console.log(`PRECONDITION  has this business emailed ${FROM} in the last ${STOP_AFTER_DAYS} days?`);
    if (ok) {
      console.log(`  YES — ${sends!.length} send(s) in window, newest ${sends![0].sent_at}`);
    } else if ((everSent ?? []).length) {
      console.log(`  NO — last send was ${everSent![0].sent_at}, OUTSIDE the ${STOP_AFTER_DAYS}-day window`);
      console.log('  → step4 finds nothing, so a real client reads as a stranger.');
    } else {
      console.log('  NO — this business has never emailed that address');
    }
    if (!ok) {
      console.log('  → step4 drops it as a stranger. It never reaches the classifier.');
      console.log('  → Send the business an email from this address FIRST, or test from');
      console.log('    an address that is already a client with prior sends.\n');
    } else {
      console.log('');
    }
  }

  /* 2 ── what it recorded. */
  const KINDS = ['reply_needs_owner', 'reply_drafted', 'reply_handled', 'enquiry_received'];
  const { data: rows } = await db
    .from('crm_activities')
    .select('id, activity_type, activity_date, description, source_thread_id, contact_id, created_at')
    .eq('user_id', owner.id)
    .in('activity_type', KINDS)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(25);

  console.log(`RECEPTIONIST ACTIVITY, last ${HOURS}h — ${(rows ?? []).length} row(s)\n`);
  for (const r of rows ?? []) {
    console.log(`  ${r.created_at}  ${r.activity_type}`);
    console.log(`    thread ${r.source_thread_id ?? '(none)'}  contact ${r.contact_id ?? '(none)'}`);
    const d = String(r.description ?? '').replace(/\s+/g, ' ').slice(0, 300);
    if (d) console.log(`    ${d}`);
    console.log('');
  }

  if (!(rows ?? []).length) {
    console.log('  Nothing yet. Either the agent has not run since the mail arrived');
    console.log('  (press Run now on "ניסוח תשובות למיילים" in עובד בשבילך), or the');
    console.log('  precondition above failed.');
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
