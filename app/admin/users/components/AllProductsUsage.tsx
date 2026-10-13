'use client';

/**
 * "All products, token records" inside the drawer's AI usage section (Admin
 * Layout follow-ups LF-4a.2, BD-7, Q-4 (a)). Moved from `BusinessDetail`.
 *
 * It comes from the page-owned stats read (`token_usage`), not from the
 * Business OS ledger, so it can differ from the Business OS figure: the two
 * are never merged, and one visible sentence says so. Folded by default; a
 * failed read is never folded away (SA C3 (c), the plan-error precedent). Not
 * a `DrawerSection`: it sits inside one (SA C3 (b)). It sends no request.
 */

import { DrawerField, DrawerFields } from '@/app/admin/components/layout/AdminDrawer';
import { formatCost, formatNumber } from '@/app/admin/users/usersFormat';
import type { UserDetailedStats } from '@/app/admin/users/types';
import { Fold, ShowMoreList } from './drawerFolds';
import { PART_BOX, PartPurpose } from './DrawerBox';

export const ALL_PRODUCTS_COPY = {
  title: 'All products, token records (30 days; may be incomplete above 1,000 calls)',
  differs:
    'These come from the older token records, not the Business OS records, so they may not match the Business OS figure.',
  unreadable: 'The AI usage records could not be read.',
  show: 'Show all products',
  hide: 'Hide all products',
  models: 'Cost by Model (highest cost first)',
} as const;

export function AllProductsUsage({ stats }: { stats: UserDetailedStats }) {
  const tokens = stats.tokens;

  return (
    <div data-testid="ai-spend-card" className={`${PART_BOX} space-y-2`}>
      {/* Not a heading: each DrawerSection has exactly one (L-1d M-4; SA C2). */}
      <p className="text-sm font-semibold text-slate-300">{ALL_PRODUCTS_COPY.title}</p>
      <PartPurpose part="ai-all" />
      {tokens === null ? (
        <p className="text-sm text-red-300">{ALL_PRODUCTS_COPY.unreadable}</p>
      ) : (
        <>
          <p data-testid="ai-differ-note" className="text-sm text-slate-400">
            {ALL_PRODUCTS_COPY.differs}
          </p>
          <Fold showLabel={ALL_PRODUCTS_COPY.show} hideLabel={ALL_PRODUCTS_COPY.hide} testId="ai-all-products">
            <DrawerFields>
              <DrawerField label="Input Tokens">
                <span className="tabular-nums">{formatNumber(tokens.total_input_tokens)}</span>
              </DrawerField>
              <DrawerField label="Output Tokens">
                <span className="tabular-nums">{formatNumber(tokens.total_output_tokens)}</span>
              </DrawerField>
              <DrawerField label="LLM Calls">
                <span className="tabular-nums">{formatNumber(tokens.total_calls)}</span>
              </DrawerField>
              <DrawerField label="Total Cost">
                <span className="tabular-nums">{formatCost(tokens.total_cost_usd)}</span>
              </DrawerField>
            </DrawerFields>

            {tokens.by_model.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-semibold text-slate-300">{ALL_PRODUCTS_COPY.models}</p>
                <ShowMoreList
                  testId="ai-models-more"
                  listClassName="space-y-2"
                  items={tokens.by_model.map((model) => (
                    <li
                      key={model.model}
                      data-testid="ai-model-row"
                      className="flex items-center justify-between gap-3 rounded-lg bg-slate-800/50 p-3"
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-sm text-white">{model.model}</span>
                        <span className="text-xs text-slate-400">{formatNumber(model.calls)} calls</span>
                      </div>
                      <div className="flex items-center gap-4 text-sm tabular-nums">
                        <span className="text-slate-400">
                          <span className="text-slate-200">{formatNumber(model.input)}</span> in /{' '}
                          <span className="text-slate-200">{formatNumber(model.output)}</span> out
                        </span>
                        <span className="font-semibold text-slate-200">{formatCost(model.cost)}</span>
                      </div>
                    </li>
                  ))}
                />
              </div>
            )}
          </Fold>
        </>
      )}
    </div>
  );
}
