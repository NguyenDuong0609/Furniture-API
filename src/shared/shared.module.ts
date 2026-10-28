import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { HashingService } from './hashing.service.js';

@Global()
@Module({
  providers: [PrismaService, HashingService],
  exports: [PrismaService, HashingService],
})
export class SharedModule {}
