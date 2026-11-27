/**
 * @jest-environment jsdom
 *
 * The drawer's "What happens next" section (account deletion lifecycle
 * DL-2b; DL-2 workplan §6.3, §9.2, §12, D-6, D-12; SA W-8, W-13).
 *
 * The pure line builder, the drawer render in English and Hebrew (dates on
 * `timeline.timezone`, never the browser's), and copy parity: every key in
 * en / he / es with the same {slots}, and in the `/v2` English fallback.
 */

import '@testing-library/jest-dom';
import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, screen, within } from '@testing-library/react';

jest.mock('@/components/business-os/data-export/DownloadMyDataButton', () => ({
  DownloadMyDataButton: () => <div data-testid="download-my-data" />,
}));

import { DeleteAccountDrawer, type CopyFn } from '../DeleteAccountDrawer';
import { NO_REFUND_KEY, WHAT_HAPPENS_KEYS, whatHappensLines } from '../whatHappens';
import { formatAccountDay } from '@/components/business-os/settings/planUpgradeCopy';
import type { EnabledDeletionCheck } from '@/hooks/useAccountDeletionCheck';
import type { ClosureTimeline } from '@/lib/business-os/account-deletion/schemas';
import { en } from '@/lib/business-os/translations/en';
import { he } from '@/lib/business-os/translations/he';
import { es } from '@/lib/business-os/translations/es';

const P = 'settings.account_delete.what_happens.';
// 22:30 UTC on 4 Dec is already 5 Dec in Jerusalem, and still 4 Dec in New York: the zone shows.
const PLAN_END = '2026-12-04T22:30:00.000Z';
const LOCK = '2026-12-18T22:00:00.000Z';

const PAID: ClosureTimeline = {
  kind: 'paid',
  planEndsAt: PLAN_END,
  lockAt: LOCK,
  timezone: 'Asia/Jerusalem',
  graceDays: 14,
  during: 'free_plan',
  planName: 'Test Flight',
  trialing: false,
};
const FREE: ClosureTimeline = { kind: 'free', lockAt: LOCK, timezone: 'Asia/Jerusalem', graceDays: 14 };

const keys = (lines: ReturnType<typeof whatHappensLines>) => (lines ?? []).map((line) => line.key);

describe('whatHappensLines (§6.3)', () => {
  it('paid: plan end, no refund, the after-plan, the lock; dates on the timeline zone', () => {
    const lines = whatHappensLines({ timeline: PAID, futureBookings: { count: 0 } }, 'en');
    expect(keys(lines)).toEqual([`${P}paid_plan_end`, NO_REFUND_KEY, `${P}during_free_plan`, `${P}lock`]);
    expect(lines?.[0].vars).toEqual({ planEnd: formatAccountDay(PLAN_END, 'en', 'Asia/Jerusalem') });
    expect(lines?.[0].vars?.planEnd).toBe('December 5, 2026');
    expect(lines?.[2].vars).toEqual({ days: 14, plan: 'Test Flight' });
    expect(lines?.[3].vars).toEqual({ lockDate: formatAccountDay(LOCK, 'en', 'Asia/Jerusalem') });
  });

  it('the same instant in New York is the day before', () => {
    const lines = whatHappensLines({ timeline: { ...PAID, timezone: 'America/New_York' }, futureBookings: { count: 0 } }, 'en');
    expect(lines?.[0].vars?.planEnd).toBe('December 4, 2026');
  });

  it('W-13: a trial gets the trial line and no "no refund"', () => {
    expect(keys(whatHappensLines({ timeline: { ...PAID, trialing: true }, futureBookings: { count: 0 } }, 'en'))).toEqual([
      `${P}paid_plan_end_trial`,
      `${P}during_free_plan`,
      `${P}lock`,
    ]);
  });

  it.each([
    ['back_to_plan', 'Founding Partner', `${P}during_back_to_plan`],
    ['unknown', null, `${P}during_unknown`],
    ['free_plan', null, `${P}during_unknown`],
  ] as const)('during %s (name %p) → %s', (during, planName, key) => {
    expect(keys(whatHappensLines({ timeline: { ...PAID, during, planName }, futureBookings: { count: 0 } }, 'en'))[2]).toBe(key);
  });

  it('free: the grace days, then the lock', () => {
    expect(keys(whatHappensLines({ timeline: FREE, futureBookings: { count: 0 } }, 'he'))).toEqual([`${P}free_grace`, `${P}lock`]);
  });

  it('null timeline → the general line, with the grace days', () => {
    const lines = whatHappensLines({ timeline: null, futureBookings: { count: null } }, 'en');
    expect(lines).toEqual([{ key: `${P}general`, vars: { days: 14 } }, { key: `${P}bookings_unknown` }]);
  });

  it('a date that will not format → the general line, never a sentence with a hole', () => {
    expect(keys(whatHappensLines({ timeline: { ...FREE, lockAt: 'nope' }, futureBookings: { count: 0 } }, 'en'))).toEqual([`${P}general`]);
  });

  it.each([
    [0, []],
    [1, [`${P}bookings_one`]],
    [4, [`${P}bookings`]],
    [null, [`${P}bookings_unknown`]],
  ] as const)('bookings %p → %p (D-12: null is never a 0)', (count, expected) => {
    expect(keys(whatHappensLines({ timeline: FREE, futureBookings: { count } }, 'en')).slice(2)).toEqual(expected);
  });

  it('bookings carry {n} and the lock date', () => {
    const lines = whatHappensLines({ timeline: FREE, futureBookings: { count: 4 } }, 'es');
    expect(lines?.[2].vars).toEqual({ n: 4, lockDate: formatAccountDay(LOCK, 'es', 'Asia/Jerusalem') });
  });

  it('an answer from a server before DL-2b (neither field) → no section', () => {
    expect(whatHappensLines({}, 'en')).toBeNull();
  });
});

