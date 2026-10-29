import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ORDER_QUEUE, ORDER_JOBS } from './order-queue.constants.js';

@Injectable()
export class OrderQueueService {
  constructor(
    @InjectQueue(ORDER_QUEUE) private readonly orderQueue: Queue,
  ) {}

  async addSendOrderEmailJob(payload: {
    orderId: number;
    orderCode: string;
    email?: string;
    totalAmount: number | string;
  }) {
    await this.orderQueue.add(ORDER_JOBS.SEND_ORDER_EMAIL, payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
    });
  }

  async addNotifyAdminJob(payload: {
    orderId: number;
    orderCode: string;
    totalAmount: number | string;
  }) {
    await this.orderQueue.add(ORDER_JOBS.NOTIFY_ADMIN, payload, {
      attempts: 3,
      removeOnComplete: true,
    });
  }
}