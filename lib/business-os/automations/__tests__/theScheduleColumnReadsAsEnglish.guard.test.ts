/**
 * The `Every` column says a schedule, never a cron expression.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE OWNER SAW
 *
 *     Agent                          Every          Stops after
 *     Nudge quotes nobody answered   <raw cron>     1 days
 *
 * Two faults in one row, in a table whose whole job is to tell a non-technical
 * owner what their business is doing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CRON
 *
 * `scheduleInWords` gave words to exactly two shapes and returned the raw
 * expression for everything else. The note beside it defended that: a cron on
 * screen is obviously wrong and gets reported, where an invented phrase would
 * be believed. Right in principle, and answering the wrong question — because
 * `intervalFromCron` already reads far more shapes than those two and was
 * never consulted. The three-hourly expression on screen is one it has always
 * understood.
 *
 * The protection is kept: that reader returns null for anything it cannot
 * describe exactly, and those still fall through to the raw expression.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE COUNT
 *
 * One template, `{days} days`, for every number. Hebrew needs more than a
 * singular: two days is one word, `יומיים`, and two months is `חודשיים`. Both
 * are reachable — the stop choices offer two days, and the months branch
 * begins at exactly two.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const INSTALL = code(read('lib/business-os/automations/install.ts'));
const CARD = code(read('components/business-os/insight/RunningAgentsCard.tsx'));

describe('a schedule the platform wrote is a schedule it can describe', () => {
  it('the interval reader is asked before giving up', () => {
    const words = INSTALL.slice(
      INSTALL.indexOf('function scheduleInWords'),
      INSTALL.indexOf('function cadenceForCron')
    );

    expect(words).toContain('intervalFromCron(');
    /* Asked BEFORE the surrender, or it may as well not be there. */
    expect(words.indexOf('intervalFromCron(')).toBeLessThan(words.lastIndexOf('return cron;'));
  });

  it('read the same way the editor reads it', () => {
    /* An adopted agent was offered a cadence word and never a weekday, so
       reading its expression back as that cadence keeps the promise it was
       installed under. The editor is granted this; the label must match, or
       the row and its own editor would disagree. */
    const words = INSTALL.slice(
      INSTALL.indexOf('function scheduleInWords'),
      INSTALL.indexOf('function cadenceForCron')
    );

    expect(words).toMatch(/intervalFromCron\(cron, \{ allowNamedCadence: NAMED_CADENCE_CRON \}\)/);
  });

  it('and an expression nobody can describe still shows itself', () => {
    /* The original protection. A phrase invented for a schedule we do not
       understand would be believed; a raw expression gets reported, which is
       how this was found. */
    expect(INSTALL).toContain('return cron;');
  });
});

describe('the stop rule counts properly', () => {
  it('one day is not "1 days"', () => {
    expect(CARD).toContain('stopAfterWords(');
    expect(CARD).toContain("automation.stop_after_day_one");
  });

  it('and Hebrew gets its dual, for both units', () => {
    /* `2 ימים` is understandable and wrong; the word is `יומיים`. Same for
       months, whose branch starts at exactly two. */
    expect(CARD).toContain('automation.stop_after_days_two');
    expect(CARD).toContain('automation.stop_after_months_two');

    const he = read('lib/business-os/translations/he.ts');
    expect(he).toContain("'automation.stop_after_days_two': 'יומיים'");
    expect(he).toContain("'automation.stop_after_months_two': 'חודשיים'");
  });

  it('a missing form falls back to the plural rather than a key', () => {
    /* en and es have no dual, and must not render
       "automation.stop_after_days_two" at anybody. */
    expect(CARD).toMatch(/dual !== 'automation\.stop_after_days_two'/);
    expect(CARD).toMatch(/one !== 'automation\.stop_after_day_one'/);
  });

  it('and the singular exists in the languages that need one', () => {
    for (const lang of ['en', 'es']) {
      expect(read(`lib/business-os/translations/${lang}.ts`)).toContain(
        "'automation.stop_after_day_one':"
      );
    }
  });
});
