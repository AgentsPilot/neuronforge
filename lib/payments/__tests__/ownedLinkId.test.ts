/**
 * `vetLinkId` / `isUuidShaped` — the one rule for a link id that arrived from
 * someone else (webhook Fix-1b, SA Q-1 / Q-2).
 *
 * The shape rule is the canonical form our own code writes (8-4-4-4-12 hex,
 * either case), deliberately narrower than everything Postgres would accept,
 * and nothing is trimmed: untrusted input is dropped, never repaired.
 */

import { isUuidShaped, vetLinkId } from '../ownedLinkId';

const ID = '33333333-3333-4333-8333-333333333333';
const OWNER = '11111111-1111-4111-8111-111111111111';

describe('isUuidShaped', () => {
  it.each([
    ['lower case', ID],
    ['upper case (Postgres reads it as the same uuid)', ID.toUpperCase()],
  ])('accepts %s', (_label, value) => {
    expect(isUuidShaped(value)).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['padded', ` ${ID} `],
    ['trailing newline', `${ID}\n`],
    ['braces (Postgres accepts, we never write it)', `{${ID}}`],
    ['no hyphens (Postgres accepts, we never write it)', ID.replace(/-/g, '')],
    ['too short', ID.slice(0, -1)],
    ['non-hex', ID.replace(/^3/, 'g')],
    ['a slug', 'bk-0002'],
    ['an injection attempt', "x'); drop table--"],
  ])('rejects %s', (_label, value) => {
    expect(isUuidShaped(value)).toBe(false);
  });
});

describe('vetLinkId', () => {
  const owned = jest.fn(async (id: string) => ({ data: id, error: null }));
  const notOwned = jest.fn(async () => ({ data: null, error: null }));
  const failing = jest.fn(async () => ({ data: null, error: new Error('read failed') }));

  beforeEach(() => jest.clearAllMocks());

  it.each([undefined, null, ''])('absent (%p): nothing read, nothing dropped', async (raw) => {
    expect(await vetLinkId(raw, OWNER, owned)).toEqual({ id: null, reason: null });
    expect(owned).not.toHaveBeenCalled();
  });

  it('owned: the id the repository returned, asked with the owner', async () => {
    expect(await vetLinkId(ID, OWNER, owned)).toEqual({ id: ID, reason: null });
    expect(owned).toHaveBeenCalledWith(ID, OWNER);
  });

  it('not owned: dropped as not_owned', async () => {
    expect(await vetLinkId(ID, OWNER, notOwned)).toEqual({ id: null, reason: 'not_owned' });
  });

  it('read error: dropped as read_failed (fails closed)', async () => {
    expect(await vetLinkId(ID, OWNER, failing)).toEqual({ id: null, reason: 'read_failed' });
  });

  it('not UUID-shaped: dropped as malformed WITHOUT a read', async () => {
    expect(await vetLinkId(` ${ID} `, OWNER, owned)).toEqual({ id: null, reason: 'malformed' });
    expect(owned).not.toHaveBeenCalled();
  });
});
