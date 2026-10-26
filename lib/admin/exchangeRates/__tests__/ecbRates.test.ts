/**
 * The ECB daily parser and the per-USD derivation (Admin Exchange Rates slice
 * 1e; SA §13.7 SA-1e-3, SQ-37). Every malformed variant is built here by a
 * string replacement on the one dated fixture, never as another file.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { parseEcbDaily, perUsdRates } from '../ecbRates';

// CRLF-normalised: a Windows checkout may hold the fixture with CRLF line ends.
const FIXTURE = readFileSync(join(__dirname, '..', '__fixtures__', 'ecb-eurofxref-daily-2026-10-23.xml'), 'utf8').replace(
  /\r\n/g,
  '\n'
);

/** Replace exactly one occurrence, so a test that edits nothing fails loudly. */
function edited(from: string | RegExp, to: string): string {
  const next = FIXTURE.replace(from, to);
  expect(next).not.toBe(FIXTURE);
  return next;
}

function parsed(text: string) {
  const result = parseEcbDaily(text);
  if (!result.ok) throw new Error(`expected a parse, got ${result.anchor}`);
  return result;
}

describe('the fixture', () => {
  it('parses: rate date 2026-10-23, the USD / GBP / ILS strings verbatim', () => {
    const result = parsed(FIXTURE);
    expect(result.rateDate).toBe('2026-10-23');
    expect(result.perEur.get('USD')).toBe('1.1193');
    expect(result.perEur.get('GBP')).toBe('0.83728');
    expect(result.perEur.get('ILS')).toBe('3.4939');
    expect(result.perEur.size).toBe(29);
    expect(result.perEur.has('EUR')).toBe(false);
  });

  it('parses with CRLF line ends too', () => {
    expect(parsed(FIXTURE.replace(/\n/g, '\r\n')).perEur.get('ILS')).toBe('3.4939');
  });

  it('double-quoted attributes parse', () => {
    const doubled = FIXTURE.replace(/'/g, '"');
    const result = parsed(doubled);
    expect(result.rateDate).toBe('2026-10-23');
    expect(result.perEur.get('GBP')).toBe('0.83728');
  });
});

describe('anchors: each fails with layout_changed and its own name', () => {
  it.each([
    ['E1 sender name missing', () => edited('<gesmes:name>European Central Bank</gesmes:name>', ''), 'E1'],
    ['E1 sender renamed', () => edited('European Central Bank', 'Some Other Bank'), 'E1'],
    ['E2 no Cube time', () => edited(/<Cube time='2026-10-23'>/, '<Cube>'), 'E2'],
    ['E2 two Cube times', () => edited(/<Cube time='2026-10-23'>/, "<Cube time='2026-10-23'><Cube time='2026-10-22'>"), 'E2'],
    ['E2 an unreal date', () => edited("time='2026-10-23'", "time='2026-02-30'"), 'E2'],
    ['E2 a malformed date', () => edited("time='2026-10-23'", "time='23/10/2026'"), 'E2'],
    [
      'E3 a swapped attribute order (a loud failure, not a silent drop)',
      () => edited("<Cube currency='GBP' rate='0.83728'/>", "<Cube rate='0.83728' currency='GBP'/>"),
      'E3',
    ],
    ['E3 a rate in another shape', () => edited("rate='0.83728'", "rate='0,83728'"), 'E3'],
    ['E3 a lower-case code', () => edited("currency='GBP'", "currency='gbp'"), 'E3'],
    ['E3 no rate lines at all', () => FIXTURE.replace(/<Cube currency=[^>]*>/g, ''), 'E3'],
    ['E3 an extra attribute on a line', () => edited("<Cube currency='GBP' rate='0.83728'/>", "<Cube currency='GBP' rate='0.83728' x='1'/>"), 'E3'],
    ['E4 a code twice', () => edited("<Cube currency='GBP' rate='0.83728'/>", "<Cube currency='GBP' rate='0.83728'/><Cube currency='GBP' rate='0.9'/>"), 'E4'],
    ['E5 no USD', () => edited(/\s*<Cube currency='USD' rate='1.1193'\/>/, ''), 'E5'],
    ['E5 USD at zero', () => edited("rate='1.1193'", "rate='0.0000'"), 'E5'],
  ])('%s', (_name, build, anchor) => {
    expect(parseEcbDaily(build())).toEqual({ ok: false, anchor });
  });

  it('an empty or unrelated body fails E1', () => {
    expect(parseEcbDaily('')).toEqual({ ok: false, anchor: 'E1' });
    expect(parseEcbDaily('<html><body>Maintenance</body></html>')).toEqual({ ok: false, anchor: 'E1' });
  });
});

describe('perUsdRates (SA-1e-3)', () => {
  const perEur = parsed(FIXTURE).perEur;

  it('the §5.7.2 values, in the order asked', () => {
    expect(perUsdRates(perEur, ['ILS', 'EUR', 'GBP'])).toEqual([
      { currencyCode: 'ILS', status: 'suggested', suggestedRate: '3.121505' },
      { currencyCode: 'EUR', status: 'suggested', suggestedRate: '0.893416' },
      { currencyCode: 'GBP', status: 'suggested', suggestedRate: '0.748039' },
    ]);
  });

  it('a code not in the feed → not_in_feed, never 1 (D-4)', () => {
    expect(perUsdRates(perEur, ['XYZ'])).toEqual([{ currencyCode: 'XYZ', status: 'not_in_feed', suggestedRate: null }]);
  });

  it('a zero GBP → that row is no_usable_rate, not a feed failure', () => {
    const zeroGbp = parsed(edited("rate='0.83728'", "rate='0.00000'")).perEur;
    expect(perUsdRates(zeroGbp, ['GBP', 'ILS'])).toEqual([
      { currencyCode: 'GBP', status: 'no_usable_rate', suggestedRate: null },
      { currencyCode: 'ILS', status: 'suggested', suggestedRate: '3.121505' },
    ]);
  });

  it('a result over RATE_MAX → no_usable_rate', () => {
    const tinyUsd = parsed(edited("rate='1.1193'", "rate='0.000001'")).perEur;
    expect(perUsdRates(tinyUsd, ['JPY'])).toEqual([{ currencyCode: 'JPY', status: 'no_usable_rate', suggestedRate: null }]);
  });

  it('a result that rounds to 0 → no_usable_rate', () => {
    const hugeUsd = parsed(edited("rate='1.1193'", "rate='999999.9'").replace("rate='0.83728'", "rate='0.1'")).perEur;
    expect(perUsdRates(hugeUsd, ['GBP'])).toEqual([{ currencyCode: 'GBP', status: 'no_usable_rate', suggestedRate: null }]);
  });

  it('USD is never requested: asking throws', () => {
    expect(() => perUsdRates(perEur, ['USD'])).toThrow(/never synced/);
  });

  it('a map without USD throws (the caller must have passed E5)', () => {
    expect(() => perUsdRates(new Map([['GBP', '0.8']]), ['GBP'])).toThrow();
  });
});

// ── QA F-1 (SA code review): the loose E3 count is linear and sees explicit-close lines ──

describe('E3 hardening (QA F-1)', () => {
  it('a 64 KB adversarial input (a run of unclosed <Cube currency=) is E3 in well under a second (under 250 ms)', () => {
    const head = "<gesmes:name>European Central Bank</gesmes:name><Cube time='2026-10-23'>";
    const unit = '<Cube currency=';
    const text = head + unit.repeat(Math.ceil((64 * 1024 - head.length) / unit.length));
    expect(text.length).toBeGreaterThanOrEqual(64 * 1024);
    const started = performance.now();
    const result = parseEcbDaily(text);
    const elapsedMs = performance.now() - started;
    // Reported so the timing is on record in the run log.
    process.stdout.write(`E3 adversarial 64 KB parse: ${elapsedMs.toFixed(1)} ms\n`);
    expect(result).toEqual({ ok: false, anchor: 'E3' });
    // 250 ms, not 1000: the old quadratic pattern took about 0.9 s on a dev machine (3.5 s in QA),
    // so 1000 ms would not reliably catch a regression; the linear one takes a few ms.
    expect(elapsedMs).toBeLessThan(250);
  });

  it('an explicit-close GBP line is E3, not ok (it would otherwise drop GBP silently)', () => {
    const text = edited("<Cube currency='GBP' rate='0.83728'/>", "<Cube currency='GBP' rate='0.83728'></Cube>");
    expect(parseEcbDaily(text)).toEqual({ ok: false, anchor: 'E3' });
  });

  it('the fixture still parses, with every currency', () => {
    const result = parsed(FIXTURE);
    expect(result.perEur.size).toBe(29);
    expect(result.perEur.get('GBP')).toBe('0.83728');
  });
});
