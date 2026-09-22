// lib/business-os/entitlements/config/catalog.ts
//
// THE CAPABILITY CATALOG — the complete list of things Business OS can grant or
// withhold. Data only: no logic, no I/O, no imports beyond types.
//
// Requirement §5 (the catalog), workplan §4.4.
//
// ── WHO OWNS THIS FILE ──────────────────────────────────────────────────────
// Engineering. It changes when a feature is BUILT or CHANGED, not when pricing
// changes. What each plan includes lives in `tierMatrix.ts`, which is a
// different file with a different owner and a different release rhythm — that
// separation is the whole point of the design (requirement §6.1).
//
// Adding a capability: one entry here, plus one value per tier in the matrix
// (the compiler and the invariant tests both insist), plus a cohort value if it
// is a quantity, allowance or ceiling.
//
// ── ABOUT `lifecycle` ───────────────────────────────────────────────────────
// This is a claim about the CODE, not about pricing:
//
//   available  — the feature exists and works
//   beta       — it exists but is only reached through a cohort or an override
//   not_built  — it does not exist, and is NEVER entitled, whatever config says
//
// Each entry below was checked against the repository on 2026-09-22; where the
// answer was not obvious the evidence is in the entry's `note`.
//
// ⚠️ THE TEST FOR `available` IS "A CUSTOMER GETS THE OUTCOME", NOT "THE TABLES
// EXIST". Three entries were marked available on storage and plumbing and have
// been corrected; each note records the trace that settled it:
//
//   marketing.mass_email   builder with no dispatcher — nothing reads next_send_at
//   payments.reminders     the sender returns `true; // Simulated success`
//   website.custom_domain  middleware only rewrites *.baseHost; the lookup has no caller
//
// The user's rule follows from the same place: **if a feature does not exist it
// cannot be allocated.** A tier may not grant a `not_built` capability, and the
// loader rejects a config that tries (see `schema.ts`). That is why getting
// `lifecycle` right is not documentation — it decides what can be sold.
//
// **Gate before the first tier is configured** (not before this merges — nothing
// is sold yet): walk every `available` capability and confirm an end-to-end path
// exists. Selling one of these would be selling something that does not happen.
//
// Where evidence was thin but a path existed, the bias was to mark `available`:
// a capability wrongly marked available simply never gets asked about, while one
// wrongly marked `not_built` would silently block a REAL feature for every
// customer the day enforcement is switched on. That bias is not a licence to
// skip the check above.
//
// ── ABOUT `variants` ────────────────────────────────────────────────────────
// Ordered LOW TO HIGH. The order decides what "the highest variant" means for a
// cohort that grants everything, and lets the snapshot test recognise a tier
// value being lowered.

import type { CapabilityDef, ValueForShape } from '../types';

