'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ClipboardList } from 'lucide-react';

import { AppointmentCard, type PublicBookingSummary } from '@/components/public/AppointmentCard';
import { BrandButton } from '@/components/public/BrandButton';
import { BusinessInfoPanel } from '@/components/public/BusinessInfoPanel';
import { PublicPageSpinner } from '@/components/public/PublicSpinner';
import { PublicShell } from '@/components/public/PublicShell';
import { StatusCard } from '@/components/public/StatusCard';
import { useOptionalPublicBrand } from '@/components/public/PublicBrandProvider';
import { createPublicT } from '@/lib/i18n/public-pages';
import {
  visibleQuestions,
  type IntakeQuestion,
} from '@/lib/business-os/intake/types';
import { IntakeAnswerField } from '@/components/public/IntakeAnswerField';

/**
 * The form, as published for this business.
 *
 * One language, because the form belongs to one business and was written in
 * theirs — the three label columns are gone with the shared catalogue that
 * needed them. Shape imported rather than redeclared: this page was one of five
 * files carrying its own copy, and they had already drifted.
 */
interface PublishedIntakeForm {
  id: string;
  version: number;
  questions: IntakeQuestion[];
}

interface BookingData extends PublicBookingSummary {
  id: string;
  clientName: string;
}

/** Input styling shared by every field type, in the business's colours. */
const fieldStyle: React.CSSProperties = {
  background: 'var(--ap-bg)',
  border: '1px solid var(--ap-border)',
  borderRadius: 'var(--ap-radius-md)',
  color: 'var(--ap-text)',
};

