import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

export interface MailMessage { to: string; subject: string; html: string; text?: string }

@Injectable()
export class MailService implements OnModuleInit {
    private readonly logger = new Logger(MailService.name);
    private readonly enabled: boolean;
    private readonly from: string;
    private readonly transporter: nodemailer.Transporter;

    constructor(config: ConfigService) {
        this.enabled = config.get('MAIL_ENABLED') !== 'false';
        this.from = config.get<string>('MAIL_FROM') ?? 'Furniture Store <no-reply@localhost>';
        const port = Number(config.get('MAIL_PORT') ?? 587);
        const user = config.get<string>('MAIL_USER');
        this.transporter = nodemailer.createTransport({
            host: config.get<string>('MAIL_HOST') ?? 'localhost',
            port,
            secure: port === 465,                    // 465: SSL ngay từ đầu; 587/1025: STARTTLS nếu server hỗ trợ
            auth: user ? { user, pass: config.get<string>('MAIL_PASS') } : undefined,
            connectionTimeout: 10_000,               // đừng để SMTP treo làm kẹt worker
            greetingTimeout: 10_000,
            socketTimeout: 20_000,
        });
    }

    async onModuleInit() {
        if (!this.enabled) return void this.logger.warn('MAIL_ENABLED=false: chỉ ghi log, không gửi mail');
        try {
            await this.transporter.verify();
            this.logger.log('SMTP sẵn sàng');
        } catch (e: any) {
            // chỉ cảnh báo, không chặn app khởi động: mail sẽ nằm trong outbox và gửi lại sau
            this.logger.warn(`Không kết nối được SMTP: ${e?.message}`);
        }
    }

    async send(m: MailMessage): Promise<{ messageId: string }> {
        if (!this.enabled) {
            this.logger.log(`[MAIL TẮT] to=${m.to} subject=${m.subject}`);
            return { messageId: 'disabled' };
        }
        const info = await this.transporter.sendMail({ from: this.from, ...m });
        return { messageId: info.messageId };
    }
}