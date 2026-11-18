import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { MailService } from './mail.service.js';
import { MailComposer, PermanentMailError, type TemplateName } from './mail-composer.service.js';

const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [1, 5, 30, 120, 360].map((m) => m * 60_000);   // 1p, 5p, 30p, 2h, 6h
const STUCK_MS = 10 * 60_000;                                       // dòng SENDING quá 10 phút = process đã chết giữa chừng

@Injectable()
export class MailOutboxService {
    private readonly logger = new Logger(MailOutboxService.name);
    private running = false;

    constructor(
        private readonly prisma: PrismaService,
        private readonly mail: MailService,
        private readonly composer: MailComposer,
    ) { }

    // Ghi một mail vào outbox. Truyền `tx` để ghi trong cùng transaction với nghiệp vụ.
    // createMany + skipDuplicates (ON CONFLICT DO NOTHING) nên trùng dedupeKey không làm hỏng transaction.
    async enqueue(
        input: { dedupeKey: string; to: string | string[]; template: TemplateName; payload: Record<string, unknown> },
        client: Prisma.TransactionClient = this.prisma,
    ) {
        const to = Array.isArray(input.to) ? input.to.join(',') : input.to;
        if (!to) return;
        await client.emailOutbox.createMany({
            data: [{ dedupeKey: input.dedupeKey, to, template: input.template, payload: input.payload as Prisma.InputJsonValue }],
            skipDuplicates: true,
        });
    }

    // Email người nhận của một đơn: ưu tiên email khách nhập khi đặt hàng, sau đó là email tài khoản
    async recipientFor(
        client: Prisma.TransactionClient,
        order: { userId: number | null; contactEmail?: string | null },
    ): Promise<string | null> {
        if (order.contactEmail) return order.contactEmail;
        if (!order.userId) return null;
        const u = await client.user.findUnique({ where: { id: order.userId }, select: { email: true } });
        return u?.email ?? null;
    }

    // Gọi sau khi commit để gửi ngay, không phải chờ lượt cron kế tiếp
    kick() {
        setImmediate(() => this.processDue().catch((e) => this.logger.error(e, 'kick failed')));
    }

    @Cron(CronExpression.EVERY_MINUTE)
    async cron() {
        await this.processDue();
    }

    async processDue() {
        if (this.running) return;
        this.running = true;
        try {
            await this.prisma.emailOutbox.updateMany({
                where: { status: 'SENDING', updatedAt: { lt: new Date(Date.now() - STUCK_MS) } },
                data: { status: 'PENDING' },
            });
            const due = await this.prisma.emailOutbox.findMany({
                where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
                orderBy: { id: 'asc' },
                take: 20,
            });
            for (const row of due) await this.sendOne(row);
        } catch (e) {
            this.logger.error(e, 'Outbox run failed');
        } finally {
            this.running = false;
        }
    }

    private async sendOne(row: { id: number; to: string; template: string; payload: Prisma.JsonValue; attempts: number }) {
        // chiếm dòng nguyên tử: nếu có instance khác lấy trước thì bỏ qua
        const claim = await this.prisma.emailOutbox.updateMany({
            where: { id: row.id, status: 'PENDING' },
            data: { status: 'SENDING', attempts: { increment: 1 } },
        });
        if (claim.count === 0) return;

        try {
            const msg = await this.composer.compose(row.template, row.payload);
            const { messageId } = await this.mail.send({ to: row.to, ...msg });
            await this.prisma.emailOutbox.update({
                where: { id: row.id },
                data: { status: 'SENT', sentAt: new Date(), messageId, lastError: null },
            });
        } catch (e: any) {
            const attempts = row.attempts + 1;
            const permanent = e instanceof PermanentMailError;
            const failed = permanent || attempts >= MAX_ATTEMPTS;
            await this.prisma.emailOutbox.update({
                where: { id: row.id },
                data: {
                    status: failed ? 'FAILED' : 'PENDING',
                    lastError: String(e?.message ?? e).slice(0, 500),
                    nextAttemptAt: new Date(Date.now() + BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]),
                },
            });
            if (failed) this.logger.error(`Email #${row.id} (${row.template}) FAILED: ${e?.message}`);
            else this.logger.warn(`Email #${row.id} thử lại lần ${attempts}: ${e?.message}`);
        }
    }
}