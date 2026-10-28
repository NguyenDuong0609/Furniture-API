import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreatePaymentDto } from './dto/create-payment.dto.js';
import { randomBytes } from 'crypto';

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

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