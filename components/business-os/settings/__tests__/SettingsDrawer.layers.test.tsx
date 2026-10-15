/**
 * @jest-environment jsdom
 */

/**
 * `SettingsDrawer`'s busy refusal, ONE LAYER AT A TIME (C-4; SA S-1 code review
 * finding 3, QA E-1; S-2 workplan).
 *
 * The busy refusal is layered on purpose: the `onOpenChange` gate, `preventDefault`
 * on Escape and on an outside press, and a disabled X. The behavioural tests in
 * `SettingsDrawer.render.test.tsx` stay green if any single layer goes, because
 * another one still refuses. S-2 gives `isBusy` its first real caller (the
 * password change), so each layer is now pinned on its own here.
 *
 * `@/components/ui/sheet` is replaced by stand-ins that hand back the props the
 * wrapper passed, so each handler can be called directly, without Radix's own
 * layers in the way.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

interface CapturedContentProps {
  onEscapeKeyDown?: (event: { preventDefault: () => void }) => void;
  onInteractOutside?: (event: { preventDefault: () => void }) => void;
}

const mockCaptured: { content: CapturedContentProps } = { content: {} };

jest.mock('@/components/ui/sheet', () => {
  const ReactInMock = jest.requireActual('react') as typeof React;
  return {
    // The Radix root's own close and open requests, as buttons.
    Sheet: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange: (open: boolean) => void;
      children: React.ReactNode;
    }) =>
      ReactInMock.createElement(
        'div',
        null,
        ReactInMock.createElement('button', { type: 'button', onClick: () => onOpenChange(false) }, 'root-close'),
        ReactInMock.createElement('button', { type: 'button', onClick: () => onOpenChange(true) }, 'root-open'),
        open ? children : null
      ),
    SheetContent: ({ children, ...props }: CapturedContentProps & { children: React.ReactNode }) => {
      mockCaptured.content = props;
      return ReactInMock.createElement('div', null, children);
    },
    SheetTitle: ({ children }: { children: React.ReactNode }) => ReactInMock.createElement('h2', null, children),
    SheetDescription: ({ children }: { children: React.ReactNode }) => ReactInMock.createElement('p', null, children),
  };
});

import { SettingsDrawer } from '@/components/business-os/settings/SettingsDrawer';

const CLOSE = 'Close this drawer';

function renderDrawer(isBusy: boolean) {
  const onOpenChange = jest.fn();
  render(
    <SettingsDrawer open onOpenChange={onOpenChange} title="Title" isBusy={isBusy} isRTL={false} closeLabel={CLOSE}>
      <p>Body</p>
    </SettingsDrawer>
  );
  return onOpenChange;
}

beforeEach(() => {
  mockCaptured.content = {};
});

describe('layer 1: the onOpenChange gate, alone', () => {
  it('drops a close request while busy', () => {
    const onOpenChange = renderDrawer(true);
    fireEvent.click(screen.getByRole('button', { name: 'root-close' }));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('passes a close request when not busy', () => {
    const onOpenChange = renderDrawer(false);
    fireEvent.click(screen.getByRole('button', { name: 'root-close' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('never blocks an open request', () => {
    const onOpenChange = renderDrawer(true);
    fireEvent.click(screen.getByRole('button', { name: 'root-open' }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });
});

describe('layer 2: Escape is prevented, alone', () => {
  it.each([
    [true, 1],
    [false, 0],
  ])('busy=%s → preventDefault called %i time(s)', (isBusy, times) => {
    renderDrawer(isBusy);
    const preventDefault = jest.fn();
    mockCaptured.content.onEscapeKeyDown?.({ preventDefault });
    expect(mockCaptured.content.onEscapeKeyDown).toBeDefined();
    expect(preventDefault).toHaveBeenCalledTimes(times);
  });
});

describe('layer 3: an outside press is prevented, alone', () => {
  it.each([
    [true, 1],
    [false, 0],
  ])('busy=%s → preventDefault called %i time(s)', (isBusy, times) => {
    renderDrawer(isBusy);
    const preventDefault = jest.fn();
    mockCaptured.content.onInteractOutside?.({ preventDefault });
    expect(mockCaptured.content.onInteractOutside).toBeDefined();
    expect(preventDefault).toHaveBeenCalledTimes(times);
  });
});

describe('layer 4: the X is disabled, alone', () => {
  it.each([
    [true, true],
    [false, false],
  ])('busy=%s → disabled=%s', (isBusy, disabled) => {
    renderDrawer(isBusy);
    expect((screen.getByRole('button', { name: CLOSE }) as HTMLButtonElement).disabled).toBe(disabled);
  });
});
