/**
 * StubDataGenerator — WP-36 (document-name bank for keyword-filter realism)
 *
 * Background:
 *   The generic fallback `mock_${fieldName}_${idx}` produced names like
 *   `mock_name_001` which never match any keyword filter. Phase D failed
 *   on `contract-enddate-summary` step3 because the LLM's
 *   `contains_any ["Contract", "Agreement", "MSA", "SOW", "Order Form",
 *   "Statement of Work"]` filter dropped all 3 mock items, then `on_empty:
 *   "throw"` correctly aborted the workflow.
 *
 *   Fix: cycle the `name` field through a bank of realistic business-document
 *   names that collectively cover common substring keywords.
 *
 * Encountered as: Phase D on `contract-enddate-summary` (2026-05-14).
 */

import { generateFromSchema } from '../stub-data-generator';

// ─── Bank cycling on the `name` field ─────────────────────────────────────

describe('WP-36 — `name` field cycles through document-name bank', () => {
  function genName(indexSuffix: string): string {
    return generateFromSchema(
      { type: 'object', properties: { name: { type: 'string' } } },
      { indexSuffix },
    ).name as string;
  }

  it('returns a non-mock_name_NNN value at idx 001', () => {
    const v = genName('001');
    expect(v).not.toMatch(/^mock_name/);
    expect(typeof v).toBe('string');
    expect(v.length).toBeGreaterThan(0);
  });

  it('cycles through distinct names across indices 001..006', () => {
    const names = ['001', '002', '003', '004', '005', '006'].map(genName);
    const unique = new Set(names);
    expect(unique.size).toBe(6);
  });

  it('wraps when array length exceeds bank size', () => {
    const at001 = genName('001');
    const at007 = genName('007'); // bank has 6 entries → 007 wraps to first
    expect(at007).toBe(at001);
  });

  it('canonical contract-enddate keyword coverage — at least one name matches each keyword', () => {
    const keywords = ['Contract', 'Agreement', 'MSA', 'SOW', 'Order Form', 'Statement of Work'];
    const names = ['001', '002', '003', '004', '005', '006'].map(genName);

    for (const keyword of keywords) {
      const matches = names.filter(n => n.includes(keyword));
      expect(matches.length).toBeGreaterThan(0);
    }
  });

  it('end-to-end: array of `name`-bearing items produces at least 1 match for contract-enddate keywords', () => {
    // Mirrors google-drive.list_files output shape: { files: [{name, id, ...}, ...] }
    const schema = {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              mimeType: { type: 'string' },
            },
          },
        },
      },
    };

    const stub = generateFromSchema(schema, { arrayItemCount: 3 });

    const fileNames = stub.files.map((f: any) => f.name);
    const matchesAny = fileNames.some((n: string) =>
      ['Contract', 'Agreement', 'MSA', 'SOW', 'Order Form', 'Statement of Work'].some(kw =>
        n.includes(kw),
      ),
    );
    expect(matchesAny).toBe(true);
  });

  it('also applies to the `title` field (same fallback gap)', () => {
    const v = generateFromSchema(
      { type: 'object', properties: { title: { type: 'string' } } },
      { indexSuffix: '001' },
    ).title;
    expect(v).not.toMatch(/^mock_title/);
  });
});

// ─── Regression — other string fields keep their existing generators ───────

describe('WP-36 — regression: other fields untouched by bank', () => {
  function genField(fieldName: string, indexSuffix = '001'): string {
    const schema = { type: 'object', properties: { [fieldName]: { type: 'string' } } };
    return generateFromSchema(schema, { indexSuffix })[fieldName];
  }

  it('filename still returns `invoice_NNN.pdf`', () => {
    expect(genField('filename')).toBe('invoice_001.pdf');
  });

  it('folder_name still returns `Vendor_NNN`', () => {
    expect(genField('folder_name')).toBe('Vendor_001');
  });

  it('subject still returns invoice-themed subject', () => {
    expect(genField('subject')).toMatch(/^Invoice #INV-001/);
  });

  it('vendor still returns `Acme Corp NNN`', () => {
    expect(genField('vendor')).toBe('Acme Corp 001');
  });

  it('arbitrary unmapped string field still falls through to mock_${name}_${idx}', () => {
    expect(genField('weird_custom_field')).toBe('mock_weird_custom_field_001');
  });
});
