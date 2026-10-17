/**
 * DE-8b T-7 (workplan §8; requirement §0.4.1 E; the README notes owed by
 * DE-3 ... DE-7). Keyed on block ids, not prose, plus the few facts that must
 * appear verbatim.
 */
import { README_BLOCK_IDS, buildReadme, buildReadmeBlocks, cleanBusinessName, isoWithOffset, type ReadmeFacts } from '../readme';

const FACTS: ReadmeFacts = {
  businessName: 'Studio Noga',
  startedAtUtc: '2026-10-17T06:30:00.000Z',
  startedAtLocal: '2026-10-17T09:30:00+03:00',
  timezone: 'Asia/Jerusalem',
  timezoneSet: true,
  sections: [
    { id: 'account_identity', group: 'account', rowCount: 1, status: 'ok' },
    { id: 'clients', group: 'client_records', rowCount: 12, status: 'ok' },
    { id: 'invoices', group: 'client_records', rowCount: 0, status: 'failed' },
  ],
  files: { included: 7, couldNotBeRead: 1, recordsWithoutFile: 2, filesWithoutRecord: 3, deletedDocumentFiles: 6 },
};

describe.each([['en'], ['he']] as const)('%s', (lang) => {
  const blocks = buildReadmeBlocks(lang, FACTS);

  it('has every block, in order, each with a heading and lines', () => {
    expect(blocks.map((block) => block.id)).toEqual([...README_BLOCK_IDS]);
    for (const block of blocks) {
      expect(block.heading.trim().length).toBeGreaterThan(0);
      expect(block.lines.length).toBeGreaterThan(0);
      for (const line of block.lines) expect(line.trim().length).toBeGreaterThan(0);
    }
  });

  it('names the business as controller of the client records and content, AgentPilot of the account', () => {
    const controller = blocks.find((block) => block.id === 'controller')!.lines.join('\n');
    expect(controller).toContain('AgentPilot');
    expect(controller.split('Studio Noga').length - 1).toBeGreaterThanOrEqual(3);
  });

  it('lists every section with its file, rows and status; a failed one is marked', () => {
    const sections = blocks.find((block) => block.id === 'sections')!.lines;
    expect(sections).toHaveLength(3);
    expect(sections[1]).toContain('records/client_records/clients.csv');
    expect(sections[1]).toContain('12');
    expect(sections[2]).toContain('records/client_records/invoices.csv');
    expect(sections[2]).not.toEqual(sections[1].replace('clients', 'invoices'));
  });

  it('gives the start time in UTC and on the owner clock with its offset', () => {
    const title = blocks.find((block) => block.id === 'title')!.lines.join('\n');
    expect(title).toContain('2026-10-17T06:30:00.000Z');
    expect(title).toContain('2026-10-17T09:30:00+03:00');
    expect(title).toContain('Asia/Jerusalem');
  });

  it('states the file counts (orphans are counted, never named)', () => {
    const files = blocks.find((block) => block.id === 'files')!.lines.join('\n');
    for (const n of ['7', '1', '2', '3', '6']) expect(files).toContain(n);
  });

  it('carries the owed column notes by their column names', () => {
    const text = buildReadme(lang, FACTS);
    for (const term of [
      'preferences.timezone',
      'user_profile.timezone',
      'notification_settings.quiet_hours_timezone',
      'processor_fee',
      'fee_currency',
      'fee_returned',
      'refund_fee',
      'payments.amount',
      'stripe_hosted_invoice_url',
      'website_content.payment_button',
      'email_unsubscribes',
      'newsletter_subscribers.status',
      'redacted@invalid',
      'website_blocks',
      'business_profile.subdomain',
      'website_pages.subdomain',
      'files-index.csv',
      'data.json',
      '+972',
      'id',
    ]) {
      expect(text).toContain(term);
    }
  });

  it('uses CRLF line ends', () => {
    const text = buildReadme(lang, FACTS);
    expect(text).toContain('\r\n');
    expect(text.replace(/\r\n/g, '')).not.toContain('\n');
  });
});

describe('the account holder fallback and the business name as plain text', () => {
  it('no business name: "the account holder" (en) / "בעל החשבון" (he)', () => {
    const facts = { ...FACTS, businessName: null };
    expect(buildReadmeBlocks('en', facts).find((b) => b.id === 'controller')!.lines[1]).toContain('the account holder');
    expect(buildReadmeBlocks('he', facts).find((b) => b.id === 'controller')!.lines[1]).toContain('בעל החשבון');
  });

  it('bidi and control characters are stripped from the name', () => {
    expect(cleanBusinessName('Evil‮gnirts\u0000 Co')).toBe('Evilgnirts Co');
    const text = buildReadme('en', { ...FACTS, businessName: 'Evil‮gnirts' });
    expect(text).not.toMatch(/[‪-‮⁦-⁩]/);
  });

  it('a blank or non-string name is null', () => {
    expect(cleanBusinessName('   ')).toBeNull();
    expect(cleanBusinessName(42)).toBeNull();
  });

  it('the business name never appears outside the controller block (title, not-included, ...)', () => {
    for (const block of buildReadmeBlocks('en', FACTS)) {
      if (block.id === 'controller') continue;
      expect(block.lines.join('\n')).not.toContain('Studio Noga');
    }
  });

  it('no timezone set: the README says so', () => {
    const title = buildReadmeBlocks('en', { ...FACTS, timezone: 'UTC', timezoneSet: false }).find((b) => b.id === 'title')!.lines.join(' ');
    expect(title).toMatch(/No timezone is set/);
  });
});

describe('isoWithOffset', () => {
  it('gives the local wall time with the zone offset', () => {
    expect(isoWithOffset(new Date('2026-10-17T06:30:00Z'), 'Asia/Jerusalem')).toBe('2026-10-17T09:30:00+03:00');
    expect(isoWithOffset(new Date('2026-01-17T06:30:00Z'), 'America/New_York')).toBe('2026-01-17T01:30:00-05:00');
    expect(isoWithOffset(new Date('2026-10-17T06:30:00Z'), 'UTC')).toBe('2026-10-17T06:30:00+00:00');
  });
});