export const CAPABILITIES = {
  // ── CRM ───────────────────────────────────────────────────────────────────
  'crm.core': {
    labels: { en: 'Contacts, pipeline and tasks', he: 'אנשי קשר, צינור ומשימות', es: 'Contactos, embudo y tareas' },
    category: 'crm',
    shape: { kind: 'boolean' },
    lifecycle: 'available',
    audience: 'owner',
    atLimit: 'none',
    sellableAsAddon: false,
  },
  'crm.documents': {
    labels: { en: 'Client documents', he: 'מסמכי לקוח', es: 'Documentos de cliente' },
    category: 'crm',
    shape: { kind: 'boolean' },
    lifecycle: 'available',
    audience: 'owner',
    atLimit: 'none',
    sellableAsAddon: false,
    note: 'contact_documents + the contact-documents storage bucket.',
  },
  'booking.calendar_sync': {
    labels: { en: 'Booking with calendar sync', he: 'יומן מסונכרן', es: 'Reservas con calendario' },
    category: 'crm',
    shape: { kind: 'boolean' },
    lifecycle: 'available',
    audience: 'owner',
    atLimit: 'none',
    sellableAsAddon: false,
    note: 'external_calendar_events + the calendar-sync cron.',
  },

  // ── Website & intake ──────────────────────────────────────────────────────
  'website.ai_site': {
    labels: { en: 'AI-built website', he: 'אתר שנבנה ב-AI', es: 'Sitio web creado con IA' },
    category: 'website_intake',
    shape: { kind: 'boolean' },
    lifecycle: 'available',
    audience: 'owner',
    atLimit: 'none',
    sellableAsAddon: false,
  },
  'website.branding': {
    labels: { en: 'Website branding', he: 'מיתוג האתר', es: 'Marca del sitio' },
    category: 'website_intake',
    // branded < unbranded: removing "Powered by AgentPilot" is the upgrade.
    shape: { kind: 'variant', variants: ['branded', 'unbranded'] },
    lifecycle: 'available',
    // Visible to the business's clients, but it is a RENDER policy, not a send —
    // so it has no message class (SA S-1).
    audience: 'client_render',
    atLimit: 'none',
    sellableAsAddon: false,
    note: 'FooterBlock / template Footer / PublicFooter / the site booking page.',
  },
  'intake.forms': {
    labels: { en: 'Intake forms', he: 'טפסי קליטה', es: 'Formularios de admisión' },
    category: 'website_intake',
    shape: { kind: 'variant', variants: ['manual', 'ai'] },
    lifecycle: 'available',
    audience: 'owner',
    atLimit: 'none',
    sellableAsAddon: false,
  },
  'intake.reminders': {
    labels: { en: 'Intake reminders', he: 'תזכורות קליטה', es: 'Recordatorios de admisión' },
    category: 'website_intake',
    shape: { kind: 'boolean' },
    lifecycle: 'available',
    audience: 'client',
    messageClass: 'transactional',
    atLimit: 'none',
    sellableAsAddon: false,
    note: 'The intake-reminders cron. System-initiated, so it stops when an account is paused (B-11).',
  },

  // ── Payments ──────────────────────────────────────────────────────────────
  'payments.invoices': {
    labels: { en: 'Invoices', he: 'חשבוניות', es: 'Facturas' },
    category: 'payments',
    shape: { kind: 'boolean' },
    lifecycle: 'available',
    audience: 'owner',
    atLimit: 'none',
    sellableAsAddon: false,
    placeholder: 'B-1',
    note: 'The invoice/card split is one of the five rows still with Eyal.',
  },
  'payments.card': {
    labels: { en: 'Card payments', he: 'תשלום בכרטיס', es: 'Pagos con tarjeta' },
    category: 'payments',
    shape: { kind: 'boolean' },
    lifecycle: 'available',
    audience: 'owner',
    atLimit: 'none',
    sellableAsAddon: false,
    placeholder: 'B-1',
    note: 'Stripe Connect. Same open question as payments.invoices.',
  },
  'payments.reminders': {
    labels: { en: 'Payment reminders and retries', he: 'תזכורות ותשלום חוזר', es: 'Recordatorios y reintentos de pago' },
    category: 'payments',
    shape: { kind: 'boolean' },
    // NOT BUILT — corrected 2026-09-22 (QA C2-1), by the same rule that moved
    // marketing.mass_email.
    lifecycle: 'not_built',
    audience: 'client',
    messageClass: 'transactional',
    atLimit: 'none',
    sellableAsAddon: false,
    note:
      'Everything except the send exists: BookingLifecycleService schedules reminders for every ' +
      'booking invoice and the payment-reminders cron claims them. But ' +
      'PaymentReminderService.sendEmailReminder (lib/services/PaymentReminderService.ts:500-527) ' +
      'logs "Would send payment reminder email" and returns `true; // Simulated success`. ' +
      'That is worse than a missing sender: the row is marked SENT while no client receives ' +
      'anything, so the failure is invisible from inside the product. Marking this `available` ' +
      'would sell a reminder that is recorded as delivered and never arrives. ' +
      'Flip to `available` in the same change that makes the sender real.',
  },
  'payments.multi_currency': {
    labels: { en: 'Multiple currencies', he: 'מספר מטבעות', es: 'Varias monedas' },
    category: 'payments',
    shape: { kind: 'boolean' },
    lifecycle: 'available',
    audience: 'owner',
    atLimit: 'none',
    sellableAsAddon: false,
    note: 'lib/business-os/currency.ts and userCurrency.ts; the chat catalog keeps per-currency totals apart.',
  },

  // ── AI & chat ─────────────────────────────────────────────────────────────
  'chat.marketing': {
    labels: { en: 'Bulk email via chat', he: 'שליחה מרובה דרך הצ׳אט', es: 'Envío masivo por chat' },
    category: 'ai_chat',
    shape: { kind: 'group' },
    lifecycle: 'available',
    audience: 'owner',
    atLimit: 'none',
    sellableAsAddon: false,
    placeholder: 'B-1',
    note:
      'SENDS FOR REAL, verified 2026-09-22: contacts.send / invoices.send reach ' +
      'lib/business-os/bizql/mutate/emailSend.ts, which calls sendEmail() in ' +
      'lib/notifications/emailTransport.ts (Resend/SMTP); ForEachExecutor fans the same action ' +
      'out over many contacts, which is what "mass email from chat" means here. ' +
      'This is the half of B-1\'s "marketing chat vs mass email campaigns" question that EXISTS — ' +
      'see marketing.mass_email for the half that does not. The commercial split is still Eyal\'s call.',
  },
  'chat.invoice_control': {
    labels: { en: 'Invoices via chat', he: 'חשבוניות דרך הצ׳אט', es: 'Facturas por chat' },
    category: 'ai_chat',
    shape: { kind: 'group' },
    lifecycle: 'available',
    audience: 'owner',
    atLimit: 'none',
    sellableAsAddon: false,
  },
  'chat.email': {
    labels: { en: 'One-off email via chat', he: 'מייל בודד דרך הצ׳אט', es: 'Correo puntual por chat' },
    category: 'ai_chat',
    shape: { kind: 'group' },
    lifecycle: 'available',
    audience: 'owner',
    atLimit: 'none',
    sellableAsAddon: false,
  },
  'chat.search': {
    labels: { en: 'Search via chat', he: 'חיפוש דרך הצ׳אט', es: 'Búsqueda por chat' },
    category: 'ai_chat',
    shape: { kind: 'group' },
    lifecycle: 'available',
    audience: 'owner',
    atLimit: 'none',
    sellableAsAddon: false,
    note: 'What counts as "search" is the readRule in chatActionMap.ts (Q-B1), not a property of this entry.',
  },
  'chat.scheduling': {
    labels: { en: 'Scheduling via chat', he: 'תיאום פגישות דרך הצ׳אט', es: 'Agenda por chat' },
    category: 'ai_chat',
    shape: { kind: 'group' },
    lifecycle: 'available',
    audience: 'owner',
    atLimit: 'none',
    sellableAsAddon: false,
  },
  'chat.quotes': {
    labels: { en: 'Quotes via chat', he: 'הצעות מחיר דרך הצ׳אט', es: 'Presupuestos por chat' },
    category: 'ai_chat',
    shape: { kind: 'group' },
    lifecycle: 'available',
    audience: 'owner',
    atLimit: 'none',
    sellableAsAddon: false,
  },
  'chat.reporting': {
    labels: { en: 'On-demand reports via chat', he: 'דוחות לפי דרישה', es: 'Informes por chat' },
    category: 'ai_chat',
    shape: { kind: 'group' },
    lifecycle: 'available',
    audience: 'owner',
    atLimit: 'none',
    sellableAsAddon: false,
  },
  'chat.bulk': {
    labels: { en: 'Bulk actions via chat', he: 'פעולות באצווה', es: 'Acciones masivas por chat' },
    category: 'ai_chat',
    shape: { kind: 'group' },
    lifecycle: 'available',
    audience: 'owner',
    atLimit: 'none',
    sellableAsAddon: false,
    note: 'Every for_each step needs this on top of the capability its action needs.',
  },
  'ai.actions': {
    labels: { en: 'AI actions', he: 'פעולות AI', es: 'Acciones de IA' },
    category: 'ai_chat',
    shape: { kind: 'metered', unit: 'ai_action', period: 'month' },
    lifecycle: 'available',
    // The only `mixed` entry: the same allowance is spent by owner-facing AI and
    // by client-facing automations, and D-12 treats them differently at the
    // limit — so the behaviour is decided per call site, not here.
    audience: 'mixed',
    atLimit: 'by_call_site_audience',
    sellableAsAddon: false,
    note: 'Counted as a flat count of customer-visible actions (B-4). Metering is Slice 3.',
  },

  // ── Marketing ─────────────────────────────────────────────────────────────
  'marketing.mass_email': {
    labels: { en: 'Email campaigns and sequences', he: 'קמפיינים ורצפי מיילים', es: 'Campañas y secuencias de correo' },
    category: 'marketing',
    shape: { kind: 'boolean' },
    // NOT BUILT — corrected 2026-09-22 after SA challenged the earlier `available`.
    lifecycle: 'not_built',
    audience: 'client',
    messageClass: 'marketing',
    atLimit: 'none',
    sellableAsAddon: false,
    placeholder: 'B-1',
    note:
      'The BUILDER exists and the SENDER does not, verified 2026-09-22. Present: the ' +
      'email_campaigns / email_sequences / email_sequence_enrollments tables, their CRUD in ' +
      'EmailAutomationRepository, the routes under app/api/email/**, and ' +
      'WebsiteEmailSequenceService.triggerSequence, which writes an enrollment with a ' +
      'next_send_at. Missing: anything that READS next_send_at. No cron in vercel.json, no ' +
      'dispatcher service, and triggerSequence has no caller anywhere in the repository — so an ' +
      'enrolled contact is never emailed and a campaign never leaves "scheduled". ' +
      'This is the half of B-1 that does not exist; chat.marketing is the half that does. ' +
      '`not_built` is never entitled (FR-13), so this cannot be sold until the dispatcher lands.',
  },
  'marketing.lead_response': {
    labels: { en: 'Lead auto-reply and follow-up', he: 'מענה אוטומטי לפניות', es: 'Respuesta automática a prospectos' },
    category: 'marketing',
    shape: { kind: 'boolean' },
    lifecycle: 'available',
    audience: 'client',
    messageClass: 'marketing',
    atLimit: 'degrade_to_template',
    sellableAsAddon: false,
    note: 'LeadReplyRecommender + the lead-response cron. The one client-facing send that genuinely uses an LLM today, so it is the one that degrades to template text (D-12).',
  },
  'marketing.posts': {
    labels: { en: 'Post creation and scheduling', he: 'יצירה ותזמון פוסטים', es: 'Creación y programación de publicaciones' },
    category: 'marketing',
    shape: { kind: 'boolean' },
    lifecycle: 'not_built',
    audience: 'owner',
    atLimit: 'none',
    sellableAsAddon: false,
    note: 'No post composer or scheduler in the repository (checked 2026-09-22). Never entitled until it is built.',
  },

  // ── Insights ──────────────────────────────────────────────────────────────
  'insights.checks': {
    labels: { en: 'Automated business checks', he: 'בדיקות אוטומטיות', es: 'Comprobaciones automáticas' },
    category: 'insights',
    shape: { kind: 'boolean' },
    lifecycle: 'available',
    audience: 'owner',
    atLimit: 'none',
    sellableAsAddon: false,
    note: 'All 37 detectors under lib/business-os/insight/detectors/catalog as ONE capability (B-5). A new detector needs no config change.',
  },
  'insights.channels': {
    labels: { en: 'Marketing channel data', he: 'נתוני ערוצי שיווק', es: 'Datos de canales' },
    category: 'insights',
    shape: { kind: 'boolean' },
    lifecycle: 'available',
    audience: 'owner',
    atLimit: 'none',
    sellableAsAddon: false,
    note: 'channel_metrics / channel_connections + the channel-metrics-sync cron.',
  },
  'insights.daily_briefing': {
    labels: { en: 'Daily briefing', he: 'תדריך יומי', es: 'Resumen diario' },
    category: 'insights',
    shape: { kind: 'boolean' },
    lifecycle: 'available',
    audience: 'owner',
    atLimit: 'pause',
    sellableAsAddon: false,
    note: 'BriefingStore + the daily-briefing cron. Owner-facing AI, so it pauses at the limit rather than degrading (D-12).',
  },

  // ── Support ───────────────────────────────────────────────────────────────
  'support.level': {
    labels: { en: 'Support level', he: 'רמת תמיכה', es: 'Nivel de soporte' },
    category: 'support',
    shape: { kind: 'variant', variants: ['standard', 'priority'] },
    lifecycle: 'available',
    audience: 'owner',
    atLimit: 'none',
    sellableAsAddon: false,
    note: 'No enforcement surface — it is a commercial promise, resolved so it can be shown.',
  },

  // ── Platform ──────────────────────────────────────────────────────────────
  'email.volume': {
    labels: { en: 'Email volume', he: 'נפח מיילים', es: 'Volumen de correo' },
    category: 'platform',
    shape: { kind: 'fair_use', unit: 'email', period: 'month' },
    lifecycle: 'available',
    audience: 'client',
    messageClass: 'transactional',
    // B-7: crossing it alerts the platform team. It NEVER blocks the customer;
    // blocking is an admin override, deliberately taken.
    atLimit: 'alert_only',
    sellableAsAddon: false,
    note: 'Never shown to the customer.',
  },

  // ── Add-ons ───────────────────────────────────────────────────────────────
  'addon.marketing_analytics': {
    labels: { en: 'Marketing analytics', he: 'אנליטיקת שיווק', es: 'Analítica de marketing' },
    category: 'addon',
    shape: { kind: 'addon' },
    lifecycle: 'not_built',
    audience: 'owner',
    atLimit: 'none',
    sellableAsAddon: true,
    placeholder: 'B-1',
    note: 'No such surface in the repository (checked 2026-09-22).',
  },
  'addon.mobile': {
    labels: { en: 'Mobile chat and insights', he: 'צ׳אט ותובנות בנייד', es: 'Chat e insights móviles' },
    category: 'addon',
    shape: { kind: 'addon' },
    lifecycle: 'not_built',
    audience: 'owner',
    atLimit: 'none',
    sellableAsAddon: true,
    placeholder: 'B-1',
    note: 'No mobile app.',
  },
  'addon.full_payment_cycle': {
    labels: { en: 'Full payment cycle', he: 'מחזור תשלום מלא', es: 'Ciclo de pago completo' },
    category: 'addon',
    shape: { kind: 'addon' },
    lifecycle: 'not_built',
    audience: 'owner',
    atLimit: 'none',
    sellableAsAddon: true,
    placeholder: 'B-1',
    note: 'The 1%-fee offer. Not built, and its shape is still with Eyal.',
  },
  'addon.sms': {
    labels: { en: 'SMS messaging', he: 'הודעות SMS', es: 'Mensajes SMS' },
    category: 'addon',
    shape: { kind: 'addon' },
    lifecycle: 'not_built',
    audience: 'client',
    messageClass: 'transactional',
    atLimit: 'none',
    sellableAsAddon: true,
    note: 'No Business OS SMS path (the agent platform\'s SMS plugin is a different product, B-8).',
  },
  'sms.messages': {
    labels: { en: 'SMS allowance', he: 'מכסת SMS', es: 'Asignación de SMS' },
    category: 'addon',
    shape: { kind: 'metered', unit: 'sms', period: 'month' },
    lifecycle: 'not_built',
    audience: 'client',
    messageClass: 'transactional',
    atLimit: 'block',
    sellableAsAddon: true,
    note: 'Modelled so the metering hooks exist; delivery is out of scope (§18).',
  },
  'team.seats': {
    labels: { en: 'Team seats', he: 'מושבי צוות', es: 'Puestos de equipo' },
    category: 'addon',
    shape: { kind: 'quantity', unit: 'seat' },
    lifecycle: 'available',
    audience: 'owner',
    atLimit: 'none',
    sellableAsAddon: true,
    note: 'The owner seat exists (organizations / organization_members). Invites are not built (§18), so in practice the value is 1 — but a quantity of 0 would be a lie, which is why this is `available` rather than `not_built`.',
  },
  'business.locations': {
    labels: { en: 'Business locations', he: 'סניפים', es: 'Ubicaciones' },
    category: 'addon',
    shape: { kind: 'quantity', unit: 'location' },
    lifecycle: 'available',
    audience: 'owner',
    atLimit: 'none',
    sellableAsAddon: true,
    note: 'One location per business today; the multi-location model is not built (§18). Same reasoning as team.seats.',
  },
  'website.custom_domain': {
    labels: { en: 'Custom domain', he: 'דומיין מותאם', es: 'Dominio propio' },
    category: 'addon',
    shape: { kind: 'addon' },
    // NOT BUILT — corrected 2026-09-22 (QA C2-2). Storage is not a feature.
    lifecycle: 'not_built',
    audience: 'client_render',
    atLimit: 'none',
    sellableAsAddon: true,
    note:
      'The column and the lookup exist; the serving path does not. `middleware.ts:56-69` rewrites ' +
      'to /site/[subdomain] ONLY when the host ends with the platform base host, so a genuine ' +
      'custom domain never matches, and WebsitePageRepository.findByCustomDomain ' +
      '(lib/repositories/WebsitePageRepository.ts:330) has no caller anywhere in the repository. ' +
      'A customer who bought this would point their DNS at us and get nothing. Same evidence ' +
      'class as marketing.mass_email: a column, a flag and a repository method, with no path to ' +
      'the outcome.',
  },
  'addon.act_for_you': {
    labels: { en: 'Act-for-you automations', he: 'אוטומציות שפועלות בשבילך', es: 'Automatizaciones por ti' },
    category: 'addon',
    shape: { kind: 'addon' },
    lifecycle: 'not_built',
    audience: 'owner',
    atLimit: 'none',
    sellableAsAddon: true,
    note: 'No such surface today.',
  },
} as const satisfies Record<string, CapabilityDef>;

