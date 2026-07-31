'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Send, Loader2, CheckCircle, Mail, Phone, MapPin, Clock } from 'lucide-react';
import PhoneInput from 'react-phone-number-input';
import { isValidPhoneNumber } from 'react-phone-number-input';
import 'react-phone-number-input/style.css';
import type { BlockRendererProps, FormField } from './types';
import type { Country } from 'react-phone-number-input';
import { WebsiteCountrySelect } from './WebsiteCountrySelect';

interface ContactFormContent {
  title?: string;
  subtitle?: string;
  fields?: FormField[];
  submit_text?: string;
  success_message?: string;
  recipient_email?: string;
  crm_integration?: boolean;
  // Contact info for sidebar
  business_email?: string;
  business_phone?: string;
  business_address?: string;
  business_hours?: string;
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
    invalidEmail: 'Please enter a valid email address',
    invalidPhone: 'Please enter a valid phone number',
    getInTouch: 'Get in Touch',
    contactInfo: 'Contact Information',
    sendUsMessage: 'Send us a message',
    address: 'Address',
    hours: 'Hours'
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
    invalidEmail: 'Por favor, introduce un correo electrónico válido',
    invalidPhone: 'Por favor, introduce un número de teléfono válido',
    getInTouch: 'Contáctanos',
    contactInfo: 'Información de contacto',
    sendUsMessage: 'Envíanos un mensaje',
    address: 'Dirección',
    hours: 'Horario'
  },
  he: {
    name: 'שם',
    email: 'אימייל',
    phone: 'טלפון',
    message: 'הודעה',
    subject: 'נושא',
    company: 'חברה',
    submit: 'שלח הודעה',
    success: 'תודה! נחזור אליך בקרוב.',
    error: 'משהו השתבש. אנא נסה שוב.',
    required: 'שדה זה הוא חובה',
    invalidEmail: 'אנא הזן כתובת אימייל תקינה',
    invalidPhone: 'אנא הזן מספר טלפון תקין',
    getInTouch: 'צור קשר',
    contactInfo: 'פרטי התקשרות',
    sendUsMessage: 'שלח לנו הודעה',
    address: 'כתובת',
    hours: 'שעות פעילות'
  }
};

