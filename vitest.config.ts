import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.mjs'],
    globals: true,
    server: {
      deps: {
        inline: [/\/scripts\/.*\.mjs/],
      },
    },
    coverage: {
      provider: 'v8',
      include: ['functions/**/*.ts', 'scripts/**/*.mjs'],
    },
  },
});
