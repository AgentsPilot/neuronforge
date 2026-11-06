/**
 * The one "is a deletion request open?" reader (DL-1b; workplan §8; XC-19;
 * SA W-10). It reads the closure repository, fails closed, never throws, and
 * imports nothing from the entitlements module.
 */

import fs from 'fs';
import path from 'path';

const mockFindOpen = jest.fn();
jest.mock('@/lib/repositories/AccountClosureRepository', () => ({
  AccountClosureRepository: jest.fn().mockImplementation(() => ({ findOpenForUser: (...args: unknown[]) => mockFindOpen(...args) })),
}));

import { readDeletionPending } from '../deletionPendingReader';

const USER = '11111111-1111-4111-8111-111111111111';

beforeEach(() => mockFindOpen.mockReset());

describe('readDeletionPending', () => {
  it.each(['requesting', 'pending', 'grace', 'locked'])('an open row (%s) → open', async (status) => {
    mockFindOpen.mockResolvedValueOnce({ data: { id: 'c1', status }, error: null });
    expect(await readDeletionPending(USER)).toBe('open');
    expect(mockFindOpen).toHaveBeenCalledWith(USER);
  });

  it('no open row → none', async () => {
    mockFindOpen.mockResolvedValueOnce({ data: null, error: null });
    expect(await readDeletionPending(USER)).toBe('none');
  });

  it('a read error → unreadable (callers refuse: fail closed)', async () => {
    mockFindOpen.mockResolvedValueOnce({ data: null, error: new Error('down') });
    expect(await readDeletionPending(USER)).toBe('unreadable');
  });

  it('a throw (never by contract) → unreadable, not a rejection', async () => {
    mockFindOpen.mockRejectedValueOnce(new Error('boom'));
    await expect(readDeletionPending(USER)).resolves.toBe('unreadable');
  });

  it('an injected repository is used instead of the shared one', async () => {
    const repo = { findOpenForUser: jest.fn(async () => ({ data: null, error: null })) };
    expect(await readDeletionPending(USER, repo as never)).toBe('none');
    expect(repo.findOpenForUser).toHaveBeenCalledWith(USER);
    expect(mockFindOpen).not.toHaveBeenCalled();
  });
});

describe('SA CR-5: never throws, the shared repository included', () => {
  it('a repository constructor that throws (a missing env) → unreadable, not a rejection', async () => {
    let isolated: typeof import('../deletionPendingReader') | undefined;
    jest.isolateModules(() => {
      jest.doMock('@/lib/repositories/AccountClosureRepository', () => ({
        AccountClosureRepository: jest.fn().mockImplementation(() => {
          throw new Error('supabaseUrl is required');
        }),
      }));
      isolated = jest.requireActual<typeof import('../deletionPendingReader')>('../deletionPendingReader');
    });
    await expect(isolated!.readDeletionPending(USER)).resolves.toBe('unreadable');
  });
});

describe('XC-19 (SA W-10): the closure repository, never the entitlements module', () => {
  it('imports nothing from lib/business-os/entitlements', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'deletionPendingReader.ts'), 'utf8');
    expect(source).not.toMatch(/from\s+['"][^'"]*business-os\/entitlements/);
    expect(source).toMatch(/from '@\/lib\/repositories\/AccountClosureRepository'/);
  });
});
