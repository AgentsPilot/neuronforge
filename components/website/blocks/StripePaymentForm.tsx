'use client';

/**
 * Stripe Payment Form Component
 *
 * Embeds Stripe Elements (card input) for in-modal payment processing.
 * Handles PaymentIntent creation and confirmation.
 */

import { useState, useEffect } from 'react';
import { loadStripe, type Stripe, type StripeElements } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements
} from '@stripe/react-stripe-js';
import { Loader2, Lock, Shield, CreditCard, AlertCircle } from 'lucide-react';

// Load Stripe once at module level
let stripePromise: Promise<Stripe | null> | null = null;

function getStripe(publishableKey?: string, connectedAccountId?: string) {
  if (!publishableKey) {
    console.error('Stripe publishable key not provided');
    return null;
  }

  // Create a new promise if account changes or not initialized
  const options = connectedAccountId ? { stripeAccount: connectedAccountId } : undefined;
  stripePromise = loadStripe(publishableKey, options);
  return stripePromise;
}

// Localized labels
const LABELS = {
  en: {
    pay: 'Pay',
    processing: 'Processing...',
    securePayment: 'Secure payment',
    poweredByStripe: 'Powered by Stripe',
    paymentFailed: 'Payment failed',
    tryAgain: 'Please try again or use a different payment method.',
    cardDetails: 'Card Details',
    // A deferred plan takes no money today, so the button must not say "Pay".
    saveCard: 'Save card',
    firstChargeOn: 'First payment of {amount} on {date}',
    noChargeToday: 'Nothing is charged today.',
    saveFailed: 'Card could not be saved'
  },
  es: {
    pay: 'Pagar',
    processing: 'Procesando...',
    securePayment: 'Pago seguro',
    poweredByStripe: 'Procesado por Stripe',
    paymentFailed: 'Pago fallido',
    tryAgain: 'Por favor intenta de nuevo o usa otro metodo de pago.',
    cardDetails: 'Datos de Tarjeta',
    saveCard: 'Guardar tarjeta',
    firstChargeOn: 'Primer pago de {amount} el {date}',
    noChargeToday: 'Hoy no se cobra nada.',
    saveFailed: 'No se pudo guardar la tarjeta'
  },
  he: {
    pay: 'שלם',
    processing: 'מעבד...',
    securePayment: 'תשלום מאובטח',
    poweredByStripe: 'מופעל על ידי Stripe',
    paymentFailed: 'התשלום נכשל',
    tryAgain: 'נסה שוב או השתמש באמצעי תשלום אחר.',
    cardDetails: 'פרטי כרטיס',
    saveCard: 'שמירת כרטיס',
    firstChargeOn: 'תשלום ראשון של {amount} בתאריך {date}',
    noChargeToday: 'לא מחויב דבר היום.',
    saveFailed: 'לא ניתן היה לשמור את הכרטיס'
  }
};

interface PaymentFormProps {
  clientSecret: string;
  amount: number;
  currency: string;
  onSuccess: (paymentIntentId: string) => void;
  onError: (error: string) => void;
  primaryColor: string;
  locale?: 'en' | 'es' | 'he';
  isRTL?: boolean;
  borderRadius?: string;
  /**
   * What `clientSecret` is, and therefore which Stripe call confirms it.
   *
   * A payment plan whose first payment is deferred takes no money today: the
   * subscription runs a trial until the agreed date, so there is no invoice and
   * nothing to pay — only a card to store, carried by a SetupIntent.
   * `confirmPayment` on a SetupIntent secret fails at the final step of a
   * booking, so the kind is told to this form rather than guessed from the
   * secret's prefix.
   *
   * Defaults to 'payment', which is every existing caller.
   */
  intentKind?: 'payment' | 'setup';
  /** When the first payment will be taken. Shown instead of a charge today. */
  firstChargeAt?: string | null;
}

