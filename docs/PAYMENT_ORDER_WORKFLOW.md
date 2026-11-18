# Tài liệu Chức năng Thanh toán và Đặt Hàng

## Tổng quan

Hệ thống hỗ trợ nhiều phương thức thanh toán và tự động hóa quy trình xử lý đơn hàng.

---

## 1. Tạo Đơn Hàng (Create Order)

### API Endpoint
- **Method**: `POST /orders`
- **Authentication**: Optional (guest hoặc user đã đăng nhập)
- **Controller**: `OrdersController`

### Luồng hoạt động
```
1. Client gửi request với cart items + shipping info
   ↓
2. Kiểm tra tồn kho từng sản phẩm
   ↓
3. Tính tổng tiền giỏ hàng
   ↓
4. Transaction Database:
   - Tạo Order (status: PENDING, paymentStatus: UNPAID)
   - Tạo OrderItems
   - Trừ tồn kho (product/variant)
   - Xóa CartItems
   - Tạo OrderStatusHistory
   ↓
5. Gửi WebSocket notification (newOrder)
   ↓
6. Tạo Notification cho Admin và User
   ↓
7. Queue jobs (BullMQ):
   - Gửi email xác nhận đơn hàng
   - Notify admin về đơn mới
   ↓
8. Trả về Order + info chuyển khoản ngân hàng
```

### Request DTO
```typescript
{
  items: [{ productId, variantId?, quantity }],
  shippingName: string,
  shippingPhone: string,
  shippingAddress: string,
  shippingCity: string,
  shippingDistrict: string,
  paymentMethod: 'SEPAY_BANK_TRANSFER' | 'COD' | 'VNPAY' | 'MOMO',
  sessionId?: string, // cho guest
  email?: string      // cho guest
}
```

### Response
```typescript
{
  message: 'Đặt hàng thành công',
  order: { ... },
  bankTransfer: { ... } // info tài khoản ngân hàng
}
```

### Cách test
```bash
# 1. Thêm sản phẩm vào giỏ hàng
POST /carts/items
Body: { productId: 1, variantId: 1, quantity: 2 }

# 2. Tạo đơn hàng
POST /orders
Body: {
  items: [{ productId: 1, variantId: 1, quantity: 2 }],
  shippingName: "Nguyễn Văn A",
  shippingPhone: "0901234567",
  shippingAddress: "123 Đường ABC",
  shippingCity: "HCM",
  shippingDistrict: "Quận 1",
  paymentMethod: "SEPAY_BANK_TRANSFER"
}

# Hoặc với guest (cần sessionId từ cart)
POST /orders
Body: { sessionId: "session-xyz", ... }
```

---

## 2. Tạo Payment (Checkout)

### API Endpoint SePay
- **Method**: `POST /payments/sepay/checkout`
- **Authentication**: Optional (token được đọc nếu có)
- **Controller**: `SepayPaymentsController`
- **Throttle**: 5 lần/phút/IP

### Luồng hoạt động
```
1. Client gọi checkout với orderId
   ↓
2. Kiểm tra order tồn tại + quyền truy cập
   ↓
3. Kiểm tra order chưa PAID + chưa CANCELLED
   ↓
4. Kiểm tra số lần thử thanh toán (< 10 lần)
   ↓
5. Tạo Payment record:
   - invoiceNumber: {orderCode}-{random}
   - status: PENDING
   ↓
6. Build checkout URL SePay Gateway
   ↓
7. Trả về SePay checkout URL
   ↓
8. User được redirect đến trang thanh toán SePay
```

### Request DTO
```typescript
{
  orderId: number,
  paymentMethod?: 'BANK_TRANSFER' | 'NAPAS_BANK_TRANSFER'
}
```

### Response
```typescript
{
  checkoutUrl: "https://pay-sandbox.sepay.vn/v1/checkout/init?...",
  qrCode: "...", // mã QR để quét
  expiresAt: "..."  // thời gian hết hạn checkout
}
```

### Cách test
```bash
# Login để lấy accessToken (nếu cần)
POST /auth/login
Body: { email: "customer@example.com", password: "123456" }

# Tạo payment
POST /payments/sepay/checkout
Body: { orderId: 5, paymentMethod: 'BANK_TRANSFER' }
Header: Authorization: Bearer {accessToken}

# Trả về checkoutUrl -> mở browser để thanh toán
```

