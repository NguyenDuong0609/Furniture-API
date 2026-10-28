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

@WebSocketGateway({
  cors: {
    origin: '*', // production nên giới hạn domain
  },
  namespace: '/events',
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EventsGateway.name);

  // Lưu userId → socketId
  private userSockets = new Map<number, string>();

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);

    // Xóa mapping khi disconnect
    for (const [userId, socketId] of this.userSockets.entries()) {
      if (socketId === client.id) {
        this.userSockets.delete(userId);
        break;
      }
    }
  }

  /**
   * Client gửi userId sau khi login để join room
   */
  @SubscribeMessage('join')
  handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: number },
  ) {
    if (data?.userId) {
      this.userSockets.set(data.userId, client.id);
      client.join(`user_${data.userId}`);
      this.logger.log(`User ${data.userId} joined room`);
    }
    return { event: 'joined', data: { success: true } };
  }

  /**
   * Gửi thông báo đến 1 user cụ thể
   */
  sendToUser(userId: number, event: string, data: any) {
    this.server.to(`user_${userId}`).emit(event, data);
  }

  /**
   * Gửi thông báo đến tất cả admin (room admin)
   */
  sendToAdmins(event: string, data: any) {
    this.server.to('admins').emit(event, data);
  }

  /**
   * Broadcast đến tất cả client
   */
  broadcast(event: string, data: any) {
    this.server.emit(event, data);
  }
}