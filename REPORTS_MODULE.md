# Reports Module — Tài liệu tổng hợp

Tài liệu này tổng hợp kiến thức về module Reports: kiến trúc, API, cơ chế filter, export flow, và cách mở rộng.

---

## 1. Tổng quan kiến trúc

Module Reports gồm 3 thành phần chính:

| Thành phần | File | Vai trò |
|---|---|---|
| Report definitions | `src/reports/report-definitions.ts` | Định nghĩa các báo cáo + SQL query (Prisma.sql template) |
| Reports service | `src/reports/reports.service.ts` | API lấy dữ liệu (`list`, `iterate`, `catalog`) |
| Export service | `src/reports/export/report-export.service.ts` | Export file CSV/XLSX, worker nền, download |
| SQL helpers | `src/reports/report-sql.ts` | Hàm build WHERE clause từ filters |
| Types | `src/reports/report-types.ts` | `ReportDef`, `Filters`, `Col`, Zod schema |

**Luồng tổng quát:**

```
UI/Postman
  │
  ├─ API 1: GET /admin/reports          → menu cố định (catalog)
  ├─ API 2-10: GET /admin/reports/{id}  → query data + filter (preview)
  └─ API 11-16: export flow             → lưu file + download
```

Export và data API **dùng chung SQL definitions** — cùng `def.build(f)` hoặc `def.detail.batch(f)`, chỉ khác output (JSON vs file stream).

---

## 2. Danh sách API endpoints

Base path: `/admin/reports` — tất cả cần `Authorization: Bearer <token>` trừ download.

| # | Method | URL | Permission | Mô tả |
|---|---|---|---|---|
| 1 | GET | `/admin/reports` | `report:read` | Catalog — menu các báo cáo + lookups (categories, brands, paymentMethods, statuses) |
| 2 | GET | `/admin/reports/order-lines` | `report:read` | Bảng kê chi tiết bán hàng (detail, phân trang keyset) |
| 3 | GET | `/admin/reports/revenue-by-period` | `report:read` | Doanh thu theo kỳ (day/week/month/quarter/year) |
| 4 | GET | `/admin/reports/top-products` | `report:read` | Sản phẩm bán chạy + phân loại ABC |
| 5 | GET | `/admin/reports/products-on-sale` | `report:read` | Sản phẩm đang giảm giá |
| 6 | GET | `/admin/reports/slow-products` | `report:read` | Hàng chậm luân chuyển |
| 7 | GET | `/admin/reports/revenue-by-dimension` | `report:read` | Doanh thu theo category/brand |
| 8 | GET | `/admin/reports/revenue-by-payment-method` | `report:read` | Doanh thu theo phương thức TT |
| 9 | GET | `/admin/reports/revenue-by-region` | `report:read` | Doanh thu theo tỉnh/thành |
| 10 | GET | `/admin/reports/top-customers` | `report:read` | Khách hàng giá trị cao |
| 11 | POST | `/admin/reports/{id}/export` | `report:export` | Export file (format: csv/xlsx) |
| 12 | GET | `/admin/reports/exports` | `report:export` | Lịch sử export của user |
| 13 | GET | `/admin/reports/exports/{exportId}` | `report:export` | Trạng thái 1 export |
| 14 | POST | `/admin/reports/exports/{exportId}/link` | `report:export` | Lấy link download (token ký HMAC, TTL 120s) |
| 15 | GET | `/admin/reports/exports/download?token=...` | Public | Tải file (xác thực bằng token trong URL) |

> Lưu ý: số thứ tự trong tài liệu này có thể lệch 1 so với Postman collection — endpoint quan trọng là URL.

---

## 3. Các báo cáo có sẵn

| reportId | Tên | Nhóm | Loại | Filter hỗ trợ |
|---|---|---|---|---|
| `order-lines` | Bảng kê chi tiết bán hàng | Chi tiết | detail (batch) | basis, status, paymentMethod, city, categoryId, brandId |
| `revenue-by-period` | Doanh thu theo kỳ | Doanh thu | aggregate | basis, groupBy, paymentMethod, city |
| `top-products` | Sản phẩm bán chạy | Sản phẩm | aggregate | basis, categoryId, brandId, paymentMethod, city, metric |
| `products-on-sale` | Sản phẩm đang giảm giá | Sản phẩm | aggregate | basis, categoryId, brandId, paymentMethod, city |
| `slow-products` | Hàng chậm luân chuyển | Sản phẩm | aggregate | basis, categoryId, brandId, maxUnits |
| `revenue-by-dimension` | Doanh thu theo danh mục/thương hiệu | Doanh thu | aggregate | basis, dimension, paymentMethod, city |
| `revenue-by-payment-method` | Doanh thu theo phương thức TT | Doanh thu | aggregate | basis, city |
| `revenue-by-region` | Doanh thu theo khu vực | Doanh thu | aggregate | basis, paymentMethod |
| `top-customers` | Khách hàng giá trị cao | Khách hàng | aggregate | basis, paymentMethod, city |
| `cancellations-refunds` | Đơn hủy và hoàn tiền | Vận hành | aggregate | (xem definitions) |

