import { PluginFieldFidelityValidator } from '../PluginFieldFidelityValidator';
import { makeRcaSteps, rcaResolver, GMAIL_SEARCH_OUTPUT_SCHEMA } from '../__fixtures__/rcaGmailExpenseAgent';

describe('PluginFieldFidelityValidator — Item 5b / calibration-side Item 3', () => {
  it('flags the RCA mime_type→mimeType divergence as a BLOCKING issue (happy path)', () => {
    const issues = new PluginFieldFidelityValidator(rcaResolver).validate(makeRcaSteps());
    const mismatch = issues.find(i => i.declaredField === 'mime_type');
    expect(mismatch).toBeDefined();
    expect(mismatch!.realField).toBe('mimeType');
    expect(mismatch!.plugin).toBe('google-mail');
    expect(mismatch!.action).toBe('search_emails');
    expect(mismatch!.stepId).toBe('step2');
    expect(mismatch!.blocking).toBe(true);
  });

  it('does NOT flag correctly-cased declared fields (no false positive)', () => {
    // A transform declaring the producer's exact camelCase spelling → no issue.
    const steps = [
      {
        step_id: 's1',
        type: 'action',
        plugin: 'google-mail',
        action: 'search_emails',
        output_variable: 'emails_out',
        output_schema: GMAIL_SEARCH_OUTPUT_SCHEMA,
      },
      {
        step_id: 's2',
        type: 'transform',
        output_variable: 'flat',
        config: {
          type: 'flatten',
          input: '{{emails_out.emails}}',
          output_schema: {
            type: 'array',
            items: { type: 'object', properties: { mimeType: { type: 'string' }, filename: { type: 'string' } } },
          },
        },
      },
    ];
    expect(new PluginFieldFidelityValidator(rcaResolver).validate(steps)).toHaveLength(0);
  });

  it('failure path: a genuinely derived field with no producer counterpart is not flagged', () => {
    const steps = [
      {
        step_id: 's1',
        type: 'action',
        plugin: 'google-mail',
        action: 'search_emails',
        output_variable: 'emails_out',
        output_schema: GMAIL_SEARCH_OUTPUT_SCHEMA,
      },
      {
        step_id: 's2',
        type: 'transform',
        output_variable: 'flat',
        config: {
          type: 'flatten',
          input: '{{emails_out.emails}}',
          output_schema: {
            type: 'array',
            items: { type: 'object', properties: { is_expense: { type: 'boolean' }, total_amount: { type: 'number' } } },
          },
        },
      },
    ];
    expect(new PluginFieldFidelityValidator(rcaResolver).validate(steps)).toHaveLength(0);
  });

  it('does not flag when the producing step is a transform (out of single-hop plugin-truth scope)', () => {
    // step2 consumes step-a-transform output, not a plugin action → no plugin truth to compare.
    const steps = [
      {
        step_id: 's1',
        type: 'transform',
        output_variable: 'mid',
        config: { type: 'map', input: '{{whatever}}', output_schema: { type: 'array', items: { type: 'object', properties: { mimeType: {} } } } },
      },
      {
        step_id: 's2',
        type: 'transform',
        output_variable: 'flat',
        config: { type: 'flatten', input: '{{mid}}', output_schema: { type: 'array', items: { type: 'object', properties: { mime_type: {} } } } },
      },
    ];
    expect(new PluginFieldFidelityValidator(rcaResolver).validate(steps)).toHaveLength(0);
  });
});
