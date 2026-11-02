/**
 * @jest-environment jsdom
 *
 * The agent row IS the control, and the panel says what the agent is for.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT CHANGED AND WHY IT NEEDS PINNING
 *
 * An agent's settings used to be reachable only through a pencil in the
 * schedule cell: one small target, in one column, for the only way in. A row
 * of seven columns reads as a single thing, so the thing an owner presses
 * should be the row.
 *
 * Three of these are easy to break by accident, which is what this file is
 * for:
 *
 *   1. PAUSE AND REMOVE MUST NOT OPEN THE ROW. They sit inside the row that is
 *      now a button, so without the event being stopped, pausing an agent also
 *      expands its settings underneath, and removing one opens a confirm
 *      dialog over a row that just expanded behind it. The insulation is on the
 *      cell, so this breaks silently the moment someone moves a control out of
 *      it.
 *
 *   2. THE KEYBOARD. A `<tr>` is not focusable and does not fire on Enter, so
 *      making a row clickable with `onClick` alone hands mouse users a feature
 *      and keyboard users nothing. Space has to be prevented too or the page
 *      scrolls instead.
 *
 *   3. THE DESCRIPTION. The table answers every, next, last and stops-after,
 *      and none of them says what the agent is FOR — so an owner opening the
 *      panel to change a cadence was adjusting the rhythm of something
 *      described by a three-word name. It is in the panel rather than the
 *      table because a sentence per row buries the numbers the table exists
 *      for.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('@/lib/business-os/LanguageContext', () => {
  const { translations } = jest.requireActual('@/lib/business-os/LanguageContext');
  return {
    useLanguage: () => ({
      language: 'en',
      isRTL: false,
      t: (key: string, vars?: Record<string, string | number>) => {
        let text = (translations.en as Record<string, string>)[key] || key;
        for (const [k, v] of Object.entries(vars ?? {})) {
          text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
        }
        return text;
      },
      formatCurrency: (amount: number) => `₪${amount}`,
    }),
  };
});

jest.mock('@/components/UserProvider', () => ({
  useAuth: () => ({ connectedPlugins: { 'google-mail': { name: 'Gmail' } }, refreshPlugins: jest.fn() }),
}));

jest.mock('@/hooks/usePluginRepair', () => ({
  usePluginRepair: () => ({ repairing: null, repair: jest.fn() }),
}));

import { RunningAgentsCard } from '../RunningAgentsCard';

const AGENT = {
  agentId: 'agent-1',
  automationId: 'draft_client_replies',
  family: 'adopted',
  name: 'Draft replies to client emails',
  description: 'Reads replies your clients send back and leaves you a draft answer.',
  watches: 'Replies from clients you have emailed',
  scheduleWords: 'Every day',
  plugins: ['business-os', 'google-mail'],
  status: 'active',
  lastRun: null,
  nextRun: null,
  cadence: 'daily',
  stopAfterDays: 14,
  blocked: false,
  requires: null,
  missingPlugins: [],
  stopped: null,
  schedule: { every: 1, unit: 'days' },
  stopAfter: { every: 14, unit: 'days' },
  cadenceRange: { min: { every: 1, unit: 'hours' }, max: { every: 30, unit: 'days' } },
  stopRange: { min: { every: 1, unit: 'days' }, max: { every: 90, unit: 'days' } },
};

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: [AGENT], available: [] }),
  });
  global.fetch = fetchMock as unknown as typeof fetch;
});

/** Render and wait for the one agent to arrive. */
const listed = async () => {
  render(<RunningAgentsCard />);
  await waitFor(() => expect(screen.getByText(AGENT.name)).toBeInTheDocument());
  return screen.getByText(AGENT.name).closest('tr') as HTMLElement;
};

describe('the row opens the settings', () => {
  it('is announced as a control, collapsed', async () => {
    const row = await listed();

    expect(row).toHaveAttribute('role', 'button');
    expect(row).toHaveAttribute('aria-expanded', 'false');
    /* Focusable, which a <tr> is not by default. */
    expect(row).toHaveAttribute('tabindex', '0');
  });

  it('expands when the row is pressed', async () => {
    const row = await listed();

    fireEvent.click(row);

    await waitFor(() => expect(row).toHaveAttribute('aria-expanded', 'true'));
  });

  it('expands from the keyboard, and Space does not scroll the page', async () => {
    const row = await listed();

    const event = createEvent(' ');
    row.dispatchEvent(event);

    await waitFor(() => expect(row).toHaveAttribute('aria-expanded', 'true'));
    expect(event.defaultPrevented).toBe(true);
  });

  it('closes again when pressed a second time', async () => {
    const row = await listed();

    fireEvent.click(row);
    await waitFor(() => expect(row).toHaveAttribute('aria-expanded', 'true'));

    fireEvent.click(row);
    await waitFor(() => expect(row).toHaveAttribute('aria-expanded', 'false'));
  });
});

