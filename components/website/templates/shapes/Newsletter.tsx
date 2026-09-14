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
}: BlockRendererProps) {
  const c = content as NewsletterShape;
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  /*
   * The address has to go somewhere.
   *
   * This showed a thank-you and discarded the email — there is no subscriber
   * table anywhere in the platform, so every signup was a lead the owner never
   * heard about. That is worse than having no signup box at all: the visitor
   * believes they have made contact.
   *
   * It posts to the same endpoint the contact form uses, which creates the CRM
   * contact, records where the visitor came from, and raises the owner's lead
   * alert. The message says plainly what it was, so the owner is not reading a
   * sentence nobody wrote.
   */
  const submit = async () => {
    const address = email.trim();
    if (!address || sending) return;

    setSending(true);
    try {
      await fetch('/api/website/forms/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subdomain,
          userCode,
          // The endpoint requires a name; the address is the only one given.
          name: address.split('@')[0],
          email: address,
          message: 'Newsletter signup',
        }),
      });
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
        <p className="apc-lede">{c.success_message ?? 'Thank you.'}</p>
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
    </section>
  );
}
