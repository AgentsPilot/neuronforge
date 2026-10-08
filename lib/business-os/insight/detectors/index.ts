/**
 * Detectors Module
 *
 * Exports detector engine, types, and catalog.
 */

export { DetectorEngine } from './DetectorEngine';
export * from './types';
/*
 * No `export * from './catalog'`.
 *
 * The catalog barrel was deleted: it had drifted to 42 of 46 detectors and
 * nothing read it, because `DetectorEngine` imports every detector directly
 * and that import list is the real registration point. Re-exporting it from
 * here kept a dead file alive and, once it was removed, broke this module for
 * every consumer — including `app/api/cron/insight-detect/route.ts`, which
 * imports `DetectorEngine` through this barrel.
 *
 * A detector is reached through the engine. Nothing imports one by name.
 */
