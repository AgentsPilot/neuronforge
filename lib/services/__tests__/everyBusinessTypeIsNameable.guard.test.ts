/**
 * Every business type we offer can be NAMED, and every stage we seed can be READ.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS GUARD EXISTS
 *
 * Three lists have to agree and none of them imports the others:
 *
 *   PIPELINE_PRESETS      the verticals that select a board, and the extraction
 *                         prompt is BUILT from its keys — so this is also the
 *                         complete set of answers a business can be given
 *   VERTICAL_NAMES        what each of those is CALLED, in three languages
 *   STAGE_TRANSLATIONS    what each stage on those boards is called, same three
 *
 * The cost of disagreement is not a crash. `getVerticalLabel` falls back to the
 * raw key and `getTranslatedPipeline` falls back to the English label, so a
 * preset added without words renders perfectly — as "home_services" on a Hebrew
 * screen, and "Quote Sent" on a Spanish board. Nothing fails; the account just
 * reads like a database.
 *
 * The list was widened from nine verticals to twenty-two in one change, after a
 * renovation contractor could only be `default`. Thirteen presets and seven new
 * stage keys is thirteen and seven chances to forget a table, which is what
 * this file is for.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  onboardingConfigurationService,
  PIPELINE_VERTICALS,
  PIPELINE_SUB_VERTICALS,
} from '@/lib/services/OnboardingConfigurationService';
import {
  getVerticalLabel,
  isKnownVertical,
  SELECTABLE_VERTICALS,
} from '@/lib/business-os/verticalLabels';
import { STAGE_TRANSLATIONS } from '@/lib/business-os/stageLabels';

const LANGUAGES = ['en', 'he', 'es'] as const;

/** The fallback preset's own key is a sentinel, not a trade. */
const SENTINELS = ['default', 'other'];

describe('the verticals the extraction may return', () => {
  /*
   * Not a snapshot of the list. A count would have to be edited by the same
   * person who forgot the label, which is no guard at all; this asserts the
   * property instead — whatever is on the list is nameable.
   */
  it.each(PIPELINE_VERTICALS.filter(v => !SENTINELS.includes(v)))(
    '%s has a name in every language',
    vertical => {
      for (const language of LANGUAGES) {
        const label = getVerticalLabel(vertical, language);

        expect(label).not.toBe('');
        /* The fallback IS the key, so a key returned as its own label means the
           table has no entry for it. */
        expect(label).not.toBe(vertical);
      }
    }
  );

  it('still carries the trades that could only ever be "default" before', () => {
    /* The specific gap that was reported, named so a future trim of the list
       cannot quietly reopen it. */
    for (const trade of ['contractor', 'home_services', 'photographer', 'realtor', 'accountant']) {
      expect(PIPELINE_VERTICALS).toContain(trade);
    }
  });
});

describe('the business types a person can choose in settings', () => {
  it.each(SELECTABLE_VERTICALS as string[])('%s has a name in every language', vertical => {
    for (const language of LANGUAGES) {
      expect(getVerticalLabel(vertical, language)).not.toBe('');
      expect(getVerticalLabel(vertical, language)).not.toBe(vertical);
    }
  });

  it('offers no two options that read the same, in any language', () => {
    /*
     * `VERTICAL_NAMES` deliberately holds the same trade under several
     * spellings — `makeup` beside `makeup_artist` — so that a stored value can
     * always be named. Offered in a picker, those become two identical rows and
     * the control looks broken. This is why the selectable list is written out
     * rather than derived from that table.
     */
    for (const language of LANGUAGES) {
      const labels = (SELECTABLE_VERTICALS as string[]).map(v => getVerticalLabel(v, language));
      expect(new Set(labels).size).toBe(labels.length);
    }
  });

  it('offers nothing that is secretly a sentinel', () => {
    for (const vertical of SELECTABLE_VERTICALS) {
      expect(isKnownVertical(vertical)).toBe(true);
    }
  });
});

describe('a sentinel is not a business type', () => {
  it.each(SENTINELS)('%s has no label to print', sentinel => {
    for (const language of LANGUAGES) {
      /*
       * The dissonance this returns nothing for: settings printed "Service
       * Provider" for `default` while the dashboard reported the same field
       * missing, and the owner was shown both in one session.
       */
      expect(getVerticalLabel(sentinel, language)).toBe('');
      expect(isKnownVertical(sentinel)).toBe(false);
    }
  });
});

describe('the stages those boards are seeded with', () => {
  const everyVertical = [...PIPELINE_VERTICALS, ...PIPELINE_SUB_VERTICALS];

  it.each(everyVertical)('%s seeds stages that are translated in every language', key => {
    for (const language of LANGUAGES) {
      const stages = onboardingConfigurationService.getTranslatedPipeline(key, language, key);

      expect(stages.length).toBeGreaterThan(0);

      for (const stage of stages) {
        const translations = STAGE_TRANSLATIONS[stage.stage_key];

        /* A stage key with no entry renders its English label in every
           language, silently — see the file header. */
        expect(translations).toBeDefined();
        expect(translations?.[language]).toBeTruthy();
        expect(stage.stage_label).toBe(translations?.[language]);
      }
    }
  });

  it('gives every board exactly one stage that means "a client, now"', () => {
    /*
     * `is_primary_client_stage` is what auto-promotion moves people into. Two
     * of them is ambiguous and none of them means nobody is ever promoted — and
     * neither shows up as an error, only as a board that stops moving.
     */
    for (const key of everyVertical) {
      const stages = onboardingConfigurationService.getTranslatedPipeline(key, 'en', key);
      const primary = stages.filter(stage => stage.is_primary_client_stage);

      expect({ key, primary: primary.length }).toEqual({ key, primary: 1 });
    }
  });

  it('numbers the positions from zero with no gaps', () => {
    for (const key of everyVertical) {
      const stages = onboardingConfigurationService.getTranslatedPipeline(key, 'en', key);

      expect(stages.map(s => s.position)).toEqual(stages.map((_, index) => index));
    }
  });
});
