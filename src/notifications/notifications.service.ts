import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationType } from '@prisma/client';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Tạo notification trong DB và trả về record.
   * Caller (EventsGateway) tự emit realtime sau khi nhận về.
   */
  async create(
    userId: number,
    type: NotificationType,
    title: string,
    message: string,
    data?: any,
  ) {
    return this.prisma.notification.create({
      data: { userId, type, title, message, data: data ?? undefined },
    });
  }

  /**
   * Tạo notification cho tất cả admin, trả về danh sách record.
   * Caller tự emit realtime.
   */
  async createForAdmins(
    type: NotificationType,
    title: string,
    message: string,
    data?: any,
  ) {
    const admins = await this.prisma.userRole.findMany({
      where: { role: { name: 'ADMIN' } },
      select: { userId: true },
    });

    const notifications = await Promise.all(
      admins.map((admin) =>
        this.create(admin.userId, type, title, message, data),
      ),
    );

    return notifications;
  }

  async findAllByUser(userId: number, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [items, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.notification.count({ where: { userId } }),
      this.prisma.notification.count({ where: { userId, isRead: false } }),
    ]);

    return {
      data: items,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      unreadCount,
    };
  }

  async markAsRead(userId: number, id: number) {
    const noti = await this.prisma.notification.findFirst({
      where: { id, userId },
    });
    if (!noti) throw new NotFoundException('Không tìm thấy thông báo');
    return this.prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });
  }

  async markAllAsRead(userId: number) {
    await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
    return { message: 'Đã đánh dấu tất cả là đã đọc' };
  }
}
