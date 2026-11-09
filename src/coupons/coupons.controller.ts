import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CouponsService } from './coupons.service.js';
import { ShippingService } from './shipping.service.js';
import { Public } from '../shared/decorators/public.decorator.js';
import { PermissionsGuard } from '../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../shared/decorators/permissions.decorator.js';

@Controller()
export class CouponsController {
  constructor(
    private readonly couponsService: CouponsService,
    private readonly shippingService: ShippingService,
  ) {}

  // ========== COUPON ==========

  @Public()
  @Post('coupons/validate')
  validate(@Body() body: { code: string; orderAmount: number }) {
    return this.couponsService.validate(body.code, body.orderAmount);
  }

  @Post('admin/coupons')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('product:create')
  create(@Body() body: any) {
    return this.couponsService.create(body);
  }

  @Get('admin/coupons')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('product:read')
  findAll() {
    return this.couponsService.findAll();
  }

  @Patch('admin/coupons/:id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('product:update')
  update(@Param('id') id: string, @Body() body: any) {
    return this.couponsService.update(+id, body);
  }

  @Delete('admin/coupons/:id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('product:delete')
  remove(@Param('id') id: string) {
    return this.couponsService.remove(+id);
  }

  // ========== SHIPPING ==========

  @Public()
  @Post('shipping/calculate')
  calculate(@Body() body: { orderAmount: number }) {
    return this.shippingService.calculate(body.orderAmount);
  }
}
