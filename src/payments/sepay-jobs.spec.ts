import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SepayReconcileService } from './sepay-reconcile.service.js';
import { SepayOrderExpiryService } from './sepay-order-expiry.service.js';

describe('SepayReconcileService.checkOne', () => {
    const setup = () => {
        const prisma = { payment: { update: vi.fn(), updateMany: vi.fn() } };
        const gateway = { retrieveOrder: vi.fn() };
        const payments = { settleFromGateway: vi.fn() };
        const svc: any = new SepayReconcileService(prisma as any, gateway as any, payments as any);
        return { prisma, gateway, payments, svc };
    };
    const pay = (ageMs = 15 * 60_000) => ({ id: 1, invoiceNumber: 'INV1', createdAt: new Date(Date.now() - ageMs) });

    it('SePay báo CAPTURED: ghi nhận thanh toán', async () => {
        const { svc, gateway, payments } = setup();
        const gw = { order_status: 'CAPTURED', order_amount: '100' };
        gateway.retrieveOrder.mockResolvedValue(gw);
        await svc.checkOne(pay(), Date.now());
        expect(payments.settleFromGateway).toHaveBeenCalledWith(1, gw);
    });

    it('404 và chưa hết hạn: chỉ cập nhật lastCheckedAt', async () => {
        const { svc, gateway, prisma, payments } = setup();
        gateway.retrieveOrder.mockRejectedValue({ response: { status: 404 } });
        await svc.checkOne(pay(), Date.now());
        expect(payments.settleFromGateway).not.toHaveBeenCalled();
        expect(prisma.payment.update).toHaveBeenCalled();
        expect(prisma.payment.updateMany).not.toHaveBeenCalled();
    });

    it('404 và quá 24 giờ: chuyển CANCELLED', async () => {
        const { svc, gateway, prisma } = setup();
        gateway.retrieveOrder.mockRejectedValue({ response: { status: 404 } });
        await svc.checkOne(pay(25 * 3600_000), Date.now());
        expect(prisma.payment.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) }),
        );
    });

    it('lỗi mạng (không phải 404): không đổi gì, thử lại lượt sau', async () => {
        const { svc, gateway, prisma, payments } = setup();
        gateway.retrieveOrder.mockRejectedValue({ message: 'ETIMEDOUT' });
        await svc.checkOne(pay(), Date.now());
        expect(payments.settleFromGateway).not.toHaveBeenCalled();
        expect(prisma.payment.update).not.toHaveBeenCalled();
        expect(prisma.payment.updateMany).not.toHaveBeenCalled();
    });
});

describe('SepayOrderExpiryService.expire', () => {
    const items = [
        { variantId: 7, productId: 1, quantity: 2 },
        { variantId: null, productId: 3, quantity: 1 },
    ];
    const setup = (order: any) => {
        const tx = {
            $queryRaw: vi.fn(),
            order: { findUnique: vi.fn().mockResolvedValue(order), update: vi.fn() },
            productVariant: { update: vi.fn() },
            product: { update: vi.fn() },
            orderStatusHistory: { create: vi.fn() },
        };
        const prisma = { $transaction: vi.fn(async (cb: any) => cb(tx)) };
        const mailOutbox = { recipientFor: vi.fn().mockResolvedValue(null), enqueue: vi.fn(), kick: vi.fn() };
        const notifications = { create: vi.fn() };
        const svc: any = new SepayOrderExpiryService(prisma as any, {} as any, {} as any, notifications as any, mailOutbox as any);
        return { tx, svc };
    };

    it('hoàn kho đúng biến thể/sản phẩm, hủy đơn, ghi lịch sử', async () => {
        const { tx, svc } = setup({ id: 10, code: 'ORD1', userId: null, status: 'PENDING', paymentStatus: 'UNPAID', items });
        await svc.expire(10);
        expect(tx.productVariant.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { stock: { increment: 2 } } });
        expect(tx.product.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { stock: { increment: 1 } } });
        expect(tx.order.update).toHaveBeenCalledWith({ where: { id: 10 }, data: { status: 'CANCELLED' } });
        expect(tx.orderStatusHistory.create).toHaveBeenCalledOnce();
    });

    it('đơn đã được duyệt trong lúc job chạy: không hoàn kho, không hủy', async () => {
        const { tx, svc } = setup({ id: 10, code: 'ORD1', userId: null, status: 'CONFIRMED', paymentStatus: 'PAID', items });
        await svc.expire(10);
        expect(tx.productVariant.update).not.toHaveBeenCalled();
        expect(tx.order.update).not.toHaveBeenCalled();
    });
});