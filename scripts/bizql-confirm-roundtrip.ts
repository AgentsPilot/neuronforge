/**
 * Confirmation round-trip: park → confirm → replay frozen rows → send → log.
 *
 *   npx tsx --import ./scripts/env-preload.ts scripts/bizql-confirm-roundtrip.ts --email=you@example.com
 *   ... --live      actually send (default is a dry run)
 *
 * SAFETY
 *
 * Operates on ONE temporary contact created with the address you pass, and
 * deletes it afterwards. It never touches existing contacts, and without
 * `--live` no email is sent at all.
 *
 * WHAT IT PROVES that unit tests cannot
 *
 *   - the frozen rows survive a real round-trip through command_sessions;
 *   - the fingerprint check accepts an untampered plan;
 *   - business_chat_action_log actually records the attempt;
 *   - a SECOND confirmation sends nothing, because the UNIQUE index rejects the
 *     duplicate claim — against a live database, not a mock.
 */

import { crmContactRepository } from '@/lib/repositories/CRMContactRepository';
import { supabaseServer } from '@/lib/supabaseServer';
import { getConfirmationStore } from '@/lib/business-os/bizql/mutate/ConfirmationStore';
import { executeForEach } from '@/lib/business-os/bizql/mutate/ForEachExecutor';
import { runBusinessQuery } from '@/lib/business-os/bizql';
import type { ForEachQuery, FindQuery, QueryRow } from '@/lib/business-os/bizql/types';

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
}

const step = (n: number, label: string) => console.log(`\n${n}. ${label}`);
const ok = (m: string) => console.log(`   ✓ ${m}`);
const bad = (m: string) => console.log(`   ✗ ${m}`);

async function main() {
  const email = arg('email');
  const live = process.argv.includes('--live');

  if (!email || !email.includes('@')) {
    console.error('Pass --email=you@example.com');
    process.exit(1);
  }

  // Pick the account that owns the most contacts, as the other scripts do.
  const { data } = await supabaseServer.from('crm_contacts').select('user_id').limit(1000);
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const id = (row as { user_id: string }).user_id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const userId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];

  console.log(`user ${userId}`);
  console.log(`recipient ${email}`);
  console.log(live ? 'MODE: LIVE — one real email will be sent' : 'MODE: dry run — nothing sent');

  let contactId: string | undefined;

  try {
    // ---- 1. a temporary contact, so no real client is involved --------------
    step(1, 'Create a temporary contact');
    const created = await crmContactRepository.create({
      user_id: userId,
      first_name: 'BizQL',
      last_name: 'Roundtrip Test',
      email,
      stage: 'inquiry',
    } as Parameters<typeof crmContactRepository.create>[0]);

    if (created.error || !created.data) throw created.error ?? new Error('create failed');
    contactId = created.data.id;
    ok(`contact ${contactId}`);

    // ---- 2. resolve the rows a fan-out would act on ------------------------
    step(2, 'Resolve target rows');
    const find: FindQuery = {
      id: 's1',
      op: 'find',
      entity: 'contacts',
      where: [{ field: 'email', op: 'eq', value: email }],
      select: ['id', 'first_name', 'email'],
    };

    const found = await runBusinessQuery(find, { userId, consumer: 'test' });
    if (found.op !== 'find') throw new Error('expected a find result');
    ok(`${found.rows.length} row(s): ${found.rows.map((r) => r.email).join(', ')}`);

    const fanOut: ForEachQuery = {
      id: 's2',
      op: 'for_each',
      over: 's1',
      entity: 'contacts',
      action: 'send',
      params: {
        to: { $item: 'email' },
        subject: 'BizQL round-trip test',
        body: 'This is an automated test of the Business OS chat send path. No action needed.',
      },
    };

    // ---- 3. park it, exactly as the route does -----------------------------
    step(3, 'Park the write awaiting confirmation');
    const store = getConfirmationStore();
    const parked = await store.park({
      userId,
      steps: [fanOut],
      preview: [`${found.rows.length} recipient(s)`],
      utterance: 'send the test email',
      language: 'en',
      frozenRows: { s2: found.rows },
    });
    ok(`parked ${parked.confirmationId}`);

    // ---- 4. take it back, as a "yes" would ---------------------------------
    step(4, 'Retrieve the frozen plan');
    const pending = await store.take(userId);

    if (!pending) {
      bad('nothing pending — park/take round-trip is broken');
      return;
    }

    const frozen = (pending.frozenRows?.s2 ?? []) as QueryRow[];
    ok(`fingerprint accepted, ${frozen.length} frozen row(s) recovered`);

    if (frozen.length !== found.rows.length) {
      bad(`frozen ${frozen.length} but resolved ${found.rows.length}`);
    }

    // ---- 5. execute against the FROZEN rows --------------------------------
    step(5, live ? 'Send (live)' : 'Send (dry run)');
    const result = await executeForEach(
      fanOut,
      frozen,
      { userId, consumer: 'chat' },
      { planId: parked.confirmationId, dryRun: !live, language: 'en' }
    );

    console.log(
      `   attempted=${result.attempted} succeeded=${result.succeeded} ` +
        `failed=${result.failed} skipped=${result.skipped}`
    );
    for (const item of result.items) {
      console.log(`   → ${item.target ?? item.id}: ${item.ok ? 'ok' : `FAILED (${item.error})`}`);
    }

    await store.clear(userId);

    // ---- 6. the action log should have recorded it -------------------------
    if (live) {
      step(6, 'Check the action log');
      const log = await supabaseServer
        .from('business_chat_action_log')
        .select('status, target, provider, error')
        .eq('plan_id', parked.confirmationId);

      if (log.error) bad(log.error.message);
      else {
        ok(`${log.data?.length ?? 0} row(s) recorded`);
        for (const row of log.data ?? []) console.log(`   → ${JSON.stringify(row)}`);
      }

      // ---- 7. confirming twice must not send twice -------------------------
      step(7, 'Re-confirm the SAME plan (double-send check)');
      const second = await executeForEach(
        fanOut,
        frozen,
        { userId, consumer: 'chat' },
        { planId: parked.confirmationId, language: 'en' }
      );

      if (second.succeeded === 0 && second.skipped >= 1) {
        ok(`blocked — succeeded=${second.succeeded} skipped=${second.skipped}`);
      } else {
        bad(`DOUBLE SEND: succeeded=${second.succeeded} skipped=${second.skipped}`);
      }
    }
  } finally {
    if (contactId) {
      console.log('\nCleaning up');
      const removed = await crmContactRepository.delete(contactId, userId);
      console.log(removed.error ? `   ✗ ${removed.error.message}` : '   ✓ temporary contact removed');
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
