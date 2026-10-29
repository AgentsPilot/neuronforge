/**
 * The week's "do this first" list cannot claim something the data does not say.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE LINE THIS FILE IS NAMED AFTER
 *
 * A live Hebrew verdict, read by the owner of a six-client practice:
 *
 *     1  שלח תזכורות ל-29 לקוחות שהחמיצו פגישות
 *        "Send reminders to 29 clients who missed meetings"
 *
 * Six clients exist. Two have ever missed a meeting. The 29 was real but it
 * belonged to something else entirely: `affected_count` on an unfilled-calendar
 * insight, where it counts EMPTY HOURS IN THE WORKING WEEK.
 *
 * Three things had to be true at once for that sentence to reach a screen:
 *   · the detector never recorded what its count counted;
 *   · the narrator was handed the insight as prose, so the figure arrived with
 *     no noun attached and it chose one;
 *   · nothing checked the output, which went from the model to the database to
 *     the dashboard untouched.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE HALF THAT MUST SURVIVE
 *
 * The valuable lines have no numbers in them at all: "call the people who have
 * not paid", "ask the two who cancelled if they want another time". A check
 * strict enough to drop those would be worse than the bug, because this is the
 * one line in the product an owner acts on. Every rule below is conditioned on
 * a FIGURE being present, and the no-figure cases are asserted first.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import { describeCount, countNoun, mentionsPeople, COUNT_NOUN } from '../countNouns';
import { verifyPriorities, fallbackPriorities, type PriorityFact } from '../verifyPriorities';

/** The real insight, with the real figures, as the narrator now receives it. */
const EMPTY_HOURS: PriorityFact = {
  insightId: 'ins-hours',
  entityType: 'open_hour',
  figures: [29, 11600, 9.375],
  recommendation: 'פרסם מבצע על השעות הפנויות שנשארו השבוע',
  category: 'operations',
  detectorId: 'ops_utilization_low',
};

/** A people-shaped insight, so the subject rule can be shown to be conditional. */
const UNPAID: PriorityFact = {
  insightId: 'ins-unpaid',
  entityType: 'contact',
  figures: [3, 4600],
  recommendation: 'שלח תזכורת לשלושת הלקוחות שלא שילמו',
  category: 'cash_flow',
  detectorId: 'cash_revenue_at_risk',
};

const check = (priorities: Array<Record<string, unknown>>, language = 'he') =>
  verifyPriorities({
    priorities,
    facts: [EMPTY_HOURS, UNPAID],
    allowedRates: [48.4, 25, 23.4],
    language,
  });

describe('a line with no figures is left alone', () => {
  it('keeps an action that names people without counting them', () => {
    /*
     * ───────────────────────────────────────────────────────────────────────
     * FIRST, BECAUSE IT IS THE COMMON CASE.
     * ───────────────────────────────────────────────────────────────────────
     */
    const { kept, dropped } = check([
      { rank: 1, category: 'cash_flow', title: 'שלח תזכורת ללקוחות שלא שילמו' },
    ]);

    expect(dropped).toHaveLength(0);
    expect(kept[0].title).toBe('שלח תזכורת ללקוחות שלא שילמו');
  });

  it('and does not require an insight id for it', () => {
    // Nothing to check means nothing to cite. Demanding an id here would throw
    // away good lines for no gain.
    expect(check([{ rank: 1, title: 'תתקשר ללקוחות שביטלו' }]).kept).toHaveLength(1);
  });
});

