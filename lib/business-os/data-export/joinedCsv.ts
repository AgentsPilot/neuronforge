// lib/business-os/data-export/joinedCsv.ts
//
// MX-2a (BUSINESS_OS_EXPORT_MX2A_WORKPLAN.md §2, SA conditions C-1…C-11;
// requirement BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md §4.2, §4.3, XC-8,
// XC-10, BQ-26): one module's section rows turned into ONE joined CSV.
//
// The shape (BQ-26, user 2026-10-26): Record type, Belongs to, the union of the
// sections' columns in module section order (the same key is always the same
// column; blank where a record type lacks it), Record ID, Parent ID. Rows are
// written section by section, in the order received (owner question Q-B,
// default built). Every module has the same first two and last two columns
// (Q-A, default built).
//
// Output is an ARRAY of encoded lines plus the header, never one big string
// (XC-8). The BOM and line ends are added by `csvPartText` in csv.ts when MX-3
// cuts a part, so the CSV framing lives in csv.ts only.
//
// Data cells are written as stored, through csv.ts `csvLine` (BC-1). Only the
// header, the record type and the looked-up labels are text this file
// chooses; headers and record types come through `JoinedCsvLabels` (MX-2b
// fills it with en/he/es; until then `KEY_ECHO_LABELS` echoes the keys).
//
// Lookups (XC-10) are DECLARED in joinedCsvReferences.ts. A lookup falls back
// to the raw value when the reference is not found, the label is empty, the
// key is ambiguous, the target section is not exportable, or its module is
// switched off (C-3, C-4). Lookup rows are reduced to key -> label maps built
// from the declared label columns only (C-11).
//
// PURE: no I/O, no logger, no repository, no `server-only`. Rows arrive already
// read through the classified reader (MX-3); this file only writes columns the
// classification names. Server-side in use (it imports the descriptors via
// classification.ts), so no client component imports it.

import { csvHeaderLine, csvLine } from '@/lib/business-os/data-export/csv';
import { exportColumnsOf, exportDescriptorOfSection } from '@/lib/business-os/data-export/classification';
import { NON_TABLE_SECTIONS, type ExportSectionId } from '@/lib/business-os/data-export/classificationTypes';
import {
  EXPORT_MODULES,
  isModuleEnabled,
  moduleOfSection,
  sectionsOfModule,
  type ExportModuleDefinition,
  type ExportModuleId,
  type ExportModuleLanguage,
} from '@/lib/business-os/data-export/exportModules';
import {
  COLUMN_REFERENCES,
  LOOKUP_TARGET_IDS,
  LOOKUP_TARGETS,
  PARENT_REFERENCES,
  type ColumnReference,
  type LookupTarget,
  type LookupTargetId,
} from '@/lib/business-os/data-export/joinedCsvReferences';

// ── Labels (SA-P3; MX-2b fills them) ────────────────────────────────────────

/** The four fixed columns every module CSV has. */
export type JoinedCsvFixedColumn = 'record_type' | 'belongs_to' | 'record_id' | 'parent_id';

/** Their keys, in header order of the two leading and two trailing columns. */
export const JOINED_CSV_FIXED_COLUMNS: readonly JoinedCsvFixedColumn[] = ['record_type', 'belongs_to', 'record_id', 'parent_id'];

export interface JoinedCsvLabels {
  /** "Record type", "Belongs to", "Record ID", "Parent ID". */
  fixed(key: JoinedCsvFixedColumn, language: ExportModuleLanguage): string;
  /** Singular record-type name of a section ("Client", "Document"). */
  recordType(section: ExportSectionId, language: ExportModuleLanguage): string;
  /** Header of a column, named by the section where the key first appears. */
  column(section: ExportSectionId, key: string, language: ExportModuleLanguage): string;
}

