import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';
import Database from 'better-sqlite3';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const connectionString = process.env.DATABASE_URL || 'file:./prisma/dev.db';
    const dbPath = connectionString.replace(/^file:/, '');

    // Sửa lại cách khởi tạo adapter bằng object chứa url
    const adapter = new PrismaBetterSqlite3({
      url: dbPath,
    } as any);

    super({
      log: process.env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['error'],
      adapter,
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Helper: Clean database (dùng cho testing)
   */
  async cleanDatabase() {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Không được clean database ở production!');
    }

    // Xóa theo thứ tự quan hệ
    await this.refreshToken.deleteMany();
    //await this.post.deleteMany();
    await this.user.deleteMany();
  }
}
