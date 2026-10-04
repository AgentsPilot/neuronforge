/**
 * @jest-environment jsdom
 *
 * The Activity drill-down drawer (admin AI Activity view, Gap B slice B2a):
 * the row's Details button (keyboard reachable, named), the one read carrying
 * only the action id, every section (action, corrections, audit entry,
 * grouping id), the shared-group statement, the not-found and error states,
 * Escape closing with focus back on the row's button (AC-B17), and that the
 * B2b sections are absent rather than empty.
 *
 * SA-B2-11: fetches are routed by EXACT path, so a drill-down read is never
 * counted as a list read.
 */

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { ActivityTab } from '../components/activity/ActivityTab';
import {
  ACTIVITY_ERROR_FALLBACK,
  CORRECTIONS_NONE,
  CORRECTIONS_UNREAD,
  DRILL_DOWN_ERROR_FALLBACK,
  DRILL_DOWN_NOT_FOUND,
  DRILL_DOWN_SECTIONS,
  DRILL_DOWN_TITLE,
  ENTRY_FIELD_UNKNOWN,
  ENTRY_NO_FIELDS,
  GROUP_FAILED,
  GROUP_SHARED,
  GROUP_SINGLE,
  GROUP_THIS_ACTION,
  MARKER_CORRECTED,
  MARKER_LOST,
  NAME_UNAVAILABLE,
  NAMES_FAILED,
  OPEN_DETAILS_LABEL,
} from '../activityCopy';
import type { ActivityPayload, ActivityRow } from '../activityTypes';
import type { ActivityDrillDownCharge, ActivityDrillDownPayload } from '../activityDrillDownTypes';

const A = '11111111-1111-4111-8111-111111111111';
const ACTION_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const ACTION_2 = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002';
const GROUP = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const LIST_PATH = '/api/admin/business-os/ai-activity';
const DRILL_DOWN_PATH = '/api/admin/business-os/ai-activity/drill-down';
const pathOf = (url: string) => url.split('?')[0];

const FOUND = {
  state: 'found' as const,
  callCount: 3,
  failedCallCount: null,
  inputTokens: 1200,
  outputTokens: 300,
  totalTokens: 1500,
  models: ['model-alpha'],
  errorCode: 'RATE_LIMITED',
};

function row(over: Partial<ActivityRow> = {}): ActivityRow {
  return {
    actionId: ACTION_1,
    createdAt: '2026-10-01T10:15:00+00:00',
    accountId: A,
    companyName: 'Alpha Studio',
    area: 'website',
    actionType: 'website_copy',
    trigger: 'owner',
    outcome: 'succeeded',
    groupId: GROUP,
    costUsd: { gross: 0.004, net: 0.004 },
    credits: { gross: 4, net: 4 },
    isFallbackPriced: false,
    corrected: false,
    adjustmentCount: 0,
    reasonCodes: [],
    entry: FOUND,
    ...over,
  };
}

function listPayload(rows: ActivityRow[] = [row()]): ActivityPayload {
  return {
    generatedAt: '2026-10-02T12:00:00.000Z',
    window: { from: '2026-10-01', to: '2026-10-02', start: '2026-10-01T00:00:00.000Z', end: '2026-10-03T00:00:00.000Z' },
    cutover: { at: '2026-09-29T16:50:53.914167Z', coverage: 'after_cutover' },
    filters: { accountId: null, area: null, outcome: null, trigger: null, minCostUsd: null },
    sort: 'time',
    limit: 100,
    areas: [{ area: 'website', actionTypes: ['website_copy'] }],
    rows,
    total: rows.length,
    capped: false,
    names: 'ok',
    adjustments: 'ok',
    unresolvedAdjustments: 0,
    unreadableAmounts: 0,
    deletedAccounts: null,
    audit: {
      status: 'ok',
      settleMinutes: 15,
      archiveCutoff: null,
      archive: 'ok',
      noEntry: { tooRecent: 0, mayBeArchived: 0, lost: 0, unknown: 0, accountMismatch: 0 },
    },
  };
}

function charge(over: Partial<ActivityDrillDownCharge> = {}): ActivityDrillDownCharge {
  return {
    actionId: ACTION_1,
    createdAt: '2026-10-01T10:15:00+00:00',
    area: 'website',
    actionType: 'website_copy',
    trigger: 'owner',
    outcome: 'succeeded',
    costUsd: { gross: 0.004, net: 0.004 },
    credits: { gross: 4, net: 4 },
    isFallbackPriced: false,
    corrected: false,
    adjustmentCount: 0,
    reasonCodes: [],
    adjustments: [],
    entry: FOUND,
    opened: true,
    ...over,
  };
}

