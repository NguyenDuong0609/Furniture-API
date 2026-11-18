import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../shared/decorators/permissions.decorator.js';
import { SepayAdminService } from './sepay-admin.service.js';

const Statuses = ['PENDING', 'PAID', 'FAILED', 'CANCELLED', 'VOIDED', 'REVIEW', 'REFUNDED'] as const;
class ListQueryDto extends createZodDto(z.object({
    status: z.enum(Statuses).default('REVIEW'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
})) { }
class PageQueryDto extends createZodDto(z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
})) { }
class AcceptDto extends createZodDto(z.object({ note: z.string().max(300).optional() })) { }
class RefundDto extends createZodDto(z.object({ note: z.string().min(3).max(300) })) { }

@ApiTags('Payments')
@ApiBearerAuth('access-token')
@Controller('admin/payments')
@UseGuards(PermissionsGuard)          // JwtAuthGuard đã chạy toàn cục nên req.user có sẵn
export class SepayAdminController {
    constructor(private readonly service: SepayAdminService) { }

    @Get()
    @RequirePermissions('payment:read')
    list(@Query() q: ListQueryDto) {
        return this.service.list(q.status, q.page, q.limit);
    }

    @Get('unmatched')                    // khai báo trước ':id' để không bị nuốt route
    @RequirePermissions('payment:read')
    unmatched(@Query() q: PageQueryDto) {
        return this.service.unmatched(q.page, q.limit);
    }

    @Get(':id')
    @RequirePermissions('payment:read')
    detail(@Param('id', ParseIntPipe) id: number) {
        return this.service.detail(id);
    }

    @Post(':id/accept')
    @RequirePermissions('payment:resolve')
    accept(@Param('id', ParseIntPipe) id: number, @Body() dto: AcceptDto, @Req() req: any) {
        return this.service.accept(id, req.user.id, dto.note);
    }

    @Post(':id/refunded')
    @RequirePermissions('payment:resolve')
    refunded(@Param('id', ParseIntPipe) id: number, @Body() dto: RefundDto, @Req() req: any) {
        return this.service.markRefunded(id, req.user.id, dto.note);
    }
}