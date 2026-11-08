import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreatePaymentDto } from './dto/create-payment.dto.js';
import { randomBytes } from 'crypto';
import { EventsGateway } from '../events/events.gateway.js';
import * as crypto from 'crypto';
import * as qs from 'qs';

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService, private readonly eventsGateway: EventsGateway) {}

  /**
   * Xác nhận thanh toán COD (Admin hoặc hệ thống)
   */
  async confirmCod(orderId: number) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException('Không tìm thấy đơn hàng');
    }

    if (order.paymentMethod !== 'COD') {
      throw new BadRequestException('Đơn hàng này không phải COD');
    }

    if (order.paymentStatus === 'PAID') {
      throw new BadRequestException('Đơn hàng đã được thanh toán');
    }

    return this.prisma.order.update({
      where: { id: orderId },
      data: {
        paymentStatus: 'PAID',
        status: 'CONFIRMED',
      },
    });
  }

  /**
   * Tạo link thanh toán online (mô phỏng)
   * Trong thực tế sẽ gọi API của CPay / VNPay / MoMo...
   */
  async createPaymentUrl(dto: CreatePaymentDto, userId?: number) {
    const order = await this.prisma.order.findUnique({
      where: { id: dto.orderId },
    });

    if (!order) {
      throw new NotFoundException('Không tìm thấy đơn hàng');
    }

    // Chỉ cho phép chủ đơn hoặc guest (không có userId)
    if (userId && order.userId !== userId) {
      throw new NotFoundException('Không tìm thấy đơn hàng');
    }

    if (order.paymentStatus === 'PAID') {
      throw new BadRequestException('Đơn hàng đã được thanh toán');
    }

    // Mô phỏng tạo transaction ID
    const transactionId = `TXN${Date.now()}${randomBytes(3).toString('hex').toUpperCase()}`;

    // Trong thực tế: gọi API cổng thanh toán và nhận về paymentUrl
    // Ở đây mình mô phỏng
    const paymentUrl = `https://sandbox-payment.example.com/pay?orderCode=${order.code}&amount=${order.totalAmount}&txnId=${transactionId}&returnUrl=${dto.returnUrl || 'http://localhost:3000/payment/result'}`;

    // Có thể lưu transactionId vào order nếu muốn (cần thêm field)
    return {
      orderId: order.id,
      orderCode: order.code,
      amount: order.totalAmount,
      transactionId,
      paymentUrl,
      message: 'Tạo link thanh toán thành công (mô phỏng)',
    };
  }

/**
 * Tạo URL thanh toán VNPay
 */
createVNPayUrl(order: { code: string; totalAmount: any }, ipAddr: string) {
  const tmnCode = process.env.VNP_TMN_CODE!;
  const secretKey = process.env.VNP_HASH_SECRET!;
  const returnUrl = process.env.VNP_RETURN_URL!;
  const vnpUrl = process.env.VNP_URL!;

  const date = new Date();
  const createDate = this.formatDate(date);
  const amount = Math.round(Number(order.totalAmount) * 100); // VNPay tính theo xu

  let vnpParams: Record<string, string | number> = {
    vnp_Version: '2.1.0',
    vnp_Command: 'pay',
    vnp_TmnCode: tmnCode,
    vnp_Locale: 'vn',
    vnp_CurrCode: 'VND',
    vnp_TxnRef: order.code,
    vnp_OrderInfo: `Thanh toan don hang ${order.code}`,
    vnp_OrderType: 'other',
    vnp_Amount: amount,
    vnp_ReturnUrl: returnUrl,
    vnp_IpAddr: ipAddr,
    vnp_CreateDate: createDate,
  };

  vnpParams = this.sortObject(vnpParams);
  const signData = qs.stringify(vnpParams, { encode: false });
  const hmac = crypto.createHmac('sha512', secretKey);
  const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');
  vnpParams['vnp_SecureHash'] = signed;

  return vnpUrl + '?' + qs.stringify(vnpParams, { encode: false });
}

/**
 * Verify và xử lý kết quả trả về từ VNPay
 */
