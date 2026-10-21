'use client';

/**
 * The configuration and scheduling dialogs. Loaded with the page, on purpose.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS FILE USED TO LOAD BOTH DIALOGS ON DEMAND. IT NO LONGER DOES.
 *
 * `177ad8f9` ("perf(business-os): load configuration and scheduling dialogs on
 * demand", PERF-1) moved both behind `next/dynamic` with `ssr: false` to keep
 * them out of every owner page's first download, and answered a failed chunk
 * load with a component that rendered `null`.
 *
 * WHAT THAT COST, reported as "הגדרות העסק is not clickable":
 *
 * The Configuration tab stopped opening anything. Every part of the click path
 * was correct and stayed correct under inspection — an ungated `<button>`,
 * hydrated by React, its `onClick` running, the provider flipping its state,
 * the chunk built and served with a 200. The dialog simply never reached the
 * DOM, and the only evidence was one console line:
 *
 *     ChunkLoadError: Loading chunk …ConfigurationDialog_tsx failed.
 *     (timeout: /_next/static/chunks/…ConfigurationDialog_tsx.js)
 *
 * The chunk is several megabytes unminified and the dev server compiles it on
 * demand, so one cold compile outran the loader's timeout. `next/dynamic`
 * caches whatever its loader resolves to for the life of the page, so that
 * single slow compile turned the tab into a control that was present, correct
 * and permanently inert until a full reload.
 *
 * A retry and a visible failure panel would have made the fault reportable.
 * They would not have made the dialog open. The deferral itself is what put a
 * network round trip between a click and a modal that is part of the product's
 * core navigation, so the deferral is what has been removed: both dialogs are
 * imported directly again and are resolved before anybody can click.
 *
 * The file and its export names are kept so that the six sites rendering these
 * dialogs did not have to change. The `Lazy` prefix is now historical; renaming
 * it is a mechanical follow-up, not part of unblocking the tab.
 *
 * IF THE FIRST-LOAD WEIGHT MATTERS AGAIN, the way back is not `next/dynamic`
 * around the whole dialog. It is to split what makes the chunk heavy — the
 * Stripe wizard, the services editor, the phone library — behind the tab that
 * actually needs each, so a failure can only ever cost one tab rather than the
 * entire settings surface.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export { ConfigurationDialog as LazyConfigurationDialog } from '@/components/business-os/ConfigurationDialog';
export { SchedulingDialog as LazySchedulingDialog } from '@/components/business-os/SchedulingDialog';
