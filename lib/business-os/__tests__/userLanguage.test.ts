import { resolveUserLanguage, normalizeLanguage, DEFAULT_LANGUAGE } from '../userLanguage';

describe('[smoke] normalizeLanguage', () => {
  it('accepts the languages this product speaks', () => {
    expect(normalizeLanguage('en')).toBe('en');
    expect(normalizeLanguage('he')).toBe('he');
    expect(normalizeLanguage('es')).toBe('es');
  });

  it('tolerates casing and stray whitespace from the database', () => {
    expect(normalizeLanguage(' HE ')).toBe('he');
    expect(normalizeLanguage('En')).toBe('en');
  });

  it('treats anything it does not speak as absent', () => {
    // An unknown code reaching the LLM prompt would ask it to write in a
    // language nobody chose; reaching the template lookup it would miss every
    // key and land on English regardless.
    expect(normalizeLanguage('fr')).toBeNull();
    expect(normalizeLanguage('')).toBeNull();
    expect(normalizeLanguage('   ')).toBeNull();
    expect(normalizeLanguage(null)).toBeNull();
    expect(normalizeLanguage(undefined)).toBeNull();
  });
});

describe('[smoke] resolveUserLanguage', () => {
  it('uses the business profile, which only a real choice ever writes', () => {
    expect(resolveUserLanguage({ profileLanguage: 'he', preferredLanguage: null })).toEqual({
      language: 'he',
      source: 'business_profiles',
    });
  });

  it('prefers the profile over a preference row that disagrees', () => {
    // The bug this exists to prevent: saving a timezone CREATES the preference
    // row, leaving preferred_language on its 'en' default. That defaulted value
    // outranked a language the user had actually chosen, and a Hebrew business
    // generated English insights while its own profile said 'he'.
    expect(resolveUserLanguage({ profileLanguage: 'he', preferredLanguage: 'en' })).toEqual({
      language: 'he',
      source: 'business_profiles',
    });
  });

  it('falls back to the preference row when there is no profile language', () => {
    // Accounts with no business profile — the preference row is all there is.
    expect(resolveUserLanguage({ profileLanguage: null, preferredLanguage: 'es' })).toEqual({
      language: 'es',
      source: 'user_preferences',
    });
  });

  it('falls back past a profile value it cannot read', () => {
    expect(resolveUserLanguage({ profileLanguage: '  ', preferredLanguage: 'he' })).toEqual({
      language: 'he',
      source: 'user_preferences',
    });
    expect(resolveUserLanguage({ profileLanguage: 'fr', preferredLanguage: 'he' })).toEqual({
      language: 'he',
      source: 'user_preferences',
    });
  });

  it('says so when it is defaulting rather than answering', () => {
    // The source is logged at generation. "default" in the log is the signal
    // that nothing in the database knew, rather than that English was chosen.
    expect(resolveUserLanguage({})).toEqual({
      language: DEFAULT_LANGUAGE,
      source: 'default',
    });
    expect(resolveUserLanguage({ profileLanguage: null, preferredLanguage: null })).toEqual({
      language: 'en',
      source: 'default',
    });
  });

  it('agrees with either column when both say the same thing', () => {
    // The normal state once a user has picked a language: both writers run.
    const resolved = resolveUserLanguage({ profileLanguage: 'he', preferredLanguage: 'he' });
    expect(resolved.language).toBe('he');
  });
});
