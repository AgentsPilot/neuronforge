/**
 * My Day greets you by the name you can actually change.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG
 *
 * Two places hold a person's name, and the header read the one nobody can edit.
 *
 *   Settings writes   `profiles.full_name`        (the form, through
 *                                                  `/api/business-os/account-profile`
 *                                                  and `saveSettingsCard`, D-2)
 *   My Day read       `user_metadata.full_name`   (auth, written once at sign-up
 *                                                  from whatever the provider
 *                                                  handed over)
 *
 * So an owner could change their name, watch it save, and be greeted by the old
 * one on the next screen, with nothing on either to explain why. Neither value
 * was wrong; they were answers to different questions.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PINS
 *
 * The PAIRING, which is the part that broke: the place Settings writes is the
 * place the greeting reads, and auth metadata stays underneath it for an
 * account whose onboarding never wrote a profile row — which
 * `UserProfileRepository.findById` documents as the expected handling of its
 * empty result.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const codeOf = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const ROUTE = 'app/api/business-os/my-day/route.ts';
const SETTINGS = 'app/business-os/settings/page.tsx';
const PROFILE_ROUTE = 'app/api/business-os/account-profile/route.ts';
const PROFILE_REPOSITORY = 'lib/repositories/UserProfileRepository.ts';

const route = codeOf(ROUTE);
const settings = codeOf(SETTINGS);
const profileRoute = codeOf(PROFILE_ROUTE);
const profileRepository = codeOf(PROFILE_REPOSITORY);

function between(source: string, start: string, end: string, file: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`Could not find ${start} .. ${end} in ${file}`);
  return source.slice(from, to);
}

describe('the greeting and the profile form name the same place', () => {
  it('strips comments before matching, or it fails on its own explanation', () => {
    expect(read(ROUTE)).toContain('user_metadata.full_name');
    expect(route).not.toContain('user_metadata.full_name');
  });

  it('Settings writes the profile row, through the account-profile route and its repository (D-2)', () => {
    // (a) On the Save's own slice: `loadData` GETs the same URL, so a
    // whole-file match would pass even if the Save stopped sending the name.
    const saveProfile = between(settings, 'const saveProfile', 'const providerNotice', SETTINGS);
    expect(saveProfile).toContain("fetch('/api/business-os/account-profile'");
    expect(saveProfile).toMatch(/method:\s*'PATCH'/);
    expect(saveProfile).toContain('full_name: next.full_name');

    // (b) The route writes for the session user only.
    expect(profileRoute).toContain('userProfileRepository.saveSettingsCard(user.id');

    // (c) On the method's own body: `findById` also names `profiles` and `full_name`.
    const saveSettingsCard = between(
      profileRepository,
      'async saveSettingsCard',
      'async listForAdmin',
      PROFILE_REPOSITORY
    );
    expect(saveSettingsCard).toContain(".from('profiles')");
    expect(saveSettingsCard).toContain('full_name');
  });

  it('My Day reads that row, through its repository', () => {
    // CLAUDE.md rule 1: `profiles` already has a repository, and it scopes by id.
    expect(route).toContain("from '@/lib/repositories/UserProfileRepository'");
    expect(route).toContain('userProfileRepository.findById(user.id)');
  });

  it('prefers the edited name over the one from sign-up', () => {
    const resolution = route.slice(route.indexOf('const editedName'), route.indexOf("'there';") + 8);
    expect(resolution).toContain('profileRowResult.data?.full_name');
    expect(resolution.indexOf('editedName')).toBeLessThan(resolution.indexOf('user_metadata'));
  });

  it('still falls back for an account with no profile row', () => {
    // Brand-new accounts, and anyone whose onboarding never wrote one.
    const resolution = route.slice(route.indexOf('const userName'), route.indexOf("'there';") + 8);
    expect(resolution).toContain('user.user_metadata?.full_name');
    expect(resolution).toContain("user.email?.split('@')[0]");
    expect(resolution).toContain("'there'");
  });

  it('greets with a first name, not a full one', () => {
    // This greets somebody; it does not address an envelope.
    const resolution = route.slice(route.indexOf('const editedName'), route.indexOf("'there';") + 8);
    expect(resolution).toContain("editedName?.split(' ')[0]");
  });
});

describe('the settings header', () => {
  it('has no back button', () => {
    // The platform's own navigation is always on screen, and this one pointed
    // at a fixed destination regardless of where the reader came from.
    expect(settings).not.toContain('ArrowLeft');
    expect(settings).not.toContain("router.push('/business-os')");
  });

  it('uses the router only to replace, never to push', () => {
    // The router came back for settings drawer S-1 (C-3): closing a link-opened
    // drawer takes `section` off the address with `replace`. A push would add a
    // Back entry that reopens the drawer, and would bring back a navigation this
    // header no longer has. The positive pin on the replace itself lives in
    // `app/business-os/settings/__tests__/settingsDeepLinks.guard.test.ts`, which
    // owns that behaviour (SA W-1 / O-1).
    expect(settings).not.toMatch(/router\.push\(/);
  });
});
