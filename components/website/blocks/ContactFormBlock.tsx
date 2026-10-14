'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Send, Loader2, CheckCircle, Mail, Phone, MapPin, Clock } from 'lucide-react';
/*
 * BR-2: the phone library (about 50 kB gz) is NOT imported here. It arrives
 * after the page has painted through `usePhoneLib`, and the phone row shows
 * `PublicPhoneFieldPlaceholder` until then. One static value import of the
 * library, `phoneField` or `WebsiteCountrySelect` puts it back into every
 * public site page's first download; `phoneLibLazy.guard.test.ts` fails if one
 * appears. The stylesheet stays static (no unstyled frame, and CSS is not
 * First Load JS), and `import type` is erased at build.
 */
import 'react-phone-number-input/style.css';
import type { BlockRendererProps, FormField } from './types';
import type { Country } from 'react-phone-number-input';
import { usePhoneLib, loadPhoneLib, type PhoneLib } from '@/components/crm/usePhoneLib';
import { publicFormCountry } from '@/components/crm/publicFormCountry';
import { PublicPhoneFieldPlaceholder } from './PublicPhoneFieldPlaceholder';
import { ConsentCheckbox } from '@/components/public/ConsentCheckbox';
import { useConsentCopy, consentPayload } from '@/hooks/useConsentCopy';

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
    phoneUnavailable: 'The phone field could not load. Please try again.',
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
    phoneUnavailable: 'No se pudo cargar el campo de teléfono. Por favor, inténtalo de nuevo.',
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
    phoneUnavailable: 'לא ניתן היה לטעון את שדה הטלפון. אנא נסה שוב.',
    getInTouch: 'צור קשר',
    contactInfo: 'פרטי התקשרות',
    sendUsMessage: 'שלח לנו הודעה',
    address: 'כתובת',
    hours: 'שעות פעילות'
  }
};

// Helper to normalize field definitions - handles both string arrays and object arrays
function normalizeFields(fields: unknown): FormField[] {
  const defaultFields: FormField[] = [
    { name: 'name', type: 'text', label: 'Name', required: true },
    { name: 'email', type: 'email', label: 'Email', required: true },
    { name: 'phone', type: 'tel', label: 'Phone', required: true },
    { name: 'message', type: 'textarea', label: 'Message', required: true }
  ];

  /*
   * AN EMPTY LIST IS NOT A CONFIGURATION, IT IS THE ABSENCE OF ONE.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * This read `!fields || !Array.isArray(fields)`, so the defaults applied only
   * to a value that was not an array at all. `[]` IS an array, and it mapped to
   * nothing — and every `contact_form` block in the database stores exactly
   * that: all ten of them, on every page, generated that way.
   *
   * What rendered was the single phone box the guard below appends, with no
   * name, no email and no message. The form could be filled in and sent, and
   * `/api/website/forms/contact` requires `email` and a non-empty `message`, so
   * every submission came back 400 and the visitor was shown the generic
   * failure. One contact has ever been captured through this form.
   *
   * A form with no fields cannot be a deliberate choice: there is nothing to
   * submit and nothing the route would accept. So an empty list falls back the
   * same way a missing one does.
   * ───────────────────────────────────────────────────────────────────────────
   */
  if (!fields || !Array.isArray(fields) || fields.length === 0) {
    return defaultFields;
  }

  return fields.map((field): FormField => {
    // If field is a string like 'name', 'email', 'message'
    if (typeof field === 'string') {
      const fieldName = field.toLowerCase();
      const type = fieldName === 'email' ? 'email' : fieldName === 'phone' ? 'tel' : fieldName === 'message' ? 'textarea' : 'text';
      return { name: fieldName, type, label: field, required: true };
    }
    // If field is already an object with name property
    if (field && typeof field === 'object' && 'name' in field) {
      return field as FormField;
    }
    // Fallback
    return { name: 'field', type: 'text', label: 'Field', required: false };
  });
}

