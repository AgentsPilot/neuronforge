/**
 * Business OS credits boost, slice 1: the package catalogue, its validation and
 * the loader seam (requirement FR-1 to FR-5, FR-42, §8.2, SA T-3b / T-3c;
 * workplan §6.1 happy path and §6.2 failure paths).
 *
 * The "approved figures" below are the user's Option A (2026-09-30). Tests may
 * hold figures; the product code may not (see boostCatalogue.guard.test.ts).
 */

import {
  BOOST_PACKAGES,
  BOOST_PURCHASE_CAP_DEFAULT,
  type BoostPackageConfig,
} from '@/lib/business-os/entitlements/config/boostPackages';
import {
  BoostCatalogueInvalidError,
  bonusPercentFromCredits,
  codeBoostPackageSource,
  createBoostPackageSource,
  validateBoostCatalogue,
  type BoostCatalogueInputs,
} from '@/lib/business-os/entitlements/boostCatalogue';
import { currentRetailRate, retailRateFor, type RetailRateResult } from '@/lib/business-os/entitlements/retailRate';
import { currentCreditValue } from '@/lib/business-os/entitlements/config/creditValue';

const RATE = currentRetailRate();
const CAP = BOOST_PURCHASE_CAP_DEFAULT;

/** A deep copy of the shipped packages to plant a defect in. */
const shipped = (): BoostPackageConfig[] => JSON.parse(JSON.stringify(BOOST_PACKAGES)) as BoostPackageConfig[];

function issuesOf(packages: readonly unknown[], rate: RetailRateResult = RATE, cap: unknown = CAP): string[] {
  const result = validateBoostCatalogue(packages, rate, cap);
  return result.ok ? [] : result.issues;
}

function withPackage(index: number, patch: Record<string, unknown>): unknown[] {
  const packages: unknown[] = shipped();
  packages[index] = { ...(packages[index] as object), ...patch };
  return packages;
}

const plantedSource = (inputs: Partial<BoostCatalogueInputs>) =>
  createBoostPackageSource(() => ({ packages: BOOST_PACKAGES, rateResult: RATE, cap: CAP, ...inputs }));

