import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/integration/report-bench.int-spec.ts'],
    envDir: '.',
    setupFiles: ['./vitest.setup.ts'],
    fileParallelism: false,
    // Benchmark có thể chạy rất lâu (1 triệu đơn)
    testTimeout: 3_600_000,
    hookTimeout: 60_000,
  },
});
