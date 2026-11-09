import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { ChatService } from '../chat/chat.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service.js';

interface AuthenticatedSocket extends Socket {
  userId?: number;
  role?: string;
}

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/ws',
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EventsGateway.name);

  // userId → Set of socketIds (1 user có thể mở nhiều tab)
  private userSockets = new Map<number, Set<string>>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly chatService: ChatService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async handleConnection(client: AuthenticatedSocket) {
    this.logger.log(`Client connected: ${client.id}`);

    try {
      const token =
        client.handshake.auth?.token ||                                    // socket.io client: { auth: { token } }
        client.handshake.headers?.authorization?.replace('Bearer ', '') || // HTTP header: Authorization: Bearer <token>
        client.handshake.query?.token as string | undefined;               // query param: ?token=... (Postman)

      if (!token) {
        client.disconnect();
        return;
      }

      // Không truyền secret override — dùng config đã đăng ký trong JwtModule.registerAsync
      const payload = await this.jwtService.verifyAsync(token);

      client.userId = payload.sub;

      // Lấy role từ DB
      const userRoles = await this.prisma.userRole.findMany({
        where: { userId: payload.sub },
        include: { role: true },
      });
      client.role = userRoles.some((r) => r.role.name === 'ADMIN')
        ? 'ADMIN'
        : 'USER';

      // Lưu socket vào map
      if (client.userId) {
        if (!this.userSockets.has(client.userId)) {
          this.userSockets.set(client.userId, new Set());
        }
        this.userSockets.get(client.userId)!.add(client.id);
      }

      // Join room dựa trên userId và role từ JWT
      client.join(`user_${client.userId}`);
      if (client.role === 'ADMIN') {
        client.join('admins');
      }

      this.logger.log(`User ${client.userId} (${client.role}) connected: ${client.id}`);

      // Cho phép client tự join room bằng cách gửi event 'join' kèm userId
      // (hữu ích khi client muốn join thêm sau khi đã kết nối)
      client.on('join', (data: any) => {
        this.logger.log(`join payload: ${JSON.stringify(data)}`);

        const userId =
          data?.userId ??
          data?.data?.userId ??
          (typeof data === 'number' ? data : null);

        if (!userId) {
          this.logger.warn('join thiếu userId');
          client.emit('joined', { success: false, message: 'userId required' });
          return;
        }

        const id = Number(userId);
        client.join(`user_${id}`);

        this.logger.log(`User ${id} joined room user_${id}`);
        client.emit('joined', { success: true, userId: id });
      });

      // Cho phép admin join phòng admins thủ công qua event 'joinAdmin'
      // (dùng cho đơn hàng vãng lai hoặc khi client cần join lại)
      client.on('joinAdmin', (data: any) => {
        this.logger.log(`joinAdmin payload: ${JSON.stringify(data)}`);

        const isAdmin = data?.isAdmin ?? data?.data?.isAdmin ?? false;

        if (!isAdmin) {
          this.logger.warn('joinAdmin thiếu isAdmin flag');
          client.emit('joinedAdmin', { success: false, message: 'isAdmin required' });
          return;
        }

        client.join('admins');
        this.logger.log(`Admin joined room admins`);
        client.emit('joinedAdmin', { success: true });
      });
    } catch (err) {
      this.logger.warn(`Unauthorized socket: ${client.id}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    if (client.userId) {
      const sockets = this.userSockets.get(client.userId);
      if (sockets) {
        sockets.delete(client.id);
        if (sockets.size === 0) {
          this.userSockets.delete(client.userId);
        }
      }
    }
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  // ========== NOTIFICATION ==========

  /** Gửi thông báo đến 1 user */
  sendNotification(userId: number, data: any) {
    this.server.to(`user_${userId}`).emit('notification', data);
  }

  /** Gửi thông báo đến tất cả Admin */
  sendToAdmins(event: string, data: any) {
    this.server.to('admins').emit(event, data);
  }

  /** Thông báo đơn hàng mới cho Admin — lưu DB + emit realtime */
  async notifyNewOrder(order: any) {
    const title = 'Đơn hàng mới';
    const message = `Đơn hàng ${order.code} vừa được tạo`;

    // Lưu notification cho từng admin và emit realtime
    const notifications = await this.notificationsService.createForAdmins(
      'NEW_ORDER' as any,
      title,
      message,
      { orderId: order.id, orderCode: order.code },
    );

    notifications.forEach((noti) => {
      this.sendNotification(noti.userId, noti);
    });
  }

  /** Thông báo đơn hàng đã thanh toán — lưu DB + emit realtime */
  async notifyOrderPaid(order: any) {
    const orderData = { orderId: order.id, orderCode: order.code };

    // Emit event orderPaid trực tiếp để frontend/Postman nhận được ngay
    if (order.userId) {
      this.server.to(`user_${order.userId}`).emit('orderPaid', orderData);
    }
    this.server.to('admins').emit('orderPaid', { ...orderData, isGuest: !order.userId });

    // Lưu Notification vào DB + emit notification badge cho user
    if (order.userId) {
      const noti = await this.notificationsService.create(
        order.userId,
        'ORDER_PAID' as any,
        'Thanh toán thành công',
        `Đơn hàng ${order.code} đã được thanh toán`,
        orderData,
      );
      this.sendNotification(order.userId, noti);
    }

    // Lưu Notification cho tất cả admin
    const adminNotis = await this.notificationsService.createForAdmins(
      'ORDER_PAID' as any,
      'Đơn hàng đã thanh toán',
      `Đơn hàng ${order.code} đã thanh toán thành công`,
      orderData,
    );
    adminNotis.forEach((noti) => {
      this.sendNotification(noti.userId, noti);
    });
  }
  // ========== CHAT ==========

  /**
   * Client/Admin gửi tin nhắn
   * data: { conversationId?: number, toUserId?: number, content: string }
   */
  @SubscribeMessage('sendMessage')
  async handleMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { conversationId?: number; toUserId?: number; content: string },
  ) {
    this.logger.log(`handleMessage | from userId=${client.userId} role=${client.role} | toUserId=${data?.toUserId}`);

    if (!client.userId || !data.content?.trim()) return;

    // ChatService lưu DB và trả về message + context emit
    const { message, conversationUserId, isAdminSender } =
      await this.chatService.sendMessage(client.userId, data.content, data.toUserId);

    // Emit realtime — gateway nắm server nên tự emit ở đây
    this.server.to(`user_${conversationUserId}`).emit('newMessage', message);

    if (!isAdminSender) {
      // User gửi → notify tất cả admin
      this.server.to('admins').emit('newMessage', {
        ...message,
        conversationUserId,
      });
    }

    return { event: 'messageSent', data: message };
  }

  /**
   * Admin tham gia phòng chat của 1 user
   */
  @SubscribeMessage('joinConversation')
  handleJoinConversation(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { userId: number },
  ) {
    if (client.role !== 'ADMIN') return;
    client.join(`conversation_${data.userId}`);
    return { event: 'joinedConversation', data };
  }

  /**
   * Đánh dấu đã đọc
   */
  @SubscribeMessage('markAsRead')
  handleMarkAsRead(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { messageIds: number[] },
  ) {
    return { event: 'markedAsRead', data };
  }

  sendToUser(userId: number, event: string, data: any) {
    this.server.to(`user_${userId}`).emit(event, data);
  }

  broadcast(event: string, data: any) {
    this.logger.log(`Broadcast ${event}: ${JSON.stringify(data)}`);
    this.server.emit(event, data);
  }
}
