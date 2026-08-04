'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { ClipboardList, Loader2, CheckCircle } from 'lucide-react';
import type { BlockRendererProps, FormField } from './types';

interface IntakeFormContent {
  title?: string;
  subtitle?: string;
  description?: string;
  fields: FormField[];
  submit_text?: string;
  success_message?: string;
  crm_integration?: boolean;
  intake_form_id?: string;
}

// Localized labels
const LABELS = {
  en: {
    title: 'Client Intake Form',
    subtitle: 'Please complete this form before your first session',
    submit: 'Submit Form',
    success: 'Thank you! Your information has been received.',
    error: 'Something went wrong. Please try again.',
    required: 'This field is required',
    invalidEmail: 'Please enter a valid email address',
    // Common field labels
    firstName: 'First Name',
    lastName: 'Last Name',
    email: 'Email',
    phone: 'Phone',
    dateOfBirth: 'Date of Birth',
    address: 'Address',
    emergencyContact: 'Emergency Contact',
    currentConcerns: 'What brings you here today?',
    previousTherapy: 'Have you had therapy before?',
    medications: 'Current medications',
    goals: 'What are your goals for our work together?'
  },
  es: {
    title: 'Formulario de Admisión',
    subtitle: 'Por favor complete este formulario antes de su primera sesión',
    submit: 'Enviar Formulario',
    success: '¡Gracias! Su información ha sido recibida.',
    error: 'Algo salió mal. Por favor, inténtalo de nuevo.',
    required: 'Este campo es obligatorio',
    invalidEmail: 'Por favor, introduce un correo electrónico válido',
    firstName: 'Nombre',
    lastName: 'Apellido',
    email: 'Correo electrónico',
    phone: 'Teléfono',
    dateOfBirth: 'Fecha de Nacimiento',
    address: 'Dirección',
    emergencyContact: 'Contacto de Emergencia',
    currentConcerns: '¿Qué te trae aquí hoy?',
    previousTherapy: '¿Has tenido terapia antes?',
    medications: 'Medicamentos actuales',
    goals: '¿Cuáles son tus objetivos para nuestro trabajo juntos?'
  },
  he: {
    title: 'טופס קליטה',
    subtitle: 'אנא מלא טופס זה לפני הפגישה הראשונה',
    submit: 'שלח טופס',
    success: '!תודה! המידע שלך התקבל',
    error: 'משהו השתבש. אנא נסה שוב.',
    required: 'שדה זה הוא חובה',
    invalidEmail: 'אנא הזן כתובת אימייל תקינה',
    firstName: 'שם פרטי',
    lastName: 'שם משפחה',
    email: 'אימייל',
    phone: 'טלפון',
    dateOfBirth: 'תאריך לידה',
    address: 'כתובת',
    emergencyContact: 'איש קשר לחירום',
    currentConcerns: 'מה מביא אותך לכאן היום?',
    previousTherapy: '?האם עברת טיפול בעבר',
    medications: 'תרופות נוכחיות',
    goals: 'מהן המטרות שלך לעבודה המשותפת שלנו?'
  }
};

