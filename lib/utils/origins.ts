/**
 * Every web address this system hands out, decided here and nowhere else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THERE WERE FIVE DOMAINS IN THIS CODEBASE FOR WHAT SHOULD BE TWO.
 *
 *   `agentpilot.io`      middleware's fallback — what ACTUALLY served a site
 *   `agentspilot.com`    the landing-page API, the wizards, the website page
 *   `agentspilot.site`   the stats route
 *   `app.agentspilot.com` smart links and lead capture
 *   `agentspilot.ai`     the real one
 *
 * They disagreed because each was written at its own call site. The domain that
 * actually routed a business's website matched none of the three the interface
 * displayed, so every address shown to an owner was wrong unless one env var
 * happened to be set — and the preview and the published link were computed by
 * different code, so they could differ from each other too.
 *
 * The rule that replaces all of it: an address is never written at a call site.
 * It comes from here, or it is a bug.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * All three variables are inlined at build time alongside `NODE_ENV`, so by the
 * time any of this runs it is plain string work, on the server and in the
 * browser alike.
 */

/*
 * The platform: this application's own origin.
 *
 * `app.` in production, because a business's pages are its SIBLINGS on the same
 * apex — `joesgym.agentspilot.ai` beside `app.agentspilot.ai`. The prefix `app`
 * is reserved (see `lib/business-os/reservedPrefixes.ts`), which is the only
 * thing that keeps a business from claiming the platform's own hostname.
 */
const DEV_PLATFORM_ORIGIN = 'http://localhost:3000';
const PROD_PLATFORM_ORIGIN = 'https://app.agentspilot.ai';

/*
 * The marketing site: a separate application, on a separate origin, holding
 * `/login` and `/signup`. Neither is a route in this app; a relative `/login` is
 * always a bug.
 *
 * The fallback is the Vercel deployment rather than an apex, and that is
 * deliberate: no custom domain is served yet. It was `agentspilot.com`, whose
 * certificate has expired, and signing out therefore landed everyone on a
 * browser security interstitial. `agentspilot.ai` is not served either.
 */
const DEV_MARKETING_ORIGIN = 'http://localhost:3001';
const PROD_MARKETING_ORIGIN = 'https://agentspilot-marketing.vercel.app';

const isDevelopment = () => process.env.NODE_ENV === 'development';

const stripTrailingSlashes = (value: string) => value.replace(/\/+$/, '');

/** A path with exactly one leading slash, or empty. */
const normalizePath = (path: string) => {
  if (!path) return '';
  return path.startsWith('/') ? path : `/${path}`;
};

/** This application's own origin, with no trailing slash. */
export function platformOrigin(): string {
  const configured =
    process.env.NEXT_PUBLIC_APP_URL ||
    (isDevelopment() ? DEV_PLATFORM_ORIGIN : PROD_PLATFORM_ORIGIN);

  return stripTrailingSlashes(configured);
}

/** An absolute URL on this application. */
export function platformUrl(path = ''): string {
  return `${platformOrigin()}${normalizePath(path)}`;
}

/** The marketing site's origin, with no trailing slash. */
export function marketingOrigin(): string {
  const configured =
    process.env.NEXT_PUBLIC_MARKETING_URL ||
    (isDevelopment() ? DEV_MARKETING_ORIGIN : PROD_MARKETING_ORIGIN);

  return stripTrailingSlashes(configured);
}

/**
 * An absolute URL on the marketing site.
 *
 * Always navigate to the result with `window.location.href` (or a server
 * `redirect`) — `router.push` cannot cross an origin, and would silently resolve
 * the string as a path within this app.
 */
export function marketingUrl(path = ''): string {
  return `${marketingOrigin()}${normalizePath(path)}`;
}

/* ───────────────────────────────────────────── a business's public address ── */

/**
 * The apex a business's pages hang off, or null where there is none.
 *
 * Null is the NORMAL case outside production, and the reason this function
 * exists rather than a constant: `{prefix}.agentspilot.ai` needs wildcard DNS,
 * and neither `localhost` nor `*.vercel.app` has it. So there is no single
 * address shape that serves all three environments, and pretending otherwise is
 * what produced URLs that looked right and resolved nowhere.
 *
 * Set it to `lvh.me:3000` in development to exercise the real production shape
 * on a laptop: every subdomain of `lvh.me` resolves to 127.0.0.1, so
 * `joesgym.lvh.me:3000` reaches the dev server and goes through the same
 * middleware rewrite production will use. Without that, the subdomain path ships
 * having never once run.
 */
export function publicSiteHost(): string | null {
  const configured = process.env.NEXT_PUBLIC_PUBLIC_SITE_HOST?.trim();
  if (!configured) return null;

  return stripTrailingSlashes(configured).replace(/^https?:\/\//, '');
}

/**
 * `http` for the local testing hosts, `https` for everything else.
 *
 * `lvh.me:3000` has no certificate and never will, so a hardcoded `https://`
 * would make the one mechanism that proves the subdomain shape locally
 * unusable.
 */
const schemeForHost = (host: string) =>
  /^(localhost|127\.0\.0\.1|.*\.lvh\.me|lvh\.me|.*\.localtest\.me|localtest\.me)(:\d+)?$/.test(host)
    ? 'http'
    : 'https';

/**
 * The internal route that serves a business's pages, in both shapes.
 *
 * Middleware rewrites `{prefix}.{host}/book` to this; the path form is served as
 * this directly. One route, so the two shapes cannot drift into two behaviours.
 *
 * `/site/` rather than a shorter `/s/`: the tree already exists under that name
 * and the pages emit `/site/...` links to each other, so renaming it would churn
 * five files and every link between them to change a string the visitor never
 * sees in production — there the address is `joesgym.agentspilot.ai/book` and
 * this path is purely internal.
 */
export function publicSitePath(prefix: string, path = ''): string {
  return `/site/${prefix}${normalizePath(path)}`;
}

/**
 * The address a business gives its clients.
 *
 * ONE function, called by the preview, the copy-link button, the dashboard and
 * the published link alike — which is the whole point. Four separate
 * calculations are what let four domains coexist without anybody noticing.
 *
 *   production            https://joesgym.agentspilot.ai/book
 *   Vercel and localhost  https://…vercel.app/site/joesgym/book
 */
export function publicSiteUrl(prefix: string, path = ''): string {
  const host = publicSiteHost();
  if (!host) return platformUrl(publicSitePath(prefix, path));

  return `${schemeForHost(host)}://${prefix}.${host}${normalizePath(path)}`;
}

/**
 * The address without its scheme, for display.
 *
 * The interface shows `joesgym.agentspilot.ai` rather than the full URL in a
 * dozen places, and every one of them used to build that string itself.
 */
export function publicSiteDisplayHost(prefix: string): string {
  const host = publicSiteHost();
  if (!host) return `${platformOrigin().replace(/^https?:\/\//, '')}/site/${prefix}`;

  return `${prefix}.${host}`;
}

/**
 * What follows the name while someone is choosing their address.
 *
 * The address pickers render `[ yourname ].agentspilot.ai` as a field and a
 * fixed suffix, and every one of them used to hardcode that suffix — which is
 * how they came to show `.agentspilot.com` while the site was actually served
 * from `agentpilot.io`.
 *
 * Empty where there is no wildcard DNS, because there is no suffix to show: the
 * address is a path, and `publicSiteDisplayHost` renders the whole thing.
 */
export function publicSiteSuffix(): string {
  const host = publicSiteHost();
  return host ? `.${host}` : '';
}
