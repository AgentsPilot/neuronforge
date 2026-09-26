/**
 * RD-10 (S-0): the three misleading billing documents stay corrected.
 *
 * ── Why a test guards prose ─────────────────────────────────────────────────
 * These three documents did real damage. `BILLING_SYSTEM_COMPLETE_STATUS.md`
 * said the platform has no Stripe integration, no recurring billing and no
 * dunning — all three false, all three live in production — and it was being
 * read as input to planning. `PRICING_SYSTEM_IMPLEMENTATION_PLAN.md` reads as
 * a description of a tier system that was never built. And
 * `STRIPE_BILLING_DATABASE_STATUS.md` lists the orphaned `plans` table beside
 * the live ones under one "✅ EXISTS" heading, which is how somebody ends up
 * wiring Business OS plans to a table with zero callers.
 *
 * A banner is the cheapest possible fix and the easiest thing in the world to
 * lose: a later edit that rewrites the header, a merge that takes the other
 * side, a tidy-up that deletes the "ugly" warning block. None of those show up
 * in a review as a regression — they look like formatting.
 *
 * So the correction is asserted. If somebody removes a banner on purpose they
 * have to delete a test that says why it was there, which is a conversation
 * rather than an accident.
 *
 * ── What this does NOT do ───────────────────────────────────────────────────
 * It does not check the prose is well written, and it does not pin whole
 * paragraphs — that would make every wording improvement a test failure. It
 * pins the small number of claims that were wrong, and the pointer to where
 * the truth lives.
 *
 * @see docs/requirements/BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md RD-10, H-7, F-11
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const read = (relative: string): string => readFileSync(join(root, relative), 'utf8');

/**
 * "The `plans` table has no callers", however it is phrased (QA-3).
 *
 * The banner pins elsewhere in this file are deliberately exact — a banner has
 * an identity, and "did somebody delete the NEVER BUILT heading?" is a question
 * about a specific string. This is different: it pins a **fact**, and a fact
 * that is restated more clearly is an improvement, not a regression. Pinning
 * the literal phrase made "no callers anywhere in the repository" — strictly
 * better English — turn the suite red.
 *
 * So: any of the ways somebody would naturally write it, and none of the ways
 * somebody would write the OPPOSITE. The negative control below proves the
 * second half, because a matcher this permissive is worth suspecting.
 */
const NO_CALLERS = /(zero|no)\s+(known\s+)?callers\b|nothing\s+(has\s+ever\s+)?call(s|ed)?\s+it|never\s+been\s+called/i;

const ARCHIVED = 'docs/archive/BILLING_SYSTEM_COMPLETE_STATUS.md';
const PRICING = 'docs/PRICING_SYSTEM_IMPLEMENTATION_PLAN.md';
const STRIPE_STATUS = 'docs/STRIPE_BILLING_DATABASE_STATUS.md';
const REUSE_PLAN = 'docs/requirements/BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md';

