/**
 * @jest-environment jsdom
 *
 * Apply, Dismiss and the margin prompt on Model pricing (AI model price review
 * slice 8; MP-FR-8, MP-FR-10, MP-FR-14; UF-3, RR-5; SA RC-15, RC-16, O-19).
 *
 * Fast by design (RC-16): the panel and the notice are rendered directly with a
 * mocked `fetch`; one page-level case pins the wiring (row Apply → panel →
 * POST → "within 1 hour" notice → silent re-read).
 */

import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import type { ComparisonModel, ComparisonRow, OpenMarginReviewView, PendingView } from '@/lib/ai/pricing-research/comparisonModel';
import { compareUnit, rowCoverage, type UnitComparisonInput } from '@/lib/ai/pricing-research/coverageColour';

jest.mock('@/app/admin/system-config/components/ProviderPriceCheck', () => ({
  __esModule: true,
  default: () => jest.requireActual('react').createElement('div', { 'data-testid': 'price-check-stand-in' }),
}));
jest.mock('@/lib/logger/client', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { clientLogger: logger };
});

import { MarginReviewNotice } from '../components/MarginReviewNotice';
import { PriceDecisionPanel } from '../components/PriceDecisionPanel';
import ModelPricingPage from '../page';
import { COMPARISON_URL, PRICING_URL, SERVER_NOW } from '../__fixtures__/priceComparison';

const OFFICIAL = 'https://developers.openai.com/api/docs/pricing';
const PREFILL = `Provider price change — source ${OFFICIAL} (checked 2026-10-17)`;

function pending(lineId: string, unit: string, extra: Partial<PendingView> = {}): PendingView {
  return {
    lineId,
    proposalId: 'p-1',
    unit,
    sourceUrl: OFFICIAL,
    checkedOn: '2026-10-17',
    flags: [],
    flagLabels: [],
    crossCheck: 'not run',
    createdAt: '2026-10-17T09:00:00Z',
    createdBy: 'admin@example.com',
    ...extra,
  };
}

function row(modelName: string, inputs: UnitComparisonInput[], opts: Partial<ComparisonRow> = {}): ComparisonRow {
  const units = inputs.map((input) => compareUnit(input, { usedByBusinessOs: true }));
  const coverage = rowCoverage(units);
  return {
    kind: 'token',
    provider: 'openai',
    modelName,
    currentRowId: `id-${modelName}`,
    areas: [],
    usedByBusinessOs: true,
    usageLabel: 'chat',
    currentBasis: 'table',
    currentNote: null,
    units,
    colour: coverage.colour,
    redUnits: coverage.redUnits,
    summary: coverage.summary,
    worstGapBasisPoints: null,
    pending: [],
    ...opts,
  };
}

const unit = (name: string, current: string | null, next: string | null, basis: UnitComparisonInput['currentBasis'] = 'table') => ({
  unit: name,
  current,
  currentBasis: current === null ? ('unpriced' as const) : basis,
  pending: next,
});

const MINI = row('gpt-4o-mini', [unit('input', '0.15', '0.16'), unit('output', '0.6', '0.6'), unit('cached_input', '0.075', null, 'derived')], {
  pending: [pending('line-mini', 'tokens')],
});
const FLAGGED = row('gpt-4o', [unit('input', '2.5', '5'), unit('output', '10', '10')], {
  pending: [pending('line-4o', 'tokens', { flags: ['large_move'], flagLabels: [{ flag: 'large_move', label: 'price moves more than 50%' }] })],
});
const CLAUDE = row('claude-x', [unit('input', '3', '3'), unit('output', '15', '15'), unit('cached_input', null, '0.3')], {
  provider: 'anthropic',
  pending: [pending('line-claude', 'tokens')],
});
const STORED_CACHED = row('gpt-cached', [unit('input', '1', '1.1'), unit('output', '4', '4'), unit('cached_input', '0.2', null, 'table')], {
  pending: [pending('line-cached', 'tokens')],
});
const IMAGE = row('gpt-image-new', [unit('image 1024x1024 high', null, '0.2')], {
  kind: 'image',
  imageSetIncomplete: true,
  pending: [pending('line-image', 'image 1024x1024 high')],
});

interface Posted {
  url: string;
  body: unknown;
}

function stubPost(reply: { status: number; body: unknown }) {
  const posted: Posted[] = [];
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    posted.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => reply.body };
  }) as unknown as typeof fetch;
  return posted;
}