async verifyVNPayReturn(query: Record<string, string>) {
  const secretKey = process.env.VNP_HASH_SECRET!;
  const secureHash = query['vnp_SecureHash'];

  // Tạo bản copy để sort và ký lại
  const vnpParams = { ...query };
  delete vnpParams['vnp_SecureHash'];
  delete vnpParams['vnp_SecureHashType'];

  const sorted = this.sortObject(vnpParams);
  const signData = qs.stringify(sorted, { encode: false });
  const hmac = crypto.createHmac('sha512', secretKey);
  const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');

  // 1. Kiểm tra chữ ký
  if (secureHash !== signed) {
    return {
      success: false,
      message: 'Chữ ký không hợp lệ',
      code: 'INVALID_SIGNATURE',
    };
  }

  const orderCode = query['vnp_TxnRef'];
  const responseCode = query['vnp_ResponseCode'];
  const amount = Number(query['vnp_Amount']) / 100;
  const transactionNo = query['vnp_TransactionNo'];

  const order = await this.prisma.order.findUnique({
    where: { code: orderCode },
  });

  if (!order) {
    return {
      success: false,
      message: 'Không tìm thấy đơn hàng',
      code: 'ORDER_NOT_FOUND',
    };
  }

  // 2. Kiểm tra số tiền
  if (Number(order.totalAmount) !== amount) {
    return {
      success: false,
      message: 'Số tiền không khớp',
      code: 'INVALID_AMOUNT',
    };
  }

  // 3. Đã thanh toán rồi thì thôi
  if (order.paymentStatus === 'PAID') {
    return {
      success: true,
      message: 'Đơn hàng đã được thanh toán trước đó',
      orderCode,
      code: 'ALREADY_PAID',
    };
  }

  // 4. ResponseCode = 00 → thành công
  if (responseCode === '00') {
    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        paymentStatus: 'PAID',
        status: 'CONFIRMED',
        paymentMethod: 'VNPAY',
      },
    });

    // Gửi notification realtime
    this.eventsGateway.notifyOrderPaid(order);

    return {
      success: true,
      message: 'Thanh toán thành công',
      orderCode,
      transactionNo,
      code: 'SUCCESS',
    };
  }

  // Thất bại
  await this.prisma.order.update({
    where: { id: order.id },
    data: { paymentStatus: 'FAILED' },
  });

  return {
    success: false,
    message: 'Thanh toán thất bại',
    orderCode,
    responseCode,
    code: 'FAILED',
  };
}

private sortObject(obj: Record<string, any>) {
  const sorted: Record<string, any> = {};
  Object.keys(obj)
    .sort()
    .forEach((key) => {
      sorted[key] = obj[key];
    });
  return sorted;
}

private formatDate(date: Date) {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    date.getFullYear().toString() +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  );
}

