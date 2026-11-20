import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    // Bao gồm tất cả *.int-spec.ts nhưng loại trừ file bench
    // (bench cần seed riêng 1 triệu đơn, chỉ chạy qua npm run test:bench)
    include: ['**/*.int-spec.ts'],
    exclude: ['**/node_modules/**', '**/.git/**', '**/report-bench.int-spec.ts'],
    envDir: '.',
    setupFiles: ['./vitest.setup.ts'],
    // Chạy tuần tự từng file để tránh nhiều Pool song song → "too many clients"
    fileParallelism: false,
    // Timeout cao hơn cho integration test thực sự truy vấn DB
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
