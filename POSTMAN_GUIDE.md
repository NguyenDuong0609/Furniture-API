# Hướng dẫn test Reports API với Postman

## 📦 Import Collection

1. Mở Postman
2. Click **Import** → Chọn file `postman-reports-collection.json`
3. Collection sẽ được import với tên "NestJS E-commerce - Reports API"

## 🔐 Cấu hình Authentication

### Bước 1: Login để lấy Access Token

Trước khi test các API reports, bạn cần access token:

```http
POST http://localhost:3000/auth/login
Content-Type: application/json

{
  "email": "admin@furniture.com",
  "password": "Admin@123"
}
```

### Bước 2: Set Access Token vào Collection Variables

1. Mở collection "NestJS E-commerce - Reports API"
2. Tab **Variables**
3. Set giá trị cho `accessToken` = copy từ response login
4. Collection đã cấu hình Bearer Auth tự động

## 📋 Danh sách API trong Collection

### 1. Catalog - Danh sách báo cáo
**URL:** `GET {{baseUrl}}/admin/reports`

**Response:**
```json
{
  "order-lines": {
    "id": "order-lines",
    "title": "Bảng kê chi tiết bán hàng",
    "description": "Mỗi dòng là một sản phẩm của một đơn hàng...",
    "group": "Chi tiết",
    "filters": ["basis", "status", "paymentMethod", "city", "categoryId", "brandId"],
    "columns": [...],
    "canRead": true,
    "canExport": true,
    "canPii": true
  },
  "revenue-by-period": {...},
  ...
}
```

---

### 2. Report Data - Bảng kê chi tiết bán hàng
**URL:** `GET {{baseUrl}}/admin/reports/order-lines`

**Query Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| from | string | Yes | Ngày bắt đầu (YYYY-MM-DD) |
| to | string | Yes | Ngày kết thúc (YYYY-MM-DD) |
| basis | enum | No | PAID (ngày thu tiền) hoặc ORDER (ngày đặt hàng) |
| status | enum | No | PENDING, CONFIRMED, PROCESSING, SHIPPING, DELIVERED, CANCELLED, REFUNDED |
| paymentMethod | string | No | COD, BANK_TRANSFER, SEPAY_BANK_TRANSFER |
| city | string | No | Tỉnh/Thành |
| categoryId | number | No | ID danh mục |
| brandId | number | No | ID thương hiệu |
| q | string | No | Tìm kiếm theo mã đơn hoặc SĐT |
| limit | number | No | Số dòng trả về (1-200, default 50) |
| page | number | No | Trang số (default 1) |
| cursor | string | No | Cursor cho phân trang keyset |

**Example Request:**
```
GET http://localhost:3000/admin/reports/order-lines?from=2026-01-01&to=2026-12-31&basis=PAID&limit=50
```

**Response:**
```json
{
  "total": 1000000,
  "rows": [
    {
      "order_code": "BENCH1",
      "order_date": "2026-03-10T12:00:00",
      "paid_at": "2026-03-10T12:05:00",
      "order_status": "DELIVERED",
      "payment_status": "PAID",
      "payment_method": "COD",
      "customer_name": "Khách 1",
      "phone": "0900000001",
      "city": "Hà Nội",
      "district": null,
      "sku": "SOFA-GRAY-L",
      "product": "Sản phẩm bench 1",
      "category": "Sofa",
      "brand": "MOHO",
      "quantity": 2,
      "unit_price": 250000,
      "line_total": 500000,
      "order_total": 530000
    }
  ],
  "summary": {
    "totalLabel": "Số đơn hàng",
    "total": 1000000,
    "sums": {
      "quantity": 3000000,
      "line_total": 750000000000
    }
  }
}
```

---

### 3. Report Data - Doanh thu theo kỳ
**URL:** `GET {{baseUrl}}/admin/reports/revenue-by-period`

**Query Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| from | string | Yes | Ngày bắt đầu |
| to | string | Yes | Ngày kết thúc |
| basis | enum | No | PAID hoặc ORDER |
| groupBy | enum | No | day, week, month, quarter, year |
| paymentMethod | string | No | Optional |
| city | string | No | Optional |
| sortBy | string | No | bucket_start, period, orders, units, net_revenue, aov, growth |
| sortDir | string | No | asc hoặc desc |
| limit | number | No | default 50 |

**Example Request:**
```
GET http://localhost:3000/admin/reports/revenue-by-period?from=2026-01-01&to=2026-12-31&basis=PAID&groupBy=month
```

---

### 4. Report Data - Sản phẩm bán chạy
**URL:** `GET {{baseUrl}}/admin/reports/top-products`

