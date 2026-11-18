# Phân tích Bảo mật và Test Coverage - SePay Payment

## 🔒 Đánh giá Bảo mật hiện tại

### ✅ Đã triển khai tốt

#### 1. Xác thực IPN (Webhook)
```typescript
// src/payments/sepay/sepay-payments.controller.ts:50-54
const expected = Buffer.from(this.config.getOrThrow<string>('SEPAY_IPN_SECRET'));
const got = Buffer.from(secret ?? '');
if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
    throw new UnauthorizedException();
}
```
**✅ Good:**
- Sử dụng `timingSafeEqual` để tránh timing attack
- Secret key được lưu trong .env (không hardcode)
- Throw UnauthorizedException nếu không match

**⚠️ Potential Issue:**
- Secret key chỉ so sánh string, không có HMAC signature từ payload
- Nếu secret bị leak, attacker có thể spoof IPN

#### 2. Rate Limiting
```typescript
// Checkout: 5 lần/phút/IP
@Throttle({ default: { limit: 5, ttl: 60_000 } })

// Status check: 60 lần/phút/IP
@Throttle({ default: { limit: 60, ttl: 60_000 } })
```
**✅ Good:**
- Giống spam checkout
- Giống brute force status polling

**⚠️ Missing:**
- Không có rate limiting cho IPN endpoint (có thể bị spam webhook)
- Không có rate limiting cho simulate endpoint (dev only)

#### 3. Idempotency
```typescript
// PaymentEvent.eventKey unique
const eventKey = `${p.notification_type}:${p.transaction?.transaction_id ?? p.order?.order_id}`;
await tx.paymentEvent.create({ data: { eventKey, ... } });
```
**✅ Good:**
- IPN duplicate bị chặn bởi database constraint (P2002)
- Trừ tiền duplicate được ngăn chặn

**✅ Idempotency ở nhiều tầng:**
- PaymentEvent.eventKey (unique constraint)
- transactionId check trong order
- payment.status check trước khi update
- FOR UPDATE lock trong transaction

#### 4. Transaction Locking
```typescript
await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
```
**✅ Good:**
- Tránh race condition giữa IPN, job expiry, admin accept
- Đảm bảo atomic update

#### 5. Invoice Number Security
```typescript
const invoiceNumber = `${order.code}-${randomBytes(4).toString('hex').toUpperCase()}`;
```
**✅ Good:**
- Random suffix (8 hex chars) = 16^8 = 4 tỷ combinations
- Không đoán được invoice number
- Thay đổi mỗi lần checkout

**⚠️ Potential Issue:**
- Invoice number được expose trong URL success/error/cancel
- Attacker có thể brute force nếu biết order code pattern

#### 6. Amount Validation
```typescript
if (!new Prisma.Decimal(info.amount).equals(payment.amount)) {
    return review('AMOUNT_MISMATCH');
}
```
**✅ Good:**
- So sánh số tiền từ IPN với DB
- Mismatch → REVIEW (cần admin xử lý)
- Không tự động accept sai số tiền

#### 7. Duplicate Payment Check
```typescript
if (order.paymentStatus === 'PAID') {
    return review('DUPLICATE_PAYMENT');
}
```
**✅ Good:**
- Trừ tiền nhiều lần cho cùng đơn hàng
- Gửi cho admin để review/hoàn tiền

#### 8. Order Cancellation Check
```typescript
if (order.status === 'CANCELLED') {
    return review('ORDER_CANCELLED');
}
```
**✅ Good:**
- Không thanh toán cho đơn đã hủy
- Admin cần review

---

## ⚠️ Lỗ hổng tiềm năng & Khuyến nghị

### 1. **Không verify signature cho Checkout Success/Error/Cancel URLs**

**Vấn đề:**
- Frontend chỉ dùng invoiceNumber để check status
- Attacker có thể manipulate invoiceNumber trong URL để xem payment của người khác

**Hiện tại:**
```typescript
// payment-success.html?invoice=ORD202611188F54D2-ABCD1234
// Ai cũng có thể đổi invoice để xem status của người khác
```

**Khuyến nghị:**
```typescript
// Thêm HMAC signature vào success URL
const signature = crypto.createHmac('sha256', SEPAY_SUCCESS_SECRET)
    .update(invoiceNumber)
    .digest('hex');

successUrl: `${base}/payment-success.html?invoice=${invoice}&sig=${signature}`;

// Frontend verify signature trước khi call API
```

