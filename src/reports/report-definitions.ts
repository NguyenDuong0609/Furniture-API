import { Prisma } from '@prisma/client';
import type { Col, ColType, Cursor, Filters, ReportDef } from './report-types.js';
import {
  ITEM_FROM, and, catBrandConds, dc, itemConds, labelSql, likeEscape, local, orderConds, range, raw,
} from './report-sql.js';

const C = (key: string, header: string, type: ColType, extra: Partial<Col> = {}): Col => ({ key, header, type, ...extra });
const SUM = { total: 'sum' } as const;
const catBrand = (f: Filters) => catBrandConds(f).map((c) => Prisma.sql`AND ${c}`);
const withAnd = (parts: Prisma.Sql[]) => (parts.length ? Prisma.sql`AND ${and(parts)}` : Prisma.empty);

// ---- Báo cáo chi tiết: đọc theo lô đơn hàng, phân trang keyset (ngày, id) ----
const lineConds = (f: Filters) => {
  const c = orderConds(f, 'o2', false);
  if (f.status) c.push(Prisma.sql`o2.status = ${f.status}::"OrderStatus"`);
  if (f.q) {
    const k = likeEscape(f.q);
    c.push(Prisma.sql`(o2.code ILIKE ${k + '%'} OR o2."shippingPhone" = ${f.q})`);   // tiền tố/khớp đúng để dùng được index
  }
  if (f.categoryId || f.brandId) {
    c.push(Prisma.sql`EXISTS (SELECT 1 FROM "OrderItem" x JOIN "Product" p ON p.id = x."productId"
      WHERE x."orderId" = o2.id ${withAnd(catBrandConds(f))})`);
  }
  return c;
};

const orderLines: ReportDef = {
  id: 'order-lines', group: 'Chi tiết', title: 'Bảng kê chi tiết bán hàng',
  description: 'Mỗi dòng là một sản phẩm của một đơn hàng. Dùng để đối soát và phân tích sâu; xuất được hàng triệu dòng.',
  filters: ['basis', 'status', 'paymentMethod', 'city', 'categoryId', 'brandId'],
  columns: [
    C('order_code', 'Mã đơn', 'text', { width: 22 }),
    C('order_date', 'Ngày đặt', 'datetime', { width: 19 }),
    C('paid_at', 'Ngày thu tiền', 'datetime', { width: 19 }),
    C('order_status', 'Trạng thái đơn', 'text', { width: 16 }),
    C('payment_status', 'Trạng thái TT', 'text', { width: 14 }),
    C('payment_method', 'Phương thức TT', 'text', { width: 22 }),
    C('customer_name', 'Khách hàng', 'text', { width: 24, pii: true }),
    C('phone', 'Số điện thoại', 'text', { width: 15, pii: true }),
    C('city', 'Tỉnh/Thành', 'text', { width: 18 }),
    C('district', 'Quận/Huyện', 'text', { width: 18 }),
    C('sku', 'SKU', 'text', { width: 16 }),
    C('product', 'Sản phẩm', 'text', { width: 36 }),
    C('category', 'Danh mục', 'text', { width: 20 }),
    C('brand', 'Thương hiệu', 'text', { width: 18 }),
    C('quantity', 'Số lượng', 'int', SUM),
    C('unit_price', 'Đơn giá (VND)', 'money'),
    C('line_total', 'Thành tiền (VND)', 'money', SUM),
    C('order_total', 'Tổng đơn (VND)', 'money'),
  ],
  sortable: ['paid_at', 'order_date'], defaultSort: 'order_date', defaultDir: 'asc',
  notes: [
    'Mỗi dòng là một sản phẩm. "Tổng đơn" lặp lại trên mọi dòng của cùng một đơn nên KHÔNG được cộng cột này.',
    '"Thành tiền" = đơn giá tại thời điểm đặt × số lượng, trước giảm giá và phí vận chuyển cấp đơn.',
    'Thứ tự dòng: theo ngày (đặt hoặc thu tiền, tùy cơ sở ngày đã chọn), sau đó theo mã đơn nội bộ.',
  ],
  detail: {
    totalLabel: 'Số đơn hàng',
    batch: (f, cur: Cursor | null, orders) => {
      const col = f.basis === 'PAID' ? '"paidAt"' : '"createdAt"';
      const conds = lineConds(f);
      if (cur) conds.push(Prisma.sql`(${raw(`o2.${col}`)}, o2.id) > (${cur.ts}::timestamp, ${cur.id})`);
      return Prisma.sql`
        SELECT o.id AS order_id, o.code AS order_code,
               ${local('o."createdAt"')} AS order_date, ${local('o."paidAt"')} AS paid_at,
               o.status AS order_status, o."paymentStatus" AS payment_status, o."paymentMethod" AS payment_method,
               o."shippingName" AS customer_name, o."shippingPhone" AS phone,
               o."shippingCity" AS city, o."shippingDistrict" AS district,
               p.sku, oi.name AS product, c.name AS category, b.name AS brand,
               oi.quantity, oi.price AS unit_price, oi.price * oi.quantity AS line_total,
               o."totalAmount" AS order_total,
               to_char(${raw(`o.${col}`)}, 'YYYY-MM-DD"T"HH24:MI:SS.US') AS cursor_ts
        FROM (SELECT o2.* FROM "Order" o2 WHERE ${and(conds)}
              ORDER BY ${raw(`o2.${col}`)}, o2.id LIMIT ${orders}) o
        JOIN "OrderItem" oi ON oi."orderId" = o.id
        JOIN "Product" p ON p.id = oi."productId"
        LEFT JOIN "Category" c ON c.id = p."categoryId"
        LEFT JOIN "Brand" b ON b.id = p."brandId"
        WHERE TRUE ${withAnd(catBrandConds(f))}
        ORDER BY ${raw(`o.${col}`)}, o.id, oi.id`;
    },
    summary: (f) => Prisma.sql`
      SELECT COUNT(DISTINCT o2.id)::int AS total, COALESCE(SUM(oi.quantity), 0)::int AS quantity,
             COALESCE(SUM(oi.price * oi.quantity), 0) AS line_total
      FROM "Order" o2
      JOIN "OrderItem" oi ON oi."orderId" = o2.id
      JOIN "Product" p ON p.id = oi."productId"
      WHERE ${and(lineConds(f))} ${withAnd(catBrandConds(f))}`,
    countCapped: (f, cap) => Prisma.sql`
      SELECT COUNT(*)::int AS n FROM (SELECT 1 FROM "Order" o2 WHERE ${and(lineConds(f))} LIMIT ${cap + 1}) t`,
  },
};

