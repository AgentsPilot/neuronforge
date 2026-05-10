/**
 * enforceContentLevelForExtraction — WP-24 schema-driven gated-field detection
 *
 * Background: WP-11's original heuristic forces `content_level: 'full'` on
 * Gmail `search_emails` (and similar fetch actions with a content_level
 * enum) when downstream contains an AI step or a deliver-extract action.
 * It missed workflows where the body is consumed by deterministic transforms
 * (filter on `item.body`, map with `field_mapping: {target: "body"}`).
 *
 * Phase E on complaint-email-logger observed this: rows appended to Sheets
 * but column D (`full_email_text`) was empty because Gmail returned the
 * email shape WITHOUT body (no content_level set; defaults to metadata).
 *
 * WP-24 extends the detection using the plugin's `output_dependencies`
 * declarations. The Gmail schema declares `body` is unpopulated at non-full
 * content levels — so any downstream node referencing `body` triggers the
 * upgrade.
 *
 * These tests mirror the relevant slices of `getGatedOutputFields` and
 * `someNodeReferencesGatedField` as pure functions so we don't need to
 * import the full IntentToIRConverter (which pulls a heavy dependency
 * chain — same pattern as W2 / WP-SR / WP-23 tests).
 */

// ─── Helper mirrors (same algorithms as IntentToIRConverter) ──────────────

function getGatedOutputFields(schema: any): Set<string> {
  const gated = new Set<string>();
  const deps = schema?.output_dependencies;
  if (!Array.isArray(deps)) return gated;
  for (const dep of deps) {
    const fields = dep?.unpopulated_fields;
    if (Array.isArray(fields)) {
      for (const f of fields) {
        if (typeof f === 'string' && f.length > 0) gated.add(f);
      }
    }
  }
  return gated;
}

function someNodeReferencesGatedField(
  nodes: Array<{ operation?: any }>,
  gatedFields: Set<string>
): boolean {
  if (gatedFields.size === 0) return false;
  for (const node of nodes) {
    const op = node.operation;
    if (!op || op.operation_type === 'fetch') continue;
    const haystack = JSON.stringify({
      transform: op.transform,
      deliver: op.deliver,
      notify: op.notify,
      ai: op.ai,
    });
    for (const field of gatedFields) {
      const esc = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const valueRe = new RegExp(`"${esc}"`);
      const pathTailRe = new RegExp(`\\.${esc}(?:["}\\b]|$)`);
      if (valueRe.test(haystack) || pathTailRe.test(haystack)) return true;
    }
  }
  return false;
}

// ─── Fixtures: Gmail-like schema and IR nodes ─────────────────────────────

const GMAIL_SEARCH_EMAILS_SCHEMA = {
  parameters: {
    properties: {
      content_level: { type: 'string', enum: ['metadata', 'snippet', 'full'] },
    },
  },
  output_dependencies: [
    {
      when_param: { content_level: 'metadata' },
      unpopulated_fields: ['body', 'snippet'],
    },
    {
      when_param: { content_level: 'snippet' },
      unpopulated_fields: ['body'],
    },
  ],
};

// ─── Tests ────────────────────────────────────────────────────────────────

describe('WP-24 — getGatedOutputFields', () => {
  it('extracts the union of all unpopulated_fields from output_dependencies', () => {
    const gated = getGatedOutputFields(GMAIL_SEARCH_EMAILS_SCHEMA);
    expect([...gated].sort()).toEqual(['body', 'snippet']);
  });

  it('returns empty set when schema has no output_dependencies', () => {
    expect(getGatedOutputFields({ parameters: {} })).toEqual(new Set());
  });

  it('returns empty set when output_dependencies is malformed (not an array)', () => {
    expect(getGatedOutputFields({ output_dependencies: 'whatever' })).toEqual(new Set());
  });

  it('skips entries without unpopulated_fields', () => {
    const schema = {
      output_dependencies: [
        { when_param: { x: 'y' } }, // no unpopulated_fields
        { when_param: { x: 'z' }, unpopulated_fields: ['only_field'] },
      ],
    };
    expect([...getGatedOutputFields(schema)]).toEqual(['only_field']);
  });

  it('deduplicates fields across multiple entries', () => {
    const schema = {
      output_dependencies: [
        { when_param: { x: 'a' }, unpopulated_fields: ['body', 'snippet'] },
        { when_param: { x: 'b' }, unpopulated_fields: ['body'] },
      ],
    };
    expect([...getGatedOutputFields(schema)].sort()).toEqual(['body', 'snippet']);
  });
});

