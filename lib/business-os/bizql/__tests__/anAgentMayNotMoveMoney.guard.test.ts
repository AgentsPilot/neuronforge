/**
 * An automation may not take money out of a business.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DECLARATION THAT WAS NOT ENFORCED
 *
 * `transactions.refund` has always carried `requiresConfirmation: true`, and the
 * plugin definition that exposes it as `refund_transactions` says "Requires
 * explicit confirmation".
 *
 * That flag was read in exactly one place: the chat route, which parks the
 * resolved write in `ConfirmationStore` and replays it when the owner says yes.
 *
 * The agent path never read it. `business-os-plugin-executor` calls
 * `executeMutate` with `consumer: 'kernel'`, and that value had only ever
 * decided how a CRM activity row is attributed. So a committed `steps.json` with
 * a refund step would have taken money out of a Stripe balance on a cron, with
 * nobody asked and no decision recorded.
 *
 * Nothing exploited it — the nine shipped automations only ever call `find_*`,
 * `create_*`, `remind_*`, `invite_contacts`, `modify_email` and the sheet range
 * ops. The hole was unused, not absent.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A NEW FLAG RATHER THAN THE EXISTING ONE
 *
 * `requiresConfirmation` is also true for every `risk: 'send'` action, and
 * sending is what four live agents exist to do. A gate built on it would refuse
 * `remind_invoices`, `remind_proposals`, `remind_abandoned_bookings` and
 * `invite_contacts` in order to protect one action — breaking the mechanism to
 * secure it. `movesMoney` names the property that actually matters.
 *
 * No database and no network: every assertion is about what the executor
 * refuses before it reaches a repository.
 */

import fs from 'fs';
import path from 'path';

import { executeMutate } from '../mutate/MutateExecutor';
import { CATALOG } from '@/lib/business-os/catalog';
import type { MutateQuery } from '../types';

const USER = '11111111-1111-1111-1111-111111111111';
const TRANSACTION = '22222222-2222-2222-2222-222222222222';

const REFUND: MutateQuery = {
  op: 'mutate',
  entity: 'transactions',
  action: 'refund',
  target: { id: TRANSACTION },
} as MutateQuery;

/** The message the gate raises, and the only thing callers should match on. */
const REFUSAL = /moves money and cannot be run by an automation/;

/** Every action in the catalog that claims to move money. */
function moneyMovers(): Array<{ entity: string; action: string }> {
  const found: Array<{ entity: string; action: string }> = [];
  for (const [entity, def] of Object.entries(CATALOG.entities)) {
    for (const [action, a] of Object.entries(def.actions ?? {})) {
      if ((a as { movesMoney?: boolean }).movesMoney) found.push({ entity, action });
    }
  }
  return found;
}

describe('the gate holds', () => {
  it('refuses a refund asked for by an automation', async () => {
    await expect(
      executeMutate(REFUND, { userId: USER, consumer: 'kernel' })
    ).rejects.toThrow(REFUSAL);
  });

  it('refuses it before anything is resolved, so nothing can have been written', async () => {
    /* The throw sits above the handler lookup. If it ever moves below, a
       repository call would run first and this test would reach the network,
       which `jest-no-network` refuses — so this fails either way. */
    await expect(
      executeMutate({ ...REFUND, data: { amount: 100 } } as MutateQuery, {
        userId: USER,
        consumer: 'kernel',
      })
    ).rejects.toThrow(REFUSAL);
  });
});

describe('the gate is narrow', () => {
  it('does not touch the chat, which has its own confirmation', async () => {
    /* It will still fail — there is no database here — but it must not fail
       with THIS refusal. The chat path's `ConfirmationStore` flow stays the one
       way a request in words reaches a refund. */
    await expect(
      executeMutate(REFUND, { userId: USER, consumer: 'chat' })
    ).rejects.not.toThrow(REFUSAL);
  });

  it('does not touch sending, which is what the shipped agents are for', async () => {
    await expect(
      executeMutate(
        { op: 'mutate', entity: 'invoices', action: 'remind', target: { id: TRANSACTION } } as MutateQuery,
        { userId: USER, consumer: 'kernel' }
      )
    ).rejects.not.toThrow(REFUSAL);
  });
});

describe('what the catalog claims', () => {
  it('exactly one action moves money, and it is the refund', () => {
    /* If a second one is ever added, this fails and the author has to decide
       deliberately whether an automation may reach it. That is the point. */
    expect(moneyMovers()).toEqual([{ entity: 'transactions', action: 'refund' }]);
  });

  it('and it still declares the confirmation it always did', () => {
    const refund = CATALOG.entities.transactions.actions?.refund;
    expect(refund?.requiresConfirmation).toBe(true);
    expect(refund?.risk).toBe('delete');
  });
});

describe('no shipped automation reaches one', () => {
  it('not one steps.json names a money-moving action', () => {
    /*
     * The plugin op name is `<action>_<entity>` — `refund_transactions`,
     * `find_invoices`, `create_contacts`. So the ops to look for fall straight
     * out of the catalog rather than being typed here and going stale.
     *
     * This is the test that explains itself the day somebody adds one.
     */
    const forbidden = moneyMovers().map(m => `${m.action}_${m.entity}`);
    expect(forbidden.length).toBeGreaterThan(0);

    const dir = path.join(process.cwd(), 'lib/business-os/automations/agents');
    const plans = fs.readdirSync(dir).filter(f => f.endsWith('.steps.json'));
    expect(plans.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const plan of plans) {
      const text = fs.readFileSync(path.join(dir, plan), 'utf8');
      for (const op of forbidden) {
        if (text.includes(`"${op}"`)) offenders.push(`${plan} calls ${op}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