const dictionaryCopy =
  (dictionary: Record<string, string>): CopyFn =>
  (key, vars) => {
    let text = dictionary[key] ?? key;
    for (const [name, value] of Object.entries(vars ?? {})) text = text.split(`{${name}}`).join(String(value));
    return text;
  };

const READY: EnabledDeletionCheck = {
  enabled: true,
  available: true,
  blockers: [],
  willKeepBilling: false,
  exportFacts: { lastReadyAt: null, downloaded: false },
  timeline: PAID,
  futureBookings: { count: 1 },
};

function renderDrawer(check: Partial<EnabledDeletionCheck>, language: 'en' | 'he') {
  const dictionary = (language === 'he' ? he : en) as unknown as Record<string, string>;
  return render(<DeleteAccountDrawer check={{ ...READY, ...check }} tr={dictionaryCopy(dictionary)} language={language} isRTL={language === 'he'} />);
}

describe('the drawer section', () => {
  it('English: the heading and the lines, dates on the owner\'s clock', () => {
    renderDrawer({}, 'en');
    const section = screen.getByTestId('delete-account-what-happens');
    expect(within(section).getByText(en[`${P}heading` as keyof typeof en] as string)).toBeInTheDocument();
    expect(section).toHaveTextContent('Your plan runs until December 5, 2026.');
    expect(section).toHaveTextContent(en[NO_REFUND_KEY as keyof typeof en] as string);
    expect(section).toHaveTextContent("Then for 14 days you'll be on Test Flight");
    expect(section).toHaveTextContent(`Your account closes on ${formatAccountDay(LOCK, 'en', 'Asia/Jerusalem')}.`);
    expect(section).toHaveTextContent(`You have 1 client booking after ${formatAccountDay(LOCK, 'en', 'Asia/Jerusalem')}.`);
    expect(section.textContent).not.toMatch(/\{[a-zA-Z]+\}/);
  });

  it('Hebrew: right to left, Hebrew dates, no unfilled slot', () => {
    renderDrawer({ timeline: { ...PAID, trialing: true }, futureBookings: { count: 3 } }, 'he');
    expect(screen.getByTestId('delete-account-drawer')).toHaveAttribute('dir', 'rtl');
    const section = screen.getByTestId('delete-account-what-happens');
    expect(section).toHaveTextContent(`התוכנית פעילה עד ${formatAccountDay(PLAN_END, 'he', 'Asia/Jerusalem')}. היא לא תתחדש, ולא תחויבו.`);
    expect(section).not.toHaveTextContent(he[NO_REFUND_KEY as keyof typeof he] as string);
    expect(section).toHaveTextContent('יש לכם 3 הזמנות של לקוחות');
    expect(section.textContent).not.toMatch(/\{[a-zA-Z]+\}/);
  });

  it('bookings 0 → no bookings line; null → "we couldn\'t count"', () => {
    const { unmount } = renderDrawer({ futureBookings: { count: 0 } }, 'en');
    expect(screen.getByTestId('delete-account-what-happens')).not.toHaveTextContent('client booking');
    unmount();
    renderDrawer({ timeline: null, futureBookings: { count: null } }, 'en');
    const section = screen.getByTestId('delete-account-what-happens');
    expect(section).toHaveTextContent(en[`${P}general` as keyof typeof en].replace('{days}', '14'));
    expect(section).toHaveTextContent(en[`${P}bookings_unknown` as keyof typeof en] as string);
  });

  it('shown with blockers too (between sections 1 and 2); not shown when not available or from an old server', () => {
    const { unmount } = renderDrawer({ blockers: [{ code: 'payment_failed' }] }, 'en');
    const section = screen.getByTestId('delete-account-what-happens');
    const blockers = screen.getByTestId('delete-account-blockers');
    expect(section.compareDocumentPosition(blockers) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    unmount();
    const notAvailable = renderDrawer({ available: false }, 'en');
    expect(screen.queryByTestId('delete-account-what-happens')).toBeNull();
    notAvailable.unmount();
    renderDrawer({ timeline: undefined, futureBookings: undefined }, 'en');
    expect(screen.queryByTestId('delete-account-what-happens')).toBeNull();
  });
});

describe('QA note 2: a throw while formatting falls back like an unformattable date (IN-30, IN-36)', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([['paid', PAID], ['free', FREE]] as const)('%s, a zone this runtime rejects (RangeError) -> the general line, never a throw', (_label, timeline) => {
    const bad = { ...timeline, timezone: 'Invalid/Zone' };
    expect(() => formatAccountDay(bad.lockAt, 'en', bad.timezone)).toThrow(RangeError);
    let lines: ReturnType<typeof whatHappensLines> = null;
    expect(() => {
      lines = whatHappensLines({ timeline: bad, futureBookings: { count: 0 } }, 'en');
    }).not.toThrow();
    expect(keys(lines)).toEqual([`${P}general`]);
  });

  it('the lock date cannot be formatted -> bookings show the "could not count" line, never a broken date (IN-30 rule)', () => {
    const lines = whatHappensLines({ timeline: { ...FREE, timezone: 'Invalid/Zone' }, futureBookings: { count: 3 } }, 'en');
    expect(keys(lines)).toEqual([`${P}general`, `${P}bookings_unknown`]);
  });

  it('a RangeError forced from Date#toLocaleDateString -> the drawer renders the general line and does not throw', () => {
    jest.spyOn(Date.prototype, 'toLocaleDateString').mockImplementation(() => {
      throw new RangeError('Invalid time zone specified');
    });
    expect(() => renderDrawer({ futureBookings: { count: 0 } }, 'en')).not.toThrow();
    const section = screen.getByTestId('delete-account-what-happens');
    const shown = within(section).getAllByTestId('delete-account-what-happens-line').map((node) => node.getAttribute('data-key'));
    expect(shown).toEqual([`${P}general`]);
    expect(section).toHaveTextContent(en[`${P}general` as keyof typeof en].replace('{days}', '14'));
  });
});

