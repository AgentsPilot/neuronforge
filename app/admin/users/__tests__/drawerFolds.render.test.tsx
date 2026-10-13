/**
 * @jest-environment jsdom
 */

/**
 * The Businesses drawer's folds (Admin Layout follow-ups LF-4a.2, BD-8): the
 * first three entries, the rest hidden (never unmounted) behind "Show N more";
 * a closed-by-default region whose children stay mounted.
 */

import React, { useEffect } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Fold, ShowMoreList } from '../components/drawerFolds';

const items = (n: number) =>
  Array.from({ length: n }, (_, i) => (
    <li key={`k${i}`} data-testid="item">
      item {i + 1}
    </li>
  ));

describe('ShowMoreList', () => {
  it('shows up to three with no button', () => {
    render(<ShowMoreList items={items(3)} testId="more" />);
    expect(screen.getAllByTestId('item')).toHaveLength(3);
    expect(screen.queryByTestId('more')).toBeNull();
    expect(screen.queryByTestId('more-rest')).toBeNull();
  });

  it('renders nothing for an empty list but the empty list element', () => {
    const { container } = render(<ShowMoreList items={[]} testId="more" />);
    expect(container.querySelectorAll('li')).toHaveLength(0);
    expect(screen.queryByTestId('more')).toBeNull();
  });

  it('five: three visible, two hidden in the DOM; the toggle names the count and controls the hidden list', () => {
    render(<ShowMoreList items={items(5)} testId="more" />);
    const rest = screen.getByTestId('more-rest');
    const button = screen.getByTestId('more');
    expect(screen.getAllByTestId('item')).toHaveLength(5);
    expect(rest.hidden).toBe(true);
    expect(rest.querySelectorAll('li')).toHaveLength(2);
    expect(rest.textContent).toContain('item 4');
    expect(button.textContent).toBe('Show 2 more');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-controls')).toBe(rest.id);

    fireEvent.click(button);
    expect(rest.hidden).toBe(false);
    expect(button.textContent).toBe('Show fewer');
    expect(button.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(button);
    expect(rest.hidden).toBe(true);
    expect(screen.getAllByTestId('item')).toHaveLength(5);
  });
});

describe('Fold', () => {
  it('is closed by default; toggling hides and shows without unmounting its children', () => {
    let mounts = 0;
    function Child() {
      useEffect(() => {
        mounts += 1;
      }, []);
      return <p data-testid="child">inside</p>;
    }
    render(
      <Fold showLabel="Show all" hideLabel="Hide all" testId="f">
        <Child />
      </Fold>
    );
    const toggle = screen.getByTestId('f-toggle');
    const fold = screen.getByTestId('f-fold');
    expect(fold.hidden).toBe(true);
    expect(toggle.textContent).toBe('Show all');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe(fold.id);
    expect(screen.getByTestId('child').textContent).toBe('inside');

    fireEvent.click(toggle);
    expect(fold.hidden).toBe(false);
    expect(toggle.textContent).toBe('Hide all');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(fold.hidden).toBe(true);
    expect(mounts).toBe(1);
  });
});
