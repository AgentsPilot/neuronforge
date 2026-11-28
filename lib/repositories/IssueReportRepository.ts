// lib/repositories/IssueReportRepository.ts
//
// Issue reporting slice 1.1b (workplan BUSINESS_OS_ISSUE_REPORTING_SLICE_1_1_WORKPLAN.md
// §3, §7 with SA RC-7, RC-8 and Q5; requirement BUSINESS_OS_ISSUE_REPORTING_REQUIREMENT.md
// CR-1, CR-5, CR-7, SR-2): the problem reports of an account,
// public.issue_reports (migration 20261137).
//
// SERVICE ROLE BY DESIGN (intentional RLS bypass). `authenticated` holds
// SELECT only and there is no INSERT policy, so the write path must be the
// service role (SR-2). Reads use the same client so the 1.3 / 1.4 drains,
// which run with no user session, can read. The user_id filter on every
// method is the tenant boundary (CLAUDE.md rule 4, tenant-isolation-guard):
//
// - `create` parses an explicit allow-list with Zod and builds the insert
//   field by field (RC-8). `user_id` comes from `input.userId`, which the
//   caller takes from the session; an `id`, `status`, `reference`, `context`,
//   `screenshot_path`, `problem_id` or timestamp in the input is dropped.
// - `findByIdForUser` takes (id, userId) and filters both, so another
//   account's id matches nothing (tenant-isolation-guard step 6).
//
// `create` is report-only (SA Q5): no outbox row. Slice 1.3 owns the atomic
// report-plus-outbox write and keeps the reference retry around it.
//
// Exactly two methods: the ones slices 1.2 to 1.5 call. Each later method
// arrives with the slice that calls it (workplan §7 "Not added").
//
// Logs carry ids, the reference, error codes and durations only, never the
// message, page or context (CR-7). Every method returns { data, error } and
// never throws. Server-only: never import this from a 'use client' module.
//
// No backslash escape appears in this file: lib/ is scanned by Tailwind.

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, type Logger } from '@/lib/logger';
import {
  ISSUE_REPORT_CATEGORY_HINTS,
  ISSUE_REPORT_CLOSED_REASONS,
  ISSUE_REPORT_MESSAGE_MAX_LENGTH,
  ISSUE_REPORT_PAGE_MAX_LENGTH,
  ISSUE_REPORT_REFERENCE_PATTERN,
  ISSUE_REPORT_STATUSES,
  generateIssueReportReference,
} from '@/lib/business-os/issue-reports/issueReportModel';
import type {
  AgentRepositoryResult as RepositoryResult,
  CreateIssueReportInput,
  IssueReport,
} from './types';

/** Explicit columns, never `*`. Same order as the table. */
export const ISSUE_REPORT_COLUMNS =
  'id, user_id, reference, message, category_hint, page, area, environment, status, ' +
  'closed_reason, context, screenshot_path, problem_id, created_at, updated_at';

/** The UNIQUE constraint on `reference`; only a collision on it is retried (§3). */
export const ISSUE_REPORT_REFERENCE_CONSTRAINT = 'issue_reports_reference_key';

/** Attempts in total for one `create` when the reference collides (§3). */
export const ISSUE_REPORT_CREATE_MAX_ATTEMPTS = 3;

/** The typed error codes callers branch on. */
export const ISSUE_REPORT_ERROR = {
  INVALID: 'invalid_input',
} as const;

const uuid = z.string().uuid();
const timestamp = z.string().min(1).max(64);

/** Length in code points, as Postgres `char_length` counts (not UTF-16 units). */
const codePoints = (value: string): number => Array.from(value).length;

/** One stored row, as PostgREST returns it, so a shape surprise is an error, not a wrong object. */
export const issueReportRowSchema = z.object({
  id: uuid,
  user_id: uuid,
  reference: z.string().regex(ISSUE_REPORT_REFERENCE_PATTERN),
  message: z.string(),
  category_hint: z.enum(ISSUE_REPORT_CATEGORY_HINTS).nullable(),
  page: z.string(),
  area: z.string().nullable(),
  environment: z.string(),
  status: z.enum(ISSUE_REPORT_STATUSES),
  closed_reason: z.enum(ISSUE_REPORT_CLOSED_REASONS).nullable(),
  context: z.record(z.unknown()).nullable(),
  screenshot_path: z.string().nullable(),
  problem_id: uuid.nullable(),
  created_at: timestamp,
  updated_at: timestamp,
});

/**
 * The create allow-list (§7). The bounds mirror the table's CHECKs so a value
 * the database would refuse never reaches it. The product rules (the
 * 10-character minimum, the area map, the environment value set) are the 1.2
 * route's, so a change to them needs no change here.
 */
const createSchema = z.object({
  userId: uuid,
  message: z
    .string()
    .refine((value) => codePoints(value) >= 1 && codePoints(value) <= ISSUE_REPORT_MESSAGE_MAX_LENGTH),
  categoryHint: z.enum(ISSUE_REPORT_CATEGORY_HINTS).nullable().optional(),
  page: z
    .string()
    .refine(
      (value) =>
        value.startsWith('/') &&
        !value.includes('?') &&
        !value.includes('#') &&
        codePoints(value) <= ISSUE_REPORT_PAGE_MAX_LENGTH,
    ),
  area: z
    .string()
    .regex(/^[a-z][a-z0-9_-]{0,39}$/)
    .nullable()
    .optional(),
  environment: z.string().regex(/^[a-z][a-z-]{1,31}$/),
});

