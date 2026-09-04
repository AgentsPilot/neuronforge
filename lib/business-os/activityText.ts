/**
 * What an activity says, written in the business's language when it happens.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * An activity is a record of something that occurred, not a label on the screen.
 * It is written once, in the language the business was working in, and it stays
 * that way — the same as a note somebody typed. Switching the dashboard to
 * English later does not rewrite what happened last March, and should not: a
 * history that re-narrates itself is not a history.
 *
 * So the sentence is composed HERE, on the server, at the moment of the event —
 * not deferred to the drawer. Descriptions were written in English regardless of
 * the business, which is the actual bug: a Hebrew practice read "Confirmation
 * email sent for booking on 9/7/2026" in its own timeline.
 *
 * The stored value carries the sentence AND the facts behind it:
 *
 *   { text: "המועד הועבר מ־7 בספט׳ 13:00 ל־23 בספט׳ 13:00", kind, from, to }
 *
 * The drawer prints `text` exactly as stored, and uses the rest for the
 * drill-down — so the row never has to be re-translated, and the before/after
 * is still there to open.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type ActivityLocale = 'en' | 'es' | 'he';

const SENTENCES: Record<string, Record<ActivityLocale, string>> = {
  booking_created: {
    en: 'Booking created: {service}',
    es: 'Reserva creada: {service}',
    he: 'נקבעה פגישה: {service}',
  },
  booking_created_dated: {
    en: 'Booking created: {service}, for {date}',
    es: 'Reserva creada: {service}, para el {date}',
    he: 'נקבעה פגישה: {service}, ל־{date}',
  },
  booking_rescheduled: {
    en: 'Appointment moved from {from} to {to}',
    es: 'Cita movida del {from} al {to}',
    he: 'המועד הועבר מ־{from} ל־{to}',
  },
  confirmation_sent: {
    en: 'Confirmation email sent for {service}',
    es: 'Correo de confirmación enviado para {service}',
    he: 'מייל אישור נשלח עבור {service}',
  },
  intake_sent: {
    en: 'Intake form requested for {service}',
    es: 'Formulario solicitado para {service}',
    he: 'טופס קליטה נשלח עבור {service}',
  },
  booking_cancelled: {
    en: 'Appointment cancelled — was {date}',
    es: 'Cita cancelada — era el {date}',
    he: 'הפגישה בוטלה — הייתה ב־{date}',
  },
  website_contact_form: {
    en: 'Contact form submitted from your website',
    es: 'Formulario de contacto enviado desde tu web',
    he: 'טופס יצירת קשר נשלח מהאתר שלך',
  },
  intake_completed: {
    en: 'Intake form completed: {template}',
    es: 'Formulario completado: {template}',
    he: 'טופס הקליטה מולא: {template}',
  },
  payment_received: {
    en: 'Payment received: {amount}',
    es: 'Pago recibido: {amount}',
    he: 'התקבל תשלום: {amount}',
  },
  payment_received_for: {
    en: 'Payment received: {amount} for {service}',
    es: 'Pago recibido: {amount} por {service}',
    he: 'התקבל תשלום: {amount} עבור {service}',
  },
  booking_completed: {
    en: 'Appointment completed — {date}',
    es: 'Cita completada — {date}',
    he: 'הפגישה התקיימה — {date}',
  },
  booking_no_show: {
    en: 'Client did not show — {date}',
    es: 'El cliente no se presentó — {date}',
    he: 'הלקוח לא הגיע — {date}',
  },
  booking_confirmed: {
    en: 'Appointment confirmed — {date}',
    es: 'Cita confirmada — {date}',
    he: 'הפגישה אושרה — {date}',
  },
  payment_failed: {
    en: 'Payment failed: {amount}',
    es: 'Pago fallido: {amount}',
    he: 'התשלום נכשל: {amount}',
  },
  refund_issued: {
    en: 'Refund issued: {amount}',
    es: 'Reembolso emitido: {amount}',
    he: 'הוחזר תשלום: {amount}',
  },
  contact_created: {
    en: 'Contact added',
    es: 'Contacto añadido',
    he: 'איש קשר נוסף',
  },
  contact_created_from: {
    en: 'Contact added from {source}',
    es: 'Contacto añadido desde {source}',
    he: 'איש קשר נוסף מ־{source}',
  },
  document_uploaded: {
    en: 'File added: {file}',
    es: 'Archivo añadido: {file}',
    he: 'קובץ נוסף: {file}',
  },
  task_created: {
    en: 'Task added: {task}',
    es: 'Tarea añadida: {task}',
    he: 'נוספה משימה: {task}',
  },
  task_completed: {
    en: 'Task completed: {task}',
    es: 'Tarea completada: {task}',
    he: 'המשימה הושלמה: {task}',
  },
  contact_updated: {
    en: 'Details updated: {fields}',
    es: 'Datos actualizados: {fields}',
    he: 'הפרטים עודכנו: {fields}',
  },
  stage_changed: {
    en: 'Stage changed: {fields}',
    es: 'Etapa cambiada: {fields}',
    he: 'השלב שונה: {fields}',
  },
};

/** Field names as a person knows them, for the "details updated" sentence. */
const FIELD_NAMES: Record<string, Record<ActivityLocale, string>> = {
  first_name: { en: 'first name', es: 'nombre', he: 'שם פרטי' },
  last_name: { en: 'last name', es: 'apellido', he: 'שם משפחה' },
  email: { en: 'email', es: 'correo', he: 'אימייל' },
  phone: { en: 'phone', es: 'teléfono', he: 'טלפון' },
  stage: { en: 'stage', es: 'etapa', he: 'שלב' },
  source: { en: 'source', es: 'origen', he: 'מקור' },
  company: { en: 'company', es: 'empresa', he: 'חברה' },
  notes: { en: 'notes', es: 'notas', he: 'הערות' },
};

const asLocale = (value?: string | null): ActivityLocale =>
  value === 'he' || value === 'es' ? value : 'en';

export function activityFieldName(field: string, locale?: string | null): string {
  return FIELD_NAMES[field]?.[asLocale(locale)] ?? field.replace(/_/g, ' ');
}

/**
 * A booking time as the business keeps it — short, and in its own timezone.
 *
 * Falls back to the raw value rather than throwing: a malformed date must not
 * stop the activity being recorded.
 */
export function activityMoment(
  value: string | null | undefined,
  locale?: string | null,
  timeZone?: string | null
): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  // A booking with no time reaches here as the epoch; it has no date to state.
  if (date.getUTCFullYear() <= 1970) return null;

  const tag = asLocale(locale) === 'he' ? 'he-IL' : asLocale(locale) === 'es' ? 'es-ES' : 'en-US';
  return date.toLocaleString(tag, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: asLocale(locale) === 'en',
    ...(timeZone ? { timeZone } : {}),
  });
}

/** One sentence, in the business's language, with `{name}` values filled in. */
export function activitySentence(
  key: string,
  values: Record<string, string>,
  locale?: string | null
): string {
  const template = SENTENCES[key]?.[asLocale(locale)] ?? SENTENCES[key]?.en ?? key;
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replace(`{${name}}`, value),
    template
  );
}

/**
 * The value stored in `crm_activities.description`.
 *
 * `text` is what the drawer prints, exactly as written. Everything else is the
 * detail behind it, for the row's drill-down.
 */
export function activityRecord(
  text: string,
  facts: Record<string, unknown>
): string {
  return JSON.stringify({ text, ...facts });
}
