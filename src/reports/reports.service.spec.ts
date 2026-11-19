import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FiltersSchema } from './report-types.js';
import { ReportsService } from './reports.service.js';

const F = (o: any = {}) => FiltersSchema.parse({ from: '2026-01-01', to: '2026-03-31', ...o });

describe('FiltersSchema', () => {
    it('từ chối ngày không có thật và from > to', () => {
        expect(FiltersSchema.safeParse({ from: '2026-02-31', to: '2026-03-01' }).success).toBe(false);
        expect(FiltersSchema.safeParse({ from: '2026-04-01', to: '2026-03-01' }).success).toBe(false);
    });
    it('áp dụng giá trị mặc định', () => {
        expect(F()).toMatchObject({ basis: 'PAID', groupBy: 'month', page: 1, limit: 50 });
    });
    it('từ chối giá trị ngoài danh sách (không đưa được vào SQL)', () => {
        expect(FiltersSchema.safeParse({ from: '2026-01-01', to: '2026-01-02', groupBy: "day'); DROP TABLE x;--" }).success).toBe(false);
    });
});

describe('ReportsService', () => {
    const svc = (prisma: any = { $queryRaw: vi.fn() }) => ({ s: new ReportsService(prisma), prisma });

    it('báo cáo không tồn tại → 404', () => {
        expect(() => svc().s.get('nope')).toThrow(NotFoundException);
    });
    it('sortBy ngoài danh sách cho phép → 400 và không chạy truy vấn', async () => {
        const { s, prisma } = svc();
        await expect(s.list(s.get('top-products'), F({ sortBy: 'revenue; DROP TABLE x' }), false)).rejects.toThrow(BadRequestException);
        expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
    it('cursor hỏng → 400', async () => {
        const { s } = svc();
        await expect(s.list(s.get('order-lines'), F({ cursor: 'khong-phai-cursor' }), false)).rejects.toThrow(BadRequestException);
    });
    it('không có quyền PII thì cột và dữ liệu cá nhân bị loại', async () => {
        const prisma = {
            $queryRaw: vi.fn().mockResolvedValue([
                { order_id: 1, order_code: 'A', customer_name: 'Nguyễn Văn A', phone: '0900000000', cursor_ts: '2026-03-01T00:00:00.000000' },
            ]),
        };
        const s = new ReportsService(prisma as any);
        const r: any = await s.list(s.get('order-lines'), F(), false);
        expect(r.columns.some((c: any) => c.pii)).toBe(false);
        expect(r.rows[0]).not.toHaveProperty('phone');
        expect(r.rows[0]).not.toHaveProperty('customer_name');
        const r2: any = await s.list(s.get('order-lines'), F(), true);
        expect(r2.rows[0].phone).toBe('0900000000');
    });
});