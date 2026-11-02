/**
 * The tag the importer writes is the tag the enquiry chaser skips.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE HAZARD, WHICH IS THE WORST SHAPE THIS CODEBASE HAS
 *
 * `import_leads_from_sheet` files old leads out of a spreadsheet. A row in that
 * sheet has no age — it may be a contact the owner typed in two years ago — so
 * every imported contact arrives with a `created_at` of today, no bookings, and
 * an email address.
 *
 * That is EXACTLY the population `follow_up_new_enquiries` selects: a contact
 * with an email, no bookings, and a `created_at` older than a week. So seven
 * days after an import, the chaser would write to every single person in that
 * spreadsheet — two hundred people told their enquiry is being followed up, for
 * an enquiry none of them made.
 *
 * And nothing would connect cause to effect. The import succeeded, quietly and
 * correctly. The emails go out A WEEK LATER, from a different agent, on its own
 * schedule. By the time the owner hears about it the two events are nowhere
 * near each other in any log.
 *
 * The guard is one tag, written by one plan and excluded by the other:
 *
 *     importLeadsFromSheet     "tags": ["spreadsheet-import"]
 *     followUpNewEnquiries     { "not": { "field": "tags",
 *                                         "op": "contains",
 *                                         "value": "spreadsheet-import" } }
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT NEEDS A TEST AND NOT A CONSTANT
 *
 * A shared constant is the obvious answer and it is not available: both sides
 * are committed JSON, not code, and the pilot resolves them as data. So the
 * string is written twice, in two files, with no compiler between them — and
 * the failure mode of them drifting apart is silent, delayed, and lands on
 * real people's inboxes rather than in an error.
 *
 * Renaming the tag in one file is a one-character edit that passes every other
 * test in this directory. This is the only thing that would notice.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { AUTOMATION_AGENTS } from '../catalog';

const PLANS = join(process.cwd(), 'lib/business-os/automations/agents');

const read = (file: string) => JSON.parse(readFileSync(join(PLANS, file), 'utf-8')) as unknown[];

type Node = Record<string, unknown>;

/** Every object anywhere in a plan, however deeply nested. */
function everyNode(value: unknown, out: Node[] = []): Node[] {
  if (Array.isArray(value)) {
    for (const item of value) everyNode(item, out);
  } else if (value && typeof value === 'object') {
    out.push(value as Node);
    for (const inner of Object.values(value as Node)) everyNode(inner, out);
  }
  return out;
}

/** The tags an action writes through `create_contacts`. */
function tagsWrittenBy(file: string): string[] {
  const tags: string[] = [];

  for (const node of everyNode(read(file))) {
    if (node.action !== 'create_contacts') continue;
    const data = ((node.params as Node)?.data ?? {}) as Node;
    if (Array.isArray(data.tags)) tags.push(...(data.tags as string[]));
  }

  return tags;
}

/** The tag values a plan refuses to match, via `not { tags contains … }`. */
function tagsExcludedBy(file: string): string[] {
  const excluded: string[] = [];

  for (const node of everyNode(read(file))) {
    const negated = node.not as Node | undefined;
    if (!negated) continue;
    if (negated.field !== 'tags' || negated.op !== 'contains') continue;
    if (typeof negated.value === 'string') excluded.push(negated.value);
  }

  return excluded;
}

const IMPORTER = 'importLeadsFromSheet.steps.json';
const CHASER = 'followUpNewEnquiries.steps.json';

describe('the import tag and the chaser exclusion are the same string', () => {
  it('the importer tags every contact it files', () => {
    const tags = tagsWrittenBy(IMPORTER);

    /* Not vacuous: if the write stopped carrying tags at all, the pairing below
       would be comparing two empty lists and passing. */
    expect(tags.length).toBeGreaterThan(0);
  });

  it('the chaser excludes exactly what the importer writes', () => {
    const written = tagsWrittenBy(IMPORTER);
    const excluded = tagsExcludedBy(CHASER);

    /*
     * EVERY tag, not merely an overlap. A second tag added to the import for
     * some other purpose would still produce contacts the chaser can see, so
     * the requirement is that nothing the importer writes is un-excluded.
     */
    for (const tag of written) {
      expect(`${CHASER} excludes "${tag}": ${excluded.includes(tag)}`).toBe(
        `${CHASER} excludes "${tag}": true`
      );
    }
  });

  it('no other agent chases a contact an import created', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THE QUESTION THE OWNER ASKED when the tag was proposed: "check that the
     * tag won't affect other agents, chasers etc."
     *
     * Re-derived rather than remembered, because it is a fact about every plan
     * in the directory and a new chaser is one file away.
     *
     * THE DISTINCTION THAT MATTERS, and the one a first version of this test
     * got backwards: `has_bookings` does not make a plan safe. Its VALUE does.
     *
     *   has_bookings = true    requires a booking to exist. An imported row has
     *                          none, so it cannot be in that population at all
     *                          — safe whatever its tags say.
     *   has_bookings = false   is EXACTLY the filter that selects an imported
     *                          contact. It is the hazard, not a guard against
     *                          it.
     *
     * A heuristic that just looked for the word "booking" exempted
     * `follow_up_new_enquiries` — the one agent this whole mechanism exists to
     * disarm — and passed. So the rule is stated on the value.
     *
     * A plan is safe if it requires a positive related record, or if it carries
     * the exclusion. Anything else is reported.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const unsafe: string[] = [];
    let examined = 0;

    for (const file of readdirSync(PLANS).filter(f => f.endsWith('.steps.json'))) {
      if (file === IMPORTER) continue;

      const nodes = everyNode(read(file));
      if (!nodes.some(n => n.action === 'find_contacts')) continue;

      examined += 1;

      /*
       * Requires something an import cannot have produced: a booking, an
       * invoice, a quote, a payment — asserted to EXIST, not to be absent.
       */
      const requiresAPositiveRecord = nodes.some(n => {
        if (typeof n.field !== 'string') return false;
        if (!/booking|invoice|quote|payment|checkout|appointment|proposal/i.test(n.field)) {
          return false;
        }
        /* `eq false` is the hazard, not a narrowing. */
        if (n.op === 'eq' && n.value === false) return false;
        if (n.op === 'is_null') return false;
        return true;
      });

      if (requiresAPositiveRecord) continue;
      if (tagsExcludedBy(file).includes('spreadsheet-import')) continue;

      unsafe.push(file);
    }

    /* Not vacuous: there are other contact-finding plans and they were read. */
    expect(examined).toBeGreaterThan(1);
    expect(unsafe).toEqual([]);
  });

  it('the two plans it pairs are both still in the catalogue', () => {
    /*
     * A guard on the guard. If either agent were removed or renamed, the file
     * reads above would throw — but a plan left on disk and dropped from the
     * catalogue would make this whole file test two things nothing runs.
     */
    const ids = AUTOMATION_AGENTS.map(a => a.id);

    expect(ids).toContain('import_leads_from_sheet');
    expect(ids).toContain('follow_up_new_enquiries');
  });
});