// ---- Báo cáo tổng hợp ----
const revenueByPeriod: ReportDef = {
  id: 'revenue-by-period', group: 'Doanh thu', title: 'Doanh thu theo kỳ',
  description: 'Doanh thu thuần theo ngày, tuần, tháng, quý hoặc năm, kèm so sánh với kỳ liền trước.',
  filters: ['basis', 'groupBy', 'paymentMethod', 'city'],
  columns: [
    C('period', 'Kỳ', 'text', { width: 14 }),
    C('orders', 'Số đơn', 'int', SUM), C('units', 'Số lượng SP', 'int', SUM),
    C('gross_items', 'Tiền hàng (VND)', 'money', SUM), C('discount', 'Giảm giá (VND)', 'money', SUM),
    C('shipping', 'Phí vận chuyển (VND)', 'money', SUM), C('net_revenue', 'Doanh thu thuần (VND)', 'money', SUM),
    C('aov', 'Giá trị TB/đơn (VND)', 'money'), C('prev_revenue', 'Doanh thu kỳ trước (VND)', 'money'),
    C('growth', 'Tăng trưởng', 'percent'),
  ],
  sortable: ['bucket_start', 'period', 'orders', 'units', 'net_revenue', 'aov', 'growth'],
  defaultSort: 'bucket_start', defaultDir: 'asc',
  notes: [
    'Doanh thu thuần = tổng số tiền khách thực trả của các đơn đã thanh toán, không tính đơn hủy/hoàn.',
    'Kỳ được gom theo giờ Việt Nam (UTC+7). Tuần theo chuẩn ISO (bắt đầu thứ Hai).',
    'Tăng trưởng = (doanh thu kỳ này − kỳ trước) / kỳ trước. Kỳ đầu tiên trong khoảng chọn không có kỳ trước.',
    'Báo cáo này không lọc theo danh mục/thương hiệu vì doanh thu thuần tính theo đơn; hãy dùng báo cáo theo sản phẩm.',
  ],
  build: (f) => Prisma.sql`
    WITH fo AS (
      SELECT o.id, ${local(dc(f))} AS ts, o."totalAmount", o."discountAmount", o."shippingFee"
      FROM "Order" o WHERE ${and(orderConds(f))}
    ), it AS (
      SELECT oi."orderId", SUM(oi.quantity) AS q, SUM(oi.price * oi.quantity) AS g
      FROM "OrderItem" oi JOIN fo ON fo.id = oi."orderId" GROUP BY oi."orderId"
    ), agg AS (
      SELECT date_trunc(${raw(`'${f.groupBy}'`)}, fo.ts) AS bucket_start,
             COUNT(*)::int AS orders, COALESCE(SUM(it.q), 0)::int AS units,
             COALESCE(SUM(it.g), 0) AS gross_items, SUM(fo."discountAmount") AS discount,
             SUM(fo."shippingFee") AS shipping, SUM(fo."totalAmount") AS net_revenue
      FROM fo LEFT JOIN it ON it."orderId" = fo.id GROUP BY 1
    )
    SELECT ${labelSql(f.groupBy, 'bucket_start')} AS period, orders, units, gross_items, discount, shipping, net_revenue,
           net_revenue / NULLIF(orders, 0) AS aov,
           LAG(net_revenue) OVER (ORDER BY bucket_start) AS prev_revenue,
           (net_revenue - LAG(net_revenue) OVER (ORDER BY bucket_start))
             / NULLIF(LAG(net_revenue) OVER (ORDER BY bucket_start), 0) AS growth,
           bucket_start
    FROM agg`,
};

