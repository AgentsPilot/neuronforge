import {
  reconcileFields,
  reconcileFieldNames,
} from '../reconciler';

// The producing Gmail action's real attachment item shape (camelCase), nested
// exactly as `search_emails` emits it. Source of truth for the RCA case.
const GMAIL_SEARCH_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    emails: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          attachments: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                filename: { type: 'string' },
                mimeType: { type: 'string' },
                size: { type: 'number' },
                attachment_id: { type: 'string' },
                message_id: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
};

describe('reconcileFields — the RCA case (mime_type → mimeType)', () => {
  it('renames a clearly-same-field snake_case declaration to the producer camelCase', () => {
    const declared = ['mime_type', 'message_id', 'attachment_id', 'filename'];
    const result = reconcileFields(declared, GMAIL_SEARCH_OUTPUT_SCHEMA);

    expect(result.hasRenames).toBe(true);
    expect(result.renames).toContainEqual({ from: 'mime_type', to: 'mimeType' });
    // The already-correct fields are kept, not renamed.
    expect(result.renames).toHaveLength(1);

    const byDeclared = Object.fromEntries(result.fields.map(f => [f.declared, f]));
    expect(byDeclared['mime_type'].action).toBe('rename');
    expect(byDeclared['mime_type'].canonical).toBe('mimeType');
    expect(byDeclared['message_id'].action).toBe('keep');
    expect(byDeclared['filename'].action).toBe('keep');
  });
});

describe('reconcileFields — derived-field survival (constraint #3)', () => {
  it('leaves a genuinely-derived field (no producer counterpart) untouched', () => {
    const declared = ['mime_type', 'is_expense', 'total_amount'];
    const result = reconcileFields(declared, GMAIL_SEARCH_OUTPUT_SCHEMA);

    const byDeclared = Object.fromEntries(result.fields.map(f => [f.declared, f]));
    expect(byDeclared['is_expense'].action).toBe('derived');
    expect(byDeclared['total_amount'].action).toBe('derived');
    // Only the real overlap is renamed; derived fields are never in renames.
    expect(result.renames).toEqual([{ from: 'mime_type', to: 'mimeType' }]);
  });
});

describe('reconcileFieldNames — ambiguity is never guessed', () => {
  it('does not rewrite when the producer exposes two spellings of the same key', () => {
    // Producer ambiguously exposes both mimeType and mime_type.
    const result = reconcileFieldNames(['mimetype'], ['mimeType', 'mime_type']);
    expect(result.hasRenames).toBe(false);
    expect(result.fields[0].action).toBe('ambiguous');
  });

  it('does not rewrite when two declared fields would collide onto one producer field', () => {
    const result = reconcileFieldNames(['mime_type', 'mimeType'], ['mimeType']);
    // mimeType already exists verbatim among declared → target collision → ambiguous/keep.
    const actions = result.fields.map(f => f.action).sort();
    expect(result.hasRenames).toBe(false);
    expect(actions).toEqual(['ambiguous', 'keep']);
  });

  it('classifies an exact match as keep, not rename', () => {
    const result = reconcileFieldNames(['mimeType'], ['mimeType', 'filename']);
    expect(result.hasRenames).toBe(false);
    expect(result.fields[0].action).toBe('keep');
  });
});

describe('reconcileFields — empty / edge inputs', () => {
  it('returns no renames for empty declared fields', () => {
    expect(reconcileFields([], GMAIL_SEARCH_OUTPUT_SCHEMA).hasRenames).toBe(false);
  });

  it('treats everything as derived when the producer schema is empty', () => {
    const result = reconcileFields(['mime_type', 'filename'], null);
    expect(result.hasRenames).toBe(false);
    expect(result.fields.every(f => f.action === 'derived')).toBe(true);
  });
});
