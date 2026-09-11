/**
 * The names a write was approved under must survive to the moment it runs.
 *
 * Resolution happens BEFORE the preview; execution happens AFTER the user says
 * yes. Anything the executor needs in order to describe what it did has to
 * cross that gap explicitly — it is not re-derived, and it must not be
 * re-queried, because the user approved a line naming one specific person.
 *
 * It did not cross. `applyFrozenWrites` called the executor with `{ language }`
 * alone, so a task confirmed as
 *
 *   "הוסף משימה — כותרת: לוודא שהכסף הוחזר · איש קשר: דויד המלך"
 *
 * was reported as
 *
 *   "בוצע — ... · איש קשר: 8742fcd8-fdfc-4e32-bb1f-c599cf72adf5"
 *
 * The same invariant as the frozen rows, applied to labels.
 */

import { applyFrozenWrites } from '../mutate/applyWrites';
import { executeMutate } from '../mutate/MutateExecutor';
import type { MutateQuery } from '../types';

jest.mock('../mutate/MutateExecutor', () => ({
  executeMutate: jest.fn(async () => ({ preview: 'done' })),
}));

jest.mock('../mutate/ForEachExecutor', () => ({
  executeForEach: jest.fn(async () => ({ succeeded: 0, attempted: 0, failed: 0, skipped: 0 })),
}));

const mockExecute = executeMutate as jest.MockedFunction<typeof executeMutate>;

const step = (id: string): MutateQuery =>
  ({ id, op: 'mutate', entity: 'tasks', action: 'create', data: {} }) as MutateQuery;

describe('applying frozen writes', () => {
  beforeEach(() => mockExecute.mockClear());

  it('hands the executor the names the user approved', async () => {
    await applyFrozenWrites({
      steps: [step('s1')],
      userId: 'u1',
      planId: 'p1',
      language: 'he',
      names: [{ targetName: 'דויד המלך', referenceNames: { contact_id: 'דויד המלך' } }],
    });

    expect(mockExecute).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        targetName: 'דויד המלך',
        referenceNames: { contact_id: 'דויד המלך' },
      })
    );
  });

  it('aligns names to steps POSITIONALLY, so a second write is not given the first name', async () => {
    // The alignment is by index, which is only safe because the caller builds
    // `names` and `steps` from the same array in the same order. If that ever
    // stops being true, this is the test that fails rather than a user seeing
    // someone else's name on their confirmation.
    await applyFrozenWrites({
      steps: [step('s1'), step('s2')],
      userId: 'u1',
      planId: 'p1',
      names: [{ targetName: 'first' }, { targetName: 'second' }],
    });

    expect(mockExecute).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ targetName: 'first' })
    );
    expect(mockExecute).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ targetName: 'second' })
    );
  });

  it('still applies when there are no names — a saved plan re-run has none', async () => {
    // Optional by design. A re-run was never previewed, so it has no approved
    // labels to carry; it must execute rather than throw.
    const result = await applyFrozenWrites({
      steps: [step('s1')],
      userId: 'u1',
      planId: 'p1',
    });

    expect(result.applied).toHaveLength(1);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ targetName: undefined, referenceNames: undefined })
    );
  });
});
