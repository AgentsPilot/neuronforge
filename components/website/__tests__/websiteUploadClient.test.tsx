/**
 * @jest-environment jsdom
 *
 * F-27 SA-F27-2: the two browser callers of `/api/website/upload` offer only
 * the server's allowed types, never send a `bucket`, and show a translated
 * message chosen by the response `code`, never the server's English `error`.
 *
 * Workplan: docs/workplans/WEBSITE_UPLOAD_BUCKET_SCOPE_F27_WORKPLAN.md
 */

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger, clientLogger: logger };
});
// `t` echoes the key and its variables, so the test can see which key was chosen.
jest.mock('@/lib/business-os/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key: string, vars?: Record<string, string | number>) => (vars ? `${key}|${JSON.stringify(vars)}` : key),
    isRTL: false,
    language: 'en',
  }),
}));

import { MediaUploader } from '@/components/website/MediaUploader';
import { MediaLibraryPicker } from '@/components/website/MediaLibraryPicker';

const SERVER_ENGLISH = 'Please choose a PNG, JPEG, WebP or GIF image';

function reply(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const pngFile = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'a.png', { type: 'image/png' });

function fileInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('input[type="file"]');
  if (!input) throw new Error('no file input');
  return input as HTMLInputElement;
}

describe('MediaUploader', () => {
  let uploads: FormData[];

  function mockUpload(status: number, body: unknown) {
    uploads = [];
    global.fetch = jest.fn((_url: string, init?: RequestInit) => {
      uploads.push(init?.body as FormData);
      return Promise.resolve(reply(status, body));
    }) as unknown as typeof fetch;
  }

  it('offers no SVG and sends no bucket', async () => {
    mockUpload(200, { success: true, url: 'https://x/a.png', path: 'u/a.png', bucket: 'website-images' });
    const onChange = jest.fn();
    const { container } = render(<MediaUploader onChange={onChange} folder="logos" />);
    const input = fileInput(container);
    expect(input.accept).not.toMatch(/svg/i);
    expect(input.accept.split(',').sort()).toEqual(['image/gif', 'image/jpeg', 'image/png', 'image/webp']);

    await act(async () => {
      fireEvent.change(input, { target: { files: [pngFile()] } });
    });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('https://x/a.png'));
    expect(uploads).toHaveLength(1);
    expect(uploads[0].has('bucket')).toBe(false);
    expect(uploads[0].get('folder')).toBe('logos');
  });

  it.each([
    ['file_type', 'media.upload.invalid_type'],
    ['file_too_large', 'media.upload.too_large|{"size":4}'],
    ['upload_failed', 'media.upload.failed'],
    [undefined, 'media.upload.failed'],
  ])('code %p shows %s, not the server text', async (code, shown) => {
    mockUpload(400, { success: false, error: SERVER_ENGLISH, code });
    const { container } = render(<MediaUploader onChange={jest.fn()} />);
    await act(async () => {
      fireEvent.change(fileInput(container), { target: { files: [pngFile()] } });
    });
    await waitFor(() => expect(screen.getByText(shown)).toBeInTheDocument());
    expect(screen.queryByText(SERVER_ENGLISH)).not.toBeInTheDocument();
  });

  it('refuses an SVG in the browser, with the translated message', async () => {
    mockUpload(200, {});
    const { container } = render(<MediaUploader onChange={jest.fn()} />);
    const svg = new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' });
    await act(async () => {
      fireEvent.change(fileInput(container), { target: { files: [svg] } });
    });
    expect(screen.getByText('media.upload.invalid_type')).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('MediaLibraryPicker upload', () => {
  function mockFetch(uploadStatus: number, uploadBody: unknown) {
    global.fetch = jest.fn((url: string, init?: RequestInit) => {
      if (String(url).includes('/api/website/upload') && init?.method === 'POST') {
        return Promise.resolve(reply(uploadStatus, uploadBody));
      }
      return Promise.resolve(reply(200, { success: true, data: [] }));
    }) as unknown as typeof fetch;
  }

  async function renderPicker() {
    const view = render(<MediaLibraryPicker section="hero" onSelect={jest.fn()} onClose={jest.fn()} />);
    await waitFor(() => expect(screen.queryByText('media.library.loading')).not.toBeInTheDocument());
    return view;
  }

  it('offers GIF and no SVG', async () => {
    mockFetch(200, {});
    const { container } = await renderPicker();
    const input = fileInput(container);
    expect(input.accept).not.toMatch(/svg/i);
    expect(input.accept.split(',').sort()).toEqual(['image/gif', 'image/jpeg', 'image/png', 'image/webp']);
  });

  it.each([
    ['file_type', 'media.upload.invalid_type'],
    ['file_too_large', 'media.upload.too_large|{"size":4}'],
    ['internal', 'media.upload.failed'],
  ])('code %p shows %s, not the server text', async (code, shown) => {
    mockFetch(400, { success: false, error: SERVER_ENGLISH, code });
    const { container } = await renderPicker();
    await act(async () => {
      fireEvent.change(fileInput(container), { target: { files: [pngFile()] } });
    });
    await waitFor(() => expect(screen.getByText(shown)).toBeInTheDocument());
    expect(screen.queryByText(SERVER_ENGLISH)).not.toBeInTheDocument();
  });
});
