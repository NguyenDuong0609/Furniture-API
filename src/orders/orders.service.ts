import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateOrderDto } from './dto/create-order.dto.js';
import { GetOrdersDto } from './dto/get-orders.dto.js';
import { randomBytes } from 'crypto';
import type { Prisma } from '@prisma/client';
import { EventsGateway } from '../events/events.gateway.js';
import { OrderQueueService } from '../queues/order-queue.service.js';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsGateway: EventsGateway,
    private readonly orderQueueService: OrderQueueService,
  ) {}

  private generateOrderCode(): string {
    const date = new Date();
    const prefix = `ORD${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    const random = randomBytes(3).toString('hex').toUpperCase();
    return `${prefix}${random}`;
  }

  /**
   * Tạo đơn hàng từ giỏ hàng hiện tại
   */
  async create(dto: CreateOrderDto, userId?: number) {
    // 1. Lấy cart
    let cart;
    if (userId) {
      cart = await this.prisma.cart.findFirst({
        where: { userId },
        include: {
          items: {
            include: {
              product: true,
              variant: true,
            },
          },
        },
      });
    } else {
      if (!dto.sessionId) {
        throw new BadRequestException('sessionId là bắt buộc với khách');
      }
      cart = await this.prisma.cart.findFirst({
        where: { sessionId: dto.sessionId },
        include: {
          items: {
            include: {
              product: true,
              variant: true,
            },
          },
        },
      });
    }

    if (!cart || cart.items.length === 0) {
      throw new BadRequestException('Giỏ hàng trống');
    }

    // 2. Kiểm tra tồn kho + tính tổng tiền
    let totalAmount = 0;
    const orderItemsData: Prisma.OrderItemUncheckedCreateWithoutOrderInput[] = [];

    for (const item of cart.items) {
      const stock = item.variant?.stock ?? item.product.stock;
      if (item.quantity > stock) {
        throw new BadRequestException(
          `Sản phẩm "${item.product.name}" không đủ số lượng trong kho`,
        );
      }

      const price =
        item.variant?.price ??
        item.product.salePrice ??
        item.product.price;

      const lineTotal = Number(price) * item.quantity;
      totalAmount += lineTotal;

      orderItemsData.push({
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
        price: Number(price),
        name: item.variant
          ? `${item.product.name} - ${item.variant.name}`
          : item.product.name,
      });
    }

    // 3. Tạo order + order items trong transaction
    const order = await this.prisma.$transaction(async (tx) => {
      // Tạo đơn hàng
      const newOrder = await tx.order.create({
        data: {
          code: this.generateOrderCode(),
          userId: userId || null,
          status: 'PENDING',
          totalAmount,
          shippingFee: 0, // có thể tính sau
          discountAmount: 0,
          shippingName: dto.shippingName,
          shippingPhone: dto.shippingPhone,
          shippingAddress: dto.shippingAddress,
          shippingCity: dto.shippingCity,
          shippingDistrict: dto.shippingDistrict,
          paymentMethod: dto.paymentMethod,
          paymentStatus: 'UNPAID',
          items: {
            create: orderItemsData,
          },
        },
        include: {
          items: true,
        },
      });

      // Trừ tồn kho
      // Trong transaction, sau khi tạo order + order items:

for (const item of cart.items) {
  if (item.variantId) {
    // Chỉ trừ khi còn đủ hàng
    const updated = await tx.productVariant.updateMany({
      where: {
        id: item.variantId,
        stock: { gte: item.quantity }, // đủ stock mới update
      },
      data: {
        stock: { decrement: item.quantity },
      },
    });

    if (updated.count === 0) {
      throw new BadRequestException(
        `Sản phẩm "${item.product.name}" không đủ số lượng trong kho`,
      );
    }
  } else {
    const updated = await tx.product.updateMany({
      where: {
        id: item.productId,
        stock: { gte: item.quantity },
      },
      data: {
        stock: { decrement: item.quantity },
      },
    });

    if (updated.count === 0) {
      throw new BadRequestException(
        `Sản phẩm "${item.product.name}" không đủ số lượng trong kho`,
      );
    }
  }
}

      // Xóa giỏ hàng sau khi đặt thành công
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

      return newOrder;
    });

    // Sau khi tạo order thành công:
    this.eventsGateway.broadcast('newOrder', {
      orderId: order.id,
      orderCode: order.code,
      totalAmount: order.totalAmount,
      createdAt: order.createdAt,
    });

    // Nếu có userId thì gửi riêng cho user
    if (userId) {
      this.eventsGateway.sendToUser(userId, 'orderCreated', {
        message: 'Đặt hàng thành công',
        order,
      });
    }

    // return {
    //   message: 'Đặt hàng thành công',
    //   order,
    // };
    // Websocket (đã có)
this.eventsGateway.broadcast('newOrder', {
  orderId: order.id,
  orderCode: order.code,
  totalAmount: order.totalAmount,
  createdAt: order.createdAt,
});

if (userId) {
  this.eventsGateway.sendToUser(userId, 'orderCreated', {
    message: 'Đặt hàng thành công',
    order,
  });
}

// Queue nền (thêm)
await this.orderQueueService.addSendOrderEmailJob({
  orderId: order.id,
  orderCode: order.code,
  email: undefined, // sau này lấy từ user.email
  totalAmount: order.totalAmount.toNumber(),
});

await this.orderQueueService.addNotifyAdminJob({
  orderId: order.id,
  orderCode: order.code,
  totalAmount: order.totalAmount.toNumber(),
});

return {
  message: 'Đặt hàng thành công',
  order,
};
  }

  /**
   * Lấy danh sách đơn hàng của user
   */
  async findAllByUser(userId: number, query: GetOrdersDto) {
    const { page = 1, limit = 10, status } = query;
    const skip = (page - 1) * limit;

    const where: any = { userId };
    if (status) where.status = status;

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          items: true,
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      data: orders,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Lấy chi tiết 1 đơn hàng
   */
  async findOne(id: number, userId?: number) {
    const order = await this.prisma.order.findUnique({
      where: { id },
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

    if (!order) {
      throw new NotFoundException('Không tìm thấy đơn hàng');
    }

    // Chỉ cho phép xem đơn của chính mình (trừ admin sau này)
    if (userId && order.userId !== userId) {
      throw new NotFoundException('Không tìm thấy đơn hàng');
    }

    return order;
  }

  /**
   * Hủy đơn hàng (chỉ khi còn PENDING)
   */
  async cancel(id: number, userId: number) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!order) {
      throw new NotFoundException('Không tìm thấy đơn hàng');
    }

    if (order.userId !== userId) {
      throw new NotFoundException('Không tìm thấy đơn hàng');
    }

    if (order.status !== 'PENDING') {
      throw new BadRequestException('Chỉ có thể hủy đơn hàng đang chờ xử lý');
    }

    // Hoàn tồn kho + cập nhật trạng thái
    await this.prisma.$transaction(async (tx) => {
      for (const item of order.items) {
        if (item.variantId) {
          await tx.productVariant.update({
            where: { id: item.variantId },
            data: { stock: { increment: item.quantity } },
          });
        } else {
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { increment: item.quantity } },
          });
        }
      }

      await tx.order.update({
        where: { id },
        data: { status: 'CANCELLED' },
      });
    });

    return { message: 'Hủy đơn hàng thành công' };
  }
}
