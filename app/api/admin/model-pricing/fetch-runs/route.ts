/**
 * /api/admin/model-pricing/fetch-runs: "Check provider prices" (AI model price
 * review slice 5; MP-FR-12 as amended by UF-1, SA RR-1, RR-2, RR-8, SC-8..SC-14).
 *
 * POST runs one round: it reads OpenAI's official pricing page and LiteLLM's
 * price list (the cross-check) in parallel, parses the page deterministically,
 * and stores the result as ONE `fetch` round of PENDING lines through the
 * existing submit RPC. Nothing here writes `ai_model_pricing` or
 * `ai_model_image_pricing`, and no charge changes until an admin applies a line
 * (slice 8). Anthropic, Google and Kimi are manual entry for now.
 *
 * GET returns, per monitored source (OpenAI and LiteLLM), the last run, the
 * last success and the last failure (RR-1 monitoring, SC-12).
 *
 * ── Shape ────────────────────────────────────────────────────────────────
 *   requireAdmin FIRST → strict Zod (POST: an empty object; GET: no query) →
 *   60 s refusal (409) → snapshot + two pinned fetches in parallel → parse,
 *   bounds, cross-check → submit RPC → audit AI_PRICE_FETCH_RUN (logAndFlush,
 *   counts and model ids only) → per-provider summary.
 *
 * ── Security ─────────────────────────────────────────────────────────────
 *   No URL, provider or model can be supplied (the body is an empty strict
 *   object). The two URLs are constants in `fetchSources.ts`. No page body is
 *   ever logged or audited. No secrets.
 *
 * ── Answers ──────────────────────────────────────────────────────────────
 *   200 the round is stored (a provider failure is still a 200: its outcome is
 *   in the summary) · 400 invalid body or query · 409 checked less than 60 s
 *   ago (`too_soon`, with Retry-After) or a concurrent submit (`conflict`) ·
 *   403 no active admin_users row · 500 anything else.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { isInputOnlyPricedModel } from '@/lib/ai/pricing';
import { lineContextFor, loadPricingSnapshot, tokenCoverage } from '@/lib/ai/pricing-research/comparisonModel';
import { buildFetchRound } from '@/lib/ai/pricing-research/fetchRound';
import { MODEL_ID_REGEX } from '@/lib/ai/pricing-research/pendingLineSchema';
import {
  manualProviders,
  sourceStatus,
  type FetchRunSummary,
  type FetchStatus,
} from '@/lib/ai/pricing-research/fetchOutcomes';
import {
  LITELLM_PRICES_URL,
  OPENAI_PRICING_PAGE_URL,
  PRICE_SOURCES,
  fetchLimited,
  settledToResult,
  type FetchResult,
} from '@/lib/ai/pricing-research/fetchSources';
import { logAndFlush } from '@/lib/audit/boundedAuditFlush';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { createLogger, type Logger } from '@/lib/logger';
import { aiPriceProposalRepository } from '@/lib/repositories/AiPriceProposalRepository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const logger = createLogger({ module: 'ModelPriceFetch' });
const ROUTE = '/api/admin/model-pricing/fetch-runs';

/** The double-click guard (RR-1): one round per 60 s. */
export const REFUSAL_WINDOW_MS = 60_000;

const FetchRunBodySchema = z.object({}).strict();
const NoQuerySchema = z.object({}).strict();

function devDetails(error: unknown): string | undefined {
  if (process.env.NODE_ENV !== 'development') return undefined;
  return error instanceof Error ? error.message : String(error);
}

function failure(status: number, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ success: false, error, ...extra }, { status });
}