export function IntakeFormBlock({ content, styles, theme, locale, isRTL, className }: BlockRendererProps) {
  const {
    title,
    subtitle,
    description,
    fields = [],
    submit_text,
    success_message
  } = content as IntakeFormContent;

  const labels = LABELS[locale] || LABELS.en;
  const primaryColor = theme?.colors.primary || '#4F6EF7';

  const [formData, setFormData] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const validateField = (field: FormField, value: string): string | null => {
    if (field.required && !value.trim()) {
      return labels.required;
    }
    if (field.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return labels.invalidEmail;
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate all fields
    const newErrors: Record<string, string> = {};
    fields.forEach(field => {
      const error = validateField(field, formData[field.name] || '');
      if (error) newErrors[field.name] = error;
    });

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setSubmitting(true);
    setErrors({});

    try {
      const response = await fetch('/api/website/public/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        setSubmitted(true);
        setFormData({});
      } else {
        setErrors({ _form: labels.error });
      }
    } catch {
      setErrors({ _form: labels.error });
    } finally {
      setSubmitting(false);
    }
  };

  const getFieldLabel = (field: FormField): string => {
    // Try to find localized label by field name
    const fieldKey = field.name.replace(/[_-]/g, '') as keyof typeof labels;
    const localizedLabel = labels[fieldKey];
    return field.label || (typeof localizedLabel === 'string' ? localizedLabel : field.name);
  };

  if (submitted) {
    return (
      <section
        dir={isRTL ? 'rtl' : 'ltr'}
        className={`${styles?.padding || 'py-16 sm:py-24'} ${styles?.background || 'bg-white dark:bg-slate-950'} ${className || ''}`}
      >
        <div className="max-w-xl mx-auto px-4 sm:px-6 text-center">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', duration: 0.5 }}
          >
            <CheckCircle
              className="w-20 h-20 mx-auto mb-6"
              style={{ color: primaryColor }}
            />
          </motion.div>
          <motion.h3
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-2xl font-bold text-gray-900 dark:text-white mb-4"
            style={{ fontFamily: 'var(--website-font-heading)' }}
          >
            {success_message || labels.success}
          </motion.h3>
        </div>
      </section>
    );
  }

  return (
    <section
      dir={isRTL ? 'rtl' : 'ltr'}
      id="intake"
      className={`${styles?.padding || 'py-16 sm:py-24'} ${styles?.background || 'bg-gray-50 dark:bg-slate-900'} ${className || ''}`}
    >
      <div className="max-w-2xl mx-auto px-4 sm:px-6">
        {/* Header */}
        <div className="text-center mb-10">
          <div
            className="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-6"
            style={{ backgroundColor: `${primaryColor}20` }}
          >
            <ClipboardList className="w-8 h-8" style={{ color: primaryColor }} />
          </div>

          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white"
            style={{ fontFamily: 'var(--website-font-heading)' }}
          >
            {title || labels.title}
          </motion.h2>

          {(subtitle || description) && (
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="mt-4 text-gray-600 dark:text-gray-300 max-w-lg mx-auto"
              style={{ fontFamily: 'var(--website-font-body)' }}
            >
              {subtitle || description || labels.subtitle}
            </motion.p>
          )}
        </div>

        <motion.form
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2 }}
          onSubmit={handleSubmit}
          className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 sm:p-8 space-y-6"
          style={{ borderRadius: theme?.borderRadius || '1rem' }}
        >
          {fields.map((field, index) => (
            <div key={field.name}>
              <label
                htmlFor={field.name}
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
              >
                {getFieldLabel(field)}
                {field.required && <span className="text-red-500 ms-1">*</span>}
              </label>

              {field.type === 'textarea' ? (
                <textarea
                  id={field.name}
                  name={field.name}
                  rows={4}
                  required={field.required}
                  placeholder={field.placeholder}
                  value={formData[field.name] || ''}
                  onChange={(e) => setFormData({ ...formData, [field.name]: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-gray-600 text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 transition-all"
                  style={{
                    borderRadius: theme?.borderRadius || '0.5rem',
                    fontFamily: 'var(--website-font-body)'
                  }}
                />
              ) : field.type === 'select' && field.options ? (
                <select
                  id={field.name}
                  name={field.name}
                  required={field.required}
                  value={formData[field.name] || ''}
                  onChange={(e) => setFormData({ ...formData, [field.name]: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-gray-600 text-gray-900 dark:text-white focus:outline-none focus:ring-2 transition-all"
                  style={{
                    borderRadius: theme?.borderRadius || '0.5rem',
                    fontFamily: 'var(--website-font-body)'
                  }}
                >
                  <option value="">{field.placeholder || `Select...`}</option>
                  {field.options.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              ) : field.type === 'radio' && field.options ? (
                <div className="space-y-2">
                  {field.options.map((option) => (
                    <label key={option} className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="radio"
                        name={field.name}
                        value={option}
                        checked={formData[field.name] === option}
                        onChange={(e) => setFormData({ ...formData, [field.name]: e.target.value })}
                        className="w-4 h-4"
                        style={{ accentColor: primaryColor }}
                      />
                      <span className="text-gray-700 dark:text-gray-300">{option}</span>
                    </label>
                  ))}
                </div>
              ) : field.type === 'checkbox' ? (
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    name={field.name}
                    checked={formData[field.name] === 'true'}
                    onChange={(e) => setFormData({ ...formData, [field.name]: e.target.checked ? 'true' : 'false' })}
                    className="w-5 h-5 rounded"
                    style={{ accentColor: primaryColor }}
                  />
                  <span className="text-gray-700 dark:text-gray-300">{field.placeholder || field.label}</span>
                </label>
              ) : (
                <input
                  id={field.name}
                  name={field.name}
                  type={field.type}
                  required={field.required}
                  placeholder={field.placeholder}
                  value={formData[field.name] || ''}
                  onChange={(e) => setFormData({ ...formData, [field.name]: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-gray-600 text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 transition-all"
                  style={{
                    borderRadius: theme?.borderRadius || '0.5rem',
                    fontFamily: 'var(--website-font-body)'
                  }}
                />
              )}

              {errors[field.name] && (
                <p className="mt-1 text-sm text-red-500">{errors[field.name]}</p>
              )}
            </div>
          ))}

          {errors._form && (
            <p className="text-sm text-red-500 text-center">{errors._form}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 px-6 py-4 text-white font-semibold shadow-lg hover:opacity-90 disabled:opacity-50 transition-all"
            style={{
              backgroundColor: primaryColor,
              borderRadius: theme?.borderRadius || '0.5rem'
            }}
          >
            {submitting ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <ClipboardList className="w-5 h-5" />
                {submit_text || labels.submit}
              </>
            )}
          </button>
        </motion.form>
      </div>
    </section>
  );
}
