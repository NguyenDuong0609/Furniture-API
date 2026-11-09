import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateOrderDto } from './dto/create-order.dto.js';
import { GetOrdersDto } from './dto/get-orders.dto.js';
import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { EventsGateway } from '../events/events.gateway.js';
import { OrderQueueService } from '../queues/order-queue.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';

@Injectable()
export class OrdersService {
  [x: string]: any;
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsGateway: EventsGateway,
    private readonly orderQueueService: OrderQueueService,
    private readonly paymentsService: PaymentsService,
    private readonly notificationsService: NotificationsService,
  ) { }

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
    try {
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

        // Ghi lịch sử trạng thái đầu tiên
        await tx.orderStatusHistory.create({
          data: { orderId: newOrder.id, status: 'PENDING', note: 'Tạo đơn' },
        });

        return newOrder;
      });

      // Sau khi tạo order thành công:
      try { await this.eventsGateway.notifyNewOrder(order); } catch (e) { this.logger.error(e, 'notifyNewOrder error'); }
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

      // Lưu notification vào DB
      await this.notificationsService.createForAdmins(
        'NEW_ORDER',
        'Đơn hàng mới',
        `Đơn hàng ${order.code} vừa được tạo - ${order.totalAmount}đ`,
        { orderId: order.id, orderCode: order.code },
      );

      if (userId) {
        await this.notificationsService.create(
          userId,
          'NEW_ORDER',
          'Đặt hàng thành công',
          `Đơn hàng ${order.code} của bạn đã được tiếp nhận`,
          { orderId: order.id },
        );
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

      this.logger.log({ orderCode: order.code }, 'Tạo đơn hàng thành công');

      return {
        message: 'Đặt hàng thành công',
        order,
        bankTransfer: this.paymentsService.getBankTransferInfo(order),
      };
    } catch (err) {
      this.logger.error({ err }, 'Lỗi khi tạo đơn hàng');
      throw err;
    }
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

  async updateStatus(id: number, status: string, adminId?: number, note?: string) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng');

    const updated = await this.prisma.$transaction(async (tx) => {
      const o = await tx.order.update({
        where: { id },
        data: { status: status as any },
      });
      await tx.orderStatusHistory.create({
        data: {
          orderId: id,
          status: status as any,
          note,
          changedBy: adminId,
        },
      });
      return o;
    });

    // Gửi notification cho khách
    if (order.userId) {
      await this.notificationsService.create(
        order.userId,
        'ORDER_STATUS',
        'Cập nhật đơn hàng',
        `Đơn hàng ${order.code} đã chuyển sang trạng thái ${status}`,
        { orderId: order.id, status },
      );
    }

    return updated;
  }

  async getDashboardStats() {
    const [totalOrders, totalRevenue, totalProducts, totalUsers, recentOrders] =
      await Promise.all([
        this.prisma.order.count(),
        this.prisma.order.aggregate({
          where: { paymentStatus: 'PAID' },
          _sum: { totalAmount: true },
        }),
        this.prisma.product.count(),
        this.prisma.user.count(),
        this.prisma.order.findMany({
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: { items: true },
        }),
      ]);

    return {
      totalOrders,
      totalRevenue: totalRevenue._sum.totalAmount || 0,
      totalProducts,
      totalUsers,
      recentOrders,
    };
  }

  async findAllAdmin(query: {
    page?: number;
    limit?: number;
    status?: string;
    search?: string;
    from?: string;
    to?: string;
  }) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { code: { contains: query.search, mode: 'insensitive' } },
        { shippingName: { contains: query.search, mode: 'insensitive' } },
        { shippingPhone: { contains: query.search } },
      ];
    }
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }

    const [data, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          items: true,
          user: { select: { id: true, email: true, name: true } },
          statusHistory: { orderBy: { createdAt: 'desc' }, take: 5 },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async exportOrders(query: { status?: string; from?: string; to?: string }) {
    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }

    const orders = await this.prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { items: true, user: { select: { email: true, name: true } } },
    });

    // CSV đơn giản
    const header = 'code,status,paymentStatus,totalAmount,customer,phone,createdAt\n';
    const rows = orders
      .map(
        (o) =>
          `${o.code},${o.status},${o.paymentStatus},${o.totalAmount},${o.user?.email || o.shippingName},${o.shippingPhone},${o.createdAt.toISOString()}`,
      )
      .join('\n');

    return header + rows;
  }

  // reports.service.ts hoặc trong OrdersService
  async revenueReport(from?: string, to?: string) {
    const where: any = { paymentStatus: 'PAID' };
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const agg = await this.prisma.order.aggregate({
      where,
      _sum: { totalAmount: true },
      _count: true,
    });

    const byDay = await this.prisma.$queryRaw`
    SELECT DATE("createdAt") as day,
           COUNT(*)::int as orders,
           COALESCE(SUM("totalAmount"), 0) as revenue
    FROM "Order"
    WHERE "paymentStatus" = 'PAID'
    ${from ? Prisma.sql`AND "createdAt" >= ${new Date(from)}` : Prisma.empty}
    ${to ? Prisma.sql`AND "createdAt" <= ${new Date(to)}` : Prisma.empty}
    GROUP BY DATE("createdAt")
    ORDER BY day DESC
    LIMIT 60
  `;

    return {
      totalRevenue: agg._sum.totalAmount || 0,
      totalOrders: agg._count,
      byDay,
    };
  }

  async topProducts(limit = 10) {
    const items = await this.prisma.orderItem.groupBy({
      by: ['productId', 'name'],
      _sum: { quantity: true, price: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: limit,
    });

    return items.map((i) => ({
      productId: i.productId,
      name: i.name,
      totalQty: i._sum.quantity,
      // doanh thu ước tính
      revenue: Number(i._sum.price || 0) * (i._sum.quantity || 0),
    }));
  }
}
