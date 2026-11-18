import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SepayPaymentsService } from './sepay-payments.service.js';
import { SepayPaymentsController } from './sepay-payments.controller.js';

const mailOutbox = { recipientFor: vi.fn(), enqueue: vi.fn(), kick: vi.fn() };

const makeService = (prisma: any = {}) =>
    new SepayPaymentsService(
        prisma,
        {} as any,
        { getOrThrow: vi.fn(), get: vi.fn() } as any,
        { notifyOrderPaid: vi.fn() } as any,
        { create: vi.fn(), createForAdmins: vi.fn() } as any,
        mailOutbox as any,
    );

const makeTx = (order: any, claimCount = 1) => ({
    $queryRaw: vi.fn(),
    order: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(order),
        update: vi.fn().mockResolvedValue({ ...order, status: 'CONFIRMED', paymentStatus: 'PAID' }),
    },
    payment: { updateMany: vi.fn().mockResolvedValue({ count: claimCount }) },
    orderStatusHistory: { create: vi.fn() },
});

const payment = (over: any = {}) => ({
    id: 1, orderId: 10, status: 'PENDING', amount: new Prisma.Decimal('1500000'), order: {}, ...over,
});
const order = (over: any = {}) => ({
    id: 10, code: 'ORD1', status: 'PENDING', paymentStatus: 'UNPAID', userId: 5, contactEmail: null, ...over,
});
const info = { amount: '1500000.00', method: 'BANK_TRANSFER', sepayOrderId: 'PAY1', sepayTransactionId: 'T1' };

beforeEach(() => {
    vi.clearAllMocks();
    mailOutbox.recipientFor.mockResolvedValue('khach@example.com');
});

describe('markPaid', () => {
    it('đơn hợp lệ: đánh dấu PAID, xác nhận đơn, ghi lịch sử, đưa email vào outbox', async () => {
        const tx = makeTx(order());
        const r = await makeService().markPaid(tx as any, payment() as any, info);

        expect(r.result).toBe('PROCESSED');
        expect(r.outcome?.kind).toBe('PAID');
        expect(tx.order.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ paymentStatus: 'PAID', status: 'CONFIRMED' }) }),
        );
        expect(tx.orderStatusHistory.create).toHaveBeenCalledOnce();
        expect(mailOutbox.enqueue).toHaveBeenCalledWith(
            expect.objectContaining({ dedupeKey: 'order-paid:10', template: 'order-paid', to: 'khach@example.com' }),
            tx,
        );
    });

    it('lệch số tiền: chuyển REVIEW, không đụng đến đơn', async () => {
        const tx = makeTx(order());
        const r = await makeService().markPaid(tx as any, payment() as any, { ...info, amount: '1400000.00' });

        expect(r.result).toBe('AMOUNT_MISMATCH');
        expect(r.outcome).toMatchObject({ kind: 'REVIEW', reason: 'AMOUNT_MISMATCH', paymentId: 1 });
        expect(tx.order.update).not.toHaveBeenCalled();
    });

    it('cờ force bỏ qua kiểm tra số tiền (admin chấp nhận)', async () => {
        const tx = makeTx(order());
        const r = await makeService().markPaid(tx as any, payment() as any, { ...info, amount: '1400000.00', force: true });
        expect(r.result).toBe('PROCESSED');
    });

    it('đơn đã được thanh toán bởi khoản khác: DUPLICATE_PAYMENT', async () => {
        const tx = makeTx(order({ paymentStatus: 'PAID' }));
        const r = await makeService().markPaid(tx as any, payment() as any, info);
        expect(r.result).toBe('DUPLICATE_PAYMENT');
        expect(tx.order.update).not.toHaveBeenCalled();
    });

    it('đơn đã hủy: ORDER_CANCELLED', async () => {
        const tx = makeTx(order({ status: 'CANCELLED' }));
        const r = await makeService().markPaid(tx as any, payment() as any, info);
        expect(r.result).toBe('ORDER_CANCELLED');
    });

    it('payment đã PAID: bỏ qua', async () => {
        const tx = makeTx(order());
        const r = await makeService().markPaid(tx as any, payment({ status: 'PAID' }) as any, info);
        expect(r.result).toBe('IGNORED');
        expect(tx.payment.updateMany).not.toHaveBeenCalled();
    });

    it('thua cuộc đua (updateMany trả 0): không cập nhật đơn, không gửi mail', async () => {
        const tx = makeTx(order(), 0);
        const r = await makeService().markPaid(tx as any, payment() as any, info);
        expect(r.result).toBe('IGNORED');
        expect(tx.order.update).not.toHaveBeenCalled();
        expect(mailOutbox.enqueue).not.toHaveBeenCalled();
    });
});

describe('handleIpn', () => {
    it('IPN trùng (P2002) được coi là thành công, không ném lỗi', async () => {
        const dup = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });
        const svc = makeService({ $transaction: vi.fn().mockRejectedValue(dup) });
        const body: any = {
            notification_type: 'ORDER_PAID',
            order: { order_invoice_number: 'INV1', order_id: 'O1', order_amount: '1' },
            transaction: { transaction_id: 'T1' },
        };
        await expect(svc.handleIpn(body)).resolves.toBeUndefined();
    });

    it('lỗi khác P2002 thì được ném ra (để SePay nhận lỗi)', async () => {
        const svc = makeService({ $transaction: vi.fn().mockRejectedValue(new Error('db down')) });
        const body: any = { notification_type: 'ORDER_PAID', order: { order_invoice_number: 'INV1' }, transaction: {} };
        await expect(svc.handleIpn(body)).rejects.toThrow('db down');
    });

    it('IPN thiếu invoice: bỏ qua, không gọi DB', async () => {
        const prisma = { $transaction: vi.fn() };
        const svc = makeService(prisma);
        await expect(svc.handleIpn({ notification_type: 'ORDER_PAID' } as any)).resolves.toBeUndefined();
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });
});

describe('SepayPaymentsController.ipn', () => {
    const res = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn() });
    const make = () => {
        const service = { handleIpn: vi.fn() };
        const config = { getOrThrow: vi.fn().mockReturnValue('s3cret') };
        return { service, ctrl: new SepayPaymentsController(service as any, config as any) };
    };

    it('thiếu hoặc sai X-Secret-Key: 401, không xử lý', async () => {
        const { ctrl, service } = make();
        await expect(ctrl.ipn(undefined, {} as any, res() as any)).rejects.toThrow(UnauthorizedException);
        await expect(ctrl.ipn('wrong', {} as any, res() as any)).rejects.toThrow(UnauthorizedException);
        expect(service.handleIpn).not.toHaveBeenCalled();
    });

    it('đúng secret: xử lý rồi trả 200 { success: true }', async () => {
        const { ctrl, service } = make();
        const r = res();
        await ctrl.ipn('s3cret', { notification_type: 'ORDER_PAID' } as any, r as any);
        expect(service.handleIpn).toHaveBeenCalledOnce();
        expect(r.status).toHaveBeenCalledWith(200);
        expect(r.json).toHaveBeenCalledWith({ success: true });
    });
});