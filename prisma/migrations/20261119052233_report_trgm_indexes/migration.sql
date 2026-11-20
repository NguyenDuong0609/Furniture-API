-- CreateIndex
CREATE INDEX "OrderItem_productId_orderId_idx" ON "OrderItem"("productId", "orderId");
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "Product_sku_trgm"   ON "Product"   USING gin (sku  gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Product_name_trgm"  ON "Product"   USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Order_code_trgm"    ON "Order"     USING gin (code gin_trgm_ops);
-- Chỉ tạo nếu thật sự cần lọc theo tên lúc đặt trên bảng rất lớn (index này nặng):
-- CREATE INDEX IF NOT EXISTS "OrderItem_name_trgm" ON "OrderItem" USING gin (name gin_trgm_ops);