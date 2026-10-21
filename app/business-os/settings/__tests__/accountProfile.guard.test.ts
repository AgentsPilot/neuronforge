/**
 * The settings page reads and saves the profile card through the server, and a
 * name save never touches the timezone.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PINS (settings drawer D-2)
 *
 * The card (`full_name`, `avatar_url`, `job_title`) used to be read and upserted
 * from the browser (P-1, P-6), which broke CLAUDE.md rule 1. Now `loadData`
 * GETs `/api/business-os/account-profile` and the card's Save PATCHes it with
 * the name only.
 *
 * F-24: the card's Save used to call `persistTimezone(profile.timezone)`, which
 * stamps `timezone_confirmed_at`, so editing a name "answered" the publish
 * gate's timezone question with whatever was stored. `saveProfile` is now two
 * paths: the timezone row's `saveProfile({ timezone })` calls ONLY
 * `persistTimezone` and returns; the card's `saveProfile()` never calls it and
 * never sends a timezone.
 *
 * There is no render harness for this page, so these are source guards, each
 * with a negative control proving the matcher catches the shape it forbids.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const SETTINGS = 'app/business-os/settings/page.tsx';

const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const raw = fs.readFileSync(path.join(process.cwd(), SETTINGS), 'utf8');
const code = stripComments(raw);

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`Could not find ${start} .. ${end} in ${SETTINGS}`);
  return source.slice(from, to);
}

const loadData = between(code, 'const loadData', 'const persistTimezone');
const saveProfile = between(code, 'const saveProfile', 'const providerNotice');

const TIMEZONE_BRANCH = 'if (overrides?.timezone !== undefined) {';
const PROFILE_ROUTE_CALL = "fetch('/api/business-os/account-profile'";

/**
 * The timezone branch's body (between its braces) and the code after it (the
 * card path), found by brace matching. `null` when the branch is missing.
 */
function splitSave(body: string): { branch: string; card: string } | null {
  const start = body.indexOf(TIMEZONE_BRANCH);
  if (start < 0) return null;
  const open = start + TIMEZONE_BRANCH.length - 1;
  let depth = 0;
  for (let i = open; i < body.length; i += 1) {
    if (body[i] === '{') depth += 1;
    else if (body[i] === '}') {
      depth -= 1;
      if (depth === 0) return { branch: body.slice(open + 1, i), card: body.slice(i + 1) };
    }
  }
  return null;
}

/** The object literal passed to `JSON.stringify` in the account-profile fetch. */
function patchBodyOf(card: string): string | null {
  const call = card.indexOf(PROFILE_ROUTE_CALL);
  if (call < 0) return null;
  const match = /JSON\.stringify\((\{[^}]*\})\)/.exec(card.slice(call));
  return match ? match[1] : null;
}

/** Problems with a `loadData` body; empty when the card comes from the route. */
function loadProblems(body: string): string[] {
  const problems: string[] = [];
  if (!body.includes(PROFILE_ROUTE_CALL)) problems.push('does not read the account-profile route');
  if (/from\(\s*'profiles'\s*\)/.test(body)) problems.push("queries 'profiles' directly");
  if (body.includes('supabase.')) problems.push('uses the browser Supabase client');
  return problems;
}

/** Problems with a `saveProfile` body's table access; empty when there is none. */
function tableProblems(body: string): string[] {
  const problems: string[] = [];
  if (body.includes('supabase.')) problems.push('uses the browser Supabase client');
  if (body.includes('.from(')) problems.push('queries a table directly');
  return problems;
}

/** Problems with the card's PATCH body; empty when it is the name only. */
function patchBodyProblems(body: string): string[] {
  const split = splitSave(body);
  if (!split) return ['no timezone branch'];
  const literal = patchBodyOf(split.card);
  if (!literal) return ['the card path does not PATCH the account-profile route'];
  const problems: string[] = [];
  if (!literal.includes('full_name')) problems.push('does not send full_name');
  for (const key of ['avatar_url', 'job_title', 'timezone', 'role', 'user_id']) {
    if (literal.includes(key)) problems.push(`sends ${key}`);
  }
  if (/\bid\s*:/.test(literal)) problems.push('sends id');
  return problems;
}

