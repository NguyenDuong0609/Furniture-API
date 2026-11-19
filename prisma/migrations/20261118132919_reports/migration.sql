-- CreateEnum
CREATE TYPE "ReportExportStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'EXPIRED');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "paidAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ReportExport" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "reportId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "options" JSONB,
    "includePii" BOOLEAN NOT NULL DEFAULT false,
    "status" "ReportExportStatus" NOT NULL DEFAULT 'QUEUED',
    "rowCount" INTEGER,
    "fileSize" INTEGER,
    "filePath" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "ReportExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportExport_status_createdAt_idx" ON "ReportExport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ReportExport_userId_createdAt_idx" ON "ReportExport"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_paidAt_id_idx" ON "Order"("paidAt", "id");

-- CreateIndex
CREATE INDEX "Order_createdAt_id_idx" ON "Order"("createdAt", "id");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");

-- 1) Backfill ngày thu tiền cho đơn đã thanh toán (ước lượng bằng updatedAt nếu không có Payment)
UPDATE "Order" o
SET "paidAt" = COALESCE(
  (SELECT MAX(p."paidAt") FROM "Payment" p WHERE p."orderId" = o.id AND p.status = 'PAID'),
  o."updatedAt")
WHERE o."paymentStatus" = 'PAID' AND o."paidAt" IS NULL;

-- 2) Trigger: bất kỳ chỗ nào trong code đặt paymentStatus = PAID (SePay, webhook cũ, COD...) đều tự có paidAt
CREATE OR REPLACE FUNCTION set_order_paid_at() RETURNS trigger AS $$
BEGIN
  IF NEW."paymentStatus" = 'PAID' AND NEW."paidAt" IS NULL THEN
    NEW."paidAt" := now() AT TIME ZONE 'UTC';      -- Prisma lưu DateTime là UTC, không kèm múi giờ
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER order_paid_at
BEFORE INSERT OR UPDATE OF "paymentStatus" ON "Order"
FOR EACH ROW EXECUTE FUNCTION set_order_paid_at();

INSERT INTO "Permission" (name, description, "createdAt", "updatedAt") VALUES
  ('report:read',   'Xem báo cáo', now(), now()),
  ('report:export', 'Xuất báo cáo ra Excel/CSV', now(), now()),
  ('report:pii',    'Xem và xuất cột thông tin cá nhân khách hàng', now(), now())
ON CONFLICT (name) DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r.id, p.id FROM "Role" r, "Permission" p
WHERE r.name = 'ADMIN' AND p.name IN ('report:read', 'report:export', 'report:pii')
ON CONFLICT DO NOTHING;