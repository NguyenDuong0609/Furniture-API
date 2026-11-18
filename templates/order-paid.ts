import type { Order, OrderItem, Payment } from '@prisma/client';
import { Brand, button, esc, fmtDate, infoTable, layout, METHODS, vnd } from './layout.js';

export function renderOrderPaid(
    b: Brand,
    d: { order: Order & { items: OrderItem[] }; payment: Payment },
) {
    const { order, payment } = d;
    const subtotal = d.order.items.reduce((s, i) => s + Number(i.price) * i.quantity, 0);
    const subject = `[${b.name}] Thanh toán thành công đơn hàng ${order.code}`;

    const itemRows = order.items.map((i) => `
    <tr>
      <td style="padding:10px 0;font-size:14px;border-bottom:1px solid #eef1f7;">${esc(i.name)}</td>
      <td align="center" style="padding:10px 8px;font-size:14px;border-bottom:1px solid #eef1f7;color:#6b7385;">x${i.quantity}</td>
      <td align="right" style="padding:10px 0;font-size:14px;border-bottom:1px solid #eef1f7;">${vnd(Number(i.price) * i.quantity)}</td>
    </tr>`).join('');

    const totals: [string, string][] = [['Tạm tính', vnd(subtotal)]];
    if (Number(order.shippingFee) > 0) totals.push(['Phí vận chuyển', vnd(Number(order.shippingFee))]);
    if (Number(order.discountAmount) > 0) totals.push(['Giảm giá', '-' + vnd(Number(order.discountAmount))]);

    const address = [order.shippingAddress, order.shippingDistrict, order.shippingCity].filter(Boolean).join(', ');
    const url = b.orderUrl?.(order.code);

    const body = `
    ${infoTable([
        ['Mã đơn hàng', order.code],
        ['Mã giao dịch', payment.invoiceNumber],
        ['Phương thức', METHODS[payment.method ?? ''] ?? payment.method ?? '-'],
        ['Thời gian', payment.paidAt ? fmtDate(payment.paidAt) : '-'],
        ['Số tiền đã thanh toán', vnd(Number(payment.amount))],
    ])}
    <h3 style="margin:0 0 4px;font-size:15px;">Sản phẩm</h3>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemRows}</table>
    ${infoTable(totals)}
    <h3 style="margin:0 0 4px;font-size:15px;">Giao đến</h3>
    <p style="margin:0;font-size:14px;line-height:1.6;color:#1d2433;">
      ${esc(order.shippingName)} · ${esc(order.shippingPhone)}<br>${esc(address)}
    </p>
    ${url ? button(url, 'Xem đơn hàng') : ''}
    <p style="margin:20px 0 0;font-size:13px;color:#6b7385;text-align:center;">Cảm ơn bạn đã mua sắm tại ${esc(b.name)}!</p>`;

    const html = layout(b, {
        title: subject,
        preheader: `Đơn ${order.code} đã được thanh toán ${vnd(Number(payment.amount))}.`,
        tone: 'ok', icon: '&#10003;',
        heading: 'Thanh toán thành công',
        intro: `Chúng tôi đã nhận được thanh toán cho đơn hàng ${order.code}.`,
        body,
    });

    const text = [
        `Thanh toán thành công - đơn hàng ${order.code}`,
        `Mã giao dịch: ${payment.invoiceNumber}`,
        `Số tiền: ${vnd(Number(payment.amount))}`,
        `Phương thức: ${METHODS[payment.method ?? ''] ?? payment.method ?? '-'}`,
        payment.paidAt ? `Thời gian: ${fmtDate(payment.paidAt)}` : '',
        '',
        ...order.items.map((i) => `- ${i.name} x${i.quantity}: ${vnd(Number(i.price) * i.quantity)}`),
        '',
        `Giao đến: ${order.shippingName} - ${order.shippingPhone} - ${address}`,
        url ?? '',
    ].filter((l) => l !== '').join('\n');

    return { subject, html, text };
}