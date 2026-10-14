import 'server-only';

/**
 * The owner's saved language, read on the server so the first frame is drawn in
 * it (performance business round BR-1a, SA pattern P-1).
 *
 * ── Why on the server ───────────────────────────────────────────────────────
 * `LanguageProvider` used to start in English for everyone and switch after it
 * mounted, so a Hebrew owner saw an English, left-to-right frame first. The
 * layouts that mount the provider are `force-dynamic` and already read the
 * session, so the saved value can come with the page instead.
 *
 * ── The guarantees, each asserted in `__tests__/readInitialLanguage.test.ts` ──
 *   1. **Never throws.** A failure is `{ language: 'en', source: 'unknown' }`,
 *      which the client handles exactly as before BR-1a.
 *   2. **The session user only.** No parameter: the id is `getUser().id`, never
 *      a caller-supplied value. The repository uses the service-role client
 *      scoped by `.eq('user_id', userId)`; this is a read of the caller's own
 *      row, so no ownership pre-check applies (tenant-isolation-guard step 1).
 *   3. **Language only.** `findLocale` also reads the timezone; it is NOT
 *      returned. `user_preferences.timezone` stays the client GET's to deliver
 *      (CLAUDE.md "Currency & Timezone", SA-6).
 *   4. **Exact match** on `en`/`es`/`he`, the same rule the client settles on
 *      (see `isOwnerLanguage`).
 *
 * ── Where it may be called ──────────────────────────────────────────────────
 * Only from `force-dynamic` segments, so a render carrying one user's language
 * is never cached for another. The guard test enforces it for every importer.
 * No cookie is involved (SA-1): the saved value is the single source.
 */

import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { userPreferencesRepository } from '@/lib/repositories/UserPreferencesRepository';

import { isOwnerLanguage, type InitialLanguage } from './ownerLanguage';

const logger = createLogger({ module: 'BusinessOsInitialLanguageRead' });

const UNKNOWN: InitialLanguage = { language: 'en', source: 'unknown' };

export async function readInitialLanguage(): Promise<InitialLanguage> {
  try {
    const user = await getUser();

    // No session: nothing is read and no id is invented.
    if (!user) return { ...UNKNOWN };

    const { data, error } = await userPreferencesRepository.findLocale(user.id);
    if (error) {
      logger.warn({ err: error }, 'Saved language unavailable; the first frame falls back to English');
      return { ...UNKNOWN };
    }

    const stored = data?.preferredLanguage;
    if (isOwnerLanguage(stored)) return { language: stored, source: 'saved' };

    return { language: 'en', source: 'none' };
  } catch (error) {
    logger.warn({ err: error }, 'Saved language read threw; the first frame falls back to English');
    return { ...UNKNOWN };
  }
}
