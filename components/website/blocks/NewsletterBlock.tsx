'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Mail, Loader2, CheckCircle, ArrowRight } from 'lucide-react';
import type { BlockRendererProps } from './types';
import { useConsentCopy } from '@/hooks/useConsentCopy';
import { ALREADY_SUBSCRIBED, CONFIRM_PROMPT } from '@/lib/consent/confirmPrompt';

interface NewsletterContent {
  title?: string;
  description?: string;
  placeholder?: string;
  button_text?: string;
  success_message?: string;
  crm_integration?: boolean;
  crm_tag?: string;
}

// Localized labels
const LABELS = {
  en: {
    title: 'Stay Updated',
    description: 'Get the latest news and updates delivered to your inbox.',
    placeholder: 'Enter your email',
    button: 'Subscribe',
    success: 'Thanks for subscribing!',
    error: 'Something went wrong. Please try again.',
    invalidEmail: 'Please enter a valid email address',
    privacyNotice: 'Privacy notice'
  },
  es: {
    title: 'Mantente Informado',
    description: 'Recibe las últimas noticias y actualizaciones en tu correo.',
    placeholder: 'Ingresa tu correo',
    button: 'Suscribirse',
    success: '¡Gracias por suscribirte!',
    error: 'Algo salió mal. Por favor, inténtalo de nuevo.',
    invalidEmail: 'Por favor, introduce un correo electrónico válido',
    privacyNotice: 'Aviso de privacidad'
  },
  he: {
    title: 'הישאר מעודכן',
    description: 'קבל את החדשות והעדכונים האחרונים ישירות לתיבת הדואר שלך.',
    placeholder: 'הזן את האימייל שלך',
    button: 'הרשמה',
    success: '!תודה על ההרשמה',
    error: 'משהו השתבש. אנא נסה שוב.',
    invalidEmail: 'אנא הזן כתובת אימייל תקינה',
    privacyNotice: 'הצהרת פרטיות'
  }
};

