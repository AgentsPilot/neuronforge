// lib/business-os/data-export/payload.ts
//
// The typed `data.json` of the "Download my data" zip (DE-1,
// BUSINESS_OS_DATA_EXPORT_DE1_WORKPLAN.md §3.3, §3.4; since DE-8b written by
// the zip builder, and since DE-9 the only export: the JSON route is
// retired). Pure: no I/O, no clock of its own (the caller passes `now` and the
// duration), so it is tested on its own and has no `any` (CLAUDE.md rule 6).
//
// `format_version: 2` marks the break from the 2025 shape (top-level `agents`,
// `transactions`, `audit_logs`, …), so anyone who scripted against the old
// file can tell. The README with the full controller wording per group, en/he,
// and the business-name file name (DX-10) are DE-8b.

import type { AnyExportedSection, ExportGroupId, ExportSectionId, GdprRole } from './sections';

/** One name for the provider, kept in DE-8b (SA C-4: `meta.controller` per group). */
export const EXPORT_PROVIDER_NAME = 'AgentPilot';

export const EXPORT_GDPR_ARTICLE = 'Article 15 (Right to Access) & Article 20 (Data Portability)';

/**
 * The controller of a group that AgentPilot only processes (DE-4 SA-Q13). DE-8b
 * replaces it with the business name (§0.4.1 E), once that column is known.
 */
export const EXPORT_ACCOUNT_HOLDER = 'account_holder';

export interface ExportGroupMetadata {
  gdpr_role: GdprRole;
  /**
   * DE-8b (SA Q-10): widened to `string`. In the zip's data.json the
   * `account_holder` groups carry the business name when there is one; the
   * JSON route passes no name, so its output is unchanged.
   */
  controller: string;
  description: string;
}

/** Per group. DE-8b's README carries the full wording; this stays one neutral sentence (SA Q-6). */
export const EXPORT_GROUPS: Record<ExportGroupId, ExportGroupMetadata> = {
  account: {
    gdpr_role: 'controller',
    controller: EXPORT_PROVIDER_NAME,
    description: 'Your own account details. AgentPilot is the controller of this data.',
  },
  // DE-4 (§2.3): the owner's client records. `format_version` stays 2: a new
  // group and new sections are additive.
  client_records: {
    gdpr_role: 'processor',
    controller: EXPORT_ACCOUNT_HOLDER,
    description:
      'Records you keep about your clients. You, the account holder, are the controller of these records. AgentPilot keeps them on your behalf, as its processor.',
  },
  // DE-7 (SA-Q3): the business's website and content. Additive, so
  // `format_version` stays 2.
  content: {
    gdpr_role: 'processor',
    controller: EXPORT_ACCOUNT_HOLDER,
    description:
      'Your website, landing pages, smart links and picture library. You, the account holder, are the controller of this content. AgentPilot hosts it on your behalf, as its processor.',
  },
};

export interface UserDataExportPayload {
  export_metadata: {
    format_version: 2;
    user_id: string;
    /** ISO 8601, UTC. */
    export_date: string;
    /** DE-8b: 'ZIP' in the zip's data.json; the JSON route stays 'JSON'. */
    export_format: 'JSON' | 'ZIP';
    gdpr_article: typeof EXPORT_GDPR_ARTICLE;
    provider: typeof EXPORT_PROVIDER_NAME;
    groups: Record<ExportGroupId, ExportGroupMetadata>;
  };
  /** In registry order (EXPORT_SECTIONS). */
  sections: AnyExportedSection[];
  /** DE-8b, zip only: one row per file in "Your files" (the same rows as files-index.csv). */
  files?: readonly ExportFileIndexRow[];
  summary: {
    section_counts: Partial<Record<ExportSectionId, number>>;
    failed_sections: ExportSectionId[];
    export_size_kb: number;
    export_duration_ms: number;
  };
}

export interface BuildExportPayloadInput {
  userId: string;
  now: Date;
  sections: AnyExportedSection[];
  durationMs: number;
  /**
   * DE-8b, the zip's data.json only. Absent (the JSON route), the payload is
   * byte-identical to before: `export_format: 'JSON'`, no `files`, the
   * `account_holder` controllers unchanged (characterization test).
   */
  zip?: {
    /** Already cleaned (readme.ts cleanBusinessName), or null: keep 'account_holder'. */
    accountHolderName: string | null;
    files: readonly ExportFileIndexRow[];
  };
}

/** One row of files-index.csv / data.json `files` (DE-8b §9.3). Never a storage key. */
export interface ExportFileIndexRow {
  path_in_export: string;
  folder: string;
  size_bytes: number;
  content_type: string;
  record_section: 'client_documents' | 'images' | '';
  record_id: string;
  status: 'included' | 'could_not_be_read';
}

/** files-index.csv columns, in order. */
export const FILE_INDEX_COLUMNS: readonly (keyof ExportFileIndexRow)[] = [
  'path_in_export',
  'folder',
  'size_bytes',
  'content_type',
  'record_section',
  'record_id',
  'status',
];

/** The groups with the business name as controller of the `account_holder` ones (DE-4 SA-Q13). */
export function groupsWithController(name: string | null): Record<ExportGroupId, ExportGroupMetadata> {
  if (!name) return EXPORT_GROUPS;
  const out = {} as Record<ExportGroupId, ExportGroupMetadata>;
  for (const [id, group] of Object.entries(EXPORT_GROUPS) as Array<[ExportGroupId, ExportGroupMetadata]>) {
    out[id] = group.controller === EXPORT_ACCOUNT_HOLDER ? { ...group, controller: name } : group;
  }
  return out;
}

/** Row count per section, in section order. A failed section counts 0. */
export function sectionCounts(sections: readonly AnyExportedSection[]): Partial<Record<ExportSectionId, number>> {
  const counts: Partial<Record<ExportSectionId, number>> = {};
  for (const section of sections) counts[section.id] = section.row_count;
  return counts;
}

export function failedSections(sections: readonly AnyExportedSection[]): ExportSectionId[] {
  return sections.filter((section) => section.status === 'failed').map((section) => section.id);
}

export function buildExportPayload(input: BuildExportPayloadInput): UserDataExportPayload {
  const head: Omit<UserDataExportPayload, 'summary'> = {
    export_metadata: {
      format_version: 2,
      user_id: input.userId,
      export_date: input.now.toISOString(),
      export_format: input.zip ? 'ZIP' : 'JSON',
      gdpr_article: EXPORT_GDPR_ARTICLE,
      provider: EXPORT_PROVIDER_NAME,
      groups: input.zip ? groupsWithController(input.zip.accountHolderName) : EXPORT_GROUPS,
    },
    sections: input.sections,
  };
  // Additive and zip-only, so `format_version` stays 2 (SA Q-10).
  if (input.zip) head.files = input.zip.files;
  return {
    ...head,
    summary: {
      section_counts: sectionCounts(input.sections),
      failed_sections: failedSections(input.sections),
      // Measured before the summary is added, as the route always has.
      export_size_kb: Math.round(JSON.stringify(head).length / 1024),
      export_duration_ms: input.durationMs,
    },
  };
}