describe('the controls inside it are still their own', () => {
  it('pausing does not also expand the row', async () => {
    const row = await listed();

    fireEvent.click(screen.getByLabelText(/pause/i));

    /* The pause request went out, and the settings stayed shut. */
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(row).toHaveAttribute('aria-expanded', 'false');
  });

  it('removing does not also expand the row', async () => {
    const row = await listed();

    fireEvent.click(screen.getByLabelText(/remove/i));

    expect(row).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('what the panel says', () => {
  it('leads with what the agent is for', async () => {
    const row = await listed();

    expect(screen.queryByText(AGENT.description)).not.toBeInTheDocument();

    fireEvent.click(row);

    await waitFor(() => expect(screen.getByText(AGENT.description)).toBeInTheDocument());
  });

  it('shows no description when the agent has none', async () => {
    /* An agent the owner built themselves may have nothing to say, and an
       empty paragraph is padding above the controls for nothing. */
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: [{ ...AGENT, description: '' }], available: [] }),
    });

    const row = await listed();
    fireEvent.click(row);

    await waitFor(() => expect(row).toHaveAttribute('aria-expanded', 'true'));
    expect(screen.queryByText(AGENT.description)).not.toBeInTheDocument();
  });
});

/** A cancelable keydown, which `fireEvent.keyDown` does not report back on. */
function createEvent(key: string): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
}

