'use client';

import { useEffect, useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { createLogger } from '@/lib/logger';
import { useLanguage } from '@/lib/business-os/LanguageContext';

const logger = createLogger({ module: 'StripeConnectOnboarding' });

interface Props {
  onboardingUrl: string;
  onComplete: () => void;
  onCancel: () => void;
}

/**
 * Embedded Stripe Connect Onboarding
 * Uses iframe to keep user inside the platform while completing Stripe setup
 */
export function StripeConnectOnboarding({ onboardingUrl, onComplete, onCancel }: Props) {
  const { t, isRTL } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<'loading' | 'onboarding' | 'success' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Listen for messages from Stripe iframe
    const handleMessage = (event: MessageEvent) => {
      // Only accept messages from Stripe
      if (!event.origin.includes('stripe.com')) {
        return;
      }

      logger.info({ type: event.data?.type }, 'Stripe iframe message received');

      // Handle different Stripe events
      if (event.data?.type === 'stripe-onboarding-complete') {
        setStatus('success');
        // Poll backend to verify account is ready
        startPollingAccountStatus();
      } else if (event.data?.type === 'stripe-onboarding-error') {
        setStatus('error');
        setErrorMessage(event.data?.error?.message || 'Onboarding failed');
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  const startPollingAccountStatus = () => {
    let attempts = 0;
    const maxAttempts = 10;

    pollIntervalRef.current = setInterval(async () => {
      attempts++;

      try {
        const response = await fetch('/api/payments/stripe-connect/refresh-status', {
          method: 'POST',
        });
        const result = await response.json();

        if (result.success && result.account?.onboarding_completed) {
          // Success! Account is ready
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
          }

          // Wait a moment to show success state
          setTimeout(() => {
            onComplete();
          }, 1500);
        } else if (attempts >= maxAttempts) {
          // Max attempts reached
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
          }
          setStatus('error');
          setErrorMessage('Account setup is taking longer than expected. Please refresh the page.');
        }
      } catch (error) {
        logger.error({ err: error }, 'Failed to poll account status');
        if (attempts >= maxAttempts && pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          setStatus('error');
          setErrorMessage('Failed to verify account setup');
        }
      }
    }, 2000); // Poll every 2 seconds
  };

  const handleIframeLoad = () => {
    setLoading(false);
    setStatus('onboarding');
  };

  return (
    <Dialog open onOpenChange={() => status !== 'loading' && onCancel()}>
      <DialogContent
        className="max-w-4xl h-[80vh] p-0 overflow-hidden"
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        <DialogHeader className="p-6 pb-4 border-b border-[var(--v2-border)]">
          <DialogTitle className="text-xl">
            {status === 'success'
              ? t('payments.stripe.onboarding_success') || 'Setup Complete!'
              : status === 'error'
              ? t('payments.stripe.onboarding_error') || 'Setup Error'
              : t('payments.stripe.onboarding_title') || 'Complete Your Stripe Setup'
            }
          </DialogTitle>
        </DialogHeader>

        <div className="relative w-full h-full">
          {/* Loading state */}
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-[var(--v2-surface)]">
              <div className="text-center space-y-4">
                <Loader2 className="w-12 h-12 animate-spin text-[#635BFF] mx-auto" />
                <p className="text-[var(--v2-text-secondary)]">
                  {t('payments.stripe.loading_onboarding') || 'Loading Stripe setup...'}
                </p>
              </div>
            </div>
          )}

          {/* Success state */}
          {status === 'success' && (
            <div className="absolute inset-0 flex items-center justify-center bg-[var(--v2-surface)]">
              <div className="text-center space-y-4">
                <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-10 h-10 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
                    {t('payments.stripe.setup_complete') || 'Setup Complete!'}
                  </h3>
                  <p className="text-sm text-[var(--v2-text-secondary)] mt-2">
                    {t('payments.stripe.setup_complete_desc') || 'Your Stripe account is ready to accept payments'}
                  </p>
                </div>
                <Loader2 className="w-6 h-6 animate-spin text-[var(--v2-text-muted)] mx-auto" />
              </div>
            </div>
          )}

          {/* Error state */}
          {status === 'error' && (
            <div className="absolute inset-0 flex items-center justify-center bg-[var(--v2-surface)] p-6">
              <div className="text-center space-y-4 max-w-md">
                <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mx-auto">
                  <XCircle className="w-10 h-10 text-red-600 dark:text-red-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
                    {t('payments.stripe.setup_error') || 'Setup Error'}
                  </h3>
                  <p className="text-sm text-[var(--v2-text-secondary)] mt-2">
                    {errorMessage || t('payments.stripe.setup_error_desc') || 'Something went wrong during setup'}
                  </p>
                </div>
                <button
                  onClick={onCancel}
                  className="px-4 py-2 text-sm font-medium text-white rounded-lg"
                  style={{ background: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)' }}
                >
                  {t('common.close') || 'Close'}
                </button>
              </div>
            </div>
          )}

          {/* Stripe iframe */}
          <iframe
            ref={iframeRef}
            src={onboardingUrl}
            onLoad={handleIframeLoad}
            className={`w-full h-full border-0 ${loading ? 'opacity-0' : 'opacity-100'}`}
            title="Stripe Connect Onboarding"
            allow="payment"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
