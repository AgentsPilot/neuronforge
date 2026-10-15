/**
 * @jest-environment jsdom
 */

/**
 * `MarketingConsentDrawer`'s own reset (S-3 workplan G-9 / D-14, M12).
 *
 * The real panel reports "clean" as soon as it mounts, which hides whether the
 * owner resets its flags on close: a reopened drawer is clean either way. Here
 * the panel is a stand-in that reports only when told to, so the owner's reset
 * is the only thing that can make a reopened drawer clean. Without it, the
 * draft that was just discarded would make the next close ask again.
 */

import React, { useRef, useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

jest.mock('@/lib/business-os/LanguageContext', () => {
  const { translations } = jest.requireActual('@/lib/business-os/LanguageContext');
  return {
    useLanguage: () => ({
      language: 'en',
      isRTL: false,
      t: (key: string) => translations.en[key] || key,
    }),
  };
});
jest.mock('@/lib/supabaseClient', () => ({ supabase: {} }));

// Reports nothing on mount; only the buttons report.
jest.mock('@/components/business-os/settings/MarketingConsentPanel', () => {
  const ReactInMock = jest.requireActual('react') as typeof React;
  return {
    MarketingConsentPanel: ({
      onDirtyChange,
      onBusyChange,
    }: {
      onDirtyChange?: (dirty: boolean) => void;
      onBusyChange?: (busy: boolean) => void;
    }) =>
      ReactInMock.createElement(
        'div',
        null,
        ReactInMock.createElement('button', { type: 'button', onClick: () => onDirtyChange?.(true) }, 'Make dirty'),
        ReactInMock.createElement('button', { type: 'button', onClick: () => onBusyChange?.(true) }, 'Make busy')
      ),
  };
});

import { MarketingConsentDrawer } from '@/components/business-os/settings/MarketingConsentDrawer';

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: { en: Record<string, string> };
};
const COPY = translations.en;
const DRAWER = 'settings-consent-drawer';

function Harness() {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button ref={opener} type="button" onClick={() => setOpen(true)}>
        Opener
      </button>
      <MarketingConsentDrawer open={open} onOpenChange={setOpen} returnFocusRef={opener} />
    </>
  );
}

function ownX(): HTMLButtonElement {
  const own = within(screen.getByTestId(DRAWER))
    .getAllByRole('button', { name: COPY['common.close'] })
    .find((b) => !b.className.includes('absolute'));
  if (!own) throw new Error("The drawer's own X was not found");
  return own as HTMLButtonElement;
}

const prompt = () => screen.queryByRole('dialog', { name: COPY['settings.drawer.discard_title'] });

it('a reopened drawer starts clean after a Discard, even before the new panel reports in', async () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Opener' }));
  await screen.findByTestId(DRAWER);
  fireEvent.click(screen.getByRole('button', { name: 'Make dirty' }));
  fireEvent.click(ownX());
  const p = await screen.findByRole('dialog', { name: COPY['settings.drawer.discard_title'] });
  fireEvent.click(within(p).getByRole('button', { name: COPY['settings.drawer.discard'] }));
  await waitFor(() => expect(screen.queryByTestId(DRAWER)).toBeNull());

  fireEvent.click(screen.getByRole('button', { name: 'Opener' }));
  await screen.findByTestId(DRAWER);
  fireEvent.click(ownX());
  await waitFor(() => expect(screen.queryByTestId(DRAWER)).toBeNull());
  expect(prompt()).toBeNull();
});

it('the drawer and its prompt carry the translated copy', async () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Opener' }));
  expect(await screen.findByRole('dialog', { name: COPY['consent.title'] })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Make dirty' }));
  fireEvent.click(ownX());
  const p = await screen.findByRole('dialog', { name: COPY['settings.drawer.discard_title'] });
  expect(within(p).getByText(COPY['settings.drawer.discard_desc'])).toBeTruthy();
  expect(within(p).getByRole('button', { name: COPY['settings.drawer.keep_editing'] })).toBeTruthy();
});
