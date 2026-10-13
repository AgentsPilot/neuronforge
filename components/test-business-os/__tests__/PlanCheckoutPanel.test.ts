/**
 * The /test-business-os "Billing" tab (plan payments P-3a, workplan §3.9,
 * T13; SA Q-10, Q-11). Source-level: the panel is an internal demo trigger,
 * verified by hand in the local demo; these pin the properties that matter.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';

const read = (relative: string) => readFileSync(join(process.cwd(), relative), 'utf8');
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\/.*$/gm, '');

describe('PlanCheckoutPanel', () => {
  const panel = code(read('components/test-business-os/PlanCheckoutPanel.tsx'));
  // P-5a.2 (workplan §3.4): the fetch, the redaction and the mount moved to the
  // shared component, and the Stripe.js loader to lib/client/stripeJs.ts. The
  // same properties are pinned where they now live.
  const shared = code(read('components/business-os/billing/PlanEmbeddedCheckout.tsx'));
  const loader = code(read('lib/client/stripeJs.ts'));

  it('calls the checkout route with the fixed test_harness surface, never a URL', () => {
    expect(panel).toContain('<PlanEmbeddedCheckout');
    expect(panel).toContain('returnTo="test_harness"');
    expect(panel).not.toMatch(/returnTo[:=]\s*\{?\s*['"`]https?:/);
    expect(shared).toContain("PLAN_CHECKOUT_ENDPOINT = '/api/business-os/billing/plan/checkout'");
    expect(shared).toContain('fetch(PLAN_CHECKOUT_ENDPOINT');
    expect(shared).toContain('JSON.stringify({ tier, returnTo })');
  });

  it('builds the tier list from TIER_ORDER and names no tier', () => {
    expect(panel).toContain('TIER_ORDER.map(');
    for (const tier of TIER_ORDER) expect(panel).not.toMatch(new RegExp(`['"\`]${tier}['"\`]`));
  });

  it('never puts the client secret in the shared response viewer', () => {
    expect(shared).toContain("REDACTED_CLIENT_SECRET = '[redacted: mounted below]'");
    expect(shared).toContain('clientSecret: REDACTED_CLIENT_SECRET');
    expect(panel).toContain('onResponse={onResponse}');
    expect(panel).not.toMatch(/clientSecret/);
  });

  it('mounts Stripe\'s embedded checkout and handles completion through onComplete (no redirect expected, Q-11)', () => {
    expect(shared).toContain('<EmbeddedCheckoutProvider');
    expect(shared).toContain('<EmbeddedCheckout />');
    expect(shared).toContain('onComplete:');
    expect(panel).toContain('onComplete={');
    expect(loader).toContain('process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY');
  });

  it('is a client component with no console logging', () => {
    for (const file of ['components/test-business-os/PlanCheckoutPanel.tsx', 'components/business-os/billing/PlanEmbeddedCheckout.tsx', 'lib/client/stripeJs.ts']) {
      expect(read(file).trimStart().startsWith("'use client';")).toBe(true);
    }
    expect(panel).not.toMatch(/console\./);
    expect(shared).not.toMatch(/console\./);
  });
});

describe('the harness page wires the Billing tab', () => {
  const page = read('app/test-business-os/page.tsx');

  it('has a Billing tab that renders the panel with the shared log and viewer', () => {
    expect(page).toContain("{ id: 'billing', label: 'Billing' }");
    expect(page).toContain("activeTab === 'billing'");
    expect(page).toContain('<PlanCheckoutPanel onLog={addDebugLog} onResponse={setLastResponse} />');
  });
});
