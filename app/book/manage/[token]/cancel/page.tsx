'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CalendarX2, Mail, X } from 'lucide-react';

import { AppointmentCard, type PublicBookingSummary } from '@/components/public/AppointmentCard';
import { BrandButton } from '@/components/public/BrandButton';
import { PortalHero } from '@/components/public/PortalHero';
import { PublicPageSpinner } from '@/components/public/PublicSpinner';
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
    );
  }

  if (cancelled) {
    /*
      NO SHELL OF ITS OWN.

      This returned a `PublicShell` — but `app/book/manage/[token]/layout.tsx`
      has already wrapped the whole segment in `PortalShell`, so the cancelled
      state rendered a PortalBar AND a PublicHeader, and two footers under
      them. The frame is the layout's; a screen inside it returns its content
      bare. `ProposalAnswer`'s `embedded` flag is the same rule, and
      `quoteAnsweredInThePortal.guard.test.ts:105-116` enforces it there.
    */
    return (
      <>
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
      </>
    );
  }

  if (!booking) return null;

  const alreadyCancelled = booking.status === 'cancelled';

  return (
    <>
      {/*
        ─────────────────────────────────────────────────────────────────────
        THE QUESTION IS THE HERO.

        It was a page title that only repeated the URL, with the real question
        in an amber card below the appointment — so the screen spent its first
        200px saying "cancel" twice and asking nothing. The question leads now
        and the warning is its subtitle, which is the one sentence nobody
        disputes and does not need a panel of its own.
        ─────────────────────────────────────────────────────────────────────
      */}
      <PortalHero
        brand={brand}
        title={alreadyCancelled ? t('cancelledTitle') : t('cancelConfirm')}
        subtitle={alreadyCancelled ? t('cancelledDesc') : t('cancelWarning')}
        back={{ href: `/book/manage/${token}`, label: t('backToBooking') }}
      />

      <>
        {/* What they are cancelling, first and briefly: on this screen a
            client is confirming they mean the right booking, not reading it. */}
        <AppointmentCard booking={booking} brand={brand} variant="summary" />

        {alreadyCancelled ? (
          <StatusCard tone="info" title={t('cancelledTitle')} description={t('cancelledDesc')} />
        ) : !booking.canCancel ? (
          <StatusCard tone="info" title={t('cannotCancel')} description={t('cannotModify')} />
        ) : (
          <section
            className="p-5"
            style={{
              background: 'var(--ap-surface)',
              border: '1px solid var(--ap-border)',
              borderRadius: 'var(--ap-radius-lg)',
            }}
          >
            <p className="mb-2.5 text-sm font-semibold" style={{ color: 'var(--ap-text)' }}>
              {t('cancelReasonWhy')}
            </p>

            {/*
              ───────────────────────────────────────────────────────────────
              CHIPS, NOT A COLUMN OF RADIOS.

              Six full-width bordered rows with a radio each ran to about
              330px — more than a third of a phone screen to ask one question
              — and pushed the button that the client came to press below the
              fold. The same six wrap into three short rows at about 110px.

              Nothing about the choice changes: still one answer, still every
              option visible (which is what stops the first being taken by
              default), still mandatory. They are `radio` inputs underneath,
              visually hidden rather than replaced, so the group keeps its
              keyboard behaviour and its name for a screen reader.
              ───────────────────────────────────────────────────────────────
            */}
            <div className="mb-4 flex flex-wrap gap-2">
              {CLIENT_CANCEL_REASONS.map(value => {
                const chosen = reasonCode === value;

                return (
                  <label
                    key={value}
                    className="cursor-pointer px-3.5 py-2 text-sm transition-colors"
                    style={{
                      color: chosen ? 'var(--ap-brand)' : 'var(--ap-text)',
                      fontWeight: chosen ? 600 : 500,
                      borderRadius: '9999px',
                      border: `1px solid ${chosen ? 'var(--ap-brand)' : 'var(--ap-border)'}`,
                      background: chosen ? 'var(--ap-brand-tint)' : 'var(--ap-surface)',
                    }}
                  >
                    <input
                      type="radio"
                      name="cancel-reason-code"
                      checked={chosen}
                      onChange={() => setReasonCode(value)}
                      className="sr-only"
                    />
                    {t(`cancelReason_${value}`)}
                  </label>
                );
              })}
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

            {error && (
              <div className="mt-4">
                <StatusCard tone="error" title={error} />
              </div>
            )}

            {/*
              A refusal with a way through it.

              "You cannot cancel this late" was the whole message: true, and a
              dead end. The business CAN still cancel it — only the self-service
              window has closed — so the one thing the client needs is how to
              ask, and the brand already carries it.
            */}
            {errorCode === 'too_late' && (brand?.info?.email || brand?.info?.phone) && (
              <p className="mt-4 text-center text-sm opacity-80">
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

            {/* Side by side: the whole form fits now, so the decision sits at
                the end of it rather than as two stacked slabs. */}
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
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
          </section>
        )}

        {/* The questions a client asks BEFORE cancelling, answered under the
            form rather than after the fact. */}
        {!alreadyCancelled && booking.canCancel && (
          <section
            className="p-5"
            style={{
              background: 'var(--ap-surface-2)',
              border: '1px solid var(--ap-border)',
              borderRadius: 'var(--ap-radius-lg)',
            }}
          >
            <h2
              className="mb-3 text-xs font-semibold"
              style={{
                color: 'var(--ap-text-muted)',
                letterSpacing: locale === 'he' ? 'normal' : '0.05em',
                textTransform: locale === 'he' ? 'none' : 'uppercase',
              }}
            >
              {t('portal.cancel_what_next')}
            </h2>
            <ul className="space-y-2.5">
              <li className="flex items-start gap-2.5 text-sm" style={{ color: 'var(--ap-text)' }}>
                <Mail className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--ap-brand)' }} aria-hidden />
                {t('portal.cancel_next_email')}
              </li>
              <li className="flex items-start gap-2.5 text-sm" style={{ color: 'var(--ap-text)' }}>
                <CalendarX2 className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--ap-brand)' }} aria-hidden />
                {t('portal.cancel_next_slot')}
              </li>
            </ul>
          </section>
        )}
      </>
    </>
  );
}
