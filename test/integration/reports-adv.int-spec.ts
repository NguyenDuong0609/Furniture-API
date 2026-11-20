import { createWriteStream, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { writeXlsx } from '../../src/reports/export/xlsx-writer.js';
import { describeAdv } from '../../src/reports/export/report-advanced.js';
import { FiltersSchema } from '../../src/reports/report-types.js';
import { ReportsService } from '../../src/reports/reports.service.js';
import { createPrisma, resetDb } from './helpers/db.js';

const prisma = createPrisma();
const svc = new ReportsService(prisma as any);
const F = (o: any = {}) => FiltersSchema.parse({ from: '2026-03-01', to: '2026-04-30', ...o });
let seq = 0;
let categoryId: number;

beforeAll(() => prisma.$connect());
afterAll(() => prisma.$disconnect());
beforeEach(async () => {
    await resetDb(prisma);
    categoryId = (await prisma.category.create({ data: { name: 'Sofa', slug: `sofa-${++seq}` } })).id;
});

const mkProduct = (name: string, price: number, over: any = {}) =>
    prisma.product.create({ data: { name, slug: `p-${++seq}`, sku: `SKU${seq}`, price, stock: 10, categoryId, ...over } });

async function paidOrder(paidAt: string, items: { productId: number; quantity: number; price: number }[], over: any = {}) {
    const total = items.reduce((s, i) => s + i.quantity * i.price, 0);
    return prisma.order.create({
        data: {
            code: `T${++seq}`, status: 'DELIVERED', paymentStatus: 'PAID', paymentMethod: 'BANK_TRANSFER',
            totalAmount: total, shippingName: 'A', shippingPhone: '0900000000', shippingAddress: 'x',
            createdAt: new Date(paidAt), paidAt: new Date(paidAt),
            items: { create: items.map((i) => ({ productId: i.productId, quantity: i.quantity, price: i.price, name: 'sp' })) },
            ...over,
        },
    });
}
const collect = async (it: AsyncIterable<any[]>) => { const all: any[] = []; for await (const b of it) all.push(...b); return all; };

describe('top-products với bộ lọc nâng cao', () => {
    async function seed() {
        // "Bàn C" cần category riêng (khác "Sofa") để q:"sofa" không khớp nhầm qua category
        const otherCat = await prisma.category.create({ data: { name: 'Bàn Ghế', slug: `ban-ghe-${++seq}` } });
        const [a, b, c] = await Promise.all([
            mkProduct('Sofa A', 1_000_000, { sku: 'SF-001' }),
            mkProduct('Sofa B', 100_000, { sku: 'SF-002' }),
            mkProduct('Bàn C', 100_000, { sku: 'TB-001', categoryId: otherCat.id }),
        ]);
        await paidOrder('2026-03-10T05:00:00.000Z', [
            { productId: a.id, quantity: 8, price: 1_000_000 },   // 8.000.000 → A
            { productId: b.id, quantity: 15, price: 100_000 },    // 1.500.000 → B
            { productId: c.id, quantity: 5, price: 100_000 },     //   500.000 → C
        ]);
    }
    const def = () => svc.get('top-products');
    const run = async (adv?: any) => ((await svc.list(def(), F({ metric: 'revenue', adv }), false)) as any);

    it('lọc SKU chứa: chỉ còn sản phẩm khớp, hạng/ABC/tỷ trọng GIỮ NGUYÊN như khi không lọc', async () => {
        await seed();
        const all = await run();
        const filtered = await run({ sku: { contains: 'sf-00' } });           // không phân biệt hoa thường
        expect(filtered.rows.map((r: any) => r.sku).sort()).toEqual(['SF-001', 'SF-002']);
        for (const r of filtered.rows) {
            const same = all.rows.find((x: any) => x.sku === r.sku);
            expect(r.rank_no).toBe(same.rank_no);
            expect(r.abc_class).toBe(same.abc_class);
            expect(Number(r.revenue_share)).toBeCloseTo(Number(same.revenue_share), 8);
        }
    });

    it('lọc nhóm ABC', async () => {
        await seed();
        expect((await run({ abc_class: { in: ['A'] } })).rows.map((r: any) => r.sku)).toEqual(['SF-001']);
        expect((await run({ abc_class: { in: ['B', 'C'] } })).total).toBe(2);
    });

    it('lọc khoảng doanh thu, kể cả biên 0 và min = max', async () => {
        await seed();
        expect((await run({ revenue: { min: 1_000_000 } })).total).toBe(2);
        expect((await run({ revenue: { max: 0 } })).total).toBe(0);              // 0 vẫn là điều kiện lọc
        expect((await run({ revenue: { min: 500_000, max: 500_000 } })).rows.map((r: any) => r.sku)).toEqual(['TB-001']);
    });

    it('tổng số dòng và các ô tổng phản ánh bộ lọc; kết hợp nhiều điều kiện là AND', async () => {
        await seed();
        const r = await run({ sku: { contains: 'SF' }, units: { min: 10 } });
        expect(r.total).toBe(1);
        expect(Number(r.sums.revenue)).toBe(1_500_000);
    });

    it('kết hợp với ô tìm nhanh q', async () => {
        await seed();
        const r: any = await svc.list(def(), F({ metric: 'revenue', q: 'sofa', adv: { revenue: { max: 2_000_000 } } }), false);
        expect(r.rows.map((x: any) => x.sku)).toEqual(['SF-002']);
    });
});

describe('order-lines với bộ lọc nâng cao', () => {
    // 300 đơn, mỗi đơn có dòng OTHER; 10 đơn cuối (290–299) có thêm dòng TARGET (SL 2, giá 500.000)
    async function seed() {
        const target = await mkProduct('Sản phẩm mục tiêu', 500_000, { sku: 'TARGET-1' });
        const other = await mkProduct('Sản phẩm khác', 100_000, { sku: 'OTHER-1' });
        const base = new Date('2026-03-10T05:00:00.000Z').getTime();
        await prisma.order.createMany({
            data: Array.from({ length: 300 }, (_, i) => ({
                code: `K${i}`, status: 'DELIVERED' as const, paymentStatus: 'PAID' as const, totalAmount: 200_000,
                shippingName: 'A', shippingPhone: '0900000000', shippingAddress: 'x',
                createdAt: new Date(base + i * 1000), paidAt: new Date(base + i * 1000),
            })),
        });
        const orders = await prisma.order.findMany({ select: { id: true, code: true } });
        await prisma.orderItem.createMany({
            data: orders.flatMap((o) => {
                const n = Number(o.code.slice(1));
                const lines = [{ orderId: o.id, productId: other.id, quantity: 1, price: 100_000, name: 'khác' }];
                if (n >= 290) lines.push({ orderId: o.id, productId: target.id, quantity: 2, price: 500_000, name: 'mục tiêu' });
                return lines;
            }),
        });
    }
    const def = () => svc.get('order-lines');
    const lines = (adv: any, batchOrders = 20) => collect(svc.iterate(def(), F({ adv }), true, { batchOrders }));

    it('lọc SKU hiếm: chỉ trả đúng các dòng khớp, không sót dù chia nhiều lô nhỏ', async () => {
        await seed();
        for (const batch of [3, 20, 2000]) {
            const rows = await lines({ sku: { contains: 'target' } }, batch);
            expect(rows).toHaveLength(10);
            expect(rows.every((r) => r.sku === 'TARGET-1')).toBe(true);
        }
    });

    it('lọc mã đơn (cấp đơn): giữ nguyên mọi dòng của các đơn khớp', async () => {
        await seed();
        const rows = await lines({ order_code: { contains: 'K29' } });
        expect(rows.every((r) => r.order_code.startsWith('K29'))).toBe(true);
        expect(rows).toHaveLength(21);                           // K29 (1 dòng) + K290..K299 (2 dòng mỗi đơn)
    });

    it('lọc số lượng và đơn giá (cấp dòng)', async () => {
        await seed();
        expect(await lines({ quantity: { min: 2 } })).toHaveLength(10);
        expect(await lines({ unit_price: { min: 400_000 } })).toHaveLength(10);
        expect(await lines({ unit_price: { max: 100_000 } })).toHaveLength(300);
        expect(await lines({ quantity: { min: 2 }, unit_price: { max: 100_000 } })).toHaveLength(0);
    });

    it('summary và countOrders phản ánh bộ lọc', async () => {
        await seed();
        const f = F({ adv: { sku: { contains: 'target' } } });
        const s = await svc.summary(def(), f, true);
        expect(s.total).toBe(10);
        expect(Number(s.sums.quantity)).toBe(20);
        expect(Number(s.sums.line_total)).toBe(10_000_000);
        expect(await svc.countOrders(def(), f, 1000, true)).toBe(10);
    });

    it('ký tự đặc biệt trong ô văn bản không làm hỏng truy vấn', async () => {
        await seed();
        for (const v of ["'; DROP TABLE \"Order\";--", '100%', '_', '\\']) {
            await expect(lines({ sku: { contains: v } })).resolves.toHaveLength(0);
        }
        expect(await prisma.order.count()).toBe(300);
    });
});

describe('export có bộ lọc nâng cao', () => {
    it('bìa Excel liệt kê bộ lọc và dòng tổng chỉ tính phần đã lọc', async () => {
        const p = await mkProduct('SP lọc', 500_000, { sku: 'TARGET-9' });
        const q = await mkProduct('SP khác', 100_000, { sku: 'OTHER-9' });
        await paidOrder('2026-03-10T05:00:00.000Z', [
            { productId: p.id, quantity: 2, price: 500_000 }, { productId: q.id, quantity: 1, price: 100_000 },
        ]);
        const def = svc.get('order-lines');
        const f = F({ adv: { sku: { contains: 'target' } } });
        const adv = svc.resolveAdv(def, f, true);
        const sum = await svc.summary(def, f, true);
        const file = join(mkdtempSync(join(tmpdir(), 'adv-')), 'o.xlsx');
        const rows = await writeXlsx(createWriteStream(file), def.columns, svc.iterate(def, f, true), {
            company: 'Cty Test', title: def.title, subtitle: def.description, period: 'p', basisText: 'b',
            generatedBy: 'tester', generatedAt: new Date(), filters: describeAdv(adv).map((s) => `Lọc cột: ${s}`),
            kpis: [{ label: sum.totalLabel, value: sum.total, type: 'int' }], notes: def.notes, maxRows: 1_000_000,
        });
        expect(rows).toBe(1);                                   // chỉ dòng TARGET-9

        const wb = new ExcelJS.Workbook();
        await wb.xlsx.readFile(file);
        const cover: string[] = [];
        wb.getWorksheet('Tổng quan')!.eachRow((r) => cover.push(String(r.values)));
        expect(cover.join('\n')).toContain('Lọc cột: SKU chứa "target"');
    });
});