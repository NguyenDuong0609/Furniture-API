import { createWriteStream } from 'node:fs';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { REPORTS } from '../../src/reports/report-definitions.js';
import { writeCsv } from '../../src/reports/export/csv-writer.js';
import { writeXlsx } from '../../src/reports/export/xlsx-writer.js';
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

describe('revenue-by-period', () => {
    it('gom kỳ theo giờ Việt Nam, loại đơn hủy/chưa trả, đúng ranh giới ngày', async () => {
        const p = await mkProduct('Sofa A', 1_000_000);
        const item = [{ productId: p.id, quantity: 1, price: 1_000_000 }];
        await paidOrder('2026-03-31T16:59:59.000Z', item);                         // 23:59:59 VN 31/3 → tháng 3, Q1
        await paidOrder('2026-03-31T17:00:00.000Z', item);                         // 00:00:00 VN 1/4  → tháng 4, Q2
        await paidOrder('2026-04-30T17:00:00.000Z', item);                         // 00:00 VN 1/5     → ngoài khoảng (to = 30/4)
        await paidOrder('2026-04-10T05:00:00.000Z', item, { status: 'CANCELLED' }); // bị loại
        await paidOrder('2026-04-10T05:00:00.000Z', item, { paymentStatus: 'UNPAID', paidAt: null }); // bị loại

        const def = svc.get('revenue-by-period');
        const month: any = await svc.list(def, F({ groupBy: 'month' }), false);
        expect(month.rows.map((r: any) => r.period)).toEqual(['2026-03', '2026-04']);
        expect(month.rows.map((r: any) => Number(r.net_revenue))).toEqual([1_000_000, 1_000_000]);
        expect(Number(month.rows[1].growth)).toBe(0);
        expect(Number(month.sums.net_revenue)).toBe(2_000_000);

        const quarter: any = await svc.list(def, F({ groupBy: 'quarter' }), false);
        expect(quarter.rows.map((r: any) => r.period)).toEqual(['2026-Q1', '2026-Q2']);
    });

    it('cơ sở ngày ORDER lọc theo ngày đặt hàng thay vì ngày thu tiền', async () => {
        const p = await mkProduct('Sofa A', 1_000_000);
        await paidOrder('2026-03-10T05:00:00.000Z', [{ productId: p.id, quantity: 1, price: 1_000_000 }],
            { createdAt: new Date('2026-02-10T05:00:00.000Z') });
        const def = svc.get('revenue-by-period');
        expect(((await svc.list(def, F({ basis: 'PAID' }), false)) as any).total).toBe(1);
        expect(((await svc.list(def, F({ basis: 'ORDER' }), false)) as any).total).toBe(0);
    });
});

describe('top-products', () => {
    it('xếp hạng, tỷ trọng và nhóm ABC đúng ở các ngưỡng 80% và 95%', async () => {
        const [a, b, c] = await Promise.all([mkProduct('A', 1_000_000), mkProduct('B', 100_000), mkProduct('C', 100_000)]);
        await paidOrder('2026-03-10T05:00:00.000Z', [
            { productId: a.id, quantity: 8, price: 1_000_000 },    // 8.000.000 = 80%
            { productId: b.id, quantity: 15, price: 100_000 },     // 1.500.000 = 15%
            { productId: c.id, quantity: 5, price: 100_000 },      //   500.000 = 5%
        ]);
        const def = svc.get('top-products');

        const byRev: any = await svc.list(def, F({ metric: 'revenue' }), false);
        expect(byRev.rows.map((r: any) => r.product)).toEqual(['A', 'B', 'C']);
        expect(byRev.rows.map((r: any) => r.abc_class)).toEqual(['A', 'B', 'C']);
        expect(Number(byRev.rows[0].revenue_share)).toBeCloseTo(0.8, 6);
        expect(Number(byRev.rows[2].cum_share)).toBeCloseTo(1, 6);

        const byQty: any = await svc.list(def, F({ metric: 'quantity' }), false);
        expect(byQty.rows.find((r: any) => r.rank_no === 1).product).toBe('B');   // B bán nhiều cái nhất (15)
        expect(byQty.rows.map((r: any) => r.abc_class).sort()).toEqual(['A', 'B', 'C']);  // ABC luôn theo doanh thu
    });

    it('tìm kiếm theo tên và lọc theo danh mục', async () => {
        const other = await prisma.category.create({ data: { name: 'Bàn', slug: `ban-${++seq}` } });
        const a = await mkProduct('Sofa Da', 1_000_000);
        const b = await mkProduct('Bàn Gỗ', 500_000, { categoryId: other.id });
        await paidOrder('2026-03-10T05:00:00.000Z', [
            { productId: a.id, quantity: 1, price: 1_000_000 }, { productId: b.id, quantity: 1, price: 500_000 },
        ]);
        const def = svc.get('top-products');
        expect(((await svc.list(def, F({ q: 'gỗ' }), false)) as any).rows.map((r: any) => r.product)).toEqual(['Bàn Gỗ']);
        expect(((await svc.list(def, F({ categoryId: other.id }), false)) as any).rows.map((r: any) => r.product)).toEqual(['Bàn Gỗ']);
    });
});

