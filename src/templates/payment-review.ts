import { formatCurrency, formatDate } from './utils.js';

export interface PaymentReviewTemplateData {
  order: {
    id: number;
    code: string;
    status: string;
    totalAmount: number | { toNumber: () => number };
    shippingFee: number | { toNumber: () => number };
    discountAmount: number | { toNumber: () => number };
    shippingName: string;
    shippingPhone: string;
    shippingAddress: string;
    shippingDistrict?: string | null;
    shippingCity?: string | null;
    items: Array<{
      name: string;
      quantity: number;
      price: number | { toNumber: () => number };
    }>;
  };
  payment: {
    invoiceNumber: string;
    amount: number | { toNumber: () => number };
    method?: string | null;
    paidAt?: Date | null;
    sepayOrderId?: string | null;
  };
  reason: string;
}

export interface BrandConfig {
  name: string;
  supportEmail?: string;
  orderUrl?: (code: string) => string;
  url?: string;
}

export function renderPaymentReview(brand: BrandConfig, data: PaymentReviewTemplateData) {
  const { order, payment, reason } = data;
  const orderUrl = brand.orderUrl ? brand.orderUrl(order.code) : '#';

  // Helper to convert Decimal to number
  const toNumber = (val: number | { toNumber: () => number }): number => {
    return typeof val === 'number' ? val : val.toNumber();
  };

  const reasonText: Record<string, string> = {
    AMOUNT_MISMATCH: 'Số tiền thanh toán không khớp với đơn hàng',
    DUPLICATE_PAYMENT: 'Phát hiện thanh toán trùng lặp',
    UNMATCHED_ORDER: 'Không tìm thấy đơn hàng tương ứng',
    EXPIRED_PAYMENT: 'Thanh toán sau thời gian hết hạn',
  };

  const html = `
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cần kiểm tra thanh toán cho đơn hàng ${order.code}</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%); color: #333; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
    .order-info { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .order-info h3 { color: #f5576c; margin-top: 0; }
    .item { border-bottom: 1px solid #eee; padding: 15px 0; }
    .item:last-child { border-bottom: none; }
    .item-name { font-weight: bold; }
    .item-qty { color: #666; font-size: 0.9em; }
    .item-price { color: #f5576c; font-weight: bold; }
    .total { font-size: 1.2em; font-weight: bold; color: #f5576c; text-align: right; margin-top: 20px; }
    .btn { display: inline-block; background: #f5576c; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
    .footer { text-align: center; margin-top: 30px; color: #666; font-size: 0.9em; }
    .warning-icon { font-size: 48px; margin-bottom: 10px; }
    .alert { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="warning-icon">⚠️</div>
    <h1>Cần kiểm tra thanh toán</h1>
    <p>Đơn hàng ${order.code} cần xác nhận thủ công</p>
  </div>

  <div class="content">
    <p>Chào ${order.shippingName},</p>
    <p>Chúng tôi đã nhận được thanh toán của bạn, nhưng cần xác nhận thủ công vì lý do sau:</p>

    <div class="alert">
      <strong>${reasonText[reason] || reason}</strong>
    </div>

    <div class="order-info">
      <h3>Thông tin đơn hàng</h3>
      <p><strong>Mã đơn hàng:</strong> ${order.code}</p>
      <p><strong>Số tiền đơn hàng:</strong> ${formatCurrency(toNumber(order.totalAmount))}</p>
      <p><strong>Số tiền thanh toán:</strong> ${formatCurrency(toNumber(payment.amount))}</p>
      <p><strong>Mã giao dịch:</strong> ${payment.invoiceNumber}</p>
      ${payment.paidAt ? `<p><strong>Thời gian thanh toán:</strong> ${formatDate(payment.paidAt)}</p>` : ''}
    </div>

    <div class="order-info">
      <h3>Sản phẩm</h3>
      ${order.items.map(item => `
        <div class="item">
          <div class="item-name">${item.name}</div>
          <div class="item-qty">Số lượng: ${item.quantity}</div>
          <div class="item-price">${formatCurrency(toNumber(item.price))}</div>
        </div>
      `).join('')}
    </div>

    <div style="text-align: center;">
      <a href="${orderUrl}" class="btn">Xem chi tiết đơn hàng</a>
    </div>

    <p>Đội ngũ của chúng tôi sẽ kiểm tra và xác nhận thanh toán trong thời gian sớm nhất. Nếu bạn có bất kỳ câu hỏi nào, vui lòng liên hệ với chúng tôi qua email ${brand.supportEmail}</p>
  </div>

  <div class="footer">
    <p>${brand.name} - ${brand.url}</p>
    <p>Email này được gửi tự động, vui lòng không trả lời.</p>
  </div>
</body>
</html>
  `.trim();

  return { html, subject: `Cần kiểm tra thanh toán cho đơn hàng ${order.code}` };
}
