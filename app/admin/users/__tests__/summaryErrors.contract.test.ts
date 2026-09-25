/**
 * @jest-environment jsdom
 */

/**
 * Every refusal the account summary route can return has a sentence in the
 * Business OS panel (SA N-6). Modelled on
 * app/admin/business-os-tiers/__tests__/accountLookup.contract.test.tsx: the
 * codes are read from the route's own source, so a new refusal without copy is
 * a red test rather than a raw code on the screen.
 */

import * as fs from 'fs';
import * as path from 'path';

import { SUMMARY_ERROR_COPY } from '../components/BusinessOsPanel';

const routeSource = fs.readFileSync(
  path.join(process.cwd(), 'app/api/admin/business-os/accounts/[accountId]/summary/route.ts'),
  'utf8'
);

// Quote-agnostic, as in the entitlements contract.
const codes = [
  ...new Set([...routeSource.matchAll(/error:\s*(['"`])([^'"`]+)\1/g)].map((match) => match[2])),
];

describe('the summary route’s refusals all have copy', () => {
  it('found the codes to check — a scan that found none would prove nothing', () => {
    expect(codes).toEqual(
      expect.arrayContaining([
        'invalid_account_id',
        'platform_account',
        'tenant_check_failed',
        'not_a_business_os_account',
        'Internal server error',
      ])
    );
  });

  it.each(codes)('%s has a sentence, not a code', (code) => {
    const copy = SUMMARY_ERROR_COPY[code];
    expect(copy).toBeDefined();
    expect(copy).not.toContain(code);
    expect(copy.length).toBeGreaterThan(20);
  });
});
