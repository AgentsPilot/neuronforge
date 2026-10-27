import { pickFemaleVoice } from '../voices';

/** A stand-in for the browser's voice objects. */
const v = (name: string, lang: string): SpeechSynthesisVoice =>
  ({ name, lang, default: false, localService: true, voiceURI: name }) as SpeechSynthesisVoice;

describe('pickFemaleVoice', () => {
  it('prefers the known female voice for each language', () => {
    const all = [v('Alex', 'en-US'), v('Samantha', 'en-US'), v('Daniel', 'en-GB')];
    expect(pickFemaleVoice(all, 'en')?.name).toBe('Samantha');

    expect(pickFemaleVoice([v('Jorge', 'es-ES'), v('Mónica', 'es-ES')], 'es')?.name).toBe(
      'Mónica'
    );

    expect(pickFemaleVoice([v('Carmit', 'he-IL')], 'he')?.name).toBe('Carmit');
  });

  it('matches a Windows voice by substring, not exact name', () => {
    const all = [v('Microsoft Zira Desktop - English (United States)', 'en-US')];
    expect(pickFemaleVoice(all, 'en')?.name).toContain('Zira');
  });

  it('honours the preference ORDER, not just membership', () => {
    /* Karen is on the list too, but Samantha outranks her. */
    const all = [v('Karen', 'en-AU'), v('Samantha', 'en-US')];
    expect(pickFemaleVoice(all, 'en')?.name).toBe('Samantha');
  });

  /*
   * The bug this file exists to prevent: macOS exposes its joke voices to the
   * browser as real en-US voices, so a naive "first for this language"
   * fallback reads setup instructions in a church organ.
   */
  it('never falls back to a macOS novelty voice', () => {
    const all = [v('Bubbles', 'en-US'), v('Boing', 'en-US'), v('Organ', 'en-US')];
    expect(pickFemaleVoice(all, 'en')).toBeNull();
  });

  it('picks a self-described female voice when no known name matches', () => {
    const all = [v('Some Vendor Male', 'en-US'), v('Some Vendor Female', 'en-US')];
    expect(pickFemaleVoice(all, 'en')?.name).toBe('Some Vendor Female');
  });

  /*
   * Windows ships no female Hebrew voice. A male Hebrew voice beats an
   * English female one mangling Hebrew, and beats silence.
   */
  it('falls back to a real voice for the language rather than none', () => {
    const all = [v('Microsoft Asaf', 'he-IL'), v('Samantha', 'en-US')];
    expect(pickFemaleVoice(all, 'he')?.name).toBe('Microsoft Asaf');
  });

  it('returns null when the language cannot be spoken at all', () => {
    expect(pickFemaleVoice([v('Samantha', 'en-US')], 'he')).toBeNull();
    expect(pickFemaleVoice([], 'en')).toBeNull();
  });
});
