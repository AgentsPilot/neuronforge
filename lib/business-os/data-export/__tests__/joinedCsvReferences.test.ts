/**
 * MX-2a T-16 (BUSINESS_OS_EXPORT_MX2A_WORKPLAN.md §2.5; SA C-5, C-10): the
 * declared lookup / parent references and their CI rule J-1…J-7. Every rule is
 * run over the real lists (no problem) and over a planted bad input (exactly
 * the expected problem), so an assertion that cannot fail is visible.
 * Real inputs are derived at run time from the descriptors and the map.
 */

// sections.ts imports the repositories; only its registry is read here.
jest.mock('@/lib/repositories/UserProfileRepository', () => ({ userProfileRepository: {} }));
jest.mock('@/lib/repositories/BusinessDataExportRepository', () => ({ businessDataExportRepository: {} }));

import { PURGE_DESCRIPTORS } from '@/lib/business-os/purge/descriptors';
import { EXPORT_SECTIONS } from '@/lib/business-os/data-export/sections';
import { NON_TABLE_SECTIONS, type ExportSectionId } from '@/lib/business-os/data-export/classificationTypes';
import { viaParentOf } from '@/lib/business-os/data-export/classification';
import { EXPORT_MODULES } from '@/lib/business-os/data-export/exportModules';
import { classifiedColumnsOf } from '@/lib/business-os/data-export/joinedCsv';
import {
  CROSS_MODULE_TARGET_SECTIONS,
  LOOKUP_TARGET_IDS,
  LOOKUP_TARGETS,
  REAL_JOINED_REFERENCES,
  joinedReferenceProblems,
  type JoinedReferenceRuleInputs,
  type JoinedReferenceSet,
  type LooseColumnReference,
} from '@/lib/business-os/data-export/joinedCsvReferences';

function realInputs(): JoinedReferenceRuleInputs {
  const includeCount = new Map<string, number>();
  const viaParentLinks: { childSection: string; parentSection: string; fk: string }[] = [];
  for (const d of PURGE_DESCRIPTORS) {
    if (d.export.kind !== 'include') continue;
    includeCount.set(d.export.section, (includeCount.get(d.export.section) ?? 0) + 1);
    if (d.export.viaParent === undefined) continue;
    const parent = viaParentOf(d);
    if (parent.export.kind !== 'include') throw new Error(`${d.table}: viaParent parent is not an include`);
    viaParentLinks.push({ childSection: d.export.section, parentSection: parent.export.section, fk: d.export.viaParent.fk });
  }
  const exportableSections = [
    ...[...includeCount].filter(([, n]) => n === 1).map(([s]) => s),
    ...Object.keys(NON_TABLE_SECTIONS),
  ];
  const columnsBySection: Record<string, readonly string[]> = {};
  for (const m of EXPORT_MODULES) for (const s of m.sections) columnsBySection[s] = classifiedColumnsOf(s);
  return {
    registeredSections: EXPORT_SECTIONS.map((s) => s.id),
    exportableSections,
    columnsBySection,
    modules: EXPORT_MODULES,
    viaParentLinks,
    crossModuleTargetSections: CROSS_MODULE_TARGET_SECTIONS,
  };
}

const INPUTS = realInputs();

/** A mutable deep copy of the real lists, for planting. */
function plantable(): {
  targets: Record<string, { section: string; key: string; labelColumns: string[] }>;
  columnReferences: LooseColumnReference[];
  parentReferences: LooseColumnReference[];
  staysId: Record<string, string[]>;
} {
  const targets: Record<string, { section: string; key: string; labelColumns: string[] }> = {};
  for (const [id, t] of Object.entries(REAL_JOINED_REFERENCES.targets)) targets[id] = { ...t, labelColumns: [...t.labelColumns] };
  const staysId: Record<string, string[]> = {};
  for (const [s, cols] of Object.entries(REAL_JOINED_REFERENCES.staysId)) if (cols) staysId[s] = [...cols];
  return {
    targets,
    columnReferences: REAL_JOINED_REFERENCES.columnReferences.map((r) => ({ ...r })),
    parentReferences: REAL_JOINED_REFERENCES.parentReferences.map((r) => ({ ...r })),
    staysId,
  };
}

const problemsOf = (refs: JoinedReferenceSet): string[] => joinedReferenceProblems(refs, INPUTS);

