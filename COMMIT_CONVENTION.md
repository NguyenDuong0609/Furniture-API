# Git Commit Convention cho NestJS Ecommerce Project

## Format tiêu chuẩn
```
<type>(<scope>): <subject>

<body>

<footer>
```

## Types
- **feat**: Thêm tính năng mới
- **fix**: Sửa lỗi
- **docs**: Thay đổi tài liệu
- **style**: Thay đổi format code (không ảnh hưởng logic)
- **refactor**: Refactor code
- **perf**: Cải thiện hiệu suất
- **test**: Thêm/sửa test
- **chore**: Thay đổi build process, config, dependencies
- **ci**: Thay đổi CI/CD
- **build**: Thay đổi build system

## Scopes
- **auth**: Authentication & Authorization module
- **users**: Users module
- **products**: Products module
- **categories**: Categories module
- **carts**: Carts module
- **orders**: Orders module
- **payments**: Payments module
- **media**: Media upload module
- **shared**: Shared utilities, decorators, guards
- **prisma**: Database schema & migrations
- **config**: Configuration
- **i18n**: Internationalization
- **events**: WebSockets/Events
- **app**: Application setup

## Ví dụ commit messages cho project này

### Commit 1: Khởi tạo project
```
chore: initialize NestJS ecommerce project

- Setup NestJS framework with TypeScript
- Configure ESLint, Prettier, Vitest
- Setup Prisma ORM with SQLite
- Configure environment validation
- Setup i18n for multi-language support (EN/VI)
```

### Commit 2: Database schema
```
chore(prisma): define complete database schema

- Define User, Role, Permission models with RBAC
- Define Category, Brand, Product models with variants
- Define Cart, Order, Payment models
- Define Review, Wishlist, Address models
- Add refresh token support
- Add 2FA support for users
```

### Commit 3: Authentication module
```
feat(auth): implement authentication system

- Add user registration with validation
- Add JWT-based login with refresh tokens
- Add password hashing with bcrypt
- Add 2FA (Two-Factor Authentication) support
- Add JWT auth guard and strategy
- Add permission guard for RBAC
- Add API key guard
- Add logout and logout-all endpoints
- Add change password endpoint
- Add profile management endpoints
```

### Commit 4: Shared module
```
feat(shared): create shared utilities and decorators

- Add ActiveUser decorator for current user
- Add Public decorator for public routes
- Add Permissions decorator for RBAC
- Add Match decorator for field validation
- Add Zod validation pipe
- Add logging interceptor
- Add transform interceptor
- Add hashing service
- Add type guard utilities
```

### Commit 5: Products module
```
feat(products): implement products CRUD operations

- Add product creation with images and variants
- Add product listing with filters (search, category, brand, price)
- Add product detail by ID and slug
- Add product update and delete
- Add product image management
- Add product variant support with attributes
- Integrate cache-manager for product queries
- Add category and brand associations
```

### Commit 6: Categories module
```
feat(categories): implement categories management

- Add category CRUD operations
- Add hierarchical category support (parent/children)
- Add category slug uniqueness
- Add category listing with pagination
```

### Commit 7: Carts module
```
feat(carts): implement shopping cart system

- Add guest cart with session ID
- Add user cart with authentication
- Add item to cart with quantity
- Update cart item quantity
- Remove item from cart
- Clear cart functionality
- Support product variants in cart
```

### Commit 8: Orders module
```
feat(orders): implement order management

- Add order creation from cart
- Add order status tracking (PENDING -> DELIVERED)
- Add order listing with filters
- Add order detail view
- Add order cancellation
- Calculate total amount with shipping fee
- Support multiple payment methods
```

### Commit 9: Payments module
```
feat(payments): implement payment processing

- Add payment creation endpoint
- Add COD payment confirmation
- Add payment status tracking
- Add payment callback handling
- Add payment status check endpoint
- Integrate with BullMQ for async processing
```

### Commit 10: Media module
```
feat(media): implement file upload functionality

- Add image upload endpoint with multer
- Configure file size and type validation
- Add media service for file management
```

### Commit 11: Users module
```
feat(users): implement user management

- Add user listing with pagination
- Add user detail by ID
- Add user profile update
- Add user deletion
- Add role assignment support
```

### Commit 12: Events module
```
feat(events): implement WebSocket gateway

- Add EventsGateway for real-time updates
- Add join room functionality
- Integrate with Socket.IO
```

### Commit 13: Configuration & Optimization
```
chore(config): configure caching and queuing

- Setup cache-manager with Redis support
- Configure BullMQ for job queue
- Add rate limiting with @nestjs/throttler
- Configure CORS and global pipes
- Setup Observe for application monitoring
```

### Commit 14: Bug fixes
```
fix(products): fix Cache type import error

- Change Cache import to type-only import
- Fix TypeScript error with isolatedModules and emitDecoratorMetadata
```

## Quy tắc commit
1. Subject line không vượt quá 72 ký tự
2. Subject line phải viết tiếng Anh, dùng imperative mood
3. Body có thể viết tiếng Việt để dễ hiểu
4. Reference issue nếu có: `Closes #123`
5. Breaking changes phải được khai báo ở footer: `BREAKING CHANGE: ...`
