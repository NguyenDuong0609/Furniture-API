import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { Col } from '../report-types.js';
import { csvCell, writeCsv } from './csv-writer.js';

const collect = () => {
    const chunks: string[] = [];
    const w = new Writable({ write(c, _e, cb) { chunks.push(c.toString()); cb(); } });
    return { w, text: () => chunks.join('') };
};
async function* one(rows: any[]) { yield rows; }
const col = (type: Col['type']): Col => ({ key: 'k', header: 'K', type });

describe('csvCell', () => {
    it('chặn chèn công thức ở ô văn bản', () => {
        for (const v of ['=SUM(A1)', '+84900000000', '-cmd', '@x', '\tx'])
            expect(csvCell(v, col('text'), ',')).toBe(`'${v}`);
        expect(csvCell('Sofa', col('text'), ',')).toBe('Sofa');
    });
    it('số âm ở cột số không bị thêm dấu nháy', () => {
        expect(csvCell(-1500, col('money'), ',')).toBe('-1500');
    });
    it('nháy kép, dấu phân cách và xuống dòng được bao trong ngoặc kép', () => {
        expect(csvCell('a,b', col('text'), ',')).toBe('"a,b"');
        expect(csvCell('a;b', col('text'), ';')).toBe('"a;b"');
        expect(csvCell('say "hi"', col('text'), ',')).toBe('"say ""hi"""');
        expect(csvCell('x\ny', col('text'), ',')).toBe('"x\ny"');
    });
    it('định dạng số, tỷ lệ, ngày; chuỗi số từ DB cũng được chấp nhận', () => {
        expect(csvCell('1500000.00', col('money'), ',')).toBe('1500000');
        expect(csvCell(1500000.5, col('money'), ',')).toBe('1500000.5');
        expect(csvCell(0.123456789, col('percent'), ',')).toBe('0.123457');
        expect(csvCell(new Date('2026-04-01T00:30:00Z'), col('date'), ',')).toBe('2026-04-01');
        expect(csvCell(new Date('2026-04-01T00:30:05Z'), col('datetime'), ',')).toBe('2026-04-01 00:30:05');
        expect(csvCell(null, col('money'), ',')).toBe('');
    });
});

describe('writeCsv', () => {
    const cols: Col[] = [{ key: 'name', header: 'Tên', type: 'text' }, { key: 'amt', header: 'Tiền', type: 'money' }];

    it('có BOM, tiêu đề, CRLF và trả về số dòng', async () => {
        const { w, text } = collect();
        const n = await writeCsv(w, cols, one([{ name: 'A', amt: 1 }, { name: 'B', amt: 2 }]), { delimiter: ',', headers: 'label' });
        expect(n).toBe(2);
        expect(text()).toBe('\uFEFFTên,Tiền\r\nA,1\r\nB,2\r\n');
    });
    it('dùng dấu chấm phẩy và tiêu đề kỹ thuật theo tùy chọn', async () => {
        const { w, text } = collect();
        await writeCsv(w, cols, one([{ name: 'A', amt: 1 }]), { delimiter: ';', headers: 'key' });
        expect(text()).toBe('\uFEFFname;amt\r\nA;1\r\n');
    });
    it('ghi được nhiều lô liên tiếp', async () => {
        const { w, text } = collect();
        async function* many() { yield [{ name: 'A', amt: 1 }]; yield [{ name: 'B', amt: 2 }]; }
        expect(await writeCsv(w, cols, many(), { delimiter: ',', headers: 'label' })).toBe(2);
        expect(text().split('\r\n').length).toBe(4);
    });
});