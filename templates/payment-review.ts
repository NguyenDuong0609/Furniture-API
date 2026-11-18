import type { Order, Payment } from '@prisma/client';
import { Brand, esc, infoTable, layout, vnd } from './layout.js';

const REASONS: Record<string, string> = {
    AMOUNT_MISMATCH: 'Số tiền SePay báo khác số tiền của đơn hàng.',
    DUPLICATE_PAYMENT: 'Đơn đã được thanh toán trước đó, nay có thêm một khoản thanh toán nữa. Cần hoàn tiền.',
    ORDER_CANCELLED: 'Đơn đã bị hủy nhưng khách vẫn thanh toán. Cần hoàn tiền hoặc khôi phục đơn.',
};

export function renderPaymentReview(b: Brand, d: { order: Order; payment: Payment; reason: string }) {
    const { order, payment, reason } = d;
    const subject = `[${b.name}] CẦN KIỂM TRA: thanh toán đơn ${order.code} (${reason})`;

    const body = `
    <p style="margin:0 0 12px;font-size:14px;line-height:1.6;">${esc(REASONS[reason] ?? 'Giao dịch cần được người kiểm tra xem xét.')}</p>
    ${infoTable([
        ['Lý do', reason],
        ['Mã đơn hàng', order.code],
        ['Trạng thái đơn', order.status],
        ['Mã giao dịch', payment.invoiceNumber],
        ['Số tiền của đơn', vnd(Number(payment.amount))],
        ['Mã đơn phía SePay', payment.sepayOrderId ?? '-'],
    ])}
    <p style="margin:0;font-size:13px;color:#6b7385;">Hệ thống không tự duyệt giao dịch này. Hãy đối chiếu trên my.sepay.vn rồi xử lý thủ công.</p>`;

    const html = layout(b, {
        title: subject, preheader: `Giao dịch đơn ${order.code} cần kiểm tra thủ công.`,
        tone: 'err', icon: '!', heading: 'Giao dịch cần kiểm tra',
        intro: 'Email nội bộ gửi cho quản trị viên.', body,
    });
    const text = `Giao dịch đơn ${order.code} cần kiểm tra. Lý do: ${reason}. Mã giao dịch: ${payment.invoiceNumber}`;
    return { subject, html, text };
}