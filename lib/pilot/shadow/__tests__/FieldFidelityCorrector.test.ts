import { FieldFidelityCorrector } from '../FieldFidelityCorrector';
import { PluginFieldFidelityValidator } from '../PluginFieldFidelityValidator';
import { makeRcaSteps, rcaResolver } from '../__fixtures__/rcaGmailExpenseAgent';

describe('FieldFidelityCorrector — Item 7 (in-place backfill for RCA agent 0ee53785)', () => {
  it('rewrites mime_type→mimeType in place across the data-flow chain (backfill outcome)', () => {
    const original = makeRcaSteps();
    const { correctedSteps, corrections, changed } = new FieldFidelityCorrector(rcaResolver).correct(original);

    expect(changed).toBe(true);
    const c = corrections.find(x => x.from === 'mime_type');
    expect(c).toBeDefined();
    expect(c!.to).toBe('mimeType');
    expect(c!.plugin).toBe('google-mail');
    expect(c!.outputVariable).toBe('all_attachments');

    // 1. Transform's declared schema key was renamed.
    const step2 = correctedSteps.find((s: any) => s.step_id === 'step2');
    expect(Object.keys(step2.config.output_schema.items.properties)).toContain('mimeType');
    expect(Object.keys(step2.config.output_schema.items.properties)).not.toContain('mime_type');

    // 2. Downstream filter condition.field was rewritten to the real spelling.
    const step3 = correctedSteps.find((s: any) => s.step_id === 'step3');
    expect(step3.config.condition.field).toBe('mimeType');

    // 3. The scatter body's {{attachment_item.mime_type}} ref was rewritten.
    const step5 = correctedSteps
      .find((s: any) => s.step_id === 'step4')
      .scatter.steps.find((s: any) => s.step_id === 'step5');
    expect(step5.params.mime_type).toBe('{{attachment_item.mimeType}}');
    // A different field ref (attachment_id) is untouched.
    expect(step5.params.attachment_id).toBe('{{attachment_item.attachment_id}}');
  });

  it('does not mutate the input steps (reversible — caller keeps the original snapshot)', () => {
    const original = makeRcaSteps();
    new FieldFidelityCorrector(rcaResolver).correct(original);
    // Original still carries the wrong spelling → the pre-rewrite snapshot is intact.
    const step2 = original.find((s: any) => s.step_id === 'step2');
    expect(Object.keys(step2.config.output_schema.items.properties)).toContain('mime_type');
  });

  it('after correction, re-running the detector finds no remaining mismatch (proves the fix)', () => {
    const { correctedSteps } = new FieldFidelityCorrector(rcaResolver).correct(makeRcaSteps());
    const remaining = new PluginFieldFidelityValidator(rcaResolver).validate(correctedSteps);
    expect(remaining).toHaveLength(0);
  });

  it('failure path: makes no changes when there is nothing to correct', () => {
    const clean = [
      {
        step_id: 's1',
        type: 'action',
        plugin: 'google-mail',
        action: 'search_emails',
        output_variable: 'emails_out',
        output_schema: { type: 'object', properties: { emails: { type: 'array', items: { type: 'object', properties: { mimeType: {} } } } } },
      },
      {
        step_id: 's2',
        type: 'transform',
        output_variable: 'flat',
        config: { type: 'flatten', input: '{{emails_out.emails}}', output_schema: { type: 'array', items: { type: 'object', properties: { mimeType: {} } } } },
      },
    ];
    const result = new FieldFidelityCorrector(rcaResolver).correct(clean);
    expect(result.changed).toBe(false);
    expect(result.corrections).toHaveLength(0);
  });

  // QA-added edge probes (2026-07-11): exercise derived-survival and ambiguity
  // guarantees through the FULL corrector surface (not just the reconciler unit).
  it('QA: leaves a genuinely-derived field untouched while still renaming the real overlap', () => {
    const steps = [
      {
        step_id: 's1',
        type: 'action',
        plugin: 'google-mail',
        action: 'search_emails',
        output_variable: 'emails_out',
        output_schema: { type: 'object', properties: { emails: { type: 'array', items: { type: 'object', properties: { mimeType: {}, filename: {} } } } } },
      },
      {
        step_id: 's2',
        type: 'transform',
        output_variable: 'flat',
        config: {
          type: 'flatten',
          input: '{{emails_out.emails}}',
          // mime_type overlaps the producer (rename) AND is_expense is derived (keep).
          output_schema: { type: 'array', items: { type: 'object', properties: { mime_type: {}, is_expense: {}, filename: {} } } },
        },
      },
    ];
    const { correctedSteps, corrections, changed } = new FieldFidelityCorrector(rcaResolver).correct(steps);
    expect(changed).toBe(true);
    // Only the real overlap was corrected; the derived field was never renamed.
    expect(corrections.map(c => `${c.from}→${c.to}`)).toEqual(['mime_type→mimeType']);
    const props = correctedSteps.find((s: any) => s.step_id === 's2').config.output_schema.items.properties;
    expect(Object.keys(props).sort()).toEqual(['filename', 'is_expense', 'mimeType']);
    expect(props).not.toHaveProperty('mime_type');
  });

  it('QA: does NOT rename when the producer ambiguously exposes two spellings of the same field', () => {
    // Producer legitimately emits BOTH mimeType and mime_type → ambiguous → the
    // corrector must leave the declared field untouched (never a guess).
    const ambiguousResolver = (plugin: string, action: string) =>
      plugin === 'google-mail' && action === 'search_emails'
        ? {
            type: 'object',
            properties: {
              emails: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    mimeType: { type: 'string' },
                    nested: { type: 'object', properties: { mime_type: { type: 'string' } } },
                  },
                },
              },
            },
          }
        : null;
    const steps = [
      {
        step_id: 's1',
        type: 'action',
        plugin: 'google-mail',
        action: 'search_emails',
        output_variable: 'emails_out',
      },
      {
        step_id: 's2',
        type: 'transform',
        output_variable: 'flat',
        config: { type: 'flatten', input: '{{emails_out.emails}}', output_schema: { type: 'array', items: { type: 'object', properties: { mimetype: {} } } } },
      },
    ];
    const { corrections, changed } = new FieldFidelityCorrector(ambiguousResolver).correct(steps);
    expect(changed).toBe(false);
    expect(corrections).toHaveLength(0);
  });
});
