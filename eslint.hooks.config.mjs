// Rule-scoped ESLint config for the `lint:hooks` CI gate.
//
// It enables exactly ONE rule — `react-hooks/rules-of-hooks` — and nothing
// else. That narrowness is the point, and it is why the gate can be required
// immediately: the repository still carries 163 other ESLint errors and ~8.9k
// warnings, so a blanket `npm run lint` gate would be red on arrival and would
// be switched off within a week.
//
// Why a real rule instead of a regex guard: the defect class this protects
// against has three shapes, and only the rule catches all of them —
//   1. a plain function named `use*` that reads config (the seven feature-flag
//      readers this file was created alongside),
//   2. a `useEffect` placed after an early return (RefundModal),
//   3. a hook inside an `if` (ProcessFlowSection).
// A regex over lib/utils/featureFlags.ts would have caught only the first, in
// one file.
//
// ── History ────────────────────────────────────────────────────────────────
// These 14 violations were invisible until 2026-09-20, when PR #76 deleted a
// shadow `eslint.config.js` that ESLint 9 loaded in preference to
// `eslint.config.mjs` — so `npm run lint` had been checking almost nothing.
// Nothing stops that happening again, and `next.config.js` sets
// `eslint.ignoreDuringBuilds: true`, so `next build` will not notice either.
// Hence a dedicated gate rather than trusting the default config.
//
// Do NOT widen this file's rule set. Add new gates as their own scripts.

import reactHooks from 'eslint-plugin-react-hooks';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      // Syntax-only parse: no `project`, so this stays fast and needs no
      // tsconfig resolution. `rules-of-hooks` is a purely syntactic rule and
      // wants no type information.
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
    },
  },
];
