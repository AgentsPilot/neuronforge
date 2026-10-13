'use client';

/**
 * The configuration and scheduling dialogs, loaded after the page instead of with it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY (PERF-1, docs/requirements/PERFORMANCE_IMPROVEMENT_SCOPING.md §11.2 PC-1)
 *
 * The Business OS layout mounts `ConfigurationDialog` (through
 * `ConfigurationDialogProvider`) and `SchedulingDialog` (through
 * `BusinessOSHeader`) on every owner page, closed. Imported statically, both
 * were part of every page's first download even though neither is visible
 * until somebody clicks.
 *
 * HOW THE FIRST OPEN STAYS IDENTICAL
 *
 * Every site keeps rendering its dialog exactly where it did, closed. With
 * `ssr: false` the closed instance renders nothing on the server (it rendered
 * nothing there before either: both dialogs draw nothing while closed), and
 * on the client it asks for its chunk as soon as it mounts — after the page
 * has painted, with no click needed (AC-1.1). By the time an owner clicks, the
 * component is already resolved, so the dialog opens in the same frame, with
 * the same animation and tab, as before (AC-1.2).
 *
 * ONE `dynamic()` PER DIALOG, SHARED BY EVERY SITE. React resolves a lazy
 * component once per `dynamic()` call, not once per instance, so the layout's
 * closed instance warms it for every other site on the page (My Day, the
 * website builder, the setup wizard). A site that is mounted only on click
 * still renders in the first frame, because the component is already resolved.
 *
 * Props, `isOpen` and `onClose` pass straight through, so close behaviour —
 * capability refresh, `onClose` once, the closing grace — is unchanged (AC-1.5).
 *
 * IF THE CHUNK FAILS TO LOAD (offline after the page loaded), the dialog
 * renders nothing and the failure is logged. Throwing instead would take the
 * whole owner page down through its error boundary because a CLOSED dialog
 * could not prefetch.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import dynamic from 'next/dynamic';
import type { ComponentProps, ComponentType } from 'react';
// Type-only: these erase at build time and keep the heavy modules out of the
// page's first download. A value import here would undo the whole slice
// (guarded by `components/business-os/__tests__/lazyDialogs.guard.test.ts`).
import type { ConfigurationDialog as ConfigurationDialogComponent } from '@/components/business-os/ConfigurationDialog';
import type { SchedulingDialog as SchedulingDialogComponent } from '@/components/business-os/SchedulingDialog';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'lazyDialogs' });

type ConfigurationDialogProps = ComponentProps<typeof ConfigurationDialogComponent>;
type SchedulingDialogProps = ComponentProps<typeof SchedulingDialogComponent>;

function renderNothing(): null {
  return null;
}

export const LazyConfigurationDialog = dynamic<ConfigurationDialogProps>(
  () =>
    import('@/components/business-os/ConfigurationDialog')
      .then((mod): ComponentType<ConfigurationDialogProps> => mod.ConfigurationDialog)
      .catch((err: unknown): ComponentType<ConfigurationDialogProps> => {
        logger.error({ err }, 'ConfigurationDialog chunk failed to load');
        return renderNothing;
      }),
  { ssr: false }
);

export const LazySchedulingDialog = dynamic<SchedulingDialogProps>(
  () =>
    import('@/components/business-os/SchedulingDialog')
      .then((mod): ComponentType<SchedulingDialogProps> => mod.SchedulingDialog)
      .catch((err: unknown): ComponentType<SchedulingDialogProps> => {
        logger.error({ err }, 'SchedulingDialog chunk failed to load');
        return renderNothing;
      }),
  { ssr: false }
);
