'use client';

/**
 * PaymentCheckoutButton
 *
 * A button component that initiates payment collection via any connected processor.
 * Supports invoices, bookings, and installments.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CreditCard, Loader2, ExternalLink } from 'lucide-react';

interface PaymentCheckoutButtonProps {
  invoiceId?: string;
  bookingId?: string;
  installmentId?: string;
  amount?: number;
  currency?: string;
  onSuccess?: (sessionId: string, checkoutUrl: string) => void;
  onError?: (error: string) => void;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'default' | 'sm' | 'lg';
  className?: string;
  children?: React.ReactNode;
  disabled?: boolean;
}

export function PaymentCheckoutButton({
  invoiceId,
  bookingId,
  installmentId,
  amount,
  currency = 'USD',
  onSuccess,
  onError,
  variant = 'default',
  size = 'default',
  className,
  children,
  disabled
}: PaymentCheckoutButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);

    try {
      const response = await fetch('/api/payments/blocks/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          block_id: 'collect_payment',
          parameters: {
            invoice_id: invoiceId,
            booking_id: bookingId,
            installment_id: installmentId,
            amount,
            currency,
            success_url: `${window.location.origin}/payments/success`,
            cancel_url: `${window.location.origin}/payments/cancelled`
          }
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to create checkout session');
      }

      const { sessionId, checkoutUrl } = data.result;

      onSuccess?.(sessionId, checkoutUrl);

      // Redirect to checkout
      if (checkoutUrl) {
        window.location.href = checkoutUrl;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Payment failed';
      onError?.(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      onClick={handleClick}
      disabled={disabled || loading}
    >
      {loading ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Processing...
        </>
      ) : (
        <>
          {children || (
            <>
              <CreditCard className="mr-2 h-4 w-4" />
              Pay Now
              <ExternalLink className="ml-2 h-3 w-3" />
            </>
          )}
        </>
      )}
    </Button>
  );
}
