/**
 * @jest-environment jsdom
 */

/**
 * The drawer's own read (Admin Layout Standard C-9, §5.8 D-7; L-8 workplan
 * §2.5, SA Q-9 and M-4): H-1 to H-11.
 *
 * A harness renders the hook and records every frame it returns, so a test can
 * say both what the screen shows and that a late answer caused no render at
 * all ("sets nothing"). The `read` it is given is deferred: each call is held
 * until the test resolves or rejects it.
 */

import React from 'react';
import { act, render } from '@testing-library/react';

import { ADMIN_NETWORK_ERROR } from '@/app/admin/components/layout/readAdminResponse';
import {
  useDrawerResource,
  type DrawerRead,
  type DrawerReader,
  type DrawerResourceState,
} from '@/app/admin/components/layout/useDrawerResource';

interface Call {
  key: string;
  signal: AbortSignal;
  resolve: (result: DrawerRead<string>) => void;
  reject: (reason: unknown) => void;
}

let calls: Call[];
let frames: { key: string | null; state: DrawerResourceState<string> }[];
let errorSpy: jest.SpyInstance;

const deferred: DrawerReader<string> = (key, signal) =>
  new Promise<DrawerRead<string>>((resolve, reject) => {
    calls.push({ key, signal, resolve, reject });
  });

function Harness({ k, read = deferred }: { k: string | null; read?: DrawerReader<string> }) {
  const state = useDrawerResource(k, read);
  frames.push({ key: k, state });
  return <p data-testid="state">{state.kind === 'ready' ? `ready:${state.data}` : state.kind === 'error' ? `error:${state.message}` : state.kind}</p>;
}

const last = () => frames[frames.length - 1].state;

beforeEach(() => {
  calls = [];
  frames = [];
  // An act warning or a "state update on an unmounted component" is a failure here.
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  expect(errorSpy).not.toHaveBeenCalled();
  errorSpy.mockRestore();
});