describe('the shipped catalogue (happy path)', () => {
  it('validates — this is the FR-2 test (T-H2)', () => {
    const result = validateBoostCatalogue(BOOST_PACKAGES, RATE, CAP);
    if (!result.ok) throw new Error(result.issues.join('\n'));
    expect(result.packages).toHaveLength(3);
  });

  it('holds the approved Option A figures (T-H3)', async () => {
    const packages = await codeBoostPackageSource().listActive();
    expect(
      packages.map(({ id, priceMinor, baseCredits, bonusCredits, totalCredits, bonusPercent }) => ({
        id,
        priceMinor,
        baseCredits,
        bonusCredits,
        totalCredits,
        bonusPercent,
      }))
    ).toEqual([
      { id: 'starter', priceMinor: 1000, baseCredits: 5000, bonusCredits: 0, totalCredits: 5000, bonusPercent: 0 },
      { id: 'plus', priceMinor: 2500, baseCredits: 12500, bonusCredits: 1250, totalCredits: 13750, bonusPercent: 10 },
      { id: 'max', priceMinor: 5000, baseCredits: 25000, bonusCredits: 3750, totalCredits: 28750, bonusPercent: 15 },
    ]);
    for (const pkg of packages) {
      expect(pkg).toMatchObject({ currency: 'USD', taxExclusive: true, active: true, retailVersion: 1 });
      expect(pkg.creditValueVersion).toBe(currentCreditValue().version);
    }
    expect(packages.map((pkg) => pkg.labels.badge?.en ?? null)).toEqual([null, 'Most popular', 'Best value']);
  });

  it('every package satisfies the FR-2 identities (T-H4)', async () => {
    if (!RATE.ok) throw new Error(RATE.issue);
    for (const pkg of await codeBoostPackageSource().listActive()) {
      expect(pkg.baseCredits * 100).toBe(pkg.priceMinor * RATE.rate.creditsPerUsd);
      expect(pkg.totalCredits * 100).toBe(pkg.baseCredits * (100 + pkg.bonusPercent));
      expect(pkg.baseCredits + pkg.bonusCredits).toBe(pkg.totalCredits);
    }
  });

  it('the shown bonus is computed from the credits (FR-42, T-H5)', async () => {
    for (const pkg of await codeBoostPackageSource().listActive()) {
      expect(bonusPercentFromCredits(pkg.baseCredits, pkg.totalCredits)).toBe(pkg.bonusPercent);
    }
  });

  it('every label is filled in all three locales', () => {
    for (const pkg of BOOST_PACKAGES) {
      for (const labels of [pkg.labels.name, pkg.labels.description]) {
        expect(labels.en && labels.he && labels.es).toBeTruthy();
      }
    }
  });

  it('listActive returns active packages in display order (T-H6)', async () => {
    const source = plantedSource({ packages: [...shipped()].reverse() });
    expect((await source.listActive()).map((pkg) => pkg.id)).toEqual(['starter', 'plus', 'max']);
  });

  it('getActive returns the package listActive returns (T-H7)', async () => {
    const source = codeBoostPackageSource();
    const plus = await source.getActive('plus');
    expect(plus).toEqual((await source.listActive()).find((pkg) => pkg.id === 'plus'));
  });

  it('the default cap is $150 over 30 days and covers the dearest package (T-H8)', () => {
    expect(CAP).toEqual({ amountMinor: 15000, currency: 'USD', windowDays: 30 });
    for (const pkg of BOOST_PACKAGES) expect(pkg.priceMinor).toBeLessThanOrEqual(CAP.amountMinor);
  });

  it('bonusPercentFromCredits works from stored credits, with no rate (T-H9)', () => {
    expect(bonusPercentFromCredits(12500, 13750)).toBe(10);
    expect(bonusPercentFromCredits(5000, 5000)).toBe(0);
    expect(bonusPercentFromCredits(0, 10)).toBeNull();
    expect(bonusPercentFromCredits(10, 5)).toBeNull();
    expect(bonusPercentFromCredits(Number.NaN, 5)).toBeNull();
  });

  it('codeBoostPackageSource is one instance per process', () => {
    expect(codeBoostPackageSource()).toBe(codeBoostPackageSource());
  });
});

describe('a changed base rate never passes unnoticed (acceptance criterion)', () => {
  const RATE_V2 = retailRateFor(
    { version: 2, markup: 1.5, creditValueVersion: currentCreditValue().version, decidedOn: '2026-10-04', derivation: 'planted' },
    currentCreditValue()
  );

  it('packages still priced on retail v1 fail validation (T-F3)', () => {
    const issues = issuesOf(BOOST_PACKAGES, RATE_V2);
    expect(issues).toHaveLength(3);
    for (const issue of issues) expect(issue).toMatch(/retail version 1, current is 2/);
  });

  it('re-pointed packages resolve to different credits, so the snapshot guard flags them (T-F4)', () => {
    const repointed = shipped().map((pkg) => ({ ...pkg, retailVersion: 2 }));
    const result = validateBoostCatalogue(repointed, RATE_V2, CAP);
    if (!result.ok) throw new Error(result.issues.join('\n'));
    expect(result.packages.map((pkg) => pkg.totalCredits)).toEqual([4000, 11000, 23000]);
    // Same (id, version) as the released snapshot but different credits: the
    // snapshot test (boostCatalogue.guard.test.ts) refuses this until each
    // version is bumped.
    expect(result.packages.every((pkg) => pkg.version === 1)).toBe(true);
  });
});

