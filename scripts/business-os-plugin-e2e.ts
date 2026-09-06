/**
 * The Business OS plugin, end to end against the real database.
 *
 *   npx tsx --import ./scripts/env-preload.ts scripts/business-os-plugin-e2e.ts
 *
 * READ-ONLY. Every write attempted here is one that MUST be refused, so a pass
 * means nothing was written. No email is sent.
 *
 * What this proves, and why it is the whole point of the bridge: an agent going
 * through the plugin inherits every guard the chat earned, and cannot opt out of
 * any of them. If a single one of these refusals stops working, an LLM-authored
 * workflow can damage the user's business data.
 */

import PluginManagerV2 from '@/lib/server/plugin-manager-v2';
import { UserPluginConnections } from '@/lib/server/user-plugin-connections';
import { BusinessOsPluginExecutor } from '@/lib/server/business-os-plugin-executor';
import { supabaseServer } from '@/lib/supabaseServer';

const ok = (m: string) => console.log(`   ✓ ${m}`);
const bad = (m: string) => console.log(`   ✗ ${m}`);
const step = (m: string) => console.log(`\n${m}`);

/** Run an action and report whether it was refused, and why. */
async function attempt(
  exec: BusinessOsPluginExecutor,
  userId: string,
  action: string,
  params: unknown
): Promise<{ refused: boolean; message: string; result?: unknown }> {
  try {
    const result = await (exec as unknown as {
      executeSpecificAction: (c: unknown, a: string, p: unknown) => Promise<unknown>;
    }).executeSpecificAction({ user_id: userId }, action, params);
    return { refused: false, message: 'completed', result };
  } catch (err) {
    return { refused: true, message: (err as Error).message.split('\n').pop()!.trim() };
  }
}

async function main() {
  const { data } = await supabaseServer.from('crm_contacts').select('user_id').limit(1000);
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const id = (row as { user_id: string }).user_id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const userId = ranked[0][0];
  const otherUserId = ranked[1]?.[0];

  console.log(`user ${userId}   (read-only: every write below must be REFUSED)`);

  const manager = await PluginManagerV2.getInstance();
  const exec = new BusinessOsPluginExecutor(UserPluginConnections.getInstance(), manager);

  // ---- reads ---------------------------------------------------------------
  step('1. Reads reach the user\'s own data');
  const invoices = await attempt(exec, userId, 'find_invoices', {
    filters: [{ field: 'status', op: 'in', value: { $semantic: 'unpaid' } }],
    limit: 5,
  });
  invoices.refused
    ? bad(`find_invoices refused: ${invoices.message}`)
    : ok(`find_invoices → ${(invoices.result as { count: number }).count} unpaid`);

  const contacts = await attempt(exec, userId, 'find_contacts', { limit: 3 });
  contacts.refused
    ? bad(`find_contacts refused: ${contacts.message}`)
    : ok(`find_contacts → ${(contacts.result as { count: number }).count}`);

  step('2. Entity names with underscores resolve correctly');
  const views = await attempt(exec, userId, 'find_page_views', { limit: 2 });
  views.refused
    ? bad(`find_page_views refused: ${views.message}`)
    : ok(`find_page_views → ${(views.result as { count: number }).count} (not parsed as entity "views")`);

  // ---- tenant boundary -----------------------------------------------------
  step('3. Another tenant is unreachable — there is no parameter that asks for it');
  if (otherUserId) {
    const mine = (await attempt(exec, userId, 'find_contacts', { limit: 200 })).result as {
      rows: Array<{ user_id?: string }>;
    };
    const leaked = (mine?.rows ?? []).filter((r) => r.user_id && r.user_id !== userId);
    leaked.length === 0
      ? ok(`${mine.rows.length} rows, none belonging to another user`)
      : bad(`LEAK: ${leaked.length} rows from another tenant`);

    // Even asking explicitly must not work: user_id is not a writable/filterable
    // escape hatch, and the compiler injects its own regardless.
    const forced = await attempt(exec, userId, 'find_contacts', {
      filters: [{ field: 'user_id', op: 'eq', value: otherUserId }],
      limit: 50,
    });
    if (forced.refused) {
      ok(`explicit cross-tenant filter refused: ${forced.message.slice(0, 70)}`);
    } else {
      const rows = (forced.result as { rows: Array<{ user_id?: string }> }).rows ?? [];
      const foreign = rows.filter((r) => r.user_id && r.user_id !== userId);
      foreign.length === 0
        ? ok('explicit cross-tenant filter returned nothing of theirs')
        : bad(`LEAK: explicit filter returned ${foreign.length} foreign rows`);
    }
  } else {
    ok('only one tenant in this database — skipped');
  }

  // ---- write guards --------------------------------------------------------
  step('4. Write guards, inherited from the catalog');

  const cases: Array<{ label: string; action: string; params: unknown; expect: RegExp }> = [
    {
      label: 'unknown action',
      action: 'obliterate_contacts',
      params: {},
      expect: /not supported/i,
    },
    {
      label: 'create with no required fields',
      action: 'create_services',
      params: { data: {} },
      expect: /needs a real value|required/i,
    },
    {
      label: 'create with blank required fields',
      action: 'create_services',
      params: { data: { service_name: '   ', duration_minutes: 0 } },
      expect: /needs a real value|required/i,
    },
    {
      label: 'writing a non-writable field',
      action: 'update_contacts',
      params: { target_id: '00000000-0000-0000-0000-000000000000', data: { created_at: '2020-01-01' } },
      expect: /not writable/i,
    },
    {
      label: 'writing a field the catalog does not have',
      action: 'update_contacts',
      params: { target_id: '00000000-0000-0000-0000-000000000000', data: { is_admin: true } },
      expect: /unknown field/i,
    },
    {
      label: 'delete with no target',
      action: 'delete_contacts',
      params: {},
      expect: /target id/i,
    },
    {
      label: 'a foreign key pointing at a row the user does not own',
      action: 'create_tasks',
      params: { data: { title: 'guard check', contact_id: '00000000-0000-0000-0000-000000000000' } },
      expect: /does not exist in this account|references/i,
    },
    {
      label: 'an action declared but not wired to a repository',
      action: 'send_invoices',
      params: { target_id: '00000000-0000-0000-0000-000000000000' },
      expect: /not implemented yet/i,
    },
  ];

  for (const c of cases) {
    const outcome = await attempt(exec, userId, c.action, c.params);
    if (!outcome.refused) {
      bad(`${c.label}: NOT REFUSED — it completed`);
      continue;
    }
    c.expect.test(outcome.message)
      ? ok(`${c.label}: refused — ${outcome.message.slice(0, 72)}`)
      : bad(`${c.label}: refused for the WRONG reason — ${outcome.message.slice(0, 90)}`);
  }

  // ---- scoping is not caller-supplied --------------------------------------
  step('5. Without a user, it refuses rather than running unscoped');
  try {
    await (exec as unknown as {
      executeSpecificAction: (c: unknown, a: string, p: unknown) => Promise<unknown>;
    }).executeSpecificAction({}, 'find_contacts', {});
    bad('ran with no user context');
  } catch (err) {
    /refusing to run unscoped/i.test((err as Error).message)
      ? ok('refused: no user context')
      : bad(`refused for the wrong reason: ${(err as Error).message}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
