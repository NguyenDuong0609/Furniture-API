import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Delete,
} from '@nestjs/common';
import { OrdersService } from './orders.service.js';
import { CreateOrderDto } from './dto/create-order.dto.js';
import { GetOrdersDto } from './dto/get-orders.dto.js';
import { Public } from '../shared/decorators/public.decorator.js';
import { ActiveUser } from '../shared/decorators/active-user.decorator.js';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

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
}