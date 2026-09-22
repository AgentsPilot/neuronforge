import { safeNextPath } from '../safeNextPath';

describe('safeNextPath', () => {
  describe('accepts in-app paths', () => {
    it.each([
      ['/test-business-os'],
      ['/business-os'],
      ['/business-os/settings?tab=security'],
      ['/test-business-os#modules'],
      ['/'],
    ])('%s', (path) => {
      expect(safeNextPath(path)).toBe(path);
    });
  });

  describe('refuses anything that could leave this origin', () => {
    it.each([
      ['//evil.com', 'protocol-relative — the browser reads this as an origin'],
      ['///evil.com', 'three slashes, same thing'],
      ['/\\evil.com', 'backslash: browsers normalise it to a slash'],
      ['https://evil.com', 'absolute URL'],
      ['http://localhost:3000/business-os', 'absolute, even to our own host'],
      ['javascript:alert(1)', 'scheme, not a path'],
      ['data:text/html,<script>', 'scheme, not a path'],
      ['business-os', 'relative — no leading slash'],
      ['/foo\\..\\..', 'backslash traversal'],
      ['/foo\nLocation: https://evil.com', 'control character'],
    ])('%s (%s)', (path) => {
      expect(safeNextPath(path)).toBeNull();
    });
  });

  it('refuses empty and missing values', () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath('')).toBeNull();
  });

  it('refuses an over-long path rather than truncating it', () => {
    expect(safeNextPath('/' + 'a'.repeat(512))).toBeNull();
  });

  it('never repairs a hostile value — it returns null or the original', () => {
    const hostile = '//evil.com/path';
    const result = safeNextPath(hostile);
    expect(result === null || result === hostile).toBe(true);
    expect(result).toBeNull();
  });
});