describe('RD-10 — the three billing documents that produced wrong work', () => {
  describe('BILLING_SYSTEM_COMPLETE_STATUS.md', () => {
    it('is in the archive, and not where a planner would find it', () => {
      // The whole point of moving it: `docs/` is read as current.
      expect(existsSync(join(root, ARCHIVED))).toBe(true);
      expect(existsSync(join(root, 'docs/BILLING_SYSTEM_COMPLETE_STATUS.md'))).toBe(false);
    });

    it('names its three false claims, rather than only saying it is old', () => {
      // "Archived" on its own invites somebody to read the body anyway. The
      // three specific corrections are the part that stops them.
      const text = read(ARCHIVED);

      expect(text).toMatch(/Stripe is integrated and live/i);
      expect(text).toMatch(/Recurring billing exists/i);
      expect(text).toMatch(/Dunning exists/i);
    });

    it('says plainly that nothing below the line describes the system now', () => {
      const text = read(ARCHIVED);

      expect(text).toMatch(/Nothing below this line is a statement about the\s+system as it is now/);
      expect(text).toContain(REUSE_PLAN.replace('docs/', '/docs/'));
    });

    it('keeps the original text rather than deleting the record', () => {
      // Archiving is not the same as losing the history of what was believed.
      // If this shrinks to a stub, the "why was this ever written" question
      // becomes unanswerable.
      expect(read(ARCHIVED).length).toBeGreaterThan(10000);
    });
  });

  describe('PRICING_SYSTEM_IMPLEMENTATION_PLAN.md', () => {
    it('carries the never-built banner directly under the title', () => {
      const lines = read(PRICING).split('\n');

      expect(lines[0].startsWith('#')).toBe(true);
      // Immediately under the H1, not buried after a table of contents —
      // somebody skimming reads the first screen and nothing else.
      expect(lines.slice(1, 6).join('\n')).toMatch(/NEVER BUILT/);
    });

    it('records that the `plans` table it designs has no callers', () => {
      // The fact, not the phrasing — see NO_CALLERS.
      const text = read(PRICING);

      expect(text).toMatch(NO_CALLERS);
      expect(text).toContain(REUSE_PLAN.replace('docs/', '/docs/'));
    });

    it('says why it was kept rather than archived', () => {
      // Without the reason, the next reader "tidies up" by archiving it and the
      // only record of the agent platform's pricing discussion goes quiet.
      expect(read(PRICING)).toMatch(/only written record/i);
    });
  });

  describe('STRIPE_BILLING_DATABASE_STATUS.md — and H-7', () => {
    it('splits what shipped from what never did, under the title', () => {
      const lines = read(STRIPE_STATUS).split('\n');

      expect(lines[0].startsWith('#')).toBe(true);
      expect(lines.slice(1, 6).join('\n')).toMatch(/PART OF THIS SHIPPED AND PART NEVER DID/);
    });

    it('records H-7 here, where the mistake would otherwise be made', () => {
      // H-7 has to live in the document that makes `plans` look load-bearing.
      // Recorded anywhere else it is a fact nobody meets at the right moment.
      const text = read(STRIPE_STATUS);

      expect(text).toMatch(/Business OS is NOT built on the `plans` table/);
      expect(text).toContain('lib/business-os/entitlements/config/tierMatrix.ts');
      expect(text).toContain('business_os_account_plans');
      expect(text).toMatch(/Do not wire\s*>?\s*anything to it/);
    });

    it('does not leave `plans` sitting in the same list as the live tables', () => {
      expect(read(STRIPE_STATUS)).toMatch(NO_CALLERS);
    });

    it('the fact matcher accepts better wording and still rejects the opposite', () => {
      // Non-vacuity for a deliberately loose matcher. It has to survive a
      // rewrite and still fail if somebody ever writes that the table IS used
      // — which is the sentence H-7 exists to prevent.
      for (const better of [
        'the table has zero callers',
        'the `plans` table has no callers anywhere in the repository',
        'no known callers',
        'nothing calls it',
        'nothing has ever called it',
        'it has never been called',
      ]) {
        expect(better).toMatch(NO_CALLERS);
      }

      for (const wrong of [
        'the `plans` table has two callers',
        'Business OS reads the `plans` table',
        'the table is called by the webhook',
      ]) {
        expect(wrong).not.toMatch(NO_CALLERS);
      }
    });
  });

  describe('the rule the three share', () => {
    it('each one points at the reuse plan, so there is one place to go next', () => {
      const pointer = REUSE_PLAN.replace('docs/', '/docs/');

      for (const file of [ARCHIVED, PRICING, STRIPE_STATUS]) {
        expect(read(file)).toContain(pointer);
      }
    });

    it('the reuse plan it points at is actually there', () => {
      // Non-vacuity: three documents agreeing on a dead link is worse than
      // three documents with no link, because it looks handled.
      expect(existsSync(join(root, REUSE_PLAN))).toBe(true);
    });

    it('the assertions above would notice a banner being removed', () => {
      // The negative control. Every check in this file is `toContain` against
      // a real file, so a suite that passed because it read the wrong path
      // would be invisible. Prove the matcher can fail on text of this shape.
      const withoutBanner = read(PRICING).replace(/NEVER BUILT/g, '');

      expect(withoutBanner).not.toMatch(/NEVER BUILT/);
      expect(read(PRICING)).toMatch(/NEVER BUILT/);
    });
  });
});