describe('the table pages, five at a time', () => {
  /** `count` agents, each distinguishable by name. */
  const many = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      ...AGENT,
      agentId: `agent-${i + 1}`,
      name: `Agent number ${i + 1}`,
    }));

  const listOf = async (count: number) => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: many(count), available: [] }),
    });
    render(<RunningAgentsCard />);
    await waitFor(() => expect(screen.getByText('Agent number 1')).toBeInTheDocument());
  };

  it('shows five and holds the sixth back', async () => {
    await listOf(12);

    expect(screen.getByText('Agent number 5')).toBeInTheDocument();
    expect(screen.queryByText('Agent number 6')).not.toBeInTheDocument();
  });

  it('says where in the list the owner is, not just the page number', async () => {
    await listOf(12);

    expect(screen.getByText('1–5 of 12')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/next page/i));

    await waitFor(() => expect(screen.getByText('6–10 of 12')).toBeInTheDocument());
    expect(screen.getByText('Agent number 6')).toBeInTheDocument();
    expect(screen.queryByText('Agent number 5')).not.toBeInTheDocument();
  });

  it('counts the last page honestly when it is short', async () => {
    await listOf(12);

    fireEvent.click(screen.getByLabelText(/next page/i));
    await waitFor(() => expect(screen.getByText('6–10 of 12')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/next page/i));

    /* Two rows, not five: the range has to follow what is rendered. */
    await waitFor(() => expect(screen.getByText('11–12 of 12')).toBeInTheDocument());
  });

  it('stops at both ends', async () => {
    await listOf(12);

    expect(screen.getByLabelText(/previous page/i)).toBeDisabled();

    fireEvent.click(screen.getByLabelText(/next page/i));
    await waitFor(() => expect(screen.getByLabelText(/previous page/i)).toBeEnabled());
    fireEvent.click(screen.getByLabelText(/next page/i));

    await waitFor(() => expect(screen.getByLabelText(/next page/i)).toBeDisabled());
  });

  it('shows no pager at all for a list that fits', async () => {
    /* "1 of 1" with two dead arrows under three agents is chrome that explains
       nothing. */
    await listOf(3);

    expect(screen.queryByLabelText(/next page/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/of 3/)).not.toBeInTheDocument();
  });

  it('closes an open editor when the page changes', async () => {
    /*
     * The row it belonged to is no longer on screen, and leaving it open would
     * save a schedule against an agent the owner can no longer see.
     */
    await listOf(12);

    const row = screen.getByText('Agent number 1').closest('tr') as HTMLElement;
    fireEvent.click(row);
    await waitFor(() => expect(screen.getByText(AGENT.description)).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText(/next page/i));

    await waitFor(() => expect(screen.getByText('Agent number 6')).toBeInTheDocument());
    expect(screen.queryByText(AGENT.description)).not.toBeInTheDocument();
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "I REMOVED THE RECEPTIONIST AND IN THE AVAILABLE THERE IS ONLY THE GMAIL"
 *
 * The mail agent exists once per provider and is offered as ONE row, with the
 * choice of mailbox inside the install dialog. Two things made that choice
 * unreachable on an account that already had Gmail connected, and both looked
 * fine in isolation:
 *
 *   1. the dialog opened only when a plugin was missing or the agent had
 *      inputs. A mail agent with Gmail live has neither — nothing missing, no
 *      inputs — so "Switch it on" installed the Gmail variant on the spot and
 *      the chooser never rendered;
 *
 *   2. the row's icons came from the CHOSEN variant's grant, which for that
 *      account is `['business-os', 'google-mail']`. So the row painted a Gmail
 *      icon and no Outlook one — which is literally what was reported.
 *
 * Neither was caught by the server-side tests, which assert the row CARRIES
 * both options. It did. Nothing showed them.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('an agent that could read either mailbox', () => {
  const EITHER = [
    { plugin: 'google-mail', automationId: 'draft_client_replies', connected: true },
    { plugin: 'outlook', automationId: 'draft_client_replies_outlook', connected: false },
  ];

  const OFFERED = {
    automationId: 'draft_client_replies',
    name: 'Draft replies to client emails',
    description: 'Reads replies your clients send back.',
    watches: 'Replies from clients you have emailed',
    /* The chosen variant's grant: one mailbox, which is the trap. */
    plugins: ['business-os', 'google-mail'],
    missingPlugins: [],
    worksAlongside: null,
    inputs: [],
    connectEither: EITHER,
  };

  const offer = async (over: Record<string, unknown> = {}) => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: [], available: [{ ...OFFERED, ...over }] }),
    });
    render(<RunningAgentsCard />);
    await waitFor(() => expect(screen.getByText(OFFERED.name)).toBeInTheDocument());
  };

  it('asks which mailbox instead of installing one on the spot', async () => {
    await offer();

    fireEvent.click(screen.getByText(/switch it on/i));

    /* The dialog, not an install request. */
    await waitFor(() =>
      expect(screen.getByText(/which mailbox should this agent read/i)).toBeInTheDocument()
    );
    /* One GET for the list, and nothing posted. */
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('offers both and pre-selects NEITHER', async () => {
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * A CONNECTION IS NOT CONSENT, and this is the assertion that says so.
     *
     * An earlier version pre-selected whichever mailbox was already connected,
     * so the owner "did not have to think about it". But plugin connections
     * are shared across the whole platform: Gmail may be connected for the
     * website enquiry channel, or a workflow, or last year's experiment, while
     * the business's client correspondence runs through Outlook.
     *
     * And this agent READS a mailbox — it works out who is a client and drafts
     * replies to them. Pointed at the wrong one by a default nobody chose, it
     * reads correspondence the owner never offered it. So the question is
     * asked, and the tick only says which answer needs no connecting.
     * ─────────────────────────────────────────────────────────────────────────
     */
    await offer();
    fireEvent.click(screen.getByText(/switch it on/i));

    await waitFor(() => expect(screen.getByRole('button', { name: /Gmail/i })).toBeInTheDocument());

    expect(screen.getByRole('button', { name: /Gmail/i })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    expect(screen.getByRole('button', { name: /outlook/i })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  it('will not install until one is picked', async () => {
    await offer();
    fireEvent.click(screen.getByText(/switch it on/i));
    await waitFor(() => expect(screen.getByRole('button', { name: /Gmail/i })).toBeInTheDocument());

    /* Nothing chosen: the confirm cannot commit the agent to a mailbox. */
    const confirm = screen.getByRole('button', { name: /^(switch it on|activate)/i });
    expect(confirm).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /Gmail/i }));

    await waitFor(() => expect(confirm).toBeEnabled());
  });

  it('installs the variant the owner picked, not the row it opened', async () => {
    await offer();
    fireEvent.click(screen.getByText(/switch it on/i));
    await waitFor(() => expect(screen.getByRole('button', { name: /Gmail/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Gmail/i }));

    const confirm = screen.getByRole('button', { name: /^(switch it on|activate)/i });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const body = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(body.automationId).toBe('draft_client_replies');
  });

  it('shows an icon for every mailbox it could read, not just the chosen one', async () => {
    await offer();

    const icons = document.querySelectorAll('img[src*="outlook"], [data-plugin-id="outlook"]');
    /* Outlook appears on the row even though the grant names only Gmail. */
    expect(icons.length).toBeGreaterThan(0);
  });

  it('still installs directly when there is no choice to make', async () => {
    /* The behaviour this must not cost: an agent with one provider, nothing
       missing and no inputs is one press, not a dialog. */
    await offer({ connectEither: undefined, plugins: ['business-os'] });

    fireEvent.click(screen.getByText(/switch it on/i));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'POST' });
    expect(screen.queryByText(/which mailbox should this agent read/i)).not.toBeInTheDocument();
  });
});
