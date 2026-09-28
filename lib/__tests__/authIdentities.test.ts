/**
 * What decides whether someone is shown a password form at all.
 *
 * The bug being guarded: a Google account was offered "Change password", asked
 * for a current password it never had, and — since nothing verified it — had a
 * second credential minted under a heading that promised to change the first.
 */

import {
  signInProviders,
  hasPasswordSignIn,
  oauthOnlyProviders,
  isOAuthOnlyAccount,
  usesOAuthSignIn,
  hasBothSignInMethods,
  linkedOAuthProviders,
  oauthProviderLabel,
  linkedOAuthLabel,
  providerAccountUrl,
  linkedProviderAccountUrl,
  providerLabel,
} from '@/lib/authIdentities';

const googleUser = { identities: [{ provider: 'google' }] };
const passwordUser = { identities: [{ provider: 'email' }] };
const linkedUser = { identities: [{ provider: 'google' }, { provider: 'email' }] };

describe('authIdentities', () => {
  describe('the account that started all this', () => {
    it('treats a Google-only account as having no password', () => {
      expect(hasPasswordSignIn(googleUser)).toBe(false);
      expect(isOAuthOnlyAccount(googleUser)).toBe(true);
      expect(oauthProviderLabel(googleUser)).toBe('Google');
      expect(providerAccountUrl(googleUser)).toBe('https://myaccount.google.com/security');
    });

    it('leaves an ordinary password account alone', () => {
      expect(hasPasswordSignIn(passwordUser)).toBe(true);
      expect(isOAuthOnlyAccount(passwordUser)).toBe(false);
      expect(oauthProviderLabel(passwordUser)).toBeNull();
      expect(providerAccountUrl(passwordUser)).toBeNull();
    });

    it('shows the password form when BOTH are linked — there is a real password to change', () => {
      expect(hasPasswordSignIn(linkedUser)).toBe(true);
      expect(isOAuthOnlyAccount(linkedUser)).toBe(false);
      expect(oauthOnlyProviders(linkedUser)).toEqual([]);
    });
  });

  describe('an account with both a password and a provider', () => {
    // Signed up with a password, linked Google later, has used Google ever since.
    it('is named and pointed at the provider even though a password exists', () => {
      expect(hasBothSignInMethods(linkedUser)).toBe(true);
      expect(linkedOAuthProviders(linkedUser)).toEqual(['google']);
      expect(linkedOAuthLabel(linkedUser)).toBe('Google');
      expect(linkedProviderAccountUrl(linkedUser)).toBe('https://myaccount.google.com/security');
    });

    it('is still not the OAuth-ONLY state, which is what the server refuses on', () => {
      // The route must go on allowing a real password change; only the UI hides.
      expect(isOAuthOnlyAccount(linkedUser)).toBe(false);
      expect(oauthProviderLabel(linkedUser)).toBeNull();
      expect(providerAccountUrl(linkedUser)).toBeNull();
    });

    it('is false for the two single-method accounts', () => {
      expect(hasBothSignInMethods(googleUser)).toBe(false);
      expect(hasBothSignInMethods(passwordUser)).toBe(false);
      expect(linkedOAuthLabel(passwordUser)).toBeNull();
    });

    it('reads the same way from app_metadata.providers when identities are missing', () => {
      // What the real account looks like: created with a password in July, Google
      // linked in November, `identities` not hydrated onto the client session.
      const user = { app_metadata: { provider: 'email', providers: ['email', 'google'] } };
      expect(hasBothSignInMethods(user)).toBe(true);
      expect(isOAuthOnlyAccount(user)).toBe(false);
      expect(linkedOAuthLabel(user)).toBe('Google');
    });
  });

  describe('usesOAuthSignIn — the gate that hides the password form', () => {
    it('hides the form for a provider account with no password', () => {
      expect(usesOAuthSignIn(googleUser)).toBe(true);
    });

    it('hides the form for a provider account that ALSO has a password', () => {
      // The form could not change the credential they sign in with, and someone
      // who has used Google for months will not know the password it demands.
      // "Forgot password" still reaches that password.
      expect(usesOAuthSignIn(linkedUser)).toBe(true);
      expect(usesOAuthSignIn({ app_metadata: { providers: ['email', 'google'] } })).toBe(true);
    });

    it('leaves the form in place for a password-only account', () => {
      expect(usesOAuthSignIn(passwordUser)).toBe(false);
    });

    it.each([
      ['null', null],
      ['undefined', undefined],
      ['an empty object', {}],
      ['empty identities', { identities: [] }],
    ])('shows the form for %s, failing safe to the server check', (_label, user) => {
      expect(usesOAuthSignIn(user as never)).toBe(false);
    });
  });

  describe('reading the provider', () => {
    it('prefers identities over app_metadata.provider, which is only the LAST sign-in', () => {
      // Signed in with a password most recently, but the account is Google-only.
      const user = {
        identities: [{ provider: 'google' }],
        app_metadata: { provider: 'email', providers: ['email'] },
      };
      expect(signInProviders(user)).toEqual(['google']);
      expect(isOAuthOnlyAccount(user)).toBe(true);
    });

    it('falls back to app_metadata.providers when identities are not hydrated', () => {
      const user = { app_metadata: { provider: 'google', providers: ['google'] } };
      expect(signInProviders(user)).toEqual(['google']);
      expect(isOAuthOnlyAccount(user)).toBe(true);
    });

    it('falls back to the single provider field as a last resort', () => {
      expect(signInProviders({ app_metadata: { provider: 'google' } })).toEqual(['google']);
    });

    it('de-duplicates repeated providers', () => {
      const user = { identities: [{ provider: 'google' }, { provider: 'google' }] };
      expect(signInProviders(user)).toEqual(['google']);
    });

    it('ignores empty and missing provider values', () => {
      const user = { identities: [{ provider: '' }, { provider: null }, { provider: 'google' }] };
      expect(signInProviders(user)).toEqual(['google']);
    });
  });

  describe('an account we cannot read falls through to the password form', () => {
    // Failing safe: the server verifies the current password and refuses, which
    // is better than hiding the form from someone who does have a password.
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['an empty object', {}],
      ['empty identities', { identities: [] }],
      ['null identities', { identities: null }],
    ])('%s is not treated as an OAuth account', (_label, user) => {
      expect(isOAuthOnlyAccount(user as never)).toBe(false);
      expect(signInProviders(user as never)).toEqual([]);
      expect(oauthProviderLabel(user as never)).toBeNull();
    });
  });

  describe('labels', () => {
    it('names the providers we offer', () => {
      expect(providerLabel('google')).toBe('Google');
      expect(providerLabel('github')).toBe('GitHub');
      expect(providerLabel('azure')).toBe('Microsoft');
    });

    it('title-cases anything unknown rather than showing a raw key', () => {
      expect(providerLabel('okta')).toBe('Okta');
    });

    it('joins several linked providers readably', () => {
      const user = { identities: [{ provider: 'google' }, { provider: 'apple' }] };
      expect(oauthProviderLabel(user)).toBe('Google and Apple');
    });

    it('returns no account URL for a provider we do not know', () => {
      expect(providerAccountUrl({ identities: [{ provider: 'okta' }] })).toBeNull();
    });
  });
});
