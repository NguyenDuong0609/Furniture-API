import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PaymentTxStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SepayPaymentsService } from './sepay-payments.service.js';

// Lấy thông tin SePay từ payload IPN hoặc từ dữ liệu đối soát
function pickSepayInfo(payload: any) {
    if (payload?.order && payload?.transaction) {
        return {
            method: payload.transaction.payment_method as string | undefined,
            sepayOrderId: payload.order.order_id as string | undefined,
            sepayTransactionId: payload.transaction.transaction_id as string | undefined,
            reportedAmount: payload.order.order_amount as string | undefined,
        };
    }
    const t = payload?.transactions?.[0];
    return {
        method: t?.payment_method as string | undefined,
        sepayOrderId: payload?.order_id as string | undefined,
        sepayTransactionId: t?.id as string | undefined,
        reportedAmount: payload?.order_amount as string | undefined,
    };
}

@Injectable()
export class SepayAdminService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly payments: SepayPaymentsService,
    ) { }

    async list(status: PaymentTxStatus, page: number, limit: number) {
        const where = { status };
        const [items, total] = await this.prisma.$transaction([
            this.prisma.payment.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * limit,
                take: limit,
                include: {
                    order: {
                        select: { id: true, code: true, status: true, paymentStatus: true, totalAmount: true, shippingName: true, shippingPhone: true },
                    },
                    events: { orderBy: { id: 'desc' }, take: 1, select: { result: true, notificationType: true, receivedAt: true } },
                },
            }),
            this.prisma.payment.count({ where }),
        ]);
        return { items: items.map((p: any) => ({ ...p, reason: p.events[0]?.result ?? null })), total, page, limit };
    }

    async detail(id: number) {
        const payment = await this.prisma.payment.findUnique({
            where: { id },
            include: { order: { include: { items: true } }, events: { orderBy: { id: 'asc' } } },
        });
        if (!payment) throw new NotFoundException('Không tìm thấy giao dịch');
        const last = [...payment.events].reverse().find((e) => ['ORDER_PAID', 'RECONCILE'].includes(e.notificationType));
        return {
            ...payment,
            reason: payment.events.at(-1)?.result ?? null,
            sepayReportedAmount: pickSepayInfo(last?.payload).reportedAmount ?? null,   // để admin so với số tiền của đơn
        };
    }

    async unmatched(page: number, limit: number) {
        const where = { result: 'UNMATCHED' };
        const [items, total] = await this.prisma.$transaction([
            this.prisma.paymentEvent.findMany({
                where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit,
                select: { id: true, invoiceNumber: true, notificationType: true, receivedAt: true, payload: true },
            }),
            this.prisma.paymentEvent.count({ where }),
        ]);
        return { items, total, page, limit };
    }

    async accept(id: number, adminId: number, note?: string) {
        const outcome = await this.prisma.$transaction(async (tx: any) => {
            const payment = await tx.payment.findUnique({ where: { id }, include: { order: true } });
            if (!payment) throw new NotFoundException('Không tìm thấy giao dịch');
            if (payment.status !== 'REVIEW') throw new BadRequestException('Chỉ xử lý được giao dịch đang ở trạng thái REVIEW');

            const ev = await tx.paymentEvent.findFirst({
                where: { paymentId: id, notificationType: { in: ['ORDER_PAID', 'RECONCILE'] } },
                orderBy: { id: 'desc' },
            });
            const sepay = pickSepayInfo(ev?.payload);

            // Dùng chung logic duyệt: markPaid vẫn kiểm tra đơn đã hủy / đã trả bởi khoản khác
            const r = await this.payments.markPaid(tx, payment, {
                amount: payment.amount.toString(),
                method: sepay.method,
                sepayOrderId: sepay.sepayOrderId,
                sepayTransactionId: sepay.sepayTransactionId,
                force: true,
            });
            if (r.result !== 'PROCESSED' || r.outcome?.kind !== 'PAID') {
                throw new BadRequestException(`Không thể chấp nhận (${r.result}). Hãy dùng "đã hoàn tiền".`);
            }

            await tx.paymentEvent.create({
                data: {
                    eventKey: `ADMIN_ACCEPT:${id}:${Date.now()}`,
                    paymentId: id,
                    invoiceNumber: payment.invoiceNumber,
                    notificationType: 'ADMIN_ACCEPT',
                    payload: { adminId, note: note ?? null, previous: ev?.result ?? null } as Prisma.InputJsonValue,
                    result: 'ACCEPTED',
                },
            });
            await tx.orderStatusHistory.create({
                data: {
                    orderId: payment.orderId,
                    status: r.outcome.order.status,
                    note: `Admin chấp nhận thanh toán${note ? ': ' + note : ''}`,
                    changedBy: adminId,
                },
            });
            return r.outcome;
        });

        await this.payments.notify(outcome!);   // thông báo + email xác nhận cho khách
        return { message: 'Đã chấp nhận thanh toán' };
    }

    async markRefunded(id: number, adminId: number, note: string) {
        await this.prisma.$transaction(async (tx: any) => {
            const payment = await tx.payment.findUnique({ where: { id } });
            if (!payment) throw new NotFoundException('Không tìm thấy giao dịch');

            const claimed = await tx.payment.updateMany({ where: { id, status: 'REVIEW' }, data: { status: 'REFUNDED' } });
            if (claimed.count === 0) throw new BadRequestException('Chỉ xử lý được giao dịch đang ở trạng thái REVIEW');

            await tx.paymentEvent.create({
                data: {
                    eventKey: `ADMIN_REFUND:${id}:${Date.now()}`,
                    paymentId: id,
                    invoiceNumber: payment.invoiceNumber,
                    notificationType: 'ADMIN_REFUND',
                    payload: { adminId, note } as Prisma.InputJsonValue,
                    result: 'REFUNDED',
                },
            });
        });
        return { message: 'Đã ghi nhận hoàn tiền' };
    }
}