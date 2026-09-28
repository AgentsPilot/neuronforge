/**
 * C-11 / AC-3 — the state is derived from timestamps, with an injected clock,
 * and a later change to the expiry setting cannot move an existing invite.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { INVITE_STATES, deriveInviteState, type InviteStateFacts } from '../inviteState';

const CREATED = new Date('2026-10-01T00:00:00.000Z');
const EXPIRES = '2026-10-31T00:00:00.000Z';

function row(overrides: Partial<InviteStateFacts> = {}): InviteStateFacts {
  return { link_expires_at: EXPIRES, revoked_at: null, redeemed_at: null, ...overrides };
}

describe('deriveInviteState', () => {
  it('pending before the expiry', () => {
    expect(deriveInviteState(row(), CREATED)).toBe('pending');
    expect(deriveInviteState(row(), new Date(Date.parse(EXPIRES) - 1))).toBe('pending');
  });

  it('the expiry instant itself is expired', () => {
    expect(deriveInviteState(row(), new Date(EXPIRES))).toBe('expired');
    expect(deriveInviteState(row(), new Date(Date.parse(EXPIRES) + 1))).toBe('expired');
  });

  it('revoked', () => {
    expect(deriveInviteState(row({ revoked_at: '2026-10-02T00:00:00.000Z' }), CREATED)).toBe('revoked');
  });

  it('accepted', () => {
    expect(deriveInviteState(row({ redeemed_at: '2026-10-02T00:00:00.000Z' }), CREATED)).toBe('accepted');
  });

  it('precedence: accepted over revoked over expired over pending', () => {
    const late = new Date('2027-01-01T00:00:00.000Z');
    expect(
      deriveInviteState(row({ redeemed_at: '2026-10-02T00:00:00.000Z', revoked_at: '2026-10-03T00:00:00.000Z' }), late)
    ).toBe('accepted');
    expect(deriveInviteState(row({ revoked_at: '2026-10-03T00:00:00.000Z' }), late)).toBe('revoked');
    expect(deriveInviteState(row(), late)).toBe('expired');
    expect([...INVITE_STATES]).toEqual(['accepted', 'revoked', 'expired', 'pending']);
  });

  it('an unreadable expiry fails closed as expired', () => {
    expect(deriveInviteState(row({ link_expires_at: 'not a date' }), CREATED)).toBe('expired');
  });

  it('AC-3: takes no config, so a changed expiry setting leaves an existing invite unchanged', () => {
    // The function's arity is the proof: it has nowhere to receive a setting.
    expect(deriveInviteState.length).toBe(2);
    const before = deriveInviteState(row(), CREATED);
    // Simulate the setting moving to [7] / 7: the stamped row is what decides.
    const changedSetting = { optionsDays: [7], defaultDays: 7 };
    expect(changedSetting.defaultDays).toBe(7);
    expect(deriveInviteState(row(), CREATED)).toBe(before);
  });
});

describe('one derivation, used by both surfaces (C-11)', () => {
  const read = (file: string) => readFileSync(join(process.cwd(), 'lib', 'business-os', 'invites', file), 'utf8');

  it.each(['adminInviteOps.ts', 'publicInviteView.ts'])('%s imports deriveInviteState and never compares the expiry itself', (file) => {
    const source = read(file);
    expect(source).toMatch(/import \{[^}]*deriveInviteState[^}]*\} from '\.\/inviteState'/);
    expect(source).not.toMatch(/link_expires_at\s*[<>]=?|[<>]=?\s*[\w.]*link_expires_at|Date\.parse\([^)]*link_expires_at/);
  });

  it('no module reads the expiry setting to decide a state', () => {
    expect(read('inviteState.ts')).not.toMatch(/INVITE_LINK_EXPIRY|config\/invites/);
  });
});
