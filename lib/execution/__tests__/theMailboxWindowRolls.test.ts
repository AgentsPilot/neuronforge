/**
 * The mailbox agent's search window is a width, not a date.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 *
 * Setup wrote the bound once: `mail_since` as an instant and `after:YYYY/MM/DD`
 * inside the Gmail query, both from `rule.since` — the day setup happened to
 * run. A fixed point is not a window. Measured on a live channel four days
 * after setup it was four days wide, and it widens by one more every day.
 *
 * With `max_results: 100` on the search, that fails in the worst available
 * way: past the cap the provider stops returning the oldest mail and the agent
 * sees a short list, which is indistinguishable from an empty inbox. Nothing
 * errors, nothing is logged, and enquiries stop being filed.
 *
 * So the owner chooses a WIDTH — the same "when to stop" an adopted agent
 * asks — and it is recomputed on every run. A width stored once would just be
 * a fixed date again.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const getInputValues = jest.fn();

jest.mock('@/lib/repositories/AgentConfigurationRepository', () => ({
  agentConfigurationRepository: {
    getInputValues: (...a: unknown[]) => getInputValues(...a),
  },
}));

import { inputsFor } from '../inputsFor';
import { INBOX_STOP_AFTER_CHOICES, INBOX_STOP_AFTER_DEFAULT } from '@/lib/business-os/leads/inboxProviders';
import { STOP_RANGE } from '@/lib/business-os/schedule/ranges';
import { intervalMinutes } from '@/lib/business-os/schedule/interval';

/** The values setup stored, with their bound frozen in 2026. */
const STORED = {
  mail_query: 'from:forms@example.com subject:"New enquiry" is:unread after:2026/1/4',
  mail_from: 'forms@example.com',
  mail_subject_prefix: 'New enquiry',
  mail_since: '2026-01-04T00:00:00.000Z',
  enquiry_template: { subjectPrefix: 'New enquiry', labels: ['Name'] },
};

function mailboxAgent(stopAfterDays?: number) {
  return {
    id: 'agent-1',
    user_id: 'owner-1',
    agent_config: { inbox_channel: { provider: 'google-mail', ...(stopAfterDays !== undefined ? { stopAfterDays } : {}) } },
  };
}

const daysAgo = (iso: string) => Math.round((Date.now() - Date.parse(iso)) / 86_400_000);

beforeEach(() => {
  jest.clearAllMocks();
  getInputValues.mockResolvedValue({ data: { input_values: STORED }, error: null });
});

describe('the window is the owner chosen width', () => {
  it.each(INBOX_STOP_AFTER_CHOICES)('%i days becomes a bound %i days back', async (days) => {
    const values = await inputsFor(mailboxAgent(days));

    expect(daysAgo(values.mail_since as string)).toBe(days);
  });

  it('rewrites the Gmail after: to the same day', async () => {
    const values = await inputsFor(mailboxAgent(7));

    const since = new Date(values.mail_since as string);
    const stamp = `${since.getUTCFullYear()}/${since.getUTCMonth() + 1}/${since.getUTCDate()}`;

    expect(values.mail_query).toContain(`after:${stamp}`);
    /* And the frozen one is gone, rather than a second bound being appended. */
    expect(values.mail_query).not.toContain('after:2026/1/4');
    expect(String(values.mail_query).match(/after:/g)).toHaveLength(1);
  });

  it('leaves everything else setup measured alone', async () => {
    /* The sender, the subject phrase and `is:unread` were learned from the
       owner's own mail. Only the bound moves. */
    const values = await inputsFor(mailboxAgent(30));

    expect(values.mail_query).toContain('from:forms@example.com');
    expect(values.mail_query).toContain('subject:"New enquiry"');
    expect(values.mail_query).toContain('is:unread');
    expect(values.mail_from).toBe(STORED.mail_from);
    expect(values.enquiry_template).toEqual(STORED.enquiry_template);
  });

  it('falls back to the default when the owner never chose', async () => {
    /* A channel installed before the question was asked. Absent never meant
       "no bound" — it meant the setup date, which is worse. */
    const values = await inputsFor(mailboxAgent());

    expect(daysAgo(values.mail_since as string)).toBe(INBOX_STOP_AFTER_DEFAULT);
  });

  it('moves a width past the ceiling down to the ceiling', async () => {
    /*
     * CLAMPED, where this used to fall back to the default.
     *
     * The old check was `CHOICES.includes(...)`, which treated anything not on
     * the list as absent — so an owner asking for the widest window they could
     * imagine got the middle one. The control takes a number now, so the
     * direction of the answer is information: "as far back as you can" becomes
     * the furthest the channel offers, not the default.
     */
    const values = await inputsFor(mailboxAgent(9999));

    /*
     * Two years, which is the PLATFORM's ceiling rather than the channel's.
     *
     * This read 90 while the mailbox carried its own range. Every agent shares
     * one pair of bounds now — see `lib/business-os/schedule/ranges` — because
     * three agents on one screen offering three different controls read as two
     * of them being broken.
     */
    expect(daysAgo(values.mail_since as string)).toBe(
      intervalMinutes(STOP_RANGE.max) / 1440
    );
  });

  it('keeps a width that was never on the list', async () => {
    /* Twenty days sat between two chips and was discarded. It is a real answer
       now, and the only thing that matters is that it is inside the range. */
    const values = await inputsFor(mailboxAgent(20));

    expect(daysAgo(values.mail_since as string)).toBe(20);
  });
});

