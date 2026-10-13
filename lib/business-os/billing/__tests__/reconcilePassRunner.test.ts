/**
 * The reconcile pass runner (credits boost slice 4b.2; plan payments SA-P4 /
 * PF-5): passes run in order on one shared deadline, their counters are
 * flattened as `<pass><Key>` for the run record, and a pass that throws is
 * counted without stopping the next (the P-8b seam).
 */

import { flattenedCountKey, runReconcilePasses, type ReconcilePass, type ReconcilePassContext } from '@/lib/business-os/billing/reconcilePassRunner';

function context() {
  const logs: Array<{ level: string; obj: Record<string, unknown>; msg: string }> = [];
  const at = (level: string) => (obj: Record<string, unknown>, msg: string) => logs.push({ level, obj, msg });
  const ctx: ReconcilePassContext = {
    deadlineAt: 1_000_045_000,
    now: new Date(1_000_000_000),
    log: { info: at('info'), warn: at('warn'), error: at('error') },
    trigger: 'nightly',
  };
  return { ctx, logs };
}

const pass = (name: string, run: ReconcilePass['run']): ReconcilePass => ({ name, run });

describe('runReconcilePasses', () => {
  it('runs the passes in order with the same context, and flattens each pass\'s counters', async () => {
    const order: string[] = [];
    const seen: ReconcilePassContext[] = [];
    const { ctx } = context();
    const result = await runReconcilePasses(
      [
        pass('boost', async (c) => {
          order.push('boost');
          seen.push(c);
          return { credited: 2, stillProcessing: 1 };
        }),
        pass('plan', async (c) => {
          order.push('plan');
          seen.push(c);
          return { periodsApplied: 3 };
        }),
      ],
      ctx
    );
    expect(order).toEqual(['boost', 'plan']);
    expect(seen).toEqual([ctx, ctx]);
    expect(result).toEqual({ passesRun: 2, passesFailed: 0, counts: { boostCredited: 2, boostStillProcessing: 1, planPeriodsApplied: 3 } });
  });

  it('a pass that throws is counted and alerted; the next pass still runs (the seam never hides P-8b behind boost)', async () => {
    const { ctx, logs } = context();
    const result = await runReconcilePasses(
      [
        pass('boost', async () => {
          throw new Error('defect with owner@example.com');
        }),
        pass('plan', async () => ({ periodsApplied: 1 })),
      ],
      ctx
    );
    expect(result).toEqual({ passesRun: 2, passesFailed: 1, counts: { planPeriodsApplied: 1 } });
    expect(logs).toContainEqual({ level: 'error', obj: { alert: true, pass: 'boost', errorName: 'Error' }, msg: 'bos_billing_reconcile_pass_failed' });
    expect(JSON.stringify(logs)).not.toContain('owner@example.com');
  });

  it('a misnamed pass never runs (its counters could not be recorded)', async () => {
    const { ctx, logs } = context();
    const run = jest.fn(async () => ({ examined: 1 }));
    const result = await runReconcilePasses([pass('Boost-Pass', run)], ctx);
    expect(run).not.toHaveBeenCalled();
    expect(result).toEqual({ passesRun: 0, passesFailed: 1, counts: {} });
    expect(logs.map((l) => l.msg)).toEqual(['bos_billing_reconcile_pass_misnamed']);
  });

  it('a counter that is not a whole number, or whose key the run record would refuse, is dropped with a warn', async () => {
    const { ctx, logs } = context();
    const result = await runReconcilePasses([pass('boost', async () => ({ good: 1, half: 0.5, 'bad-key': 2, Upper: 3 }))], ctx);
    expect(result.counts).toEqual({ boostGood: 1 });
    expect(logs.filter((l) => l.msg === 'bos_billing_reconcile_count_dropped')).toHaveLength(3);
  });

  it('flattenedCountKey builds keys the run record accepts', () => {
    expect(flattenedCountKey('boost', 'stillProcessing')).toBe('boostStillProcessing');
    expect(flattenedCountKey('boost', 'receiptsNotFilled')).toMatch(/^[a-zA-Z][a-zA-Z0-9]{0,39}$/);
  });
});
