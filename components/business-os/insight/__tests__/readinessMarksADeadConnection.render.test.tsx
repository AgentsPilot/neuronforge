/**
 * @jest-environment jsdom
 *
 * A dead connection is marked on the one line the owner already sees.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG, MEASURED ON A LIVE ACCOUNT
 *
 * The mailbox agent's Gmail token expired. Its runs failed five times, the
 * queue gave up, and no surface above the fold said anything: the readiness
 * strip still read "You are ready for clients" with a green tick. Enquiries
 * were not being filed the whole time, and the only honest report of it was in
 * the agents list, 2,900 lines down the page.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THREE THINGS THIS PINS
 *
 *   1. the strip says the FAULT instead of the reassurance, and goes amber —
 *      a reader who has learned to skim a green tick needs the shape to change
 *      before the words get read;
 *   2. it STAYS COLLAPSED. This is the requirement that is easiest to break by
 *      accident, by making the fault count towards `ready`. Opening the full
 *      chain would push the day's work down the page to report something
 *      repaired in one click;
 *   3. the counts that normally sit on that line are dropped, because a tally
 *      of optional improvements beside a dead connection invites a comparison
 *      between two things that are not comparable.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';

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

import { SystemReadiness, type ReadinessAttention } from '../SystemReadiness';
import type { SetupItem } from '../LiveDashboard';

/**
 * A business whose setup is finished, so the strip is collapsible.
 *
 * Every mandatory step completed: `isReadyForClients` is asked of the graph,
 * not of a flag, so the items have to be real step ids.
 */
const READY_ITEMS: SetupItem[] = [
  { id: 'services', title: 'Services', description: '', completed: true },
  { id: 'availability', title: 'Hours', description: '', completed: true },
  { id: 'timezone', title: 'Timezone', description: '', completed: true },
  { id: 'website', title: 'Website', description: '', completed: true },
  { id: 'profile', title: 'Business details', description: '', completed: true },
];

const gmailDown: ReadinessAttention = {
  key: 'google-mail',
  title: 'Gmail needs reconnecting',
  detail: 'Your agents cannot use Gmail until you sign in again, so anything that depends on it has stopped.',
  actionLabel: 'Reconnect',
};

const strip = () => screen.getByRole('button', { name: /reconnecting|ready for clients/i });

describe('the collapsed strip', () => {
  it('says nothing is wrong when nothing is', () => {
    /* The control. Without it, a test that finds the fault proves only that
       the component renders text it was handed. */
    render(<SystemReadiness items={READY_ITEMS} collapsible />);

    expect(screen.getByText('You are ready for clients')).toBeInTheDocument();
  });

  it('names the dead connection instead of the reassurance', () => {
    /* THE BUG, as one assertion. The strip claimed readiness while the
       business could not receive an enquiry. */
    render(<SystemReadiness items={READY_ITEMS} attention={[gmailDown]} collapsible />);

    expect(screen.getByText('Gmail needs reconnecting')).toBeInTheDocument();
    expect(screen.queryByText('You are ready for clients')).not.toBeInTheDocument();
  });

  it('stays collapsed, and remains a door', () => {
    /*
     * The requirement most easily broken by accident: making the fault count
     * towards `ready` would open the whole chain and shove the day's work
     * down the page. It must stay one line, and that line must still open.
     */
    render(<SystemReadiness items={READY_ITEMS} attention={[gmailDown]} collapsible />);

    expect(strip()).toHaveAttribute('aria-expanded', 'false');
    /* The expanded card's own control is absent while it is shut. */
    expect(screen.queryByRole('button', { name: 'Collapse' })).not.toBeInTheDocument();
  });

  it('drops the step tally while something is broken', () => {
    /* "5 steps completed" beside a dead mailbox asks the reader to weigh an
       improvement against the platform not working. */
    render(<SystemReadiness items={READY_ITEMS} attention={[gmailDown]} collapsible />);

    expect(screen.queryByText(/steps completed/i)).not.toBeInTheDocument();
  });

  it('counts a second fault rather than listing it', () => {
    /* One line has room for one name. */
    render(
      <SystemReadiness
        items={READY_ITEMS}
        attention={[gmailDown, { ...gmailDown, key: 'google-calendar', title: 'Google Calendar needs reconnecting' }]}
        collapsible
      />
    );

    expect(screen.getByText('Gmail needs reconnecting')).toBeInTheDocument();
    expect(screen.getByText(/1 more/)).toBeInTheDocument();
    expect(screen.queryByText('Google Calendar needs reconnecting')).not.toBeInTheDocument();
  });
});

describe('the repair', () => {
  it('offers the button once the line is opened, and asks for the right plugin', () => {
    const onRepair = jest.fn();

    render(
      <SystemReadiness items={READY_ITEMS} attention={[gmailDown]} onRepair={onRepair} collapsible />
    );

    fireEvent.click(strip());
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));

    /* The KEY, not the display name. The repair calls the plugin manager
       with it, and "Gmail" is not a plugin key. */
    expect(onRepair).toHaveBeenCalledWith('google-mail');
  });

  it('shows the fault in the uncollapsed position too', () => {
    /*
     * The card has two positions on the dashboard — the hero slot and the
     * collapsed strip above the needs-you row — and only one of them passes
     * `collapsible`. A fault must be visible in both.
     */
    render(<SystemReadiness items={READY_ITEMS} attention={[gmailDown]} />);

    expect(screen.getByText('Gmail needs reconnecting')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
  });

  it('cannot be pressed twice while it is working', () => {
    render(
      <SystemReadiness items={READY_ITEMS} attention={[{ ...gmailDown, busy: true }]} onRepair={jest.fn()} />
    );

    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeDisabled();
  });

  it('replaces the explanation with the failure, rather than stacking both', () => {
    /* Somebody who has just watched it fail does not need telling again what
       the problem was. */
    render(
      <SystemReadiness
        items={READY_ITEMS}
        attention={[{ ...gmailDown, error: 'We could not reconnect it just now. Please try again.' }]}
      />
    );

    expect(screen.getByText(/could not reconnect it just now/)).toBeInTheDocument();
    expect(screen.queryByText(/cannot use Gmail until you sign in/)).not.toBeInTheDocument();
  });
});
