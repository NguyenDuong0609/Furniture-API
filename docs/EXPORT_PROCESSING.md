# Export Processing - Cron Job & Streaming

Tài liệu này mô tả cách hệ thống xử lý export file hàng triệu records sử dụng NestJS cron job và streaming.

---

## Tổng quan

Hệ thống export sử dụng **NestJS Cron Job** (không phải BullMQ) để xử lý export bất đồng bộ, cho phép user tiếp tục làm việc trong khi file được tạo ở nền.

- **Poll interval:** 10 giây
- **Cơ chế:** Database polling → không cần Redis
- **File retention:** 7 ngày
- **Max concurrent export/user:** 3

---

## Cron Job Architecture

### 1. Worker Polling - `tick()`

**File:** `src/reports/export/report-export.service.ts` (line 125-144)

```typescript
@Cron(CronExpression.EVERY_10_SECONDS)
async tick() {
  if (this.running) return;  // Prevent concurrent instances
  this.running = true;
  try {
    // 1. Timeout check: mark FAILED nếu chạy quá 2h
    await this.prisma.reportExport.updateMany({
      where: { status: 'RUNNING', startedAt: { lt: new Date(Date.now() - 2 * 3600_000) } },
      data: { status: 'FAILED', error: 'Quá thời gian xử lý', finishedAt: new Date() },
    });
    
    // 2. Tìm record QUEUED cũ nhất
    const next = await this.prisma.reportExport.findFirst({ 
      where: { status: 'QUEUED' }, 
      orderBy: { createdAt: 'asc' } 
    });
    if (!next) return;
    
    // 3. Claim record (QUEUED → RUNNING) với optimistic lock
    const claim = await this.prisma.reportExport.updateMany({ 
      where: { id: next.id, status: 'QUEUED' }, 
      data: { status: 'RUNNING', startedAt: new Date() } 
    });
    if (claim.count === 0) return;  // Đã bị worker khác claim
    
    // 4. Chạy export
    await this.runJob(next);
  } catch (e) {
    this.logger.error(e, 'Export worker failed');
  } finally {
    this.running = false;
  }
}
```

**Cơ chế:**
- Poll database mỗi 10 giây
- Flag `running` prevent multiple instances chạy cùng lúc
- Timeout 2 giờ → mark FAILED (bảo vệ stuck jobs)
- Optimistic lock: chỉ claim nếu status vẫn QUEUED

---

### 2. Export Job Execution - `runJob()`

**File:** `src/reports/export/report-export.service.ts` (line 146-169)

```typescript
private async runJob(rec: ReportExport) {
  const opts = rec.options as unknown as ExportOptions;
  const f = FiltersSchema.parse(rec.filters);
  const path = join(this.dir, `${rec.id}.${opts.format}${opts.gzip ? '.gz' : ''}`);
  
  // 1. Tạo file stream (có thể gzip)
  const file = createWriteStream(path);
  const fileDone = finished(file);
  const gz = opts.gzip ? createGzip() : null;
  gz?.pipe(file);
  
  try {
    // 2. Stream data từ database → file (không load hết vào memory)
    const rows = await this.streamReport(
      this.reports.get(rec.reportId), 
      f, 
      opts, 
      (gz ?? file) as Writable, 
      rec
    );
    await fileDone;
    
    // 3. Update status DONE với metadata
    await this.prisma.reportExport.update({
      where: { id: rec.id },
      data: {
        status: 'DONE', 
        rowCount: rows, 
        filePath: path, 
        fileSize: (await stat(path)).size,
        finishedAt: new Date(), 
        expiresAt: new Date(Date.now() + RETENTION_DAYS * 86_400_000),  // 7 ngày
      },
    });
  } catch (e: any) {
    // 4. Lỗi: xóa file, mark FAILED
    this.logger.error(`Export job ${rec.id} lỗi: ${e?.message}`);
    file.destroy();
    await unlink(path).catch(() => undefined);
    await this.prisma.reportExport.update({ 
      where: { id: rec.id }, 
      data: { status: 'FAILED', error: String(e?.message).slice(0, 500), finishedAt: new Date() } 
    });
  }
}
```

