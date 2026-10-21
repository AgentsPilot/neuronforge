'use client';

/**
 * The body of the price history drawer (AI model price review slice 9;
 * MP-FR-17, UF-4, SA RR-6). The page owns the read (`useDrawerResource` with
 * `readPriceHistory`) and passes its state here; this component only prints.
 *
 * Per unit (one for tokens; one per size and quality for images) a small table
 * of every stored price, newest first, and under each price who changed it and
 * why, exactly as the server classified it: applied (with the batch and its
 * margin review), the record missing, the emergency runbook, the old audit,
 * or no record. Never an invented actor, never a status by colour alone
 * (MP-NFR-8). Prices are printed as the server's decimal strings; nothing here
 * parses or rounds a number. Read only: no button here changes anything.
 */

import { Fragment } from 'react';

import type {
  HistoryActor,
  PriceHistoryData,
  PriceHistoryProvenance,
  PriceHistoryRow,
  PriceHistoryUnit,
} from '@/lib/ai/pricing-research/priceHistorySchema';

import { AdminError, AdminLoading, AdminNotice } from '@/app/admin/components/layout/AdminStates';
import { StatusChip, type StatusTone } from '@/app/admin/components/layout/StatusChip';
import { formatCount, formatUtc, formatUtcDate } from '@/app/admin/components/layout/adminFormat';
import { ADMIN_TABLE, ADMIN_TABLE_WRAP, ADMIN_TBODY, ADMIN_TD, ADMIN_TD_NUM, ADMIN_TH, ADMIN_TH_NUM, ADMIN_THEAD } from '@/app/admin/components/layout/adminTable';
import type { DrawerResourceState } from '@/app/admin/components/layout/useDrawerResource';
import { HISTORY_WORDS } from '@/app/admin/system-config/priceReviewCopy';

const LINE = 'text-xs text-slate-300';
const NOTE = 'text-xs text-slate-400';

function actorWords(actor: HistoryActor): string {
  if (actor.kind === 'admin') return actor.email;
  if (actor.kind === 'not_recorded') return HISTORY_WORDS.actorNotRecorded;
  return actor.kind === 'system' ? HISTORY_WORDS.actorSystem : HISTORY_WORDS.actorNotListed;
}

function price(value: string | null): string {
  return value === null ? HISTORY_WORDS.notReadable : value;
}

const STATUS: Record<PriceHistoryRow['status'], { tone: StatusTone; words: (row: PriceHistoryRow) => string }> = {
  current: { tone: 'ok', words: () => HISTORY_WORDS.current },
  starts_later: { tone: 'info', words: (row) => `${HISTORY_WORDS.startsLater} ${formatUtcDate(row.effectiveDate)}` },
  not_charged: { tone: 'neutral', words: () => HISTORY_WORDS.notCharged },
  retired: { tone: 'neutral', words: () => HISTORY_WORDS.retired },
};

function cachedCell(row: PriceHistoryRow): string {
  if (row.prices.kind !== 'token') return '';
  switch (row.prices.cachedNote) {
    case 'stored':
      return price(row.prices.cachedInputPer1m);
    case 'half_of_input':
      return HISTORY_WORDS.cachedHalf;
    case 'stored_not_used':
      return `${price(row.prices.cachedInputPer1m)} (${HISTORY_WORDS.cachedNotUsed})`;
    case 'unreadable':
      return HISTORY_WORDS.notReadable;
    default:
      return '—';
  }
}

