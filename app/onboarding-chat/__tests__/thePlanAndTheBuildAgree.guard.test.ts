/**
 * The plan and the build name the same work, because they read the same list.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Reported from the plan screen: "nothing about complete configuration for the
 * services, they are only placeholders; nothing about the invoice or
 * availability". All three were true, and the cause was that two screens, one
 * click apart, each kept their own answer to the same question.
 *
 *   the build  worked it out from the answers: hours where something is
 *              booked, a processor where a card is taken, bank details where
 *              an invoice goes out, the intake form to read
 *   the plan   had grown only the two money ones
 *
 * So the plan said "1 needs you" where the build then showed three. The plan
 * exists so somebody can decide with the cost in view, and it was understating
 * that cost and then surprising them with it. Neither list carried "finish
 * your services" at all, though both screens say the services are drafts.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS GUARD CHANGED SHAPE ONCE, AND THAT IS THE POINT.
 *
 * It first compared the two lists by name, which is all that was possible
 * while there were two. Both screens now read `ownerTasks`, so the sets cannot
 * disagree, and the thing worth protecting is no longer "do they match" but
 * "is there still only one list". A guard that kept comparing two sets would
 * pass forever by checking nothing.
 *
 * What it cannot check is the rendering, which is deliberately NOT shared: the
 * build draws steps whose result is a sentence, the plan draws cards with a
 * separate note. Those are different shapes for the same facts.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

import { ownerTasks, OWNER_TASK_KEYS } from '@/lib/business-os/onboarding/ownerTasks';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

/** Comments stripped: both files necessarily discuss the keys in prose. */
const strip = (source: string) =>
  source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const PAGES = {
  plan: strip(read('app/onboarding-chat/page.tsx')),
  build: strip(read('app/onboarding-build/page.tsx')),
};

