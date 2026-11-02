/**
 * The mailbox channel's stored name and description are translated.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUG THIS EXISTS FOR, REPORTED FROM A LIVE HEBREW ACCOUNT
 *
 * `inboxChannelSetup` created its agent with
 *
 *     agent_name: `Website enquiries from ${PROVIDER_NAMES[provider]}`
 *
 * — hardcoded English. A Hebrew-speaking owner set up their website enquiry
 * channel and got "Website enquiries from Gmail" sitting in an otherwise
 * Hebrew agent list.
 *
 * It survived because these two columns are the exception to how this codebase
 * translates. Almost everything is resolved in the browser, where
 * `LanguageContext` knows the language; `agent_name` and `description` are
 * STORED, because the general agents list knows nothing about Business OS and
 * renders them verbatim. Nothing on the server was resolving them, so there
 * was no seam to notice — until an owner read their own dashboard.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD AND NOT A CREATE TEST
 *
 * Both halves of the failure are things a unit test around `create` would miss
 * one of. A create test pins that the resolver is CALLED; it says nothing about
 * whether the key it asks for exists in Hebrew — and a missing key resolves to
 * English, which is the original bug wearing a resolver. So this checks both:
 * the call site no longer carries the English sentence, and every dictionary
 * actually answers the keys it asks for.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { en } from '@/lib/business-os/translations/en';
import { he } from '@/lib/business-os/translations/he';
import { es } from '@/lib/business-os/translations/es';

const SETUP = join(process.cwd(), 'lib/business-os/leads/inboxChannelSetup.ts');

const KEYS = ['inbox_channel.agent_name', 'inbox_channel.agent_description'] as const;

describe('the channel agent is named in the owner language', () => {
  it('asks a resolver rather than carrying the English sentence', () => {
    const src = readFileSync(SETUP, 'utf-8');

    /*
     * The literal that shipped. Matched as the TEMPLATE it was — backtick,
     * interpolation and all — so a comment explaining the history (there is
     * one, and it names the old string) does not fail this.
     */
    expect(src).not.toContain('agent_name: `Website enquiries from');
    expect(src).not.toMatch(/description:\s*\n?\s*'Reads the enquiry emails/);

    /* And it goes through the shared resolver. */
    expect(src).toContain("voiceFor");
    for (const key of KEYS) expect(src).toContain(key);
  });

  it('every dictionary answers both keys', () => {
    /*
     * THE HALF A MOCKED CREATE TEST CANNOT SEE. `voiceFor` falls back to
     * English for a key a language is missing, which is correct behaviour and
     * also exactly the original bug — so the keys existing in Hebrew and
     * Spanish is the thing that makes the fix real.
     */
    for (const [language, dictionary] of Object.entries({ en, he, es })) {
      for (const key of KEYS) {
        const value = (dictionary as Record<string, string>)[key];

        expect(`${language}:${key} = ${value ?? 'MISSING'}`).toBe(`${language}:${key} = ${value}`);
        expect(typeof value).toBe('string');
        expect((value ?? '').length).toBeGreaterThan(0);
      }
    }
  });

  it('does not translate the provider, and leaves a slot for it', () => {
    /*
     * Gmail and Outlook are brand names, so they stay as they are — but the
     * name has to be ASSEMBLED by the resolver rather than concatenated at the
     * call site, because word order differs between languages. Hebrew puts the
     * provider last after a preposition; a `'…from ' + provider` could not have
     * been translated at all.
     */
    for (const dictionary of [en, he, es]) {
      const template = (dictionary as Record<string, string>)['inbox_channel.agent_name'];

      expect(template).toContain('{provider}');
      expect(template).not.toContain('Gmail');
      expect(template).not.toContain('Outlook');
    }
  });

  it('says something different in each language, so none is a copy', () => {
    /* A guard on the guard: three identical English strings would satisfy
       everything above while leaving the bug exactly where it was. */
    const names = [en, he, es].map(
      d => (d as Record<string, string>)['inbox_channel.agent_name']
    );

    expect(new Set(names).size).toBe(3);
  });
});
