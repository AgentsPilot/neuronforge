/**
 * @jest-environment jsdom
 *
 * The version line (app version stamp R19; SA-V8): one uncached fetch, nothing
 * while loading or on any failure, left-to-right, never "null", aborted on
 * unmount. Every value is made up.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

import { AppVersionLine } from '../AppVersionLine';

const GOOD = { success: true, data: { environment: 'staging', commit: 'abcdef0', builtAt: '2026-01-02T03:04:05.000Z' } };

function answer(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as unknown as Response;
}

const fetchMock = jest.fn();
beforeEach(() => {
  fetchMock.mockReset();
  (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
});

describe('AppVersionLine', () => {
  it('renders the line once loaded, from one no-store fetch, left-to-right', async () => {
    fetchMock.mockResolvedValue(answer(GOOD));
    render(<AppVersionLine />);
    const line = await screen.findByTestId('app-version-line');
    expect(line).toHaveTextContent('Staging · abcdef0 · built 2026-01-02 03:04 UTC');
    expect(line).toHaveAttribute('dir', 'ltr');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/version');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: 'no-store' });
  });

  it('renders nothing while loading', () => {
    fetchMock.mockReturnValue(new Promise(() => undefined));
    const { container } = render(<AppVersionLine />);
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ['a network error', () => Promise.reject(new Error('offline'))],
    ['a 500', () => Promise.resolve(answer({ success: false }, false))],
    ['a body that fails the schema', () => Promise.resolve(answer({ success: true, data: { environment: 'Staging' } }))],
    ['a body with an extra field', () => Promise.resolve(answer({ success: true, data: { ...GOOD.data, extra: 'x' } }))],
    ['a non-object body', () => Promise.resolve(answer(null))],
  ])('renders nothing on %s, and logs nothing', async (_case, reply) => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    fetchMock.mockImplementation(reply);
    const { container } = render(<AppVersionLine />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container).toBeEmptyDOMElement();
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('never prints null when commit and build time are missing', async () => {
    fetchMock.mockResolvedValue(answer({ success: true, data: { environment: 'local', commit: null, builtAt: null } }));
    render(<AppVersionLine />);
    const line = await screen.findByTestId('app-version-line');
    expect(line).toHaveTextContent(/^Local$/);
  });

  it('aborts the request on unmount', () => {
    fetchMock.mockReturnValue(new Promise(() => undefined));
    const { unmount } = render(<AppVersionLine />);
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
  });
});
