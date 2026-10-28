import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule, ObserveInstrument } from './app.module.js';
import { ConfigService } from '@nestjs/config';
import { ClassSerializerInterceptor } from '@nestjs/common';
import { TransformInterceptor } from './shared/transform.interceptor.js';
import { LoggingInterceptor } from './shared/logging.interceptor.js';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard.js';
import { join } from 'path';
import { NestExpressApplication } from '@nestjs/platform-express';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    instrument: ObserveInstrument,
  });

  // Serve thư mục uploads
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads/',
  });

  // Zod validation từ nestjs-zod sẽ tự động xử lý

  // Serialization
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  // Custom Interceptors
  app.useGlobalInterceptors(new LoggingInterceptor(), new TransformInterceptor());

  // JWT Guard toàn cục
  const reflector = app.get(Reflector);
  app.useGlobalGuards(new JwtAuthGuard(reflector));

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT') || 3000;

  await app.listen(port);
  console.log(`Server is running on http://localhost:${port}`);
}
await bootstrap();
