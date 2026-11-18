import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { EventsModule } from '../events/events.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { SepayGatewayService } from './sepay/sepay-gateway.service.js';
import { SepayPaymentsService } from './sepay/sepay-payments.service.js';
import { SepayPaymentsController } from './sepay/sepay-payments.controller.js';
import { SepayAdminController } from './sepay/sepay-admin.controller.js';
import { SepayReconcileService } from './sepay/sepay-reconcile.service.js';
import { SepayOrderExpiryService } from './sepay/sepay-order-expiry.service.js';
import { MailModule } from '../mail/mail.module.js';
import { ThrottlerModule } from '@nestjs/throttler';
import { SepayAdminService } from './sepay/sepay-admin.service.js';

@Module({
  imports: [EventsModule, NotificationsModule, MailModule, ThrottlerModule.forRoot([{ ttl: 60_000, limit: 30 }])],   // ttl tính bằng mili giây (từ @nestjs/throttler v5)
  controllers: [PaymentsController, SepayPaymentsController, SepayAdminController],
  providers: [PaymentsService, SepayGatewayService, SepayPaymentsService, SepayReconcileService, SepayOrderExpiryService, SepayAdminService],
  exports: [PaymentsService],
})
export class PaymentsModule { }
