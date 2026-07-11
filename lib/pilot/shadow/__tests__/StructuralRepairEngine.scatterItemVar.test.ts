/**
 * StructuralRepairEngine — Item 5a (scatter/loop itemVariable is in-scope)
 *
 * RCA (agent 0ee53785): the `broken_variable_reference` detector flagged
 * `{{attachment_item.filename}}` inside a scatter body as a reference to a
 * non-existent variable, because the scatter's declared `itemVariable`
 * (`attachment_item`) was not recognised as an in-scope variable. Worse, the
 * fixer had no action for a valid loop variable → `autoFixable:false`, so the
 * warning recurred every iteration and (with the old verdict logic) dragged the
 * run to "failed".
 *
 * The fix registers each scatter/loop `itemVariable` as an in-scope variable, so
 * a valid loop-variable reference is no longer flagged. Field-level validity is
 * still checked separately by ScatterItemFieldValidator.
 */

jest.mock('@/lib/server/plugin-manager-v2', () => ({
  __esModule: true,
  default: { getInstance: jest.fn().mockResolvedValue({}) },
  PluginManagerV2: { getInstance: jest.fn().mockResolvedValue({}) },
}));

import { StructuralRepairEngine } from '../StructuralRepairEngine';

function makeAgent(steps: any[]) {
  return { id: 'test-agent', pilot_steps: steps } as any;
}

/** A scatter over an upstream variable with a loop body sub-step. */
function makeScatterAgent(itemVariable: string, subStepParams: any) {
  return makeAgent([
    {
      step_id: 'step1',
      type: 'action',
      action: 'google-mail.search_emails',
      output_variable: 'eligible_attachments',
      output_schema: { type: 'array', items: { type: 'object', properties: { filename: { type: 'string' } } } },
      params: {},
    },
    {
      step_id: 'step4',
      type: 'scatter_gather',
      scatter: {
        input: '{{eligible_attachments}}',
        itemVariable,
        steps: [
          {
            step_id: 'step5',
            type: 'action',
            action: 'google-mail.get_attachment',
            output_variable: 'downloaded',
            params: subStepParams,
          },
        ],
      },
      gather: { itemVariable, outputKey: 'expense_rows', operation: 'collect' },
      output_variable: 'expense_rows',
    },
  ]);
}

async function scanBrokenRefs(agent: any) {
  const engine = new StructuralRepairEngine();
  const issues = await engine.scanWorkflow(agent);
  return issues.filter(i => i.type === 'broken_variable_reference');
}

describe('Item 5a — scatter itemVariable references are not flagged as broken', () => {
  it('does NOT flag {{attachment_item.filename}} inside the scatter body (happy path)', async () => {
    const agent = makeScatterAgent('attachment_item', {
      attachment_id: '{{attachment_item.attachment_id}}',
      filename: '{{attachment_item.filename}}',
    });
    const brokenRefs = await scanBrokenRefs(agent);
    const flaggedItemVar = brokenRefs.filter(i => i.description.includes('attachment_item'));
    expect(flaggedItemVar).toHaveLength(0);
  });

  it('works for an itemVariable declared only on scatter (not gather)', async () => {
    const agent = makeAgent([
      {
        step_id: 'step1',
        type: 'action',
        action: 'x.y',
        output_variable: 'rows',
        params: {},
      },
      {
        step_id: 'loop',
        type: 'scatter_gather',
        scatter: { input: '{{rows}}', itemVariable: 'row_item', steps: [
          { step_id: 'inner', type: 'action', action: 'a.b', output_variable: 'o', params: { v: '{{row_item.value}}' } },
        ] },
        gather: { outputKey: 'out' },
        output_variable: 'out',
      },
    ]);
    const brokenRefs = await scanBrokenRefs(agent);
    expect(brokenRefs.filter(i => i.description.includes('row_item'))).toHaveLength(0);
  });

  it('failure path: a genuinely non-existent variable is STILL flagged as broken', async () => {
    // `nonexistent_var` is neither a step id/output_variable nor a loop variable.
    const agent = makeScatterAgent('attachment_item', {
      filename: '{{attachment_item.filename}}',
      bad: '{{nonexistent_var.field}}',
    });
    const brokenRefs = await scanBrokenRefs(agent);
    const flaggedBad = brokenRefs.filter(i => i.description.includes('nonexistent_var'));
    expect(flaggedBad.length).toBeGreaterThan(0);
    // And the valid loop variable is still not flagged.
    expect(brokenRefs.filter(i => i.description.includes('attachment_item'))).toHaveLength(0);
  });
});
