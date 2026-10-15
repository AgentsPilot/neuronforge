/**
 * @jest-environment jsdom
 */
/**
 * `downloadUserDataExport` (data export DE-0a A-1): asks the server export,
 * saves only a 200 body, and reports a verdict the screen can put on show.
 */

import { downloadUserDataExport, filenameFromContentDisposition, USER_DATA_EXPORT_URL } from '../downloadUserDataExport';

const fetchMock = jest.fn();
const createObjectURL = jest.fn(() => 'blob:mock');
const revokeObjectURL = jest.fn();
let clicked: Array<{ href: string; download: string }> = [];

beforeAll(() => {
  (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
  Object.assign(URL, { createObjectURL, revokeObjectURL });
  jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push({ href: this.getAttribute('href') ?? '', download: this.download });
  });
});

beforeEach(() => {
  fetchMock.mockReset();
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  clicked = [];
});

function answer(status: number, body: string, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name] ?? headers[name.toLowerCase()] ?? null },
    blob: async () => new Blob([body], { type: 'application/json' }),
    // DE-4: the 413 refusal is read for its code.
    json: async () => JSON.parse(body),
  };
}

describe('downloadUserDataExport', () => {
  it('saves the server export under the server filename and revokes the URL', async () => {
    fetchMock.mockResolvedValue(
      answer(200, '{"user":{}}', {
        'Content-Disposition': 'attachment; filename="neuronforge-data-export-u1-1700000000000.json"',
      })
    );

    const result = await downloadUserDataExport();

    expect(result).toEqual({ success: true, filename: 'neuronforge-data-export-u1-1700000000000.json' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(USER_DATA_EXPORT_URL, { cache: 'no-store', credentials: 'same-origin' });
    expect(clicked).toEqual([{ href: 'blob:mock', download: 'neuronforge-data-export-u1-1700000000000.json' }]);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');
    expect(document.querySelectorAll('a').length).toBe(0);
  });

  it('a 401 is "unauthorized" and saves nothing', async () => {
    fetchMock.mockResolvedValue(answer(401, '{"error":"Unauthorized"}'));

    const result = await downloadUserDataExport();

    expect(result).toEqual({ success: false, status: 401, code: 'unauthorized' });
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(clicked).toEqual([]);
  });

  it('a 500 is "server_error" and saves nothing', async () => {
    fetchMock.mockResolvedValue(answer(500, '{"error":"Failed to export user data"}'));

    const result = await downloadUserDataExport();

    expect(result).toEqual({ success: false, status: 500, code: 'server_error' });
    expect(clicked).toEqual([]);
  });

  // DE-4 (§2.6): keyed on the server's code, not on the status alone (SA review DE-4).
  it('a 413 carrying code export_too_large is "too_large" and saves nothing', async () => {
    fetchMock.mockResolvedValue(
      answer(413, JSON.stringify({ success: false, error: 'Your account holds more than…', code: 'export_too_large' }))
    );

    const result = await downloadUserDataExport();

    expect(result).toEqual({ success: false, status: 413, code: 'too_large' });
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(clicked).toEqual([]);
  });

  it('negative controls: a 413 without the code, or with an unreadable body, is "server_error"', async () => {
    fetchMock.mockResolvedValue(answer(413, '{"error":"Payload Too Large"}'));
    expect(await downloadUserDataExport()).toEqual({ success: false, status: 413, code: 'server_error' });
    fetchMock.mockResolvedValue(answer(413, '<html>Request Entity Too Large</html>'));
    expect(await downloadUserDataExport()).toEqual({ success: false, status: 413, code: 'server_error' });
    // The code on another status does not count either.
    fetchMock.mockResolvedValue(answer(500, '{"code":"export_too_large"}'));
    expect(await downloadUserDataExport()).toEqual({ success: false, status: 500, code: 'server_error' });
    expect(clicked).toEqual([]);
  });

  it('a network failure is "network" and does not throw', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await downloadUserDataExport();

    expect(result).toEqual({ success: false, code: 'network' });
    expect(clicked).toEqual([]);
  });
});

describe('filenameFromContentDisposition', () => {
  const fallback = /^my-data-\d{4}-\d{2}-\d{2}\.json$/;

  it('falls back to my-data-<date>.json without a header', () => {
    expect(filenameFromContentDisposition(null)).toMatch(fallback);
  });

  it('ignores a filename carrying a path', () => {
    expect(filenameFromContentDisposition('attachment; filename="../../evil.json"')).toMatch(fallback);
  });

  it('reads an unquoted filename', () => {
    expect(filenameFromContentDisposition('attachment; filename=export.json')).toBe('export.json');
  });
});
