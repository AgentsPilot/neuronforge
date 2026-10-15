// lib/business-os/data-export/payload.ts
//
// The typed body of GET /api/user/data-export (DE-1,
// BUSINESS_OS_DATA_EXPORT_DE1_WORKPLAN.md §3.3, §3.4). Pure: no I/O, no clock
// of its own (the route passes `now` and the duration), so it is tested on its
// own and the route has no `any` (CLAUDE.md rule 6).
//
// `format_version: 2` marks the break from the 2025 shape (top-level `agents`,
// `transactions`, `audit_logs`, …), so anyone who scripted against the old
// file can tell. The README with the full controller wording per group, en/he,
// and the business-name file name (DX-10) are DE-8b.

import type { AnyExportedSection, ExportGroupId, ExportSectionId, GdprRole } from './sections';

/** One name for the provider, kept in DE-8b (SA C-4: `meta.controller` per group). */
export const EXPORT_PROVIDER_NAME = 'AgentPilot';

export const EXPORT_GDPR_ARTICLE = 'Article 15 (Right to Access) & Article 20 (Data Portability)';

export interface ExportGroupMetadata {
  gdpr_role: GdprRole;
  controller: typeof EXPORT_PROVIDER_NAME;
  description: string;
}

/** Per group. DE-8b's README carries the full wording; this stays one neutral sentence (SA Q-6). */
export const EXPORT_GROUPS: Record<ExportGroupId, ExportGroupMetadata> = {
  account: {
    gdpr_role: 'controller',
    controller: EXPORT_PROVIDER_NAME,
    description: 'Your own account details. AgentPilot is the controller of this data.',
  },
};

export interface UserDataExportPayload {
  export_metadata: {
    format_version: 2;
    user_id: string;
    /** ISO 8601, UTC. */
    export_date: string;
    export_format: 'JSON';
    gdpr_article: typeof EXPORT_GDPR_ARTICLE;
    provider: typeof EXPORT_PROVIDER_NAME;
    groups: Record<ExportGroupId, ExportGroupMetadata>;
  };
  /** In registry order (EXPORT_SECTIONS). */
  sections: AnyExportedSection[];
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
      export_format: 'JSON',
      gdpr_article: EXPORT_GDPR_ARTICLE,
      provider: EXPORT_PROVIDER_NAME,
      groups: EXPORT_GROUPS,
    },
    sections: input.sections,
  };
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

/**
 * `agentpilot-data-export-YYYY-MM-DD.json`, UTC date (SA Q-1): the requirement's
 * §E fallback form with `.json`. No user id: the name reaches the downloads
 * folder and is often forwarded. DE-8b moves the date to the owner's timezone
 * and adds the business-name slug and `filename*`.
 */
export function exportFileName(now: Date): string {
  return `agentpilot-data-export-${now.toISOString().slice(0, 10)}.json`;
}
