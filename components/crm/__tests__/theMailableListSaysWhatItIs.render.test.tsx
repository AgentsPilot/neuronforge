/**
 * @jest-environment jsdom
 *
 * The mailable-audience list reads as sentences, not as column values.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Reported by the owner looking at a two-row list: "it is hard to understand".
 * Four things were fighting on one screen.
 *
 *   · the raw `source` column was printed — `website_booking`, `consent`,
 *     `footer_form`. Three vocabularies, none of them language;
 *   · the page header said "client list, manage your contacts and
 *     relationships", which is the CONTACTS view talking. This list is neither
 *     all contacts nor about relationships: it is about permission;
 *   · one slot carried both "contact" (who they are) and "confirmed" (the
 *     state of their consent), same position, same styling;
 *   · the sentence explaining the screen existed only in the empty state, so
 *     it vanished at exactly the moment rows made it needed.
 *
 * `source` is written by several flows and by `crm_contacts` too, so the set is
 * open — which is why the fallback is tested as carefully as the known values.
 */

import React from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const COPY: Record<string, string> = {
  'crm.subscribers.title': 'People you may email',
  'crm.subscribers.subtitle': 'Everyone who agreed to hear from you.',
  'crm.subscribers.show_promoted': 'Include people already in the CRM',
  'crm.subscribers.subscribed_on': 'Subscribed',
  'crm.subscribers.status_contact': 'Contact',
  'crm.subscribers.status_confirmed': 'Confirmed',
  'crm.subscribers.promote': 'Add to the CRM',
  'crm.subscribers.source.website_booking': 'Booked on your website',
  'crm.subscribers.source.consent': 'Ticked the consent box',
  'crm.subscribers.source.unknown': 'Agreed to be emailed',
  'crm.subscribers.empty': 'Nobody has agreed to be emailed yet.',
  'crm.subscribers.empty_filtered': 'Everyone who agreed is already in your CRM.',
};

jest.mock('@/lib/business-os/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => COPY[key] ?? key, isRTL: false, language: 'en' }),
}));

jest.mock('@/components/ui/switch', () => ({
  Switch: (props: Record<string, unknown>) => <input type="checkbox" {...(props as object)} />,
}));

import { CRMSubscriberList } from '@/components/crm/CRMSubscriberList';

/** The two rows from the reported screenshot. */
const SUBSCRIBERS = [
  {
    id: 'a',
    email: 'offir.omer@tenafly-tg.com',
    name: 'David the King',
    status: 'contact',
    source: 'website_booking',
    subscribed_at: '2026-10-21T10:00:00Z',
    confirmed_at: null,
    promoted_contact_id: 'contact-1',
    mailable: true,
  },
  {
    id: 'b',
    email: 'offir.omer@windpoint.io',
    name: null,
    status: 'confirmed',
    source: 'consent',
    subscribed_at: '2026-10-08T10:00:00Z',
    confirmed_at: '2026-10-08T10:00:00Z',
    promoted_contact_id: null,
    mailable: true,
  },
];

function renderList(subscribers: unknown[] = SUBSCRIBERS) {
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, subscribers }) } as Response)
  ) as unknown as typeof fetch;

  render(<CRMSubscriberList />);
}

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

describe('the heading', () => {
  it('says what this list is, and keeps saying it once there are rows', async () => {
    renderList();

    expect(await screen.findByText('People you may email')).toBeInTheDocument();
    expect(screen.getByText('Everyone who agreed to hear from you.')).toBeInTheDocument();
  });
});

describe('how each person arrived', () => {
  it('is a sentence, never the column value', async () => {
    renderList();

    expect(await screen.findByText(/Booked on your website/)).toBeInTheDocument();
    expect(screen.getByText(/Ticked the consent box/)).toBeInTheDocument();

    expect(screen.queryByText(/website_booking/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^consent$/)).not.toBeInTheDocument();
  });

  it('falls back to a sentence for a source nobody has translated', async () => {
    renderList([{ ...SUBSCRIBERS[1], id: 'c', source: 'some_new_flow' }]);

    expect(await screen.findByText(/Agreed to be emailed/)).toBeInTheDocument();
    /* The failure this guards: a snake_case token on screen. */
    expect(screen.queryByText(/some_new_flow/)).not.toBeInTheDocument();
  });

  it('and for a source that is missing entirely', async () => {
    renderList([{ ...SUBSCRIBERS[1], id: 'd', source: null }]);

    expect(await screen.findByText(/Agreed to be emailed/)).toBeInTheDocument();
  });

  it('carries the date with it, on the same line', async () => {
    renderList();

    const line = await screen.findByText(/Booked on your website/);
    expect(line.textContent).toMatch(/Subscribed/);
  });
});

describe('the two questions stay apart', () => {
  it('keeps the consent status in its own slot', async () => {
    renderList();

    expect(await screen.findByText('Contact')).toBeInTheDocument();
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
  });

  it('does not put the arrival phrase in the status slot', async () => {
    renderList();

    const status = await screen.findByText('Confirmed');
    expect(status.textContent).not.toMatch(/Ticked the consent box/);
  });
});

describe('the button that does something to a person', () => {
  it('is offered only to someone who is not already a contact', async () => {
    renderList();

    await waitFor(() => expect(screen.getAllByText(/@/).length).toBeGreaterThan(0));
    /* One button for the consent-only row; none for the one already in the CRM. */
    expect(screen.getAllByRole('button', { name: 'Add to the CRM' })).toHaveLength(1);
  });

  it('is named for the state it produces, not for the table it writes to', () => {
    /*
     * It said "Move to pipeline" / "העברה לפייפליין", and the owner asked what
     * that meant — twice. "Pipeline" is a word this screen never otherwise
     * uses: the chip on the rows it has already happened to says "In the CRM",
     * and the switch above says "Include people already in the CRM". So the
     * verb now matches both, and pressing it visibly produces the thing the
     * label named.
     *
     * Asserted on the translation files rather than the DOM, because the DOM
     * here is fed by this test's own copy map and would agree with anything.
     */
    const read = (locale: string) =>
      require('fs').readFileSync(
        require('path').join(process.cwd(), 'lib', 'business-os', 'translations', `${locale}.ts`),
        'utf8'
      );

    for (const [locale, label] of [
      ['en', "'crm.subscribers.promote': 'Add to the CRM'"],
      ['he', "'crm.subscribers.promote': 'הוספה ל-CRM'"],
      ['es', "'crm.subscribers.promote': 'Añadir al CRM'"],
    ] as const) {
      expect(read(locale)).toContain(label);
    }

    /* And the jargon is gone from all three, in-flight label included. */
    for (const locale of ['en', 'he', 'es']) {
      const line = read(locale)
        .split('\n')
        .filter((l: string) => l.includes("'crm.subscribers.promot"))
        .join(' ');

      expect(line).not.toMatch(/pipeline|pipeláine|פייפליין/i);
    }
  });
});

describe('it opens on the people not yet in the CRM', () => {
  it('asks the route to exclude them by default', async () => {
    renderList();

    await waitFor(() => expect(global.fetch as jest.Mock).toHaveBeenCalled());
    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(String(url)).toContain('includePromoted=false');
  });

  it('and when that leaves nothing, says so and names the switch', async () => {
    /*
     * The failure this guards is on the record: defaulting to hidden is what
     * once showed an empty screen to an account with nine consented people.
     * The default is back; the dead end is not.
     */
    renderList([]);

    expect(await screen.findByText('Everyone who agreed is already in your CRM.')).toBeInTheDocument();
    expect(screen.queryByText('Nobody has agreed to be emailed yet.')).not.toBeInTheDocument();
  });
});
