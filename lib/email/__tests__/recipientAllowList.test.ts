/**
 * PROD-1b (A7), workplan 11.1: the recipient allow-list, pure.
 *
 * The guard is on outside Vercel production, and on production while
 * EMAIL_RECIPIENT_ALLOWLIST is present (SA-E1). While it is on, an unset,
 * empty or invalid-only list allows nobody (SA-E2, D-13).
 */

import { isProductionDeployment } from '@/lib/utils/deploymentEnvironment';
import {
  checkOutboundRecipients,
  isRecipientGuardOn,
  parseRecipientAllowList,
  recipientsOf,
  refusalLogFields,
} from '@/lib/email/recipientAllowList';

const ENV = { ...process.env };

function setEnv(vercelEnv: string | undefined, list: string | undefined): void {
  process.env = { ...ENV };
  if (vercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = vercelEnv;
  if (list === undefined) delete process.env.EMAIL_RECIPIENT_ALLOWLIST;
  else process.env.EMAIL_RECIPIENT_ALLOWLIST = list;
}

afterEach(() => {
  process.env = { ...ENV };
});

describe('isProductionDeployment', () => {
  it('is true only for the exact value production', () => {
    expect(isProductionDeployment('production')).toBe(true);
    for (const value of [undefined, '', 'preview', 'development', 'Production', ' production', 'production ']) {
      expect(isProductionDeployment(value)).toBe(false);
    }
  });

  it('reads the runtime VERCEL_ENV by default', () => {
    setEnv('production', undefined);
    expect(isProductionDeployment()).toBe(true);
    setEnv('preview', undefined);
    expect(isProductionDeployment()).toBe(false);
  });
});

describe('when the guard is on (SA-E1)', () => {
  it.each([
    ['production, variable absent', 'production', undefined, false],
    ['production, variable set', 'production', '@team.example', true],
    ['production, variable set but empty', 'production', '', true],
    ['production, variable whitespace', 'production', '   ', true],
    ['preview, absent', 'preview', undefined, true],
    ['no VERCEL_ENV (local, Jest), absent', undefined, undefined, true],
    ['development, absent', 'development', undefined, true],
    ['an odd value, absent', 'Production', undefined, true],
  ])('%s', (_label, vercelEnv, list, on) => {
    setEnv(vercelEnv, list);
    expect(isRecipientGuardOn()).toBe(on);
  });
});

describe('parseRecipientAllowList', () => {
  it('reads addresses and @domain entries, any separator, any case', () => {
    const parsed = parseRecipientAllowList(' QA@Team.Example, @Team.Example;dev@other.example\n@sub.team.example ');
    expect([...parsed.addresses].sort()).toEqual(['dev@other.example', 'qa@team.example']);
    expect([...parsed.domains].sort()).toEqual(['sub.team.example', 'team.example']);
    expect(parsed.invalidEntries).toBe(0);
  });

  it.each(['*', '@*', '*@team.example', 'team.example', '@', 'a@', '@-bad.example', 'a@@b.example', '@localhost'])(
    'ignores %p and counts it invalid',
    (entry) => {
      const parsed = parseRecipientAllowList(entry);
      expect(parsed.addresses.size + parsed.domains.size).toBe(0);
      expect(parsed.invalidEntries).toBe(1);
    }
  );

  it('unset or empty parses to nobody, never throws', () => {
    for (const raw of [undefined, null, '', '  ', ',;,']) {
      const parsed = parseRecipientAllowList(raw);
      expect(parsed.addresses.size + parsed.domains.size).toBe(0);
    }
  });
});

describe('checkOutboundRecipients', () => {
  it('guard off (production, variable absent): allowed without reading the list', () => {
    setEnv('production', undefined);
    expect(checkOutboundRecipients(['anyone@customer.example'])).toEqual({ allowed: true, basis: 'production' });
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['whitespace', '  '],
    ['only invalid entries', '* @* team.example'],
  ])('guard on, list %s: refused, allowlist_unset (fail closed)', (_label, list) => {
    setEnv('preview', list);
    expect(checkOutboundRecipients(['qa@team.example'])).toEqual({
      allowed: false,
      reason: 'allowlist_unset',
      recipientCount: 1,
      refusedCount: 1,
    });
  });

  it('production with the list set: a recipient not on it is refused (SA-E1)', () => {
    setEnv('production', '@team.example');
    expect(checkOutboundRecipients(['client@customer.example'])).toMatchObject({ allowed: false, reason: 'recipient_not_allowed' });
  });

  it('production with the list set but empty: nobody (SA-E2, D-13)', () => {
    setEnv('production', '');
    expect(checkOutboundRecipients(['qa@team.example'])).toMatchObject({ allowed: false, reason: 'allowlist_unset' });
  });

  it('production with the list set: a listed recipient is allowed', () => {
    setEnv('production', 'qa@team.example');
    expect(checkOutboundRecipients(['QA@team.example'])).toEqual({ allowed: true, basis: 'allowlist' });
  });

  it('exact address, any case, and the display-name form are allowed', () => {
    setEnv('preview', 'qa@team.example');
    expect(checkOutboundRecipients(['QA@Team.Example'])).toEqual({ allowed: true, basis: 'allowlist' });
    expect(checkOutboundRecipients(['"Q A" <qa@team.example>'])).toEqual({ allowed: true, basis: 'allowlist' });
  });

  it('a piece with an @ outside the angle brackets is refused as unparseable (SA code review 3)', () => {
    setEnv('preview', 'listed@team.example');
    for (const piece of ['x@other.example <listed@team.example>', '"x@other.example" <listed@team.example>']) {
      expect(checkOutboundRecipients([piece])).toMatchObject({ allowed: false, reason: 'unparseable_recipient' });
    }
    expect(checkOutboundRecipients(['Listed Person <listed@team.example>'])).toEqual({ allowed: true, basis: 'allowlist' });
  });

  it('an address entry does not fold plus-addresses', () => {
    setEnv('preview', 'qa@team.example');
    expect(checkOutboundRecipients(['qa+x@team.example'])).toMatchObject({ allowed: false, reason: 'recipient_not_allowed' });
  });

  it('a domain entry matches that domain exactly', () => {
    setEnv('preview', '@team.example');
    expect(checkOutboundRecipients(['a@team.example'])).toEqual({ allowed: true, basis: 'allowlist' });
    for (const lookalike of ['a@sub.team.example', 'a@evilteam.example', 'a@team.example.evil']) {
      expect(checkOutboundRecipients([lookalike])).toMatchObject({ allowed: false, reason: 'recipient_not_allowed' });
    }
  });

  it('one element holding two comma-joined addresses is two recipients', () => {
    setEnv('preview', '@team.example');
    expect(checkOutboundRecipients(['a@team.example, b@customer.example'])).toEqual({
      allowed: false,
      reason: 'recipient_not_allowed',
      recipientCount: 2,
      refusedCount: 1,
    });
  });

  it('a mixed list is refused whole (D-2)', () => {
    setEnv('preview', '@team.example');
    expect(checkOutboundRecipients(['a@team.example', 'b@team.example', 'c@customer.example'])).toEqual({
      allowed: false,
      reason: 'recipient_not_allowed',
      recipientCount: 3,
      refusedCount: 1,
    });
  });

  it.each([[['not an address']], [['']], [['a@b@team.example']], [[]]])('%p is refused as unparseable', (recipients) => {
    setEnv('preview', '@team.example');
    expect(checkOutboundRecipients(recipients)).toMatchObject({ allowed: false, reason: 'unparseable_recipient' });
  });

  it('a verdict and its log fields carry no address', () => {
    setEnv('preview', '@team.example');
    const verdict = checkOutboundRecipients(['client@customer.example', 'qa@team.example']);
    if (verdict.allowed) throw new Error('expected a refusal');
    const text = JSON.stringify([verdict, refusalLogFields(verdict)]);
    expect(text).not.toContain('@');
    expect(refusalLogFields(verdict)).toEqual({ reason: 'recipient_not_allowed', isProduction: false, recipientCount: 2, refusedCount: 1 });
  });
});

describe('recipientsOf', () => {
  it('flattens strings and arrays, skips absent fields, keeps odd shapes as unparseable', () => {
    expect(recipientsOf('a@x.example', ['b@x.example', ['c@x.example']], undefined, null)).toEqual([
      'a@x.example',
      'b@x.example',
      'c@x.example',
    ]);
    expect(recipientsOf({ email: 'a@x.example' }, 7)).toEqual(['', '']);
  });

  it('an odd shape makes the check refuse', () => {
    setEnv('preview', '@x.example');
    expect(checkOutboundRecipients(recipientsOf({ email: 'a@x.example' }))).toMatchObject({
      allowed: false,
      reason: 'unparseable_recipient',
    });
  });
});
