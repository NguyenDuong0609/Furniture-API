// test/integration/report-bench.int-spec.ts
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { writeCsv } from '../../src/reports/export/csv-writer.js';
import { FiltersSchema } from '../../src/reports/report-types.js';
import { ReportsService } from '../../src/reports/reports.service.js';
import { createPrisma } from './helpers/db.js';

// Thư mục xuất file — tạo nếu chưa có
const EXPORT_DIR = './exports/bench';

describe.skipIf(!process.env.BENCH)('export 1 triệu đơn', () => {
    it('ghi CSV ra file thật, bộ nhớ không tăng theo số dòng', async () => {
        if (!existsSync(EXPORT_DIR)) mkdirSync(EXPORT_DIR, { recursive: true });

        const prisma = createPrisma();
        const svc = new ReportsService(prisma as any);
        const def = svc.get('order-lines');
        const f = FiltersSchema.parse({ from: '2000-01-01', to: '2100-01-01', basis: 'PAID' });

        const outPath = `${EXPORT_DIR}/order-lines-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
        const fileStream = createWriteStream(outPath);

        let peak = 0;
        const timer = setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 200);
        const t0 = Date.now();

        const rows = await writeCsv(fileStream, def.columns, svc.iterate(def, f, true), {
            delimiter: ',',
            headers: 'label',
        });

        clearInterval(timer);
        const s = (Date.now() - t0) / 1000;

        // Đợi file flush xong
        await new Promise<void>((res, rej) => fileStream.end((err: Error | null | undefined) => err ? rej(err) : res()));

        const { size } = (await import('node:fs')).statSync(outPath);
        console.log([
            `✅ File: ${outPath}`,
            `   Số dòng  : ${rows.toLocaleString('vi-VN')}`,
            `   Kích thước: ${(size / 1e6).toFixed(0)} MB`,
            `   Thời gian : ${s.toFixed(0)}s`,
            `   Tốc độ   : ${(rows / s).toFixed(0)} dòng/s`,
            `   RSS đỉnh : ${(peak / 1e6).toFixed(0)} MB`,
        ].join('\n'));

        // Kiểm tra cơ bản
        expect(rows).toBeGreaterThanOrEqual(3_000_000);
        expect(size).toBeGreaterThan(100 * 1e6);                // ít nhất 100 MB
        expect(peak).toBeLessThan(700 * 1024 * 1024);           // RSS không vượt 700 MB (streaming)
        await prisma.$disconnect();
    }, 3_600_000);
});
