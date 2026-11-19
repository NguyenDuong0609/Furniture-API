import { Prisma } from '@prisma/client';
import type { Filters } from './report-types.js';

export const TZ = 'Asia/Ho_Chi_Minh';
export const raw = (s: string) => Prisma.raw(s);
export const ident = (c: string) => Prisma.raw(`"${c}"`);
export const and = (parts: Prisma.Sql[]) => Prisma.join(parts, ' AND ');
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => '\\' + m);

// Prisma lưu DateTime là UTC không kèm múi giờ → đổi sang giờ Việt Nam
export const local = (expr: string) => raw(`((${expr} AT TIME ZONE 'UTC') AT TIME ZONE '${TZ}')`);

// Cột ngày dùng để lọc/nhóm: ngày thu tiền hoặc ngày đặt hàng
export const dc = (f: Filters, a = 'o') => `${a}.${f.basis === 'PAID' ? '"paidAt"' : '"createdAt"'}`;

// [from 00:00, to+1 00:00) theo giờ VN, quy về UTC để dùng được index
export const range = (col: string, f: Filters) => Prisma.sql`
  ${raw(col)} >= (${f.from}::date::timestamp AT TIME ZONE ${TZ}) AT TIME ZONE 'UTC'
  AND ${raw(col)} < ((${f.to}::date + 1)::timestamp AT TIME ZONE ${TZ}) AT TIME ZONE 'UTC'`;

export function orderConds(f: Filters, a = 'o', revenueOnly = true): Prisma.Sql[] {
  const c: Prisma.Sql[] = [range(dc(f, a), f)];
  if (revenueOnly) c.push(raw(`${a}."paymentStatus" = 'PAID' AND ${a}.status NOT IN ('CANCELLED', 'REFUNDED')`));
  if (f.paymentMethod) c.push(Prisma.sql`${raw(a)}."paymentMethod" = ${f.paymentMethod}`);
  if (f.city) c.push(Prisma.sql`${raw(a)}."shippingCity" = ${f.city}`);
  return c;
}

export const catBrandConds = (f: Filters): Prisma.Sql[] => [
  ...(f.categoryId ? [Prisma.sql`p."categoryId" = ${f.categoryId}`] : []),
  ...(f.brandId ? [Prisma.sql`p."brandId" = ${f.brandId}`] : []),
];

export const ITEM_FROM = Prisma.sql`FROM "OrderItem" oi
  JOIN "Order" o ON o.id = oi."orderId"
  JOIN "Product" p ON p.id = oi."productId"
  LEFT JOIN "Category" c ON c.id = p."categoryId"
  LEFT JOIN "Brand" b ON b.id = p."brandId"`;

export const itemConds = (f: Filters) => and([...orderConds(f), ...catBrandConds(f)]);

// Nhãn kỳ (đầu vào đã được zod giới hạn trong 5 giá trị)
export const labelSql = (unit: Filters['groupBy'], col: string) =>
  raw({
    day: `to_char(${col}, 'YYYY-MM-DD')`,
    week: `to_char(${col}, 'IYYY-"W"IW')`,
    month: `to_char(${col}, 'YYYY-MM')`,
    quarter: `to_char(${col}, 'YYYY') || '-Q' || to_char(${col}, 'Q')`,
    year: `to_char(${col}, 'YYYY')`,
  }[unit]);