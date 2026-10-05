// lib/email/templates/translations.ts
// Multilingual translations for email templates
// Supports: English (en), Spanish (es), Hebrew (he)

import type { Locale } from '@/lib/i18n/config';

/**
 * Email translations organized by template and section
 */
export const emailTranslations = {
  // ==========================================
  // COMMON / BASE TEMPLATE
  // ==========================================
  common: {
    footer: {
      visitWebsite: {
        en: 'Visit our website',
        es: 'Visita nuestro sitio web',
        he: 'בקר באתר שלנו'
      }
    }
  },

  // ==========================================
  // WELCOME / THANK YOU EMAIL (Contact Form)
  // ==========================================
  welcome: {
    subject: {
      en: (businessName: string) => `Thank you for reaching out - ${businessName}`,
      es: (businessName: string) => `Gracias por contactarnos - ${businessName}`,
      he: (businessName: string) => `תודה שפנית אלינו - ${businessName}`
    },
    greeting: {
      en: 'Thank you for reaching out!',
      es: '¡Gracias por contactarnos!',
      he: 'תודה שפנית אלינו!'
    },
    intro: {
      en: (firstName: string, businessName: string) =>
        `Hi ${firstName}, thank you for contacting ${businessName}. We've received your message and will get back to you as soon as possible.`,
      es: (firstName: string, businessName: string) =>
        `Hola ${firstName}, gracias por contactar a ${businessName}. Hemos recibido tu mensaje y te responderemos lo antes posible.`,
      he: (firstName: string, businessName: string) =>
        `שלום ${firstName}, תודה שפנית ל-${businessName}. קיבלנו את הודעתך ונחזור אליך בהקדם האפשרי.`
    },
    serviceInterestLabel: {
      en: 'Service Interest',
      es: 'Servicio de Interés',
      he: 'שירות מבוקש'
    },
    yourMessageLabel: {
      en: 'Your Message',
      es: 'Tu Mensaje',
      he: 'ההודעה שלך'
    },
    whatsNext: {
      en: '<strong>What happens next?</strong><br/>A member of our team will review your message and respond within 24-48 hours.',
      es: '<strong>¿Qué sigue?</strong><br/>Un miembro de nuestro equipo revisará tu mensaje y te responderá dentro de 24-48 horas.',
      he: '<strong>מה קורה עכשיו?</strong><br/>חבר צוות יעיין בהודעתך ויחזור אליך תוך 24-48 שעות.'
    },
    scheduleNow: {
      en: 'Want to schedule a consultation right away?',
      es: '¿Quieres programar una consulta ahora mismo?',
      he: 'רוצה לקבוע פגישת ייעוץ עכשיו?'
    },
    bookCall: {
      en: 'Book a Call',
      es: 'Reservar una Llamada',
      he: 'קבע שיחה'
    },
    lookingForward: {
      en: 'We look forward to connecting with you!',
      es: '¡Esperamos conectar contigo!',
      he: 'מצפים ליצור איתך קשר!'
    },
    bestRegards: {
      en: 'Best regards,',
      es: 'Saludos cordiales,',
      he: 'בברכה,'
    },
    theTeam: {
      en: (businessName: string) => `The ${businessName} Team`,
      es: (businessName: string) => `El equipo de ${businessName}`,
      he: (businessName: string) => `צוות ${businessName}`
    }
  },

  // ==========================================
  // RETURNING CONTACT EMAIL (Existing contact submits form again)
  // ==========================================
  returningContact: {
    subject: {
      en: (businessName: string) => `Great to hear from you again - ${businessName}`,
      es: (businessName: string) => `Qué bueno saber de ti de nuevo - ${businessName}`,
      he: (businessName: string) => `שמחים לשמוע ממך שוב - ${businessName}`
    },
    greeting: {
      en: 'Welcome back!',
      es: '¡Bienvenido de nuevo!',
      he: 'ברוך שובך!'
    },
    intro: {
      en: (firstName: string, businessName: string) =>
        `Hi ${firstName}, it's great to hear from you again! We've received your new message at ${businessName}.`,
      es: (firstName: string, businessName: string) =>
        `Hola ${firstName}, ¡qué bueno saber de ti de nuevo! Hemos recibido tu nuevo mensaje en ${businessName}.`,
      he: (firstName: string, businessName: string) =>
        `שלום ${firstName}, שמחים לשמוע ממך שוב! קיבלנו את הודעתך החדשה ב-${businessName}.`
    },
    yourMessageLabel: {
      en: 'Your Message',
      es: 'Tu Mensaje',
      he: 'ההודעה שלך'
    },
    serviceInterestLabel: {
      en: 'Service Interest',
      es: 'Servicio de Interés',
      he: 'שירות מבוקש'
    },
    whatsNext: {
      en: '<strong>What happens next?</strong><br/>Since we already know you, we\'ll review your message and get back to you as soon as possible.',
      es: '<strong>¿Qué sigue?</strong><br/>Como ya te conocemos, revisaremos tu mensaje y te responderemos lo antes posible.',
      he: '<strong>מה קורה עכשיו?</strong><br/>מכיוון שאנחנו כבר מכירים אותך, נעיין בהודעתך ונחזור אליך בהקדם.'
    },
    scheduleNow: {
      en: 'Want to schedule an appointment?',
      es: '¿Quieres programar una cita?',
      he: 'רוצה לקבוע פגישה?'
    },
    bookCall: {
      en: 'Book a Call',
      es: 'Reservar una Llamada',
      he: 'קבע שיחה'
    },
    lookingForward: {
      en: 'Looking forward to connecting with you again!',
      es: '¡Esperamos conectar contigo de nuevo!',
      he: 'מצפים ליצור איתך קשר שוב!'
    },
    bestRegards: {
      en: 'Best regards,',
      es: 'Saludos cordiales,',
      he: 'בברכה,'
    },
    theTeam: {
      en: (businessName: string) => `The ${businessName} Team`,
      es: (businessName: string) => `El equipo de ${businessName}`,
      he: (businessName: string) => `צוות ${businessName}`
    }
  },

  // ==========================================
  // INTAKE FORM REQUEST EMAIL
  // ==========================================
  /**
   * The receipt for an intake, sent once the client has answered.
   *
   * Its job is to close a loop, not to open one: the client filled in a form
   * about themselves and had no way of knowing it arrived. Everything here is
   * past tense and there is no call to action — the next move belongs to the
   * business.
   */
  intakeReceived: {
    subject: {
      en: (serviceName: string) => `We've received your form - ${serviceName}`,
      es: (serviceName: string) => `Hemos recibido tu formulario - ${serviceName}`,
      he: (serviceName: string) => `קיבלנו את הטופס שלך - ${serviceName}`
    },
    greeting: {
      en: 'Thank you — we have your answers',
      es: 'Gracias: ya tenemos tus respuestas',
      he: 'תודה — קיבלנו את התשובות שלך'
    },
    introScheduled: {
      en: (firstName: string, businessName: string) =>
        `Hi ${firstName}, thanks for taking the time. ${businessName} will read through your answers before your appointment, so there is nothing else you need to do.`,
      es: (firstName: string, businessName: string) =>
        `Hola ${firstName}, gracias por tomarte el tiempo. ${businessName} leerá tus respuestas antes de tu cita, así que no tienes que hacer nada más.`,
      he: (firstName: string, businessName: string) =>
        `שלום ${firstName}, תודה שהקדשת מזמנך. ב-${businessName} יעברו על התשובות שלך לפני הפגישה, ואין עוד משהו שצריך לעשות.`
    },
    /** No appointment to prepare for — a product or a service without a slot. */
    introUnscheduled: {
      en: (firstName: string, businessName: string) =>
        `Hi ${firstName}, thanks for taking the time. ${businessName} will read through your answers and be in touch if anything else is needed.`,
      es: (firstName: string, businessName: string) =>
        `Hola ${firstName}, gracias por tomarte el tiempo. ${businessName} leerá tus respuestas y se pondrá en contacto si hace falta algo más.`,
      he: (firstName: string, businessName: string) =>
        `שלום ${firstName}, תודה שהקדשת מזמנך. ב-${businessName} יעברו על התשובות שלך ויחזרו אליך אם יידרש משהו נוסף.`
    },
    receivedNotice: {
      en: '<strong>Your form was received</strong><br/>Your answers are only visible to the people you booked with.',
      es: '<strong>Tu formulario fue recibido</strong><br/>Tus respuestas solo son visibles para las personas con quienes reservaste.',
      he: '<strong>הטופס שלך התקבל</strong><br/>התשובות שלך גלויות רק לעסק שאצלו הזמנת.'
    },
    appointmentDetails: {
      en: 'Your appointment',
      es: 'Tu cita',
      he: 'הפגישה שלך'
    },
    orderDetails: {
      en: 'Your order',
      es: 'Tu pedido',
      he: 'ההזמנה שלך'
    },
    dateLabel: { en: '📅 Date', es: '📅 Fecha', he: '📅 תאריך' },
    timeLabel: { en: '🕐 Time', es: '🕐 Hora', he: '🕐 שעה' },
    submittedLabel: { en: '✅ Completed', es: '✅ Completado', he: '✅ הושלם' },
    needChanges: {
      en: 'Need to make a change?',
      es: '¿Necesitas hacer un cambio?',
      he: 'צריך לשנות משהו?'
    },
    reschedule: { en: 'Reschedule', es: 'Reprogramar', he: 'שינוי מועד' },
    cancel: { en: 'Cancel', es: 'Cancelar', he: 'ביטול' },
    questionsHelp: {
      en: (businessName: string) =>
        `If you remembered something after sending the form, just reply to this email and ${businessName} will see it.`,
      es: (businessName: string) =>
        `Si recordaste algo después de enviar el formulario, responde a este correo y ${businessName} lo verá.`,
      he: (businessName: string) =>
        `אם נזכרת במשהו אחרי ששלחת את הטופס, אפשר פשוט להשיב למייל הזה וב-${businessName} יראו את זה.`
    }
  },

  intake: {
    subject: {
      en: (serviceName: string) => `Please complete your intake form - ${serviceName}`,
      es: (serviceName: string) => `Por favor completa tu formulario de admisión - ${serviceName}`,
      he: (serviceName: string) => `אנא השלם את טופס הקבלה שלך - ${serviceName}`
    },
    /*
     * The second ask, a day before.
     *
     * It names TOMORROW, because that is what changed since the first email and
     * the only reason to send another one. A reminder that reads exactly like
     * the original invites the same response as the original.
     */
    reminderSubject: {
      en: (serviceName: string) => `Tomorrow: your form for ${serviceName}`,
      es: (serviceName: string) => `Mañana: tu formulario para ${serviceName}`,
      he: (serviceName: string) => `מחר: הטופס שלך ל${serviceName}`
    },
    reminderGreeting: {
      en: 'Your appointment is tomorrow — one thing left',
      es: 'Tu cita es mañana: falta una cosa',
      he: 'הפגישה שלכם מחר — נשאר דבר אחד'
    },
    greeting: {
      en: 'One more step before your appointment!',
      es: '¡Un paso más antes de tu cita!',
      he: 'עוד צעד אחד לפני הפגישה שלך!'
    },
    intro: {
      en: (firstName: string, businessName: string) =>
        `Hi ${firstName}, your appointment with ${businessName} is confirmed. To help us prepare for your session, please complete a brief intake form.`,
      es: (firstName: string, businessName: string) =>
        `Hola ${firstName}, tu cita con ${businessName} está confirmada. Para ayudarnos a prepararnos para tu sesión, por favor completa un breve formulario de admisión.`,
      he: (firstName: string, businessName: string) =>
        `שלום ${firstName}, הפגישה שלך עם ${businessName} אושרה. כדי לעזור לנו להתכונן לפגישה, אנא מלא טופס קבלה קצר.`
    },
    importantNotice: {
      en: '<strong>Please complete before your appointment</strong><br/>This helps us understand your needs and make the most of our time together.',
      es: '<strong>Por favor completa antes de tu cita</strong><br/>Esto nos ayuda a entender tus necesidades y aprovechar al máximo nuestro tiempo juntos.',
      he: '<strong>אנא השלם לפני הפגישה</strong><br/>זה עוזר לנו להבין את הצרכים שלך ולמצות את הזמן יחד.'
    },
    completeForm: {
      en: 'Complete Intake Form',
      es: 'Completar Formulario de Admisión',
      he: 'מלא טופס קבלה'
    },
    appointmentDetails: {
      en: 'Appointment Details',
      es: 'Detalles de la Cita',
      he: 'פרטי הפגישה'
    },
    dateLabel: {
      en: '📅 Date',
      es: '📅 Fecha',
      he: '📅 תאריך'
    },
    timeLabel: {
      en: '🕐 Time',
      es: '🕐 Hora',
      he: '🕐 שעה'
    },
    durationLabel: {
      en: '⏱️ Duration',
      es: '⏱️ Duración',
      he: '⏱️ משך'
    },
    locationLabel: {
      en: '📍 Location',
      es: '📍 Ubicación',
      he: '📍 מיקום'
    },
    minutes: {
      en: 'minutes',
      es: 'minutos',
      he: 'דקות'
    },
    whatsOnForm: {
      en: "What's on the intake form?",
      es: '¿Qué hay en el formulario de admisión?',
      he: 'מה יש בטופס הקבלה?'
    },
    formItems: {
      en: [
        'Basic contact information',
        'Questions about your goals and needs',
        'Any relevant background information'
      ],
      es: [
        'Información de contacto básica',
        'Preguntas sobre tus metas y necesidades',
        'Cualquier información relevante de antecedentes'
      ],
      he: [
        'פרטי קשר בסיסיים',
        'שאלות על המטרות והצרכים שלך',
        'מידע רקע רלוונטי'
      ]
    },
    formDuration: {
      en: 'The form takes approximately 5-10 minutes to complete.',
      es: 'El formulario toma aproximadamente 5-10 minutos para completar.',
      he: 'הטופס לוקח כ-5-10 דקות למילוי.'
    },
    needChanges: {
      en: 'Need to make changes to your appointment?',
      es: '¿Necesitas hacer cambios a tu cita?',
      he: 'צריך לשנות את הפגישה שלך?'
    },
    reschedule: {
      en: 'Reschedule',
      es: 'Reprogramar',
      he: 'קביעה מחדש'
    },
    cancel: {
      en: 'Cancel',
      es: 'Cancelar',
      he: 'ביטול'
    },
    questionsHelp: {
      en: (businessName: string) =>
        `If you have any questions or need assistance with the form, please reply to this email or contact ${businessName} directly.`,
      es: (businessName: string) =>
        `Si tienes alguna pregunta o necesitas ayuda con el formulario, por favor responde a este correo o contacta a ${businessName} directamente.`,
      he: (businessName: string) =>
        `אם יש לך שאלות או שאתה צריך עזרה עם הטופס, אנא השב למייל הזה או צור קשר עם ${businessName} ישירות.`
    }
  },

  // ==========================================
  // BOOKING CONFIRMATION EMAIL
  // ==========================================
  bookingConfirmation: {
    subject: {
      en: (serviceName: string) => `Your appointment is confirmed - ${serviceName}`,
      es: (serviceName: string) => `Tu cita está confirmada - ${serviceName}`,
      he: (serviceName: string) => `הפגישה שלך אושרה - ${serviceName}`
    },
    greeting: {
      en: 'Your appointment is confirmed!',
      es: '¡Tu cita está confirmada!',
      he: 'הפגישה שלך אושרה!'
    },
    /*
     * The same email when nothing was SCHEDULED.
     *
     * Not "product" — the distinction is whether a time was booked, and that is
     * the only thing the data actually knows. A course, a package, a retainer,
     * anything sold without a slot: the appointment wording told the client
     * their meeting was confirmed, then offered a calendar invitation and a
     * reschedule link for a meeting that does not exist.
     *
     * Separate strings rather than one neutral phrasing for both: "your booking
     * is confirmed" is vaguer than either, and the scheduled case is the common
     * one and reads best when it says what it means.
     */
    unscheduledSubject: {
      en: (serviceName: string) => `Your order is confirmed - ${serviceName}`,
      es: (serviceName: string) => `Tu pedido está confirmado - ${serviceName}`,
      he: (serviceName: string) => `ההזמנה שלך אושרה - ${serviceName}`
    },
    unscheduledGreeting: {
      en: 'Your order is confirmed!',
      es: '¡Tu pedido está confirmado!',
      he: 'ההזמנה שלך אושרה!'
    },
    unscheduledIntro: {
      en: (clientName: string, businessName: string) =>
        `Hi ${clientName}, your order with ${businessName} has been confirmed.`,
      es: (clientName: string, businessName: string) =>
        `Hola ${clientName}, tu pedido con ${businessName} ha sido confirmado.`,
      he: (clientName: string, businessName: string) =>
        `שלום ${clientName}, ההזמנה שלך מ-${businessName} אושרה.`
    },
    unscheduledPaymentRequired: {
      en: (amount: string) =>
        `<strong>Payment Required:</strong> Please complete your payment of ${amount} to confirm your order.`,
      es: (amount: string) =>
        `<strong>Pago Requerido:</strong> Por favor completa tu pago de ${amount} para confirmar tu pedido.`,
      he: (amount: string) =>
        `<strong>נדרש תשלום:</strong> אנא השלימו את התשלום בסך ${amount} כדי לאשר את ההזמנה.`
    },
    intro: {
      en: (clientName: string, businessName: string) =>
        `Hi ${clientName}, your booking with ${businessName} has been confirmed.`,
      es: (clientName: string, businessName: string) =>
        `Hola ${clientName}, tu reserva con ${businessName} ha sido confirmada.`,
      he: (clientName: string, businessName: string) =>
        `שלום ${clientName}, ההזמנה שלך עם ${businessName} אושרה.`
    },
    priceLabel: {
      en: '💰 Price',
      es: '💰 Precio',
      he: '💰 מחיר'
    },
    /*
     * A plan's own words. The client agreed to a schedule, so the confirmation
     * names the schedule rather than the total — the same list, in the same
     * order, that the booking dialog showed them before they paid.
     */
    planTitle: {
      en: 'Payment plan',
      es: 'Plan de pagos',
      he: 'תוכנית תשלומים'
    },
    planDueToday: {
      en: 'due today',
      es: 'a pagar hoy',
      he: 'לתשלום היום'
    },
    planPaid: {
      en: 'paid',
      es: 'pagado',
      he: 'שולם'
    },
    planTotal: {
      en: 'Total',
      es: 'Total',
      he: 'סה״כ'
    },
    paymentRequired: {
      en: (amount: string) =>
        `<strong>Payment Required:</strong> Please complete your payment of ${amount} to confirm your appointment.`,
      es: (amount: string) =>
        `<strong>Pago Requerido:</strong> Por favor completa tu pago de ${amount} para confirmar tu cita.`,
      he: (amount: string) =>
        `<strong>נדרש תשלום:</strong> אנא השלם את התשלום בסך ${amount} כדי לאשר את הפגישה.`
    },
    payNow: {
      en: 'Pay Now',
      es: 'Pagar Ahora',
      he: 'שלם עכשיו'
    },
    addToCalendar: {
      en: 'Add to your calendar:',
      es: 'Agregar a tu calendario:',
      he: 'הוסף ליומן שלך:'
    },
    googleCalendar: {
      en: '📅 Google Calendar',
      es: '📅 Google Calendar',
      he: '📅 יומן Google'
    },
    outlookCalendar: {
      en: '📅 Outlook',
      es: '📅 Outlook',
      he: '📅 Outlook'
    },
    icsNote: {
      en: 'Or use the attached .ics file for other calendar apps',
      es: 'O usa el archivo .ics adjunto para otras apps de calendario',
      he: 'או השתמש בקובץ .ics המצורף עבור אפליקציות יומן אחרות'
    },
    needChanges: {
      en: 'Need to make changes?',
      es: '¿Necesitas hacer cambios?',
      he: 'צריך לבצע שינויים?'
    },
    questions: {
      en: (businessName: string) =>
        `If you have any questions, please reply to this email or contact ${businessName} directly.`,
      es: (businessName: string) =>
        `Si tienes alguna pregunta, por favor responde a este correo o contacta a ${businessName} directamente.`,
      he: (businessName: string) =>
        `אם יש לך שאלות, אנא השב למייל זה או צור קשר עם ${businessName} ישירות.`
    }
  },

  // ==========================================
  // BOOKING CANCELLATION EMAIL
  // ==========================================
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE APPOINTMENT THE CLIENT DID NOT ATTEND — AND THE WORD "NO-SHOW" APPEARS
   * NOWHERE IN IT.
   *
   * "No-show" is the OWNER's bookkeeping label. To the person receiving this it
   * reads as an accusation, and the owner marking the status cannot actually
   * know why someone was absent: illness, a bereavement, the wrong address, or
   * a status ticked in error while the client sat in the waiting room.
   *
   * So the copy states only what is certainly true — they were not there, and
   * the business would like to see them — and offers a way forward. No blame,
   * no fault, no fee. A missed-fee message is a different email with different
   * rules and must not ride on this one.
   * ───────────────────────────────────────────────────────────────────────────
   */
  missedAppointment: {
    subject: {
      en: (serviceName: string) => `We missed you - ${serviceName}`,
      es: (serviceName: string) => `Te echamos de menos - ${serviceName}`,
      he: (serviceName: string) => `התגעגענו אליך - ${serviceName}`
    },
    greeting: {
      en: 'We missed you',
      es: 'Te echamos de menos',
      he: 'התגעגענו אליך'
    },
    intro: {
      en: (clientName: string) =>
        `Hi ${clientName}, we had you down for the appointment below and did not get to see you.`,
      es: (clientName: string) =>
        `Hola ${clientName}, te esperábamos en la cita de abajo y no pudimos verte.`,
      he: (clientName: string) =>
        `שלום ${clientName}, חיכינו לכם לפגישה שלהלן ולא הספקנו להיפגש.`
    },
    /** Deliberately warm, and deliberately not a question about what happened. */
    bookAgainPrompt: {
      en: 'If you would still like to come in, you can pick a new time here.',
      es: 'Si aún quieres venir, puedes elegir un nuevo horario aquí.',
      he: 'אם עדיין תרצו להגיע, אפשר לבחור מועד חדש כאן.'
    },
    bookAgain: {
      en: 'Find another time',
      es: 'Elegir otro horario',
      he: 'בחירת מועד אחר'
    },
    questions: {
      en: (businessName: string) =>
        `If this reached you by mistake, or you need anything, just reply to this email and ${businessName} will pick it up.`,
      es: (businessName: string) =>
        `Si has recibido esto por error, o necesitas algo, responde a este correo y ${businessName} lo verá.`,
      he: (businessName: string) =>
        `אם ההודעה הגיעה בטעות, או שנדרש משהו, אפשר להשיב למייל הזה ו${businessName} יטפלו בכך.`
    }
  },

  bookingCancellation: {
    /*
     * A PACKAGE cancelled part-way through.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * "Your appointment has been cancelled" is not enough when a block of six
     * ends after two: the client has HAD two sessions and paid for them, and an
     * email that mentions only the four that are off reads as though the whole
     * thing was undone. That is the version a dispute is argued from.
     *
     * So both halves are stated: what took place, and what will not.
     * ─────────────────────────────────────────────────────────────────────────
     */
    sessionsHeldTitle: {
      en: 'These meetings took place',
      es: 'Estas sesiones se realizaron',
      he: 'הפגישות שהתקיימו',
    },
    sessionsCancelledTitle: {
      en: 'These meetings are cancelled',
      es: 'Estas sesiones quedan canceladas',
      he: 'הפגישות שבוטלו',
    },
    /*
     * Money the business is still holding.
     *
     * REPORTS, never promises. Cancelling does not refund: that is a decision the
     * owner makes, with their own policy behind it, and an email that said "you
     * will be refunded" would commit them to something they may not owe. It also
     * must not say the opposite. So it states the fact and names who will settle
     * it, which is all the platform actually knows.
     */
    heldNotice: {
      en: (amount: string, businessName: string) =>
        `<strong>${amount} is still held for this booking.</strong> ${businessName} will be in touch about it.`,
      es: (amount: string, businessName: string) =>
        `<strong>Todavía hay ${amount} retenidos por esta reserva.</strong> ${businessName} se pondrá en contacto contigo al respecto.`,
      he: (amount: string, businessName: string) =>
        `<strong>${amount} עדיין מוחזקים עבור ההזמנה הזאת.</strong> ${businessName} ייצור איתך קשר בנוגע לכך.`
    },
    subject: {
      en: (serviceName: string) => `Appointment cancelled - ${serviceName}`,
      es: (serviceName: string) => `Cita cancelada - ${serviceName}`,
      he: (serviceName: string) => `הפגישה בוטלה - ${serviceName}`
    },
    greeting: {
      en: 'Appointment Cancelled',
      es: 'Cita Cancelada',
      he: 'הפגישה בוטלה'
    },
    intro: {
      en: (clientName: string) =>
        `Hi ${clientName}, your appointment has been cancelled.`,
      es: (clientName: string) =>
        `Hola ${clientName}, tu cita ha sido cancelada.`,
      he: (clientName: string) =>
        `שלום ${clientName}, הפגישה שלך בוטלה.`
    },
    /*
     * The same email when nothing was scheduled — an order rather than an
     * appointment. Cancelling a course sale told the client their "meeting was
     * cancelled" about something that never had one.
     */
    unscheduledSubject: {
      en: (serviceName: string) => `Order cancelled - ${serviceName}`,
      es: (serviceName: string) => `Pedido cancelado - ${serviceName}`,
      he: (serviceName: string) => `ההזמנה בוטלה - ${serviceName}`
    },
    unscheduledGreeting: {
      en: 'Order Cancelled',
      es: 'Pedido Cancelado',
      he: 'ההזמנה בוטלה'
    },
    unscheduledIntro: {
      en: (clientName: string) => `Hi ${clientName}, your order has been cancelled.`,
      es: (clientName: string) => `Hola ${clientName}, tu pedido ha sido cancelado.`,
      he: (clientName: string) => `שלום ${clientName}, ההזמנה שלך בוטלה.`
    },
    reasonLabel: {
      en: '📝 Reason',
      es: '📝 Motivo',
      he: '📝 סיבה'
    },
    /*
     * The reason when the business itself is closing, sent as the account is
     * deleted. It has to say two things the ordinary cancellation does not: the
     * business is gone, and the owner is still the person to ask. No rebooking
     * invitation goes with it — see `offerRebooking` in BookingEmailService.
     */
    closedReason: {
      en: 'This business has ceased operating, so your appointment has been cancelled. Please contact the owner directly with any questions.',
      es: 'Este negocio ha cesado su actividad, por lo que tu cita ha sido cancelada. Por favor, contacta directamente con el propietario si tienes alguna pregunta.',
      he: 'העסק הפסיק את פעילותו, ולכן הפגישה שלך בוטלה. לכל שאלה, אנא צרו קשר ישירות עם בעל העסק.'
    },
    /*
     * What happened to the money, said plainly and in four states.
     *
     * The cancellation used to show a price and nothing else, so a client who had
     * paid could not tell whether they were owed a refund, and a client who had
     * not could not tell whether they still owed anything. The price alone
     * answers neither question, and it is the question anybody reading a
     * cancellation actually has.
     *
     * NEVER promises a refund that has not happened: `stillHeld` reports and
     * names who will settle it, because whether a refund is owed is the
     * business's policy and not something this platform can assert.
     */
    notPaid: {
      en: 'Nothing was paid for this, so there is nothing to refund and nothing left to pay.',
      es: 'No se pagó nada por esto, así que no hay nada que reembolsar ni nada pendiente de pago.',
      he: 'לא שולם עבור זה דבר, ולכן אין מה להחזיר ואין מה לשלם.'
    },
    refundedInFull: {
      en: (amount: string) => `<strong>${amount} has been refunded in full.</strong> It can take a few days to appear, depending on your bank.`,
      es: (amount: string) => `<strong>Se han reembolsado ${amount} en su totalidad.</strong> Puede tardar unos días en aparecer, según tu banco.`,
      he: (amount: string) => `<strong>${amount} הוחזרו במלואם.</strong> ההחזר עשוי להופיע תוך מספר ימים, תלוי בבנק שלכם.`
    },
    refundedPartly: {
      en: (refunded: string, held: string, businessName: string) =>
        `<strong>${refunded} has been refunded</strong> of what you paid. ${held} is still held; ${businessName} will be in touch about it.`,
      es: (refunded: string, held: string, businessName: string) =>
        `<strong>Se han reembolsado ${refunded}</strong> de lo que pagaste. Todavía hay ${held} retenidos; ${businessName} se pondrá en contacto contigo al respecto.`,
      he: (refunded: string, held: string, businessName: string) =>
        `<strong>${refunded} הוחזרו</strong> מתוך מה ששילמתם. ${held} עדיין מוחזקים; ${businessName} ייצור איתכם קשר בנוגע לכך.`
    },
    paidLabel: {
      en: '✅ Paid',
      es: '✅ Pagado',
      he: '✅ שולם'
    },
    refundedLabel: {
      en: '↩️ Refunded',
      es: '↩️ Reembolsado',
      he: '↩️ הוחזר'
    },
    /*
     * A course is not an appointment.
     *
     * "Would you like to book a new appointment?" under a cancelled COURSE asked
     * about a meeting that never existed, and the button said "find another
     * time" when there was no time to find. The unscheduled wording asks the
     * question that actually applies, and the link goes to the same thing that
     * was cancelled rather than to a list of everything on offer.
     */
    unscheduledBookAgainPrompt: {
      en: (serviceName: string) => `Would you like to sign up for ${serviceName} again?`,
      es: (serviceName: string) => `¿Te gustaría volver a apuntarte a ${serviceName}?`,
      he: (serviceName: string) => `תרצו להירשם שוב ל${serviceName}?`
    },
    unscheduledBookAgain: {
      en: 'Sign up again',
      es: 'Apuntarme de nuevo',
      he: 'הרשמה מחדש'
    },
    /** The scheduled variant, now naming what it is rebooking. */
    bookAgainPromptNamed: {
      en: (serviceName: string) => `Would you like to book ${serviceName} for another time?`,
      es: (serviceName: string) => `¿Te gustaría reservar ${serviceName} para otro momento?`,
      he: (serviceName: string) => `תרצו לקבוע מועד אחר ל${serviceName}?`
    },
    bookAgainPrompt: {
      en: 'Would you like to book a new appointment?',
      es: '¿Te gustaría reservar una nueva cita?',
      he: 'האם תרצה לקבוע פגישה חדשה?'
    },
    bookAgain: {
      en: 'Book Again',
      es: 'Reservar de Nuevo',
      he: 'קבע שוב'
    },
    questions: {
      en: (businessName: string) =>
        `If you have any questions, please contact ${businessName} directly.`,
      es: (businessName: string) =>
        `Si tienes alguna pregunta, por favor contacta a ${businessName} directamente.`,
      he: (businessName: string) =>
        `אם יש לך שאלות, אנא צור קשר עם ${businessName} ישירות.`
    }
  },

  // ==========================================
  // BOOKING RESCHEDULED EMAIL
  // ==========================================
  bookingRescheduled: {
    subject: {
      en: (serviceName: string) => `Appointment rescheduled - ${serviceName}`,
      es: (serviceName: string) => `Cita reprogramada - ${serviceName}`,
      he: (serviceName: string) => `הפגישה נקבעה מחדש - ${serviceName}`
    },
    greeting: {
      en: 'Appointment Rescheduled',
      es: 'Cita Reprogramada',
      he: 'הפגישה נקבעה מחדש'
    },
    intro: {
      en: (clientName: string, businessName: string) =>
        `Hi ${clientName}, your appointment with ${businessName} has been rescheduled.`,
      es: (clientName: string, businessName: string) =>
        `Hola ${clientName}, tu cita con ${businessName} ha sido reprogramada.`,
      he: (clientName: string, businessName: string) =>
        `שלום ${clientName}, הפגישה שלך עם ${businessName} נקבעה מחדש.`
    },
    previousTime: {
      en: 'Previous Time',
      es: 'Hora Anterior',
      he: 'זמן קודם'
    },
    newTime: {
      en: 'New Time ✓',
      es: 'Nueva Hora ✓',
      he: 'זמן חדש ✓'
    },
    updateCalendar: {
      en: 'Update your calendar:',
      es: 'Actualiza tu calendario:',
      he: 'עדכן את היומן שלך:'
    },
    needMoreChanges: {
      en: 'Need to make more changes?',
      es: '¿Necesitas hacer más cambios?',
      he: 'צריך לבצע שינויים נוספים?'
    },
    rescheduleAgain: {
      en: 'Reschedule Again',
      es: 'Reprogramar de Nuevo',
      he: 'קבע מחדש שוב'
    }
  },

  // ==========================================
  // PAYMENT RECEIPT EMAIL
  // ==========================================
  /**
   * The morning briefing email.
   *
   * The briefing's own sentences are narrated upstream and arrive already in
   * the recipient's language; these strings are only the wrapper around them.
   */
  /**
   * Told the owner that somebody reached them.
   *
   * One vocabulary, two events: an enquiry through a contact form, and a
   * booking a client made themselves. They differ in urgency and in what the
   * owner does next, so the subject and the lead-in differ — everything else,
   * including the layout, is shared.
   */
  /**
   * Inviting a lead to book themselves in.
   *
   * The verb is the whole design question. A `sale_mode: 'proposal'` service
   * cannot be bought — its journey ends at a request — so telling that client
   * to "book and pay" sends them to a page that will not let them, and the
   * business looks broken at the exact moment it was trying to look organised.
   */
  bookingInvite: {
    subjectBook: {
      en: 'Book a time with {business}',
      es: 'Reserva una cita con {business}',
      he: 'לקביעת מועד עם {business}',
    },
    subjectQuote: {
      en: 'Request a quote from {business}',
      es: 'Solicita un presupuesto de {business}',
      he: 'בקשת הצעת מחיר מ{business}',
    },
    greeting: { en: 'Hi {name},', es: 'Hola {name},', he: 'היי {name},' },
    greetingNoName: { en: 'Hi,', es: 'Hola,', he: 'היי,' },
    leadInBook: {
      en: 'Thanks for getting in touch. You can pick a time that suits you here — it takes a minute.',
      es: 'Gracias por escribirnos. Puedes elegir el horario que te venga bien aquí, en un minuto.',
      he: 'תודה שפנית. אפשר לבחור מועד שנוח לך כאן — זה לוקח דקה.',
    },
    leadInQuote: {
      en: 'Thanks for getting in touch. Tell us what you need and we will come back to you with a price.',
      es: 'Gracias por escribirnos. Cuéntanos qué necesitas y te enviaremos un precio.',
      he: 'תודה שפנית. ספר/י לנו מה נדרש ונחזור אליך עם הצעת מחיר.',
    },
    reminderPrefix: {
      en: 'Just in case it got buried —',
      es: 'Por si acaso se traspapeló —',
      he: 'ליתר ביטחון, אם זה נעלם בתיבה —',
    },
    ctaBook: { en: 'Book a time', es: 'Reservar una cita', he: 'קביעת מועד' },
    ctaQuote: { en: 'Request a quote', es: 'Solicitar presupuesto', he: 'בקשת הצעת מחיר' },
    serviceLabel: { en: 'About', es: 'Sobre', he: 'לגבי' },
    signOff: {
      en: 'If a different time suits you better, just reply to this email.',
      es: 'Si te viene mejor otro momento, responde a este correo.',
      he: 'אם מועד אחר נוח יותר, אפשר פשוט להשיב למייל הזה.',
    },
  },

  newEnquiry: {
    subjectEnquiry: {
      en: 'New enquiry from {name}',
      es: 'Nueva consulta de {name}',
      he: 'פנייה חדשה מ{name}',
    },
    subjectQuote: {
      en: '{name} wants a price for {service}',
      es: '{name} quiere un precio para {service}',
      he: '{name} מבקש/ת הצעת מחיר ל{service}',
    },
    headingEnquiry: {
      en: 'Someone got in touch',
      es: 'Alguien te contactó',
      he: 'מישהו יצר איתך קשר',
    },
    headingQuote: {
      en: 'Someone wants a price',
      es: 'Alguien quiere un precio',
      he: 'מישהו מבקש הצעת מחיר',
    },
    leadInEnquiry: {
      en: 'They are waiting to hear back from you.',
      es: 'Están esperando tu respuesta.',
      he: 'הם מחכים לתשובה ממך.',
    },
    leadInQuote: {
      en: 'Only you can answer this one — they are waiting on a figure.',
      es: 'Solo tú puedes responder a esto: esperan una cifra.',
      he: 'רק את/ה יכול/ה לענות על זה — הם מחכים למחיר.',
    },
    subjectCancelled: {
      en: '{name} cancelled {service}',
      es: '{name} canceló {service}',
      he: '{name} ביטל/ה {service}',
    },
    subjectMoved: {
      en: '{name} moved {service}',
      es: '{name} cambió {service}',
      he: '{name} העביר/ה {service}',
    },
    headingCancelled: {
      en: 'An appointment was cancelled',
      es: 'Se canceló una cita',
      he: 'פגישה בוטלה',
    },
    headingMoved: {
      en: 'An appointment moved',
      es: 'Una cita cambió de hora',
      he: 'פגישה הועברה',
    },
    leadInCancelled: {
      en: 'That time is free again, and your calendar has been updated.',
      es: 'Ese horario vuelve a estar libre y tu calendario ya está actualizado.',
      he: 'השעה הזו פנויה שוב, והיומן שלך עודכן.',
    },
    leadInMoved: {
      en: 'Your calendar has been updated to the new time.',
      es: 'Tu calendario ya está actualizado con el nuevo horario.',
      he: 'היומן שלך עודכן למועד החדש.',
    },
    wasLabel: { en: 'Was', es: 'Antes', he: 'היה' },
    reasonLabel: { en: 'Reason given', es: 'Motivo', he: 'סיבה' },
    /*
     * A cancellation only, and only when the client had paid. The owner is
     * holding money for an appointment that is not happening, which the alert
     * never used to mention — so the one email about it said nothing about the
     * part that costs somebody money.
     */
    heldLabel: { en: 'Paid, not yet refunded', es: 'Pagado, sin devolver', he: 'שולם, טרם הוחזר' },
    /*
     * A plan that has NOT been stopped. Cancelling an appointment deliberately
     * does not end a client's payment arrangement, so this says plainly that
     * the charges continue until the owner decides otherwise — the value, not
     * just the label, has to carry that or it reads as a status rather than a
     * thing needing a decision.
     */
    planLabel: { en: 'Payment plan', es: 'Plan de pago', he: 'תוכנית תשלומים' },
    planValue: {
      en: 'Still charging — it was not stopped. Stop or refund it from the booking.',
      es: 'Sigue cobrando: no se detuvo. Detenlo o devuélvelo desde la reserva.',
      he: 'ממשיכה לחייב ולא הופסקה. אפשר לעצור או להחזיר דרך ההזמנה.',
    },
    nameLabel: { en: 'Name', es: 'Nombre', he: 'שם' },
    emailLabel: { en: 'Email', es: 'Correo', he: 'אימייל' },
    phoneLabel: { en: 'Phone', es: 'Teléfono', he: 'טלפון' },
    messageLabel: { en: 'Message', es: 'Mensaje', he: 'הודעה' },
    serviceLabel: { en: 'Service', es: 'Servicio', he: 'שירות' },
    whenLabel: { en: 'When', es: 'Cuándo', he: 'מתי' },
    interestLabel: { en: 'Interested in', es: 'Le interesa', he: 'מתעניין/ת ב' },
    referralLabel: { en: 'Found you via', es: 'Te encontró por', he: 'הגיע/ה דרך' },
    pageLabel: { en: 'From page', es: 'Desde la página', he: 'מהעמוד' },
    viewContact: {
      en: 'Open their details',
      es: 'Ver sus datos',
      he: 'פתיחת הפרטים',
    },
    replyHint: {
      en: 'Reply to this email to write to them directly.',
      es: 'Responde a este correo para escribirles directamente.',
      he: 'אפשר להשיב למייל הזה כדי לכתוב להם ישירות.',
    },
    unsubscribeHint: {
      en: 'You are getting this because new enquiry alerts are switched on.',
      es: 'Recibes esto porque las alertas de nuevas consultas están activadas.',
      he: 'קיבלת את זה כי התראות על פניות חדשות מופעלות.',
    },
    unsubscribeLink: {
      en: 'Turn them off',
      es: 'Desactivarlas',
      he: 'כיבוי ההתראות',
    },
  },

  dailyBriefing: {
    subject: {
      en: 'Your morning briefing - {date}',
      es: 'Tu resumen de la mañana - {date}',
      he: 'סיכום הבוקר שלך - {date}'
    },
    greeting: {
      en: 'Good morning',
      es: 'Buenos días',
      he: 'בוקר טוב'
    },
    greetingNamed: {
      en: 'Good morning, {name}',
      es: 'Buenos días, {name}',
      he: 'בוקר טוב, {name}'
    },
    viewDashboard: {
      en: 'Open my dashboard',
      es: 'Abrir mi panel',
      he: 'פתיחת לוח הבקרה'
    },
    unsubscribeHint: {
      en: 'You are getting this because the morning briefing is switched on.',
      es: 'Recibes esto porque el resumen de la mañana está activado.',
      he: 'קיבלת את המייל הזה כי סיכום הבוקר מופעל.'
    },
    unsubscribeLink: {
      en: 'Turn it off',
      es: 'Desactivarlo',
      he: 'לכיבוי'
    }
  },

  /**
   * The proposal a client is asked to accept, and the two notes to the owner
   * that follow their answer.
   */
  /**
   * The quote stopped part-way — what the client is told.
   *
   * Written to be EXPLANATORY, because this is the email a client reads twice.
   * They agreed to a price, paid some of it, and are now being told the work has
   * ended: every number they might reach for has to be on the page or they will
   * reply asking for it. So it names the job, what was agreed, what they paid,
   * what is cancelled, and what happens to the money — in that order.
   *
   * It does NOT blame. The reason codes are the owner's internal vocabulary
   * ('client_not_paying', 'owner_cannot_deliver') and several of them would be an
   * accusation in a client's inbox. The owner's own note is shown when they wrote
   * one; the code never is.
   */
  /**
   * Reason codes as a CLIENT should read them.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * A SEPARATE SET FROM THE OWNER'S LABELS, and not an optional nicety.
   *
   * The owner picks from their own vocabulary — 'client_not_paying',
   * 'client_no_show', 'client_unresponsive' — and those are accurate notes to
   * keep and accusations to receive. "You did not turn up" in an inbox reads as
   * a charge to answer, and the owner choosing a code for their own records did
   * not choose to send that sentence.
   *
   * So each code has a second, neutral phrasing here. The client learns that the
   * booking is off and roughly why, without being told off. Codes with no entry
   * fall back to no reason line at all, which is better than leaking the raw
   * code into an email.
   *
   * ── IDENTICAL TO THE OWNER'S LABEL UNLESS THERE IS A REASON NOT TO BE ───────
   *
   * Only these FIVE differ, and every one is about the client themselves:
   *
   *   client_cancelled     third person -> second: "the client asked to cancel"
   *                        is a strange thing to read about yourself
   *   client_stopped       same reason
   *   client_no_show       "the client did not turn up" -> "the appointment was
   *                        missed": the fact without the finger
   *   client_unresponsive  "stopped answering" -> "we were unable to reach you"
   *   client_not_paying    "will not pay" -> "payment was still outstanding"
   *
   * EVERY OTHER CODE MUST MATCH `cancel.reason.<code>` in `LanguageContext`
   * WORD FOR WORD. Six of them used to differ for no reason — the owner read
   * "כפל הזמנות" while the client was sent "התנגשות ביומן אצלנו" — which looks
   * exactly like a bug, because two texts that mean the same thing and are not
   * the same text are indistinguishable from a mistake.
   *
   * The pairing is asserted in `clientFacingCancelReason.test.ts`.
   * ───────────────────────────────────────────────────────────────────────────
   */
  cancelReasonForClient: {
    client_cancelled: {
      en: 'Cancelled at your request',
      es: 'Cancelado a petición tuya',
      he: 'בוטל לבקשתכם',
    },
    client_no_show: {
      en: 'The appointment was missed',
      es: 'No se asistió a la cita',
      he: 'הפגישה לא התקיימה',
    },
    client_unresponsive: {
      en: 'We were unable to reach you',
      es: 'No pudimos contactarte',
      he: 'לא הצלחנו ליצור איתכם קשר',
    },
    client_not_paying: {
      en: 'Payment was still outstanding',
      es: 'El pago seguía pendiente',
      he: 'התשלום טרם הוסדר',
    },
    client_cost: { en: 'The price', es: 'El precio', he: 'המחיר' },
    client_stopped: {
      en: 'Stopped at your request',
      es: 'Detenido a petición tuya',
      he: 'נעצר לבקשתכם',
    },
    owner_unavailable: {
      en: 'We could not make the time',
      es: 'No pudimos en ese horario',
      he: 'לא יכולנו בשעה הזו',
    },
    owner_double_booked: {
      en: 'Double booked',
      es: 'Horario duplicado',
      he: 'כפל הזמנות',
    },
    owner_cannot_deliver: {
      en: 'We could not deliver it',
      es: 'No pudimos entregarlo',
      he: 'לא הצלחנו לספק',
    },
    service_discontinued: {
      en: 'We no longer offer this',
      es: 'Ya no ofrecemos esto',
      he: 'אנחנו לא מציעים את זה יותר',
    },
    duplicate: { en: 'Duplicate booking', es: 'Reserva duplicada', he: 'הזמנה כפולה' },
    rescheduled: {
      en: 'Moved to another time',
      es: 'Movida a otro horario',
      he: 'הועברה לשעה אחרת',
    },
    scope_changed: {
      en: 'The job changed',
      es: 'El trabajo cambió',
      he: 'העבודה השתנתה',
    },
    refunded: {
      en: 'Refunded, so it is not going ahead',
      es: 'Reembolsado, así que no sigue adelante',
      he: 'הוחזר כסף, ולכן זה לא מתקיים',
    },
    /*
     * No 'test_booking' and no 'other'.
     *
     * "A test booking" tells a real client their appointment was practice, and
     * "another reason" is a line that says nothing while looking like it should.
     * Both fall through to no reason line, which is the honest result.
     */
  },
  quoteStopped: {
    subject: {
      en: 'Update on {title}',
      es: 'Actualización sobre {title}',
      he: 'עדכון בנוגע ל{title}',
    },
    greeting: { en: 'Hello {name},', es: 'Hola {name},', he: 'שלום {name},' },
    greetingPlain: { en: 'Hello,', es: 'Hola,', he: 'שלום,' },
    intro: {
      en: 'We are writing to let you know that the remaining work on {title} has been stopped, so nothing further will be scheduled or invoiced.',
      es: 'Te escribimos para informarte de que el trabajo restante de {title} se ha detenido, por lo que no se programará ni facturará nada más.',
      he: 'רצינו לעדכן שהעבודה שנותרה על {title} נעצרה, ולכן לא נקבע ולא נחייב שום דבר נוסף.',
    },
    agreedLabel: { en: 'Originally agreed', es: 'Acordado inicialmente', he: 'הוסכם במקור' },
    paidLabel: { en: 'Paid so far', es: 'Pagado hasta ahora', he: 'שולם עד כה' },
    cancelledLabel: { en: 'Now cancelled', es: 'Ahora cancelado', he: 'בוטל כעת' },
    stagesHeading: {
      en: 'What has been cancelled',
      es: 'Lo que se ha cancelado',
      he: 'מה בוטל',
    },
    invoicesVoided: {
      en: '{count} unpaid invoice was cancelled, so please disregard it.',
      es: 'Se canceló {count} factura impagada, por lo que puedes ignorarla.',
      he: 'חשבונית אחת שלא שולמה בוטלה, אפשר להתעלם ממנה.',
    },
    invoicesVoidedPlural: {
      en: '{count} unpaid invoices were cancelled, so please disregard them.',
      es: 'Se cancelaron {count} facturas impagadas, por lo que puedes ignorarlas.',
      he: '{count} חשבוניות שלא שולמו בוטלו, אפשר להתעלם מהן.',
    },
    stagesClosed: {
      en: '{count} stage that had not been invoiced will not be billed.',
      es: '{count} etapa que no se había facturado no se cobrará.',
      he: 'שלב אחד שלא חויב לא ייחויב.',
    },
    stagesClosedPlural: {
      en: '{count} stages that had not been invoiced will not be billed.',
      es: '{count} etapas que no se habían facturado no se cobrarán.',
      he: '{count} שלבים שלא חויבו לא ייחויבו.',
    },
    reasonHeading: { en: 'Reason:', es: 'Motivo:', he: 'סיבה:' },
    noteHeading: { en: 'A note from us', es: 'Una nota nuestra', he: 'הערה מאיתנו' },
    /* Nothing was collected: say so, or a cancelled job carrying a price reads
       as a bill still owed. */
    moneyNone: {
      en: 'Nothing was charged for this work, and there is nothing left to pay.',
      es: 'No se cobró nada por este trabajo y no queda nada por pagar.',
      he: 'לא חויבתם על העבודה הזו, ולא נותר דבר לשלם.',
    },
    moneyRefundedFull: {
      en: '{amount} has been refunded in full to your original payment method. It usually appears within 5 to 10 business days.',
      es: 'Se han reembolsado {amount} en su totalidad a tu método de pago original. Suele aparecer en un plazo de 5 a 10 días hábiles.',
      he: 'סך של {amount} הוחזר במלואו לאמצעי התשלום המקורי. בדרך כלל זה מופיע בתוך 5 עד 10 ימי עסקים.',
    },
    moneyRefundedPartly: {
      en: '{refunded} has been refunded to your original payment method, usually within 5 to 10 business days. {kept} covers the work already completed and is not being returned.',
      es: 'Se han reembolsado {refunded} a tu método de pago original, normalmente en 5 a 10 días hábiles. {kept} corresponde al trabajo ya realizado y no se devuelve.',
      he: 'סך של {refunded} הוחזר לאמצעי התשלום המקורי, בדרך כלל בתוך 5 עד 10 ימי עסקים. {kept} מכסה את העבודה שכבר בוצעה ואינו מוחזר.',
    },
    /* Paid and NOT refunded. Deliberately explicit: silence here is what makes a
       client email back asking where their money is. */
    moneyKept: {
      en: '{amount} was already paid for work that has been completed, and is not being refunded. If you believe something is wrong, please reply to this email and we will look into it.',
      es: 'Ya se pagaron {amount} por el trabajo realizado y no se reembolsan. Si crees que hay un error, responde a este correo y lo revisaremos.',
      he: 'סך של {amount} שולם עבור עבודה שבוצעה, ואינו מוחזר. אם לדעתכם משהו אינו תקין, השיבו למייל הזה ונבדוק.',
    },
    questions: {
      en: 'If you have any questions about this, just reply to this email.',
      es: 'Si tienes alguna duda, responde a este correo.',
      he: 'לכל שאלה בנושא, אפשר פשוט להשיב למייל הזה.',
    },
  },
  proposal: {
    /*
     * A PACKAGE's meetings. The email listed their amounts with no dates, so a
     * client could see what each session cost and not when any of them was.
     */
    sessionsTitle: {
      en: '{count} meetings, {minutes} minutes each',
      es: '{count} sesiones de {minutes} minutos cada una',
      he: '{count} פגישות, {minutes} דקות כל אחת',
    },
    sessionsTimezone: {
      en: 'Times shown in {zone}.',
      es: 'Horas en {zone}.',
      he: 'השעות לפי {zone}.',
    },
    sessionsBilledAfter: {
      en: 'Nothing to pay now. Each meeting is invoiced after it has taken place.',
      es: 'Nada que pagar ahora. Cada sesión se factura después de celebrarse.',
      he: 'אין מה לשלם עכשיו. כל פגישה מחויבת לאחר שהתקיימה.',
    },
    paymentTermsLabel: {
      en: 'Payment terms',
      es: 'Plazo de pago',
      he: 'תנאי תשלום',
    },
    netDays: {
      en: '{days} days from invoice',
      es: '{days} días desde la factura',
      he: '{days} יום מקבלת החשבונית',
    },
    dueOnReceipt: {
      en: 'Due on receipt',
      es: 'Pago al recibir',
      he: 'לתשלום עם קבלת החשבונית',
    },
    attachmentNote: {
      en: 'The full proposal is attached to this email:',
      es: 'El presupuesto completo está adjunto a este correo:',
      he: 'הצעת המחיר המלאה מצורפת למייל הזה:',
    },
    subject: {
      en: 'Your quote — {title}',
      es: 'Tu presupuesto — {title}',
      he: 'הצעת מחיר — {title}'
    },
    subjectRevised: {
      en: 'Updated quote — {title}',
      es: 'Presupuesto actualizado — {title}',
      he: 'הצעת מחיר מעודכנת — {title}'
    },
    greeting: { en: 'Your quote', es: 'Tu presupuesto', he: 'הצעת המחיר שלך' },
    greetingNamed: {
      en: 'Hello {name},',
      es: 'Hola {name},',
      he: 'שלום {name},'
    },
    intro: {
      en: 'Here is the quote for the work we discussed.',
      es: 'Aquí tienes el presupuesto del trabajo que hablamos.',
      he: 'מצורפת הצעת מחיר לעבודה שדיברנו עליה.'
    },
    revisedIntro: {
      en: 'Here is an updated quote. It replaces the one sent before.',
      es: 'Aquí tienes un presupuesto actualizado. Reemplaza al anterior.',
      he: 'מצורפת הצעה מעודכנת. היא מחליפה את זו שנשלחה קודם.'
    },
    totalLabel: { en: 'Total', es: 'Total', he: 'סה״כ' },
    dueOnAcceptLabel: {
      en: 'Due on acceptance',
      es: 'A pagar al aceptar',
      he: 'לתשלום עם האישור'
    },
    validUntilLabel: { en: 'Valid until', es: 'Válido hasta', he: 'בתוקף עד' },
    stagesTitle: {
      en: 'How it is paid',
      es: 'Cómo se paga',
      he: 'אופן התשלום'
    },
    viewCta: { en: 'View and respond', es: 'Ver y responder', he: 'צפייה ומענה' },
    footerNote: {
      en: 'You can accept or decline from that page — no account needed.',
      es: 'Puedes aceptar o rechazar desde esa página — sin necesidad de cuenta.',
      he: 'אפשר לאשר או לדחות מהעמוד הזה — בלי צורך בחשבון.'
    }
  },

  proposalDecision: {
    subjectAccepted: {
      en: '{name} accepted your quote',
      es: '{name} aceptó tu presupuesto',
      he: '{name} אישר את ההצעה'
    },
    subjectDeclined: {
      en: '{name} declined your quote',
      es: '{name} rechazó tu presupuesto',
      he: '{name} דחה את ההצעה'
    },
    acceptedIntro: {
      en: 'The quote was accepted and the first invoice has been raised.',
      es: 'El presupuesto fue aceptado y se ha emitido la primera factura.',
      he: 'ההצעה אושרה והחשבונית הראשונה הופקה.'
    },
    declinedIntro: {
      en: 'The quote was declined. The reason is below, in case it is worth another version.',
      es: 'El presupuesto fue rechazado. El motivo está abajo, por si vale otra versión.',
      he: 'ההצעה נדחתה. הסיבה מופיעה למטה — אולי שווה גרסה נוספת.'
    },
    reasonLabel: { en: 'Reason', es: 'Motivo', he: 'סיבה' },
    amountLabel: { en: 'Amount', es: 'Importe', he: 'סכום' },
    openCta: { en: 'Open in your dashboard', es: 'Abrir en tu panel', he: 'פתיחה בלוח הבקרה' }
  },

  paymentReceipt: {
    subject: {
      en: (businessName: string) => `Payment receipt - ${businessName}`,
      es: (businessName: string) => `Recibo de pago - ${businessName}`,
      he: (businessName: string) => `קבלה על תשלום - ${businessName}`
    },
    greeting: {
      en: 'Payment Received',
      es: 'Pago Recibido',
      he: 'התשלום התקבל'
    },
    intro: {
      en: (clientName: string) =>
        `Hi ${clientName}, thank you for your payment. Your transaction has been completed successfully.`,
      es: (clientName: string) =>
        `Hola ${clientName}, gracias por tu pago. Tu transacción se ha completado exitosamente.`,
      he: (clientName: string) =>
        `שלום ${clientName}, תודה על התשלום. העסקה הושלמה בהצלחה.`
    },
    paymentDetails: {
      en: 'Payment Details',
      es: 'Detalles del Pago',
      he: 'פרטי התשלום'
    },
    amountLabel: {
      en: 'Amount Paid',
      es: 'Monto Pagado',
      he: 'סכום ששולם'
    },
    dateLabel: {
      en: 'Date',
      es: 'Fecha',
      he: 'תאריך'
    },
    transactionIdLabel: {
      en: 'Transaction ID',
      es: 'ID de Transacción',
      he: 'מזהה עסקה'
    },
    keepReceipt: {
      en: 'Please keep this receipt for your records.',
      es: 'Por favor guarda este recibo para tus registros.',
      he: 'אנא שמור קבלה זו לתיעוד.'
    },

    /*
     * The receipt body was hardcoded English.
     *
     * Only `subject` was ever translated, so a Hebrew client received an email
     * whose dates and currency were formatted `he-IL` — correctly — wrapped in
     * "Payment Confirmed", "Amount Paid" and "Receipt Details". The locale was
     * being passed in and used for everything except the words.
     */
    confirmedTitle: {
      en: 'Payment Confirmed',
      es: 'Pago Confirmado',
      he: 'התשלום אושר'
    },
    thankYou: {
      en: (clientName: string) => `Thank you for your payment, ${clientName}!`,
      es: (clientName: string) => `¡Gracias por tu pago, ${clientName}!`,
      he: (clientName: string) => `תודה על התשלום, ${clientName}!`
    },
    receiptDetails: {
      en: 'Receipt Details',
      es: 'Detalles del Recibo',
      he: 'פרטי הקבלה'
    },
    receiptNumberLabel: {
      en: 'Receipt Number',
      es: 'Número de Recibo',
      he: 'מספר קבלה'
    },
    paymentDateLabel: {
      en: 'Payment Date',
      es: 'Fecha de Pago',
      he: 'תאריך תשלום'
    },
    paymentMethodLabel: {
      en: 'Payment Method',
      es: 'Método de Pago',
      he: 'אמצעי תשלום'
    },
    serviceLabel: {
      en: 'Service',
      es: 'Servicio',
      he: 'שירות'
    },
    appointmentLabel: {
      en: 'Appointment',
      es: 'Cita',
      he: 'מועד הפגישה'
    },
    appointmentLine: {
      en: (serviceName: string, when: string) => `<strong>📅 Your appointment:</strong> ${serviceName} on ${when}`,
      es: (serviceName: string, when: string) => `<strong>📅 Tu cita:</strong> ${serviceName} el ${when}`,
      he: (serviceName: string, when: string) => `<strong>📅 הפגישה שלך:</strong> ${serviceName} בתאריך ${when}`
    },
    manageNote: {
      en: 'You can manage your booking using the link below.',
      es: 'Puedes gestionar tu reserva con el enlace de abajo.',
      he: 'ניתן לנהל את ההזמנה בקישור שלמטה.'
    },
    viewBooking: {
      en: 'View Booking Details',
      es: 'Ver Detalles de la Reserva',
      he: 'צפייה בפרטי ההזמנה'
    },
    finalNote: {
      en: (businessName: string) =>
        `This receipt confirms your payment to ${businessName}. Please save this email for your records. If you have any questions, please reply to this email or contact us directly.`,
      es: (businessName: string) =>
        `Este recibo confirma tu pago a ${businessName}. Guarda este correo para tus registros. Si tienes preguntas, responde a este correo o contáctanos directamente.`,
      he: (businessName: string) =>
        `קבלה זו מאשרת את התשלום שלך ל${businessName}. מומלץ לשמור את המייל לתיעוד. לכל שאלה, ניתן להשיב למייל זה או לפנות אלינו ישירות.`
    }
  },

  // ==========================================
  // REFUND CONFIRMATION EMAIL
  // ==========================================
  refundConfirmation: {
    /*
     * The AMOUNT is in the subject, and that is not decoration.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * This read "Refund processed - {business}" for every refund, so two partial
     * refunds on one booking produced two identical subjects to the same
     * address. Gmail threads by subject: the second collapsed into the first and
     * looked like it had never been sent. It had — the send is recorded, seven
     * seconds after the refund — but nobody could tell.
     *
     * The amount is the one thing that distinguishes a second partial refund
     * from the first, and it is also what the client most wants to know before
     * opening anything.
     * ─────────────────────────────────────────────────────────────────────────
     */
    subject: {
      en: (businessName: string, amount: string) => `${amount} refunded - ${businessName}`,
      es: (businessName: string, amount: string) => `${amount} reembolsado - ${businessName}`,
      he: (businessName: string, amount: string) => `הוחזרו ${amount} - ${businessName}`
    },
    greeting: {
      en: 'Refund Processed',
      es: 'Reembolso Procesado',
      he: 'ההחזר בוצע'
    },
    intro: {
      en: (clientName: string, businessName: string) =>
        `Hi ${clientName}, your refund from ${businessName} has been processed successfully.`,
      es: (clientName: string, businessName: string) =>
        `Hola ${clientName}, tu reembolso de ${businessName} ha sido procesado exitosamente.`,
      he: (clientName: string, businessName: string) =>
        `שלום ${clientName}, ההחזר שלך מ-${businessName} בוצע בהצלחה.`
    },
    refundDetails: {
      en: 'Refund Details',
      es: 'Detalles del Reembolso',
      he: 'פרטי ההחזר'
    },
    amountRefunded: {
      en: 'Amount Refunded',
      es: 'Monto Reembolsado',
      he: 'סכום ההחזר'
    },
    originalPayment: {
      en: 'Original Payment',
      es: 'Pago Original',
      he: 'תשלום מקורי'
    },
    refundDate: {
      en: 'Refund Date',
      es: 'Fecha del Reembolso',
      he: 'תאריך ההחזר'
    },
    refundType: {
      en: 'Refund Type',
      es: 'Tipo de Reembolso',
      he: 'סוג ההחזר'
    },
    fullRefund: {
      en: 'Full Refund',
      es: 'Reembolso Completo',
      he: 'החזר מלא'
    },
    partialRefund: {
      en: 'Partial Refund',
      es: 'Reembolso Parcial',
      he: 'החזר חלקי'
    },
    serviceLabel: {
      en: 'Service',
      es: 'Servicio',
      he: 'שירות'
    },
    reasonLabel: {
      en: 'Reason',
      es: 'Motivo',
      he: 'סיבה'
    },
    /*
     * The reason itself, in the CLIENT's email.
     *
     * `payment_refunds.reason` stores a canonical key for the common reasons —
     * `goodwill`, `no_show` — so every reader can render it in their own
     * language and two owners describing the same thing produce one value. The
     * email printed that key, so a client in Hebrew received "סיבה: goodwill".
     *
     * Kept here rather than reused from the app's language files because this
     * is what a CLIENT reads, not the business: the wording is addressed to the
     * person who was refunded, and the two can differ.
     */
    reasonValues: {
      en: {
        no_show: 'You did not attend the appointment',
        cancelled_by_client: 'You cancelled',
        service_not_delivered: 'The service was not provided',
        duplicate_payment: 'You were charged twice',
        goodwill: 'As a gesture of goodwill',
      },
      es: {
        no_show: 'No asististe a la cita',
        cancelled_by_client: 'Cancelaste la cita',
        service_not_delivered: 'El servicio no se prestó',
        duplicate_payment: 'Se te cobró dos veces',
        goodwill: 'Como gesto de buena voluntad',
      },
      he: {
        no_show: 'לא הגעת לפגישה',
        cancelled_by_client: 'ביטלת את הפגישה',
        service_not_delivered: 'השירות לא ניתן',
        duplicate_payment: 'חויבת פעמיים',
        goodwill: 'כמחווה מצידנו',
      },
    },
    processingNote: {
      en: 'The refund will be credited to your original payment method within 5-10 business days, depending on your bank.',
      es: 'El reembolso se acreditará a tu método de pago original dentro de 5-10 días hábiles, dependiendo de tu banco.',
      he: 'ההחזר יזוכה לאמצעי התשלום המקורי שלך תוך 5-10 ימי עסקים, בהתאם לבנק שלך.'
    },
    manualRefundNote: {
      en: 'This refund was processed manually. Please contact us if you have any questions about receiving your refund.',
      es: 'Este reembolso fue procesado manualmente. Por favor contáctanos si tienes alguna pregunta sobre recibir tu reembolso.',
      he: 'החזר זה בוצע באופן ידני. אנא צור קשר אם יש לך שאלות לגבי קבלת ההחזר.'
    },
    bookAgainPrompt: {
      en: 'We hope to see you again soon!',
      es: '¡Esperamos verte de nuevo pronto!',
      he: 'מקווים לראות אותך שוב בקרוב!'
    },
    bookAgain: {
      en: 'Book Again',
      es: 'Reservar de Nuevo',
      he: 'הזמן שוב'
    },
    questions: {
      en: (businessName: string) =>
        `If you have any questions about this refund, please contact ${businessName} directly.`,
      es: (businessName: string) =>
        `Si tienes alguna pregunta sobre este reembolso, por favor contacta a ${businessName} directamente.`,
      he: (businessName: string) =>
        `אם יש לך שאלות לגבי החזר זה, אנא צור קשר עם ${businessName} ישירות.`
    }
  },

  // ==========================================
  // INVOICE EMAIL
  // ==========================================
  invoice: {
    subject: {
      en: (businessName: string, invoiceNumber: string) =>
        `Invoice #${invoiceNumber} from ${businessName}`,
      es: (businessName: string, invoiceNumber: string) =>
        `Factura #${invoiceNumber} de ${businessName}`,
      he: (businessName: string, invoiceNumber: string) =>
        `חשבונית #${invoiceNumber} מ-${businessName}`
    },
    /*
     * The same sentence with the document's own name in it — "Receipt #12 from
     * X" for a business that takes payment on the spot, "Tax invoice" for one
     * registered for VAT. The word is passed in rather than chosen here: which
     * document a business may issue is its call, not the email layer's.
     *
     * `subject` above stays for callers that have no settings to resolve.
     */
    subjectFor: {
      en: (noun: string, businessName: string, invoiceNumber: string) =>
        `${noun} #${invoiceNumber} from ${businessName}`,
      es: (noun: string, businessName: string, invoiceNumber: string) =>
        `${noun} #${invoiceNumber} de ${businessName}`,
      he: (noun: string, businessName: string, invoiceNumber: string) =>
        `${noun} #${invoiceNumber} מ-${businessName}`
    },
    greeting: {
      en: (businessName: string) => `Invoice from ${businessName}`,
      es: (businessName: string) => `Factura de ${businessName}`,
      he: (businessName: string) => `חשבונית מ-${businessName}`
    },
    greetingFor: {
      en: (noun: string, businessName: string) => `${noun} from ${businessName}`,
      es: (noun: string, businessName: string) => `${noun} de ${businessName}`,
      he: (noun: string, businessName: string) => `${noun} מ-${businessName}`
    },
    intro: {
      en: (clientName: string) =>
        `Hi ${clientName}, here's your invoice for upcoming services.`,
      es: (clientName: string) =>
        `Hola ${clientName}, aquí está tu factura por los servicios.`,
      he: (clientName: string) =>
        `שלום ${clientName}, מצורפת החשבונית שלך עבור השירותים.`
    },
    invoiceNumber: {
      en: 'Invoice Number',
      es: 'Número de Factura',
      he: 'מספר חשבונית'
    },
    amountDue: {
      en: 'Amount Due',
      es: 'Monto a Pagar',
      he: 'סכום לתשלום'
    },
    dueDate: {
      en: 'Due Date',
      es: 'Fecha de Vencimiento',
      he: 'תאריך לתשלום'
    },
    forAppointment: {
      en: 'For appointment',
      es: 'Para la cita',
      he: 'עבור הפגישה'
    },
    invoiceDetails: {
      en: 'Invoice Details',
      es: 'Detalles de la Factura',
      he: 'פרטי החשבונית'
    },
    total: {
      en: 'Total',
      es: 'Total',
      he: 'סה"כ'
    },
    /* "Includes VAT 19%" — the tax the business says is already in the price. */
    includesTax: {
      en: 'Includes',
      es: 'Incluye',
      he: 'כולל'
    },
    payNow: {
      en: 'Pay Now',
      es: 'Pagar Ahora',
      he: 'שלם עכשיו'
    },
    securePayment: {
      en: 'Secure payment powered by Stripe',
      es: 'Pago seguro procesado por Stripe',
      he: 'תשלום מאובטח באמצעות Stripe'
    },
    // How to pay when it is not by card. The email carried none of this, so a
    // business collected by transfer sent a bill whose only visible option was
    // the one that did not apply to it.
    bankTransferTitle: {
      en: 'Pay by bank transfer',
      es: 'Pagar por transferencia bancaria',
      he: 'תשלום בהעברה בנקאית'
    },
    bankName: {
      en: 'Bank',
      es: 'Banco',
      he: 'בנק'
    },
    bankAccount: {
      en: 'Account',
      es: 'Cuenta',
      he: 'חשבון'
    },
    bankRouting: {
      en: 'Branch / routing',
      es: 'Sucursal / ruta',
      he: 'סניף'
    },
    includeInvoiceNumber: {
      en: (invoiceNumber: string) => `Please quote ${invoiceNumber} with your transfer.`,
      es: (invoiceNumber: string) => `Por favor indica ${invoiceNumber} en tu transferencia.`,
      he: (invoiceNumber: string) => `נא לציין ${invoiceNumber} בהעברה.`
    },
    paymentInstructionsTitle: {
      en: 'How to pay',
      es: 'Cómo pagar',
      he: 'איך לשלם'
    },
    contactForPayment: {
      en: (businessName: string) => `Please contact ${businessName} to arrange payment.`,
      es: (businessName: string) => `Ponte en contacto con ${businessName} para organizar el pago.`,
      he: (businessName: string) => `נא ליצור קשר עם ${businessName} לתיאום התשלום.`
    },
    questions: {
      en: (businessName: string) =>
        `If you have any questions about this invoice, please reply to this email or contact ${businessName} directly.`,
      es: (businessName: string) =>
        `Si tienes alguna pregunta sobre esta factura, por favor responde a este correo o contacta a ${businessName} directamente.`,
      he: (businessName: string) =>
        `אם יש לך שאלות לגבי חשבונית זו, אנא השב למייל זה או צור קשר עם ${businessName} ישירות.`
    },
    service: {
      en: 'Service',
      es: 'Servicio',
      he: 'שירות'
    }
  },

  // ==========================================
  // CHASING AN UNPAID INVOICE
  //
  // Deliberately does NOT lead with how late it is. The number of days is a
  // fact about the business's records, not about the client's intentions, and
  // opening with it turns a reminder into an accusation. It appears once,
  // plainly, after the amount.
  //
  // Every sentence here used to be hardcoded English while the DATE beside it
  // was formatted in the reader's own language — so a Hebrew school chasing a
  // Hebrew client sent "It was due on יום ראשון, 27 בספטמבר 2026".
  // ==========================================
  chaseInvoice: {
    subject: {
      en: (invoiceNumber: string, businessName: string) => `Invoice ${invoiceNumber} from ${businessName}`,
      es: (invoiceNumber: string, businessName: string) => `Factura ${invoiceNumber} de ${businessName}`,
      he: (invoiceNumber: string, businessName: string) => `חשבונית ${invoiceNumber} מ-${businessName}`
    },
    openingFriendly: {
      en: (clientName: string) => `Hi ${clientName}, I hope you're well.`,
      es: (clientName: string) => `Hola ${clientName}, espero que estés bien.`,
      he: (clientName: string) => `שלום ${clientName}, מקווה ששלומך טוב.`
    },
    opening: {
      en: (clientName: string) => `Hi ${clientName},`,
      es: (clientName: string) => `Hola ${clientName},`,
      he: (clientName: string) => `שלום ${clientName},`
    },
    askFriendly: {
      en: (invoiceNumber: string, money: string) =>
        `I wanted to check in about invoice ${invoiceNumber} for ${money}, which is still showing as unpaid.`,
      es: (invoiceNumber: string, money: string) =>
        `Quería consultarte por la factura ${invoiceNumber} de ${money}, que sigue figurando como impagada.`,
      he: (invoiceNumber: string, money: string) =>
        `רציתי לבדוק לגבי חשבונית ${invoiceNumber} על סך ${money}, שעדיין מופיעה כלא שולמה.`
    },
    askFirm: {
      en: (invoiceNumber: string, money: string) =>
        `Invoice ${invoiceNumber} for ${money} is still outstanding and I'd be grateful if you could settle it.`,
      es: (invoiceNumber: string, money: string) =>
        `La factura ${invoiceNumber} de ${money} sigue pendiente y te agradecería que la liquidaras.`,
      he: (invoiceNumber: string, money: string) =>
        `חשבונית ${invoiceNumber} על סך ${money} עדיין פתוחה, ואשמח אם תוכל להסדיר אותה.`
    },
    dueOn: {
      en: (date: string) => `It was due on ${date}.`,
      es: (date: string) => `Vencía el ${date}.`,
      he: (date: string) => `מועד התשלום שלה היה ${date}.`
    },
    dueOnOverdue: {
      en: (date: string, days: number) =>
        `It was due on ${date}, ${days} ${days === 1 ? 'day' : 'days'} ago.`,
      es: (date: string, days: number) =>
        `Vencía el ${date}, hace ${days} ${days === 1 ? 'día' : 'días'}.`,
      he: (date: string, days: number) =>
        days === 1
          ? `מועד התשלום שלה היה ${date}, לפני יום.`
          : `מועד התשלום שלה היה ${date}, לפני ${days} ימים.`
    },
    payButton: {
      en: 'Pay invoice',
      es: 'Pagar factura',
      he: 'לתשלום החשבונית'
    },
    ignoreIfPaid: {
      en: "If you've already paid, please ignore this. Thank you.",
      es: 'Si ya lo has pagado, ignora este mensaje. Gracias.',
      he: 'אם כבר שילמת, אפשר להתעלם מהודעה זו. תודה.'
    }
  },

  // ==========================================
  // NUDGING SOMEBODY WHO WENT QUIET
  //
  // None of these states the silence back to the recipient. "We noticed you
  // stopped replying" is the honest content and nobody wants to receive it, so
  // each opening picks up where the relationship actually left off instead.
  // ==========================================
  followupNudge: {
    subject: {
      en: (businessName: string) => `Booking your next session with ${businessName}`,
      es: (businessName: string) => `Reserva tu próxima sesión con ${businessName}`,
      he: (businessName: string) => `לקביעת המפגש הבא שלך עם ${businessName}`
    },
    greetingFriendly: {
      en: (clientName: string) => `Hi ${clientName}, I hope you're keeping well.`,
      es: (clientName: string) => `Hola ${clientName}, espero que estés bien.`,
      he: (clientName: string) => `שלום ${clientName}, מקווה ששלומך טוב.`
    },
    greeting: {
      en: (clientName: string) => `Hi ${clientName},`,
      es: (clientName: string) => `Hola ${clientName},`,
      he: (clientName: string) => `שלום ${clientName},`
    },
    openingNewEnquiry: {
      en: (greeting: string) => `${greeting} You got in touch about working together, and I wanted to follow up.`,
      es: (greeting: string) => `${greeting} Nos escribiste para trabajar juntos y quería darte seguimiento.`,
      he: (greeting: string) => `${greeting} פנית אלינו בנוגע לעבודה משותפת, ורציתי לחזור אליך.`
    },
    openingPastClient: {
      en: (greeting: string) => `${greeting} It has been a little while since your last visit.`,
      es: (greeting: string) => `${greeting} Ha pasado un tiempo desde tu última visita.`,
      he: (greeting: string) => `${greeting} עבר קצת זמן מאז הביקור האחרון שלך.`
    },
    openingAfterIntro: {
      en: (greeting: string) => `${greeting} I hope you enjoyed your first session.`,
      es: (greeting: string) => `${greeting} Espero que hayas disfrutado tu primera sesión.`,
      he: (greeting: string) => `${greeting} מקווה שנהנית מהמפגש הראשון.`
    },
    bodyNewEnquiry: {
      en: "If you'd still like to go ahead, you can pick a time that suits you.",
      es: 'Si todavía quieres seguir adelante, puedes elegir la hora que te convenga.',
      he: 'אם עדיין מתאים לך להתקדם, אפשר לבחור מועד שנוח לך.'
    },
    bodyArrange: {
      en: (next: string) => `I wanted to check whether you'd like to arrange ${next}.`,
      es: (next: string) => `Quería preguntarte si te gustaría concertar ${next}.`,
      he: (next: string) => `רציתי לבדוק אם תרצה לקבוע ${next}.`
    },
    nextNamed: {
      en: (serviceName: string) => `your next ${serviceName}`,
      es: (serviceName: string) => `tu próxima ${serviceName}`,
      he: (serviceName: string) => `את ${serviceName} הבא שלך`
    },
    nextGeneric: {
      en: 'your next session',
      es: 'tu próxima sesión',
      he: 'את המפגש הבא שלך'
    },
    bookButton: {
      en: 'Book a time',
      es: 'Reservar hora',
      he: 'לקביעת מועד'
    },
    noPressure: {
      en: "If now isn't the right time, just let me know and I'll leave it with you.",
      es: 'Si ahora no es buen momento, dímelo y lo dejo en tus manos.',
      he: 'אם זה לא הזמן המתאים, פשוט עדכן אותי ואשאיר את זה אצלך.'
    }
  },

  // ==========================================
  // REMINDING A CLIENT OF AN APPOINTMENT
  // ==========================================
  bookingReminder: {
    subject: {
      en: (serviceName: string, when: string) => `Reminder: ${serviceName} on ${when}`,
      es: (serviceName: string, when: string) => `Recordatorio: ${serviceName} el ${when}`,
      he: (serviceName: string, when: string) => `תזכורת: ${serviceName} ב-${when}`
    },
    greeting: {
      en: (clientName: string) => `Hi ${clientName},`,
      es: (clientName: string) => `Hola ${clientName},`,
      he: (clientName: string) => `שלום ${clientName},`
    },
    body: {
      en: (serviceName: string, when: string) => `A reminder about your ${serviceName} on ${when}.`,
      es: (serviceName: string, when: string) => `Un recordatorio sobre tu ${serviceName} el ${when}.`,
      he: (serviceName: string, when: string) => `תזכורת לגבי ${serviceName} שלך ב-${when}.`
    },
    manageButton: {
      en: 'Reschedule or cancel',
      es: 'Reprogramar o cancelar',
      he: 'שינוי מועד או ביטול'
    },
    closing: {
      en: 'Looking forward to seeing you.',
      es: 'Nos vemos pronto.',
      he: 'נתראה בקרוב.'
    }
  }
} as const;

