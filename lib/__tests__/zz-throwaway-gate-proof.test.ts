// THROWAWAY — DO NOT MERGE. Proves `Gate tests (jest)` blocks a merge to main.
describe('throwaway gate proof', () => {
  it('fails on purpose', () => {
    expect(1).toBe(2);
  });
});
