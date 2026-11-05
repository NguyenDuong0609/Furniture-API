import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { EventsModule } from '../events/events.module.js';
import { QueuesModule } from '../queues/queues.module.js';
import { PaymentsModule } from '../payments/payments.module.js';

@Module({
  imports: [EventsModule, QueuesModule, PaymentsModule],
  controllers: [OrdersController],
  providers: [OrdersService]
})
export class OrdersModule {}
