/**
 * The unadopted-automation card says what is actually waiting.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE OWNER READ, AND WHY
 *
 * A live card on 2026-11-20:
 *
 *   "1 service waiting for automation action"
 *   "There is 1 service waiting for action that the platform can handle
 *    automatically."
 *   "activate the automation for the chase intake service"
 *
 * Nothing in that is a service. The thing waiting was one BOOKING whose intake
 * form had been sent and never came back, and `chase_intake` is an automation,
 * not a service.
 *
 * Two fields produced it, and neither is prose:
 *
 *   · `affectedEntityType: 'service'`, hardcoded whatever the work was
 *   · `metricKey: 'operations.active_services'`, borrowed because it existed
 *
 * The narrator builds the title and the recommendation from those, so the copy
 * was downstream of a mislabel rather than of a bad sentence. `narrationSubject`
 * was right all along and could not win.
 *
 * Asserted at source because the failure is a literal in a result object. A
 * detector test would need a whole account fixture to reach the same line, and
 * would still not notice a SEVENTH automation added with no entity mapped.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { OPERATIONAL_AUTOMATIONS } from '@/lib/business-os/gaps/automations';

const read = (relative: string) => readFileSync(join(process.cwd(), relative), 'utf8');

const DETECTOR =
  'lib/business-os/insight/detectors/catalog/SysAutomationUnadoptedDetector.ts';
const METRICS = 'lib/business-os/insight/metrics/types.ts';

/** Source with comments removed, so the notes ABOUT the old copy do not pass it. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('what the card claims is waiting', () => {
  const body = code(read(DETECTOR));

  it('is never called a service', () => {
    /* The word that made the sentence wrong, in the two fields the narrator
       reads. A service is a thing the business sells; this card counts work. */
    expect(body).not.toContain("affectedEntityType: 'service'");
    expect(body).not.toContain("metricKey: 'operations.active_services'");
  });

  it('is read off the gap the automation clears', () => {
    expect(body).toContain('WAITING_ENTITY[lead.gapId]');
  });

  it('counts a backlog, which is what the number is', () => {
    expect(body).toContain("metricKey: 'operations.automation_backlog'");
    /* And the key is declared, or the union stops compiling. */
    expect(read(METRICS)).toContain("'operations.automation_backlog'");
  });

  it('names the automation as an automation', () => {
    /*
     * The recommendation read "the chase intake service" because the subject
     * ended with a bare id and left the narrator to invent a noun for it.
     */
    expect(body).toContain('" automation, which is switched off');
  });
});

describe('every automation on offer has an entity for its queue', () => {
  /*
   * THE CASE THAT MATTERS WHEN SOMEBODY ADDS A SEVENTH.
   *
   * The map is keyed on `gapId`, and an automation whose gap is missing from it
   * falls back to 'task' — true, but vague, and vague is how 'service' survived
   * in the first place. This fails the moment a new automation is registered
   * without answering the question.
   */
  const body = read(DETECTOR);
  const block = body.slice(
    body.indexOf('const WAITING_ENTITY'),
    body.indexOf('/** One automation the owner has never answered about')
  );

  it.each(OPERATIONAL_AUTOMATIONS.map(a => [a.id, a.gapId] as const))(
    '%s (%s) has one',
    (_id, gapId) => {
      expect(block).toContain(`${gapId}:`);
    }
  );

  it('and the fallback stays reachable rather than being a guess', () => {
    /* A gap this does not know about must say "task", not pick something
       plausible. */
    expect(code(body)).toContain("?? 'task'");
  });
});
