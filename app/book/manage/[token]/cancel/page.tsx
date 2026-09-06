'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { X } from 'lucide-react';

import { AppointmentCard, type PublicBookingSummary } from '@/components/public/AppointmentCard';
import { BrandButton } from '@/components/public/BrandButton';
import { PublicPageSpinner } from '@/components/public/PublicSpinner';
import { PublicShell } from '@/components/public/PublicShell';
import { StatusCard } from '@/components/public/StatusCard';
import { useOptionalPublicBrand } from '@/components/public/PublicBrandProvider';
import { createPublicT } from '@/lib/i18n/public-pages';

interface BookingData extends PublicBookingSummary {
  id: string;
  clientName: string;
  status: string;
  canCancel: boolean;
  hoursUntilBooking: number;
}

/**
 * Cancelling an appointment.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This page was the worst regression on the public surface. It shared its shell
 * with the booking hub one click away, but none of its care: no translations at
 * all, no `dir` attribute, and `toLocaleDateString('en-US')` with a 12-hour
 * clock. A Hebrew client pressed "ביטול הפגישה" and landed on a left-aligned
 * English screen that printed `2:30 PM` for the appointment the previous page
 * had just shown them as `14:30`.
 *
 * It also ended in nothing. A client who cancelled saw a confirmation and no
 * way forward, on the one screen where the business most wants to offer one —
 * so the success state now leads with rebooking.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function CancelBookingPage() {
  const params = useParams();
  const token = params.token as string;
  const brand = useOptionalPublicBrand();

  const [booking, setBooking] = useState<BookingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const locale = brand?.locale ?? 'en';
  const t = createPublicT(locale);

  useEffect(() => {
    fetch(`/api/book/manage/${token}`)
      .then(res => res.json())
      .then(data => {
        if (data.success) setBooking(data.booking);
        else setError(data.error || t('bookingNotFoundDesc'));
      })
      .catch(() => setError(t('bookingNotFoundDesc')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleCancel = async () => {
    setCancelling(true);
    setError(null);

    try {
      const response = await fetch(`/api/book/manage/${token}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      });
      const data = await response.json();

      if (data.success) setCancelled(true);
      else setError(data.error || t('cancelFailed'));
    } catch {
      setError(t('cancelFailed'));
    } finally {
      setCancelling(false);
    }
  };

  if (loading) return <PublicPageSpinner label={t('loading')} />;

  if (!brand || (error && !booking)) {
    return (
      <div style={{ background: 'var(--ap-bg)' }}>
        <StatusCard
          standalone
          tone="error"
          title={t('bookingNotFound')}
          description={error ?? t('bookingNotFoundDesc')}
          actions={
            <BrandButton href={`/book/manage/${token}`} variant="ghost">
              {t('backToBooking')}
            </BrandButton>
          }
        />
      </div>
    );
  }

  if (cancelled) {
    return (
      <PublicShell brand={brand} width="narrow" header={{ compact: true }}>
        <StatusCard
          standalone
          tone="success"
          title={t('cancelledTitle')}
          description={t('cancelledDesc')}
          actions={
            // A cancellation used to be a dead end. Rebooking is the outcome
            // the business actually wants from this screen.
            brand.info.bookingUrl ? (
              <BrandButton href={brand.info.bookingUrl} size="lg" fullWidth>
                {t('bookAgain')}
              </BrandButton>
            ) : undefined
          }
        />
      </PublicShell>
    );
  }

  if (!booking) return null;

  const alreadyCancelled = booking.status === 'cancelled';

  return (
    <PublicShell
      brand={brand}
      width="narrow"
      header={{
        compact: true,
        backHref: `/book/manage/${token}`,
        backLabel: t('backToBooking'),
      }}
    >
      <div className="space-y-4">
        <h1
          className="text-xl font-bold"
          style={{ color: 'var(--ap-text)', fontFamily: 'var(--ap-font-heading)' }}
        >
          {t('cancelTitle')}
        </h1>

        <AppointmentCard booking={booking} brand={brand} variant="summary" />

        {alreadyCancelled ? (
          <StatusCard tone="info" title={t('cancelledTitle')} description={t('cancelledDesc')} />
        ) : !booking.canCancel ? (
          <StatusCard tone="info" title={t('cannotCancel')} description={t('cannotModify')} />
        ) : (
          <>
            <StatusCard tone="warning" title={t('cancelConfirm')} description={t('cancelWarning')} />

            <div>
              <label
                htmlFor="cancel-reason"
                className="mb-1.5 block text-sm font-medium"
                style={{ color: 'var(--ap-text)' }}
              >
                {t('cancelReason')}
              </label>
              <textarea
                id="cancel-reason"
                value={reason}
                onChange={e => setReason(e.target.value)}
                rows={3}
                placeholder={t('cancelReasonPlaceholder')}
                className="w-full px-3 py-2.5 text-sm outline-none transition-colors"
                style={{
                  background: 'var(--ap-surface)',
                  border: '1px solid var(--ap-border)',
                  borderRadius: 'var(--ap-radius-md)',
                  color: 'var(--ap-text)',
                }}
              />
            </div>

            {error && <StatusCard tone="error" title={error} />}

            <div className="space-y-2">
              <BrandButton
                variant="danger"
                size="lg"
                fullWidth
                loading={cancelling}
                onClick={handleCancel}
              >
                {!cancelling && <X className="h-4 w-4" aria-hidden />}
                {cancelling ? t('cancelling') : t('confirmCancel')}
              </BrandButton>

              <BrandButton href={`/book/manage/${token}`} variant="secondary" fullWidth>
                {t('keepAppointment')}
              </BrandButton>
            </div>
          </>
        )}
      </div>
    </PublicShell>
  );
}
