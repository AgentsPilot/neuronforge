'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { CreditCard, Loader2, Shield, Lock } from 'lucide-react';
import type { BlockRendererProps, CapabilityConfig } from './types';

interface PaymentButtonContent {
  text?: string;
  amount?: number;
  currency?: string;
  description?: string;
  capability_integration?: string;
  payment_type?: 'one_time' | 'subscription';
  price_id?: string;
  product_id?: string;
  success_url?: string;
  cancel_url?: string;
}

// Localized labels
const LABELS = {
  en: {
    pay: 'Pay Now',
    processing: 'Processing...',
    secure: 'Secure payment',
    poweredBy: 'Powered by Stripe',
    // Never names the business's payment configuration — that is the owner's
    // concern, not their client's.
    unavailable: 'Payment is unavailable right now. Please try again shortly.'
  },
  es: {
    pay: 'Pagar Ahora',
    processing: 'Procesando...',
    secure: 'Pago seguro',
    poweredBy: 'Desarrollado por Stripe',
    unavailable: 'El pago no está disponible ahora. Inténtalo de nuevo en unos minutos.'
  },
  he: {
    pay: 'שלם עכשיו',
    processing: '...מעבד',
    secure: 'תשלום מאובטח',
    poweredBy: 'מופעל על ידי Stripe',
    unavailable: 'התשלום אינו זמין כרגע. נסו שוב בעוד מספר דקות.'
  }
};

export function PaymentButtonBlock({ content, styles, theme, locale, isRTL, className, subdomain }: BlockRendererProps) {
  const {
    text,
    amount,
    currency = 'USD',
    description,
    payment_type = 'one_time',
    price_id,
    success_url,
    cancel_url
  } = content as PaymentButtonContent;

  const labels = LABELS[locale] || LABELS.en;
  const primaryColor = theme?.colors.primary || '#4F6EF7';
  const [loading, setLoading] = useState(false);

  const formatAmount = (amount: number, currency: string) => {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency.toUpperCase()
    }).format(amount);
  };

  const [error, setError] = useState<string | null>(null);

  /**
   * This button has never worked, for anyone.
   *
   * It posted to `/api/payments/create-checkout`, whose schema requires
   * `subdomain`, `customer_name` and `customer_email` — none of which it sent,
   * and the last two of which a bare Pay button cannot know: nobody has typed a
   * name at this point. So every click returned 400. It then read `data.url`
   * while the route returns `checkout_url`, so even a success would have gone
   * nowhere. And the failure branch was a bare `setLoading(false)`, which looks
   * exactly like nothing happening.
   *
   * `/api/website/checkout` is the route built for public-site payments: it
   * resolves the business from the subdomain and asks for no customer identity.
   * It is also the one the booking widgets use, so a site now has one payment
   * path rather than two.
   */
  const handlePayment = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/website/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subdomain,
          amount,
          currency,
          description: description || 'Payment',
          success_url: success_url || `${window.location.origin}/payment/success`,
          cancel_url: cancel_url || window.location.href
        })
      });

      const data = await response.json();

      if (data.success && data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }

      // Said out loud. A button that silently stops spinning is
      // indistinguishable from a button that does nothing — which is what this
      // was. The business's payment configuration is never named here.
      setError(labels.unavailable);
      setLoading(false);
    } catch {
      setError(labels.unavailable);
      setLoading(false);
    }
  };

  return (
    <section
      dir={isRTL ? 'rtl' : 'ltr'}
      className={`${styles?.padding || 'py-8 sm:py-12'} ${className || ''}`}
    >
      <div className="max-w-lg mx-auto px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 sm:p-8 text-center"
          style={{ borderRadius: theme?.borderRadius || '1rem' }}
        >
          {description && (
            <p
              className="text-gray-600 dark:text-gray-300 mb-4"
              style={{ fontFamily: 'var(--website-font-body)' }}
            >
              {description}
            </p>
          )}

          {amount && (
            <p
              className="text-4xl font-bold text-gray-900 dark:text-white mb-6"
              style={{ fontFamily: 'var(--website-font-heading)' }}
            >
              {formatAmount(amount, currency)}
              {payment_type === 'subscription' && (
                <span className="text-base font-normal text-gray-500">/month</span>
              )}
            </p>
          )}

          <button
            onClick={handlePayment}
            disabled={loading}
            className={`w-full flex items-center justify-center gap-3 px-8 py-4 text-lg font-semibold text-white rounded-lg shadow-lg disabled:opacity-70 transition-all ${
              styles?.button_color || ''
            }`}
            style={{
              backgroundColor: styles?.button_color ? undefined : primaryColor,
              borderRadius: theme?.borderRadius || '0.5rem'
            }}
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                {labels.processing}
              </>
            ) : (
              <>
                <CreditCard className="w-5 h-5" />
                {text || labels.pay}
              </>
            )}
          </button>

          {/* The failure, said. It used to be a bare `setLoading(false)` — a
              button that stops spinning and does nothing, which reads as a
              broken page rather than a payment that could not start. */}
          {error && (
            <p className="mt-4 text-sm text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          )}

          {/* Security badges */}
          <div className="mt-6 flex items-center justify-center gap-4 text-sm text-gray-500 dark:text-gray-400">
            <div className="flex items-center gap-1">
              <Lock className="w-4 h-4" />
              <span>{labels.secure}</span>
            </div>
            <div className="flex items-center gap-1">
              <Shield className="w-4 h-4" />
              <span>{labels.poweredBy}</span>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