const topProducts: ReportDef = {
  id: 'top-products', group: 'Sản phẩm', title: 'Sản phẩm bán chạy',
  description: 'Xếp hạng sản phẩm theo số lượng hoặc doanh thu, kèm phân loại ABC (Pareto).',
  filters: ['basis', 'categoryId', 'brandId', 'paymentMethod', 'city', 'metric'],
  searchCols: ['product', 'sku', 'category', 'brand'],
  columns: [
    C('rank_no', 'Hạng', 'int', { width: 8 }), C('sku', 'SKU', 'text', { width: 16 }),
    C('product', 'Sản phẩm', 'text', { width: 38 }), C('category', 'Danh mục', 'text', { width: 20 }),
    C('brand', 'Thương hiệu', 'text', { width: 18 }), C('units', 'SL bán', 'int', SUM),
    C('orders', 'Số đơn', 'int'), C('revenue', 'Doanh thu hàng (VND)', 'money', SUM),
    C('avg_price', 'Đơn giá TB (VND)', 'money'), C('revenue_share', 'Tỷ trọng', 'percent'),
    C('cum_share', 'Tỷ trọng lũy kế', 'percent'), C('abc_class', 'Nhóm ABC', 'text', { width: 10 }),
  ],
  sortable: ['rank_no', 'sku', 'product', 'units', 'orders', 'revenue', 'avg_price', 'revenue_share'],
  defaultSort: 'rank_no', defaultDir: 'asc',
  notes: [
    'Hạng xếp theo tiêu chí đã chọn (số lượng hoặc doanh thu). Nhóm ABC luôn xếp theo doanh thu.',
    'Nhóm A: các sản phẩm tạo ra 80% doanh thu đầu tiên. Nhóm B: 15% tiếp theo. Nhóm C: 5% cuối.',
    'Doanh thu hàng là tiền hàng trước giảm giá và phí vận chuyển cấp đơn.',
  ],
  build: (f) => Prisma.sql`
    WITH g AS (
      SELECT p.id AS product_id, p.sku, p.name AS product, c.name AS category, b.name AS brand,
             SUM(oi.quantity)::int AS units, COUNT(DISTINCT o.id)::int AS orders,
             SUM(oi.price * oi.quantity) AS revenue
      ${ITEM_FROM} WHERE ${itemConds(f)}
      GROUP BY p.id, p.sku, p.name, c.name, b.name
    ), r AS (
      SELECT g.*,
             ROW_NUMBER() OVER (ORDER BY ${raw(f.metric === 'revenue' ? 'revenue' : 'units')} DESC, product_id) AS rank_no,
             SUM(revenue) OVER () AS total_revenue,
             SUM(revenue) OVER (ORDER BY revenue DESC, product_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_revenue
      FROM g
    )
    SELECT rank_no::int, sku, product, category, brand, units, orders, revenue,
           revenue / NULLIF(units, 0) AS avg_price,
           revenue / NULLIF(total_revenue, 0) AS revenue_share,
           cum_revenue / NULLIF(total_revenue, 0) AS cum_share,
           CASE WHEN (cum_revenue - revenue) / NULLIF(total_revenue, 0) < 0.80 THEN 'A'
                WHEN (cum_revenue - revenue) / NULLIF(total_revenue, 0) < 0.95 THEN 'B'
                ELSE 'C' END AS abc_class,
           product_id
    FROM r`,
};

