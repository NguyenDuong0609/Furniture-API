import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL || 'postgresql://furniture:furniture123@localhost:5433/furniture_db',
  },
});
// export default defineConfig({
//   schema: 'prisma/schema.prisma',
//   datasource: {
//     url: 'file:./prisma/dev.db', // Sử dụng đường dẫn tương đối chuẩn cho SQLite
//   },
// });
