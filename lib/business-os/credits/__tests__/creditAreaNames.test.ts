/**
 * Every area the history can show has a name in every language (credit
 * deduction slice 7a, workplan §4.5; SA SQ-33, D-q).
 *
 * The server sends an area CODE (one of `BOS_LLM_AREAS`); the panel names it
 * from `credits.area.<code>`. A code with no name in a language would be
 * hidden there, so this fails first — and a name for a code that no longer
 * exists is a dead key.
 */

jest.mock('@/lib/supabaseClient', () => ({ supabase: {} }));

import { BOS_LLM_AREAS } from '@/lib/business-os/llm/callCatalog';
import { translations } from '@/lib/business-os/LanguageContext';

const LANGS = ['en', 'he', 'es'] as const;
const dictionary = translations as unknown as Record<(typeof LANGS)[number], Record<string, string>>;

describe('credits.area.* names', () => {
  it.each(LANGS)('every area code has a non-empty name in %s', (lang) => {
    const missing = BOS_LLM_AREAS.filter((code) => !(dictionary[lang][`credits.area.${code}`] ?? '').trim());
    expect(missing).toEqual([]);
  });

  it.each(LANGS)('no %s name exists for a code that is not an area (no dead keys)', (lang) => {
    const named = Object.keys(dictionary[lang])
      .filter((key) => key.startsWith('credits.area.'))
      .map((key) => key.slice('credits.area.'.length));
    expect(named.filter((code) => !(BOS_LLM_AREAS as readonly string[]).includes(code))).toEqual([]);
    expect(named.length).toBe(BOS_LLM_AREAS.length);
  });

  it('the D-q English names', () => {
    expect(BOS_LLM_AREAS.map((code) => dictionary.en[`credits.area.${code}`])).toEqual([
      'Chat',
      'Insights',
      'Briefing',
      'Website',
      'Forms',
      'Enquiries',
      'Setup',
      'Images',
    ]);
  });
});
