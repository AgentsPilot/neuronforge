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

  it('no testId: no data-testid attribute', () => {
    const { container } = render(<StatusChip tone="warn">Behind</StatusChip>);
    expect((container.firstElementChild as HTMLElement).hasAttribute('data-testid')).toBe(false);
  });
});
