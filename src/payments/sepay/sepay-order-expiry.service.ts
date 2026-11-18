import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { SepayGatewayService } from './sepay-gateway.service.js';
import { SepayPaymentsService } from './sepay-payments.service.js';
import { MailOutboxService } from '../../mail/mail-outbox.service.js';

const ACTIVE_PAYMENT_MS = 30 * 60 * 1000;   // có Payment PENDING tạo < 30 phút: khách có thể đang trả
const BATCH = 50;

@Injectable()
export class SepayOrderExpiryService {
    private readonly logger = new Logger(SepayOrderExpiryService.name);
    private running = false;
    private readonly orderTtlMs: number;

    constructor(
        private readonly prisma: PrismaService,
        private readonly gateway: SepayGatewayService,
        private readonly payments: SepayPaymentsService,
        private readonly notificationsService: NotificationsService,
        private readonly mailOutbox: MailOutboxService,
        private readonly config: ConfigService,
    ) {
        this.orderTtlMs = this.config.get<number>('ORDER_TTL_MS') || 60 * 60 * 1000; // mặc định 60 phút
    }

    @Cron('*/1 * * * *') // Test: chạy mỗi phút (dev only). Production: */10 * * * *
    async run() {
        if (this.running) return;
        this.running = true;
        try {
            const now = Date.now();
            const candidates = await this.prisma.order.findMany({
                where: {
                    status: 'PENDING',
                    paymentStatus: 'UNPAID',
                    AND: [{ paymentMethod: { not: null } }, { paymentMethod: { notIn: ['COD'] } }],
                    createdAt: { lt: new Date(now - this.orderTtlMs) },
                    payments: {
                        none: {
                            OR: [
                                { status: { in: ['PAID', 'REVIEW'] } },
                                { status: 'PENDING', createdAt: { gt: new Date(now - ACTIVE_PAYMENT_MS) } },
                            ],
                        },
                    },
                },
                include: { payments: { where: { status: 'PENDING' } } },
                orderBy: { createdAt: 'asc' },
                take: BATCH,
            });

            for (const o of candidates) {
                if (await this.hasLatePayment(o.payments)) continue;
                await this.expire(o.id);
            }
        } catch (e) {
            this.logger.error(e, 'Order expiry run failed');
        } finally {
            this.running = false;
        }
    }

    // true = không được hủy đơn lúc này (đã có tiền về, hoặc chưa chắc chắn được)
    private async hasLatePayment(pending: { id: number; invoiceNumber: string }[]): Promise<boolean> {
        for (const p of pending) {
            try {
                const gw = await this.gateway.retrieveOrder(p.invoiceNumber);
                if (gw?.order_status === 'CAPTURED') {
                    await this.payments.settleFromGateway(p.id, gw);
                    return true;
                }
            } catch (e: any) {
                const status = e?.response?.status ?? e?.status;
                if (status !== 404) {
                    this.logger.warn(`retrieve ${p.invoiceNumber} failed: ${e?.message}`);
                    return true;   // không hỏi được SePay thì chưa hủy, thử lại lượt sau
                }
            }
        }
        return false;
    }

    private async expire(orderId: number) {
        const order = await this.prisma.$transaction(async (tx: any) => {
            await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
            const o = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
            // có thể IPN vừa kịp duyệt đơn trong lúc job đang chạy
            if (!o || o.status !== 'PENDING' || o.paymentStatus !== 'UNPAID') return null;

            for (const item of o.items) {   // hoàn kho giống OrdersService.cancel()
                if (item.variantId) {
                    await tx.productVariant.update({
                        where: { id: item.variantId },
                        data: { stock: { increment: item.quantity } },
                    });
                } else {
                    await tx.product.update({
                        where: { id: item.productId },
                        data: { stock: { increment: item.quantity } },
                    });
                }
            }
            await tx.order.update({ where: { id: orderId }, data: { status: 'CANCELLED' } });
            await tx.orderStatusHistory.create({
                data: { orderId, status: 'CANCELLED', note: 'Tự động hủy: quá hạn thanh toán' },
            });
            const to = await this.mailOutbox.recipientFor(tx, o);
            if (to) {
                await this.mailOutbox.enqueue(
                    { dedupeKey: `order-expired:${orderId}`, to, template: 'order-expired', payload: { orderId } },
                    tx,
                );
            }
            return o;
        });

        if (!order) return;
        this.logger.log(`Expired order ${order.code}`);
        if (order.userId) {
            try {
                await this.notificationsService.create(
                    order.userId, 'ORDER_STATUS', 'Đơn hàng đã bị hủy',
                    `Đơn ${order.code} đã tự động hủy do quá hạn thanh toán`,
                    { orderId: order.id, orderCode: order.code },
                );
            } catch (e) {
                this.logger.error(e, 'Notification error');
            }
        }
        this.mailOutbox.kick();
    }
}