const APPLIED = { status: 200, body: { success: true, data: { batchId: 'batch-1', appliedAt: '2026-10-17T10:15:00.000Z', effective: 'In effect on all servers within 1 hour.', marginReview: { needed: true, items: [] } } } };

const scrollIntoView = jest.fn();
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
});
beforeEach(() => scrollIntoView.mockClear());

describe('PriceDecisionPanel: focus (SA CR8-2)', () => {
  it('on open, focus moves to the panel heading and the panel scrolls into view', () => {
    stubPost(APPLIED);
    render(<PriceDecisionPanel mode="apply" rows={[MINI]} onFinished={jest.fn()} onClose={jest.fn()} />);
    const heading = screen.getByTestId('decision-heading');
    expect(heading).toHaveAttribute('tabindex', '-1');
    expect(heading).toHaveFocus();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    // The reason links its hint and is marked required (SA optimisation).
    const reason = screen.getByTestId('apply-reason-line-mini');
    expect(reason).toHaveAttribute('aria-required', 'true');
    expect(reason).toHaveAccessibleDescription('Pre-filled from the provider page; edit it if needed.');
  });
});

describe('PriceDecisionPanel: Apply', () => {
  it('pre-fills an editable reason per line and sends ids and reasons only', async () => {
    const posted = stubPost(APPLIED);
    const onFinished = jest.fn();
    render(<PriceDecisionPanel mode="apply" rows={[MINI]} onFinished={onFinished} onClose={jest.fn()} />);

    const reason = screen.getByTestId('apply-reason-line-mini') as HTMLInputElement;
    expect(reason.value).toBe(PREFILL);
    expect(screen.queryByTestId('apply-override-line-mini')).not.toBeInTheDocument();
    expect(screen.getByText(/input: ours \$0.15 → provider \$0.16/)).toBeInTheDocument();
    expect(screen.getByText(/cached input: ours \$0.075 → provider —/)).toBeInTheDocument();

    fireEvent.change(reason, { target: { value: 'Provider raised the input price' } });
    fireEvent.click(screen.getByTestId('confirm-apply'));
    await waitFor(() => expect(onFinished).toHaveBeenCalled());
    expect(posted).toEqual([{ url: '/api/admin/model-pricing/apply', body: { lines: [{ lineId: 'line-mini', reason: 'Provider raised the input price' }] } }]);
    expect(onFinished).toHaveBeenCalledWith({ kind: 'applied', appliedAt: '2026-10-17T10:15:00.000Z', effective: 'In effect on all servers within 1 hour.', marginNeeded: true });
  });

  it('RR-5: a flagged line gets an EMPTY override field that is required', async () => {
    const posted = stubPost(APPLIED);
    render(<PriceDecisionPanel mode="apply" rows={[FLAGGED]} onFinished={jest.fn()} onClose={jest.fn()} />);
    const override = screen.getByTestId('apply-override-line-4o') as HTMLInputElement;
    expect(override.value).toBe('');
    expect(screen.getByText(/price moves more than 50%/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('confirm-apply'));
    expect(override).toHaveAttribute('aria-invalid', 'true');
    expect(posted).toHaveLength(0);

    fireEvent.change(override, { target: { value: 'Provider doubled the price on 17 October' } });
    fireEvent.click(screen.getByTestId('confirm-apply'));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].body).toEqual({ lines: [{ lineId: 'line-4o', reason: PREFILL, overrideReason: 'Provider doubled the price on 17 October' }] });
  });

  it('bulk: every selected line has its own pre-filled reason, sent in one request', async () => {
    const posted = stubPost(APPLIED);
    render(<PriceDecisionPanel mode="apply" rows={[MINI, STORED_CACHED]} onFinished={jest.fn()} onClose={jest.fn()} />);
    expect((screen.getByTestId('apply-reason-line-cached') as HTMLInputElement).value).toBe(PREFILL);
    fireEvent.click(screen.getByTestId('confirm-apply'));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].body).toEqual({ lines: [{ lineId: 'line-mini', reason: PREFILL }, { lineId: 'line-cached', reason: PREFILL }] });
  });

  it('RC-15: cached-input words, and O-19: the incomplete image set warning', () => {
    stubPost(APPLIED);
    render(<PriceDecisionPanel mode="apply" rows={[MINI, CLAUDE, STORED_CACHED, IMAGE]} onFinished={jest.fn()} onClose={jest.fn()} />);
    expect(within(screen.getByTestId('decision-line-line-mini')).getByText(/derived \(half of input\)/)).toBeInTheDocument();
    expect(within(screen.getByTestId('decision-line-line-claude')).getByText(/stored, not charged/)).toBeInTheDocument();
    expect(within(screen.getByTestId('decision-line-line-cached')).getByText(/the stored cached rate is removed; half of input applies/)).toBeInTheDocument();
    expect(screen.getByTestId('image-set-incomplete')).toHaveTextContent('every size is priced at low, medium and high');
  });

  it('a refusal shows the server words and names the refused line; nothing is finished', async () => {
    stubPost({ status: 409, body: { success: false, code: 'stale', error: 'The price we charge changed since this was recorded. Record the provider price again.', lineIds: ['line-mini'] } });
    const onFinished = jest.fn();
    render(<PriceDecisionPanel mode="apply" rows={[MINI]} onFinished={onFinished} onClose={jest.fn()} />);
    fireEvent.click(screen.getByTestId('confirm-apply'));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Record the provider price again.');
    expect(alert).toHaveTextContent('gpt-4o-mini (tokens)');
    expect(onFinished).not.toHaveBeenCalled();
  });
});

