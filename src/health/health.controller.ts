import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Public } from '../shared/decorators/public.decorator.js';

@Controller('health')
export class HealthController {
    constructor(private readonly prisma: PrismaService) { }

    @Public()
    @Get()
    live() {
        return { status: 'ok', timestamp: new Date().toISOString() };
    }

    @Public()
    @Get('ready')
    async ready() {
        try {
            await this.prisma.$queryRaw`SELECT 1`;
            return {
                status: 'ready',
                database: 'up',
                timestamp: new Date().toISOString(),
            };
        } catch {
            return {
                status: 'not_ready',
                database: 'down',
                timestamp: new Date().toISOString(),
            };
        }
    }
}