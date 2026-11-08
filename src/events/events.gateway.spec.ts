import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { vi } from 'vitest';
import { EventsGateway } from './events.gateway.js';
import { PrismaService } from '../prisma/prisma.service.js';

// ============================================================
// TASK 1 — Kiểm tra bug condition
// Mục tiêu: Chứng minh rằng EventsGateway KHÔNG thể khởi tạo
// nếu JwtModule chưa được import vào EventsModule.
// Test này DỰ KIẾN PASS (verify bug bằng cách kiểm tra
// việc throw exception khi thiếu JwtModule).
// ============================================================

describe('EventsGateway — Bug Condition (Task 1)', () => {
  it('NẾU JwtModule KHÔNG được import vào module THÌ DI container phải throw UnknownDependenciesException khi compile', async () => {
    // Tạo module KHÔNG có JwtModule — đây là trạng thái lỗi hiện tại
    await expect(
      Test.createTestingModule({
        providers: [
          EventsGateway,
          // Chỉ cung cấp PrismaService (mock), KHÔNG có JwtService
          {
            provide: PrismaService,
            useValue: { userRole: { findMany: vi.fn() } },
          },
          // JwtService bị bỏ qua có chủ ý để tái hiện bug
        ],
      }).compile(),
    ).rejects.toThrow(
      // NestJS ném UnknownDependenciesException khi không resolve được JwtService
      /Nest can't resolve dependencies of the EventsGateway/,
    );
  });
});

// ============================================================
// TASK 2 — Kiểm tra preservation (hành vi runtime không đổi)
// Mục tiêu: Xác nhận rằng logic gateway hoạt động đúng khi
// dependencies được cung cấp đầy đủ qua mock.
// ============================================================