/**
 * Get translation for a specific key and locale
 */
export function getEmailTranslation<T>(
  translations: Record<Locale, T>,
  locale: Locale
): T {
  return translations[locale] || translations.en;
}

/**
 * Format date for email display with locale support
 */
export function formatEmailDateLocalized(
  date: Date,
  timezone: string,
  locale: Locale,
  options: { includeTime?: boolean; includeYear?: boolean } = {}
): string {
  const { includeTime = true, includeYear = true } = options;

  // Map our locales to Intl locale codes
  const intlLocales: Record<Locale, string> = {
    en: 'en-US',
    es: 'es-ES',
    he: 'he-IL'
  };

  try {
    const dateOptions: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      timeZone: timezone
    };

    if (includeYear) {
      dateOptions.year = 'numeric';
    }

    if (includeTime) {
      dateOptions.hour = 'numeric';
      dateOptions.minute = '2-digit';
      dateOptions.hour12 = locale !== 'he'; // Hebrew typically uses 24h format
      // Name the clock, exactly as `formatEmailDate` does. Nothing calls this
      // function today; kept in step so that whoever first does inherits the
      // labelled behaviour rather than silently reintroducing a bare hour.
      dateOptions.timeZoneName = 'long';
    }

    return new Intl.DateTimeFormat(intlLocales[locale], dateOptions).format(date);
  } catch {
    // Fallback if timezone is invalid
    return date.toLocaleString(intlLocales[locale] || 'en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: includeYear ? 'numeric' : undefined,
      hour: includeTime ? 'numeric' : undefined,
      minute: includeTime ? '2-digit' : undefined,
      hour12: locale !== 'he'
    });
  }
}

/**
 * What a CLIENT is told a cancellation was for, or nothing.
 *
 * Returns undefined rather than the code for anything with no client-safe
 * phrasing — `test_booking` and `other` deliberately have none. Leaking
 * `client_not_paying` into an inbox is worse than saying nothing at all.
 */
export function clientFacingCancelReason(
  code: string | null | undefined,
  locale: 'en' | 'es' | 'he'
): string | undefined {
  if (!code) return undefined;
  const entry = (emailTranslations.cancelReasonForClient as Record<
    string,
    Record<string, string> | undefined
  >)[code];
  return entry?.[locale];
}
