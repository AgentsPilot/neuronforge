/**
 * Every rule an automation entry has to meet, enforced before it ever runs.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The catalogue is empty today, and these still run. That is the point: the
 * first automation anyone writes is checked as they write it, rather than the
 * first time a cron hands it to a client's inbox.
 *
 * Each case below is a mistake that has already been made somewhere in this
 * product, which is why it is worth a test rather than a comment.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import {
  AUTOMATION_AGENTS,
  automationById,
  automationForInsight,
  automationForProcess,
} from '../catalog';
import { AUTOMATION_AGENT_TAG, CADENCE_CRON, automationAgentTag, planVersion } from '../types';

const LANGUAGES = ['en', 'he', 'es'];

const dictionary = (language: string) =>
  readFileSync(
    join(process.cwd(), 'lib', 'business-os', 'translations', `${language}.ts`),
    'utf-8'
  );

describe('the automation catalogue', () => {
  it('gives every automation a distinct id', () => {
    /* The id becomes the tag, and the tag is how an install is found again.
       Two entries sharing one would make each other's installs invisible. */
    const ids = AUTOMATION_AGENTS.map(automation => automation.id);

    expect(ids).toEqual([...new Set(ids)]);
  });



  it('ships a plan with every automation', () => {
    /*
     * An agent with no steps is active, visible, scheduled and does nothing —
     * the exact shape of failure the channel's `schedulingFacts` comment
     * exists to describe, and it is silent.
     */
    for (const automation of AUTOMATION_AGENTS) {
      expect(`${automation.id}:${automation.steps.length > 0}`).toBe(`${automation.id}:true`);
    }
  });

  it('calls business-os and nothing else', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * AN AGENT CALLS CAPABILITIES. IT DOES NOT CONTAIN THEM.
     *
     * Every action a plan invokes must be an action on `business-os`. Two
     * rules in one, and both have already been broken once today:
     *
     *   the PLUGIN   `business-os` is the only Business OS surface the agent
     *                pipeline can see — crm, scheduling and payments carry
     *                `visibility: "business_os"` and are reachable only by
     *                explicit key from hand-written code. It is also the only
     *                one whose sends are capped, quota'd and dry-runnable, and
     *                at least one capability plugin is a trap:
     *                `payments.send_invoice` is status-only and sends no email.
     *
     *   the ACTION   a plan can only reach what the catalog declares. When the
     *                right capability has no action — `sendBookingLink` is a
     *                function, so no plan can send the booking invite — the
     *                answer is to ADD the action, never to rebuild the
     *                behaviour inside the plan out of whatever actions happen
     *                to exist.
     *
     * Structural steps are not function calls and are deliberately allowed:
     * `scatter_gather` is a loop, `ai_processing` is the runtime's own AI
     * primitive. Neither reaches into our code.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const plugin = JSON.parse(
      readFileSync(
        join(process.cwd(), 'lib', 'plugins', 'definitions', 'business-os-plugin-v2.json'),
        'utf-8'
      )
    ) as { actions: Record<string, unknown> };

    const visit = (steps: Record<string, unknown>[], automationId: string): void => {
      for (const step of steps) {
        if (step.type === 'action') {
          expect(`${automationId}:${step.action}:${step.plugin}`).toBe(
            `${automationId}:${step.action}:business-os`
          );
          expect(`${automationId}:${step.action}:exists`).toBe(
            `${automationId}:${step.action}:${
              Object.prototype.hasOwnProperty.call(plugin.actions, String(step.action))
                ? 'exists'
                : 'MISSING FROM THE PLUGIN'
            }`
          );
        }
        const scatter = step.scatter as { steps?: Record<string, unknown>[] } | undefined;
        if (scatter?.steps) visit(scatter.steps, automationId);
      }
    };

    for (const automation of AUTOMATION_AGENTS) {
      visit(automation.steps as Record<string, unknown>[], automation.id);
    }
  });

  it('names the plugins its plan actually calls', () => {
    /*
     * `plugins_required` is what the runtime resolves before executing. A plan
     * that calls `business-os.find_invoices` without naming the plugin fails at
     * run time, inside a cron, where nobody is watching.
     */
    for (const automation of AUTOMATION_AGENTS) {
      const called = new Set(
        JSON.stringify(automation.steps)
          .match(/"(?:plugin|action)"\s*:\s*"([a-z-]+)\./g)
          ?.map(match => match.split('"')[3].split('.')[0]) ?? []
      );

      for (const plugin of called) {
        expect(`${automation.id} needs ${plugin}`).toBe(
          `${automation.id} needs ${automation.pluginsRequired.includes(plugin) ? plugin : 'MISSING'}`
        );
      }
    }
  });

  it('says its name and its sentence in every language', () => {
    /*
     * Keys, not words. The catalogue is read server-side where no language is
     * resolved, so a literal here becomes an English agent name in a Hebrew
     * agent list.
     */
    for (const automation of AUTOMATION_AGENTS) {
      for (const language of LANGUAGES) {
        const dict = dictionary(language);
        for (const key of [automation.nameKey, automation.descriptionKey]) {
          expect(`${language}:${key}`).toBe(
            `${language}:${dict.includes(`'${key}'`) ? key : 'MISSING'}`
          );
        }
      }
    }
  });

  it('runs on a real schedule', () => {
    /* Five fields, space separated. A malformed expression makes the agent
       permanently dormant rather than erroring. */
    for (const automation of AUTOMATION_AGENTS) {
      expect(`${automation.id}:${automation.defaultCron.trim().split(/\s+/).length}`).toBe(
        `${automation.id}:5`
      );
    }
  });

  it('offers the owner a choice, and its default is one of them', () => {
    /*
     * The cadence is the owner's decision — how often the platform writes to
     * their clients in their name. A default nobody can reach, or a list the
     * default is not in, is that decision taken away by accident.
     */
    for (const automation of AUTOMATION_AGENTS) {
      expect(automation.cadenceChoices.length).toBeGreaterThan(1);
      const defaults = automation.cadenceChoices.map(c => CADENCE_CRON[c]);
      expect(`${automation.id}:${defaults.includes(automation.defaultCron)}`).toBe(
        `${automation.id}:true`
      );
    }
  });

  it('never acts inside the window its deterministic chaser still owns', () => {
    /*
     * `chase_invoices` fires on days 1, 3 and 7 past due and then stops. An
     * automation that worked the same window would put two messages about one
     * debt in front of a client on the same morning.
     *
     * Asserted on the PLAN, because that is where the boundary lives: the
     * filter excludes anything newer than the chaser's last milestone.
     */
    for (const automation of AUTOMATION_AGENTS) {
      if (!automation.worksAlongside) continue;
      const plan = JSON.stringify(automation.steps);
      expect(`${automation.id}:${plan.includes('"offset"')}`).toBe(`${automation.id}:true`);
    }
  });

  it('is findable by id, and by whatever its insight carries', () => {
    /*
     * Two joins, narrowest first. An agent that names detectors is answering a
     * narrower question than the process and must win — eight detectors reach
     * `send_followup_nudge` with four different intents, one of which is
     * marketing.
     */
    for (const automation of AUTOMATION_AGENTS) {
      /* By id, always. An agent that no card offers is still installable. */
      expect(automationById(automation.id)).toBe(automation);

      if (automation.offeredFromInsight === false) {
        /*
         * And by nothing else. An agent with no trend behind it must not reach
         * an owner through either join — least of all the process fallback,
         * which would hand it every detector the named agents left over.
         */
        expect(automationForProcess(automation.answersProcess)).not.toBe(automation);
        expect(
          automationForInsight({ paired_process_id: automation.answersProcess })
        ).not.toBe(automation);
        continue;
      }

      if (automation.answersDetectors) {
        for (const detector of automation.answersDetectors) {
          expect(
            automationForInsight({
              detector_id: detector,
              paired_process_id: automation.answersProcess,
            })
          ).toBe(automation);
        }
      } else {
        expect(automationForProcess(automation.answersProcess)).toBe(automation);
      }
    }
  });

  it('only claims detectors that report the kind of thing its plan acts on', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THE MISTAKE THIS EXISTS TO STOP, WHICH SHIPPED ONCE.
     *
     * `follow_up_stalled_deals` claimed `conv_pipeline_stuck`,
     * `conv_stage_dropoff` and `conv_service_rate_drop` because their names
     * read like deals. All three report CONTACTS — people idling in a pipeline
     * stage — and the agent's plan finds PROPOSALS.
     *
     * Nothing failed. The card offered the agent, the owner could install it,
     * and on the live account it was offered against two contacts stuck at
     * `lead` who had never been sent a quote: a fortnightly run finding zero
     * rows and reporting success, forever.
     *
     * So the rule is the detector's own `affectedEntityType` against the
     * entity the plan's first find reads. Both are declared, neither is a
     * guess, and the only mapping between them is the catalog's table name.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const dir = join(process.cwd(), 'lib', 'business-os', 'insight', 'detectors', 'catalog');
    const sources = readdirSync(dir)
      .filter(f => f.endsWith('.ts'))
      .map(f => readFileSync(join(dir, f), 'utf-8'));

    /** detector id → what its insights are about, as the detector declares it. */
    const reports = new Map<string, string>();
    for (const src of sources) {
      const id = src.match(/id: '([a-z0-9_]+)'/)?.[1];
      const entity = src.match(/affectedEntityType: '([a-z_]+)'/)?.[1];
      if (id && entity) reports.set(id, entity);
    }

    /*
     * A detector's word for a thing, and the plan's. `find_contacts` reads the
     * `contacts` entity; a detector says `contact`. Singulars, because that is
     * the side that is hand-written.
     */
    const SAME_THING: Record<string, string[]> = {
      contact: ['contacts'],
      proposal: ['proposals'],
      invoice: ['invoices', 'transactions'],
      /*
       * `abandoned_bookings` belongs here because `ConvAbandonedBookingsDetector`
       * declares `affectedEntityType: 'booking'` while its ids are abandoned
       * ATTEMPTS. The looseness is the detector's, not the agent's, and the
       * ids it hands over are exactly the rows the agent's find reads.
       */
      booking: ['bookings', 'abandoned_bookings'],
      task: ['tasks'],
      service: ['services'],
    };

    for (const automation of AUTOMATION_AGENTS) {
      const find = (automation.steps as any[]).find(
        step => typeof step.action === 'string' && step.action.startsWith('find_')
      );
      if (!find) continue;

      const acts = find.action.replace(/^find_/, '');

      for (const detector of automation.answersDetectors ?? []) {
        const reported = reports.get(detector);
        /* A detector with no declared entity cannot be checked — say so rather
           than passing it silently. */
        expect(`${detector} declares an entity: ${Boolean(reported)}`).toBe(
          `${detector} declares an entity: true`
        );

        const allowed = SAME_THING[reported!] ?? [];
        expect(
          `${automation.id} acts on ${acts}, ${detector} reports ${reported}: ${allowed.includes(acts)}`
        ).toBe(`${automation.id} acts on ${acts}, ${detector} reports ${reported}: true`);
      }
    }
  });

  it('never tells the owner how often it runs — they are choosing that on the same screen', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THE SENTENCE SAT DIRECTLY ABOVE THE BUTTONS THAT CONTRADICTED IT.
     *
     * The invoice agent's description opened "כל בוקר" — every morning — on a
     * card offering once a week, every 3 days, every day and twice a month.
     * Whatever the owner picked, the paragraph above the picker told them
     * something else. The win-back agent said "once a month" while offering
     * fortnightly too.
     *
     * The cause is ordinary: both sentences were written when the agent had one
     * hardcoded schedule, and the picker arrived afterwards. So the rule is
     * that a description says WHAT it does and never WHEN — the cadence is the
     * owner's answer, rendered from `automation.cadence.*` right beneath it.
     * ─────────────────────────────────────────────────────────────────────────
     */
    /*
     * Two kinds of number the owner now chooses, and a description may name
     * neither: HOW OFTEN (the cadence) and HOW LONG (the stop rule).
     *
     * The second was added after the rebook agent's sentence said "in the last
     * six months" on a card offering 90, 180 and 270 days. Same fault as "every
     * morning" above a weekly picker, one row further down.
     */
    const CADENCE_WORDS: Record<string, string[]> = {
      en: [
        'each morning', 'every morning', 'every day', 'once a week', 'once a month',
        'daily', 'weekly', 'monthly', 'fortnightly',
        'six months', 'three months', 'last six', 'in the last',
      ],
      he: [
        'כל בוקר', 'כל יום', 'פעם בשבוע', 'פעם בחודש', 'פעמיים בחודש', 'כל 3 ימים',
        'חצי השנה', 'בחצי שנה', 'שלושה חודשים',
      ],
      es: [
        'cada mañana', 'cada día', 'una vez al mes', 'una vez por semana', 'cada semana',
        'cada mes', 'seis meses', 'últimos seis',
      ],
    };

    for (const lang of ['en', 'he', 'es']) {
      const dict = readFileSync(
        join(process.cwd(), 'lib', 'business-os', 'translations', `${lang}.ts`),
        'utf-8'
      );

      for (const automation of AUTOMATION_AGENTS) {
        for (const key of [automation.descriptionKey, automation.nameKey, automation.watchesKey]) {
          const line = dict
            .split('\n')
            .find(l => l.includes(`'${key}':`));

          /* A missing line is the sibling test's business, not this one. */
          if (!line) continue;

          const said = line.toLowerCase();
          const offender = CADENCE_WORDS[lang].find(word => said.includes(word.toLowerCase()));

          expect(`${lang} ${key}: ${offender ?? 'says nothing about frequency'}`).toBe(
            `${lang} ${key}: says nothing about frequency`
          );
        }
      }
    }
  });

  it('claims no detector whose people the find would miss', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THE RULE THE ENTITY CHECK ABOVE CANNOT EXPRESS.
     *
     * That one compares the detector's `affectedEntityType` against the entity
     * the plan reads, and it caught a quote-chasing agent claiming
     * contact-shaped detectors. It cannot catch this: both sides say `contact`
     * and the agent still reaches nobody.
     *
     * `follow_up_new_enquiries` finds `has_bookings false` — people who got in
     * touch and never booked. It was given three more detectors because all
     * four report contacts:
     *
     *   conv_pipeline_stuck   a contact idling in a stage, who may have booked
     *   conv_no_next_step     the catalogue's broadest detector: anybody with
     *                         history and nothing scheduled next
     *   conv_stage_dropoff    a stage people stop at, anywhere in the journey
     *
     * On the live account that raised it, all four people across two such
     * cards had bookings — so the find returned zero for every one of them,
     * and the card offered an agent that covered nobody on it.
     *
     * Pinned as a LIST rather than a rule, because the real rule ("the
     * detector's population is inside the agent's find") needs both sides to
     * declare a population and neither does. So the claims are written down
     * with the reasoning in `catalog.ts`, and changing them means reading it.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const claims = Object.fromEntries(
      AUTOMATION_AGENTS.map(a => [a.id, [...(a.answersDetectors ?? [])].sort()])
    );

    expect(claims).toEqual({
      /* Every detector on `chase_overdue_invoices` concludes the same thing,
         so it answers the whole process and names none. */
      chase_overdue_invoices: [],
      /* Never booked, and that is the only detector that reports them. */
      follow_up_new_enquiries: ['crm_cold_leads'],
      /* Offered from no card at all — no detector reports an unanswered quote. */
      follow_up_stalled_deals: [],
      /* Has been in, nothing in the diary. The dedupe registry already calls
         the first two one problem; the third is the same shape again. */
      rebook_quiet_clients: ['conv_no_next_step', 'conv_pipeline_stuck', 'conv_stage_dropoff'],
      /* The one detector that reports checkouts nobody finished. */
      recover_abandoned_checkouts: ['conv_abandoned_bookings'],
      /* Quiet for months, reached under marketing consent. */
      win_back_quiet_clients: [
        'crm_engagement_decay',
        'pricing_intro_offer_stuck',
        'ret_repeat_booking_low',
      ],
    });
  });

  it('never has two automations claiming one detector', () => {
    /* Same reason as the process rule: the finder returns the first match, so
       a duplicate would let array order decide what an owner is offered. */
    const claimed = AUTOMATION_AGENTS.flatMap(a => a.answersDetectors ?? []);

    expect(claimed).toEqual([...new Set(claimed)]);
  });

  it('lets at most one agent answer a whole process', () => {
    /*
     * The fallback can only have one occupant. Two agents claiming a process
     * without narrowing to detectors is the ambiguity this split exists to
     * remove.
     */
    const whole = AUTOMATION_AGENTS.filter(
      a => !a.answersDetectors && a.offeredFromInsight !== false
    ).map(a => a.answersProcess);

    expect(whole).toEqual([...new Set(whole)]);
  });

  it('only names a process the registry actually defines', () => {
    /*
     * `answersProcess` has to match `insight.paired_process_id`, which comes
     * from `TRIGGERABLE_PROCESSES`. A typo here is an automation that exists,
     * passes every other check, and is never offered to anybody.
     */
    const registry = readFileSync(
      join(process.cwd(), 'lib', 'business-os', 'insight', 'kernel', 'TriggerableProcesses.ts'),
      'utf-8'
    );

    for (const automation of AUTOMATION_AGENTS) {
      expect(`${automation.id}:${registry.includes(`'${automation.answersProcess}'`)}`).toBe(
        `${automation.id}:true`
      );
    }
  });

  it('only names detectors that exist', () => {
    /*
     * The detector half of the same rule, and the half that was missing.
     *
     * `answersDetectors` is matched against `insight.detector_id`, which is
     * whatever a detector declares as its own `id`. A typo produces an
     * automation that passes every other check here and is simply never
     * offered — the quietest possible failure, because the card falls back to
     * the process match and looks like it is working.
     *
     * Read off the detector sources rather than a list kept here, so adding a
     * detector cannot leave this stale.
     */
    const dir = join(process.cwd(), 'lib', 'business-os', 'insight', 'detectors', 'catalog');
    const declared = new Set(
      readdirSync(dir)
        .filter(f => f.endsWith('.ts'))
        .flatMap(f => [...readFileSync(join(dir, f), 'utf-8').matchAll(/id: '([a-z0-9_]+)'/g)])
        .map(m => m[1])
    );

    for (const automation of AUTOMATION_AGENTS) {
      for (const detector of automation.answersDetectors ?? []) {
        expect(`${automation.id} → ${declared.has(detector) ? detector : `${detector} — NO SUCH DETECTOR`}`)
          .toBe(`${automation.id} → ${detector}`);
      }
    }
  });

  it('answers nothing for an id or a process we do not ship', () => {
    expect(automationById('not_a_real_automation')).toBeUndefined();
    expect(automationForProcess('not_a_real_process')).toBeUndefined();
    /* An insight with no paired process asks nothing of the catalogue, rather
       than matching the first entry with an undefined key. */
    expect(automationForProcess(undefined)).toBeUndefined();
  });
});