describe('EventsGateway — Preservation Tests (Task 2)', () => {
  let gateway: EventsGateway;
  let jwtService: JwtService;

  const mockPrisma = {
    userRole: { findMany: vi.fn() },
  };

  const mockJwt = {
    verifyAsync: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsGateway,
        { provide: JwtService, useValue: mockJwt },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    gateway = module.get(EventsGateway);
    jwtService = module.get(JwtService);

    // Giả lập server Socket.IO
    (gateway as any).server = {
      to: vi.fn().mockReturnValue({ emit: vi.fn() }),
      emit: vi.fn(),
    };
  });

  it('gateway phải được định nghĩa khi đủ dependencies', () => {
    expect(gateway).toBeDefined();
  });

  // ---- handleConnection: token hợp lệ ----
  it('handleConnection với token hợp lệ phải gán userId, role và join đúng room (USER)', async () => {
    const userId = 42;
    mockJwt.verifyAsync.mockResolvedValueOnce({ sub: userId });
    mockPrisma.userRole.findMany.mockResolvedValueOnce([
      { role: { name: 'USER' } },
    ]);

    const mockJoin = vi.fn();
    const client: any = {
      id: 'socket-1',
      handshake: { auth: { token: 'valid.jwt.token' }, headers: {} },
      join: mockJoin,
      disconnect: vi.fn(),
    };

    await gateway.handleConnection(client);

    expect(client.userId).toBe(userId);
    expect(client.role).toBe('USER');
    expect(mockJoin).toHaveBeenCalledWith(`user_${userId}`);
    // Không join phòng admins khi là USER
    expect(mockJoin).not.toHaveBeenCalledWith('admins');
  });

  it('handleConnection với token hợp lệ phải join phòng admins khi role là ADMIN', async () => {
    const userId = 1;
    mockJwt.verifyAsync.mockResolvedValueOnce({ sub: userId });
    mockPrisma.userRole.findMany.mockResolvedValueOnce([
      { role: { name: 'ADMIN' } },
    ]);

    const mockJoin = vi.fn();
    const client: any = {
      id: 'socket-admin',
      handshake: { auth: { token: 'admin.jwt.token' }, headers: {} },
      join: mockJoin,
      disconnect: vi.fn(),
    };

    await gateway.handleConnection(client);

    expect(client.role).toBe('ADMIN');
    expect(mockJoin).toHaveBeenCalledWith(`user_${userId}`);
    expect(mockJoin).toHaveBeenCalledWith('admins');
  });

  // ---- handleConnection: token không hợp lệ ----
  it('handleConnection với token không hợp lệ phải gọi disconnect()', async () => {
    mockJwt.verifyAsync.mockRejectedValueOnce(new Error('invalid token'));

    const client: any = {
      id: 'socket-bad',
      handshake: { auth: { token: 'bad.token' }, headers: {} },
      join: vi.fn(),
      disconnect: vi.fn(),
    };

    await gateway.handleConnection(client);

    expect(client.disconnect).toHaveBeenCalled();
  });

  it('handleConnection không có token phải gọi disconnect()', async () => {
    const client: any = {
      id: 'socket-notoken',
      handshake: { auth: {}, headers: {} },
      join: vi.fn(),
      disconnect: vi.fn(),
    };

    await gateway.handleConnection(client);

    expect(client.disconnect).toHaveBeenCalled();
  });

  // ---- handleDisconnect: dọn dẹp userSockets ----
  it('handleDisconnect phải xóa socketId khỏi userSockets và xóa entry khi không còn socket nào', async () => {
    // Thiết lập: gán trực tiếp vào Map nội bộ
    const userId = 10;
    const socketId = 'socket-disc';
    (gateway as any).userSockets.set(userId, new Set([socketId]));

    const client: any = { id: socketId, userId };
    gateway.handleDisconnect(client);

    expect((gateway as any).userSockets.has(userId)).toBe(false);
  });

  it('handleDisconnect chỉ xóa socketId tương ứng khi user có nhiều socket', async () => {
    const userId = 20;
    const socket1 = 'socket-a';
    const socket2 = 'socket-b';
    (gateway as any).userSockets.set(userId, new Set([socket1, socket2]));

    const client: any = { id: socket1, userId };
    gateway.handleDisconnect(client);

    const remaining = (gateway as any).userSockets.get(userId);
    expect(remaining).toBeDefined();
    expect(remaining.has(socket1)).toBe(false);
    expect(remaining.has(socket2)).toBe(true);
  });

  // ---- sendNotification ----
  it('sendNotification phải emit đến room user_<userId>', () => {
    const mockEmit = vi.fn();
    const mockTo = vi.fn().mockReturnValue({ emit: mockEmit });
    (gateway as any).server.to = mockTo;

    const userId = 99;
    const payload = { type: 'TEST', message: 'hello' };
    gateway.sendNotification(userId, payload);

    expect(mockTo).toHaveBeenCalledWith(`user_${userId}`);
    expect(mockEmit).toHaveBeenCalledWith('notification', payload);
  });

  // Property-based: sendNotification luôn target đúng room với userId bất kỳ
  it('sendNotification luôn emit đến room user_<userId> với nhiều userId khác nhau', () => {
    const userIds = [1, 5, 100, 999, 12345];

    for (const userId of userIds) {
      const mockEmit = vi.fn();
      const mockTo = vi.fn().mockReturnValue({ emit: mockEmit });
      (gateway as any).server.to = mockTo;

      gateway.sendNotification(userId, { msg: 'test' });

      expect(mockTo).toHaveBeenCalledWith(`user_${userId}`);
    }
  });

  // ---- sendToAdmins ----
  it('sendToAdmins phải emit đến room admins', () => {
    const mockEmit = vi.fn();
    const mockTo = vi.fn().mockReturnValue({ emit: mockEmit });
    (gateway as any).server.to = mockTo;

    gateway.sendToAdmins('notification', { type: 'NEW_ORDER' });

    expect(mockTo).toHaveBeenCalledWith('admins');
    expect(mockEmit).toHaveBeenCalledWith('notification', { type: 'NEW_ORDER' });
  });
});
