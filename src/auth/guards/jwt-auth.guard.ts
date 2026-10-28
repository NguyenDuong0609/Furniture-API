import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Socket } from 'socket.io';
import { IS_PUBLIC_KEY } from '../../shared/decorators/public.decorator.js';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // Kiểm tra xem route có đánh dấu @Public() không
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      const request = this.getRequest(context);
      const hasBearerToken = request?.headers?.authorization?.startsWith('Bearer ');

      if (!hasBearerToken) {
        return true;
      }

      return super.canActivate(context);
    }

    return super.canActivate(context);
  }

  getRequest(context: ExecutionContext) {
    if (context.getType() === 'ws') {
      return context.switchToWs().getClient<Socket>().handshake;
    }

    return context.switchToHttp().getRequest();
  }
}
