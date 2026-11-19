import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PermissionsGuard } from '../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../shared/decorators/permissions.decorator.js';
import { Public } from '../shared/decorators/public.decorator.js';
import { ReportExportService } from './export/report-export.service.js';
import { BaseFilters, FiltersSchema, fromBeforeTo } from './report-types.js';
import { ReportsService } from './reports.service.js';

class FiltersDto extends createZodDto(FiltersSchema) { }
class ExportDto extends createZodDto(
  BaseFilters.extend({
    format: z.enum(['csv', 'xlsx']),
    delimiter: z.enum([',', ';', '\t']).default(','),
    headers: z.enum(['label', 'key']).default('label'),
    gzip: z.boolean().default(false),
  }).refine(fromBeforeTo, { message: 'from phải ≤ to', path: ['from'] }),
) { }

@ApiTags('Reports')
@ApiBearerAuth('access-token')
@Controller('admin/reports')
@UseGuards(PermissionsGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService, private readonly exports: ReportExportService) { }

  @Get() @RequirePermissions('report:read')
  catalog(@Req() req: any) { return this.reports.catalog(req.user.id); }

  // --- các route 'exports/...' phải đứng TRƯỚC ':id' ---
  @Get('exports') @RequirePermissions('report:export')
  history(@Req() req: any) { return this.exports.listMine(req.user.id); }

  @Public()                                              // xác thực bằng token ký trong URL, để trình duyệt tải trực tiếp file lớn
  @Get('exports/download')
  async download(@Query('token') token: string, @Res() res: Response) {
    const f = await this.exports.openDownload(token);
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${f.name}"`);
    if (f.size) res.setHeader('Content-Length', String(f.size));
    f.stream.pipe(res);
  }

  @Get('exports/:exportId') @RequirePermissions('report:export')
  exportStatus(@Param('exportId', ParseUUIDPipe) id: string, @Req() req: any) { return this.exports.getMine(req.user.id, id); }

  @Post('exports/:exportId/link') @RequirePermissions('report:export')
  async link(@Param('exportId', ParseUUIDPipe) id: string, @Req() req: any) {
    await this.exports.getMine(req.user.id, id);          // kiểm tra quyền sở hữu
    return { url: `/admin/reports/exports/download?token=${this.exports.signLink(req.user.id, id)}` };
  }

  @Get(':id') @RequirePermissions('report:read')
  async data(@Param('id') id: string, @Query() q: FiltersDto, @Req() req: any) {
    const def = this.reports.get(id);
    const canPii = await this.reports.hasPermission(req.user.id, 'report:pii');
    return this.reports.list(def, q, canPii);
  }

  @Post(':id/export') @RequirePermissions('report:export')
  async export(@Param('id') id: string, @Body() dto: ExportDto, @Req() req: any, @Res() res: Response) {
    const { format, delimiter, headers, gzip, ...filters } = dto;
    const { mode, rec } = await this.exports.request(req.user.id, id, filters, { format, delimiter, headers, gzip });
    if (mode === 'async') return res.status(202).json({ mode: 'async', exportId: rec.id });
    return this.exports.runSync(rec, res);
  }
}