const productsOnSale: ReportDef = {
  id: 'products-on-sale', group: 'Sản phẩm', title: 'Sản phẩm đang giảm giá',
  description: 'Các sản phẩm đang có giá sale, kèm số lượng và doanh thu bán ra trong kỳ.',
  filters: ['basis', 'categoryId', 'brandId', 'paymentMethod', 'city'],
  searchCols: ['product', 'sku', 'category', 'brand'],
  columns: [
    C('sku', 'SKU', 'text', { width: 16 }), C('product', 'Sản phẩm', 'text', { width: 38 }),
    C('category', 'Danh mục', 'text', { width: 20 }), C('brand', 'Thương hiệu', 'text', { width: 18 }),
    C('list_price', 'Giá niêm yết (VND)', 'money'), C('sale_price', 'Giá sale (VND)', 'money'),
    C('discount_rate', '% giảm', 'percent'), C('stock', 'Tồn kho', 'int', SUM),
    C('units_sold', 'SL bán trong kỳ', 'int', SUM), C('revenue', 'Doanh thu hàng (VND)', 'money', SUM),
  ],
  sortable: ['product', 'sku', 'list_price', 'sale_price', 'discount_rate', 'stock', 'units_sold', 'revenue'],
  defaultSort: 'units_sold', defaultDir: 'desc',
  notes: [
    'Chỉ gồm sản phẩm đang bán có giá sale. Giá hiển thị là giá hiện tại của sản phẩm.',
    'Đơn hàng không lưu việc có áp giá sale hay không, nên "SL bán trong kỳ" là tổng số bán của sản phẩm, không riêng phần bán theo giá sale.',
  ],
  build: (f) => Prisma.sql`
    SELECT p.id AS product_id, p.sku, p.name AS product, c.name AS category, b.name AS brand,
           p.price AS list_price, p."salePrice" AS sale_price,
           1 - p."salePrice" / NULLIF(p.price, 0) AS discount_rate, p.stock,
           COALESCE(s.units, 0)::int AS units_sold, COALESCE(s.revenue, 0) AS revenue
    FROM "Product" p
    LEFT JOIN "Category" c ON c.id = p."categoryId"
    LEFT JOIN "Brand" b ON b.id = p."brandId"
    LEFT JOIN (
      SELECT oi."productId", SUM(oi.quantity) AS units, SUM(oi.price * oi.quantity) AS revenue
      FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
      WHERE ${and(orderConds(f))} GROUP BY oi."productId"
    ) s ON s."productId" = p.id
    WHERE p."salePrice" IS NOT NULL AND p."isActive" = true ${Prisma.join(catBrand(f), ' ', ' ')}`,
};