**2 loại báo cáo:**
- **detail** (`order-lines`): đọc theo lô 2.000 đơn/lần, phân trang keyset `(cursor_ts, order_id)`, không giới hạn số dòng khi export
- **aggregate**: SQL GROUP BY, giới hạn ~100.000 dòng khi export (`AGG_EXPORT_CAP`)

---

## 4. Cơ chế filter

### Filter keys (từ `BaseFilters` trong `report-types.ts`)

| Key | Kiểu | Ý nghĩa |
|---|---|---|
| `from`, `to` | `YYYY-MM-DD` | Khoảng ngày (giờ VN, quy về UTC) |
| `basis` | `PAID` \| `ORDER` | Lọc theo ngày thu tiền hay ngày đặt hàng |
| `groupBy` | `day`/`week`/`month`/`quarter`/`year` | Gom kỳ (revenue-by-period) |
| `categoryId`, `brandId` | number | Lọc theo danh mục/thương hiệu |
| `paymentMethod` | string | COD, BANK_TRANSFER, SEPAY_* ... |
| `city` | string | Tỉnh/thành giao hàng |
| `status` | enum OrderStatus | Trạng thái đơn |
| `metric` | `quantity`/`revenue` | Tiêu chí xếp hạng (top-products) |
| `dimension` | `category`/`brand` | Chiều phân tích |
| `maxUnits` | number | Ngưỡng SL bán (slow-products) |
| `q` | string | Tìm kiếm text |
| `sortBy`, `sortDir` | string | Sắp xếp |
| `page`, `limit`, `cursor` | number/string | Phân trang |

### Filter áp dụng ở đâu?

**Ở SQL level (database), KHÔNG phải application code.**

- **API data (GET)**: filters → query params → build SQL → PostgreSQL trả data → JSON response
- **API export (POST)**: filters → lưu vào `ReportExport.filters` (JSON) → worker đọc lại → build cùng SQL → stream vào file

### Helpers build WHERE (`report-sql.ts`)

```typescript
orderConds(f)      // range ngày + paymentStatus='PAID' + loại CANCELLED/REFUNDED + paymentMethod + city
catBrandConds(f)   // categoryId + brandId
itemConds(f)       // orderConds + catBrandConds (cho báo cáo theo OrderItem)
range(col, f)      // [from 00:00, to+1 00:00) giờ VN → UTC
```

Mỗi report trong `report-definitions.ts` dùng chung các helper này → filter hoạt động giống nhau cho mọi báo cáo.

---

## 5. Luồng export chi tiết

```
POST /admin/reports/{id}/export
Body: { from, to, basis, ..., format: 'csv'|'xlsx', delimiter, headers, gzip }
  │
  ▼
ReportExportService.request()
  ├─ reports.get(reportId)         → tìm ReportDef
  ├─ Check MAX_ACTIVE_PER_USER=3
  ├─ Validate XLSX ≤ 1.000.000 dòng (chỉ detail)
  └─ prisma.reportExport.create({ status:'QUEUED', filters, options })
  │
  ▼  Response 202: { mode:'async', exportId }
  │
  ▼  Cron worker @Cron(EVERY_10_SECONDS)
ReportExportService.tick() → runJob(rec)
  ├─ f = FiltersSchema.parse(rec.filters)   // đọc filters từ DB
  ├─ streamReport(def, f, opts, fileStream, rec)
  │    └─ reports.iterate(def, f, includePii)  // ← CÙNG logic API data
  │         └─ def.build(f) hoặc def.detail.batch(f)  // SQL query
  ├─ writeCsv() hoặc writeXlsx() → stream vào file
  └─ Update: status='DONE', filePath, fileSize, rowCount, expiresAt (+7 ngày)
  │
  ▼
User: GET /exports/{id} (poll) → POST /exports/{id}/link → GET /exports/download?token=...
```

