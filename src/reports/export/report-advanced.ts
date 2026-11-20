import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ident, likeEscape, raw } from '../report-sql.js';
import type { AdvCond, AdvSpec, ReportDef } from '../report-types.js';

// ---- 1. Danh sách bộ lọc của một báo cáo ----
// Báo cáo tổng hợp: tự sinh từ cột (chữ → "chứa", số → khoảng Min–Max). `def.advanced` ghi đè theo key.
// Báo cáo chi tiết: phải khai báo tường minh (cần biết cột SQL đích và tầng áp dụng).
export function advancedOf(def: ReportDef): AdvSpec[] {
    const derived: AdvSpec[] = def.detail ? [] : def.columns
        .filter((c) => c.type !== 'date' && c.type !== 'datetime' && !def.advExclude?.includes(c.key))
        .map((c) => ({
            key: c.key, label: c.header, level: 'result' as const, pii: c.pii,
            kind: c.type === 'text' ? ('text' as const) : ('number' as const),
            ...(c.type === 'percent' ? { percent: true, unit: '%' } : c.type === 'money' ? { unit: 'VND' } : {}),
        }));
    const map = new Map(derived.map((s) => [s.key, s]));
    for (const s of def.advanced ?? []) map.set(s.key, { ...map.get(s.key), ...s });
    return [...map.values()];
}

// ---- 2. Kiểm tra đầu vào ----
const Num = z.union([z.number(), z.string().trim().min(1).transform(Number)])
    .pipe(z.number().refine(Number.isFinite, 'Số không hợp lệ'));
const Cond = z.strictObject({
    contains: z.string().trim().min(1).max(100).optional(),
    min: Num.optional(),
    max: Num.optional(),
    in: z.array(z.string().min(1).max(40)).min(1).max(10).optional(),
});
const AdvInput = z.record(z.string().max(40), Cond);

export function resolveAdv(def: ReportDef, input: unknown, canPii: boolean): AdvCond[] {
    if (input === undefined || input === null || input === '') return [];
    let obj: unknown = input;
    if (typeof input === 'string') {
        try { obj = JSON.parse(input); } catch { throw new BadRequestException('adv không phải JSON hợp lệ'); }
    }
    const parsed = AdvInput.safeParse(obj);
    if (!parsed.success) throw new BadRequestException(`adv không hợp lệ: ${parsed.error.issues[0]?.message ?? ''}`);
    if (Object.keys(parsed.data).length > 20) throw new BadRequestException('adv: tối đa 20 bộ lọc');

    const specs = new Map(advancedOf(def).map((s) => [s.key, s]));
    const out: AdvCond[] = [];
    for (const [key, c] of Object.entries(parsed.data)) {
        const spec = specs.get(key);
        if (!spec) throw new BadRequestException(`Báo cáo không hỗ trợ lọc theo "${key}"`);
        // Lọc theo cột cá nhân cũng làm lộ thông tin (dò xem một SĐT có tồn tại không), nên cần cùng quyền với việc xem cột
        if (spec.pii && !canPii) throw new ForbiddenException(`Bạn không có quyền lọc theo "${spec.label}"`);

        const allowed = spec.kind === 'text' ? ['contains'] : spec.kind === 'number' ? ['min', 'max'] : ['in'];
        for (const op of Object.keys(c)) {
            if (!allowed.includes(op)) throw new BadRequestException(`"${key}" không hỗ trợ toán tử "${op}"`);
        }
        if (c.min !== undefined && c.max !== undefined && c.min > c.max) throw new BadRequestException(`"${key}": min phải ≤ max`);
        if (spec.kind === 'enum') {
            const bad = c.in?.filter((v) => !spec.options?.includes(v));
            if (bad?.length) throw new BadRequestException(`"${key}": giá trị không hợp lệ (${bad.join(', ')})`);
        }
        if (Object.keys(c).length) out.push({ spec, ...c });
    }
    return out;
}

// ---- 3. SQL ----
// Cột đích lấy từ khai báo ở server, không bao giờ từ chuỗi người dùng gửi.
const target = (a: AdvCond) => (a.spec.level === 'result' ? ident(a.spec.key) : raw(a.spec.sql!));

export function condSql(a: AdvCond): Prisma.Sql[] {
    const t = target(a);
    const out: Prisma.Sql[] = [];
    if (a.contains !== undefined) out.push(Prisma.sql`${t}::text ILIKE ${'%' + likeEscape(a.contains) + '%'}`);
    if (a.min !== undefined) out.push(Prisma.sql`${t} >= ${a.min}::numeric`);      // kiểm tra !== undefined để giá trị 0 vẫn được lọc
    if (a.max !== undefined) out.push(Prisma.sql`${t} <= ${a.max}::numeric`);
    if (a.in?.length) out.push(Prisma.sql`${t}::text IN (${Prisma.join(a.in)})`);
    return out;
}
export const advBy = (adv: AdvCond[], level: AdvSpec['level']) =>
    adv.filter((a) => a.spec.level === level).flatMap(condSql);

// ---- 4. Mô tả bằng chữ (bìa Excel) ----
const nf = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });
const fmtN = (s: AdvSpec, n: number) =>
    s.percent ? `${nf.format(n * 100)}%` : `${nf.format(n)}${s.unit && s.unit !== '%' ? ' ' + s.unit : ''}`;

export function describeAdv(adv: AdvCond[]): string[] {
    return adv.map((a) => {
        const l = a.spec.label;
        if (a.contains !== undefined) return `${l} chứa "${a.contains}"`;
        if (a.in?.length) return `${l}: ${a.in.join(', ')}`;
        if (a.min !== undefined && a.max !== undefined) return `${l}: từ ${fmtN(a.spec, a.min)} đến ${fmtN(a.spec, a.max)}`;
        if (a.min !== undefined) return `${l} ≥ ${fmtN(a.spec, a.min)}`;
        return `${l} ≤ ${fmtN(a.spec, a.max!)}`;
    });
}