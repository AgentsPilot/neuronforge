/**
 * @jest-environment jsdom
 *
 * `DialogContent`'s optional `closeLabel` (upgrade modal UM-3, SA Q-1, Y-1 /
 * Y-2): default-inert, so every other dialog still names its X "Close"; with
 * the prop the X is named by it; there is exactly one X either way (C-8: no
 * hidden duplicate); and the prop never reaches the DOM as an attribute.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, within } from '@testing-library/react';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

function Probe({ closeLabel }: { closeLabel?: string }) {
  return (
    <Dialog open>
      <DialogContent closeLabel={closeLabel}>
        <DialogTitle>Title</DialogTitle>
        <DialogDescription>Body</DialogDescription>
      </DialogContent>
    </Dialog>
  );
}

describe('DialogContent closeLabel', () => {
  it('without the prop the X is named "Close" (every existing caller)', () => {
    render(<Probe />);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByRole('button')).toHaveLength(1);
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('with the prop the one X is named by it', () => {
    render(<Probe closeLabel="סגירה" />);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByRole('button')).toHaveLength(1);
    expect(within(dialog).getByRole('button', { name: 'סגירה' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  });

  it('the prop is destructured: no closelabel attribute lands on the content element', () => {
    render(<Probe closeLabel="Cerrar" />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).not.toHaveAttribute('closeLabel');
    expect(dialog).not.toHaveAttribute('closelabel');
  });
});
