/**
 * All six archetypes must be nameable in every language the platform speaks.
 *
 * Two of them shipped with no entry at all, and the templates gallery looked
 * names up in the VERTICAL template map — keyed by display name — so every
 * archetype fell through to its raw English name under a Hebrew heading.
 */

import { getTranslatedTemplateName, ARCHETYPE_LABELS, getArchetypeLabel } from '../templateLabels';
import { ARCHETYPES } from '../archetypes';

const LANGUAGES = ['en', 'es', 'he'] as const;

/*
 * `PageTheme.id` is optional on the type, so every archetype's id is narrowed
 * here once rather than asserted at each use. An archetype with no id would be
 * a bug in its own right and this would fail loudly on it.
 */
const IDS: string[] = ARCHETYPES.map(a => {
  if (!a.id) throw new Error('an archetype shipped without an id');
  return a.id;
});

describe('archetype labels', () => {
  it('covers every archetype that ships', () => {
    for (const id of IDS) {
      expect(ARCHETYPE_LABELS[id]).toBeDefined();
    }
  });

  for (const id of IDS) {
    for (const lang of LANGUAGES) {
      it(`${id} has a name and a blurb in ${lang}`, () => {
        const label = getArchetypeLabel(id, lang);
        expect(label.name.trim().length).toBeGreaterThan(0);
        expect(label.blurb.trim().length).toBeGreaterThan(0);
      });
    }
  }

  /*
   * The gallery passes the id, and the id has to win: the name it also passes
   * is the catalogue row's, which is English and free to change.
   */
  it('names an archetype in Hebrew when given its id', () => {
    for (const id of IDS) {
      const translated = getTranslatedTemplateName(id, 'he', id);
      expect(translated).toBe(ARCHETYPE_LABELS[id].name.he);
      expect(translated).not.toBe(id);
    }
  });

  it('still translates a vertical template, which has no id', () => {
    expect(getTranslatedTemplateName('Academic Tutor', 'he')).toBe('מורה פרטי');
  });

  it('falls back to the given name for anything it does not know', () => {
    expect(getTranslatedTemplateName('Something New', 'he', 'not-an-archetype'))
      .toBe('Something New');
  });
});