### 2. **Không có CSRF Protection cho Checkout**

**Vấn đề:**
- POST /payments/sepay/checkout không có CSRF token
- Attacker có thể trigger checkout từ malicious site (nếu user đã login)

**Khuyến nghị:**
```typescript
// Sử dụng @Csrf() decorator của NestJS
@Csrf()
@Post('checkout')
checkout(@Body() dto: SepayCheckoutDto, @Req() req: any) {
    // ...
}
```

### 3. **Không có Rate Limiting cho IPN**

**Vấn đề:**
- POST /payments/sepay/ipn không có throttle
- Attacker có thể spam webhook để overload server

**Khuyến nghị:**
```typescript
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 100, ttl: 60_000 } })
@Post('ipn')
ipn(...) {
    // ...
}
```

### 4. **IPN Secret chỉ so sánh string, không có HMAC**

**Vấn đề:**
- X-Secret-Key header chỉ so sánh trực tiếp
- Nếu secret bị leak (log, misconfig), attacker có thể spoof IPN

**Hiện tại:**
```typescript
const expected = Buffer.from(SEPAY_IPN_SECRET);
const got = Buffer.from(secret ?? '');
if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
    throw new UnauthorizedException();
}
```

**Khuyến nghị:**
```typescript
// Tính HMAC từ payload và verify
const computedSig = crypto.createHmac('sha256', SEPAY_IPN_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');

if (computedSig !== signature) {
    throw new UnauthorizedException();
}
```

### 5. **Không có Webhook Signature Verification cho Direct Bank Transfer**

**Vấn đề:**
- `handleSePayWebhook` chỉ có strict mode (optional)
- Nếu strict mode = false, không verify gì cả

**Hiện tại:**
```typescript
const strict = process.env.SEPAY_WEBHOOK_STRICT === 'true';
if (strict) {
    const ok = this.verifySePaySignature(payload, headers, rawBody, secret);
    if (!ok) return { success: false, message: 'Invalid signature' };
}
// dev + strict=false → bỏ qua verify
```

**Khuyến nghị:**
- Luôn enable strict mode trong production
- Hoặc có fallback mechanism (nhưng vẫn log warning)

### 6. **Không có Timeout Handling cho Gateway API Calls**

**Vấn đề:**
- `retrieveOrder()` có thể treo nếu SePay API chậm
- Không có timeout → job có thể bị stuck

**Khuyến nghị:**
```typescript
async retrieveOrder(invoiceNumber: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s

    try {
        const res = await this.client.order.retrieve(invoiceNumber, {
            signal: controller.signal
        });
        clearTimeout(timeout);
        return res;
    } catch (error) {
        clearTimeout(timeout);
        throw error;
    }
}
```

### 7. **Logging Sensitive Data**

**Vấn đề:**
- Log invoiceNumber, amount trong console
- Có thể leak trong log aggregation system

**Hiện tại:**
```typescript
this.logger.log(`[RECONCILE DEBUG] Full response from SePay for ${invoiceNumber}: ...`);
```

**Khuyến nghị:**
- Log chỉ invoiceNumber (thay vì full response)
- Hoặc mask sensitive fields trong log

### 8. **Không có Circuit Breaker cho SePay Gateway**

**Vấn đề:**
- Nếu SePay API down, reconcile job vẫn gọi liên tục
- Có thể gây cascade failure

**Khuyến nghị:**
```typescript
// Sử dụng circuit-breaker pattern
import { CircuitBreaker } from '@nestjs/circuit-breaker';

@CircuitBreaker({
    threshold: 5,
    timeout: 10000,
    resetTimeout: 30000,
})
async retrieveOrder(invoiceNumber: string) {
    // ...
}
```

---

## 🧪 Test Coverage Analysis

### ✅ Đã cover

