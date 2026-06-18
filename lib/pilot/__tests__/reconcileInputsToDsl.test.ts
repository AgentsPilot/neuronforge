/**
 * reconcileInputsToDsl — WP-57 2B Part 2 (execution-time input reconciliation)
 *
 * Background:
 *   A DSL step reads `folder_id: "{{input.folder_id}}"`, but the user-supplied
 *   folder arrives under a step-tagged namespaced key
 *   (`google-drive__storage/list__folder_link`) that never reaches `folder_id`,
 *   so `list_files` falls back to the Drive root. reconcileInputsToDsl bridges
 *   the tagged value onto the unmet reference at execution time.
 *
 * Invariants under test:
 *   - the canonical Drive case routes by stem (`folder_link` → `folder_id`)
 *   - exact-name matches are never overwritten (backward-safe)
 *   - a single-input step routes its single plugin-tagged value without a stem
 *   - genuine ambiguity routes nothing
 *   - non-namespaced keys are ignored; nested steps are reconciled
 *   - the input object is not mutated
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { reconcileInputsToDsl } from '../reconcileInputsToDsl';
import type { WorkflowStep } from '../types';

const listFilesStep = (): WorkflowStep =>
  ({
    id: 'step1',
    type: 'action',
    plugin: 'google-drive',
    action: 'list_files',
    params: { folder_id: '{{input.folder_id}}' },
  } as unknown as WorkflowStep);

describe('reconcileInputsToDsl', () => {
  it('routes a step-tagged folder_link onto an unmet folder_id by stem', () => {
    const url = 'https://drive.google.com/drive/u/0/folders/1Wszlm9qgqPVQyHYp1lWmlkipRFLVQLAk';
    const result = reconcileInputsToDsl([listFilesStep()], {
      folder_link: url, // non-namespaced — ignored
      'google-drive__storage/list__folder_link': url, // step-tagged — routed
    });

    expect(result.folder_id).toBe(url);
  });

  it('never overwrites an exact-name match that is already present', () => {
    const tagged = 'https://drive.google.com/drive/folders/TAGGED';
    const result = reconcileInputsToDsl([listFilesStep()], {
      folder_id: 'EXISTING_BARE_ID',
      'google-drive__storage/list__folder_link': tagged,
    });

    expect(result.folder_id).toBe('EXISTING_BARE_ID');
  });

  it('routes a single plugin-tagged value for a single-input step without a stem match', () => {
    const step = {
      id: 's',
      type: 'action',
      plugin: 'acme',
      action: 'do',
      params: { target: '{{input.target}}' },
    } as unknown as WorkflowStep;

    // param stem `destination` ≠ ref stem `target`, but the step has exactly one
    // unmet input and the plugin tagged exactly one value → the step disambiguates.
    const result = reconcileInputsToDsl([step], {
      'acme__group/op__destination': 'VALUE',
    });

    expect(result.target).toBe('VALUE');
  });

  it('routes nothing when multiple candidates have no stem match for a multi-input step', () => {
    const step = {
      id: 's',
      type: 'action',
      plugin: 'acme',
      action: 'do',
      params: { alpha: '{{input.alpha}}', beta: '{{input.beta}}' },
    } as unknown as WorkflowStep;

    const input = {
      'acme__g/op__gamma': 'G',
      'acme__g/op__delta': 'D',
    };
    const result = reconcileInputsToDsl([step], { ...input });

    expect(result.alpha).toBeUndefined();
    expect(result.beta).toBeUndefined();
  });

  it('disambiguates by stem when a step has several inputs and candidates', () => {
    const step = {
      id: 's',
      type: 'action',
      plugin: 'acme',
      action: 'do',
      params: { folder_id: '{{input.folder_id}}', file_id: '{{input.file_id}}' },
    } as unknown as WorkflowStep;

    const result = reconcileInputsToDsl([step], {
      'acme__g/op__folder_link': 'FOLDER',
      'acme__g/op__file_url': 'FILE',
    });

    expect(result.folder_id).toBe('FOLDER');
    expect(result.file_id).toBe('FILE');
  });

  it('ignores tagged values whose plugin does not match the step', () => {
    const result = reconcileInputsToDsl([listFilesStep()], {
      'some-other-plugin__cap__folder_link': 'WRONG_PLUGIN',
    });

    expect(result.folder_id).toBeUndefined();
  });

  it('reconciles steps nested inside a scatter_gather block', () => {
    const url = 'https://drive.google.com/drive/folders/NESTED';
    const scatter = {
      id: 'sg',
      type: 'scatter_gather',
      scatter: {
        input: '{{step1.data.items}}',
        steps: [
          {
            id: 'inner',
            type: 'action',
            plugin: 'google-drive',
            action: 'download_file',
            params: { folder_id: '{{input.folder_id}}' },
          },
        ],
      },
    } as unknown as WorkflowStep;

    const result = reconcileInputsToDsl([scatter], {
      'google-drive__storage/list__folder_link': url,
    });

    expect(result.folder_id).toBe(url);
  });

  it('reconciles steps nested inside a sub-workflow block (workflowSteps)', () => {
    const url = 'https://drive.google.com/drive/folders/SUBWF';
    const subWorkflow = {
      id: 'sub',
      type: 'sub_workflow',
      workflowSteps: [
        {
          id: 'inner',
          type: 'action',
          plugin: 'google-drive',
          action: 'list_files',
          params: { folder_id: '{{input.folder_id}}' },
        },
      ],
    } as unknown as WorkflowStep;

    const result = reconcileInputsToDsl([subWorkflow], {
      'google-drive__storage/list__folder_link': url,
    });

    expect(result.folder_id).toBe(url);
  });

  it('returns the same object when there are no namespaced keys', () => {
    const input = { folder_id: 'BARE', recipient_email: 'x@y.com' };
    const result = reconcileInputsToDsl([listFilesStep()], input);

    expect(result).toBe(input); // unchanged reference — no work done
  });

  it('does not mutate the caller’s inputValues', () => {
    const input = {
      'google-drive__storage/list__folder_link': 'https://drive.google.com/drive/folders/ID',
    };
    reconcileInputsToDsl([listFilesStep()], input);

    expect(input).not.toHaveProperty('folder_id');
  });
});

/**
 * QA edge-case coverage (WP-57 2B Part 2) — added during QA review.
 * Probes the real regression fixtures plus defensive / malformed-input paths
 * that the original 10 tests did not exercise.
 */