---

## 3. Kiểm tra trạng thái Payment

### API Endpoint
- **Method**: `GET /payments/sepay/:invoice/status`
- **Authentication**: Public
- **Controller**: `SepayPaymentsController`
- **Throttle**: 60 lần/phút/IP

### Luồng hoạt động
```
1. Frontend poll trạng thái mỗi 2-3 giây
   ↓
2. Tìm Payment theo invoiceNumber
   ↓
3. Trả về:
   - payment.status (PENDING/PAID/FAILED/CANCELLED)
   - order.status
   - order.paymentStatus
   - amount, method, paidAt
```

### Response
```typescript
{
  payment: "PAID",
  orderId: 5,
  orderCode: "ORD202611188F54D2",
  orderStatus: "CONFIRMED",
  orderPaymentStatus: "PAID",
  amount: 15900000,
  method: "BANK_TRANSFER",
  paidAt: "2026-11-18T09:50:41.718Z"
}
```

### Cách test
```bash
GET /payments/sepay/ORD202611188F54D2-ABCD1234/status
```

---

## 4. Xử lý IPN SePay (Webhook)

### API Endpoint
- **Method**: `POST /payments/sepay/ipn`
- **Authentication**: Public (verify bằng X-Secret-Key)
- **Controller**: `SepayPaymentsController`

### Luồng hoạt động
```
1. SePay gửi webhook khi user thanh toán thành công
   ↓
2. Verify signature (nếu SEPAY_WEBHOOK_STRICT=true)
   ↓
3. Transaction Database:
   - Tìm Payment theo invoiceNumber
   - Tạo PaymentEvent (để audit)
   ↓
4. Kiểm tra payment.status:
   - PAID → IGNORED (đã xử lý)
   - PENDING → tiếp tục
   ↓
5. Kiểm tra số tiền (amount):
   - Khớp → tiếp tục
   - Không khớp → REVIEW (cần admin xử lý)
   ↓
6. Kiểm tra order.status:
   - PAID → REVIEW (duplicate payment)
   - CANCELLED → REVIEW (order đã hủy)
   - PENDING → tiếp tục
   ↓
7. Update Payment:
   - status: PAID
   - paidAt: now()
   - method, sepayOrderId, sepayTransactionId
   ↓
8. Update Order:
   - paymentStatus: PAID
   - status: CONFIRMED (nếu đang PENDING)
   - paymentMethod, paymentTransactionId
   ↓
9. Tạo OrderStatusHistory
   ↓
10. Gửi notification cho User + Admin
   ↓
11. Gửi email xác nhận thanh toán (queue)
   ↓
12. Return { success: true }
```

### Payload SePay
```typescript
{
  notification_type: 'ORDER_PAID' | 'TRANSACTION_VOID',
  order: {
    order_id: "...",
    order_amount: "15900000",
    order_invoice_number: "ORD202611188F54D2-ABCD",
    order_status: "CAPTURED"
  },
  transaction: {
    transaction_id: "...",
    payment_method: "BANK_TRANSFER",
    transaction_status: "CAPTURED",
    transaction_amount: "15900000"
  }
}
```

### Cách test
```bash
# Sử dụng SePay sandbox hoặc simulate endpoint
POST /payments/simulate-sepay
Body: {
  orderId: 5,
  amount: 15900000,
  status: "PENDING"
}

# Hoặc gọi webhook thật từ SePay sandbox
POST /payments/sepay/ipn
Header: X-Secret-Key: {SEPAY_IPN_SECRET}
Body: { SePay IPN payload }
```

---

## 5. Cron Job: Hủy đơn quá hạn (Order Expiry)

### Service
- **Class**: `SepayOrderExpiryService`
- **Schedule**: `@Cron('*/1 * * * *')` - chạy mỗi phút (dev) / 10 phút (prod)
- **File**: `src/payments/sepay/sepay-order-expiry.service.ts`

