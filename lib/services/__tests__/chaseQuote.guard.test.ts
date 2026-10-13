/**
 * Automation #6 follows up once, asks rather than chases, and never nudges
 * somebody about a decision they have already made.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This is the only automation in the registry that writes to a PROSPECT. The
 * other four address somebody who already has a relationship with the
 * business: an invoice they owe, a form they were sent, a meeting they booked.
 * A quote has been offered and not accepted, so getting it wrong costs the
 * sale rather than just the goodwill.
 *
 * Three ways it could be wrong, and each has a different shape:
 *
 *   answered   -> accepted, declined, withdrawn, superseded. A nudge now tells
 *                 the client nobody was paying attention.
 *   expired    -> the price was withdrawn by its own terms; inviting them to
 *                 act on it is inviting a conversation the business will lose.
 *   repeated   -> a sequence is a sales cadence, which is a different product
 *                 and a different consent.
 *
 * `chaseQuote` is module-private and sits on `supabaseServer` plus the send
 * service, so this guards the source. The one-nudge property is structural
 * rather than written — it falls out of the queue's dedupe — so it is asserted
 * against the repository that provides it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const source = read('lib/services/LeadResponseDispatchService.ts');

/** `chaseQuote`, from its signature to the start of the next function. */
const fn = source.slice(
  source.indexOf('async function chaseQuote'),
  source.indexOf('async function completeMeeting')
);

describe('chaseQuote', () => {
  it('is a real slice of the file, so these assertions mean something', () => {
    expect(fn.length).toBeGreaterThan(500);
  });

  it('is reached only by its own queue kind', () => {
    expect(source).toContain("if (row.kind === 'quote_chase') return chaseQuote(row, log);");
  });

  it('refuses a quote that has already been answered', () => {
    expect(fn).toMatch(/status !== 'sent' && status !== 'viewed'/);
    expect(fn).toContain("reason: 'already_answered'");
  });

  /*
   * The DATE, not the status. `expired` is written by whatever sweeps for it,
   * which may not have run — so a quote that lapsed yesterday can still be
   * sitting at `sent`.
   */
  it('checks the deadline itself rather than trusting the status', () => {
    expect(fn).toContain('proposal.valid_until');
    expect(fn).toContain("reason: 'quote_expired'");
  });

  it('goes through the shared send function, not its own email', () => {
    expect(fn).toContain('sendQuoteReminder(row.entity_id, row.user_id)');
    expect(fn).not.toMatch(/sendEmail|generateProposalEmail/);
  });

  /* An ordinary refusal is not an error, and must not be logged as one. */
  it('separates a reason not to send from a send that failed', () => {
    expect(fn).toContain("reason: 'send_failed'");
    expect(fn).toMatch(/already_answered' \|\| outcome\.reason === 'no_email'/);
  });
});

describe('the reminder itself', () => {
  const service = read('lib/services/ProposalSendService.ts');
  const send = service.slice(service.indexOf('export async function sendQuoteReminder'));

  /*
   * The whole reason this is not `sendProposal`. Re-issuing the quote leaves
   * the client holding two documents and wondering which is current.
   */
  it('is not a second copy of the quote', () => {
    expect(send).toContain('generateQuoteReminderEmail');
    expect(send).not.toContain('generateProposalEmail');
  });

  /*
   * The 72-hour window the gap measures runs from `sent_at`. Touching it would
   * make the quote look freshly sent and the gap would forget it ever waited.
   */
  it('does not restamp the quote as newly sent', () => {
    expect(send).not.toMatch(/sent_at:/);
    expect(send).not.toMatch(/status: 'sent'/);
  });

  it('points at the page the client already has', () => {
    expect(send).toContain('generateProposalToken');
    expect(send).toContain('/proposal/${token}');
  });

  it('re-checks the status here too, as the last stop before an email leaves', () => {
    expect(send).toMatch(/status !== 'sent' && proposal\.status !== 'viewed'/);
  });
});

describe('one nudge per quote, ever', () => {
  /*
   * Structural, not written: `hasRowFor` matches on (kind, contact, entity)
   * with NO status filter, so once a `quote_chase` row exists for a proposal
   * the sweep never queues a second — whatever happened to the first.
   *
   * Asserted against the repository because that is where the property lives.
   * A status filter added there would turn this automation into a sequence
   * without anybody editing it.
   */
  it('rests on a dedupe that ignores the row status', () => {
    const repo = read('lib/repositories/LeadResponseRepository.ts');
    const hasRowFor = repo.slice(repo.indexOf('async hasRowFor'), repo.indexOf('/** What is queued for these contacts'));

    expect(hasRowFor).toContain(".eq('kind', kind)");
    expect(hasRowFor).toContain(".eq('contact_id', contactId)");
    expect(hasRowFor).not.toMatch(/\.eq\('status'/);
  });
});

describe('the registry entry', () => {
  const registry = read('lib/business-os/gaps/automations.ts');
  const entry = registry.slice(registry.indexOf("id: 'chase_quotes'"));

  /*
   * ZERO, and it is the only entry allowed to be. Every other automation
   * hangs off a gap that is stale immediately, so its delay IS the grace
   * period. `quote_awaiting_client` waits 72 hours of its own, and a delay on
   * top would quietly make the follow-up land on day six.
   */
  it('adds no delay on top of the gap that already waited three days', () => {
    expect(entry).toMatch(/delayHours: 0,/);

    const definitions = read('lib/business-os/gaps/definitions.ts');
    expect(definitions).toMatch(/id: 'quote_awaiting_client',\s*\n\s*blocksOn: 'client',\s*\n\s*staleAfterHours: 72,/);
  });

  it('is opt-in, and only offered to a business that sends quotes', () => {
    expect(entry).toMatch(/column: 'chase_quotes_enabled',/);
    expect(entry).toMatch(/requires: 'sends_quotes',/);

    const migration = read('supabase/migrations/20261048_chase_quotes.sql');
    expect(migration).toContain('chase_quotes_enabled boolean NOT NULL DEFAULT false');
  });

  /* A kind the column's CHECK rejects is queued happily and skipped forever. */
  it('queues a kind the database will accept', () => {
    expect(entry).toMatch(/sweepQueues: 'quote_chase',/);
    expect(read('supabase/migrations/20261048_chase_quotes.sql')).toContain("'quote_chase'");
  });
});

describe('what the owner is shown', () => {
  const definitions = read('lib/business-os/gaps/definitions.ts');

  /*
   * The owner sees the DATED ones only. An undated quote is the client's move;
   * one with a deadline is an offer the business made that expires, and the
   * thing that expires is the owner's.
   */
  it('puts only a quote with a deadline on the card', () => {
    const gap = definitions.slice(definitions.indexOf("id: 'quote_deadline_unanswered'"));

    expect(gap).toMatch(/blocksOn: 'owner',/);
    expect(gap).toContain(".not('valid_until', 'is', null)");
  });

  it('leaves an undated quote where it was, as the client’s move', () => {
    expect(definitions).toMatch(/id: 'quote_awaiting_client',\s*\n\s*blocksOn: 'client',/);
  });

  it('does not offer to chase one that has already lapsed', () => {
    const gap = definitions.slice(definitions.indexOf("id: 'quote_deadline_unanswered'"));

    expect(gap).toContain(".gte('valid_until'");
  });

  /* Time running out is the subject, so the nearest deadline leads. */
  it('shows the nearest deadline first', () => {
    const gap = definitions.slice(definitions.indexOf("id: 'quote_deadline_unanswered'"));

    expect(gap).toContain(".order('valid_until', { ascending: true })");
  });
});
