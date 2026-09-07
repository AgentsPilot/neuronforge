/**
 * Everything a customer reads on a public page, in the business's language.
 *
 * WHY THIS EXISTS
 *
 * These pages are token- or code-addressed and the reader is the business's
 * CLIENT, not the account holder. There is no `LanguageProvider` above them and
 * no session to read a preference from, so each page grew its own translation
 * table. There were eight, five of them covering overlapping strings, and the
 * `{name}`-substitution helper was written out four separate times.
 *
 * The cost was not duplication, it was drift. `questionsContact` existed in
 * three of them. `backToBooking` was translated in one table and hardcoded in
 * English on the page that owned it. The cancel page had no table at all, so a
 * Hebrew client pressed "ביטול הפגישה" and landed on an English left-to-right
 * screen with `en-US` dates.
 *
 * One catalogue, and a formatter beside it, because a date printed `en-US`
 * under a Hebrew heading is the same bug as an untranslated string.
 *
 * ISOMORPHIC on purpose — no `server-only`, no repository imports — because
 * four of the pages that need it are client components.
 *
 * @module lib/i18n/public-pages
 */

import { defaultLocale, isValidLocale, type Locale } from '@/lib/i18n/config';

type Catalogue = Record<Locale, Record<string, string>>;

export const publicMessages: Catalogue = {
  en: {
    // ── Booking management ────────────────────────────────────────────────
    manageBooking: 'Manage Your Booking',
    cancelled: 'Cancelled',
    confirmed: 'Confirmed',
    pending: 'Pending',
    yourDetails: 'Your Details',
    notes: 'Notes',
    reschedule: 'Reschedule Appointment',
    cancel: 'Cancel Appointment',
    cannotModify: 'Changes can only be made more than 24 hours before your appointment.',
    questionsContact: 'Questions? Contact {name} directly.',
    bookingNotFound: 'Booking Not Found',
    bookingNotFoundDesc: 'This booking link may have expired or the booking no longer exists.',
    min: 'min',

    // ── Reschedule ────────────────────────────────────────────────────────
    selectNewTime: 'Select a new date and time',
    confirmNewTime: 'Confirm New Time',
    loadingTimes: 'Loading available times...',
    noTimesAvailable: 'No times available on this day',
    pickAnotherDay: 'Please pick another day.',
    currentAppointment: 'Current appointment',
    rescheduling: 'Rescheduling…',
    rescheduleFailed: 'Could not reschedule. Please try again.',
    back: 'Back',
    cannotReschedule: 'Cannot Reschedule',
    backToBooking: 'Back to booking',
    rescheduledTitle: 'Booking Rescheduled!',
    rescheduledDesc: 'Your appointment has been rescheduled.',
    newAppointmentTime: 'New appointment time',
    confirmationEmail: 'You will receive a confirmation email shortly.',
    loadFailed: 'Failed to load reschedule options',
    weekdaysShort: 'Sun,Mon,Tue,Wed,Thu,Fri,Sat',
    viewUpdatedBooking: 'View Updated Booking',
    timesShownIn: 'All times are shown in {zone}, the business’s local time.',

    // ── Cancellation ──────────────────────────────────────────────────────
    // New: this page had no translations of any kind.
    cancelTitle: 'Cancel Appointment',
    cancelConfirm: 'Are you sure you want to cancel this appointment?',
    cancelWarning: 'This cannot be undone. You will need to book again if you change your mind.',
    cancelReason: 'Reason for cancelling (optional)',
    cancelReasonPlaceholder: 'Let the business know why, if you would like to.',
    confirmCancel: 'Yes, cancel my appointment',
    keepAppointment: 'Keep My Appointment',
    cancelling: 'Cancelling…',
    cancelFailed: 'Could not cancel. Please try again.',
    cancelledTitle: 'Appointment Cancelled',
    cancelledDesc: 'Your appointment has been cancelled. A confirmation has been sent to you.',
    cannotCancel: 'Cannot Cancel',
    bookAgain: 'Book a new appointment',

    // ── Intake ────────────────────────────────────────────────────────────
    loadingError: 'Unable to Load Form',
    backToBookingDetails: 'Back to booking details',
    formAlreadyCompleted: 'Form Already Completed',
    formAlreadyCompletedDesc:
      "You've already submitted your intake form for this appointment. We look forward to seeing you!",
    noIntakeRequired: 'No Intake Form Required',
    noIntakeRequiredDesc:
      "There's no intake form configured for this appointment. You're all set!",
    thankYou: 'Thank You!',
    thankYouDesc:
      'Your intake form has been submitted successfully. We look forward to your appointment!',
    yourAppointment: 'Your appointment',
    viewBookingDetails: 'View Booking Details',
    completeIntakeForm: 'Complete Your Intake Form',
    helpUsPrepare: 'Help us prepare for your appointment',
    required: 'Required',
    yes: 'Yes',
    no: 'No',
    chooseFile: 'Choose a file',
    uploading: 'Uploading...',
    uploadFailed: 'That file could not be uploaded.',
    remove: 'Remove',
    select: 'Select...',
    submitting: 'Submitting...',
    submitForm: 'Submit Form',

    // ── Invoice ───────────────────────────────────────────────────────────
    invoice: 'Invoice',
    paymentReceived: 'Payment Received',
    paymentReceivedDesc: 'Thank you! Your payment has been successfully processed.',
    paymentCancelled: 'Payment Cancelled',
    paymentCancelledDesc:
      'Your payment was cancelled. You can try again using the payment options below.',
    billTo: 'Bill To',
    from: 'From',
    invoiceNumber: 'Invoice #',
    issueDate: 'Issue Date',
    dueDate: 'Due Date',
    dueOnServiceDate: 'Due on service date',
    description: 'Description',
    qty: 'Qty',
    price: 'Price',
    amount: 'Amount',
    subtotal: 'Subtotal',
    total: 'Total',
    includesTax: 'Includes',
    paymentOptions: 'Payment Options',
    payOnline: 'Pay Online with Card',
    bankTransfer: 'Bank Transfer',
    bank: 'Bank',
    account: 'Account',
    routingBranch: 'Branch',
    includeInvoiceNumber:
      'Please include invoice number {invoiceNumber} in the transfer reference.',
    paymentInstructions: 'Payment Instructions',
    contactForPayment: 'Please contact {businessName} directly for payment options.',
    paid: 'PAID',
    overdue: 'OVERDUE',
    bookingFor: 'Booking for {name}',
    thankYouBusiness: 'Thank you for your business!',
    copy: 'Copy',
    copied: 'Copied',

    // ── Smart-link pages ──────────────────────────────────────────────────
    bookWith: 'Book with',
    selectService: 'Select a service to get started',
    contactWith: 'Contact',
    getInTouch: 'Get in touch with us',
    poweredBy: 'Powered by AgentPilot',
    noServices: 'This business has no services available to book online right now.',

    // ── Business information ──────────────────────────────────────────────
    contactDetails: 'Contact',
    openingHours: 'Opening Hours',
    address: 'Address',
    phone: 'Phone',
    email: 'Email',
    whatsapp: 'WhatsApp',
    visitWebsite: 'Visit our website',
    closed: 'Closed',
    sunday: 'Sunday',
    monday: 'Monday',
    tuesday: 'Tuesday',
    wednesday: 'Wednesday',
    thursday: 'Thursday',
    friday: 'Friday',
    saturday: 'Saturday',

    // ── Errors ────────────────────────────────────────────────────────────
    notFoundTitle: 'Page Not Found',
    notFoundDesc: 'We could not find what you were looking for. Please check the link.',
    expiredTitle: 'This Link Is No Longer Active',
    expiredDesc: 'The business may have replaced or turned off this link.',
    errorTitle: 'Something Went Wrong',
    errorDesc: 'Please try again in a moment.',
    unavailableTitle: 'This Booking Link Is Incomplete',
    unavailableDesc:
      'Please open the full link from your confirmation email, or contact the business directly.',
    tryAgain: 'Try again',
    loading: 'Loading…',
  },

  es: {
    manageBooking: 'Gestiona tu reserva',
    cancelled: 'Cancelada',
    confirmed: 'Confirmada',
    pending: 'Pendiente',
    yourDetails: 'Tus datos',
    notes: 'Notas',
    reschedule: 'Reprogramar cita',
    cancel: 'Cancelar cita',
    cannotModify:
      'Los cambios solo se pueden realizar con más de 24 horas de anticipación.',
    questionsContact: '¿Preguntas? Contacta a {name} directamente.',
    bookingNotFound: 'Reserva no encontrada',
    bookingNotFoundDesc: 'Este enlace puede haber expirado o la reserva ya no existe.',
    min: 'min',

    selectNewTime: 'Elige una nueva fecha y hora',
    confirmNewTime: 'Confirmar nueva hora',
    loadingTimes: 'Cargando horarios disponibles...',
    noTimesAvailable: 'No hay horarios disponibles este día',
    pickAnotherDay: 'Elige otro día.',
    currentAppointment: 'Cita actual',
    rescheduling: 'Reprogramando…',
    rescheduleFailed: 'No se pudo reprogramar. Inténtalo de nuevo.',
    back: 'Volver',
    cannotReschedule: 'No se puede reprogramar',
    backToBooking: 'Volver a la reserva',
    rescheduledTitle: '¡Reserva reprogramada!',
    rescheduledDesc: 'Tu cita ha sido reprogramada.',
    newAppointmentTime: 'Nueva hora de la cita',
    confirmationEmail: 'Recibirás un correo de confirmación en breve.',
    loadFailed: 'No se pudieron cargar las opciones de reprogramación',
    weekdaysShort: 'Dom,Lun,Mar,Mié,Jue,Vie,Sáb',
    viewUpdatedBooking: 'Ver la reserva actualizada',
    timesShownIn: 'Todos los horarios se muestran en {zone}, la hora local del negocio.',

    cancelTitle: 'Cancelar cita',
    cancelConfirm: '¿Seguro que quieres cancelar esta cita?',
    cancelWarning: 'Esto no se puede deshacer. Tendrás que reservar de nuevo si cambias de opinión.',
    cancelReason: 'Motivo de la cancelación (opcional)',
    cancelReasonPlaceholder: 'Si quieres, cuéntale al negocio por qué.',
    confirmCancel: 'Sí, cancelar mi cita',
    keepAppointment: 'Mantener mi cita',
    cancelling: 'Cancelando…',
    cancelFailed: 'No se pudo cancelar. Inténtalo de nuevo.',
    cancelledTitle: 'Cita cancelada',
    cancelledDesc: 'Tu cita ha sido cancelada. Te hemos enviado una confirmación.',
    cannotCancel: 'No se puede cancelar',
    bookAgain: 'Reservar una nueva cita',

    loadingError: 'No se puede cargar el formulario',
    backToBookingDetails: 'Volver a los detalles de la reserva',
    formAlreadyCompleted: 'Formulario ya completado',
    formAlreadyCompletedDesc:
      'Ya has enviado tu formulario de admisión para esta cita. ¡Te esperamos!',
    noIntakeRequired: 'No se requiere formulario de admisión',
    noIntakeRequiredDesc:
      'No hay formulario de admisión configurado para esta cita. ¡Estás listo!',
    thankYou: '¡Gracias!',
    thankYouDesc:
      'Tu formulario de admisión ha sido enviado con éxito. ¡Te esperamos en tu cita!',
    yourAppointment: 'Tu cita',
    viewBookingDetails: 'Ver detalles de la reserva',
    completeIntakeForm: 'Completa tu formulario de admisión',
    helpUsPrepare: 'Ayúdanos a prepararnos para tu cita',
    required: 'Obligatorio',
    yes: 'Sí',
    no: 'No',
    chooseFile: 'Elegir archivo',
    uploading: 'Subiendo...',
    uploadFailed: 'No se pudo subir ese archivo.',
    remove: 'Quitar',
    select: 'Seleccionar...',
    submitting: 'Enviando...',
    submitForm: 'Enviar formulario',

    invoice: 'Factura',
    paymentReceived: 'Pago Recibido',
    paymentReceivedDesc: '¡Gracias! Tu pago ha sido procesado exitosamente.',
    paymentCancelled: 'Pago Cancelado',
    paymentCancelledDesc: 'Tu pago fue cancelado. Puedes intentar de nuevo.',
    billTo: 'Facturar a',
    from: 'De',
    invoiceNumber: 'Factura #',
    issueDate: 'Fecha de Emisión',
    dueDate: 'Fecha de Vencimiento',
    dueOnServiceDate: 'Vence en la fecha del servicio',
    description: 'Descripción',
    qty: 'Cant.',
    price: 'Precio',
    amount: 'Monto',
    subtotal: 'Subtotal',
    total: 'Total',
    includesTax: 'Incluye',
    paymentOptions: 'Opciones de Pago',
    payOnline: 'Pagar en Línea con Tarjeta',
    bankTransfer: 'Transferencia Bancaria',
    bank: 'Banco',
    account: 'Cuenta',
    routingBranch: 'Sucursal',
    includeInvoiceNumber:
      'Por favor incluye el número de factura {invoiceNumber} en la referencia.',
    paymentInstructions: 'Instrucciones de Pago',
    contactForPayment: 'Por favor contacta a {businessName} directamente.',
    paid: 'PAGADO',
    overdue: 'VENCIDO',
    bookingFor: 'Reserva para {name}',
    thankYouBusiness: '¡Gracias por su preferencia!',
    copy: 'Copiar',
    copied: 'Copiado',

    bookWith: 'Reservar con',
    selectService: 'Selecciona un servicio para comenzar',
    contactWith: 'Contactar a',
    getInTouch: 'Ponte en contacto con nosotros',
    poweredBy: 'Desarrollado por AgentPilot',
    noServices: 'Este negocio no tiene servicios disponibles para reservar en línea ahora mismo.',

    contactDetails: 'Contacto',
    openingHours: 'Horario',
    address: 'Dirección',
    phone: 'Teléfono',
    email: 'Correo',
    whatsapp: 'WhatsApp',
    visitWebsite: 'Visita nuestro sitio web',
    closed: 'Cerrado',
    sunday: 'Domingo',
    monday: 'Lunes',
    tuesday: 'Martes',
    wednesday: 'Miércoles',
    thursday: 'Jueves',
    friday: 'Viernes',
    saturday: 'Sábado',

    notFoundTitle: 'Página no encontrada',
    notFoundDesc: 'No encontramos lo que buscabas. Revisa el enlace.',
    expiredTitle: 'Este enlace ya no está activo',
    expiredDesc: 'Es posible que el negocio lo haya reemplazado o desactivado.',
    errorTitle: 'Algo salió mal',
    errorDesc: 'Inténtalo de nuevo en un momento.',
    unavailableTitle: 'Este enlace de reserva está incompleto',
    unavailableDesc:
      'Abre el enlace completo desde tu correo de confirmación, o contacta al negocio directamente.',
    tryAgain: 'Intentar de nuevo',
    loading: 'Cargando…',
  },

  he: {
    manageBooking: 'ניהול ההזמנה שלך',
    cancelled: 'בוטלה',
    confirmed: 'מאושרת',
    pending: 'ממתינה',
    yourDetails: 'הפרטים שלך',
    notes: 'הערות',
    reschedule: 'שינוי מועד',
    cancel: 'ביטול הפגישה',
    cannotModify: 'ניתן לבצע שינויים רק יותר מ-24 שעות לפני הפגישה.',
    questionsContact: 'שאלות? צור/י קשר עם {name} ישירות.',
    bookingNotFound: 'ההזמנה לא נמצאה',
    bookingNotFoundDesc: 'ייתכן שהקישור פג תוקף או שההזמנה כבר לא קיימת.',
    min: 'דק\'',

    selectNewTime: 'בחרו תאריך ושעה חדשים',
    confirmNewTime: 'אישור המועד החדש',
    loadingTimes: 'טוען מועדים פנויים...',
    noTimesAvailable: 'אין מועדים פנויים ביום זה',
    pickAnotherDay: 'אנא בחרו יום אחר.',
    currentAppointment: 'המועד הנוכחי',
    rescheduling: 'משנה מועד…',
    rescheduleFailed: 'לא הצלחנו לשנות את המועד. נסו שוב.',
    back: 'חזרה',
    cannotReschedule: 'לא ניתן לשנות מועד',
    backToBooking: 'חזרה להזמנה',
    rescheduledTitle: 'המועד שונה!',
    rescheduledDesc: 'הפגישה שלך נקבעה מחדש.',
    newAppointmentTime: 'המועד החדש',
    confirmationEmail: 'מייל אישור יישלח אליך בקרוב.',
    loadFailed: 'לא הצלחנו לטעון מועדים חלופיים',
    weekdaysShort: 'א,ב,ג,ד,ה,ו,ש',
    viewUpdatedBooking: 'צפייה בהזמנה המעודכנת',
    timesShownIn: 'כל השעות מוצגות לפי {zone}, השעון המקומי של העסק.',

    cancelTitle: 'ביטול הפגישה',
    cancelConfirm: 'לבטל את הפגישה?',
    cancelWarning: 'לא ניתן לבטל את הפעולה. אם תשנו את דעתכם, יהיה צורך לקבוע מחדש.',
    cancelReason: 'סיבת הביטול (לא חובה)',
    cancelReasonPlaceholder: 'אפשר לספר לעסק מה הסיבה.',
    confirmCancel: 'כן, בטלו את הפגישה',
    keepAppointment: 'השאירו את הפגישה',
    cancelling: 'מבטל…',
    cancelFailed: 'לא הצלחנו לבטל. נסו שוב.',
    cancelledTitle: 'הפגישה בוטלה',
    cancelledDesc: 'הפגישה שלך בוטלה. אישור נשלח אליך.',
    cannotCancel: 'לא ניתן לבטל',
    bookAgain: 'קביעת פגישה חדשה',

    loadingError: 'לא ניתן לטעון את הטופס',
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
    yes: 'כן',
    no: 'לא',
    chooseFile: 'בחרו קובץ',
    uploading: 'מעלים...',
    uploadFailed: 'לא הצלחנו להעלות את הקובץ.',
    remove: 'הסרה',
    select: 'בחר/י...',
    submitting: 'שולח...',
    submitForm: 'שליחת הטופס',

    invoice: 'חשבונית',
    paymentReceived: 'התשלום התקבל',
    paymentReceivedDesc: 'תודה! התשלום שלך עובד בהצלחה.',
    paymentCancelled: 'התשלום בוטל',
    paymentCancelledDesc: 'התשלום שלך בוטל. אפשר לנסות שוב.',
    billTo: 'לכבוד',
    from: 'מאת',
    invoiceNumber: 'חשבונית מס׳',
    issueDate: 'תאריך הנפקה',
    dueDate: 'לתשלום עד',
    dueOnServiceDate: 'לתשלום במועד השירות',
    description: 'תיאור',
    qty: 'כמות',
    price: 'מחיר',
    amount: 'סכום',
    subtotal: 'סכום ביניים',
    total: 'סה"כ לתשלום',
    includesTax: 'כולל',
    paymentOptions: 'אפשרויות תשלום',
    payOnline: 'שלם בכרטיס אשראי',
    bankTransfer: 'העברה בנקאית',
    bank: 'בנק',
    account: 'מספר חשבון',
    routingBranch: 'סניף',
    includeInvoiceNumber: 'נא לציין את מספר החשבונית {invoiceNumber} בהעברה.',
    paymentInstructions: 'הוראות תשלום',
    contactForPayment: 'ניתן ליצור קשר עם {businessName} לתיאום תשלום.',
    paid: 'שולם',
    overdue: 'באיחור',
    bookingFor: 'הזמנה עבור {name}',
    thankYouBusiness: 'תודה רבה!',
    copy: 'העתקה',
    copied: 'הועתק',

    bookWith: 'הזמנה אצל',
    selectService: 'בחר שירות להתחלה',
    contactWith: 'יצירת קשר עם',
    getInTouch: 'נשמח לשמוע ממך',
    poweredBy: 'מופעל על ידי AgentPilot',
    noServices: 'לעסק הזה אין כרגע שירותים שניתן להזמין אונליין.',

    contactDetails: 'יצירת קשר',
    openingHours: 'שעות פעילות',
    address: 'כתובת',
    phone: 'טלפון',
    email: 'אימייל',
    whatsapp: 'וואטסאפ',
    visitWebsite: 'לאתר שלנו',
    closed: 'סגור',
    sunday: 'ראשון',
    monday: 'שני',
    tuesday: 'שלישי',
    wednesday: 'רביעי',
    thursday: 'חמישי',
    friday: 'שישי',
    saturday: 'שבת',

    notFoundTitle: 'הדף לא נמצא',
    notFoundDesc: 'לא הצלחנו למצוא את מה שחיפשת. בדקו את הקישור.',
    expiredTitle: 'הקישור כבר לא פעיל',
    expiredDesc: 'ייתכן שהעסק החליף או כיבה את הקישור הזה.',
    errorTitle: 'משהו השתבש',
    errorDesc: 'נסו שוב בעוד רגע.',
    unavailableTitle: 'קישור ההזמנה חלקי',
    unavailableDesc: 'פתחו את הקישור המלא ממייל האישור, או צרו קשר ישירות עם העסק.',
    tryAgain: 'נסו שוב',
    loading: 'טוען…',
  },
};

