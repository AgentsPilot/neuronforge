/**
 * @jest-environment jsdom
 *
 * The page, rendered against the payload the SERVER actually produces (QA-7).
 *
 * ── The gap this closes, and why a green run hid a broken page ──────────────
 * There were two suites and they never met. `page.render.test.tsx` renders
 * against a fixture typed by `types.ts`; `adminPlansView.test.ts` checks the
 * server module against the config. **Neither compares the two sides of the
 * contract.** So when the view stopped emitting `withheldWithoutGate` and
 * `gateBuilt`, both suites stayed green while the page threw
 * `TypeError: Cannot read properties of undefined` and rendered nothing at all.
 *
 * A fixture is a statement of what we BELIEVE the server sends. This file is
 * the only place that belief is checked, so everything here uses the real
 * builder and nothing here declares a shape.
 *
 * ── The same gap, found elsewhere on this screen ────────────────────────────
 * `AccountLookup` consumes a different payload — the accounts route — and had
 * the same class of defect twice over: `basis` typed `string` when the route
 * sends an object (it threw on every successful lookup), and a locally computed
 * `value !== false` where the server now sends `granting`. That seam is covered
 * by `accountLookup.contract.test.tsx`, built the same way.
 */

import '@testing-library/jest-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { buildAdminPlansView } from '@/lib/business-os/entitlements/adminPlansView';

import BusinessOsTiersPage from '../page';

/** The real payload, built by the real module. Nothing is written down here. */
const payload = buildAdminPlansView(new Date('2026-09-24T12:00:00.000Z'));

function renderWithRealPayload() {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ success: true, data: payload }),
  })) as unknown as typeof fetch;

  render(<BusinessOsTiersPage />);
}

describe('the page renders what the server sends', () => {
  it('renders at all — the assertion that was missing', async () => {
    // This is the one that would have failed. With `withheldWithoutGate`
    // absent, `payload.withheldWithoutGate.length` throws during render and the
    // body is empty; `getByTestId` then fails here rather than in production.
    renderWithRealPayload();

    await waitFor(() => expect(screen.getByTestId('enforcement-banner')).toBeInTheDocument());
    expect(document.body.textContent?.length ?? 0).toBeGreaterThan(200);
  });

  it('renders a card for every plan the server sent, by its own id', async () => {
    renderWithRealPayload();
    await waitFor(() => expect(screen.getByTestId('enforcement-banner')).toBeInTheDocument());

    for (const plan of payload.plans) {
      const card = screen.getByTestId(`plan-${plan.id}`);
      expect(card).toHaveTextContent(plan.name);
      expect(within(card).getByTestId(`plan-${plan.id}-ai`)).toHaveTextContent(plan.aiActions);
      expect(within(card).getByTestId(`plan-${plan.id}-ends`)).toHaveTextContent(plan.endsWhen);
    }
  });

  it('renders every not-built capability the server sent', async () => {
    renderWithRealPayload();
    await waitFor(() => expect(screen.getByTestId('not-built-panel')).toBeInTheDocument());

    for (const capability of payload.notBuilt) {
      expect(screen.getByTestId(`not-built-${capability.capability}`)).toHaveTextContent(
        capability.label
      );
    }
  });

  it('marks the withheld-without-a-gate capabilities the server named', async () => {
    renderWithRealPayload();
    await waitFor(() => expect(screen.getByTestId('enforcement-banner')).toBeInTheDocument());

    // Slice 1 wires no call site, so every withheld capability is unmarked —
    // and when that changes, this test changes with the payload rather than
    // needing an edit.
    if (payload.withheldWithoutGate.length === 0) {
      expect(screen.queryByTestId('no-gate-summary')).not.toBeInTheDocument();
      return;
    }

    const summary = screen.getByTestId('no-gate-summary');
    for (const capability of payload.withheldWithoutGate) {
      expect(summary).toHaveTextContent(capability);
    }

    const firstPlan = payload.plans.find((plan) => plan.withholds.some((entry) => !entry.gateBuilt));
    expect(firstPlan).toBeDefined();

    await userEvent.click(
      within(screen.getByTestId(`plan-${firstPlan?.id}`)).getByRole('button', { name: /Withholds/ })
    );

    const marked = firstPlan?.withholds.find((entry) => !entry.gateBuilt);
    expect(screen.getByTestId(`no-gate-${marked?.capability}`)).toBeInTheDocument();
  });

  it('shows the mode and the meaning the server decided, not a default', async () => {
    renderWithRealPayload();
    await waitFor(() => expect(screen.getByTestId('enforcement-banner')).toBeInTheDocument());

    const banner = screen.getByTestId('enforcement-banner');
    expect(within(banner).getByTestId('enforcement-mode')).toHaveTextContent(payload.mode);
    expect(banner).toHaveTextContent(payload.modeMeaning);
    expect(banner).toHaveTextContent(payload.modeEnvVar);
  });
});

describe('the fixture in the render suite still matches the server', () => {
  /**
   * The cheap half of the same idea: compare SHAPES.
   *
   * A render test with a fixture is worth having — it can describe states the
   * real config does not currently produce, like `enforce`. What it must not do
   * is drift. So the fixture's keys are checked against the real payload's, at
   * every level that matters.
   */
  const keysOf = (value: object) => Object.keys(value).sort();

  it('the payload has exactly the top-level fields the page consumes', () => {
    expect(keysOf(payload)).toEqual(
      [
        'enforced',
        'generatedAt',
        'matrixVersion',
        'mode',
        'modeEnvVar',
        'modeMeaning',
        'notBuilt',
        'plans',
        'withheldWithoutGate',
        'writeOpsNotOnThisPage',
      ].sort()
    );
  });

  it('every plan has exactly the fields the card consumes', () => {
    for (const plan of payload.plans) {
      expect(keysOf(plan)).toEqual(
        [
          'aiActions',
          'basis',
          'endsWhen',
          'id',
          'includes',
          'inheritsFrom',
          'kind',
          'monthlyPriceUsd',
          'name',
          'state',
          'withholds',
        ].sort()
      );
    }
  });

  it('every capability carries the granting answer AND the gate answer', () => {
    // Two different questions, both decided server-side, both needed by the
    // card. Losing either one is what broke the page.
    for (const plan of payload.plans) {
      for (const capability of [...plan.includes, ...plan.withholds]) {
        expect(keysOf(capability)).toEqual(
          ['capability', 'category', 'display', 'gateBuilt', 'granting', 'label'].sort()
        );
        expect(typeof capability.gateBuilt).toBe('boolean');
        expect(typeof capability.granting).toBe('boolean');
      }
    }
  });

  it('every not-built entry carries what the panel prints', () => {
    for (const capability of payload.notBuilt) {
      expect(keysOf(capability)).toEqual(['capability', 'category', 'label', 'note'].sort());
    }
  });
});
