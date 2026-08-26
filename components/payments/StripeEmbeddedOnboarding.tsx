'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { loadConnectAndInitialize } from '@stripe/connect-js';
import { Loader2, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'StripeEmbeddedOnboarding' });

interface StripeEmbeddedOnboardingProps {
  onComplete: () => void;
  onExit?: () => void;
}

type OnboardingStatus = 'loading' | 'ready' | 'error' | 'complete';

/**
 * Stripe Connect Embedded Onboarding Component
 *
 * Uses Stripe's Connect embedded components to show the onboarding form
 * directly within our dialog, providing a seamless experience.
 */
export function StripeEmbeddedOnboarding({ onComplete, onExit }: StripeEmbeddedOnboardingProps) {
  const { t, language } = useLanguage();
  const [status, setStatus] = useState<OnboardingStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Store callbacks in refs to avoid re-running effect
  const onCompleteRef = useRef(onComplete);
  const onExitRef = useRef(onExit);
  useEffect(() => {
    onCompleteRef.current = onComplete;
    onExitRef.current = onExit;
  }, [onComplete, onExit]);

  // Initialize Stripe Connect
  useEffect(() => {
    // Only initialize once per language
    if (initializedRef.current) return;

    // Don't initialize until we have a definite language (not just default)
    if (!language) return;

    initializedRef.current = true;

    const initializeStripeConnect = async () => {
      const container = containerRef.current;
      if (!container) {
        logger.error('Container ref not available');
        setError('Container not available');
        setStatus('error');
        return;
      }

      try {
        const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
        if (!publishableKey) {
          throw new Error('Stripe publishable key not configured');
        }

        logger.info('Initializing Stripe Connect embedded onboarding');

        // Fetch client secret from our API
        const fetchClientSecret = async (): Promise<string> => {
          const response = await fetch('/api/payments/stripe-connect/account-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          });

          const result = await response.json();

          if (!result.success || !result.clientSecret) {
            throw new Error(result.error || 'Failed to create account session');
          }

          return result.clientSecret;
        };

        // Map our language to Stripe locale codes
        // Stripe supports: ar, bg, cs, da, de, el, en, es, et, fi, fil, fr, hr, hu, id, it, ja, ko, lt, lv, ms, mt, nb, nl, pl, pt, ro, ru, sk, sl, sv, th, tr, vi, zh, zh-HK, zh-TW
        // Also supports region variants like es-419 (Latin American Spanish), en-GB, etc.
        const stripeLocale = language === 'he' ? 'he' : language === 'es' ? 'es' : 'en';

        logger.info({ language, stripeLocale }, 'Initializing Stripe Connect with locale');

        // Initialize Stripe Connect
        const stripeConnectInstance = loadConnectAndInitialize({
          publishableKey,
          fetchClientSecret,
          appearance: {
            overlays: 'dialog',
            variables: {
              colorPrimary: '#635BFF',
              colorBackground: '#ffffff',
              colorText: '#1a1a1a',
              colorDanger: '#df1b41',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              fontSizeBase: '14px',
              spacingUnit: '4px',
              borderRadius: '8px',
            },
          },
          locale: stripeLocale,
        });

        // Create the account onboarding component (returns a custom HTML element)
        const onboardingComponent = stripeConnectInstance.create('account-onboarding');

        // Listen for exit - the event listener is set via setOnExit if available
        if (typeof onboardingComponent.setOnExit === 'function') {
          onboardingComponent.setOnExit(() => {
            logger.info('User exited onboarding');
            onExitRef.current?.();
          });
        }

        // Mount the component using DOM appendChild (not .mount())
        container.innerHTML = '';
        container.appendChild(onboardingComponent);

        setStatus('ready');
        logger.info('Stripe embedded onboarding mounted successfully');

        // Poll for completion status
        const checkCompletion = async () => {
          try {
            const response = await fetch('/api/payments/stripe-connect/refresh-status', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
            });
            const result = await response.json();

            // Consider onboarding complete if:
            // 1. Full completion (charges AND payouts enabled), OR
            // 2. Details submitted AND charges enabled (payouts may take longer)
            const isComplete = result.success && (
              result.data?.onboarding_completed ||
              (result.data?.details_submitted && result.data?.charges_enabled)
            );

            if (isComplete) {
              logger.info({ data: result.data }, 'Stripe onboarding detected as complete');
              setStatus('complete');
              if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
              }
              setTimeout(() => onCompleteRef.current(), 1500);
            }
          } catch (err) {
            // Ignore errors in polling
          }
        };

        // Check completion every 5 seconds
        pollIntervalRef.current = setInterval(checkCompletion, 5000);

      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to load onboarding';
        logger.error({ err }, 'Failed to initialize Stripe embedded onboarding');
        setError(errorMessage);
        setStatus('error');
      }
    };

    initializeStripeConnect();

    // Cleanup
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [language]); // Only re-run if language changes

  // Retry handler
  const handleRetry = useCallback(() => {
    initializedRef.current = false;
    setStatus('loading');
    setError(null);
    // Force re-mount by updating a key or re-running effect
    // Since we can't easily re-trigger useEffect, we'll reload the component
    window.location.reload();
  }, []);

  // Error state
  if (status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-4">
        <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
          <AlertCircle className="w-8 h-8 text-red-600 dark:text-red-400" />
        </div>
        <div className="text-center">
          <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
            {t('payments.stripe.embedded.error_title') || 'Failed to Load'}
          </h3>
          <p className="text-sm text-[var(--v2-text-muted)] mt-1 max-w-sm">
            {error || t('payments.stripe.embedded.error_desc') || 'Unable to load the payment setup form.'}
          </p>
        </div>
        <Button
          onClick={handleRetry}
          variant="outline"
          className="gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          {t('common.try_again') || 'Try Again'}
        </Button>
      </div>
    );
  }

  // Complete state
  if (status === 'complete') {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-4">
        <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
          <CheckCircle2 className="w-8 h-8 text-green-600 dark:text-green-400" />
        </div>
        <div className="text-center">
          <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
            {t('payments.stripe.embedded.complete_title') || 'Setup Complete!'}
          </h3>
          <p className="text-sm text-[var(--v2-text-muted)] mt-1">
            {t('payments.stripe.embedded.complete_desc') || 'Your payment account is ready.'}
          </p>
        </div>
      </div>
    );
  }

  // Loading or Ready state
  return (
    <div className="stripe-embedded-onboarding">
      {/* Loading overlay */}
      {status === 'loading' && (
        <div className="flex flex-col items-center justify-center py-16 space-y-4">
          <Loader2 className="w-10 h-10 animate-spin text-[#635BFF]" />
          <p className="text-[var(--v2-text-muted)]">
            {t('payments.stripe.embedded.loading') || 'Loading payment setup...'}
          </p>
        </div>
      )}

      {/* The Stripe component will be mounted here - always rendered but hidden during loading */}
      <div
        ref={containerRef}
        className="min-h-[400px] w-full"
        style={{
          display: status === 'loading' ? 'none' : 'block',
        }}
      />

      <style jsx global>{`
        /* Custom styles for Stripe Connect embedded components */
        .stripe-embedded-onboarding {
          /* Ensure the embedded component respects our theme */
        }

        /* Override Stripe's default styles to match our design */
        stripe-connect-account-onboarding {
          display: block;
          width: 100%;
        }
      `}</style>
    </div>
  );
}
