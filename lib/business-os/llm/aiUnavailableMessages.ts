/**
 * What the owner reads when a Business OS AI area is switched off (FR-14).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THESE SENTENCES LIVE ON THE SERVER
 *
 * Everything else the owner reads is translated in the browser, from
 * `lib/business-os/LanguageContext.tsx`. These two cannot be: they are produced
 * by API routes that answer with a finished sentence — the chat routes put the
 * text straight into the turn's answer, and the chat mutate path appends it to
 * a confirmation line the client only quotes. A key would arrive at a client
 * that has no branch for it and would be rendered as the key.
 *
 * So the three languages are written here, once, and every server surface that
 * has to say "this is off" says the same thing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS *NOT* HERE, AND MUST NOT BE ADDED
 *
 *  - **Images.** `media.generate.unavailable` — "Image generation is not
 *    available right now." — already exists in all three languages in
 *    `LanguageContext.tsx` and is already reached by the `unavailable` outcome
 *    (QA Q-6). Images off is that outcome. A second sentence for the same
 *    situation would be two wordings of one thing.
 *  - **The website AI-writing buttons.** Those are client-side: the route
 *    answers `{ success: false, code: 'ai_unavailable' }` and the website page
 *    renders its own `labels.ai_unavailable`. Only the mutate path, which has
 *    no client branch, takes the sentence from here.
 *
 * The wording was approved by the user on 2026-09-19 (requirement BQ-1, the ★
 * rows of "What Off Means, Per Area") and must not be reworded without them.
 *
 * Server-only in intent, but it imports nothing: it is three strings and a
 * lookup, so a client module could import it without pulling in the resolver.
 * Do not add an import here that would break that.
 *
 * @see docs/requirements/BUSINESS_OS_LLM_MODEL_SETTINGS_LAYER2_REQUIREMENT.md (FR-14, BQ-1)
 * @see docs/workplans/BUSINESS_OS_LLM_MODEL_SETTINGS_LAYER2_WORKPLAN.md §3.8, §7.1
 * @module lib/business-os/llm/aiUnavailableMessages
 */

/** The three languages Business OS speaks. */
export type AiUnavailableLanguage = 'en' | 'he' | 'es';

/**
 * Chat, whichever version answered (v4, v2 or v1).
 *
 * Deliberately says nothing about why. "Switched off by your platform operator"
 * is true and useless to the person who wanted to ask a question, and it
 * invites a support conversation about a setting the owner cannot change.
 */
export const AI_UNAVAILABLE_CHAT: Record<AiUnavailableLanguage, string> = {
  en: 'The assistant is unavailable right now. Please try again later.',
  he: 'העוזר אינו זמין כרגע. נסו שוב מאוחר יותר.',
  es: 'El asistente no está disponible en este momento. Inténtalo de nuevo más tarde.',
};

/**
 * Website copywriting: the AI-writing buttons and `full_site` outside the
 * onboarding build.
 *
 * The client has its own copy of this in the website page's `LABELS`
 * (`ai_unavailable`), because that surface renders from a label map. The two
 * are checked against each other by `aiUnavailableMessages.test.ts`, so they
 * cannot drift into two different sentences for the same state.
 */
export const AI_UNAVAILABLE_WEBSITE_WRITING: Record<AiUnavailableLanguage, string> = {
  en: 'AI writing is unavailable right now.',
  he: 'כתיבה עם AI אינה זמינה כרגע.',
  es: 'La redacción con IA no está disponible en este momento.',
};

/**
 * Pick a sentence for a language tag that may be anything.
 *
 * A profile's `language` column is a free string, a chat request may carry a
 * BCP-47 tag (`he-IL`), and v1 has no language at all on some paths. Unknown
 * falls to English rather than to a blank answer — an answer in the wrong
 * language is recoverable, no answer is not.
 */
export function aiUnavailableLanguage(value: unknown): AiUnavailableLanguage {
  const tag = typeof value === 'string' ? value.trim().toLowerCase().split(/[-_]/)[0] : '';
  return tag === 'he' || tag === 'es' ? tag : 'en';
}

/** The chat sentence for whatever language hint the caller has. */
export function chatUnavailableMessage(language: unknown): string {
  return AI_UNAVAILABLE_CHAT[aiUnavailableLanguage(language)];
}

/** The website-copy sentence for whatever language hint the caller has. */
export function websiteWritingUnavailableMessage(language: unknown): string {
  return AI_UNAVAILABLE_WEBSITE_WRITING[aiUnavailableLanguage(language)];
}
