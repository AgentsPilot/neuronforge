/**
 * DE-10a (workplan §6.4; SA-6): the one download-name rule, shared by the
 * owner "download again" route and the admin audited download. The owner
 * route's own name assertions stay in its test, unedited; this pins the
 * module itself.
 */

const mockFindCompanyName = jest.fn();
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: { findCompanyName: (...a: unknown[]) => mockFindCompanyName(...a) },
}));
const mockOwnerTimezone = jest.fn();
jest.mock('@/lib/business-os/data-export/ownerClock', () => ({ ownerTimezone: (...a: unknown[]) => mockOwnerTimezone(...a) }));

import { exportDownloadNames } from '../downloadName';
import { exportZipFileNames } from '../fileName';

const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CREATED = '2026-10-17T06:30:00.000Z';

const log = { warn: jest.fn() };

beforeEach(() => {
  jest.clearAllMocks();
  mockFindCompanyName.mockResolvedValue({ data: 'Acme Studio', error: null });
  mockOwnerTimezone.mockResolvedValue('Asia/Jerusalem');
});

it('the account timezone and business name, read for the given account, stamped from created_at', async () => {
  const names = await exportDownloadNames(ACCOUNT, CREATED, log);
  expect(names).toEqual(exportZipFileNames(new Date(CREATED), 'Asia/Jerusalem', 'Acme Studio'));
  expect(names.fileName).toBe('acme-studio-data-export-2026-10-17-0930.zip');
  expect(mockFindCompanyName).toHaveBeenCalledWith(ACCOUNT);
  expect(mockOwnerTimezone).toHaveBeenCalledWith(ACCOUNT, log);
  expect(log.warn).not.toHaveBeenCalled();
});

it.each([
  ['an error answer', () => mockFindCompanyName.mockResolvedValueOnce({ data: null, error: new Error('down') })],
  ['a throw', () => mockFindCompanyName.mockRejectedValueOnce(new Error('down'))],
])('%s from the name read gives the fallback name and one warn with ids only', async (_label, arrange) => {
  arrange();
  const names = await exportDownloadNames(ACCOUNT, CREATED, log);
  expect(names.fileName).toBe('agentpilot-data-export-2026-10-17-0930.zip');
  expect(log.warn).toHaveBeenCalledTimes(1);
  const text = JSON.stringify(log.warn.mock.calls);
  expect(text).not.toContain('acme');
  expect(text).not.toContain('.zip');
});