### Luồng hoạt động
```
1. Job chạy mỗi phút
   ↓
2. Tìm các Order thỏa điều kiện:
   - status: PENDING
   - paymentStatus: UNPAID
   - paymentMethod: not null && not COD
   - createdAt < ORDER_TTL_MS (mặc định 60 phút)
   - Không có Payment PAID/REVIEW trong 30 phút gần nhất
   ↓
3. Với mỗi order:
   ↓
   a. Kiểm tra payment "muộn" (late payment):
      - Call SePay Gateway retrieveOrder()
      - Nếu CAPTURED → settleFromGateway (thanh toán thành công)
      - Nếu lỗi 404 → tiếp tục hủy
      - Nếu lỗi khác → bỏ qua (thử lại lượt sau)
   ↓
   b. Nếu không có late payment → expire order:
      - Transaction Database:
        - Khóa dòng Order (FOR UPDATE)
        - Kiểm tra lại status (để tránh đua)
        - Hoàn tồn kho (product/variant)
        - Update Order status: CANCELLED
        - Tạo OrderStatusHistory
      ↓
4. Gửi notification cho User
   ↓
5. Gửi email hủy đơn (queue)
```

### Cấu hình
```env
ORDER_TTL_MS=60000  # 1 phút cho dev, 3000000 (50 phút) cho prod
```

### Cách test
```bash
# 1. Tạo đơn hàng (không thanh toán)
POST /orders
Body: { ... paymentMethod: 'SEPAY_BANK_TRANSFER' ... }

# 2. Đợi ORDER_TTL_MS (ví dụ 1 phút cho dev)
# 3. Job sẽ tự động hủy đơn
# 4. Kiểm tra order status
GET /orders/{orderId}
Response: { status: 'CANCELLED' }

# 5. Kiểm tra log server
[SepayOrderExpiryService] Expired order ORD202611188F54D2
```

---

## 6. Cron Job: Đối soát Payment (Reconcile)

### Service
- **Class**: `SepayReconcileService`
- **Schedule**: `@Cron('*/5 * * * *')` - chạy mỗi 5 phút
- **File**: `src/payments/sepay/sepay-reconcile.service.ts`

### Luồng hoạt động
```
1. Job chạy mỗi 5 phút
   ↓
2. Tìm các Payment PENDING:
   - createdAt > 10 phút trước
   - lastCheckedAt: null hoặc > 5 phút trước
   ↓
3. Với mỗi payment:
   ↓
   a. Call SePay Gateway retrieveOrder(invoiceNumber)
   ↓
   b. Nếu error 404:
      - SePay chưa có đơn này → chưa thanh toán, bỏ qua
   ↓
   c. Nếu order_status == 'CAPTURED':
      - settleFromGateway() → xử lý thanh toán
      - Update payment status: PAID
      - Update order: PAID + CONFIRMED
      - Gửi notification + email
   ↓
   d. Nếu order_status != 'CAPTURED':
      - Payment vẫn PENDING, kiểm tra lại lượt sau
   ↓
   e. Nếu payment quá 24 giờ vẫn PENDING:
      - Update status: CANCELLED
   ↓
4. Update lastCheckedAt
```

### Tối ưu
- MIN_AGE_MS: 10 phút (chỉ kiểm tra payment tạo > 10 phút)
- RECHECK_MS: 5 phút (mỗi payment kiểm tra lại cách nhau tối thiểu 5 phút)
- EXPIRE_MS: 24 giờ (quá 24 giờ vẫn chưa thanh toán → CANCELLED)
- BATCH: 50 payment mỗi lần chạy

### Cách test
```bash
# 1. Tạo payment (không thanh toán)
POST /payments/sepay/checkout
Body: { orderId: 5 }

# 2. Đợi 10 phút
# 3. Call SePay gateway để "thanh toán" thật
# 4. Job reconcile sẽ tự động phát hiện và xử lý
# 5. Kiểm tra log
[SepayReconcileService] Reconciled ORD202611188F54D2-ABCD -> PAID
```

---

## 7. Admin xử lý Payment Review

### API Endpoints
- **GET /admin/payments** - Danh sách payment cần review
- **GET /admin/payments/unmatched** - Payment event không matched
- **GET /admin/payments/:id** - Chi tiết payment
- **POST /admin/payments/:id/accept` - Chấp nhận payment
- **POST /admin/payments/:id/refunded** - Đánh dấu hoàn tiền

### Permissions
- `payment:read` - Xem danh sách payment
- `payment:resolve` - Xử lý payment (accept/refunded)

### Luồng hoạt động (Accept)
```
1. Admin chọn payment REVIEW
   ↓
