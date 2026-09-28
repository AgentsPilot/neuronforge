/**
 * How does this account sign in?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A GOOGLE ACCOUNT HAS NO PASSWORD, AND THE SETTINGS PAGE OFFERED TO CHANGE IT.
 *
 * Someone who signed up with Google has never chosen a password here. The
 * Security section asked them for their "current password" anyway — a value
 * that does not exist — and, because nothing verified it, accepted whatever
 * they typed and called `updateUser({ password })`.
 *
 * That does NOT change their Google password. Supabase cannot reach Google's
 * credentials. What it actually does is mint a SECOND way into the account,
 * under a heading that promised to change the first one. The owner walks away
 * believing they rotated a credential and instead they created one they did
 * not know about and will not remember.
 *
 * So "does this account have a password at all" has to be answered before any
 * password UI is rendered.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READ `identities`, NOT `app_metadata.provider`.
 *
 * `app_metadata.provider` is the provider used for the MOST RECENT sign-in, so
 * it flips as someone moves between Google and a password, and answers a
 * different question than the one being asked here. `identities` is the full
 * set of credentials linked to the account, which is what "can they sign in
 * with a password" actually depends on.
 *
 * `app_metadata.providers` (plural) is the closer fallback for a session that
 * arrived without identities hydrated, so it is consulted second.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DEPENDENCY-FREE ON PURPOSE.
 *
 * Client components decide what to render from this, and a server route decides
 * whether to refuse. Importing anything server-side here would bundle it into
 * the browser — the mistake that took every public page down once already (see
 * lib/business-os/bookingStatus.ts). This file imports nothing.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The shape this module needs — not the full Supabase `User`, so it stays dependency-free. */
export interface IdentityBearer {
  identities?: Array<{ provider?: string | null }> | null;
  app_metadata?: {
    provider?: string | null;
    providers?: string[] | null;
  } | null;
}

/** Supabase's name for the email-and-password credential. */
const PASSWORD_PROVIDER = 'email';

/** Display names for the providers we offer. Anything else is title-cased. */
const PROVIDER_LABELS: Record<string, string> = {
  google: 'Google',
  github: 'GitHub',
  azure: 'Microsoft',
  apple: 'Apple',
};

/** Where someone manages the credential they actually sign in with. */
const PROVIDER_ACCOUNT_URLS: Record<string, string> = {
  google: 'https://myaccount.google.com/security',
  github: 'https://github.com/settings/security',
  azure: 'https://account.microsoft.com/security',
  apple: 'https://account.apple.com',
};

/**
 * Every credential linked to this account, de-duplicated.
 *
 * Prefers `identities` (the full set) and falls back to
 * `app_metadata.providers` for a session that arrived without them.
 */
export function signInProviders(user: IdentityBearer | null | undefined): string[] {
  if (!user) return [];

  const fromIdentities = (user.identities ?? [])
    .map(identity => identity?.provider)
    .filter((provider): provider is string => typeof provider === 'string' && provider.length > 0);

  if (fromIdentities.length > 0) return Array.from(new Set(fromIdentities));

  const fromMetadata = (user.app_metadata?.providers ?? [])
    .filter((provider): provider is string => typeof provider === 'string' && provider.length > 0);

  if (fromMetadata.length > 0) return Array.from(new Set(fromMetadata));

  // Last resort: the single most-recent-provider field.
  const single = user.app_metadata?.provider;
  return typeof single === 'string' && single.length > 0 ? [single] : [];
}

/** Whether this account can sign in with a password at all. */
export function hasPasswordSignIn(user: IdentityBearer | null | undefined): boolean {
  return signInProviders(user).includes(PASSWORD_PROVIDER);
}

/**
 * The providers this account uses INSTEAD of a password.
 *
 * Empty for an ordinary password account, and empty for one that has linked
 * both — there a password genuinely exists and can be changed.
 */
