/**
 * Two rules the add-session route had no guard for, pinned at the source.
 *
 * Reported on a live account on 2026-11-08:
 *
 *   · the owner cancelled a whole package and a session row went on offering
 *     "Book a replacement", proposing 29 December
 *   · the add-a-meeting control went on working on that cancelled package
 *
 * Both reached the same route. Its refusals covered the SHAPE of a package —
 * is it a purchase, has it meetings, is the block full, is the day closed, is
 * the hour taken — and never whether the package still existed. The drawer's
 * own gates were right and were reading state from before the cancel, which is
 * exactly why the rule has to live on the server: the cancel dialog, the
 * no-show dialog and the client's portal all write through here.
 *
 * A source guard rather than a request test: the handler reaches auth, four
 * repositories, the calendar and the mailer, and a test that mocked all of
 * those would be pinned to the mocks rather than to the rule.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const ROUTE = join(
  process.cwd(),
  'app',
  'api',
  'scheduling',
  'bookings',
  '[id]',
  'meetings',
  'route.ts'
);

const source = readFileSync(ROUTE, 'utf8').replace(/\r\n/g, '\n');

/** The source with its block and line comments removed. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');

const GET = code.slice(code.indexOf('export async function GET'), code.indexOf('export async function POST'));
const POST = code.slice(code.indexOf('export async function POST'));

describe('the offer', () => {
  it('reads the package’s status, not only its timezone', () => {
    expect(GET).toContain("select('timezone, status, meeting_status')");
  });

  it('makes no offer for a cancelled package', () => {
    expect(GET).toMatch(/status === 'cancelled'[\s\S]{0,120}meeting_status === 'cancelled'/);
    /* NONE is this handler's "no replacement" answer, already used for every
       other reason it declines. */
    expect(GET).toMatch(/meeting_status === 'cancelled'\s*\)\s*\{[\s\S]{0,400}return NONE;/);
  });

  it('still answers for a live package, so the guard cannot be a blanket refusal', () => {
    expect(GET).toContain('canAdd: Boolean(proposedStart)');
  });
});

describe('the write', () => {
  it('refuses a cancelled package with its own code, before anything is created', () => {
    expect(POST).toContain("code: 'package_cancelled'");
    expect(POST).toMatch(/container\.status === 'cancelled'[\s\S]{0,120}container\.meeting_status === 'cancelled'/);
  });

  it('refuses with 409, the status this route already uses for a state that moved on', () => {
    const refusal = POST.slice(POST.indexOf("code: 'package_cancelled'"));
    expect(refusal.slice(0, 400)).toContain('{ status: 409 }');
  });

  it('refuses BEFORE the session is written', () => {
    expect(POST.indexOf("code: 'package_cancelled'")).toBeLessThan(
      POST.indexOf('createMeeting(')
    );
  });
});

describe('one payment per hour the client actually gets', () => {
  it('asks the chain, not the caller, before a replacement carries a stage', () => {
    expect(POST).toContain('replacedHourAlreadyPaid({');
    expect(POST).toContain('chargeRefusedAsAlreadyPaid');
  });

  it('gates the stage creation on that answer', () => {
    expect(POST).toMatch(
      /if \(input\.charge && perSession && proposal\?\.created_plan_id && !chargeRefusedAsAlreadyPaid\)/
    );
  });

  it('asks only when this session replaces another, so a plain add is untouched', () => {
    expect(POST).toMatch(/if \(input\.charge && perSession && replacedId\)/);
  });
});
