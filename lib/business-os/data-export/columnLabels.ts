// lib/business-os/data-export/columnLabels.ts
//
// MX-2b (BUSINESS_OS_EXPORT_MX2B_WORKPLAN.md §2, SA Workplan Review 2026-10-28;
// requirement BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md §4.2, §4.3, BQ-31,
// SA-P3): the words of the module CSV, in English, Hebrew and Spanish.
//
// What is translated (BQ-31, user 2026-10-28): headers, record types and the
// four fixed headers only. No cell value passes through this file; status
// codes, stage names and true/false are written as stored (user 2026-10-28,
// MX2B-Q1..Q3). Spanish is a draft (requirement §4.3).
//
// Storage is by column KEY, with a section override only where one key means
// different things in different modules (SA MX2B-2). Resolution is still per
// section.column: the section's entry, then the key's entry.
//
// Fallback (SA MX2B-4): the requested language, then English, then the raw
// key; never throws. CI (`columnLabelProblems`, L-1..L-9) keeps every real
// column out of the fallback, so it only covers a rule that was skipped.
//
// SERVER-ONLY so about 1,300 strings stay out of every browser bundle
// (requirement §4.2). PURE: type-only imports, no I/O, nothing to log.
//
// Hebrew is written as literal letters. Any control character the rules look
// for is built from a char code, so no backslash-hex escape appears in this
// file (Tailwind scans lib/, PR #180).

import 'server-only';
import type { ExportSectionId } from '@/lib/business-os/data-export/classificationTypes';
import type { ExportModuleLanguage } from '@/lib/business-os/data-export/exportModules';
import type { JoinedCsvFixedColumn, JoinedCsvLabels } from '@/lib/business-os/data-export/joinedCsv';

/** One label in every export language. `es` may be a draft (requirement §4.3). */
export type LabelText = Readonly<Record<ExportModuleLanguage, string>>;

const EXPORT_LANGUAGES: readonly ExportModuleLanguage[] = ['en', 'he', 'es'];

const L = (en: string, he: string, es: string): LabelText => ({ en, he, es });

// ── Fixed headers and record types ──────────────────────────────────────────

/** "Record type", "Belongs to", "Record ID", "Parent ID". */
export const FIXED_COLUMN_LABELS: Readonly<Record<JoinedCsvFixedColumn, LabelText>> = {
  record_type: L('Record type', 'סוג רשומה', 'Tipo de registro'),
  belongs_to: L('Belongs to', 'שייך ל־', 'Pertenece a'),
  record_id: L('Record ID', 'מזהה רשומה', 'ID del registro'),
  parent_id: L('Parent ID', 'מזהה רשומת האב', 'ID del registro principal'),
};

/**
 * Singular record-type name per section (SA-P3). A full Record, so a new
 * section without a name fails tsc. "הזמנה" follows MX-0's "הזמנות" (MX0-8).
 */
export const RECORD_TYPE_LABELS: Readonly<Record<ExportSectionId, LabelText>> = {
  clients: L('Client', 'לקוח', 'Cliente'),
  pipeline_stages: L('Pipeline stage', 'שלב בפייפליין', 'Etapa del embudo'),
  client_documents: L('Document', 'מסמך', 'Documento'),
  client_activities: L('Activity', 'פעילות', 'Actividad'),
  client_tasks: L('Task', 'משימה', 'Tarea'),
  bookings: L('Booking', 'הזמנה', 'Reserva'),
  time_off: L('Time off', 'זמן חסום', 'Tiempo no disponible'),
  services: L('Service', 'שירות', 'Servicio'),
  quotes: L('Quote', 'הצעת מחיר', 'Presupuesto'),
  invoices: L('Invoice', 'חשבונית', 'Factura'),
  payments: L('Payment', 'תשלום', 'Pago'),
  refunds: L('Refund', 'החזר', 'Reembolso'),
  client_payment_methods: L('Saved payment method', 'אמצעי תשלום שמור', 'Método de pago guardado'),
  payment_plans: L('Payment plan', 'תוכנית תשלום', 'Plan de pago'),
  client_payment_plans: L('Client payment plan', 'תוכנית תשלום של לקוח', 'Plan de pago del cliente'),
  installments: L('Installment', 'תשלום בתוכנית', 'Cuota'),
  intake_settings: L('Intake form settings', 'הגדרות טופס לקוח', 'Ajustes del formulario de admisión'),
  intake_forms: L('Intake form', 'טופס לקוח', 'Formulario de admisión'),
  email_campaigns: L('Email campaign', 'קמפיין אימייל', 'Campaña de email'),
  email_sequences: L('Email sequence', 'רצף אימיילים', 'Secuencia de emails'),
  email_sequence_steps: L('Sequence step', 'שלב ברצף', 'Paso de la secuencia'),
  email_sequence_enrollments: L('Sequence enrollment', 'רישום לרצף', 'Inscripción en la secuencia'),
  newsletter_subscribers: L('Newsletter subscriber', 'מנוי לניוזלטר', 'Suscriptor del boletín'),
  consent_records: L('Consent record', 'תיעוד הסכמה', 'Registro de consentimiento'),
  consent_settings: L('Consent settings', 'הגדרות הסכמה', 'Ajustes de consentimiento'),
  email_unsubscribes: L('Email unsubscribe', 'הסרה מרשימת התפוצה', 'Baja de emails'),
  website_content: L('Website content', 'תוכן האתר', 'Contenido del sitio web'),
  website_pages: L('Page', 'עמוד', 'Página'),
  website_blocks: L('Page block', 'רכיב בעמוד', 'Bloque de página'),
  images: L('Picture', 'תמונה', 'Imagen'),
  smart_links: L('Smart link', 'קישור חכם', 'Enlace inteligente'),
  account_identity: L('Sign-in account', 'חשבון כניסה', 'Cuenta de acceso'),
  user_profile: L('Profile', 'פרופיל', 'Perfil'),
  preferences: L('Preferences', 'העדפות', 'Preferencias'),
  notification_settings: L('Notification settings', 'הגדרות התראות', 'Ajustes de notificaciones'),
  business_profile: L('Business profile', 'פרופיל העסק', 'Perfil del negocio'),
  business_addresses: L('Business address', 'כתובת העסק', 'Dirección del negocio'),
  payment_account: L('Stripe account', 'חשבון Stripe', 'Cuenta de Stripe'),
  payment_providers: L('Payment provider', 'ספק תשלומים', 'Proveedor de pagos'),
};

// ── Column labels ───────────────────────────────────────────────────────────

/**
 * A column key's label wherever the key appears, grouped by the module where
 * the key first appears. A key shared inside one module keeps one generic
 * label because it is one column there (L-6); the Record type column tells
 * the rows apart.
 */
