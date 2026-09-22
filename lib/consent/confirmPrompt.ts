/**
 * What a newsletter form says after it is submitted.
 *
 * Not "thank you for subscribing", because nobody has subscribed. An email has
 * gone out asking the address to confirm, and that is the only thing that has
 * happened. Telling someone they are done is both untrue and self-defeating:
 * a person who believes the signup is complete never goes looking for the
 * confirmation email, so the subscription never happens.
 *
 * This deliberately overrides the owner's own `success_message`. That field was
 * written for a one-step signup and will say the wrong thing here, and the
 * owner has no way to know the flow changed underneath it.
 *
 * @module lib/consent/confirmPrompt
 */

export const CONFIRM_PROMPT: Record<string, string> = {
  en: 'Almost there. Check your email and click the link to confirm.',
  he: 'כמעט סיימנו. בדקו את תיבת הדואר ולחצו על הקישור כדי לאשר.',
  es: 'Ya casi. Revisa tu correo y pulsa el enlace para confirmar.',
};

/**
 * What the form says to somebody who was already on the list.
 *
 * Distinct from `CONFIRM_PROMPT` because no email is coming: they confirmed
 * once already, and asking them to confirm again would be a message about
 * nothing. Telling them to check an inbox that will stay empty is the kind of
 * small lie that has people refreshing their mail and then giving up.
 */
export const ALREADY_SUBSCRIBED: Record<string, string> = {
  en: "You're already subscribed. Nothing more to do.",
  he: 'אתם כבר רשומים לדיוור. אין צורך בפעולה נוספת.',
  es: 'Ya estás suscrito. No hay nada más que hacer.',
};
