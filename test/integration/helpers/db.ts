import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set in .env.test');
}

// Pool dùng chung cho toàn bộ test suite để tránh "too many clients".
// fileParallelism: false trong vitest.config.integration.ts đảm bảo chỉ 1 file chạy 1 lúc.
const sharedPool = new Pool({ connectionString, max: 5 });

export function createPrisma() {
  const adapter = new PrismaPg(sharedPool);
  return new PrismaClient({ adapter });
}

export async function closePool() {
  await sharedPool.end();
}

export async function resetDb(prisma: PrismaClient) {
  // TRUNCATE CASCADE một lần nhanh hơn nhiều so với 27 DELETE tuần tự
  await prisma.$executeRaw`
    TRUNCATE TABLE
      "EmailOutbox", "ReportExport", "Message", "Conversation",
      "Notification", "PaymentEvent", "Payment", "OrderStatusHistory",
      "OrderItem", "Order", "CartItem", "Cart", "Wishlist", "Review",
      "ProductVariant", "ProductImage", "Product", "Category", "Brand",
      "Address", "RefreshToken", "UserRole", "RolePermission", "Permission",
      "Role", "User", "Coupon", "ShippingRule"
    RESTART IDENTITY CASCADE
  `;
}
