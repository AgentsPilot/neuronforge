/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: [
    '**/__tests__/**/*.ts?(x)',
    '**/?(*.)+(spec|test).ts?(x)'
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    // Next resolves `server-only` internally, so it is not in node_modules and
    // Jest cannot find it. See __mocks__/server-only.js.
    '^server-only$': '<rootDir>/__mocks__/server-only.js',
  },
  collectCoverageFrom: [
    'lib/**/*.{ts,tsx}',
    'app/**/*.{ts,tsx}',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/__tests__/**',
  ],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/.next/',
    '/coverage/',
  ],
  // Ignore Next.js specific files
  testPathIgnorePatterns: [
    '/node_modules/',
    '/.next/',
  ],
  // Setup files — set Supabase env stubs before module loading (harmless if already set)
  setupFiles: ['<rootDir>/tests/plugins/jest-setup.ts'],
  setupFilesAfterEnv: [],
  // Transform files
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        // Automatic JSX runtime (React 17+) — matches Next.js 14 app config so
        // component/RTL tests don't require `import React` in scope. Backward
        // compatible with test files that still import React explicitly.
        jsx: 'react-jsx',
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
      }
    }]
  },
};

module.exports = config;