function ProvenanceLines({ provenance, row }: { provenance: PriceHistoryProvenance; row: PriceHistoryRow }) {
  switch (provenance.kind) {
    case 'applied': {
      const batch = provenance.batch;
      const others = batch ? batch.lineCount - 1 : 0;
      return (
        <>
          <p className={LINE}>{`${HISTORY_WORDS.appliedBy} ${actorWords(provenance.appliedBy)} ${HISTORY_WORDS.on} ${formatUtc(provenance.appliedAt)}.`}</p>
          <p className={LINE}>{`${HISTORY_WORDS.reason} ${provenance.reason}`}</p>
          {provenance.overrideReason !== null && <p className={LINE}>{`${HISTORY_WORDS.overrideReason} ${provenance.overrideReason}`}</p>}
          <p className={LINE}>
            {`${HISTORY_WORDS.source} `}
            <a href={provenance.sourceUrl} target="_blank" rel="noopener noreferrer" className="break-all text-purple-300 underline">
              {provenance.sourceUrl}
            </a>
            {` (${HISTORY_WORDS.checked} ${formatUtcDate(provenance.checkedOn)}).`}
          </p>
          <p className={LINE}>
            {`${HISTORY_WORDS.enteredBy} ${actorWords(provenance.enteredBy)}, ${
              provenance.entrySource === 'manual' ? HISTORY_WORDS.byHand : provenance.entrySource === 'fetch' ? HISTORY_WORDS.byCheck : HISTORY_WORDS.howUnknown
            }.`}
          </p>
          {batch && (
            <p className={LINE}>
              {others > 0 ? `${HISTORY_WORDS.batchTogether} ${formatCount(others)} ${others === 1 ? HISTORY_WORDS.batchOther : HISTORY_WORDS.batchOthers}` : HISTORY_WORDS.batchOne}{' '}
              {batch.marginReview === 'not_needed'
                ? HISTORY_WORDS.marginNotNeeded
                : batch.marginReview === 'open'
                  ? HISTORY_WORDS.marginOpen
                  : `${HISTORY_WORDS.marginDone} ${batch.reviewedBy ? actorWords(batch.reviewedBy) : HISTORY_WORDS.actorNotListed} ${HISTORY_WORDS.on} ${formatUtc(batch.reviewedAt)}: ${batch.reviewNote ?? ''}`}
            </p>
          )}
        </>
      );
    }
    case 'provenance_missing':
      return <p className="text-xs text-amber-200">{HISTORY_WORDS.provenanceMissing}</p>;
    case 'runbook':
      return (
        <>
          <p className={LINE}>{HISTORY_WORDS.runbook}</p>
          <p className={NOTE}>{`${HISTORY_WORDS.runbookReference} ${row.rowId}, ${HISTORY_WORDS.written} ${formatUtc(row.createdAt)}.`}</p>
        </>
      );
    case 'audit':
      return (
        <>
          <p className={LINE}>{HISTORY_WORDS.auditIntro}</p>
          <ul className="list-disc space-y-1 pl-5">
            {provenance.events.map((event, index) => {
              const verb = event.action === 'created' ? HISTORY_WORDS.created : event.action === 'updated' ? HISTORY_WORDS.updated : HISTORY_WORDS.zeroSet;
              const values =
                event.inputPer1m === null && event.outputPer1m === null
                  ? HISTORY_WORDS.valuesNotRecorded
                  : `${HISTORY_WORDS.input} ${event.beforeInputPer1m !== null ? `${HISTORY_WORDS.fromValue} ${event.beforeInputPer1m} ${HISTORY_WORDS.toValue} ` : ''}${event.inputPer1m ?? HISTORY_WORDS.notRecorded}, ${HISTORY_WORDS.output} ${
                      event.beforeOutputPer1m !== null ? `${HISTORY_WORDS.fromValue} ${event.beforeOutputPer1m} ${HISTORY_WORDS.toValue} ` : ''
                    }${event.outputPer1m ?? HISTORY_WORDS.notRecorded} (${HISTORY_WORDS.asRecorded})`;
              return (
                <li key={`${event.at}-${index}`} className={LINE}>
                  {`${verb} ${HISTORY_WORDS.by} ${actorWords(event.by)} ${HISTORY_WORDS.on} ${formatUtc(event.at)}: ${values}.`}
                </li>
              );
            })}
          </ul>
        </>
      );
    default:
      return <p className={LINE}>{HISTORY_WORDS.none}</p>;
  }
}

function RowDetails({ row }: { row: PriceHistoryRow }) {
  return (
    <div className="space-y-1" data-testid={`history-details-${row.rowId}`}>
      {row.neverCharged && <p className={NOTE}>{HISTORY_WORDS.neverCharged}</p>}
      {row.prices.storedAsZero && <p className="text-xs text-amber-200">{HISTORY_WORDS.storedAsZero}</p>}
      <div data-testid={`history-provenance-${row.rowId}`} className="space-y-1">
        <ProvenanceLines provenance={row.provenance} row={row} />
      </div>
      {row.retirement && (
        <p className={NOTE} data-testid={`history-retirement-${row.rowId}`}>
          {row.retirement.kind === 'cleanup'
            ? HISTORY_WORDS.cleanup
            : row.retirement.kind === 'replaced'
              ? HISTORY_WORDS.replaced
              : HISTORY_WORDS.retiredNoRecord}
        </p>
      )}
      {row.preReviewNote && <p className={NOTE}>{HISTORY_WORDS.preReview}</p>}
      {row.syncRuns.map((run, index) => (
        <p key={`${run.at}-${index}`} className={NOTE} data-testid="history-sync-run">
          {`${HISTORY_WORDS.syncRan} ${formatUtc(run.at)} ${HISTORY_WORDS.by} ${actorWords(run.by)}${
            run.modelsUpdated !== null || run.modelsAdded !== null
              ? ` (${formatCount(run.modelsUpdated ?? 0)} ${HISTORY_WORDS.syncUpdated}, ${formatCount(run.modelsAdded ?? 0)} ${HISTORY_WORDS.syncAdded})`
              : ''
          } ${HISTORY_WORDS.syncNote}`}
        </p>
      ))}
      {row.moreSyncRuns > 0 && <p className={NOTE}>{`${HISTORY_WORDS.syncMore} ${formatCount(row.moreSyncRuns)} ${HISTORY_WORDS.syncMoreTail}`}</p>}
    </div>
  );
}

