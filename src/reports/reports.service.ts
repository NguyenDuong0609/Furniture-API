import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { REPORTS } from './report-definitions.js';
import { ident, likeEscape } from './report-sql.js';
import type { Col, Cursor, Filters, ReportDef } from './report-types.js';

const AGG_EXPORT_CAP = 100_000;    // báo cáo tổng hợp xuất tối đa chừng này dòng
export const BATCH_ORDERS = 2000;  // số đơn mỗi lô khi đọc báo cáo chi tiết

const encode = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString('base64url');
const decode = (s: string): Cursor => {
  try {
    const c = JSON.parse(Buffer.from(s, 'base64url').toString());
    if (typeof c.ts !== 'string' || !Number.isInteger(c.id)) throw new Error();
    return c;
  } catch { throw new BadRequestException('cursor không hợp lệ'); }
};
const num = (v: any) => (v == null ? v : typeof v === 'bigint' ? Number(v) : v instanceof Prisma.Decimal ? v.toNumber() : v);
const normRow = (r: any) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, num(v)]));
const parseJson = (v: any) => (typeof v === 'string' ? JSON.parse(v) : v);

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) { }

  get(id: string): ReportDef {
    const d = REPORTS.find((r) => r.id === id);
    if (!d) throw new NotFoundException('Báo cáo không tồn tại');
    return d;
  }

  async hasPermission(userId: number, name: string) {
    return (await this.prisma.rolePermission.count({
      where: { permission: { name }, role: { users: { some: { userId } } } },
    })) > 0;
  }

  async catalog(userId: number) {
    const canPii = await this.hasPermission(userId, 'report:pii');
    const [categories, brands] = await Promise.all([
      this.prisma.category.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.brand.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ]);
    return {
      canPii,
      reports: REPORTS.map((r) => ({
        id: r.id, group: r.group, title: r.title, description: r.description, filters: r.filters,
        sortable: r.sortable, defaultSort: r.defaultSort, defaultDir: r.defaultDir, detail: !!r.detail,
        searchable: !!r.searchCols?.length || r.id === 'order-lines',
        columns: r.columns.filter((c) => canPii || !c.pii),
      })),
      lookups: {
        categories, brands,
        paymentMethods: ['COD', 'BANK_TRANSFER', 'VNPAY', 'SEPAY_BANK_TRANSFER', 'SEPAY_CARD', 'SEPAY_NAPAS_BANK_TRANSFER'],
        statuses: ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPING', 'DELIVERED', 'CANCELLED', 'REFUNDED'],
      },
    };
  }

  private visibleCols(def: ReportDef, canPii: boolean): Col[] {
    return def.columns.filter((c) => canPii || !c.pii);
  }
  private strip(rows: any[], def: ReportDef, canPii: boolean) {
    if (canPii) return rows;
    const hide = def.columns.filter((c) => c.pii).map((c) => c.key);
    return rows.map((r) => { const o = { ...r }; hide.forEach((k) => delete o[k]); return o; });
  }

  private sortOf(def: ReportDef, f: Filters) {
    const key = f.sortBy ?? def.defaultSort;
    if (!def.sortable.includes(key)) throw new BadRequestException(`Không thể sắp xếp theo "${key}"`);
    return { key, dir: (f.sortDir ?? def.defaultDir) === 'asc' ? 'ASC' : 'DESC' };
  }

  private searchSql(def: ReportDef, f: Filters) {
    if (!f.q || !def.searchCols?.length) return Prisma.empty;
    const like = `%${likeEscape(f.q)}%`;
    return Prisma.sql`WHERE ${Prisma.join(def.searchCols.map((c) => Prisma.sql`${ident(c)}::text ILIKE ${like}`), ' OR ')}`;
  }

  // Một lần chạy truy vấn gốc, trả về: tổng số dòng, một trang dòng, và tổng các cột cộng được
  private async agg(def: ReportDef, f: Filters, limit: number, offset: number) {
    const { key, dir } = this.sortOf(def, f);
    const sums = def.columns.filter((c) => c.total).map((c) => Prisma.sql`SUM(${ident(c.key)}) AS ${ident(c.key)}`);
    const sumsSql = sums.length
      ? Prisma.sql`(SELECT row_to_json(z) FROM (SELECT ${Prisma.join(sums, ', ')} FROM s) z)`
      : Prisma.sql`NULL::json`;
    const [r] = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      WITH t AS MATERIALIZED (${def.build!(f)}),
      s AS (SELECT * FROM t ${this.searchSql(def, f)})
      SELECT (SELECT COUNT(*)::int FROM s) AS total,
             (SELECT COALESCE(json_agg(x), '[]'::json)
                FROM (SELECT * FROM s ORDER BY ${ident(key)} ${Prisma.raw(dir)} NULLS LAST, 1
                      LIMIT ${limit} OFFSET ${offset}) x) AS rows,
             ${sumsSql} AS sums`);
    return { total: Number(r.total), rows: parseJson(r.rows) as any[], sums: (parseJson(r.sums) ?? {}) as Record<string, number> };
  }

  async list(def: ReportDef, f: Filters, canPii: boolean) {
    const columns = this.visibleCols(def, canPii);
    if (def.detail) {
      const cur = f.cursor ? decode(f.cursor) : null;
      const rows = (await this.prisma.$queryRaw<any[]>(def.detail.batch(f, cur, f.limit))).map(normRow);
      const last = rows.at(-1);
      return {
        columns, rows: this.strip(rows, def, canPii), nextCursor: last ? encode({ ts: last.cursor_ts, id: Number(last.order_id) }) : null,
      };
    }
    const { total, rows, sums } = await this.agg(def, f, f.limit, (f.page - 1) * f.limit);
    return { columns, rows: this.strip(rows, def, canPii), total, sums, page: f.page, limit: f.limit };
  }

  async summary(def: ReportDef, f: Filters): Promise<{ total: number; totalLabel: string; sums: Record<string, number> }> {
    if (def.detail) {
      const [r] = await this.prisma.$queryRaw<any[]>(def.detail.summary(f));
      const { total, ...sums } = normRow(r);
      return { total, totalLabel: def.detail.totalLabel, sums };
    }
    const { total, sums } = await this.agg(def, f, 0, 0);
    return { total, totalLabel: 'Số dòng', sums };
  }

  // Đọc toàn bộ dữ liệu theo lô để export. Bộ nhớ luôn bị chặn bởi kích thước lô.
  async *iterate(def: ReportDef, f: Filters, canPii: boolean, opts: { batchOrders?: number } = {}): AsyncGenerator<any[]> {
    if (def.detail) {
      let cur: Cursor | null = null;
      for (; ;) {
        const batchRows: any[] = (await this.prisma.$queryRaw<any[]>(def.detail.batch(f, cur, opts.batchOrders ?? BATCH_ORDERS))).map(normRow);
        if (batchRows.length === 0) return;
        const last = batchRows[batchRows.length - 1];
        cur = { ts: last.cursor_ts, id: Number(last.order_id) };
        yield this.strip(batchRows, def, canPii);
      }
    }
    const { key, dir } = this.sortOf(def, f);
    const rows = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT * FROM (${def.build!(f)}) t ${this.searchSql(def, f)}
      ORDER BY ${ident(key)} ${Prisma.raw(dir)} NULLS LAST, 1 LIMIT ${AGG_EXPORT_CAP + 1}`);
    if (rows.length > AGG_EXPORT_CAP) {
      throw new BadRequestException(`Báo cáo vượt ${AGG_EXPORT_CAP} dòng. Hãy thu hẹp bộ lọc hoặc dùng báo cáo "Bảng kê chi tiết bán hàng".`);
    }
    for (let i = 0; i < rows.length; i += 5000) yield this.strip(rows.slice(i, i + 5000).map(normRow), def, canPii);
  }
}