describe('copy parity (T-6, W-8)', () => {
  const LANGS: Record<string, Record<string, string>> = {
    en: en as unknown as Record<string, string>,
    he: he as unknown as Record<string, string>,
    es: es as unknown as Record<string, string>,
  };
  const slots = (text: string) => (text.match(/\{[a-zA-Z]+\}/g) ?? []).sort();
  const ALL = [...WHAT_HAPPENS_KEYS, NO_REFUND_KEY];

  it.each(['en', 'he', 'es'])('%s: every key exists, non-empty, with the English slots, no backslash', (lang) => {
    for (const key of ALL) {
      const text = LANGS[lang][key];
      expect({ key, text: typeof text === 'string' && text.length > 0 }).toEqual({ key, text: true });
      expect({ key, slots: slots(text) }).toEqual({ key, slots: slots(LANGS.en[key]) });
      expect(text).not.toContain(String.fromCharCode(92));
    }
  });

  it('the trial line is the paid line without "again" (W-13), in every language', () => {
    expect(LANGS.en[`${P}paid_plan_end_trial`]).toBe('Your plan runs until {planEnd}. It will not renew, and you will not be charged.');
    for (const lang of ['en', 'he', 'es']) expect(LANGS[lang][`${P}paid_plan_end_trial`]).not.toBe(LANGS[lang][`${P}paid_plan_end`]);
  });

  it('the /v2 English fallback holds every key, byte-identical to en', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'components', 'business-os', 'purge', 'DangerZonePanel.tsx'), 'utf8');
    const start = source.indexOf('const FALLBACK_COPY');
    const block = source.slice(start, source.indexOf('\n};', start));
    for (const key of ALL) {
      const match = block.match(new RegExp(`'${key.replace(/\./g, '\\.')}': (['"])(.*)\\1,`));
      expect({ key, value: match?.[2] }).toEqual({ key, value: LANGS.en[key] });
    }
  });

  it('Hebrew deletion lines use the plural register (Q-13)', () => {
    expect(LANGS.he[`${P}free_grace`]).toContain('יש לכם');
    expect(LANGS.he[`${P}lock`]).toContain('תוכלו');
    expect(LANGS.he[`${P}bookings_unknown`]).toContain('בדקו');
  });
});