describe('reconcileInputsToDsl — QA edge cases', () => {
  const scenarioDir = join(
    __dirname,
    '../../../tests/v6-regression/scenarios/drive-invoice-summary-extractor'
  );
  const loadFixture = (name: string): any =>
    JSON.parse(readFileSync(join(scenarioDir, name), 'utf-8'));

  it('integration: routes folder URL onto folder_id using the REAL drive scenario fixtures', () => {
    const steps = loadFixture('phase4-pilot-dsl-steps.json') as WorkflowStep[];
    const fixture = loadFixture('phase4-workflow-config.json');

    // The committed snapshot happens to carry an exact `folder_id` key (its IC
    // declared one). Reconstruct the WP-60 *unmet* shape — an agent whose creation
    // flow emitted only `folder_link` (+ the step-tagged namespaced key) and no
    // `folder_id` — which is exactly the case this fix targets.
    const { folder_id: _drop, ...inputValues } = fixture;
    expect(inputValues.folder_id).toBeUndefined();
    expect(inputValues['google-drive__storage/list__folder_link']).toBeTruthy();

    const result = reconcileInputsToDsl(steps, inputValues);

    // step1 (google-drive list_files) reads {{input.folder_id}} → must be filled
    // from the step-tagged namespaced key.
    expect(result.folder_id).toBe(
      inputValues['google-drive__storage/list__folder_link']
    );
    // recipient_email was already present flat → untouched (no namespaced clobber).
    expect(result.recipient_email).toBe(inputValues.recipient_email);
    // The dotted google-mail send param is NOT routed onto a synthetic key.
    expect(result['recipients.to']).toBeUndefined();
    // No mutation of the source object.
    expect(inputValues.folder_id).toBeUndefined();
  });

  it('ignores a namespaced key with only two segments (plugin__param)', () => {
    const result = reconcileInputsToDsl([listFilesStep()], {
      'google-drive__folder_link': 'TWO_SEG',
    });
    expect(result.folder_id).toBeUndefined();
  });

  it('ignores a trailing-__ key (empty-named param is not a routable tag)', () => {
    const result = reconcileInputsToDsl([listFilesStep()], {
      'google-drive__storage/list__': 'TRAILING',
    });
    // parseNamespacedKey rejects an empty param segment, so the malformed key
    // never becomes a candidate and the single-candidate fallback can't fire.
    expect(result.folder_id).toBeUndefined();
  });

  it('does not route a present-but-empty-string namespaced value', () => {
    const result = reconcileInputsToDsl([listFilesStep()], {
      'google-drive__storage/list__folder_link': '',
    });
    expect(result.folder_id).toBeUndefined();
  });

  it('handles params with non-string values (number/null/nested arrays) alongside a template ref', () => {
    const url = 'https://drive.google.com/drive/folders/MIXED';
    const step = {
      id: 's',
      type: 'action',
      plugin: 'google-drive',
      action: 'list_files',
      params: {
        folder_id: '{{input.folder_id}}',
        max_results: 100,
        flag: null,
        nested: [{ deep: '{{input.folder_id}}' }, 42, null],
      },
    } as unknown as WorkflowStep;

    const result = reconcileInputsToDsl([step], {
      'google-drive__storage/list__folder_link': url,
    });
    expect(result.folder_id).toBe(url);
  });

  it('ignores action steps that have no params', () => {
    const step = {
      id: 's',
      type: 'action',
      plugin: 'google-drive',
      action: 'list_files',
    } as unknown as WorkflowStep;

    const input = { 'google-drive__storage/list__folder_link': 'X' };
    const result = reconcileInputsToDsl([step], input);
    // No params → step skipped; nothing routed. A fresh object is returned
    // (a namespaced key exists so the function copies), but content is unchanged.
    expect(result).toEqual(input);
    expect(result).not.toHaveProperty('folder_id');
  });

  it('returns inputValues unchanged when steps is not an array', () => {
    const input = { 'google-drive__storage/list__folder_link': 'X' };
    const result = reconcileInputsToDsl(undefined as unknown as WorkflowStep[], input);
    expect(result).toBe(input);
  });

  it('returns inputValues as-is when inputValues is null', () => {
    const result = reconcileInputsToDsl([listFilesStep()], null as unknown as Record<string, any>);
    expect(result).toBeNull();
  });

  it('returns inputValues as-is when inputValues is undefined', () => {
    const result = reconcileInputsToDsl(
      [listFilesStep()],
      undefined as unknown as Record<string, any>
    );
    expect(result).toBeUndefined();
  });
});