function drillDown(over: Partial<ActivityDrillDownPayload> = {}): ActivityDrillDownPayload {
  return {
    generatedAt: '2026-10-02T12:00:00.000Z',
    account: { accountId: A, companyName: 'Alpha Studio' },
    names: 'ok',
    actionId: ACTION_1,
    group: { groupId: GROUP, status: 'ok', chargedActions: 1, shared: false, atLeast: false, charges: [charge()] },
    adjustments: 'ok',
    unresolvedAdjustments: 0,
    unreadableAmounts: 0,
    audit: {
      status: 'ok',
      settleMinutes: 15,
      archiveCutoff: null,
      archive: 'ok',
      noEntry: { tooRecent: 0, mayBeArchived: 0, lost: 0, unknown: 0, accountMismatch: 0 },
    },
    ...over,
  };
}

type Reply = { status: number; body: unknown };

/** Routes by EXACT path (SA-B2-11). Anything else is a test error, not a silent pass. */
function stub(drill: (url: string) => Reply, list: ActivityPayload = listPayload()) {
  const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const reply: Reply =
      pathOf(url) === LIST_PATH
        ? { status: 200, body: { success: true, data: list } }
        : pathOf(url) === DRILL_DOWN_PATH
          ? drill(url)
          : { status: 500, body: { success: false, error: `unexpected fetch ${url}` } };
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => reply.body } as Response;
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const callsTo = (fetchMock: jest.Mock, wanted: string) =>
  fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => pathOf(u) === wanted);

const okDrill = (payload: ActivityDrillDownPayload) => () => ({ status: 200, body: { success: true, data: payload } });