/** Coerce anything to a supported locale. */
export function toLocale(value: string | null | undefined): Locale {
  return value && isValidLocale(value) ? value : defaultLocale;
}

/**
 * One string, with `{name}`-style substitution.
 *
 * Falls back through English to the key itself, so a missing translation shows
 * readable English rather than a blank space on a customer's invoice.
 */
export function publicT(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>
): string {
  let text = publicMessages[locale]?.[key] ?? publicMessages.en[key] ?? key;

  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replace(`{${name}}`, String(value));
    }
  }

  return text;
}

/** A reader bound to one locale. */
export function createPublicT(locale: Locale) {
  return (key: string, params?: Record<string, string | number>) => publicT(locale, key, params);
}

const LOCALE_CODES: Record<Locale, string> = { en: 'en-US', es: 'es-ES', he: 'he-IL' };

/** The `Intl` locale for a business language. */
export function localeCode(locale: Locale): string {
  return LOCALE_CODES[locale] ?? 'en-US';
}

export function formatPublicDate(
  value: Date | string,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(localeCode(locale), options);
}

/**
 * A time of day, in the business's clock.
 *
 * 24-hour for Hebrew — Israel does not write `2:30 PM`, and the cancel page
 * printing one while the page before it printed `14:30` made two screens of one
 * journey disagree about the same appointment.
 */
export function formatPublicTime(value: Date | string, locale: Locale, timeZone?: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleTimeString(localeCode(locale), {
    hour: '2-digit',
    minute: '2-digit',
    hour12: locale !== 'he',
    ...(timeZone ? { timeZone } : {}),
  });
}

export function formatPublicMoney(amount: number, currency: string, locale: Locale): string {
  try {
    return new Intl.NumberFormat(localeCode(locale), {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    }).format(amount);
  } catch {
    // An unrecognised currency code must not take a price off the page.
    return `${amount} ${currency}`;
  }
}

/**
 * The name of a timezone, in the reader's language.
 *
 * A client abroad has to be told WHICH clock the hours are on, or 09:00 is an
 * invitation to arrive at the wrong time.
 */
export function timeZoneLabel(timeZone: string, locale: Locale): string {
  try {
    const parts = new Intl.DateTimeFormat(localeCode(locale), {
      timeZone,
      timeZoneName: 'long',
    }).formatToParts(new Date());
    return parts.find(part => part.type === 'timeZoneName')?.value || timeZone;
  } catch {
    return timeZone;
  }
}