describe('an invalid catalogue is refused, naming the rule (T-F5 to T-F15)', () => {
  it.each([
    ['totalCredits', 13750],
    ['baseCredits', 12500],
    ['bonusCredits', 1250],
    ['bonusLabel', 'plus ten'],
  ])('a hand-typed %s key (T-F5)', (key, value) => {
    expect(issuesOf(withPackage(1, { [key]: value })).join('\n')).toMatch(/Unrecognized key/);
  });

  it('a figure or "%" typed into a label (T-F6)', () => {
    const packages = shipped();
    packages[2].labels.badge = { en: 'Best value +15%', he: 'Best value', es: 'Best value' };
    packages[0].labels.name = { en: 'Starter', he: 'Starter', es: 'Starter 5000' };
    const issues = issuesOf(packages).join('\n');
    expect(issues).toMatch(/package\[2\]: labels\.badge\.en label contains a digit/);
    expect(issues).toMatch(/package\[0\]: labels\.name\.es label contains a digit/);
  });

  it('a missing or empty locale (T-F7)', () => {
    const packages = shipped() as unknown as Array<{ labels: { name: Record<string, string> } }>;
    delete packages[0].labels.name.he;
    packages[1].labels.name.es = '  ';
    const issues = issuesOf(packages).join('\n');
    expect(issues).toMatch(/package\[0\]: labels\.name\.he/);
    expect(issues).toMatch(/package\[1\]: labels\.name\.es label is empty/);
  });

  it('a currency other than USD (T-F8)', () => {
    expect(issuesOf(withPackage(0, { currency: 'EUR' })).join('\n')).toMatch(/package\[0\]: currency/);
  });

  it('a price that includes tax (T-F9)', () => {
    expect(issuesOf(withPackage(0, { taxExclusive: false })).join('\n')).toMatch(/package\[0\]: taxExclusive/);
  });

  it.each([0, -100, 10.5])('a price of %p minor units (T-F10)', (priceMinor) => {
    expect(issuesOf(withPackage(0, { priceMinor })).join('\n')).toMatch(/package\[0\]: priceMinor/);
  });

  it('a price above the purchase cap (T-F11)', () => {
    expect(issuesOf(withPackage(2, { priceMinor: 20000 })).join('\n')).toMatch(/above the purchase cap/);
  });

  it.each([-5, 7.5, 150])('a bonus of %p%% (T-F12)', (bonusPercent) => {
    expect(issuesOf(withPackage(1, { bonusPercent })).join('\n')).toMatch(/package\[1\]: bonusPercent/);
  });

  it('a bonus that gives fractional credits (T-F13)', () => {
    // $10.01 buys 5,005 credits; 3% of that is 150.15.
    expect(issuesOf(withPackage(0, { priceMinor: 1001, bonusPercent: 3 })).join('\n')).toMatch(
      /bonus does not give a whole number of credits/
    );
  });

  it('a duplicate id and a duplicate active order (T-F14)', () => {
    const issues = issuesOf(withPackage(1, { id: 'starter', order: 1 })).join('\n');
    expect(issues).toMatch(/"starter": duplicate id/);
    expect(issues).toMatch(/duplicate order 1/);
  });

  it('a duplicate order among INACTIVE packages is allowed', () => {
    expect(issuesOf(withPackage(1, { order: 1, active: false }))).toEqual([]);
  });

  it('no active package at all (T-F15)', () => {
    const packages = shipped().map((pkg) => ({ ...pkg, active: false }));
    expect(issuesOf(packages)).toContain('catalogue has no active package');
  });

  it('a bad id slug and a non-positive version', () => {
    const issues = issuesOf(withPackage(0, { id: 'Starter Pack', version: 0 })).join('\n');
    expect(issues).toMatch(/package\[0\]: id id must be a lowercase slug/);
    expect(issues).toMatch(/package\[0\]: version/);
  });

  it('an invalid cap', () => {
    expect(issuesOf(BOOST_PACKAGES, RATE, { amountMinor: 0, currency: 'USD', windowDays: 30 }).join('\n')).toMatch(
      /cap: amountMinor/
    );
    expect(issuesOf(BOOST_PACKAGES, RATE, { amountMinor: 15000, currency: 'EUR', windowDays: 30 }).join('\n')).toMatch(
      /cap: currency/
    );
  });

  it('a refused rate', () => {
    expect(issuesOf(BOOST_PACKAGES, { ok: false, issue: 'stale pairing' })).toContain('rate: stale pairing');
  });
});

