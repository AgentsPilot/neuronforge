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

describe('who may open a checkout (5a SA C-3, replaced in 5b.1 per workplan §3.6)', () => {
  const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');
  const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('(a) the panel names the checkout route exactly once, and starts a checkout only after purchaseAvailable === true', () => {
    const code = read('components/business-os/BoostPackagesPanel.tsx');
    expect(code.match(/\/api\/business-os\/credits\/boost\/checkout/g)).toHaveLength(1);
    const body = stripComments(code);
    expect(body.match(/fetch\(CHECKOUT_URL/g)).toHaveLength(1);
    const start = body.indexOf('async function startCheckout');
    const guard = body.indexOf("if (payload?.purchaseAvailable !== true) return;", start);
    const call = body.indexOf('fetch(CHECKOUT_URL', start);
    expect(start).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(start);
    expect(call).toBeGreaterThan(guard);
  });

  it.each([
    'lib/business-os/boost/boostPackagesView.ts',
    'lib/business-os/boost/boostPackagesTypes.ts',
    'lib/business-os/boost/boostPurchasesView.ts',
    'lib/business-os/boost/boostPurchasesTypes.ts',
    'app/api/business-os/credits/boost/purchases/route.ts',
    'components/business-os/BoostReturnNotice.tsx',
    'components/business-os/BoostPurchasesList.tsx',
  ])('(b) %s never names the boost switch or the access checks', (file) => {
    const code = read(file);
    for (const word of ['BUSINESS_OS_CREDITS_BOOST', 'isBoostCheckoutOpenFor', 'isBoostPurchaseAvailableFor', '/credits/boost/checkout']) {
      expect({ file, word, found: code.includes(word) }).toEqual({ file, word, found: false });
    }
  });

  it('(c) only the packages route decides purchaseAvailable; only the checkout route and the access module call isBoostCheckoutOpenFor', () => {
    const ROOT = process.cwd();
    const { readdirSync, statSync } = jest.requireActual('fs') as typeof import('fs');
    const callers: Record<string, string[]> = { isBoostCheckoutOpenFor: [], isBoostPurchaseAvailableFor: [] };
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(ROOT, dir))) {
        if (entry === 'node_modules' || entry === '__tests__') continue;
        const rel = `${dir}/${entry}`;
        if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
        else if (/\.tsx?$/.test(entry)) {
          const code = stripComments(read(rel));
          for (const name of Object.keys(callers)) if (new RegExp(`\\b${name}\\(`).test(code)) callers[name].push(rel);
        }
      }
    };
    for (const root of ['app', 'lib', 'components']) walk(root);
    expect(callers.isBoostPurchaseAvailableFor.sort()).toEqual([
      'app/api/business-os/credits/boost/packages/route.ts',
      'lib/business-os/boost/boostCheckoutAccess.ts',
    ]);
    expect(callers.isBoostCheckoutOpenFor.sort()).toEqual([
      'app/api/business-os/credits/boost/checkout/route.ts',
      'lib/business-os/boost/boostCheckoutAccess.ts',
    ]);
  });
});
