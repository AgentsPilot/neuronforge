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
/*
 * The client's list — the SHORT one, from the shared namespace.
 *
 * Somebody who came here to cancel an appointment is not filling in a form. The
 * owner's list is longer because the owner sees more; offering it here would get
 * its first item clicked.
 */
import { CLIENT_CANCEL_REASONS, type ClientCancelReason } from '@/lib/business-os/cancellationReasons';

interface BookingData extends PublicBookingSummary {
  id: string;
  clientName: string;
  status: string;
  canCancel: boolean;
  /** Null for a product purchase — there is no appointment to count down to. */
  hoursUntilBooking: number | null;
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
  /**
   * The refusal's CODE, kept beside its sentence.
   *
   * "Too late to cancel" is the only error on this page that is not the end of
   * the road — the business can still do it — so the page has to be able to
   * tell it apart and offer the way through.
   */
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  /*
   * NOTHING PRESELECTED, and the confirm button is gated on it.
   *
   * The reason is mandatory now, and a mandatory picker that opens on its first
   * item makes that item the most common reason in the data forever. The public
   * quote page shipped exactly that mistake — its decline picker defaulted to
   * `too_expensive` with no gate — so every client who declined without looking
   * recorded "too expensive".
   */
  const [reasonCode, setReasonCode] = useState<ClientCancelReason | ''>('');

  const locale = brand?.locale ?? 'en';
  const t = createPublicT(locale);

  /**
   * Why a cancellation was refused, in the reader's language.
   *
   * The mirror of the one on the reschedule page: the route sends a code and
   * the hours behind it, and the sentence is written here where the dictionary
   * lives. An unrecognised code reads as "something went wrong" in the right
   * language rather than leaking the server's English.
   */
  const cancelErrorText = (data: { code?: string; hours?: number }): string => {
    switch (data.code) {
      case 'too_late':
        return t('cancelTooLate', { hours: String(data.hours ?? 24) });
      case 'not_found':
        return t('bookingNotFoundDesc');
      case 'invalid_link':
        return t('invalidLink');
      case 'not_cancellable':
        return t('notCancellable');
      default:
        return t('cancelFailed');
    }
  };

  useEffect(() => {
    fetch(`/api/book/manage/${token}`)
      .then(res => res.json())
      .then(data => {
        if (data.success) setBooking(data.booking);
        else {
          setErrorCode(data.code ?? null);
          setError(cancelErrorText(data));
        }
      })
      .catch(() => setError(t('bookingNotFoundDesc')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleCancel = async () => {
    // Mandatory. The button is disabled without one; this stops a stray call too.
    if (!reasonCode) return;
    setCancelling(true);
    setError(null);

    try {
      const response = await fetch(`/api/book/manage/${token}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason_code: reasonCode,
          reason: reason.trim() || undefined,
        }),
      });
      const data = await response.json();

      if (data.success) setCancelled(true);
      else setError(cancelErrorText(data));
    } catch {
      setErrorCode(null);
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
              <p className="mb-1.5 text-sm font-medium" style={{ color: 'var(--ap-text)' }}>
                {t('cancelReasonWhy')}
              </p>
              {/*
                Radios, not a dropdown. Five options on a phone are faster to tap
                than to open, and the whole list being visible is what stops the
                first one being chosen by default.
              */}
              <div className="mb-4 space-y-2">
                {CLIENT_CANCEL_REASONS.map(value => (
                  <label
                    key={value}
                    className="flex cursor-pointer items-center gap-2.5 px-3 py-2.5 text-sm"
                    style={{
                      color: 'var(--ap-text)',
                      borderRadius: 'var(--ap-radius-md)',
                      // Tinted as well as outlined: a 1px border change is easy
                      // to miss on a phone, and this is the answer being sent.
                      border: `1px solid ${reasonCode === value ? 'var(--ap-brand)' : 'var(--ap-border)'}`,
                      background: reasonCode === value ? 'var(--ap-brand-tint)' : 'transparent',
                    }}
                  >
                    <input
                      type="radio"
                      name="cancel-reason-code"
                      checked={reasonCode === value}
                      onChange={() => setReasonCode(value)}
                      className="h-3.5 w-3.5"
                      style={{ accentColor: 'var(--ap-brand)' }}
                    />
                    {t(`cancelReason_${value}`)}
                  </label>
                ))}
              </div>

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

            {/*
              A refusal with a way through it.

              "You cannot cancel this late" was the whole message: true, and a
              dead end. The business CAN still cancel it — only the self-service
              window has closed — so the one thing the client needs is how to
              ask, and the brand already carries it.
            */}
            {errorCode === 'too_late' && (brand?.info?.email || brand?.info?.phone) && (
              <p className="text-sm text-center opacity-80">
                {t('cancelAskBusiness')}{' '}
                {brand.info.email && (
                  <a href={`mailto:${brand.info.email}`} className="underline">
                    {brand.info.email}
                  </a>
                )}
                {brand.info.email && brand.info.phone ? ' · ' : ''}
                {brand.info.phone && (
                  <a href={`tel:${brand.info.phone}`} className="underline">
                    {brand.info.phone}
                  </a>
                )}
              </p>
            )}

            <div className="space-y-2">
              <BrandButton
                variant="danger"
                size="lg"
                fullWidth
                loading={cancelling}
                // Mandatory: unreachable without a reason, rather than sending a
                // default one the client never chose.
                disabled={!reasonCode}
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
