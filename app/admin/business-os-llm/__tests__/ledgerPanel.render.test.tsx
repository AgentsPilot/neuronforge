/**
 * @jest-environment jsdom
 *
 * S2-T9, S2-T10 and RC-D — the panel that must never overclaim, including
 * about itself.
 */

import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';

import {
  LEDGER_CHECK_CAVEAT,
  LEDGER_READINGS_WITH_COUNTS,
  LEDGER_READING_TEXT,
  type LedgerReadingKind,
} from '@/lib/business-os/llm/ledgerCheckCopy';

import { LedgerCheckPanel } from '../components/LedgerCheckPanel';

const SINCE = '2026-09-21T10:14:08.000Z';

function answer(status: number, body: unknown) {
  const fetchMock = jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
  global.fetch = fetchMock;
  return fetchMock as unknown as jest.Mock;
}

function reading(kind: LedgerReadingKind, counts?: { after: number; before: number }) {
  return {
    success: true,
    data: {
      area: 'insights',
      kind,
      reading: LEDGER_READING_TEXT[kind],
      caveat: LEDGER_CHECK_CAVEAT,
      observationStartsAt: '2026-09-21T10:15:08.000Z',
      after: counts ? { count: counts.after, latestAt: SINCE } : null,
      before: counts ? { count: counts.before, latestAt: null } : null,
    },
  };
}