describe('both screens read one list', () => {
  it.each(Object.entries(PAGES))('%s asks ownerTasks rather than deciding itself', (_name, source) => {
    expect(source).toMatch(/ownerTasks\(/);
  });

  it.each(Object.entries(PAGES))('%s does not re-derive the conditions', (_name, source) => {
    /*
     * The four tests that used to live in both files. Any of them reappearing
     * means somebody has started a second list beside the shared one, which is
     * how the screens disagreed the first time.
     */
    expect(source).not.toMatch(/const wantsHours\b/);
    expect(source).not.toMatch(/const collectsOnline\b/);
    expect(source).not.toMatch(/const invoicesSome\b/);
  });

  it.each(Object.entries(PAGES))('%s never gates this work on a price', (_name, source) => {
    /*
     * The gate that has been written and removed five times across these
     * screens: the interview collects no prices, so `price > 0` is always
     * false and silently empties the list. It reads as a reasonable test for
     * "does this business take money" right up until you notice nobody is
     * asked.
     */
    /*
     * `.some(` as well as `.filter(`. The first version of this matched only
     * `.filter(` and passed over a sixth instance three hundred lines below
     * it, written as `.some(service => (service.price || 0) > 0 && ...)`.
     */
    expect(source).not.toMatch(
      /\.(filter|some|every)\(\s*\w+\s*=>\s*\(?\s*\w+\.price[^)]*\)?\s*(>|>=|!==)\s*0/
    );
  });

  it('counts the tasks rather than hardcoding how many there are', () => {
    expect(PAGES.plan).toMatch(/\{yoursCards\.length\}/);
  });

  /**
   * ───────────────────────────────────────────────────────────────────────────
   * THE BUILD SCREEN CONFIGURES NOTHING, AND THAT IS NOW THE INVARIANT.
   *
   * Nine assertions used to live here, pinning the machinery that let this
   * screen finish the owner's work in place: a handler routing every task key
   * to a dialog, six mounted dialogs, a `PROOF_OF_DONE` map asking the server
   * whether each card's work existed, and a reconciliation pass keeping the
   * cards honest in both directions.
   *
   * Every one of them was written to fix a real, measured bug, and the list is
   * worth keeping because it is the argument for the change:
   *
   *   · a dialog's close button counted as "done", so opening the availability
   *     and shutting it again took the card away
   *   · then nothing settled at all, so a card nagged about finished work
   *   · then an absent `journeyGaps` gap was read as completion, which on a
   *     catalogue of drafts means "we could not see anything", and the cards
   *     stayed hidden for an owner who reported it twice
   *   · `bank` settled on a button press, so a blank tax ID passed here and
   *     was refused by the publish gate, whose card no longer existed
   *   · two buttons that looked alike, the louder of which threw the work away
   *   · a card for `services` with a button that routed nowhere
   *
   * Six bugs in one feature, and they share a cause rather than being six
   * accidents: this screen was a SECOND place to configure the business, one
   * click after the interview, with its own order, its own words and its own
   * idea of when a task was finished. Keeping all of that correct meant
   * keeping it in agreement with the dialogs, the publish gate and the
   * dashboard, and it never fully was.
   *
   * So the work moved to where it is unambiguous: a service asks for what IT
   * needs, in the editor where it is changed, at the moment the owner chooses
   * the thing that creates the requirement. This screen reports what was built
   * and opens the door.
   *
   * What is pinned below is that it stays that way. The old assertions cannot
   * simply be deleted — each of them was load-bearing — so they are replaced
   * by the one rule that makes all six bugs unreachable.
   * ───────────────────────────────────────────────────────────────────────────
   */
  it('opens no configuration dialog of its own', () => {
    /*
     * The six that were mounted here. A closed, always-open-false instance of
     * `LazyConfigurationDialog` is deliberately kept and is NOT this: it draws
     * nothing, fetches nothing and exists only to warm the chunk, which
     * `lazyDialogs.guard` pins separately. So the test is for an OPENED one.
     */
    expect(PAGES.build).not.toMatch(/<LazyConfigurationDialog\s+isOpen\b(?!=\{false\})/);
    expect(PAGES.build).not.toMatch(/initialTab=/);
    expect(PAGES.build).not.toMatch(/visibleTabs=/);
    expect(PAGES.build).not.toMatch(/StripeConnectWizard/);
    expect(PAGES.build).not.toMatch(/InvoiceSettingsSection/);
    expect(PAGES.build).not.toMatch(/InboxChannelSetupDialog/);
  });

  it('keeps no second opinion about whether a task is finished', () => {
    /*
     * `PROOF_OF_DONE` and the reconciliation pass were this screen's own
     * answer to "is this done", maintained alongside the publish gate's. One
     * question with two answers is what produced the hidden-card bug, and the
     * only way to keep them in step was to keep asking.
     *
     * Nothing here settles anything now, so there is nothing to keep in step.
     */
    expect(PAGES.build).not.toMatch(/PROOF_OF_DONE/);
    expect(PAGES.build).not.toMatch(/settleOwnerStep/);
    expect(PAGES.build).not.toMatch(/verifyOwnerStep/);
    expect(PAGES.build).not.toMatch(/closeOwnerStep/);
    /* And it no longer writes the session key that recorded those claims. */
    expect(PAGES.build).not.toMatch(/setItem\('onboarding_build_settled'/);
  });

  it('still names the work, so arriving at the dashboard is not a surprise', () => {
    /*
     * Removing the doing must not become removing the telling. An owner who
     * finishes the interview with hours and bank details outstanding is told
     * so here, in the same words the plan card used, and told where it
     * happens. A screen that reports a finished build and quietly omits three
     * outstanding things would be the honesty bug this file opens with.
     */
    expect(PAGES.build).toMatch(/const outstanding = buildSteps\.filter\(step => step\.yours\)/);
    expect(PAGES.build).toMatch(/outstandingCost/);
    /* Each branch says where it is done, in all three languages. */
    expect(PAGES.build).toMatch(/Waiting for you on your dashboard\./);
    expect(PAGES.build).toMatch(/מחכה לך בדשבורד\./);
    expect(PAGES.build).toMatch(/Te espera en tu dashboard\./);
  });

  it('leaves by one door, whether or not anything is outstanding', () => {
    /*
     * The way out used to be a secondary, bordered "I'll do this later" sitting
     * under cards with filled buttons on them — a choice drawn as a retreat.
     * With nothing to configure here there is nothing to retreat from, so the
     * owner with three things left and the owner with none get the same
     * primary button, and neither is made to feel they skipped a step.
     */
    expect(PAGES.build).toMatch(/leaveForDashboard/);
    expect(PAGES.build).not.toMatch(/I'll do this later/);
  });

  it('asks the owner to sequence nothing', () => {
    /*
     * `dependsOn` is still filled by `ownerTasks` and still read by the plan
     * card. What went is this screen's attempt to render it: a measured curve
     * joining the blocking row to the waiting one, and "you can fill this in
     * now, but publishing waits for your hours" under the card.
     *
     * That note was the clearest statement of the problem being solved. A
     * requirement belongs to the service that creates it, named where it is
     * created, not to a graph the owner holds in their head.
     */
    expect(PAGES.build).not.toMatch(/publishing waits for/);
    expect(PAGES.build).not.toMatch(/const blockedBy\b/);
    expect(PAGES.build).not.toMatch(/linkEnds/);
  });

  it('gives the two cards that share a subject distinct React keys', () => {
    /*
     * `services` is pushed twice on purpose: the platform's own work ("3
     * services created as drafts") and the owner's ("Finish your services").
     * Keyed by id alone, React warned that children "may be duplicated and/or
     * omitted", which is how a card goes missing for reasons nothing logs.
     */
    expect(PAGES.build).toMatch(/key=\{`\$\{step\.yours \? 'yours' : 'built'\}-\$\{step\.id\}`\}/);
  });

  it('draws every task the list can produce, in whatever language', () => {
    /*
     * REPLACES "mounts something for every task the build screen will open".
     *
     * That test existed because a task could be added to the shared list and
     * not to this screen's dialog router, leaving a card with a button that
     * went nowhere. There is no router now, so the failure it caught cannot
     * happen — but the thing underneath it still matters: a key the module can
     * produce must still get an ICON here, or its branch renders with an empty
     * square where the subject should be.
     *
     * Keyed off `OWNER_TASK_KEYS` for the same reason as before: the next task
     * added to the shared module fails here rather than going quiet on screen.
     */
    const icons = /const icons: Record<string, React\.ReactNode> = \{[\s\S]*?\n    \};/
      .exec(PAGES.build)?.[0] ?? '';
    expect(icons).not.toBe('');

    for (const key of OWNER_TASK_KEYS) {
      expect(icons).toContain(`${key}:`);
    }
  });
});

describe('what the one list actually decides', () => {
  const EN = 'en' as const;

  it('owes nothing to a business that sells nothing', () => {
    expect(ownerTasks({ serviceCount: 0 }, EN)).toEqual([]);
  });

  it('owes hours and bank details to a coach who books and invoices', () => {
    /* The reported account, exactly: three scheduled services, collected by
       invoice, with an intake form. */
    const tasks = ownerTasks(
      {
        serviceCount: 3,
        sellsScheduled: true,
        collectionMethod: 'invoice',
        needsIntake: true,
      },
      EN
    ).map(task => task.key);

    /*
     * DEPENDENCIES FIRST, SERVICES LAST. This asserted the old order, which
     * put the catalogue first because it is what the owner meets first. It is
     * also the only task that cannot be finished until the others are:
     * publishing a service is refused without hours or invoice details, which
     * are the cards below it. Offering it first sent people at the one wall.
     */
    expect(tasks).toEqual(['availability', 'bank', 'intake', 'services']);
    expect(tasks).not.toContain('stripe');
  });

  it('tells the screen what the services are waiting on', () => {
    const tasks = ownerTasks(
      { serviceCount: 3, sellsScheduled: true, collectionMethod: 'invoice', needsIntake: true },
      EN
    );

    const services = tasks.find(task => task.key === 'services');
    expect(services?.dependsOn).toEqual(['availability', 'bank']);
  });

  it('invents no blocker out of work this business never owed', () => {
    /*
     * A coach who takes no cards is not waiting on Stripe. Listing it would
     * name a dependency on a card that is not even on the screen.
     */
    const services = ownerTasks(
      { serviceCount: 1, sellsScheduled: true, collectionMethod: 'invoice' },
      EN
    ).find(task => task.key === 'services');

    expect(services?.dependsOn).not.toContain('stripe');
    expect(services?.dependsOn).not.toContain('intake');
  });

  it('blocks nothing where the services need nothing', () => {
    /* Sells something unbooked and unpaid: the catalogue waits on no one. */
    const services = ownerTasks(
      { serviceCount: 2, sellsScheduled: false, collectionMethod: 'none' },
      EN
    ).find(task => task.key === 'services');

    expect(services?.dependsOn).toEqual([]);
  });

  it('leaves every other task free to be done in any order', () => {
    const tasks = ownerTasks(
      { serviceCount: 2, sellsScheduled: true, collectionMethod: 'mixed', needsIntake: true },
      EN
    );

    for (const task of tasks.filter(candidate => candidate.key !== 'services')) {
      expect(task.dependsOn).toEqual([]);
    }
  });

  it('owes a processor and not bank details when every service takes a card', () => {
    const tasks = ownerTasks(
      { services: [{ is_scheduled: true, collection: 'online' }], collectionMethod: 'card_online' },
      EN
    ).map(task => task.key);

    expect(tasks).toContain('stripe');
    expect(tasks).not.toContain('bank');
  });

  it('owes a processor when the drafts have not settled the money and the owner said card', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THE CASE EVERY BUILD SCREEN ACTUALLY SHOWS, and it was missing.
     *
     * The build creates drafts with `collection: null` — the money question is
     * per service and is settled in the services editor, which the owner has
     * not opened yet. The rule read `rows.some(collection === 'online')` as
     * soon as any row existed, so the owner's own answer stopped counting the
     * moment the drafts appeared, and the test was false for every account on
     * that screen.
     *
     * Measured end to end: an owner who answered "the client pays online by
     * card" saw working hours, invoicing and bank details listed, no Stripe
     * step at all, and then a services editor warning that card payments need
     * a connected processor. The one thing only they could do was the one
     * thing never put in front of them.
     *
     * `bank` stays too, on the same nulls: an unsettled row owes the paperwork
     * either way, and which paperwork is not known until it is settled.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const tasks = ownerTasks(
      {
        services: [
          { is_scheduled: true, collection: null },
          { is_scheduled: true, collection: null },
        ],
        collectionMethod: 'card_online',
      },
      EN
    ).map(task => task.key);

    expect(tasks).toContain('stripe');
  });

  it('owes no processor when the rows have settled on something else', () => {
    /* The other half: a settled catalogue is the truth, and a card answer left
       over from the interview does not drag a processor back in. */
    const tasks = ownerTasks(
      {
        services: [
          { is_scheduled: true, collection: 'invoice' },
          { is_scheduled: false, collection: 'invoice' },
        ],
        collectionMethod: 'card_online',
      },
      EN
    ).map(task => task.key);

    expect(tasks).not.toContain('stripe');
    expect(tasks).toContain('bank');
  });

  it('owes both where the catalogue is mixed, which one answer cannot describe', () => {
    /*
     * A practice with a card-paid session and an invoiced programme owes a
     * processor AND its bank details. Naming only the first left the other to
     * be discovered from a client's confused email.
     */
    const tasks = ownerTasks(
      {
        services: [
          { is_scheduled: true, collection: 'online' },
          { is_scheduled: false, collection: 'invoice' },
        ],
      },
      EN
    ).map(task => task.key);

    expect(tasks).toContain('stripe');
    expect(tasks).toContain('bank');
  });

  it('lets the rows overrule the business-wide answer', () => {
    /* Rows are the truth where they exist: a client walks through a service,
       not through a setting. */
    const tasks = ownerTasks(
      {
        services: [{ is_scheduled: false, collection: 'online' }],
        sellsScheduled: true,
        collectionMethod: 'invoice',
      },
      EN
    ).map(task => task.key);

    expect(tasks).not.toContain('availability');
    expect(tasks).not.toContain('bank');
  });

  it('asks for no hours when nothing is booked against a time', () => {
    const tasks = ownerTasks(
      { serviceCount: 2, sellsScheduled: false, collectionMethod: 'card_online' },
      EN
    ).map(task => task.key);

    expect(tasks).not.toContain('availability');
  });

  it('speaks every language the chat does, with no gaps', () => {
    for (const language of ['en', 'he', 'es'] as const) {
      const tasks = ownerTasks(
        /* EVERY key, which is what this asserts — so the input has to ask for
           every one of them. `hasOwnWebsite` joined the list on 2026-10-26
           with the mailbox lead channel, and `leadsArriveByEmail` on
           2026-11-03 when the two facts were split apart: the task is to
           connect a MAILBOX, so a site whose enquiries never reach one leaves
           it nothing to do. Both are needed to ask for `mailbox` now. */
        {
          serviceCount: 1,
          sellsScheduled: true,
          collectionMethod: 'mixed',
          needsIntake: true,
          hasOwnWebsite: true,
          leadsArriveByEmail: true,
        },
        language
      );
      expect(tasks).toHaveLength(OWNER_TASK_KEYS.length);
      for (const task of tasks) {
        expect(task.title.length).toBeGreaterThan(0);
        expect(task.body.length).toBeGreaterThan(0);
        expect(task.minutes).toBeGreaterThan(0);
      }
    }
  });

  it('writes no clause-joining dash, in any language', () => {
    /*
     * These strings are rendered by two screens that `noDashesInOnboardingCopy`
     * guards, and that guard reads those FILES. Moving the words here would
     * have taken them out of its reach.
     */
    for (const language of ['en', 'he', 'es'] as const) {
      for (const task of ownerTasks(
        { serviceCount: 1, sellsScheduled: true, collectionMethod: 'mixed', needsIntake: true },
        language
      )) {
        expect(task.title).not.toMatch(/—|–| - /);
        expect(task.body).not.toMatch(/—|–| - /);
      }
    }
  });
});
