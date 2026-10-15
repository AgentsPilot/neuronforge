/**
 * @jest-environment jsdom
 *
 * The source cell shows the cross-check in words (AI model price review
 * slice 5; SA O-12, QA bug 2, mutant X2). It prefers the server's
 * `crossCheckDetail` and falls back to the bare verdict for older read models.
 */

import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';

import type { ComparisonRow, PendingView } from '@/lib/ai/pricing-research/comparisonModel';

import { SourceCell } from '../components/PriceRowCells';
import { comparedRowFor } from '../__fixtures__/priceComparison';

const PENDING: PendingView = {
  lineId: 'line-1',
  proposalId: 'round-1',
  unit: 'tokens',
  sourceUrl: 'https://developers.openai.com/api/docs/pricing',
  checkedOn: '2026-10-15',
  flags: [],
  flagLabels: [],
  crossCheck: 'differs',
  createdAt: '2026-10-15T09:00:00.000Z',
  createdBy: 'admin@example.com',
};

function rowWith(view: PendingView): ComparisonRow {
  return comparedRowFor(
    { id: 'row-1', provider: 'openai', model_name: 'example-model', input_cost_per_token: 0.00000015, output_cost_per_token: 0.0000006, effective_date: '2026-09-01' },
    { pending: [view] }
  );
}

function renderCell(row: ComparisonRow) {
  render(
    <table>
      <tbody>
        <tr>
          <SourceCell row={row} />
        </tr>
      </tbody>
    </table>
  );
}

it('shows the cross-check words from the server', () => {
  const words = 'differs from the second price list by up to 10.00%, read 2026-10-15; second price list (LiteLLM): input 0.165 per 1M';
  renderCell(rowWith({ ...PENDING, crossCheckDetail: words }));
  expect(screen.getByText(`Cross-check: ${words}`)).toBeInTheDocument();
  expect(screen.queryByText('Cross-check: differs')).not.toBeInTheDocument();
});

it('falls back to the bare verdict when the read model has no words', () => {
  renderCell(rowWith(PENDING));
  expect(screen.getByText('Cross-check: differs')).toBeInTheDocument();
});