describe('S2-T9: all three readings render as text, with equal weight', () => {
  it.each([
    ['still_arriving', { after: 12, before: 30 }],
    ['stopped_with_before', { after: 0, before: 30 }],
    ['no_traffic_either', { after: 0, before: 0 }],
  ] as const)('renders the shared sentence for %s', async (kind, counts) => {
    answer(200, reading(kind, counts));
    render(<LedgerCheckPanel area="insights" since={SINCE} />);

    await waitFor(() =>
      expect(screen.getByTestId('ledger-reading')).toHaveTextContent(LEDGER_READING_TEXT[kind])
    );

    // The caveat is present on every branch, and it is the shared string.
    expect(screen.getByTestId('ledger-caveat')).toHaveTextContent(LEDGER_CHECK_CAVEAT);

    // Counts are shown for the readings that have them.
    expect(LEDGER_READINGS_WITH_COUNTS).toContain(kind);
    expect(screen.getByTestId('ledger-counts')).toHaveTextContent(String(counts.after));
  });

  /*
   * SA F-6, then QA DEF-S2-5.
   *
   * F-6: "no green in any branch" originally covered three of them, and the
   * RC-D branch was "covered" by a className check on a wrapper whose class is
   * `space-y-1` — colouring the heading green left the suite 9/9.
   *
   * DEF-S2-5: the replacement derived only the three COUNTED readings and
   * hard-coded the rest, so adding a sixth COUNT-LESS kind — which is what both
   * existing count-less kinds are, and therefore the likelier shape of the next
   * one — left 535/535 green with the new branch untested.
   *
   * The table is now an EXHAUSTIVE `Record` over `LedgerReadingKind`, so a new
   * kind is a missing property: a compile error in `typecheck:bos-llm`, which
   * has this file in scope (`--list` reports it as `caller`). And because no
   * test in this repo fails on a type error (F-4), a runtime assertion pins the
   * same thing independently — the keys must equal `LEDGER_READING_TEXT`'s.
   */
  interface Branch {
    setUp: () => void;
    /** The testid that means this branch has settled. */
    settled: string;
    since: string | null;
  }

  const readingBranch = (kind: LedgerReadingKind): Branch => ({
    setUp: () =>
      answer(
        200,
        reading(
          kind,
          (LEDGER_READINGS_WITH_COUNTS as readonly string[]).includes(kind)
            ? { after: 0, before: 3 }
            : undefined
        )
      ),
    settled: 'ledger-reading',
    since: SINCE,
  });

  // Exhaustive by construction: adding a kind without adding it here does not
  // compile.
  const READING_BRANCHES: Record<LedgerReadingKind, Branch> = {
    still_arriving: readingBranch('still_arriving'),
    stopped_with_before: readingBranch('stopped_with_before'),
    no_traffic_either: readingBranch('no_traffic_either'),
    ledger_cannot_answer: readingBranch('ledger_cannot_answer'),
    too_soon: readingBranch('too_soon'),
  };

  /** The states the panel reaches without a reading at all. */
  const PANEL_ONLY_BRANCHES: Record<string, Branch> = {
    'cannot_check (too_long_ago)': {
      setUp: () => answer(400, { success: false, reason: 'too_long_ago', error: 'Too old.' }),
      settled: 'ledger-cannot-check',
      since: SINCE,
    },
    'cannot_check (since_in_future)': {
      setUp: () =>
        answer(400, { success: false, reason: 'since_in_future', error: 'That is ahead of now.' }),
      settled: 'ledger-cannot-check',
      since: SINCE,
    },
    'cannot_check (unknown code)': {
      setUp: () => answer(400, { success: false, reason: 'something_new', error: 'Nope.' }),
      settled: 'ledger-cannot-check',
      since: SINCE,
    },
    failed: {
      setUp: () => answer(500, { success: false, error: 'boom' }),
      settled: 'ledger-failed',
      since: SINCE,
    },
    no_change: {
      setUp: () => answer(200, reading('no_traffic_either', { after: 0, before: 0 })),
      settled: 'ledger-no-change',
      since: null,
    },
  };

  const EVERY_BRANCH: ReadonlyArray<readonly [string, Branch]> = [
    ...Object.entries(READING_BRANCHES),
    ...Object.entries(PANEL_ONLY_BRANCHES),
  ];

  it.each(EVERY_BRANCH.map(([name, branch]) => [name, branch] as const))(
    'the %s branch has no tick, no "success" wording and no green class anywhere in the panel',
    async (_name, branch) => {
      branch.setUp();
      const { unmount } = render(<LedgerCheckPanel area="insights" since={branch.since} />);
      await waitFor(() => expect(screen.getByTestId(branch.settled)).toBeInTheDocument());

      const panel = screen.getByTestId('ledger-panel');
      expect(panel.textContent).not.toMatch(/(confirmed|verified|success|proven)/i);
      // A green chip reads as proof from across the room; this panel can only
      // ever corroborate.
      expect(panel.innerHTML).not.toMatch(/text-(green|emerald)-|bg-(green|emerald)-/);
      expect(panel.textContent).not.toMatch(/[✓✔☑]/);
      unmount();
    }
  );

  it('covers every reading kind that exists, however a new one is added', () => {
    // The runtime half of the DEF-S2-5 pin: a sixth kind added to the union and
    // to `LEDGER_READING_TEXT` fails HERE even though jest ignores the type
    // error that `READING_BRANCHES` would also raise.
    expect(Object.keys(READING_BRANCHES).sort()).toEqual(Object.keys(LEDGER_READING_TEXT).sort());
  });

  it('exercises the retry rule on both sides of the branch it distinguishes', async () => {
    // F-9 disables the button only for `too_long_ago`, which is monotonic. The
    // other refusals can change on the next read, so they stay retryable.
    PANEL_ONLY_BRANCHES['cannot_check (since_in_future)'].setUp();
    const { unmount } = render(<LedgerCheckPanel area="insights" since={SINCE} />);
    await waitFor(() => expect(screen.getByTestId('ledger-cannot-check')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /check again/i })).toBeEnabled();
    unmount();
  });
});

