import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Delete,
  Patch,
  UseGuards,
  Res,
} from '@nestjs/common';
import { OrdersService } from './orders.service.js';
import { CreateOrderDto } from './dto/create-order.dto.js';
import { GetOrdersDto } from './dto/get-orders.dto.js';
import { Public } from '../shared/decorators/public.decorator.js';
import { ActiveUser } from '../shared/decorators/active-user.decorator.js';
import { PermissionsGuard } from '../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../shared/decorators/permissions.decorator.js';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) { }

  /**
   * Tạo đơn hàng (Checkout)
   * - User đã login: không cần sessionId
   * - Guest: bắt buộc sessionId
   */
  @Public()
  @Post()
  create(
    @Body() dto: CreateOrderDto,
    @ActiveUser('id') userId?: number,
  ) {
    return this.ordersService.create(dto, userId);
  }

  /**
   * Lấy danh sách đơn hàng của tôi
   */
  @Get()
  findAll(
    @ActiveUser('id') userId: number,
    @Query() query: GetOrdersDto,
  ) {
    return this.ordersService.findAllByUser(userId, query);
  }

  /**
   * Chi tiết đơn hàng
   */
  @Get(':id')
  findOne(
    @Param('id') id: string,
    @ActiveUser('id') userId: number,
  ) {
    return this.ordersService.findOne(+id, userId);
  }

  /**
   * Hủy đơn hàng
   */
  @Delete(':id')
  cancel(
    @Param('id') id: string,
    @ActiveUser('id') userId: number,
  ) {
    return this.ordersService.cancel(+id, userId);
  }

  @Patch(':id/status')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('order:update')
  updateStatus(@Param('id') id: string, @Body('status') status: string) {
    return this.ordersService.updateStatus(+id, status);
  }

  @Get('admin/dashboard')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('order:read')
  dashboard() {
    return this.ordersService.getDashboardStats();
  }

  @Get('admin/all')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('order:read')
  findAllAdmin(@Query() query: any) {
    return this.ordersService.findAllAdmin(query);
  }

  @Get('admin/reports/revenue')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('order:read')
  revenue(@Query() q: { from?: string; to?: string }) {
    return this.ordersService.revenueReport(q.from, q.to);
  }

  @Get('admin/reports/top-products')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('order:read')
  topProducts(@Query('limit') limit?: string) {
    return this.ordersService.topProducts(limit ? +limit : 10);
  }

  @Patch('admin/:id/status')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('order:update')
  updateStatusAdmin(
    @Param('id') id: string,
    @Body() body: { status: string; note?: string },
    @ActiveUser('id') adminId: number,
  ) {
    return this.ordersService.updateStatus(+id, body.status, adminId, body.note);
  }

  @Get('admin/export')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('order:read')
  async export(@Query() query: any, @Res() res: any) {
    const csv = await this.ordersService.exportOrders(query);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=orders.csv');
    res.send(csv);
  }
}