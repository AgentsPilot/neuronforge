/**
 * Where the marketing site lives.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `/login` AND `/signup` ARE NOT ROUTES IN THIS APP.
 *
 * They belong to the marketing site, which is a separate Next application on a
 * separate origin — `localhost:3001` beside this app's 3000 in development, the
 * apex domain in production while this app sits on `app.`. Sixteen places used
 * to navigate to a bare `/login` and every one of them was a live 404: signing
 * out, an expired session on a protected page, a failed session handoff, the
 * OAuth error paths.
 *
 * Anything that sends someone to sign in or sign up goes through this module.
 * A relative `/login` is always a bug.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `NEXT_PUBLIC_MARKETING_URL` overrides the guess, which is what preview
 * deployments need — neither `localhost:3001` nor the apex is right there. It
 * is inlined at build time along with `NODE_ENV`, so this is plain string work
 * by the time it runs, on the server and in the browser alike.
 *
 * THE FALLBACK IS THE VERCEL DEPLOYMENT, NOT AN APEX DOMAIN, AND THAT IS
 * DELIBERATE: no custom domain is served yet. This used to be
 * `agentspilot.com` — chosen because the rest of this codebase spells the apex
 * that way for subdomains, smart links and the website builder — and signing
 * out landed everyone on a browser interstitial, because that domain has an
 * expired certificate (`ERR_CERT_DATE_INVALID`). `agentspilot.ai`, which the
 * marketing repo's own docs use throughout, is not served either.
 *
 * So the fallback points at the marketing app where it is actually reachable
 * today. When a custom domain is finally configured, set
 * `NEXT_PUBLIC_MARKETING_URL` on the deployment rather than editing this —
 * that is what the override is for, and it needs no code change.
 */
const DEV_MARKETING_URL = 'http://localhost:3001';
const PROD_MARKETING_URL = 'https://agentspilot-marketing.vercel.app';

/** The marketing site's origin, with no trailing slash. */
export function marketingOrigin(): string {
  const configured =
    process.env.NEXT_PUBLIC_MARKETING_URL ||
    (process.env.NODE_ENV === 'development' ? DEV_MARKETING_URL : PROD_MARKETING_URL);

  return configured.replace(/\/+$/, '');
}

/**
 * An absolute URL on the marketing site.
 *
 * Always navigate to the result with `window.location.href` (or a server
 * `redirect`) — `router.push` cannot cross an origin, and would silently
 * resolve the string as a path within this app.
 */
export function marketingUrl(path = ''): string {
  const origin = marketingOrigin();
  if (!path) return origin;

  return `${origin}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * The sign-in page, on the marketing site.
 *
 * `search` carries a reason across the origin boundary — `?error=no_session`,
 * for instance — and is passed through verbatim, leading `?` included.
 */
export function marketingLoginUrl(search = ''): string {
  return marketingUrl(`/login${search}`);
}

/** The sign-up page, on the marketing site. `search` as above. */
export function marketingSignupUrl(search = ''): string {
  return marketingUrl(`/signup${search}`);
}