describe('the line that was shipped', () => {
  it('is dropped when it carries a figure and cites nothing', () => {
    /*
     * ───────────────────────────────────────────────────────────────────────
     * THE EXACT STRING FROM PRODUCTION.
     *
     * The model emitted no `insight_id`, so there was nothing to check the 29
     * against — and the reader could not click through to see what it meant
     * either. One rule closes both.
     * ───────────────────────────────────────────────────────────────────────
     */
    const { kept, dropped } = check([
      { rank: 1, category: 'cash_flow', title: 'שלח תזכורות ל-29 לקוחות שהחמיצו פגישות' },
    ]);

    expect(kept).toHaveLength(0);
    expect(dropped[0].reason).toMatch(/names no issue/);
  });

  it('is dropped even when it cites the issue the 29 came from', () => {
    /*
     * The harder half. 29 IS one of that insight's own figures, so the
     * arithmetic rule passes it. What makes the sentence false is the subject:
     * the count is of empty hours and it has been handed to clients.
     */
    const { kept, dropped } = check([
      {
        rank: 1,
        category: 'cash_flow',
        insight_id: 'ins-hours',
        title: 'שלח תזכורות ל-29 לקוחות שהחמיצו פגישות',
      },
    ]);

    expect(kept).toHaveLength(0);
    expect(dropped[0].reason).toMatch(/to people/);
  });

  it('while the correct sentence about the same 29 is kept', () => {
    // Same insight, same figure, right noun. This is what the fix is for: the
    // number is useful, it just has to stay with its own subject.
    const { kept } = check([
      {
        rank: 1,
        category: 'operations',
        insight_id: 'ins-hours',
        title: 'פרסם מבצע על 29 השעות הפנויות שלך',
      },
    ]);

    expect(kept).toHaveLength(1);
    expect(kept[0].insight_id).toBe('ins-hours');
  });

  it('and a count of people is still allowed to be about people', () => {
    /*
     * The subject rule must not become "no numbers near clients". When the
     * count really is contacts, naming them is exactly right.
     */
    const { kept } = check([
      {
        rank: 1,
        category: 'cash_flow',
        insight_id: 'ins-unpaid',
        title: 'שלח תזכורת ל-3 לקוחות שלא שילמו',
      },
    ]);

    expect(kept).toHaveLength(1);
  });
});

