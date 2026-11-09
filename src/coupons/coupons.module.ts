import { Module } from '@nestjs/common';
import { CouponsController } from './coupons.controller.js';
import { CouponsService } from './coupons.service.js';
import { ShippingService } from './shipping.service.js';

@Module({
  controllers: [CouponsController],
  providers: [CouponsService, ShippingService],
  exports: [CouponsService, ShippingService],
})
export class CouponsModule {}