async function openFirstRow() {
  render(<ActivityTab />);
  await screen.findByTestId('activity-table');
  const button = screen.getAllByTestId('activity-open-details')[0];
  // A fast reply (a 404, an unreadable body) settles in the click's own tick: keep it inside act.
  await act(async () => {
    fireEvent.click(button);
  });
  return button;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('the row button (AC-B17)', () => {
  it('is a real button, first in the row, named with the action type and time', async () => {
    stub(okDrill(drillDown()));
    render(<ActivityTab />);
    const table = await screen.findByTestId('activity-table');
    const firstRow = within(table).getAllByTestId('activity-row')[0];
    const button = within(firstRow).getAllByRole('button')[0];
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAccessibleName(OPEN_DETAILS_LABEL('website_copy', '2026-10-01 10:15 UTC'));
    expect(firstRow.querySelector('td')).toContainElement(button);
  });

  it('opens the drawer with ONE read that carries only the action id, and no list read is counted for it', async () => {
    const fetchMock = stub(okDrill(drillDown()));
    await openFirstRow();
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await screen.findByTestId('drill-down-action');

    const drillCalls = callsTo(fetchMock, DRILL_DOWN_PATH);
    expect(drillCalls).toHaveLength(1);
    const params = new URLSearchParams(drillCalls[0].split('?')[1]);
    expect([...params.keys()]).toEqual(['actionId']);
    expect(params.get('actionId')).toBe(ACTION_1);
    // The list was read once, on mount; the drill-down read is not a list read.
    expect(callsTo(fetchMock, LIST_PATH)).toHaveLength(1);
  });
});

describe('the drawer sections', () => {
  it('shows the title, the action, its business, figures and record state', async () => {
    stub(okDrill(drillDown()));
    await openFirstRow();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(DRILL_DOWN_TITLE)).toBeInTheDocument();
    const action = await within(dialog).findByTestId('drill-down-action');
    expect(within(action).getByRole('heading', { name: DRILL_DOWN_SECTIONS.action })).toBeInTheDocument();
    expect(within(action).getByTestId('drill-down-business')).toHaveTextContent('Alpha Studio');
    expect(within(action).getByTestId('drill-down-business')).toHaveTextContent('11111111…');
    expect(within(action).getByTestId('drill-down-cost')).toHaveTextContent('$0.004');
    expect(within(action).getByText('2026-10-01 10:15 UTC')).toBeInTheDocument();
    for (const title of Object.values(DRILL_DOWN_SECTIONS)) {
      expect(within(dialog).getByRole('heading', { name: title })).toBeInTheDocument();
    }
  });

  it('a corrected charge lists its corrections and shows the charged figure struck beside the net', async () => {
    stub(
      okDrill(
        drillDown({
          group: {
            groupId: GROUP,
            status: 'ok',
            chargedActions: 1,
            shared: false,
            atLeast: false,
            charges: [
              charge({
                costUsd: { gross: 0.002, net: 0.0014 },
                corrected: true,
                adjustmentCount: 1,
                reasonCodes: ['fallback_price_reconciled'],
                adjustments: [
                  { createdAt: '2026-12-15T00:00:00+00:00', reasonCode: 'fallback_price_reconciled', costUsd: -0.0006, credits: -0.6 },
                ],
              }),
            ],
          },
        })
      )
    );
    await openFirstRow();
    const corrections = await screen.findByTestId('drill-down-corrections');
    const lines = within(corrections).getAllByTestId('drill-down-correction');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveTextContent('2026-12-15 00:00 UTC');
    expect(lines[0]).toHaveTextContent('fallback_price_reconciled');
    expect(lines[0]).toHaveTextContent('-$0.0006');
    expect(screen.getByTestId('drill-down-cost')).toHaveTextContent('$0.0014');
    expect(screen.getByLabelText('charged $0.002 before correction')).toBeInTheDocument();
    expect(within(screen.getByTestId('drill-down-action')).getByTestId('marker-corrected')).toHaveTextContent(MARKER_CORRECTED);
  });

  it('no corrections, and corrections that could not be read, are each said in words', async () => {
    stub(okDrill(drillDown()));
    await openFirstRow();
    expect(await screen.findByText(CORRECTIONS_NONE)).toBeInTheDocument();
  });

  it('corrections that could not be read', async () => {
    stub(okDrill(drillDown({ adjustments: 'failed' })));
    await openFirstRow();
    expect(await screen.findByText(CORRECTIONS_UNREAD)).toBeInTheDocument();
    expect(screen.queryByText(CORRECTIONS_NONE)).not.toBeInTheDocument();
  });

  it('the audit entry fields (B1b projection); a missing field reads Unknown, never blank', async () => {
    stub(okDrill(drillDown()));
    await openFirstRow();
    const fields = await screen.findByTestId('drill-down-entry-fields');
    expect(fields).toHaveTextContent('Calls3');
    expect(fields).toHaveTextContent(`Failed calls${ENTRY_FIELD_UNKNOWN}`);
    expect(fields).toHaveTextContent('Total tokens1,500');
    expect(fields).toHaveTextContent('model-alpha');
    expect(fields).toHaveTextContent('RATE_LIMITED');
  });

  it('no entry: the state is said in words, with the reason chip', async () => {
    stub(okDrill(drillDown({ group: { ...drillDown().group, charges: [charge({ entry: { state: 'lost' } })] } })));
    await openFirstRow();
    const state = await screen.findByTestId('drill-down-entry-state');
    expect(state).toHaveTextContent(ENTRY_NO_FIELDS);
    expect(within(state).getByTestId('marker-entry-lost')).toHaveTextContent(MARKER_LOST);
    expect(screen.queryByTestId('drill-down-entry-fields')).not.toBeInTheDocument();
  });

  it('a failed name lookup is said, and the business reads "Name unavailable"', async () => {
    stub(okDrill(drillDown({ names: 'failed', account: { accountId: A, companyName: null } })));
    await openFirstRow();
    expect(await screen.findByTestId('drill-down-notices')).toHaveTextContent(NAMES_FAILED);
    expect(screen.getByTestId('drill-down-business')).toHaveTextContent(NAME_UNAVAILABLE);
  });

  it('B2b sections (calls, cost check) are absent, not empty', async () => {
    stub(okDrill(drillDown()));
    await openFirstRow();
    await screen.findByTestId('drill-down-group');
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByText(/calls read/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/cost check/i)).not.toBeInTheDocument();
    // The section headings are exactly the four B2a sections (the title is the dialog's own heading).
    expect(within(dialog).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(
      Object.values(DRILL_DOWN_SECTIONS)
    );
  });
});

