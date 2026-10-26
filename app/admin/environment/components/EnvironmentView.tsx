'use client';

/**
 * The body of the Environment admin page: the environment card, one card per
 * group, the Uncategorised card and the platform count line (admin environment
 * view EC-2; workplan §2.3.2 to §2.3.5; FR-12 to FR-15).
 *
 * Renders only what the response carries. Every value word comes from
 * `environmentDisplay.ts`; text is rendered as React children, never as HTML.
 * No control here changes, copies or reveals anything (FR-14).
 */

import React from 'react';
import Link from 'next/link';
import { Info } from 'lucide-react';

import { StatusChip } from '@/app/admin/components/layout/StatusChip';
import {
  ADMIN_COUNT_LINE,
  ADMIN_TABLE,
  ADMIN_TABLE_WRAP,
  ADMIN_TBODY,
  ADMIN_TD,
  ADMIN_TH,
  ADMIN_THEAD,
} from '@/app/admin/components/layout/adminTable';
import type { EnvironmentViewPayload, EnvRow } from '@/lib/admin/environment-types';

import {
  describeDisplay,
  ENVIRONMENT_LABEL_WORDS,
  platformHiddenLine,
  scopeWords,
  seeAlsoLink,
} from '../environmentDisplay';

const CARD = 'rounded-xl border border-slate-700 bg-slate-800/40 p-4';
const CARD_TITLE = 'text-sm font-semibold text-white';
const CARD_TEXT = 'mt-1 text-sm text-slate-400';

const FACTS: ReadonlyArray<{ key: keyof EnvironmentViewPayload['environment']['facts']; label: string }> = [
  { key: 'host', label: 'Host' },
  { key: 'region', label: 'Region' },
  { key: 'branch', label: 'Branch' },
  { key: 'commit', label: 'Commit' },
];

function ValueCell({ row }: { row: EnvRow }) {
  const words = describeDisplay(row.display);
  const link = row.display.kind === 'count' ? seeAlsoLink(row.seeAlsoPath) : null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {words.chip && <StatusChip tone={words.chip.tone}>{words.chip.text}</StatusChip>}
      {words.mono !== null && <span className="break-all font-mono text-xs text-slate-200">{words.mono}</span>}
      {words.note !== null && <span className="text-xs text-slate-400">{words.note}</span>}
      {link && (
        <Link href={link.href} className="text-xs text-sky-300 underline hover:text-sky-200">
          {link.label}
        </Link>
      )}
    </div>
  );
}

function RowsTable({ rows, testId }: { rows: EnvRow[]; testId: string }) {
  if (rows.length === 0) return <p className="mt-3 text-sm text-slate-400">None</p>;
  return (
    <div className={`mt-3 ${ADMIN_TABLE_WRAP}`}>
      <table className={ADMIN_TABLE} data-testid={testId}>
        <thead className={ADMIN_THEAD}>
          <tr>
            <th scope="col" className={ADMIN_TH}>Name</th>
            <th scope="col" className={ADMIN_TH}>Value</th>
            <th scope="col" className={ADMIN_TH}>Role</th>
            <th scope="col" className={ADMIN_TH}>Scope</th>
          </tr>
        </thead>
        <tbody className={ADMIN_TBODY}>
          {rows.map((row) => (
            <tr key={row.name} data-testid="env-row" data-name={row.name}>
              {/* QA §6.2: long text wraps in its cell; break-all for monospace (as the audit trail and
                  call details do), break-words for prose. */}
              <td className={`${ADMIN_TD} break-all font-mono text-xs text-white`} data-testid="env-name">
                {row.name}
              </td>
              {/* The value's monospace text already carries break-all; the notes wrap at words. */}
              <td className={`${ADMIN_TD} break-words`} data-testid="env-value">
                <ValueCell row={row} />
              </td>
              <td className={`${ADMIN_TD} break-words text-slate-400`}>{row.role}</td>
              <td className={`${ADMIN_TD} whitespace-nowrap text-slate-400`}>{scopeWords(row.scope)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EnvironmentView({ data }: { data: EnvironmentViewPayload }) {
  const label = ENVIRONMENT_LABEL_WORDS[data.environment.label];
  return (
    <>
      <section className={CARD} data-testid="environment-card">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className={CARD_TITLE}>This deployment</h2>
          <StatusChip tone={label.tone} testId="environment-chip">
            {label.text}
          </StatusChip>
        </div>
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {FACTS.map((fact) => (
            <div key={fact.key} className="flex gap-2">
              <dt className="text-slate-400">{fact.label}</dt>
              <dd className="break-all font-mono text-xs leading-5 text-slate-200">
                {data.environment.facts[fact.key] ?? 'Not provided'}
              </dd>
            </div>
          ))}
        </dl>
        <div className="mt-3 flex items-start gap-2 text-sm text-slate-400" data-testid="environment-notes">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
          <div className="space-y-1">
            <p>Shows this deployment&apos;s settings. A change made in Vercel appears here after the next deploy.</p>
            <p>
              Settings whose name starts with NEXT_PUBLIC_ are built into the browser code when the app is built;
              this page shows the server&apos;s copy.
            </p>
            {data.environment.label === 'local' && (
              <p data-testid="local-note">
                On a developer machine the values are the merged result of the .env files; the page cannot say
                which file a value came from.
              </p>
            )}
          </div>
        </div>
      </section>

      {data.groups.map((group) => (
        <section key={group.id} className={CARD} data-testid="group-card" data-group={group.id}>
          <h2 className={CARD_TITLE}>{group.label}</h2>
          <p className={CARD_TEXT}>{group.description}</p>
          <RowsTable rows={group.rows} testId={`group-table-${group.id}`} />
        </section>
      ))}

      <section className={CARD} data-testid="uncategorised-card">
        <h2 className={CARD_TITLE}>Uncategorised</h2>
        <p className={CARD_TEXT}>
          Present in this deployment&apos;s environment but not described in the catalogue. Values are never shown.
        </p>
        <RowsTable rows={data.uncategorised} testId="uncategorised-table" />
        <p className={`mt-3 ${ADMIN_COUNT_LINE}`} data-testid="platform-hidden-line">
          {platformHiddenLine(data.counts.platformHidden)}
        </p>
      </section>
    </>
  );
}
