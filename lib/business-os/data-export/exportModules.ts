// lib/business-os/data-export/exportModules.ts
//
// MX-0 (BUSINESS_OS_EXPORT_MX0_WORKPLAN.md §2, SA conditions C-1…C-9;
// requirement BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md §4.1, §7 MX-0,
// XC-21): the module map of the export. Which of the export sections belong to
// which of the modules the owner ticks in the export drawer, the module names
// in English, Hebrew and Spanish, and an on/off switch per module.
//
// A module is a PRODUCT label, not a privacy decision. Whether a table is
// exported at all is the export classification on its purge descriptor
// (`export: include | exclude`), reviewed by SA. This map can only REMOVE what
// the classification allows: nothing builds a section from it, and the CI rule
// below (`exportModuleProblems`, R-6) refuses a section that no `include`
// descriptor backs, so a never-exported table cannot be switched on.
//
// The switch (`on`) is a code edit and a deploy only. No helper here takes a
// switch from a request, a query, a body or an environment variable.
//
// Module ids are DURABLE: from MX-1a they are stored in module-job rows, audit
// `details.modules` and file names. Renaming one after rows exist is a data
// change that needs SA, not a refactor (pinned by exportModules.test.ts T-8).
//
// PURE on purpose (SA C-1): one type-only import and nothing at runtime, no
// zod and no `server-only`, so the MX-1b drawer (a client component) can read
// ids, names and switches without pulling the descriptors, the repositories or
// zod into the browser bundle. The Zod schemas live in `exportModuleSchema.ts`.
// The CI rule takes every input as an argument for the same reason.

import type { ExportSectionId } from '@/lib/business-os/data-export/classificationTypes';

/**
 * Every module id, in drawer order (requirement §4.1). A tuple so the schema
 * file can build `z.enum` from it without a cast (SA C-2, `PRICE_PROVIDERS`
 * precedent). Durable: see the header.
 */
export const EXPORT_MODULE_IDS = [
  'clients',
  'activities_tasks',
  'bookings',
  'services',
  'quotes',
  'invoices_payments',
  'payment_plans',
  'forms',
  'email_campaigns',
  'newsletter_subscribers',
  'website',
  'smart_links',
  'account_business',
] as const;

export type ExportModuleId = (typeof EXPORT_MODULE_IDS)[number];

/** The languages every module name is given in (Spanish names are drafts, requirement §4.3). */
export type ExportModuleLanguage = 'en' | 'he' | 'es';

export interface ExportModuleDefinition {
  /** Durable id (see the header). */
  id: ExportModuleId;
  name: Readonly<Record<ExportModuleLanguage, string>>;
  /** Section order is the column order of the module's joined CSV (MX-2a, XC-10). */
  sections: readonly ExportSectionId[];
  /** Product switch: off = not offered in the drawer and refused by the route. Code edit + deploy only. */
  on: boolean;
}

/**
 * The 13 modules (BA default, requirement §4.1; workplan §2.3). The user can
 * move a section between modules before MX-4 switch-on (BQ-27): a one-line
 * edit that re-runs the tests.
 *
 * "הזמנות" for Bookings is the README precedent and ships as the default; it is
 * also the app's Hebrew label for the Orders screen (`nav.payments`), so the
 * word is the user's call at MX-1b's drawer copy review (MX0-8).
 */
