import type { Prisma } from '@prisma/client';
import { z } from 'zod';

export type ColType = 'text' | 'int' | 'money' | 'percent' | 'date' | 'datetime';
export interface Col {
  key: string; header: string; type: ColType;
  width?: number; total?: 'sum'; pii?: boolean;
}

const isRealDate = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);   // loại 2026-02-31
};
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isRealDate, 'Ngày không hợp lệ');

export const BaseFilters = z.object({
  from: dateStr,
  to: dateStr,
  basis: z.enum(['PAID', 'ORDER']).default('PAID'),            // tính theo ngày thu tiền hoặc ngày đặt hàng
  groupBy: z.enum(['day', 'week', 'month', 'quarter', 'year']).default('month'),
  categoryId: z.coerce.number().int().positive().optional(),
  brandId: z.coerce.number().int().positive().optional(),
  paymentMethod: z.string().max(40).optional(),
  city: z.string().max(80).optional(),
  status: z.enum(['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPING', 'DELIVERED', 'CANCELLED', 'REFUNDED']).optional(),
  metric: z.enum(['quantity', 'revenue']).default('quantity'),
  dimension: z.enum(['category', 'brand']).default('category'),
  maxUnits: z.coerce.number().int().min(0).default(0),
  q: z.string().trim().max(100).optional(),
  // Bộ lọc nâng cao theo cột: chuỗi JSON (GET) hoặc object (POST). Được kiểm tra chi tiết trong report-advanced.ts
  adv: z.union([z.string().max(4000), z.record(z.string().max(40), z.unknown())]).optional(),
  sortBy: z.string().max(40).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(200).optional(),
});
export const fromBeforeTo = (f: { from: string; to: string }) => f.from <= f.to;
export const FiltersSchema = BaseFilters.refine(fromBeforeTo, { message: 'from phải ≤ to', path: ['from'] });
export type Filters = z.infer<typeof BaseFilters>;

export type FilterKey =
  | 'basis' | 'groupBy' | 'categoryId' | 'brandId' | 'paymentMethod' | 'city'
  | 'status' | 'metric' | 'dimension' | 'maxUnits';

export interface Cursor { ts: string; id: number }

// ---- Bộ lọc nâng cao theo cột ----
export type AdvKind = 'text' | 'number' | 'enum';
export interface AdvSpec {
  key: string;                         // khóa trong `adv`, thường trùng key của cột
  label: string; kind: AdvKind;
  level: 'result' | 'order' | 'line';  // result: sau tổng hợp · order/line: trong truy vấn chi tiết
  options?: string[];                  // kind = enum
  unit?: string;                       // hiển thị: VND, %, SL
  percent?: boolean;                   // cột tỷ lệ: API dùng 0–1, UI hiển thị %
  sql?: string;                        // level order/line: biểu thức cột SQL đích (hằng số do server khai báo)
  pii?: boolean;                       // cần quyền report:pii
}
export interface AdvCond { spec: AdvSpec; contains?: string; min?: number; max?: number; in?: string[] }

export interface ReportDef {
  id: string; title: string; description: string; group: string;
  columns: Col[]; filters: FilterKey[];
  searchCols?: string[];                 // cột được tìm kiếm nhanh (báo cáo tổng hợp)
  advanced?: AdvSpec[];                  // ghi đè/bổ sung bộ lọc nâng cao (mặc định tự sinh từ cột)
  advExclude?: string[];                 // cột không cho lọc nâng cao
  sortable: string[]; defaultSort: string; defaultDir: 'asc' | 'desc';
  notes: string[];                       // định nghĩa số liệu, in trong file Excel
  build?: (f: Filters) => Prisma.Sql;    // báo cáo tổng hợp
  detail?: {                             // báo cáo chi tiết: đọc theo lô, không giới hạn số dòng
    totalLabel: string;
    batch: (f: Filters, cur: Cursor | null, orders: number, adv: AdvCond[]) => Prisma.Sql;
    summary: (f: Filters, adv: AdvCond[]) => Prisma.Sql;
    countCapped: (f: Filters, cap: number, adv: AdvCond[]) => Prisma.Sql;
  };
}