describe('useDrawerResource', () => {
  it('H-1: a null key is idle and never reads', () => {
    const read = jest.fn(deferred);
    render(<Harness k={null} read={read} />);
    expect(last()).toEqual({ kind: 'idle' });
    expect(read).not.toHaveBeenCalled();
  });

  it('H-2: a key is loading, then ready; read is called once with the key and a live signal', async () => {
    const read = jest.fn(deferred);
    render(<Harness k="a" read={read} />);
    expect(frames[0].state).toEqual({ kind: 'loading' });
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0][0]).toBe('a');
    expect(read.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
    expect(read.mock.calls[0][1].aborted).toBe(false);
    await act(async () => calls[0].resolve({ ok: true, data: 'A data' }));
    expect(last()).toEqual({ kind: 'ready', data: 'A data' });
  });

  it('H-3: an answer that is not ok shows its message verbatim', async () => {
    render(<Harness k="a" />);
    await act(async () => calls[0].resolve({ ok: false, message: 'This AI action could not be found.' }));
    expect(last()).toEqual({ kind: 'error', message: 'This AI action could not be found.' });
  });

  it("H-4: a rejected read shows the shared network words, never the rejection's text", async () => {
    render(<Harness k="a" />);
    await act(async () => calls[0].reject(new TypeError('Failed to fetch')));
    expect(last()).toEqual({ kind: 'error', message: ADMIN_NETWORK_ERROR });
  });

  it('H-4b (QA L-8b E-2): a read that throws before returning a promise shows the network words, the tree stays mounted', async () => {
    const throwing: DrawerReader<string> = () => {
      throw new Error('synchronous failure');
    };
    await act(async () => {
      render(<Harness k="a" read={throwing} />);
    });
    expect(last()).toEqual({ kind: 'error', message: ADMIN_NETWORK_ERROR });
  });

  it("H-5: key A then B before A settles: A's signal is aborted, A's late answer sets nothing, B's data shows", async () => {
    const { rerender } = render(<Harness k="a" />);
    rerender(<Harness k="b" />);
    expect(calls.map((c) => c.key)).toEqual(['a', 'b']);
    expect(calls[0].signal.aborted).toBe(true);
    expect(calls[1].signal.aborted).toBe(false);
    await act(async () => calls[1].resolve({ ok: true, data: 'B data' }));
    expect(last()).toEqual({ kind: 'ready', data: 'B data' });
    const before = frames.length;
    await act(async () => calls[0].resolve({ ok: true, data: 'A data' }));
    expect(frames).toHaveLength(before);
    expect(last()).toEqual({ kind: 'ready', data: 'B data' });
  });

  it('H-6: closing while loading aborts, is idle, and a late answer sets nothing', async () => {
    const { rerender } = render(<Harness k="a" />);
    rerender(<Harness k={null} />);
    expect(calls[0].signal.aborted).toBe(true);
    expect(last()).toEqual({ kind: 'idle' });
    const before = frames.length;
    await act(async () => calls[0].resolve({ ok: true, data: 'A data' }));
    expect(frames).toHaveLength(before);
    expect(last()).toEqual({ kind: 'idle' });
  });

  it('H-7: reopening the same key after a close reads again, loading until the new answer', async () => {
    const read = jest.fn(deferred);
    const { rerender } = render(<Harness k="a" read={read} />);
    await act(async () => calls[0].resolve({ ok: true, data: 'first' }));
    rerender(<Harness k={null} read={read} />);
    rerender(<Harness k="a" read={read} />);
    expect(read).toHaveBeenCalledTimes(2);
    expect(last()).toEqual({ kind: 'loading' });
    await act(async () => calls[1].resolve({ ok: true, data: 'second' }));
    expect(last()).toEqual({ kind: 'ready', data: 'second' });
  });

  it('H-8: a new inline read on a re-render does not start a second read for the same key', async () => {
    const spy = jest.fn();
    // A fresh function on every render, as a page passing an inline arrow would.
    const inline = (): DrawerReader<string> => (key, signal) => {
      spy();
      return deferred(key, signal);
    };
    const { rerender } = render(<Harness k="a" read={inline()} />);
    rerender(<Harness k="a" read={inline()} />);
    rerender(<Harness k="a" read={inline()} />);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    await act(async () => calls[0].resolve({ ok: true, data: 'A data' }));
    expect(last()).toEqual({ kind: 'ready', data: 'A data' });
  });

  it('H-8: the newest read function is the one used for the next key', async () => {
    const first = jest.fn(deferred);
    const second = jest.fn(deferred);
    const { rerender } = render(<Harness k="a" read={first} />);
    rerender(<Harness k="b" read={second} />);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(second.mock.calls[0][0]).toBe('b');
  });

  it('H-9: a late rejection after an abort sets nothing (no error flash)', async () => {
    const { rerender } = render(<Harness k="a" />);
    rerender(<Harness k="b" />);
    const before = frames.length;
    await act(async () => calls[0].reject(new DOMException('The operation was aborted.', 'AbortError')));
    expect(frames).toHaveLength(before);
    expect(last()).toEqual({ kind: 'loading' });
    await act(async () => calls[1].resolve({ ok: true, data: 'B data' }));
    expect(last()).toEqual({ kind: 'ready', data: 'B data' });
  });

  it('H-10 (SA M-4): unmounting while loading aborts the read, and a late answer sets nothing', async () => {
    const { unmount } = render(<Harness k="a" />);
    const before = frames.length;
    unmount();
    expect(calls[0].signal.aborted).toBe(true);
    await act(async () => calls[0].resolve({ ok: true, data: 'A data' }));
    await act(async () => undefined);
    expect(frames).toHaveLength(before);
  });

  it("H-11 (SA M-4): after A is ready, the very next render with key B is loading, never A's data", async () => {
    const { rerender } = render(<Harness k="a" />);
    await act(async () => calls[0].resolve({ ok: true, data: 'A data' }));
    expect(last()).toEqual({ kind: 'ready', data: 'A data' });
    const before = frames.length;
    rerender(<Harness k="b" />);
    expect(frames[before]).toEqual({ key: 'b', state: { kind: 'loading' } });
    for (const frame of frames.slice(before)) expect(frame.state).not.toEqual({ kind: 'ready', data: 'A data' });
    await act(async () => calls[1].resolve({ ok: true, data: 'B data' }));
    expect(last()).toEqual({ kind: 'ready', data: 'B data' });
  });

  it('H-11: the same holds for an error frame (A failed, B opened)', async () => {
    const { rerender } = render(<Harness k="a" />);
    await act(async () => calls[0].resolve({ ok: false, message: 'A failed' }));
    const before = frames.length;
    rerender(<Harness k="b" />);
    expect(frames[before].state).toEqual({ kind: 'loading' });
  });
});
