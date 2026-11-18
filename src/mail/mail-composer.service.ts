import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Brand } from '../templates/layout.js';
import { renderOrderPaid } from '../templates/order-paid.js';
import { renderOrderExpired } from '../templates/order-expired.js';
import { renderPaymentReview } from '../templates/payment-review.js';
import { renderForgotPassword } from '../templates/forgot-password.js';
import { renderVerifyEmail } from '../templates/verify-email.js';

export type TemplateName = 'order-paid' | 'order-expired' | 'payment-review' | 'forgot-password' | 'verify-email';

// Lỗi không thể khắc phục bằng cách gửi lại (thiếu dữ liệu, template lạ)
export class PermanentMailError extends Error { }

@Injectable()
export class MailComposer {
    private readonly brand: Brand;

    constructor(private readonly prisma: PrismaService, config: ConfigService) {
        const orderUrl = config.get<string>('MAIL_ORDER_URL');
        this.brand = {
            name: config.get<string>('MAIL_BRAND_NAME') ?? 'Furniture Store',
            url: config.get<string>('APP_URL'),
            supportEmail: config.get<string>('MAIL_SUPPORT'),
            orderUrl: orderUrl ? (code: string) => orderUrl.replace('{code}', encodeURIComponent(code)) : undefined,
        };
    }

    async compose(template: string, payload: any) {
        switch (template as TemplateName) {
            case 'order-paid': {
                const order = await this.prisma.order.findUnique({ where: { id: payload.orderId }, include: { items: true } });
                const payment = await this.prisma.payment.findUnique({ where: { id: payload.paymentId } });
                if (!order || !payment) throw new PermanentMailError('Order/Payment not found');
                return renderOrderPaid(this.brand, { order, payment });
            }
            case 'order-expired': {
                const order = await this.prisma.order.findUnique({ where: { id: payload.orderId }, include: { items: true } });
                if (!order) throw new PermanentMailError('Order not found');
                return renderOrderExpired(this.brand, { order });
            }
            case 'payment-review': {
                const order = await this.prisma.order.findUnique({ where: { id: payload.orderId }, include: { items: true } });
                const payment = await this.prisma.payment.findUnique({ where: { id: payload.paymentId } });
                if (!order || !payment) throw new PermanentMailError('Order/Payment not found');
                return renderPaymentReview(this.brand, { order, payment, reason: payload.reason });
            }
            case 'forgot-password': {
                return renderForgotPassword(this.brand, payload);
            }
            case 'verify-email': {
                return renderVerifyEmail(this.brand, payload);
            }
            default:
                throw new PermanentMailError(`Unknown template: ${template}`);
        }
    }
}