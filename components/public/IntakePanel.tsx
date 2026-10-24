'use client';

import { useEffect, useState } from 'react';

import { AppointmentCard, type PublicBookingSummary } from '@/components/public/AppointmentCard';
import { BrandButton } from '@/components/public/BrandButton';
import { IntakeAnswerField } from '@/components/public/IntakeAnswerField';
import { PublicCard } from '@/components/public/PublicCard';
import { StatusCard } from '@/components/public/StatusCard';
import { useOptionalPublicBrand } from '@/components/public/PublicBrandProvider';
import { createPublicT } from '@/lib/i18n/public-pages';
import { visibleQuestions, type IntakeQuestion } from '@/lib/business-os/intake/types';

/**
 * The form, as published for this business.
 *
 * One language, because the form belongs to one business and was written in
 * theirs. Shape imported rather than redeclared.
 */
interface PublishedIntakeForm {
  id: string;
  version: number;
  questions: IntakeQuestion[];
}

interface IntakeBooking extends PublicBookingSummary {
  id: string;
  clientName: string;
}

interface IntakePanelProps {
  token: string;
  /**
   * Inline on the portal index, where the appointment is already the lead card
   * and the client has not navigated anywhere.
   *
   * Embedded it draws no back link (there is nothing to go back to) and no
   * appointment summary (the card above it IS the appointment). Standalone, at
   * `/intake`, it carries both, because a client arriving from an email link
   * has no other context on the screen.
   *
   * The same idea as `ProposalAnswer`'s `embedded`, and for the same reason:
   * one implementation, two places it can be mounted.
   */
  embedded?: boolean;
}

/**
 * The questions a business asks before an appointment, answered IN the portal.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A COMPONENT AND NOT A PAGE
 *
 * It was a page, and it was the one screen that most obviously did not belong
 * to the portal: its own heading band, its own back link, its own full-width
 * column, with the portal's cards stranded underneath it. Making a separate
 * page look like the portal is work that never finishes, because the two are
 * maintained apart and drift.
 *
 * So the form moved here and the route became a mount point. A client who
 * clicks the link in their email still lands on `/intake` — ten of the links
 * in the email templates point at these task routes and all of them keep
 * working — but what renders is this, the same component the portal index
 * shows in place. There is one design because there is one implementation.
 *
 * The logic is unchanged: the same GET, the same visible-questions validation,
 * the same POST of answers alone.
 * ─────────────────────────────────────────────────────────────────────────────
 */
/*
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TWO SHELLS ARE DECLARED HERE, AND THAT IS LOAD-BEARING.
 *
 * They used to be built INSIDE `IntakePanel`:
 *
 *     const Shell = embedded ? ({children}) => <div>…</div> : ({children}) => …
 *
 * which creates a NEW function identity on every render. React compares
 * element types by identity, so every keystroke — each one sets `responses`
 * and re-renders — looked like `<Shell>` being replaced by a different
 * component. It unmounted the whole form and mounted a fresh one.
 *
 * The visible effect was that the field being typed into lost focus after a
 * single character, and the page jumped as the browser landed on a newly
 * mounted document. The form was literally being rebuilt between keystrokes.
 *
 * Declared at module scope they are two stable references, so choosing between
 * them changes which shell renders and nothing else.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Embedded in the portal, which is already a card: no second border. */