2. POST /admin/payments/:id/accept
   ↓
3. Kiểm tra payment status == REVIEW
   ↓
4. Transaction Database:
   - Khóa dòng Order (FOR UPDATE)
   - Kiểm tra lại status (tránh đua)
   ↓
5. Gọi markPaid() với force=true:
   - Bỏ qua kiểm tra số tiền
   - Update payment: PAID
   - Update order: PAID + CONFIRMED
   ↓
6. Tạo PaymentEvent (ADMIN_ACCEPT)
   ↓
7. Tạo OrderStatusHistory
   ↓
8. Gửi notification + email xác nhận
   ↓
9. Return { message: 'Đã chấp nhận thanh toán' }
```

### Luồng hoạt động (Refunded)
```
1. Admin chọn payment REVIEW
   ↓
2. POST /admin/payments/:id/refunded
   ↓
3. Transaction Database:
   - Update payment: REFUNDED
   ↓
4. Tạo PaymentEvent (ADMIN_REFUND)
   ↓
5. Return { message: 'Đã ghi nhận hoàn tiền' }
```

### Cách test
```bash
# 1. Login admin
POST /auth/login
Body: { email: "admin@furniture.com", password: "Admin@123" }

# 2. Lấy accessToken
# 3. Lấy danh sách payment cần review
GET /admin/payments?status=REVIEW
Header: Authorization: Bearer {accessToken}

# 4. Chấp nhận payment
POST /admin/payments/20/accept
Body: { note: "Admin xác nhận" }
Header: Authorization: Bearer {accessToken}

# 5. Hoặc đánh dấu hoàn tiền
POST /admin/payments/20/refunded
Body: { note: "Hoàn tiền cho khách" }
Header: Authorization: Bearer {accessToken}
```

---

## 8. Hủy đơn hàng (User)

### API Endpoint
- **Method**: `PATCH /orders/:id`
- **Authentication**: Bắt buộc
- **Controller**: `OrdersController`

### Luồng hoạt động
```
1. User gọi hủy đơn
   ↓
2. Kiểm tra order tồn tại + quyền truy cập
   ↓
3. Kiểm tra order.status == PENDING
   ↓
4. Transaction Database:
   - Khóa dòng Order (FOR UPDATE)
   - Kiểm tra lại status (tránh đua với IPN/job)
   ↓
5. Hoàn tồn kho (product/variant)
   ↓
6. Update Order status: CANCELLED
   ↓
7. Tạo OrderStatusHistory
   ↓
8. Return { message: 'Hủy đơn hàng thành công' }
```

### Cách test
```bash
# 1. Tạo đơn hàng
POST /orders
Body: { ... }

# 2. Hủy đơn
PATCH /orders/5
Header: Authorization: Bearer {accessToken}

# 3. Kiểm tra stock được hoàn lại
GET /products/{productId}
```

---

## 9. Thanh toán VNPay

### API Endpoints
- **POST /payments/create-vnpay** - Tạo URL thanh toán VNPay
- **GET /payments/vnpay-return** - Xử lý callback VNPay

### Luồng hoạt động
```
1. Client gọi create-vnpay với orderId
   ↓
2. Tạo VNPay URL với:
   - vnp_TmnCode, vnp_OrderInfo
   - vnp_Amount (x100)
   - vnp_ReturnUrl
   - vnp_SecureHash (HMAC SHA512)
   ↓
3. Redirect user đến VNPay
   ↓
4. User thanh toán → VNPay redirect về vnpay_ReturnUrl
   ↓
5. verifyVNPayReturn():
   - Verify secureHash
   - Kiểm tra số tiền khớp
   - Kiểm tra chưa PAID
   ↓
6. Update Order:
   - paymentStatus: PAID
   - status: CONFIRMED
   - paymentMethod: VNPAY
   ↓
7. Gửi notification + email
```

### Cách test
```bash
# 1. Tạo URL VNPay
POST /payments/create-vnpay
Body: { orderId: 5 }

# 2. Mở URL trả về
# 3. Chọn ngân hàng và thanh toán trên VNPay sandbox
# 4. Sau khi thanh toán, VNPay redirect về callback
```

---

## 10. Thanh toán MoMo

### API Endpoint
- **POST /payments/create-momo` - Tạo URL thanh toán MoMo

