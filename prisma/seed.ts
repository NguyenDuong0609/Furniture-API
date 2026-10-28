import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import * as bcrypt from 'bcrypt';

const connectionString = process.env.DATABASE_URL || 'file:./prisma/dev.db';
const adapter = new PrismaBetterSqlite3({
  url: connectionString.replace(/^file:/, ''),
});
const prisma = new PrismaClient({ adapter });

async function main() {
  // 1. Tạo Permissions
  const permissions = [
    // Product
    { name: 'product:create', description: 'Tạo sản phẩm' },
    { name: 'product:read', description: 'Xem sản phẩm' },
    { name: 'product:update', description: 'Sửa sản phẩm' },
    { name: 'product:delete', description: 'Xóa sản phẩm' },

    // Category
    { name: 'category:create', description: 'Tạo danh mục' },
    { name: 'category:update', description: 'Sửa danh mục' },
    { name: 'category:delete', description: 'Xóa danh mục' },

    // Order
    { name: 'order:read', description: 'Xem đơn hàng' },
    { name: 'order:update', description: 'Cập nhật đơn hàng' },
    { name: 'order:cancel', description: 'Hủy đơn hàng' },

    // User
    { name: 'user:read', description: 'Xem danh sách user' },
    { name: 'user:update', description: 'Sửa user' },
    { name: 'user:delete', description: 'Xóa user' },
  ];

  for (const p of permissions) {
    await prisma.permission.upsert({
      where: { name: p.name },
      update: {},
      create: p,
    });
  }

  // 2. Tạo Roles
  const adminRole = await prisma.role.upsert({
    where: { name: 'ADMIN' },
    update: {},
    create: {
      name: 'ADMIN',
      description: 'Quản trị viên toàn quyền',
    },
  });

  const userRole = await prisma.role.upsert({
    where: { name: 'USER' },
    update: {},
    create: {
      name: 'USER',
      description: 'Người dùng thông thường',
    },
  });

  // 3. Gán toàn bộ permission cho ADMIN
  const allPermissions = await prisma.permission.findMany();
  for (const perm of allPermissions) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: adminRole.id,
          permissionId: perm.id,
        },
      },
      update: {},
      create: {
        roleId: adminRole.id,
        permissionId: perm.id,
      },
    });
  }

  // 4. Tạo admin mặc định
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
    where: {
      userId_roleId: {
        userId: admin.id,
        roleId: adminRole.id,
      },
    },
    update: {},
    create: {
      userId: admin.id,
      roleId: adminRole.id,
    },
  });

  console.log('Seed thành công!');
  console.log('Admin: admin@furniture.com / Admin@123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
