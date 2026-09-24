import {
  validatePrefix,
  isReservedPrefix,
  normalizePrefix,
  RESERVED_PREFIXES,
} from '../reservedPrefixes';

/**
 * What stops a business taking over the platform's own hostname.
 *
 * `app.agentspilot.ai` and `joesgym.agentspilot.ai` are siblings served by one
 * deployment, told apart by this list alone — so these are not style checks.
 */
describe('reserved prefixes', () => {
  it('refuses the platform’s own hostname', () => {
    // The whole reason the list exists.
    expect(validatePrefix('app').ok).toBe(false);
    expect(isReservedPrefix('app')).toBe(true);
  });

  it('refuses the names the two old lists disagreed about', () => {
    /*
     * These were the live bug. `preview` and `localhost` were reserved by
     * middleware and NOT by the availability checker, so the checker reported
     * them available, the write succeeded, and the business ended up with a site
     * that could never be served — middleware would hand back the platform
     * instead. `blog` and `billing` were the reverse.
     */
    for (const name of ['preview', 'localhost', 'blog', 'billing', 'mail', 'auth', 'login']) {
      expect(isReservedPrefix(name)).toBe(true);
    }
  });

  it('refuses the path forms of its own namespace', () => {
    // `/site/{prefix}`, `/c/{code}` and `/go/{code}` are how addresses resolve
    // where there is no wildcard DNS.
    for (const name of ['site', 's', 'c', 'go']) {
      expect(isReservedPrefix(name)).toBe(true);
    }
  });

  it('refuses a prefix containing a dot', () => {
    /*
     * A dot turns one DNS label into two: `a.b` would become
     * `a.b.agentspilot.ai`, and it also defeats the prefix extraction in
     * middleware, which strips exactly one known suffix.
     */
    expect(validatePrefix('a.b')).toEqual({ ok: false, reason: 'invalid_characters' });
  });

  it('refuses what the old write path accepted', () => {
    // `z.string().min(3).max(30)` let all of these through to a HOSTNAME column.
    expect(validatePrefix('My Site').ok).toBe(false);
    expect(validatePrefix('joes_gym').ok).toBe(false);
    expect(validatePrefix('-joesgym').ok).toBe(false);
    expect(validatePrefix('joesgym-').ok).toBe(false);
  });

  it('accepts mixed case and stores it lowercased', () => {
    /*
     * NOT a rejection: a hostname is case-insensitive, so `JoesGym` is a
     * legitimate way to type a valid address. It is normalised on the way into
     * the database instead, because a Postgres comparison is case-SENSITIVE —
     * `JoesGym` and `joesgym` are one address to a browser and two rows to us.
     */
    expect(validatePrefix('JoesGym')).toEqual({ ok: true });
    expect(normalizePrefix('JoesGym')).toBe('joesgym');
  });

  it('reports which rule was broken, so the message can be specific', () => {
    expect(validatePrefix('ab')).toEqual({ ok: false, reason: 'too_short' });
    expect(validatePrefix('a'.repeat(31))).toEqual({ ok: false, reason: 'too_long' });
    expect(validatePrefix('app')).toEqual({ ok: false, reason: 'reserved' });
  });

  it('accepts an ordinary business name', () => {
    expect(validatePrefix('joesgym')).toEqual({ ok: true });
    expect(validatePrefix('joes-gym-2')).toEqual({ ok: true });
  });

  it('treats case as insignificant, because hostnames do', () => {
    expect(normalizePrefix('  JoesGym  ')).toBe('joesgym');
    // Reserved-ness must not be escapable by capitalising.
    expect(isReservedPrefix('APP')).toBe(true);
  });

  it('keeps every reserved name itself a valid label', () => {
    // A reserved entry that could never be typed anyway is dead weight, and one
    // with a dot or a space would mean the list was built carelessly.
    for (const name of RESERVED_PREFIXES) {
      expect(name).toBe(name.toLowerCase());
      expect(name).not.toMatch(/[^a-z0-9-]/);
    }
  });
});
