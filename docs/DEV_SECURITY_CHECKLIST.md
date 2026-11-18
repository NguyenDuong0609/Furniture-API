# Checklist Bảo mật cho Developer Environment

Dành cho môi trường dev - chỉ những thay đổi cần thiết, dễ implement.

---

## 🔴 Critical (Phải làm ngay)

### 1. Add Rate Limiting cho IPN Endpoint

**Vấn đề:** Không có rate limiting cho `/payments/sepay/ipn` - có thể spam webhook

**Fix:**
```typescript
// src/payments/sepay/sepay-payments.controller.ts
@Public()
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 100, ttl: 60_000 } }) // 100 lần/phút
@Post('ipn')
async ipn(...) {
    // ...
}
```

**Why:** Tránh attacker spam webhook để overload server

---

### 2. Add Timeout cho Gateway API Calls

**Vấn đề:** `retrieveOrder()` có thể treo nếu SePay API chậm - job bị stuck

**Fix:**
```typescript
// src/payments/sepay/sepay-gateway.service.ts
async retrieveOrder(invoiceNumber: string): Promise<any> {
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
        if (error.name === 'AbortError') {
            this.logger.error(`Timeout retrieving order ${invoiceNumber}`);
            throw new Error('Gateway timeout');
        }
        throw error;
    }
}
```

**Why:** Tránh job reconcile/expire bị stuck khi SePay API chậm

---

### 3. Mask Sensitive Data trong Logs

**Vấn đề:** Log invoiceNumber, amount trong console - có thể leak

**Fix:**
```typescript
// src/payments/sepay/sepay-gateway.service.ts
// Trước:
this.logger.log(`[RECONCILE DEBUG] Full response from SePay for ${invoiceNumber}: ...`);

// Sau:
const maskedInvoice = invoiceNumber.slice(0, -4) + '****';
this.logger.log(`[RECONCILE DEBUG] Invoice: ${maskedInvoice}, Status: ${result?.order_status}`);
```

**Why:** Tránh leak thông tin payment trong logs

---

### 4. Enable Strict Mode cho Webhook (không bắt buộc nhưng nên có)

**Vấn đề:** `SEPAY_WEBHOOK_STRICT=false` - không verify signature

**Fix:**
```env
# .env
SEPAY_WEBHOOK_STRICT=true  # Dev cũng nên enable
SEPAY_IPN_SECRET=your-secret-here
```

**Why:** Nếu dev cũng enable, sẽ phát hiện sớm lỗi verify signature trước production

**Nếu không muốn enable:** Tối thiểu phải log warning khi nhận webhook với strict=false:
```typescript
// src/payments/payments.service.ts
if (!strict) {
    this.logger.warn('[WEBHOOK] Strict mode disabled - skipping signature verification');
}
```

---

## 🟡 Medium Priority (Nên làm)

### 5. Add HMAC Signature cho Success/Error URLs (Optional cho dev)

**Vấn đề:** Invoice number được expose trong URL - attacker có thể brute force

**Fix:**
```typescript
// src/payments/sepay/sepay-payments.service.ts
async createCheckout(orderId: number, userId?: number, method?: SepayMethod) {
    // ... existing code ...

    const signature = crypto.createHmac('sha256', this.config.getOrThrow('SEPAY_SUCCESS_SECRET'))
        .update(invoiceNumber)
        .digest('hex');

    return this.gateway.buildCheckout({
        // ... existing fields ...
        successUrl: `${base}/payment-success.html?invoice=${invoice}&sig=${signature}`,
        errorUrl: `${base}/payment-error.html?invoice=${invoice}&sig=${signature}`,
        cancelUrl: `${base}/payment-cancel.html?invoice=${invoice}&sig=${signature}`,
    });
}
```

Frontend verify:
```typescript
// payment-success.html
const urlParams = new URLSearchParams(window.location.search);
const invoice = urlParams.get('invoice');
const sig = urlParams.get('sig');

// Call API để verify
GET /payments/sepay/:invoice/verify?sig=${sig}
```

**Why:** Tránh attacker đổi invoice để xem payment của người khác

**Dev có thể bỏ qua:** Nếu không có thời gian, có thể implement sau

---

### 6. Add Unit Tests cho IPN Critical Cases

**Vấn đề:** Không có automated tests cho IPN edge cases