describe('PriceDecisionPanel: Dismiss', () => {
  it('the reason is required and NOT pre-filled; every line of the row is sent', async () => {
    const posted = stubPost({ status: 200, body: { success: true, data: { lines: [] } } });
    const onFinished = jest.fn();
    render(<PriceDecisionPanel mode="dismiss" rows={[IMAGE]} onFinished={onFinished} onClose={jest.fn()} />);
    const reason = screen.getByTestId('dismiss-reason') as HTMLInputElement;
    expect(reason.value).toBe('');
    expect(screen.queryByTestId('image-set-incomplete')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('confirm-dismiss'));
    expect(reason).toHaveAttribute('aria-invalid', 'true');
    expect(posted).toHaveLength(0);

    fireEvent.change(reason, { target: { value: 'Calculator estimate, not a list price' } });
    fireEvent.click(screen.getByTestId('confirm-dismiss'));
    await waitFor(() => expect(onFinished).toHaveBeenCalledWith({ kind: 'dismissed' }));
    expect(posted[0]).toEqual({ url: '/api/admin/model-pricing/dismiss', body: { lineIds: ['line-image'], reason: 'Calculator estimate, not a list price' } });
  });
});

const IMAGE_REVIEW: OpenMarginReviewView = {
  batchId: 'batch-2',
  appliedAt: '2026-10-17T11:00:00.000Z',
  appliedBy: 'admin@example.com',
  lineCount: 1,
  items: [
    {
      provider: 'openai',
      model: 'gpt-image-2.5-flare',
      kind: 'image',
      areas: ['images'],
      changes: [{ unit: 'image 1024x1024 high', old: '0.2', new: '0.25', change: '+25.00%' }],
      fallbackDiffers: false,
    },
  ],
};

const REVIEW: OpenMarginReviewView = {
  batchId: 'batch-1',
  appliedAt: '2026-10-17T10:15:00.000Z',
  appliedBy: 'admin@example.com',
  lineCount: 1,
  items: [
    {
      provider: 'openai',
      model: 'gpt-4o-mini',
      kind: 'token',
      areas: ['chat'],
      changes: [{ unit: 'input per 1M', old: '0.15', new: '0.16', change: '+6.67%' }],
      fallbackDiffers: true,
    },
  ],
};