export function NewsletterBlock({ content, styles, theme, locale, isRTL, className, subdomain, userCode }: BlockRendererProps) {
  const {
    title,
    description,
    placeholder,
    button_text,
    success_message
  } = content as NewsletterContent;

  const labels = LABELS[locale] || LABELS.en;
  const primaryColor = theme?.colors.primary || '#4F6EF7';

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  /** Set where the address was already confirmed, so no email is coming. */
  const [already, setAlready] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * As on the template newsletter shape: no checkbox on a one-field form whose
   * only purpose is the list, and submitting starts a double opt-in rather than
   * subscribing anyone. Consent is recorded when the emailed link is clicked.
   */
  const consentCopy = useConsentCopy({ subdomain, userCode, locale });


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate email
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError(labels.invalidEmail);
      return;
    }

    setLoading(true);

    try {
      /*
       * The business's own subscriber list.
       *
       * This posted to `/api/website/public/newsletter`, which does not exist
       * and never has — every subscriber saw the generic error and the address
       * went nowhere. It is not the CONTACT endpoint either: a subscriber is an
       * audience, and a contact is something the chasers act on.
       */
      const response = await fetch('/api/public/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subdomain,
          userCode,
          email,
          locale,
          page_url: typeof window !== 'undefined' ? window.location.href : undefined
        })
      });

      if (response.ok) {
        const json = await response.json().catch(() => null);
        if (json?.data?.alreadySubscribed) setAlready(true);
        setSubmitted(true);
        setEmail('');
      } else {
        setError(labels.error);
      }
    } catch {
      setError(labels.error);
    } finally {
      setLoading(false);
    }
  };

  const isGradientBg = styles?.background?.includes('gradient');
  const layoutStyle = styles?.layout || 'inline';
  /*
   * What the visitor is agreeing to, in the business's own words.
   *
   * Rendered as text rather than as a checkbox label: this form has one field
   * and one button, and pressing Subscribe IS the affirmative act — there is no
   * bundling for a tick to unbundle. It has to be visible BEFORE the button,
   * because agreeing to something you were not shown is not consent.
   *
   * Shared by both layouts below so the two cannot drift into saying different
   * things — which is how one of them came to say nothing at all.
   */
  const statement = consentCopy ? (
    <p
      className={`mt-3 text-xs leading-relaxed ${isGradientBg ? 'text-white/70' : 'ap-ink-3'}`}
    >
      {consentCopy.text}
      {consentCopy.privacyPolicyUrl && (
        <>
          {' '}
          <a
            href={consentCopy.privacyPolicyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            {labels.privacyNotice}
          </a>
        </>
      )}
    </p>
  ) : null;

  // Card layout
  if (layoutStyle === 'card') {
    return (
      <section
        dir={isRTL ? 'rtl' : 'ltr'}
        className={`${styles?.padding || 'py-16 sm:py-24'} ${styles?.background || 'ap-bg'} ${className || ''}`}
      >
        <div className={`mx-auto px-4 sm:px-6 ${styles?.max_width ? `max-w-${styles.max_width}` : 'max-w-lg'}`}>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="ap-card-2 rounded-2xl p-8 text-center"
            style={{ borderRadius: theme?.borderRadius || '1rem' }}
          >
            <div
              className="apc-icon w-14 h-14 mx-auto rounded-full flex items-center justify-center mb-6"
              style={{ backgroundColor: `${primaryColor}20` }}
            >
              <Mail className="w-7 h-7" style={{ color: primaryColor }} />
            </div>

            <h3
              className="text-2xl font-bold ap-ink mb-3"
              style={{ fontFamily: 'var(--ap-font-heading)' }}
            >
              {title || labels.title}
            </h3>

            <p
              className="ap-ink-2 mb-6"
              style={{ fontFamily: 'var(--ap-font-body)' }}
            >
              {description || labels.description}
            </p>

            {submitted ? (
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="flex items-center justify-center gap-2 text-green-600"
              >
                <CheckCircle className="w-5 h-5" />
                <span>{already ? ALREADY_SUBSCRIBED[locale] ?? ALREADY_SUBSCRIBED.en : CONFIRM_PROMPT[locale] ?? CONFIRM_PROMPT.en}</span>
              </motion.div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-3">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={placeholder || labels.placeholder}
                  className="w-full px-4 py-3 ap-card border ap-line rounded-lg ap-ink ap-placeholder focus:outline-none focus:ring-2 transition-all"
                  style={{ borderRadius: theme?.borderRadius || '0.5rem' }}
                />
                {error && (
                  <p className="text-sm text-red-500">{error}</p>
                )}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 px-6 py-3 text-white font-semibold rounded-lg hover:opacity-90 disabled:opacity-50 transition-all"
                  style={{
                    backgroundColor: primaryColor,
                    borderRadius: theme?.borderRadius || '0.5rem'
                  }}
                >
                  {loading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      {button_text || labels.button}
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
                {statement}
              </form>
            )}
          </motion.div>
        </div>
      </section>
    );
  }

  // Inline layout (default)
  return (
    <section
      dir={isRTL ? 'rtl' : 'ltr'}
      className={`${styles?.padding || 'py-12 sm:py-16'} ${styles?.background || 'bg-gradient-to-r from-purple-600 to-pink-600'} ${className || ''}`}
    >
      <div className="max-w-4xl mx-auto px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center"
        >
          <h3
            className={`text-2xl sm:text-3xl font-bold mb-3 ${isGradientBg ? 'text-white' : 'ap-ink'}`}
            style={{ fontFamily: 'var(--ap-font-heading)' }}
          >
            {title || labels.title}
          </h3>

          <p
            className={`mb-8 ${isGradientBg ? 'text-white/80' : 'ap-ink-2'}`}
            style={{ fontFamily: 'var(--ap-font-body)' }}
          >
            {description || labels.description}
          </p>

          {submitted ? (
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className={`flex items-center justify-center gap-2 ${isGradientBg ? 'text-white' : 'text-green-600'}`}
            >
              <CheckCircle className="w-6 h-6" />
              <span className="text-lg font-medium">{already ? ALREADY_SUBSCRIBED[locale] ?? ALREADY_SUBSCRIBED.en : CONFIRM_PROMPT[locale] ?? CONFIRM_PROMPT.en}</span>
            </motion.div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 max-w-lg mx-auto">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={placeholder || labels.placeholder}
                className="flex-1 px-5 py-3 bg-white/10 backdrop-blur-sm border border-white/20 rounded-lg text-white placeholder:text-white/60 focus:outline-none focus:ring-2 focus:ring-white/30 transition-all"
                style={{ borderRadius: theme?.borderRadius || '0.5rem' }}
              />
              <button
                type="submit"
                disabled={loading}
                className="px-8 py-3 ap-card ap-ink font-semibold rounded-lg ap-hover disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                style={{ borderRadius: theme?.borderRadius || '0.5rem' }}
              >
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    {button_text || labels.button}
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          )}

          {!submitted && statement}

          {error && (
            <p className="mt-3 text-sm text-red-200">{error}</p>
          )}
        </motion.div>
      </div>
    </section>
  );
}