const slowProducts: ReportDef = {
  id: 'slow-products', group: 'Sản phẩm', title: 'Hàng chậm luân chuyển',
  description: 'Sản phẩm còn tồn kho nhưng bán ít (hoặc không bán) trong kỳ, kèm giá trị tồn.',
  filters: ['basis', 'categoryId', 'brandId', 'maxUnits'],
  searchCols: ['product', 'sku', 'category', 'brand'],
  columns: [
    C('sku', 'SKU', 'text', { width: 16 }), C('product', 'Sản phẩm', 'text', { width: 38 }),
    C('category', 'Danh mục', 'text', { width: 20 }), C('brand', 'Thương hiệu', 'text', { width: 18 }),
    C('stock', 'Tồn kho', 'int', SUM), C('unit_price', 'Đơn giá (VND)', 'money'),
    C('stock_value', 'Giá trị tồn (VND)', 'money', SUM), C('units_sold', 'SL bán trong kỳ', 'int', SUM),
  ],
  sortable: ['product', 'sku', 'stock', 'stock_value', 'units_sold'],
  defaultSort: 'stock_value', defaultDir: 'desc',
  notes: [
    'Gồm sản phẩm đang bán, còn tồn kho, có số lượng bán trong kỳ không vượt ngưỡng đã chọn (mặc định 0 = không bán được).',
    'Giá trị tồn = tồn kho × giá hiện tại (giá sale nếu có, ngược lại giá niêm yết), không phải giá vốn.',
  ],
  build: (f) => Prisma.sql`
    SELECT p.id AS product_id, p.sku, p.name AS product, c.name AS category, b.name AS brand,
           p.stock, COALESCE(p."salePrice", p.price) AS unit_price,
           p.stock * COALESCE(p."salePrice", p.price) AS stock_value, COALESCE(s.units, 0)::int AS units_sold
    FROM "Product" p
    LEFT JOIN "Category" c ON c.id = p."categoryId"
    LEFT JOIN "Brand" b ON b.id = p."brandId"
    LEFT JOIN (
      SELECT oi."productId", SUM(oi.quantity) AS units
      FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
      WHERE ${and(orderConds(f))} GROUP BY oi."productId"
    ) s ON s."productId" = p.id
    WHERE p."isActive" = true AND p.stock > 0 AND COALESCE(s.units, 0) <= ${f.maxUnits}
          ${Prisma.join(catBrand(f), ' ', ' ')}`,
};

const byDimension: ReportDef = {
  id: 'revenue-by-dimension', group: 'Doanh thu', title: 'Doanh thu theo danh mục / thương hiệu',
  description: 'Cơ cấu doanh thu hàng hóa theo danh mục hoặc thương hiệu.',
  filters: ['basis', 'dimension', 'paymentMethod', 'city'], searchCols: ['name'],
  columns: [
    C('name', 'Tên', 'text', { width: 30 }), C('units', 'SL bán', 'int', SUM), C('orders', 'Số đơn', 'int'),
    C('revenue', 'Doanh thu hàng (VND)', 'money', SUM), C('revenue_share', 'Tỷ trọng', 'percent'),
  ],
  sortable: ['name', 'units', 'orders', 'revenue', 'revenue_share'], defaultSort: 'revenue', defaultDir: 'desc',
  notes: ['Doanh thu hàng là tiền hàng trước giảm giá và phí vận chuyển cấp đơn.', 'Sản phẩm chưa có danh mục/thương hiệu được gom vào "Chưa phân loại".'],
  build: (f) => Prisma.sql`
    SELECT COALESCE(${raw(f.dimension === 'brand' ? 'b.name' : 'c.name')}, 'Chưa phân loại') AS name,
           SUM(oi.quantity)::int AS units, COUNT(DISTINCT o.id)::int AS orders,
           SUM(oi.price * oi.quantity) AS revenue,
           SUM(oi.price * oi.quantity) / NULLIF(SUM(SUM(oi.price * oi.quantity)) OVER (), 0) AS revenue_share
    ${ITEM_FROM} WHERE ${itemConds(f)} GROUP BY 1`,
};

