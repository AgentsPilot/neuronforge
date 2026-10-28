/**
 * A session sold at an hour the business is shut says so — and is still sold.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE QUOTE THIS EXISTS FOR
 *
 * Six weekly sessions, Wednesdays, on a business open 09:00–17:00. The first
 * sat at 00:00 and the row showed no warning at all, because the check had
 * nothing to compare it against: it read the SERVICE's weekly hours, and a
 * package service keeps none — it is not booked into an hour itself, so
 * `is_scheduled` is false and `availability` is null.
 *
 * The owner would have sent a quote with a midnight session on it, the client
 * would have approved it, and acceptance would have written it: nothing in the
 * chain asks whether the hour is one the business works.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A WARNING, NOT A REFUSAL
 *
 * Deliberate, and the reason this is a guard rather than a gate: the owner
 * decides their own hours, and seeing one client at 19:00 is a normal thing to
 * do. Acceptance books what was sold either way. What must not happen is
 * SILENCE — the owner not being told the hour is unusual before a client sees
 * it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (p: string) =>
  fs.readFileSync(path.join(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n');

/** Comments stripped: the prose below repeats every string asserted on. */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const modal = code('components/crm/contact-drawer/ProposalBuilderModal.tsx');

describe('there are always hours to compare against', () => {
  it('uses the service\'s own weekly hours when it keeps any', () => {
    expect(modal).toMatch(/setServiceHours\(service!?\.availability\)/);
  });

  it('and an EMPTY pattern does not count as keeping any', () => {
    /*
     * The regression this case exists for. The choice was
     * `if (service?.availability)`, and the column on a package service is
     * `{}` — an empty object, which is TRUTHY. So the service won with no
     * hours in it, the business fallback never ran, and the check below
     * silently skipped: it asks for the day's windows, gets none out of `{}`,
     * and `windows.length > 0` is never true. Every session passed the hours
     * test by having nothing to be tested against — which is the fault this
     * whole file was written for, returning by a different door.
     *
     * `hasAnyAvailability` is the question actually being asked, and is the
     * same function the publish gate and the booking page use, so all three
     * agree about what "has hours" means.
     */
    expect(modal).toContain('hasAnyAvailability(service?.availability)');
    expect(modal).not.toMatch(/if \(service\?\.availability\) \{/);
  });

  it('falls back to the business\'s hours when it does not', () => {
    /*
     * The whole bug. A package service has no weekly pattern, so without this
     * the comparison never happened and every hour read as acceptable.
     */
    expect(modal).toContain("fetch('/api/scheduling/availability')");
    expect(modal).toContain('hoursData.availability');
  });

  it('asks the business only when the service answered nothing', () => {
    /* A service WITH hours is the more specific statement and wins; a second
       fetch behind it would be a request for nothing. */
    const effect = modal.slice(modal.indexOf('const response = await fetch(`/api/scheduling/services/'));
    const serviceAt = effect.search(/setServiceHours\(service!?\.availability\)/);
    const returnAt = effect.indexOf('return;', serviceAt);
    const businessAt = effect.indexOf("fetch('/api/scheduling/availability')");

    expect(serviceAt).toBeGreaterThan(-1);
    expect(returnAt).toBeGreaterThan(serviceAt);
    expect(businessAt).toBeGreaterThan(returnAt);
  });
});

describe('the hour is checked, and the verdict is amber', () => {
  it('compares the session against that day\'s windows', () => {
    expect(modal).toContain('windowsForDate(serviceHours, dateKey, timeOff)');
    expect(modal).toContain('{ outside: windows[0] }');
  });

  it('reads as a WARNING, never as lost', () => {
    /*
     * `lost` means there will be no meeting. An hour outside the usual ones
     * will be booked exactly as sold, so saying it is lost would be false.
     */
    const tone = modal.slice(modal.indexOf('const problemTone ='));
    const body = tone.slice(0, tone.indexOf('\n\n'));

    expect(body).toContain("problem === 'past' || problem === 'taken' ? 'lost' : 'warn'");
  });

  it('and does NOT stop the quote being sent', () => {
    /*
     * THE point of the change. Only an empty row or a date in the past can
     * block sending — a date in the past cannot become a meeting at all.
     */
    const gate = modal.slice(modal.indexOf('sessionProblems.every('));
    const condition = gate.slice(0, gate.indexOf('\n'));

    expect(condition).toContain("!== 'empty'");
    expect(condition).toContain("!== 'past'");
    expect(condition).not.toContain('outside');
    expect(condition).not.toContain('closed');
  });
});

describe('what the owner is told', () => {
  const dictionaries = [
    'lib/business-os/translations/en.ts',
    'lib/business-os/translations/he.ts',
    'lib/business-os/translations/es.ts',
  ];

  it('names the hours in every language', () => {
    for (const file of dictionaries) {
      const line = read(file)
        .split('\n')
        .find(l => l.includes('proposal.package_date_outside'));

      expect(line).toBeDefined();
      /* The real window, so the owner can see what they are outside of. */
      expect(line).toContain('{start}');
      expect(line).toContain('{end}');
    }
  });

  it('does not claim the hours belong to the service', () => {
    /*
     * They may be the BUSINESS's now, which is the fallback this change added.
     * "your hours for this service" would be false for a package service,
     * which keeps none of its own.
     */
    const english = read(dictionaries[0])
      .split('\n')
      .find(l => l.includes('proposal.package_date_outside')) as string;

    expect(english).not.toContain('this service');
  });
});
