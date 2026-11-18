-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_orderId_fkey";

-- CreateIndex
CREATE INDEX "Order_status_paymentStatus_createdAt_idx" ON "Order"("status", "paymentStatus", "createdAt");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- mỗi đơn chỉ có tối đa một Payment đã PAID
CREATE UNIQUE INDEX "Payment_one_paid_per_order" ON "Payment"("orderId") WHERE "status" = 'PAID';
-- một mã giao dịch SePay chỉ thuộc về một Payment
CREATE UNIQUE INDEX "Payment_sepayTransactionId_uniq" ON "Payment"("sepayTransactionId") WHERE "sepayTransactionId" IS NOT NULL;
-- số tiền phải dương; Payment đã PAID bắt buộc có paidAt
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_paid_has_paidAt" CHECK ("status" <> 'PAID' OR "paidAt" IS NOT NULL);