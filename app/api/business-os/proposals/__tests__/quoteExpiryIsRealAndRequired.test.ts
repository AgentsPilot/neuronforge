/**
 * A quote must say when it stops standing, and that day must not be past.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 *
 * `valid_until` had a ceiling and no floor, and was optional.
 *
 *   PAST    Any earlier date was accepted. Expiry is COMPUTED from this field
 *           rather than stored -- `proposals/[token]` compares it to now on
 *           every open -- so a quote dated yesterday is `expired` the instant
 *           it is sent. The client follows the link and reads that the quote is
 *           no longer available, having never seen it. One live quote is in
 *           exactly that state: b61c4db6, valid until the 11th, sent on the
 *           12th.
 *
 *   ABSENT  13 of the 33 live quotes carry no expiry at all. A quote with no
 *           end is a price the business is bound to indefinitely, and it throws
 *           away the one thing that gets a client to decide.
 *
 * The hazard was already known -- the builder's reset notes that reusing an old
 * date "would send a quote that expired before it arrived" -- but only the
 * ceiling was ever built.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { dictionarySource } from '@/tests/helpers/dictionarySource';

/** Today in UTC, and the days either side of it, as the schema sees them. */
const dayOffset = (days: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const isIsoCalendarDate = (value: string) => {
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};

/** The route's rule for this field, restated. */
const validUntil = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'valid_until must be YYYY-MM-DD')
  .refine(isIsoCalendarDate, 'valid_until is not a real date')
  .refine(
    value => Number(value.slice(0, 4)) <= new Date().getUTCFullYear() + 10,
    'valid_until is implausibly far in the future'
  )
  .refine(value => {
    const floor = new Date();
    floor.setUTCDate(floor.getUTCDate() - 1);
    return value >= floor.toISOString().slice(0, 10);
  }, 'valid_until is already in the past');

const accepts = (value: unknown) => validUntil.safeParse(value).success;

describe('a date that has already gone', () => {
  it('yesterday-but-one is refused', () => {
    expect(accepts(dayOffset(-2))).toBe(false);
  });

  it('last year is refused', () => {
    expect(accepts(`${new Date().getUTCFullYear() - 1}-06-01`)).toBe(false);
  });

  it('the shape of the live case is refused', () => {
    /*
     * b61c4db6 was valid until the 11th and created on the 12th: one day dead
     * at birth. Stated relative to now rather than with those two literals,
     * because the schema is only handed `valid_until` -- it compares against
     * the moment of creation, which is what "the 11th, created the 12th" means
     * at the time it happened.
     */
    expect(accepts(dayOffset(-1 - 1))).toBe(false);
  });

  it('and says which rule it broke', () => {
    const result = validUntil.safeParse(dayOffset(-30));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toBe('valid_until is already in the past');
    }
  });
});

describe('a date that still stands', () => {
  it.each([0, 1, 7, 90, 365])('%d days out is accepted', days => {
    expect(accepts(dayOffset(days))).toBe(true);
  });

  it('yesterday in UTC is accepted, for the owner a day behind it', () => {
    /*
     * The slack, and why it is exactly one day. The owner picks a date in their
     * own calendar and this compares in UTC; offsets run to ±14 hours, so their
     * today can be the UTC yesterday. Without this, a same-day quote would be
     * refused in Honolulu. One day covers every zone and still catches a date
     * typed in the wrong year.
     */
    expect(accepts(dayOffset(-1))).toBe(true);
  });
});

describe('the rules that were already there still hold', () => {
  it('a five-digit year is still refused', () => {
    // The fault this field was first hardened against. Zero remain in the data.
    expect(accepts('62026-09-10')).toBe(false);
  });

  it('a date that is not a real day is refused', () => {
    expect(accepts('2027-02-30')).toBe(false);
  });

  it('a year beyond the ceiling is refused', () => {
    expect(accepts(`${new Date().getUTCFullYear() + 11}-01-01`)).toBe(false);
  });

  it('something that is not a date at all is refused', () => {
    for (const junk of ['', 'soon', '2027/01/01', '01-01-2027']) expect(accepts(junk)).toBe(false);
  });
});