export function ContactFormBlock({ content, styles, theme, locale, isRTL, className, subdomain, userCode }: BlockRendererProps) {
  const {
    title,
    subtitle,
    fields: rawFieldsInput,
    business_email,
    business_phone,
    business_address,
    business_hours
  } = content as ContactFormContent & { fields?: unknown };

  // Normalize fields to handle both string arrays and object arrays
  const rawFields = normalizeFields(rawFieldsInput);

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
  /*
   * The page's language decides, not a hardcoded US. A Hebrew site's visitors
   * had to correct the dropdown before they could type their own number.
   */
  const [phoneCountry, setPhoneCountry] = useState<Country>(() => publicFormCountry(locale));

  /*
   * BR-2: the phone library, or null until it arrives. Mounting this starts the
   * download after hydration with no click (FR-2.2), and every re-render while
   * it is missing (the visitor typing in another field) retries a failed one
   * (FR-2.6).
   */
  const phoneLib = usePhoneLib();
  /*
   * The real number box's wrapper. The hand-off focuses the `<input>` inside
   * it: the library's typings describe its `ref` as a class instance even
   * though it forwards to the input, so a wrapper query is the typed route.
   */
  const phoneBoxRef = useRef<HTMLDivElement>(null);
  // Focus is on the placeholder and should move into the real box (FR-2.4).
  const phoneFocusPending = useRef(false);
  // A submit is waiting for the library; a second press must not wait again.
  const waitingForPhoneLib = useRef(false);
  /*
   * The visitor's CURRENT values. A submit that waits for the library reads
   * these after the wait, so whatever was typed into the other fields during
   * it is validated and sent, not the values captured when Send was pressed.
   */
  const formDataRef = useRef(formData);
  formDataRef.current = formData;

  /*
   * Marketing consent. Unticked, and it stays unticked unless the visitor acts.
   * `null` copy means this business does not collect it, or the lookup failed —
   * either way the checkbox is absent rather than unlabelled.
   */
  const consentCopy = useConsentCopy({ subdomain, userCode, locale });
  const [consentGiven, setConsentGiven] = useState(false);

  const primaryColor = theme?.colors.primary || '#4F6EF7';
  const hasContactInfo = business_email || business_phone || business_address || business_hours;

  /*
   * The focus hand-off (FR-2.4, RC-3). Only when focus was LOST by the
   * placeholder's removal: if the visitor has since moved to another field,
   * that field keeps it.
   */
  useEffect(() => {
    if (!phoneLib || !phoneFocusPending.current) return;
    phoneFocusPending.current = false;
    const active = document.activeElement;
    if (active === null || active === document.body) {
      phoneBoxRef.current?.querySelector('input')?.focus();
    }
  }, [phoneLib]);

  // A "could not load" message is stale once the field has loaded (RC-1c).
  const phoneUnavailableMessage = labels.phoneUnavailable;
  useEffect(() => {
    if (!phoneLib) return;
    setErrors(prev =>
      prev._form === phoneUnavailableMessage ? { ...prev, _form: '' } : prev
    );
  }, [phoneLib, phoneUnavailableMessage]);

  const validateField = (lib: PhoneLib, field: FormField, value: string): string | null => {
    if (field.required && !value?.trim()) {
      return labels.required;
    }
    if (field.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return labels.invalidEmail;
    }
    if (field.type === 'tel' && value && !lib.isValidPhoneNumber(value)) {
      return labels.invalidPhone;
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    /*
     * BR-2 (FR-2.5, FR-2.6). With the library loaded (the normal case) this is
     * skipped and the submit below runs exactly as before.
     *
     * Pressed before it arrives: the button shows its normal sending state
     * while the download finishes, then validates as always. The placeholder
     * is read-only and only `PhoneInput` ever sets `formData.phone`, so in this
     * path the phone is ALWAYS empty: once the library arrives the outcome is
     * the usual "required" message on the phone field and nothing is sent. The
     * wait exists so that a load that FAILS shows "could not load, try again"
     * rather than a "required" the visitor has no way to satisfy. Nothing is
     * ever sent without a checked phone (BQ-5).
     */
    let lib = phoneLib;
    if (!lib) {
      if (waitingForPhoneLib.current) return;
      waitingForPhoneLib.current = true;
      setSubmitting(true);
      lib = await loadPhoneLib();
      waitingForPhoneLib.current = false;
      if (!lib) {
        setErrors({ _form: labels.phoneUnavailable });
        setSubmitting(false);
        return;
      }
    }
    const loadedLib: PhoneLib = lib;

    const current = formDataRef.current;

    // Validate all fields
    const newErrors: Record<string, string> = {};
    fields.forEach(field => {
      const error = validateField(loadedLib, field, current[field.name] || '');
      if (error) newErrors[field.name] = error;
    });

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      // Only the waiting path above set it; a no-op otherwise.
      setSubmitting(false);
      return;
    }

    setSubmitting(true);
    setErrors({});

    try {
      // Submit to the contact form API with subdomain or userCode for CRM integration
      const response = await fetch('/api/website/forms/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subdomain,
          userCode,
          name: current.name,
          email: current.email,
          phone: current.phone,
          message: current.message,
          service_interest: current.subject || current.service,
          page_url: typeof window !== 'undefined' ? window.location.href : undefined,
          consent: consentPayload(consentCopy, consentGiven)
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
    // Handle cases where field.name might be undefined
    if (!field.name) {
      return field.label || 'Field';
    }
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
        className={`${styles?.padding || 'py-12 sm:py-16'} ${styles?.background || 'ap-card-2'} ${className || ''}`}
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
            className="text-lg ap-ink-2"
            style={{ fontFamily: 'var(--ap-font-body)' }}
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
      className={`${styles?.padding || 'py-12 sm:py-16'} ${styles?.background || 'ap-card-2'} ${className || ''}`}
    >
      <div className="max-w-4xl mx-auto px-4 sm:px-6">
        {/* Header */}
        <div className="text-center mb-8">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-2xl sm:text-3xl font-bold ap-ink"
            style={{ fontFamily: 'var(--ap-font-heading)' }}
          >
            {labels.getInTouch}
          </motion.h2>
          {subtitle && (
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="mt-2 ap-ink-2"
              style={{ fontFamily: 'var(--ap-font-body)' }}
            >
              {subtitle}
            </motion.p>
          )}
        </div>

        {/*
          Two columns: the form, then the details.

          Plain `lg:flex-row` — the section already carries `dir`, so a row runs
          start-to-end on its own and the two columns mirror for free: form at
          the start, details at the end, which is left/right in English and
          right/left in Hebrew.

          This was `isRTL ? 'lg:flex-row-reverse' : 'lg:flex-row'`, which
          reversed a row that `dir` had already reversed — so the form sat on
          the LEFT in both directions and a Hebrew page opened its contact
          section on the wrong side. Setting `dir` and then reversing by hand is
          always one correction too many.
        */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2 }}
          className={`flex flex-col ${hasContactInfo ? 'lg:flex-row' : ''} gap-6 lg:gap-8`}
        >
          {/* Form - First in DOM, displays on start side */}
          <div className={`${hasContactInfo ? 'lg:w-3/5' : 'w-full'}`}>
            <form
              onSubmit={handleSubmit}
              noValidate
              className="ap-card p-6 rounded-xl shadow-sm"
              style={{ borderRadius: theme?.borderRadius || '0.75rem' }}
            >
              {hasContactInfo && (
                <h3
                  className="text-lg font-semibold ap-ink mb-5"
                  style={{ fontFamily: 'var(--ap-font-heading)' }}
                >
                  {labels.sendUsMessage}
                </h3>
              )}

              <div className="space-y-4">
                {fields.map((field) => (
                  <div key={field.name}>
                    <label
                      htmlFor={field.name}
                      className="block text-sm font-medium ap-ink-2 mb-1.5"
                    >
                      {getFieldLabel(field)}
                      {field.required && <span className="ap-danger ms-1">*</span>}
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
                        className={`w-full px-3 py-2.5 ap-card-2 border ap-ink ap-placeholder focus:outline-none focus:ring-2 transition-all text-sm ${
                          errors[field.name]
                            ? 'ap-danger-line ap-ring-danger'
                            : 'ap-line ap-ring'
                        }`}
                        style={{
                          borderRadius: theme?.borderRadius || '0.5rem',
                          fontFamily: 'var(--ap-font-body)'
                        }}
                      />
                    ) : field.type === 'tel' ? (
                      <div dir="ltr" className="flex gap-2">
                        {phoneLib ? (
                          <>
                            <phoneLib.WebsiteCountrySelect
                              value={phoneCountry}
                              /*
                                Choosing a country is a statement about the NUMBER.
                                Wired to the state alone, a visitor who picked their
                                country saw the dropdown move and their number stay
                                national — and a national number with a bare `+` in
                                front of it dials somewhere else entirely.
                              */
                              onChange={(country) => {
                                setPhoneCountry(country);
                                setFormData({
                                  ...formData,
                                  [field.name]:
                                    phoneLib.applyCountryToPhone(formData[field.name], country) ??
                                    formData[field.name],
                                });
                              }}
                              isRTL={isRTL}
                              hasError={!!errors[field.name]}
                            />
                            <div
                              ref={phoneBoxRef}
                              className={`phone-input-contact flex-1 ${errors[field.name] ? 'has-error' : ''}`}
                            >
                              <phoneLib.PhoneInput
                                /*
                                  The label's target, before and after the swap.
                                  Without it the label pointed at nothing.
                                */
                                id={field.name}
                                countryCallingCodeEditable={false}
                                country={phoneCountry}
                                /* The page's own language decides, not a fixed US. */
                                defaultCountry={phoneCountry}
                                value={phoneLib.phoneFieldValue(formData[field.name], phoneCountry) ?? ''}
                                onChange={(value) => {
                                  setFormData({ ...formData, [field.name]: value || '' });
                                  if (errors[field.name]) {
                                    setErrors({ ...errors, [field.name]: '' });
                                  }
                                }}
                                onCountryChange={(country) => country && setPhoneCountry(country)}
                              />
                            </div>
                          </>
                        ) : (
                          <PublicPhoneFieldPlaceholder
                            inputId={field.name}
                            country={publicFormCountry(locale)}
                            hasError={!!errors[field.name]}
                            onFocusWaiting={() => {
                              phoneFocusPending.current = true;
                            }}
                            onFocusMovedAway={() => {
                              phoneFocusPending.current = false;
                            }}
                          />
                        )}
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
                        className={`w-full px-3 py-2.5 ap-card-2 border ap-ink focus:outline-none focus:ring-2 transition-all text-sm ${
                          errors[field.name]
                            ? 'ap-danger-line ap-ring-danger'
                            : 'ap-line ap-ring'
                        }`}
                        style={{
                          borderRadius: theme?.borderRadius || '0.5rem',
                          fontFamily: 'var(--ap-font-body)'
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
                        className={`w-full px-3 py-2.5 ap-card-2 border ap-ink ap-placeholder focus:outline-none focus:ring-2 transition-all text-sm ${
                          errors[field.name]
                            ? 'ap-danger-line ap-ring-danger'
                            : 'ap-line ap-ring'
                        }`}
                        style={{
                          borderRadius: theme?.borderRadius || '0.5rem',
                          fontFamily: 'var(--ap-font-body)'
                        }}
                      />
                    )}

                    {errors[field.name] && (
                      <p className="mt-1 ap-danger">{errors[field.name]}</p>
                    )}
                  </div>
                ))}

                {errors._form && (
                  <p className="ap-danger text-center">{errors._form}</p>
                )}

                {/*
                  Above the button, below the fields — read before the decision
                  to submit, not after it. Never validated, never required.
                */}
                {consentCopy && (
                  <ConsentCheckbox
                    copy={consentCopy}
                    checked={consentGiven}
                    onChange={setConsentGiven}
                    disabled={submitting}
                    isRTL={isRTL}
                  />
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
                  style={{ fontFamily: 'var(--ap-font-heading)' }}
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

        /*
         * The third-party phone field, on the business's own colours.
         *
         * These were hardcoded light greys with !important — a near-white
         * fill and near-black text — so on a dark template the phone row was a
         * white box in the middle of a column of dark ones. It is the single
         * most obvious "this part is not ours" element on the page, and it sits
         * in the form a visitor is being asked to trust.
         *
         * The !important flags are kept only where they were already needed to
         * beat the library's own stylesheet, now carrying the template's tokens
         * instead of somebody's greys.
         */
        .phone-input-contact .PhoneInputInput {
          flex: 1;
          width: 100%;
          padding: 10px 12px;
          background: var(--ap-surface) !important;
          border: 1px solid var(--ap-border) !important;
          border-radius: var(--ap-radius-md);
          font-family: var(--ap-font-body);
          font-size: 14px;
          color: var(--ap-text) !important;
          outline: none;
          transition: all 0.2s ease;
          min-height: 42px;
        }

        .phone-input-contact .PhoneInputInput:focus {
          border-color: var(--ap-brand) !important;
          box-shadow: 0 0 0 2px var(--ap-brand-ring);
        }

        .phone-input-contact .PhoneInputInput::placeholder {
          color: var(--ap-text-muted);
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
