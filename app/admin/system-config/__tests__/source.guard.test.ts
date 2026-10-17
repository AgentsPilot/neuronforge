/**
 * Source guard for the Model pricing split (ADMIN_BOS_CLEANUP slice 2;
 * conditions C2-1, C2-2, C2-3, C2-5, C2-8, C2-10; SA W2-3, W2-4).
 *
 * P = `app/admin/system-config/page.tsx` (Model pricing, Business OS).
 * B = `app/admin/agentspilot-billing/page.tsx` (AgentsPilot billing, parked).
 *
 * - P fetches only the pricing routes; B keeps every AgentsPilot fetch and
 *   handler binding it had (counted, not just present: `tsc` cannot see a
 *   dropped `onClick`).
 * - SA 2026-10-16 slice 6 R-5 (moved from slice 8 by R-9 row 6): Sync and the
 *   per-row Edit are removed (MP-FR-11, user decision Q9). The old byte-for-byte
 *   Sync pins (S-9 handler, S-10 button) are replaced by assertions that no Sync
 *   and no direct write exists on P (S-2, S-3, S-5..S-7 inverted; NW-1). S-1 and
 *   S-4 are re-pinned byte for byte to the new truthful text.
 * - S-1 and S-4 were first re-pinned in AI_MODEL_PRICE_REVIEW slice 1, approved
 *   SA 2026-10-08 R-5.
 *
 * Line endings are normalised first, so a Windows checkout reads the same as CI.
 */

import * as fs from 'fs';
import * as path from 'path';

const read = (relative: string) =>
  fs.readFileSync(path.join(process.cwd(), relative), 'utf8').replace(/\r\n/g, '\n');

/** The code without comments (the `codeOf` idiom from the invites source guard). */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

const P = read('app/admin/system-config/page.tsx');
const B = read('app/admin/agentspilot-billing/page.tsx');
/** The page's copy module (slice 4); MT-1 scans it too (SA SC6-6 b). */
const COPY = read('app/admin/system-config/priceReviewCopy.ts');
const pCode = codeOf(P);
const bCode = codeOf(B);

