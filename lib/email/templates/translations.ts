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
  intake: {
    subject: {
      en: (serviceName: string) => `Please complete your intake form - ${serviceName}`,
      es: (serviceName: string) => `Por favor completa tu formulario de admisión - ${serviceName}`,
      he: (serviceName: string) => `אנא השלם את טופס הקבלה שלך - ${serviceName}`
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
  bookingCancellation: {
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
    reasonLabel: {
      en: '📝 Reason',
      es: '📝 Motivo',
      he: '📝 סיבה'
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
    greeting: {
      en: 'Invoice',
      es: 'Factura',
      he: 'חשבונית'
    },
    intro: {
      en: (clientName: string, businessName: string) =>
        `Hi ${clientName}, please find your invoice from ${businessName} below.`,
      es: (clientName: string, businessName: string) =>
        `Hola ${clientName}, a continuación encontrarás tu factura de ${businessName}.`,
      he: (clientName: string, businessName: string) =>
        `שלום ${clientName}, מצורפת החשבונית שלך מ-${businessName}.`
    },
    invoiceNumber: {
      en: 'Invoice Number',
      es: 'Número de Factura',
      he: 'מספר חשבונית'
    },
    dueDate: {
      en: 'Due Date',
      es: 'Fecha de Vencimiento',
      he: 'תאריך לתשלום'
    },
    totalDue: {
      en: 'Total Due',
      es: 'Total a Pagar',
      he: 'סה"כ לתשלום'
    },
    payInvoice: {
      en: 'Pay Invoice',
      es: 'Pagar Factura',
      he: 'שלם חשבונית'
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
