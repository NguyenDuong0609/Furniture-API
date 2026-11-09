-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "paymentRawData" JSONB,
ADD COLUMN     "paymentTransactionId" TEXT;
