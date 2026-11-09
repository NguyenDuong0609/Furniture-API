import { Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { WishlistsService } from './wishlists.service.js';
import { ActiveUser } from '../shared/decorators/active-user.decorator.js';

@Controller('wishlists')
export class WishlistsController {
  constructor(private readonly wishlistsService: WishlistsService) {}

  @Post(':productId')
  add(@ActiveUser('id') userId: number, @Param('productId') productId: string) {
    return this.wishlistsService.add(userId, +productId);
  }

  @Delete(':productId')
  remove(@ActiveUser('id') userId: number, @Param('productId') productId: string) {
    return this.wishlistsService.remove(userId, +productId);
  }

  @Get()
  findAll(@ActiveUser('id') userId: number) {
    return this.wishlistsService.findAll(userId);
  }
}