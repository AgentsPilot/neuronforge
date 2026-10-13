/**
 * @jest-environment jsdom
 */

/**
 * The Businesses drawer's summary strip (Admin Layout follow-ups LF-4a.2,
 * BD-1, BD-3, BD-12, BD-13): four labelled slots in a `dl`, read-only, never a
 * zero for something that could not be read.
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { BusinessSummaryStrip, type BusinessSummaryStripProps } from '../components/BusinessSummaryStrip';
import recordedAccountBody from '@/app/admin/business-os-tiers/__tests__/__fixtures__/recordedAccountBody.json';

/** The plan words, built from the fixture's tier: no tier name as a literal (FR-12, DV-2). */
const PLAN_WORDS = `${recordedAccountBody.data.plan.tier} · cohort pilot`;

const BASE: BusinessSummaryStripProps = {
  plan: { kind: 'value', text: PLAN_WORDS },
  credits: { kind: 'cell' },
  aiSpend: { kind: 'value', text: '$4.21', sub: 'estimated' },
  business: { companyName: 'Acme Therapy', vertical: 'therapist' },
  creditsLeft: { kind: 'percent', value: 64, trial: false },
  lastSignInAt: '2026-10-10T08:05:00Z',
};

const slot = (id: string) => screen.getByTestId(id);

describe('BusinessSummaryStrip', () => {
  it('labels four slots in order, as one dl, with no link, button or field', () => {
    render(<BusinessSummaryStrip {...BASE} />);
    const strip = screen.getByTestId('drawer-strip');
    const labels = Array.from(strip.querySelectorAll('dt')).map((dt) => dt.textContent);
    expect(labels).toEqual(['Plan', 'Credits left', 'Business OS AI, 30 days', 'Last sign-in']);
    expect(strip.querySelectorAll('dl')).toHaveLength(1);
    expect(strip.querySelectorAll('a, button, input, select, textarea, summary')).toHaveLength(0);
  });

  it('a Business OS account: the plan words, the list cell, the USD figure marked estimated, the UTC sign-in', () => {
    render(<BusinessSummaryStrip {...BASE} />);
    expect(slot('strip-plan').textContent).toBe(PLAN_WORDS);
    expect(within(slot('strip-credits-left')).getByTestId('row-credits-left').textContent).toContain('64%');
    expect(slot('strip-ai-spend').textContent).toBe('$4.21estimated');
    const lines = Array.from(slot('strip-last-sign-in').querySelectorAll('span')).map((s) => s.textContent);
    expect(lines[0]).toBe('2026-10-10 08:05 UTC');
  });

  it('while the reads run: "Reading…" in the three read-backed slots; Last sign-in at once', () => {
    render(
      <BusinessSummaryStrip {...BASE} plan={{ kind: 'reading' }} credits={{ kind: 'reading' }} aiSpend={{ kind: 'reading' }} />
    );
    for (const id of ['strip-plan', 'strip-credits-left', 'strip-ai-spend']) expect(slot(id).textContent).toBe('Reading…');
    expect(slot('strip-last-sign-in').textContent).toContain('UTC');
  });

  it('BD-13: a non-Business OS account says so in Plan, Credits left and AI, never a zero', () => {
    render(
      <BusinessSummaryStrip
        {...BASE}
        business={null}
        creditsLeft={undefined}
        plan={{ kind: 'not_bos' }}
        credits={{ kind: 'not_bos' }}
        aiSpend={{ kind: 'not_bos' }}
      />
    );
    for (const id of ['strip-plan', 'strip-credits-left', 'strip-ai-spend']) {
      expect(slot(id).textContent).toBe('Not a Business OS account');
    }
    const text = screen.getByTestId('drawer-strip').textContent ?? '';
    expect(text).not.toContain('0%');
    expect(text).not.toContain('$0');
    expect(screen.queryByTestId('row-credits-left')).toBeNull();
  });

  it('an unreadable slot says "Could not read", never a zero', () => {
    render(<BusinessSummaryStrip {...BASE} plan={{ kind: 'unreadable' }} aiSpend={{ kind: 'unreadable' }} />);
    expect(slot('strip-plan').textContent).toBe('Could not read');
    expect(slot('strip-ai-spend').textContent).toBe('Could not read');
    expect(slot('strip-ai-spend').textContent).not.toContain('$');
  });

  it('a plan with no tier reads "No plan recorded" (SQ-J), passed as a value', () => {
    render(<BusinessSummaryStrip {...BASE} plan={{ kind: 'value', text: 'No plan recorded' }} />);
    expect(slot('strip-plan').textContent).toBe('No plan recorded');
  });

  it('no sign-in reads "Never"', () => {
    render(<BusinessSummaryStrip {...BASE} lastSignInAt={null} />);
    expect(slot('strip-last-sign-in').textContent).toBe('Never');
  });
});