export default function IntakeFormPage() {
  const params = useParams();
  const token = params.token as string;
  const brand = useOptionalPublicBrand();

  const [form, setForm] = useState<PublishedIntakeForm | null>(null);
  const [booking, setBooking] = useState<BookingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [responses, setResponses] = useState<Record<string, unknown>>({});
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [alreadyCompleted, setAlreadyCompleted] = useState(false);
  const [hasNoIntake, setHasNoIntake] = useState(false);

  const locale = brand?.locale ?? 'en';
  const t = createPublicT(locale);

  useEffect(() => {
    async function fetchIntakeForm() {
      try {
        const response = await fetch(`/api/book/manage/${token}/intake`);
        const data = await response.json();

        if (data.success) {
          if (data.alreadyCompleted) {
            setAlreadyCompleted(true);
            setBooking(data.booking);
          } else if (!data.hasIntake) {
            setHasNoIntake(true);
            setBooking(data.booking);
          } else {
            setForm(data.form);
            setBooking(data.booking);
          }
        } else {
          setError(data.error || t('loadingError'));
        }
      } catch {
        setError(t('loadingError'));
      } finally {
        setLoading(false);
      }
    }

    if (token) fetchIntakeForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleChange = (fieldKey: string, value: unknown) => {
    setResponses(prev => ({ ...prev, [fieldKey]: value }));
    if (validationErrors[fieldKey]) {
      setValidationErrors(prev => {
        const next = { ...prev };
        delete next[fieldKey];
        return next;
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;

    /*
     * Only what the client can SEE is required.
     *
     * A conditional question the client never reached is still `required` in
     * the definition. Validating it would block a form on an answer to a
     * question that was never displayed — a dead end with nothing on screen to
     * explain it.
     */
    const errors: Record<string, string> = {};
    visibleQuestions(form.questions, responses).forEach(question => {
      const answer = responses[question.id];
      const empty =
        answer === undefined ||
        answer === '' ||
        answer === null ||
        (Array.isArray(answer) && answer.length === 0);

      if (question.required && empty) errors[question.id] = t('required');
    });

    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/book/manage/${token}/intake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Only the answers. Which form this is belongs to the business and is
        // resolved server-side rather than asserted here.
        body: JSON.stringify({ responses }),
      });
      const data = await response.json();

      if (data.success) setSubmitted(true);
      else setError(data.error || t('loadingError'));
    } catch {
      setError(t('loadingError'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <PublicPageSpinner label={t('loading')} />;

  if (!brand || (error && !form && !alreadyCompleted && !hasNoIntake)) {
    return (
      <div style={{ background: 'var(--ap-bg)' }}>
        <StatusCard
          standalone
          tone="error"
          title={t('loadingError')}
          description={error ?? undefined}
          actions={
            <BrandButton href={`/book/manage/${token}`} variant="ghost">
              {t('backToBooking')}
            </BrandButton>
          }
        />
      </div>
    );
  }

  /*
   * The four terminal states.
   *
   * Each of these was a full-page copy of the same white card with a different
   * coloured icon medallion, inlined four times in this file. They are one
   * component now, and the two that end the journey carry the business's
   * address and hours — the client is done with the form and the next thing
   * they need to know is where to turn up.
   */
  const terminal =
    submitted
      ? { tone: 'success' as const, title: t('thankYou'), desc: t('thankYouDesc'), showInfo: true }
      : alreadyCompleted
        ? {
            tone: 'success' as const,
            title: t('formAlreadyCompleted'),
            desc: t('formAlreadyCompletedDesc'),
            showInfo: true,
          }
        : hasNoIntake
          ? {
              tone: 'info' as const,
              title: t('noIntakeRequired'),
              desc: t('noIntakeRequiredDesc'),
              showInfo: false,
            }
          : null;

  if (terminal) {
    return (
      /*
       * `default` (42rem), not `narrow` (32rem).
       *
       * This screen carries more than a sentence: the appointment card with its
       * service name, date, time range and duration, and — uniquely among the
       * booking-management screens — the business's contact panel, which holds
       * a full street address. At 32rem the address wrapped mid-line and the
       * date ran onto two.
       *
       * `default` is also what the intake FORM below uses and what the booking
       * details page this links to uses, so the page no longer changes width
       * between filling the form in and being thanked for it.
       */
      <PublicShell brand={brand} width="default" header={{ compact: true }}>
        <div className="space-y-4">
          <StatusCard
            standalone
            inShell
            tone={terminal.tone}
            title={terminal.title}
            description={terminal.desc}
            actions={
              <BrandButton href={`/book/manage/${token}`} size="lg" fullWidth>
                {t('viewBookingDetails')}
              </BrandButton>
            }
          >
            {booking && <AppointmentCard booking={booking} brand={brand} variant="summary" />}
          </StatusCard>

          {terminal.showInfo && (
            <BusinessInfoPanel brand={brand} variant="card" show={['contact', 'address']} />
          )}
        </div>
      </PublicShell>
    );
  }

  if (!form) return null;

  // Progress counts what is ON SCREEN. Including hidden conditional questions
  // would make the bar stall at a number the client cannot move.
  const shown = visibleQuestions(form.questions, responses);
  const answered = shown.filter(question => {
    const answer = responses[question.id];
    return Array.isArray(answer) ? answer.length > 0 : Boolean(answer);
  }).length;
  const progress = shown.length ? (answered / shown.length) * 100 : 0;

  return (
    <PublicShell
      brand={brand}
      width="default"
      header={{
        compact: true,
        backHref: `/book/manage/${token}`,
        backLabel: t('backToBookingDetails'),
      }}
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center"
            style={{ background: 'var(--ap-brand-tint)', borderRadius: 'var(--ap-radius-md)' }}
          >
            <ClipboardList className="h-5 w-5" style={{ color: 'var(--ap-brand)' }} aria-hidden />
          </div>
          <div>
            <h1
              className="text-xl font-bold"
              style={{ color: 'var(--ap-text)', fontFamily: 'var(--ap-font-heading)' }}
            >
              {t('completeIntakeForm')}
            </h1>
            <p className="mt-0.5 text-sm" style={{ color: 'var(--ap-text-muted)' }}>
              {t('helpUsPrepare')}
            </p>
          </div>
        </div>

        {booking && <AppointmentCard booking={booking} brand={brand} variant="summary" />}

        {/* How much is left. A long intake form with no sense of progress is
            where clients abandon. */}
        <div
          className="h-1 w-full overflow-hidden"
          style={{ background: 'var(--ap-surface-2)', borderRadius: '9999px' }}
          role="progressbar"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full transition-all duration-300"
            style={{ width: `${progress}%`, background: 'var(--ap-brand)' }}
          />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div
            className="space-y-5 p-5"
            style={{
              background: 'var(--ap-surface)',
              border: '1px solid var(--ap-border)',
              borderRadius: 'var(--ap-radius-lg)',
              boxShadow: 'var(--ap-shadow-sm)',
            }}
          >
            {shown.map(question => {
              const invalid = Boolean(validationErrors[question.id]);
              const value = responses[question.id];

              return (
                <div key={question.id}>
                  <label
                    htmlFor={question.id}
                    className="mb-1.5 block text-sm font-medium"
                    style={{ color: 'var(--ap-text)' }}
                  >
                    {question.label}
                    {question.required && (
                      // Logical margin, so the asterisk sits after the label in
                      // both directions.
                      <span className="ms-1" style={{ color: '#DC2626' }}>
                        *
                      </span>
                    )}
                  </label>

                  {question.help && (
                    <p className="mb-1.5 text-xs" style={{ color: 'var(--ap-text-muted)' }}>
                      {question.help}
                    </p>
                  )}

                  <IntakeAnswerField
                    question={question}
                    value={value}
                    invalid={invalid}
                    token={token}
                    onChange={(next: unknown) => handleChange(question.id, next)}
                    t={t}
                  />

                  {invalid && (
                    <p className="mt-1 text-xs" style={{ color: '#DC2626' }}>
                      {validationErrors[question.id]}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {error && <StatusCard tone="error" title={error} />}

          <BrandButton type="submit" size="lg" fullWidth loading={submitting}>
            {submitting ? t('submitting') : t('submitForm')}
          </BrandButton>
        </form>
      </div>
    </PublicShell>
  );
}
