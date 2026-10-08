/**
 * My Day greets you by the name you can actually change.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG
 *
 * Two places hold a person's name, and the header read the one nobody can edit.
 *
 *   Settings writes   `profiles.full_name`        (the form, with the avatar)
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

const route = codeOf(ROUTE);
const settings = codeOf(SETTINGS);

describe('the greeting and the profile form name the same place', () => {
  it('strips comments before matching, or it fails on its own explanation', () => {
    expect(read(ROUTE)).toContain('user_metadata.full_name');
    expect(route).not.toContain('user_metadata.full_name');
  });

  it('Settings writes the profile row', () => {
    expect(settings).toMatch(/from\('profiles'\)\.upsert\(\{/);
    expect(settings).toContain('full_name: next.full_name');
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

  it('dropped the router it existed for', () => {
    expect(settings).not.toContain('const router = useRouter()');
    expect(settings).not.toContain('useRouter');
  });
});
