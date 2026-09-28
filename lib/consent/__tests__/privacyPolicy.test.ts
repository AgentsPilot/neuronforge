/**
 * The generated privacy notice, in each language it is authored in.
 *
 * The bug being guarded: the notice was English only, and it is what the public
 * page renders for any business that never edits it — so a Hebrew site served
 * right-aligned English prose to visitors who could not read it.
 */

import {
  generatePrivacyPolicy,
  privacyLocale,
  type PrivacyLocale,
} from '@/lib/consent/privacyPolicy';

const LOCALES: PrivacyLocale[] = ['en', 'he', 'es'];

describe('privacyLocale', () => {
  it('accepts the three authored locales', () => {
    expect(privacyLocale('en')).toBe('en');
    expect(privacyLocale('he')).toBe('he');
    expect(privacyLocale('es')).toBe('es');
  });

  it('takes the language part of a full tag', () => {
    expect(privacyLocale('he-IL')).toBe('he');
    expect(privacyLocale('es-MX')).toBe('es');
  });

  it('falls back to English rather than inventing prose', () => {
    // Better a notice in a language the visitor may not read than one this
    // module machine-translated.
    expect(privacyLocale('fr')).toBe('en');
    expect(privacyLocale('')).toBe('en');
    expect(privacyLocale(null)).toBe('en');
    expect(privacyLocale(undefined)).toBe('en');
  });
});

describe('generatePrivacyPolicy', () => {
  it('defaults to English, so callers that pass no locale are unaffected', () => {
    expect(generatePrivacyPolicy({ businessName: 'Acme' })).toContain('# Privacy notice');
  });

  it('writes the heading in each locale', () => {
    expect(generatePrivacyPolicy({ businessName: 'Acme', locale: 'he' })).toContain(
      '# הצהרת פרטיות'
    );
    expect(generatePrivacyPolicy({ businessName: 'Acme', locale: 'es' })).toContain(
      '# Aviso de privacidad'
    );
  });

  describe.each(LOCALES)('%s', (locale) => {
    const body = generatePrivacyPolicy({
      businessName: 'Acme',
      contactEmail: 'hi@acme.test',
      postalAddress: '12 High Street',
      locale,
    });

    it('names the business', () => {
      expect(body).toContain('Acme');
    });

    it('names every processor, so the list cannot differ by language', () => {
      for (const processor of ['Supabase', 'Vercel', 'Resend', 'Stripe']) {
        expect(body).toContain(processor);
      }
    });

    it('includes the contact details it was given', () => {
      expect(body).toContain('hi@acme.test');
      expect(body).toContain('12 High Street');
    });

    it('has the same number of sections as every other locale', () => {
      // A section missing in one language is a claim the business makes in one
      // language and not another.
      expect(body.match(/^## /gm) ?? []).toHaveLength(7);
    });

    it('carries no em dash, per the copy standard', () => {
      expect(body).not.toContain('—');
    });

    it('falls back to a named business rather than an empty subject', () => {
      const unnamed = generatePrivacyPolicy({ businessName: '   ', locale });
      expect(unnamed).not.toMatch(/^\s*collects/m);
    });

    it('mentions the unsubscribe URL only when there is one', () => {
      const withUrl = generatePrivacyPolicy({
        businessName: 'Acme',
        unsubscribeUrl: 'https://acme.test/stop',
        locale,
      });
      expect(withUrl).toContain('https://acme.test/stop');
      expect(body).not.toContain('https://acme.test/stop');
    });
  });

  it('omits the contact block cleanly when there is nothing to show', () => {
    const body = generatePrivacyPolicy({ businessName: 'Acme', locale: 'he' });
    // No dangling label, and no empty bullet where a detail would have gone.
    expect(body).not.toMatch(/^- מייל: *$/m);
    expect(body).toContain('פרטי יצירת קשר זמינים לפי בקשה.');
  });
});