describe('products-on-sale và slow-products', () => {
    it('on-sale chỉ gồm sản phẩm có giá sale và đang bán; slow-products gồm hàng còn tồn không bán', async () => {
        const sale = await mkProduct('Có sale', 1_000_000, { salePrice: 800_000 });
        await mkProduct('Không sale', 500_000);
        await mkProduct('Sale nhưng ngừng bán', 500_000, { salePrice: 400_000, isActive: false });
        const dead = await mkProduct('Ế', 300_000);
        await mkProduct('Hết hàng', 300_000, { stock: 0 });
        await paidOrder('2026-03-10T05:00:00.000Z', [{ productId: sale.id, quantity: 2, price: 800_000 }]);

        const onSale: any = await svc.list(svc.get('products-on-sale'), F(), false);
        expect(onSale.rows.map((r: any) => r.product)).toEqual(['Có sale']);
        expect(Number(onSale.rows[0].discount_rate)).toBeCloseTo(0.2, 6);
        expect(Number(onSale.rows[0].units_sold)).toBe(2);

        const slow: any = await svc.list(svc.get('slow-products'), F(), false);
        const names = slow.rows.map((r: any) => r.product);
        expect(names).toContain('Ế');
        expect(names).not.toContain('Có sale');         // đã bán 2
        expect(names).not.toContain('Hết hàng');        // tồn = 0
        expect(names).not.toContain('Sale nhưng ngừng bán');
        expect(Number(slow.rows.find((r: any) => r.product === 'Ế').stock_value)).toBe(dead.stock * 300_000);
    });
});

describe('order-lines: đọc theo lô (keyset)', () => {
    it('không sót, không trùng dòng kể cả khi nhiều đơn có cùng thời điểm; đúng thứ tự', async () => {
        const p = await mkProduct('SP', 100_000);
        const tie = new Date('2026-03-10T05:00:00.000Z');
        const orders = Array.from({ length: 300 }, (_, i) => ({
            code: `K${i}`, status: 'DELIVERED' as const, paymentStatus: 'PAID' as const, totalAmount: 200_000,
            shippingName: 'A', shippingPhone: '0900000000', shippingAddress: 'x',
            createdAt: i < 150 ? tie : new Date(tie.getTime() + i * 1000), paidAt: i < 150 ? tie : new Date(tie.getTime() + i * 1000),
        }));
        await prisma.order.createMany({ data: orders });
        const ids = (await prisma.order.findMany({ select: { id: true } })).map((o) => o.id);
        await prisma.orderItem.createMany({
            data: ids.flatMap((id) => [1, 2].map((q) => ({ orderId: id, productId: p.id, quantity: q, price: 100_000, name: 'sp' }))),
        });

        const seen = new Set<string>();
        let total = 0, prev = '';
        for await (const batch of svc.iterate(svc.get('order-lines'), F({ basis: 'PAID' }), true, { batchOrders: 70 })) {
            for (const r of batch) {
                const key = `${r.order_id}:${r.quantity}`;
                expect(seen.has(key)).toBe(false);
                seen.add(key);
                const order = `${r.cursor_ts}|${String(r.order_id).padStart(9, '0')}`;
                expect(order >= prev).toBe(true);
                prev = order;
                total++;
            }
        }
        expect(total).toBe(600);
    });
});

