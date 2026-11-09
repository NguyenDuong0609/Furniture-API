import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class ReviewsService {
  constructor(private prisma: PrismaService) {}

  async create(userId: number, productId: number, rating: number, comment?: string) {
    if (rating < 1 || rating > 5) throw new BadRequestException('Rating phải từ 1-5');

    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Sản phẩm không tồn tại');

    // Chỉ cho đánh giá nếu đã mua (tùy chọn – có thể bỏ)
    // const hasBought = await this.prisma.orderItem.findFirst({...})

    return this.prisma.review.create({
      data: { userId, productId, rating, comment },
      include: {
        user: { select: { id: true, name: true, avatar: true } },
      },
    });
  }

  findByProduct(productId: number) {
    return this.prisma.review.findMany({
      where: { productId },
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, avatar: true } },
      },
    });
  }

  async remove(id: number, userId: number, isAdmin = false) {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review) throw new NotFoundException('Không tìm thấy đánh giá');
    if (!isAdmin && review.userId !== userId) {
      throw new BadRequestException('Không có quyền xóa');
    }
    return this.prisma.review.delete({ where: { id } });
  }
}