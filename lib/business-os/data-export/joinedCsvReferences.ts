// lib/business-os/data-export/joinedCsvReferences.ts
//
// MX-2a (BUSINESS_OS_EXPORT_MX2A_WORKPLAN.md §1.1, §1.2, §2.5; SA C-2, C-5,
// C-10; requirement BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md XC-10): which
// id columns of the module CSV become a readable label, and the parent of a
// child row ("Belongs to").
//
// The DECLARED lists below are the whole rule. Nothing is inferred from a
// column name ending in `_id`: an id that is not declared stays the id. A new
// `_id` column must be added to a reference or to `STAYS_ID`, or the CI rule
// (J-7) fails, so the choice is always a conscious one.
//
// XC-10 scope: a label is allowed for a reference into the module's OWN
// sections, or to the client, the service or the pipeline stage. Anything else
// keeps its id (J-3).
//
// The parent rule (C-10): a section's parent is its structural owner record
// when that owner has a readable label (pages for blocks, sequences for steps
// and enrollments, invoices for refunds); otherwise the client. Installments
// and client payment plans fall back to the client because their structural
// owner (a client payment plan) has no name.
//
// PURE data plus one pure CI rule (`joinedReferenceProblems`), in the shape of
// `exportModuleProblems`: every input is passed in, so this file imports types
// only and the tests can plant a bad list.

import type { ExportSectionId } from '@/lib/business-os/data-export/classificationTypes';

export type LookupTargetId =
  | 'client'
  | 'service'
  | 'stage'
  | 'invoice'
  | 'payment_plan'
  | 'email_sequence'
  | 'website_page'
  | 'quote';

/** Every target id, in declaration order (the order `lookupSectionsFor` returns sections in). */
export const LOOKUP_TARGET_IDS: readonly LookupTargetId[] = [
  'client',
  'service',
  'stage',
  'invoice',
  'payment_plan',
  'email_sequence',
  'website_page',
  'quote',
];

/**
 * How a target's label is made from its label columns.
 * - `name_and_email`: every label column but the last, joined by a space, is
 *   the name; the last is the email. "First Last (email)", else the name
 *   only, else the email only (C-3; owner question Q-C, default built).
 * - `first_present`: the first label column that is not empty.
 */
export type LookupLabelShape = 'name_and_email' | 'first_present';

export interface LookupTarget {
  /** The section whose rows carry the label. */
  section: ExportSectionId;
  /** The column a reference matches on (`id`, or `stage_key` for stages). */
  key: string;
  /** The columns the label is made from. Each must be an include column of `section` (J-2). */
  labelColumns: readonly string[];
  shape: LookupLabelShape;
}

export interface ColumnReference {
  section: ExportSectionId;
  column: string;
  target: LookupTargetId;
}

/**
 * The lookup targets. Stage keys are unique per owner (`UNIQUE(user_id,
 * stage_key)`), and `crm_contacts.stage` holds the key.
 */
export const LOOKUP_TARGETS: Readonly<Record<LookupTargetId, LookupTarget>> = {
  client: { section: 'clients', key: 'id', labelColumns: ['first_name', 'last_name', 'email'], shape: 'name_and_email' },
  service: { section: 'services', key: 'id', labelColumns: ['service_name'], shape: 'first_present' },
  stage: { section: 'pipeline_stages', key: 'stage_key', labelColumns: ['stage_label'], shape: 'first_present' },
  invoice: { section: 'invoices', key: 'id', labelColumns: ['invoice_number'], shape: 'first_present' },
  payment_plan: { section: 'payment_plans', key: 'id', labelColumns: ['name'], shape: 'first_present' },
  email_sequence: { section: 'email_sequences', key: 'id', labelColumns: ['name'], shape: 'first_present' },
  website_page: { section: 'website_pages', key: 'id', labelColumns: ['title', 'slug'], shape: 'first_present' },
  quote: { section: 'quotes', key: 'id', labelColumns: ['title'], shape: 'first_present' },
};

/** The sections a reference may reach outside its own module (XC-10). */
export const CROSS_MODULE_TARGET_SECTIONS: readonly ExportSectionId[] = ['clients', 'services', 'pipeline_stages'];

/**
 * References replaced IN PLACE by the target's label (the column stays where
 * it is, holding the label instead of the id).
 */
export const COLUMN_REFERENCES: readonly ColumnReference[] = [
  { section: 'clients', column: 'stage', target: 'stage' },
  { section: 'bookings', column: 'service_id', target: 'service' },
  { section: 'quotes', column: 'service_id', target: 'service' },
  { section: 'quotes', column: 'supersedes_id', target: 'quote' },
  { section: 'invoices', column: 'service_id', target: 'service' },
  { section: 'payments', column: 'service_id', target: 'service' },
  { section: 'payments', column: 'invoice_id', target: 'invoice' },
  { section: 'payment_plans', column: 'service_id', target: 'service' },
  { section: 'client_payment_plans', column: 'service_id', target: 'service' },
  { section: 'client_payment_plans', column: 'payment_plan_id', target: 'payment_plan' },
  { section: 'installments', column: 'payment_plan_id', target: 'payment_plan' },
  { section: 'email_sequence_enrollments', column: 'contact_id', target: 'client' },
  { section: 'newsletter_subscribers', column: 'promoted_contact_id', target: 'client' },
];