function PaymentForm({
  clientSecret,
  amount,
  currency,
  onSuccess,
  onError,
  primaryColor,
  locale = 'en',
  isRTL = false,
  borderRadius = '0.5rem',
  intentKind = 'payment',
  firstChargeAt = null
}: PaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const labels = LABELS[locale] || LABELS.en;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setProcessing(true);
    setErrorMessage(null);

    try {
      /*
       * Nothing is owed today, so there is no payment to confirm — only a card
       * to store against the trialling subscription Stripe will charge on the
       * agreed date. `onSuccess` receives the SetupIntent id in place of a
       * PaymentIntent id; the caller records the booking either way, and the
       * money arrives through `invoice.paid` when the trial ends.
       */
      if (intentKind === 'setup') {
        const { error: setupError, setupIntent } = await stripe.confirmSetup({
          elements,
          confirmParams: { return_url: window.location.href },
          redirect: 'if_required'
        });

        if (setupError) {
          setErrorMessage(setupError.message || labels.saveFailed);
          onError(setupError.message || labels.saveFailed);
        } else if (setupIntent && setupIntent.status === 'succeeded') {
          onSuccess(setupIntent.id);
        } else {
          // Never claim a saved card we have no confirmation of: the plan
          // would read as set up and then collect nothing on the day.
          setErrorMessage(labels.saveFailed);
          onError(labels.saveFailed);
        }

        return;
      }

      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: window.location.href, // Not used, but required
        },
        redirect: 'if_required'
      });

      if (error) {
        setErrorMessage(error.message || labels.paymentFailed);
        onError(error.message || labels.paymentFailed);
      } else if (paymentIntent && paymentIntent.status === 'succeeded') {
        onSuccess(paymentIntent.id);
      } else if (paymentIntent && paymentIntent.status === 'requires_action') {
        // Handle 3D Secure or other actions
        const { error: confirmError } = await stripe.confirmPayment({
          clientSecret,
          confirmParams: {
            return_url: window.location.href,
          },
          redirect: 'if_required'
        });

        if (confirmError) {
          setErrorMessage(confirmError.message || labels.paymentFailed);
          onError(confirmError.message || labels.paymentFailed);
        } else {
          onSuccess(paymentIntent.id);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : labels.paymentFailed;
      setErrorMessage(message);
      onError(message);
    } finally {
      setProcessing(false);
    }
  };

  const formatAmount = (amount: number, currency: string) => {
    return new Intl.NumberFormat(locale === 'he' ? 'he-IL' : locale === 'es' ? 'es-ES' : 'en-US', {
      style: 'currency',
      currency: currency.toUpperCase()
    }).format(amount);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Card input label */}
      <div className="text-sm font-medium ap-ink-2 mb-2">
        {labels.cardDetails}
      </div>

      {/* Stripe Payment Element */}
      <div
        className="p-4 border ap-line ap-card"
        style={{ borderRadius }}
      >
        <PaymentElement
          options={{
            layout: 'tabs',
          }}
        />
      </div>

      {/* Error message */}
      {errorMessage && (
        <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-700 dark:text-red-400">
              {labels.paymentFailed}
            </p>
            <p className="text-sm text-red-600 dark:text-red-300">
              {errorMessage}
            </p>
          </div>
        </div>
      )}

      {/* Submit button */}
      <button
        type="submit"
        disabled={!stripe || !elements || processing}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 text-white font-medium rounded-lg transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ backgroundColor: primaryColor, borderRadius }}
      >
        {processing ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            {labels.processing}
          </>
        ) : (
          <>
            <CreditCard className="w-5 h-5" />
            {/*
              "Pay ₪100" beside a plan that charges nothing today is simply
              untrue, and it is the sentence a client would hold us to.
            */}
            {intentKind === 'setup' ? labels.saveCard : `${labels.pay} ${formatAmount(amount, currency)}`}
          </>
        )}
      </button>

      {/* What happens instead of a charge today, and when. */}
      {intentKind === 'setup' && (
        <p className="text-sm text-center ap-ink-3">
          {labels.noChargeToday}
          {firstChargeAt && amount > 0 && (
            <>
              {' '}
              {labels.firstChargeOn
                .replace('{amount}', formatAmount(amount, currency))
                .replace(
                  '{date}',
                  new Date(firstChargeAt).toLocaleDateString(
                    locale === 'he' ? 'he-IL' : locale === 'es' ? 'es-ES' : 'en-US',
                    { year: 'numeric', month: 'short', day: 'numeric' }
                  )
                )}
            </>
          )}
        </p>
      )}

      {/* Security badges */}
      <div className="flex items-center justify-center gap-4 text-sm ap-ink-3">
        <div className="flex items-center gap-1">
          <Lock className="w-4 h-4" />
          <span>{labels.securePayment}</span>
        </div>
        <div className="flex items-center gap-1">
          <Shield className="w-4 h-4" />
          <span>{labels.poweredByStripe}</span>
        </div>
      </div>
    </form>
  );
}