| Test Case | Status | Method |
|-----------|--------|--------|
| Tạo đơn hàng | ✅ | Manual test / Postman |
| Tạo payment checkout | ✅ | Manual test / Postman |
| Poll status payment | ✅ | Manual test / Postman |
| IPN thanh toán thành công | ✅ | SePay sandbox / simulate |
| IPN số tiền không khớp | ✅ | Manual test (modify amount) |
| IPN duplicate payment | ✅ | Manual test (send same IPN twice) |
| IPN order đã hủy | ✅ | Manual test (cancel order before IPN) |
| Hủy đơn quá hạn (cron) | ✅ | Tự động chạy job |
| Đối soát payment (cron) | ✅ | Tự động chạy job |
| Admin accept payment review | ✅ | Manual test / Postman |
| Admin refunded payment review | ✅ | Manual test / Postman |
| User hủy đơn | ✅ | Manual test / Postman |
| Race condition IPN vs Job | ⚠️ | Partial (FOR UPDATE lock) |
| Race condition IPN vs Admin | ⚠️ | Partial (FOR UPDATE lock) |

### ❌ Chưa cover (Critical)

#### 1. **IPN Replay Attack**
```typescript
// Test: Gửi cùng IPN payload nhiều lần
// Expected: Chỉ xử lý lần đầu, các lần sau bị ignore
// Current: Đã có PaymentEvent.eventKey unique ✅
// But: Không có unit test
```

**Test case:**
```typescript
describe('IPN Replay Attack', () => {
    it('should ignore duplicate IPN', async () => {
        const payload = { ... };
        await service.handleIpn(payload); // Lần 1
        await service.handleIpn(payload); // Lần 2

        const payment = await prisma.payment.findUnique({ where: { invoiceNumber } });
        expect(payment.status).toBe('PAID');
        expect(payment.paidAt).not.toBeNull(); // Chỉ cập nhật 1 lần
    });
});
```

#### 2. **IPN with Manipulated Amount**
```typescript
// Test: IPN với amount sai nhưng signature đúng
// Expected: REVIEW status
// Current: Đã có logic ✅
// But: Không có unit test
```

**Test case:**
```typescript
describe('IPN Amount Manipulation', () => {
    it('should mark as REVIEW if amount mismatch', async () => {
        const payload = {
            ...,
            order: { order_amount: '10000000' } // Đơn 15tr nhưng IPN trả 10tr
        };
        await service.handleIpn(payload);

        const payment = await prisma.payment.findUnique({ where: { invoiceNumber } });
        expect(payment.status).toBe('REVIEW');
    });
});
```

#### 3. **IPN with Wrong Order (Invoice Number)**
```typescript
// Test: IPN với invoiceNumber không tồn tại
// Expected: UNMATCHED (PaymentEvent được tạo nhưng không có payment)
// Current: Đã có logic ✅
// But: Không có unit test
```

**Test case:**
```typescript
describe('IPN Wrong Invoice', () => {
    it('should create UNMATCHED event if invoice not found', async () => {
        const payload = {
            order: { order_invoice_number: 'INVALID-1234' }
        };
        await service.handleIpn(payload);

        const event = await prisma.paymentEvent.findFirst({
            where: { invoiceNumber: 'INVALID-1234' }
        });
        expect(event.result).toBe('UNMATCHED');
    });
});
```

#### 4. **Checkout with Wrong OrderId (SQL Injection)**
```typescript
// Test: Checkout với orderId không hợp lệ hoặc malicious
// Expected: 404 Not Found
// Current: Đã có logic ✅
// But: Không có security test
```

**Test case:**
```typescript
describe('Checkout Security', () => {
    it('should return 404 for invalid orderId', async () => {
        await expect(
            service.createCheckout(999999, userId)
        ).rejects.toThrow(NotFoundException);
    });

    it('should prevent SQL injection in orderId', async () => {
        // Prisma tự động sanitize, nhưng vẫn nên test
        await expect(
            service.createCheckout(Number("1 OR 1=1"), userId)
        ).rejects.toThrow();
    });
});
```

#### 5. **Concurrent Checkout Attempts**
```typescript
// Test: 2 user gọi checkout cùng lúc cho cùng 1 order
// Expected: Tạo 2 payment khác nhau (không đuổi nhau)
// Current: Không có lock ❌
```

**Test case:**
```typescript
describe('Concurrent Checkout', () => {
    it('should allow multiple checkout attempts', async () => {
        const [p1, p2] = await Promise.all([
            service.createCheckout(orderId, userId),
            service.createCheckout(orderId, userId)
        ]);

        expect(p1.invoiceNumber).not.toBe(p2.invoiceNumber);
        expect(p1.invoiceNumber).toContain(orderCode);
        expect(p2.invoiceNumber).toContain(orderCode);
    });
});
```

