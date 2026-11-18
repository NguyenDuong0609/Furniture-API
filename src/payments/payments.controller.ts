import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  Headers,
  Req,
  BadRequestException,
  UseGuards,
  HttpCode,
  UnauthorizedException,
} from '@nestjs/common';
import { PaymentsService } from './payments.service.js';
import type { SepayIpnPayload } from './payments.service.js';
import { CreatePaymentDto } from './dto/create-payment.dto.js';
import { ConfirmCodDto } from './dto/confirm-cod.dto.js';
import { Public } from '../shared/decorators/public.decorator.js';
import { ActiveUser } from '../shared/decorators/active-user.decorator.js';
import { SkipThrottle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService, private config: ConfigService) { }

  // @UseGuards(JwtAuthGuard)             // dùng guard JWT sẵn có của bạn
  @Public()
  @Post('checkout')
  checkout(@Req() req: any, @Body() body: { orderId: number; paymentMethod?: any }) {
    return this.paymentsService.createCheckout(req.user?.id, body.orderId, body.paymentMethod);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':invoice/status')
  status(@Req() req: any, @Param('invoice') invoice: string) {
    return this.paymentsService.getStatus(req.user.id, invoice);
  }

  @Public()                            // nếu có global guard thì phải bỏ qua endpoint này
  @Post('ipn')
  @HttpCode(200)
  async ipn(@Headers('x-secret-key') secret: string, @Body() body: SepayIpnPayload) {
    const expected = Buffer.from(this.config.getOrThrow('SEPAY_IPN_SECRET'));
    const got = Buffer.from(secret ?? '');
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
      throw new UnauthorizedException();
    }
    await this.paymentsService.handleIpn(body);
    return { success: true };
  }

  /** Admin xác nhận COD đã thu tiền */
  @Post('confirm-cod')
  confirmCod(@Body() dto: ConfirmCodDto) {
    return this.paymentsService.confirmCod(dto.orderId);
  }

  /** Tạo link thanh toán online (mô phỏng) */
  @Public()
  @Post('create')
  createPayment(
    @Body() dto: CreatePaymentDto,
    @ActiveUser('id') userId?: number,
  ) {
    return this.paymentsService.createPaymentUrl(dto, userId);
  }

  /** VNPay return URL */
  @Public()
  @Get('vnpay-return')
  async vnpayReturn(@Query() query: Record<string, string>) {
    return this.paymentsService.verifyVNPayReturn(query);
  }

  /** Tạo URL thanh toán VNPay */
  @Public()
  @Post('create-vnpay')
  async createVNPay(
    @Body('orderId') orderId: number,
    @Req() req: any,
    @ActiveUser('id') userId?: number,
  ) {
    const order = await this.paymentsService.getPaymentStatus(orderId, userId);
    const ipAddr =
      req.headers['x-forwarded-for'] ||
      req.connection?.remoteAddress ||
      '127.0.0.1';
    const paymentUrl = this.paymentsService.createVNPayUrl(order, ipAddr);
    return { paymentUrl };
  }

  /** SePay webhook — nhận callback khi có tiền vào */
  @Public()
  @SkipThrottle()
  @Post('sepay-webhook')
  async sepayWebhook(
    @Body() payload: any,
    @Headers() headers: Record<string, string>,
    @Req() req: any,
  ) {
    const rawBody = req.rawBody?.toString?.() || JSON.stringify(payload);
    return this.paymentsService.handleSePayWebhook(payload, headers, rawBody);
  }

  /**
   * CHỈ DÙNG KHI TEST – giả lập SePay chuyển khoản thành công
   * POST /payments/simulate-sepay
   * body: { "orderId": 1, "success": true }
   * body: { "orderId": 1, "amount": 1000 }  → thiếu tiền
   */
  @Public()
  @Post('simulate-sepay')
  async simulateSePay(
    @Body() body: { orderId: number; success?: boolean; amount?: number },
  ) {
    if (process.env.NODE_ENV === 'production') {
      throw new BadRequestException('Simulate chỉ dùng ở môi trường dev/test');
    }
    return this.paymentsService.simulateSePayPayment(body.orderId, {
      success: body.success,
      amount: body.amount,
    });
  }

  /** Lấy thông tin chuyển khoản (QR + số tài khoản) */
  @Public()
  @Get('bank-transfer/:orderId')
  async getBankTransferInfo(
    @Param('orderId') orderId: string,
    @ActiveUser('id') userId?: number,
  ) {
    const order = await this.paymentsService.getPaymentStatus(+orderId, userId);
    return this.paymentsService.getBankTransferInfo(order);
  }

  /** Callback từ cổng thanh toán (IPN / Return URL) */
  @Public()
  @Get('callback')
  handleCallback(
    @Query('orderCode') orderCode: string,
    @Query('txnId') txnId: string,
    @Query('status') status: 'success' | 'failed',
    @Query('amount') amount?: string,
  ) {
    return this.paymentsService.handlePaymentCallback({
      orderCode,
      txnId,
      status,
      amount,
    });
  }

  /** Kiểm tra trạng thái thanh toán */
  @Public()
  @Get('status/:orderId')
  getStatus(
    @Param('orderId') orderId: string,
    @ActiveUser('id') userId?: number,
  ) {
    return this.paymentsService.getPaymentStatus(+orderId, userId);
  }
}
