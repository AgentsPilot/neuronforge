/**
 * @jest-environment jsdom
 *
 * QA (DL-2b): the drawer's "What happens next" section, the cases the Dev
 * suite (`whatHappens.dl2b.test.tsx`) leaves out. DL-2 workplan §6.3, §9.2,
 * D-6, D-12; SA W-13; IN-30.
 *
 *   - Spanish rendered end to end (Dev renders en and he only)
 *   - a zone EAST of UTC whose local date is a day after the UTC date
 *     (Pacific/Auckland), so a browser-zone or UTC format would show the
 *     wrong day; plus the real dictionary text in all three languages
 *   - Hebrew free + one booking: RTL container, the singular line in full
 *   - paid with a plan end that will not format but a good lock date
 *   - the section order: heading first, the bookings line last
 */

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen } from '@testing-library/react';

jest.mock('@/components/business-os/data-export/DownloadMyDataButton', () => ({
  DownloadMyDataButton: () => <div data-testid="download-my-data" />,
}));

import { DeleteAccountDrawer, type CopyFn } from '../DeleteAccountDrawer';
import { NO_REFUND_KEY, whatHappensLines } from '../whatHappens';
import type { EnabledDeletionCheck } from '@/hooks/useAccountDeletionCheck';
import type { ClosureTimeline } from '@/lib/business-os/account-deletion/schemas';
import { en } from '@/lib/business-os/translations/en';
import { he } from '@/lib/business-os/translations/he';
import { es } from '@/lib/business-os/translations/es';

const P = 'settings.account_delete.what_happens.';
const DICT: Record<'en' | 'he' | 'es', Record<string, string>> = {
  en: en as unknown as Record<string, string>,
  he: he as unknown as Record<string, string>,
  es: es as unknown as Record<string, string>,
};

// 12:00 UTC on 18 Dec is already 01:00 on 19 Dec in Auckland (NZDT, +13).
const AKL_LOCK = '2026-12-18T11:00:00.000Z';
const AKL_PLAN_END = '2026-12-04T11:30:00.000Z';
const AKL_PAID: ClosureTimeline = {
  kind: 'paid',
  planEndsAt: AKL_PLAN_END,
  lockAt: AKL_LOCK,
  timezone: 'Pacific/Auckland',
  graceDays: 14,
  during: 'back_to_plan',
  planName: 'Founding Partner',
  trialing: false,
};

const copy =
  (dictionary: Record<string, string>): CopyFn =>
  (key, vars) => {
    let text = dictionary[key] ?? key;
    for (const [name, value] of Object.entries(vars ?? {})) text = text.split(`{${name}}`).join(String(value));
    return text;
  };

const BASE: EnabledDeletionCheck = {
  enabled: true,
  available: true,
  blockers: [],
  willKeepBilling: false,
  exportFacts: { lastReadyAt: null, downloaded: false },
  timeline: AKL_PAID,
  futureBookings: { count: 2 },
};

function renderIn(language: 'en' | 'he' | 'es', check: Partial<EnabledDeletionCheck> = {}) {
  return render(
    <DeleteAccountDrawer check={{ ...BASE, ...check }} tr={copy(DICT[language])} language={language} isRTL={language === 'he'} />
  );
}

const lines = () => screen.getAllByTestId('delete-account-what-happens-line');