// ===== MoMo =====
async createMoMoUrl(order: { code: string; totalAmount: any }) {
  const partnerCode = process.env.MOMO_PARTNER_CODE;
  const accessKey = process.env.MOMO_ACCESS_KEY;
  const secretKey = process.env.MOMO_SECRET_KEY;
  const requestId = order.code + '_' + Date.now();
  const orderId = order.code;
  const orderInfo = `Thanh toan don hang ${order.code}`;
  const amount = String(Number(order.totalAmount));
  const redirectUrl = process.env.MOMO_RETURN_URL || 'http://localhost:3000/payments/momo-return';
  const ipnUrl = process.env.MOMO_IPN_URL || 'http://localhost:3000/payments/momo-ipn';
  const requestType = 'captureWallet';
  const extraData = '';

  const rawSignature = `accessKey=${accessKey}&amount=${amount}&extraData=${extraData}&ipnUrl=${ipnUrl}&orderId=${orderId}&orderInfo=${orderInfo}&partnerCode=${partnerCode}&redirectUrl=${redirectUrl}&requestId=${requestId}&requestType=${requestType}`;
  const signature = crypto.createHmac('sha256', secretKey || '').update(rawSignature).digest('hex');

  const body = {
    partnerCode,
    accessKey,
    requestId,
    amount,
    orderId,
    orderInfo,
    redirectUrl,
    ipnUrl,
    extraData,
    requestType,
    signature,
    lang: 'vi',
  };

  const response = await fetch(process.env.MOMO_ENDPOINT || '', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const result = await response.json();
  return result.payUrl;
}

  /**
 * Xử lý Webhook từ SePay khi có tiền vào
 */
async handleSePayWebhook(payload: any, signature?: string, rawBody?: string) {
  // 1. (Khuyến nghị) Verify chữ ký nếu dùng HMAC
  // if (signature && rawBody) {
  //   const expected = createHmac('sha256', process.env.SEPAY_WEBHOOK_SECRET)
  //     .update(rawBody)
  //     .digest('hex');
  //   // so sánh an toàn...
  // }

  const {
    id: transactionId,
    transferType,
    transferAmount,
    content,
    referenceCode,
    transactionDate,
  } = payload;

  // Chỉ xử lý tiền vào
  if (transferType !== 'in') {
    return { success: true, message: 'Bỏ qua giao dịch tiền ra' };
  }

  // Tìm mã đơn hàng trong nội dung chuyển khoản
  // Ví dụ nội dung: "DH20241014ABC123 thanh toan don hang", "HD91836883"
  const orderCodeMatch = content?.match(/(ORD[A-Z0-9]+)/i) || content?.match(/(DH[A-Z0-9]+)/i) || content?.match(/(HD[A-Z0-9]+)/i);

  if (!orderCodeMatch) {
    return { success: true, message: 'Không tìm thấy mã đơn hàng trong nội dung' };
  }

  const orderCode = orderCodeMatch[1].toUpperCase();

  const order = await this.prisma.order.findUnique({
    where: { code: orderCode },
  });

  if (!order) {
    return { success: true, message: `Không tìm thấy đơn hàng ${orderCode}` };
  }

  if (order.paymentStatus === 'PAID') {
    return { success: true, message: 'Đơn hàng đã được thanh toán trước đó' };
  }

  // Kiểm tra số tiền (cho phép sai số nhỏ nếu cần)
  const amount = Number(transferAmount);
  if (amount < Number(order.totalAmount)) {
    // Có thể ghi log thanh toán thiếu
    return { success: true, message: 'Số tiền chuyển khoản chưa đủ' };
  }

  // Cập nhật đơn hàng
  await this.prisma.order.update({
    where: { id: order.id },
    data: {
      paymentStatus: 'PAID',
      status: 'CONFIRMED',
      paymentMethod: 'BANK_TRANSFER',
      // Có thể thêm field sepayTransactionId nếu muốn
    },
  });

  // Gửi thông báo realtime
  this.eventsGateway.notifyOrderPaid(order);
  if (order.userId) {
    // Nếu có userId, gửi notification cho user
    this.eventsGateway.sendToUser(order.userId, 'orderPaid', { orderCode });
  } else {
    // Nếu không có userId (khách vãng lai), broadcast cho admin
    this.eventsGateway.sendToAdmins('orderPaid', { orderCode, isGuest: true });
  }

  return {
    success: true,
    message: `Đã xác nhận thanh toán đơn hàng ${orderCode}`,
  };
}

/**
 * Tạo thông tin chuyển khoản để hiển thị cho khách
 */
getBankTransferInfo(order: { code: string; totalAmount: any }) {
  return {
    bankAccount: process.env.SEPAY_BANK_ACCOUNT,
    accountName: process.env.SEPAY_ACCOUNT_NAME,
    amount: Number(order.totalAmount),
    content: order.code,           // Bắt buộc khách chuyển đúng nội dung này
    qrUrl: `https://img.vietqr.io/image/${process.env.SEPAY_BANK_ACCOUNT}-${order.totalAmount}-${order.code}.png`, // VietQR
  };
}
  /**
   * Callback từ cổng thanh toán (IPN / Return URL)
   * Frontend hoặc cổng thanh toán sẽ gọi API này
   */
  async handlePaymentCallback(query: {
    orderCode: string;
    txnId: string;
    status: 'success' | 'failed';
    amount?: string;
  }) {
    const order = await this.prisma.order.findUnique({
      where: { code: query.orderCode },
    });

    if (!order) {
      throw new NotFoundException('Không tìm thấy đơn hàng');
    }

    if (order.paymentStatus === 'PAID') {
      return { message: 'Đơn hàng đã được xử lý trước đó' };
    }

    if (query.status === 'success') {
      // Kiểm tra số tiền (trong thực tế rất quan trọng)
      // if (Number(query.amount) !== Number(order.totalAmount)) { ... }

      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: 'PAID',
          status: 'CONFIRMED',
          paymentMethod: 'BANK_TRANSFER', // hoặc VNPAY / MOMO...
        },
      });

      return {
        message: 'Thanh toán thành công',
        orderCode: order.code,
        status: 'PAID',
      };
    }

    // Thanh toán thất bại
    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        paymentStatus: 'FAILED',
      },
    });

    return {
      message: 'Thanh toán thất bại',
      orderCode: order.code,
      status: 'FAILED',
    };
  }

  /**
   * Lấy trạng thái thanh toán của đơn hàng
   */
  async getPaymentStatus(orderId: number, userId?: number) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        code: true,
        totalAmount: true,
        paymentMethod: true,
        paymentStatus: true,
        status: true,
        userId: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Không tìm thấy đơn hàng');
    }

    if (userId && order.userId !== userId) {
      throw new NotFoundException('Không tìm thấy đơn hàng');
    }

    return order;
  }
}