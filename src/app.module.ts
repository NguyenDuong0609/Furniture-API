import { Module } from '@nestjs/common';
import { createObserveModule } from '@nestjs/observe';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { SharedModule } from './shared/shared.module.js';
// import { PostsModule } from './posts/posts.module.js';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { envValidationSchema } from './config/env.validation.js';
import { AuthModule } from './auth/auth.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { CategoriesModule } from './categories/categories.module.js';
import { ProductsModule } from './products/products.module.js';
import { CartsModule } from './carts/carts.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import Keyv from 'keyv';
import KeyvRedis from '@keyv/redis';
import {
  AcceptLanguageResolver,
  HeaderResolver,
  I18nModule,
  QueryResolver,
} from 'nestjs-i18n';
import { UsersModule } from './users/users.module.js';
import { MediaModule } from './media/media.module.js';
import { EventsModule } from './events/events.module.js';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { CacheModule } from '@nestjs/cache-manager';
import { redisStore } from 'cache-manager-redis-yet';
import { BullModule } from '@nestjs/bullmq';
import { QueuesModule } from './queues/queues.module.js';
import { createKeyv } from 'keyv';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    // Distributed tracing, auto-correlated logs, request/job metrics, error
    // telemetry, alarms, and more — out of the box. Sign up at https://observe.nestjs.com
    ObserveModule.forRoot({
      appKey: 'YOUR_APP_KEY',
      appSecret: 'YOUR_APP_SECRET',
      serviceId: 'nestjs-ecommerce',
    }),
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
    }),
    I18nModule.forRoot({
      fallbackLanguage: 'vi',
      loaderOptions: {
        path: `${import.meta.dirname}/i18n/`,
        watch: true,
      },
      resolvers: [
        { use: QueryResolver, options: ['lang'] },      // ?lang=en
        new HeaderResolver(['x-lang']),                 // header x-lang
        AcceptLanguageResolver,                         // Accept-Language
      ],
    }),
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000,   // 1 giây
        limit: 5,    // tối đa 5 request / giây
      },
      {
        name: 'medium',
        ttl: 10000,  // 10 giây
        limit: 20,
      },
      {
        name: 'long',
        ttl: 60000,  // 1 phút
        limit: 100,
      },
    ]),
    CacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const keyv = new Keyv(
          new KeyvRedis(config.get<string>('REDIS_URL', 'redis://localhost:6379')),
        );
        return {
          stores: [keyv],
          ttl: 60_000, // ms — TTL mặc định
        };
      },
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
        },
      }),
    }),
    SharedModule,
    // PostsModule,
    AuthModule,
    PrismaModule,
    CategoriesModule,
    ProductsModule,
    CartsModule,
    OrdersModule,
    PaymentsModule,
    UsersModule,
    MediaModule,
    EventsModule,
    QueuesModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