const byPayment: ReportDef = {
  id: 'revenue-by-payment-method', group: 'Doanh thu', title: 'Doanh thu theo phương thức thanh toán',
  description: 'Doanh thu thuần và số đơn theo từng phương thức thanh toán.',
  filters: ['basis', 'city'], searchCols: ['payment_method'],
  columns: [
    C('payment_method', 'Phương thức', 'text', { width: 28 }), C('orders', 'Số đơn', 'int', SUM),
    C('net_revenue', 'Doanh thu thuần (VND)', 'money', SUM), C('aov', 'Giá trị TB/đơn (VND)', 'money'),
    C('revenue_share', 'Tỷ trọng', 'percent'),
  ],
  sortable: ['payment_method', 'orders', 'net_revenue', 'aov', 'revenue_share'], defaultSort: 'net_revenue', defaultDir: 'desc',
  notes: ['Phương thức SEPAY_* là thanh toán qua cổng SePay; BANK_TRANSFER là chuyển khoản tự do; COD là thu hộ khi giao hàng.'],
  build: (f) => Prisma.sql`
    SELECT COALESCE(o."paymentMethod", 'Chưa xác định') AS payment_method, COUNT(*)::int AS orders,
           SUM(o."totalAmount") AS net_revenue, SUM(o."totalAmount") / NULLIF(COUNT(*), 0) AS aov,
           SUM(o."totalAmount") / NULLIF(SUM(SUM(o."totalAmount")) OVER (), 0) AS revenue_share
    FROM "Order" o WHERE ${and(orderConds(f))} GROUP BY 1`,
};

const byRegion: ReportDef = {
  id: 'revenue-by-region', group: 'Doanh thu', title: 'Doanh thu theo khu vực',
  description: 'Doanh thu thuần, số đơn và số khách theo tỉnh/thành giao hàng.',
  filters: ['basis', 'paymentMethod'], searchCols: ['city'],
  columns: [
    C('city', 'Tỉnh/Thành', 'text', { width: 24 }), C('orders', 'Số đơn', 'int', SUM), C('customers', 'Số khách', 'int'),
    C('net_revenue', 'Doanh thu thuần (VND)', 'money', SUM), C('aov', 'Giá trị TB/đơn (VND)', 'money'),
    C('revenue_share', 'Tỷ trọng', 'percent'),
  ],
  sortable: ['city', 'orders', 'customers', 'net_revenue', 'aov', 'revenue_share'], defaultSort: 'net_revenue', defaultDir: 'desc',
  notes: ['Số khách = số khách riêng biệt (thành viên theo tài khoản, khách vãng lai theo số điện thoại).', 'Không cộng cột "Số khách" giữa các tỉnh vì một khách có thể giao nhiều nơi.'],
  build: (f) => Prisma.sql`
    SELECT COALESCE(o."shippingCity", 'Không rõ') AS city, COUNT(*)::int AS orders,
           COUNT(DISTINCT COALESCE(o."userId"::text, o."shippingPhone"))::int AS customers,
           SUM(o."totalAmount") AS net_revenue, SUM(o."totalAmount") / NULLIF(COUNT(*), 0) AS aov,
           SUM(o."totalAmount") / NULLIF(SUM(SUM(o."totalAmount")) OVER (), 0) AS revenue_share
    FROM "Order" o WHERE ${and(orderConds(f))} GROUP BY 1`,
};

const topCustomers: ReportDef = {
  id: 'top-customers', group: 'Khách hàng', title: 'Khách hàng giá trị cao',
  description: 'Xếp hạng khách hàng theo doanh thu thuần trong kỳ.',
  filters: ['basis', 'paymentMethod', 'city'], searchCols: ['customer_name', 'phone', 'email'],
  columns: [
    C('rank_no', 'Hạng', 'int', { width: 8 }), C('customer_type', 'Loại khách', 'text', { width: 16 }),
    C('customer_name', 'Khách hàng', 'text', { width: 26, pii: true }), C('phone', 'Số điện thoại', 'text', { width: 15, pii: true }),
    C('email', 'Email', 'text', { width: 28, pii: true }), C('orders', 'Số đơn', 'int', SUM),
    C('net_revenue', 'Doanh thu thuần (VND)', 'money', SUM), C('aov', 'Giá trị TB/đơn (VND)', 'money'),
    C('first_order', 'Đơn đầu tiên', 'text', { width: 14 }), C('last_order', 'Đơn gần nhất', 'text', { width: 14 }),
  ],
  sortable: ['rank_no', 'orders', 'net_revenue', 'aov', 'first_order', 'last_order'], defaultSort: 'rank_no', defaultDir: 'asc',
  notes: ['Khách thành viên được gom theo tài khoản; khách vãng lai gom theo số điện thoại giao hàng.', 'Báo cáo chứa dữ liệu cá nhân: chỉ người có quyền report:pii mới thấy các cột tên, SĐT, email.'],
  build: (f) => Prisma.sql`
    SELECT ROW_NUMBER() OVER (ORDER BY SUM(o."totalAmount") DESC, MIN(o.id))::int AS rank_no,
           CASE WHEN MIN(o."userId") IS NULL THEN 'Khách vãng lai' ELSE 'Thành viên' END AS customer_type,
           MAX(o."shippingName") AS customer_name, MAX(o."shippingPhone") AS phone, MAX(u.email) AS email,
           COUNT(*)::int AS orders, SUM(o."totalAmount") AS net_revenue,
           SUM(o."totalAmount") / NULLIF(COUNT(*), 0) AS aov,
           to_char(${local('MIN(o."createdAt")')}, 'YYYY-MM-DD') AS first_order,
           to_char(${local('MAX(o."createdAt")')}, 'YYYY-MM-DD') AS last_order
    FROM "Order" o LEFT JOIN "User" u ON u.id = o."userId"
    WHERE ${and(orderConds(f))}
    GROUP BY COALESCE(o."userId"::text, 'P' || o."shippingPhone")`,
};