**Query Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| from | string | Yes | Ngày bắt đầu |
| to | string | Yes | Ngày kết thúc |
| basis | enum | No | PAID hoặc ORDER |
| metric | enum | No | quantity hoặc revenue |
| categoryId | number | No | Optional |
| brandId | number | No | Optional |
| paymentMethod | string | No | Optional |
| city | string | No | Optional |
| q | string | No | Tìm kiếm theo tên/SKU/danh mục/thương hiệu |
| sortBy | string | No | rank_no, sku, product, units, orders, revenue, avg_price, revenue_share |
| sortDir | string | No | asc hoặc desc |
| limit | number | No | default 50 |

**Example Request:**
```
GET http://localhost:3000/admin/reports/top-products?from=2026-01-01&to=2026-12-31&basis=PAID&metric=revenue
```

---

### 5. Report Data - Sản phẩm đang giảm giá
**URL:** `GET {{baseUrl}}/admin/reports/products-on-sale`

**Query Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| from | string | Yes | Ngày bắt đầu |
| to | string | Yes | Ngày kết thúc |
| basis | enum | No | PAID hoặc ORDER |
| categoryId | number | No | Optional |
| brandId | number | No | Optional |
| q | string | No | Tìm kiếm |
| limit | number | No | default 50 |

---

### 6. Report Data - Hàng chậm luân chuyển
**URL:** `GET {{baseUrl}}/admin/reports/slow-products`

**Query Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| from | string | Yes | Ngày bắt đầu |
| to | string | Yes | Ngày kết thúc |
| basis | enum | No | PAID hoặc ORDER |
| maxUnits | number | No | Ngưỡng số lượng bán (default 0 = không bán được) |
| categoryId | number | No | Optional |
| brandId | number | No | Optional |
| q | string | No | Tìm kiếm |
| limit | number | No | default 50 |

---

### 7. Report Data - Doanh thu theo danh mục/thương hiệu
**URL:** `GET {{baseUrl}}/admin/reports/revenue-by-dimension`

**Query Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| from | string | Yes | Ngày bắt đầu |
| to | string | Yes | Ngày kết thúc |
| basis | enum | No | PAID hoặc ORDER |
| dimension | enum | No | category hoặc brand |
| paymentMethod | string | No | Optional |
| city | string | No | Optional |
| q | string | No | Tìm kiếm theo tên |
| limit | number | No | default 50 |

---

### 8. Report Data - Doanh thu theo phương thức thanh toán
**URL:** `GET {{baseUrl}}/admin/reports/revenue-by-payment-method`

**Query Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| from | string | Yes | Ngày bắt đầu |
| to | string | Yes | Ngày kết thúc |
| basis | enum | No | PAID hoặc ORDER |
| city | string | No | Optional |
| limit | number | No | default 50 |

---

### 9. Report Data - Doanh thu theo khu vực
**URL:** `GET {{baseUrl}}/admin/reports/revenue-by-region`

**Query Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| from | string | Yes | Ngày bắt đầu |
| to | string | Yes | Ngày kết thúc |
| basis | enum | No | PAID hoặc ORDER |
| paymentMethod | string | No | Optional |
| limit | number | No | default 50 |

---

### 10. Report Data - Khách hàng giá trị cao
**URL:** `GET {{baseUrl}}/admin/reports/top-customers`

**Query Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| from | string | Yes | Ngày bắt đầu |
| to | string | Yes | Ngày kết thúc |
| basis | enum | No | PAID hoặc ORDER |
| paymentMethod | string | No | Optional |
| city | string | No | Optional |
| q | string | No | Tìm kiếm theo tên/SĐT/email |
| limit | number | No | default 50 |

---

### 11. Export CSV - Bảng kê chi tiết
**URL:** `POST {{baseUrl}}/admin/reports/order-lines/export`

**Request Body:**
```json
{
  "from": "2026-01-01",
  "to": "2026-12-31",
  "basis": "PAID",
  "format": "csv",
  "delimiter": ",",
  "headers": "label",
  "gzip": false
}
```

**Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| format | enum | csv hoặc xlsx |
| delimiter | enum | , ; \t (chỉ cho CSV) |
| headers | enum | label hoặc key |
| gzip | boolean | Nén file (chỉ cho CSV) |

**Response (Sync Mode - dữ liệu nhỏ):**
- Status: 200
- Content-Type: text/csv
- Body: CSV file

**Response (Async Mode - dữ liệu lớn):**
- Status: 202
- Body:
```json
{
  "mode": "async",
  "exportId": "550e8400-e29b-41d4-a716-446655440000"
}
```

---

### 12. Export XLSX - Bảng kê chi tiết
**URL:** `POST {{baseUrl}}/admin/reports/order-lines/export`

