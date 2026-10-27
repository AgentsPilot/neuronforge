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

  it('gives every task on the build screen somewhere to go', () => {
    /*
     * MEASURED. `services` was added to the shared list and not to
     * `openOwnerStep`, so its card rendered with a working-looking "Fill in
     * details" button that did nothing at all. Reported as "why is the service
     * dialog not opened when clicking on this one".
     *
     * A card naming work the screen cannot route to is worse than no card: it
     * reads as broken rather than as unfinished. So every key the module can
     * produce has to appear in the handler, and adding the next one without a
     * destination fails here rather than going quiet on screen.
     */
    const handler = /const openOwnerStep[\s\S]*?\n  \};/.exec(PAGES.build)?.[0] ?? '';
    expect(handler).not.toBe('');

    for (const key of OWNER_TASK_KEYS) {
      expect(handler).toContain(`'${key}'`);
    }
  });

  it('never settles a card just because its dialog closed', () => {
    /*
     * ───────────────────────────────────────────────────────────────────────
     * WRONG IN THREE WAYS IN A ROW, WHICH IS WHY THIS IS PINNED.
     *
     * 1. `onClose={() => settleOwnerStep(id)}` — opening a card and shutting
     *    it marked the work done. "I opened the availability, didn't wait for
     *    a sec and closed the dialog, the card got disappeared."
     *
     * 2. Plain `setOpenStep(null)` — nothing was ever settled, so a card the
     *    owner HAD finished stayed on screen nagging about finished work.
     *
     * 3. Asking `journeyGaps` and settling when the gap was absent. That
     *    cannot work on an account fresh out of onboarding: asked without
     *    naming services, the readiness route filters `is_active = true`, a
     *    catalogue of DRAFTS matches nothing, and the gap check short-circuits
     *    into "ready". The route's own comment warns of exactly this — "we
     *    found nothing to check" must not read as "nothing is wrong" — and
     *    the cards stayed hidden for the owner who reported it twice.
     * ───────────────────────────────────────────────────────────────────────
     */
    expect(PAGES.build).not.toMatch(/onClose=\{\(\) => settleOwnerStep\(/);
    expect(PAGES.build).toMatch(/PROOF_OF_DONE/);
  });

  it('asks whether the work exists, never whether a gap is absent', () => {
    /*
     * THE LESSON FROM (3). An absent gap means "nothing blocked us", which on
     * a draft catalogue means "we could not see anything" — not "it is done".
     * Completion has to be positively observed.
     */
    const proof = /const PROOF_OF_DONE[\s\S]*?\n  \};/.exec(PAGES.build)?.[0] ?? '';
    expect(proof).not.toBe('');

    /* Direct reads, each answering "is the work there?" */
    expect(proof).toMatch(/\/api\/scheduling\/availability/);
    expect(proof).toMatch(/\/api\/scheduling\/services/);

    /* And no reliance on the gap check for this question. */
    expect(proof).not.toMatch(/journey-readiness/);
  });

  it('reconciles the cards with the server in BOTH directions', () => {
    /*
     * MEASURED. The reconciliation only ever dropped false claims, never added
     * a true one, so a business that had finished a task saw its card come
     * back the moment the session cache was cleared or the page was opened in
     * another tab. Reported as working hours showing outstanding on a business
     * that had set them, with the publish gate disagreeing.
     *
     * Safe in both directions BECAUSE the proofs are positive evidence: hours
     * either exist or they do not. A task with no proof is still never touched
     * either way, which is why `intake` keeps whatever state it had.
     */
    /* Anchored on CODE. `PAGES.build` is comment-stripped, so a regex keyed
       on the heading above the effect matches nothing at all. */
    const effect =
      /const verifiable = Object\.keys\(PROOF_OF_DONE\)[\s\S]*?\n  \}, \[buildComplete\]\);/
        .exec(PAGES.build)?.[0] ?? '';
    expect(effect).not.toBe('');

    /* Reads every verifiable task, not only the ones already claimed. */
    expect(effect).toMatch(/Object\.keys\(PROOF_OF_DONE\)\.filter\(id => PROOF_OF_DONE\[id\]\)/);
    /* And acts on both answers. */
    expect(effect).toMatch(/next\[id\] = true/);
    expect(effect).toMatch(/delete next\[id\]/);
  });

  it('settles the services card on one published service, not on a full catalogue', () => {
    /*
     * Onboarding drafts rows from a COUNT, and a business may open with one of
     * them. Holding the card up until every row carries a price and a length
     * turned a reasonable choice into an outstanding chore.
     *
     * `active` rather than merely filled in: publishing is the moment a
     * service passes the gate, so that is the moment there is something a
     * client can actually buy.
     */
    const proof = /const PROOF_OF_DONE[\s\S]*?\n  \};/.exec(PAGES.build)?.[0] ?? '';
    expect(proof).toMatch(/rows\.some\(\(row: \{ status\?: string \| null \}\) => row\?\.status === 'active'\)/);
    expect(proof).not.toMatch(/rows\.every\(/);
  });

  it('settles only on a verified completion, never on our own failure to check', () => {
    /*
     * The cost of being wrong is asymmetric: an extra card is a moment's
     * annoyance, a missing one is a business that cannot take a booking and
     * was told it was finished. A throwing or falsy check settles nothing.
     */
    const closer = /const closeOwnerStep = async[\s\S]*?\n  \};/.exec(PAGES.build)?.[0] ?? '';
    expect(closer).not.toBe('');
    expect(closer).toMatch(/if \(!proof\) return;/);
    expect(closer).toMatch(/if \(await proof\(\)\) \{[\s\S]*?settleOwnerStep\(id\)/);
    expect(closer).toMatch(/catch/);
  });

  it('leaves unverifiable work alone rather than guessing it is done', () => {
    /*
     * Intake's work is READING a form the platform generated and switched on,
     * which leaves no trace. Claiming it was read would be the first bug all
     * over again, so it has no proof and is never settled by this path.
     */
    const proof = /const PROOF_OF_DONE[\s\S]*?\n  \};/.exec(PAGES.build)?.[0] ?? '';
    expect(proof).toMatch(/intake: undefined/);
    expect(proof).toMatch(/stripe: undefined/);
  });

  it('checks the invoice details against the four the publish gate asks for', () => {
    /*
     * MEASURED. `bank` was the one card that settled on a button press rather
     * than on the work being done: an owner filled in their bank name and
     * account, left the tax ID blank, pressed Done, and watched the card go.
     * Publishing then refused them over a field whose card no longer existed.
     *
     * The four are `missingInvoiceFields`': a company name, a tax ID and an
     * address make the invoice a legal document, and a payment method is how
     * the client learns where to send the money. Checking three of them would
     * reopen the same hole one field narrower.
     */
    const proof = /const PROOF_OF_DONE[\s\S]*?\n  \};/.exec(PAGES.build)?.[0] ?? '';
    expect(proof).toMatch(/invoice_company_name/);
    expect(proof).toMatch(/invoice_tax_id/);
    expect(proof).toMatch(/invoice_address/);
    expect(proof).toMatch(/invoice_bank_account|invoice_payment_instructions/);
  });

  it('offers one button that commits, not two that look alike', () => {
    /*
     * The panel has its own Save, which writes. The screen drew a second,
     * wider, brighter button beneath it that only marked the card settled, so
     * the louder of the two threw the work away. Reported as "the save and
     * done together can mislead the user", which is exactly right.
     */
    expect(PAGES.build).not.toMatch(/settleOwnerStep\('bank'\)/);
    expect(PAGES.build).toMatch(/onSaved=\{\(\) => \{ void verifyOwnerStep\('bank'\); \}\}/);
  });

  it('never traps somebody in a dialog they cannot complete', () => {
    /*
     * An owner may change their mind, or may genuinely have no tax ID. The
     * close button closes FIRST and verifies after, so nothing about being
     * incomplete can hold the dialog open, and the screen keeps its own way
     * out to the dashboard.
     */
    const closer = /const closeOwnerStep = async[\s\S]*?\n  \};/.exec(PAGES.build)?.[0] ?? '';
    expect(closer).toMatch(/\{\s*setOpenStep\(null\);/);
    expect(PAGES.build).toMatch(/leaveForDashboard/);
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

  it('mounts something for every task the build screen will open', () => {
    /* The handler setting state is half of it; the other half is a branch that
       renders when it does. Both were present for the original four. */
    for (const key of OWNER_TASK_KEYS) {
      expect(PAGES.build).toMatch(new RegExp(`openStep === '${key}'`));
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
           with the mailbox lead channel. */
        {
          serviceCount: 1,
          sellsScheduled: true,
          collectionMethod: 'mixed',
          needsIntake: true,
          hasOwnWebsite: true,
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
