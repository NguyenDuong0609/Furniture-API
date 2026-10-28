import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AddToCartDto } from './dto/add-to-cart.dto.js';
import { UpdateCartItemDto } from './dto/update-cart-item.dto.js';
import { randomUUID } from 'crypto';

@Injectable()
export class CartsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lấy hoặc tạo cart (hỗ trợ cả user và guest)
   */
  private async getOrCreateCart(userId?: number, sessionId?: string) {
    if (userId) {
      let cart = await this.prisma.cart.findFirst({
        where: { userId },
        include: { items: true },
      });

      if (!cart) {
        cart = await this.prisma.cart.create({
          data: { userId },
          include: { items: true },
        });
      }
      return cart;
    }

    // Guest cart
    if (!sessionId) {
      throw new BadRequestException('sessionId là bắt buộc với guest');
    }

    let cart = await this.prisma.cart.findFirst({
      where: { sessionId },
      include: { items: true },
    });

    if (!cart) {
      cart = await this.prisma.cart.create({
        data: { sessionId },
        include: { items: true },
      });
    }
    return cart;
  }

  /**
   * Thêm sản phẩm vào giỏ
   */
  async addToCart(dto: AddToCartDto, userId?: number) {
    const { productId, variantId, quantity = 1, sessionId } = dto;

    // Kiểm tra sản phẩm
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { variants: true },
    });

    if (!product || !product.isActive) {
      throw new NotFoundException('Sản phẩm không tồn tại hoặc đã ngừng bán');
    }

    // Kiểm tra variant nếu có
    if (variantId) {
      const variant = product.variants.find((v) => v.id === variantId);
      if (!variant) {
        throw new NotFoundException('Phiên bản sản phẩm không tồn tại');
      }
      if (variant.stock < quantity) {
        throw new BadRequestException('Số lượng vượt quá tồn kho của phiên bản');
      }
    } else {
      if (product.stock < quantity) {
        throw new BadRequestException('Số lượng vượt quá tồn kho');
      }
    }

    const cart = await this.getOrCreateCart(userId, sessionId);

    // Kiểm tra item đã có trong cart chưa
    const existingItem = await this.prisma.cartItem.findFirst({
      where: {
        cartId: cart.id,
        productId,
        variantId: variantId || null,
      },
    });

    if (existingItem) {
      // Cập nhật số lượng
      return this.prisma.cartItem.update({
        where: { id: existingItem.id },
        data: { quantity: existingItem.quantity + quantity },
        include: {
          product: {
            include: { images: { where: { isMain: true }, take: 1 } },
          },
          variant: true,
        },
      });
    }

    // Thêm mới
    return this.prisma.cartItem.create({
      data: {
        cartId: cart.id,
        productId,
        variantId: variantId || null,
        quantity,
      },
      include: {
        product: {
          include: { images: { where: { isMain: true }, take: 1 } },
        },
        variant: true,
      },
    });
  }

  /**
   * Lấy giỏ hàng hiện tại
   */
  async getCart(userId?: number, sessionId?: string) {
    const cart = await this.getOrCreateCart(userId, sessionId);

    const fullCart = await this.prisma.cart.findUnique({
      where: { id: cart.id },
      include: {
        items: {
          include: {
            product: {
              include: {
                images: { where: { isMain: true }, take: 1 },
              },
            },
            variant: true,
          },
        },
      },
    });

    // Tính tổng tiền
    if (!fullCart) {
      throw new NotFoundException('Giỏ hàng không tồn tại');
    }

    let total = 0;
    const items = fullCart.items.map((item) => {
      const price =
        item.variant?.price ??
        item.product.salePrice ??
        item.product.price;
      const lineTotal = Number(price) * item.quantity;
      total += lineTotal;

      return {
        ...item,
        price: Number(price),
        lineTotal,
        variant: item.variant
          ? {
              ...item.variant,
              attributes: item.variant.attributes
                ? JSON.parse(item.variant.attributes)
                : null,
            }
          : null,
      };
    });

    return {
      id: fullCart.id,
      sessionId: fullCart.sessionId,
      userId: fullCart.userId,
      items,
      total,
      itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
    };
  }

  /**
   * Cập nhật số lượng item
   */
  async updateItem(
    itemId: number,
    dto: UpdateCartItemDto,
    userId?: number,
    sessionId?: string,
  ) {
    const cart = await this.getOrCreateCart(userId, sessionId);

    const item = await this.prisma.cartItem.findFirst({
      where: { id: itemId, cartId: cart.id },
      include: { product: true, variant: true },
    });

    if (!item) {
      throw new NotFoundException('Item không tồn tại trong giỏ hàng');
    }

    // Kiểm tra tồn kho
    const stock = item.variant?.stock ?? item.product.stock;
    if (dto.quantity > stock) {
      throw new BadRequestException('Số lượng vượt quá tồn kho');
    }

    return this.prisma.cartItem.update({
      where: { id: itemId },
      data: { quantity: dto.quantity },
      include: {
        product: {
          include: { images: { where: { isMain: true }, take: 1 } },
        },
        variant: true,
      },
    });
  }

  /**
   * Xóa item khỏi giỏ
   */
  async removeItem(itemId: number, userId?: number, sessionId?: string) {
    const cart = await this.getOrCreateCart(userId, sessionId);

    const item = await this.prisma.cartItem.findFirst({
      where: { id: itemId, cartId: cart.id },
    });

    if (!item) {
      throw new NotFoundException('Item không tồn tại trong giỏ hàng');
    }

    await this.prisma.cartItem.delete({ where: { id: itemId } });
    return { message: 'Đã xóa sản phẩm khỏi giỏ hàng' };
  }

  /**
   * Xóa toàn bộ giỏ hàng
   */
  async clearCart(userId?: number, sessionId?: string) {
    const cart = await this.getOrCreateCart(userId, sessionId);
    await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    return { message: 'Đã xóa toàn bộ giỏ hàng' };
  }

  /**
   * Tạo sessionId mới cho guest
   */
  generateSessionId() {
    return randomUUID();
  }
}
