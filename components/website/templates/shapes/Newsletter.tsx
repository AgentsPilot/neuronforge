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
      <div className="apc-sec-head">
        {c.title && <h2>{c.title}</h2>}
        {c.description && <p className="apc-lede">{c.description}</p>}
      </div>

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
            placeholder={c.placeholder ?? 'you@example.com'}
            disabled={sending}
            className="apc-field"
            aria-label={c.placeholder ?? 'Email'}
          />
          <button type="submit" disabled={sending} className="apc-btn apc-btn--solid">
            {c.button_text ?? 'Subscribe'}
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
          style={{ fontSize: '0.8125rem', marginBlockStart: '0.6rem', opacity: 0.8 }}
        >
          {consentCopy.text}
          {consentCopy.privacyPolicyUrl && (
            <>
              {' '}
              <a href={consentCopy.privacyPolicyUrl} target="_blank" rel="noopener noreferrer">
                Privacy notice
              </a>
            </>
          )}
        </p>
      )}
    </section>
  );
}
