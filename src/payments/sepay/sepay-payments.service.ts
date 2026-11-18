import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EventsGateway } from '../../events/events.gateway.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { SepayGatewayService, type SepayMethod } from './sepay-gateway.service.js';
import { MailOutboxService } from '../../mail/mail-outbox.service.js';

export interface SepayIpnPayload {
    timestamp: number;
    notification_type: 'ORDER_PAID' | 'TRANSACTION_VOID';
    order: {
        id: string; order_id: string; order_status: string;
        order_amount: string; order_invoice_number: string;[k: string]: any;
    };
    transaction: {
        transaction_id: string; payment_method: string;
        transaction_status: string; transaction_amount: string;[k: string]: any;
    };
    customer?: any;
}

type TxOutcome =
    | { kind: 'PAID'; order: any }
    | { kind: 'REVIEW'; order: any; reason: string; paymentId: number }
    | null;

type PaymentWithOrder = Prisma.PaymentGetPayload<{ include: { order: true } }>;

type PaidInfo = {
    amount: string | number;
    method?: string;
    sepayOrderId?: string;
    sepayTransactionId?: string;
    force?: boolean;   // admin chấp nhận: bỏ qua so sánh số tiền
};

@Injectable()
export class SepayPaymentsService {
    private readonly logger = new Logger(SepayPaymentsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly gateway: SepayGatewayService,
        private readonly config: ConfigService,
        private readonly eventsGateway: EventsGateway,
        private readonly notificationsService: NotificationsService,
        private readonly mailOutbox: MailOutboxService,
    ) { }

    async createCheckout(orderId: number, userId?: number, method?: SepayMethod) {
        const order = await this.prisma.order.findUnique({ where: { id: orderId } });
        // đơn của user nào thì chỉ user đó thanh toán; đơn guest (userId null) thì ai cũng được
        if (!order || (order.userId && order.userId !== userId)) {
            throw new NotFoundException('Không tìm thấy đơn hàng');
        }
        if (order.paymentStatus === 'PAID') throw new BadRequestException('Đơn hàng đã được thanh toán');
        if (order.status === 'CANCELLED') throw new BadRequestException('Đơn hàng đã bị hủy');

        const pending = await this.prisma.payment.count({ where: { orderId: order.id, status: 'PENDING' } });
        if (pending >= 10) throw new BadRequestException('Quá nhiều lần thử thanh toán, vui lòng thử lại sau');

        // mỗi lần bấm thanh toán = 1 invoice mới, có đuôi ngẫu nhiên nên không đoán được
        const invoiceNumber = `${order.code}-${randomBytes(4).toString('hex').toUpperCase()}`;
        const payment = await this.prisma.payment.create({
            data: { orderId: order.id, invoiceNumber, amount: order.totalAmount },
        });

        const base = this.config.getOrThrow<string>('PAYMENT_PAGES_URL');
        const q = `?invoice=${encodeURIComponent(invoiceNumber)}`;

        return this.gateway.buildCheckout({
            invoiceNumber,
            amount: Math.round(Number(payment.amount)),
            description: `Thanh toan don hang ${order.code}`,
            successUrl: `${base}/payment-success.html${q}`,
            errorUrl: `${base}/payment-error.html${q}`,
            cancelUrl: `${base}/payment-cancel.html${q}`,
            paymentMethod: method,
        });
    }

    // Public: invoiceNumber có đuôi ngẫu nhiên đóng vai trò token; chỉ trả trạng thái, không trả dữ liệu cá nhân
    async getStatus(invoiceNumber: string) {
        const payment = await this.prisma.payment.findUnique({
            where: { invoiceNumber },
            include: { order: { select: { id: true, code: true, status: true, paymentStatus: true } } },
        });
        if (!payment) throw new NotFoundException();
        return {
            payment: payment.status,
            orderId: payment.order.id,
            orderCode: payment.order.code,
            orderStatus: payment.order.status,
            orderPaymentStatus: payment.order.paymentStatus,
            amount: Number(payment.amount),
            currency: payment.currency,
            method: payment.method,
            paidAt: payment.paidAt,
        };
    }

