'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Calendar, Clock, CheckCircle, ArrowLeft, ClipboardList, ArrowRight, Loader2, X } from 'lucide-react';

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

interface BookingData {
  id: string;
  clientName: string;
  startTime: string;
  endTime: string;
  timezone: string;
  service: {
    service_name: string;
    duration_minutes: number;
  };
}

interface BusinessData {
  name: string;
  logoUrl: string | null;
  primaryColor: string;
  language: string;
}

// Translations for the intake form page
const translations: Record<string, Record<string, string>> = {
  en: {
    loadingError: 'Unable to Load Form',
    backToBooking: 'Back to booking',
    backToBookingDetails: 'Back to booking details',
    formAlreadyCompleted: 'Form Already Completed',
    formAlreadyCompletedDesc: "You've already submitted your intake form for this appointment. We look forward to seeing you!",
    noIntakeRequired: 'No Intake Form Required',
    noIntakeRequiredDesc: "There's no intake form configured for this appointment. You're all set!",
    thankYou: 'Thank You!',
    thankYouDesc: 'Your intake form has been submitted successfully. We look forward to your appointment!',
    yourAppointment: 'Your appointment',
    viewBookingDetails: 'View Booking Details',
    completeIntakeForm: 'Complete Your Intake Form',
    helpUsPrepare: 'Help us prepare for your appointment',
    required: 'Required',
    select: 'Select...',
    submitting: 'Submitting...',
    submitForm: 'Submit Form',
    questionsContact: 'Questions? Contact {name} directly.'
  },
  es: {
    loadingError: 'No se puede cargar el formulario',
    backToBooking: 'Volver a la reserva',
    backToBookingDetails: 'Volver a los detalles de la reserva',
    formAlreadyCompleted: 'Formulario ya completado',
    formAlreadyCompletedDesc: 'Ya has enviado tu formulario de admisión para esta cita. ¡Te esperamos!',
    noIntakeRequired: 'No se requiere formulario de admisión',
    noIntakeRequiredDesc: 'No hay formulario de admisión configurado para esta cita. ¡Estás listo!',
    thankYou: '¡Gracias!',
    thankYouDesc: 'Tu formulario de admisión ha sido enviado con éxito. ¡Te esperamos en tu cita!',
    yourAppointment: 'Tu cita',
    viewBookingDetails: 'Ver detalles de la reserva',
    completeIntakeForm: 'Completa tu formulario de admisión',
    helpUsPrepare: 'Ayúdanos a prepararnos para tu cita',
    required: 'Obligatorio',
    select: 'Seleccionar...',
    submitting: 'Enviando...',
    submitForm: 'Enviar formulario',
    questionsContact: '¿Preguntas? Contacta a {name} directamente.'
  },
  he: {
    loadingError: 'לא ניתן לטעון את הטופס',
    backToBooking: 'חזרה להזמנה',
    backToBookingDetails: 'חזרה לפרטי ההזמנה',
    formAlreadyCompleted: 'הטופס כבר מולא',
    formAlreadyCompletedDesc: 'כבר שלחת את טופס הקליטה לפגישה זו. מחכים לראותך!',
    noIntakeRequired: 'לא נדרש טופס קליטה',
    noIntakeRequiredDesc: 'לא הוגדר טופס קליטה לפגישה זו. הכל מוכן!',
    thankYou: 'תודה רבה!',
    thankYouDesc: 'טופס הקליטה נשלח בהצלחה. מחכים לך בפגישה!',
    yourAppointment: 'הפגישה שלך',
    viewBookingDetails: 'צפייה בפרטי ההזמנה',
    completeIntakeForm: 'מלא/י את טופס הקליטה',
    helpUsPrepare: 'עזור/י לנו להתכונן לפגישה שלך',
    required: 'שדה חובה',
    select: 'בחר/י...',
    submitting: 'שולח...',
    submitForm: 'שליחת הטופס',
    questionsContact: 'שאלות? צור/י קשר עם {name} ישירות.'
  }
};

