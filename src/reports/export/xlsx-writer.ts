import { finished } from 'node:stream/promises';
import type { Writable } from 'node:stream';
import ExcelJS from 'exceljs';
import type { Col, ColType } from '../report-types.js';

export interface XlsxMeta {
  company: string; title: string; subtitle: string; period: string; basisText: string;
  generatedBy: string; generatedAt: Date; filters: string[];
  kpis: { label: string; value: number | string; type: ColType }[];
  notes: string[]; maxRows: number;
}

const BRAND = 'FF1F4E78';
const FMT: Record<ColType, string> = { text: '@', int: '#,##0', money: '#,##0', percent: '0.0%', date: 'dd/mm/yyyy', datetime: 'dd/mm/yyyy hh:mm:ss' };
const ALIGN: Record<ColType, 'left' | 'right' | 'center'> = { text: 'left', int: 'right', money: 'right', percent: 'right', date: 'center', datetime: 'center' };
const WIDTH: Record<ColType, number> = { text: 22, int: 12, money: 20, percent: 14, date: 14, datetime: 20 };
const thin = { style: 'thin' as const, color: { argb: 'FFBFBFBF' } };
const HEADER_ROW = 4;

const cellValue = (v: any, t: ColType) => {
  if (v === null || v === undefined || v === '') return null;
  if (t === 'int' || t === 'money' || t === 'percent') return Number(v);
  if (t === 'date' || t === 'datetime') return v instanceof Date ? v : new Date(v);
  return String(v);
};
const letter = (i: number) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const vnDateTime = (d: Date) => new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'Asia/Ho_Chi_Minh' }).format(d);

export async function writeXlsx(out: Writable, cols: Col[], batches: AsyncIterable<any[]>, m: XlsxMeta): Promise<number> {
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true, useSharedStrings: false });
  wb.creator = m.company; wb.created = m.generatedAt; wb.title = m.title;

  // ===== Sheet 1: Tổng quan (bìa báo cáo) =====
  const cv = wb.addWorksheet('Tổng quan', { views: [{ showGridLines: false }], properties: { tabColor: { argb: BRAND } } });
  cv.columns = [{ width: 3 }, { width: 30 }, { width: 58 }];
  const row = (cells: any[], fn?: (r: ExcelJS.Row) => void) => { const r = cv.addRow(cells); fn?.(r); r.commit(); };
  const section = (t: string) => row(['', t], (r) => {
    r.getCell(2).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    [2, 3].forEach((i) => (r.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } }));
  });
  row([]);
  row(['', m.company.toUpperCase()], (r) => (r.getCell(2).font = { bold: true, size: 11, color: { argb: 'FF7F7F7F' } }));
  row(['', m.title], (r) => { r.height = 32; r.getCell(2).font = { bold: true, size: 20, color: { argb: BRAND } }; });
  row(['', m.subtitle], (r) => (r.getCell(2).font = { italic: true, color: { argb: 'FF595959' } }));
  row([]);
  section('THÔNG TIN BÁO CÁO');
  row(['', 'Kỳ báo cáo', m.period]);
  row(['', 'Cơ sở ngày', m.basisText]);
  row(['', 'Lập bởi', m.generatedBy]);
  row(['', 'Thời điểm lập', vnDateTime(m.generatedAt)]);
  m.filters.forEach((f, i) => row(['', i === 0 ? 'Bộ lọc áp dụng' : '', f]));
  if (!m.filters.length) row(['', 'Bộ lọc áp dụng', 'Không có']);
  row([]);
  section('CHỈ SỐ TỔNG HỢP');
  for (const k of m.kpis) {
    row(['', k.label, k.type === 'text' ? k.value : Number(k.value)], (r) => {
      r.getCell(3).numFmt = FMT[k.type]; r.getCell(3).alignment = { horizontal: 'left' }; r.getCell(3).font = { bold: true };
    });
  }
  row([]);
  section('GHI CHÚ VÀ ĐỊNH NGHĨA');
  m.notes.forEach((n, i) => row(['', `${i + 1}.`, n], (r) => (r.getCell(3).alignment = { wrapText: true, vertical: 'top' })));
  row([]);
  row(['', 'Tài liệu nội bộ, vui lòng không chia sẻ ra ngoài công ty.'], (r) => (r.getCell(2).font = { italic: true, size: 9, color: { argb: 'FF7F7F7F' } }));
  cv.commit();

  // ===== Sheet 2: Dữ liệu =====
  const ws = wb.addWorksheet('Dữ liệu', {
    views: [{ state: 'frozen', ySplit: HEADER_ROW }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${HEADER_ROW}:${HEADER_ROW}` },
    properties: { tabColor: { argb: 'FF2E75B6' } },
  });
  ws.columns = cols.map((c) => ({
    key: c.key, width: c.width ?? WIDTH[c.type],
    style: { numFmt: FMT[c.type], alignment: { horizontal: ALIGN[c.type], vertical: 'middle' } },
  }));
  const title = ws.addRow([m.title]); title.getCell(1).font = { bold: true, size: 14, color: { argb: BRAND } }; title.commit();
  const sub = ws.addRow([`${m.period}  ·  ${m.basisText}`]); sub.getCell(1).font = { italic: true, color: { argb: 'FF595959' } }; sub.commit();
  ws.addRow([]).commit();
  const head = ws.addRow(cols.map((c) => c.header));
  head.height = 32;
  head.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c.border = { top: thin, left: thin, bottom: thin, right: thin };
    c.numFmt = '@';
  });
  head.commit();
  ws.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: HEADER_ROW, column: cols.length } };

  let count = 0;
  const sums: Record<string, number> = {};
  for await (const rows of batches) {
    for (const r of rows) {
      if (++count > m.maxRows) throw new Error(`Vượt giới hạn ${m.maxRows} dòng của một file Excel. Hãy xuất CSV hoặc thu hẹp bộ lọc.`);
      ws.addRow(cols.map((c) => cellValue(r[c.key], c.type))).commit();
      for (const c of cols) if (c.total && r[c.key] != null) sums[c.key] = (sums[c.key] ?? 0) + Number(r[c.key]);
    }
  }

  // Dòng tổng cộng: dùng SUBTOTAL(109) để tổng tự cập nhật khi người dùng lọc trong Excel
  const first = HEADER_ROW + 1, last = HEADER_ROW + count;
  const tot = ws.addRow(cols.map((c, i) =>
    i === 0 ? 'TỔNG CỘNG'
      : c.total ? (count > 0 ? { formula: `SUBTOTAL(109,${letter(i)}${first}:${letter(i)}${last})`, result: sums[c.key] ?? 0 } : 0)
        : null));
  tot.eachCell({ includeEmpty: true }, (c) => {
    c.font = { bold: true };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } };
    c.border = { top: { style: 'medium', color: { argb: BRAND } }, bottom: thin };
  });
  tot.commit();

  await ws.commit();
  await wb.commit();
  await finished(out);
  return count;
}