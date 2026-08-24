import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.mjs'],
    globals: false,
    // 强制 scripts/*.mjs 走 esbuild 转换而非 Node 原生 ESM 加载，
    // 规避部分 Node 版本下 vitest 对 .mjs 的 SSR transform 兼容问题
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