    async handleIpn(p: SepayIpnPayload): Promise<void> {
        const invoice = p.order?.order_invoice_number;
        const eventKey = `${p.notification_type}:${p.transaction?.transaction_id ?? p.order?.order_id}`;

        let outcome: TxOutcome = null;
        try {
            outcome = await this.prisma.$transaction(async (tx): Promise<TxOutcome> => {
                const payment = await tx.payment.findUnique({
                    where: { invoiceNumber: invoice },
                    include: { order: true },
                });

                // Ghi event TRƯỚC: eventKey unique nên IPN trùng gửi cùng lúc bị chặn ở đây (lỗi P2002)
                const event = await tx.paymentEvent.create({
                    data: {
                        eventKey,
                        invoiceNumber: invoice,
                        paymentId: payment?.id,
                        notificationType: p.notification_type,
                        payload: p as unknown as Prisma.InputJsonValue,
                    },
                });
                const done = (result: string) =>
                    tx.paymentEvent.update({ where: { id: event.id }, data: { result } });

                if (!payment) { await done('UNMATCHED'); return null; }
                const order = payment.order;

                // if (p.notification_type === 'ORDER_PAID') {
                //     if (payment.status === 'PAID') { await done('IGNORED'); return null; }

                //     const review = async (reason: string): Promise<TxOutcome> => {
                //         await tx.payment.update({ where: { id: payment.id }, data: { status: 'REVIEW' } });
                //         await done(reason);
                //         return { kind: 'REVIEW', order, reason };
                //     };

                //     if (!new Prisma.Decimal(p.order.order_amount).equals(payment.amount)) return review('AMOUNT_MISMATCH');
                //     if (order.paymentStatus === 'PAID') return review('DUPLICATE_PAYMENT');
                //     if (order.status === 'CANCELLED') return review('ORDER_CANCELLED');

                //     await tx.payment.update({
                //         where: { id: payment.id },
                //         data: {
                //             status: 'PAID',
                //             paidAt: new Date(),
                //             method: p.transaction.payment_method,
                //             sepayOrderId: p.order.order_id,
                //             sepayTransactionId: p.transaction.transaction_id,
                //         },
                //     });

                //     const confirm = order.status === 'PENDING';
                //     const updated = await tx.order.update({
                //         where: { id: order.id },
                //         data: {
                //             paymentStatus: 'PAID',
                //             paymentMethod: `SEPAY_${p.transaction.payment_method}`,
                //             paymentTransactionId: p.transaction.transaction_id,
                //             paymentRawData: p as unknown as Prisma.InputJsonValue,
                //             ...(confirm && { status: 'CONFIRMED' }),
                //         },
                //     });
                //     if (confirm) {
                //         await tx.orderStatusHistory.create({
                //             data: { orderId: order.id, status: 'CONFIRMED', note: 'Đã thanh toán qua cổng SePay' },
                //         });
                //     }
                //     await done('PROCESSED');
                //     return { kind: 'PAID', order: updated };
                // }

                if (p.notification_type === 'ORDER_PAID') {
                    const r = await this.markPaid(tx, payment, {
                        amount: p.order.order_amount,
                        method: p.transaction.payment_method,
                        sepayOrderId: p.order.order_id,
                        sepayTransactionId: p.transaction.transaction_id,
                    });
                    await tx.order.update({   // lưu payload gốc để debug, như trước
                        where: { id: payment.orderId },
                        data: { paymentRawData: p as unknown as Prisma.InputJsonValue },
                    }).catch(() => undefined);
                    await done(r.result);
                    return r.outcome;
                }

                if (p.notification_type === 'TRANSACTION_VOID') {
                    await tx.payment.update({ where: { id: payment.id }, data: { status: 'VOIDED' } });
                    if (order.paymentTransactionId === p.transaction.transaction_id) {
                        await tx.order.update({ where: { id: order.id }, data: { paymentStatus: 'REFUNDED' } });
                    }
                    await done('PROCESSED');
                    return null;
                }

                await done('IGNORED');
                return null;
            });
        } catch (e) {
            // IPN trùng đã xử lý: coi như thành công để trả 200
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return;
            throw e;
        }

        // Thông báo SAU khi commit; lỗi thông báo không làm hỏng IPN
        if (outcome) await this.notify(outcome);
    }

    async notify(o: NonNullable<TxOutcome>) {
        const order = o.order;
        try {
            if (o.kind === 'PAID') {
                this.eventsGateway.notifyOrderPaid(order);
                if (order.userId) {
                    await this.notificationsService.create(
                        order.userId, 'ORDER_PAID', 'Thanh toán thành công',
                        `Đơn hàng ${order.code} đã được thanh toán`,
                        { orderId: order.id, orderCode: order.code },
                    );
                }
                await this.notificationsService.createForAdmins(
                    'ORDER_PAID', 'Đơn hàng đã thanh toán',
                    `Đơn ${order.code} – ${Number(order.totalAmount)}đ`,
                    { orderId: order.id, orderCode: order.code },
                );
            } else {
                // await this.notificationsService.createForAdmins(
                //     'SYSTEM', 'Thanh toán cần kiểm tra',
                //     `Đơn ${order.code}: ${o.reason}. Cần đối soát/hoàn tiền thủ công.`,
                //     { orderId: order.id, orderCode: order.code, reason: o.reason },
                // );
                await this.notificationsService.createForAdmins(
                    'SYSTEM', 'Thanh toán cần kiểm tra',
                    `Đơn ${order.code}: ${o.reason}. Cần đối soát/hoàn tiền thủ công.`,
                    { orderId: order.id, orderCode: order.code, reason: o.reason },
                );
                const admins = this.config.get<string>('MAIL_ADMIN_TO');
                if (admins) {
                    await this.mailOutbox.enqueue({
                        dedupeKey: `payment-review:${o.paymentId}:${o.reason}`,
                        to: admins.split(',').map((s) => s.trim()).filter(Boolean),
                        template: 'payment-review',
                        payload: { orderId: order.id, paymentId: o.paymentId, reason: o.reason },
                    });
                }
            }
        } catch (e) {
            this.logger.error(e, 'Notification error');
        }
        this.mailOutbox.kick();   // gửi ngay các mail vừa vào outbox
    }

