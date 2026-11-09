import { NestFactory, Reflector } from '@nestjs/core';
import helmet from 'helmet';
import compression from 'compression';
import { ZodValidationPipe } from 'nestjs-zod';
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
import { AllExceptionsFilter } from './shared/filters/http-exception.filter.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    instrument: ObserveInstrument,
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT') || 3000;
  const isProd = configService.get('NODE_ENV') === 'production';

  // Logger Pino
  app.useLogger(app.get(Logger));

  // ===== SECURITY =====
  app.use(
    helmet({
      contentSecurityPolicy: isProd ? undefined : false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // ===== PERFORMANCE =====
  app.use(compression());

  // ===== CORS =====
  const corsOrigins = (configService.get<string>('CORS_ORIGINS') || '*')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean);

  app.enableCors({
    origin: corsOrigins.includes('*') ? true : corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-lang', 'x-session-id', 'x-api-key'],
  });

  // ===== VALIDATION + FILTER + SERIALIZE =====
  // patchNestJsSwagger() — đã bị bỏ trong nestjs-zod v5, không cần gọi
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  app.useGlobalInterceptors(new LoggingInterceptor(), new TransformInterceptor());

  // JWT Guard toàn cục
  const reflector = app.get(Reflector);
  app.useGlobalGuards(new JwtAuthGuard(reflector));

  // Serve thư mục uploads
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads/',
  });

  // ===== SWAGGER =====
  const swaggerEnabled =
    configService.get('SWAGGER_ENABLED') === 'true' ||
    (!isProd && configService.get('SWAGGER_ENABLED') !== 'false');

  if (swaggerEnabled) {
    const doc = new DocumentBuilder()
      .setTitle('Furniture Ecommerce API')
      .setDescription('Dev/Staging API docs')
      .setVersion('1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', name: 'Authorization', description: 'Nhập access token', in: 'header' },
        'access-token',
      )
      .addApiKey(
        { type: 'apiKey', name: 'x-session-id', in: 'header', description: 'Session ID cho Guest Cart' },
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
    const document = SwaggerModule.createDocument(app, doc);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  await app.listen(port);
  const logger = app.get(Logger);
  logger.log(`Server is running on http://localhost:${port}`);
  logger.log(`Swagger: http://localhost:${port}/docs`);
}
await bootstrap();
