import { mkdirSync, writeFileSync } from 'fs';
import { renderOrderPaid } from '../templates/order-paid.js';
import { renderOrderExpired } from '../templates/order-expired.js';
import { renderPaymentReview } from '../templates/payment-review.js';

const brand = {
    name: 'Furniture Store', supportEmail: 'support@furniture.local',
    orderUrl: (c: string) => `http://localhost:3000/orders/${c}`, url: 'http://localhost:3000'
};
const order: any = {
    id: 1, code: 'ORD2026111324C2E3', status: 'CONFIRMED', totalAmount: 15900000, shippingFee: 0, discountAmount: 0,
    shippingName: 'Nguyễn Dương', shippingPhone: '0900000000', shippingAddress: '12 Lê Lợi', shippingDistrict: 'Quận 1', shippingCity: 'TP.HCM',
    items: [{ name: 'Sofa da 3 chỗ', quantity: 1, price: 12900000 }, { name: 'Bàn trà gỗ sồi', quantity: 2, price: 1500000 }],
};
const payment: any = { invoiceNumber: 'ORD2026111324C2E3-8BE9B034', amount: 15900000, method: 'BANK_TRANSFER', paidAt: new Date(), sepayOrderId: 'PAY118196AF69606A85EB' };

mkdirSync('tmp/mail-preview', { recursive: true });
writeFileSync('tmp/mail-preview/order-paid.html', renderOrderPaid(brand, { order, payment }).html);
writeFileSync('tmp/mail-preview/order-expired.html', renderOrderExpired(brand, { order }).html);
writeFileSync('tmp/mail-preview/payment-review.html', renderPaymentReview(brand, { order, payment, reason: 'AMOUNT_MISMATCH' }).html);
console.log('Đã xuất ra tmp/mail-preview/');