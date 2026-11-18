import { Body, Controller, Get, Headers, Param, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import type { Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Public } from '../../shared/decorators/public.decorator.js';
import { SepayPaymentsService, type SepayIpnPayload } from './sepay-payments.service.js';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

class SepayCheckoutDto extends createZodDto(
    z.object({
        orderId: z.number().int().positive(),
        paymentMethod: z.enum(['BANK_TRANSFER', 'NAPAS_BANK_TRANSFER']).optional(),
    }),
) { }

@ApiTags('Payments')
@Controller('payments/sepay')
export class SepayPaymentsController {
    constructor(
        private readonly service: SepayPaymentsService,
        private readonly config: ConfigService,
    ) { }

    @Public() // token (nếu có) vẫn được đọc nên req.user có khi khách đã đăng nhập
    @UseGuards(ThrottlerGuard)
    @Throttle({ default: { limit: 5, ttl: 60_000 } })      // tối đa 5 lần bấm thanh toán mỗi phút / IP
    @Post('checkout')
    checkout(@Body() dto: SepayCheckoutDto, @Req() req: any) {
        return this.service.createCheckout(dto.orderId, req.user?.id, dto.paymentMethod);
    }

    @Public()
    @UseGuards(ThrottlerGuard)
    @Throttle({ default: { limit: 60, ttl: 60_000 } })     // trang kết quả hỏi mỗi 2 giây ≈ 30 lần/phút
    @Get(':invoice/status')
    status(@Param('invoice') invoice: string) {
        return this.service.getStatus(invoice);
    }

    @Public() // SePay gọi vào, không có JWT; tự xác thực bằng X-Secret-Key
    @UseGuards(ThrottlerGuard)
    @Throttle({ default: { limit: 100, ttl: 60_000 } }) // 100 lần/phút để tránh spam webhook
    @Post('ipn')
    async ipn(
        @Headers('x-secret-key') secret: string | undefined,
        @Body() body: SepayIpnPayload,
        @Res({ passthrough: true }) res: Response, // passthrough để ClassSerializerInterceptor không serialize Response object
    ) {
        const expected = Buffer.from(this.config.getOrThrow<string>('SEPAY_IPN_SECRET'));
        const got = Buffer.from(secret ?? '');
        if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
            throw new UnauthorizedException();
        }
        await this.service.handleIpn(body);
        return { success: true };
    }
}