import { describe, expect, it } from 'vitest';
import { renderOrderPaid } from './templates/order-paid.js';

const brand = { name: 'Furniture Store' };

describe('renderOrderPaid', () => {
    const order: any = {
        id: 1, code: 'ORD1', totalAmount: 100000, shippingFee: 0, discountAmount: 0,
        shippingName: '<script>alert(1)</script>', shippingPhone: '0900000000',
        shippingAddress: '12 Lê Lợi', shippingDistrict: null, shippingCity: 'TP.HCM',
        items: [{ name: 'Ghế <b>gỗ</b>', quantity: 2, price: 50000 }],
    };
    const payment: any = { invoiceNumber: 'ORD1-AB12', amount: 100000, method: 'CARD', paidAt: new Date() };

    it('escape dữ liệu người dùng (chống chèn HTML/script)', () => {
        const { html } = renderOrderPaid(brand, { order, payment });
        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).toContain('&lt;script&gt;');
        expect(html).not.toContain('<b>gỗ</b>');
    });

    it('có tiêu đề chứa mã đơn và bản text', () => {
        const r = renderOrderPaid(brand, { order, payment });
        expect(r.subject).toContain('ORD1');
        expect(r.text).toContain('ORD1-AB12');
    });
});