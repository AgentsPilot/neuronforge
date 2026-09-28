/**
 * C-3 — the invite token: 256 random bits, base64url, stored only as SHA-256.
 */

import { createHash } from 'crypto';

import {
  INVITE_TOKEN_PATTERN,
  buildInviteLink,
  generateInviteToken,
  hashInviteToken,
  isWellFormedInviteToken,
} from '../inviteToken';
import { platformUrl } from '@/lib/utils/origins';

describe('generateInviteToken', () => {
  it('is 43 base64url characters (32 bytes, no padding)', () => {
    const token = generateInviteToken();
    expect(token).toHaveLength(43);
    expect(token).toMatch(INVITE_TOKEN_PATTERN);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  });

  it('1,000 draws are all distinct', () => {
    const draws = new Set(Array.from({ length: 1000 }, () => generateInviteToken()));
    expect(draws.size).toBe(1000);
  });
});

describe('isWellFormedInviteToken', () => {
  it('accepts a generated token', () => {
    expect(isWellFormedInviteToken(generateInviteToken())).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['too short', 'abc'],
    ['44 characters', 'a'.repeat(44)],
    ['42 characters', 'a'.repeat(42)],
    ['a character outside the set', `${'a'.repeat(42)}+`],
    ['padding', `${'a'.repeat(42)}=`],
    ['whitespace', ` ${'a'.repeat(42)}`],
  ])('refuses %s', (_label, candidate) => {
    expect(isWellFormedInviteToken(candidate)).toBe(false);
  });
});

describe('hashInviteToken', () => {
  it('is SHA-256 in lowercase hex, 64 characters, and deterministic', () => {
    const token = generateInviteToken();
    const hash = hashInviteToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashInviteToken(token));
    expect(hash).toBe(createHash('sha256').update(token).digest('hex'));
  });

  it('is never the token itself, and one changed character changes it', () => {
    const token = generateInviteToken();
    const changed = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
    expect(hashInviteToken(token)).not.toBe(token);
    expect(hashInviteToken(changed)).not.toBe(hashInviteToken(token));
  });
});

describe('buildInviteLink', () => {
  it('is the platform /invite page with the token in the fragment, never in a query', () => {
    const token = generateInviteToken();
    const link = buildInviteLink(token);
    expect(link).toBe(`${platformUrl('/invite')}#t=${token}`);
    expect(link.startsWith(`${platformUrl('/invite')}#t=`)).toBe(true);
    expect(link).not.toContain('?');
  });
});
