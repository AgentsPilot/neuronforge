/**
 * C-39 — storage listing must be RECURSIVE.
 *
 * Supabase Storage `list(prefix)` returns only the immediate children of a
 * prefix; a sub-folder comes back as an entry with no `id`. Every writer in
 * this codebase nests at least two levels:
 *
 *     contact-documents/{userId}/{contactId}/{ts}_{name}
 *     contact-documents/{userId}/{contactId}/intake/{uuid}
 *     website-images/{userId}/generated/{ref}.png
 *
 * Slice 1 shipped a single-level listing. On real data it reported **0 of 10**
 * contact documents for one account, and slice 2's removal — built the same way
 * — would have deleted none of them while reporting success with zero failures.
 *
 * This suite fails if anyone reverts to a single-level `list(userId)`.
 *
 * Runs under Jest without network access: the repository accepts an injected
 * client, and a fake storage tree stands in for Supabase. (supabase-js has no
 * working `fetch` in this repo's Jest environment, so a real client would fail
 * here for reasons unrelated to the code under test.)
 */

import { BusinessPurgeRepository } from '../BusinessPurgeRepository';

type Entry = { name: string; id: string | null };

/**
 * A fake bucket built from a flat list of object paths. `list(prefix)` returns
 * immediate children only — exactly as the real API does — so a single-level
 * implementation genuinely cannot see nested objects.
 */
function fakeStorage(objectPaths: string[]) {
  const removed: string[] = [];

  const list = (prefix: string, opts?: { limit?: number; offset?: number }) => {
    const children = new Map<string, Entry>();
    for (const full of objectPaths) {
      if (!full.startsWith(`${prefix}/`)) continue;
      const rest = full.slice(prefix.length + 1);
      const [head, ...tail] = rest.split('/');
      children.set(head, { name: head, id: tail.length === 0 ? `id:${full}` : null });
    }
    const all = [...children.values()];
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? all.length;
    return Promise.resolve({ data: all.slice(offset, offset + limit), error: null });
  };

  const client = {
    storage: {
      from: () => ({
        list,
        remove: (paths: string[]) => {
          removed.push(...paths);
          return Promise.resolve({ data: paths.map((name) => ({ name })), error: null });
        },
      }),
    },
  };

  return { client, removed };
}

const USER = 'user-1';

const NESTED = [
  `${USER}/contact-a/1_contract.pdf`,
  `${USER}/contact-a/intake/aaa-uuid`,
  `${USER}/contact-a/intake/bbb-uuid`,
  `${USER}/contact-b/2_invoice.pdf`,
  `${USER}/generated/hero.png`,
  // Another tenant's files and a shared top-level folder must NOT be touched.
  `other-user/contact-z/secret.pdf`,
  `logos/shared.png`,
];

describe('BusinessPurgeRepository — recursive storage (C-39)', () => {
  it('counts objects nested two and three levels deep', async () => {
    const { client } = fakeStorage(NESTED);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a structural fake of the storage client
    const repo = new BusinessPurgeRepository(client as any);

    const result = await repo.countStorageObjects('contact-documents', USER);

    // 5 objects under USER: 1_contract, 2 intake uuids, 2_invoice, hero.png.
    // A single-level `list(USER)` would see only the folders
    // contact-a, contact-b, generated — none with an id — and report 0.
    expect(result.count).toBe(5);
    expect(result.truncated).toBe(false);
  });

  it('removes every nested object, including the intake/{uuid} depth', async () => {
    const { client, removed } = fakeStorage(NESTED);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a structural fake of the storage client
    const repo = new BusinessPurgeRepository(client as any);

    const result = await repo.removeStorageUnderUser('contact-documents', USER);

    expect(result.deleted).toBe(5);
    expect(result.failed).toEqual([]);
    expect(removed).toEqual(
      expect.arrayContaining([
        `${USER}/contact-a/intake/aaa-uuid`,
        `${USER}/contact-a/intake/bbb-uuid`,
        `${USER}/contact-a/1_contract.pdf`,
      ])
    );
  });

  it('never touches another tenant or a shared top-level folder', async () => {
    const { client, removed } = fakeStorage(NESTED);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a structural fake of the storage client
    const repo = new BusinessPurgeRepository(client as any);

    await repo.removeStorageUnderUser('contact-documents', USER);

    expect(removed.every((p) => p.startsWith(`${USER}/`))).toBe(true);
    expect(removed).not.toContain('other-user/contact-z/secret.pdf');
    expect(removed).not.toContain('logos/shared.png');
  });

  it('reports a single-level tree correctly too (no regression the other way)', async () => {
    const { client } = fakeStorage([`${USER}/flat-1.png`, `${USER}/flat-2.png`]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a structural fake of the storage client
    const repo = new BusinessPurgeRepository(client as any);

    expect((await repo.countStorageObjects('website-images', USER)).count).toBe(2);
  });
});