**Cơ chế:**
- Stream data trực tiếp → memory ổn định (1M record cũng OK)
- Gzip → nén file
- Tự động cleanup file khi lỗi
- ExpiresAt = 7 ngày sau (để cleanup job xóa)

---

### 3. Daily Cleanup Cron - `cleanup()`

**File:** `src/reports/export/report-export.service.ts` (line 171-178)

```typescript
@Cron('0 3 * * *')  // 3:00 AM mỗi ngày
async cleanup() {
  const old = await this.prisma.reportExport.findMany({ 
    where: { status: 'DONE', expiresAt: { lt: new Date() } } 
  });
  for (const r of old) {
    if (r.filePath) await unlink(r.filePath).catch(() => undefined);
    await this.prisma.reportExport.update({ 
      where: { id: r.id }, 
      data: { status: 'EXPIRED', filePath: null } 
    });
  }
}
```

**Cơ chế:**
- Chạy 3:00 AM mỗi ngày
- Xóa file đã hết hạn (> 7 ngày)
- Update status → EXPIRED

---

## Luồng Export Đầy Đủ

```
User POST /admin/reports/:id/export
↓
request() → validate filters → tạo record QUEUED
↓
Trả về { mode: "async", exportId: "..." }
↓
[Worker] tick() mỗi 10s:
  - Poll database tìm QUEUED
  - Claim → RUNNING
  - runJob():
    - stream data → file CSV/XLSX
    - update DONE với filePath, fileSize, rowCount
↓
User GET /admin/reports/exports/:id → check status
↓
User POST /admin/reports/exports/:id/link → tạo signed link (token TTL 120s)
↓
User GET /admin/reports/download?token=... → download file
↓
[Worker] cleanup() 3:00 AM:
  - Xóa file hết hạn (> 7 ngày)
```

---

## Xử Lý Hàng Triệu Data

Hệ thống sử dụng **3 kỹ thuật chính** để xử lý 1M+ records mà không làm tràn memory:

### 1. Streaming - Đọc từng lô, ghi từng lô

**File:** `src/reports/reports.service.ts` - `iterate()` (line 148-170)

