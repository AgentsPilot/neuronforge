/**
 * @jest-environment jsdom
 */

/**
 * The Businesses drawer boxes (Admin Layout follow-ups LF-4d, BD-16): a
 * section in its box with its purpose line straight after the heading, a part
 * purpose line that is never a heading, the sentences' shape, and the section
 * box held equal to the summary strip's look (SA SQ-9 suggestion: rendered,
 * not parsed from source). DB-1 to DB-4 of the LF-4d workplan.
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react';

import {
  DRAWER_PURPOSE,
  DrawerBox,
  PART_BOX,
  PURPOSE_LINE,
  PartPurpose,
  SECTION_BOX,
  type DrawerPurposeKey,
} from '../components/DrawerBox';
import { BusinessSummaryStrip } from '../components/BusinessSummaryStrip';

/** The 14 boxes of the workplan's copy table; the danger area keeps its own sentence. */
const KEYS: DrawerPurposeKey[] = [
  'credits',
  'credits-part',
  'topups',
  'limit',
  'plan',
  'ai',
  'ai-bos',
  'ai-failures',
  'ai-all',
  'account',
  'account-account',
  'account-signin',
  'account-plugins',
  'activity',
];

describe('DB-1: DrawerBox', () => {
  it('a box with the section classes whose only child is the named group; the purpose line follows the heading', () => {
    render(
      <DrawerBox section="plan" title="Plan & entitlements" testId="drawer-section-plan">
        <p>content</p>
      </DrawerBox>
    );
    const box = screen.getByTestId('drawer-box-plan');
    expect(box.className).toBe(SECTION_BOX);
    expect(box.children).toHaveLength(1);
    const group = screen.getByRole('group', { name: 'Plan & entitlements' });
    expect(box.firstElementChild).toBe(group);
    expect(group.getAttribute('data-testid')).toBe('drawer-section-plan');
    const heading = within(group).getByRole('heading', { level: 3 });
    const purpose = heading.nextElementSibling as HTMLElement;
    expect(purpose.getAttribute('data-testid')).toBe('drawer-purpose-plan');
    expect(purpose.tagName).toBe('P');
    expect(purpose.textContent).toBe(DRAWER_PURPOSE.plan);
    expect(purpose.className).toBe(PURPOSE_LINE);
    expect(purpose.nextElementSibling?.textContent).toBe('content');
  });
});

describe('DB-2: PartPurpose', () => {
  it('one p with its own sentence and the purpose class; no role, no heading', () => {
    const { container } = render(<PartPurpose part="topups" />);
    expect(container.children).toHaveLength(1);
    const line = screen.getByTestId('drawer-purpose-topups');
    expect(line.tagName).toBe('P');
    expect(line.textContent).toBe(DRAWER_PURPOSE.topups);
    expect(line.className).toBe(PURPOSE_LINE);
    expect(line.hasAttribute('role')).toBe(false);
    expect(container.querySelector('h1, h2, h3, h4, h5, h6')).toBeNull();
  });
});

describe('DB-3: the sentences', () => {
  it('one per box, exactly the 14 keys of the copy table', () => {
    expect(Object.keys(DRAWER_PURPOSE).sort()).toEqual([...KEYS].sort());
    expect(new Set(Object.values(DRAWER_PURPOSE)).size).toBe(KEYS.length);
  });

  it.each(KEYS)('%s: 1 to 12 words, ends with a full stop, no dollar sign', (key) => {
    const sentence: string = DRAWER_PURPOSE[key];
    const words = sentence.split(' ').filter(Boolean);
    expect({ key, ok: words.length >= 1 && words.length <= 12 }).toEqual({ key, ok: true });
    expect(sentence.endsWith('.')).toBe(true);
    expect(sentence).not.toContain('$');
  });

  it('the box classes use slate only, and the purpose line is slate-400', () => {
    expect(PURPOSE_LINE).toBe('text-xs text-slate-400');
    for (const cls of [SECTION_BOX, PART_BOX]) {
      expect(cls.split(' ').filter((t) => /^(bg|border|text)-/.test(t) && !t.includes('slate') && t !== 'border')).toEqual([]);
    }
  });
});

describe('DB-5: the sentences are the approved copy, word for word (SA C1; TL copy change after QA note 1)', () => {
  it('each box says exactly what the LF-4d copy table says', () => {
    expect(DRAWER_PURPOSE).toStrictEqual({
      credits: 'Credits, top-up purchases and the top-up spending limit.',
      'credits-part': 'Plan allowance, credits used this period, and extra credits given or bought.',
      topups: 'Credit packages this business bought through Stripe, newest first.',
      limit: 'The most this business can spend on top-ups, and its changes.',
      plan: 'The Business OS plan and what it includes.',
      ai: 'AI cost, calls and failures for this account over 30 days.',
      'ai-bos': "Estimated cost of this business's Business OS AI calls, in USD.",
      'ai-failures': 'Business OS AI actions that failed, newest first, with audit links.',
      'ai-all': "This account's AI token use in every product, from older records.",
      account: 'Who this login is, how it signs in, and its plugins.',
      'account-account': 'Name, user id and creation date, plus company and phone when given.',
      'account-signin': 'Email verification, sign-in methods, last sign-in, login counts and IPs.',
      'account-plugins': 'Plugins this account connected, and which of them are active.',
      activity: "This account's audit events, such as sign-ins and settings changes.",
    });
  });
});

describe("DB-4: the section box is the strip's look", () => {
  it("SECTION_BOX equals the rendered strip's className", () => {
    render(
      <BusinessSummaryStrip
        plan={{ kind: 'reading' }}
        credits={{ kind: 'reading' }}
        aiSpend={{ kind: 'reading' }}
        business={null}
        lastSignInAt={null}
      />
    );
    expect(screen.getByTestId('drawer-strip').className).toBe(SECTION_BOX);
  });
});
