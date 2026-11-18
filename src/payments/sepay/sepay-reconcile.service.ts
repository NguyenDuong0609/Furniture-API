import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Payment } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SepayGatewayService } from './sepay-gateway.service.js';
import { SepayPaymentsService } from './sepay-payments.service.js';
import { inspect } from 'util';

const MIN_AGE_MS = 10 * 60 * 1000;      // chỉ kiểm tra payment đã treo quá 10 phút
const RECHECK_MS = 5 * 60 * 1000;       // mỗi payment kiểm tra lại cách nhau tối thiểu 5 phút
const EXPIRE_MS = 24 * 60 * 60 * 1000;  // quá 24 giờ vẫn chưa thanh toán → CANCELLED
const BATCH = 50;

@Injectable()
export class SepayReconcileService {
    private readonly logger = new Logger(SepayReconcileService.name);
    private running = false;

    constructor(
        private readonly prisma: PrismaService,
        private readonly gateway: SepayGatewayService,
        private readonly payments: SepayPaymentsService,
    ) { }

    @Cron('*/5 * * * *')
    async run() {
        if (this.running) return;   // tránh chồng lượt trên cùng một instance
        this.running = true;
        try {
            const now = Date.now();
            const list = await this.prisma.payment.findMany({
                where: {
                    status: 'PENDING',
                    createdAt: { lt: new Date(now - MIN_AGE_MS) },
                    OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: new Date(now - RECHECK_MS) } }],
                },
                orderBy: { createdAt: 'asc' },
                take: BATCH,
            });
            for (const p of list) await this.checkOne(p, now);
        } catch (e) {
            this.logger.error(e, 'Reconcile run failed');
        } finally {
            this.running = false;
        }
    }

    private async checkOne(p: Payment, now: number) {
        let gw: any = null;
        try {
            gw = await this.gateway.retrieveOrder(p.invoiceNumber);
        } catch (e: any) {
            const status = e?.response?.status ?? e?.status ?? e?.code;
            // Extract message safely using inspect to avoid circular reference
            let message = 'Unknown error';
            try {
                message = inspect(e, { depth: 0, maxArrayLength: 10 });
            } catch {
                message = 'Error message could not be extracted';
            }
            // 404: SePay chưa có đơn này (khách chưa mở trang thanh toán), coi như chưa thanh toán.
            // Lỗi khác: có thể do mạng, thử lại ở lượt sau.
            this.logger.log(`[RECONCILE DEBUG] Error retrieving ${p.invoiceNumber}: status=${status}`);
            if (status !== 404) {
                this.logger.warn(`retrieve ${p.invoiceNumber} failed`);
                return;
            }
        }

        const st = gw?.order_status;
        // Log transaction ID để kiểm chứng mapping với IPN
        if (gw?.transactions && gw.transactions.length > 0) {
            this.logger.log(`[RECONCILE DEBUG] ${p.invoiceNumber} transactions: ${JSON.stringify(gw.transactions)}`);
            gw.transactions.forEach((tx: any, idx: number) => {
                this.logger.log(`[RECONCILE DEBUG] Transaction ${idx}: id=${tx.id}, transaction_id=${tx.transaction_id}, payment_method=${tx.payment_method}`);
            });
        }

        if (st === 'CAPTURED') {
            await this.payments.settleFromGateway(p.id, gw);
            this.logger.log(`Reconciled ${p.invoiceNumber}: CAPTURED`);
            return;
        }

        const expired = now - p.createdAt.getTime() > EXPIRE_MS;
        if (st === 'CANCELLED' || expired) {
            await this.prisma.payment.updateMany({
                where: { id: p.id, status: 'PENDING' },
                data: { status: 'CANCELLED', lastCheckedAt: new Date() },
            });
            return;
        }
        await this.prisma.payment.update({
            where: { id: p.id },
            data: { lastCheckedAt: new Date() },
        });
    }
}