describe('the tags an install carries', () => {
  it('pairs a shared tag with a specific one', () => {
    /*
     * The same pair the mailbox channel uses: one answers "is this an
     * automation at all" for a list, the other answers "which one" for an
     * install check. One tag cannot do both.
     */
    expect(automationAgentTag('chase_overdue_invoices')).toBe(
      `${AUTOMATION_AGENT_TAG}:chase_overdue_invoices`
    );
  });

  it('keeps the specific tag a prefixed form of the shared one', () => {
    /* `installedAutomations` reads the id back out by splitting on the colon.
       A specific tag that did not start with the shared one would be found by
       the list query and then report an undefined id. */
    expect(automationAgentTag('chase_overdue_invoices').startsWith(`${AUTOMATION_AGENT_TAG}:`)).toBe(
      true
    );
  });
});

describe('the fingerprint that keeps an install current', () => {
  /*
   * Every owner gets their own `agents` row and the runtime reads the plan off
   * it, so the plan is a COPY. A copy goes stale: the first invoice chaser
   * would have emailed the same client every morning, and under a plain copy
   * that fix would have reached new installs only.
   */
  it('changes when the plan changes', () => {
    const before = planVersion([{ action: 'find_invoices' }]);
    const after = planVersion([{ action: 'find_invoices', limit: 25 }]);

    expect(before).not.toBe(after);
  });

  it('is stable for the same plan', () => {
    /* Called on every install. A fingerprint that moved on its own would
       rewrite every owner's plan on every press. */
    const steps = [{ action: 'send_invoices', params: { target_id: '{{x}}' } }];

    expect(planVersion(steps)).toBe(planVersion(steps));
  });

  it('notices a change anywhere in the plan, not just at the top', () => {
    /* The resend guard that was missing lives three levels down, inside a
       filter inside a params object inside a step. */
    const base = [{ params: { filters: [{ field: 'status', op: 'eq' }] } }];
    const deep = [{ params: { filters: [{ field: 'status', op: 'neq' }] } }];

    expect(planVersion(base)).not.toBe(planVersion(deep));
  });

  it('gives every shipped plan a fingerprint', () => {
    for (const automation of AUTOMATION_AGENTS) {
      expect(planVersion(automation.steps)).toMatch(/^[0-9a-f]+$/);
    }
  });
});

