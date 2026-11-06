/**
 * The importer marks the rows it filed, and only those.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE SHEET HAS TO SAY SOMETHING
 *
 * The agent read the owner's sheet every day and left no trace. Nothing on the
 * page said which rows were already in the CRM, so the only way to know was to
 * open both and compare by hand — and the agent itself had no memory either,
 * re-reading all 171 rows each morning and leaning entirely on a lookup by
 * email to avoid duplicating them.
 *
 * That was demonstrated on 2026-11-05: 39 contacts were deleted from the CRM at
 * 15:20 and the 15:35 run recreated every one of them, because the sheet still
 * looked untouched.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THREE THINGS THAT MAKE IT WORK, AND WHY EACH IS LOAD-BEARING
 *
 *   `row_offset: 2`   the read starts at A2, so array position 0 is sheet row
 *                     2. Without it the mark lands one row above the person it
 *                     describes — silently, and on the owner's data.
 *
 *   `source_row`      the row number travels WITH the object. The scatter
 *                     exposes a 0-based `index`, but the template resolver
 *                     does `{{path}}` lookups only, so `{{index + 2}}` cannot
 *                     be expressed.
 *
 *   `executeIf`       the mark is opt-in. An unset `status_column` would
 *                     resolve the range to `Leads!2`, Google answers 400, and
 *                     the step fails AFTER the contact is filed — turning a
 *                     completed import into a failed run for every agent
 *                     installed before this existed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE GUARD IS NOT A NESTED CONDITIONAL
 *
 * It was one first — a `step9a` wrapper of `type: 'conditional'` — and it never
 * ran. Inside a scatter, a conditional nested in ANOTHER conditional's branch
 * was not traversed, so the write silently never happened while the run
 * reported success: the exact failure mode this whole agent keeps producing.
 *
 * `executeIf` is checked before every step by the one path that cannot be
 * skipped, so the guard rides on the step it guards rather than on a wrapper
 * that may or may not be walked. These assertions name `step9` directly for
 * that reason; a reappearing `step9a` is the bug coming back.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

import plan from '@/lib/business-os/automations/agents/importLeadsFromSheet.steps.json';
import { AUTOMATION_AGENTS } from '@/lib/business-os/automations/catalog';

type Step = {
  id?: string;
  type?: string;
  plugin?: string;
  action?: string;
  config?: Record<string, unknown>;
  params?: Record<string, unknown>;
  condition?: Record<string, unknown>;
  executeIf?: Record<string, unknown>;
  steps?: Step[];
  scatter?: { steps?: Step[] };
};

const steps = (Array.isArray(plan) ? plan : (plan as { steps: Step[] }).steps) as Step[];

/** The step with this id, wherever it is nested. */
function find(id: string, within: Step[] = steps): Step | undefined {
  for (const step of within) {
    if (step.id === id) return step;
    const nested = find(id, step.steps ?? []) ?? find(id, step.scatter?.steps ?? []);
    if (nested) return nested;
  }
  return undefined;
}

/** The ids on the path from the root down to this step, inclusive. */
function pathTo(id: string, within: Step[] = steps, trail: string[] = []): string[] | null {
  for (const step of within) {
    const here = [...trail, step.id ?? '?'];
    if (step.id === id) return here;
    const nested =
      pathTo(id, step.steps ?? [], here) ?? pathTo(id, step.scatter?.steps ?? [], here);
    if (nested) return nested;
  }
  return null;
}

describe('the row number survives the journey', () => {
  it('step2 is told where the read started', () => {
    /* `A2`, so position 0 is row 2. A wrong offset marks the wrong person. */
    expect(find('step2')?.config?.row_offset).toBe(2);
  });

  it('step3 carries source_row through the mapping', () => {
    const mapping = find('step3')?.config?.mapping as Record<string, string>;

    expect(mapping.source_row).toBe('source_row');
    /* And still maps what it always did. */
    expect(mapping.email).toBe('{{input.email_column}}');
  });

  it('step9 writes to the row the person came from', () => {
    const range = (find('step9')?.params as Record<string, string>).range;

    expect(range).toContain('{{person.source_row}}');
    expect(range).toContain('{{input.status_column}}');
    /* Never the scatter index: it is 0-based and the resolver cannot add. */
    expect(range).not.toContain('{{index');
  });
});

describe('only a row we actually filed gets marked', () => {
  it('the write sits inside the same branch as the contact creation', () => {
    /*
     * A row skipped as a duplicate must be left alone. Marking it would claim
     * an import that did not happen, and on the next run the owner would see
     * their sheet asserting something the CRM does not show.
     */
    const toWrite = pathTo('step9');
    const toCreate = pathTo('step8');

    expect(toWrite).not.toBeNull();
    expect(toCreate).not.toBeNull();
    /* step7 is "only file someone we do not have" — both live under it. */
    expect(toWrite).toContain('step7');
    expect(toCreate).toContain('step7');
  });

  it('the write comes after the contact exists, not before', () => {
    const host = find('step7')?.steps ?? [];
    const createAt = host.findIndex(s => s.id === 'step8');
    const markAt = host.findIndex(s => s.id === 'step9');

    expect(createAt).toBeGreaterThanOrEqual(0);
    expect(markAt).toBeGreaterThan(createAt);
  });
});

describe('the mark is opt-in', () => {
  it('is guarded on the owner having nominated a column', () => {
    expect(find('step9')?.executeIf).toMatchObject({
      field: 'input.status_column',
      operator: 'not_equals',
      value: '',
    });
  });

  it('carries the guard on the write itself, not on a wrapper step', () => {
    /* See the note at the top: a nested conditional inside a scatter was not
       traversed, so a wrapper guard meant the write never ran at all. */
    expect(find('step9a')).toBeUndefined();
    expect(find('step9')?.type).toBe('action');
  });

  it('and the executor actually honours executeIf on a nested step', () => {
    /*
     * The half that is easy to forget. Only `WorkflowPilot.executeSingleStep`
     * read `executeIf`; a step running under a scatter goes through
     * `StepExecutor`, which ignored it — so the guard would have been decoration
     * and the write would have fired with an empty column.
     */
    const executor = fs.readFileSync(
      path.join(process.cwd(), 'lib/pilot/StepExecutor.ts'),
      'utf8'
    );

    expect(executor).toContain('executeIf');
    expect(executor).toContain('executeIf condition not met');
  });

  it('offers the column and the wording as OPTIONAL inputs', () => {
    const importer = AUTOMATION_AGENTS.find(a => a.id === 'import_leads_from_sheet');
    const inputs = (importer?.inputSchema ?? []) as { name: string; required?: boolean }[];

    const column = inputs.find(i => i.name === 'status_column');
    const text = inputs.find(i => i.name === 'status_text');

    expect(column?.required).toBe(false);
    expect(text?.required).toBe(false);
  });
});

describe('what the write must not do to the owner’s sheet', () => {
  it('writes RAW, so a status is never re-parsed as a date or a formula', () => {
    expect((find('step9')?.params as Record<string, string>).input_option).toBe('RAW');
  });

  it('writes one cell, never a range that could overwrite their columns', () => {
    const values = (find('step9')?.params as Record<string, unknown>).values;

    expect(values).toEqual([['{{input.status_text}}']]);
  });
});
