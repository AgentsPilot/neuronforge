/**
 * The invitation sender (Slice 2a; D-1 to D-3, T-11, BQ-9): "<Name> via
 * AgentPilot" on the platform's address, header-safe, the fallback name, and
 * the Reply-To snapshot.
 */

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

import { INVITER_NAME_FALLBACK } from '../adminInviteOps';
import {
  INVITE_SENDER_BRAND,
  INVITE_SENDER_NAME_MAX,
  buildInviteFromHeader,
  cleanInviterName,
  isPlatformFallbackName,
  normaliseReplyToAddress,
} from '../inviteSender';

const ADDRESS = 'team@agentpilot.example';

describe('buildInviteFromHeader', () => {
  it('is "<Name> via AgentPilot" on the platform address', () => {
    expect(buildInviteFromHeader('Dana Levi', ADDRESS)).toBe(`"Dana Levi via AgentPilot" <${ADDRESS}>`);
  });

  it('the fallback name renders AgentPilot <address>, never "AgentPilot via AgentPilot" (D-3)', () => {
    expect(buildInviteFromHeader('AgentPilot', ADDRESS)).toBe(`AgentPilot <${ADDRESS}>`);
    expect(buildInviteFromHeader('  ', ADDRESS)).toBe(`AgentPilot <${ADDRESS}>`);
    expect(buildInviteFromHeader(null, ADDRESS)).toBe(`AgentPilot <${ADDRESS}>`);
    expect(buildInviteFromHeader('"<>"', ADDRESS)).toBe(`AgentPilot <${ADDRESS}>`);
  });

  it('the fallback matches the snapshot the create path stores (BQ-9)', () => {
    expect(INVITER_NAME_FALLBACK).toBe(INVITE_SENDER_BRAND);
    expect(isPlatformFallbackName(INVITER_NAME_FALLBACK)).toBe(true);
  });

  it.each([
    ['quotes', 'Dana "The Boss" Levi', 'Dana The Boss Levi'],
    ['a backslash', 'Dana\\Levi', 'Dana Levi'],
    ['angle brackets', 'Dana <evil@x.com>', 'Dana evil@x.com'],
    ['CR and LF', 'Dana\r\nBcc: victim@example.com', 'Dana Bcc: victim@example.com'],
    ['a tab and NUL', 'Dana\t\u0000Levi', 'Dana Levi'],
  ])('strips %s', (_label, raw, expected) => {
    expect(cleanInviterName(raw)).toBe(expected);
    const header = buildInviteFromHeader(raw, ADDRESS);
    expect(header).not.toMatch(/[\r\n\\]/);
    // Exactly the two quotes that wrap the display name, and one address.
    expect(header.match(/"/g)).toHaveLength(2);
    expect(header.match(/</g)).toHaveLength(1);
  });

  it('caps the name at 64 code points', () => {
    const long = 'a'.repeat(100);
    expect(Array.from(cleanInviterName(long))).toHaveLength(INVITE_SENDER_NAME_MAX);
  });

  it('never splits a surrogate pair at the cap', () => {
    const name = `${'a'.repeat(63)}😀😀`;
    const cleaned = cleanInviterName(name);
    expect(Array.from(cleaned)).toHaveLength(64);
    expect(cleaned.endsWith('😀')).toBe(true);
    expect(cleaned).not.toMatch(/[\uD800-\uDBFF]$/);
  });
});

describe('normaliseReplyToAddress (D-2)', () => {
  it.each([
    ['Admin@Example.COM ', 'admin@example.com'],
    ['a@b', 'a@b'],
  ])('%j → %j', (value, expected) => {
    expect(normaliseReplyToAddress(value)).toBe(expected);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['blank', '  '],
    ['no at sign', 'admin.example.com'],
    ['a display name', 'Admin <admin@example.com>'],
    ['a newline', 'admin@example.com\nBcc: x@y.z'],
    ['too long', `${'a'.repeat(320)}@example.com`],
  ])('is null for %s', (_label, value) => {
    expect(normaliseReplyToAddress(value)).toBeNull();
  });
});