**Request Body:**
```json
{
  "from": "2026-01-01",
  "to": "2026-12-31",
  "basis": "PAID",
  "format": "xlsx",
  "delimiter": ",",
  "headers": "label",
  "gzip": false
}
```

**Response:**
- Status: 200
- Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
- Body: Excel file với 2 sheet (Tổng quan + Dữ liệu)

---

### 13. Export History - Lịch sử export
**URL:** `GET {{baseUrl}}/admin/reports/exports`

**Response:**
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "reportId": "order-lines",
    "format": "csv",
    "status": "DONE",
    "rowCount": 3000000,
    "fileSize": 150000000,
    "createdAt": "2026-11-18T14:00:00Z",
    "startedAt": "2026-11-18T14:00:01Z",
    "finishedAt": "2026-11-18T14:05:00Z",
    "expiresAt": "2026-11-25T14:05:00Z"
  }
]
```

---

### 14. Export Status - Trạng thái export
**URL:** `GET {{baseUrl}}/admin/reports/exports/{exportId}`

**Response:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "reportId": "order-lines",
  "format": "csv",
  "status": "DONE",
  "rowCount": 3000000,
  "fileSize": 150000000,
  "createdAt": "2026-11-18T14:00:00Z",
  "startedAt": "2026-11-18T14:00:01Z",
  "finishedAt": "2026-11-18T14:05:00Z",
  "expiresAt": "2026-11-25T14:05:00Z"
}
```

**Status Enum:** QUEUED, RUNNING, DONE, FAILED, EXPIRED

---

### 15. Export Link - Lấy link download
**URL:** `POST {{baseUrl}}/admin/reports/exports/{exportId}/link`

**Response:**
```json
{
  "url": "/admin/reports/exports/download?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

---

### 16. Download File - Tải file export
**URL:** `GET {{baseUrl}}/admin/reports/exports/download?token={token}`

**Response:**
- Status: 200
- Content-Type: text/csv hoặc application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
- Body: File content

**Lưu ý:** Endpoint này là public (không cần auth) vì token đã được ký.

---

## 🧪 Test Workflow Khuyến Nghị

### 1. Xem danh sách báo cáo
- Run request: **1. Catalog - Danh sách báo cáo**
- Xem các báo cáo có sẵn và quyền truy cập

### 2. Lấy dữ liệu báo cáo
- Run request: **2. Report Data - Bảng kê chi tiết bán hàng**
- Thay đổi các filter parameters để test

### 3. Export CSV (sync mode)
- Run request: **11. Export CSV - Bảng kê chi tiết**
- Với dữ liệu nhỏ, sẽ trả về file trực tiếp

### 4. Export XLSX (async mode)
- Run request: **12. Export XLSX - Bảng kê chi tiết**
- Với dữ liệu lớn, sẽ trả về `exportId`

### 5. Kiểm tra trạng thái export
- Copy `exportId` từ response
- Set vào collection variable `exportId`
- Run request: **14. Export Status - Trạng thái export**

### 6. Lấy link download
- Run request: **15. Export Link - Lấy link download**
- Copy `token` từ response

### 7. Tải file
- Set token vào query parameter hoặc collection variable
- Run request: **16. Download File - Tải file export**

---

## 📝 Danh sách các báo cáo có sẵn

| ID | Tên | Nhóm |
|----|-----|------|
| order-lines | Bảng kê chi tiết bán hàng | Chi tiết |
| revenue-by-period | Doanh thu theo kỳ | Doanh thu |
| top-products | Sản phẩm bán chạy | Sản phẩm |
| products-on-sale | Sản phẩm đang giảm giá | Sản phẩm |
| slow-products | Hàng chậm luân chuyển | Sản phẩm |
| revenue-by-dimension | Doanh thu theo danh mục/thương hiệu | Doanh thu |
| revenue-by-payment-method | Doanh thu theo phương thức thanh toán | Doanh thu |
| revenue-by-region | Doanh thu theo khu vực | Doanh thu |
| top-customers | Khách hàng giá trị cao | Khách hàng |
| cancellations-refunds | Đơn hủy và hoàn tiền | Vận hành |

---

## 🔧 Lưu ý quan trọng

1. **Auth:** Tất cả API cần Bearer token (trừ endpoint download)
2. **Date format:** YYYY-MM-DD
3. **Basis:** PAID = ngày thu tiền, ORDER = ngày đặt hàng
4. **Export mode:**
   - Sync: Dữ liệu nhỏ (< 10,000 dòng) - trả file ngay
   - Async: Dữ liệu lớn - trả exportId, cần poll status
5. **File expiration:** File export sẽ tự động xóa sau 7 ngày
6. **PII data:** Cột tên, SĐT, email chỉ hiển thị nếu user có quyền `report:pii`
