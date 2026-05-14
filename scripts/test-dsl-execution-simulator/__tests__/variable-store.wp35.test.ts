/**
 * VariableStore — WP-35 (array-index syntax in template refs)
 *
 * Background:
 *   The Phase A DSL execution simulator didn't recognize `field[N]` array-index
 *   syntax inside `{{...}}` template references. For
 *   `{{contracts_folder_results.files[0].id}}`:
 *     - `_lookupRef` split on "." and tried `value["files[0]"]` (literal
 *       property lookup) → undefined → marked the ref unresolved.
 *
 *   The runtime `ExecutionContext.resolveVariable` correctly handles this
 *   syntax, so Phase A was a false-positive failure for any scenario using
 *   `{{var.field[N].subfield}}` to pick the Nth element inline.
 *
 *   The fix: `parsePathSegment(segment)` parses each dotted-path segment for
 *   optional `<name>[<index>]`, and `_lookupRef`'s walker honors both.
 *
 * Encountered as: Phase A on `contract-enddate-summary` (2026-05-14).
 */

import { VariableStore, parsePathSegment } from '../variable-store';

// ─── parsePathSegment ──────────────────────────────────────────────────────

describe('WP-35 — parsePathSegment', () => {
  it('parses "files[0]" → {name: "files", index: 0}', () => {
    expect(parsePathSegment('files[0]')).toEqual({ name: 'files', index: 0 });
  });

  it('parses "files" → {name: "files", index: null}', () => {
    expect(parsePathSegment('files')).toEqual({ name: 'files', index: null });
  });

  it('parses "items[10]" → multi-digit indices', () => {
    expect(parsePathSegment('items[10]')).toEqual({ name: 'items', index: 10 });
  });

  it('treats "snake_case_name[3]" as name + index', () => {
    expect(parsePathSegment('snake_case_name[3]')).toEqual({
      name: 'snake_case_name',
      index: 3,
    });
  });

  it('does not match malformed bracket syntax (treats as bare name)', () => {
    expect(parsePathSegment('files[abc]')).toEqual({ name: 'files[abc]', index: null });
    expect(parsePathSegment('files[]')).toEqual({ name: 'files[]', index: null });
  });
});

// ─── _lookupRef via resolveDeep (the public API path) ──────────────────────

function makeStore(stepOutputs: Record<string, any>): VariableStore {
  const store = new VariableStore({});
  for (const [name, value] of Object.entries(stepOutputs)) {
    store.setStepOutput(name, value);
  }
  return store;
}

describe('WP-35 — _lookupRef walks array-index syntax', () => {
  it('resolves "{{var.field[0].subfield}}" against a stub with the matching shape', () => {
    const store = makeStore({
      contracts_folder_results: {
        files: [
          { id: 'folder-A', name: 'Contracts' },
          { id: 'folder-B', name: 'Old Contracts' },
        ],
      },
    });

    const result = store.resolveDeep({
      folder_id: '{{contracts_folder_results.files[0].id}}',
    });

    expect(result.resolved.folder_id).toBe('folder-A');
    expect(result.unresolvedRefs).toEqual([]);
  });

  it('resolves "{{var.field[1].subfield}}" for non-zero indices', () => {
    const store = makeStore({
      result: {
        items: [
          { id: 'a' },
          { id: 'b' },
          { id: 'c' },
        ],
      },
    });

    const out = store.resolveDeep({ x: '{{result.items[1].id}}' });

    expect(out.resolved.x).toBe('b');
    expect(out.unresolvedRefs).toEqual([]);
  });

  it('returns undefined (marked unresolved) when index is out of bounds', () => {
    const store = makeStore({
      result: { items: [{ id: 'a' }] },
    });

    const out = store.resolveDeep({ x: '{{result.items[5].id}}' });

    expect(out.unresolvedRefs).toContain('{{result.items[5].id}}');
  });

  it('returns undefined when the property exists but is not an array', () => {
    const store = makeStore({
      result: { files: 'not-an-array' },
    });

    const out = store.resolveDeep({ x: '{{result.files[0].id}}' });

    expect(out.unresolvedRefs).toContain('{{result.files[0].id}}');
  });

  it('resolves "{{var.field[0]}}" without a sub-access (returns the array element)', () => {
    const store = makeStore({
      result: { tags: ['urgent', 'invoice', 'paid'] },
    });

    const out = store.resolveDeep({ tag: '{{result.tags[0]}}' });

    expect(out.resolved.tag).toBe('urgent');
    expect(out.unresolvedRefs).toEqual([]);
  });

  it('regression — non-indexed paths still work', () => {
    const store = makeStore({
      step1: { count: 42, label: 'hello' },
    });

    const out = store.resolveDeep({
      count: '{{step1.count}}',
      label: '{{step1.label}}',
    });

    expect(out.resolved).toEqual({ count: 42, label: 'hello' });
    expect(out.unresolvedRefs).toEqual([]);
  });

  it('regression — config.X and input.X still work (no array-index relevance)', () => {
    const store = new VariableStore({ amount_threshold: 50, recipient: 'a@b.c' });

    const out = store.resolveDeep({
      threshold: '{{input.amount_threshold}}',
      to: '{{config.recipient}}',
    });

    expect(out.resolved).toEqual({ threshold: 50, to: 'a@b.c' });
  });

  it('resolves chained array-index segments: var.field[0].nested[2].id', () => {
    const store = makeStore({
      report: {
        groups: [
          {
            members: [
              { id: 'x' },
              { id: 'y' },
              { id: 'z' },
            ],
          },
        ],
      },
    });

    const out = store.resolveDeep({ x: '{{report.groups[0].members[2].id}}' });

    expect(out.resolved.x).toBe('z');
  });

  it('canonical contract-enddate-summary case: {{contracts_folder_results.files[0].id}}', () => {
    // Stub from output_schema: object with `files` (array of {id, name, ...})
    const store = makeStore({
      contracts_folder_results: {
        files: [{ id: 'abc123', name: 'Contracts' }],
        file_count: 1,
        search_query: "name = 'Contracts'",
      },
    });

    const out = store.resolveDeep({
      folder_id: '{{contracts_folder_results.files[0].id}}',
    });

    expect(out.resolved.folder_id).toBe('abc123');
    expect(out.unresolvedRefs).toEqual([]);
  });
});
