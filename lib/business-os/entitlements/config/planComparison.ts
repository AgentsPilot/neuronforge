// lib/business-os/entitlements/config/planComparison.ts
//
// THE PLAN COMPARISON ROWS — how the upgrade modal's table groups capabilities.
//
// Presentation config, like the catalog's labels: it decides NOTHING about
// access. The loader does not read it, it is not in `EntitlementConfig`, and it
// is in neither drift snapshot. `customerPlanView.buildPlanComparison` reads it
// to build the `comparison` field of the customer's plan read (upgrade modal
// UM-0).
//
// ── SHORT GROUPED ROWS (user decision UM-D2, 2026-10-19) ────────────────────
// One row per capability was about 29 rows, against the mockup's 14. The user
// chose short grouped rows (12 to 15). Related capabilities share a row, and:
//
//   **A row is ✓ for a plan only if that plan includes EVERY capability in it.**
//
// A grouped ✓ must never overstate a plan. The guards in
// `__tests__/planComparison.config.test.ts` additionally require that, for every
// plan shown to customers, a row's members are all granted or all withheld
// (no partial row: otherwise ✕ would hide something the plan does include), and
// that a feature row's members read the same in every plan that grants them.
//
// ── What a row does NOT carry ───────────────────────────────────────────────
// No section: the heading a row sits under is DERIVED from its members' catalog
// shape and category (`customerPlanView`, C-20), so a row cannot be filed under
// the wrong heading by hand. No tier name: which plan gets a ✓ is the matrix's
// business, read through the resolver.
//
// ── Variants ────────────────────────────────────────────────────────────────
// A variant member of a feature row (`website.branding`, `intake.forms`,
// `support.level`) must be at its HIGHEST variant in every shown plan that
// grants it, so a label such as "Priority support" stays true. "Highest" is the
// LAST entry of the shape's `variants` list, which the catalog orders low to
// high (SA S-3). A variant list that is ever not ascending is a catalog change
// for SA.
//
// ── ⚠️ TRIPWIRE: a new or newly available capability (SA S-2) ────────────────
// Switching a capability's `lifecycle` to `available` in `catalog.ts`, or
// granting a new capability in a tier shown to customers, FAILS
// `planComparison.config.test.ts` until the capability is placed in exactly one
// row below. Add it to the row it belongs with (re-check the row's label in all
// three languages), or give it its own row, keeping the total within 12 to 15
// (changing that range is a user decision). The builder has a fallback that
// shows an unplaced capability as its own row rather than drop it, but the
// guard keeps that fallback unreachable in production.
//
// Labels: three languages, no digits (figures live in config VALUES only), and
// nothing that reads as "your plan does not include". The he / es wording was
// approved by the user on 2026-10-19.

import type { Labels } from '../types';
import type { CapabilityId } from './catalog';

export interface PlanComparisonRowConfig {
  /** Stable id: React key and test handle. Never shown, never branched on by a client (C-21). */
  id: string;
  /** What the row is called, in three languages. Data, like catalog labels; resolved server-side. */
  labels: Labels;
  /** The capabilities this row stands for. ✓ for a plan only if it includes EVERY one (UM-D2). */
  capabilities: readonly CapabilityId[];
}

