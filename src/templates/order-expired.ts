import { formatCurrency, formatDate } from './utils.js';

export interface OrderExpiredTemplateData {
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
}

export interface BrandConfig {
  name: string;
  supportEmail?: string;
  orderUrl?: (code: string) => string;
  url?: string;
}

export function renderOrderExpired(brand: BrandConfig, data: OrderExpiredTemplateData) {
  const { order } = data;
  const orderUrl = brand.orderUrl ? brand.orderUrl(order.code) : '#';

  // Helper to convert Decimal to number
  const toNumber = (val: number | { toNumber: () => number }): number => {
    return typeof val === 'number' ? val : val.toNumber();
  };

  const html = `
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Đơn hàng ${order.code} đã hết hạn thanh toán</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
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
  </style>
</head>
<body>
  <div class="header">
    <div class="warning-icon">⏰</div>
    <h1>Đơn hàng đã hết hạn thanh toán</h1>
    <p>Đơn hàng ${order.code} của bạn đã được hủy</p>
  </div>

  <div class="content">
    <p>Chào ${order.shippingName},</p>
    <p>Chúng tôi xin thông báo rằng đơn hàng của bạn đã hết hạn thời gian thanh toán và đã được tự động hủy. Nếu bạn vẫn muốn mua các sản phẩm này, vui lòng đặt lại đơn hàng mới.</p>

    <div class="order-info">
      <h3>Thông tin đơn hàng</h3>
      <p><strong>Mã đơn hàng:</strong> ${order.code}</p>
      <p><strong>Trạng thái:</strong> Đã hủy</p>
    </div>

    <div class="order-info">
      <h3>Sản phẩm trong đơn hàng</h3>
      ${order.items.map(item => `
        <div class="item">
          <div class="item-name">${item.name}</div>
          <div class="item-qty">Số lượng: ${item.quantity}</div>
          <div class="item-price">${formatCurrency(toNumber(item.price))}</div>
        </div>
      `).join('')}
      <div class="total">
        Tổng cộng: ${formatCurrency(toNumber(order.totalAmount))}
      </div>
    </div>

    <div style="text-align: center;">
      <a href="${brand.url}" class="btn">Đặt lại đơn hàng</a>
    </div>

    <p>Nếu bạn có bất kỳ câu hỏi nào, vui lòng liên hệ với chúng tôi qua email ${brand.supportEmail}</p>
  </div>

  <div class="footer">
    <p>${brand.name} - ${brand.url}</p>
    <p>Email này được gửi tự động, vui lòng không trả lời.</p>
  </div>
</body>
</html>
  `.trim();

  return { html, subject: `Đơn hàng ${order.code} đã hết hạn thanh toán` };
}