export function ContactFormBlock({ content, styles, theme, locale, isRTL, className, subdomain }: BlockRendererProps) {
  const {
    title,
    subtitle,
    fields: rawFields = [
      { name: 'name', type: 'text', label: 'Name', required: true },
      { name: 'email', type: 'email', label: 'Email', required: true },
      { name: 'phone', type: 'tel', label: 'Phone', required: true },
      { name: 'message', type: 'textarea', label: 'Message', required: true }
    ],
    business_email,
    business_phone,
    business_address,
    business_hours
  } = content as ContactFormContent;

  // Ensure phone field exists and is required
  const hasPhoneField = rawFields.some(f => f.name === 'phone' || f.type === 'tel');
  const fields: FormField[] = hasPhoneField
    ? rawFields.map(f => (f.name === 'phone' || f.type === 'tel') ? { ...f, required: true } : f)
    : [
        ...rawFields.slice(0, 2), // name, email
        { name: 'phone', type: 'tel' as const, label: 'Phone', required: true },
        ...rawFields.slice(2) // message and rest
      ];

  const labels = LABELS[locale] || LABELS.en;
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [phoneCountry, setPhoneCountry] = useState<Country>('US');

  const primaryColor = theme?.colors.primary || '#4F6EF7';
  const hasContactInfo = business_email || business_phone || business_address || business_hours;

  const validateField = (field: FormField, value: string): string | null => {
    if (field.required && !value?.trim()) {
      return labels.required;
    }
    if (field.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return labels.invalidEmail;
    }
    if (field.type === 'tel' && value && !isValidPhoneNumber(value)) {
      return labels.invalidPhone;
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
      // Submit to the contact form API with subdomain for CRM integration
      const response = await fetch('/api/website/forms/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subdomain,
          name: formData.name,
          email: formData.email,
          phone: formData.phone,
          message: formData.message,
          service_interest: formData.subject || formData.service,
          page_url: typeof window !== 'undefined' ? window.location.href : undefined
        })
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
    // Prioritize localized labels over field.label (which may be English)
    const key = field.name.toLowerCase() as keyof typeof labels;
    const localizedLabel = labels[key] as string | undefined;
    // Use localized label if available, otherwise fall back to field.label or field.name
    return localizedLabel || field.label || field.name;
  };

  // Success state
  if (submitted) {
    return (
      <section
        dir={isRTL ? 'rtl' : 'ltr'}
        className={`${styles?.padding || 'py-12 sm:py-16'} ${styles?.background || 'bg-gray-50 dark:bg-slate-900'} ${className || ''}`}
      >
        <div className="max-w-xl mx-auto px-4 sm:px-6 text-center">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', duration: 0.5 }}
          >
            <CheckCircle
              className="w-14 h-14 mx-auto mb-4"
              style={{ color: primaryColor }}
            />
          </motion.div>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-lg text-gray-700 dark:text-gray-300"
            style={{ fontFamily: theme?.fonts.body }}
          >
            {labels.success}
          </motion.p>
        </div>
      </section>
    );
  }

  return (
    <section
      dir={isRTL ? 'rtl' : 'ltr'}
      id="contact"
      className={`${styles?.padding || 'py-12 sm:py-16'} ${styles?.background || 'bg-gray-50 dark:bg-slate-900'} ${className || ''}`}
    >
      <div className="max-w-4xl mx-auto px-4 sm:px-6">
        {/* Header */}
        {(title || subtitle) && (
          <div className="text-center mb-8">
            {title && (
              <motion.h2
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white"
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
                className="mt-2 text-gray-600 dark:text-gray-300"
                style={{ fontFamily: theme?.fonts.body }}
              >
                {subtitle}
              </motion.p>
            )}
          </div>
        )}

        {/* Two-column layout: Contact Info + Form */}
        {/* In RTL: sidebar on right (start), form on left (end) */}
        {/* In LTR: form on left (start), sidebar on right (end) */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2 }}
          className={`flex flex-col ${hasContactInfo ? (isRTL ? 'lg:flex-row-reverse' : 'lg:flex-row') : ''} gap-6 lg:gap-8`}
        >
          {/* Form - First in DOM, displays on start side */}
          <div className={`${hasContactInfo ? 'lg:w-3/5' : 'w-full'}`}>
            <form
              onSubmit={handleSubmit}
              noValidate
              className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm"
              style={{ borderRadius: theme?.borderRadius || '0.75rem' }}
            >
              {hasContactInfo && (
                <h3
                  className="text-lg font-semibold text-gray-900 dark:text-white mb-5"
                  style={{ fontFamily: theme?.fonts.heading }}
                >
                  {labels.sendUsMessage}
                </h3>
              )}

              <div className="space-y-4">
                {fields.map((field) => (
                  <div key={field.name}>
                    <label
                      htmlFor={field.name}
                      className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
                    >
                      {getFieldLabel(field)}
                      {field.required && <span className="text-red-500 ms-1">*</span>}
                    </label>

                    {field.type === 'textarea' ? (
                      <textarea
                        id={field.name}
                        name={field.name}
                        rows={3}
                        placeholder={field.placeholder}
                        value={formData[field.name] || ''}
                        onChange={(e) => {
                          setFormData({ ...formData, [field.name]: e.target.value });
                          if (errors[field.name]) {
                            setErrors({ ...errors, [field.name]: '' });
                          }
                        }}
                        className={`w-full px-3 py-2.5 bg-gray-50 dark:bg-slate-700 border text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 transition-all text-sm ${
                          errors[field.name]
                            ? 'border-red-500 focus:ring-red-200'
                            : 'border-gray-200 dark:border-gray-600 focus:ring-blue-200'
                        }`}
                        style={{
                          borderRadius: theme?.borderRadius || '0.5rem',
                          fontFamily: theme?.fonts.body
                        }}
                      />
                    ) : field.type === 'tel' ? (
                      <div dir="ltr" className="flex gap-2">
                        <WebsiteCountrySelect
                          value={phoneCountry}
                          onChange={setPhoneCountry}
                          isRTL={isRTL}
                          hasError={!!errors[field.name]}
                        />
                        <div className={`phone-input-contact flex-1 ${errors[field.name] ? 'has-error' : ''}`}>
                          <PhoneInput
                            international
                            countryCallingCodeEditable={false}
                            country={phoneCountry}
                            defaultCountry="US"
                            value={formData[field.name] || ''}
                            onChange={(value) => {
                              setFormData({ ...formData, [field.name]: value || '' });
                              if (errors[field.name]) {
                                setErrors({ ...errors, [field.name]: '' });
                              }
                            }}
                            onCountryChange={(country) => country && setPhoneCountry(country)}
                          />
                        </div>
                      </div>
                    ) : field.type === 'select' && field.options ? (
                      <select
                        id={field.name}
                        name={field.name}
                        value={formData[field.name] || ''}
                        onChange={(e) => {
                          setFormData({ ...formData, [field.name]: e.target.value });
                          if (errors[field.name]) {
                            setErrors({ ...errors, [field.name]: '' });
                          }
                        }}
                        className={`w-full px-3 py-2.5 bg-gray-50 dark:bg-slate-700 border text-gray-900 dark:text-white focus:outline-none focus:ring-2 transition-all text-sm ${
                          errors[field.name]
                            ? 'border-red-500 focus:ring-red-200'
                            : 'border-gray-200 dark:border-gray-600 focus:ring-blue-200'
                        }`}
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
                        type={field.type === 'email' ? 'text' : field.type}
                        placeholder={field.placeholder}
                        value={formData[field.name] || ''}
                        onChange={(e) => {
                          setFormData({ ...formData, [field.name]: e.target.value });
                          if (errors[field.name]) {
                            setErrors({ ...errors, [field.name]: '' });
                          }
                        }}
                        className={`w-full px-3 py-2.5 bg-gray-50 dark:bg-slate-700 border text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 transition-all text-sm ${
                          errors[field.name]
                            ? 'border-red-500 focus:ring-red-200'
                            : 'border-gray-200 dark:border-gray-600 focus:ring-blue-200'
                        }`}
                        style={{
                          borderRadius: theme?.borderRadius || '0.5rem',
                          fontFamily: theme?.fonts.body
                        }}
                      />
                    )}

                    {errors[field.name] && (
                      <p className="mt-1 text-xs text-red-500">{errors[field.name]}</p>
                    )}
                  </div>
                ))}

                {errors._form && (
                  <p className="text-sm text-red-500 text-center">{errors._form}</p>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full flex items-center justify-center gap-2 px-5 py-3 text-white font-semibold shadow-md hover:opacity-90 disabled:opacity-50 transition-all text-sm"
                  style={{
                    backgroundColor: primaryColor,
                    borderRadius: theme?.borderRadius || '0.5rem'
                  }}
                >
                  {submitting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      {labels.submit}
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>

          {/* Contact Info Sidebar */}
          {hasContactInfo && (
            <div className="lg:w-2/5">
              <div
                className="h-full p-6 rounded-xl"
                style={{
                  backgroundColor: primaryColor,
                  borderRadius: theme?.borderRadius || '0.75rem'
                }}
              >
                <h3
                  className="text-lg font-semibold text-white mb-6"
                  style={{ fontFamily: theme?.fonts.heading }}
                >
                  {labels.contactInfo}
                </h3>

                <div className="space-y-5">
                  {business_email && (
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center flex-shrink-0">
                        <Mail className="w-5 h-5 text-white" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-white/70 text-sm mb-0.5">{labels.email}</p>
                        <a
                          href={`mailto:${business_email}`}
                          className="text-white font-medium hover:underline break-all text-sm"
                        >
                          {business_email}
                        </a>
                      </div>
                    </div>
                  )}

                  {business_phone && (
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center flex-shrink-0">
                        <Phone className="w-5 h-5 text-white" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-white/70 text-sm mb-0.5">{labels.phone}</p>
                        <a
                          href={`tel:${business_phone}`}
                          className="text-white font-medium hover:underline text-sm"
                          dir="ltr"
                        >
                          {business_phone}
                        </a>
                      </div>
                    </div>
                  )}

                  {business_address && (
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center flex-shrink-0">
                        <MapPin className="w-5 h-5 text-white" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-white/70 text-sm mb-0.5">{labels.address}</p>
                        <p className="text-white font-medium text-sm">{business_address}</p>
                      </div>
                    </div>
                  )}

                  {business_hours && (
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center flex-shrink-0">
                        <Clock className="w-5 h-5 text-white" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-white/70 text-sm mb-0.5">{labels.hours}</p>
                        <p className="text-white font-medium text-sm whitespace-pre-line">{business_hours}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </motion.div>
      </div>

      {/* Phone input styling */}
      {/* Using custom WebsiteCountrySelect, so hiding built-in country selector */}
      <style jsx global>{`
        /* react-phone-number-input custom styling for contact form */
        .phone-input-contact .PhoneInput {
          display: flex;
          width: 100%;
        }

        /* Hide built-in country selector - we use WebsiteCountrySelect instead */
        .phone-input-contact .PhoneInputCountry {
          display: none !important;
        }

        .phone-input-contact .PhoneInputInput {
          flex: 1;
          width: 100%;
          padding: 10px 12px;
          background: rgb(249, 250, 251) !important;
          border: 1px solid rgb(229, 231, 235) !important;
          border-radius: 0.5rem;
          font-size: 14px;
          color: rgb(17, 24, 39) !important;
          outline: none;
          transition: all 0.2s ease;
          min-height: 42px;
        }

        .phone-input-contact .PhoneInputInput:focus {
          border-color: #3b82f6 !important;
          box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
        }

        .phone-input-contact .PhoneInputInput::placeholder {
          color: rgb(156, 163, 175);
        }

        .phone-input-contact.has-error .PhoneInputCountry,
        .phone-input-contact.has-error .PhoneInputInput {
          border-color: rgb(239, 68, 68);
        }

        .phone-input-contact.has-error .PhoneInputInput:focus {
          box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.2);
        }
      `}</style>
    </section>
  );
}
