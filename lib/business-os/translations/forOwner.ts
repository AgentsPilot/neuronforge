// lib/business-os/translations/forOwner.ts
//
// One server-side way to say something in the owner's own language.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS EXISTS
//
// Most translation in this codebase happens in the browser, where
// `LanguageContext` knows the language. A few things are written SERVER-side
// and stored: an agent's `agent_name` and `description` columns are the live
// case, because the general agents list knows nothing about Business OS and
// renders those columns verbatim.
//
// Without a resolver, that code hardcodes English — which is exactly what
// happened to the mailbox lead channel. A Hebrew-speaking owner set up their
// website enquiry channel and got an agent called "Website enquiries from
// Gmail" sitting in an otherwise Hebrew list.
//
// FALLS BACK TO ENGLISH, NEVER TO THE KEY. A stored name is read at a glance
// and cannot be re-resolved later, so an English row among Hebrew ones is a
// visible seam the owner can report, where `inbox_channel.agent_name` looks
// like a crash. (`install.ts` has its own pair of resolvers predating this
// module, one of which does fall back to the key; new callers should come
// here.)
//
// FROZEN AT WRITE TIME, deliberately and not ideally. The language is resolved
// once, when the row is created, so an owner who later switches language keeps
// the old name. The alternative is storing a key and resolving on read, which
// is what the catalogue agents do for the surfaces that know about them — and
// it is precisely what the general agents list cannot do. One frozen column
// beats a raw key on every screen.
// ─────────────────────────────────────────────────────────────────────────────

import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'BusinessOS', service: 'Translations' });

/** A `say(key, vars?)` bound to one owner's language. */
export type OwnerVoice = (key: string, vars?: Record<string, string>) => string;

/**
 * Resolve phrases in this owner's language.
 *
 * `vars` fills `{placeholders}` in the resolved string, so a caller never
 * concatenates around a translation — word order differs between languages and
 * `'…from ' + provider` cannot be translated at all.
 *
 * Never throws. An unreadable profile, a missing dictionary and a missing key
 * all end in English rather than in an error, because the caller is usually
 * mid-create and failing the create over a label would be absurd.
 */
export async function voiceFor(userId: string): Promise<OwnerVoice> {
  const { en } = await import('@/lib/business-os/translations/en');
  let dictionary = en as Record<string, string>;

  try {
    const { data: profile } = await businessProfileRepository.findByUserId(userId);
    const language = (profile?.language ?? 'en') as 'en' | 'he' | 'es';

    if (language !== 'en') {
      const [{ he }, { es }] = await Promise.all([
        import('@/lib/business-os/translations/he'),
        import('@/lib/business-os/translations/es'),
      ]);
      dictionary =
        (({ he, es } as Record<string, Record<string, string>>)[language] as Record<
          string,
          string
        >) ?? (en as Record<string, string>);
    }
  } catch (err) {
    logger.warn({ err, userId }, 'Could not read the owner language; writing in English');
  }

  return (key: string, vars?: Record<string, string>) => {
    /* English under the owner's language, so one untranslated key reads as a
       seam rather than as a crash. */
    const template = dictionary[key] ?? (en as Record<string, string>)[key] ?? key;

    if (!vars) return template;

    return Object.entries(vars).reduce(
      (text, [name, value]) => text.split(`{${name}}`).join(value),
      template
    );
  };
}
