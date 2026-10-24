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
import {
  useConfigurationDialog,
  useConfigurationDialogOptional,
} from '@/components/business-os/ConfigurationDialogProvider';

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

/**
 * The same runner, for a component that also renders OUTSIDE Business OS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Returns null where there is no configuration dialog to open, so the caller
 * can show the explanation without a button that would go nowhere.
 *
 * `SchedulingServicesList` is the case this exists for: it is the services tab
 * of the configuration dialog, and it is ALSO rendered by `LandingPageWizard`,
 * `ProposalBuilderModal` and the legacy `/scheduling` page. Calling `useGapFix`
 * there would throw on three surfaces to add a button to one.
 *
 * A route fix still works with no provider — it only needs the router — so the
 * runner is withheld only for the gaps that are cleared in the dialog.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function useGapFixOptional(
  kind: JourneyGapKind
): ((options?: RunGapFixOptions) => void) | null {
  const dialog = useConfigurationDialogOptional();
  const fix = gapFixAction(kind);

  const run = useCallback(
    (options: RunGapFixOptions = {}) => {
      if (fix.target !== 'dialog') return;
      options.onOpen?.();
      dialog?.openConfiguration(fix.tab, {
        onClose: () => {
          void options.onClose?.();
        },
      });
    },
    [dialog, fix]
  );

  /*
   * Dialog gaps only, and the KIND is taken up front so that is decided here
   * rather than at click time — a runner handed back for a route gap would be
   * a button that looks live and does nothing.
   *
   * No `useRouter`, deliberately. This hook exists for components that also
   * render outside Business OS, and calling the router hook made every test
   * that mounts one fail with "expected app router to be mounted" — twenty of
   * them, for a branch none of those callers use. A route gap (the timezone is
   * the only one) belongs to `useGapFix`, which has the router and the
   * provider both.
   */
  return dialog && fix.target === 'dialog' ? run : null;
}