export const EXPORT_MODULES: readonly ExportModuleDefinition[] = [
  {
    id: 'clients',
    name: { en: 'Clients', he: 'לקוחות', es: 'Clientes' },
    sections: ['clients', 'pipeline_stages', 'client_documents'],
    on: true,
  },
  {
    id: 'activities_tasks',
    name: { en: 'Activities & tasks', he: 'פעילויות ומשימות', es: 'Actividades y tareas' },
    sections: ['client_activities', 'client_tasks'],
    on: true,
  },
  {
    id: 'bookings',
    name: { en: 'Bookings', he: 'הזמנות', es: 'Reservas' },
    sections: ['bookings', 'time_off'],
    on: true,
  },
  {
    id: 'services',
    name: { en: 'Services', he: 'שירותים', es: 'Servicios' },
    sections: ['services'],
    on: true,
  },
  {
    id: 'quotes',
    name: { en: 'Quotes', he: 'הצעות מחיר', es: 'Presupuestos' },
    sections: ['quotes'],
    on: true,
  },
  {
    id: 'invoices_payments',
    name: { en: 'Invoices & payments', he: 'חשבוניות ותשלומים', es: 'Facturas y pagos' },
    sections: ['invoices', 'payments', 'refunds', 'client_payment_methods'],
    on: true,
  },
  {
    id: 'payment_plans',
    name: { en: 'Payment plans', he: 'תוכניות תשלום', es: 'Planes de pago' },
    sections: ['payment_plans', 'client_payment_plans', 'installments'],
    on: true,
  },
  {
    id: 'forms',
    name: { en: 'Forms', he: 'טפסים', es: 'Formularios' },
    sections: ['intake_settings', 'intake_forms'],
    on: true,
  },
  {
    id: 'email_campaigns',
    name: { en: 'Email campaigns', he: 'קמפייני אימייל', es: 'Campañas de email' },
    sections: ['email_campaigns', 'email_sequences', 'email_sequence_steps', 'email_sequence_enrollments'],
    on: true,
  },
  {
    id: 'newsletter_subscribers',
    name: { en: 'Newsletter subscribers', he: 'מנויי ניוזלטר', es: 'Suscriptores del boletín' },
    sections: ['newsletter_subscribers', 'consent_records', 'consent_settings', 'email_unsubscribes'],
    on: true,
  },
  {
    id: 'website',
    name: { en: 'Website', he: 'אתר', es: 'Sitio web' },
    sections: ['website_content', 'website_pages', 'website_blocks', 'images'],
    on: true,
  },
  {
    id: 'smart_links',
    name: { en: 'Smart links', he: 'קישורים חכמים', es: 'Enlaces inteligentes' },
    sections: ['smart_links'],
    on: true,
  },
  {
    id: 'account_business',
    name: { en: 'Account & business details', he: 'פרטי החשבון והעסק', es: 'Datos de la cuenta y del negocio' },
    sections: [
      'account_identity',
      'user_profile',
      'preferences',
      'notification_settings',
      'business_profile',
      'business_addresses',
      'payment_account',
      'payment_providers',
    ],
    on: true,
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────
// Each takes the map as its last argument (default the real one) so tests can
// inject a map with a module switched off (SA C-3).

/** The modules switched on, in map order: what the drawer offers. */
export function enabledModules(map: readonly ExportModuleDefinition[] = EXPORT_MODULES): readonly ExportModuleDefinition[] {
  return map.filter((m) => m.on);
}

/** True only for a known id that is switched on. A plain string, so an unknown id is a runtime `false`. */
export function isModuleEnabled(id: string, map: readonly ExportModuleDefinition[] = EXPORT_MODULES): boolean {
  return map.some((m) => m.id === id && m.on);
}

/** The module holding the section, or `null` when none does (fail closed). */
export function moduleOfSection(
  sectionId: string,
  map: readonly ExportModuleDefinition[] = EXPORT_MODULES
): ExportModuleId | null {
  const owner = map.find((m) => m.sections.some((s) => s === sectionId));
  return owner ? owner.id : null;
}

/** The module's section ids in map order; empty for an unknown id (fail closed). */
export function sectionsOfModule(
  id: string,
  map: readonly ExportModuleDefinition[] = EXPORT_MODULES
): readonly ExportSectionId[] {
  return map.find((m) => m.id === id)?.sections ?? [];
}

// ── The CI rule (workplan §2.2, R-1…R-9) ────────────────────────────────────

/**
 * A module as the CI rule reads it: looser than `ExportModuleDefinition` on
 * purpose (SA C-3), so a negative control can plant a bad id or an unknown
 * section without a cast. Jest is transpile-only and no type gate runs here,
 * so the rule re-checks at runtime what the types already promise.
 */
export interface ExportModuleRuleModule {
  id: string;
  name: Readonly<Record<ExportModuleLanguage, string>>;
  sections: readonly string[];
  on: boolean;
}

/**
 * Everything the rule compares the map with, passed in so this file never
 * imports the descriptors or the section registry.
 */
export interface ExportModuleRuleInputs {
  /** The ids of the section registry (`EXPORT_SECTIONS`). */
  registeredSections: readonly string[];
  /** The `section` of every `include` descriptor, one entry per descriptor (repeats kept, so R-6 can count). */
  includeSections: readonly string[];
  /** The keys of `NON_TABLE_SECTIONS`. */
  nonTableSections: readonly string[];
  /** Each `viaParent` child's section and its parent table's section, resolved through the descriptors (SA C-5). */
  viaParentLinks: readonly { childSection: string; parentSection: string }[];
  /** Declared "needs" pairs that must share a module (old SA-8; kept in the test inputs, MX0-5). */
  declaredRequires: readonly { section: string; requires: string }[];
}

const MODULE_ID_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;
// Written with the literal letters, not a backslash escape: lib/ is scanned by
// Tailwind, and a backslash + hex in a scanned file breaks the build.
const HEBREW_LETTER = /[֐-׿]/;
const LANGUAGES: readonly ExportModuleLanguage[] = ['en', 'he', 'es'];

/**
 * Problems with the module map; empty means the map is sound. Pure, like
 * `sectionRegistryProblems`: every rule is run over the real map and over a
 * planted bad input in exportModules.test.ts.
 */
export function exportModuleProblems(
  map: readonly ExportModuleRuleModule[],
  inputs: ExportModuleRuleInputs
): string[] {
  const problems: string[] = [];
  const registered = new Set(inputs.registeredSections);
  const nonTable = new Set(inputs.nonTableSections);
  const includeCount = new Map<string, number>();
  for (const s of inputs.includeSections) includeCount.set(s, (includeCount.get(s) ?? 0) + 1);

  // R-1: well-formed, unique ids.
  const seenIds = new Set<string>();
  for (const m of map) {
    if (!MODULE_ID_PATTERN.test(m.id)) problems.push(`module ${JSON.stringify(m.id)}: id is not well-formed`);
    if (seenIds.has(m.id)) problems.push(`module ${m.id}: duplicate id`);
    seenIds.add(m.id);
  }

  // R-2: no empty module.
  for (const m of map) {
    if (m.sections.length === 0) problems.push(`module ${m.id}: has no sections`);
  }

  // R-3: a section in exactly one place.
  const ownerOf = new Map<string, string>();
  for (const m of map) {
    const inThisModule = new Set<string>();
    for (const s of m.sections) {
      if (inThisModule.has(s)) {
        problems.push(`section ${s}: listed twice in module ${m.id}`);
        continue;
      }
      inThisModule.add(s);
      const owner = ownerOf.get(s);
      if (owner !== undefined) problems.push(`section ${s}: in two modules (${owner}, ${m.id})`);
      else ownerOf.set(s, m.id);
    }
  }

  // R-4 (SA C-4): every section the registry, an include descriptor or the
  // non-table list knows is in a module, so a new include on an unregistered
  // section is caught here even though R-5 never sees it.
  const known = new Set<string>([...inputs.registeredSections, ...inputs.includeSections, ...inputs.nonTableSections]);
  for (const s of known) {
    if (!ownerOf.has(s)) problems.push(`section ${s}: in no module`);
  }

  for (const [s, moduleId] of ownerOf) {
    // R-5: the map names only registered sections.
    if (!registered.has(s)) problems.push(`section ${s} (module ${moduleId}): not a registered section`);
    // R-6: a mapped section is exportable: exactly one include descriptor, or
    // a non-table section with none. An exclude table has no section, so its
    // name planted here fails, and so does a section whose only descriptor
    // was flipped to exclude.
    const includes = includeCount.get(s) ?? 0;
    const isExportable = nonTable.has(s) ? includes === 0 : includes === 1;
    if (!isExportable) {
      problems.push(`section ${s} (module ${moduleId}): not exportable (${includes} include descriptors${nonTable.has(s) ? ', non-table' : ''})`);
    }
  }

  // R-7: names in every language; Hebrew has a Hebrew letter; unique per language.
  for (const lang of LANGUAGES) {
    const seenNames = new Map<string, string>();
    for (const m of map) {
      const name = typeof m.name?.[lang] === 'string' ? m.name[lang].trim() : '';
      if (name === '') {
        problems.push(`module ${m.id}: no ${lang} name`);
        continue;
      }
      if (lang === 'he' && !HEBREW_LETTER.test(name)) problems.push(`module ${m.id}: he name has no Hebrew letter`);
      const other = seenNames.get(name);
      if (other !== undefined) problems.push(`module ${m.id}: ${lang} name "${name}" also used by ${other}`);
      else seenNames.set(name, m.id);
    }
  }

  // R-8 / R-9: a section and what it needs share a module. An unmapped side
  // is already reported by R-4.
  const sameModule = (rule: string, child: string, parent: string): void => {
    const childModule = ownerOf.get(child);
    const parentModule = ownerOf.get(parent);
    if (childModule !== undefined && parentModule !== undefined && childModule !== parentModule) {
      problems.push(`${rule}: section ${child} (module ${childModule}) is not in the module of ${parent} (module ${parentModule})`);
    }
  };
  for (const link of inputs.viaParentLinks) sameModule('viaParent', link.childSection, link.parentSection);
  for (const pair of inputs.declaredRequires) sameModule('requires', pair.section, pair.requires);

  return problems;
}
