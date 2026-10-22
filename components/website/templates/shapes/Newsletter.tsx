'use client';

/**
 * One field and one control, on the page ground.
 *
 * No panel and no icon: a newsletter row that draws a box around itself reads
 * as an advertisement inside the page rather than part of it. The field takes
 * the template's own border and radius, so it matches the contact form further
 * down without either knowing about the other.
 *
 * @module components/website/templates/shapes/Newsletter
 */

import { useState } from 'react';
import type { BlockRendererProps } from '@/components/website/blocks/types';
import { useConsentCopy } from '@/hooks/useConsentCopy';
import { ALREADY_SUBSCRIBED, CONFIRM_PROMPT } from '@/lib/consent/confirmPrompt';
import { getBlockTranslation } from '@/lib/i18n/website-block-translations';

interface NewsletterShape {
  title?: string;
  description?: string;
  placeholder?: string;
  button_text?: string;
  success_message?: string;
}

export function NewsletterSection({
  content,
  styles,
  isRTL,
  className,
  subdomain,
  userCode,
  locale,
}: BlockRendererProps) {
  const c = content as NewsletterShape;

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE WORDS THIS SHAPE SUPPLIES ITSELF ARE IN THE PAGE'S LANGUAGE.
   *
   * `'Subscribe'`, `'you@example.com'` and `'Privacy notice'` were English
   * literals, so a Hebrew page rendered a Hebrew consent statement — which
   * comes from the business and was always translated — between an English
   * placeholder and an English button. The one part of the section the owner
   * never writes was the one part that could not be in their language.
   *
   * `websiteBlockTranslations.newsletter` already carried every one of these
   * in all three languages for the non-template renderer. Read from there
   * rather than restated here, so the two newsletter surfaces cannot drift
   * into saying different things.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const t = (key: string) => getBlockTranslation('newsletter', key, locale);

  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  /** Set where the address was already confirmed, so no email is coming. */
  const [already, setAlready] = useState(false);
  const [sending, setSending] = useState(false);

  /*
   * NO CHECKBOX HERE, deliberately.
   *
   * This form has one field and one button, and its entire purpose is to join a
   * marketing list. A tick alongside would be a tick next to nothing else —
   * there is no bundling to unbundle, and pressing Subscribe IS the affirmative
   * act. So the statement is rendered as visible text above the button.
   *
   * SUBMITTING DOES NOT SUBSCRIBE ANYONE. What a checkbox could never establish
   * is whether the address belongs to the person typing it, and that is the
   * real risk on a form like this: anyone can enter anyone. So the submission
   * starts a double opt-in — the route emails the address, and consent is
   * recorded only when the link in it is clicked.
   */
  const consentCopy = useConsentCopy({ subdomain, userCode, locale });

  /*
   * The address goes to the business's own subscriber list.
   *
   * Not the contact endpoint, which it used to post to for want of anywhere
   * else: landing there made a subscriber a CRM contact, and a contact is
   * something the chasers act on. A subscriber is an audience. They become a
   * contact when they book, or when the owner moves them.
   */
  const submit = async () => {
    const address = email.trim();
    if (!address || sending) return;

    setSending(true);
    try {
      const response = await fetch('/api/public/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subdomain,
          userCode,
          email: address,
          locale,
          page_url: typeof window !== 'undefined' ? window.location.href : undefined,
        }),
      });

      const json = await response.json().catch(() => null);
      if (json?.data?.alreadySubscribed) setAlready(true);
    } finally {
      // Shown either way. A failed request is not something the visitor can act
      // on, and telling them so invites a second submission of the same address.
      setSending(false);
      setSent(true);
    }
  };

  if (!c.title && !c.button_text) return null;

  return (
    <section
      dir={isRTL ? 'rtl' : 'ltr'}
      className={`apc-sec ${styles?.padding ?? ''} ${className ?? ''}`}
    >
      {/*
        ─────────────────────────────────────────────────────────────────────
        THE DESCRIPTION IS NOT PART OF THE HEADER ROW.

        `.apc-sec-head` is a TWO-ENDED row — Warm and Bloom lay it out as
        `display: flex; justify-content: space-between`, Stone as a 170px + 1fr
        grid — and every other shape puts exactly what it is built for inside
        it: an eyebrow and a heading, at opposite ends of one baseline.

        This shape put the heading and its DESCRIPTION in there instead, so the
        two became the row's two ends: under Stone the h2 was squeezed into a
        170px column beside its own subtitle, and under Warm and Bloom the pair
        wrapped and each landed alone against the start edge — which on a
        Hebrew page is the right-hand one, and reads as the whole section
        jammed into a narrow column on the right.

        The description is a lede belonging to the section, so it sits after
        the head exactly as the other shapes' body content does. The base rule
        `.apc-sec-head + * { margin-block-start: 0 }` closes the gap.
        ─────────────────────────────────────────────────────────────────────
      */}
      {c.title && (
        <div className="apc-sec-head">
          <h2>{c.title}</h2>
        </div>
      )}
      {c.description && <p className="apc-lede">{c.description}</p>}

      {sent ? (
        /*
         * NOT the owner's `success_message`.
         *
         * Nobody is subscribed yet: an email has gone out asking this address
         * to confirm. "Thank you for subscribing" here would be a lie, and the
         * kind that costs subscribers — somebody told they are done does not
         * go looking for a confirmation email.
         */
        <p className="apc-lede">
          {already
            ? ALREADY_SUBSCRIBED[locale] ?? ALREADY_SUBSCRIBED.en
            : CONFIRM_PROMPT[locale] ?? CONFIRM_PROMPT.en}
        </p>
      ) : (
        <form
          className="apc-signup"
          onSubmit={event => {
            event.preventDefault();
            void submit();
          }}
        >
          <input
            type="email"
            required
            value={email}
            onChange={event => setEmail(event.target.value)}
            placeholder={c.placeholder ?? t('emailPlaceholder')}
            disabled={sending}
            className="apc-field"
            aria-label={c.placeholder ?? t('emailPlaceholder')}
          />
          <button type="submit" disabled={sending} className="apc-btn apc-btn--solid">
            {c.button_text ?? t('subscribe')}
          </button>
        </form>
      )}

      {/*
        The statement, as text rather than as a label on a box. Placed under the
        form so it is visible before someone presses Subscribe, and restated in
        the confirmation email and on the page that completes it.
      */}
      {!sent && consentCopy && (
        <p
          className="apc-lede"
          /*
           * The measure is the FORM's, not the lede's.
           *
           * `.apc-lede` caps itself at `44ch`, and `ch` scales with the font
           * size — so at 0.8125rem that cap is about 290px, which breaks a
           * three-clause consent sentence into a tall ragged stack narrower
           * than the field above it. 520px is `.apc-signup`'s own width, so
           * the statement and the form it belongs to share one edge.
           */
          style={{
            fontSize: '0.8125rem',
            marginBlockStart: '0.6rem',
            opacity: 0.8,
            maxWidth: '520px',
          }}
        >
          {consentCopy.text}
          {consentCopy.privacyPolicyUrl && (
            <>
              {' '}
              <a href={consentCopy.privacyPolicyUrl} target="_blank" rel="noopener noreferrer">
                {t('privacyNotice')}
              </a>
            </>
          )}
        </p>
      )}
    </section>
  );
}