const cancellations: ReportDef = {
  id: 'cancellations-refunds', group: 'Vận hành', title: 'Đơn hủy và hoàn tiền',
  description: 'Số đơn, tỷ lệ hủy và hoàn theo kỳ (tính theo ngày đặt hàng).',
  filters: ['groupBy', 'paymentMethod', 'city'],
  columns: [
    C('period', 'Kỳ', 'text', { width: 14 }), C('orders', 'Tổng đơn', 'int', SUM), C('cancelled', 'Đơn hủy', 'int', SUM),
    C('cancel_rate', 'Tỷ lệ hủy', 'percent'), C('cancelled_amount', 'Giá trị hủy (VND)', 'money', SUM),
    C('refunded', 'Đơn hoàn', 'int', SUM), C('refund_rate', 'Tỷ lệ hoàn', 'percent'),
    C('refunded_amount', 'Giá trị hoàn (VND)', 'money', SUM),
  ],
  sortable: ['bucket_start', 'period', 'orders', 'cancelled', 'cancel_rate', 'refunded', 'refund_rate'],
  defaultSort: 'bucket_start', defaultDir: 'asc',
  notes: ['Luôn tính theo ngày đặt hàng và gồm mọi đơn (kể cả đơn chưa thanh toán).', 'Đơn hoàn: trạng thái đơn hoặc trạng thái thanh toán là REFUNDED.'],
  build: (f) => Prisma.sql`
    WITH x AS (
      SELECT date_trunc(${raw(`'${f.groupBy}'`)}, ${local('o."createdAt"')}) AS bucket_start,
             o.status, o."paymentStatus", o."totalAmount"
      FROM "Order" o
      WHERE ${and([range('o."createdAt"', f), ...(f.paymentMethod ? [Prisma.sql`o."paymentMethod" = ${f.paymentMethod}`] : []),
  ...(f.city ? [Prisma.sql`o."shippingCity" = ${f.city}`] : [])])}
    )
    SELECT ${labelSql(f.groupBy, 'bucket_start')} AS period, COUNT(*)::int AS orders,
           (COUNT(*) FILTER (WHERE status = 'CANCELLED'))::int AS cancelled,
           COALESCE(SUM("totalAmount") FILTER (WHERE status = 'CANCELLED'), 0) AS cancelled_amount,
           (COUNT(*) FILTER (WHERE status = 'REFUNDED' OR "paymentStatus" = 'REFUNDED'))::int AS refunded,
           COALESCE(SUM("totalAmount") FILTER (WHERE status = 'REFUNDED' OR "paymentStatus" = 'REFUNDED'), 0) AS refunded_amount,
           (COUNT(*) FILTER (WHERE status = 'CANCELLED'))::numeric / NULLIF(COUNT(*), 0) AS cancel_rate,
           (COUNT(*) FILTER (WHERE status = 'REFUNDED' OR "paymentStatus" = 'REFUNDED'))::numeric / NULLIF(COUNT(*), 0) AS refund_rate,
           bucket_start
    FROM x GROUP BY bucket_start`,
};

export const REPORTS: ReportDef[] = [
  revenueByPeriod, topProducts, productsOnSale, slowProducts, byDimension,
  byPayment, byRegion, topCustomers, cancellations, orderLines,
];