/** A fresh Error carrying only code and message, so `details` never reaches a log. */
function toError(error: unknown): Error & { code?: string } {
  const record = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  const out = new Error(typeof record.message === 'string' ? record.message : 'Unknown database error') as Error & {
    code?: string;
  };
  if (typeof record.code === 'string') out.code = record.code;
  return out;
}

function coded(code: string, message: string): Error & { code: string } {
  const out = new Error(message) as Error & { code: string };
  out.code = code;
  return out;
}

/**
 * True only for a unique violation on the reference constraint (§3). Any other
 * 23505 (there is none today) is not a reference collision and is not retried.
 * PostgREST names the constraint in `message`; `details` is checked too in case
 * a client puts it there. Neither is ever logged.
 */
function isReferenceCollision(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as Record<string, unknown>;
  if (record.code !== '23505') return false;
  const named = (value: unknown) => typeof value === 'string' && value.includes(ISSUE_REPORT_REFERENCE_CONSTRAINT);
  return named(record.message) || named(record.details);
}

export class IssueReportRepository {
  private supabase: SupabaseClient;
  private logger: Logger;
  private generateReference: () => string;

  /**
   * @param supabaseClient injected for tests; defaults to the service role (header).
   * @param generateReference injected for tests (the collision paths, §3); defaults
   *   to the Web Crypto generator of the model module (RC-7).
   */
  constructor(supabaseClient?: SupabaseClient, generateReference?: () => string) {
    // Service role on purpose: the write path has no client grant (header).
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'IssueReportRepository' });
    this.generateReference = generateReference || (() => generateIssueReportReference());
  }

  /**
   * Store a new report with status `submitted` and a fresh reference (§7).
   * `input.userId` must be the session user. On a collision on
   * `issue_reports_reference_key` it retries with a fresh reference, up to
   * ISSUE_REPORT_CREATE_MAX_ATTEMPTS attempts in total; any other error, or the
   * last collision, returns { data: null, error }.
   */
  async create(input: CreateIssueReportInput): Promise<RepositoryResult<IssueReport>> {
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) {
      return { data: null, error: coded(ISSUE_REPORT_ERROR.INVALID, 'Invalid input: issue report') };
    }
    const value = parsed.data;
    const startTime = Date.now();

    // Every path of the body returns except a collision before the last
    // attempt, which continues; so the loop ends by ISSUE_REPORT_CREATE_MAX_ATTEMPTS.
    for (let attempt = 1; ; attempt += 1) {
      let reference: string;
      try {
        reference = this.generateReference();
      } catch (err) {
        const safe = toError(err);
        this.logger.error(
          { err: safe, method: 'create', userId: value.userId, attempt, duration: Date.now() - startTime },
          'Failed to generate an issue report reference',
        );
        return { data: null, error: safe };
      }

      try {
        // RC-8: built field by field from the parsed allow-list, never a spread.
        const { data, error } = await this.supabase
          .from('issue_reports')
          .insert({
            user_id: value.userId,
            reference,
            message: value.message,
            category_hint: value.categoryHint ?? null,
            page: value.page,
            area: value.area ?? null,
            environment: value.environment,
          })
          .select(ISSUE_REPORT_COLUMNS)
          .single();

        if (error) {
          if (isReferenceCollision(error)) {
            if (attempt < ISSUE_REPORT_CREATE_MAX_ATTEMPTS) {
              this.logger.warn(
                { method: 'create', userId: value.userId, reference, attempt },
                'Issue report reference collided, retrying with a fresh one',
              );
              continue;
            }
            const safe = toError(error);
            this.logger.error(
              { err: safe, method: 'create', userId: value.userId, attempt, duration: Date.now() - startTime },
              'reference_collision_exhausted',
            );
            return { data: null, error: safe };
          }
          throw error;
        }

        const row: IssueReport = issueReportRowSchema.parse(data);
        this.logger.info(
          { method: 'create', id: row.id, userId: value.userId, reference: row.reference, duration: Date.now() - startTime },
          'Issue report created',
        );
        return { data: row, error: null };
      } catch (err) {
        const safe = toError(err);
        this.logger.error(
          { err: safe, method: 'create', userId: value.userId, attempt, duration: Date.now() - startTime },
          'Failed to create the issue report',
        );
        return { data: null, error: safe };
      }
    }
  }

  /**
   * One report of the account, or null when it does not exist or belongs to
   * another account. Both ids are checked as uuids before any query.
   */
  async findByIdForUser(id: string, userId: string): Promise<RepositoryResult<IssueReport>> {
    if (!uuid.safeParse(id).success || !uuid.safeParse(userId).success) {
      return { data: null, error: coded(ISSUE_REPORT_ERROR.INVALID, 'Invalid input: id') };
    }
    try {
      const { data, error } = await this.supabase
        .from('issue_reports')
        .select(ISSUE_REPORT_COLUMNS)
        .eq('id', id)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      const row: IssueReport | null = data ? issueReportRowSchema.parse(data) : null;
      return { data: row, error: null };
    } catch (err) {
      const safe = toError(err);
      this.logger.error({ err: safe, method: 'findByIdForUser', reportId: id, userId }, 'Failed to read the issue report');
      return { data: null, error: safe };
    }
  }
}

// Singleton instance for convenience
export const issueReportRepository = new IssueReportRepository();
