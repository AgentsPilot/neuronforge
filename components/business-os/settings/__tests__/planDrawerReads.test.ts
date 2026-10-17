/**
 * `planDrawerReads` (C-b workplan A-1, R-1..R-4; SA-CB-2). The `my-plan` GET is
 * exactly today's request, a failure says how it failed, an HTTP error is an
 * answer and not a throw, nothing rejects, the starter puts the read in flight
 * at once, and no language ever reaches the wire (B-3).
 */

import { readMyPlan, startPlanDrawerRead } from '@/components/business-os/settings/planDrawerReads';

const mockFetch = jest.fn();

beforeAll(() => {
  (global as unknown as { fetch: typeof mockFetch }).fetch = mockFetch;
});

beforeEach(() => mockFetch.mockReset());

const respond = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe('readMyPlan', () => {
  it("R-1: sends today's request: the URL alone, one argument, no init, no query string (no cache option)", async () => {
    mockFetch.mockResolvedValue(respond({ success: true }));
    await readMyPlan();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0]).toEqual(['/api/business-os/entitlements/my-plan']);
  });

  it('returns the body unjudged, with the status', async () => {
    const body = { success: true, data: { anything: 1 } };
    mockFetch.mockResolvedValue(respond(body));
    await expect(readMyPlan()).resolves.toEqual({ kind: 'answered', status: 200, body });
  });

  it('R-2: a 500 with { success: false } is an ANSWER, not a throw (no branch on ok; SA-CB-2, MB-22)', async () => {
    const body = { success: false, error: 'Internal server error' };
    mockFetch.mockResolvedValue(respond(body, 500));
    await expect(readMyPlan()).resolves.toEqual({ kind: 'answered', status: 500, body });
  });

  it('R-2: a 401 is an answer too, read from json() alone (a response mocked with json only still works)', async () => {
    const body = { success: false };
    mockFetch.mockResolvedValue({ status: 401, json: async () => body });
    await expect(readMyPlan()).resolves.toEqual({ kind: 'answered', status: 401, body });
  });

  it('R-2: a network error is a throw that carries the same err; it never rejects', async () => {
    const err = new TypeError('Failed to fetch');
    mockFetch.mockRejectedValue(err);
    const read = await readMyPlan();
    expect(read).toEqual({ kind: 'threw', err });
    expect(read.kind === 'threw' && read.err).toBe(err);
  });

  it('R-2: a synchronous fetch throw is a throw too (one try over fetch and json)', async () => {
    const err = new Error('sync');
    mockFetch.mockImplementation(() => {
      throw err;
    });
    await expect(readMyPlan()).resolves.toEqual({ kind: 'threw', err });
  });

  it('R-2: a body that is not JSON is a throw that carries err', async () => {
    const err = new SyntaxError('Unexpected token <');
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw err;
      },
    });
    await expect(readMyPlan()).resolves.toEqual({ kind: 'threw', err });
  });
});

describe('startPlanDrawerRead', () => {
  it('R-3: starts the read synchronously, before anything is awaited, and labels it with the language', async () => {
    mockFetch.mockReturnValue(new Promise(() => undefined));
    const read = startPlanDrawerRead('he');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(read.language).toBe('he');
    expect(read.plan).toBeInstanceOf(Promise);
  });

  it('R-4 (B-3): the language never reaches the wire', () => {
    mockFetch.mockReturnValue(new Promise(() => undefined));
    startPlanDrawerRead('he');
    startPlanDrawerRead('es');
    for (const call of mockFetch.mock.calls) {
      expect(call).toHaveLength(1);
      const url = String(call[0]);
      expect(url).not.toContain('?');
      expect(url).not.toMatch(/\bhe\b|\bes\b|lang|locale/);
    }
  });

  it('its promise resolves to the answer', async () => {
    const body = { success: true, data: {} };
    mockFetch.mockResolvedValue(respond(body));
    await expect(startPlanDrawerRead('en').plan).resolves.toEqual({ kind: 'answered', status: 200, body });
  });
});
