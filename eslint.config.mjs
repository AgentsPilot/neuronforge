import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

// This is the ONLY ESLint config. A second file, eslint.config.js, used to sit
// beside it holding eslintrc-style `{ extends: [...] }` under a flat-config
// filename. ESLint 9 loads eslint.config.js first, so `npm run lint` silently
// checked almost nothing: one file reported 1 warning here and 88 problems
// under this config. It was deleted on 2026-09-20 — do not reintroduce it.
const eslintConfig = [
  {
    // `next lint` used to supply these. It no longer runs at all on Next 14 —
    // it ignores this flat config and drops into the interactive setup wizard —
    // so `npm run lint` now invokes `eslint` directly and has to bring its own
    // ignores. Flat config's defaults are only `**/node_modules/` and `.git/`,
    // so without this the lint walks build output and the agent worktrees under
    // `.claude/`, which is minutes of work over files nobody wrote.
    //
    // `jest.config.js` ignores `.claude/` for exactly the same reason.
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "dist/**",
      "coverage/**",
      "public/**",
      ".vercel/**",
      ".claude/**",
      "next-env.d.ts",
      "**/*.min.js",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Pre-existing backlog, kept visible as warnings so that a real error in
      // `npm run lint` means something. Counts across app/ lib/ components/ on
      // 2026-09-20: no-explicit-any 6871, no-unused-vars 1606,
      // no-unescaped-entities 248 — together ~97% of all findings.
      //
      // These are NOT waivers. CLAUDE.md mandatory rule 6 still stands: no
      // implicit `any` in new code, and an unavoidable one needs a comment
      // saying why. Burning the backlog down is tracked separately; whenever a
      // rule's count reaches zero, take it out of this block so it errors again.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
      "react/no-unescaped-entities": "warn",
    },
  },
];

export default eslintConfig;