/** MX-2a default until MX-2b: echoes the keys (the fixed key, the section id, the column key). */
export const KEY_ECHO_LABELS: JoinedCsvLabels = {
  fixed: (key) => key,
  recordType: (section) => section,
  column: (_section, key) => key,
};

// ── Classification seam (C-4) ───────────────────────────────────────────────

/** The one injectable dependency on the export classification. */
export interface JoinedCsvClassification {
  /** A section's include columns, in order. Throws on a denied column (fail closed). */
  columnsOf(section: ExportSectionId): readonly string[];
  /** Whether a section is exportable at all. */
  isExportableSection(section: ExportSectionId): boolean;
}

/**
 * The CSV columns of a section: the classification's include columns;
 * `account_identity` (not a table) its three.
 *
 * Restates zipExport.ts `sectionColumns` on purpose (SA MX2A-6): zipExport is
 * server-only and is deleted in MX-6, so this file does not import it. A
 * parity test (joinedCsv.test.ts, C-9) fails if either copy drifts. Remove
 * the duplicate when MX-6 deletes zipExport.
 */
export function classifiedColumnsOf(section: ExportSectionId): readonly string[] {
  if (section === 'account_identity') return ['id', 'email', 'created_at'];
  return exportColumnsOf(exportDescriptorOfSection(section).table);
}

/** Exactly one include descriptor, or a non-table section. Never throws. */
export function isClassifiedExportable(section: ExportSectionId): boolean {
  if (NON_TABLE_SECTIONS[section] !== undefined) return true;
  try {
    exportDescriptorOfSection(section);
    return true;
  } catch {
    return false;
  }
}

export const CLASSIFIED: JoinedCsvClassification = {
  columnsOf: classifiedColumnsOf,
  isExportableSection: isClassifiedExportable,
};

// ── Lookup availability ─────────────────────────────────────────────────────

/**
 * Whether a lookup target may give a label: the section is exportable and its
 * module is switched on in `map`. A classification error here means "not
 * available, keep the id" (C-4); it is never raised. Whether the owner ticked
 * the target's module in this request does not matter.
 */
export function lookupTargetAvailable(
  section: ExportSectionId,
  map: readonly ExportModuleDefinition[] = EXPORT_MODULES,
  classification: JoinedCsvClassification = CLASSIFIED
): boolean {
  try {
    if (!classification.isExportableSection(section)) return false;
  } catch {
    return false;
  }
  const owner = moduleOfSection(section, map);
  return owner !== null && isModuleEnabled(owner, map);
}

function referencesOf(sections: readonly ExportSectionId[]): { column: ColumnReference[]; parent: ColumnReference[] } {
  const inModule = new Set<ExportSectionId>(sections);
  return {
    column: COLUMN_REFERENCES.filter((r) => inModule.has(r.section)),
    parent: PARENT_REFERENCES.filter((r) => inModule.has(r.section)),
  };
}

/**
 * The sections OUTSIDE the module that MX-3 must read (through the same
 * classified reader) so the module's references can show labels. Derived from
 * the declared references (C-5), minus unavailable targets, in target order.
 */
export function lookupSectionsFor(
  moduleId: ExportModuleId,
  map: readonly ExportModuleDefinition[] = EXPORT_MODULES,
  classification: JoinedCsvClassification = CLASSIFIED
): ExportSectionId[] {
  const sections = sectionsOfModule(moduleId, map);
  const inModule = new Set<ExportSectionId>(sections);
  const refs = referencesOf(sections);
  const used = new Set<LookupTargetId>([...refs.column, ...refs.parent].map((r) => r.target));
  const out: ExportSectionId[] = [];
  for (const id of LOOKUP_TARGET_IDS) {
    if (!used.has(id)) continue;
    const section = LOOKUP_TARGETS[id].section;
    if (inModule.has(section) || out.includes(section)) continue;
    if (lookupTargetAvailable(section, map, classification)) out.push(section);
  }
  return out;
}

// ── Label maps (C-3, C-11) ──────────────────────────────────────────────────