    // Dùng chung cho IPN và job đối soát
    async markPaid(
        tx: Prisma.TransactionClient,
        payment: PaymentWithOrder,
        info: PaidInfo,
    ): Promise<{ result: string; outcome: TxOutcome }> {
        // khóa dòng order: IPN/đối soát và job hủy đơn quá hạn không được chạy đua với nhau
        await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${payment.orderId} FOR UPDATE`;
        const order = await tx.order.findUniqueOrThrow({ where: { id: payment.orderId } });

        const review = async (reason: string) => {
            await tx.payment.updateMany({
                where: { id: payment.id, status: { not: 'PAID' } },
                data: { status: 'REVIEW' },
            });
            return { result: reason, outcome: { kind: 'REVIEW', order, reason, paymentId: payment.id } as TxOutcome };
        };

        if (payment.status === 'PAID') return { result: 'IGNORED', outcome: null };
        // if (!new Prisma.Decimal(info.amount).equals(payment.amount)) return review('AMOUNT_MISMATCH');
        if (!info.force && !new Prisma.Decimal(info.amount).equals(payment.amount)) return review('AMOUNT_MISMATCH');
        if (order.paymentStatus === 'PAID') return review('DUPLICATE_PAYMENT');
        if (order.status === 'CANCELLED') return review('ORDER_CANCELLED');

        // So sánh-và-gán nguyên tử: nếu IPN và job chạy cùng lúc, chỉ một bên thắng
        const claimed = await tx.payment.updateMany({
            where: { id: payment.id, status: { not: 'PAID' } },
            data: {
                status: 'PAID',
                paidAt: new Date(),
                method: info.method,
                sepayOrderId: info.sepayOrderId,
                sepayTransactionId: info.sepayTransactionId,
            },
        });
        if (claimed.count === 0) return { result: 'IGNORED', outcome: null };

        const confirm = order.status === 'PENDING';
        const updated = await tx.order.update({
            where: { id: order.id },
            data: {
                paymentStatus: 'PAID',
                paymentMethod: `SEPAY_${info.method ?? 'UNKNOWN'}`,
                paymentTransactionId: info.sepayTransactionId,
                ...(confirm && { status: 'CONFIRMED' }),
            },
        });
        if (confirm) {
            await tx.orderStatusHistory.create({
                data: { orderId: order.id, status: 'CONFIRMED', note: 'Đã thanh toán qua cổng SePay' },
            });
        }
        // Email xác nhận: ghi vào outbox trong CÙNG transaction với việc đánh dấu PAID
        const to = await this.mailOutbox.recipientFor(tx, order);
        if (to) {
            await this.mailOutbox.enqueue(
                { dedupeKey: `order-paid:${order.id}`, to, template: 'order-paid', payload: { orderId: order.id, paymentId: payment.id } },
                tx,
            );
        }
        return { result: 'PROCESSED', outcome: { kind: 'PAID', order: updated } };
    }

    async settleFromGateway(paymentId: number, gw: any): Promise<void> {
        let outcome: TxOutcome = null;
        try {
            outcome = await this.prisma.$transaction(async (tx): Promise<TxOutcome> => {
                const payment = await tx.payment.findUnique({
                    where: { id: paymentId },
                    include: { order: true },
                });
                if (!payment) return null;

                // Mình chưa chắc `transactions[].id` có trùng `transaction.transaction_id` của IPN hay không
                const txn =
                    (gw.transactions ?? []).find((t: any) => t.transaction_status === 'APPROVED') ??
                    gw.transactions?.[0];

                const event = await tx.paymentEvent.create({
                    data: {
                        eventKey: `RECONCILE:${payment.invoiceNumber}`,
                        invoiceNumber: payment.invoiceNumber,
                        paymentId: payment.id,
                        notificationType: 'RECONCILE',
                        payload: gw as Prisma.InputJsonValue,
                    },
                });
                const r = await this.markPaid(tx, payment, {
                    amount: gw.order_amount,
                    method: txn?.payment_method,
                    sepayOrderId: gw.order_id,
                    sepayTransactionId: txn?.id,
                });
                await tx.paymentEvent.update({ where: { id: event.id }, data: { result: r.result } });
                return r.outcome;
            });
        } catch (e) {
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return;
            throw e;
        }
        if (outcome) await this.notify(outcome);
    }
}