describe('the grouping id and the shared-group marker (FR-B2)', () => {
  it('one charged action: says so, with no group table', async () => {
    stub(okDrill(drillDown()));
    await openFirstRow();
    expect(await screen.findByTestId('drill-down-group-single')).toHaveTextContent(GROUP_SINGLE);
    expect(screen.queryByTestId('drill-down-group-charges')).not.toBeInTheDocument();
  });

  it('a shared grouping id: the statement in words, every charge listed, the opened one marked in text', async () => {
    const other = charge({ actionId: ACTION_2, createdAt: '2026-10-01T10:20:00+00:00', actionType: 'chat_turn', opened: false, entry: { state: 'lost' } });
    stub(
      okDrill(
        drillDown({
          group: { groupId: GROUP, status: 'ok', chargedActions: 2, shared: true, atLeast: false, charges: [other, charge()] },
        })
      )
    );
    await openFirstRow();
    expect(await screen.findByTestId('drill-down-group-shared')).toHaveTextContent(GROUP_SHARED('2', false));
    const rows = within(screen.getByTestId('drill-down-group-charges')).getAllByTestId('drill-down-group-charge');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute('data-opened', 'false');
    expect(rows[0]).not.toHaveTextContent(GROUP_THIS_ACTION);
    expect(within(rows[0]).getByTestId('marker-entry-lost')).toBeInTheDocument();
    expect(rows[1]).toHaveAttribute('data-opened', 'true');
    expect(rows[1]).toHaveTextContent(GROUP_THIS_ACTION);
  });

  it('a group read cut at its ceiling says "at least"', async () => {
    stub(
      okDrill(
        drillDown({
          group: {
            groupId: GROUP,
            status: 'ok',
            chargedActions: 2,
            shared: true,
            atLeast: true,
            charges: [charge({ actionId: ACTION_2, opened: false }), charge()],
          },
        })
      )
    );
    await openFirstRow();
    expect(await screen.findByTestId('drill-down-group-shared')).toHaveTextContent(GROUP_SHARED('2', true));
    expect(screen.getByTestId('drill-down-group-shared')).toHaveTextContent('at least 2');
  });

  it('a failed group read says only this action is shown', async () => {
    stub(okDrill(drillDown({ group: { ...drillDown().group, status: 'failed' } })));
    await openFirstRow();
    expect(await screen.findByTestId('drill-down-group-failed')).toHaveTextContent(GROUP_FAILED);
    expect(screen.queryByTestId('drill-down-group-single')).not.toBeInTheDocument();
  });
});

describe('not found and errors', () => {
  it('404 shows the not-found line and nothing else', async () => {
    stub(() => ({ status: 404, body: { success: false, error: 'This AI action could not be found' } }));
    await openFirstRow();
    expect(await screen.findByTestId('drill-down-error')).toHaveTextContent(DRILL_DOWN_NOT_FOUND);
    expect(screen.queryByTestId('drill-down-action')).not.toBeInTheDocument();
  });

  it('another error shows the route message', async () => {
    stub(() => ({ status: 500, body: { success: false, error: 'The AI action could not be read. Try again.' } }));
    await openFirstRow();
    expect(await screen.findByTestId('drill-down-error')).toHaveTextContent('The AI action could not be read. Try again.');
  });

  it('a network failure is shown as an error', async () => {
    stub(() => {
      throw new Error('offline');
    });
    render(<ActivityTab />);
    await screen.findByTestId('activity-table');
    // The rejection settles in the same tick as the click: wrap both, so the state update is inside act.
    await act(async () => {
      fireEvent.click(screen.getAllByTestId('activity-open-details')[0]);
    });
    expect(await screen.findByTestId('drill-down-error')).toHaveTextContent('offline');
  });
});

