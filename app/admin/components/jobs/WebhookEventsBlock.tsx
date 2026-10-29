'use client';

/**
 * The "Stripe webhook events" block of the Scheduled jobs & queues page (plan
 * payments P-8b.3b, AM-4; workplan "Plan: P-8b.3" D3-5, SA rulings P3-SA-2
 * items 1 to 3 and 7, P3-SA-7, P3-SA-9).
 *
 * READ-ONLY. It owns exactly one request, a GET to the literal URL with no
 * query, and renders only what that route sent. It imports no registry,
 * repository or server module at runtime (C-21: the payload types come in by
 * `import type`). Its words live in `./webhookEventsCopy`.
 *
 * It has its own loading, error and empty states, and the view renders it
 * OUTSIDE the jobs read's `{view && …}` gate, so a failed jobs read never
 * hides webhook health (P3-SA-7). `refreshKey` is bumped by the page's
 * Refresh; P-8b.3c will also bump it after a plan reconcile press (Q-P3-4).
 *
 * KPI-first: three block KPIs on the KpiStrip grid (Failed, lagging; Stuck,
 * leading; Oldest unfinished, leading), then the list as the breakdown,
 * oldest first. No drawer: each row links out to the event in Stripe.
 */

import { useCallback, useEffect, useState } from 'react';

import { clientLogger } from '@/lib/logger/client';
import { AdminEmpty, AdminError, AdminLoading } from '@/app/admin/components/layout/AdminStates';
import { ADMIN_NETWORK_ERROR, readAdminResponse } from '@/app/admin/components/layout/readAdminResponse';
import { formatCount, formatUtc } from '@/app/admin/components/layout/adminFormat';
import { BlockKpi } from '@/app/admin/components/layout/BlockKpi';
import { KpiStrip } from '@/app/admin/components/layout/KpiStrip';
import { StatusChip } from '@/app/admin/components/layout/StatusChip';
import {
  ADMIN_COUNT_LINE,
  ADMIN_TABLE,
  ADMIN_TABLE_WRAP,
  ADMIN_TBODY,
  ADMIN_TD,
  ADMIN_TD_ID,
  ADMIN_TH,
  ADMIN_THEAD,
} from '@/app/admin/components/layout/adminTable';
import { MODE_BADGE } from '@/app/admin/finance/plansCopy';
import { ageWords } from './jobsFormat';
import {
  WEBHOOK_AT_LEAST,
  WEBHOOK_COLUMNS,
  WEBHOOK_COUNT_LINE,
  WEBHOOK_CREATED_NOT_RECORDED,
  WEBHOOK_EMPTY,
  WEBHOOK_EVENT_LINK_LABEL,
  WEBHOOK_EVENTS_INTRO,
  WEBHOOK_EVENTS_TITLE,
  WEBHOOK_EVENTS_WHAT,
  WEBHOOK_FAILURE_WORDS,
  WEBHOOK_KPI_DEFINITIONS,
  WEBHOOK_KPI_LABELS,
  WEBHOOK_KPI_NEEDS_ACTION,
  WEBHOOK_NO_EVENT_TYPE,
  WEBHOOK_NO_MODE_LINE,
  WEBHOOK_OLDEST_NONE,
  WEBHOOK_ORDER_PARTIAL,
  WEBHOOK_STATE_WORDS,
} from './webhookEventsCopy';
import type { WebhookEventRowView, WebhookEventsPayload } from '@/lib/admin/jobs/webhookEventsTypes';

const logger = clientLogger.child({ module: 'AdminWebhookEventsBlock' });

/** Red at 1 or more: the tile repeats the rows' own state and adds no threshold (K-5 (i)). */
function redChip(count: number) {
  return count >= 1 ? { tone: 'danger' as const, label: WEBHOOK_KPI_NEEDS_ACTION } : null;
}

function oldestValue(data: WebhookEventsPayload): string {
  if (data.tiles.oldestAgeMinutes === null) return WEBHOOK_OLDEST_NONE;
  const words = ageWords(data.tiles.oldestAgeMinutes);
  return data.tiles.oldestAtLeast ? WEBHOOK_AT_LEAST(words) : words;
}

function failureWords(row: WebhookEventRowView, staleAfterMinutes: number): string {
  return row.failureClass === 'stuck'
    ? WEBHOOK_FAILURE_WORDS.stuck(staleAfterMinutes)
    : WEBHOOK_FAILURE_WORDS[row.failureClass];
}

