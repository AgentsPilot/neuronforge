/**
 * isModuleExportEnabled (export redesign MX-1b, workplan §3, T-1; SA MX1B-1).
 * Server-only, default off, on only for the exact string `true`.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { isModuleExportEnabled } from '../featureFlags';

const NAME = 'BUSINESS_OS_MODULE_EXPORT_ENABLED';

describe('isModuleExportEnabled (MX-1b, server-only, default off)', () => {
  const prev = process.env[NAME];
  afterEach(() => {
    if (prev === undefined) delete process.env[NAME];
    else process.env[NAME] = prev;
  });

  it('is off when unset', () => {
    delete process.env[NAME];
    expect(isModuleExportEnabled()).toBe(false);
  });

  it.each(['', '1', 'TRUE', 'True', 'true ', ' true', 'yes', 'on', 'false'])('is off for %p', (value) => {
    process.env[NAME] = value;
    expect(isModuleExportEnabled()).toBe(false);
  });

  it('is on only for the exact string true', () => {
    process.env[NAME] = 'true';
    expect(isModuleExportEnabled()).toBe(true);
  });

  it('has no NEXT_PUBLIC_ copy anywhere in the flags file (one reader, the server)', () => {
    const source = readFileSync(join(process.cwd(), 'lib/utils/featureFlags.ts'), 'utf8');
    expect(source).not.toMatch(/NEXT_PUBLIC_BUSINESS_OS_MODULE_EXPORT/);
    expect(source).toMatch(/process\.env\.BUSINESS_OS_MODULE_EXPORT_ENABLED === 'true'/);
  });
});