/**
 * The parent of a child row: its label goes to "Belongs to", its raw value to
 * Parent ID. At most one per section (J-4). A section not listed is a
 * top-level row ("Belongs to" blank).
 */
export const PARENT_REFERENCES: readonly ColumnReference[] = [
  { section: 'client_documents', column: 'contact_id', target: 'client' },
  { section: 'client_activities', column: 'contact_id', target: 'client' },
  { section: 'client_tasks', column: 'contact_id', target: 'client' },
  { section: 'bookings', column: 'contact_id', target: 'client' },
  { section: 'quotes', column: 'contact_id', target: 'client' },
  { section: 'invoices', column: 'contact_id', target: 'client' },
  { section: 'payments', column: 'contact_id', target: 'client' },
  { section: 'refunds', column: 'invoice_id', target: 'invoice' },
  { section: 'client_payment_methods', column: 'contact_id', target: 'client' },
  { section: 'client_payment_plans', column: 'contact_id', target: 'client' },
  { section: 'installments', column: 'contact_id', target: 'client' },
  { section: 'email_sequence_steps', column: 'sequence_id', target: 'email_sequence' },
  { section: 'email_sequence_enrollments', column: 'sequence_id', target: 'email_sequence' },
  { section: 'consent_records', column: 'contact_id', target: 'client' },
  { section: 'email_unsubscribes', column: 'contact_id', target: 'client' },
  { section: 'website_blocks', column: 'page_id', target: 'website_page' },
];

/**
 * `_id` columns that deliberately stay the raw id (workplan §1.1, C-10): out
 * of XC-10's scope (another module, not client / service / stage), or the
 * target has no readable name (a payment, a booking, a client payment plan),
 * or the id belongs to an outside system (Stripe, a processor).
 */
export const STAYS_ID: Readonly<Partial<Record<ExportSectionId, readonly string[]>>> = {
  // `invoice_tax_id` is the business's tax number, not a reference: kept as stored.
  business_profile: ['address_id', 'invoice_address_id', 'template_id', 'invoice_tax_id'],
  client_activities: ['source_entity_id'],
  client_tasks: ['source_entity_id'],
  website_pages: ['template_id'],
  bookings: ['parent_booking_id', 'payment_id', 'invoice_id', 'payment_plan_id'],
  refunds: ['transaction_id', 'processor_refund_id', 'stripe_connect_account_id'],
  client_payment_plans: [
    'booking_id',
    'stripe_subscription_id',
    'stripe_schedule_id',
    'stripe_price_id',
    'stripe_customer_id',
    'stripe_connect_account_id',
  ],
  payments: [
    'booking_id',
    'processor_refund_id',
    'stripe_payment_intent_id',
    'stripe_charge_id',
    'stripe_customer_id',
    'stripe_connect_account_id',
  ],
  invoices: [
    'booking_id',
    'processor_checkout_id',
    'processor_payment_id',
    'processor_customer_id',
    'processor_payment_method_id',
    'stripe_invoice_id',
  ],
  installments: ['subscription_id', 'booking_id', 'proposal_id', 'invoice_id', 'transaction_id', 'stripe_invoice_id'],
  client_payment_methods: ['processor_customer_id', 'processor_method_id'],
  payment_account: ['stripe_account_id'],
  quotes: ['booking_id', 'package_booking_id', 'document_id', 'created_invoice_id', 'created_plan_id'],
};

// ── The CI rule (workplan §2.5, J-1…J-7) ────────────────────────────────────

/** A reference as the rule reads it: plain strings, so a test can plant a bad one without a cast. */
export interface LooseColumnReference {
  section: string;
  column: string;
  target: string;
}

export interface LooseLookupTarget {
  section: string;
  key: string;
  labelColumns: readonly string[];
}

export interface JoinedReferenceSet {
  targets: Readonly<Record<string, LooseLookupTarget>>;
  columnReferences: readonly LooseColumnReference[];
  parentReferences: readonly LooseColumnReference[];
  staysId: Readonly<Record<string, readonly string[] | undefined>>;
}

/** Everything the rule compares the lists with, passed in so this file never imports the descriptors. */
export interface JoinedReferenceRuleInputs {
  /** The ids of the section registry (`EXPORT_SECTIONS`). */
  registeredSections: readonly string[];
  /** Sections with exactly one include descriptor, plus the non-table ones. */
  exportableSections: readonly string[];
  /** The include columns of every exportable section, in descriptor order. */
  columnsBySection: Readonly<Record<string, readonly string[]>>;
  /** The module map, loose (id + sections). */
  modules: readonly { id: string; sections: readonly string[] }[];
  /** Each `viaParent` child's section, its parent's section and the fk (from the descriptors). */
  viaParentLinks: readonly { childSection: string; parentSection: string; fk: string }[];
  /** The sections a reference may reach across modules. */
  crossModuleTargetSections: readonly string[];
}

