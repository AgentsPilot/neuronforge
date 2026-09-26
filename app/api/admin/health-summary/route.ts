/**
 * GET /api/admin/health-summary — the admin Health landing (admin
 * reorganisation slice 4).
 *
 * One screen of red / amber / grey tiles built ONLY from signals that already
 * exist: Business OS AI settings, audited AI failures, Business OS AI spend,
 * critical audit events and the entitlements mode. Scheduled jobs and queues
 * are "Not measured yet". Nothing is ever green.
 *
 * ── Shape ────────────────────────────────────────────────────────────────
 *   requireAdmin FIRST → strict Zod (the route takes no input) → every read in
 *   parallel, each under its own deadline → numbers → the pure evaluator.
 * A failed or late read makes ITS tile `unavailable`; it never makes a tile
 * "Normal" and never fails the page.
 *
 * ── Cross-account reads (why the service role is fine here) ───────────────
 * The spend and audit reads span every account on purpose: "how many AI actions
 * failed platform-wide" has no per-tenant answer. They go through admin-only
 * repository methods whose names say "AllAccounts", which only `app/api/admin/**`
 * may call (source guards), and this handler is gated before any of them runs.
 * The response carries counts, sums, area labels, the mode word and fixed
 * sentences: no email, no owner text, no audit `details`, no error text (C-7).
 *
 * ── Spend (F-1, OI-P1) ────────────────────────────────────────────────────
 * PostgREST aggregates are disabled on this project, so spend is a paged read of
 * three narrow columns with a ceiling, plus an exact count. A window the read
 * could not fully cover is shown as "at least $X" (C-1); it is never exact by
 * accident. `token_usage` has no index for a cross-account window yet, so each
 * page is a scan: the per-read timings logged below are how that is watched
 * (workplan §7).
 *
 * @see docs/workplans/ADMIN_MODULE_BOS_REORGANISATION_SLICE4_WORKPLAN.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { bosRowFilter } from '@/lib/business-os/llm/callCatalog';
import { buildAdminSettingsView } from '@/lib/business-os/llm/adminSettingsView';
import { getEntitlementModeSetting } from '@/lib/business-os/entitlements/mode';
import {
  adminTokenUsageAnalyticsRepository,
  ADMIN_HEALTH_READ_LIMITS,
} from '@/lib/repositories/AdminTokenUsageAnalyticsRepository';
import { auditTrailRepository } from '@/lib/repositories/AuditTrailRepository';
import { areaOffSummary } from '@/app/admin/business-os-llm/areaState';
import {
  buildHealthSummary,
  type CriticalFacts,
  type EntitlementFacts,
  type FailureFacts,
  type HealthRead,
  type SettingsFacts,
  type SpendFacts,
} from '@/lib/admin/health/evaluateHealth';
import { computeHealthWindows, summariseSpend, type HealthWindows } from '@/lib/admin/health/windows';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'AdminHealthSummaryAPI' });
const ROUTE = '/api/admin/health-summary';

/**
 * The route takes no input. Strict, so no parameter can ever start to mean
 * something silently (F-9). The page refreshes with `cache: 'no-store'`, never
 * with a cache-busting parameter, or this would 400 it.
 */
const HealthSummaryQuerySchema = z.object({}).strict();

/** Per-read deadline (F-4, C-4). A read past it makes its tile `unavailable`. */
const HEALTH_READ_DEADLINE_MS = 5000;

class ReadDeadlineError extends Error {
  constructor() {
    super('Read deadline passed');
    this.name = 'ReadDeadlineError';
  }
}

type RepoResult<T> = { data: T | null; error: Error | null };

interface ReadTiming {
  read: string;
  ms: number;
  ok: boolean;
  /** An error CLASS, never a message (C-7). */
  failure?: string;
  rows?: number;
  pages?: number;
}

/**
 * Run one read under a deadline. The signal is handed to the read so paging
 * stops (not only the wait) once the deadline passes (C-4). The timer is always
 * cleared, and a read that settles after its deadline is swallowed, never an
 * unhandled rejection.
 */
