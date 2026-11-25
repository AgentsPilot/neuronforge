/**
 * When the chat asks which one, the options can be told apart.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A CHOICE NEEDS MORE THAN A NAME
 *
 * A choice exists precisely BECAUSE several rows answered to the same words.
 * For a contact the label is the person's name — so two clients called Tal
 * Omer produce two identical chips, and the owner is asked to pick between two
 * things that look the same.
 *
 * On a booking that is not a wrong row in a list. The pick resolves a parked
 * write: it creates an appointment, raises an invoice and emails whoever was
 * chosen. Picking the wrong one tells a stranger they have an appointment.
 *
 * So a candidate carries one short line of whatever actually separates them —
 * an address, a phone, the day it was raised — and it travels the whole way:
 * resolver → route → panel → the chip the owner taps.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PINNED AT EVERY HOP, because a value that is dropped at one of them looks
 * exactly like a value that was never added. That is the failure this product
 * has already paid for twice this week: a field passed to a typed parameter
 * that did not declare it, and a field trimmed on write but not on match.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const RESOLVER = read('lib/business-os/bizql/mutate/resolveWrites.ts');
const ROUTE = read('app/api/business-os/chat-v4/route.ts');
const PANEL = read('components/business-os/ChatCommandPanel.tsx');

describe('a candidate', () => {
  it('declares the line that separates it from its twin', () => {
    expect(RESOLVER).toContain('detail?: string;');
  });

  it('builds that line from the row already fetched', () => {
    /* No second query: the rows behind a choice have just been read, and
       asking again for what is already in hand is a round trip per candidate. */
    expect(RESOLVER).toContain('const detailForRow = (row: QueryRow): string | undefined =>');
    expect(RESOLVER).toContain('detail: detailForRow(row),');
  });

  it('keeps it short enough to choose between', () => {
    /* Two facts, not five. A chip carrying three identifiers is harder to pick
       from than one carrying the right one. */
    expect(RESOLVER).toContain("parts.slice(0, 2).join(' · ')");
  });
});

describe('the line survives every hop', () => {
  it('leaves the route with the options', () => {
    expect(ROUTE).toContain(
      'options: parked?.candidates.map((c) => ({ id: c.id, label: c.label, detail: c.detail })),'
    );
  });

  it('is declared on the client type', () => {
    /* An undeclared key on a typed object is dropped in silence — the exact
       way the partial-refund explanation was lost at a service boundary. */
    expect(PANEL).toContain('options?: Array<{ id: string; label: string; detail?: string }>;');
    expect(PANEL).toContain('chips: Array<{ key: string; label: string; detail?: string }>;');
  });

  it('is handed to the chip, and drawn on it', () => {
    expect(PANEL).toContain('detail: option.detail,');
    expect(PANEL).toContain('{chip.detail}');
  });

  it('leaves a chip with nothing to add exactly as it was', () => {
    /*
     * A correction chip has nothing to disambiguate. It must stay the pill it
     * has always been — this change is additive or it is a redesign of every
     * chip in the chat, which is not what it is for.
     */
    expect(PANEL).toContain('rounded-full border border-[var(--v2-border)]');
  });
});
