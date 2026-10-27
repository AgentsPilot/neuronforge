'use client';

/**
 * How an AI cost row opens its drawer (Money MK-8b; MK-10 user decision
 * 2026-10-25: "have the open of the business line similar to the business
 * lines, clicking on the line should open as well, and have the same button
 * as we have there").
 *
 * The context the page's drawer provider (`AiCostDrawers.tsx`) fills, and the
 * hook a table calls. The shape is Finance's `useBusinessRowOpen()`
 * (`{ header, rowProps, cell }`), built only on the shared layout pieces, so
 * every page opens rows the Businesses way from one source:
 *   - the narrow last column with an sr-only "Details" header (`OpenRowHeader`);
 *   - an `OpenRowButton` labelled "Open details for …", test id `row-open`;
 *   - a mouse-only row click through `rowOpenTarget` (never on a control,
 *     never while selecting text, always through the row's button, so focus
 *     returns to it and the two paths share ONE open and ONE request);
 *   - the open row highlighted (`openableRowClass`).
 *
 * The hook answers null without a provider, or inside a drawer (the drawer
 * mounts a null provider), so a table rendered on its own, in a drawer, or
 * with one business picked keeps today's columns (SA-WP-MK8B C-6). This file
 * imports only shared pieces and the report's formatting, so the costs folder
 * can import it without a cycle.
 */

import { createContext, useContext, type MouseEvent, type ReactNode } from 'react';

import { OpenRowButton, OpenRowHeader } from '@/app/admin/components/layout/OpenRowButton';
import { ADMIN_TD_OPEN, formatShortId } from '@/app/admin/components/layout/adminTable';
import { ROW_OPEN_TEST_ID, openableRowClass, rowOpenTarget } from '@/app/admin/components/layout/rowOpenClick';
import { formatDay } from '@/app/admin/business-os-llm/costFormat';

import { AI_COST_DRAWER } from '../aiCostDrawerCopy';

/** What a row hands the drawer. */
export type AiCostDrawerTarget =
  | { kind: 'business'; accountId: string; name: string | null }
  | { kind: 'period'; accountId: string; name: string | null; periodStart: string };

export interface AiCostDrawerContextValue {
  open: (target: AiCostDrawerTarget, opener: HTMLElement) => void;
  /** `targetKey` of the target on screen, or null (closed). */
  openKey: string | null;
}

export const AiCostDrawerContext = createContext<AiCostDrawerContextValue | null>(null);

/** One row's identity: a business, or one account's one period. */
export function targetKey(target: AiCostDrawerTarget): string {
  return target.kind === 'business' ? `business|${target.accountId}` : `period|${target.accountId}|${target.periodStart}`;
}

/** The business's name as the drawer shows it: its name, else "Business {short id}". */
export function aiCostBusinessName(target: { accountId: string; name: string | null }): string {
  return target.name ?? `${AI_COST_DRAWER.titleFallback} ${formatShortId(target.accountId)}`;
}

/** The opener's accessible name and tooltip (D-2). */
export function openLabelOf(target: AiCostDrawerTarget): string {
  const name = aiCostBusinessName(target);
  return target.kind === 'business'
    ? AI_COST_DRAWER.openDetails(name)
    : AI_COST_DRAWER.openPeriodDetails(name, formatDay(target.periodStart));
}

export interface AiCostRowOpen {
  header: ReactNode;
  rowProps: (target: AiCostDrawerTarget) => { className: string; onClick: (event: MouseEvent<HTMLTableRowElement>) => void };
  cell: (target: AiCostDrawerTarget) => ReactNode;
}

/** The row opener for a table, or null when no drawer is mounted (the table then renders as today). */
export function useAiCostRowOpen(): AiCostRowOpen | null {
  const state = useContext(AiCostDrawerContext);
  if (!state) return null;
  return {
    header: <OpenRowHeader />,
    rowProps: (target) => ({
      className: openableRowClass(state.openKey === targetKey(target)),
      onClick: (event) => {
        const button = rowOpenTarget(event);
        if (button) state.open(target, button);
      },
    }),
    cell: (target) => (
      <td className={ADMIN_TD_OPEN}>
        <OpenRowButton label={openLabelOf(target)} onOpen={(button) => state.open(target, button)} testId={ROW_OPEN_TEST_ID} />
      </td>
    ),
  };
}
