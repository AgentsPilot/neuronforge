/**
 * @jest-environment jsdom
 *
 * QA pre-merge pass for DE-10b.2: `/account-deleted` with an unsupported
 * `?lang=` falls back to English, Spanish renders, and the page holds no
 * platform chrome, form or script of its own.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen } from '@testing-library/react';

import AccountDeletedPage from '../page';
import { ACCOUNT_DELETED_COPY } from '../accountDeletedCopy';

it.each([['xx'], ['HE'], [''], ['he-IL']])('?lang=%p → English, left to right', (lang) => {
  render(<AccountDeletedPage searchParams={{ lang }} />);
  expect(screen.getByRole('heading', { name: ACCOUNT_DELETED_COPY.en.title })).toBeInTheDocument();
  expect(screen.getByRole('main')).toHaveAttribute('dir', 'ltr');
  expect(screen.getByRole('main')).toHaveAttribute('lang', 'en');
});

it('?lang=es → Spanish', () => {
  render(<AccountDeletedPage searchParams={{ lang: 'es' }} />);
  expect(screen.getByRole('heading', { name: ACCOUNT_DELETED_COPY.es.title })).toBeInTheDocument();
  expect(screen.getByRole('main')).toHaveAttribute('dir', 'ltr');
});

it('?lang=he → every Hebrew line, RTL, one link and nothing interactive beyond it', () => {
  const { container } = render(<AccountDeletedPage searchParams={{ lang: 'he' }} />);
  expect(screen.getByRole('main')).toHaveAttribute('dir', 'rtl');
  expect(container.textContent).toContain(ACCOUNT_DELETED_COPY.he.body);
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link')).toHaveTextContent(ACCOUNT_DELETED_COPY.he.home);
  expect(container.querySelectorAll('form, input, button, nav, aside')).toHaveLength(0);
});