### Luồng hoạt động
```
1. Client gọi create-momo với orderId
   ↓
2. Tạo MoMo request:
   - partnerCode, accessKey, requestId
   - amount, orderId, orderInfo
   - signature (HMAC SHA256)
   ↓
3. Call MoMo API
   ↓
4. Trả về payUrl
   ↓
5. Redirect user đến MoMo
   ↓
6. User thanh toán → MoMo redirect về returnUrl
   ↓
7. Xử lý callback (cần implement IPN MoMo)
```

### Cách test
```bash
# 1. Tạo URL MoMo
POST /payments/create-momo
Body: { orderId: 5 }

# 2. Mở URL trả về
# 3. Thanh toán trên MoMo sandbox
```

---

## 11. Thanh toán COD

### API Endpoint
- **POST /payments/confirm-cod` - Admin xác nhận thanh toán COD

### Luồng hoạt động
```
1. Shipper giao hàng
   ↓
2. Admin gọi confirm-cod
   ↓
3. Kiểm tra order.paymentMethod == 'COD'
   ↓
4. Update Order:
   - paymentStatus: PAID
   - status: CONFIRMED
   ↓
5. Gửi notification + email
```

### Cách test
```bash
POST /payments/confirm-cod
Body: { orderId: 5 }
```

---

## 12. Webhook SePay (Bank Transfer Direct)

### API Endpoint
- **Method**: `POST /payments/sepay-webhook`
- **Authentication**: Public (verify signature nếu strict mode)
- **Controller**: `PaymentsController`

### Luồng hoạt động
```
1. User chuyển khoản trực tiếp vào tài khoản SePay
   ↓
2. SePay gửi webhook về server
   ↓
3. Verify signature (nếu SEPAY_WEBHOOK_STRICT=true)
   ↓
4. Extract orderCode từ content
   ↓
5. Tìm Order theo code
   ↓
6. Kiểm tra:
   - Nếu có Payment via Gateway → ignore (IPN sẽ xử lý)
   - Nếu paymentStatus == PAID → ignore (đã thanh toán)
   - Kiểm tra transactionId (idempotent)
   ↓
7. Nếu đủ tiền (amount >= orderAmount):
   - Update Order: PAID + CONFIRMED
   - paymentMethod: BANK_TRANSFER
   - paymentTransactionId: transactionId
   ↓
8. Gửi notification + email
   ↓
9. Return { success: true, orderCode, code: 'SUCCESS' }
```

### Cách test
```bash
# Sử dụng SePay sandbox để chuyển khoản
# Hoặc simulate endpoint
POST /payments/simulate-sepay
Body: {
  gateway: 'BIDV',
  transactionDate: '2026-11-18 16:51:04',
  accountNumber: '0000000001',
  code: 'ORD20261118',
  content: 'Thanh toan don hang ORD202611188F54D2',
  transferType: 'in',
  transferAmount: 20000000
}
```

---

## Cron Jobs Summary

| Service | Schedule | Chức năng |
|---------|----------|-----------|
| SepayOrderExpiryService | */1 * * * * (dev) | Hủy đơn quá hạn chưa thanh toán |
| SepayReconcileService | */5 * * * * | Đối soát payment với SePay Gateway |
| MailOutboxService | @Cron(EVERY_MINUTE) | Gửi email từ outbox |
| EmailOutbox cleanup | @Cron(EVERY_MINUTE) | Xóa email stuck SENDING quá 10 phút |

---

## Payment Status Flow

```
PENDING (được tạo)
  ↓
PAID (thanh toán thành công)
  ↓
CONFIRMED (đơn được xác nhận)
  ↓
REVIEW (cần admin xử lý)
  ↓
REFUNDED (hoàn tiền)
  ↓
VOIDED (giao dịch bị hủy)
  ↓
CANCELLED (hủy đơn/expire)
```

---

## Order Status Flow

```
PENDING (được tạo)
  ↓
CONFIRMED (đã thanh toán)
  ↓
SHIPPING (đang giao)
  ↓
DELIVERED (đã giao)
  ↓