#### 6. **Payment Hijacking (Đổi OrderId trong Request)**
```typescript
// Test: User A gọi checkout cho order của User B
// Expected: 404 Not Found (hoặc 403 Forbidden)
// Current: Đã có logic ✅
// But: Không có unit test
```

**Test case:**
```typescript
describe('Payment Hijacking', () => {
    it('should prevent checkout for other user order', async () => {
        const order = await createOrder({ userId: userA.id });
        await expect(
            service.createCheckout(order.id, userB.id)
        ).rejects.toThrow(NotFoundException);
    });
});
```

#### 7. **Race Condition: IPN vs Admin Accept**
```typescript
// Test: IPN và Admin accept cùng lúc
// Expected: Chỉ 1 bên thắng (FOR UPDATE lock)
// Current: Đã có lock ✅
// But: Không có integration test
```

**Test case:**
```typescript
describe('Race Condition IPN vs Admin', () => {
    it('should handle concurrent IPN and admin accept', async () => {
        const payment = await createPayment({ status: 'REVIEW' });

        await Promise.all([
            service.handleIpn(mockIPN), // IPN
            adminService.acceptPayment(payment.id) // Admin
        ]);

        const final = await prisma.payment.findUnique({ where: { id: payment.id } });
        expect(final.status).toBe('PAID'); // Chỉ 1 lần update
    });
});
```

#### 8. **Webhook Spoofing**
```typescript
// Test: Gửi IPN với sai secret
// Expected: 401 Unauthorized
// Current: Đã có logic ✅
// But: Không có security test
```

**Test case:**
```typescript
describe('Webhook Spoofing', () => {
    it('should reject IPN with wrong secret', async () => {
        const response = await request(app)
            .post('/payments/sepay/ipn')
            .set('x-secret-key', 'wrong-secret')
            .send(mockIPN);

        expect(response.status).toBe(401);
    });
});
```

#### 9. **Timeout Handling**
```typescript
// Test: SePay API timeout
// Expected: Retry hoặc graceful failure
// Current: Không có timeout ❌
```

**Test case:**
```typescript
describe('Gateway Timeout', () => {
    it('should handle gateway timeout gracefully', async () => {
        jest.spyOn(gatewayService, 'retrieveOrder')
            .mockImplementation(() => new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Timeout')), 10000)
            ));

        await expect(
            reconcileService.checkOne(payment)
        ).rejects.toThrow();
    });
});
```

#### 10. **Network Failure During Payment**
```typescript
// Test: User checkout thành công nhưng không thể redirect
// Expected: Payment vẫn được tạo, user có thể thử lại
// Current: Không có test ❌
```

**Test case:**
```typescript
describe('Network Failure', () => {
    it('should not create payment if checkout fails', async () => {
        jest.spyOn(gatewayService, 'buildCheckout')
            .mockRejectedValue(new Error('Network error'));

        await expect(
            service.createCheckout(orderId, userId)
        ).rejects.toThrow();

        const payment = await prisma.payment.findFirst({ where: { orderId } });
        expect(payment).toBeNull();
    });
});
```

#### 11. **Payment Expiry Flow**
```typescript
// Test: Payment quá 24 giờ chưa thanh toán
// Expected: Status CANCELLED
// Current: Đã có logic ✅
// But: Không có unit test
```

**Test case:**
```typescript
describe('Payment Expiry', () => {
    it('should cancel payment after 24 hours', async () => {
        const payment = await createPayment({
            createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000)
        });

        await reconcileService.run();

        const updated = await prisma.payment.findUnique({ where: { id: payment.id } });
        expect(updated.status).toBe('CANCELLED');
    });
});
```

#### 12. **Duplicate Order Code**
```typescript
// Test: Tạo 2 order có cùng code (rất hiếm)
// Expected: Database constraint prevent
// Current: Không có test ❌
```

---

## 📊 Security Score

