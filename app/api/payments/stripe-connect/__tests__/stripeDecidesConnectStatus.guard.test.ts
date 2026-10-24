/**
 * Stripe decides whether an account can take money. Never the browser.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE HOLE THIS CLOSES (FX-1)
 *
 * `/api/payments/stripe-connect` carried a POST and a PUT whose Zod schemas
 * accepted Stripe's own verdict as request body:
 *
 *     charges_enabled · payouts_enabled · details_submitted · onboarding_completed
 *
 * and handed it to the repository unfiltered. A signed-in owner — or anyone
 * holding their session — could declare their own Connect account approved.
 * POST went further and took `stripe_account_id` too, so the record could name
 * an arbitrary Stripe account and claim it was ready to charge.
 *
 * No money moves wrongly: a real charge is still refused by Stripe. What moves
 * is this platform's belief. It shows "Connected", enables payment features,
 * and stops prompting the owner to finish a setup that never happened.
 *
 * Neither handler had a caller. All seven call sites fetch the path bare, which
 * is a GET, so both were deleted rather than tightened — the precedent being
 * the DELETE on `/api/website/upload`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * Nothing fails when a write handler is added back. The route still compiles,
 * every existing test still passes, and the only symptom is a field this
 * platform treats as Stripe's answer being settable by whoever is logged in.
 * That is invisible until someone looks, which is how it survived this long.
 *
 * The rule is not "no POST on this route" — it is that these four fields never
 * arrive from a request body ANYWHERE under `stripe-connect/`. The creation
 * routes legitimately write them, from what Stripe returned.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const ROUTE_DIR = join(__dirname, '..');
const ROOT_ROUTE = join(ROUTE_DIR, 'route.ts');

/** Stripe's verdict on an account. This platform may read it, never receive it. */
const STRIPE_OWNED = [
  'charges_enabled',
  'payouts_enabled',
  'details_submitted',
  'onboarding_completed',
] as const;

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return entry === '__tests__' ? [] : filesUnder(full);
    return entry.endsWith('.ts') ? [full] : [];
  });
}

const source = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

describe('the stripe-connect root route', () => {
  const root = source(ROOT_ROUTE);

  it('is actually reading the route', () => {
    expect(root).toContain("createLogger({ module: 'StripeConnectAPI' })");
  });

  it('serves reads only', () => {
    expect(root).toContain('export async function GET');
    expect(root).not.toContain('export async function POST');
    expect(root).not.toContain('export async function PUT');
    expect(root).not.toContain('export async function PATCH');
    expect(root).not.toContain('export async function DELETE');
  });

  it('parses no request body at all', () => {
    /*
     * The CODE, not the words: the header above names the four fields when
     * explaining what was removed, and a guard that trips on its own
     * documentation is worse than no guard.
     *
     * A read-only route has nothing to validate, so the absence of zod is the
     * sharpest statement of that — there is no schema for a field to creep
     * back into. The field names themselves are policed across the whole
     * directory below, where they actually matter.
     */
    expect(root).not.toContain('from \'zod\'');
    expect(root).not.toContain('z.object(');
    expect(root).not.toContain('request.json()');
  });
});

describe('nowhere under stripe-connect does a request body set Stripe’s verdict', () => {
  /*
   * The creation routes DO write these fields — from the account object Stripe
   * returned. What must never happen is a Zod schema, or a read of the parsed
   * body, putting a caller's value into one of them. So the assertion is on the
   * shape that carries caller input: a `z.object({ … })` naming the field.
   */
  const files = filesUnder(ROUTE_DIR);

  it('is actually reading the directory', () => {
    expect(files.length).toBeGreaterThan(5);
    expect(files.some(f => f.endsWith('create-account-custom/route.ts'))).toBe(true);
  });

  it('has no request schema naming a Stripe-owned field', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const src = source(file);

      /* Every `z.object({ … })` literal in the file, brace-matched. */
      for (const match of src.matchAll(/z\.object\(\{/g)) {
        let depth = 0;
        const open = src.indexOf('{', match.index!);
        let block = '';

        for (let i = open; i < src.length; i += 1) {
          if (src[i] === '{') depth += 1;
          if (src[i] === '}') {
            depth -= 1;
            if (depth === 0) {
              block = src.slice(open, i + 1);
              break;
            }
          }
        }

        for (const field of STRIPE_OWNED) {
          if (block.includes(field)) {
            offenders.push(`${file.slice(file.indexOf('app/'))}: schema accepts ${field}`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
