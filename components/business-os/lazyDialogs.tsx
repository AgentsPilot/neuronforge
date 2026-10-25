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
 * Every site keeps rendering its dialog exactly where it did, closed. The
 * closed instance renders nothing on the server (it rendered nothing there
 * before either: both dialogs draw nothing while closed), and on the client it
 * asks for its chunk as soon as it mounts — after the page has painted, with no
 * click needed (AC-1.1). By the time an owner clicks, the component is already
 * resolved, so the dialog opens in the same frame, with the same animation and
 * tab, as before (AC-1.2).
 *
 * ONE LOADER PER DIALOG, SHARED BY EVERY SITE. Each `createLazyDialog` call
 * below owns one module-level loader, so the layout's closed instance warms it
 * for every other site on the page (My Day, the website builder, the setup
 * wizard).
 *
 * Props, `isOpen` and `onClose` pass straight through, so close behaviour —
 * capability refresh, `onClose` once, the closing grace — is unchanged (AC-1.5).
 *
 * IF THE CHUNK FAILS TO LOAD, it is retried, an open dialog shows a visible
 * "Couldn't load this — Try again" surface, and the failure is not remembered:
 * the next open starts a fresh load. See `lazyDialogLoader.tsx` and
 * docs/workplans/PERF_1_LAZY_DIALOG_FAILURE_FIX.md. (The first version resolved
 * a failure to a component rendering `null`, which `next/dynamic` then cached
 * for the life of the page: the Business Setup tab went permanently dead.)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { ComponentProps, ComponentType } from 'react';
// Type-only: these erase at build time and keep the heavy modules out of the
// page's first download. A value import here would undo the whole slice
// (guarded by `components/business-os/__tests__/lazyDialogs.guard.test.ts`).
import type { ConfigurationDialog as ConfigurationDialogComponent } from '@/components/business-os/ConfigurationDialog';
import type { SchedulingDialog as SchedulingDialogComponent } from '@/components/business-os/SchedulingDialog';
import type { StandaloneUpgradeModalProps } from '@/components/business-os/settings/StandaloneUpgradeModal';
import { createLazyDialog } from '@/components/business-os/lazyDialogLoader';

type ConfigurationDialogProps = ComponentProps<typeof ConfigurationDialogComponent>;
type SchedulingDialogProps = ComponentProps<typeof SchedulingDialogComponent>;

export const LazyConfigurationDialog = createLazyDialog<ConfigurationDialogProps>(
  'ConfigurationDialog',
  () =>
    import('@/components/business-os/ConfigurationDialog').then(
      (mod): ComponentType<ConfigurationDialogProps> => mod.ConfigurationDialog
    )
);

export const LazySchedulingDialog = createLazyDialog<SchedulingDialogProps>(
  'SchedulingDialog',
  () =>
    import('@/components/business-os/SchedulingDialog').then(
      (mod): ComponentType<SchedulingDialogProps> => mod.SchedulingDialog
    )
);

/*
 * Upgrade modal UM-2 (workplan §4.5): the plan comparison window opened from
 * anywhere, rendered closed by `UpgradeModalProvider` in the Business OS layout.
 * Settings keeps its own static `UpgradeModal` (it loads with the drawer only).
 */
export const LazyUpgradeModal = createLazyDialog<StandaloneUpgradeModalProps>(
  'UpgradeModal',
  () =>
    import('@/components/business-os/settings/StandaloneUpgradeModal').then(
      (mod): ComponentType<StandaloneUpgradeModalProps> => mod.StandaloneUpgradeModal
    )
);