export const COLUMN_LABELS_BY_KEY: Readonly<Record<string, LabelText>> = {
  // Clients
  first_name: L('First name', 'שם פרטי', 'Nombre de pila'),
  last_name: L('Last name', 'שם משפחה', 'Apellido'),
  email: L('Email', 'אימייל', 'Email'),
  phone: L('Phone', 'טלפון', 'Teléfono'),
  stage: L('Stage', 'שלב', 'Etapa'),
  stage_entered_at: L('Entered stage at', 'מועד הכניסה לשלב', 'Fecha de entrada en la etapa'),
  tags: L('Tags', 'תגיות', 'Etiquetas'),
  custom_fields: L('Custom fields', 'שדות מותאמים', 'Campos personalizados'),
  notes: L('Notes', 'הערות', 'Notas'),
  source: L('Source', 'מקור', 'Origen'),
  source_metadata: L('Source details', 'פרטי המקור', 'Detalles del origen'),
  referrer_domain: L('Referring site', 'אתר מפנה', 'Sitio de referencia'),
  utm_source: L('UTM source', 'מקור (UTM)', 'Origen UTM'),
  utm_medium: L('UTM medium', 'מדיום (UTM)', 'Medio UTM'),
  utm_campaign: L('UTM campaign', 'קמפיין (UTM)', 'Campaña UTM'),
  created_at: L('Created at', 'תאריך יצירה', 'Fecha de creación'),
  updated_at: L('Updated at', 'תאריך עדכון', 'Fecha de actualización'),
  vertical: L('Industry', 'תחום', 'Sector'),
  stage_key: L('Stage key', 'מפתח השלב', 'Clave de la etapa'),
  stage_label: L('Stage name', 'שם השלב', 'Nombre de la etapa'),
  position: L('Position', 'מיקום', 'Posición'),
  color: L('Color', 'צבע', 'Color'),
  stage_type: L('Stage type', 'סוג השלב', 'Tipo de etapa'),
  is_primary_client_stage: L('Main client stage', 'שלב הלקוח הראשי', 'Etapa principal de cliente'),
  contact_id: L('Client', 'לקוח', 'Cliente'),
  name: L('Name', 'שם', 'Nombre'),
  document_type: L('Document type', 'סוג המסמך', 'Tipo de documento'),
  file_name: L('File name', 'שם הקובץ', 'Nombre del archivo'),
  file_size: L('File size (bytes)', 'גודל הקובץ (בתים)', 'Tamaño del archivo (bytes)'),
  mime_type: L('File format', 'פורמט הקובץ', 'Formato del archivo'),
  description: L('Description', 'תיאור', 'Descripción'),
  status: L('Status', 'סטטוס', 'Estado'),

  // Activities & tasks
  activity_type: L('Activity type', 'סוג הפעילות', 'Tipo de actividad'),
  title: L('Title', 'כותרת', 'Título'),
  activity_date: L('Activity date', 'תאריך הפעילות', 'Fecha de la actividad'),
  auto_logged: L('Logged automatically', 'נרשם אוטומטית', 'Registrado automáticamente'),
  source_capability: L('Source feature', 'רכיב המקור', 'Función de origen'),
  source_entity_id: L('Source record ID', 'מזהה רשומת המקור', 'ID del registro de origen'),
  priority: L('Priority', 'עדיפות', 'Prioridad'),
  due_date: L('Due date', 'תאריך יעד', 'Fecha de vencimiento'),
  reminder_at: L('Reminder at', 'מועד התזכורת', 'Fecha del recordatorio'),
  completed_at: L('Completed at', 'מועד השלמה', 'Fecha de finalización'),
  created_by: L('Created by', 'נוצר על ידי', 'Creado por'),
  source_entity_type: L('Source record type', 'סוג רשומת המקור', 'Tipo de registro de origen'),

  // Bookings
  service_id: L('Service', 'שירות', 'Servicio'),
  parent_booking_id: L('Parent booking ID', 'מזהה ההזמנה הראשית', 'ID de la reserva principal'),
  occurrence_number: L('Occurrence number', 'מספר המופע', 'Número de repetición'),
  start_time: L('Start time', 'שעת התחלה', 'Hora de inicio'),
  end_time: L('End time', 'שעת סיום', 'Hora de fin'),
  timezone: L('Time zone', 'אזור זמן', 'Zona horaria'),
  cancellation_reason: L('Cancellation reason (text)', 'סיבת ביטול (טקסט)', 'Motivo de cancelación (texto)'),
  cancel_reason: L('Cancellation reason (code)', 'סיבת ביטול (קוד)', 'Motivo de cancelación (código)'),
  cancel_note: L('Cancellation note', 'הערת ביטול', 'Nota de cancelación'),
  cancelled_by: L('Cancelled by', 'בוטל על ידי', 'Cancelado por'),
  booking_source: L('Booking source', 'מקור ההזמנה', 'Origen de la reserva'),
  internal_notes: L('Internal notes', 'הערות פנימיות', 'Notas internas'),
  payment_status: L('Payment status', 'סטטוס תשלום', 'Estado del pago'),
  payment_method: L('Payment method', 'אמצעי תשלום', 'Método de pago'),
  payment_amount: L('Payment amount', 'סכום התשלום', 'Importe del pago'),
  payment_currency: L('Payment currency', 'מטבע התשלום', 'Moneda del pago'),
  payment_id: L('Payment ID', 'מזהה תשלום', 'ID del pago'),
  invoice_id: L('Invoice', 'חשבונית', 'Factura'),
  payment_plan_id: L('Payment plan', 'תוכנית תשלום', 'Plan de pago'),
  intake_responses: L('Intake form answers', 'תשובות טופס לקוח', 'Respuestas del formulario de admisión'),
  intake_completed_at: L('Intake form completed at', 'מועד מילוי טופס לקוח', 'Fecha de envío del formulario de admisión'),
  exception_type: L('Time off type', 'סוג החסימה', 'Tipo de bloqueo'),
  start_date: L('Start date', 'תאריך התחלה', 'Fecha de inicio'),
  end_date: L('End date', 'תאריך סיום', 'Fecha de fin'),
  custom_hours: L('Custom hours', 'שעות מותאמות', 'Horario personalizado'),
  reason: L('Reason', 'סיבה', 'Motivo'),

  // Services
  service_name: L('Service name', 'שם השירות', 'Nombre del servicio'),
  duration_minutes: L('Duration (minutes)', 'משך (דקות)', 'Duración (minutos)'),
  price: L('Price', 'מחיר', 'Precio'),
  currency: L('Currency', 'מטבע', 'Moneda'),
  buffer_minutes: L('Buffer (minutes)', 'זמן מרווח (דקות)', 'Margen (minutos)'),
  max_bookings_per_day: L('Max bookings per day', 'מקסימום הזמנות ביום', 'Máximo de reservas por día'),
  advance_booking_days: L('Book ahead (days)', 'הזמנה מראש (ימים)', 'Antelación máxima (días)'),
  min_notice_hours: L('Minimum notice (hours)', 'התראה מינימלית (שעות)', 'Antelación mínima (horas)'),
  availability: L('Availability', 'זמינות', 'Disponibilidad'),
  is_active: L('Active', 'פעיל', 'Activo'),
  is_scheduled: L('Needs a booking', 'דורש תיאום מועד', 'Requiere cita'),
  collection: L('Collection', 'אוסף', 'Colección'),
  sale_mode: L('Sale mode', 'אופן המכירה', 'Modo de venta'),
  payment_type: L('Payment type', 'סוג התשלום', 'Tipo de pago'),
  installment_count: L('Number of installments', 'מספר תשלומים', 'Número de cuotas'),
  installment_frequency: L('Installment frequency', 'תדירות התשלומים', 'Frecuencia de las cuotas'),
  first_payment_due: L('First payment due', 'מועד התשלום הראשון', 'Vencimiento del primer pago'),
  first_payment_days: L('First payment after (days)', 'התשלום הראשון אחרי (ימים)', 'Primer pago tras (días)'),

  // Quotes
  booking_id: L('Booking ID', 'מזהה הזמנה', 'ID de la reserva'),
  package_booking_id: L('Package booking ID', 'מזהה הזמנת החבילה', 'ID de la reserva del paquete'),
  document_id: L('Document ID', 'מזהה מסמך', 'ID del documento'),
  supersedes_id: L('Replaces quote', 'מחליפה את הצעת המחיר', 'Sustituye al presupuesto'),
  created_invoice_id: L('Created invoice ID', 'מזהה החשבונית שנוצרה', 'ID de la factura creada'),
  created_plan_id: L('Created payment plan ID', 'מזהה תוכנית התשלום שנוצרה', 'ID del plan de pago creado'),
  total: L('Total', 'סכום כולל', 'Total'),
  prices_include_tax: L('Prices include tax', 'המחירים כוללים מס', 'Precios con impuestos incluidos'),
  tax_rate: L('Tax rate', 'שיעור המס', 'Tipo impositivo'),
  tax_label: L('Tax name', 'שם המס', 'Nombre del impuesto'),
  payment_shape: L('Payment structure', 'מבנה התשלום', 'Estructura del pago'),
  payment_terms_days: L('Payment terms (days)', 'תנאי תשלום (ימים)', 'Plazo de pago (días)'),
  sessions: L('Sessions', 'מפגשים', 'Sesiones'),
  valid_until: L('Valid until', 'בתוקף עד', 'Válido hasta'),
  decline_reason: L('Decline reason', 'סיבת הדחייה', 'Motivo del rechazo'),
  decline_note: L('Decline note', 'הערת דחייה', 'Nota del rechazo'),
  stop_reason: L('Stop reason', 'סיבת העצירה', 'Motivo de la detención'),
  stop_note: L('Stop note', 'הערת עצירה', 'Nota de la detención'),
  accepted_snapshot: L('Accepted version', 'הגרסה שאושרה', 'Versión aceptada'),
  sent_at: L('Sent at', 'מועד שליחה', 'Fecha de envío'),
  viewed_at: L('Viewed at', 'מועד צפייה', 'Fecha de visualización'),
  decided_at: L('Decided at', 'מועד ההחלטה', 'Fecha de decisión'),
  stopped_at: L('Stopped at', 'מועד העצירה', 'Fecha de detención'),

  // Invoices & payments
  invoice_number: L('Invoice number', 'מספר חשבונית', 'Número de factura'),
  amount: L('Amount', 'סכום', 'Importe'),
  line_items: L('Line items', 'שורות החשבונית', 'Líneas de la factura'),
  payment_terms: L('Payment terms', 'תנאי תשלום', 'Condiciones de pago'),
  paid_at: L('Paid at', 'מועד תשלום', 'Fecha de pago'),
  payment_received_at: L('Payment received at', 'מועד קבלת התשלום', 'Fecha de recepción del pago'),
  payment_notes: L('Payment notes', 'הערות תשלום', 'Notas del pago'),
  processor_type: L('Payment processor', 'סולק התשלומים', 'Procesador de pagos'),
  processor_checkout_id: L('Processor checkout ID', 'מזהה דף התשלום אצל הסולק', 'ID del checkout en el procesador'),
  processor_payment_id: L('Processor payment ID', 'מזהה התשלום אצל הסולק', 'ID del pago en el procesador'),
  processor_customer_id: L('Processor customer ID', 'מזהה הלקוח אצל הסולק', 'ID del cliente en el procesador'),
  processor_payment_method_id: L('Processor payment method ID', 'מזהה אמצעי התשלום אצל הסולק', 'ID del método de pago en el procesador'),
  stripe_invoice_id: L('Stripe invoice ID', 'מזהה חשבונית ב־Stripe', 'ID de la factura de Stripe'),
  stripe_hosted_invoice_url: L('Stripe invoice page', 'דף החשבונית ב־Stripe', 'Página de la factura en Stripe'),
  stripe_invoice_pdf: L('Stripe invoice PDF', 'קובץ PDF של החשבונית ב־Stripe', 'PDF de la factura en Stripe'),
  client_name: L('Client name (on invoice)', 'שם הלקוח בחשבונית', 'Nombre del cliente en la factura'),
  client_email: L('Client email (on invoice)', 'אימייל הלקוח בחשבונית', 'Email del cliente en la factura'),
  client_address: L('Client address (on invoice)', 'כתובת הלקוח בחשבונית', 'Dirección del cliente en la factura'),
  refunded_amount: L('Refunded amount', 'סכום שהוחזר', 'Importe reembolsado'),
  refund_status: L('Refund status', 'סטטוס ההחזר', 'Estado del reembolso'),
  refunded_at: L('Refunded at', 'מועד ההחזר', 'Fecha del reembolso'),
  allow_online_payment: L('Online payment allowed', 'אפשר תשלום מקוון', 'Pago en línea permitido'),
  metadata: L('Metadata', 'מטא־דאטה', 'Metadatos'),
  failure_reason: L('Failure reason', 'סיבת הכישלון', 'Motivo del fallo'),
  refund_reason: L('Refund reason', 'סיבת ההחזר', 'Motivo del reembolso'),
  processor_refund_id: L('Processor refund ID', 'מזהה ההחזר אצל הסולק', 'ID del reembolso en el procesador'),
  processor_fee: L('Processor fee', 'עמלת סליקה', 'Comisión del procesador'),
  net_amount: L('Net amount', 'סכום נטו', 'Importe neto'),
  fee_currency: L('Fee currency', 'מטבע העמלה', 'Moneda de la comisión'),
  stripe_payment_intent_id: L('Stripe payment intent ID', 'מזהה כוונת תשלום ב־Stripe', 'ID de la intención de pago de Stripe'),
  stripe_charge_id: L('Stripe charge ID', 'מזהה חיוב ב־Stripe', 'ID del cargo de Stripe'),
  stripe_customer_id: L('Stripe customer ID', 'מזהה לקוח ב־Stripe', 'ID del cliente de Stripe'),
  stripe_connect_account_id: L('Stripe Connect account ID', 'מזהה חשבון Stripe Connect', 'ID de la cuenta de Stripe Connect'),
  transaction_id: L('Transaction ID', 'מזהה העסקה', 'ID de la transacción'),
  amount_minor: L('Amount (minor units)', 'סכום (ביחידות הקטנות)', 'Importe (unidades menores)'),
  reason_note: L('Reason note', 'הערה לסיבה', 'Nota del motivo'),
  failure_code: L('Failure code', 'קוד הכישלון', 'Código de fallo'),
  failure_message: L('Failure message', 'הודעת הכישלון', 'Mensaje de fallo'),
  fee_returned: L('Fee returned', 'עמלה שהוחזרה', 'Comisión devuelta'),
  refund_fee: L('Refund fee', 'עמלת החזר', 'Comisión del reembolso'),
  succeeded_at: L('Succeeded at', 'מועד ההצלחה', 'Fecha de éxito'),
  processor_method_id: L('Processor method ID', 'מזהה האמצעי אצל הסולק', 'ID del método en el procesador'),
  method_type: L('Method type', 'סוג האמצעי', 'Tipo de método'),
  brand: L('Card brand', 'מותג הכרטיס', 'Marca de la tarjeta'),
  last_four: L('Last four digits', 'ארבע ספרות אחרונות', 'Últimos cuatro dígitos'),
  is_default: L('Default', 'ברירת מחדל', 'Predeterminado'),
  is_valid: L('Valid', 'תקף', 'Válido'),

  // Payment plans
  total_amount: L('Total amount', 'סכום כולל', 'Importe total'),
  supported_currencies: L('Supported currencies', 'מטבעות נתמכים', 'Monedas admitidas'),
  installment_amount: L('Installment amount', 'סכום כל תשלום', 'Importe de la cuota'),
  allowed_processors: L('Allowed processors', 'סולקים מותרים', 'Procesadores permitidos'),
  preferred_processor: L('Preferred processor', 'סולק מועדף', 'Procesador preferido'),
  stripe_subscription_id: L('Stripe subscription ID', 'מזהה מנוי ב־Stripe', 'ID de la suscripción de Stripe'),
  stripe_schedule_id: L('Stripe schedule ID', 'מזהה לוח תשלומים ב־Stripe', 'ID del calendario de Stripe'),
  stripe_price_id: L('Stripe price ID', 'מזהה מחיר ב־Stripe', 'ID del precio de Stripe'),
  frequency: L('Frequency', 'תדירות', 'Frecuencia'),
  periods_paid: L('Periods paid', 'תקופות ששולמו', 'Periodos pagados'),
  next_charge_at: L('Next charge at', 'מועד החיוב הבא', 'Fecha del próximo cargo'),
  next_charge_amount: L('Next charge amount', 'סכום החיוב הבא', 'Importe del próximo cargo'),
  last_failure_code: L('Last failure code', 'קוד הכישלון האחרון', 'Último código de fallo'),
  last_failure_at: L('Last failure at', 'מועד הכישלון האחרון', 'Fecha del último fallo'),
  card_brand: L('Card brand', 'מותג הכרטיס', 'Marca de la tarjeta'),
  card_last4: L('Card last four digits', 'ארבע ספרות אחרונות של הכרטיס', 'Últimos cuatro dígitos de la tarjeta'),
  cancelled_at: L('Cancelled at', 'מועד הביטול', 'Fecha de cancelación'),
  subscription_id: L('Subscription ID', 'מזהה מנוי', 'ID de la suscripción'),
  proposal_id: L('Proposal ID', 'מזהה הצעה', 'ID de la propuesta'),
  installment_number: L('Installment number', 'מספר התשלום', 'Número de cuota'),
  label: L('Label', 'תווית', 'Etiqueta'),
  trigger: L('Trigger', 'גורם מפעיל', 'Disparador'),

  // Forms
  is_enabled: L('Enabled', 'מופעל', 'Activado'),
  send_after_booking: L('Send after booking', 'שליחה אחרי הזמנה', 'Enviar tras la reserva'),
  version: L('Version', 'גרסה', 'Versión'),
  questions: L('Questions', 'שאלות', 'Preguntas'),
  generated_at: L('Generated at', 'מועד ההפקה', 'Fecha de generación'),
  published_at: L('Published at', 'מועד פרסום', 'Fecha de publicación'),

  // Email campaigns
  subject: L('Subject', 'נושא', 'Asunto'),
  body_html: L('Body (HTML)', 'תוכן (HTML)', 'Cuerpo (HTML)'),
  body_text: L('Body (plain text)', 'תוכן (טקסט)', 'Cuerpo (texto)'),
  segment_filter: L('Audience filter', 'סינון קהל', 'Filtro de audiencia'),
  scheduled_at: L('Scheduled for', 'מתוזמן ל־', 'Programado para'),
  trigger_type: L('Trigger type', 'סוג הגורם המפעיל', 'Tipo de disparador'),
  trigger_config: L('Trigger settings', 'הגדרות הגורם המפעיל', 'Ajustes del disparador'),
  sequence_id: L('Email sequence', 'רצף אימיילים', 'Secuencia de emails'),
  step_number: L('Step number', 'מספר השלב', 'Número de paso'),
  delay_minutes: L('Delay (minutes)', 'השהיה (דקות)', 'Retraso (minutos)'),
  current_step_number: L('Current step', 'השלב הנוכחי', 'Paso actual'),
  enrolled_at: L('Enrolled at', 'מועד הרישום', 'Fecha de inscripción'),

  // Newsletter & consent
  attribution: L('Attribution', 'ייחוס', 'Atribución'),
  subscribed_at: L('Subscribed at', 'מועד ההרשמה', 'Fecha de suscripción'),
  confirmed_at: L('Confirmed at', 'מועד האישור', 'Fecha de confirmación'),
  promoted_contact_id: L('Became client', 'הפך ללקוח', 'Convertido en cliente'),
  promoted_at: L('Became client at', 'מועד ההפיכה ללקוח', 'Fecha de conversión en cliente'),
  channel: L('Channel', 'ערוץ', 'Canal'),
  purpose: L('Purpose', 'מטרה', 'Finalidad'),
  decision: L('Decision', 'החלטה', 'Decisión'),
  method: L('Method', 'שיטה', 'Método'),
  statement_text: L('Consent statement', 'נוסח ההסכמה', 'Texto del consentimiento'),
  statement_locale: L('Statement language', 'שפת הנוסח', 'Idioma del texto'),
  statement_version: L('Statement version', 'גרסת הנוסח', 'Versión del texto'),
  privacy_policy_url: L('Privacy policy URL', 'קישור למדיניות הפרטיות', 'URL de la política de privacidad'),
  source_surface: L('Collected on', 'מקום האיסוף', 'Lugar de captura'),
  source_page_url: L('Source page URL', 'כתובת עמוד המקור', 'URL de la página de origen'),
  evidence: L('Evidence', 'ראיות', 'Evidencia'),
  redacted_at: L('Redacted at', 'מועד מחיקת הפרטים', 'Fecha de anonimización'),
  occurred_at: L('Occurred at', 'מועד האירוע', 'Fecha del evento'),
  capture_enabled: L('Consent capture on', 'איסוף הסכמה מופעל', 'Captura de consentimiento activada'),
  statement_en: L('Statement (English)', 'נוסח (אנגלית)', 'Texto (inglés)'),
  statement_es: L('Statement (Spanish)', 'נוסח (ספרדית)', 'Texto (español)'),
  statement_he: L('Statement (Hebrew)', 'נוסח (עברית)', 'Texto (hebreo)'),
  privacy_policy_mode: L('Privacy policy mode', 'סוג מדיניות הפרטיות', 'Modo de la política de privacidad'),
  privacy_policy_body: L('Privacy policy text', 'נוסח מדיניות הפרטיות', 'Texto de la política de privacidad'),
  privacy_policy_updated_at: L('Privacy policy updated at', 'מועד עדכון מדיניות הפרטיות', 'Fecha de actualización de la política de privacidad'),
  postal_address: L('Postal address', 'כתובת דואר', 'Dirección postal'),
  label_as_advertisement: L('Label as advertisement', 'סימון כפרסומת', 'Marcar como publicidad'),
  unsubscribed_at: L('Unsubscribed at', 'מועד ההסרה', 'Fecha de baja'),

  // Website
  hero: L('Hero section', 'אזור הפתיחה', 'Sección principal'),
  about: L('About section', 'אזור אודות', 'Sección Sobre nosotros'),
  services: L('Services', 'שירותים', 'Servicios'),
  testimonials: L('Testimonials section', 'אזור ההמלצות', 'Sección de testimonios'),
  faq: L('FAQ section', 'אזור השאלות הנפוצות', 'Sección de preguntas frecuentes'),
  team: L('Team section', 'אזור הצוות', 'Sección del equipo'),
  contact: L('Contact section', 'אזור יצירת הקשר', 'Sección de contacto'),
  process: L('Process section', 'אזור התהליך', 'Sección del proceso'),
  features: L('Features section', 'אזור היתרונות', 'Sección de características'),
  stats: L('Stats section', 'אזור הנתונים', 'Sección de cifras'),
  pricing: L('Pricing section', 'אזור המחירים', 'Sección de precios'),
  gallery: L('Gallery section', 'אזור הגלריה', 'Sección de galería'),
  cta: L('Call to action section', 'אזור ההנעה לפעולה', 'Sección de llamada a la acción'),
  newsletter: L('Newsletter section', 'אזור הניוזלטר', 'Sección del boletín'),
  logo_cloud: L('Logos section', 'אזור הלוגואים', 'Sección de logotipos'),
  video: L('Video section', 'אזור הווידאו', 'Sección de vídeo'),
  booking_widget: L('Booking widget', 'רכיב ההזמנה', 'Widget de reservas'),
  payment_button: L('Payment button', 'כפתור תשלום', 'Botón de pago'),
  intake_form: L('Intake form section', 'אזור טופס הלקוח', 'Sección del formulario de admisión'),
  page_type: L('Page type', 'סוג העמוד', 'Tipo de página'),
  slug: L('URL slug', 'כתובת העמוד (slug)', 'Slug de la URL'),
  meta_description: L('Meta description', 'תיאור למנועי חיפוש', 'Metadescripción'),
  seo_keywords: L('SEO keywords', 'מילות מפתח לקידום', 'Palabras clave SEO'),
  published: L('Published', 'מפורסם', 'Publicado'),
  template_id: L('Template ID', 'מזהה תבנית', 'ID de la plantilla'),
  theme: L('Theme', 'ערכת עיצוב', 'Tema'),
  subdomain: L('Subdomain', 'תת־דומיין', 'Subdominio'),
  custom_domain: L('Custom domain', 'דומיין מותאם', 'Dominio personalizado'),
  custom_domain_verified: L('Custom domain verified', 'הדומיין המותאם אומת', 'Dominio personalizado verificado'),
  last_published_at: L('Last published at', 'מועד הפרסום האחרון', 'Fecha de la última publicación'),
  favicon_url: L('Favicon URL', 'קישור לאייקון האתר', 'URL del favicon'),
  og_image_url: L('Share image URL', 'קישור לתמונת השיתוף', 'URL de la imagen para compartir'),
  client_flow: L('Client flow', 'תהליך הלקוח', 'Flujo del cliente'),
  website_language: L('Website language', 'שפת האתר', 'Idioma del sitio web'),
  content_generated_at: L('Content generated at', 'מועד הפקת התוכן', 'Fecha de generación del contenido'),
  page_id: L('Page', 'עמוד', 'Página'),
  block_type: L('Block type', 'סוג הרכיב', 'Tipo de bloque'),
  content: L('Content', 'תוכן', 'Contenido'),
  styles: L('Styles', 'עיצוב', 'Estilos'),
  enabled: L('Enabled', 'מופעל', 'Activado'),
  capability_config: L('Feature settings', 'הגדרות היכולת', 'Ajustes de la función'),
  public_url: L('Public URL', 'קישור ציבורי', 'URL pública'),
  section: L('Website section', 'אזור באתר', 'Sección del sitio web'),
  aspect: L('Aspect ratio', 'יחס גובה־רוחב', 'Relación de aspecto'),
  width: L('Width (pixels)', 'רוחב (פיקסלים)', 'Ancho (píxeles)'),
  height: L('Height (pixels)', 'גובה (פיקסלים)', 'Alto (píxeles)'),

  // Smart links
  code: L('Short code', 'קוד קצר', 'Código corto'),
  destination_url: L('Destination URL', 'כתובת היעד', 'URL de destino'),
  destination_type: L('Destination type', 'סוג היעד', 'Tipo de destino'),
  medium: L('UTM medium', 'מדיום (UTM)', 'Medio UTM'),
  campaign: L('UTM campaign', 'קמפיין (UTM)', 'Campaña UTM'),

  // Account & business
  full_name: L('Full name', 'שם מלא', 'Nombre completo'),
  avatar_url: L('Profile picture URL', 'קישור לתמונת הפרופיל', 'URL de la foto de perfil'),
  company: L('Company', 'חברה', 'Empresa'),
  job_title: L('Job title', 'תפקיד', 'Cargo'),
  language: L('Language', 'שפה', 'Idioma'),
  role: L('Role', 'תפקיד במערכת', 'Rol'),
  domain: L('Domain', 'דומיין', 'Dominio'),
  onboarding: L('Onboarding', 'תהליך ההצטרפות', 'Incorporación'),
  onboarding_goal: L('Onboarding goal', 'מטרת ההצטרפות', 'Objetivo de la incorporación'),
  onboarding_mode: L('Onboarding mode', 'מצב ההצטרפות', 'Modo de incorporación'),
  onboarding_data: L('Onboarding answers', 'נתוני ההצטרפות', 'Datos de la incorporación'),
  preferred_language: L('Preferred language', 'שפה מועדפת', 'Idioma preferido'),
  timezone_confirmed_at: L('Time zone confirmed at', 'מועד אישור אזור הזמן', 'Fecha de confirmación de la zona horaria'),
  preferred_currency: L('Preferred currency', 'מטבע מועדף', 'Moneda preferida'),
  sidebar_collapsed: L('Sidebar collapsed', 'סרגל צד מכווץ', 'Barra lateral contraída'),
  compact_mode: L('Compact mode', 'תצוגה צפופה', 'Modo compacto'),
  show_timestamps: L('Show timestamps', 'הצגת חותמות זמן', 'Mostrar marcas de tiempo'),
  enable_sounds: L('Sounds on', 'צלילים מופעלים', 'Sonidos activados'),
  keyboard_shortcuts: L('Keyboard shortcuts', 'קיצורי מקלדת', 'Atajos de teclado'),
  data_retention_days: L('Data retention (days)', 'שמירת נתונים (ימים)', 'Conservación de datos (días)'),
  analytics_enabled: L('Analytics on', 'אנליטיקה מופעלת', 'Analítica activada'),
  telemetry_enabled: L('Telemetry on', 'טלמטריה מופעלת', 'Telemetría activada'),
  email_enabled: L('Email notifications on', 'התראות אימייל מופעלות', 'Notificaciones por email activadas'),
  email_frequency: L('Email frequency', 'תדירות האימיילים', 'Frecuencia de los emails'),
  email_system_alerts: L('System alerts by email', 'התראות מערכת באימייל', 'Alertas del sistema por email'),
  email_security_alerts: L('Security alerts by email', 'התראות אבטחה באימייל', 'Alertas de seguridad por email'),
  email_marketing: L('Marketing emails', 'אימיילים שיווקיים', 'Emails de marketing'),
  push_enabled: L('Push notifications on', 'התראות פוש מופעלות', 'Notificaciones push activadas'),
  push_system_alerts: L('System alerts by push', 'התראות מערכת בפוש', 'Alertas del sistema por push'),
  push_mentions: L('Mentions by push', 'אזכורים בפוש', 'Menciones por push'),
  desktop_enabled: L('Desktop notifications on', 'התראות שולחן עבודה מופעלות', 'Notificaciones de escritorio activadas'),
  desktop_system_alerts: L('System alerts on desktop', 'התראות מערכת בשולחן העבודה', 'Alertas del sistema en el escritorio'),
  inapp_enabled: L('In-app notifications on', 'התראות באפליקציה מופעלות', 'Notificaciones en la app activadas'),
  inapp_sounds: L('In-app sounds', 'צלילים באפליקציה', 'Sonidos en la app'),
  inapp_popups: L('In-app pop-ups', 'חלונות קופצים באפליקציה', 'Ventanas emergentes en la app'),
  quiet_hours_enabled: L('Quiet hours on', 'שעות שקטות מופעלות', 'Horas de silencio activadas'),
  quiet_hours_start: L('Quiet hours start', 'תחילת השעות השקטות', 'Inicio de las horas de silencio'),
  quiet_hours_end: L('Quiet hours end', 'סוף השעות השקטות', 'Fin de las horas de silencio'),
  quiet_hours_timezone: L('Quiet hours time zone', 'אזור הזמן של השעות השקטות', 'Zona horaria de las horas de silencio'),
  sub_vertical: L('Sub-industry', 'תת־תחום', 'Subsector'),
  company_name: L('Business name', 'שם העסק', 'Nombre del negocio'),
  company_size: L('Business size', 'גודל העסק', 'Tamaño del negocio'),
  clients_per_week: L('Clients per week', 'לקוחות בשבוע', 'Clientes por semana'),
  revenue_tier: L('Revenue range', 'טווח הכנסות', 'Rango de ingresos'),
  pain_points: L('Challenges', 'אתגרים', 'Retos'),
  goals: L('Goals', 'מטרות', 'Objetivos'),
  tools: L('Tools', 'כלים', 'Herramientas'),
  payment_mode: L('Payment mode', 'אופן התשלום', 'Modo de pago'),
  online_presence_mode: L('Online presence', 'נוכחות ברשת', 'Presencia en línea'),
  primary_crm: L('Main CRM', 'מערכת ה־CRM הראשית', 'CRM principal'),
  primary_calendar: L('Main calendar', 'היומן הראשי', 'Calendario principal'),
  primary_payment: L('Main payment tool', 'כלי התשלום הראשי', 'Herramienta de pago principal'),
  address: L('Address', 'כתובת', 'Dirección'),
  address_parts: L('Address parts', 'חלקי הכתובת', 'Partes de la dirección'),
  address_id: L('Address ID', 'מזהה כתובת', 'ID de la dirección'),
  invoice_address_id: L('Invoice address ID', 'מזהה הכתובת לחשבונית', 'ID de la dirección de facturación'),
  website_url: L('Website URL', 'כתובת האתר', 'URL del sitio web'),
  landing_pages: L('Landing pages', 'דפי נחיתה', 'Páginas de destino'),
  logo_url: L('Logo URL', 'קישור ללוגו', 'URL del logotipo'),
  show_logo_on_smart_links: L('Logo on smart links', 'לוגו בקישורים חכמים', 'Logotipo en enlaces inteligentes'),
  user_code: L('User code', 'קוד משתמש', 'Código de usuario'),
  scheduling_availability: L('Booking availability', 'זמינות לתיאום', 'Disponibilidad para reservas'),
  process_steps: L('Process steps', 'שלבי העבודה', 'Pasos del proceso'),
  invoice_company_name: L('Business name on invoices', 'שם העסק בחשבוניות', 'Nombre del negocio en las facturas'),
  invoice_address: L('Address on invoices', 'כתובת בחשבוניות', 'Dirección en las facturas'),
  invoice_tax_id: L('Tax ID on invoices', 'מספר עוסק בחשבוניות', 'NIF en las facturas'),
  invoice_footer_text: L('Invoice footer', 'טקסט תחתית החשבונית', 'Pie de factura'),
  invoice_number_prefix: L('Invoice number prefix', 'קידומת מספר החשבונית', 'Prefijo del número de factura'),
  invoice_document_type: L('Invoice document type', 'סוג מסמך החשבונית', 'Tipo de documento de la factura'),
  invoice_prices_include_tax: L('Invoice prices include tax', 'מחירי החשבונית כוללים מס', 'Precios de factura con impuestos incluidos'),
  invoice_tax_rate: L('Invoice tax rate', 'שיעור המס בחשבונית', 'Tipo impositivo de la factura'),
  invoice_tax_label: L('Invoice tax name', 'שם המס בחשבונית', 'Nombre del impuesto en la factura'),
  invoice_payment_terms_days: L('Invoice payment terms (days)', 'תנאי תשלום בחשבונית (ימים)', 'Plazo de pago de la factura (días)'),
  collection_method: L('Collection method', 'שיטת הגבייה', 'Método de cobro'),
  default_payment_processor: L('Default payment processor', 'סולק ברירת המחדל', 'Procesador de pagos predeterminado'),
  payment_retry_enabled: L('Payment retries on', 'ניסיונות חיוב חוזרים מופעלים', 'Reintentos de pago activados'),
  payment_retry_intervals: L('Payment retry intervals', 'מרווחי ניסיונות החיוב', 'Intervalos de reintento de pago'),
  payment_max_retries: L('Max payment retries', 'מקסימום ניסיונות חיוב', 'Máximo de reintentos de pago'),
  payment_reminder_enabled: L('Payment reminders on', 'תזכורות תשלום מופעלות', 'Recordatorios de pago activados'),
  payment_reminder_days_before: L('Payment reminder (days before)', 'תזכורת תשלום (ימים לפני)', 'Recordatorio de pago (días antes)'),
  payment_overdue_reminder_days: L('Overdue reminder (days)', 'תזכורת על איחור (ימים)', 'Recordatorio de impago (días)'),
  payment_reminder_channels: L('Payment reminder channels', 'ערוצי תזכורת התשלום', 'Canales del recordatorio de pago'),
  daily_briefing_email_enabled: L('Daily briefing email on', 'אימייל סיכום יומי מופעל', 'Email de resumen diario activado'),
  lead_alert_email_enabled: L('New lead email on', 'אימייל על ליד חדש מופעל', 'Email de nuevo contacto activado'),
  lead_autosend_enabled: L('Auto-reply to leads on', 'מענה אוטומטי ללידים מופעל', 'Respuesta automática a contactos activada'),
  chase_invoices_enabled: L('Invoice follow-up on', 'מעקב חשבוניות מופעל', 'Seguimiento de facturas activado'),
  chase_intake_enabled: L('Intake form follow-up on', 'מעקב טפסי לקוח מופעל', 'Seguimiento de formularios activado'),
  chase_quotes_enabled: L('Quote follow-up on', 'מעקב הצעות מחיר מופעל', 'Seguimiento de presupuestos activado'),
  automations_declined: L('Declined automations', 'אוטומציות שנדחו', 'Automatizaciones rechazadas'),
  meeting_reminder_enabled: L('Meeting reminders on', 'תזכורות פגישה מופעלות', 'Recordatorios de reunión activados'),
  meeting_reminder_hours_before: L('Meeting reminder (hours before)', 'תזכורת פגישה (שעות לפני)', 'Recordatorio de reunión (horas antes)'),
  meeting_reminder_notify_client: L('Remind the client', 'תזכורת ללקוח', 'Recordar al cliente'),
  meeting_reminder_notify_owner: L('Remind the business owner', 'תזכורת לבעל העסק', 'Recordar al propietario'),
  auto_complete_meetings_enabled: L('Auto-complete meetings on', 'סגירת פגישות אוטומטית מופעלת', 'Completar reuniones automáticamente'),
  parts: L('Address details', 'פרטי הכתובת', 'Detalles de la dirección'),
  stripe_account_id: L('Stripe account ID', 'מזהה חשבון Stripe', 'ID de la cuenta de Stripe'),
  stripe_account_type: L('Stripe account type', 'סוג חשבון Stripe', 'Tipo de cuenta de Stripe'),
  charges_enabled: L('Charges enabled', 'חיובים מאושרים', 'Cobros habilitados'),
  payouts_enabled: L('Payouts enabled', 'העברות כספים מאושרות', 'Pagos al negocio habilitados'),
  details_submitted: L('Details submitted', 'הפרטים נשלחו', 'Datos enviados'),
  onboarding_completed: L('Setup completed', 'ההגדרה הושלמה', 'Configuración completada'),
  country: L('Country', 'מדינה', 'País'),
  business_type: L('Business type', 'סוג העסק', 'Tipo de negocio'),
  stripe_email: L('Stripe email', 'אימייל ב־Stripe', 'Email de Stripe'),
  connection_status: L('Connection status', 'סטטוס החיבור', 'Estado de la conexión'),
  last_verified_at: L('Last verified at', 'מועד האימות האחרון', 'Fecha de la última verificación'),
};

