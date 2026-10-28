/**
 * @jest-environment jsdom
 *
 * QA P-7a.3 (SA focus 5): the BQ-5 Founding Partner sentence on screen, in
 * en / he / es, and Hebrew right to left.
 *
 * The server rule (when `manage.freeAccessAfter` is sent) is pinned by
 * `freeAccess.test.ts`, `planPurchaseView.test.ts` and the my-plan route test;
 * this file checks what the owner reads: the date is the account-day format
 * of `endsAt` in each language, the sentence follows "You keep …" inside the
 * confirmation, it sits beside Reactivate, never beside a failed payment, and
 * the copy in all three languages carries one `{freeUntil}` slot and no other.
 */

import '@testing-library/jest-dom';
import fs from 'fs';
import path from 'path';
import { fireEvent, render, screen } from '@testing-library/react';

type Lang = 'en' | 'he' | 'es';
const mockLang: { language: Lang; timezone: string } = { language: 'en', timezone: 'UTC' };
jest.mock('@/lib/business-os/LanguageContext', () => {
  const { translations } = jest.requireActual('@/lib/business-os/LanguageContext');
  return {
    useLanguage: () => ({
      language: mockLang.language,
      timezone: mockLang.timezone,
      isRTL: mockLang.language === 'he',
      t: (key: string) => translations[mockLang.language][key] || key,
    }),
  };
});

import { PlanManage } from '@/components/business-os/settings/PlanManage';
import { formatAccountDay } from '@/components/business-os/settings/planUpgradeCopy';
import type { PlanPayload } from '@/components/business-os/settings/planPayloadTypes';

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: Record<Lang, Record<string, string>>;
};

const RENEWS = '2099-11-26T10:00:00.000Z';
const FREE_UNTIL = '2100-03-01T12:00:00.000Z';
const LANGS: Lang[] = ['en', 'he', 'es'];

type Manage = { cancel: boolean; reactivate: boolean; paymentFailed: boolean; freeAccessAfter?: { endsAt: string } };

function plan(manage: Manage, billing: unknown): PlanPayload {
  return {
    status: 'ok',
    kind: 'tier',
    name: 'Essentials',
    purchase: { offer: { kind: 'none', reason: 'paying' }, billing, endsFreeAccessOnPurchase: null, upgrade: null, manage },
  } as unknown as PlanPayload;
}

function inRtl(ui: React.ReactElement, lang: Lang) {
  return render(<div dir={lang === 'he' ? 'rtl' : 'ltr'} style={{ width: 360 }}>{ui}</div>);
}

beforeEach(() => {
  mockLang.language = 'en';
  mockLang.timezone = 'UTC';
  (global as unknown as { fetch: unknown }).fetch = jest.fn();
});

describe('the copy (en / he / es)', () => {
  it.each(LANGS)('%s: cancel_confirm_founding has exactly one {freeUntil} slot and names Founding Partner', (lang) => {
    const text = translations[lang]['plan.manage.cancel_confirm_founding'];
    expect(text).toBeTruthy();
    expect(text.match(/\{[a-zA-Z]+\}/g)).toEqual(['{freeUntil}']);
    expect(text).toContain('Founding Partner');
  });

  it('he and es are translations, not the English line', () => {
    const en = translations.en['plan.manage.cancel_confirm_founding'];
    expect(translations.he['plan.manage.cancel_confirm_founding']).not.toBe(en);
    expect(translations.es['plan.manage.cancel_confirm_founding']).not.toBe(en);
    expect(translations.he['plan.manage.cancel_confirm_founding']).toMatch(/[֐-׿]/);
  });
});

describe('on screen', () => {
  it.each(LANGS)('%s: confirmation reads "You keep …" THEN the founding sentence, with the account-day date', (lang) => {
    mockLang.language = lang;
    inRtl(<PlanManage plan={plan({ cancel: true, reactivate: false, paymentFailed: false, freeAccessAfter: { endsAt: FREE_UNTIL } }, { state: 'renewing', date: RENEWS })} />, lang);
    fireEvent.click(screen.getByTestId('plan-manage-cancel'));
    const text = screen.getByTestId('plan-manage-confirm').textContent ?? '';
    const expectedDay = formatAccountDay(FREE_UNTIL, lang, 'UTC')!;
    const founding = translations[lang]['plan.manage.cancel_confirm_founding'].replace('{freeUntil}', expectedDay);
    const keep = translations[lang]['plan.manage.cancel_confirm_body']
      .replace('{plan}', 'Essentials')
      .replace('{date}', formatAccountDay(RENEWS, lang, 'UTC')!);
    expect(text).toContain(keep);
    expect(text).toContain(founding);
    expect(text.indexOf(keep)).toBeLessThan(text.indexOf(founding));
    expect(text).not.toMatch(/\{[a-zA-Z]+\}|plan\.manage\./);
  });

  it.each(LANGS)('%s: beside Reactivate while the plan is set to end', (lang) => {
    mockLang.language = lang;
    inRtl(<PlanManage plan={plan({ cancel: false, reactivate: true, paymentFailed: false, freeAccessAfter: { endsAt: FREE_UNTIL } }, { state: 'ending', date: RENEWS })} />, lang);
    expect(screen.getByTestId('plan-manage-founding')).toHaveTextContent(formatAccountDay(FREE_UNTIL, lang, 'UTC')!);
    expect(screen.getByTestId('plan-manage-reactivate')).toBeInTheDocument();
  });

  it('the date follows the account clock, as "Ends on" does (Jerusalem: 23:00 UTC is the next day)', () => {
    mockLang.timezone = 'Asia/Jerusalem';
    const lateUtc = '2100-02-28T23:00:00.000Z';
    render(<PlanManage plan={plan({ cancel: false, reactivate: true, paymentFailed: false, freeAccessAfter: { endsAt: lateUtc } }, { state: 'ending', date: RENEWS })} />);
    expect(screen.getByTestId('plan-manage-founding')).toHaveTextContent('March 1, 2100');
  });

  it('a failed payment (no Cancel, no Reactivate): no sentence even if a stray field arrives', () => {
    render(<PlanManage plan={plan({ cancel: false, reactivate: false, paymentFailed: true, freeAccessAfter: { endsAt: FREE_UNTIL } }, { state: 'renewing', date: RENEWS })} />);
    expect(screen.queryByTestId('plan-manage-founding')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Founding Partner');
  });

  it('an unreadable endsAt: no sentence (no "Invalid Date")', () => {
    render(<PlanManage plan={plan({ cancel: false, reactivate: true, paymentFailed: false, freeAccessAfter: { endsAt: 'nope' } }, { state: 'ending', date: RENEWS })} />);
    expect(screen.queryByTestId('plan-manage-founding')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Invalid Date|Founding Partner/);
  });

  it('the new line uses no physical-direction class (RTL safe)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'PlanManage.tsx'), 'utf8');
    const block = src.slice(src.indexOf('data-testid="plan-manage-founding"') - 200, src.indexOf('data-testid="plan-manage-founding"'));
    expect(block).not.toMatch(/\b(ml|mr|pl|pr|left|right)-|text-(left|right)\b/);
  });
});
