'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Send, Loader2, CheckCircle } from 'lucide-react';
import type { BlockRendererProps, FormField } from './types';

interface ContactFormContent {
  title?: string;
  subtitle?: string;
  fields: FormField[];
  submit_text?: string;
  success_message?: string;
  recipient_email?: string;
  crm_integration?: boolean;
}

// Localized labels
const LABELS = {
  en: {
    name: 'Name',
    email: 'Email',
    phone: 'Phone',
    message: 'Message',
    subject: 'Subject',
    company: 'Company',
    submit: 'Send Message',
    success: 'Thank you! We\'ll get back to you soon.',
    error: 'Something went wrong. Please try again.',
    required: 'This field is required',
    invalidEmail: 'Please enter a valid email address'
  },
  es: {
    name: 'Nombre',
    email: 'Correo electrónico',
    phone: 'Teléfono',
    message: 'Mensaje',
    subject: 'Asunto',
    company: 'Empresa',
    submit: 'Enviar mensaje',
    success: '¡Gracias! Nos pondremos en contacto pronto.',
    error: 'Algo salió mal. Por favor, inténtalo de nuevo.',
    required: 'Este campo es obligatorio',
    invalidEmail: 'Por favor, introduce un correo electrónico válido'
  },
  he: {
    name: 'שם',
    email: 'אימייל',
    phone: 'טלפון',
    message: 'הודעה',
    subject: 'נושא',
    company: 'חברה',
    submit: 'שלח הודעה',
    success: '!תודה! נחזור אליך בקרוב',
    error: 'משהו השתבש. אנא נסה שוב.',
    required: 'שדה זה הוא חובה',
    invalidEmail: 'אנא הזן כתובת אימייל תקינה'
  }
};

export function ContactFormBlock({ content, styles, theme, locale, isRTL, className }: BlockRendererProps) {
  const {
    title,
    subtitle,
    fields = [
      { name: 'name', type: 'text', label: 'Name', required: true },
      { name: 'email', type: 'email', label: 'Email', required: true },
      { name: 'message', type: 'textarea', label: 'Message', required: true }
    ],
    submit_text,
    success_message
  } = content as ContactFormContent;

  const labels = LABELS[locale] || LABELS.en;
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const primaryColor = theme?.colors.primary || '#4F6EF7';

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
      // Submit to the public contact API
      const response = await fetch('/api/website/public/contact', {
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
    const key = field.name.toLowerCase() as keyof typeof labels;
    return field.label || (labels[key] as string) || field.name;
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
              className="w-16 h-16 mx-auto mb-6"
              style={{ color: primaryColor }}
            />
          </motion.div>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-xl text-gray-700 dark:text-gray-300"
            style={{ fontFamily: theme?.fonts.body }}
          >
            {success_message || labels.success}
          </motion.p>
        </div>
      </section>
    );
  }

  return (
    <section
      dir={isRTL ? 'rtl' : 'ltr'}
      id="contact"
      className={`${styles?.padding || 'py-16 sm:py-24'} ${styles?.background || 'bg-white dark:bg-slate-950'} ${className || ''}`}
    >
      <div className="max-w-xl mx-auto px-4 sm:px-6">
        {/* Header */}
        {(title || subtitle) && (
          <div className="text-center mb-10">
            {title && (
              <motion.h2
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white"
                style={{ fontFamily: theme?.fonts.heading }}
              >
                {title}
              </motion.h2>
            )}
            {subtitle && (
              <motion.p
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.1 }}
                className="mt-4 text-gray-600 dark:text-gray-300"
                style={{ fontFamily: theme?.fonts.body }}
              >
                {subtitle}
              </motion.p>
            )}
          </div>
        )}

        <motion.form
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2 }}
          onSubmit={handleSubmit}
          className="space-y-6"
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
                  className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 transition-all"
                  style={{
                    borderRadius: theme?.borderRadius || '0.5rem',
                    fontFamily: theme?.fonts.body
                  }}
                />
              ) : field.type === 'select' && field.options ? (
                <select
                  id={field.name}
                  name={field.name}
                  required={field.required}
                  value={formData[field.name] || ''}
                  onChange={(e) => setFormData({ ...formData, [field.name]: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 transition-all"
                  style={{
                    borderRadius: theme?.borderRadius || '0.5rem',
                    fontFamily: theme?.fonts.body
                  }}
                >
                  <option value="">{field.placeholder || `Select ${getFieldLabel(field)}`}</option>
                  {field.options.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              ) : (
                <input
                  id={field.name}
                  name={field.name}
                  type={field.type}
                  required={field.required}
                  placeholder={field.placeholder}
                  value={formData[field.name] || ''}
                  onChange={(e) => setFormData({ ...formData, [field.name]: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 transition-all"
                  style={{
                    borderRadius: theme?.borderRadius || '0.5rem',
                    fontFamily: theme?.fonts.body
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
                <Send className="w-5 h-5" />
                {submit_text || labels.submit}
              </>
            )}
          </button>
        </motion.form>
      </div>
    </section>
  );
}
