import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/events',
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EventsGateway.name);
  private userSockets = new Map<number, string>();

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);

    // Xử lý join trực tiếp trên socket (đáng tin hơn @SubscribeMessage trong case này)
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
      this.userSockets.set(id, client.id);
      client.join(`user_${id}`);

      this.logger.log(`User ${id} joined room user_${id}`);
      client.emit('joined', { success: true, userId: id });
    });
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    for (const [userId, socketId] of this.userSockets.entries()) {
      if (socketId === client.id) {
        this.userSockets.delete(userId);
        break;
      }
    }
  }

  sendToUser(userId: number, event: string, data: any) {
    this.server.to(`user_${userId}`).emit(event, data);
  }

  sendToAdmins(event: string, data: any) {
    this.server.to('admins').emit(event, data);
  }

  broadcast(event: string, data: any) {
    this.logger.log(`Broadcast ${event}: ${JSON.stringify(data)}`);
    this.server.emit(event, data);
  }
}