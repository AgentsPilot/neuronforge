/**
 * @jest-environment jsdom
 *
 * The public "account deleted" page (data export DE-10b.2; workplan §2.6,
 * §4.3; SA O2-6): no session, no data, en / he / es from a validated `?lang=`.
 */

import '@testing-library/jest-dom';
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen } from '@testing-library/react';

import AccountDeletedPage from '../page';
import { ACCOUNT_DELETED_COPY, accountDeletedLanguage } from '../accountDeletedCopy';
import { isPublicSurfacePath } from '@/components/PlatformChrome';

const fetchSpy = jest.fn();
beforeEach(() => {
  fetchSpy.mockReset();
  (global as unknown as { fetch: unknown }).fetch = fetchSpy;
});

it('renders in English by default, with a link home and no data fetch', () => {
  render(<AccountDeletedPage />);
  expect(screen.getByRole('heading', { name: ACCOUNT_DELETED_COPY.en.title })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: ACCOUNT_DELETED_COPY.en.home })).toHaveAttribute('href');
  expect(screen.getByRole('main')).toHaveAttribute('dir', 'ltr');
  expect(fetchSpy).not.toHaveBeenCalled();
});

it('renders in Hebrew, right to left', () => {
  render(<AccountDeletedPage searchParams={{ lang: 'he' }} />);
  expect(screen.getByRole('heading', { name: ACCOUNT_DELETED_COPY.he.title })).toBeInTheDocument();
  expect(screen.getByRole('main')).toHaveAttribute('dir', 'rtl');
  expect(screen.getByRole('main')).toHaveAttribute('lang', 'he');
});

it('validates ?lang= and never echoes it', () => {
  expect(accountDeletedLanguage('es')).toBe('es');
  expect(accountDeletedLanguage(['he', 'en'])).toBe('he');
  expect(accountDeletedLanguage('<script>')).toBe('en');
  expect(accountDeletedLanguage(undefined)).toBe('en');
  const { container } = render(<AccountDeletedPage searchParams={{ lang: '"><img src=x>' }} />);
  expect(container.innerHTML).not.toContain('img src');
});

it('reads no session and no data (source pin)', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'page.tsx'), 'utf-8');
  expect(source).not.toMatch(/supabase|getUser|cookies\(|headers\(|repositories|fetch\(/);
});

it('is a public surface: no platform shell', () => {
  expect(isPublicSurfacePath('/account-deleted')).toBe(true);
  expect(isPublicSurfacePath('/account-deleted-x')).toBe(false);
});
