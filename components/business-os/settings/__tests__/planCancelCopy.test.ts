/**
 * The plan Cancel drawer's copy (account-deletion lifecycle SX-2 / D3; SA R-10):
 * one `settings.plan_cancel.*` block per language, at the DELETE anchor; every
 * key in en, he and es, non-empty, with the same `{placeholders}`; one reason
 * key per `PLAN_LEAVE_REASON_CODES` code and none without a code. he / es are
 * Dev drafts for the user's review (G-5).
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { PLAN_LEAVE_REASON_CODES } from '@/lib/business-os/billing/planLeaveReasons';
import { en } from '@/lib/business-os/translations/en';
import { he } from '@/lib/business-os/translations/he';
import { es } from '@/lib/business-os/translations/es';

const LANGS = { en, he, es } as Record<string, Record<string, string>>;
const PREFIX = 'settings.plan_cancel.';
const keysOf = (dict: Record<string, string>) => Object.keys(dict).filter((key) => key.startsWith(PREFIX)).sort();
const slots = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort().join(',');

describe('settings.plan_cancel.*', () => {
  it('the same keys in en, he and es, every value non-empty, same placeholders', () => {
    const enKeys = keysOf(en as Record<string, string>);
    expect(enKeys.length).toBeGreaterThan(30);
    for (const [lang, dict] of Object.entries(LANGS)) {
      expect(keysOf(dict)).toEqual(enKeys);
      for (const key of enKeys) {
        expect(`${lang}:${key}:${dict[key]?.trim().length > 0}`).toBe(`${lang}:${key}:true`);
        expect(`${lang}:${key}:${slots(dict[key])}`).toBe(`${lang}:${key}:${slots((en as Record<string, string>)[key])}`);
      }
    }
  });

  it('he and es are drafts, not the English line (except the plan-name-free shell words may differ)', () => {
    const enKeys = keysOf(en as Record<string, string>);
    const same = (dict: Record<string, string>) => enKeys.filter((key) => dict[key] === (en as Record<string, string>)[key]);
    expect(same(he as Record<string, string>)).toEqual([]);
    expect(same(es as Record<string, string>)).toEqual([]);
  });

  it('one reason key per code, in both directions', () => {
    const reasonKeys = keysOf(en as Record<string, string>)
      .filter((key) => key.startsWith(`${PREFIX}reason.`))
      .map((key) => key.slice(`${PREFIX}reason.`.length))
      .filter((code) => !['heading', 'hint', 'required'].includes(code))
      .sort();
    expect(reasonKeys).toEqual([...PLAN_LEAVE_REASON_CODES].sort());
  });

  it('"Keep my plan" is the reactivate label (user-approved wording pending, G-5)', () => {
    expect((en as Record<string, string>)[`${PREFIX}keep_button`]).toBe('Keep my plan');
  });

  it.each(['en', 'he', 'es'])('%s: one contiguous block, directly after the last settings.account_delete key', (lang) => {
    const lines = readFileSync(join(process.cwd(), 'lib', 'business-os', 'translations', `${lang}.ts`), 'utf8').split(/\r?\n/);
    const idx = lines.map((line, i) => (line.includes(`'${PREFIX}`) ? i : -1)).filter((i) => i >= 0);
    expect(idx[idx.length - 1] - idx[0] + 1).toBe(idx.length);
    const lastDelete = Math.max(...lines.map((line, i) => (line.includes("'settings.account_delete.") ? i : -1)));
    // The block's comment line sits between the anchor and the first key.
    expect(idx[0]).toBe(lastDelete + 2);
  });
});

describe('user-approved wording (G-5, 2026-10-27)', () => {
  it.each(Object.keys(LANGS))('%s: the free-plan line carries {credits}; the fallback line does not', (lang) => {
    expect(LANGS[lang][`${PREFIX}changes.free_plan`]).toContain('{credits}');
    expect(LANGS[lang][`${PREFIX}changes.free_plan_nocredits`]).not.toContain('{credits}');
  });

  it.each([
    ['en', /always/i],
    ['he', /תמיד/],
    ['es', /siempre/i],
  ] as const)('%s: "always" is gone from data_kept and unknown', (lang, word) => {
    expect(LANGS[lang][`${PREFIX}changes.data_kept`]).not.toMatch(word);
    expect(LANGS[lang][`${PREFIX}changes.unknown`]).not.toMatch(word);
  });

  it('en reads exactly as approved', () => {
    expect(LANGS.en[`${PREFIX}changes.data_kept`]).toBe('Your data is kept, and you can sign in and export it.');
    expect(LANGS.en[`${PREFIX}changes.unknown`]).toBe('We could not work out exactly what changes. Your data is kept, and you can sign in and export it.');
    expect(LANGS.en[`${PREFIX}changes.free_plan`]).toBe('On {date} your plan moves to the free plan, {plan}, with {credits} credits, until {until}.');
  });
});