describe('the field is required', () => {
  const read = (p: string) =>
    fs.readFileSync(path.join(process.cwd(), p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const route = read('app/api/business-os/proposals/route.ts');
  const modal = read('components/crm/contact-drawer/ProposalBuilderModal.tsx');

  it('the schema no longer lets it be absent', () => {
    const field = route.slice(route.indexOf('valid_until: z'), route.indexOf('payment_shape:'));
    expect(field).not.toContain('.nullable()');
    expect(field).not.toContain('.optional()');
  });

  it('null and undefined are both refused', () => {
    expect(accepts(null)).toBe(false);
    expect(accepts(undefined)).toBe(false);
  });

  it('the builder will not send without one', () => {
    // Checked in the client too: `min` on a date input is advisory, and a
    // browser submits an invalid date control anyway. Without this the owner
    // writes a whole quote before the server refuses it.
    expect(modal).toContain('const expiryValid = validUntil.length > 0 && validUntil >= localToday()');
    expect(modal).toMatch(/const canSend =[\s\S]{0,200}expiryValid/);
  });

  it('the input carries a floor as well as a ceiling', () => {
    expect(modal).toContain('min={localToday()}');
    expect(modal).toContain('required');
  });

  it('the floor is the owner\'s today, not UTC', () => {
    // `toISOString().slice(0,10)` is the UTC day, which west of Greenwich names
    // yesterday for most of the working day and greys out the owner's own today.
    const helper = modal.slice(modal.indexOf('const localToday'), modal.indexOf('const localToday') + 320);
    expect(helper).toContain('now.getFullYear()');
    expect(helper).not.toContain('toISOString');
  });
});

describe('the owner is told, not just refused', () => {
  /*
   * The field became mandatory without saying so, and `min` on a date input is
   * advisory — a TYPED date is accepted by the control and only marks it
   * invalid. So an owner could type last month, see nothing change, and find
   * Send quietly disabled with no reason given anywhere on the screen.
   */
  const modal = fs
    .readFileSync(path.join(process.cwd(), 'components/crm/contact-drawer/ProposalBuilderModal.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('the label is marked required', () => {
    const label = modal.slice(modal.indexOf('proposal.field.valid_until'), modal.indexOf('proposal.field.valid_until') + 260);
    expect(label).toContain('<RequiredMark />');
  });

  it('a past date says so, in words', () => {
    expect(modal).toContain("t('proposal.field.valid_until_past')");
    expect(modal).toContain('role="alert"');
  });

  it('but not before anything has been typed', () => {
    // An untouched empty field is not an error yet; the asterisk already says
    // it will be needed. Colouring it red on open is nagging.
    expect(modal).toContain('validUntil.length > 0 && !expiryValid');
  });

  it('the message is tied to the input for a screen reader', () => {
    expect(modal).toContain("aria-describedby={!expiryValid ? 'proposal-valid-until-error' : undefined}");
    expect(modal).toContain("id=\"proposal-valid-until-error\"");
    expect(modal).toContain('aria-invalid={!expiryValid}');
  });

  it('and the label points at the field it labels', () => {
    expect(modal).toContain('htmlFor="proposal-valid-until"');
    expect(modal).toContain('id="proposal-valid-until"');
  });

  it('the wording exists in all three languages', () => {
    const lang = dictionarySource();
    expect((lang.match(/'proposal\.field\.valid_until_past':/g) ?? []).length).toBe(3);
  });
});


describe('every required field in the dialog is marked', () => {
  /*
   * The asterisk went on the expiry alone, which is worse than none: it reads
   * as "this one field is required" and so tells the owner the title and the
   * total are not. Which fields carry it is decided by `canSend`, not by taste.
   */
  const modal = fs
    .readFileSync(path.join(process.cwd(), 'components/crm/contact-drawer/ProposalBuilderModal.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  const labelled = (key: string, within = 300) =>
    modal.slice(modal.indexOf(`t('proposal.field.${key}')`), modal.indexOf(`t('proposal.field.${key}')`) + within);

  it.each(['title', 'total', 'valid_until'])('%s is marked', key => {
    expect(labelled(key)).toContain('<RequiredMark />');
  });

  it('stage names are marked, but only for the shape that has stages', () => {
    // `splitComplete` and `stagesNamed` both stand down unless the split is
    // milestones, so marking it unconditionally would be a lie for the others.
    expect(labelled('stages')).toContain("kind === 'milestones' && <RequiredMark />");
  });

  it.each(['description', 'terms'])('%s is NOT marked, because it is optional', key => {
    expect(labelled(key)).not.toContain('<RequiredMark />');
  });

  it('the mark is one component, so a fifth field cannot drift', () => {
    expect(modal).toContain('function RequiredMark()');
    // Four uses, one definition: the five matches are those plus the function.
    expect((modal.match(/RequiredMark/g) ?? []).length).toBe(5);
  });

  it('and it is hidden from a screen reader, which reads `required` instead', () => {
    const mark = modal.slice(modal.indexOf('function RequiredMark'), modal.indexOf('function RequiredMark') + 220);
    expect(mark).toContain('aria-hidden="true"');
  });
});
