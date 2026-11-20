import { BadRequestException, HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma, type ReportExport } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { stat, unlink } from 'node:fs/promises';
import { finished } from 'node:stream/promises';
import { join } from 'node:path';
import type { Writable } from 'node:stream';
import { createGzip } from 'node:zlib';
import type { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service.js';
import { FiltersSchema, type Filters, type ReportDef } from '../report-types.js';
import { ReportsService } from '../reports.service.js';
import { writeCsv, type CsvOptions } from './csv-writer.js';
import { writeXlsx } from './xlsx-writer.js';
import { describeAdv } from './report-advanced.js';

export interface ExportOptions extends CsvOptions { format: 'csv' | 'xlsx'; gzip: boolean }

const SYNC_MAX_ORDERS = 0;          // luôn chạy async để lưu file
const XLSX_MAX_ROWS = 1_000_000;
const MAX_ACTIVE_PER_USER = 3;
const RETENTION_DAYS = 7;
const MIME = { csv: 'text/csv; charset=utf-8', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

@Injectable()
export class ReportExportService {
  private readonly logger = new Logger(ReportExportService.name);
  private running = false;
  private readonly dir: string;
  private readonly secret: string;
  private readonly company: string;

  constructor(private readonly prisma: PrismaService, private readonly reports: ReportsService, config: ConfigService) {
    this.dir = config.get<string>('REPORT_EXPORT_DIR') ?? './exports';
    this.secret = config.getOrThrow<string>('REPORT_DOWNLOAD_SECRET');
    this.company = config.get<string>('REPORT_COMPANY_NAME') ?? 'Furniture Store';
    mkdirSync(this.dir, { recursive: true });
  }

  // ---------- Tiếp nhận yêu cầu ----------
  async request(userId: number, reportId: string, filters: Filters, opts: ExportOptions) {
    const def = this.reports.get(reportId);
    const active = await this.prisma.reportExport.count({ where: { userId, status: { in: ['QUEUED', 'RUNNING'] } } });
    if (active >= MAX_ACTIVE_PER_USER) throw new HttpException('Bạn đang có quá nhiều báo cáo đang xử lý, vui lòng đợi.', 429);

    const includePii = await this.reports.hasPermission(userId, 'report:pii');
    this.reports.resolveAdv(def, filters, includePii);      // báo lỗi 400/403 ngay, không để job nền thất bại sau đó

    // Luôn chạy async để lưu file
    const mode: 'sync' | 'async' = 'async';

    // Validate XLSX max rows cho báo cáo detail (đã tính cả bộ lọc nâng cao)
    if (def.detail && opts.format === 'xlsx') {
      const n = await this.reports.countOrders(def, filters, XLSX_MAX_ROWS, includePii);
      if (n > XLSX_MAX_ROWS) {
        throw new BadRequestException('Dữ liệu quá lớn cho một file Excel. Hãy xuất CSV hoặc chia nhỏ theo khoảng thời gian.');
      }
    }

    const rec = await this.prisma.reportExport.create({
      data: {
        userId, reportId, format: opts.format, includePii,
        filters: filters as unknown as Prisma.InputJsonValue, options: opts as unknown as Prisma.InputJsonValue,
        status: 'QUEUED',
        startedAt: null,
      },
    });
    return { mode, rec };
  }

  // ---------- Chạy đồng bộ: ghi thẳng vào response ----------
  async runSync(rec: ReportExport, res: Response) {
    const opts = rec.options as unknown as ExportOptions;
    const f = rec.filters as unknown as Filters;
    const ext = opts.format;
    res.setHeader('Content-Type', MIME[ext]);
    res.setHeader('Content-Disposition', `attachment; filename="${this.fileName(rec.reportId, f, ext)}"`);
    res.setHeader('Cache-Control', 'no-store');
    try {
      const rows = await this.streamReport(this.reports.get(rec.reportId), f, opts, res, rec);
      await this.prisma.reportExport.update({ where: { id: rec.id }, data: { status: 'DONE', rowCount: rows, finishedAt: new Date() } });
    } catch (e: any) {
      this.logger.error(`Export ${rec.id} lỗi: ${e?.message}`);
      await this.prisma.reportExport.update({ where: { id: rec.id }, data: { status: 'FAILED', error: String(e?.message).slice(0, 500), finishedAt: new Date() } });
      res.destroy(e);                                    // file đã bắt đầu gửi nên không thể trả JSON lỗi nữa
    }
  }

  // ---------- Dùng chung cho đồng bộ và nền ----------
  private async streamReport(def: ReportDef, f: Filters, opts: ExportOptions, out: Writable, rec: ReportExport): Promise<number> {
    const cols = def.columns.filter((c) => rec.includePii || !c.pii);
    let n = 0;
    const src = this.reports.iterate(def, f, rec.includePii);
    async function* counted() { for await (const b of src) { n += b.length; yield b; } }

    if (opts.format === 'csv') return writeCsv(out, cols, counted(), opts);

    const [sum, user] = await Promise.all([
      this.reports.summary(def, f, rec.includePii),          // thêm tham số quyền
      this.prisma.user.findUnique({ where: { id: rec.userId }, select: { name: true, email: true } }),
    ]);
    const filterLines = Object.entries({
      'Danh mục (ID)': f.categoryId, 'Thương hiệu (ID)': f.brandId, 'Thanh toán': f.paymentMethod,
      'Tỉnh/Thành': f.city, 'Trạng thái đơn': f.status, 'Tìm kiếm': f.q,
    }).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}: ${v}`);
    const advLines = describeAdv(this.reports.resolveAdv(def, f, rec.includePii)).map((s) => `Lọc cột: ${s}`);
    return writeXlsx(out, cols, counted(), {
      company: this.company, title: def.title, subtitle: def.description,
      period: `Từ ${f.from.split('-').reverse().join('/')} đến ${f.to.split('-').reverse().join('/')}`,
      basisText: f.basis === 'PAID' ? 'Ngày thu tiền' : 'Ngày đặt hàng',
      generatedBy: user?.name ?? user?.email ?? `User #${rec.userId}`, generatedAt: new Date(), filters: filterLines,
      kpis: [
        { label: sum.totalLabel, value: sum.total, type: 'int' },
        ...def.columns.filter((c) => c.total && (rec.includePii || !c.pii))
          .map((c) => ({ label: `Tổng ${c.header.toLowerCase()}`, value: sum.sums[c.key] ?? 0, type: c.type })),
      ],
      notes: def.notes, maxRows: XLSX_MAX_ROWS,
    });
  }

  // ---------- Worker nền ----------
  @Cron(CronExpression.EVERY_10_SECONDS)
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.prisma.reportExport.updateMany({
        where: { status: 'RUNNING', startedAt: { lt: new Date(Date.now() - 2 * 3600_000) } },
        data: { status: 'FAILED', error: 'Quá thời gian xử lý', finishedAt: new Date() },
      });
      const next = await this.prisma.reportExport.findFirst({ where: { status: 'QUEUED' }, orderBy: { createdAt: 'asc' } });
      if (!next) return;
      const claim = await this.prisma.reportExport.updateMany({ where: { id: next.id, status: 'QUEUED' }, data: { status: 'RUNNING', startedAt: new Date() } });
      if (claim.count === 0) return;
      await this.runJob(next);
    } catch (e) {
      this.logger.error(e, 'Export worker failed');
    } finally {
      this.running = false;
    }
  }

  private async runJob(rec: ReportExport) {
    const opts = rec.options as unknown as ExportOptions;
    const f = FiltersSchema.parse(rec.filters);
    const path = join(this.dir, `${rec.id}.${opts.format}${opts.gzip ? '.gz' : ''}`);
    const file = createWriteStream(path);
    const fileDone = finished(file); fileDone.catch(() => undefined);
    const gz = opts.gzip ? createGzip() : null;
    gz?.pipe(file);
    try {
      const rows = await this.streamReport(this.reports.get(rec.reportId), f, opts, (gz ?? file) as Writable, rec);
      await fileDone;
      await this.prisma.reportExport.update({
        where: { id: rec.id },
        data: {
          status: 'DONE', rowCount: rows, filePath: path, fileSize: (await stat(path)).size,
          finishedAt: new Date(), expiresAt: new Date(Date.now() + RETENTION_DAYS * 86_400_000),
        },
      });
    } catch (e: any) {
      this.logger.error(`Export job ${rec.id} lỗi: ${e?.message}`);
      file.destroy(); await unlink(path).catch(() => undefined);
      await this.prisma.reportExport.update({ where: { id: rec.id }, data: { status: 'FAILED', error: String(e?.message).slice(0, 500), finishedAt: new Date() } });
    }
  }

  @Cron('0 3 * * *')
  async cleanup() {
    const old = await this.prisma.reportExport.findMany({ where: { status: 'DONE', expiresAt: { lt: new Date() } } });
    for (const r of old) {
      if (r.filePath) await unlink(r.filePath).catch(() => undefined);
      await this.prisma.reportExport.update({ where: { id: r.id }, data: { status: 'EXPIRED', filePath: null } });
    }
  }

  // ---------- Trạng thái, lịch sử, tải file ----------
  async getMine(userId: number, id: string) {
    const r = await this.prisma.reportExport.findUnique({ where: { id } });
    if (!r || r.userId !== userId) throw new NotFoundException();
    const { filePath, filters, options, ...pub } = r;
    return pub;
  }

  listMine(userId: number) {
    return this.prisma.reportExport.findMany({
      where: { userId }, orderBy: { createdAt: 'desc' }, take: 50,
      select: { id: true, reportId: true, format: true, status: true, rowCount: true, fileSize: true, error: true, createdAt: true, finishedAt: true, expiresAt: true },
    });
  }

  signLink(userId: number, id: string, ttlSec = 120) {
    const p = `${id}.${userId}.${Math.floor(Date.now() / 1000) + ttlSec}`;
    const sig = createHmac('sha256', this.secret).update(p).digest('base64url');
    return `${Buffer.from(p).toString('base64url')}.${sig}`;
  }

  async openDownload(token: string) {
    const [b, sig] = token.split('.');
    const p = Buffer.from(b ?? '', 'base64url').toString();
    const expect = createHmac('sha256', this.secret).update(p).digest('base64url');
    const ok = sig && sig.length === expect.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expect));
    const [id, , exp] = p.split('.');
    if (!ok || Number(exp) < Date.now() / 1000) throw new BadRequestException('Link tải không hợp lệ hoặc đã hết hạn');
    const r = await this.prisma.reportExport.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Không tìm thấy export');
    if (r.status !== 'DONE') throw new BadRequestException(`Export chưa hoàn thành. Trạng thái hiện tại: ${r.status}`);
    if (!r.filePath) throw new BadRequestException('Export này được chạy ở chế độ đồng bộ (sync) và không lưu file. Hãy export lại để tải file.');
    if (!existsSync(r.filePath)) throw new NotFoundException('File không còn tồn tại (có thể đã bị xóa hoặc hết hạn)');
    const o = r.options as unknown as ExportOptions;
    return {
      stream: createReadStream(r.filePath), size: r.fileSize,
      name: this.fileName(r.reportId, r.filters as unknown as Filters, o.format, o.gzip),
      mime: o.gzip ? 'application/gzip' : MIME[o.format],
    };
  }

  private fileName(reportId: string, f: Filters, ext: string, gz = false) {
    return `${reportId}_${f.from}_${f.to}.${ext}${gz ? '.gz' : ''}`;
  }
}