/**
 * Only where one key means something different in another module (SA MX2B-2):
 * a website's `services` is a section of the page, not the business's
 * services; a smart link's `source` and `content` are its UTM values.
 */
export const SECTION_COLUMN_LABELS: Readonly<Partial<Record<ExportSectionId, Readonly<Record<string, LabelText>>>>> = {
  website_content: {
    services: L('Services section', 'אזור השירותים', 'Sección de servicios'),
  },
  smart_links: {
    source: L('UTM source', 'מקור (UTM)', 'Origen UTM'),
    content: L('UTM content', 'תוכן (UTM)', 'Contenido UTM'),
  },
};

// ── Resolution ──────────────────────────────────────────────────────────────

/** A label as the rules see it: any language may be missing or not a string (planted sets). */
export type LooseLabelText = Readonly<Partial<Record<ExportModuleLanguage, unknown>>>;

/** The four tables in the rule's loose shape, so a test can plant a bad set. */
export interface ColumnLabelSet {
  fixed: Readonly<Record<string, LooseLabelText>>;
  recordTypes: Readonly<Record<string, LooseLabelText>>;
  byKey: Readonly<Record<string, LooseLabelText>>;
  bySection: Readonly<Record<string, Readonly<Record<string, LooseLabelText>> | undefined>>;
}