describe('P: Model pricing fetches only the pricing routes (C2-2, G-1, G-2)', () => {
  it('G-1: no AgentsPilot route and no settings read', () => {
    expect(pCode).not.toContain('/api/admin/boost-packs');
    expect(pCode).not.toContain('/api/admin/calculator-config');
    expect(pCode).not.toContain('/api/pricing/config');
    // The settings read, with any closing quote; the pricing path continues with `/pricing`.
    expect(pCode).not.toMatch(/['"`]\/api\/admin\/system-config['"`]/);
  });

  it('G-2: no billing setting and no boost-pack state left behind', () => {
    expect(pCode).not.toContain('payment_grace_period_days');
    expect(pCode).not.toContain('pilot_credit_cost_usd');
    expect(pCode.toLowerCase()).not.toContain('boost');
  });

  it('W2-4 (slice 6): the pricing list is read once, and no Sync or edit handler is left', () => {
    expect(count(pCode, "'/api/admin/system-config/pricing'")).toBe(1);
    expect(count(P, '/api/admin/system-config/pricing/sync')).toBe(0);
    for (const handler of ['handleSyncPricing', 'handleSavePricing', 'handleEditPricing', 'handleCancelEditPricing']) {
      expect({ handler, count: count(P, handler) }).toEqual({ handler, count: 0 });
    }
  });

  // Slice 8 (SA O-18): still true. Apply, Dismiss and the margin review post from `priceApply.ts` only.
  it('NW-1 (slice 6): P sends no write request; its one fetch( is the pricing GET', () => {
    expect(pCode).not.toMatch(/method:\s*['"`](PUT|POST|DELETE|PATCH)['"`]/);
    const fetches = pCode.match(/(?<![A-Za-z0-9_])fetch[(]/g) ?? [];
    expect(fetches).toHaveLength(1);
    expect(pCode).toContain("fetch('/api/admin/system-config/pricing', {\n          method: 'GET',");
  });
});

describe('both pages log through clientLogger (C2-8, G-3, G-7)', () => {
  it.each([
    ['P', P],
    ['B', B],
  ])('G-3: %s has no console.', (_name, source) => {
    expect(source).not.toContain('console.');
  });

  it.each([
    ['P', P],
    ['B', B],
  ])("G-7: %s is a client component that imports clientLogger", (_name, source) => {
    expect(source.trimStart().startsWith("'use client'")).toBe(true);
    expect(source).toContain("import { clientLogger } from '@/lib/logger/client';");
  });
});

describe('P: the header says what the page is (C2-2, G-8)', () => {
  it('G-8: the h1 is Model pricing, with no System Config badge', () => {
    expect(P).toMatch(/<h1[^>]*>Model pricing<\/h1>/);
    expect(P).not.toContain('System Config</span>');
  });
});

describe('P: Sync and the per-row Edit are removed (MP-FR-11; slice 6 R-5)', () => {
  // Re-pinned by AI model price review slice 8 (SA 2026-10-17, RC-1..RC-16): Apply now exists.
  it('S-1: the helper text', () => {
    expect(P).toContain(
      'Cost per token for each AI model, as charged today. A live price changes only when an admin applies a provider price.'
    );
  });

  it('S-2, S-3: neither Sync label is left anywhere in P, comments included', () => {
    expect(P).not.toContain('Sync Latest Pricing');
    expect(P).not.toContain('Syncing...');
  });

  it('S-4: the help paragraph on the removed buttons (slice 8: Apply exists)', () => {
    expect(P).toContain(
      'The Sync button and the per-row Edit have been removed. Every price change goes through a pending price and Apply, which keeps the old price as history and records who applied it and why.'
    );
    expect(P).not.toContain('Until Apply arrives');
  });

  it('S-5 to S-7: the Sync comment, route and messages are gone', () => {
    expect(P).not.toContain('// Refresh pricing data after sync since it fetches from external API');
    expect(P).not.toContain('/pricing/sync');
    expect(P).not.toContain('Failed to sync pricing');
    expect(P).not.toContain('Pricing synced successfully!');
    expect(P).not.toContain('Failed to update pricing');
  });
});

describe('P: the info box tells the truth (MP-FR-1)', () => {
  it('MT-1: none of the false claims is back (page and copy module)', () => {
    expect(P).not.toContain('Automatically fetches');
    expect(P).not.toContain('Intelligent Routing');
    expect(P).not.toContain('intelligent routing');
    expect(P).not.toContain('per 1,000');
    expect(P).not.toContain('immediately');
    // Slice 6 (SA SC6-6 b): the old "Sync and Edit change live prices" wording, in either file.
    for (const [file, source] of [
      ['page.tsx', P],
      ['priceReviewCopy.ts', COPY],
    ] as const) {
      expect({ file, hit: source.includes('change live prices directly') }).toEqual({ file, hit: false });
      expect({ file, hit: source.includes('Sync and Edit') }).toEqual({ file, hit: false });
      expect({ file, hit: source.includes('Edit pricing') }).toEqual({ file, hit: false });
    }
  });

  it('MT-2: it says when a change takes effect (the whole sentence, QA E-3)', () => {
    expect(P).toContain(
      'Each server keeps its own copy of these prices for up to 1 hour, so a change is in effect on all servers within 1 hour. Changes don&apos;t alter provider billing.'
    );
  });
});

describe('B: the AgentsPilot page kept every fetch and binding (C2-3, C2-5, G-4, G-6)', () => {
  it('G-4: the boost-pack heading names AgentsPilot', () => {
    expect(B).toContain('>AgentsPilot boost packs</h3>');
    expect(B).not.toContain('>Boost Pack Management</h3>');
  });

  it('G-6: no pricing read and no pricing dump', () => {
    expect(bCode).not.toContain('/api/admin/system-config/pricing');
    expect(bCode).not.toContain('pricing_models');
  });

  it('W2-4: every AgentsPilot fetch, counted', () => {
    // Settings GET + grace period PUT.
    expect(count(bCode, "'/api/admin/system-config'")).toBe(2);
    // Boost packs GET, save (POST or PUT) and DELETE.
    expect(count(bCode, "'/api/admin/boost-packs'")).toBe(3);
    expect(count(bCode, "'/api/admin/calculator-config'")).toBe(1);
    expect(count(bCode, "'/api/pricing/config'")).toBe(1);
  });

  it('W2-4: every handler binding, counted', () => {
    expect(count(bCode, 'onClick={handleSaveBillingConfig}')).toBe(1);
    expect(count(bCode, 'handleSaveBoostPack(pack)')).toBe(1);
    expect(count(bCode, 'handleSaveBoostPack(newBoostPack)')).toBe(1);
    expect(count(bCode, 'handleDeleteBoostPack(pack.id!)')).toBe(1);
    expect(count(bCode, 'onClick={handleSaveCalculatorConfig}')).toBe(1);
  });
});