describe('QA DL-2b: dates on the owner clock where the UTC date differs', () => {
  it('English, Auckland: the local day (19 Dec / 5 Dec), not the UTC day (18 Dec / 4 Dec)', () => {
    renderIn('en');
    const section = screen.getByTestId('delete-account-what-happens');
    expect(section).toHaveTextContent('Your plan runs until December 5, 2026.');
    expect(section).toHaveTextContent('Your account closes on December 19, 2026.');
    expect(section).toHaveTextContent('You have 2 client bookings after December 19, 2026.');
    expect(section).not.toHaveTextContent('December 18, 2026');
    expect(section).not.toHaveTextContent('December 4, 2026');
    expect(section).toHaveTextContent("Then for 14 days you'll be back on Founding Partner");
  });

  it('Spanish, end to end: real dictionary lines, Spanish dates, no unfilled slot, LTR', () => {
    renderIn('es');
    const drawer = screen.getByTestId('delete-account-drawer');
    expect(drawer).not.toHaveAttribute('dir', 'rtl');
    const section = screen.getByTestId('delete-account-what-happens');
    expect(section).toHaveTextContent(DICT.es[`${P}heading`]);
    expect(section).toHaveTextContent('Tu plan sigue activo hasta el 5 de diciembre de 2026.');
    expect(section).toHaveTextContent(DICT.es[NO_REFUND_KEY]);
    expect(section).toHaveTextContent('Después, durante 14 días, volverás a Founding Partner');
    expect(section).toHaveTextContent('Tu cuenta se cierra el 19 de diciembre de 2026.');
    expect(section).toHaveTextContent('Tienes 2 reservas de clientes después del 19 de diciembre de 2026.');
    expect(section.textContent).not.toMatch(/\{[a-zA-Z]+\}/);
  });

  it('Spanish trial: the trial line, no "no refund"', () => {
    renderIn('es', { timeline: { ...AKL_PAID, trialing: true } });
    const section = screen.getByTestId('delete-account-what-happens');
    expect(section).toHaveTextContent('No se renovará y no se te cobrará.');
    expect(section).not.toHaveTextContent('de nuevo');
    expect(section).not.toHaveTextContent(DICT.es[NO_REFUND_KEY]);
  });

  it('Hebrew free + one booking: RTL, the singular line in full, the Hebrew local date', () => {
    const free: ClosureTimeline = { kind: 'free', lockAt: AKL_LOCK, timezone: 'Pacific/Auckland', graceDays: 14 };
    renderIn('he', { timeline: free, futureBookings: { count: 1 } });
    expect(screen.getByTestId('delete-account-drawer')).toHaveAttribute('dir', 'rtl');
    const heLock = new Date(AKL_LOCK).toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Pacific/Auckland' });
    expect(heLock).toContain('19');
    const keys = lines().map((node) => node.getAttribute('data-key'));
    expect(keys).toEqual([`${P}free_grace`, `${P}lock`, `${P}bookings_one`]);
    expect(lines()[2]).toHaveTextContent(DICT.he[`${P}bookings_one`].replace('{lockDate}', heLock));
    expect(lines()[0]).toHaveTextContent('יש לכם 14 ימים');
  });
});

describe('QA DL-2b: line order and the partial-format path', () => {
  it('paid order: plan end, no refund, during, lock, bookings last', () => {
    renderIn('en');
    expect(lines().map((node) => node.getAttribute('data-key'))).toEqual([
      `${P}paid_plan_end`,
      NO_REFUND_KEY,
      `${P}during_back_to_plan`,
      `${P}lock`,
      `${P}bookings`,
    ]);
  });

  it('a plan end that will not format (lock date fine) → the general line, and the bookings line still names the lock date', () => {
    const result = whatHappensLines({ timeline: { ...AKL_PAID, planEndsAt: 'garbage' }, futureBookings: { count: 2 } }, 'en');
    expect(result?.map((line) => line.key)).toEqual([`${P}general`, `${P}bookings`]);
    expect(result?.[1].vars).toEqual({ n: 2, lockDate: 'December 19, 2026' });
  });

  it('the general line (CR-1 wording) renders with the days filled, in all three languages', () => {
    for (const language of ['en', 'he', 'es'] as const) {
      const { unmount } = renderIn(language, { timeline: null, futureBookings: { count: null } });
      const section = screen.getByTestId('delete-account-what-happens');
      expect(section).toHaveTextContent(DICT[language][`${P}general`].replace('{days}', '14'));
      expect(section).toHaveTextContent(DICT[language][`${P}bookings_unknown`]);
      expect(section.textContent).not.toMatch(/\{[a-zA-Z]+\}/);
      unmount();
    }
    expect(DICT.en[`${P}general`]).toBe(
      'You will have {days} days to sign in and export your data before your account closes. If you have a paid plan, those days start when the period you paid for ends.'
    );
  });
});