describe('S2-T10 / FR-19: chat renders none of the three readings', () => {
  it('shows only the "the ledger cannot answer" statement, naming the gate and the log line', async () => {
    answer(200, {
      success: true,
      data: {
        area: 'chat',
        kind: 'ledger_cannot_answer',
        reading: LEDGER_READING_TEXT.ledger_cannot_answer,
        caveat: LEDGER_CHECK_CAVEAT,
        after: null,
        before: null,
      },
    });
    render(<LedgerCheckPanel area="chat" since={SINCE} />);

    await waitFor(() => expect(screen.getByTestId('ledger-reading')).toBeInTheDocument());
    const text = screen.getByTestId('ledger-panel').textContent ?? '';

    expect(text).toContain('Check the chat entry gate');
    expect(text).toContain('Business OS LLM settings changed');

    for (const kind of LEDGER_READINGS_WITH_COUNTS) {
      expect({ kind, present: text.includes(LEDGER_READING_TEXT[kind]) }).toEqual({
        kind,
        present: false,
      });
    }
    // No counts are rendered, because none were read.
    expect(screen.queryByTestId('ledger-counts')).not.toBeInTheDocument();
  });

  it('the panel holds no knowledge of WHICH areas the ledger can see', async () => {
    // The route short-circuits chat before any repository call; the client
    // renders the kind it is given. If this component ever grew its own chat
    // branch it could fall out of step with the one that decides.
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/business-os-llm/components/LedgerCheckPanel.tsx'),
      'utf8'
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/['"]chat['"]/);
  });
});

describe('RC-D: a refusal is a state, not an error', () => {
  it('renders the 24-hour bound as "too long ago to check", in the neutral tone', async () => {
    answer(400, {
      success: false,
      reason: 'too_long_ago',
      error:
        'The ledger check only works for a change made in the last 24 hours. For an older change, use the audit trail instead.',
    });
    render(<LedgerCheckPanel area="insights" since={SINCE} />);

    await waitFor(() => expect(screen.getByTestId('ledger-cannot-check')).toBeInTheDocument());
    const panel = screen.getByTestId('ledger-panel');

    expect(panel).toHaveTextContent('Too long ago to check');
    // The route's own explanation, so the limit is stated once.
    expect(panel).toHaveTextContent('a change made in the last 24 hours');

    // NOT an error: no error state, and no red anywhere in the panel. (The old
    // assertion read the wrapper's own className, which is `space-y-1` — it
    // could not have failed. F-6.)
    expect(screen.queryByTestId('ledger-failed')).not.toBeInTheDocument();
    expect(panel.innerHTML).not.toMatch(/text-red-|bg-red-|border-red-/);

    // F-9: the answer is monotonic — a change only gets older — so re-running
    // can only produce the same refusal.
    expect(screen.getByRole('button', { name: /check again/i })).toBeDisabled();
  });

  it('a real failure says it is the CHECK that failed, not that the area is quiet', async () => {
    answer(500, { success: false, error: 'boom' });
    render(<LedgerCheckPanel area="insights" since={SINCE} />);

    await waitFor(() => expect(screen.getByTestId('ledger-failed')).toBeInTheDocument());
    expect(screen.getByTestId('ledger-failed')).toHaveTextContent(
      'That says nothing about this area'
    );
  });

  it('an area with no stored row reads nothing at all', async () => {
    const fetchMock = answer(200, reading('no_traffic_either', { after: 0, before: 0 }));
    render(<LedgerCheckPanel area="insights" since={null} />);

    await waitFor(() => expect(screen.getByTestId('ledger-no-change')).toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/**
 * R-T19 / FR-20 / C-2 — ADDED 2026-09-24, and the only reason it is an
 * addition rather than an edit.
 *
 * `PROPAGATION_NOTE` had exactly one rendered assertion, and it was on the
 * PAGE (S2-T11, reached through `getByTestId('ledger-panel')`), not here.
 * Parking the panel (FR-3) re-points that assertion at the page header — where
 * only the ~60-second clause survives, because the constant's second clause is
 * ledger-specific. Without this test the sentence "the ledger check only starts
 * counting after that" would have no coverage at all for as long as the panel
 * is unmounted, which is precisely the accident R-D exists to catch, one layer
 * down.
 *
 * Nothing else in this file is touched: SA F-6's eight-branch table and RC-D's
 * neutral-tone assertion render the component DIRECTLY, so parking does not
 * reach them.
 */
describe('R-T19: the parked panel still carries the whole propagation note', () => {
  it('states the ~60 seconds AND what the ledger check does with it', async () => {
    answer(200, reading('stopped_with_before', { after: 0, before: 30 }));
    render(<LedgerCheckPanel area="insights" since={SINCE} />);

    const panel = await screen.findByTestId('ledger-panel');
    expect(panel).toHaveTextContent('Running instances pick a change up within about 60 seconds');
    expect(panel).toHaveTextContent('The ledger check only starts counting after that');
    expect(panel).toHaveTextContent('a check run sooner has nothing to count yet');
  });
});
