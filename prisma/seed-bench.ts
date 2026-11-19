import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not set in .env.test');
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🚀 Seeding benchmark data (1 triệu orders)...');

  // Kiểm tra xem đã có products chưa
  const productCount = await prisma.product.count();
  if (productCount === 0) {
    console.error('❌ Error: Không có products trong database. Chạy npm run prisma:seed:test trước!');
    process.exit(1);
  }

  console.log(`✅ Found ${productCount} products`);

  // Lấy tất cả product IDs
  const products = await prisma.product.findMany({ select: { id: true } });
  const productIds = products.map((p) => p.id);

  // Seed 1,000,000 orders
  const BATCH_SIZE = 10000;
  const TOTAL_ORDERS = 1000000;
  const PAYMENT_METHODS = ['COD', 'BANK_TRANSFER', 'SEPAY_BANK_TRANSFER'];
  const CITIES = ['Hà Nội', 'TP.HCM', 'Đà Nẵng', 'Cần Thơ', 'Hải Phòng'];

  let ordersCreated = 0;
  const startTime = Date.now();

  for (let batch = 0; batch < TOTAL_ORDERS / BATCH_SIZE; batch++) {
    const startIdx = batch * BATCH_SIZE;
    const orderData = [];

    for (let i = 0; i < BATCH_SIZE; i++) {
      const g = startIdx + i + 1;
      const baseTime = new Date(Date.now() - g * 63000); // ~1.05 minutes ago

      orderData.push({
        code: `BENCH${g}`,
        userId: null,
        status: 'DELIVERED',
        paymentStatus: 'PAID',
        paymentMethod: PAYMENT_METHODS[g % 3],
        totalAmount: 500000 + (g % 50) * 100000,
        shippingFee: 30000,
        discountAmount: 0,
        shippingName: `Khách ${g}`,
        shippingPhone: `09${String(g % 100000000).padStart(8, '0')}`,
        shippingAddress: `Địa chỉ ${g}`,
        shippingCity: CITIES[g % 5],
        createdAt: baseTime,
        updatedAt: new Date(baseTime.getTime() + 5 * 60 * 1000),
      });
    }

    await prisma.order.createMany({ data: orderData, skipDuplicates: true });
    ordersCreated += BATCH_SIZE;

    const elapsed = (Date.now() - startTime) / 1000;
    const progress = ((ordersCreated / TOTAL_ORDERS) * 100).toFixed(1);
    const rate = (ordersCreated / elapsed).toFixed(0);
    console.log(`✅ Progress: ${progress}% (${ordersCreated.toLocaleString()} orders) - ${rate} orders/s`);
  }

  console.log('✅ Orders created successfully!');

  // Update paidAt for all BENCH orders (trigger tự động khi paymentStatus = PAID)
  console.log('🔄 Updating paidAt timestamps...');
  await prisma.$executeRaw`
    UPDATE "Order"
    SET "paidAt" = "createdAt"
    WHERE code LIKE 'BENCH%'
  `;
  console.log('✅ paidAt updated successfully!');

  // Seed order items (3 items per order)
  console.log('🚀 Seeding order items (~3 triệu)...');

  const orders = await prisma.order.findMany({
    where: { code: { startsWith: 'BENCH' } },
    select: { id: true },
    orderBy: { id: 'asc' },
  });

  const ITEM_BATCH_SIZE = 5000;
  let itemsCreated = 0;

  for (let batch = 0; batch < orders.length / ITEM_BATCH_SIZE; batch++) {
    const startIdx = batch * ITEM_BATCH_SIZE;
    const orderBatch = orders.slice(startIdx, startIdx + ITEM_BATCH_SIZE);
    const itemData = [];

    for (const order of orderBatch) {
      for (let k = 1; k <= 3; k++) {
        const productIdx = (order.id * k) % productIds.length;
        itemData.push({
          orderId: order.id,
          productId: productIds[productIdx],
          quantity: 1 + (order.id % 3),
          price: 250000 + k * 50000,
          name: `Sản phẩm bench ${productIds[productIdx]}`,
        });
      }
    }

    await prisma.orderItem.createMany({ data: itemData, skipDuplicates: true });
    itemsCreated += itemData.length;

    const elapsed = (Date.now() - startTime) / 1000;
    const progress = ((itemsCreated / (TOTAL_ORDERS * 3)) * 100).toFixed(1);
    const rate = (itemsCreated / elapsed).toFixed(0);
    console.log(`✅ Progress: ${progress}% (${itemsCreated.toLocaleString()} items) - ${rate} items/s`);
  }

  const totalTime = (Date.now() - startTime) / 1000;
  console.log('================================');
  console.log('✅ Benchmark seeding completed!');
  console.log(`📊 Total orders: ${ordersCreated.toLocaleString()}`);
  console.log(`📊 Total items: ${itemsCreated.toLocaleString()}`);
  console.log(`⏱️  Total time: ${totalTime.toFixed(0)}s`);
  console.log('================================');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
