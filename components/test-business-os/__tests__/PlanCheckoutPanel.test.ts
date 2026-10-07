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

  it('calls the checkout route with the fixed test_harness surface, never a URL', () => {
    expect(panel).toContain("fetch('/api/business-os/billing/plan/checkout'");
    expect(panel).toContain("returnTo: 'test_harness'");
    expect(panel).not.toMatch(/returnTo:\s*['"`]https?:/);
  });

  it('builds the tier list from TIER_ORDER and names no tier', () => {
    expect(panel).toContain('TIER_ORDER.map(');
    for (const tier of TIER_ORDER) expect(panel).not.toMatch(new RegExp(`['"\`]${tier}['"\`]`));
  });

  it('never puts the client secret in the shared response viewer', () => {
    expect(panel).toContain("clientSecret: '[redacted: mounted below]'");
  });

  it('mounts Stripe\'s embedded checkout and handles completion through onComplete (no redirect expected, Q-11)', () => {
    expect(panel).toContain('<EmbeddedCheckoutProvider');
    expect(panel).toContain('<EmbeddedCheckout />');
    expect(panel).toContain('onComplete:');
    expect(panel).toContain('process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY');
  });

  it('is a client component with no console logging', () => {
    expect(read('components/test-business-os/PlanCheckoutPanel.tsx').trimStart().startsWith("'use client';")).toBe(true);
    expect(panel).not.toMatch(/console\./);
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
