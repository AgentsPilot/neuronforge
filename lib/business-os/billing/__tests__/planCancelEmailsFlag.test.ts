/**
 * The plan-cancel emails switch (D4a / SX-3; workplan §8 row 1; SA S-15):
 * off by default, `true` / `1` on, anything else off. Read on every call.
 */

import { isPlanCancelEmailsEnabled } from '../planCancelEmailsFlag';

const NAME = 'BUSINESS_OS_PLAN_CANCEL_EMAILS_ENABLED';
const saved = process.env[NAME];
afterEach(() => {
  if (saved === undefined) delete process.env[NAME];
  else process.env[NAME] = saved;
});

describe('isPlanCancelEmailsEnabled', () => {
  it('is off when unset', () => {
    delete process.env[NAME];
    expect(isPlanCancelEmailsEnabled()).toBe(false);
  });

  it.each(['true', 'TRUE', ' true ', '1'])('%p → on', (value) => {
    process.env[NAME] = value;
    expect(isPlanCancelEmailsEnabled()).toBe(true);
  });

  it.each(['', 'false', '0', 'yes', 'on', 'junk'])('%p → off', (value) => {
    process.env[NAME] = value;
    expect(isPlanCancelEmailsEnabled()).toBe(false);
  });

  it('is read on every call (no module reload needed)', () => {
    process.env[NAME] = 'true';
    expect(isPlanCancelEmailsEnabled()).toBe(true);
    process.env[NAME] = 'false';
    expect(isPlanCancelEmailsEnabled()).toBe(false);
  });
});