CANCELLED (hủy)
```

---

## Database Schema (Quan trọng)

### Payment
- id, orderId, invoiceNumber, amount, currency
- status: PENDING, PAID, REVIEW, REFUNDED, VOIDED, CANCELLED
- method, sepayOrderId, sepayTransactionId
- paidAt, createdAt, lastCheckedAt

### PaymentEvent
- id, eventKey, invoiceNumber, paymentId
- notificationType: ORDER_PAID, TRANSACTION_VOID, RECONCILE, ADMIN_ACCEPT, ADMIN_REFUND
- payload (JSON), result: PROCESSED, IGNORED, AMOUNT_MISMATCH, DUPLICATE_PAYMENT, ORDER_CANCELLED
- receivedAt

### Order
- id, code, userId, status, paymentStatus
- totalAmount, shippingFee, discountAmount
- paymentMethod, paymentTransactionId, paymentRawData
- shippingInfo, contactEmail

### OrderStatusHistory
- id, orderId, status, note, changedBy, createdAt

---

## Cấu hình Môi trường

```env
# Order expiry (thời gian hủy đơn chưa thanh toán)
ORDER_TTL_MS=60000  # 1 phút cho dev, 1800000 (30 phút) cho prod

# SePay
SEPAY_WEBHOOK_STRICT=false  # dev: false, prod: true
SEPAY_IPN_SECRET=...
SEPAY_API_TOKEN=...
SEPAY_MERCHANT_ID=...

# VNPay
VNP_TMN_CODE=...
VNP_HASH_SECRET=...
VNP_URL=...
VNP_RETURN_URL=...

# MoMo
MOMO_PARTNER_CODE=...
MOMO_ACCESS_KEY=...
MOMO_SECRET_KEY=...
MOMO_ENDPOINT=...

# Email
MAIL_ENABLED=true
MAIL_HOST=localhost
MAIL_PORT=1025
MAIL_FROM=...
MAIL_RESET_PASSWORD_URL=...
MAIL_VERIFY_EMAIL_URL=...
```

---

## Test Cases

### Test Case 1: Flow thanh toán thành công (SePay)
```bash
1. Tạo đơn hàng
POST /orders
Body: { items: [...], paymentMethod: 'SEPAY_BANK_TRANSFER', ... }

2. Tạo payment
POST /payments/sepay/checkout
Body: { orderId: 5 }

3. Mở checkoutUrl trả về

4. Simulate thanh toán (dev)
POST /payments/simulate-sepay
Body: { orderId: 5, amount: 15900000, status: 'PENDING' }

5. Kiểm tra order status
GET /orders/5
Expected: { status: 'CONFIRMED', paymentStatus: 'PAID' }

6. Kiểm tra email (nếu MAIL_ENABLED=true)
```

### Test Case 2: Hủy đơn quá hạn
```bash
1. Tạo đơn hàng không thanh toán
POST /orders
Body: { paymentMethod: 'SEPAY_BANK_TRANSFER', ... }

2. Đợi ORDER_TTL_MS (1 phút dev)

3. Job SepayOrderExpiryService tự động hủy đơn

4. Kiểm tra status
GET /orders/{orderId}
Expected: { status: 'CANCELLED', paymentStatus: 'UNPAID' }

5. Kiểm tra stock được hoàn lại
GET /products/{productId}
```

### Test Case 3: Payment mismatch (cần admin xử lý)
```bash
1. Tạo payment với amount sai
POST /payments/simulate-sepay
Body: { orderId: 5, amount: 10000000 }  # Đơn 15tr nhưng chỉ trả 10tr

2. Kiểm tra payment status
GET /admin/payments?status=REVIEW
Expected: Payment có status: REVIEW, reason: AMOUNT_MISMATCH

3. Admin chấp nhận (bỏ qua kiểm tra số tiền)
POST /admin/payments/{paymentId}/accept
Body: { note: "Admin xác nhận" }

4. Kiểm tra lại
GET /orders/{orderId}
Expected: { status: 'CONFIRMED', paymentStatus: 'PAID' }
```

### Test Case 4: Đối soát payment muộn
```bash
1. Tạo payment (không thanh toán)
POST /payments/sepay/checkout
Body: { orderId: 5 }

2. User thanh toán bên SePay (sau 10 phút)

3. Job SepayReconcileService phát hiện:
   - retrieveOrder() trả về CAPTURED
   - settleFromGateway() xử lý thanh toán
   - Update order: PAID + CONFIRMED

