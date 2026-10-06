/** Admin delete AD-2a (T1, parent plan C-9): canonical JSON. */
import { canonicalJson } from '../canonicalJson';

describe('canonicalJson', () => {
  it('is independent of key order, recursively', () => {
    expect(canonicalJson({ b: 1, a: { d: true, c: null } })).toBe(canonicalJson({ a: { c: null, d: true }, b: 1 }));
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('keeps array order (it is meaningful)', () => {
    expect(canonicalJson([2, 1])).toBe('[2,1]');
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
  });

  it('writes numbers and strings as JSON does (stable)', () => {
    expect(canonicalJson({ n: 1.5, i: 10, s: 'x"y' })).toBe('{"i":10,"n":1.5,"s":"x\\"y"}');
  });

  it('throws rather than silently dropping or nulling a value JSON cannot hold', () => {
    expect(() => canonicalJson({ a: undefined })).toThrow(TypeError);
    expect(() => canonicalJson({ a: NaN })).toThrow(TypeError);
    expect(() => canonicalJson({ a: () => 1 })).toThrow(TypeError);
    expect(() => canonicalJson({ a: new Date() })).toThrow(TypeError);
  });
});
