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

interface IntakeFieldOption {
  value: string;
  label_en: string;
  label_es: string;
  label_he: string;
}

interface IntakeField {
  key: string;
  type: 'text' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'tel' | 'email';
  label_en: string;
  label_es: string;
  label_he: string;
  required: boolean;
  options?: IntakeFieldOption[];
  placeholder_en?: string;
  placeholder_es?: string;
  placeholder_he?: string;
}

interface IntakeTemplate {
  id: string;
  template_key: string;
  name_en: string;
  name_es: string;
  name_he: string;
  fields: IntakeField[];
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

  const [template, setTemplate] = useState<IntakeTemplate | null>(null);
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
            setTemplate(data.template);
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

  // The template carries a column per language rather than a nested object.
  const localized = <T extends Record<string, unknown>>(source: T, base: string): string => {
    const key = `${base}_${locale}` as keyof T;
    return (source[key] as string) || (source[`${base}_en` as keyof T] as string) || '';
  };

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
    if (!template) return;

    const errors: Record<string, string> = {};
    template.fields.forEach(field => {
      if (field.required && !responses[field.key]) errors[field.key] = t('required');
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
        body: JSON.stringify({
          templateId: template.id,
          templateKey: template.template_key,
          responses,
        }),
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

  if (!brand || (error && !template && !alreadyCompleted && !hasNoIntake)) {
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
      <PublicShell brand={brand} width="narrow" header={{ compact: true }}>
        <div className="space-y-4">
          <StatusCard
            standalone
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

  if (!template) return null;

  const answered = template.fields.filter(field => Boolean(responses[field.key])).length;
  const progress = template.fields.length ? (answered / template.fields.length) * 100 : 0;

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
            {template.fields.map(field => {
              const label = localized(field, 'label');
              const placeholder = localized(field, 'placeholder');
              const invalid = Boolean(validationErrors[field.key]);
              const value = responses[field.key];

              return (
                <div key={field.key}>
                  <label
                    htmlFor={field.key}
                    className="mb-1.5 block text-sm font-medium"
                    style={{ color: 'var(--ap-text)' }}
                  >
                    {label}
                    {field.required && (
                      // Logical margin, so the asterisk sits after the label in
                      // both directions.
                      <span className="ms-1" style={{ color: '#DC2626' }}>
                        *
                      </span>
                    )}
                  </label>

                  {field.type === 'textarea' ? (
                    <textarea
                      id={field.key}
                      rows={4}
                      value={(value as string) || ''}
                      placeholder={placeholder}
                      onChange={e => handleChange(field.key, e.target.value)}
                      className="w-full px-3 py-2.5 text-sm outline-none"
                      style={{
                        ...fieldStyle,
                        borderColor: invalid ? '#DC2626' : 'var(--ap-border)',
                      }}
                    />
                  ) : field.type === 'select' ? (
                    <select
                      id={field.key}
                      value={(value as string) || ''}
                      onChange={e => handleChange(field.key, e.target.value)}
                      className="w-full px-3 py-2.5 text-sm outline-none"
                      style={{
                        ...fieldStyle,
                        borderColor: invalid ? '#DC2626' : 'var(--ap-border)',
                      }}
                    >
                      <option value="">{t('select')}</option>
                      {field.options?.map(option => (
                        <option key={option.value} value={option.value}>
                          {localized(option, 'label')}
                        </option>
                      ))}
                    </select>
                  ) : field.type === 'radio' ? (
                    <div className="space-y-2">
                      {field.options?.map(option => (
                        <label
                          key={option.value}
                          className="flex cursor-pointer items-center gap-2.5 text-sm"
                          style={{ color: 'var(--ap-text)' }}
                        >
                          <input
                            type="radio"
                            name={field.key}
                            value={option.value}
                            checked={value === option.value}
                            onChange={e => handleChange(field.key, e.target.value)}
                            style={{ accentColor: 'var(--ap-brand)' }}
                          />
                          {localized(option, 'label')}
                        </label>
                      ))}
                    </div>
                  ) : field.type === 'checkbox' ? (
                    <div className="space-y-2">
                      {field.options?.map(option => {
                        const selected = Array.isArray(value) ? (value as string[]) : [];
                        return (
                          <label
                            key={option.value}
                            className="flex cursor-pointer items-center gap-2.5 text-sm"
                            style={{ color: 'var(--ap-text)' }}
                          >
                            <input
                              type="checkbox"
                              checked={selected.includes(option.value)}
                              onChange={e =>
                                handleChange(
                                  field.key,
                                  e.target.checked
                                    ? [...selected, option.value]
                                    : selected.filter(v => v !== option.value)
                                )
                              }
                              style={{ accentColor: 'var(--ap-brand)' }}
                            />
                            {localized(option, 'label')}
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <input
                      id={field.key}
                      type={field.type}
                      value={(value as string) || ''}
                      placeholder={placeholder}
                      onChange={e => handleChange(field.key, e.target.value)}
                      // Email and phone are Latin-scripted even on a Hebrew form.
                      dir={field.type === 'email' || field.type === 'tel' ? 'ltr' : undefined}
                      className="w-full px-3 py-2.5 text-sm outline-none"
                      style={{
                        ...fieldStyle,
                        borderColor: invalid ? '#DC2626' : 'var(--ap-border)',
                      }}
                    />
                  )}

                  {invalid && (
                    <p className="mt-1 text-xs" style={{ color: '#DC2626' }}>
                      {validationErrors[field.key]}
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