/** The real lists in the rule's loose shape. */
export const REAL_JOINED_REFERENCES: JoinedReferenceSet = {
  targets: LOOKUP_TARGETS,
  columnReferences: COLUMN_REFERENCES,
  parentReferences: PARENT_REFERENCES,
  staysId: STAYS_ID,
};

/**
 * Problems with the declared references; empty means sound. Run over the real
 * lists and over a planted bad input per rule (joinedCsvReferences.test.ts).
 */
export function joinedReferenceProblems(refs: JoinedReferenceSet, inputs: JoinedReferenceRuleInputs): string[] {
  const problems: string[] = [];
  const registered = new Set(inputs.registeredSections);
  const exportable = new Set(inputs.exportableSections);
  const crossModule = new Set(inputs.crossModuleTargetSections);
  const moduleOf = new Map<string, string>();
  for (const m of inputs.modules) for (const s of m.sections) if (!moduleOf.has(s)) moduleOf.set(s, m.id);
  const columnsOf = (section: string): readonly string[] => inputs.columnsBySection[section] ?? [];

  // J-6: every section named anywhere is registered and exportable.
  const checkSection = (section: string, where: string): boolean => {
    if (!registered.has(section) || !exportable.has(section)) {
      problems.push(`J-6 ${where}: section ${section} is not a registered, exportable section`);
      return false;
    }
    return true;
  };

  // J-2: targets' key and label columns are include columns of the target section.
  for (const [id, target] of Object.entries(refs.targets)) {
    if (!checkSection(target.section, `target ${id}`)) continue;
    const cols = new Set(columnsOf(target.section));
    for (const column of [target.key, ...target.labelColumns]) {
      if (!cols.has(column)) problems.push(`J-2 target ${id}: ${target.section}.${column} is not an include column`);
    }
  }

  const checkReference = (ref: LooseColumnReference, kind: string): void => {
    const where = `${kind} ${ref.section}.${ref.column}`;
    if (!checkSection(ref.section, where)) return;
    // J-1: the referencing column is an include column of its section.
    if (!columnsOf(ref.section).includes(ref.column)) problems.push(`J-1 ${where}: not an include column of ${ref.section}`);
    const target = refs.targets[ref.target];
    if (!target) {
      problems.push(`J-2 ${where}: unknown target ${ref.target}`);
      return;
    }
    // J-3: outside the module only to client, service or stage.
    const from = moduleOf.get(ref.section);
    const to = moduleOf.get(target.section);
    if (from !== to && !crossModule.has(target.section)) {
      problems.push(`J-3 ${where}: target ${ref.target} is in module ${to ?? 'none'}, not ${from ?? 'none'}, and is not client, service or stage`);
    }
  };
  for (const ref of refs.columnReferences) checkReference(ref, 'reference');
  for (const ref of refs.parentReferences) checkReference(ref, 'parent');

  // J-4: one parent per section; no column declared twice.
  const parentOf = new Map<string, string>();
  for (const ref of refs.parentReferences) {
    if (parentOf.has(ref.section)) problems.push(`J-4 section ${ref.section}: two parent references`);
    else parentOf.set(ref.section, ref.column);
  }
  const seen = new Set<string>();
  for (const ref of refs.columnReferences) {
    const key = `${ref.section}.${ref.column}`;
    if (seen.has(key)) problems.push(`J-4 reference ${key}: declared twice`);
    seen.add(key);
    if (parentOf.get(ref.section) === ref.column) problems.push(`J-4 reference ${key}: is also the section's parent`);
  }

  // J-5: every viaParent link is the declared parent of its child.
  for (const link of inputs.viaParentLinks) {
    const declared = refs.parentReferences.find((r) => r.section === link.childSection);
    const target = declared ? refs.targets[declared.target] : undefined;
    if (!declared || declared.column !== link.fk || target?.section !== link.parentSection) {
      problems.push(`J-5 viaParent ${link.childSection} -> ${link.parentSection} (${link.fk}): not declared as the section's parent`);
    }
  }

  // J-7: every include `_id` column is a reference, a parent or a declared stay-id; a stay-id is neither.
  const referenced = new Set<string>([...refs.columnReferences, ...refs.parentReferences].map((r) => `${r.section}.${r.column}`));
  for (const [section, stays] of Object.entries(refs.staysId)) {
    if (!stays) continue;
    if (!checkSection(section, 'stays-id')) continue;
    for (const column of stays) {
      if (!columnsOf(section).includes(column)) problems.push(`J-7 stays-id ${section}.${column}: not an include column`);
      if (referenced.has(`${section}.${column}`)) problems.push(`J-7 stays-id ${section}.${column}: also declared as a reference`);
    }
  }
  for (const [section, columns] of Object.entries(inputs.columnsBySection)) {
    const stays = new Set(refs.staysId[section] ?? []);
    for (const column of columns) {
      if (!column.endsWith('_id')) continue;
      if (!referenced.has(`${section}.${column}`) && !stays.has(column)) {
        problems.push(`J-7 ${section}.${column}: an _id column that is neither a reference nor in STAYS_ID`);
      }
    }
  }

  return problems;
}