/** One log line per source: never the body (RR-1). */
function logSource(requestLogger: Logger, provider: string, result: FetchResult, linesParsed: number | null) {
  const context = {
    provider,
    outcome: result.outcome,
    status: result.status,
    durationMs: result.durationMs,
    bytes: result.bytes,
    attempts: result.attempts,
    linesParsed,
  };
  if (result.outcome === 'ok') requestLogger.info(context, 'Price source read');
  else requestLogger.warn(context, 'Price source failed');
}

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, route: ROUTE });

  // FIRST statement: nothing above it reads the body, the database or the network.
  const gate = await requireAdmin(requestLogger);
  if (gate instanceof NextResponse) return gate;
  const adminId = gate.user.id;

  try {
    const raw = await request.text().catch(() => '');
    let body: unknown = {};
    if (raw.trim() !== '') {
      try {
        body = JSON.parse(raw);
      } catch {
        body = undefined;
      }
    }
    const parsedBody = FetchRunBodySchema.safeParse(body);
    if (!parsedBody.success) {
      requestLogger.warn({ adminUserId: adminId }, 'Rejected a price check with a body');
      return failure(400, 'This action takes no input.', { code: 'invalid_input' });
    }

    const latest = await aiPriceProposalRepository.latestFetchRound();
    if (latest.error) throw latest.error;
    if (latest.data) {
      // SA F-3: a database clock ahead of this server counts as "just now", never as "long ago".
      const elapsed = Math.max(0, Date.now() - Date.parse(latest.data.created_at));
      if (elapsed < REFUSAL_WINDOW_MS) {
        const retryAfterSeconds = Math.max(1, Math.ceil((REFUSAL_WINDOW_MS - elapsed) / 1000));
        requestLogger.info({ adminUserId: adminId, retryAfterSeconds }, 'Price check refused: too soon after the last one');
        const response = failure(
          409,
          `Prices were checked less than a minute ago. Try again in ${retryAfterSeconds} s.`,
          { code: 'too_soon', retryAfterSeconds }
        );
        response.headers.set('Retry-After', String(retryAfterSeconds));
        return response;
      }
    }

    const fetchedAt = new Date().toISOString();
    const checkedOn = fetchedAt.slice(0, 10);
    const [snapshot, settled] = await Promise.all([
      loadPricingSnapshot(),
      Promise.allSettled([fetchLimited(PRICE_SOURCES.openai), fetchLimited(PRICE_SOURCES.litellm)]),
    ]);
    const openai = settledToResult(settled[0]);
    const litellm = settledToResult(settled[1]);

    const openaiCoverage = [...tokenCoverage(snapshot)].flatMap((key) =>
      key.startsWith('openai:') ? [key.slice('openai:'.length)] : []
    );
    // SA F-1: coverage includes admin-typed settings. An id the line schema would
    // refuse (for example upper case) can never become a pending line, and in
    // `not_found` it would fail the strict outcomes schema and lose the round.
    const coverage = new Set(openaiCoverage.filter((model) => MODEL_ID_REGEX.test(model)));
    const dropped = openaiCoverage.filter((model) => !MODEL_ID_REGEX.test(model));
    if (dropped.length > 0) {
      requestLogger.warn({ dropped: dropped.length, models: dropped.slice(0, 20) }, 'Coverage ids that are not model ids were left out of the price check');
    }
    const round = buildFetchRound({
      openai,
      litellm,
      coverage,
      isInputOnly: (model) => isInputOnlyPricedModel('openai', model),
      contextFor: (line) => lineContextFor(snapshot, line),
      sourceUrl: OPENAI_PRICING_PAGE_URL,
      crossCheckSource: LITELLM_PRICES_URL,
      checkedOn,
      fetchedAt,
    });

    logSource(requestLogger, 'openai', openai, round.submitLines.length);
    logSource(requestLogger, 'litellm', litellm, null);
    if (round.failedAnchor) {
      requestLogger.warn({ provider: 'openai', anchor: round.failedAnchor }, 'OpenAI pricing page layout changed');
    }

    const { data: stored, error } = await aiPriceProposalRepository.submitFetchRound({
      adminUserId: adminId,
      providerOutcomes: round.providerOutcomes,
      lines: round.submitLines,
    });

    if (error || !stored) {
      const code = (error as { code?: string } | null)?.code;
      if (code === '23505') {
        requestLogger.warn({ adminUserId: adminId }, 'Price check collided with another submit');
        return failure(409, 'Another price for the same model was saved at the same moment. Try again.', { code: 'conflict' });
      }
      if (code === '42501') {
        requestLogger.warn({ adminUserId: adminId }, 'Price check refused: no active admin_users row for this admin');
        return failure(403, 'Your admin access is not recorded in the admin list, so prices cannot be saved.', {
          code: 'not_admin_row',
        });
      }
      requestLogger.error({ err: error, adminUserId: adminId }, 'Price check could not be stored');
      return failure(500, 'The provider prices could not be saved.', { details: devDetails(error) });
    }

    const outcomes = round.providerOutcomes;
    await logAndFlush(
      {
        action: AUDIT_EVENTS.AI_PRICE_FETCH_RUN,
        entityType: 'ai_pricing',
        entityId: stored.roundId,
        userId: adminId,
        actorId: adminId,
        severity: 'info',
        resourceName: 'Provider price check',
        details: {
          entity_kind: 'price_proposal',
          proposal_id: stored.roundId,
          correlationId,
          openai: {
            outcome: outcomes.openai.outcome,
            lines_stored: stored.lines.length,
            needs_manual_models: outcomes.openai.needs_manual.map((entry) => entry.model_name),
            not_found_models: outcomes.openai.not_found,
            refused_models: outcomes.openai.refused.map((entry) => entry.model_name),
          },
          litellm: {
            outcome: outcomes.litellm.outcome,
            agrees: outcomes.litellm.agrees,
            differs: outcomes.litellm.differs,
            not_listed: outcomes.litellm.not_listed,
            unavailable: outcomes.litellm.unavailable,
          },
          manual_providers: manualProviders(),
        },
        request,
      },
      requestLogger,
      { reason: 'provider price check', continues: 'the pending prices are stored' }
    );

    requestLogger.info(
      { adminUserId: adminId, roundId: stored.roundId, lineCount: stored.lines.length },
      'Provider price check stored as pending'
    );
    const data: FetchRunSummary = { roundId: stored.roundId, providerOutcomes: outcomes, problems: round.problems };
    return NextResponse.json({ success: true, data });
  } catch (error) {
    requestLogger.error({ err: error, adminUserId: adminId }, 'Provider price check failed');
    return failure(500, 'The provider prices could not be checked.', { details: devDetails(error) });
  }
}

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, route: ROUTE });

  // FIRST statement: nothing above it reads the query or the database.
  const gate = await requireAdmin(requestLogger);
  if (gate instanceof NextResponse) return gate;
  const adminId = gate.user.id;

  const parsed = NoQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!parsed.success) {
    return failure(400, 'This view takes no query parameters.', { code: 'invalid_input' });
  }

  try {
    const [latest, openaiOk, openaiFailed, litellmOk, litellmFailed] = await Promise.all([
      aiPriceProposalRepository.latestFetchRound(),
      aiPriceProposalRepository.latestFetchRoundByOutcome('openai', 'ok'),
      aiPriceProposalRepository.latestFetchRoundByOutcome('openai', 'not_ok'),
      aiPriceProposalRepository.latestFetchRoundByOutcome('litellm', 'ok'),
      aiPriceProposalRepository.latestFetchRoundByOutcome('litellm', 'not_ok'),
    ]);
    const failed = [latest, openaiOk, openaiFailed, litellmOk, litellmFailed].find((result) => result.error);
    if (failed) throw failed.error;

    const data: FetchStatus = {
      lastRunAt: latest.data?.created_at ?? null,
      openai: sourceStatus('openai', latest.data, openaiOk.data, openaiFailed.data),
      litellm: sourceStatus('litellm', latest.data, litellmOk.data, litellmFailed.data),
      manualProviders: manualProviders(),
    };
    requestLogger.debug({ adminUserId: adminId, lastRunAt: data.lastRunAt }, 'Price check status read');
    return NextResponse.json({ success: true, data });
  } catch (error) {
    requestLogger.error({ err: error, adminUserId: adminId }, 'Price check status read failed');
    return failure(500, 'The provider price check status could not be loaded.', { details: devDetails(error) });
  }
}