/** A target reduced to key -> label. Ambiguous keys (seen twice) never give a label. */
interface LabelMap {
  labels: Map<string, string>;
  ambiguous: Set<string>;
}

function keyText(value: unknown): string | null {
  if (typeof value === 'string') return value === '' ? null : value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'bigint') return value.toString();
  return null;
}

function labelPart(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'bigint') return value.toString();
  return '';
}

/**
 * The label of one target row, or '' (then the raw id is kept). Client (Q-C,
 * default): name and email -> "First Last (email)"; name only -> "First Last";
 * email only -> "email"; neither -> ''.
 */
export function labelOfRow(target: LookupTarget, row: Readonly<Record<string, unknown>>): string {
  const parts = target.labelColumns.map((column) => labelPart(row[column]));
  if (target.shape === 'name_and_email') {
    const name = parts.slice(0, -1).filter((p) => p !== '').join(' ');
    const email = parts.length > 0 ? parts[parts.length - 1] : '';
    if (name !== '' && email !== '') return `${name} (${email})`;
    return name !== '' ? name : email;
  }
  return parts.find((p) => p !== '') ?? '';
}

function buildLabelMap(target: LookupTarget, rows: readonly Readonly<Record<string, unknown>>[]): LabelMap {
  const labels = new Map<string, string>();
  const ambiguous = new Set<string>();
  const seen = new Set<string>();
  for (const row of rows) {
    const key = keyText(row[target.key]);
    if (key === null) continue;
    if (seen.has(key)) {
      ambiguous.add(key);
      labels.delete(key);
      continue;
    }
    seen.add(key);
    const label = labelOfRow(target, row);
    if (label !== '') labels.set(key, label);
  }
  return { labels, ambiguous };
}

// ── The builder ─────────────────────────────────────────────────────────────

export type JoinedCsvRows = Partial<Record<ExportSectionId, readonly Readonly<Record<string, unknown>>[]>>;

export interface JoinedCsvInput {
  moduleId: ExportModuleId;
  language: ExportModuleLanguage;
  /** The module's own sections, as read by the classified reader. Other sections are ignored. */
  rowsBySection: JoinedCsvRows;
  /** Rows of `lookupSectionsFor(moduleId)`, for labels only. Other sections are ignored. */
  lookupRowsBySection?: JoinedCsvRows;
  /** Default `KEY_ECHO_LABELS` (until MX-2b). */
  labels?: JoinedCsvLabels;
  /** Default `EXPORT_MODULES` (tests inject a module switched off). */
  map?: readonly ExportModuleDefinition[];
  /** Default `CLASSIFIED` (tests inject an excluded target, C-4). */
  classification?: JoinedCsvClassification;
}

export interface JoinedCsv {
  /** The header row, encoded (no BOM, no line end). */
  header: string;
  /** One encoded line per record (no line end). */
  lines: string[];
  /** Data rows per module section, for MX-3's row count and audit. */
  rowCountBySection: Partial<Record<ExportSectionId, number>>;
}

/**
 * The joined CSV of one module. Throws for an unknown module (fail closed) and
 * lets a classification error on the module's OWN sections propagate (C-4):
 * that section must fail, never be written with a guessed column list.
 */