export default function IntakeFormPage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;

  const [template, setTemplate] = useState<IntakeTemplate | null>(null);
  const [booking, setBooking] = useState<BookingData | null>(null);
  const [business, setBusiness] = useState<BusinessData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [responses, setResponses] = useState<Record<string, unknown>>({});
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [alreadyCompleted, setAlreadyCompleted] = useState(false);
  const [hasNoIntake, setHasNoIntake] = useState(false);

  // Get locale from business settings or fallback to browser
  const locale = business?.language || 'en';
  const isRTL = locale === 'he';

  // Get translated text
  const t = (key: string, params?: Record<string, string>): string => {
    let text = translations[locale]?.[key] || translations.en[key] || key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        text = text.replace(`{${k}}`, v);
      });
    }
    return text;
  };

  useEffect(() => {
    async function fetchIntakeForm() {
      try {
        const response = await fetch(`/api/book/manage/${token}/intake`);
        const data = await response.json();

        if (data.success) {
          // Always set business data for locale/branding (now returned in all responses)
          if (data.business) {
            setBusiness(data.business);
          }

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
          setError(data.error || 'Failed to load intake form');
        }
      } catch {
        setError('Failed to load intake form');
      } finally {
        setLoading(false);
      }
    }

    if (token) {
      fetchIntakeForm();
    }
  }, [token]);

  const getFieldLabel = (field: IntakeField): string => {
    switch (locale) {
      case 'es': return field.label_es;
      case 'he': return field.label_he;
      default: return field.label_en;
    }
  };

  const getFieldPlaceholder = (field: IntakeField): string => {
    switch (locale) {
      case 'es': return field.placeholder_es || '';
      case 'he': return field.placeholder_he || '';
      default: return field.placeholder_en || '';
    }
  };

  const getOptionLabel = (option: IntakeFieldOption): string => {
    switch (locale) {
      case 'es': return option.label_es;
      case 'he': return option.label_he;
      default: return option.label_en;
    }
  };

  const handleChange = (fieldKey: string, value: unknown) => {
    setResponses(prev => ({ ...prev, [fieldKey]: value }));
    if (validationErrors[fieldKey]) {
      setValidationErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[fieldKey];
        return newErrors;
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!template) return;

    // Validate required fields
    const errors: Record<string, string> = {};
    template.fields.forEach(field => {
      if (field.required && !responses[field.key]) {
        errors[field.key] = t('required');
      }
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
          responses
        })
      });

      const data = await response.json();

      if (data.success) {
        setSubmitted(true);
      } else {
        setError(data.error || 'Failed to submit form');
      }
    } catch {
      setError('Failed to submit form');
    } finally {
      setSubmitting(false);
    }
  };

  const getLocaleCode = () => {
    switch (locale) {
      case 'he': return 'he-IL';
      case 'es': return 'es-ES';
      default: return 'en-US';
    }
  };

  const formatDate = (dateStr: string, timezone: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString(getLocaleCode(), {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: timezone
      });
    } catch {
      return new Date(dateStr).toLocaleDateString();
    }
  };

  const formatTime = (dateStr: string, timezone: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleTimeString(getLocaleCode(), {
        hour: 'numeric',
        minute: '2-digit',
        hour12: locale !== 'he', // Hebrew uses 24-hour format
        timeZone: timezone
      });
    } catch {
      return new Date(dateStr).toLocaleTimeString();
    }
  };

  // Show loading spinner only while API call is in progress
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  if (error && !template) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4" dir={isRTL ? 'rtl' : 'ltr'}>
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <X className="w-8 h-8 text-red-600" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">{t('loadingError')}</h1>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={() => router.push(`/book/manage/${token}`)}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            {isRTL ? '→' : '←'} {t('backToBooking')}
          </button>
        </div>
      </div>
    );
  }

  if (alreadyCompleted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4" dir={isRTL ? 'rtl' : 'ltr'}>
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">{t('formAlreadyCompleted')}</h1>
          <p className="text-gray-600 mb-6">
            {t('formAlreadyCompletedDesc')}
          </p>
          <button
            onClick={() => router.push(`/book/manage/${token}`)}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            {isRTL ? '→' : '←'} {t('backToBookingDetails')}
          </button>
        </div>
      </div>
    );
  }

  if (hasNoIntake) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4" dir={isRTL ? 'rtl' : 'ltr'}>
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <ClipboardList className="w-8 h-8 text-blue-600" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">{t('noIntakeRequired')}</h1>
          <p className="text-gray-600 mb-6">
            {t('noIntakeRequiredDesc')}
          </p>
          <button
            onClick={() => router.push(`/book/manage/${token}`)}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            {isRTL ? '→' : '←'} {t('backToBookingDetails')}
          </button>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4" dir={isRTL ? 'rtl' : 'ltr'}>
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">{t('thankYou')}</h1>
          <p className="text-gray-600 mb-6">
            {t('thankYouDesc')}
          </p>
          {booking && (
            <div className={`bg-gray-50 rounded-xl p-4 mb-6 ${isRTL ? 'text-right' : 'text-left'}`}>
              <p className="text-sm text-gray-500 mb-2">{t('yourAppointment')}</p>
              <p className="font-medium text-gray-900">{booking.service.service_name}</p>
              <p className="text-sm text-gray-600 mt-1">
                {formatDate(booking.startTime, booking.timezone)} • {formatTime(booking.startTime, booking.timezone)}
              </p>
            </div>
          )}
          <button
            onClick={() => router.push(`/book/manage/${token}`)}
            className="px-6 py-2 rounded-xl font-medium text-white transition-all"
            style={{ backgroundColor: business?.primaryColor || '#4F46E5' }}
          >
            {t('viewBookingDetails')}
          </button>
        </div>
      </div>
    );
  }

  if (!template || !booking) {
    return null;
  }

  const primaryColor = business?.primaryColor || '#4F46E5';
  const businessName = business?.name || 'Business';

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="max-w-lg mx-auto">
        {/* Back Button */}
        <button
          onClick={() => router.push(`/book/manage/${token}`)}
          className={`flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 transition-colors ${isRTL ? 'flex-row-reverse' : ''}`}
        >
          {isRTL ? <ArrowRight className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}
          {t('backToBooking')}
        </button>

        {/* Header */}
        <div className="text-center mb-8">
          {business?.logoUrl && (
            <img
              src={business.logoUrl}
              alt={businessName}
              className="h-12 mx-auto mb-3"
            />
          )}
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{ backgroundColor: `${primaryColor}15` }}
          >
            <ClipboardList className="w-8 h-8" style={{ color: primaryColor }} />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{t('completeIntakeForm')}</h1>
          <p className="text-gray-600 mt-1">{t('helpUsPrepare')}</p>
        </div>

        {/* Appointment Summary */}
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden mb-6">
          <div className="p-4 bg-gray-50 border-b">
            <h2 className="font-medium text-gray-900">{booking.service.service_name}</h2>
            <div className="flex items-center gap-4 mt-2 text-sm text-gray-600">
              <div className="flex items-center gap-1">
                <Calendar className="w-4 h-4" style={{ color: primaryColor }} />
                {formatDate(booking.startTime, booking.timezone)}
              </div>
              <div className="flex items-center gap-1">
                <Clock className="w-4 h-4" style={{ color: primaryColor }} />
                {formatTime(booking.startTime, booking.timezone)}
              </div>
            </div>
          </div>
        </div>

        {/* Intake Form */}
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {template.fields.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700">
                  {getFieldLabel(field)}
                  {field.required && <span className="text-red-500 ml-1">*</span>}
                </label>

                {/* Text input */}
                {field.type === 'text' && (
                  <input
                    type="text"
                    value={(responses[field.key] as string) || ''}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                    placeholder={getFieldPlaceholder(field)}
                    className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 transition-colors"
                    style={{ '--focus-color': primaryColor } as React.CSSProperties}
                  />
                )}

                {/* Textarea */}
                {field.type === 'textarea' && (
                  <textarea
                    value={(responses[field.key] as string) || ''}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                    placeholder={getFieldPlaceholder(field)}
                    rows={3}
                    className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 transition-colors resize-none"
                  />
                )}

                {/* Email input */}
                {field.type === 'email' && (
                  <input
                    type="email"
                    value={(responses[field.key] as string) || ''}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                    placeholder={getFieldPlaceholder(field)}
                    className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 transition-colors"
                  />
                )}

                {/* Phone input */}
                {field.type === 'tel' && (
                  <input
                    type="tel"
                    value={(responses[field.key] as string) || ''}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                    placeholder={getFieldPlaceholder(field)}
                    className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 transition-colors"
                  />
                )}

                {/* Select dropdown */}
                {field.type === 'select' && field.options && (
                  <select
                    value={(responses[field.key] as string) || ''}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                    className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 transition-colors"
                  >
                    <option value="">{t('select')}</option>
                    {field.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {getOptionLabel(option)}
                      </option>
                    ))}
                  </select>
                )}

                {/* Radio buttons */}
                {field.type === 'radio' && field.options && (
                  <div className="space-y-2 pt-1">
                    {field.options.map((option) => (
                      <label key={option.value} className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="radio"
                          name={field.key}
                          value={option.value}
                          checked={responses[field.key] === option.value}
                          onChange={(e) => handleChange(field.key, e.target.value)}
                          className="w-4 h-4"
                          style={{ accentColor: primaryColor }}
                        />
                        <span className="text-sm text-gray-700">
                          {getOptionLabel(option)}
                        </span>
                      </label>
                    ))}
                  </div>
                )}

                {/* Checkbox */}
                {field.type === 'checkbox' && (
                  <label className="flex items-center gap-3 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={(responses[field.key] as boolean) || false}
                      onChange={(e) => handleChange(field.key, e.target.checked)}
                      className="w-4 h-4"
                      style={{ accentColor: primaryColor }}
                    />
                    <span className="text-sm text-gray-700">
                      {getFieldLabel(field)}
                    </span>
                  </label>
                )}

                {/* Validation error */}
                {validationErrors[field.key] && (
                  <p className="text-xs text-red-500">{validationErrors[field.key]}</p>
                )}
              </div>
            ))}

            {/* Error message */}
            {error && (
              <div className="p-3 bg-red-50 rounded-xl">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            {/* Submit button */}
            <button
              type="submit"
              disabled={submitting}
              className={`w-full flex items-center justify-center gap-2 px-4 py-3 text-white font-medium rounded-xl transition-all hover:opacity-90 disabled:opacity-50 ${isRTL ? 'flex-row-reverse' : ''}`}
              style={{ backgroundColor: primaryColor }}
            >
              {submitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  {t('submitting')}
                </>
              ) : (
                <>
                  {t('submitForm')}
                  {isRTL ? <ArrowLeft className="w-5 h-5" /> : <ArrowRight className="w-5 h-5" />}
                </>
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-gray-500 text-sm mt-6">
          {t('questionsContact', { name: businessName })}
        </p>
      </div>
    </div>
  );
}
