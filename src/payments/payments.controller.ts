import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  Headers,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { PaymentsService } from './payments.service.js';
import { CreatePaymentDto } from './dto/create-payment.dto.js';
import { ConfirmCodDto } from './dto/confirm-cod.dto.js';
import { Public } from '../shared/decorators/public.decorator.js';
import { ActiveUser } from '../shared/decorators/active-user.decorator.js';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * Admin xác nhận COD đã thu tiền
   */
  @Post('confirm-cod')
  confirmCod(@Body() dto: ConfirmCodDto) {
    return this.paymentsService.confirmCod(dto.orderId);
  }

  /**
   * Tạo link thanh toán online (mô phỏng)
   */
  @Public()
  @Post('create')
  createPayment(
    @Body() dto: CreatePaymentDto,
    @ActiveUser('id') userId?: number,
  ) {
    return this.paymentsService.createPaymentUrl(dto, userId);
  }

@Public()
@Get('vnpay-return')
async vnpayReturn(@Query() query: Record<string, string>) {
  return this.paymentsService.verifyVNPayReturn(query);
}

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


@Public()
@Post('create-momo')
createMoMo(@Body('orderId') orderId: number) {
  // lấy order rồi gọi createMoMoUrl
}

@Public()
@Post('momo-ipn')
momoIpn(@Body() body: Record<string, any>) {
  // verify + cập nhật order
}
  
@Public()
@Post('sepay-webhook')
async sepayWebhook(
  @Body() payload: any,
  @Headers('x-sepay-signature') signature?: string,
  // @Req() req: RawBodyRequest<Request>  // nếu cần raw body
) {
  const result = await this.paymentsService.handleSePayWebhook(payload, signature);
  // SePay yêu cầu trả về { success: true }
  return { ...result, success: true };
}

/**
 * Lấy thông tin chuyển khoản của 1 đơn hàng
 */
@Public()
@Get('bank-transfer/:orderId')
async getBankTransferInfo(
  @Param('orderId') orderId: string,
  @ActiveUser('id') userId?: number,
) {
  const order = await this.paymentsService.getPaymentStatus(+orderId, userId);
  return this.paymentsService.getBankTransferInfo(order);
}
  /**
   * Callback từ cổng thanh toán (Return URL / IPN)
   * Ví dụ: /payments/callback?orderCode=ORDxxx&txnId=TXNxxx&status=success
   */
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

  /**
   * Kiểm tra trạng thái thanh toán
   */
  @Public()
  @Get('status/:orderId')
  getStatus(
    @Param('orderId') orderId: string,
    @ActiveUser('id') userId?: number,
  ) {
    return this.paymentsService.getPaymentStatus(+orderId, userId);
  }
}