describe('the loader seam (FR-3, FR-5, T-F16, T-F17)', () => {
  it('getActive returns null for an unknown id and for an inactive package (T-F16)', async () => {
    const source = plantedSource({ packages: withPackage(2, { active: false }) });
    expect(await source.getActive('nope')).toBeNull();
    expect(await source.getActive('max')).toBeNull();
    expect((await source.listActive()).map((pkg) => pkg.id)).toEqual(['starter', 'plus']);
  });

  it('an invalid catalogue REJECTS both methods, naming the rule, every time (T-F17)', async () => {
    const source = plantedSource({ packages: withPackage(0, { currency: 'EUR' }) });
    for (const call of [() => source.listActive(), () => source.getActive('plus'), () => source.listActive()]) {
      const error = await call().then(
        () => null,
        (e: unknown) => e
      );
      expect(error).toBeInstanceOf(BoostCatalogueInvalidError);
      expect((error as BoostCatalogueInvalidError).issues.join('\n')).toMatch(/currency/);
    }
  });

  it('loads lazily, once per instance, and instances do not share a memo (SA C-3)', async () => {
    const load = jest.fn(() => ({ packages: BOOST_PACKAGES, rateResult: RATE, cap: CAP }));
    const source = createBoostPackageSource(load);
    expect(load).not.toHaveBeenCalled();
    await source.listActive();
    await source.getActive('max');
    expect(load).toHaveBeenCalledTimes(1);

    const broken = plantedSource({ packages: [] });
    await expect(broken.listActive()).rejects.toBeInstanceOf(BoostCatalogueInvalidError);
    await expect(plantedSource({}).listActive()).resolves.toHaveLength(3);
  });
});

describe('the catalogue cannot be changed by a caller (SA CR-1)', () => {
  it('a returned package is frozen, and the next read still has the original figures', async () => {
    const source = plantedSource({});
    const plus = await source.getActive('plus');
    if (!plus) throw new Error('plus missing');
    // Test files run as ES modules, i.e. in strict mode, so a write to a frozen object throws.
    expect(() => {
      (plus as { priceMinor: number }).priceMinor = 1;
    }).toThrow(TypeError);
    expect(() => {
      (plus.labels.name as { en: string }).en = 'Cheap';
    }).toThrow(TypeError);
    expect(() => {
      (plus as { totalCredits: number }).totalCredits = 999999;
    }).toThrow(TypeError);

    const again = await source.getActive('plus');
    expect(again).toMatchObject({ priceMinor: 2500, totalCredits: 13750, bonusPercent: 10 });
    expect(again?.labels.name.en).toBe('Plus');
    const listed = await source.listActive();
    expect(listed.find((pkg) => pkg.id === 'plus')?.priceMinor).toBe(2500);
  });

  it('resolved labels are copies, not the config objects', async () => {
    const plus = await plantedSource({}).getActive('plus');
    const config = BOOST_PACKAGES.find((pkg) => pkg.id === 'plus');
    expect(plus?.labels.name).toEqual(config?.labels.name);
    expect(plus?.labels.name).not.toBe(config?.labels.name);
  });

  it('the shipped packages and the default cap are frozen all the way down', () => {
    expect(() => {
      (BOOST_PURCHASE_CAP_DEFAULT as { amountMinor: number }).amountMinor = 1;
    }).toThrow(TypeError);
    expect(BOOST_PURCHASE_CAP_DEFAULT.amountMinor).toBe(15000);
    expect(() => {
      (BOOST_PACKAGES[1] as { priceMinor: number }).priceMinor = 1;
    }).toThrow(TypeError);
    expect(() => {
      (BOOST_PACKAGES[1].labels.name as { en: string }).en = 'Cheap';
    }).toThrow(TypeError);
    expect(() => {
      (BOOST_PACKAGES as unknown as unknown[]).push({});
    }).toThrow(TypeError);
    expect(BOOST_PACKAGES[1].priceMinor).toBe(2500);
  });
});

