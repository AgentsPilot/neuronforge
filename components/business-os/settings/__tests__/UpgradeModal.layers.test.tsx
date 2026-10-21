/**
 * @jest-environment jsdom
 *
 * The plan comparison modal nested in the settings drawer (upgrade modal UM-1a,
 * C-3, UM-SA2, R-3): the REAL `SettingsDrawer` (Radix sheet) with the REAL
 * `PlanSection` inside, and the REAL dialog. A dismissal aimed at the modal
 * closes the modal only; the drawer stays open.
 */

import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
