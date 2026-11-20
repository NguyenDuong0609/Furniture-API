import { describe, expect, it } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { advancedOf, condSql, describeAdv, resolveAdv } from './report-advanced.js';
import { REPORTS } from './report-definitions.js';

const def = (id: string) => REPORTS.find((r) => r.id === id)!;
const top = def('top-products');

describe('advancedOf', () => {
    it('báo cáo tổng hợp: tự sinh từ cột, abc_class được ghi đè thành ô chọn', () => {
        const m = new Map(advancedOf(top).map((s) => [s.key, s]));
        expect(m.get('sku')).toMatchObject({ kind: 'text', level: 'result' });
        expect(m.get('revenue')).toMatchObject({ kind: 'number', unit: 'VND' });
        expect(m.get('revenue_share')).toMatchObject({ kind: 'number', percent: true });
        expect(m.get('abc_class')).toMatchObject({ kind: 'enum', options: ['A', 'B', 'C'] });
    });
    it('revenue-by-period có đúng các cột thật của nó, không có tỷ trọng', () => {
        const keys = advancedOf(def('revenue-by-period')).map((s) => s.key);
        expect(keys).toEqual(expect.arrayContaining(['orders', 'net_revenue', 'aov', 'growth']));
        expect(keys).not.toContain('revenue_share');
    });
    it('order-lines: khai báo tường minh, có tầng và cột SQL đích', () => {
        const m = new Map(advancedOf(def('order-lines')).map((s) => [s.key, s]));
        expect(m.get('order_code')).toMatchObject({ level: 'order', sql: 'o2.code' });
        expect(m.get('sku')).toMatchObject({ level: 'line', sql: 'p.sku' });
        expect(m.get('quantity')).toMatchObject({ level: 'line', kind: 'number' });
    });
});

describe('resolveAdv', () => {
    it('nhận chuỗi JSON hoặc object, kết quả như nhau', () => {
        const o = { sku: { contains: 'SF' }, revenue: { min: 1000 } };
        expect(resolveAdv(top, JSON.stringify(o), false).map((a) => a.spec.key)).toEqual(['sku', 'revenue']);
        expect(resolveAdv(top, o, false)).toHaveLength(2);
    });
    it('không có bộ lọc → mảng rỗng', () => {
        expect(resolveAdv(top, undefined, false)).toEqual([]);
        expect(resolveAdv(top, '', false)).toEqual([]);
        expect(resolveAdv(top, { sku: {} }, false)).toEqual([]);
    });
    it('khóa lạ → 400', () => {
        expect(() => resolveAdv(top, { hack: { contains: 'x' } }, false)).toThrow(BadRequestException);
    });
    it('toán tử không hợp loại cột → 400', () => {
        expect(() => resolveAdv(top, { sku: { min: 1 } }, false)).toThrow(BadRequestException);
        expect(() => resolveAdv(top, { revenue: { contains: 'x' } }, false)).toThrow(BadRequestException);
    });
    it('min > max, JSON hỏng, enum ngoài danh sách → 400', () => {
        expect(() => resolveAdv(top, { revenue: { min: 10, max: 5 } }, false)).toThrow(BadRequestException);
        expect(() => resolveAdv(top, '{không phải json', false)).toThrow(BadRequestException);
        expect(() => resolveAdv(top, { abc_class: { in: ['Z'] } }, false)).toThrow(BadRequestException);
    });
    it('số dạng chuỗi được chấp nhận, chuỗi không phải số bị từ chối', () => {
        expect(resolveAdv(top, { revenue: { min: '1500' } }, false)[0].min).toBe(1500);
        expect(() => resolveAdv(top, { revenue: { min: 'abc' } }, false)).toThrow(BadRequestException);
    });
    it('giá trị 0 được giữ lại (không bị coi là "không lọc")', () => {
        const [c] = resolveAdv(top, { revenue: { max: 0 } }, false);
        expect(c.max).toBe(0);
        expect(condSql(c)).toHaveLength(1);
    });
    it('cột cá nhân: không có quyền → 403, có quyền → được', () => {
        const cust = def('top-customers');
        expect(() => resolveAdv(cust, { phone: { contains: '090' } }, false)).toThrow(ForbiddenException);
        expect(resolveAdv(cust, { phone: { contains: '090' } }, true)).toHaveLength(1);
    });
});

describe('condSql', () => {
    it('văn bản: escape %, _ và bọc %...%', () => {
        const [c] = resolveAdv(top, { sku: { contains: '100%_x' } }, false);
        expect(condSql(c)[0].values).toContain('%100\\%\\_x%');
    });
    it('cột đích lấy từ khai báo, số được tham số hóa với ::numeric', () => {
        const [c] = resolveAdv(def('order-lines'), { quantity: { min: 2 } }, false);
        const s = condSql(c)[0];
        expect(s.sql).toContain('oi.quantity');
        expect(s.sql).toContain('::numeric');
        expect(s.values).toEqual([2]);
    });
    it('enum dùng IN với tham số', () => {
        const [c] = resolveAdv(top, { abc_class: { in: ['A', 'B'] } }, false);
        expect(condSql(c)[0].values).toEqual(['A', 'B']);
    });
});

describe('describeAdv', () => {
    it('mô tả dễ đọc, phần trăm hiển thị theo %', () => {
        const adv = resolveAdv(top, { sku: { contains: 'SF' }, revenue: { min: 1000000 }, revenue_share: { min: 0.1, max: 0.5 } }, false);
        const d = describeAdv(adv);
        expect(d).toContain('SKU chứa "SF"');
        expect(d.some((x) => x.includes('≥') && x.includes('VND'))).toBe(true);
        expect(d.some((x) => x.includes('10%') && x.includes('50%'))).toBe(true);
    });
});