export function oauthOnlyProviders(user: IdentityBearer | null | undefined): string[] {
  if (hasPasswordSignIn(user)) return [];
  return signInProviders(user).filter(provider => provider !== PASSWORD_PROVIDER);
}

/**
 * Every OAuth provider on the account, whether or not a password also exists.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS SEPARATE FROM `oauthOnlyProviders`.
 *
 * An account can have both: signed up with a password in July, clicked
 * "Continue with Google" in November, and has signed in with Google ever since.
 * `oauthOnlyProviders` is empty for them, correctly — a password genuinely
 * exists and can genuinely be changed, so the form stays.
 *
 * But a bare "Change password" asking for a "current password" they have not
 * typed in months reads as a mistake, and hiding it would be worse: the
 * password is a live way into the business with no way left to rotate it. So the
 * Security section says both are there, and this is what tells it so.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function linkedOAuthProviders(user: IdentityBearer | null | undefined): string[] {
  return signInProviders(user).filter(provider => provider !== PASSWORD_PROVIDER);
}

/**
 * Whether the password form should be replaced with an explanation.
 *
 * True only when we can SEE an OAuth provider and no password. An account we
 * cannot read at all falls through to the password form, which fails safely:
 * the server verifies the current password and refuses.
 */
export function isOAuthOnlyAccount(user: IdentityBearer | null | undefined): boolean {
  return oauthOnlyProviders(user).length > 0;
}

/**
 * Whether a password AND an OAuth provider both exist.
 *
 * Only changes what the notice SAYS, not whether the form is shown — see
 * `usesOAuthSignIn`.
 */
export function hasBothSignInMethods(user: IdentityBearer | null | undefined): boolean {
  return hasPasswordSignIn(user) && linkedOAuthProviders(user).length > 0;
}

/**
 * Whether the password form should be replaced with an explanation.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ANY LINKED PROVIDER HIDES THE FORM, EVEN WHEN A PASSWORD EXISTS.
 *
 * This deliberately goes further than `isOAuthOnlyAccount`. An account that
 * signed up with a password and linked Google later still HAS that password, and
 * for a while this showed the form with a note saying so. Someone who signs in
 * with Google reads "Change password" as being about their Google password no
 * matter what the note says, and the form cannot change that one.
 *
 * The password is not stranded by hiding it: "forgot password" on the sign-in
 * page still resets it by email (`/reset-password`), which is the flow someone
 * who has been using Google for months would need anyway, since they will not
 * remember the current password the form demands.
 *
 * `isOAuthOnlyAccount` stays as it is and stays the server's test: the route
 * refuses only where there is genuinely no password to change, because refusing
 * a real password change would be wrong.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function usesOAuthSignIn(user: IdentityBearer | null | undefined): boolean {
  return linkedOAuthProviders(user).length > 0;
}

/** "Google", or a sensible rendering of whatever provider this is. */
export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
}

/** "Google" for one; "Google and Apple" for several; null for none. */
function joinProviderLabels(providers: string[]): string | null {
  const labels = providers.map(providerLabel);
  if (labels.length === 0) return null;
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/** The provider(s) used INSTEAD of a password, named for display. */
export function oauthProviderLabel(user: IdentityBearer | null | undefined): string | null {
  return joinProviderLabels(oauthOnlyProviders(user));
}

/** The provider(s) linked to the account, named for display, password or not. */
export function linkedOAuthLabel(user: IdentityBearer | null | undefined): string | null {
  return joinProviderLabels(linkedOAuthProviders(user));
}

/** The security page of the provider used instead of a password. */
export function providerAccountUrl(user: IdentityBearer | null | undefined): string | null {
  const [first] = oauthOnlyProviders(user);
  return first ? PROVIDER_ACCOUNT_URLS[first] ?? null : null;
}

/** The security page of a linked provider, password or not. */
export function linkedProviderAccountUrl(user: IdentityBearer | null | undefined): string | null {
  const [first] = linkedOAuthProviders(user);
  return first ? PROVIDER_ACCOUNT_URLS[first] ?? null : null;
}
