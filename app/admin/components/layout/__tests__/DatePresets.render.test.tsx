/**
 * @jest-environment jsdom
 */

/**
 * The filter bar's Window control (Admin Layout Standard C-8, §5.5 parts 1
 * and 2; F-73; SA M-2 and Q-11).
 */

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';

import { DatePresets } from '@/app/admin/components/layout/DatePresets';
import type { AdminWindowValue } from '@/app/admin/components/layout/adminWindow';
import { resolveAdminWindow } from '@/app/admin/components/adminWindowPresets';

const NONE: AdminWindowValue = { kind: 'none' };

function setup(value: AdminWindowValue, defaultValue: AdminWindowValue = NONE) {
  const onChange = jest.fn();
  const utils = render(<DatePresets value={value} defaultValue={defaultValue} onChange={onChange} />);
  return { onChange, ...utils };
}

const pressed = () =>
  within(screen.getByRole('group', { name: 'Window' }))
    .getAllByRole('button')
    .filter((button) => button.getAttribute('aria-pressed') === 'true')
    .map((button) => button.textContent);

describe('the Window group', () => {
  it('is a group named Window with five buttons in order, each type=button', () => {
    setup(NONE);
    const buttons = within(screen.getByRole('group', { name: 'Window' })).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Today', '7 days', '30 days', 'This month', 'Custom']);
    for (const button of buttons) expect(button.getAttribute('type')).toBe('button');
  });

  it('presses the active preset only', () => {
    setup({ kind: 'preset', preset: '30d' });
    expect(pressed()).toEqual(['30 days']);
  });

  it('none and linked press nothing', () => {
    const { rerender, onChange } = setup(NONE);
    expect(pressed()).toEqual([]);
    rerender(<DatePresets value={{ kind: 'linked', from: '2026-09-25T10:30', to: null }} defaultValue={NONE} onChange={onChange} />);
    expect(pressed()).toEqual([]);
  });

  it('a preset click applies at once', () => {
    const { onChange } = setup(NONE);
    fireEvent.click(screen.getByRole('button', { name: '7 days' }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'preset', preset: '7d' });
  });

  it('clicking the pressed preset goes back to the page default (SA M-2)', () => {
    const { onChange } = setup({ kind: 'preset', preset: '7d' });
    fireEvent.click(screen.getByRole('button', { name: '7 days' }));
    expect(onChange).toHaveBeenCalledWith(NONE);
  });

  it('on a page whose default is that preset, the second click is a no-op value', () => {
    const def: AdminWindowValue = { kind: 'preset', preset: '30d' };
    const { onChange } = setup(def, def);
    fireEvent.click(screen.getByRole('button', { name: '30 days' }));
    expect(onChange).toHaveBeenCalledWith(def);
  });
});

describe('the Custom row', () => {
  it('Custom opens From (UTC) / To (UTC) date inputs with a dark scheme and Apply; nothing is applied yet', () => {
    const { onChange } = setup(NONE);
    expect(screen.queryByLabelText('From (UTC)')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    const from = screen.getByLabelText('From (UTC)') as HTMLInputElement;
    const to = screen.getByLabelText('To (UTC)') as HTMLInputElement;
    expect(from.type).toBe('date');
    expect(to.type).toBe('date');
    expect(from.className).toContain('[color-scheme:dark]');
    expect(screen.getByRole('button', { name: 'Apply' })).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Apply applies a custom window', () => {
    const { onChange } = setup(NONE);
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('From (UTC)'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('To (UTC)'), { target: { value: '2026-10-05' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'custom', from: '2026-10-01', to: '2026-10-05' });
  });

  it('one-sided Apply is allowed', () => {
    const { onChange } = setup(NONE);
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('To (UTC)'), { target: { value: '2026-10-05' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'custom', from: null, to: '2026-10-05' });
  });

  it('the inputs start from the applied preset’s dates', () => {
    setup({ kind: 'preset', preset: '7d' });
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    const expected = resolveAdminWindow('7d', new Date());
    expect((screen.getByLabelText('From (UTC)') as HTMLInputElement).value).toBe(expected.from);
    expect((screen.getByLabelText('To (UTC)') as HTMLInputElement).value).toBe(expected.to);
  });

  it('an applied custom window shows the row with its dates, and Custom pressed', () => {
    setup({ kind: 'custom', from: '2026-10-01', to: null });
    expect(pressed()).toEqual(['Custom']);
    expect((screen.getByLabelText('From (UTC)') as HTMLInputElement).value).toBe('2026-10-01');
    expect((screen.getByLabelText('To (UTC)') as HTMLInputElement).value).toBe('');
  });

  it('From after To shows an inline alert and applies nothing (Q-11)', () => {
    const { onChange } = setup(NONE);
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('From (UTC)'), { target: { value: '2026-10-05' } });
    fireEvent.change(screen.getByLabelText('To (UTC)'), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByRole('alert').textContent).toBe('The start date must not be after the end date');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Apply is disabled while both inputs are empty and no custom window is applied', () => {
    setup(NONE);
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('with a custom window applied, emptying both inputs and Apply goes back to the default (SA M-2)', () => {
    const { onChange } = setup({ kind: 'custom', from: '2026-10-01', to: '2026-10-05' });
    fireEvent.change(screen.getByLabelText('From (UTC)'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('To (UTC)'), { target: { value: '' } });
    const apply = screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement;
    expect(apply.disabled).toBe(false);
    fireEvent.click(apply);
    expect(onChange).toHaveBeenCalledWith(NONE);
  });

  it('a preset click after typing discards the draft (F-73)', () => {
    const { onChange } = setup(NONE);
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('From (UTC)'), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ kind: 'preset', preset: 'today' });
    expect(screen.queryByLabelText('From (UTC)')).toBeNull();
    // Reopening starts from the applied value (none: empty), not the discarded draft.
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    expect((screen.getByLabelText('From (UTC)') as HTMLInputElement).value).toBe('');
  });
});
