'use client';

/**
 * IntakeFormStep
 *
 * A step component for the booking flow that renders intake form fields
 * from a template. Supports multilingual field labels and various field types.
 *
 * Used within ProcessFlowSection when intake is enabled and a template is selected.
 */

import { useState } from 'react';
import { ArrowLeft, ArrowRight, Loader2, ClipboardList } from 'lucide-react';

// ============================================================================
// TYPES
// ============================================================================

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

export interface IntakeTemplate {
  id: string;
  template_key: string;
  name_en: string;
  name_es: string;
  name_he: string;
  fields: IntakeField[];
}

interface IntakeFormStepProps {
  template: IntakeTemplate;
  locale: 'en' | 'es' | 'he';
  isRTL: boolean;
  primaryColor: string;
  onSubmit: (responses: Record<string, any>) => void;
  onBack: () => void;
  submitting?: boolean;
  error?: string | null;
  theme?: {
    borderRadius?: string;
    fonts?: {
      heading?: string;
      body?: string;
    };
  };
  labels?: {
    aFewQuestions: string;
    helpUsPrepare: string;
    completeBooking: string;
    back: string;
    submitting: string;
    required: string;
  };
}

// Default labels
const DEFAULT_LABELS = {
  en: {
    aFewQuestions: 'A Few Questions',
    helpUsPrepare: 'Help us prepare for your appointment',
    completeBooking: 'Complete Booking',
    back: 'Back',
    submitting: 'Submitting...',
    required: 'Required'
  },
  es: {
    aFewQuestions: 'Unas Preguntas',
    helpUsPrepare: 'Ayúdanos a preparar tu cita',
    completeBooking: 'Completar Reserva',
    back: 'Volver',
    submitting: 'Enviando...',
    required: 'Obligatorio'
  },
  he: {
    aFewQuestions: 'כמה שאלות',
    helpUsPrepare: 'עזור לנו להתכונן לפגישה שלך',
    completeBooking: 'השלם הזמנה',
    back: 'חזרה',
    submitting: '...שולח',
    required: 'חובה'
  }
};

// ============================================================================
// COMPONENT
// ============================================================================

export function IntakeFormStep({
  template,
  locale,
  isRTL,
  primaryColor,
  onSubmit,
  onBack,
  submitting = false,
  error = null,
  theme,
  labels: customLabels
}: IntakeFormStepProps) {
  const [responses, setResponses] = useState<Record<string, any>>({});
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  const labels = customLabels || DEFAULT_LABELS[locale] || DEFAULT_LABELS.en;

  // Get localized text helpers
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

  const handleChange = (fieldKey: string, value: any) => {
    setResponses(prev => ({ ...prev, [fieldKey]: value }));
    // Clear validation error on change
    if (validationErrors[fieldKey]) {
      setValidationErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[fieldKey];
        return newErrors;
      });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate required fields
    const errors: Record<string, string> = {};
    template.fields.forEach(field => {
      if (field.required && !responses[field.key]) {
        errors[field.key] = labels.required;
      }
    });

    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      return;
    }

    onSubmit(responses);
  };

  const inputStyles = `w-full px-4 py-2.5 bg-white dark:bg-slate-700 border-2 border-gray-200 dark:border-gray-600 focus:outline-none text-gray-900 dark:text-white placeholder:text-gray-400 transition-colors`;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white text-sm"
      >
        {isRTL ? <ArrowRight className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}
        {labels.back}
      </button>

      {/* Header */}
      <div className="text-center py-2">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
          style={{ backgroundColor: `${primaryColor}15` }}
        >
          <ClipboardList className="w-8 h-8" style={{ color: primaryColor }} />
        </div>
        <h3
          className="text-xl font-semibold text-gray-900 dark:text-white mb-2"
          style={{ fontFamily: 'var(--website-font-heading)' }}
        >
          {labels.aFewQuestions}
        </h3>
        <p className="text-gray-600 dark:text-gray-300">{labels.helpUsPrepare}</p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {template.fields.map((field) => (
          <div key={field.key} className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              {getFieldLabel(field)}
              {field.required && <span className="text-red-500 ml-1">*</span>}
            </label>

            {/* Text input */}
            {field.type === 'text' && (
              <input
                type="text"
                value={responses[field.key] || ''}
                onChange={(e) => handleChange(field.key, e.target.value)}
                placeholder={getFieldPlaceholder(field)}
                className={inputStyles}
                style={{ borderRadius: theme?.borderRadius || '0.5rem' }}
                onFocus={(e) => e.target.style.borderColor = primaryColor}
                onBlur={(e) => e.target.style.borderColor = ''}
              />
            )}

            {/* Textarea */}
            {field.type === 'textarea' && (
              <textarea
                value={responses[field.key] || ''}
                onChange={(e) => handleChange(field.key, e.target.value)}
                placeholder={getFieldPlaceholder(field)}
                rows={3}
                className={`${inputStyles} resize-none`}
                style={{ borderRadius: theme?.borderRadius || '0.5rem' }}
                onFocus={(e) => e.target.style.borderColor = primaryColor}
                onBlur={(e) => e.target.style.borderColor = ''}
              />
            )}

            {/* Email input */}
            {field.type === 'email' && (
              <input
                type="email"
                value={responses[field.key] || ''}
                onChange={(e) => handleChange(field.key, e.target.value)}
                placeholder={getFieldPlaceholder(field)}
                className={inputStyles}
                style={{ borderRadius: theme?.borderRadius || '0.5rem' }}
                onFocus={(e) => e.target.style.borderColor = primaryColor}
                onBlur={(e) => e.target.style.borderColor = ''}
              />
            )}

            {/* Phone input */}
            {field.type === 'tel' && (
              <input
                type="tel"
                value={responses[field.key] || ''}
                onChange={(e) => handleChange(field.key, e.target.value)}
                placeholder={getFieldPlaceholder(field)}
                className={inputStyles}
                style={{ borderRadius: theme?.borderRadius || '0.5rem' }}
                onFocus={(e) => e.target.style.borderColor = primaryColor}
                onBlur={(e) => e.target.style.borderColor = ''}
              />
            )}

            {/* Select dropdown */}
            {field.type === 'select' && field.options && (
              <select
                value={responses[field.key] || ''}
                onChange={(e) => handleChange(field.key, e.target.value)}
                className={inputStyles}
                style={{ borderRadius: theme?.borderRadius || '0.5rem' }}
              >
                <option value="">
                  {locale === 'es' ? 'Seleccionar...' : locale === 'he' ? 'בחר...' : 'Select...'}
                </option>
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
                    <span className="text-sm text-gray-700 dark:text-gray-300">
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
                  checked={responses[field.key] || false}
                  onChange={(e) => handleChange(field.key, e.target.checked)}
                  className="w-4 h-4"
                  style={{ accentColor: primaryColor }}
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
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
        {error && <p className="text-sm text-red-600 text-center">{error}</p>}

        {/* Submit button */}
        <button
          type="submit"
          disabled={submitting}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 text-white font-medium rounded-lg transition-all hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: primaryColor, borderRadius: theme?.borderRadius || '0.5rem' }}
        >
          {submitting ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              {labels.submitting}
            </>
          ) : (
            <>
              {labels.completeBooking}
              {isRTL ? <ArrowLeft className="w-5 h-5" /> : <ArrowRight className="w-5 h-5" />}
            </>
          )}
        </button>
      </form>
    </div>
  );
}
