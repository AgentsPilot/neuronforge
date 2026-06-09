/**
 * Tests for ScatterItemFieldValidator (Calibration P3 — WP-56 companion).
 *
 * Canonical bug: a scatter iterates Drive `list_files` items (element schema has
 * `id`) but a sub-step references `{{doc_item.folder_id}}`. The validator must
 * flag it and propose `{{doc_item.id}}` — schema-driven, plugin-agnostic, and
 * only when it has a confident suggestion (never a noisy/guessed rewrite).
 */

import { ScatterItemFieldValidator } from '../ScatterItemFieldValidator';

/** Build a list-files producer step whose items expose the given fields. */
function listFilesStep(outputVariable: string, itemFields: string[]) {
  const properties: Record<string, any> = {};
  for (const f of itemFields) properties[f] = { type: 'string', source: 'plugin' };
  return {
    step_id: 'step2',
    id: 'step2',
    type: 'action',
    plugin: 'google-drive',
    action: 'list_files',
    output_variable: outputVariable,
    output_schema: {
      type: 'object',
      source: 'plugin',
      properties: {
        files: { type: 'array', source: 'plugin', items: { type: 'object', properties } },
        file_count: { type: 'number', source: 'plugin' },
      },
    },
    params: { folder_id: '{{contracts_folder.folder_id}}' },
  };
}

/** Build a scatter step iterating over `{{<sourceVar>.files}}` with one sub-step ref. */
function scatterStep(sourceVar: string, itemVar: string, subParam: Record<string, any>) {
  return {
    step_id: 'step3',
    id: 'step3',
    type: 'scatter_gather',
    scatter: {
      input: `{{${sourceVar}.files}}`,
      steps: [
        {
          step_id: 'step4',
          id: 'step4',
          type: 'action',
          plugin: 'google-docs',
          action: 'read_document',
          params: subParam,
        },
      ],
    },
    gather: { itemVariable: itemVar, outputKey: 'results' },
  };
}

const validator = new ScatterItemFieldValidator();

