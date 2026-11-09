import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class WishlistsService {
  constructor(private prisma: PrismaService) {}

  async add(userId: number, productId: number) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Sản phẩm không tồn tại');

    try {
      return await this.prisma.wishlist.create({
        data: { userId, productId },
        include: { product: { include: { images: { where: { isMain: true }, take: 1 } } } },
      });
    } catch {
      throw new ConflictException('Sản phẩm đã có trong danh sách yêu thích');
    }
  }

  async remove(userId: number, productId: number) {
    const item = await this.prisma.wishlist.findUnique({
      where: { userId_productId: { userId, productId } },
    });
    if (!item) throw new NotFoundException('Không tìm thấy');
    await this.prisma.wishlist.delete({ where: { id: item.id } });
    return { message: 'Đã xóa khỏi yêu thích' };
  }

  findAll(userId: number) {
    return this.prisma.wishlist.findMany({
      where: { userId },
      include: {
        product: {
          include: {
            images: { where: { isMain: true }, take: 1 },
            category: { select: { id: true, name: true, slug: true } },
          },
        },
      },
      orderBy: { id: 'desc' },
    });
  }
}