/** F-24 problems with a `saveProfile` body; empty when the two paths are split. */
function f24Problems(body: string): string[] {
  const split = splitSave(body);
  if (!split) return ['no timezone branch'];
  const problems: string[] = [];
  const calls = body.split('persistTimezone(').length - 1;
  if (calls !== 1) problems.push(`calls persistTimezone ${calls} times, not once`);
  if (!split.branch.includes('persistTimezone(')) problems.push('the timezone branch does not call persistTimezone');
  if (!/return;\s*$/.test(split.branch)) problems.push("the timezone branch does not end with 'return;'");
  if (split.card.includes('persistTimezone(')) problems.push('the card path calls persistTimezone');
  if (split.card.includes('timezone')) problems.push('the card path mentions timezone');
  return problems;
}

const CARD_FAILURE_IF = 'if (!res.ok';

/** The body (between its braces) of the first block opened at or after `from`. */
function blockAt(source: string, from: number): { body: string; end: number } | null {
  const open = source.indexOf('{', from);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return { body: source.slice(open + 1, i), end: i + 1 };
    }
  }
  return null;
}

/**
 * QA EC-1: problems with the card path's failure branch; empty when a failed
 * save returns before the editor closes and before "Saved" is shown.
 */
function cardFailureProblems(body: string): string[] {
  const split = splitSave(body);
  if (!split) return ['no timezone branch'];
  const card = split.card;
  const at = card.indexOf(CARD_FAILURE_IF);
  if (at < 0) return ['the card path has no failure branch'];
  const block = blockAt(card, at);
  if (!block) return ['the failure branch has no block'];
  const problems: string[] = [];
  if (!block.body.includes('setErrorMessage(')) problems.push('the failure branch shows no error');
  if (!/return;\s*$/.test(block.body)) problems.push("the failure branch does not end with 'return;'");
  if (block.body.includes('setEditingProfile(')) problems.push('the failure branch closes the editor');
  if (block.body.includes("t('settings.profile.saved')")) problems.push('the failure branch shows Saved');
  const closes = card.indexOf('setEditingProfile(false)');
  const saved = card.indexOf("setSuccessMessage(t('settings.profile.saved'))");
  if (closes < 0) problems.push('the card path never closes the editor');
  else if (closes < block.end) problems.push('the editor closes before the failure check');
  if (saved < 0) problems.push('the card path never shows Saved');
  else if (saved < block.end) problems.push('Saved is shown before the failure check');
  return problems;
}

/**
 * QA EC-2 (SA ruling Q-7): problems with the trimmed-name write-back; empty
 * when, after a successful save, the page state takes the name the SERVER
 * returned (trimmed), not the one it sent.
 */
function writeBackProblems(body: string): string[] {
  const split = splitSave(body);
  if (!split) return ['no timezone branch'];
  const card = split.card;
  const failure = blockAt(card, Math.max(card.indexOf(CARD_FAILURE_IF), 0));
  const afterFailure = failure ? card.slice(failure.end) : card;
  const set = /setProfile\(\s*(\w+)\s*=>\s*\(\{\s*\.\.\.\1\s*,\s*full_name:\s*(\w+)\s*\}\)\s*\)/.exec(afterFailure);
  if (!set) return ['the card path does not write full_name back into page state after a successful save'];
  const variable = set[2];
  const source = new RegExp(`\\b${variable}\\b[^=;]*=\\s*payload\\.data\\?\\.full_name\\b`);
  const problems: string[] = [];
  if (!source.test(afterFailure)) problems.push(`${variable} is not the server's payload.data?.full_name`);
  const closes = afterFailure.indexOf('setEditingProfile(false)');
  if (closes >= 0 && set.index > closes) problems.push('the write-back happens after the editor closes');
  return problems;
}