describe('T-16 the real references', () => {
  it('have no problem (J-1…J-7)', () => {
    expect(problemsOf(REAL_JOINED_REFERENCES)).toEqual([]);
  });

  it('the derived viaParent link website_blocks -> website_pages (page_id) is present and declared', () => {
    expect(INPUTS.viaParentLinks).toContainEqual({ childSection: 'website_blocks', parentSection: 'website_pages', fk: 'page_id' });
  });

  it('LOOKUP_TARGET_IDS lists every target once, in declaration order', () => {
    expect([...LOOKUP_TARGET_IDS]).toEqual(Object.keys(LOOKUP_TARGETS));
  });

  it('every label and key column of every target is an include column (no column outside the classification)', () => {
    for (const t of Object.values(LOOKUP_TARGETS)) {
      const cols = classifiedColumnsOf(t.section as ExportSectionId);
      for (const c of [t.key, ...t.labelColumns]) expect(cols).toContain(c);
    }
  });
});

describe('T-16 negative controls (each planted input reports exactly its problem)', () => {
  it('J-1: a reference column that is not an include column', () => {
    const refs = plantable();
    refs.columnReferences.push({ section: 'bookings', column: 'nope_ref', target: 'service' });
    expect(problemsOf(refs)).toEqual(['J-1 reference bookings.nope_ref: not an include column of bookings']);
  });

  it('J-2: a label column outside the target include columns (e.g. user_id on the client)', () => {
    const refs = plantable();
    refs.targets.client.labelColumns.push('user_id');
    expect(problemsOf(refs)).toEqual(['J-2 target client: clients.user_id is not an include column']);
  });

  it('J-2: a reference to an unknown target', () => {
    const refs = plantable();
    refs.columnReferences.push({ section: 'bookings', column: 'timezone', target: 'nobody' });
    expect(problemsOf(refs)).toEqual(['J-2 reference bookings.timezone: unknown target nobody']);
  });

  it('J-3: a cross-module invoice reference from Payment plans', () => {
    const refs = plantable();
    refs.staysId.installments = refs.staysId.installments.filter((c) => c !== 'invoice_id');
    refs.columnReferences.push({ section: 'installments', column: 'invoice_id', target: 'invoice' });
    expect(problemsOf(refs)).toEqual([
      'J-3 reference installments.invoice_id: target invoice is in module invoices_payments, not payment_plans, and is not client, service or stage',
    ]);
  });

  it('J-4: two parents on one section', () => {
    const refs = plantable();
    refs.parentReferences.push({ section: 'bookings', column: 'service_id', target: 'service' });
    expect(problemsOf(refs)).toEqual(['J-4 section bookings: two parent references']);
  });

  it('J-4: a parent column also declared as an in-place reference', () => {
    const refs = plantable();
    refs.columnReferences.push({ section: 'client_documents', column: 'contact_id', target: 'client' });
    expect(problemsOf(refs)).toEqual(["J-4 reference client_documents.contact_id: is also the section's parent"]);
  });

  it('J-5: the viaParent link is not declared as the parent', () => {
    const refs = plantable();
    refs.parentReferences = refs.parentReferences.filter((r) => r.section !== 'website_blocks');
    refs.staysId.website_blocks = ['page_id']; // so only J-5 reports
    expect(problemsOf(refs)).toEqual(["J-5 viaParent website_blocks -> website_pages (page_id): not declared as the section's parent"]);
  });

  it('J-6: an unknown section', () => {
    const refs = plantable();
    refs.columnReferences.push({ section: 'nope_section', column: 'x_id', target: 'client' });
    expect(problemsOf(refs)).toEqual(['J-6 reference nope_section.x_id: section nope_section is not a registered, exportable section']);
  });

  it('J-7: an _id column that is neither a reference nor a stay-id', () => {
    const refs = plantable();
    refs.staysId.website_pages = [];
    expect(problemsOf(refs)).toEqual(['J-7 website_pages.template_id: an _id column that is neither a reference nor in STAYS_ID']);
  });

  it('J-7: a stay-id that is not an include column, or is also a reference', () => {
    const refs = plantable();
    refs.staysId.bookings.push('ghost_id', 'service_id');
    expect(problemsOf(refs)).toEqual([
      'J-7 stays-id bookings.ghost_id: not an include column',
      'J-7 stays-id bookings.service_id: also declared as a reference',
    ]);
  });
});