export function buildJoinedCsv(input: JoinedCsvInput): JoinedCsv {
  const map = input.map ?? EXPORT_MODULES;
  const labels = input.labels ?? KEY_ECHO_LABELS;
  const classification = input.classification ?? CLASSIFIED;
  const language = input.language;
  const sections = sectionsOfModule(input.moduleId, map);
  if (sections.length === 0) throw new Error(`Unknown export module: ${input.moduleId}`);
  const inModule = new Set<ExportSectionId>(sections);

  // Own sections' columns: errors propagate (fail closed).
  const columnsBySection = new Map<ExportSectionId, readonly string[]>();
  for (const section of sections) columnsBySection.set(section, classification.columnsOf(section));

  const refs = referencesOf(sections);
  const parentOf = new Map<ExportSectionId, ColumnReference>(refs.parent.map((r) => [r.section, r]));
  const inPlace = new Map<string, LookupTargetId>(refs.column.map((r) => [`${r.section}.${r.column}`, r.target]));

  // C-2: a parent column leaves the union only when no other section of the
  // module has the same key as an ordinary column.
  const ordinaryKeys = new Set<string>();
  for (const section of sections) {
    const parentColumn = parentOf.get(section)?.column;
    for (const column of columnsBySection.get(section) ?? []) {
      if (column !== 'id' && column !== parentColumn) ordinaryKeys.add(column);
    }
  }
  // Each key at its first appearance, with the section that names its header.
  const union: { key: string; section: ExportSectionId }[] = [];
  const inUnion = new Set<string>();
  for (const section of sections) {
    const parentColumn = parentOf.get(section)?.column;
    for (const column of columnsBySection.get(section) ?? []) {
      if (column === 'id' || inUnion.has(column)) continue;
      if (column === parentColumn && !ordinaryKeys.has(column)) continue;
      inUnion.add(column);
      union.push({ key: column, section });
    }
  }

  // Label maps, one per target the module references (C-11).
  const labelMaps = new Map<LookupTargetId, LabelMap>();
  for (const id of new Set<LookupTargetId>([...refs.column, ...refs.parent].map((r) => r.target))) {
    const target = LOOKUP_TARGETS[id];
    if (!lookupTargetAvailable(target.section, map, classification)) continue;
    let targetColumns: readonly string[];
    try {
      targetColumns = classification.columnsOf(target.section);
    } catch {
      continue; // a lookup target's classification error keeps the id (C-4)
    }
    if (![target.key, ...target.labelColumns].every((c) => targetColumns.includes(c))) continue;
    const source = inModule.has(target.section) ? input.rowsBySection : input.lookupRowsBySection;
    labelMaps.set(id, buildLabelMap(target, source?.[target.section] ?? []));
  }

  const resolve = (target: LookupTargetId, value: unknown): unknown => {
    const labelMap = labelMaps.get(target);
    const key = keyText(value);
    if (!labelMap || key === null || labelMap.ambiguous.has(key)) return value;
    return labelMap.labels.get(key) ?? value;
  };

  const header = csvHeaderLine([
    labels.fixed('record_type', language),
    labels.fixed('belongs_to', language),
    ...union.map((u) => labels.column(u.section, u.key, language)),
    labels.fixed('record_id', language),
    labels.fixed('parent_id', language),
  ]);

  const lines: string[] = [];
  const rowCountBySection: Partial<Record<ExportSectionId, number>> = {};
  for (const section of sections) {
    const rows = input.rowsBySection[section] ?? [];
    rowCountBySection[section] = rows.length;
    if (rows.length === 0) continue;
    const columns = new Set(columnsBySection.get(section) ?? []);
    const parent = parentOf.get(section);
    const recordType = labels.recordType(section, language);
    // Per column of the union: absent (blank), in-place target, or plain.
    const plan = union.map(({ key }): { key: string; present: boolean; target: LookupTargetId | undefined } => ({
      key,
      present: columns.has(key),
      target: inPlace.get(`${section}.${key}`) ?? (parent && parent.column === key ? parent.target : undefined),
    }));
    const hasId = columns.has('id');
    for (const row of rows) {
      const cells: unknown[] = [recordType, parent ? resolve(parent.target, row[parent.column]) : null];
      for (const step of plan) {
        if (!step.present) cells.push(null);
        else cells.push(step.target ? resolve(step.target, row[step.key]) : row[step.key]);
      }
      cells.push(hasId ? row.id : null, parent ? row[parent.column] : null);
      lines.push(csvLine(cells));
    }
  }

  return { header, lines, rowCountBySection };
}