describe('the window can be measured in hours', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * The one surface that may offer hours. An adopted agent's bound reaches
   * BizQL as a whole number of days inside a `$date` offset, so hours there
   * would be a fractional day. The mailbox hands an ISO instant to a mail
   * search, where an hour is as expressible as a day — and "anything unread
   * from before this morning has been dealt with" is a real answer for a busy
   * inbox.
   *
   * It has to come off `stopAfter`, because twelve hours rounds to one day in
   * `stopAfterDays` and a whole day of mail is not what was asked for.
   * ───────────────────────────────────────────────────────────────────────────
   */

  const hoursAgo = (iso: string) => Math.round((Date.now() - Date.parse(iso)) / 3_600_000);

  function withStopAfter(stopAfter: string, stopAfterDays?: number) {
    return {
      id: 'agent-1',
      user_id: 'owner-1',
      agent_config: {
        inbox_channel: { provider: 'google-mail', stopAfter, ...(stopAfterDays ? { stopAfterDays } : {}) },
      },
    };
  }

  it('reads twelve hours as twelve hours', async () => {
    const values = await inputsFor(withStopAfter('12h'));

    expect(hoursAgo(values.mail_since as string)).toBe(12);
  });

  it('prefers the interval over the rounded day count beside it', async () => {
    /* Both are written, and `stopAfterDays` is the lossy one: it says 1 for a
       twelve-hour window because that field cannot hold half a day. */
    const values = await inputsFor(withStopAfter('12h', 1));

    expect(hoursAgo(values.mail_since as string)).toBe(12);
  });

  it('falls back to the day count when there is no interval', async () => {
    /* Every channel installed before the control asked for a number. */
    const values = await inputsFor(mailboxAgent(14));

    expect(daysAgo(values.mail_since as string)).toBe(14);
  });

  it('clamps an hour count below the floor', async () => {
    /* One hour is faster than the channel offers to look back, and a window
       narrower than the floor would miss mail the sweep was meant to catch. */
    const values = await inputsFor(withStopAfter('1h'));

    expect(hoursAgo(values.mail_since as string)).toBe(12);
  });
});

describe('it is a width, not a date', () => {
  it('moves forward between two runs', async () => {
    /*
     * THE WHOLE POINT. The bound has to be further forward on a later run, or
     * it is a fixed date wearing a width's clothes.
     */
    const first = await inputsFor(mailboxAgent(7));

    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 3 * 86_400_000;
      const later = await inputsFor(mailboxAgent(7));

      expect(Date.parse(later.mail_since as string)).toBeGreaterThan(
        Date.parse(first.mail_since as string)
      );
      /* And still exactly seven days wide, three days later. */
      expect(
        Math.round((realNow() + 3 * 86_400_000 - Date.parse(later.mail_since as string)) / 86_400_000)
      ).toBe(7);
    } finally {
      Date.now = realNow;
    }
  });
});

describe('what it does not touch', () => {
  it('leaves a query it did not phrase alone', async () => {
    /*
     * No `after:` means something other than `gmailQuery` wrote this. Appending
     * a bound to a string we did not author is how a search silently stops
     * matching anything.
     */
    getInputValues.mockResolvedValue({
      data: { input_values: { ...STORED, mail_query: 'label:enquiries is:unread' } },
      error: null,
    });

    const values = await inputsFor(mailboxAgent(7));

    expect(values.mail_query).toBe('label:enquiries is:unread');
    /* `mail_since` is still rolled — Outlook reads that one, and it is a field
       rather than a string we have to parse. */
    expect(daysAgo(values.mail_since as string)).toBe(7);
  });

  it('leaves a prompt-created agent untouched', async () => {
    const values = await inputsFor({ id: 'a', user_id: 'o', agent_config: null });

    expect(values).toEqual(STORED);
    expect(values.mail_since).toBe(STORED.mail_since);
  });
});
