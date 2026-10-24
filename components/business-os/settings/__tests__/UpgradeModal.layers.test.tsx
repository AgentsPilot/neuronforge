/**
 * @jest-environment jsdom
 *
 * The plan comparison modal nested in the settings drawer (upgrade modal UM-1a,
 * C-3, UM-SA2, R-3): the REAL `SettingsDrawer` (Radix sheet) with the REAL
 * `PlanSection` inside, and the REAL dialog. A dismissal aimed at the modal
 * closes the modal only; the drawer stays open. UM-1b adds the busy lock in
 * that stack and the W-1a 3-D Secure probe (last describe).
 */

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/lib/business-os/LanguageContext', () => {
  const { translations } = jest.requireActual('@/lib/business-os/LanguageContext');
  return {
    useLanguage: () => ({ language: 'en', timezone: 'UTC', isRTL: false, t: (key: string) => translations.en[key] || key }),
  };
});
jest.mock('@/lib/stripe/StripeService', () => ({
  getStripeService: () => {
    throw new Error('the plan screen never talks to Stripe');
  },
}));
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: jest.fn() }) }));
jest.mock('@/lib/client/stripeJs', () => ({ getStripePromise: () => Promise.resolve({}) }));
jest.mock('@stripe/react-stripe-js', () => ({
  EmbeddedCheckoutProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  EmbeddedCheckout: () => <div />,
}));

import { PlanSection } from '@/components/business-os/settings/PlanSection';
import { SettingsDrawer } from '@/components/business-os/settings/SettingsDrawer';

import { LOWER, payingRow, payloadFor } from './upgradeModalPayloads';

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: Record<'en', Record<string, string>>;
};
const COPY = translations.en;
const DRAWER_TITLE = 'Your plan';

async function openModalInDrawer() {
  const payload = await payloadFor({ billingRow: payingRow(LOWER) });
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, data: payload }) }) as Response) as unknown as typeof fetch;
  const onDrawerOpenChange = jest.fn();
  render(
    <SettingsDrawer open onOpenChange={onDrawerOpenChange} title={DRAWER_TITLE} isRTL={false} closeLabel="Close this drawer">
      <PlanSection />
    </SettingsDrawer>
  );
  await userEvent.click(await screen.findByTestId('plan-compare-open'));
  const modal = await screen.findByRole('dialog', { name: COPY['upgrade_modal.headline.choose'] });
  return { modal, onDrawerOpenChange };
}

// The sheet's content is mounted only while the drawer is open. (Not a role
// query by name: while the modal is open Radix marks the drawer aria-hidden,
// which also empties its accessible name.)
const drawerStillOpen = () => {
  expect(screen.getByTestId('plan-compare-open')).toBeInTheDocument();
  const openDialogs = Array.from(document.querySelectorAll('[role="dialog"][data-state="open"]'));
  expect(openDialogs.filter((dialog) => dialog.getAttribute('data-testid') !== 'plan-compare-modal')).toHaveLength(1);
};

describe('the modal inside the drawer (UM-SA2)', () => {
  it('Escape closes the modal only', async () => {
    const { onDrawerOpenChange } = await openModalInDrawer();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('plan-compare-modal')).not.toBeInTheDocument());
    expect(onDrawerOpenChange).not.toHaveBeenCalled();
    drawerStillOpen();
  });

  it('a backdrop press closes the modal only', async () => {
    const { modal, onDrawerOpenChange } = await openModalInDrawer();
    // The modal's overlay is the last full-screen sibling Radix portals before its content.
    const overlays = Array.from(document.querySelectorAll('.fixed.inset-0')).filter((element) => !element.contains(modal));
    const overlay = overlays[overlays.length - 1];
    expect(overlay).toBeDefined();
    fireEvent.pointerDown(overlay);
    fireEvent.pointerUp(overlay);
    fireEvent.click(overlay);
    await waitFor(() => expect(screen.queryByTestId('plan-compare-modal')).not.toBeInTheDocument());
    expect(onDrawerOpenChange).not.toHaveBeenCalled();
    drawerStillOpen();
  });

  it('a press inside the modal closes neither', async () => {
    const { modal, onDrawerOpenChange } = await openModalInDrawer();
    const table = within(modal).getByTestId('plan-compare-table');
    fireEvent.pointerDown(table);
    fireEvent.pointerUp(table);
    fireEvent.click(table);
    expect(screen.getByTestId('plan-compare-modal')).toBeInTheDocument();
    expect(onDrawerOpenChange).not.toHaveBeenCalled();
    drawerStillOpen();
  });

  it('the X closes the modal only, and focus returns to "Compare plans"', async () => {
    const { modal, onDrawerOpenChange } = await openModalInDrawer();
    await userEvent.click(within(modal).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByTestId('plan-compare-modal')).not.toBeInTheDocument());
    expect(onDrawerOpenChange).not.toHaveBeenCalled();
    drawerStillOpen();
    await waitFor(() => expect(screen.getByTestId('plan-compare-open')).toHaveFocus());
  });
});

/*
 * Upgrade modal UM-1b: the busy lock inside the drawer, and the W-1a probe.
 *
 * W-1a (SA, re-shaped spike; agents never sign in): Stripe.js mounts its 3-D
 * Secure challenge on `body`, outside every Radix layer. This probe stands in a
 * plain node for that frame, with the drawer AND the modal open, and records
 * what the layers do to it in jsdom. What it CANNOT tell (a real cross-origin
 * iframe, real focus moving into it) is the live check (go-live row 20 (b)).
 */
