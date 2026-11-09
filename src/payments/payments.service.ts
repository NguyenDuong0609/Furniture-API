import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreatePaymentDto } from './dto/create-payment.dto.js';
import { randomBytes } from 'crypto';
import { EventsGateway } from '../events/events.gateway.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import * as crypto from 'crypto';
import * as qs from 'qs';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsGateway: EventsGateway,
    private readonly notificationsService: NotificationsService,
  ) { }

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

      // Lưu notification vào DB
      if (order.userId) {
        await this.notificationsService.create(
          order.userId,
          'ORDER_PAID',
          'Thanh toán thành công',
          `Đơn hàng ${order.code} đã được thanh toán`,
          { orderId: order.id },
        );
      }
      await this.notificationsService.createForAdmins(
        'ORDER_PAID',
        'Đơn hàng đã thanh toán',
        `Đơn hàng ${order.code} đã thanh toán thành công`,
        { orderId: order.id },
      );

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
     * Webhook SePay – xử lý đầy đủ success / fail / thiếu tiền / trùng
     * Mức test tốt → prod chỉ cần đổi SEPAY_* trong .env
     */
  async handleSePayWebhook(
    payload: any,
    headers?: Record<string, string>,
    rawBody?: string,
  ) {
    this.logger.log({ payload }, 'SePay webhook received');

    // 1. Verify — strict chỉ khi bật (dev vẫn simulate được)
    const strict =
      process.env.SEPAY_WEBHOOK_STRICT === 'true' ||
      process.env.NODE_ENV === 'production';

    if (strict) {
      const secret = process.env.SEPAY_WEBHOOK_SECRET;
      const token = process.env.SEPAY_API_TOKEN;
      if (!secret && !token) {
        this.logger.error('SEPAY webhook strict but no secret/token configured');
        return { success: false, message: 'Server misconfigured' };
      }
      const ok = this.verifySePaySignature(payload, headers || {}, rawBody, secret || '');
      if (!ok) {
        return { success: false, message: 'Invalid signature' };
      }
    }
    // dev + SEPAY_WEBHOOK_STRICT=false → bỏ qua verify, vẫn ghi DB bình thường

    const {
      id: transactionId,
      transferType,
      transferAmount,
      content,
      referenceCode,
      transactionDate,
      gateway,
      accountNumber,
    } = payload;

    // 2. Chỉ xử lý tiền vào
    if (transferType && transferType !== 'in') {
      return { success: true, message: 'Ignored outbound transfer' };
    }

    // 3. Tìm mã đơn trong nội dung (ORD... hoặc DH...)
    const orderCode = this.extractOrderCode(content);
    if (!orderCode) {
      this.logger.warn({ content }, 'No order code in transfer content');
      return { success: true, message: 'No order code found' };
    }

    const order = await this.prisma.order.findUnique({
      where: { code: orderCode },
    });

    if (!order) {
      this.logger.warn({ orderCode }, 'Order not found');
      return { success: true, message: `Order ${orderCode} not found` };
    }

    // 4. Idempotent: đã PAID rồi thì không xử lý lại
    if (order.paymentStatus === 'PAID') {
      this.logger.log({ orderCode }, 'Order already paid');
      return {
        success: true,
        message: 'Order already paid',
        orderCode,
        code: 'ALREADY_PAID',
      };
    }

    // 5. Idempotent theo transactionId
    if (transactionId) {
      const existed = await this.prisma.order.findFirst({
        where: { paymentTransactionId: String(transactionId) },
      });
      if (existed) {
        return {
          success: true,
          message: 'Transaction already processed',
          orderCode: existed.code,
          code: 'DUPLICATE_TRANSACTION',
        };
      }
    }

    const amount = Number(transferAmount) || 0;
    const orderAmount = Number(order.totalAmount);
    const rawData = {
      transactionId,
      referenceCode,
      transactionDate,
      gateway,
      accountNumber,
      content,
      transferAmount: amount,
      receivedAt: new Date().toISOString(),
    };

    // 6. Đủ tiền → PAID
    if (amount >= orderAmount) {
      const updated = await this.prisma.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: 'PAID',
          status: 'CONFIRMED',
          paymentMethod: 'BANK_TRANSFER',
          paymentTransactionId: transactionId ? String(transactionId) : undefined,
          paymentRawData: rawData,
        },
      });

      // Emit WebSocket realtime
      this.eventsGateway.notifyOrderPaid(order);

      // Notification
      try {
        if (order.userId) {
          await this.notificationsService.create(
            order.userId,
            'ORDER_PAID',
            'Thanh toán thành công',
            `Đơn hàng ${order.code} đã được thanh toán`,
            { orderId: order.id, orderCode: order.code },
          );
        }
        await this.notificationsService.createForAdmins(
          'ORDER_PAID',
          'Đơn hàng đã thanh toán',
          `Đơn ${order.code} – ${amount}đ`,
          { orderId: order.id, orderCode: order.code },
        );
      } catch (e) {
        this.logger.error(e, 'Notification error');
      }

      this.logger.log({ orderCode, amount }, 'Payment SUCCESS');
      return {
        success: true,
        message: 'Payment confirmed',
        orderCode,
        amount,
        code: 'SUCCESS',
        order: updated,
      };
    }

    // 7. Thiếu tiền → ghi FAILED + raw data
    const updated = await this.prisma.order.update({
      where: { id: order.id },
      data: {
        paymentStatus: 'FAILED',
        paymentMethod: 'BANK_TRANSFER',
        paymentTransactionId: transactionId ? String(transactionId) : undefined,
        paymentRawData: {
          ...rawData,
          reason: 'INSUFFICIENT_AMOUNT',
          expected: orderAmount,
          received: amount,
        },
      },
    });

    try {
      if (order.userId) {
        await this.notificationsService.create(
          order.userId,
          'SYSTEM',
          'Thanh toán chưa đủ',
          `Đơn ${order.code}: nhận ${amount}đ / cần ${orderAmount}đ. Vui lòng chuyển bổ sung.`,
          { orderId: order.id, orderCode: order.code },
        );
      }
    } catch (e) {
      this.logger.error(e, 'Notification error');
    }

    this.logger.warn({ orderCode, amount, orderAmount }, 'Payment INSUFFICIENT');
    return {
      success: true, // vẫn trả success cho SePay để không retry vô hạn
      message: 'Insufficient amount – marked FAILED',
      orderCode,
      amount,
      expected: orderAmount,
      code: 'INSUFFICIENT_AMOUNT',
      order: updated,
    };
  }

  /**
   * Simulate webhook (chỉ dùng khi test – không cần SePay thật)
   */
  async simulateSePayPayment(orderId: number, options?: {
    amount?: number;
    success?: boolean;
  }) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');

    const success = options?.success !== false;
    const amount = options?.amount ?? (success ? Number(order.totalAmount) : Number(order.totalAmount) - 1000);

    const fakePayload = {
      id: `SIM-${Date.now()}`,
      transferType: 'in',
      transferAmount: amount,
      content: `${order.code} thanh toan don hang`,
      referenceCode: `FT${Date.now()}`,
      transactionDate: new Date().toISOString(),
      gateway: 'Simulated',
      accountNumber: process.env.SEPAY_BANK_ACCOUNT || '0123456789',
    };

    return this.handleSePayWebhook(fakePayload);
  }

  private extractOrderCode(content?: string): string | null {
    if (!content) return null;
    const match =
      content.match(/(ORD[A-Z0-9]+)/i) ||
      content.match(/(DH[A-Z0-9]+)/i);
    return match ? match[1].toUpperCase() : null;
  }

  private verifySePaySignature(
    payload: any,
    headers: Record<string, string>,
    rawBody: string | undefined,
    secret: string,
  ): boolean {
    // Hỗ trợ API Key header
    const apiKey =
      headers['authorization']?.replace(/^Apikey\s+/i, '') ||
      headers['x-api-key'];
    if (apiKey && apiKey === process.env.SEPAY_API_TOKEN) {
      return true;
    }

    // Hỗ trợ HMAC nếu SePay gửi
    const signature =
      headers['x-sepay-signature'] ||
      headers['x-signature'];
    if (!signature || !rawBody) return !secret; // nếu không có secret thì pass (dev)

    try {
      const expected = crypto.createHmac('sha256', secret)
        .update(rawBody)
        .digest('hex');
      const a = Buffer.from(signature.replace(/^sha256=/i, ''));
      const b = Buffer.from(expected);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  /**
     * Thông tin chuyển khoản hiển thị cho khách
     */
  getBankTransferInfo(order: { code: string; totalAmount: any }) {
    const bankAccount = process.env.SEPAY_BANK_ACCOUNT || '0123456789';
    const accountName = process.env.SEPAY_ACCOUNT_NAME || 'CONG TY NOI THAT';
    const amount = Number(order.totalAmount);

    return {
      bankAccount,
      accountName,
      amount,
      content: order.code, // BẮT BUỘC khách chuyển đúng nội dung này
      qrUrl: `https://img.vietqr.io/image/MB-${bankAccount}-compact2.png?amount=${amount}&addInfo=${order.code}&accountName=${encodeURIComponent(accountName)}`,
      note: 'Vui lòng chuyển đúng số tiền và nội dung để hệ thống tự xác nhận',
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
        paymentTransactionId: true,
        paymentRawData: true,
        status: true,
        userId: true,
        createdAt: true,
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