import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest();

    // Lấy API Key từ header
    const apiKey = request.headers['x-api-key'];

    if (!apiKey) {
      throw new UnauthorizedException('API Key không được cung cấp');
    }

    const validApiKey = this.configService.get<string>('API_KEY');

    if (apiKey !== validApiKey) {
      throw new UnauthorizedException('API Key không hợp lệ');
    }

    return true;
  }
}