describe('WP-24 — someNodeReferencesGatedField', () => {
  const gatedFields = new Set(['body', 'snippet']);

  // ─── The canonical complaint-email-logger pattern ───────────────────────

  it('detects field_mapping with body as source field (transform/map)', () => {
    // step7 from complaint-email-logger: `field_mapping: {full_email_text: "body"}`
    const nodes = [
      {
        operation: {
          operation_type: 'transform',
          transform: {
            op: 'map',
            field_mapping: {
              full_email_text: 'body',
              subject: 'subject',
              date: 'date',
            },
          },
        },
      },
    ];
    expect(someNodeReferencesGatedField(nodes, gatedFields)).toBe(true);
  });

  it('detects condition.field referencing item.body (transform/filter)', () => {
    // step6 from complaint-email-logger: `condition: {field: "item.body", ...}`
    const nodes = [
      {
        operation: {
          operation_type: 'transform',
          transform: {
            op: 'filter',
            where: {
              op: 'test',
              left: { kind: 'ref', ref: 'item', field: 'body' },
              comparator: 'contains_any',
              right: { kind: 'config', key: 'keywords' },
            },
          },
        },
      },
    ];
    // The compiled IR may stringify this as `"field":"body"` somewhere,
    // OR as a path tail. Both should trigger.
    expect(someNodeReferencesGatedField(nodes, gatedFields)).toBe(true);
  });

  it('detects body referenced via dotted path in a string value', () => {
    // Conditional step expressing `item.body`-style path
    const nodes = [
      {
        operation: {
          operation_type: 'transform',
          transform: { op: 'filter', config: { input_path: 'item.body' } },
        },
      },
    ];
    expect(someNodeReferencesGatedField(nodes, gatedFields)).toBe(true);
  });

  it('detects body referenced via {{var.body}} template syntax', () => {
    const nodes = [
      {
        operation: {
          operation_type: 'notify',
          notify: { content: { html_body: '{{email.body}}' } },
        },
      },
    ];
    expect(someNodeReferencesGatedField(nodes, gatedFields)).toBe(true);
  });

  it('detects snippet (the second gated field)', () => {
    const nodes = [
      {
        operation: {
          operation_type: 'transform',
          transform: { op: 'map', field_mapping: { preview: 'snippet' } },
        },
      },
    ];
    expect(someNodeReferencesGatedField(nodes, gatedFields)).toBe(true);
  });

  // ─── Negative cases (should NOT trigger) ────────────────────────────────

  it('does not trigger when no node references a gated field', () => {
    const nodes = [
      {
        operation: {
          operation_type: 'transform',
          transform: { op: 'filter', where: { left: 'item.subject', op: 'eq', right: 'hi' } },
        },
      },
      {
        operation: {
          operation_type: 'transform',
          transform: { op: 'map', field_mapping: { id: 'id', subject: 'subject' } },
        },
      },
    ];
    expect(someNodeReferencesGatedField(nodes, gatedFields)).toBe(false);
  });

  it('skips fetch nodes (only consumers count)', () => {
    // A fetch node's config that *contains* "body" should be ignored — it's
    // the producer, not the consumer. (Hypothetical; Gmail params don't
    // mention body, but defensive against future plugins.)
    const nodes = [
      {
        operation: {
          operation_type: 'fetch',
          fetch: { plugin_key: 'gmail', action: 'search_emails', config: { query: 'body in:inbox' } },
        },
      },
    ];
    expect(someNodeReferencesGatedField(nodes, gatedFields)).toBe(false);
  });

  it('returns false when gatedFields is empty', () => {
    const nodes = [
      {
        operation: {
          operation_type: 'transform',
          transform: { op: 'map', field_mapping: { target: 'body' } },
        },
      },
    ];
    expect(someNodeReferencesGatedField(nodes, new Set())).toBe(false);
  });

  it('does not false-positive on field names that contain "body" as substring', () => {
    // E.g., a field called "no_body_check" should not match `body`.
    const nodes = [
      {
        operation: {
          operation_type: 'transform',
          transform: { op: 'map', field_mapping: { target: 'no_body_check' } },
        },
      },
    ];
    expect(someNodeReferencesGatedField(nodes, gatedFields)).toBe(false);
  });

  // ─── Multiple nodes ─────────────────────────────────────────────────────

  it('returns true when ANY node references a gated field', () => {
    const nodes = [
      { operation: { operation_type: 'transform', transform: { op: 'filter', where: { field: 'item.subject' } } } },
      { operation: { operation_type: 'transform', transform: { op: 'map', field_mapping: { full_email_text: 'body' } } } },
      { operation: { operation_type: 'deliver', deliver: { plugin_key: 'gs', action: 'append_rows' } } },
    ];
    expect(someNodeReferencesGatedField(nodes, gatedFields)).toBe(true);
  });
});

// ─── End-to-end algorithm (combines both helpers) ─────────────────────────

describe('WP-24 — combined detection on canonical complaint-email-logger shape', () => {
  it('Gmail schema + body-referencing transform → triggers content_level=full', () => {
    const gated = getGatedOutputFields(GMAIL_SEARCH_EMAILS_SCHEMA);
    const nodes = [
      {
        operation: {
          operation_type: 'fetch',
          fetch: { plugin_key: 'google-mail', action: 'search_emails', config: {} },
        },
      },
      {
        operation: {
          operation_type: 'transform',
          transform: { op: 'filter', where: { left: 'item.body', op: 'contains_any', right: 'kw' } },
        },
      },
      {
        operation: {
          operation_type: 'transform',
          transform: { op: 'map', field_mapping: { full_email_text: 'body' } },
        },
      },
    ];
    expect(someNodeReferencesGatedField(nodes, gated)).toBe(true);
  });

  it('Gmail schema + only metadata-referencing transforms → does NOT trigger', () => {
    const gated = getGatedOutputFields(GMAIL_SEARCH_EMAILS_SCHEMA);
    const nodes = [
      {
        operation: {
          operation_type: 'fetch',
          fetch: { plugin_key: 'google-mail', action: 'search_emails', config: {} },
        },
      },
      {
        operation: {
          operation_type: 'transform',
          transform: { op: 'filter', where: { left: 'item.subject', op: 'contains', right: 'hi' } },
        },
      },
      {
        operation: {
          operation_type: 'transform',
          transform: { op: 'map', field_mapping: { from: 'from', subject: 'subject', id: 'id' } },
        },
      },
    ];
    expect(someNodeReferencesGatedField(nodes, gated)).toBe(false);
  });
});