export const REAL_COLUMN_LABELS: ColumnLabelSet = {
  fixed: FIXED_COLUMN_LABELS,
  recordTypes: RECORD_TYPE_LABELS,
  byKey: COLUMN_LABELS_BY_KEY,
  bySection: SECTION_COLUMN_LABELS,
};

/**
 * An OWN property only: these are plain objects, so a column named
 * `constructor` or `toString` must not resolve to Object.prototype.
 */
function own<T>(record: Readonly<Record<string, T>> | undefined, key: string): T | undefined {
  if (record === undefined || !Object.prototype.hasOwnProperty.call(record, key)) return undefined;
  return record[key];
}

function usable(text: unknown): text is string {
  return typeof text === 'string' && text.trim() !== '';
}

function resolveIn(set: ColumnLabelSet, section: string, key: string): LooseLabelText | undefined {
  return own(own(set.bySection, section), key) ?? own(set.byKey, key);
}

/** The requested language, then English, then the raw key (SA MX2B-4). Never throws. */
function pick(label: LooseLabelText | undefined, language: ExportModuleLanguage, fallback: string): string {
  const inLanguage = label?.[language];
  if (usable(inLanguage)) return inLanguage;
  const english = label?.en;
  if (usable(english)) return english;
  return fallback;
}

/** The label of `section.column`: the section's entry, else the key's entry, else undefined. */
export function columnLabelText(section: ExportSectionId, key: string): LabelText | undefined {
  return own(SECTION_COLUMN_LABELS[section], key) ?? own(COLUMN_LABELS_BY_KEY, key);
}

