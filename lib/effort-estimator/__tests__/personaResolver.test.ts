/**
 * Effort Estimator — persona resolver tests.
 *
 * Covers all four branches of `resolvePersona` and the lenient role-OR-domain
 * scan in `verifyReasoningMentionsPersona` (SA observation #4).
 */
import { resolvePersona, verifyReasoningMentionsPersona } from '../personaResolver';
import type { UserContext } from '@/lib/user-context';

describe('resolvePersona', () => {
  it('returns "{role} at a {domain} SMB" when both domain and role are present', () => {
    const ctx: UserContext = { role: 'logistics-ops manager', domain: 'marketing' };
    expect(resolvePersona(ctx)).toBe('logistics-ops manager at a marketing SMB');
  });

  it('returns "SMB owner in {domain}" when only domain is present', () => {
    const ctx: UserContext = { domain: 'real estate' };
    expect(resolvePersona(ctx)).toBe('SMB owner in real estate');
  });

  it('returns "{role} at an SMB" when only role is present', () => {
    const ctx: UserContext = { role: 'marketing director' };
    expect(resolvePersona(ctx)).toBe('marketing director at an SMB');
  });

  it('returns the generic SMB fallback when both fields are missing', () => {
    expect(resolvePersona({})).toBe('generic SMB owner');
  });

  it('treats whitespace-only fields as missing', () => {
    expect(resolvePersona({ role: '   ', domain: '' })).toBe('generic SMB owner');
  });

  it('trims surrounding whitespace from supplied fields', () => {
    expect(resolvePersona({ role: '  founder ', domain: ' SaaS ' })).toBe('founder at a SaaS SMB');
  });
});

describe('verifyReasoningMentionsPersona', () => {
  it('accepts reasoning that mentions the role keyword', () => {
    const ctx: UserContext = { role: 'logistics-ops manager', domain: 'marketing' };
    expect(
      verifyReasoningMentionsPersona(
        'As a logistics-ops manager I would spend ~5 minutes on this.',
        ctx
      )
    ).toBe(true);
  });

  it('accepts reasoning that mentions the domain keyword', () => {
    const ctx: UserContext = { role: 'ops manager', domain: 'logistics' };
    expect(
      verifyReasoningMentionsPersona(
        'Running a logistics business, this kind of triage takes about 4 minutes.',
        ctx
      )
    ).toBe(true);
  });

  it('rejects reasoning that mentions neither role nor domain', () => {
    const ctx: UserContext = { role: 'ops manager', domain: 'logistics' };
    expect(
      verifyReasoningMentionsPersona('This is a typical bulk-processing workflow.', ctx)
    ).toBe(false);
  });

  it('falls back to generic SMB keywords when both fields are missing', () => {
    expect(verifyReasoningMentionsPersona('A small business owner would do this in 5 min.', {})).toBe(true);
    expect(verifyReasoningMentionsPersona('Generic SMB owner triage scenario.', {})).toBe(true);
    expect(verifyReasoningMentionsPersona('Just a generic workflow.', {})).toBe(false);
  });

  it('is case-insensitive', () => {
    const ctx: UserContext = { role: 'Founder' };
    expect(verifyReasoningMentionsPersona('As a FOUNDER, I would...', ctx)).toBe(true);
  });
});
