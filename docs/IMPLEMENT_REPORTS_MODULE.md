# Implement Module Reports

## Tóm tắt

Tạo module reports với cấu trúc NestJS CLI, thêm các file types, sql, definitions, và export folder để hỗ trợ báo cáo và xuất file CSV/Excel.

## Trạng thái hiện tại

- ✅ Tạo module reports bằng NestJS CLI (`npx nest g module reports`)
- ✅ Tạo controller (`npx nest g controller reports --no-spec`)
- ✅ Tạo service (`npx nest g service reports --no-spec`)
- Module đã được tự động đăng ký vào `app.module.ts`

## Các bước tiếp theo

### Bước 1: Tạo cấu trúc folder export

```bash
mkdir -p src/reports/export
```

### Bước 2: Tạo các file cần thiết

1. `src/reports/report-types.ts` - Types và Zod schemas
2. `src/reports/report-sql.ts` - SQL helpers
3. `src/reports/report-definitions.ts` - 10 báo cáo
4. `src/reports/export/csv-writer.ts` - CSV export
5. `src/reports/export/xlsx-writer.ts` - Excel export (exceljs)
6. `src/reports/export/report-export.service.ts` - Background job

### Bước 3: Cập nhật module

- Update `reports.module.ts` để import PrismaModule, BullModule, ConfigModule
- Register ReportExportService

### Bước 4: Cập nhật controller

- Add endpoints: GET /reports, GET /reports/:reportId, POST /reports/:reportId/export
- Add permissions: report:read, report:export

### Bước 5: Cập nhật service

- Implement getAvailableReports()
- Implement runReport()
- Implement exportReport()

### Bước 6: Test

- Start server
- Test endpoints
- Test export functionality

## Files cần tạo/chỉnh sửa

- `src/reports/report-types.ts` - Tạo mới
- `src/reports/report-sql.ts` - Tạo mới
- `src/reports/report-definitions.ts` - Tạo mới
- `src/reports/export/csv-writer.ts` - Tạo mới
- `src/reports/export/xlsx-writer.ts` - Tạo mới
- `src/reports/export/report-export.service.ts` - Tạo mới
- `src/reports/reports.module.ts` - Cập nhật
- `src/reports/reports.controller.ts` - Cập nhật
- `src/reports/reports.service.ts` - Cập nhật
- `src/app.module.ts` - Đã tự động cập nhật bởi CLI
