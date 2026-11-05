import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreatePaymentDto } from './dto/create-payment.dto.js';
import { randomBytes } from 'crypto';
import { EventsGateway } from '../events/events.gateway.js';

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