```typescript
async *iterate(def: ReportDef, f: Filters, canPii: boolean, opts: { batchOrders?: number } = {}): AsyncGenerator<any[]> {
  const adv = this.resolveAdv(def, f, canPii);
  
  if (def.detail) {
    // === Báo cáo chi tiết (order-lines): Keyset pagination ===
    let cur: Cursor | null = null;
    for (;;) {
      // Query từng lô 2000 đơn (BATCH_ORDERS)
      const batchRows: any[] = (await this.prisma.$queryRaw<any[]>(
        def.detail.batch(f, cur, opts.batchOrders ?? BATCH_ORDERS, adv),
      )).map(normRow);
      
      if (batchRows.length === 0) return;  // Hết data
      
      // Update cursor: dùng (ts, id) làm keyset
      const last = batchRows[batchRows.length - 1];
      cur = { ts: last.cursor_ts, id: Number(last.order_id) };
      
      // Yield batch → writer ghi lô này → giải phóng memory
      yield this.strip(batchRows, def, canPii);
    }
  }
  
  // === Báo cáo tổng hợp: Giới hạn 100K dòng ===
  const { key, dir } = this.sortOf(def, f);
  const rows = await this.prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT * FROM (${def.build!(f)}) t ${this.whereSql(def, f, adv)}
    ORDER BY ${ident(key)} ${Prisma.raw(dir)} NULLS LAST, 1 LIMIT ${AGG_EXPORT_CAP + 1}`);
  
  if (rows.length > AGG_EXPORT_CAP) {
    throw new BadRequestException(`Báo cáo vượt ${AGG_EXPORT_CAP} dòng...`);
  }
  
  // Yield từng 5000 dòng (vẫn batch nhỏ hơn aggregate limit)
  for (let i = 0; i < rows.length; i += 5000) {
    yield this.strip(rows.slice(i, i + 5000).map(normRow), def, canPii);
  }
}
```

**Cơ chế:**
- **Detail report (order-lines):** Keyset pagination `(cursor_ts, order_id)` → ổn định dù có new orders insert vào giữa lúc export
- **Aggregate report:** Giới hạn 100K dòng (`AGG_EXPORT_CAP`) → không hỗ trợ export hàng triệu aggregate
- **Batch size:** 2000 orders/batch cho detail, 5000 rows/batch cho aggregate
- **AsyncGenerator:** Yield từng batch → writer consume → giải phóng memory trước khi đọc batch tiếp

---

### 2. CSV Streaming Writer

**File:** `src/reports/export/csv-writer.ts` - `writeCsv()` (line 33-45)

```typescript
export async function writeCsv(out: Writable, cols: Col[], batches: AsyncIterable<any[]>, o: CsvOptions): Promise<number> {
  const d = o.delimiter;
  
  // Ghi header (BOM UTF-8)
  await write(out, '\uFEFF' + cols.map((c) => csvCell(...)).join(d) + '\r\n');
  
  let n = 0;
  for await (const rows of batches) {  // Consume từng batch từ iterate()
    let buf = '';
    for (const r of rows) buf += cols.map((c) => csvCell(r[c.key], c, d)).join(d) + '\r\n';
    n += rows.length;
    await write(out, buf);  // Ghi buffer → giải phóng
  }
  
  out.end();
  return n;
}

async function write(out: Writable, chunk: string) {
  if (!out.write(chunk)) await once(out, 'drain');  // Tôn trọng backpressure
}
```

**Cơ chế:**
- **BOM UTF-8:** `\uFEFF` → Excel mở đúng encoding
- **Per-batch buffer:** Build string trong batch → ghi 1 lần → hiệu quả hơn ghi từng dòng
- **Backpressure:** `out.write()` trả false khi buffer đầy → `await once(out, 'drain')` → không làm trộn memory

---

### 3. Excel Streaming Writer

**File:** `src/reports/export/xlsx-writer.ts` - `writeXlsx()` (line 29-119)

```typescript
export async function writeXlsx(out: Writable, cols: Col[], batches: AsyncIterable<any[]>, m: XlsxMeta): Promise<number> {
  // Streaming workbook (không load hết vào memory)
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ 
    stream: out, 
    useStyles: true, 
    useSharedStrings: false 
  });
  
  // ... tạo Sheet 1 (Tổng quan) ...
  
  // === Sheet 2: Dữ liệu ===
  const ws = wb.addWorksheet('Dữ liệu', { ... });
  // ... setup columns, header ...
  
  let count = 0;
  const sums: Record<string, number> = {};
  
  for await (const rows of batches) {  // Consume từng batch
    for (const r of rows) {
      if (++count > m.maxRows) throw new Error(`Vượt giới hạn ${m.maxRows} dòng...`);
      
      // Ghi từng row → ExcelJS stream commit
      ws.addRow(cols.map((c) => cellValue(r[c.key], c.type))).commit();
      
      // Tính tổng cộng
      for (const c of cols) if (c.total && r[c.key] != null) {
        sums[c.key] = (sums[c.key] ?? 0) + Number(r[c.key]);
      }
    }
  }
  
  // Dòng tổng cộng với SUBTOTAL(109) → Excel filter vẫn tổng đúng
  const tot = ws.addRow(cols.map((c, i) =>
    i === 0 ? 'TỔNG CỘNG'
      : c.total ? { formula: `SUBTOTAL(109,${letter(i)}${first}:${letter(i)}${last})`, result: sums[c.key] } 
        : null
  ));
  tot.commit();
  
  await ws.commit();  // Commit sheet
  await wb.commit();  // Commit workbook → stream ra file
  await finished(out);
  return count;
}
```

**Cơ chế:**
- **ExcelJS streaming:** `WorkbookWriter` → stream ra file, không load workbook vào memory
- **Per-row commit:** `addRow().commit()` → row được flush ra stream
- **SUBTOTAL(109):** Formula Excel → user filter trong Excel vẫn tổng đúng
- **Max rows:** 1M dòng (`XLSX_MAX_ROWS`) → Excel limit (~1.04M rows)

---

## Pipeline Export Hàng Triệu

```
Database (1M orders + 3M items)
    ↓
