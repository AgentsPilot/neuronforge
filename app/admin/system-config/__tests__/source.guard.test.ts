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
 * - Sync is parked (UC-5) and frozen byte for byte (C2-1). Its handler and its
 *   button are held below as whole literal blocks, so any edit to either one,
 *   formatting included, fails here. The only approved change is the handler's
 *   one logging line, already substituted in the fixture.
 * - S-1 and S-4 re-pinned to the true text: AI_MODEL_PRICE_REVIEW slice 1,
 *   approved SA 2026-10-08 R-5.
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
const pCode = codeOf(P);
const bCode = codeOf(B);

/** S-9 (SA W2-3): `handleSyncPricing`, whole, with the one approved logger line. */
const SYNC_HANDLER = `
  const handleSyncPricing = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const response = await fetch('/api/admin/system-config/pricing/sync', {
        method: 'POST'
      });

      if (!response.ok) {
        throw new Error('Failed to sync pricing');
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to sync pricing');
      }

      setSuccess(result.message || 'Pricing synced successfully!');

      // Refresh pricing data after sync since it fetches from external API
      await fetchData(true);

      setTimeout(() => setSuccess(null), 5000);

    } catch (error) {
      logger.error({ err: error }, 'Pricing sync failed');
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setSaving(false);
    }
  };
`;

/** S-10 (SA W2-3): the Sync button, whole. */
const SYNC_BUTTON = `
              <button
                onClick={handleSyncPricing}
                disabled={saving}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
              >
                {saving ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Syncing...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    Sync Latest Pricing
                  </>
                )}
              </button>
`;

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

  it('W2-4: the pricing fetches and handler bindings are all there, counted', () => {
    expect(count(pCode, "'/api/admin/system-config/pricing'")).toBe(2);
    expect(count(pCode, "'/api/admin/system-config/pricing/sync'")).toBe(1);
    expect(count(pCode, 'handleSavePricing(model.id)')).toBe(1);
    expect(count(pCode, 'handleEditPricing(model)')).toBe(1);
    expect(count(pCode, 'onClick={handleCancelEditPricing}')).toBe(1);
    expect(count(pCode, 'onClick={handleSyncPricing}')).toBe(1);
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

describe('P: Sync is unchanged apart from its true text (C2-1, G-5; R-5)', () => {
  it('S-1: the helper text', () => {
    expect(P).toContain(
      'Cost per token for each AI model. Sync copies a built-in price list; it does not fetch prices from providers.'
    );
  });

  it('S-2, S-3: the labels', () => {
    expect(P).toContain('Sync Latest Pricing');
    expect(P).toContain('Syncing...');
  });

  it('S-4: the info-box paragraph', () => {
    expect(P).toContain(
      '<strong className="text-green-300">Sync Latest Pricing:</strong> Copies a built-in price list, kept in the code, into this table: it overwrites the price of every model on that list, including manual edits, and adds any listed model that is missing. It does not contact OpenAI, Anthropic or any other provider.'
    );
  });

  it('S-5 to S-7: the comment, the route and the handler fragments', () => {
    expect(P).toContain('// Refresh pricing data after sync since it fetches from external API');
    expect(P).toContain("fetch('/api/admin/system-config/pricing/sync', {");
    expect(P).toContain("'Failed to sync pricing'");
    expect(P).toContain("result.message || 'Pricing synced successfully!'");
    expect(P).toContain('await fetchData(true);');
    expect(P).toContain('setTimeout(() => setSuccess(null), 5000);');
  });

  it('S-9: the whole handleSyncPricing function, verbatim', () => {
    expect(P).toContain(SYNC_HANDLER);
  });

  it('S-10: the whole Sync button, verbatim', () => {
    expect(P).toContain(SYNC_BUTTON);
  });
});

describe('P: the info box tells the truth (MP-FR-1)', () => {
  it('MT-1: none of the false claims is back', () => {
    expect(P).not.toContain('Automatically fetches');
    expect(P).not.toContain('Intelligent Routing');
    expect(P).not.toContain('intelligent routing');
    expect(P).not.toContain('per 1,000');
    expect(P).not.toContain('immediately');
  });

  it('MT-2: it says when a change takes effect', () => {
    expect(P).toContain('in effect on all servers within 1 hour');
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
