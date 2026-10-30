'use client';

/**
 * The boxes of the Businesses drawer (Admin Layout follow-ups LF-4d, BD-16;
 * user request 2026-10-13): every section and part in its own box, like the
 * summary strip, with one short sentence under its title saying what it is
 * for. Local to this screen, not a shared export (SA SQ-1).
 *
 * - `DrawerBox` wraps the shared `DrawerSection` (unchanged) in a box and puts
 *   the purpose line straight after the heading, inside the named group.
 * - A part is a plain `div` with `PART_BOX` and a `PartPurpose` after its
 *   label. Never a labelled group and never a heading: `focusSectionHeading`
 *   takes the closest labelled group, so a labelled part would take focus
 *   from the section heading (BD-15), and D-20 counts exactly the section
 *   groups (six since data export DE-10a added Data export, SA-9).
 *
 * Both components are declared here, at module level, and never inside a
 * render: a component type created during render would remount the money
 * blocks on every render (SA C7, C4).
 */

import type { ReactNode } from 'react';
import { DrawerSection } from '@/app/admin/components/layout/AdminDrawer';

/** The summary strip's classes, exactly (DB-4 holds them equal). */
export const SECTION_BOX = 'rounded-lg border border-slate-700 bg-slate-800/40 p-3';

/** One step darker than a section box, so a part reads as inside it. */
export const PART_BOX = 'rounded-lg border border-slate-700/70 bg-slate-900/50 p-3';

/** T-5 information colour: at least 5.7:1 on every box shade. */
export const PURPOSE_LINE = 'text-xs text-slate-400';

/**
 * One sentence per box (SA C1 wording; Credits & billing and Plan reworded by
 * TL after QA note 1, so a login with no business does not read "this
 * business"). The danger area keeps its own, unchanged (SQ-5).
 */
export const DRAWER_PURPOSE = {
  credits: 'Credits, top-up purchases and the top-up spending limit.',
  'credits-part': 'Plan allowance, credits used this period, and extra credits given or bought.',
  topups: 'Credit packages this business bought through Stripe, newest first.',
  limit: 'The most this business can spend on top-ups, and its changes.',
  plan: 'The Business OS plan and what it includes.',
  ai: 'AI cost, calls and failures for this account over 30 days.',
  'ai-bos': "Recorded AI cost of this business's Business OS AI calls, in USD.",
  'ai-failures': 'Business OS AI actions that failed, newest first, with audit links.',
  'ai-all': "This account's AI token use in every product, from older records.",
  account: 'Who this login is, how it signs in, and its plugins.',
  'account-account': 'Name, user id and creation date, plus company and phone when given.',
  'account-signin': 'Email verification, sign-in methods, last sign-in, login counts and IPs.',
  'account-plugins': 'Plugins this account connected, and which of them are active.',
  activity: "This account's audit events, such as sign-ins and settings changes.",
  // Data export DE-10a (workplan §7.1, shortened to the DB-3 12-word rule): the sixth section, above the danger area.
  export: "Exports of this account's data, sent to the owner by email.",
} as const;

export type DrawerPurposeKey = keyof typeof DRAWER_PURPOSE;

/** The six drawer sections that get a box around their `DrawerSection` (`export`: data export DE-10a). */
export type DrawerSectionKey = 'credits' | 'plan' | 'ai' | 'account' | 'activity' | 'export';

/** The purpose line of a box: a `p`, never a heading. */
export function PartPurpose({ part }: { part: DrawerPurposeKey }) {
  return (
    <p data-testid={`drawer-purpose-${part}`} className={PURPOSE_LINE}>
      {DRAWER_PURPOSE[part]}
    </p>
  );
}

interface DrawerBoxProps {
  section: DrawerSectionKey;
  title: string;
  /** The section's existing test id, kept on the named group. */
  testId: string;
  children: ReactNode;
}

/** A drawer section in its box, with its purpose line straight after the heading. */
export function DrawerBox({ section, title, testId, children }: DrawerBoxProps) {
  return (
    <div data-testid={`drawer-box-${section}`} className={SECTION_BOX}>
      <DrawerSection title={title} testId={testId}>
        <PartPurpose part={section} />
        {children}
      </DrawerSection>
    </div>
  );
}