/** `JoinedCsvLabels` over any set (tests use planted sets for the fallback). */
export function joinedCsvLabelsFrom(set: ColumnLabelSet): JoinedCsvLabels {
  return {
    fixed: (key, language) => pick(own(set.fixed, key), language, key),
    recordType: (section, language) => pick(own(set.recordTypes, section), language, section),
    column: (section, key, language) => pick(resolveIn(set, section, key), language, key),
  };
}

/** What the MX-3 worker passes to `buildJoinedCsv` (labels are required there). */
export const EXPORT_COLUMN_LABELS: JoinedCsvLabels = joinedCsvLabelsFrom(REAL_COLUMN_LABELS);

// ── The CI rule (L-1…L-9) ───────────────────────────────────────────────────

/** Everything the rule compares the labels with, passed in so this file imports no descriptor. */
export interface ColumnLabelRuleInputs {
  /** The module map, loose (id + sections in module order). */
  modules: readonly { id: string; sections: readonly string[] }[];
  /** The ids of the section registry (`EXPORT_SECTIONS`). */
  registeredSections: readonly string[];
  /** The include columns of every section in the map, in order (`classifiedColumnsOf`). */
  columnsBySection: Readonly<Record<string, readonly string[]>>;
  /** `JOINED_CSV_FIXED_COLUMNS`. */
  fixedKeys: readonly string[];
}

