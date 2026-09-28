'use client';

/**
 * The latest fully-archived cutoff of the audit trail, for the admin
 * "Entries before <date> are archived" notice (FR-12, condition C-6).
 *
 * Reads the existing `GET /api/admin/archiving` (its `sources[].latestCutoff`,
 * the cutoff of the newest SUCCEEDED run). It adds no route and does not touch
 * the two parked audit routes, which is what C-6 requires.
 *
 * Returns `null` when nothing is archived yet, AND when the read fails. The
 * notice is advisory: an audit screen must not break because the archiving
 * read did. The failure is logged here, and the GET logs its own on the server.
 *
 * @see docs/workplans/ADMIN_ARCHIVING_SLICE_3_WORKPLAN.md §2.6
 */

import { useEffect, useState } from 'react';

import type { ArchivingOverview } from '@/lib/archiving/types';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'useLatestArchiveCutoff' });

export const ARCHIVING_OVERVIEW_URL = '/api/admin/archiving';

export function useLatestArchiveCutoff(): string | null {
  const [cutoff, setCutoff] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    const load = async () => {
      try {
        const response = await fetch(ARCHIVING_OVERVIEW_URL);
        if (!response.ok) {
          logger.warn({ status: response.status }, 'Archiving overview unavailable; no archived-before notice');
          return;
        }
        const body = (await response.json()) as { success?: boolean; data?: ArchivingOverview };
        const source = body?.data?.sources?.find((s) => s.key === 'audit_trail');
        const latest = source?.latestCutoff;
        if (isActive && typeof latest === 'string') setCutoff(latest);
      } catch (err) {
        logger.warn({ err }, 'Archiving overview read failed; no archived-before notice');
      }
    };

    void load();
    return () => {
      isActive = false;
    };
  }, []);

  return cutoff;
}