**Đặc điểm:**
- **Luôn async mode** (đã sửa — trước đây sync cho dữ liệu nhỏ không lưu file)
- File lưu tại `REPORT_EXPORT_DIR` (default `./exports`), tự xóa sau 7 ngày (cron `0 3 * * *`)
- Worker timeout: job RUNNING > 2h → FAILED
- Download link: HMAC-signed token, TTL 120s

---

## 6. SQL được build như thế nào

Ví dụ export `top-products` với `{ from:'2026-01-01', to:'2026-12-31', basis:'PAID', metric:'revenue', categoryId:1, brandId:2 }`:

```sql
WITH g AS (
  SELECT p.id AS product_id, p.sku, p.name AS product, c.name AS category, b.name AS brand,
         SUM(oi.quantity)::int AS units, COUNT(DISTINCT o.id)::int AS orders,
         SUM(oi.price * oi.quantity) AS revenue
  FROM "OrderItem" oi
  JOIN "Order" o ON o.id = oi."orderId"
  JOIN "Product" p ON p.id = oi."productId"
  LEFT JOIN "Category" c ON c.id = p."categoryId"
  LEFT JOIN "Brand" b ON b.id = p."brandId"
  WHERE o."paidAt" >= ('2026-01-01'::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'UTC'
    AND o."paidAt" < (('2026-12-31'::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'UTC'
    AND o."paymentStatus" = 'PAID' AND o.status NOT IN ('CANCELLED','REFUNDED')
    AND p."categoryId" = $1
    AND p."brandId" = $2
  GROUP BY p.id, p.sku, p.name, c.name, b.name
), r AS (
  SELECT g.*,
         ROW_NUMBER() OVER (ORDER BY revenue DESC, product_id) AS rank_no,
         SUM(revenue) OVER () AS total_revenue,
         SUM(revenue) OVER (ORDER BY revenue DESC, product_id
           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_revenue
  FROM g
)
SELECT rank_no::int, sku, product, category, brand, units, orders, revenue,
       revenue / NULLIF(units, 0) AS avg_price,
       revenue / NULLIF(total_revenue, 0) AS revenue_share,
       cum_revenue / NULLIF(total_revenue, 0) AS cum_share,
       CASE WHEN (cum_revenue - revenue) / NULLIF(total_revenue, 0) < 0.80 THEN 'A'
            WHEN (cum_revenue - revenue) / NULLIF(total_revenue, 0) < 0.95 THEN 'B'
            ELSE 'C' END AS abc_class,
       product_id
FROM r
```

Sau đó `iterate()` bọc thêm: `SELECT * FROM (...) t ORDER BY ... LIMIT 100001`.

### Bảo mật

- `Prisma.sql` template → giá trị filter **parameterize** (`$1`, `$2`) → chống SQL injection
- `Prisma.raw` chỉ cho giá trị Zod-validated (`metric`, `groupBy`, `sortBy` trong whitelist `sortable`)
- `likeEscape` escape `%`, `_`, `\` cho tìm kiếm

---

## 7. UI admin (`UI/reports.html`)

File HTML standalone, gọi API trực tiếp bằng `fetch`.

| Hành động UI | API gọi |
|---|---|
| Nhập API base + JWT → Kết nối | `GET /admin/reports` (catalog → menu + lookups) |
| Click báo cáo trong menu | `pick(id)` → build filter form → `GET /admin/reports/{id}?filters` |
| Đổi filter / "Áp dụng" / sort / phân trang | `GET /admin/reports/{id}?...` (preview data) |
| Bấm "Xuất Excel/CSV" | `POST /admin/reports/{id}/export` với **cùng `filters()`** |
| Nhận 202 async | Poll `GET /exports/{id}` mỗi 3s → DONE → `POST /exports/{id}/link` → `location.href = download URL` |

**Điểm quan trọng:** hàm `filters()` dùng chung cho cả preview (API data) và export → filter user chọn được áp dụng giống hệt ở SQL level cho cả hai.

---

## 8. Export data khác (custom report)

**Hiện tại:** chỉ export được các báo cáo cố định trong `report-definitions.ts`. Muốn export data khác có 2 cách:

### Cách A — Thêm report mới vào `report-definitions.ts` (đơn giản, khuyến nghị cho báo cáo lặp lại)

```typescript
const myReport: ReportDef = {
  id: 'my-report',
  group: 'Tùy chỉnh',
  title: 'Báo cáo của tôi',
  description: '...',
  filters: ['basis', 'categoryId'],       // chọn từ FilterKey có sẵn
  columns: [C('col1', 'Header', 'text'), ...],
  sortable: [...], defaultSort: '...', defaultDir: 'asc',
  notes: [...],
  build: (f) => Prisma.sql`SELECT ... WHERE ${and(orderConds(f))} ...`,
  // hoặc detail: { totalLabel, batch, summary, countCapped } cho báo cáo chi tiết
};