/** In display order within each section. The section itself is derived (customerPlanView, C-20). */
export const PLAN_COMPARISON_ROWS: ReadonlyArray<PlanComparisonRowConfig> = [
  // ── Run your business ──
  {
    id: 'crm',
    labels: { en: 'CRM, contacts and documents', he: 'CRM, אנשי קשר ומסמכים', es: 'CRM, contactos y documentos' },
    capabilities: ['crm.core', 'crm.documents'],
  },
  {
    id: 'booking',
    labels: {
      en: 'Online booking with calendar sync',
      he: 'זימון תורים אונליין עם סנכרון יומן',
      es: 'Reservas online con calendario sincronizado',
    },
    capabilities: ['booking.calendar_sync'],
  },
  {
    id: 'website',
    labels: { en: 'AI-built website', he: 'אתר שנבנה ב-AI', es: 'Sitio web creado con IA' },
    capabilities: ['website.ai_site', 'website.branding'],
  },
  {
    id: 'intake',
    labels: {
      en: 'Smart intake forms and reminders',
      he: 'טפסי קליטה חכמים ותזכורות',
      es: 'Formularios de admisión inteligentes y recordatorios',
    },
    capabilities: ['intake.forms', 'intake.reminders'],
  },
  {
    id: 'payments',
    labels: {
      en: 'Invoices, card payments, reminders, multi-currency',
      he: 'חשבוניות, תשלום בכרטיס, תזכורות ומספר מטבעות',
      es: 'Facturas, pagos con tarjeta, recordatorios y varias monedas',
    },
    capabilities: ['payments.invoices', 'payments.card', 'payments.reminders', 'payments.multi_currency'],
  },
  {
    // Its own row (user decision, 2026-10-19), rather than folded into intake.
    id: 'leads',
    labels: {
      en: 'Automatic replies to new leads',
      he: 'מענה אוטומטי לפניות חדשות',
      es: 'Respuesta automática a nuevos contactos',
    },
    capabilities: ['marketing.lead_response'],
  },
  {
    id: 'insights',
    labels: { en: 'Insights and daily briefing', he: 'תובנות ותדריך יומי', es: 'Análisis y resumen diario' },
    capabilities: ['insights.checks', 'insights.channels', 'insights.daily_briefing'],
  },
  {
    id: 'support',
    labels: { en: 'Priority support', he: 'תמיכה בעדיפות גבוהה', es: 'Soporte prioritario' },
    capabilities: ['support.level'],
  },

  // ── AI assistant ──
  {
    id: 'chat',
    labels: {
      en: 'Chat with your business AI assistant',
      he: 'צ׳אט עם עוזר ה-AI של העסק',
      es: 'Chat con el asistente de IA de tu negocio',
    },
    capabilities: ['chat.access'],
  },
  {
    id: 'chat_send',
    labels: {
      en: 'Ask it to send emails and marketing',
      he: 'לבקש ממנו לשלוח מיילים ודיוור',
      es: 'Pídele que envíe correos y campañas',
    },
    capabilities: ['chat.email', 'chat.marketing'],
  },
  {
    id: 'chat_work',
    labels: {
      en: 'Ask it to schedule, quote and invoice',
      he: 'לבקש ממנו לתאם פגישות, להכין הצעות מחיר ולהפיק חשבוניות',
      es: 'Pídele que agende, presupueste y facture',
    },
    capabilities: ['chat.scheduling', 'chat.quotes', 'chat.invoice_control'],
  },
  {
    id: 'chat_reports',
    labels: {
      en: 'Reports, search and bulk actions by chat',
      he: 'דוחות, חיפוש ופעולות באצווה דרך הצ׳אט',
      es: 'Informes, búsquedas y acciones masivas por chat',
    },
    capabilities: ['chat.reporting', 'chat.search', 'chat.bulk'],
  },

  // ── What's included (amount rows: the cells carry values) ──
  {
    id: 'credits',
    labels: { en: 'Credits for AI work', he: 'קרדיטים לעבודת AI', es: 'Créditos para tareas de IA' },
    capabilities: ['credits.allowance'],
  },
  {
    // "Emails", not "Emails (fair use)" (user decision, 2026-10-19).
    id: 'emails',
    labels: { en: 'Emails', he: 'מיילים', es: 'Correos' },
    capabilities: ['email.volume'],
  },
  {
    id: 'team',
    labels: { en: 'Team seats · locations', he: 'מושבי צוות · סניפים', es: 'Puestos de equipo · ubicaciones' },
    capabilities: ['team.seats', 'business.locations'],
  },
];