// Hebrew letters as a literal range (no escape), as exportModules.ts R-7.
const HEBREW_LETTER = /[א-ת]/;
const LATIN_LETTER = /[A-Za-z]/;
// CR, LF, TAB, the double quote, and the bidi controls (ALM, LRM, RLM, the
// embeddings and overrides, the isolates). Char codes: no backslash escape.
const FORBIDDEN_CHARS: readonly string[] = [
  13, 10, 9, 34, 0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
].map((code) => String.fromCharCode(code));
// A first character csv.ts BC-1 would prefix with an apostrophe.
const FORMULA_START = ['=', '+', '-', '@'];

/** Trimmed, NFC, lower-cased (SA MX2B-5: plain toLowerCase, not locale-sensitive). */
function normalised(text: string): string {
  return text.trim().normalize('NFC').toLowerCase();
}

function entriesOf(set: ColumnLabelSet): { where: string; label: LooseLabelText }[] {
  const out: { where: string; label: LooseLabelText }[] = [];
  for (const [key, label] of Object.entries(set.fixed)) out.push({ where: `fixed.${key}`, label });
  for (const [section, label] of Object.entries(set.recordTypes)) out.push({ where: `recordType.${section}`, label });
  for (const [key, label] of Object.entries(set.byKey)) out.push({ where: `key.${key}`, label });
  for (const [section, entries] of Object.entries(set.bySection)) {
    for (const [key, label] of Object.entries(entries ?? {})) out.push({ where: `${section}.${key}`, label });
  }
  return out;
}

