// lib/business-os/data-export/moduleExportPolicy.ts
//
// Module export MX-1a (BUSINESS_OS_EXPORT_MX1A_WORKPLAN.md §4.1; requirement
// BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md §4.4 BQ-29, XC-8, XC-9, XC-20):
// the rules of the per-module export request and its module jobs. PURE:
// constants only, no imports.
//
// The database is the authority. Migration 20261095 carries every number here
// as a SQL literal, in its start function and in the claim and reap functions
// of the module jobs (named only in the repositories, T-5), so no caller can
// loosen them. This file only mirrors them for the code that tells the owner
// "you can export again at ...", and for the MX-3 worker, which must keep its
// maxDuration below the lease.
// supabase/migrations/__tests__/business-os-export-requests.migration.test.ts
// fails CI when a literal and its constant here disagree (one SQL site per
// constant, SA M-5).
//
// The old ZIP export keeps its own rules in jobPolicy.ts (migration 20261074),
// untouched until MX-7 drops that table.

export const MODULE_EXPORT_POLICY = {
  /** BQ-29 (user, 2026-10-26): an owner may start 2 export requests per rolling 24 hours. */
  OWNER_DAILY_LIMIT: 2,
  /** XC-20: an admin may send at most 2 per owner per rolling 24 hours, counted apart from the owner's own. */
  ADMIN_DAILY_LIMIT_PER_OWNER: 2,
  /** Hours, not days: an interval of days moves with the session time zone across a DST change (jobPolicy SA C-2). */
  DAILY_WINDOW_HOURS: 24,
  /** A sanity ceiling in the table CHECK and the start function. Not the module count (MX-0 has 13). */
  MAX_MODULES_PER_REQUEST: 32,
  /** XC-8: a working job whose claim is older than this belongs to a killed worker and is reaped. */
  LEASE_SECONDS: 420,
  /** XC-8: the MX-3 worker route pins its maxDuration to this. Must stay at least 60 s below the lease. */
  WORKER_MAX_DURATION_SECONDS: 300,
  /** XC-8: the worker stops taking new work after this many seconds of a run. */
  WORKER_BUDGET_SECONDS: 270,
  /** A job with no part sent is dead-lettered (failed, attempts_exhausted) after this many build claims. */
  BUILD_MAX_ATTEMPTS: 3,
  /** A failure notice is given up after this many claims. */
  NOTICE_MAX_ATTEMPTS: 5,
  /** A reaped retry waits this many seconds times its attempts before it is claimable again. */
  RETRY_BACKOFF_SECONDS: 60,
  /** The claim function clamps its batch to 1..this. */
  CLAIM_BATCH_MAX: 10,
  /** The reap function handles at most this many stale rows per call. */
  REAP_BATCH_MAX: 100,
} as const;

/** Who started a request (XC-7, XC-20). */
export const EXPORT_REQUEST_ORIGINS = ['owner', 'admin'] as const;
export type ExportRequestOrigin = (typeof EXPORT_REQUEST_ORIGINS)[number];

/** The status words of a module job: the history words of requirement §3.7. */
export const MODULE_JOB_STATUSES = ['waiting', 'working', 'sent', 'failed', 'interrupted'] as const;
export type ModuleJobStatus = (typeof MODULE_JOB_STATUSES)[number];

/** A request is in flight while any of its jobs is in one of these. */
export const MODULE_JOB_IN_FLIGHT = ['waiting', 'working'] as const;

/** The terminal statuses: a job here has `finished_at` set and is never claimed for a build again. */
export const MODULE_JOB_TERMINAL = ['sent', 'failed', 'interrupted'] as const;

/** A request with every job in one of these does not count towards the daily limit (BQ-29). */
export const MODULE_JOB_NOT_COUNTED = ['failed', 'interrupted'] as const;

/** The failure notice of a failed or interrupted job (D-11). */
export const NOTICE_STATES = ['none', 'due', 'sent', 'given_up'] as const;
export type NoticeState = (typeof NOTICE_STATES)[number];

/** The state of one emailed part (XC-9). */
export const PART_STATES = ['sending', 'accepted'] as const;
export type PartState = (typeof PART_STATES)[number];

/** What the start function answers. */
export const START_OUTCOMES = ['started', 'in_progress', 'daily_limit'] as const;
export type StartOutcome = (typeof START_OUTCOMES)[number];

/** The shape of a module id and of every code column (SA-P6: shape only, never a value list in SQL). */
export const CODE_SHAPE = /^[a-z][a-z0-9_]{1,39}$/;
