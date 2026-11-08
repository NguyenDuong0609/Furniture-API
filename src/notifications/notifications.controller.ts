import { Controller, Get, Patch, Param, Query } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';
import { ActiveUser } from '../shared/decorators/active-user.decorator.js';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  /** GET /notifications — Lấy danh sách thông báo (có unreadCount) */
  @Get()
  findAll(
    @ActiveUser('id') userId: number,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.notificationsService.findAllByUser(userId, +page, +limit);
  }

  /** PATCH /notifications/read-all — Đánh dấu tất cả đã đọc (phải đứng trước /:id/read) */
  @Patch('read-all')
  markAllAsRead(@ActiveUser('id') userId: number) {
    return this.notificationsService.markAllAsRead(userId);
  }

  /** PATCH /notifications/:id/read — Đánh dấu 1 thông báo đã đọc */
  @Patch(':id/read')
  markAsRead(
    @ActiveUser('id') userId: number,
    @Param('id') id: string,
  ) {
    return this.notificationsService.markAsRead(userId, +id);
  }
}