**Fix:**
```typescript
// test/payments/sepay/sepay-payments.service.spec.ts
describe('IPN Security', () => {
    it('should reject IPN with wrong secret', async () => {
        const response = await request(app)
            .post('/payments/sepay/ipn')
            .set('x-secret-key', 'wrong-secret')
            .send(mockIPN);
        expect(response.status).toBe(401);
    });

    it('should mark as REVIEW if amount mismatch', async () => {
        const payment = await createPayment({ amount: 15000000 });
        const payload = { ...mockIPN, order: { order_amount: '10000000' } };

        await service.handleIpn(payload);

        const updated = await prisma.payment.findUnique({ where: { id: payment.id } });
        expect(updated.status).toBe('REVIEW');
    });

    it('should ignore duplicate IPN', async () => {
        await service.handleIpn(mockIPN);
        await service.handleIpn(mockIPN); // Lần 2

        const events = await prisma.paymentEvent.findMany({
            where: { invoiceNumber: mockIPN.order.order_invoice_number }
        });
        expect(events.length).toBe(1); // Chỉ 1 event
    });
});
```

**Why:** Tự động test các case security quan trọng

**Dev có thể bỏ qua:** Nếu không có thời gian viết tests, manual test vẫn OK

---

## 🟢 Low Priority (Nice to have cho dev)

### 7. Add Rate Limiting cho Simulate Endpoint

**Vấn đề:** `/payments/simulate-sepay` không có rate limiting - có thể spam

**Fix:**
```typescript
// src/payments/payments.controller.ts
@Public()
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 20, ttl: 60_000 } })
@Post('simulate-sepay')
simulateSePay(@Body() payload: any) {
    // ...
}
```

**Why:** Tránh spam simulate trong dev

**Không critical:** Dev endpoint, không ảnh hưởng production

---

### 8. Add Environment Variable Validation

**Vấn đề:** Không validate các biến môi trường quan trọng

**Fix:**
```typescript
// src/config/env.validation.ts
import { z } from 'zod';

const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']),
    SEPAY_ENV: z.enum(['sandbox', 'production']),
    SEPAY_MERCHANT_ID: z.string().min(1),
    SEPAY_SECRET_KEY: z.string().min(1),
    SEPAY_IPN_SECRET: z.string().min(1),
    SEPAY_SUCCESS_SECRET: z.string().min(1),
    // ... other env vars
});

export const validateEnv = () => {
    try {
        envSchema.parse(process.env);
    } catch (error) {
        console.error('Invalid environment variables:', error);
        process.exit(1);
    }
};

// main.ts
import { validateEnv } from './config/env.validation';
validateEnv();
```

**Why:** Fail fast nếu thiếu/misconfig biến môi trường

---

## 📋 Quick Checklist (Minimal)

Nếu chỉ có thời gian làm những quan trọng nhất:

- [ ] **Add rate limiting cho IPN** (5 phút)
- [ ] **Add timeout cho retrieveOrder** (10 phút)
- [ ] **Mask sensitive logs** (5 phút)
- [ ] **Enable strict mode hoặc log warning** (2 phút)

**Total: ~22 phút**

---

## 🎯 Priority Order cho Dev

1. **Rate limiting IPN** - Tránh spam (quan trọng nhất)
2. **Timeout Gateway API** - Tránh stuck job (quan trọng thứ 2)
3. **Mask logs** - Tránh leak (nhanh, dễ làm)
4. **Strict mode hoặc log warning** - Tốt cho dev (nhanh)
5. ~~HMAC signature URLs~~ - Có thể bỏ qua cho dev
6. ~~Unit tests~~ - Manual test vẫn OK cho dev
7. ~~Rate limiting simulate~~ - Dev endpoint, không critical
8. ~~Env validation~~ - Nice to have

---

## 📝 Implementation Steps

### Step 1: Rate Limiting IPN (5 phút)
```bash
# Edit file: src/payments/sepay/sepay-payments.controller.ts
# Add @Throttle decorator to ipn() method
```

### Step 2: Timeout Gateway (10 phút)
```bash
# Edit file: src/payments/sepay/sepay-gateway.service.ts
# Add AbortController timeout around retrieveOrder()
```

### Step 3: Mask Logs (5 phút)
```bash
# Edit file: src/payments/sepay/sepay-gateway.service.ts
# Mask invoiceNumber in log statements
```

### Step 4: Strict Mode (2 phút)
```bash
# Option A: Enable strict mode
# Edit .env: SEPAY_WEBHOOK_STRICT=true

# Option B: Log warning
# Edit src/payments/payments.service.ts
# Add warning log when strict=false
```

---

## ✅ Sau khi làm xong

Kiểm tra:
1. Server không bị stuck khi SePay API chậm
2. IPN không thể spam (giới hạn 100 lần/phút)
3. Logs không còn leak invoice number đầy đủ
4. Webhook có verify signature hoặc log warning

---

## Summary

**Cho dev environment, chỉ cần 4 thay đổi:**
1. Rate limiting IPN
2. Timeout Gateway API
3. Mask sensitive logs
4. Enable strict mode hoặc log warning

**Các cái khác (HMAC URLs, unit tests, CSRF, circuit breaker) có thể làm sau hoặc bỏ qua cho dev.**
