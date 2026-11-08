import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lấy hoặc tạo conversation của user */
  async getOrCreateConversation(userId: number) {
    let conversation = await this.prisma.conversation.findFirst({
      where: { userId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 50,
          include: {
            sender: { select: { id: true, name: true, avatar: true } },
          },
        },
      },
    });

    if (!conversation) {
      conversation = await this.prisma.conversation.create({
        data: { userId },
        include: {
          messages: {
            include: {
              sender: { select: { id: true, name: true, avatar: true } },
            },
          },
        },
      });
    }

    return conversation;
  }

  /**
   * Lưu tin nhắn vào DB và trả về message + context để caller tự emit realtime.
   * Không inject EventsGateway ở đây để tránh circular dependency với ESM.
   */
  async sendMessage(senderId: number, content: string, toUserId?: number) {
    let conversation;

    if (toUserId) {
      // Admin gửi cho user
      conversation = await this.prisma.conversation.findFirst({
        where: { userId: toUserId },
      });
      if (!conversation) {
        conversation = await this.prisma.conversation.create({
          data: { userId: toUserId, adminId: senderId },
        });
      }
    } else {
      // User gửi
      conversation = await this.getOrCreateConversation(senderId);
    }

    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderId,
        content: content.trim(),
      },
      include: {
        sender: { select: { id: true, name: true, avatar: true } },
      },
    });

    // Cập nhật last message
    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessage: content.trim(),
        lastMessageAt: new Date(),
        adminId: toUserId ? senderId : conversation.adminId,
      },
    });

    // Trả về message kèm context để EventsGateway tự emit
    return {
      message,
      conversationUserId: conversation.userId, // room user_<id> cần emit
      isAdminSender: !!toUserId,               // true = admin gửi → chỉ emit user; false = user gửi → emit admins
    };
  }

  /** Lấy danh sách conversation (cho Admin) */
  async getConversations() {
    return this.prisma.conversation.findMany({
      orderBy: { lastMessageAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, email: true, avatar: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
  }

  /** Lấy tin nhắn của 1 conversation */
  async getMessages(conversationId: number, userId: number, isAdmin: boolean) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) throw new NotFoundException('Không tìm thấy hội thoại');

    if (!isAdmin && conversation.userId !== userId) {
      throw new ForbiddenException('Không có quyền xem hội thoại này');
    }

    return this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      include: {
        sender: { select: { id: true, name: true, avatar: true } },
      },
    });
  }

  /** Đánh dấu đã đọc */
  async markAsRead(conversationId: number, userId: number) {
    await this.prisma.message.updateMany({
      where: {
        conversationId,
        senderId: { not: userId },
        isRead: false,
      },
      data: { isRead: true },
    });
    return { message: 'Đã đánh dấu đã đọc' };
  }
}
