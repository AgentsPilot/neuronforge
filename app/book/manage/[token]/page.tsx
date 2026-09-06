'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Mail, RefreshCw, User, X } from 'lucide-react';

import { AppointmentCard, type PublicBookingSummary } from '@/components/public/AppointmentCard';
import { BrandButton } from '@/components/public/BrandButton';
import { BusinessInfoPanel } from '@/components/public/BusinessInfoPanel';
import { PublicPageSpinner } from '@/components/public/PublicSpinner';
import { PublicShell } from '@/components/public/PublicShell';
import { StatusCard } from '@/components/public/StatusCard';
import { useOptionalPublicBrand } from '@/components/public/PublicBrandProvider';
import { createPublicT } from '@/lib/i18n/public-pages';

interface BookingData extends PublicBookingSummary {
  id: string;
  clientName: string;
  clientEmail: string;
  status: string;
  paymentStatus: string;
  notes: string | null;
  canReschedule: boolean;
  canCancel: boolean;
  hoursUntilBooking: number;
}

/**
 * What a client sees when they open the link in their confirmation email.
 *
 * The branding, language and direction now arrive from the segment layout,
 * resolved on the server from the token — so this page no longer paints a grey
 * skeleton and then repaints itself once it has learned whose booking it is.
 * All it fetches is the booking.
 */
export default function BookingManagePage() {
  const params = useParams();
  const token = params.token as string;
  const brand = useOptionalPublicBrand();

  const [booking, setBooking] = useState<BookingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const locale = brand?.locale ?? 'en';
  const t = createPublicT(locale);

  useEffect(() => {
    fetch(`/api/book/manage/${token}`)
      .then(res => res.json())
      .then(data => {
        if (data.success) setBooking(data.booking);
        else setError(data.error || t('bookingNotFound'));
      })
      .catch(() => setError(t('bookingNotFound')))
      .finally(() => setLoading(false));
    // The token is the only input; re-running on locale change would refetch
    // for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (loading) return <PublicPageSpinner label={t('loading')} />;

  if (error || !booking || !brand) {
    return (
      <div style={{ background: 'var(--ap-bg)' }}>
        <StatusCard
          standalone
          tone="error"
          title={t('bookingNotFound')}
          description={t('bookingNotFoundDesc')}
        />
      </div>
    );
  }

  const isCancelled = booking.status === 'cancelled';
  const statusTone = isCancelled ? 'error' : booking.status === 'confirmed' ? 'success' : 'warning';
  const statusLabel = t(isCancelled ? 'cancelled' : booking.status === 'confirmed' ? 'confirmed' : 'pending');

  // Semantic, not brand: a cancelled appointment has to read as cancelled even
  // when the business's own colour happens to be green.
  const STATUS_COLORS = {
    success: { bg: '#DCFCE7', fg: '#15803D' },
    error: { bg: '#FEE2E2', fg: '#B91C1C' },
    warning: { bg: '#FEF3C7', fg: '#B45309' },
  } as const;
  const status = STATUS_COLORS[statusTone];

  return (
    <PublicShell brand={brand} width="default" header={{ subtitle: t('manageBooking') }}>
      <div className="space-y-4">
        <div className="flex justify-center">
          <span
            className="inline-flex items-center px-3 py-1 text-xs font-semibold"
            style={{ background: status.bg, color: status.fg, borderRadius: '9999px' }}
          >
            {statusLabel}
          </span>
        </div>

        <AppointmentCard booking={booking} brand={brand} variant="full" muted={isCancelled} />

        {/* Your details */}
        <section
          className="p-5"
          style={{
            background: 'var(--ap-surface)',
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
            {t('yourDetails')}
          </h2>
          <dl className="space-y-2.5">
            <div className="flex items-center gap-2.5">
              <User className="h-4 w-4 shrink-0" style={{ color: 'var(--ap-brand)' }} aria-hidden />
              <dd className="text-sm" style={{ color: 'var(--ap-text)' }}>
                <bdi>{booking.clientName}</bdi>
              </dd>
            </div>
            <div className="flex items-center gap-2.5">
              <Mail className="h-4 w-4 shrink-0" style={{ color: 'var(--ap-brand)' }} aria-hidden />
              <dd className="text-sm" style={{ color: 'var(--ap-text)' }}>
                <bdi>{booking.clientEmail}</bdi>
              </dd>
            </div>
          </dl>

          {booking.notes && (
            <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--ap-border)' }}>
              <h3 className="mb-1.5 text-xs font-semibold" style={{ color: 'var(--ap-text-muted)' }}>
                {t('notes')}
              </h3>
              <p className="text-sm" style={{ color: 'var(--ap-text)' }}>
                <bdi>{booking.notes}</bdi>
              </p>
            </div>
          )}
        </section>

        {/* Actions */}
        {!isCancelled && (
          <div className="space-y-2">
            {booking.canReschedule ? (
              <>
                <BrandButton href={`/book/manage/${token}/reschedule`} fullWidth size="lg">
                  <RefreshCw className="h-4 w-4" aria-hidden />
                  {t('reschedule')}
                </BrandButton>
                <BrandButton href={`/book/manage/${token}/cancel`} variant="ghost" fullWidth>
                  <X className="h-4 w-4" aria-hidden />
                  {t('cancel')}
                </BrandButton>
              </>
            ) : (
              <StatusCard tone="info" title={t('cannotModify')} />
            )}
          </div>
        )}

        {/*
          Where to go and how to call.

          This is the page a client opens on the morning of their appointment,
          and until now it could not tell them either. Renders nothing at all
          when the business has filled none of it in.
        */}
        <BusinessInfoPanel brand={brand} variant="card" show={['contact', 'address', 'hours']} />
      </div>
    </PublicShell>
  );
}
