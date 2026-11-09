import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ReviewsService } from './reviews.service.js';
import { ActiveUser } from '../shared/decorators/active-user.decorator.js';
import { Public } from '../shared/decorators/public.decorator.js';

@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post()
  create(
    @ActiveUser('id') userId: number,
    @Body() body: { productId: number; rating: number; comment?: string },
  ) {
    return this.reviewsService.create(userId, body.productId, body.rating, body.comment);
  }

  @Public()
  @Get('product/:productId')
  findByProduct(@Param('productId') productId: string) {
    return this.reviewsService.findByProduct(+productId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @ActiveUser('id') userId: number) {
    return this.reviewsService.remove(+id, userId);
  }
}