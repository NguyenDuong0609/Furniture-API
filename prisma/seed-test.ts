import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';

// Load .env.test
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not set in .env.test');
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 Seeding test database...');

  // ==================== 1. PERMISSIONS & ROLES ====================
  const permissions = [
    { name: 'product:create', description: 'Tạo sản phẩm' },
    { name: 'product:read', description: 'Xem sản phẩm' },
    { name: 'product:update', description: 'Sửa sản phẩm' },
    { name: 'product:delete', description: 'Xóa sản phẩm' },
    { name: 'category:create', description: 'Tạo danh mục' },
    { name: 'category:update', description: 'Sửa danh mục' },
    { name: 'category:delete', description: 'Xóa danh mục' },
    { name: 'order:read', description: 'Xem đơn hàng' },
    { name: 'order:update', description: 'Cập nhật đơn hàng' },
    { name: 'order:cancel', description: 'Hủy đơn hàng' },
    { name: 'user:read', description: 'Xem danh sách user' },
    { name: 'user:update', description: 'Sửa user' },
    { name: 'user:delete', description: 'Xóa user' },
    { name: 'payment:read', description: 'Xem giao dịch thanh toán' },
    { name: 'payment:resolve', description: 'Xử lý giao dịch cần kiểm tra' },
  ];

  for (const p of permissions) {
    await prisma.permission.upsert({
      where: { name: p.name },
      update: {},
      create: p,
    });
  }

  const adminRole = await prisma.role.upsert({
    where: { name: 'ADMIN' },
    update: {},
    create: { name: 'ADMIN', description: 'Quản trị viên toàn quyền' },
  });

  const userRole = await prisma.role.upsert({
    where: { name: 'USER' },
    update: {},
    create: { name: 'USER', description: 'Người dùng thông thường' },
  });

  const allPermissions = await prisma.permission.findMany();
  for (const perm of allPermissions) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId: adminRole.id, permissionId: perm.id },
      },
      update: {},
      create: { roleId: adminRole.id, permissionId: perm.id },
    });
  }

  // ==================== 2. USERS ====================
  const hashedPassword = await bcrypt.hash('Admin@123', 10);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@furniture.com' },
    update: {},
    create: {
      email: 'admin@furniture.com',
      name: 'Super Admin',
      password: hashedPassword,
    },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: adminRole.id } },
    update: {},
    create: { userId: admin.id, roleId: adminRole.id },
  });

  const customerPassword = await bcrypt.hash('123456', 10);
  const customer = await prisma.user.upsert({
    where: { email: 'customer@example.com' },
    update: {},
    create: {
      email: 'customer@example.com',
      name: 'Nguyễn Văn A',
      password: customerPassword,
      phone: '0901234567',
    },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: customer.id, roleId: userRole.id } },
    update: {},
    create: { userId: customer.id, roleId: userRole.id },
  });

  // ==================== 3. CATEGORIES ====================
  const sofa = await prisma.category.upsert({
    where: { slug: 'sofa' },
    update: {},
    create: {
      name: 'Sofa',
      slug: 'sofa',
      description: 'Các loại ghế sofa cao cấp, hiện đại',
    },
  });

  const banAn = await prisma.category.upsert({
    where: { slug: 'ban-an' },
    update: {},
    create: {
      name: 'Bàn ăn',
      slug: 'ban-an',
      description: 'Bàn ăn gỗ tự nhiên, bàn ăn thông minh',
    },
  });

  const giuong = await prisma.category.upsert({
    where: { slug: 'giuong-ngu' },
    update: {},
    create: {
      name: 'Giường ngủ',
      slug: 'giuong-ngu',
      description: 'Giường ngủ hiện đại, giường gỗ sồi',
    },
  });

  const tu = await prisma.category.upsert({
    where: { slug: 'tu-ke' },
    update: {},
    create: {
      name: 'Tủ & Kệ',
      slug: 'tu-ke',
      description: 'Tủ quần áo, kệ trang trí, tủ giày',
    },
  });

  // ==================== 4. BRANDS ====================
  const moho = await prisma.brand.upsert({
    where: { slug: 'moho' },
    update: {},
    create: { name: 'MOHO', slug: 'moho' },
  });

  const house = await prisma.brand.upsert({
    where: { slug: 'the-house' },
    update: {},
    create: { name: 'The House', slug: 'the-house' },
  });

  // ==================== 5. PRODUCTS ====================
  // Xóa sản phẩm cũ nếu cần
  await prisma.cartItem.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.productVariant.deleteMany();
  await prisma.productImage.deleteMany();
  await prisma.review.deleteMany();
  await prisma.product.deleteMany();

  const product1 = await prisma.product.upsert({
    where: { slug: 'sofa-goc-hien-dai-xam' },
    update: {},
    create: {
      name: 'Sofa góc hiện đại màu xám',
      slug: 'sofa-goc-hien-dai-xam',
      description:
        'Sofa góc cao cấp bọc vải nỉ mềm mại, khung gỗ sồi chắc chắn, thiết kế hiện đại phù hợp phòng khách rộng.',
      price: 18900000,
      salePrice: 15900000,
      stock: 12,
      isActive: true,
      isFeatured: true,
      categoryId: sofa.id,
      brandId: moho.id,
      images: {
        create: [
          {
            url: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
            isMain: true,
            sortOrder: 0,
          },
        ],
      },
      variants: {
        create: [
          {
            name: 'Xám đậm - Size L',
            sku: 'SOFA-GRAY-L',
            price: 15900000,
            stock: 7,
            attributes: { color: 'Xám đậm', size: 'L', material: 'Vải nỉ' },
          },
          {
            name: 'Xám nhạt - Size M',
            sku: 'SOFA-GRAY-M',
            price: 14500000,
            stock: 5,
            attributes: { color: 'Xám nhạt', size: 'M', material: 'Vải nỉ' },
          },
        ],
      },
    },
  });

  const product2 = await prisma.product.upsert({
    where: { slug: 'ban-an-go-soi-6-ghe' },
    update: {},
    create: {
      name: 'Bàn ăn gỗ sồi 6 ghế',
      slug: 'ban-an-go-soi-6-ghe',
      description: 'Bàn ăn gỗ sồi tự nhiên 100%, kèm 6 ghế bọc da êm ái.',
      price: 12500000,
      salePrice: 10900000,
      stock: 8,
      isActive: true,
      isFeatured: true,
      categoryId: banAn.id,
      brandId: house.id,
      images: {
        create: [
          {
            url: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
            isMain: true,
            sortOrder: 0,
          },
        ],
      },
      variants: {
        create: [
          {
            name: 'Màu gỗ tự nhiên',
            sku: 'BAN-SOI-6',
            stock: 8,
            attributes: { color: 'Gỗ tự nhiên', seats: '6' },
          },
        ],
      },
    },
  });

  const product3 = await prisma.product.upsert({
    where: { slug: 'giuong-ngu-go-soi-1m6' },
    update: {},
    create: {
      name: 'Giường ngủ gỗ sồi 1m6',
      slug: 'giuong-ngu-go-soi-1m6',
      description: 'Giường ngủ gỗ sồi tự nhiên, đầu giường bọc nệm êm ái.',
      price: 9800000,
      salePrice: 8500000,
      stock: 15,
      isActive: true,
      isFeatured: false,
      categoryId: giuong.id,
      brandId: moho.id,
      images: {
        create: [
          {
            url: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
            isMain: true,
            sortOrder: 0,
          },
        ],
      },
    },
  });

  console.log('✅ Seed test database thành công!');
  console.log('--------------------------------');
  console.log('Admin     : admin@furniture.com / Admin@123');
  console.log('Customer  : customer@example.com / 123456');
  console.log('--------------------------------');
  console.log(`Đã tạo: ${await prisma.category.count()} danh mục`);
  console.log(`Đã tạo: ${await prisma.product.count()} sản phẩm`);
  console.log(`Đã tạo: ${await prisma.brand.count()} thương hiệu`);
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