function PlainShell({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}


/**
 * One stored answer, as the client should read it back.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The five types in use store five different shapes: text as a string, a
 * yes/no as a BOOLEAN, a multi-choice as an array, a file question as a list of
 * uploads, and a skipped question as nothing at all.
 *
 * `false` is the trap. A client who answered "no" stored `false`, and every
 * ordinary emptiness check — `!value`, `|| ''`, a truthy filter — throws that
 * answer away, so the one question they said no to would silently vanish from
 * their own summary. It is checked for explicitly, before anything else looks
 * at truthiness.
 *
 * Returns null for genuinely unanswered, which the caller drops: a blank row
 * reads as an answer that failed to load rather than a question nobody filled.
 */
function formatSubmittedAnswer(
  value: unknown,
  t: (key: string) => string
): string | null {
  if (typeof value === 'boolean') return value ? t('yes') : t('no');
  if (value === null || value === undefined || value === '') return null;

  if (Array.isArray(value)) {
    const parts = value
      .map(item => {
        if (typeof item === 'string') return item;
        /* An upload, stored as an object. Its name is the only part a client
           recognises; the url and size are machinery. */
        if (item && typeof item === 'object') {
          const file = item as { name?: string; fileName?: string; url?: string };
          return file.name ?? file.fileName ?? file.url ?? '';
        }
        return String(item);
      })
      .filter(Boolean);

    return parts.length ? parts.join(', ') : null;
  }

  if (typeof value === 'object') {
    const file = value as { name?: string; fileName?: string };
    return file.name ?? file.fileName ?? null;
  }

  return String(value);
}

/** Standalone at `/intake`, where nothing surrounds it. */
function CardShell({ children }: { children: React.ReactNode }) {
  return <PublicCard className="p-5">{children}</PublicCard>;
}

export function IntakePanel({ token, embedded = false }: IntakePanelProps) {
  const Shell = embedded ? PlainShell : CardShell;

  const brand = useOptionalPublicBrand();

  const [form, setForm] = useState<PublishedIntakeForm | null>(null);
  const [booking, setBooking] = useState<IntakeBooking | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [responses, setResponses] = useState<Record<string, unknown>>({});
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [alreadyCompleted, setAlreadyCompleted] = useState(false);
  /*
   * What they sent, so "you have already filled this in" can show it.
   *
   * Named for the submission rather than `answered`, which is taken below by
   * the progress count on the live form — two different things, and one
   * shadowing the other in the same component is how the wrong one gets read.
   */
  const [submittedAnswers, setSubmittedAnswers] = useState<{
    questions: Array<{ id: string; label?: string; type?: string }>;
    responses: Record<string, unknown>;
  } | null>(null);
  const [hasNoIntake, setHasNoIntake] = useState(false);

  const locale = brand?.locale ?? 'en';
  const t = createPublicT(locale);

  useEffect(() => {
    let live = true;

    async function fetchIntakeForm() {
      try {
        const response = await fetch(`/api/book/manage/${token}/intake`);
        const data = await response.json();
        if (!live) return;

        if (data.success) {
          if (data.alreadyCompleted) {
            setAlreadyCompleted(true);
            setBooking(data.booking);
            /* Null on a submission stored before the questions travelled with
               the answers; the card then says what it always said. */
            setSubmittedAnswers(data.answered ?? null);
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
        if (live) setError(t('loadingError'));
      } finally {
        if (live) setLoading(false);
      }
    }

    if (token) fetchIntakeForm();
    return () => {
      live = false;
    };
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
     * the definition. Validating it would block the form on an answer to a
     * question that was never displayed.
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

  /** Back to the booking, except when it is already on the screen. */
  const backLink = embedded ? null : (
    <BrandButton href={`/book/manage/${token}`} variant="ghost">
      {t('backToBookingDetails')}
    </BrandButton>
  );

  if (loading) {
    return (
      <Shell>
        <div
          className="h-24 w-full animate-pulse"
          style={{ background: 'var(--ap-surface-2)', borderRadius: 'var(--ap-radius-md)' }}
          aria-label={t('loading')}
        />
      </Shell>
    );
  }

  if (!brand || (error && !form && !alreadyCompleted && !hasNoIntake)) {
    return (
      <StatusCard
        inShell
        tone="error"
        title={t('loadingError')}
        description={error ?? undefined}
        actions={backLink ?? undefined}
      />
    );
  }

  /*
   * The three terminal states. Each ends the form rather than failing it, so
   * each is a quiet card rather than an error.
   */
  const terminal = submitted
    ? { tone: 'success' as const, title: t('thankYou'), desc: t('thankYouDesc') }
    : alreadyCompleted
      ? {
          tone: 'success' as const,
          title: t('formAlreadyCompleted'),
          desc: t('formAlreadyCompletedDesc'),
        }
      : hasNoIntake
        ? { tone: 'info' as const, title: t('noIntakeRequired'), desc: t('noIntakeRequiredDesc') }
        : null;

  if (terminal) {
    return (
      <StatusCard
        inShell
        tone={terminal.tone}
        title={terminal.title}
        description={terminal.desc}
        actions={backLink ?? undefined}
      >
        {/* The appointment, only where it is not already on the screen. */}
        {!embedded && booking && (
          <AppointmentCard booking={booking} brand={brand} variant="summary" />
        )}

        {/*
          ── WHAT THEY SENT ────────────────────────────────────────────────
          Only on the already-completed card: a client who has JUST submitted
          is reading "thank you" and does not need their own answers read back
          at them, and the no-form card has nothing to show.

          Rendered from the snapshot stored with the submission, so a form
          edited or republished since still reads correctly.
          ──────────────────────────────────────────────────────────────────
        */}
        {alreadyCompleted && submittedAnswers && submittedAnswers.questions.length > 0 && (
          <dl className="mt-4 flex flex-col text-start">
            {submittedAnswers.questions.map(question => {
              const raw = submittedAnswers.responses[question.id];
              const shown = formatSubmittedAnswer(raw, t);
              /* A question they skipped stays off the list: an empty row reads
                 as an answer that failed to load. */
              if (shown === null) return null;

              return (
                <div
                  key={question.id}
                  className="border-t py-2.5 first:border-t-0"
                  style={{ borderColor: 'var(--ap-border)' }}
                >
                  <dt className="text-xs" style={{ color: 'var(--ap-text-muted)' }}>
                    <bdi>{question.label ?? ''}</bdi>
                  </dt>
                  <dd
                    className="mt-0.5 whitespace-pre-wrap text-sm"
                    style={{ color: 'var(--ap-text)' }}
                  >
                    <bdi>{shown}</bdi>
                  </dd>
                </div>
              );
            })}
          </dl>
        )}
      </StatusCard>
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
    <Shell>
      {!embedded && (
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {/*
          An h2: the business's name in the bar is this page's only level-one
          heading, which `headingRank.guard` enforces across every public page.
        */}
        <h2
          className="text-lg font-bold"
          style={{ color: 'var(--ap-text)', fontFamily: 'var(--ap-font-heading)' }}
        >
          {t('completeIntakeForm')}
        </h2>
        <p className="text-sm" style={{ color: 'var(--ap-text-muted)' }}>
          {t('helpUsPrepare')}
        </p>
      </div>
      )}

      {!embedded && booking && (
        <div className="mt-4">
          <AppointmentCard booking={booking} brand={brand} variant="summary" />
        </div>
      )}

      {/* How much is left. A long intake form with no sense of progress is
          where clients abandon. */}
      <div
        className="mt-4 h-1 w-full overflow-hidden"
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

      <form onSubmit={handleSubmit} className="mt-4 space-y-5">
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
                  <span className="ms-1" style={{ color: 'var(--ap-danger)' }}>
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
                <p className="mt-1 text-xs" style={{ color: 'var(--ap-danger)' }}>
                  {validationErrors[question.id]}
                </p>
              )}
            </div>
          );
        })}

        {error && <StatusCard inShell tone="error" title={error} />}

        <div className="flex flex-wrap items-center gap-2">
          <BrandButton type="submit" size="lg" loading={submitting}>
            {submitting ? t('submitting') : t('submitForm')}
          </BrandButton>
          {backLink}
        </div>
      </form>
    </Shell>
  );
}
