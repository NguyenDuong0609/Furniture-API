// test/integration/report-bench.int-spec.ts
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { writeCsv } from '../../src/reports/export/csv-writer.js';
import { FiltersSchema } from '../../src/reports/report-types.js';
import { ReportsService } from '../../src/reports/reports.service.js';
import { createPrisma } from './helpers/db.js';

describe.skipIf(!process.env.BENCH)('export 1 triệu đơn', () => {
    it('bộ nhớ không tăng theo số dòng', async () => {
        const prisma = createPrisma();
        const svc = new ReportsService(prisma as any);
        const def = svc.get('order-lines');
        const f = FiltersSchema.parse({ from: '2000-01-01', to: '2100-01-01', basis: 'PAID' });

        let bytes = 0, peak = 0;
        const timer = setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 200);
        const sink = new Writable({ write(c, _e, cb) { bytes += c.length; cb(); } });
        const t0 = Date.now();
        const rows = await writeCsv(sink, def.columns, svc.iterate(def, f, true), { delimiter: ',', headers: 'label' });
        clearInterval(timer);

        const s = (Date.now() - t0) / 1000;
        console.log(`${rows} dòng, ${(bytes / 1e6).toFixed(0)} MB, ${s.toFixed(0)}s, ${(rows / s).toFixed(0)} dòng/s, RSS đỉnh ${(peak / 1e6).toFixed(0)} MB`);
        expect(rows).toBeGreaterThanOrEqual(3_000_000);
        expect(peak).toBeLessThan(700 * 1024 * 1024);          // ngưỡng gợi ý; hãy ghi lại số đo thực tế của bạn
        await prisma.$disconnect();
    }, 3_600_000);
});