import type { Order } from '@prisma/client';
import { Brand, button, esc, infoTable, layout, vnd } from './layout.js';

export function renderOrderExpired(b: Brand, d: { order: Order }) {
    const { order } = d;
    const subject = `[${b.name}] Đơn hàng ${order.code} đã bị hủy do quá hạn thanh toán`;
    const url = b.url;

    const body = `
    ${infoTable([['Mã đơn hàng', order.code], ['Giá trị đơn', vnd(Number(order.totalAmount))]])}
    <p style="margin:0;font-size:14px;line-height:1.6;color:#1d2433;">
      Sản phẩm trong đơn đã được trả về kho. Nếu bạn vẫn muốn mua, vui lòng đặt lại đơn hàng.
      Nếu bạn đã chuyển tiền cho đơn này, đừng lo: hãy liên hệ chúng tôi để được kiểm tra và hỗ trợ.
    </p>
    ${url ? button(url, 'Tiếp tục mua sắm') : ''}`;

    const html = layout(b, {
        title: subject,
        preheader: `Đơn ${order.code} đã hết hạn thanh toán.`,
        tone: 'warn', icon: '!',
        heading: 'Đơn hàng đã bị hủy',
        intro: `Đơn hàng ${order.code} chưa được thanh toán trong thời gian quy định.`,
        body,
    });

    const text = [
        `Đơn hàng ${order.code} đã bị hủy do quá hạn thanh toán.`,
        `Nếu bạn đã chuyển tiền, vui lòng liên hệ ${b.supportEmail ?? 'cửa hàng'} để được hỗ trợ.`,
    ].join('\n');

    return { subject, html, text };
}