/** Every capability id in the catalog. */
export type CapabilityId = keyof typeof CAPABILITIES;

/** The ids, as a list, for iteration. */
export const CAPABILITY_IDS = Object.keys(CAPABILITIES) as CapabilityId[];

/** The value type this particular capability admits. */
export type ValueFor<C extends CapabilityId> = ValueForShape<(typeof CAPABILITIES)[C]['shape']>;

/**
 * One tier's complete row.
 *
 * A mapped type over the catalog, so a tier that forgets a capability, or gives
 * one the wrong kind of value, does not compile (T-1). Zod repeats the same
 * rules at load, because the Next build ignores type errors.
 */
export type TierRow = { [C in CapabilityId]: ValueFor<C> };

/**
 * The capabilities whose value cannot be derived from "give them everything":
 * a quantity, an allowance and a ceiling all have to be stated as numbers.
 *
 * A cohort config must supply one for each of these, which is why adding, say,
 * a new metered capability fails the build until champions are given a number.
 */
export type ExplicitValueCapabilityId = {
  [C in CapabilityId]: (typeof CAPABILITIES)[C]['shape']['kind'] extends 'quantity' | 'metered' | 'fair_use'
    ? C
    : never;
}[CapabilityId];

/** The explicit values a cohort must provide. */
export type CohortExplicitValues = { [C in ExplicitValueCapabilityId]: ValueFor<C> };