describe('UM-1b: busy inside the drawer, and the W-1a 3-D Secure probe', () => {
  const QUOTE = { success: true, data: { amountDueMinor: 3387, prorationDate: 1_792_766_146, renewsOn: '2026-11-13T09:30:00.000Z', monthlyPriceMinor: 12900 } };
  let releaseConfirm: (body: unknown) => void = () => undefined;

  async function openUpgradeInDrawer({ holdConfirm }: { holdConfirm: boolean }) {
    const payload = await payloadFor({ billingRow: payingRow(LOWER) });
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && url.endsWith('/preview')) return { ok: true, status: 200, json: async () => QUOTE } as Response;
      if (init?.method === 'POST') {
        if (!holdConfirm) return new Promise<Response>(() => {});
        const body = await new Promise<unknown>((resolve) => (releaseConfirm = resolve));
        return { ok: true, status: 200, json: async () => body } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ success: true, data: payload }) } as Response;
    }) as unknown as typeof fetch;
    const onDrawerOpenChange = jest.fn();
    render(
      <SettingsDrawer open onOpenChange={onDrawerOpenChange} title={DRAWER_TITLE} isRTL={false} closeLabel="Close this drawer">
        <PlanSection />
      </SettingsDrawer>
    );
    await userEvent.click(await screen.findByTestId('plan-compare-open'));
    const modal = await screen.findByTestId('plan-compare-modal');
    await userEvent.click(within(modal).getAllByRole('button', { name: /^Upgrade to / })[0]);
    await within(modal).findByTestId('plan-upgrade-quote');
    return { modal, onDrawerOpenChange };
  }

  async function confirmAndHold(modal: HTMLElement) {
    await userEvent.click(within(modal).getByRole('button', { name: COPY['plan.upgrade.confirm'] }));
    await waitFor(() => expect(within(modal).getByTestId('plan-compare-flow')).toHaveAttribute('aria-busy', 'true'));
  }

  it('while the confirm is in flight: Escape, the X and a backdrop press close neither the modal nor the drawer', async () => {
    const { modal, onDrawerOpenChange } = await openUpgradeInDrawer({ holdConfirm: true });
    await confirmAndHold(modal);
    fireEvent.keyDown(modal, { key: 'Escape' });
    fireEvent.click(within(modal).getByRole('button', { name: 'Close' }));
    const overlays = Array.from(document.querySelectorAll('.fixed.inset-0')).filter((element) => !element.contains(modal));
    const overlay = overlays[overlays.length - 1];
    fireEvent.pointerDown(overlay);
    fireEvent.pointerUp(overlay);
    fireEvent.click(overlay);
    expect(screen.getByTestId('plan-compare-modal')).toBeInTheDocument();
    expect(onDrawerOpenChange).not.toHaveBeenCalled();
    drawerStillOpen();
    // The answer lands: the hand-off closes the modal only; the drawer says "Upgrading…".
    await act(async () => releaseConfirm({ success: true, data: { outcome: 'upgraded' } }));
    await waitFor(() => expect(screen.queryByTestId('plan-compare-modal')).not.toBeInTheDocument());
    expect(onDrawerOpenChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('plan-upgrade-upgrading')).toBeInTheDocument();
  }, 20_000);

  it('W-1a probe: what the two layers do to a node mounted on body, the way Stripe mounts its challenge', async () => {
    const { modal, onDrawerOpenChange } = await openUpgradeInDrawer({ holdConfirm: true });
    const challenge = document.createElement('iframe');
    challenge.setAttribute('name', '__privateStripeFrame9999');
    document.body.appendChild(challenge);
    try {
      // (1) Radix blocks pointer events on body while a modal layer is open, so a
      // frame on body that does not set its own would be unclickable.
      expect(document.body.style.pointerEvents).toBe('none');
      // The mitigation (SA Q-7 (iii)) is present only while busy.
      expect(document.querySelector('[data-testid="plan-compare-stripe-reachable"]')).toBeNull();

      await confirmAndHold(modal);
      const style = screen.getByTestId('plan-compare-stripe-reachable');
      expect(style.textContent).toContain('iframe[name^="__privateStripeFrame"]');
      expect(style.textContent).toContain('pointer-events:auto');
      // The selector matches the frame Stripe mounts.
      expect(challenge.matches('iframe[name^="__privateStripeFrame"]')).toBe(true);

      // (2) Recorded, not designed: focus moved to a node outside the modal while
      // busy STAYS there. The trap's pull-back targets the last focused element in
      // the modal, which is the Confirm button, now disabled, so the refocus is a
      // no-op. That is what the challenge needs, but it rests on that detail, and
      // a cross-origin iframe's focus is not seen this way in jsdom: whether the
      // real challenge keeps focus is the live check (go-live row 20 (b)).
      const probe = document.createElement('button');
      probe.textContent = 'Complete';
      document.body.appendChild(probe);
      probe.focus();
      expect(document.activeElement).toBe(probe);
      probe.remove();

      // (3) A press on that node, while busy, dismisses neither layer.
      fireEvent.pointerDown(challenge);
      fireEvent.pointerUp(challenge);
      fireEvent.click(challenge);
      expect(screen.getByTestId('plan-compare-modal')).toBeInTheDocument();
      expect(onDrawerOpenChange).not.toHaveBeenCalled();

      // Settled: the mitigation is removed with the lock.
      await act(async () => releaseConfirm({ success: true, data: { outcome: 'declined', retryAfter: null } }));
      await within(modal).findByTestId('plan-upgrade-declined');
      expect(document.querySelector('[data-testid="plan-compare-stripe-reachable"]')).toBeNull();
    } finally {
      challenge.remove();
    }
  }, 20_000);
});
