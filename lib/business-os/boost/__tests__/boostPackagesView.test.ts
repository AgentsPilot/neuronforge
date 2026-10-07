/**
 * The owner-facing package view (credits boost slice 5a; SA C-4), and the
 * source guard that keeps 5a inert (SA C-3).
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { codeBoostPackageSource, type BoostPackage } from '@/lib/business-os/entitlements/boostCatalogue';
import { toBoostPackageView } from '@/lib/business-os/boost/boostPackagesView';

describe('toBoostPackageView', () => {
  it('copies the catalogue figures as they are (FR-42: the bonus is the catalogue\'s)', async () => {
    for (const pkg of await codeBoostPackageSource().listActive()) {
      const view = toBoostPackageView(pkg);
      expect(view).toEqual({
        id: pkg.id,
        version: pkg.version,
        order: pkg.order,
        priceMinor: pkg.priceMinor,
        currency: pkg.currency,
        taxExclusive: pkg.taxExclusive,
        baseCredits: pkg.baseCredits,
        bonusCredits: pkg.bonusCredits,
        totalCredits: pkg.totalCredits,
        bonusPercent: pkg.bonusPercent,
        labels: {
          name: { ...pkg.labels.name },
          description: { ...pkg.labels.description },
          badge: pkg.labels.badge ? { ...pkg.labels.badge } : null,
        },
      });
    }
  });

  it('picks by name: an extra field on a package never reaches the view', async () => {
    const [first] = await codeBoostPackageSource().listActive();
    const widened = { ...first, costMinor: 1, markup: 2, active: true } as BoostPackage & Record<string, unknown>;
    const view = toBoostPackageView(widened) as unknown as Record<string, unknown>;
    for (const key of ['costMinor', 'markup', 'active', 'retailVersion', 'creditValueVersion']) {
      expect(view).not.toHaveProperty(key);
    }
  });

  it('labels are copies, not the (frozen) catalogue objects', async () => {
    const [first] = await codeBoostPackageSource().listActive();
    const view = toBoostPackageView(first);
    expect(view.labels.name).toEqual(first.labels.name);
    expect(view.labels.name).not.toBe(first.labels.name);
  });
});

describe('slice 5a is inert (SA C-3)', () => {
  const FILES = [
    'components/business-os/BoostPackagesPanel.tsx',
    'lib/business-os/boost/boostPackagesView.ts',
    'lib/business-os/boost/boostPackagesTypes.ts',
    'app/api/business-os/credits/boost/packages/route.ts',
  ];
  const BANNED = ['/checkout', 'boostCheckout', 'isBoostCheckoutOpenFor', 'BUSINESS_OS_CREDITS_BOOST'];

  it.each(FILES)('%s never names the checkout, its access check or the boost flag', (file) => {
    // Whole file, comments included: a pointer to the checkout in a comment is
    // how the import arrives next.
    const code = readFileSync(join(process.cwd(), file), 'utf8');
    for (const word of BANNED) expect({ file, word, found: code.includes(word) }).toEqual({ file, word, found: false });
  });
});
