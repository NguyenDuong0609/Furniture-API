import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ORDER_QUEUE } from './order-queue.constants.js';
import { OrderQueueService } from './order-queue.service.js';
import { OrderQueueProcessor } from './order-queue.processor.js';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
        },
      }),
    }),
    BullModule.registerQueue({
      name: ORDER_QUEUE,
    }),
  ],
  providers: [OrderQueueService, OrderQueueProcessor],
  exports: [OrderQueueService],
})
export class QueuesModule {}