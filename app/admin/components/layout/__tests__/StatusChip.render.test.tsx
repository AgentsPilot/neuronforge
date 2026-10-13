/**
 * @jest-environment jsdom
 */

/**
 * The shared status chip (Admin Layout Standard C-12, §5.9): a `<span>` with
 * the words and a hidden icon; green only on the `ok` tone.
 */

import React from 'react';
import { render } from '@testing-library/react';

import { StatusChip, type StatusTone } from '@/app/admin/components/layout/StatusChip';

/** The green pattern of the Jobs guard (13 colour prefixes). */
const GREEN = /(?<![\w-])(?:bg|text|border|from|to|via|shadow|outline|decoration|divide|ring|fill|stroke)-(?:green|emerald)-/;

const TONES: Array<[StatusTone, string]> = [
  ['danger', 'Stuck'],
  ['warn', 'Behind'],
  ['ok', 'Clear'],
  ['unknown', 'Could not check'],
];

describe('StatusChip', () => {
  it.each(TONES)('%s: a span carrying the tone, exactly the words, and one hidden icon', (tone, words) => {
    const { container } = render(
      <StatusChip tone={tone} testId="status-badge">
        {words}
      </StatusChip>
    );
    const chip = container.firstElementChild as HTMLElement;
    expect(chip.tagName).toBe('SPAN');
    expect(chip.getAttribute('data-testid')).toBe('status-badge');
    expect(chip.getAttribute('data-tone')).toBe(tone);
    expect(chip.textContent).toBe(words);
    const icons = chip.querySelectorAll('svg');
    expect(icons).toHaveLength(1);
    expect(icons[0].getAttribute('aria-hidden')).toBe('true');
    expect(chip.querySelector('div')).toBeNull();
    expect(chip.className).toContain('inline-flex');
  });

  it.each(TONES)('%s: green only on the ok tone', (tone, words) => {
    const { container } = render(<StatusChip tone={tone}>{words}</StatusChip>);
    const chip = container.firstElementChild as HTMLElement;
    expect(GREEN.test(chip.className)).toBe(tone === 'ok');
  });

  it('unknown is dashed (§5.9 "not measured / could not check")', () => {
    const { container } = render(<StatusChip tone="unknown">No run recorded yet</StatusChip>);
    expect((container.firstElementChild as HTMLElement).className).toContain('border-dashed');
  });

  it('info (L-1d): sky classes, exactly the words, one hidden icon, and no green', () => {
    const { container } = render(
      <StatusChip tone="info" testId="audit-severity">
        Info
      </StatusChip>
    );
    const chip = container.firstElementChild as HTMLElement;
    expect(chip.tagName).toBe('SPAN');
    expect(chip.getAttribute('data-tone')).toBe('info');
    expect(chip.textContent).toBe('Info');
    for (const cls of ['border-sky-500/40', 'bg-sky-500/15', 'text-sky-300']) expect(chip.className).toContain(cls);
    const icons = chip.querySelectorAll('svg');
    expect(icons).toHaveLength(1);
    expect(icons[0].getAttribute('aria-hidden')).toBe('true');
    // lucide names its icons in the class: the Info icon, not another tone's.
    expect(icons[0].getAttribute('class')).toContain('lucide-info');
    expect(GREEN.test(chip.className)).toBe(false);
  });

  it('neutral (L-3): a span, slate classes, exactly the words, no icon and no green', () => {
    const { container } = render(
      <StatusChip tone="neutral" testId="runs-off-badge">
        Runs off
      </StatusChip>
    );
    const chip = container.firstElementChild as HTMLElement;
    expect(chip.tagName).toBe('SPAN');
    expect(chip.getAttribute('data-testid')).toBe('runs-off-badge');
    expect(chip.getAttribute('data-tone')).toBe('neutral');
    expect(chip.textContent).toBe('Runs off');
    for (const cls of ['border-slate-600', 'bg-slate-700/40', 'text-slate-300']) expect(chip.className).toContain(cls);
    // §5.9: the icon is optional for neutral only; a plain state word needs no glyph.
    expect(chip.querySelectorAll('svg')).toHaveLength(0);
    expect(chip.querySelector('div')).toBeNull();
    expect(GREEN.test(chip.className)).toBe(false);
  });

  it('no testId: no data-testid attribute', () => {
    const { container } = render(<StatusChip tone="warn">Behind</StatusChip>);
    expect((container.firstElementChild as HTMLElement).hasAttribute('data-testid')).toBe(false);
  });
});