function cleanTextProblem(text: string): string | null {
  if (text !== text.trim()) return 'leading or trailing space';
  if (FORMULA_START.includes(text.charAt(0))) return `starts with ${text.charAt(0)}`;
  const bad = FORBIDDEN_CHARS.find((ch) => text.includes(ch));
  if (bad !== undefined) return `holds char code ${bad.charCodeAt(0)}`;
  return null;
}

/** Duplicates in (name, text) pairs after normalisation, as "a / b: text". */
function collisions(named: readonly { name: string; text: string }[]): string[] {
  const firstOf = new Map<string, string>();
  const out: string[] = [];
  for (const { name, text } of named) {
    const norm = normalised(text);
    const first = firstOf.get(norm);
    if (first === undefined) firstOf.set(norm, name);
    else out.push(`${first} / ${name}: "${text}"`);
  }
  return out;
}

/**
 * Problems with the labels; empty means sound. Run over the real set and a
 * planted bad set per rule (columnLabels.test.ts). L-1, L-2, L-5 are the
 * plan's required rules; L-3, L-4, L-6..L-9 are SA-accepted extras (MX2B-6).
 */
export function columnLabelProblems(set: ColumnLabelSet, inputs: ColumnLabelRuleInputs): string[] {
  const problems: string[] = [];
  const columnsOf = (section: string): readonly string[] => own(inputs.columnsBySection, section) ?? [];
  const textIn = (label: LooseLabelText | undefined, language: ExportModuleLanguage): string | null => {
    const text = label?.[language];
    return usable(text) ? text : null;
  };

  // L-1 Coverage: every section.column pair (not the key list, SA MX2B-2),
  // except `id` (the fixed Record ID), has a label with en and he; every
  // section has a record type.
  for (const m of inputs.modules) {
    for (const section of m.sections) {
      if (own(set.recordTypes, section) === undefined) problems.push(`L-1 ${section}: no record type`);
      for (const column of columnsOf(section)) {
        if (column === 'id') continue;
        const label = resolveIn(set, section, column);
        if (label === undefined) {
          problems.push(`L-1 ${section}.${column}: no label`);
          continue;
        }
        for (const language of ['en', 'he'] as const) {
          if (textIn(label, language) === null) problems.push(`L-1 ${section}.${column}: no ${language} label`);
        }
      }
    }
  }

  const entries = entriesOf(set);

  // L-2 Every language present, non-blank, on every entry (es may be a draft, never blank).
  for (const { where, label } of entries) {
    for (const language of EXPORT_LANGUAGES) {
      if (textIn(label, language) === null) problems.push(`L-2 ${where}: ${language} missing or blank`);
    }
  }

  // L-3 Hebrew reads right-to-left: a Hebrew letter, and no Latin letter before it.
  for (const { where, label } of entries) {
    const he = textIn(label, 'he');
    if (he === null) continue;
    const first = he.search(HEBREW_LETTER);
    if (first < 0) problems.push(`L-3 ${where}: he has no Hebrew letter`);
    else if (LATIN_LETTER.test(he.slice(0, first))) problems.push(`L-3 ${where}: he starts with a Latin letter`);
  }

  // L-4 Clean text in every language.
  for (const { where, label } of entries) {
    for (const language of EXPORT_LANGUAGES) {
      const text = textIn(label, language);
      if (text === null) continue;
      const problem = cleanTextProblem(text);
      if (problem !== null) problems.push(`L-4 ${where}: ${language} ${problem}`);
    }
  }

  for (const m of inputs.modules) {
    // Each distinct non-id key at its first section, as the builder names it.
    const firstSectionOf = new Map<string, string>();
    const sectionsOfKey = new Map<string, string[]>();
    for (const section of m.sections) {
      for (const column of columnsOf(section)) {
        if (column === 'id') continue;
        if (!firstSectionOf.has(column)) firstSectionOf.set(column, section);
        sectionsOfKey.set(column, [...(sectionsOfKey.get(column) ?? []), section]);
      }
    }

    for (const language of EXPORT_LANGUAGES) {
      // L-5 Unique headers per module, fixed headers included.
      const headers: { name: string; text: string }[] = [];
      for (const key of inputs.fixedKeys) {
        const text = textIn(own(set.fixed, key), language);
        if (text !== null) headers.push({ name: `fixed.${key}`, text });
      }
      for (const [key, section] of firstSectionOf) {
        const text = textIn(resolveIn(set, section, key), language);
        if (text !== null) headers.push({ name: key, text });
      }
      for (const c of collisions(headers)) problems.push(`L-5 module ${m.id} ${language}: ${c}`);

      // L-7 Record types unique per module.
      const types: { name: string; text: string }[] = [];
      for (const section of m.sections) {
        const text = textIn(own(set.recordTypes, section), language);
        if (text !== null) types.push({ name: section, text });
      }
      for (const c of collisions(types)) problems.push(`L-7 module ${m.id} ${language}: ${c}`);
    }

    // L-6 A key shared by sections of one module resolves to one text.
    for (const [key, sections] of sectionsOfKey) {
      if (sections.length < 2) continue;
      for (const language of EXPORT_LANGUAGES) {
        const texts = new Set(sections.map((s) => textIn(resolveIn(set, s, key), language) ?? ''));
        if (texts.size > 1) problems.push(`L-6 module ${m.id}: ${key} has different ${language} labels in ${sections.join(', ')}`);
      }
    }
  }

  // L-8 No stale entries.
  const registered = new Set(inputs.registeredSections);
  for (const [section, entriesOfSection] of Object.entries(set.bySection)) {
    if (!registered.has(section)) {
      problems.push(`L-8 ${section}: section override for an unregistered section`);
      continue;
    }
    const columns = columnsOf(section);
    for (const key of Object.keys(entriesOfSection ?? {})) {
      if (key === 'id' || !columns.includes(key)) problems.push(`L-8 ${section}.${key}: not an include column of the section`);
    }
  }
  for (const section of Object.keys(set.recordTypes)) {
    if (!registered.has(section)) problems.push(`L-8 recordType.${section}: unregistered section`);
  }
  const usedKeys = new Set<string>();
  for (const m of inputs.modules) {
    for (const section of m.sections) {
      for (const column of columnsOf(section)) {
        if (column !== 'id' && own(own(set.bySection, section), column) === undefined) usedKeys.add(column);
      }
    }
  }
  for (const key of Object.keys(set.byKey)) {
    if (!usedKeys.has(key)) problems.push(`L-8 key.${key}: used by no include column`);
  }

  // L-9 Fixed keys are exactly the builder's.
  const fixedKeys = new Set(inputs.fixedKeys);
  for (const key of inputs.fixedKeys) if (own(set.fixed, key) === undefined) problems.push(`L-9 fixed.${key}: missing`);
  for (const key of Object.keys(set.fixed)) if (!fixedKeys.has(key)) problems.push(`L-9 fixed.${key}: not a fixed column`);

  return problems;
}