async function underDeadline<T>(
  read: string,
  timings: ReadTiming[],
  run: (signal: AbortSignal) => Promise<RepoResult<T>>
): Promise<HealthRead<T>> {
  const started = Date.now();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ReadDeadlineError());
    }, HEALTH_READ_DEADLINE_MS);
  });
  deadline.catch(() => undefined);

  let work: Promise<RepoResult<T>>;
  try {
    work = run(controller.signal);
  } catch (error) {
    work = Promise.reject(error);
  }
  work.catch(() => undefined);

  try {
    const result = await Promise.race([work, deadline]);
    if (result.error || result.data === null) {
      timings.push({ read, ms: Date.now() - started, ok: false, failure: result.error?.name ?? 'NoData' });
      return { ok: false };
    }
    timings.push({ read, ms: Date.now() - started, ok: true });
    return { ok: true, value: result.data };
  } catch (error) {
    timings.push({
      read,
      ms: Date.now() - started,
      ok: false,
      failure: error instanceof Error ? error.name : 'Unknown',
    });
    return { ok: false };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Wrap a promise that does not return `{ data, error }` (the settings view). */
async function asRepoResult<T>(promise: Promise<T>): Promise<RepoResult<T>> {
  try {
    return { data: await promise, error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error : new Error('Read failed') };
  }
}

async function readSettings(timings: ReadTiming[]): Promise<HealthRead<SettingsFacts>> {
  const view = await underDeadline('settings', timings, () => asRepoResult(buildAdminSettingsView()));
  if (!view.ok) return view;

  // The reduction runs AFTER the read succeeded, so it has its own guard: a view
  // of an unexpected shape makes only the settings tile unavailable, never a 500
  // for the whole page (§5.1 per-read isolation; SA code review 1, QA B-1).
  try {
    const facts: SettingsFacts = { areasOff: 0, callsOff: 0, ignored: 0, adjusted: 0, offAreas: [], ignoredAreas: [] };
    for (const area of view.value.areas) {
      const { areaShowsOff, offCalls } = areaOffSummary(area);
      if (areaShowsOff) {
        facts.areasOff += 1;
        facts.offAreas.push(area.area);
      }
      facts.callsOff += offCalls;
      // Issue kinds other than `adjusted` mean the resolver IGNORED a stored
      // setting; `adjusted` means it was accepted and changed by a model rule.
      const issues = [...area.areaIssues, ...area.calls.flatMap((call) => call.issues)];
      const ignored = issues.filter((issue) => issue.kind !== 'adjusted').length;
      facts.ignored += ignored;
      facts.adjusted += issues.length - ignored;
      if (ignored > 0) facts.ignoredAreas.push(area.area);
    }
    return { ok: true, value: facts };
  } catch (error) {
    const timing = timings.find((t) => t.read === 'settings');
    if (timing) {
      timing.ok = false;
      timing.failure = error instanceof Error ? error.name : 'Unknown';
    }
    return { ok: false };
  }
}

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, route: ROUTE });

  // FIRST statement. Nothing above it reads a body, the database, a queue or
  // sends anything; the gate owns the 401/403 split and fails closed.
  const gate = await requireAdmin(requestLogger);
  if (gate instanceof NextResponse) return gate;
  const adminId = gate.user.id;

  try {
    // After the gate, before any read: 401/403 always win over 400.
    const parsed = HealthSummaryQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) {
      requestLogger.warn({ adminUserId: adminId }, 'Rejected a health summary request with query parameters');
      return NextResponse.json(
        {
          success: false,
          error: 'This endpoint takes no parameters',
          details: process.env.NODE_ENV === 'development' ? parsed.error.issues[0]?.message : undefined,
        },
        { status: 400 }
      );
    }

    const started = Date.now();
    // The clock is read ONCE; every window and link derives from it (C-3).
    const windows: HealthWindows = computeHealthWindows(new Date());
    const end = windows.end.toISOString();
    const last24hStart = windows.last24hStart.toISOString();
    const last7dStart = windows.last7dStart.toISOString();
    const spendWindow = { start: windows.previous7dStart.toISOString(), end };
    const context = { correlationId, adminId };
    const bosFilter = { featureFilter: bosRowFilter() };
    const timings: ReadTiming[] = [];

    const auditCount = (
      read: string,
      filter: { action?: (typeof AUDIT_EVENTS)[keyof typeof AUDIT_EVENTS]; severity?: 'critical' },
      start: string
    ) =>
      underDeadline(read, timings, (signal) =>
        auditTrailRepository.countAdminEventsAllAccountsInWindow(context, filter, { start, end }, { signal })
      );

    const [settings, failed24h, failed7d, completed24h, critical24h, critical7d, spendCount, spendRows] =
      await Promise.all([
        readSettings(timings),
        auditCount('failed24h', { action: AUDIT_EVENTS.BUSINESS_AI_ACTION_FAILED }, last24hStart),
        auditCount('failed7d', { action: AUDIT_EVENTS.BUSINESS_AI_ACTION_FAILED }, last7dStart),
        auditCount('completed24h', { action: AUDIT_EVENTS.BUSINESS_AI_ACTION_COMPLETED }, last24hStart),
        auditCount('critical24h', { severity: 'critical' }, last24hStart),
        auditCount('critical7d', { severity: 'critical' }, last7dStart),
        underDeadline('spendCount', timings, (signal) =>
          adminTokenUsageAnalyticsRepository.countAllAccountsInWindow(context, spendWindow, bosFilter, { signal })
        ),
        underDeadline('spendRows', timings, (signal) =>
          adminTokenUsageAnalyticsRepository.listCostPointsAllAccountsInWindow(context, spendWindow, bosFilter, {
            pageSize: ADMIN_HEALTH_READ_LIMITS.PAGE_SIZE,
            ceiling: ADMIN_HEALTH_READ_LIMITS.CEILING,
            signal,
          })
        ),
      ]);

    const failures: HealthRead<FailureFacts> =
      failed24h.ok && failed7d.ok && completed24h.ok
        ? { ok: true, value: { failed24h: failed24h.value, failed7d: failed7d.value, completed24h: completed24h.value } }
        : { ok: false };

    const critical: HealthRead<CriticalFacts> =
      critical24h.ok && critical7d.ok
        ? { ok: true, value: { last24h: critical24h.value, last7d: critical7d.value } }
        : { ok: false };

    // C-4: the page read failing → the tile is unavailable. Only the count
    // failing → the figures still follow C-1 (natural completion proves
    // exactness), with no "N calls" and no OI-P1 note.
    let spend: HealthRead<SpendFacts> = { ok: false };
    if (spendRows.ok) {
      const page = spendRows.value;
      const spendTiming = timings.find((t) => t.read === 'spendRows');
      if (spendTiming) {
        spendTiming.rows = page.rows.length;
        spendTiming.pages = page.pages;
      }
      spend = {
        ok: true,
        value: { sums: summariseSpend(page.rows, windows, page.completed), callsKnown: spendCount.ok },
      };
      if (spendCount.ok && page.completed && spendCount.value !== page.rows.length) {
        // Rows written between the two reads, or a paging anomaly. Logged, not shown.
        requestLogger.warn(
          { counted: spendCount.value, read: page.rows.length },
          'Health spend: exact count and rows read disagree'
        );
      }
    }

    let entitlements: HealthRead<EntitlementFacts> = { ok: false };
    try {
      const setting = getEntitlementModeSetting();
      entitlements = { ok: true, value: { effective: setting.effective, refused: setting.refused } };
    } catch (error) {
      requestLogger.error({ err: error }, 'Health: entitlements mode could not be read');
    }

    const summary = buildHealthSummary(
      { windows, settings, failures, spend, critical, entitlements },
      new Date(),
      {
        onRuleError: (report) =>
          requestLogger.error(
            { tile: report.tile, ruleId: report.ruleId, reason: report.reason },
            'Health rule list is invalid; the tile is shown as unavailable'
          ),
      }
    );

    // Counts and timings only: no row values, names or messages (C-7).
    requestLogger.info(
      {
        adminUserId: adminId,
        totalMs: Date.now() - started,
        reads: timings,
        statuses: summary.tiles.map((tile) => ({ tile: tile.id, status: tile.status, rule: tile.matchedRuleId })),
      },
      'Health summary served'
    );

    return NextResponse.json({ success: true, data: summary });
  } catch (error) {
    requestLogger.error({ err: error, adminUserId: adminId }, 'Health summary failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Could not build the health summary',
        details:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : String(error)
            : undefined,
      },
      { status: 500 }
    );
  }
}