describe('QA follow-ups (R-1 to R-7)', () => {
  it('R-1: a price equal to the cap is allowed; one cent over is refused', () => {
    expect(issuesOf(withPackage(2, { priceMinor: 15000 }))).toEqual([]);
    expect(issuesOf(withPackage(2, { priceMinor: 15001 })).join('\n')).toMatch(/above the purchase cap/);
  });

  it('R-2: a bonus of 50% resolves; 51% is refused', () => {
    const ok = validateBoostCatalogue(withPackage(2, { bonusPercent: 50 }), RATE, CAP);
    if (!ok.ok) throw new Error(ok.issues.join('\n'));
    expect(ok.packages.find((pkg) => pkg.id === 'max')).toMatchObject({ baseCredits: 25000, totalCredits: 37500, bonusPercent: 50 });
    expect(issuesOf(withPackage(2, { bonusPercent: 51 })).join('\n')).toMatch(/package\[2\]: bonusPercent/);
  });

  it('R-3: odd prices — $9.99 resolves at 0% and is refused at 10%; $0.01 gives 5, and 6 at 20%', () => {
    const at999 = validateBoostCatalogue(withPackage(0, { priceMinor: 999 }), RATE, CAP);
    if (!at999.ok) throw new Error(at999.issues.join('\n'));
    expect(at999.packages.find((pkg) => pkg.id === 'starter')).toMatchObject({ baseCredits: 4995, totalCredits: 4995, bonusPercent: 0 });
    expect(issuesOf(withPackage(0, { priceMinor: 999, bonusPercent: 10 })).join('\n')).toMatch(
      /bonus does not give a whole number of credits/
    );

    const atOneCent = validateBoostCatalogue(withPackage(0, { priceMinor: 1, bonusPercent: 20 }), RATE, CAP);
    if (!atOneCent.ok) throw new Error(atOneCent.issues.join('\n'));
    expect(atOneCent.packages.find((pkg) => pkg.id === 'starter')).toMatchObject({
      baseCredits: 5,
      bonusCredits: 1,
      totalCredits: 6,
      bonusPercent: 20,
    });
    expect(issuesOf(withPackage(0, { priceMinor: 1, bonusPercent: 10 })).join('\n')).toMatch(
      /bonus does not give a whole number of credits/
    );
  });

  it.each(['usd', ' USD', 'USD '])('R-4: the schema refuses currency %p (exact literal only)', (currency) => {
    expect(issuesOf(withPackage(0, { currency })).join('\n')).toMatch(/package\[0\]: currency/);
  });

  it.each(['PLUS', 'Plus', ' plus', 'plus ', '', '__proto__', 'constructor'])(
    'R-5: getActive(%p) is an exact match, so it returns null',
    async (id) => {
      expect(await plantedSource({}).getActive(id)).toBeNull();
    }
  );

  it('R-6: listActive returns a fresh array each time', async () => {
    const source = plantedSource({});
    const first = await source.listActive();
    first.length = 0;
    const second = await source.listActive();
    expect(second).not.toBe(first);
    expect(second).toHaveLength(3);
  });

  it.each(['Best value ％', 'Best value ﹪', 'Best value ½', 'Best value Ⅹ', 'Best value ١'])(
    'R-7: a label with %p is refused (E-1: any numeric character or percent variant)',
    (badge) => {
      const packages = shipped();
      packages[2].labels.badge = { en: badge, he: 'Best value', es: 'Best value' };
      expect(issuesOf(packages).join('\n')).toMatch(/package\[2\]: labels\.badge\.en label contains a digit/);
    }
  );

  it('R-7: native copy without figures is still accepted', () => {
    const packages = shipped();
    packages[1].labels.name = { en: 'Plus', he: 'פלוס', es: 'Más' };
    expect(issuesOf(packages)).toEqual([]);
  });
});
