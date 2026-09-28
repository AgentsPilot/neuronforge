'use client';

/**
 * Acting on a journey gap's Fix button, in one place.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * `gapFixAction` says WHERE a gap is fixed; this performs it. They are separate
 * because the mapping has to stay pure — it is imported by client components,
 * and `journeyReadiness` pulls in the service-role Supabase client — while
 * doing the thing needs a router and the dialog context.
 *
 * Four call sites each wrote `openConfiguration(gapFixAction(kind).tab, …)`.
 * That was fine while every gap was cleared inside the configuration dialog.
 * The timezone is not: it lives on `user_preferences`, and the only control
 * that writes it is on the settings page. Teaching four copies about that is
 * how three of them stay wrong — which is the same duplication that put a
 * "Set your timezone" button on a tab with no timezone field on it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { gapFixAction } from '@/lib/business-os/journeyGapFix';
import type { JourneyGapKind } from '@/lib/business-os/journeyReadiness';
import { useConfigurationDialog } from '@/components/business-os/ConfigurationDialogProvider';

export interface RunGapFixOptions {
  /**
   * Re-check readiness once the owner comes back.
   *
   * Only fires for gaps fixed in the dialog, which is the only case with a
   * "comes back" — a route fix leaves the page, and the destination re-reads
   * readiness when it mounts.
   */
  onClose?: () => void | Promise<void>;
  /** Fired before the dialog opens, for callers that are themselves modal. */
  onOpen?: () => void;
}

export function useGapFix() {
  const router = useRouter();
  const { openConfiguration } = useConfigurationDialog();

  return useCallback(
    (kind: string, options: RunGapFixOptions = {}) => {
      const fix = gapFixAction(kind as JourneyGapKind);
      options.onOpen?.();

      if (fix.target === 'route') {
        router.push(fix.href);
        return;
      }

      openConfiguration(fix.tab, {
        onClose: () => {
          void options.onClose?.();
        },
      });
    },
    [router, openConfiguration]
  );
}
