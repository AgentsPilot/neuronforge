/**
 * injectUnboundActionParams — WP-60 Part B (runtime safety net)
 *
 * Binds an action param the compiler left UNBOUND, using a step-tagged
 * namespaced input value — matched by the key's plugin + the action schema,
 * conservative and backward-safe. Repairs already-saved agents on next
 * execution without a DSL rebuild. Sibling of reconcileInputsToDsl (which fills
 * an *existing* {{input.X}} ref; this injects a param with no ref at all).
 */

import { injectUnboundActionParams, type ActionParamResolver } from '../injectUnboundActionParams';
import type { WorkflowStep } from '../types';

const DRIVE_LIST_PARAMS = ['folder_id', 'max_results', 'order_by', 'file_types', 'include_trashed'];

// Resolver mirroring the real plugin schema for the actions used in these tests.
const resolver: ActionParamResolver = (plugin, action) => {
  if (plugin === 'google-drive' && action === 'list_files') return DRIVE_LIST_PARAMS;
  if (plugin === 'google-drive' && action === 'download_file') return ['file_id', 'export_format'];
  return null; // unknown action
};

const listFilesStep = (params: Record<string, any> = {}): WorkflowStep =>
  ({ id: 'step1', type: 'action', plugin: 'google-drive', action: 'list_files', params } as unknown as WorkflowStep);

const URL = 'https://drive.google.com/drive/u/0/folders/1Wszlm9qgqPVQyHYp1lWmlkipRFLVQLAk';

describe('injectUnboundActionParams (WP-60 Part B)', () => {
  it('injects folder_id from a step-tagged folder_link when the compiler left it unbound', () => {
    const step = listFilesStep({ max_results: 100 }); // folder_id absent
    const injected = injectUnboundActionParams([step], {
      folder_link: URL,                                  // flat — not plugin-tagged, ignored
      'google-drive__list__folder_link': URL,            // step-tagged — used
    }, resolver);

    expect((step as any).params.folder_id).toBe(URL);
    expect(injected).toEqual([
      { step: 'step1', param: 'folder_id', from: 'google-drive__list__folder_link', plugin: 'google-drive' },
    ]);
  });

  it('tolerates the storage/list capability form in the namespaced key', () => {
    const step = listFilesStep();
    injectUnboundActionParams([step], { 'google-drive__storage/list__folder_link': URL }, resolver);
    expect((step as any).params.folder_id).toBe(URL);
  });

  it('never overwrites a param already bound on the step', () => {
    const step = listFilesStep({ folder_id: 'ALREADY_BOUND' });
    const injected = injectUnboundActionParams([step], { 'google-drive__list__folder_link': URL }, resolver);
    expect((step as any).params.folder_id).toBe('ALREADY_BOUND');
    expect(injected).toHaveLength(0);
  });

  it('does not inject for an unknown action (resolver returns null)', () => {
    const step = { id: 's', type: 'action', plugin: 'mystery', action: 'do', params: {} } as unknown as WorkflowStep;
    const injected = injectUnboundActionParams([step], { 'mystery__cap__folder_link': URL }, resolver);
    expect(injected).toHaveLength(0);
    expect((step as any).params.folder_id).toBeUndefined();
  });

  it('does not inject a value with no stem match to any schema param', () => {
    // key param 'sheet_link' (stem 'sheet') matches no google-drive list param
    const step = listFilesStep();
    const injected = injectUnboundActionParams([step], { 'google-drive__list__sheet_link': 'x' }, resolver);
    expect(injected).toHaveLength(0);
  });

  it('skips when two tagged keys ambiguously stem-match the same param', () => {
    const step = listFilesStep();
    const injected = injectUnboundActionParams([step], {
      'google-drive__list__folder_link': URL,
      'google-drive__list__folder_url': 'https://drive.google.com/drive/folders/OTHER',
    }, resolver);
    expect(injected).toHaveLength(0);
    expect((step as any).params.folder_id).toBeUndefined();
  });

  it('ignores tagged values whose plugin does not match the step', () => {
    const step = listFilesStep();
    const injected = injectUnboundActionParams([step], { 'some-other__list__folder_link': URL }, resolver);
    expect(injected).toHaveLength(0);
  });

  it('creates a params object when the step has none', () => {
    const step = { id: 'step1', type: 'action', plugin: 'google-drive', action: 'list_files' } as unknown as WorkflowStep;
    injectUnboundActionParams([step], { 'google-drive__list__folder_link': URL }, resolver);
    expect((step as any).params.folder_id).toBe(URL);
  });

  it('injects into a step nested inside a scatter_gather block', () => {
    const inner = { id: 'inner', type: 'action', plugin: 'google-drive', action: 'download_file', params: {} };
    const scatter = {
      id: 'sg', type: 'scatter_gather',
      scatter: { input: '{{x}}', steps: [inner] },
    } as unknown as WorkflowStep;

    injectUnboundActionParams([scatter], { 'google-drive__storage/download__file_link': 'https://…/file/d/ABC/view' }, resolver);
    expect((inner as any).params.file_id).toBe('https://…/file/d/ABC/view');
  });

  it('does not route one tagged value into two different params', () => {
    // Both schema params share stem 'folder'? No — only folder_id does. Construct a
    // resolver where two params share the stem to prove the one-value guard.
    const twoFolderResolver: ActionParamResolver = () => ['folder_id', 'folder_url'];
    const step = { id: 's', type: 'action', plugin: 'google-drive', action: 'x', params: {} } as unknown as WorkflowStep;
    const injected = injectUnboundActionParams([step], { 'google-drive__cap__folder_link': URL }, twoFolderResolver);
    // Single key stem-matches both folder_id and folder_url → ambiguous per-param
    // (each param sees exactly one candidate), but the value must land in at most one.
    expect(injected.length).toBeLessThanOrEqual(1);
  });

  it('fills only the first step when two same-plugin steps share a stem and one key exists', () => {
    // Two list_files steps, both missing folder_id, one tagged folder_link key.
    // The value lands in the first-visited step; the second is skipped (the value
    // is not fanned across both). Documented first-wins behavior (SA NIT-3).
    const stepA = { id: 'a', type: 'action', plugin: 'google-drive', action: 'list_files', params: {} } as unknown as WorkflowStep;
    const stepB = { id: 'b', type: 'action', plugin: 'google-drive', action: 'list_files', params: {} } as unknown as WorkflowStep;

    const injected = injectUnboundActionParams([stepA, stepB], { 'google-drive__list__folder_link': URL }, resolver);

    expect((stepA as any).params.folder_id).toBe(URL);
    expect((stepB as any).params.folder_id).toBeUndefined();
    expect(injected).toHaveLength(1);
  });

  it('returns empty and no-ops when there are no namespaced keys', () => {
    const step = listFilesStep();
    const injected = injectUnboundActionParams([step], { folder_link: URL }, resolver);
    expect(injected).toHaveLength(0);
    expect((step as any).params.folder_id).toBeUndefined();
  });
});