/** Problems with the timezone branch re-writing the card; empty when it does not. */
function branchProblems(body: string): string[] {
  const split = splitSave(body);
  if (!split) return ['no timezone branch'];
  const problems: string[] = [];
  if (split.branch.includes('account-profile')) problems.push('the timezone branch calls the account-profile route');
  if (split.branch.includes('setEditingProfile')) problems.push('the timezone branch closes the editor');
  return problems;
}

describe('the settings profile card goes through the server (D-2)', () => {
  it('strips comments before matching, or it fails on its own explanation', () => {
    expect(raw).toContain('SA ruling Q-1 (b)');
    expect(code).not.toContain('SA ruling Q-1 (b)');
  });

  it('A-1: loadData reads the card from the account-profile route, not the table', () => {
    expect(loadProblems(loadData)).toEqual([]);
  });

  it('A-2: loadData keeps its two halves independent, and the D-1 timezone read', () => {
    expect(loadData).toContain('Promise.allSettled(');
    expect(loadData).toContain("fetch('/api/business-os/preferences'");
  });

  it('A-3: saveProfile has no table access', () => {
    expect(tableProblems(saveProfile)).toEqual([]);
  });

  it('A-4: the card PATCHes the name only (no avatar_url, job_title, timezone, role or id)', () => {
    expect(saveProfile).toMatch(/method:\s*'PATCH'/);
    expect(patchBodyProblems(saveProfile)).toEqual([]);
  });

  it('A-5: F-24, only the timezone branch calls persistTimezone, and it returns', () => {
    expect(f24Problems(saveProfile)).toEqual([]);
  });

  it('A-6: the timezone branch does not re-write the card or close the editor', () => {
    expect(branchProblems(saveProfile)).toEqual([]);
  });

  it("A-7: nothing on the page queries 'profiles'", () => {
    expect(code).not.toMatch(/from\(\s*'profiles'\s*\)/);
  });

  it('A-8: the timezone row still calls saveProfile({ timezone: tz.value })', () => {
    expect(code).toContain('saveProfile({ timezone: tz.value })');
  });

  it('A-9 (QA EC-1): a failed card save returns before the editor closes or "Saved" shows', () => {
    expect(cardFailureProblems(saveProfile)).toEqual([]);
  });

  it("A-10 (QA EC-2): a card save writes the server's trimmed full_name back into page state", () => {
    expect(writeBackProblems(saveProfile)).toEqual([]);
  });
});