function EventRow({ row, staleAfterMinutes }: { row: WebhookEventRowView; staleAfterMinutes: number }) {
  return (
    <tr data-testid={`webhook-row-${row.eventId}`}>
      <td className={`${ADMIN_TD} font-mono text-xs text-slate-200`}>{row.eventType ?? WEBHOOK_NO_EVENT_TYPE}</td>
      <td className={ADMIN_TD}>
        <StatusChip tone="danger" testId="webhook-state">
          {WEBHOOK_STATE_WORDS[row.state]}
        </StatusChip>
      </td>
      <td className={`${ADMIN_TD} text-xs`} data-testid="webhook-failure">
        {failureWords(row, staleAfterMinutes)}
      </td>
      <td className={`${ADMIN_TD} text-xs`}>
        {row.createdAt ? formatUtc(row.createdAt) : <span className="text-slate-400">{WEBHOOK_CREATED_NOT_RECORDED}</span>}
      </td>
      <td className={`${ADMIN_TD} text-xs`}>{formatUtc(row.lastAttemptAt)}</td>
      <td className={`${ADMIN_TD} text-xs tabular-nums`}>{ageWords(row.ageMinutes)}</td>
      <td className={`${ADMIN_TD} ${ADMIN_TD_ID}`}>
        {row.dashboardUrl ? (
          <a
            href={row.dashboardUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={WEBHOOK_EVENT_LINK_LABEL(row.eventId)}
            className="text-purple-300 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
          >
            {row.eventId}
          </a>
        ) : (
          row.eventId
        )}
      </td>
    </tr>
  );
}

export function WebhookEventsBlock({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<WebhookEventsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Only the fetch sits inside this try: a rejection here is a network failure.
      let response: Response;
      try {
        response = await fetch('/api/admin/jobs-queues/webhook-events', { cache: 'no-store' });
      } catch (err) {
        logger.error({ err }, 'Could not reach the webhook events route');
        setError(ADMIN_NETWORK_ERROR);
        return;
      }
      // A 409 shows the route's own words for an unknown Stripe mode (rule 1).
      const result = await readAdminResponse<WebhookEventsPayload>(response, {
        what: WEBHOOK_EVENTS_WHAT,
        sessionEndedCopy: true,
      });
      if (!result.ok) {
        logger.error({ status: result.status }, 'Failed to load the webhook events');
        // On failure the previous figures stay on screen (the jobs view's SA Q-11 rule).
        setError(result.message);
        return;
      }
      setData(result.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <section id="webhooks" aria-labelledby="webhooks-title" data-testid="webhook-events" className="space-y-3">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="webhooks-title" className="text-sm font-semibold text-white">
            {WEBHOOK_EVENTS_TITLE}
          </h2>
          {data && (
            <StatusChip tone="neutral" testId="webhook-events-mode">
              {MODE_BADGE[data.mode]}
            </StatusChip>
          )}
        </div>
        <p className="text-xs text-slate-400">{WEBHOOK_EVENTS_INTRO}</p>
      </header>

      {error && <AdminError message={error} testId="webhook-events-error" onRetry={() => void load()} />}

      {!data && loading && <AdminLoading what={WEBHOOK_EVENTS_WHAT} />}

      {data && (
        <div aria-busy={loading} className="space-y-3">
          <KpiStrip>
            <BlockKpi
              label={WEBHOOK_KPI_LABELS.failed}
              value={formatCount(data.tiles.failed)}
              chip={redChip(data.tiles.failed)}
              indicator={{ kind: 'lagging', definition: WEBHOOK_KPI_DEFINITIONS.failed }}
              testId="webhook-kpi-failed"
            />
            <BlockKpi
              label={WEBHOOK_KPI_LABELS.stuck}
              value={formatCount(data.tiles.stuck)}
              chip={redChip(data.tiles.stuck)}
              indicator={{ kind: 'leading', definition: WEBHOOK_KPI_DEFINITIONS.stuck(data.staleAfterMinutes) }}
              testId="webhook-kpi-stuck"
            />
            <BlockKpi
              label={WEBHOOK_KPI_LABELS.oldest}
              value={oldestValue(data)}
              indicator={{ kind: 'leading', definition: WEBHOOK_KPI_DEFINITIONS.oldest }}
              testId="webhook-kpi-oldest"
            />
          </KpiStrip>

          {data.noMode > 0 && (
            <p className={ADMIN_COUNT_LINE} data-testid="webhook-no-mode">
              {WEBHOOK_NO_MODE_LINE(data.noMode, formatCount(data.noMode))}
            </p>
          )}

          {data.rows.length === 0 ? (
            <AdminEmpty message={WEBHOOK_EMPTY(MODE_BADGE[data.mode])} testId="webhook-events-empty" />
          ) : (
            <>
              <div className={ADMIN_TABLE_WRAP}>
                <table className={ADMIN_TABLE}>
                  <thead className={ADMIN_THEAD}>
                    <tr>
                      <th scope="col" className={ADMIN_TH}>{WEBHOOK_COLUMNS.eventType}</th>
                      <th scope="col" className={ADMIN_TH}>{WEBHOOK_COLUMNS.state}</th>
                      <th scope="col" className={ADMIN_TH}>{WEBHOOK_COLUMNS.failure}</th>
                      <th scope="col" className={ADMIN_TH}>{WEBHOOK_COLUMNS.created}</th>
                      <th scope="col" className={ADMIN_TH}>{WEBHOOK_COLUMNS.lastAttempt}</th>
                      <th scope="col" className={ADMIN_TH}>{WEBHOOK_COLUMNS.age}</th>
                      <th scope="col" className={ADMIN_TH}>{WEBHOOK_COLUMNS.event}</th>
                    </tr>
                  </thead>
                  <tbody className={ADMIN_TBODY}>
                    {data.rows.map((row) => (
                      <EventRow key={row.eventId} row={row} staleAfterMinutes={data.staleAfterMinutes} />
                    ))}
                  </tbody>
                </table>
              </div>
              <p className={ADMIN_COUNT_LINE} data-testid="webhook-count-line">
                {WEBHOOK_COUNT_LINE(formatCount(data.listed), formatCount(data.matching))}
                {data.tiles.oldestAtLeast ? ` ${WEBHOOK_ORDER_PARTIAL(formatCount(data.readPerState))}` : ''}
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
