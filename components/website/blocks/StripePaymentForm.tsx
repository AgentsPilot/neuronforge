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
    cardDetails: 'Card Details'
  },
  es: {
    pay: 'Pagar',
    processing: 'Procesando...',
    securePayment: 'Pago seguro',
    poweredByStripe: 'Procesado por Stripe',
    paymentFailed: 'Pago fallido',
    tryAgain: 'Por favor intenta de nuevo o usa otro metodo de pago.',
    cardDetails: 'Datos de Tarjeta'
  },
  he: {
    pay: 'שלם',
    processing: 'מעבד...',
    securePayment: 'תשלום מאובטח',
    poweredByStripe: 'מופעל על ידי Stripe',
    paymentFailed: 'התשלום נכשל',
    tryAgain: 'נסה שוב או השתמש באמצעי תשלום אחר.',
    cardDetails: 'פרטי כרטיס'
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
  borderRadius = '0.5rem'
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
      <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
        {labels.cardDetails}
      </div>

      {/* Stripe Payment Element */}
      <div
        className="p-4 border border-gray-200 dark:border-gray-600 bg-white dark:bg-slate-800"
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
            {labels.pay} {formatAmount(amount, currency)}
          </>
        )}
      </button>

      {/* Security badges */}
      <div className="flex items-center justify-center gap-4 text-sm text-gray-500 dark:text-gray-400">
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
  borderRadius = '0.5rem'
}: StripePaymentFormProps) {
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

  if (!stripeLoaded || !stripeInstance) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
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
      />
    </Elements>
  );
}