describe('trigger paidAt', () => {
    it('đặt paymentStatus = PAID thì paidAt tự có giá trị', async () => {
        const o = await prisma.order.create({
            data: { code: `TR${++seq}`, totalAmount: 1, shippingName: 'A', shippingPhone: '0', shippingAddress: 'x' },
        });
        expect(o.paidAt).toBeNull();
        const after = await prisma.order.update({ where: { id: o.id }, data: { paymentStatus: 'PAID' } });
        expect(after.paidAt).not.toBeNull();
    });
});

describe('export file', () => {
    async function seedLines() {
        const p = await mkProduct('Sofa =HYPERLINK("x")', 1_000_000);   // tên bắt đầu bình thường nhưng chứa công thức
        await paidOrder('2026-03-10T05:00:00.000Z', [{ productId: p.id, quantity: 2, price: 1_000_000 }],
            { shippingName: '=CMD()' });
    }

    it('CSV: có BOM, chặn công thức, đủ dòng', async () => {
        await seedLines();
        const def = svc.get('order-lines');
        const file = join(mkdtempSync(join(tmpdir(), 'rep-')), 'o.csv');
        const n = await writeCsv(createWriteStream(file), def.columns, svc.iterate(def, F(), true), { delimiter: ',', headers: 'label' });
        const text = readFileSync(file, 'utf8');
        expect(n).toBe(1);
        expect(text.startsWith('\uFEFF')).toBe(true);
        expect(text).toContain("'=CMD()");
        expect(text.trim().split('\r\n')).toHaveLength(2);
    });

    it('XLSX: có 2 sheet, tiêu đề ở dòng 4, dòng tổng dùng SUBTOTAL, số là số thật', async () => {
        await seedLines();
        const def = svc.get('order-lines');
        const file = join(mkdtempSync(join(tmpdir(), 'rep-')), 'o.xlsx');
        const sum = await svc.summary(def, F());
        await writeXlsx(createWriteStream(file), def.columns, svc.iterate(def, F(), true), {
            company: 'Cty Test', title: def.title, subtitle: def.description, period: 'Từ 01/03/2026 đến 30/04/2026',
            basisText: 'Ngày thu tiền', generatedBy: 'tester', generatedAt: new Date(), filters: [],
            kpis: [{ label: sum.totalLabel, value: sum.total, type: 'int' }], notes: def.notes, maxRows: 1_000_000,
        });

        const wb = new ExcelJS.Workbook();
        await wb.xlsx.readFile(file);
        expect(wb.worksheets.map((w) => w.name)).toEqual(['Tổng quan', 'Dữ liệu']);
        const ws = wb.getWorksheet('Dữ liệu')!;
        expect(ws.getRow(4).getCell(1).value).toBe('Mã đơn');
        expect(typeof ws.getRow(5).getCell(15).value).toBe('number');        // cột Số lượng
        const last: any = ws.getRow(6).getCell(15).value;                    // dòng tổng
        expect(last.formula).toMatch(/^SUBTOTAL\(109,O5:O5\)$/);
        expect(ws.getRow(6).getCell(1).value).toBe('TỔNG CỘNG');
    });

    it('XLSX vượt giới hạn dòng thì báo lỗi rõ ràng', async () => {
        await seedLines();
        const def = svc.get('order-lines');
        const file = join(mkdtempSync(join(tmpdir(), 'rep-')), 'o.xlsx');
        await expect(writeXlsx(createWriteStream(file), def.columns, svc.iterate(def, F(), true), {
            company: 'x', title: 't', subtitle: 's', period: 'p', basisText: 'b', generatedBy: 'g', generatedAt: new Date(),
            filters: [], kpis: [], notes: [], maxRows: 0,
        })).rejects.toThrow(/giới hạn/);
    });
});