// Main exported component that wraps PaymentForm with Elements provider
interface StripePaymentFormProps {
  publishableKey: string;
  clientSecret: string;
  connectedAccountId?: string;
  amount: number;
  currency: string;
  onSuccess: (paymentIntentId: string) => void;
  onError: (error: string) => void;
  primaryColor: string;
  locale?: 'en' | 'es' | 'he';
  isRTL?: boolean;
  borderRadius?: string;
  /** Passed straight through — see `PaymentFormProps.intentKind`. */
  intentKind?: 'payment' | 'setup';
  firstChargeAt?: string | null;
}

export function StripePaymentForm({
  publishableKey,
  clientSecret,
  connectedAccountId,
  amount,
  currency,
  onSuccess,
  onError,
  primaryColor,
  locale = 'en',
  isRTL = false,
  borderRadius = '0.5rem',
  intentKind = 'payment',
  firstChargeAt = null
}: StripePaymentFormProps) {
  // Same table the inner form uses; needed here for the failure state below.
  const labels = LABELS[locale] || LABELS.en;
  const [stripeLoaded, setStripeLoaded] = useState(false);
  const [stripeInstance, setStripeInstance] = useState<Stripe | null>(null);

  useEffect(() => {
    const loadStripeInstance = async () => {
      const stripe = await getStripe(publishableKey, connectedAccountId);
      setStripeInstance(stripe);
      setStripeLoaded(true);
    };
    loadStripeInstance();
  }, [publishableKey, connectedAccountId]);

  // Still loading Stripe.js.
  if (!stripeLoaded) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin ap-ink-3" />
      </div>
    );
  }

  /*
   * Loaded, but there is no Stripe to show.
   *
   * `getStripe` returns null without a publishable key, and `loadStripe`
   * resolves null when Stripe.js cannot be fetched at all — a blocked script, a
   * failed network. Both left `stripeLoaded` true and `stripeInstance` null,
   * and the single guard that used to be here spun on that forever: no form, no
   * message, and the only trace a `console.error` the client never sees.
   */
  if (!stripeInstance) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <AlertCircle className="w-6 h-6 text-red-500" />
        <p className="text-sm font-medium ap-ink">{labels.paymentFailed}</p>
        <p className="text-xs ap-ink-3">{labels.tryAgain}</p>
      </div>
    );
  }

  const appearance = {
    theme: 'stripe' as const,
    variables: {
      colorPrimary: primaryColor,
      borderRadius: borderRadius,
    }
  };

  return (
    <Elements
      stripe={stripeInstance}
      options={{
        clientSecret,
        appearance,
        locale: locale === 'he' ? 'he' : locale === 'es' ? 'es' : 'en'
      }}
    >
      <PaymentForm
        clientSecret={clientSecret}
        amount={amount}
        currency={currency}
        onSuccess={onSuccess}
        onError={onError}
        primaryColor={primaryColor}
        locale={locale}
        isRTL={isRTL}
        borderRadius={borderRadius}
        intentKind={intentKind}
        firstChargeAt={firstChargeAt}
      />
    </Elements>
  );
}