describe('MarginReviewNotice (MP-FR-14)', () => {
  it('names the model and the change, links to credit pricing, and marks done with a note', async () => {
    const posted = stubPost({ status: 200, body: { success: true, data: { batchId: 'batch-1' } } });
    const onDone = jest.fn();
    render(<MarginReviewNotice reviews={[REVIEW]} onDone={onDone} />);
    const card = screen.getByTestId('margin-review-batch-1');
    expect(card).toHaveTextContent('gpt-4o-mini (chat)');
    expect(card).toHaveTextContent('input per 1M: $0.15 → $0.16 (+6.67%)');
    expect(card).toHaveTextContent('the built-in fallback price differs: update it by PR');
    // Money MK-3a (QA L-1, ruled): straight to the AI cost page's Summary & checks, not through the redirect.
    expect(screen.getByTestId('margin-review-link')).toHaveAttribute('href', '/admin/ai-cost?tab=checks');

    fireEvent.click(screen.getByTestId('margin-done-batch-1'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Write at least 3 characters.');
    expect(posted).toHaveLength(0);

    fireEvent.change(screen.getByTestId('margin-note-batch-1'), { target: { value: 'Margins still fine at the new price' } });
    fireEvent.click(screen.getByTestId('margin-done-batch-1'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(posted[0]).toEqual({ url: '/api/admin/model-pricing/apply-batches/batch-1/margin-review', body: { note: 'Margins still fine at the new price' } });
  });

  it('U04b / B-1: an image change gets its card too; more open reviews than shown are said', () => {
    stubPost({ status: 200, body: { success: true } });
    render(<MarginReviewNotice reviews={[IMAGE_REVIEW]} more onDone={jest.fn()} />);
    expect(screen.getByTestId('margin-review-batch-2')).toHaveTextContent('gpt-image-2.5-flare (images)');
    expect(screen.getByTestId('margin-review-batch-2')).toHaveTextContent('image 1024x1024 high: $0.2 → $0.25 (+25.00%)');
    expect(screen.getByTestId('margin-review-more')).toHaveTextContent('More margin reviews are open than shown here.');
  });

  it('renders nothing when no review is open', () => {
    const { container } = render(<MarginReviewNotice reviews={[]} onDone={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('the page wiring (one case, RC-16)', () => {
  it('bulk is capped at 50 lines; row Apply opens the panel, Cancel returns focus, confirm posts and shows "within 1 hour"', async () => {
    const big = row('gpt-image-many', Array.from({ length: 51 }, (_v, index) => unit(`image ${1000 + index}x1024 high`, null, '0.2')), {
      kind: 'image',
      pending: Array.from({ length: 51 }, (_v, index) => pending(`line-big-${index}`, `image ${1000 + index}x1024 high`)),
    });
    const model: ComparisonModel = { generatedAt: SERVER_NOW, embedding: { status: 'not_set', label: 'x' }, rows: [MINI, big], openMarginReviews: [] };
    const calls: string[] = [];
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url === COMPARISON_URL) return { ok: true, status: 200, json: async () => ({ success: true, data: model }) };
      if (url === PRICING_URL) {
        return { ok: true, status: 200, json: async () => ({ success: true, data: [{ id: 'id-gpt-4o-mini', provider: 'openai', model_name: 'gpt-4o-mini', input_cost_per_token: 0.00000015, output_cost_per_token: 0.0000006, effective_date: '2026-06-29' }] }) };
      }
      return { ok: true, status: 200, json: async () => APPLIED.body };
    }) as unknown as typeof fetch;

    render(<ModelPricingPage />);
    const applyMini = await screen.findByRole('button', { name: 'Apply gpt-4o-mini' });

    // QA edge case: more than 50 lines selected is refused in the browser, with words.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select for bulk apply: gpt-image-many' }));
    expect(screen.getByTestId('apply-selected')).toBeDisabled();
    expect(screen.getByTestId('apply-selected-too-many')).toHaveTextContent('Apply takes at most 50 prices at a time. Select fewer rows (51 prices selected)');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select for bulk apply: gpt-image-many' }));
    expect(screen.queryByTestId('apply-selected-too-many')).not.toBeInTheDocument();

    // CR8-2: the panel takes focus; Cancel gives it back to the row button.
    fireEvent.click(applyMini);
    expect(screen.getByTestId('decision-heading')).toHaveFocus();
    fireEvent.click(within(screen.getByTestId('price-apply-panel')).getByRole('button', { name: 'Cancel' }));
    expect(applyMini).toHaveFocus();

    fireEvent.click(applyMini);
    expect((screen.getByTestId('apply-reason-line-mini') as HTMLInputElement).value).toBe(PREFILL);
    fireEvent.click(screen.getByTestId('confirm-apply'));

    await waitFor(() => expect(screen.getByTestId('decision-notice')).toHaveTextContent('Applied at 10:15 UTC. In effect on all servers within 1 hour.'));
    expect(screen.getByTestId('decision-notice')).toHaveTextContent('check plan margins');
    expect(screen.queryByTestId('price-apply-panel')).not.toBeInTheDocument();
    expect(calls.filter((call) => call.startsWith('POST'))).toEqual(['POST /api/admin/model-pricing/apply']);
    await waitFor(() => expect(calls.filter((call) => call === `GET ${COMPARISON_URL}`)).toHaveLength(2));
  });
});