| Category | Score | Notes |
|----------|-------|-------|
| Authentication | 7/10 | IPN secret OK, nhưng nên dùng HMAC |
| Authorization | 8/10 | Check userId/permission OK |
| Idempotency | 9/10 | EventKey + transactionId + lock |
| Rate Limiting | 6/10 | Checkout/Status OK, nhưng IPN thiếu |
| Input Validation | 8/10 | DTO + Prisma sanitize OK |
| SQL Injection | 9/10 | Prisma tự động prevent |
| XSS | 8/10 | Zod DTO + NestJS auto-escape |
| CSRF | 5/10 | Không có CSRF protection |
| Timing Attack | 9/10 | timingSafeEqual ✅ |
| Logging | 6/10 | Log sensitive data |
| **Overall** | **7.3/10** | Good nhưng có lỗ hổng |

---

## 📋 Test Coverage Score

| Category | Score | Notes |
|----------|-------|-------|
| Happy Path | 8/10 | Flow chính OK |
| Error Path | 6/10 | Một số error case chưa test |
| Security Test | 4/10 | Thiếu nhiều security test |
| Concurrency | 5/10 | Có lock nhưng không test |
| Integration | 6/10 | Manual test nhưng không automated |
| **Overall** | **5.8/10** | Cần thêm unit + integration test |

---

## 🎯 Khuyến nghị Priority

### 🔴 High Priority (Security)
1. **Enable strict mode cho Webhook** - Production luôn phải verify signature
2. **Add HMAC signature cho Success/Error URLs** - Tránh invoice manipulation
3. **Add rate limiting cho IPN** - Tránh spam webhook
4. **Add timeout cho Gateway API calls** - Tránh stuck job

### 🟡 Medium Priority (Test)
5. **Add unit tests cho IPN edge cases** - Replay, amount mismatch, wrong invoice
6. **Add integration tests cho race conditions** - IPN vs Job vs Admin
7. **Add security tests** - Spoofing, hijacking, SQL injection
8. **Add concurrency tests** - Concurrent checkout, concurrent update

### 🟢 Low Priority (Nice to have)
9. **Add CSRF protection** - Cho checkout endpoint
10. **Add circuit breaker** - Cho SePay Gateway
11. **Mask sensitive data in logs** - Invoice number, amount
12. **Add monitoring/alerting** - Cho payment failures

---

## 📝 Action Items

### Immediate (Before Production)
- [ ] Set `SEPAY_WEBHOOK_STRICT=true` in production .env
- [ ] Set `SEPAY_WEBHOOK_STRICT=true` in production .env
- [ ] Add rate limiting cho IPN endpoint
- [ ] Add timeout (10s) cho `retrieveOrder()`
- [ ] Review log configuration (không log sensitive data)

### Short-term (1-2 weeks)
- [ ] Add HMAC signature cho success/error URLs
- [ ] Add unit tests cho IPN handling
- [ ] Add integration tests cho race conditions
- [ ] Add security tests cho webhooks

### Long-term (1 month)
- [ ] Add CSRF protection
- [ ] Add circuit breaker cho Gateway
- [ ] Setup monitoring/alerting
- [ ] Add automated security scanning

---

## 🔍 Checklist Production Readiness

- [ ] All environment variables set correctly (SEPAY_* secrets)
- [ ] Strict mode enabled for webhooks
- [ ] Rate limiting configured for all public endpoints
- [ ] Database backups automated
- [ ] Monitoring setup (payment failures, IPN errors)
- [ ] Alerting configured (high rate of REVIEW payments)
- [ ] Load testing performed (simulate concurrent users)
- [ ] Security audit completed (external review)
- [ ] Documentation updated (runbook for payment issues)
- [ ] Team trained on payment troubleshooting

---

## Summary

### Điểm mạnh
✅ Idempotency tốt (eventKey + transactionId + lock)
✅ Rate limiting cho checkout/status check
✅ Amount validation
✅ Duplicate payment prevention
✅ Transaction locking tránh race condition
✅ Timing-safe comparison cho secret

### Điểm yếu
⚠️ IPN chỉ so sánh string secret (không HMAC)
⚠️ Không có signature cho success/error URLs
⚠️ Không có rate limiting cho IPN
⚠️ Không có timeout cho Gateway API
⚠️ Thiếu nhiều unit/integration tests
⚠️ Logging sensitive data

### Đánh giá tổng quan
**Security: 7.3/10** - Good nhưng cần cải thiện trước production
**Test Coverage: 5.8/10** - Manual test OK nhưng thiếu automated tests

**Khuyến nghị:** Cải thiện security (high priority) và thêm tests (medium priority) trước khi deploy production.