describe('figures must belong to the issue cited', () => {
  it('drops a number that is nobody\'s', () => {
    const { kept, dropped } = check([
      { rank: 1, insight_id: 'ins-unpaid', title: 'שלח תזכורת ל-17 לקוחות' },
    ]);

    expect(kept).toHaveLength(0);
    expect(dropped[0].reason).toMatch(/not one of this issue's own numbers/);
  });

  it('drops a figure borrowed from a different issue', () => {
    // 11,600 is the empty-hours money. Quoted under the unpaid-invoices issue
    // it is a claim about money that was never owed.
    expect(check([
      { rank: 1, insight_id: 'ins-unpaid', title: 'גבה ₪11,600 מהלקוחות' },
    ]).kept).toHaveLength(0);
  });

  it('accepts money written with a thousands separator', () => {
    const { kept } = check([
      { rank: 1, insight_id: 'ins-unpaid', title: 'גבה ₪4,600 שלא שולמו' },
    ]);

    expect(kept).toHaveLength(1);
  });

  it('accepts money the model rounded slightly, and refuses a rewrite', () => {
    /*
     * ₪11,600 said as ₪11,700 is the same claim; said as ₪15,000 it is a
     * different one. The 2% band is where that line is drawn.
     */
    expect(check([
      { rank: 1, insight_id: 'ins-hours', title: 'מלא שעות בשווי ₪11,700' },
    ]).kept).toHaveLength(1);

    expect(check([
      { rank: 1, insight_id: 'ins-hours', title: 'מלא שעות בשווי ₪15,000' },
    ]).kept).toHaveLength(0);
  });

  it('accepts a measured rate from the same summary', () => {
    // The rates arrive in the prompt with their own comparison attached, so
    // quoting one is checkable and allowed.
    expect(check([
      { rank: 1, insight_id: 'ins-unpaid', title: 'רק 48% מהחשבוניות שולמו בזמן' },
    ]).kept).toHaveLength(1);
  });

  it('drops a line citing an issue that was never offered', () => {
    expect(check([
      { rank: 1, insight_id: 'ins-invented', title: 'שלח 5 תזכורות' },
    ]).dropped[0].reason).toMatch(/unknown issue/);
  });
});

describe('ranks and ids after filtering', () => {
  it('renumbers what is left, so the list never starts at 2', () => {
    const { kept } = check([
      { rank: 1, title: 'שלח תזכורות ל-29 לקוחות שהחמיצו פגישות' },
      { rank: 2, insight_id: 'ins-unpaid', title: 'שלח תזכורת ל-3 לקוחות שלא שילמו' },
    ]);

    expect(kept).toHaveLength(1);
    expect(kept[0].rank).toBe(1);
  });

  it('never keeps an id it could not verify', () => {
    // The card turns `insight_id` into a link. A kept id that points nowhere
    // would be a dead one.
    const { kept } = check([{ rank: 1, insight_id: 'ins-invented', title: 'תתקשר ללקוחות' }]);

    expect(kept).toHaveLength(1);
    expect(kept[0].insight_id).toBeUndefined();
  });
});

describe('when nothing survives', () => {
  it('falls back to the insights\' own recommendations, with their ids', () => {
    /*
     * An empty list would be the worst outcome of a correctness fix: the owner
     * loses the one line they act on. Each insight already carries a single
     * action written in their language, beside the title it belongs to.
     */
    const fallback = fallbackPriorities([EMPTY_HOURS, UNPAID]);

    expect(fallback[0]).toMatchObject({
      rank: 1,
      insight_id: 'ins-hours',
      title: 'פרסם מבצע על השעות הפנויות שנשארו השבוע',
    });
    expect(fallback[1].rank).toBe(2);
  });

  it('skips an insight with no recommendation rather than showing a blank', () => {
    expect(fallbackPriorities([{ ...EMPTY_HOURS, recommendation: '  ' }, UNPAID])).toHaveLength(1);
  });
});

describe('what a count counts', () => {
  it('says hours, and says NOT clients', () => {
    const line = describeCount(29, 'open_hour');

    expect(line).toContain('empty hours in their working week');
    expect(line).toContain('NOT clients');
  });

  it('refuses to let an unrecorded count be used at all', () => {
    /*
     * The state the ops detector was in: a count with no entity type. Saying
     * "29 of something" invites the model to pick; saying "do not put this
     * number in a sentence" does not.
     */
    expect(describeCount(29, null)).toMatch(/WAS NOT RECORDED/);
  });

  it('does not add the warning to a count that really is people', () => {
    expect(describeCount(3, 'contact')).toBe('3 clients');
  });

  it('covers every entity type the detectors actually set', () => {
    /*
     * ───────────────────────────────────────────────────────────────────────
     * THE GUARD THAT STOPS THIS COMING BACK.
     *
     * A new detector with a new entity type and no entry here would quietly
     * reintroduce the nounless count — the prompt would say "WAS NOT
     * RECORDED" and the figure would vanish from the verdict, which is safe
     * but silent. Read from the catalogue so the list cannot drift.
     * ───────────────────────────────────────────────────────────────────────
     */
    const dir = join(process.cwd(), 'lib/business-os/insight/detectors/catalog');
    const files = readdirSync(dir);
    const used = new Set<string>();

    for (const file of files.filter(f => f.endsWith('.ts'))) {
      const source = readFileSync(join(dir, file), 'utf8');
      for (const match of source.matchAll(/affectedEntityType: '([a-z_]+)'/g)) {
        used.add(match[1]);
      }
    }

    expect(used.size).toBeGreaterThan(10);
    expect([...used].filter(type => !countNoun(type))).toEqual([]);
  });

  it('and the ops detector is no longer the one that records nothing', () => {
    // It was the only detector in the catalogue leaving the type unset, and the
    // only one whose count reached an owner as the wrong noun.
    const source = readFileSync(
      join(process.cwd(), 'lib/business-os/insight/detectors/catalog/OpsUtilizationLowDetector.ts'),
      'utf8'
    );

    expect(source).toContain("affectedEntityType: 'open_hour'");
    expect(COUNT_NOUN.open_hour).toMatch(/hours/);
  });
});

describe('the people check itself', () => {
  it.each([
    ['he', 'שלח תזכורת ל-29 לקוחות', true],
    ['he', 'מלא 29 שעות פנויות בשבוע', false],
    ['en', 'Remind the 3 clients who have not paid', true],
    ['en', 'Fill the 29 empty hours this week', false],
    ['es', 'Recuerda a 3 clientes que no han pagado', true],
    ['es', 'Llena las 29 horas vacías', false],
  ])('%s: "%s" mentions people = %s', (language, text, expected) => {
    expect(mentionsPeople(text, language)).toBe(expected);
  });

  it('does not mistake a Hebrew word that merely contains a short one', () => {
    /*
     * Hebrew is matched by substring, so `איש` would be found inside `אישור`
     * (confirmation) and `חבר` inside `חברה` (company). Both are deliberately
     * absent from the word list; this is what that choice protects.
     */
    expect(mentionsPeople('שלח אישור על 3 התשלומים', 'he')).toBe(false);
    expect(mentionsPeople('עדכן את פרטי החברה', 'he')).toBe(false);
  });
});

describe('the generator wires all of it together', () => {
  const source = readFileSync(
    join(process.cwd(), 'lib/business-os/insight/repository/InsightRepository.ts'),
    'utf8'
  );

  it('sends the facts, not the titles', () => {
    expect(source).toContain('describeCount(i.affected_count, i.affected_entity_type)');
    expect(source).toContain('insight_id: ${fact.insightId}');

    // The line it replaces, which handed over a sentence and a sum.
    expect(source).not.toMatch(
      /issuesList = criticalInsights\s*\n?\s*\.map\(\(i\) => `- \$\{i\.title\}/
    );
  });

  it('asks for the id back, and says exactly when a line is thrown away', () => {
    /*
     * The prompt first claimed every line without an id is discarded, which the
     * check does not do: a line with no figure needs nothing to verify, and
     * dropping it would throw away the most useful shape there is ("call the
     * people who have not paid"). An instruction that overstates the rule is
     * one the model learns to ignore, so it states the rule it is held to.
     */
    expect(source).toContain('"insight_id"');
    expect(source).toMatch(/A line that carries a NUMBER and no id is thrown away/);
    expect(source).toMatch(/ALWAYS include it/);
  });

  it('refreshes what a count counts on an insight it already raised', () => {
    /*
     * The update branch refreshed `affected_count` and not its noun, so a type
     * only ever landed on INSERT — and the detector whose count had no noun
     * takes the update branch every night, its row being already open. Without
     * this the fix reached new businesses only.
     */
    const update = source.slice(source.indexOf("const { data: updated, error: updateError }"));

    expect(update.slice(0, 1800)).toContain('affected_entity_type: detection.affectedEntityType');
  });

  it('checks the answer before storing it', () => {
    /*
     * The whole fault in one line: `priorities: parsed.priorities || []` went
     * from the model to the database to the dashboard with nothing in between.
     */
    expect(source).toContain('verifyPriorities({');

    /*
     * COMMENTS STRIPPED. The sentence above quotes the old line in order to
     * explain it, and an unbounded search finds the explanation and fails for
     * the one reason it should pass.
     */
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain('priorities: parsed.priorities || []');
  });

  it('logs what it threw away', () => {
    // A silent filter hides the next prompt regression completely.
    expect(source).toMatch(/Weekly priorities failed their fact check/);
  });

  it('never leaves the list empty', () => {
    expect(source).toContain('fallbackPriorities(priorityFacts)');
  });
});