function UnitTable({ unit, kind }: { unit: PriceHistoryUnit; kind: PriceHistoryData['kind'] }) {
  const heading = kind === 'image' ? `${HISTORY_WORDS.image} ${unit.size ?? ''} ${unit.quality ?? ''}` : HISTORY_WORDS.tokens;
  const columns = kind === 'image' ? 3 : 5;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-100">{heading}</h3>
      <div className={ADMIN_TABLE_WRAP}>
        <table className={ADMIN_TABLE}>
          <caption className="sr-only">{`${HISTORY_WORDS.title}: ${heading}`}</caption>
          <thead className={ADMIN_THEAD}>
            <tr>
              <th scope="col" className={ADMIN_TH}>
                {HISTORY_WORDS.inEffect}
              </th>
              {kind === 'image' ? (
                <th scope="col" className={ADMIN_TH_NUM}>
                  {HISTORY_WORDS.perImage}
                </th>
              ) : (
                <>
                  <th scope="col" className={ADMIN_TH_NUM}>
                    {HISTORY_WORDS.input}
                  </th>
                  <th scope="col" className={ADMIN_TH_NUM}>
                    {HISTORY_WORDS.output}
                  </th>
                  <th scope="col" className={ADMIN_TH_NUM}>
                    {HISTORY_WORDS.cached}
                  </th>
                </>
              )}
              <th scope="col" className={ADMIN_TH}>
                {HISTORY_WORDS.status}
              </th>
            </tr>
          </thead>
          <tbody className={ADMIN_TBODY}>
            {unit.rows.map((row) => (
              <Fragment key={row.rowId}>
                <tr data-testid={`history-row-${row.rowId}`}>
                  <td className={ADMIN_TD}>
                    <span className="block whitespace-nowrap">{`${HISTORY_WORDS.from} ${formatUtcDate(row.effectiveDate)}`}</span>
                    {row.replacedOn !== null && <span className="block whitespace-nowrap text-slate-400">{`${HISTORY_WORDS.until} ${formatUtcDate(row.replacedOn)}`}</span>}
                    <span className="block text-[11px] text-slate-500">{`${HISTORY_WORDS.storedOn} ${row.createdAt === null ? HISTORY_WORDS.notRecorded : formatUtc(row.createdAt)}`}</span>
                  </td>
                  {row.prices.kind === 'image' ? (
                    <td className={ADMIN_TD_NUM}>{price(row.prices.perImage)}</td>
                  ) : (
                    <>
                      <td className={ADMIN_TD_NUM}>{price(row.prices.inputPer1m)}</td>
                      <td className={ADMIN_TD_NUM}>{price(row.prices.outputPer1m)}</td>
                      <td className={`${ADMIN_TD} text-right text-xs`}>{cachedCell(row)}</td>
                    </>
                  )}
                  <td className={ADMIN_TD}>
                    <StatusChip tone={STATUS[row.status].tone} testId={`history-status-${row.rowId}`}>
                      {STATUS[row.status].words(row)}
                    </StatusChip>
                  </td>
                </tr>
                <tr>
                  <td colSpan={columns} className={`${ADMIN_TD} pb-4`}>
                    <RowDetails row={row} />
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export interface PriceHistoryDrawerBodyProps {
  state: DrawerResourceState<PriceHistoryData>;
  /** How the model is charged today when nothing is stored (the comparison row's basis), for the empty state. */
  emptyBasis: string | null;
}

export function PriceHistoryDrawerBody({ state, emptyBasis }: PriceHistoryDrawerBodyProps) {
  if (state.kind === 'idle') return null;
  if (state.kind === 'loading') return <AdminLoading what={HISTORY_WORDS.reading} />;
  if (state.kind === 'error') return <AdminError message={state.message} testId="price-history-error" />;

  const data = state.data;
  return (
    <div className="space-y-4" data-testid="price-history-body">
      <p className={NOTE}>{HISTORY_WORDS.readOnly}</p>
      {data.truncated && <AdminNotice testId="history-truncated">{HISTORY_WORDS.truncated}</AdminNotice>}
      {data.auditTruncated && <AdminNotice testId="history-audit-truncated">{HISTORY_WORDS.auditTruncated}</AdminNotice>}
      {data.syncTruncated && <AdminNotice testId="history-sync-truncated">{HISTORY_WORDS.syncTruncated}</AdminNotice>}
      {data.units.length === 0 ? (
        <p className="text-sm text-slate-300" data-testid="history-empty">
          {`${HISTORY_WORDS.empty} ${emptyBasis === 'in_code_fallback' ? HISTORY_WORDS.emptyBuiltIn : emptyBasis === 'unpriced' ? HISTORY_WORDS.emptyUnpriced : ''}`.trim()}
        </p>
      ) : (
        data.units.map((unit) => <UnitTable key={`${unit.size ?? ''}|${unit.quality ?? ''}`} unit={unit} kind={data.kind} />)
      )}
      <p className={NOTE}>{HISTORY_WORDS.deletedFootnote}</p>
    </div>
  );
}
