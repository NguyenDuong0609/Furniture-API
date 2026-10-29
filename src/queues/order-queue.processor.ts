import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ORDER_QUEUE, ORDER_JOBS } from './order-queue.constants.js';

@Processor(ORDER_QUEUE)
export class OrderQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(OrderQueueProcessor.name);

  async process(job: Job): Promise<any> {
    switch (job.name) {
      case ORDER_JOBS.SEND_ORDER_EMAIL:
        return this.handleSendOrderEmail(job.data);

      case ORDER_JOBS.NOTIFY_ADMIN:
        return this.handleNotifyAdmin(job.data);

      default:
        this.logger.warn(`Unknown job: ${job.name}`);
    }
  }

  private async handleSendOrderEmail(data: {
    orderId: number;
    orderCode: string;
    email?: string;
    totalAmount: number | string;
  }) {
    // TODO: tích hợp nodemailer / Resend / SendGrid
    this.logger.log(
      `[EMAIL] Gửi email đơn ${data.orderCode} → ${data.email ?? 'N/A'} | total=${data.totalAmount}`,
    );
  }

  private async handleNotifyAdmin(data: {
    orderId: number;
    orderCode: string;
    totalAmount: number | string;
  }) {
    // TODO: push notification / Slack / Discord
    this.logger.log(
      `[ADMIN] Đơn mới ${data.orderCode} | total=${data.totalAmount}`,
    );
  }
}