4. Kiểm tra status
GET /orders/5
Expected: { status: 'CONFIRMED', paymentStatus: 'PAID' }
```

### Test Case 5: User hủy đơn
```bash
1. Tạo đơn hàng
POST /orders
Body: { ... }

2. Hủy đơn ngay
PATCH /orders/5
Header: Authorization: Bearer {accessToken}

3. Kiểm tra status
GET /orders/5
Expected: { status: 'CANCELLED', paymentStatus: 'UNPAID' }

4. Kiểm tra stock được hoàn lại
```

---

## Logging & Debug

### Log quan trọng
- `[SepayPaymentsService]` - IPN xử lý
- `[SepayOrderExpiryService]` - Hủy đơn quá hạn
- `[SepayReconcileService]` - Đối soát payment
- `[OrderQueueProcessor]` - Queue jobs
- `[MailOutboxService]` - Gửi email

### Debug tips
1. Kiểm tra bảng `PaymentEvent` để xem lịch sử payment
2. Kiểm tra bảng `OrderStatusHistory` để xem trạng thái đơn
3. Kiểm tra bảng `EmailOutbox` để xem email queue
4. Disable MAIL_ENABLED=true để chỉ log thay vì gửi email thật

---

## Common Issues

### 1. Payment bị REVIEW
- Nguyên nhân: Số tiền không khớp, đơn đã thanh toán, đơn đã hủy
- Giải pháp: Admin kiểm tra và accept/refunded

### 2. Order bị hủy ngoài ý muốn
- Nguyên nhân: Quá ORDER_TTL_MS chưa thanh toán
- Giải pháp: Tăng ORDER_TTL_MS hoặc thanh toán trước khi hết hạn

### 3. IPN không nhận được
- Nguyên nhân: Webhook URL sai, SePay không gọi được
- Giải pháp: Sử dụng ngrok để expose localhost, kiểm tra SEPAY_SUCCESS_URL

### 4. Email không gửi được
- Nguyên nhân: MAIL_ENABLED=false, SMTP không kết nối
- Giải pháp: Bật MAIL_ENABLED=true, kiểm tra MAIL_HOST/PORT

---

## Security

### Idempotency
- PaymentEvent.eventKey unique → IPN trùng bị chặn
- transactionId trong Order → duplicate transaction bị chặn
- FOR UPDATE trong transaction → tránh đua giữa IPN/job/admin

### Verification
- SEPAY_WEBHOOK_STRICT=true → verify signature
- VNP secureHash → verify HMAC SHA512
- MoMo signature → verify HMAC SHA256

### Rate Limiting
- /payments/sepay/checkout: 5 lần/phút/IP
- /payments/sepay/:invoice/status: 60 lần/phút/IP
- /auth/login: 5 lần/phút

---

## Summary

### Các chức năng chính
1. ✅ Tạo đơn hàng ( OrdersService.create)
2. ✅ Tạo payment checkout (SepayPaymentsService.createCheckout)
3. ✅ Kiểm tra trạng thái payment (getStatus)
4. ✅ Xử lý IPN SePay (handleIpn)
5. ✅ Hủy đơn quá hạn (SepayOrderExpiryService - cron)
6. ✅ Đối soát payment (SepayReconcileService - cron)
7. ✅ Admin xử lý payment review (SepayAdminController)
8. ✅ User hủy đơn (OrdersService.cancel)
9. ✅ Thanh toán VNPay (PaymentsService.createVNPayUrl)
10. ✅ Thanh toán MoMo (PaymentsService.createMoMoUrl)
11. ✅ Xác nhận COD (PaymentsService.confirmCod)
12. ✅ Webhook SePay direct transfer (PaymentsService.handleSePayWebhook)

### Automation
- ✅ Cron job hủy đơn quá hạn
- ✅ Cron job đối soát payment
- ✅ Queue jobs gửi email/notification
- ✅ WebSocket realtime notification
- ✅ Email outbox với retry logic

### Testing
- Dùng Postman hoặc curl để test API
- Dùng SePay sandbox để test thanh toán thật
- Sử dụng simulate endpoint cho dev
- Kiểm tra database trực tiếp với Prisma Studio
- Kiểm tra log server để debug