iterate() - Keyset pagination (batch 2000 orders)
    ↓
Stream: batch 1 (2000 rows) → batch 2 (2000 rows) → ...
    ↓
csv-writer / xlsx-writer (streaming)
    ↓
File system (CSV/XLSX file)
```

**Memory footprint:**
- **Database:** Batch 2000 orders → ~ vài MB
- **CSV buffer:** ~ vài MB/batch
- **ExcelJS:** Streaming → không load workbook
- **Total:** **~100-200 MB** ổn định (benchmark test reported 408 MB peak cho 1M orders)

---

## Giới Hạn và Validation

| Loại báo cáo | Giới hạn | Kiểm tra trước export |
|---|---|---|
| **Detail (order-lines)** | 1M rows (XLSX) | `countOrders()` → check `XLSX_MAX_ROWS` |
| **Aggregate** | 100K rows | `iterate()` → check `AGG_EXPORT_CAP` |
| **Per user** | 3 concurrent | `request()` → check `MAX_ACTIVE_PER_USER` |
| **File retention** | 7 ngày | `cleanup()` cron 3:00 AM |

---

## Các Hằng Số Cấu Hình

**File:** `src/reports/export/report-export.service.ts` (line 22-26)

```typescript
const SYNC_MAX_ORDERS = 0;          // luôn chạy async để lưu file
const XLSX_MAX_ROWS = 1_000_000;
const MAX_ACTIVE_PER_USER = 3;
const RETENTION_DAYS = 7;
```

---

## Tóm Tắt Kỹ Thuật

| Kỹ thuật | File | Mục đích |
|---|---|---|
| **Cron job polling** | `report-export.service.ts:tick()` | Async processing, không block API |
| **Keyset pagination** | `reports.service.ts:iterate()` | Detail report stable, không sót/trùng |
| **Batch query** | `reports.service.ts:iterate()` | Memory ổn định (2000 orders/batch) |
| **AsyncGenerator** | `reports.service.ts:iterate()` | Stream data, không load hết |
| **CSV streaming** | `csv-writer.ts:writeCsv()` | Backpressure, BOM UTF-8 |
| **ExcelJS streaming** | `xlsx-writer.ts:writeXlsx()` | Workbook không load vào memory |
| **Max rows limit** | `report-export.service.ts` | Chặn export quá lớn |
| **Optimistic lock** | `report-export.service.ts:tick()` | Prevent duplicate processing |
| **Signed download link** | `report-export.service.ts:signLink()` | Secure download with TTL |

---

## Benchmark Result

Export **1M orders + 3M items** → CSV/XLSX:
- **Memory peak:** ~408 MB
- **Time:** ~1028s (khoảng 17 phút)
- **Throughput:** ~2582 orders/s

---

## Lưu Ý

1. **BullMQ không được dùng:** Code có `BullModule.registerQueue` nhưng không có `@Processor` → không active
2. **Redis không cần:** Database polling đủ reliable cho use case này
3. **Aggregate export giới hạn 100K:** Nếu cần export aggregate hàng triệu → cần refactoring
4. **File expires sau 7 ngày:** User phải download trước khi hết hạn
5. **Signed link TTL 120s:** Link download chỉ valid 2 phút
