/**
 * A reply the receptionist drafted must reach the owner's morning.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The gap was complete and invisible. `client_reply_waiting` has been in the
 * registry with a priority, three languages of copy and a self-clearing rule
 * (`reply_handled` closes it) — and the briefing never said a word about it.
 *
 * `fromGaps` is the only route a gap has into the briefing, and it takes an
 * explicit allow-list. `client_reply_waiting` was in none of them, so it was
 * found, counted by the dashboard, and dropped before narration. An owner with
 * a drafted reply sitting in their mail could only learn of it by opening the
 * drafts folder and noticing.
 *
 * The file's own note warned about exactly this: "Adding a definition to the
 * registry does NOT surface it here — the narrator reads these groups, not the
 * gap list — so a new gap that is not mapped is found, counted by the
 * dashboard, and never mentioned."
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const FACTS = strip(read('lib/business-os/briefing/BriefingFactsService.ts'));
const NARRATOR = strip(read('lib/business-os/briefing/BriefingNarrator.ts'));

describe('the gap reaches the briefing facts', () => {
  it('is mapped through fromGaps, the only route there is', () => {
    expect(FACTS).toMatch(/repliesWaiting:\s*fromGaps\(gaps,\s*\['client_reply_waiting'\]\)/);
  });

  it('and is a declared fact, not an untyped extra', () => {
    expect(FACTS).toMatch(/repliesWaiting:\s*\{\s*count: number/);
  });
});

describe('and survives narration', () => {
  it('its figure is permitted, or the invented-number guard drops the line', () => {
    /*
     * Everything the prose may contain has to be permitted. An unpermitted
     * count is treated as a number the model made up, and the line is
     * discarded — silently, which is how this would look fixed and not be.
     */
    expect(NARRATOR).toMatch(/permit\(outlook\.repliesWaiting\?\.count \?\? 0\)/);
  });

  it('the deterministic composer says it too, not only the model', () => {
    /* The composer runs whenever the provider is unavailable. A fact that
       only the LLM path can mention disappears on exactly the mornings the
       provider is down. */
    expect(NARRATOR).toMatch(/outlook\.repliesWaiting\?\.count \?\? 0\) > 0/);
    expect(NARRATOR).toMatch(/phrase\.repliesWaiting\(/);
  });

  it('in all three languages', () => {
    /* Counted rather than matched per language: the three phrase blocks sit
       in one file and a missing one is a silent fallback to English. */
    expect((NARRATOR.match(/repliesWaiting: \(named, n\) =>/g) ?? []).length).toBe(3);
  });

  it('and says a draft MAY be waiting, never that one is', () => {
    /*
     * The agent drafts only when it judged it could; the other outcomes hand
     * the thread over instead. Promising a draft that is not there sends an
     * owner to an empty folder and teaches them to distrust the line.
     */
    expect(NARRATOR).toMatch(/may already be drafted/);
    expect(NARRATOR).toMatch(/ייתכן שכבר מחכה לך טיוטה/);
  });
});

describe('the email carries whatever was narrated', () => {
  it('so mapping the fact is all the email needs', () => {
    /* The template renders `lines`, already narrated in the owner's language —
       there is no per-fact branch in it to update. */
    expect(read('lib/email/templates/daily-briefing.ts')).toMatch(/lines: string\[\]/);
    expect(strip(read('lib/services/DailyBriefingDispatchService.ts'))).toMatch(
      /briefingLines\(briefing\.narrative\)/
    );
  });
});