describe('QA-B2a-2: a body that is not JSON (a proxy error page) never shows a parser message', () => {
  const PARSER_MESSAGE = "Unexpected token '<', \"<html><bod\"... is not valid JSON";

  /** A platform HTML error page: `json()` throws, exactly as a browser's would. */
  const htmlPage = (status: number): Response => {
    // Typed as the three members the screens read, then narrowed to Response (a subtype cast, no `unknown`).
    const page: Pick<Response, 'ok' | 'status' | 'json'> = {
      ok: false,
      status,
      json: async () => {
        throw new SyntaxError(PARSER_MESSAGE);
      },
    };
    return page as Response;
  };

  function stubHtml(listStatus: number | null, drillStatus: number) {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (pathOf(url) === LIST_PATH) {
        return listStatus === null
          ? ({ ok: true, status: 200, json: async () => ({ success: true, data: listPayload() }) } as Response)
          : htmlPage(listStatus);
      }
      return htmlPage(drillStatus);
    }) as unknown as typeof fetch;
  }

  it('an HTML 502 from the drill-down shows the fallback line', async () => {
    stubHtml(null, 502);
    await openFirstRow();
    const error = await screen.findByTestId('drill-down-error');
    expect(error).toHaveTextContent(DRILL_DOWN_ERROR_FALLBACK);
    expect(error).not.toHaveTextContent('Unexpected token');
  });

  it('an HTML 404 from the drill-down still shows the not-found line', async () => {
    stubHtml(null, 404);
    await openFirstRow();
    const error = await screen.findByTestId('drill-down-error');
    expect(error).toHaveTextContent(DRILL_DOWN_NOT_FOUND);
    expect(error).not.toHaveTextContent('Unexpected token');
  });

  it('an HTML 502 from the LIST shows the tab fallback, not the parser message (changed together, per SA)', async () => {
    stubHtml(502, 502);
    render(<ActivityTab />);
    const error = await screen.findByTestId('activity-error');
    expect(error).toHaveTextContent(ACTIVITY_ERROR_FALLBACK);
    expect(error).not.toHaveTextContent('Unexpected token');
  });
});

describe('SA-CR-B2a-1: the close button stays visible on the admin palette', () => {
  it('the drawer colours its own close button (the shared sheet is not changed)', async () => {
    stub(okDrill(drillDown()));
    await openFirstRow();
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveClass('[&>button]:text-slate-300');
    const close = within(dialog).getByRole('button', { name: 'Close' });
    // A direct child, so the `[&>button]` selector reaches it.
    expect(close.parentElement).toBe(dialog);
  });
});

describe('sections are named by their own heading (aria-labelledby)', () => {
  it('each section is a region labelled by its heading id, with no duplicate aria-label', async () => {
    stub(okDrill(drillDown()));
    await openFirstRow();
    const action = await screen.findByTestId('drill-down-action');
    const heading = within(action).getByRole('heading', { name: DRILL_DOWN_SECTIONS.action });
    expect(action).toHaveAttribute('aria-labelledby', heading.id);
    expect(action).not.toHaveAttribute('aria-label');
    expect(screen.getByRole('region', { name: DRILL_DOWN_SECTIONS.group })).toBe(screen.getByTestId('drill-down-group'));
  });
});

describe('keyboard: Escape closes, and focus returns to the row button (AC-B17)', () => {
  it('closes on Escape and puts focus back on the button that opened it', async () => {
    stub(okDrill(drillDown()));
    const button = await openFirstRow();
    const dialog = await screen.findByRole('dialog');
    await screen.findByTestId('drill-down-action');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(button).toHaveFocus();
  });

  it('a response for a drawer already closed never sets it: reopening shows the newest action only', async () => {
    const resolvers: { url: string; resolve: (r: Response) => void }[] = [];
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (pathOf(url) === LIST_PATH) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: listPayload([row(), row({ actionId: ACTION_2, actionType: 'chat_turn' })]) }),
        } as Response);
      }
      return new Promise<Response>((resolve) => resolvers.push({ url, resolve }));
    }) as unknown as typeof fetch;

    render(<ActivityTab />);
    await screen.findByTestId('activity-table');
    const [first, second] = screen.getAllByTestId('activity-open-details');
    fireEvent.click(first);
    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(second);
    await screen.findByRole('dialog');
    await waitFor(() => expect(resolvers).toHaveLength(2));

    const respond = (payload: ActivityDrillDownPayload) =>
      ({ ok: true, status: 200, json: async () => ({ success: true, data: payload }) }) as Response;
    await act(async () =>
      resolvers[1].resolve(
        respond(
          drillDown({
            actionId: ACTION_2,
            account: { accountId: A, companyName: 'Newest Co' },
            group: { ...drillDown().group, charges: [charge({ actionId: ACTION_2, actionType: 'chat_turn' })] },
          })
        )
      )
    );
    await act(async () => resolvers[0].resolve(respond(drillDown({ account: { accountId: A, companyName: 'Stale Co' } }))));
    expect(await screen.findByTestId('drill-down-business')).toHaveTextContent('Newest Co');
    expect(screen.queryByText('Stale Co')).not.toBeInTheDocument();
  });
});
