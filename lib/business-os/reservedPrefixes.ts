/**
 * The names a business may NOT take as its web address.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A business's public pages are served at `{prefix}.agentspilot.ai`, and the
 * platform itself is served at `app.agentspilot.ai`. They are siblings on one
 * domain, told apart by exactly one thing: whether the prefix is on this list.
 *
 * So this list is what stops a business from taking over the platform's own
 * hostname. It used to exist TWICE, and the two copies disagreed:
 *
 *   * `middleware.ts` had 10 entries and decided what actually gets served;
 *   * `app/api/website/subdomain/check/route.ts` had 33 and decided what the
 *     availability checker reported.
 *
 * `blog`, `mail`, `auth`, `login` and `billing` were reserved by the checker but
 * not by middleware; `preview` and `localhost` the other way round. The second
 * disagreement was the damaging one: the checker told a business `preview` was
 * available, the write succeeded, and their site was then permanently
 * unreachable — middleware treated `preview` as reserved and served the platform
 * instead. No error was raised anywhere, at any point.
 *
 * One list, imported by all three: middleware, the checker, and the write path.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * EDGE-SAFE ON PURPOSE. `middleware.ts` runs on the edge runtime, so this module
 * imports nothing — no logger, no Supabase, no Node built-ins. Keep it that way;
 * an import here is an import into every request the platform serves.
 */

/**
 * The union of the two lists that used to disagree, plus the two the move to
 * `{prefix}.agentspilot.ai` makes necessary.
 *
 * Erring toward reserving more: a name withheld from a business is a minor
 * annoyance at sign-up, while a name wrongly handed out is a hostname that
 * either shadows the platform or silently fails to serve — and it may already be
 * printed on something by the time anyone notices.
 */
export const RESERVED_PREFIXES: ReadonlySet<string> = new Set([
  // The platform and the marketing site themselves.
  'app',
  'www',
  'api',
  'admin',
  'dashboard',
  'auth',
  'login',
  'signup',
  'register',
  'account',

  /*
   * `site` and `c` are the PATH forms of this same namespace
   * (`/site/{prefix}`, `/c/{userCode}`), used wherever wildcard DNS is
   * unavailable — localhost and `*.vercel.app`. Reserving them keeps the two
   * shapes from ever describing different things. `s` and `go` likewise.
   */
  'site',
  'sites',
  's',
  'c',
  'go',

  // Environments. `localhost` and `preview` are the pair middleware reserved and
  // the checker did not, which is the bug documented above.
  'localhost',
  'preview',
  'staging',
  'dev',
  'test',
  'demo',

  // Infrastructure hostnames, reserved so they stay available to us.
  'cdn',
  'assets',
  'static',
  'media',
  'images',
  'mail',
  'email',

  // Things a visitor would reasonably read as coming from AgentPilot rather than
  // from the business whose page they are on.
  'help',
  'support',
  'docs',
  'blog',
  'status',
  'billing',
  'payment',
  'checkout',
  'cart',
  'shop',
  'store',
  'marketplace',
]);

/**
 * A valid DNS label, which is what a prefix becomes.
 *
 * Lowercase letters, digits and hyphens; no leading or trailing hyphen; 3-30
 * characters. **No dots** — the write path used to accept them, and a dot turns
 * one prefix into two labels (`a.b` becomes `a.b.agentspilot.ai`), which also
 * defeats middleware's `host.replace('.' + baseHost, '')`.
 */
export const PREFIX_PATTERN = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;

export type PrefixRejection = 'too_short' | 'too_long' | 'invalid_characters' | 'reserved';

/** Lowercased and trimmed. Hostnames are case-insensitive; our checks are not. */
export function normalizePrefix(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isReservedPrefix(raw: string): boolean {
  return RESERVED_PREFIXES.has(normalizePrefix(raw));
}

/**
 * Whether a business may take this prefix, and if not, which rule it broke.
 *
 * Returns the reason rather than a boolean so the availability checker can say
 * WHY — "this name is reserved" and "letters, numbers and hyphens only" are
 * different corrections, and a checker that says only "unavailable" sends people
 * guessing.
 */
export function validatePrefix(raw: string): { ok: true } | { ok: false; reason: PrefixRejection } {
  const prefix = normalizePrefix(raw);

  if (prefix.length < 3) return { ok: false, reason: 'too_short' };
  if (prefix.length > 30) return { ok: false, reason: 'too_long' };
  if (!PREFIX_PATTERN.test(prefix)) return { ok: false, reason: 'invalid_characters' };
  if (RESERVED_PREFIXES.has(prefix)) return { ok: false, reason: 'reserved' };

  return { ok: true };
}

/** What to tell the person choosing the name. */
export const PREFIX_REJECTION_MESSAGE: Record<PrefixRejection, string> = {
  too_short: 'Use at least 3 characters',
  too_long: 'Use at most 30 characters',
  invalid_characters: 'Use lowercase letters, numbers and hyphens only',
  reserved: 'This address is reserved',
};
