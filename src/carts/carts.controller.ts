import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  Headers,
} from '@nestjs/common';
import { CartsService } from './carts.service.js';
import { AddToCartDto } from './dto/add-to-cart.dto.js';
import { UpdateCartItemDto } from './dto/update-cart-item.dto.js';
import { Public } from '../shared/decorators/public.decorator.js';
import { ActiveUser } from '../shared/decorators/active-user.decorator.js';

@Controller('carts')
export class CartsController {
  constructor(private readonly cartsService: CartsService) {}

  /**
   * Tạo sessionId cho guest (gọi 1 lần khi vào website)
   */
  @Public()
  @Get('session')
  createSession() {
    return {
      sessionId: this.cartsService.generateSessionId(),
    };
  }

  /**
   * Thêm vào giỏ
   */
  @Public()
  @Post('items')
  addToCart(
    @Body() dto: AddToCartDto,
    @ActiveUser('id') userId?: number,
  ) {
    return this.cartsService.addToCart(dto, userId);
  }

  /**
   * Lấy giỏ hàng hiện tại
   * - Nếu đã login: dùng userId
   * - Nếu chưa: truyền sessionId qua query hoặc header
   */
  @Public()
  @Get()
  getCart(
    @ActiveUser('id') userId?: number,
    @Query('sessionId') sessionId?: string,
    @Headers('x-session-id') headerSessionId?: string,
  ) {
    const sid = sessionId || headerSessionId;
    return this.cartsService.getCart(userId, sid);
  }

  /**
   * Cập nhật số lượng
   */
  @Public()
  @Patch('items/:itemId')
  updateItem(
    @Param('itemId') itemId: string,
    @Body() dto: UpdateCartItemDto,
    @ActiveUser('id') userId?: number,
    @Query('sessionId') sessionId?: string,
  ) {
    return this.cartsService.updateItem(+itemId, dto, userId, sessionId);
  }

  /**
   * Xóa 1 item
   */
  @Public()
  @Delete('items/:itemId')
  removeItem(
    @Param('itemId') itemId: string,
    @ActiveUser('id') userId?: number,
    @Query('sessionId') sessionId?: string,
  ) {
    return this.cartsService.removeItem(+itemId, userId, sessionId);
  }

  /**
   * Xóa toàn bộ giỏ
   */
  @Public()
  @Delete()
  clearCart(
    @ActiveUser('id') userId?: number,
    @Query('sessionId') sessionId?: string,
  ) {
    return this.cartsService.clearCart(userId, sessionId);
  }
}