describe('ScatterItemFieldValidator', () => {
  it('flags the canonical folder_id-on-file-items bug and proposes id', () => {
    const steps = [
      listFilesStep('contract_docs', ['id', 'name', 'mimeType', 'size']),
      scatterStep('contract_docs', 'doc_item', { document_id: '{{doc_item.folder_id}}' }),
    ];

    const issues = validator.validate(steps);

    expect(issues).toHaveLength(1);
    const issue = issues[0];
    expect(issue.brokenField).toBe('folder_id');
    expect(issue.suggestedField).toBe('id');
    expect(issue.oldToken).toBe('{{doc_item.folder_id}}');
    expect(issue.newToken).toBe('{{doc_item.id}}');
    expect(issue.itemVariable).toBe('doc_item');
    expect(issue.sourceVariable).toBe('contract_docs');
    expect(issue.confidence).toBeGreaterThanOrEqual(0.8);
    expect(issue.availableFields).toContain('id');
  });

  it('uses the plugin definition over a MUTATED stored schema (the real 8c7caa01 / WP-56 case)', () => {
    // The stored schema was mutated: file items declared with `folder_id`,
    // agreeing with the wrong reference — this is precisely what hid the bug from
    // the compiler's O10 reconciliation. The plugin def is the source of truth.
    const stored = listFilesStep('folder_files', ['folder_id', 'name', 'mimeType']); // mutated
    const steps = [stored, scatterStep('folder_files', 'doc_item', { document_id: '{{doc_item.folder_id}}' })];

    // Without the resolver, the stored (mutated) schema agrees with the ref → silent.
    expect(new ScatterItemFieldValidator().validate(steps)).toHaveLength(0);

    // With the plugin-def resolver, the truth (`id`) exposes the mismatch.
    const resolver = (plugin: string, action: string) =>
      plugin === 'google-drive' && action === 'list_files'
        ? {
            type: 'object',
            properties: {
              files: { type: 'array', items: { type: 'object', properties: { id: {}, name: {}, mimeType: {} } } },
            },
          }
        : null;
    const issues = new ScatterItemFieldValidator(resolver).validate(steps);
    expect(issues).toHaveLength(1);
    expect(issues[0].brokenField).toBe('folder_id');
    expect(issues[0].suggestedField).toBe('id');
    expect(issues[0].newToken).toBe('{{doc_item.id}}');
  });

  it('does NOT flag a correct item-field reference', () => {
    const steps = [
      listFilesStep('contract_docs', ['id', 'name', 'mimeType']),
      scatterStep('contract_docs', 'doc_item', { document_id: '{{doc_item.id}}' }),
    ];
    expect(validator.validate(steps)).toHaveLength(0);
  });

  it('maps an id-shaped broken field (document_id) to the element id field', () => {
    const steps = [
      listFilesStep('contract_docs', ['id', 'name']),
      scatterStep('contract_docs', 'doc_item', { document_id: '{{doc_item.document_id}}' }),
    ];
    const issues = validator.validate(steps);
    expect(issues).toHaveLength(1);
    expect(issues[0].suggestedField).toBe('id');
  });

  it('falls back to Levenshtein for a near-miss field name (nam -> name)', () => {
    const steps = [
      listFilesStep('contract_docs', ['id', 'name', 'mimeType']),
      scatterStep('contract_docs', 'doc_item', { title: '{{doc_item.nam}}' }),
    ];
    const issues = validator.validate(steps);
    expect(issues).toHaveLength(1);
    expect(issues[0].suggestedField).toBe('name');
  });

  it('ignores references to non-iteration variables (other step outputs)', () => {
    const steps = [
      listFilesStep('contract_docs', ['id', 'name']),
      scatterStep('contract_docs', 'doc_item', { document_id: '{{doc_content.file_id}}' }),
    ];
    expect(validator.validate(steps)).toHaveLength(0);
  });

  it('stays silent when the source schema cannot be resolved (no guessing)', () => {
    // No producer step defines `contract_docs` → element fields unknown.
    const steps = [scatterStep('contract_docs', 'doc_item', { document_id: '{{doc_item.folder_id}}' })];
    expect(validator.validate(steps)).toHaveLength(0);
  });

  it('stays silent when no confident suggestion exists', () => {
    const steps = [
      listFilesStep('contract_docs', ['name', 'mimeType', 'size']), // no id-like field
      scatterStep('contract_docs', 'doc_item', { document_id: '{{doc_item.xyzzy_unrelated}}' }),
    ];
    expect(validator.validate(steps)).toHaveLength(0);
  });

  it('handles a workflow with no scatter steps', () => {
    expect(validator.validate([listFilesStep('contract_docs', ['id'])])).toHaveLength(0);
    expect(validator.validate([])).toHaveLength(0);
    expect(validator.validate(null as any)).toHaveLength(0);
  });

  describe('applyFix', () => {
    it('rewrites the exact token in the offending sub-step and re-validates clean', () => {
      const steps = [
        listFilesStep('contract_docs', ['id', 'name', 'mimeType']),
        scatterStep('contract_docs', 'doc_item', { document_id: '{{doc_item.folder_id}}' }),
      ];
      const [issue] = validator.validate(steps);
      expect(issue.oldToken).toBe('{{doc_item.folder_id}}');

      const applied = ScatterItemFieldValidator.applyFix(steps, issue);
      expect(applied).toBe(true);

      // The sub-step param is rewritten...
      expect((steps[1] as any).scatter.steps[0].params.document_id).toBe('{{doc_item.id}}');
      // ...and the workflow is now clean.
      expect(validator.validate(steps)).toHaveLength(0);
    });

    it('returns false when the sub-step or token is not found', () => {
      const steps = [
        listFilesStep('contract_docs', ['id']),
        scatterStep('contract_docs', 'doc_item', { document_id: '{{doc_item.id}}' }),
      ];
      const fakeIssue = {
        subStepId: 'nonexistent',
        oldToken: '{{doc_item.folder_id}}',
        newToken: '{{doc_item.id}}',
      } as any;
      expect(ScatterItemFieldValidator.applyFix(steps, fakeIssue)).toBe(false);
    });
  });
});
