import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule, ObserveInstrument } from './app.module.js';
import { ConfigService } from '@nestjs/config';
import { ClassSerializerInterceptor } from '@nestjs/common';
import { TransformInterceptor } from './shared/transform.interceptor.js';
import { LoggingInterceptor } from './shared/logging.interceptor.js';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard.js';
import { join } from 'path';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    instrument: ObserveInstrument,
  });

  // CORS — cho phép frontend local và file:// test
  app.enableCors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-session-id'],
    credentials: false,
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

  // ===== SWAGGER =====
  const config = new DocumentBuilder()
    .setTitle('Furniture Ecommerce API')
    .setDescription('API cho website bán nội thất - NestJS Super')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        description: 'Nhập access token',
        in: 'header',
      },
      'access-token',
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: 'x-session-id',
        in: 'header',
        description: 'Session ID cho Guest Cart',
      },
      'session-id',
    )
    .addTag('Auth', 'Đăng ký / Đăng nhập / 2FA / Profile')
    .addTag('Users', 'Quản lý người dùng (Admin)')
    .addTag('Categories', 'Danh mục sản phẩm')
    .addTag('Products', 'Sản phẩm + Variant + Ảnh')
    .addTag('Carts', 'Giỏ hàng (User + Guest)')
    .addTag('Orders', 'Đơn hàng + Checkout')
    .addTag('Payments', 'Thanh toán COD + SePay')
    .addTag('Media', 'Upload ảnh Cloudinary')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true, // giữ token khi refresh
    },
  });

  await app.listen(port);
  const logger = app.get(Logger);
  app.useLogger(logger);
  logger.log(`Server is running on http://localhost:${port}`);
  logger.log(`Swagger: http://localhost:${port}/docs`);
}
await bootstrap();
