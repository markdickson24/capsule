module.exports = {
  preset: 'jest-expo/ios',
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  // .claude/worktrees holds full checkouts of this repo (each with its own
  // package.json named "capsule"), which otherwise trips jest-haste-map's
  // duplicate-module-name warning and can shadow real source files.
  modulePathIgnorePatterns: ['<rootDir>/.claude/worktrees/'],
  watchPathIgnorePatterns: ['<rootDir>/.claude/worktrees/'],
  // jest-expo/ios's default testMatch also picks up the bare node:assert
  // scripts in src/lib/*.test.ts (Tier 0), which have no `it`/`describe` and
  // would fail jest's "must contain at least one test" check. Scope Tier 1
  // to its own __tests__ folders so the two tiers stay independent.
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.@(ts|tsx)'],
  // The CapsuleDetailScreen suites mount the real screen, so their first test
  // pays for cold module transform + evaluation. That is ~2-3s on a laptop but
  // regularly crosses jest's default 5s on GitHub's ubuntu-latest runners
  // (same code passed at 17s/suite and failed at 26s/suite on different
  // runners). The tests assert behaviour, not speed, so give them headroom.
  testTimeout: 30000,
  // @expo/vector-icons is only installed under expo's own node_modules (not
  // hoisted to the project root — see CLAUDE.md/Tier 0 typecheck findings),
  // so plain node resolution can't find it from src/. Metro papers over this
  // with a custom resolver; jest needs the equivalent redirect.
  moduleNameMapper: {
    '^@expo/vector-icons$': '<rootDir>/node_modules/expo/node_modules/@expo/vector-icons',
    '^@expo/vector-icons/(.*)$': '<rootDir>/node_modules/expo/node_modules/@expo/vector-icons/$1',
  },
};
