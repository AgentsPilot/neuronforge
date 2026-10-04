// jest.gate.config.js: the PR gate (.github/workflows/tests.yml, `npm run test:gate`).
//
// Everything jest.config.js collects, minus two things:
//   - the committed quarantine in .github/ci/jest-quarantine.json (removals
//     only; .github/ci/jest-gate-check.mjs enforces that), and
//   - tests/plugins/integration-tests/, which needs live credentials (SA M-8).
//
// jest.config.js is spread, not copied, so testMatch, transform, setupFiles and
// its anchored '<rootDir>/.claude/' ignore patterns cannot drift from `npm test`.
// The partition check in jest-gate-check.mjs proves the result is exactly
// "full list minus quarantine minus integration", every run.
// CommonJS on purpose: Jest loads this file the same way as jest.config.js.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const base = require('./jest.config.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { suites } = require('./.github/ci/jest-quarantine.json');

// Paths become regexes, and Next.js route folders such as [token] are regex syntax.
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = {
  ...base,
  rootDir: __dirname,
  testPathIgnorePatterns: [
    ...base.testPathIgnorePatterns,
    '<rootDir>/tests/plugins/integration-tests/',
    ...suites.map((s) => `<rootDir>/${escapeRegex(s.path)}$`),
  ],
};
