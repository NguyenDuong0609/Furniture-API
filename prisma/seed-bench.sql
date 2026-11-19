-- Seed 1,000,000 orders và khoảng 3,000,000 order items cho benchmark test
-- CẨN BẢO: Chỉ chạy trên TEST DATABASE hoặc REPLICA, KHÔNG chạy trên production
-- Yêu cầu: Database phải có sẵn products (chạy seed-test.ts trước)

INSERT INTO "Order" (code, "userId", status, "paymentStatus", "paymentMethod", totalAmount, shippingFee, discountAmount, shippingName, shippingPhone, shippingAddress, shippingCity, createdAt, updatedAt, paidAt)
SELECT 'BENCH' || g, NULL, 'DELIVERED', 'PAID', (ARRAY['COD', 'BANK_TRANSFER', 'SEPAY_BANK_TRANSFER'])[1 + g % 3],
500000 + (g % 50) * 100000, 30000, 0, 'Khách ' || g, '09' || lpad((g % 100000000)::text, 8, '0'),
'Địa chỉ ' || g, (ARRAY['Hà Nội', 'TP.HCM', 'Đà Nẵng', 'Cần Thơ', 'Hải Phòng'])[1 + g % 5],
t, t + interval '5 minutes', t
FROM (SELECT g, (now() AT TIME ZONE 'UTC') - (g * interval '1.05 minutes') AS t FROM generate_series(1, 1000000) AS g);

WITH p AS (SELECT array_agg(id ORDER BY id) AS ids, count(*)::int AS n FROM "Product")
INSERT INTO "OrderItem" ("orderId", "productId", quantity, price, name)
SELECT o.id, p.ids[1 + ((o.id * k) % p.n)], 1 + (o.id % 3), 250000 + k * 50000, 'Sản phẩm bench ' || p.ids[1 + ((o.id * k) % p.n)]
FROM "Order" o CROSS JOIN generate_series(1, 3) k CROSS JOIN p
WHERE o.code LIKE 'BENCH%';

ANALYZE "Order";
ANALYZE "OrderItem";
