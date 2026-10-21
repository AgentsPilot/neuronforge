/**
 * The settings page saves and reads the business timezone through the server.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PINS (settings drawer D-1)
 *
 * The timezone used to be written from the browser: an upsert of
 * `user_preferences` that also carried the screen's current UI language into
 * `preferred_language`, a `profiles` mirror update, and a read-back, plus a
 * browser read on load. That broke CLAUDE.md rule 1, and the language rider
 * could overwrite a stored language with whatever the screen happened to show.
 *
 * Now `persistTimezone` sends exactly `{ timezone: zone }` to
 * `PATCH /api/business-os/preferences`, which writes, mirrors and reads back on
 * the server, and `loadData` reads the zone from `GET` on the same route. This
 * guard fails if either path goes back to the browser client, or if the save
 * starts sending a language again.
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

const persistTimezone = between(code, 'const persistTimezone', 'const saveProfile');
const loadData = between(code, 'const loadData', 'const persistTimezone');

/** Problems with a `persistTimezone` body; empty when it is the server path. */
function persistProblems(body: string): string[] {
  const problems: string[] = [];
  if (body.includes('supabase.')) problems.push('uses the browser Supabase client');
  if (body.includes('.from(')) problems.push('queries a table directly');
  if (!body.includes("fetch('/api/business-os/preferences'")) problems.push('does not call the preferences route');
  if (!/method:\s*'PATCH'/.test(body)) problems.push('is not a PATCH');
  if (!body.includes('JSON.stringify({ timezone: zone })')) problems.push('does not send exactly { timezone: zone }');
  if (/preferred_language/.test(body)) problems.push('sends preferred_language');
  if (/\blanguage\b/.test(body)) problems.push('sends a language');
  return problems;
}

/** Problems with a `loadData` body; empty when the timezone comes from the route. */
function loadProblems(body: string): string[] {
  const problems: string[] = [];
  if (body.includes('user_preferences')) problems.push('reads user_preferences from the browser');
  if (!body.includes("fetch('/api/business-os/preferences'")) problems.push('does not read the preferences route');
  return problems;
}

/**
 * Problems with how a `loadData` body treats a stored timezone that is missing
 * or null; empty when it falls back to `''` (the placeholder). NULL means "not
 * asked" and `'UTC'` means "chose UTC" (CLAUDE.md, Currency & Timezone): if the
 * page turned a NULL into `'UTC'`, the picker would show a choice nobody made.
 */
function nullFallbackProblems(body: string): string[] {
  const problems: string[] = [];
  if (/['"`]UTC['"`]/.test(body)) problems.push("contains a 'UTC' literal");
  if (!/typeof locale\.timezone === 'string' \? locale\.timezone : '';/.test(body)) {
    problems.push("does not fall back to '' for a non-string timezone");
  }
  if (!/if \(!locale\) \{[\s\S]*?return '';\s*\}/.test(body)) {
    problems.push("does not return '' when the locale half is missing");
  }
  if (!/timezoneSettled\.status === 'fulfilled' \? timezoneSettled\.value : '';/.test(body)) {
    problems.push("does not fall back to '' when the timezone read rejects");
  }
  return problems;
}

describe('the settings page timezone path goes through the server (D-1)', () => {
  it('strips comments before matching, or it fails on its own explanation', () => {
    expect(raw).toContain('Since settings drawer D-1');
    expect(code).not.toContain('Since settings drawer D-1');
  });

  it('persistTimezone keeps its signature and "zone or null" contract', () => {
    expect(code).toContain('const persistTimezone = async (zone: string): Promise<string | null> =>');
    expect(persistTimezone).toContain('return zone;');
    expect(persistTimezone).toContain('return null;');
  });

  it('persistTimezone sends exactly { timezone } to PATCH /api/business-os/preferences, no language', () => {
    expect(persistProblems(persistTimezone)).toEqual([]);
  });

  it('persistTimezone succeeds only on the server confirming the same zone', () => {
    expect(persistTimezone).toMatch(/payload\?\.success === true && payload\?\.data\?\.timezone === zone/);
  });

  it('loadData reads the stored timezone from the preferences route, not the table', () => {
    expect(loadProblems(loadData)).toEqual([]);
  });

  it("loadData maps a missing or null stored timezone to '', never to 'UTC' (QA EC-2)", () => {
    expect(nullFallbackProblems(loadData)).toEqual([]);
  });

  it('loadData keeps its two halves independent', () => {
    expect(loadData).toContain('Promise.allSettled(');
  });

  it('nothing on the page queries user_preferences', () => {
    expect(code).not.toMatch(/from\(\s*'user_preferences'\s*\)/);
  });
});

describe('negative controls: the matchers catch what they exist to catch', () => {
  it('flags the old browser upsert body', () => {
    const old = `const persistTimezone = async (zone: string): Promise<string | null> => {
      const { error } = await supabase.from('user_preferences').upsert({
        user_id: user.id, timezone: zone, preferred_language: language,
      }, { onConflict: 'user_id' });
      return zone;
    };`;
    expect(persistProblems(old)).toEqual(
      expect.arrayContaining(['uses the browser Supabase client', 'queries a table directly', 'sends preferred_language'])
    );
  });

  it('flags a server call that also sends a language', () => {
    const withLanguage = `const persistTimezone = async (zone: string): Promise<string | null> => {
      const res = await fetch('/api/business-os/preferences', {
        method: 'PATCH',
        body: JSON.stringify({ timezone: zone, language }),
      });
      return zone;
    };`;
    expect(persistProblems(withLanguage)).toEqual(
      expect.arrayContaining(['does not send exactly { timezone: zone }', 'sends a language'])
    );
  });

  it('flags a browser read of user_preferences on load', () => {
    const old = `const loadData = async () => {
      await Promise.all([
        supabase.from('user_preferences').select('timezone').eq('user_id', user.id).maybeSingle(),
      ]);
    };`;
    expect(loadProblems(old)).toEqual(
      expect.arrayContaining(['reads user_preferences from the browser', 'does not read the preferences route'])
    );
  });

  it("flags a loadData that turns a null stored timezone into 'UTC'", () => {
    const utcFallback = `const loadData = async () => {
      const [profileSettled, timezoneSettled] = await Promise.allSettled([
        (async (): Promise<string> => {
          if (!locale) {
            return '';
          }
          return typeof locale.timezone === 'string' ? locale.timezone : 'UTC';
        })(),
      ]);
      const storedTimezone = timezoneSettled.status === 'fulfilled' ? timezoneSettled.value : '';
    };`;
    expect(nullFallbackProblems(utcFallback)).toEqual(
      expect.arrayContaining(["contains a 'UTC' literal", "does not fall back to '' for a non-string timezone"])
    );
  });

  it("flags a loadData that defaults the whole timezone half to 'UTC'", () => {
    const utcDefault = `const loadData = async () => {
      if (!locale) {
        return "UTC";
      }
      return typeof locale.timezone === 'string' ? locale.timezone : '';
      const storedTimezone = timezoneSettled.status === 'fulfilled' ? timezoneSettled.value : \`UTC\`;
    };`;
    expect(nullFallbackProblems(utcDefault)).toEqual(
      expect.arrayContaining([
        "contains a 'UTC' literal",
        "does not return '' when the locale half is missing",
        "does not fall back to '' when the timezone read rejects",
      ])
    );
  });
});
