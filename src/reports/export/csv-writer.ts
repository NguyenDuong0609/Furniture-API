import { once } from 'node:events';
import type { Writable } from 'node:stream';
import type { Col } from '../report-types.js';

export interface CsvOptions { delimiter: ',' | ';' | '\t'; headers: 'label' | 'key' }

const pad = (n: number) => String(n).padStart(2, '0');
// Ngày giờ đã được quy về giờ VN trong SQL, nên dùng getter UTC để không bị lệch thêm
const asDate = (v: any) => (v instanceof Date ? v : new Date(v));
const fmtDate = (v: any) => { const d = asDate(v); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const fmtDateTime = (v: any) => { const d = asDate(v); return `${fmtDate(d)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`; };

export function csvCell(v: any, col: Col, delim: string): string {
  if (v === null || v === undefined || v === '') return '';
  let s: string;
  switch (col.type) {
    case 'int': s = String(Math.trunc(Number(v))); break;
    case 'money': s = String(+Number(v).toFixed(2)); break;           // số thuần, dấu chấm thập phân, không phân tách hàng nghìn
    case 'percent': s = String(+Number(v).toFixed(6)); break;         // tỷ lệ dạng 0.1234
    case 'date': s = fmtDate(v); break;
    case 'datetime': s = fmtDateTime(v); break;
    default:
      s = String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;                        // chặn CSV/formula injection
  }
  return /["\r\n]/.test(s) || s.includes(delim) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function write(out: Writable, chunk: string) {
  if (!out.write(chunk)) await once(out, 'drain');                    // tôn trọng backpressure
}

export async function writeCsv(out: Writable, cols: Col[], batches: AsyncIterable<any[]>, o: CsvOptions): Promise<number> {
  const d = o.delimiter;
  await write(out, '\uFEFF' + cols.map((c) => csvCell(o.headers === 'key' ? c.key : c.header, { ...c, type: 'text' }, d)).join(d) + '\r\n');
  let n = 0;
  for await (const rows of batches) {
    let buf = '';
    for (const r of rows) buf += cols.map((c) => csvCell(r[c.key], c, d)).join(d) + '\r\n';
    n += rows.length;
    await write(out, buf);
  }
  out.end();
  return n;
}