describe('negative controls: the matchers catch the shapes they forbid', () => {
  it("N-1: the old browser select in loadData", () => {
    const old = loadData.replace(
      /\(async \(\): Promise<ProfileCardValues \| null> => \{[\s\S]*?\}\)\(\),/,
      "supabase.from('profiles').select('full_name, avatar_url, job_title').eq('id', user.id).single(),"
    );
    expect(old).not.toBe(loadData);
    expect(loadProblems(old)).toEqual(
      expect.arrayContaining(["queries 'profiles' directly", 'uses the browser Supabase client'])
    );
  });

  it('N-2: the old browser upsert in saveProfile', () => {
    const old = saveProfile.replace(
      'const res = await fetch(',
      "const { error: profileError } = await supabase.from('profiles').upsert({ id: user.id }, { onConflict: 'id' });\n      const res = await fetch("
    );
    expect(tableProblems(old)).toEqual(
      expect.arrayContaining(['uses the browser Supabase client', 'queries a table directly'])
    );
  });

  it('N-3: a card path that calls persistTimezone(next.timezone) after the PATCH (the F-24 shape)', () => {
    const old = saveProfile.replace(
      'setEditingProfile(false);',
      'if (next.timezone) { await persistTimezone(next.timezone); }\n      setEditingProfile(false);'
    );
    expect(old).not.toBe(saveProfile);
    expect(f24Problems(old)).toEqual(
      expect.arrayContaining(['the card path calls persistTimezone', 'calls persistTimezone 2 times, not once'])
    );
  });

  it('N-4: a PATCH body carrying avatar_url, or job_title', () => {
    const withAvatar = saveProfile.replace(
      'JSON.stringify({ full_name: next.full_name })',
      'JSON.stringify({ full_name: next.full_name, avatar_url: next.avatar_url })'
    );
    const withTitle = saveProfile.replace(
      'JSON.stringify({ full_name: next.full_name })',
      'JSON.stringify({ full_name: next.full_name, job_title: next.job_title })'
    );
    expect(withAvatar).not.toBe(saveProfile);
    expect(patchBodyProblems(withAvatar)).toEqual(['sends avatar_url']);
    expect(patchBodyProblems(withTitle)).toEqual(['sends job_title']);
  });

  it("N-5: a timezone branch without its final 'return;' (a pick falls through to the PATCH)", () => {
    const split = splitSave(saveProfile);
    expect(split).not.toBeNull();
    const branch = (split as { branch: string }).branch;
    const withoutReturn = saveProfile.replace(branch, branch.replace(/return;\s*$/, ''));
    expect(withoutReturn).not.toBe(saveProfile);
    expect(f24Problems(withoutReturn)).toContain("the timezone branch does not end with 'return;'");
  });

  it('N-6: a timezone branch that also PATCHes the card', () => {
    const old = saveProfile.replace(
      'const zone = overrides.timezone;',
      "const zone = overrides.timezone;\n      await fetch('/api/business-os/account-profile', { method: 'PATCH' });"
    );
    expect(old).not.toBe(saveProfile);
    expect(branchProblems(old)).toContain('the timezone branch calls the account-profile route');
  });

  it("N-7: a card failure branch without its 'return;' (QA mutation Q-22)", () => {
    const split = splitSave(saveProfile) as { card: string };
    const block = blockAt(split.card, split.card.indexOf(CARD_FAILURE_IF)) as { body: string };
    const withoutReturn = saveProfile.replace(block.body, block.body.replace(/return;\s*$/, ''));
    expect(withoutReturn).not.toBe(saveProfile);
    expect(cardFailureProblems(withoutReturn)).toContain("the failure branch does not end with 'return;'");
  });

  it('N-8: a failure branch that closes the editor, or a "Saved" shown before the check', () => {
    const split = splitSave(saveProfile) as { card: string };
    const block = blockAt(split.card, split.card.indexOf(CARD_FAILURE_IF)) as { body: string };
    const closes = saveProfile.replace(
      block.body,
      block.body.replace(/return;\s*$/, 'setEditingProfile(false);\n        return;\n      ')
    );
    const early = saveProfile.replace(
      'const payload = await res.json()',
      "setSuccessMessage(t('settings.profile.saved'));\n      const payload = await res.json()"
    );
    expect(closes).not.toBe(saveProfile);
    expect(early).not.toBe(saveProfile);
    expect(cardFailureProblems(closes)).toContain('the failure branch closes the editor');
    expect(cardFailureProblems(early)).toContain('Saved is shown before the failure check');
  });

  it('N-9: no write-back (QA mutation Q-21), or a write-back of the name the page sent', () => {
    const removed = saveProfile.replace(
      'setProfile(p => ({ ...p, full_name: storedName }));',
      'void storedName;'
    );
    const sentName = saveProfile.replace(
      'const storedName: unknown = payload.data?.full_name;',
      'const storedName: unknown = next.full_name;'
    );
    expect(removed).not.toBe(saveProfile);
    expect(sentName).not.toBe(saveProfile);
    expect(writeBackProblems(removed)).toEqual([
      'the card path does not write full_name back into page state after a successful save',
    ]);
    expect(writeBackProblems(sentName)).toEqual(["storedName is not the server's payload.data?.full_name"]);
  });
});
