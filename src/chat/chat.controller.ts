import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ChatService } from './chat.service.js';
import { ActiveUser } from '../shared/decorators/active-user.decorator.js';
import { RequirePermissions } from '../shared/decorators/permissions.decorator.js';
import { PermissionsGuard } from '../auth/guards/permissions.guard.js';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /** GET /chat/my-conversation — User lấy hội thoại của mình */
  @Get('my-conversation')
  getMyConversation(@ActiveUser('id') userId: number) {
    return this.chatService.getOrCreateConversation(userId);
  }

  /** GET /chat/conversations — Admin lấy tất cả hội thoại */
  @Get('conversations')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('user:read')
  getConversations() {
    return this.chatService.getConversations();
  }

  /** GET /chat/conversations/:id/messages — Lấy tin nhắn của 1 conversation */
  @Get('conversations/:id/messages')
  getMessages(
    @Param('id') id: string,
    @ActiveUser('id') userId: number,
    @ActiveUser() user: any,
  ) {
    const isAdmin = user?.roles?.some((r: any) => r.name === 'ADMIN');
    return this.chatService.getMessages(+id, userId, isAdmin);
  }

  /** POST /chat/messages — Gửi tin nhắn qua REST (fallback, chủ yếu dùng socket) */
  @Post('messages')
  async sendMessage(
    @ActiveUser('id') senderId: number,
    @Body() body: { content: string; toUserId?: number },
  ) {
    const { message } = await this.chatService.sendMessage(
      senderId,
      body.content,
      body.toUserId,
    );
    return message;
  }

  /** POST /chat/conversations/:id/read — Đánh dấu đã đọc */
  @Post('conversations/:id/read')
  markAsRead(
    @Param('id') id: string,
    @ActiveUser('id') userId: number,
  ) {
    return this.chatService.markAsRead(+id, userId);
  }
}