// thêm vào cuối file:
export const REPORTS: ReportDef[] = [..., myReport];
```

Sau đó report tự động xuất hiện trong catalog (API 1), preview (API data), và export (API 11) — không cần sửa controller/service.

### Cách B — Dynamic Report Builder (phức tạp, cho query tùy ý)

Đã phân tích plan (file plan `plan-b10f64724b4366cd.md`):
- Endpoint `POST /admin/reports/custom/build` nhận `{ table, columns, filters[], sort }`
- Whitelist tables/columns, build `Prisma.sql` an toàn
- Tái sử dụng `ReportExportService` để stream file
- Cần module mới: `custom-report.schema.ts`, `custom-query-builder.service.ts`, `custom-reports.controller.ts`

> Không khuyến nghị cho phép SQL tự do (SQL injection risk).

---

## 9. Test & benchmark

### Test database (riêng, không ảnh hưởng dev)

- `.env.test`: `DATABASE_URL=.../furniture_test_db` (port 5433)
- `.env`: `DATABASE_URL=.../furniture_db` (dev)

```bash
npm run db:test:migrate     # prisma migrate deploy trên test DB
npm run prisma:seed:test    # seed users/categories/products cơ bản
npm run prisma:seed:bench   # seed 1M orders + 3M order items (~35 phút)
npm run test:integration    # chạy test/integration với .env.test
npm run test:bench          # benchmark export 3M dòng
```

> **Lưu ý:** Seed bench không xóa data cũ — nó cộng thêm vào DB test. Nếu muốn reset sạch trước khi seed:
>
> ```powershell
> npm run db:test:reset    # xóa và migrate lại
> npm run prisma:seed:test   # seed dữ liệu cơ bản (users, products)
> npm run prisma:seed:bench  # seed 1 triệu đơn
> npm run test:bench
> ```

### Helper test

- `test/integration/helpers/db.ts`: `createPrisma()`, `resetDb(prisma)` — xóa data theo thứ tự FK
- `test/integration/reports.int-spec.ts`: unit-ish integration tests cho từng report
- `test/integration/report-bench.int-spec.ts`: benchmark memory khi export (skip nếu không có `BENCH=true`)

---

## 10. Troubleshooting

| Lỗi | Nguyên nhân | Cách fix |
|---|---|---|
| `Cannot find module './helpers/db.js'` | Thiếu `test/integration/helpers/db.ts` | Đã tạo file helper |
| `Unknown argument 'paidAt'` trong createMany | `paidAt` không set trực tiếp được | Update bằng raw SQL sau createMany |
| `File không còn tồn tại` khi download | Export chạy sync mode (không lưu file) | Đã fix: luôn async mode; restart server |
| `Module '"@prisma/client"' has no exported member 'ReportExport'` | Prisma client chưa generate | `npm run prisma:generate` |
| `has no exported member 'Permissions'` | Sai tên decorator | Dùng `RequirePermissions` |
| `Cannot find module 'dist/app.module.js'` | Build cache lỗi | Xóa `dist/` rồi `npm run build` |
| 429 khi export | Quá 3 job QUEUED/RUNNING/user | Đợi job xong (`MAX_ACTIVE_PER_USER = 3`) |
| XLSX "Dữ liệu quá lớn" | Detail report > 1M dòng | Xuất CSV hoặc chia nhỏ khoảng ngày |

### Quyền cần có

- `report:read` — xem data các báo cáo
- `report:export` — export file
- `report:pii` — xem cột nhạy cảm (tên KH, SĐT, email) — cả trong preview lẫn file export

---

## 11. Tham khảo nhanh

- Postman collection: `postman-reports-collection.json`
- Hướng dẫn Postman: `POSTMAN_GUIDE.md`
- UI admin: `UI/reports.html`
- Schema DB: `prisma/schema.prisma` (model `ReportExport`, `Order`, `OrderItem`, `Product`...)
- Plan custom export: `C:\Users\DuongDEV\.devin\plans\plan-b10f64724b4366cd.md`
- Seed benchmark SQL: `prisma/seed-bench.sql` + `prisma/seed-bench.ts`
- Env test: `.env.test`

---

*Tài liệu được tổng hợp từ quá trình phân tích và implement module Reports.*
