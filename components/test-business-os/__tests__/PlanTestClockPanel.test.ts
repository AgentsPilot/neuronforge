/**
 * The /test-business-os "Test clock" block (plan payments P-6a.1, workplan
 * §5.8; SA C-5, C-7). Source-level, as the Plan checkout panel's suite is: the
 * panel is an internal demo trigger, verified by hand in the demo; these pin
 * the properties that matter.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import { PLAN_TEST_CLOCK_PATH } from '@/components/test-business-os/PlanTestClockPanel';

const read = (relative: string) => readFileSync(join(process.cwd(), relative), 'utf8');
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\/.*$/gm, '');

describe('PlanTestClockPanel', () => {
  const raw = read('components/test-business-os/PlanTestClockPanel.tsx');
  const panel = code(raw);
  const page = code(read('app/test-business-os/page.tsx'));

  it('calls the admin test-clock route with the three actions and the account id from the field', () => {
    expect(PLAN_TEST_CLOCK_PATH).toBe('/api/admin/business-os/test/plan-test-clock');
    expect(panel).toContain('fetch(PLAN_TEST_CLOCK_PATH');
    for (const action of ["send('attach')", "send('status')", "send('advance')"]) expect(panel).toContain(action);
    expect(panel).toContain("action === 'advance' ? { action, accountId: accountId.trim(), to: target.trim() } : { action, accountId: accountId.trim() }");
  });

  it('pre-fills the signed-in account and never overwrites what was typed', () => {
    expect(panel).toContain("if (sessionUserId && accountId === '') setAccountId(sessionUserId);");
  });

  it('shows the lifecycle the server derived at the clock time, and decides nothing itself (C-7)', () => {
    expect(panel).toContain('status.lifecycle.state');
    expect(panel).not.toMatch(/deriveLifecycle|entitlements/);
  });

  it('has a plain sentence for every refusal code the route and the use cases return', () => {
    const route = read('app/api/admin/business-os/test/plan-test-clock/route.ts');
    const useCase = read('lib/business-os/billing/planTestClock.ts');
    const union = useCase.slice(useCase.indexOf('export type PlanTestClockRefusal'), useCase.indexOf('export type PlanTestClockResult'));
    const codes = [...union.matchAll(/\| '([a-z_]+)'/g)].map((match) => match[1]);
    expect(codes.length).toBeGreaterThan(8);
    for (const routeCode of ['not_enabled', 'invalid_input', 'not_a_tenant', 'live_mode_refused']) {
      expect(route).toContain(`'${routeCode}'`);
      codes.push(routeCode);
    }
    for (const refusal of codes) expect(raw).toContain(`${refusal}:`);
  });

  it('names no tier, is a client component, and logs nothing to the console', () => {
    for (const tier of TIER_ORDER) expect(panel).not.toMatch(new RegExp(`['"\`]${tier}['"\`]`));
    expect(raw.trimStart().startsWith("'use client';")).toBe(true);
    expect(panel).not.toMatch(/console\./);
  });

  it('sits on the Billing tab with the session account', () => {
    expect(page).toContain('<PlanTestClockPanel sessionUserId={user?.id ?? null}');
  });
});
